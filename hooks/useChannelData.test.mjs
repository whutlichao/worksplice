import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { mergeIncomingMessages, loadMessagesPage } = await jiti.import(
  "./useChannelData.ts",
);

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
  assert.deepEqual(
    merged.map((x) => x.id),
    ["m1", "m2", "m3"],
  );
  assert.deepEqual(
    merged.map((x) => x.content),
    ["one", "three", "four"],
  );
  assert.equal(mergeIncomingMessages(prev, []).length, 2);
});

// 红-绿切片 2：loadPage 取页（limit + before 参数 + 错误映射）
test("loadMessagesPage requests the channel messages page with limit/before", async () => {
  const calls = [];
  const stubFetch = async (url) => {
    calls.push(url);
    return {
      ok: true,
      json: async () => ({
        messages: [m("m1", 1, "one")],
        hasMore: false,
        maxSeq: 1,
      }),
    };
  };
  const page = await loadMessagesPage("c1", undefined, stubFetch);
  assert.deepEqual(
    page.messages.map((x) => x.id),
    ["m1"],
  );
  assert.equal(page.maxSeq, 1);
  assert.equal(page.hasMore, false);
  assert.match(calls[0], /\/api\/channels\/c1\/messages\?limit=50/);

  const page2 = await loadMessagesPage("c1", 9, stubFetch);
  assert.match(calls[1], /before=9/);
  assert.deepEqual(
    page2.messages.map((x) => x.id),
    ["m1"],
  );
});

test("loadMessagesPage maps HTTP errors to Error", async () => {
  const stubFetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({}),
  });
  await assert.rejects(
    () => loadMessagesPage("c1", undefined, stubFetch),
    /GET messages: 500/,
  );
});

// 红-绿切片 3：轮询合并推进 maxSeq（未推进时返回同一引用，不重渲染）
test("applyPollPage advances maxSeq and merges new messages", async () => {
  const { applyPollPage } = await jiti.import("./useChannelData.ts");
  const prev = { messages: [m("m1", 1, "one")], hasMore: false, maxSeq: 1 };
  const page = {
    messages: [m("m1", 1, "one"), m("m2", 2, "two")],
    hasMore: false,
    maxSeq: 2,
  };

  const next = applyPollPage(prev, page);
  assert.deepEqual(
    next.messages.map((x) => x.id),
    ["m1", "m2"],
  );
  assert.equal(next.maxSeq, 2);
  assert.equal(next.hasMore, false);
});

test("applyPollPage returns the previous state when maxSeq does not advance", async () => {
  const { applyPollPage } = await jiti.import("./useChannelData.ts");
  const prev = { messages: [m("m1", 1, "one")], hasMore: false, maxSeq: 2 };
  const page = {
    messages: [m("m1", 1, "one"), m("m2", 2, "two")],
    hasMore: false,
    maxSeq: 2,
  };

  assert.equal(applyPollPage(prev, page), prev);
});

// 红-绿切片 4：向上分页拼接顺序（早页 prepend 到前面）
test("prependPageMessages puts the earlier page first", async () => {
  const { prependPageMessages } = await jiti.import("./useChannelData.ts");
  const prev = [m("m3", 3, "three")];
  const page = [m("m1", 1, "one"), m("m2", 2, "two")];

  const next = prependPageMessages(prev, page);
  assert.deepEqual(
    next.map((x) => x.id),
    ["m1", "m2", "m3"],
  );
});

