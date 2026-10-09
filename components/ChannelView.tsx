"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlarmClock,
  Bell,
  BellOff,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleSlash,
  CornerDownRight,
  FileText,
  Kanban,
  Link,
  List,
  ListPlus,
  Paperclip,
  Pin,
  Quote,
  Reply,
  Send,
  SmilePlus,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import type { TranslationParams } from "@/lib/i18n/types";
import { MentionText } from "./MentionText";
import { Avatar } from "./Avatar";
import { StatusDot } from "./StatusDot";
import { ReminderModal } from "./ReminderModal";
import { copyText } from "@/lib/clipboard";
import { formatBytes, MAX_ATTACHMENT_BYTES, previewLine } from "@/lib/preview";
import { BUILTIN_CHANNEL_ID } from "@/lib/data/schema";
import type {
  AttachmentRow,
  ChannelRow,
  MemberRow,
  TaskStatus,
} from "@/lib/data/types";
import {
  extractAtQuery,
  buildAtInsertText,
  type AtQueryMatch,
} from "@/lib/file-fuzzy";
import { composerMentionCandidates } from "@/lib/mention";
import { memberPanel, type PanelContent } from "@/lib/panel-state";
import { useChannelData } from "@/hooks/useChannelData";

export type CenterTab = "messages" | "tasks";

/** notice toast 自动消退时长（ms）——3–4 秒带，用户裁决。 */
export const NOTICE_TOAST_MS = 3500;

/** 两个 notice 槽（held / task）的当前值；单槽仲裁的输入。 */
export interface NoticeSlots {
  held: string | null;
  task: string | null;
}

/** 正在上屏的那一条 notice。 */
export interface NoticeToastItem {
  kind: "held" | "task";
  text: string;
}

/**
 * 单槽仲裁：held（§6.3 freshness-hold）与 task（§3.7 任务动作结果）两个槽
 * 合成至多一条可见 toast —— 判据是「谁的槽刚变成新内容」，所以新 notice 顶掉旧的，
 * 被顶掉的那条不会在旧 notice 消失后回弹（纯派生会回弹：held 退场后旧 task 又冒出来）。
 */
export function pickNoticeToast(seen: NoticeSlots, next: NoticeSlots): NoticeToastItem | null {
  const { held, task } = next;
  if (held !== null && held !== seen.held) return { kind: "held", text: held };
  if (task !== null && task !== seen.task) return { kind: "task", text: task };
  return null;
}

/**
 * 浮层 toast：锚在消息区底部、composer 上方居中，`--z-toast` 压过 composer。
 *
 * 为什么不再挂在滚动流里：notice 原先渲染在 `.stream-inner` 尾部 —— ① 被下方 composer
 * 遮住/挤出视野；② 在消息流最底部，用户不滚动就看不到（用户症状：注意不到有这个提示）。
 * `role="status"` + `aria-live="polite"` 让读屏器把它当状态播报，而不是流内正文。
 */
export function NoticeToast({ toast }: { toast: NoticeToastItem | null }) {
  const { t } = useI18n();
  if (!toast) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-notice={toast.kind}
      style={{
        position: "absolute",
        bottom: "var(--sp-6)",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: "var(--z-toast)",
        maxWidth: "min(90%, 520px)",
        padding: "8px 12px",
        background: toast.kind === "held" ? "var(--accent-soft)" : "var(--panel-2)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-md)",
        boxShadow: "var(--shadow-pop)",
        fontFamily: "var(--mono)",
        fontSize: 12,
        // 纯提示层不吃指针事件，别挡住 composer 的输入框与拖放。
        pointerEvents: "none",
      }}
    >
      {toast.kind === "held" ? `${t("message.heldNotice")} ${toast.text}` : toast.text}
    </div>
  );
}

export interface ChannelWithMeta extends ChannelRow {
  joined: boolean;
  memberCount: number;
  /** BAI-6 未读角标：Owner 在该频道的未读数（作者非本人且 seq > 已读游标）。 */
  unread: number;
  /** DM 懒创建「有消息」信号：顶层消息数（= maxSeq，与 01 迁移的「空」判定同源）。 */
  messageCount: number;
}

/** §3.4 reaction 聚合（与 lib/domain/collab/reactions.ts 同形）。 */
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
  /** §09 「未回复（已放弃）」标记（服务端从 round_logs 派生，见 lib/domain/collab/rounds.ts）。 */
  abandonedMarks?: Array<{
    agentId: string;
    agentName: string;
    reason: string;
    baseSeq: number;
    createdAt: string;
  }>;
}

/** §3.7 任务 = 消息 + 元数据：视图只显示状态，进展都在任务 thread（04 票起收进 hooks/useChannelData，直接 import）。 */
import type { ChannelTask } from "@/hooks/useChannelData";

/** @ 提及补全菜单最大展示条数。 */
const AT_MATCH_LIMIT = 20;
/** 任务板状态分组顺序（§3.7）。 */
const TASK_STATUS_ORDER: TaskStatus[] = [
  "todo",
  "in_progress",
  "in_review",
  "done",
  "closed",
];
/** §3.4 hover 快捷 reaction（常用若干）。 */
const QUICK_REACTIONS = ["👍", "❤️", "🎉", "👀"];
/** §3.4 表情选择器候选（常用 + 任务场景）。 */
const EMOJI_PICKER_OPTIONS = [
  "👍",
  "👎",
  "❤️",
  "🎉",
  "👀",
  "🔥",
  "✅",
  "❌",
  "🙏",
  "🚀",
  "💡",
  "🤔",
  "😂",
  "😅",
  "😮",
  "😢",
  "😡",
  "🥳",
  "👏",
  "🙌",
  "🤝",
  "📌",
  "⏰",
  "🔧",
];

/** 头部可展开面板（置顶/静音/成员）手风琴过渡时长与缓动：ease-out 曲线，避免瞬间出现/消失。 */
const PANEL_COLLAPSE_TRANSITION =
  "grid-template-rows 220ms cubic-bezier(0.33, 1, 0.68, 1), visibility 220ms";

/** 面板折叠外壳：常驻渲染，靠 grid 行高 0fr↔1fr 过渡展开/收起（互斥手风琴，见 toggle*Panel）。 */
const panelShellStyle = (open: boolean): React.CSSProperties => ({
  flexShrink: 0,
  display: "grid",
  gridTemplateRows: open ? "1fr" : "0fr",
  transition: PANEL_COLLAPSE_TRANSITION,
  // visibility 参与过渡：收起动画播完才真正隐藏（离散属性在过渡期间保持可见），展开时立即可见。
  visibility: open ? "visible" : "hidden",
});

/** 折叠外壳的内层：承接面板原有 padding/下边框/背景；minHeight 0 + overflow hidden 让行高可收缩。
    背景取 `--surface`（ED-1：头部展开面板是 chrome，与 `.chan-head` 的底同层），横向 padding 与
    `.chan-head` 的 `--sp-9` 对齐。
    ⚠ 关闭态要把 padding 与下边框**也收掉**：网格项自己的 padding/边框不可收缩，
    否则 0fr 行会停在它的 24px padding + 1px 边框上（面板“关着”却占位，把 tabs 往下顶）。
    两者与外壳的 `grid-template-rows` 同步过渡（同一时长/缓动）。 */
const panelCollapseInnerStyle = (open: boolean): React.CSSProperties => ({
  minHeight: 0,
  overflow: "hidden",
  padding: open ? "var(--sp-5) var(--sp-9)" : "0 var(--sp-9)",
  borderBottomStyle: "solid",
  borderBottomColor: "var(--border)",
  borderBottomWidth: open ? 1 : 0,
  background: "var(--surface)",
  transition:
    "padding 220ms cubic-bezier(0.33, 1, 0.68, 1), border-bottom-width 220ms cubic-bezier(0.33, 1, 0.68, 1)",
});

const messageTime = (iso: string): string => {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return isToday ? time : `${d.toLocaleDateString()} ${time}`;
};

/** 轮询合并由 hooks/useChannelData 持有（01 票起；ThreadPanel 改从 hook 直引，见其 import）。 */

/** 头部图标按钮的计数角标（pinned / mute / members 三处同形）：加载中显示 `…`，无计数则不渲染。 */
function IconCount({ loading, count }: { loading: boolean; count: number }) {
  if (!loading && count <= 0) return null;
  return (
    <span className="badge" style={{ position: "absolute", top: -6, right: -6 }}>
      {loading ? "…" : count}
    </span>
  );
}

/** 22px 的 `.icon-btn`（成员移除 / 置顶上下移 / 取消置顶 / 引文与附件 chip 的 ✕）：原语默认 30px，
    内联收小（同 `.rail-foot` 的 `.select` 收高先例）。 */
const SMALL_ICON_BTN_STYLE: React.CSSProperties = {
  width: 22,
  height: 22,
  flex: "0 0 22px",
};

function EmptyState({  glyph,
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
          background: "var(--surface)",
          border: `1px solid var(--border)`,
          boxShadow: "var(--shadow-card)",
          fontFamily: "var(--mono)",
          fontSize: 36,
          fontWeight: 700,
          color: "var(--fg)",
        }}
      >
        {glyph}
      </div>
      <div
        style={{
          fontFamily: "var(--font)",
          fontWeight: 700,
          fontSize: 17,
          marginTop: 6,
        }}
      >
        {title}
      </div>
      <div
        style={{
          color: "var(--muted)",
          fontSize: 13,
          maxWidth: 340,
          lineHeight: 1.6,
        }}
      >
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
        background: "var(--surface)",
        border: `1px solid var(--border)`,
        borderRadius: "var(--r-md)",
        boxShadow: "var(--shadow-pop)",
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
            e.currentTarget.style.background = "var(--accent-soft)";
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

