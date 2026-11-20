import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "./sqlite.ts";
import { runMigrations, SCHEMA_VERSION } from "./schema.ts";

/**
 * 票 #300 的持久形状：members.last_error（可空文本，v20）。
 * 接缝 = 真实临时 SQLite + Store 契约 + runMigrations（不碰真实数据目录）。
 *
 * 「v19 老库」按上一版真实形状构造：先用当前 schema 建库，再把 last_error 列 DROP 掉
 * 并把 user_version 退回 19——升级路径靠 PRAGMA 列检测补列，重复开库幂等。
 */

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-last-error-schema-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function memberColumns(store) {
  return store.db
    .prepare("PRAGMA table_info(members)")
    .all()
    .map((column) => column.name);
}

function dropLastErrorColumn(store) {
  store.db.exec("ALTER TABLE members DROP COLUMN last_error");
  store.db.pragma("user_version = 19");
}

test("fresh database is v20 and members.last_error starts null", (t) => {
  const store = openDataDb(tempRoot(t));
  try {
    assert.equal(SCHEMA_VERSION, 20);
    assert.equal(store.db.pragma("user_version", { simple: true }), 20);
    assert.ok(memberColumns(store).includes("last_error"));
    const member = store.insertMember({ type: "agent", name: "fresh-error-agent" });
    assert.equal(member.last_error, null);
    assert.equal(store.getMember(member.id).last_error, null);
  } finally {
    store.close();
  }
});

test("v19 database upgrades forward and keeps existing rows", (t) => {
  const store = openDataDb(tempRoot(t));
  try {
    const member = store.insertMember({ type: "agent", name: "legacy-error-agent" });
    dropLastErrorColumn(store);
    assert.equal(memberColumns(store).includes("last_error"), false);
    assert.equal(store.db.pragma("user_version", { simple: true }), 19);

    runMigrations(store.db);

    assert.equal(store.db.pragma("user_version", { simple: true }), 20);
    assert.ok(memberColumns(store).includes("last_error"));
    assert.equal(
      store.getMember(member.id).last_error,
      null,
      "历史行没有错误文本 ⇒ NULL，不编造",
    );

    store.updateMemberStatus(member.id, "error", "  429: Rate limit reached  ");
    assert.equal(
      store.getMember(member.id).last_error,
      "429: Rate limit reached",
      "错误文本按 trim 后的原文落库",
    );

    // 幂等：重复开库不重复加列、不清掉已写入的错误。
    runMigrations(store.db);
    assert.equal(
      memberColumns(store).filter((name) => name === "last_error").length,
      1,
      "只补一次",
    );
    assert.equal(store.getMember(member.id).last_error, "429: Rate limit reached");
  } finally {
    store.close();
  }
});

test("updateMemberStatus stores last_error only for error, and clears it on every exit", (t) => {
  const store = openDataDb(tempRoot(t));
  try {
    const member = store.insertMember({ type: "agent", name: "status-error-agent" });

    store.updateMemberStatus(member.id, "error", "  boom  ");
    assert.equal(store.getMember(member.id).status, "error");
    assert.equal(store.getMember(member.id).last_error, "boom");

    store.updateMemberStatus(member.id, "error", "   ");
    assert.equal(
      store.getMember(member.id).last_error,
      null,
      "error 但无具体文本 ⇒ NULL，不继承旧错",
    );

    store.updateMemberStatus(member.id, "error", "second failure");
    store.updateMemberStatus(member.id, "working");
    assert.equal(store.getMember(member.id).status, "working");
    assert.equal(store.getMember(member.id).last_error, null);

    store.updateMemberStatus(member.id, "error", "third failure");
    store.updateMemberStatus(member.id, "online");
    assert.equal(store.getMember(member.id).last_error, null);

    store.updateMemberStatus(member.id, "error", "fourth failure");
    store.updateMemberStatus(member.id, "offline");
    assert.equal(store.getMember(member.id).last_error, null);
  } finally {
    store.close();
  }
});
