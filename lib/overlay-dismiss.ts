/**
 * 弹层关场判定层（票 #288）。
 *
 * 与 `lib/modal-focus.ts` 同一分层：**规则**是纯函数，零 DOM / 零 React，
 * 由 `lib/overlay-dismiss.test.mjs` 在 node 里钉住；**接线**（挂监听、读 DOM、
 * 归还焦点）只在 `hooks/useDismissableOverlay.ts`。四处弹层共用这一份判定，
 * 不再各自手写「点外 / Escape」。
 */

/**
 * 哪些键代表「关闭弹层」。只认 Escape：Tab 是键盘序、Enter 是控件激活，
 * 都不该被弹层顺手吃掉。
 */
export function dismissKey(key: string): boolean {
  return key === "Escape";
}

/** 判定所需的最小节点面：真实 DOM Node 与无 DOM 单测替身都满足。 */
export interface ContainsTarget<T> {
  contains(target: T): boolean;
}

/**
 * 事件目标是否落在所有边界（弹层 / 触发器 / 相对定位外壳）之外。
 *
 * - `target` 缺失（null / undefined）：没有证据就不关，返回 false；
 * - 边界里的空引用直接跳过（触发器 ref 尚未挂上时不抛错）；
 * - 任一节点包含目标即视为「内部」，返回 false。
 */
export function isOutsideTarget<T>(
  target: T | null | undefined,
  nodes: ReadonlyArray<ContainsTarget<T> | null | undefined>,
): boolean {
  if (target === null || target === undefined) return false;
  for (const node of nodes) {
    if (node?.contains(target)) return false;
  }
  return true;
}
