import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  CHANNEL_CHIEF_TOOL_NAMES,
  CHIEF_DOMAIN_TOOL_NAMES,
  CHIEF_TOOL_NAMES,
  resolveMemberToolPolicy,
} = await jiti.import("./member-tool-policy.ts");

// 票 chief-tool-surface（第二 / 三批）：全局首席的会话 = `read` + 六个领域工具，且仍不并回任何
// 扩展 / 包工具。判定层吃注入的结论（`chiefScope` 由调用方拿 `isSecretaryMember` /
// `isChiefOfAnyChannel` 算出来），所以这里不需要数据库、不需要 SDK，也不需要造一个
// 「谁是首席」的身份。

/**
 * 六个领域工具名逐字钉住：这张清单同时是「注册面」与「激活面」的唯一来源——
 * 名字对不上就会「注册了但永远不被激活」，而它恰恰是给 agent 开系统操作的那个口子。
 */
const DOMAIN_TOOL_NAMES = [
  "worksplice_list_channels",
  "worksplice_list_members",
  "worksplice_list_tasks",
  "worksplice_channel_create",
  "worksplice_agent_create",
  "worksplice_task_create",
];

test("领域工具清单恰好是这六个名字", () => {
  assert.deepEqual([...CHIEF_DOMAIN_TOOL_NAMES], DOMAIN_TOOL_NAMES);
});

// 票 #272：频道首席只补一个最小写面。这个清单同时是频道 surface 的注册面与激活面——
// 多一个名字就是把读面或管理员写面偷偷扩给频道首席。
const CHANNEL_TOOL_NAMES = ["worksplice_task_create"];

test("频道首席子集恰好只有 worksplice_task_create", () => {
  assert.deepEqual([...CHANNEL_CHIEF_TOOL_NAMES], CHANNEL_TOOL_NAMES);
});

// 第三批（票 chief-task-create）只加一个写面：把既有消息转成任务。名字必须以字面量出现在
// 激活面上——注册侧从同一份清单取齐定义名（`assertPolicyCoverage` 会抛），这条断言守住的是
// 「加进定义了但忘了激活」那半边。
test("worksplice_task_create 同时出现在全局与频道激活面", () => {
  assert.equal(CHIEF_DOMAIN_TOOL_NAMES.includes("worksplice_task_create"), true);
  assert.equal(CHIEF_TOOL_NAMES.includes("worksplice_task_create"), true);
  assert.equal(CHIEF_TOOL_NAMES.length, 1 + DOMAIN_TOOL_NAMES.length);
  assert.deepEqual([...CHANNEL_CHIEF_TOOL_NAMES], ["worksplice_task_create"]);
});

test("global 首席会话恰好激活 read + 六个领域工具，且不并回扩展工具", () => {
  const policy = resolveMemberToolPolicy({ chiefScope: "global" });

  // 字面量是承重的：多一个名字（尤其 bash / write）就是把一次投递变成一次执行。
  assert.deepEqual(policy.toolNames, ["read", ...DOMAIN_TOOL_NAMES]);
  assert.equal(policy.includeExtensionTools, false);
});

test("global 窄面不是「全部关闭」", () => {
  // `toolNames: []` 在 caller / session 里有**另一套**语义（关掉全部工具 + 强制空
  // system prompt，见 forced-empty-system-prompt）。窄面必须留一个真工具，
  // 否则首席连自己家目录都读不了，而且会顺带触发空 prompt 那条路径。
  const policy = resolveMemberToolPolicy({ chiefScope: "global" });

  assert.notDeepEqual(policy.toolNames, []);
  assert.ok(policy.toolNames.length > 0);
  assert.equal(policy.toolNames.includes("read"), true);
});

test("channel 首席得到空策略 —— 保留自己的普通工具面，不写成 toolNames 清单", () => {
  // 频道首席的普通工具面（内置 + 扩展）不收窄；额外的 task_create 走 domainTools 的
  // channel surface 以 defaultActive 补进来。写成 toolNames:[...] 会把 bash / write /
  // 扩展工具全部关掉，那是完全不同的行为。
  const policy = resolveMemberToolPolicy({ chiefScope: "channel" });

  assert.deepEqual(policy, {});
  assert.equal(policy.toolNames, undefined, "channel 策略不得落成 []——[] 是另一条语义（全部关闭）");
  assert.equal("toolNames" in policy, false);
  assert.equal("includeExtensionTools" in policy, false);
});

test("none 得到空策略 —— 与今天的行为逐字节相同", () => {
  // 空策略 = caller 什么都不传：不传 toolNames、不传 includeExtensionTools。
  // 「少传一个键」和「传 undefined」在这里不是一回事，所以断言键根本不存在。
  const policy = resolveMemberToolPolicy({ chiefScope: "none" });

  assert.deepEqual(policy, {});
  assert.equal(policy.toolNames, undefined, "空策略不得落成 []——[] 是另一条语义（全部关闭）");
  assert.equal("toolNames" in policy, false);
  assert.equal("includeExtensionTools" in policy, false);
});

test("每次调用返回新数组，调用方改不动策略本体", () => {
  const first = resolveMemberToolPolicy({ chiefScope: "global" });
  first.toolNames.push("bash");

  assert.deepEqual(resolveMemberToolPolicy({ chiefScope: "global" }).toolNames, ["read", ...DOMAIN_TOOL_NAMES]);
  assert.deepEqual([...CHIEF_TOOL_NAMES], ["read", ...DOMAIN_TOOL_NAMES]);
});

// ---------------------------------------------------------------------------
// 零依赖：判定层不得把 SDK / Next / React / DB 拖进来（与 lib/pi-env-status.ts
// 同一套纪律）。纯单测能跑起来就是证据，这条源码断言守的是「以后别顺手 import」。
// ---------------------------------------------------------------------------

test("判定层不 import SDK / Next / React / DB", async () => {
  const source = await readFile(new URL("./member-tool-policy.ts", import.meta.url), "utf8");
  const imports = [...source.matchAll(/^\s*import\s.*?from\s+["'](.+?)["']/gm)].map((m) => m[1]);

  assert.deepEqual(imports, [], `判定层不得有任何运行时 import，实际：${imports.join(", ")}`);
  assert.doesNotMatch(source, /better-sqlite3/);
  assert.doesNotMatch(source, /@earendil-works\//);
});
