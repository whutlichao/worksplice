import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/sqlite.ts";

/**
 * 票 chief-recipient-router：两段固定骨架行只在**适用**的角色 / 会话出现。
 *
 * - A（收件人只路由）：当且仅当本轮以 `chief` 角色被邀请（无点名、无任务关联的人类消息）。
 * - B（建完即派）：任何一轮**首席会话**都出现——`handoff` 只对全局首席开放，六个
 *   `worksplice_*` 工具也只在首席会话注册；把它加进普通成员的 prompt 等于教一个它没有的工具
 *   （也违反「普通成员 prompt 逐字节不变」这条不变量）。
 *
 * 两条接缝：`buildReplyPrompt`（骨架行本身）与 `runAgentRound`（角色 → prompt 的接线）。
 * 断言同时钉住「出现了什么」与「没出现什么」——只钉「出现」的话，把 A 加到所有轮次上也会全绿。
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-chief-recipient-prompt-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const {
  createAgent,
  createChannel,
  createRoomTurnStore,
  joinChannel,
  sendMessage,
  setGlobalChief,
  setRoomTurnStore,
} = await import("../domain/collab/index.ts");
const {
  buildReplyPrompt,
  runAgentRound,
  DEFAULT_RECIPIENT_RULE,
  CREATE_THEN_HANDOFF_RULE,
} = await import("./loop.ts");
const { OWNER_MEMBER_ID } = await import("../data/schema.ts");

let fixtureSeq = 0;
function unique(prefix) {
  fixtureSeq += 1;
  return `${prefix}-${fixtureSeq}`;
}

/** fake 会话：prompt 之后必须 emit 完成事件（round 在等 `waitForPromptCompletion`）。 */
function makeFakeSession(replies = []) {
  const listeners = [];
  let running = false;
  return {
    replies,
    lastText: "",
    prompts: [],
    isRunning: () => running,
    onEvent(listener) {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    emit(event) {
      for (const listener of [...listeners]) listener(event);
    },
    async send(command) {
      if (command.type === "prompt") {
        this.prompts.push(command.message);
        const reply = this.replies.shift();
        running = true;
        queueMicrotask(() => {
          running = false;
          this.lastText = reply?.text ?? "";
          this.emit({ type: "prompt_done" });
          this.emit({ type: "agent_end" });
        });
        return null;
      }
      if (command.type === "get_last_assistant_text") return { text: this.lastText };
      if (command.type === "get_last_assistant_error") {
        return { stopReason: null, errorMessage: null };
      }
      return null;
    },
  };
}

function makeFakeRuntime({ repliesByAgent = {} } = {}) {
  const sessions = new Map();
  const starts = [];
  return {
    sessions,
    starts,
    findSession: (member) => sessions.get(member.id),
    async startSession(member) {
      if (!member.workspace_path) throw new Error("Agent has no workspace bound");
      starts.push(member.id);
      const session = makeFakeSession(repliesByAgent[member.id] ?? []);
      sessions.set(member.id, session);
      return { sessionId: member.id, sessionFile: `/sessions/${member.id}.jsonl` };
    },
  };
}

function makeAgent(prefix, { join = null } = {}) {
  const agent = createAgent({
    name: unique(prefix),
    workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), `worksplice-recipient-${prefix}-`)),
  });
  if (join) joinChannel(join, agent.id);
  return agent;
}

function replyText(content) {
  return JSON.stringify({ action: "reply", content });
}

function sendAsOwner(targetId, content) {
  const result = sendMessage({ targetId, authorId: OWNER_MEMBER_ID, content });
  assert.equal(result.held, false);
  return result.message;
}

/**
 * 直调接缝：频道轮的骨架行，只有 `recipient` 在变。
 * fixture 只建一次——成员名/频道名/id 都进 prompt，「逐字节相同」那条断言要求同一份语境。
 */
let unitFixture = null;
function unitFixturePair() {
  if (!unitFixture) {
    const agent = makeAgent("recipient-unit");
    const channel = createChannel({ name: unique("recipient-unit-room") });
    joinChannel(channel.id, agent.id);
    unitFixture = { agent, channel };
  }
  return unitFixture;
}

function unitPrompt(recipient) {
  const { agent, channel } = unitFixturePair();
  return buildReplyPrompt({
    agent,
    channel,
    messages: [],
    tasks: [],
    targetId: channel.id,
    baseSeq: 0,
    recipient,
  });
}

// ---------------------------------------------------------------------------
// A：收件人只路由
// ---------------------------------------------------------------------------

