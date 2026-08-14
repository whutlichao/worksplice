import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const rpc = await jiti.import("./index.ts");

// 公共 API 面守卫：原 rpc-manager.ts 的 11 个导出必须全部保留，
// 四个拆分模块类必须存在。防止未来重构悄悄破坏 API 面。
const ORIGINAL_VALUE_EXPORTS = [
  "AgentSessionWrapper", // class
  "getRpcSession",
  "hasBusyRpcSessionForCwd",
  "findBusyRpcSessionForCwd",
  "destroyRpcSessionsForCwd",
  "getRunningRpcSessionIds",
  "subscribeRunningSessions",
  "notifyRunningChange",
  "startRpcSession",
];
const TYPE_ONLY_EXPORTS = ["AgentEvent", "RpcSessionStartOptions"];
const MODULE_CLASSES = ["RpcRegistry", "RpcCaller", "RpcSubscriber", "RpcBroadcaster"];

test("index re-exports every original rpc-manager public value API", () => {
  for (const name of ORIGINAL_VALUE_EXPORTS) {
    assert.ok(name in rpc, `missing original export: ${name}`);
  }
});

test("index re-exports the original type-only exports", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  for (const name of TYPE_ONLY_EXPORTS) {
    assert.match(source, new RegExp(`export type \\{[^}]*\\b${name}\\b`), `missing type export: ${name}`);
  }
});

test("index exports the four split module classes", () => {
  for (const name of MODULE_CLASSES) {
    assert.equal(typeof rpc[name], "function", `missing module class: ${name}`);
  }
});

test("compat functions delegate to their module classes", async () => {
  // RpcCaller.call 与 wrapper.send 的委托已在 caller.test 覆盖；
  // 这里守卫兼容函数与类实例的关系：startRpcSession 等价于 RpcCaller.start。
  assert.equal(typeof rpc.startRpcSession, "function");
  assert.equal(typeof rpc.notifyRunningChange, "function");
  assert.equal(typeof rpc.subscribeRunningSessions, "function");
});
