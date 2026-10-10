import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../../data/sqlite.ts";
import { OWNER_MEMBER_ID } from "../../data/schema.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-tasks-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createChannel, joinChannel } = await import("./channels.ts");
const { createAgent } = await import("./members.ts");
const { sendMessage, listMessages } = await import("./messages.ts");
const { subscribeWake } = await import("./wake.ts");
const {
  createTask,
  claimTask,
  updateTaskStatus,
  listChannelTasks,
  getTaskView,
  reachableStatuses,
  markTaskThreadRead,
} = await import("./tasks.ts");

/** wake hint 收集（协作域唯一发 seam，`emitWake` 的可观测形态）。 */
const wakeHints = [];
const unsubscribeWake = subscribeWake((hint) => wakeHints.push(hint));
test.after(() => unsubscribeWake());

function sendAsOwner(targetId, content) {
  const result = sendMessage({ targetId, authorId: OWNER_MEMBER_ID, content });
  assert.equal(result.held, false);
  return result.message;
}

/** 房间当前版本（claim/updateStatus 的 baseSeq 比对对象）。测试不硬编码 seq：
    `createTask` 成功后还会落一条任务创建事件消息，房间版本因此 +1。 */
function roomSeq(channelId) {
  return globalThis.__workspliceDb.maxSeq(channelId);
}

function setup({ channelName = "task-room" } = {}) {
  const channel = createChannel({ name: channelName });
  // 名字唯一性（agent-name-uniqueness）：同一 DB 内每轮 setup 用唯一后缀避免重名拒绝
  const seq = ++fixtureSeq;
  const alice = createAgent({
    name: `alice-${seq}`,
    workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), "ws-tasks-")),
  });
  const bob = createAgent({
    name: `bob-${seq}`,
    workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), "ws-tasks-")),
  });
  joinChannel(channel.id, alice.id);
  joinChannel(channel.id, bob.id);
  return { channel, alice, bob };
}

let fixtureSeq = 0;

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
  const t = createTask({
    messageId: sendAsOwner(channel.id, "work for me").id,
  });

  const result = claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: alice.id,
  });
  assert.equal(result.status, "claimed");
  assert.equal(result.task.owner_id, alice.id);
  assert.equal(result.task.status, "in_progress");
});

test("claiming an already claimed task conflicts and changes nothing", () => {
  const { channel, alice, bob } = setup();
  const t = createTask({
    messageId: sendAsOwner(channel.id, "work for me").id,
  });
  claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: alice.id,
  });

  const result = claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: bob.id,
  });
  assert.equal(result.status, "conflict");
  assert.equal(result.task, undefined);
  assert.equal(globalThis.__workspliceDb.getTaskById(t.id).owner_id, alice.id);
  assert.equal(
    globalThis.__workspliceDb.getTaskById(t.id).status,
    "in_progress",
  );
});

test("claim with a stale baseSeq is held and writes nothing", () => {
  const { channel, alice } = setup();
  const t = createTask({ messageId: sendAsOwner(channel.id, "race me").id });
  sendAsOwner(channel.id, "something else lands");

  const result = claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: alice.id,
    baseSeq: 1,
  });
  assert.equal(result.status, "held");
  assert.ok(result.whatHappened.length > 0);
  assert.equal(globalThis.__workspliceDb.getTaskById(t.id).owner_id, null);

  const fresh = claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: alice.id,
    baseSeq: roomSeq(channel.id),
  });
  assert.equal(fresh.status, "claimed");
});

test("claiming requires channel membership", () => {
  const { channel } = setup();
  const outsider = createAgent({
    name: "outsider",
    workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), "ws-tasks-")),
  });
  const t = createTask({ messageId: sendAsOwner(channel.id, "gated").id });
  assert.throws(
    () =>
      claimTask({
        channelId: channel.id,
        taskNumber: t.number,
        memberId: outsider.id,
      }),
    /not a member/i,
  );
});

// ---------------------------------------------------------------------------
// updateTaskStatus：状态机只允许合法转移 + 互审（构建者不验证）
// ---------------------------------------------------------------------------

