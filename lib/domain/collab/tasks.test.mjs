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
const { setChannelChief, setGlobalChief } = await import("./chief.ts");
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
  transitionEdges,
} = await import("./tasks.ts");
const { TASK_EDGES, taskEdgesForReachable } = await import(
  "../../task-edges.ts"
);

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
  // #295：alice 在多数用例里承担“当前全局首席”这一任务状态权威；bob 保持普通 agent。
  // 纯粹测试“无秘书”语义的事件用例会显式清空全局首席。
  setGlobalChief(alice.id);
  return { channel, alice, bob };
}

let fixtureSeq = 0;

function makeGlobalChief(channelId) {
  const chief = createAgent({
    name: `task-status-chief-${++fixtureSeq}`,
    workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), "ws-tasks-chief-")),
  });
  joinChannel(channelId, chief.id);
  setGlobalChief(chief.id);
  return chief;
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
  const { channel, alice } = setup();
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
    memberId: OWNER_MEMBER_ID,
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

test("approve moves in_review → done; only a task status authority may review", () => {
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
        memberId: bob.id,
      }),
    /authorized|owner/i,
    "an ordinary agent cannot approve, even as a non-owner reviewer",
  );
  const result = updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "done",
    memberId: alice.id,
  });
  assert.equal(result.status, "updated");
  assert.equal(result.task.status, "done");
  assert.equal(result.task.owner_id, alice.id);
});

test("reject sends in_review back to in_progress", () => {
  const { channel, alice } = setup();
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
    memberId: OWNER_MEMBER_ID,
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
  const { channel, alice } = setup();
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
    memberId: alice.id,
  });
  assert.equal(closed.status, "updated");
  assert.equal(closed.task.status, "closed");

  const reopened = updateTaskStatus({
    channelId: channel.id,
    taskNumber: t1.number,
    status: "todo",
    memberId: alice.id,
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
    memberId: alice.id,
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

test("reopen sets the reopened marker; non-authority agents cannot claim it", () => {
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
    memberId: alice.id,
  });

  const reopened = updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "todo",
    memberId: alice.id,
  });
  assert.equal(reopened.status, "updated");
  assert.equal(reopened.task.reopened, 1);
  assert.equal(reopened.task.owner_id, null);

  assert.throws(
    () =>
      claimTask({
        channelId: channel.id,
        taskNumber: t.number,
        memberId: bob.id,
      }),
    /authorized|reopened/i,
  );
  assert.equal(globalThis.__workspliceDb.getTaskById(t.id).owner_id, null);
  assert.equal(globalThis.__workspliceDb.getTaskById(t.id).status, "todo");

  const authorityClaim = claimTask({
    channelId: channel.id,
    taskNumber: t.number,
    memberId: alice.id,
  });
  assert.equal(authorityClaim.status, "claimed");
  assert.equal(authorityClaim.task.reopened, 0);
});

test("the human owner can take over a reopened task and clear the marker", () => {
  const { channel, alice } = setup();
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
    memberId: alice.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "todo",
    memberId: alice.id,
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
  assert.equal(agentClaim.status, "claimed", "the global chief may claim again");
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
    memberId: alice.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "todo",
    memberId: alice.id,
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
    memberId: alice.id,
  });

  const reopened = updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "todo",
    memberId: alice.id,
  });
  assert.equal(reopened.task.reopened, 1);
  assert.throws(
    () =>
      claimTask({
        channelId: channel.id,
        taskNumber: t.number,
        memberId: bob.id,
      }),
    /authorized|reopened/i,
  );
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
  assert.throws(
    () =>
      claimTask({
        channelId: channel.id,
        taskNumber: t.number,
        memberId: bob.id,
      }),
    /authorized/i,
  );
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
  const rejected = updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "in_progress",
    memberId: OWNER_MEMBER_ID,
  });
  assert.equal(rejected.task.reopened, 0);
  assert.equal(rejected.task.owner_id, alice.id);
});

test("invalid transitions are rejected", () => {
  const { channel, alice } = setup();
  const t = createTask({ messageId: sendAsOwner(channel.id, "stay put").id });

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
        memberId: alice.id,
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
  const { channel, alice } = setup();
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
        memberId: alice.id,
      }),
    /Invalid task transition/i,
  );
});

test("the claim edge via updateTaskStatus honors task status authority", () => {
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
    memberId: alice.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "todo",
    memberId: alice.id,
  });

  const reopened = getTaskView(t.id);
  assert.equal(reopened.reopened, 1);

  assert.throws(
    () =>
      updateTaskStatus({
        channelId: channel.id,
        taskNumber: t.number,
        status: "in_progress",
        memberId: bob.id,
      }),
    /authorized/i,
    "an ordinary agent cannot drag-claim a reopened task",
  );
  const authority = updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "in_progress",
    memberId: alice.id,
  });
  assert.equal(authority.status, "updated");
  assert.equal(authority.task.owner_id, alice.id);
  assert.equal(authority.task.reopened, 0, "authority claim clears the marker");
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
    [],
    "non-authority actors have no reachable status",
  );
});

