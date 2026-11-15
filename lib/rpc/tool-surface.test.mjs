import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper, withExtensionTools } = await jiti.import("./session.ts");

// 票 chief-tool-surface：`withExtensionTools` 的第三个参数 = 「要不要把扩展 / 包工具并回」。
// 它是窄面会话与既有会话之间**唯一**的行为分叉点，所以两档都必须钉住：
//   - 省略（今天的行为）= 并回扩展工具；
//   - `false` = 只留传入的清单，扩展工具一个都不进来。
// 第二个执行点是 wrapper 的 `set_tools` 命令：它必须沿用**本会话创建时**的开关，
// 否则窄面会话被一次 UI 档位切换就自己放大回去了。

/** 一个带扩展工具的假 inner：`getAllTools()` 里既有内置工具也有扩展工具。 */
function fakeInner() {
  const calls = { setActiveToolsByName: [] };
  return {
    isBashRunning: false,
    extensionRunner: { async emit() {} },
    dispose() {},
    getAllTools: () => [
      { name: "read", description: "Read a file", active: false },
      { name: "bash", description: "Run a command", active: false },
      { name: "subagents", description: "From an installed package", active: false },
    ],
    setActiveToolsByName(names) {
      calls.setActiveToolsByName.push([...names]);
    },
    calls,
  };
}

test("includeExtensionTools=false 只留传入的清单，扩展工具一个都不并回", () => {
  assert.deepEqual(withExtensionTools(fakeInner(), ["read"], false), ["read"]);
});

test("省略第三个参数时行为与今天一致：扩展工具仍被并回", () => {
  // 这条是「不改变现状」的护栏：默认值一旦从 true 变成 false，所有既有会话的
  // 扩展 / 包工具都会静默消失（subagents、web access 之类）。
  assert.deepEqual(withExtensionTools(fakeInner(), ["read"]), ["read", "subagents"]);
  assert.deepEqual(withExtensionTools(fakeInner(), ["read"], true), ["read", "subagents"]);
});

test("空清单的全关语义不受第三个参数影响", () => {
  // `toolNames: []` = 全部关闭（caller 侧还连带强制空 system prompt）。它是**另一条**
  // 语义，不能被「窄面」这件事顺手改掉。
  assert.deepEqual(withExtensionTools(fakeInner(), [], false), []);
  assert.deepEqual(withExtensionTools(fakeInner(), []), []);
});

test("窄面会话的 set_tools 不会把扩展工具重新并回来", async () => {
  const inner = fakeInner();
  const wrapper = new AgentSessionWrapper(inner, { enabled: false }, undefined, false);
  try {
    await wrapper.send({ type: "set_tools", toolNames: ["read"] });
    assert.deepEqual(inner.calls.setActiveToolsByName, [["read"]]);
  } finally {
    wrapper.destroy();
  }
});

test("默认会话的 set_tools 仍沿用今天的并回行为", async () => {
  const inner = fakeInner();
  const wrapper = new AgentSessionWrapper(inner, { enabled: false });
  try {
    await wrapper.send({ type: "set_tools", toolNames: ["read"] });
    assert.deepEqual(inner.calls.setActiveToolsByName, [["read", "subagents"]]);
  } finally {
    wrapper.destroy();
  }
});

// ---------------------------------------------------------------------------
// 接线：SDK 依赖太重，起一个真会话无法观察「开关有没有传下去」，所以这一层用源码
// 断言（与 lib/rpc/caller.test.mjs / lib/tool-presets.test.mjs 同一档）。
// ---------------------------------------------------------------------------

test("caller 把开关传给两条执行点（创建时的激活面 + wrapper 的 set_tools）", async () => {
  const caller = await readFile(new URL("./caller.ts", import.meta.url), "utf8");

  assert.match(caller, /includeExtensionTools = true/);
  assert.match(caller, /withExtensionTools\(inner, toolNames, includeExtensionTools\)/);
  // 构造调用的形状由代码自己定，这里只断言「开关被交给了 wrapper」——按片段取值，
  // 不断言换行与实参顺序（那种断言会在纯格式改动上无意义地变红）。
  const wrapperCall = caller.slice(
    caller.indexOf("new AgentSessionWrapper("),
    caller.indexOf("wrapper.setForceEmptySystemPrompt"),
  );
  assert.notEqual(wrapperCall, "");
  assert.match(wrapperCall, /includeExtensionTools/);
});

test("agent-runtime 把成员策略一并传进 startRpcSession", async () => {
  const runtime = await readFile(new URL("../agent-runtime.ts", import.meta.url), "utf8");

  assert.match(runtime, /resolveMemberToolPolicy\(/);
  assert.match(runtime, /isSecretaryMember\(member\)/);
  // 策略与路径守卫相邻算出，一起进 options；不写成两段各算一次的 if。
  assert.match(runtime, /pathGuard: pathGuardScopeFor\(/);
  assert.match(runtime, /\.\.\.memberToolPolicy/);
});
