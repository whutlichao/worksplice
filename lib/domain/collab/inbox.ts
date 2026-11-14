import { getDb } from "../../data/db-singleton.ts";
import { getMember, extractMentionedMemberIds } from "./members.ts";
import { getChannelMute, resolveChannelForTarget } from "./channels.ts";
import { messageWithAuthor, previewLine, type MessageWithAuthor } from "./messages.ts";
import { MESSAGE_WINDOW_LIMIT, type MessageRow } from "../../data/types.ts";

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
  /** 本窗口之外是否还有更晚的消息（票 #243：窗口外积压留给下一轮）。 */
  hasMore: boolean;
  /** drain 时的已消费游标（ack 前的读数）。 */
  consumedSeq: number;
  /**
   * 本窗口实际读到的最后一条 seq（回复 freshness 的 baseSeq / ack 来源）。
   * 不是 target 的全局 max(seq)：窗口外还有积压时两者不同。
   */
  maxSeq: number;
}

/** drain 的窗口条数（与注入窗口同量级；数据层另有同值硬上限）。 */
export const INBOX_DRAIN_WINDOW = MESSAGE_WINDOW_LIMIT;

/** §5.5 getSince(target, sinceSeq)：seq 增量查询（ASC）。 */
export function getSince(targetId: string, sinceSeq: number): MessageWithAuthor[] {
  return getDb().listMessagesAfter(targetId, sinceSeq).map((m) => messageWithAuthor(m));
}

/**
 * §3.2 可见性口径（drain / hold 重路由共用的唯一实现）：该成员静音了目标 channel 时，
 * 静音时刻之后的普通消息不可见，个人 @mention 仍穿透；静音前的消息照常可见。
 * channel 消息按 seq 比（muteFromSeq 即 channel 版本）；thread 消息无 channel seq 可比
 * （thread 自己的 seq 空间），按静音时刻的全局插入序（muteRowid）判定"静音后"。
 */
export function filterVisibleMessages<T extends MessageRow>(
  agentId: string,
  targetId: string,
  rows: T[],
): T[] {
  const channel = resolveChannelForTarget(targetId);
  const mute = channel ? getChannelMute(channel.id, agentId) : undefined;
  if (!mute) return rows;
  // target 即 channel 时为 channel 目标（按 seq 比）；否则是 thread 锚点（按全局插入序比）
  const isChannelTarget = channel ? channel.id === targetId : false;
  return rows.filter((row) =>
    isChannelTarget
      ? row.seq <= mute.muteFromSeq || mentionsAgent(row, agentId)
      : (row.rowid ?? 0) <= mute.muteRowid || mentionsAgent(row, agentId),
  );
}

/**
 * §3.8 drain：按 consumed_seqs 游标拉取增量（本地无 50 轮分页上限，
 * 但保留 hasMore 语义）；不推进游标——重复 drain 不重不漏。
 * §3.2 mute 过滤见 filterVisibleMessages（静音后的普通消息不进 inbox）。
 */
export function drain(agentId: string, targetId: string): DrainResult {
  const db = getDb();
  const consumedSeq = db.getConsumedSeq(agentId, targetId);
  const rows = db.listMessagesAfter(targetId, consumedSeq, INBOX_DRAIN_WINDOW);
  const visible = filterVisibleMessages(agentId, targetId, rows);
  const windowLastSeq = rows.length > 0 ? rows[rows.length - 1].seq : consumedSeq;
  return {
    targetId,
    messages: visible.map((m) => messageWithAuthor(m)),
    hasMore: rows.length > 0 && db.hasMessagesAfter(targetId, windowLastSeq),
    consumedSeq,
    maxSeq: windowLastSeq,
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
      let cursor = since;
      for (;;) {
        const rows = db.listMessagesAfter(targetId, cursor);
        if (rows.some((message) => mentionsAgent(message, agentId))) return true;
        if (rows.length === 0) return false;
        const lastSeq = rows[rows.length - 1].seq;
        if (!db.hasMessagesAfter(targetId, lastSeq)) return false;
        cursor = lastSeq;
      }
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
