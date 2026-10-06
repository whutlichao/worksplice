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
