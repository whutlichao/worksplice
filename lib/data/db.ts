import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { ensureDataDir, resolveDataDir, type DataPaths } from "./dirs.ts";
import { runMigrations, SCHEMA_VERSION } from "./schema.ts";

export type ChannelType = "public" | "private";
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

export interface ConsumedSeqRow {
  agent_id: string;
  target_id: string;
  seq: number;
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

const escapeHtml = (input: string): string => input.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);

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

export class RaftStore {
  readonly db: Database.Database;
  readonly paths: DataPaths;

  private constructor(db: Database.Database, paths: DataPaths) {
    this.db = db;
    this.paths = paths;
  }

  static open(dataDir?: string): RaftStore {
    const dir = dataDir ?? resolveDataDir();
    const paths = ensureDataDir(dir);
    const db = new Database(paths.dbFile);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    return new RaftStore(db, paths);
  }

  close(): void {
    this.db.close();
  }

  withTransaction<T>(fn: () => T): T {
    const tx = this.db.transaction(fn);
    return tx();
  }

  /** Freshness primitive: 房间版本 = 该 target 的 max(seq)（§6.3） */
  maxSeq(targetId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM messages WHERE target_id = ?")
      .get(targetId) as { seq: number };
    return row.seq;
  }

  listChannels(): ChannelRow[] {
    return this.db
      .prepare("SELECT * FROM channels ORDER BY created_at, id")
      .all() as ChannelRow[];
  }

  getChannel(id: string): ChannelRow | undefined {
    return this.db.prepare("SELECT * FROM channels WHERE id = ?").get(id) as
      | ChannelRow
      | undefined;
  }

