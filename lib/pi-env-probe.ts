/**
 * 判定层的真实探测（issue #226）：把 `lib/pi-env-status.ts` 的四条注入接口接到
 * node:fs 与 pi SDK 上。判定逻辑一律不在这里 —— 本模块只**读**，唯一副作用是
 * `ModelRuntime.create` 自己补建 `auth.json` / `models-store.json` 两个空壳（SDK 行为，
 * 只在 P1 不成立之后才发生，见 `readPiEnvStatus` 的短路）。
 *
 * settings 面刻意用 `projectTrusted: false` 建管理器：P1 判的是**全局配置根**
 * （`getAgentDir()`），project 里的 `.pi/settings.json` 不应该让「根还没起来」这件事
 * 被一个仓库内的文件掩盖。
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import {
  EMPTY_SETTINGS_READING,
  type PiEnvDirState,
  type PiEnvModelReading,
  type PiEnvProbes,
  type PiEnvSettingsReading,
} from "./pi-env-status.ts";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 目录可用性：`readdir` 一次 —— `ENOENT` 才算缺失，其余错误一律不可读（fail-closed）。 */
export function inspectAgentDir(agentDir: string): PiEnvDirState {
  try {
    readdirSync(agentDir);
    return "ok";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable";
  }
}

/**
 * settings 面读数（**只读**，不写盘）。
 *
 * SDK 把读取失败吞成 `drainErrors()` 里的一条记录（`SettingsManager.create` 本身不抛），
 * 所以「读取抛错」这条判据取自排水结果，不取自 `create` 的返回。
 */
export function readSettings(agentDir: string, cwd: string): PiEnvSettingsReading {
  try {
    const manager = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
    const errors = manager.drainErrors().filter((entry) => entry.scope === "global");
    if (errors.length > 0) {
      return { ...EMPTY_SETTINGS_READING, error: errors.map((entry) => errorMessage(entry.error)).join("; ") };
    }
    return {
      defaultProvider: manager.getDefaultProvider() ?? null,
      defaultModel: manager.getDefaultModel() ?? null,
      enabledModels: manager.getEnabledModels() ?? null,
      error: null,
    };
  } catch (error) {
    return { ...EMPTY_SETTINGS_READING, error: errorMessage(error) };
  }
}

/**
 * 模型面读数：可用模型数 + 其中凭据已配置的 provider 数。
 *
 * `allowModelNetwork: false` 显式写出（SDK 默认也是 false）：状态判定不该为了一份模型目录
 * 去联网。读取失败按「读不出可用模型」算（0 / 0）—— 那会把用户送到凭证面，而凭证面正是
 * 这类失败最常见的原因，且动作不碰目录。
 */
export async function readModelPlane(agentDir: string): Promise<PiEnvModelReading> {
  try {
    const runtime = await ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: join(agentDir, "models.json"),
      allowModelNetwork: false,
    });
    const available = await runtime.getAvailable();
    const providers = new Set(available.map((model) => model.provider));
    let configuredProviders = 0;
    for (const provider of providers) {
      if (runtime.hasConfiguredAuth(provider)) configuredProviders += 1;
    }
    return { available: available.length, configuredProviders };
  } catch {
    return { available: 0, configuredProviders: 0 };
  }
}

/**
 * 组装真实探测。`cwd` 只喂给 `SettingsManager.create`（它的第一个参数是 cwd），
 * 与 `settings.json` 的读取位置无关。
 */
export function createPiEnvProbes(cwd: string = process.cwd()): PiEnvProbes {
  return {
    inspectAgentDir,
    // `existsSync` 把 EACCES 也吞成 false —— 这里要的正是「读不到就当没写过」：
    // 目录不可读时 P1(b) 已经先命中，走不到这条。
    settingsFileExists: (agentDir) => existsSync(join(agentDir, "settings.json")),
    readSettings: (agentDir) => readSettings(agentDir, cwd),
    readModelPlane,
  };
}
