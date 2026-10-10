/**
 * 数据层共享类型与纯函数（Ticket 03 Separate Data Layer）。
 *
 * 这是业务模块与数据适配器（SQLiteAdapter/未来的 InMemoryAdapter）之间的共享词表：
 * 行类型、插入输入类型、枚举联合、搜索纯函数。存储实现（`lib/data/sqlite.ts`）与
 * 契约接口（`lib/data/store.ts`）都从这里取类型，业务模块也只从这里 import 类型，
 * 不再涉及具体 adapter。
 */

export type ChannelType = "public" | "private" | "dm";
export type MemberType = "human" | "agent";
export type MemberRole = "owner" | "member";
export type MemberStatus = "online" | "working" | "error" | "offline";
export type TaskStatus = "todo" | "in_progress" | "in_review" | "done" | "closed";
export type ReminderStatus = "scheduled" | "fired" | "canceled";

export interface ChannelRow {
  id: string;
  name: string;
  type: ChannelType;
  description: string;
  archived: number;
  created_at: string;
}

export interface MemberRow {
  id: string;
  type: MemberType;
  name: string;
  description: string;
  role: MemberRole;
  workspace_path: string | null;
  pi_session_file: string | null;
  status: MemberStatus;
  deleted: number;
  /** §3.10 per-agent runtime：覆盖全局默认的模型/思考级别（nullable = 继承全局）。 */
  model_provider: string | null;
  model_id: string | null;
  thinking_level: string | null;
  created_at: string;
}

export interface ChannelMemberRow {
  channel_id: string;
  member_id: string;
  joined_at: string;
}

export interface MessageRow {
  id: string;
  target_id: string;
  seq: number;
  author_id: string;
  content: string;
  created_at: string;
  /** 全局插入序（mute 的"静音后"判定；listMessagesAfter 附上，其余构造路径无）。 */
  rowid?: number;
}

export interface TaskRow {
  id: string;
  message_id: string;
  number: number;
  status: TaskStatus;
  owner_id: string | null;
  /** §3.7 重开封锁标记：reopen 置 1、人类认领清 0；置 1 期间 agent-loop 不可自动认领。 */
  reopened: number;
  updated_at: string;
}

/** Owner 按 Task 持久保存的讨论已读基线与游标。 */
export interface TaskThreadReadRow {
  task_id: string;
  baseline_seq: number;
  read_seq: number;
  updated_at: string;
}

export interface ReminderRow {
  id: string;
  title: string;
  fire_at: string;
  recurrence: string | null;
  target_id: string | null;
  author_id: string;
  status: ReminderStatus;
  created_at: string;
}

export type ReminderLogEvent =
  | "schedule"
  | "fire"
  | "reschedule"
  | "snooze"
  | "update"
  | "cancel"
  | "error";

export interface ReminderLogRow {
  id: string;
  reminder_id: string;
  event: ReminderLogEvent;
  detail: string;
  created_at: string;
}

/** §07 轮次结果（Round Outcome）落盘行：一次有结论的 agent-loop 轮次。 */
export interface RoundLogRow {
  id: string;
  agent_id: string;
  target_id: string;
  status: "replied" | "ignored" | "silent" | "anyway" | "yielded" | "error" | "busy-cwd";
  reason: string;
  base_seq: number;
  created_at: string;
}

export interface ReactionRow {
  id: string;
  message_id: string;
  member_id: string;
  emoji: string;
  created_at: string;
}

export interface AttachmentRow {
  id: string;
  message_id: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  disk_path: string;
  created_at: string;
}

export interface PinnedMessageRow {
  id: string;
  channel_id: string;
  message_id: string;
  member_id: string;
  order: number;
  pinned_at: string;
}

export interface ChannelMuteRow {
  channel_id: string;
  member_id: string;
  mute_from_seq: number;
  mute_rowid: number;
  created_at: string;
}

export interface SearchResult {
  id: string;
  target_id: string;
  seq: number;
  author_id: string;
  created_at: string;
  snippet: string;
}

export interface InsertMessageInput {
  id?: string;
  targetId: string;
  seq: number;
  authorId: string;
  content: string;
  createdAt?: string;
}

export interface AppendMessageInput {
  id?: string;
  targetId: string;
  authorId: string;
  content: string;
  createdAt?: string;
}

export function toFtsQuery(input: string): string {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(" AND ");
}

/** LIKE 通配符转义（短 token 兜底路径）。 */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const escapeHtml = (input: string): string =>
  input.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);

export { escapeLike };

/**
 * 命中上下文摘要（§6.4）：取最早命中词前后 radius 字符，正文转义后仅高亮命中词。
 * 不用 SQL 侧 snippet()（其输出不转义正文，消息内容里的 HTML 会原样透出）；
 * FTS 路径与 LIKE 兜底路径共用，保证两路摘要形态一致。
 */
export function buildSearchSnippet(content: string, terms: string[], radius = 60): string {
  const lower = content.toLowerCase();
  let best = -1;
  let bestLen = 0;
  for (const term of terms) {
    const idx = lower.indexOf(term.toLowerCase());
    if (idx !== -1 && term.length > bestLen) {
      best = idx;
      bestLen = term.length;
    }
  }
  if (best === -1) {
    const head = content.slice(0, radius * 2);
    return escapeHtml(head) + (content.length > head.length ? "…" : "");
  }
  const start = Math.max(0, best - radius);
  const end = Math.min(content.length, best + bestLen + radius);
  const matchStart = best - start;
  const matchEnd = matchStart + bestLen;
  const prefix = start > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";
  return (
    prefix +
    escapeHtml(content.slice(start, start + matchStart)) +
    `<mark>` +
    escapeHtml(content.slice(start + matchStart, start + matchEnd)) +
    `</mark>` +
    escapeHtml(content.slice(start + matchEnd, end)) +
    suffix
  );
}
