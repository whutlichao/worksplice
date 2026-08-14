import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { RpcCaller } = await jiti.import("./caller.ts");

// ---------------------------------------------------------------------------
// 行为测试：call() 委托 wrapper.send（RpcCaller 的可实例化部分）
// ---------------------------------------------------------------------------

test("RpcCaller.call delegates to the wrapper send command", async () => {
  const calls = [];
  const wrapper = {
    async send(command) {
      calls.push(command);
      return { ok: true };
    },
  };
  const caller = new RpcCaller();

  const result = await caller.call(wrapper, { type: "get_state" });

  assert.deepEqual(calls, [{ type: "get_state" }]);
  assert.deepEqual(result, { ok: true });
});

// ---------------------------------------------------------------------------
// 源码级规范守门：start() 的会话构造契约（SDK 依赖太重，无法实例化完整路径）
// ---------------------------------------------------------------------------

function startupSource() {
  return sourceOf("./caller.ts").then((source) =>
    source.slice(source.indexOf("  async start("), source.indexOf("  /** 向已获取的 wrapper"))
  );
}

function sourceOf(rel) {
  return readFile(new URL(rel, import.meta.url), "utf8");
}

test("RPC session startup preloads extension-registered providers before restoring models", async () => {
  const startup = await startupSource();

  assert.match(startup, /createAgentSessionServices\(/);
  assert.match(startup, /createAgentSessionFromServices\(/);
  assert.doesNotMatch(startup, /await createAgentSession\(/);
});

test("RPC session startup resolves and passes the SDK-native enabled model scope", async () => {
  const startup = await startupSource();
  const resolveIndex = startup.indexOf("resolveVisibleModels(");
  const createIndex = startup.indexOf("createAgentSessionFromServices(");

  assert.ok(resolveIndex >= 0);
  assert.ok(createIndex > resolveIndex);
  assert.match(startup, /selectInitialModelScope\(/);
  assert.match(startup, /scopedModels: initial\.scopedModels/);
  assert.match(startup, /model: initial\.model/);
  assert.match(startup, /thinkingLevel: initial\.thinkingLevel/);
});

test("RPC session startup treats only sessions with messages as continuing", async () => {
  const startup = await startupSource();

  assert.match(
    startup,
    /const hasExistingMessages = sessionManager\.getBranch\(\)\.some\(\(entry\) => entry\.type === "message"\)/,
  );
  assert.match(startup, /const initial = hasExistingMessages/);
  assert.doesNotMatch(startup, /const initial = sessionFile/);
  assert.doesNotMatch(startup, /sessionManager\.buildSessionContext\(\)/);
});

test("RPC session startup opens an existing session file only once and trusts its cwd", async () => {
  const startup = await startupSource();
  const routeSource = await sourceOf("../../app/api/agent/[id]/route.ts");
  const eventRouteSource = await sourceOf("../../app/api/agent/[id]/events/route.ts");
  const autoNameRouteSource = await sourceOf("../../app/api/sessions/[id]/auto-name/route.ts");

  assert.equal((startup.match(/SessionManager\.open\(/g) ?? []).length, 1);
  assert.match(startup, /const sessionCwd = sessionManager\.getCwd\(\)/);
  assert.match(startup, /projectTrustReloadOptions\(sessionCwd, agentDir\)/);
  assert.match(startup, /cwd: sessionCwd/);
  for (const route of [routeSource, eventRouteSource, autoNameRouteSource]) {
    assert.doesNotMatch(route, /SessionManager\.open\(/);
  }
});

test("RPC session startup persists explicit preferences without replaying setters", async () => {
  const startup = await startupSource();

  assert.match(startup, /persistExplicitStartupPreferences\(/);
  assert.match(startup, /modelDefaultChanged\) invalidateModelsCache\(\)/);
});

test("new-session route applies model scope during construction instead of follow-up commands", async () => {
  const source = await sourceOf("../../app/api/agent/new/route.ts");

  assert.match(source, /initialModel: \{ provider, modelId \}/);
  assert.match(source, /thinkingLevel: explicitThinkingLevel/);
  assert.doesNotMatch(source, /session\.send\(\{ type: "set_model"/);
  assert.doesNotMatch(source, /session\.send\(\{ type: "set_thinking_level"/);
  assert.match(source, /model: state\.model/);
  assert.match(source, /thinkingLevel: state\.thinkingLevel/);
});
