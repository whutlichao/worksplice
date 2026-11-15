import assert from "node:assert/strict";
import test from "node:test";

// 纯函数层（票 02 建立的第二个 seam 的一半）：授权裁决不碰 DB、不碰协议解析。
const {
  canMemberPerform,
  assertMemberMayPerform,
  MemberOperationDeniedError,
  MEMBER_OPEN_OPS,
  HUMAN_ONLY_OPERATIONS,
} = await import("./member-capabilities.ts");

// ---------------------------------------------------------------------------
// 逐条开口：七条能力（ADR-0013 §1.5 的 1:1 映射）+ 协议既有的 reply/task
// ---------------------------------------------------------------------------

test("member-open op vocabulary covers the seven capabilities plus the existing protocol ops", () => {
  const open = new Set(MEMBER_OPEN_OPS);
  // ADR-0013 §1.5 的 7 条：频道列表 / 成员列表 / 发消息 / 建频道 / 建 agent / 搜索 / 设提醒
  // —— 前两条走每轮语境（buildReplyPrompt 注入），其余五条是 op：
  for (const op of [
    "reply", // 发消息（reply 本身；跨 target 指针消息为 post）
    "post",
    "createChannel", // 建频道
    "createAgent", // 建 agent
    "search", // 搜索
    "remind", // 设提醒
    "react", // §5.4 act 清单
    "pin", // §5.4 act 清单
    "task", // 协议既有（claim / complete / unclaim）
  ]) {
    assert.equal(open.has(op), true, `${op} 应在成员开口清单里`);
  }
});

test("every member gets the same open set — no secretary exemption", () => {
  // 判据只按「动作是否提升调用者权限」判定，不按调用者是谁：agent 一律同等。
  for (const op of MEMBER_OPEN_OPS) {
    const agent = canMemberPerform(op, "agent");
    const human = canMemberPerform(op, "human");
    assert.equal(agent.allowed, true, `agent 应可执行 ${op}`);
    assert.equal(human.allowed, true, `human 应可执行 ${op}`);
    assert.ok(agent.reason.length > 0, "允许也要给出可读理由（边界可见）");
  }
});

// ---------------------------------------------------------------------------
// 人类专属操作：成员一律不开（归档 / 删除身份 / 三种 reset / 改 runtime / 改 workspace）
// ---------------------------------------------------------------------------

test("human-only operations are closed to members, with the name in the reason", () => {
  const expected = [
    "archiveChannel",
    "unarchiveChannel",
    "deleteIdentity",
    "restart",
    "sessionReset",
    "fullReset",
    "setRuntime",
    "setWorkspace",
  ];
  assert.deepEqual([...HUMAN_ONLY_OPERATIONS], expected);
  for (const op of expected) {
    const verdict = canMemberPerform(op, "agent");
    assert.equal(verdict.allowed, false, `${op} 对成员必须拒绝`);
    assert.match(verdict.reason, /human-only|Owner/i, `${op} 的拒绝理由要说清是人类专属`);
  }
});

test("humans still pass the human-only gate (the Owner UI path is unchanged)", () => {
  for (const op of HUMAN_ONLY_OPERATIONS) {
    assert.equal(canMemberPerform(op, "human").allowed, true);
  }
});

// ---------------------------------------------------------------------------
// 默认拒绝：不在两张表里的名字一律拒绝（不靠「恰好没写」）
// ---------------------------------------------------------------------------

test("unknown op names are denied by default for every actor", () => {
  for (const op of ["", "archive", "bash", "curl", "setRuntimeConfig", "REACT"]) {
    for (const actor of ["agent", "human"]) {
      const verdict = canMemberPerform(op, actor);
      assert.equal(verdict.allowed, false, `未知 op ${op}（${actor}）必须默认拒绝`);
      assert.match(verdict.reason, /default deny|unknown/i);
    }
  }
});

test("assertMemberMayPerform throws a typed denial that reports the boundary", () => {
  assert.throws(
    () => assertMemberMayPerform("deleteIdentity", "agent"),
    (error) => {
      assert.ok(error instanceof MemberOperationDeniedError);
      assert.equal(error.operation, "deleteIdentity");
      assert.match(error.message, /deleteIdentity/);
      return true;
    },
  );
  assert.doesNotThrow(() => assertMemberMayPerform("react", "agent"));
  assert.doesNotThrow(() => assertMemberMayPerform("deleteIdentity", "human"));
});

test("assertActorMayPerform is the service-layer gate: the Owner id is human, every other id is a member", async () => {
  const { assertActorMayPerform } = await import("./member-capabilities.ts");
  const { OWNER_MEMBER_ID } = await import("../../data/schema.ts");
  assert.doesNotThrow(() => assertActorMayPerform("archiveChannel", OWNER_MEMBER_ID));
  assert.throws(
    () => assertActorMayPerform("archiveChannel", "some-agent-id"),
    /human-only/,
    "非 Owner 的调用者（= 成员）不得归档频道",
  );
});

// ---------------------------------------------------------------------------
// 约束面（票 chief-capability-converge）：`canMemberPerform` 回答「能不能」，
// 约束面回答「以什么形状能」——两条执行路径（ops 面 / 首席 tools 面）共用同一份。
// ---------------------------------------------------------------------------

