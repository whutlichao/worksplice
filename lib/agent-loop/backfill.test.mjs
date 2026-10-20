import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/sqlite.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-backfill-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createAgent, getAgent, deleteAgent } = await import("../domain/collab/members.ts");
const { createChannel, joinChannel } = await import("../domain/collab/channels.ts");
const { sendMessage } = await import("../domain/collab/messages.ts");
const { scanSessionReplies, backfillAgentReplies, backfillAllAgents } = await import(
  "./loop.ts"
);
const { subscribeWake } = await import("../domain/collab/wake.ts");
const { roomMarker, buildRevisionPrompt } = await import("./loop.ts");
const { OWNER_MEMBER_ID } = await import("../data/schema.ts");

function sendAsOwner(targetId, content) {
  const result = sendMessage({ targetId, authorId: OWNER_MEMBER_ID, content });
  assert.equal(result.held, false);
  return result.message;
}

function writeSessionFile(agent, entries) {
  const file = path.join(root, `${agent.id}.jsonl`);
  // ticket 04 门禁需要 header cwd == 成员 workspace；既有用例的 header 哨兵值 "/ws"
  // 在此自动修正为 agent 真实 workspace（跨 cwd 用例用非 "/ws" 的 header 规避修正）。
  const fixed = entries.map((entry, i) =>
    i === 0 && entry.type === "session" && entry.cwd === "/ws"
      ? { ...entry, cwd: getAgent(agent.id).workspace_path }
      : entry,
  );
  fs.writeFileSync(file, fixed.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
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

/** 一个带房间标记的协作轮：marker 记的是该轮 target 与其版本 seq（回复内容按协议解析后落库）。 */
function writeMarkerRound(agent, markerTarget, markerSeq, replyText) {
  return writeSessionFile(agent, [
    headerEntry("/ws"),
    userEntry(`drain ${roomMarker(markerTarget, markerSeq)}`),
    assistantEntry(replyText),
  ]);
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

test("backfill treats ENOENT as a missing file but propagates permission errors", async () => {
  const agent = createAgent({ name: "io-errors" });
  globalThis.__workspliceDb.setMemberPiSessionFile(agent.id, path.join(root, "io-errors.jsonl"));
  const missing = Object.assign(new Error("gone"), { code: "ENOENT" });
  const denied = Object.assign(new Error("permission denied"), { code: "EACCES" });
  const fileOps = (error) => ({
    stat: async () => {
      throw error;
    },
    readFile: async () => "",
  });

  assert.deepEqual(
    await backfillAgentReplies(getAgent(agent.id), { fileOps: fileOps(missing) }),
    { inserted: 0, targets: [] },
  );
  await assert.rejects(
    backfillAgentReplies(getAgent(agent.id), { fileOps: fileOps(denied) }),
    (error) => error.code === "EACCES",
  );
  await assert.rejects(
    backfillAgentReplies(getAgent(agent.id), {
      fileOps: {
        stat: async () => ({ mtimeMs: Date.now() }),
        readFile: async () => {
          throw denied;
        },
      },
    }),
    (error) => error.code === "EACCES",
  );
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, "#all"), 0);
});

test("backfill parsing yields in bounded batches and honors cancellation before writing", async () => {
  const agent = createAgent({ name: "cancelled-backfill" });
  const channel = createChannel({ name: "cancelled-backfill-room" });
  joinChannel(channel.id, agent.id);
  sendAsOwner(channel.id, "pending");
  const file = writeSessionFile(agent, [
    headerEntry("/ws"),
    userEntry(roomMarker(channel.id, 1)),
    assistantEntry("must not be written after stop"),
  ]);
  const controller = new AbortController();
  let yields = 0;
  await assert.rejects(
    backfillAgentReplies(getAgent(agent.id), {
      signal: controller.signal,
      batchLines: 1,
      yieldToEventLoop: async () => {
        yields += 1;
        controller.abort();
      },
      fileOps: {
        stat: async (filePath) => fs.promises.stat(filePath),
        readFile: async () => { throw new Error("streaming reader should be used"); },
        readChunks: (filePath, signal) =>
          fs.createReadStream(filePath, { encoding: "utf8", highWaterMark: 16, signal }),
      },
    }),
    { name: "AbortError" },
  );
  assert.equal(yields, 1);
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 1);
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0);
  assert.ok(fs.existsSync(file));
});

