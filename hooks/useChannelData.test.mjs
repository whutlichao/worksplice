import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { mergeIncomingMessages, loadMessagesPage } = await jiti.import("./useChannelData.ts");

const m = (id, seq, content) => ({
  id,
  target_id: "c1",
  seq,
  author_id: "owner",
  content,
  created_at: "",
  author: null,
});

// 红-绿切片 1：merge 去重（按 id）+ 按 seq 排序
test("mergeIncomingMessages dedupes by id and keeps messages sorted by seq", () => {
  const prev = [m("m1", 1, "one"), m("m2", 3, "three")];
  const incoming = [m("m3", 4, "four"), m("m1", 1, "one")];

  const merged = mergeIncomingMessages(prev, incoming);
  assert.deepEqual(merged.map((x) => x.id), ["m1", "m2", "m3"]);
  assert.deepEqual(merged.map((x) => x.content), ["one", "three", "four"]);
  assert.equal(mergeIncomingMessages(prev, []).length, 2);
});

// 红-绿切片 2：loadPage 取页（limit + before 参数 + 错误映射）
test("loadMessagesPage requests the channel messages page with limit/before", async () => {
  const calls = [];
  const stubFetch = async (url) => {
    calls.push(url);
    return {
      ok: true,
      json: async () => ({ messages: [m("m1", 1, "one")], hasMore: false, maxSeq: 1 }),
    };
  };
  const page = await loadMessagesPage("c1", undefined, stubFetch);
  assert.deepEqual(page.messages.map((x) => x.id), ["m1"]);
  assert.equal(page.maxSeq, 1);
  assert.equal(page.hasMore, false);
  assert.match(calls[0], /\/api\/channels\/c1\/messages\?limit=50/);

  const page2 = await loadMessagesPage("c1", 9, stubFetch);
  assert.match(calls[1], /before=9/);
  assert.deepEqual(page2.messages.map((x) => x.id), ["m1"]);
});

test("loadMessagesPage maps HTTP errors to Error", async () => {
  const stubFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(() => loadMessagesPage("c1", undefined, stubFetch), /GET messages: 500/);
});

// 红-绿切片 3：轮询合并推进 maxSeq（未推进时返回同一引用，不重渲染）
test("applyPollPage advances maxSeq and merges new messages", async () => {
  const { applyPollPage } = await jiti.import("./useChannelData.ts");
  const prev = { messages: [m("m1", 1, "one")], hasMore: false, maxSeq: 1 };
  const page = { messages: [m("m1", 1, "one"), m("m2", 2, "two")], hasMore: false, maxSeq: 2 };

  const next = applyPollPage(prev, page);
  assert.deepEqual(next.messages.map((x) => x.id), ["m1", "m2"]);
  assert.equal(next.maxSeq, 2);
  assert.equal(next.hasMore, false);
});

test("applyPollPage returns the previous state when maxSeq does not advance", async () => {
  const { applyPollPage } = await jiti.import("./useChannelData.ts");
  const prev = { messages: [m("m1", 1, "one")], hasMore: false, maxSeq: 2 };
  const page = { messages: [m("m1", 1, "one"), m("m2", 2, "two")], hasMore: false, maxSeq: 2 };

  assert.equal(applyPollPage(prev, page), prev);
});

// 红-绿切片 4：向上分页拼接顺序（早页 prepend 到前面）
test("prependPageMessages puts the earlier page first", async () => {
  const { prependPageMessages } = await jiti.import("./useChannelData.ts");
  const prev = [m("m3", 3, "three")];
  const page = [m("m1", 1, "one"), m("m2", 2, "two")];

  const next = prependPageMessages(prev, page);
  assert.deepEqual(next.map((x) => x.id), ["m1", "m2", "m3"]);
});

// 红-绿切片 5：切换频道快照一致性判定（一致时跳过 setState，避免闪动）
test("isSameMessagesPage detects identical snapshots", async () => {
  const { isSameMessagesPage } = await jiti.import("./useChannelData.ts");
  const prev = { messages: [m("m1", 1, "one")], hasMore: false, maxSeq: 1 };

  assert.equal(isSameMessagesPage(prev, { messages: [m("m1", 1, "one")], hasMore: false, maxSeq: 1 }), true);
  assert.equal(isSameMessagesPage(prev, { messages: [m("m1", 1, "one")], hasMore: true, maxSeq: 1 }), false);
  assert.equal(isSameMessagesPage(prev, { messages: [m("m1", 1, "one")], hasMore: false, maxSeq: 2 }), false);
  assert.equal(isSameMessagesPage(prev, { messages: [m("m1", 1, "one"), m("m2", 2, "two")], hasMore: false, maxSeq: 2 }), false);
  assert.equal(isSameMessagesPage(prev, { messages: [m("m9", 1, "other")], hasMore: false, maxSeq: 1 }), false);
});
