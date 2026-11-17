import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readRoute = (path) =>
  readFile(new URL(`../../../app/api/${path}`, import.meta.url), "utf-8");

test("POST /api/tasks supports convert-by-messageId and create-by-content", async () => {
  const source = await readRoute("tasks/route.ts");
  assert.match(source, /createTask\(/);
  assert.match(source, /messageId/);
  assert.match(source, /channelId/);
  assert.match(source, /sendMessage\(/);
  // 领域错误自带 status/code，route 只经 jsonError 译码（票 #277）
  assert.match(source, /jsonError\(error, 400\)/);
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

test("POST /api/tasks/[id]/update-status maps the claim edge conflict to 409 like /claim", async () => {
  // 终检整改：todo→in_progress 是 reachable 合成的 claim 边（ADR-0002）——
  // 已认领/重开封锁与 /claim 路由同语义同状态码（409 conflict/blocked），
  // 状态码由 TaskClaimConflictError 自带（票 #277），route 不再手写 kind 分支。
  const source = await readRoute("tasks/[id]/update-status/route.ts");
  assert.match(source, /jsonError\(error, 400\)/);
  assert.doesNotMatch(source, /TaskClaimConflictError/);
  assert.doesNotMatch(source, /error\.kind/);
});
