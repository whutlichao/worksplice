import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/sqlite.ts";

/**
 * 票 #240 的 agent-loop 黑盒接缝：
 * runAgentRound + 真实临时 SQLite + 协作域服务 + fake runtime（不接网络）。
 * 覆盖秘书触发矩阵、handoff op、普通 agent 拒绝、显式秘书 owner、定向唤醒与重复 no-op。
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-secretary-handoff-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const {
  createAgent,
  createChannel,
  createTask,
  joinChannel,
  sendMessage,
  subscribeWake,
} = await import("../domain/collab/index.ts");
const { runAgentRound } = await import("./loop.ts");
const { setAgentStatusLookup } = await import("../agent-status.ts");
const { OWNER_MEMBER_ID } = await import("../data/schema.ts");

setAgentStatusLookup(() => null);

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

let susan;
function secretary() {
  if (!susan) susan = createAgent({ name: "Susan" });
  return susan;
}

function makeAgent(prefix, { join = null } = {}) {
  const agent = createAgent({ name: unique(prefix) });
  if (join) joinChannel(join, agent.id);
  return agent;
}

function makeChannel({ private: isPrivate = false, members = [] } = {}) {
  const channel = createChannel({
    name: unique("secretary-room"),
    type: isPrivate ? "private" : "public",
    memberIds: members.map((member) => member.id),
  });
  if (!isPrivate) joinChannel(channel.id, secretary().id);
  return channel;
}

function ownerMessage(targetId, content) {
  const result = sendMessage({ targetId, authorId: OWNER_MEMBER_ID, content });
  assert.equal(result.held, false);
  return result.message;
}

function createUnclaimedTask(channel, content = "please ship the release notes") {
  const anchor = ownerMessage(channel.id, content);
  const task = createTask({ messageId: anchor.id });
  return { anchor, task };
}

function taskRow(task) {
  return globalThis.__workspliceDb.getTaskById(task.id);
}

test("a task-creation event wakes only the secretary", () => {
  const alice = makeAgent("wake-alice");
  const bob = makeAgent("wake-bob");
  const channel = makeChannel({ members: [alice, bob] });
  const anchor = ownerMessage(channel.id, "please ship the notes");
  const wakes = [];
  const unsubscribe = subscribeWake((hint) => wakes.push(hint));
  try {
    createTask({ messageId: anchor.id });
    assert.deepEqual(
      wakes.map((hint) => hint.agentId).sort(),
      [secretary().id].sort(),
      "任务创建事件只定向秘书，不扇出全 channel",
    );
  } finally {
    unsubscribe();
  }
});

test("without an available secretary the task event wakes nobody and no agent is auto-admitted", async () => {
  const alice = makeAgent("absent-alice");
  // 私有频道不会自动加入秘书；把它构造成「没有可用秘书」的频道。
  const channel = makeChannel({ private: true, members: [alice] });
  const anchor = ownerMessage(channel.id, "please ship the notes");
  const wakes = [];
  const unsubscribe = subscribeWake((hint) => wakes.push(hint));
  try {
    createTask({ messageId: anchor.id });
    assert.deepEqual(wakes, []);

    const runtime = makeFakeRuntime();
    const outcome = await runAgentRound(alice.id, channel.id, runtime);
    assert.equal(outcome.status, "skipped");
    assert.equal(runtime.starts.length, 0);
  } finally {
    unsubscribe();
  }
});

test("a non-secretary agent is not automatically admitted by a task event", async () => {
  const alice = makeAgent("non-secretary");
  const channel = makeChannel({ members: [alice] });
  createUnclaimedTask(channel);
  const runtime = makeFakeRuntime({
    repliesByAgent: { [alice.id]: [{ text: '{"action":"ignore"}' }] },
  });

  const outcome = await runAgentRound(alice.id, channel.id, runtime);
  assert.equal(outcome.status, "skipped");
  assert.equal(
    outcome.reason,
    "task event — only the secretary handles unclaimed tasks",
  );
  assert.equal(runtime.starts.length, 0);
});

test("the secretary handoff op claims for exactly one chosen agent, posts a thread notice, and wakes only that agent", async () => {
  const alice = makeAgent("chosen-alice");
  const bob = makeAgent("chosen-bob");
  const channel = makeChannel({ members: [alice, bob] });
  const { anchor, task } = createUnclaimedTask(channel);
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [secretary().id]: [
        {
          text: `{"action":"ignore","task":{"number":1,"op":"handoff","assignee":"@${alice.name}"}}`,
        },
      ],
    },
  });
  const wakes = [];
  const unsubscribe = subscribeWake((hint) => wakes.push(hint));
  try {
    const outcome = await runAgentRound(secretary().id, channel.id, runtime);
    assert.equal(outcome.status, "replied");
    assert.equal(outcome.message.target_id, anchor.id);

    const row = taskRow(task);
    assert.equal(row.status, "in_progress");
    assert.equal(row.owner_id, alice.id);
    assert.equal(row.handoff_state, "handed_off");
    assert.equal(row.handoff_seq, outcome.message.seq);
    assert.notEqual(row.owner_id, secretary().id);

    assert.deepEqual(
      wakes.map((hint) => [hint.agentId, hint.targetId, hint.seq]),
      [[alice.id, anchor.id, outcome.message.seq]],
    );

    const prompt = runtime.sessions.get(secretary().id).prompts[0];
    assert.match(prompt, /Secretary handoff/i);
    assert.match(prompt, new RegExp(alice.name));
    assert.match(prompt, new RegExp(bob.name));
    assert.match(prompt, /explicitly asked you/i);

    // 重复触发：分流已完成，秘书不再起会话。
    const repeat = makeFakeRuntime();
    const repeated = await runAgentRound(secretary().id, channel.id, repeat);
    assert.equal(repeated.status, "noop");
    assert.equal(repeat.starts.length, 0);
  } finally {
    unsubscribe();
  }
});

test("the secretary blocked handoff leaves the task unclaimed and wakes nobody", async () => {
  const alice = makeAgent("blocked-alice");
  const bob = makeAgent("blocked-bob");
  const channel = makeChannel({ members: [alice, bob] });
  const { anchor, task } = createUnclaimedTask(channel);
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [secretary().id]: [
        {
          text: '{"action":"ignore","task":{"number":1,"op":"handoff","question":"Who owns the release notes?"}}',
        },
      ],
    },
  });
  const wakes = [];
  const unsubscribe = subscribeWake((hint) => wakes.push(hint));
  try {
    const outcome = await runAgentRound(secretary().id, channel.id, runtime);
    assert.equal(outcome.status, "replied");
    const row = taskRow(task);
    assert.equal(row.status, "todo");
    assert.equal(row.owner_id, null);
    assert.equal(row.handoff_state, "blocked");
    assert.equal(row.handoff_seq, outcome.message.seq);
    const notice = globalThis.__workspliceDb.listMessages(anchor.id)[0];
    assert.match(notice.content, /blocked/i);
    assert.match(notice.content, /Who owns the release notes\?/);
    assert.deepEqual(wakes, []);
  } finally {
    unsubscribe();
  }
});

test("a normal agent's handoff op is rejected without writing owner or notice", async () => {
  const alice = makeAgent("reject-alice");
  const bob = makeAgent("reject-bob");
  const channel = makeChannel({ members: [alice, bob] });
  const { anchor, task } = createUnclaimedTask(channel);
  ownerMessage(channel.id, `@${alice.name} please take a look`);
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [alice.id]: [
        {
          text: `{"action":"ignore","task":{"number":1,"op":"handoff","assignee":"@${bob.name}"}}`,
        },
      ],
    },
  });

  const outcome = await runAgentRound(alice.id, channel.id, runtime);
  assert.equal(outcome.status, "yielded");
  assert.match(outcome.reason, /reserved for the secretary/);
  const row = taskRow(task);
  assert.equal(row.status, "todo");
  assert.equal(row.owner_id, null);
  assert.equal(row.handoff_state, null);
  assert.equal(globalThis.__workspliceDb.listMessages(anchor.id).length, 0);
});

test("an explicit human request for the secretary to own the task uses normal claim, not auto-handoff", async () => {
  const alice = makeAgent("explicit-alice");
  const channel = makeChannel({ members: [alice] });
  const { anchor, task } = createUnclaimedTask(channel);
  ownerMessage(channel.id, `@Susan please own Task #1 yourself`);
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [secretary().id]: [
        {
          text: '{"action":"reply","content":"I will own this one.","task":{"number":1,"op":"claim"}}',
        },
      ],
    },
  });

  const outcome = await runAgentRound(secretary().id, channel.id, runtime);
  assert.equal(outcome.status, "replied");
  const row = taskRow(task);
  assert.equal(row.status, "in_progress");
  assert.equal(row.owner_id, secretary().id);
  assert.equal(row.handoff_state, null);
  assert.equal(globalThis.__workspliceDb.listMessages(anchor.id).length, 1);
  assert.equal(
    globalThis.__workspliceDb.listMessages(anchor.id)[0].content,
    "I will own this one.",
  );
});

test("multiple task hits do not admit the secretary", async () => {
  const alice = makeAgent("multi-alice");
  const channel = makeChannel({ members: [alice] });
  createUnclaimedTask(channel, "first request");
  createUnclaimedTask(channel, "second request");
  const runtime = makeFakeRuntime();

  const outcome = await runAgentRound(secretary().id, channel.id, runtime);
  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.reason, "no unique unclaimed task is associated with this round");
  assert.equal(runtime.starts.length, 0);
});

test("a human message in an unclaimed task thread wakes and admits only the secretary", async () => {
  const alice = makeAgent("thread-alice");
  const bob = makeAgent("thread-bob");
  const channel = makeChannel({ members: [alice, bob] });
  const { anchor, task } = createUnclaimedTask(channel);
  const wakes = [];
  const unsubscribe = subscribeWake((hint) => wakes.push(hint));
  try {
    ownerMessage(anchor.id, "any owner for this?");
    assert.deepEqual(
      wakes.map((hint) => hint.agentId),
      [secretary().id],
    );

    // 交接前，普通非 owner 在未认领任务线程里不被自动准入。
    const bobRuntime = makeFakeRuntime();
    const bobOutcome = await runAgentRound(bob.id, anchor.id, bobRuntime);
    assert.equal(bobOutcome.status, "skipped");
    assert.equal(bobRuntime.starts.length, 0);

    const runtime = makeFakeRuntime({
      repliesByAgent: {
        [secretary().id]: [
          {
            text: `{"action":"ignore","task":{"number":1,"op":"handoff","assignee":"@${alice.name}"}}`,
          },
        ],
      },
    });
    const outcome = await runAgentRound(secretary().id, anchor.id, runtime);
    assert.equal(outcome.status, "replied");
    assert.equal(taskRow(task).owner_id, alice.id);
  } finally {
    unsubscribe();
  }
});
