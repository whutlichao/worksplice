import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/db.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-loop-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  setAgentStatusLookup(null);
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createAgent, getAgent } = await import("../raft/members.ts");
const { createChannel, joinChannel } = await import("../raft/channels.ts");
const { sendMessage } = await import("../raft/messages.ts");
const { ack } = await import("../raft/inbox.ts");
const {
  runAgentRound,
  parseAgentAction,
  buildReplyPrompt,
  buildRevisionPrompt,
  waitForPromptCompletion,
  deliverWithFreshness,
  MAX_REVISE_RETRIES,
  MAX_RESEND_RETRIES,
} = await import("./loop.ts");
const { subscribeAgentStatuses, setAgentStatusLookup, publishAgentStatus } = await import(
  "../agent-status.ts"
);
const { OWNER_MEMBER_ID } = await import("../data/schema.ts");

const STATUS_BY_EVENT = {
  agent_start: "working",
  agent_end: "online",
  agent_settled: "online",
  prompt_error: "error",
};

// 镜像 agent-runtime 的现场状态推导 + 事件→状态映射，让状态点断言走真实链路
let activeRuntime = null;
setAgentStatusLookup((member) => {
  const session = activeRuntime?.sessions.get(member.id);
  if (!session) return null;
  if (session.isRunning()) return "working";
  return getAgent(member.id).status === "error" ? null : "online";
});

function wireSessionStatus(memberId, session) {
  session.onEvent((event) => {
    const status = STATUS_BY_EVENT[event.type];
    if (status) publishAgentStatus(memberId, status);
  });
}

function sendAsOwner(targetId, content) {
  const result = sendMessage({ targetId, authorId: OWNER_MEMBER_ID, content });
  assert.equal(result.held, false);
  return result.message;
}

function makeFakeSession(replies = []) {
  const listeners = [];
  let running = false;
  const session = {
    replies,
    lastText: "",
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
        this.emit({ type: "agent_start" });
        queueMicrotask(() => {
          running = false;
          if (reply?.error) {
            this.emit({ type: "prompt_error", errorMessage: reply.error });
          } else {
            this.lastText = reply?.text ?? "";
            this.emit({ type: "prompt_done" });
          }
          this.emit({ type: "agent_end" });
        });
        return null;
      }
      if (command.type === "get_last_assistant_text") return { text: this.lastText };
      return null;
    },
  };
  return session;
}

function makeFakeRuntime({ repliesByAgent = {}, prestarted = [] } = {}) {
  const sessions = new Map();
  for (const memberId of prestarted) {
    const session = makeFakeSession(repliesByAgent[memberId] ?? []);
    wireSessionStatus(memberId, session);
    sessions.set(memberId, session);
  }
  return {
    sessions,
    findSession: (member) => sessions.get(member.id),
    async startSession(member) {
      if (!member.workspace_path) throw new Error("Agent has no workspace bound");
      const session = makeFakeSession(repliesByAgent[member.id] ?? []);
      wireSessionStatus(member.id, session);
      sessions.set(member.id, session);
      return { sessionId: member.id, sessionFile: `/sessions/${member.id}.jsonl` };
    },
  };
}

function setupAgentAndChannel({ name, channelName = "loop-room", join = true, workspace = true }) {
  const ws = workspace ? fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-loop-ws-")) : null;
  const agent = createAgent({ name, workspacePath: ws });
  const channel = createChannel({ name: channelName });
  if (join) joinChannel(channel.id, agent.id);
  return { agent, channel, ws };
}

// ---------------------------------------------------------------------------
// parseAgentAction
// ---------------------------------------------------------------------------

test("parseAgentAction parses JSON reply and accepts the four conflict choices", () => {
  const reply = parseAgentAction('{"action":"reply","content":"hi","onConflict":"resend"}');
  assert.deepEqual(reply, { action: "reply", content: "hi", onConflict: "resend" });
  for (const choice of ["revise", "resend", "silent", "anyway"]) {
    assert.equal(parseAgentAction(`{"action":"reply","content":"x","onConflict":"${choice}"}`).onConflict, choice);
  }
  const ignored = parseAgentAction('{"action":"ignore"}');
  assert.equal(ignored.action, "ignore");
  assert.equal(ignored.onConflict, "revise");
});

