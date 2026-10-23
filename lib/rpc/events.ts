// events — 运行中会话 id 集合的订阅与广播（原 subscriber.ts + broadcaster.ts 合并）。
//
// 窄事件面由三部分组成：
//   - 订阅集合：subscribe / unsubscribe / forEach / hasListeners（RpcSubscriber，无状态）；
//   - 快照去重广播：broadcast() 仅在运行集合相对上次快照变化时推送（RpcBroadcaster）；
//   - getRunningIds()：登记表侧的快照查询门面。
//
// 订阅集合挂在 globalThis（__workspliceRunningListeners）以扛 Next.js 热重载；
// lastSnapshot 是 broadcaster 的实例字段——实例为模块级单例，热重载后随模块重生
// 而重置，与原 rpc-manager.ts 的模块级 lastRunningSnapshot 语义一致。

import { getRpcRegistry } from "./registry.ts";

type RunningIdsListener = (ids: string[]) => void;

declare global {
  var __workspliceRunningListeners: Set<RunningIdsListener> | undefined;
}

function runningListeners(): Set<RunningIdsListener> {
  if (!globalThis.__workspliceRunningListeners) {
    globalThis.__workspliceRunningListeners = new Set();
  }
  return globalThis.__workspliceRunningListeners;
}

export class RpcSubscriber {
  /** 订阅运行中会话 id 变化。返回取消订阅函数；重复订阅同一 listener 只保留一份。 */
  subscribe(listener: RunningIdsListener): () => void {
    const listeners = runningListeners();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  /** 是否有任何订阅者（broadcaster 据此决定快照去重/重置策略）。 */
  hasListeners(): boolean {
    return (globalThis.__workspliceRunningListeners?.size ?? 0) > 0;
  }

  /** 遍历全部订阅者（广播用）。单个 listener 抛错不影响其余。 */
  forEach(fn: (listener: RunningIdsListener) => void): void {
    const listeners = globalThis.__workspliceRunningListeners;
    if (!listeners) return;
    for (const listener of Array.from(listeners)) fn(listener);
  }

  /** 清空订阅集合（测试隔离/热重载兜底）。 */
  clear(): void {
    globalThis.__workspliceRunningListeners = new Set();
  }
}

export class RpcBroadcaster {
  private lastSnapshot = "";

  /**
   * 重算运行中会话 id 集合；与上次通知的快照不同才推送给订阅者。
   * 无订阅者时清空快照——未来的订阅者收到自己的初始快照，其首个状态转移不会
   * 撞上旧 listener 的陈旧态。
   */
  broadcast(): void {
    const subscriber = getRpcSubscriber();
    if (!subscriber.hasListeners()) {
      this.lastSnapshot = "";
      return;
    }
    const ids = getRpcRegistry().getRunningIds();
    const snapshot = JSON.stringify([...ids].sort());
    if (snapshot === this.lastSnapshot) return;
    this.lastSnapshot = snapshot;
    subscriber.forEach((listener) => {
      try { listener(ids); } catch { /* 忽略 listener 抛错 */ }
    });
  }

  /** 当前运行中会话 id 集合。 */
  getRunningIds(): string[] {
    return getRpcRegistry().getRunningIds();
  }
}

let subscriberInstance: RpcSubscriber | null = null;

function getRpcSubscriber(): RpcSubscriber {
  if (!subscriberInstance) subscriberInstance = new RpcSubscriber();
  return subscriberInstance;
}

let broadcasterInstance: RpcBroadcaster | null = null;

function getRpcBroadcaster(): RpcBroadcaster {
  if (!broadcasterInstance) broadcasterInstance = new RpcBroadcaster();
  return broadcasterInstance;
}

/** 订阅运行中会话 id 变化。返回取消订阅函数。 */
export function subscribeRunningSessions(listener: (ids: string[]) => void): () => void {
  return getRpcSubscriber().subscribe(listener);
}

/** 当前运行中会话 id 集合。 */
export function getRunningRpcSessionIds(): string[] {
  return getRpcBroadcaster().getRunningIds();
}

/** 重算运行中 id 集合并按快照去重广播。 */
export function notifyRunningChange(): void {
  getRpcBroadcaster().broadcast();
}
