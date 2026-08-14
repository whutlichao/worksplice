import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/db.ts";
import { OWNER_MEMBER_ID } from "../data/schema.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-reminders-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createChannel, joinChannel, leaveChannel } = await import("./channels.ts");
const { createAgent } = await import("./members.ts");
const { sendMessage } = await import("./messages.ts");
const { subscribeWake } = await import("./wake.ts");
const {
  scheduleReminder,
  listReminders,
  snoozeReminder,
  updateReminder,
  cancelReminder,
  getReminderLog,
  fireReminder,
  fireDueReminders,
  ReminderNotFoundError,
  ReminderNotAuthorizedError,
} = await import("./reminders.ts");

function setup({ channelName = "reminder-room" } = {}) {
  const channel = createChannel({ name: channelName });
  const alice = createAgent({ name: "alice", workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), "ws-reminders-")) });
  const bob = createAgent({ name: "bob", workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), "ws-reminders-")) });
  joinChannel(channel.id, alice.id);
  joinChannel(channel.id, bob.id);
  const anchor = sendMessage({ targetId: channel.id, authorId: alice.id, content: "anchor message" });
  assert.equal(anchor.held, false);
  return { channel, alice, bob, anchor: anchor.message };
}

function iso(d) {
  return d.toISOString();
}

function collectWakes() {
  const hints = [];
  const unsub = subscribeWake((hint) => hints.push(hint));
  return { hints, unsub };
}

// ---------------------------------------------------------------------------
// scheduleReminder：校验 + 落库 + schedule log
// ---------------------------------------------------------------------------

test("scheduleReminder: 合法输入落库并记 schedule log", () => {
  const { alice, anchor } = setup();
  const fireAt = iso(new Date(Date.now() + 60_000));
  const view = scheduleReminder({
    title: "check the build",
    fireAt,
    recurrence: "every:1m",
    targetId: anchor.id,
    authorId: alice.id,
  });
  assert.equal(view.title, "check the build");
  assert.equal(view.fire_at, fireAt);
  assert.equal(view.recurrence, "every:1m");
  assert.equal(view.target_id, anchor.id);
  assert.equal(view.author_id, alice.id);
  assert.equal(view.status, "scheduled");
  assert.equal(view.author?.id, alice.id);
  assert.deepEqual(view.target, { kind: "message", id: anchor.id });
  const logs = getReminderLog(view.id);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].event, "schedule");
});

test("scheduleReminder: 校验失败抛错（title/fireAt/recurrence/target/成员/作者）", () => {
  const { channel, alice } = setup();
  const fireAt = iso(new Date(Date.now() + 60_000));
  const ok = { title: "t", fireAt, authorId: alice.id, targetId: channel.id };
  assert.throws(() => scheduleReminder({ ...ok, title: "  " }), /title/);
  assert.throws(() => scheduleReminder({ ...ok, fireAt: "not-a-date" }), /fireAt/);
  assert.throws(() => scheduleReminder({ ...ok, recurrence: "bogus" }), /recurrence/);
  assert.throws(() => scheduleReminder({ ...ok, targetId: "no-such-target" }), /target/i);
  assert.throws(() => scheduleReminder({ ...ok, targetId: "no-such-target" }), /not found/i);
  // carl 未加入 channel：不能在该 channel 设提醒
  const carl = createAgent({ name: "carl", workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), "ws-reminders-")) });
  assert.throws(() => scheduleReminder({ ...ok, authorId: carl.id }), /member/i);
  assert.throws(() => scheduleReminder({ ...ok, authorId: "ghost" }), /member/i);
  assert.equal(scheduleReminder({ ...ok, targetId: undefined }).target_id, null);
  assert.equal(scheduleReminder({ ...ok, targetId: null }).target_id, null);
});

