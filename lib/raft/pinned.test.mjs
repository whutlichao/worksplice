import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/sqlite.ts";
import { OWNER_MEMBER_ID } from "../data/schema.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-pinned-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createChannel, joinChannel } = await import("./channels.ts");
const { createAgent } = await import("./members.ts");
const { sendMessage } = await import("./messages.ts");
const { pinMessage, unpinMessage, listPinned, setPinnedOrder } = await import("./pinned.ts");

function freshChannel() {
  return createChannel({ name: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
}

function channelMessage(channelId, content) {
  return sendMessage({ targetId: channelId, authorId: OWNER_MEMBER_ID, content }).message;
}

test("pinMessage orders by max+1 and listPinned manual sort returns pinned messages (§3.5)", () => {
  const channel = freshChannel();
  const m1 = channelMessage(channel.id, "first");
  const m2 = channelMessage(channel.id, "second");

  pinMessage({ channelId: channel.id, messageId: m1.id, memberId: OWNER_MEMBER_ID });
  pinMessage({ channelId: channel.id, messageId: m2.id, memberId: OWNER_MEMBER_ID });

  const pinned = listPinned({ channelId: channel.id, memberId: OWNER_MEMBER_ID, sort: "manual" });
  assert.deepEqual(
    pinned.map((p) => p.message.id),
    [m1.id, m2.id],
  );
  assert.deepEqual(
    pinned.map((p) => p.order),
    [0, 1],
  );
  assert.equal(pinned[0].message.content, "first");
});

test("pinning the same message twice is idempotent", () => {
  const channel = freshChannel();
  const message = channelMessage(channel.id, "only");
  const first = pinMessage({ channelId: channel.id, messageId: message.id, memberId: OWNER_MEMBER_ID });
  const second = pinMessage({ channelId: channel.id, messageId: message.id, memberId: OWNER_MEMBER_ID });
  assert.equal(second.id, first.id);
  assert.equal(listPinned({ channelId: channel.id, memberId: OWNER_MEMBER_ID, sort: "manual" }).length, 1);
});

test("unpinMessage removes only the given member's pin", () => {
  const channel = freshChannel();
  const message = channelMessage(channel.id, "shared");
  const agent = createAgent({ name: `a-${Date.now()}`, workspacePath: fs.mkdtempSync(path.join(root, "w")) });
  joinChannel(channel.id, agent.id);

  pinMessage({ channelId: channel.id, messageId: message.id, memberId: OWNER_MEMBER_ID });
  pinMessage({ channelId: channel.id, messageId: message.id, memberId: agent.id });

  assert.equal(unpinMessage({ channelId: channel.id, messageId: message.id, memberId: OWNER_MEMBER_ID }), true);
  const remaining = listPinned({ channelId: channel.id, memberId: agent.id, sort: "manual" });
  assert.deepEqual(
    remaining.map((p) => p.message.id),
    [message.id],
  );
  assert.equal(unpinMessage({ channelId: channel.id, messageId: message.id, memberId: OWNER_MEMBER_ID }), false);
});

test("listPinned sort modes: recent = pinned_at desc, az = content asc", () => {
  const channel = freshChannel();
  const zebra = channelMessage(channel.id, "zebra");
  const apple = channelMessage(channel.id, "apple");
  const mango = channelMessage(channel.id, "mango");
  pinMessage({ channelId: channel.id, messageId: zebra.id, memberId: OWNER_MEMBER_ID });
  pinMessage({ channelId: channel.id, messageId: apple.id, memberId: OWNER_MEMBER_ID });
  pinMessage({ channelId: channel.id, messageId: mango.id, memberId: OWNER_MEMBER_ID });

  const recent = listPinned({ channelId: channel.id, memberId: OWNER_MEMBER_ID, sort: "recent" });
  assert.deepEqual(
    recent.map((p) => p.message.content),
    ["mango", "apple", "zebra"],
  );
  const az = listPinned({ channelId: channel.id, memberId: OWNER_MEMBER_ID, sort: "az" });
  assert.deepEqual(
    az.map((p) => p.message.content),
    ["apple", "mango", "zebra"],
  );
});

test("setPinnedOrder rewrites manual order for the given member", () => {
  const channel = freshChannel();
  const a = channelMessage(channel.id, "a");
  const b = channelMessage(channel.id, "b");
  const c = channelMessage(channel.id, "c");
  pinMessage({ channelId: channel.id, messageId: a.id, memberId: OWNER_MEMBER_ID });
  pinMessage({ channelId: channel.id, messageId: b.id, memberId: OWNER_MEMBER_ID });
  pinMessage({ channelId: channel.id, messageId: c.id, memberId: OWNER_MEMBER_ID });

  setPinnedOrder({ channelId: channel.id, memberId: OWNER_MEMBER_ID, order: [c.id, a.id, b.id] });
  const ordered = listPinned({ channelId: channel.id, memberId: OWNER_MEMBER_ID, sort: "manual" });
  assert.deepEqual(
    ordered.map((p) => p.message.content),
    ["c", "a", "b"],
  );
});

test("thread messages pin to their channel; messages from other channels are rejected", () => {
  const channelA = freshChannel();
  const channelB = freshChannel();
  const anchor = channelMessage(channelA.id, "anchor");
  const reply = sendMessage({ targetId: anchor.id, authorId: OWNER_MEMBER_ID, content: "reply" }).message;

  pinMessage({ channelId: channelA.id, messageId: reply.id, memberId: OWNER_MEMBER_ID });
  assert.deepEqual(
    listPinned({ channelId: channelA.id, memberId: OWNER_MEMBER_ID, sort: "manual" }).map((p) => p.message.id),
    [reply.id],
  );

  const foreign = channelMessage(channelB.id, "other channel");
  assert.throws(
    () => pinMessage({ channelId: channelA.id, messageId: foreign.id, memberId: OWNER_MEMBER_ID }),
    /belong to this channel/i,
  );
});

test("pinning requires channel membership and existing messages", () => {
  const channel = freshChannel();
  const message = channelMessage(channel.id, "secret");
  const stranger = createAgent({ name: `s-${Date.now()}`, workspacePath: fs.mkdtempSync(path.join(root, "w2")) });

  assert.throws(
    () => pinMessage({ channelId: channel.id, messageId: message.id, memberId: stranger.id }),
    /not a member/i,
  );
  assert.throws(
    () => pinMessage({ channelId: channel.id, messageId: "missing", memberId: OWNER_MEMBER_ID }),
    /not found/i,
  );
  assert.throws(
    () => pinMessage({ channelId: "no-such-channel", messageId: message.id, memberId: OWNER_MEMBER_ID }),
    /not found/i,
  );
});
