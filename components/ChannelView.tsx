"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlarmClock, Bell, BellOff, Check, CircleSlash, CornerDownRight, FileText, Kanban, Link, List, Paperclip, Pin, Quote, Reply, SmilePlus, TriangleAlert, Users, X } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import type { TranslationParams } from "@/lib/i18n/types";
import { MentionText } from "./MentionText";
import { PixelAvatar } from "./PixelAvatar";
import { StatusDot } from "./StatusDot";
import { ReminderModal } from "./ReminderModal";
import { copyText } from "@/lib/clipboard";
import { formatBytes, MAX_ATTACHMENT_BYTES, previewLine } from "@/lib/preview";
import { BUILTIN_CHANNEL_ID } from "@/lib/data/schema";
import type { AttachmentRow, ChannelRow, MemberRow, TaskStatus } from "@/lib/data/db";
import { extractAtQuery, buildAtInsertText, type AtQueryMatch } from "@/lib/file-fuzzy";
import { composerMentionCandidates } from "@/lib/mention";
import { memberPanel, subscribePinnedChanged, type PanelContent } from "@/lib/panel-state";

export type CenterTab = "messages" | "tasks";

export interface ChannelWithMeta extends ChannelRow {
  joined: boolean;
  memberCount: number;
  /** BAI-6 未读角标：Owner 在该频道的未读数（作者非本人且 seq > 已读游标）。 */
  unread: number;
}

/** §3.4 reaction 聚合（与 lib/raft/reactions.ts 同形）。 */
export interface ReactionSummary {
  emoji: string;
  count: number;
  memberIds: string[];
}

export interface ChannelMessage {
  id: string;
  target_id: string;
  seq: number;
  author_id: string;
  content: string;
  created_at: string;
  author: MemberRow | null;
  reactions?: ReactionSummary[];
  attachments?: AttachmentRow[];
  /** 线程回复数（thread 以锚点消息 id 为 target；>0 时锚点行显示角标，可点击展开）。 */
  threadReplyCount?: number;
  /** §09 「未回复（已放弃）」标记（服务端从 round_logs 派生，见 lib/raft/rounds.ts）。 */
  abandonedMarks?: Array<{
    agentId: string;
    agentName: string;
    reason: string;
    baseSeq: number;
    createdAt: string;
  }>;
}

/** §3.7 任务 = 消息 + 元数据：视图只显示状态，进展都在任务 thread。 */
interface ChannelTask {
  id: string;
  message_id: string;
  number: number;
  status: TaskStatus;
  owner_id: string | null;
  /** §3.7 重开封锁标记：置 1 期间 agent 不可自动认领，仅 Owner 认领接管。 */
  reopened: number;
  updated_at: string;
  channelId: string;
  anchor: ChannelMessage;
  owner: MemberRow | null;
  /** §3.7/ADR-0002 看板拖拽：服务端按当前身份推导的合法转移落点（与状态机一致，客户端不镜像）。 */
  reachable: TaskStatus[];
}

interface MessagesPage {
  messages: ChannelMessage[];
  hasMore: boolean;
  maxSeq: number;
}

/** §3.5 pinned 项（/api/channels/[id]/pinned 返回形态）。 */
export interface PinnedItem {
  message: ChannelMessage;
  order: number;
  pinnedAt: string;
}

const INK = "#141111";
const PAGE_LIMIT = 50;
/** agent-loop 回复轮询间隔（§5.4 demo：agent 回复落入消息流）。 */
const INBOX_POLL_MS = 3000;
/** @ 提及补全菜单最大展示条数。 */
const AT_MATCH_LIMIT = 20;
/** 任务板状态分组顺序（§3.7）。 */
const TASK_STATUS_ORDER: TaskStatus[] = ["todo", "in_progress", "in_review", "done", "closed"];
/** §3.4 hover 快捷 reaction（常用若干）。 */
const QUICK_REACTIONS = ["👍", "❤️", "🎉", "👀"];
/** §3.4 表情选择器候选（常用 + 任务场景）。 */
const EMOJI_PICKER_OPTIONS = [
  "👍", "👎", "❤️", "🎉", "👀", "🔥",
  "✅", "❌", "🙏", "🚀", "💡", "🤔",
  "😂", "😅", "😮", "😢", "😡", "🥳",
  "👏", "🙌", "🤝", "📌", "⏰", "🔧",
];

/** 消息动作按钮统一外框（§3.3 动作栏 + reaction 聚合条共用；全 lucide 13px，消灭文本字形宽差）。 */
const actionButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "3px 8px",
  minHeight: 26,
  fontFamily: "var(--font-hanken)",
  fontWeight: 700,
  fontSize: 11,
  background: "#ffffff",
  color: "var(--text)",
  border: `2px solid ${INK}`,
  boxShadow: "1px 1px 0 0 rgba(20, 17, 17, 0.4)",
  cursor: "pointer",
};

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

/** §3.4 表情选择器：点击外部 / Escape 关闭；选中即回调。 */
function EmojiPicker({
  onPick,
  onClose,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        zIndex: 60,
        width: 200,
        padding: 8,
        display: "grid",
        gridTemplateColumns: "repeat(6, 1fr)",
        gap: 4,
        background: "#ffffff",
        border: `2px solid ${INK}`,
        boxShadow: "4px 4px 0 0 rgba(20, 17, 17, 0.35)",
      }}
    >
      {EMOJI_PICKER_OPTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          title={emoji}
          onClick={() => onPick(emoji)}
          style={{
            width: 28,
            height: 28,
            fontSize: 16,
            lineHeight: 1,
            background: "transparent",
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
          {emoji}
        </button>
      ))}
    </div>
  );
}

/** §3.4 reaction 聚合条：显示在消息内容下方；已点高亮，点击切换。 */
function ReactionChips({
  reactions,
  currentMemberId,
  onToggle,
}: {
  reactions: ReactionSummary[];
  currentMemberId: string;
  onToggle: (emoji: string) => void;
}) {
  if (reactions.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
      {reactions.map((reaction) => {
        const mine = reaction.memberIds.includes(currentMemberId);
        return (
          <button
            key={reaction.emoji}
            type="button"
            onClick={() => onToggle(reaction.emoji)}
            style={{
              ...actionButtonStyle,
              gap: 5,
              background: mine ? "var(--yellow)" : "#ffffff",
            }}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>{reaction.emoji}</span>
            <span style={{ fontFamily: "var(--font-space-mono)", fontSize: 11 }}>{reaction.count}</span>
          </button>
        );
      })}
    </div>
  );
}

/** §3.5 附件列表：图片 inline 预览；text-like 点击展开文本预览；其余下载链接。 */
const TEXT_LIKE_MIMES = new Set([
  "application/json",
  "application/javascript",
  "application/xml",
  "application/yaml",
  "application/markdown",
  "application/toml",
]);
const TEXT_PREVIEW_MAX_CHARS = 100_000;

function isTextLike(mime: string): boolean {
  return mime.startsWith("text/") || TEXT_LIKE_MIMES.has(mime);
}

