import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/sqlite.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-driver-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createAgent, getAgent } = await import("../domain/collab/members.ts");
const { BusyCwdError } = await import("../agent-runtime.ts");
const { createChannel, joinChannel } = await import("../domain/collab/channels.ts");
const { sendMessage } = await import("../domain/collab/messages.ts");
const { scheduleReminder } = await import("../domain/collab/reminders.ts");
const {
  createAgentLoop,
  retryAgentBackfillTarget,
  roomMarker,
  tickReminderCron,
} = await import("./loop.ts");
const {
  startAgentLoopDriver,
  peekAgentLoopQueues,
  peekAgentLoopSettleWaiters,
  peekAgentLoopBackfillQuarantine,
} = await import("./loop.ts");
const { stopAgentStatusSweeper } = await import("../agent-status.ts");
const { emitWake } = await import("../domain/collab/wake.ts");
const { OWNER_MEMBER_ID } = await import("../data/schema.ts");

function sendAsOwner(targetId, content) {
  const result = sendMessage({ targetId, authorId: OWNER_MEMBER_ID, content });
  assert.equal(result.held, false);
  return result.message;
}

function makeFakeSession(replies = []) {
  const listeners = [];
  let running = false;
  return {
    replies,
    lastText: "",
    lastErrorDetail: null,
    prompts: [],
    isRunning: () => running,
    onEvent: (l) => {
      listeners.push(l);
      return () => {
        const i = listeners.indexOf(l);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    emit: (event) => {
      for (const l of [...listeners]) l(event);
    },
    async send(command) {
      if (command.type === "prompt") {
        this.prompts.push(command.message);
        const reply = this.replies.shift();
        running = true;
        queueMicrotask(() => {
          running = false;
          this.lastText = reply?.text ?? "";
          if (reply?.errorDetail) this.lastErrorDetail = reply.errorDetail;
          this.emit({ type: "prompt_done" });
          this.emit({ type: "agent_settled" });
        });
        return null;
      }
      if (command.type === "get_last_assistant_text") return { text: this.lastText };
      if (command.type === "get_last_assistant_error") {
        return this.lastErrorDetail ?? { stopReason: null, errorMessage: null };
      }
      return null;
    },
  };
}

function makeFakeRuntime(repliesByAgent = {}, prestarted = []) {
  const sessions = new Map();
  for (const memberId of prestarted) {
    sessions.set(memberId, makeFakeSession(repliesByAgent[memberId] ?? []));
  }
  return {
    sessions,
    findSession: (member) => sessions.get(member.id),
    async startSession(member) {
      if (!member.workspace_path) throw new Error("Agent has no workspace bound");
      const session = makeFakeSession(repliesByAgent[member.id] ?? []);
      sessions.set(member.id, session);
      return { sessionId: member.id, sessionFile: `/sessions/${member.id}.jsonl` };
    },
  };
}

function setupAgentAndChannel({ name, channelName = "driver-room" }) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-driver-ws-"));
  const agent = createAgent({ name, workspacePath: ws });
  const channel = createChannel({ name: channelName });
  joinChannel(channel.id, agent.id);
  return { agent, channel, ws };
}

test("a wake hint drives the round: the agent's reply lands in SQLite", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "driven" });
  sendAsOwner(channel.id, "drive me");
  const runtime = makeFakeRuntime({ [agent.id]: [{ text: '{"action":"reply","content":"on it"}' }] });
  const stop = startAgentLoopDriver({ runtime });
  try {
    emitWake({ agentId: agent.id, targetId: channel.id, seq: 1, reason: "message" });
    await waitFor(() => runtime.sessions.get(agent.id)?.prompts.length === 1);
    const messages = globalThis.__workspliceDb.listMessages(channel.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[1].content, "on it");
    assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 1);
    // §07：有结论的轮次落盘 round_logs（replied 行，可观测页可见）
    const rounds = globalThis.__workspliceDb.listRoundLogs(agent.id);
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0].status, "replied");
    assert.equal(rounds[0].target_id, channel.id);
    assert.equal(rounds[0].base_seq, 1);
  } finally {
    stop();
  }
});

test("an explicit ignore round is recorded as ignored (normal protocol choice)", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "ignorer" });
  sendAsOwner(channel.id, "not for you");
  const runtime = makeFakeRuntime({ [agent.id]: [{ text: '{"action":"ignore"}' }] });
  const stop = startAgentLoopDriver({ runtime });
  try {
    emitWake({ agentId: agent.id, targetId: channel.id, seq: 1, reason: "message" });
    await waitFor(() => runtime.sessions.get(agent.id)?.prompts.length === 1);
    const rounds = globalThis.__workspliceDb.listRoundLogs(agent.id);
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0].status, "ignored");
  } finally {
    stop();
  }
});

