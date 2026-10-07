import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../../data/sqlite.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-rounds-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createAgent, deleteAgent } = await import("./members.ts");
const {
  logRoundOutcome,
  listRoundLogs,
  listAbandonedMarks,
  isAbandonedRound,
  ROUND_LOG_RETAIN,
} = await import("./rounds.ts");

// 名字唯一性（agent-name-uniqueness）：同一 DB 内多次创建用唯一后缀避免重名拒绝
let fixtureSeq = 0;

test("only decided outcomes are logged; transient statuses are filtered out", () => {
  const agent = createAgent({ name: "filtered" });

  for (const status of [
    "replied",
    "ignored",
    "silent",
    "anyway",
    "yielded",
    "error",
    "busy-cwd",
  ]) {
    assert.notEqual(
      logRoundOutcome(agent.id, "t-1", { status }),
      null,
      `${status} 应落盘`,
    );
  }
  for (const status of ["noop", "skipped", "busy"]) {
    assert.equal(
      logRoundOutcome(agent.id, "t-1", { status }),
      null,
      `${status} 不应落盘`,
    );
  }

  const rows = listRoundLogs(agent.id, 100);
  assert.equal(rows.length, 7);
  const statuses = rows.map((r) => r.status).sort();
  assert.deepEqual(statuses, [
    "anyway",
    "busy-cwd",
    "error",
    "ignored",
    "replied",
    "silent",
    "yielded",
  ]);
});

test("reason and baseSeq round-trip; list is newest first and per-agent", () => {
  const bob = createAgent({ name: "bob" });
  const alice = createAgent({ name: "alice" });

  logRoundOutcome(bob.id, "c-1", {
    status: "error",
    reason: "ignore on must-respond signal (capped at 2)",
    baseSeq: 7,
  });
  const second = logRoundOutcome(bob.id, "c-1", {
    status: "replied",
    reason: "",
    baseSeq: 7,
  });
  logRoundOutcome(alice.id, "c-1", {
    status: "replied",
    reason: "",
    baseSeq: 1,
  });

  const bobRows = listRoundLogs(bob.id);
  assert.equal(bobRows.length, 2);
  assert.equal(bobRows[0].id, second.id, "最近在前");
  assert.equal(bobRows[1].status, "error");
  assert.equal(
    bobRows[1].reason,
    "ignore on must-respond signal (capped at 2)",
  );
  assert.equal(bobRows[1].baseSeq, 7);

  const aliceRows = listRoundLogs(alice.id);
  assert.equal(aliceRows.length, 1);
  assert.equal(aliceRows[0].status, "replied");
});

test("listRoundLogs speaks camelCase with a valid ISO createdAt (D2)", () => {
  // D2：可观测载荷里的 timeline 是 camelCase（kind/at/number/…），rounds 却直接透传
  // 数据层的 snake_case 行——AgentDetailPanel 读 round.targetId / baseSeq / createdAt
  // 全是 undefined，于是渲染出空白 target、光秃秃的 `#` 和 "Invalid Date"。
  // 服务层出线统一 camelCase：snake_case 只活在数据层（Store 契约）。
  const agent = createAgent({ name: `view-${++fixtureSeq}` });
  logRoundOutcome(agent.id, "chan-view", {
    status: "error",
    reason: 'model error: 429: {"message":"Rate limit exceeded."}',
    baseSeq: 12,
  });

  const [row] = listRoundLogs(agent.id);
  assert.equal(row.targetId, "chan-view");
  assert.equal(row.baseSeq, 12);
  assert.equal(row.status, "error");
  assert.match(row.reason, /Rate limit exceeded/);
  assert.equal(Number.isNaN(Date.parse(row.createdAt)), false, "createdAt 是合法 ISO");
  assert.equal(new Date(row.createdAt).toISOString(), row.createdAt, "createdAt 原样可解析回自身");
  assert.equal("target_id" in row, false, "出线形状不带 snake_case 字段");
  assert.equal("base_seq" in row, false);
  assert.equal("created_at" in row, false);
});

test("ring cap keeps the newest ROUND_LOG_RETAIN rounds per agent", () => {
  const agent = createAgent({ name: "capped" });
  for (let i = 0; i < ROUND_LOG_RETAIN + 25; i++) {
    logRoundOutcome(agent.id, "t-2", { status: "replied", baseSeq: i + 1 });
  }
  const rows = listRoundLogs(agent.id, ROUND_LOG_RETAIN + 50);
  assert.equal(rows.length, ROUND_LOG_RETAIN, "超限旧行应被裁剪");
  assert.equal(rows[0].baseSeq, ROUND_LOG_RETAIN + 25, "最新在前");
  assert.equal(
    rows[rows.length - 1].baseSeq,
    26,
    "最旧保留 = 第 26 轮（前 25 轮被裁）",
  );
});

test("a soft-deleted member's in-flight round still lands in round_logs (FK intact, invisible in UI)", () => {
  const agent = createAgent({ name: "doomed" });
  deleteAgent(agent.id);
  // 软删保留行承载外键（消息同理）：写不失败；可观测页只查未删 agent，此行为不可见。
  const row = logRoundOutcome(agent.id, "t-3", {
    status: "error",
    reason: "mid-deletion round",
  });
  assert.notEqual(row, null);
  assert.equal(row.status, "error");
});

