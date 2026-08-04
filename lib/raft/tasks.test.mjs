import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/db.ts";
import { OWNER_MEMBER_ID } from "../data/schema.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-tasks-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createChannel, joinChannel } = await import("./channels.ts");
const { createAgent } = await import("./members.ts");
const { sendMessage } = await import("./messages.ts");
const { createTask, claimTask, updateTaskStatus, listChannelTasks, getTaskView } = await import(
  "./tasks.ts"
);

function sendAsOwner(targetId, content) {
  const result = sendMessage({ targetId, authorId: OWNER_MEMBER_ID, content });
  assert.equal(result.held, false);
  return result.message;
}

function setup({ channelName = "task-room" } = {}) {
  const channel = createChannel({ name: channelName });
  const alice = createAgent({ name: "alice", workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), "ws-tasks-")) });
  const bob = createAgent({ name: "bob", workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), "ws-tasks-")) });
  joinChannel(channel.id, alice.id);
  joinChannel(channel.id, bob.id);
  return { channel, alice, bob };
}

// ---------------------------------------------------------------------------
// createTask：三途径共用；顶层消息可转、thread 内不可、不可重复转
// ---------------------------------------------------------------------------

test("createTask wraps a top-level message; numbers increment per channel", () => {
  const { channel } = setup();
  const m1 = sendAsOwner(channel.id, "build the widget");
  const m2 = sendAsOwner(channel.id, "write the docs");

  const t1 = createTask({ messageId: m1.id });
  const t2 = createTask({ messageId: m2.id });

  assert.equal(t1.number, 1);
  assert.equal(t1.status, "todo");
  assert.equal(t1.owner_id, null);
  assert.equal(t2.number, 2);
  assert.equal(t1.channelId, channel.id);
  assert.equal(t1.anchor.id, m1.id);
});

test("task numbers restart per channel", () => {
  const { channel } = setup({ channelName: "first" });
  const other = createChannel({ name: "second" });
  const m1 = sendAsOwner(channel.id, "a");
  const m2 = sendAsOwner(other.id, "b");

  const t1 = createTask({ messageId: m1.id });
  const t2 = createTask({ messageId: m2.id });

  assert.equal(t1.number, 1);
  assert.equal(t2.number, 1);
});

test("thread messages cannot become tasks", () => {
  const { channel } = setup();
  const anchor = sendAsOwner(channel.id, "anchor");
  const reply = sendAsOwner(anchor.id, "thread reply");

  assert.throws(() => createTask({ messageId: reply.id }), /thread|top-level/i);
  assert.equal(listChannelTasks(channel.id).length, 0);
});

test("a message can only become a task once", () => {
  const { channel } = setup();
  const m = sendAsOwner(channel.id, "unique");
  createTask({ messageId: m.id });
  assert.throws(() => createTask({ messageId: m.id }), /already/i);
  assert.equal(listChannelTasks(channel.id).length, 1);
});

test("unknown messages cannot become tasks", () => {
  assert.throws(() => createTask({ messageId: "nope" }), /not found/i);
});

test("listChannelTasks only includes tasks anchored in the channel", () => {
  const { channel } = setup({ channelName: "scoped" });
  const other = createChannel({ name: "other" });
  const m1 = sendAsOwner(channel.id, "in scope");
  const m2 = sendAsOwner(other.id, "out of scope");
  createTask({ messageId: m1.id });
  createTask({ messageId: m2.id });

  const tasks = listChannelTasks(channel.id);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].number, 1);
  assert.equal(tasks[0].anchor.content, "in scope");
});

// ---------------------------------------------------------------------------
// claim：todo → in_progress；一人认领；并发保护（freshness-hold）
// ---------------------------------------------------------------------------

test("claim assigns the owner and moves todo → in_progress", () => {
  const { channel, alice } = setup();
  const t = createTask({ messageId: sendAsOwner(channel.id, "work for me").id });

  const result = claimTask({ channelId: channel.id, taskNumber: t.number, memberId: alice.id });
  assert.equal(result.status, "claimed");
  assert.equal(result.task.owner_id, alice.id);
  assert.equal(result.task.status, "in_progress");
});

test("claiming an already claimed task conflicts and changes nothing", () => {
  const { channel, alice, bob } = setup();
  const t = createTask({ messageId: sendAsOwner(channel.id, "work for me").id });
  claimTask({ channelId: channel.id, taskNumber: t.number, memberId: alice.id });

  const result = claimTask({ channelId: channel.id, taskNumber: t.number, memberId: bob.id });
  assert.equal(result.status, "conflict");
  assert.equal(result.task, undefined);
  assert.equal(globalThis.__workspliceDb.getTaskById(t.id).owner_id, alice.id);
  assert.equal(globalThis.__workspliceDb.getTaskById(t.id).status, "in_progress");
});

