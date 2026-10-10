"use client";

import { useRef, useState } from "react";
import { Check } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { BrutalModal } from "./BrutalModal";
import { Avatar } from "./Avatar";
import { liveSusanMemberId, precheckSusanForPrivateChannel } from "@/lib/secretary-bootstrap";
import type { MemberRow } from "@/lib/data/types";

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
    <BrutalModal title={t("channel.create")} onClose={onClose} width={520}>
      {/* 形态（票 08）：`.field` + `.input` / `.textarea` + `.radio-row` / `.radio-card`
          + `.member-pick` / `.member-opt`；动作收在 `.modal-foot`。逻辑与字段关联不动。 */}
      <div className="modal-body">
        <div className="field">
          <label htmlFor="channel-name">{t("channel.name")}</label>
          <input
            id="channel-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            placeholder="# general"
            autoFocus
          />
        </div>

        <div className="field">
          <label>{t("channel.type")}</label>
          <div className="radio-row">
            {(["public", "private"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => selectType(value)}
                className={type === value ? "radio-card is-on" : "radio-card"}
              >
                <b>{value === "public" ? t("channel.public") : t("channel.private")}</b>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="channel-description">{t("channel.description")}</label>
          <textarea
            id="channel-description"
            className="textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </div>

        {agents.length > 0 && (
          <div className="field">
            <label>{t("channel.initialMembers")}</label>
            <div className="member-pick">
              {agents.map((agent) => {
                const selected = memberIds.includes(agent.id);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => toggleMember(agent.id)}
                    className={selected ? "member-opt is-on" : "member-opt"}
                  >
                    <Avatar name={agent.name} size="sm" colorKey={agent.id} />
                    <span
                      style={{
                        maxWidth: 160,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {agent.name}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 11,
                        color: selected ? "var(--accent-deep)" : "var(--faint)",
                      }}
                    >
                      {selected ? <Check size={11} style={{ verticalAlign: "-2px" }} /> : "+"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 10, color: "var(--error)", fontSize: "var(--fs-sm)" }}>
            {error}
          </div>
        )}
      </div>

      <div className="modal-foot">
        <span className="sep" />
        <button type="button" className="btn" onClick={onClose}>
          {t("channel.cancel")}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          {t("channel.create")}
        </button>
      </div>
    </BrutalModal>
  );
}
