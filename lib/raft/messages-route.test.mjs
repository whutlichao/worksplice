import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readRoute = (path) =>
  readFile(new URL(`../../app/api/${path}`, import.meta.url), "utf-8");

test("POST /api/messages applies freshness-hold: 409 with held payload on stale baseSeq", async () => {
  const source = await readRoute("messages/route.ts");
  assert.match(source, /sendMessage\(/);
  assert.match(source, /baseSeq: typeof input\.baseSeq === "number"/);
  assert.match(source, /status: 409/);
  assert.match(source, /result\.held/);
  assert.match(source, /whatHappened/);
  assert.match(source, /quoteId/);
});

test("GET /api/channels/[id]/messages supports seq cursor pagination params", async () => {
  const source = await readRoute("channels/[id]/messages/route.ts");
  assert.match(source, /searchParams\.get\("before"\)/);
  assert.match(source, /searchParams\.get\("limit"\)/);
  assert.match(source, /searchParams\.get\("targetId"\)/);
  assert.match(source, /Message does not belong to this channel/);
  assert.match(source, /listMessages\(/);
});

test("join/leave/archive routes default to the owner as the current member", async () => {
  const join = await readRoute("channels/[id]/join/route.ts");
  const leave = await readRoute("channels/[id]/leave/route.ts");
  const archive = await readRoute("channels/[id]/archive/route.ts");
  for (const source of [join, leave, archive]) {
    assert.match(source, /CURRENT_MEMBER_ID/);
  }
  assert.match(join, /joinChannel\(id, memberId, CURRENT_MEMBER_ID\)/);
  assert.match(leave, /leaveChannel\(id, memberId, CURRENT_MEMBER_ID\)/);
  assert.match(archive, /setChannelArchived\(id, body\.archived !== false, CURRENT_MEMBER_ID\)/);
});

test("thread read route and single message route exist", async () => {
  const thread = await readRoute("messages/[id]/thread/route.ts");
  const single = await readRoute("messages/[id]/route.ts");
  assert.match(thread, /getThreadInfo\(/);
  assert.match(single, /getMessageWithAuthor\(/);
  assert.match(single, /status: 404/);
});

test("POST /api/channels accepts initial memberIds", async () => {
  const source = await readRoute("channels/route.ts");
  assert.match(source, /memberIds/);
  assert.match(source, /listChannelsWithMeta/);
});
