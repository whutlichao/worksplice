import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/sqlite.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-dm-respond-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  setAgentStatusLookup(null);
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createAgent, getAgent } = await import("../domain/collab/members.ts");
const { isDM, createDirectChannel } = await import(
  "../domain/collab/channels.ts"
);
const { sendMessage } = await import("../domain/collab/messages.ts");
const { ack } = await import("../domain/collab/inbox.ts");
const { runAgentRound, buildReplyPrompt } = await import("./loop.ts");
const { setAgentStatusLookup, publishAgentStatus } = await import(
  "../agent-status.ts"
);
const { OWNER_MEMBER_ID } = await import("../data/schema.ts");

const db = globalThis.__workspliceDb;

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
      if (command.type === "get_last_assistant_text")
        return { text: this.lastText };
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
  const runtime = {
    sessions,
    findSession: (member) => sessions.get(member.id),
    async startSession(member) {
      if (!member.workspace_path)
        throw new Error("Agent has no workspace bound");
      const session = makeFakeSession(repliesByAgent[member.id] ?? []);
      wireSessionStatus(member.id, session);
      sessions.set(member.id, session);
      return {
        sessionId: member.id,
        sessionFile: `/sessions/${member.id}.jsonl`,
      };
    },
  };
  activeRuntime = runtime;
  return runtime;
}

/** 创建 agent（自动建 DM）并返回其 DM 频道。 */
function setupAgentWithDM({ name }) {
  const ws = fs.mkdtempSync(
    path.join(os.tmpdir(), "worksplice-dm-respond-ws-"),
  );
  const agent = createAgent({ name, workspacePath: ws });
  const dm = createDirectChannel(agent.id);
  assert.ok(dm, "agent has a dm");
  assert.equal(isDM(dm.id), true);
  return { agent, dm, ws };
}

// ---------------------------------------------------------------------------
// DM 回应判断（R4）：DM target 下作者为 owner 的人类消息 = 确定信号
// ---------------------------------------------------------------------------

test("a DM owner human message is a must-respond signal: ignore fails without ack", async () => {
  const { agent, dm } = setupAgentWithDM({ name: "dm-ignorer" });
  sendAsOwner(dm.id, "need a status update please");

  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: '{"action":"ignore"}' }] },
  });
  const outcome = await runAgentRound(agent.id, dm.id, runtime);

  assert.equal(outcome.status, "error");
  assert.equal(outcome.reason, "ignore on must-respond signal");
  assert.equal(getAgent(agent.id).status, "error", "error 状态点可见");
  assert.equal(db.listMessages(dm.id).length, 1, "no reply posted");
  assert.equal(
    db.getConsumedSeq(agent.id, dm.id),
    0,
    "游标不推进——消息保持 pending 供重试",
  );
});

test("a DM owner human message is answered normally with a reply", async () => {
  const { agent, dm } = setupAgentWithDM({ name: "dm-replier" });
  sendAsOwner(dm.id, "what's the status?");

  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        {
          text: '{"action":"reply","content":"all green","onConflict":"revise"}',
        },
      ],
    },
  });
  const outcome = await runAgentRound(agent.id, dm.id, runtime);

  assert.equal(outcome.status, "replied");
  const messages = db.listMessages(dm.id);
  assert.equal(messages.length, 2);
  assert.equal(messages[messages.length - 1].author_id, agent.id);
  assert.equal(messages[messages.length - 1].content, "all green");
  assert.equal(db.getConsumedSeq(agent.id, dm.id), 1, "游标推进到已读版本");
  assert.equal(getAgent(agent.id).status, "online");
});

test("consecutive DM ignores cap at 2 then ack with error (escape hatch)", async () => {
  const { agent, dm } = setupAgentWithDM({ name: "dm-capped" });
  sendAsOwner(dm.id, "respond now");

  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        { text: '{"action":"ignore"}' },
        { text: '{"action":"ignore"}' },
      ],
    },
  });

  const first = await runAgentRound(agent.id, dm.id, runtime);
  assert.equal(first.status, "error");
  assert.equal(db.getConsumedSeq(agent.id, dm.id), 0, "第一次失败不 ack");

  const second = await runAgentRound(agent.id, dm.id, runtime);
  assert.equal(second.status, "error");
  assert.equal(second.reason, "ignore on must-respond signal (capped at 2)");
  assert.equal(
    getAgent(agent.id).status,
    "error",
    "cap-ack 后 error 状态点仍可见",
  );
  assert.equal(
    db.getConsumedSeq(agent.id, dm.id),
    1,
    "cap-ack 兜底推进游标防死循环",
  );
});

test("the agent's own DM message does not trigger a repeated response", async () => {
  const { agent, dm } = setupAgentWithDM({ name: "dm-self" });
  sendAsOwner(dm.id, "human first");
  ack(agent.id, dm.id, 1);
  sendMessage({ targetId: dm.id, authorId: agent.id, content: "my own note" });

  const runtime = makeFakeRuntime();
  const outcome = await runAgentRound(agent.id, dm.id, runtime);

  assert.equal(outcome.status, "noop");
  assert.equal(outcome.reason, "only the agent's own messages");
  assert.equal(db.getConsumedSeq(agent.id, dm.id), 2, "自己的消息只推进游标");
  assert.equal(
    runtime.sessions.get(agent.id)?.prompts.length ?? 0,
    0,
    "不触发 prompt",
  );
});

test("an agent-authored system event (reminder) in the DM is not a must-respond signal", async () => {
  const { agent, dm } = setupAgentWithDM({ name: "dm-reminder" });
  // §3.9 系统提醒消息以作者署名投递：agent 自己的 DM 提醒在 drain 里全是自己的消息
  sendMessage({
    targetId: dm.id,
    authorId: agent.id,
    content: "⏰ Reminder: check the build",
  });

  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: '{"action":"ignore"}' }] },
  });
  const outcome = await runAgentRound(agent.id, dm.id, runtime, "reminder");

  // 系统事件是 agent 自己的消息（author 过滤），不构成 owner 人类消息确定信号——
  // ignore 是合法的协议选择，不是失败
  assert.equal(outcome.status, "ignored");
  assert.equal(getAgent(agent.id).status, "online", "不落 error 状态点");
  assert.equal(db.getConsumedSeq(agent.id, dm.id), 1, "游标照常推进");
});

test("buildReplyPrompt documents the DM must-reply rule for dm channels", () => {
  const { agent, dm } = setupAgentWithDM({ name: "dm-rubric" });
  const prompt = buildReplyPrompt({
    agent,
    channel: dm,
    messages: [
      {
        id: "m1",
        target_id: dm.id,
        seq: 1,
        author_id: OWNER_MEMBER_ID,
        content: "hello",
        created_at: "",
        author: { id: OWNER_MEMBER_ID, name: "Owner", type: "human" },
      },
    ],
    tasks: [],
    targetId: dm.id,
    baseSeq: 1,
  });
  assert.match(prompt, /MUST reply/);
  assert.match(prompt, /your direct message with the owner/i);
  assert.match(
    prompt,
    /a human message from the owner here is always a MUST reply/i,
  );
});
