import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../../data/sqlite.ts";

/**
 * 房间轮次预算验收（Ticket room-turn-budget，设计记录 `.scratch/room-turn-budget/spec.md`）。
 *
 * 一段一段测同一个东西：「多 agent 群聊里结构性不可能无限互相接话」。
 * 每条用例在注释里点名它守的不变量（I1–I8），并给出「机制被删掉时它怎么红」——
 * 红证据按机制消融（mutation）取得，不是「文件不存在」式红。
 *
 * 接缝纪律：本文件只用 `lib/domain/collab/room-budget.ts` 的公共接口（store / bridge）
 * 与 `messages.ts::sendMessage` 的唯一漏斗；脚本化 fake 成员（`(prompt) => string`）与
 * 可注入时钟，不接真模型、无网络、无真实 sleep。
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-room-budget-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const {
  DEFAULT_ROOM_LIMITS,
  ROOM_PRIVATE_CHANNEL_MESSAGE,
  RoomPrivateChannelForbidden,
  advanceRequestHop,
  createDirectRequestBridge,
  createRoomTurnStore,
  setRoomTurnStore,
} = await import("./room-budget.ts");
const { createAgent, createChannel, createTask, joinChannel, listMessages, sendMessage, subscribeWake } =
  await import("./index.ts");
const { OWNER_MEMBER_ID } = await import("../../data/schema.ts");

/** 极小上限（§7）：测试必须确定地改小，不许读环境变量 / 配置文件。 */
const TINY = {
  MAX_ROUNDS: 2,
  MAX_REPLIES: 3,
  MEMBER_TIMEOUT_MS: 50,
  MAX_LATE_TURNS: 1,
};

/**
 * 造一个独立房间 store：注入纯映射的目录/时钟/@解析，不碰数据库。
 * `script` 里的 fake 成员是 `(prompt) => string`。
 */
function makeRoom({ limits = TINY, members = ["A", "B", "C"], room = true } = {}) {
  const clock = { t: 1_000 };
  const announced = [];
  const store = createRoomTurnStore({
    limits,
    now: () => clock.t,
    // @A → "A"（测试替身；真实实现是 members.extractMentionedMemberIds）
    mentions: (text) => members.filter((member) => text.includes(`@${member}`)),
    directory: {
      channelAgentMembers: () => members,
      isAgent: (memberId) => members.includes(memberId),
      isRoomChannel: () => room,
    },
    notify: (hint) => announced.push(hint),
  });
  return { store, clock, announced, members };
}

/**
 * 事件驱动的房间驱动器（测试替身，**不是**生产路径——生产是 wake → driver → runAgentRound）。
 * 反复读快照：让本波还没有结论的成员按脚本说话，直到场次收口。
 * 脚本返回 `(pass)` / `(busy)` / `(hang)` 三个控制词或一段正文。
 */
function drive(store, channelId, script, { clock, maxSteps = 200 } = {}) {
  const spoken = [];
  let seq = 100;
  for (let step = 0; step < maxSteps; step += 1) {
    const turn = store.snapshot(channelId)?.turn;
    if (!turn || turn.endedReason !== null) break;
    const pending = [...turn.elected].filter((member) => !turn.settled.has(member));
    if (pending.length === 0) break;
    let acted = false;
    for (const member of pending) {
      const reply = (script[member] ?? (() => "(pass)"))(`room:${member}`);
      if (reply === "(hang)") continue;
      if (reply === "(busy)") {
        store.noteBusy({ channelId, memberId: member });
        acted = true;
        continue;
      }
      if (reply === "(pass)") {
        store.notePass({ channelId, memberId: member });
        acted = true;
        continue;
      }
      seq += 1;
      store.noteReply({ channelId, memberId: member, seq, text: reply });
      spoken.push({ member, seq, text: reply });
      acted = true;
    }
    // 全员挂起 ⇒ 推进时钟触发 I3 超时释放（房间不等待）
    if (!acted) {
      clock.t += TINY.MEMBER_TIMEOUT_MS;
      store.pump(channelId);
    }
  }
  return spoken;
}

// ---------------------------------------------------------------------------
// T1 · I1/I2/I4：纯互相 @ 的环
// ---------------------------------------------------------------------------

