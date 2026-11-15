import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });

// 工具面（票 chief-tools）：五个领域工具在**真数据库**上的外部行为——chief 复判、参数拒绝、
// 读写效果、配额、系统事件留痕。工具定义直接 `execute`（与真实调用同一条路径），只是省掉
// 模型循环：会话注册面另由 `registration.test.mjs` 用真会话取证。
//
// 断言口径刻意贴外部行为：频道/成员/消息/任务的行数与内容，不看内部函数调用。

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-chief-tools-"));
const { openDataDb } = await jiti.import("../data/sqlite.ts");
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const collab = await jiti.import("../domain/collab/index.ts");
const {
  createAgent,
  createChannel,
  createTask,
  deleteAgent,
  getRoomTurnStore,
  isChannelMember,
  joinChannel,
  leaveChannel,
  listAgents,
  listChannels,
  listMessages,
  sendMessage,
  setChannelArchived,
  setGlobalChief,
  setRoomTurnStore,
} = collab;
const { BUILTIN_CHANNEL_ID, OWNER_MEMBER_ID } = await jiti.import("../data/schema.ts");
const { CHIEF_DOMAIN_TOOL_NAMES } = await jiti.import("../member-tool-policy.ts");
const {
  CHIEF_TOOL_EXTENSION,
  chiefToolDefinitions,
  chiefToolsExtension,
  registerChiefTools,
} = await jiti.import("./tools.ts");
// 两条逐字要求的错误文案住在判定层：从它那里取，避免测试里再抄一遍字面量。
const { AGENT_CREATE_QUOTA_ERROR, CHIEF_ONLY_ERROR } = await jiti.import("./decisions.ts");

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

let uniqueSeq = 0;
function unique(prefix) {
  uniqueSeq += 1;
  return `${prefix}-${uniqueSeq}`;
}

/** 一个当上全局首席的 agent。名字带序号：名字是 mention 句柄，跨用例不能撞。 */
function makeChief() {
  const chief = createAgent({ name: unique("chief") });
  setGlobalChief(chief.id);
  return chief;
}

function makeAgent() {
  return createAgent({ name: unique("member") });
}

function makeChannel(name = unique("room"), extra = {}) {
  return createChannel({ name, ...extra });
}

function definitionsFor(actorId) {
  return new Map(chiefToolDefinitions({ actorId }).map((definition) => [definition.name, definition]));
}

function callTool(definitions, name, input) {
  const definition = definitions.get(name);
  assert.ok(definition, `工具未注册：${name}`);
  return definition.execute(`call-${name}`, input, undefined, undefined, { cwd: root });
}

function textOf(result) {
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
  return result.content[0].text;
}

function payloadOf(result) {
  assert.notEqual(result.isError, true, `工具返回错误：${textOf(result)}`);
  return JSON.parse(textOf(result));
}

function messagesBy(targetId, authorId) {
  return listMessages(targetId).messages.filter((message) => message.author_id === authorId);
}

// ---------------------------------------------------------------------------
// 工具面：名字、激活面、扩展外壳
// ---------------------------------------------------------------------------

test("五个工具名与 CHIEF_DOMAIN_TOOL_NAMES 逐字一致，且全部 defaultActive:false", () => {
  const definitions = chiefToolDefinitions({ actorId: "any" });

  assert.deepEqual(
    definitions.map((definition) => definition.name),
    [...CHIEF_DOMAIN_TOOL_NAMES],
  );
  for (const definition of definitions) {
    // 注册 ≠ 激活：激活面由 CHIEF_TOOL_NAMES 显式点名（与路径守卫同名覆盖同一条纪律）。
    assert.equal(definition.defaultActive, false, `${definition.name} 不应在注册时就激活`);
    // 多余字段一律由 schema 层先拦一道（判定层再拦一道，见 decisions.test.mjs）。
    assert.equal(definition.parameters.additionalProperties, false, `${definition.name} 参数面必须封闭`);
    assert.equal(typeof definition.description, "string");
    assert.ok(definition.description.length > 0);
  }
});

