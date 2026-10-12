import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/sqlite.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-loop-ops-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const { createAgent } = await import("../domain/collab/index.ts");
const { createChannel, joinChannel } = await import("../domain/collab/channels.ts");
const { sendMessage } = await import("../domain/collab/messages.ts");
const { runAgentRound } = await import("./loop.ts");
const { ROUND_INJECTION_BUDGET_CHARS } = await import("./injection-budget.ts");
const { setAgentStatusLookup } = await import("../agent-status.ts");
const { OWNER_MEMBER_ID } = await import("../data/schema.ts");
const { archiveAgentSessionFiles, searchArchivedSessionEntries } = await import(
  "../session-archive.ts"
);

setAgentStatusLookup(() => null);

let fixtureSeq = 0;
function uniqueName(prefix) {
  fixtureSeq += 1;
  return `${prefix}-${fixtureSeq}-${Math.random().toString(36).slice(2, 6)}`;
}

function makeFakeSession(replies = []) {
  const listeners = [];
  let running = false;
  return {
    replies,
    lastText: "",
    prompts: [],
    isRunning: () => running,
    onEvent: (listener) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    emit: (event) => {
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
          if (reply?.error) {
            this.emit({ type: "prompt_error", errorMessage: reply.error });
          } else {
            this.lastText = reply?.text ?? "";
            this.emit({ type: "prompt_done" });
          }
          this.emit({ type: "agent_end" });
        });
        return null;
      }
      if (command.type === "get_last_assistant_text") return { text: this.lastText };
      return null;
    },
  };
}

function setup({ reply, agentName = "ops-agent" } = {}) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-loop-ops-ws-"));
  const agent = createAgent({ name: uniqueName(agentName), workspacePath: ws });
  const channel = createChannel({ name: uniqueName("ops-room") });
  joinChannel(channel.id, agent.id);
  const resolved = typeof reply === "function" ? reply({ agent, channel }) : reply;
  const session = makeFakeSession(
    Array.isArray(resolved) ? resolved : [{ text: resolved ?? '{"action":"ignore"}' }],
  );
  const runtime = {
    findSession: () => session,
    async startSession() {
      throw new Error("session should be pre-started");
    },
  };
  return { agent, channel, session, runtime, ws };
}

function ownerMessage(targetId, content) {
  const result = sendMessage({ targetId, authorId: OWNER_MEMBER_ID, content });
  assert.equal(result.held, false);
  return result.message;
}

/** 合成 session JSONL（票 06 的归档缝，形态同 lib/session-archive.test.mjs）：头行 + 用户消息 + 可选 summary。 */
function syntheticSessionFile({ userText, summary } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-loop-ops-archive-src-"));
  const lines = [
    JSON.stringify({
      type: "session",
      version: 3,
      id: "synthetic-loop-ops",
      timestamp: "2026-10-12T00:00:00.000Z",
      cwd: dir,
    }),
    JSON.stringify({
      type: "message",
      id: "e1",
      parentId: null,
      timestamp: "2026-10-12T00:00:01.000Z",
      message: { role: "user", content: [{ type: "text", text: userText }] },
    }),
    ...(summary
      ? [
          JSON.stringify({
            type: "compaction",
            id: "e2",
            parentId: "e1",
            timestamp: "2026-10-12T00:00:02.000Z",
            summary,
            firstKeptEntryId: "e1",
            tokensBefore: 100,
          }),
        ]
      : []),
  ];
  const filePath = path.join(dir, "session.jsonl");
  fs.writeFileSync(filePath, lines.join("\n") + "\n");
  return filePath;
}

// ---------------------------------------------------------------------------
// 三条能力（spec §5.4 act 清单的实现缺口）：以成员 X 的名义落库
// ---------------------------------------------------------------------------

test("react op toggles a reaction under the member's own identity", async () => {
  const { agent, channel, runtime } = setup({
    reply: '{"action":"ignore","ops":[{"op":"react","seq":1,"emoji":"👍"}]}',
  });
  const message = ownerMessage(channel.id, "please acknowledge");
  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "ignored");

  const reactions = globalThis.__workspliceDb.listReactions(message.id);
  assert.equal(reactions.length, 1);
  assert.equal(reactions[0].member_id, agent.id, "reaction 必须以成员自己的身份落库");
  assert.equal(reactions[0].emoji, "👍");
});