test("parseAgentAction strips json code fences and falls back to the whole text", () => {
  const fenced = parseAgentAction('```json\n{"action":"reply","content":"ok","onConflict":"silent"}\n```');
  assert.deepEqual(fenced, { action: "reply", content: "ok", onConflict: "silent" });

  const plain = parseAgentAction("I will take a look at this.");
  assert.deepEqual(plain, { action: "reply", content: "I will take a look at this.", onConflict: "revise" });
});

// ---------------------------------------------------------------------------
// buildReplyPrompt
// ---------------------------------------------------------------------------

test("buildReplyPrompt carries channel context, seq-tagged messages, tasks and the room marker", () => {
  const { agent, channel } = setupAgentAndChannel({ name: "prompter" });
  const human = { id: "owner", name: "Owner" };
  const prompt = buildReplyPrompt({
    agent,
    channel,
    messages: [
      { id: "m1", target_id: channel.id, seq: 1, author_id: "owner", content: "please fix the bug", created_at: "", author: human },
    ],
    tasks: [{ number: 3, status: "todo", preview: "fix the bug", ownerName: "unassigned" }],
    targetId: channel.id,
    baseSeq: 1,
  });
  assert.match(prompt, /@prompter/);
  assert.match(prompt, /loop-room/);
  assert.match(prompt, /#1 @Owner: please fix the bug/);
  assert.match(prompt, /task #3 \[todo\]/);
  assert.match(prompt, /action/);
  assert.match(prompt, /\[worksplice:target=[^\]]+ seq=1\]/);
  assert.match(prompt, new RegExp(`\\[worksplice:target=${channel.id} seq=1\\]`));
});

// ---------------------------------------------------------------------------
// buildRevisionPrompt
// ---------------------------------------------------------------------------

test("buildRevisionPrompt summarizes what happened and includes the draft and marker", () => {
  const { channel } = setupAgentAndChannel({ name: "revisee" });
  const prompt = buildRevisionPrompt({
    channel,
    originalContent: "my draft",
    held: { roomSeq: 5, whatHappened: "2 new message(s) arrived (seq 3–4)" },
    newMessages: [
      { id: "m3", target_id: channel.id, seq: 3, author_id: "owner", content: "wait I changed my mind", created_at: "", author: { id: "owner", name: "Owner" } },
    ],
    targetId: channel.id,
  });
  assert.match(prompt, /held/);
  assert.match(prompt, /2 new message/);
  assert.match(prompt, /wait I changed my mind/);
  assert.match(prompt, /my draft/);
  assert.match(prompt, new RegExp(`\\[worksplice:target=${channel.id} seq=5\\]`));
});

// ---------------------------------------------------------------------------
// waitForPromptCompletion
// ---------------------------------------------------------------------------

test("waitForPromptCompletion resolves on prompt_done and rejects on prompt_error", async () => {
  const okSession = makeFakeSession();
  const pending = waitForPromptCompletion(okSession);
  okSession.emit({ type: "prompt_done" });
  assert.deepEqual(await pending, { ok: true });

  const errSession = makeFakeSession();
  const errPending = waitForPromptCompletion(errSession);
  errSession.emit({ type: "prompt_error", errorMessage: "no api key" });
  assert.deepEqual(await errPending, { ok: false, error: "no api key" });
});

// ---------------------------------------------------------------------------
// runAgentRound: drain → decide → act → reply → ack
// ---------------------------------------------------------------------------

test("a human message triggers drain → prompt → reply landed in SQLite; cursor advanced; status working→online", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "happy" });
  sendAsOwner(channel.id, "hello agent");

  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: '{"action":"reply","content":"hello human","onConflict":"revise"}' }] },
  });
  activeRuntime = runtime;

  const statuses = [];
  const unsub = subscribeAgentStatuses((snapshot) => statuses.push(snapshot[agent.id]));
  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  unsub();

  assert.equal(outcome.status, "replied");
  const db = globalThis.__workspliceDb;
  const messages = db.listMessages(channel.id);
  assert.equal(messages.length, 2);
  assert.equal(messages[1].seq, 2);
  assert.equal(messages[1].author_id, agent.id);
  assert.equal(messages[1].content, "hello human");
  assert.equal(db.getConsumedSeq(agent.id, channel.id), 1);
  assert.equal(getAgent(agent.id).status, "online");
  assert.ok(statuses.includes("working"), `expected working in ${JSON.stringify(statuses)}`);
  assert.equal(statuses[statuses.length - 1], "online");

  const session = runtime.sessions.get(agent.id);
  assert.equal(session.prompts.length, 1);
  assert.match(session.prompts[0], /hello agent/);
});