test("T1 纯互相 @ 的环：发言与波次封顶，同一条 @ 不二次唤起", () => {
  const { store, members } = makeRoom();
  const channelId = "room-t1";
  store.beginTurn({ channelId, triggerSeq: 1, text: "你们俩怎么看", authorId: "owner" });
  const spoken = drive(
    store,
    channelId,
    {
      A: () => "@B 你怎么看",
      B: () => "@A 你怎么看",
      C: () => "(pass)",
    },
    { clock: { t: 1_000 } },
  );
  const turn = store.snapshot(channelId).turn;
  // I2：选人次数 ≤ MAX_ROUNDS × 成员数
  assert.ok(
    turn.askLog.length <= TINY.MAX_ROUNDS * members.length,
    `askLog=${turn.askLog.length} 超出 MAX_ROUNDS × members`,
  );
  // I1：bot 发言总数 ≤ MAX_REPLIES
  assert.ok(spoken.length <= TINY.MAX_REPLIES, `bot 发言 ${spoken.length} 超出 MAX_REPLIES`);
  assert.ok(turn.replies <= TINY.MAX_REPLIES);
  // I4-a：同一条 @ 不二次唤起（member@citedAtSeq 唯一）
  const keys = turn.askLog.map((record) => `${record.member}@${record.citedAtSeq ?? record.shownSeq}`);
  assert.equal(new Set(keys).size, keys.length, "同一条 @ 唤起了同一成员两次");
  assert.ok(
    ["round_budget", "reply_budget", "no_speakers"].includes(turn.endedReason),
    `endedReason=${turn.endedReason}`,
  );
});

// ---------------------------------------------------------------------------
// T2（T1b）· I4-b：环被数据切断，不是被预算兜住
// ---------------------------------------------------------------------------

test("T2 环在数据层被切断：预算放大到 50/100 也只走一波", () => {
  const { store } = makeRoom({ limits: { ...TINY, MAX_ROUNDS: 50, MAX_REPLIES: 100 } });
  const channelId = "room-t2";
  store.beginTurn({ channelId, triggerSeq: 1, text: "@A @B 你们聊聊", authorId: "owner" });
  const spoken = drive(
    store,
    channelId,
    {
      A: () => "@B 你怎么看",
      B: () => "@A 你怎么看",
      C: () => "(pass)",
    },
    { clock: { t: 1_000 } },
  );
  const turn = store.snapshot(channelId).turn;
  // 删掉回边抑制（isBackEdge）后：wave 变 2、bot 发言变 3、askLog 出现 wave===1
  // 的条目、endedReason 变 round_budget —— 这条用例必红。
  assert.equal(turn.wave, 1, "只应执行一波选人");
  assert.equal(spoken.length, 2, "恰好 2 条 bot 发言");
  assert.equal(turn.endedReason, "no_speakers");
  assert.equal(
    turn.askLog.filter((record) => record.wave === 1).length,
    0,
    "第二波不该问任何人",
  );
});

// ---------------------------------------------------------------------------
// T3 · I1/§5：礼貌循环（全员 pass）
// ---------------------------------------------------------------------------

test("T3 全员 pass 的礼貌循环：0 条发言、波次 1、每人恰好被问一次", () => {
  const { store } = makeRoom();
  const channelId = "room-t3";
  store.beginTurn({ channelId, triggerSeq: 1, text: "开会了，各自说说", authorId: "owner" });
  const spoken = drive(store, channelId, { A: () => "(pass)", B: () => "(pass)", C: () => "(pass)" }, {
    clock: { t: 1_000 },
  });
  const turn = store.snapshot(channelId).turn;
  assert.equal(spoken.length, 0);
  assert.equal(turn.replies, 0, "pass 不计发言预算");
  assert.equal(turn.wave, 1);
  assert.deepEqual(turn.askLog.map((record) => record.member).sort(), ["A", "B", "C"]);
  assert.equal(turn.endedReason, "no_speakers");
});

