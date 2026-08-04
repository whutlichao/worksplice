import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readRoute = (path) =>
  readFile(new URL(`../../app/api/${path}`, import.meta.url), "utf-8");

test("POST /api/tasks supports convert-by-messageId and create-by-content", async () => {
  const source = await readRoute("tasks/route.ts");
  assert.match(source, /createTask\(/);
  assert.match(source, /messageId/);
  assert.match(source, /channelId/);
  assert.match(source, /sendMessage\(/);
  assert.match(source, /TaskAlreadyExistsError/);
  assert.match(source, /status: 409/);
});

test("POST /api/tasks/[id]/claim enforces freshness-hold and claim conflicts", async () => {
  const source = await readRoute("tasks/[id]/claim/route.ts");
  assert.match(source, /claimTask\(/);
  assert.match(source, /CURRENT_MEMBER_ID/);
  assert.match(source, /baseSeq/);
  assert.match(source, /result\.status === "held"/);
  assert.match(source, /result\.status === "conflict"/);
  assert.match(source, /status: 409/);
});

test("POST /api/tasks/[id]/update-status validates statuses and applies freshness-hold", async () => {
  const source = await readRoute("tasks/[id]/update-status/route.ts");
  assert.match(source, /updateTaskStatus\(/);
  assert.match(source, /TASK_STATUSES/);
  assert.match(source, /CURRENT_MEMBER_ID/);
  assert.match(source, /baseSeq/);
  assert.match(source, /result\.status === "held"/);
  assert.match(source, /status: 409/);
});

test("GET /api/channels/[id]/tasks lists the channel board", async () => {
  const source = await readRoute("channels/[id]/tasks/route.ts");
  assert.match(source, /listChannelTasks\(/);
  assert.match(source, /tasks/);
});
