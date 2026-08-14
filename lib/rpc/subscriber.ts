// RpcSubscriber — running-session-id 订阅集合。
//
// 职责：维护"运行中会话 id 集合变化"的订阅者列表（subscribe/unsubscribe）。
// 广播本身由 RpcBroadcaster 负责（broadcaster.ts），本模块只持有订阅数据。
// 数据挂在 globalThis（__workspliceRunningListeners）以扛 Next.js 热重载；
// RpcSubscriber 实例本身无状态，随模块重生，不驻留 globalThis。

type RunningIdsListener = (ids: string[]) => void;

declare global {
  var __workspliceRunningListeners: Set<RunningIdsListener> | undefined;
}

export class RpcSubscriber {
  /** 订阅运行中会话 id 变化。返回取消订阅函数。 */
  subscribe(listener: RunningIdsListener): () => void {
    const listeners = this.listeners();
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

  private listeners(): Set<RunningIdsListener> {
    if (!globalThis.__workspliceRunningListeners) {
      globalThis.__workspliceRunningListeners = new Set();
    }
    return globalThis.__workspliceRunningListeners;
  }
}

let subscriberInstance: RpcSubscriber | null = null;

function getRpcSubscriber(): RpcSubscriber {
  if (!subscriberInstance) subscriberInstance = new RpcSubscriber();
  return subscriberInstance;
}

/** Subscribe to running-session-id changes. Returns an unsubscribe function. */
export function subscribeRunningSessions(listener: (ids: string[]) => void): () => void {
  return getRpcSubscriber().subscribe(listener);
}

export { getRpcSubscriber };
