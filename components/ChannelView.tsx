"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { MarkdownBody } from "./MarkdownBody";
import { PixelAvatar } from "./PixelAvatar";
import { ReminderModal } from "./ReminderModal";
import { copyText } from "@/lib/clipboard";
import { previewLine } from "@/lib/preview";
import type { ChannelRow, MemberRow, TaskStatus } from "@/lib/data/db";
import { BUILTIN_CHANNEL_ID } from "@/lib/data/schema";

export type CenterTab = "messages" | "tasks";

export interface ChannelWithMeta extends ChannelRow {
  joined: boolean;
  memberCount: number;
}

interface ChannelMessage {
  id: string;
  target_id: string;
  seq: number;
  author_id: string;
  content: string;
  created_at: string;
  author: MemberRow | null;
}

/** §3.7 任务 = 消息 + 元数据：board 只显示状态，进展都在任务 thread。 */
interface ChannelTask {
  id: string;
  message_id: string;
  number: number;
  status: TaskStatus;
  owner_id: string | null;
  updated_at: string;
  channelId: string;
  anchor: ChannelMessage;
  owner: MemberRow | null;
}

interface MessagesPage {
  messages: ChannelMessage[];
  hasMore: boolean;
  maxSeq: number;
}

const INK = "#141111";
const PAGE_LIMIT = 50;
/** agent-loop 回复轮询间隔（§5.4 demo：agent 回复落入消息流）。 */
const INBOX_POLL_MS = 3000;
/** 任务板状态分组顺序（§3.7）。 */
const TASK_STATUS_ORDER: TaskStatus[] = ["todo", "in_progress", "in_review", "done", "closed"];

const messageTime = (iso: string): string => {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return isToday ? time : `${d.toLocaleDateString()} ${time}`;
};

/** 轮询合并：按 id 去重 + 按 seq 排序（纯函数，便于测试）。 */
export function mergeIncomingMessages(
  prev: ChannelMessage[],
  incoming: ChannelMessage[],
): ChannelMessage[] {
  if (incoming.length === 0) return prev;
  const merged = [...prev, ...incoming.filter((m) => !prev.some((p) => p.id === m.id))];
  return merged.sort((a, b) => a.seq - b.seq);
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-space-mono)",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.06em",
        padding: "2px 7px",
        border: `2px solid ${INK}`,
        background: "#ffffff",
        color: "var(--text-muted)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function EmptyState({
  glyph,
  title,
  hint,
  children,
}: {
  glyph: string;
  title: string;
  hint: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: 24,
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          display: "grid",
          placeItems: "center",
          background: "#ffffff",
          border: `2px solid ${INK}`,
          boxShadow: "var(--shadow-md)",
          fontFamily: "var(--font-space-mono)",
          fontSize: 36,
          fontWeight: 700,
          color: "var(--text)",
        }}
      >
        {glyph}
      </div>
      <div
        style={{
          fontFamily: "var(--font-hanken)",
          fontWeight: 700,
          fontSize: 17,
          marginTop: 6,
        }}
      >
        {title}
      </div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, maxWidth: 340, lineHeight: 1.6 }}>
        {hint}
      </div>
      {children}
    </div>
  );
}

/** 消息动作栏（§3.2）：回复 thread / 引用 / 复制链接 / 设提醒（§5.6 UI 入口）。 */
function MessageActions({
  message,
  onReply,
  onQuote,
  onCopyLink,
  onReminder,
}: {
  message: ChannelMessage;
  onReply: (message: ChannelMessage) => void;
  onQuote: (message: ChannelMessage) => void;
  onCopyLink: (message: ChannelMessage) => void;
  onReminder?: (message: ChannelMessage) => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const buttonStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "3px 8px",
    fontFamily: "var(--font-hanken)",
    fontWeight: 700,
    fontSize: 11,
    background: "#ffffff",
    color: "var(--text)",
    border: `2px solid ${INK}`,
    boxShadow: "1px 1px 0 0 rgba(20, 17, 17, 0.4)",
    cursor: "pointer",
  };
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <button
        type="button"
        title={t("message.reply")}
        style={buttonStyle}
        onClick={() => onReply(message)}
      >
        ↩
      </button>
      <button type="button" title={t("message.quote")} style={buttonStyle} onClick={() => onQuote(message)}>
        ❝
      </button>
      <button
        type="button"
        title={t("message.copyLink")}
        style={buttonStyle}
        onClick={() => {
          onCopyLink(message);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? "✓" : "🔗"}
      </button>
      {onReminder && (
        <button
          type="button"
          title={t("reminders.messageAction")}
          style={buttonStyle}
          onClick={() => onReminder(message)}
        >
          ⏰
        </button>
      )}
    </div>
  );
}

/**
 * 右键菜单（§3.7 创建途径 1：Convert to Task——顶层消息可转，thread 内不可）。
 * 菜单挂在视口坐标；点击别处 / Escape 关闭。
 */
