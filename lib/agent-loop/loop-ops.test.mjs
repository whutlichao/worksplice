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
const { setAgentStatusLookup } = await import("../agent-status.ts");
const { OWNER_MEMBER_ID } = await import("../data/schema.ts");

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
