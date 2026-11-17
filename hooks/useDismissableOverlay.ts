"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefCallback } from "react";
import { dismissKey, isOutsideTarget } from "@/lib/overlay-dismiss";

export type OverlayDismissEvent =
  | "pointerdown"
  | "mousedown"
  | "click"
  | "contextmenu";

/**
 * 只读 ref：React 的 `RefObject<T>` 属性可变，`RefObject<HTMLButtonElement>`
 * 不能协变传给 `RefObject<HTMLElement>`；判定只需要读 `current`。
 */
export type OverlayElementRef = { readonly current: HTMLElement | null };

export interface UseDismissableOverlayOptions {
  open: boolean;
  onClose: () => void;
  /** 关闭后焦点归还的触发器（点开这一层的那一个元素）。 */
  triggerRef: OverlayElementRef;
  /**
   * 除弹层自身外也算「内部」的边界。用于包住触发器与弹层的相对定位外壳
   * （例如 `MessageActions` 的 `moreRef` / `actionsRef`），保持「点触发器
   * 由触发器自己 toggle」的既有行为。
   */
  boundaryRefs?: readonly OverlayElementRef[];
  /** 关场事件，默认 `pointerdown`；需要 `contextmenu` 的调用方显式追加。 */
  events?: OverlayDismissEvent | readonly OverlayDismissEvent[];
}

export interface DismissableOverlay<T extends HTMLElement = HTMLDivElement> {
  /**
   * 用 callback ref（而不是稳定的 `RefObject`）登记面板：菜单被条件卸载再
   * 挂载、但 `open` 没变时，effect 会随新节点重跑，不会把旧节点留在叠层栈里。
   */
  panelRef: RefCallback<T>;
  /**
   * 关闭这一层并把焦点还给触发器。所有显式关场路径（点外 / Escape /
   * 菜单项选中）都走这一处；先归位再关，触发器在弹层卸载前还可见。
   */
  dismiss: () => void;
}

/**
 * 当前挂着的弹层面板，按打开顺序排列。只有最上层响应 Escape / 点外：
 * EmojiPicker 叠在反应快捷条里时，关掉 picker 不会顺手收掉父层，
 * picker 的触发器（SmilePlus）因此仍在文档里，焦点才能真的回到它。
 */
const openPanels: HTMLElement[] = [];

function removePanel(panel: HTMLElement): void {
  const index = openPanels.lastIndexOf(panel);
  if (index !== -1) openPanels.splice(index, 1);
}

function topPanel(): HTMLElement | null {
  while (openPanels.length > 0) {
    const panel = openPanels[openPanels.length - 1];
    if (panel.isConnected) return panel;
    openPanels.pop();
  }
  return null;
}

const DEFAULT_DISMISS_EVENTS: readonly OverlayDismissEvent[] = ["pointerdown"];

function eventListOf(
  events: UseDismissableOverlayOptions["events"],
): readonly OverlayDismissEvent[] {
  if (events === undefined) return DEFAULT_DISMISS_EVENTS;
  return typeof events === "string" ? [events] : events;
}

/** 程序化归位也走 `:focus-visible`：动作栏不会因「指针焦点」再次 `display:none`。 */
function focusTrigger(trigger: HTMLElement | null): void {
  if (!trigger?.isConnected) return;
  trigger.focus({
    preventScroll: true,
    focusVisible: true,
  } as FocusOptions);
}

/**
 * 弹层关场 + 焦点归位的**接线层**（票 #288）。
 *
 * 分层：
 * - 规则（哪些键关、目标是否在边界外）= `lib/overlay-dismiss.ts` 的纯函数；
 * - 接线（document 监听、叠层顺序、归位）= 本 hook；
 * - 外壳（菜单内容 / 样式 / 视口坐标）= 各组件自己写，本 hook 不碰。
 *
 * `open=false` 时不挂监听；`dismiss` 先归位再调用 `onClose`，让「选中即关闭」
 * 与「点外 / Escape」共享同一条焦点路径。卸载 / 状态驱动关闭（非本 hook 发起）
 * 由 effect cleanup 兜底，但只在面板已离开文档时执行——StrictMode 的假卸载
 * 不会把焦点从刚打开的地方抢走。
 */
export function useDismissableOverlay<T extends HTMLElement = HTMLDivElement>(
  options: UseDismissableOverlayOptions,
): DismissableOverlay<T> {
  const [panel, setPanel] = useState<T | null>(null);
  const panelRef = useCallback<RefCallback<T>>((node) => {
    setPanel(node);
  }, []);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const restoreFocus = useCallback(() => {
    focusTrigger(optionsRef.current.triggerRef.current);
  }, []);

  const dismiss = useCallback(() => {
    restoreFocus();
    optionsRef.current.onClose();
  }, [restoreFocus]);

  const eventKey = eventListOf(options.events).join(",");

  useEffect(() => {
    if (!options.open || !panel) return;

    // StrictMode 的 setup 会重复入栈：先移除同一个面板，避免出现两个 token。
    removePanel(panel);
    openPanels.push(panel);

    const eventTypes = eventListOf(optionsRef.current.events);

    const onOutsideEvent = (event: Event) => {
      if (topPanel() !== panel) return;
      const target = event.target as Node | null;
      const boundaries = optionsRef.current.boundaryRefs ?? [];
      const nodes: Array<Node | null> = [
        panel,
        ...boundaries.map((ref) => ref.current),
      ];
      if (!isOutsideTarget<Node | null>(target, nodes)) return;
      // 指针的默认动作会在事件派发后把焦点交给被点元素（可能是输入框）；
      // 左键关场且触发器还在文档里时先压掉它，归位才不会被随后的默认聚焦覆盖。
      // 触发器已卸载时保持「不抢焦点」：不阻止被点元素自己的默认聚焦。
      if (event.type === "pointerdown" || event.type === "mousedown") {
        const trigger = optionsRef.current.triggerRef.current;
        if ((event as MouseEvent).button === 0 && trigger?.isConnected) {
          event.preventDefault();
        }
      }
      dismiss();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (topPanel() !== panel) return;
      if (!dismissKey(event.key)) return;
      dismiss();
    };

    for (const type of eventTypes) {
      document.addEventListener(type, onOutsideEvent as EventListener);
    }
    document.addEventListener("keydown", onKeyDown);

    return () => {
      removePanel(panel);
      for (const type of eventTypes) {
        document.removeEventListener(type, onOutsideEvent as EventListener);
      }
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [options.open, panel, eventKey, dismiss]);

  return { panelRef, dismiss };
}
