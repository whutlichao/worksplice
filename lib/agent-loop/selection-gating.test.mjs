import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/sqlite.ts";

/**
 * 模型调用前选人（Ticket #237）的 black-box 回归。
 *
 * 接缝只有 runAgentRound + 真实临时 SQLite + 协作域服务 + 房间场次 store + fake runtime。
 * 每条用例同时证明「发生了什么」与「没有发生什么」：未准入时不得 startSession、不得 prompt、
 * 不得推进消费游标。
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-selection-gating-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const {
  claimTask,
  createAgent,
  createChannel,
  createRoomTurnStore,
  createTask,
  getAgent,
  joinChannel,
  leaveChannel,
  listRoundLogs,
  logRoundOutcome,
  sendMessage,
  setRoomTurnStore,
  subscribeWake,
  updateTaskStatus,
} = await import("../domain/collab/index.ts");
const { runAgentRound } = await import("./loop.ts");
const { OWNER_MEMBER_ID } = await import("../data/schema.ts");

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

function makeAgent(name, { join = null } = {}) {
  const agent = createAgent({
    name,
    workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), `worksplice-selection-${name}-`)),
  });
  if (join) join.push(agent);
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

test("① 人类无点名且无可归属任务：跳过、无会话、无 prompt、游标不动", async () => {
  const roomTurns = createRoomTurnStore();
  setRoomTurnStore(roomTurns);
  const db = globalThis.__workspliceDb;
  try {
    const alpha = makeAgent("select-alpha-1");
    const beta = makeAgent("select-beta-1");
    const channel = createChannel({ name: "selection-1" });
    joinChannel(channel.id, alpha.id);
    joinChannel(channel.id, beta.id);

    // 第一条点名 alpha：场次 1。
    sendAsOwner(channel.id, `@${alpha.name} 你先看一下`);
    const firstEpoch = roomTurns.snapshot(channel.id).turn.epoch;

    // 第二条不点名：仍推进 epoch、取代旧场次，但候选为空、不选人。
    sendAsOwner(channel.id, "这条只是我自己记一下，不需要谁回答");
    const snapshot = roomTurns.snapshot(channel.id);
    assert.equal(snapshot.turn.epoch, firstEpoch + 1);
    assert.deepEqual([...snapshot.turn.elected], []);
    assert.equal(snapshot.turn.askedAt.size, 0, "空候选不进入超时等待");
    assert.ok(
      snapshot.turns.some((turn) => turn.epoch === firstEpoch && turn.endedReason === "superseded"),
      "旧场次应被取代",
    );
    roomTurns.pump(channel.id);
    assert.equal(
      roomTurns.snapshot(channel.id).turn.endedReason,
      "no_speakers",
      "空候选让场次自然收口，而不是等超时",
    );

    const cursorBefore = db.getConsumedSeq(beta.id, channel.id);
    const runtime = makeFakeRuntime({
      repliesByAgent: { [beta.id]: [{ text: replyText("不该我说") }] },
    });
    const outcome = await runAgentRound(beta.id, channel.id, runtime);

    assert.equal(outcome.status, "skipped");
    assert.equal(outcome.reason, "no human mention and no attributable task");
    assert.equal(runtime.starts.length, 0, "不得 startSession");
    assert.equal(runtime.sessions.size, 0, "不得创建会话");
    assert.equal(db.getConsumedSeq(beta.id, channel.id), cursorBefore, "消费游标不得推进");
  } finally {
    setRoomTurnStore(null);
  }
});

test("①-b 选人 skip：稳定 reason、不写 error、不伪造 round_logs", async () => {
  const roomTurns = createRoomTurnStore();
  setRoomTurnStore(roomTurns);
  try {
    const alpha = makeAgent("select-skip-log-alpha");
    const beta = makeAgent("select-skip-log-beta");
    const channel = createChannel({ name: "selection-skip-log" });
    joinChannel(channel.id, alpha.id);
    joinChannel(channel.id, beta.id);
    sendAsOwner(channel.id, `@${alpha.name} 只叫你`);

    const runtime = makeFakeRuntime({
      repliesByAgent: { [beta.id]: [{ text: replyText("不该我说") }] },
    });
    const outcome = await runAgentRound(beta.id, channel.id, runtime);

    assert.equal(outcome.status, "skipped");
    assert.equal(
      outcome.reason,
      "not elected by room turn",
      "skip reason 是稳定契约",
    );
    assert.equal(runtime.starts.length, 0, "skip 不得起会话");
    assert.notEqual(getAgent(beta.id).status, "error", "skip 不是失败");
    assert.equal(
      logRoundOutcome(beta.id, channel.id, outcome),
      null,
      "skip 不是有结论轮次，不得落 round_logs",
    );
    assert.deepEqual(listRoundLogs(beta.id), [], "不得伪造任何 round_logs 行");
  } finally {
    setRoomTurnStore(null);
  }
});

test("② 人类正文点名只准入被点名者；@all 全成员；引用 / 代码块不算；未加入者只被人正文点名穿透", async () => {
  const roomTurns = createRoomTurnStore();
  setRoomTurnStore(roomTurns);
  const db = globalThis.__workspliceDb;
  try {
    const alpha = makeAgent("select-alpha-2");
    const beta = makeAgent("select-beta-2");
    const gamma = makeAgent("select-gamma-2");
    const channel = createChannel({ name: "selection-2" });
    joinChannel(channel.id, alpha.id);
    joinChannel(channel.id, beta.id);
    assert.equal(db.isChannelMember(channel.id, gamma.id), false);

    const runtime = makeFakeRuntime({
      repliesByAgent: {
        [alpha.id]: [
          { text: replyText("alpha 被点名") },
          { text: replyText("alpha 收到 all") },
        ],
        [beta.id]: [{ text: replyText("beta 收到 all") }],
        [gamma.id]: [{ text: replyText("gamma 被点名后加入") }],
      },
    });

    // 个人点名：只准入 alpha。
    sendAsOwner(channel.id, `@${alpha.name} 只叫你`);
    assert.equal((await runAgentRound(alpha.id, channel.id, runtime)).status, "replied");
    const betaCursor = db.getConsumedSeq(beta.id, channel.id);
    const betaSkipped = await runAgentRound(beta.id, channel.id, runtime);
    assert.equal(betaSkipped.status, "skipped");
    assert.equal(betaSkipped.reason, "no human mention and no attributable task");
    assert.equal(runtime.sessions.has(beta.id), false);
    assert.equal(db.getConsumedSeq(beta.id, channel.id), betaCursor);

    // @all：全 agent 成员都准入。
    sendAsOwner(channel.id, "@all 大家都来");
    assert.equal((await runAgentRound(beta.id, channel.id, runtime)).status, "replied");
    assert.equal((await runAgentRound(alpha.id, channel.id, runtime)).status, "replied");

    // 引用块 / 代码块 / 行内代码里的 @ 都不是邀请。
    sendAsOwner(
      channel.id,
      `> @${alpha.name} 旧引用\n\n\`\`\`\n@${alpha.name}\n\`\`\`\n\n行内 \`@${alpha.name}\` 只是示例`,
    );
    const quoted = await runAgentRound(alpha.id, channel.id, runtime);
    assert.equal(quoted.status, "skipped");
    assert.equal(quoted.reason, "no human mention and no attributable task");

    // 未加入者：只被人类正文点名时穿透；回复落库后自行加入公开频道。
    sendAsOwner(channel.id, `@${gamma.name} 你也来`);
    const penetrated = await runAgentRound(gamma.id, channel.id, runtime);
    assert.equal(penetrated.status, "replied");
    assert.equal(db.isChannelMember(channel.id, gamma.id), true);
    assert.equal(
      db.listMessages(channel.id).at(-1).content,
      "gamma 被点名后加入",
    );
  } finally {
    setRoomTurnStore(null);
  }
});

test("③ 普通 agent 正文 @ 不新增候选、不穿透、不产生第二波；已当选未结算成员仍可完成本轮", async () => {
  const roomTurns = createRoomTurnStore();
  setRoomTurnStore(roomTurns);
  const wakes = [];
  const unsubscribe = subscribeWake((hint) => wakes.push(hint));
  try {
    const alpha = makeAgent("select-alpha-3");
    const beta = makeAgent("select-beta-3");
    const gamma = makeAgent("select-gamma-3");
    const channel = createChannel({ name: "selection-3" });
    joinChannel(channel.id, alpha.id);
    joinChannel(channel.id, beta.id);

    const runtime = makeFakeRuntime({
      repliesByAgent: {
        [alpha.id]: [{ text: replyText(`@${beta.name} @${gamma.name} 你们看`) }],
        [beta.id]: [{ text: replyText("beta 被 all 叫来") }],
      },
    });

    // 第一波只点名 alpha。
    sendAsOwner(channel.id, `@${alpha.name} 你先说`);
    const askLogBefore = roomTurns.snapshot(channel.id).turn.askLog.length;
    assert.equal((await runAgentRound(alpha.id, channel.id, runtime)).status, "replied");

    // alpha 的正文 @ 两个成员：场次候选不变，也不穿透唤醒未加入的 gamma。
    const afterAgentReply = roomTurns.snapshot(channel.id);
    assert.equal(
      afterAgentReply.turn.askLog.length,
      askLogBefore,
      "agent 正文 @ 不新增候选",
    );
    assert.equal(
      wakes.some((hint) => hint.agentId === gamma.id),
      false,
      "agent 正文 @ 不穿透",
    );

    // beta 在这一场尚未被点名：agent 的 @ 不能把它拉起来。
    const betaSkipped = await runAgentRound(beta.id, channel.id, runtime);
    assert.equal(betaSkipped.status, "skipped");
    assert.equal(betaSkipped.reason, "no human mention and no attributable task");
    assert.equal(runtime.sessions.has(beta.id), false);

    // 未加入的 gamma 同样不会被 agent 正文 @ 拉进来。
    const gammaSkipped = await runAgentRound(gamma.id, channel.id, runtime);
    assert.equal(gammaSkipped.status, "skipped");
    assert.equal(gammaSkipped.reason, "not a member of the channel");
    assert.equal(runtime.sessions.has(gamma.id), false);

    // 已当选未结算成员（人类 @all 选进来的 beta）仍可完成本轮。
    sendAsOwner(channel.id, "@all 大家补充一下");
    const betaOutcome = await runAgentRound(beta.id, channel.id, runtime);
    assert.equal(betaOutcome.status, "replied");
    assert.match(betaOutcome.message.content, /beta 被 all 叫来/);
  } finally {
    unsubscribe();
    setRoomTurnStore(null);
  }
});

test("④ 任务线程按 owner / in_review / done / closed / reopened 裁决", async () => {
  const roomTurns = createRoomTurnStore();
  setRoomTurnStore(roomTurns);
  const db = globalThis.__workspliceDb;
  try {
    const alpha = makeAgent("select-alpha-4");
    const beta = makeAgent("select-beta-4");
    const channel = createChannel({ name: "selection-4" });
    joinChannel(channel.id, alpha.id);
    joinChannel(channel.id, beta.id);

    const anchor = sendAsOwner(channel.id, `@${alpha.name} 请做这个任务`);
    const task = createTask({ messageId: anchor.id });
    assert.equal(
      claimTask({ channelId: channel.id, taskNumber: task.number, memberId: alpha.id }).status,
      "claimed",
    );
    const threadId = anchor.id;
    const runtime = makeFakeRuntime({
      repliesByAgent: {
        [alpha.id]: [
          { text: replyText("alpha 继续进度") },
          { text: replyText("alpha 处理评审意见") },
        ],
        [beta.id]: [
          { text: replyText("beta 被人类点名评审") },
          { text: replyText("beta 收尾确认") },
        ],
      },
    });

    // in_progress：只有 owner 准入（人类正文点名也不放开非 owner）。
    sendAsOwner(threadId, "进展如何？");
    assert.equal((await runAgentRound(alpha.id, threadId, runtime)).status, "replied");
    const betaCursor = db.getConsumedSeq(beta.id, threadId);
    const betaInProgress = await runAgentRound(beta.id, threadId, runtime);
    assert.equal(betaInProgress.status, "skipped");
    assert.equal(betaInProgress.reason, "task in progress — only its owner may continue");
    assert.equal(db.getConsumedSeq(beta.id, threadId), betaCursor);

    sendAsOwner(threadId, `@${beta.name} 你看一眼`);
    const betaMentionedInProgress = await runAgentRound(beta.id, threadId, runtime);
    assert.equal(betaMentionedInProgress.status, "skipped");
    assert.equal(
      betaMentionedInProgress.reason,
      "task in progress — only its owner may continue",
    );

    // in_review：owner 可继续；reviewer 不被自动叫，只认人类正文点名。
    assert.equal(
      updateTaskStatus({
        channelId: channel.id,
        taskNumber: task.number,
        status: "in_review",
        memberId: alpha.id,
      }).status,
      "updated",
    );
    sendAsOwner(threadId, "评审阶段，先不要自动叫人");
    assert.equal((await runAgentRound(alpha.id, threadId, runtime)).status, "replied");
    const betaReview = await runAgentRound(beta.id, threadId, runtime);
    assert.equal(betaReview.status, "skipped");
    assert.equal(
      betaReview.reason,
      "task in review — reviewers require a human mention",
    );

    sendAsOwner(threadId, `@${beta.name} 请你评审`);
    const betaInvitedReview = await runAgentRound(beta.id, threadId, runtime);
    assert.equal(betaInvitedReview.status, "replied");
    assert.match(betaInvitedReview.message.content, /beta 被人类点名评审/);

    // done：不自动准入；人类点名仍可叫到。
    assert.equal(
      updateTaskStatus({
        channelId: channel.id,
        taskNumber: task.number,
        status: "done",
        memberId: OWNER_MEMBER_ID,
      }).status,
      "updated",
    );
    sendAsOwner(threadId, "已完成，无人被自动叫起");
    const alphaDone = await runAgentRound(alpha.id, threadId, runtime);
    assert.equal(alphaDone.status, "skipped");
    assert.equal(alphaDone.reason, "task is done or closed — no automatic round");
    const betaDone = await runAgentRound(beta.id, threadId, runtime);
    assert.equal(betaDone.status, "skipped");
    assert.equal(betaDone.reason, "task is done or closed — no automatic round");

    sendAsOwner(threadId, `@${beta.name} 收尾确认一下`);
    assert.equal((await runAgentRound(beta.id, threadId, runtime)).status, "replied");

    // reopened：agent 一律不得接管；人类认领接管后才清标。
    assert.equal(
      updateTaskStatus({
        channelId: channel.id,
        taskNumber: task.number,
        status: "todo",
        memberId: OWNER_MEMBER_ID,
      }).status,
      "updated",
    );
    assert.equal(db.getTaskById(task.id).reopened, 1);
    sendAsOwner(threadId, `@${beta.name} 重新看一下`);
    const reopenedAlpha = await runAgentRound(alpha.id, threadId, runtime);
    assert.equal(reopenedAlpha.status, "skipped");
    assert.equal(reopenedAlpha.reason, "task was reopened — awaiting the human owner");
    const reopenedBeta = await runAgentRound(beta.id, threadId, runtime);
    assert.equal(reopenedBeta.status, "skipped");
    assert.equal(reopenedBeta.reason, "task was reopened — awaiting the human owner");

    const humanClaim = claimTask({
      channelId: channel.id,
      taskNumber: task.number,
      memberId: OWNER_MEMBER_ID,
    });
    assert.equal(humanClaim.status, "claimed");
    assert.equal(db.getTaskById(task.id).reopened, 0);
  } finally {
    setRoomTurnStore(null);
  }
});

test("④-b 任务 owner 退群后旧 wake hint 不起会话；人类正文点名仍可穿透", async () => {
  const roomTurns = createRoomTurnStore();
  setRoomTurnStore(roomTurns);
  const db = globalThis.__workspliceDb;
  try {
    const alpha = makeAgent("select-alpha-4b");
    const channel = createChannel({ name: "selection-4b" });
    joinChannel(channel.id, alpha.id);
    const anchor = sendAsOwner(channel.id, `@${alpha.name} 请做这个任务`);
    const task = createTask({ messageId: anchor.id });
    assert.equal(
      claimTask({
        channelId: channel.id,
        taskNumber: task.number,
        memberId: alpha.id,
      }).status,
      "claimed",
    );
    leaveChannel(channel.id, alpha.id, alpha.id);

    // 旧 wake hint 对应的线程消息没有人类点名：owner 身份不能绕过成员关系。
    sendAsOwner(anchor.id, "这条只是进度上下文，没有点名");
    const runtime = makeFakeRuntime({
      repliesByAgent: {
        [alpha.id]: [{ text: replyText("退群后不应被旧 hint 拉起") }],
      },
    });
    const cursorBefore = db.getConsumedSeq(alpha.id, anchor.id);
    const staleHint = await runAgentRound(alpha.id, anchor.id, runtime);
    assert.equal(staleHint.status, "skipped");
    assert.equal(staleHint.reason, "not a member of the channel");
    assert.equal(runtime.starts.length, 0, "不得 startSession");
    assert.equal(db.getConsumedSeq(alpha.id, anchor.id), cursorBefore);

    // 未加入者的唯一穿透口仍保留：本轮最新人类正文显式点名。
    sendAsOwner(anchor.id, `@${alpha.name} 请回来处理这个任务`);
    const invited = await runAgentRound(alpha.id, anchor.id, runtime);
    assert.equal(invited.status, "replied");
    assert.deepEqual(runtime.starts, [alpha.id]);
  } finally {
    setRoomTurnStore(null);
  }
});

test("⑤ 任务线程不走 channel 房间门；reminder / owner 续工轮保留 bypass", async () => {
  const roomTurns = createRoomTurnStore();
  setRoomTurnStore(roomTurns);
  try {
    const alpha = makeAgent("select-alpha-5");
    const beta = makeAgent("select-beta-5");
    const channel = createChannel({ name: "selection-5" });
    joinChannel(channel.id, alpha.id);
    joinChannel(channel.id, beta.id);

    const anchor = sendAsOwner(channel.id, `@${beta.name} 做这个任务`);
    const task = createTask({ messageId: anchor.id });
    assert.equal(
      claimTask({ channelId: channel.id, taskNumber: task.number, memberId: beta.id }).status,
      "claimed",
    );
    sendAsOwner(anchor.id, "继续做，不用再点名");

    // 人为把 channel 场次改成只选 alpha：任务线程若仍走房间门，beta 会被拦。
    roomTurns.reset(channel.id);
    roomTurns.beginTurn({
      channelId: channel.id,
      triggerSeq: 1,
      text: `@${alpha.name} 只在频道里说`,
      authorId: OWNER_MEMBER_ID,
      candidates: [alpha.id],
    });
    assert.equal(
      roomTurns.gate({ channelId: channel.id, memberId: beta.id }).state,
      "not-elected",
    );

    const runtime = makeFakeRuntime({
      repliesByAgent: {
        [beta.id]: [
          { text: replyText("任务 owner 继续") },
          { text: replyText("reminder 自己处理") },
          { text: replyText("owner 续工") },
        ],
      },
    });

    const taskRound = await runAgentRound(beta.id, anchor.id, runtime);
    assert.equal(taskRound.status, "replied", "任务线程不得被 channel 房间门拦下");

    // reminder 轮次：只有自己的提醒消息、无人类点名，也保留 bypass。
    sendMessage({
      targetId: channel.id,
      authorId: beta.id,
      content: "⏰ Reminder: check the build",
    });
    const reminderRound = await runAgentRound(beta.id, channel.id, runtime, "reminder");
    assert.equal(reminderRound.status, "replied");

    // owner 续工轮：线程里只有自己的进度消息，任务仍 in_progress，保留 bypass。
    sendMessage({
      targetId: anchor.id,
      authorId: beta.id,
      content: "进度：第一步已完成",
    });
    const continuation = await runAgentRound(beta.id, anchor.id, runtime);
    assert.equal(continuation.status, "replied");
    assert.match(continuation.message.content, /owner 续工/);
  } finally {
    setRoomTurnStore(null);
  }
});
