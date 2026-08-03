"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { BrutalModal } from "./BrutalModal";

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

export function CreateChannelModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [type, setType] = useState<"public" | "private">("public");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), type, description: description.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to create channel");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <BrutalModal title={t("channel.create")} onClose={onClose}>
      <div style={{ padding: "4px 16px 16px" }}>
        <label style={LABEL_STYLE} htmlFor="channel-name">
          {t("channel.name")}
        </label>
        <input
          id="channel-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          placeholder="# general"
          style={FIELD_STYLE}
          autoFocus
        />

        <div style={LABEL_STYLE}>{t("channel.type")}</div>
        <div style={{ display: "flex", gap: 8 }}>
          {(["public", "private"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setType(value)}
              style={{
                flex: 1,
                padding: "7px 10px",
                fontFamily: "var(--font-hanken)",
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
                background: type === value ? "var(--yellow)" : "#ffffff",
                color: "var(--text)",
                border: `2px solid ${INK}`,
                boxShadow: type === value ? "2px 2px 0 0 rgba(20, 17, 17, 0.45)" : "none",
              }}
            >
              {value === "public" ? t("channel.public") : t("channel.private")}
            </button>
          ))}
        </div>

        <label style={LABEL_STYLE} htmlFor="channel-description">
          {t("channel.description")}
        </label>
        <textarea
          id="channel-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          style={{ ...FIELD_STYLE, resize: "vertical" }}
        />

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
            {t("channel.cancel")}
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
            {t("channel.create")}
          </button>
        </div>
      </div>
    </BrutalModal>
  );
}
