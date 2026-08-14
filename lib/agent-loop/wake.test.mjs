import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/db.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-wake-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createAgent } = await import("../raft/members.ts");
const { createChannel, joinChannel, muteChannel, unmuteChannel } = await import("../raft/channels.ts");
const { sendMessage } = await import("../raft/messages.ts");
const { subscribeWake, emitWake, extractMentionedMemberIds } = await import("../raft/wake.ts");
const { OWNER_MEMBER_ID } = await import("../data/schema.ts");

function sendAsOwner(targetId, content) {
  const result = sendMessage({ targetId, authorId: OWNER_MEMBER_ID, content });
  assert.equal(result.held, false);
  return result.message;
}

test("emitWake broadcasts a seq-level hint (no content) to subscribers; unsubscribe works", () => {
  const hints = [];
  const unsub = subscribeWake((hint) => hints.push(hint));
  emitWake({ agentId: "a1", targetId: "#all", seq: 7, reason: "message" });
  unsub();
  emitWake({ agentId: "a2", targetId: "#all", seq: 8, reason: "message" });
  assert.deepEqual(hints, [{ agentId: "a1", targetId: "#all", seq: 7, reason: "message" }]);
  assert.equal(JSON.stringify(hints[0]).includes("content"), false);
});

test("notifyMessageWakes wakes every agent member of the channel except the author", () => {
  const alpha = createAgent({ name: "alpha" });
  const beta = createAgent({ name: "beta" });
  const channel = createChannel({ name: "wake-room" });
  joinChannel(channel.id, alpha.id);
  joinChannel(channel.id, beta.id);

  const hints = [];
  const unsub = subscribeWake((hint) => hints.push(hint));
  const message = sendAsOwner(channel.id, "hello agents");
  unsub();

  assert.deepEqual(hints.map((h) => h.agentId).sort(), [alpha.id, beta.id].sort());
  for (const hint of hints) {
    assert.equal(hint.targetId, channel.id);
    assert.equal(hint.seq, message.seq);
    assert.equal(hint.reason, "message");
  }
});

test("an agent's own message wakes the other agents but not itself", () => {
  const alpha = createAgent({ name: "selfie" });
  const beta = createAgent({ name: "peeper" });
  const channel = createChannel({ name: "self-room" });
  joinChannel(channel.id, alpha.id);
  joinChannel(channel.id, beta.id);

  const hints = [];
  const unsub = subscribeWake((hint) => hints.push(hint));
  sendMessage({ targetId: channel.id, authorId: alpha.id, content: "from alpha" });
  unsub();

  const woken = hints.map((h) => h.agentId);
  assert.ok(woken.includes(beta.id));
  assert.ok(!woken.includes(alpha.id));
});

test("an @mention wakes an agent that is not a member of the channel", () => {
  const alpha = createAgent({ name: "lurker" });
  const channel = createChannel({ name: "mention-room" }); // alpha 未加入

  const hints = [];
  const unsub = subscribeWake((hint) => hints.push(hint));
  sendAsOwner(channel.id, "hey @lurker please look");
  unsub();

  assert.deepEqual(hints.map((h) => h.agentId), [alpha.id]);
  assert.equal(hints[0].targetId, channel.id);
});

test("mentions of humans or unknown names do not wake anyone", () => {
  createAgent({ name: "quiet" });
  const channel = createChannel({ name: "mentionless" });
  const hints = [];
  const unsub = subscribeWake((hint) => hints.push(hint));
  sendAsOwner(channel.id, "hello @Owner and @nobody");
  unsub();
  assert.equal(hints.length, 0);
});

test("a thread message wakes the channel's agents with the anchor target id", () => {
  const alpha = createAgent({ name: "threadwake" });
  const channel = createChannel({ name: "wake-thread" });
  joinChannel(channel.id, alpha.id);
  const anchor = sendAsOwner(channel.id, "anchor");
  const hints = [];
  const unsub = subscribeWake((hint) => hints.push(hint));
  sendAsOwner(anchor.id, "thread ping");
  unsub();
  assert.deepEqual(hints.map((h) => h.targetId), [anchor.id]);
});

test("extractMentionedMemberIds matches @name tokens case-insensitively", () => {
  const alpha = createAgent({ name: "Casey" });
  const ids = extractMentionedMemberIds("tell @casey hi");
  assert.deepEqual(ids, [alpha.id]);
});

test("extractMentionedMemberIds matches quoted @\"name with spaces\" and ignores plain-token misses", () => {
  const spaced = createAgent({ name: "Bob Smith" });
  const alpha = createAgent({ name: "alice" });
  const ids = extractMentionedMemberIds('ask @"bob smith" and @alice — also @bob is a miss');
  assert.deepEqual(ids.slice().sort(), [spaced.id, alpha.id].sort());
});

test("extractMentionedMemberIds does not wake on an unknown quoted name", () => {
  const ids = extractMentionedMemberIds('@"nobody here" @ghost');
  assert.deepEqual(ids, []);
});

test("a muted channel member is not woken by normal messages but still by a personal @mention", () => {
  const alpha = createAgent({ name: "muted-wake" });
  const beta = createAgent({ name: "loud-wake" });
  const channel = createChannel({ name: "mute-wake" });
  joinChannel(channel.id, alpha.id);
  joinChannel(channel.id, beta.id);
  muteChannel(channel.id, alpha.id, OWNER_MEMBER_ID);

  const hints = [];
  const unsub = subscribeWake((hint) => hints.push(hint));
  sendAsOwner(channel.id, "ordinary chatter");
  unsub();
  assert.deepEqual(hints.map((h) => h.agentId), [beta.id], "muted member must not be woken");

  const hints2 = [];
  const unsub2 = subscribeWake((hint) => hints2.push(hint));
  sendAsOwner(channel.id, "hey @muted-wake your turn");
  unsub2();
  const woken = hints2.map((h) => h.agentId).sort();
  assert.deepEqual(woken, [alpha.id, beta.id].sort(), "muted member wakes on personal mention");
});

test("unmuting restores normal wake delivery", () => {
  const alpha = createAgent({ name: "unmute-wake" });
  const channel = createChannel({ name: "unmute-wake-room" });
  joinChannel(channel.id, alpha.id);
  muteChannel(channel.id, alpha.id, OWNER_MEMBER_ID);
  unmuteChannel(channel.id, alpha.id, OWNER_MEMBER_ID);

  const hints = [];
  const unsub = subscribeWake((hint) => hints.push(hint));
  sendAsOwner(channel.id, "post-unmute chatter");
  unsub();
  assert.deepEqual(hints.map((h) => h.agentId), [alpha.id]);
});
