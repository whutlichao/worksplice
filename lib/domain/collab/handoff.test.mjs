import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../../data/sqlite.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-handoff-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const {
  claimTask,
  createAgent,
  createChannel,
  createTask,
  deleteAgent,
  joinChannel,
  sendMessage,
  subscribeWake,
} = await import("./index.ts");
const { handoffTask, listHandoffCandidates } = await import("./handoff.ts");
const { OWNER_MEMBER_ID } = await import("../../data/schema.ts");

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

function makeAgent(prefix, { join = null } = {}) {
  const agent = createAgent({ name: unique(prefix) });
  if (join) joinChannel(join, agent.id);
  return agent;
}

function setupTask() {
  const channel = createChannel({ name: unique("handoff-room") });
  const alice = makeAgent("alice", { join: channel.id });
  const bob = makeAgent("bob", { join: channel.id });
  const anchorResult = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "please ship the release notes",
  });
  assert.equal(anchorResult.held, false);
  const task = createTask({ messageId: anchorResult.message.id });
  return { channel, anchor: anchorResult.message, task, alice, bob };
}

function taskRow(task) {
  return globalThis.__workspliceDb.getTaskById(task.id);
}

test("candidate list excludes the secretary, the Owner, non-members, and soft-deleted agents", () => {
  const { channel, task, alice, bob } = setupTask();
  const outsider = makeAgent("outsider");
  const deleted = makeAgent("deleted", { join: channel.id });
  deleteAgent(deleted.id);

  const candidates = listHandoffCandidates({
    channelId: channel.id,
    taskId: task.id,
    secretaryId: secretary().id,
  });
  assert.deepEqual(
    candidates.map((member) => member.id).sort(),
    [alice.id, bob.id].sort(),
  );
  assert.equal(candidates.some((member) => member.id === outsider.id), false);
  assert.equal(candidates.some((member) => member.id === OWNER_MEMBER_ID), false);
  assert.equal(candidates.some((member) => member.id === secretary().id), false);
});

test("candidates are empty once the task is no longer handoff-eligible", () => {
  const { channel, task } = setupTask();
  assert.equal(
    claimTask({
      channelId: channel.id,
      taskNumber: task.number,
      memberId: makeAgent("claimant", { join: channel.id }).id,
    }).status,
    "claimed",
  );
  assert.deepEqual(
    listHandoffCandidates({
      channelId: channel.id,
      taskId: task.id,
      secretaryId: secretary().id,
    }),
    [],
  );
});

test("successful handoff writes owner + marker + thread notice in one transaction, then wakes only the chosen agent", () => {
  const { channel, anchor, task, alice } = setupTask();
  const wakes = [];
  const unsubscribe = subscribeWake((hint) => wakes.push(hint));
  try {
    const result = handoffTask({
      channelId: channel.id,
      taskNumber: task.number,
      secretaryId: secretary().id,
      assignee: `@${alice.name}`,
      baseSeq: globalThis.__workspliceDb.maxSeq(channel.id),
    });

    assert.equal(result.status, "handed_off");
    assert.equal(result.chosen.id, alice.id);
    const row = taskRow(task);
    assert.equal(row.status, "in_progress");
    assert.equal(row.owner_id, alice.id);
    assert.equal(row.owner_id === secretary().id, false, "自动路径不得把秘书写成 owner");
    assert.equal(row.handoff_state, "handed_off");
    assert.equal(row.handoff_seq, result.notice.seq);

    const thread = globalThis.__workspliceDb.listMessages(anchor.id);
    assert.equal(thread.length, 1);
    assert.equal(thread[0].id, result.notice.id);
    assert.equal(thread[0].author_id, secretary().id);
    assert.match(thread[0].content, new RegExp(alice.name));

    assert.deepEqual(
      wakes.map((hint) => ({
        agentId: hint.agentId,
        targetId: hint.targetId,
        seq: hint.seq,
        reason: hint.reason,
      })),
      [
        {
          agentId: alice.id,
          targetId: anchor.id,
          seq: result.notice.seq,
          reason: "message",
        },
      ],
      "提交后只定向唤醒 chosen，不广播",
    );
  } finally {
    unsubscribe();
  }
});

test("repeated handoff is a no-op: one owner, one notice, one wake", () => {
  const { channel, anchor, task, alice, bob } = setupTask();
  const wakes = [];
  const unsubscribe = subscribeWake((hint) => wakes.push(hint));
  try {
    const first = handoffTask({
      channelId: channel.id,
      taskNumber: task.number,
      secretaryId: secretary().id,
      assignee: alice.name,
    });
    assert.equal(first.status, "handed_off");
    const second = handoffTask({
      channelId: channel.id,
      taskNumber: task.number,
      secretaryId: secretary().id,
      assignee: bob.name,
    });
    assert.deepEqual(second, { status: "noop", reason: "already_handled" });

    assert.equal(globalThis.__workspliceDb.listMessages(anchor.id).length, 1);
    assert.equal(taskRow(task).owner_id, alice.id);
    assert.equal(wakes.length, 1);
  } finally {
    unsubscribe();
  }
});