test("backfillAgentReplies writes missing replies into SQLite with fresh seqs and advances the cursor", async () => {
  const agent = createAgent({ name: "recover" });
  const channel = createChannel({ name: "recover-room" });
  joinChannel(channel.id, agent.id);
  sendAsOwner(channel.id, "human one"); // seq 1（已在 SQLite）
  const file = writeSessionFile(agent, [
    headerEntry("/ws"),
    userEntry(`drain ${roomMarker(channel.id, 1)}`),
    assistantEntry("reply that crashed before SQLite write"),
  ]);

  const result = await backfillAgentReplies(getAgent(agent.id));
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

test("backfill is idempotent: existing replies are not duplicated", async () => {
  const agent = createAgent({ name: "twice" });
  const channel = createChannel({ name: "twice-room" });
  joinChannel(channel.id, agent.id);
  sendAsOwner(channel.id, "hello");
  writeSessionFile(agent, [
    headerEntry("/ws"),
    userEntry(roomMarker(channel.id, 1)),
    assistantEntry("already there"),
  ]);

  assert.equal((await backfillAgentReplies(getAgent(agent.id))).inserted, 1);
  assert.equal((await backfillAgentReplies(getAgent(agent.id))).inserted, 0);
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 2);
});

test("a JSON protocol reply is stored as its parsed content, not the envelope", async () => {
  const agent = createAgent({ name: "jsonenv" });
  const channel = createChannel({ name: "jsonenv-room" });
  joinChannel(channel.id, agent.id);
  sendAsOwner(channel.id, "ask");
  writeSessionFile(agent, [
    headerEntry("/ws"),
    userEntry(roomMarker(channel.id, 1)),
    assistantEntry('{"action":"reply","content":"parsed hello","onConflict":"revise"}'),
  ]);

  assert.equal((await backfillAgentReplies(getAgent(agent.id))).inserted, 1);
  const messages = globalThis.__workspliceDb.listMessages(channel.id);
  assert.equal(messages[messages.length - 1].content, "parsed hello");
});

test("an ignore reply is not backfilled", async () => {
  const agent = createAgent({ name: "ignorer" });
  const channel = createChannel({ name: "ignorer-room" });
  joinChannel(channel.id, agent.id);
  writeSessionFile(agent, [
    headerEntry("/ws"),
    userEntry(roomMarker(channel.id, 0)),
    assistantEntry('{"action":"ignore"}'),
  ]);

  assert.equal((await backfillAgentReplies(getAgent(agent.id))).inserted, 0);
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 0);
});

test("revise drafts are dropped: only the last assistant reply of a marker round is backfilled", async () => {
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

  const result = await backfillAgentReplies(getAgent(agent.id));
  assert.equal(result.inserted, 1);
  const messages = globalThis.__workspliceDb.listMessages(channel.id);
  assert.equal(messages.length, 3);
  assert.equal(messages[messages.length - 1].content, "revised text");
  assert.ok(!messages.some((m) => m.content === "draft text"), "草稿不得落库");
});

test("cursor advances for already-delivered rounds (崩溃于补写后 ack 前)", async () => {
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

  const result = await backfillAgentReplies(getAgent(agent.id));
  assert.equal(result.inserted, 0);
  assert.equal(
    globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id),
    1,
    "标记存在即证明该轮已投递，游标推进到标记 seq",
  );
});

