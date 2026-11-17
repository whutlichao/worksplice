import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readRoute = (path) => readFile(new URL(`../../../app/api/${path}`, import.meta.url), "utf-8");
const readService = (path) => readFile(new URL(`../../domain/collab/${path}`, import.meta.url), "utf-8");

test("任务状态权威落在服务层，update-status 路由委托服务层（越权 400）", async () => {
  const tasks = await readService("tasks.ts");
  assert.match(tasks, /isTaskStatusAuthority/);
  assert.match(tasks, /TaskNotAuthorizedError/);
  assert.match(
    tasks,
    /Only the human Owner or current global chief can change task status/,
  );
  const route = await readRoute("tasks/[id]/update-status/route.ts");
  assert.match(route, /updateTaskStatus\(/);
  assert.match(route, /jsonError\(error, 400\)/);
});

test("提醒路由委托 scheduleReminder/fireReminder，服务层经 resolveChannelForTarget 归一化 DM", async () => {
  const remindersRoute = await readRoute("reminders/route.ts");
  assert.match(remindersRoute, /scheduleReminder\(/);
  const reminders = await readService("reminders.ts");
  assert.match(reminders, /resolveChannelForTarget\(/);
  assert.match(reminders, /fireReminder\(/);
});

test("搜索路由委托 searchMessages，服务层附 channel 归属（DM 经 resolveChannelForTarget 解析）", async () => {
  const route = await readRoute("search/route.ts");
  assert.match(route, /searchMessages\(/);
  const search = await readService("search.ts");
  assert.match(search, /resolveChannelForTarget\(/);
  assert.match(search, /channel: resolveChannelForTarget/);
});

test("未读路由委托 markChannelRead/listChannelsWithMeta（DM 计入未读）", async () => {
  const read = await readRoute("channels/[id]/read/route.ts");
  assert.match(read, /markChannelRead\(/);
  const channelsRoute = await readRoute("channels/route.ts");
  assert.match(channelsRoute, /listChannelsWithMeta\(/);
  const reads = await readService("reads.ts");
  assert.match(reads, /listChannelsWithUnread/);
});