function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: Array<{ label: string; onClick: () => void }>;
  onClose: () => void;
}) {
  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("click", close);
    document.addEventListener("contextmenu", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("contextmenu", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div
      role="menu"
      style={{
        position: "fixed",
        left: Math.min(x, window.innerWidth - 200),
        top: Math.min(y, window.innerHeight - items.length * 40 - 12),
        zIndex: 100,
        minWidth: 190,
        background: "#ffffff",
        border: `2px solid ${INK}`,
        boxShadow: "4px 4px 0 0 rgba(20, 17, 17, 0.35)",
        padding: 4,
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
            item.onClick();
          }}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: "7px 10px",
            fontFamily: "var(--font-hanken)",
            fontWeight: 700,
            fontSize: 12,
            background: "transparent",
            color: "var(--text)",
            border: "none",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--yellow)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** 顶层消息渲染行：头像 + 作者 + seq + 时间戳 + 内容 + hover 动作栏；右键 = 菜单（Open Thread / Convert to Task）。 */
export function MessageRow({
  message,
  isAnchor,
  canConvertToTask,
  onReply,
  onQuote,
  onCopyLink,
  onConvertToTask,
  onSetReminder,
}: {
  message: ChannelMessage;
  isAnchor?: boolean;
  canConvertToTask?: boolean;
  onReply: (message: ChannelMessage) => void;
  onQuote: (message: ChannelMessage) => void;
  onCopyLink: (message: ChannelMessage) => void;
  onConvertToTask?: (message: ChannelMessage) => void;
  onSetReminder?: (message: ChannelMessage) => void;
}) {
  const { t } = useI18n();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const items = [
    { label: t("message.reply"), onClick: () => onReply(message) },
    ...(canConvertToTask && onConvertToTask
      ? [{ label: t("tasks.convert"), onClick: () => onConvertToTask(message) }]
      : []),
  ];
  return (
    <div
      className="ws-message-row"
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      style={{
        display: "flex",
        gap: 10,
        padding: "10px 16px",
        background: isAnchor ? "var(--yellow)" : "#ffffff",
        borderBottom: "2px solid var(--border)",
      }}
    >
      <PixelAvatar seed={message.author_id} name={message.author?.name ?? "?"} size={40} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            flexWrap: "wrap",
            marginBottom: 2,
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>
            {message.author?.name ?? t("message.unknownAuthor")}
          </span>
          <span style={{ fontFamily: "var(--font-space-mono)", fontSize: 11, color: "var(--text-muted)" }}>
            #{message.seq}
          </span>
          <span style={{ fontFamily: "var(--font-space-mono)", fontSize: 11, color: "var(--text-dim)" }}>
            {messageTime(message.created_at)}
          </span>
        </div>
        <div className="ws-message-content" style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text)" }}>
          <MarkdownBody>{message.content}</MarkdownBody>
        </div>
        <div className="ws-message-actions" style={{ marginTop: 6 }}>
          <MessageActions
            message={message}
            onReply={onReply}
            onQuote={onQuote}
            onCopyLink={onCopyLink}
            onReminder={onSetReminder}
          />
        </div>
      </div>
      {menu && items.length > 0 && (
        <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}

/** 任务板（§3.7 视图）：按状态分组；board 只显示状态，进展都在任务 thread（点击卡片打开）。 */
export function TaskBoard({
  tasks,
  currentMemberId,
  busy,
  disabled,
  error,
  notice,
  onCreateTask,
  onAction,
  onOpenThread,
}: {
  tasks: ChannelTask[];
  currentMemberId: string;
  busy: boolean;
  disabled: boolean;
  error: string | null;
  notice: string | null;
  onCreateTask: (content: string) => void;
  onAction: (task: ChannelTask, action: "claim" | "updateStatus", status?: TaskStatus) => void;
  onOpenThread: (anchor: ChannelMessage) => void;
}) {
  const { t } = useI18n();
  const [formOpen, setFormOpen] = useState(false);
  const [content, setContent] = useState("");

  const badgeStyle = (status: TaskStatus): React.CSSProperties => {
    const background: Record<TaskStatus, string> = {
      todo: "#ffffff",
      in_progress: "var(--yellow)",
      in_review: "var(--cyan)",
      done: "#b9ecd0",
      closed: "#c9c7c2",
    };
    return {
      fontFamily: "var(--font-space-mono)",
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: "0.06em",
      padding: "2px 7px",
      border: `2px solid ${INK}`,
      background: background[status],
      color: "var(--text)",
      whiteSpace: "nowrap",
    };
  };

  const cardButton: React.CSSProperties = {
    padding: "4px 9px",
    fontFamily: "var(--font-hanken)",
    fontWeight: 700,
    fontSize: 11,
    background: "#ffffff",
    color: "var(--text)",
    border: `2px solid ${INK}`,
    boxShadow: "1px 1px 0 0 rgba(20, 17, 17, 0.4)",
    cursor: "pointer",
  };

  const actionsFor = (task: ChannelTask): Array<{ label: string; onClick: () => void }> => {
    const mine = task.owner_id === currentMemberId;
    switch (task.status) {
      case "todo":
        return [{ label: t("tasks.claim"), onClick: () => onAction(task, "claim") }];
      case "in_progress":
        return mine
          ? [
              { label: t("tasks.complete"), onClick: () => onAction(task, "updateStatus", "in_review") },
              { label: t("tasks.unclaim"), onClick: () => onAction(task, "updateStatus", "todo") },
              { label: t("tasks.close"), onClick: () => onAction(task, "updateStatus", "closed") },
            ]
          : [];
      case "in_review":
        return mine
          ? [{ label: t("tasks.close"), onClick: () => onAction(task, "updateStatus", "closed") }]
          : [
              { label: t("tasks.approve"), onClick: () => onAction(task, "updateStatus", "done") },
              { label: t("tasks.reject"), onClick: () => onAction(task, "updateStatus", "in_progress") },
            ];
      case "done":
      case "closed":
        return [{ label: t("tasks.reopen"), onClick: () => onAction(task, "updateStatus", "todo") }];
    }
  };

  const submitCreate = () => {
    const trimmed = content.trim();
    if (!trimmed || disabled) return;
    onCreateTask(trimmed);
    setContent("");
    setFormOpen(false);
  };

  return (
    <div style={{ padding: "12px 16px 24px" }}>
      {/* 创建途径 3：Tasks tab Create Task */}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        {formOpen ? (
          <>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitCreate();
                }
              }}
              placeholder={t("tasks.createPlaceholder")}
              disabled={disabled}
              rows={2}
              autoFocus
              style={{
                flex: 1,
                minWidth: 220,
                padding: "8px 10px",
                border: `2px solid ${INK}`,
                background: "#ffffff",
                fontFamily: "var(--font-space-grotesk)",
                fontSize: 13,
                outline: "none",
                opacity: disabled ? 0.55 : 1,
              }}
            />
            <button
              type="button"
              disabled={disabled || !content.trim()}
              onClick={submitCreate}
              style={{ ...cardButton, padding: "9px 14px", background: "var(--pink)" }}
            >
              {t("tasks.create")}
            </button>
            <button type="button" style={cardButton} onClick={() => setFormOpen(false)}>
              {t("tasks.cancel")}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setFormOpen(true)}
            style={{ ...cardButton, padding: "8px 14px", background: "var(--pink)" }}
          >
            + {t("tasks.new")}
          </button>
        )}
        {notice && (
          <span style={{ fontFamily: "var(--font-space-mono)", fontSize: 12, color: "var(--text-muted)" }}>
            {notice}
          </span>
        )}
      </div>
      {error && (
        <div style={{ marginBottom: 12, color: "var(--coral)", fontSize: 12 }}>{error}</div>
      )}

      {tasks.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
          {t("tasks.emptyHint")}
        </div>
      ) : (
        TASK_STATUS_ORDER.filter((status) => tasks.some((task) => task.status === status)).map((status) => {
          const group = tasks.filter((task) => task.status === status);
          return (
            <section key={status} style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={badgeStyle(status)}>{t(`task.status.${status}`)}</span>
                <span style={{ fontFamily: "var(--font-space-mono)", fontSize: 11, color: "var(--text-dim)" }}>
                  {group.length}
                </span>
                <span style={{ flex: 1, borderTop: `2px solid var(--border)` }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {group.map((task) => {
                  const actions = actionsFor(task);
                  return (
                    <div
                      key={task.id}
                      role="button"
                      tabIndex={0}
                      title={t("tasks.threadHint")}
                      onClick={() => onOpenThread(task.anchor)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onOpenThread(task.anchor);
                      }}
                      style={{
                        padding: "10px 12px",
                        background: "#ffffff",
                        border: `2px solid ${INK}`,
                        boxShadow: "2px 2px 0 0 rgba(20, 17, 17, 0.35)",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: "var(--font-space-mono)", fontWeight: 700, fontSize: 13 }}>
                          #{task.number}
                        </span>
                        <span style={{ flex: 1, fontSize: 13, color: "var(--text)", minWidth: 120 }}>
                          {previewLine(task.anchor.content)}
                        </span>
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            fontFamily: "var(--font-hanken)",
                            fontWeight: 700,
                            fontSize: 11,
                          }}
                        >
                          <PixelAvatar seed={task.owner_id ?? "none"} name={task.owner?.name ?? "?"} size={28} />
                          {task.owner ? task.owner.name : t("tasks.unassigned")}
                        </span>
                      </div>
                      {actions.length > 0 && (
                        <div
                          style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          {actions.map((action) => (
                            <button
                              key={action.label}
                              type="button"
                              disabled={busy}
                              onClick={action.onClick}
                              style={{ ...cardButton, opacity: busy ? 0.55 : 1, cursor: busy ? "not-allowed" : "pointer" }}
                            >
                              {action.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

/** 消息输入条：Enter 发送 / Shift+Enter 换行；引用 chip（§3.2 引用动作）；As Task 勾选（§3.7 创建途径 2）。 */
export function Composer({
  targetId,
  disabled,
  disabledHint,
  quoting,
  asTask,
  onAsTaskChange,
  onClearQuote,
  onSend,
}: {
  targetId: string;
  disabled: boolean;
  disabledHint: string;
  quoting: ChannelMessage | null;
  asTask?: boolean;
  onAsTaskChange?: (checked: boolean) => void;
  onClearQuote: () => void;
  onSend: (targetId: string, content: string, quoteId?: string) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = async () => {
    const content = value.trim();
    if (!content || busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(targetId, content, quoting?.id);
      setValue("");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        flexShrink: 0,
        padding: "10px 16px 12px",
        borderTop: `2px solid ${INK}`,
        background: "var(--bg)",
      }}
    >
      {quoting && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
            padding: "6px 10px",
            background: "var(--cyan)",
            border: `2px solid ${INK}`,
            fontFamily: "var(--font-space-mono)",
            fontSize: 12,
          }}
        >
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            ❝ #{quoting.seq} {quoting.author?.name ?? t("message.unknownAuthor")}:{" "}
            {quoting.content.split("\n")[0]}
          </span>
          <button
            type="button"
            aria-label={t("message.clearQuote")}
            onClick={onClearQuote}
            style={{
              width: 22,
              height: 22,
              background: "#ffffff",
              border: `2px solid ${INK}`,
              cursor: "pointer",
              fontSize: 11,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={disabled ? disabledHint : t("message.composerPlaceholder")}
          disabled={disabled}
          rows={2}
          style={{
            flex: 1,
            padding: "8px 10px",
            border: `2px solid ${INK}`,
            background: "#ffffff",
            color: "var(--text)",
            fontFamily: "var(--font-space-grotesk)",
            fontSize: 13,
            resize: "vertical",
            outline: "none",
            opacity: disabled ? 0.55 : 1,
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "stretch" }}>
          {onAsTaskChange && (
            <label
              title={t("tasks.convertHint")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 8px",
                fontFamily: "var(--font-hanken)",
                fontWeight: 700,
                fontSize: 11,
                background: asTask ? "var(--yellow)" : "#ffffff",
                border: `2px solid ${INK}`,
                cursor: "pointer",
                userSelect: "none",
                opacity: disabled ? 0.55 : 1,
              }}
            >
              <input
                type="checkbox"
                checked={Boolean(asTask)}
                disabled={disabled}
                onChange={(e) => onAsTaskChange(e.target.checked)}
                style={{ cursor: "pointer", accentColor: INK }}
              />
              {t("tasks.asTask")}
            </label>
          )}
          <button
            type="button"
            disabled={disabled || busy || !value.trim()}
            onClick={() => void submit()}
            style={{
              height: 38,
              padding: "0 16px",
              fontFamily: "var(--font-hanken)",
              fontWeight: 700,
              fontSize: 13,
              background: "var(--pink)",
              color: "var(--ink)",
              border: `2px solid ${INK}`,
              boxShadow: "2px 2px 0 0 rgba(20, 17, 17, 0.45)",
              cursor: disabled || busy || !value.trim() ? "not-allowed" : "pointer",
              opacity: disabled || busy || !value.trim() ? 0.55 : 1,
            }}
          >
            {busy ? "…" : t("message.send")}
          </button>
        </div>
      </div>
      {error && <div style={{ marginTop: 6, color: "var(--coral)", fontSize: 12 }}>{error}</div>}
    </div>
  );
}

/** 中央：channel 消息流 / Tasks tab（§3.1）。ticket 04 起承载消息闭环：发送/分页/thread/引用/复制链接。 */
export function ChannelView({
  channel,
  tab,
  onTabChange,
  currentMemberId,
  onChannelChanged,
  focusMessageId,
}: {
  channel: ChannelWithMeta | null;
  tab: CenterTab;
  onTabChange: (tab: CenterTab) => void;
  currentMemberId: string;
  onChannelChanged: () => void;
  focusMessageId?: string | null;
}) {
  const { t } = useI18n();

  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [maxSeq, setMaxSeq] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [heldNotice, setHeldNotice] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState(false);

  const [tasks, setTasks] = useState<ChannelTask[]>([]);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [asTask, setAsTask] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [taskNotice, setTaskNotice] = useState<string | null>(null);

  const [openThread, setOpenThread] = useState<ChannelMessage | null>(null);
  const [threadMessages, setThreadMessages] = useState<ChannelMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [quoting, setQuoting] = useState<ChannelMessage | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  const loadPage = useCallback(
    async (targetId: string, before?: number) => {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      if (before !== undefined) params.set("before", String(before));
      const res = await fetch(`/api/channels/${encodeURIComponent(channel?.id ?? "")}/messages?${params}`);
      if (!res.ok) throw new Error(`GET messages: ${res.status}`);
      return (await res.json()) as MessagesPage;
    },
    [channel?.id],
  );

  const loadLatest = useCallback(() => {
    if (!channel) return;
    setLoadError(null);
    void loadPage(channel.id)
      .then((page) => {
        setMessages(page.messages);
        setHasMore(page.hasMore);
        setMaxSeq(page.maxSeq);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [channel, loadPage]);

  const loadTasks = useCallback(() => {
    if (!channel) return;
    setTasksError(null);
    void fetch(`/api/channels/${encodeURIComponent(channel.id)}/tasks`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET tasks: ${res.status}`);
        const body = (await res.json()) as { tasks?: ChannelTask[] };
        setTasks(body.tasks ?? []);
      })
      .catch((e) => setTasksError(e instanceof Error ? e.message : String(e)));
  }, [channel]);

  useEffect(() => {
    setMessages([]);
    setHasMore(false);
    setOpenThread(null);
    setQuoting(null);
    setHeldNotice(null);
    setTasks([]);
    setTasksError(null);
    setTaskNotice(null);
    loadLatest();
    // 任务板常驻加载：messages tab 的右键 Convert 依赖 canConvertToTask 判定
    loadTasks();
  }, [channel?.id, loadLatest, loadTasks]);

  useEffect(() => {
    if (tab === "tasks") loadTasks();
  }, [tab, loadTasks]);

  // agent-loop 回复轮询（§5.4）：增量合并新消息；后台 tab 暂停；Tasks tab 顺带刷新任务板
  useEffect(() => {
    if (!channel) return;
    let cancelled = false;
    const timer = setInterval(() => {
      if (cancelled || document.hidden) return;
      void loadPage(channel.id)
        .then((page) => {
          if (cancelled) return;
          setMaxSeq((prev) => Math.max(prev, page.maxSeq));
          setMessages((prev) => mergeIncomingMessages(prev, page.messages));
        })
        .catch(() => undefined);
      if (tab === "tasks") loadTasks();
    }, INBOX_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // channel?.id 已蕴含 channel：仅在其变化时重建轮询
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel?.id, loadPage, tab, loadTasks]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, openThread]);

  const loadEarlier = useCallback(() => {
    if (!channel || !hasMore || messages.length === 0) return;
    const before = messages[0].seq;
    void loadPage(channel.id, before)
      .then((page) => {
        setMessages((prev) => [...page.messages, ...prev]);
        setHasMore(page.hasMore);
        scrollRef.current?.scrollTo({ top: 220 });
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [channel, hasMore, messages, loadPage]);

  const loadThread = useCallback(
    async (messageId: string) => {
      setThreadLoading(true);
      try {
        const res = await fetch(`/api/messages/${encodeURIComponent(messageId)}/thread`);
        if (!res.ok) throw new Error(`GET thread: ${res.status}`);
        const body = (await res.json()) as { anchor: ChannelMessage; messages: ChannelMessage[] };
        setOpenThread(body.anchor);
        setThreadMessages(body.messages);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        setThreadLoading(false);
      }
    },
    [],
  );

  const handleSend = useCallback(
    async (targetId: string, content: string, quoteId?: string) => {
      if (!channel) return;
      const inThread = targetId === openThread?.id;
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetId,
          content,
          quoteId,
          baseSeq: inThread ? threadMessages[threadMessages.length - 1]?.seq ?? 0 : maxSeq,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        message?: ChannelMessage;
        held?: boolean;
        whatHappened?: string;
        error?: string;
      };
      if (!res.ok) {
        if (body.held) {
          setHeldNotice(body.whatHappened ?? "held");
          if (inThread) {
            void loadThread(openThread.id);
          } else {
            loadLatest();
          }
          throw new Error(t("message.held"));
        }
        throw new Error(body.error ?? `POST messages: ${res.status}`);
      }
      if (body.message) {
        if (inThread) {
          setThreadMessages((prev) => [...prev, body.message as ChannelMessage]);
        } else {
          setMessages((prev) => [...prev, body.message as ChannelMessage]);
          setMaxSeq((prev) => Math.max(prev, (body.message as ChannelMessage).seq));
        }
      }
      setQuoting(null);
      // §3.7 创建途径 2：发送时勾 As Task → 发送成功后转为任务
      if (!inThread && asTask && body.message) {
        const converted = await convertMessageToTask(body.message);
        if (converted) setAsTask(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channel, openThread, maxSeq, threadMessages, loadLatest, loadThread, t, asTask],
  );

  /** 把消息转为任务（§3.7 创建途径 1/2 共用）；返回 null 表示失败（错误已提示）。 */
  const convertMessageToTask = useCallback(
    async (msg: ChannelMessage): Promise<ChannelTask | null> => {
      try {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId: msg.id }),
        });
        const body = (await res.json().catch(() => ({}))) as { task?: ChannelTask; error?: string };
        if (!res.ok) {
          if (res.status === 409) throw new Error(t("tasks.alreadyTask"));
          throw new Error(body.error ?? `convert to task: ${res.status}`);
        }
        if (body.task) {
          setTasks((prev) => [...prev, body.task as ChannelTask]);
          setTaskNotice(t("tasks.converted", { number: String((body.task as ChannelTask).number) }));
        }
        return body.task ?? null;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setTasksError(message);
        setTaskNotice(message);
        return null;
      }
    },
    [t],
  );

  /** 任务动作（§3.7）：claim / updateStatus；受 freshness-hold 保护，409 时提示并刷新。 */
  const runTaskAction = useCallback(
    async (task: ChannelTask, action: "claim" | "updateStatus", status?: TaskStatus) => {
      if (!channel || busyAction) return;
      setBusyAction(true);
      setTasksError(null);
      setTaskNotice(null);
      try {
        const url =
          action === "claim"
            ? `/api/tasks/${encodeURIComponent(task.id)}/claim`
            : `/api/tasks/${encodeURIComponent(task.id)}/update-status`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(status ? { status, baseSeq: maxSeq } : { baseSeq: maxSeq }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          held?: boolean;
          whatHappened?: string;
          conflict?: boolean;
          reason?: string;
        };
        if (!res.ok) {
          if (body.held) {
            setHeldNotice(t("tasks.held"));
            setTaskNotice(body.whatHappened ?? t("tasks.held"));
          } else {
            setTasksError(body.error ?? body.reason ?? t("tasks.denied"));
          }
          loadTasks();
          loadLatest();
          return;
        }
        loadTasks();
      } catch (e) {
        setTasksError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyAction(false);
      }
    },
    [channel, busyAction, maxSeq, loadTasks, loadLatest, t],
  );

  /** Tasks tab Create Task（§3.7 创建途径 3）：先发消息再建任务。 */
  const createTaskFromBoard = useCallback(
    async (contentInput: string) => {
      if (!channel || creatingTask) return;
      const content = contentInput.trim();
      if (!content) return;
      setCreatingTask(true);
      setTasksError(null);
      setTaskNotice(null);
      try {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelId: channel.id, content }),
        });
        const body = (await res.json().catch(() => ({}))) as { task?: ChannelTask; error?: string };
        if (!res.ok) {
          throw new Error(body.error ?? `create task: ${res.status}`);
        }
        setTaskNotice(t("tasks.created", { number: String((body.task as ChannelTask).number) }));
        loadTasks();
        loadLatest();
      } catch (e) {
        setTasksError(e instanceof Error ? e.message : String(e));
      } finally {
        setCreatingTask(false);
      }
    },
    [channel, creatingTask, loadTasks, loadLatest, t],
  );

  // 深链：hash `#c/<channelId>?m=<messageId>` → 打开对应消息（thread 消息自动展开其线程）
  useEffect(() => {
    if (!channel || !focusMessageId) return;
    setLoadError(null);
    void fetch(`/api/messages/${encodeURIComponent(focusMessageId)}`)
      .then(async (res) => {
        if (!res.ok) return;
        const body = (await res.json()) as { message?: ChannelMessage };
        const target = body.message;
        if (!target) return;
        if (target.target_id === channel.id) {
          const page = await loadPage(channel.id, target.seq + 1);
          setMessages((prev) => {
            const merged = [...prev, ...page.messages.filter((m) => !prev.some((p) => p.id === m.id))];
            return merged.sort((a, b) => a.seq - b.seq);
          });
          requestAnimationFrame(() => {
            document.getElementById(`msg-${target.id}`)?.scrollIntoView({ block: "center" });
          });
        } else {
          void loadThread(target.target_id);
        }
      })
      .catch(() => undefined);
  }, [channel, focusMessageId, loadPage, loadThread]);

  const joined = channel?.joined ?? false;
  const isArchived = channel?.archived === 1;
  const composerDisabled = !channel || !joined || isArchived;
  const composerDisabledHint = !channel
    ? ""
    : isArchived
      ? t("message.archivedHint")
      : joined
        ? ""
        : t("message.joinHint");

  const runChannelAction = async (action: "join" | "leave" | "archive", body: object) => {
    if (!channel || busyAction) return;
    setBusyAction(true);
    try {
      const res = await fetch(`/api/channels/${encodeURIComponent(channel.id)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `${action} failed`);
      }
      onChannelChanged();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAction(false);
    }
  };

  const handleCopyLink = async (message: ChannelMessage) => {
    const url = `${window.location.origin}${window.location.pathname}#c/${encodeURIComponent(channel?.id ?? "")}?m=${message.id}`;
    await copyText(url);
  };

  /** 提醒弹窗（§5.6 UI 入口）：目标 = channel（头部 ⏰）或消息（消息动作栏 ⏰）。 */
  const [reminderTarget, setReminderTarget] = useState<{
    targetId: string;
    targetLabel: string;
    defaultTitle?: string;
  } | null>(null);
  const openChannelReminder = () => {
    if (!channel) return;
    setReminderTarget({ targetId: channel.id, targetLabel: `#${channel.name}` });
  };
  const openMessageReminder = (message: ChannelMessage) => {
    setReminderTarget({
      targetId: message.id,
      targetLabel: `#${message.seq} ${message.author?.name ?? ""}`.trim(),
      defaultTitle: previewLine(message.content, 60),
    });
  };

  const tabButtonStyle = (active: boolean): React.CSSProperties => ({
    fontFamily: "var(--font-hanken)",
    fontWeight: 700,
    fontSize: 13,
    padding: "9px 16px",
    cursor: "pointer",
    background: active ? "var(--yellow)" : "transparent",
    color: "var(--text)",
    border: `2px solid ${INK}`,
    borderBottom: "none",
    marginBottom: -2,
    boxShadow: active ? "2px 2px 0 0 rgba(20, 17, 17, 0.45)" : "none",
    position: "relative",
  });

  const actionButton: React.CSSProperties = {
    padding: "5px 10px",
    fontFamily: "var(--font-hanken)",
    fontWeight: 700,
    fontSize: 11,
    background: "#ffffff",
    color: "var(--text)",
    border: `2px solid ${INK}`,
    boxShadow: "2px 2px 0 0 rgba(20, 17, 17, 0.4)",
    cursor: "pointer",
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        position: "relative",
      }}
    >
      {/* channel 头部：名称 + 类型/归档 badge + 描述 + 成员数 + join/leave/archive（§3.1/§3.2） */}
      <header
        className="ws-center-header"
        style={{
          flexShrink: 0,
          padding: "14px 16px 10px",
          borderBottom: `2px solid ${INK}`,
          background: "var(--bg)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--font-hanken)",
              fontWeight: 700,
              fontSize: 20,
              letterSpacing: "-0.01em",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ fontFamily: "var(--font-space-mono)", color: "var(--text-muted)" }}>
              #
            </span>
            {channel?.name ?? t("shell.selectChannel")}
          </h1>
          {channel && (
            <>
              <Badge>{channel.type === "private" ? t("channel.private") : t("channel.public")}</Badge>
              {isArchived && <Badge>{t("channel.archived")}</Badge>}
              <Badge>
                {t("channel.members", {
                  count: String(channel.memberCount),
                  countSuffix: channel.memberCount === 1 ? "" : "s",
                })}
              </Badge>
            </>
          )}
        </div>
        {channel?.description ? (
          <p style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
            {channel.description}
          </p>
        ) : null}
        {channel && (
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            {channel.id !== BUILTIN_CHANNEL_ID && (
              <>
                {joined ? (
                  <button
                    type="button"
                    style={actionButton}
                    onClick={() => void runChannelAction("leave", { memberId: currentMemberId })}
                  >
                    {t("channel.leave")}
                  </button>
                ) : (
                  <button
                    type="button"
                    style={{ ...actionButton, background: "var(--pink)" }}
                    onClick={() => void runChannelAction("join", { memberId: currentMemberId })}
                  >
                    {t("channel.join")}
                  </button>
                )}
                <button
                  type="button"
                  style={actionButton}
                  onClick={() => void runChannelAction("archive", { archived: !isArchived })}
                >
                  {isArchived ? t("channel.unarchive") : t("channel.archive")}
                </button>
              </>
            )}
            {joined && (
              <button
                type="button"
                title={t("reminders.channelAction")}
                style={{ ...actionButton, background: "var(--lime)" }}
                onClick={openChannelReminder}
              >
                ⏰
              </button>
            )}
          </div>
        )}
      </header>

      {/* Messages / Tasks tab（§3.1） */}
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "0 16px",
          borderBottom: `2px solid ${INK}`,
          flexShrink: 0,
        }}
        role="tablist"
      >
        {(["messages", "tasks"] as const).map((tabId) => (
          <button
            key={tabId}
            type="button"
            role="tab"
            aria-selected={tab === tabId}
            onClick={() => onTabChange(tabId)}
            style={tabButtonStyle(tab === tabId)}
          >
            {tabId === "messages" ? t("center.messages") : t("center.tasks")}
          </button>
        ))}
      </div>

      {/* 主体 */}
      <main
        ref={scrollRef}
        className="overflow-x-hidden overflow-y-auto"
        style={{
          flex: 1,
          minHeight: 0,
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {tab === "messages" ? (
          !channel ? (
            <EmptyState glyph="#" title={t("shell.selectChannel")} hint={t("messages.emptyHint")} />
          ) : loadError ? (
            <div style={{ padding: 24, color: "var(--coral)", fontSize: 13 }}>{loadError}</div>
          ) : messages.length === 0 ? (
            <EmptyState glyph="#" title={t("messages.empty")} hint={t("messages.emptyHint")} />
          ) : (
            <>
              {hasMore && (
                <div style={{ padding: "10px 16px 0", textAlign: "center" }}>
                  <button
                    type="button"
                    style={actionButton}
                    onClick={() => void loadEarlier()}
                  >
                    {t("message.loadEarlier")}
                  </button>
                </div>
              )}
              {messages.map((m) => (
                <div key={m.id} id={`msg-${m.id}`}>
                  <MessageRow
                    message={m}
                    canConvertToTask={!tasks.some((task) => task.message_id === m.id)}
                    onReply={(target) => void loadThread(target.id)}
                    onQuote={setQuoting}
                    onCopyLink={(target) => void handleCopyLink(target)}
                    onConvertToTask={(target) => void convertMessageToTask(target)}
                    onSetReminder={joined ? openMessageReminder : undefined}
                  />
                </div>
              ))}
              {heldNotice && (
                <div
                  style={{
                    margin: "10px 16px 0",
                    padding: "8px 12px",
                    background: "var(--yellow)",
                    border: `2px solid ${INK}`,
                    fontFamily: "var(--font-space-mono)",
                    fontSize: 12,
                  }}
                >
                  {t("message.heldNotice")} {heldNotice}
                </div>
              )}
              {taskNotice && (
                <div
                  style={{
                    margin: "10px 16px 0",
                    padding: "8px 12px",
                    background: "var(--cyan)",
                    border: `2px solid ${INK}`,
                    fontFamily: "var(--font-space-mono)",
                    fontSize: 12,
                  }}
                >
                  {taskNotice}
                </div>
              )}
            </>
          )
        ) : (
          <TaskBoard
            tasks={tasks}
            currentMemberId={currentMemberId}
            busy={busyAction}
            disabled={composerDisabled}
            error={tasksError}
            notice={taskNotice}
            onCreateTask={(content) => void createTaskFromBoard(content)}
            onAction={(task, action, status) => void runTaskAction(task, action, status)}
            onOpenThread={(anchor) => void loadThread(anchor.id)}
          />
        )}
      </main>

      {/* 消息输入（§3.2）：channel 层可勾 As Task（§3.7 创建途径 2）；thread 内不可转任务 */}
      {channel && tab === "messages" && (
        <Composer
          targetId={channel.id}
          disabled={composerDisabled}
          disabledHint={composerDisabledHint}
          quoting={quoting}
          asTask={asTask}
          onAsTaskChange={setAsTask}
          onClearQuote={() => setQuoting(null)}
          onSend={handleSend}
        />
      )}

      {/* thread 侧栏（§3.1 回复气泡展开；不可嵌套 → 无回复入口） */}
      {openThread && (
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            width: "min(420px, 92%)",
            display: "flex",
            flexDirection: "column",
            background: "var(--bg)",
            borderLeft: `2px solid ${INK}`,
            boxShadow: "-4px 0 0 0 rgba(20, 17, 17, 0.25)",
            zIndex: 20,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 14px",
              borderBottom: `2px solid ${INK}`,
              background: "var(--yellow)",
              flexShrink: 0,
            }}
          >
            <span style={{ fontFamily: "var(--font-hanken)", fontWeight: 700, fontSize: 14 }}>
              {t("message.thread")} #{openThread.seq}
            </span>
            <button
              type="button"
              aria-label={t("detail.close")}
              onClick={() => setOpenThread(null)}
              style={{
                marginLeft: "auto",
                width: 24,
                height: 24,
                background: "#ffffff",
                border: `2px solid ${INK}`,
                cursor: "pointer",
                fontSize: 12,
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            <MessageRow
              message={openThread}
              isAnchor
              canConvertToTask={!tasks.some((task) => task.message_id === openThread.id)}
              onReply={() => undefined}
              onQuote={setQuoting}
              onCopyLink={(target) => void handleCopyLink(target)}
              onConvertToTask={(target) => void convertMessageToTask(target)}
              onSetReminder={joined ? openMessageReminder : undefined}
            />
            {threadLoading ? (
              <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 12 }}>
                {t("message.threadLoading")}
              </div>
            ) : (
              threadMessages.map((m) => (
                <MessageRow
                  key={m.id}
                  message={m}
                  canConvertToTask={false}
                  onReply={() => undefined}
                  onQuote={setQuoting}
                  onCopyLink={(target) => void handleCopyLink(target)}
                />
              ))
            )}
          </div>
          <Composer
            targetId={openThread.id}
            disabled={composerDisabled}
            disabledHint={composerDisabledHint}
            quoting={quoting}
            onClearQuote={() => setQuoting(null)}
            onSend={handleSend}
          />
        </div>
      )}

      {reminderTarget && channel && (
        <ReminderModal
          targetId={reminderTarget.targetId}
          targetLabel={reminderTarget.targetLabel}
          defaultTitle={reminderTarget.defaultTitle}
          channelId={channel.id}
          onClose={() => setReminderTarget(null)}
          onChanged={loadLatest}
        />
      )}
    </div>
  );
}
