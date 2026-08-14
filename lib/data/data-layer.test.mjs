import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { openDataDb } = await import("./sqlite.ts");
const { toFtsQuery } = await import("./types.ts");
const { resolveDataDir } = await import("./dirs.ts");
const { runMigrations, BUILTIN_CHANNEL_ID, OWNER_MEMBER_ID, SCHEMA_VERSION } = await import(
  "./schema.ts"
);
const betterSqlite3 = (await import("better-sqlite3")).default;

const EXPECTED_TABLES = [
  "channel_members",
  "channels",
  "members",
  "messages",
  "tasks",
  "reminders",
  "reactions",
  "attachments",
  "pinned_messages",
  "consumed_seqs",
  "messages_fts",
];

const EXPECTED_COLUMNS = {
  channels: ["id", "name", "type", "description", "archived", "created_at"],
  channel_members: ["channel_id", "member_id", "joined_at"],
  members: [
    "id",
    "type",
    "name",
    "description",
    "role",
    "workspace_path",
    "pi_session_file",
    "status",
    "deleted",
    "model_provider",
    "model_id",
    "thinking_level",
    "created_at",
  ],
  messages: ["id", "target_id", "seq", "author_id", "content", "created_at"],
  tasks: ["id", "message_id", "number", "status", "owner_id", "reopened", "updated_at"],
  reminders: [
    "id",
    "title",
    "fire_at",
    "recurrence",
    "target_id",
    "author_id",
    "status",
    "created_at",
  ],
  reactions: ["id", "message_id", "member_id", "emoji", "created_at"],
  attachments: ["id", "message_id", "file_name", "mime", "size_bytes", "disk_path", "created_at"],
  pinned_messages: ["id", "channel_id", "message_id", "member_id", "order", "pinned_at"],
  consumed_seqs: ["agent_id", "target_id", "seq"],
};

function createTempDataDir(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-data-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function tableNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);
}

test("migration creates the database from scratch and is idempotent on re-run", (t) => {
  const root = createTempDataDir(t);
  const dbFile = path.join(root, "raft.db");

  const store = openDataDb(root);
  assert.equal(fs.existsSync(dbFile), true);
  assert.equal(fs.existsSync(path.join(root, "attachments")), true);
  assert.ok(fs.statSync(path.join(root, "attachments")).isDirectory());

  const names = tableNames(store.db);
  for (const expected of EXPECTED_TABLES) {
    assert.ok(names.includes(expected), `table ${expected} missing`);
  }
  assert.equal(store.db.pragma("user_version", { simple: true }), SCHEMA_VERSION);

  const countsBefore = store.db.prepare("SELECT (SELECT COUNT(*) FROM channels) AS c, (SELECT COUNT(*) FROM members) AS m").get();
  runMigrations(store.db);
  runMigrations(store.db);
  const countsAfter = store.db.prepare("SELECT (SELECT COUNT(*) FROM channels) AS c, (SELECT COUNT(*) FROM members) AS m").get();
  assert.deepEqual(countsAfter, countsBefore);
  assert.deepEqual(tableNames(store.db), names);
  assert.equal(store.db.pragma("user_version", { simple: true }), SCHEMA_VERSION);
  store.close();
});

test("v2 database upgrades to v3 with the members.deleted column via ALTER TABLE", (t) => {
  const root = createTempDataDir(t);
  const db = new betterSqlite3(path.join(root, "legacy.db"));
  db.exec(`
    CREATE TABLE channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'public',
      description TEXT NOT NULL DEFAULT '',
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE channel_members (
      channel_id TEXT NOT NULL REFERENCES channels(id),
      member_id TEXT NOT NULL REFERENCES members(id),
      joined_at TEXT NOT NULL,
      PRIMARY KEY (channel_id, member_id)
    );
    CREATE TABLE members (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'member',
      workspace_path TEXT,
      pi_session_file TEXT,
      status TEXT NOT NULL DEFAULT 'offline',
      created_at TEXT NOT NULL
    );
    INSERT INTO members (id, type, name, role, status, created_at)
      VALUES ('legacy-agent', 'agent', 'legacy', 'member', 'offline', '2026-08-03T00:00:00.000Z');
  `);
  runMigrations(db);

  const columns = db.prepare("PRAGMA table_info(members)").all().map((c) => c.name);
  assert.ok(columns.includes("deleted"), "members.deleted missing after v3 migration");
  const legacy = db.prepare("SELECT deleted FROM members WHERE id = 'legacy-agent'").get();
  assert.equal(legacy.deleted, 0);
  db.close();
});