test("claim with a stale baseSeq is held and writes nothing", () => {
  const { channel, alice } = setup();
  const t = createTask({ messageId: sendAsOwner(channel.id, "race me").id });
  sendAsOwner(channel.id, "something else lands");

  const result = claimTask({ channelId: channel.id, taskNumber: t.number, memberId: alice.id, baseSeq: 1 });
  assert.equal(result.status, "held");
  assert.ok(result.whatHappened.length > 0);
  assert.equal(globalThis.__workspliceDb.getTaskById(t.id).owner_id, null);

  const fresh = claimTask({ channelId: channel.id, taskNumber: t.number, memberId: alice.id, baseSeq: 2 });
  assert.equal(fresh.status, "claimed");
});

test("claiming requires channel membership", () => {
  const { channel } = setup();
  const outsider = createAgent({ name: "outsider", workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), "ws-tasks-")) });
  const t = createTask({ messageId: sendAsOwner(channel.id, "gated").id });
  assert.throws(
    () => claimTask({ channelId: channel.id, taskNumber: t.number, memberId: outsider.id }),
    /not a member/i,
  );
});

// ---------------------------------------------------------------------------
// updateTaskStatus：状态机只允许合法转移 + 互审（构建者不验证）
// ---------------------------------------------------------------------------

test("complete moves in_progress → in_review (owner only)", () => {
  const { channel, alice, bob } = setup();
  const t = createTask({ messageId: sendAsOwner(channel.id, "work for me").id });
  claimTask({ channelId: channel.id, taskNumber: t.number, memberId: alice.id });

  assert.throws(
    () => updateTaskStatus({ channelId: channel.id, taskNumber: t.number, status: "in_review", memberId: bob.id }),
    /owner/i,
  );
  const result = updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "in_review",
    memberId: alice.id,
  });
  assert.equal(result.status, "updated");
  assert.equal(result.task.status, "in_review");
  assert.equal(result.task.owner_id, alice.id);
});

test("approve moves in_review → done; the builder cannot verify their own work", () => {
  const { channel, alice, bob } = setup();
  const t = createTask({ messageId: sendAsOwner(channel.id, "build me").id });
  claimTask({ channelId: channel.id, taskNumber: t.number, memberId: alice.id });
  updateTaskStatus({ channelId: channel.id, taskNumber: t.number, status: "in_review", memberId: alice.id });

  assert.throws(
    () => updateTaskStatus({ channelId: channel.id, taskNumber: t.number, status: "done", memberId: alice.id }),
    /verify|owner|builder/i,
  );
  const result = updateTaskStatus({ channelId: channel.id, taskNumber: t.number, status: "done", memberId: bob.id });
  assert.equal(result.status, "updated");
  assert.equal(result.task.status, "done");
});

test("reject sends in_review back to in_progress (reviewer ≠ builder)", () => {
  const { channel, alice, bob } = setup();
  const t = createTask({ messageId: sendAsOwner(channel.id, "needs polish").id });
  claimTask({ channelId: channel.id, taskNumber: t.number, memberId: alice.id });
  updateTaskStatus({ channelId: channel.id, taskNumber: t.number, status: "in_review", memberId: alice.id });

  const result = updateTaskStatus({ channelId: channel.id, taskNumber: t.number, status: "in_progress", memberId: bob.id });
  assert.equal(result.status, "updated");
  assert.equal(result.task.status, "in_progress");
  assert.equal(result.task.owner_id, alice.id, "reject keeps the owner");
});

test("unclaim releases the task back to the pool (owner cleared)", () => {
  const { channel, alice, bob } = setup();
  const t = createTask({ messageId: sendAsOwner(channel.id, "too busy").id });
  claimTask({ channelId: channel.id, taskNumber: t.number, memberId: alice.id });

  assert.throws(
    () => updateTaskStatus({ channelId: channel.id, taskNumber: t.number, status: "todo", memberId: bob.id }),
    /owner/i,
  );
  const result = updateTaskStatus({ channelId: channel.id, taskNumber: t.number, status: "todo", memberId: alice.id });
  assert.equal(result.status, "updated");
  assert.equal(result.task.status, "todo");
  assert.equal(result.task.owner_id, null);
});

