import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "./sqlite.ts";
import { runMigrations, SCHEMA_VERSION } from "./schema.ts";

/**
 * 票 #249 的持久形状：round_logs.role（准入角色，可空）。
 * 接缝 = 真实临时 SQLite + Store 契约 + runMigrations（不碰真实数据目录）。
 *
 * 「老库」按 #248 之后、本票之前的真实形状构造：同一个 v19（版本号不 bump——#250 在
 * 同一个 v19 里加频道首席列），只是 round_logs 还没有 role 列。所以老库的升级路径
 * 是「user_version 仍是 19，靠 PRAGMA 列检测补列」——这正是要守的东西。
 */

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-round-role-schema-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function columnNames(store, table) {
  return store.db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((column) => column.name);
}

function dropRoleColumn(store) {
  store.db.exec("ALTER TABLE round_logs DROP COLUMN role");
}

function insertLegacyRound(store, agentId, { withUsage = true } = {}) {
  // 老形状的一行（没有 role 列）：用量三列是 v16 就有的，必须原样活下来。
  store.db
    .prepare(
      `INSERT INTO round_logs
         (id, agent_id, target_id, status, reason, base_seq, created_at, prompt_tokens, completion_tokens, cost)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "legacy-round",
      agentId,
      "chan-legacy",
      "replied",
      "",
      3,
      "2026-01-01T00:00:00.000Z",
      withUsage ? 1200 : null,
      withUsage ? 300 : null,
      withUsage ? 0.005 : null,
    );
}

test("a fresh database is v19 and round_logs.role exists, nullable", (t) => {
  const store = openDataDb(tempRoot(t));
  try {
    assert.equal(SCHEMA_VERSION, 19);
    assert.equal(store.db.pragma("user_version", { simple: true }), 19);
    assert.ok(columnNames(store, "round_logs").includes("role"), "新库直接落最终形状");
    const agent = store.insertMember({ type: "agent", name: "fresh-role-agent" });
    const row = store.insertRoundLog({
      agentId: agent.id,
      targetId: "chan-fresh",
      status: "replied",
    });
    assert.equal(row.role, null, "没传角色 ⇒ NULL（不编造）");
    const stored = store.listRoundLogs(agent.id)[0];
    assert.equal(stored.role, null);
  } finally {
    store.close();
  }
});

test("a v19 database without the role column upgrades forward and keeps its rows", (t) => {
  const root = tempRoot(t);
  const store = openDataDb(root);
  try {
    const agent = store.insertMember({ type: "agent", name: "legacy-role-agent" });
    insertLegacyRound(store, agent.id);
    const other = store.insertRoundLog({
      agentId: agent.id,
      targetId: "chan-other",
      status: "error",
      reason: "prompt failed",
      baseSeq: 4,
      role: "chief",
    });
    // 退回「本票之前」的形状：去 role 列，版本号保持 19。
    dropRoleColumn(store);
    store.db.prepare("DELETE FROM round_logs WHERE id = ?").run(other.id);
    assert.equal(columnNames(store, "round_logs").includes("role"), false);
    assert.equal(store.db.pragma("user_version", { simple: true }), 19);

    runMigrations(store.db);

    assert.equal(store.db.pragma("user_version", { simple: true }), 19, "版本号不 bump");
    assert.ok(columnNames(store, "round_logs").includes("role"), "重复开库补上 role 列");
    const [legacy] = store.listRoundLogs(agent.id);
    assert.equal(legacy.id, "legacy-round");
    assert.equal(legacy.role, null, "历史行没有角色信息 ⇒ NULL，不报错");
    assert.equal(legacy.prompt_tokens, 1200, "既有用量列原样保留");
    assert.equal(legacy.completion_tokens, 300);
    assert.equal(legacy.cost, 0.005);
    assert.equal(legacy.base_seq, 3);

    // 补列后可正常写入角色。
    store.insertRoundLog({
      agentId: agent.id,
      targetId: "chan-legacy",
      status: "replied",
      baseSeq: 4,
      role: "human-mention",
    });
    const rows = store.listRoundLogs(agent.id);
    assert.equal(rows[0].role, "human-mention");
    assert.equal(rows[1].role, null);

    // 幂等：再开一次库不重复加列、不报错。
    runMigrations(store.db);
    assert.equal(
      columnNames(store, "round_logs").filter((name) => name === "role").length,
      1,
      "只补一次",
    );
    assert.equal(store.listRoundLogs(agent.id).length, 2, "重复开库不动数据");
  } finally {
    store.close();
  }
});
