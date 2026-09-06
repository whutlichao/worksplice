import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../../data/sqlite.ts";
import { OWNER_MEMBER_ID } from "../../data/schema.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-dm-features-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createDirectChannel, listChannelsWithMeta } = await import("./channels.ts");
const { createAgent } = await import("./members.ts");
const { sendMessage } = await import("./messages.ts");
const { createTask, claimTask, updateTaskStatus, listChannelTasks, getTaskView, reachableStatuses } = await import(
  "./tasks.ts"
);
const { scheduleReminder, fireReminder } = await import("./reminders.ts");
const { subscribeWake } = await import("./wake.ts");
const { searchMessages } = await import("./search.ts");
const { unreadCount, markChannelRead } = await import("./reads.ts");

let agentSeq = 0;
function setupDM(name) {
  const agent = createAgent({
    name: name ?? `dmf-${agentSeq++}`,
    workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), "ws-dmf-")),
  });
  const dm = createDirectChannel(agent.id);
  assert.ok(dm, "agent has a dm");
  return { agent, dm };
}

function send(targetId, authorId, content) {
  const result = sendMessage({ targetId, authorId, content });
  assert.equal(result.held, false);
  return result.message;
}

function collectWakes() {
  const hints = [];
  const unsub = subscribeWake((hint) => hints.push(hint));
  return { hints, unsub };
}

// ---------------------------------------------------------------------------
// 任务（票据 04.1）：DM 消息可转任务，number 按 DM 内独立递增
// ---------------------------------------------------------------------------

test("DM 消息可转任务，number 按 DM 内独立递增", () => {
  const { dm: dm1 } = setupDM();
  const { dm: dm2 } = setupDM();
  const m1 = send(dm1.id, OWNER_MEMBER_ID, "dm task one");
  const m2 = send(dm1.id, OWNER_MEMBER_ID, "dm task two");
  const other = send(dm2.id, OWNER_MEMBER_ID, "other dm task");

  const t1 = createTask({ messageId: m1.id });
  const t2 = createTask({ messageId: m2.id });
  const t3 = createTask({ messageId: other.id });

  assert.equal(t1.number, 1);
  assert.equal(t2.number, 2);
  assert.equal(t3.number, 1, "number 按 DM 内独立递增，跨 DM 互不影响");
  assert.equal(t1.channelId, dm1.id);
  assert.equal(t2.channelId, dm1.id);
  assert.equal(t3.channelId, dm2.id);
  assert.equal(listChannelTasks(dm1.id).length, 2);
  assert.equal(listChannelTasks(dm2.id).length, 1);
});

test("DM 线程内消息不可转任务（既有 thread 校验对 DM 顶层消息同样成立）", () => {
  const { dm } = setupDM();
  const anchor = send(dm.id, OWNER_MEMBER_ID, "dm anchor");
  const reply = send(anchor.id, OWNER_MEMBER_ID, "dm thread reply");
  assert.throws(() => createTask({ messageId: reply.id }), /thread|top-level/i);
  assert.equal(listChannelTasks(dm.id).length, 0);
});

// ---------------------------------------------------------------------------
// 任务状态机在 DM 内可用 + 互审特判（票据 04.2）：approve/reject 仅人类 Owner 可做
// ---------------------------------------------------------------------------

test("DM 任务状态机完整可用：claim→complete→approve 由 Owner 审", () => {
  const { dm, agent } = setupDM();
  const t = createTask({ messageId: send(dm.id, OWNER_MEMBER_ID, "build it").id });
  const claimed = claimTask({ channelId: dm.id, taskNumber: t.number, memberId: agent.id });
  assert.equal(claimed.status, "claimed");
  assert.equal(claimed.task.owner_id, agent.id);
  assert.equal(claimed.task.status, "in_progress");

  const inReview = updateTaskStatus({
    channelId: dm.id,
    taskNumber: t.number,
    status: "in_review",
    memberId: agent.id,
  });
  assert.equal(inReview.task.status, "in_review");

  const done = updateTaskStatus({
    channelId: dm.id,
    taskNumber: t.number,
    status: "done",
    memberId: OWNER_MEMBER_ID,
  });
  assert.equal(done.task.status, "done");
});

