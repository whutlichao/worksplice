"use client";

import { useI18n } from "@/hooks/useI18n";

export function ProjectTrustDialog({
  cwd,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  cwd: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "color-mix(in oklch, var(--fg) 40%, transparent)",
      }}
      onClick={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-trust-title"
        style={{
          width: "var(--modal-max)",
          maxWidth: "100%",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-md)",
          background: "var(--panel)",
          boxShadow: "var(--shadow-pop)",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", gap: 12, padding: "18px 18px 14px" }}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ flexShrink: 0, marginTop: 1, color: "var(--working-text)" }}
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
          <div style={{ minWidth: 0 }}>
            <div id="project-trust-title" style={{ fontSize: "var(--fs-title)", fontWeight: 700, color: "var(--fg)" }}>
              {t("trust.dialogTitle")}
            </div>
            <div style={{ marginTop: 7, fontSize: "var(--fs-sm)", lineHeight: 1.6, color: "var(--muted)" }}>
              {t("trust.dialogBody")}
            </div>
            <code
              style={{
                display: "block",
                marginTop: 10,
                padding: "8px 10px",
                border: "1px solid var(--border)",
                borderRadius: "var(--r-sm)",
                background: "var(--bg)",
                color: "var(--fg)",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-caption)",
                overflowWrap: "anywhere",
              }}
            >
              {cwd}
            </code>
            {error && (
              <div role="alert" style={{ marginTop: 10, color: "var(--error)", fontSize: "var(--fs-sm)", lineHeight: 1.5 }}>
                {error}
              </div>
            )}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <button
            type="button"
            className="btn"
            onClick={onCancel}
            disabled={busy}
          >
            {t("trust.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? t("trust.trusting") : t("trust.trustProject")}
          </button>
        </div>
      </div>
    </div>
  );
}
