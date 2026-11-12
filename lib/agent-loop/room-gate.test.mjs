import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/sqlite.ts";

/**
 * 选人门的 black-box 回归（Ticket room-turn-budget，设计记录
 * `.scratch/room-turn-budget/spec.md` §6.3 / 必改 2）。
 *
 * 目的只有一件：把「门真的接在 `runAgentRound` 上」变成可机械判定的——把
 * `runAgentRound` 里 CP0 的那段 `return` 整块删掉，本文件必须变红。
 * 因此这里只走公共面：协作域的唯一漏斗 `sendMessage` + `runAgentRound` + 消费游标，
 * fake runtime 注入，不真起会话、不接模型、无网络。
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-room-gate-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const {
  createAgent,
  createChannel,
  createRoomTurnStore,
  joinChannel,
  sendMessage,
  setRoomTurnStore,
} = await import("../domain/collab/index.ts");
const { runAgentRound } = await import("./loop.ts");
const { OWNER_MEMBER_ID } = await import("../data/schema.ts");

const NOT_ELECTED = "not elected by room turn";

/** fake 会话：`send({type:"prompt"})` 之后按脚本吐出下一条回复（与 loop.test.mjs 同形）。 */
function makeFakeSession(replies = []) {
  const listeners = [];
  let running = false;
  return {
    replies,
    lastText: "",
    prompts: [],
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
        const reply = this.replies.shift();
        running = true;
        this.emit({ type: "agent_start" });
        queueMicrotask(() => {
          running = false;
          this.lastText = reply?.text ?? "";
          this.emit({ type: "prompt_done" });
          this.emit({ type: "agent_end" });
        });
        return null;
      }
      if (command.type === "get_last_assistant_text") return { text: this.lastText };
      if (command.type === "get_last_assistant_error") {
        return { stopReason: null, errorMessage: null };
      }
      return null;
    },
  };
}

function makeFakeRuntime({ repliesByAgent = {} } = {}) {
  const sessions = new Map();
  return {
    sessions,
    findSession: (member) => sessions.get(member.id),
    async startSession(member) {
      if (!member.workspace_path) throw new Error("Agent has no workspace bound");
      const session = makeFakeSession(repliesByAgent[member.id] ?? []);
      sessions.set(member.id, session);
      return { sessionId: member.id, sessionFile: `/sessions/${member.id}.jsonl` };
    },
  };
}

function makeAgent(name) {
  return createAgent({
    name,
    workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), `worksplice-room-gate-${name}-`)),
  });
}

function replyText(content) {
  return JSON.stringify({ action: "reply", content });
}

function sendAsOwner(targetId, content) {
  const result = sendMessage({ targetId, authorId: OWNER_MEMBER_ID, content });
  assert.equal(result.held, false);
  return result.message;
}

test("① 场次活跃且该成员未当选 ⇒ runAgentRound 跳过、消费游标不动", async () => {
  const store = createRoomTurnStore();
  setRoomTurnStore(store);
  // 数据层直连（不进协作域索引面）：走本文件的临时库，绝不落默认数据目录
  const db = globalThis.__workspliceDb;
  try {
    const alpha = makeAgent("gate-alpha-1");
    const beta = makeAgent("gate-beta-1");
    const channel = createChannel({ name: "room-gate-1" });
    joinChannel(channel.id, alpha.id);
    joinChannel(channel.id, beta.id);

    // 人类消息只点名 alpha ⇒ 第一波 = {alpha}；beta 是成员、有待消费消息，但没被问
    sendAsOwner(channel.id, `@${alpha.name} 你来说说`);
    const cursorBefore = db.getConsumedSeq(beta.id, channel.id);

    const runtime = makeFakeRuntime({ repliesByAgent: { [beta.id]: [{ text: replyText("不该我说") }] } });
    const outcome = await runAgentRound(beta.id, channel.id, runtime);

    assert.equal(outcome.status, "skipped");
    assert.equal(outcome.reason, NOT_ELECTED);
    // 不推进消费游标：被后来召见时上下文完整
    assert.equal(db.getConsumedSeq(beta.id, channel.id), cursorBefore);
    // 而且真的没起会话、没花模型调用
    assert.equal(runtime.sessions.has(beta.id), false);
  } finally {
    setRoomTurnStore(null);
  }
});

test("② 同一场次的当选成员不被该门拦下（继续走到回复）", async () => {
  const store = createRoomTurnStore();
  setRoomTurnStore(store);
  const db = globalThis.__workspliceDb;
  try {
    const alpha = makeAgent("gate-alpha-2");
    const beta = makeAgent("gate-beta-2");
    const channel = createChannel({ name: "room-gate-2" });
    joinChannel(channel.id, alpha.id);
    joinChannel(channel.id, beta.id);
    sendAsOwner(channel.id, `@${alpha.name} 你来说说`);

    const runtime = makeFakeRuntime({
      repliesByAgent: { [alpha.id]: [{ text: replyText("当选成员的正常回复") }] },
    });
    const outcome = await runAgentRound(alpha.id, channel.id, runtime);

    assert.notEqual(outcome.reason, NOT_ELECTED);
    assert.equal(outcome.status, "replied");
    assert.match(outcome.message.content, /当选成员的正常回复/);
    assert.ok(db.getConsumedSeq(alpha.id, channel.id) > 0);
  } finally {
    setRoomTurnStore(null);
  }
});

test("③ 无活跃场次时同一成员不被门拦（legacy 行为不变）", async () => {
  const store = createRoomTurnStore();
  setRoomTurnStore(store);
  try {
    const alpha = makeAgent("gate-alpha-3");
    const beta = makeAgent("gate-beta-3");
    const channel = createChannel({ name: "room-gate-3" });
    joinChannel(channel.id, alpha.id);
    joinChannel(channel.id, beta.id);

    // 只有 agent 消息（不开启场次），beta 有待消费的非噪声消息（点名不是噪声）
    const seeded = sendMessage({
      targetId: channel.id,
      authorId: alpha.id,
      content: `@${beta.name} 看一下这个改动会怎样`,
    });
    assert.equal(seeded.held, false);
    assert.equal(store.snapshot(channel.id)?.turn ?? null, null, "agent 消息不开场次");

    const runtime = makeFakeRuntime({ repliesByAgent: { [beta.id]: [{ text: replyText("在") }] } });
    const outcome = await runAgentRound(beta.id, channel.id, runtime);

    assert.notEqual(outcome.reason, NOT_ELECTED);
    assert.equal(outcome.status, "replied");
  } finally {
    setRoomTurnStore(null);
  }
});