// 红-绿切片 5：切换频道快照一致性判定（一致时跳过 setState，避免闪动）
test("isSameMessagesPage detects identical snapshots", async () => {
  const { isSameMessagesPage } = await jiti.import("./useChannelData.ts");
  const prev = { messages: [m("m1", 1, "one")], hasMore: false, maxSeq: 1 };

  assert.equal(
    isSameMessagesPage(prev, {
      messages: [m("m1", 1, "one")],
      hasMore: false,
      maxSeq: 1,
    }),
    true,
  );
  assert.equal(
    isSameMessagesPage(prev, {
      messages: [m("m1", 1, "one")],
      hasMore: true,
      maxSeq: 1,
    }),
    false,
  );
  assert.equal(
    isSameMessagesPage(prev, {
      messages: [m("m1", 1, "one")],
      hasMore: false,
      maxSeq: 2,
    }),
    false,
  );
  assert.equal(
    isSameMessagesPage(prev, {
      messages: [m("m1", 1, "one"), m("m2", 2, "two")],
      hasMore: false,
      maxSeq: 2,
    }),
    false,
  );
  assert.equal(
    isSameMessagesPage(prev, {
      messages: [m("m9", 1, "other")],
      hasMore: false,
      maxSeq: 1,
    }),
    false,
  );
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

  const result = await postChannelMessage(
    "c1",
    "hello",
    undefined,
    9,
    undefined,
    stubFetch,
  );
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

  const result = await postChannelMessage(
    "c1",
    "hello",
    undefined,
    9,
    undefined,
    stubFetch,
  );
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

  const result = await postChannelMessage(
    "c1",
    "with file",
    "q1",
    9,
    [file],
    stubFetch,
  );
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
  const items = [
    pin("a", 0, same, "a"),
    pin("c", 2, same, "c"),
    pin("b", 1, same, "b"),
  ];

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

  const errFetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({}),
  });
  await assert.rejects(
    () => loadPinnedPage("c1", "manual", errFetch),
    /GET pinned: 500/,
  );
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

  const errFetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({}),
  });
  await assert.rejects(
    () => togglePinnedMessage("c1", "m1", true, errFetch),
    /pin: 400/,
  );
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

  const errFetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({}),
  });
  await assert.rejects(
    () => postPinnedOrder("c1", ["a"], errFetch),
    /reorder: 400/,
  );
});

// 03 票红-绿切片 6：附属区 loadMutesPage/loadChannelMemberIds（取列表 + 缺字段兜底 + 错误映射）
test("loadMutesPage and loadChannelMemberIds fetch affiliated state with empty defaults", async () => {
  const { loadMutesPage, loadChannelMemberIds } = await jiti.import(
    "./useChannelData.ts",
  );
  const rows = [{ memberId: "a1", name: "A", muted: true }];
  const stubFetch = async (url) => {
    if (url.includes("/mute"))
      return { ok: true, json: async () => ({ mutes: rows }) };
    return {
      ok: true,
      json: async () => ({ members: [{ id: "a1" }, { id: "owner" }] }),
    };
  };

  assert.deepEqual(await loadMutesPage("c1", stubFetch), rows);
  assert.deepEqual(
    [...(await loadChannelMemberIds("c1", stubFetch))],
    ["a1", "owner"],
  );

  const emptyFetch = async () => ({ ok: true, json: async () => ({}) });
  assert.deepEqual(await loadMutesPage("c1", emptyFetch), []);
  assert.deepEqual([...(await loadChannelMemberIds("c1", emptyFetch))], []);

  const errFetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({}),
  });
  await assert.rejects(() => loadMutesPage("c1", errFetch), /GET mutes: 500/);
  await assert.rejects(
    () => loadChannelMemberIds("c1", errFetch),
    /GET members: 500/,
  );
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
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    memberId: "a1",
    muted: true,
  });
  assert.equal(await toggleChannelMute("c1", "a1", true, stubFetch), false);

  const errFetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: "not a member" }),
  });
  await assert.rejects(
    () => toggleChannelMute("c1", "a1", false, errFetch),
    /not a member/,
  );
});

// 04 票红-绿切片 1：loadTasksPage 取任务板（GET + 缺 tasks 字段兜底 + 错误映射）
test("loadTasksPage requests the channel task board and defaults missing tasks to []", async () => {
  const { loadTasksPage } = await jiti.import("./useChannelData.ts");
  const calls = [];
  const taskRow = {
    id: "t1",
    message_id: "m1",
    number: 1,
    status: "todo",
    reopened: 0,
  };
  const stubFetch = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => ({ tasks: [taskRow] }) };
  };

  const tasks = await loadTasksPage("c1", stubFetch);
  assert.deepEqual(tasks, [taskRow]);
  assert.match(calls[0], /\/api\/channels\/c1\/tasks/);

  const emptyFetch = async () => ({ ok: true, json: async () => ({}) });
  assert.deepEqual(await loadTasksPage("c1", emptyFetch), []);

  const errFetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({}),
  });
  await assert.rejects(() => loadTasksPage("c1", errFetch), /GET tasks: 500/);
});

