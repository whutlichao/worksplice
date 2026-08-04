import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/db.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-driver-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createAgent } = await import("../raft/members.ts");
const { createChannel, joinChannel } = await import("../raft/channels.ts");
const { sendMessage } = await import("../raft/messages.ts");
const { startAgentLoopDriver } = await import("./driver.ts");
const { emitWake } = await import("./wake.ts");
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
          this.emit({ type: "prompt_done" });
          this.emit({ type: "agent_settled" });
        });
        return null;
      }
      if (command.type === "get_last_assistant_text") return { text: this.lastText };
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

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
