import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../../data/sqlite.ts";
import { BUILTIN_CHANNEL_ID, OWNER_MEMBER_ID } from "../../data/schema.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-events-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const {
  createChannel,
  joinChannel,
  leaveChannel,
  setChannelArchived,
  muteChannel,
  isChannelMember,
} = await import("./channels.ts");
const { createAgent, deleteAgent, extractMentionedMemberIds } = await import("./members.ts");
const { listMessages } = await import("./messages.ts");
const { subscribeWake } = await import("./wake.ts");

const wakes = [];
const unsubscribe = subscribeWake((hint) => wakes.push(hint));
test.after(() => unsubscribe());

function susanId() {
  const row = globalThis.__workspliceDb
    .listMembers()
    .find((m) => m.name === "Susan" && m.type === "agent");
  assert.ok(row, "Susan must exist");
  return row.id;
}

function lastMessage(targetId) {
  const page = listMessages(targetId);
  return page.messages[page.messages.length - 1];
}

test("no live Susan -> join/create/createAgent produce no event messages", () => {
  const x = createAgent({ name: "worker-no-susan" });
  const channel = createChannel({ name: "quiet-room" });
  joinChannel(channel.id, x.id, x.id);

  assert.equal(listMessages(channel.id).messages.length, 0);
  assert.equal(listMessages(BUILTIN_CHANNEL_ID).messages.length, 0);
  assert.deepEqual(wakes, []);
});

test("agent joining a channel posts an owner-signed event with @Susan and wakes only Susan", () => {
  const susan = createAgent({ name: "Susan" });
  const x = createAgent({ name: "alice" });
  const y = createAgent({ name: "bob" });
  const channel = createChannel({ name: "team" });
  globalThis.__workspliceDb.addChannelMember(channel.id, y.id); // 已有成员（不触发事件）
  wakes.length = 0;

  joinChannel(channel.id, x.id, x.id);

  const msg = lastMessage(channel.id);
  assert.ok(msg, "event message must exist in the joined channel");
  assert.equal(msg.author_id, OWNER_MEMBER_ID);
  assert.equal(msg.content, "@Susan 新成员 @alice 加入频道");
  assert.deepEqual(wakes, [
    { agentId: susan.id, targetId: channel.id, seq: msg.seq, reason: "message" },
  ]);
});

test("Susan joining a channel is silent (no welcome-herself)", () => {
  const channel = createChannel({ name: "silent-1" });
  const before = listMessages(channel.id).messages.length; // 创建事件消息（§7 报到）
  wakes.length = 0;

  joinChannel(channel.id, susanId(), susanId());

  assert.equal(listMessages(channel.id).messages.length, before);
  assert.deepEqual(wakes, []);
});

test("owner joining is silent", () => {
  const channel = createChannel({ name: "silent-2" });
  const before = listMessages(channel.id).messages.length; // 创建事件消息（§7 报到）
  wakes.length = 0;

  joinChannel(channel.id, OWNER_MEMBER_ID, OWNER_MEMBER_ID);
  assert.equal(listMessages(channel.id).messages.length, before);
  assert.deepEqual(wakes, []);

  // 离开后重新加入（真正的新加入）同样不投（加入者 = Owner）
  leaveChannel(channel.id, OWNER_MEMBER_ID, OWNER_MEMBER_ID);
  wakes.length = 0;
  joinChannel(channel.id, OWNER_MEMBER_ID, OWNER_MEMBER_ID);
  assert.equal(listMessages(channel.id).messages.length, before);
  assert.deepEqual(wakes, []);
});

test("creating a channel posts the report event in the new channel and wakes Susan", () => {
  wakes.length = 0;

  const channel = createChannel({ name: "launch" });

  const msg = lastMessage(channel.id);
  assert.ok(msg, "event message must exist in the new channel");
  assert.equal(msg.author_id, OWNER_MEMBER_ID);
  assert.equal(msg.content, "@Susan 新频道 #launch 已建立");
  assert.deepEqual(wakes, [
    { agentId: susanId(), targetId: channel.id, seq: msg.seq, reason: "message" },
  ]);
});

test("private channel without Susan -> report event delivered to #all", () => {
  wakes.length = 0;

  const channel = createChannel({ name: "top-secret", type: "private" });

  assert.equal(isChannelMember(channel.id, susanId()), false);
  assert.equal(listMessages(channel.id).messages.length, 0);
  const allMsg = lastMessage(BUILTIN_CHANNEL_ID);
  assert.equal(allMsg.content, "@Susan 新频道 #top-secret 已建立");
  assert.equal(wakes.length, 1);
  assert.equal(wakes[0].agentId, susanId());
  assert.equal(wakes[0].targetId, BUILTIN_CHANNEL_ID);
  assert.equal(wakes[0].seq, allMsg.seq);
});

