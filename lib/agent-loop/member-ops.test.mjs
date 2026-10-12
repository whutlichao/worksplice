import assert from "node:assert/strict";
import test from "node:test";

// 纯函数层：op 解析 + 校验 + 裁决（票 02 建立的两个 seam 之一）。
const { parseAgentAction } = await import("./loop.ts");
const { parseMemberOps, planMemberOps, MAX_MEMBER_OPS_PER_ROUND, formatSearchObservation } =
  await import("./member-ops.ts");

function planOne(raw) {
  const [plan] = planMemberOps(parseMemberOps([raw]));
  return plan;
}

// ---------------------------------------------------------------------------
// 解析：ops 数组挂在既有协议上（parseAgentAction 向后兼容）
// ---------------------------------------------------------------------------

test("parseAgentAction carries the optional ops array without changing the legacy shape", () => {
  const legacy = parseAgentAction('{"action":"reply","content":"hi"}');
  assert.deepEqual(legacy, { action: "reply", content: "hi", onConflict: "revise" });
  assert.equal(legacy.ops, undefined, "没有 ops 时不得凭空造出字段");

  const withOps = parseAgentAction(
    '{"action":"reply","content":"on it","ops":[{"op":"react","seq":3,"emoji":"👍"}]}',
  );
  assert.equal(withOps.action, "reply");
  assert.equal(withOps.ops.length, 1);
  assert.equal(withOps.ops[0].op, "react");
  assert.deepEqual(withOps.ops[0].fields, { seq: 3, emoji: "👍" });

  const nonArray = parseAgentAction('{"action":"reply","content":"x","ops":"react"}');
  assert.equal(nonArray.ops, undefined, "ops 不是数组时忽略（不炸整轮）");
});

test("parseMemberOps keeps unknown names and non-object entries for boundary reporting", () => {
  const parsed = parseMemberOps([
    { op: "react", seq: 1, emoji: "👍" },
    { op: "archiveChannel", name: "x" },
    "nope",
    null,
    { seq: 1 },
  ]);
  assert.deepEqual(
    parsed.map((entry) => entry.op),
    ["react", "archiveChannel", "unknown", "unknown", "unknown"],
  );
  assert.deepEqual(parsed[1].fields, { name: "x" });
});

// ---------------------------------------------------------------------------
// 校验 + 裁决：形状 / 缺字段 / 未知 op 名 / 人类专属
// ---------------------------------------------------------------------------

test("valid ops plan into typed actions", () => {
  assert.deepEqual(planOne({ op: "react", seq: 3, emoji: "👍" }), {
    kind: "planned",
    action: { op: "react", messageRef: { messageId: null, seq: 3, targetRef: null }, emoji: "👍" },
  });
  assert.deepEqual(planOne({ op: "pin", messageId: "m1" }), {
    kind: "planned",
    action: { op: "pin", messageRef: { messageId: "m1", seq: null, targetRef: null } },
  });
  assert.deepEqual(planOne({ op: "remind", title: "stand up", inMinutes: 30 }), {
    kind: "planned",
    action: {
      op: "remind",
      title: "stand up",
      fireAt: null,
      inMinutes: 30,
      recurrence: null,
      targetRef: null,
    },
  });
  assert.deepEqual(planOne({ op: "post", targetId: "#all", content: "pointer" }), {
    kind: "planned",
    action: { op: "post", targetRef: "#all", content: "pointer", baseSeq: null },
  });
  assert.deepEqual(planOne({ op: "createChannel", name: "room", members: ["@Susan"] }), {
    kind: "planned",
    action: {
      op: "createChannel",
      name: "room",
      type: "public",
      description: "",
      members: ["@Susan"],
    },
  });
  assert.deepEqual(planOne({ op: "createAgent", name: "Bob", provider: "p", modelId: "m" }), {
    kind: "planned",
    action: {
      op: "createAgent",
      name: "Bob",
      description: "",
      provider: "p",
      modelId: "m",
      thinkingLevel: null,
    },
  });
  assert.deepEqual(planOne({ op: "search", query: "keyword", limit: 5 }), {
    kind: "planned",
    action: { op: "search", query: "keyword", limit: 5 },
  });
});

