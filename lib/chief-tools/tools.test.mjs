import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });

// 工具面（票 chief-tools / 第三批）：六个领域工具在**真数据库**上的外部行为——chief 复判、参数拒绝、
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
  listChannelTasks,
  listMessages,
  sendMessage,
  setChannelArchived,
  setGlobalChief,
  setRoomTurnStore,
  subscribeWake,
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

/**
 * 工具定义。`sessionKey` = 本会话标识（票 chief-capability-converge）：`createAgent` 配额按
 * 「agent + 会话」分期，与 ops 面共用同一个 store。省略 = 拿不到标识（配额退化，会记日志）。
 */
function definitionsFor(actorId, sessionKey) {
  return new Map(
    chiefToolDefinitions({ actorId, ...(sessionKey ? { sessionKey } : {}) }).map((definition) => [
      definition.name,
      definition,
    ]),
  );
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

test("六个工具名与 CHIEF_DOMAIN_TOOL_NAMES 逐字一致，且全部 defaultActive:false", () => {
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

test("扩展外壳：hidden、builtin: 名，工厂把六个名字都注册进 pi", () => {
  const entry = chiefToolsExtension({ actorId: "chief" });
  assert.equal(entry.name, CHIEF_TOOL_EXTENSION);
  assert.match(entry.name, /^builtin:/);
  assert.equal(entry.hidden, true);

  const recorded = [];
  registerChiefTools({ registerTool: (definition) => recorded.push(definition.name) }, { actorId: "chief" });
  assert.deepEqual(recorded, [...CHIEF_DOMAIN_TOOL_NAMES]);
});

// ---------------------------------------------------------------------------
// 安全边界 1：actor 不是首席 → 六个工具全拒 + 零副作用
// ---------------------------------------------------------------------------

test("actor 不是首席时六个工具全部拒绝，且一个字节都没写", async () => {
  makeChief(); // 首席是别人
  const worker = makeAgent();
  const channel = makeChannel();
  joinChannel(channel.id, worker.id, worker.id);
  const anchor = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "intake this",
  });

  const before = {
    channels: listChannels().length,
    members: listAgents().length,
    channelMessages: listMessages(channel.id).messages.length,
    channelTasks: listChannelTasks(channel.id).length,
  };
  const definitions = definitionsFor(worker.id);
  const calls = {
    worksplice_list_channels: { limit: 5 },
    worksplice_list_members: { channelId: channel.id },
    worksplice_list_tasks: { channelId: channel.id },
    worksplice_channel_create: { name: unique("nope") },
    worksplice_agent_create: { name: `ops-${unique("x").replace(/[^a-z0-9-]/g, "")}` },
    worksplice_task_create: { messageId: anchor.message.id },
  };

  for (const name of CHIEF_DOMAIN_TOOL_NAMES) {
    const result = await callTool(definitions, name, calls[name]);
    assert.equal(result.isError, true, `${name} 应拒绝非首席`);
    assert.equal(textOf(result), CHIEF_ONLY_ERROR, `${name} 的错误文案必须是那条逐字要求`);
  }

  assert.equal(listChannels().length, before.channels, "不得建出频道");
  assert.equal(listAgents().length, before.members, "不得建出成员");
  assert.equal(listMessages(channel.id).messages.length, before.channelMessages, "不得投出消息");
  assert.equal(listChannelTasks(channel.id).length, before.channelTasks, "不得建出任务");
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
  assert.ok(view.preview.length <= 120, `preview 必须截断到 120 字符，实际 ${view.preview.length}`);

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

test("channel_create：memberIds 里的软删 / 人类 / 不存在 id 一律拒绝，且不建出频道", async () => {
  const chief = makeChief();
  const gone = createAgent({ name: unique("gone-member") });
  deleteAgent(gone.id);
  const definitions = definitionsFor(chief.id);
  const before = listChannels().length;

  for (const memberId of [gone.id, OWNER_MEMBER_ID, "no-such-member"]) {
    const refused = await callTool(definitions, "worksplice_channel_create", {
      name: unique("strict"),
      memberIds: [chief.id, memberId],
    });
    assert.equal(refused.isError, true, `memberIds 里的 ${memberId} 应被拒绝`);
    assert.match(textOf(refused), /member/i);
  }
  assert.equal(listChannels().length, before, "被拒的创建不得留下半成品");
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
  const sessionKey = unique("session");
  const definitions = definitionsFor(chief.id, sessionKey);
  const membersBefore = listAgents().length;

  const first = `ops-${unique("one").replace(/[^a-z0-9-]/g, "")}`;
  payloadOf(await callTool(definitions, "worksplice_agent_create", { name: first }));
  assert.equal(listAgents().length, membersBefore + 1);

  const second = `ops-${unique("two").replace(/[^a-z0-9-]/g, "")}`;
  const refused = await callTool(definitions, "worksplice_agent_create", { name: second });
  assert.equal(refused.isError, true);
  assert.equal(textOf(refused), AGENT_CREATE_QUOTA_ERROR);
  assert.equal(listAgents().length, membersBefore + 1, "被拒的第二次不得建出身份");

  // 配额是**进程级单例**（不再挂在工厂闭包上）：重新拿一份定义还是同一个会话窗口 ⇒ 仍然被拒。
  // 这条断言守的是「换个写法（重新建定义 / 走 ops 面）不能绕过去」。
  const sameWindow = definitionsFor(chief.id, sessionKey);
  const stillRefused = await callTool(sameWindow, "worksplice_agent_create", {
    name: `ops-${unique("again").replace(/[^a-z0-9-]/g, "")}`,
  });
  assert.equal(textOf(stillRefused), AGENT_CREATE_QUOTA_ERROR);

  // 换会话 = 新窗口：配额重新开始。
  const otherWindow = definitionsFor(chief.id, unique("session"));
  const third = `ops-${unique("three").replace(/[^a-z0-9-]/g, "")}`;
  assert.equal(payloadOf(await callTool(otherWindow, "worksplice_agent_create", { name: third })).name, third);
});

test("agent_create：拿不到会话标识时配额退化为「该 agent 在本进程内至多 1 次」（fail-closed）", async () => {
  const chief = makeChief();
  const membersBefore = listAgents().length;

  const first = `ops-${unique("degraded").replace(/[^a-z0-9-]/g, "")}`;
  payloadOf(await callTool(definitionsFor(chief.id), "worksplice_agent_create", { name: first }));
  assert.equal(listAgents().length, membersBefore + 1);

  // 退化不是「跳过配额」：没有 sessionKey 的第二次调用同样被拒。
  const refused = await callTool(definitionsFor(chief.id), "worksplice_agent_create", {
    name: `ops-${unique("degraded-two").replace(/[^a-z0-9-]/g, "")}`,
  });
  assert.equal(textOf(refused), AGENT_CREATE_QUOTA_ERROR);
  assert.equal(listAgents().length, membersBefore + 1);
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
// 写面 3：worksplice_task_create（票 chief-task-create）—— *只有* { messageId }
//
// 这个工具本身不实现任何规则：频道归属靠 `getChannel(message.target_id)`，重复转任务 / thread 内
// 不可转 / 取号全部交给 `createTask`。所以下面全部用例都断言**外部效果**（任务数、任务行、
// 消息流、wake 信号），不断言内部调用。
// ---------------------------------------------------------------------------

/** 一个频道里的顶层消息（可由 Owner 发，因 Owner 是每个频道的成员）。 */
function ownerMessageIn(channelId, content) {
  return sendMessage({ targetId: channelId, authorId: OWNER_MEMBER_ID, content }).message;
}

function tasksOfMessage(channelId, messageId) {
  return listChannelTasks(channelId).filter((task) => task.message_id === messageId);
}

test("task_create：actor 不是首席 → 拒绝且任务数不变", async () => {
  // 这份定义属于一个普通成员，但他确实是自己频道里的成员——拒绝必须来自 `chiefOnly`，
  // 而不是后续那层成员判定（否则这条用例证明不了「首席复判」）。
  makeChief();
  const worker = makeAgent();
  const channel = makeChannel(unique("intake"));
  joinChannel(channel.id, worker.id, worker.id);
  const anchor = ownerMessageIn(channel.id, "please turn me into a task");
  const before = listChannelTasks(channel.id).length;

  const refused = await callTool(definitionsFor(worker.id), "worksplice_task_create", {
    messageId: anchor.id,
  });

  assert.equal(refused.isError, true);
  assert.equal(textOf(refused), CHIEF_ONLY_ERROR);
  assert.equal(listChannelTasks(channel.id).length, before, "被拒的调用不得建出任务");
});

test("task_create：首席不是消息所在频道的成员 → 拒绝且不建任务", async () => {
  const chief = makeChief();
  const worker = makeAgent();
  // 私有频道只把 worker 加进去：createChannel 只对**公开**频道自动加全局首席。
  const foreign = createChannel({
    name: unique("foreign-intake"),
    type: "private",
    memberIds: [worker.id],
  });
  assert.equal(isChannelMember(foreign.id, chief.id), false, "夹具：首席必须不在这个频道里");
  const anchor = ownerMessageIn(foreign.id, "hidden work item");
  const before = listChannelTasks(foreign.id).length;

  const refused = await callTool(definitionsFor(chief.id), "worksplice_task_create", {
    messageId: anchor.id,
  });

  assert.equal(refused.isError, true);
  assert.match(textOf(refused), new RegExp(`not a member of channel ${foreign.id}`));
  assert.equal(listChannelTasks(foreign.id).length, before, "被拒的调用不得建出任务");
});

test("task_create：消息不存在 → 可读错误，不建任务", async () => {
  const chief = makeChief();
  const channel = makeChannel(unique("ghost-intake"));
  const before = listChannelTasks(channel.id).length;

  const refused = await callTool(definitionsFor(chief.id), "worksplice_task_create", {
    messageId: "no-such-message",
  });

  assert.equal(refused.isError, true);
  assert.match(textOf(refused), /Message not found/);
  assert.equal(listChannelTasks(channel.id).length, before);
});

test("task_create：thread 内消息由 createTask 拒绝（可读），不建任务", async () => {
  const chief = makeChief();
  const channel = makeChannel(unique("thread-intake"));
  const anchor = ownerMessageIn(channel.id, "top level");
  const reply = sendMessage({
    targetId: anchor.id,
    authorId: OWNER_MEMBER_ID,
    content: "reply in thread",
  }).message;
  const before = listChannelTasks(channel.id).length;

  const refused = await callTool(definitionsFor(chief.id), "worksplice_task_create", {
    messageId: reply.id,
  });

  assert.equal(refused.isError, true);
  // 这条错误来自 `createTask`（本层不实现锚点归一化）：可读、说一句真话。
  assert.match(textOf(refused), /Only top-level messages can become tasks/);
  assert.equal(listChannelTasks(channel.id).length, before, "thread 内消息不得变成任务");
});

test("task_create：同一消息连转两次 → 第二次原样透出 TaskAlreadyExistsError，任务数仍为 1", async () => {
  const chief = makeChief();
  const channel = makeChannel(unique("dup-intake"));
  const anchor = ownerMessageIn(channel.id, "do it exactly once");
  const definitions = definitionsFor(chief.id);

  const created = payloadOf(
    await callTool(definitions, "worksplice_task_create", { messageId: anchor.id }),
  );
  assert.equal(typeof created.number, "number");

  const second = await callTool(definitions, "worksplice_task_create", { messageId: anchor.id });

  assert.equal(second.isError, true);
  // 服务层错误原样透出：不吞成「cannot create task」之类的通用文案。
  assert.equal(textOf(second), "This message is already a task");
  assert.equal(tasksOfMessage(channel.id, anchor.id).length, 1, "一条消息只能是一个任务");
});

test("task_create：成功路径 → 任务落库、number 频道内递增、返回值含 anchorSeq", async () => {
  const chief = makeChief();
  const channel = makeChannel(unique("success-intake"));
  const firstAnchor = ownerMessageIn(channel.id, "first work item");
  const secondAnchor = ownerMessageIn(channel.id, "second work item");
  const definitions = definitionsFor(chief.id);

  const first = payloadOf(
    await callTool(definitions, "worksplice_task_create", { messageId: firstAnchor.id }),
  );
  const second = payloadOf(
    await callTool(definitions, "worksplice_task_create", { messageId: secondAnchor.id }),
  );

  // 返回面只带这三样：够她下一轮引用（number / anchorSeq），不多吐任务全文。
  assert.deepEqual(Object.keys(first).sort(), ["anchorSeq", "number", "status"]);
  assert.equal(first.status, "todo");
  assert.equal(first.anchorSeq, firstAnchor.seq, "anchorSeq 就是锚点消息的 seq");
  assert.equal(second.anchorSeq, secondAnchor.seq);

  // 取号由 createTask 负责（channel 内递增）：本频道第一条 = 1，第二条 = 2。
  assert.equal(first.number, 1);
  assert.equal(second.number, 2);

  const rows = listChannelTasks(channel.id);
  assert.equal(rows.length, 2, "两个任务都真的落库了");
  assert.equal(tasksOfMessage(channel.id, firstAnchor.id).length, 1);
  assert.equal(tasksOfMessage(channel.id, secondAnchor.id).length, 1);
  assert.equal(rows.find((task) => task.number === first.number).message_id, firstAnchor.id);
});

test("task_create：恰好一条 Owner 署名的 Task #N created 事件，且没有第二条 actor 署名事件", async () => {
  const chief = makeChief();
  const channel = makeChannel(unique("event-intake"));
  setRoomTurnStore(null);
  const anchor = ownerMessageIn(channel.id, "wire this up");
  // 夹具：Owner 的顶层消息已经开出一个房间场次，`roomNotice` 的效果才有东西可比。
  const turnBefore = getRoomTurnStore().snapshot(channel.id);
  assert.ok(turnBefore, "夹具必须先开出一个房间场次");

  const created = payloadOf(
    await callTool(definitionsFor(chief.id), "worksplice_task_create", { messageId: anchor.id }),
  );

  const events = listMessages(channel.id).messages.filter(
    (message) => message.content.startsWith(`Task #${created.number} created`),
  );
  assert.equal(events.length, 1, "任务创建事件恰好一条");
  assert.equal(events[0].author_id, OWNER_MEMBER_ID, "事件消息是 Owner 署名（不是首席）");
  assert.equal(events[0].content, `Task #${created.number} created — wire this up`);

  // 「有意例外」的守门人：工具不再补一条 actor 署名事件——同一个事实不得在频道里出现两次。
  assert.equal(messagesBy(channel.id, chief.id).length, 0, "不得有首席署名的第二条事件");

  // `roomNotice: true` 的可观测含义：事件消息不得开新房次 / 不得推进 epoch。
  assert.deepEqual(getRoomTurnStore().snapshot(channel.id), turnBefore);
});

test("task_create：建完任务后该频道出现待处理的 wake 信号", async () => {
  const chief = makeChief();
  const channel = makeChannel(unique("wake-intake"));
  const anchor = ownerMessageIn(channel.id, "wake the crew");

  // 只订阅公开的 wake 总线，不断言实现细节（谁被唤醒、几条 hint）——
  // 票面要的就是「建完任务后这个频道有人会被叫起来干活」这一个事实。
  const hints = [];
  const unsubscribe = subscribeWake((hint) => hints.push(hint));
  try {
    payloadOf(await callTool(definitionsFor(chief.id), "worksplice_task_create", { messageId: anchor.id }));
  } finally {
    unsubscribe();
  }

  assert.equal(
    hints.some((hint) => hint.targetId === channel.id),
    true,
    `任务创建事件没有带来该频道的 wake：${JSON.stringify(hints)}`,
  );
});

// ---------------------------------------------------------------------------
// 跨路径同口径（票 chief-capability-converge）：ops 面与首席 tools 面共用约束面与配额
// ---------------------------------------------------------------------------

/** 用 ops 面的执行器建一个 agent（授口与工具面一样，配额同一个 store）。 */
async function opsCreateAgent(agent, sessionKey, name) {
  const { executeMemberOps, parseMemberOps, planMemberOps } = await jiti.import(
    "../agent-loop/member-ops.ts",
  );
  return executeMemberOps({
    agent,
    targetId: BUILTIN_CHANNEL_ID,
    sessionKey,
    plans: planMemberOps(parseMemberOps([{ op: "createAgent", name }])),
  });
}

test("跨路径配额：ops 先建 → tools 侧被同一配额拒绝；tools 先建 → ops 侧被拒", async () => {
  // 全局首席同一时刻只有一位，所以两个方向各自先立首席、再取基线。

  // 方向 1：ops 面成功之后，同一会话里 tools 面就没了这一次机会。
  const opsFirst = makeChief();
  const opsSession = unique("cross-ops-first");
  const afterChief = listAgents().length;
  const viaOps = `ops-${unique("via-op").replace(/[^a-z0-9-]/g, "")}`;
  const opsOutcome = await opsCreateAgent(opsFirst, opsSession, viaOps);
  assert.equal(opsOutcome.outcomes[0].status, "applied", opsOutcome.outcomes[0].detail);
  assert.ok(globalThis.__workspliceDb.getMemberByName(viaOps), "ops 面应建出身份");

  const viaToolsRefused = await callTool(
    definitionsFor(opsFirst.id, opsSession),
    "worksplice_agent_create",
    { name: `ops-${unique("via-tool").replace(/[^a-z0-9-]/g, "")}` },
  );
  assert.equal(textOf(viaToolsRefused), AGENT_CREATE_QUOTA_ERROR, "同一会话的配额必须跨路径共享");
  assert.equal(listAgents().length, afterChief + 1, "方向 1 只建出一个身份");

  // 方向 2：tools 面成功之后，同一会话里 ops 面同样被拒。
  const toolsFirst = makeChief();
  const toolsSession = unique("cross-tools-first");
  const afterSecondChief = listAgents().length;
  const viaTool = `ops-${unique("tool-first").replace(/[^a-z0-9-]/g, "")}`;
  payloadOf(
    await callTool(definitionsFor(toolsFirst.id, toolsSession), "worksplice_agent_create", {
      name: viaTool,
    }),
  );
  const refusedViaOps = await opsCreateAgent(
    toolsFirst,
    toolsSession,
    `ops-${unique("op-second").replace(/[^a-z0-9-]/g, "")}`,
  );
  assert.equal(refusedViaOps.outcomes[0].status, "denied");
  assert.equal(refusedViaOps.outcomes[0].detail, AGENT_CREATE_QUOTA_ERROR);
  assert.equal(listAgents().length, afterSecondChief + 1, "方向 2 也只建出一个身份");
});

test("跨路径同口径：名字不合规时两条路径报同一句话（规则来源唯一）", async () => {
  const chief = makeChief();
  const toolsText = textOf(
    await callTool(definitionsFor(chief.id, unique("same-mouth")), "worksplice_agent_create", {
      name: "NotOpsName",
    }),
  );
  assert.match(toolsText, /ops-/);

  const opsOutcome = await opsCreateAgent(chief, unique("same-mouth-ops"), "NotOpsName");
  assert.equal(opsOutcome.outcomes[0].status, "denied");
  assert.equal(opsOutcome.outcomes[0].detail, toolsText, "两条路径必须读到同一份约束（同一句话）");
});

// ---------------------------------------------------------------------------
// 每个工具的参数面都封闭：多余字段在工具层就报错
// ---------------------------------------------------------------------------

test("六个工具都拒绝多余参数（schema 与判定层两道）", async () => {
  const chief = makeChief();
  const definitions = definitionsFor(chief.id);
  const extra = {
    worksplice_list_channels: { limit: 5, channelId: "x" },
    worksplice_list_members: { channelId: null, all: true },
    worksplice_list_tasks: { channelId: BUILTIN_CHANNEL_ID, sort: "az" },
    worksplice_channel_create: { name: unique("x"), chiefMemberId: chief.id },
    worksplice_agent_create: { name: `ops-${unique("y").replace(/[^a-z0-9-]/g, "")}`, workspacePath: "/tmp" },
    // 「发消息 + 建任务」不是本票的能力：多给正文 / 频道 / 标题就是参数错误，不得静默忽略。
    worksplice_task_create: { messageId: "m-1", content: "do it" },
  };

  for (const name of CHIEF_DOMAIN_TOOL_NAMES) {
    const result = await callTool(definitions, name, extra[name]);
    assert.equal(result.isError, true, `${name} 应拒绝多余参数`);
    assert.match(textOf(result), /unknown parameter/);
  }
});