test("scheduleReminder: thread 内消息归一化到线程锚点", () => {
  const { alice, anchor } = setup();
  const threadMsg = sendMessage({
    targetId: anchor.id,
    authorId: alice.id,
    content: "thread reply",
  });
  assert.equal(threadMsg.held, false);
  const view = scheduleReminder({
    title: "t",
    fireAt: iso(new Date(Date.now() + 60_000)),
    authorId: alice.id,
    targetId: threadMsg.message.id,
  });
  assert.equal(view.target_id, anchor.id);
});

// ---------------------------------------------------------------------------
// listReminders：作者 / target 过滤
// ---------------------------------------------------------------------------

test("listReminders: 按作者与 target 过滤", () => {
  const { channel, alice, bob, anchor } = setup();
  const fireAt = iso(new Date(Date.now() + 60_000));
  const a = scheduleReminder({ title: "a", fireAt, authorId: alice.id, targetId: channel.id });
  const b = scheduleReminder({ title: "b", fireAt, authorId: bob.id, targetId: anchor.id });
  assert.deepEqual(listReminders({ authorId: alice.id }).map((r) => r.id), [a.id]);
  assert.deepEqual(listReminders({ targetId: channel.id }).map((r) => r.id), [a.id]);
  assert.deepEqual(listReminders({ targetId: anchor.id }).map((r) => r.id), [b.id]);
  assert.equal(listReminders().some((r) => r.id === a.id), true);
  assert.equal(listReminders().some((r) => r.id === b.id), true);
});

test("listReminders: thread 内消息按锚点查询（与 schedule 同规则归一化）", () => {
  const { alice, anchor } = setup();
  const threadMsg = sendMessage({
    targetId: anchor.id,
    authorId: alice.id,
    content: "thread reply",
  });
  assert.equal(threadMsg.held, false);
  const view = scheduleReminder({
    title: "t",
    fireAt: iso(new Date(Date.now() + 60_000)),
    authorId: alice.id,
    targetId: threadMsg.message.id,
  });
  assert.equal(view.target_id, anchor.id);
  assert.deepEqual(listReminders({ targetId: threadMsg.message.id }).map((r) => r.id), [view.id]);
  assert.deepEqual(listReminders({ targetId: anchor.id }).map((r) => r.id), [view.id]);
});

// ---------------------------------------------------------------------------
// snooze / update / cancel：author/owner 权限 + 仅 scheduled + log
// ---------------------------------------------------------------------------

test("snooze: 延后 fire_at（max(now, fire_at) + minutes），记 snooze log", () => {
  const { channel, alice, bob } = setup();
  const future = new Date(Date.now() + 10 * 60_000);
  const view = scheduleReminder({
    title: "t",
    fireAt: future.toISOString(),
    authorId: alice.id,
    targetId: channel.id,
  });
  const snoozed = snoozeReminder(view.id, 30, alice.id);
  assert.ok(new Date(snoozed.fire_at).getTime() > future.getTime() + 25 * 60_000);
  assert.deepEqual(getReminderLog(view.id).map((l) => l.event), ["schedule", "snooze"]);
  // 他人（非 owner）不可 snooze
  assert.throws(() => snoozeReminder(view.id, 5, bob.id), ReminderNotAuthorizedError);
});

test("snooze: 已 fired / canceled 不可 snooze", () => {
  const { channel, alice } = setup();
  const due = scheduleReminder({
    title: "t",
    fireAt: iso(new Date(Date.now() - 60_000)),
    authorId: alice.id,
    targetId: channel.id,
  });
  fireReminder(due.id);
  assert.throws(() => snoozeReminder(due.id, 5, alice.id), /scheduled/);
  const canceled = scheduleReminder({
    title: "t",
    fireAt: iso(new Date(Date.now() + 60_000)),
    authorId: alice.id,
    targetId: channel.id,
  });
  cancelReminder(canceled.id, alice.id);
  assert.throws(() => snoozeReminder(canceled.id, 5, alice.id), /scheduled/);
  assert.throws(() => snoozeReminder("missing-id", 5, alice.id), ReminderNotFoundError);
});

