import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/sqlite.ts";

/**
 * 票 #242 的 loop 接缝：启动与低频 tick 都运行 handoff 恢复扫描。
 * 真实临时 SQLite + 可注入 emitWake + fake runtime（不真起模型、不接网络）。
 */

let root;
test.beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-loop-handoff-recovery-"));
  globalThis.__workspliceDb = openDataDb(root);
});
test.afterEach(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
  susan = undefined;
});

const {
  ack,
  createAgent,
  createChannel,
  createTask,
  emitWake,
  handoffTask,
  joinChannel,
  sendMessage,
} = await import("../domain/collab/index.ts");
const {
  createAgentLoop,
  peekAgentLoopQueues,
  runAgentRound,
  startAgentLoopDriver,
} = await import("./loop.ts");
const { setAgentStatusLookup, stopAgentStatusSweeper } = await import("../agent-status.ts");
const { OWNER_MEMBER_ID } = await import("../data/schema.ts");

setAgentStatusLookup(() => null);

function waitFor(predicate, timeoutMs = 3000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      let result;
      try {
        result = predicate();
      } catch (error) {
        reject(error);
        return;
      }
      if (result) {
        resolve(result);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error("waitFor timed out"));
        return;
      }
      setTimeout(poll, 5);
    };
    poll();
  });
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

let fixtureSeq = 0;
function unique(prefix) {
  fixtureSeq += 1;
  return `${prefix}-${fixtureSeq}`;
}

let susan;
function secretary() {
  if (!susan) susan = createAgent({ name: "Susan" });
  return susan;
}

function setupHandedOffTask() {
  const channel = createChannel({ name: unique("loop-recovery-room") });
  joinChannel(channel.id, secretary().id);
  const alice = createAgent({ name: unique("loop-recovery-alice") });
  joinChannel(channel.id, alice.id);
  const anchor = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "please ship the release notes",
  });
  assert.equal(anchor.held, false);
  const task = createTask({ messageId: anchor.message.id });
  const handedOff = handoffTask({
    channelId: channel.id,
    taskNumber: task.number,
    secretaryId: secretary().id,
    assignee: alice.name,
    emitWake: () => {},
  });
  assert.equal(handedOff.status, "handed_off");
  return { channel, anchor: anchor.message, task, alice, handedOff };
}

test("startup recovery re-sends a lost handoff wake and runs exactly one model round", async () => {
  const { anchor, task, alice, handedOff } = setupHandedOffTask();
  const recovered = [];
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [alice.id]: [{ text: '{"action":"reply","content":"picked up the task"}' }],
    },
  });
  const loop = createAgentLoop({
    runtime,
    pollMs: 100_000,
    emitWake: (hint) => {
      recovered.push(hint);
      emitWake(hint);
    },
  });
  try {
    loop.start();
    await waitFor(
      () =>
        runtime.sessions.get(alice.id)?.prompts.length === 1 &&
        globalThis.__workspliceDb.getConsumedSeq(alice.id, anchor.id) >=
          handedOff.notice.seq,
    );

    assert.deepEqual(
      recovered.map((hint) => ({
        agentId: hint.agentId,
        targetId: hint.targetId,
        seq: hint.seq,
        recovery: hint.recovery,
      })),
      [
        {
          agentId: alice.id,
          targetId: anchor.id,
          seq: handedOff.notice.seq,
          recovery: true,
        },
      ],
    );
    const thread = globalThis.__workspliceDb.listMessages(anchor.id);
    assert.equal(thread.length, 2, "notice + one chosen-agent reply");
    assert.equal(
      thread.filter((message) => /owner set to/.test(message.content)).length,
      1,
    );
    const row = globalThis.__workspliceDb.getTaskById(task.id);
    assert.equal(row.owner_id, alice.id);
    assert.equal(row.status, "in_progress");
    assert.ok(
      globalThis.__workspliceDb.getConsumedSeq(alice.id, anchor.id) >=
        handedOff.notice.seq,
    );
  } finally {
    loop.stop();
    stopAgentStatusSweeper();
  }
});

test("tick recovers a handoff committed after start, and repeated ticks stay idempotent", async () => {
  const runtime = makeFakeRuntime();
  const recovered = [];
  const loop = createAgentLoop({
    runtime,
    pollMs: 100_000,
    emitWake: (hint) => {
      recovered.push(hint);
      emitWake(hint);
    },
  });
  try {
    loop.start();
    const { anchor, task, alice, handedOff } = setupHandedOffTask();
    runtime.sessions.set(
      alice.id,
      makeFakeSession([{ text: '{"action":"reply","content":"on it"}' }]),
    );
    assert.equal(recovered.length, 0);

    loop.tick();
    await waitFor(
      () =>
        runtime.sessions.get(alice.id)?.prompts.length === 1 &&
        globalThis.__workspliceDb.getConsumedSeq(alice.id, anchor.id) >=
          handedOff.notice.seq,
    );
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].seq, handedOff.notice.seq);

    loop.tick();
    loop.tick();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(runtime.sessions.get(alice.id).prompts.length, 1);
    const thread = globalThis.__workspliceDb.listMessages(anchor.id);
    assert.equal(thread.length, 2, "notice + one chosen-agent reply");
    assert.equal(
      thread.filter((message) => /owner set to/.test(message.content)).length,
      1,
    );
    const row = globalThis.__workspliceDb.getTaskById(task.id);
    assert.equal(row.owner_id, alice.id);
    assert.equal(row.status, "in_progress");
  } finally {
    loop.stop();
    stopAgentStatusSweeper();
  }
});