test("v3 database upgrades to v6 with per-agent model columns via ALTER TABLE", (t) => {
  const root = createTempDataDir(t);
  const db = new betterSqlite3(path.join(root, "legacy-v3.db"));
  // v3 形态的 members 表（含 deleted、无 model 列）
  db.exec(`
    CREATE TABLE members (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'member',
      workspace_path TEXT,
      pi_session_file TEXT,
      status TEXT NOT NULL DEFAULT 'offline',
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    INSERT INTO members (id, type, name, role, status, deleted, created_at)
      VALUES ('legacy-agent', 'agent', 'legacy', 'member', 'offline', 0, '2026-08-03T00:00:00.000Z');
  `);
  runMigrations(db);

  const columns = db.prepare("PRAGMA table_info(members)").all().map((c) => c.name);
  assert.ok(columns.includes("model_provider"), "members.model_provider missing after v6 migration");
  assert.ok(columns.includes("model_id"), "members.model_id missing after v6 migration");
  assert.ok(columns.includes("thinking_level"), "members.thinking_level missing after v6 migration");
  const legacy = db.prepare("SELECT model_provider, model_id, thinking_level FROM members WHERE id = 'legacy-agent'").get();
  assert.equal(legacy.model_provider, null);
  assert.equal(legacy.model_id, null);
  assert.equal(legacy.thinking_level, null);
  assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);
  db.close();
});

test("table definitions match spec section 6.2", (t) => {
  const store = openDataDb(createTempDataDir(t));
  for (const [table, expectedColumns] of Object.entries(EXPECTED_COLUMNS)) {
    const info = store.db.prepare(`PRAGMA table_info(${table})`).all();
    const columns = info.map((c) => c.name);
    assert.deepEqual(columns, expectedColumns, `columns of ${table}`);
  }

  const indexes = store.db.prepare("PRAGMA index_list(messages)").all();
  const uniqueIndexes = indexes.filter((i) => i.unique).map((i) => i.name);
  assert.ok(uniqueIndexes.includes("sqlite_autoindex_messages_1"), "UNIQUE(target_id, seq) missing");

  const reactionsIndexes = store.db.prepare("PRAGMA index_list(reactions)").all();
  assert.ok(
    reactionsIndexes.some((i) => i.unique && i.name === "sqlite_autoindex_reactions_1"),
    "UNIQUE(message_id, member_id, emoji) missing",
  );

  const consumedPk = store.db.prepare("PRAGMA table_info(consumed_seqs)").all();
  assert.deepEqual(
    consumedPk.filter((c) => c.pk).map((c) => c.name),
    ["agent_id", "target_id"],
    "PK(agent_id, target_id) missing",
  );

  const checks = store.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'channels'").get();
  assert.match(checks.sql, /CHECK \(type IN \('public', 'private'\)\)/);
  store.close();
});

test("data directory resolves from WORKSPLICE_DATA_DIR and defaults to ~/.worksplice", (t) => {
  const root = createTempDataDir(t);
  const customDir = path.join(root, "custom-data");
  process.env.WORKSPLICE_DATA_DIR = customDir;
  t.after(() => {
    delete process.env.WORKSPLICE_DATA_DIR;
  });

  assert.equal(resolveDataDir(), customDir);
  const store = openDataDb();
  assert.equal(store.paths.dbFile, path.join(customDir, "raft.db"));
  assert.equal(fs.existsSync(store.paths.dbFile), true);
  store.close();

  delete process.env.WORKSPLICE_DATA_DIR;
  assert.equal(resolveDataDir(), path.join(os.homedir(), ".worksplice"));
});

