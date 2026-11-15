import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/sqlite.ts";

/**
 * 全局首席接住无点名消息（票 #248）的驱动层黑盒。
 *
 * 接缝与 `selection-gating.test.mjs` 同一套：`runAgentRound` + 真实临时 SQLite + 协作域服务 +
 * 房间场次 store + fake runtime。每条用例同时证明「发生了什么」与「没有发生什么」——
 * 谁起了会话、谁回了、游标走到哪、开了几波。
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-chief-round-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const {
  ack,
  claimTask,
  createAgent,
  createChannel,
  createDirectChannel,
  createRoomTurnStore,
  createTask,
  deleteAgent,
  getRoomTurnStore,
  joinChannel,
  muteChannel,
  selectChiefRecipient,
  sendMessage,
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
    workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), `worksplice-chief-${prefix}-`)),
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

/** 依次跑每个 agent 的一轮，返回 [agent, outcome] 对。 */
async function runRounds(agents, targetId, runtime) {
  const outcomes = [];
  for (const agent of agents) {
    outcomes.push([agent, await runAgentRound(agent.id, targetId, runtime)]);
  }
  return outcomes;
}

test("a) 无点名人类频道消息：恰好一个会话，且是全局首席", async () => {
  const roomTurns = createRoomTurnStore();
  setRoomTurnStore(roomTurns);
  const chief = makeAgent("chief-plain");
  setGlobalChief(chief.id);
  // 首席先生效 ⇒ 新建的公开频道自动把它加入（与「秘书静默加入公开频道」同一路径）。
  const channel = createChannel({ name: unique("chief-plain-room") });
  const alpha = makeAgent("plain-alpha", { join: channel.id });
  const beta = makeAgent("plain-beta", { join: channel.id });
  const cursorsBefore = new Map(
    [alpha, beta].map((agent) => [agent.id, cursorOf(agent.id, channel.id)]),
  );
  const wakes = [];
  const unsubscribe = subscribeWake((hint) => wakes.push(hint));
  try {
    sendAsOwner(channel.id, "今天谁值班？");
    assert.deepEqual(
      wakes.map((hint) => hint.agentId),
      [chief.id],
      "无点名消息只叫生效首席一个",
    );

    const runtime = makeFakeRuntime({
      repliesByAgent: {
        [chief.id]: [{ text: replyText("我在，说说看") }],
        [alpha.id]: [{ text: replyText("不该我") }],
        [beta.id]: [{ text: replyText("也不该我") }],
      },
    });
    const outcomes = await runRounds([chief, alpha, beta], channel.id, runtime);
    const [[, chiefOutcome], [a, alphaOutcome], [b, betaOutcome]] = outcomes;

    assert.equal(chiefOutcome.status, "replied");
    assert.match(chiefOutcome.message.content, /我在/);
    assert.deepEqual(runtime.starts, [chief.id], "恰好一个会话，且是首席");
    assert.equal(
      runtime.sessions.get(chief.id).prompts.length,
      1,
      "一条无点名人类消息最多一次模型调用",
    );

    for (const [agent, outcome] of [
      [a, alphaOutcome],
      [b, betaOutcome],
    ]) {
      assert.equal(outcome.status, "skipped");
      assert.equal(runtime.sessions.has(agent.id), false, "其它成员不起会话");
      assert.equal(
        cursorOf(agent.id, channel.id),
        cursorsBefore.get(agent.id),
        "其它成员消费游标不推进",
      );
    }
  } finally {
    unsubscribe();
    setRoomTurnStore(null);
    setGlobalChief(null);
  }
});

