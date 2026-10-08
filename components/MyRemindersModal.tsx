"use client";

import { useEffect, useRef, useState } from "react";
import { LocateFixed } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import type { TranslationParams } from "@/lib/i18n/types";
import { BrutalModal } from "./BrutalModal";

/**
 * 全局「我的提醒」面板（§5.6 补充入口）：列出全部提醒（跨 target），
 * 支持 snooze/cancel 与「定位」跳转（深链 #c/<channelId>[?m=<id>]）。
 * 打开期间 15s 轮询刷新（到点触发后状态可见）。
 *
 * 形态（票 08）：`.modal-body` + 行取 `.kv` 形态（标题 + 频道名 + 锚点 seq mono +
 * 下一次触发时间 mono + `.btn-sm` 动作）；cancel 是破坏性动作 → `.btn-danger`。
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

function formatFireAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 频道名 + 锚点 seq（有锚点时走 `in #<channel> · #<seq>`，否则 `in #<channel>`）。 */
function targetLabel(
  reminder: ReminderView,
  t: (key: string, params?: TranslationParams) => string,
): string {
  if (!reminder.channelName) return "—";
  if (reminder.anchorSeq != null) {
    return t("reminders.targetInMsg", { channel: reminder.channelName, seq: String(reminder.anchorSeq) });
  }
  return t("reminders.targetIn", { channel: reminder.channelName });
}

/**
 * 一行提醒（票 08：`.kv` 形态）。单独导出成渲染面：`renderToStaticMarkup` 不跑
 * effect，列表来自 fetch，渲染级断言只能从这里进入——与 CreateAgentModal 的
 * `ModelsEmptyHint` 同一条 seam。
 */
export function MyReminderRow({
  reminder,
  onAction,
  onLocate,
}: {
  reminder: ReminderView;
  onAction: (reminder: ReminderView, action: "snooze" | "cancel") => void;
  onLocate: (reminder: ReminderView) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="kv">
      <span
        className="k"
        style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {reminder.title}
      </span>
      {/* 右簇：en 下动作文案更宽，放不下时在本行内折到第二行并右对齐；
          可压缩（0 1 auto）是前提，否则会把 .k 挤到 0 并顶出 .modal-body。 */}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          flexWrap: "wrap",
          justifyContent: "flex-end",
          flex: "0 1 auto",
        }}
      >
        <span className="v">{targetLabel(reminder, t)}</span>
        <span className="v">{formatFireAt(reminder.fire_at)}</span>
        {reminder.recurrence && (
          <span
            style={{
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
        {reminder.channelId && (
          <button
            type="button"
            className="btn btn-sm"
            style={{ gap: 4 }}
            onClick={() => onLocate(reminder)}
          >
            <LocateFixed size={11} /> {t("reminders.locate")}
          </button>
        )}
      </span>
    </div>
  );
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
    <BrutalModal title={t("reminders.all")} onClose={onClose} width={520}>
      <div className="modal-body">
        {error && <div style={feedbackStyle("error")}>{error}</div>}
        {notice && <div style={feedbackStyle("notice")}>{notice}</div>}
        {reminders.length === 0 ? (
          <div style={{ fontSize: "var(--fs-sm)", color: "var(--muted)", padding: "4px 0" }}>
            {t("reminders.allEmpty")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {reminders.map((reminder) => (
              <MyReminderRow
                key={reminder.id}
                reminder={reminder}
                onAction={runAction}
                onLocate={locate}
              />
            ))}
          </div>
        )}
        <div style={{ fontSize: "var(--fs-caption)", color: "var(--faint)", padding: "6px 0 2px" }}>
          {t("reminders.allHint")}
        </div>
      </div>
    </BrutalModal>
  );
}
