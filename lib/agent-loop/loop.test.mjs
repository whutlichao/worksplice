import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/sqlite.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-loop-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  setAgentStatusLookup(null);
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createAgent, getAgent } = await import("../domain/collab/members.ts");
const { createChannel, joinChannel } = await import("../domain/collab/channels.ts");
const { sendMessage } = await import("../domain/collab/messages.ts");
const { ack } = await import("../domain/collab/inbox.ts");
const {
  runAgentRound,
  parseAgentAction,
  buildReplyPrompt,
  buildRevisionPrompt,
  waitForPromptCompletion,
  promptSession,
  waitForSessionIdle,
  deliverWithFreshness,
  MAX_REVISE_RETRIES,
  MAX_RESEND_RETRIES,
} = await import("./loop.ts");
const { subscribeAgentStatuses, setAgentStatusLookup, publishAgentStatus } = await import(
  "../agent-status.ts"
);
const { BusyCwdError } = await import("../agent-runtime.ts");
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
    if (!status) return;
    // 镜像 agent-runtime：agent_end/agent_settled 不覆盖 error（只被下一次 agent_start 清除）
    if (
      getAgent(memberId).status === "error" &&
      (event.type === "agent_end" || event.type === "agent_settled")
    ) {
      return;
    }
    publishAgentStatus(memberId, status);
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

test("parseAgentAction extracts the JSON object from text polluted with model tokens or prose", () => {
  const eom = parseAgentAction(
    '{ "action": "reply", "content": "因为这是工作流程要求的格式", "onConflict": "revise" }<|eom|>',
  );
  assert.deepEqual(eom, {
    action: "reply",
    content: "因为这是工作流程要求的格式",
    onConflict: "revise",
  });

  const trailingProse = parseAgentAction(
    '{"action":"reply","content":"ok","onConflict":"silent"} 以上是我的回复，请查收。',
  );
  assert.deepEqual(trailingProse, { action: "reply", content: "ok", onConflict: "silent" });

  const leadingProse = parseAgentAction(
    '好的，我的回复是：{"action":"reply","content":"done","onConflict":"revise"}',
  );
  assert.deepEqual(leadingProse, { action: "reply", content: "done", onConflict: "revise" });

  const bracesInContent = parseAgentAction(
    '{"action":"reply","content":"代码在 {app} 目录，请查阅 {docs}","onConflict":"revise"}<|eom|>',
  );
  assert.deepEqual(bracesInContent, {
    action: "reply",
    content: "代码在 {app} 目录，请查阅 {docs}",
    onConflict: "revise",
  });

  const plainStillFallsBack = parseAgentAction("我用 { } 花括号强调一下重点。");
  assert.deepEqual(plainStillFallsBack, {
    action: "reply",
    content: "我用 { } 花括号强调一下重点。",
    onConflict: "revise",
  });
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
    tasks: [
      { number: 3, status: "todo", preview: "fix the bug", ownerName: "unassigned" },
      { number: 4, status: "todo", preview: "redo the thing", ownerName: "unassigned", reopened: true },
    ],
    targetId: channel.id,
    baseSeq: 1,
  });
  assert.match(prompt, /@prompter/);
  assert.match(prompt, /loop-room/);
  assert.match(prompt, /#1 @Owner: please fix the bug/);
  assert.match(prompt, /task #3 \[todo\]/);
  assert.match(prompt, /task #4 \[todo\].*REOPENED, awaiting the owner: do not claim/);
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

test("a model failure that resolves with empty text (SDK 402) errors without advancing the cursor", async () => {
  // pi SDK 对 API 报错（如 openrouter 402 余额不足）不 reject prompt()：
  // 错误写进 jsonl，事件流只发 prompt_done，get_last_assistant_text 为空。
  // 这类轮次必须按失败处理（不 ack），否则消息被静默消费、agent 永不回复。
  const { agent, channel } = setupAgentAndChannel({ name: "broker" });
  sendAsOwner(channel.id, "please reply");
  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: "" }] },
  });

  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "error");
  assert.equal(getAgent(agent.id).status, "error");
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 1);
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0);
});

