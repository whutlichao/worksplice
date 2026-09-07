import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../../data/sqlite.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-inbox-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createAgent } = await import("./members.ts");
// 名字唯一性（agent-name-uniqueness）：同一 DB 内多次创建用唯一后缀避免重名拒绝
let fixtureSeq = 0;
const { createChannel, joinChannel, muteChannel, unmuteChannel } = await import(
  "./channels.ts"
);
const { sendMessage } = await import("./messages.ts");
const {
  drain,
  ack,
  drainAndAck,
  getSince,
  getPendingTargets,
  listRelatedTasks,
  resolveTargetChannel,
} = await import("./inbox.ts");
const { OWNER_MEMBER_ID } = await import("../../data/schema.ts");

function sendAsOwner(targetId, content) {
  const result = sendMessage({ targetId, authorId: OWNER_MEMBER_ID, content });
  assert.equal(result.held, false);
  return result.message;
}

let channelCounter = 0;
function freshChannel(name) {
  return createChannel({ name: `${name}-${channelCounter++}` }).id;
}

test("getSince returns messages strictly after sinceSeq in ascending seq order", () => {
  const target = freshChannel("since");
  sendAsOwner(target, "one");
  sendAsOwner(target, "two");
  sendAsOwner(target, "three");

  const since = getSince(target, 1);
  assert.deepEqual(
    since.map((m) => m.content),
    ["two", "three"],
  );
  assert.deepEqual(
    since.map((m) => m.seq),
    [2, 3],
  );
  assert.ok(since[0].author);
});

test("drain returns the incremental since the consumed cursor without advancing it", () => {
  const agent = createAgent({ name: "drainer" });
  const target = freshChannel("drain");
  joinChannel(target, agent.id);
  sendAsOwner(target, "d-one");
  sendAsOwner(target, "d-two");

  const first = drain(agent.id, target);
  assert.equal(first.consumedSeq, 0);
  assert.equal(first.maxSeq, first.messages[first.messages.length - 1].seq);
  assert.deepEqual(
    first.messages.map((m) => m.content),
    ["d-one", "d-two"],
  );
  assert.equal(first.hasMore, false);

  // 未 ack：游标未动，再次 drain 同样内容（重复不丢）
  const again = drain(agent.id, target);
  assert.equal(again.messages.length, 2);

  // ack 后才推进
  ack(agent.id, target, first.maxSeq);
  assert.equal(
    globalThis.__workspliceDb.getConsumedSeq(agent.id, target),
    first.maxSeq,
  );
  const after = drain(agent.id, target);
  assert.equal(after.messages.length, 0);
});

test("drainAndAck drains and advances the cursor atomically (HTTP inbox 语义)", () => {
  const agent = createAgent({ name: "atomic" });
  const target = freshChannel("atomic");
  joinChannel(target, agent.id);
  sendAsOwner(target, "a-one");

  const result = drainAndAck(agent.id, target);
  assert.deepEqual(
    result.messages.map((m) => m.content),
    ["a-one"],
  );
  assert.equal(
    globalThis.__workspliceDb.getConsumedSeq(agent.id, target),
    result.maxSeq,
  );
  assert.equal(drainAndAck(agent.id, target).messages.length, 0);
});

test("thread messages are drained under the anchor target id", () => {
  const agent = createAgent({ name: "threader" });
  const target = freshChannel("threader");
  joinChannel(target, agent.id);
  const anchor = sendAsOwner(target, "anchor");
  const reply = sendMessage({
    targetId: anchor.id,
    authorId: OWNER_MEMBER_ID,
    content: "thread reply",
  });
  assert.equal(reply.held, false);

  const result = drain(agent.id, anchor.id);
  assert.deepEqual(
    result.messages.map((m) => m.content),
    ["thread reply"],
  );
  assert.equal(resolveTargetChannel(anchor.id)?.id, target);
});

test("getPendingTargets lists only channels with unconsumed messages for the agent", () => {
  const agent = createAgent({ name: "pending" });
  const channel = createChannel({ name: "pending-room" });
  joinChannel(channel.id, agent.id);
  sendAsOwner(channel.id, "p-one");

  assert.ok(getPendingTargets(agent.id).includes(channel.id));
  drainAndAck(agent.id, channel.id);
  assert.ok(!getPendingTargets(agent.id).includes(channel.id));
});