// 04 票红-绿切片 2：claim 让路语义（updated/held/conflict/blocked 四分支 + 错误映射）
test("claimChannelTask posts baseSeq and maps held/conflict/blocked to yield results", async () => {
  const { claimChannelTask } = await jiti.import("./useChannelData.ts");
  const calls = [];
  const taskRow = {
    id: "t1",
    message_id: "m1",
    number: 1,
    status: "in_progress",
    reopened: 0,
  };
  const stubFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ task: taskRow }) };
  };

  assert.deepEqual(await claimChannelTask("t1", 9, stubFetch), {
    kind: "updated",
    task: taskRow,
  });
  assert.equal(calls[0].url, "/api/tasks/t1/claim");
  assert.deepEqual(JSON.parse(calls[0].init.body), { baseSeq: 9 });

  const heldFetch = async () => ({
    ok: false,
    status: 409,
    json: async () => ({ held: true, whatHappened: "2 new" }),
  });
  assert.deepEqual(await claimChannelTask("t1", 9, heldFetch), {
    kind: "held",
    whatHappened: "2 new",
  });

  const conflictFetch = async () => ({
    ok: false,
    status: 409,
    json: async () => ({ conflict: true, reason: "already claimed" }),
  });
  assert.deepEqual(await claimChannelTask("t1", 9, conflictFetch), {
    kind: "conflict",
    reason: "already claimed",
  });

  const blockedFetch = async () => ({
    ok: false,
    status: 409,
    json: async () => ({ blocked: true, reason: "reopened" }),
  });
  assert.deepEqual(await claimChannelTask("t1", 9, blockedFetch), {
    kind: "blocked",
    reason: "reopened",
  });

  const errFetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({}),
  });
  await assert.rejects(() => claimChannelTask("t1", 9, errFetch), /claim: 400/);
});

// 04 票红-绿切片 3：update-status 转移序列（status+baseSeq 携带 + held 让路 + 错误映射）
test("updateChannelTaskStatus posts status with baseSeq and maps held to yield results", async () => {
  const { updateChannelTaskStatus } = await jiti.import("./useChannelData.ts");
  const calls = [];
  const taskRow = {
    id: "t1",
    message_id: "m1",
    number: 1,
    status: "in_review",
    reopened: 0,
  };
  const stubFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ task: taskRow }) };
  };

  assert.deepEqual(
    await updateChannelTaskStatus("t1", "in_review", 9, stubFetch),
    { kind: "updated", task: taskRow },
  );
  assert.equal(calls[0].url, "/api/tasks/t1/update-status");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    status: "in_review",
    baseSeq: 9,
  });

  const heldFetch = async () => ({
    ok: false,
    status: 409,
    json: async () => ({ held: true, whatHappened: "1 new" }),
  });
  assert.deepEqual(
    await updateChannelTaskStatus("t1", "in_review", 9, heldFetch),
    { kind: "held", whatHappened: "1 new" },
  );

  const errFetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: "bad transition" }),
  });
  await assert.rejects(
    () => updateChannelTaskStatus("t1", "in_review", 9, errFetch),
    /update-status: 400/,
  );
});

// 04 票红-绿切片 4：reopen 封锁标记透出（reopened=1 的任务行经 loadTasksPage 原样返回）
test("loadTasksPage preserves the reopened flag for blocked claim display", async () => {
  const { loadTasksPage } = await jiti.import("./useChannelData.ts");
  const rows = [
    { id: "t1", message_id: "m1", number: 1, status: "todo", reopened: 1 },
    { id: "t2", message_id: "m2", number: 2, status: "todo", reopened: 0 },
  ];
  const stubFetch = async () => ({
    ok: true,
    json: async () => ({ tasks: rows }),
  });

  const tasks = await loadTasksPage("c1", stubFetch);
  assert.deepEqual(
    tasks.map((x) => x.reopened),
    [1, 0],
  );
});

