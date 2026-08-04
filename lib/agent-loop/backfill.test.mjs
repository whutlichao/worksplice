import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/db.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-backfill-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createAgent, getAgent } = await import("../raft/members.ts");
const { createChannel, joinChannel } = await import("../raft/channels.ts");
const { sendMessage } = await import("../raft/messages.ts");
const { scanSessionReplies, backfillAgentReplies, backfillAllAgents } = await import(
  "./backfill.ts"
);
const { subscribeWake } = await import("./wake.ts");
const { roomMarker, buildRevisionPrompt } = await import("./loop.ts");
const { OWNER_MEMBER_ID } = await import("../data/schema.ts");

function sendAsOwner(targetId, content) {
  const result = sendMessage({ targetId, authorId: OWNER_MEMBER_ID, content });
  assert.equal(result.held, false);
  return result.message;
}

function writeSessionFile(agent, entries) {
  const file = path.join(root, `${agent.id}.jsonl`);
  fs.writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  globalThis.__workspliceDb.setMemberPiSessionFile(agent.id, file);
  return file;
}

function userEntry(content) {
  return { type: "message", id: `u-${Math.random().toString(36).slice(2)}`, parentId: null, timestamp: "", message: { role: "user", content } };
}

function assistantEntry(text) {
  const content = typeof text === "string" ? [{ type: "text", text }] : text;
  return { type: "message", id: `a-${Math.random().toString(36).slice(2)}`, parentId: null, timestamp: "", message: { role: "assistant", content, model: "m", provider: "p" } };
}

function headerEntry(cwd) {
  return { type: "session", version: 3, id: "sess", timestamp: "", cwd };
}

test("scanSessionReplies extracts assistant replies after room markers", () => {
  const file = path.join(root, "scan.jsonl");
  fs.writeFileSync(
    file,
    [
      JSON.stringify(headerEntry("/ws")),
      JSON.stringify(userEntry(`hello ${roomMarker("#all", 5)}`)),
      JSON.stringify(assistantEntry("first reply")),
      JSON.stringify(userEntry(`another ${roomMarker("#all", 9)}`)),
      JSON.stringify(assistantEntry("second reply")),
      JSON.stringify(assistantEntry([{ type: "thinking", thinking: "hmm" }])),
    ].join("\n") + "\n",
  );
  const replies = scanSessionReplies(file);
  assert.deepEqual(replies, [
    { targetId: "#all", markerSeq: 5, content: "first reply" },
    { targetId: "#all", markerSeq: 9, content: "second reply" },
  ]);
});

test("assistant messages before any marker are skipped", () => {
  const file = path.join(root, "nomarker.jsonl");
  fs.writeFileSync(
    file,
    [JSON.stringify(headerEntry("/ws")), JSON.stringify(assistantEntry("orphan reply"))].join("\n") + "\n",
  );
  assert.deepEqual(scanSessionReplies(file), []);
});

test("backfillAgentReplies writes missing replies into SQLite with fresh seqs and advances the cursor", () => {
  const agent = createAgent({ name: "recover" });
  const channel = createChannel({ name: "recover-room" });
  joinChannel(channel.id, agent.id);
  sendAsOwner(channel.id, "human one"); // seq 1（已在 SQLite）
  const file = writeSessionFile(agent, [
    headerEntry("/ws"),
    userEntry(`drain ${roomMarker(channel.id, 1)}`),
    assistantEntry("reply that crashed before SQLite write"),
  ]);

  const result = backfillAgentReplies(getAgent(agent.id));
  assert.equal(result.inserted, 1);
  assert.deepEqual(result.targets, [channel.id]);

  const messages = globalThis.__workspliceDb.listMessages(channel.id);
  assert.equal(messages.length, 2);
  assert.equal(messages[1].seq, 2);
  assert.equal(messages[1].author_id, agent.id);
  assert.equal(messages[1].content, "reply that crashed before SQLite write");
  // 游标推进到标记 seq（agent 已读到 seq 1 的全部内容）
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 1);
  assert.ok(fs.existsSync(file));
});

test("backfill is idempotent: existing replies are not duplicated", () => {
  const agent = createAgent({ name: "twice" });
  const channel = createChannel({ name: "twice-room" });
  joinChannel(channel.id, agent.id);
  sendAsOwner(channel.id, "hello");
  writeSessionFile(agent, [
    headerEntry("/ws"),
    userEntry(roomMarker(channel.id, 1)),
    assistantEntry("already there"),
  ]);

  assert.equal(backfillAgentReplies(getAgent(agent.id)).inserted, 1);
  assert.equal(backfillAgentReplies(getAgent(agent.id)).inserted, 0);
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 2);
});