test("#all channel and owner member seed rows exist", (t) => {
  const store = openDataDb(createTempDataDir(t));

  const allChannel = store.getChannel(BUILTIN_CHANNEL_ID);
  assert.ok(allChannel, "#all channel missing");
  assert.equal(allChannel.type, "public");
  assert.equal(allChannel.archived, 0);

  const owner = store.getMember(OWNER_MEMBER_ID);
  assert.ok(owner, "owner member missing");
  assert.equal(owner.type, "human");
  assert.equal(owner.role, "owner");

  assert.equal(store.listChannels().length, 1);
  assert.equal(store.listMembers().length, 1);
  assert.ok(store.isChannelMember(BUILTIN_CHANNEL_ID, OWNER_MEMBER_ID), "owner not auto-joined to #all");
  store.close();
});

test("seed never re-adds soft-deleted members to #all (ghost-member regression)", (t) => {
  const store = openDataDb(createTempDataDir(t));

  const agent = store.insertMember({ type: "agent", name: "worker" });
  store.addChannelMember(BUILTIN_CHANNEL_ID, agent.id);
  // 删除 = soft-delete + 移出全部 channel（§3.6）
  store.setMemberDeleted(agent.id, 1);
  store.removeMemberFromAllChannels(agent.id);
  assert.equal(store.isChannelMember(BUILTIN_CHANNEL_ID, agent.id), false);

  // 模拟重启：每次打开都跑 runMigrations → seed；已删成员不得被补齐回 #all
  runMigrations(store.db);
  assert.equal(store.isChannelMember(BUILTIN_CHANNEL_ID, agent.id), false);
  assert.deepEqual(
    store.listChannelMembers(BUILTIN_CHANNEL_ID).map((m) => m.member_id),
    [OWNER_MEMBER_ID],
  );

  // 存量幽灵行（修复前 seed 已把已删成员加回）也要被清理
  store.addChannelMember(BUILTIN_CHANNEL_ID, agent.id);
  assert.equal(store.isChannelMember(BUILTIN_CHANNEL_ID, agent.id), true);
  runMigrations(store.db);
  assert.equal(store.isChannelMember(BUILTIN_CHANNEL_ID, agent.id), false);

  store.close();
});

test("channel membership add/remove/list and #all re-join on migration are wired", (t) => {
  const store = openDataDb(createTempDataDir(t));

  const agent = store.insertMember({ type: "agent", name: "worker" });
  assert.equal(store.isChannelMember(BUILTIN_CHANNEL_ID, agent.id), false);

  store.addChannelMember(BUILTIN_CHANNEL_ID, agent.id);
  assert.equal(store.isChannelMember(BUILTIN_CHANNEL_ID, agent.id), true);
  assert.deepEqual(
    store.listChannelMembers(BUILTIN_CHANNEL_ID).map((m) => m.member_id).sort(),
    [OWNER_MEMBER_ID, agent.id].sort(),
  );

  store.removeChannelMember(BUILTIN_CHANNEL_ID, agent.id);
  assert.equal(store.isChannelMember(BUILTIN_CHANNEL_ID, agent.id), false);

  assert.throws(
    () => store.addChannelMember("no-such-channel", agent.id),
    /FOREIGN KEY constraint failed/,
  );
  store.close();
});

test("message list supports seq cursor pagination from the latest page", (t) => {
  const store = openDataDb(createTempDataDir(t));
  const target = BUILTIN_CHANNEL_ID;
  for (let i = 1; i <= 7; i++) {
    store.insertMessageAt({ targetId: target, seq: i, authorId: OWNER_MEMBER_ID, content: `msg ${i}` });
  }

  const latest = store.listMessagesBefore(target, undefined, 3);
  assert.deepEqual(
    latest.map((m) => m.seq),
    [7, 6, 5],
    "latest page must return highest seqs in DESC order",
  );
  assert.equal(store.hasMessagesBefore(target, 5), true);
  assert.equal(store.hasMessagesBefore(target, 1), false);

  const older = store.listMessagesBefore(target, 5, 3);
  assert.deepEqual(
    older.map((m) => m.seq),
    [4, 3, 2],
  );
  assert.deepEqual(store.listMessagesBefore(target, 2, 10).map((m) => m.seq), [1]);
  assert.deepEqual(store.listMessagesBefore(target, 1, 10), []);
  store.close();
});

test("channel archive/unarchive is persisted", (t) => {
  const store = openDataDb(createTempDataDir(t));
  const channel = store.insertChannel({ name: "general" });
  assert.equal(store.getChannel(channel.id).archived, 0);

  store.setChannelArchived(channel.id, 1);
  assert.equal(store.getChannel(channel.id).archived, 1);
  store.setChannelArchived(channel.id, 0);
  assert.equal(store.getChannel(channel.id).archived, 0);
  store.close();
});

