"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { BrutalModal } from "./BrutalModal";
import { DirectoryPicker } from "./DirectoryPicker";

const INK = "#141111";

const FIELD_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: `2px solid ${INK}`,
  background: "#ffffff",
  color: "var(--text)",
  fontFamily: "var(--font-space-grotesk)",
  fontSize: 13,
  outline: "none",
};

const LABEL_STYLE: React.CSSProperties = {
  display: "block",
  fontFamily: "var(--font-space-mono)",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  margin: "12px 0 5px",
};

export function CreateAgentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          workspacePath,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to create agent");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <BrutalModal title={t("agent.create")} onClose={onClose}>
      <div style={{ padding: "4px 16px 16px" }}>
        <label style={LABEL_STYLE} htmlFor="agent-name">
          {t("agent.name")}
        </label>
        <input
          id="agent-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          placeholder="bob"
          style={FIELD_STYLE}
          autoFocus
        />

        <label style={LABEL_STYLE} htmlFor="agent-description">
          {t("agent.description")}
        </label>
        <textarea
          id="agent-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          style={{ ...FIELD_STYLE, resize: "vertical" }}
        />

        <label style={LABEL_STYLE} htmlFor="agent-workspace">
          {t("agent.bindWorkspace")}
        </label>
        <div
          id="agent-workspace"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            border: `2px solid ${INK}`,
            background: "#ffffff",
          }}
        >
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: "var(--font-space-mono)",
              fontSize: 12,
              color: workspacePath ? "var(--text)" : "var(--text-dim)",
            }}
          >
            {workspacePath ?? t("agent.workspaceNotBound")}
          </span>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            style={{
              padding: "4px 10px",
              fontFamily: "var(--font-hanken)",
              fontWeight: 700,
              fontSize: 12,
              background: "#ffffff",
              color: "var(--text)",
              border: `2px solid ${INK}`,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {t("agent.pickWorkspace")}
          </button>
          {workspacePath && (
            <button
              type="button"
              onClick={() => setWorkspacePath(null)}
              aria-label={t("message.clearQuote")}
              title={t("message.clearQuote")}
              style={{
                padding: "4px 8px",
                fontFamily: "var(--font-hanken)",
                fontWeight: 700,
                fontSize: 12,
                background: "#ffffff",
                color: "var(--text)",
                border: `2px solid ${INK}`,
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          )}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-dim)" }}>
          {t("agent.workspaceHint")}
        </div>

        {error && (
          <div style={{ marginTop: 10, color: "var(--coral)", fontSize: 12 }}>{error}</div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 16,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 16px",
              fontFamily: "var(--font-hanken)",
              fontWeight: 700,
              fontSize: 13,
              background: "#ffffff",
              color: "var(--text)",
              border: `2px solid ${INK}`,
              cursor: "pointer",
            }}
          >
            {t("agent.cancel")}
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
            style={{
              padding: "8px 16px",
              fontFamily: "var(--font-hanken)",
              fontWeight: 700,
              fontSize: 13,
              background: "var(--pink)",
              color: "var(--ink)",
              border: `2px solid ${INK}`,
              boxShadow: "2px 2px 0 0 rgba(20, 17, 17, 0.45)",
              cursor: canSubmit ? "pointer" : "not-allowed",
              opacity: canSubmit ? 1 : 0.55,
            }}
          >
            {t("agent.create")}
          </button>
        </div>
      </div>

      {pickerOpen && (
        <DirectoryPicker
          onCancel={() => setPickerOpen(false)}
          onSelect={(path) => {
            setWorkspacePath(path);
            setPickerOpen(false);
          }}
        />
      )}
    </BrutalModal>
  );
}