test("complete moves in_progress → in_review (owner only)", () => {
  const { channel, alice, bob } = setup();
  const t = createTask({
    messageId: sendAsOwner(channel.id, "work for me").id,
  });
  claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: alice.id,
  });

  assert.throws(
    () =>
      updateTaskStatus({
        channelId: channel.id,
        taskNumber: t.number,
        status: "in_review",
        memberId: bob.id,
      }),
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
  claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: alice.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "in_review",
    memberId: alice.id,
  });

  assert.throws(
    () =>
      updateTaskStatus({
        channelId: channel.id,
        taskNumber: t.number,
        status: "done",
        memberId: alice.id,
      }),
    /verify|owner|builder/i,
  );
  const result = updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "done",
    memberId: bob.id,
  });
  assert.equal(result.status, "updated");
  assert.equal(result.task.status, "done");
});

test("reject sends in_review back to in_progress (reviewer ≠ builder)", () => {
  const { channel, alice, bob } = setup();
  const t = createTask({
    messageId: sendAsOwner(channel.id, "needs polish").id,
  });
  claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: alice.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "in_review",
    memberId: alice.id,
  });

  const result = updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "in_progress",
    memberId: bob.id,
  });
  assert.equal(result.status, "updated");
  assert.equal(result.task.status, "in_progress");
  assert.equal(result.task.owner_id, alice.id, "reject keeps the owner");
});

test("unclaim releases the task back to the pool (owner cleared)", () => {
  const { channel, alice, bob } = setup();
  const t = createTask({ messageId: sendAsOwner(channel.id, "too busy").id });
  claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: alice.id,
  });

  assert.throws(
    () =>
      updateTaskStatus({
        channelId: channel.id,
        taskNumber: t.number,
        status: "todo",
        memberId: bob.id,
      }),
    /owner/i,
  );
  const result = updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "todo",
    memberId: alice.id,
  });
  assert.equal(result.status, "updated");
  assert.equal(result.task.status, "todo");
  assert.equal(result.task.owner_id, null);
});

test("close cancels in_progress / in_review tasks; reopen returns done and closed tasks to the pool", () => {
  const { channel, alice, bob } = setup();
  const t1 = createTask({ messageId: sendAsOwner(channel.id, "cancel me").id });
  claimTask({
    channelId: channel.id,
    taskNumber: t1.number,
    memberId: alice.id,
  });
  const closed = updateTaskStatus({
    channelId: channel.id,
    taskNumber: t1.number,
    status: "closed",
    memberId: bob.id,
  });
  assert.equal(closed.status, "updated");
  assert.equal(closed.task.status, "closed");

  const reopened = updateTaskStatus({
    channelId: channel.id,
    taskNumber: t1.number,
    status: "todo",
    memberId: bob.id,
  });
  assert.equal(reopened.status, "updated");
  assert.equal(reopened.task.status, "todo");
  assert.equal(
    reopened.task.owner_id,
    null,
    "reopen returns the task to the pool",
  );

  const t2 = createTask({
    messageId: sendAsOwner(channel.id, "approve then reopen").id,
  });
  claimTask({
    channelId: channel.id,
    taskNumber: t2.number,
    memberId: alice.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t2.number,
    status: "in_review",
    memberId: alice.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t2.number,
    status: "done",
    memberId: bob.id,
  });

  const redone = updateTaskStatus({
    channelId: channel.id,
    taskNumber: t2.number,
    status: "todo",
    memberId: alice.id,
  });
  assert.equal(redone.status, "updated");
  assert.equal(redone.task.status, "todo");
  assert.equal(redone.task.owner_id, null);
});

// ---------------------------------------------------------------------------
// 重开封锁（§3.7）：reopen 置标记 → agent 不可自动认领（blocked）；
// 人类（Owner）认领即接管并清标；再次重开再次封锁
// ---------------------------------------------------------------------------

