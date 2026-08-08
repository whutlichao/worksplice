import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getDb } from "./db-singleton.ts";
import { SUSAN_MEMBER_NAME } from "./event-messages.ts";
import { initSecretaryFlow } from "./secretary-init.ts";

/**
 * 秘书首次启动自动创建（spec-bootstrap-agent.md §6.1，构建 effort ticket 05）：
 * 启动路径（instrumentation，agent-loop 启动之后）"确保 Susan 存在"——
 * 幂等判定 = 名字全等 + 软删标记（存活或 deleted=1 均算"已存在"→ 不创建，删除后不自动重建）；
 * 仅完全不存在时走 04 完整初始化流程（initSecretaryFlow）。defaultModel 为 null（模型未配置）
 * → 跳过自动创建、记服务端日志、不阻塞启动；失败不致命（与 startAgentLoop 同款纪律，由调用方兜底）。
 * defaultModel 来源：直接读 `~/.pi/agent/settings.json` 顶层 defaultProvider/defaultModel
 * （与 GET /api/models 的 defaultModel 同源同键，§6.1 "从 GET /api/models 取"的本地等价实现）。
 * 有意偏差：API 在 settings 未显式设默认时还会兜底到 enabledModels 首个可见模型，这里刻意不跟——
 * 自动创建要求"显式配置的默认模型"，与 §6.3 的 UI 引导流程（配置模型 → 创建）对齐；
 * 该边角（配了 enabledModels 却无显式默认）欠创建是安全的：重启自动重试。
 */

/** 默认模型对（settings.json 顶层 defaultProvider/defaultModel，与 GET /api/models 的 defaultModel 同源同键）。 */
export interface DefaultModelConfig {
  provider: string;
  modelId: string;
}

/**
 * 读全局默认模型：`~/.pi/agent/settings.json` 顶层 `defaultProvider` + `defaultModel`（与 SDK
 * SettingsManager.getDefaultProvider()/getDefaultModel() 同键）；文件缺失/解析失败/键不齐 → null。
 * 可显式传 agentDir（测试用，避免动 env）；缺省取 SDK getAgentDir()（尊重 PI_CODING_AGENT_DIR 覆盖）。
 */
export function readDefaultModelFromSettings(agentDir?: string): DefaultModelConfig | null {
  const settingsPath = join(agentDir ?? getAgentDir(), "settings.json");
  if (!existsSync(settingsPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    const provider = typeof parsed?.defaultProvider === "string" ? parsed.defaultProvider : null;
    const modelId = typeof parsed?.defaultModel === "string" ? parsed.defaultModel : null;
    if (provider && modelId) return { provider, modelId };
    return null;
  } catch {
    return null;
  }
}

export interface AutoCreateSecretaryOptions {
  /** 默认模型解析器（测试注入）；缺省 = readDefaultModelFromSettings。 */
  resolveDefaultModel?: () => DefaultModelConfig | null;
}

export type AutoCreateSecretaryOutcome =
  | { created: true }
  | { created: false; reason: "exists" | "no-default-model" };

/**
 * 启动路径"确保 Susan 存在"（§6.1）：存在（含软删行）→ 跳过；模型未配置 → 跳过 + 服务端日志；
 * 否则走 §6.2 完整初始化流程（身份 + 手册 + 频道覆盖 + 办公室频道 + 欢迎事件），thinkingLevel 继承全局默认。
 * 抛错 = 初始化失败，调用方（instrumentation）按"失败不致命"纪律捕获记日志。
 */
export function autoCreateSecretary(
  options: AutoCreateSecretaryOptions = {},
): AutoCreateSecretaryOutcome {
  const resolveDefaultModel = options.resolveDefaultModel ?? readDefaultModelFromSettings;

  const anySusan = getDb().getMemberByName(SUSAN_MEMBER_NAME);
  if (anySusan) return { created: false, reason: "exists" };

  const defaultModel = resolveDefaultModel();
  if (!defaultModel) {
    console.warn(
      "[worksplice] secretary auto-create skipped: no default model configured " +
        "(set defaultModel/defaultProvider in the agent settings, then restart)",
    );
    return { created: false, reason: "no-default-model" };
  }

  initSecretaryFlow({ provider: defaultModel.provider, modelId: defaultModel.modelId });
  return { created: true };
}