test("扩展外壳：hidden、builtin: 名，工厂把五个名字都注册进 pi", () => {
  const entry = chiefToolsExtension({ actorId: "chief" });
  assert.equal(entry.name, CHIEF_TOOL_EXTENSION);
  assert.match(entry.name, /^builtin:/);
  assert.equal(entry.hidden, true);

  const recorded = [];
  registerChiefTools({ registerTool: (definition) => recorded.push(definition.name) }, { actorId: "chief" });
  assert.deepEqual(recorded, [...CHIEF_DOMAIN_TOOL_NAMES]);
});

// ---------------------------------------------------------------------------
// 安全边界 1：actor 不是首席 → 五个工具全拒 + 零副作用
// ---------------------------------------------------------------------------

test("actor 不是首席时五个工具全部拒绝，且一个字节都没写", async () => {
  makeChief(); // 首席是别人
  const worker = makeAgent();
  const channel = makeChannel();
  joinChannel(channel.id, worker.id, worker.id);

  const before = {
    channels: listChannels().length,
    members: listAgents().length,
    channelMessages: listMessages(channel.id).messages.length,
  };
  const definitions = definitionsFor(worker.id);
  const calls = {
    worksplice_list_channels: { limit: 5 },
    worksplice_list_members: { channelId: channel.id },
    worksplice_list_tasks: { channelId: channel.id },
    worksplice_channel_create: { name: unique("nope") },
    worksplice_agent_create: { name: `ops-${unique("x").replace(/[^a-z0-9-]/g, "")}` },
  };

  for (const name of CHIEF_DOMAIN_TOOL_NAMES) {
    const result = await callTool(definitions, name, calls[name]);
    assert.equal(result.isError, true, `${name} 应拒绝非首席`);
    assert.equal(textOf(result), CHIEF_ONLY_ERROR, `${name} 的错误文案必须是那条逐字要求`);
  }

  assert.equal(listChannels().length, before.channels, "不得建出频道");
  assert.equal(listAgents().length, before.members, "不得建出成员");
  assert.equal(listMessages(channel.id).messages.length, before.channelMessages, "不得投出消息");
});

test("首席身份每次调用重新判定：换人之后旧会话里的工具立即失效", async () => {
  const first = makeChief();
  const definitions = definitionsFor(first.id);

  assert.equal(payloadOf(await callTool(definitions, "worksplice_list_channels", {})).channels.length > 0, true);

  const second = makeChief(); // 全局首席换成别人
  const refused = await callTool(definitions, "worksplice_list_channels", {});
  assert.equal(refused.isError, true);
  assert.equal(textOf(refused), CHIEF_ONLY_ERROR);

  // 换回来立刻恢复：判定不缓存。
  setGlobalChief(first.id);
  assert.equal(payloadOf(await callTool(definitions, "worksplice_list_channels", {})).channels.length > 0, true);
  setGlobalChief(second.id);
});

// ---------------------------------------------------------------------------
// 读面 1：worksplice_list_channels
// ---------------------------------------------------------------------------