// 04 票红-绿切片 5：complete 两步序列——先落线程回复（postChannelMessage 目标=锚点）再置 in_review
test("completeTaskWithReply delivers the thread reply before the in_review transition", async () => {
  const { completeTaskWithReply, postChannelMessage } = await jiti.import(
    "./useChannelData.ts",
  );
  // 先确认第二步的发送通道语义：目标=任务锚点 id（thread 自己的 seq 空间），携带线程版本 baseSeq
  const reply = {
    id: "r1",
    target_id: "anchor-m1",
    seq: 5,
    author_id: "owner",
    content: "done",
    created_at: "",
    author: null,
  };
  const sendCalls = [];
  const sendFetch = async (url, init) => {
    sendCalls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ message: reply }) };
  };
  const sent = await postChannelMessage(
    "anchor-m1",
    "done",
    undefined,
    4,
    undefined,
    sendFetch,
  );
  assert.deepEqual(sent, { kind: "sent", message: reply });
  assert.deepEqual(JSON.parse(sendCalls[0].init.body), {
    targetId: "anchor-m1",
    content: "done",
    baseSeq: 4,
  });

  // 再确认完整两步序列：回复落线程 → update-status 置 in_review（顺序不可颠倒）
  const order = [];
  const taskRow = {
    id: "t1",
    message_id: "anchor-m1",
    number: 1,
    status: "in_review",
    reopened: 0,
  };
  const combinedFetch = async (url) => {
    order.push(url);
    if (url === "/api/messages")
      return { ok: true, status: 200, json: async () => ({ message: reply }) };
    return { ok: true, status: 200, json: async () => ({ task: taskRow }) };
  };
  const result = await completeTaskWithReply(
    "t1",
    "anchor-m1",
    "done",
    4,
    9,
    combinedFetch,
  );
  assert.deepEqual(result, { kind: "updated", task: taskRow });
  assert.deepEqual(order, ["/api/messages", "/api/tasks/t1/update-status"]);
});

// 04 票红-绿切片 6：创建两途径（convert 已有消息 / board 先发消息再建任务）
test("convertMessageToTaskRow and createBoardTaskRow post the task creation payloads", async () => {
  const { convertMessageToTaskRow, createBoardTaskRow } = await jiti.import(
    "./useChannelData.ts",
  );
  const taskRow = {
    id: "t1",
    message_id: "m1",
    number: 1,
    status: "todo",
    reopened: 0,
  };
  const calls = [];
  const stubFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 201, json: async () => ({ task: taskRow }) };
  };

  assert.deepEqual(await convertMessageToTaskRow("m1", stubFetch), taskRow);
  assert.equal(calls[0].url, "/api/tasks");
  assert.deepEqual(JSON.parse(calls[0].init.body), { messageId: "m1" });

  assert.deepEqual(await createBoardTaskRow("c1", "do it", stubFetch), taskRow);
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    channelId: "c1",
    content: "do it",
  });

  const dupFetch = async () => ({
    ok: false,
    status: 409,
    json: async () => ({ error: "already a task" }),
  });
  await assert.rejects(
    () => convertMessageToTaskRow("m1", dupFetch),
    /already a task/,
  );
});

// fix-new-agent-invisible 回归（#12 打回补齐）：membersVersion 显式失效。
// 根因：channelMemberIds 只在 channelId 变化时加载，不切频道时旧快照恒 stale，
// 人数/成员面板/@ 候选三处派生全被过滤掉。失效链：AppShell 创建后递增 →
// ChannelView 透传 → hook 经 loadMembers 重拉收敛。
test("shouldInvalidateMembers only invalidates on an explicit positive version", async () => {
  const { shouldInvalidateMembers } = await jiti.import("./useChannelData.ts");
  // 未传/0 = 旧调用方行为不变（不额外触发重拉）。
  assert.equal(shouldInvalidateMembers(undefined), false);
  assert.equal(shouldInvalidateMembers(0), false);
  // 创建后递增（1, 2, …）= 显式失效，触发 loadMembers 重拉。
  assert.equal(shouldInvalidateMembers(1), true);
  assert.equal(shouldInvalidateMembers(2), true);
});