test("backfill skips agents without a session file or with a missing file", async () => {
  const noFile = createAgent({ name: "nofile" });
  assert.deepEqual(await backfillAgentReplies(noFile), { inserted: 0, targets: [] });

  const missing = createAgent({ name: "missingfile" });
  globalThis.__workspliceDb.setMemberPiSessionFile(missing.id, path.join(root, "nope.jsonl"));
  assert.deepEqual(await backfillAgentReplies(missing), { inserted: 0, targets: [] });
});

test("backfillAllAgents covers every agent and does not wake the loop", async () => {
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
  const result = await backfillAllAgents();
  unsub();

  assert.ok(result.inserted >= 1);
  assert.ok(result.targets.includes(channel.id));
  assert.equal(hints.length, 0, "backfill must not re-wake the loop");
});

// ============================================================================
// ticket 04：backfill 归属门禁（文件级：跨 cwd / 双活绑定 / mtime 早于成员创建 → 整文件跳过，
// 不补写、不推进游标）+ 轮级跨作者内容去重（疑似继承文件的他人回复：跳过补写、游标保持 pending）
// ============================================================================

test("ticket04: cross-cwd bound file is skipped (no backfill, no cursor advance)", async () => {
  const agent = createAgent({ name: "crosscwd" });
  const channel = createChannel({ name: "crosscwd-room" });
  joinChannel(channel.id, agent.id);
  sendAsOwner(channel.id, "ask");
  writeSessionFile(agent, [
    headerEntry("/some/other/project"), // header cwd != 成员 workspace（03 修复前错绑）
    userEntry(roomMarker(channel.id, 1)),
    assistantEntry("stolen reply"),
  ]);

  const result = await backfillAgentReplies(getAgent(agent.id));
  assert.equal(result.inserted, 0);
  assert.deepEqual(result.targets, []);
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 1);
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0);
});

test("ticket04: ownership rejection stops the streaming reader before the remaining file", async () => {
  const agent = createAgent({ name: "stream-ownership-gate" });
  const channel = createChannel({ name: "stream-ownership-gate-room" });
  joinChannel(channel.id, agent.id);
  sendAsOwner(channel.id, "ask");
  const file = writeSessionFile(agent, [
    headerEntry("/some/other/project"),
    userEntry(roomMarker(channel.id, 1)),
    assistantEntry("must not be read or backfilled"),
  ]);
  const [header, ...remaining] = fs.readFileSync(file, "utf8").split("\n");
  let chunksRead = 0;
  const result = await backfillAgentReplies(getAgent(agent.id), {
    fileOps: {
      stat: async (filePath) => fs.promises.stat(filePath),
      readFile: async () => { throw new Error("streaming reader should be used"); },
      readChunks: async function* () {
        chunksRead += 1;
        yield `${header}\n`;
        chunksRead += 1;
        yield remaining.join("\n");
      },
    },
  });

  assert.equal(result.inserted, 0);
  assert.deepEqual(result.targets, []);
  assert.equal(chunksRead, 1);
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 1);
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0);
});

test("ticket04: file referenced by another member is skipped for both (dual binding)", async () => {
  const dir = fs.mkdtempSync(path.join(root, "dual-"));
  const a = createAgent({ name: "dualbind-a", workspacePath: dir });
  const b = createAgent({ name: "dualbind-b", workspacePath: dir });
  const channel = createChannel({ name: "dualbind-room" });
  joinChannel(channel.id, a.id);
  joinChannel(channel.id, b.id);
  sendAsOwner(channel.id, "ask");
  const file = writeSessionFile(a, [
    headerEntry("/ws"), // 自动修正为 a 的 workspace（= dir）
    userEntry(roomMarker(channel.id, 1)),
    assistantEntry("dual reply"),
  ]);
  globalThis.__workspliceDb.setMemberPiSessionFile(b.id, file); // 03 修复前双绑定残留

  const ra = await backfillAgentReplies(getAgent(a.id));
  const rb = await backfillAgentReplies(getAgent(b.id));
  assert.equal(ra.inserted, 0);
  assert.equal(rb.inserted, 0);
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 1);
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(a.id, channel.id), 0);
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(b.id, channel.id), 0);
});

