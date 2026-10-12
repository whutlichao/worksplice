/**
 * 打开线程面板时的初始滚动落点（票据 `.scratch/thread-open-scroll/issues/01-thread-open-scroll.md`）。
 *
 * 三层 seam 各断在自己的层上，都不依赖真实浏览器滚动：
 * ① **判定**：`threadInitialScroll`（`lib/panel-state.ts` 的纯函数）——replies + taskId + readSeq → 落点结论；
 * ② **落点应用**：`applyThreadInitialScroll` + 注入的假滚动容器（结构子集，不碰真实 DOM）；
 * ③ **接线**：面板内容装配点 / ThreadPanel 渲染面 / 三个消费点的源码级事实
 *    （与 `components/dock.test.mjs` 同档：组件只写 class 与属性，形态在 CSS）；
 * ④ **读数**：`TaskView.taskThreadReadSeq`（落点判定的输入），并锁住已读推进语义不变。
 *
 * `renderToStaticMarkup` 不跑 effect，仓库也没有 jsdom ⇒ 真正的「初始落点被应用」的证据在
 * ego-browser 里取（见票据 Answer 的浏览器验收），这里只断 seam 与接线。
 *
 * 结构注意：所有顶层 await（setup / 建库）必须在任何 `test()` 之前完成——
 * 顶层 await 期间 node:test 会开始跑已注册的用例，此时注册的 `test.after` 会在
 * 后面的用例之前触发（此前踩过：DB 在最后一组用例前被 close）。
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { threadPanel, threadInitialScroll, applyThreadInitialScroll } = await jiti.import(
  "../lib/panel-state.ts",
);
const { ThreadPanel } = await jiti.import("./ThreadPanel.tsx");
const { DetailPanel } = await jiti.import("./DetailPanel.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");
const { openDataDb } = await jiti.import("../lib/data/sqlite.ts");
const { OWNER_MEMBER_ID } = await jiti.import("../lib/data/schema.ts");
const { createChannel, joinChannel } = await jiti.import("../lib/domain/collab/channels.ts");
const { sendMessage } = await jiti.import("../lib/domain/collab/messages.ts");
const { createTask, getTaskView, listChannelTasks, markTaskThreadRead } = await jiti.import(
  "../lib/domain/collab/tasks.ts",
);

const detailPanelSource = await readFile(
  new URL("./DetailPanel.tsx", import.meta.url),
  "utf8",
);
const threadPanelSource = await readFile(
  new URL("./ThreadPanel.tsx", import.meta.url),
  "utf8",
);
const channelViewSource = await readFile(
  new URL("./ChannelView.tsx", import.meta.url),
  "utf8",
);

const dbRoot = mkdtempSync(join(tmpdir(), "worksplice-thread-open-scroll-"));
const store = openDataDb(dbRoot);
globalThis.__workspliceDb = store;
test.after(() => {
  store.close();
  delete globalThis.__workspliceDb;
  rmSync(dbRoot, { recursive: true, force: true });
});

const OWNER = {
  id: "owner",
  type: "human",
  name: "Owner",
  description: "",
  role: "owner",
  workspace_path: null,
  pi_session_file: null,
  status: "online",
  deleted: 0,
  model_provider: null,
  model_id: null,
  thinking_level: null,
  created_at: "2026-10-01T00:00:00.000Z",
};

const AGENT = { ...OWNER, id: "agent-1", type: "agent", name: "bob", role: "member" };

const CHANNEL = {
  id: "c1",
  name: "general",
  type: "public",
  description: "chat",
  archived: 0,
  created_at: "2026-10-01T00:00:00.000Z",
  joined: true,
  memberCount: 2,
};

const ANCHOR = {
  id: "anchor-1",
  target_id: "c1",
  seq: 3,
  author_id: OWNER.id,
  content: "task anchor",
  created_at: "2026-10-01T00:00:00.000Z",
  author: OWNER,
};

function reply(seq, authorId) {
  return {
    id: `m${seq}`,
    target_id: ANCHOR.id,
    seq,
    author_id: authorId,
    content: `reply ${seq}`,
    created_at: `2026-10-01T00:00:0${seq}.000Z`,
    author: authorId === OWNER.id ? OWNER : AGENT,
  };
}

function renderThreadPanel(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ThreadPanel, {
        anchorId: ANCHOR.id,
        channel: CHANNEL,
        currentMemberId: OWNER.id,
        agents: [AGENT],
        owner: OWNER,
        onOpenPanel: () => undefined,
        onClose: () => undefined,
        initialAnchor: ANCHOR,
        initialMessages: [],
        ...overrides,
      }),
    ),
  );
}

/** 假滚动容器：只实现 seam 需要的结构子集（不读 DOM、无真实布局）。 */
function fakeScrollPort(rows, { scrollTop = 0, scrollHeight = 1000 } = {}) {
  return {
    scrollTop,
    scrollHeight,
    replyRowOffset(seq) {
      return rows[seq] ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// ① 判定（纯函数 seam）
// ---------------------------------------------------------------------------

test("有未读回复时落点是最早一条未读回复，不是最新一条", () => {
  const decision = threadInitialScroll({
    replies: [reply(2, AGENT.id), reply(3, AGENT.id), reply(4, AGENT.id)],
    taskId: "task-1",
    readSeq: 1,
  });
  assert.deepEqual(decision, { kind: "unread", seq: 2 });
});

test("已读游标是「大于」边界：seq == readSeq 算已读，之后第一条非 Owner 回复才是落点", () => {
  assert.deepEqual(
    threadInitialScroll({
      replies: [reply(2, AGENT.id), reply(3, AGENT.id), reply(4, AGENT.id)],
      taskId: "task-1",
      readSeq: 2,
    }),
    { kind: "unread", seq: 3 },
  );

  // 输入乱序（轮询合并的增量页）不影响结论
  assert.deepEqual(
    threadInitialScroll({
      replies: [reply(7, AGENT.id), reply(5, AGENT.id), reply(9, AGENT.id)],
      taskId: "task-1",
      readSeq: 4,
    }),
    { kind: "unread", seq: 5 },
  );
});

test("Owner 自己的回复不算未读：不能成为落点，也不能把落点判成 unread", () => {
  assert.deepEqual(
    threadInitialScroll({
      replies: [reply(2, OWNER.id), reply(3, AGENT.id)],
      taskId: "task-1",
      readSeq: 1,
    }),
    { kind: "unread", seq: 3 },
    "游标之后的 Owner 回复被跳过",
  );

  assert.deepEqual(
    threadInitialScroll({
      replies: [reply(2, OWNER.id), reply(3, OWNER.id)],
      taskId: "task-1",
      readSeq: 1,
    }),
    { kind: "bottom" },
    "全是 Owner 回复 ⇒ 没有未读",
  );
});

test("无未读 / 空列表 ⇒ bottom", () => {
  assert.deepEqual(
    threadInitialScroll({
      replies: [reply(2, AGENT.id), reply(3, OWNER.id)],
      taskId: "task-1",
      readSeq: 3,
    }),
    { kind: "bottom" },
  );
  assert.deepEqual(
    threadInitialScroll({ replies: [], taskId: "task-1", readSeq: 0 }),
    { kind: "bottom" },
  );
});

test("普通非 Task thread（无 taskId）⇒ bottom，即使看起来有未读回复", () => {
  assert.deepEqual(
    threadInitialScroll({ replies: [reply(2, AGENT.id), reply(3, AGENT.id)], readSeq: 0 }),
    { kind: "bottom" },
  );
});

test("有 taskId 但没有已读游标快照 ⇒ bottom（不猜、不降级成 unread/顶部）", () => {
  assert.deepEqual(
    threadInitialScroll({ replies: [reply(2, AGENT.id)], taskId: "task-1" }),
    { kind: "bottom" },
  );
});

// ---------------------------------------------------------------------------
// ② 落点应用（注入的假滚动容器）
// ---------------------------------------------------------------------------

test("unread 落点把该行贴到滚动区顶部（scrollTop = 该行偏移）", () => {
  const port = fakeScrollPort({ 5: 420 });
  applyThreadInitialScroll(port, { kind: "unread", seq: 5 });
  assert.equal(port.scrollTop, 420);
});

test("bottom 落点 = scrollHeight；未读那条不在当前渲染里时退到 bottom；容器缺失不抛错", () => {
  const bottom = fakeScrollPort({});
  applyThreadInitialScroll(bottom, { kind: "bottom" });
  assert.equal(bottom.scrollTop, bottom.scrollHeight);

  const missing = fakeScrollPort({ 5: 420 });
  applyThreadInitialScroll(missing, { kind: "unread", seq: 99 });
  assert.equal(missing.scrollTop, missing.scrollHeight, "找不到行时退到最新，不静默停在顶部");

  assert.doesNotThrow(() => applyThreadInitialScroll(null, { kind: "unread", seq: 5 }));
  assert.doesNotThrow(() => applyThreadInitialScroll(null, { kind: "bottom" }));
});

// ---------------------------------------------------------------------------
// ③ 接线：装配点 / 渲染面 / 消费点
// ---------------------------------------------------------------------------

test("面板内容携带 Task 已读游标（`threadPanel` 是唯一装配点）", () => {
  assert.deepEqual(threadPanel("anchor-1", undefined), { kind: "thread", id: "anchor-1" });
  assert.deepEqual(threadPanel("anchor-1", null), { kind: "thread", id: "anchor-1" });
  assert.deepEqual(threadPanel("anchor-1", { id: "task-1", readSeq: 4 }), {
    kind: "thread",
    id: "anchor-1",
    taskId: "task-1",
    taskReadSeq: 4,
  });
  assert.deepEqual(
    threadPanel("anchor-1", { id: "task-1" }),
    { kind: "thread", id: "anchor-1", taskId: "task-1" },
    "拿不到游标就不写这个键（判定侧按「无快照 ⇒ bottom」处理）",
  );
});

test("ThreadPanel 把每条回复标上线程自己的 seq（落点定位的稳定句柄）", () => {
  const html = renderThreadPanel({ initialMessages: [reply(4, AGENT.id), reply(5, AGENT.id)] });
  assert.match(html, /data-thread-message-seq="4"/);
  assert.match(html, /data-thread-message-seq="5"/);
  assert.doesNotMatch(
    html,
    /data-thread-message-seq="3"/,
    "锚点用频道 seq，不能与线程回复混在一个句柄里",
  );
});

test("DetailPanel 把 Task 已读游标透传给 ThreadPanel，并照常分派到线程面板", () => {
  assert.match(detailPanelSource, /taskReadSeq=\{content\.taskReadSeq\}/);
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(DetailPanel, {
        content: { kind: "thread", id: ANCHOR.id, taskId: "task-1", taskReadSeq: 4 },
        channel: CHANNEL,
        agents: [AGENT],
        owner: OWNER,
        currentMemberId: OWNER.id,
        onClose: () => undefined,
        onChanged: () => undefined,
        onOpenPanel: () => undefined,
      }),
    ),
  );
  assert.match(html, /class="tt-scroll"/);
  assert.match(html, /class="tt-reply"/);
});

test("ThreadPanel 的初始落点经 seam 应用一次（layout effect + 可注入滚动容器）", () => {
  assert.match(threadPanelSource, /threadInitialScroll\(\{/, "判定必须走纯函数 seam");
  assert.match(threadPanelSource, /applyThreadInitialScroll\(/, "落点应用必须走 seam");
  assert.match(threadPanelSource, /useLayoutEffect\(/, "落点在首帧布局期应用，避免可见跳变");
  assert.match(
    threadPanelSource,
    /if \(threadReady && landedRef\.current === anchorId\) return;/,
    "每个打开的线程只落一次（换线程才重落）",
  );
  // 面板内换线程时 effect 会先带着上一条线程的 anchor 跑一轮：那一轮必须被 threadReady 拦下，
  // 且**不能占 landedRef 的坑**（否则真正就绪那轮不再落点，普通 thread 会停在顶部）。
  assert.match(
    threadPanelSource,
    /if \(!threadReady\) return;/,
    "陈旧 anchor 那一轮不得写 landedRef",
  );
  // 判定的三个输入都来自面板内容 / 锚点，不从 DOM 反推。
  assert.match(threadPanelSource, /readSeq: taskReadSeq/);
  assert.match(threadPanelSource, /taskId,/);
  assert.match(threadPanelSource, /ownerId: currentMemberId/);
});

test("线程轮询合并新回复时不得抢滚动", () => {
  const pollStart = threadPanelSource.indexOf("// 面板线程轮询");
  assert.ok(pollStart > 0, "找不到轮询 effect 的起始标记");
  const pollEnd = threadPanelSource.indexOf("}, [anchorId]);", pollStart);
  assert.ok(pollEnd > pollStart, "找不到轮询 effect 的结束标记");
  const pollEffect = threadPanelSource.slice(pollStart, pollEnd);
  for (const scrollCall of ["scrollTop", "scrollTo", "scrollIntoView", "scrollHeight"]) {
    assert.doesNotMatch(
      pollEffect,
      new RegExp(scrollCall),
      `轮询合并新回复时不应触碰滚动（命中 ${scrollCall}）`,
    );
  }
});

test("ChannelView 的线程打开收敛到 `threadPanel` 单一装配点", () => {
  assert.match(channelViewSource, /threadPanel\(/, "线程打开必须经唯一装配点");
  assert.doesNotMatch(
    channelViewSource,
    /kind: "thread"/,
    "不得再有手写的 thread 面板内容字面量（否则会漏带 Task 已读游标）",
  );
});

// ---------------------------------------------------------------------------
// ④ 读数：TaskView 暴露该 Task thread 的已读游标 + 已读推进语义不变
// ---------------------------------------------------------------------------

function taskFixture(name) {
  const channel = createChannel({ name });
  const agent = store.insertMember({ type: "agent", name: `${name}-agent` });
  joinChannel(channel.id, agent.id);
  const anchor = store.appendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: `${name} anchor`,
  });
  const task = createTask({ messageId: anchor.id });
  return { channel, agent, anchor, task };
}

function send(targetId, authorId, content, baseSeq) {
  const result = sendMessage({ targetId, authorId, content, baseSeq });
  assert.equal(result.held, false);
  return result.message;
}

test("TaskView 暴露该 Task thread 的已读游标（落点判定的 readSeq 来源）", () => {
  const { channel, agent, anchor, task } = taskFixture("thread-open-scroll-cursor");
  assert.equal(getTaskView(task.id).taskThreadReadSeq, 0, "新 Task 基线 0，无未读");

  send(anchor.id, agent.id, "first unread reply");
  const listed = listChannelTasks(channel.id)[0];
  assert.equal(listed.taskThreadReadSeq, 0, "未读不推进游标");
  assert.equal(listed.unreadReplyCount, 1);

  send(anchor.id, agent.id, "second unread reply");
  markTaskThreadRead({ taskId: task.id, throughSeq: anchor.seq + 1 });
  assert.equal(
    getTaskView(task.id).taskThreadReadSeq,
    anchor.seq + 1,
    "已读数与未读口径同一份游标",
  );
});

test("已读推进语义不变：Owner 回复不推游标，超过已呈现序号的回复不算已读", () => {
  const { agent, anchor, task } = taskFixture("thread-open-scroll-semantics");
  const firstReply = send(anchor.id, agent.id, "visible reply");
  const ownerReply = send(anchor.id, OWNER_MEMBER_ID, "owner reply");
  const laterReply = send(anchor.id, agent.id, "not yet presented");

  const advanced = markTaskThreadRead({ taskId: task.id, throughSeq: ownerReply.seq });
  assert.equal(advanced.readSeq, firstReply.seq, "Owner 回复不能推进 Task 游标");
  assert.equal(advanced.unreadReplyCount, 1, "更晚的非 Owner 回复仍未读");

  markTaskThreadRead({ taskId: task.id, throughSeq: laterReply.seq });
  const read = getTaskView(task.id);
  assert.equal(read.taskThreadReadSeq, laterReply.seq);
  assert.equal(read.unreadReplyCount, 0);
});
