import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/sqlite.ts";

/**
 * 票 #238 的驱动层证据（fake runtime，无网络、无真实模型）：
 * - Owner Stop 后，在飞回复仍可落库但 stale，且不销毁 / 替换同一个 fake session；
 * - 成员离开后，旧 wake hint 被选人门拒绝，直接迟到回复也不开新波。
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-room-stop-leave-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  setAgentStatusLookup(null);
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const {
  createAgent,
  createChannel,
  createRoomTurnStore,
  getRoomTurnStore,
  joinChannel,
  leaveChannel,
  sendMessage,
  setRoomTurnStore,
  stopChannelTurn,
} = await import("../domain/collab/index.ts");
const { runAgentRound } = await import("./loop.ts");
const { setAgentStatusLookup } = await import("../agent-status.ts");
const { OWNER_MEMBER_ID } = await import("../data/schema.ts");

setAgentStatusLookup(() => null);

function makeAgent(name) {
  return createAgent({
    name,
    workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), `worksplice-stop-${name}-`)),
  });
}

function sendAsOwner(targetId, content) {
  const result = sendMessage({ targetId, authorId: OWNER_MEMBER_ID, content });
  assert.equal(result.held, false);
  return result.message;
}

function replyText(content) {
  return JSON.stringify({ action: "reply", content });
}

function makeGatedSession() {
  const listeners = [];
  let running = false;
  let lastText = "";
  let resolvePrompted;
  const prompted = new Promise((resolve) => {
    resolvePrompted = resolve;
  });
  return {
    prompts: [],
    prompted,
    isRunning: () => running,
    onEvent(listener) {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    emit(event) {
      for (const listener of [...listeners]) listener(event);
    },
    async send(command) {
      if (command.type === "prompt") {
        this.prompts.push(command.message);
        running = true;
        this.emit({ type: "agent_start" });
        resolvePrompted();
        return null;
      }
      if (command.type === "get_last_assistant_text") return { text: lastText };
      if (command.type === "get_last_assistant_error") {
        return { stopReason: null, errorMessage: null };
      }
      return null;
    },
    release(text) {
      lastText = text;
      running = false;
      this.emit({ type: "prompt_done" });
      this.emit({ type: "agent_end" });
    },
  };
}

function makeFakeRuntime(session = null) {
  return {
    sessions: new Map(),
    destroyCalls: 0,
    findSession: () => session ?? undefined,
    async startSession() {
      throw new Error("test should reuse the prestarted session");
    },
    async destroySession() {
      this.destroyCalls += 1;
    },
  };
}

test("Stop 后在飞回复落库但 stale；同一 fake session 不被销毁或替换；不开新波", async () => {
  setRoomTurnStore(createRoomTurnStore());
  try {
    const alpha = makeAgent("stop-loop-alpha");
    const peer = makeAgent("stop-loop-peer");
    const channel = createChannel({ name: "stop-loop-room" });
    joinChannel(channel.id, alpha.id);
    joinChannel(channel.id, peer.id);
    sendAsOwner(channel.id, `@${alpha.name} take a look`);

    const session = makeGatedSession();
    const runtime = makeFakeRuntime(session);
    runtime.sessions.set(alpha.id, session);
    const round = runAgentRound(alpha.id, channel.id, runtime);
    await session.prompted;

    const cursorBeforeStop = globalThis.__workspliceDb.getConsumedSeq(
      alpha.id,
      channel.id,
    );
    const store = getRoomTurnStore();
    const beforeStop = store.snapshot(channel.id);
    const stop = stopChannelTurn(channel.id, OWNER_MEMBER_ID);
    assert.equal(stop.stopped, true);
    assert.equal(
      globalThis.__workspliceDb.getConsumedSeq(alpha.id, channel.id),
      cursorBeforeStop,
      "Stop 本身不写消费游标",
    );

    session.release(replyText(`@${peer.name} 这条回复在 Stop 之后才落库`));
    const outcome = await round;
    assert.equal(outcome.status, "replied");
    assert.match(outcome.message.content, /Stop 之后才落库/);

    const snapshot = store.snapshot(channel.id);
    assert.equal(snapshot.turn.endedReason, "stopped");
    assert.equal(snapshot.turn.stale, true);
    assert.equal(
      snapshot.turn.askLog.length,
      beforeStop.turn.askLog.length,
      "在飞回复不得开启新波",
    );
    assert.equal(snapshot.turn.elected.has(peer.id), false);
    assert.equal(runtime.destroyCalls, 0, "Stop 不调用 destroySession");
    assert.equal(runtime.sessions.get(alpha.id), session, "同一个 fake session 仍存在");
  } finally {
    setRoomTurnStore(null);
  }
});

test("成员离开后旧 wake hint / 迟到回复都不再开启新波", async () => {
  setRoomTurnStore(createRoomTurnStore());
  try {
    const alpha = makeAgent("leave-loop-alpha");
    const beta = makeAgent("leave-loop-beta");
    const channel = createChannel({ name: "leave-loop-room" });
    joinChannel(channel.id, alpha.id);
    joinChannel(channel.id, beta.id);
    sendAsOwner(channel.id, `@${alpha.name} @${beta.name} both of you`);
    const store = getRoomTurnStore();
    const before = store.snapshot(channel.id);
    assert.ok(before.turn.elected.has(beta.id));

    leaveChannel(channel.id, beta.id, beta.id);

    const runtime = makeFakeRuntime();
    const outcome = await runAgentRound(beta.id, channel.id, runtime);
    assert.equal(outcome.status, "skipped");
    assert.equal(outcome.reason, "not elected by room turn");
    assert.equal(runtime.sessions.size, 0, "旧 wake hint 不得起会话");

    const askLogBefore = store.snapshot(channel.id).turn.askLog.length;
    store.noteReply({
      channelId: channel.id,
      memberId: beta.id,
      seq: 999,
      text: `@${alpha.name} 离开后的迟到回复`,
    });
    const after = store.snapshot(channel.id);
    assert.equal(after.turn.askLog.length, askLogBefore, "迟到回复不开补充波");
    assert.equal(after.turn.elected.has(beta.id), false);
  } finally {
    setRoomTurnStore(null);
  }
});
