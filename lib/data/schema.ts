import type Database from "better-sqlite3";

export const SCHEMA_VERSION = 4;

export const BUILTIN_CHANNEL_ID = "#all";
export const OWNER_MEMBER_ID = "owner";

const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'public' CHECK (type IN ('public', 'private')),
    description TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS channel_members (
    channel_id TEXT NOT NULL REFERENCES channels(id),
    member_id TEXT NOT NULL REFERENCES members(id),
    joined_at TEXT NOT NULL,
    PRIMARY KEY (channel_id, member_id)
  )`,
  `CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('human', 'agent')),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
    workspace_path TEXT,
    pi_session_file TEXT,
    status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'working', 'error', 'offline')),
    deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    target_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    author_id TEXT NOT NULL REFERENCES members(id),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (target_id, seq)
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL UNIQUE REFERENCES messages(id),
    number INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'in_review', 'done', 'closed')),
    owner_id TEXT REFERENCES members(id),
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    fire_at TEXT NOT NULL,
    recurrence TEXT,
    target_id TEXT,
    author_id TEXT NOT NULL REFERENCES members(id),
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'fired', 'canceled')),
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS reminder_logs (
    id TEXT PRIMARY KEY,
    reminder_id TEXT NOT NULL REFERENCES reminders(id),
    event TEXT NOT NULL CHECK (event IN ('schedule', 'fire', 'reschedule', 'snooze', 'update', 'cancel', 'error')),
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS reactions (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id),
    member_id TEXT NOT NULL REFERENCES members(id),
    emoji TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (message_id, member_id, emoji)
  )`,
  `CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id),
    file_name TEXT NOT NULL,
    mime TEXT NOT NULL DEFAULT '',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    disk_path TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS pinned_messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(id),
    message_id TEXT NOT NULL REFERENCES messages(id),
    member_id TEXT NOT NULL REFERENCES members(id),
    "order" INTEGER NOT NULL DEFAULT 0,
    pinned_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS consumed_seqs (
    agent_id TEXT NOT NULL REFERENCES members(id),
    target_id TEXT NOT NULL,
    seq INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (agent_id, target_id)
  )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    content='messages',
    content_rowid='rowid'
  )`,
  `CREATE TRIGGER IF NOT EXISTS messages_no_update BEFORE UPDATE ON messages BEGIN
    SELECT RAISE(ABORT, 'messages are immutable');
  END`,
  `CREATE TRIGGER IF NOT EXISTS messages_no_delete BEFORE DELETE ON messages BEGIN
    SELECT RAISE(ABORT, 'messages are immutable');
  END`,
  `CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts (rowid, content) VALUES (new.rowid, new.content);
  END`,
  `CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF content ON messages BEGIN
    INSERT INTO messages_fts (messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    INSERT INTO messages_fts (rowid, content) VALUES (new.rowid, new.content);
  END`,
  `CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts (messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  END`,
];

export function runMigrations(db: Database.Database): void {
  db.transaction(() => {
    for (const statement of SCHEMA_STATEMENTS) {
      db.exec(statement);
    }
    migrateMembersDeletedColumn(db);
    seed(db);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  })();
}

/**
 * v3: members 增加 soft-delete 列（删除身份保留行，历史消息外键与渲染不变）。
 * 老库无此列时 ALTER 补上；新库 CREATE TABLE 已带该列。
 */
function migrateMembersDeletedColumn(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(members)").all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === "deleted")) {
    db.exec("ALTER TABLE members ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0");
  }
}

function seed(db: Database.Database): void {
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO channels (id, name, type, description, archived, created_at)
     VALUES (?, ?, 'public', '', 0, ?)`,
  ).run(BUILTIN_CHANNEL_ID, BUILTIN_CHANNEL_ID, createdAt);
  db.prepare(
    `INSERT OR IGNORE INTO members (id, type, name, description, role, status, created_at)
     VALUES (?, 'human', 'Owner', 'Worksplice owner', 'owner', 'online', ?)`,
  ).run(OWNER_MEMBER_ID, createdAt);
  // #all 全员自动加入（§3.2）：迁移时补齐既有成员，新成员由服务层在创建时加入。
  db.prepare(
    `INSERT OR IGNORE INTO channel_members (channel_id, member_id, joined_at)
     SELECT ?, id, ? FROM members`,
  ).run(BUILTIN_CHANNEL_ID, createdAt);
}