test("isAbandonedRound: silent and capped error count; retryable/yielding/normal statuses do not", () => {
  assert.equal(
    isAbandonedRound({ status: "silent", reason: "retries exhausted" }),
    true,
  );
  assert.equal(
    isAbandonedRound({
      status: "error",
      reason: "ignore on must-respond signal (capped at 2)",
    }),
    true,
  );
  assert.equal(
    isAbandonedRound({ status: "error", reason: "prompt failed" }),
    false,
    "普通 error 下次 wake 重试",
  );
  assert.equal(
    isAbandonedRound({ status: "busy-cwd", reason: "busy" }),
    false,
    "busy-cwd driver 等 settle 后重试",
  );
  assert.equal(
    isAbandonedRound({ status: "yielded", reason: "claim failed" }),
    false,
    "yielded 任务让路",
  );
  assert.equal(
    isAbandonedRound({ status: "ignored", reason: "" }),
    false,
    "ignored 正常协议选择",
  );
  assert.equal(isAbandonedRound({ status: "replied", reason: "" }), false);
  assert.equal(isAbandonedRound({ status: "anyway", reason: "" }), false);
});

test("a revised-no-content error is retryable; revised-to-ignore silent is terminal (11)", () => {
  // 11-整改：revised 空内容 = error 轮（不推进游标、下次 wake 重试）→ 不标「已放弃」badge；
  // revised to ignore = silent（ackSeq 已推进、真正终止）→ 标「已放弃」
  const agent = createAgent({ name: "rewriter" });
  assert.equal(
    isAbandonedRound({
      status: "error",
      reason: "revised reply had no content",
    }),
    false,
    "会重试的轮次不标已放弃——badge 不说谎",
  );
  assert.equal(
    isAbandonedRound({ status: "silent", reason: "revised to ignore" }),
    true,
    "真正终止的 silent 仍标已放弃",
  );

  logRoundOutcome(agent.id, "c-rewrite", {
    status: "error",
    reason: "revised reply had no content",
    baseSeq: 3,
  });
  logRoundOutcome(agent.id, "c-rewrite", {
    status: "silent",
    reason: "revised to ignore",
    baseSeq: 4,
  });
  assert.deepEqual(
    listAbandonedMarks("c-rewrite").map((m) => ({
      reason: m.reason,
      baseSeq: m.baseSeq,
    })),
    [{ reason: "revised to ignore", baseSeq: 4 }],
    "只有真正终止的 silent 轮产生已放弃标记",
  );
  const errorRow = listRoundLogs(agent.id).find((r) => r.status === "error");
  assert.equal(
    errorRow.baseSeq,
    3,
    "error 轮的 baseSeq 落盘正确（#baseSeq 承诺）",
  );
});

test("listAbandonedMarks anchors on the latest abandoned round per agent and clears on later rounds", () => {
  // 名字唯一性（agent-name-uniqueness）：同文件早前用例已占用 alice/bob，此处用唯一后缀
  const alice = createAgent({ name: `alice-${++fixtureSeq}` });
  const bob = createAgent({ name: `bob-${++fixtureSeq}` });

  // alice: silent at seq 3 → 标记；随后 replied（新消息 seq 4 轮）→ 清除
  logRoundOutcome(alice.id, "c-1", {
    status: "silent",
    reason: "retries exhausted",
    baseSeq: 3,
  });
  assert.deepEqual(
    listAbandonedMarks("c-1").map((m) => ({
      agent: m.agentName,
      baseSeq: m.baseSeq,
    })),
    [{ agent: alice.name, baseSeq: 3 }],
  );
  logRoundOutcome(alice.id, "c-1", { status: "replied", baseSeq: 4 });
  assert.equal(listAbandonedMarks("c-1").length, 0, "后续 replied 清除标记");

  // bob: capped error at seq 5 → 标记；随后 silent 于更新轮 → 锚点移到新 baseSeq
  logRoundOutcome(bob.id, "c-1", {
    status: "error",
    reason: "ignore on must-respond signal (capped at 2)",
    baseSeq: 5,
  });
  logRoundOutcome(bob.id, "c-1", {
    status: "silent",
    reason: "retries exhausted",
    baseSeq: 7,
  });
  assert.deepEqual(
    listAbandonedMarks("c-1").map((m) => ({
      agent: m.agentName,
      baseSeq: m.baseSeq,
      reason: m.reason,
    })),
    [{ agent: bob.name, baseSeq: 7, reason: "retries exhausted" }],
  );
});

test("listAbandonedMarks is per-target and resolves agent names", () => {
  const carol = createAgent({ name: "carol" });
  logRoundOutcome(carol.id, "c-2", {
    status: "silent",
    reason: "",
    baseSeq: 1,
  });
  assert.equal(listAbandonedMarks("c-3").length, 0, "无轮次的 target 无标记");
  const marks = listAbandonedMarks("c-2");
  assert.equal(marks.length, 1);
  assert.equal(marks[0].agentName, "carol");
  assert.equal(marks[0].agentId, carol.id);
  assert.equal(marks[0].baseSeq, 1);
});
