/**
 * pi 配置根两档故障的**判定层**（issue #226）：P1 环境未初始化 / P2 无可用凭证。
 *
 * 分工：本模块不 import React、不 import Next、不碰 SDK —— 观测经注入的探测接口进来
 * （`PiEnvProbes`），判定是对一份观测的纯函数（`judgePiEnv`），`readPiEnvStatus` 只做
 * 「按优先级现算一次」的编排。真实探测在 `lib/pi-env-probe.ts`（SDK + node:fs），
 * 骨架补缺在 `lib/pi-env-skeleton.ts`，两个 HTTP 入口是薄封装。
 *
 * ## 两档判据
 *
 * - **P1 环境未初始化**：目录缺失 / 目录不可读 / settings 面读取抛错 /
 *   **settings 读出为空且 `settings.json` 从未被写过**。修复动作 = 初始化骨架。
 * - **P2 无可用凭证**：模型面读不出任何带凭证可用的模型（列表为空，或列表里的 provider
 *   全部未配置凭证）。修复动作 = 引导进既有 provider 面，不动目录。
 * - 优先级：P1 成立只报 P1（**此时一次都不探模型面**）；否则 P2 成立只报 P2；都不成立无结论。
 *
 * 判据取自「读出来的状态」而不是「枚举骨架文件是否存在」：`auth.json` 在、`models.json`
 * 不在、模型可用的环境不得被判成 P1（那是能用环境，不是坏环境）。
 *
 * ## 为什么 P1(d) 里会出现一个文件存在性判断（与票面口径的偏离，已裁决）
 *
 * 票面（issue #225 决策 1）写的是「P1(d) = settings 读出为空」。实测（SDK 1.5.2）：
 *
 * 1. 空目录：`SettingsManager` 三条读数全 `undefined`、不抛错、零写盘 ⇒ 只有 (d) 成立。
 * 2. 初始化骨架写下 `settings.json = {}` 之后，三条读数与空目录**逐字相同** ⇒ 字面 (d)
 *    永远不解除：初始化按钮点完状态条还报「未初始化」，「初始化成功后落到 provider 面」
 *    那条验收走不通。
 * 3. 空目录 + 环境里有 `DEEPSEEK_API_KEY`：`getAvailable()` 返回 2 个模型
 *    （`authStatus.source === "environment"`）⇒ 一个**能用**的环境只要没写过
 *    `settings.json`，就会被字面 (d) 判成未初始化。
 * 4. 死结：要让「模型可用的环境不判 P1」，P1 就得探模型面；而探模型面
 *    （`ModelRuntime.create`）必写 `auth.json` / `models-store.json` 两个空壳，
 *    「空目录跑完仍为空」这条断言就不成立了。
 *
 * 裁决（issue #226 的 Answer，选项 A）：(d) 收窄为「settings 读出为空 **且**
 * `settings.json` 不存在」——存在性判据**只此一个文件**，不枚举 `auth.json` /
 * `models.json`（那正是决策 1 要挡的误报面）。代价是残量误报：凭证齐全（含环境变量）
 * 但从未写过 `settings.json` 的人会看到 P1 —— 提示面文案给出逃生口，且用户一旦在界面
 * 选过模型，worksplice 自己会写 `defaultProvider` / `defaultModel`，`settings.json`
 * 随之产生，误报自愈。
 *
 * 结论不落库、不缓存：环境会在外部被改变（装个 CLI、改个环境变量），每次现算。
 */

/** 两档互斥呈现；`null` = 无结论（提示面渲染 null）。 */
export type PiEnvFinding = "uninitialized" | "no-credentials";

/** 判定依据（可观测、可断言；提示面按它选细节文案）。 */
export type PiEnvReason =
  | "agent-dir-missing"
  | "agent-dir-unreadable"
  | "settings-unreadable"
  | "settings-unwritten"
  | "no-credentials";

export interface PiEnvStatus {
  /** 本次判定看的配置根（`getAgentDir()` 的返回值，尊重 `PI_CODING_AGENT_DIR`）。 */
  agentDir: string;
  finding: PiEnvFinding | null;
  reason: PiEnvReason | null;
}

/** 目标目录的可用性：缺失 / 存在但不可读 / 可读。 */
export type PiEnvDirState = "ok" | "missing" | "unreadable";

/**
 * settings 面读数。`error` 非空 = 读取抛错（P1(c)）；三条读数全空且无错误 =
 * 「读不出东西」（P1(d) 的内容面）。**观测不得写盘**：只读 `settings.json`。
 */
export interface PiEnvSettingsReading {
  defaultProvider: string | null;
  defaultModel: string | null;
  enabledModels: readonly string[] | null;
  error: string | null;
}

