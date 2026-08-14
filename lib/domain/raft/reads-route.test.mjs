import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readRoute = (path) =>
  readFile(new URL(`../../../app/api/${path}`, import.meta.url), "utf-8");

test("POST /api/channels/[id]/read marks the channel read and is idempotent", async () => {
  const source = await readRoute("channels/[id]/read/route.ts");
  assert.match(source, /export async function POST/);
  assert.match(source, /markChannelRead\(/);
  assert.match(source, /Channel not found/);
  assert.match(source, /readSeq/);
});

test("GET /api/channels carries the owner unread badge via listChannelsWithMeta", async () => {
  const source = await readRoute("channels/route.ts");
  assert.match(source, /listChannelsWithMeta\(CURRENT_MEMBER_ID\)/);
  const channels = await readFile(
    new URL("../../domain/raft/channels.ts", import.meta.url),
    "utf-8",
  );
  assert.match(channels, /unread: getDb\(\)\.countUnreadChannelMessages\(memberId, channel\.id\)/);
});