test("A：默认收件人轮带「只路由、不长篇作答、短答仍用 reply」规则", () => {
  const prompt = unitPrompt({ role: "chief", canHandoff: true });

  for (const line of DEFAULT_RECIPIENT_RULE) {
    assert.ok(prompt.includes(line), `chief 轮必须带这条骨架行：${line}`);
  }

  // 独立于导出常量的字面哨兵：任一条语义被改弱（默认收件人 / 分流不展开 / 短答用 reply）都会在这里红。
  const literalRules = [
    /the channel's default recipient/i,
    /nobody was named/i,
    /routing, not answering it in depth/i,
    /worksplice_task_create/,
    /one or two sentences/i,
    /never "ignore": silence would read as if you never saw the message/i,
  ];
  for (const rule of literalRules) {
    assert.match(prompt, rule, `A 段语义必须逐条保留：${rule}`);
  }
});

test("A：非 chief 角色的每一档轮次逐字不含该规则", () => {
  const roles = [
    "human-mention",
    "all-mention",
    "task-owner",
    "task-reviewer",
    "task-event",
    "secretary-handoff",
    "reminder",
    "dm",
  ];
  for (const role of roles) {
    const prompt = unitPrompt({ role, canHandoff: true });
    assert.ok(
      !prompt.includes(DEFAULT_RECIPIENT_RULE[0]),
      `role=${role} 不得出现 A 段骨架行`,
    );
    assert.doesNotMatch(prompt, /default recipient/i, `role=${role} 不得自称默认收件人`);
    assert.doesNotMatch(prompt, /routing, not answering it in depth/i, `role=${role} 不得带分流规则`);
  }
});

// ---------------------------------------------------------------------------
// B：建完即派（首席会话的任何轮次）
// ---------------------------------------------------------------------------

test("B：首席会话的任何轮次都带「建完即派」，非首席会话不带", () => {
  const chiefRoles = ["chief", "human-mention", "task-owner", "secretary-handoff"];
  for (const role of chiefRoles) {
    const prompt = unitPrompt({ role, canHandoff: true });
    for (const line of CREATE_THEN_HANDOFF_RULE) {
      assert.ok(prompt.includes(line), `role=${role}（首席会话）必须带这条骨架行：${line}`);
    }
    assert.match(prompt, /"op":"handoff","assignee":"@Name"/, `role=${role} 必须教到同轮派活`);
    assert.match(prompt, /worksplice_list_members/, `role=${role} 必须先看清候选`);
    assert.match(prompt, /still unclaimed/i, `role=${role} 必须说清派活失败不回滚`);
  }

  const plain = unitPrompt({ role: "human-mention", canHandoff: false });
  for (const line of CREATE_THEN_HANDOFF_RULE) {
    assert.ok(!plain.includes(line), "非首席会话不得出现 B 段骨架行（它没有这些工具）");
  }
  assert.doesNotMatch(plain, /"op":"handoff"/, "非首席会话不得教 handoff op");
});

// ---------------------------------------------------------------------------
// 不变量 C：不适用 = 一个字节都不加
// ---------------------------------------------------------------------------

test("不变量 C：不给 recipient 与给一个不适用 recipient，prompt 逐字节相同", () => {
  const omitted = unitPrompt(undefined);
  const notApplicable = unitPrompt({ role: "human-mention", canHandoff: false });
  assert.equal(
    notApplicable,
    omitted,
    "非适用角色 / 非首席会话不得给 prompt 增加任何字符",
  );
});

test("骨架位置：两段规则落在 onConflict 之后、Task protocol 之前（不动其余 response rules）", () => {
  const prompt = unitPrompt({ role: "chief", canHandoff: true });
  const onConflictAt = prompt.indexOf("onConflict applies only if the room changed");
  const recipientAt = prompt.indexOf(DEFAULT_RECIPIENT_RULE[0]);
  const handoffAt = prompt.indexOf(CREATE_THEN_HANDOFF_RULE[0]);
  const protocolAt = prompt.indexOf("Task protocol:");
  assert.ok(onConflictAt >= 0 && protocolAt >= 0);
  assert.ok(
    onConflictAt < recipientAt && recipientAt < handoffAt && handoffAt < protocolAt,
    "两段规则必须作为固定骨架插在既有 rubric 之后、任务协议之前",
  );
  // 其余 response rules 一字未动（抽查两条最容易被改写的）
  assert.match(prompt, /MUST reply: a human \(the Owner\) personally @mentions you/);
  assert.match(prompt, /Reply shape: for a simple task, state the direct conclusion first/);
});