test("pin op pins a message for the member, not for the Owner", async () => {
  const { agent, channel, runtime } = setup({
    reply: '{"action":"ignore","ops":[{"op":"pin","seq":1}]}',
  });
  const message = ownerMessage(channel.id, "pin me");
  await runAgentRound(agent.id, channel.id, runtime);

  assert.notEqual(globalThis.__workspliceDb.getPinnedMessage(channel.id, message.id, agent.id), undefined);
  assert.equal(
    globalThis.__workspliceDb.getPinnedMessage(channel.id, message.id, OWNER_MEMBER_ID),
    undefined,
    "不得以 Owner 的身份落 pin",
  );
});

test("remind op schedules a reminder authored by the member", async () => {
  const { agent, channel, runtime } = setup({
    reply: ({ channel: room }) =>
      `{"action":"ignore","ops":[{"op":"remind","title":"stand up","inMinutes":30,"targetId":"#${room.name}"}]}`,
  });
  ownerMessage(channel.id, "set a reminder");
  const before = Date.now();
  await runAgentRound(agent.id, channel.id, runtime);

  const reminders = globalThis.__workspliceDb.listRemindersByAuthor(agent.id);
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].title, "stand up");
  const fireAt = new Date(reminders[0].fire_at).getTime();
  assert.ok(
    fireAt >= before + 29 * 60_000 && fireAt <= Date.now() + 31 * 60_000,
    "inMinutes 应换算成绝对 fire_at",
  );
  assert.equal(reminders[0].status, "scheduled");
  assert.equal(reminders[0].target_id, channel.id, "target 名应变回 channel id");
});

test("remind op without a target anchors to the round target (so it actually fires and wakes the author)", async () => {
  const { agent, channel, runtime } = setup({
    reply: '{"action":"ignore","ops":[{"op":"remind","title":"round target default","inMinutes":30}]}',
  });
  ownerMessage(channel.id, "remind me here");
  await runAgentRound(agent.id, channel.id, runtime);

  const [reminder] = globalThis.__workspliceDb.listRemindersByAuthor(agent.id);
  assert.equal(reminder.target_id, channel.id, "缺 targetId 时默认钉在本轮 target");
  // 到点必须真投递系统消息（有 target 才能投递/唤醒作者，§3.9）；
  // 需要 relative time 而 scheduleReminder 要 ISO：用 inMinutes 造一条未来提醒再手动推到到点。
  const { fireReminder } = await import("../domain/collab/reminders.ts");
  globalThis.__workspliceDb.updateReminder(reminder.id, {
    fireAt: new Date(Date.now() - 60_000).toISOString(),
  });
  const fired = fireReminder(reminder.id);
  assert.equal(fired.status, "fired");
  assert.ok(fired.systemMessage, "有 target 的提醒到点必须投递系统消息（否则不会唤醒作者）");
  assert.equal(fired.systemMessage.target_id, channel.id);
});

test("pin op resolves the message's own channel (cross-channel reference is not mis-rejected)", async () => {
  const other = createChannel({ name: uniqueName("pin-room") });
  const pinnedMessage = ownerMessage(other.id, "pin me from another channel");
  const { agent, channel, runtime } = setup({
    reply: `{"action":"ignore","ops":[{"op":"pin","messageId":"${pinnedMessage.id}"}]}`,
  });
  joinChannel(other.id, agent.id);
  ownerMessage(channel.id, "pin that other message");
  await runAgentRound(agent.id, channel.id, runtime);

  assert.notEqual(
    globalThis.__workspliceDb.getPinnedMessage(other.id, pinnedMessage.id, agent.id),
    undefined,
    "pin 应落在消息自己的 channel，而不是本轮 target 的 channel",
  );
});

test("search op returns hits to the member in the same round, scoped to its channels", async () => {
  const { agent, channel, runtime, session } = setup({
    reply: [
      { text: '{"action":"ignore","ops":[{"op":"search","query":"scope probe"}]}' },
      { text: '{"action":"reply","content":"I found it"}' },
    ],
  });
  ownerMessage(channel.id, "scope probe visible to the member");
  const hidden = createChannel({ name: uniqueName("hidden-room") });
  ownerMessage(hidden.id, "scope probe hidden from the member");

  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "replied");
  assert.equal(session.prompts.length, 2, "search 后应有一条观察相 prompt");

  const observation = session.prompts[1];
  assert.match(observation, /Search results for "scope probe"/);
  assert.match(observation, /scope probe visible to the member/);
  assert.ok(
    !observation.includes("scope probe hidden from the member"),
    "非成员频道的命中不得进入观察文本",
  );
  assert.ok(observation.includes(`#${channel.name}`), "命中应带归属频道");
});

