import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const readRoute = (path) =>
  readFile(new URL(`../../../app/api/${path}`, import.meta.url), "utf-8");

test("GET /api/members/[id]/observability aggregates stats, task history and session info", async () => {
  const source = await readRoute("members/[id]/observability/route.ts");
  assert.match(source, /aggregateAgentUsage\(/);
  assert.match(source, /listAgentTasks\(/);
  assert.match(source, /buildAgentTimeline\(/);
  assert.match(source, /resolveSessionIdByPath\(/);
  assert.match(source, /getAgent\(/);
  assert.match(source, /AgentNotFoundError \? 404/);
  // §07：轮次记录进可观测页载荷（区分自判 ignore 与处理失败）
  assert.match(source, /listRoundLogs\(/);
  assert.match(source, /rounds:/);
  // 不落库：统计走只读解析，路由不写 协作数据
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

// ---------------------------------------------------------------------------
// D3：live 会话的模型名——get_state 的真实形状是 { id, provider }
// ---------------------------------------------------------------------------

/**
 * 路由把 `get_state` 的 model 断言成 `{provider, modelId}`，而 lib/rpc/session.ts 实际
 * 返回 `{id, provider}`（app/api/agent/new/route.ts 是正确写法）——面板因此显示
 * "new-api/—"（modelId undefined）。这里用真实路由处理器 + 假存活会话来断言载荷本身：
 * live.model.modelId 必须是真实模型 id，且载荷形状里不得残留 get_state 的原始 `id` 字段。
 */
const routeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-observability-route-"));
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { openDataDb } = await jiti.import("../../data/sqlite.ts");
globalThis.__workspliceDb = openDataDb(routeRoot);
const { createAgent } = await jiti.import("./members.ts");
const { logRoundOutcome } = await jiti.import("./rounds.ts");

const LIVE_AGENT = createAgent({
  name: "live-model",
  provider: "new-api",
  modelId: "space-bunny-free",
  thinkingLevel: "off",
});
logRoundOutcome(LIVE_AGENT.id, "chan-d3", {
  status: "error",
  reason: 'model error: 429: {"message":"Rate limit exceeded."}',
  baseSeq: 12,
});

/** 假存活会话：get_state 的 model 形状与 lib/rpc/session.ts 逐字一致（{id, provider}）。 */
globalThis.__workspliceAgentSessions = new Map([
  [
    LIVE_AGENT.id,
    {
      sessionId: "live-session",
      sessionFile: "/tmp/live-session.jsonl",
      isAlive: () => true,
      isRunning: () => false,
      onEvent: () => () => {},
      send: async (command) => {
        if (command.type !== "get_state") return null;
        return {
          model: { id: "space-bunny-free", provider: "new-api" },
          thinkingLevel: "high",
          contextUsage: null,
        };
      },
    },
  ],
]);

test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(routeRoot, { recursive: true, force: true });
});

test("runtime and observability payloads carry the live session's real modelId (D3)", async () => {
  const runtimeRoute = await jiti.import("../../../app/api/members/[id]/runtime/route.ts");
  const observabilityRoute = await jiti.import(
    "../../../app/api/members/[id]/observability/route.ts",
  );
  const params = { params: Promise.resolve({ id: LIVE_AGENT.id }) };

  const runtimeBody = await (
    await runtimeRoute.GET(new Request("http://localhost/api/members/x/runtime"), params)
  ).json();
  const observabilityBody = await (
    await observabilityRoute.GET(
      new Request("http://localhost/api/members/x/observability"),
      params,
    )
  ).json();

  assert.deepEqual(
    Object.keys(runtimeBody.live.model).sort(),
    ["modelId", "provider"],
    "载荷不得残留 get_state 的原始 {id, provider} 形状",
  );
  assert.equal(runtimeBody.live.model.modelId, "space-bunny-free", "面板要拿到真实 modelId");
  assert.equal(runtimeBody.live.model.provider, "new-api");
  assert.equal(runtimeBody.live.thinkingLevel, "high");

  assert.equal(observabilityBody.session.live.model.modelId, "space-bunny-free");
  assert.equal(observabilityBody.session.live.model.provider, "new-api");
  assert.equal(observabilityBody.session.live.thinkingLevel, "high");

  // 同一载荷里的 rounds：D2 的服务层出线形状（camelCase + 合法 ISO createdAt）已生效
  const [round] = observabilityBody.rounds;
  assert.equal(round.targetId, "chan-d3");
  assert.equal(round.baseSeq, 12);
  assert.equal(Number.isNaN(Date.parse(round.createdAt)), false);
});