test("a model failure lands in round_logs with the real provider error as reason (D1)", async () => {
  // D1 端到端：模型/API 报错（如 new-api 429 FreeUsageLimitError）事件流不报错，
  // 真实原因只落在末条 assistant message 上——driver 写进 round_logs.reason，
  // 可观测面板因此能回答「agent 为什么失败」。
  const { agent, channel } = setupAgentAndChannel({ name: "rate-limited-logger" });
  sendAsOwner(channel.id, "please work");
  const providerError =
    '429: {"message":"Rate limit exceeded. Please try again later.","type":"FreeUsageLimitError","param":"","code":null}';
  const runtime = makeFakeRuntime({
    [agent.id]: [{ text: "", errorDetail: { stopReason: "error", errorMessage: providerError } }],
  });
  const stop = startAgentLoopDriver({ runtime });
  try {
    emitWake({ agentId: agent.id, targetId: channel.id, seq: 1, reason: "message" });
    await waitFor(() => globalThis.__workspliceDb.listRoundLogs(agent.id).length === 1);
    const rounds = globalThis.__workspliceDb.listRoundLogs(agent.id);
    assert.equal(rounds[0].status, "error");
    assert.match(rounds[0].reason, /^model error: 429: /, "round_logs.reason 带出真实模型错误");
    assert.ok(rounds[0].reason.includes(providerError), "完整错误文本不截断");
    assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0);
  } finally {
    stop();
  }
});

test("cap-ack is recorded as error with the (capped at 2) reason in round logs", async () => {
  // §07 决策：cap-ack「已放弃回复」在可观测页可见——reason 带 (capped) 标记，状态点保持 error。
  const { agent, channel } = setupAgentAndChannel({ name: "capped-logger" });
  sendAsOwner(channel.id, "hey @capped-logger respond now");
  const runtime = makeFakeRuntime({
    [agent.id]: [{ text: '{"action":"ignore"}' }, { text: '{"action":"ignore"}' }],
  });
  const stop = startAgentLoopDriver({ runtime });
  try {
    emitWake({ agentId: agent.id, targetId: channel.id, seq: 1, reason: "message" });
    await waitFor(() => runtime.sessions.get(agent.id)?.prompts.length === 1);
    // 游标未推进：消息保持 pending，第二次 wake 触发 cap-ack 轮；
    // 等第二轮的 round_log 落盘（发生在 ack 之后）再断言，避免轮次收口竞态
    emitWake({ agentId: agent.id, targetId: channel.id, seq: 2, reason: "message" });
    await waitFor(() => globalThis.__workspliceDb.listRoundLogs(agent.id).length === 2);
    const rounds = globalThis.__workspliceDb.listRoundLogs(agent.id);
    assert.equal(rounds.length, 2);
    assert.equal(rounds[0].status, "error");
    assert.match(rounds[0].reason, /capped at 2/);
    assert.equal(rounds[1].status, "error");
    assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 1, "cap-ack 游标推进");
  } finally {
    stop();
  }
});

test("two wakes for the same target coalesce into one round", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "coalesce" });
  sendAsOwner(channel.id, "one");
  const runtime = makeFakeRuntime({ [agent.id]: [{ text: '{"action":"reply","content":"once"}' }] });
  const stop = startAgentLoopDriver({ runtime });
  try {
    emitWake({ agentId: agent.id, targetId: channel.id, seq: 1, reason: "message" });
    emitWake({ agentId: agent.id, targetId: channel.id, seq: 1, reason: "message" });
    await waitFor(() => runtime.sessions.get(agent.id)?.prompts.length === 1);
    assert.equal(runtime.sessions.get(agent.id).prompts.length, 1);
  } finally {
    stop();
  }
});

test("wakes for two targets both get processed sequentially", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "two-room" });
  const second = createChannel({ name: "second-room" });
  joinChannel(second.id, agent.id);
  sendAsOwner(channel.id, "target one");
  sendAsOwner(second.id, "target two");
  const runtime = makeFakeRuntime({
    [agent.id]: [
      { text: '{"action":"reply","content":"reply one"}' },
      { text: '{"action":"reply","content":"reply two"}' },
    ],
  });
  const stop = startAgentLoopDriver({ runtime });
  try {
    emitWake({ agentId: agent.id, targetId: channel.id, seq: 1, reason: "message" });
    emitWake({ agentId: agent.id, targetId: second.id, seq: 1, reason: "message" });
    await waitFor(() => runtime.sessions.get(agent.id)?.prompts.length === 2);
    const session = runtime.sessions.get(agent.id);
    assert.equal(session.prompts.length, 2);
    assert.ok(session.prompts[0].includes("target one"));
    assert.ok(session.prompts[1].includes("target two"));
    const messages = globalThis.__workspliceDb.listMessages(second.id);
    assert.equal(messages[messages.length - 1].content, "reply two");
  } finally {
    stop();
  }
});

