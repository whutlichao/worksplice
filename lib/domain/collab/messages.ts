import { getDb } from "../../data/db-singleton.ts";
import { getChannel, isChannelMember, listChannels, resolveChannelForTarget } from "./channels.ts";
import { getMember } from "./members.ts";
import { notifyMessageWakes } from "./wake.ts";
import { listReactionSummaries, type ReactionSummary } from "./reactions.ts";
import { listAbandonedMarks, type AbandonedMark } from "./rounds.ts";
import { RoomPrivateChannelForbidden, getRoomTurnStore } from "./room-budget.ts";
import { selectMessageInvitations } from "./invitations.ts";
import { OWNER_MEMBER_ID } from "../../data/schema.ts";
import {
  discardAttachmentFiles,
  stageAttachmentFiles,
  type MessageAttachmentDraft,
} from "./attachments.ts";
import { previewLine } from "../../preview.ts";
import type { AttachmentRow, ChannelRow, MemberRow, MessageRow } from "../../data/types.ts";

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

export type SendMessageResult =
  | { held: false; message: MessageRow }
  | { held: true; roomSeq: number; whatHappened: string };

export interface MessageWithAuthor extends MessageRow {
  author: MemberRow | null;
  /** §3.4 reaction 聚合（按 count 降序）；空数组 = 无 reaction。 */
  reactions: ReactionSummary[];
  /** §3.5 附件元数据（文件实体在 ~/.worksplice/attachments/，经 /api/attachments/[id] 下载）。 */
  attachments: AttachmentRow[];
  /** 线程回复数（thread 消息以锚点消息 id 为 target；UI 锚点角标，§6.1）。 */
  threadReplyCount: number;
  /** §09 「未回复（已放弃）」标记（消息流即时 badge，见 rounds.ts listAbandonedMarks）。 */
  abandonedMarks?: AbandonedMark[];
}

interface ResolvedTarget {
  /** 实际落库 target：channel id 或 thread 锚点消息 id */
  targetId: string;
  channel: ChannelRow;
  anchor: MessageRow | null;
}

export function messageWithAuthor(
  message: MessageRow,
  opts?: { threadReplyCount?: number; abandonedMarks?: AbandonedMark[] },
): MessageWithAuthor {
  return {
    ...message,
    author: getMember(message.author_id) ?? null,
    reactions: listReactionSummaries(message.id),
    attachments: getDb().listAttachments(message.id),
    threadReplyCount: opts?.threadReplyCount ?? getDb().threadReplyCount(message.id),
    abandonedMarks: opts?.abandonedMarks,
  };
}

/** 引用块/任务摘要共用的内容预览：首行截断（实现在 lib/preview.ts，client 可安全复用）。 */
export { previewLine } from "../../preview.ts";

/**
 * target 引用解析（成员面 / 路由面共用的名称→id 归一化）：
 * `#name` / `name` / channel id / 顶层消息 id 都接受；thread 消息（target 是另一条消息的条目）
 * 不可当新 target（不可嵌套，§3.2）——规则只在服务层实现一处，成员面 op 与 sendMessage 共用。
 * 未知引用抛 `Channel or message not found`（与 sendMessage 同措辞）。
 */
export function resolveTargetRef(ref: string): string {
  const trimmed = ref.trim();
  const name = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  const channel = listChannels().find(
    (candidate) =>
      candidate.id === trimmed ||
      candidate.name === trimmed ||
      candidate.name === name ||
      candidate.name === `#${name}`,
  );
  if (channel) return channel.id;
  const message = getDb().getMessage(trimmed);
  if (!message) throw new Error("Channel or message not found");
  if (getDb().getMessage(message.target_id)) throw new Error("Threads cannot be nested");
  return message.id;
}

/**
 * 解析消息归属容器（§6.1 target 归一化约定）：
 * target_id 命中 channels 则为 channel；否则必须是顶层消息（thread 锚点）。
 * thread 消息不能作为新 target（不可嵌套，§3.2）。
 */
function resolveTarget(targetId: string): ResolvedTarget {
  const id = resolveTargetRef(targetId);
  const channel = resolveChannelForTarget(id);
  if (!channel) throw new Error("Channel or message not found");
  const anchor = getDb().getChannel(id) ? null : (getDb().getMessage(id) ?? null);
  return { targetId: id, channel, anchor };
}

/**
 * 发送消息（§3.3/§6.3）：不可编辑/删除；seq 在 target 内单调递增；
 * 携带写稿时的房间版本（base_seq = max(seq)），事务内比对，不等则返回 held。
 */
