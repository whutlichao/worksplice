import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/sqlite.ts";

/**
 * #270 真实行为回归：任务分流跟随频道生效首席，以及 in_review 任务 owner 的 @
 * 至少让 reviewer 进入 prompt。接缝沿用既有 runAgentRound + 真实临时 SQLite + fake runtime。
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-chief-routing-peer-review-"));
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
  joinChannel,
  muteChannel,
  sendMessage,
  setChannelChief,
  setGlobalChief,
  setRoomTurnStore,
  subscribeWake,
  updateTaskStatus,
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
    workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), `worksplice-270-${prefix}-`)),
  });
  if (join) joinChannel(join, agent.id);
  return agent;
}

function sendAsOwner(targetId, content) {
  const result = sendMessage({ targetId, authorId: OWNER_MEMBER_ID, content });
  assert.equal(result.held, false);
  return result.message;
}

function replyText(content) {
  return JSON.stringify({ action: "reply", content });
}

test("a task event wakes only the channel chief and its handoff names the actor", async () => {
  setRoomTurnStore(createRoomTurnStore());
  const globalChief = makeAgent("global-chief");
  setGlobalChief(globalChief.id);
  try {
    const channel = createChannel({ name: unique("routing-room") });
    const channelChief = makeAgent("dev", { join: channel.id });
    const pm = makeAgent("PM", { join: channel.id });
    setChannelChief(channel.id, channelChief.id);

    const anchor = sendAsOwner(channel.id, "ship the routing fix");
    const wakes = [];
    const unsubscribe = subscribeWake((hint) => wakes.push(hint));
    const task = createTask({ messageId: anchor.id });
    unsubscribe();

    assert.deepEqual(
      wakes.map((hint) => hint.agentId),
      [channelChief.id],
      "one task event calls one effective chief",
    );
    assert.equal(
      wakes.some((hint) => hint.agentId === globalChief.id),
      false,
      "the global chief is not called while the channel chief is effective",
    );

    const runtime = makeFakeRuntime({
      repliesByAgent: {
        [channelChief.id]: [
          {
            text: `{"action":"ignore","task":{"number":${task.number},"op":"handoff","assignee":"@${pm.name}"}}`,
          },
        ],
        [globalChief.id]: [{ text: replyText("should not run") }],
      },
    });

    const devOutcome = await runAgentRound(channelChief.id, channel.id, runtime);
    assert.equal(devOutcome.status, "replied");
    assert.equal(devOutcome.role, "secretary-handoff");
    assert.equal(runtime.starts[0], channelChief.id);

    const row = globalThis.__workspliceDb.getTaskById(task.id);
    assert.equal(row.owner_id, pm.id);
    assert.equal(row.status, "in_progress");
    assert.equal(row.handoff_state, "handed_off");

    const notice = globalThis.__workspliceDb.listMessages(anchor.id).at(-1);
    assert.equal(notice.author_id, channelChief.id);
    assert.equal(
      notice.content,
      `Task #${task.number} owner set to @${pm.name} by @${channelChief.name} (chief handoff).`,
    );

    const globalOutcome = await runAgentRound(globalChief.id, channel.id, runtime);
    assert.equal(globalOutcome.status, "skipped");
    assert.equal(runtime.sessions.has(globalChief.id), false);
    assert.deepEqual(runtime.starts, [channelChief.id]);
  } finally {
    setGlobalChief(null);
    setRoomTurnStore(null);
  }
});

test("an in_review task owner's @ reaches the reviewer; sign-off and non-owner @ do not", async () => {
  setRoomTurnStore(createRoomTurnStore());
  const globalChief = makeAgent("review-global");
  setGlobalChief(globalChief.id);
  try {
    const channel = createChannel({ name: unique("review-room") });
    const owner = makeAgent("review-dev", { join: channel.id });
    setChannelChief(channel.id, owner.id);
    const reviewer = makeAgent("review-PM", { join: channel.id });
    const other = makeAgent("review-other", { join: channel.id });

    const anchor = sendAsOwner(channel.id, "implement the review loop");
    const task = createTask({ messageId: anchor.id });
    assert.equal(
      claimTask({
        channelId: channel.id,
        taskNumber: task.number,
        memberId: owner.id,
      }).status,
      "claimed",
    );
    assert.equal(
      updateTaskStatus({
        channelId: channel.id,
        taskNumber: task.number,
        memberId: owner.id,
        status: "in_review",
      }).status,
      "updated",
    );

    const ownerMention = sendMessage({
      targetId: anchor.id,
      authorId: owner.id,
      content: `@${reviewer.name} please review the edge cases.`,
    }).message;
    const runtime = makeFakeRuntime({
      repliesByAgent: {
        [reviewer.id]: [{ text: replyText("reviewed and found no blockers") }],
      },
    });

    const reviewOutcome = await runAgentRound(reviewer.id, anchor.id, runtime);
    assert.equal(reviewOutcome.status, "replied");
    assert.equal(reviewOutcome.role, "task-reviewer");
    const prompt = runtime.sessions.get(reviewer.id).prompts[0];
    assert.match(prompt, new RegExp(`@${reviewer.name}`));
    assert.match(prompt, /attention signal, not a demand/);
    assert.equal(
      globalThis.__workspliceDb.getConsumedSeq(reviewer.id, anchor.id),
      ownerMention.seq,
      "the reviewer round advances the thread cursor",
    );

    const promptCount = runtime.sessions.get(reviewer.id).prompts.length;
    const cursorBeforeSignoff =
      globalThis.__workspliceDb.getConsumedSeq(reviewer.id, anchor.id);
    sendMessage({
      targetId: anchor.id,
      authorId: owner.id,
      content: `@${reviewer.name} no further comments. Signing off.`,
    });
    const signoffOutcome = await runAgentRound(reviewer.id, anchor.id, runtime);
    assert.equal(signoffOutcome.status, "skipped");
    assert.equal(
      signoffOutcome.reason,
      "task in review — reviewers require a human or task-owner mention",
    );
    assert.equal(runtime.sessions.get(reviewer.id).prompts.length, promptCount);
    assert.equal(
      globalThis.__workspliceDb.getConsumedSeq(reviewer.id, anchor.id),
      cursorBeforeSignoff,
    );

    sendMessage({
      targetId: anchor.id,
      authorId: other.id,
      content: `@${reviewer.name} one more look?`,
    });
    const nonOwnerOutcome = await runAgentRound(reviewer.id, anchor.id, runtime);
    assert.equal(nonOwnerOutcome.status, "skipped");
    assert.equal(
      nonOwnerOutcome.reason,
      "task in review — reviewers require a human or task-owner mention",
    );
    assert.equal(runtime.sessions.get(reviewer.id).prompts.length, promptCount);
  } finally {
    setGlobalChief(null);
    setRoomTurnStore(null);
  }
});

test("a muted channel chief is skipped by task events but still handles an explicit mention", async () => {
  setRoomTurnStore(createRoomTurnStore());
  const globalChief = makeAgent("muted-global");
  setGlobalChief(globalChief.id);
  try {
    const channel = createChannel({ name: unique("muted-routing-room") });
    const channelChief = makeAgent("muted-dev", { join: channel.id });
    const assignee = makeAgent("muted-PM", { join: channel.id });
    setChannelChief(channel.id, channelChief.id);
    muteChannel(channel.id, channelChief.id);

    const anchor = sendAsOwner(channel.id, "ship the muted task");
    const wakes = [];
    const unsubscribe = subscribeWake((hint) => wakes.push(hint));
    const task = createTask({ messageId: anchor.id });
    unsubscribe();
    assert.deepEqual(wakes, [], "mute wins over automatic task routing");

    const explicitWakes = [];
    const unsubscribeExplicit = subscribeWake((hint) => explicitWakes.push(hint));
    sendAsOwner(channel.id, `@${channelChief.name} handle Task #${task.number}`);
    unsubscribeExplicit();
    assert.deepEqual(
      explicitWakes.map((hint) => hint.agentId),
      [channelChief.id],
      "a human personal mention still reaches the muted chief",
    );

    const runtime = makeFakeRuntime({
      repliesByAgent: {
        [channelChief.id]: [
          {
            text: `{"action":"ignore","task":{"number":${task.number},"op":"handoff","assignee":"@${assignee.name}"}}`,
          },
        ],
      },
    });
    const outcome = await runAgentRound(channelChief.id, channel.id, runtime);
    assert.equal(outcome.status, "replied");
    assert.equal(globalThis.__workspliceDb.getTaskById(task.id).owner_id, assignee.id);
  } finally {
    setGlobalChief(null);
    setRoomTurnStore(null);
  }
});

test("without a channel chief the global chief remains the task-routing fallback", async () => {
  setRoomTurnStore(createRoomTurnStore());
  const globalChief = makeAgent("fallback-global");
  setGlobalChief(globalChief.id);
  try {
    const channel = createChannel({ name: unique("fallback-routing-room") });
    makeAgent("fallback-member", { join: channel.id });
    const anchor = sendAsOwner(channel.id, "ship through the fallback");

    const wakes = [];
    const unsubscribe = subscribeWake((hint) => wakes.push(hint));
    createTask({ messageId: anchor.id });
    unsubscribe();

    assert.deepEqual(wakes.map((hint) => hint.agentId), [globalChief.id]);
  } finally {
    setGlobalChief(null);
    setRoomTurnStore(null);
  }
});