test("one agent never runs two rounds concurrently while another target is queued", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "serialized-targets" });
  const second = createChannel({ name: "serialized-second-target" });
  joinChannel(second.id, agent.id);
  sendAsOwner(channel.id, "first target input");
  sendAsOwner(second.id, "second target input");

  const session = makeFakeSession();
  let activePrompts = 0;
  let maxActivePrompts = 0;
  const releases = [];
  session.isRunning = () => activePrompts > 0;
  session.send = async function (command) {
    if (command.type === "prompt") {
      this.prompts.push(command.message);
      activePrompts += 1;
      maxActivePrompts = Math.max(maxActivePrompts, activePrompts);
      let released = false;
      releases.push(() => {
        if (released) return;
        released = true;
        activePrompts -= 1;
        this.lastText = '{"action":"ignore"}';
        this.emit({ type: "prompt_done" });
        this.emit({ type: "agent_settled" });
      });
      return null;
    }
    if (command.type === "get_last_assistant_text") return { text: this.lastText };
    if (command.type === "get_last_assistant_error") {
      return { stopReason: null, errorMessage: null };
    }
    return null;
  };
  const runtime = makeFakeRuntime();
  runtime.sessions.set(agent.id, session);
  const stop = startAgentLoopDriver({ runtime });

  try {
    emitWake({ agentId: agent.id, targetId: channel.id, seq: 1, reason: "message" });
    emitWake({ agentId: agent.id, targetId: second.id, seq: 1, reason: "message" });
    await waitFor(() => releases.length === 1);
    await waitFor(() =>
      peekAgentLoopQueues().some(
        (entry) =>
          entry.agentId === agent.id &&
          entry.entries.some((target) => target.targetId === second.id),
      ),
    );
    assert.equal(session.prompts.length, 1);
    assert.equal(maxActivePrompts, 1);

    releases[0]();
    await waitFor(() => releases.length === 2);
    assert.match(session.prompts[0], /first target input/);
    assert.match(session.prompts[1], /second target input/);
    assert.equal(maxActivePrompts, 1);
    releases[1]();
    await waitFor(() => globalThis.__workspliceDb.listRoundLogs(agent.id).length === 2);
  } finally {
    for (const release of releases) release();
    stop();
  }
});

test("a busy session retries the round after it settles", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "busyboy" });
  sendAsOwner(channel.id, "while busy");
  const runtime = makeFakeRuntime({ [agent.id]: [{ text: '{"action":"reply","content":"done now"}' }] }, [agent.id]);
  const session = runtime.sessions.get(agent.id);
  session.isRunning = () => true; // 先忙

  const stop = startAgentLoopDriver({ runtime });
  try {
    emitWake({ agentId: agent.id, targetId: channel.id, seq: 1, reason: "message" });
    await waitFor(() => session.prompts.length === 0);
    assert.equal(session.prompts.length, 0, "busy 时不应 prompt");

    // settle 事件触发重试
    session.isRunning = () => false;
    session.emit({ type: "agent_settled" });
    await waitFor(() => session.prompts.length === 1);
    await waitFor(() => globalThis.__workspliceDb.listMessages(channel.id).length === 2);
    const messages = globalThis.__workspliceDb.listMessages(channel.id);
    assert.equal(messages[messages.length - 1].content, "done now");
  } finally {
    stop();
  }
});

test("a busy session stuck on compaction retries on compaction_end", async () => {
  // 路径 d：isRunning() 含 isCompacting，但 manual/extension 触发的 compaction 只发
  // compaction_end（无 prompt_done/agent_settled）——busy 等待必须监听它才能解挂
  const { agent, channel } = setupAgentAndChannel({ name: "compacting" });
  sendAsOwner(channel.id, "compact while idle");
  const runtime = makeFakeRuntime(
    { [agent.id]: [{ text: '{"action":"reply","content":"after compact"}' }] },
    [agent.id],
  );
  const session = runtime.sessions.get(agent.id);
  session.isRunning = () => true; // isCompacting：忙但没有任何 prompt 在跑
  const stop = startAgentLoopDriver({ runtime });
  try {
    emitWake({ agentId: agent.id, targetId: channel.id, seq: 1, reason: "message" });
    await waitFor(() => session.prompts.length === 0);
    assert.equal(session.prompts.length, 0, "busy 时不应 prompt");

    // compaction 收口只发 compaction_end
    session.isRunning = () => false;
    session.emit({ type: "compaction_end" });
    await waitFor(() => session.prompts.length === 1);
    await waitFor(() => globalThis.__workspliceDb.listMessages(channel.id).length === 2);
    const messages = globalThis.__workspliceDb.listMessages(channel.id);
    assert.equal(messages[messages.length - 1].content, "after compact");
  } finally {
    stop();
  }
});

test("a session that settles before waitForSettle subscribes still gets retried", async () => {
  // 路径 d 的竞态窗口：runAgentRound 判 busy 与 waitForSettle 订阅之间会话已收口，
  // settle 事件发在无人监听时——订阅后复核 isRunning() 必须立即触发重试
  const { agent, channel } = setupAgentAndChannel({ name: "settle-race" });
  sendAsOwner(channel.id, "race me");
  const runtime = makeFakeRuntime(
    { [agent.id]: [{ text: '{"action":"reply","content":"raced"}' }] },
    [agent.id],
  );
  const session = runtime.sessions.get(agent.id);
  let busyCalls = 0;
  session.isRunning = () => ++busyCalls === 1; // 第 1 次（round 判定）忙，之后（订阅复核）空闲
  const stop = startAgentLoopDriver({ runtime });
  try {
    emitWake({ agentId: agent.id, targetId: channel.id, seq: 1, reason: "message" });
    // 不再有任何事件——订阅后复核 isRunning() 必须把 hint 放回队列重试（旧代码：永久挂起）
    await waitFor(() => session.prompts.length === 1);
    const messages = globalThis.__workspliceDb.listMessages(channel.id);
    assert.equal(messages[messages.length - 1].content, "raced");
    assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 1);
  } finally {
    stop();
  }
});

