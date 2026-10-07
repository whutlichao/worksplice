import { getDb } from "../../data/db-singleton.ts";
import { getMember } from "./members.ts";
import type { RoundLogRow } from "../../data/types.ts";

/**
 * §07 轮次结果（Round Outcome）服务层：区分「自判 ignore」与「处理失败」的事实来源。
 *
 * 只落盘「有结论的轮次」——replied/ignored/silent/anyway/yielded/error/busy-cwd；
 * noop（全是自己的消息）/ skipped（崩溃窗口自愈，回复用户本来可见）/ busy（瞬态，driver 重试）
 * 不记，避免噪声淹没面板。busy-cwd 保留：02 并发症状的诊断信号。
 *
 * ring cap：每 agent 保留最近 ROUND_LOG_RETAIN 轮，超出删旧（可观测页展示再加 LIMIT 收口）。
 * 写失败（如成员已软删导致外键拒绝）不阻塞轮次本身：记 warn 后静默。
 */

export const ROUND_LOG_RETAIN = 200;
export const ROUND_LOG_LIST_LIMIT = 50;

/**
 * 轮次记录的**出线形状**（camelCase，createdAt 为 ISO）：与同一载荷里的 timeline
 * 同形（D2）。`listRoundLogs` 把数据层的 `RoundLogRow`（snake_case）翻译成它再出线——
 * 面板曾按 camelCase 读 snake_case 行，三个字段全 undefined（空白 target、光秃秃的
 * `#`、"Invalid Date"）。写路径 `logRoundOutcome` 仍返回数据层行（生产路径不消费其返回值）。
 */
export interface RoundLogView {
  id: string;
  targetId: string;
  status: RoundLogRow["status"];
  reason: string;
  baseSeq: number;
  /** ISO 8601（`insertRoundLog` 写入 `new Date().toISOString()`）。 */
  createdAt: string;
}

function toRoundLogView(row: RoundLogRow): RoundLogView {
  return {
    id: row.id,
    targetId: row.target_id,
    status: row.status,
    reason: row.reason,
    baseSeq: row.base_seq,
    createdAt: row.created_at,
  };
}

export interface RoundOutcomeLike {
  status: string;
  reason?: string;
  baseSeq?: number;
}

const LOGGED_STATUSES: ReadonlySet<string> = new Set([
  "replied",
  "ignored",
  "silent",
  "anyway",
  "yielded",
  "error",
  "busy-cwd",
]);

export function logRoundOutcome(
  agentId: string,
  targetId: string,
  outcome: RoundOutcomeLike,
): RoundLogRow | null {
  if (!LOGGED_STATUSES.has(outcome.status)) return null;
  try {
    const row = getDb().insertRoundLog({
      agentId,
      targetId,
      status: outcome.status as RoundLogRow["status"],
      reason: outcome.reason ?? "",
      baseSeq: outcome.baseSeq ?? 0,
    });
    getDb().pruneRoundLogs(agentId, ROUND_LOG_RETAIN);
    return row;
  } catch (error) {
    console.warn(
      "[worksplice] round log write failed:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

export function listRoundLogs(agentId: string, limit = ROUND_LOG_LIST_LIMIT): RoundLogView[] {
  return getDb()
    .listRoundLogs(agentId, limit)
    .map(toRoundLogView);
}

// ---------------------------------------------------------------------------
// §09 「未回复（已放弃）」标记：从 round_logs 派生的消息流即时标记。
// ---------------------------------------------------------------------------

/**
 * 判定一轮是否「已放弃」：badge 语义 = 「这轮到此为止，别再等」。
 * - silent：终止性收口——revised to ignore（ackSeq 已推进）/ retries exhausted /
 *   私密频道非成员等，不会再来 → 算
 * - error + reason 带 `capped at N`：cap-ack（05 逃逸口，游标已推进）→ 算
 * - 普通 error：会话失败，下次 wake 重试 → 不算（11-整改：revised 空内容归为 error
 *   即属此类——不再被标成「已放弃」，badge 不谎报会重试的轮次）
 * - busy-cwd：driver 等占用会话 settle 后重试（02）→ 不算
 * - yielded：任务让路，续工会再来 → 不算
 * - ignored：05 正常协议选择 → 不算（07 决策：ignore 仅可观测页可见）
 */
export function isAbandonedRound(row: Pick<RoundLogRow, "status" | "reason">): boolean {
  if (row.status === "silent") return true;
  return row.status === "error" && /capped at \d+/.test(row.reason);
}

export interface AbandonedMark {
  agentId: string;
  agentName: string;
  reason: string;
  /** 锚定消息 = 该 target 内 seq == baseSeq 的消息（base_seq 是持久化事实）。 */
  baseSeq: number;
  createdAt: string;
}

/**
 * §09 某 target 的「已放弃」标记：每 agent 只看其该 target 的**最新一轮**——
 * 最新轮是已放弃才标，之后任何轮（replied/ignored/error/…）都清除标记（等待已解除）。
 * 派生自 round_logs，ring cap 200 裁掉旧行 = 标记自然消失，无需专门表。
 */
export function listAbandonedMarks(targetId: string): AbandonedMark[] {
  const rows = getDb().listRoundLogsByTarget(targetId);
  const marks: AbandonedMark[] = [];
  const seenAgents = new Set<string>();
  for (const row of rows) {
    if (seenAgents.has(row.agent_id)) continue;
    seenAgents.add(row.agent_id);
    if (!isAbandonedRound(row)) continue;
    const member = getMember(row.agent_id);
    marks.push({
      agentId: row.agent_id,
      agentName: member?.name ?? row.agent_id,
      reason: row.reason,
      baseSeq: row.base_seq,
      createdAt: row.created_at,
    });
  }
  return marks;
}
