import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createJiti } from "jiti";

/**
 * 恢复服务层（`lib/agent-recovery.ts`）的判定层矩阵 + 服务层路径 + 路由源码级断言。
 * 临时数据目录 + fake AgentRuntime + fake 探测：零真实凭证、零网络。
 * 默认探测（`createModelProbe`）的解析路径另用隔离 agentDir 验证——见文件末尾。
 *
 * 被测模块经 jiti 加载：默认探测会动态加载与会话启动同一条解析路径
 *（`lib/model-listing.ts` 里是 bundler 风格的无扩展名 import），取法与
 * `lib/model-listing.test.mjs` 一致；数据层与全局状态仍经 globalThis 共享。
 */
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-recovery-"));
const { openDataDb } = await jiti.import("./data/sqlite.ts");
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const {
  createModelProbe,
  probeVerdictStatus,
  saveAgentRuntime,
  shouldProbeOnRuntimeSave,
  shouldPublishProbeVerdict,
} = await jiti.import("./agent-recovery.ts");
const { createAgent, getAgent, normalizeWorkspacePath, setAgentRuntimeConfig } = await jiti.import(
  "./domain/collab/members.ts"
);
const { publishAgentStatus } = await jiti.import("./agent-status.ts");

function freshWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-recovery-ws-"));
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeFakeRuntime() {
  const sessions = new Map();
  const sent = [];
  return {
    sessions,
    sent,
    startCalls: 0,
    findSession: (member) => sessions.get(member.id),
    findBusySessionForCwd: () => undefined,
    async startSession() {
      this.startCalls += 1;
      throw new Error("the recovery path must not start a session (决策 6：纯探测)");
    },
    async destroySession() {},
    async removeSessionFilesForCwd() {},
    makeSession(alive = true) {
      return {
        isAlive: () => alive,
        send: async (command) => {
          sent.push(command);
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 判定层：纯函数矩阵
// ---------------------------------------------------------------------------

test("trigger predicate: probe only when an override pair exists AND the agent was in error (4 cells)", () => {
  assert.equal(
    shouldProbeOnRuntimeSave({ statusBeforeSave: "error", hasOverrideAfterSave: true }),
    true,
  );
  // 清空覆盖 / 继承全局：不触发（决策 1 第 2 轮裁定 (a)）
  assert.equal(
    shouldProbeOnRuntimeSave({ statusBeforeSave: "error", hasOverrideAfterSave: false }),
    false,
  );
  // 非出错语境：任何保存都不触发（决策 1）
  assert.equal(
    shouldProbeOnRuntimeSave({ statusBeforeSave: "online", hasOverrideAfterSave: true }),
    false,
  );
  assert.equal(
    shouldProbeOnRuntimeSave({ statusBeforeSave: "offline", hasOverrideAfterSave: true }),
    false,
  );
  assert.equal(
    shouldProbeOnRuntimeSave({ statusBeforeSave: "working", hasOverrideAfterSave: true }),
    false,
  );
  assert.equal(
    shouldProbeOnRuntimeSave({ statusBeforeSave: "online", hasOverrideAfterSave: false }),
    false,
  );
});

test("verdict mapping: ok + live session → online, ok + dead session → offline, failure → no write", () => {
  assert.equal(probeVerdictStatus({ ok: true }, true), "online");
  assert.equal(probeVerdictStatus({ ok: true }, false), "offline");
  assert.equal(probeVerdictStatus({ ok: false }, true), null);
  assert.equal(probeVerdictStatus({ ok: false }, false), null);
});

test("publish gate: both prerequisites must hold (4 cells)", () => {
  const probedModel = { provider: "zenmux", modelId: "sonnet" };
  const sameModel = { provider: "zenmux", modelId: "sonnet" };
  assert.equal(
    shouldPublishProbeVerdict({ probedModel, currentModel: sameModel, currentStatus: "error" }),
    true,
  );
  // 模型已被改（结论过期）
  assert.equal(
    shouldPublishProbeVerdict({
      probedModel,
      currentModel: { provider: "zenmux", modelId: "other" },
      currentStatus: "error",
    }),
    false,
  );
  // 状态已被别的事件接管
  assert.equal(
    shouldPublishProbeVerdict({ probedModel, currentModel: sameModel, currentStatus: "online" }),
    false,
  );
  // 覆盖被清空 + 状态已接管
  assert.equal(
    shouldPublishProbeVerdict({ probedModel, currentModel: null, currentStatus: "working" }),
    false,
  );
  assert.equal(
    shouldPublishProbeVerdict({ probedModel, currentModel: null, currentStatus: "error" }),
    false,
  );
});

test("MemberStatus stays a four-literal union (no fifth state)", async () => {
  const source = await readFile(new URL("./data/types.ts", import.meta.url), "utf-8");
  assert.match(
    source,
    /export type MemberStatus = "online" \| "working" \| "error" \| "offline";/,
  );
});

// ---------------------------------------------------------------------------
// 服务层：三条路径 + 反向断言 + 不回滚
// ---------------------------------------------------------------------------

test("error → online: a passing probe on a live session clears the error", async () => {
  const workspace = freshWorkspace();
  const agent = createAgent({ name: "recovery-online", workspacePath: workspace });
  publishAgentStatus(agent.id, "error");
  const runtime = makeFakeRuntime();
  runtime.sessions.set(agent.id, runtime.makeSession(true));
  const calls = [];
  const probe = async (target) => {
    calls.push(target);
    return { ok: true, latencyMs: 5, status: 200 };
  };

  const result = await saveAgentRuntime(
    agent.id,
    { provider: "zenmux", modelId: "sonnet", thinkingLevel: "high" },
    { runtime, probe },
  );

  assert.deepEqual(result.probe, { attempted: true, ok: true, latencyMs: 5 });
  assert.equal(result.agent.model_provider, "zenmux");
  assert.equal(result.agent.model_id, "sonnet");
  assert.equal(result.agent.thinking_level, "high");
  assert.equal(getAgent(agent.id).status, "online");
  // 探测参数与会话启动路径同源：cwd = 该成员工作区，模型 = 刚保存的覆盖对
  assert.deepEqual(calls, [
    {
      agentId: agent.id,
      cwd: normalizeWorkspacePath(workspace),
      provider: "zenmux",
      modelId: "sonnet",
    },
  ]);
  assert.equal(runtime.startCalls, 0, "纯探测：不建会话、不预热");
});

test("the status point stays unchanged while the probe is in flight (no optimistic clear, no fifth state)", async () => {
  const agent = createAgent({ name: "recovery-inflight", workspacePath: freshWorkspace() });
  publishAgentStatus(agent.id, "error");
  const runtime = makeFakeRuntime();
  runtime.sessions.set(agent.id, runtime.makeSession(true));
  let duringProbe = null;

  const result = await saveAgentRuntime(
    agent.id,
    { provider: "zenmux", modelId: "sonnet" },
    {
      runtime,
      probe: async () => {
        duringProbe = getAgent(agent.id).status;
        return { ok: true };
      },
    },
  );

  assert.equal(duringProbe, "error", "探测期间状态点保持不变（不做乐观写作）");
  assert.notEqual(duringProbe, "working", "探测不复用 working（那会被现场推导改写成假绿）");
  assert.deepEqual(result.probe, { attempted: true, ok: true });
  assert.equal(getAgent(agent.id).status, "online", "结论只在探测之后落点");
});

test("error → offline: a passing probe without a live session clears the error honestly", async () => {
  const agent = createAgent({ name: "recovery-offline", workspacePath: freshWorkspace() });
  publishAgentStatus(agent.id, "error");
  const runtime = makeFakeRuntime(); // 会话已被 idle shutdown / 进程重启关掉
  const probe = async () => ({ ok: true, latencyMs: 7 });

  const result = await saveAgentRuntime(
    agent.id,
    { provider: "zenmux", modelId: "sonnet" },
    { runtime, probe },
  );

  assert.deepEqual(result.probe, { attempted: true, ok: true, latencyMs: 7 });
  assert.equal(getAgent(agent.id).status, "offline");
  assert.equal(runtime.sessions.get(agent.id), undefined);
});

test("a failing probe keeps the error, returns the reason, and never rolls back the override", async () => {
  const agent = createAgent({ name: "recovery-failed", workspacePath: freshWorkspace() });
  publishAgentStatus(agent.id, "error");
  const runtime = makeFakeRuntime();
  runtime.sessions.set(agent.id, runtime.makeSession(true));
  const probe = async () => ({ ok: false, error: "402 insufficient quota", latencyMs: 12 });

  const result = await saveAgentRuntime(
    agent.id,
    { provider: "zenmux", modelId: "sonnet" },
    { runtime, probe },
  );

  assert.deepEqual(result.probe, {
    attempted: true,
    ok: false,
    error: "402 insufficient quota",
    latencyMs: 12,
  });
  assert.equal(getAgent(agent.id).status, "error", "不通过 ⇒ 状态点不动、保持出错");
  assert.equal(getAgent(agent.id).model_provider, "zenmux", "覆盖记录用户意图，探测失败不回滚");
  assert.equal(getAgent(agent.id).model_id, "sonnet");
});

test("a save on a non-error agent never probes (reverse assertion)", async () => {
  const agent = createAgent({ name: "recovery-quiet", workspacePath: freshWorkspace() });
  const runtime = makeFakeRuntime();
  let calls = 0;
  const probe = async () => {
    calls += 1;
    return { ok: true };
  };

  const online = await saveAgentRuntime(
    agent.id,
    { provider: "zenmux", modelId: "sonnet" },
    { runtime, probe },
  );
  assert.deepEqual(online.probe, { attempted: false });
  assert.equal(calls, 0, "未出错时探测调用次数为 0");

  const thinkingOnly = await saveAgentRuntime(
    agent.id,
    { thinkingLevel: "low" },
    { runtime, probe },
  );
  assert.deepEqual(thinkingOnly.probe, { attempted: false });
  assert.equal(calls, 0);
  assert.equal(getAgent(agent.id).thinking_level, "low");
});

test("clearing the override on an error agent does not probe and clears the pair", async () => {
  const agent = createAgent({
    name: "recovery-clear",
    workspacePath: freshWorkspace(),
    provider: "zenmux",
    modelId: "sonnet",
  });
  publishAgentStatus(agent.id, "error");
  const runtime = makeFakeRuntime();
  let calls = 0;

  const result = await saveAgentRuntime(
    agent.id,
    { provider: null, modelId: null },
    { runtime, probe: async () => (calls += 1, { ok: true }) },
  );

  assert.deepEqual(result.probe, { attempted: false });
  assert.equal(calls, 0, "清空覆盖不触发（决策 1）");
  assert.equal(result.agent.model_provider, null);
  assert.equal(result.agent.model_id, null);
  assert.equal(getAgent(agent.id).status, "error", "清空不是恢复动作，红点不动");
});

test("an error agent re-checks on a thinking-only save (零新增 UI 的复检入口)", async () => {
  const agent = createAgent({
    name: "recovery-recheck",
    workspacePath: freshWorkspace(),
    provider: "zenmux",
    modelId: "sonnet",
  });
  publishAgentStatus(agent.id, "error");
  const runtime = makeFakeRuntime();
  const calls = [];

  const result = await saveAgentRuntime(
    agent.id,
    { thinkingLevel: "medium" },
    { runtime, probe: async (target) => (calls.push(target), { ok: true }) },
  );

  assert.deepEqual(result.probe, { attempted: true, ok: true });
  assert.deepEqual(calls[0], {
    agentId: agent.id,
    cwd: normalizeWorkspacePath(getAgent(agent.id).workspace_path),
    provider: "zenmux",
    modelId: "sonnet",
  });
  assert.equal(getAgent(agent.id).status, "offline");
});

test("lifecycle behavior preserved: a live session receives set_model before the override is persisted", async () => {
  const agent = createAgent({ name: "recovery-live", workspacePath: freshWorkspace() });
  const runtime = makeFakeRuntime();
  runtime.sessions.set(agent.id, runtime.makeSession(true));

  await saveAgentRuntime(
    agent.id,
    { provider: "zenmux", modelId: "sonnet", thinkingLevel: "high" },
    { runtime, probe: async () => ({ ok: true }) },
  );

  assert.deepEqual(runtime.sent, [
    { type: "set_model", provider: "zenmux", modelId: "sonnet" },
    { type: "set_thinking_level", level: "high" },
  ]);
});

// ---------------------------------------------------------------------------
// 服务层：并发（同成员 FIFO 串行 / 不同成员互不阻塞）
// ---------------------------------------------------------------------------

test("same agent: probes run FIFO and only the newest verdict is applied", async () => {
  const agent = createAgent({ name: "recovery-fifo", workspacePath: freshWorkspace() });
  publishAgentStatus(agent.id, "error");
  const runtime = makeFakeRuntime();
  const events = [];
  const gates = new Map();
  const probe = async (target) => {
    events.push(`start:${target.modelId}`);
    const gate = deferred();
    gates.set(target.modelId, gate);
    await gate.promise;
    events.push(`end:${target.modelId}`);
    return { ok: true };
  };

  const first = saveAgentRuntime(
    agent.id,
    { provider: "zenmux", modelId: "model-a" },
    { runtime, probe },
  );
  const second = saveAgentRuntime(
    agent.id,
    { provider: "zenmux", modelId: "model-b" },
    { runtime, probe },
  );

  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(events, ["start:model-a"], "第二次探测必须排在第一次之后");

  gates.get("model-a").resolve();
  const firstResult = await first;
  assert.equal(firstResult.probe.superseded, true, "模型已换成 model-b ⇒ 结论过期，不写状态点");
  assert.equal(getAgent(agent.id).status, "error");

  // 第二个探测排到队首后自行开始，再放行
  await new Promise((r) => setTimeout(r, 10));
  gates.get("model-b").resolve();
  const secondResult = await second;
  assert.deepEqual(secondResult.probe, { attempted: true, ok: true });
  assert.deepEqual(events, ["start:model-a", "end:model-a", "start:model-b", "end:model-b"]);
  assert.equal(getAgent(agent.id).status, "offline", "只有最新结论生效");
});

test("different agents: a probe in flight does not block another agent's probe", async () => {
  const first = createAgent({ name: "recovery-par-a", workspacePath: freshWorkspace() });
  const second = createAgent({ name: "recovery-par-b", workspacePath: freshWorkspace() });
  publishAgentStatus(first.id, "error");
  publishAgentStatus(second.id, "error");
  const runtime = makeFakeRuntime();
  const events = [];
  const gate = deferred();
  const probe = async (target) => {
    events.push(`start:${target.agentId}`);
    if (target.agentId === first.id) await gate.promise;
    events.push(`end:${target.agentId}`);
    return { ok: true };
  };

  const hanging = saveAgentRuntime(
    first.id,
    { provider: "zenmux", modelId: "m" },
    { runtime, probe },
  );
  const other = saveAgentRuntime(
    second.id,
    { provider: "zenmux", modelId: "m" },
    { runtime, probe },
  );

  const otherResult = await other;
  assert.deepEqual(otherResult.probe, { attempted: true, ok: true });
  assert.deepEqual(events, [`start:${first.id}`, `start:${second.id}`, `end:${second.id}`]);
  assert.equal(getAgent(second.id).status, "offline");

  gate.resolve();
  await hanging;
  assert.equal(getAgent(first.id).status, "offline");
});

test("publish gate: a status takeover during the probe leaves the status alone", async () => {
  const agent = createAgent({ name: "recovery-takeover", workspacePath: freshWorkspace() });
  publishAgentStatus(agent.id, "error");
  const runtime = makeFakeRuntime();

  const result = await saveAgentRuntime(
    agent.id,
    { provider: "zenmux", modelId: "sonnet" },
    {
      runtime,
      probe: async () => {
        publishAgentStatus(agent.id, "working"); // 探测期间起了一轮：该轮事件更权威
        return { ok: true };
      },
    },
  );

  assert.equal(result.probe.superseded, true);
  assert.equal(getAgent(agent.id).status, "working");
});

test("publish gate: a newer override during the probe supersedes the verdict", async () => {
  const agent = createAgent({ name: "recovery-supersede", workspacePath: freshWorkspace() });
  publishAgentStatus(agent.id, "error");
  const runtime = makeFakeRuntime();

  const result = await saveAgentRuntime(
    agent.id,
    { provider: "zenmux", modelId: "sonnet" },
    {
      runtime,
      probe: async () => {
        setAgentRuntimeConfig(agent.id, { modelProvider: "zenmux", modelId: "haiku" });
        return { ok: true };
      },
    },
  );

  assert.equal(result.probe.superseded, true);
  assert.equal(getAgent(agent.id).status, "error");
  assert.equal(getAgent(agent.id).model_id, "haiku");
});

// ---------------------------------------------------------------------------
// 默认探测：与会话启动同一条解析路径 + fail-closed
// ---------------------------------------------------------------------------

function makeAgentDir(modelsJson, settings = {}) {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-recovery-agent-"));
  fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify(settings));
  fs.writeFileSync(path.join(agentDir, "auth.json"), "{}");
  fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify(modelsJson));
  return agentDir;
}

const PROBE_MODEL = { id: "probe-alpha", name: "Probe Alpha", reasoning: false };
// 自定义 provider + 字面占位 apiKey：零真实凭证、零网络（最小调用由注入的 completer 承担）。
const PROBE_MODELS_JSON = {
  providers: {
    "probe-local": {
      baseUrl: "http://127.0.0.1:9/v1",
      api: "openai-completions",
      apiKey: "probe-placeholder-not-a-real-key",
      models: [PROBE_MODEL],
    },
  },
};

test("the default probe resolves through the session-startup path and fails closed out of scope", async () => {
  const cwd = freshWorkspace();
  const agentDir = makeAgentDir(PROBE_MODELS_JSON);
  let calls = 0;
  const complete = async () => {
    calls += 1;
    return { stopReason: "end", content: [{ type: "text", text: "OK" }] };
  };
  const probe = createModelProbe({ agentDir, complete });

  // 模型不存在 / 越出可见作用域 ⇒ 不发出探测调用（fail-closed）
  const missing = await probe({
    agentId: "agent-x",
    cwd,
    provider: "probe-local",
    modelId: "not-a-model",
  });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /not available in the enabled scope/);
  assert.equal(calls, 0, "解析失败不发出探测调用");

  // 未绑定工作区 ⇒ 同样不发出调用
  const unbound = await probe({ agentId: "agent-x", cwd: "", provider: "probe-local", modelId: "probe-alpha" });
  assert.equal(unbound.ok, false);
  assert.match(unbound.error, /workspace/i);
  assert.equal(calls, 0);

  // 可见模型命中 ⇒ 恰好一次最小调用，结论直通内核
  const ok = await probe({
    agentId: "agent-x",
    cwd,
    provider: "probe-local",
    modelId: "probe-alpha",
  });
  assert.equal(calls, 1);
  assert.equal(ok.ok, true);
  assert.equal(ok.responseText, "OK");
});

test("the default probe honours the enabledModels scope shared with session startup", async () => {
  // 决策 5 第二半：「下次启动能不能解析到它」——作用域内的模型才发探测，作用域外的 fail-closed。
  const cwd = freshWorkspace();
  const agentDir = makeAgentDir(
    {
      providers: {
        ...PROBE_MODELS_JSON.providers,
        "probe-local": {
          ...PROBE_MODELS_JSON.providers["probe-local"],
          models: [PROBE_MODEL, { id: "probe-beta", name: "Probe Beta", reasoning: false }],
        },
      },
    },
    { enabledModels: ["probe-local/probe-beta"] },
  );
  let calls = 0;
  const probe = createModelProbe({
    agentDir,
    complete: async () => {
      calls += 1;
      return { stopReason: "end", content: [{ type: "text", text: "OK" }] };
    },
  });

  const outOfScope = await probe({
    agentId: "agent-x",
    cwd,
    provider: "probe-local",
    modelId: "probe-alpha",
  });
  assert.equal(outOfScope.ok, false);
  assert.match(outOfScope.error, /not available in the enabled scope/);
  assert.equal(calls, 0, "越出可见作用域 ⇒ 不发出探测调用");

  const inScope = await probe({
    agentId: "agent-x",
    cwd,
    provider: "probe-local",
    modelId: "probe-beta",
  });
  assert.equal(inScope.ok, true);
  assert.equal(calls, 1);
});

test("the default probe shares the session-startup scope gate (loadModelListingServices → resolveVisibleModels → selectInitialModelScope)", async () => {
  // 行为证据在上面两个用例（真实 ModelRuntime + 隔离 agentDir）；这里只钉两条路径用的是同一组判定：
  // 启动路径（lib/rpc/caller.ts）与探测路径都必须经 resolveVisibleModels + selectInitialModelScope。
  const recovery = await readFile(new URL("./agent-recovery.ts", import.meta.url), "utf-8");
  const caller = await readFile(new URL("./rpc/caller.ts", import.meta.url), "utf-8");
  for (const source of [recovery, caller]) {
    assert.match(source, /resolveVisibleModels/);
    assert.match(source, /selectInitialModelScope/);
  }
  assert.match(recovery, /loadModelListingServices/);
});

test("the probe kernel stays out of status and DB (发布口唯一：状态写入只经 publishAgentStatus)", async () => {
  // 只能靠不存在性证明：探测内核不碰状态、不碰 DB，恢复服务不直接写状态（发布口唯一）。
  const kernel = await readFile(new URL("./model-probe.ts", import.meta.url), "utf-8");
  const recovery = await readFile(new URL("./agent-recovery.ts", import.meta.url), "utf-8");
  assert.doesNotMatch(kernel, /agent-status/);
  assert.doesNotMatch(kernel, /domain\/collab/);
  assert.doesNotMatch(kernel, /publishAgentStatus|getDb/);
  assert.doesNotMatch(recovery, /setAgentStatus\(/);
});

// ---------------------------------------------------------------------------
// 路由源码级断言
// ---------------------------------------------------------------------------

test("PATCH /api/members/[id]/runtime delegates to the recovery service and returns the verdict", async () => {
  const source = await readFile(
    new URL("../app/api/members/[id]/runtime/route.ts", import.meta.url),
    "utf-8",
  );

  // 经服务层：路由不内联探测，也不自己持久化
  assert.match(source, /saveAgentRuntime\(/);
  assert.doesNotMatch(source, /completeSimple/);
  assert.doesNotMatch(source, /setAgentRuntimeConfig/);
  assert.doesNotMatch(source, /type: "set_model"/);
  assert.doesNotMatch(source, /publishAgentStatus/);
  // 结论写进响应
  assert.match(source, /NextResponse\.json\(result\)|NextResponse\.json\([^)]*probe/);
  // 错误映射保持：未知成员 → 404，其余 → 400
  assert.match(source, /AgentNotFoundError/);
  assert.match(source, /404/);
  assert.match(source, /400/);
  // GET 不变
  assert.match(source, /configured/);
  assert.match(source, /live/);
  assert.match(source, /get_state/);
});

test("the recovery service is the single place that decides trigger, serialization and publication", async () => {
  // 行为覆盖在三条路径 / FIFO / 发布前置的用例里；这里只证明串行链真的挂在 globalThis
  //（热重载安全约定，取法与 cwd-mutex.test.mjs 同：断言实例而非源码）。
  const agent = createAgent({ name: "recovery-locks", workspacePath: freshWorkspace() });
  publishAgentStatus(agent.id, "error");
  const runtime = makeFakeRuntime();
  await saveAgentRuntime(
    agent.id,
    { provider: "zenmux", modelId: "sonnet" },
    { runtime, probe: async () => ({ ok: true }) },
  );
  assert.ok(globalThis.__workspliceProbeLocks instanceof Map);
});