"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";

/** 马卡龙 × brutalist 模态框外壳：白卡片 + 2px ink 边框 + 硬偏移阴影 + 0 圆角（§4.2/§4.4）。 */
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      role="presentation"
      onClick={(e) => {
        // 只响应 backdrop 自身的点击；子组件（含 createPortal 到 body 的
        // DirectoryPicker 等）的点击沿 React 树冒泡到这里，ref.current.contains
        // 对 portal 内容恒为 false，会误关整个 modal。
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 600,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(20, 17, 17, 0.45)",
        padding: 24,
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width: "100%",
          maxWidth: width,
          maxHeight: "min(640px, 90dvh)",
          overflowY: "auto",
          background: "#ffffff",
          border: "2px solid var(--ink)",
          boxShadow: "6px 6px 0 0 rgba(20, 17, 17, 0.55)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "2px solid var(--ink)",
            background: "var(--yellow)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-hanken)",
              fontWeight: 700,
              fontSize: 15,
              color: "var(--text)",
            }}
          >
            {title}
          </span>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={onClose}
            style={{
              width: 26,
              height: 26,
              background: "#ffffff",
              border: "2px solid var(--ink)",
              boxShadow: "2px 2px 0 0 rgba(20, 17, 17, 0.45)",
              cursor: "pointer",
              color: "var(--text)",
              fontSize: 13,
              lineHeight: 1,
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.boxShadow = "1px 1px 0 0 rgba(20, 17, 17, 0.45)";
              e.currentTarget.style.transform = "translate(1px, 1px)";
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.boxShadow = "2px 2px 0 0 rgba(20, 17, 17, 0.45)";
              e.currentTarget.style.transform = "none";
            }}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
