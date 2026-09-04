import { join } from "node:path";
import {
  createAgentSessionServices,
  getAgentDir,
  ModelRuntime,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { getProjectTrustStatus, projectTrustReloadOptions } from "./project-trust";

/**
 * `GET /api/models` 的服务加载策略。
 *
 * - `lite`：只建 `ModelRuntime` + `SettingsManager`（~20ms）。模型枚举不需要
 *   extensions——extension 注册的工具/skills/prompts 与可见模型无关。
 * - `full`：走 `createAgentSessionServices` 全量加载（含 extensions，~10s），
 *   由 SDK trust 门控决定 project extensions 是否生效。
 */
export type ModelListingStrategy = "lite" | "full";

/**
 * 只读决策：cwd 走轻量还是全量。
 *
 * - cwd 无 trust-requiring project 资源（`.pi/settings.json`、`.pi/extensions`、
 *   `.agents/skills` 等）→ `lite`：project 无代码可执行，跳过 extensions 安全。
 * - 有，但用户已信任（与 `pi` CLI 共用 trust store）→ `lite`：与 CLI 可信行为
 *   一致，project settings 可读。
 * - 有且未信任 → `full`：SDK trust 门控保持 project extensions 休眠（#236），
 *   安全优先，慢但正确。
 *
 * 纯函数（只读 trust store + `existsSync`），单测不触 extensions。
 */
export function resolveModelListingStrategy(
  cwd: string,
  agentDir: string = getAgentDir(),
): ModelListingStrategy {
  const status = getProjectTrustStatus(cwd, agentDir);
  return !status.requiresTrust || status.trusted ? "lite" : "full";
}

export interface ModelListingServices {
  modelRuntime: ModelRuntime;
  settings: SettingsManager;
  strategy: ModelListingStrategy;
}

/**
 * 为模型枚举加载刚好够用的服务。
 *
 * 轻量路径与 `createAgentSessionServices` 内部同参：`ModelRuntime.create` 默认
 * 不走网络 catalog refresh，`SettingsManager.create` 默认 `projectTrusted=true`
 *（本分支已信任/无需信任，project settings 可读——与全量可信路径一致）。
 */
export async function loadModelListingServices(
  cwd: string,
  agentDir: string = getAgentDir(),
): Promise<ModelListingServices> {
  const strategy = resolveModelListingStrategy(cwd, agentDir);
  if (strategy === "lite") {
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: join(agentDir, "models.json"),
    });
    const settings = SettingsManager.create(cwd, agentDir);
    return { modelRuntime, settings, strategy };
  }
  const trustReloadOptions = projectTrustReloadOptions(cwd, agentDir);
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
  });
  return { modelRuntime: services.modelRuntime, settings: services.settingsManager, strategy };
}