test("T3-b 已自然收口的场次 Stop 幂等：不收口原因、不重复加 epoch", () => {
  const { store } = makeRoom();
  const channelId = "room-t3b";
  store.beginTurn({ channelId, triggerSeq: 1, text: "开会了，各自说说", authorId: "owner" });
  drive(store, channelId, { A: () => "(pass)", B: () => "(pass)", C: () => "(pass)" }, {
    clock: { t: 1_000 },
  });
  const before = store.snapshot(channelId);
  assert.equal(before.turn.endedReason, "no_speakers");

  const stopped = store.stopTurn(channelId);
  const after = store.snapshot(channelId);
  assert.deepEqual(stopped, { stopped: false, epoch: before.epoch });
  assert.equal(after.epoch, before.epoch, "Stop 不得对已收口场次再加 epoch");
  assert.equal(after.turn.endedReason, "no_speakers", "不得改写既有收口原因");
  assert.equal(after.turn.stale, before.turn.stale);
});

// ---------------------------------------------------------------------------
// T4 · §4 第一波：点名优先（含 reply-to 等价 @）
// ---------------------------------------------------------------------------

test("T4 点名优先：只 @C 就只问 C", () => {
  const { store } = makeRoom();
  const channelId = "room-t4";
  store.beginTurn({ channelId, triggerSeq: 1, text: "@C 你来说两句", authorId: "owner" });
  const spoken = drive(store, channelId, { C: () => "我的看法是这样。" }, { clock: { t: 1_000 } });
  const turn = store.snapshot(channelId).turn;
  assert.deepEqual(turn.askLog.map((record) => record.member), ["C"]);
  assert.equal(spoken.length, 1);
  assert.equal(turn.endedReason, "no_speakers");
});

test("T4b reply-to 等价点名：被回复的成员进第一波", () => {
  const { store } = makeRoom();
  const channelId = "room-t4b";
  store.beginTurn({
    channelId,
    triggerSeq: 1,
    text: "接着说",
    authorId: "owner",
    replyToAuthorId: "C",
  });
  const turn = store.snapshot(channelId).turn;
  assert.deepEqual(turn.askLog.map((record) => record.member), ["C"]);
  // 选人门（runAgentRound 入场用的就是它）：本波当选 = elected，没被问过 = not-elected
  assert.equal(store.gate({ channelId, memberId: "C" }).state, "elected");
  assert.equal(store.gate({ channelId, memberId: "B" }).state, "not-elected");
  // reminder 轮次 / 任务延续轮次不受此门约束（§6.3）
  assert.equal(store.gate({ channelId, memberId: "B", reason: "reminder" }).state, "bypass");
  assert.equal(store.gate({ channelId, memberId: "B", continuing: true }).state, "bypass");
});

// ---------------------------------------------------------------------------
// T5 · I5/I7：用户掐断
// ---------------------------------------------------------------------------

test("T5 用户掐断：迟到的回复只落库（stale/superseded），B 一次都没被问", () => {
  const { store } = makeRoom();
  const channelId = "room-t5";
  const epoch1 = store.beginTurn({ channelId, triggerSeq: 1, text: "@A 你怎么看", authorId: "owner" });
  // A 还没答，用户就发了下一条（I5：epoch 递增）
  const epoch2 = store.beginTurn({
    channelId,
    triggerSeq: 2,
    text: "先别说了，我们换个方向：@B 说说",
    authorId: "owner",
  });
  const note = store.noteReply({
    channelId,
    memberId: "A",
    seq: 3,
    text: "迟到的回答",
    epoch: epoch1,
  });
  assert.equal(note.stale, true);
  assert.equal(note.counted, false, "被取代场次的回复不计预算");
  const snapshot = store.snapshot(channelId);
  const superseded = snapshot.turns.find((turn) => turn.epoch === epoch1);
  assert.equal(superseded.stale, true);
  assert.equal(superseded.endedReason, "superseded");
  assert.equal(
    superseded.askLog.filter((record) => record.member === "B").length,
    0,
    "B 在第一场一次都没被问",
  );
  assert.equal(snapshot.turn.epoch, epoch2);
  assert.equal(snapshot.turn.replies, 0, "新场次只统计新消息之后的发言");
  assert.equal(snapshot.lateTurns, 0);
});

// ---------------------------------------------------------------------------
// T6 · I3/I7/I8：忙碌成员不阻塞、迟到回答预算、Stop 之后归零
// ---------------------------------------------------------------------------