test("ticket04: file mtime older than member creation is skipped (inherited file)", async () => {
  const agent = createAgent({ name: "oldfile" });
  const channel = createChannel({ name: "oldfile-room" });
  joinChannel(channel.id, agent.id);
  sendAsOwner(channel.id, "ask");
  const file = writeSessionFile(agent, [
    headerEntry("/ws"),
    userEntry(roomMarker(channel.id, 1)),
    assistantEntry("inherited reply"),
  ]);
  const past = new Date("2000-01-01T00:00:00Z"); // 早于成员创建时间 → 必然不是自己的会话
  fs.utimesSync(file, past, past);

  const result = await backfillAgentReplies(getAgent(agent.id));
  assert.equal(result.inserted, 0);
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 1);
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0);
});

test("ticket04: reply content already present under another author is skipped and cursor left pending", async () => {
  const a = createAgent({ name: "owner-a" });
  const b = createAgent({ name: "owner-b" });
  const channel = createChannel({ name: "crossauthor-room" });
  joinChannel(channel.id, a.id);
  joinChannel(channel.id, b.id);
  sendMessage({ targetId: channel.id, authorId: a.id, content: "shared reply" }); // 作者 A 落库
  sendAsOwner(channel.id, "ask b");
  writeSessionFile(b, [
    headerEntry("/ws"),
    userEntry(roomMarker(channel.id, 2)),
    assistantEntry("shared reply"), // 跨作者命中 → 跳过
    userEntry(roomMarker(channel.id, 2)),
    assistantEntry("b's own reply"), // 正常 → 补写
  ]);

  const result = await backfillAgentReplies(getAgent(b.id));
  assert.equal(result.inserted, 1);
  const messages = globalThis.__workspliceDb.listMessages(channel.id);
  assert.ok(!messages.some((m) => m.author_id === b.id && m.content === "shared reply"));
  assert.ok(messages.some((m) => m.author_id === b.id && m.content === "b's own reply"));
  // 游标推进到正常轮的 markerSeq；命中轮保持 pending 留给正常 wake 重读
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(b.id, channel.id), 2);
});

test("ticket04: gate passes for a normal bound file (no regression)", async () => {
  const agent = createAgent({ name: "gatepass" });
  const channel = createChannel({ name: "gatepass-room" });
  joinChannel(channel.id, agent.id);
  sendAsOwner(channel.id, "ask");
  writeSessionFile(agent, [
    headerEntry("/ws"),
    userEntry(roomMarker(channel.id, 1)),
    assistantEntry("own reply"),
  ]);

  const result = await backfillAgentReplies(getAgent(agent.id));
  assert.equal(result.inserted, 1);
  const messages = globalThis.__workspliceDb.listMessages(channel.id);
  assert.equal(messages[messages.length - 1].author_id, agent.id);
  assert.equal(messages[messages.length - 1].content, "own reply");
});

// ============================================================================
// cross-target（backfill-cross-target-leak）：房间标记记的是**频道版本**，而 PR #190 起
// 任务回复真实投递目标是 task thread 的锚点消息。崩溃恢复补拉若只按「同 target 判重」，
// 就会把已经落在线程里的回复再写一份到频道顶层（同一内容两处各存一份）。
//
// 判重口径：同作者 + 同内容已存在于**本频道任一 thread** → 顶层不补写（该轮已投递，
// 游标照常推进）；只跨 target 判重同作者（ADR-0004 的轮级跨作者去重维持同 target 原口径），
// 且只作用于「marker 指向频道」的顶层补写——DB 里确实没有的回复仍必须补写。
// ============================================================================

