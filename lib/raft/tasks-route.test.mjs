import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readRoute = (path) =>
  readFile(new URL(`../../app/api/${path}`, import.meta.url), "utf-8");

test("POST /api/tasks/[id]/update-status maps the claim edge conflict to 409 like /claim", async () => {
  // 终检整改：todo→in_progress 是 reachable 合成的 claim 边（ADR-0002）——
  // 已认领/重开封锁与 /claim 路由同语义同状态码（409 conflict/blocked），
  // 其余非法转移/越权保持 400。
  const source = await readRoute("tasks/[id]/update-status/route.ts");
  assert.match(source, /TaskClaimConflictError/);
  assert.match(source, /error\.kind === "blocked"/);
  assert.match(source, /conflict: true/);
  assert.match(source, /status: 409/);
  assert.match(source, /updateTaskStatus\(/);
});
