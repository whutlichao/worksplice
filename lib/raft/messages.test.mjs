import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/db.ts";
import { OWNER_MEMBER_ID } from "../data/schema.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-messages-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createChannel, joinChannel, leaveChannel, setChannelArchived } = await import("./channels.ts");
const { createAgent } = await import("./members.ts");
const { sendMessage, listMessages, getMessageWithAuthor, getThreadInfo, formatQuote } = await import(
  "./messages.ts"
);
const { logRoundOutcome } = await import("./rounds.ts");

function freshChannel() {
  return createChannel({ name: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
}

test("sendMessage appends monotonically increasing seqs to the target", () => {
  const channel = freshChannel();
  const m1 = sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "first" });
  const m2 = sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "second" });

  assert.equal(m1.held, false);
  assert.equal(m1.message.seq, 1);
  assert.equal(m2.message.seq, 2);
  assert.equal(m2.message.target_id, channel.id);
  assert.equal(m2.message.author_id, OWNER_MEMBER_ID);
});

test("sendMessage with a stale baseSeq is held and writes nothing", () => {
  const channel = freshChannel();
  sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "one" });
  sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "two" });

  const result = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "stale write",
    baseSeq: 1,
  });

  assert.equal(result.held, true);
  assert.equal(result.roomSeq, 2);
  assert.ok(result.whatHappened.length > 0);
  assert.match(result.whatHappened, /2/);
  const seqs = globalThis.__workspliceDb.listMessages(channel.id).map((m) => m.seq);
  assert.deepEqual(seqs, [1, 2]);

  const ok = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "fresh write",
    baseSeq: 2,
  });
  assert.equal(ok.held, false);
  assert.equal(ok.message.seq, 3);
});

test("a top-level message is a valid thread target; first reply opens the thread", () => {
  const channel = freshChannel();
  const anchor = sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "anchor" }).message;
  const reply = sendMessage({ targetId: anchor.id, authorId: OWNER_MEMBER_ID, content: "reply" });

  assert.equal(reply.held, false);
  assert.equal(reply.message.target_id, anchor.id);
  assert.equal(reply.message.seq, 1);

  const thread = getThreadInfo(anchor.id);
  assert.equal(thread.anchor.id, anchor.id);
  assert.deepEqual(
    thread.messages.map((m) => m.seq),
    [1],
  );
});

test("threads cannot be nested", () => {
  const channel = freshChannel();
  const anchor = sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "anchor" }).message;
  const m = sendMessage({ targetId: anchor.id, authorId: OWNER_MEMBER_ID, content: "reply" }).message;

  assert.throws(
    () => sendMessage({ targetId: m.id, authorId: OWNER_MEMBER_ID, content: "deeper" }),
    /cannot be nested/,
  );
  const nestedAnchor = sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "anchor2" }).message;
  const inner = sendMessage({ targetId: nestedAnchor.id, authorId: OWNER_MEMBER_ID, content: "r" }).message;
  assert.throws(() => sendMessage({ targetId: inner.id, authorId: OWNER_MEMBER_ID, content: "x" }), /cannot be nested/);
});

test("listMessages attaches abandoned marks to the trigger message (§09)", () => {
  const channel = freshChannel();
  const bot = createAgent({ name: "bot" });
  const m1 = sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "hi" }).message;
  void m1;
  const m2 = sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "still there?" }).message;

  const page = listMessages(channel.id);
  assert.deepEqual(page.messages.map((m) => m.abandonedMarks ?? []), [[], []]);

  logRoundOutcome(bot.id, channel.id, { status: "silent", reason: "retries exhausted", baseSeq: m2.seq });
  const page2 = listMessages(channel.id);
  assert.deepEqual(page2.messages.map((m) => (m.abandonedMarks ?? []).map((x) => x.agentName)), [[], ["bot"]]);
  assert.equal(page2.messages[1].abandonedMarks[0].baseSeq, m2.seq);

  // 后续 replied 轮清除标记（最新一轮语义）
  logRoundOutcome(bot.id, channel.id, { status: "replied", baseSeq: m2.seq });
  const page3 = listMessages(channel.id);
  assert.deepEqual(page3.messages.map((m) => m.abandonedMarks ?? []), [[], []]);
});

test("archived channels freeze writes for the channel and its threads", () => {
  const channel = createChannel({ name: "frozen" });
  const anchor = sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "anchor" }).message;

  setChannelArchived(channel.id, 1, OWNER_MEMBER_ID);

  assert.throws(
    () => sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "late" }),
    /archived/,
  );
  assert.throws(
    () => sendMessage({ targetId: anchor.id, authorId: OWNER_MEMBER_ID, content: "late reply" }),
    /archived/,
  );
});

