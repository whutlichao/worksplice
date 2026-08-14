// RpcCaller — RPC 会话的获取与命令调用入口。
//
// 职责：start() 启动/获取一个 AgentSessionWrapper（原 startRpcSession——SDK
// 服务构造、模型 scope 解析、显式偏好持久化、wrapper 组装与注册）；
// call() 向已有 wrapper 发送一条命令（委托 wrapper.send，供统一走 caller
// 门面的调用方使用；既有调用方可继续直接 session.send）。
// 并发启动锁（__workspliceStartLocks）挂 globalThis 以扛热重载。

import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  getAgentDir,
  initTheme,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { invalidateModelsCache } from "../models-cache";
import { resolveVisibleModels, selectInitialModelScope } from "../model-scope";
import { projectTrustReloadOptions } from "../project-trust";
import { cacheSessionPath } from "../session-reader";
import { persistExplicitStartupPreferences } from "../startup-preferences";
import { AgentSessionWrapper, withExtensionTools } from "./session.ts";
import type { RpcSessionStartOptions } from "./session.ts";
import { getRpcRegistry } from "./registry.ts";

declare global {
  var __workspliceStartLocks: Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> | undefined;
}

function getLocks(): Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> {
  if (!globalThis.__workspliceStartLocks) globalThis.__workspliceStartLocks = new Map();
  return globalThis.__workspliceStartLocks;
}

export class RpcCaller {
  /**
   * Get or create an AgentSession for the given session.
   * For new sessions (sessionFile === ""), pi generates its own id.
   * New sessions resolve enabledModels before construction so the initial model,
   * thinking pin, and SDK scopedModels share one settings snapshot.
   * Pass options.toolNames to pre-configure active tools (empty = all disabled).
   */
  async start(
    sessionId: string,
    sessionFile: string,
    cwd: string | undefined,
    options: RpcSessionStartOptions = {},
  ): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
    const { toolNames, initialModel, thinkingLevel } = options;
    const registry = getRpcRegistry();
    const locks = getLocks();

    const existing = registry.get(sessionId);
    if (existing?.isAlive()) return { session: existing, realSessionId: sessionId };

    const inflight = locks.get(sessionId);
    if (inflight) return inflight;

