import type { MemberRow, MemberStatus } from "./data/types.ts";
import {
  getAgent,
  normalizeWorkspacePath,
  setAgentRuntimeConfig,
} from "./domain/collab/index.ts";
import { getAgentRuntime, type AgentRuntime } from "./agent-runtime.ts";
import { publishAgentStatus } from "./agent-status.ts";
import {
  missingProbeCredentialsError,
  probeCredentialsFrom,
  probeErrorMessage,
  runModelProbe,
  type ModelProbeCompleter,
  type ModelProbeVerdict,
} from "./model-probe.ts";

/**
 * agent 状态点的错误恢复服务层（票据 02，spec 决策 9）。
 *
 * 一句话语义：**恢复动作的证据是「模型此刻可用」这个显式裁决，不是「会话还活着」这个推导。**
 *
 * 形态（深模块）：`saveAgentRuntime(agentId, input, deps)` =
 * [应用存活会话命令 → 持久化覆盖 → 判定是否触发 → 串行执行探测 → 按发布前置决定是否写状态点 → 返回结论]。
 * 判定与映射是纯函数（`shouldProbeOnRuntimeSave` / `probeVerdictStatus` / `shouldPublishProbeVerdict`），
 * SDK 与运行时经既有 `AgentRuntime` 接缝与可注入的 `probe` 进入——测试零 SDK、零网络。
 *
 * 为什么保存一个配置字段会触发一次模型调用并改写状态点：既有契约里 `error` 只被
 * 「下一次 `agent_start`」清除（`lib/agent-runtime.ts` 的事件映射），而换模型时该 agent 空闲、
 * 没有新 wake ⇒ 红点永不清除。本模块补的是一条**显式裁决**式的清除路径（推导式清除仍被禁止），
 * 且只在「保存前已出错 ∧ 保存后存在具体覆盖对」时付出一次极小调用（决策 1/2/3/8）。
 */

/** 探测目标：该成员的工作区 + 刚保存的覆盖对（cwd 与会话启动同源：project trust 与可见模型面一致）。 */
export interface ModelProbeTarget {
  agentId: string;
  cwd: string;
  provider: string;
  modelId: string;
}

/** 探测接缝：默认真实探测（`createModelProbe`），测试注入 fake。 */
export type ModelProbe = (target: ModelProbeTarget) => Promise<ModelProbeVerdict>;

export interface CreateModelProbeOptions {
  /** 测试注入：pi agent 目录（默认 `getAgentDir()`——生产走真实配置与凭证）。 */
  agentDir?: string;
  /** 测试注入：底层最小调用（默认 SDK 的 `completeSimple`）。 */
  complete?: ModelProbeCompleter;
  /** 测试注入：单次探测上限。 */
  timeoutMs?: number;
}

/**
 * 恢复探测（决策 5）：用**刚保存的那个覆盖对**，走**与会话启动同一条解析路径**——
 * `loadModelListingServices`（cwd = 该成员工作区）→ `resolveVisibleModels`（吃 `enabledModels`）
 * → `selectInitialModelScope({ requestedModel })`。所以结论同时覆盖两件事：模型能不能通，
 * 以及下次启动能不能解析到它。
 *
 * 解析失败（模型不存在 / 越出可见作用域 / 拿不到凭证 / 未绑定工作区）⇒ **不发出探测调用**、
 * 把可读原因交回调用方（fail-closed，不假绿）。探测内核不碰状态、不碰 DB。
 */
export function createModelProbe(options: CreateModelProbeOptions = {}): ModelProbe {
  return async ({ cwd, provider, modelId }) => {
    if (!cwd) return { ok: false, error: "Agent has no workspace bound" };

    try {
      // 惰性加载：只有真的触发探测时才拉起解析路径（测试注入 probe 时零 SDK）。
      const [{ loadModelListingServices }, { resolveVisibleModels, selectInitialModelScope }] =
        await Promise.all([import("./model-listing.ts"), import("./model-scope.ts")]);

      const services = await loadModelListingServices(cwd, options.agentDir);
      const scope = await resolveVisibleModels(
        services.modelRuntime,
        services.settings.getEnabledModels(),
      );
      // 越出 enabledModels 作用域的 requestedModel 在这里抛错（既有语义），
      // 与「下次启动能不能解析到它」同一判据。
      const { model } = selectInitialModelScope(scope, { requestedModel: { provider, modelId } });
      if (!model) return { ok: false, error: `Model not found: ${provider}/${modelId}` };

      const resolved = await services.modelRuntime.getAuth(model);
      const credentials = probeCredentialsFrom(resolved?.auth);
      if (!credentials) return { ok: false, error: missingProbeCredentialsError(provider) };

      return await runModelProbe(model, credentials, {
        ...(options.complete ? { complete: options.complete } : {}),
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      });
    } catch (error) {
      return { ok: false, error: probeErrorMessage(error) };
    }
  };
}