test("sending to a channel requires membership; thread replies inherit the channel rule", () => {
  const channel = createChannel({ name: "gated", type: "private" });
  const a = createAgent({ name: "outsider" });

  assert.throws(
    () => sendMessage({ targetId: channel.id, authorId: a.id, content: "intrude" }),
    /not a member/,
  );
  joinChannel(channel.id, a.id, OWNER_MEMBER_ID);
  const anchor = sendMessage({ targetId: channel.id, authorId: a.id, content: "in" }).message;
  assert.equal(anchor.author_id, a.id);

  leaveChannel(channel.id, a.id, a.id);
  assert.throws(
    () => sendMessage({ targetId: anchor.id, authorId: a.id, content: "after leave" }),
    /not a member/,
  );
});

test("unknown targets are rejected", () => {
  assert.throws(() => sendMessage({ targetId: "no-such-id", authorId: OWNER_MEMBER_ID, content: "x" }), /not found/);
  assert.throws(() => getMessageWithAuthor("no-such-id"), /not found/);
});

test("quote embeds a blockquote referencing the quoted message", () => {
  const channel = freshChannel();
  const original = sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "original line one\nline two" })
    .message;

  const result = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "my answer",
    quoteId: original.id,
  });

  assert.equal(result.held, false);
  assert.match(result.message.content, /^> /);
  assert.match(result.message.content, /#1/);
  assert.match(result.message.content, /Owner/);
  assert.match(result.message.content, /original line one/);
  assert.doesNotMatch(result.message.content, /line two/);

  assert.throws(
    () => sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "x", quoteId: "nope" }),
    /Quoted message not found/,
  );
});

test("formatQuote builds a preview blockquote with the author name", () => {
  const channel = freshChannel();
  const original = sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "hello world" }).message;
  const quote = formatQuote(original, "Owner");
  assert.equal(quote, "> **#1 Owner**\n> hello world\n\n");
});

test("listMessages pages by seq cursor from the latest page", () => {
  const channel = freshChannel();
  for (let i = 0; i < 7; i++) {
    sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: `page ${i}` });
  }

  const latest = listMessages(channel.id, { limit: 3 });
  assert.deepEqual(
    latest.messages.map((m) => m.seq),
    [5, 6, 7],
    "latest page must be the highest seqs in ASC order",
  );
  assert.equal(latest.hasMore, true);
  assert.equal(latest.maxSeq, 7);

  const older = listMessages(channel.id, { before: 5, limit: 3 });
  assert.deepEqual(
    older.messages.map((m) => m.seq),
    [2, 3, 4],
  );
  assert.equal(older.hasMore, true);

  const first = listMessages(channel.id, { before: 2, limit: 10 });
  assert.deepEqual(
    first.messages.map((m) => m.seq),
    [1],
  );
  assert.equal(first.hasMore, false);

  const empty = listMessages("no-such-target");
  assert.deepEqual(empty.messages, []);
  assert.equal(empty.hasMore, false);
});

test("thread replies count toward the channel maxSeq but have their own seq space", () => {
  const channel = createChannel({ name: "seq-space" });
  const a1 = sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "m1" }).message;
  sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "m2" });
  const r1 = sendMessage({ targetId: a1.id, authorId: OWNER_MEMBER_ID, content: "r1" }).message;
  const r2 = sendMessage({ targetId: a1.id, authorId: OWNER_MEMBER_ID, content: "r2" }).message;

  assert.equal(r1.seq, 1);
  assert.equal(r2.seq, 2);
  assert.equal(globalThis.__workspliceDb.maxSeq(a1.id), 2);
  assert.deepEqual(
    globalThis.__workspliceDb.listMessages(channel.id).map((m) => m.seq),
    [1, 2],
  );
  const thread = getThreadInfo(a1.id);
  assert.deepEqual(
    thread.messages.map((m) => m.seq),
    [1, 2],
  );
});

test("threadReplyCount: channel 分页批量附锚点回复数（UI 角标数据），thread 页自身为 0", () => {
  const channel = createChannel({ name: "reply-count" });
  const a1 = sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "m1" }).message;
  const a2 = sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "m2" }).message;
  sendMessage({ targetId: a1.id, authorId: OWNER_MEMBER_ID, content: "r1" });
  sendMessage({ targetId: a1.id, authorId: OWNER_MEMBER_ID, content: "r2" });

  const page = listMessages(channel.id);
  const bySeq = new Map(page.messages.map((m) => [m.seq, m]));
  assert.equal(bySeq.get(a1.seq)?.threadReplyCount, 2);
  assert.equal(bySeq.get(a2.seq)?.threadReplyCount, 0);
  // thread 页：回复消息自身回复数为 0（不可嵌套）
  const thread = listMessages(a1.id);
  assert.equal(thread.messages.length, 2);
  assert.equal(thread.messages.every((m) => m.threadReplyCount === 0), true);
  // 锚点视图（getThreadInfo.anchor）带真实回复数
  const info = getThreadInfo(a1.id);
  assert.equal(info.anchor.threadReplyCount, 2);
  // 单条查询
  assert.equal(getMessageWithAuthor(a1.id).threadReplyCount, 2);
});