export function sendMessage(input: {
  targetId: string;
  authorId: string;
  content: string;
  baseSeq?: number;
  quoteId?: string;
  /** §3.5 附件草案（≤50MB）：先校验落盘再事务；held/抛错时清理，不留下孤儿文件。 */
  attachments?: MessageAttachmentDraft[];
  /** 系统消息（reminder 到点投递）不触发 channel 级 wake，只由 fire 流程定向唤醒作者（§3.9）。 */
  wake?: boolean;
  /**
   * 房间回合语境（只由 `runAgentRound` 的投递路径传入，I6）：
   * 解析出的频道必须等于 `channelId`，否则抛 `RoomPrivateChannelForbidden`——成员在
   * 房间回合里不能把话说到房间看不见的地方。`epoch` 在场的意义是 I5：被取代场次的
   * 回复照常落库、但按 `stale` 记账（不计预算、不参与选人）。
   */
  roomContext?: { channelId: string; epoch?: number };
  /** 系统/事件消息（任务创建通知等）不占房间回合预算。 */
  roomNotice?: boolean;
}): SendMessageResult {
  const content = input.content.trim();
  if (!content && (input.attachments?.length ?? 0) === 0) {
    throw new Error("Message content is required");
  }
  const target = resolveTarget(input.targetId);
  if (target.channel.archived === 1) {
    throw new Error("This channel is archived and is read-only");
  }
  if (!isChannelMember(target.channel.id, input.authorId)) {
    throw new Error("You are not a member of this channel");
  }
  // I6 房间可见性（本票 spec §6.6）：房间回合只允许在房间自己的 target 上发言。
  // 无 roomContext 的既有调用（人类 UI / 事件消息 / 秘书 DM / 路由层）行为不变。
  if (input.roomContext && input.roomContext.channelId !== target.channel.id) {
    throw new RoomPrivateChannelForbidden();
  }

  const quotedRow = input.quoteId ? getDb().getMessage(input.quoteId) : null;
  if (input.quoteId && !quotedRow) throw new Error("Quoted message not found");
  const quoted = quotedRow ?? null;

  const finalContent = quoted
    ? `${formatQuote(quoted, getMember(quoted.author_id)?.name ?? "unknown")}${content}`
    : content;

  // 先落盘（校验大小 + 随机文件名），事务成功才保留；held/抛错路径统一清理。
  const staged = stageAttachmentFiles(input.attachments ?? []);
  try {
    const result = getDb().withTransaction(() => {
      const roomSeq = getDb().maxSeq(target.targetId);
      if (input.baseSeq !== undefined && input.baseSeq !== roomSeq) {
        return {
          held: true as const,
          roomSeq,
          whatHappened: summarizeChanges(target.targetId, input.baseSeq),
        };
      }
      const message = getDb().appendMessage({
        targetId: target.targetId,
        authorId: input.authorId,
        content: finalContent,
      });
      for (const attachment of staged) {
        getDb().insertAttachment({
          messageId: message.id,
          fileName: attachment.fileName,
          mime: attachment.mime,
          sizeBytes: attachment.sizeBytes,
          diskPath: attachment.diskPath,
        });
      }
      return { held: false as const, message };
    });
    // 提交成功后：先记房间回合预算（场次计数器 / 水位线 / 选人），再发 wake hint。
    // 顺序是承重的——唤醒驱动的轮次入场就要问「我是否被这一波选中」，预算必须先落。
    if (!result.held) {
      recordRoomTurn({
        message: result.message,
        channelId: target.channel.id,
        authorId: input.authorId,
        roomContext: input.roomContext,
        roomNotice: input.roomNotice,
        systemMessage: input.wake === false,
        replyToAuthorId: quoted?.author_id ?? null,
      });
      // wake hint 只含 seq/目标，不含正文；事务外分发，避免回滚误唤醒。
      // wake: false —— reminder 系统消息：只由 fireReminder 定向唤醒作者，不惊动全 channel（§3.9）
      if (input.wake !== false) notifyMessageWakes(result.message);
    } else {
      discardAttachmentFiles(staged);
    }
    return result;
  } catch (error) {
    discardAttachmentFiles(staged);
    throw error;
  }
}

/**
 * 房间回合预算的唯一写入面（本票 spec §6.2）：一条消息落库后立刻反映到场次状态机上。
 * - 人类（Owner）消息 = 新场次（`beginTurn`：epoch+1、lateTurns 归零、第一波选人）；
 * - agent 消息 = `noteReply`（I1 计数 + 水位线前移 + 引用边形成，供 `cited()` 选人）；
 * - 系统 / 事件消息（`roomNotice`、`wake:false` 的提醒投递）不占预算。
 * DM 没有房间语义（`isRoomChannel` = false）⇒ `beginTurn` 只推进 epoch、不设预算，
 * 既有 DM 路径行为逐字节不变。
 */