    let sessionManager: SessionManager;
    if (sessionFile) {
      sessionManager = SessionManager.open(sessionFile, undefined);
    } else {
      if (!cwd) throw new Error("cwd is required for a new session");
      sessionManager = SessionManager.create(cwd, undefined);
    }
    const sessionCwd = sessionManager.getCwd();
    const finishStartingSession = registry.trackStarting(sessionCwd);
    const starting = (async () => {
      // Some extensions access the SDK's global theme even outside the terminal UI.
      initTheme();
      const agentDir = getAgentDir();

      // Determine which tools to pass based on requested toolNames.
      // Since v0.68.0, session creation expects string[] tool names instead of Tool[] instances.
      let toolsOption: string[] | undefined;
      if (toolNames !== undefined) {
        // toolNames === [] -> "all off" (an empty allow-list disables every tool).
        // Otherwise DO NOT pass a builtin-only allow-list: passing CODING_TOOL_NAMES
        // set allowedToolNames to coding builtins only, which filtered every
        // extension/package-provided tool (e.g. subagents, web access) out of the
        // tool registry — so they were unavailable in worksplice sessions even though the
        // `pi` CLI keeps them. Leaving the allow-list unset lets the SDK register all
        // tools (and activate extension tools); we narrow the ACTIVE set below.
        toolsOption = toolNames.length === 0 ? [] : undefined;
      }

      // Build services first so extension-registered providers are available
      // before the SDK restores the saved model from the session file.
      // Gate untrusted project extensions so opening a repository does not run
      // its .pi/extensions code automatically (see lib/project-trust.ts, #236).
      const trustReloadOptions = projectTrustReloadOptions(sessionCwd, agentDir);
      const services = await createAgentSessionServices({
        cwd: sessionCwd,
        agentDir,
        ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
      });
      const scope = await resolveVisibleModels(
        services.modelRuntime,
        services.settingsManager.getEnabledModels(),
      );
      const defaultProvider = services.settingsManager.getDefaultProvider();
      const defaultModelId = services.settingsManager.getDefaultModel();
      const hasExistingMessages = sessionManager.getBranch().some((entry) => entry.type === "message");
      // 已有消息的会话默认保留文件里保存的模型；但显式 initialModel（如 §3.10
      // per-agent runtime 配置）必须覆盖——否则 agent 配置对老 session 永不生效，
      // 且文件里被污染/过期的模型（如错误 provider 名）会一直拦截请求。
      const initial = hasExistingMessages && !initialModel
        ? { scopedModels: [...scope.scopedModels] }
        : selectInitialModelScope(scope, {
          ...(initialModel ? { requestedModel: initialModel } : {}),
          ...(defaultProvider && defaultModelId
            ? { defaultModel: { provider: defaultProvider, modelId: defaultModelId } }
            : {}),
          ...(thinkingLevel ? { thinkingLevel } : {}),
        });
      const { session: inner } = await createAgentSessionFromServices({
        services,
        sessionManager,
        ...(initial.model ? { model: initial.model } : {}),
        ...(initial.thinkingLevel ? { thinkingLevel: initial.thinkingLevel } : {}),
        ...(initial.scopedModels.length > 0 ? { scopedModels: initial.scopedModels } : {}),
        ...(toolsOption !== undefined ? { tools: toolsOption } : {}),
      });

      const persistedPreferences = await persistExplicitStartupPreferences(
        services.settingsManager,
        {
          ...(initialModel ? { model: initialModel } : {}),
          ...(thinkingLevel ? { thinkingLevel } : {}),
        },
        {
          ...(inner.model
            ? { model: { provider: inner.model.provider, modelId: inner.model.id } }
            : {}),
          thinkingLevel: inner.thinkingLevel,
          supportsThinking: inner.supportsThinking(),
        },
      );
      if (persistedPreferences.modelDefaultChanged) invalidateModelsCache();

      // If specific tool names were requested (non-empty), set the active tools to the
      // requested builtin coding tools PLUS all extension/package tools, so installed
      // extensions stay usable in worksplice just like in the `pi` CLI.
      if (toolNames && toolNames.length > 0) {
        inner.setActiveToolsByName(withExtensionTools(inner, toolNames));
      }

      const wrapper = new AgentSessionWrapper(inner);
      // When all tools are disabled, clear the system prompt entirely.
      // pi's buildSystemPrompt always produces a non-empty prompt even with no tools;
      // keep this forced after extension resource discovery and reloads as well.
      if (toolNames?.length === 0) {
        wrapper.setForceEmptySystemPrompt(true);
      }
      wrapper.start();

      const realSessionId = inner.sessionId as string;
      const realSessionFile = inner.sessionFile as string | undefined;
      if (realSessionFile) cacheSessionPath(realSessionId, realSessionFile);

      // register 内部挂 onDestroy 自动注销（wrapper 销毁即从注册表移除）。
      registry.register(realSessionId, wrapper);
      wrapper.beginExtensionBinding({ forceEmptySystemPrompt: toolNames?.length === 0 });

      return { session: wrapper, realSessionId };
    })().finally(() => {
      locks.delete(sessionId);
      finishStartingSession();
    });

    locks.set(sessionId, starting);
    return starting;
  }

  /** 向已获取的 wrapper 发送一条 RPC 命令。 */
  call(session: AgentSessionWrapper, command: Record<string, unknown>): Promise<unknown> {
    return session.send(command);
  }
}

let callerInstance: RpcCaller | null = null;

function getRpcCaller(): RpcCaller {
  if (!callerInstance) callerInstance = new RpcCaller();
  return callerInstance;
}

/** 兼容函数：等价于 getRpcCaller().start(...)（见 RpcCaller.start 的 JSDoc）。 */
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string | undefined,
  options: RpcSessionStartOptions = {},
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  return getRpcCaller().start(sessionId, sessionFile, cwd, options);
}

export { getRpcCaller };