// ---------------------------------------------------------------------------
// 驱动层接线：角色真的传进了 prompt
// ---------------------------------------------------------------------------

test("驱动层：无点名消息落到首席 ⇒ role=chief 的 prompt 带 A 与 B", async () => {
  setRoomTurnStore(createRoomTurnStore());
  const chief = makeAgent("recv-chief");
  setGlobalChief(chief.id);
  // 首席先生效 ⇒ 新建的公开频道自动把它加入。
  const channel = createChannel({ name: unique("recv-room") });
  makeAgent("recv-alpha", { join: channel.id });
  const runtime = makeFakeRuntime({
    repliesByAgent: { [chief.id]: [{ text: replyText("收到，我看看该谁做") }] },
  });
  try {
    sendAsOwner(channel.id, "今天谁值班？");
    const outcome = await runAgentRound(chief.id, channel.id, runtime);

    assert.equal(outcome.status, "replied", JSON.stringify(outcome));
    assert.equal(outcome.role, "chief", "无点名消息的轮次角色是 chief");
    const [prompt] = runtime.sessions.get(chief.id).prompts;
    for (const line of DEFAULT_RECIPIENT_RULE) {
      assert.ok(prompt.includes(line), `驱动层必须把 A 段带进 chief 轮的 prompt：${line}`);
    }
    for (const line of CREATE_THEN_HANDOFF_RULE) {
      assert.ok(prompt.includes(line), `驱动层必须把 B 段带进 chief 轮的 prompt：${line}`);
    }
    // 与导出常量无关的字面哨兵：接线真的把语义送进了模型上下文（不是只多了一个入参）。
    assert.match(prompt, /the channel's default recipient/i);
    assert.match(prompt, /"op":"handoff","assignee":"@Name"/);
  } finally {
    setRoomTurnStore(null);
    setGlobalChief(null);
  }
});

test("驱动层：首席被人点名（role 不是 chief）⇒ 只有 B，没有 A", async () => {
  setRoomTurnStore(createRoomTurnStore());
  const chief = makeAgent("recv-mention-chief");
  setGlobalChief(chief.id);
  const channel = createChannel({ name: unique("recv-mention-room") });
  const runtime = makeFakeRuntime({
    repliesByAgent: { [chief.id]: [{ text: replyText("收到") }] },
  });
  try {
    sendAsOwner(channel.id, `@${chief.name} 你看下这个`);
    const outcome = await runAgentRound(chief.id, channel.id, runtime);

    assert.equal(outcome.status, "replied");
    assert.equal(outcome.role, "human-mention", "被点名的轮次角色不是 chief");
    const [prompt] = runtime.sessions.get(chief.id).prompts;
    for (const line of CREATE_THEN_HANDOFF_RULE) {
      assert.ok(prompt.includes(line), "首席会话的普通轮次仍带 B 段");
    }
    assert.match(prompt, /"op":"handoff","assignee":"@Name"/, "首席会话的普通轮次仍教同轮派活");
    assert.doesNotMatch(prompt, /the channel's default recipient/i, "被点名的轮次不带 A 段");
  } finally {
    setRoomTurnStore(null);
    setGlobalChief(null);
  }
});

test("驱动层：普通成员（非首席）的被点名轮 prompt 里两段都不出现", async () => {
  setRoomTurnStore(createRoomTurnStore());
  const chief = makeAgent("recv-plain-chief");
  setGlobalChief(chief.id);
  const channel = createChannel({ name: unique("recv-plain-room") });
  const alpha = makeAgent("recv-plain-alpha", { join: channel.id });
  const runtime = makeFakeRuntime({
    repliesByAgent: { [alpha.id]: [{ text: replyText("收到") }] },
  });
  try {
    sendAsOwner(channel.id, `@${alpha.name} 看下这个`);
    const outcome = await runAgentRound(alpha.id, channel.id, runtime);

    assert.equal(outcome.status, "replied");
    assert.equal(outcome.role, "human-mention");
    const [prompt] = runtime.sessions.get(alpha.id).prompts;
    assert.ok(!prompt.includes(DEFAULT_RECIPIENT_RULE[0]), "普通成员不带 A 段");
    assert.ok(!prompt.includes(CREATE_THEN_HANDOFF_RULE[0]), "普通成员不带 B 段");
    assert.doesNotMatch(prompt, /the channel's default recipient/i, "普通成员不带 A 段");
    assert.doesNotMatch(prompt, /"op":"handoff"/, "普通成员不带 B 段");
  } finally {
    setRoomTurnStore(null);
    setGlobalChief(null);
  }
});
