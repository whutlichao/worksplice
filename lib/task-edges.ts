import type { TaskStatus } from "./data/types.ts";

/**
 * 任务动作边表（#275）：`from → to → { action, request, danger? }`。
 *
 * 这张表只回答「这条转移在卡片上长什么样、点击发什么请求」，**不回答「能不能做」**：
 * 可做性唯一来自服务端下发的 `TaskView.reachable`（`reachableStatuses`）。`TaskCard`
 * 把 `reachable` 逐项映射到本表，客户端不从本表反推可达性。
 *
 * 与服务端 `TRANSITIONS` 的双向一致性由
 * `lib/domain/collab/tasks.test.mjs` 锁定（`todo → in_progress` 的 claim 合成边
 * 在测试里显式声明为例外）。
 *
 * 零依赖 / client-safe：只 import 一个类型，不碰 Node 内置、DB 与 React。
 */
/** 卡片动作名 = 既有 i18n key 的后缀（`tasks.<action>`），本票不新增文案 key。 */
export type TaskAction =
  | "claim"
  | "complete"
  | "unclaim"
  | "close"
  | "approve"
  | "reject"
  | "reopen";

/** 动作对应的请求：claim 走独立操作，其余走 `update-status(to)`。 */
export type TaskRequest =
  | { kind: "claim" }
  | { kind: "updateStatus"; status: TaskStatus };

export interface TaskEdge {
  from: TaskStatus;
  to: TaskStatus;
  action: TaskAction;
  request: TaskRequest;
  /** 危险态动作（当前只有 close）：卡片走 `btn-danger` 并先经确认框。 */
  danger?: boolean;
}

export const TASK_EDGES: readonly TaskEdge[] = [
  // claim 是独立操作（claimTask），服务端 reachable 为 todo 合成这条边。
  {
    from: "todo",
    to: "in_progress",
    action: "claim",
    request: { kind: "claim" },
  },
  {
    from: "in_progress",
    to: "in_review",
    action: "complete",
    request: { kind: "updateStatus", status: "in_review" },
  },
  {
    from: "in_progress",
    to: "todo",
    action: "unclaim",
    request: { kind: "updateStatus", status: "todo" },
  },
  {
    from: "in_progress",
    to: "closed",
    action: "close",
    request: { kind: "updateStatus", status: "closed" },
    danger: true,
  },
  {
    from: "in_review",
    to: "done",
    action: "approve",
    request: { kind: "updateStatus", status: "done" },
  },
  {
    from: "in_review",
    to: "in_progress",
    action: "reject",
    request: { kind: "updateStatus", status: "in_progress" },
  },
  {
    from: "in_review",
    to: "closed",
    action: "close",
    request: { kind: "updateStatus", status: "closed" },
    danger: true,
  },
  {
    from: "done",
    to: "todo",
    action: "reopen",
    request: { kind: "updateStatus", status: "todo" },
  },
  {
    from: "closed",
    to: "todo",
    action: "reopen",
    request: { kind: "updateStatus", status: "todo" },
  },
];

/** 表中出现的动作名（去重，按表内顺序）。`taskOps` 的动作面从这里生成。 */
export const TASK_ACTIONS: readonly TaskAction[] = [
  ...new Set(TASK_EDGES.map((edge) => edge.action)),
];

/** 单条边的查表原语：不在表里返回 undefined（可达性仍由服务端裁决）。 */
export function taskEdgeFor(
  from: TaskStatus,
  to: TaskStatus,
): TaskEdge | undefined {
  return TASK_EDGES.find((edge) => edge.from === from && edge.to === to);
}

/** 服务端 reachable → 卡片动作边；保持服务端下发的顺序，未知落点不伪造动作。 */
export function taskEdgesForReachable(
  from: TaskStatus,
  reachable: readonly TaskStatus[],
): TaskEdge[] {
  return reachable.flatMap((to) => {
    const edge = taskEdgeFor(from, to);
    return edge ? [edge] : [];
  });
}

/** 动作名 → 请求（动作语义在表内只有一种请求）。 */
export function taskActionRequest(action: TaskAction): TaskRequest | undefined {
  return TASK_EDGES.find((edge) => edge.action === action)?.request;
}