test("reopened todo tasks expose the claim edge only for task status authorities", () => {
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
    memberId: alice.id,
  });
  updateTaskStatus({
    channelId: channel.id,
    taskNumber: t.number,
    status: "todo",
    memberId: alice.id,
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
    ["in_progress"],
    "the current global chief may take over",
  );
  assert.deepEqual(
    reachableStatuses(reopened, bob.id),
    [],
    "ordinary agents have no reachable status",
  );
});

test("reachable reflects task status authority per status", () => {
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
    "the current global chief may complete/unclaim/close any owner's task",
  );
  assert.deepEqual(
    reachableStatuses(inProgress, bob.id),
    [],
    "an ordinary agent has no reachable task status",
  );
  assert.deepEqual(
    inProgress.reachable,
    ["in_review", "todo", "closed"],
    "the default actor is the human Owner",
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
    ["done", "in_progress", "closed"],
    "the current global chief may approve/reject even as owner",
  );
  assert.deepEqual(
    reachableStatuses(inReview, bob.id),
    [],
    "an ordinary reviewer still has no status write",
  );
  assert.deepEqual(
    reachableStatuses(inReview, OWNER_MEMBER_ID),
    ["done", "in_progress", "closed"],
    "the human Owner is a task status authority regardless of task owner",
  );
});

test("done and closed tasks expose the reopen edge as reachable", () => {
  const { channel, alice } = setup();
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
    memberId: alice.id,
  });

  const done = getTaskView(t.id);
  assert.deepEqual(done.reachable, ["todo"], "done → todo = reopen");
});

// ---------------------------------------------------------------------------
// 任务动作边表（#275）：卡片按钮 = 服务端 reachable 的投影；
// 边表与服务端 TRANSITIONS 的边集双向一致。服务端仍是可达性的唯一裁决者。
// ---------------------------------------------------------------------------

/**
 * 用真实 channel 的锚点构造矩阵行：`reachableStatuses` 的授权谓词只读
 * status / owner_id / reopened，互审分支还需 message_id 解析频道类型（非 DM）。
 */
function edgeMatrixRow({ messageId, status, ownerId, reopened }) {
  return {
    message_id: messageId,
    status,
    owner_id: ownerId,
    reopened,
  };
}

test("卡片动作与服务端 reachable 逐格相等（5 状态 × owner/非 owner × reopened 两档）", () => {
  const { channel, alice, bob } = setup();
  const anchor = sendAsOwner(channel.id, "edge matrix anchor");
  const statuses = ["todo", "in_progress", "in_review", "done", "closed"];
  const actors = [
    { label: "owner", actorId: alice.id },
    { label: "非 owner", actorId: bob.id },
  ];

  for (const status of statuses) {
    for (const actor of actors) {
      for (const reopened of [0, 1]) {
        const task = edgeMatrixRow({
          messageId: anchor.id,
          status,
          ownerId: alice.id,
          reopened,
        });
        const reachable = reachableStatuses(task, actor.actorId);
        const buttonTargets = taskEdgesForReachable(status, reachable).map(
          (edge) => edge.to,
        );
        assert.deepEqual(
          buttonTargets,
          reachable,
          `${status} / ${actor.label} / reopened=${reopened}：拖拽可达集合必须等于按钮可发起集合`,
        );
      }
    }
  }
});

test("动作边表与 TRANSITIONS 边集双向一致；claim 合成边显式声明为例外", () => {
  const CLAIM_SYNTHETIC_EDGE = "todo->in_progress";
  const transitionPairs = new Set(
    transitionEdges().map((edge) => `${edge.from}->${edge.to}`),
  );
  const tablePairs = new Set(
    TASK_EDGES.map((edge) => `${edge.from}->${edge.to}`),
  );

  // TRANSITIONS ⊆ 边表（服务端每条边都有卡片动作）∧ 边表 ⊆ TRANSITIONS（不多出边）；
  // claim 是 reachableStatuses 为独立 claimTask 合成的边，TRANSITIONS 里没有，显式例外。
  assert.deepEqual(
    [...tablePairs].sort(),
    [...transitionPairs, CLAIM_SYNTHETIC_EDGE].sort(),
    "边表 = TRANSITIONS 边集 + claim 合成边；多一条或少一条都必须红",
  );
  assert.ok(
    !transitionPairs.has(CLAIM_SYNTHETIC_EDGE),
    "claim 边不在 TRANSITIONS（独立操作，由 reachableStatuses 合成）",
  );
  assert.equal(transitionPairs.size, 8, "服务端 TRANSITIONS 当前有 8 条边");
  assert.equal(tablePairs.size, 9, "边表 = 8 条状态转移 + 1 条 claim 合成边");
});

