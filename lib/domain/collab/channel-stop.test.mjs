import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../../data/sqlite.ts";
import { BUILTIN_CHANNEL_ID, OWNER_MEMBER_ID } from "../../data/schema.ts";

/**
 * Stop（票 #238）服务层验收：
 * - 仅 Owner、仅非 DM、频道必须存在；
 * - 重复 Stop / 无活跃场次幂等，不重复加 epoch；
 * - Stop 后 turn stopped/stale、lateTurns 哨兵、不会因迟到回复开新波；
 * - 只动房间内存状态，不写消费游标、不 ack 任务事件、不碰 AgentSession。
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-channel-stop-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const {
  ChannelStopError,
  createAgent,
  createChannel,
  createDirectChannel,
  createRoomTurnStore,
  createTask,
  drain,
  getRoomTurnStore,
  joinChannel,
  leaveChannel,
  listMessages,
  sendMessage,
  setRoomTurnStore,
  stopChannelTurn,
} = await import("./index.ts");

let fixtureSeq = 0;
function makeChannel() {
  fixtureSeq += 1;
  const agent = createAgent({ name: `stop-agent-${fixtureSeq}` });
  const channel = createChannel({ name: `stop-room-${fixtureSeq}` });
  joinChannel(channel.id, agent.id);
  return { agent, channel };
}

function beginRoom(agent, channel) {
  const sent = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: `@${agent.name} please take a look`,
  });
  assert.equal(sent.held, false);
  return getRoomTurnStore().snapshot(channel.id);
}

test("stopChannelTurn stops the current turn and repeated Stop is a no-op", () => {
  setRoomTurnStore(createRoomTurnStore());
  try {
    const { agent, channel } = makeChannel();
    const before = beginRoom(agent, channel);
    assert.equal(before.turn.endedReason, null);
    const epochBefore = before.epoch;

    const result = stopChannelTurn(channel.id, OWNER_MEMBER_ID);
    assert.equal(result.stopped, true);
    assert.equal(result.epoch, epochBefore + 1);

    const stopped = getRoomTurnStore().snapshot(channel.id);
    assert.equal(stopped.epoch, epochBefore + 1);
    assert.equal(stopped.turn.endedReason, "stopped");
    assert.equal(stopped.turn.stale, true);
    assert.equal(
      stopped.lateTurns,
      getRoomTurnStore().limits.MAX_LATE_TURNS,
      "lateTurns 置哨兵",
    );

    const again = stopChannelTurn(channel.id, OWNER_MEMBER_ID);
    assert.equal(again.stopped, false);
    assert.equal(again.epoch, stopped.epoch, "重复 Stop 不重复加 epoch");
    assert.equal(getRoomTurnStore().snapshot(channel.id).epoch, stopped.epoch);
  } finally {
    setRoomTurnStore(null);
  }
});

test("stopChannelTurn rejects missing / DM / non-owner with stable 4xx and leaves the room untouched", () => {
  setRoomTurnStore(createRoomTurnStore());
  try {
    assert.throws(
      () => stopChannelTurn("no-such-channel", OWNER_MEMBER_ID),
      (error) => {
        assert.ok(error instanceof ChannelStopError);
        assert.equal(error.status, 404);
        assert.equal(error.code, "channel_not_found");
        return true;
      },
    );

    const dmAgent = createAgent({ name: "stop-dm-agent" });
    const dm = createDirectChannel(dmAgent.id);
    assert.throws(
      () => stopChannelTurn(dm.id, OWNER_MEMBER_ID),
      (error) => {
        assert.ok(error instanceof ChannelStopError);
        assert.equal(error.status, 403);
        assert.equal(error.code, "dm_not_stoppable");
        return true;
      },
    );

    const { agent, channel } = makeChannel();
    const before = beginRoom(agent, channel);
    assert.throws(
      () => stopChannelTurn(channel.id, agent.id),
      (error) => {
        assert.ok(error instanceof ChannelStopError);
        assert.equal(error.status, 403);
        assert.equal(error.code, "owner_only");
        return true;
      },
    );
    const after = getRoomTurnStore().snapshot(channel.id);
    assert.equal(after.epoch, before.epoch, "非 Owner 不推进 epoch");
    assert.equal(after.turn.endedReason, null, "非 Owner 不停止场次");
  } finally {
    setRoomTurnStore(null);
  }
});

test("stopChannelTurn on a channel without an active turn is a no-op (no room / no epoch)", () => {
  setRoomTurnStore(createRoomTurnStore());
  try {
    const { channel } = makeChannel();
    const first = stopChannelTurn(channel.id, OWNER_MEMBER_ID);
    const second = stopChannelTurn(channel.id, OWNER_MEMBER_ID);
    assert.deepEqual(first, { stopped: false, epoch: 0 });
    assert.deepEqual(second, { stopped: false, epoch: 0 });
    assert.equal(
      getRoomTurnStore().snapshot(channel.id),
      null,
      "无活跃场次的 Stop 不创建房间状态",
    );
  } finally {
    setRoomTurnStore(null);
  }
});

test("Stop 不写游标 / 不吞任务事件；迟到回复落库但 stale 且不开新波；人类新消息开新场次", () => {
  setRoomTurnStore(createRoomTurnStore());
  const db = globalThis.__workspliceDb;
  try {
    const { agent, channel } = makeChannel();
    const peer = createAgent({ name: "stop-peer" });
    joinChannel(channel.id, peer.id);

    const anchor = sendMessage({
      targetId: channel.id,
      authorId: OWNER_MEMBER_ID,
      content: `@${agent.name} please build the export`,
    });
    assert.equal(anchor.held, false);
    const task = createTask({ messageId: anchor.message.id });
    assert.equal(task.number, 1);

    const before = getRoomTurnStore().snapshot(channel.id);
    const cursorBefore = db.getConsumedSeq(agent.id, channel.id);
    const messageCountBefore = listMessages(channel.id).messages.length;
    const askLogBefore = before.turn.askLog.length;

    stopChannelTurn(channel.id, OWNER_MEMBER_ID);

    assert.equal(
      db.getConsumedSeq(agent.id, channel.id),
      cursorBefore,
      "Stop 不得推进任何消费游标",
    );
    const pending = drain(agent.id, channel.id);
    assert.ok(
      pending.messages.some((message) => /^Task #1 created/.test(message.content)),
      "待处理任务事件仍 pending（Stop 不 ack）",
    );

    // 在飞回复（携带旧 epoch）与无 epoch 的迟到回复都允许落库，但都不计预算、不开新波
    for (const [content, roomContext] of [
      [`@${peer.name} late reply from the stopped wave`, { channelId: channel.id, epoch: before.epoch }],
      [`@${peer.name} another late reply`, undefined],
    ]) {
      const late = sendMessage({
        targetId: channel.id,
        authorId: agent.id,
        content,
        roomContext,
      });
      assert.equal(late.held, false);
    }

    const afterLate = getRoomTurnStore().snapshot(channel.id);
    assert.equal(afterLate.turn.endedReason, "stopped");
    assert.equal(afterLate.turn.stale, true);
    assert.equal(afterLate.turn.askLog.length, askLogBefore, "Stop 之后零补充波");
    assert.equal(afterLate.turn.elected.has(peer.id), false, "迟到回复不得把 peer 拉进新波");
    assert.equal(
      listMessages(channel.id).messages.length,
      messageCountBefore + 2,
      "迟到回复照常可见",
    );

    sendMessage({
      targetId: channel.id,
      authorId: OWNER_MEMBER_ID,
      content: `new wave: @${agent.name} take another look`,
    });
    const next = getRoomTurnStore().snapshot(channel.id);
    assert.equal(next.lateTurns, 0, "人类新消息重置 lateTurns");
    assert.equal(next.turn.endedReason, null, "人类新消息开启新场次");
    assert.ok(next.turn.elected.has(agent.id), "新场次重新选人");
  } finally {
    setRoomTurnStore(null);
  }
});

test("成员主动离开后从当前场次 elected/asked 清槽，已落库消息与消费游标不动", () => {
  setRoomTurnStore(createRoomTurnStore());
  const db = globalThis.__workspliceDb;
  try {
    const { agent, channel } = makeChannel();
    const peer = createAgent({ name: "leave-peer" });
    joinChannel(channel.id, peer.id);
    const anchor = sendMessage({
      targetId: channel.id,
      authorId: OWNER_MEMBER_ID,
      content: `@${agent.name} @${peer.name} both of you`,
    });
    assert.equal(anchor.held, false);
    const before = getRoomTurnStore().snapshot(channel.id);
    assert.ok(before.turn.elected.has(agent.id));
    assert.ok(before.turn.elected.has(peer.id));
    const cursorBefore = db.getConsumedSeq(agent.id, channel.id);
    const messagesBefore = listMessages(channel.id).messages.length;
    const askLogBefore = before.turn.askLog.length;

    leaveChannel(channel.id, agent.id, agent.id);

    const after = getRoomTurnStore().snapshot(channel.id);
    assert.equal(after.turn.elected.has(agent.id), false, "离开后不再占用 elected");
    assert.equal(after.turn.settled.has(agent.id), false, "离开后不再占用 settled");
    assert.equal(after.turn.asked.has(agent.id), false, "离开后不再被视为本场次被问过");
    assert.ok(after.turn.elected.has(peer.id), "其他当选成员不受影响");
    assert.equal(
      getRoomTurnStore().gate({ channelId: channel.id, memberId: agent.id }).state,
      "not-elected",
      "旧 wake hint 不得把已离开成员拉回本轮",
    );
    assert.equal(db.isChannelMember(channel.id, agent.id), false);
    assert.equal(
      db.getConsumedSeq(agent.id, channel.id),
      cursorBefore,
      "清槽不写消费游标",
    );
    assert.equal(
      listMessages(channel.id).messages.length,
      messagesBefore,
      "既有消息保留",
    );
    assert.equal(after.turn.askLog.length, askLogBefore, "清槽不重新选人");

    assert.throws(
      () =>
        sendMessage({
          targetId: channel.id,
          authorId: agent.id,
          content: `@${peer.name} late reply after leaving`,
        }),
      /not a member of this channel/,
      "离开后的在飞回复被成员校验拒收，不会开启新波",
    );
    assert.equal(
      getRoomTurnStore().snapshot(channel.id).turn.askLog.length,
      askLogBefore,
    );
  } finally {
    setRoomTurnStore(null);
  }
});

test("Owner 移出成员与主动离开同一清槽；late 槽被移除，且不等待超时", () => {
  setRoomTurnStore(createRoomTurnStore());
  try {
    const { agent, channel } = makeChannel();
    const anchor = sendMessage({
      targetId: channel.id,
      authorId: OWNER_MEMBER_ID,
      content: `@${agent.name} take this`,
    });
    assert.equal(anchor.held, false);
    getRoomTurnStore().noteBusy({ channelId: channel.id, memberId: agent.id });
    const busy = getRoomTurnStore().snapshot(channel.id);
    assert.ok(busy.turn.late.has(agent.id), "忙绿/超时成员先进入 late");

    leaveChannel(channel.id, agent.id, OWNER_MEMBER_ID);

    const after = getRoomTurnStore().snapshot(channel.id);
    assert.equal(after.turn.late.has(agent.id), false, "被移出后 late 槽被清除");
    assert.equal(after.turn.elected.has(agent.id), false);
  } finally {
    setRoomTurnStore(null);
  }
});

test("#all 不能离开的既有规则不变（也不清 #all 房间槽位）", () => {
  setRoomTurnStore(createRoomTurnStore());
  try {
    const { agent } = makeChannel();
    assert.throws(
      () => leaveChannel(BUILTIN_CHANNEL_ID, agent.id, OWNER_MEMBER_ID),
      /#all/,
    );
    assert.equal(globalThis.__workspliceDb.isChannelMember(BUILTIN_CHANNEL_ID, agent.id), true);
  } finally {
    setRoomTurnStore(null);
  }
});
