import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/sqlite.ts";

// 票 #266「消息指认」的端到端取证：从**真实渲染出的轮次注入行**里取出句柄，原样喂给建任务工具，
// 任务真的建出来。三个模块在这里只经各自的公共面出现——渲染 = `buildReplyPrompt`（agent-loop 的
// 唯一注入渲染点），判定 = `decideTaskCreateInput`（工具内部的参数判定），写面 = `worksplice_task_create`
// 的 `execute`（与真实调用同一条路径，只省掉模型循环）。断言口径是外部行为：任务板上出现了一条
// 锚定在该消息上的任务，而不是「某个函数被调了几次」。

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-message-identification-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const {
  createAgent,
  createChannel,
  joinChannel,
  listChannelTasks,
  listMessages,
  sendMessage,
  setGlobalChief,
} = await import("../domain/collab/index.ts");
const { OWNER_MEMBER_ID } = await import("../data/schema.ts");
const { buildReplyPrompt } = await import("../agent-loop/loop.ts");
const { chiefToolDefinitions } = await import("./tools.ts");
const { decideTaskCreateInput } = await import("./decisions.ts");

/**
 * 从渲染出的注入行里取出消息 id 句柄：`#<seq> @<author>: <content> (messageId <完整 id>)`。
 *
 * 刻意**不**在测试里手写 id——手写就等于绕过了「渲染」这一环，而那正是本票要证明能用的那一环。
 * 取不出句柄时返回 null，让断言给出「行里没有 id」这条可读的失败信息。
 */
function messageIdOfRenderedLine(prompt, { seq, authorName }) {
  const line = prompt
    .split("\n")
    .find((candidate) => candidate.startsWith(`#${seq} @${authorName}:`));
  if (!line) return null;
  const match = line.match(/\(messageId ([0-9a-f-]{36})\)$/);
  return match ? match[1] : null;
}

function toolCall(actorId, sessionKey) {
  const definitions = new Map(
    chiefToolDefinitions({ actorId, sessionKey }).map((definition) => [
      definition.name,
      definition,
    ]),
  );
  return (name, input) => {
    const definition = definitions.get(name);
    assert.ok(definition, `工具未注册：${name}`);
    return definition.execute(`call-${name}`, input, undefined, undefined, { cwd: root });
  };
}

test("首席把注入里看到的那一条消息转成任务（渲染 → 取 id → 建任务）", async () => {
  const chief = createAgent({ name: "identified-chief" });
  setGlobalChief(chief.id);
  const channel = createChannel({ name: "identified-room" });
  joinChannel(channel.id, chief.id);

  const anchor = sendMessage({
    targetId: channel.id,
    authorId: OWNER_MEMBER_ID,
    content: "这条得有人做：把发布说明写完",
  }).message;

  const prompt = buildReplyPrompt({
    agent: chief,
    channel,
    messages: listMessages(channel.id).messages,
    tasks: [],
    targetId: channel.id,
    baseSeq: 0,
  });
  const messageId = messageIdOfRenderedLine(prompt, { seq: anchor.seq, authorName: "Owner" });
  assert.equal(messageId, anchor.id, "注入行行尾带的就是这条消息的完整 id");

  // 工具的入参形状不变：仍然只有 messageId（判定层是那张形状的唯一来源）。
  const decision = decideTaskCreateInput({ messageId });
  assert.equal(decision.ok, true, `建任务参数判定应通过：${decision.error ?? ""}`);

  const call = toolCall(chief.id, "identified-session");
  const result = await call("worksplice_task_create", decision.value);
  assert.notEqual(
    result.isError,
    true,
    `工具应成功建任务，实际返回：${result.content[0]?.text}`,
  );

  const created = listChannelTasks(channel.id);
  assert.equal(created.length, 1, "任务板上应出现恰好一条任务");
  assert.equal(created[0].anchor.id, anchor.id, "任务锚定在注入里那条消息上");
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.number, created[0].number);
  assert.equal(payload.anchorSeq, anchor.seq);
});
