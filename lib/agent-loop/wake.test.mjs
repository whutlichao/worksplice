import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/sqlite.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-wake-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const {
  analyzeMessageWindow,
  createAgent,
  createChannel,
  createDirectChannel,
  createRoundWindowDirectory,
  createTask,
  decideRoundAdmission,
  emitWake,
  extractMentionedMemberIds,
  joinChannel,
  messageWithAuthor,
  muteChannel,
  sendMessage,
  selectMessageInvitations,
  selectSecretaryHandoffTask,
  setChannelChief,
  setGlobalChief,
  subscribeWake,
  unmuteChannel,
} = await import('../domain/collab/index.ts');
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

test("an Owner @all wakes every agent member of the channel", () => {
  const alpha = createAgent({ name: "alpha" });
  const beta = createAgent({ name: "beta" });
  const channel = createChannel({ name: "wake-room" });
  joinChannel(channel.id, alpha.id);
  joinChannel(channel.id, beta.id);

  const hints = [];
  const unsub = subscribeWake((hint) => hints.push(hint));
  const message = sendAsOwner(channel.id, "hello @all agents");
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

test("a task-creation event wakes the channel's effective chief, not the global chief", () => {
  const globalChief = createAgent({ name: "wake-task-global" });
  setGlobalChief(globalChief.id);
  try {
    const channel = createChannel({ name: "wake-task-chief" });
    const channelChief = createAgent({ name: "wake-task-local" });
    joinChannel(channel.id, channelChief.id);
    setChannelChief(channel.id, channelChief.id);
    const anchor = sendAsOwner(channel.id, "please route this task");

    const hints = [];
    const unsub = subscribeWake((hint) => hints.push(hint));
    createTask({ messageId: anchor.id });
    unsub();

    assert.deepEqual(
      hints.map((hint) => hint.agentId),
      [channelChief.id],
      "the task event is delivered to exactly one effective chief",
    );
    assert.equal(
      hints.some((hint) => hint.agentId === globalChief.id),
      false,
      "the global chief is only the fallback when the channel has no effective channel chief",
    );
  } finally {
    setGlobalChief(null);
  }
});

test("a unique Task #N reference wakes the channel chief, not the global chief", () => {
  const globalChief = createAgent({ name: "wake-ref-global" });
  setGlobalChief(globalChief.id);
  try {
    const channel = createChannel({ name: "wake-ref-chief" });
    const channelChief = createAgent({ name: "wake-ref-local" });
    joinChannel(channel.id, channelChief.id);
    setChannelChief(channel.id, channelChief.id);
    const anchor = sendAsOwner(channel.id, "please route this task");
    const task = createTask({ messageId: anchor.id });

    const hints = [];
    const unsub = subscribeWake((hint) => hints.push(hint));
    sendAsOwner(channel.id, `Task #${task.number} needs an owner`);
    unsub();

    assert.deepEqual(
      hints.map((hint) => hint.agentId),
      [channelChief.id],
      "task routing follows the channel's effective chief exactly once",
    );
    assert.equal(hints.some((hint) => hint.agentId === globalChief.id), false);
  } finally {
    setGlobalChief(null);
  }
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

test('an Owner DM mention wakes a DM member and a nonmember agent', () => {
  const susan = createAgent({ name: 'dm-owner-recipient' });
  const matt = createAgent({ name: 'dm-nonmember-target' });
  const dm = createDirectChannel(susan.id);

  const hints = [];
  const unsub = subscribeWake((hint) => hints.push(hint));
  sendAsOwner(dm.id, 'Please take a look, @dm-nonmember-target');
  unsub();

  assert.deepEqual(
    hints.map((hint) => hint.agentId).sort(),
    [susan.id, matt.id].sort(),
  );
});

test('an agent-authored channel mention does not wake a nonmember agent (Ticket #237)', () => {
  const author = createAgent({ name: 'channel-mention-author' });
  createAgent({ name: 'channel-mention-target' });
  const channel = createChannel({ name: 'agent-mention-room', type: 'private', memberIds: [author.id] });

  const hints = [];
  const unsub = subscribeWake((hint) => hints.push(hint));
  sendMessage({
    targetId: channel.id,
    authorId: author.id,
    content: 'Please review this, @channel-mention-target today.',
  });
  unsub();

  assert.deepEqual(hints.map((hint) => hint.agentId), []);
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

test("a human thread mention wakes the mentioned agent with the anchor target id", () => {
  const alpha = createAgent({ name: "threadwake" });
  const channel = createChannel({ name: "wake-thread" });
  joinChannel(channel.id, alpha.id);
  const anchor = sendAsOwner(channel.id, "anchor");
  const hints = [];
  const unsub = subscribeWake((hint) => hints.push(hint));
  sendAsOwner(anchor.id, `@${alpha.name} thread ping`);
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

test("a muted channel member is not woken by normal agent messages but still by a human @mention", () => {
  const alpha = createAgent({ name: "muted-wake" });
  const beta = createAgent({ name: "loud-wake" });
  const channel = createChannel({ name: "mute-wake" });
  joinChannel(channel.id, alpha.id);
  joinChannel(channel.id, beta.id);
  muteChannel(channel.id, alpha.id, OWNER_MEMBER_ID);

  const hints = [];
  const unsub = subscribeWake((hint) => hints.push(hint));
  sendMessage({ targetId: channel.id, authorId: beta.id, content: "ordinary chatter" });
  unsub();
  assert.deepEqual(hints.map((h) => h.agentId), [], "muted member must not be woken");

  const hints2 = [];
  const unsub2 = subscribeWake((hint) => hints2.push(hint));
  sendAsOwner(channel.id, "hey @muted-wake your turn");
  unsub2();
  const woken = hints2.map((h) => h.agentId).sort();
  assert.deepEqual(woken, [alpha.id], "muted member wakes on human personal mention");
});

test("unmuting restores normal wake delivery", () => {
  const alpha = createAgent({ name: "unmute-wake" });
  const beta = createAgent({ name: "unmute-sender" });
  const channel = createChannel({ name: "unmute-wake-room" });
  joinChannel(channel.id, alpha.id);
  joinChannel(channel.id, beta.id);
  muteChannel(channel.id, alpha.id, OWNER_MEMBER_ID);
  unmuteChannel(channel.id, alpha.id, OWNER_MEMBER_ID);

  const hints = [];
  const unsub = subscribeWake((hint) => hints.push(hint));
  sendMessage({ targetId: channel.id, authorId: beta.id, content: "post-unmute chatter" });
  unsub();
  assert.deepEqual(hints.map((h) => h.agentId), [alpha.id]);
});

test("window length 1: a real human message's wake recipients equal the admission verdict", () => {
  const alpha = createAgent({ name: "equivalence-alpha" });
  const beta = createAgent({ name: "equivalence-beta" });
  const chief = createAgent({ name: "equivalence-chief" });
  const channel = createChannel({ name: "equivalence-room" });
  for (const member of [alpha, beta, chief]) {
    joinChannel(channel.id, member.id);
  }
  setChannelChief(channel.id, chief.id);
  try {
    const anchor = sendAsOwner(channel.id, "please route this task");
    const task = createTask({ messageId: anchor.id });

    const hints = [];
    const unsubscribe = subscribeWake((hint) => hints.push(hint));
    const message = sendAsOwner(
      channel.id,
      `@${alpha.name} Task #${task.number} needs an owner`,
    );
    unsubscribe();

    const handoff = selectSecretaryHandoffTask({
      secretary: chief,
      channel,
      targetId: channel.id,
      messages: [messageWithAuthor(message)],
    });
    const handoffChief = handoff.kind === "handoff" ? chief.id : null;
    const verdict = analyzeMessageWindow({
      message: messageWithAuthor(message),
      channel,
      targetId: channel.id,
      task: null,
      invitations: selectMessageInvitations({
        targetId: channel.id,
        authorId: OWNER_MEMBER_ID,
        content: message.content,
      }),
      handoffChief,
      directory: createRoundWindowDirectory(),
    });

    const woken = hints.map((hint) => hint.agentId).sort();
    assert.deepEqual([...verdict.wakeRecipients].sort(), woken);
    assert.deepEqual(woken, [alpha.id, chief.id].sort());

    for (const member of [alpha, beta, chief]) {
      const admission = decideRoundAdmission({
        agentId: member.id,
        isDM: false,
        isMember: true,
        isTaskThread: false,
        task: null,
        reason: "message",
        continuing: false,
        ...verdict.signalsFor({
          id: member.id,
          type: "agent",
          isMember: true,
        }),
        isEffectiveChief: member.id === chief.id,
        secretaryHandoff: handoffChief === member.id,
      });
      assert.equal(
        admission.admit,
        woken.includes(member.id),
        `${member.name}: admission verdict must agree with wake delivery`,
      );
    }
  } finally {
    setChannelChief(channel.id, null);
  }
});

test('an agent-authored DM mention does not wake a nonmember agent', () => {
  const susan = createAgent({ name: 'Susan' });
  const matt = createAgent({ name: 'MattDev' });
  const dm = createDirectChannel(susan.id);

  const hints = [];
  const unsub = subscribeWake((hint) => hints.push(hint));
  sendMessage({
    targetId: dm.id,
    authorId: susan.id,
    content: `I was thinking about @${matt.name} today.`,
  });
  unsub();

  assert.deepEqual(hints.map((hint) => hint.agentId), []);
});
