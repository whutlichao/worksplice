import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

// 注册面（票 chief-tools）：领域工具的扩展工厂**只在** `domainTools` 在场时进入
// `resourceLoaderOptions.extensionFactories`，所以「非首席会话」的工具注册表里根本没有这几个名字。
//
// 这一层必须用**真会话**取证：判定层与工具面（`tools.test.mjs`）都证明不了「工厂进没进接缝」——
// 那一步只发生在 `RpcCaller.start` 里。

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-chief-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-chief-registration-"));
const dataDir = path.join(root, "data");
const chiefCwd = path.join(root, "chief-workspace");
const plainCwd = path.join(root, "plain-workspace");
fs.mkdirSync(chiefCwd, { recursive: true });
fs.mkdirSync(plainCwd, { recursive: true });

const { openDataDb } = await jiti.import("../data/sqlite.ts");
globalThis.__workspliceDb = openDataDb(dataDir);

const { RpcCaller } = await jiti.import("../rpc/caller.ts");
const { destroyRpcSessionsForCwd } = await jiti.import("../rpc/registry.ts");
const { createAgent, listChannels, setGlobalChief } = await jiti.import(
  "../domain/collab/index.ts",
);
const { CHIEF_DOMAIN_TOOL_NAMES, CHIEF_TOOL_NAMES } = await jiti.import("../member-tool-policy.ts");

test.after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  // 会话持有 idle 定时器：显式销毁，否则测试进程被吊住。
  await destroyRpcSessionsForCwd(chiefCwd).catch(() => {});
  await destroyRpcSessionsForCwd(plainCwd).catch(() => {});
  globalThis.__workspliceDb?.close();
  fs.rmSync(agentDir, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

const chief = createAgent({ name: "Susan" });
setGlobalChief(chief.id);
const plain = createAgent({ name: "worker" });

/** 激活面的事实来源（`getAllTools()` 不带 active 位；`get_tools` 命令走的就是这一条）。 */
function activeToolNames(session) {
  return [...session.inner.getActiveToolNames()].sort();
}

// ---------------------------------------------------------------------------
// 首席会话：六个名字注册进真会话，且激活面就是 CHIEF_TOOL_NAMES（不多不少）
// ---------------------------------------------------------------------------

test("首席会话注册六个领域工具，激活面恰好是 read + 六个领域工具", async () => {
  const { session } = await new RpcCaller().start("agent-chief", "", chiefCwd, {
    toolNames: [...CHIEF_TOOL_NAMES],
    includeExtensionTools: false,
    domainTools: { actorId: chief.id },
  });

  for (const name of CHIEF_DOMAIN_TOOL_NAMES) {
    assert.equal(typeof session.inner.getToolDefinition(name)?.execute, "function", `${name} 未注册`);
  }

  // 激活面收窄的证据：只有一个 read，没有任何执行 / 写文件的能力（bash / edit / write 不在）。
  assert.deepEqual(activeToolNames(session), [...CHIEF_TOOL_NAMES].sort());
  for (const forbidden of ["bash", "edit", "write", "grep", "find", "ls"]) {
    assert.equal(activeToolNames(session).includes(forbidden), false, `${forbidden} 不得进入首席会话`);
  }
});

test("真会话里的工具真的干活：channel_create 落到同一个数据库", async () => {
  const { session } = await new RpcCaller().start("agent-chief", "", chiefCwd, {
    toolNames: [...CHIEF_TOOL_NAMES],
    includeExtensionTools: false,
    domainTools: { actorId: chief.id },
  });

  const before = listChannels().length;
  const result = await session.inner
    .getToolDefinition("worksplice_channel_create")
    .execute("call-create", { name: "ops-from-session" }, undefined, undefined, { cwd: chiefCwd });

  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  assert.equal(listChannels().length, before + 1);
  const created = listChannels().find((channel) => channel.name === "ops-from-session");
  assert.ok(created, "频道必须真的建出来");
});

// ---------------------------------------------------------------------------
// 非首席会话：一个名字都没有 —— 不是「注册了但停用」
// ---------------------------------------------------------------------------

test("非首席会话的工具注册表里没有这六个名字（连定义都不存在）", async () => {
  const { session } = await new RpcCaller().start("agent-plain", "", plainCwd, {
    toolNames: ["read"],
    includeExtensionTools: false,
  });

  // 反向对照：同一个会话里 `read` 是有的，所以「没有」不是整张注册表空着。
  assert.equal(typeof session.inner.getToolDefinition("read")?.execute, "function");
  for (const name of CHIEF_DOMAIN_TOOL_NAMES) {
    assert.equal(session.inner.getToolDefinition(name), undefined, `${name} 不得被注册`);
    assert.equal(activeToolNames(session).includes(name), false, `${name} 不得被激活`);
  }
});

test("非首席成员的身份也不能靠 domainTools 绕过：actor 不是首席时工具照样拒绝", async () => {
  // 工厂可以被显式传进来（测试/未来路径），但**每次调用**都会复判身份——这一层不靠注册面兜底。
  const { session } = await new RpcCaller().start("agent-plain", "", plainCwd, {
    toolNames: [...CHIEF_TOOL_NAMES, "read"],
    includeExtensionTools: false,
    domainTools: { actorId: plain.id },
  });

  const result = await session.inner
    .getToolDefinition("worksplice_list_channels")
    .execute("call-refused", {}, undefined, undefined, { cwd: plainCwd });
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, "Only the global chief may use this tool");
});

// ---------------------------------------------------------------------------
// 接线：源码级断言（与 lib/rpc/tool-surface.test.mjs 同一档）
// ---------------------------------------------------------------------------

test("caller 把领域工具挂在 domainTools 在场时才进入 extensionFactories", async () => {
  const caller = await readFile(new URL("../rpc/caller.ts", import.meta.url), "utf8");

  assert.match(caller, /domainTools/);
  // 条件展开：没有 domainTools 就整条不进数组（不是进数组后再判空）。
  assert.match(caller, /\.\.\.\(domainTools \? \[chiefToolsExtension\(/);
  assert.match(caller, /chiefToolsExtension\(\{ actorId: domainTools\.actorId \}\)/);
});

test("agent-runtime 只给首席成员传 domainTools，且与工具面策略同源", async () => {
  const runtime = await readFile(new URL("../agent-runtime.ts", import.meta.url), "utf8");

  assert.match(runtime, /const isChief = isSecretaryMember\(member\)/);
  assert.match(runtime, /resolveMemberToolPolicy\(\{ isChief \}\)/);
  assert.match(runtime, /\.\.\.\(isChief \? \{ domainTools: \{ actorId: member\.id \} \} : \{\}\)/);
});
