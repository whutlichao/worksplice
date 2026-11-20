import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "./sqlite.ts";
import { runMigrations, SCHEMA_VERSION, LEGACY_CHIEF_MEMBER_NAME } from "./schema.ts";

/**
 * 票 #248 的持久形状：members.global_chief（v19 引入；当前 schema 为 v20）。
 * 接缝 = 真实临时 SQLite + Store 契约 + runMigrations（不碰真实数据目录）。
 *
 * 「v18 老库」的构造方式与 task-handoff-schema.test.mjs 同款：先用当前 schema 建库，
 * 再把 v19 才有的列 DROP 掉并把 user_version 退回 18。
 */

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-chief-schema-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function memberColumns(store) {
  return store.db
    .prepare("PRAGMA table_info(members)")
    .all()
    .map((column) => column.name);
}

function dropChiefColumn(store) {
  store.db.exec("ALTER TABLE members DROP COLUMN global_chief");
  store.db.pragma("user_version = 18");
}

function chiefIds(store) {
  return store.db
    .prepare("SELECT id FROM members WHERE global_chief = 1 ORDER BY created_at, id")
    .all()
    .map((row) => row.id);
}

test("fresh database is v20 and members.global_chief defaults to 0", (t) => {
  const store = openDataDb(tempRoot(t));
  try {
    assert.equal(SCHEMA_VERSION, 20);
    assert.equal(store.db.pragma("user_version", { simple: true }), 20);
    assert.ok(memberColumns(store).includes("global_chief"));
    const member = store.insertMember({ type: "agent", name: "fresh-agent" });
    assert.equal(member.global_chief, 0, "新建成员默认不是首席");
    assert.deepEqual(chiefIds(store), []);
  } finally {
    store.close();
  }
});

test("v18 database upgrades forward: the live legacy Susan becomes the only global chief", (t) => {
  const store = openDataDb(tempRoot(t));
  try {
    // 用户库的真实形状：多行同名、其中若干软删。确定性顺序 = created_at, id 的第一条存活行。
    const oldest = store.insertMember({
      type: "agent",
      name: LEGACY_CHIEF_MEMBER_NAME,
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    store.insertMember({
      type: "agent",
      name: LEGACY_CHIEF_MEMBER_NAME,
      createdAt: "2025-03-01T00:00:00.000Z",
    });
    const deletedSusan = store.insertMember({
      type: "agent",
      name: LEGACY_CHIEF_MEMBER_NAME,
      createdAt: "2024-06-01T00:00:00.000Z",
    });
    store.setMemberDeleted(deletedSusan.id, 1);
    const other = store.insertMember({ type: "agent", name: "some-other-agent" });

    dropChiefColumn(store);
    runMigrations(store.db);

    assert.equal(store.db.pragma("user_version", { simple: true }), 20);
    assert.deepEqual(chiefIds(store), [oldest.id], "存活的同名成员按确定性顺序取第一条");
    assert.equal(store.getMember(other.id).global_chief, 0);

    // 幂等：重复开库不重复标记、不改别人。
    runMigrations(store.db);
    assert.deepEqual(chiefIds(store), [oldest.id]);
  } finally {
    store.close();
  }
});

test("v18 database without a legacy Susan upgrades to «no chief», no error, idempotent", (t) => {
  const store = openDataDb(tempRoot(t));
  try {
    const agent = store.insertMember({ type: "agent", name: "no-susan-agent" });
    dropChiefColumn(store);

    runMigrations(store.db);

    assert.ok(memberColumns(store).includes("global_chief"));
    assert.deepEqual(chiefIds(store), [], "没有 Susan 就留空（行为与升级前一致）");
    assert.equal(store.getMember(agent.id).global_chief, 0);

    runMigrations(store.db);
    assert.deepEqual(chiefIds(store), []);
  } finally {
    store.close();
  }
});

test("clearing the chief persists: the one-time seed never re-marks on later opens", (t) => {
  const store = openDataDb(tempRoot(t));
  try {
    const susan = store.insertMember({ type: "agent", name: LEGACY_CHIEF_MEMBER_NAME });
    dropChiefColumn(store);
    runMigrations(store.db);
    assert.deepEqual(chiefIds(store), [susan.id]);

    store.setGlobalChief(null);
    runMigrations(store.db);
    assert.deepEqual(chiefIds(store), [], "用户显式清空后不会被开库重新标回去");
  } finally {
    store.close();
  }
});

test("Store.setGlobalChief keeps at most one chief", (t) => {
  const store = openDataDb(tempRoot(t));
  try {
    const first = store.insertMember({ type: "agent", name: "chief-store-first" });
    const second = store.insertMember({ type: "agent", name: "chief-store-second" });

    store.setGlobalChief(first.id);
    assert.deepEqual(chiefIds(store), [first.id]);

    store.setGlobalChief(second.id);
    assert.deepEqual(chiefIds(store), [second.id], "换人即换（旧的被清空）");
    assert.equal(store.getMember(first.id).global_chief, 0);

    store.setGlobalChief(null);
    assert.deepEqual(chiefIds(store), []);
  } finally {
    store.close();
  }
});
