import type Database from "better-sqlite3";

export const SCHEMA_VERSION = 12;

export const BUILTIN_CHANNEL_ID = "#all";
export const OWNER_MEMBER_ID = "owner";

/** DM 频道 id 前缀（§R7 命名固定 `dm:owner↔<agent名>`，确定性 id 天然幂等）。 */
export const DM_ID_PREFIX = "dm:owner↔";

const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'public' CHECK (type IN ('public', 'private', 'dm')),
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
  // §BAI-6 未读角标：Owner 对每个频道的已读游标（read_seq = 该成员在频道内已读到的最大 seq）。
  // 未读数 = 频道内 author 非本人且 seq > read_seq 的消息数；打开频道即推进到当前 max(seq)。
  `CREATE TABLE IF NOT EXISTS channel_reads (
    member_id TEXT NOT NULL REFERENCES members(id),
    channel_id TEXT NOT NULL REFERENCES channels(id),
    read_seq INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (member_id, channel_id)
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
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'messages_fts'",
    )
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
  db.exec(
    "INSERT INTO messages_fts (rowid, content) SELECT rowid, content FROM messages",
  );
}

export function runMigrations(db: Database.Database): void {
  // v12 CHECK 改写必须先于任何 type='dm' 写入执行（老库 CHECK 无 'dm'，INSERT type='dm' 会违反约束）——
  // 懒创建下 DM 由 createDirectChannel 在运行时写入，seed 不再补建；且该重建需 PRAGMA
  // foreign_keys 开关（事务内 no-op），故放在事务外。
  migrateChannelsDmType(db);
  db.transaction(() => {
    migrateMessagesFtsTrigram(db);
    for (const statement of SCHEMA_STATEMENTS) {
      db.exec(statement);
    }
    migrateMembersDeletedColumn(db);
    migrateMembersModelColumns(db);
    migrateTasksReopenedColumn(db);
    seed(db);
    cleanupEmptyDms(db);
    resumeDirectChannels(db);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  })();
}

/**
 * v3: members 增加 soft-delete 列（删除身份保留行，历史消息外键与渲染不变）。
 * 老库无此列时 ALTER 补上；新库 CREATE TABLE 已带该列。
 */
function migrateMembersDeletedColumn(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(members)").all() as Array<{
    name: string;
  }>;
  if (!columns.some((c) => c.name === "deleted")) {
    db.exec(
      "ALTER TABLE members ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0",
    );
  }
}

/**
 * v6: members 增加 per-agent 模型列（§3.10 runtime 区：覆盖全局默认）。
 * 老库无此列时 ALTER 补上；新库 CREATE TABLE 已带该列。
 */
function migrateMembersModelColumns(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(members)").all() as Array<{
    name: string;
  }>;
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
  const columns = db.prepare("PRAGMA table_info(tasks)").all() as Array<{
    name: string;
  }>;
  if (!columns.some((c) => c.name === "reopened")) {
    db.exec("ALTER TABLE tasks ADD COLUMN reopened INTEGER NOT NULL DEFAULT 0");
  }
}

/**
 * v12: channels.type CHECK 扩展 'dm'（私信，一对一 owner↔agent 频道）。
 * SQLite 无法用 ALTER 改 CHECK，故用 expand-contract 重建表：
 * foreign_keys 关闭（重建中目标表瞬时缺失）+ legacy_alter_table 开启（RENAME 时不改写
 * channel_members/pinned_messages/channel_mutes/channel_reads 里指向 channels 的外键，
 * 否则重命名后引用会随表名漂到 channels_old，DROP 后悬空）→ RENAME → 建新表 → 拷贝 → DROP。
 * 幂等：检测 sqlite_master 建表 sql 已含 'dm' 即跳过（可重跑）。
 */
function migrateChannelsDmType(db: Database.Database): void {
  const row = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'channels'",
    )
    .get() as { sql: string } | undefined;
  if (!row) return; // 全新库：channels 尚不存在，由 SCHEMA_STATEMENTS 以新 CHECK 创建
  if (row.sql.includes("'dm'")) return;

  db.pragma("foreign_keys = OFF");
  db.pragma("legacy_alter_table = ON");
  try {
    db.transaction(() => {
      db.exec("ALTER TABLE channels RENAME TO channels_old");
      db.exec(`CREATE TABLE channels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'public' CHECK (type IN ('public', 'private', 'dm')),
        description TEXT NOT NULL DEFAULT '',
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`);
      db.exec(
        "INSERT INTO channels (id, name, type, description, archived, created_at) SELECT id, name, type, description, archived, created_at FROM channels_old",
      );
      db.exec("DROP TABLE channels_old");
    })();
  } finally {
    db.pragma("legacy_alter_table = OFF");
    db.pragma("foreign_keys = ON");
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
  // 懒创建（dm-lazy-create）：不再 seed 补齐 DM——DM 只在 owner 打开「发送消息」入口时
  // 由 createDirectChannel 幂等创建；存量空 DM 由 cleanupEmptyDms 每开库回收。
}

/**
 * 懒创建清理（dm-lazy-create）：每次开库幂等删除全部空 DM——type='dm' 且无任何顶层消息的频道，
 * 连同引用该频道的关联行（channel_members / channel_mutes / channel_reads / pinned_messages）一并回收
 * （顺带清掉「点开未发」的空 DM）。空判定 = 无 target_id = dm.id 的顶层消息（DM 首条消息必为顶层，
 * 故「无顶层消息」⟺「无消息」）。有消息的 DM 保留；无 schema 形状变更，不 bump SCHEMA_VERSION。
 * 先删引用行再删频道行（各引用表 → channels 的外键约束）。
 */
function cleanupEmptyDms(db: Database.Database): void {
  // 四张引用表显式逐条写死（不拼表名），避免动态 SQL 注入风险；先删引用行再删频道行。
  db.exec(
    `DELETE FROM channel_members
     WHERE channel_id IN (
       SELECT id FROM channels WHERE type = 'dm' AND id NOT IN (SELECT DISTINCT target_id FROM messages)
     )`,
  );
  db.exec(
    `DELETE FROM channel_mutes
     WHERE channel_id IN (
       SELECT id FROM channels WHERE type = 'dm' AND id NOT IN (SELECT DISTINCT target_id FROM messages)
     )`,
  );
  db.exec(
    `DELETE FROM channel_reads
     WHERE channel_id IN (
       SELECT id FROM channels WHERE type = 'dm' AND id NOT IN (SELECT DISTINCT target_id FROM messages)
     )`,
  );
  db.exec(
    `DELETE FROM pinned_messages
     WHERE channel_id IN (
       SELECT id FROM channels WHERE type = 'dm' AND id NOT IN (SELECT DISTINCT target_id FROM messages)
     )`,
  );
  db.exec(
    `DELETE FROM channels WHERE type = 'dm' AND id NOT IN (SELECT DISTINCT target_id FROM messages)`,
  );
}

/**
 * 重建同名 agent 后接续同名 DM（§R7 重建路径的开库期形态）：删除身份会归档其 DM 并移出成员
 * （`deleteAgent`），而 DM id 由名字确定性派生——同名重建（新 member id）命中的是同一条 DM。
 * 运行期的重建由 `createAgent` 接续（`channels.ts` 的 `resumeDirectChannel`）；**存量**坏行
 * （接续路径落地前就已存在、没有任何 createAgent 调用会再去碰它们）在这里一次开库治理完，
 * 用户不需要再删一次重建一次。
 *
 * 与服务层那条同形：同一派生 DM id（`DM_ID_PREFIX || name`）、同一修复谓词（存活 agent +
 * 同名 DM 处于非预期态：归档 / 缺 owner / 缺该 agent）、同一组三条写入与同一顺序
 * （游标 → 成员 → 解档）。数据层不得 import 协作域（依赖方向：业务依赖数据契约，反之不成立），
 * 故此处直接写 SQL，由两侧的「接续后预期态」测试钉住同形。
 * 幂等可重跑：只取非预期态的行（预期态一行不写）；游标只对「DM 成员缺失」的 agent 推送
 * （那才是重建出来的新身份，旧对话不重放）——已在成员里的身份保留自己的未读游标。
 * 无 schema 形状变更，不 bump SCHEMA_VERSION。
 */
function resumeDirectChannels(db: Database.Database): void {
  const rows = db
    .prepare(
      `SELECT c.id AS dm_id, m.id AS agent_id,
              EXISTS (SELECT 1 FROM channel_members cm
                      WHERE cm.channel_id = c.id AND cm.member_id = m.id) AS agent_joined
       FROM members m
       JOIN channels c ON c.type = 'dm' AND c.id = ? || m.name
       WHERE m.type = 'agent' AND m.deleted = 0
         AND (c.archived <> 0
              OR NOT EXISTS (SELECT 1 FROM channel_members cm
                             WHERE cm.channel_id = c.id AND cm.member_id = ?)
              OR NOT EXISTS (SELECT 1 FROM channel_members cm
                             WHERE cm.channel_id = c.id AND cm.member_id = m.id))`,
    )
    .all(DM_ID_PREFIX, OWNER_MEMBER_ID) as Array<{
    dm_id: string;
    agent_id: string;
    agent_joined: number;
  }>;
  if (rows.length === 0) return;
  const pushCursor = db.prepare(
    `INSERT INTO consumed_seqs (agent_id, target_id, seq)
     VALUES (?, ?, (SELECT COALESCE(MAX(seq), 0) FROM messages WHERE target_id = ?))
     ON CONFLICT (agent_id, target_id) DO UPDATE SET seq = excluded.seq`,
  );
  const addMember = db.prepare(
    `INSERT OR IGNORE INTO channel_members (channel_id, member_id, joined_at) VALUES (?, ?, ?)`,
  );
  const unarchive = db.prepare(`UPDATE channels SET archived = 0 WHERE id = ?`);
  const joinedAt = new Date().toISOString();
  for (const row of rows) {
    if (!row.agent_joined) {
      pushCursor.run(row.agent_id, row.dm_id, row.dm_id);
    }
    addMember.run(row.dm_id, OWNER_MEMBER_ID, joinedAt);
    addMember.run(row.dm_id, row.agent_id, joinedAt);
    unarchive.run(row.dm_id);
  }
}
