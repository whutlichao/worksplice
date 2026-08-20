// lib/cwd-mutex — Cwd 互斥唯一事实来源（ticket 11，01/04/05/06 收敛）。
//
// 职责：共享同一项目目录的并发会话串行门禁——窄接口 `withCwdMutex/isCwdBusy/findBusySession`
//（`realpathSync` 归一 + per-cwd 窗口计数 + `waitForSettle(SETTLE_EVENTS)` + `BUSY_CWD_RETRY_DELAY_MS`）
// 共 `agent-runtime`（startSession 的 busy 检查 + per-cwd 启动互斥）与 `agent-loop/driver`
//（hint 合并 busy 重试，不丢 wake）复用；热重载守卫挂 globalThis。
//
// 原分散实现：`lib/rpc/registry.ts` 的 `normalizeRpcCwd/trackStarting/hasBusyForCwd/findBusyForCwd`
// 与 `lib/agent-runtime.ts` 的 `withCwdStartLock` 各自按 `realpathSync` 归一，各自持有
// `__workspliceStartingSessionCwds/__workspliceCwdStartLocks`，`lib/agent-loop/loop.ts` 的
// `SETTLE_EVENTS/BUSY_CWD_RETRY_DELAY_MS/waitForSettle` 各自监听；本模块收敛为单一来源。
//
// 纯模块可测（zero SDK / zero HTTP / zero DB）：全部状态挂 globalThis 的 Map，测试可注入 fake
// session；文件系统归一可用真实临时目录/符号链接验证。

import { realpathSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// 热重载守卫：全部挂 globalThis（与原 registry.ts / agent-runtime.ts / loop.ts 同键名，
// 旧数据在热重载后仍可见，行为无缝衔接）。
// ---------------------------------------------------------------------------

declare global {
  var __workspliceCwdStartLocks: Map<string, Promise<unknown>> | undefined;
  var __workspliceStartingSessionCwds: Map<string, number> | undefined;
}

// ---------------------------------------------------------------------------
// 归一化：realpath + resolve（与原 normalizeRpcCwd / withCwdStartLock 的 resolve+realpathSync 同基准）
// ---------------------------------------------------------------------------

export function normalizeCwd(cwd: string): string {
  const resolved = resolve(cwd);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

// 兼容别名：旧调用点 `normalizeRpcCwd` 仍可用（registry.ts 曾导出它）。
export const normalizeRpcCwd = normalizeCwd;

// ---------------------------------------------------------------------------
// per-cwd 启动互斥：把 [busy 检查 → 文件选择 → 启动] 串行化（02-决策二）
// 键按 realpath 归一；链式 Promise 挂 globalThis（热重载安全）；失败的 holder 不阻塞后继。
// ---------------------------------------------------------------------------

function getCwdStartLocks(): Map<string, Promise<unknown>> {
  if (!globalThis.__workspliceCwdStartLocks) {
    globalThis.__workspliceCwdStartLocks = new Map();
  }
  return globalThis.__workspliceCwdStartLocks;
}

export function withCwdMutex<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const key = normalizeCwd(cwd);
  const locks = getCwdStartLocks();
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

// 兼容别名：旧调用点 `withCwdStartLock` 仍可用（agent-runtime.ts 曾导出它）。
export const withCwdStartLock = withCwdMutex;

// ---------------------------------------------------------------------------
// per-cwd 启动窗口计数器：starting 置位期间（wrapper 尚未入 registry 但已开始创建）
// 也算 busy，避免并发唤醒在窗口内漏判。计数器支持多并发启动（引用计数）。
// ---------------------------------------------------------------------------

function getStartingCwds(): Map<string, number> {
  if (!globalThis.__workspliceStartingSessionCwds) {
    globalThis.__workspliceStartingSessionCwds = new Map();
  }
  return globalThis.__workspliceStartingSessionCwds;
}

export function trackStarting(cwd: string): () => void {
  const startingCwds = getStartingCwds();
  const key = normalizeCwd(cwd);
  startingCwds.set(key, (startingCwds.get(key) ?? 0) + 1);
  return () => {
    const remaining = (startingCwds.get(key) ?? 1) - 1;
    if (remaining > 0) startingCwds.set(key, remaining);
    else startingCwds.delete(key);
  };
}

// ---------------------------------------------------------------------------
// busy 探测：starting 窗口内即 busy；否则检查注册表内是否有 running wrapper。
// isCwdBusy / findBusySession 均为窄接口，供 agent-runtime 与 driver 共用。
// ---------------------------------------------------------------------------

function getSessions(): Map<string, { cwd: string; isRunning(): boolean }> {
  return ((globalThis as unknown as { __workspliceSessions?: Map<string, { cwd: string; isRunning(): boolean }> }).__workspliceSessions as Map<string, { cwd: string; isRunning(): boolean }>) ?? new Map();
}

export function isCwdBusy(cwd: string): boolean {
  const target = normalizeCwd(cwd);
  if (getStartingCwds().has(target)) return true;
  for (const session of getSessions().values()) {
    if (normalizeCwd(session.cwd) === target && session.isRunning()) return true;
  }
  return false;
}

export function findBusySession(cwd: string): { cwd: string; isRunning(): boolean; onEvent?(listener: (event: { type: string }) => void): () => void } | undefined {
  const target = normalizeCwd(cwd);
  for (const session of getSessions().values()) {
    if (normalizeCwd((session as { cwd: string }).cwd) === target && (session as { isRunning(): boolean }).isRunning()) return session as { cwd: string; isRunning(): boolean; onEvent?(listener: (event: { type: string }) => void): () => void };
  }
  return undefined;
}

// 兼容别名：旧调用点 `hasBusyRpcSessionForCwd / findBusyRpcSessionForCwd` 仍可用。
export const hasBusyRpcSessionForCwd = isCwdBusy;
export const findBusyRpcSessionForCwd = findBusySession;
// registry 曾以方法形式暴露 hasBusyForCwd/findBusyForCwd；此处保留别名供旧测试兼容（若直接 import registry）。
export const hasBusyForCwd = isCwdBusy;
export const findBusyForCwd = findBusySession;

// ---------------------------------------------------------------------------
// settle 等待原语：PROMPT_DONE_EVENTS + compaction 收口的完整等待面（02-决策一的等待对象）
// + 找不到等待对象时的退避（BUSY_CWD_RETRY_DELAY_MS）。纯函数可测（zero SDK）。
// ---------------------------------------------------------------------------

export const PROMPT_DONE_EVENTS = new Set(["prompt_done", "agent_end", "agent_settled"]);
export const SETTLE_EVENTS = new Set([...PROMPT_DONE_EVENTS, "compaction_end", "auto_compaction_end"]);
export const BUSY_CWD_RETRY_DELAY_MS = 250;

export interface SettleableSession {
  isRunning(): boolean;
  onEvent(listener: (event: { type: string }) => void): () => void;
}

/**
 * 等待会话 settle：订阅 SETTLE_EVENTS，任意 settle 事件到达即回调 onSettled；
 * 订阅后立即复核 isRunning()——已空闲则立即回调（覆盖订阅窗口竞态，ticket 01-d）。
 * 返回取消订阅函数（与 driver 的 settleUnsubs 同纪律，可在 stop() 时取消）。
 */
export function waitForSettle(session: SettleableSession, onSettled: () => void): () => void {
  let settled = false;
  const done = () => {
    if (settled) return;
    settled = true;
    try {
      unsub();
    } catch {
      // ignore
    }
    onSettled();
  };
  const unsub = session.onEvent((event) => {
    if (SETTLE_EVENTS.has(event.type)) done();
  });
  // 订阅窗口竞态：busy 判定与订阅之间会话可能已收口，settle 事件发在无人监听时。
  // 订阅后复核 isRunning()——已空闲则立即重试，避免 hint 永久挂起。
  if (!session.isRunning()) {
    done();
  }
  return () => {
    if (!settled) {
      settled = true;
      try {
        unsub();
      } catch {
        // ignore
      }
    }
  };
}

/**
 * busy-cwd 找不到等待对象时的退避调度（02-终检整改）：
 * starting 窗口内 wrapper 尚未入 registry——立即重试会热自旋（每轮 drain + startSession 空转），
 * 退避把自旋压到有界（BUSY_CWD_RETRY_DELAY_MS）。返回取消函数（clearTimeout）。
 */
export function scheduleBusyRetry(onRetry: () => void, delayMs = BUSY_CWD_RETRY_DELAY_MS): () => void {
  const timer = setTimeout(onRetry, delayMs);
  return () => clearTimeout(timer as unknown as NodeJS.Timeout);
}
