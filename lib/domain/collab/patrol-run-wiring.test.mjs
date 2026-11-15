import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../../data/sqlite.ts";
import { OWNER_MEMBER_ID } from "../../data/schema.ts";

/**
 * 巡检的**默认接线**（票 #267）：真实临时 SQLite + 真实 sendMessage，不注入任何读取器。
 *
 * 这里钉的是三条承重结论：
 * 1. 发现真的落成频道消息（作者是首席、恰好一条）；
 * 2. 它按**系统事件**语义投递——不唤醒任何人、不占房间轮次预算（否则巡检会持续吃掉
 *    `MAX_REPLIES`，把正常对话挤成沉默，spec #265）；
 * 3. 扫描范围真的跳过 DM 与归档频道。
 */

let root;
let fixtureSeq = 0;

test.beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-patrol-wiring-"));
  globalThis.__workspliceDb = openDataDb(root);
  setPatrolSignatureStore(null);
  setRoomTurnStore(null);
});

test.afterEach(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
  setPatrolSignatureStore(null);
  setRoomTurnStore(null);
});

const { runPatrolOnce, setPatrolSignatureStore } = await import("./patrol-run.ts");
const {
  createAgent,
  createChannel,
  createDirectChannel,
  createTask,
  getRoomTurnStore,
  joinChannel,
  listMessages,
  sendMessage,
  setChannelArchived,
  setChannelChief,
  setGlobalChief,
  setRoomTurnStore,
  subscribeWake,
} = await import("./index.ts");

function unique(prefix) {
  fixtureSeq += 1;
  return `${prefix}-${fixtureSeq}`;
}

function makeChief() {
  const chief = createAgent({ name: unique("chief") });
  setGlobalChief(chief.id);
  return chief;
}

/** 频道里造一条卡住 31 分钟的未认领 todo（锚点 created_at 是现在，落在 7 天窗口内）。 */
function stalledTodo(channelId, { minutes = 31, content = "please take this" } = {}) {
  const sent = sendMessage({ targetId: channelId, authorId: OWNER_MEMBER_ID, content });
  assert.equal(sent.held, false);
  const task = createTask({ messageId: sent.message.id });
  globalThis.__workspliceDb.updateTask(task.id, {
    updatedAt: new Date(Date.now() - minutes * 60_000).toISOString(),
  });
  return task;
}

test("默认接线：她作为生效首席的频道里恰好一条汇总，作者是首席", () => {
  const chief = makeChief();
  const channel = createChannel({ name: unique("team") });
  joinChannel(channel.id, chief.id);
  const task = stalledTodo(channel.id);

  const before = listMessages(channel.id).messages.length;
  const result = runPatrolOnce();

  assert.equal(result.status, "reported");
  const messages = listMessages(channel.id).messages;
  assert.equal(messages.length, before + 1, "每轮最多一条汇总消息");
  const summary = messages[messages.length - 1];
  assert.equal(summary.author_id, chief.id);
  assert.match(summary.content, /^Task patrol: 1 stalled task/);
  assert.match(summary.content, new RegExp(`#${task.number} in #${channel.name}: todo unclaimed`));
});

test("系统事件语义：不唤醒任何人、不占房间轮次预算", () => {
  const chief = makeChief();
  const channel = createChannel({ name: unique("team") });
  joinChannel(channel.id, chief.id);
  stalledTodo(channel.id);
  // Owner 的 anchor 消息已经开了一场房间场次；巡检消息不得计入它。
  const before = getRoomTurnStore().snapshot(channel.id);
  assert.ok(before?.turn, "前置条件：房间场次已在跑");

  const wakes = [];
  const unsubscribe = subscribeWake((hint) => wakes.push(hint));
  try {
    assert.equal(runPatrolOnce().status, "reported");
  } finally {
    unsubscribe();
  }

  assert.deepEqual(wakes, [], "巡检不唤醒任何人");
  const after = getRoomTurnStore().snapshot(channel.id);
  assert.equal(after.turn.replies, before.turn.replies, "I1：不计入发言预算");
  assert.equal(after.epoch, before.epoch, "不开新房次、不 supersede 在跑的场次");
  assert.equal(after.lateTurns, before.lateTurns, "不动迟到名额");
});

test("可见性：私有频道的发现不进公开落点的汇总（私有频道里一句话也不说）", () => {
  const chief = makeChief();
  const rival = createAgent({ name: unique("rival") });
  const pub = createChannel({ name: unique("team") });
  joinChannel(pub.id, chief.id);
  // 私有频道：她只是成员，频道首席是别人 ⇒ 私有且非落点。
  const secret = createChannel({
    name: unique("vault"),
    type: "private",
    memberIds: [chief.id, rival.id],
  });
  setChannelChief(secret.id, rival.id);

  const publicTask = stalledTodo(pub.id);
  const secretTask = stalledTodo(secret.id);
  const secretBefore = listMessages(secret.id).messages.length;

  assert.equal(runPatrolOnce().status, "reported");

  const messages = listMessages(pub.id).messages;
  const summary = messages[messages.length - 1];
  assert.equal(summary.author_id, chief.id);
  assert.match(summary.content, new RegExp(`#${publicTask.number} in #${pub.name}: todo unclaimed`));
  assert.equal(
    summary.content.split("\n").length,
    2,
    "汇总只有公开落点那一条发现",
  );
  assert.doesNotMatch(
    summary.content,
    new RegExp(`#${secretTask.number} in #${secret.name}`),
    "私有频道的名字与任务号不得进公开频道",
  );
  assert.equal(listMessages(secret.id).messages.length, secretBefore, "私有频道里不说话");
});

test("可见性：唯一一批发现落在私有频道（她不是其首席）时整轮静默", () => {
  const chief = makeChief();
  const rival = createAgent({ name: unique("rival") });
  const secret = createChannel({
    name: unique("vault"),
    type: "private",
    memberIds: [chief.id, rival.id],
  });
  setChannelChief(secret.id, rival.id);

  stalledTodo(secret.id);
  const secretBefore = listMessages(secret.id).messages.length;

  // 兜底落点是一个公开频道（她所在的公开频道必然包含 #all），但私有非落点的发现不上报 ⇒ 无话可说。
  assert.equal(runPatrolOnce().status, "silent");
  assert.equal(listMessages(secret.id).messages.length, secretBefore, "私有频道里不说话");
});

test("扫描范围：跳过 DM 与归档频道", () => {
  const chief = makeChief();
  const dm = createDirectChannel(chief.id);
  stalledTodo(dm.id);
  const archived = createChannel({ name: unique("dead") });
  joinChannel(archived.id, chief.id);
  stalledTodo(archived.id);
  setChannelArchived(archived.id, true, OWNER_MEMBER_ID);

  const dmBefore = listMessages(dm.id).messages.length;
  const result = runPatrolOnce();

  assert.equal(result.status, "silent");
  assert.equal(listMessages(dm.id).messages.length, dmBefore, "私信里不说话");
});