/** §3.4 reaction 聚合条：显示在消息内容下方；已点高亮，点击切换（形态取上游 `.reactions` / `.reaction`）。 */
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
    /* `flexWrap` 是调用点的偏离：上游 `.reactions` 不换行；本仓一条消息的 reaction 种类可达 24 种，
       不换行会在窄栏溢出（票前面是 `flexWrap: wrap`，保留这个能力）。 */
    <div className="reactions" style={{ flexWrap: "wrap" }}>
      {reactions.map((reaction) => {
        const mine = reaction.memberIds.includes(currentMemberId);
        return (
          <button
            key={reaction.emoji}
            type="button"
            onClick={() => onToggle(reaction.emoji)}
            className={mine ? "reaction mine" : "reaction"}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>
              {reaction.emoji}
            </span>
            <b>{reaction.count}</b>
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
      setPreviewText(
        text.length > TEXT_PREVIEW_MAX_CHARS
          ? `${text.slice(0, TEXT_PREVIEW_MAX_CHARS)}…`
          : text,
      );
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
    fontFamily: "var(--font)",
    fontWeight: 700,
    fontSize: 12,
    background: "var(--surface)",
    color: "var(--fg)",
    border: `1px solid var(--border)`,
    borderRadius: "var(--r-md)",
    textDecoration: "none",
    cursor: "pointer",
  };

  if (attachments.length === 0) return null;
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}
    >
      {attachments.map((attachment) =>
        attachment.mime.startsWith("image/") ? (
          <div key={attachment.id}>
            <a
              href={`/api/attachments/${attachment.id}`}
              target="_blank"
              rel="noreferrer"
              title={attachment.file_name}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- 附件原图预览，不走 next/image 优化 */}
              <img
                src={`/api/attachments/${attachment.id}`}
                alt={attachment.file_name}
                style={{
                  display: "block",
                  maxWidth: 260,
                  maxHeight: 180,
                  objectFit: "contain",
                  background: "var(--surface)",
                  border: `1px solid var(--border)`,
                  borderRadius: "var(--r-md)",
                }}
              />
            </a>
          </div>
        ) : isTextLike(attachment.mime) ? (
          <div key={attachment.id}>
            <button
              type="button"
              onClick={() => void togglePreview(attachment)}
              style={chipStyle}
            >
              <span>
                <FileText size={12} style={{ verticalAlign: "-2px" }} />
              </span>
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {attachment.file_name}
              </span>
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  color: "var(--muted)",
                }}
              >
                {formatBytes(attachment.size_bytes)}
              </span>
              <span
                style={{ fontFamily: "var(--mono)", fontSize: 10 }}
              >
                {previewId === attachment.id ? "▲" : "▼"}
              </span>
            </button>
            {previewId === attachment.id && (
              <pre
                style={{
                  margin: "4px 0 0",
                  maxHeight: 260,
                  overflow: "auto",
                  padding: "8px 10px",
                  background: "var(--bg)",
                  border: `1px solid var(--border)`,
                  borderRadius: "var(--r-md)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {previewFailed ? (
                  <>
                    <TriangleAlert
                      size={11}
                      style={{ verticalAlign: "text-bottom" }}
                    />{" "}
                    preview failed
                  </>
                ) : (
                  (previewText ?? "…")
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
            <span>
              <Paperclip size={12} style={{ verticalAlign: "-2px" }} />
            </span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {attachment.file_name}
            </span>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10,
                color: "var(--muted)",
              }}
            >
              {formatBytes(attachment.size_bytes)}
            </span>
          </a>
        ),
      )}
    </div>
  );
}

/** 消息动作栏（§3.2/§3.3）：hover 浮出；回复 / 引用 / 复制链接 / 设提醒（§5.6）/ Pin / 转为任务（§3.7，仅频道面）/ emoji+（点开展开二级快捷 bar，再点开完整选择器）。
 *  每个键都按 prop 门控：频道面全给，线程面只给 表情 / 引用 / 复制链接 / ⏰（仅锚点）——收窄靠「不传 prop」，不是「传空函数」。 */
function MessageActions({
  message,
  onReply,
  onQuote,
  onCopyLink,
  onReminder,
  onToggleReaction,
  onTogglePin,
  onConvertToTask,
  pinned,
  reactOpen,
  onToggleReactOpen,
}: {
  message: ChannelMessage;
  onReply?: (message: ChannelMessage) => void;
  onQuote: (message: ChannelMessage) => void;
  onCopyLink: (message: ChannelMessage) => void;
  onReminder?: (message: ChannelMessage) => void;
  onToggleReaction?: (message: ChannelMessage, emoji: string) => void;
  onTogglePin?: (message: ChannelMessage) => void;
  onConvertToTask?: (message: ChannelMessage) => void;
  pinned?: boolean;
  reactOpen?: boolean;
  onToggleReactOpen?: () => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <>
      {/* 动作栏形态（`globals.css` 的 `.msg-tools` 块）：绝对定位在行右上、hover/focus 才出。 */}
      <div className="msg-tools">
        {onToggleReaction && onToggleReactOpen && (
          <button
            type="button"
            title={t("message.addReaction")}
            style={reactOpen ? { background: "var(--accent-soft)", color: "var(--accent-deep)" } : undefined}
            onClick={onToggleReactOpen}
          >
            <SmilePlus size={13} />
          </button>
        )}
        {onReply && (
          <button
            type="button"
            title={t("message.reply")}
            onClick={() => onReply(message)}
          >
            <Reply size={13} />
          </button>
        )}
        <button
          type="button"
          title={t("message.quote")}
          onClick={() => onQuote(message)}
        >
          <Quote size={13} />
        </button>
        <button
          type="button"
          title={t("message.copyLink")}
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
            onClick={() => onReminder(message)}
          >
            <AlarmClock size={13} />
          </button>
        )}
        {onTogglePin && (
          <button
            type="button"
            title={pinned ? t("message.unpin") : t("message.pin")}
            style={pinned ? { background: "var(--accent-soft)", color: "var(--accent-deep)" } : undefined}
            onClick={() => onTogglePin(message)}
          >
            <Pin size={13} />
          </button>
        )}
        {onConvertToTask && (
          <button
            type="button"
            title={t("tasks.convert")}
            onClick={() => onConvertToTask(message)}
          >
            <ListPlus size={13} />
          </button>
        )}
      </div>
      {/* 二级 reaction 条（本仓独有，无上游对应）：形态取 `.reactions` / `.reaction`，
          与动作栏同属一个揭示外壳（`ws-message-actions`），展开时在行内右对齐出。 */}
      {reactOpen && (
        <div className="reactions" style={{ position: "relative", alignItems: "center" }}>
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              title={t("message.react")}
              className="reaction"
              onClick={() => onToggleReaction?.(message, emoji)}
            >
              <span style={{ fontSize: 13, lineHeight: 1 }}>{emoji}</span>
            </button>
          ))}
          <span style={{ position: "relative", display: "inline-flex" }}>
            <button
              type="button"
              title={t("message.addReaction")}
              className="reaction"
              onClick={() => setPickerOpen((open) => !open)}
            >
              <SmilePlus size={13} />
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
    </>
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
        background: "var(--surface)",
        border: `1px solid var(--border)`,
        borderRadius: "var(--r-md)",
        boxShadow: "var(--shadow-pop)",
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
            fontFamily: "var(--font)",
            fontWeight: 700,
            fontSize: 12,
            background: "transparent",
            color: "var(--fg)",
            border: "none",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--accent-soft)";
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

/** 顶层消息渲染行：头像 + 作者 + seq + 时间戳 + 内容 + reaction/附件 + hover 动作栏；右键 = 菜单（Open Thread / Convert to Task）。
 *  memo 化：切换频道/轮询合并时父级重渲染频繁，单行 props 不变则跳过（头像/Markdown 解析是主要开销）。 */