test("list_channels 只回可见频道（公开 + 本人成员），摘要五字段，limit 生效", async () => {
  const chief = makeChief();
  const outsiderRoom = makeChannel(); // 公开：首席被服务层自动加入
  leaveChannel(outsiderRoom.id, chief.id, chief.id); // 变成「公开但首席不在里面」
  const privateRoom = makeChannel(unique("private"), { type: "private", memberIds: [chief.id] });
  const foreignPrivate = makeChannel(unique("hidden"), { type: "private" });
  const archivedRoom = makeChannel(unique("old"));
  setChannelArchived(archivedRoom.id, true, OWNER_MEMBER_ID);

  const definitions = definitionsFor(chief.id);
  const all = payloadOf(await callTool(definitions, "worksplice_list_channels", { limit: 50 })).channels;
  const ids = all.map((channel) => channel.id);

  assert.equal(ids.includes(outsiderRoom.id), true, "公开频道不看成员关系");
  assert.equal(ids.includes(privateRoom.id), true, "本人在其中的私有频道可见");
  assert.equal(ids.includes(foreignPrivate.id), false, "不在其中的私有频道不可见");
  assert.equal(ids.includes(archivedRoom.id), true, "已归档频道按 archived 字段呈现，不隐藏");

  for (const channel of all) {
    assert.deepEqual(Object.keys(channel).sort(), ["archived", "id", "memberCount", "name", "type"]);
    assert.equal(typeof channel.archived, "boolean");
    assert.equal(typeof channel.memberCount, "number");
  }

  const limited = payloadOf(await callTool(definitions, "worksplice_list_channels", { limit: 2 })).channels;
  assert.equal(limited.length, 2);
  assert.deepEqual(limited, all.slice(0, 2), "limit 取的是可见列表的前缀（稳定顺序）");
});

test("list_channels 拒绝越界 limit，不截断也不兜底", async () => {
  const chief = makeChief();
  const definitions = definitionsFor(chief.id);

  for (const limit of [0, 51, 2.5, "10", null]) {
    const result = await callTool(definitions, "worksplice_list_channels", { limit });
    assert.equal(result.isError, true, `limit=${JSON.stringify(limit)} 应被拒绝`);
    assert.match(textOf(result), /limit/);
  }
});

// ---------------------------------------------------------------------------
// 读面 2：worksplice_list_members
// ---------------------------------------------------------------------------

test("list_members 回存活 agent + Owner；软删身份与无关成员不出现", async () => {
  const chief = makeChief();
  const live = makeAgent();
  const gone = createAgent({ name: unique("gone") });
  deleteAgent(gone.id);

  const definitions = definitionsFor(chief.id);
  const members = payloadOf(await callTool(definitions, "worksplice_list_members", {})).members;
  const ids = members.map((member) => member.id);

  assert.equal(ids.includes(OWNER_MEMBER_ID), true, "Owner 必须在清单里");
  assert.equal(ids.includes(live.id), true);
  assert.equal(ids.includes(chief.id), true);
  assert.equal(ids.includes(gone.id), false, "软删身份不算存活成员");
  for (const member of members) {
    assert.deepEqual(Object.keys(member).sort(), ["id", "name", "status", "type"]);
    assert.notEqual(member.type, undefined);
  }
});

test("list_members 给 channelId 就只回该频道成员；首席不是成员时报错", async () => {
  const chief = makeChief();
  const inside = makeAgent();
  const outside = makeAgent();
  const channel = makeChannel(unique("members"));
  joinChannel(channel.id, inside.id, inside.id);

  const definitions = definitionsFor(chief.id);
  const scoped = payloadOf(
    await callTool(definitions, "worksplice_list_members", { channelId: channel.id }),
  ).members.map((member) => member.id);
  assert.equal(scoped.includes(inside.id), true);
  assert.equal(scoped.includes(outside.id), false);
  assert.equal(scoped.includes(OWNER_MEMBER_ID), true, "Owner 是频道成员，照常出现");

  const foreign = makeChannel(unique("foreign"), { type: "private" });
  const refused = await callTool(definitions, "worksplice_list_members", { channelId: foreign.id });
  assert.equal(refused.isError, true);
  assert.match(textOf(refused), /not a member|Channel not found/);

  const missing = await callTool(definitions, "worksplice_list_members", { channelId: "no-such-channel" });
  assert.equal(missing.isError, true);
  assert.match(textOf(missing), /Channel not found/);
});

// ---------------------------------------------------------------------------
// 读面 3：worksplice_list_tasks
// ---------------------------------------------------------------------------

