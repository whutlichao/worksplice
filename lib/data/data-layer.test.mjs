import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { openDataDb, toFtsQuery } = await import("./db.ts");
const { resolveDataDir } = await import("./dirs.ts");
const { runMigrations, BUILTIN_CHANNEL_ID, OWNER_MEMBER_ID, SCHEMA_VERSION } = await import(
  "./schema.ts"
);

const EXPECTED_TABLES = [
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
  members: [
    "id",
    "type",
    "name",
    "description",
    "role",
    "workspace_path",
    "pi_session_file",
    "status",
    "created_at",
  ],
  messages: ["id", "target_id", "seq", "author_id", "content", "created_at"],
  tasks: ["id", "message_id", "number", "status", "owner_id", "updated_at"],
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

test("toFtsQuery quotes tokens and drops empty input", () => {
  assert.equal(toFtsQuery(""), "");
  assert.equal(toFtsQuery("   "), "");
  assert.equal(toFtsQuery("hello world"), '"hello" AND "world"');
  assert.equal(toFtsQuery('say "hi"'), '"say" AND """hi"""');
});
