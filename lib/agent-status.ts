import { listAgents, getMember, setAgentStatus } from "./domain/collab/index.ts";
import type { MemberRow, MemberStatus } from "./data/types.ts";

/**
 * agent 状态点（§3.6）的进程内事实来源 + 广播器。
 *
 * 规则：
 * - wrapper 存活 → 现场推导（working = 正在干活 / online = 空闲可响应）；
 * - wrapper 不在（idle 10 分钟 shutdown、重启、应用启动）→ 回落 DB：
 *   error 保留（会话错误直到重启才清除），online/working 视为过期 → offline。
 * - 删除身份后该成员不再出现在快照里（状态点消失）。
 */

type StatusSnapshot = Record<string, MemberStatus>;
type ErrorSnapshot = Record<string, string>;
type StatusLookup = (member: MemberRow) => MemberStatus | null;
type StatusListener = (statuses: StatusSnapshot, errors: ErrorSnapshot) => void;

declare global {
  var __workspliceAgentStatusListeners: Set<StatusListener> | undefined;
  var __workspliceAgentStatusLookup: StatusLookup | null | undefined;
  var __workspliceAgentStatusLastSnapshot: string | undefined;
  var __workspliceAgentStatusSweeper: ReturnType<typeof setInterval> | undefined;
}

function getListeners(): Set<StatusListener> {
  if (!globalThis.__workspliceAgentStatusListeners) {
    globalThis.__workspliceAgentStatusListeners = new Set();
  }
  return globalThis.__workspliceAgentStatusListeners;
}

function getStatusLookup(): StatusLookup | null {
  return globalThis.__workspliceAgentStatusLookup ?? null;
}

/** 现场状态推导器（agent-runtime 注册真实实现；测试注入 fake）。 */
export function setAgentStatusLookup(lookup: StatusLookup | null): void {
  globalThis.__workspliceAgentStatusLookup = lookup;
}

export function subscribeAgentStatuses(
  listener: StatusListener,
): () => void {
  const listeners = getListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 快照 = 所有未删除 agent 成员的最新状态 + 当前有效 error 的具体文本。
 * errors 只收录「有效状态为 error 且 last_error 非空」的成员——error 但无文本时
 * 不编造占位（详情面板同样不显示占位文案）。
 */
function computeAgentStatusState(): {
  statuses: StatusSnapshot;
  errors: ErrorSnapshot;
} {
  const statuses: StatusSnapshot = {};
  const errors: ErrorSnapshot = {};
  for (const member of listAgents()) {
    const live = getStatusLookup()?.(member) ?? null;
    const status = live ?? (member.status === "error" ? "error" : "offline");
    statuses[member.id] = status;
    if (status !== "error") continue;
    const lastError =
      typeof member.last_error === "string" ? member.last_error.trim() : "";
    if (lastError) errors[member.id] = lastError;
  }
  return { statuses, errors };
}

/** 既有调用方兼容：仍只返回 { memberId: status }。 */
export function getAgentStatusSnapshot(): StatusSnapshot {
  return computeAgentStatusState().statuses;
}

/** 与状态快照同源的错误快照：{ memberId: last_error }（仅当前有效 error）。 */
export function getAgentErrorSnapshot(): ErrorSnapshot {
  return computeAgentStatusState().errors;
}

/** 状态变化（持久化 + 广播）；值未变则不重复广播。删除身份后不再发布（状态点消失）。 */
export function publishAgentStatus(
  memberId: string,
  status: MemberStatus,
  lastError?: string | null,
): void {
  const member = getMember(memberId);
  if (!member || member.type !== "agent" || member.deleted === 1) return;
  setAgentStatus(memberId, status, lastError);
  broadcastIfChanged();
}

function broadcastIfChanged(): void {
  const { statuses, errors } = computeAgentStatusState();
  // 同为 error 但错误文本变化也必须推送：去重键包含 errors，不只比 statuses。
  const serialized = JSON.stringify({ statuses, errors });
  if (serialized === globalThis.__workspliceAgentStatusLastSnapshot) return;
  globalThis.__workspliceAgentStatusLastSnapshot = serialized;
  for (const listener of getListeners()) {
    try {
      listener(statuses, errors);
    } catch {
      // 忽略单个订阅者错误
    }
  }
}

/**
 * 低频扫掠：捕捉 idle shutdown / 进程外变化导致的派生状态漂移
 * （wrapper 死后无事件，但快照推导应回落到 offline）。
 */
export function startAgentStatusSweeper(intervalMs = 10_000): void {
  if (globalThis.__workspliceAgentStatusSweeper) return;
  globalThis.__workspliceAgentStatusSweeper = setInterval(broadcastIfChanged, intervalMs);
}

export function stopAgentStatusSweeper(): void {
  if (globalThis.__workspliceAgentStatusSweeper) {
    clearInterval(globalThis.__workspliceAgentStatusSweeper);
    globalThis.__workspliceAgentStatusSweeper = undefined;
  }
}
