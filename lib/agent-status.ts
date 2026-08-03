import { listAgents, getMember, setAgentStatus } from "./raft/members.ts";
import type { MemberRow, MemberStatus } from "./data/db.ts";

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
type StatusLookup = (member: MemberRow) => MemberStatus | null;

declare global {
  var __workspliceAgentStatusListeners: Set<(snapshot: StatusSnapshot) => void> | undefined;
  var __workspliceAgentStatusLookup: StatusLookup | null | undefined;
  var __workspliceAgentStatusLastSnapshot: string | undefined;
  var __workspliceAgentStatusSweeper: ReturnType<typeof setInterval> | undefined;
}

function getListeners(): Set<(snapshot: StatusSnapshot) => void> {
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
  listener: (snapshot: StatusSnapshot) => void,
): () => void {
  const listeners = getListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 快照 = 所有未删除 agent 成员的最新状态。 */
export function getAgentStatusSnapshot(): StatusSnapshot {
  const snapshot: StatusSnapshot = {};
  for (const member of listAgents()) {
    const live = getStatusLookup()?.(member) ?? null;
    if (live) {
      snapshot[member.id] = live;
      continue;
    }
    if (member.status === "error") {
      snapshot[member.id] = "error";
    } else {
      snapshot[member.id] = "offline";
    }
  }
  return snapshot;
}

/** 状态变化（持久化 + 广播）；值未变则不重复广播。删除身份后不再发布（状态点消失）。 */
export function publishAgentStatus(memberId: string, status: MemberStatus): void {
  const member = getMember(memberId);
  if (!member || member.type !== "agent" || member.deleted === 1) return;
  setAgentStatus(memberId, status);
  broadcastIfChanged();
}

function broadcastIfChanged(): void {
  const snapshot = getAgentStatusSnapshot();
  const serialized = JSON.stringify(snapshot);
  if (serialized === globalThis.__workspliceAgentStatusLastSnapshot) return;
  globalThis.__workspliceAgentStatusLastSnapshot = serialized;
  for (const listener of getListeners()) {
    try {
      listener(snapshot);
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