test("reopen sets the reopened marker; agents are blocked from claiming it", () => {
  const { channel, alice, bob } = setup();
  const t = createTask({ messageId: sendAsOwner(channel.id, "rework me").id });
  claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: alice.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "in_review",
    memberId: alice.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "done",
    memberId: bob.id,
  });

  const reopened = updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "todo",
    memberId: bob.id,
  });
  assert.equal(reopened.status, "updated");
  assert.equal(reopened.task.reopened, 1);
  assert.equal(reopened.task.owner_id, null);

  const agentClaim = claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: alice.id,
  });
  assert.equal(agentClaim.status, "blocked");
  assert.match(agentClaim.reason, /reopened/i);
  assert.equal(globalThis.__workspliceDb.getTaskById(t.id).owner_id, null);
  assert.equal(globalThis.__workspliceDb.getTaskById(t.id).status, "todo");
});

test("the owner claim takes over a reopened task and clears the marker", () => {
  const { channel, alice, bob } = setup();
  const t = createTask({ messageId: sendAsOwner(channel.id, "triage me").id });
  claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: alice.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "in_review",
    memberId: alice.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "done",
    memberId: bob.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "todo",
    memberId: bob.id,
  });

  const ownerClaim = claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: OWNER_MEMBER_ID,
  });
  assert.equal(ownerClaim.status, "claimed");
  assert.equal(ownerClaim.task.owner_id, OWNER_MEMBER_ID);
  assert.equal(ownerClaim.task.reopened, 0);

  const unclaim = updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "todo",
    memberId: OWNER_MEMBER_ID,
  });
  assert.equal(unclaim.status, "updated");
  assert.equal(unclaim.task.owner_id, null);
  assert.equal(unclaim.task.reopened, 0);

  const agentClaim = claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: alice.id,
  });
  assert.equal(
    agentClaim.status,
    "claimed",
    "after the owner's takeover, agents can claim again",
  );
});

test("a second reopen blocks agents again", () => {
  const { channel, alice, bob } = setup();
  const t = createTask({ messageId: sendAsOwner(channel.id, "cycle me").id });
  claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: alice.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "in_review",
    memberId: alice.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "done",
    memberId: bob.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "todo",
    memberId: bob.id,
  });
  claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: OWNER_MEMBER_ID,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "todo",
    memberId: OWNER_MEMBER_ID,
  });
  claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: alice.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "in_review",
    memberId: alice.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "done",
    memberId: bob.id,
  });

  const reopened = updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "todo",
    memberId: alice.id,
  });
  assert.equal(reopened.task.reopened, 1);
  const agentClaim = claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: bob.id,
  });
  assert.equal(agentClaim.status, "blocked");
});

test("unclaim and reject do not set the reopened marker", () => {
  const { channel, alice, bob } = setup();
  const t = createTask({ messageId: sendAsOwner(channel.id, "plain pool").id });
  claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: alice.id,
  });

  const unclaimed = updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "todo",
    memberId: alice.id,
  });
  assert.equal(unclaimed.task.reopened, 0);
  assert.equal(
    claimTask({ channelId: channel.id, taskNumber: t.number, memberId: bob.id })
      .status,
    "claimed",
  );

  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "in_review",
    memberId: bob.id,
  });
  const rejected = updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "in_progress",
    memberId: alice.id,
  });
  assert.equal(rejected.task.reopened, 0);
  assert.equal(rejected.task.owner_id, bob.id);
});

test("invalid transitions are rejected", () => {
  const { channel, alice, bob } = setup();
  const t = createTask({ messageId: sendAsOwner(channel.id, "stay put").id });

  assert.throws(
    () =>
      updateTaskStatus({
        channelId: channel.id,
        taskNumber: t.number,
        status: "done",
        memberId: bob.id,
      }),
    /transition|invalid/i,
  );
  claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: alice.id,
  });
  assert.throws(
    () =>
      updateTaskStatus({
        channelId: channel.id,
        taskNumber: t.number,
        status: "done",
        memberId: alice.id,
      }),
    /transition|invalid/i,
  );
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "in_review",
    memberId: alice.id,
  });
  assert.throws(
    () =>
      updateTaskStatus({
        channelId: channel.id,
        taskNumber: t.number,
        status: "todo",
        memberId: bob.id,
      }),
    /transition|invalid/i,
  );
});