test("reminder demo chain: cron tick fires the system message and wakes the agent, who replies (§5.6/§3.9)", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "reminded" });
  // 人类在 UI 给 channel 设 every:1m 提醒，指定由 agent 负责（author = agent，§3.9 唤醒作者本人）
  const view = scheduleReminder({
    title: "check the build",
    fireAt: new Date(Date.now() - 5_000).toISOString(),
    recurrence: "every:1m",
    authorId: agent.id,
    targetId: channel.id,
  });
  const runtime = makeFakeRuntime({
    [agent.id]: [{ text: '{"action":"reply","content":"checking the build now","onConflict":"revise"}' }],
  });
  const stop = startAgentLoopDriver({ runtime });
  try {
    // cron 逐分钟扫描 → 到点触发：系统消息落库 + agent 定向唤醒（reason=reminder）
    assert.equal(tickReminderCron(), 1);
    await waitFor(() => runtime.sessions.get(agent.id)?.prompts.length === 1);
    const messages = globalThis.__workspliceDb.listMessages(channel.id);
    // [系统提醒消息（agent 署名）, agent 回复] 两条新消息
    assert.equal(messages.length, 2);
    assert.match(messages[0].content, /⏰ Reminder: check the build/);
    assert.equal(messages[0].author_id, agent.id);
    assert.equal(messages[1].content, "checking the build now");
    assert.equal(messages[1].author_id, agent.id);
    // 提醒驱动轮：prompt 里能看到系统提醒消息（"只有自己的消息"不跳过）
    assert.ok(runtime.sessions.get(agent.id).prompts[0].includes("⏰ Reminder: check the build"));
    // recurrence 续算：仍是 scheduled，fire_at 前移 1 分钟
    const row = globalThis.__workspliceDb.getReminderById(view.id);
    assert.equal(row.status, "scheduled");
    assert.equal(new Date(row.fire_at).getTime(), new Date(view.fire_at).getTime() + 60_000);
    // 未到下一次：重复 tick 幂等
    assert.equal(tickReminderCron(), 0);
  } finally {
    stop();
  }
});

test("a reminder hint upgrades a queued message wake for the same target (keep reminder, §3.9)", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "upgrade" });
  const second = createChannel({ name: "upgrade-second" });
  joinChannel(second.id, agent.id);
  // 目标 B 的 drain 里只有 agent 自己的消息（模拟系统提醒）——只有 reminder 轮才处理
  sendMessage({ targetId: second.id, authorId: agent.id, content: "⏰ Reminder: self" });
  const runtime = makeFakeRuntime(
    {
      // 两条 fixture 回复按 **prompt 到达顺序**消费（session.send 每次 shift 一条），
      // 所以它们的顺序必须与下方 assert 的轮次顺序对齐。
      // 顺序为何是「先 B 后 A」：本测试对 A 连发两条 hint（sendAsOwner 自带一条 +
      // 显式 emitWake 一条）。同 (agent,target) 合并后它们只剩一条 entry，busy 轮被
      // waitForSettle 挂起时队列里**没有** A 的条目；settle 后 retry 才把 A 重新入队，
      // 于是排在先到的 B 之后。修复前重复 hint 不合并、队列里残留一条 A，A 才排在前。
      // 这不是本票引入的排序退化：生产里 busy 轮出队后队列同样没有 A 的条目，
      // retry 一律排在已入队的 target 之后——只是修复前这条用例被重复 hint 掩盖了。
      [agent.id]: [
        { text: '{"action":"reply","content":"handled self reminder"}' },
        { text: '{"action":"reply","content":"done A"}' },
      ],
    },
    [agent.id],
  );
  const session = runtime.sessions.get(agent.id);
  session.isRunning = () => true; // 先忙
  const stop = startAgentLoopDriver({ runtime });
  try {
    sendAsOwner(channel.id, "round one");
    emitWake({ agentId: agent.id, targetId: channel.id, seq: 1, reason: "message" });
    await waitFor(() => session.prompts.length === 0);
    // agent 忙（waitForSettle 挂起）期间：B 的 message hint 入队
    emitWake({ agentId: agent.id, targetId: second.id, seq: 1, reason: "message" });
    await waitFor(() =>
      peekAgentLoopQueues().some(
        (q) =>
          q.agentId === agent.id &&
          q.entries.some((e) => e.targetId === second.id && e.reason === "message"),
      ),
    );
    // reminder hint 到达 → 同 target 合并升级为 reminder（不丢自提醒轮）
    emitWake({ agentId: agent.id, targetId: second.id, seq: 1, reason: "reminder" });
    await waitFor(() =>
      peekAgentLoopQueues().some(
        (q) =>
          q.agentId === agent.id &&
          q.entries.some((e) => e.targetId === second.id && e.reason === "reminder"),
      ),
    );
    // settle：先跑 B（reminder 轮，own-message drain 也处理），再跑 busy 轮重试的 A
    session.isRunning = () => false;
    session.emit({ type: "agent_settled" });
    await waitFor(() => session.prompts.length === 2);
    // 本用例的断言对象是「reminder 合并升级没被丢掉」，不是轮次先后；索引跟随实际
    // prompt 顺序（见上方 fixture 注释）。两条轮次都在，且 B 那轮确实按 reminder 处理。
    assert.match(session.prompts[0], /⏰ Reminder: self/, "B 以 reminder 轮处理（合并升级生效）");
    assert.match(session.prompts[1], /round one/, "busy 轮重试后 A 也被处理");
    const messages = globalThis.__workspliceDb.listMessages(second.id);
    assert.equal(messages[messages.length - 1].content, "handled self reminder");
    assert.equal(
      globalThis.__workspliceDb.listMessages(channel.id).at(-1).content,
      "done A",
      "A 的重试轮回复落回 A",
    );
  } finally {
    stop();
  }
});

