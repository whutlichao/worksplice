import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  parseSessionFileStats,
  sumSessionStats,
  listAgentSessionFiles,
} = await jiti.import("./session-stats.ts");

function writeJsonl(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-stats-"));
  const file = path.join(dir, "session.jsonl");
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return { dir, file };
}

const ASSISTANT_WITH_USAGE = (overrides = {}) => ({
  type: "message",
  id: "m1",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "hi" }],
    usage: {
      input: 100,
      output: 50,
      cacheRead: 200,
      cacheWrite: 30,
      cost: { total: 0.012 },
      ...overrides,
    },
  },
});

test("parseSessionFileStats aggregates assistant usage and message counts", () => {
  const { file } = writeJsonl([
    { type: "session", version: 3, id: "s1", cwd: "/tmp" },
    { type: "message", id: "u1", message: { role: "user", content: "hello" } },
    ASSISTANT_WITH_USAGE(),
    ASSISTANT_WITH_USAGE({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: { total: 0.001 } }),
  ]);

  const stats = parseSessionFileStats(file);
  assert.equal(stats.messageCount, 3); // 2 assistant + 1 user
  assert.equal(stats.cachedTokens, 200);
  assert.equal(stats.uncachedTokens, 100 + 30 + 10); // input + cacheWrite, per message
  assert.equal(stats.totalTokens, (100 + 50 + 200 + 30) + (10 + 5));
  assert.ok(Math.abs(stats.costTotal - 0.013) < 1e-9);
  assert.equal(stats.compactionCount, 0);
  assert.equal(stats.compactionTokens, 0);
  assert.equal(stats.path, file);
  assert.ok(stats.modified);
});

test("parseSessionFileStats counts compaction entries and their tokensBefore", () => {
  const { file } = writeJsonl([
    { type: "compaction", id: "c1", summary: "…", tokensBefore: 4000, usage: { input: 500, output: 10, cacheRead: 0, cacheWrite: 0, cost: { total: 0.05 } } },
    { type: "compaction", id: "c2", summary: "…", tokensBefore: 1500 },
  ]);

  const stats = parseSessionFileStats(file);
  assert.equal(stats.compactionCount, 2);
  assert.equal(stats.compactionTokens, 5500);
  assert.equal(stats.messageCount, 0);
  assert.equal(stats.totalTokens, 510);
});

test("parseSessionFileStats tolerates malformed lines and missing files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-stats-"));
  const file = path.join(dir, "broken.jsonl");
  fs.writeFileSync(file, "{not json}\n" + JSON.stringify(ASSISTANT_WITH_USAGE()) + "\npartial");

  const stats = parseSessionFileStats(file);
  assert.equal(stats.messageCount, 1);
  assert.equal(stats.totalTokens, 380);

  assert.equal(parseSessionFileStats(path.join(dir, "nope.jsonl")), null);
});

test("parseSessionFileStats counts standalone usage entries as cost only, never as tokens", () => {
  // 0.99.x 把 cache_warm 之类的开销记在独立的 `usage` 条目里（PR #48 实测：
  // worksplice 报 0.05 / SDK 报 0.11，差 2.2 倍）。这类条目的 cacheWrite
  // **不是上下文 token**，灌进 token 桶会虚报上下文用量，所以只加费用。
  const cacheWarm = {
    type: "usage",
    id: "u9",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 4096, cost: { total: 0.01 } },
  };
  const baseline = writeJsonl([ASSISTANT_WITH_USAGE()]);
  const withUsage = writeJsonl([ASSISTANT_WITH_USAGE(), cacheWarm]);

  const before = parseSessionFileStats(baseline.file);
  const after = parseSessionFileStats(withUsage.file);

  // 基线数值（ASSISTANT_WITH_USAGE：input 100 / output 50 / cacheRead 200 / cacheWrite 30 / cost 0.012）
  assert.equal(before.cachedTokens, 200);
  assert.equal(before.uncachedTokens, 130);
  assert.equal(before.totalTokens, 380);
  assert.ok(Math.abs(before.costTotal - 0.012) < 1e-9);

  // 费用：+0.01（0.012 → 0.022）
  assert.ok(Math.abs(after.costTotal - 0.022) < 1e-9);

  // 三个 token 桶与「无该条目」逐字相同 —— cacheWrite=4096 一个都没进去
  assert.equal(after.cachedTokens, 200);
  assert.equal(after.uncachedTokens, 130);
  assert.equal(after.totalTokens, 380);

  // usage 条目不是 message，不进消息计数
  assert.equal(before.messageCount, 1);
  assert.equal(after.messageCount, 1);
});

test("listAgentSessionFiles merges the bound file and cwd sessions, dedupes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-stats-"));
  const a = path.join(dir, "a.jsonl");
  const b = path.join(dir, "b.jsonl");
  fs.writeFileSync(a, "");
  fs.writeFileSync(b, "");

  const agent = {
    id: "agent-1",
    pi_session_file: a,
    workspace_path: dir,
  };
  const files = await listAgentSessionFiles(agent, async () => [
    { cwd: dir, path: a },
    { cwd: dir, path: b },
    { cwd: "/other", path: "/other/x.jsonl" },
    { cwd: dir, path: null },
  ]);
  assert.deepEqual([...files].sort(), [a, b].sort());

  // workspace 未绑定时只保留绑定文件
  const unbound = await listAgentSessionFiles({ id: "agent-2", pi_session_file: a, workspace_path: null }, async () => [
    { cwd: dir, path: b },
  ]);
  assert.deepEqual(unbound, [a]);
});

test("sumSessionStats aggregates totals across files", () => {
  const totals = sumSessionStats([
    { path: "a", modified: null, messageCount: 1, cachedTokens: 10, uncachedTokens: 20, totalTokens: 30, costTotal: 0.5, compactionCount: 1, compactionTokens: 100 },
    { path: "b", modified: null, messageCount: 2, cachedTokens: 5, uncachedTokens: 7, totalTokens: 12, costTotal: 0.25, compactionCount: 2, compactionTokens: 50 },
  ]);
  assert.deepEqual(totals, {
    messageCount: 3,
    cachedTokens: 15,
    uncachedTokens: 27,
    totalTokens: 42,
    costTotal: 0.75,
    compactionCount: 3,
    compactionTokens: 150,
  });
});