test("T6 忙碌成员不阻塞、迟到回答只补一轮、Stop 后归零", () => {
  const { store, clock } = makeRoom();
  const channelId = "room-t6";
  store.beginTurn({ channelId, triggerSeq: 1, text: "大家都看看这个", authorId: "owner" });
  const spoken = drive(
    store,
    channelId,
    { A: () => "我看 A 的角度", B: () => "(busy)", C: () => "我看 C 的角度" },
    { clock },
  );
  let turn = store.snapshot(channelId).turn;
  const busyNotice = turn.transcript.filter((line) => line.kind === "busy-notice");
  assert.equal(busyNotice.length, 1, "忙碌成员出一条 busy-notice");
  assert.equal(busyNotice[0].author, "B");
  assert.deepEqual(spoken.map((entry) => entry.member), ["A", "C"], "房间不等 B，A/C 照常发言");

  // B 迟到回答并 @A ⇒ 一次补充询问 A（I7）
  store.noteReply({ channelId, memberId: "B", seq: 120, text: "@A 我回来了" });
  let snapshot = store.snapshot(channelId);
  assert.equal(snapshot.lateTurns, 1);
  assert.equal(
    snapshot.turn.askLog.filter((record) => record.member === "A").length,
    2,
    "A 被补充询问一次（第一波 + 补充波）",
  );
  // 补充波真的在等 A（不是记完 askLog 就立刻收口：settled 必须按波重置）
  assert.ok(snapshot.turn.elected.has("A"), "补充波把 A 选进来了");
  assert.equal(snapshot.turn.settled.has("A"), false, "A 还没给结论");
  assert.equal(snapshot.turn.endedReason, null);

  // 第二次迟到 ⇒ 只落库，预算耗尽
  store.noteReply({ channelId, memberId: "B", seq: 121, text: "@A 再说一句" });
  snapshot = store.snapshot(channelId);
  assert.equal(snapshot.turn.endedReason, "late_budget");

  // 已由 late_budget 自然收口：Stop 幂等 no-op，不改写既有终态。
  assert.deepEqual(store.stopTurn(channelId), {
    stopped: false,
    epoch: store.snapshot(channelId).epoch,
  });
  snapshot = store.snapshot(channelId);
  assert.equal(snapshot.turn.endedReason, "late_budget");

  // 人类新消息开新房次；活跃场次的 Stop 仍置哨兵、之后零补充波。
  store.beginTurn({ channelId, triggerSeq: 123, text: "好，收工", authorId: "owner" });
  assert.equal(store.snapshot(channelId).lateTurns, 0);
  assert.equal(store.stopTurn(channelId).stopped, true);
  snapshot = store.snapshot(channelId);
  assert.equal(snapshot.lateTurns, TINY.MAX_LATE_TURNS);
  const askedBeforeStop = snapshot.turn.askLog.length;
  store.noteReply({ channelId, memberId: "C", seq: 122, text: "@A 我也说一句" });
  snapshot = store.snapshot(channelId);
  assert.equal(snapshot.turn.askLog.length, askedBeforeStop, "Stop 之后零补充波");
  assert.equal(snapshot.turn.endedReason, "stopped");

  // 用户再发新消息 ⇒ lateTurns 归零（唯一重置点）
  store.beginTurn({ channelId, triggerSeq: 124, text: "真的收工", authorId: "owner" });
  assert.equal(store.snapshot(channelId).lateTurns, 0);

  // I3 超时：成员挂起不阻塞整场——超时只释放槽位（late），房间照常继续并收口
  const hung = makeRoom();
  const hungChannel = "room-t6-timeout";
  hung.store.beginTurn({
    channelId: hungChannel,
    triggerSeq: 1,
    text: "@A @B 你们看看这个",
    authorId: "owner",
  });
  const timeoutReplies = drive(
    hung.store,
    hungChannel,
    { A: () => "我先说", B: () => "(hang)" },
    { clock: hung.clock },
  );
  const timeoutTurn = hung.store.snapshot(hungChannel).turn;
  assert.deepEqual(timeoutReplies.map((entry) => entry.member), ["A"]);
  assert.equal(
    timeoutTurn.transcript.filter((line) => line.kind === "timeout-notice").length,
    1,
    "超时成员留一条 timeout-notice",
  );
  assert.ok(timeoutTurn.late.has("B"), "超时成员被释放为迟到（其后来发言走 I7）");
  assert.notEqual(timeoutTurn.endedReason, null, "超时之后整场照常收口，不卡住");
});

