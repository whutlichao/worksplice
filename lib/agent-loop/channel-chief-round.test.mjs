import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/sqlite.ts";

/**
 * 频道首席接住无点名消息（票 #250）的驱动层黑盒。
 *
 * 接缝与 `chief-round.test.mjs` 同一套：`runAgentRound` + 真实临时 SQLite + 协作域服务 +
 * 房间场次 store + fake session/runtime。每条用例同时证明「发生了什么」与「没有发生什么」——
 * 谁起了会话、谁回了、游标走到哪、开了几波。**fake session 必须在 prompt 后 emit 完成事件**
 * （round 会等 `waitForPromptCompletion`）。
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-channel-chief-round-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const {
  ack,
  createAgent,
  createChannel,
  createRoomTurnStore,
  createTask,
  getRoomTurnStore,
  joinChannel,
  muteChannel,
  sendMessage,
  setChannelChief,
  setGlobalChief,
  setRoomTurnStore,
  stopChannelTurn,
  subscribeWake,
} = await import("../domain/collab/index.ts");
const { runAgentRound } = await import("./loop.ts");
const { OWNER_MEMBER_ID } = await import("../data/schema.ts");

let fixtureSeq = 0;
function unique(prefix) {
  fixtureSeq += 1;
  return `${prefix}-${fixtureSeq}`;
}

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
        this.emit({ type: "agent_start" });
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
    workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), `worksplice-cc-${prefix}-`)),
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

function cursorOf(agentId, targetId) {
  return globalThis.__workspliceDb.getConsumedSeq(agentId, targetId);
}

async function runRounds(agents, targetId, runtime) {
  const outcomes = [];
  for (const agent of agents) {
    outcomes.push([agent, await runAgentRound(agent.id, targetId, runtime)]);
  }
  return outcomes;
}

function collectWakes() {
  const wakes = [];
  const unsubscribe = subscribeWake((hint) => wakes.push(hint));
  return { wakes, unsubscribe };
}

test("a) 频道首席接住无点名消息：恰好一个会话且是它，其它成员零会话零游标", async () => {
  setRoomTurnStore(createRoomTurnStore());
  const globalChief = makeAgent("cc-global");
  setGlobalChief(globalChief.id);
  try {
    const channel = createChannel({ name: unique("cc-room") });
    const channelChief = makeAgent("cc-local", { join: channel.id });
    const other = makeAgent("cc-other", { join: channel.id });
    setChannelChief(channel.id, channelChief.id);
    const cursorsBefore = new Map(
      [other, globalChief].map((agent) => [agent.id, cursorOf(agent.id, channel.id)]),
    );

    const { wakes, unsubscribe } = collectWakes();
    sendAsOwner(channel.id, "今天谁值班？");
    unsubscribe();
    assert.deepEqual(
      wakes.map((hint) => hint.agentId),
      [channelChief.id],
      "无点名消息只叫这个频道的首席（不是全局首席）",
    );

    const runtime = makeFakeRuntime({
      repliesByAgent: {
        [channelChief.id]: [{ text: replyText("我是这个频道的首席") }],
        [other.id]: [{ text: replyText("不该我") }],
        [globalChief.id]: [{ text: replyText("也不该我") }],
      },
    });
    const outcomes = await runRounds([channelChief, other, globalChief], channel.id, runtime);
    assert.equal(outcomes[0][1].status, "replied");
    assert.match(outcomes[0][1].message.content, /首席/);
    assert.deepEqual(runtime.starts, [channelChief.id], "恰好一个会话，且是频道首席");
    assert.equal(runtime.sessions.get(channelChief.id).prompts.length, 1, "最多一次模型调用");

    for (const [agent, outcome] of outcomes.slice(1)) {
      assert.equal(outcome.status, "skipped");
      assert.equal(runtime.sessions.has(agent.id), false, "其它成员不起会话");
      assert.equal(
        cursorOf(agent.id, channel.id),
        cursorsBefore.get(agent.id),
        "其它成员消费游标不推进",
      );
    }
  } finally {
    setGlobalChief(null);
    setRoomTurnStore(null);
  }
});

test("b) 频道之间互不影响：另一频道没有首席时仍回落全局首席", async () => {
  setRoomTurnStore(createRoomTurnStore());
  const globalChief = makeAgent("cc2-global");
  setGlobalChief(globalChief.id);
  try {
    const roomA = createChannel({ name: unique("cc2-room-a") });
    const chiefA = makeAgent("cc2-chief-a", { join: roomA.id });
    setChannelChief(roomA.id, chiefA.id);
    const roomB = createChannel({ name: unique("cc2-room-b") });
    const memberB = makeAgent("cc2-member-b", { join: roomB.id });

    const runtime = makeFakeRuntime({
      repliesByAgent: {
        [chiefA.id]: [{ text: replyText("A 的首席") }],
        [globalChief.id]: [{ text: replyText("全局首席接 B") }],
      },
    });

    const { wakes: wakesA, unsubscribe: stopA } = collectWakes();
    sendAsOwner(roomA.id, "A 房间有人吗");
    stopA();
    assert.deepEqual(wakesA.map((hint) => hint.agentId), [chiefA.id]);

    const { wakes: wakesB, unsubscribe: stopB } = collectWakes();
    sendAsOwner(roomB.id, "B 房间有人吗");
    stopB();
    assert.deepEqual(
      wakesB.map((hint) => hint.agentId),
      [globalChief.id],
      "未指定首席的频道照旧回落全局首席",
    );

    assert.equal((await runAgentRound(chiefA.id, roomA.id, runtime)).status, "replied");
    assert.equal((await runAgentRound(memberB.id, roomB.id, runtime)).status, "skipped");
    assert.equal((await runAgentRound(globalChief.id, roomB.id, runtime)).status, "replied");
    assert.deepEqual(runtime.starts, [chiefA.id, globalChief.id]);
  } finally {
    setGlobalChief(null);
    setRoomTurnStore(null);
  }
});

test("c) 清空频道首席后回落全局；两者都没有时静默（零会话零游标）", async () => {
  setRoomTurnStore(createRoomTurnStore());
  const globalChief = makeAgent("cc3-global");
  setGlobalChief(globalChief.id);
  try {
    const channel = createChannel({ name: unique("cc3-room") });
    const channelChief = makeAgent("cc3-local", { join: channel.id });
    const other = makeAgent("cc3-other", { join: channel.id });
    setChannelChief(channel.id, channelChief.id);

    const runtime = makeFakeRuntime({
      repliesByAgent: {
        [channelChief.id]: [{ text: replyText("清空之前是我") }],
        [globalChief.id]: [{ text: replyText("清空之后是我") }],
      },
    });
    sendAsOwner(channel.id, "第一句");
    assert.equal((await runAgentRound(channelChief.id, channel.id, runtime)).status, "replied");
    assert.deepEqual(runtime.starts, [channelChief.id]);

    setChannelChief(channel.id, null);
    const { wakes, unsubscribe } = collectWakes();
    sendAsOwner(channel.id, "第二句");
    unsubscribe();
    assert.deepEqual(
      wakes.map((hint) => hint.agentId),
      [globalChief.id],
      "清空频道首席 ⇒ 回落全局首席",
    );
    assert.equal((await runAgentRound(channelChief.id, channel.id, runtime)).status, "skipped");
    assert.equal((await runAgentRound(globalChief.id, channel.id, runtime)).status, "replied");
    assert.deepEqual(runtime.starts, [channelChief.id, globalChief.id]);

    // 两个档位都空：静默——零会话、零游标推进。
    setGlobalChief(null);
    const cursorBefore = cursorOf(other.id, channel.id);
    const { wakes: noWakes, unsubscribe: stopNoWakes } = collectWakes();
    sendAsOwner(channel.id, "第三句");
    stopNoWakes();
    assert.deepEqual(noWakes, [], "没有可用首席就没有收件人");
    const silentRuntime = makeFakeRuntime();
    const [outcome] = (await runRounds([other], channel.id, silentRuntime)).map(([, o]) => o);
    assert.equal(outcome.status, "skipped");
    assert.equal(outcome.reason, "no human mention and no attributable task");
    assert.equal(silentRuntime.starts.length, 0, "零会话、零模型调用");
    assert.equal(cursorOf(other.id, channel.id), cursorBefore, "游标不推进");
  } finally {
    setGlobalChief(null);
    setRoomTurnStore(null);
  }
});

test("d) 私有频道只叫该频道首席，不把频道之外的 agent 拉进来", async () => {
  setRoomTurnStore(createRoomTurnStore());
  const outsiderChief = makeAgent("cc4-outsider");
  setGlobalChief(outsiderChief.id);
  try {
    const privateChief = makeAgent("cc4-insider");
    const privateRoom = createChannel({
      name: unique("cc4-private"),
      type: "private",
      memberIds: [privateChief.id],
    });
    setChannelChief(privateRoom.id, privateChief.id);
    // 全局首席不在这个私有频道里：清空频道首席后不得把他拉进来。
    assert.equal(
      globalThis.__workspliceDb.isChannelMember(privateRoom.id, outsiderChief.id),
      false,
    );

    const runtime = makeFakeRuntime({
      repliesByAgent: { [privateChief.id]: [{ text: replyText("只在本频道") }] },
    });
    const { wakes, unsubscribe } = collectWakes();
    sendAsOwner(privateRoom.id, "私有房间里有人吗");
    unsubscribe();
    assert.deepEqual(wakes.map((hint) => hint.agentId), [privateChief.id]);
    assert.equal((await runAgentRound(privateChief.id, privateRoom.id, runtime)).status, "replied");
    assert.deepEqual(runtime.starts, [privateChief.id], "只起频道内首席一个会话");

    setChannelChief(privateRoom.id, null);
    const { wakes: fallbackWakes, unsubscribe: stopFallback } = collectWakes();
    sendAsOwner(privateRoom.id, "清空之后呢");
    stopFallback();
    assert.deepEqual(fallbackWakes, [], "回落目标不是本频道成员 ⇒ 没有可用首席");
    const outsiderRuntime = makeFakeRuntime();
    const outsiderOutcome = await runAgentRound(
      outsiderChief.id,
      privateRoom.id,
      outsiderRuntime,
    );
    assert.equal(outsiderOutcome.status, "skipped");
    assert.equal(outsiderOutcome.reason, "not a member of the channel");
    assert.equal(outsiderRuntime.starts.length, 0);
  } finally {
    setGlobalChief(null);
    setRoomTurnStore(null);
  }
});

test("e) 静音优先于频道首席：静音的首席不被唤醒、也不被准入", async () => {
  setRoomTurnStore(createRoomTurnStore());
  const globalChief = makeAgent("cc5-global");
  setGlobalChief(globalChief.id);
  try {
    const channel = createChannel({ name: unique("cc5-room") });
    const channelChief = makeAgent("cc5-local", { join: channel.id });
    setChannelChief(channel.id, channelChief.id);
    muteChannel(channel.id, channelChief.id);
    ack(channelChief.id, channel.id, globalThis.__workspliceDb.maxSeq(channel.id));

    const { wakes, unsubscribe } = collectWakes();
    sendAsOwner(channel.id, "有人在吗");
    unsubscribe();
    assert.deepEqual(wakes, [], "静音优先于首席：不唤醒、也不换人");

    const runtime = makeFakeRuntime({
      repliesByAgent: { [channelChief.id]: [{ text: replyText("不该我") }] },
    });
    const outcome = await runAgentRound(channelChief.id, channel.id, runtime);
    assert.equal(outcome.status, "noop");
    assert.equal(runtime.starts.length, 0);
  } finally {
    setGlobalChief(null);
    setRoomTurnStore(null);
  }
});

test("f) 房间门 / 轮次预算 / Stop 对频道首席一视同仁", async () => {
  // 房间门：本场次没选它 ⇒ 频道首席也不能进场（role=chief 同样走房间门）。
  const gateStore = createRoomTurnStore();
  setRoomTurnStore(gateStore);
  const globalChief = makeAgent("cc6-global");
  setGlobalChief(globalChief.id);
  try {
    const channel = createChannel({ name: unique("cc6-room") });
    const channelChief = makeAgent("cc6-local", { join: channel.id });
    const rival = makeAgent("cc6-rival", { join: channel.id });
    setChannelChief(channel.id, channelChief.id);
    const message = sendAsOwner(channel.id, "今天谁值班？");
    gateStore.beginTurn({
      channelId: channel.id,
      triggerSeq: message.seq,
      text: `@${rival.name} 你先说`,
      authorId: OWNER_MEMBER_ID,
      candidates: [rival.id],
    });
    const gatedRuntime = makeFakeRuntime({
      repliesByAgent: { [channelChief.id]: [{ text: replyText("不该我") }] },
    });
    const gated = await runAgentRound(channelChief.id, channel.id, gatedRuntime);
    assert.equal(gated.status, "skipped");
    assert.equal(gated.reason, "not elected by room turn");
    assert.equal(gatedRuntime.starts.length, 0, "没当选 ⇒ 零会话");
  } finally {
    setGlobalChief(null);
    setRoomTurnStore(null);
  }

  // 轮次预算：频道首席一次发言就用满（唯一入口 = 注入的 limits）。
  const budgetStore = createRoomTurnStore({ limits: { MAX_REPLIES: 1 } });
  setRoomTurnStore(budgetStore);
  const budgetChief = makeAgent("cc6-budget-local");
  try {
    const room = createChannel({ name: unique("cc6-budget-room") });
    joinChannel(room.id, budgetChief.id);
    setChannelChief(room.id, budgetChief.id);
    const runtime = makeFakeRuntime({
      repliesByAgent: {
        [budgetChief.id]: [{ text: replyText("我先接") }, { text: replyText("不该有第二次") }],
      },
    });
    sendAsOwner(room.id, "今天谁值班？");
    assert.equal((await runAgentRound(budgetChief.id, room.id, runtime)).status, "replied");
    assert.equal(budgetStore.snapshot(room.id).turn.endedReason, "reply_budget");
    assert.equal(budgetStore.snapshot(room.id).turn.askLog.length, 1, "到顶后不开新波");
    assert.equal(
      getRoomTurnStore().gate({ channelId: room.id, memberId: budgetChief.id }).state,
      "no-turn",
    );
  } finally {
    setRoomTurnStore(null);
  }

  // Stop：在飞的频道首席轮照常落库，但不靠「补一轮」绕过停止。
  const stopStore = createRoomTurnStore();
  setRoomTurnStore(stopStore);
  const stopChief = makeAgent("cc6-stop-local");
  try {
    const room = createChannel({ name: unique("cc6-stop-room") });
    joinChannel(room.id, stopChief.id);
    setChannelChief(room.id, stopChief.id);
    sendAsOwner(room.id, "今天谁值班？");

    const listeners = [];
    let running = false;
    let lastText = "";
    let resolvePrompted;
    const prompted = new Promise((resolve) => {
      resolvePrompted = resolve;
    });
    const session = {
      prompts: [],
      isRunning: () => running,
      onEvent(listener) {
        listeners.push(listener);
        return () => {};
      },
      emit(event) {
        for (const listener of [...listeners]) listener(event);
      },
      async send(command) {
        if (command.type === "prompt") {
          this.prompts.push(command.message);
          running = true;
          this.emit({ type: "agent_start" });
          resolvePrompted();
          return null;
        }
        if (command.type === "get_last_assistant_text") return { text: lastText };
        if (command.type === "get_last_assistant_error") {
          return { stopReason: null, errorMessage: null };
        }
        return null;
      },
      release(text) {
        lastText = text;
        running = false;
        this.emit({ type: "prompt_done" });
        this.emit({ type: "agent_end" });
      },
    };
    const runtime = {
      sessions: new Map([[stopChief.id, session]]),
      findSession: (member) => (member.id === stopChief.id ? session : undefined),
      async startSession() {
        throw new Error("test should reuse the prestarted session");
      },
    };

    const round = runAgentRound(stopChief.id, room.id, runtime);
    const entered = await Promise.race([prompted.then(() => "prompted"), round]);
    assert.equal(entered, "prompted", "频道首席必须先进到本轮 prompt");
    const askLogBefore = stopStore.snapshot(room.id).turn.askLog.length;
    assert.equal(stopChannelTurn(room.id, OWNER_MEMBER_ID).stopped, true);
    session.release(replyText("Stop 之后才落库"));
    const outcome = await round;
    assert.equal(outcome.status, "replied");
    const snapshot = stopStore.snapshot(room.id);
    assert.equal(snapshot.turn.endedReason, "stopped");
    assert.equal(snapshot.turn.askLog.length, askLogBefore, "Stop 之后不得补开新波");
  } finally {
    setRoomTurnStore(null);
  }
});

test("g) 唯一 `Task #N` 引用：只有全局首席做 handoff，频道首席零会话", async () => {
  setRoomTurnStore(createRoomTurnStore());
  const globalChief = makeAgent("cc7-global");
  setGlobalChief(globalChief.id);
  try {
    const channel = createChannel({ name: unique("cc7-room") });
    const channelChief = makeAgent("cc7-local", { join: channel.id });
    const assignee = makeAgent("cc7-assignee", { join: channel.id });
    setChannelChief(channel.id, channelChief.id);

    const anchor = sendAsOwner(channel.id, "把发布说明写一下");
    const task = createTask({ messageId: anchor.id });
    // 创建事件先按既有语义消费掉：本轮只看「唯一 Task #N 引用」这条人类消息。
    ack(globalChief.id, channel.id, globalThis.__workspliceDb.maxSeq(channel.id));
    ack(channelChief.id, channel.id, globalThis.__workspliceDb.maxSeq(channel.id));

    const { wakes, unsubscribe } = collectWakes();
    sendAsOwner(channel.id, `Task #${task.number} 你处理下`);
    unsubscribe();
    assert.deepEqual(
      wakes.map((hint) => hint.agentId),
      [globalChief.id],
      "任务相关的人类消息只叫全局首席（频道首席不被叫）",
    );

    const runtime = makeFakeRuntime({
      repliesByAgent: {
        [channelChief.id]: [{ text: replyText("不该我接") }],
        [globalChief.id]: [
          {
            text: `{"action":"ignore","task":{"number":${task.number},"op":"handoff","assignee":"@${assignee.name}"}}`,
          },
        ],
      },
    });

    const chiefOutcome = await runAgentRound(channelChief.id, channel.id, runtime);
    assert.equal(chiefOutcome.status, "skipped", "频道首席不得抢走任务 handoff 轮");
    assert.equal(chiefOutcome.reason, "no human mention and no attributable task");
    assert.equal(runtime.starts.length, 0, "频道首席零会话");

    const handoffOutcome = await runAgentRound(globalChief.id, channel.id, runtime);
    assert.equal(handoffOutcome.status, "replied");
    assert.equal(handoffOutcome.message.target_id, anchor.id, "通知落在任务线程");
    const row = globalThis.__workspliceDb.getTaskById(task.id);
    assert.equal(row.handoff_state, "handed_off");
    assert.equal(row.owner_id, assignee.id);
    assert.deepEqual(runtime.starts, [globalChief.id], "全程只有一个会话：全局首席");
  } finally {
    setGlobalChief(null);
    setRoomTurnStore(null);
  }
});