test("a late agent_end does not wipe the error status of an empty-text failure", async () => {
  // 真实 SDK 在模型/API 失败时仍发 agent_end；收尾事件不得把 error 状态洗回 online
  const { agent, channel } = setupAgentAndChannel({ name: "late-end" });
  sendAsOwner(channel.id, "please reply");
  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: "" }] },
  });

  await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(getAgent(agent.id).status, "error");
});

test("a reply action with empty content (degenerate JSON) errors without advancing the cursor", async () => {
  // 模型退化：{\"action\":\"reply\"} 无 content——声明了 reply 却给不出文本，与空文本同语义：
  // 本轮失败、不 ack，触发消息保持 pending 供下次 wake 重试（否则被静默消费）
  const { agent, channel } = setupAgentAndChannel({ name: "empty-reply" });
  sendAsOwner(channel.id, "please reply");
  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: '{"action":"reply"}' }] },
  });

  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "error");
  assert.equal(getAgent(agent.id).status, "error");
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 1);
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0);
});

test("a prompt failure is an error round carrying the drained room version (11)", async () => {
  // 11-整改：prompt-fail（模型/API 报错，如 402）的 error 轮携带本轮 drain 的房间版本，
  // 可观测页 round_logs base_seq 非 0（07 承诺：每轮 status/reason/target/#baseSeq/时间）
  const { agent, channel } = setupAgentAndChannel({ name: "prompt-fail" });
  sendAsOwner(channel.id, "hello");
  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ error: "model 402" }] },
  });

  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "error");
  assert.equal(outcome.reason, "model 402");
  assert.equal(outcome.baseSeq, 1, "prompt-fail 的 error 轮携带本轮 drain 的房间版本");
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0);
});

test("a thrown round error is an error round carrying the drained room version (11)", async () => {
  // 11-整改：catch 分支（prompt 收口后读 last text 抛错等）的 error 轮同样携带 baseSeq
  const { agent, channel } = setupAgentAndChannel({ name: "thrown-error" });
  sendAsOwner(channel.id, "hello");
  const runtime = makeFakeRuntime({ prestarted: [agent.id] });
  const session = runtime.sessions.get(agent.id);
  const original = session.send.bind(session);
  session.send = async (command) => {
    if (command.type === "get_last_assistant_text") throw new Error("last text read failed");
    return original(command);
  };

  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "error");
  assert.equal(outcome.reason, "last text read failed");
  assert.equal(outcome.baseSeq, 1, "catch 的 error 轮携带本轮 drain 的房间版本");
  assert.equal(getAgent(agent.id).status, "error");
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0);
});

test("a revised empty reply is an error round: no ack, error status point, pending retry (11)", async () => {
  // 11-整改：freshness-hold 后重写也退化（reply 无内容）= error 轮——不推进游标（被 hold 的
  // 消息保持 pending 供下次 wake 重试）、error 状态点；与直接空 reply 路径归类一致
  const { agent, channel } = setupAgentAndChannel({ name: "revise-empty-round" });
  sendAsOwner(channel.id, "original ask"); // seq 1
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        { text: '{"action":"reply","content":"draft","onConflict":"revise"}' },
        { text: '{"action":"reply","content":""}' },
      ],
    },
  });
  const outcomePromise = runAgentRound(agent.id, channel.id, runtime);
  // drain 已取到 seq 1（baseSeq=1）；写稿期间房间又来了新消息 → 回复被 hold
  sendAsOwner(channel.id, "changed my mind"); // seq 2
  const outcome = await outcomePromise;

  assert.equal(outcome.status, "error");
  assert.equal(outcome.reason, "revised reply had no content");
  assert.equal(outcome.baseSeq, 1, "error 轮携带本轮 drain 的房间版本（held 的新消息未 ack、保持 pending）");
  assert.equal(getAgent(agent.id).status, "error");
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 2, "无回复落库");
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0, "游标不推进——消息保持 pending 供下次 wake 重试");
});

