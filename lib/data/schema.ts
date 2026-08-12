import type Database from "better-sqlite3";

export const SCHEMA_VERSION = 10;

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
    model_provider TEXT,
    model_id TEXT,
    thinking_level TEXT,
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
    reopened INTEGER NOT NULL DEFAULT 0,
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
  // §07 轮次结果落盘（可观测性）：每次 agent-loop 有结论的轮次一行
  // （replied/ignored/silent/anyway/yielded/error/busy-cwd；noop/skipped/busy 瞬态不记）。
  // 区分「自判 ignore」与「处理失败」的事实来源；ring cap 由服务层维护（每 agent 保留最近 200 轮）。
  `CREATE TABLE IF NOT EXISTS round_logs (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES members(id),
    target_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('replied', 'ignored', 'silent', 'anyway', 'yielded', 'error', 'busy-cwd')),
    reason TEXT NOT NULL DEFAULT '',
    base_seq INTEGER NOT NULL DEFAULT 0,
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
  // §3.2/§3.8 channel 级 mute：静音后普通消息不进 inbox，个人 @mention 仍穿透，取消 mute 恢复。
  // mute_from_seq = 静音时刻的 channel max(seq)（channel 消息按 seq 比）；
  // mute_rowid = 静音时刻全表 max(messages.rowid)（thread 消息无 channel seq，按全局插入序判定"静音后"）。
  `CREATE TABLE IF NOT EXISTS channel_mutes (
    channel_id TEXT NOT NULL REFERENCES channels(id),
    member_id TEXT NOT NULL REFERENCES members(id),
    mute_from_seq INTEGER NOT NULL DEFAULT 0,
    mute_rowid INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (channel_id, member_id)
  )`,
  // §6.4 全文搜索：trigram tokenizer —— unicode61 把连续 CJK 当作单 token，中文子串搜不到；
  // trigram 按 3-gram 索引，中英文子串均可命中（查询 token <3 字符时由 searchMessages 走 LIKE 兜底）。
  `CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    content='messages',
    content_rowid='rowid',
    tokenize='trigram'
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

/**
 * v5：messages_fts 换用 trigram tokenizer（§6.4）。
 * 老库（v4 及更早）的 unicode61 把连续 CJK 当作单 token，中文关键词无法命中；
 * 检测 sqlite_master 中的建表 sql 是否含 trigram，缺则 drop 重建 + 回填。
 * 消息不可变（无 UPDATE/DELETE），回填确定；fts 触发器挂在 messages 表上，
 * 先显式 DROP TRIGGER 再 DROP TABLE，由 SCHEMA_STATEMENTS 循环的
 * CREATE TRIGGER IF NOT EXISTS 重建。
 */
function migrateMessagesFtsTrigram(db: Database.Database): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'messages_fts'")
    .get() as { sql: string } | undefined;
  if (!row) return;
  if (row.sql.includes("trigram")) return;
  // 触发器挂在 messages 表上、引用 messages_fts —— DROP TABLE 不会连带删掉，先显式清理再重建。
  db.exec("DROP TRIGGER IF EXISTS messages_fts_insert");
  db.exec("DROP TRIGGER IF EXISTS messages_fts_update");
  db.exec("DROP TRIGGER IF EXISTS messages_fts_delete");
  db.exec("DROP TABLE messages_fts");
  db.exec(
    `CREATE VIRTUAL TABLE messages_fts USING fts5(
      content,
      content='messages',
      content_rowid='rowid',
      tokenize='trigram'
    )`,
  );
  db.exec("INSERT INTO messages_fts (rowid, content) SELECT rowid, content FROM messages");
}

export function runMigrations(db: Database.Database): void {
  db.transaction(() => {
    migrateMessagesFtsTrigram(db);
    for (const statement of SCHEMA_STATEMENTS) {
      db.exec(statement);
    }
    migrateMembersDeletedColumn(db);
    migrateMembersModelColumns(db);
    migrateTasksReopenedColumn(db);
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

/**
 * v6: members 增加 per-agent 模型列（§3.10 runtime 区：覆盖全局默认）。
 * 老库无此列时 ALTER 补上；新库 CREATE TABLE 已带该列。
 */
function migrateMembersModelColumns(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(members)").all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === "model_provider")) {
    db.exec("ALTER TABLE members ADD COLUMN model_provider TEXT");
  }
  if (!columns.some((c) => c.name === "model_id")) {
    db.exec("ALTER TABLE members ADD COLUMN model_id TEXT");
  }
  if (!columns.some((c) => c.name === "thinking_level")) {
    db.exec("ALTER TABLE members ADD COLUMN thinking_level TEXT");
  }
}

/**
 * v8: tasks 增加 reopened 列（§3.7 重开封锁）：reopen 转移置 1，人类认领清 0；
 * agent-loop 对 reopened 任务不可自动认领。老库无此列时 ALTER 补上；新库 CREATE TABLE 已带该列。
 * 存量任务一律视为未重开（无历史可追溯，向前生效）。
 */
function migrateTasksReopenedColumn(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === "reopened")) {
    db.exec("ALTER TABLE tasks ADD COLUMN reopened INTEGER NOT NULL DEFAULT 0");
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
  // 软删成员（deleted=1）绝不补齐：seed 每次打开都会执行，删除时虽已移出全部 channel
  // （§3.6），若不在此过滤会把已删除的 agent 重新加回 #all（幽灵成员，成员数虚高）。
  db.prepare(
    `DELETE FROM channel_members WHERE member_id IN (SELECT id FROM members WHERE deleted = 1)`,
  ).run();
  db.prepare(
    `INSERT OR IGNORE INTO channel_members (channel_id, member_id, joined_at)
     SELECT ?, id, ? FROM members WHERE deleted = 0`,
  ).run(BUILTIN_CHANNEL_ID, createdAt);
}