// ---------------------------------------------------------------------------
// T7 · I6：房间回合不得走房间看不见的通道
// ---------------------------------------------------------------------------

test("T7 私人通道被拒：roomContext 之外的频道抛 RoomPrivateChannelForbidden", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-room-t7-"));
  const agent = createAgent({ name: "room-guard-bot", workspacePath: workspace });
  const room = createChannel({ name: "room-t7" });
  const elsewhere = createChannel({ name: "elsewhere-t7" });
  joinChannel(room.id, agent.id);
  joinChannel(elsewhere.id, agent.id);

  assert.throws(
    () =>
      sendMessage({
        targetId: elsewhere.id,
        authorId: agent.id,
        content: "你好",
        roomContext: { channelId: room.id },
      }),
    (error) => {
      assert.ok(error instanceof RoomPrivateChannelForbidden);
      assert.equal(error.code, "room_private_channel_forbidden");
      assert.equal(error.message, "在群聊中不可用：请 @ 房间成员，让协作留在房间可见记录里。");
      assert.equal(error.message, ROOM_PRIVATE_CHANNEL_MESSAGE);
      return true;
    },
  );
  assert.equal(listMessages(elsewhere.id).messages.length, 0, "被拒的发送不落库");

  // 守卫不外溢：不带 roomContext 的同一发送照常成功
  const withoutContext = sendMessage({
    targetId: elsewhere.id,
    authorId: agent.id,
    content: "没有房间语境的发送",
  });
  assert.equal(withoutContext.held, false);

  // I5 的落库面：同频道 + 过期 epoch 的投递照常可见（回复照常落库，只是不计预算）
  const staleReply = sendMessage({
    targetId: room.id,
    authorId: agent.id,
    content: "被取代场次的回复照常可见",
    roomContext: { channelId: room.id, epoch: 0 },
  });
  assert.equal(staleReply.held, false);
  assert.ok(
    listMessages(room.id).messages.some((message) => message.content === "被取代场次的回复照常可见"),
  );
});

// ---------------------------------------------------------------------------
// T8 · 直连链预算（本仓无 agent→agent 派发工具，纯原语）
// ---------------------------------------------------------------------------

