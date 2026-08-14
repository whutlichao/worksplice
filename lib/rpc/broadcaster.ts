// RpcBroadcaster — 运行中会话 id 集合的变化广播。
//
// 职责：broadcast() 重算运行中 id 集合，若与上次快照不同则推送给全部订阅者
// （订阅集合由 RpcSubscriber 持有）；getRunningIds() 是快照查询门面。
// lastSnapshot 为实例字段：实例是模块级单例，热重载后随模块重生而重置，
// 与原 rpc-manager.ts 的模块级 lastRunningSnapshot 语义一致。

import { getRpcRegistry } from "./registry.ts";
import { getRpcSubscriber } from "./subscriber.ts";

export class RpcBroadcaster {
  private lastSnapshot = "";

  /**
   * Recompute the running-session-id set and, if it changed since the last
   * notification, broadcast it to subscribers. 无订阅者时清空快照——未来的
   * 订阅者收到自己的初始快照，其首个状态转移不会撞上旧 listener 的陈旧态。
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
      try { listener(ids); } catch { /* ignore listener errors */ }
    });
  }

  /** 当前运行中会话 id 集合。 */
  getRunningIds(): string[] {
    return getRpcRegistry().getRunningIds();
  }
}

let broadcasterInstance: RpcBroadcaster | null = null;

function getRpcBroadcaster(): RpcBroadcaster {
  if (!broadcasterInstance) broadcasterInstance = new RpcBroadcaster();
  return broadcasterInstance;
}

/** 当前运行中会话 id 集合。 */
export function getRunningRpcSessionIds(): string[] {
  return getRpcBroadcaster().getRunningIds();
}

/**
 * Recompute the running-session-id set and, if it changed since the last
 * notification, broadcast it to subscribers.
 */
export function notifyRunningChange(): void {
  getRpcBroadcaster().broadcast();
}
