"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { collectTabbables, nextTabTarget } from "@/lib/modal-focus";

/**
 * 模态焦点管理的**接线层**（票 03，S2）。
 *
 * 分层：
 * - 规则（哪些元素进 Tab 序、边界回绕到谁）= `lib/modal-focus.ts` 的纯函数，
 *   由 `lib/modal-focus.test.mjs` 在 node 里钉住，不依赖 `window`；
 * - 接线（挂 keydown、读 DOM、移焦、归还焦点）= 本 hook，行为由 ego-browser 实测；
 * - 外壳（markup：`role="dialog"` / `aria-modal` / `tabIndex=-1` / 可访问名）各自组件自己写，
 *   **宽度也各自管**——本 hook 不碰尺寸，所以 440/560 两档的 `BrutalModal` 与自带
 *   820/860px 的两个配置浮层能共用同一层接线。
 *
 * 三个消费方：`BrutalModal`（创建频道 / 创建 agent / 提醒 / 任务关闭确认…）、
 * `ModelsConfig`、`SkillsConfig`（以及它们内部叠加的 `AddProviderPicker` 子对话框）。
 *
 * 选「焦点陷阱」而不是给兄弟内容打 `inert`：子树里有 `createPortal` 到 body 的选择器
 * （`DirectoryPicker`），`inert` 按 DOM 兄弟关系生效，会连 portal 内容一起禁掉；
 * 焦点陷阱天然不管背景里有什么，也不会误伤 portal：焦点在 portal 里时它在列表外，
 * 规则返回 null（组件侧再按「叠加 dialog」让路，见 `focusInChildDialog`）。
 */
export function useModalFocus<T extends HTMLElement = HTMLDivElement>(
  onClose: () => void,
): RefObject<T | null> {
  const dialogRef = useRef<T>(null);
  /**
   * 打开它的元素必须在**渲染期**记下：子内容的 `autoFocus`（创建频道名的输入框等）
   * 在 commit 阶段就抢走了焦点，等到 `useEffect` 里读 `document.activeElement`
   * 已经是对话框自己的控件——关闭时「归还焦点」就会落到 BODY。
   * 只抓第一次：`captured` 守卫防止后续重渲染（此时焦点已在对话框内）把自己的控件
   * 误记成 opener。
   */
  const openerRef = useRef<{ captured: boolean; element: HTMLElement | null }>({
    captured: false,
    element: null,
  });
  if (!openerRef.current.captured && typeof document !== "undefined") {
    const active = document.activeElement as HTMLElement | null;
    openerRef.current = {
      captured: true,
      element: active && active !== document.body ? active : null,
    };
  }

  /** 初始移焦只做一次：父级重渲染会让 effect 重跑（`onClose` 多为内联箭头），
   *  重复执行会把焦点从用户刚点到的地方（含叠加的子对话框）抢回首个控件。 */
  const initialFocusDoneRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = openerRef.current.element;

    // 打开后的初始焦点：子内容已经自己拿了焦点（`autoFocus`，与 React 的 commit
    // 顺序一致地先于本 effect）就不抢；否则落到对话框内首个可聚焦控件——本仓统一是
    // 头部关闭键（`BrutalModal` 的 `.modal-head`、两个配置浮层的标题栏同形）。
    if (!initialFocusDoneRef.current) {
      initialFocusDoneRef.current = true;
      if (!dialog.contains(document.activeElement)) {
        const [first] = collectTabbables(dialog);
        (first ?? dialog).focus();
      }
    }

    /**
     * 叠加的子对话框在场时让路：`AddProviderPicker` / `DirectoryPicker` 等子树不在本
     * 对话框的 DOM 里，但同样是 `role="dialog" aria-modal="true"`。判定必须看
     * 「**活动焦点**所在的那个 dialog 是不是我自己」——全局查 DOM 不行：自己就是
     * `[role=dialog][aria-modal=true]`，一查就把自己也算成子浮层。
     */
    const focusInChildDialog = () => {
      const active = document.activeElement as HTMLElement | null;
      const owner = active?.closest('[role="dialog"][aria-modal="true"]');
      return Boolean(owner && owner !== dialog);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // 叠加层自己处理 Escape（上层有它自己的 hook 实例）；下层不重复关闭。
        if (focusInChildDialog()) return;
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      if (focusInChildDialog()) return;
      const tabbables = collectTabbables(dialog);
      // 焦点不在对话框里（BODY、或背景某个控件）时按 `null` 交给规则层按方向拉进边界：
      // `document.activeElement` 在生产里恒非 null（无焦点时就是 body），直接传进去会
      // 命中 `indexOf === -1` 的「让浏览器自己走」分支，背景就会被 Tab 到。
      const activeElement = document.activeElement as HTMLElement | null;
      const active = dialog.contains(activeElement) ? activeElement : null;
      const next = nextTabTarget(tabbables, active, e.shiftKey);
      if (next === null) return;
      e.preventDefault();
      next.focus();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      // 关闭后焦点回打开它的元素。只在**真正的关闭**里归还：组件卸载时 React 已把
      // DOM 摘掉（`dialog.isConnected === false`）。effect 因依赖变化重跑时对话框
      // 仍在文档里——此时不动焦点：否则父级轮询触发的重渲染会把焦点从用户刚点到的
      // 地方（例如正文、背景）拽回 opener。
      if (!dialog.isConnected && opener && opener.isConnected) opener.focus();
    };
  }, [onClose]);

  return dialogRef;
}