test("createAgentLoop returns while backfill I/O is pending and releases queued wakes after scan", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "async-backfill-start" });
  sendAsOwner(channel.id, "wake during startup");
  const sessionFile = path.join(root, `${agent.id}.jsonl`);
  globalThis.__workspliceDb.setMemberPiSessionFile(agent.id, sessionFile);
  const header = JSON.stringify({
    type: "session",
    version: 3,
    id: "session",
    timestamp: "",
    cwd: agent.workspace_path,
  });
  let releaseRead;
  let readStarted = false;
  const readGate = new Promise((resolve) => {
    releaseRead = resolve;
  });
  const reminder = scheduleReminder({
    title: "startup cron",
    fireAt: new Date(Date.now() - 1_000).toISOString(),
    authorId: agent.id,
    targetId: channel.id,
  });
  const runtime = makeFakeRuntime({
    [agent.id]: [{ text: '{"action":"reply","content":"after recovery"}' }],
  });
  const loop = createAgentLoop({
    runtime,
    pollMs: 5,
    backfill: {
      fileOps: {
        stat: async (filePath) => {
          if (filePath === sessionFile) return { mtimeMs: Date.now() };
          return fs.promises.stat(filePath);
        },
        readFile: async (filePath) => {
          if (filePath !== sessionFile) return fs.promises.readFile(filePath, "utf8");
          readStarted = true;
          return readGate;
        },
      },
    },
  });

  try {
    loop.start();
    emitWake({ agentId: agent.id, targetId: channel.id, seq: 1, reason: "message" });
    await waitFor(() => readStarted);
    await waitFor(() =>
      globalThis.__workspliceDb.getReminderById(reminder.id)?.status === "fired",
    );
    assert.equal(runtime.sessions.get(agent.id)?.prompts.length ?? 0, 0);

    releaseRead(`${header}\n`);
    await waitFor(() => runtime.sessions.get(agent.id)?.prompts.length === 1);
    assert.match(runtime.sessions.get(agent.id).prompts[0], /wake during startup/);
    assert.ok(
      globalThis.__workspliceDb
        .listMessages(channel.id)
        .some((message) => message.content.includes("startup cron")),
      "reminder cron remains available while session-file I/O is pending",
    );
  } finally {
    releaseRead(`${header}\n`);
    loop.stop();
    stopAgentStatusSweeper();
  }
});