test("T8 直连链：跳数到顶 / 单发送者 / 全局待回信上限被拒，派发不等待回信", () => {
  // 跳数单调 +1，第 MAX_REQUEST_HOPS 跳（第 8 跳）被拒
  let hops = 0;
  for (let step = 0; step < DEFAULT_ROOM_LIMITS.MAX_REQUEST_HOPS - 1; step += 1) {
    const next = advanceRequestHop({ hops });
    assert.equal(next, hops + 1);
    hops = next;
  }
  assert.equal(hops, DEFAULT_ROOM_LIMITS.MAX_REQUEST_HOPS - 1);
  assert.throws(
    () => advanceRequestHop({ hops }),
    (error) => {
      assert.equal(error.code, "hop_limit_exceeded");
      assert.match(error.message, /请问用户/);
      return true;
    },
  );

  // 派发不等待回信：返回同步票据（不是 Promise），回信另走 settle
  const bridge = createDirectRequestBridge();
  const ticket = bridge.dispatch({ from: "sender-0" });
  assert.equal(ticket.hops, 1);
  assert.equal(typeof ticket.then, "undefined", "派发不得返回 Promise（不等待回信）");
  assert.equal(bridge.pendingCount(), 1);
  assert.equal(bridge.settle(ticket.id), true);
  assert.equal(bridge.pendingCount(), 0);

  // 单发送者第 17 条被拒
  const perSender = createDirectRequestBridge();
  for (let index = 0; index < DEFAULT_ROOM_LIMITS.MAX_PENDING_MESSAGES_PER_SENDER; index += 1) {
    perSender.dispatch({ from: "sender-0" });
  }
  assert.throws(
    () => perSender.dispatch({ from: "sender-0" }),
    (error) => {
      assert.equal(error.code, "pending_limit_per_sender");
      assert.match(error.message, /请问用户/);
      return true;
    },
  );

  // 全局第 65 条被拒（单个发送者先各自用满 16 条配额）
  const global = createDirectRequestBridge();
  const perSenderLimit = DEFAULT_ROOM_LIMITS.MAX_PENDING_MESSAGES_PER_SENDER;
  const senders = DEFAULT_ROOM_LIMITS.MAX_PENDING_MESSAGES / perSenderLimit;
  for (let sender = 0; sender < senders; sender += 1) {
    for (let index = 0; index < perSenderLimit; index += 1) {
      global.dispatch({ from: `sender-${sender}` });
    }
  }
  assert.equal(global.pendingCount(), DEFAULT_ROOM_LIMITS.MAX_PENDING_MESSAGES);
  assert.throws(
    () => global.dispatch({ from: "fresh-sender" }),
    (error) => {
      assert.equal(error.code, "pending_limit_global");
      assert.match(error.message, /请问用户/);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// T9 · 禁止项 #5：系统/事件消息不得开启新房次、不得重置 lateTurns
// ---------------------------------------------------------------------------

test("T9 Owner 署名的任务创建事件不开新房次、不重置 lateTurns；无秘书时不扇出", () => {
  const clock = { t: 1_000 };
  // 真库目录（成员/@解析走真实实现），只把时钟与上限换掉
  const store = createRoomTurnStore({
    limits: { MEMBER_TIMEOUT_MS: 50, MAX_LATE_TURNS: 1 },
    now: () => clock.t,
  });
  setRoomTurnStore(store);
  const wakes = [];
  const unsubscribe = subscribeWake((hint) => wakes.push(hint));
  try {
    const alpha = createAgent({
      name: "room-event-alpha",
      workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-room-t9-a-")),
    });
    const beta = createAgent({
      name: "room-event-beta",
      workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-room-t9-b-")),
    });
    const channel = createChannel({ name: "room-t9" });
    joinChannel(channel.id, alpha.id);
    joinChannel(channel.id, beta.id);

    // 人类消息 → 开场次（第一波 = 被点名的 alpha）
    const anchor = sendMessage({
      targetId: channel.id,
      authorId: OWNER_MEMBER_ID,
      content: `@${alpha.name} please build the export`,
    });
    assert.equal(anchor.held, false);

    // alpha 超时被释放为迟到 ⇒ 场次收口
    clock.t += 50;
    store.pump(channel.id);
    // alpha 迟到回答并 @beta ⇒ 补充波：lateTurns = 1，场次重新活跃
    store.noteReply({
      channelId: channel.id,
      memberId: alpha.id,
      seq: 900,
      text: `@${beta.name} 我回来了`,
    });
    const before = store.snapshot(channel.id);
    assert.equal(before.lateTurns, 1, "补充波把迟到预算用掉了");
    assert.equal(before.turn.endedReason, null, "补充波让场次重新活跃");
    const epochBefore = before.epoch;
    const askLogBefore = before.turn.askLog.length;
    const turnEpochBefore = before.turn.epoch;
    wakes.length = 0;

    // 场次活跃期间：系统事件消息（Owner 署名 + wake:true）落到同一频道
    const task = createTask({ messageId: anchor.message.id });
    assert.equal(task.number, 1);
    assert.ok(
      listMessages(channel.id).messages.some((message) => /^Task #1 created/.test(message.content)),
      "事件消息照常落库",
    );

    const after = store.snapshot(channel.id);
    // 禁止项 #5（I8 的另一半）：没有用户新消息 ⇒ epoch / lateTurns / 场次都不许动
    assert.equal(after.epoch, epochBefore, "事件消息不得推进 epoch");
    assert.equal(after.lateTurns, 1, "事件消息不得重置 lateTurns");
    assert.equal(after.turn.epoch, turnEpochBefore, "事件消息不得开启新房次");
    assert.equal(after.turn.stale, false, "原场次不得被 supersede");
    assert.equal(after.turn.endedReason, null, "原场次仍在跑");
    assert.equal(after.turn.askLog.length, askLogBefore, "事件消息不得产生新的当选者");
    // T2/#240：任务创建事件只定向唤醒秘书；本 fixture 没有秘书 ⇒ 不扇出、不退回全体。
    assert.deepEqual(
      wakes.filter((hint) => hint.targetId === channel.id),
      [],
      "无秘书时任务创建事件不得广播",
    );
  } finally {
    unsubscribe();
    setRoomTurnStore(null);
  }
});