// ---------------------------------------------------------------------------
// 任务创建事件消息（§3.7 可认领信号）：createTask 只落库时 agent 没有任何可 drain
// 的消息 → 认领链路（wake → drain → buildReplyPrompt 的 Related open tasks →
// agent 回 claim）整条断掉，任务永远躺在 todo。Convert to Task 右键途径正是这条
// 死路（board 途径先 sendMessage 才有消息可 drain，故只有它碰巧是好的）。
// ---------------------------------------------------------------------------

test("createTask posts an owner-signed event message; without a secretary it wakes no one (T2/#240)", () => {
  const { channel } = setup({ channelName: "task-event" });
  setGlobalChief(null);
  const anchor = sendAsOwner(channel.id, "ship the release notes");
  wakeHints.length = 0;

  const task = createTask({ messageId: anchor.id });

  const page = listMessages(channel.id);
  const event = page.messages[page.messages.length - 1];
  assert.notEqual(event.id, anchor.id, "创建任务后应有一条新消息，而不是只有锚点消息");
  assert.equal(event.author_id, OWNER_MEMBER_ID, "事件消息以 Owner 署名");
  assert.match(event.content, new RegExp(`Task #${task.number}\\b`));
  assert.match(event.content, /ship the release notes/, "带任务锚点消息的首行 preview");

  // T2/#240：任务创建事件只定向唤醒秘书；本 fixture 没有秘书 ⇒ 不扇出、不退回全体。
  const woken = wakeHints.filter((h) => h.targetId === channel.id).map((h) => h.agentId);
  assert.deepEqual(
    woken,
    [],
    "无秘书时任务创建事件不得广播给普通 agent",
  );
  assert.ok(
    wakeHints.every((h) => h.reason === "message"),
    "复用既有 message wake 链路（不新增 reason）",
  );
});