/**
 * 模型面读数（`readModelPlane` 的产物）。P2 的判据是「读不出任何带凭证可用的模型」：
 * `available === 0` 或 `configuredProviders === 0`。
 *
 * 注意：真实探测（`ModelRuntime.create`）会补建 `auth.json` / `models-store.json`
 * 两个空壳，那是 SDK 自身行为；所以这条只在 P1 不成立之后才走。
 */
export interface PiEnvModelReading {
  available: number;
  configuredProviders: number;
}

/** 注入式探测接口：判定层只认这四条，测试给临时目录 / 假读数即可覆盖每个分支。 */
export interface PiEnvProbes {
  /** 目录能否使用（`readdir` 一次：`ENOENT` = 缺失，其余错误 = 不可读）。 */
  inspectAgentDir(agentDir: string): PiEnvDirState;
  /** `settings.json` 是否已被写过 —— 本模块唯一的文件存在性判据，理由见文件头。 */
  settingsFileExists(agentDir: string): boolean;
  /** settings 面读数（P1(a)/(b) 不成立时才问）。 */
  readSettings(agentDir: string): PiEnvSettingsReading;
  /** 模型面读数（P1 不成立时才问；异步 = SDK 的 `getAvailable()`）。 */
  readModelPlane(agentDir: string): Promise<PiEnvModelReading>;
}

/** 一份完整观测；`models === null` 表示「没探模型面」（P1 已成立时短路）。 */
export interface PiEnvObservation {
  dir: PiEnvDirState;
  settingsFileExists: boolean;
  settings: PiEnvSettingsReading;
  models: PiEnvModelReading | null;
}

/** 空 settings 读数：目录不可读时不再问 settings 面，用它兜底（唯一字面量来源）。 */
export const EMPTY_SETTINGS_READING: PiEnvSettingsReading = Object.freeze({
  defaultProvider: null,
  defaultModel: null,
  enabledModels: null,
  error: null,
});

/** settings 面三条读数是否全空（P1(d) 的内容面）。 */
export function isSettingsReadingEmpty(reading: PiEnvSettingsReading): boolean {
  if (reading.error !== null) return false;
  const provider = reading.defaultProvider?.trim() ?? "";
  const model = reading.defaultModel?.trim() ?? "";
  const enabled = reading.enabledModels?.filter((pattern) => pattern.trim() !== "") ?? [];
  return provider === "" && model === "" && enabled.length === 0;
}

/** 模型面是否读不出任何带凭证可用的模型（P2 的唯一判据）。 */
export function isModelPlaneEmpty(reading: PiEnvModelReading): boolean {
  return reading.available === 0 || reading.configuredProviders === 0;
}

/**
 * 纯判定：给一份观测得出哪一档。P1 先判、命中即返回 —— 因此「P1∧P2 只出 P1」
 * 是结构性的，不靠调用方顺序。
 */
export function judgePiEnv(observation: PiEnvObservation): {
  finding: PiEnvFinding | null;
  reason: PiEnvReason | null;
} {
  if (observation.dir === "missing") {
    return { finding: "uninitialized", reason: "agent-dir-missing" };
  }
  if (observation.dir === "unreadable") {
    return { finding: "uninitialized", reason: "agent-dir-unreadable" };
  }
  if (observation.settings.error !== null) {
    return { finding: "uninitialized", reason: "settings-unreadable" };
  }
  if (isSettingsReadingEmpty(observation.settings) && !observation.settingsFileExists) {
    return { finding: "uninitialized", reason: "settings-unwritten" };
  }
  if (observation.models !== null && isModelPlaneEmpty(observation.models)) {
    return { finding: "no-credentials", reason: "no-credentials" };
  }
  return { finding: null, reason: null };
}

/**
 * 现算一次两档结论（不缓存、不落库）。
 *
 * 顺序是承重的：先目录、再 settings 面，P1 一旦成立就返回，**一次都不调 `readModelPlane`**
 * —— 探模型面会写 SDK 的两个空壳，「检测」就变成了「修改」（空目录那条用例靠这条）。
 */
export async function readPiEnvStatus(
  agentDir: string,
  probes: PiEnvProbes,
): Promise<PiEnvStatus> {
  const dir = probes.inspectAgentDir(agentDir);
  const readable = dir === "ok";
  const settings: PiEnvSettingsReading = readable
    ? probes.readSettings(agentDir)
    : EMPTY_SETTINGS_READING;
  const settingsFileExists = readable ? probes.settingsFileExists(agentDir) : false;

  const p1 = judgePiEnv({ dir, settingsFileExists, settings, models: null });
  if (p1.finding !== null) return { agentDir, ...p1 };

  const models = await probes.readModelPlane(agentDir);
  return { agentDir, ...judgePiEnv({ dir, settingsFileExists, settings, models }) };
}
