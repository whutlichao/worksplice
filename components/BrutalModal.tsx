"use client";

import { useModalFocus } from "@/hooks/useModalFocus";
import { DialogCloseButton } from "./DialogCloseButton";

/**
 * 模态外壳（票 08）：`.overlay`（scrim + blur）+ `.modal`（`--r-xl` + `--shadow-pop`）
 * + `.modal-head` / `.modal-body` / `.modal-foot`。形态在 globals.css 的模态族 class 块。
 *
 * 模块名与对外 props 保持（spec 组件表第 10 行：改名不产生视觉收益，不做）——
 * `width` 仅作**档位选择器**：旧稿是逐调用点尺寸（400 / 460 / 520），新契约只有两档
 * （`--modal-max` 440 / `--modal-wide-max` 560），故 `> 440` 走 `.modal.wide`。
 * 开关逻辑、backdrop 点击关闭、`role` / `aria-*` 一字不动；Esc 关闭与焦点陷阱
 * 由共享接线层 `hooks/useModalFocus.ts` 承担（界面评审残留 R1，票 03 收口）。
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
  const wide = width > MODAL_MAX_PX;
  /**
   * 焦点陷阱（界面评审残留 R1，票 03 收进共享接线层）：`role="dialog"` /
   * `aria-modal="true"` 只约束合规的读屏（AT），**不约束 Tab 序**。三件事全在
   * `hooks/useModalFocus.ts`：① 打开时移入焦点（子内容自带 `autoFocus` 时让给它）；
   * ② Tab / Shift+Tab 在边界回绕；③ 关闭时归还 opener。判定层是 `lib/modal-focus.ts`。
   * 本组件只负责 markup 与尺寸档位——配置浮层（820 / 860px）也消费同一层接线，
   * 所以宽度不能由接线层约定。
   */
  const dialogRef = useModalFocus<HTMLDivElement>(onClose);

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
          <DialogCloseButton onClose={onClose} />
        </div>
        {children}
      </div>
    </div>
  );
}