test("updateTaskStatus with a stale baseSeq is held and writes nothing", () => {
  const { channel, alice } = setup();
  const t = createTask({
    messageId: sendAsOwner(channel.id, "status race").id,
  });
  claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: alice.id,
  });
  sendAsOwner(channel.id, "room moves");

  const result = updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "in_review",
    memberId: alice.id,
    baseSeq: 1,
  });
  assert.equal(result.status, "held");
  assert.equal(
    globalThis.__workspliceDb.getTaskById(t.id).status,
    "in_progress",
  );

  const fresh = updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "in_review",
    memberId: alice.id,
    baseSeq: roomSeq(channel.id),
  });
  assert.equal(fresh.status, "updated");
});

test("unknown tasks or channels throw", () => {
  const { channel } = setup();
  assert.throws(
    () =>
      claimTask({
        channelId: channel.id,
        taskNumber: 99,
        memberId: OWNER_MEMBER_ID,
      }),
    /not found/i,
  );
  assert.throws(
    () =>
      updateTaskStatus({
        channelId: channel.id,
        taskNumber: 99,
        status: "done",
        memberId: OWNER_MEMBER_ID,
      }),
    /not found/i,
  );
  assert.throws(
    () =>
      claimTask({
        channelId: "nope",
        taskNumber: 1,
        memberId: OWNER_MEMBER_ID,
      }),
    /not found/i,
  );
  assert.throws(() => getTaskView("nope"), /not found/i);
});

test("the human owner can claim and review like any channel member", () => {
  const { channel } = setup();
  const t = createTask({
    messageId: sendAsOwner(channel.id, "human touches").id,
  });

  const claimed = claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: OWNER_MEMBER_ID,
  });
  assert.equal(claimed.status, "claimed");

  // 人类 owner 豁免互审：可批准自己完成的任务（工作区唯一权威；agent 之间仍互审）
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "in_review",
    memberId: OWNER_MEMBER_ID,
  });
  const approvedBySelf = updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "done",
    memberId: OWNER_MEMBER_ID,
  });
  assert.equal(approvedBySelf.status, "updated");
  assert.equal(approvedBySelf.task.status, "done");
  assert.equal(
    approvedBySelf.task.owner_id,
    OWNER_MEMBER_ID,
    "approve keeps the owner",
  );
});

// ---------------------------------------------------------------------------
// claim 边（ADR-0002 拖拽路径）：todo → in_progress 由 reachable 合成，
// updateTaskStatus 必须接受该落点（看板拖拽 = 一次状态转移请求）
// ---------------------------------------------------------------------------

test("updateTaskStatus accepts the claim edge: todo → in_progress assigns the owner", () => {
  const { channel, alice, bob } = setup();
  const t = createTask({ messageId: sendAsOwner(channel.id, "drag me").id });

  const result = updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "in_progress",
    memberId: alice.id,
  });
  assert.equal(result.status, "updated");
  assert.equal(result.task.status, "in_progress");
  assert.equal(result.task.owner_id, alice.id, "拖拽认领 = 拖拽者成为 owner");
  assert.equal(result.task.reopened, 0);

  // 已认领后再拖入 in_progress → 拒绝（claim 语义：owner 唯一）
  assert.throws(
    () =>
      updateTaskStatus({
        channelId: channel.id,
        taskNumber: t.number,
        status: "in_progress",
        memberId: bob.id,
      }),
    /Invalid task transition|claim|owner/i,
  );
});