test("listRelatedTasks returns only open tasks anchored in the target", () => {
  const agent = createAgent({ name: "tasker" });
  const target = freshChannel("tasker");
  joinChannel(target, agent.id);
  const anchor = sendAsOwner(target, "task anchor");
  const doneAnchor = sendAsOwner(target, "done anchor");
  const other = sendAsOwner(target, "other anchor");
  const db = globalThis.__workspliceDb;
  db.insertTask({ messageId: anchor.id, number: 1, status: "todo" });
  db.insertTask({ messageId: doneAnchor.id, number: 2, status: "done" });
  db.insertTask({ messageId: other.id, number: 3, status: "in_progress" });

  const tasks = listRelatedTasks(anchor.id);
  assert.deepEqual(
    tasks.map((t) => t.number),
    [1],
  );
  assert.equal(tasks[0].status, "todo");
  assert.equal(tasks[0].ownerName, "unassigned");
});

test("muted channels suppress normal messages from drain but personal @mentions penetrate", () => {
  const agent = createAgent({ name: "muted" });
  const target = freshChannel("muted");
  joinChannel(target, agent.id);
  sendAsOwner(target, "pre-mute hello");
  muteChannel(target, agent.id, OWNER_MEMBER_ID);
  sendAsOwner(target, "post-mute normal");
  const mention = sendAsOwner(target, "hey @muted look at this");
  sendAsOwner(target, "post-mute normal 2");

  const result = drain(agent.id, target);
  // 静音前照常投递；静音后的普通消息被压制；个人 @mention 仍穿透
  assert.deepEqual(
    result.messages.map((m) => m.content),
    ["pre-mute hello", "hey @muted look at this"],
  );
  assert.equal(mention.seq, 3);
  assert.equal(result.maxSeq, 4);
});

test("drainAndAck advances past suppressed muted messages; unmute does not replay them", () => {
  const agent = createAgent({ name: "unmuted" });
  const target = freshChannel("unmute");
  joinChannel(target, agent.id);
  muteChannel(target, agent.id, OWNER_MEMBER_ID);
  sendAsOwner(target, "while muted");

  const first = drainAndAck(agent.id, target);
  assert.equal(first.messages.length, 0);
  assert.equal(
    globalThis.__workspliceDb.getConsumedSeq(agent.id, target),
    first.maxSeq,
  );

  // 取消 mute：游标已在 maxSeq，静音期间的消息不补投，只收新消息
  unmuteChannel(target, agent.id, OWNER_MEMBER_ID);
  sendAsOwner(target, "after unmute");
  const after = drain(agent.id, target);
  assert.deepEqual(
    after.messages.map((m) => m.content),
    ["after unmute"],
  );
});

test("getPendingTargets skips muted channels without a mention and includes them on mention", () => {
  // 名字唯一性（agent-name-uniqueness）：同文件早前用例已占用 "pending"，此处用唯一后缀
  const agent = createAgent({ name: `pending-${++fixtureSeq}` });
  const muted = freshChannel("pending-muted");
  joinChannel(muted, agent.id);
  const loud = freshChannel("pending-loud");
  joinChannel(loud, agent.id);

  muteChannel(muted, agent.id, OWNER_MEMBER_ID);
  sendAsOwner(muted, "muted chatter");
  sendAsOwner(loud, "loud chatter");

  const pending = getPendingTargets(agent.id);
  assert.deepEqual(pending, [loud]);

  sendAsOwner(muted, `hey @${agent.name} come here`);
  const pending2 = getPendingTargets(agent.id);
  assert.deepEqual(pending2.sort(), [loud, muted].sort());
});

test("mute applies to thread messages through the anchor's channel", () => {
  const agent = createAgent({ name: "threadmute" });
  const target = freshChannel("muted-thread");
  joinChannel(target, agent.id);
  const anchor = sendAsOwner(target, "anchor");
  muteChannel(target, agent.id, OWNER_MEMBER_ID);
  sendAsOwner(anchor.id, "thread noise");

  const result = drain(agent.id, anchor.id);
  assert.equal(result.messages.length, 0);

  const mention = sendAsOwner(anchor.id, "@threadmute ping in thread");
  const result2 = drain(agent.id, anchor.id);
  assert.deepEqual(
    result2.messages.map((m) => m.content),
    ["@threadmute ping in thread"],
  );
  assert.equal(mention.seq, 2);
});
