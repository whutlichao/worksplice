import { getDb } from "./db-singleton.ts";
import { getChannel, isChannelMember } from "./channels.ts";
import { getMember } from "./members.ts";
import type { ChannelRow, MemberRow, MessageRow } from "../data/db.ts";

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

export type SendMessageResult =
  | { held: false; message: MessageRow }
  | { held: true; roomSeq: number; whatHappened: string };

export interface MessageWithAuthor extends MessageRow {
  author: MemberRow | null;
}

interface ResolvedTarget {
  /** 实际落库 target：channel id 或 thread 锚点消息 id */
  targetId: string;
  channel: ChannelRow;
  anchor: MessageRow | null;
}

function messageWithAuthor(message: MessageRow): MessageWithAuthor {
  return { ...message, author: getMember(message.author_id) ?? null };
}

/**
 * 解析消息归属容器（§6.1 target 归一化约定）：
 * target_id 命中 channels 则为 channel；否则必须是顶层消息（thread 锚点）。
 * thread 消息不能作为新 target（不可嵌套，§3.2）。
 */
function resolveTarget(targetId: string): ResolvedTarget {
  const channel = getChannel(targetId);
  if (channel) return { targetId, channel, anchor: null };

  const anchor = getDb().getMessage(targetId);
  if (!anchor) throw new Error("Channel or message not found");
  const anchorChannel = getChannel(anchor.target_id);
  if (!anchorChannel) throw new Error("Threads cannot be nested");
  return { targetId: anchor.id, channel: anchorChannel, anchor };
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
}): SendMessageResult {
  const content = input.content.trim();
  if (!content) throw new Error("Message content is required");
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

  return getDb().withTransaction(() => {
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
    return { held: false as const, message };
  });
}

/** held 摘要：期间发生了什么（§3.3/§6.3）。 */
function summarizeChanges(targetId: string, sinceSeq: number): string {
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
  return {
    messages: rows.map(messageWithAuthor),
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
  const firstLine = message.content.split("\n")[0].trim();
  const preview = firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
  return `> **#${message.seq} ${authorName}**\n> ${preview}\n\n`;
}