test("a quarantined backfill target does not block another target and can be retried explicitly", async () => {
  const { agent, channel: blocked } = setupAgentAndChannel({
    name: "backfill-quarantine",
  });
  const ready = createChannel({ name: "backfill-ready-target" });
  joinChannel(ready.id, agent.id);
  sendAsOwner(blocked.id, "blocked target input");
  sendAsOwner(ready.id, "ready target input");

  const sessionFile = path.join(root, `${agent.id}-recovery.jsonl`);
  const entries = [
    {
      type: "session",
      version: 3,
      id: "session",
      timestamp: "",
      cwd: agent.workspace_path,
    },
    {
      type: "message",
      message: { role: "user", content: roomMarker(blocked.id, 1) },
    },
    {
      type: "message",
      message: { role: "assistant", content: "recovered blocked reply" },
    },
  ];
  fs.writeFileSync(sessionFile, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  globalThis.__workspliceDb.setMemberPiSessionFile(agent.id, sessionFile);

  const db = globalThis.__workspliceDb;
  const insertMessageAt = db.insertMessageAt.bind(db);
  let failedWrites = 0;
  db.insertMessageAt = (input) => {
    if (input.content === "recovered blocked reply") {
      failedWrites += 1;
      throw Object.assign(new Error("temporary database write failure"), {
        code: "EIO",
      });
    }
    return insertMessageAt(input);
  };
  const runtime = makeFakeRuntime({
    [agent.id]: [{ text: '{"action":"reply","content":"ready target handled"}' }],
  });
  const loop = createAgentLoop({
    runtime,
    pollMs: 100_000,
    backfill: { retryDelayMs: 1 },
  });

  try {
    loop.start();
    emitWake({ agentId: agent.id, targetId: blocked.id, seq: 1, reason: "message" });
    emitWake({ agentId: agent.id, targetId: ready.id, seq: 1, reason: "message" });
    await waitFor(() =>
      peekAgentLoopBackfillQuarantine().some(
        (entry) => entry.agentId === agent.id && entry.targetId === blocked.id,
      ),
    );
    await waitFor(() => runtime.sessions.get(agent.id)?.prompts.length === 1);

    assert.ok(failedWrites >= 2, "有限次数的写入重试后隔离失败 target");
    assert.match(runtime.sessions.get(agent.id).prompts[0], /ready target input/);
    assert.doesNotMatch(runtime.sessions.get(agent.id).prompts[0], /blocked target input/);
    assert.equal(db.getConsumedSeq(agent.id, blocked.id), 0);
    assert.equal(db.getConsumedSeq(agent.id, ready.id), 1);
    assert.ok(
      peekAgentLoopQueues().some(
        (entry) =>
          entry.agentId === agent.id &&
          entry.entries.some((target) => target.targetId === blocked.id),
      ),
      "隔离 target 的 wake 仍保持 pending",
    );

    db.insertMessageAt = insertMessageAt;
    assert.equal(retryAgentBackfillTarget(agent.id, blocked.id), true);
    await waitFor(() => db.listMessages(blocked.id).some((message) =>
      message.content === "recovered blocked reply",
    ));
    assert.ok(db.getConsumedSeq(agent.id, blocked.id) >= 1);
  } finally {
    db.insertMessageAt = insertMessageAt;
    loop.stop();
    stopAgentStatusSweeper();
  }
});

test("transient scan failures keep queued keys pending until an explicit retry", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "retry-scan-error" });
  sendAsOwner(channel.id, "retry after permission is restored");
  const sessionFile = path.join(root, `${agent.id}-retry.jsonl`);
  const header = JSON.stringify({
    type: "session",
    version: 3,
    id: "session",
    timestamp: "",
    cwd: agent.workspace_path,
  });
  fs.writeFileSync(sessionFile, `${header}\n`);
  globalThis.__workspliceDb.setMemberPiSessionFile(agent.id, sessionFile);
  const denied = Object.assign(new Error("permission denied"), { code: "EACCES" });
  let statCalls = 0;
  const fileOps = {
    stat: async (filePath) => {
      if (filePath !== sessionFile) return fs.promises.stat(filePath);
      statCalls += 1;
      if (statCalls <= 3) throw denied;
      return fs.promises.stat(filePath);
    },
    readFile: async (filePath) => fs.promises.readFile(filePath, "utf8"),
  };
  const runtime = makeFakeRuntime({
    [agent.id]: [{ text: '{"action":"reply","content":"retried"}' }],
  });
  const loop = createAgentLoop({
    runtime,
    pollMs: 100_000,
    backfill: { fileOps, retryDelayMs: 1 },
  });

  try {
    loop.start();
    emitWake({ agentId: agent.id, targetId: channel.id, seq: 1, reason: "message" });
    await waitFor(() =>
      peekAgentLoopBackfillQuarantine().some(
        (entry) => entry.agentId === agent.id && entry.targetId === channel.id,
      ),
    );
    assert.equal(statCalls, 3);
    assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0);
    assert.equal(runtime.sessions.get(agent.id)?.prompts.length ?? 0, 0);
    assert.ok(
      peekAgentLoopQueues().some(
        (entry) =>
          entry.agentId === agent.id &&
          entry.entries.some((target) => target.targetId === channel.id),
      ),
    );

    assert.equal(retryAgentBackfillTarget(agent.id, channel.id), true);
    await waitFor(() => runtime.sessions.get(agent.id)?.prompts.length === 1);
    assert.match(runtime.sessions.get(agent.id).prompts[0], /retry after permission is restored/);
    assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 1);
  } finally {
    loop.stop();
    stopAgentStatusSweeper();
  }
});

test("stopping the loop cancels subsequent bounded backfill batches", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "cancel-loop-backfill" });
  sendAsOwner(channel.id, "leave recovery pending");
  const sessionFile = path.join(root, `${agent.id}-cancel.jsonl`);
  const entries = [
    {
      type: "session",
      version: 3,
      id: "session",
      timestamp: "",
      cwd: agent.workspace_path,
    },
    {
      type: "message",
      message: { role: "user", content: roomMarker(channel.id, 1) },
    },
    {
      type: "message",
      message: { role: "assistant", content: "must remain pending after stop" },
    },
  ];
  fs.writeFileSync(sessionFile, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  globalThis.__workspliceDb.setMemberPiSessionFile(agent.id, sessionFile);
  let loop;
  let yielded = 0;
  loop = createAgentLoop({
    runtime: makeFakeRuntime(),
    pollMs: 100_000,
    backfill: {
      batchLines: 1,
      fileOps: {
        stat: async (filePath) => fs.promises.stat(filePath),
        readFile: async (filePath) => fs.promises.readFile(filePath, "utf8"),
      },
      onBatchYield: (agentId) => {
        if (agentId !== agent.id) return;
        yielded += 1;
        if (yielded === 1) loop.stop();
      },
    },
  });

  try {
    loop.start();
    await waitFor(() => yielded === 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 1);
    assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0);
  } finally {
    loop.stop();
    stopAgentStatusSweeper();
  }
});

