import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const decisions = await jiti.import("./decisions.ts");
// 约束面的唯一来源（票 chief-capability-converge）：判定层从它取值，所以本文件要能证明
// 「同一份对象」而不是「一模一样的第二份拷贝」。
const capabilities = await jiti.import("../domain/collab/member-capabilities.ts");

const {
  AGENT_CREATE_QUOTA_ERROR,
  AGENT_NAME_PATTERN,
  CHIEF_ONLY_ERROR,
  DEFAULT_LIST_CHANNELS_LIMIT,
  MAX_LIST_CHANNELS_LIMIT,
  TASK_PREVIEW_MAX_LENGTH,
  TASK_STATUSES,
  agentCreateEventContent,
  channelCreateEventContent,
  channelSummary,
  decideAgentCreateInput,
  decideChannelCreateInput,
  decideListChannelsInput,
  decideListMembersInput,
  decideListTasksInput,
  decideTaskCreateInput,
  isChannelVisibleToActor,
  memberSummary,
  taskSummary,
} = decisions;

// 判定层（票 chief-tools / 第三批）：六个领域工具的**外部行为**在这里定稿——参数校验、配额、可见面、
// 事件文案。纯函数，不碰 SDK / 数据库，所以每条规则都能用一次调用取证。
//
// 消息文本是契约的一部分（进模型上下文 ⇒ 英文硬编码，docs/i18n.md）。断言只钉「说了哪个字段、
// 允许什么」，不钉整句措辞——改文案不该让判定变红。

/** 判定失败的断言口径：不是 ok，且错误里点名了字段与允许面。 */
function assertRejected(decision, ...fragments) {
  assert.equal(decision.ok, false, `应当拒绝，实际通过：${JSON.stringify(decision.value)}`);
  for (const fragment of fragments) {
    assert.match(decision.error, new RegExp(fragment, "i"), `错误信息缺「${fragment}」：${decision.error}`);
  }
}

function assertAccepted(decision) {
  assert.equal(decision.ok, true, `应当通过，实际拒绝：${decision.error}`);
  return decision.value;
}

// ---------------------------------------------------------------------------
// 固定文案：两条是票据逐字要求的错误串，一条是契约里的名字形状
// ---------------------------------------------------------------------------

test("首席复判与配额上限的文案逐字钉住", () => {
  assert.equal(CHIEF_ONLY_ERROR, "Only the global chief may use this tool");
  assert.equal(
    AGENT_CREATE_QUOTA_ERROR,
    "agent_create is limited to one new agent per session; ask a human for more",
  );
});

test("agent 名字规则就是票据给的那条正则", () => {
  assert.equal(AGENT_NAME_PATTERN.source, "^ops-[a-z0-9][a-z0-9-]{1,27}$");
  assert.equal(AGENT_NAME_PATTERN.flags, "");
});

// ---------------------------------------------------------------------------
// 1. worksplice_list_channels —— { limit?: number }，默认 20、上限 50
// ---------------------------------------------------------------------------

test("list_channels：省略 limit 取默认值，其余按给的值", () => {
  assert.equal(assertAccepted(decideListChannelsInput({})).limit, DEFAULT_LIST_CHANNELS_LIMIT);
  assert.equal(DEFAULT_LIST_CHANNELS_LIMIT, 20);
  assert.equal(assertAccepted(decideListChannelsInput({ limit: 5 })).limit, 5);
  assert.equal(assertAccepted(decideListChannelsInput({ limit: MAX_LIST_CHANNELS_LIMIT })).limit, 50);
});