test("an empty drain is a noop without prompting", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "empty" });
  const runtime = makeFakeRuntime();
  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "noop");
  assert.equal(runtime.sessions.get(agent.id)?.prompts.length ?? 0, 0);
});

test("only the agent's own unconsumed messages: ack without prompting", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "selfy" });
  sendAsOwner(channel.id, "human first");
  ack(agent.id, channel.id, 1);
  const reply = sendMessage({ targetId: channel.id, authorId: agent.id, content: "my own reply" });
  assert.equal(reply.held, false);

  const runtime = makeFakeRuntime();
  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "noop");
  assert.equal(outcome.reason, "only the agent's own messages");
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 2);
  assert.equal(runtime.sessions.get(agent.id)?.prompts.length ?? 0, 0);
});

test("a reminder-driven round processes the agent's own system reminder (reason=reminder)", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "reminded" });
  // §3.9 系统提醒消息以作者署名投递：drain 里全是自己的消息
  const reminder = sendMessage({
    targetId: channel.id,
    authorId: agent.id,
    content: "⏰ Reminder: check the build",
  });
  assert.equal(reminder.held, false);

  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: '{"action":"reply","content":"on it","onConflict":"revise"}' }] },
  });
  // 同样的"只有自己的消息"在 message wake 下会 noop（见上面的 selfy 用例），
  // reminder 驱动则必须走到 decide——agent 要看到自己的提醒并行动
  const outcome = await runAgentRound(agent.id, channel.id, runtime, "reminder");
  assert.equal(outcome.status, "replied");
  const session = runtime.sessions.get(agent.id);
  assert.ok(session.prompts[0].includes("⏰ Reminder: check the build"));
  const messages = globalThis.__workspliceDb.listMessages(channel.id);
  assert.equal(messages[messages.length - 1].content, "on it");
  // 游标推进到本轮读到的最新版本（自己的回复不消费，等待他人消息/下次提醒）
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 1);
});

test("the latest message being the agent's own skips prompting (crash 后已回复窗口)", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "replied" });
  sendAsOwner(channel.id, "todo?");
  sendMessage({ targetId: channel.id, authorId: agent.id, content: "on it" });

  const runtime = makeFakeRuntime();
  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.reason, "already replied to the latest message");
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 2);
  assert.equal(runtime.sessions.get(agent.id)?.prompts.length ?? 0, 0);
});

test("an unbound agent and a non-member skip without prompting", async () => {
  const unbound = createAgent({ name: "unbound" });
  globalThis.__workspliceDb.setMemberWorkspace(unbound.id, null, null);
  const runtime = makeFakeRuntime();
  const unboundOutcome = await runAgentRound(unbound.id, "#all", runtime);
  assert.equal(unboundOutcome.status, "skipped");

  const { agent, channel } = setupAgentAndChannel({ name: "outsider", join: false });
  sendAsOwner(channel.id, "private stuff");
  const outsiderOutcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outsiderOutcome.status, "skipped");
  assert.equal(outsiderOutcome.reason, "not a member of the channel");
});

test("a session error marks the agent error and does not advance the cursor", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "crasher" });
  sendAsOwner(channel.id, "please work");
  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ error: "no api key configured" }] },
  });

  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "error");
  assert.equal(getAgent(agent.id).status, "error");
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0);
});

test("an ignore action posts nothing but still advances the cursor", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "ignorer" });
  sendAsOwner(channel.id, "noted?");
  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: '{"action":"ignore"}' }] },
  });

  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "ignored");
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 1);
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 1);
});

test("a non-JSON reply is sent as-is (whole text)", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "plain" });
  sendAsOwner(channel.id, "how are you?");
  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: "I am well, thanks." }] },
  });

  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "replied");
  const messages = globalThis.__workspliceDb.listMessages(channel.id);
  assert.equal(messages[messages.length - 1].content, "I am well, thanks.");
});

// ---------------------------------------------------------------------------
// deliverWithFreshness：held 后四选一
// ---------------------------------------------------------------------------