test("UNIQUE(target_id, seq) rejects duplicate seq and messages are immutable", (t) => {
  const store = openDataDb(createTempDataDir(t));
  const target = BUILTIN_CHANNEL_ID;

  const first = store.insertMessageAt({
    targetId: target,
    seq: 1,
    authorId: OWNER_MEMBER_ID,
    content: "first",
  });

  assert.throws(
    () =>
      store.insertMessageAt({
        targetId: target,
        seq: 1,
        authorId: OWNER_MEMBER_ID,
        content: "duplicate seq",
      }),
    /UNIQUE constraint failed/,
  );

  assert.throws(
    () =>
      store.db
        .prepare("UPDATE messages SET content = ? WHERE id = ?")
        .run("edited", first.id),
    /immutable/,
  );

  assert.throws(() => store.db.prepare("DELETE FROM messages WHERE id = ?").run(first.id), /immutable/);

  const after = store.listMessages(target);
  assert.equal(after.length, 1);
  assert.equal(after[0].content, "first");
  store.close();
});

test("FTS5 index stays in sync with message content", (t) => {
  const store = openDataDb(createTempDataDir(t));
  const target = BUILTIN_CHANNEL_ID;

  const ping = store.appendMessage({
    targetId: target,
    authorId: OWNER_MEMBER_ID,
    content: "the ping pong ball bounces",
  });
  store.appendMessage({
    targetId: target,
    authorId: OWNER_MEMBER_ID,
    content: "the pong table is green",
  });

  let results = store.searchMessages("ping");
  assert.equal(results.length, 1);
  assert.equal(results[0].id, ping.id);
  assert.match(results[0].snippet, /ping/);

  results = store.searchMessages("pong");
  assert.equal(results.length, 2);

  assert.equal(store.searchMessages("zzz-nope").length, 0);

  assert.throws(() => store.db.prepare("UPDATE messages SET content = ? WHERE id = ?").run("x", ping.id));
  results = store.searchMessages("ping");
  assert.equal(results.length, 1);
  assert.match(results[0].snippet, /ping/);

  const triggers = store.db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'messages_fts_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
  assert.deepEqual(triggers, ["messages_fts_delete", "messages_fts_insert", "messages_fts_update"]);
  store.close();
});

test("freshness primitive and transaction wrapper are available", (t) => {
  const store = openDataDb(createTempDataDir(t));
  const target = BUILTIN_CHANNEL_ID;
  const agentId = store.insertMember({ type: "agent", name: "worker" }).id;

  assert.equal(store.maxSeq(target), 0);

  const seq = store.withTransaction(() => {
    store.appendMessage({ targetId: target, authorId: OWNER_MEMBER_ID, content: "one" });
    store.appendMessage({ targetId: target, authorId: OWNER_MEMBER_ID, content: "two" });
    return store.maxSeq(target) + 1;
  });

  assert.equal(seq, 3);
  assert.deepEqual(
    store.listMessages(target).map((m) => m.seq),
    [1, 2],
  );

  store.setConsumedSeq(agentId, target, 2);
  assert.equal(store.getConsumedSeq(agentId, target), 2);
  store.setConsumedSeq(agentId, target, 3);
  assert.equal(store.getConsumedSeq(agentId, target), 3);
  assert.equal(store.getConsumedSeq(agentId, "other-target"), 0);

  assert.throws(
    () => {
      store.withTransaction(() => {
        store.appendMessage({ targetId: target, authorId: OWNER_MEMBER_ID, content: "rolled back" });
        throw new Error("boom");
      });
    },
    /boom/,
  );
  assert.equal(store.maxSeq(target), 2);
  store.close();
});