test("search op：归档＋索引前，归档原文不可经成员面命中（B2）", async () => {
  const { agent, channel, runtime, session } = setup({
    reply: [
      { text: '{"action":"ignore","ops":[{"op":"search","query":"ORCHID-42"}]}' },
      { text: '{"action":"reply","content":"nothing yet"}' },
    ],
  });
  ownerMessage(channel.id, "look for the old code");

  await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(session.prompts.length, 2);
  assert.match(session.prompts[1], /\(no matches\)/, "归档＋索引前成员面不可命中");
});

test("search op 命中成员自己的归档原文：观察相标注来源且不泄漏他人归档（B2/B4）", async () => {
  const { agent, channel, runtime, session } = setup({
    reply: [
      { text: '{"action":"ignore","ops":[{"op":"search","query":"ORCHID-42"}]}' },
      { text: '{"action":"reply","content":"found the old fact"}' },
    ],
  });
  // 另一个 agent 的归档同样命中该查询词：成员面必须过滤掉
  const other = createAgent({ name: uniqueName("other-archivist") });
  archiveAgentSessionFiles(other.id, [
    syntheticSessionFile({ userText: "关键事实：检索暗号 ORCHID-42（OTHER-ARCHIVE-MARK）" }),
  ]);
  archiveAgentSessionFiles(agent.id, [
    syntheticSessionFile({ userText: "关键事实：检索暗号 ORCHID-42（OWN-ARCHIVE-MARK）" }),
  ]);
  ownerMessage(channel.id, "what was the old code again?");

  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "replied");
  assert.equal(session.prompts.length, 2, "search 后应有一条观察相 prompt");

  const observation = session.prompts[1];
  assert.match(observation, /archived session/, "归档命中在观察相标注来源");
  assert.match(observation, /OWN-ARCHIVE-MARK/);
  assert.match(observation, /entry 2 \(message\)/, "观察相携带归档条目定位");
  assert.ok(
    !observation.includes("OTHER-ARCHIVE-MARK"),
    "其他 agent 的归档不得进入成员观察相",
  );
});

test("search op 命中归档会话里的 compact summary（B3，同一检索面）", async () => {
  const { agent, channel, runtime, session } = setup({
    reply: [
      { text: '{"action":"ignore","ops":[{"op":"search","query":"AURORA-7"}]}' },
      { text: '{"action":"reply","content":"the window is archived"}' },
    ],
  });
  archiveAgentSessionFiles(agent.id, [
    syntheticSessionFile({ userText: "普通对话，无关键事实", summary: "摘要：迁移窗口定在 AURORA-7" }),
  ]);
  ownerMessage(channel.id, "when is the migration window?");

  await runAgentRound(agent.id, channel.id, runtime);
  const observation = session.prompts[1];
  assert.match(observation, /AURORA-7/);
  assert.match(observation, /\(compaction\)/, "summary 条目在观察相标出条目类型");
});

// ---------------------------------------------------------------------------
// 创建类与跨 target 指针
// ---------------------------------------------------------------------------

test("post op posts to another target as the member", async () => {
  const other = createChannel({ name: uniqueName("other-room") });
  const { agent, channel, runtime } = setup({
    reply: ({ channel: room }) =>
      `{"action":"ignore","ops":[{"op":"post","targetId":"#${other.name}","content":"@Owner pointer from ${room.name}"}]}`,
  });
  joinChannel(other.id, agent.id);
  ownerMessage(channel.id, "see the task elsewhere");

  await runAgentRound(agent.id, channel.id, runtime);
  const posted = globalThis.__workspliceDb.listMessagesBefore(other.id, undefined, 10);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].author_id, agent.id);
  assert.match(posted[0].content, /@Owner pointer from/);
});