test("DM 互审特判：agent 建任务 complete→in_review 后 agent 不可自审，Owner 可 approve", () => {
  const { dm, agent } = setupDM();
  const t = createTask({ messageId: send(dm.id, OWNER_MEMBER_ID, "agent work").id });
  claimTask({ channelId: dm.id, taskNumber: t.number, memberId: agent.id });
  updateTaskStatus({ channelId: dm.id, taskNumber: t.number, status: "in_review", memberId: agent.id });

  assert.throws(
    () => updateTaskStatus({ channelId: dm.id, taskNumber: t.number, status: "done", memberId: agent.id }),
    /verify|owner|builder|DM|dm/i,
  );
  const done = updateTaskStatus({
    channelId: dm.id,
    taskNumber: t.number,
    status: "done",
    memberId: OWNER_MEMBER_ID,
  });
  assert.equal(done.task.status, "done");
});

test("DM 互审特判：Owner 建任务 complete→in_review 后 agent 不可 approve，Owner 自审（豁免）", () => {
  const { dm, agent } = setupDM();
  const t = createTask({ messageId: send(dm.id, OWNER_MEMBER_ID, "owner work").id });
  claimTask({ channelId: dm.id, taskNumber: t.number, memberId: OWNER_MEMBER_ID });
  updateTaskStatus({ channelId: dm.id, taskNumber: t.number, status: "in_review", memberId: OWNER_MEMBER_ID });

  // DM 特判：agent 永不当审核者（即便是 Owner 的任务）
  assert.throws(
    () => updateTaskStatus({ channelId: dm.id, taskNumber: t.number, status: "done", memberId: agent.id }),
    /verify|owner|builder|DM|dm/i,
  );
  // Owner 自审走人类豁免
  const done = updateTaskStatus({
    channelId: dm.id,
    taskNumber: t.number,
    status: "done",
    memberId: OWNER_MEMBER_ID,
  });
  assert.equal(done.task.status, "done");
});

test("DM 互审特判：reject 同理仅 Owner 可做", () => {
  const { dm, agent } = setupDM();
  const t = createTask({ messageId: send(dm.id, OWNER_MEMBER_ID, "needs polish").id });
  claimTask({ channelId: dm.id, taskNumber: t.number, memberId: agent.id });
  updateTaskStatus({ channelId: dm.id, taskNumber: t.number, status: "in_review", memberId: agent.id });

  assert.throws(
    () => updateTaskStatus({ channelId: dm.id, taskNumber: t.number, status: "in_progress", memberId: agent.id }),
    /verify|owner|builder|DM|dm/i,
  );
  const rejected = updateTaskStatus({
    channelId: dm.id,
    taskNumber: t.number,
    status: "in_progress",
    memberId: OWNER_MEMBER_ID,
  });
  assert.equal(rejected.task.status, "in_progress");
  assert.equal(rejected.task.owner_id, agent.id, "reject 保留 owner");
});

test("DM 互审特判反映在 reachable：in_review 时 agent 无 approve/reject 落点", () => {
  const { dm, agent } = setupDM();
  const t = createTask({ messageId: send(dm.id, OWNER_MEMBER_ID, "reachable dm").id });
  claimTask({ channelId: dm.id, taskNumber: t.number, memberId: agent.id });
  updateTaskStatus({ channelId: dm.id, taskNumber: t.number, status: "in_review", memberId: agent.id });

  const view = getTaskView(t.id);
  assert.deepEqual(reachableStatuses(view, agent.id), ["closed"], "DM 内 agent 无 approve/reject 落点");
  assert.deepEqual(
    reachableStatuses(view, OWNER_MEMBER_ID).sort(),
    ["closed", "done", "in_progress"].sort(),
    "Owner 保留 approve/reject/close 落点",
  );
});

// ---------------------------------------------------------------------------
// 提醒（票据 04.3）：可锚定 DM 消息，到点投递系统消息 + 唤醒作者
// ---------------------------------------------------------------------------

