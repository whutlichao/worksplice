"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { BrutalModal } from "./BrutalModal";
import { OWNER_MEMBER_ID } from "@/lib/data/schema";

/**
 * 提醒设置/管理弹窗（§5.6 UI 入口：对消息/thread/channel 设置提醒）。
 * - 创建：title + fire_at（datetime-local）+ recurrence DSL（预设 chips 或手输）；
 * - 管理：列出锚定在该 target 的提醒，scheduled 可 snooze（15m）/ cancel；
 * - 触发后的系统消息自然落入消息流（轮询合并可见，§5.4 demo）。
 */

interface ReminderView {
  id: string;
  title: string;
  fire_at: string;
  recurrence: string | null;
  target_id: string | null;
  author_id: string;
  status: "scheduled" | "fired" | "canceled";
  created_at: string;
}

const RECURRENCE_PRESETS = [
  "every:1m",
  "every:15m",
  "every:2h",
  "every:1d",
  "daily@09:00",
  "weekly:mon,fri@09:00",
];

const INK = "#141111";

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "7px 9px",
  fontFamily: "var(--font-hanken)",
  fontSize: 13,
  border: `2px solid ${INK}`,
  background: "#ffffff",
  color: "var(--text)",
};

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatFireAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ReminderModal({
  targetId,
  targetLabel,
  defaultTitle,
  channelId,
  onClose,
  onChanged,
}: {
  targetId: string;
  targetLabel: string;
  defaultTitle?: string;
  channelId: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [fireAt, setFireAt] = useState(() => {
    const next = new Date(Date.now() + 60 * 60 * 1000);
    return toLocalInputValue(next.toISOString());
  });
  const [recurrence, setRecurrence] = useState("");
  const [authorId, setAuthorId] = useState(OWNER_MEMBER_ID);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [reminders, setReminders] = useState<ReminderView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    void fetch(`/api/reminders?targetId=${encodeURIComponent(targetId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET reminders: ${res.status}`);
        const body = (await res.json()) as { reminders?: ReminderView[] };
        setReminders(body.reminders ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [targetId]);

  useEffect(() => {
    load();
  }, [load]);

  // §3.9 "唤醒作者本人"：作者 = 当前用户（Owner）或 channel 内的 agent（替 agent 设，仅 Owner）
  useEffect(() => {
    void fetch(`/api/channels/${encodeURIComponent(channelId)}/members`)
      .then(async (res) => {
        if (!res.ok) return;
        const body = (await res.json()) as { members?: Array<{ id: string; type: string; name: string }> };
        setAgents((body.members ?? []).filter((m) => m.type === "agent"));
      })
      .catch(() => undefined);
  }, [channelId]);

  const submitCreate = () => {
    if (busy) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle || !fireAt) {
      setError(t("reminders.fireAtRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    void fetch("/api/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: trimmedTitle,
        fireAt: new Date(fireAt).toISOString(),
        recurrence: recurrence.trim() || undefined,
        targetId,
        authorId,
      }),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(body.error ?? `POST reminders: ${res.status}`);
        setTitle("");
        setRecurrence("");
        setNotice(t("reminders.created"));
        onChanged?.();
        load();
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const runAction = (reminder: ReminderView, action: "snooze" | "cancel") => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    void fetch(`/api/reminders/${encodeURIComponent(reminder.id)}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: action === "snooze" ? JSON.stringify({ minutes: 15 }) : undefined,
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(body.error ?? `${action} failed`);
        setNotice(action === "snooze" ? t("reminders.snoozed") : t("reminders.canceled"));
        load();
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const chipStyle = (active: boolean): React.CSSProperties => ({
    padding: "3px 8px",
    fontFamily: "var(--font-space-mono)",
    fontSize: 11,
    background: active ? "var(--yellow)" : "#ffffff",
    color: "var(--text)",
    border: `2px solid ${INK}`,
    cursor: "pointer",
  });

  return (
    <BrutalModal
      title={t("reminders.set")}
      onClose={onClose}
      width={460}
    >
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <span style={{ fontWeight: 700 }}>{t("reminders.for")}</span>
          <span
            style={{
              fontFamily: "var(--font-space-mono)",
              fontSize: 12,
              padding: "2px 7px",
              border: `2px solid ${INK}`,
              background: "var(--cyan)",
            }}
          >
            {targetLabel}
          </span>
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 700 }}>
          {t("reminders.forWhom")}
          <select
            value={authorId}
            onChange={(e) => setAuthorId(e.target.value)}
            style={inputStyle}
          >
            <option value={OWNER_MEMBER_ID}>{t("reminders.owner")}</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                @{agent.name}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 700 }}>
          {t("reminders.titleField")}
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("reminders.titlePlaceholder")}
            style={inputStyle}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 700 }}>
          {t("reminders.fireAt")}
          <input
            type="datetime-local"
            value={fireAt}
            onChange={(e) => setFireAt(e.target.value)}
            style={{ ...inputStyle, fontFamily: "var(--font-space-mono)" }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 700 }}>
          {t("reminders.recurrence")}
          <input
            type="text"
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value)}
            placeholder="every:15m / daily@09:00 / weekly:mon,fri@09:00"
            style={{ ...inputStyle, fontFamily: "var(--font-space-mono)" }}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {RECURRENCE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                style={chipStyle(recurrence === preset)}
                onClick={() => setRecurrence((prev) => (prev === preset ? "" : preset))}
              >
                {preset}
              </button>
            ))}
          </div>
        </label>

        {error && (
          <div
            style={{
              padding: "7px 10px",
              background: "#ffe3df",
              border: `2px solid ${INK}`,
              fontSize: 12,
              color: "var(--coral)",
            }}
          >
            {error}
          </div>
        )}
        {notice && (
          <div
            style={{
              padding: "7px 10px",
              background: "#e4f7e9",
              border: `2px solid ${INK}`,
              fontSize: 12,
            }}
          >
            {notice}
          </div>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={submitCreate}
          style={{
            alignSelf: "flex-start",
            padding: "7px 16px",
            fontFamily: "var(--font-hanken)",
            fontWeight: 700,
            fontSize: 13,
            background: "var(--pink)",
            color: "var(--text)",
            border: `2px solid ${INK}`,
            boxShadow: "3px 3px 0 0 rgba(20, 17, 17, 0.4)",
            cursor: "pointer",
          }}
        >
          {t("reminders.create")}
        </button>

        <div style={{ borderTop: `2px solid ${INK}`, paddingTop: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
            {t("reminders.existing")}
          </div>
          {reminders.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("reminders.empty")}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {reminders.map((reminder) => (
                <div
                  key={reminder.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 8px",
                    background: "#fffaef",
                    border: `2px solid ${INK}`,
                    fontSize: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {reminder.title}
                  </span>
                  <span style={{ fontFamily: "var(--font-space-mono)", fontSize: 11, color: "var(--text-muted)" }}>
                    {formatFireAt(reminder.fire_at)}
                  </span>
                  {reminder.recurrence && (
                    <span style={{ fontFamily: "var(--font-space-mono)", fontSize: 10, padding: "1px 5px", border: `2px solid ${INK}`, background: "var(--yellow)" }}>
                      {reminder.recurrence}
                    </span>
                  )}
                  <span style={{ fontFamily: "var(--font-space-mono)", fontSize: 10, padding: "1px 5px", border: `2px solid ${INK}`, background: reminder.status === "scheduled" ? "var(--lime)" : "#c9c7c2" }}>
                    {t(`reminders.status.${reminder.status}`)}
                  </span>
                  {reminder.status === "scheduled" && (
                    <>
                      <button
                        type="button"
                        onClick={() => runAction(reminder, "snooze")}
                        style={{ marginLeft: "auto", padding: "2px 7px", fontFamily: "var(--font-hanken)", fontWeight: 700, fontSize: 11, border: `2px solid ${INK}`, background: "#ffffff", cursor: "pointer" }}
                      >
                        {t("reminders.snooze")}
                      </button>
                      <button
                        type="button"
                        onClick={() => runAction(reminder, "cancel")}
                        style={{ padding: "2px 7px", fontFamily: "var(--font-hanken)", fontWeight: 700, fontSize: 11, border: `2px solid ${INK}`, background: "#ffffff", cursor: "pointer" }}
                      >
                        {t("reminders.cancel")}
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </BrutalModal>
  );
}