// 失效→重拉→收敛：loadChannelMemberIds 返回含新成员时集合收敛含新 id
// （hook 内 effect 调用的同一纯函数；effect 本体由 ChannelView 透传测试锁定）。
test("loadChannelMemberIds converges to include the new member after invalidation", async () => {
  const { loadChannelMemberIds } = await jiti.import("./useChannelData.ts");
  const stubFetch = async (url) => {
    assert.match(url, /\/api\/channels\/c1\/members/);
    return {
      ok: true,
      json: async () => ({ members: [{ id: "owner" }, { id: "agent-new" }] }),
    };
  };
  const ids = await loadChannelMemberIds("c1", stubFetch);
  assert.equal(ids.has("agent-new"), true);
  assert.equal(ids.has("owner"), true);
});

// BAI-6 打开频道期间推进游标（本票 tight 回路的回归锁定）：
// 轮询合并出新消息（next !== base）时必须 POST /api/channels/<cid>/read，否则
// 切走后残留陈旧角标。markChannelRead 是纯函数（fetch 可注入），effect 本体
// 只做 fire-and-forget 调用（ChannelView 集成行为，见票据验收）。
test("markChannelRead posts to the channel read endpoint and returns readSeq", async () => {
  const { markChannelRead } = await jiti.import("./useChannelData.ts");
  const calls = [];
  const stubFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ readSeq: 7 }) };
  };

  assert.equal(await markChannelRead("c1", stubFetch), 7);
  assert.equal(calls[0].url, "/api/channels/c1/read");
  assert.equal(calls[0].init.method, "POST");
});

test("markChannelRead maps HTTP errors to Error", async () => {
  const { markChannelRead } = await jiti.import("./useChannelData.ts");
  const errFetch = async () => ({
    ok: false,
    status: 404,
    json: async () => ({}),
  });
  await assert.rejects(
    () => markChannelRead("missing", errFetch),
    /POST read: 404/,
  );
});

test("markChannelRead defaults a missing readSeq to 0", async () => {
  const { markChannelRead } = await jiti.import("./useChannelData.ts");
  const emptyFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
  });
  assert.equal(await markChannelRead("c1", emptyFetch), 0);
});

test("postTaskThreadRead sends only the addressed Task and presented thread seq", async () => {
  const { postTaskThreadRead } = await jiti.import("./useChannelData.ts");
  const calls = [];
  const stubFetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ baselineSeq: 2, readSeq: 5, unreadReplyCount: 0 }),
    };
  };

  assert.deepEqual(await postTaskThreadRead("task-7", 8, stubFetch), {
    baselineSeq: 2,
    readSeq: 5,
    unreadReplyCount: 0,
  });
  assert.equal(calls[0].url, "/api/tasks/task-7/read");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), { throughSeq: 8 });
});

test("mergeTaskUnreadCounts refreshes unread count and timestamp without replacing stable rows", async () => {
  const { mergeTaskUnreadCounts } = await jiti.import("./useChannelData.ts");
  const taskA = {
    id: "task-a",
    status: "todo",
    unreadReplyCount: 1,
    latestUnreadReplyAt: "2026-10-10T10:00:00.000Z",
  };
  const taskB = {
    id: "task-b",
    status: "done",
    unreadReplyCount: 1,
    latestUnreadReplyAt: "2026-10-10T11:00:00.000Z",
  };
  const current = [taskA, taskB];
  const refreshed = mergeTaskUnreadCounts(current, [
    {
      id: "task-a",
      status: "todo",
      unreadReplyCount: 0,
      latestUnreadReplyAt: null,
    },
    {
      id: "task-b",
      status: "closed",
      unreadReplyCount: 1,
      latestUnreadReplyAt: "2026-10-10T12:00:00.000Z",
    },
  ]);

  assert.deepEqual(refreshed.map((task) => task.unreadReplyCount), [0, 1]);
  assert.deepEqual(
    refreshed.map((task) => task.latestUnreadReplyAt),
    [null, "2026-10-10T12:00:00.000Z"],
  );
  assert.equal(refreshed[0].status, "todo", "only unread state is refreshed");
  assert.equal(refreshed[1].status, "done", "task status remains owned by the normal task reload");
  assert.notEqual(refreshed[0], taskA);
  assert.notEqual(refreshed[1], taskB);
  assert.equal(mergeTaskUnreadCounts(current, current), current);
});