test("an explicit ignore with a pending trigger still advances the cursor (legitimate protocol choice)", async () => {
  // 区分"正常协议选择"与"误判"：无确定信号（未 @mention、非任务 owner 线程）时的显式 ignore
  // 是模型的有意决定，游标照常推进；只有声明 reply 却无内容、或确定信号下 ignore 才按失败处理
  const { agent, channel } = setupAgentAndChannel({ name: "legit-ignore" });
  sendAsOwner(channel.id, "maybe reply");
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

test("a revised reply with no content is an error round, not silent (11)", async () => {
  // 11-整改：重写也退化（reply 无内容）与直接空 reply 路径归类一致 = error 轮——
  // 不推进游标（ackSeq 停在本轮已读版本）、会被 runAgentRound 标 error 状态点并重试；
  // 不再是 silent（silent 会被 isAbandonedRound 标成「已放弃」badge，但实际会重试——badge 说谎）
  const { channel } = setupAgentAndChannel({ name: "revise-empty" });
  const { send, calls } = scriptedSender([HELD]);
  const outcome = await deliverWithFreshness({
    targetId: channel.id,
    agent: baseAgent(),
    channel,
    action: { action: "reply", content: "draft", onConflict: "revise" },
    baseSeq: 1,
    promptFn: async () => '{"action":"reply","content":""}',
    send,
  });
  assert.equal(outcome.status, "error");
  assert.equal(outcome.reason, "revised reply had no content");
  assert.equal(outcome.ackSeq, 1, "error 轮不推进游标——被 hold 的消息保持 pending 供下次 wake 重试");
  assert.equal(calls.length, 1);
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

test("an ignore on a personal mention is a must-respond failure: error, no ack, no join", async () => {
  // §05 兜底：个人 @mention 是确定信号，ignore 不合法——本轮失败（error 状态点可见、
  // 游标不推进、触发消息保持 pending），非成员也不会因"已回应"而加入频道
  const { agent, channel } = setupAgentAndChannel({ name: "mentionee-ignore", join: false });
  sendAsOwner(channel.id, "hey @mentionee-ignore look here");

  const runtime = makeFakeRuntime({ repliesByAgent: { [agent.id]: [{ text: '{"action":"ignore"}' }] } });
  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "error");
  assert.equal(getAgent(agent.id).status, "error");
  assert.equal(globalThis.__workspliceDb.isChannelMember(channel.id, agent.id), false);
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0);
});

test("repeated must-respond ignores cap at 2 then ack with error (escape hatch)", async () => {
  // §05 防死循环：同一 (agent, target) 连续两次确定信号下 ignore → cap-ack（游标推进）
  // 并保持 error 状态点——不无限重试也不永久 pending
  const { agent, channel } = setupAgentAndChannel({ name: "capped-ignorer" });
  sendAsOwner(channel.id, "hey @capped-ignorer respond now");
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [{ text: '{"action":"ignore"}' }, { text: '{"action":"ignore"}' }],
    },
  });

  const first = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(first.status, "error");
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0);

  const second = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(second.status, "error");
  assert.equal(second.reason, "ignore on must-respond signal (capped at 2)");
  assert.equal(getAgent(agent.id).status, "error");
  assert.equal(
    globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id),
    1,
    "capped: cursor acked as the escape hatch",
  );
});

test("a successful reply between failures resets the must-respond streak", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "streak-reset" });
  sendAsOwner(channel.id, "hey @streak-reset first");
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        { text: '{"action":"ignore"}' },
        { text: '{"action":"reply","content":"on it"}' },
        { text: '{"action":"ignore"}' },
        { text: '{"action":"ignore"}' },
      ],
    },
  });

  const first = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(first.status, "error", "failure #1 — streak at 1");

  sendAsOwner(channel.id, "hey @streak-reset second");
  const second = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(second.status, "replied", "successful reply resets the streak");

  sendAsOwner(channel.id, "hey @streak-reset third");
  const third = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(third.status, "error", "failure #1 again — not capped");

  sendAsOwner(channel.id, "hey @streak-reset fourth");
  const fourth = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(fourth.status, "error", "failure #2 — capped");
  assert.equal(
    globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id),
    5,
    "cap-ack advances to the channel maxSeq (5: first+second+reply+third+fourth)",
  );
});

