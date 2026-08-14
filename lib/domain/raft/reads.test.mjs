import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../../data/sqlite.ts";
import { BUILTIN_CHANNEL_ID, OWNER_MEMBER_ID } from "../../data/schema.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-reads-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createChannel, listChannelsWithMeta } = await import("./channels.ts");
const { createAgent } = await import("./members.ts");
const { sendMessage } = await import("./messages.ts");
const { unreadCount, markChannelRead, listChannelsWithUnread } = await import("./reads.ts");

function agentName(i) {
  return `read-agent-${i}`;
}

function post(channelId, authorId, content) {
  return sendMessage({ targetId: channelId, authorId, content });
}

test("unread counts only other authors' messages newer than the read cursor", () => {
  const a = createAgent({ name: agentName(1) });
  const channel = createChannel({ name: "reads-1", type: "public", memberIds: [a.id] });

  post(channel.id, a.id, "hi from agent");
  assert.equal(unreadCount(channel.id), 1, "one agent message is unread");

  post(channel.id, OWNER_MEMBER_ID, "owner replies");
  assert.equal(unreadCount(channel.id), 1, "owner's own message does not count as unread");

  post(channel.id, a.id, "another agent message");
  assert.equal(unreadCount(channel.id), 2);
});

test("markChannelRead advances the cursor to max seq and clears the badge", () => {
  const a = createAgent({ name: agentName(2) });
  const channel = createChannel({ name: "reads-2", type: "public", memberIds: [a.id] });

  post(channel.id, a.id, "unread-1");
  post(channel.id, a.id, "unread-2");
  assert.equal(unreadCount(channel.id), 2);

  const readSeq = markChannelRead(channel.id);
  assert.equal(readSeq, 2);
  assert.equal(unreadCount(channel.id), 0, "badge cleared after reading");
});

test("new messages after markChannelRead show up as unread again", () => {
  const a = createAgent({ name: agentName(3) });
  const channel = createChannel({ name: "reads-3", type: "public", memberIds: [a.id] });

  post(channel.id, a.id, "seen");
  markChannelRead(channel.id);
  assert.equal(unreadCount(channel.id), 0);

  post(channel.id, a.id, "new message after reading");
  assert.equal(unreadCount(channel.id), 1);
});

test("reads are tracked per channel independently", () => {
  const a = createAgent({ name: agentName(4) });
  const c1 = createChannel({ name: "reads-c1", type: "public", memberIds: [a.id] });
  const c2 = createChannel({ name: "reads-c2", type: "public", memberIds: [a.id] });

  post(c1.id, a.id, "c1 message");
  post(c2.id, a.id, "c2 message");
  assert.equal(unreadCount(c1.id), 1);
  assert.equal(unreadCount(c2.id), 1);

  markChannelRead(c1.id);
  assert.equal(unreadCount(c1.id), 0, "reading c1 does not affect c2");
  assert.equal(unreadCount(c2.id), 1);
});

test("listChannelsWithMeta reports the owner unread badge per channel", () => {
  const a = createAgent({ name: agentName(5) });
  const c1 = createChannel({ name: "reads-m1", type: "public", memberIds: [a.id] });
  const c2 = createChannel({ name: "reads-m2", type: "public", memberIds: [a.id] });

  post(c1.id, a.id, "unread in c1");
  post(c2.id, a.id, "unread in c2");
  post(c2.id, a.id, "more in c2");

  const meta = listChannelsWithMeta(OWNER_MEMBER_ID);
  const byId = new Map(meta.map((c) => [c.id, c]));
  assert.equal(byId.get(c1.id).unread, 1);
  assert.equal(byId.get(c2.id).unread, 2);
  assert.equal(byId.get(BUILTIN_CHANNEL_ID).unread, 0, "#all has no messages");
});

test("listChannelsWithUnread exposes the unread counts for the sidebar", () => {
  const a = createAgent({ name: agentName(6) });
  const c1 = createChannel({ name: "reads-l1", type: "public", memberIds: [a.id] });
  const c2 = createChannel({ name: "reads-l2", type: "public", memberIds: [a.id] });

  post(c1.id, a.id, "unread in l1");
  post(c2.id, a.id, "unread in l2");

  const rows = listChannelsWithUnread();
  const byId = new Map(rows.map((r) => [r.channelId, r.unread]));
  assert.equal(byId.get(c1.id), 1);
  assert.equal(byId.get(c2.id), 1);
});

test("reads are inert for nonexistent channels", () => {
  assert.equal(unreadCount("nope"), 0);
  assert.equal(markChannelRead("nope"), 0);
});