test("b) 没有可用首席（未设置 / 已软删 / 不是频道成员）：零会话、零 prompt、游标不推进", async () => {
  const roomTurns = createRoomTurnStore();
  setRoomTurnStore(roomTurns);
  try {
    const alpha = makeAgent("nobody-alpha");
    const channel = createChannel({ name: unique("chief-nobody-room") });
    joinChannel(channel.id, alpha.id);
    const cursorBefore = cursorOf(alpha.id, channel.id);
    const runtime = makeFakeRuntime({
      repliesByAgent: { [alpha.id]: [{ text: replyText("不该我") }] },
    });

    // 未设置
    let wakes = [];
    let unsubscribe = subscribeWake((hint) => wakes.push(hint));
    sendAsOwner(channel.id, "有人在吗？");
    unsubscribe();
    assert.deepEqual(wakes, [], "没有首席就没有收件人");
    let [alphaOutcome] = (await runRounds([alpha], channel.id, runtime)).map(([, o]) => o);
    assert.equal(alphaOutcome.status, "skipped");
    assert.equal(alphaOutcome.reason, "no human mention and no attributable task");
    assert.equal(runtime.starts.length, 0, "零会话、零 prompt");
    assert.equal(cursorOf(alpha.id, channel.id), cursorBefore, "游标不推进");

    // 已软删
    const chief = makeAgent("nobody-chief");
    setGlobalChief(chief.id);
    deleteAgent(chief.id);
    wakes = [];
    unsubscribe = subscribeWake((hint) => wakes.push(hint));
    sendAsOwner(channel.id, "还是没人在吗？");
    unsubscribe();
    assert.deepEqual(wakes, [], "软删的首席不算首席");
    [alphaOutcome] = (await runRounds([alpha], channel.id, runtime)).map(([, o]) => o);
    assert.equal(alphaOutcome.status, "skipped");
    assert.equal(alphaOutcome.reason, "no human mention and no attributable task");
    assert.equal(runtime.starts.length, 0);

    // 不是该频道成员（私有频道：首席没被加入）
    const outsider = makeAgent("nobody-outsider");
    setGlobalChief(outsider.id);
    const room = createChannel({
      name: unique("chief-outsider-room"),
      type: "private",
      memberIds: [alpha.id],
    });
    wakes = [];
    unsubscribe = subscribeWake((hint) => wakes.push(hint));
    sendAsOwner(room.id, "这个房间有人吗？");
    unsubscribe();
    assert.deepEqual(wakes, [], "不是频道成员 ⇒ 不是可用首席，且不换人");
    const outsiderRuntime = makeFakeRuntime();
    const outsiderOutcome = await runAgentRound(outsider.id, room.id, outsiderRuntime);
    assert.equal(outsiderOutcome.status, "skipped");
    assert.equal(
      outsiderOutcome.reason,
      "not a member of the channel",
      "成员关系优先级一字不动",
    );
    assert.equal(outsiderRuntime.starts.length, 0);
    assert.equal(runtime.starts.length, 0);

    // 被静音：静音优先于首席——首席不被唤醒，其余成员照旧「无邀请」。
    joinChannel(channel.id, outsider.id);
    setGlobalChief(outsider.id);
    muteChannel(channel.id, outsider.id);
    wakes = [];
    unsubscribe = subscribeWake((hint) => wakes.push(hint));
    sendAsOwner(channel.id, "静音之后还有人吗？");
    unsubscribe();
    assert.deepEqual(wakes, [], "被静音的首席不被唤醒，且不换人");
    [alphaOutcome] = (await runRounds([alpha], channel.id, runtime)).map(([, o]) => o);
    assert.equal(alphaOutcome.status, "skipped");
    assert.equal(alphaOutcome.reason, "no human mention and no attributable task");
    assert.equal(runtime.starts.length, 0);
  } finally {
    setRoomTurnStore(null);
    setGlobalChief(null);
  }
});

test("e) 静音的首席不被唤醒，也不被准入", async () => {
  const roomTurns = createRoomTurnStore();
  setRoomTurnStore(roomTurns);
  const chief = makeAgent("muted-chief");
  setGlobalChief(chief.id);
  const channel = createChannel({ name: unique("chief-muted-room") });
  makeAgent("muted-alpha", { join: channel.id });
  muteChannel(channel.id, chief.id);
  // 建频道的事件消息（Owner 署名、@首席）先按既有语义消费掉，本轮只看静音之后的普通消息。
  ack(chief.id, channel.id, globalThis.__workspliceDb.maxSeq(channel.id));
  const wakes = [];
  const unsubscribe = subscribeWake((hint) => wakes.push(hint));
  try {
    sendAsOwner(channel.id, "有人吗？");
    assert.deepEqual(wakes, [], "静音优先于首席：首席不被唤醒，且不换人");

    const runtime = makeFakeRuntime({
      repliesByAgent: { [chief.id]: [{ text: replyText("不该我") }] },
    });
    const chiefOutcome = await runAgentRound(chief.id, channel.id, runtime);
    assert.equal(chiefOutcome.status, "noop", "静音的消息连看都不看");
    assert.equal(runtime.starts.length, 0, "静音的首席不起会话");
    assert.equal(wakes.length, 0);
  } finally {
    unsubscribe();
    setRoomTurnStore(null);
    setGlobalChief(null);
  }
});

