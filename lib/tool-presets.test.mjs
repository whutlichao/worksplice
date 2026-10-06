import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  CODING_TOOL_NAMES,
  PRESET_DEFAULT,
  PRESET_FULL,
  PRESET_NONE,
  getPresetFromTools,
  getToolNamesForPreset,
} = await jiti.import("./tool-presets.ts");

// The activation set each tier must keep. Pinning the literal here is the point: the
// SDK-upgrade work moved this list out of `lib/rpc/session.ts` into a single shared
// definition, and "no tier changed meaning" is a behaviour claim that only a literal
// can guard. Membership is a *set* — `setActiveToolsByName` activates by name, so the
// declaration order is free to change but the contents are not.
const BASELINE = {
  none: [],
  default: ["read", "bash", "edit", "write"],
  full: ["bash", "read", "edit", "write", "grep", "find", "ls"],
};

const sameSet = (actual, expected) =>
  JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());

test("each preset keeps its exact activation set", () => {
  assert.deepEqual(PRESET_NONE, []);
  assert.equal(sameSet(PRESET_DEFAULT, BASELINE.default), true, `PRESET_DEFAULT drifted: ${PRESET_DEFAULT}`);
  assert.equal(sameSet(PRESET_FULL, BASELINE.full), true, `PRESET_FULL drifted: ${PRESET_FULL}`);
  assert.equal(sameSet(CODING_TOOL_NAMES, BASELINE.full), true, "CODING_TOOL_NAMES drifted");
});

test("the preset tiers are internally consistent", () => {
  // DEFAULT must remain a strict subset of FULL: if it ever grew a name FULL lacks,
  // activating DEFAULT would request a tool the FULL tier considers out of scope.
  for (const name of PRESET_DEFAULT) {
    assert.equal(PRESET_FULL.includes(name), true, `PRESET_DEFAULT name "${name}" is not in PRESET_FULL`);
  }
  assert.equal(new Set([...PRESET_DEFAULT, ...PRESET_FULL]).size, PRESET_FULL.length);
});

test("getToolNamesForPreset returns each tier verbatim when no registry is supplied", () => {
  for (const preset of ["none", "default", "full"]) {
    const expected = preset === "none" ? BASELINE.none : preset === "default" ? BASELINE.default : BASELINE.full;
    assert.equal(sameSet(getToolNamesForPreset(preset), expected), true, `${preset} drifted`);
  }
  // Callers mutate nothing, so a preset cannot be edited by handing the result around.
  const names = getToolNamesForPreset("full");
  names.push("mutated");
  assert.equal(PRESET_FULL.includes("mutated"), false);
});

// ADR-0007 决策 5: a preset is a *request*; the session's `getAllTools()` is what
// actually exists. Names the session does not have are dropped rather than sent as
// permanently-unresolvable requests.
test("getToolNamesForPreset filters against the session's available tools", () => {
  const available = [
    { name: "read", description: "Read a file", active: true },
    { name: "write", description: "Write a file", active: true },
    { name: "some_extension_tool", description: "From an extension", active: true },
  ];

  assert.deepEqual(getToolNamesForPreset("default", available), ["read", "write"]);
  assert.deepEqual(getToolNamesForPreset("full", available), ["read", "write"]);
  assert.deepEqual(getToolNamesForPreset("none", available), []);

  // An empty registry yields an empty request, never the unfiltered names.
  assert.deepEqual(getToolNamesForPreset("full", []), []);
  // Extension tools are never pulled in by a preset — that is what `withExtensionTools`
  // is for.
  assert.equal(getToolNamesForPreset("full", available).includes("some_extension_tool"), false);
});

test("getPresetFromTools round-trips the tiers", () => {
  const toEntries = (names) => names.map((name) => ({ name, description: "", active: true }));

  assert.equal(getPresetFromTools([]), "none");
  assert.equal(getPresetFromTools(toEntries(BASELINE.none)), "none");
  assert.equal(getPresetFromTools(toEntries(BASELINE.default)), "default");
  assert.equal(getPresetFromTools(toEntries(BASELINE.full)), "full");

  // A partial selection is not a tier; it falls back to "default" so the UI always
  // shows a preset the user can actually reach.
  assert.equal(getPresetFromTools(toEntries(["read", "bash"])), "default");
  // Extension tools are ignored when classifying, so they cannot turn "default" into
  // something unrecognised.
  assert.equal(
    getPresetFromTools([...toEntries(BASELINE.default), { name: "ext_tool", description: "", active: true }]),
    "default",
  );
  // Nothing active at all is "none", not "default".
  assert.equal(
    getPresetFromTools([{ name: "read", description: "", active: false }]),
    "none",
  );
});

// The convergence this upgrade performed: the coding-tool names lived twice, here and
// in `lib/rpc/session.ts`, so the two copies could drift. There is now one definition.
test("lib/rpc/session.ts consumes the shared tool list instead of redeclaring it", async () => {
  const source = await readFile(new URL("./rpc/session.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ CODING_TOOL_NAMES \} from "\.\.\/tool-presets"/);
  assert.equal(
    /const CODING_TOOL_NAMES\s*=/.test(source),
    false,
    "the coding-tool names must not be declared a second time in lib/rpc/session.ts",
  );
  // The only use is the extension-tool merge, so the shared list still guards that path.
  assert.match(source, /new Set\(CODING_TOOL_NAMES\)/);
});
// ---------------------------------------------------------------------------
// 「成员会话不得激活具备网络能力的扩展工具」的落地形态（ADR-0013 残留 #2 /
// 设计文档 Testing Decisions 的「一条断言或一份显式豁免清单」）：两者都给——
//   断言：内置工具面被钉住，且**唯一**具备网络能力的内置工具是 bash；
//   显式豁免清单：扩展 / 包提供的工具本仓无法声明其能力（没有「扩展工具声明网络能力」
//   这一层），因此显式豁免、不做工具审计（ADR-0013 残留 #2）；bash 归票 05 的沙箱两阶段
//   （阶段 A 无沙箱不激活 bash；阶段 B 内核按端口过滤），本票不动。
// 新增内置工具时这个测试会失败，逼一次「它能不能碰网络」的显式判断。
// ---------------------------------------------------------------------------

const NETWORK_CAPABLE_BUILTIN_TOOLS = ["bash"];

test("the builtin tool surface is pinned and bash is its only network-capable member", () => {
  assert.deepEqual(
    [...CODING_TOOL_NAMES].sort(),
    ["bash", "edit", "find", "grep", "ls", "read", "write"],
  );
  assert.deepEqual(NETWORK_CAPABLE_BUILTIN_TOOLS, ["bash"]);
  for (const name of NETWORK_CAPABLE_BUILTIN_TOOLS) {
    assert.equal(CODING_TOOL_NAMES.includes(name), true, `${name} 必须仍在内置面里`);
  }
  for (const name of CODING_TOOL_NAMES) {
    if (name === "bash") continue;
    assert.equal(
      NETWORK_CAPABLE_BUILTIN_TOOLS.includes(name),
      false,
      `${name} 不在网络能力清单里——若它新增了网络能力，显式更新该清单与票据残留 #2`,
    );
  }
});
