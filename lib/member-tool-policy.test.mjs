import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { CHIEF_TOOL_NAMES, resolveMemberToolPolicy } = await jiti.import("./member-tool-policy.ts");

// 票 chief-tool-surface：全局首席的会话只留 `read`，且不并回任何扩展 / 包工具。
// 判定层吃注入的结论（`isChief` 由调用方拿 `isSecretaryMember` 算出来），所以这里
// 不需要数据库、不需要 SDK，也不需要造一个「谁是首席」的身份。

test("首席会话恰好激活 read，且不并回扩展工具", () => {
  const policy = resolveMemberToolPolicy({ isChief: true });

  // 字面量是承重的：多一个名字（尤其 bash / write）就是把一次投递变成一次执行。
  assert.deepEqual(policy.toolNames, ["read"]);
  assert.equal(policy.includeExtensionTools, false);
});

test("首席的窄面不是「全部关闭」", () => {
  // `toolNames: []` 在 caller / session 里有**另一套**语义（关掉全部工具 + 强制空
  // system prompt，见 forced-empty-system-prompt）。窄面必须留一个真工具，
  // 否则首席连自己家目录都读不了，而且会顺带触发空 prompt 那条路径。
  const policy = resolveMemberToolPolicy({ isChief: true });

  assert.notDeepEqual(policy.toolNames, []);
  assert.ok(policy.toolNames.length > 0);
  assert.equal(policy.toolNames.includes("read"), true);
});

test("非首席成员得到空策略 —— 与今天的行为逐字节相同", () => {
  // 空策略 = caller 什么都不传：不传 toolNames、不传 includeExtensionTools。
  // 「少传一个键」和「传 undefined」在这里不是一回事，所以断言键根本不存在。
  const policy = resolveMemberToolPolicy({ isChief: false });

  assert.deepEqual(policy, {});
  assert.equal(policy.toolNames, undefined, "空策略不得落成 []——[] 是另一条语义（全部关闭）");
  assert.equal("toolNames" in policy, false);
  assert.equal("includeExtensionTools" in policy, false);
});

test("每次调用返回新数组，调用方改不动策略本体", () => {
  const first = resolveMemberToolPolicy({ isChief: true });
  first.toolNames.push("bash");

  assert.deepEqual(resolveMemberToolPolicy({ isChief: true }).toolNames, ["read"]);
  assert.deepEqual([...CHIEF_TOOL_NAMES], ["read"]);
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