const {
  memberOpConstraint,
  MEMBER_AGENT_NAME_PATTERN,
  MEMBER_AGENT_CREATE_LIMIT,
  MEMBER_AGENT_MODEL_FIELDS,
  agentNameRejection,
  modelSelectionRejection,
  privateChannelActorRejection,
  memberIdRejection,
} = await import("./member-capabilities.ts");

test("约束面只覆盖两条会「造出东西」的 op，其余动作没有执行约束", () => {
  for (const op of ["createAgent", "createChannel"]) {
    assert.ok(memberOpConstraint(op), `${op} 必须有一条执行约束`);
  }
  // 已经定口径的五条 op 不带约束面（本票不动它们的行为，ADR-0013 的开口表也不因此改变）。
  for (const op of ["post", "react", "pin", "remind", "search", "reply", "task", "deleteIdentity", "nope"]) {
    assert.equal(memberOpConstraint(op), null, `${op} 不该凭空多出一条约束`);
  }
});

test("createAgent 的约束：名字形状 + 每会话 1 次 + 不接受模型选择，都只有一处定义", () => {
  assert.deepEqual(memberOpConstraint("createAgent"), {
    op: "createAgent",
    namePattern: MEMBER_AGENT_NAME_PATTERN,
    perSessionLimit: MEMBER_AGENT_CREATE_LIMIT,
    rejectedFields: MEMBER_AGENT_MODEL_FIELDS,
  });
  assert.equal(MEMBER_AGENT_NAME_PATTERN.source, "^ops-[a-z0-9][a-z0-9-]{1,27}$");
  assert.equal(MEMBER_AGENT_CREATE_LIMIT, 1);
  assert.deepEqual([...MEMBER_AGENT_MODEL_FIELDS], ["provider", "modelId", "thinkingLevel"]);
});

test("createChannel 的约束：私有必须含 actor、memberIds 只收存活 agent", () => {
  assert.deepEqual(memberOpConstraint("createChannel"), {
    op: "createChannel",
    privateRequiresActor: true,
    memberIds: "live-agent",
  });
});

test("agentNameRejection：合规名字放行，不合规给出可读理由（点名正则与允许形状）", () => {
  for (const name of ["ops-a1", "ops-builder", "ops-x-9", `ops-${"a".repeat(28)}`]) {
    assert.equal(agentNameRejection(name), null, `${name} 应放行`);
  }
  for (const name of ["Susan", "Ops-a1", "x-ops", "ops-", "ops-a", `ops-${"a".repeat(29)}`, "", " ops-a1"]) {
    const reason = agentNameRejection(name);
    assert.ok(reason, `${JSON.stringify(name)} 应被拒绝`);
    assert.match(reason, /agent name must match/);
    assert.match(reason, /ops-/);
  }
  // 非字符串也要报边界（不退化成「恰好匹配不上」）。
  assert.match(agentNameRejection(5), /received 5/);
  assert.match(agentNameRejection(undefined), /received undefined/);
});

test("modelSelectionRejection：provider / modelId / thinkingLevel 任一出现即拒绝并点名", () => {
  assert.equal(modelSelectionRejection({}), null);
  assert.equal(modelSelectionRejection({ provider: null, modelId: null, thinkingLevel: null }), null);
  for (const field of ["provider", "modelId", "thinkingLevel"]) {
    const reason = modelSelectionRejection({ [field]: "x" });
    assert.ok(reason, `${field} 出现即应拒绝`);
    assert.match(reason, new RegExp(field));
    assert.match(reason, /global default/, "理由要说清「继承全局默认」这条规则");
  }
  // 一次点名全部违规字段（模型据此能一次改对）。
  const many = modelSelectionRejection({ provider: "openai", modelId: "gpt-5", thinkingLevel: "max" });
  for (const field of ["provider", "modelId", "thinkingLevel"]) {
    assert.match(many, new RegExp(field));
  }
});

test("privateChannelActorRejection：私有频道不含 actor 才拒绝，公开频道不受影响", () => {
  assert.equal(privateChannelActorRejection({ type: "public", memberIds: [], actorId: "a-1" }), null);
  assert.equal(privateChannelActorRejection({ type: "public", memberIds: ["b-2"], actorId: "a-1" }), null);
  assert.equal(privateChannelActorRejection({ type: "private", memberIds: ["a-1"], actorId: "a-1" }), null);
  for (const memberIds of [[], ["b-2"]]) {
    const reason = privateChannelActorRejection({ type: "private", memberIds, actorId: "a-1" });
    assert.ok(reason, `私有频道缺 actor（memberIds=${JSON.stringify(memberIds)}）应被拒绝`);
    assert.match(reason, /private/);
    assert.match(reason, /actor/);
    assert.match(reason, /memberIds/);
  }
});

test("memberIdRejection：只收存活 agent（软删 / 人类 / 不存在一律拒绝）", () => {
  assert.equal(memberIdRejection({ type: "agent", deleted: 0 }, "a-1"), null);
  assert.match(memberIdRejection(null, "ghost"), /not found/);
  assert.match(memberIdRejection(undefined, "ghost"), /not found/);
  assert.match(memberIdRejection({ type: "agent", deleted: 1 }, "gone"), /deleted/);
  assert.match(memberIdRejection({ type: "human", deleted: 0 }, "owner"), /not an agent/);
});