function recordRoomTurn(input: {
  message: MessageRow;
  channelId: string;
  authorId: string;
  roomContext?: { channelId: string; epoch?: number };
  roomNotice?: boolean;
  systemMessage: boolean;
  replyToAuthorId: string | null;
}): void {
  if (input.roomNotice || input.systemMessage) return;
  const store = getRoomTurnStore();
  const author = getMember(input.authorId);
  if (author?.type === "agent") {
    store.noteReply({
      channelId: input.channelId,
      memberId: input.authorId,
      seq: input.message.seq,
      // 跨 target（任务线程）用全局插入序做房间水位线，thread 自己的 seq 空间不可比
      order: input.message.rowid ?? input.message.seq,
      text: input.message.content,
      epoch: input.roomContext?.epoch,
      // Ticket #237：普通 agent 正文 @ 不新增候选、不产生第二波。
      // 显式传空数组 = 这条发言不贡献引用边；room-budget 的纯状态机单测仍可省略该参数
      // 走旧解析（保留回边抑制的测试面）。
      mentions: [],
    });
    return;
  }
  if (input.authorId === OWNER_MEMBER_ID) {
    const invitations = selectMessageInvitations({
      targetId: input.message.target_id,
      authorId: input.authorId,
      content: input.message.content,
    });
    store.beginTurn({
      channelId: input.channelId,
      triggerSeq: input.message.seq,
      text: input.message.content,
      targetId: input.message.target_id,
      authorId: input.authorId,
      replyToAuthorId: input.replyToAuthorId,
      candidates: invitations.candidates,
    });
  }
}

/** held 摘要：期间发生了什么（§3.3/§6.3）。任务 claim/updateStatus 复用同一事实（§3.7）。
 *
 * 语言归属（`docs/i18n.md` 的分层规则）：这段文本会进**模型上下文**
 * （`lib/agent-loop/loop.ts` 的 revise prompt 直接插值），属于「产品内容」⇒ 英文硬编码，
 * 不做服务端 locale 感知。界面侧的本地化在 `ChannelView` 的 held toast 上做
 * （那里显示的是 `message.held`，不含本摘要）。 */
export function summarizeChanges(targetId: string, sinceSeq: number): string {
  const arrived = getDb().listMessagesAfter(targetId, sinceSeq);
  if (arrived.length === 0) return "The room changed but no new messages arrived";
  const seqs = `${arrived[0].seq}` + (arrived.length > 1 ? `–${arrived[arrived.length - 1].seq}` : "");
  return `${arrived.length} new message(s) arrived in this target (seq ${seqs})`;
}

/**
 * seq 游标分页（§5.7）：不传 before 取最新一页；返回 ASC 序消息 + 是否有更早分页。
 * 未知 target 返回空页（读侧宽松，不抛错）。
 */
export function listMessages(
  targetId: string,
  opts: { before?: number; limit?: number } = {},
): { messages: MessageWithAuthor[]; hasMore: boolean; maxSeq: number } {
  const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_PAGE_LIMIT), MAX_PAGE_LIMIT);
  if (!getChannel(targetId) && !getDb().getMessage(targetId)) {
    return { messages: [], hasMore: false, maxSeq: 0 };
  }
  const rows = getDb().listMessagesBefore(targetId, opts.before, limit);
  rows.reverse();
  const oldest = rows[0]?.seq;
  const hasMore = oldest !== undefined && getDb().hasMessagesBefore(targetId, oldest);
  const replyCounts = rows.length > 0 ? getDb().threadReplyCounts(rows.map((r) => r.id)) : new Map<string, number>();
  // §09 已放弃标记：整页按 target 批量查一次（round_logs 按 rowid 倒序，服务层取每 agent 最新一轮），
  // 再按 baseSeq 归位到对应 seq 的消息——避免逐条查询。
  const marksBySeq = new Map<number, AbandonedMark[]>();
  for (const mark of listAbandonedMarks(targetId)) {
    const bucket = marksBySeq.get(mark.baseSeq) ?? [];
    bucket.push(mark);
    marksBySeq.set(mark.baseSeq, bucket);
  }
  return {
    messages: rows.map((row) =>
      messageWithAuthor(row, {
        threadReplyCount: replyCounts.get(row.id) ?? 0,
        abandonedMarks: marksBySeq.get(row.seq),
      }),
    ),
    hasMore,
    maxSeq: getDb().maxSeq(targetId),
  };
}

export function getMessageWithAuthor(id: string): MessageWithAuthor {
  const message = getDb().getMessage(id);
  if (!message) throw new Error("Message not found");
  return messageWithAuthor(message);
}

/**
 * 线程读取：以锚点消息标识线程（§3.1 回复气泡展开 thread）。
 * 传入 thread 内消息时归一化回其线程锚点。
 */
export function getThreadInfo(
  anchorId: string,
): { anchor: MessageWithAuthor; messages: MessageWithAuthor[]; hasMore: boolean; maxSeq: number } {
  const first = getDb().getMessage(anchorId);
  if (!first) throw new Error("Message not found");
  const anchor = getChannel(first.target_id) ? first : getDb().getMessage(first.target_id);
  if (!anchor) throw new Error("Message not found");
  const page = listMessages(anchor.id);
  return { anchor: messageWithAuthor(anchor), ...page };
}

/** 引用块（§3.2 引用动作）：消息不可编辑，引用以块引用文本形式物化进内容。 */
export function formatQuote(message: MessageRow, authorName: string): string {
  return `> **#${message.seq} ${authorName}**\n> ${previewLine(message.content)}\n\n`;
}