test("buildReplyPrompt documents the response judgment rubric", () => {
  const { agent, channel } = setupAgentAndChannel({ name: "rubric" });
  const prompt = buildReplyPrompt({
    agent,
    channel,
    messages: [],
    tasks: [],
    targetId: channel.id,
    baseSeq: 0,
  });
  assert.match(prompt, /MUST reply/);
  assert.match(prompt, /MAY reply/);
  assert.match(prompt, /MUST ignore \(do not chime in\)/);
  assert.match(prompt, /being mentioned is a demand for a response/);
});

test("a shared-cwd BusyCwdError round reports busy-cwd and does not error the status", async () => {
  // 02-决策一：BusyCwdError 映射为 busy-cwd（driver 重试），不再是 error 轮（丢弃）
  const { agent, channel } = setupAgentAndChannel({ name: "cwd-busy" });
  sendAsOwner(channel.id, "hello there");
  const runtime = makeFakeRuntime();
  runtime.startSession = async (member) => {
    throw new BusyCwdError(member.workspace_path);
  };
  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "busy-cwd");
  assert.notEqual(getAgent(agent.id).status, "error", "busy-cwd 不落 error 状态");
  assert.equal(outcome.baseSeq, 1, "07-承诺：busy-cwd 轮也携带房间版本（round_logs base_seq 非 0）");
});

// ---------------------------------------------------------------------------
// 05 实测整改：prompt_done ≠ 会话空闲（hold 后 revise 的 settle 缝）
// ---------------------------------------------------------------------------
// 真实运行里 revise 曾经 100% 失败：`prompt_done` 只说明这一轮 prompt 调用返回了，
// pi SDK 仍在收尾，此时发第二个 prompt 会被直接拒绝——SDK 原文：
//   "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp')
//    to queue the message."
// → 空文本 → error 轮（消息不丢，靠下一轮 wake 重试）。
// 此前所有 revise 测试都注入假 promptFn，因此缝在 loop 与 wrapper 之间，从未被覆盖。

function fakePromptSession({ idleAfterMs = 0, replyText = '{"action":"reply","content":"revised"}' } = {}) {
  let running = idleAfterMs > 0;
  const listeners = new Set();
  const sent = [];
  if (idleAfterMs > 0) setTimeout(() => { running = false; }, idleAfterMs);
  return {
    sent,
    isRunning: () => running,
    onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    send: async (command) => {
      if (command.type === "prompt") {
        // 镜像 pi SDK + wrapper：仍在处理时拒绝这个 prompt，并如实发 prompt_error
        // （wrapper 的 .catch 就是发这个事件——所以等待方不会留下悬挂的定时器）
        if (running) {
          queueMicrotask(() => {
            for (const listener of listeners) {
              listener({
                type: "prompt_error",
                errorMessage:
                  "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
              });
            }
          });
          throw new Error(
            "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
          );
        }
        sent.push(command.message);
        queueMicrotask(() => { for (const listener of listeners) listener({ type: "prompt_done" }); });
        return null;
      }
      if (command.type === "get_last_assistant_text") return { text: replyText };
      return null;
    },
  };
}

test("promptSession 先等会话空闲再发：revise 不再撞 SDK 的 processing 拒绝", async () => {
  const session = fakePromptSession({ idleAfterMs: 200 });
  const result = await promptSession(session, "[worksplice:revision] 重写");
  assert.equal(result.ok, true, "会话空闲后应当发得出去（修前这里是 ok:false）");
  assert.equal(result.text, '{"action":"reply","content":"revised"}');
  assert.deepEqual(session.sent, ["[worksplice:revision] 重写"], "prompt 在会话空闲之后才发出");
});

test("waitForSessionIdle 超时不抛：返回 false，把原始错误留给 SDK 如实暴露", async () => {
  const stuck = { isRunning: () => true, onEvent: () => () => {}, send: async () => null };
  assert.equal(await waitForSessionIdle(stuck, 60, 10), false);
  assert.equal(await waitForSessionIdle(fakePromptSession(), 60, 10), true);
});