test("a concurrent claim wins: handoff sees the task already owned and writes no notice", () => {
  const { channel, anchor, task, alice, bob } = setupTask();
  assert.equal(
    claimTask({
      channelId: channel.id,
      taskNumber: task.number,
      memberId: bob.id,
    }).status,
    "claimed",
  );
  const wakes = [];
  const unsubscribe = subscribeWake((hint) => wakes.push(hint));
  try {
    const result = handoffTask({
      channelId: channel.id,
      taskNumber: task.number,
      secretaryId: secretary().id,
      assignee: alice.name,
    });
    assert.equal(result.status, "noop");
    assert.equal(taskRow(task).owner_id, bob.id);
    assert.equal(taskRow(task).handoff_state, null);
    assert.equal(globalThis.__workspliceDb.listMessages(anchor.id).length, 0);
    assert.deepEqual(wakes, []);
  } finally {
    unsubscribe();
  }
});

test("notice delivery failure rolls back the claim, marker, and message together", () => {
  const { channel, anchor, task, alice } = setupTask();
  assert.throws(
    () =>
      handoffTask({
        channelId: channel.id,
        taskNumber: task.number,
        secretaryId: secretary().id,
        assignee: alice.name,
        deliverNotice: () => {
          throw new Error("simulated notice failure");
        },
      }),
    /simulated notice failure/,
  );

  const row = taskRow(task);
  assert.equal(row.status, "todo");
  assert.equal(row.owner_id, null);
  assert.equal(row.handoff_state, null);
  assert.equal(row.handoff_seq, null);
  assert.equal(globalThis.__workspliceDb.listMessages(anchor.id).length, 0);
});

test("the secretary can still claim a task normally when explicitly made the owner", () => {
  const { channel, task } = setupTask();
  const claim = claimTask({
    channelId: channel.id,
    taskNumber: task.number,
    memberId: secretary().id,
  });
  assert.equal(claim.status, "claimed");
  const row = taskRow(task);
  assert.equal(row.owner_id, secretary().id);
  assert.equal(row.status, "in_progress");
  assert.equal(row.handoff_state, null, "普通认领不是自动分流");
});

test("auto-handoff refuses to assign the secretary to itself", () => {
  const { channel, anchor, task } = setupTask();
  const result = handoffTask({
    channelId: channel.id,
    taskNumber: task.number,
    secretaryId: secretary().id,
    assignee: secretary().name,
  });
  assert.equal(result.status, "blocked");
  const row = taskRow(task);
  assert.equal(row.owner_id, null);
  assert.equal(row.status, "todo");
  assert.equal(row.handoff_state, "blocked");
  const thread = globalThis.__workspliceDb.listMessages(anchor.id);
  assert.equal(thread.length, 1);
  assert.match(thread[0].content, /secretary/i);
});

test("blocked handoff writes candidates + boundary + question and the marker in one transaction, without claiming or waking anyone", () => {
  const { channel, anchor, task, alice, bob } = setupTask();
  const wakes = [];
  const unsubscribe = subscribeWake((hint) => wakes.push(hint));
  try {
    const result = handoffTask({
      channelId: channel.id,
      taskNumber: task.number,
      secretaryId: secretary().id,
      assignee: null,
      question: "Which of you owns release notes?",
    });
    assert.equal(result.status, "blocked");
    const row = taskRow(task);
    assert.equal(row.status, "todo");
    assert.equal(row.owner_id, null);
    assert.equal(row.handoff_state, "blocked");
    assert.equal(row.handoff_seq, result.notice.seq);

    const thread = globalThis.__workspliceDb.listMessages(anchor.id);
    assert.equal(thread.length, 1);
    assert.match(thread[0].content, new RegExp(alice.name));
    assert.match(thread[0].content, new RegExp(bob.name));
    assert.match(thread[0].content, /no assignee was selected/i);
    assert.match(thread[0].content, /Which of you owns release notes\?/);
    assert.deepEqual(wakes, []);

    const repeated = handoffTask({
      channelId: channel.id,
      taskNumber: task.number,
      secretaryId: secretary().id,
      assignee: alice.name,
    });
    assert.deepEqual(repeated, { status: "noop", reason: "already_handled" });
    assert.equal(globalThis.__workspliceDb.listMessages(anchor.id).length, 1);
    assert.equal(taskRow(task).owner_id, null);
  } finally {
    unsubscribe();
  }
});

test("blocked notice delivery failure rolls back the marker and leaves no partial notice", () => {
  const { channel, anchor, task } = setupTask();
  assert.throws(
    () =>
      handoffTask({
        channelId: channel.id,
        taskNumber: task.number,
        secretaryId: secretary().id,
        assignee: null,
        deliverNotice: () => {
          throw new Error("simulated blocked notice failure");
        },
      }),
    /simulated blocked notice failure/,
  );
  const row = taskRow(task);
  assert.equal(row.status, "todo");
  assert.equal(row.owner_id, null);
  assert.equal(row.handoff_state, null);
  assert.equal(row.handoff_seq, null);
  assert.equal(globalThis.__workspliceDb.listMessages(anchor.id).length, 0);
});
