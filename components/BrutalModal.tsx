"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";

/**
 * 模态外壳（票 08）：`.overlay`（scrim + blur）+ `.modal`（`--r-xl` + `--shadow-pop`）
 * + `.modal-head` / `.modal-body` / `.modal-foot`。形态在 globals.css 的模态族 class 块。
 *
 * 模块名与对外 props 保持（spec 组件表第 10 行：改名不产生视觉收益，不做）——
 * `width` 仅作**档位选择器**：旧稿是逐调用点尺寸（400 / 460 / 520），新契约只有两档
 * （`--modal-max` 440 / `--modal-wide-max` 560），故 `> 440` 走 `.modal.wide`。
 * 开关逻辑、焦点陷阱期望、Esc 关闭、backdrop 点击关闭、`role` / `aria-*` 一字不动。
 */
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
  const wide = width > 440;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={wide ? "modal wide" : "modal"}
        // `.modal` 的 `overflow: hidden` 是上游形态；这里显式覆盖成整体纵向滚动，
        // 保住旧外壳「超高内容可滚动」的行为（形态改动不带行为回归）。
        style={{ maxHeight: "min(640px, 90dvh)", overflowY: "auto" }}
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