test("c) 点名与 @all 保持原集合，首席不额外多一轮", async () => {
  const roomTurns = createRoomTurnStore();
  setRoomTurnStore(roomTurns);
  const chief = makeAgent("mention-chief");
  setGlobalChief(chief.id);
  const channel = createChannel({ name: unique("chief-mention-room") });
  const alpha = makeAgent("mention-alpha", { join: channel.id });
  const beta = makeAgent("mention-beta", { join: channel.id });
  let wakes = [];
  const unsubscribe = subscribeWake((hint) => wakes.push(hint));
  try {
    const runtime = makeFakeRuntime({
      repliesByAgent: {
        [alpha.id]: [{ text: replyText("alpha 被点名") }, { text: replyText("alpha 收到 all") }],
        [beta.id]: [{ text: replyText("beta 收到 all") }],
        [chief.id]: [{ text: replyText("chief 收到 all") }],
      },
    });

    // 个人点名：只有被点名者被叫起，首席不额外追加。
    sendAsOwner(channel.id, `@${alpha.name} 你来说`);
    assert.deepEqual(wakes.map((hint) => hint.agentId), [alpha.id]);
    const mentionOutcomes = await runRounds([alpha, chief, beta], channel.id, runtime);
    assert.equal(mentionOutcomes[0][1].status, "replied");
    assert.equal(mentionOutcomes[1][1].status, "skipped");
    assert.equal(mentionOutcomes[2][1].status, "skipped");
    assert.deepEqual(runtime.starts, [alpha.id], "点名轮只有被点名者起会话");

    // @all：频道 agent 成员全叫，一个不少一个不多。
    wakes = [];
    sendAsOwner(channel.id, "@all 都在吗");
    assert.deepEqual(
      wakes.map((hint) => hint.agentId).sort(),
      [alpha.id, beta.id, chief.id].sort(),
    );
    const allOutcomes = await runRounds([alpha, beta, chief], channel.id, runtime);
    assert.deepEqual(
      allOutcomes.map(([, outcome]) => outcome.status),
      ["replied", "replied", "replied"],
    );
    const snapshot = roomTurns.snapshot(channel.id);
    assert.equal(
      snapshot.turn.askLog.filter((ask) => ask.member === chief.id).length,
      1,
      "@all 只把首席叫一次，不额外多一轮",
    );

    // 首席已回复之后再跑一轮：既有「已回复最新消息」收口，不再花一次模型调用。
    const extra = makeFakeRuntime();
    const extraOutcome = await runAgentRound(chief.id, channel.id, extra);
    assert.equal(extraOutcome.status, "skipped");
    assert.equal(extra.starts.length, 0);
  } finally {
    unsubscribe();
    setRoomTurnStore(null);
    setGlobalChief(null);
  }
});

