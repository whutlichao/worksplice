import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "./sqlite.ts";
import { OWNER_MEMBER_ID, runMigrations, SCHEMA_VERSION } from "./schema.ts";

/**
 * 票 #240 的持久形状：tasks.handoff_state / tasks.handoff_seq。
 * 接缝 = 真实临时 SQLite + Store 契约 + runMigrations（不碰真实数据目录）。
 */

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-handoff-schema-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function taskColumns(store) {
  return store.db
    .prepare("PRAGMA table_info(tasks)")
    .all()
    .map((column) => column.name);
}

test("fresh database is v18 and carries handoff_state / handoff_seq / handoff_owner_id", (t) => {
  const store = openDataDb(tempRoot(t));
  try {
    assert.equal(SCHEMA_VERSION, 18);
    assert.equal(store.db.pragma("user_version", { simple: true }), 18);
    assert.ok(taskColumns(store).includes("handoff_state"));
    assert.ok(taskColumns(store).includes("handoff_seq"));
    assert.ok(taskColumns(store).includes("handoff_owner_id"));
  } finally {
    store.close();
  }
});

test("v16 database upgrades forward: handoff columns are added, legacy task rows keep their data", (t) => {
  const store = openDataDb(tempRoot(t));
  try {
    store.insertMember({ type: "agent", name: "legacy-v16-agent" });
    const channel = store.insertChannel({ name: "legacy-v16" });
    const message = store.appendMessage({
      targetId: channel.id,
      authorId: OWNER_MEMBER_ID,
      content: "legacy task anchor",
    });
    const task = store.insertTask({ messageId: message.id, number: 1 });

    // 精确回到 v16 形状：删掉 v17 才有的两列，并保留历史任务行。
    store.db.exec("ALTER TABLE tasks DROP COLUMN handoff_seq");
    store.db.exec("ALTER TABLE tasks DROP COLUMN handoff_state");
    store.db.exec("ALTER TABLE tasks DROP COLUMN handoff_owner_id");
    store.db.pragma("user_version = 16");

    runMigrations(store.db);

    assert.ok(taskColumns(store).includes("handoff_state"));
    assert.ok(taskColumns(store).includes("handoff_seq"));
    assert.ok(taskColumns(store).includes("handoff_owner_id"));
    assert.equal(store.db.pragma("user_version", { simple: true }), 18);
    const legacy = store.getTaskById(task.id);
    assert.equal(legacy.status, "todo");
    assert.equal(legacy.owner_id, null);
    assert.equal(legacy.reopened, 0);
    assert.equal(legacy.handoff_state, null);
    assert.equal(legacy.handoff_seq, null);
    assert.equal(legacy.handoff_owner_id, null);

    // 幂等：重复迁移不改变列集合与行。
    const columnsBefore = taskColumns(store);
    runMigrations(store.db);
    assert.deepEqual(taskColumns(store), columnsBefore);
    assert.equal(store.getTaskById(task.id).message_id, message.id);
  } finally {
    store.close();
  }
});

test("Store round-trips handoff_state / handoff_seq on insert and update", (t) => {
  const store = openDataDb(tempRoot(t));
  try {
    const member = store.insertMember({ type: "agent", name: "handoff-store-agent" });
    const channel = store.insertChannel({ name: "handoff-store" });
    const message = store.appendMessage({
      targetId: channel.id,
      authorId: OWNER_MEMBER_ID,
      content: "store task",
    });

    const inserted = store.insertTask({
      messageId: message.id,
      number: 1,
      handoffState: "handed_off",
      handoffSeq: 7,
      handoffOwnerId: member.id,
    });
    assert.equal(inserted.handoff_state, "handed_off");
    assert.equal(inserted.handoff_seq, 7);
    assert.equal(inserted.handoff_owner_id, member.id);

    const loaded = store.getTaskById(inserted.id);
    assert.equal(loaded.handoff_state, "handed_off");
    assert.equal(loaded.handoff_seq, 7);
    assert.equal(loaded.handoff_owner_id, member.id);

    const updated = store.updateTask(inserted.id, {
      handoffState: "blocked",
      handoffSeq: 9,
      handoffOwnerId: null,
    });
    assert.equal(updated.handoff_state, "blocked");
    assert.equal(updated.handoff_seq, 9);
    assert.equal(updated.handoff_owner_id, null);

    const second = store.appendMessage({
      targetId: channel.id,
      authorId: member.id,
      content: "second anchor",
    });
    const plain = store.insertTask({ messageId: second.id, number: 2 });
    assert.equal(plain.handoff_state, null);
    assert.equal(plain.handoff_seq, null);
    assert.equal(plain.handoff_owner_id, null);
  } finally {
    store.close();
  }
});