test("basic read/write wrappers cover the other tables", (t) => {
  const store = openDataDb(createTempDataDir(t));
  const channel = store.insertChannel({ name: "general" });
  const agent = store.insertMember({ type: "agent", name: "builder", workspacePath: "/tmp/w" });
  const message = store.appendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "task message",
  });

  const task = store.insertTask({ messageId: message.id, number: 1, ownerId: agent.id });
  assert.equal(store.listTasks().length, 1);
  assert.equal(task.status, "todo");

  const reminder = store.insertReminder({
    title: "standup",
    fireAt: "2026-08-03T09:00:00.000Z",
    authorId: OWNER_MEMBER_ID,
  });
  assert.equal(store.listReminders()[0].id, reminder.id);

  const reaction = store.insertReaction({ messageId: message.id, memberId: OWNER_MEMBER_ID, emoji: "+1" });
  assert.equal(store.listReactions(message.id)[0].id, reaction.id);

  const attachment = store.insertAttachment({
    messageId: message.id,
    fileName: "note.txt",
    diskPath: "/tmp/attachments/note.txt",
  });
  assert.equal(store.listAttachments(message.id)[0].id, attachment.id);

  const pin = store.insertPinnedMessage({
    channelId: channel.id,
    messageId: message.id,
    memberId: OWNER_MEMBER_ID,
    order: 1,
  });
  assert.equal(store.listPinnedMessages(channel.id, OWNER_MEMBER_ID)[0].id, pin.id);

  store.updateMemberStatus(agent.id, "working");
  store.setMemberWorkspace(agent.id, "/tmp/w2", "/tmp/pi/session.jsonl");
  const updated = store.getMember(agent.id);
  assert.equal(updated.status, "working");
  assert.equal(updated.workspace_path, "/tmp/w2");
  assert.equal(updated.pi_session_file, "/tmp/pi/session.jsonl");
  store.close();
});

test("reaction toggle primitives: has/delete honor UNIQUE(message_id, member_id, emoji)", (t) => {
  const store = openDataDb(createTempDataDir(t));
  const channel = store.insertChannel({ name: "reactions" });
  const message = store.appendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "hi" });

  assert.equal(store.hasReaction(message.id, OWNER_MEMBER_ID, "👍"), false);
  store.insertReaction({ messageId: message.id, memberId: OWNER_MEMBER_ID, emoji: "👍" });
  assert.equal(store.hasReaction(message.id, OWNER_MEMBER_ID, "👍"), true);

  assert.equal(store.deleteReaction(message.id, OWNER_MEMBER_ID, "👍"), true);
  assert.equal(store.deleteReaction(message.id, OWNER_MEMBER_ID, "👍"), false);
  assert.equal(store.hasReaction(message.id, OWNER_MEMBER_ID, "👍"), false);

  assert.throws(() => {
    store.insertReaction({ messageId: message.id, memberId: OWNER_MEMBER_ID, emoji: "👍" });
    store.insertReaction({ messageId: message.id, memberId: OWNER_MEMBER_ID, emoji: "👍" });
  }, /UNIQUE/);
  store.close();
});

test("pinned primitives: get/delete/setPinnedOrder", (t) => {
  const store = openDataDb(createTempDataDir(t));
  const channel = store.insertChannel({ name: "pinned" });
  const m1 = store.appendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "one" });
  const m2 = store.appendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "two" });
  const m3 = store.appendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "three" });

  const pin = store.insertPinnedMessage({
    channelId: channel.id,
    messageId: m1.id,
    memberId: OWNER_MEMBER_ID,
    order: 0,
  });
  store.insertPinnedMessage({ channelId: channel.id, messageId: m2.id, memberId: OWNER_MEMBER_ID, order: 1 });
  store.insertPinnedMessage({ channelId: channel.id, messageId: m3.id, memberId: OWNER_MEMBER_ID, order: 2 });

  assert.equal(store.getPinnedMessage(channel.id, m1.id, OWNER_MEMBER_ID)?.id, pin.id);
  assert.equal(store.getPinnedMessage(channel.id, m2.id, "nobody"), undefined);

  store.setPinnedOrder(channel.id, OWNER_MEMBER_ID, [m3.id, m1.id, m2.id]);
  const ordered = store.listPinnedMessages(channel.id, OWNER_MEMBER_ID).map((p) => p.message_id);
  assert.deepEqual(ordered, [m3.id, m1.id, m2.id]);

  // 部分重排：未列出的行按原序排在后面，不产生重复 order
  store.setPinnedOrder(channel.id, OWNER_MEMBER_ID, [m2.id]);
  const partial = store.listPinnedMessages(channel.id, OWNER_MEMBER_ID);
  assert.deepEqual(
    partial.map((p) => p.message_id),
    [m2.id, m3.id, m1.id],
  );
  assert.deepEqual(
    partial.map((p) => p.order),
    [0, 1, 2],
  );
  // 列入了未 pin 的 id：被忽略，不影响重排
  store.setPinnedOrder(channel.id, OWNER_MEMBER_ID, ["not-pinned", m3.id]);
  assert.deepEqual(
    store.listPinnedMessages(channel.id, OWNER_MEMBER_ID).map((p) => p.message_id),
    [m3.id, m2.id, m1.id],
  );

  assert.equal(store.deletePinnedMessage(channel.id, m1.id, OWNER_MEMBER_ID), true);
  assert.equal(store.deletePinnedMessage(channel.id, m1.id, OWNER_MEMBER_ID), false);
  assert.equal(store.getPinnedMessage(channel.id, m1.id, OWNER_MEMBER_ID), undefined);
  store.close();
});