test("d) DM 不经过首席；任务线程裁决不变；任务创建事件仍由全局首席分流一次", async () => {
  const roomTurns = createRoomTurnStore();
  setRoomTurnStore(roomTurns);
  const chief = makeAgent("regress-chief");
  setGlobalChief(chief.id);
  const channel = createChannel({ name: unique("chief-regress-room") });
  const alpha = makeAgent("regress-alpha", { join: channel.id });
  const beta = makeAgent("regress-beta", { join: channel.id });
  let wakes = [];
  let unsubscribe = subscribeWake((hint) => wakes.push(hint));
  try {
    // 首席的 handoff 回复在任务建好之后才追加（回复里的任务号必须指向那个任务）。
    const chiefReplies = [];
    const runtime = makeFakeRuntime({
      repliesByAgent: {
        [alpha.id]: [{ text: replyText("alpha 进展") }, { text: replyText("alpha 收到任务") }],
        [chief.id]: chiefReplies,
      },
    });

    // DM：行为不变——对方 agent 收到，首席不参与。
    const dm = createDirectChannel(alpha.id);
    wakes = [];
    sendAsOwner(dm.id, "私信内容");
    assert.deepEqual(wakes.map((hint) => hint.agentId), [alpha.id]);
    assert.equal((await runAgentRound(alpha.id, dm.id, runtime)).status, "replied");
    assert.equal(runtime.starts.includes(chief.id), false, "DM 不经过首席");

    // 任务线程：裁决仍按任务状态；首席不参与任务裁决。
    const anchor = sendAsOwner(channel.id, `@${alpha.name} 请做这个任务`);
    const task = createTask({ messageId: anchor.id });
    assert.equal(
      claimTask({ channelId: channel.id, taskNumber: task.number, memberId: alpha.id }).status,
      "claimed",
    );
    sendAsOwner(anchor.id, "进展如何？");
    const chiefCursor = cursorOf(chief.id, anchor.id);
    const chiefInTaskThread = await runAgentRound(chief.id, anchor.id, runtime);
    assert.equal(chiefInTaskThread.status, "skipped");
    assert.equal(
      chiefInTaskThread.reason,
      "task in progress — only its owner may continue",
    );
    assert.equal(cursorOf(chief.id, anchor.id), chiefCursor, "游标不推进");

    // 任务创建事件：仍只定向唤醒全局首席一次，并仍由它做 handoff。
    const secondAnchor = sendAsOwner(
      channel.id,
      `@${beta.name} 另一件事：写发布说明`,
    );
    wakes = [];
    const secondTask = createTask({ messageId: secondAnchor.id });
    assert.deepEqual(
      wakes.map((hint) => hint.agentId),
      [chief.id],
      "任务创建事件只叫全局首席一次",
    );
    chiefReplies.push({
      text: `{"action":"ignore","task":{"number":${secondTask.number},"op":"handoff","assignee":"@${alpha.name}"}}`,
    });
    const handoff = await runAgentRound(chief.id, channel.id, runtime);
    assert.equal(handoff.status, "replied");
    assert.equal(handoff.message.target_id, secondAnchor.id, "handoff 仍落在任务线程");
    const row = globalThis.__workspliceDb.getTaskById(secondTask.id);
    assert.equal(row.status, "in_progress");
    assert.equal(row.owner_id, alpha.id);
    assert.equal(row.handoff_state, "handed_off");
    assert.notEqual(row.owner_id, chief.id);
  } finally {
    unsubscribe();
    setRoomTurnStore(null);
    setGlobalChief(null);
  }
});

test("g) 唯一 `Task #N` 引用的消息按 handoff 准入，不被首席收件人分支抢走", async () => {
  const roomTurns = createRoomTurnStore();
  setRoomTurnStore(roomTurns);
  const chief = makeAgent("handoff-ref-chief");
  setGlobalChief(chief.id);
  const channel = createChannel({ name: unique("chief-handoff-ref-room") });
  const alpha = makeAgent("handoff-ref-alpha", { join: channel.id });
  const beta = makeAgent("handoff-ref-beta", { join: channel.id });
  try {
    const anchor = sendAsOwner(channel.id, "把发布说明写一下");
    const task = createTask({ messageId: anchor.id });
    // 创建事件那条先按既有语义消费掉：本轮只看「唯一 Task #N 引用」这条人类消息。
    ack(chief.id, channel.id, globalThis.__workspliceDb.maxSeq(channel.id));

    const reference = sendAsOwner(channel.id, `Task #${task.number} 你处理下`);
    assert.equal(
      selectChiefRecipient({ channel, targetId: reference.target_id, content: reference.content }),
      null,
      "前置条件：涉及任务的消息在选人层就不归任何首席（#250 收窄）",
    );

    // 房间门此刻只选了 beta（刷屏 / 新场次竞争的形态）：handoff 轮不得被门拦下。
    roomTurns.beginTurn({
      channelId: channel.id,
      triggerSeq: reference.seq,
      text: `@${beta.name} 先说别的`,
      authorId: OWNER_MEMBER_ID,
      candidates: [beta.id],
    });
    assert.equal(
      roomTurns.gate({ channelId: channel.id, memberId: chief.id }).state,
      "not-elected",
      "前置条件：房间门此刻没有选首席",
    );

    const runtime = makeFakeRuntime({
      repliesByAgent: {
        [chief.id]: [
          {
            text: `{"action":"ignore","task":{"number":${task.number},"op":"handoff","assignee":"@${alpha.name}"}}`,
          },
        ],
      },
    });
    const outcome = await runAgentRound(chief.id, channel.id, runtime);

    assert.equal(outcome.status, "replied", "handoff 轮照旧准入（不经房间门）");
    assert.equal(outcome.message.target_id, anchor.id, "通知落在任务线程");
    const row = globalThis.__workspliceDb.getTaskById(task.id);
    assert.equal(row.handoff_state, "handed_off");
    assert.equal(row.status, "in_progress");
    assert.equal(row.owner_id, alpha.id);
    assert.deepEqual(runtime.starts, [chief.id], "只起一个会话");
    assert.equal(runtime.sessions.get(chief.id).prompts.length, 1, "不多一轮");
  } finally {
    setRoomTurnStore(null);
    setGlobalChief(null);
  }
});