// ---------------------------------------------------------------------------
// 判定层（纯函数，决策 1 / 3 / 7）
// ---------------------------------------------------------------------------

/**
 * 触发谓词（决策 1）：保存后存在具体覆盖对 ∧ 保存前处于 `error`。
 * 与「这次改了哪个字段」无关——红点状态下再点一次保存就是一次复检（零新增 UI 入口）；
 * 清空覆盖（覆盖对为 null）与非 error 语境都不触发。
 */
export function shouldProbeOnRuntimeSave(input: {
  statusBeforeSave: MemberStatus;
  hasOverrideAfterSave: boolean;
}): boolean {
  return input.hasOverrideAfterSave && input.statusBeforeSave === "error";
}

/**
 * 结论映射（决策 3）：通过 ∧ 有存活会话 → `online`；通过 ∧ 无存活会话 → `offline`
 * （红 → 灰：错误已清、会话未运行）；不通过 → `null`（不写状态点，保持出错）。
 */
export function probeVerdictStatus(
  verdict: { ok: boolean },
  hasLiveSession: boolean,
): MemberStatus | null {
  if (!verdict.ok) return null;
  return hasLiveSession ? "online" : "offline";
}

/**
 * 发布前置两条（决策 7）：① 当前持久化的有效模型仍等于本次探测的模型；② 当前状态仍为 `error`。
 * 任一不成立 ⇒ 不写状态点，结论只回本次交互（响应里标注 superseded）。
 */
export function shouldPublishProbeVerdict(input: {
  probedModel: { provider: string; modelId: string };
  currentModel: { provider: string | null; modelId: string | null } | null;
  currentStatus: MemberStatus;
}): boolean {
  const { probedModel, currentModel, currentStatus } = input;
  return (
    currentModel !== null &&
    currentModel.provider === probedModel.provider &&
    currentModel.modelId === probedModel.modelId &&
    currentStatus === "error"
  );
}

// ---------------------------------------------------------------------------
// 服务层
// ---------------------------------------------------------------------------

export interface SaveAgentRuntimeInput {
  provider?: unknown;
  modelId?: unknown;
  thinkingLevel?: unknown;
}

/** 本次交互的探测结论（不落库、不做历史）：面板据此显示 probeOk / probeFailed / superseded。 */
export interface RuntimeProbeSummary {
  attempted: boolean;
  ok?: boolean;
  error?: string;
  latencyMs?: number;
  superseded?: boolean;
}

export interface SaveAgentRuntimeResult {
  agent: MemberRow;
  probe: RuntimeProbeSummary;
}

export interface AgentRecoveryDeps {
  runtime?: AgentRuntime;
  probe?: ModelProbe;
}

declare global {
  var __workspliceProbeLocks: Map<string, Promise<unknown>> | undefined;
}

function getProbeLocks(): Map<string, Promise<unknown>> {
  if (!globalThis.__workspliceProbeLocks) {
    globalThis.__workspliceProbeLocks = new Map();
  }
  return globalThis.__workspliceProbeLocks;
}

/**
 * 同成员探测 FIFO 串行（键 = agent id，形态照 `lib/cwd-mutex.ts` 的 per-key promise 链）；
 * 不同成员互不阻塞。挂 globalThis 以扛热重载；失败的 holder 不阻塞后继。
 */
