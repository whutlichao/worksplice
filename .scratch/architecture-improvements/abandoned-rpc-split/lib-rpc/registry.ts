import { resolve, realpathSync } from "path";
import { createAgentSessionServices, getAgentDir, initTheme, SessionManager } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { invalidateModelsCache } from "../models-cache";
import { resolveVisibleModels, selectInitialModelScope } from "../model-scope";
import { invalidateSessionListCache } from "../session-reader";
import { projectTrustReloadOptions } from "../project-trust";
import { persistExplicitStartupPreferences } from "../startup-preferences";
import { AgentSessionWrapper } from "./session.js";
import type { RpcSessionStartOptions } from "./session.js";

// ============================================================================
// Session registry
// ============================================================================

declare global {
  var __workspliceSessions: Map<string, AgentSessionWrapper> | undefined;
  var __workspliceStartLocks: Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> | undefined;
  var __workspliceStartingSessionCwds: Map<string, number> | undefined;
  var __workspliceRunningListeners: Set<(ids: string[]) => void> | undefined;
}

function getRegistry(): Map<string, AgentSessionWrapper> {
  if (!globalThis.__workspliceSessions) {
    globalThis.__workspliceSessions = new Map();
    const cleanup = () => globalThis.__workspliceSessions?.forEach((s) => s.destroy());
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
  return globalThis.__workspliceSessions;
}

function getLocks(): Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> {
  if (!globalThis.__workspliceStartLocks) globalThis.__workspliceStartLocks = new Map();
  return globalThis.__workspliceStartLocks;
}

function normalizeRpcCwd(cwd: string): string {
  const resolvedCwd = resolve(cwd);
  try {
    return realpathSync(resolvedCwd);
  } catch {
    return resolvedCwd;
  }
}

function getStartingSessionCwds(): Map<string, number> {
  if (!globalThis.__workspliceStartingSessionCwds) globalThis.__workspliceStartingSessionCwds = new Map();
  return globalThis.__workspliceStartingSessionCwds;
}

function trackStartingSession(cwd: string): () => void {
  const startingCwds = getStartingSessionCwds();
  const key = normalizeRpcCwd(cwd);
  startingCwds.set(key, (startingCwds.get(key) ?? 0) + 1);
  return () => {
    const remaining = (startingCwds.get(key) ?? 1) - 1;
    if (remaining > 0) startingCwds.set(key, remaining);
    else startingCwds.delete(key);
  };
}

export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return getRegistry().get(sessionId);
}

export function hasBusyRpcSessionForCwd(cwd: string): boolean {
  const targetCwd = normalizeRpcCwd(cwd);
  if (getStartingSessionCwds().has(targetCwd)) return true;
  return Array.from(getRegistry().values()).some(
    (session) => normalizeRpcCwd(session.cwd) === targetCwd && session.isRunning(),
  );
}

export function findBusyRpcSessionForCwd(cwd: string): AgentSessionWrapper | undefined {
  const targetCwd = normalizeRpcCwd(cwd);
  return Array.from(getRegistry().values()).find(
    (session) => normalizeRpcCwd(session.cwd) === targetCwd && session.isRunning(),
  );
}

export async function destroyRpcSessionsForCwd(cwd: string): Promise<number> {
  const targetCwd = normalizeRpcCwd(cwd);
  const sessions = Array.from(getRegistry().values()).filter(
    (session) => normalizeRpcCwd(session.cwd) === targetCwd,
  );
  await Promise.all(sessions.map((session) => session.shutdown()));
  return sessions.length;
}

export function getRunningRpcSessionIds(): string[] {
  const ids = new Set<string>();
  for (const [sessionId, session] of getRegistry()) {
    if (session.isRunning()) ids.add(session.sessionId || sessionId);
  }
  return [...ids];
}

// ----------------------------------------------------------------------------
// Running-status broadcaster
// ----------------------------------------------------------------------------

function getRunningListeners(): Set<(ids: string[]) => void> {
  if (!globalThis.__workspliceRunningListeners) globalThis.__workspliceRunningListeners = new Set();
  return globalThis.__workspliceRunningListeners;
}

export function subscribeRunningSessions(listener: (ids: string[]) => void): () => void {
  const listeners = getRunningListeners();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

let lastRunningSnapshot = "";

export function notifyRunningChange(): void {
  const listeners = getRunningListeners();
  if (listeners.size === 0) {
    lastRunningSnapshot = "";
    return;
  }
  const ids = getRunningRpcSessionIds();
  const snapshot = JSON.stringify([...ids].sort());
  if (snapshot === lastRunningSnapshot) return;
  lastRunningSnapshot = snapshot;
  for (const listener of listeners) {
    try { listener(ids); } catch { /* ignore listener errors */ }
  }
}

/**
 * Get or create an AgentSession for the given session.
 * For new sessions (sessionFile === ""), pi generates its own id.
 * New sessions resolve enabledModels before construction so the initial model,
 * thinking pin, and SDK scopedModels share one settings snapshot.
 * Pass options.toolNames to pre-configure active tools (empty = all disabled).
 */
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string | undefined,
  options: RpcSessionStartOptions = {},
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const { toolNames, initialModel, thinkingLevel } = options;
  const registry = getRegistry();
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
  const finishStartingSession = trackStartingSession(sessionCwd);
  const starting = (async () => {
    initTheme();
    const agentDir = getAgentDir();

    let toolsOption: string[] | undefined;
    if (toolNames !== undefined) {
      toolsOption = toolNames.length === 0 ? [] : undefined;
    }

    const trustReloadOptions = projectTrustReloadOptions(sessionCwd, agentDir);
    const services = await createAgentSessionServices({
      cwd: sessionCwd,
      agentDir,
      ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
    });
    const scope = await resolveVisibleModels(
      services.settingsManager,
      services.modelRuntime,
      services.resourceLoader,
    );

    const initial = selectInitialModelScope(
      scope,
      sessionManager,
      initialModel,
      thinkingLevel,
    );

    const session = await createAgentSessionFromServices({
      services,
      sessionManager,
      tools: toolsOption,
      scopedModels: initial.scopedModels,
      model: initial.model,
      thinkingLevel: initial.thinkingLevel,
      enabledModels: scope.enabledModels,
    });

    const modelDefaultChanged = !!initialModel || !!thinkingLevel;
    persistExplicitStartupPreferences(sessionManager, {
      model: initial.model,
      thinkingLevel: initial.thinkingLevel,
      modelDefaultChanged,
    });

    if (modelDefaultChanged) {
      invalidateModelsCache();
    }

    const wrapper = new AgentSessionWrapper(session);
    registry.set(wrapper.sessionId, wrapper);
    locks.delete(sessionId);
    finishStartingSession();
    wrapper.start();
    return { session: wrapper, realSessionId: wrapper.sessionId };
  })();

  locks.set(sessionId, starting);
  const result = await starting;
  locks.delete(sessionId);
  return result;
}
