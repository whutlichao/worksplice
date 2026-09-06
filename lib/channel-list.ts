import type { ChannelWithMeta } from "@/components/ChannelView";

/** 频道行浅比较：字段全等时复用旧对象引用，避免下游 useCallback/useEffect 连锁重建。
 *  messageCount（DM 懒创建「有消息」信号）纳入比较——新消息入流后侧栏 DM 分组
 *  与按钮文案需随它更新。 */
export function shallowEqualChannel(
  a: ChannelWithMeta,
  b: ChannelWithMeta,
): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.type === b.type &&
    a.description === b.description &&
    a.archived === b.archived &&
    a.created_at === b.created_at &&
    a.joined === b.joined &&
    a.memberCount === b.memberCount &&
    a.unread === b.unread &&
    a.messageCount === b.messageCount
  );
}

/** 频道列表合并（AppShell.load 用）：整体替换 + 未变更行保持对象引用。
 *
 * 引用稳定是铁律：保持未变更行的对象引用，避免 ChannelView 因 channel prop
 * 引用变化而重建 loader（切换频道闪动两轮请求）。messageCount 变更（如 owner
 * 发送消息后 DM 的「有消息」信号 0→1）必然产生新行对象 → 侧栏私信分组与
 * 按钮文案随之更新。 */
export function mergeChannelRows(
  prev: ChannelWithMeta[],
  fresh: ChannelWithMeta[],
): ChannelWithMeta[] {
  if (prev.length === 0) return fresh;
  const byId = new Map(prev.map((c) => [c.id, c]));
  let changed = fresh.length !== prev.length;
  const next = fresh.map((row) => {
    const old = byId.get(row.id);
    if (old && shallowEqualChannel(old, row)) return old;
    changed = true;
    return row;
  });
  return changed ? next : prev;
}