function withProbeMutex<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
  const locks = getProbeLocks();
  const prev = locks.get(agentId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(
    agentId,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

/** `undefined` = 不更新该维度；`null` = 清空回全局默认；空串按 null 处理（既有面板语义）。 */
function normalizeRuntimeField(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** 当前持久化的具体覆盖对（成对校验由 `setAgentRuntimeConfig` 强制，这里只做读取侧收敛）。 */
function overridePair(member: MemberRow): { provider: string; modelId: string } | null {
  return member.model_provider && member.model_id
    ? { provider: member.model_provider, modelId: member.model_id }
    : null;
}

function summarizeVerdict(verdict: ModelProbeVerdict, superseded: boolean): RuntimeProbeSummary {
  return {
    attempted: true,
    ok: verdict.ok,
    ...(verdict.error !== undefined ? { error: verdict.error } : {}),
    ...(verdict.latencyMs !== undefined ? { latencyMs: verdict.latencyMs } : {}),
    ...(superseded ? { superseded: true } : {}),
  };
}

/** [探测 → 发布前置 → 写状态点]：整段在 per-agent 串行链内执行。 */
async function runRecoveryProbe(
  agentId: string,
  target: ModelProbeTarget,
  probe: ModelProbe,
  runtime: AgentRuntime,
): Promise<RuntimeProbeSummary> {
  let verdict: ModelProbeVerdict;
  try {
    verdict = await probe(target);
  } catch (error) {
    // 探测自身抛错同样是「没通过」：覆盖已存，状态点保持不动。
    verdict = { ok: false, error: probeErrorMessage(error) };
  }

  // 重读持久化配置与当前状态：发布前置两条防的都是「结论已过期」的污染。
  const current = getAgent(agentId);
  const publishable = shouldPublishProbeVerdict({
    probedModel: { provider: target.provider, modelId: target.modelId },
    currentModel: overridePair(current),
    currentStatus: current.status,
  });
  if (!publishable) return summarizeVerdict(verdict, true);

  const status = probeVerdictStatus(verdict, Boolean(runtime.findSession(current)?.isAlive()));
  if (status) publishAgentStatus(agentId, status);
  return summarizeVerdict(verdict, false);
}

/**
 * 保存 per-agent runtime 覆盖：既有行为（存活会话立即生效 + 持久化）之上追加
 * 「出错状态下的模型探测 ⇒ 状态收敛」。未出错时与今天完全一致（不探测、不加延迟、不花 token）。
 */
export async function saveAgentRuntime(
  agentId: string,
  input: SaveAgentRuntimeInput,
  deps: AgentRecoveryDeps = {},
): Promise<SaveAgentRuntimeResult> {
  const agent = getAgent(agentId); // 未知成员 → AgentNotFoundError（路由映射 404）
  const statusBeforeSave = agent.status;

  const provider = normalizeRuntimeField(input.provider);
  const modelId = normalizeRuntimeField(input.modelId);
  const thinkingLevel = normalizeRuntimeField(input.thinkingLevel);

  // 先应用到存活会话（命令抛错即不落库），再持久化覆盖配置——顺序与既有路由逐字一致。
  const runtime = deps.runtime ?? (await getAgentRuntime());
  const wrapper = runtime.findSession(agent);
  if (wrapper?.isAlive()) {
    if (provider !== undefined && modelId !== undefined && provider !== null && modelId !== null) {
      await wrapper.send({ type: "set_model", provider, modelId });
    }
    if (thinkingLevel !== undefined && thinkingLevel !== null) {
      await wrapper.send({ type: "set_thinking_level", level: thinkingLevel });
    }
  }

  const updated = setAgentRuntimeConfig(agentId, {
    modelProvider: provider,
    modelId,
    thinkingLevel,
  });

  const override = overridePair(updated);
  const triggered = shouldProbeOnRuntimeSave({
    statusBeforeSave,
    hasOverrideAfterSave: override !== null,
  });
  if (override === null || !triggered) {
    return { agent: updated, probe: { attempted: false } };
  }

  const probe = deps.probe ?? createModelProbe();
  const target: ModelProbeTarget = {
    agentId,
    cwd: updated.workspace_path ? normalizeWorkspacePath(updated.workspace_path) : "",
    provider: override.provider,
    modelId: override.modelId,
  };
  const probeSummary = await withProbeMutex(agentId, () =>
    runRecoveryProbe(agentId, target, probe, runtime),
  );
  return { agent: updated, probe: probeSummary };
}