test("cross-target: a reply already delivered to the task thread is not re-inserted at channel top level", async () => {
  const agent = createAgent({ name: "thread-leak" });
  const channel = createChannel({ name: "thread-leak-room" });
  joinChannel(channel.id, agent.id);
  const anchor = sendAsOwner(channel.id, "Task #1 created — analyse the thing"); // 频道 seq 1
  // PR #190 的路由：回复落 task thread 的锚点，不落频道顶层（随后崩溃于 ack 前）
  sendMessage({ targetId: anchor.id, authorId: agent.id, content: "long analysis" });
  // marker 记的是频道版本（不是线程），回复内容已投递到 task thread
  writeMarkerRound(agent, channel.id, 1, "long analysis");

  const result = await backfillAgentReplies(getAgent(agent.id));
  assert.equal(result.inserted, 0, "已投递到线程的回复不得再写进频道顶层");
  assert.deepEqual(result.targets, []);
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 1, "频道顶层只有那条创建事件");
  assert.equal(globalThis.__workspliceDb.listMessages(anchor.id).length, 1, "线程里保持一条");
  assert.equal(
    globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id),
    1,
    "标记存在即证明该轮已投递，游标推进到标记 seq（与同 target 幂等同一口径）",
  );
});

test("cross-target: a genuinely missing reply is still backfilled into the channel", async () => {
  const agent = createAgent({ name: "thread-miss" });
  const channel = createChannel({ name: "thread-miss-room" });
  joinChannel(channel.id, agent.id);
  const anchor = sendAsOwner(channel.id, "Task #1 created — analyse"); // seq 1
  // 线程里已有本 agent 的更早进展（不同内容），不得因此误判「这条也投递过」
  sendMessage({ targetId: anchor.id, authorId: agent.id, content: "earlier thread progress" });
  sendAsOwner(channel.id, "human follow-up"); // seq 2
  writeMarkerRound(agent, channel.id, 2, "analysis that crashed before SQLite write");

  const result = await backfillAgentReplies(getAgent(agent.id));
  assert.equal(result.inserted, 1, "DB 里确实不存在的回复必须仍被补写");
  assert.deepEqual(result.targets, [channel.id]);
  const messages = globalThis.__workspliceDb.listMessages(channel.id);
  assert.equal(messages.length, 3);
  assert.equal(messages[2].seq, 3);
  assert.equal(messages[2].author_id, agent.id);
  assert.equal(messages[2].content, "analysis that crashed before SQLite write");
});

test("cross-target: a marker round targeting the task thread still backfills into the thread", async () => {
  const agent = createAgent({ name: "thread-own-round" });
  const channel = createChannel({ name: "thread-own-round-room" });
  joinChannel(channel.id, agent.id);
  const anchor = sendAsOwner(channel.id, "Task #1 created — analyse"); // seq 1
  writeMarkerRound(agent, anchor.id, 0, "thread progress that crashed before SQLite write");

  const result = await backfillAgentReplies(getAgent(agent.id));
  assert.equal(result.inserted, 1);
  assert.deepEqual(result.targets, [anchor.id]);
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 1, "频道顶层不得凭空多一条");
  const thread = globalThis.__workspliceDb.listMessages(anchor.id);
  assert.equal(thread.length, 1);
  assert.equal(thread[0].content, "thread progress that crashed before SQLite write");
});

