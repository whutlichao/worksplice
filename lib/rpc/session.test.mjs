import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { AgentSessionWrapper } = await jiti.import("./session.ts");

test("session shutdown notifies extensions before disposing the SDK session", async () => {
  const calls = [];
  const inner = {
    isBashRunning: false,
    extensionRunner: {
      async emit(event) {
        calls.push(["emit", event]);
      },
    },
    dispose() {
      calls.push(["dispose"]);
    },
  };
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.onDestroy(() => calls.push(["destroy"]));

  await Promise.all([wrapper.shutdown(), wrapper.shutdown()]);

  assert.deepEqual(calls, [
    ["emit", { type: "session_shutdown", reason: "quit" }],
    ["dispose"],
    ["destroy"],
  ]);
  assert.equal(wrapper.isAlive(), false);
});

test("session shutdown still disposes the SDK session when an extension fails", async () => {
  const calls = [];
  const inner = {
    isBashRunning: false,
    extensionRunner: {
      async emit() {
        calls.push("emit");
        throw new Error("shutdown hook failed");
      },
    },
    dispose() {
      calls.push("dispose");
    },
  };
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.onDestroy(() => calls.push("destroy"));

  await assert.rejects(wrapper.shutdown(), /shutdown hook failed/);

  assert.deepEqual(calls, ["emit", "dispose", "destroy"]);
  assert.equal(wrapper.isAlive(), false);
});

test("direct destruction disposes the SDK session before unregistering the wrapper", () => {
  const calls = [];
  const inner = {
    isBashRunning: false,
    extensionRunner: {},
    dispose() {
      calls.push("dispose");
    },
  };
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.onDestroy(() => calls.push("destroy"));

  wrapper.destroy();
  wrapper.destroy();

  assert.deepEqual(calls, ["dispose", "destroy"]);
  assert.equal(wrapper.isAlive(), false);
});

// ---------------------------------------------------------------------------
// B-2：0.84.3+ 起 SDK 的 setModel()/setThinkingLevel() 不再默认写全局
// settings.json（docs/spike-b2-persist.md §6）。RPC 分支因此显式写
// SettingsManager —— **写生效值**，不是用户请求的值，也不是 `{persist:true}`。
// ---------------------------------------------------------------------------

/** 极简 SettingsManager 替身：只记写了什么 + flush 了几次。 */
function recordingSettingsManager() {
  const writes = { model: null, thinkingLevel: null, flushes: 0 };
  return {
    writes,
    settingsManager: {
      setDefaultModelAndProvider(provider, modelId) {
        writes.model = { provider, modelId };
      },
      setDefaultThinkingLevel(level) {
        writes.thinkingLevel = level;
      },
      async flush() {
        writes.flushes += 1;
      },
    },
  };
}

/**
 * 极简 AgentSession 替身。`availableThinkingLevels` 复刻 SDK 的夹取：不在列表里
 * 的请求值被压到最高可用档（列表最后一项），写入 `agent.state.thinkingLevel`。
 */
function fakeSession({
  models = [],
  currentModel,
  availableThinkingLevels = ["off", "minimal", "low", "medium", "high"],
} = {}) {
  const settings = recordingSettingsManager();
  const inner = {
    isBashRunning: false,
    extensionRunner: {},
    dispose() {},
    model: currentModel,
    agent: { state: { thinkingLevel: "off" } },
    settingsManager: settings.settingsManager,
    modelRuntime: {
      getModel(provider, modelId) {
        return models.find((m) => m.provider === provider && m.id === modelId);
      },
      async refresh() {},
    },
    async setModel(model) {
      inner.model = model;
    },
    setThinkingLevel(level) {
      inner.agent.state.thinkingLevel = availableThinkingLevels.includes(level)
        ? level
        : availableThinkingLevels[availableThinkingLevels.length - 1];
    },
  };
  return { inner, writes: settings.writes };
}

test("set_model writes the resolved model as the global default and flushes", async () => {
  const { inner, writes } = fakeSession({
    models: [{ provider: "spike-local", id: "spike-beta" }],
    currentModel: { provider: "spike-local", id: "spike-alpha" },
  });
  const wrapper = new AgentSessionWrapper(inner);

  let result;
  try {
    result = await wrapper.send({ type: "set_model", provider: "spike-local", modelId: "spike-beta" });
  } finally {
    wrapper.destroy();
  }

  assert.deepEqual(result, { id: "spike-beta", provider: "spike-local" });
  // 生效值 = 解析出来的真实模型对象，不是命令里的入参
  assert.deepEqual(writes.model, { provider: "spike-local", modelId: "spike-beta" });
  // settings.json 是缓冲写，不 flush 不落盘（spike §6.3）
  assert.equal(writes.flushes, 1);
});

