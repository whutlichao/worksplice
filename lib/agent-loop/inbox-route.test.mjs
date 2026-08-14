import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readRoute = (path) =>
  readFile(new URL(`../../app/api/${path}`, import.meta.url), "utf-8");

test("GET /api/members/[id]/inbox exposes drain + ack semantics", async () => {
  const source = await readRoute("members/[id]/inbox/route.ts");
  assert.match(source, /drainAndAck\(/);
  assert.match(source, /getPendingTargets\(/);
  assert.match(source, /searchParams\.get\("targetId"\)/);
  assert.match(source, /AgentNotFoundError/);
  assert.match(source, /status: 404/);
});

test("messages route emits wake hints after a committed send", async () => {
  const source = await readRoute("messages/route.ts");
  assert.match(source, /CURRENT_MEMBER_ID/);
  assert.match(source, /status: 409/);
});

test("agent loop service exposes the round/driver/backfill entry points", async () => {
  const index = await readFile(
    new URL("../../lib/agent-loop/index.ts", import.meta.url),
    "utf-8",
  );
  // Ticket 02 窄面：公共接口只有 createAgentLoop，编排不外露
  assert.match(index, /createAgentLoop/);
  assert.match(index, /type AgentLoop/);
  assert.doesNotMatch(index, /startAgentLoopDriver/);
  assert.doesNotMatch(index, /backfillAllAgents/);

  const wake = await readFile(new URL("../../lib/domain/raft/wake.ts", import.meta.url), "utf-8");
  assert.match(wake, /WakeHint/);
  assert.match(wake, /seq: number/);

  const loop = await readFile(new URL("../../lib/agent-loop/loop.ts", import.meta.url), "utf-8");
  assert.match(loop, /deliverWithFreshness/);
  assert.match(loop, /onConflict/);
  assert.match(loop, /MAX_REVISE_RETRIES/);
  assert.match(loop, /MAX_RESEND_RETRIES/);
  // AgentLoop 公共接口（start/stop/tick）定义在深模块内
  assert.match(loop, /interface AgentLoop/);
  assert.match(loop, /start\(\): void/);
  assert.match(loop, /stop\(\): void/);
  assert.match(loop, /tick\(\): void/);
});