const HELD = { held: true, roomSeq: 3, whatHappened: "2 new message(s) arrived in this target (seq 2–3)" };

function scriptedSender(results) {
  const calls = [];
  let i = 0;
  const send = (opts) => {
    calls.push(opts);
    const result = results[Math.min(i++, results.length - 1)];
    return result === HELD ? { ...HELD } : result;
  };
  return { send, calls };
}

function baseAgent(id = "agent-x") {
  return { id, type: "agent", name: "x", description: "", role: "member", workspace_path: "/tmp/w", pi_session_file: null, status: "online", deleted: 0, created_at: "" };
}

test("held + revise: re-prompts with the new message content and delivers the rewritten reply", async () => {
  const { channel } = setupAgentAndChannel({ name: "revise-room" });
  sendAsOwner(channel.id, "original ask");   // seq 1
  sendAsOwner(channel.id, "changed my mind"); // seq 2（写稿期间到达）
  const { send, calls } = scriptedSender([HELD, { held: false, message: { id: "m-final" } }]);
  const revised = '{"action":"reply","content":"rewritten","onConflict":"silent"}';
  const promptFn = async (promptText) => {
    assert.match(promptText, /2 new message/);
    assert.match(promptText, /changed my mind/);
    assert.match(promptText, /my draft/);
    return revised;
  };
  const outcome = await deliverWithFreshness({
    targetId: channel.id,
    agent: baseAgent(),
    channel,
    action: { action: "reply", content: "my draft", onConflict: "revise" },
    baseSeq: 1,
    promptFn,
    send,
  });
  assert.equal(outcome.status, "replied");
  assert.equal(outcome.message.id, "m-final");
  assert.equal(outcome.ackSeq, 3, "held 后游标推进到 roomSeq");
  assert.equal(calls[1].content, "rewritten");
  assert.equal(calls[1].baseSeq, 3);
});

test("held + resend: retries with the fresh room version without re-prompting", async () => {
  const { channel } = setupAgentAndChannel({ name: "resend-room" });
  const { send, calls } = scriptedSender([HELD, { held: false, message: { id: "m" } }]);
  const outcome = await deliverWithFreshness({
    targetId: channel.id,
    agent: baseAgent(),
    channel,
    action: { action: "reply", content: "draft", onConflict: "resend" },
    baseSeq: 1,
    promptFn: async () => {
      throw new Error("must not re-prompt");
    },
    send,
  });
  assert.equal(outcome.status, "replied");
  assert.equal(outcome.ackSeq, 3, "resend 后游标推进到 roomSeq");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].baseSeq, 3);
  assert.equal(calls[1].content, "draft");
});

test("held + silent: drops the reply entirely", async () => {
  const { channel } = setupAgentAndChannel({ name: "silent-room" });
  const { send, calls } = scriptedSender([HELD]);
  const outcome = await deliverWithFreshness({
    targetId: channel.id,
    agent: baseAgent(),
    channel,
    action: { action: "reply", content: "draft", onConflict: "silent" },
    baseSeq: 1,
    promptFn: async () => "",
    send,
  });
  assert.equal(outcome.status, "silent");
  assert.equal(outcome.ackSeq, 3, "silent 也在被告知房间变化后推进游标");
  assert.equal(calls.length, 1);
});

test("held + anyway: the escape hatch sends without the freshness check", async () => {
  const { channel } = setupAgentAndChannel({ name: "anyway-room" });
  const { send, calls } = scriptedSender([HELD, { held: false, message: { id: "m" } }]);
  const outcome = await deliverWithFreshness({
    targetId: channel.id,
    agent: baseAgent(),
    channel,
    action: { action: "reply", content: "draft", onConflict: "anyway" },
    baseSeq: 1,
    promptFn: async () => "",
    send,
  });
  assert.equal(outcome.status, "anyway");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].baseSeq, undefined);
  assert.equal(calls[1].content, "draft");
});