test("the claim edge via updateTaskStatus honors the reopened lock", () => {
  const { channel, alice, bob } = setup();
  const t = createTask({
    messageId: sendAsOwner(channel.id, "reopened drag").id,
  });
  claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: alice.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "in_review",
    memberId: alice.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "done",
    memberId: bob.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "todo",
    memberId: bob.id,
  });

  const reopened = getTaskView(t.id);
  assert.equal(reopened.reopened, 1);

  assert.throws(
    () =>
      updateTaskStatus({
        channelId: channel.id,
        taskNumber: t.number,
        status: "in_progress",
        memberId: alice.id,
      }),
    /reopened/i,
    "agent 拖拽认领重开任务被封锁",
  );
  const human = updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "in_progress",
    memberId: OWNER_MEMBER_ID,
  });
  assert.equal(human.status, "updated");
  assert.equal(human.task.owner_id, OWNER_MEMBER_ID);
  assert.equal(human.task.reopened, 0, "人类拖拽认领即清标");
});

// ---------------------------------------------------------------------------
// reachable（ADR-0002）：看板拖拽落点 = 状态机可达 + 身份授权；TaskView 携带（默认 actor = 人类 owner）
// ---------------------------------------------------------------------------

test("todo tasks expose the claim edge as reachable", () => {
  const { channel } = setup();
  const t = createTask({ messageId: sendAsOwner(channel.id, "pooled").id });

  assert.deepEqual(
    t.reachable,
    ["in_progress"],
    "默认 actor = owner，todo 的 claim 边可达",
  );
  assert.deepEqual(
    reachableStatuses(t, "anyone"),
    ["in_progress"],
    "未重开的 todo 任何成员都可认领",
  );
});

test("reopened todo tasks expose the claim edge only for the human owner", () => {
  const { channel, alice, bob } = setup();
  const t = createTask({
    messageId: sendAsOwner(channel.id, "reopened pool").id,
  });
  claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: alice.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "in_review",
    memberId: alice.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "done",
    memberId: bob.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "todo",
    memberId: bob.id,
  });

  const reopened = getTaskView(t.id);
  assert.equal(reopened.reopened, 1);
  assert.deepEqual(
    reopened.reachable,
    ["in_progress"],
    "人类 owner 认领即接管",
  );
  assert.deepEqual(
    reachableStatuses(reopened, alice.id),
    [],
    "agent 受重开封锁，无落点",
  );
});

test("reachable reflects owner-based authorization per status", () => {
  const { channel, alice, bob } = setup();
  const t = createTask({
    messageId: sendAsOwner(channel.id, "owner matters").id,
  });

  claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: alice.id,
  });
  const inProgress = getTaskView(t.id);
  assert.deepEqual(
    reachableStatuses(inProgress, alice.id),
    ["in_review", "todo", "closed"],
    "owner 可 complete/unclaim/close",
  );
  assert.deepEqual(
    reachableStatuses(inProgress, bob.id),
    ["closed"],
    "非 owner 只能 close",
  );
  assert.deepEqual(
    inProgress.reachable,
    ["closed"],
    "默认 actor = 人类 owner（非任务 owner）",
  );

  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "in_review",
    memberId: alice.id,
  });
  const inReview = getTaskView(t.id);
  assert.deepEqual(
    reachableStatuses(inReview, alice.id),
    ["closed"],
    "agent 构建者不能验证自己",
  );
  assert.deepEqual(
    reachableStatuses(inReview, bob.id),
    ["done", "in_progress", "closed"],
    "审者可 approve/reject/close",
  );
  assert.deepEqual(
    reachableStatuses(inReview, OWNER_MEMBER_ID),
    ["done", "in_progress", "closed"],
    "人类 owner 作为审者可 approve/reject 他人工作（含非任务 owner 身份）",
  );

  // 人类 owner 豁免互审：可 approve/reject 自己完成的任务；agent 不可
  const t2 = createTask({
    messageId: sendAsOwner(channel.id, "bob self work").id,
  });
  claimTask({ channelId: channel.id, taskNumber: t2.number, memberId: bob.id });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t2.number,
    status: "in_review",
    memberId: bob.id,
  });
  const bobReview = getTaskView(t2.id);
  assert.deepEqual(
    reachableStatuses(bobReview, OWNER_MEMBER_ID),
    ["done", "in_progress", "closed"],
    "人类 owner 对自己的 in_review 任务也可 approve/reject（豁免互审）",
  );
  assert.deepEqual(
    reachableStatuses(bobReview, bob.id),
    ["closed"],
    "agent 仍不可审核自己完成的任务（agent 间互审不变）",
  );
});

