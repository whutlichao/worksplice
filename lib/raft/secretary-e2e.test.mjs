import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/sqlite.ts";
import { BUILTIN_CHANNEL_ID, OWNER_MEMBER_ID } from "../data/schema.ts";

/**
 * 秘书端到端联动验收（spec-bootstrap-agent.md §9.2，构建 effort ticket 08）：
 * 一条测试文件跑通五条验收点的全链路形态（§8.1-3 欢迎唤醒验收的端到端形态）——
 * 启动自动创建 → 事件系统消息（Owner 署名 + wake:false + 定向唤醒）→ driver 驱动 →
 * Susan 正常回复 ≤2 句落库；其他 agent 不被惊动；Susan 自动加入全部频道为静默路径；
 * 欢迎事件不含"欢迎 Susan 自己"；模型未配置降级；启动助手按钮重建路径。
 * fake LoopRuntime 注入（与 driver.test.mjs 同款接缝），不启动真实会话。
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-secretary-e2e-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  stopAgentLoopDriver();
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { autoCreateSecretary } = await import("./secretary-auto-create.ts");
const { initSecretaryFlow, OFFICE_CHANNEL_NAME } = await import("./secretary-init.ts");
const { SECRETARY_WELCOME_CONTENT, SUSAN_MEMBER_NAME } = await import("./event-messages.ts");
const { createChannel, joinChannel, listChannels, isChannelMember } = await import("./channels.ts");
const { createAgent, deleteAgent } = await import("./members.ts");
const { listMessages } = await import("./messages.ts");
const { subscribeWake } = await import("./wake.ts");
const { startAgentLoopDriver, stopAgentLoopDriver } = await import("../agent-loop/loop.ts");
const { hasLiveSusan, resolveBootstrapModel } = await import("../secretary-bootstrap.ts");

const wakes = [];
const unsubscribe = subscribeWake((hint) => wakes.push(hint));
test.after(() => unsubscribe());

const configured = () => ({ provider: "test-provider", modelId: "test-model" });
const noModel = () => null;

function liveSusan() {
  return globalThis.__workspliceDb
    .listMembers()
    .find((m) => m.name === SUSAN_MEMBER_NAME && m.type === "agent");
}

function offices() {
  return listChannels().filter((c) => c.name === OFFICE_CHANNEL_NAME);
}

function lastMessage(targetId) {
  const page = listMessages(targetId);
  return page.messages[page.messages.length - 1];
}

function messagesOf(targetId) {
  return listMessages(targetId).messages;
}

/** 句子计数（≤2 句验收）：按中英文句末标点切分，无标点按 1 句计。 */
function sentenceCount(text) {
  const matches = text.match(/[。！？.!?]+/g);
  return matches ? matches.length : 1;
}

// ---------------------------------------------------------------------------
// fake LoopRuntime（driver.test.mjs 同款）：会话回复可脚本化，用于"Susan 正常回复"
// ---------------------------------------------------------------------------

function makeFakeSession(replies = []) {
  const listeners = [];
  let running = false;
  return {
    replies,
    lastText: "",
    prompts: [],
    isRunning: () => running,
    onEvent: (l) => {
      listeners.push(l);
      return () => {
        const i = listeners.indexOf(l);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    emit: (event) => {
      for (const l of [...listeners]) l(event);
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
          this.emit({ type: "agent_settled" });
        });
        return null;
      }
      if (command.type === "get_last_assistant_text") return { text: this.lastText };
      return null;
    },
  };
}