test("a JSON protocol reply is stored as its parsed content, not the envelope", () => {
  const agent = createAgent({ name: "jsonenv" });
  const channel = createChannel({ name: "jsonenv-room" });
  joinChannel(channel.id, agent.id);
  sendAsOwner(channel.id, "ask");
  writeSessionFile(agent, [
    headerEntry("/ws"),
    userEntry(roomMarker(channel.id, 1)),
    assistantEntry('{"action":"reply","content":"parsed hello","onConflict":"revise"}'),
  ]);

  assert.equal(backfillAgentReplies(getAgent(agent.id)).inserted, 1);
  const messages = globalThis.__workspliceDb.listMessages(channel.id);
  assert.equal(messages[messages.length - 1].content, "parsed hello");
});

test("an ignore reply is not backfilled", () => {
  const agent = createAgent({ name: "ignorer" });
  const channel = createChannel({ name: "ignorer-room" });
  joinChannel(channel.id, agent.id);
  writeSessionFile(agent, [
    headerEntry("/ws"),
    userEntry(roomMarker(channel.id, 0)),
    assistantEntry('{"action":"ignore"}'),
  ]);

  assert.equal(backfillAgentReplies(getAgent(agent.id)).inserted, 0);
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 0);
});

test("revise drafts are dropped: only the last assistant reply of a marker round is backfilled", () => {
  const agent = createAgent({ name: "drafter" });
  const channel = createChannel({ name: "drafter-room" });
  joinChannel(channel.id, agent.id);
  sendAsOwner(channel.id, "original");
  sendAsOwner(channel.id, "changed while writing");
  const revisionPrompt = buildRevisionPrompt({
    channel,
    originalContent: "draft text",
    held: { roomSeq: 2, whatHappened: "1 new message(s) arrived in this target (seq 2)" },
    newMessages: [],
    targetId: channel.id,
  });
  writeSessionFile(agent, [
    headerEntry("/ws"),
    userEntry(roomMarker(channel.id, 1)),
    assistantEntry('{"action":"reply","content":"draft text","onConflict":"revise"}'),
    userEntry(revisionPrompt),
    assistantEntry('{"action":"reply","content":"revised text","onConflict":"silent"}'),
  ]);

  const result = backfillAgentReplies(getAgent(agent.id));
  assert.equal(result.inserted, 1);
  const messages = globalThis.__workspliceDb.listMessages(channel.id);
  assert.equal(messages.length, 3);
  assert.equal(messages[messages.length - 1].content, "revised text");
  assert.ok(!messages.some((m) => m.content === "draft text"), "草稿不得落库");
});

test("cursor advances for already-delivered rounds (崩溃于补写后 ack 前)", () => {
  const agent = createAgent({ name: "lateack" });
  const channel = createChannel({ name: "lateack-room" });
  joinChannel(channel.id, agent.id);
  sendAsOwner(channel.id, "human");
  // 回复已在 SQLite（崩溃发生在补写之后、ack 之前），jsonl 里标记轮完整
  sendMessage({ targetId: channel.id, authorId: agent.id, content: "reply already written" });
  writeSessionFile(agent, [
    headerEntry("/ws"),
    userEntry(roomMarker(channel.id, 1)),
    assistantEntry("reply already written"),
  ]);

  const result = backfillAgentReplies(getAgent(agent.id));
  assert.equal(result.inserted, 0);
  assert.equal(
    globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id),
    1,
    "标记存在即证明该轮已投递，游标推进到标记 seq",
  );
});

test("backfill skips agents without a session file or with a missing file", () => {
  const noFile = createAgent({ name: "nofile" });
  assert.deepEqual(backfillAgentReplies(noFile), { inserted: 0, targets: [] });

  const missing = createAgent({ name: "missingfile" });
  globalThis.__workspliceDb.setMemberPiSessionFile(missing.id, path.join(root, "nope.jsonl"));
  assert.deepEqual(backfillAgentReplies(missing), { inserted: 0, targets: [] });
});

test("backfillAllAgents covers every agent and does not wake the loop", () => {
  const agent = createAgent({ name: "everyone" });
  const channel = createChannel({ name: "everyone-room" });
  joinChannel(channel.id, agent.id);
  writeSessionFile(agent, [
    headerEntry("/ws"),
    userEntry(roomMarker(channel.id, 0)),
    assistantEntry("boot recovery reply"),
  ]);

  const hints = [];
  const unsub = subscribeWake((hint) => hints.push(hint));
  const result = backfillAllAgents();
  unsub();

  assert.ok(result.inserted >= 1);
  assert.ok(result.targets.includes(channel.id));
  assert.equal(hints.length, 0, "backfill must not re-wake the loop");
});