export const MessageRow = memo(function MessageRow({
  message,
  isAnchor,
  canConvertToTask,
  convertInActionBar,
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
  /** §3.7 创建途径 4：动作栏「转为任务」键——只有频道调用点传 true（线程面不传 ⇒ 键根本不存在）。 */
  convertInActionBar?: boolean;
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
  onReply?: (message: ChannelMessage) => void;
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
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node))
        setReactOpen(false);
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
    ...(onReply
      ? [{ label: t("message.reply"), onClick: () => onReply(message) }]
      : []),
    ...(canConvertToTask && onConvertToTask
      ? [{ label: t("tasks.convert"), onClick: () => onConvertToTask(message) }]
      : []),
  ];
  const isAgent = message.author?.type === "agent";
  return (
    <div
      className={
        isAnchor
          ? "msg ws-message-row ws-message-row-anchor"
          : "msg ws-message-row"
      }
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <Avatar
        name={message.author?.name}
        type={message.author?.type}
        size="md"
        colorKey={message.author_id}
      />
      <div className="msg-body">
        {/* `flexWrap` 是调用点的偏离：上游 `.msg-head` 不换行，本仓头部还有线程/未回复角标，窄栏需换行兜底。 */}
        <div className="msg-head" style={{ flexWrap: "wrap" }}>
          <span className={isAgent ? "msg-author is-agent" : "msg-author"}>
            {message.author?.name ?? t("message.unknownAuthor")}
          </span>
          <span className="msg-time mono" style={{ color: "var(--muted)" }}>
            #{message.seq}
          </span>
          <span className="msg-time mono">
            {messageTime(message.created_at)}
          </span>
          {onOpenThread && (message.threadReplyCount ?? 0) > 0 && (
            <button
              type="button"
              title={t("message.openThreadBadge")}
              className="mono"
              onClick={(e) => {
                e.stopPropagation();
                onOpenThread(message);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "1px 6px",
                fontSize: "var(--fs-mono-xs)",
                fontWeight: 700,
                background: "var(--panel-2)",
                color: "var(--fg)",
                border: `1px solid var(--border)`,
                borderRadius: "var(--r-pill)",
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
                .map(
                  (mark) =>
                    `${mark.agentName}：${mark.reason || t("message.notReplied")}`,
                )
                .join("；")}
              className="mono"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "1px 6px",
                fontSize: "var(--fs-mono-xs)",
                fontWeight: 700,
                background: "var(--accent-soft)",
                color: "var(--fg)",
                border: `1px solid var(--border)`,
                borderRadius: "var(--r-pill)",
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
                ? t("message.notRepliedMany", {
                    count: String(message.abandonedMarks.length),
                  })
                : t("message.notReplied")}
            </span>
          )}
        </div>
        <div className="msg-text">
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
        {/* 揭示归票 03 的骨架钩子（`.ws-message-actions` 的 display 开关）；
            布局上把二级 reaction 条右对齐到动作栏下方（动作用绝对定位的 `.msg-tools`）。 */}
        <div
          ref={actionsRef}
          className={
            reactOpen
              ? "ws-message-actions ws-message-actions-open"
              : "ws-message-actions"
          }
          style={{
            marginTop: 6,
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 4,
          }}
        >
          <MessageActions
            message={message}
            onReply={onReply}
            onQuote={onQuote}
            onCopyLink={onCopyLink}
            onReminder={onSetReminder}
            onToggleReaction={onToggleReaction}
            onTogglePin={onTogglePin}
            onConvertToTask={
              convertInActionBar && canConvertToTask && onConvertToTask
                ? onConvertToTask
                : undefined
            }
            pinned={pinned}
            reactOpen={reactOpen}
            onToggleReactOpen={() => setReactOpen((open) => !open)}
          />
        </div>
      </div>
      {menu && items.length > 0 && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={items}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
});

/** §3.7 / ED-10 任务状态色（原型 JS 的 `STATUS_COLOR`）：成员四态色 + `--faint` / `--accent`
 *  两档中性/强调色，无第二强调色。看板列头状态点与 List 分组徽标共用同一份映射。 */
const TASK_STATUS_COLOR: Record<TaskStatus, string> = {
  todo: "var(--faint)",
  in_progress: "var(--accent-graphic)",
  in_review: "var(--working)",
  done: "var(--online)",
  closed: "var(--offline)",
};

/** §3.7 任务状态徽标底色（List 分组标题）：**填充档**。同一个状态在两个消费点上要不同档
 *  ——点（`TASK_STATUS_COLOR`）是图形档（≥3:1），徽标底压的是深墨文字（≥4.5:1），
 *  所以底取 D7「徽标 / 横幅底走填充档」那一档；中性态（todo）取中性 chip 底。
 *  实测（spec 口径）：`--panel-2` 10.12 · `--accent` 7.74 · `--working-fill` 7.57 ·
 *  `--online-fill` 7.13 · `--offline-fill` 7.17。 */
const TASK_STATUS_BADGE_BG: Record<TaskStatus, string> = {
  todo: "var(--panel-2)",
  in_progress: "var(--accent)",
  in_review: "var(--working-fill)",
  done: "var(--online-fill)",
  closed: "var(--offline-fill)",
};

/** §3.7 任务状态徽标样式（List 分组标题）：形态不变，色取上面的填充档表。 */
const taskBadgeStyle = (status: TaskStatus): React.CSSProperties => ({
  fontFamily: "var(--mono)",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.06em",
  padding: "2px 7px",
  border: `1px solid var(--border)`,
  background: TASK_STATUS_BADGE_BG[status],
  color: "var(--on-accent)",
  whiteSpace: "nowrap",
});

const TASK_VIEW_KEY = "worksplice-task-view";

/** 任务视图偏好（ADR-0002）：localStorage 全局记忆，默认列表。 */
function readTaskViewPref(): "list" | "board" {
  try {
    return window.localStorage.getItem(TASK_VIEW_KEY) === "board"
      ? "board"
      : "list";
  } catch {
    return "list";
  }
}

/** §3.7 任务卡片动作（List/Board 共用；与服务端状态机一致：互审 + owner 限定）。 */
function taskActionsFor(
  task: ChannelTask,
  currentMemberId: string,
  onAction: (
    task: ChannelTask,
    action: "claim" | "updateStatus",
    status?: TaskStatus,
  ) => void,
  t: (key: string, params?: TranslationParams) => string,
): Array<{ label: string; onClick: () => void }> {
  const mine = task.owner_id === currentMemberId;
  switch (task.status) {
    case "todo":
      return [
        { label: t("tasks.claim"), onClick: () => onAction(task, "claim") },
      ];
    case "in_progress":
      return mine
        ? [
            {
              label: t("tasks.complete"),
              onClick: () => onAction(task, "updateStatus", "in_review"),
            },
            {
              label: t("tasks.unclaim"),
              onClick: () => onAction(task, "updateStatus", "todo"),
            },
            {
              label: t("tasks.close"),
              onClick: () => onAction(task, "updateStatus", "closed"),
            },
          ]
        : [];
    case "in_review":
      return mine
        ? [
            {
              label: t("tasks.close"),
              onClick: () => onAction(task, "updateStatus", "closed"),
            },
          ]
        : [
            {
              label: t("tasks.approve"),
              onClick: () => onAction(task, "updateStatus", "done"),
            },
            {
              label: t("tasks.reject"),
              onClick: () => onAction(task, "updateStatus", "in_progress"),
            },
          ];
    case "done":
    case "closed":
      return [
        {
          label: t("tasks.reopen"),
          onClick: () => onAction(task, "updateStatus", "todo"),
        },
      ];
  }
}

/** §3.7 任务卡片（List/Board 共用）：.card-title + .card-meta（#number / 重开标记 / owner）；
 *  点击打开任务 thread；Board 视图可拖拽（落点由 TaskBoard 按 reachable 裁决）。 */
