import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { RpcBroadcaster } = await jiti.import("./broadcaster.ts");
const { RpcRegistry } = await jiti.import("./registry.ts");
const { RpcSubscriber } = await jiti.import("./subscriber.ts");

// broadcaster 走模块单例（getRpcRegistry/getRpcSubscriber），数据在 globalThis；
// 每例测试前重置，并重建 broadcaster 实例（lastSnapshot 随实例重置）。
function resetState() {
  globalThis.__workspliceSessions = new Map();
  globalThis.__workspliceStartingSessionCwds = new Map();
  globalThis.__workspliceRunningListeners = new Set();
}

function makeWrapper({ id, running }) {
  return {
    sessionId: id,
    cwd: "/tmp/x",
    isRunning: () => running,
    destroy() {},
    shutdown: async () => undefined,
    onDestroy() {},
  };
}

test("broadcast notifies subscribers only when the running-id snapshot changes", () => {
  resetState();
  const broadcaster = new RpcBroadcaster();
  const subscriber = new RpcSubscriber();
  const registry = new RpcRegistry();
  registry.register("s1", makeWrapper({ id: "s1", running: true }));
  registry.register("s2", makeWrapper({ id: "s2", running: false }));

  const seen = [];
  subscriber.subscribe((ids) => seen.push(ids));

  broadcaster.broadcast();
  broadcaster.broadcast(); // 快照未变 → 不重复通知
  assert.deepEqual(seen, [["s1"]]);

  registry.register("s3", makeWrapper({ id: "s3", running: true }));
  broadcaster.broadcast();
  assert.deepEqual(seen, [["s1"], ["s1", "s3"]]);
});

test("broadcast resets its snapshot when no listeners are attached", () => {
  resetState();
  const broadcaster = new RpcBroadcaster();
  const subscriber = new RpcSubscriber();
  const registry = new RpcRegistry();
  registry.register("s1", makeWrapper({ id: "s1", running: true }));

  // 无订阅者时广播 → 快照被清空
  broadcaster.broadcast();

  const seen = [];
  subscriber.subscribe((ids) => seen.push(ids));
  // 首个订阅者收到自己的初始快照（即使运行集合与"清空前"相同）
  broadcaster.broadcast();
  assert.deepEqual(seen, [["s1"]]);
});

test("a listener throwing does not prevent other listeners from receiving", () => {
  resetState();
  const broadcaster = new RpcBroadcaster();
  const subscriber = new RpcSubscriber();
  const registry = new RpcRegistry();
  registry.register("s1", makeWrapper({ id: "s1", running: true }));

  const seen = [];
  subscriber.subscribe(() => { throw new Error("boom"); });
  subscriber.subscribe((ids) => seen.push(ids));

  broadcaster.broadcast();
  assert.deepEqual(seen, [["s1"]]);
});

test("getRunningIds reflects the current registry state", () => {
  resetState();
  const broadcaster = new RpcBroadcaster();
  const registry = new RpcRegistry();
  registry.register("s1", makeWrapper({ id: "s1", running: true }));
  registry.register("s2", makeWrapper({ id: "s2", running: false }));

  assert.deepEqual(broadcaster.getRunningIds(), ["s1"]);
});