test("update: 可改 title/fireAt/recurrence/target，仅 scheduled，记 update log", () => {
  const { channel, alice, anchor } = setup();
  const view = scheduleReminder({
    title: "old",
    fireAt: iso(new Date(Date.now() + 60_000)),
    authorId: alice.id,
    targetId: channel.id,
  });
  const newFire = iso(new Date(Date.now() + 120_000));
  const updated = updateReminder(view.id, { title: "new", fireAt: newFire, recurrence: "daily@09:00" }, alice.id);
  assert.equal(updated.title, "new");
  assert.equal(updated.fire_at, newFire);
  assert.equal(updated.recurrence, "daily@09:00");
  // 清空 recurrence / 移动 target
  const cleared = updateReminder(view.id, { recurrence: null, targetId: anchor.id }, alice.id);
  assert.equal(cleared.recurrence, null);
  assert.equal(cleared.target_id, anchor.id);
  assert.throws(() => updateReminder(view.id, { recurrence: "bogus" }, alice.id), /recurrence/);
  assert.throws(() => updateReminder(view.id, { targetId: "nope" }, alice.id), /not found/i);
  assert.equal(getReminderLog(view.id).some((l) => l.event === "update"), true);
});

test("cancel: scheduled → canceled，记 cancel log；重复/已 fired 报错", () => {
  const { channel, alice, bob } = setup();
  const view = scheduleReminder({
    title: "t",
    fireAt: iso(new Date(Date.now() + 60_000)),
    authorId: alice.id,
    targetId: channel.id,
  });
  assert.throws(() => cancelReminder(view.id, bob.id), ReminderNotAuthorizedError);
  const canceled = cancelReminder(view.id, alice.id);
  assert.equal(canceled.status, "canceled");
  assert.throws(() => cancelReminder(view.id, alice.id), /scheduled/);
  assert.equal(getReminderLog(view.id).at(-1)?.event, "cancel");
});

// ---------------------------------------------------------------------------
// fire：系统消息 + 唤醒作者 + recurrence 续算 + 幂等
// ---------------------------------------------------------------------------

test("fire: 到点投递系统消息并唤醒作者（agent 走 wake，reason=reminder），不惊动其他 agent", () => {
  const { channel, alice } = setup();
  const { hints, unsub } = collectWakes();
  const view = scheduleReminder({
    title: "check the build",
    fireAt: iso(new Date(Date.now() - 10_000)),
    authorId: alice.id,
    targetId: channel.id,
  });
  const outcome = fireReminder(view.id);
  unsub();
  assert.equal(outcome.status, "fired");
  const systemMessage = outcome.systemMessage;
  assert.ok(systemMessage);
  assert.equal(systemMessage.author_id, alice.id);
  assert.match(systemMessage.content, /check the build/);
  assert.equal(systemMessage.target_id, channel.id);
  // 只有作者被唤醒；bob 未被唤醒；wake 带 reminder reason 与系统消息 seq
  const agentWakes = hints.filter((h) => h.reason === "reminder");
  assert.deepEqual(agentWakes.map((h) => h.agentId), [alice.id]);
  assert.equal(agentWakes[0].targetId, channel.id);
  assert.equal(agentWakes[0].seq, systemMessage.seq);
  // 状态与 log
  const fired = scheduleReminder({
    title: "one-shot",
    fireAt: iso(new Date(Date.now() - 10_000)),
    authorId: alice.id,
    targetId: channel.id,
  });
  fireReminder(fired.id);
  assert.equal(fireReminder(fired.id).status, "not_due");
  assert.equal(globalThis.__workspliceDb.getReminderById(fired.id).status, "fired");
  assert.equal(getReminderLog(fired.id).some((l) => l.event === "fire"), true);
});

