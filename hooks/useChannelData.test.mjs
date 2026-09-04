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

// pin 项构造器（03 票）：message 嵌套 + order + pinnedAt（与服务端 listPinned 同形）。
const pin = (id, order, pinnedAt, content) => ({
  message: m(id, order, content),
  order,
  pinnedAt,
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

// 02 票红-绿切片 1：正常发送走 JSON，携带 baseSeq，返回 sent + message
test("postChannelMessage posts JSON with baseSeq and returns the sent message", async () => {
  const { postChannelMessage } = await jiti.import("./useChannelData.ts");
  const calls = [];
  const sent = m("m9", 10, "hello");
  const stubFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ message: sent }) };
  };

  const result = await postChannelMessage("c1", "hello", undefined, 9, undefined, stubFetch);
  assert.deepEqual(result, { kind: "sent", message: sent });
  assert.equal(calls[0].url, "/api/messages");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    targetId: "c1",
    content: "hello",
    baseSeq: 9,
  });
});

// 02 票红-绿切片 2：held 返回摘要（不抛错，由调用方重拉提示）
test("postChannelMessage returns held with whatHappened on 409 held", async () => {
  const { postChannelMessage } = await jiti.import("./useChannelData.ts");
  const stubFetch = async () => ({
    ok: false,
    status: 409,
    json: async () => ({ held: true, whatHappened: "2 new messages" }),
  });

  const result = await postChannelMessage("c1", "hello", undefined, 9, undefined, stubFetch);
  assert.deepEqual(result, { kind: "held", whatHappened: "2 new messages" });
});

// 02 票红-绿切片 3：非 held 错误抛错（服务端 error 透出）
test("postChannelMessage throws the server error for non-held failures", async () => {
  const { postChannelMessage } = await jiti.import("./useChannelData.ts");
  const stubFetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: "bad content" }),
  });

  await assert.rejects(
    () => postChannelMessage("c1", "hello", undefined, 9, undefined, stubFetch),
    /bad content/,
  );
});

// 02 票红-绿切片 5：空响应是服务端契约违背，抛错而不是静默吞掉
test("postChannelMessage throws on empty success responses", async () => {
  const { postChannelMessage } = await jiti.import("./useChannelData.ts");
  const stubFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
  });

  await assert.rejects(
    () => postChannelMessage("c1", "hello", undefined, 9, undefined, stubFetch),
    /empty response/,
  );
});

// 02 票红-绿切片 4：附件走 multipart（含 baseSeq/quoteId/files，一次请求原子提交）
test("postChannelMessage posts multipart with baseSeq when files are attached", async () => {
  const { postChannelMessage } = await jiti.import("./useChannelData.ts");
  const sent = m("m9", 10, "with file");
  const calls = [];
  const file = new File(["data"], "a.txt", { type: "text/plain" });
  const stubFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ message: sent }) };
  };

  const result = await postChannelMessage("c1", "with file", "q1", 9, [file], stubFetch);
  assert.deepEqual(result, { kind: "sent", message: sent });
  assert.equal(calls[0].url, "/api/messages");
  const form = calls[0].init.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get("targetId"), "c1");
  assert.equal(form.get("content"), "with file");
  assert.equal(form.get("baseSeq"), "9");
  assert.equal(form.get("quoteId"), "q1");
  assert.equal(form.get("files"), file);
});

// 03 票红-绿切片 1：pinned 三种排序（manual=order 升序 / recent=pinnedAt 降序 / az=内容字典序）
test("sortPinnedItems orders pinned items by manual/recent/az", async () => {
  const { sortPinnedItems } = await jiti.import("./useChannelData.ts");
  const items = [
    pin("b", 2, "2026-09-04T00:00:02.000Z", "banana"),
    pin("a", 0, "2026-09-04T00:00:00.000Z", "cherry"),
    pin("c", 1, "2026-09-04T00:00:01.000Z", "apple"),
  ];

  assert.deepEqual(
    sortPinnedItems(items, "manual").map((x) => x.message.id),
    ["a", "c", "b"],
  );
  assert.deepEqual(
    sortPinnedItems(items, "recent").map((x) => x.message.id),
    ["b", "c", "a"],
  );
  assert.deepEqual(
    sortPinnedItems(items, "az").map((x) => x.message.id),
    ["c", "b", "a"],
  );
});

// 03 票红-绿切片 2：recent 同毫秒兜底（pinnedAt 相同时按 order 降序，与服务端同语义）
test("sortPinnedItems breaks recent ties by order desc (same-millisecond fallback)", async () => {
  const { sortPinnedItems } = await jiti.import("./useChannelData.ts");
  const same = "2026-09-04T00:00:00.000Z";
  const items = [pin("a", 0, same, "a"), pin("c", 2, same, "c"), pin("b", 1, same, "b")];

  assert.deepEqual(
    sortPinnedItems(items, "recent").map((x) => x.message.id),
    ["c", "b", "a"],
  );
  // 非 recent 不受 pinnedAt 影响：manual 只看 order。
  assert.deepEqual(
    sortPinnedItems(items, "manual").map((x) => x.message.id),
    ["a", "b", "c"],
  );
});