function AttachmentList({ attachments }: { attachments: AttachmentRow[] }) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  const togglePreview = async (attachment: AttachmentRow) => {
    if (previewId === attachment.id) {
      setPreviewId(null);
      return;
    }
    setPreviewId(attachment.id);
    setPreviewText(null);
    setPreviewFailed(false);
    try {
      const res = await fetch(`/api/attachments/${attachment.id}`);
      if (!res.ok) throw new Error(`preview: ${res.status}`);
      const text = await res.text();
      setPreviewText(text.length > TEXT_PREVIEW_MAX_CHARS ? `${text.slice(0, TEXT_PREVIEW_MAX_CHARS)}…` : text);
    } catch {
      setPreviewFailed(true);
    }
  };

  const chipStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    maxWidth: "100%",
    padding: "4px 10px",
    fontFamily: "var(--font-hanken)",
    fontWeight: 700,
    fontSize: 12,
    background: "#ffffff",
    color: "var(--text)",
    border: `2px solid ${INK}`,
    boxShadow: "1px 1px 0 0 rgba(20, 17, 17, 0.4)",
    textDecoration: "none",
    cursor: "pointer",
  };

  if (attachments.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
      {attachments.map((attachment) =>
        attachment.mime.startsWith("image/") ? (
          <div key={attachment.id}>
            <a href={`/api/attachments/${attachment.id}`} target="_blank" rel="noreferrer" title={attachment.file_name}>
              {/* eslint-disable-next-line @next/next/no-img-element -- 附件原图预览，不走 next/image 优化 */}
              <img
                src={`/api/attachments/${attachment.id}`}
                alt={attachment.file_name}
                style={{
                  display: "block",
                  maxWidth: 260,
                  maxHeight: 180,
                  objectFit: "contain",
                  background: "#ffffff",
                  border: `2px solid ${INK}`,
                  boxShadow: "2px 2px 0 0 rgba(20, 17, 17, 0.35)",
                }}
              />
            </a>
          </div>
        ) : isTextLike(attachment.mime) ? (
          <div key={attachment.id}>
            <button type="button" onClick={() => void togglePreview(attachment)} style={chipStyle}>
              <span><FileText size={12} style={{ verticalAlign: "-2px" }} /></span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {attachment.file_name}
              </span>
              <span style={{ fontFamily: "var(--font-space-mono)", fontSize: 10, color: "var(--text-muted)" }}>
                {formatBytes(attachment.size_bytes)}
              </span>
              <span style={{ fontFamily: "var(--font-space-mono)", fontSize: 10 }}>{previewId === attachment.id ? "▲" : "▼"}</span>
            </button>
            {previewId === attachment.id && (
              <pre
                style={{
                  margin: "4px 0 0",
                  maxHeight: 260,
                  overflow: "auto",
                  padding: "8px 10px",
                  background: "var(--bg)",
                  border: `2px solid ${INK}`,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {previewFailed ? (
                  <>
                    <TriangleAlert size={11} style={{ verticalAlign: "text-bottom" }} /> preview failed
                  </>
                ) : (
                  previewText ?? "…"
                )}
              </pre>
            )}
          </div>
        ) : (
          <a
            key={attachment.id}
            href={`/api/attachments/${attachment.id}`}
            download={attachment.file_name}
            style={chipStyle}
          >
            <span><Paperclip size={12} style={{ verticalAlign: "-2px" }} /></span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {attachment.file_name}
            </span>
            <span style={{ fontFamily: "var(--font-space-mono)", fontSize: 10, color: "var(--text-muted)" }}>
              {formatBytes(attachment.size_bytes)}
            </span>
          </a>
        ),
      )}
    </div>
  );
}

/** 消息动作栏（§3.2/§3.3）：hover 浮出；回复 / 引用 / 复制链接 / 设提醒（§5.6）/ Pin / emoji+（点开展开二级快捷 bar，再点开完整选择器）。 */
function MessageActions({
  message,
  onReply,
  onQuote,
  onCopyLink,
  onReminder,
  onToggleReaction,
  onTogglePin,
  pinned,
  reactOpen,
  onToggleReactOpen,
}: {
  message: ChannelMessage;
  onReply: (message: ChannelMessage) => void;
  onQuote: (message: ChannelMessage) => void;
  onCopyLink: (message: ChannelMessage) => void;
  onReminder?: (message: ChannelMessage) => void;
  onToggleReaction?: (message: ChannelMessage, emoji: string) => void;
  onTogglePin?: (message: ChannelMessage) => void;
  pinned?: boolean;
  reactOpen?: boolean;
  onToggleReactOpen?: () => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", position: "relative" }}>
      {onToggleReaction && onToggleReactOpen && (
        <button
          type="button"
          title={t("message.addReaction")}
          style={{ ...actionButtonStyle, background: reactOpen ? "var(--yellow)" : "#ffffff" }}
          onClick={onToggleReactOpen}
        >
          <SmilePlus size={13} />
        </button>
      )}
      <button
        type="button"
        title={t("message.reply")}
        style={actionButtonStyle}
        onClick={() => onReply(message)}
      >
        <Reply size={13} />
      </button>
      <button type="button" title={t("message.quote")} style={actionButtonStyle} onClick={() => onQuote(message)}>
        <Quote size={13} />
      </button>
      <button
        type="button"
        title={t("message.copyLink")}
        style={actionButtonStyle}
        onClick={() => {
          onCopyLink(message);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? <Check size={13} /> : <Link size={13} />}
      </button>
      {onReminder && (
        <button
          type="button"
          title={t("reminders.messageAction")}
          style={actionButtonStyle}
          onClick={() => onReminder(message)}
        >
          <AlarmClock size={13} />
        </button>
      )}
      {onTogglePin && (
        <button
          type="button"
          title={pinned ? t("message.unpin") : t("message.pin")}
          style={{ ...actionButtonStyle, background: pinned ? "var(--yellow)" : "#ffffff" }}
          onClick={() => onTogglePin(message)}
        >
          <Pin size={13} />
        </button>
      )}
      {reactOpen && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexBasis: "100%" }}>
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              title={t("message.react")}
              style={{ ...actionButtonStyle, fontSize: 13 }}
              onClick={() => onToggleReaction?.(message, emoji)}
            >
              {emoji}
            </button>
          ))}
          <span style={{ position: "relative", display: "inline-flex" }}>
            <button
              type="button"
              title={t("message.addReaction")}
              style={{ ...actionButtonStyle, fontSize: 12 }}
              onClick={() => setPickerOpen((open) => !open)}
            >
              ＋
            </button>
            {pickerOpen && (
              <EmojiPicker
                onPick={(emoji) => {
                  onToggleReaction?.(message, emoji);
                  setPickerOpen(false);
                }}
                onClose={() => setPickerOpen(false)}
              />
            )}
          </span>
        </div>
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

