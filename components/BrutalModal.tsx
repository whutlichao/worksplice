"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { collectTabbables, nextTabTarget } from "@/lib/modal-focus";

/**
 * 模态外壳（票 08）：`.overlay`（scrim + blur）+ `.modal`（`--r-xl` + `--shadow-pop`）
 * + `.modal-head` / `.modal-body` / `.modal-foot`。形态在 globals.css 的模态族 class 块。
 *
 * 模块名与对外 props 保持（spec 组件表第 10 行：改名不产生视觉收益，不做）——
 * `width` 仅作**档位选择器**：旧稿是逐调用点尺寸（400 / 460 / 520），新契约只有两档
 * （`--modal-max` 440 / `--modal-wide-max` 560），故 `> 440` 走 `.modal.wide`。
 * 开关逻辑、Esc 关闭、backdrop 点击关闭、`role` / `aria-*` 一字不动；
 * 焦点陷阱由界面评审残留票补齐（R1：打开移入 / Tab 回绕 / 关闭归还）。
 */
/** `--modal-max`（tokens.css）的 px 值：旧调用点的 width 是逐点尺寸（400/460/520），
 *  新契约只有两档，本常量只用来把旧值折成档位（对外 props 不变）。 */
const MODAL_MAX_PX = 440;

export function BrutalModal({
  title,
  onClose,
  children,
  width = 400,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  const { t } = useI18n();
  const wide = width > MODAL_MAX_PX;
  const dialogRef = useRef<HTMLDivElement>(null);
  /**
   * 打开它的元素必须在**渲染期**记下：子内容的 `autoFocus`（创建频道名的输入框等）
   * 在 commit 阶段就抢走了焦点，等到 `useEffect` 里读 `document.activeElement`
   * 已经是模态自己的控件——关闭时「归还焦点」就会落到 BODY。
   * 只抓第一次：`captured` 守卫防止后续重渲染（此时焦点已在模态内）把模态自己的控件
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

  /**
   * 焦点陷阱（界面评审残留 R1）：`role="dialog"` / `aria-modal="true"` 只约束合规的
   * 读屏（AT），**不约束 Tab 序**——打开后焦点留在触发的按钮上、背景仍可 Tab 进去、
   * 关闭后焦点丢到 BODY。这里三件事：
   * ① 打开时把焦点移进模态（首选 `.modal-head` 的关闭键；子内容自带 `autoFocus`
   *   （如 DirectoryPicker 的路径输入）时让给它）；
   * ② Tab / Shift+Tab 在边界回绕，背景不进 Tab 序；
   * ③ 关闭时把焦点还给打开它的元素。
   *
   * 选「焦点陷阱」而不是给兄弟内容打 `inert`：子树里有 `createPortal` 挂到 body 的
   * 选择器（`DirectoryPicker`），`inert` 按 DOM 兄弟关系生效，会连 portal 内容一起禁掉。
   * 焦点陷阱天然不管背景里有什么，也不会误伤 portal：焦点在 portal 里时它在列表外，
   * 规则返回 null（组件侧再按「嵌套 dialog」让路，见下）。
   */
  /** 初始移焦只做一次：父级重渲染会让 effect 重跑（`onClose` 多为内联箭头），
   *  重复执行会把焦点从用户刚点到的地方（含 portal 子浮层）抢回关闭键。 */
  const initialFocusDoneRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = openerRef.current.element;

    // 打开后的初始焦点：子内容已经自己拿了焦点（`autoFocus`，与 React 的 commit
    // 顺序一致地先于本 effect）就不抢；否则落到模态内首个可聚焦控件——本仓统一是
    // `.modal-head` 的关闭键。
    if (!initialFocusDoneRef.current) {
      initialFocusDoneRef.current = true;
      if (!dialog.contains(document.activeElement)) {
        const [closeButton] = collectTabbables(dialog);
        (closeButton ?? dialog).focus();
      }
    }

    /**
     * 子浮层在场时让路：`DirectoryPicker` 等 `createPortal` 到 body 的子树不在
     * `.modal` 的 DOM 里，但仍是 `role="dialog" aria-modal="true"`。判定必须看
     * 「**活动焦点**所在的那个 dialog 是不是我自己」——全局查 DOM 不行：`.modal`
     * 自己就是 `[role=dialog][aria-modal=true]`，一查就把自己也算成子浮层。
     */
    const focusInChildDialog = () => {
      const active = document.activeElement as HTMLElement | null;
      const owner = active?.closest('[role="dialog"][aria-modal="true"]');
      return Boolean(owner && owner !== dialog);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // 子浮层自己处理 Escape（DirectoryPicker 有自己的 onKeyDown）；父模态不再重复关闭。
        if (focusInChildDialog()) return;
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      if (focusInChildDialog()) return;
      const tabbables = collectTabbables(dialog);
      // 焦点不在模态里（BODY、或背景某个控件）时按 `null` 交给规则层按方向拉进边界：
      // `document.activeElement` 在生产里恒非 null（无焦点时就是 body），直接传进去会
      // 命中 `indexOf === -1` 的「让浏览器自己走」分支，背景就会被 Tab 到。
      const activeElement = document.activeElement as HTMLElement | null;
      const active = activeElement && dialog.contains(activeElement) ? activeElement : null;
      const next = nextTabTarget(tabbables, active, e.shiftKey);
      if (next === null) return;
      e.preventDefault();
      next.focus();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      // 关闭后焦点回打开它的按钮（界面评审残留 R1）。只在**真正的关闭**里归还：
      // 组件卸载时 React 已把 DOM 摘掉（`dialog.isConnected === false`）。
      // effect 因依赖变化重跑时对话框仍在文档里——此时不动焦点：否则父级轮询触发的
      // 重渲染会把焦点从用户刚点到的地方（例如正文、背景）拽回 opener。
      if (!dialog.isConnected && opener && opener.isConnected) opener.focus();
    };
  }, [onClose]);

  return (
    <div
      className="overlay"
      role="presentation"
      onClick={(e) => {
        // 只响应 backdrop 自身的点击；子组件（含 createPortal 到 body 的
        // DirectoryPicker 等）的点击沿 React 树冒泡到这里，ref.current.contains
        // 对 portal 内容恒为 false，会误关整个 modal。
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={wide ? "modal wide" : "modal"}
        // 程序化聚焦的兜底：模态内若一个可聚焦元素都没有，焦点落在对话框自身上。
        // `tabIndex={-1}` 不进 Tab 序，所以不会多出一个停靠点。
        tabIndex={-1}
        // `.modal` 的 `overflow: hidden` 是上游形态；这里显式覆盖成整体纵向滚动，
        // 保住旧外壳「超高内容可滚动」的行为（形态改动不带行为回归）。
        style={{ maxHeight: "min(640px, calc(100dvh - 2 * var(--sp-10)))", overflowY: "auto" }}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <X size={13} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