test("list_channels：越界 / 非整数 / 非数字 / null 一律报错，不截断也不兜底", () => {
  for (const limit of [0, -1, 51, 1000, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assertRejected(decideListChannelsInput({ limit }), "limit", "1", "50");
  }
  for (const limit of ["5", null, true, {}, []]) {
    assertRejected(decideListChannelsInput({ limit }), "limit", "integer");
  }
});

test("list_channels：未知参数报错（不静默忽略）", () => {
  assertRejected(decideListChannelsInput({ channelId: "c1" }), "unknown", "channelId", "limit");
});

test("参数不是对象时报错", () => {
  for (const input of [undefined, null, "limit=5", 5, []]) {
    assertRejected(decideListChannelsInput(input), "object");
  }
});

// ---------------------------------------------------------------------------
// 2. worksplice_list_members —— { channelId?: string }
// ---------------------------------------------------------------------------

test("list_members：省略 channelId = 全局清单；给了就用它", () => {
  assert.equal(assertAccepted(decideListMembersInput({})).channelId, null);
  assert.equal(assertAccepted(decideListMembersInput({ channelId: "c-1" })).channelId, "c-1");
});

test("list_members：channelId 必须是非空字符串，未知参数报错", () => {
  for (const channelId of ["", "   ", 7, null, {}]) {
    assertRejected(decideListMembersInput({ channelId }), "channelId", "string");
  }
  assertRejected(decideListMembersInput({ channel: "c-1" }), "unknown", "channel");
});

// ---------------------------------------------------------------------------
// 3. worksplice_list_tasks —— { channelId: string, status?: 五态 }
// ---------------------------------------------------------------------------

test("list_tasks：channelId 必填，status 可省且只认五个状态", () => {
  assert.equal(assertAccepted(decideListTasksInput({ channelId: "c-1" })).status, null);
  for (const status of TASK_STATUSES) {
    assert.equal(assertAccepted(decideListTasksInput({ channelId: "c-1", status })).status, status);
  }
  assert.deepEqual([...TASK_STATUSES], ["todo", "in_progress", "in_review", "done", "closed"]);
});

test("list_tasks：缺 channelId / 状态不在枚举 / 未知参数都报错，并列出允许值", () => {
  assertRejected(decideListTasksInput({}), "channelId", "required");
  assertRejected(decideListTasksInput({ channelId: "" }), "channelId");
  assertRejected(decideListTasksInput({ channelId: "c-1", status: "blocked" }), "status", "todo", "closed");
  assertRejected(decideListTasksInput({ channelId: "c-1", ownerId: "m" }), "unknown", "ownerId");
});

// ---------------------------------------------------------------------------
// 4. worksplice_channel_create —— { name, type?, description?, memberIds? }
// ---------------------------------------------------------------------------

test("channel_create：默认公开、无初始成员、无描述", () => {
  assert.deepEqual(assertAccepted(decideChannelCreateInput({ name: "ops-room" }, "chief")), {
    name: "ops-room",
    type: "public",
    description: null,
    memberIds: [],
  });
});

test("channel_create：私有频道必须把 actor 放进 memberIds —— 否则首席会建一个自己不在里面的房间", () => {
  const accepted = assertAccepted(
    decideChannelCreateInput(
      { name: "ops-private", type: "private", memberIds: ["chief", "worker"] },
      "chief",
    ),
  );
  assert.equal(accepted.type, "private");
  assert.deepEqual(accepted.memberIds, ["chief", "worker"]);

  assertRejected(
    decideChannelCreateInput({ name: "ops-private", type: "private", memberIds: ["worker"] }, "chief"),
    "private",
    "actor",
    "memberIds",
  );
  assertRejected(
    decideChannelCreateInput({ name: "ops-private", type: "private" }, "chief"),
    "private",
    "memberIds",
  );
});

test("channel_create：memberIds 去重且保持顺序（公开频道由 createChannel 自动加人，重复插入靠它幂等）", () => {
  const accepted = assertAccepted(
    decideChannelCreateInput({ name: "ops-room", memberIds: ["a", "b", "a", "b"] }, "chief"),
  );
  assert.deepEqual(accepted.memberIds, ["a", "b"]);
});

test("channel_create：类型只认 public / private（dm 是另一条创建路径）", () => {
  for (const type of ["dm", "PUBLIC", "", null, 1]) {
    assertRejected(decideChannelCreateInput({ name: "ops-room", type }, "chief"), "type", "public", "private");
  }
});

test("channel_create：name 只校验「是个字符串」，长度与空白规则交给 createChannel 自己抛", () => {
  // 「不要重写一套」：这里放行、由服务层抛 —— 判定层不复制那两条规则。
  assert.equal(assertAccepted(decideChannelCreateInput({ name: "  padded  " }, "chief")).name, "  padded  ");
  assertRejected(decideChannelCreateInput({ name: 5 }, "chief"), "name", "string");
  assertRejected(decideChannelCreateInput({ name: null }, "chief"), "name", "string");
});

test("channel_create：memberIds 必须是字符串数组，description 必须是字符串", () => {
  assertRejected(decideChannelCreateInput({ name: "r", memberIds: "chief" }, "chief"), "memberIds", "array");
  assertRejected(decideChannelCreateInput({ name: "r", memberIds: [1, 2] }, "chief"), "memberIds");
  assertRejected(decideChannelCreateInput({ name: "r", memberIds: [""] }, "chief"), "memberIds");
  assertRejected(decideChannelCreateInput({ name: "r", description: 9 }, "chief"), "description", "string");
  assert.equal(
    assertAccepted(decideChannelCreateInput({ name: "r", description: "  why  " }, "chief")).description,
    "why",
  );
});

// `memberIds` 的准入判据（只收存活 agent）已归能力表，覆盖在
// `lib/domain/collab/member-capabilities.test.mjs` 的 memberIdRejection 用例；
// 工具层用到它的外部效果（软删 / 人类 / 不存在 id 一律拒绝且不建频道）在 tools.test.mjs。

test("channel_create：未知参数报错（如 chiefMemberId 不在本票参数面内）", () => {
  assertRejected(
    decideChannelCreateInput({ name: "r", chiefMemberId: "chief" }, "chief"),
    "unknown",
    "chiefMemberId",
    "name",
  );
});

// ---------------------------------------------------------------------------
// 5. worksplice_agent_create —— *只有* { name, description?, channelId? }
// ---------------------------------------------------------------------------

test("agent_create：最小调用通过，channelId 缺省为 null（工具层再落 #all）", () => {
  assert.deepEqual(assertAccepted(decideAgentCreateInput({ name: "ops-builder" })), {
    name: "ops-builder",
    description: null,
    channelId: null,
  });
  assert.equal(
    assertAccepted(decideAgentCreateInput({ name: "ops-builder", description: " builds ", channelId: "c1" }))
      .description,
    "builds",
  );
});

test("agent_create：provider / modelId / thinkingLevel 出现即报错 —— 不是忽略", () => {
  // 本票的安全取舍：身份自建但不许自带模型配置（否则首席能悄悄把成员指到别处去）。
  for (const [key, value] of [
    ["provider", "openai"],
    ["modelId", "gpt-x"],
    ["thinkingLevel", "high"],
  ]) {
    assertRejected(
      decideAgentCreateInput({ name: "ops-builder", [key]: value }),
      "unknown",
      key,
      "name",
    );
  }
});

test("agent_create：名字必须是 ops- 前缀的形状（一眼可分的自建身份）", () => {
  for (const name of ["ops-a1", "ops-builder", "ops-x-9"]) {
    assert.equal(assertAccepted(decideAgentCreateInput({ name })).name, name);
  }
  // 票据给的正则是 `ops-` + `[a-z0-9]` + `{1,27}`：前缀之后至少**两个**字符，所以
  // `ops-a` / `ops-0` 不合法（不是我们改的规则，是正则字面这么要求的）。
  for (const name of ["Ops-a1", "ops-A1", "x-ops", "ops", "ops-", "ops-a", "ops-0", "worker", "ops-a_b", " ops-a1", "ops-a1 "]) {
    assertRejected(decideAgentCreateInput({ name }), "name", "ops-");
  }
  // 总长 > 32：4（"ops-"）+ 29 个字符 = 33。
  assertRejected(decideAgentCreateInput({ name: `ops-${"a".repeat(29)}` }), "name");
  // 边界：4 + 28 = 32 恰好通过。
  assert.equal(assertAccepted(decideAgentCreateInput({ name: `ops-${"a".repeat(28)}` })).name, `ops-${"a".repeat(28)}`);
});

test("agent_create：description / channelId 的类型也按同样口径校验", () => {
  assertRejected(decideAgentCreateInput({ name: "ops-a1", description: 5 }), "description", "string");
  assertRejected(decideAgentCreateInput({ name: "ops-a1", channelId: "" }), "channelId", "string");
  assertRejected(decideAgentCreateInput({ name: "ops-a1", channelId: null }), "channelId", "string");
});

// ---------------------------------------------------------------------------
// 6. worksplice_task_create —— *只有* { messageId: string }
// ---------------------------------------------------------------------------

test("task_create：只收 messageId，非空字符串且必填", () => {
  assert.deepEqual(assertAccepted(decideTaskCreateInput({ messageId: "m-1" })), { messageId: "m-1" });
  assertRejected(decideTaskCreateInput({}), "messageId", "required");
  for (const messageId of ["", "   ", 7, null, true, {}, ["m-1"]]) {
    assertRejected(decideTaskCreateInput({ messageId }), "messageId", "string");
  }
});

test("task_create：不接受 content / channelId / title —— 本票没有「发消息 + 建任务」的合并形态", () => {
  for (const [key, value] of [
    ["content", "do it"],
    ["channelId", "c-1"],
    ["title", "a title"],
  ]) {
    assertRejected(decideTaskCreateInput({ messageId: "m-1", [key]: value }), "unknown", key, "messageId");
  }
});

// ---------------------------------------------------------------------------
// 约束面来源唯一（票 chief-capability-converge）：判定层不再自己定义名字正则与配额上限
// ---------------------------------------------------------------------------

test("名字正则与配额文案是能力表的**同一个对象**（别名，不是第二份拷贝）", async () => {
  // 本文件用的 jiti 是非缓存的（每个 import 各自求值一次），跨实例只能比结构；
  // 「同一个对象」要用同一个模块缓存才判得出来——这也正是生产路径的形态。
  const cached = createJiti(import.meta.url, { interopDefault: true, moduleCache: true });
  const cachedDecisions = await cached.import("./decisions.ts");
  const cachedCapabilities = await cached.import("../domain/collab/member-capabilities.ts");
  assert.equal(cachedDecisions.AGENT_NAME_PATTERN, cachedCapabilities.MEMBER_AGENT_NAME_PATTERN);
  assert.equal(
    cachedDecisions.AGENT_CREATE_QUOTA_ERROR,
    cachedCapabilities.MEMBER_AGENT_CREATE_QUOTA_REJECTION,
  );
  assert.equal(cachedCapabilities.MEMBER_AGENT_CREATE_LIMIT, 1, "配额上限的唯一来源也是这里");

  // 结构一致性（非缓存实例上仍能证明「同一份规则」）。
  assert.equal(AGENT_NAME_PATTERN.source, capabilities.MEMBER_AGENT_NAME_PATTERN.source);
  assert.equal(AGENT_CREATE_QUOTA_ERROR, capabilities.MEMBER_AGENT_CREATE_QUOTA_REJECTION);
});

test("判定层源码里不再出现名字正则 / 配额上限的字面量（改了规则只能改一处）", async () => {
  const source = await readFile(new URL("./decisions.ts", import.meta.url), "utf8");
  const shared = await readFile(
    new URL("../domain/collab/member-capabilities.ts", import.meta.url),
    "utf8",
  );
  const patternSource = "^ops-[a-z0-9][a-z0-9-]{1,27}$";
  assert.equal(
    shared.split(patternSource).length - 1,
    1,
    "名字正则的字面量只应出现在能力表里（一次）",
  );
  assert.equal(
    source.includes(patternSource),
    false,
    "判定层不得再自己写一份名字正则",
  );
  assert.doesNotMatch(source, /AGENT_CREATE_LIMIT\s*=/, "判定层不得再自己定义配额上限");
  assert.doesNotMatch(source, /created\s*>=\s*\d/, "判定层不得再自己数配额");
});

// ---------------------------------------------------------------------------
// 可见面（bounded read）：公开频道人人可见，其余只对成员可见
// ---------------------------------------------------------------------------

test("可见面：公开频道不看成员关系；私有 / DM 只对成员可见", () => {
  assert.equal(isChannelVisibleToActor({ type: "public" }, false), true);
  assert.equal(isChannelVisibleToActor({ type: "public" }, true), true);
  assert.equal(isChannelVisibleToActor({ type: "private" }, true), true);
  assert.equal(isChannelVisibleToActor({ type: "private" }, false), false);
  assert.equal(isChannelVisibleToActor({ type: "dm" }, true), true);
  assert.equal(isChannelVisibleToActor({ type: "dm" }, false), false);
});

// ---------------------------------------------------------------------------
// 读面摘要：只回约定字段，不给全文
// ---------------------------------------------------------------------------

test("频道摘要只带五个字段，archived 归一成布尔", () => {
  const summary = channelSummary(
    { id: "c1", name: "ops-room", type: "public", archived: 1 },
    3,
  );
  assert.deepEqual(summary, { id: "c1", name: "ops-room", type: "public", archived: true, memberCount: 3 });
  assert.deepEqual(Object.keys(summary).sort(), ["archived", "id", "memberCount", "name", "type"]);
});

test("成员摘要只带四个字段", () => {
  const summary = memberSummary({ id: "m1", name: "Susan", type: "agent", status: "online" });
  assert.deepEqual(summary, { id: "m1", name: "Susan", type: "agent", status: "online" });
  assert.deepEqual(Object.keys(summary).sort(), ["id", "name", "status", "type"]);
});

test("任务摘要：owner 可以是 null，preview 截到 120 且不吐全文", () => {
  const summary = taskSummary({
    number: 7,
    status: "in_progress",
    owner: { name: "Susan" },
    anchor: { content: "x".repeat(400) },
  });
  assert.deepEqual(Object.keys(summary).sort(), ["number", "ownerName", "preview", "status"]);
  assert.equal(summary.number, 7);
  assert.equal(summary.status, "in_progress");
  assert.equal(summary.ownerName, "Susan");
  // 票据说的是「截断到 120 字符」= 输出长度；省略号占一位，所以内容取 119。
  assert.equal(summary.preview.startsWith("x".repeat(TASK_PREVIEW_MAX_LENGTH - 1)), true);
  assert.equal(summary.preview.length, TASK_PREVIEW_MAX_LENGTH, "输出不超过 120 字符（含省略号）");
  assert.equal(summary.preview.endsWith("…"), true);
  assert.equal(TASK_PREVIEW_MAX_LENGTH, 120);

  const unowned = taskSummary({ number: 8, status: "todo", owner: null, anchor: { content: "short" } });
  assert.equal(unowned.ownerName, null);
  assert.equal(unowned.preview, "short");
});

// ---------------------------------------------------------------------------
// 系统事件文案（英文，紧跟既有事件消息的写法）
// ---------------------------------------------------------------------------

test("系统事件文案与票据给的字面格式一致", () => {
  assert.equal(channelCreateEventContent("Susan", "ops-room"), "Susan created channel #ops-room");
  assert.equal(agentCreateEventContent("Susan", "ops-builder"), "Susan created agent @ops-builder");
});

// ---------------------------------------------------------------------------
// 零依赖：判定层不得把 SDK / Next / React / DB 拖进来
// ---------------------------------------------------------------------------

test("判定层只依赖纯工具模块（无 SDK / Next / React / DB）", async () => {
  const source = await readFile(new URL("./decisions.ts", import.meta.url), "utf8");
  const imports = [...source.matchAll(/^\s*import\s+(type\s+)?[\s\S]*?from\s+["']([^"']+)["']/gm)].map((m) => ({
    typeOnly: Boolean(m[1]),
    from: m[2],
  }));

  // 运行时只允许纯工具模块 + **能力表**（约束面的唯一来源，票 chief-capability-converge）。
  // 能力表本身零 SDK / 零 DB（只 import 数据层常量与类型），所以判定层仍然不拖运行时依赖；
  // 这里把允许面写成白名单，新增第三个运行时依赖时照样红。
  assert.deepEqual(
    imports.filter((entry) => !entry.typeOnly).map((entry) => entry.from),
    ["../preview.ts", "../domain/collab/member-capabilities.ts"],
    `判定层只允许引入纯工具模块与能力表，实际：${imports.map((entry) => entry.from).join(", ")}`,
  );
  assert.deepEqual(
    imports.filter((entry) => entry.typeOnly).map((entry) => entry.from),
    ["../data/types.ts"],
    "类型只能来自数据层共享词表",
  );
  assert.doesNotMatch(source, /better-sqlite3/);
  assert.doesNotMatch(source, /@earendil-works\//);
  assert.doesNotMatch(source, /from ["']react["']/);
  assert.doesNotMatch(source, /from ["']next/);
});
