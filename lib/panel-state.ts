/**
 * 面板转移规则（ticket 13）：中央（频道）与面板（agent | human | thread）状态解耦后的纯状态模块。
 *
 * 面板是"非长驻单槽 dock"：任何内容互斥（单槽替换），关闭即 null，
 * 切换频道即清空（面板与中央频道无耦合——线程打开时中央保持当前频道）。
 *
 * 除转移外，本模块还持有两条跨面板/中央的协调规则：
 * - `memberPanel`：mention/成员入口 → 面板内容的映射（agent 与人类走同一容器）；
 * - pinned 变更订阅：面板线程内的 pin/unpin 通知中央频道刷新（服务端事实，双端自洽）。
 *
 * 纯函数 + 极小事件订阅，无副作用，AppShell 仅消费这里导出的规则。
 */

export type PanelContent =
  | { kind: "agent"; id: string }
  | { kind: "human"; id: string }
  | { kind: "thread"; id: string }
  | null;

/** 成员入口 → 面板内容：人类与 agent 同走右栏（§3.2 mention / 成员面板共用）。 */
export function memberPanel(memberId: string, isHuman: boolean): NonNullable<PanelContent> {
  return isHuman ? { kind: "human", id: memberId } : { kind: "agent", id: memberId };
}

/** 单槽替换：任何内容互斥，id 透传；null 上打开正常。 */
export function openPanel(state: PanelContent, next: NonNullable<PanelContent>): PanelContent {
  void state;
  return next;
}

/** 关闭面板：null → null 幂等。 */
export function closePanel(_state: PanelContent): PanelContent {
  void _state;
  return null;
}

/** 切换频道：清空面板（线程草稿/分页/详情 in-flight 数据一并丢弃）。 */
export function onChannelSwitched(_state: PanelContent): PanelContent {
  void _state;
  return null;
}

// ---------------------------------------------------------------------------
// pinned 变更广播：面板线程内的 pin/unpin 是频道级操作（§3.5 个性化 pinned），
// 通知中央 ChannelView 重拉，双端都收敛到服务端事实。
// ---------------------------------------------------------------------------

type PinnedListener = () => void;

const pinnedListeners = new Set<PinnedListener>();

/** 订阅频道 pinned 变更（返回取消函数；ChannelView 挂载期订阅）。 */
export function subscribePinnedChanged(listener: PinnedListener): () => void {
  pinnedListeners.add(listener);
  return () => {
    pinnedListeners.delete(listener);
  };
}

/** 通知频道 pinned 变更（ThreadPanel pin/unpin 成功后调用）。 */
export function notifyPinnedChanged(): void {
  for (const listener of pinnedListeners) listener();
}