test("createChannel op creates the channel with the member among its members", async () => {
  const description = `from an op ${uniqueName("desc")}`;
  const { agent, channel, runtime } = setup({
    reply: `{"action":"ignore","ops":[{"op":"createChannel","name":"room-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}","type":"private","description":"${description}"}]}`,
  });
  ownerMessage(channel.id, "make a room");
  await runAgentRound(agent.id, channel.id, runtime);

  const created = globalThis.__workspliceDb
    .listChannels()
    .find((candidate) => candidate.description === description);
  assert.ok(created, "频道应被创建");
  assert.equal(globalThis.__workspliceDb.isChannelMember(created.id, agent.id), true, "创建者应是成员");
});

test("createAgent op creates an agent with the declared model", async () => {
  const name = `MadeByOp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const { agent, channel, runtime } = setup({
    reply: `{"action":"ignore","ops":[{"op":"createAgent","name":"${name}","description":"from an op","provider":"openai","modelId":"gpt-5","thinkingLevel":"max"}]}`,
  });
  ownerMessage(channel.id, "make an agent");
  await runAgentRound(agent.id, channel.id, runtime);

  const created = globalThis.__workspliceDb.getMemberByName(name);
  assert.ok(created, "agent 应被创建");
  assert.equal(created.model_provider, "openai");
  assert.equal(created.model_id, "gpt-5");
  assert.equal(created.thinking_level, "max");
});

test("createAgent op falls back to the configured default model seam", async () => {
  const { agent, channel } = setup({ reply: '{"action":"ignore"}' });
  const { executeMemberOps, parseMemberOps, planMemberOps } = await import("./member-ops.ts");
  const name = `DefaultedAgent${fixtureSeq}`;
  const outcome = executeMemberOps({
    agent,
    targetId: channel.id,
    plans: planMemberOps(parseMemberOps([{ op: "createAgent", name }])),
    resolveDefaultModel: () => ({ provider: "zenmux", modelId: "claude-sonnet-4-6" }),
  });
  assert.equal(outcome.outcomes[0].status, "applied");
  const created = globalThis.__workspliceDb.getMemberByName(name);
  assert.equal(created.model_provider, "zenmux");
  assert.equal(created.model_id, "claude-sonnet-4-6");
});

// ---------------------------------------------------------------------------
// 越权：人类专属操作对成员不开（反向断言，无副作用）
// ---------------------------------------------------------------------------

test("human-only ops are denied with no side effect (reverse assertion)", async () => {
  const { agent, channel, runtime } = setup({
    reply: '{"action":"ignore","ops":[{"op":"deleteIdentity","agentId":"someone"},{"op":"archiveChannel","channelId":"#all"},{"op":"setRuntime","agentId":"someone"}]}',
  });
  ownerMessage(channel.id, "delete everything");
  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  // 无副作用：身份还在、频道未归档
  assert.ok(globalThis.__workspliceDb.getMember(agent.id), "成员不得被删除");
  assert.equal(globalThis.__workspliceDb.getChannel(channel.id).archived, 0, "频道不得被归档");
  // 边界可见：拒绝理由进本轮结果（round_logs / outcome.reason）
  assert.match(String(outcome.reason ?? ""), /human-only|default deny/i);
});

// ---------------------------------------------------------------------------
// 票 08：search op → 观察相缝（B5 的按需回查 + B8 的既有形状约束）
// ---------------------------------------------------------------------------

test("B5/B8：早期关键事实不在本轮注入中，却能经 search 命中并以观察相文本回交", async () => {
  const { agent, channel, runtime, session } = setup({
    reply: [
      { text: '{"action":"ignore","ops":[{"op":"search","query":"EARLY-FACT-ORCHID"}]}' },
      { text: '{"action":"reply","content":"found it via search"}' },
    ],
  });
  ownerMessage(channel.id, "关键事实：早期轮埋入的检索暗号 EARLY-FACT-ORCHID");
  for (let i = 0; i < 200; i += 1) {
    ownerMessage(channel.id, `填充消息 ${i} ${"x".repeat(160)}`);
  }
  ownerMessage(channel.id, "现在请回答这个问题");

  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "replied");

  const [decide, observation] = session.prompts;
  assert.ok(
    decide.length <= ROUND_INJECTION_BUDGET_CHARS,
    `decide 注入 ${decide.length} 应 ≤ ${ROUND_INJECTION_BUDGET_CHARS}`,
  );
  assert.ok(!decide.includes("EARLY-FACT-ORCHID"), "早期关键事实不在本轮注入中");
  assert.ok(
    decide.includes("现在请回答这个问题"),
    "当轮要回的最新消息仍在注入中（保近期）",
  );
  assert.equal(session.prompts.length, 2, "一轮最多一次观察相");
  assert.match(observation, /EARLY-FACT-ORCHID/, "命中经观察相文本回交");
  assert.ok(
    observation.length <= ROUND_INJECTION_BUDGET_CHARS,
    `观察相注入 ${observation.length} 应 ≤ ${ROUND_INJECTION_BUDGET_CHARS}`,
  );
});

test("B8：一轮最多一次观察相——模型连续声明 search 也只回交一次", async () => {
  const { agent, channel, runtime, session } = setup({
    reply: [
      { text: '{"action":"ignore","ops":[{"op":"search","query":"round one"}]}' },
      // 观察相里再声明一次 search：结果不再回交（每轮一条观察相），本轮按这次的 reply 收口
      {
        text: '{"action":"reply","content":"done after one observation","ops":[{"op":"search","query":"round two"}]}',
      },
    ],
  });
  ownerMessage(channel.id, "round one then round two");

  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "replied");
  assert.equal(session.prompts.length, 2, "decide + 至多一条观察相 prompt");
  assert.match(session.prompts[1], /Search results for "round one"/);
  assert.doesNotMatch(session.prompts[1], /Search results for "round two"/);
  assert.match(
    String(outcome.reason ?? ""),
    /one observation phase per round/,
    "封顶在轮次结果里可见（不静默丢弃）",
  );
});

// ---------------------------------------------------------------------------
// 票 10：合成多轮端到端「事实 → 压缩/截断 → 回查」
// ---------------------------------------------------------------------------
// compact 触发不依赖真实 provider 的阈值：直接把「compact 后的会话投影形态」
//（原始会话记录归档副本 + compaction summary）投到检索面，再让积压灌满注入窗口，
// 使早期关键事实被裁出本轮注入投影，最后经既有 `search` op 回查命中、观察相回交。

/** 合成积压：灌满注入近期窗口，把更早的关键事实挤出注入投影。 */
function seedFillerBacklog(targetId, { filler = 200, chars = 160 } = {}) {
  for (let index = 0; index < filler; index += 1) {
    ownerMessage(targetId, `填充消息 ${index} ${"x".repeat(chars)}`);
  }
}

test("B2/B8 合成端到端：事实 → compact 后投影（截断出注入）→ search 回查命中 → 回复引用事实", async () => {
  const FACT = "FACT-COMPACT-ORCHID";
  const { agent, channel, runtime, session } = setup({
    reply: [
      // 第 1 轮：确认记下了（这一轮的原文随后进入 compact 后的投影形态）
      { text: '{"action":"reply","content":"记下了"}' },
      // 第 2 轮：先声明 search 回查，看到命中后再给最终回复
      { text: `{"action":"ignore","ops":[{"op":"search","query":"${FACT}"}]}` },
      { text: `{"action":"reply","content":"回查命中：${FACT}"}` },
    ],
  });

  // ① 事实：早期轮埋进原始会话记录（它随后既留在不可变消息里，也进归档副本）
  ownerMessage(channel.id, `关键事实：迁移窗口暗号 ${FACT}`);
  const first = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(first.status, "replied");
  assert.equal(session.prompts.length, 1, "第 1 轮没声明 op，只有一条 decide prompt");

  // ② 压缩：注入 compact 后的投影形态（合成 JSONL 归档副本，含 compaction summary）
  archiveAgentSessionFiles(agent.id, [
    syntheticSessionFile({
      userText: `关键事实：迁移窗口暗号 ${FACT}（原始记录）`,
      summary: `摘要：早期确认的迁移窗口暗号为 ${FACT}`,
    }),
  ]);
  const archivedHits = searchArchivedSessionEntries(FACT);
  assert.equal(archivedHits.length, 2, "归档副本进检索面：原始消息 + compaction summary 各一条");
  for (const hit of archivedHits) {
    assert.equal(hit.agent_id, agent.id, "归档命中只来自该 agent 自己的副本");
  }

  // ③ 截断：积压灌满注入窗口，早期关键事实被裁出本轮注入投影
  seedFillerBacklog(channel.id);
  ownerMessage(channel.id, "现在请回查那个暗号");

  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "replied");

  const [firstDecide, secondDecide, observation] = session.prompts;
  assert.equal(
    session.prompts.length,
    3,
    "两轮共三条 prompt：第 2 轮 = 一条 decide + 唯一一条观察相（B8 一轮最多一次）",
  );
  assert.ok(firstDecide.includes(FACT), "第 1 轮积压还小时，事实本来在注入里");

  // B5：截断后早期事实不在本轮注入中，当轮要回的最新消息仍在
  assert.ok(
    secondDecide.length <= ROUND_INJECTION_BUDGET_CHARS,
    `decide 注入 ${secondDecide.length} 应 ≤ ${ROUND_INJECTION_BUDGET_CHARS}`,
  );
  assert.ok(!secondDecide.includes(FACT), "早期关键事实被裁剪出本轮注入投影");
  assert.ok(secondDecide.includes("现在请回查那个暗号"), "当轮要回的最新消息仍在注入中");

  // B2/B3：命中来自归档会话原文（含 compact summary），经观察相文本回交
  assert.match(observation, new RegExp(`Search results for "${FACT}"`));
  assert.match(observation, /archived session of @/, "归档命中在观察相标注来源");
  assert.ok(observation.includes(FACT), "命中事实经观察相文本回交");
  assert.ok(
    observation.length <= ROUND_INJECTION_BUDGET_CHARS,
    `观察相注入 ${observation.length} 应 ≤ ${ROUND_INJECTION_BUDGET_CHARS}`,
  );

  // 端到端收口：模型在观察相之后写的回复引用了那个事实，并落库
  const messages = globalThis.__workspliceDb.listMessages(channel.id);
  assert.equal(messages[messages.length - 1].author_id, agent.id);
  assert.ok(messages[messages.length - 1].content.includes(FACT), "最终回复引用了回查命中的事实");
});

test("B2/B4/B8 合成端到端：回查只回成员自己的归档，他人归档不泄漏", async () => {
  const FACT = "FACT-SCOPED-RECHECK";
  const { agent, channel, runtime, session } = setup({
    reply: [
      { text: `{"action":"ignore","ops":[{"op":"search","query":"${FACT}"}]}` },
      { text: `{"action":"reply","content":"只看到自己的归档：${FACT}"}` },
    ],
  });

  // 他人归档同样命中该查询词：成员面必须过滤掉（B4）
  const other = createAgent({ name: uniqueName("other-recheck") });
  archiveAgentSessionFiles(other.id, [
    syntheticSessionFile({ userText: `关键事实：检索暗号 ${FACT}（OTHER-ARCHIVE-MARK）` }),
  ]);
  archiveAgentSessionFiles(agent.id, [
    syntheticSessionFile({
      userText: `关键事实：检索暗号 ${FACT}（OWN-ARCHIVE-MARK）`,
      summary: `摘要：检索暗号 ${FACT}（OWN-SUMMARY-MARK）`,
    }),
  ]);

  seedFillerBacklog(channel.id);
  ownerMessage(channel.id, "回查一下那个暗号");

  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "replied");

  const [decide, observation] = session.prompts;
  assert.equal(session.prompts.length, 2, "一轮 = 一条 decide + 至多一条观察相（B8）");
  assert.ok(!decide.includes(FACT), "事实只存在于归档面，不在本轮注入里");

  assert.ok(observation.includes("OWN-ARCHIVE-MARK"), "成员自己的归档命中被回交");
  assert.ok(
    !observation.includes("OTHER-ARCHIVE-MARK"),
    "其他 agent 的归档不得进入成员观察相（B4）",
  );
});

test("post op with a stale baseSeq is held and does not post", async () => {
  const other = createChannel({ name: uniqueName("held-room") });
  const { agent, channel, runtime } = setup({
    reply: `{"action":"ignore","ops":[{"op":"post","targetId":"#${other.name}","content":"stale","baseSeq":1}]}`,
  });
  joinChannel(other.id, agent.id);
  ownerMessage(other.id, "existing message"); // seq 1
  ownerMessage(other.id, "second message"); // seq 2 —— 成员看到的是 seq 1
  ownerMessage(channel.id, "post with a stale version");
  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(
    globalThis.__workspliceDb.listMessagesBefore(other.id, undefined, 10).length,
    2,
    "held 时不得落库",
  );
  assert.match(String(outcome.reason ?? ""), /held/i);
});