test("fire: 未到点 / 已取消 / 不存在 不触发", () => {
  const { channel, alice } = setup();
  const future = scheduleReminder({
    title: "t",
    fireAt: iso(new Date(Date.now() + 60_000)),
    authorId: alice.id,
    targetId: channel.id,
  });
  assert.equal(fireReminder(future.id).status, "not_due");
  const canceled = scheduleReminder({
    title: "t",
    fireAt: iso(new Date(Date.now() - 10_000)),
    authorId: alice.id,
    targetId: channel.id,
  });
  cancelReminder(canceled.id, alice.id);
  assert.equal(fireReminder(canceled.id).status, "not_due");
  assert.throws(() => fireReminder("missing"), ReminderNotFoundError);
});

test("fire: recurrence 到期续算下一次 fire_at（保持 scheduled + reschedule log）", () => {
  const { alice, anchor } = setup();
  const fireAt = new Date(Date.now() - 5_000);
  const view = scheduleReminder({
    title: "tick",
    fireAt: fireAt.toISOString(),
    recurrence: "every:1m",
    authorId: alice.id,
    targetId: anchor.id,
  });
  const outcome = fireReminder(view.id);
  assert.equal(outcome.status, "fired");
  const row = globalThis.__workspliceDb.getReminderById(view.id);
  assert.equal(row.status, "scheduled");
  assert.equal(new Date(row.fire_at).getTime(), fireAt.getTime() + 60_000);
  const events = getReminderLog(view.id).map((l) => l.event);
  assert.deepEqual(events, ["schedule", "fire", "reschedule"]);
  // 幂等：再 fire 未到新 fire_at → not_due，不重复发消息
  assert.equal(fireReminder(view.id).status, "not_due");
});

test("fire: 人类作者（owner）到点只投递系统消息、不 wake", () => {
  const { channel } = setup();
  const { hints, unsub } = collectWakes();
  const view = scheduleReminder({
    title: "human note",
    fireAt: iso(new Date(Date.now() - 10_000)),
    authorId: OWNER_MEMBER_ID,
    targetId: channel.id,
  });
  const outcome = fireReminder(view.id);
  unsub();
  assert.equal(outcome.status, "fired");
  assert.equal(outcome.systemMessage?.author_id, OWNER_MEMBER_ID);
  assert.deepEqual(hints.filter((h) => h.reason === "reminder"), []);
});

test("fire: 无 target 不投递系统消息但正常触发", () => {
  const { alice } = setup();
  const view = scheduleReminder({
    title: "headless",
    fireAt: iso(new Date(Date.now() - 10_000)),
    authorId: alice.id,
    targetId: null,
  });
  const outcome = fireReminder(view.id);
  assert.equal(outcome.status, "fired");
  assert.equal(outcome.systemMessage, null);
  assert.equal(globalThis.__workspliceDb.getReminderById(view.id).status, "fired");
});

test("fire: 作者已退出 channel —— 系统消息失败也收口（error log，不无限重试），不 wake", () => {
  const { channel, alice } = setup();
  const view = scheduleReminder({
    title: "orphan",
    fireAt: iso(new Date(Date.now() - 10_000)),
    authorId: alice.id,
    targetId: channel.id,
  });
  leaveChannel(channel.id, alice.id, OWNER_MEMBER_ID);
  const outcome = fireReminder(view.id);
  assert.equal(outcome.status, "fired");
  assert.ok(outcome.postError);
  assert.equal(outcome.systemMessage, null);
  const row = globalThis.__workspliceDb.getReminderById(view.id);
  assert.equal(row.status, "fired");
  assert.equal(getReminderLog(view.id).some((l) => l.event === "error"), true);
});

