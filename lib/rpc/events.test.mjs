import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const {
  RpcBroadcaster,
  RpcSubscriber,
  getRunningRpcSessionIds,
  notifyRunningChange,
  subscribeRunningSessions,
} = await jiti.import("./events.ts");
const { RpcRegistry } = await jiti.import("./registry.ts");

// broadcast 内部走模块单例（getRpcSubscriber/getRpcRegistry），数据在 globalThis；
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

test("subscribe adds the listener and unsubscribe removes it", () => {
  resetState();
  const subscriber = new RpcSubscriber();
  const seen = [];
  const listener = (ids) => seen.push(ids);

  const unsubscribe = subscriber.subscribe(listener);
  assert.equal(subscriber.hasListeners(), true);

  subscriber.forEach((l) => l(["s1"]));
  assert.deepEqual(seen, [["s1"]]);

  unsubscribe();
  assert.equal(subscriber.hasListeners(), false);
  subscriber.forEach((l) => l(["s2"]));
  assert.deepEqual(seen, [["s1"]]);
});

test("subscribing the same listener twice keeps a single registration", () => {
  resetState();
  const subscriber = new RpcSubscriber();
  const registry = new RpcRegistry();
  const broadcaster = new RpcBroadcaster();
  registry.register("s1", makeWrapper({ id: "s1", running: true }));

  let calls = 0;
  const listener = () => { calls += 1; };
  const first = subscriber.subscribe(listener);
  subscriber.subscribe(listener);

  broadcaster.broadcast();
  assert.equal(calls, 1, "a duplicate subscription must not double-notify");

  // A Set-backed subscription set is idempotent: one removal clears the entry,
  // so the second unsubscribe must not be needed to stop delivery.
  first();
  assert.equal(subscriber.hasListeners(), false);

  registry.register("s2", makeWrapper({ id: "s2", running: true }));
  broadcaster.broadcast();
  assert.equal(calls, 1, "an unsubscribed listener receives nothing after cancellation");
});

test("forEach visits every listener", () => {
  resetState();
  const subscriber = new RpcSubscriber();
  const called = [];
  subscriber.subscribe(() => called.push("a"));
  subscriber.subscribe(() => called.push("b"));

  subscriber.forEach((l) => l());

  assert.deepEqual(called, ["a", "b"]);
});

test("clear empties the listener set", () => {
  resetState();
  const subscriber = new RpcSubscriber();
  subscriber.subscribe(() => {});

  subscriber.clear();

  assert.equal(subscriber.hasListeners(), false);
});

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

test("module-level helpers drive the same subscribe/broadcast surface", () => {
  resetState();
  const registry = new RpcRegistry();
  registry.register("s1", makeWrapper({ id: "s1", running: true }));

  const seen = [];
  const unsubscribe = subscribeRunningSessions((ids) => seen.push(ids));

  notifyRunningChange();
  assert.deepEqual(seen, [["s1"]]);
  assert.deepEqual(getRunningRpcSessionIds(), ["s1"]);

  unsubscribe();
  registry.register("s2", makeWrapper({ id: "s2", running: true }));
  notifyRunningChange();
  assert.deepEqual(seen, [["s1"]], "no delivery after unsubscribe");
});
