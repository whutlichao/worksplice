/**
 * 面板转移规则（ticket 13）：中央（频道）与面板（agent | human | thread）状态解耦后的纯状态模块。
 *
 * 面板是"非长驻单槽 dock"：任何内容互斥（单槽替换），关闭即 null，
 * 切换频道即清空（面板与中央频道无耦合——线程打开时中央保持当前频道）。
 *
 * 除转移外，本模块还持有一条跨面板/中央的规则：
 * - `memberPanel`：mention/成员入口 → 面板内容的映射（agent 与人类走同一容器）。
 *
 * 纯函数、无副作用、无事件总线，AppShell 仅消费这里导出的规则。
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
