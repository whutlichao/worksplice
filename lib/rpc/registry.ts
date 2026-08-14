// RpcRegistry — 存活 AgentSessionWrapper 的注册表与 per-cwd 忙碌探测。
//
// 职责：register/unregister（wrapper 销毁时经 onDestroy 自动注销）、
// get、busy-cwd 探测（hasBusyForCwd/findBusyForCwd，含 starting 窗口）、
// destroyForCwd（换目录/删身份时销毁该 cwd 全部会话）、getRunningIds。
// 数据挂在 globalThis（__workspliceSessions / __workspliceStartingSessionCwds）
// 以扛 Next.js 热重载；RpcRegistry 实例本身无状态，随模块重生。
// 对 session.ts 只做 type-only import，避免运行时循环依赖。

import { realpathSync } from "fs";
import { resolve } from "path";
import type { AgentSessionWrapper } from "./session.ts";

declare global {
  var __workspliceSessions: Map<string, AgentSessionWrapper> | undefined;
  var __workspliceStartingSessionCwds: Map<string, number> | undefined;
}

function normalizeRpcCwd(cwd: string): string {
  const resolvedCwd = resolve(cwd);
  try {
    return realpathSync(resolvedCwd);
  } catch {
    return resolvedCwd;
  }
}

export class RpcRegistry {
  get(sessionId: string): AgentSessionWrapper | undefined {
    return this.sessions().get(sessionId);
  }

  /** 注册 wrapper；wrapper 销毁时自动从注册表移除。 */
  register(sessionId: string, wrapper: AgentSessionWrapper): void {
    const sessions = this.sessions();
    wrapper.onDestroy(() => sessions.delete(sessionId));
    sessions.set(sessionId, wrapper);
  }

  /** 同 cwd 是否有 busy 会话（starting 窗口内也算 busy）。 */
  hasBusyForCwd(cwd: string): boolean {
    const targetCwd = normalizeRpcCwd(cwd);
    if (this.startingCwds().has(targetCwd)) return true;
    return Array.from(this.sessions().values()).some(
      (session) => normalizeRpcCwd(session.cwd) === targetCwd && session.isRunning(),
    );
  }

  /**
   * 同 cwd 正在运行的会话 wrapper（02-决策一：busy-cwd 轮次的等待对象）。
   * 只找 running wrapper：starting 窗口内尚无 wrapper，而 per-cwd 启动互斥
   * （02-决策二）已保证 loop 路径不会在窗口内抛 BusyCwdError。
   */
  findBusyForCwd(cwd: string): AgentSessionWrapper | undefined {
    const targetCwd = normalizeRpcCwd(cwd);
    return Array.from(this.sessions().values()).find(
      (session) => normalizeRpcCwd(session.cwd) === targetCwd && session.isRunning(),
    );
  }

  /** 销毁某 cwd 下的全部会话（graceful shutdown），返回销毁数量。 */
  async destroyForCwd(cwd: string): Promise<number> {
    const targetCwd = normalizeRpcCwd(cwd);
    const sessions = Array.from(this.sessions().values()).filter(
      (session) => normalizeRpcCwd(session.cwd) === targetCwd,
    );
    await Promise.all(sessions.map((session) => session.shutdown()));
    return sessions.length;
  }

  /** 当前运行中会话 id 集合（broadcaster 的快照来源）。 */
  getRunningIds(): string[] {
    const ids = new Set<string>();
    for (const [sessionId, session] of this.sessions()) {
      if (session.isRunning()) ids.add(session.sessionId || sessionId);
    }
    return [...ids];
  }

  /** 跟踪一个正在启动的 session（busy-cwd 探测的 starting 窗口）。返回结束标记。 */
  trackStarting(cwd: string): () => void {
    const startingCwds = this.startingCwds();
    const key = normalizeRpcCwd(cwd);
    startingCwds.set(key, (startingCwds.get(key) ?? 0) + 1);
    return () => {
      const remaining = (startingCwds.get(key) ?? 1) - 1;
      if (remaining > 0) startingCwds.set(key, remaining);
      else startingCwds.delete(key);
    };
  }

  /** 进程退出/信号时销毁全部存活 wrapper。 */
  disposeAll(): void {
    this.sessions().forEach((s) => s.destroy());
  }

  private sessions(): Map<string, AgentSessionWrapper> {
    if (!globalThis.__workspliceSessions) {
      globalThis.__workspliceSessions = new Map();
      const cleanup = () => this.disposeAll();
      process.once("exit", cleanup);
      process.once("SIGINT", cleanup);
      process.once("SIGTERM", cleanup);
    }
    return globalThis.__workspliceSessions;
  }

  private startingCwds(): Map<string, number> {
    if (!globalThis.__workspliceStartingSessionCwds) globalThis.__workspliceStartingSessionCwds = new Map();
    return globalThis.__workspliceStartingSessionCwds;
  }
}

let registryInstance: RpcRegistry | null = null;

function getRpcRegistry(): RpcRegistry {
  if (!registryInstance) registryInstance = new RpcRegistry();
  return registryInstance;
}

// ----------------------------------------------------------------------------
// 兼容函数（公共 API 面与原 rpc-manager.ts 一致，route 层只改 import 路径）
// ----------------------------------------------------------------------------

export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return getRpcRegistry().get(sessionId);
}

export function hasBusyRpcSessionForCwd(cwd: string): boolean {
  return getRpcRegistry().hasBusyForCwd(cwd);
}

export function findBusyRpcSessionForCwd(cwd: string): AgentSessionWrapper | undefined {
  return getRpcRegistry().findBusyForCwd(cwd);
}

export async function destroyRpcSessionsForCwd(cwd: string): Promise<number> {
  return getRpcRegistry().destroyForCwd(cwd);
}

export { getRpcRegistry, normalizeRpcCwd };
