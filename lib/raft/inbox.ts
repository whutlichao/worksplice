import { getDb } from "./db-singleton.ts";
import { getChannel } from "./channels.ts";
import { getMember } from "./members.ts";
import type { ChannelRow, MemberRow, MessageRow } from "../data/db.ts";

/**
 * inbox 服务层（§5.5）：拉取式收件箱的查询接口。
 * 持久化游标 = consumed_seqs（agent_id, target_id, seq）；drain 不推进游标，
 * ack 由调用方/agent-loop 收口推进（§3.8 每轮结束后推进；HTTP 语义 drain + ack 一并推进）。
 */

export interface MessageWithAuthor extends MessageRow {
  author: MemberRow | null;
}

function messageWithAuthor(message: MessageRow): MessageWithAuthor {
  return { ...message, author: getMember(message.author_id) ?? null };
}

export interface DrainResult {
  targetId: string;
  messages: MessageWithAuthor[];
  /** 保留 raft 分页语义：本次返回之外还有更多（本地默认无上限，传 limit 时才有意义）。 */
  hasMore: boolean;
  /** drain 时的已消费游标（ack 前的读数）。 */
  consumedSeq: number;
  /** drain 时的房间版本 = target 的 max(seq)（回复 freshness 的 baseSeq 来源）。 */
  maxSeq: number;
}

/** §5.5 getSince(target, sinceSeq)：seq 增量查询（ASC）。 */
export function getSince(targetId: string, sinceSeq: number): MessageWithAuthor[] {
  return getDb().listMessagesAfter(targetId, sinceSeq).map(messageWithAuthor);
}

/**
 * §3.8 drain：按 consumed_seqs 游标拉取增量（本地无 raft 的 50 轮分页上限，
 * 但保留 hasMore 语义）；不推进游标——重复 drain 不重不漏。
 */
export function drain(
  agentId: string,
  targetId: string,
  opts: { limit?: number } = {},
): DrainResult {
  const consumedSeq = getDb().getConsumedSeq(agentId, targetId);
  const rows = getDb().listMessagesAfter(targetId, consumedSeq);
  const limited = opts.limit && opts.limit > 0 ? rows.slice(0, opts.limit) : rows;
  return {
    targetId,
    messages: limited.map(messageWithAuthor),
    hasMore: limited.length < rows.length,
    consumedSeq,
    maxSeq: getDb().maxSeq(targetId),
  };
}

/** ack：把消费游标推进到指定 seq（agent-loop 每轮结束后调用，§3.8/§5.5）。 */
export function ack(agentId: string, targetId: string, seq: number): void {
  getDb().setConsumedSeq(agentId, targetId, seq);
}

/** §5.7 HTTP inbox 语义：drain + ack（返回前推进游标）。 */
export function drainAndAck(agentId: string, targetId: string): DrainResult {
  const result = drain(agentId, targetId);
  ack(agentId, targetId, result.maxSeq);
  return result;
}

/** 该 agent 已加入且存在未消费消息的 channel 目标（HTTP 无 targetId 时的全量 drain）。 */
export function getPendingTargets(agentId: string): string[] {
  const db = getDb();
  return db
    .listChannels()
    .filter((channel) => db.isChannelMember(channel.id, agentId))
    .map((channel) => channel.id)
    .filter((targetId) => db.maxSeq(targetId) > db.getConsumedSeq(agentId, targetId));
}

/**
 * target 归一化（§6.1）：命中 channels 即 channel；否则必须是顶层消息（thread 锚点）。
 * 未知 target 返回 undefined（读侧宽松）。
 */
export function resolveTargetChannel(targetId: string): ChannelRow | undefined {
  const channel = getChannel(targetId);
  if (channel) return channel;
  const anchor = getDb().getMessage(targetId);
  if (!anchor) return undefined;
  return getChannel(anchor.target_id);
}

/**
 * decide 语境（§5.4）：目标容器内未完结的任务（todo/in_progress/in_review）。
 * task 锚点消息位于该 target 内（任务必有 thread，§3.2）。
 */
export function listRelatedTasks(
  targetId: string,
): Array<{ number: number; status: string; preview: string; ownerName: string }> {
  const db = getDb();
  const open = new Set(["todo", "in_progress", "in_review"]);
  return db
    .listTasks()
    .filter((task) => open.has(task.status))
    .map((task) => ({ task, message: db.getMessage(task.message_id) }))
    .filter((x): x is { task: (typeof x)["task"]; message: MessageRow } => Boolean(x.message))
    .filter((x) => x.message.target_id === targetId || x.message.id === targetId)
    .map(({ task, message }) => {
      const firstLine = message.content.split("\n")[0].trim();
      const preview = firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
      return {
        number: task.number,
        status: task.status,
        preview,
        ownerName: task.owner_id ? (getMember(task.owner_id)?.name ?? "unassigned") : "unassigned",
      };
    });
}
