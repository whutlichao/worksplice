import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/db.ts";
import { OWNER_MEMBER_ID } from "../data/schema.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-search-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createChannel } = await import("./channels.ts");
const { sendMessage } = await import("./messages.ts");
const { searchMessages } = await import("./search.ts");

function freshChannel(name = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`) {
  return createChannel({ name });
}

test("keyword hits message body with a <mark> snippet and channel/author enrichment (§6.4)", () => {
  const channel = freshChannel();
  sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "今天讨论了全文搜索的实现方案，包括触发器同步和结果摘要。",
  });
  sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: "无关消息" });

  const hits = searchMessages("全文搜索");
  assert.equal(hits.length, 1);
  const hit = hits[0];
  assert.equal(hit.channel?.id, channel.id);
  assert.equal(hit.author?.id, OWNER_MEMBER_ID);
  assert.equal(hit.inThread, false);
  assert.match(hit.snippet, /<mark>全文搜索<\/mark>/);
  assert.match(hit.snippet, /触发器同步/);
});

test("new messages are searchable immediately (trigger sync, §6.4)", () => {
  const channel = freshChannel();
  const sent = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "立即可搜的独特关键词 xylophone-quantum",
  }).message;

  const hits = searchMessages("xylophone-quantum");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, sent.id);
});

test("short CJK tokens (<3 chars) fall back to LIKE and still match (§6.4)", () => {
  const channel = freshChannel();
  sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "提醒功能在 cron 里逐分钟触发",
  });

  // “提醒”是双字词：trigram 需要 ≥3 字符，走 LIKE 兜底路径
  const hits = searchMessages("提醒");
  assert.equal(hits.length, 1);
  assert.match(hits[0].snippet, /<mark>提醒<\/mark>/);

  // 混合长度（含短 token）整体走 LIKE：AND 语义
  const mixed = searchMessages("提醒 cron");
  assert.equal(mixed.length, 1);

  const none = searchMessages("提醒 不存在词xyz");
  assert.equal(none.length, 0);
});

test("thread messages resolve to their anchor channel and report inThread", () => {
  const channel = freshChannel();
  const anchor = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "锚点消息",
  }).message;
  const reply = sendMessage({
    targetId: anchor.id,
    authorId: OWNER_MEMBER_ID,
    content: "线程里的中子星回复",
  }).message;

  const hits = searchMessages("中子星");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, reply.id);
  assert.equal(hits[0].inThread, true);
  assert.equal(hits[0].channel?.id, channel.id);
});

test("empty/whitespace queries return no hits", () => {
  assert.deepEqual(searchMessages(""), []);
  assert.deepEqual(searchMessages("   "), []);
});

test("snippet escapes message HTML and LIKE wildcards are treated literally", () => {
  const channel = freshChannel();
  sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "<script>alert(1)</script> 命中率 100% 完成",
  });

  const hits = searchMessages("命中率");
  assert.equal(hits.length, 1);
  assert.ok(!hits[0].snippet.includes("<script>"), "raw HTML must not leak into snippet");
  assert.ok(hits[0].snippet.includes("&lt;script&gt;"));

  // “%” 是 LIKE 通配符：应被转义为字面量（兜底路径）
  const percent = searchMessages("%");
  assert.equal(percent.length, 1);
  const underscore = searchMessages("_");
  assert.equal(underscore.length, 0);
});

test("limit clamps to MAX_SEARCH_LIMIT and negative/zero limits are handled", () => {
  const channel = freshChannel();
  for (let i = 0; i < 5; i++) {
    sendMessage({ targetId: channel.id, authorId: OWNER_MEMBER_ID, content: `批量种子消息 ${i}` });
  }
  assert.equal(searchMessages("批量种子").length, 5);
  assert.equal(searchMessages("批量种子", { limit: 2 }).length, 2);
  assert.equal(searchMessages("批量种子", { limit: 0 }).length, 1);
  assert.equal(searchMessages("批量种子", { limit: 999 }).length, 5);
});
