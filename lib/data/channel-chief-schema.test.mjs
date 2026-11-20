import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "./sqlite.ts";
import { runMigrations, SCHEMA_VERSION } from "./schema.ts";

/**
 * 票 #250 的持久形状：channels.chief_member_id（nullable，v19 内追加；
 * 当前 schema 已由 #300 升到 v20，本文件仍守该列的迁移语义）。
 * 接缝 = 真实临时 SQLite + Store 契约 + runMigrations（不碰真实数据目录）。
 *
 * 「v18 老库」的构造方式与 chief-schema.test.mjs 同款：先用当前 schema 建库，
 * 再把 v19+ 才有的列 DROP 掉并把 user_version 退回 18。
 */

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-channel-chief-schema-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function channelColumns(store) {
  return store.db
    .prepare("PRAGMA table_info(channels)")
    .all()
    .map((column) => column.name);
}

function dropChiefColumn(store) {
  store.db.exec("ALTER TABLE channels DROP COLUMN chief_member_id");
  store.db.pragma("user_version = 18");
}

test("fresh database is v20 and channels.chief_member_id defaults to null", (t) => {
  const store = openDataDb(tempRoot(t));
  try {
    assert.equal(SCHEMA_VERSION, 20);
    assert.equal(store.db.pragma("user_version", { simple: true }), 20);
    assert.ok(channelColumns(store).includes("chief_member_id"));
    const channel = store.insertChannel({ name: "fresh-room" });
    assert.equal(channel.chief_member_id, null, "新建频道默认没有频道首席");
    assert.equal(store.getChannel(channel.id).chief_member_id, null);
  } finally {
    store.close();
  }
});

test("v18 database upgrades forward: the column exists and old channels stay unbound", (t) => {
  const store = openDataDb(tempRoot(t));
  try {
    const channel = store.insertChannel({ name: "legacy-room" });
    const agent = store.insertMember({ type: "agent", name: "legacy-agent" });
    dropChiefColumn(store);
    assert.equal(channelColumns(store).includes("chief_member_id"), false);

    runMigrations(store.db);

    assert.ok(channelColumns(store).includes("chief_member_id"), "老库升级后有列可用");
    assert.equal(store.getChannel(channel.id).chief_member_id, null, "存量频道不凭空有首席");
    store.setChannelChief(channel.id, agent.id);
    assert.equal(store.getChannel(channel.id).chief_member_id, agent.id);

    // 幂等：重复开库不重建列、不清掉已有绑定。
    runMigrations(store.db);
    assert.equal(store.getChannel(channel.id).chief_member_id, agent.id);
  } finally {
    store.close();
  }
});

test("a database without any channel chief upgrades cleanly, twice", (t) => {
  const store = openDataDb(tempRoot(t));
  try {
    store.insertChannel({ name: "no-chief-room" });
    dropChiefColumn(store);

    runMigrations(store.db);
    runMigrations(store.db);

    assert.ok(channelColumns(store).includes("chief_member_id"));
    assert.deepEqual(
      store.listChannels().map((row) => row.chief_member_id),
      store.listChannels().map(() => null),
      "没有首席的库升级后仍然没有首席，不报错",
    );
  } finally {
    store.close();
  }
});

test("Store.setChannelChief binds and clears one channel at a time", (t) => {
  const store = openDataDb(tempRoot(t));
  try {
    const channel = store.insertChannel({ name: "bind-room" });
    const other = store.insertChannel({ name: "bind-other-room" });
    const first = store.insertMember({ type: "agent", name: "bind-agent-1" });
    const second = store.insertMember({ type: "agent", name: "bind-agent-2" });

    store.setChannelChief(channel.id, first.id);
    store.setChannelChief(other.id, second.id);
    assert.equal(store.getChannel(channel.id).chief_member_id, first.id);
    assert.equal(store.getChannel(other.id).chief_member_id, second.id, "频道之间互不影响");

    store.setChannelChief(channel.id, second.id);
    assert.equal(store.getChannel(channel.id).chief_member_id, second.id, "换人即换");

    store.setChannelChief(channel.id, null);
    assert.equal(store.getChannel(channel.id).chief_member_id, null, "清空 = 回落");
  } finally {
    store.close();
  }
});
