import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readRoute = (path) =>
  readFile(new URL(`../../../app/api/${path}`, import.meta.url), "utf-8");

test("GET /api/members returns agents with home_path plus the human owner", async () => {
  const source = await readRoute("members/route.ts");
  assert.match(source, /home_path/);
  assert.match(source, /owner/);
  assert.match(source, /getOwner\(/);
});

test("POST /api/members requires model + thinking level and auto-creates the home (no workspacePath)", async () => {
  const source = await readRoute("members/route.ts");
  assert.match(source, /createAgent\(/);
  assert.match(source, /required when creating an agent/);
  assert.match(source, /thinkingLevel/);
  assert.match(source, /home_path/);
  assert.doesNotMatch(source, /workspacePath/);
  assert.match(source, /status: 201/);
});

test("DELETE /api/members/[id] soft-deletes the identity through the lifecycle layer", async () => {
  const source = await readRoute("members/[id]/route.ts");
  assert.match(source, /deleteAgentIdentity\(/);
  assert.match(source, /status: 404/);
  assert.match(source, /GET/);
  assert.match(source, /getAgent\(/);
});

test("POST /api/members/[id]/workspace rebinds the workspace directory", async () => {
  const source = await readRoute("members/[id]/workspace/route.ts");
  assert.match(source, /changeAgentWorkspace\(/);
  assert.match(source, /workspacePath/);
});

test("lifecycle routes: restart / session-reset / full-reset exist and share the error mapping helper", async () => {
  const restart = await readRoute("members/[id]/restart/route.ts");
  const sessionReset = await readRoute("members/[id]/session-reset/route.ts");
  const fullReset = await readRoute("members/[id]/full-reset/route.ts");
  assert.match(restart, /restartAgent\(/);
  assert.match(sessionReset, /sessionResetAgent\(/);
  assert.match(fullReset, /fullResetAgent\(/);
  for (const source of [restart, sessionReset, fullReset]) {
    assert.match(source, /toLifecycleErrorStatus\(/);
  }
  const lifecycle = await readFile(
    new URL("../../../lib/agent-lifecycle.ts", import.meta.url),
    "utf-8",
  );
  assert.match(lifecycle, /instanceof BusyCwdError/);
  assert.match(lifecycle, /409/);
  assert.match(lifecycle, /AgentNotFoundError/);
  assert.match(lifecycle, /404/);
});

test("POST /api/members/[id]/dm idempotently creates/fetches the DM (getAgent 404 gate + hasMessages)", async () => {
  const source = await readRoute("members/[id]/dm/route.ts");
  // 薄封装：软删/不存在 agent 由 getAgent 拦（AgentNotFoundError → 404）
  assert.match(source, /getAgent\(/);
  assert.match(source, /AgentNotFoundError/);
  assert.match(source, /\? 404 : 500/);
  // 幂等建/取 DM 委托服务层 createDirectChannel，route 不重复实现
  assert.match(source, /createDirectChannel\(/);
  // 返回 { channel, hasMessages }：channel 附 meta（listChannelsWithMeta）供 AppShell 合并
  assert.match(source, /listChannelsWithMeta\(/);
  assert.match(source, /hasMessages/);
  assert.match(source, /channel/);
});

test("GET /api/members/events streams status snapshots over SSE", async () => {
  const source = await readRoute("members/events/route.ts");
  assert.match(source, /subscribeAgentStatuses/);
  assert.match(source, /getAgentStatusSnapshot\(/);
  assert.match(source, /text\/event-stream/);
  assert.match(source, /startAgentStatusSweeper/);
});
