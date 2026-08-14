import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../../data/sqlite.ts";
import { OWNER_MEMBER_ID } from "../../data/schema.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-reactions-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createChannel, joinChannel } = await import("./channels.ts");
const { createAgent } = await import("./members.ts");
const { sendMessage } = await import("./messages.ts");
const { toggleReaction, listReactionSummaries } = await import("./reactions.ts");

function freshWorkspace() {
  return fs.mkdtempSync(path.join(root, "ws-"));
}

function freshChannel() {
  return createChannel({ name: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
}

function channelMessage(channelId, content = "hi") {
  const result = sendMessage({ targetId: channelId, authorId: OWNER_MEMBER_ID, content });
  return result.message;
}

test("toggleReaction adds on first click and removes on second (§3.4)", () => {
  const channel = freshChannel();
  const message = channelMessage(channel.id);

  const added = toggleReaction({ messageId: message.id, memberId: OWNER_MEMBER_ID, emoji: "👍" });
  assert.deepEqual(added, { active: true });
  assert.equal(globalThis.__workspliceDb.listReactions(message.id).length, 1);

  const removed = toggleReaction({ messageId: message.id, memberId: OWNER_MEMBER_ID, emoji: "👍" });
  assert.deepEqual(removed, { active: false });
  assert.equal(globalThis.__workspliceDb.listReactions(message.id).length, 0);
});

test("reactions are unique per (message, member, emoji): two members coexist, same member toggles", () => {
  const channel = freshChannel();
  const message = channelMessage(channel.id);
  const agent = createAgent({ name: `a-${Date.now()}`, workspacePath: freshWorkspace() });
  joinChannel(channel.id, agent.id);

  toggleReaction({ messageId: message.id, memberId: OWNER_MEMBER_ID, emoji: "❤️" });
  toggleReaction({ messageId: message.id, memberId: agent.id, emoji: "❤️" });
  toggleReaction({ messageId: message.id, memberId: OWNER_MEMBER_ID, emoji: "🎉" });

  const summaries = listReactionSummaries(message.id);
  const byEmoji = Object.fromEntries(summaries.map((s) => [s.emoji, s]));
  assert.deepEqual(byEmoji["❤️"].memberIds.sort(), [OWNER_MEMBER_ID, agent.id].sort());
  assert.equal(byEmoji["❤️"].count, 2);
  assert.equal(byEmoji["🎉"].count, 1);
  assert.deepEqual(byEmoji["🎉"].memberIds, [OWNER_MEMBER_ID]);
});

test("reactions work on thread messages (channel membership governs)", () => {
  const channel = freshChannel();
  const anchor = channelMessage(channel.id, "anchor");
  const reply = sendMessage({ targetId: anchor.id, authorId: OWNER_MEMBER_ID, content: "reply" }).message;

  toggleReaction({ messageId: reply.id, memberId: OWNER_MEMBER_ID, emoji: "👀" });
  assert.equal(listReactionSummaries(reply.id)[0].count, 1);
});

test("non-members cannot react to a channel's messages", () => {
  const channel = freshChannel();
  const message = channelMessage(channel.id);
  const stranger = createAgent({ name: `s-${Date.now()}`, workspacePath: freshWorkspace() });
  joinChannel(channel.id, OWNER_MEMBER_ID); // owner is already in; no-op

  assert.throws(
    () => toggleReaction({ messageId: message.id, memberId: stranger.id, emoji: "👍" }),
    /not a member/i,
  );
});

test("unknown message or invalid emoji is rejected", () => {
  assert.throws(() => toggleReaction({ messageId: "missing", memberId: OWNER_MEMBER_ID, emoji: "👍" }), /not found/i);
  const channel = freshChannel();
  const message = channelMessage(channel.id);
  assert.throws(() => toggleReaction({ messageId: message.id, memberId: OWNER_MEMBER_ID, emoji: "" }), /emoji/i);
  assert.throws(() => toggleReaction({ messageId: message.id, memberId: OWNER_MEMBER_ID, emoji: "a".repeat(64) }), /emoji/i);
});