test("list_tasks 只回四字段、preview 截断、status 可筛；非成员拒绝", async () => {
  const chief = makeChief();
  const channel = makeChannel(unique("board"));
  const anchor = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: `do the thing ${"x".repeat(200)}`,
  });
  const task = createTask({ messageId: anchor.message.id });

  const definitions = definitionsFor(chief.id);
  const tasks = payloadOf(await callTool(definitions, "worksplice_list_tasks", { channelId: channel.id })).tasks;
  const view = tasks.find((entry) => entry.number === task.number);
  assert.ok(view, "刚建的任务必须在清单里");
  assert.deepEqual(Object.keys(view).sort(), ["number", "ownerName", "preview", "status"]);
  assert.equal(view.status, "todo");
  assert.equal(view.ownerName, null);
  assert.equal(view.preview.startsWith("do the thing"), true);
  assert.ok(view.preview.length <= 121, `preview 必须截断，实际 ${view.preview.length} 字符`);

  const done = payloadOf(
    await callTool(definitions, "worksplice_list_tasks", { channelId: channel.id, status: "done" }),
  ).tasks;
  assert.equal(done.some((entry) => entry.number === task.number), false, "status 过滤必须生效");

  const foreign = makeChannel(unique("tasks-hidden"), { type: "private" });
  const refused = await callTool(definitions, "worksplice_list_tasks", { channelId: foreign.id });
  assert.equal(refused.isError, true);
  assert.match(textOf(refused), /not a member/);
});

// ---------------------------------------------------------------------------
// 写面 1：worksplice_channel_create
// ---------------------------------------------------------------------------

test("channel_create：公开频道把首席加进去一次（幂等），并留一条 actor 署名的系统事件", async () => {
  const chief = makeChief();
  const name = unique("ops-room");
  const definitions = definitionsFor(chief.id);
  setRoomTurnStore(null);

  const created = payloadOf(
    await callTool(definitions, "worksplice_channel_create", {
      name,
      description: "chief made this",
      // 显式把 actor 也放进 memberIds：服务层自动加 + 这里再加一次不得留下两行成员关系。
      memberIds: [chief.id],
    }),
  );
  assert.equal(created.name, name);
  assert.equal(created.type, "public");
  assert.equal(isChannelMember(created.id, chief.id), true);

  const membership = globalThis.__workspliceDb.listChannelMembers(created.id).filter(
    (row) => row.member_id === chief.id,
  );
  assert.equal(membership.length, 1, "重复加入必须幂等");

  // 系统事件：恰好一条，作者是 actor，内容按票据格式。
  const authored = messagesBy(created.id, chief.id);
  assert.equal(authored.length, 1);
  assert.equal(authored[0].content, `${chief.name} created channel #${name}`);

  // `roomNotice` 语义：事件消息不进房间场次（没开会话状态 = 没开新房次）。
  assert.equal(getRoomTurnStore().snapshot(created.id), null);
});

test("channel_create：私有频道缺少 actor 直接报错，且不建出频道", async () => {
  const chief = makeChief();
  const worker = makeAgent();
  const definitions = definitionsFor(chief.id);
  const before = listChannels().length;

  const refused = await callTool(definitions, "worksplice_channel_create", {
    name: unique("private"),
    type: "private",
    memberIds: [worker.id],
  });
  assert.equal(refused.isError, true);
  assert.match(textOf(refused), /private/);
  assert.match(textOf(refused), /memberIds/);
  assert.equal(listChannels().length, before);
});

test("channel_create：私有频道把 actor 放进 memberIds 后成立，actor 确为成员", async () => {
  const chief = makeChief();
  const worker = makeAgent();
  const definitions = definitionsFor(chief.id);

  const created = payloadOf(
    await callTool(definitions, "worksplice_channel_create", {
      name: unique("private-ops"),
      type: "private",
      memberIds: [chief.id, worker.id],
    }),
  );
  assert.equal(created.type, "private");
  assert.equal(isChannelMember(created.id, chief.id), true);
  assert.equal(isChannelMember(created.id, worker.id), true);
});