test("close cancels in_progress / in_review tasks; reopen returns done and closed tasks to the pool", () => {
  const { channel, alice, bob } = setup();
  const t1 = createTask({ messageId: sendAsOwner(channel.id, "cancel me").id });
  claimTask({ channelId: channel.id, taskNumber: t1.number, memberId: alice.id });
  const closed = updateTaskStatus({ channelId: channel.id, taskNumber: t1.number, status: "closed", memberId: bob.id });
  assert.equal(closed.status, "updated");
  assert.equal(closed.task.status, "closed");

  const reopened = updateTaskStatus({ channelId: channel.id, taskNumber: t1.number, status: "todo", memberId: bob.id });
  assert.equal(reopened.status, "updated");
  assert.equal(reopened.task.status, "todo");
  assert.equal(reopened.task.owner_id, null, "reopen returns the task to the pool");

  const t2 = createTask({ messageId: sendAsOwner(channel.id, "approve then reopen").id });
  claimTask({ channelId: channel.id, taskNumber: t2.number, memberId: alice.id });
  updateTaskStatus({ channelId: channel.id, taskNumber: t2.number, status: "in_review", memberId: alice.id });
  updateTaskStatus({ channelId: channel.id, taskNumber: t2.number, status: "done", memberId: bob.id });

  const redone = updateTaskStatus({ channelId: channel.id, taskNumber: t2.number, status: "todo", memberId: alice.id });
  assert.equal(redone.status, "updated");
  assert.equal(redone.task.status, "todo");
  assert.equal(redone.task.owner_id, null);
});

test("invalid transitions are rejected", () => {
  const { channel, alice, bob } = setup();
  const t = createTask({ messageId: sendAsOwner(channel.id, "stay put").id });

  assert.throws(
    () => updateTaskStatus({ channelId: channel.id, taskNumber: t.number, status: "done", memberId: bob.id }),
    /transition|invalid/i,
  );
  claimTask({ channelId: channel.id, taskNumber: t.number, memberId: alice.id });
  assert.throws(
    () => updateTaskStatus({ channelId: channel.id, taskNumber: t.number, status: "done", memberId: alice.id }),
    /transition|invalid/i,
  );
  updateTaskStatus({ channelId: channel.id, taskNumber: t.number, status: "in_review", memberId: alice.id });
  assert.throws(
    () => updateTaskStatus({ channelId: channel.id, taskNumber: t.number, status: "todo", memberId: bob.id }),
    /transition|invalid/i,
  );
});

test("updateTaskStatus with a stale baseSeq is held and writes nothing", () => {
  const { channel, alice } = setup();
  const t = createTask({ messageId: sendAsOwner(channel.id, "status race").id });
  claimTask({ channelId: channel.id, taskNumber: t.number, memberId: alice.id });
  sendAsOwner(channel.id, "room moves");

  const result = updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "in_review",
    memberId: alice.id,
    baseSeq: 1,
  });
  assert.equal(result.status, "held");
  assert.equal(globalThis.__workspliceDb.getTaskById(t.id).status, "in_progress");

  const fresh = updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "in_review",
    memberId: alice.id,
    baseSeq: 2,
  });
  assert.equal(fresh.status, "updated");
});

test("unknown tasks or channels throw", () => {
  const { channel } = setup();
  assert.throws(() => claimTask({ channelId: channel.id, taskNumber: 99, memberId: OWNER_MEMBER_ID }), /not found/i);
  assert.throws(
    () => updateTaskStatus({ channelId: channel.id, taskNumber: 99, status: "done", memberId: OWNER_MEMBER_ID }),
    /not found/i,
  );
  assert.throws(
    () => claimTask({ channelId: "nope", taskNumber: 1, memberId: OWNER_MEMBER_ID }),
    /not found/i,
  );
  assert.throws(() => getTaskView("nope"), /not found/i);
});

test("the human owner can claim and review like any channel member", () => {
  const { channel, alice } = setup();
  const t = createTask({ messageId: sendAsOwner(channel.id, "human touches").id });

  const claimed = claimTask({ channelId: channel.id, taskNumber: t.number, memberId: OWNER_MEMBER_ID });
  assert.equal(claimed.status, "claimed");

  // 人完成任务后仍受互审约束：不能自己 approve
  updateTaskStatus({ channelId: channel.id, taskNumber: t.number, status: "in_review", memberId: OWNER_MEMBER_ID });
  assert.throws(
    () => updateTaskStatus({ channelId: channel.id, taskNumber: t.number, status: "done", memberId: OWNER_MEMBER_ID }),
    /verify|owner|builder/i,
  );
  const approved = updateTaskStatus({ channelId: channel.id, taskNumber: t.number, status: "done", memberId: alice.id });
  assert.equal(approved.status, "updated");
});
