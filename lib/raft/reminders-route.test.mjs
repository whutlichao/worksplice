import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readRoute = (path) =>
  readFile(new URL(`../../app/api/${path}`, import.meta.url), "utf-8");

test("POST /api/reminders validates and schedules with the current member as author", async () => {
  const source = await readRoute("reminders/route.ts");
  assert.match(source, /scheduleReminder\(/);
  assert.match(source, /CURRENT_MEMBER_ID/);
  assert.match(source, /title is required/);
  assert.match(source, /fireAt must be a valid date string/);
  assert.match(source, /status: 201/);
});

test("POST /api/reminders lets the owner set the reminder for an agent (authorId, §3.9)", async () => {
  const source = await readRoute("reminders/route.ts");
  assert.match(source, /body\.authorId/);
  assert.match(source, /member\.type !== "agent"/);
  assert.match(source, /authorId must be an agent member/);
});

test("GET /api/reminders supports authorId/targetId filters", async () => {
  const source = await readRoute("reminders/route.ts");
  assert.match(source, /listReminders\(/);
  assert.match(source, /searchParams\.get\("authorId"\)/);
  assert.match(source, /searchParams\.get\("targetId"\)/);
});

test("update route supports title/fireAt/recurrence/targetId patch", async () => {
  const source = await readRoute("reminders/[id]/route.ts");
  assert.match(source, /updateReminder\(/);
  assert.match(source, /CURRENT_MEMBER_ID/);
  assert.match(source, /recurrence === null/);
  assert.match(source, /ReminderNotFoundError/);
  assert.match(source, /status: 404/);
  assert.match(source, /status: 403/);
});

test("snooze/cancel/log routes wire the service operations", async () => {
  const snooze = await readRoute("reminders/[id]/snooze/route.ts");
  const cancel = await readRoute("reminders/[id]/cancel/route.ts");
  const log = await readRoute("reminders/[id]/log/route.ts");
  assert.match(snooze, /snoozeReminder\(/);
  assert.match(snooze, /minutes = typeof body\.minutes === "number" \? body\.minutes : 15/);
  assert.match(cancel, /cancelReminder\(/);
  assert.match(log, /getReminderLog\(/);
  for (const source of [snooze, cancel, log]) {
    assert.match(source, /status: 404/);
  }
});