test("channel_create：名字规则由 createChannel 自己抛（本层不重写一套）", async () => {
  const chief = makeChief();
  const definitions = definitionsFor(chief.id);
  const before = listChannels().length;

  for (const name of ["   ", "x".repeat(33)]) {
    const refused = await callTool(definitions, "worksplice_channel_create", { name });
    assert.equal(refused.isError, true);
    assert.match(textOf(refused), /Channel name/);
  }
  assert.equal(listChannels().length, before, "被拒的创建不得留下半成品");
});

// ---------------------------------------------------------------------------
// 写面 2：worksplice_agent_create
// ---------------------------------------------------------------------------

test("agent_create：建出的身份继承全局默认（model_provider / model_id 都是 NULL）", async () => {
  const chief = makeChief();
  const definitions = definitionsFor(chief.id);
  const name = `ops-${unique("builder").replace(/[^a-z0-9-]/g, "")}`;

  const created = payloadOf(await callTool(definitions, "worksplice_agent_create", { name, description: "  builds  " }));
  assert.equal(created.name, name);
  assert.equal(created.type, "agent");

  const row = globalThis.__workspliceDb.getMember(created.id);
  assert.ok(row);
  assert.equal(row.model_provider, null);
  assert.equal(row.model_id, null);
  assert.equal(row.thinking_level, null);
  assert.equal(row.description, "builds");

  // 缺省目标 = #all：事件恰好一条、作者是 actor。
  const authored = messagesBy(BUILTIN_CHANNEL_ID, chief.id);
  const event = authored.filter((message) => message.content === `${chief.name} created agent @${name}`);
  assert.equal(event.length, 1);
});

test("agent_create：同名冲突按可读错误透出，且失败不消耗配额", async () => {
  const chief = makeChief();
  const definitions = definitionsFor(chief.id);
  const taken = `ops-${unique("taken").replace(/[^a-z0-9-]/g, "")}`;
  createAgent({ name: taken }); // 占名

  const conflict = await callTool(definitions, "worksplice_agent_create", { name: taken });
  assert.equal(conflict.isError, true);
  assert.match(textOf(conflict), /already exists/, "DuplicateAgentNameError 必须原样透出");

  // 失败没花掉配额：紧接着的第一次成功创建必须成立。
  const fresh = `ops-${unique("fresh").replace(/[^a-z0-9-]/g, "")}`;
  const created = payloadOf(await callTool(definitions, "worksplice_agent_create", { name: fresh }));
  assert.equal(created.name, fresh);
});

test("agent_create：同会话第二次成功创建被配额拒绝，且不建出第二个身份", async () => {
  const chief = makeChief();
  const definitions = definitionsFor(chief.id);
  const membersBefore = listAgents().length;

  const first = `ops-${unique("one").replace(/[^a-z0-9-]/g, "")}`;
  payloadOf(await callTool(definitions, "worksplice_agent_create", { name: first }));
  assert.equal(listAgents().length, membersBefore + 1);

  const second = `ops-${unique("two").replace(/[^a-z0-9-]/g, "")}`;
  const refused = await callTool(definitions, "worksplice_agent_create", { name: second });
  assert.equal(refused.isError, true);
  assert.equal(textOf(refused), AGENT_CREATE_QUOTA_ERROR);
  assert.equal(listAgents().length, membersBefore + 1, "被拒的第二次不得建出身份");

  // 换一份定义（= 另一个会话窗口）配额重新开始。
  const otherWindow = definitionsFor(chief.id);
  const third = `ops-${unique("three").replace(/[^a-z0-9-]/g, "")}`;
  assert.equal(payloadOf(await callTool(otherWindow, "worksplice_agent_create", { name: third })).name, third);
});

test("agent_create：名字不合规一律报错并说明允许的形状，且不建出身份", async () => {
  const chief = makeChief();
  const definitions = definitionsFor(chief.id);
  const membersBefore = listAgents().length;

  for (const name of ["Susan", "Ops-x9", "x-ops9", `ops-${"a".repeat(29)}`, "ops-", ""]) {
    const refused = await callTool(definitions, "worksplice_agent_create", { name });
    assert.equal(refused.isError, true, `${JSON.stringify(name)} 应被拒绝`);
    assert.match(textOf(refused), /ops-/);
  }
  assert.equal(listAgents().length, membersBefore);
});