export function TaskCard({
  task,
  currentMemberId,
  busy,
  onAction,
  onOpenThread,
  draggable = false,
  dragging = false,
  onDragStart,
  onDragEnd,
}: {
  task: ChannelTask;
  currentMemberId: string;
  busy: boolean;
  onAction: (
    task: ChannelTask,
    action: "claim" | "updateStatus",
    status?: TaskStatus,
  ) => void;
  onOpenThread: (anchor: ChannelMessage) => void;
  draggable?: boolean;
  /** 拖拽中（display-only）：形态 = `.card.dragging{opacity:.4}`，不参与落点裁决。 */
  dragging?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>, task: ChannelTask) => void;
  onDragEnd?: () => void;
}) {
  const { t } = useI18n();
  const actions = taskActionsFor(task, currentMemberId, onAction, t);
  return (
    <div
      className={dragging ? "card dragging" : "card"}
      role="button"
      tabIndex={0}
      title={t("tasks.threadHint")}
      // `.card` 自带 `cursor: grab`（上游形态）；List 视图的卡片不可拖（draggable 缺省 false），
      // 光标退回 pointer。形态仍全走 class，这里只纠一个指针暗示。
      style={draggable ? undefined : { cursor: "pointer" }}
      onClick={() => onOpenThread(task.anchor)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpenThread(task.anchor);
      }}
      draggable={draggable}
      onDragStart={onDragStart ? (e) => onDragStart(e, task) : undefined}
      onDragEnd={onDragEnd}
    >
      <div className="card-title">{previewLine(task.anchor.content)}</div>
      <div className="card-meta">
        <span className="card-num">#{task.number}</span>
        {task.reopened === 1 && (
          <span className="card-tag" title={t("tasks.reopenedHint")}>
            {t("tasks.reopenedBadge")}
          </span>
        )}
        <span className={task.owner ? "card-owner" : "card-owner unassigned"}>
          {task.owner ? (
            <Avatar
              name={task.owner.name}
              type={task.owner.type}
              size="sm"
              colorKey={task.owner_id ?? undefined}
            />
          ) : null}
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
              className="btn btn-sm"
              disabled={busy}
              onClick={action.onClick}
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
export function TaskList({
  tasks,
  currentMemberId,
  busy,
  folded,
  onToggleGroup,
  onAction,
  onOpenThread,
}: {
  tasks: ChannelTask[];
  currentMemberId: string;
  busy: boolean;
  /** 折叠中的状态集合（由 TaskViews 持有：切 List|Board 不丢折叠态）。默认全展开。 */
  folded: ReadonlySet<TaskStatus>;
  onToggleGroup: (status: TaskStatus) => void;
  onAction: (
    task: ChannelTask,
    action: "claim" | "updateStatus",
    status?: TaskStatus,
  ) => void;
  onOpenThread: (anchor: ChannelMessage) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      {TASK_STATUS_ORDER.filter((status) =>
        tasks.some((task) => task.status === status),
      ).map((status) => {
        const group = tasks.filter((task) => task.status === status);
        const expanded = !folded.has(status);
        const statusLabel = t(`task.status.${status}`);
        // 分组头的无障碍名/悬停提示走 i18n，并带上计数——折叠态下计数仍要读得出来。
        const groupLabel = t(expanded ? "tasks.collapseGroup" : "tasks.expandGroup", {
          status: statusLabel,
          count: group.length,
        });
        const bodyId = `task-group-${status}`;
        return (
          <section key={status} className="task-group">
            <button
              type="button"
              className="task-group-head"
              aria-expanded={expanded}
              aria-controls={bodyId}
              title={groupLabel}
              aria-label={groupLabel}
              onClick={() => onToggleGroup(status)}
            >
              {expanded ? (
                <ChevronDown className="task-group-caret" size={13} />
              ) : (
                <ChevronRight className="task-group-caret" size={13} />
              )}
              <span style={taskBadgeStyle(status)}>{statusLabel}</span>
              <span className="task-group-count">{group.length}</span>
              <span className="task-group-rule" />
            </button>
            {/* 折叠时组体留在 DOM 里并置 hidden：`aria-controls` 指向的元素始终存在，
                展开/收起只翻这一个属性（计数与徽标在分组头上，不随组体一起消失）。 */}
            <div className="task-group-body" id={bodyId} hidden={!expanded}>
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

/** 任务看板（§3.7 任务视图 / ADR-0002）：5 列 = 5 状态常显；跨列拖拽 = 请求一次状态转移
 *  （服务端裁决，不做乐观移动：松手后卡片留原列，等 updateTaskStatus 返回才随重载落位）。
 *  列宽/不拉伸、列底、拖拽态形态全在 globals.css 的任务板 class 块。 */
export function TaskBoard({
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
  onAction: (
    task: ChannelTask,
    action: "claim" | "updateStatus",
    status?: TaskStatus,
  ) => void;
  onOpenThread: (anchor: ChannelMessage) => void;
  onInvalidDrop: (task: ChannelTask, status: TaskStatus) => void;
}) {
  const { t } = useI18n();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);
  const dragTask = dragId
    ? (tasks.find((task) => task.id === dragId) ?? null)
    : null;

  const handleDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    task: ChannelTask,
  ) => {
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
      className="board-cols"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      {TASK_STATUS_ORDER.map((status) => {
        const group = tasks.filter((task) => task.status === status);
        const validTarget =
          dragTask !== null &&
          status !== dragTask.status &&
          dragTask.reachable.includes(status);
        const active = validTarget && dragOver === status;
        const invalid =
          dragTask !== null &&
          status !== dragTask.status &&
          dragOver === status &&
          !dragTask.reachable.includes(status);
        return (
          <div
            key={status}
            className={`col${active ? " drag-over" : ""}${
              invalid ? " invalid-over" : ""
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(status);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node))
                setDragOver(null);
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
          >
            <div className="col-head">
              <span
                className="st-dot"
                style={{ background: TASK_STATUS_COLOR[status] }}
              />
              <b>{t(`task.status.${status}`)}</b>
              <span className="col-count">{group.length}</span>
            </div>
            <div className="col-body">
              {group.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  currentMemberId={currentMemberId}
                  busy={busy}
                  onAction={onAction}
                  onOpenThread={onOpenThread}
                  draggable={!busy}
                  dragging={dragId === task.id}
                  onDragStart={handleDragStart}
                  onDragEnd={() => {
                    setDragId(null);
                    setDragOver(null);
                  }}
                />
              ))}
              {/* 空列的虚线空槽（上游原型形态）：可达/非法落点的高亮落在列上，空列给出「拖到这」的言语线索。 */}
              {group.length === 0 && (
                <div className="drop-hint">{t("tasks.dropHint")}</div>
              )}
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
  onAction: (
    task: ChannelTask,
    action: "claim" | "updateStatus",
    status?: TaskStatus,
  ) => void;
  onOpenThread: (anchor: ChannelMessage) => void;
  onNotice: (message: string) => void;
}) {
  const { t } = useI18n();
  // 首帧（含 hydration）固定用默认 "list"，与服务端 HTML 一致；挂载后 useEffect
  // 再应用 localStorage 偏好（useI18n hydrated 门控同模式）。渲染期直接读
  // localStorage 会让偏好为 board 时客户端首帧与服务端不一致 → hydration mismatch。
  const [view, setView] = useState<"list" | "board">("list");
  const [formOpen, setFormOpen] = useState(false);
  const [content, setContent] = useState("");
  // list 视图各状态分组的折叠集合（本票不持久化：折叠是会话内的阅读态，不是偏好，
  // 不与 TASK_VIEW_KEY 分叉出第二份 localStorage 存储）。放在 TaskViews 而非 TaskList，
  // 是为了切 List|Board 时折叠态不被卸载丢掉。
  const [folded, setFolded] = useState<ReadonlySet<TaskStatus>>(
    () => new Set<TaskStatus>(),
  );

  const toggleGroup = (status: TaskStatus) => {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  useEffect(() => {
    const stored = readTaskViewPref();
    setView((prev) => (prev === stored ? prev : stored));
  }, []);

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
      className={`board-wrap is-${view}`}
      // 看板模式：板面撑满 main 剩余高度、在 `.board-cols` 内按列滚，横向滚动条钉在可视区域底部
      // （否则滚动条随内容沉底，需要先滚到底才看得到）；列表模式保持内容高度，由 main 滚。
      style={view === "board" ? { height: "100%" } : undefined}
    >
      {/* 创建途径 3：Tasks tab Create Task；右侧 List|Board 分段控件（ADR-0002） */}
      <div className="board-toolbar">
        {formOpen ? (
          <>
            <textarea
              className="textarea"
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
              style={{ flex: 1, minWidth: 220 }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={disabled || !content.trim()}
              onClick={submitCreate}
            >
              {t("tasks.create")}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setFormOpen(false)}
            >
              {t("tasks.cancel")}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={disabled}
            onClick={() => setFormOpen(true)}
          >
            + {t("tasks.new")}
          </button>
        )}
        {notice && (
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 12,
              color: "var(--muted)",
            }}
          >
            {notice}
          </span>
        )}
        <div className="sep" />
        <div className="seg" role="tablist" aria-label={t("tasks.view")}>
          <button
            type="button"
            role="tab"
            aria-selected={view === "list"}
            className={view === "list" ? "is-active" : undefined}
            onClick={() => switchView("list")}
          >
            <List size={13} /> {t("tasks.viewList")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "board"}
            className={view === "board" ? "is-active" : undefined}
            onClick={() => switchView("board")}
          >
            <Kanban size={13} /> {t("tasks.viewBoard")}
          </button>
        </div>
      </div>
      {error && (
        <div
          style={{ margin: "10px 20px 0", color: "var(--error)", fontSize: 12 }}
        >
          {error}
        </div>
      )}

      <div className={`board is-${view}`}>
        {tasks.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
            {t("tasks.emptyHint")}
          </div>
        ) : view === "list" ? (
          <TaskList
            tasks={tasks}
            currentMemberId={currentMemberId}
            busy={busy}
            folded={folded}
            onToggleGroup={toggleGroup}
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
  focusSignal,
}: {
  targetId: string;
  disabled: boolean;
  disabledHint: string;
  quoting: ChannelMessage | null;
  asTask?: boolean;
  onAsTaskChange?: (checked: boolean) => void;
  onClearQuote: () => void;
  onSend: (
    targetId: string,
    content: string,
    quoteId?: string,
    files?: File[],
  ) => Promise<unknown>;
  members?: Array<{
    id: string;
    name: string;
    status: MemberRow["status"];
    joined: boolean;
  }>;
  /** 一次性聚焦信号（DM 懒创建入口导航后聚焦输入框）：变化时 focus textarea。 */
  focusSignal?: number;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // DM 懒创建入口：focusSignal 递增时聚焦输入框（普通频道行点击不触发——无信号）。
  useEffect(() => {
    if (focusSignal && focusSignal > 0) {
      textareaRef.current?.focus();
    }
  }, [focusSignal]);

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

  const atTokenKey =
    atQuery === null
      ? null
      : `${atQuery.start}:${atQuery.quoted ? 1 : 0}:${atQuery.query}`;
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
        else if (name.split(/\s+/).some((part) => part.startsWith(query)))
          score = 40;
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
    (member: {
      id: string;
      name: string;
      status: MemberRow["status"];
      joined: boolean;
    }) => {
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
    const oversized = [...picked].filter(
      (file) => file.size > MAX_ATTACHMENT_BYTES,
    );
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
      await onSend(
        targetId,
        content,
        quoting?.id,
        files.length > 0 ? files : undefined,
      );
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
    <div className="composer" style={{ flexShrink: 0 }}>
      <div className="composer-inner">
        {quoting && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
              padding: "6px 10px",
              background: "var(--panel-2)",
              border: `1px solid var(--border)`,
              borderRadius: "var(--r-md)",
              fontFamily: "var(--mono)",
              fontSize: 12,
            }}
          >
            <span
              style={{
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              <Quote size={12} style={{ verticalAlign: "-2px" }} />
              {" "}
              #{quoting.seq}{" "}
              {quoting.author?.name ?? t("message.unknownAuthor")}:{" "}
              {quoting.content.split("\n")[0]}
            </span>
            <button
              type="button"
              aria-label={t("message.clearQuote")}
              className="icon-btn"
              style={SMALL_ICON_BTN_STYLE}
              onClick={onClearQuote}
            >
              <X size={12} />
            </button>
          </div>
        )}
        {files.length > 0 && (
          <div
            style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}
          >
            {files.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "3px 8px",
                  background: "var(--panel-2)",
                  border: `1px solid var(--border)`,
                  borderRadius: "var(--r-sm)",
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                }}
              >
                <span
                  style={{
                    maxWidth: 180,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  <Paperclip size={11} style={{ verticalAlign: "-2px" }} />{" "}
                  {file.name}
                </span>
                <span style={{ color: "var(--muted)" }}>
                  {formatBytes(file.size)}
                </span>
                <button
                  type="button"
                  aria-label={t("attachments.remove")}
                  className="icon-btn"
                  style={{ width: 18, height: 18, flex: "0 0 18px" }}
                  onClick={() =>
                    setFiles((prev) => prev.filter((_, i) => i !== index))
                  }
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
        {/* 常驻输入框形态（`globals.css` 的 `.composer-box` 块）：surface + border-strong + r-lg，
            形状、焦点环与 `--shadow-composer` 全在 class 上。 */}
        <div className="composer-box">
          <div style={{ position: "relative" }}>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                updateAtQuery(e.target.value, e.target.selectionStart);
              }}
              onKeyDown={(e) => {
                // @ 提及补全键盘导航（IME 组合期不拦截，镜像 ChatInput）
                if (
                  atMenuOpen &&
                  atQuery !== null &&
                  !e.nativeEvent.isComposing
                ) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setAtActiveIndex((i) =>
                      Math.min(Math.max(0, atMatches.length - 1), i + 1),
                    );
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
                  if (
                    (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) &&
                    atMatches[atActiveIndex]
                  ) {
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
              placeholder={
                disabled ? disabledHint : t("message.composerPlaceholder")
              }
              disabled={disabled}
              rows={2}
              className="composer-input"
              style={{
                // 保留可拖拽改高（内联覆盖上游 `.composer-input` 的 `resize: none`）：本仓没有自动长高，
                // 去掉它等于收回一个既有的用户能力（零行为改动红线）。
                resize: "vertical",
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
                  background: "var(--surface)",
                  border: `1px solid var(--border)`,
                  borderRadius: "var(--r-md)",
                  boxShadow: "var(--shadow-pop)",
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
                    borderBottom: `1px solid var(--border)`,
                    fontFamily: "var(--font)",
                    fontWeight: 700,
                    fontSize: 11,
                  }}
                >
                  <span>{t("mention.title")}</span>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontWeight: 400,
                      color: "var(--muted)",
                    }}
                  >
                    {t("chat.tabEnter")}
                  </span>
                </div>
                {atMatches.length === 0 ? (
                  <div
                    style={{
                      padding: "8px 10px",
                      fontSize: 12,
                      color: "var(--muted)",
                    }}
                  >
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
                          borderBottom:
                            index < atMatches.length - 1
                              ? `1px solid var(--border)`
                              : "none",
                          background: active ? "var(--accent-soft)" : "var(--surface)",
                          color: "var(--fg)",
                          cursor: "pointer",
                          textAlign: "left",
                          fontFamily: "var(--font)",
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
                              fontFamily: "var(--mono)",
                              fontSize: 10,
                              color: "var(--muted)",
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
          {/* 工具条（上游 `.composer-bar`）：左工具（附件 / As task）、右发送方块。 */}
          <div className="composer-bar">
            <button
              type="button"
              title={t("attachments.attach")}
              aria-label={t("attachments.attach")}
              disabled={disabled}
              className="icon-btn"
              style={{ opacity: disabled ? 0.55 : 1 }}
              onClick={() => fileInputRef.current?.click()}
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
          {onAsTaskChange && (
            <label
              title={t("tasks.convertHint")}
              /* 形态取票 08 的 `.member-opt`（成员/选项胶囊）：`.filter-chip` 被票 09 的
                 「零消费者」断言全局锁死（见票据 Answer 的 Rebase 节，待协调端追认）。 */
              className={asTask ? "member-opt is-on" : "member-opt"}
                style={{
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
                  style={{ cursor: "pointer", accentColor: "var(--selected-graphic)" }}
                />
                {t("tasks.asTask")}
              </label>
            )}
            <span className="sep" />
            <button
              type="button"
              title={t("message.send")}
              aria-label={t("message.send")}
              disabled={disabled || busy || (!value.trim() && files.length === 0)}
              onClick={() => void submit()}
              className="composer-send"
            >
              {busy ? "…" : <Send size={15} />}
            </button>
          </div>
        </div>
        {error && (
          <div style={{ marginTop: 6, color: "var(--error)", fontSize: 12 }}>
            {error}
          </div>
        )}
      </div>
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
  composerFocusSignal,
  agents = [],
  owner = null,
  onOpenPanel,
  membersVersion,
}: {
  channel: ChannelWithMeta | null;
  tab: CenterTab;
  onTabChange: (tab: CenterTab) => void;
  currentMemberId: string;
  onChannelChanged: () => void;
  focusMessageId?: string | null;
  /** DM 懒创建入口导航后聚焦 composer 的一次性信号（透传给 Composer）。 */
  composerFocusSignal?: number;
  agents?: MemberRow[];
  owner?: MemberRow | null;
  /** 打开右栏面板（ticket 13）：agent / human / thread 单槽替换；中央频道消息流不动。 */
  onOpenPanel?: (content: PanelContent) => void;
  /** 成员集合显式失效计数：新建 agent 自动加入 #all 后外部成员集已变——
   * hook 侧经 loadMembers 重拉收敛（不切频道也刷新人数/成员面板/@ 候选）。 */
  membersVersion?: number;
}) {
  const { t } = useI18n();

  // 01 票：频道消息数据循环收进 useChannelData（loadLatest/loadEarlier +
  // 轮询合并 + maxSeq/hasMore）；02 票：发送通道（send + heldNotice + busyAction）同收 hook。
  // 03 票：pinned 数据循环（pinnedItems/pinnedSort/reorderPinned/togglePin）
  // 与附属区（mutes/channelMemberIds）同收 hook；视图只做排版（pinned 区展开、BellOff/成员面板不动）。
  // 视图直接消费 hook 状态。
  const {
    messages,
    messagesLoading,
    hasMore,
    loadError,
    loadLatest,
    loadEarlier,
    send: sendMessage,
    heldNotice,
    busyAction,
    setHeldNotice,
    setBusyAction,
    pinnedItems,
    pinnedSort,
    setPinnedSort,
    pinnedError,
    pinnedLoading,
    togglePin,
    reorderPinned,
    mutes,
    mutesLoading,
    toggleMute: toggleMuteInHook,
    channelMemberIds,
    membersLoading,
    membersError,
    loadMembers,
    // 04 票：任务板数据循环收进 useChannelData（tasks/tasksError/taskNotice +
    // loadTasks/转移序列 runTaskTransition/completeTask/创建 convertToTask/createTaskFromBoard）；
    // 视图只做排版（TaskViews 视图与拖拽手势不动；taskOps 动作名入口在 hook interface 面，
    // 视图经 runTaskAction 转发，见下）。
    tasks,
    tasksError,
    taskNotice,
    setTaskNotice,
    loadTasks,
    runTaskTransition,
    convertToTask,
    createTaskFromBoard: createTaskFromBoardInHook,
  } = useChannelData(channel?.id, t, membersVersion);

  const [asTask, setAsTask] = useState(false);

  // 引用态（ticket 13 线程迁出后变为 channel 局部——线程引用在面板 ThreadPanel 内自持）
  const [quoting, setQuoting] = useState<ChannelMessage | null>(null);

  // §3.5 pinned 区展开态留视图侧（排版态，非数据）。
  const [pinnedOpen, setPinnedOpen] = useState(false);

  // §3.2 mute 面板展开态与操作提示留视图侧（排版态；mute 数据经 hook）。
  const [muteOpen, setMuteOpen] = useState(false);
  const [muteNotice, setMuteNotice] = useState<string | null>(null);

  // 👥 频道成员面板展开态留视图侧（排版态；成员 id 集合经 hook，增删操作仍内联）。
  const [membersOpen, setMembersOpen] = useState(false);
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberNotice, setMemberNotice] = useState<string | null>(null);

  // 头部三个可展开面板互斥（手风琴）：同一时刻最多展开一个；再次点击当前按钮正常收起。
  const togglePinnedPanel = () => {
    const next = !pinnedOpen;
    setPinnedOpen(next);
    if (next) {
      setMuteOpen(false);
      setMembersOpen(false);
    }
  };
  const toggleMutePanel = () => {
    const next = !muteOpen;
    setMuteOpen(next);
    if (next) {
      setPinnedOpen(false);
      setMembersOpen(false);
    }
  };
  const toggleMembersPanel = () => {
    const next = !membersOpen;
    setMembersOpen(next);
    if (next) {
      setPinnedOpen(false);
      setMuteOpen(false);
    }
  };
  /** 切换 pinned 排序时自动展开置顶面板——同样走互斥（展开置顶即收起另外两个）。 */
  const openPinnedPanel = () => {
    setPinnedOpen(true);
    setMuteOpen(false);
    setMembersOpen(false);
  };

  /** 频道内 agent 成员（状态取自全量 agents，SSE 实时）；@ 补全候选 = 全部 agent + joined 标记。 */  const channelAgents = useMemo(
    () => agents.filter((a) => channelMemberIds.has(a.id)),
    [agents, channelMemberIds],
  );
  /** 频道内全部成员（agent + 人类）：数量与成员面板共用——agent 删除后随 agents prop 刷新即更新，人类始终可见。 */
  const channelMembers = useMemo(() => {
    const members = agents.filter((a) => channelMemberIds.has(a.id));
    return owner && channelMemberIds.has(owner.id)
      ? [...members, owner]
      : members;
  }, [agents, owner, channelMemberIds]);
  /** 被静音的 agent 数（头部按钮的 `.is-on` 与 `.badge` 计数共用）。 */
  const mutedCount = useMemo(
    () => mutes.filter((m) => m.muted).length,
    [mutes],
  );
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

  // 消息行回调稳定化：与 memo(MessageRow) 配合——切换频道/轮询时父级重渲染，
  // 单行 props（回调引用）不变则跳过重渲染，避免百条 Markdown/头像逐行重排造成的闪动。
  const openMemberPanel = useCallback(
    (memberId: string) => onOpenPanel?.(memberPanel(memberId, false)),
    [onOpenPanel],
  );
  const openThreadPanel = useCallback(
    (target: ChannelMessage) =>
      onOpenPanel?.({ kind: "thread", id: target.id }),
    [onOpenPanel],
  );
  const handleQuote = useCallback(
    (target: ChannelMessage) => setQuoting(target),
    [],
  );
  const handleCopyLink = useCallback(
    async (message: ChannelMessage) => {
      const url = `${window.location.origin}${window.location.pathname}#c/${encodeURIComponent(channel?.id ?? "")}?m=${message.id}`;
      await copyText(url);
    },
    [channel?.id],
  );
  const handleCopyLinkCb = useCallback(
    (target: ChannelMessage) => void handleCopyLink(target),
    [handleCopyLink],
  );
  const pinnedSet = useMemo(
    () => new Set(pinnedItems.map((item) => item.message.id)),
    [pinnedItems],
  );
  const taskMessageIds = useMemo(
    () => new Set(tasks.map((task) => task.message_id)),
    [tasks],
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  // 单槽 notice toast：held / task 两个 notice 槽经 pickNoticeToast 合成至多一条可见项，
  // 挂在滚动流**之外**（消息区底部、composer 上方），到点自动消退。
  const [toast, setToast] = useState<NoticeToastItem | null>(null);
  const seenNoticeRef = useRef<NoticeSlots>({ held: null, task: null });
  useEffect(() => {
    const picked = pickNoticeToast(seenNoticeRef.current, {
      held: heldNotice,
      task: taskNotice,
    });
    // 先推进水位线再上屏：否则同一条 notice 被 set 成同值时会重复上屏。
    seenNoticeRef.current = { held: heldNotice, task: taskNotice };
    if (picked) setToast(picked);
  }, [heldNotice, taskNotice]);

  // 自动消退：换 notice 或卸载时清 timer（否则回调打到已卸载的组件）。
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), NOTICE_TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  /** 消息流滚动位置保存（tasks 与 messages 共用一个 main 滚动容器：切到任务板时内容变矮，
   *  浏览器会把 scrollTop 钳制到 0，切回来即丢位置——切走前按 channel 记下，切回时恢复）。 */
  const savedScrollRef = useRef<{ channelId: string; top: number } | null>(
    null,
  );

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

  // 任务板数据循环由 useChannelData.loadTasks 持有（旧内联已删）。

  /** 👥 Owner 替 agent 加入频道（公开/私有均可；#all 已全员加入，按钮不出现）。
   * 03 票：成员 id 集合由 useChannelData 持有，增删成功后经 loadMembers 重拉收敛
   * （与旧内联 setChannelMemberIds 本地更新同可见结果，收敛到服务端事实）。 */
  const addChannelMember = async (member: MemberRow) => {
    if (!channel) return;
    setMemberBusy(true);
    setMemberNotice(null);
    try {
      const res = await fetch(
        `/api/channels/${encodeURIComponent(channel.id)}/join`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memberId: member.id }),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "join failed");
      }
      setMemberNotice(t("mention.added", { name: member.name }));
      loadMembers();
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
      const res = await fetch(
        `/api/channels/${encodeURIComponent(channel.id)}/leave`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memberId: member.id }),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "leave failed");
      }
      setMemberNotice(t("mention.removed", { name: member.name }));
      loadMembers();
    } catch (e) {
      setMemberNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setMemberBusy(false);
    }
  };

  // 切换频道：面板局部态（引用/通知/展开区）重置；消息/pinned/附属区数据由 useChannelData
  // 按 channelId 接管（缓存快照 + 后台重拉 + 迟到丢弃）；任务板常驻加载。
  const activeChannelId = channel?.id;
  useEffect(() => {
    setQuoting(null);
    setHeldNotice(null);
    setTaskNotice(null);
    setToast(null);
    setPinnedOpen(false);
    setMuteOpen(false);
    setMuteNotice(null);
    setMembersOpen(false);
    setMemberNotice(null);
    // 任务板常驻加载：messages tab 的右键 Convert 依赖 canConvertToTask 判定
    loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannelId]);

  // 切换频道滚到底部（缓存快照替换后，同 commit 内完成，无中间空态/滚动跳变）。
  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current?.scrollHeight ?? 0,
      });
    });
  }, [activeChannelId]);

  useEffect(() => {
    if (tab === "tasks") loadTasks();
  }, [tab, loadTasks]);

  // Tasks tab 顺带刷新任务板（消息轮询由 useChannelData 持有）。
  useEffect(() => {
    if (!channel || tab !== "tasks") return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      loadTasks();
    }, 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel?.id, tab]);

  // 新消息到达滚到底部；切换频道时不抢滚（由下面的 channel 恢复 effect 接管），
  // 否则缓存快照替换 + 底部滚动两帧叠加 = 可见跳动。
  const activeIdForScroll = channel?.id;
  const prevChannelForScroll = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (prevChannelForScroll.current !== activeIdForScroll) {
      prevChannelForScroll.current = activeIdForScroll;
      return;
    }
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, activeIdForScroll]);

  // 向上翻页：hook 取早页（before = 首条 seq 守卫在 hook 内），取回后滚到固定位置。
  const loadEarlierPage = useCallback(() => {
    void loadEarlier().then(() => {
      scrollRef.current?.scrollTo({ top: 220 });
    });
  }, [loadEarlier]);

  const handleSend = useCallback(
    async (
      targetId: string,
      content: string,
      quoteId?: string,
      files?: File[],
    ) => {
      // 02 票：发送通道由 useChannelData.send 持有（baseSeq 携带 + held 重拉提示）。
      // 视图只做引用清理与 As Task 转化（§3.7 创建途径 2，任务板是 04 票范围）。
      const message = await sendMessage(targetId, content, quoteId, files);
      setQuoting(null);
      if (asTask && message) {
        const converted = await convertMessageToTask(message);
        if (converted) setAsTask(false);
      }
      // DM 懒创建「有消息」信号：发送成功即上抛 AppShell 刷新频道列表——
      // 侧栏私信分组随服务端 messageCount 事实即时出现（不依赖 15s 轮询 / agent 回复）。
      onChannelChanged();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sendMessage, asTask, onChannelChanged],
  );

  /** §3.4 reaction 切换：POST 后把返回的聚合写回消息状态（channel 局部；线程在面板内自持）。 */
  const toggleReaction = useCallback(
    async (message: ChannelMessage, emoji: string) => {
      try {
        const res = await fetch(
          `/api/messages/${encodeURIComponent(message.id)}/reactions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ emoji }),
          },
        );
        if (!res.ok) throw new Error(`reaction: ${res.status}`);
        const body = (await res.json()) as { reactions?: ReactionSummary[] };
        if (!body.reactions) return;
        // reaction 写回经重拉收敛（与 ThreadPanel 面板内自持写回不同，中央走服务端事实）。
        loadLatest();
      } catch (e) {
        setHeldNotice(e instanceof Error ? e.message : String(e));
      }
    },
    // setHeldNotice 是 hook 返回的稳定 setter（useState），与内联 useState 同语义。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadLatest],
  );

  /** §3.5 pin / unpin（03 票）：切换经 useChannelData.togglePin（重拉收敛），
   * 视图只做错误提示（heldNotice 复用旧内联语义）。 */
  const togglePinAction = useCallback(
    async (message: ChannelMessage) => {
      try {
        await togglePin(message.id);
      } catch (e) {
        setHeldNotice(e instanceof Error ? e.message : String(e));
      }
    },
    // setHeldNotice 是 hook 返回的稳定 setter（useState），与内联 useState 同语义。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [togglePin],
  );

  /** §3.5 Manual 排序（03 票）：↑/↓ 经 useChannelData.reorderPinned 提交重排，视图只做错误提示。 */
  const movePinned = useCallback(
    async (index: number, direction: -1 | 1) => {
      try {
        await reorderPinned(index, direction);
      } catch (e) {
        setHeldNotice(e instanceof Error ? e.message : String(e));
      }
    },
    // setHeldNotice 是 hook 返回的稳定 setter（useState），与内联 useState 同语义。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reorderPinned],
  );

  /** 打开 pinned 消息：channel 消息滚动定位；thread 消息在右栏面板打开其线程（ticket 13）。 */
  const openPinnedMessage = useCallback(
    (message: ChannelMessage) => {
      if (message.target_id === channel?.id) {
        const already = messages.some((m) => m.id === message.id);
        if (already) {
          document
            .getElementById(`msg-${message.id}`)
            ?.scrollIntoView({ block: "center" });
          return;
        }
        // 新消息经 hook 轮询/重拉收敛（下次轮询或 loadLatest）。
        loadLatest();
        requestAnimationFrame(() => {
          document
            .getElementById(`msg-${message.id}`)
            ?.scrollIntoView({ block: "center" });
        });
      } else {
        onOpenPanel?.({ kind: "thread", id: message.target_id });
      }
    },
    [channel, messages, loadLatest, onOpenPanel],
  );

  // 把消息转为任务（§3.7 创建途径 1/2 共用）：ref 化保证回调引用稳定（memo 行 props 不变）。
  const convertMessageToTaskRef = useRef<
    (msg: ChannelMessage) => Promise<ChannelTask | null>
  >(() => Promise.resolve(null));
  /** 把消息转为任务（§3.7 创建途径 1/2 共用）；返回 null 表示失败（错误已提示）。
   * 04 票：创建经 useChannelData.convertToTask（409 已是任务走 hook 的 tasksError/taskNotice），
   * 视图只做 alreadyTask 文案组装（与旧内联同文案）。 */
  const convertMessageToTask = useCallback(
    async (msg: ChannelMessage): Promise<ChannelTask | null> => {
      const created = await convertToTask(msg);
      if (created) return created;
      // 旧内联语义：409（已是任务）显示 tasks.alreadyTask 文案。
      setTaskNotice(t("tasks.alreadyTask"));
      return null;
    },
    // setTaskNotice 是 hook 返回的稳定 setter（useState），与内联 useState 同语义（02/03 票同豁免）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [convertToTask, t],
  );
  convertMessageToTaskRef.current = convertMessageToTask;
  const handleConvertToTask = useCallback(
    (target: ChannelMessage) => void convertMessageToTaskRef.current(target),
    [],
  );

  /** 任务动作（§3.7）：claim / updateStatus；受 freshness-hold 保护，409 时提示并刷新。
   * 04 票：转移序列经 useChannelData.runTaskTransition（busy 共享锁 + baseSeq 携带 +
   * held/conflict/blocked 让路语义在 hook 内），视图只做回调转发（TaskViews 视图与拖拽手势不动）。 */
  const runTaskAction = useCallback(
    async (
      task: ChannelTask,
      action: "claim" | "updateStatus",
      status?: TaskStatus,
    ) => {
      await runTaskTransition(task, action, status);
    },
    [runTaskTransition],
  );

  /** Tasks tab Create Task（§3.7 创建途径 3）：先发消息再建任务。
   * 04 票：创建经 useChannelData.createTaskFromBoard（busy 锁在 hook 内，旧内联 creatingTask
   * 同语义——Composer 的 busy 态只反映任务动作，TaskViews 的 busy prop 沿 busyAction）。 */
  const createTaskFromBoard = useCallback(
    async (contentInput: string) => {
      await createTaskFromBoardInHook(contentInput);
    },
    [createTaskFromBoardInHook],
  );

  // 深链：hash `#c/<channelId>?m=<messageId>` → 打开对应消息（thread 消息在右栏面板展开其线程）
  useEffect(() => {
    if (!channel || !focusMessageId) return;
    void fetch(`/api/messages/${encodeURIComponent(focusMessageId)}`)
      .then(async (res) => {
        if (!res.ok) return;
        const body = (await res.json()) as { message?: ChannelMessage };
        const target = body.message;
        if (!target) return;
        if (target.target_id === channel.id) {
          // 深链目标页经 hook 重拉收敛（落在最新页内时直接定位）。
          loadLatest();
          requestAnimationFrame(() => {
            document
              .getElementById(`msg-${target.id}`)
              ?.scrollIntoView({ block: "center" });
          });
        } else {
          onOpenPanel?.({ kind: "thread", id: target.target_id });
        }
      })
      .catch(() => undefined);
  }, [channel, focusMessageId, loadLatest, onOpenPanel]);

  const joined = channel?.joined ?? false;
  const isArchived = channel?.archived === 1;
  const isDM = channel?.type === "dm";
  const composerDisabled = !channel || !joined || isArchived;
  const composerDisabledHint = !channel
    ? ""
    : isArchived
      ? t("message.archivedHint")
      : joined
        ? ""
        : t("message.joinHint");

  const runChannelAction = async (
    action: "join" | "leave" | "archive",
    body: Record<string, unknown>,
  ) => {
    if (!channel || busyAction) return;
    setBusyAction(true);
    try {
      const res = await fetch(
        `/api/channels/${encodeURIComponent(channel.id)}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `${action} failed`);
      }
      onChannelChanged();
    } catch (e) {
      setHeldNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAction(false);
    }
  };

  /** §3.2 mute 开关（03 票）：取反提交经 useChannelData.toggleMute（列表写回在 hook 内），
   * 视图只做 toast 提示（与旧内联同文案）。 */
  const toggleMute = async (m: {
    memberId: string;
    name: string;
    muted: boolean;
  }) => {
    try {
      const next = await toggleMuteInHook(m.memberId);
      if (next === null) return;
      setMuteNotice(
        t(next ? "mute.toastMuted" : "mute.toastUnmuted", { name: m.name }),
      );
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
    setReminderTarget({
      targetId: channel.id,
      targetLabel: `#${channel.name}`,
    });
  };
  const openMessageReminder = (message: ChannelMessage) => {
    setReminderTarget({
      targetId: message.id,
      targetLabel: `#${message.seq} ${message.author?.name ?? ""}`.trim(),
      defaultTitle: previewLine(message.content, 60),
    });
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
      {/* channel 头部（§3.1/§3.2，形态取上游 `.chan-head` 块）：名称 + 类型/归档 badge + 描述 + 工具条（join/leave/archive + 提醒/pin/静音/成员）。
          `paddingBottom` 是调用点的偏离：上游 `.chan-head` 的 `padding: 13px 20px 0` 假定 header 末尾总有 pin-strip/tabs 提供间距，
          而本仓 header 与切换条之间隔着可折叠面板（无面板时会贴底），故补一档间距。 */}
      <header
        className="ws-center-header chan-head"
        style={{ flexShrink: 0, paddingBottom: "var(--sp-5)" }}
      >
        <div className="chan-top">
          <h1 className="chan-title">
            <span className="hash">#</span>
            <span>{channel?.name ?? t("shell.selectChannel")}</span>
          </h1>
          {channel && (
            <>
              <span className="badge soft">
                {channel.type === "dm"
                  ? t("channel.dm")
                  : channel.type === "private"
                    ? t("channel.private")
                    : t("channel.public")}
              </span>
              {isArchived && (
                <span className="badge soft">{t("channel.archived")}</span>
              )}
            </>
          )}
          {channel && (
            <div className="chan-tools">
              {channel.id !== BUILTIN_CHANNEL_ID && !isDM && (
                <>
                  {joined ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() =>
                        void runChannelAction("leave", {
                          memberId: currentMemberId,
                        })
                      }
                    >
                      {t("channel.leave")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() =>
                        void runChannelAction("join", {
                          memberId: currentMemberId,
                        })
                      }
                    >
                      {t("channel.join")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      void runChannelAction("archive", { archived: !isArchived })
                    }
                  >
                    {isArchived ? t("channel.unarchive") : t("channel.archive")}
                  </button>
                  <span className="chan-divider" aria-hidden="true" />
                </>
              )}
              {joined && (
                <button
                  type="button"
                  title={t("reminders.channelAction")}
                  aria-label={t("reminders.channelAction")}
                  className="icon-btn"
                  onClick={openChannelReminder}
                >
                  <AlarmClock size={15} />
                </button>
              )}
              {joined && (
                <button
                  type="button"
                  title={t("pinned.toggle")}
                  aria-label={t("pinned.toggle")}
                  className={`icon-btn${pinnedOpen ? " is-on" : ""}`}
                  onClick={togglePinnedPanel}
                >
                  <Pin size={15} />
                  <IconCount loading={pinnedLoading} count={pinnedItems.length} />
                </button>
              )}
              {joined && !isDM && (
                <button
                  type="button"
                  title={t("mute.toggle")}
                  aria-label={t("mute.toggle")}
                  className={`icon-btn${
                    muteOpen || mutedCount > 0 ? " is-on" : ""
                  }`}
                  onClick={toggleMutePanel}
                >
                  <BellOff size={15} />
                  <IconCount loading={mutesLoading} count={mutedCount} />
                </button>
              )}
              {joined && !isDM && (
                <button
                  type="button"
                  title={t("channel.membersPanel")}
                  aria-label={t("channel.membersPanel")}
                  className={`icon-btn${membersOpen ? " is-on" : ""}`}
                  onClick={toggleMembersPanel}
                >
                  <Users size={15} />
                  <IconCount
                    loading={membersLoading}
                    count={channelMembers.length}
                  />
                </button>
              )}
            </div>
          )}
        </div>
        {channel?.description ? (
          <div className="chan-desc">{channel.description}</div>
        ) : null}
      </header>

      {/* §3.2 mute 面板（channel 头部可展开，手风琴折叠壳常驻渲染）：静音后普通消息不进 inbox，个人 @mention 仍穿透；DM 不渲染 */}
      {joined && !isDM && (
        <div style={panelShellStyle(muteOpen)} aria-hidden={!muteOpen}>
          <div style={panelCollapseInnerStyle(muteOpen)}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 8,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font)",
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                {t("mute.toggle")}
              </span>
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--muted)",
                }}
              >
                {t("mute.hint")}
              </span>
            </div>
            {mutes.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                {t("mute.none")}
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  alignItems: "flex-start",
                }}
              >
                {mutes.map((m) => (
                  <button
                    key={m.memberId}
                    type="button"
                    title={t(m.muted ? "mute.unmuteFor" : "mute.for", {
                      name: m.name,
                    })}
                    className={m.muted ? "member-opt is-on" : "member-opt"}
                    style={{ cursor: "pointer" }}
                    onClick={() => void toggleMute(m)}
                  >
                    {m.muted ? <BellOff size={12} /> : <Bell size={12} />} @
                    {m.name}{" "}
                    <span className="mono" style={{ fontSize: 10, opacity: 0.75 }}>
                      {m.muted ? t("mute.muted") : t("mute.unmuted")}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {muteNotice && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: "var(--muted)",
                }}
              >
                {muteNotice}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 👥 频道成员面板（channel 头部可展开）：全部成员（agent 点击进详情 + 移除；人类点击看简介弹窗）+ 添加成员 */}
      {channel && joined && !isDM && (
        <div style={panelShellStyle(membersOpen)} aria-hidden={!membersOpen}>
          <div style={panelCollapseInnerStyle(membersOpen)}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 8,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font)",
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                {t("channel.membersPanel")}
              </span>
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--muted)",
                }}
              >
                {t("mention.hint")}
              </span>
            </div>
            {membersError && (
              <div
                style={{ marginBottom: 8, fontSize: 12, color: "var(--error)" }}
              >
                {membersError}
              </div>
            )}
            {channelMembers.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                {t("channel.membersEmpty")}
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  alignItems: "flex-start",
                }}
              >
                {channelMembers.map((member) => (
                  <div
                    key={member.id}
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <button
                      type="button"
                      title={member.description || member.name}
                      className="member-opt"
                      style={{ cursor: "pointer" }}
                      onClick={() =>
                        onOpenPanel?.({
                          kind: member.type === "human" ? "human" : "agent",
                          id: member.id,
                        })
                      }
                    >
                      <StatusDot status={member.status} />
                      {member.name}
                    </button>
                    {member.type === "agent" &&
                      channel.id !== BUILTIN_CHANNEL_ID && (
                        <button
                          type="button"
                          title={t("mention.remove", { name: member.name })}
                          aria-label={t("mention.remove", { name: member.name })}
                          disabled={memberBusy}
                          className="icon-btn"
                          style={{
                            width: 22,
                            height: 22,
                            flex: "0 0 22px",
                            opacity: memberBusy ? 0.55 : 1,
                          }}
                          onClick={() => void removeChannelMember(member)}
                        >
                          <X size={11} />
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
                    borderTop: `1px dashed var(--border-strong)`,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font)",
                      fontWeight: 700,
                      fontSize: 12,
                    }}
                  >
                    {t("mention.addTitle")}
                  </span>
                  {mentionable.length === channelAgents.length ? (
                    <span
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 11,
                        color: "var(--muted)",
                      }}
                    >
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
                            className="member-opt"
                            style={{
                              cursor: memberBusy ? "not-allowed" : "pointer",
                              opacity: memberBusy ? 0.55 : 1,
                            }}
                            onClick={() =>
                              void addChannelMember(
                                agents.find((a) => a.id === m.id)!,
                              )
                            }
                          >
                            <StatusDot status={m.status} />
                            {m.name}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
                {memberNotice && (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 12,
                      color: "var(--muted)",
                    }}
                  >
                    {memberNotice}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* §3.5 pinned 区（channel 头部可展开）：当前成员个性化 pinned；Manual 可 ↑/↓ 重排 */}
      {joined && (
        <div style={panelShellStyle(pinnedOpen)} aria-hidden={!pinnedOpen}>
          <div style={panelCollapseInnerStyle(pinnedOpen)}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 8,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font)",
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                {t("pinned.title")}
              </span>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  fontFamily: "var(--font)",
                  fontWeight: 700,
                  fontSize: 11,
                }}
              >
                {t("pinned.sort")}
                <select
                  value={pinnedSort}
                  onChange={(e) => {
                    setPinnedSort(e.target.value as "manual" | "recent" | "az");
                    openPinnedPanel();
                  }}
                  className="select"
                  style={{
                    width: "auto",
                    height: "var(--control-h-sm)",
                    padding: "0 var(--sp-2)",
                    fontSize: "var(--fs-sm)",
                  }}
                >
                  <option value="manual">{t("pinned.sortManual")}</option>
                  <option value="recent">{t("pinned.sortRecent")}</option>
                  <option value="az">{t("pinned.sortAz")}</option>
                </select>
              </label>
              {pinnedError && (
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    color: "var(--error)",
                  }}
                >
                  {pinnedError}
                </span>
              )}
            </div>
            {pinnedItems.length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: 12 }}>
                {t("pinned.empty")}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {pinnedItems.map((item, index) => (
                  /* 置顶行的形态 = 上游 `.pin-strip` callout（`--panel` 底 + accent pin 图标）；
                     本仓的置顶区是可展开的多行列表（原型是头部单行 strip）——形态登记在票据 Answer。 */
                  <div
                    key={item.message.id}
                    className="pin-strip"
                    style={{ cursor: "pointer" }}
                    role="button"
                    tabIndex={0}
                    onClick={() => openPinnedMessage(item.message)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") openPinnedMessage(item.message);
                    }}
                  >
                    <span className="icon" aria-hidden="true">
                      <Pin size={13} />
                    </span>
                    <b className="mono" style={{ color: "var(--muted)" }}>
                      #{item.message.seq}
                    </b>
                    <span
                      style={{
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
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
                          aria-label={t("pinned.moveUp")}
                          disabled={index === 0}
                          className="icon-btn"
                          style={SMALL_ICON_BTN_STYLE}
                          onClick={() => void movePinned(index, -1)}
                        >
                          <ChevronUp size={12} />
                        </button>
                        <button
                          type="button"
                          title={t("pinned.moveDown")}
                          aria-label={t("pinned.moveDown")}
                          disabled={index === pinnedItems.length - 1}
                          className="icon-btn"
                          style={SMALL_ICON_BTN_STYLE}
                          onClick={() => void movePinned(index, 1)}
                        >
                          <ChevronDown size={12} />
                        </button>
                        <button
                          type="button"
                          title={t("message.unpin")}
                          aria-label={t("message.unpin")}
                          className="icon-btn"
                          style={SMALL_ICON_BTN_STYLE}
                          onClick={() => void togglePinAction(item.message)}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Messages / Tasks 切换条（§3.1；上游 `.tabs` 块）。`marginTop: 0` 是调用点的偏离：
          上游把 `.tabs` 放在 `.chan-head` 内，本仓它是 header 的兄弟（票 03 起的分工）——
          逐字块带的 `margin-top: 11px` 会在发丝下留一条 `--bg` 缝。 */}
      <div
        className="tabs"
        style={{ marginTop: 0, paddingInline: "var(--sp-9)", flexShrink: 0 }}
        role="tablist"
      >
        {(["messages", "tasks"] as const).map((tabId) => (
          <button
            key={tabId}
            type="button"
            role="tab"
            aria-selected={tab === tabId}
            className={tab === tabId ? "tab is-active" : "tab"}
            onClick={() => handleTabChange(tabId)}
          >
            {tabId === "messages" ? t("center.messages") : t("center.tasks")}
          </button>
        ))}
      </div>

      {/* 主体：消息 tab 走上游 `.stream` / `.stream-inner`（padding + `--stream-max` 居中）；
          Tasks tab 仍是满宽看板（`.board-wrap` 自带 padding，不吃 stream 的 max-width）。
          外层定位壳给浮层 toast 当锚点：壳的下边缘 = 消息区底边，composer 是它的兄弟节点，
          所以 toast 天然落在消息区底部、composer 上方，不必知道 composer 有多高。 */}
      <div
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <main
          ref={scrollRef}
          className={tab === "messages" ? "stream" : undefined}
          style={{
            flex: 1,
            minHeight: 0,
            overflowX: "hidden",
            overflowY: "auto",
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
        >
        {tab === "messages" ? (
          !channel ? (
            <EmptyState
              glyph="#"
              title={t("shell.selectChannel")}
              hint={t("messages.emptyHint")}
            />
          ) : loadError ? (
            <div style={{ padding: 24, color: "var(--error)", fontSize: 13 }}>
              {loadError}
            </div>
          ) : messagesLoading ? (
            <EmptyState
              glyph="…"
              title={t("messages.loading")}
              hint={t("messages.loadingHint")}
            />
          ) : messages.length === 0 ? (
            <EmptyState
              glyph="#"
              title={t(isDM ? "messages.emptyDM" : "messages.empty")}
              hint={t("messages.emptyHint")}
            />
          ) : (
            /* `--stream-max` 居中列（上游 `.stream-inner`）：空态 / 加载态不吃它（它们自己居中且 `height: 100%`）。 */
            <div className="stream-inner">
              {hasMore && (
                <div style={{ padding: "0 0 var(--sp-3)", textAlign: "center" }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => void loadEarlierPage()}
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
                    pinned={pinnedSet.has(m.id)}
                    canConvertToTask={!taskMessageIds.has(m.id)}
                    convertInActionBar
                    mentionMembers={mentionMembers}
                    onOpenMention={openMention}
                    onOpenMember={openMemberPanel}
                    onReply={openThreadPanel}
                    onQuote={handleQuote}
                    onCopyLink={handleCopyLinkCb}
                    onConvertToTask={handleConvertToTask}
                    onSetReminder={joined ? openMessageReminder : undefined}
                    onToggleReaction={joined ? toggleReaction : undefined}
                    onTogglePin={joined ? togglePinAction : undefined}
                    onOpenThread={openThreadPanel}
                  />
                </div>
              ))}
            </div>
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
            onAction={(task, action, status) =>
              void runTaskAction(task, action, status)
            }
            onOpenThread={(anchor) =>
              onOpenPanel?.({ kind: "thread", id: anchor.id })
            }
            onNotice={setTaskNotice}
          />
        )}
        </main>

        {/* 浮层 notice toast：位置在**滚动流之外**（流内末尾会被下方 composer 遮住，
            且要滚到底才看得到）。两个 tab 都用——Tasks tab 的 notice 由 TaskViews 自己的
            呈现位承担（notice={taskNotice}，见上），那是看板内的固定槽位，不经这里。 */}
        <NoticeToast toast={toast} />
      </div>

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
          focusSignal={composerFocusSignal}
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
