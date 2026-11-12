import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// 判定层（`lib/pi-env-status.ts`）：两档故障（P1 未初始化 / P2 无可用凭证）的纯逻辑判据。
//
// 只测外部行为——给定一份观测（目录态 + settings 面读数 + 模型面读数）得出哪一档，
// 以及「现算一次」这条编排路径在真实环境下的产物。不断言内部调用顺序之外的实现细节。
//
// 两档判据的裁决记录（issue #226 的 Answer）：P1(d) 从票面的「settings 读出为空」收窄为
// 「settings 读出为空 **且** settings.json 从未被写过」。理由与实测见模块头注释。
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { judgePiEnv, readPiEnvStatus } = await jiti.import("./pi-env-status.ts");
const { createPiEnvProbes } = await jiti.import("./pi-env-probe.ts");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-pi-env-status-"));
test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

let seq = 0;
function tmpDir() {
  const dir = path.join(root, `d${seq++}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** settings 面的三种读数：空 / 有默认模型 / 读取抛错。 */
const SETTINGS_EMPTY = {
  defaultProvider: null,
  defaultModel: null,
  enabledModels: null,
  error: null,
};
const SETTINGS_CONFIGURED = {
  defaultProvider: "deepseek",
  defaultModel: "deepseek-chat",
  enabledModels: null,
  error: null,
};
const SETTINGS_UNREADABLE = {
  defaultProvider: null,
  defaultModel: null,
  enabledModels: null,
  error: "Unexpected token } in JSON at position 2",
};

/** 模型面的三种读数：无模型 / 有模型但 provider 全未配置凭证 / 有模型且带凭证。 */
const MODELS_NONE = { available: 0, configuredProviders: 0 };
const MODELS_UNCONFIGURED = { available: 2, configuredProviders: 0 };
const MODELS_USABLE = { available: 2, configuredProviders: 1 };

function observe(overrides = {}) {
  return {
    dir: "ok",
    settingsFileExists: true,
    settings: SETTINGS_EMPTY,
    models: null,
    ...overrides,
  };
}

// ── P1 五条（票面判据 a–d + 正常环境） ────────────────────────────────────────

test("P1(a) 目标目录缺失 ⇒ 未初始化", () => {
  assert.deepEqual(judgePiEnv(observe({ dir: "missing", settingsFileExists: false })), {
    finding: "uninitialized",
    reason: "agent-dir-missing",
  });
});

test("P1(b) 目标目录不可读 ⇒ 未初始化", () => {
  assert.deepEqual(judgePiEnv(observe({ dir: "unreadable" })), {
    finding: "uninitialized",
    reason: "agent-dir-unreadable",
  });
});

test("P1(c) settings 读取抛错 ⇒ 未初始化", () => {
  assert.deepEqual(judgePiEnv(observe({ settings: SETTINGS_UNREADABLE })), {
    finding: "uninitialized",
    reason: "settings-unreadable",
  });
});

test("P1(d) 空目录：settings 读出为空且 settings.json 从未写过 ⇒ 未初始化", () => {
  assert.deepEqual(
    judgePiEnv(observe({ settingsFileExists: false, models: MODELS_NONE })),
    { finding: "uninitialized", reason: "settings-unwritten" },
  );
});

test("正常环境：settings 读出默认模型且模型面可用 ⇒ 无结论", () => {
  assert.deepEqual(judgePiEnv(observe({ settings: SETTINGS_CONFIGURED, models: MODELS_USABLE })), {
    finding: null,
    reason: null,
  });
});

// ── P1(d) 的收窄（裁决 A）：初始化骨架之后不再是「未初始化」 ──────────────────

test("P1(d) 不误伤初始化后的骨架：settings 读出为空但 settings.json 在 ⇒ 不是 P1", () => {
  // 初始化动作写下的骨架 `settings.json = {}` 与空目录的 settings 读数逐字相同，
  // 所以「读出来的状态」本身不足以区分「没建起来」与「建好了但还没配」；
  // 这条分支把后者交给模型面判（P2）。删掉 settingsFileExists 这一条，本用例必红。
  assert.deepEqual(
    judgePiEnv(observe({ settingsFileExists: true, models: MODELS_NONE })),
    { finding: "no-credentials", reason: "no-credentials" },
  );
});

test("P1(d) 不因骨架文件缺失误报：settings 有默认模型时不判 P1（反例：auth.json 在、models.json 不在）", () => {
  assert.deepEqual(
    judgePiEnv(observe({ settings: SETTINGS_CONFIGURED, models: MODELS_USABLE })),
    { finding: null, reason: null },
  );
});

// ── P2 三条（含环境变量凭证这条反例） ────────────────────────────────────────

test("P2 模型面空列表 ⇒ 无可用凭证", () => {
  assert.deepEqual(judgePiEnv(observe({ settings: SETTINGS_CONFIGURED, models: MODELS_NONE })), {
    finding: "no-credentials",
    reason: "no-credentials",
  });
});

test("P2 模型列表里的 provider 全未配置凭证 ⇒ 无可用凭证", () => {
  assert.deepEqual(
    judgePiEnv(observe({ settings: SETTINGS_CONFIGURED, models: MODELS_UNCONFIGURED })),
    { finding: "no-credentials", reason: "no-credentials" },
  );
});

test("P2 反例：凭证来自环境变量（有模型且带凭证）⇒ 不判无可用凭证", () => {
  assert.deepEqual(
    judgePiEnv(observe({ settings: SETTINGS_CONFIGURED, models: MODELS_USABLE })),
    { finding: null, reason: null },
  );
});

// ── 优先级三条 ──────────────────────────────────────────────────────────────

test("优先级：P1 与 P2 同时成立 ⇒ 只出 P1", () => {
  assert.deepEqual(
    judgePiEnv(observe({ settingsFileExists: false, models: MODELS_NONE })),
    { finding: "uninitialized", reason: "settings-unwritten" },
  );
});

test("优先级：P1 不成立且 P2 成立 ⇒ 只出 P2", () => {
  assert.deepEqual(
    judgePiEnv(observe({ settings: SETTINGS_CONFIGURED, models: MODELS_NONE })),
    { finding: "no-credentials", reason: "no-credentials" },
  );
});

test("优先级：两档都不成立 ⇒ 无结论（提示面渲染 null）", () => {
  assert.deepEqual(
    judgePiEnv(observe({ settings: SETTINGS_CONFIGURED, models: MODELS_USABLE })),
    { finding: null, reason: null },
  );
});

// ── 编排路径：现算一次 + P1 短路（不碰模型面） ───────────────────────────────

function spyProbes(options = {}) {
  const { models = MODELS_USABLE, ...overrides } = options;
  const calls = { inspectAgentDir: 0, settingsFileExists: 0, readSettings: 0, probeModels: 0 };
  const probes = {
    inspectAgentDir: () => {
      calls.inspectAgentDir += 1;
      return "ok";
    },
    settingsFileExists: () => {
      calls.settingsFileExists += 1;
      return true;
    },
    readSettings: () => {
      calls.readSettings += 1;
      return SETTINGS_CONFIGURED;
    },
    probeModels: async () => {
      calls.probeModels += 1;
      return models;
    },
    ...overrides,
  };
  return { probes, calls };
}

test("编排：P1 成立时一次都不探模型面（检测不写盘的前提）", async () => {
  const { probes, calls } = spyProbes({ inspectAgentDir: () => "missing" });
  const status = await readPiEnvStatus("/tmp/whatever", probes);
  assert.equal(status.finding, "uninitialized");
  assert.equal(calls.probeModels, 0);
});

test("编排：P1 不成立时才探模型面并落到 P2", async () => {
  const { probes, calls } = spyProbes({ models: MODELS_NONE });
  const status = await readPiEnvStatus("/tmp/whatever", probes);
  assert.equal(calls.probeModels, 1);
  assert.deepEqual(status, {
    agentDir: "/tmp/whatever",
    finding: "no-credentials",
    reason: "no-credentials",
  });
});

// ── 真实 SDK 适配器：空目录那条（最承重） ───────────────────────────────────

test("真实环境：空目录 ⇒ 未初始化，且判定跑完目录仍为空（检测不改环境）", async () => {
  const agentDir = tmpDir();
  const cwd = tmpDir();
  const status = await readPiEnvStatus(agentDir, createPiEnvProbes(cwd));
  assert.equal(status.finding, "uninitialized");
  assert.equal(status.reason, "settings-unwritten");
  // 承重断言：P1 路径一次都不碰模型面 —— 否则 SDK 会在这里补建
  // auth.json / models-store.json 两个空壳，「检测」本身就把环境改了。
  assert.deepEqual(fs.readdirSync(agentDir), []);
});

test("真实环境：写入初始化骨架后不再是未初始化（settings 空、无凭证 ⇒ P2）", async () => {
  const agentDir = tmpDir();
  const cwd = tmpDir();
  // 无任何 provider 的环境变量凭证，P2 才是确定结论；用完恢复现场。
  const savedKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    fs.writeFileSync(path.join(agentDir, "settings.json"), "{}\n");
    const status = await readPiEnvStatus(agentDir, createPiEnvProbes(cwd));
    assert.equal(status.finding, "no-credentials");
    assert.equal(status.reason, "no-credentials");
  } finally {
    if (savedKey !== undefined) process.env.DEEPSEEK_API_KEY = savedKey;
  }
});

test("真实环境：损坏的 settings.json ⇒ 未初始化（读抛错那条）", async () => {
  const agentDir = tmpDir();
  const cwd = tmpDir();
  fs.writeFileSync(path.join(agentDir, "settings.json"), "{ not json");
  const status = await readPiEnvStatus(agentDir, createPiEnvProbes(cwd));
  assert.equal(status.finding, "uninitialized");
  assert.equal(status.reason, "settings-unreadable");
});

test("真实环境：不可读目录 ⇒ 未初始化（目录不可读那条）", async () => {
  const agentDir = tmpDir();
  const cwd = tmpDir();
  fs.chmodSync(agentDir, 0o000);
  try {
    const status = await readPiEnvStatus(agentDir, createPiEnvProbes(cwd));
    assert.equal(status.finding, "uninitialized");
    assert.equal(status.reason, "agent-dir-unreadable");
  } finally {
    fs.chmodSync(agentDir, 0o755);
  }
});

test("真实环境：目录缺失 ⇒ 未初始化（目录缺失那条）", async () => {
  const agentDir = path.join(tmpDir(), "absent");
  const cwd = tmpDir();
  const status = await readPiEnvStatus(agentDir, createPiEnvProbes(cwd));
  assert.equal(status.finding, "uninitialized");
  assert.equal(status.reason, "agent-dir-missing");
});

test("真实环境：环境变量里的凭证算凭证（不判 P2）", async () => {
  const agentDir = tmpDir();
  const cwd = tmpDir();
  fs.writeFileSync(path.join(agentDir, "settings.json"), "{}\n");
  const savedKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "sk-test-not-a-real-key";
  try {
    const status = await readPiEnvStatus(agentDir, createPiEnvProbes(cwd));
    assert.notEqual(status.finding, "no-credentials");
  } finally {
    if (savedKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = savedKey;
  }
});