// 03 票红-绿切片 3：loadPinnedPage 取列表（sort 参数 + 缺 pinned 字段兜底 + 错误映射）
test("loadPinnedPage requests the pinned list with sort and defaults missing pinned to []", async () => {
  const { loadPinnedPage } = await jiti.import("./useChannelData.ts");
  const calls = [];
  const items = [pin("a", 0, "2026-09-04T00:00:00.000Z", "a")];
  const stubFetch = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => ({ pinned: items }) };
  };

  const page = await loadPinnedPage("c1", "recent", stubFetch);
  assert.deepEqual(page, items);
  assert.match(calls[0], /\/api\/channels\/c1\/pinned\?sort=recent/);

  const emptyFetch = async () => ({ ok: true, json: async () => ({}) });
  assert.deepEqual(await loadPinnedPage("c1", "manual", emptyFetch), []);

  const errFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(() => loadPinnedPage("c1", "manual", errFetch), /GET pinned: 500/);
});

// 03 票红-绿切片 4：togglePinnedMessage 切换（已 pin 走 DELETE / 未 pin 走 POST+messageId，返回新态）
test("togglePinnedMessage unpins with DELETE and pins with POST", async () => {
  const { togglePinnedMessage } = await jiti.import("./useChannelData.ts");
  const calls = [];
  const stubFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({}) };
  };

  assert.equal(await togglePinnedMessage("c1", "m1", true, stubFetch), false);
  assert.equal(calls[0].url, "/api/channels/c1/pinned?messageId=m1");
  assert.equal(calls[0].init.method, "DELETE");

  assert.equal(await togglePinnedMessage("c1", "m2", false, stubFetch), true);
  assert.equal(calls[1].url, "/api/channels/c1/pinned");
  assert.equal(calls[1].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].init.body), { messageId: "m2" });

  const errFetch = async () => ({ ok: false, status: 400, json: async () => ({}) });
  await assert.rejects(() => togglePinnedMessage("c1", "m1", true, errFetch), /pin: 400/);
});

// 03 票红-绿切片 5：postPinnedOrder 提交重排（order 数组一次提交 + 错误映射，重排顺序持久化语义）
test("postPinnedOrder posts the reordered message ids in one request", async () => {
  const { postPinnedOrder } = await jiti.import("./useChannelData.ts");
  const calls = [];
  const stubFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };

  await postPinnedOrder("c1", ["c", "a", "b"], stubFetch);
  assert.equal(calls[0].url, "/api/channels/c1/pinned/reorder");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), { order: ["c", "a", "b"] });

  const errFetch = async () => ({ ok: false, status: 400, json: async () => ({}) });
  await assert.rejects(() => postPinnedOrder("c1", ["a"], errFetch), /reorder: 400/);
});

// 03 票红-绿切片 6：附属区 loadMutesPage/loadChannelMemberIds（取列表 + 缺字段兜底 + 错误映射）
test("loadMutesPage and loadChannelMemberIds fetch affiliated state with empty defaults", async () => {
  const { loadMutesPage, loadChannelMemberIds } = await jiti.import("./useChannelData.ts");
  const rows = [{ memberId: "a1", name: "A", muted: true }];
  const stubFetch = async (url) => {
    if (url.includes("/mute")) return { ok: true, json: async () => ({ mutes: rows }) };
    return { ok: true, json: async () => ({ members: [{ id: "a1" }, { id: "owner" }] }) };
  };

  assert.deepEqual(await loadMutesPage("c1", stubFetch), rows);
  assert.deepEqual([...(await loadChannelMemberIds("c1", stubFetch))], ["a1", "owner"]);

  const emptyFetch = async () => ({ ok: true, json: async () => ({}) });
  assert.deepEqual(await loadMutesPage("c1", emptyFetch), []);
  assert.deepEqual([...(await loadChannelMemberIds("c1", emptyFetch))], []);

  const errFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(() => loadMutesPage("c1", errFetch), /GET mutes: 500/);
  await assert.rejects(() => loadChannelMemberIds("c1", errFetch), /GET members: 500/);
});

// 03 票红-绿切片 7：toggleChannelMute 取反提交（返回新态 + 服务端 error 透出）
test("toggleChannelMute posts the toggled mute state and returns it", async () => {
  const { toggleChannelMute } = await jiti.import("./useChannelData.ts");
  const calls = [];
  const stubFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({}) };
  };

  assert.equal(await toggleChannelMute("c1", "a1", false, stubFetch), true);
  assert.equal(calls[0].url, "/api/channels/c1/mute");
  assert.deepEqual(JSON.parse(calls[0].init.body), { memberId: "a1", muted: true });
  assert.equal(await toggleChannelMute("c1", "a1", true, stubFetch), false);

  const errFetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: "not a member" }),
  });
  await assert.rejects(() => toggleChannelMute("c1", "a1", false, errFetch), /not a member/);
});