test("done and closed tasks expose the reopen edge as reachable", () => {
  const { channel, alice, bob } = setup();
  const t = createTask({ messageId: sendAsOwner(channel.id, "reopenable").id });
  claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: alice.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "in_review",
    memberId: alice.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "done",
    memberId: bob.id,
  });

  const done = getTaskView(t.id);
  assert.deepEqual(done.reachable, ["todo"], "done → todo = reopen");
});

// ---------------------------------------------------------------------------
// 任务创建事件消息（§3.7 可认领信号）：createTask 只落库时 agent 没有任何可 drain
// 的消息 → 认领链路（wake → drain → buildReplyPrompt 的 Related open tasks →
// agent 回 claim）整条断掉，任务永远躺在 todo。Convert to Task 右键途径正是这条
// 死路（board 途径先 sendMessage 才有消息可 drain，故只有它碰巧是好的）。
// ---------------------------------------------------------------------------

test("createTask posts an owner-signed event message so agents can wake and claim", () => {
  const { channel, alice, bob } = setup({ channelName: "task-event" });
  const anchor = sendAsOwner(channel.id, "ship the release notes");
  wakeHints.length = 0;

  const task = createTask({ messageId: anchor.id });

  const page = listMessages(channel.id);
  const event = page.messages[page.messages.length - 1];
  assert.notEqual(event.id, anchor.id, "创建任务后应有一条新消息，而不是只有锚点消息");
  assert.equal(event.author_id, OWNER_MEMBER_ID, "事件消息以 Owner 署名");
  assert.match(event.content, new RegExp(`Task #${task.number}\\b`));
  assert.match(event.content, /ship the release notes/, "带任务锚点消息的首行 preview");

  // wake 扇出到该 channel 的全部 agent 成员（作者 Owner 是人类，不含在内）
  const woken = wakeHints.filter((h) => h.targetId === channel.id).map((h) => h.agentId);
  assert.deepEqual(
    [...woken].sort(),
    [alice.id, bob.id].sort(),
    "事件消息要经 notifyMessageWakes 扇出全 channel agent（抢占认领的信号来源）",
  );
  assert.ok(
    wakeHints.every((h) => h.reason === "message"),
    "复用既有 message wake 链路（不新增 reason）",
  );
});

test("createTask 的事件消息在无 agent 的频道静默跳过（只落任务，不抛）", () => {
  const channel = createChannel({ name: "task-event-empty" });
  const anchor = sendAsOwner(channel.id, "nobody is listening");
  wakeHints.length = 0;

  const task = createTask({ messageId: anchor.id });

  // 消息仍落库（人类自己看得见），只是没有 agent 可唤醒
  const page = listMessages(channel.id);
  assert.equal(page.messages.length, 2);
  assert.deepEqual(wakeHints.filter((h) => h.targetId === channel.id), []);
  assert.equal(getTaskView(task.id).status, "todo");
});

test("Task discussion unread counts ignore Owner replies and stay independent per task", () => {
  const { channel, alice } = setup({ channelName: "task-thread-unread" });
  const anchorA = sendAsOwner(channel.id, "first discussion");
  const taskA = createTask({ messageId: anchorA.id });
  const anchorB = sendAsOwner(channel.id, "second discussion");
  const taskB = createTask({ messageId: anchorB.id });

  const replyA = sendMessage({
    targetId: anchorA.id,
    authorId: alice.id,
    content: "first agent reply",
  }).message;
  const ownerReplyA = sendAsOwner(anchorA.id, "owner reply does not advance task read");
  sendAsOwner(channel.id, "ordinary channel message does not affect task unread");
  sendMessage({
    targetId: anchorB.id,
    authorId: alice.id,
    content: "second agent reply",
  });

  assert.deepEqual(
    listChannelTasks(channel.id).map((task) => task.unreadReplyCount),
    [1, 1],
    "only non-Owner replies in each task thread count; Owner/channel/task-event messages do not",
  );

  const opened = markTaskThreadRead({
    taskId: taskA.id,
    throughSeq: ownerReplyA.seq,
  });
  assert.equal(opened.readSeq, replyA.seq, "Owner reply must not advance the Task cursor");
  assert.deepEqual(
    listChannelTasks(channel.id).map((task) => task.unreadReplyCount),
    [0, 1],
    "opening Task A clears only Task A",
  );
  assert.equal(getTaskView(taskB.id).unreadReplyCount, 1);
});