test("creating an agent posts the welcome event in #all", () => {
  wakes.length = 0;

  const x = createAgent({ name: "carol" });

  const msg = lastMessage(BUILTIN_CHANNEL_ID);
  assert.equal(msg.content, "@Susan 新成员 @carol 加入频道");
  assert.deepEqual(wakes, [
    { agentId: susanId(), targetId: BUILTIN_CHANNEL_ID, seq: msg.seq, reason: "message" },
  ]);
  const mentioned = extractMentionedMemberIds(msg.content);
  assert.ok(mentioned.includes(x.id), "joiner mention must resolve");
  assert.ok(mentioned.includes(susanId()), "@Susan mention must resolve");
});

test("agent names with spaces are quoted in the mention", () => {
  wakes.length = 0;

  const x = createAgent({ name: "Jane Doe" });

  const msg = lastMessage(BUILTIN_CHANNEL_ID);
  assert.equal(msg.content, '@Susan 新成员 @"Jane Doe" 加入频道');
  assert.ok(extractMentionedMemberIds(msg.content).includes(x.id));
});

test("creating an agent named Susan is silent (exclusion)", () => {
  const before = globalThis.__workspliceDb.maxSeq(BUILTIN_CHANNEL_ID);
  wakes.length = 0;

  // 名字唯一性（agent-name-uniqueness）：秘书名不可双活——先软删原 Susan 释放名字，
  // 验证「创建 Susan 不产生事件/唤醒」的排除规则，再重建秘书还原单秘书状态（重建同样静默）。
  deleteAgent(susanId());
  wakes.length = 0;
  const s2 = createAgent({ name: "Susan" });
  deleteAgent(s2.id);
  wakes.length = 0;
  createAgent({ name: "Susan" });

  assert.equal(globalThis.__workspliceDb.maxSeq(BUILTIN_CHANNEL_ID), before);
  assert.deepEqual(wakes, []);
});

test("joining as an already-member is silent (idempotent join)", () => {
  const channel = createChannel({ name: "dup" });
  const created = listMessages(channel.id).messages.length; // 创建事件消息
  const x = createAgent({ name: "dave" });
  joinChannel(channel.id, x.id, x.id); // 首次加入 → 事件
  assert.equal(listMessages(channel.id).messages.length, created + 1);

  wakes.length = 0;
  joinChannel(channel.id, x.id, x.id);
  assert.equal(listMessages(channel.id).messages.length, created + 1);
  assert.deepEqual(wakes, []);
});

test("owner not in channel -> agent join still succeeds but no event", () => {
  const channel = createChannel({ name: "ownerless" });
  const before = listMessages(channel.id).messages.length; // 创建事件消息
  leaveChannel(channel.id, OWNER_MEMBER_ID, OWNER_MEMBER_ID);
  const x = createAgent({ name: "erin" });
  wakes.length = 0;

  joinChannel(channel.id, x.id, x.id); // 不得抛错（事件投递尽力而为）

  assert.equal(isChannelMember(channel.id, x.id), true);
  assert.equal(listMessages(channel.id).messages.length, before);
  assert.deepEqual(wakes, []);
});

test("Susan removed from a channel -> join event delivered to #all (§7)", () => {
  const channel = createChannel({ name: "leaver" });
  leaveChannel(channel.id, susanId(), OWNER_MEMBER_ID); // Owner 移除秘书
  const x = createAgent({ name: "heidi" });
  wakes.length = 0;

  joinChannel(channel.id, x.id, x.id);

  assert.equal(listMessages(channel.id).messages.length, 1); // 只有创建事件消息
  const allMsg = lastMessage(BUILTIN_CHANNEL_ID);
  assert.equal(allMsg.content, "@Susan 新成员 @heidi 加入频道");
  assert.equal(wakes.length, 1);
  assert.equal(wakes[0].targetId, BUILTIN_CHANNEL_ID);
});

test("joining an archived channel does not fail the join nor post an event", () => {
  const channel = createChannel({ name: "archived-room" });
  const before = listMessages(channel.id).messages.length; // 创建事件消息
  setChannelArchived(channel.id, true, OWNER_MEMBER_ID);
  const x = createAgent({ name: "grace" });
  wakes.length = 0;

  joinChannel(channel.id, x.id, x.id); // 不得抛错

  assert.equal(listMessages(channel.id).messages.length, before);
  assert.deepEqual(wakes, []);
});

test("event wake penetrates channel mute (personal mention semantics)", () => {
  const channel = createChannel({ name: "muted-room" });
  globalThis.__workspliceDb.addChannelMember(channel.id, susanId());
  muteChannel(channel.id, susanId(), OWNER_MEMBER_ID);
  const x = createAgent({ name: "frank" });
  wakes.length = 0;

  joinChannel(channel.id, x.id, x.id);

  assert.equal(wakes.length, 1);
  assert.equal(wakes[0].agentId, susanId());
  assert.equal(wakes[0].targetId, channel.id);
  assert.equal(wakes[0].reason, "message");
});
