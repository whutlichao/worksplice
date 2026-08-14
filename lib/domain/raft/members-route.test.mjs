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

test("GET /api/members/events streams status snapshots over SSE", async () => {
  const source = await readRoute("members/events/route.ts");
  assert.match(source, /subscribeAgentStatuses/);
  assert.match(source, /getAgentStatusSnapshot\(/);
  assert.match(source, /text\/event-stream/);
  assert.match(source, /startAgentStatusSweeper/);
});