test("an old stopped scan cannot clear the wake barrier installed by a restarted loop", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "restart-backfill-barrier" });
  sendAsOwner(channel.id, "input before initial scan");
  const sessionFile = path.join(root, `${agent.id}-restart.jsonl`);
  const entries = [
    {
      type: "session",
      version: 3,
      id: "session",
      timestamp: "",
      cwd: agent.workspace_path,
    },
    {
      type: "message",
      message: { role: "user", content: roomMarker(channel.id, 1) },
    },
    {
      type: "message",
      message: { role: "assistant", content: "recovered before restarted wake" },
    },
  ];
  const sessionText = `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  fs.writeFileSync(sessionFile, sessionText);
  globalThis.__workspliceDb.setMemberPiSessionFile(agent.id, sessionFile);

  let oldReadStartedResolve;
  let newReadStartedResolve;
  const oldReadStarted = new Promise((resolve) => { oldReadStartedResolve = resolve; });
  const newReadStarted = new Promise((resolve) => { newReadStartedResolve = resolve; });
  let releaseOldRead;
  let releaseNewRead;
  const oldReadGate = new Promise((resolve) => { releaseOldRead = resolve; });
  const newReadGate = new Promise((resolve) => { releaseNewRead = resolve; });
  let targetReads = 0;
  const fileOps = {
    stat: async (filePath) => fs.promises.stat(filePath),
    readFile: async (filePath) => {
      if (filePath !== sessionFile) return fs.promises.readFile(filePath, "utf8");
      targetReads += 1;
      if (targetReads === 1) {
        oldReadStartedResolve();
        return oldReadGate;
      }
      if (targetReads === 2) {
        newReadStartedResolve();
        return newReadGate;
      }
      return fs.promises.readFile(filePath, "utf8");
    },
  };
  const runtime = makeFakeRuntime({
    [agent.id]: [{ text: '{"action":"reply","content":"replied too early"}' }],
  });
  const loop = createAgentLoop({
    runtime,
    pollMs: 100_000,
    backfill: { fileOps },
  });

  try {
    loop.start();
    await oldReadStarted;
    emitWake({ agentId: agent.id, targetId: channel.id, seq: 1, reason: "message" });

    loop.stop();
    loop.start();
    await newReadStarted;
    releaseOldRead(sessionText);
    await new Promise((resolve) => setTimeout(resolve, 20));

    sendAsOwner(channel.id, "input while restarted scan is pending");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(
      runtime.sessions.get(agent.id)?.prompts.length ?? 0,
      0,
      "the old aborted scan must not release the new scan's wake barrier",
    );

    releaseNewRead(sessionText);
    await waitFor(() => globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id) >= 3);
    assert.equal(
      globalThis.__workspliceDb
        .listMessages(channel.id)
        .filter((message) => message.content === "recovered before restarted wake").length,
      1,
    );
    assert.equal(runtime.sessions.get(agent.id)?.prompts.length ?? 0, 0);
  } finally {
    releaseOldRead(sessionText);
    releaseNewRead(sessionText);
    loop.stop();
    stopAgentStatusSweeper();
  }
});

test("stopAgentLoopDriver unsubscribes from wake hints", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "stoppable" });
  sendAsOwner(channel.id, "stop me");
  const runtime = makeFakeRuntime({ [agent.id]: [{ text: '{"action":"reply","content":"nope"}' }] });
  const stop = startAgentLoopDriver({ runtime });
  stop();
  emitWake({ agentId: agent.id, targetId: channel.id, seq: 1, reason: "message" });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(runtime.sessions.get(agent.id)?.prompts.length ?? 0, 0);
});

test("agents do not ping-pong on each other's greetings: one human message → one reply each", async () => {
  // 一条人类消息扇出后，各 agent 的 greeting 回复不得再互相触发新一轮
  // （rubric 本就要求 MUST ignore 小 talk；代码层对无信号的 agent 短 greeting 短路）
  const wsA = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-driver-ws-"));
  const wsB = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-driver-ws-"));
  const alpha = createAgent({ name: "ping", workspacePath: wsA });
  const beta = createAgent({ name: "pong", workspacePath: wsB });
  const channel = createChannel({ name: "greet-room" });
  joinChannel(channel.id, alpha.id);
  joinChannel(channel.id, beta.id);

  const runtime = makeFakeRuntime({
    // 每个 agent 备 2 条回复：并发 held 时 revise 重写需要第二次 prompt
    [alpha.id]: [
      { text: '{"action":"reply","content":"收到！我是 @ping，在的～","onConflict":"revise"}' },
      { text: '{"action":"reply","content":"收到！我是 @ping，在的～","onConflict":"resend"}' },
    ],
    [beta.id]: [
      { text: '{"action":"reply","content":"收到！我是 @pong，在的～","onConflict":"revise"}' },
      { text: '{"action":"reply","content":"收到！我是 @pong，在的～","onConflict":"resend"}' },
    ],
  });
  const stop = startAgentLoopDriver({ runtime });
  try {
    sendAsOwner(channel.id, "大家好啊，收到都请回复。");
    // 第一轮扇出：各回 1 条；留足窗口给可能的乒乓（bug 下会无限增长）
    await waitFor(() => (runtime.sessions.get(alpha.id)?.prompts.length ?? 0) >= 1, 3000);
    await waitFor(() => (runtime.sessions.get(beta.id)?.prompts.length ?? 0) >= 1, 3000);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const allMsgs = globalThis.__workspliceDb.listMessages(channel.id);
    const alphaMsgs = allMsgs.filter((m) => m.author_id === alpha.id);
    const betaMsgs = allMsgs.filter((m) => m.author_id === beta.id);
    assert.equal(alphaMsgs.length, 1, `ping 只应回 1 条，实际 ${alphaMsgs.length}`);
    assert.equal(betaMsgs.length, 1, `pong 只应回 1 条，实际 ${betaMsgs.length}`);
    // round 日志各只有 1 条 replied（无第二轮乒乓）；prompts 可能因并发 held 的
    // revise 重写而多 1 次（同一轮内的重写，不是新一轮），不做严格断言
    assert.equal(globalThis.__workspliceDb.listRoundLogs(alpha.id).length, 1);
    assert.equal(globalThis.__workspliceDb.listRoundLogs(beta.id).length, 1);
  } finally {
    stop();
  }
});

test("a shared-cwd BusyCwdError waits for the occupying session and retries without losing the hint", async () => {
  // 02-决策一：BusyCwdError 不再是 error 轮（丢弃）——等占用会话 settle 后重试，
  // hint 不丢、状态不变 error、触发消息保持 pending。
  const { agent, channel, ws } = setupAgentAndChannel({ name: "busy-cwd" });
  sendAsOwner(channel.id, "while the shared cwd is busy");
  // 占用会话：正在跑（isRunning=true），只在收口时发 agent_settled
  const occupying = makeFakeSession();
  occupying.isRunning = () => true;

  const runtime = makeFakeRuntime({ [agent.id]: [{ text: '{"action":"reply","content":"done now"}' }] });
  let startCalls = 0;
  runtime.startSession = async (member) => {
    startCalls += 1;
    if (startCalls === 1) throw new BusyCwdError(member.workspace_path);
    const session = makeFakeSession([{ text: '{"action":"reply","content":"done now"}' }]);
    runtime.sessions.set(member.id, session);
    return { sessionId: member.id, sessionFile: `/sessions/${member.id}.jsonl` };
  };
  runtime.findBusySessionForCwd = (cwd) => (cwd === ws ? occupying : undefined);

  const stop = startAgentLoopDriver({ runtime });
  try {
    emitWake({ agentId: agent.id, targetId: channel.id, seq: 1, reason: "message" });
    // 等 driver 进入 waitForSettle（订阅完成）再断言，避免轮次中间态竞态：
    // startCalls 在 startSession 抛错的瞬间即可观察，而订阅要等微任务链走完
    await waitFor(() => peekAgentLoopSettleWaiters().includes(agent.id), 3000);
    assert.equal(startCalls, 1, "第一次启动应抛 BusyCwdError");
    assert.equal(runtime.sessions.get(agent.id)?.prompts.length ?? 0, 0, "占用期间不应 prompt");
    assert.notEqual(getAgent(agent.id).status, "error", "busy-cwd 不落 error 状态");

    // 占用会话 settle → 重试 → 第二次 start 成功 → 轮次完成（hint 未丢）
    occupying.emit({ type: "agent_settled" });
    await waitFor(() => runtime.sessions.get(agent.id)?.prompts.length === 1, 3000);
    assert.equal(startCalls, 2, "BusyCwdError 后应重试启动");
  } finally {
    stop();
  }
});

test("busy-cwd without a visible wait target backs off before retrying (no hot spin)", async () => {
  // 终检整改（02）：人类/extension 路径的会话 starting 窗口内 wrapper 尚未入 registry——
  // findBusySessionForCwd 找不到等待对象时退避重试（BUSY_CWD_RETRY_DELAY_MS），
  // 而不是立即重试热自旋到对方启动完成。
  const { agent, channel } = setupAgentAndChannel({ name: "busy-cwd-backoff" });
  sendAsOwner(channel.id, "while the shared cwd is starting");

  const runtime = makeFakeRuntime();
  let startCalls = 0;
  runtime.startSession = async (member) => {
    startCalls += 1;
    throw new BusyCwdError(member.workspace_path);
  };
  runtime.findBusySessionForCwd = () => undefined;

  const stop = startAgentLoopDriver({ runtime });
  try {
    emitWake({ agentId: agent.id, targetId: channel.id, seq: 1, reason: "message" });
    // 第一次立即尝试；随后进入退避窗口——观察窗口内不得再试（有退避则 1 次，热自旋则数十次）
    await waitFor(() => startCalls === 1, 3000);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(startCalls, 1, "退避窗口内不重复尝试");
    // 退避到期后重试
    await waitFor(() => startCalls >= 2, 3000);
  } finally {
    stop();
  }
});

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
