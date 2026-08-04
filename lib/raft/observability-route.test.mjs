import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readRoute = (path) =>
  readFile(new URL(`../../app/api/${path}`, import.meta.url), "utf-8");

test("GET /api/members/[id]/observability aggregates stats, task history and session info", async () => {
  const source = await readRoute("members/[id]/observability/route.ts");
  assert.match(source, /aggregateAgentUsage\(/);
  assert.match(source, /listAgentTasks\(/);
  assert.match(source, /buildAgentTimeline\(/);
  assert.match(source, /resolveSessionIdByPath\(/);
  assert.match(source, /getAgent\(/);
  assert.match(source, /AgentNotFoundError \? 404/);
  // 不落库：统计走只读解析，路由不写 raft 数据
  assert.doesNotMatch(source, /insertMessage|insertTask|setMemberModel/);
});

test("PATCH /api/members/[id]/runtime persists overrides and applies to a live session", async () => {
  const source = await readRoute("members/[id]/runtime/route.ts");
  assert.match(source, /setAgentRuntimeConfig\(/);
  assert.match(source, /set_model/);
  assert.match(source, /set_thinking_level/);
  assert.match(source, /export async function PATCH/);
  assert.match(source, /getAgentRuntime\(/);
});

test("skills routes fall back to the process cwd when cwd is omitted (global panel)", async () => {
  const list = await readRoute("skills/route.ts");
  const check = await readRoute("skills/check/route.ts");
  const update = await readRoute("skills/update/route.ts");
  const install = await readRoute("skills/install/route.ts");
  for (const source of [list, check, update, install]) {
    assert.match(source, /process\.cwd\(\)/);
  }
});
