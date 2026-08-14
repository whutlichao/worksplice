import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../../data/sqlite.ts";
import { OWNER_MEMBER_ID } from "../../data/schema.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-obs-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createChannel, joinChannel } = await import("./channels.ts");
const { createAgent } = await import("./members.ts");
const { sendMessage } = await import("./messages.ts");
const { createTask, claimTask } = await import("./tasks.ts");
const { listAgentTasks, buildAgentTimeline } = await import("./observability.ts");

function freshChannel() {
  return createChannel({ name: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
}

function freshChannelWith(memberIds) {
  const channel = freshChannel();
  for (const id of memberIds) joinChannel(channel.id, id);
  return channel;
}

test("listAgentTasks finds tasks the agent owns, authored, or posted progress in", () => {
  const bob = createAgent({ name: "bob" });
  const alice = createAgent({ name: "alice" });
  const channel = freshChannelWith([bob.id, alice.id]);

  // alice 创建任务（锚点作者），bob 认领（owner），bob 在 thread 发进展
  const anchor = sendMessage({ targetId: channel.id, authorId: alice.id, content: "build the thing" }).message;
  const task = createTask({ messageId: anchor.id });
  const claim = claimTask({ channelId: channel.id, taskNumber: task.number, memberId: bob.id });
  assert.equal(claim.status, "claimed");
  sendMessage({ targetId: anchor.id, authorId: bob.id, content: "on it" });

  const bobTasks = listAgentTasks(bob.id);
  assert.equal(bobTasks.length, 1);
  assert.equal(bobTasks[0].number, task.number);
  assert.equal(bobTasks[0].owner?.name, "bob");
  assert.equal(bobTasks[0].progressCount, 1);

  const aliceTasks = listAgentTasks(alice.id);
  assert.equal(aliceTasks.length, 1); // 锚点作者也算参与

  // 无关 agent 不参与
  const carol = createAgent({ name: "carol" });
  assert.equal(listAgentTasks(carol.id).length, 0);
});

test("listAgentTasks sorts by updated_at descending (most recent first)", () => {
  const bob = createAgent({ name: "bob" });
  const channel = freshChannelWith([bob.id]);

  const m1 = sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "task one" }).message;
  const t1 = createTask({ messageId: m1.id });
  claimTask({ channelId: channel.id, taskNumber: t1.number, memberId: bob.id });

  const m2 = sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "task two" }).message;
  const t2 = createTask({ messageId: m2.id });
  claimTask({ channelId: channel.id, taskNumber: t2.number, memberId: bob.id });

  const tasks = listAgentTasks(bob.id);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].number, t2.number); // 最近 claim 的在前
  assert.equal(tasks[1].number, t1.number);
});

// 回归（既有 flake 根因）：listTasksForAgent 的 ORDER BY updated_at DESC 在两条任务
// updated_at 同毫秒时无兜底次键 → 顺序不确定。确定性构造两个相同 updated_at 的任务行，
// 断言按 rowid 倒序（后插入在前）稳定排序——rowid DESC 即兜底次键契约。
test("listAgentTasks breaks updated_at ties by insertion order (rowid DESC)", () => {
  const bob = createAgent({ name: "bob-tie" });
  const channel = freshChannelWith([bob.id]);

  const m1 = sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "tie task one" }).message;
  const t1 = createTask({ messageId: m1.id });
  claimTask({ channelId: channel.id, taskNumber: t1.number, memberId: bob.id });

  const m2 = sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "tie task two" }).message;
  const t2 = createTask({ messageId: m2.id });
  claimTask({ channelId: channel.id, taskNumber: t2.number, memberId: bob.id });

  // 确定性复现同毫秒 tie：把两条任务 updated_at 强行置为同一值
  const sameAt = "2026-01-01T00:00:00.000Z";
  globalThis.__workspliceDb.updateTask(t1.id, { updatedAt: sameAt });
  globalThis.__workspliceDb.updateTask(t2.id, { updatedAt: sameAt });

  const tasks = listAgentTasks(bob.id);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].number, t2.number); // 同时间点下，后插入（高 rowid）的在前
  assert.equal(tasks[1].number, t1.number);
});

test("buildAgentTimeline merges the agent's messages and task state points", () => {
  const bob = createAgent({ name: "bob" });
  const channel = freshChannelWith([bob.id]);

  const anchor = sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "please fix the bug" }).message;
  const task = createTask({ messageId: anchor.id });
  claimTask({ channelId: channel.id, taskNumber: task.number, memberId: bob.id });
  const threadReply = sendMessage({ targetId: anchor.id, authorId: bob.id, content: "root cause found, fixing" }).message;
  const topLevel = sendMessage({ targetId: channel.id, authorId: bob.id, content: "also checking the docs" }).message;

  const timeline = buildAgentTimeline(bob.id);
  assert.ok(timeline.length >= 3);

  const taskPoint = timeline.find((e) => e.kind === "task" && e.number === task.number);
  assert.equal(taskPoint.status, "in_progress");
  assert.equal(taskPoint.ownerName, "bob");

  const progress = timeline.find((e) => e.kind === "message" && e.id === threadReply.id);
  assert.equal(progress.inTaskThread, true);
  assert.equal(progress.taskNumber, task.number);
  assert.equal(progress.anchorId, anchor.id);
  assert.equal(progress.channelName, channel.name);

  const top = timeline.find((e) => e.kind === "message" && e.id === topLevel.id);
  assert.equal(top.inTaskThread, false);
  assert.equal(top.taskNumber, null);
  assert.equal(top.anchorId, null);
});

test("buildAgentTimeline respects the limit", () => {
  const bob = createAgent({ name: "bob" });
  const channel = freshChannelWith([bob.id]);
  for (let i = 0; i < 5; i++) {
    sendMessage({ targetId: channel.id, authorId: bob.id, content: `msg ${i}` });
  }
  assert.equal(buildAgentTimeline(bob.id, 3).length, 3);
});
