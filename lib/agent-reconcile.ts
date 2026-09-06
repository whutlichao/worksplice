import type { MemberRow } from "@/lib/data/types";

/**
 * 左栏 agent 成员列表的合并 + 变更检测（纯函数，便于 jiti 单测）。
 *
 * Susan（秘书 agent）走 HTTP API（POST /api/members → createAgent）代办创建 agent
 * 时，前端 React 进程不感知（不经 CreateAgentModal onCreated），agents 列表原先只在
 * mount/refreshKey 变化时拉取——于是新 agent 既不进左栏列表，也不进频道成员列表。
 * 本模块承载 15s 轮询的决策面：
 *
 * - **引用稳定**：字段全等（`shallowEqualAgent`）时复用旧行对象，避免 agent 行无谓重渲染；
 * - **变更检测**：`prev` 与 `incoming` 的成员 id 集合不一致（新增/删除）→ `membersChanged=true`，
 *   调用方据此 `setMembersVersion` 递增，驱动 `useChannelData` 的 membersVersion→loadMembers
 *   重拉，让频道成员列表/成员面板/@ 候选收敛（SSE 状态点变化不算成员集合变化，不误触发）。
 */

/** 列表合并用的浅比较：身份相关字段全等时复用旧对象引用，避免下游 useCallback/useEffect 连锁重建。 */
export function shallowEqualAgent(a: MemberRow, b: MemberRow): boolean {
  return (
    a.id === b.id &&
    a.type === b.type &&
    a.name === b.name &&
    a.description === b.description &&
    a.status === b.status &&
    a.workspace_path === b.workspace_path &&
    a.pi_session_file === b.pi_session_file &&
    a.created_at === b.created_at
  );
}

/**
 * 合并全量 agent 列表并检测成员 id 集合变化。
 *
 * @returns `agents`：合并后的列表（未变更行复用旧引用；首载直接返回 `incoming`）。
 *   `membersChanged`：成员 id 集合是否变化（新增/删除成员）——调用方据此递增 membersVersion。
 */
export function reconcileAgents(
  prev: MemberRow[],
  incoming: MemberRow[],
): { agents: MemberRow[]; membersChanged: boolean } {
  if (prev.length === 0) {
    return { agents: incoming, membersChanged: incoming.length > 0 };
  }
  const byId = new Map(prev.map((a) => [a.id, a]));
  let changed = incoming.length !== prev.length;
  const next = incoming.map((row) => {
    const old = byId.get(row.id);
    if (old && shallowEqualAgent(old, row)) return old;
    changed = true;
    return row;
  });
  // 成员集合变化 = 数量变化，或有 prev 中不存在的 id（同数量下的成员替换/删除并存）。
  // 字段级变化（如状态点）不在此列——membersVersion 只驱动"成员集合"重拉。
  const membersChanged =
    incoming.length !== prev.length ||
    incoming.some((row) => !byId.has(row.id));
  return { agents: changed ? next : prev, membersChanged };
}
