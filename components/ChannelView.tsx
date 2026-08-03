"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { MarkdownBody } from "./MarkdownBody";
import { PixelAvatar } from "./PixelAvatar";
import { copyText } from "@/lib/clipboard";
import type { ChannelRow, MemberRow } from "@/lib/data/db";
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

interface MessagesPage {
  messages: ChannelMessage[];
  hasMore: boolean;
  maxSeq: number;
}

const INK = "#141111";
const PAGE_LIMIT = 50;

const messageTime = (iso: string): string => {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return isToday ? time : `${d.toLocaleDateString()} ${time}`;
};

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

/** 消息动作栏（§3.2）：回复 thread / 引用 / 复制链接。 */
function MessageActions({
  message,
  onReply,
  onQuote,
  onCopyLink,
}: {
  message: ChannelMessage;
  onReply: (message: ChannelMessage) => void;
  onQuote: (message: ChannelMessage) => void;
  onCopyLink: (message: ChannelMessage) => void;
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
    </div>
  );
}

/** 顶层消息渲染行：头像 + 作者 + seq + 时间戳 + 内容 + hover 动作栏；右键 = Open Thread（§3.2）。 */
export function MessageRow({
  message,
  isAnchor,
  onReply,
  onQuote,
  onCopyLink,
}: {
  message: ChannelMessage;
  isAnchor?: boolean;
  onReply: (message: ChannelMessage) => void;
  onQuote: (message: ChannelMessage) => void;
  onCopyLink: (message: ChannelMessage) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="ws-message-row"
      onContextMenu={(e) => {
        e.preventDefault();
        onReply(message);
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
          <MessageActions message={message} onReply={onReply} onQuote={onQuote} onCopyLink={onCopyLink} />
        </div>
      </div>
    </div>
  );
}

/** 消息输入条：Enter 发送 / Shift+Enter 换行；引用 chip（§3.2 引用动作）。 */
export function Composer({
  targetId,
  disabled,
  disabledHint,
  quoting,
  onClearQuote,
  onSend,
}: {
  targetId: string;
  disabled: boolean;
  disabledHint: string;
  quoting: ChannelMessage | null;
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

  useEffect(() => {
    setMessages([]);
    setHasMore(false);
    setOpenThread(null);
    setQuoting(null);
    setHeldNotice(null);
    loadLatest();
  }, [channel?.id, loadLatest]);

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
    },
    [channel, openThread, maxSeq, threadMessages, loadLatest, loadThread, t],
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
                    onReply={(target) => void loadThread(target.id)}
                    onQuote={setQuoting}
                    onCopyLink={(target) => void handleCopyLink(target)}
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
            </>
          )
        ) : (
          <EmptyState
            glyph="✓"
            title={t("tasks.empty")}
            hint={t("tasks.emptyHint")}
          >
            <button
              type="button"
              disabled
              title={t("agent.pending")}
              style={{
                marginTop: 10,
                padding: "7px 14px",
                fontFamily: "var(--font-hanken)",
                fontWeight: 700,
                fontSize: 13,
                background: "#ffffff",
                color: "var(--text-dim)",
                border: `2px solid ${INK}`,
                cursor: "not-allowed",
                opacity: 0.55,
              }}
            >
              + {t("tasks.new")}
            </button>
          </EmptyState>
        )}
      </main>

      {/* 消息输入（§3.2） */}
      {channel && tab === "messages" && (
        <Composer
          targetId={channel.id}
          disabled={composerDisabled}
          disabledHint={composerDisabledHint}
          quoting={quoting}
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
              onReply={() => undefined}
              onQuote={setQuoting}
              onCopyLink={(target) => void handleCopyLink(target)}
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
    </div>
  );
}
