import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { ensureDataDir, resolveDataDir, type DataPaths } from "./dirs.ts";
import { runMigrations } from "./schema.ts";

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
  created_at: string;
}

export interface MessageRow {
  id: string;
  target_id: string;
  seq: number;
  author_id: string;
  content: string;
  created_at: string;
}

export interface TaskRow {
  id: string;
  message_id: string;
  number: number;
  status: TaskStatus;
  owner_id: string | null;
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

  listMembers(): MemberRow[] {
    return this.db
      .prepare("SELECT * FROM members ORDER BY created_at, id")
      .all() as MemberRow[];
  }

  getMember(id: string): MemberRow | undefined {
    return this.db.prepare("SELECT * FROM members WHERE id = ?").get(id) as
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
      created_at: input.createdAt ?? new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO members (id, type, name, description, role, workspace_path, pi_session_file, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

  searchMessages(query: string, limit = 20): SearchResult[] {
    const fts = toFtsQuery(query);
    if (!fts) return [];
    return this.db
      .prepare(
        `SELECT m.id, m.target_id, m.seq, m.author_id, m.created_at,
                snippet(messages_fts, 0, '<mark>', '</mark>', '…', 12) AS snippet
         FROM messages_fts
         JOIN messages m ON m.rowid = messages_fts.rowid
         WHERE messages_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(fts, limit) as SearchResult[];
  }

  insertTask(input: {
    id?: string;
    messageId: string;
    number: number;
    status?: TaskStatus;
    ownerId?: string | null;
    updatedAt?: string;
  }): TaskRow {
    const row: TaskRow = {
      id: input.id ?? randomUUID(),
      message_id: input.messageId,
      number: input.number,
      status: input.status ?? "todo",
      owner_id: input.ownerId ?? null,
      updated_at: input.updatedAt ?? new Date().toISOString(),
    };
    this.db
      .prepare(
        "INSERT INTO tasks (id, message_id, number, status, owner_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(row.id, row.message_id, row.number, row.status, row.owner_id, row.updated_at);
    return row;
  }

  listTasks(): TaskRow[] {
    return this.db.prepare("SELECT * FROM tasks ORDER BY number").all() as TaskRow[];
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
}

export function openDataDb(dataDir?: string): RaftStore {
  return RaftStore.open(dataDir);
}