test("cross-target: another author's identical thread reply does not block this agent's channel backfill", async () => {
  const author = createAgent({ name: "cross-author-own" });
  const other = createAgent({ name: "cross-author-other" });
  const channel = createChannel({ name: "cross-author-thread-room" });
  joinChannel(channel.id, author.id);
  joinChannel(channel.id, other.id);
  const anchor = sendAsOwner(channel.id, "Task #1 created — analyse"); // seq 1
  // 别的作者在线程里写过同内容：跨 target 判重只认同一 member，不改 ADR-0004 的跨作者原口径
  sendMessage({ targetId: anchor.id, authorId: other.id, content: "same words" });
  writeMarkerRound(author, channel.id, 1, "same words");

  const result = await backfillAgentReplies(getAgent(author.id));
  assert.equal(result.inserted, 1, "跨作者同内容不触发本 agent 的跨 target 跳过");
  const messages = globalThis.__workspliceDb.listMessages(channel.id);
  assert.equal(messages.length, 2);
  assert.equal(messages[1].author_id, author.id);
  assert.equal(messages[1].content, "same words");
});

test("cross-target: an identical reply in a different channel's thread does not block the backfill", async () => {
  const agent = createAgent({ name: "other-channel-thread" });
  const channel = createChannel({ name: "other-channel-thread-room" });
  const elsewhere = createChannel({ name: "other-channel-thread-elsewhere" });
  joinChannel(channel.id, agent.id);
  joinChannel(elsewhere.id, agent.id);
  const foreignAnchor = sendAsOwner(elsewhere.id, "Task #9 created — unrelated");
  sendMessage({ targetId: foreignAnchor.id, authorId: agent.id, content: "portable wording" });
  sendAsOwner(channel.id, "ask here"); // seq 1
  writeMarkerRound(agent, channel.id, 1, "portable wording");

  const result = await backfillAgentReplies(getAgent(agent.id));
  assert.equal(result.inserted, 1, "判重作用域 = 该 target 所属频道，跨频道不生效");
  assert.deepEqual(result.targets, [channel.id]);
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 2);
});

// ============================================================================
// ticket 06：软删除 corner 基线（红灯——期望语义，修复 ticket 08 落地后变绿）
//
// 场景：A、B 共享项目目录；B 的 pi_session_file 残留指向 A 的文件（03 修复前的
// 粘性继承脏数据）；A 软删除后其固化登记仍在 DB 行里（deleteAgent 不清
// pi_session_file）。此时 B 的 backfill 归属门禁：
//   - header cwd == B 的 workspace ✓（同目录）
//   - 引用集 = listMembers()（deleted=0 过滤）→ A 不在其中 ✓
//   - mtime ≥ B 创建时间 ✓（A 在 B 创建后跑过）
// 门禁全过 → A 的未投递回复（崩溃窗口）被按 B 作者补写——症状②在 backfill 侧
// 的残留路径。期望语义：软删除成员的固化登记仍是所有权凭证（ADR-0003），
// B 不得补写 A 的文件（整文件跳过、游标不推进）。
// ============================================================================

test("ticket06: RED — a soft-deleted member's registered file is not backfilled by a sharing member (residual binding)", async () => {
  const dir = fs.mkdtempSync(path.join(root, "softdel-"));
  const a = createAgent({ name: "softdel-a", workspacePath: dir });
  const b = createAgent({ name: "softdel-b", workspacePath: dir });
  const channel = createChannel({ name: "softdel-room" });
  joinChannel(channel.id, a.id);
  joinChannel(channel.id, b.id);
  // A 崩溃于投递前：文件里有标记轮 + 回复，但 SQLite 里从未有该内容（dedup 拦不住）
  const fileA = writeSessionFile(a, [
    headerEntry("/ws"),
    userEntry(roomMarker(channel.id, 1)),
    assistantEntry("undelivered crash reply"),
  ]);
  // B 的粘性残留绑定（03 修复前 B 固化过 A 的文件）
  globalThis.__workspliceDb.setMemberPiSessionFile(b.id, fileA);
  deleteAgent(a.id); // 软删除：行保留，pi_session_file 不清

  const result = await backfillAgentReplies(getAgent(b.id));
  assert.equal(result.inserted, 0, "B 不得补写 A 的回复");
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 0, "频道不得出现作者错乱的消息");
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(b.id, channel.id), 0, "游标不得推进");
});