test("a stale recovery hint is filtered before it enters the driver queue", () => {
  const { anchor, alice, handedOff } = setupHandedOffTask();
  ack(alice.id, anchor.id, handedOff.notice.seq);
  const runtime = makeFakeRuntime();
  const stop = startAgentLoopDriver({ runtime });
  try {
    emitWake({
      agentId: alice.id,
      targetId: anchor.id,
      seq: handedOff.notice.seq,
      reason: "message",
      recovery: true,
    });
    assert.deepEqual(peekAgentLoopQueues(), []);
  } finally {
    stop();
  }
});

test("a recovery hint that becomes stale before execution touches no session", async () => {
  const { anchor, alice, handedOff } = setupHandedOffTask();
  let findSessionCalls = 0;
  const runtime = {
    findSession: () => {
      findSessionCalls += 1;
      return undefined;
    },
    async startSession() {
      throw new Error("stale recovery must not start a session");
    },
  };
  const stop = startAgentLoopDriver({ runtime });
  try {
    emitWake({
      agentId: alice.id,
      targetId: anchor.id,
      seq: handedOff.notice.seq,
      reason: "message",
      recovery: true,
    });
    ack(alice.id, anchor.id, handedOff.notice.seq);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(findSessionCalls, 0);
    assert.deepEqual(
      peekAgentLoopQueues().flatMap((entry) => entry.entries),
      [],
    );
  } finally {
    stop();
  }
});

test("a blocked handoff that crashed before ack is only acknowledged on re-trigger", async () => {
  const channel = createChannel({ name: unique("blocked-recovery-room") });
  joinChannel(channel.id, secretary().id);
  const alice = createAgent({ name: unique("blocked-recovery-alice") });
  const bob = createAgent({ name: unique("blocked-recovery-bob") });
  joinChannel(channel.id, alice.id);
  joinChannel(channel.id, bob.id);
  const anchor = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "please ship the release notes",
  });
  assert.equal(anchor.held, false);
  const task = createTask({ messageId: anchor.message.id });

  const firstRuntime = makeFakeRuntime({
    repliesByAgent: {
      [secretary().id]: [
        {
          text: '{"action":"ignore","task":{"number":1,"op":"handoff","question":"Who owns this?"}}',
        },
      ],
    },
  });
  const db = globalThis.__workspliceDb;
  const setConsumedSeq = db.setConsumedSeq.bind(db);
  let crashed = false;
  db.setConsumedSeq = (agentId, targetId, seq) => {
    if (!crashed && agentId === secretary().id && targetId === channel.id) {
      crashed = true;
      throw new Error("simulated crash before ack");
    }
    return setConsumedSeq(agentId, targetId, seq);
  };
  try {
    const crashedRound = await runAgentRound(
      secretary().id,
      channel.id,
      firstRuntime,
    );
    assert.equal(crashedRound.status, "error");
    assert.equal(crashed, true);
  } finally {
    db.setConsumedSeq = setConsumedSeq;
  }

  const rowAfterCrash = db.getTaskById(task.id);
  assert.equal(rowAfterCrash.status, "todo");
  assert.equal(rowAfterCrash.owner_id, null);
  assert.equal(rowAfterCrash.handoff_state, "blocked");
  const thread = db.listMessages(anchor.message.id);
  assert.equal(thread.length, 1);
  assert.match(thread[0].content, /handoff blocked/i);
  assert.equal(db.getConsumedSeq(secretary().id, channel.id), 0);

  const retryRuntime = makeFakeRuntime();
  const retried = await runAgentRound(
    secretary().id,
    channel.id,
    retryRuntime,
  );
  assert.equal(retried.status, "noop");
  assert.match(retried.reason, /already handled/i);
  assert.equal(retryRuntime.starts.length, 0, "re-trigger must not start a session");
  assert.equal(
    db.getConsumedSeq(secretary().id, channel.id),
    db.maxSeq(channel.id),
    "re-trigger only advances the cursor",
  );

  const repeated = await runAgentRound(
    secretary().id,
    channel.id,
    makeFakeRuntime(),
  );
  assert.equal(repeated.status, "noop");
  assert.equal(db.listMessages(anchor.message.id).length, 1);
  const finalRow = db.getTaskById(task.id);
  assert.equal(finalRow.status, "todo");
  assert.equal(finalRow.owner_id, null);
  assert.equal(finalRow.handoff_state, "blocked");
});