test("malformed ops are rejected with a readable reason, not silently dropped", () => {
  const cases = [
    [{ op: "react", seq: 1 }, /emoji/i],
    [{ op: "react", emoji: "👍" }, /seq|messageId/i],
    [{ op: "pin" }, /seq|messageId/i],
    [{ op: "remind", inMinutes: 10 }, /title/i],
    [{ op: "remind", title: "x" }, /fireAt|inMinutes/i],
    [{ op: "remind", title: "x", fireAt: "not-a-date" }, /fireAt/i],
    [{ op: "remind", title: "x", fireAt: "2030-01-01T00:00:00.000Z", inMinutes: 5 }, /one of/i],
    [{ op: "remind", title: "x", inMinutes: 0 }, /inMinutes/i],
    [{ op: "remind", title: "x", inMinutes: 10, recurrence: "every:0m" }, /recurrence/i],
    [{ op: "post", targetId: "#all" }, /content/i],
    [{ op: "post", content: "x" }, /targetId/i],
    [{ op: "createChannel" }, /name/i],
    [{ op: "createChannel", name: "x", type: "dm" }, /type/i],
    [{ op: "createAgent", name: "x", provider: "p" }, /provider|modelId/i],
    [{ op: "search" }, /query/i],
    ["nope", /default deny/i],
  ];
  for (const [raw, pattern] of cases) {
    const [plan] = planMemberOps(parseMemberOps([raw]));
    assert.equal(plan.kind, "rejected", `${JSON.stringify(raw)} 应被拒`);
    assert.match(plan.reason, pattern, `${JSON.stringify(raw)} 的理由应命中 ${pattern}`);
  }
});

test("unknown and human-only op names are denied by default", () => {
  for (const name of ["archive", "bash", "curl"]) {
    const [plan] = planMemberOps(parseMemberOps([{ op: name }]));
    assert.equal(plan.kind, "rejected");
    assert.match(plan.reason, /default deny/i);
  }
  const [humanOnly] = planMemberOps(parseMemberOps([{ op: "setRuntime", agentId: "a" }]));
  assert.equal(humanOnly.kind, "rejected");
  assert.match(humanOnly.reason, /human-only/i);
  const [deleteIdentity] = planMemberOps(parseMemberOps([{ op: "deleteIdentity", agentId: "a" }]));
  assert.equal(deleteIdentity.kind, "rejected");
  assert.match(deleteIdentity.reason, /human-only/i);
});

test("ops per round are capped so one reply cannot fan out unbounded", () => {
  const many = Array.from({ length: MAX_MEMBER_OPS_PER_ROUND + 2 }, () => ({
    op: "react",
    seq: 1,
    emoji: "👍",
  }));
  const plans = planMemberOps(parseMemberOps(many));
  assert.equal(plans.length, MAX_MEMBER_OPS_PER_ROUND + 2);
  const rejected = plans.filter((plan) => plan.kind === "rejected");
  assert.equal(rejected.length, 2);
  assert.match(rejected[0].reason, /at most/i);
});

// ---------------------------------------------------------------------------
// 观察相格式（上下文治理票 07）：归档命中携带来源与条目定位，纯函数层可断言
// ---------------------------------------------------------------------------

test("formatSearchObservation：归档命中形成可定位的观察行（来源 + 归档会话 + 条目定位）", () => {
  const text = formatSearchObservation("ORCHID-42", [
    {
      source: "archive",
      archive_id: "agent-7/deadbeef",
      agent_id: "agent-7",
      source_path: "/tmp/session.jsonl",
      entry_index: 2,
      entry_type: "message",
      snippet: "关键事实 <mark>ORCHID-42</mark>",
      agent: null,
    },
  ]);
  assert.match(
    text,
    /\[archived session of @agent-7, archive agent-7\/deadbeef, entry 2 \(message\)\]: 关键事实 ORCHID-42/,
  );
  assert.doesNotMatch(text, /<mark>/, "观察相剥离高亮标记（既有口径不变）");
});