test("createTask 的事件消息在无 agent 的频道静默跳过（只落任务，不抛）", () => {
  const channel = createChannel({ name: "task-event-empty" });
  setGlobalChief(null);
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

/**
 * 总回复数口径（spec D1）：Task thread 内所有作者的回复——含 Owner、不含锚点、
 * 不受已读游标影响；与 `unreadReplyCount` 同行但相互独立。
 */
test("Task views expose the total reply count with Owner replies included, anchor excluded, and read state irrelevant", () => {
  const { channel, alice, bob } = setup({ channelName: "task-thread-total" });
  const anchor = sendAsOwner(channel.id, "count this discussion");
  const task = createTask({ messageId: anchor.id });

  assert.equal(getTaskView(task.id).totalReplyCount, 0, "a Task with no replies totals zero");

  const first = sendMessage({
    targetId: anchor.id,
    authorId: alice.id,
    content: "agent reply one",
  }).message;
  const ownerReply = sendAsOwner(anchor.id, "Owner reply counts toward the total");
  const latest = sendMessage({
    targetId: anchor.id,
    authorId: bob.id,
    content: "agent reply two",
  }).message;
  // 旁证：另一条顶层消息的普通 thread 与频道消息都不进入这个 Task 的总数。
  const otherAnchor = sendAsOwner(channel.id, "unrelated thread");
  sendAsOwner(otherAnchor.id, "unrelated thread reply");

  assert.equal(getTaskView(task.id).totalReplyCount, 3);
  assert.equal(listChannelTasks(channel.id)[0].totalReplyCount, 3);

  markTaskThreadRead({ taskId: task.id, throughSeq: latest.seq });
  const afterRead = getTaskView(task.id);
  assert.equal(afterRead.unreadReplyCount, 0, "reading clears unread replies");
  assert.equal(
    afterRead.totalReplyCount,
    3,
    "the total is independent of the Task read cursor",
  );
  assert.ok(first.seq < ownerReply.seq && ownerReply.seq < latest.seq);

  const listed = listChannelTasks(channel.id);
  assert.deepEqual(
    listed.map((view) => view.totalReplyCount),
    [3],
    "only the Task's own thread replies are counted",
  );
});

// ---------------------------------------------------------------------------
// 任务状态权威（#295）：人类 Owner 与当前全局首席；频道首席/普通 agent 一律无写权
// ---------------------------------------------------------------------------

test("ordinary agents and channel chiefs cannot claim or change task status", () => {
  const { channel, alice, bob } = setup({ channelName: "authority-denied" });
  setChannelChief(channel.id, bob.id);
  const chief = makeGlobalChief(channel.id);
  const task = createTask({
    messageId: sendAsOwner(channel.id, "protected task").id,
  });

  for (const actor of [alice, bob]) {
    assert.throws(
      () =>
        claimTask({
          channelId: channel.id,
          taskNumber: task.number,
          memberId: actor.id,
        }),
      /authorized|reserved|task status/i,
      `${actor.name} must not claim`,
    );
  }
  assert.equal(globalThis.__workspliceDb.getTaskById(task.id).status, "todo");
  assert.equal(globalThis.__workspliceDb.getTaskById(task.id).owner_id, null);

  globalThis.__workspliceDb.updateTask(task.id, {
    status: "in_progress",
    ownerId: alice.id,
  });
  for (const actor of [alice, bob]) {
    assert.throws(
      () =>
        updateTaskStatus({
          channelId: channel.id,
          taskNumber: task.number,
          status: "in_review",
          memberId: actor.id,
        }),
      /authorized|reserved|task status/i,
      `${actor.name} must not update status`,
    );
  }
  const row = globalThis.__workspliceDb.getTaskById(task.id);
  assert.equal(row.status, "in_progress");
  assert.equal(row.owner_id, alice.id);
  assert.equal(
    claimTask({
      channelId: channel.id,
      taskNumber: task.number,
      memberId: chief.id,
    }).status,
    "conflict",
    "the authority still cannot claim an already-owned task",
  );
});

test("the human Owner and current global chief manage any owner's task on legal edges", () => {
  const { channel, alice } = setup({ channelName: "authority-allowed" });
  const chief = makeGlobalChief(channel.id);
  const task = createTask({
    messageId: sendAsOwner(channel.id, "chief closes this out").id,
  });
  globalThis.__workspliceDb.updateTask(task.id, {
    status: "in_progress",
    ownerId: alice.id,
  });

  const reviewed = updateTaskStatus({
    channelId: channel.id,
    taskNumber: task.number,
    status: "in_review",
    memberId: chief.id,
  });
  assert.equal(reviewed.status, "updated");
  assert.equal(reviewed.task.status, "in_review");
  assert.equal(reviewed.task.owner_id, alice.id);

  const approved = updateTaskStatus({
    channelId: channel.id,
    taskNumber: task.number,
    status: "done",
    memberId: OWNER_MEMBER_ID,
  });
  assert.equal(approved.status, "updated");
  assert.equal(approved.task.status, "done");

  assert.throws(
    () =>
      updateTaskStatus({
        channelId: channel.id,
        taskNumber: task.number,
        status: "in_progress",
        memberId: chief.id,
      }),
    /transition|invalid/i,
    "authority does not invent edges in the state machine",
  );
});

test("reachable is empty for non-authority actors and authority-relative otherwise", () => {
  const { channel, alice, bob } = setup({ channelName: "authority-reachable" });
  setChannelChief(channel.id, bob.id);
  const chief = makeGlobalChief(channel.id);
  const task = createTask({
    messageId: sendAsOwner(channel.id, "reachable task").id,
  });
  globalThis.__workspliceDb.updateTask(task.id, {
    status: "in_progress",
    ownerId: alice.id,
  });
  const row = globalThis.__workspliceDb.getTaskById(task.id);

  assert.deepEqual(reachableStatuses(row, alice.id), []);
  assert.deepEqual(reachableStatuses(row, bob.id), []);
  assert.deepEqual(
    reachableStatuses(row, chief.id),
    ["in_review", "todo", "closed"],
  );
  assert.deepEqual(
    reachableStatuses(row, OWNER_MEMBER_ID),
    ["in_review", "todo", "closed"],
  );
});

test("reopened tasks remain blocked for non-authority agents but the authority may take over", () => {
  const { channel, alice } = setup({ channelName: "authority-reopened" });
  const chief = makeGlobalChief(channel.id);
  const task = createTask({
    messageId: sendAsOwner(channel.id, "reopened authority").id,
  });
  globalThis.__workspliceDb.updateTask(task.id, {
    status: "todo",
    reopened: 1,
  });

  assert.throws(
    () =>
      claimTask({
        channelId: channel.id,
        taskNumber: task.number,
        memberId: alice.id,
      }),
    /authorized|reserved|reopened/i,
  );
  const claimed = claimTask({
    channelId: channel.id,
    taskNumber: task.number,
    memberId: chief.id,
  });
  assert.equal(claimed.status, "claimed");
  assert.equal(claimed.task.reopened, 0);
  assert.equal(claimed.task.owner_id, chief.id);
});