test("converting an existing ordinary thread to a Task starts with its history read", () => {
  const { channel, alice } = setup({ channelName: "ordinary-thread-to-task" });
  const anchor = sendAsOwner(channel.id, "becomes a task later");
  const oldReply = sendMessage({
    targetId: anchor.id,
    authorId: alice.id,
    content: "existing ordinary thread reply",
  }).message;
  sendAsOwner(anchor.id, "Owner reply is not a baseline reply");

  const task = createTask({ messageId: anchor.id });
  const baseline = globalThis.__workspliceDb.getTaskThreadRead(task.id);
  assert.equal(baseline.baseline_seq, oldReply.seq);
  assert.equal(baseline.read_seq, oldReply.seq);
  assert.equal(getTaskView(task.id).unreadReplyCount, 0);

  sendMessage({
    targetId: anchor.id,
    authorId: alice.id,
    content: "new reply after Task creation",
  });
  assert.equal(getTaskView(task.id).unreadReplyCount, 1);
});

test("Task views expose the latest unread reply timestamp without advancing its read cursor", () => {
  const { channel, alice } = setup({ channelName: "latest-task-reply" });
  const anchor = sendAsOwner(channel.id, "track latest activity");
  const task = createTask({ messageId: anchor.id });
  const initialRead = globalThis.__workspliceDb.getTaskThreadRead(task.id);
  const first = sendMessage({
    targetId: anchor.id,
    authorId: alice.id,
    content: "first unread reply",
  }).message;
  const latest = sendMessage({
    targetId: anchor.id,
    authorId: alice.id,
    content: "latest unread reply",
  }).message;
  sendAsOwner(anchor.id, "Owner reply is not unread activity");

  const listed = listChannelTasks(channel.id)[0];
  assert.equal(listed.unreadReplyCount, 2);
  assert.equal(listed.latestUnreadReplyAt, latest.created_at);
  assert.equal(globalThis.__workspliceDb.getTaskThreadRead(task.id).read_seq, initialRead.read_seq);
  assert.equal(getTaskView(task.id).latestUnreadReplyAt, latest.created_at);

  markTaskThreadRead({ taskId: task.id, throughSeq: latest.seq });
  const read = getTaskView(task.id);
  assert.equal(read.unreadReplyCount, 0);
  assert.equal(read.latestUnreadReplyAt, null);
  assert.ok(first.created_at <= latest.created_at);
});

test("non-Owner replies on done and closed Tasks become unread without changing status", () => {
  const { channel, alice } = setup({ channelName: "closed-task-discussions" });
  const done = createTask({
    messageId: sendAsOwner(channel.id, "done task").id,
  });
  const closed = createTask({
    messageId: sendAsOwner(channel.id, "closed task").id,
  });
  globalThis.__workspliceDb.updateTask(done.id, { status: "done" });
  globalThis.__workspliceDb.updateTask(closed.id, { status: "closed" });

  sendMessage({
    targetId: done.message_id,
    authorId: alice.id,
    content: "follow-up on done task",
  });
  sendMessage({
    targetId: closed.message_id,
    authorId: alice.id,
    content: "follow-up on closed task",
  });

  assert.deepEqual(
    [getTaskView(done.id), getTaskView(closed.id)].map((task) => [
      task.status,
      task.unreadReplyCount,
    ]),
    [
      ["done", 1],
      ["closed", 1],
    ],
  );
});
