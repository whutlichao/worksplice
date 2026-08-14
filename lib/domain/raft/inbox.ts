import { getDb } from "../../data/db-singleton.ts";
import { getMember, extractMentionedMemberIds } from "./members.ts";
import { getChannelMute, resolveChannelForTarget } from "./channels.ts";
import { messageWithAuthor, previewLine, type MessageWithAuthor } from "./messages.ts";
import type { MessageRow } from "../../data/types.ts";

/**
 * inbox 服务层（§5.5）：拉取式收件箱的查询接口。
 * 持久化游标 = consumed_seqs（agent_id, target_id, seq）；drain 不推进游标，
 * ack 由调用方/agent-loop 收口推进（§3.8 每轮结束后推进；HTTP 语义 drain + ack 一并推进）。
 */

export { resolveChannelForTarget as resolveTargetChannel } from "./channels.ts";
export type { MessageWithAuthor } from "./messages.ts";

export interface DrainResult {
  targetId: string;
  messages: MessageWithAuthor[];
  /** raft 协议兼容的 hasMore 语义：本地无分页上限，一次 drain 取尽（恒为 false）。 */
  hasMore: boolean;
  /** drain 时的已消费游标（ack 前的读数）。 */
  consumedSeq: number;
  /** drain 时的房间版本 = target 的 max(seq)（回复 freshness 的 baseSeq 来源）。 */
  maxSeq: number;
}

/** §5.5 getSince(target, sinceSeq)：seq 增量查询（ASC）。 */
export function getSince(targetId: string, sinceSeq: number): MessageWithAuthor[] {
  return getDb().listMessagesAfter(targetId, sinceSeq).map((m) => messageWithAuthor(m));
}

/**
 * §3.8 drain：按 consumed_seqs 游标拉取增量（本地无 raft 的 50 轮分页上限，
 * 但保留 hasMore 语义）；不推进游标——重复 drain 不重不漏。
 * §3.2 mute 过滤：该成员静音了目标 channel 时，静音时刻之后的普通消息不进 inbox，
 * 个人 @mention 仍穿透（注意力信号）；静音前的消息照常投递。
 * channel 消息按 seq 比（muteFromSeq 即 channel 版本）；thread 消息无 channel seq 可比
 * （thread 自己的 seq 空间），按静音时刻的全局插入序（muteRowid）判定"静音后"。
 */
export function drain(agentId: string, targetId: string): DrainResult {
  const consumedSeq = getDb().getConsumedSeq(agentId, targetId);
  const rows = getDb().listMessagesAfter(targetId, consumedSeq);
  const channel = resolveChannelForTarget(targetId);
  const mute = channel ? getChannelMute(channel.id, agentId) : undefined;
  // target 即 channel 时为 channel 目标（按 seq 比）；否则是 thread 锚点（按全局插入序比）
  const isChannelTarget = channel ? channel.id === targetId : false;
  const visible = mute
    ? rows.filter((row) =>
        isChannelTarget
          ? row.seq <= mute.muteFromSeq || mentionsAgent(row, agentId)
          : (row.rowid ?? 0) <= mute.muteRowid || mentionsAgent(row, agentId),
      )
    : rows;
  return {
    targetId,
    messages: visible.map((m) => messageWithAuthor(m)),
    hasMore: false,
    consumedSeq,
    maxSeq: getDb().maxSeq(targetId),
  };
}

/** §3.2 消息是否个人 @mention 了指定成员（mute 穿透判定；与 wake 的 @mention 解析同源）。 */
function mentionsAgent(message: MessageRow, agentId: string): boolean {
  return extractMentionedMemberIds(message.content).includes(agentId);
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
    .filter((targetId) => {
      if (db.maxSeq(targetId) <= db.getConsumedSeq(agentId, targetId)) return false;
      // §3.2 mute：静音后普通消息不产生 pending；个人 @mention 仍穿透
      const mute = getChannelMute(targetId, agentId);
      if (!mute) return true;
      const since = Math.max(db.getConsumedSeq(agentId, targetId), mute.muteFromSeq);
      return db.listMessagesAfter(targetId, since).some((message) => mentionsAgent(message, agentId));
    });
}

/**
 * decide 语境（§5.4）：目标容器内未完结的任务（todo/in_progress/in_review）。
 * task 锚点消息位于该 target 内（任务必有 thread，§3.2）。
 */
export function listRelatedTasks(
  targetId: string,
): Array<{ number: number; status: string; preview: string; ownerName: string; reopened: boolean }> {
  const db = getDb();
  const open = new Set(["todo", "in_progress", "in_review"]);
  return db
    .listTasks()
    .filter((task) => open.has(task.status))
    .map((task) => ({ task, message: db.getMessage(task.message_id) }))
    .filter((x): x is { task: (typeof x)["task"]; message: MessageRow } => Boolean(x.message))
    .filter((x) => x.message.target_id === targetId || x.message.id === targetId)
    .map(({ task, message }) => ({
      number: task.number,
      status: task.status,
      preview: previewLine(message.content),
      ownerName: task.owner_id ? (getMember(task.owner_id)?.name ?? "unassigned") : "unassigned",
      reopened: task.reopened === 1,
    }));
}