function makeFakeRuntime(repliesByAgent = {}) {
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

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("§9.2-4 模型未配置 → 跳过 + 服务端日志，启动不报错；UI 入口判定", () => {
  // 本用例跑在文件最前（DB 尚无 Susan）：noModel 解析器 → 跳过自动创建 + 服务端日志
  const logs = [];
  const original = console.warn;
  console.warn = (msg) => logs.push(String(msg));
  try {
    const outcome = autoCreateSecretary({ resolveDefaultModel: noModel });
    assert.deepEqual(outcome, { created: false, reason: "no-default-model" });
  } finally {
    console.warn = original;
  }
  assert.equal(liveSusan(), undefined, "no member created without a default model");
  assert.equal(logs.length, 1);
  assert.match(logs[0], /secretary auto-create skipped/);

  // UI 入口判定（06/07 纯判定 seam 复用）：无存活 Susan → hasLiveSusan false；
  // 完全无可用模型 → resolveBootstrapModel null → 引导打开模型配置
  assert.equal(hasLiveSusan(globalThis.__workspliceDb.listMembers()), false);
  assert.equal(resolveBootstrapModel({ defaultModel: null, modelList: [] }), null);
});


test("§9.2-1 首次启动自动创建 Susan；重复启动不重建；删除后不重建、按钮可重建", () => {
  // 前置：两个既有频道（公开 + 私有）+ 一个既有 agent（Susan 不存在时均静默）
  createChannel({ name: "pre-public" });
  createChannel({ name: "pre-private", type: "private" });
  createAgent({ name: "zoe" });
  wakes.length = 0;

  // 首次启动 → 自动创建（走 initSecretaryFlow 完整五步）
  const outcome = autoCreateSecretary({ resolveDefaultModel: configured });
  assert.deepEqual(outcome, { created: true });
  const susan = liveSusan();
  assert.ok(susan, "Susan created on first startup");

  // 静默路径：加入既有频道不产生任何事件消息（§9.2-3）
  assert.equal(messagesOf("#all").length, 0, "no event for Susan's silent join of #all");
  assert.equal(messagesOf("pre-public").length, 0);
  assert.equal(messagesOf("pre-private").length, 0);

  // 办公室频道 + 欢迎事件（Owner 署名）
  assert.equal(offices().length, 1);
  const welcome = lastMessage(offices()[0].id);
  assert.equal(welcome.author_id, OWNER_MEMBER_ID);
  assert.equal(welcome.content, SECRETARY_WELCOME_CONTENT);
  // 欢迎事件只定向唤醒 Susan（不含"欢迎 Susan 自己"）
  assert.deepEqual(wakes, [
    { agentId: susan.id, targetId: offices()[0].id, seq: welcome.seq, reason: "message" },
  ]);

  // 重复启动 → 不重建
  const firstId = susan.id;
  const before = messagesOf(offices()[0].id).length;
  wakes.length = 0;
  assert.deepEqual(autoCreateSecretary({ resolveDefaultModel: configured }), {
    created: false,
    reason: "exists",
  });
  assert.equal(liveSusan().id, firstId);
  assert.equal(messagesOf(offices()[0].id).length, before, "no duplicate welcome");
  assert.deepEqual(wakes, []);

  // 删除后 → 自动创建不重建（软删行算"已存在"）
  deleteAgent(firstId);
  wakes.length = 0;
  assert.deepEqual(autoCreateSecretary({ resolveDefaultModel: configured }), {
    created: false,
    reason: "exists",
  });
  assert.equal(liveSusan(), undefined, "soft-deleted Susan not recreated automatically");
  assert.deepEqual(wakes, []);

  // 启动助手按钮路径 → initSecretaryFlow 重建全新秘书
  const rebuilt = initSecretaryFlow({ provider: "test-provider", modelId: "test-model" });
  assert.notEqual(rebuilt.id, firstId, "new identity after rebuild");
  assert.equal(offices().length, 1, "office channel reused, not duplicated");
  assert.equal(messagesOf(offices()[0].id).length, before + 1, "fresh welcome posted");
  const newWelcome = lastMessage(offices()[0].id);
  assert.equal(newWelcome.author_id, OWNER_MEMBER_ID);
  assert.equal(newWelcome.content, SECRETARY_WELCOME_CONTENT);
  assert.deepEqual(wakes, [
    { agentId: rebuilt.id, targetId: offices()[0].id, seq: newWelcome.seq, reason: "message" },
  ]);
});

test("§9.2-3 欢迎事件不含欢迎 Susan 自己；Susan 加入频道一律静默", () => {
  // 上个用例已重建 Susan；办公室欢迎事件正文不含"欢迎 @Susan 加入频道"形态
  const susan = liveSusan();
  assert.ok(susan);
  for (const channel of listChannels()) {
    for (const message of messagesOf(channel.id)) {
      assert.ok(
        !message.content.includes(`新成员 @${SUSAN_MEMBER_NAME} 加入频道`),
        `channel ${channel.name} must not welcome Susan herself: ${message.content}`,
      );
    }
  }

  // Susan 手动加入新频道（Owner 加入）→ 静默：无事件消息、无 wake
  const channel = createChannel({ name: "susan-silent" }); // 创建事件消息（报到）
  const before = messagesOf(channel.id).length;
  wakes.length = 0;
  joinChannel(channel.id, susan.id, OWNER_MEMBER_ID);
  assert.equal(messagesOf(channel.id).length, before);
  assert.deepEqual(wakes, []);

  // §8.1 排除规则：加入者 = Owner 同样不投事件消息（"欢迎 Owner"不存在）
  const ownerJoin = createChannel({ name: "owner-silent" });
  const ownerBefore = messagesOf(ownerJoin.id).length;
  wakes.length = 0;
  joinChannel(ownerJoin.id, OWNER_MEMBER_ID, OWNER_MEMBER_ID);
  assert.equal(messagesOf(ownerJoin.id).length, ownerBefore);
  assert.deepEqual(wakes, []);
});

// ---------------------------------------------------------------------------
// §9.2-2 欢迎唤醒验收的端到端形态（§8.1-3）：事件消息 → 唤醒 → driver → 回复 ≤2 句
// ---------------------------------------------------------------------------

test("§9.2-2 新 agent 加入频道 → Susan 被唤醒并正常回复（≤2 句）；其他 agent 不被惊动", async () => {
  // Susan 重建（上个用例删除了她）+ 一个旁观 agent alice
  const susan = initSecretaryFlow({ provider: "test-provider", modelId: "test-model" });
  const alice = createAgent({ name: "alice" });
  const channel = createChannel({ name: "join-event" });
  assert.equal(isChannelMember(channel.id, susan.id), true, "Susan auto-joined public channel");

  // fake runtime：Susan 回复欢迎（≤2 句——脚本化输入，≤2 句约束的 enforcement 点在 MEMORY.md
  // 内容契约（memory-quickref.test.mjs 断言速查含"一次发言 ≤2 句"规则），本 E2E 验证链路把该
  // 形态的回复落库）；alice 不预置会话——被误唤醒时会 startSession 记 prompts
  const runtime = makeFakeRuntime({
    [susan.id]: [
      { text: '{"action":"reply","content":"欢迎 @alice 加入频道！有需要随时叫我。","onConflict":"revise"}' },
    ],
  });
  const stop = startAgentLoopDriver({ runtime });
  try {
    wakes.length = 0;
    // 事件消息以 Owner 署名投递（§4.2 节点 1）+ 只唤醒 Susan
    joinChannel(channel.id, alice.id, alice.id);
    const eventMsg = lastMessage(channel.id);
    assert.equal(eventMsg.author_id, OWNER_MEMBER_ID);
    assert.equal(eventMsg.content, "@Susan 新成员 @alice 加入频道");
    assert.deepEqual(wakes, [
      { agentId: susan.id, targetId: channel.id, seq: eventMsg.seq, reason: "message" },
    ], "event wake must target ONLY Susan");

    // driver 驱动：Susan 的回复 ≤2 句落库
    await waitFor(() => runtime.sessions.get(susan.id)?.prompts.length === 1);
    const reply = lastMessage(channel.id);
    assert.equal(reply.author_id, susan.id);
    assert.equal(reply.content, "欢迎 @alice 加入频道！有需要随时叫我。");
    assert.ok(sentenceCount(reply.content) <= 2, "reply must be ≤2 sentences");
    assert.ok(
      runtime.sessions.get(susan.id).prompts[0].includes("#" + eventMsg.seq),
      "prompt carries the event message context",
    );
    // 其他 agent 不被事件惊动：alice 不因事件消息获得 wake（Susan 的回复是普通消息，
    // 唤醒 channel 成员属 §3.2 正常语义；事件本身 wake:false 只定向唤醒 Susan）
    await new Promise((resolve) => setTimeout(resolve, 20));
    const aliceEventWake = wakes.find(
      (w) => w.agentId === alice.id && w.seq === eventMsg.seq,
    );
    assert.equal(aliceEventWake, undefined, "alice must not be woken by the event message");
    assert.ok(
      messagesOf(channel.id).every((m) => m.author_id !== alice.id),
      "alice must never post a reply to the event",
    );
  } finally {
    stop();
  }
});

test("§9.2-2 新频道建立 → 事件消息 + Susan 报到回复（≤2 句）；其他 agent 不被惊动", async () => {
  const susan = liveSusan();
  assert.ok(susan, "Susan alive from previous case");
  const alice = createAgent({ name: "alice2" });
  const runtime = makeFakeRuntime({
    [susan.id]: [
      { text: '{"action":"reply","content":"新频道 #launch 已建立，有需要随时叫我。","onConflict":"revise"}' },
    ],
  });
  const stop = startAgentLoopDriver({ runtime });
  try {
    wakes.length = 0;
    createChannel({ name: "launch" });
    const channel = listChannels().find((c) => c.name === "launch");
    assert.equal(isChannelMember(channel.id, susan.id), true, "Susan auto-joined new public channel");
    const eventMsg = lastMessage(channel.id);
    assert.equal(eventMsg.author_id, OWNER_MEMBER_ID);
    assert.equal(eventMsg.content, "@Susan 新频道 #launch 已建立");
    assert.deepEqual(wakes, [
      { agentId: susan.id, targetId: channel.id, seq: eventMsg.seq, reason: "message" },
    ], "channel-created wake must target ONLY Susan");

    await waitFor(() => runtime.sessions.get(susan.id)?.prompts.length === 1);
    const reply = lastMessage(channel.id);
    assert.equal(reply.author_id, susan.id);
    assert.equal(reply.content, "新频道 #launch 已建立，有需要随时叫我。");
    assert.ok(sentenceCount(reply.content) <= 2, "reply must be ≤2 sentences");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const aliceEventWake = wakes.find(
      (w) => w.agentId === alice.id && w.seq === eventMsg.seq,
    );
    assert.equal(aliceEventWake, undefined, "alice must not be woken by the event message");
    assert.ok(
      messagesOf(channel.id).every((m) => m.author_id !== alice.id),
      "alice must never post a reply to the event",
    );
  } finally {
    stop();
  }
});

test("§9.2-2 私有频道（未勾选 Susan）→ 事件消息投 #all 穿透送达，Susan 仍被唤醒", async () => {
  const susan = liveSusan();
  assert.ok(susan);
  const runtime = makeFakeRuntime({
    [susan.id]: [
      { text: '{"action":"reply","content":"已了解。","onConflict":"revise"}' },
    ],
  });
  const stop = startAgentLoopDriver({ runtime });
  try {
    wakes.length = 0;
    createChannel({ name: "top-secret", type: "private" });
    assert.equal(isChannelMember("top-secret", susan.id), false, "Susan not in the private channel");
    const allMsg = lastMessage(BUILTIN_CHANNEL_ID);
    assert.equal(allMsg.content, "@Susan 新频道 #top-secret 已建立");
    assert.deepEqual(wakes, [
      { agentId: susan.id, targetId: BUILTIN_CHANNEL_ID, seq: allMsg.seq, reason: "message" },
    ], "private-channel event delivered via #all, waking ONLY Susan");
  } finally {
    stop();
  }
});
