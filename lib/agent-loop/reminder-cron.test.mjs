import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/sqlite.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-reminder-cron-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  stopReminderCron();
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createChannel, joinChannel } = await import("../domain/raft/channels.ts");
const { createAgent } = await import("../domain/raft/members.ts");
const { scheduleReminder } = await import("../domain/raft/reminders.ts");
const { startReminderCron, stopReminderCron, tickReminderCron, REMINDER_POLL_MS } = await import(
  "./loop.ts"
);

let fixtureSeq = 0;

function setup() {
  const channel = createChannel({ name: "cron-room" });
  // 名字唯一性（agent-name-uniqueness）：同一 DB 内每轮 setup 用唯一后缀避免重名拒绝
  const seq = ++fixtureSeq;
  const alice = createAgent({ name: `alice-${seq}`, workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), "ws-cron-")) });
  joinChannel(channel.id, alice.id);
  return { channel, alice };
}

test("REMINDER_POLL_MS 默认逐分钟（§5.6）", () => {
  assert.equal(REMINDER_POLL_MS, 60_000);
});

test("tickReminderCron: 到点全部触发并返回触发数；重复 tick 幂等", () => {
  const { channel, alice } = setup();
  scheduleReminder({
    title: "d1",
    fireAt: new Date(Date.now() - 60_000).toISOString(),
    authorId: alice.id,
    targetId: channel.id,
  });
  scheduleReminder({
    title: "d2",
    fireAt: new Date(Date.now() - 30_000).toISOString(),
    authorId: alice.id,
    targetId: channel.id,
  });
  scheduleReminder({
    title: "future",
    fireAt: new Date(Date.now() + 60_000).toISOString(),
    authorId: alice.id,
    targetId: channel.id,
  });
  assert.equal(tickReminderCron(), 2);
  assert.equal(tickReminderCron(), 0);
  const rows = globalThis.__workspliceDb.listReminders();
  assert.equal(rows.filter((r) => r.status === "fired").length, 2);
  assert.equal(rows.filter((r) => r.status === "scheduled").length, 1);
});

test("start/stop: 幂等启停；stop 后 tick 不再执行", () => {
  const { channel, alice } = setup();
  const stop1 = startReminderCron();
  const stop2 = startReminderCron();
  assert.equal(stop1, stopReminderCron);
  assert.equal(stop2, stopReminderCron);
  stopReminderCron();
  stopReminderCron(); // 重复 stop 不炸
  scheduleReminder({
    title: "after-stop",
    fireAt: new Date(Date.now() - 10_000).toISOString(),
    authorId: alice.id,
    targetId: channel.id,
  });
  // stop 后手动 tick 依然可用（测试/管理入口），但 cron 定时器已清
  assert.equal(tickReminderCron(), 1);
  assert.equal(globalThis.__workspliceReminderCron?.timer, null);
});

test("tickReminderCron: 带 now 参数（注入时钟）", () => {
  const { channel, alice } = setup();
  const later = scheduleReminder({
    title: "later",
    fireAt: "2026-08-05T00:00:00.000Z",
    authorId: alice.id,
    targetId: channel.id,
  });
  assert.equal(tickReminderCron(new Date("2026-08-04T00:00:00.000Z")), 0);
  assert.equal(globalThis.__workspliceDb.getReminderById(later.id).status, "scheduled");
  tickReminderCron(new Date("2026-08-05T00:01:00.000Z"));
  assert.equal(globalThis.__workspliceDb.getReminderById(later.id).status, "fired");
});