test("提醒可锚定 DM 消息，到点投递系统消息到 DM 主流程并唤醒 agent 作者", () => {
  const { dm, agent } = setupDM();
  const anchor = send(dm.id, OWNER_MEMBER_ID, "dm anchor message");
  const { hints, unsub } = collectWakes();

  const view = scheduleReminder({
    title: "dm reminder",
    fireAt: new Date(Date.now() - 10_000).toISOString(),
    authorId: agent.id,
    targetId: anchor.id,
  });
  assert.equal(view.channelId, dm.id, "锚定 DM 消息的提醒归属到 DM");

  const outcome = fireReminder(view.id);
  unsub();

  assert.equal(outcome.status, "fired");
  const sys = outcome.systemMessage;
  assert.ok(sys, "系统消息投递");
  assert.equal(sys.target_id, dm.id, "系统消息投递到 DM 主流程");
  assert.match(sys.content, /dm reminder/);
  assert.match(sys.content, new RegExp(`anchored on #${anchor.seq}`));

  const wakes = hints.filter((h) => h.reason === "reminder");
  assert.deepEqual(wakes.map((h) => h.agentId), [agent.id], "唤醒作者");
  assert.equal(wakes[0].targetId, dm.id);
  assert.equal(wakes[0].seq, sys.seq);
});

test("提醒锚定 DM 消息：Owner 作者到点只投系统消息不 wake（human = UI 通知）", () => {
  const { dm } = setupDM();
  const anchor = send(dm.id, OWNER_MEMBER_ID, "dm anchor message");
  const { hints, unsub } = collectWakes();

  const view = scheduleReminder({
    title: "owner dm note",
    fireAt: new Date(Date.now() - 10_000).toISOString(),
    authorId: OWNER_MEMBER_ID,
    targetId: anchor.id,
  });
  const outcome = fireReminder(view.id);
  unsub();

  assert.equal(outcome.status, "fired");
  assert.equal(outcome.systemMessage?.target_id, dm.id);
  assert.deepEqual(hints.filter((h) => h.reason === "reminder"), []);
});

test("DM 提醒作者成员校验：非 DM 成员不可在 DM 设提醒", () => {
  const { dm } = setupDM();
  const outsider = createAgent({
    name: `dmf-outsider-${agentSeq++}`,
    workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), "ws-dmf-")),
  });
  const anchor = send(dm.id, OWNER_MEMBER_ID, "dm anchor message");
  assert.throws(
    () =>
      scheduleReminder({
        title: "intruder",
        fireAt: new Date(Date.now() + 60_000).toISOString(),
        authorId: outsider.id,
        targetId: anchor.id,
      }),
    /member/i,
  );
});

// ---------------------------------------------------------------------------
// 搜索 / 未读（票据 04.4）：搜索命中 DM 消息、DM 计入未读
// ---------------------------------------------------------------------------

test("搜索命中 DM 消息，结果附 DM channel 归属", () => {
  const { dm } = setupDM();
  send(dm.id, OWNER_MEMBER_ID, "dm search keyword quantum-dm-token");
  const hits = searchMessages("quantum-dm-token");
  assert.equal(hits.length, 1);
  const hit = hits[0];
  assert.equal(hit.channel?.id, dm.id);
  assert.equal(hit.channel?.type, "dm");
  assert.equal(hit.inThread, false);
});

test("DM 计入未读：agent 消息未读、owner 自己的消息不算、markChannelRead 清零", () => {
  const { dm, agent } = setupDM();
  send(dm.id, agent.id, "agent says hi");
  assert.equal(unreadCount(dm.id), 1);

  send(dm.id, OWNER_MEMBER_ID, "owner replies");
  assert.equal(unreadCount(dm.id), 1, "owner 自己的消息不算未读");

  send(dm.id, agent.id, "agent again");
  assert.equal(unreadCount(dm.id), 2);

  markChannelRead(dm.id);
  assert.equal(unreadCount(dm.id), 0, "读后清零");
});

test("listChannelsWithMeta 对 DM 附未读数与成员数", () => {
  const { dm, agent } = setupDM();
  send(dm.id, agent.id, "unread dm message");
  const meta = listChannelsWithMeta(OWNER_MEMBER_ID);
  const row = meta.find((c) => c.id === dm.id);
  assert.ok(row, "DM 出现在侧栏 meta 列表");
  assert.equal(row.type, "dm");
  assert.equal(row.unread, 1);
  assert.equal(row.joined, true);
  assert.equal(row.memberCount, 2);
});