  insertChannel(input: {
    id?: string;
    name: string;
    type?: ChannelType;
    description?: string;
    createdAt?: string;
  }): ChannelRow {
    const row: ChannelRow = {
      id: input.id ?? randomUUID(),
      name: input.name,
      type: input.type ?? "public",
      description: input.description ?? "",
      archived: 0,
      created_at: input.createdAt ?? new Date().toISOString(),
    };
    this.db
      .prepare(
        "INSERT INTO channels (id, name, type, description, archived, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(row.id, row.name, row.type, row.description, row.archived, row.created_at);
    return row;
  }

  setChannelArchived(id: string, archived: number): void {
    this.db.prepare("UPDATE channels SET archived = ? WHERE id = ?").run(archived ? 1 : 0, id);
  }

  listChannelMembers(channelId: string): ChannelMemberRow[] {
    return this.db
      .prepare("SELECT * FROM channel_members WHERE channel_id = ? ORDER BY joined_at, member_id")
      .all(channelId) as ChannelMemberRow[];
  }

  isChannelMember(channelId: string, memberId: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS hit FROM channel_members WHERE channel_id = ? AND member_id = ?")
      .get(channelId, memberId) as { hit: number } | undefined;
    return row !== undefined;
  }

  addChannelMember(channelId: string, memberId: string): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO channel_members (channel_id, member_id, joined_at) VALUES (?, ?, ?)",
      )
      .run(channelId, memberId, new Date().toISOString());
  }

  removeChannelMember(channelId: string, memberId: string): void {
    this.db
      .prepare("DELETE FROM channel_members WHERE channel_id = ? AND member_id = ?")
      .run(channelId, memberId);
  }

  /** 游标分页：返回 seq < beforeSeq 的最近 limit 条，DESC 序（倒序页；latest 页传 undefined）。 */
  listMessagesBefore(targetId: string, beforeSeq: number | undefined, limit: number): MessageRow[] {
    if (beforeSeq === undefined) {
      return this.db
        .prepare("SELECT * FROM messages WHERE target_id = ? ORDER BY seq DESC LIMIT ?")
        .all(targetId, limit) as MessageRow[];
    }
    return this.db
      .prepare("SELECT * FROM messages WHERE target_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?")
      .all(targetId, beforeSeq, limit) as MessageRow[];
  }

  hasMessagesBefore(targetId: string, seq: number): boolean {
    const row = this.db
      .prepare("SELECT 1 AS hit FROM messages WHERE target_id = ? AND seq < ? LIMIT 1")
      .get(targetId, seq) as { hit: number } | undefined;
    return row !== undefined;
  }

  /** 线程回复数（thread 消息以锚点消息 id 为 target，§6.1）。 */
  threadReplyCount(messageId: string): number {
    return this.threadReplyCounts([messageId]).get(messageId) ?? 0;
  }

  /** 批量线程回复数（一次 GROUP BY 查询，channel 分页免 N+1）。 */
  threadReplyCounts(messageIds: string[]): Map<string, number> {
    const map = new Map<string, number>();
    if (messageIds.length === 0) return map;
    const placeholders = messageIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT target_id, COUNT(*) AS count FROM messages WHERE target_id IN (${placeholders}) GROUP BY target_id`)
      .all(...messageIds) as Array<{ target_id: string; count: number }>;
    for (const row of rows) map.set(row.target_id, row.count);
    return map;
  }

  /** seq > afterSeq 的增量（ASC；freshness-hold 摘要 / inbox 后续复用）。附 rowid 供 mute 判定。 */
  listMessagesAfter(targetId: string, afterSeq: number): MessageRow[] {
    return this.db
      .prepare(
        "SELECT m.*, m.rowid AS rowid FROM messages m WHERE m.target_id = ? AND m.seq > ? ORDER BY m.seq",
      )
      .all(targetId, afterSeq) as MessageRow[];
  }

  listMembers(): MemberRow[] {
    return this.db
      .prepare("SELECT * FROM members WHERE deleted = 0 ORDER BY created_at, id")
      .all() as MemberRow[];
  }

  /** 原始行列表（含 soft-deleted）：归属引用集需要被删成员的固化登记（ticket 08，§3.6 行保留承载所有权）。 */
  listMembersIncludingDeleted(): MemberRow[] {
    return this.db
      .prepare("SELECT * FROM members ORDER BY created_at, id")
      .all() as MemberRow[];
  }

  /** 原始行查询（含 soft-deleted）：消息作者渲染与历史保留需要（§3.6）。 */
  getMember(id: string): MemberRow | undefined {
    return this.db.prepare("SELECT * FROM members WHERE id = ?").get(id) as
      | MemberRow
      | undefined;
  }

  /** 按名字查原始行（含 soft-deleted）：秘书唯一性判定（spec-bootstrap-agent §6.1，判定键 = 名字 + 软删标记）。 */
  getMemberByName(name: string): MemberRow | undefined {
    return this.db.prepare("SELECT * FROM members WHERE name = ? LIMIT 1").get(name) as
      | MemberRow
      | undefined;
  }

  insertMember(input: {
    id?: string;
    type: MemberType;
    name: string;
    description?: string;
    role?: MemberRole;
    workspacePath?: string | null;
    piSessionFile?: string | null;
    status?: MemberStatus;
    modelProvider?: string | null;
    modelId?: string | null;
    thinkingLevel?: string | null;
    createdAt?: string;
  }): MemberRow {
    const row: MemberRow = {
      id: input.id ?? randomUUID(),
      type: input.type,
      name: input.name,
      description: input.description ?? "",
      role: input.role ?? "member",
      workspace_path: input.workspacePath ?? null,
      pi_session_file: input.piSessionFile ?? null,
      status: input.status ?? "offline",
      deleted: 0,
      model_provider: input.modelProvider ?? null,
      model_id: input.modelId ?? null,
      thinking_level: input.thinkingLevel ?? null,
      created_at: input.createdAt ?? new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO members (id, type, name, description, role, workspace_path, pi_session_file, status, deleted, model_provider, model_id, thinking_level, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.type,
        row.name,
        row.description,
        row.role,
        row.workspace_path,
        row.pi_session_file,
        row.status,
        row.deleted,
        row.model_provider,
        row.model_id,
        row.thinking_level,
        row.created_at,
      );
    return row;
  }

  updateMemberStatus(id: string, status: MemberStatus): void {
    this.db.prepare("UPDATE members SET status = ? WHERE id = ?").run(status, id);
  }

  setMemberWorkspace(id: string, workspacePath: string, piSessionFile: string): void {
    this.db
      .prepare("UPDATE members SET workspace_path = ?, pi_session_file = ? WHERE id = ?")
      .run(workspacePath, piSessionFile, id);
  }

  /** 更换/清理 workspace 绑定：旧 session 文件路径一并清空（§3.6 换目录即换会话）。 */
  updateMemberWorkspace(id: string, workspacePath: string): void {
    this.db
      .prepare("UPDATE members SET workspace_path = ?, pi_session_file = NULL WHERE id = ?")
      .run(workspacePath, id);
  }

  setMemberPiSessionFile(id: string, piSessionFile: string | null): void {
    this.db
      .prepare("UPDATE members SET pi_session_file = ? WHERE id = ?")
      .run(piSessionFile, id);
  }

  /** §3.10 per-agent runtime：设置/清空模型覆盖（未提供的字段保持原值，null = 清空回全局）。 */
  setMemberModel(
    id: string,
    input: {
      modelProvider?: string | null;
      modelId?: string | null;
      thinkingLevel?: string | null;
    },
  ): void {
    const updates: string[] = [];
    const params: unknown[] = [];
    if (input.modelProvider !== undefined) {
      updates.push("model_provider = ?");
      params.push(input.modelProvider);
    }
    if (input.modelId !== undefined) {
      updates.push("model_id = ?");
      params.push(input.modelId);
    }
    if (input.thinkingLevel !== undefined) {
      updates.push("thinking_level = ?");
      params.push(input.thinkingLevel);
    }
    if (updates.length === 0) return;
    params.push(id);
    this.db.prepare(`UPDATE members SET ${updates.join(", ")} WHERE id = ?`).run(...params);
  }

  setMemberDeleted(id: string, deleted: number): void {
    this.db.prepare("UPDATE members SET deleted = ? WHERE id = ?").run(deleted ? 1 : 0, id);
  }

  /** 删除身份：认领消失（§3.6），任务回到未认领池。 */
  clearTaskOwners(memberId: string): void {
    this.db.prepare("UPDATE tasks SET owner_id = NULL WHERE owner_id = ?").run(memberId);
  }

  clearConsumedSeqsForAgent(agentId: string): void {
    this.db.prepare("DELETE FROM consumed_seqs WHERE agent_id = ?").run(agentId);
  }

  removeMemberFromAllChannels(memberId: string): void {
    this.db.prepare("DELETE FROM channel_members WHERE member_id = ?").run(memberId);
  }

  listMessages(targetId: string): MessageRow[] {
    return this.db
      .prepare("SELECT * FROM messages WHERE target_id = ? ORDER BY seq")
      .all(targetId) as MessageRow[];
  }

  getMessage(id: string): MessageRow | undefined {
    return this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as
      | MessageRow
      | undefined;
  }

  /** 显式 seq 写入（测试/迁移用）；同 (target_id, seq) 由 UNIQUE 约束拒绝 */
  insertMessageAt(input: InsertMessageInput): MessageRow {
    const row: MessageRow = {
      id: input.id ?? randomUUID(),
      target_id: input.targetId,
      seq: input.seq,
      author_id: input.authorId,
      content: input.content,
      created_at: input.createdAt ?? new Date().toISOString(),
    };
    this.db
      .prepare(
        "INSERT INTO messages (id, target_id, seq, author_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(row.id, row.target_id, row.seq, row.author_id, row.content, row.created_at);
    return row;
  }

  /** 事务内 max(seq)+1 追加（§6.3 的 freshness 写法在 withTransaction 内可用） */
  appendMessage(input: AppendMessageInput): MessageRow {
    return this.withTransaction(() => {
      const seq = this.maxSeq(input.targetId) + 1;
      return this.insertMessageAt({ ...input, seq });
    });
  }

  /**
   * 全文搜索（§6.4）：结果 = id + 命中上下文摘要（<mark> 高亮）。
   * 双路径：全部 token ≥3 字符 → trigram FTS（rank 排序）；
   * 含短 token（如 CJK 双字词）→ LIKE 兜底（trigram 需 ≥3 字符）。
   * 触发器同步（schema v5）：新消息插入立即可搜。
   */
  searchMessages(query: string, limit = 20): SearchResult[] {
    const tokens = query.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    const pick = (row: MessageRow): SearchResult => ({
      id: row.id,
      target_id: row.target_id,
      seq: row.seq,
      author_id: row.author_id,
      created_at: row.created_at,
      snippet: buildSearchSnippet(row.content, tokens),
    });
    if (tokens.every((token) => token.length >= 3)) {
      const fts = toFtsQuery(tokens.join(" "));
      const rows = this.db
        .prepare(
          `SELECT m.id, m.target_id, m.seq, m.author_id, m.created_at, m.content
           FROM messages_fts
           JOIN messages m ON m.rowid = messages_fts.rowid
           WHERE messages_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(fts, limit) as MessageRow[];
      return rows.map(pick);
    }
    // 短 token 兜底：LIKE AND 组合，按插入序倒序（rowid DESC）。
    const conditions = tokens.map(() => "content LIKE ? ESCAPE '\\'").join(" AND ");
    const params = tokens.map((token) => `%${escapeLike(token)}%`);
    const rows = this.db
      .prepare(`SELECT * FROM messages WHERE ${conditions} ORDER BY rowid DESC LIMIT ?`)
      .all(...params, limit) as MessageRow[];
    return rows.map(pick);
  }

  insertTask(input: {
    id?: string;
    messageId: string;
    number: number;
    status?: TaskStatus;
    ownerId?: string | null;
    reopened?: number;
    updatedAt?: string;
  }): TaskRow {
    const row: TaskRow = {
      id: input.id ?? randomUUID(),
      message_id: input.messageId,
      number: input.number,
      status: input.status ?? "todo",
      owner_id: input.ownerId ?? null,
      reopened: input.reopened ?? 0,
      updated_at: input.updatedAt ?? new Date().toISOString(),
    };
    this.db
      .prepare(
        "INSERT INTO tasks (id, message_id, number, status, owner_id, reopened, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(row.id, row.message_id, row.number, row.status, row.owner_id, row.reopened, row.updated_at);
    return row;
  }

  listTasks(): TaskRow[] {
    return this.db.prepare("SELECT * FROM tasks ORDER BY number").all() as TaskRow[];
  }

  /** channel 内任务（任务锚点消息必为顶层消息，§3.7）：按 number 升序。 */
  listChannelTasks(channelId: string): TaskRow[] {
    return this.db
      .prepare(
        `SELECT tasks.* FROM tasks
         JOIN messages ON messages.id = tasks.message_id
         WHERE messages.target_id = ?
         ORDER BY tasks.number`,
      )
      .all(channelId) as TaskRow[];
  }

  getTaskById(id: string): TaskRow | undefined {
    return this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
  }

  getTaskByMessageId(messageId: string): TaskRow | undefined {
    return this.db.prepare("SELECT * FROM tasks WHERE message_id = ?").get(messageId) as
      | TaskRow
      | undefined;
  }

  getTaskByChannelNumber(channelId: string, number: number): TaskRow | undefined {
    return this.db
      .prepare(
        `SELECT tasks.* FROM tasks
         JOIN messages ON messages.id = tasks.message_id
         WHERE messages.target_id = ? AND tasks.number = ?`,
      )
      .get(channelId, number) as TaskRow | undefined;
  }

  /** channel 内下一个任务 number（#1 #2…，按 channel 递增，§3.7）。 */
  nextTaskNumber(channelId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(MAX(tasks.number), 0) AS number FROM tasks
         JOIN messages ON messages.id = tasks.message_id
         WHERE messages.target_id = ?`,
      )
      .get(channelId) as { number: number };
    return row.number + 1;
  }

  /** 更新任务字段（status/owner/reopened）；返回更新后的行，不存在返回 undefined。 */
  updateTask(
    id: string,
    input: {
      status?: TaskStatus;
      ownerId?: string | null;
      reopened?: number;
      updatedAt?: string;
    },
  ): TaskRow | undefined {
    const existing = this.getTaskById(id);
    if (!existing) return undefined;
    const row: TaskRow = {
      ...existing,
      status: input.status ?? existing.status,
      owner_id: input.ownerId !== undefined ? input.ownerId : existing.owner_id,
      reopened: input.reopened !== undefined ? input.reopened : existing.reopened,
      updated_at: input.updatedAt ?? new Date().toISOString(),
    };
    this.db
      .prepare("UPDATE tasks SET status = ?, owner_id = ?, reopened = ?, updated_at = ? WHERE id = ?")
      .run(row.status, row.owner_id, row.reopened, row.updated_at, id);
    return row;
  }

  insertReminder(input: {
    id?: string;
    title: string;
    fireAt: string;
    recurrence?: string | null;
    targetId?: string | null;
    authorId: string;
    status?: ReminderStatus;
    createdAt?: string;
  }): ReminderRow {
    const row: ReminderRow = {
      id: input.id ?? randomUUID(),
      title: input.title,
      fire_at: input.fireAt,
      recurrence: input.recurrence ?? null,
      target_id: input.targetId ?? null,
      author_id: input.authorId,
      status: input.status ?? "scheduled",
      created_at: input.createdAt ?? new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO reminders (id, title, fire_at, recurrence, target_id, author_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.title,
        row.fire_at,
        row.recurrence,
        row.target_id,
        row.author_id,
        row.status,
        row.created_at,
      );
    return row;
  }

  listReminders(): ReminderRow[] {
    return this.db.prepare("SELECT * FROM reminders ORDER BY fire_at").all() as ReminderRow[];
  }

  getReminderById(id: string): ReminderRow | undefined {
    return this.db.prepare("SELECT * FROM reminders WHERE id = ?").get(id) as
      | ReminderRow
      | undefined;
  }

  listRemindersByAuthor(authorId: string): ReminderRow[] {
    return this.db
      .prepare("SELECT * FROM reminders WHERE author_id = ? ORDER BY fire_at")
      .all(authorId) as ReminderRow[];
  }

  /** 锚定在某 target（channel 或消息）上的提醒（UI "查看/取消"入口用）。 */
  listRemindersForTarget(targetId: string): ReminderRow[] {
    return this.db
      .prepare("SELECT * FROM reminders WHERE target_id = ? ORDER BY fire_at")
      .all(targetId) as ReminderRow[];
  }

  /** 更新提醒字段（fire/recurrence 续算、snooze/update/cancel 共用）；不存在返回 undefined。 */
  updateReminder(
    id: string,
    input: {
      title?: string;
      fireAt?: string;
      recurrence?: string | null;
      targetId?: string | null;
      status?: ReminderStatus;
    },
  ): ReminderRow | undefined {
    const existing = this.getReminderById(id);
    if (!existing) return undefined;
    const row: ReminderRow = {
      ...existing,
      title: input.title !== undefined ? input.title : existing.title,
      fire_at: input.fireAt !== undefined ? input.fireAt : existing.fire_at,
      recurrence: input.recurrence !== undefined ? input.recurrence : existing.recurrence,
      target_id: input.targetId !== undefined ? input.targetId : existing.target_id,
      status: input.status ?? existing.status,
    };
    this.db
      .prepare(
        "UPDATE reminders SET title = ?, fire_at = ?, recurrence = ?, target_id = ?, status = ? WHERE id = ?",
      )
      .run(row.title, row.fire_at, row.recurrence, row.target_id, row.status, id);
    return row;
  }

  insertReminderLog(input: {
    id?: string;
    reminderId: string;
    event: ReminderLogEvent;
    detail?: string;
    createdAt?: string;
  }): ReminderLogRow {
    const row: ReminderLogRow = {
      id: input.id ?? randomUUID(),
      reminder_id: input.reminderId,
      event: input.event,
      detail: input.detail ?? "",
      created_at: input.createdAt ?? new Date().toISOString(),
    };
    this.db
      .prepare(
        "INSERT INTO reminder_logs (id, reminder_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(row.id, row.reminder_id, row.event, row.detail, row.created_at);
    return row;
  }

  listReminderLogs(reminderId: string): ReminderLogRow[] {
    return this.db
      .prepare("SELECT * FROM reminder_logs WHERE reminder_id = ? ORDER BY rowid")
      .all(reminderId) as ReminderLogRow[];
  }

  insertRoundLog(input: {
    id?: string;
    agentId: string;
    targetId: string;
    status: RoundLogRow["status"];
    reason?: string;
    baseSeq?: number;
    createdAt?: string;
  }): RoundLogRow {
    const row: RoundLogRow = {
      id: input.id ?? randomUUID(),
      agent_id: input.agentId,
      target_id: input.targetId,
      status: input.status,
      reason: input.reason ?? "",
      base_seq: input.baseSeq ?? 0,
      created_at: input.createdAt ?? new Date().toISOString(),
    };
    this.db
      .prepare(
        "INSERT INTO round_logs (id, agent_id, target_id, status, reason, base_seq, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(row.id, row.agent_id, row.target_id, row.status, row.reason, row.base_seq, row.created_at);
    return row;
  }

  /** 某 agent 的轮次记录（rowid 倒序 = 最近在前）。 */
  listRoundLogs(agentId: string, limit = 50): RoundLogRow[] {
    return this.db
      .prepare("SELECT * FROM round_logs WHERE agent_id = ? ORDER BY rowid DESC LIMIT ?")
      .all(agentId, limit) as RoundLogRow[];
  }

  /** §09 某 target 的全部轮次（rowid 倒序 = 最近在前）；按 agent 取最新一轮由服务层收口。 */
  listRoundLogsByTarget(targetId: string): RoundLogRow[] {
    return this.db
      .prepare("SELECT * FROM round_logs WHERE target_id = ? ORDER BY rowid DESC")
      .all(targetId) as RoundLogRow[];
  }

  /** 每 agent 保留最近 retain 条，超出删除旧行（§07 ring cap）。 */
  pruneRoundLogs(agentId: string, retain: number): void {
    this.db
      .prepare(
        `DELETE FROM round_logs WHERE agent_id = ? AND rowid NOT IN (
          SELECT rowid FROM round_logs WHERE agent_id = ? ORDER BY rowid DESC LIMIT ?
        )`,
      )
      .run(agentId, agentId, retain);
  }

  insertReaction(input: {
    id?: string;
    messageId: string;
    memberId: string;
    emoji: string;
    createdAt?: string;
  }): ReactionRow {
    const row: ReactionRow = {
      id: input.id ?? randomUUID(),
      message_id: input.messageId,
      member_id: input.memberId,
      emoji: input.emoji,
      created_at: input.createdAt ?? new Date().toISOString(),
    };
    this.db
      .prepare(
        "INSERT INTO reactions (id, message_id, member_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(row.id, row.message_id, row.member_id, row.emoji, row.created_at);
    return row;
  }

  listReactions(messageId: string): ReactionRow[] {
    return this.db
      .prepare("SELECT * FROM reactions WHERE message_id = ? ORDER BY created_at")
      .all(messageId) as ReactionRow[];
  }

  hasReaction(messageId: string, memberId: string, emoji: string): boolean {
    const row = this.db
      .prepare(
        "SELECT 1 AS hit FROM reactions WHERE message_id = ? AND member_id = ? AND emoji = ? LIMIT 1",
      )
      .get(messageId, memberId, emoji) as { hit: number } | undefined;
    return row !== undefined;
  }

  /** 再次点击取消（§3.4 toggle）；返回是否真的删掉了。 */
  deleteReaction(messageId: string, memberId: string, emoji: string): boolean {
    const result = this.db
      .prepare("DELETE FROM reactions WHERE message_id = ? AND member_id = ? AND emoji = ?")
      .run(messageId, memberId, emoji);
    return result.changes > 0;
  }

  insertAttachment(input: {
    id?: string;
    messageId: string;
    fileName: string;
    mime?: string;
    sizeBytes?: number;
    diskPath: string;
    createdAt?: string;
  }): AttachmentRow {
    const row: AttachmentRow = {
      id: input.id ?? randomUUID(),
      message_id: input.messageId,
      file_name: input.fileName,
      mime: input.mime ?? "",
      size_bytes: input.sizeBytes ?? 0,
      disk_path: input.diskPath,
      created_at: input.createdAt ?? new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO attachments (id, message_id, file_name, mime, size_bytes, disk_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.message_id,
        row.file_name,
        row.mime,
        row.size_bytes,
        row.disk_path,
        row.created_at,
      );
    return row;
  }

  listAttachments(messageId: string): AttachmentRow[] {
    return this.db
      .prepare("SELECT * FROM attachments WHERE message_id = ? ORDER BY created_at")
      .all(messageId) as AttachmentRow[];
  }

  getAttachment(id: string): AttachmentRow | undefined {
    return this.db.prepare("SELECT * FROM attachments WHERE id = ?").get(id) as
      | AttachmentRow
      | undefined;
  }

  insertPinnedMessage(input: {
    id?: string;
    channelId: string;
    messageId: string;
    memberId: string;
    order?: number;
    pinnedAt?: string;
  }): PinnedMessageRow {
    const row: PinnedMessageRow = {
      id: input.id ?? randomUUID(),
      channel_id: input.channelId,
      message_id: input.messageId,
      member_id: input.memberId,
      order: input.order ?? 0,
      pinned_at: input.pinnedAt ?? new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO pinned_messages (id, channel_id, message_id, member_id, "order", pinned_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.channel_id, row.message_id, row.member_id, row.order, row.pinned_at);
    return row;
  }

  listPinnedMessages(channelId: string, memberId: string): PinnedMessageRow[] {
    return this.db
      .prepare(
        'SELECT * FROM pinned_messages WHERE channel_id = ? AND member_id = ? ORDER BY "order"',
      )
      .all(channelId, memberId) as PinnedMessageRow[];
  }

  getPinnedMessage(channelId: string, messageId: string, memberId: string): PinnedMessageRow | undefined {
    return this.db
      .prepare(
        "SELECT * FROM pinned_messages WHERE channel_id = ? AND message_id = ? AND member_id = ?",
      )
      .get(channelId, messageId, memberId) as PinnedMessageRow | undefined;
  }

  /** 解除 pin（§3.5 个性化 pinned）；返回是否真的删掉了。 */
  deletePinnedMessage(channelId: string, messageId: string, memberId: string): boolean {
    const result = this.db
      .prepare("DELETE FROM pinned_messages WHERE channel_id = ? AND message_id = ? AND member_id = ?")
      .run(channelId, messageId, memberId);
    return result.changes > 0;
  }

  /**
   * Manual 排序：按传入的 messageId 顺序重排 0..n-1。
   * 缺省（未列出的已 pin 行）按原 order 相对顺序排在被列出的行之后——不会产生重复 order。
   */
  setPinnedOrder(channelId: string, memberId: string, orderedMessageIds: string[]): void {
    const rows = this.listPinnedMessages(channelId, memberId);
    const pinnedIds = new Set(rows.map((row) => row.message_id));
    const listed = orderedMessageIds.filter((id) => pinnedIds.has(id));
    const rest = rows
      .filter((row) => !listed.includes(row.message_id))
      .sort((a, b) => a.order - b.order)
      .map((row) => row.message_id);
    const final = [...listed, ...rest];
    const update = this.db.prepare(
      'UPDATE pinned_messages SET "order" = ? WHERE channel_id = ? AND message_id = ? AND member_id = ?',
    );
    this.withTransaction(() => {
      final.forEach((messageId, index) => {
        update.run(index, channelId, messageId, memberId);
      });
    });
  }

  /** 某成员在指定 thread 锚点里的消息数（任务进展计数，§6.5）。 */
  countThreadMessagesByAuthor(anchorId: string, authorId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM messages WHERE target_id = ? AND author_id = ?")
      .get(anchorId, authorId) as { n: number };
    return row.n;
  }

  /** 某 target 的最新一条消息（agent-loop "已回复" 判定 / 双写流收口复用）。 */
  getLatestMessage(targetId: string): MessageRow | undefined {
    return this.db
      .prepare("SELECT * FROM messages WHERE target_id = ? ORDER BY seq DESC LIMIT 1")
      .get(targetId) as MessageRow | undefined;
  }

  /** 某成员的全部消息（可观测性时间线；按时间倒序，limit 收口）。 */
  listMessagesByAuthor(authorId: string, limit = 200): MessageRow[] {
    return this.db
      .prepare("SELECT * FROM messages WHERE author_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?")
      .all(authorId, limit) as MessageRow[];
  }

  /**
   * 某成员参与的任务（§6.5 任务历史，无需额外表）：
   * 认领过（owner）或创建了（锚点消息作者）或在其任务 thread 里发过进展的。
   */
  listTasksForAgent(agentId: string): TaskRow[] {
    return this.db
      .prepare(
        `SELECT DISTINCT tasks.* FROM tasks
         JOIN messages anchor ON anchor.id = tasks.message_id
         LEFT JOIN messages thread ON thread.target_id = tasks.message_id
         WHERE tasks.owner_id = ? OR anchor.author_id = ? OR thread.author_id = ?
         ORDER BY tasks.updated_at DESC`,
      )
      .all(agentId, agentId, agentId) as TaskRow[];
  }

  /** 同 target 同作者同内容是否已存在（崩溃恢复补拉去重：jsonl 回复 ↔ SQLite 双写比对）。 */
  hasMessage(targetId: string, authorId: string, content: string): boolean {
    const row = this.db
      .prepare(
        "SELECT 1 AS hit FROM messages WHERE target_id = ? AND author_id = ? AND content = ? LIMIT 1",
      )
      .get(targetId, authorId, content) as { hit: number } | undefined;
    return row !== undefined;
  }

  /** ticket 04：同 target 同内容是否已被**其他**作者落库（backfill 跨作者去重：
   * 继承文件的他人回复大多已由原 owner 投递且 soft-delete 保留，同内容同 target
   * 跨作者几乎必然是他人回复而非本 agent 的崩溃残留）。 */
  hasMessageByContentByOther(targetId: string, authorId: string, content: string): boolean {
    const row = this.db
      .prepare(
        "SELECT 1 AS hit FROM messages WHERE target_id = ? AND content = ? AND author_id != ? LIMIT 1",
      )
      .get(targetId, content, authorId) as { hit: number } | undefined;
    return row !== undefined;
  }

  getConsumedSeq(agentId: string, targetId: string): number {
    const row = this.db
      .prepare("SELECT seq FROM consumed_seqs WHERE agent_id = ? AND target_id = ?")
      .get(agentId, targetId) as { seq: number } | undefined;
    return row?.seq ?? 0;
  }

  setConsumedSeq(agentId: string, targetId: string, seq: number): void {
    this.db
      .prepare(
        `INSERT INTO consumed_seqs (agent_id, target_id, seq) VALUES (?, ?, ?)
         ON CONFLICT (agent_id, target_id) DO UPDATE SET seq = excluded.seq`,
      )
      .run(agentId, targetId, seq);
  }

  /** BAI-6 未读角标：成员在某频道的已读游标（read_seq = 已读到的最大 seq；0 = 从未打开）。 */
  getChannelReadSeq(memberId: string, channelId: string): number {
    const row = this.db
      .prepare("SELECT read_seq FROM channel_reads WHERE member_id = ? AND channel_id = ?")
      .get(memberId, channelId) as { read_seq: number } | undefined;
    return row?.read_seq ?? 0;
  }

  /** BAI-6 未读角标：推进（或初始化）成员在某频道的已读游标。 */
  setChannelReadSeq(memberId: string, channelId: string, seq: number): void {
    this.db
      .prepare(
        `INSERT INTO channel_reads (member_id, channel_id, read_seq, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (member_id, channel_id) DO UPDATE SET read_seq = excluded.read_seq, updated_at = excluded.updated_at`,
      )
      .run(memberId, channelId, seq, new Date().toISOString());
  }

  /** BAI-6 未读角标：频道内「作者非本人且 seq 高于已读游标」的消息数。 */
  countUnreadChannelMessages(memberId: string, channelId: string): number {
    const readSeq = this.getChannelReadSeq(memberId, channelId);
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM messages WHERE target_id = ? AND author_id != ? AND seq > ?",
      )
      .get(channelId, memberId, readSeq) as { n: number };
    return row?.n ?? 0;
  }

  /** §3.2 mute：记录静音时刻的 channel 版本 + 全局插入序（thread 消息按 rowid 判定）；已静音时幂等。 */
  setChannelMute(channelId: string, memberId: string, muteFromSeq: number, muteRowid: number): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO channel_mutes (channel_id, member_id, mute_from_seq, mute_rowid, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(channelId, memberId, muteFromSeq, muteRowid, new Date().toISOString());
  }

  /** 静音时刻的全局插入点 = 当时的 max(messages.rowid)（0 = 尚无任何消息）。 */
  maxMessageRowid(): number {
    const row = this.db.prepare("SELECT COALESCE(MAX(rowid), 0) AS n FROM messages").get() as {
      n: number;
    };
    return row.n;
  }

  /** 取消 mute（幂等）：返回是否真的删掉了。 */
  clearChannelMute(channelId: string, memberId: string): boolean {
    const result = this.db
      .prepare("DELETE FROM channel_mutes WHERE channel_id = ? AND member_id = ?")
      .run(channelId, memberId);
    return result.changes > 0;
  }

  getChannelMute(channelId: string, memberId: string): ChannelMuteRow | undefined {
    return this.db
      .prepare("SELECT * FROM channel_mutes WHERE channel_id = ? AND member_id = ?")
      .get(channelId, memberId) as ChannelMuteRow | undefined;
  }

  listChannelMutes(channelId: string): ChannelMuteRow[] {
    return this.db
      .prepare("SELECT * FROM channel_mutes WHERE channel_id = ? ORDER BY created_at, member_id")
      .all(channelId) as ChannelMuteRow[];
  }
}

declare global {
  var __workspliceDbOpenedVersion: number | undefined;
}

/** 打开即记录打开时的 schema 版本：getDb() 据此识别热重载后的旧原型实例。 */
export function openDataDb(dataDir?: string): RaftStore {
  const store = RaftStore.open(dataDir);
  globalThis.__workspliceDbOpenedVersion = SCHEMA_VERSION;
  return store;
}
