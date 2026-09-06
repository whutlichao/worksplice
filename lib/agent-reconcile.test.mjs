import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { shallowEqualAgent, reconcileAgents } = await jiti.import(
  "./agent-reconcile.ts",
);

/** 与 listAgents()（未删除 agent 成员行）同形的构造器。 */
const agent = (id, name, extra = {}) => ({
  id,
  type: "agent",
  name,
  description: "",
  role: "member",
  workspace_path: null,
  pi_session_file: null,
  status: "offline",
  deleted: 0,
  model_provider: null,
  model_id: null,
  thinking_level: null,
  created_at: "2026-01-01T00:00:00.000Z",
  ...extra,
});

// bug 症状：Susan 走 HTTP API 代办创建 agent 后，前端无刷新时 agent 列表应经轮询
// 在 15s 内出现新 agent；成员 id 集合变化须被检出，以驱动 membersVersion 递增 →
// useChannelData 重拉成员集合 → 频道成员列表/成员面板/@ 候选同步收敛。

test("reconcileAgents detects a newly added member and reuses unchanged rows (Susan 代办创建)", () => {
  const prev = [agent("a", "Alpha"), agent("b", "Beta")];
  const incoming = [agent("a", "Alpha"), agent("b", "Beta"), agent("c", "Charlie")];

  const { agents, membersChanged } = reconcileAgents(prev, incoming);
  assert.equal(membersChanged, true);
  assert.deepEqual(agents.map((x) => x.id), ["a", "b", "c"]);
  // 未变更行复用旧引用：agent 行不无谓重渲染
  assert.equal(agents[0], prev[0]);
  assert.equal(agents[1], prev[1]);
});

test("reconcileAgents detects member removal (soft-deleted agent 移出列表)", () => {
  const prev = [agent("a", "Alpha"), agent("b", "Beta")];
  const incoming = [agent("a", "Alpha")];

  const { agents, membersChanged } = reconcileAgents(prev, incoming);
  assert.equal(membersChanged, true);
  assert.deepEqual(agents.map((x) => x.id), ["a"]);
});

test("reconcileAgents does not signal membersChanged on status-only change (SSE 状态点)", () => {
  const prev = [agent("a", "Alpha")];
  const incoming = [agent("a", "Alpha", { status: "working" })];

  const { agents, membersChanged } = reconcileAgents(prev, incoming);
  // 状态变化不是成员集合变化：不应触发 membersVersion 递增（避免无谓成员集合重拉）
  assert.equal(membersChanged, false);
  assert.equal(agents[0].status, "working");
  assert.notEqual(agents[0], prev[0]);
});

test("reconcileAgents returns the same reference when nothing changed", () => {
  const prev = [agent("a", "Alpha")];
  const incoming = [agent("a", "Alpha")];

  const { agents, membersChanged } = reconcileAgents(prev, incoming);
  assert.equal(membersChanged, false);
  assert.equal(agents, prev);
});

test("reconcileAgents initial load populates without an unnecessary array copy", () => {
  const prev = [];
  const incoming = [agent("a", "Alpha")];

  const { agents, membersChanged } = reconcileAgents(prev, incoming);
  assert.equal(agents, incoming);
  assert.equal(membersChanged, true);
});

test("shallowEqualAgent compares the identity-relevant fields only", () => {
  assert.equal(shallowEqualAgent(agent("a", "Alpha"), agent("a", "Alpha")), true);
  assert.equal(
    shallowEqualAgent(agent("a", "Alpha"), agent("a", "Alpha", { status: "working" })),
    false,
  );
  assert.equal(
    shallowEqualAgent(agent("a", "Alpha"), agent("b", "Alpha")),
    false,
  );
});
