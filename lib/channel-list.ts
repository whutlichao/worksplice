import type { ChannelWithMeta } from "@/components/ChannelView";

/** 频道行浅比较：字段全等时复用旧对象引用，避免下游 useCallback/useEffect 连锁重建。
 *  messageCount（DM 懒创建「有消息」信号）与 unreadTaskCount（独立 Task 未读数）纳入比较，
 *  使各自的侧栏信号随服务端刷新更新。
 *
 *  chief / chiefSource / chiefAvailable（票 #251，接 #250 的遗留）：生效首席是服务端现算的
 *  结论，绑定换人 / 清空 / 频道首席失效回落全局时 `chief_member_id` 可能一字未变、只有结论变；
 *  可达性（本频道成员 + 未静音）也会独立翻转——不纳入比较就会复用旧行引用，composer 提示与
 *  成员视角继续显示过期结论。缺字段按「无 / 不可达」归一（旧行 / 测试构造器可能不带）。 */
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
    a.unreadTaskCount === b.unreadTaskCount &&
    a.messageCount === b.messageCount &&
    sameChief(a, b)
  );
}

/** 生效首席是同一结论（人 + 来源 + 对本频道是否可达）：改名 / 换人 / 绑定失效回落 /
 *  清空 / 可达性翻转（成员离场、频道被静音）任一变化都算不同——提示文案跟着变。 */
function sameChief(a: ChannelWithMeta, b: ChannelWithMeta): boolean {
  return (
    (a.chief?.id ?? null) === (b.chief?.id ?? null) &&
    (a.chief?.name ?? null) === (b.chief?.name ?? null) &&
    (a.chiefSource ?? "none") === (b.chiefSource ?? "none") &&
    (a.chiefAvailable === true) === (b.chiefAvailable === true)
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