/** 顶层消息渲染行：头像 + 作者 + seq + 时间戳 + 内容 + reaction/附件 + hover 动作栏；右键 = 菜单（Open Thread / Convert to Task）。 */
export function MessageRow({
  message,
  isAnchor,
  canConvertToTask,
  currentMemberId,
  pinned,
  mentionMembers,
  onOpenMention,
  onOpenMember,
  onReply,
  onQuote,
  onCopyLink,
  onConvertToTask,
  onSetReminder,
  onToggleReaction,
  onTogglePin,
  onOpenThread,
}: {
  message: ChannelMessage;
  isAnchor?: boolean;
  canConvertToTask?: boolean;
  currentMemberId?: string;
  pinned?: boolean;
  mentionMembers?: Array<{ id: string; name: string; type: "agent" | "human" }>;
  onOpenMention?: (token: {
    memberId: string;
    name: string;
    isHuman: boolean;
    start: number;
    end: number;
  }) => void;
  /** §09 已放弃 badge 点击：打开该 agent 的面板（轮次记录在可观测页）。 */
  onOpenMember?: (memberId: string) => void;
  onReply: (message: ChannelMessage) => void;
  onQuote: (message: ChannelMessage) => void;
  onCopyLink: (message: ChannelMessage) => void;
  onConvertToTask?: (message: ChannelMessage) => void;
  onSetReminder?: (message: ChannelMessage) => void;
  onToggleReaction?: (message: ChannelMessage, emoji: string) => void;
  onTogglePin?: (message: ChannelMessage) => void;
  onOpenThread?: (message: ChannelMessage) => void;
}) {
  const { t } = useI18n();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [reactOpen, setReactOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!reactOpen) return;
    const close = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) setReactOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setReactOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [reactOpen]);
  const items = [
    { label: t("message.reply"), onClick: () => onReply(message) },
    ...(canConvertToTask && onConvertToTask
      ? [{ label: t("tasks.convert"), onClick: () => onConvertToTask(message) }]
      : []),
  ];
  return (
    <div
      className={isAnchor ? "ws-message-row ws-message-row-anchor" : "ws-message-row"}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      style={{
        display: "flex",
        gap: 10,
        padding: "10px 16px",
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
          {onOpenThread && (message.threadReplyCount ?? 0) > 0 && (
            <button
              type="button"
              title={t("message.openThreadBadge")}
              onClick={(e) => {
                e.stopPropagation();
                onOpenThread(message);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "1px 6px",
                fontFamily: "var(--font-space-mono)",
                fontSize: 10,
                fontWeight: 700,
                background: "var(--cyan)",
                color: "var(--text)",
                border: `2px solid ${INK}`,
                cursor: "pointer",
              }}
            >
              <CornerDownRight size={10} />
              {message.threadReplyCount}
            </button>
          )}
          {message.abandonedMarks && message.abandonedMarks.length > 0 && (
            <span
              title={message.abandonedMarks
                .map((mark) => `${mark.agentName}：${mark.reason || t("message.notReplied")}`)
                .join("；")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "1px 6px",
                fontFamily: "var(--font-space-mono)",
                fontSize: 10,
                fontWeight: 700,
                background: "var(--yellow)",
                color: "var(--text)",
                border: `2px solid ${INK}`,
                cursor: "pointer",
                userSelect: "none",
              }}
              onClick={(e) => {
                e.stopPropagation();
                onOpenMember?.(message.abandonedMarks![0].agentId);
              }}
            >
              <CircleSlash size={10} />
              {message.abandonedMarks.length > 1
                ? t("message.notRepliedMany", { count: String(message.abandonedMarks.length) })
                : t("message.notReplied")}
            </span>
          )}
        </div>
        <div className="ws-message-content" style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text)" }}>
          <MentionText
            content={message.content}
            members={mentionMembers}
            onOpenMember={onOpenMention}
          />
        </div>
        <AttachmentList attachments={message.attachments ?? []} />
        {currentMemberId && onToggleReaction && (
          <ReactionChips
            reactions={message.reactions ?? []}
            currentMemberId={currentMemberId}
            onToggle={(emoji) => onToggleReaction(message, emoji)}
          />
        )}
        <div
          ref={actionsRef}
          className={reactOpen ? "ws-message-actions ws-message-actions-open" : "ws-message-actions"}
          style={{ marginTop: 6 }}
        >
          <MessageActions
            message={message}
            onReply={onReply}
            onQuote={onQuote}
            onCopyLink={onCopyLink}
            onReminder={onSetReminder}
            onToggleReaction={onToggleReaction}
            onTogglePin={onTogglePin}
            pinned={pinned}
            reactOpen={reactOpen}
            onToggleReactOpen={() => setReactOpen((open) => !open)}
          />
        </div>
      </div>
      {menu && items.length > 0 && (
        <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}

/** §3.7 任务状态徽标样式（List 分组标题 / Board 列头共用）。 */
const taskBadgeStyle = (status: TaskStatus): React.CSSProperties => {
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

const taskCardButtonStyle: React.CSSProperties = {
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

/** 视图切换按钮样式（List | Board）。 */
const taskViewButtonStyle = (active: boolean): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "6px 10px",
  fontFamily: "var(--font-hanken)",
  fontWeight: 700,
  fontSize: 11,
  background: active ? "var(--yellow)" : "#ffffff",
  color: "var(--text)",
  border: `2px solid ${INK}`,
  boxShadow: "1px 1px 0 0 rgba(20, 17, 17, 0.4)",
  cursor: "pointer",
});

const TASK_VIEW_KEY = "worksplice-task-view";

/** 任务视图偏好（ADR-0002）：localStorage 全局记忆，默认列表。 */
function readTaskViewPref(): "list" | "board" {
  try {
    return window.localStorage.getItem(TASK_VIEW_KEY) === "board" ? "board" : "list";
  } catch {
    return "list";
  }
}

/** §3.7 任务卡片动作（List/Board 共用；与服务端状态机一致：互审 + owner 限定）。 */
function taskActionsFor(
  task: ChannelTask,
  currentMemberId: string,
  onAction: (task: ChannelTask, action: "claim" | "updateStatus", status?: TaskStatus) => void,
  t: (key: string, params?: TranslationParams) => string,
): Array<{ label: string; onClick: () => void }> {
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
}

/** §3.7 任务卡片（List/Board 共用）：#number + reopened 徽标 + 预览 + owner；点击打开任务 thread。 */
function TaskCard({
  task,
  currentMemberId,
  busy,
  onAction,
  onOpenThread,
  draggable = false,
  onDragStart,
  onDragEnd,
}: {
  task: ChannelTask;
  currentMemberId: string;
  busy: boolean;
  onAction: (task: ChannelTask, action: "claim" | "updateStatus", status?: TaskStatus) => void;
  onOpenThread: (anchor: ChannelMessage) => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>, task: ChannelTask) => void;
  onDragEnd?: () => void;
}) {
  const { t } = useI18n();
  const actions = taskActionsFor(task, currentMemberId, onAction, t);
  return (
    <div
      role="button"
      tabIndex={0}
      title={t("tasks.threadHint")}
      onClick={() => onOpenThread(task.anchor)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpenThread(task.anchor);
      }}
      draggable={draggable}
      onDragStart={onDragStart ? (e) => onDragStart(e, task) : undefined}
      onDragEnd={onDragEnd}
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
        {task.reopened === 1 && (
          <span
            title={t("tasks.reopenedHint")}
            style={{
              fontFamily: "var(--font-space-mono)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.06em",
              padding: "2px 7px",
              border: `2px solid ${INK}`,
              background: "var(--orange)",
              color: "#ffffff",
              whiteSpace: "nowrap",
            }}
          >
            {t("tasks.reopenedBadge")}
          </span>
        )}
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
              style={{ ...taskCardButtonStyle, opacity: busy ? 0.55 : 1, cursor: busy ? "not-allowed" : "pointer" }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 任务列表（§3.7 任务视图）：按状态分组纵向堆叠（原任务板视图，ADR-0002 后更名）。 */
function TaskList({
  tasks,
  currentMemberId,
  busy,
  onAction,
  onOpenThread,
}: {
  tasks: ChannelTask[];
  currentMemberId: string;
  busy: boolean;
  onAction: (task: ChannelTask, action: "claim" | "updateStatus", status?: TaskStatus) => void;
  onOpenThread: (anchor: ChannelMessage) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      {TASK_STATUS_ORDER.filter((status) => tasks.some((task) => task.status === status)).map((status) => {
        const group = tasks.filter((task) => task.status === status);
        return (
          <section key={status} style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={taskBadgeStyle(status)}>{t(`task.status.${status}`)}</span>
              <span style={{ fontFamily: "var(--font-space-mono)", fontSize: 11, color: "var(--text-dim)" }}>
                {group.length}
              </span>
              <span style={{ flex: 1, borderTop: `2px solid var(--border)` }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {group.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  currentMemberId={currentMemberId}
                  busy={busy}
                  onAction={onAction}
                  onOpenThread={onOpenThread}
                />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

/** 任务看板（§3.7 任务视图 / ADR-0002）：5 列 = 5 状态常显；跨列拖拽 = 请求一次状态转移（服务端裁决，不做乐观移动）。 */
function TaskBoard({
  tasks,
  currentMemberId,
  busy,
  onAction,
  onOpenThread,
  onInvalidDrop,
}: {
  tasks: ChannelTask[];
  currentMemberId: string;
  busy: boolean;
  onAction: (task: ChannelTask, action: "claim" | "updateStatus", status?: TaskStatus) => void;
  onOpenThread: (anchor: ChannelMessage) => void;
  onInvalidDrop: (task: ChannelTask, status: TaskStatus) => void;
}) {
  const { t } = useI18n();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);
  const dragTask = dragId ? tasks.find((task) => task.id === dragId) ?? null : null;

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, task: ChannelTask) => {
    if (busy) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData("text/plain", task.id);
    e.dataTransfer.effectAllowed = "move";
    setDragId(task.id);
  };

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        gap: 12,
        alignItems: "stretch",
        overflowX: "auto",
        overflowY: "auto",
        paddingBottom: 8,
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      {TASK_STATUS_ORDER.map((status) => {
        const group = tasks.filter((task) => task.status === status);
        const validTarget = dragTask !== null && status !== dragTask.status && dragTask.reachable.includes(status);
        const active = validTarget && dragOver === status;
        const invalid =
          dragTask !== null && status !== dragTask.status && dragOver === status && !dragTask.reachable.includes(status);
        return (
          <div
            key={status}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(status);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const id = e.dataTransfer.getData("text/plain");
              const task = tasks.find((x) => x.id === id) ?? null;
              setDragId(null);
              if (!task || task.status === status) return;
              if (!task.reachable.includes(status)) {
                onInvalidDrop(task, status);
                return;
              }
              onAction(task, "updateStatus", status);
            }}
            style={{
              flex: "0 0 236px",
              display: "flex",
              flexDirection: "column",
              background: invalid ? "var(--coral)" : active ? "var(--yellow)" : "var(--bg-panel)",
              border: `2px solid ${active || invalid ? "var(--accent)" : INK}`,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderBottom: `2px solid ${INK}`,
              }}
            >
              <span style={taskBadgeStyle(status)}>{t(`task.status.${status}`)}</span>
              <span style={{ fontFamily: "var(--font-space-mono)", fontSize: 11, color: "var(--text-dim)" }}>
                {group.length}
              </span>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, padding: 8, minHeight: 64 }}>
              {group.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  currentMemberId={currentMemberId}
                  busy={busy}
                  onAction={onAction}
                  onOpenThread={onOpenThread}
                  draggable={!busy}
                  onDragStart={handleDragStart}
                  onDragEnd={() => {
                    setDragId(null);
                    setDragOver(null);
                  }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 任务视图容器（§3.7/ADR-0002）：创建栏 + List|Board 切换（localStorage 记忆）+ 视图；两者共享同一批任务数据。 */
export function TaskViews({
  tasks,
  currentMemberId,
  busy,
  disabled,
  error,
  notice,
  onCreateTask,
  onAction,
  onOpenThread,
  onNotice,
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
  onNotice: (message: string) => void;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<"list" | "board">(readTaskViewPref);
  const [formOpen, setFormOpen] = useState(false);
  const [content, setContent] = useState("");

  const switchView = (next: "list" | "board") => {
    setView(next);
    try {
      window.localStorage.setItem(TASK_VIEW_KEY, next);
    } catch {
      // 存储失败不影响本次会话内的切换。
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
    <div
      style={{
        // 看板模式：板面撑满 main 剩余高度并在面板内滚动，横向滚动条钉在可视区域底部
        // （否则滚动条随内容沉底，需要先滚到底才看得到）
        padding: "12px 16px 24px",
        ...(view === "board" ? { height: "100%", display: "flex", flexDirection: "column", minHeight: 0 } : {}),
      }}
    >
      {/* 创建途径 3：Tasks tab Create Task；右侧 List|Board 视图切换（ADR-0002） */}
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
              style={{ ...taskCardButtonStyle, padding: "9px 14px", background: "var(--pink)" }}
            >
              {t("tasks.create")}
            </button>
            <button type="button" style={taskCardButtonStyle} onClick={() => setFormOpen(false)}>
              {t("tasks.cancel")}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setFormOpen(true)}
            style={{ ...taskCardButtonStyle, padding: "8px 14px", background: "var(--pink)" }}
          >
            + {t("tasks.new")}
          </button>
        )}
        {notice && (
          <span style={{ fontFamily: "var(--font-space-mono)", fontSize: 12, color: "var(--text-muted)" }}>
            {notice}
          </span>
        )}
        <div role="tablist" aria-label={t("tasks.view")} style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          <button
            type="button"
            role="tab"
            aria-selected={view === "list"}
            onClick={() => switchView("list")}
            style={taskViewButtonStyle(view === "list")}
          >
            <List size={13} /> {t("tasks.viewList")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "board"}
            onClick={() => switchView("board")}
            style={taskViewButtonStyle(view === "board")}
          >
            <Kanban size={13} /> {t("tasks.viewBoard")}
          </button>
        </div>
      </div>
      {error && <div style={{ marginBottom: 12, color: "var(--coral)", fontSize: 12 }}>{error}</div>}

      {tasks.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
          {t("tasks.emptyHint")}
        </div>
      ) : view === "list" ? (
        <TaskList
          tasks={tasks}
          currentMemberId={currentMemberId}
          busy={busy}
          onAction={onAction}
          onOpenThread={onOpenThread}
        />
      ) : (
        <TaskBoard
          tasks={tasks}
          currentMemberId={currentMemberId}
          busy={busy}
          onAction={onAction}
          onOpenThread={onOpenThread}
          onInvalidDrop={(task, status) =>
            onNotice(
              t("tasks.dropInvalid", {
                from: t(`task.status.${task.status}`),
                to: t(`task.status.${status}`),
              }),
            )
          }
        />
      )}
    </div>
  );
}

/** 消息输入条：Enter 发送 / Shift+Enter 换行；引用 chip（§3.2 引用动作）；As Task 勾选（§3.7 创建途径 2）；附件（§3.5）。 */
export function Composer({
  targetId,
  disabled,
  disabledHint,
  quoting,
  asTask,
  onAsTaskChange,
  onClearQuote,
  onSend,
  members,
}: {
  targetId: string;
  disabled: boolean;
  disabledHint: string;
  quoting: ChannelMessage | null;
  asTask?: boolean;
  onAsTaskChange?: (checked: boolean) => void;
  onClearQuote: () => void;
  onSend: (targetId: string, content: string, quoteId?: string, files?: File[]) => Promise<unknown>;
  members?: Array<{ id: string; name: string; status: MemberRow["status"]; joined: boolean }>;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // §3.2 @ 提及补全：镜像 ChatInput 的 @ token 模式（extractAtQuery / 键盘导航 / 引号形式插入）
  const [atQuery, setAtQuery] = useState<AtQueryMatch | null>(null);
  const [atMenuOpen, setAtMenuOpen] = useState(false);
  const [atActiveIndex, setAtActiveIndex] = useState(0);
  const atItemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const updateAtQuery = useCallback((text: string, cursor: number | null) => {
    if (cursor === null) {
      setAtQuery(null);
      return;
    }
    setAtQuery(extractAtQuery(text.slice(0, cursor)));
  }, []);

  const atTokenKey = atQuery === null ? null : `${atQuery.start}:${atQuery.quoted ? 1 : 0}:${atQuery.query}`;
  useEffect(() => {
    if (atTokenKey === null) {
      setAtMenuOpen(false);
      setAtActiveIndex(0);
      return;
    }
    setAtMenuOpen(true);
    setAtActiveIndex(0);
  }, [atTokenKey]);

  const atMatches = useMemo(() => {
    if (!members) return [];
    const query = (atQuery?.query ?? "").toLowerCase();
    if (!query) return members.slice(0, AT_MATCH_LIMIT);
    return members
      .map((m) => {
        const name = m.name.toLowerCase();
        let score = 0;
        if (name === query) score = 100;
        else if (name.startsWith(query)) score = 80;
        else if (name.includes(query)) score = 50;
        else if (name.split(/\s+/).some((part) => part.startsWith(query))) score = 40;
        return { m, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.m.name.localeCompare(b.m.name))
      .slice(0, AT_MATCH_LIMIT)
      .map((x) => x.m);
  }, [members, atQuery?.query]);

  useEffect(() => {
    atItemRefs.current[atActiveIndex]?.scrollIntoView({ block: "nearest" });
  }, [atActiveIndex, atMenuOpen]);

  const applyAtCompletion = useCallback(
    (member: { id: string; name: string; status: MemberRow["status"]; joined: boolean }) => {
      if (!atQuery) return;
      const ta = textareaRef.current;
      const cursor = ta?.selectionStart ?? value.length;
      const before = value.slice(0, atQuery.start);
      let after = value.slice(cursor);
      // 引号 token 内补全：替换自带收尾引号，去掉光标后残留的旧引号（镜像 ChatInput）
      if (atQuery.quoted && after.startsWith('"')) {
        after = after.slice(1);
      }
      const insert = buildAtInsertText(member.name, false);
      const newValue = before + insert.text + after;
      const newPos = before.length + insert.cursorOffset;
      setValue(newValue);
      setAtQuery(extractAtQuery(newValue.slice(0, newPos)));
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(newPos, newPos);
      });
    },
    [atQuery, value],
  );

  const addFiles = (picked: FileList | null) => {
    if (!picked || picked.length === 0) return;
    const oversized = [...picked].filter((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (oversized.length > 0) {
      setError(t("attachments.tooBig", { name: oversized[0].name }));
      return;
    }
    setFiles((prev) => [...prev, ...picked]);
    setError(null);
  };

  const submit = async () => {
    const content = value.trim();
    if ((!content && files.length === 0) || busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(targetId, content, quoting?.id, files.length > 0 ? files : undefined);
      setValue("");
      setFiles([]);
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
            <Quote size={12} style={{ verticalAlign: "-2px" }} /> #{quoting.seq} {quoting.author?.name ?? t("message.unknownAuthor")}:{" "}
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
            <X size={12} style={{ display: "block", margin: "auto" }} />
          </button>
        </div>
      )}
      {files.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {files.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 8px",
                background: "var(--cyan)",
                border: `2px solid ${INK}`,
                fontFamily: "var(--font-space-mono)",
                fontSize: 11,
              }}
            >
              <span style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <Paperclip size={11} style={{ verticalAlign: "-2px" }} /> {file.name}
              </span>
              <span style={{ color: "var(--text-muted)" }}>{formatBytes(file.size)}</span>
              <button
                type="button"
                aria-label={t("attachments.remove")}
                onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                style={{
                  width: 18,
                  height: 18,
                  background: "#ffffff",
                  border: `2px solid ${INK}`,
                  cursor: "pointer",
                  fontSize: 10,
                  lineHeight: 1,
                }}
              >
                <X size={10} style={{ display: "block", margin: "auto" }} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div style={{ position: "relative", flex: 1, display: "flex" }}>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              updateAtQuery(e.target.value, e.target.selectionStart);
            }}
            onKeyDown={(e) => {
              // @ 提及补全键盘导航（IME 组合期不拦截，镜像 ChatInput）
              if (atMenuOpen && atQuery !== null && !e.nativeEvent.isComposing) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setAtActiveIndex((i) => Math.min(Math.max(0, atMatches.length - 1), i + 1));
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setAtActiveIndex((i) => Math.max(0, i - 1));
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setAtMenuOpen(false);
                  return;
                }
                if ((e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) && atMatches[atActiveIndex]) {
                  e.preventDefault();
                  applyAtCompletion(atMatches[atActiveIndex]);
                  return;
                }
              }
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
          {atMenuOpen && atQuery !== null && !disabled && (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "calc(100% + 6px)",
                zIndex: 40,
                background: "var(--bg)",
                border: `2px solid ${INK}`,
                boxShadow: "2px 2px 0 0 rgba(20, 17, 17, 0.4)",
                maxHeight: 260,
                overflowY: "auto",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "6px 10px",
                  borderBottom: `1px solid ${INK}`,
                  fontFamily: "var(--font-hanken)",
                  fontWeight: 700,
                  fontSize: 11,
                }}
              >
                <span>{t("mention.title")}</span>
                <span style={{ fontFamily: "var(--font-space-mono)", fontWeight: 400, color: "var(--text-muted)" }}>
                  {t("chat.tabEnter")}
                </span>
              </div>
              {atMatches.length === 0 ? (
                <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--text-muted)" }}>
                  {t("mention.noMatch")}
                </div>
              ) : (
                atMatches.map((member, index) => {
                  const active = index === atActiveIndex;
                  return (
                    <button
                      key={member.id}
                      ref={(node) => {
                        atItemRefs.current[index] = node;
                      }}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyAtCompletion(member);
                      }}
                      onMouseEnter={() => setAtActiveIndex(index)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 10px",
                        border: "none",
                        borderBottom: index < atMatches.length - 1 ? `1px solid ${INK}` : "none",
                        background: active ? "var(--cyan)" : "#ffffff",
                        color: "var(--text)",
                        cursor: "pointer",
                        textAlign: "left",
                        fontFamily: "var(--font-hanken)",
                        fontWeight: 700,
                        fontSize: 12,
                      }}
                    >
                      <StatusDot status={member.status} />
                      <span>@{member.name}</span>
                      {!member.joined && (
                        <span
                          style={{
                            marginLeft: "auto",
                            fontFamily: "var(--font-space-mono)",
                            fontSize: 10,
                            color: "var(--text-muted)",
                          }}
                        >
                          {t("mention.notJoined")}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
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
            title={t("attachments.attach")}
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: 30,
              padding: "0 8px",
              fontFamily: "var(--font-hanken)",
              fontWeight: 700,
              fontSize: 13,
              background: "#ffffff",
              color: "var(--ink)",
              border: `2px solid ${INK}`,
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.55 : 1,
            }}
          >
            <Paperclip size={15} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={disabled || busy || (!value.trim() && files.length === 0)}
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
              cursor: disabled || busy || (!value.trim() && files.length === 0) ? "not-allowed" : "pointer",
              opacity: disabled || busy || (!value.trim() && files.length === 0) ? 0.55 : 1,
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

/** 中央：channel 消息流 / Tasks tab（§3.1）。ticket 04 起承载消息闭环：发送/分页/引用/复制链接。ticket 13 起线程迁出至右栏面板（onOpenPanel）。 */
export function ChannelView({
  channel,
  tab,
  onTabChange,
  currentMemberId,
  onChannelChanged,
  focusMessageId,
  agents = [],
  owner = null,
  onOpenPanel,
}: {
  channel: ChannelWithMeta | null;
  tab: CenterTab;
  onTabChange: (tab: CenterTab) => void;
  currentMemberId: string;
  onChannelChanged: () => void;
  focusMessageId?: string | null;
  agents?: MemberRow[];
  owner?: MemberRow | null;
  /** 打开右栏面板（ticket 13）：agent / human / thread 单槽替换；中央频道消息流不动。 */
  onOpenPanel?: (content: PanelContent) => void;
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

  // 引用态（ticket 13 线程迁出后变为 channel 局部——线程引用在面板 ThreadPanel 内自持）
  const [quoting, setQuoting] = useState<ChannelMessage | null>(null);

  // §3.5 pinned 区：当前成员在该 channel 的个性化 pinned
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [pinnedSort, setPinnedSort] = useState<"manual" | "recent" | "az">("manual");
  const [pinnedItems, setPinnedItems] = useState<PinnedItem[]>([]);
  const [pinnedError, setPinnedError] = useState<string | null>(null);

  // §3.2 mute 面板：channel 内 agent 成员的通知静音开关（静音后普通消息不进 inbox，@mention 穿透）
  const [muteOpen, setMuteOpen] = useState(false);
  const [mutes, setMutes] = useState<Array<{ memberId: string; name: string; muted: boolean }>>([]);
  const [muteNotice, setMuteNotice] = useState<string | null>(null);

  // 👥 频道成员面板：channel 内 agent 列表（状态点）+ Owner 替 agent 加入/移除
  const [membersOpen, setMembersOpen] = useState(false);
  const [channelMemberIds, setChannelMemberIds] = useState<Set<string>>(new Set());
  const [membersError, setMembersError] = useState<string | null>(null);
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberNotice, setMemberNotice] = useState<string | null>(null);

  /** 频道内 agent 成员（状态取自全量 agents，SSE 实时）；@ 补全候选 = 全部 agent + joined 标记。 */
  const channelAgents = useMemo(
    () => agents.filter((a) => channelMemberIds.has(a.id)),
    [agents, channelMemberIds],
  );
  /** 频道内全部成员（agent + 人类）：数量与成员面板共用——agent 删除后随 agents prop 刷新即更新，人类始终可见。 */
  const channelMembers = useMemo(() => {
    const members = agents.filter((a) => channelMemberIds.has(a.id));
    return owner && channelMemberIds.has(owner.id) ? [...members, owner] : members;
  }, [agents, owner, channelMemberIds]);
  const mentionable = useMemo(
    () =>
      agents.map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        joined: channelMemberIds.has(a.id),
      })),
    [agents, channelMemberIds],
  );
  /** Composer @ 补全候选 = 频道成员 agent（§3.2；非成员不列入菜单，手输名字仍可穿透唤醒）。 */
  const composerMembers = useMemo(
    () => composerMentionCandidates(agents, channelMemberIds),
    [agents, channelMemberIds],
  );

  // §3.2 mention 渲染成员表（agents + owner 全量，高亮解析用）
  const mentionMembers = useMemo(
    () =>
      [...agents, ...(owner ? [owner] : [])].map((m) => ({
        id: m.id,
        name: m.name,
        type: m.type,
      })),
    [agents, owner],
  );

  /** mention 点击（§3.2）：agent / 人类都进右栏面板（ticket 13 人类简介弹窗已删除）。 */
  const openMention = useCallback(
    (token: { memberId: string; name: string; isHuman: boolean }) => {
      onOpenPanel?.(memberPanel(token.memberId, token.isHuman));
    },
    [onOpenPanel],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  /** 消息流滚动位置保存（tasks 与 messages 共用一个 main 滚动容器：切到任务板时内容变矮，
   *  浏览器会把 scrollTop 钳制到 0，切回来即丢位置——切走前按 channel 记下，切回时恢复）。 */
  const savedScrollRef = useRef<{ channelId: string; top: number } | null>(null);

  const handleTabChange = useCallback(
    (next: CenterTab) => {
      if (tab === "messages" && next !== "messages") {
        savedScrollRef.current = {
          channelId: channel?.id ?? "",
          top: scrollRef.current?.scrollTop ?? 0,
        };
      }
      onTabChange(next);
    },
    [tab, channel?.id, onTabChange],
  );

  useLayoutEffect(() => {
    if (tab !== "messages") return;
    const saved = savedScrollRef.current;
    if (!saved || saved.channelId !== channel?.id) return;
    savedScrollRef.current = null;
    scrollRef.current?.scrollTo({ top: saved.top });
  }, [tab, channel?.id]);

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

  /** §3.5 pinned 列表加载（当前成员的个性化 pinned，排序三选一）。 */
  const loadPinned = useCallback(() => {
    if (!channel) {
      setPinnedItems([]);
      return;
    }
    void fetch(`/api/channels/${encodeURIComponent(channel.id)}/pinned?sort=${pinnedSort}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET pinned: ${res.status}`);
        const body = (await res.json()) as { pinned?: PinnedItem[] };
        setPinnedItems(body.pinned ?? []);
        setPinnedError(null);
      })
      .catch((e) => setPinnedError(e instanceof Error ? e.message : String(e)));
  }, [channel, pinnedSort]);

  // ticket 13：面板线程内 pin/unpin 后刷新本频道 pinned 列表（服务端事实，中央/面板双端自洽）
  useEffect(() => subscribePinnedChanged(() => loadPinned()), [loadPinned]);

  /** §3.2 mute 状态加载（channel 内全部 agent 成员的静音开关）。 */
  const loadMutes = useCallback(() => {
    if (!channel) {
      setMutes([]);
      return;
    }
    void fetch(`/api/channels/${encodeURIComponent(channel.id)}/mute`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET mutes: ${res.status}`);
        const body = (await res.json()) as {
          mutes?: Array<{ memberId: string; name: string; muted: boolean }>;
        };
        setMutes(body.mutes ?? []);
      })
      .catch(() => undefined);
  }, [channel]);

  /** 👥 频道成员加载（channel 内成员 id 集合）。 */
  const loadMembers = useCallback(() => {
    if (!channel) {
      setChannelMemberIds(new Set());
      return;
    }
    void fetch(`/api/channels/${encodeURIComponent(channel.id)}/members`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET members: ${res.status}`);
        const body = (await res.json()) as { members?: MemberRow[] };
        setChannelMemberIds(new Set((body.members ?? []).map((m) => m.id)));
        setMembersError(null);
      })
      .catch((e) => setMembersError(e instanceof Error ? e.message : String(e)));
  }, [channel]);

  /** 👥 Owner 替 agent 加入频道（公开/私有均可；#all 已全员加入，按钮不出现）。 */
  const addChannelMember = async (member: MemberRow) => {
    if (!channel) return;
    setMemberBusy(true);
    setMemberNotice(null);
    try {
      const res = await fetch(`/api/channels/${encodeURIComponent(channel.id)}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: member.id }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "join failed");
      }
      setChannelMemberIds((prev) => new Set(prev).add(member.id));
      setMemberNotice(t("mention.added", { name: member.name }));
    } catch (e) {
      setMemberNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setMemberBusy(false);
    }
  };

  /** 👥 Owner 从频道移除 agent（#all 不可移除）。 */
  const removeChannelMember = async (member: MemberRow) => {
    if (!channel) return;
    setMemberBusy(true);
    setMemberNotice(null);
    try {
      const res = await fetch(`/api/channels/${encodeURIComponent(channel.id)}/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: member.id }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "leave failed");
      }
      setChannelMemberIds((prev) => {
        const next = new Set(prev);
        next.delete(member.id);
        return next;
      });
      setMemberNotice(t("mention.removed", { name: member.name }));
    } catch (e) {
      setMemberNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setMemberBusy(false);
    }
  };

  useEffect(() => {
    setMessages([]);
    setHasMore(false);
    setQuoting(null);
    setHeldNotice(null);
    setTasks([]);
    setTasksError(null);
    setTaskNotice(null);
    setPinnedOpen(false);
    setPinnedItems([]);
    setMuteOpen(false);
    setMutes([]);
    setMuteNotice(null);
    setMembersOpen(false);
    setChannelMemberIds(new Set());
    setMembersError(null);
    setMemberNotice(null);
    loadLatest();
    // 任务板常驻加载：messages tab 的右键 Convert 依赖 canConvertToTask 判定
    loadTasks();
    loadPinned();
    loadMutes();
    loadMembers();
  }, [channel?.id, loadLatest, loadTasks, loadPinned, loadMutes, loadMembers]);

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
  }, [messages.length]);

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

  const handleSend = useCallback(
    async (targetId: string, content: string, quoteId?: string, files?: File[]) => {
      if (!channel) return;
      const baseSeq = maxSeq;
      let res: Response;
      if (files && files.length > 0) {
        // §3.5 附件随消息一起 multipart 提交：一次请求原子完成（held 时服务端不落盘）。
        const form = new FormData();
        form.append("targetId", targetId);
        form.append("content", content);
        form.append("baseSeq", String(baseSeq));
        if (quoteId) form.append("quoteId", quoteId);
        for (const file of files) form.append("files", file);
        res = await fetch("/api/messages", { method: "POST", body: form });
      } else {
        res = await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetId,
            content,
            quoteId,
            baseSeq,
          }),
        });
      }
      const body = (await res.json().catch(() => ({}))) as {
        message?: ChannelMessage;
        held?: boolean;
        whatHappened?: string;
        error?: string;
      };
      if (!res.ok) {
        if (body.held) {
          setHeldNotice(body.whatHappened ?? "held");
          loadLatest();
          throw new Error(t("message.held"));
        }
        throw new Error(body.error ?? `POST messages: ${res.status}`);
      }
      if (body.message) {
        setMessages((prev) => [...prev, body.message as ChannelMessage]);
        setMaxSeq((prev) => Math.max(prev, (body.message as ChannelMessage).seq));
      }
      setQuoting(null);
      // §3.7 创建途径 2：发送时勾 As Task → 发送成功后转为任务
      if (asTask && body.message) {
        const converted = await convertMessageToTask(body.message);
        if (converted) setAsTask(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channel, maxSeq, loadLatest, t, asTask],
  );

  /** §3.4 reaction 切换：POST 后把返回的聚合写回消息状态（channel 局部；线程在面板内自持）。 */
  const toggleReaction = useCallback(
    async (message: ChannelMessage, emoji: string) => {
      try {
        const res = await fetch(`/api/messages/${encodeURIComponent(message.id)}/reactions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emoji }),
        });
        if (!res.ok) throw new Error(`reaction: ${res.status}`);
        const body = (await res.json()) as { reactions?: ReactionSummary[] };
        if (!body.reactions) return;
        setMessages((prev) =>
          prev.map((m) => (m.id === message.id ? { ...m, reactions: body.reactions } : m)),
        );
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    },
    [],
  );

  /** §3.5 pin / unpin：切换后重拉 pinned 列表（按钮态 = pinnedItems 含该消息）。 */
  const togglePin = useCallback(
    async (message: ChannelMessage) => {
      if (!channel) return;
      const alreadyPinned = pinnedItems.some((item) => item.message.id === message.id);
      try {
        const res = alreadyPinned
          ? await fetch(`/api/channels/${encodeURIComponent(channel.id)}/pinned?messageId=${message.id}`, {
              method: "DELETE",
            })
          : await fetch(`/api/channels/${encodeURIComponent(channel.id)}/pinned`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ messageId: message.id }),
            });
        if (!res.ok) throw new Error(`pin: ${res.status}`);
        loadPinned();
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    },
    [channel, pinnedItems, loadPinned],
  );

  /** §3.5 Manual 排序：↑/↓ 交换相邻位置后提交重排。 */
  const movePinned = useCallback(
    async (index: number, direction: -1 | 1) => {
      if (!channel) return;
      const target = index + direction;
      if (target < 0 || target >= pinnedItems.length) return;
      const reordered = [...pinnedItems];
      const [moved] = reordered.splice(index, 1);
      reordered.splice(target, 0, moved);
      const order = reordered.map((item) => item.message.id);
      try {
        const res = await fetch(`/api/channels/${encodeURIComponent(channel.id)}/pinned/reorder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order }),
        });
        if (!res.ok) throw new Error(`reorder: ${res.status}`);
        loadPinned();
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    },
    [channel, pinnedItems, loadPinned],
  );

  /** 打开 pinned 消息：channel 消息滚动定位；thread 消息在右栏面板打开其线程（ticket 13）。 */
  const openPinnedMessage = useCallback(
    (message: ChannelMessage) => {
      if (message.target_id === channel?.id) {
        const already = messages.some((m) => m.id === message.id);
        if (already) {
          document.getElementById(`msg-${message.id}`)?.scrollIntoView({ block: "center" });
          return;
        }
        void loadPage(channel.id, message.seq + 1).then((page) => {
          setMessages((prev) => {
            const merged = [...prev, ...page.messages.filter((m) => !prev.some((p) => p.id === m.id))];
            return merged.sort((a, b) => a.seq - b.seq);
          });
          requestAnimationFrame(() => {
            document.getElementById(`msg-${message.id}`)?.scrollIntoView({ block: "center" });
          });
        });
      } else {
        onOpenPanel?.({ kind: "thread", id: message.target_id });
      }
    },
    [channel, messages, loadPage, onOpenPanel],
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

  // 深链：hash `#c/<channelId>?m=<messageId>` → 打开对应消息（thread 消息在右栏面板展开其线程）
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
          onOpenPanel?.({ kind: "thread", id: target.target_id });
        }
      })
      .catch(() => undefined);
  }, [channel, focusMessageId, loadPage, onOpenPanel]);

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

  /** §3.2 mute 开关：静音后该 agent 的 inbox 收不到普通消息，个人 @mention 仍穿透。 */
  const toggleMute = async (m: { memberId: string; name: string; muted: boolean }) => {
    if (!channel) return;
    const next = !m.muted;
    try {
      const res = await fetch(`/api/channels/${encodeURIComponent(channel.id)}/mute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: m.memberId, muted: next }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "mute failed");
      }
      setMutes((prev) => prev.map((x) => (x.memberId === m.memberId ? { ...x, muted: next } : x)));
      setMuteNotice(t(next ? "mute.toastMuted" : "mute.toastUnmuted", { name: m.name }));
    } catch (e) {
      setMuteNotice(e instanceof Error ? e.message : String(e));
    }
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
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
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
                <AlarmClock size={14} />
              </button>
            )}
            {joined && (
              <button
                type="button"
                title={t("pinned.toggle")}
                style={{ ...actionButton, background: pinnedOpen ? "var(--yellow)" : "#ffffff" }}
                onClick={() => setPinnedOpen((open) => !open)}
              >
                <Pin size={14} /> {pinnedItems.length > 0 ? pinnedItems.length : ""}
              </button>
            )}
            {joined && (
              <button
                type="button"
                title={t("mute.toggle")}
                style={{ ...actionButton, background: muteOpen || mutes.some((m) => m.muted) ? "var(--yellow)" : "#ffffff" }}
                onClick={() => setMuteOpen((open) => !open)}
              >
                <BellOff size={14} /> {mutes.filter((m) => m.muted).length > 0 ? mutes.filter((m) => m.muted).length : ""}
              </button>
            )}
            {joined && (
              <button
                type="button"
                title={t("channel.membersPanel")}
                style={{ ...actionButton, background: membersOpen ? "var(--yellow)" : "#ffffff" }}
                onClick={() => setMembersOpen((open) => !open)}
              >
                <Users size={14} /> {channelMembers.length > 0 ? channelMembers.length : ""}
              </button>
            )}
          </div>
        )}
      </header>

      {/* §3.2 mute 面板（channel 头部可展开）：静音后普通消息不进 inbox，个人 @mention 仍穿透 */}
      {muteOpen && joined && (
        <div
          style={{
            flexShrink: 0,
            padding: "8px 16px 12px",
            borderBottom: `2px solid ${INK}`,
            background: "var(--bg)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--font-hanken)", fontWeight: 700, fontSize: 13 }}>
              {t("mute.toggle")}
            </span>
            <span style={{ fontFamily: "var(--font-space-mono)", fontSize: 11, color: "var(--text-muted)" }}>
              {t("mute.hint")}
            </span>
          </div>
          {mutes.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("mute.none")}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
              {mutes.map((m) => (
                <button
                  key={m.memberId}
                  type="button"
                  title={t(m.muted ? "mute.unmuteFor" : "mute.for", { name: m.name })}
                  style={{ ...actionButton, background: m.muted ? "var(--yellow)" : "#ffffff" }}
                  onClick={() => void toggleMute(m)}
                >
                  {m.muted ? <BellOff size={12} /> : <Bell size={12} />} @{m.name}{" "}
                  <span style={{ fontFamily: "var(--font-space-mono)", fontSize: 10, opacity: 0.75 }}>
                    {m.muted ? t("mute.muted") : t("mute.unmuted")}
                  </span>
                </button>
              ))}
            </div>
          )}
          {muteNotice && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>{muteNotice}</div>
          )}
        </div>
      )}

      {/* 👥 频道成员面板（channel 头部可展开）：全部成员（agent 点击进详情 + 移除；人类点击看简介弹窗）+ 添加成员 */}
      {channel && membersOpen && joined && (
        <div
          style={{
            flexShrink: 0,
            padding: "8px 16px 12px",
            borderBottom: `2px solid ${INK}`,
            background: "var(--bg)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--font-hanken)", fontWeight: 700, fontSize: 13 }}>
              {t("channel.membersPanel")}
            </span>
            <span style={{ fontFamily: "var(--font-space-mono)", fontSize: 11, color: "var(--text-muted)" }}>
              {t("mention.hint")}
            </span>
          </div>
          {membersError && (
            <div style={{ marginBottom: 8, fontSize: 12, color: "var(--coral)" }}>{membersError}</div>
          )}
          {channelMembers.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("channel.membersEmpty")}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
              {channelMembers.map((member) => (
                <div key={member.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    type="button"
                    title={member.description || member.name}
                    onClick={() =>
                      onOpenPanel?.({
                        kind: member.type === "human" ? "human" : "agent",
                        id: member.id,
                      })
                    }
                    style={{ ...actionButton, display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <StatusDot status={member.status} />
                    {member.name}
                  </button>
                  {member.type === "agent" && channel.id !== BUILTIN_CHANNEL_ID && (
                    <button
                      type="button"
                      title={t("mention.remove", { name: member.name })}
                      disabled={memberBusy}
                      onClick={() => void removeChannelMember(member)}
                      style={{ ...actionButton, padding: "4px 7px", fontSize: 10, opacity: memberBusy ? 0.55 : 1 }}
                    >
                      <X size={11} style={{ display: "block", margin: "auto" }} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {channel.id !== BUILTIN_CHANNEL_ID && (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 10,
                  paddingTop: 8,
                  borderTop: `1px dashed ${INK}`,
                }}
              >
                <span style={{ fontFamily: "var(--font-hanken)", fontWeight: 700, fontSize: 12 }}>
                  {t("mention.addTitle")}
                </span>
                {mentionable.length === channelAgents.length ? (
                  <span style={{ fontFamily: "var(--font-space-mono)", fontSize: 11, color: "var(--text-muted)" }}>
                    {t("mention.allJoined")}
                  </span>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {mentionable
                      .filter((m) => !m.joined)
                      .map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          title={t("mention.add", { name: m.name })}
                          disabled={memberBusy}
                          onClick={() => void addChannelMember(agents.find((a) => a.id === m.id)!)}
                          style={{ ...actionButton, display: "flex", alignItems: "center", gap: 6, opacity: memberBusy ? 0.55 : 1 }}
                        >
                          <StatusDot status={m.status} />
                          {m.name}
                        </button>
                      ))}
                  </div>
                )}
              </div>
              {memberNotice && (
                <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>{memberNotice}</div>
              )}
            </>
          )}
        </div>
      )}

      {/* §3.5 pinned 区（channel 头部可展开）：当前成员个性化 pinned；Manual 可 ↑/↓ 重排 */}
      {pinnedOpen && joined && (
        <div
          style={{
            flexShrink: 0,
            padding: "8px 16px 12px",
            borderBottom: `2px solid ${INK}`,
            background: "var(--bg)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--font-hanken)", fontWeight: 700, fontSize: 13 }}>
              {t("pinned.title")}
            </span>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontFamily: "var(--font-hanken)",
                fontWeight: 700,
                fontSize: 11,
              }}
            >
              {t("pinned.sort")}
              <select
                value={pinnedSort}
                onChange={(e) => {
                  setPinnedSort(e.target.value as "manual" | "recent" | "az");
                  setPinnedOpen(true);
                }}
                style={{
                  padding: "3px 6px",
                  fontFamily: "var(--font-space-grotesk)",
                  fontSize: 12,
                  background: "#ffffff",
                  border: `2px solid ${INK}`,
                  outline: "none",
                }}
              >
                <option value="manual">{t("pinned.sortManual")}</option>
                <option value="recent">{t("pinned.sortRecent")}</option>
                <option value="az">{t("pinned.sortAz")}</option>
              </select>
            </label>
            {pinnedError && (
              <span style={{ fontFamily: "var(--font-space-mono)", fontSize: 11, color: "var(--coral)" }}>
                {pinnedError}
              </span>
            )}
          </div>
          {pinnedItems.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("pinned.empty")}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {pinnedItems.map((item, index) => (
                <div
                  key={item.message.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    background: "#ffffff",
                    border: `2px solid ${INK}`,
                    cursor: "pointer",
                  }}
                  role="button"
                  tabIndex={0}
                  onClick={() => openPinnedMessage(item.message)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") openPinnedMessage(item.message);
                  }}
                >
                  <span style={{ fontFamily: "var(--font-space-mono)", fontSize: 11, color: "var(--text-muted)" }}>
                    #{item.message.seq}
                  </span>
                  <span style={{ flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {previewLine(item.message.content, 60)}
                  </span>
                  {pinnedSort === "manual" && (
                    <span
                      style={{ display: "flex", gap: 4 }}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        title={t("pinned.moveUp")}
                        disabled={index === 0}
                        onClick={() => void movePinned(index, -1)}
                        style={{ ...actionButton, padding: "2px 7px", fontSize: 10 }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        title={t("pinned.moveDown")}
                        disabled={index === pinnedItems.length - 1}
                        onClick={() => void movePinned(index, 1)}
                        style={{ ...actionButton, padding: "2px 7px", fontSize: 10 }}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        title={t("message.unpin")}
                        onClick={() => void togglePin(item.message)}
                        style={{ ...actionButton, padding: "2px 7px", fontSize: 10 }}
                      >
                        <X size={10} style={{ display: "block", margin: "auto" }} />
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
            onClick={() => handleTabChange(tabId)}
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
                    currentMemberId={currentMemberId}
                    pinned={pinnedItems.some((item) => item.message.id === m.id)}
                    canConvertToTask={!tasks.some((task) => task.message_id === m.id)}
                    mentionMembers={mentionMembers}
                    onOpenMention={openMention}
                    onOpenMember={(memberId) => onOpenPanel?.(memberPanel(memberId, false))}
                    onReply={(target) => onOpenPanel?.({ kind: "thread", id: target.id })}
                    onQuote={setQuoting}
                    onCopyLink={(target) => void handleCopyLink(target)}
                    onConvertToTask={(target) => void convertMessageToTask(target)}
                    onSetReminder={joined ? openMessageReminder : undefined}
                    onToggleReaction={joined ? toggleReaction : undefined}
                    onTogglePin={joined ? togglePin : undefined}
                    onOpenThread={(target) => onOpenPanel?.({ kind: "thread", id: target.id })}
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
          <TaskViews
            tasks={tasks}
            currentMemberId={currentMemberId}
            busy={busyAction}
            disabled={composerDisabled}
            error={tasksError}
            notice={taskNotice}
            onCreateTask={(content) => void createTaskFromBoard(content)}
            onAction={(task, action, status) => void runTaskAction(task, action, status)}
            onOpenThread={(anchor) => onOpenPanel?.({ kind: "thread", id: anchor.id })}
            onNotice={setTaskNotice}
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
          members={composerMembers}
        />
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