test("attachment lookup by id (download route)", (t) => {
  const store = openDataDb(createTempDataDir(t));
  const channel = store.insertChannel({ name: "att" });
  const message = store.appendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "file" });
  const attachment = store.insertAttachment({
    messageId: message.id,
    fileName: "a.txt",
    mime: "text/plain",
    sizeBytes: 3,
    diskPath: "/tmp/attachments/a.txt",
  });
  assert.equal(store.getAttachment(attachment.id)?.file_name, "a.txt");
  assert.equal(store.getAttachment("missing"), undefined);
  store.close();
});

test("v4 database upgrades to v5: messages_fts switches to trigram and backfills CJK", (t) => {
  const root = createTempDataDir(t);
  const db = new betterSqlite3(path.join(root, "legacy.db"));
  // v4 形态：unicode61 fts + 挂 messages 的同步触发器 + 已有消息
  db.exec(`
    CREATE TABLE members (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'member',
      workspace_path TEXT,
      pi_session_file TEXT,
      status TEXT NOT NULL DEFAULT 'offline',
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      author_id TEXT NOT NULL REFERENCES members(id),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (target_id, seq)
    );
    INSERT INTO members (id, type, name, role, status, created_at)
      VALUES ('legacy', 'human', 'legacy', 'owner', 'online', '2026-08-03T00:00:00.000Z');
    INSERT INTO messages (id, target_id, seq, author_id, content, created_at)
      VALUES ('m1', 't1', 1, 'legacy', '今天讨论了全文搜索方案', '2026-08-03T00:00:00.000Z');
    CREATE VIRTUAL TABLE messages_fts USING fts5(content, content='messages', content_rowid='rowid');
    INSERT INTO messages_fts (rowid, content) SELECT rowid, content FROM messages;
    CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts (rowid, content) VALUES (new.rowid, new.content);
    END;
  `);
  runMigrations(db);

  // 旧 unicode61 索引把连续 CJK 当单 token，子串搜不到；迁移后 trigram 命中
  const hits = db
    .prepare(
      `SELECT COUNT(*) AS c FROM messages_fts
       JOIN messages m ON m.rowid = messages_fts.rowid
       WHERE messages_fts MATCH '"全文搜索"'`,
    )
    .get();
  assert.equal(hits.c, 1);

  // 触发器重建后新消息仍即时入索引
  db.prepare(
    "INSERT INTO messages (id, target_id, seq, author_id, content, created_at) VALUES (?, 't1', 2, 'legacy', ?, ?)",
  ).run("m2", "迁移后的新消息 also-migrated", "2026-08-03T00:00:01.000Z");
  const fresh = db
    .prepare(
      `SELECT COUNT(*) AS c FROM messages_fts
       JOIN messages m ON m.rowid = messages_fts.rowid
       WHERE messages_fts MATCH '"also-migrated"'`,
    )
    .get();
  assert.equal(fresh.c, 1);
  db.close();
});

test("toFtsQuery quotes tokens and drops empty input", () => {
  assert.equal(toFtsQuery(""), "");
  assert.equal(toFtsQuery("   "), "");
  assert.equal(toFtsQuery("hello world"), '"hello" AND "world"');
  assert.equal(toFtsQuery('say "hi"'), '"say" AND """hi"""');
});
