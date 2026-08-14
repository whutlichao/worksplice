import { getDb } from "./db-singleton.ts";
import { getChannel, isChannelMember, resolveChannelForTarget } from "./channels.ts";
import { getMember } from "./members.ts";
import { notifyMessageWakes } from "./wake.ts";
import { listReactionSummaries, type ReactionSummary } from "./reactions.ts";
import { listAbandonedMarks, type AbandonedMark } from "./rounds.ts";
import {
  discardAttachmentFiles,
  stageAttachmentFiles,
  type MessageAttachmentDraft,
} from "./attachments.ts";
import { previewLine } from "../preview.ts";
import type { AttachmentRow, ChannelRow, MemberRow, MessageRow } from "../data/types.ts";

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
export { previewLine } from "../preview.ts";

/**
 * 解析消息归属容器（§6.1 target 归一化约定）：
 * target_id 命中 channels 则为 channel；否则必须是顶层消息（thread 锚点）。
 * thread 消息不能作为新 target（不可嵌套，§3.2）。
 */
function resolveTarget(targetId: string): ResolvedTarget {
  const channel = resolveChannelForTarget(targetId);
  if (channel) {
    const anchor = getDb().getChannel(targetId) ? null : (getDb().getMessage(targetId) ?? null);
    return { targetId: anchor ? anchor.id : targetId, channel, anchor };
  }
  if (getDb().getMessage(targetId)) throw new Error("Threads cannot be nested");
  throw new Error("Channel or message not found");
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
    // 提交成功后发 wake hint（只含 seq/目标，不含正文）；事务外分发，避免回滚误唤醒。
    // wake: false —— reminder 系统消息：只由 fireReminder 定向唤醒作者，不惊动全 channel（§3.9）
    if (!result.held) {
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

/** held 摘要：期间发生了什么（§3.3/§6.3）。任务 claim/updateStatus 复用同一事实（§3.7）。 */
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
