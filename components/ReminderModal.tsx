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
 *
 * 形态（票 08）：`.modal-body` + `.modal-foot` + `.field` / `.input` / `.select`；
 * 既有提醒行取 `.kv` 形态（ReminderRow），cancel 是破坏性动作 → `.btn-danger`。
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

/**
 * 既有提醒的一行（票 08：`.kv` 形态 = 标题 + 下一次触发 mono + 状态胶囊 + 动作）。
 * 单独导出成渲染面：`renderToStaticMarkup` 不跑 effect，列表来自 fetch，渲染级断言
 * 只能从这里进入——与 CreateAgentModal 的 `ModelsEmptyHint` 同一条 seam。
 */
export function ReminderRow({
  reminder,
  onAction,
}: {
  reminder: ReminderView;
  onAction: (reminder: ReminderView, action: "snooze" | "cancel") => void;
}) {
  const { t } = useI18n();
  return (
    <div className="kv">
      <span className="k" style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {reminder.title}
        </span>
        {reminder.recurrence && (
          <span
            style={{
              flex: "0 0 auto",
              fontFamily: "var(--mono)",
              fontSize: "var(--fs-mono-xs)",
              padding: "1px 5px",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-sm)",
              background: "var(--panel-2)",
              color: "var(--muted)",
            }}
          >
            {reminder.recurrence}
          </span>
        )}
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, flex: "0 0 auto" }}>
        <span className="v">{formatFireAt(reminder.fire_at)}</span>
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: "var(--fs-mono-xs)",
            padding: "1px 5px",
            borderRadius: "var(--r-sm)",
            background: reminder.status === "scheduled" ? "var(--online-fill)" : "var(--offline-fill)",
            color: "var(--fg)",
          }}
        >
          {t(`reminders.status.${reminder.status}`)}
        </span>
        {reminder.status === "scheduled" && (
          <>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => onAction(reminder, "snooze")}
            >
              {t("reminders.snooze")}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => onAction(reminder, "cancel")}
            >
              {t("reminders.cancel")}
            </button>
          </>
        )}
      </span>
    </div>
  );
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

  // 紧凑 chip 行（ED-3：chip 用 --r-sm；ED-5：字号取标尺），选中 = accent 淡底 + accent 字/边（不是黄色实心）。
  const chipStyle = (active: boolean): React.CSSProperties => ({
    padding: "3px 8px",
    fontFamily: "var(--mono)",
    fontSize: "var(--fs-sm)",
    background: active ? "var(--accent-soft)" : "var(--surface)",
    color: active ? "var(--accent-deep)" : "var(--muted)",
    border: `1px solid ${active ? "var(--accent-graphic)" : "var(--border)"}`,
    borderRadius: "var(--r-sm)",
    cursor: "pointer",
  });

  const feedbackStyle = (tone: "error" | "notice"): React.CSSProperties => ({
    padding: "7px 10px",
    borderRadius: "var(--r-sm)",
    border: "1px solid var(--border)",
    background:
      tone === "error"
        ? "color-mix(in oklch, var(--error) 12%, transparent)"
        : "color-mix(in oklch, var(--online) 14%, transparent)",
    fontSize: "var(--fs-sm)",
    ...(tone === "error" ? { color: "var(--error)" } : {}),
  });

  return (
    <BrutalModal title={t("reminders.set")} onClose={onClose} width={460}>
      <div className="modal-body">
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--fs-sm)", marginTop: 4 }}>
          <span style={{ fontWeight: 700 }}>{t("reminders.for")}</span>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: "var(--fs-caption)",
              padding: "2px 7px",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-sm)",
              background: "var(--panel-2)",
              color: "var(--fg)",
            }}
          >
            {targetLabel}
          </span>
        </div>

        <div className="field">
          <label htmlFor="reminder-author">{t("reminders.forWhom")}</label>
          <select
            id="reminder-author"
            className="select"
            value={authorId}
            onChange={(e) => setAuthorId(e.target.value)}
          >
            <option value={OWNER_MEMBER_ID}>{t("reminders.owner")}</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                @{agent.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="reminder-title">{t("reminders.titleField")}</label>
          <input
            id="reminder-title"
            className="input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("reminders.titlePlaceholder")}
          />
        </div>

        <div className="field">
          <label htmlFor="reminder-fire-at">{t("reminders.fireAt")}</label>
          <input
            id="reminder-fire-at"
            className="input"
            type="datetime-local"
            value={fireAt}
            onChange={(e) => setFireAt(e.target.value)}
            style={{ fontFamily: "var(--mono)" }}
          />
        </div>

        <div className="field">
          <label htmlFor="reminder-recurrence">{t("reminders.recurrence")}</label>
          <input
            id="reminder-recurrence"
            className="input"
            type="text"
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value)}
            placeholder="every:15m / daily@09:00 / weekly:mon,fri@09:00"
            style={{ fontFamily: "var(--mono)" }}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
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
        </div>

        {error && <div style={feedbackStyle("error")}>{error}</div>}
        {notice && <div style={feedbackStyle("notice")}>{notice}</div>}

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 4 }}>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: "var(--fs-mono-micro)",
              letterSpacing: "var(--ls-wider)",
              textTransform: "uppercase",
              color: "var(--faint)",
              fontWeight: "var(--fw-semi)",
              marginBottom: 4,
            }}
          >
            {t("reminders.existing")}
          </div>
          {reminders.length === 0 ? (
            <div style={{ fontSize: "var(--fs-sm)", color: "var(--muted)", padding: "4px 0" }}>
              {t("reminders.empty")}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {reminders.map((reminder) => (
                <ReminderRow key={reminder.id} reminder={reminder} onAction={runAction} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="modal-foot">
        <span className="sep" />
        <button type="button" className="btn btn-primary" disabled={busy} onClick={submitCreate}>
          {t("reminders.create")}
        </button>
      </div>
    </BrutalModal>
  );
}