test("f) 首席的连续回复受既有轮次预算收口：到顶后不再开新波", async () => {
  // 预算改小（唯一入口 = createRoomTurnStore 的注入上限）：首席一次发言就用满。
  const roomTurns = createRoomTurnStore({ limits: { MAX_REPLIES: 1 } });
  setRoomTurnStore(roomTurns);
  const chief = makeAgent("budget-chief");
  setGlobalChief(chief.id);
  const channel = createChannel({ name: unique("chief-budget-room") });
  const alpha = makeAgent("budget-alpha", { join: channel.id });
  try {
    const runtime = makeFakeRuntime({
      repliesByAgent: {
        [chief.id]: [{ text: replyText("我先接一下") }, { text: replyText("不该有第二次") }],
      },
    });
    sendAsOwner(channel.id, "今天谁值班？");
    assert.equal((await runAgentRound(chief.id, channel.id, runtime)).status, "replied");

    const snapshot = roomTurns.snapshot(channel.id);
    assert.equal(snapshot.turn.endedReason, "reply_budget");
    assert.equal(snapshot.turn.askLog.length, 1, "到顶后不再开新波");

    // 之后的普通成员消息也不给它开补充波。
    sendMessage({ targetId: channel.id, authorId: alpha.id, content: "我补充一句" });
    const after = roomTurns.snapshot(channel.id);
    assert.equal(after.turn.askLog.length, 1, "补充波不得因首席身份开启");
    assert.equal(getRoomTurnStore().gate({ channelId: channel.id, memberId: chief.id }).state, "no-turn");
  } finally {
    setRoomTurnStore(null);
    setGlobalChief(null);
  }
});

test("f-2) Stop 之后首席不靠「补一轮」回来：在飞回复照常落库但 stale，不开新波", async () => {
  const roomTurns = createRoomTurnStore();
  setRoomTurnStore(roomTurns);
  const chief = makeAgent("stop-chief");
  setGlobalChief(chief.id);
  const channel = createChannel({ name: unique("chief-stop-room") });
  makeAgent("stop-alpha", { join: channel.id });
  try {
    sendAsOwner(channel.id, "今天谁值班？");

    // 在飞的首席轮：prompt 已发出，回复还没出来。
    const listeners = [];
    let running = false;
    let lastText = "";
    let resolvePrompted;
    const prompted = new Promise((resolve) => {
      resolvePrompted = resolve;
    });
    const session = {
      prompts: [],
      prompted,
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
      sessions: new Map([[chief.id, session]]),
      destroyCalls: 0,
      findSession: (member) => (member.id === chief.id ? session : undefined),
      async startSession() {
        throw new Error("test should reuse the prestarted session");
      },
      async destroySession() {
        this.destroyCalls += 1;
      },
    };

    const round = runAgentRound(chief.id, channel.id, runtime);
    // 红/绿都不得死等：round 若先结束（首席没被准入）这里立刻拿到 "settled"。
    const entered = await Promise.race([session.prompted.then(() => "prompted"), round]);
    assert.equal(entered, "prompted", "首席必须在 Stop 之前进入本轮的 prompt");
    const askLogBefore = roomTurns.snapshot(channel.id).turn.askLog.length;
    assert.equal(stopChannelTurn(channel.id, OWNER_MEMBER_ID).stopped, true);

    session.release(replyText("Stop 之后才落库"));
    const outcome = await round;
    assert.equal(outcome.status, "replied");
    assert.match(outcome.message.content, /Stop 之后才落库/);

    const snapshot = roomTurns.snapshot(channel.id);
    assert.equal(snapshot.turn.endedReason, "stopped");
    assert.equal(snapshot.turn.stale, true);
    assert.equal(snapshot.turn.askLog.length, askLogBefore, "Stop 之后不得补开新波");
    assert.equal(runtime.destroyCalls, 0, "Stop 不销毁会话");
  } finally {
    setRoomTurnStore(null);
    setGlobalChief(null);
  }
});
