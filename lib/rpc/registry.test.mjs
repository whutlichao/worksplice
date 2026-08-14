import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { RpcRegistry } = await jiti.import("./registry.ts");

// registry 数据挂在 globalThis；每例测试前重置，保证隔离。
function resetRegistryState() {
  globalThis.__workspliceSessions = new Map();
  globalThis.__workspliceStartingSessionCwds = new Map();
}

/** 造一个 fake wrapper（结构上满足 registry 只依赖的成员）。 */
function makeWrapper({ id, cwd, running = false }) {
  const handlers = [];
  return {
    sessionId: id,
    cwd,
    isRunning: () => running,
    destroy() {
      for (const h of handlers) h();
      handlers.length = 0;
    },
    shutdown: async () => undefined,
    onDestroy(cb) {
      handlers.push(cb);
    },
  };
}

test("register/get: wrapper is retrievable and auto-unregisters on destroy", () => {
  resetRegistryState();
  const registry = new RpcRegistry();
  const wrapper = makeWrapper({ id: "s1", cwd: "/tmp/a" });

  registry.register("s1", wrapper);
  assert.equal(registry.get("s1"), wrapper);

  wrapper.destroy();
  assert.equal(registry.get("s1"), undefined);
});

test("hasBusyForCwd: running wrapper and starting window count as busy, idle does not", () => {
  resetRegistryState();
  const registry = new RpcRegistry();
  registry.register("idle", makeWrapper({ id: "idle", cwd: "/tmp/a", running: false }));
  registry.register("busy", makeWrapper({ id: "busy", cwd: "/tmp/b", running: true }));

  assert.equal(registry.hasBusyForCwd("/tmp/a"), false);
  assert.equal(registry.hasBusyForCwd("/tmp/b"), true);

  const finishStarting = registry.trackStarting("/tmp/c");
  assert.equal(registry.hasBusyForCwd("/tmp/c"), true);
  finishStarting();
  assert.equal(registry.hasBusyForCwd("/tmp/c"), false);
});

test("trackStarting is reference counted across concurrent starts", () => {
  resetRegistryState();
  const registry = new RpcRegistry();

  const finishA = registry.trackStarting("/tmp/d");
  const finishB = registry.trackStarting("/tmp/d");
  assert.equal(registry.hasBusyForCwd("/tmp/d"), true);

  finishA();
  assert.equal(registry.hasBusyForCwd("/tmp/d"), true);
  finishB();
  assert.equal(registry.hasBusyForCwd("/tmp/d"), false);
});

test("findBusyForCwd returns the running wrapper for the cwd only", () => {
  resetRegistryState();
  const registry = new RpcRegistry();
  const idle = makeWrapper({ id: "idle", cwd: "/tmp/a", running: false });
  const busy = makeWrapper({ id: "busy", cwd: "/tmp/a", running: true });
  const other = makeWrapper({ id: "other", cwd: "/tmp/b", running: true });
  registry.register("idle", idle);
  registry.register("busy", busy);
  registry.register("other", other);

  assert.equal(registry.findBusyForCwd("/tmp/a"), busy);
  assert.equal(registry.findBusyForCwd("/tmp/b"), other);
  assert.equal(registry.findBusyForCwd("/tmp/c"), undefined);
});

test("destroyForCwd gracefully shuts down only sessions under the cwd", async () => {
  resetRegistryState();
  const registry = new RpcRegistry();
  const shut = [];
  const mk = (id, cwd) => ({
    sessionId: id,
    cwd,
    isRunning: () => false,
    shutdown: async () => { shut.push(id); },
    destroy() {},
    onDestroy() {},
  });
  registry.register("a1", mk("a1", "/tmp/a"));
  registry.register("a2", mk("a2", "/tmp/a"));
  registry.register("b1", mk("b1", "/tmp/b"));

  const count = await registry.destroyForCwd("/tmp/a");

  assert.equal(count, 2);
  assert.deepEqual(shut.sort(), ["a1", "a2"]);
});

test("getRunningIds reports running wrappers by session id", () => {
  resetRegistryState();
  const registry = new RpcRegistry();
  registry.register("idle", makeWrapper({ id: "idle", cwd: "/tmp/a", running: false }));
  registry.register("busy", makeWrapper({ id: "busy", cwd: "/tmp/a", running: true }));

  assert.deepEqual(registry.getRunningIds(), ["busy"]);
});

test("normalizeRpcCwd resolves symlinks and falls back to the literal path", async () => {
  resetRegistryState();
  const { normalizeRpcCwd } = await jiti.import("./registry.ts");

  // 不存在/不可解析的路径回退为 resolve 后的字面路径。
  assert.equal(normalizeRpcCwd("/definitely/not/a/real/path-xyz"), "/definitely/not/a/real/path-xyz");
  assert.equal(normalizeRpcCwd("relative/thing"), `${process.cwd()}/relative/thing`);
});
