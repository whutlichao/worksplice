"use client";

import { useRef, useState } from "react";
import { Check } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { BrutalModal } from "./BrutalModal";
import { PixelAvatar } from "./PixelAvatar";
import { liveSusanMemberId, precheckSusanForPrivateChannel } from "@/lib/secretary-bootstrap";
import type { MemberRow } from "@/lib/data/types";

const FIELD_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: `1px solid var(--border)`,
  background: "#ffffff",
  color: "var(--fg)",
  fontFamily: "var(--font)",
  fontSize: 13,
  outline: "none",
};

const LABEL_STYLE: React.CSSProperties = {
  display: "block",
  fontFamily: "var(--mono)",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--muted)",
  margin: "12px 0 5px",
};

export function CreateChannelModal({
  agents,
  onClose,
  onCreated,
}: {
  agents: MemberRow[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [type, setType] = useState<"public" | "private">("public");
  const [description, setDescription] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // §7 新建私有频道默认预勾选 Susan（可取消）：活存 Susan 的 id；用户手动勾/取消过 Susan 后不再自动补。
  const susanId = liveSusanMemberId(agents);
  const susanTouchedRef = useRef(false);

  const canSubmit = name.trim().length > 0 && !busy;

  const selectType = (value: "public" | "private") => {
    setType(value);
    setMemberIds((prev) => precheckSusanForPrivateChannel(prev, value, susanId, susanTouchedRef.current));
  };

  const toggleMember = (id: string) => {
    if (id === susanId) susanTouchedRef.current = true;
    setMemberIds((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          type,
          description: description.trim(),
          memberIds,
        }),
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
              onClick={() => selectType(value)}
              style={{
                flex: 1,
                padding: "7px 10px",
                fontFamily: "var(--font)",
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
                background: type === value ? "var(--accent-soft)" : "var(--surface)",
                color: "var(--fg)",
                border: `1px solid var(--border)`,
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

        {agents.length > 0 && (
          <>
            <div style={LABEL_STYLE}>{t("channel.initialMembers")}</div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                maxHeight: 180,
                overflowY: "auto",
              }}
            >
              {agents.map((agent) => {
                const selected = memberIds.includes(agent.id);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => toggleMember(agent.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 8px",
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: "var(--font)",
                      fontSize: 13,
                      fontWeight: selected ? 700 : 500,
                      color: "var(--fg)",
                      background: selected ? "var(--accent-soft)" : "var(--surface)",
                      border: `1px solid var(--border)`,
                      boxShadow: selected ? "2px 2px 0 0 rgba(20, 17, 17, 0.4)" : "none",
                    }}
                  >
                    <PixelAvatar seed={agent.id} name={agent.name} size={28} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {agent.name}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 11,
                        color: selected ? "var(--fg)" : "var(--faint)",
                      }}
                    >
                      {selected ? <Check size={11} style={{ verticalAlign: "-2px" }} /> : "+"}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {error && (
          <div style={{ marginTop: 10, color: "var(--error)", fontSize: 12 }}>{error}</div>
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
              fontFamily: "var(--font)",
              fontWeight: 700,
              fontSize: 13,
              background: "#ffffff",
              color: "var(--fg)",
              border: `1px solid var(--border)`,
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
              fontFamily: "var(--font)",
              fontWeight: 700,
              fontSize: 13,
              background: "var(--accent)",
              color: "oklch(99% 0.01 256)",
              border: `1px solid var(--border)`,
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