test("set_thinking_level writes the effective level to the global default", async () => {
  const { inner, writes } = fakeSession({ currentModel: { provider: "p", id: "m" } });
  const wrapper = new AgentSessionWrapper(inner);

  try {
    assert.equal(await wrapper.send({ type: "set_thinking_level", level: "high" }), null);
  } finally {
    wrapper.destroy();
  }

  assert.equal(writes.thinkingLevel, "high");
  assert.equal(writes.flushes, 1);
});

test("set_thinking_level writes the clamped level, not the requested xhigh", async () => {
  // supportsXhigh()===false 的模型：可用档止于 high，请求 xhigh 被夹成 high。
  const { inner, writes } = fakeSession({ currentModel: { provider: "p", id: "m" } });
  const wrapper = new AgentSessionWrapper(inner);

  try {
    await wrapper.send({ type: "set_thinking_level", level: "xhigh" });
  } finally {
    wrapper.destroy();
  }

  assert.equal(inner.agent.state.thinkingLevel, "high");
  // 落盘的必须是生效值 high —— 写请求值 xhigh 就是 spike §4.4 STEP 3c 实测到的那个 bug
  assert.equal(writes.thinkingLevel, "high");
  assert.notEqual(writes.thinkingLevel, "xhigh");
});

test("set_thinking_level writes xhigh after the DeepSeek compat correction pushes it back", async () => {
  // compat.thinkingFormat==="deepseek"：SDK 先把 xhigh 夹成 high，本仓随后强推回 xhigh。
  const { inner, writes } = fakeSession({
    currentModel: { provider: "deepseek", id: "v3", compat: { thinkingFormat: "deepseek" } },
  });
  const wrapper = new AgentSessionWrapper(inner);

  try {
    await wrapper.send({ type: "set_thinking_level", level: "xhigh" });
  } finally {
    wrapper.destroy();
  }

  assert.equal(inner.agent.state.thinkingLevel, "xhigh");
  // 读的是「setter + DeepSeek 修正都跑完之后」的生效值，所以是 xhigh 而不是 high
  assert.equal(writes.thinkingLevel, "xhigh");
});

// ---------------------------------------------------------------------------
// 源码级规范守门（SDK 依赖太重，无法实例化完整会话；断言保持行为契约）
// ---------------------------------------------------------------------------

test("RPC wrapper avoids per-chunk idle and running-state maintenance", async () => {
  const source = await readFile(new URL("./session.ts", import.meta.url), "utf8");
  const startSource = source.slice(
    source.indexOf("  start(): void"),
    source.indexOf("  setForceEmptySystemPrompt"),
  );

  assert.match(startSource, /IDLE_RESET_EVENT_TYPES\.has\(event\.type\)/);
  assert.match(startSource, /RUNNING_STATE_EVENT_TYPES\.has\(event\.type\)/);
  assert.doesNotMatch(startSource, /subscribe\(\(event: AgentEvent\) => \{\s*this\.resetIdleTimer\(\)/);
});

test("normal session teardown paths use graceful extension shutdown", async () => {
  const source = await readFile(new URL("./session.ts", import.meta.url), "utf8");
  const deleteRouteSource = await readFile(new URL("../../app/api/sessions/[id]/route.ts", import.meta.url), "utf8");
  const trustRouteSource = await readFile(new URL("../../app/api/project-trust/route.ts", import.meta.url), "utf8");
  const idleSource = source.slice(
    source.indexOf("  private resetIdleTimer"),
    source.indexOf("  private persistBashOnlySession"),
  );
  const forkSource = source.slice(
    source.indexOf('case "fork"'),
    source.indexOf('case "navigate_tree"'),
  );

  assert.match(idleSource, /this\.shutdown\(\)/);
  assert.match(forkSource, /await this\.shutdown\(\)/);
  assert.match(deleteRouteSource, /await getRpcSession\(id\)\?\.shutdown\(\)/);
  assert.match(trustRouteSource, /await destroyRpcSessionsForCwd\(result\.cwd\)/);
});

test("custom extension UI receives the fixed headless terminal facade", async () => {
  const source = await readFile(new URL("./session.ts", import.meta.url), "utf8");
  const customUiSource = source.slice(
    source.indexOf("private requestExtensionCustomUi"),
    source.indexOf("private requestExtensionUi"),
  );

  assert.match(customUiSource, /createHeadlessCustomUiTui\(/);
  assert.match(customUiSource, /width,/);
});

test("reloading a session invalidates the models cache", async () => {
  const source = await readFile(new URL("./session.ts", import.meta.url), "utf8");
  const reloadSource = source.slice(
    source.indexOf('case "reload"'),
    source.indexOf('case "abort_compaction"'),
  );

  assert.match(reloadSource, /await this\.inner\.reload\(\)/);
  assert.match(reloadSource, /this\.applyForcedEmptySystemPrompt\(\);\s*invalidateModelsCache\(\)/);
});
