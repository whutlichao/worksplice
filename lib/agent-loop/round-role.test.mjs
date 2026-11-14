import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/sqlite.ts";

/**
 * 票 #249 的驱动层黑盒：轮次结果里能读出**这一轮怎么进来的**（准入角色）。
 *
 * 接缝比 `chief-round.test.mjs` 更靠外一层——那条用例直接调 `runAgentRound`，而落盘发生在
 * driver（`logRoundOutcome` 的唯一生产调用点），所以这里用 `startAgentLoopDriver` + 真实
 * 临时 SQLite + 协作域服务 + 房间场次 store + fake runtime，一条人类消息从 wake 走到
 * `round_logs`，既证明角色落盘，也证明「记录角色不改变行为」：
 * 会话数、prompt 次数与 #248 的选人口径一致（不多叫一个 agent、不多跑一轮）。
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-round-role-"));
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
const { startAgentLoopDriver } = await import("./loop.ts");
const { OWNER_MEMBER_ID } = await import("../data/schema.ts");

let fixtureSeq = 0;
function unique(prefix) {
  fixtureSeq += 1;
  return `${prefix}-${fixtureSeq}`;
}

/**
 * fake 会话：prompt 之后**必须** emit `prompt_done` / `agent_end`——`promptSession` 在等
 * `waitForPromptCompletion`，不发完成事件会让整轮死等（本 effort 已踩过两次）。
 */
function makeFakeSession(replies = []) {
  const listeners = [];
  let running = false;
  return {
    replies,
    lastText: "",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
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
        this.usage.input += 100;
        this.usage.output += 25;
        this.usage.cost += 0.001;
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
      if (command.type === "get_session_stats") {
        return { tokens: { ...this.usage }, cost: this.usage.cost };
      }
      return null;
    },
  };
}

function makeFakeRuntime(repliesByAgent = {}) {
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
    workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), `worksplice-round-role-${prefix}-`)),
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

function roundsOf(agentId) {
  return globalThis.__workspliceDb.listRoundLogs(agentId);
}

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("首席接住无点名消息：轮次记录 role=chief，恰好一个会话、一次模型调用", async () => {
  setRoomTurnStore(createRoomTurnStore());
  const chief = makeAgent("role-chief");
  setGlobalChief(chief.id);
  // 首席先生效 ⇒ 新建的公开频道自动把它加入（与 #248 同一路径）。
  const channel = createChannel({ name: unique("role-chief-room") });
  const alpha = makeAgent("role-chief-alpha", { join: channel.id });
  const runtime = makeFakeRuntime({
    [chief.id]: [{ text: replyText("我在，说说看") }],
    [alpha.id]: [{ text: replyText("不该我") }],
  });
  const stop = startAgentLoopDriver({ runtime });
  try {
    sendAsOwner(channel.id, "今天谁值班？");

    await waitFor(() => roundsOf(chief.id).length === 1);
    const [round] = roundsOf(chief.id);
    assert.equal(round.status, "replied");
    assert.equal(round.role, "chief", "首席接住的轮次读得出 chief");
    assert.equal(round.reason, "", "reason 原文照常（不被角色吞掉）");
    assert.equal(round.target_id, channel.id);

    assert.deepEqual(runtime.starts, [chief.id], "无点名消息只起一个会话，且是首席");
    assert.equal(
      runtime.sessions.get(chief.id).prompts.length,
      1,
      "一条无点名人类消息最多一次模型调用",
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(runtime.sessions.has(alpha.id), false, "其它成员不起会话");
    assert.equal(roundsOf(alpha.id).length, 0, "没有准入的轮次不落盘");
  } finally {
    stop();
    setRoomTurnStore(null);
    setGlobalChief(null);
  }
});

test("被人点名：轮次记录 role=human-mention，首席不额外起一轮", async () => {
  setRoomTurnStore(createRoomTurnStore());
  const chief = makeAgent("role-mention-chief");
  setGlobalChief(chief.id);
  const channel = createChannel({ name: unique("role-mention-room") });
  const alpha = makeAgent("role-mention-alpha", { join: channel.id });
  const runtime = makeFakeRuntime({
    [alpha.id]: [{ text: replyText("收到") }],
    [chief.id]: [{ text: replyText("不该我") }],
  });
  const stop = startAgentLoopDriver({ runtime });
  try {
    sendAsOwner(channel.id, `@${alpha.name} 你看下这个`);

    await waitFor(() => roundsOf(alpha.id).length === 1);
    const [round] = roundsOf(alpha.id);
    assert.equal(round.status, "replied");
    assert.equal(round.role, "human-mention", "被人点名的轮次读得出 human-mention");

    assert.deepEqual(runtime.starts, [alpha.id], "点名轮只有被点名者起会话");
    assert.equal(runtime.sessions.get(alpha.id).prompts.length, 1);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(runtime.sessions.has(chief.id), false, "首席不额外多一轮");
    assert.equal(roundsOf(chief.id).length, 0);
  } finally {
    stop();
    setRoomTurnStore(null);
    setGlobalChief(null);
  }
});

test("@all：每个被叫到的成员都记 role=all-mention，集合与次数不变", async () => {
  setRoomTurnStore(createRoomTurnStore());
  const chief = makeAgent("role-all-chief");
  setGlobalChief(chief.id);
  const channel = createChannel({ name: unique("role-all-room") });
  const alpha = makeAgent("role-all-alpha", { join: channel.id });
  const beta = makeAgent("role-all-beta", { join: channel.id });
  const runtime = makeFakeRuntime({
    [alpha.id]: [{ text: replyText("alpha 到") }],
    [beta.id]: [{ text: replyText("beta 到") }],
    [chief.id]: [{ text: replyText("chief 到") }],
  });
  const stop = startAgentLoopDriver({ runtime });
  const members = [alpha, beta, chief];
  try {
    sendAsOwner(channel.id, "@all 都在吗");

    await waitFor(() => members.every((agent) => roundsOf(agent.id).length === 1));
    for (const agent of members) {
      const [round] = roundsOf(agent.id);
      assert.equal(round.status, "replied", `${agent.name} 应回复`);
      assert.equal(round.role, "all-mention", `${agent.name} 的轮次读得出 all-mention`);
    }
    assert.deepEqual(
      [...runtime.starts].sort(),
      members.map((agent) => agent.id).sort(),
      "@all 起满频道 agent 成员，一个不少一个不多",
    );
    for (const agent of members) {
      assert.equal(runtime.sessions.get(agent.id).prompts.length, 1, "每人一次模型调用");
    }
    // 每条消息只落一条轮次记录：记角色不多出一行。
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(
      members.map((agent) => roundsOf(agent.id).length),
      [1, 1, 1],
    );
  } finally {
    stop();
    setRoomTurnStore(null);
    setGlobalChief(null);
  }
});