test("fire: 消息锚定的提醒投递到**频道主流程**（原投 thread 不可见，修正），正文附锚点引用", () => {
  const { channel, alice, anchor } = setup();
  const { hints, unsub } = collectWakes();
  const view = scheduleReminder({
    title: "msg-anchored",
    fireAt: iso(new Date(Date.now() - 10_000)),
    authorId: alice.id,
    targetId: anchor.id,
  });
  const outcome = fireReminder(view.id);
  unsub();
  assert.equal(outcome.status, "fired");
  const systemMessage = outcome.systemMessage;
  assert.ok(systemMessage);
  // 系统消息落在 channel 主流程，而不是锚点消息的 thread
  assert.equal(systemMessage.target_id, channel.id);
  assert.equal(systemMessage.content.includes("msg-anchored"), true);
  assert.equal(systemMessage.content.includes(`anchored on #${anchor.seq}`), true);
  // thread 内没有该消息
  assert.deepEqual(
    globalThis.__workspliceDb.listMessages(anchor.id).map((m) => m.content),
    [],
  );
  // 唤醒 hint 的目标 = 系统消息所在 channel
  const agentWakes = hints.filter((h) => h.reason === "reminder");
  assert.equal(agentWakes[0].targetId, channel.id);
  assert.equal(agentWakes[0].seq, systemMessage.seq);
});

test("ReminderView: 附带 channelId/channelName/anchorSeq（全局面板定位用）", () => {
  const { channel, alice, anchor } = setup();
  const onChannel = scheduleReminder({
    title: "c",
    fireAt: iso(new Date(Date.now() + 60_000)),
    authorId: alice.id,
    targetId: channel.id,
  });
  assert.equal(onChannel.channelId, channel.id);
  assert.equal(onChannel.channelName, channel.name);
  assert.equal(onChannel.anchorSeq, null);
  const onMessage = scheduleReminder({
    title: "m",
    fireAt: iso(new Date(Date.now() + 60_000)),
    authorId: alice.id,
    targetId: anchor.id,
  });
  assert.equal(onMessage.channelId, channel.id);
  assert.equal(onMessage.channelName, channel.name);
  assert.equal(onMessage.anchorSeq, anchor.seq);
  const headless = scheduleReminder({
    title: "h",
    fireAt: iso(new Date(Date.now() + 60_000)),
    authorId: alice.id,
    targetId: null,
  });
  assert.equal(headless.channelId, null);
  assert.equal(headless.channelName, null);
  assert.equal(headless.anchorSeq, null);
});

test("fireDueReminders: 到点批量触发（按 fire_at），未来/取消的不动", () => {
  const { channel, alice, anchor } = setup();
  const due1 = scheduleReminder({
    title: "d1",
    fireAt: iso(new Date(Date.now() - 20_000)),
    authorId: alice.id,
    targetId: channel.id,
  });
  const due2 = scheduleReminder({
    title: "d2",
    fireAt: iso(new Date(Date.now() - 10_000)),
    authorId: alice.id,
    targetId: anchor.id,
  });
  const future = scheduleReminder({
    title: "f",
    fireAt: iso(new Date(Date.now() + 60_000)),
    authorId: alice.id,
    targetId: channel.id,
  });
  const canceled = scheduleReminder({
    title: "c",
    fireAt: iso(new Date(Date.now() - 5_000)),
    authorId: alice.id,
    targetId: channel.id,
  });
  cancelReminder(canceled.id, alice.id);

  const outcomes = fireDueReminders();
  assert.deepEqual(outcomes.map((o) => o.status), ["fired", "fired"]);
  assert.equal(globalThis.__workspliceDb.getReminderById(due1.id).status, "fired");
  assert.equal(globalThis.__workspliceDb.getReminderById(due2.id).status, "fired");
  assert.equal(globalThis.__workspliceDb.getReminderById(future.id).status, "scheduled");
  assert.equal(globalThis.__workspliceDb.getReminderById(canceled.id).status, "canceled");
  // 再跑一遍：幂等，无重复
  assert.deepEqual(fireDueReminders(), []);
});