test("revise retries are capped, then the reply is dropped", async () => {
  const { channel } = setupAgentAndChannel({ name: "revise-exhaust" });
  const { send, calls } = scriptedSender([HELD]);
  let promptCalls = 0;
  const outcome = await deliverWithFreshness({
    targetId: channel.id,
    agent: baseAgent(),
    channel,
    action: { action: "reply", content: "draft", onConflict: "revise" },
    baseSeq: 1,
    promptFn: async () => {
      promptCalls += 1;
      return '{"action":"reply","content":"again","onConflict":"revise"}';
    },
    send,
  });
  assert.equal(outcome.status, "silent");
  assert.equal(outcome.reason, "revise retries exhausted");
  assert.equal(promptCalls, MAX_REVISE_RETRIES);
  assert.equal(calls.length, MAX_REVISE_RETRIES + 1);
});

test("resend retries are capped, then the reply is dropped", async () => {
  const { channel } = setupAgentAndChannel({ name: "resend-exhaust" });
  const { send, calls } = scriptedSender([HELD]);
  const outcome = await deliverWithFreshness({
    targetId: channel.id,
    agent: baseAgent(),
    channel,
    action: { action: "reply", content: "draft", onConflict: "resend" },
    baseSeq: 1,
    promptFn: async () => "",
    send,
  });
  assert.equal(outcome.status, "silent");
  assert.equal(outcome.reason, "resend retries exhausted");
  assert.equal(calls.length, MAX_RESEND_RETRIES + 1);
});

test("a revised-to-ignore reply is dropped", async () => {
  const { channel } = setupAgentAndChannel({ name: "revise-ignore" });
  const { send } = scriptedSender([HELD]);
  const outcome = await deliverWithFreshness({
    targetId: channel.id,
    agent: baseAgent(),
    channel,
    action: { action: "reply", content: "draft", onConflict: "revise" },
    baseSeq: 1,
    promptFn: async () => '{"action":"ignore"}',
    send,
  });
  assert.equal(outcome.status, "silent");
  assert.equal(outcome.reason, "revised to ignore");
});

test("a busy session reports busy without prompting", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "busy" });
  sendAsOwner(channel.id, "while you are busy");
  const runtime = makeFakeRuntime({ prestarted: [agent.id] });
  const session = runtime.sessions.get(agent.id);
  session.isRunning = () => true;
  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "busy");
  assert.equal(session.prompts.length, 0);
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0);
});

test("a non-member agent mentioned in a public channel runs the round and auto-joins to reply", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "mentionee", join: false });
  assert.equal(globalThis.__workspliceDb.isChannelMember(channel.id, agent.id), false);
  sendAsOwner(channel.id, "hey @mentionee your input needed");

  const runtime = makeFakeRuntime({ repliesByAgent: { [agent.id]: [{ text: '{"action":"reply","content":"joining in!"}' }] } });
  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "replied");

  // 注意力信号语义：agent 自行加入公开 channel 后回复落库
  assert.equal(globalThis.__workspliceDb.isChannelMember(channel.id, agent.id), true);
  const messages = globalThis.__workspliceDb.listMessages(channel.id);
  assert.equal(messages[messages.length - 1].content, "joining in!");
  // 游标推进到本轮读到的最新版本（自己的回复不消费，等待他人消息）
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 1);
});

test("a non-member agent mentioned in a private channel reads but cannot reply", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-loop-ws-"));
  const agent = createAgent({ name: "privacy" , workspacePath: ws });
  const channel = createChannel({ name: "private-mention", type: "private" });
  joinChannel(channel.id, agent.id, OWNER_MEMBER_ID);
  // 移出成员，模拟"未加入但被 @mention"（mention 穿透）
  globalThis.__workspliceDb.removeChannelMember(channel.id, agent.id);
  sendAsOwner(channel.id, "hey @privacy confidential thing");

  const runtime = makeFakeRuntime({ repliesByAgent: { [agent.id]: [{ text: '{"action":"reply","content":"I will reply"}' }] } });
  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "silent");
  assert.equal(outcome.reason, "not a member of the private channel");
  assert.equal(globalThis.__workspliceDb.isChannelMember(channel.id, agent.id), false);
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 1, "no reply was posted");
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 1);
});

test("an ignored mention reply does not join the channel", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "mentionee-ignore", join: false });
  sendAsOwner(channel.id, "hey @mentionee-ignore look here");

  const runtime = makeFakeRuntime({ repliesByAgent: { [agent.id]: [{ text: '{"action":"ignore"}' }] } });
  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "ignored");
  assert.equal(globalThis.__workspliceDb.isChannelMember(channel.id, agent.id), false);
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 1);
});