test("agent_create：不接受 provider / modelId / thinkingLevel（出现即报错）", async () => {
  const chief = makeChief();
  const definitions = definitionsFor(chief.id);
  const membersBefore = listAgents().length;
  const name = `ops-${unique("model").replace(/[^a-z0-9-]/g, "")}`;

  for (const extra of [{ provider: "openai" }, { modelId: "gpt-x" }, { thinkingLevel: "high" }]) {
    const refused = await callTool(definitions, "worksplice_agent_create", { name, ...extra });
    assert.equal(refused.isError, true);
    assert.match(textOf(refused), new RegExp(Object.keys(extra)[0]));
  }
  assert.equal(listAgents().length, membersBefore);
});

test("agent_create：channelId 指向自己不在的频道 → 报错且不建身份（不静默改投）", async () => {
  const chief = makeChief();
  const other = makeAgent();
  const foreign = createChannel({ name: unique("foreign-room"), type: "private", memberIds: [other.id] });
  const definitions = definitionsFor(chief.id);
  const membersBefore = listAgents().length;
  const name = `ops-${unique("redirect").replace(/[^a-z0-9-]/g, "")}`;

  const refused = await callTool(definitions, "worksplice_agent_create", { name, channelId: foreign.id });
  assert.equal(refused.isError, true);
  assert.match(textOf(refused), /not a member/);
  assert.equal(listAgents().length, membersBefore);
  assert.equal(messagesBy(foreign.id, chief.id).length, 0);
});

test("agent_create 指到指定频道时事件投到那里，且不开新房次（roomNotice 生效）", async () => {
  const chief = makeChief();
  const channel = makeChannel(unique("target"));
  // 先造一个活跃房间场次：Owner 从频道发一条消息 → beginTurn。
  setRoomTurnStore(null);
  sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "hello team" });
  const before = getRoomTurnStore().snapshot(channel.id);
  assert.ok(before, "夹具必须先开出一个场次，否则这条断言什么都不证明");

  const definitions = definitionsFor(chief.id);
  const name = `ops-${unique("routed").replace(/[^a-z0-9-]/g, "")}`;
  payloadOf(await callTool(definitions, "worksplice_agent_create", { name, channelId: channel.id }));

  const after = getRoomTurnStore().snapshot(channel.id);
  assert.deepEqual(after, before, "系统事件不得推进 epoch / wave / replies，也不得进转写");

  const events = messagesBy(channel.id, chief.id).filter(
    (message) => message.content === `${chief.name} created agent @${name}`,
  );
  assert.equal(events.length, 1);
});

// ---------------------------------------------------------------------------
// 每个工具的参数面都封闭：多余字段在工具层就报错
// ---------------------------------------------------------------------------

test("五个工具都拒绝多余参数（schema 与判定层两道）", async () => {
  const chief = makeChief();
  const definitions = definitionsFor(chief.id);
  const extra = {
    worksplice_list_channels: { limit: 5, channelId: "x" },
    worksplice_list_members: { channelId: null, all: true },
    worksplice_list_tasks: { channelId: BUILTIN_CHANNEL_ID, sort: "az" },
    worksplice_channel_create: { name: unique("x"), chiefMemberId: chief.id },
    worksplice_agent_create: { name: `ops-${unique("y").replace(/[^a-z0-9-]/g, "")}`, workspacePath: "/tmp" },
  };

  for (const name of CHIEF_DOMAIN_TOOL_NAMES) {
    const result = await callTool(definitions, name, extra[name]);
    assert.equal(result.isError, true, `${name} 应拒绝多余参数`);
    assert.match(textOf(result), /unknown parameter/);
  }
});
