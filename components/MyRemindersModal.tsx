"use client";

import { useEffect, useRef, useState } from "react";
import { LocateFixed } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { BrutalModal } from "./BrutalModal";

/**
 * 全局「我的提醒」面板（§5.6 补充入口）：列出全部提醒（跨 target），
 * 支持 snooze/cancel 与「定位」跳转（深链 #c/<channelId>[?m=<id>]）。
 * 打开期间 15s 轮询刷新（到点触发后状态可见）。
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
  target: { kind: "channel" | "message"; id: string } | null;
  channelId: string | null;
  channelName: string | null;
  anchorSeq: number | null;
  author: { id: string; type: "agent" | "human"; name: string } | null;
}

const REFRESH_MS = 15_000;
const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "7px 9px",
  background: "#fffaef",
  border: `1px solid var(--border)`,
  fontSize: 12,
  flexWrap: "wrap",
};

const actionStyle: React.CSSProperties = {
  padding: "2px 7px",
  fontFamily: "var(--font)",
  fontWeight: 700,
  fontSize: 11,
  border: `1px solid var(--border)`,
  background: "#ffffff",
  cursor: "pointer",
};

function formatFireAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MyRemindersModal({
  onClose,
  onLocate,
}: {
  onClose: () => void;
  onLocate: (channelId: string, messageId?: string) => void;
}) {
  const { t } = useI18n();
  const [reminders, setReminders] = useState<ReminderView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const disposed = useRef(false);

  const load = () => {
    void fetch("/api/reminders")
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET reminders: ${res.status}`);
        const body = (await res.json()) as { reminders?: ReminderView[] };
        if (!disposed.current) setReminders(body.reminders ?? []);
      })
      .catch((e) => {
        if (!disposed.current) setError(e instanceof Error ? e.message : String(e));
      });
  };

  useEffect(() => {
    disposed.current = false;
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      disposed.current = true;
      clearInterval(timer);
    };
  }, []);

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

  const locate = (reminder: ReminderView) => {
    if (!reminder.channelId) return;
    onLocate(reminder.channelId, reminder.target?.kind === "message" ? reminder.target.id : undefined);
  };

  const targetLabel = (reminder: ReminderView): string => {
    if (!reminder.channelName) return "—";
    if (reminder.anchorSeq != null) {
      return t("reminders.targetInMsg", { channel: reminder.channelName, seq: String(reminder.anchorSeq) });
    }
    return t("reminders.targetIn", { channel: reminder.channelName });
  };

  return (
    <BrutalModal title={t("reminders.all")} onClose={onClose} width={520}>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {error && (
          <div
            style={{
              padding: "7px 10px",
              background: "#ffe3df",
              border: `1px solid var(--border)`,
              fontSize: 12,
              color: "var(--error)",
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
              border: `1px solid var(--border)`,
              fontSize: 12,
            }}
          >
            {notice}
          </div>
        )}
        {reminders.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("reminders.allEmpty")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {reminders.map((reminder) => (
              <div key={reminder.id} style={rowStyle}>
                <span
                  style={{
                    fontWeight: 700,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 180,
                  }}
                >
                  {reminder.title}
                </span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)" }}>
                  {formatFireAt(reminder.fire_at)}
                </span>
                {reminder.recurrence && (
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10,
                      padding: "1px 5px",
                      border: `1px solid var(--border)`,
                      background: "var(--panel-2)",
                    }}
                  >
                    {reminder.recurrence}
                  </span>
                )}
                <span style={{ fontSize: 11, color: "var(--faint)" }}>{targetLabel(reminder)}</span>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    padding: "1px 5px",
                    border: `1px solid var(--border)`,
                    background: reminder.status === "scheduled" ? "var(--online)" : "#c9c7c2",
                  }}
                >
                  {t(`reminders.status.${reminder.status}`)}
                </span>
                {reminder.status === "scheduled" ? (
                  <>
                    <button type="button" style={actionStyle} onClick={() => runAction(reminder, "snooze")}>
                      {t("reminders.snooze")}
                    </button>
                    <button type="button" style={actionStyle} onClick={() => runAction(reminder, "cancel")}>
                      {t("reminders.cancel")}
                    </button>
                    {reminder.channelId && (
                      <button
                        type="button"
                        style={{ ...actionStyle, marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4 }}
                        onClick={() => locate(reminder)}
                      >
                        <LocateFixed size={11} /> {t("reminders.locate")}
                      </button>
                    )}
                  </>
                ) : (
                  reminder.channelId && (
                    <button
                      type="button"
                      style={{ ...actionStyle, marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4 }}
                      onClick={() => locate(reminder)}
                    >
                      <LocateFixed size={11} /> {t("reminders.locate")}
                    </button>
                  )
                )}
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 11, color: "var(--faint)" }}>{t("reminders.allHint")}</div>
      </div>
    </BrutalModal>
  );
}
