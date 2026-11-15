import type { TaskHandoffState, TaskStatus } from "../../data/types.ts";

/**
 * 巡检的**判定层**（票 #267 / spec #265「首席作为路由者」的主动巡检）：纯函数、零 IO。
 * 时间、任务快照、上次上报签名全部由调用方注入——因此阈值两侧、7 天窗口、去重签名都能
 * 脱离数据库逐条测。投递与落点解析在接入层 `patrol-run.ts`。
 *
 * 巡检只**报告**已有任务的三类卡住状态：它不读消息内容、不建任务、不改任务状态。
 */

/** 未认领 `todo` 的卡住阈值（spec #265：30 分钟）。 */
export const PATROL_UNCLAIMED_TODO_MS = 30 * 60_000;

/** 分流卡住（`handoff_state = blocked`）的卡住阈值（spec #265：30 分钟）。 */
export const PATROL_HANDOFF_BLOCKED_MS = 30 * 60_000;

/** 待互审（`in_review`）的卡住阈值（spec #265：24 小时）。 */
export const PATROL_IN_REVIEW_MS = 24 * 60 * 60_000;

/**
 * 回看窗口（spec #265：只看最近 7 天内**创建**的任务）。按锚点消息时间算，不按任务行时间：
 * 一次状态变化会把 `updated_at` 推到今天，用后者生 7 天窗口会让历史旧账源源不断地回来。
 */
export const PATROL_WINDOW_MS = 7 * 24 * 60 * 60_000;

/** 发现种类的取值（`handoff_blocked` 与 `unclaimed_todo` 同阈值，但是两类不同的卡住）。 */
export type PatrolFindingKind = "unclaimed_todo" | "handoff_blocked" | "review_stale";

/** 判定层的任务快照：只含判定需要的列，不泄漏 TaskView 的读面（回复数 / 已读游标等）。 */
export interface PatrolTaskSnapshot {
  taskId: string;
  channelId: string;
  /** 频道名（汇总正文里的 `in #name`）：发现可跨频道，只给任务号会歧义。 */
  channelName: string;
  /** channel 内任务号（正文里的 `#N`）。 */
  number: number;
  status: TaskStatus;
  ownerId: string | null;
  handoffState: TaskHandoffState | null;
  /** 锚点消息创建时间：7 天窗口按它算（任务够不够「新」）。 */
  anchorCreatedAt: string;
  /** 任务行最后更新时间：卡住时长按它算（最近一次状态 / owner 变化）。 */
  updatedAt: string;
}

/** 一条发现：判定层的输出单位（接入层据此算签名、拼汇总）。 */
export interface PatrolFinding {
  kind: PatrolFindingKind;
  taskId: string;
  channelId: string;
  channelName: string;
  number: number;
  /** 卡住时长（`now - updatedAt`）：汇总正文用，**不进签名**（它每分钟都在变）。 */
  stalledMs: number;
}

/**
 * 发现明细摘要：签名与正文共用一处拼法。它描述的是**状态**（哪种卡住），不含时长——
 * 时长进签名会让去重永远失效（同一任务每分钟都“变了”）。
 */
function kindDetail(kind: PatrolFindingKind): string {
  switch (kind) {
    case "unclaimed_todo":
      return "todo unclaimed";
    case "handoff_blocked":
      return "todo (handoff blocked)";
    case "review_stale":
      return "in review";
  }
}

/**
 * 去重签名 = (任务, 状态, 详情摘要)。同一任务同一状态只报一次；状态变了签名就变，
 * 因此重新上报——不靠时间冷却（冷却会把“状态变了”一起吞掉，见 spec #265）。
 */
export function patrolSignatureOf(finding: {
  taskId: string;
  kind: PatrolFindingKind;
}): string {
  return `${finding.taskId}|${finding.kind}|${kindDetail(finding.kind)}`;
}

/** 卡住时长的可读形态（`31m` / `1h 20m` / `3d`）。 */
function formatStalled(stalledMs: number): string {
  const minutes = Math.floor(stalledMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  }
  return `${Math.floor(hours / 24)}d`;
}

/**
 * 汇总正文（**每轮最多一条**消息的正文；空发现返回 `null` = 完全沉默，不要“一切正常”）。
 * 英文硬编码：这是产品内容，会进房间、进模型上下文（`docs/i18n.md` 的分层规则）。
 */
export function buildPatrolSummary(findings: PatrolFinding[]): string | null {
  if (findings.length === 0) return null;
  const header = `Task patrol: ${findings.length} stalled task${findings.length === 1 ? "" : "s"}`;
  const lines = findings.map(
    (finding) =>
      `- #${finding.number} in #${finding.channelName}: ${kindDetail(finding.kind)} for ${formatStalled(finding.stalledMs)}`,
  );
  return [header, ...lines].join("\n");
}

/**
 * 单个任务属于哪类卡住（`null` = 没卡住）：判据顺序是承重的——`blocked` 的 todo 也是
 * 「未认领」，必须归到 `handoff_blocked` 一类，否则同一任务会以两种 kind 各报一次。
 * 三类都只看「仍在进行中的状态」：被认领 / 完成的旧 `handoff_state` 是历史，不是卡住
 * （`claimTask` 不清 `handoff_state`，所以这里必须同时看 `status`）。
 */
function stuckKind(task: PatrolTaskSnapshot, stalledMs: number): PatrolFindingKind | null {
  if (task.status === "todo") {
    if (task.handoffState === "blocked") {
      return stalledMs > PATROL_HANDOFF_BLOCKED_MS ? "handoff_blocked" : null;
    }
    if (task.ownerId === null) {
      return stalledMs > PATROL_UNCLAIMED_TODO_MS ? "unclaimed_todo" : null;
    }
  }
  if (task.status === "in_review") {
    return stalledMs > PATROL_IN_REVIEW_MS ? "review_stale" : null;
  }
  return null;
}

export function findPatrolFindings(input: {
  now: Date;
  tasks: PatrolTaskSnapshot[];
}): PatrolFinding[] {
  const nowMs = input.now.getTime();
  const findings: PatrolFinding[] = [];
  for (const task of input.tasks) {
    const createdMs = Date.parse(task.anchorCreatedAt);
    // 7 天窗口：更早的任务不进巡检（窗口内报出的历史任务属预期，不是 bug——见 spec #265）。
    if (!Number.isFinite(createdMs) || nowMs - createdMs > PATROL_WINDOW_MS) continue;
    const updatedMs = Date.parse(task.updatedAt);
    if (!Number.isFinite(updatedMs)) continue;
    const stalledMs = nowMs - updatedMs;
    const kind = stuckKind(task, stalledMs);
    if (!kind) continue;
    findings.push({
      kind,
      taskId: task.taskId,
      channelId: task.channelId,
      channelName: task.channelName,
      number: task.number,
      stalledMs,
    });
  }
  return findings;
}
