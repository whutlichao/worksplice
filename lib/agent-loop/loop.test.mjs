import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDataDb } from "../data/sqlite.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-loop-"));
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  setAgentStatusLookup(null);
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const {
  ack,
  createAgent,
  createChannel,
  createDirectChannel,
  createTask,
  getAgent,
  joinChannel,
  sendMessage,
} = await import('../domain/collab/index.ts');
const {
  runAgentRound,
  parseAgentAction,
  buildReplyPrompt,
  replyPromptContext,
  buildRevisionPrompt,
  CONTENT_PLACEMENT_RUBRIC,
  waitForPromptCompletion,
  promptSession,
  waitForSessionIdle,
  deliverWithFreshness,
  hasPeerCloseSignal,
  MAX_REVISE_RETRIES,
  MAX_RESEND_RETRIES,
  MAX_TASK_STATUS_RETRIES,
} = await import("./loop.ts");
const { ROUND_INJECTION_BUDGET_CHARS, INJECTION_MESSAGE_WINDOW } = await import(
  "./injection-budget.ts"
);
const { subscribeAgentStatuses, setAgentStatusLookup, publishAgentStatus } = await import(
  "../agent-status.ts"
);
const { BusyCwdError } = await import("../agent-runtime.ts");
const { OWNER_MEMBER_ID } = await import("../data/schema.ts");

const STATUS_BY_EVENT = {
  agent_start: "working",
  agent_end: "online",
  agent_settled: "online",
  prompt_error: "error",
};

// 镜像 agent-runtime 的现场状态推导 + 事件→状态映射，让状态点断言走真实链路
let activeRuntime = null;
setAgentStatusLookup((member) => {
  const session = activeRuntime?.sessions.get(member.id);
  if (!session) return null;
  if (session.isRunning()) return "working";
  return getAgent(member.id).status === "error" ? null : "online";
});

function wireSessionStatus(memberId, session) {
  session.onEvent((event) => {
    const status = STATUS_BY_EVENT[event.type];
    if (!status) return;
    // 镜像 agent-runtime：agent_end/agent_settled 不覆盖 error（只被下一次 agent_start 清除）
    if (
      getAgent(memberId).status === "error" &&
      (event.type === "agent_end" || event.type === "agent_settled")
    ) {
      return;
    }
    publishAgentStatus(memberId, status);
  });
}

function sendAsOwner(targetId, content) {
  const result = sendMessage({ targetId, authorId: OWNER_MEMBER_ID, content });
  assert.equal(result.held, false);
  return result.message;
}

function makeFakeSession(replies = []) {
  const listeners = [];
  let running = false;
  const session = {
    replies,
    lastText: "",
    // D1：真实 SDK 把模型/API 报错写进末条 assistant message（stopReason/errorMessage），
    // 这里模拟 only-read 命令能取到的细节；未设置 = 会话拿不到细节（回落通用文案）。
    lastErrorDetail: null,
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
          if (reply?.error) {
            this.emit({ type: "prompt_error", errorMessage: reply.error });
          } else {
            this.lastText = reply?.text ?? "";
            if (reply?.errorDetail) this.lastErrorDetail = reply.errorDetail;
            this.emit({ type: "prompt_done" });
          }
          this.emit({ type: "agent_end" });
        });
        return null;
      }
      if (command.type === "get_last_assistant_text") return { text: this.lastText };
      if (command.type === "get_last_assistant_error") {
        return this.lastErrorDetail ?? { stopReason: null, errorMessage: null };
      }
      return null;
    },
  };
  return session;
}

function makeFakeRuntime({ repliesByAgent = {}, prestarted = [] } = {}) {
  const sessions = new Map();
  for (const memberId of prestarted) {
    const session = makeFakeSession(repliesByAgent[memberId] ?? []);
    wireSessionStatus(memberId, session);
    sessions.set(memberId, session);
  }
  return {
    sessions,
    findSession: (member) => sessions.get(member.id),
    async startSession(member) {
      if (!member.workspace_path) throw new Error("Agent has no workspace bound");
      const session = makeFakeSession(repliesByAgent[member.id] ?? []);
      wireSessionStatus(member.id, session);
      sessions.set(member.id, session);
      return { sessionId: member.id, sessionFile: `/sessions/${member.id}.jsonl` };
    },
  };
}

function setupAgentAndChannel({ name, channelName = "loop-room", join = true, workspace = true }) {
  const ws = workspace ? fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-loop-ws-")) : null;
  const agent = createAgent({ name, workspacePath: ws });
  const channel = createChannel({ name: channelName });
  if (join) joinChannel(channel.id, agent.id);
  return { agent, channel, ws };
}

/** 造一个 peer agent 并加入 channel（peer @ / peer 收束回归共用前置）。 */
function joinPeer(channel, { name, wsPrefix }) {
  const peer = createAgent({
    name,
    workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), wsPrefix)),
  });
  joinChannel(channel.id, peer.id);
  return peer;
}

// ---------------------------------------------------------------------------
// parseAgentAction
// ---------------------------------------------------------------------------

test("parseAgentAction parses JSON reply and accepts the four conflict choices", () => {
  const reply = parseAgentAction('{"action":"reply","content":"hi","onConflict":"resend"}');
  assert.deepEqual(reply, { action: "reply", content: "hi", onConflict: "resend" });
  for (const choice of ["revise", "resend", "silent", "anyway"]) {
    assert.equal(parseAgentAction(`{"action":"reply","content":"x","onConflict":"${choice}"}`).onConflict, choice);
  }
  const ignored = parseAgentAction('{"action":"ignore"}');
  assert.equal(ignored.action, "ignore");
  assert.equal(ignored.onConflict, "resend", "缺省冲突策略 = resend");
});

test("parseAgentAction strips json code fences and falls back to the whole text", () => {
  const fenced = parseAgentAction('```json\n{"action":"reply","content":"ok","onConflict":"silent"}\n```');
  assert.deepEqual(fenced, { action: "reply", content: "ok", onConflict: "silent" });

  const plain = parseAgentAction("I will take a look at this.");
  assert.deepEqual(plain, { action: "reply", content: "I will take a look at this.", onConflict: "resend" });
});

test("parseAgentAction extracts the JSON object from text polluted with model tokens or prose", () => {
  const eom = parseAgentAction(
    '{ "action": "reply", "content": "因为这是工作流程要求的格式", "onConflict": "revise" }<|eom|>',
  );
  assert.deepEqual(eom, {
    action: "reply",
    content: "因为这是工作流程要求的格式",
    onConflict: "revise",
  });

  const trailingProse = parseAgentAction(
    '{"action":"reply","content":"ok","onConflict":"silent"} 以上是我的回复，请查收。',
  );
  assert.deepEqual(trailingProse, { action: "reply", content: "ok", onConflict: "silent" });

  const leadingProse = parseAgentAction(
    '好的，我的回复是：{"action":"reply","content":"done","onConflict":"revise"}',
  );
  assert.deepEqual(leadingProse, { action: "reply", content: "done", onConflict: "revise" });

  const bracesInContent = parseAgentAction(
    '{"action":"reply","content":"代码在 {app} 目录，请查阅 {docs}","onConflict":"revise"}<|eom|>',
  );
  assert.deepEqual(bracesInContent, {
    action: "reply",
    content: "代码在 {app} 目录，请查阅 {docs}",
    onConflict: "revise",
  });

  const plainStillFallsBack = parseAgentAction("我用 { } 花括号强调一下重点。");
  assert.deepEqual(plainStillFallsBack, {
    action: "reply",
    content: "我用 { } 花括号强调一下重点。",
    onConflict: "resend",
  });
});

test("parseAgentAction accepts conclude and keeps a trimmed reason", () => {
  assert.deepEqual(
    parseAgentAction('{"action":"conclude","reason":" thread concluded "}'),
    {
      action: "conclude",
      content: "",
      onConflict: "resend",
      reason: "thread concluded",
    },
  );

  const extracted = parseAgentAction(
    '收尾确认：{"action":"conclude","reason":"no addition needed"}<|eom|>',
  );
  assert.equal(extracted.action, "conclude");
  assert.equal(extracted.reason, "no addition needed");

  const blank = parseAgentAction('{"action":"conclude","reason":"   "}');
  assert.equal(blank.action, "conclude");
  assert.equal(blank.reason, undefined, "空白 reason 被丢弃");
});

// reply-json-leak：模型偶发把 JSON 对象的开头 `{"` 输出成 `","` / `,"`（实证形态），
// 直接 parse 与 extractJsonObject 都救不回来（`",` 之后没有 `{`，提取器找不到对象开头），
// 修复后必须按协议回复收口，而不是把整段碎片当正文落库。
test("parseAgentAction repairs the leaked `{\"` prologue into a protocol reply", () => {
  assert.deepEqual(
    parseAgentAction('```json","action":"reply","content":"ok","onConflict":"silent"}\n```'),
    { action: "reply", content: "ok", onConflict: "silent" },
  );
  // 少一个引号的形态：onConflict 缺省仍是 resend（合流进既有提取逻辑，不另写一套）
  const shortForm = parseAgentAction('```json,"action":"reply","content":"ok"}\n```');
  assert.deepEqual(shortForm, { action: "reply", content: "ok", onConflict: "resend" });
});

test("parseAgentAction unescapes literal \\n sequences in a repaired reply", () => {
  const repaired = parseAgentAction(
    '```json","action":"reply","content":"a\\nb","onConflict":"resend"}\n```',
  );
  assert.deepEqual(repaired, { action: "reply", content: "a\nb", onConflict: "resend" });
});

test("parseAgentAction carries task and member ops through the repaired prologue", () => {
  const repaired = parseAgentAction(
    '```json","action":"reply","content":"开工","task":{"number":7,"op":"claim"}}\n```',
  );
  assert.deepEqual(repaired, {
    action: "reply",
    content: "开工",
    onConflict: "resend",
    task: { number: 7, op: "claim" },
  });
});

test("parseAgentAction repairs conclude leaks and still rejects unknown actions", () => {
  // 两条泄漏修复档都必须接受 conclude：坏序言 + 裸控制字符。
  const prologue = parseAgentAction('```json","action":"conclude","reason":"settled"}\n```');
  assert.equal(prologue.action, "conclude");
  assert.equal(prologue.reason, "settled");

  const rawControl = parseAgentAction('{"action":"conclude","reason":"line1\nline2"}');
  assert.equal(rawControl.action, "conclude");
  assert.equal(rawControl.reason, "line1\nline2");

  const unknown = parseAgentAction('","action":"archive","content":"x"}');
  assert.equal(unknown.action, "reply", "非法 action 仍被协议形状校验拒绝");
  assert.match(unknown.content, /"action":"archive"/);

  const arrayAction = parseAgentAction('","action":["conclude"],"content":"x"}');
  assert.equal(arrayAction.action, "reply", "非字符串 action 不得被 String() 夹带过关");
  assert.match(arrayAction.content, /\["conclude"\]/);
});

test("parseAgentAction falls back to the whole text when the repaired prologue is not a protocol reply", () => {
  // 形态命中但 parse 后不是协议形状：宁可整段当正文，也不猜
  const notJson = parseAgentAction('","动作":"回复","正文":"这不是协议"');
  assert.deepEqual(notJson, {
    action: "reply",
    content: '","动作":"回复","正文":"这不是协议"',
    onConflict: "resend",
  });

  // 形态命中、parse 成功，但 action 不是 reply/ignore：同样不走修复档
  const wrongShape = parseAgentAction('","foo":"bar"');
  assert.deepEqual(wrongShape, {
    action: "reply",
    content: '","foo":"bar"',
    onConflict: "resend",
  });
});

// 第二形态（reply-json-raw-leak）：协议 JSON 的**形状写对了**，但 content 字符串值里是真实
// 换行（裸控制字符）而不是字面 `\n`。JSON.parse 报 Bad control character、extractJsonObject
// 取得到对象但一样 parse 不过、票 01 的序言档不命中——三档全落空，整段 JSON 当正文落库。
// 修复后必须按协议回复收口：action=reply、content=还原换行后的正文。
const RAW_CONTROL_REPLY =
  '{"action":"reply","content":"@bob 收到，先看主触发点。\n\n```\nOK\n```","onConflict":"revise"}';

test("parseAgentAction escapes raw control characters inside protocol JSON string values", () => {
  assert.ok(RAW_CONTROL_REPLY.includes("\n"), "样本必须含真实裸换行（不是字面 \\n）");
  assert.deepEqual(parseAgentAction(RAW_CONTROL_REPLY), {
    action: "reply",
    content: "@bob 收到，先看主触发点。\n\n```\nOK\n```",
    onConflict: "revise",
  });
});

test("parseAgentAction handles every raw control character below 0x20 inside string values", () => {
  const withTabAndCr = '{"action":"reply","content":"a\tb\rc\bd\fe\u001f"}';
  assert.deepEqual(parseAgentAction(withTabAndCr), {
    action: "reply",
    content: "a\tb\rc\bd\fe\u001f",
    onConflict: "resend",
  });
});

test("parseAgentAction keeps escaped sequences and code-fenced raw-control replies intact", () => {
  // 已是合法转义的 `\n` 保持转义语义（原生路径本来就过这一条，这里钉住不走修复档也不变）
  assert.deepEqual(parseAgentAction('{"action":"reply","content":"a\\nb"}'), {
    action: "reply",
    content: "a\nb",
    onConflict: "resend",
  });

  // 围栏包裹 + 裸换行：剥围栏后仍走修复档
  const fenced = `\`\`\`json\n${RAW_CONTROL_REPLY}\n\`\`\``;
  assert.deepEqual(parseAgentAction(fenced), {
    action: "reply",
    content: "@bob 收到，先看主触发点。\n\n```\nOK\n```",
    onConflict: "revise",
  });
});

test("parseAgentAction carries ignore / task / ops through the raw-control reply", () => {
  assert.deepEqual(parseAgentAction('{"action":"ignore","content":""}'), {
    action: "ignore",
    content: "",
    onConflict: "resend",
  });

  const withTask = parseAgentAction(
    '{"action":"reply","content":"开工\n第二步","task":{"number":7,"op":"claim"}}',
  );
  assert.deepEqual(withTask, {
    action: "reply",
    content: "开工\n第二步",
    onConflict: "resend",
    task: { number: 7, op: "claim" },
  });
});

test("parseAgentAction still falls back when raw control characters are not in a protocol reply", () => {
  // 形状像对象、转义后能 parse，但 action 不合法：宁可整段当正文，也不猜
  assert.deepEqual(parseAgentAction('{"动":"a\nb"}'), {
    action: "reply",
    content: '{"动":"a\nb"}',
    onConflict: "resend",
  });

  // 候选判据不成立（不以 `}` 结尾）：不进入本档，维持整段兜底
  const unterminated = '{"action":"reply","content":"a\nb"';
  assert.deepEqual(parseAgentAction(unterminated), {
    action: "reply",
    content: unterminated,
    onConflict: "resend",
  });

  // 纯自然语言（含裸换行）逐字不动——票 01 的兜底语义一字不改
  assert.deepEqual(parseAgentAction("第一行\n第二行"), {
    action: "reply",
    content: "第一行\n第二行",
    onConflict: "resend",
  });
});

test("parseAgentAction falls back on unescaped inner quotes: not a control-character problem", () => {
  // live 实测的另一类坏法（coordinator 在快照上交付的证据）：正文里含 Markdown 代码片段，
  // 模型把其中的双引号**原样输出**而没有 `\"`，于是 JSON 在 `rel=` 之后就被合上、
  // 后面的内容成为游离 token（裸换行只是恰好同时存在，不是成因）。
  // 本档只负责「裸控制字符转义」，它**不该**救回这一条——为它配平引号属于猜测性修复。
  const unescapedInnerQuote =
    '{"action":"reply","content":"我改了这一行：\n`<link rel="stylesheet" href="tokens.css">`\n请确认。","onConflict":"revise"}';
  const out = parseAgentAction(unescapedInnerQuote);
  // 整段当正文：不抛错、不丢字、不截断
  assert.deepEqual(out, {
    action: "reply",
    content: unescapedInnerQuote,
    onConflict: "resend",
  });
});

// ---------------------------------------------------------------------------
// buildReplyPrompt
// ---------------------------------------------------------------------------

test("buildReplyPrompt carries channel context, seq-tagged messages, tasks and the room marker", () => {
  const { agent, channel } = setupAgentAndChannel({ name: "prompter" });
  const human = { id: "owner", name: "Owner" };
  const prompt = buildReplyPrompt({
    agent,
    channel,
    messages: [
      { id: "m1", target_id: channel.id, seq: 1, author_id: "owner", content: "please fix the bug", created_at: "", author: human },
    ],
    tasks: [
      { number: 3, status: "todo", preview: "fix the bug", ownerName: "unassigned" },
      { number: 4, status: "todo", preview: "redo the thing", ownerName: "unassigned", reopened: true },
    ],
    targetId: channel.id,
    baseSeq: 1,
  });
  assert.match(prompt, /@prompter/);
  assert.match(prompt, /loop-room/);
  assert.match(prompt, /#1 @Owner: please fix the bug/);
  assert.match(prompt, /task #3 \[todo\]/);
  assert.match(prompt, /task #4 \[todo\].*REOPENED, awaiting the owner: do not claim/);
  assert.match(prompt, /action/);
  assert.match(prompt, /\[worksplice:target=[^\]]+ seq=1\]/);
  assert.match(prompt, new RegExp(`\\[worksplice:target=${channel.id} seq=1\\]`));
});

// ---------------------------------------------------------------------------
// P1：target 身份可见——频道轮 / 线程轮 / 任务线程轮的 prompt 头部必须可区分
// ---------------------------------------------------------------------------

test("a channel round keeps the byte-identical channel header", () => {
  const { agent, channel } = setupAgentAndChannel({ name: "header-channel" });
  const prompt = buildReplyPrompt({
    agent,
    channel,
    messages: [],
    tasks: [],
    targetId: channel.id,
    baseSeq: 0,
  });

  assert.match(
    prompt,
    new RegExp(`^New activity arrived in channel ${channel.name}:$`, "m"),
    "频道轮的头部与既有文案逐字节一致",
  );
  assert.doesNotMatch(
    prompt,
    /New activity arrived in a thread|New activity arrived in the thread of task/,
    "频道轮不得出现线程身份的措辞",
  );
});

test("a plain thread names the channel plus the anchor seq", () => {
  const { agent, channel } = setupAgentAndChannel({ name: "header-thread" });
  const anchor = sendAsOwner(channel.id, "side question");
  const prompt = buildReplyPrompt({
    agent,
    channel,
    messages: [],
    tasks: [],
    targetId: anchor.id,
    baseSeq: 1,
  });

  assert.match(
    prompt,
    new RegExp(
      `^New activity arrived in a thread under channel ${channel.name} \\(anchor seq ${anchor.seq}\\):$`,
      "m",
    ),
    "没有任务的线程轮写明频道与锚点 seq",
  );
  assert.match(
    prompt,
    new RegExp(`\\[worksplice:target=${anchor.id} seq=1\\]`),
    "marker 语义不变",
  );
});

test("a task thread names Task #N, its status and the anchor seq", () => {
  const { agent, channel } = setupAgentAndChannel({ name: "header-task-thread" });
  const anchor = sendAsOwner(channel.id, "please build the widget");
  const task = createTask({ messageId: anchor.id });
  const prompt = buildReplyPrompt({
    agent,
    channel,
    messages: [],
    tasks: [],
    targetId: anchor.id,
    baseSeq: 1,
  });

  assert.match(
    prompt,
    new RegExp(
      `^New activity arrived in the thread of task #${task.number} \\[todo\\] under channel ${channel.name} \\(anchor seq ${anchor.seq}\\):$`,
      "m",
    ),
    "任务线程轮写明 Task #N、状态与锚点 seq",
  );
  assert.match(
    prompt,
    new RegExp(`\\[worksplice:target=${anchor.id} seq=1\\]`),
    "marker 仍指向线程锚点",
  );
});

test("channel, plain thread and task thread revision headers differ", () => {
  const { channel } = setupAgentAndChannel({ name: "header-revision" });
  const plainAnchor = sendAsOwner(channel.id, "side question");
  const taskAnchor = sendAsOwner(channel.id, "please build the widget");
  const task = createTask({ messageId: taskAnchor.id });
  const build = (targetId) =>
    buildRevisionPrompt({
      channel,
      originalContent: "draft",
      held: { roomSeq: 3, whatHappened: "1 new message arrived" },
      newMessages: [],
      targetId,
    });

  assert.match(
    build(channel.id),
    new RegExp(`^Your reply to channel ${channel.name} was held`, "m"),
    "频道轮的 revise 头部与既有文案逐字节一致",
  );
  assert.match(
    build(plainAnchor.id),
    new RegExp(
      `^Your reply to a thread under channel ${channel.name} \\(anchor seq ${plainAnchor.seq}\\) was held`,
      "m",
    ),
  );
  assert.match(
    build(taskAnchor.id),
    new RegExp(
      `^Your reply to the thread of task #${task.number} \\[todo\\] under channel ${channel.name} \\(anchor seq ${taskAnchor.seq}\\) was held`,
      "m",
    ),
  );
});

test("the thread header growth stays within ROUND_INJECTION_BUDGET_CHARS", () => {
  const { agent, channel } = setupAgentAndChannel({ name: "header-budget" });
  const anchor = sendAsOwner(channel.id, "please build the widget");
  createTask({ messageId: anchor.id });
  const messages = Array.from({ length: 60 }, (_, index) => ({
    id: `m${index}`,
    target_id: anchor.id,
    seq: index + 1,
    author_id: OWNER_MEMBER_ID,
    content: `第 ${index} 条 ${"z".repeat(400)}`,
    created_at: "",
    author: { id: OWNER_MEMBER_ID, name: "Owner" },
  }));
  const prompt = buildReplyPrompt({
    agent,
    channel,
    messages,
    tasks: [],
    targetId: anchor.id,
    baseSeq: 60,
  });

  assert.ok(
    prompt.length <= ROUND_INJECTION_BUDGET_CHARS,
    `线程轮注入 ${prompt.length} 应 ≤ ${ROUND_INJECTION_BUDGET_CHARS}`,
  );
  assert.match(prompt, /第 59 条/, "最新一条消息仍在注入里");
});

// ---------------------------------------------------------------------------
// buildRevisionPrompt
// ---------------------------------------------------------------------------

test("B5：revise 轮的注入同样受整轮上界约束（hold 后堆积的新消息不越界）", () => {
  const { channel } = setupAgentAndChannel({ name: "bounded-revise" });
  const newMessages = Array.from({ length: 60 }, (_, index) => ({
    id: `m${index}`,
    target_id: channel.id,
    seq: index + 1,
    author_id: OWNER_MEMBER_ID,
    content: `插进来的第 ${index} 条 ${"z".repeat(400)}`,
    created_at: "",
    author: { id: OWNER_MEMBER_ID, name: "Owner" },
  }));
  const prompt = buildRevisionPrompt({
    channel,
    originalContent: "原稿",
    held: { roomSeq: 60, whatHappened: "60 new message(s) arrived" },
    newMessages,
    targetId: channel.id,
  });
  assert.ok(
    prompt.length <= ROUND_INJECTION_BUDGET_CHARS,
    `revise 注入 ${prompt.length} 应 ≤ ${ROUND_INJECTION_BUDGET_CHARS}`,
  );
  assert.ok(prompt.includes("原稿"), "原稿本身仍在注入中（它是本轮要发的内容）");
  assert.match(prompt, new RegExp(`\\[worksplice:target=${channel.id} seq=60\\]`), "marker 语义不变");
});

test("buildRevisionPrompt summarizes what happened and includes the draft and marker", () => {
  const { channel } = setupAgentAndChannel({ name: "revisee" });
  const prompt = buildRevisionPrompt({
    channel,
    originalContent: "my draft",
    held: { roomSeq: 5, whatHappened: "2 new message(s) arrived (seq 3–4)" },
    newMessages: [
      { id: "m3", target_id: channel.id, seq: 3, author_id: "owner", content: "wait I changed my mind", created_at: "", author: { id: "owner", name: "Owner" } },
    ],
    targetId: channel.id,
  });
  assert.match(prompt, /held/);
  assert.match(prompt, /2 new message/);
  assert.match(prompt, /wait I changed my mind/);
  assert.match(prompt, /my draft/);
  assert.match(prompt, new RegExp(`\\[worksplice:target=${channel.id} seq=5\\]`));
});

test('buildRevisionPrompt includes the DM mention rule after a held reply', () => {
  const agent = createAgent({ name: 'dm-revisee' });
  const channel = createDirectChannel(agent.id);
  const prompt = buildRevisionPrompt({
    channel,
    originalContent: 'my draft',
    held: { roomSeq: 2, whatHappened: 'new messages arrived' },
    newMessages: [],
    targetId: channel.id,
  });

  assert.match(
    prompt,
    /do not @mention other agents in this direct message; refer to their names in plain text instead/i,
  );
});

// ---------------------------------------------------------------------------
// waitForPromptCompletion
// ---------------------------------------------------------------------------

test("waitForPromptCompletion resolves on prompt_done and rejects on prompt_error", async () => {
  const okSession = makeFakeSession();
  const pending = waitForPromptCompletion(okSession);
  okSession.emit({ type: "prompt_done" });
  assert.deepEqual(await pending, { ok: true });

  const errSession = makeFakeSession();
  const errPending = waitForPromptCompletion(errSession);
  errSession.emit({ type: "prompt_error", errorMessage: "no api key" });
  assert.deepEqual(await errPending, { ok: false, error: "no api key" });
});

// ---------------------------------------------------------------------------
// runAgentRound: drain → decide → act → reply → ack
// ---------------------------------------------------------------------------

test("a human message triggers drain → prompt → reply landed in SQLite; cursor advanced; status working→online", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "happy" });
  sendAsOwner(channel.id, "hello agent");

  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: '{"action":"reply","content":"hello human","onConflict":"revise"}' }] },
  });
  activeRuntime = runtime;

  const statuses = [];
  const unsub = subscribeAgentStatuses((snapshot) => statuses.push(snapshot[agent.id]));
  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  unsub();

  assert.equal(outcome.status, "replied");
  const db = globalThis.__workspliceDb;
  const messages = db.listMessages(channel.id);
  assert.equal(messages.length, 2);
  assert.equal(messages[1].seq, 2);
  assert.equal(messages[1].author_id, agent.id);
  assert.equal(messages[1].content, "hello human");
  assert.equal(db.getConsumedSeq(agent.id, channel.id), 1);
  assert.equal(getAgent(agent.id).status, "online");
  assert.ok(statuses.includes("working"), `expected working in ${JSON.stringify(statuses)}`);
  assert.equal(statuses[statuses.length - 1], "online");

  const session = runtime.sessions.get(agent.id);
  assert.equal(session.prompts.length, 1);
  assert.match(session.prompts[0], /hello agent/);
});

test("an empty drain is a noop without prompting", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "empty" });
  const runtime = makeFakeRuntime();
  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "noop");
  assert.equal(runtime.sessions.get(agent.id)?.prompts.length ?? 0, 0);
});

test("only the agent's own unconsumed messages: ack without prompting", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "selfy" });
  sendAsOwner(channel.id, "human first");
  ack(agent.id, channel.id, 1);
  const reply = sendMessage({ targetId: channel.id, authorId: agent.id, content: "my own reply" });
  assert.equal(reply.held, false);

  const runtime = makeFakeRuntime();
  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "noop");
  assert.equal(outcome.reason, "only the agent's own messages");
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 2);
  assert.equal(runtime.sessions.get(agent.id)?.prompts.length ?? 0, 0);
});

test("a reminder-driven round processes the agent's own system reminder (reason=reminder)", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "reminded" });
  // §3.9 系统提醒消息以作者署名投递：drain 里全是自己的消息
  const reminder = sendMessage({
    targetId: channel.id,
    authorId: agent.id,
    content: "⏰ Reminder: check the build",
  });
  assert.equal(reminder.held, false);

  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: '{"action":"reply","content":"on it","onConflict":"revise"}' }] },
  });
  // 同样的"只有自己的消息"在 message wake 下会 noop（见上面的 selfy 用例），
  // reminder 驱动则必须走到 decide——agent 要看到自己的提醒并行动
  const outcome = await runAgentRound(agent.id, channel.id, runtime, "reminder");
  assert.equal(outcome.status, "replied");
  const session = runtime.sessions.get(agent.id);
  assert.ok(session.prompts[0].includes("⏰ Reminder: check the build"));
  const messages = globalThis.__workspliceDb.listMessages(channel.id);
  assert.equal(messages[messages.length - 1].content, "on it");
  // 游标推进到本轮读到的最新版本（自己的回复不消费，等待他人消息/下次提醒）
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 1);
});

test("the latest message being the agent's own skips prompting (crash 后已回复窗口)", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "replied" });
  sendAsOwner(channel.id, "todo?");
  sendMessage({ targetId: channel.id, authorId: agent.id, content: "on it" });

  const runtime = makeFakeRuntime();
  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.reason, "already replied to the latest message");
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 2);
  assert.equal(runtime.sessions.get(agent.id)?.prompts.length ?? 0, 0);
});

test("家目录派生绑定（存 NULL）的 agent 照常推进本轮；非成员仍跳过且不提示", async () => {
  // NULL 不再是「没有工作区」：读侧按当前数据目录重推家目录（ADR-0001），本轮必须照常推进
  const homeBound = createAgent({ name: "homebound" });
  globalThis.__workspliceDb.setMemberWorkspace(homeBound.id, null, null);
  const homeChannel = createChannel({ name: "home-bound-room" });
  joinChannel(homeChannel.id, homeBound.id);
  sendAsOwner(homeChannel.id, "please work");
  const runtime = makeFakeRuntime({
    repliesByAgent: { [homeBound.id]: [{ text: '{"action":"reply","content":"done"}' }] },
  });
  const homeOutcome = await runAgentRound(homeBound.id, homeChannel.id, runtime);
  assert.equal(homeOutcome.status, "replied");

  const { agent, channel } = setupAgentAndChannel({ name: "outsider", join: false });
  sendAsOwner(channel.id, "private stuff");
  const outsiderOutcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outsiderOutcome.status, "skipped");
  assert.equal(outsiderOutcome.reason, "not a member of the channel");
});

test("a session error marks the agent error and does not advance the cursor", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "crasher" });
  sendAsOwner(channel.id, "please work");
  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ error: "no api key configured" }] },
  });

  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "error");
  assert.equal(getAgent(agent.id).status, "error");
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0);
});

test("an ignore action posts nothing but still advances the cursor", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "ignorer" });
  sendAsOwner(channel.id, "noted?");
  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: '{"action":"ignore"}' }] },
  });

  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "ignored");
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 1);
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 1);
});

test("a model failure that resolves with empty text (SDK 402) errors without advancing the cursor", async () => {
  // pi SDK 对 API 报错（如 openrouter 402 余额不足）不 reject prompt()：
  // 错误写进 jsonl，事件流只发 prompt_done，get_last_assistant_text 为空。
  // 这类轮次必须按失败处理（不 ack），否则消息被静默消费、agent 永不回复。
  const { agent, channel } = setupAgentAndChannel({ name: "broker" });
  sendAsOwner(channel.id, "please reply");
  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: "" }] },
  });

  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "error");
  assert.equal(getAgent(agent.id).status, "error");
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 1);
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0);
  assert.equal(
    outcome.reason,
    "model returned no text (request failed?)",
    "拿不到细节（fake/老会话）时回落既有通用文案",
  );
});

test("an empty-text failure carries the real model error into round_logs.reason (D1)", async () => {
  // D1：SDK 对模型/API 报错不 reject prompt()——事件流照发 prompt_done、get_last_assistant_text
  // 为空，真实原因只落在末条 assistant message 的 stopReason/errorMessage 上（jsonl 同源，
  // 实测 new-api 429 FreeUsageLimitError）。可观测面板要看见「agent 为什么失败」，
  // round_logs.reason 必须带出这段文本；拿不到时才回落通用文案。
  const { agent, channel } = setupAgentAndChannel({ name: "rate-limited" });
  sendAsOwner(channel.id, "please reply");
  const providerError =
    '429: {"message":"Rate limit exceeded. Please try again later.","type":"FreeUsageLimitError","param":"","code":null}';
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        { text: "", errorDetail: { stopReason: "error", errorMessage: providerError } },
      ],
    },
  });

  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "error");
  assert.match(outcome.reason, /Rate limit exceeded/);
  assert.ok(
    outcome.reason.startsWith("model error: "),
    "本轮 reason 以 model error: 开头（driver 原样写入 round_logs.reason）",
  );
  assert.ok(outcome.reason.includes(providerError), "完整错误文本不截断");
  assert.equal(getAgent(agent.id).status, "error");
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0, "游标不推进，下次 wake 重试");
});

test("a late agent_end does not wipe the error status of an empty-text failure", async () => {
  // 真实 SDK 在模型/API 失败时仍发 agent_end；收尾事件不得把 error 状态洗回 online
  const { agent, channel } = setupAgentAndChannel({ name: "late-end" });
  sendAsOwner(channel.id, "please reply");
  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: "" }] },
  });

  await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(getAgent(agent.id).status, "error");
});

test("a reply action with empty content (degenerate JSON) errors without advancing the cursor", async () => {
  // 模型退化：{\"action\":\"reply\"} 无 content——声明了 reply 却给不出文本，与空文本同语义：
  // 本轮失败、不 ack，触发消息保持 pending 供下次 wake 重试（否则被静默消费）
  const { agent, channel } = setupAgentAndChannel({ name: "empty-reply" });
  sendAsOwner(channel.id, "please reply");
  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: '{"action":"reply"}' }] },
  });

  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "error");
  assert.equal(getAgent(agent.id).status, "error");
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 1);
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0);
});

test("a prompt failure is an error round carrying the drained room version (11)", async () => {
  // 11-整改：prompt-fail（模型/API 报错，如 402）的 error 轮携带本轮 drain 的房间版本，
  // 可观测页 round_logs base_seq 非 0（07 承诺：每轮 status/reason/target/#baseSeq/时间）
  const { agent, channel } = setupAgentAndChannel({ name: "prompt-fail" });
  sendAsOwner(channel.id, "hello");
  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ error: "model 402" }] },
  });

  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "error");
  assert.equal(outcome.reason, "model 402");
  assert.equal(outcome.baseSeq, 1, "prompt-fail 的 error 轮携带本轮 drain 的房间版本");
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0);
});

test("a thrown round error is an error round carrying the drained room version (11)", async () => {
  // 11-整改：catch 分支（prompt 收口后读 last text 抛错等）的 error 轮同样携带 baseSeq
  const { agent, channel } = setupAgentAndChannel({ name: "thrown-error" });
  sendAsOwner(channel.id, "hello");
  const runtime = makeFakeRuntime({ prestarted: [agent.id] });
  const session = runtime.sessions.get(agent.id);
  const original = session.send.bind(session);
  session.send = async (command) => {
    if (command.type === "get_last_assistant_text") throw new Error("last text read failed");
    return original(command);
  };

  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "error");
  assert.equal(outcome.reason, "last text read failed");
  assert.equal(outcome.baseSeq, 1, "catch 的 error 轮携带本轮 drain 的房间版本");
  assert.equal(getAgent(agent.id).status, "error");
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0);
});

test("a revised empty reply is an error round: no ack, error status point, pending retry (11)", async () => {
  // 11-整改：freshness-hold 后重写也退化（reply 无内容）= error 轮——不推进游标（被 hold 的
  // 消息保持 pending 供下次 wake 重试）、error 状态点；与直接空 reply 路径归类一致
  const { agent, channel } = setupAgentAndChannel({ name: "revise-empty-round" });
  sendAsOwner(channel.id, "original ask"); // seq 1
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        { text: '{"action":"reply","content":"draft","onConflict":"revise"}' },
        { text: '{"action":"reply","content":""}' },
      ],
    },
  });
  const outcomePromise = runAgentRound(agent.id, channel.id, runtime);
  // drain 已取到 seq 1（baseSeq=1）；写稿期间房间又来了新消息 → 回复被 hold
  sendAsOwner(channel.id, "changed my mind"); // seq 2
  const outcome = await outcomePromise;

  assert.equal(outcome.status, "error");
  assert.equal(outcome.reason, "revised reply had no content");
  assert.equal(outcome.baseSeq, 1, "error 轮携带本轮 drain 的房间版本（held 的新消息未 ack、保持 pending）");
  assert.equal(getAgent(agent.id).status, "error");
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 2, "无回复落库");
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0, "游标不推进——消息保持 pending 供下次 wake 重试");
});

test("an explicit ignore with a pending trigger still advances the cursor (legitimate protocol choice)", async () => {
  // 区分"正常协议选择"与"误判"：无确定信号（未 @mention、非任务 owner 线程）时的显式 ignore
  // 是模型的有意决定，游标照常推进；只有声明 reply 却无内容、或确定信号下 ignore 才按失败处理
  const { agent, channel } = setupAgentAndChannel({ name: "legit-ignore" });
  sendAsOwner(channel.id, "maybe reply");
  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: '{"action":"ignore"}' }] },
  });

  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "ignored");
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 1);
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 1);
});

test("a non-JSON reply is sent as-is (whole text)", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "plain" });
  sendAsOwner(channel.id, "how are you?");
  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: "I am well, thanks." }] },
  });

  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "replied");
  const messages = globalThis.__workspliceDb.listMessages(channel.id);
  assert.equal(messages[messages.length - 1].content, "I am well, thanks.");
});

// ---------------------------------------------------------------------------
// deliverWithFreshness：held 后四选一
// ---------------------------------------------------------------------------

test("retry budgets are pinned to the literals 1 / 1 / 2", () => {
  // 直接断言字面量（不与另一个导出常量互比）：常量被人改成 2/2/3 时这里必须红。
  assert.equal(MAX_REVISE_RETRIES, 1);
  assert.equal(MAX_RESEND_RETRIES, 1);
  // task status 的 held 重试在同一次同步循环内完成（每次以最新 roomSeq 重试），
  // 单进程里无法在两次尝试之间插入新消息，故耗尽路径没有可观测的行为面；
  // 数量由这里的字面量钉住，成功重试语义由 loop-tasks 的 complete 用例覆盖。
  assert.equal(MAX_TASK_STATUS_RETRIES, 2);
});

const HELD = { held: true, roomSeq: 3, whatHappened: "2 new message(s) arrived in this target (seq 2–3)" };

function scriptedSender(results) {
  const calls = [];
  let i = 0;
  const send = (opts) => {
    calls.push(opts);
    const result = results[Math.min(i++, results.length - 1)];
    return result === HELD ? { ...HELD } : result;
  };
  return { send, calls };
}

function baseAgent(id = "agent-x") {
  return { id, type: "agent", name: "x", description: "", role: "member", workspace_path: "/tmp/w", pi_session_file: null, status: "online", deleted: 0, created_at: "" };
}

test("held + revise: re-prompts with the new message content and delivers the rewritten reply", async () => {
  const { channel } = setupAgentAndChannel({ name: "revise-room" });
  sendAsOwner(channel.id, "original ask");   // seq 1
  sendAsOwner(channel.id, "changed my mind"); // seq 2（写稿期间到达）
  const { send, calls } = scriptedSender([HELD, { held: false, message: { id: "m-final" } }]);
  const revised = '{"action":"reply","content":"rewritten","onConflict":"silent"}';
  const promptFn = async (promptText) => {
    assert.match(promptText, /2 new message/);
    assert.match(promptText, /changed my mind/);
    assert.match(promptText, /my draft/);
    return revised;
  };
  const outcome = await deliverWithFreshness({
    targetId: channel.id,
    agent: baseAgent(),
    channel,
    action: { action: "reply", content: "my draft", onConflict: "revise" },
    baseSeq: 1,
    promptFn,
    send,
  });
  assert.equal(outcome.status, "replied");
  assert.equal(outcome.message.id, "m-final");
  assert.equal(outcome.ackSeq, 3, "held 后游标推进到 roomSeq");
  assert.equal(calls[1].content, "rewritten");
  assert.equal(calls[1].baseSeq, 3);
});

test("held + resend: retries with the fresh room version without re-prompting", async () => {
  const { channel } = setupAgentAndChannel({ name: "resend-room" });
  const { send, calls } = scriptedSender([HELD, { held: false, message: { id: "m" } }]);
  const outcome = await deliverWithFreshness({
    targetId: channel.id,
    agent: baseAgent(),
    channel,
    action: { action: "reply", content: "draft", onConflict: "resend" },
    baseSeq: 1,
    promptFn: async () => {
      throw new Error("must not re-prompt");
    },
    send,
  });
  assert.equal(outcome.status, "replied");
  assert.equal(outcome.ackSeq, 3, "resend 后游标推进到 roomSeq");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].baseSeq, 3);
  assert.equal(calls[1].content, "draft");
});

test("held + silent: drops the reply entirely", async () => {
  const { channel } = setupAgentAndChannel({ name: "silent-room" });
  const { send, calls } = scriptedSender([HELD]);
  const outcome = await deliverWithFreshness({
    targetId: channel.id,
    agent: baseAgent(),
    channel,
    action: { action: "reply", content: "draft", onConflict: "silent" },
    baseSeq: 1,
    promptFn: async () => "",
    send,
  });
  assert.equal(outcome.status, "silent");
  assert.equal(outcome.ackSeq, 3, "silent 也在被告知房间变化后推进游标");
  assert.equal(calls.length, 1);
});

test("held + anyway: the escape hatch sends without the freshness check", async () => {
  const { channel } = setupAgentAndChannel({ name: "anyway-room" });
  const { send, calls } = scriptedSender([HELD, { held: false, message: { id: "m" } }]);
  const outcome = await deliverWithFreshness({
    targetId: channel.id,
    agent: baseAgent(),
    channel,
    action: { action: "reply", content: "draft", onConflict: "anyway" },
    baseSeq: 1,
    promptFn: async () => "",
    send,
  });
  assert.equal(outcome.status, "anyway");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].baseSeq, undefined);
  assert.equal(calls[1].content, "draft");
});

test("revise retries are capped, then the reply is dropped", async () => {
  const { channel } = setupAgentAndChannel({ name: "revise-exhaust" });
  const { send, calls } = scriptedSender([HELD]);
  let promptCalls = 0;
  const outcome = await deliverWithFreshness({
    targetId: channel.id,
    agent: baseAgent(),
    channel,
    action: { action: "reply", content: "draft", onConflict: "revise" },
    baseSeq: 1,
    promptFn: async () => {
      promptCalls += 1;
      return '{"action":"reply","content":"again","onConflict":"revise"}';
    },
    send,
  });
  assert.equal(outcome.status, "silent");
  assert.equal(outcome.reason, "revise retries exhausted");
  assert.equal(promptCalls, 1, "显式 revise 只重写一次（字面量）");
  assert.equal(calls.length, 2, "首发 + 1 次重写 = 2 次 send（字面量）");
});

test("resend retries are capped, then the reply is dropped", async () => {
  const { channel } = setupAgentAndChannel({ name: "resend-exhaust" });
  const { send, calls } = scriptedSender([HELD]);
  const outcome = await deliverWithFreshness({
    targetId: channel.id,
    agent: baseAgent(),
    channel,
    action: { action: "reply", content: "draft", onConflict: "resend" },
    baseSeq: 1,
    promptFn: async () => "",
    send,
  });
  assert.equal(outcome.status, "silent");
  assert.equal(outcome.reason, "resend retries exhausted");
  assert.equal(outcome.ackSeq, 3);
  assert.equal(calls.length, 2, "首发 + 1 次原样重试 = 2 次 send（字面量）");
});

test("the default conflict choice resends the draft once, then goes silent", async () => {
  // 默认 onConflict=resend 的端到端语义：held 后原样重试一次，再 held 就 silent；
  // 不再走 revise（不重写、不再多烧一轮 prompt）。
  const { channel } = setupAgentAndChannel({ name: "default-resend" });
  const action = parseAgentAction('{"action":"reply","content":"draft"}');
  assert.equal(action.onConflict, "resend");
  const { send, calls } = scriptedSender([HELD]);
  const outcome = await deliverWithFreshness({
    targetId: channel.id,
    agent: baseAgent(),
    channel,
    action,
    baseSeq: 1,
    promptFn: async () => {
      throw new Error("default resend must not re-prompt");
    },
    send,
  });
  assert.equal(outcome.status, "silent");
  assert.equal(outcome.reason, "resend retries exhausted");
  assert.equal(outcome.ackSeq, 3, "held 后游标推进到 roomSeq");
  assert.equal(calls.length, 2, "首发 + 1 次原样重试");
  assert.equal(calls[1].content, "draft", "原样重试：内容不改写");
  assert.equal(calls[1].baseSeq, 3);
});

test("a revised-to-ignore reply is dropped", async () => {
  const { channel } = setupAgentAndChannel({ name: "revise-ignore" });
  const { send } = scriptedSender([HELD]);
  const outcome = await deliverWithFreshness({
    targetId: channel.id,
    agent: baseAgent(),
    channel,
    action: { action: "reply", content: "draft", onConflict: "revise" },
    baseSeq: 1,
    promptFn: async () => '{"action":"ignore"}',
    send,
  });
  assert.equal(outcome.status, "silent");
  assert.equal(outcome.reason, "revised to ignore");
});

test("a revised-to-conclude reply is dropped without becoming an error", async () => {
  // held 后模型改判收束：与 revised-to-ignore 同归类（ackSeq 已推进、真正终止），
  // 不得落到「reply 无内容」的 error 轮。
  const { channel } = setupAgentAndChannel({ name: "revise-conclude" });
  const { send, calls } = scriptedSender([HELD]);
  const outcome = await deliverWithFreshness({
    targetId: channel.id,
    agent: baseAgent(),
    channel,
    action: { action: "reply", content: "draft", onConflict: "revise" },
    baseSeq: 1,
    promptFn: async () => '{"action":"conclude","reason":"settled"}',
    send,
  });
  assert.equal(outcome.status, "silent");
  assert.equal(outcome.reason, "revised to conclude");
  assert.equal(outcome.ackSeq, 3, "held 后游标推进到 roomSeq");
  assert.equal(calls.length, 1, "conclude 不再发帖");
});

test("a revised reply with no content is an error round, not silent (11)", async () => {
  // 11-整改：重写也退化（reply 无内容）与直接空 reply 路径归类一致 = error 轮——
  // 不推进游标（ackSeq 停在本轮已读版本）、会被 runAgentRound 标 error 状态点并重试；
  // 不再是 silent（silent 会被 isAbandonedRound 标成「已放弃」badge，但实际会重试——badge 说谎）
  const { channel } = setupAgentAndChannel({ name: "revise-empty" });
  const { send, calls } = scriptedSender([HELD]);
  const outcome = await deliverWithFreshness({
    targetId: channel.id,
    agent: baseAgent(),
    channel,
    action: { action: "reply", content: "draft", onConflict: "revise" },
    baseSeq: 1,
    promptFn: async () => '{"action":"reply","content":""}',
    send,
  });
  assert.equal(outcome.status, "error");
  assert.equal(outcome.reason, "revised reply had no content");
  assert.equal(outcome.ackSeq, 1, "error 轮不推进游标——被 hold 的消息保持 pending 供下次 wake 重试");
  assert.equal(calls.length, 1);
});

// ---------------------------------------------------------------------------
// hold 重路由（thread-routing：hold 期间到达的任务创建事件，重发前重新裁决）
// ---------------------------------------------------------------------------

const REROUTE = { taskNumber: 1, eventSeq: 2, mode: "claim" };

test("held + resend: a reroute decision suppresses the second channel send and reports the held roomSeq", async () => {
  const { channel } = setupAgentAndChannel({ name: "reroute-resend" });
  sendAsOwner(channel.id, "please build the widget"); // seq 1
  sendAsOwner(channel.id, "Task #1 created"); // seq 2（写稿期间到达）
  const { send, calls } = scriptedSender([HELD, { held: false, message: { id: "m-second" } }]);
  const seen = [];
  const outcome = await deliverWithFreshness({
    targetId: channel.id,
    agent: baseAgent(),
    channel,
    action: { action: "reply", content: "draft", onConflict: "resend" },
    baseSeq: 1,
    promptFn: async () => {
      throw new Error("must not re-prompt");
    },
    send,
    resolveHeldRoute: (ctx) => {
      seen.push(ctx);
      return REROUTE;
    },
  });
  assert.equal(outcome.status, "reroute");
  assert.deepEqual(outcome.route, REROUTE);
  assert.equal(outcome.action.content, "draft");
  assert.equal(outcome.ackSeq, 3, "ackSeq 是 held 的 roomSeq（频道版本）");
  assert.equal(calls.length, 1, "裁决命中后不得再向频道发第二次");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].heldRoomSeq, 3);
  assert.equal(seen[0].action.content, "draft");
  assert.deepEqual(
    seen[0].newMessages.map((m) => m.seq),
    [2],
    "重跑裁决的输入 = 写稿版本之后的新消息",
  );
});

test("held + revise: the resolver receives the rewritten content, not the draft", async () => {
  const { channel } = setupAgentAndChannel({ name: "reroute-revise" });
  sendAsOwner(channel.id, "please build the widget"); // seq 1
  sendAsOwner(channel.id, "Task #1 created"); // seq 2
  const { send, calls } = scriptedSender([HELD]);
  const seen = [];
  const outcome = await deliverWithFreshness({
    targetId: channel.id,
    agent: baseAgent(),
    channel,
    action: { action: "reply", content: "draft", onConflict: "revise" },
    baseSeq: 1,
    promptFn: async () => '{"action":"reply","content":"rewritten","onConflict":"silent"}',
    send,
    resolveHeldRoute: (ctx) => {
      seen.push(ctx);
      return REROUTE;
    },
  });
  assert.equal(outcome.status, "reroute");
  assert.equal(outcome.action.content, "rewritten");
  assert.equal(outcome.ackSeq, 3);
  assert.equal(calls.length, 1, "重写稿不再向频道发第二次");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].action.content, "rewritten", "裁决看的是重写稿内容");
});

test("held + revise to ignore/conclude/empty content never consults the resolver", async () => {
  const cases = [
    ['{"action":"ignore"}', "silent", "revised to ignore", 3],
    ['{"action":"conclude","reason":"settled"}', "silent", "revised to conclude", 3],
    ['{"action":"reply","content":""}', "error", "revised reply had no content", 1],
  ];
  for (const [index, [reply, status, reason, ackSeq]] of cases.entries()) {
    const { channel } = setupAgentAndChannel({ name: `reroute-degenerate-${index}` });
    const { send } = scriptedSender([HELD]);
    let resolverCalls = 0;
    const outcome = await deliverWithFreshness({
      targetId: channel.id,
      agent: baseAgent(),
      channel,
      action: { action: "reply", content: "draft", onConflict: "revise" },
      baseSeq: 1,
      promptFn: async () => reply,
      send,
      resolveHeldRoute: () => {
        resolverCalls += 1;
        return REROUTE;
      },
    });
    assert.equal(outcome.status, status, reason);
    assert.equal(outcome.reason, reason);
    assert.equal(outcome.ackSeq, ackSeq);
    assert.equal(resolverCalls, 0, "退化重写不进入路由裁决");
  }
});

test("held + silent/anyway never consult the resolver", async () => {
  for (const choice of ["silent", "anyway"]) {
    const { channel } = setupAgentAndChannel({ name: `reroute-${choice}` });
    const { send } = scriptedSender([HELD, { held: false, message: { id: "m" } }]);
    let resolverCalls = 0;
    const outcome = await deliverWithFreshness({
      targetId: channel.id,
      agent: baseAgent(),
      channel,
      action: { action: "reply", content: "draft", onConflict: choice },
      baseSeq: 1,
      promptFn: async () => "",
      send,
      resolveHeldRoute: () => {
        resolverCalls += 1;
        return REROUTE;
      },
    });
    assert.equal(resolverCalls, 0, `${choice} 不进入路由裁决`);
    assert.equal(outcome.status, choice);
  }
});

test("a null reroute decision keeps the existing resend handling on the channel", async () => {
  const { channel } = setupAgentAndChannel({ name: "reroute-null-resend" });
  const { send, calls } = scriptedSender([HELD, { held: false, message: { id: "m" } }]);
  let resolverCalls = 0;
  const outcome = await deliverWithFreshness({
    targetId: channel.id,
    agent: baseAgent(),
    channel,
    action: { action: "reply", content: "draft", onConflict: "resend" },
    baseSeq: 1,
    promptFn: async () => {
      throw new Error("must not re-prompt");
    },
    send,
    resolveHeldRoute: () => {
      resolverCalls += 1;
      return null;
    },
  });
  assert.equal(resolverCalls, 1);
  assert.equal(outcome.status, "replied");
  assert.equal(calls.length, 2, "未命中裁决时保持既有 resend 行为");
  assert.equal(calls[1].targetId, channel.id);
  assert.equal(calls[1].baseSeq, 3);
  assert.equal(calls[1].content, "draft");
});

test("a null reroute decision keeps the existing revise handling on the channel", async () => {
  const { channel } = setupAgentAndChannel({ name: "reroute-null-revise" });
  const { send, calls } = scriptedSender([HELD, { held: false, message: { id: "m-final" } }]);
  const outcome = await deliverWithFreshness({
    targetId: channel.id,
    agent: baseAgent(),
    channel,
    action: { action: "reply", content: "draft", onConflict: "revise" },
    baseSeq: 1,
    promptFn: async () => '{"action":"reply","content":"rewritten","onConflict":"silent"}',
    send,
    resolveHeldRoute: () => null,
  });
  assert.equal(outcome.status, "replied");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].targetId, channel.id);
  assert.equal(calls[1].content, "rewritten");
  assert.equal(calls[1].baseSeq, 3);
});

test("a creation event landing after the first hold reroutes on the second hold even with the budget exhausted", async () => {
  // 第一次 hold 时房间里还没有创建事件，第二次 hold 前才到达：裁决必须先于预算判断，
  // 否则事件会被 "resend/revise retries exhausted" 吞掉。
  for (const choice of ["resend", "revise"]) {
    const { channel } = setupAgentAndChannel({ name: `reroute-late-${choice}` });
    sendAsOwner(channel.id, "please build the widget"); // seq 1
    const calls = [];
    let sendCount = 0;
    const send = (opts) => {
      calls.push(opts);
      sendCount += 1;
      if (sendCount === 2) sendAsOwner(channel.id, "Task #1 created"); // seq 2
      return { held: true, roomSeq: 1 + sendCount, whatHappened: "room moved" };
    };
    const resolverSizes = [];
    const outcome = await deliverWithFreshness({
      targetId: channel.id,
      agent: baseAgent(),
      channel,
      action: { action: "reply", content: "draft", onConflict: choice },
      baseSeq: 1,
      promptFn: async () => '{"action":"reply","content":"rewritten","onConflict":"revise"}',
      send,
      resolveHeldRoute: (ctx) => {
        resolverSizes.push(ctx.newMessages.length);
        return ctx.newMessages.some((m) => /Task #1 created/.test(m.content))
          ? REROUTE
          : null;
      },
    });
    assert.equal(outcome.status, "reroute", `${choice}: 第二次 hold 命中创建事件`);
    assert.equal(calls.length, 2);
    assert.deepEqual(resolverSizes, [0, 1], `${choice}: 第一次裁决没看到事件，第二次看到`);
    assert.equal(outcome.ackSeq, 3, "ackSeq = 第二次 held 的 roomSeq");
  }
});

test("thread targets never consult the resolver", async () => {
  const { channel } = setupAgentAndChannel({ name: "reroute-thread-target" });
  const anchor = sendAsOwner(channel.id, "task anchor");
  const { send, calls } = scriptedSender([HELD, { held: false, message: { id: "m" } }]);
  let resolverCalls = 0;
  const outcome = await deliverWithFreshness({
    targetId: anchor.id,
    agent: baseAgent(),
    channel,
    action: { action: "reply", content: "draft", onConflict: "resend" },
    baseSeq: 0,
    promptFn: async () => "",
    send,
    resolveHeldRoute: () => {
      resolverCalls += 1;
      return REROUTE;
    },
  });
  assert.equal(resolverCalls, 0, "线程 hold 永不重路由回频道/别的任务");
  assert.equal(outcome.status, "replied");
  assert.equal(calls.length, 2);
});

test("the reroute outcome's ackSeq is the held roomSeq, never a thread seq", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "reroute-ackseq" });
  const anchor = sendAsOwner(channel.id, "please build the widget"); // seq 1
  // 线程里已有若干条自己的历史消息，seq 空间独立（1..2）
  sendMessage({ targetId: anchor.id, authorId: agent.id, content: "own progress 1" });
  sendMessage({ targetId: anchor.id, authorId: agent.id, content: "own progress 2" });
  const { send } = scriptedSender([HELD]);
  const outcome = await deliverWithFreshness({
    targetId: channel.id,
    agent,
    channel,
    action: { action: "reply", content: "draft", onConflict: "resend" },
    baseSeq: 1,
    promptFn: async () => "",
    send,
    resolveHeldRoute: () => ({ taskNumber: 1, eventSeq: 2, mode: "claim" }),
  });
  assert.equal(outcome.status, "reroute");
  assert.equal(outcome.ackSeq, 3, "ackSeq 取频道 held roomSeq");
  assert.ok(
    !globalThis.__workspliceDb.listMessages(anchor.id).some((m) => m.seq === outcome.ackSeq),
    "ackSeq 不是任何线程 seq",
  );
});

test("a busy session reports busy without prompting", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "busy" });
  sendAsOwner(channel.id, "while you are busy");
  const runtime = makeFakeRuntime({ prestarted: [agent.id] });
  const session = runtime.sessions.get(agent.id);
  session.isRunning = () => true;
  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "busy");
  assert.equal(session.prompts.length, 0);
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0);
});

test("a non-member agent mentioned in a public channel runs the round and auto-joins to reply", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "mentionee", join: false });
  assert.equal(globalThis.__workspliceDb.isChannelMember(channel.id, agent.id), false);
  sendAsOwner(channel.id, "hey @mentionee your input needed");

  const runtime = makeFakeRuntime({ repliesByAgent: { [agent.id]: [{ text: '{"action":"reply","content":"joining in!"}' }] } });
  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "replied");

  // 注意力信号语义：agent 自行加入公开 channel 后回复落库
  assert.equal(globalThis.__workspliceDb.isChannelMember(channel.id, agent.id), true);
  const messages = globalThis.__workspliceDb.listMessages(channel.id);
  assert.equal(messages[messages.length - 1].content, "joining in!");
  // 游标推进到本轮读到的最新版本（自己的回复不消费，等待他人消息）
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 1);
});

test("a non-member agent mentioned in a private channel reads but cannot reply", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-loop-ws-"));
  const agent = createAgent({ name: "privacy" , workspacePath: ws });
  const channel = createChannel({ name: "private-mention", type: "private" });
  joinChannel(channel.id, agent.id, OWNER_MEMBER_ID);
  // 移出成员，模拟"未加入但被 @mention"（mention 穿透）
  globalThis.__workspliceDb.removeChannelMember(channel.id, agent.id);
  sendAsOwner(channel.id, "hey @privacy confidential thing");

  const runtime = makeFakeRuntime({ repliesByAgent: { [agent.id]: [{ text: '{"action":"reply","content":"I will reply"}' }] } });
  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "silent");
  assert.equal(outcome.reason, "not a member of the private channel");
  assert.equal(globalThis.__workspliceDb.isChannelMember(channel.id, agent.id), false);
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 1, "no reply was posted");
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 1);
});

test("an ignore on a personal mention is a must-respond failure: error, no ack, no join", async () => {
  // §05 兜底：人类（Owner）的 @mention 是确定信号，ignore 不合法——本轮失败（error 状态点可见、
  // 游标不推进、触发消息保持 pending），非成员也不会因"已回应"而加入频道
  const { agent, channel } = setupAgentAndChannel({ name: "mentionee-ignore", join: false });
  sendAsOwner(channel.id, "hey @mentionee-ignore look here");

  const runtime = makeFakeRuntime({ repliesByAgent: { [agent.id]: [{ text: '{"action":"ignore"}' }] } });
  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "error");
  assert.equal(getAgent(agent.id).status, "error");
  assert.equal(globalThis.__workspliceDb.isChannelMember(channel.id, agent.id), false);
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0);
});

test("a conclude on a personal mention yields silently: acked, online, no message", async () => {
  // conclude = 确认收到但不发帖：确定信号下也走收束，不进入 ignore 的 error / cap-ack 路径。
  const { agent, channel } = setupAgentAndChannel({ name: "mentionee-conclude", join: false });
  sendAsOwner(channel.id, "hey @mentionee-conclude closing confirmation");

  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [{ text: '{"action":"conclude","reason":"thread concluded"}' }],
    },
  });
  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(outcome.status, "yielded");
  assert.equal(outcome.reason, "concluded: thread concluded");
  assert.equal(outcome.baseSeq, 1);
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 1, "messages 表零新增");
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 1, "游标推进到本轮房间版本");
  assert.equal(getAgent(agent.id).status, "online");
  assert.equal(
    globalThis.__workspliceDb.isChannelMember(channel.id, agent.id),
    false,
    "收束不是加入频道",
  );

  const again = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(again.status, "noop", "ack 后再次 drain 为空");
  assert.equal(again.baseSeq, 1);
});

test("a conclude without a reason reports the default concluded reason", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "conclude-noreason" });
  sendAsOwner(channel.id, "just checking in");

  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: '{"action":"conclude"}' }] },
  });
  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(outcome.status, "yielded");
  assert.equal(outcome.reason, "concluded by agent");
  assert.equal(globalThis.__workspliceDb.listMessages(channel.id).length, 1);
});

test("an ignore on the same settled mention is still an error", async () => {
  // 同一场景的对照组：conclude 合法，不代表 ignore 在确定信号下被放宽。
  const { agent, channel } = setupAgentAndChannel({ name: "mentionee-ignore-still", join: false });
  sendAsOwner(channel.id, "hey @mentionee-ignore-still closing confirmation");

  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: '{"action":"ignore"}' }] },
  });
  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(outcome.status, "error");
  assert.equal(outcome.reason, "ignore on must-respond signal");
  assert.equal(getAgent(agent.id).status, "error");
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0);
});

test("a conclude clears the must-respond streak so a later ignore is only the first failure", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "conclude-reset" });
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        { text: '{"action":"ignore"}' },
        { text: '{"action":"conclude","reason":"ack"}' },
        { text: '{"action":"ignore"}' },
      ],
    },
  });

  sendAsOwner(channel.id, "hey @conclude-reset first");
  const first = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(first.status, "error", "失败 #1：streak = 1");
  assert.equal(first.reason, "ignore on must-respond signal");

  sendAsOwner(channel.id, "hey @conclude-reset closing note");
  const second = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(second.status, "yielded");
  assert.equal(second.reason, "concluded: ack");
  assert.equal(getAgent(agent.id).status, "online");
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 2);

  sendAsOwner(channel.id, "hey @conclude-reset one more");
  const third = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(third.status, "error");
  assert.equal(third.reason, "ignore on must-respond signal", "streak 已清零，只记一次失败");
  assert.doesNotMatch(third.reason, /capped/);
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 2);
});

test("an agent-authored @mention is not a must-respond signal: ignore is a normal ignored round", async () => {
  // 2026-10-20 现场回归：peer agent 在收口消息里 @ 了本 agent——agent 的 @ 只是注意力信号。
  // ignore 应落既有 ignored 分支：游标推进、状态点保持 online，不该逼出空回复或点红灯。
  const { agent, channel } = setupAgentAndChannel({ name: "peer-mentioned" });
  const peer = joinPeer(channel, {
    name: "peer-messenger",
    wsPrefix: "worksplice-peer-ws-",
  });
  sendMessage({
    targetId: channel.id,
    authorId: peer.id,
    content: "@peer-mentioned agreed, nothing to add. Stopping here.",
  });

  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: '{"action":"ignore"}' }] },
  });
  const outcome = await runAgentRound(agent.id, channel.id, runtime);

  assert.equal(outcome.status, "ignored");
  assert.equal(getAgent(agent.id).status, "online", "不落 error 状态点");
  assert.equal(
    globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id),
    1,
    "游标照常推进",
  );
  assert.equal(
    globalThis.__workspliceDb.listMessages(channel.id).length,
    1,
    "没有空回复落库",
  );
  // isChannelNoise 保持现状：agent 的 @ 不是 noise，消息照旧进入 prompt
  assert.match(
    runtime.sessions.get(agent.id).prompts[0],
    /agreed, nothing to add/,
    "agent 的 @ 消息仍被注入 prompt，只是不再强制回应",
  );
});

test("hasPeerCloseSignal recognizes explicit peer sign-offs and ignores ordinary peer messages", () => {
  // 收束语的判据（本票新增）：只认「其他 agent 的最后一条消息」是明确收束表述。
  const agentId = "agent-self";
  const peer = (content) => ({
    content,
    author_id: "agent-peer",
    author: { type: "agent" },
  });
  for (const content of [
    "@self 一致，无补充。task #1 在我名下 in_review，不动。停在。",
    "@self agreed, nothing to add. Stopping here.",
    "@self no more from me.",
    "@self 到此为止，不再回复。",
  ]) {
    assert.equal(hasPeerCloseSignal(agentId, [peer(content)]), true, content);
  }
  assert.equal(
    hasPeerCloseSignal(agentId, [peer("@self 请继续推进 task #1，还有两步")]),
    false,
    "普通工作消息不是收束语",
  );
  // 收束语误判的四个真实形态（Standards/Spec review 发现）：中段收束语后接工作请求、
  // 数量约束、疑问句、开头的工作安排，都不算收束。
  for (const content of [
    "@self no more than 3 retries, then fail",
    "@self 我这边无补充，但 claim 有 bug，请修",
    "@self 还没停在这里的原因是什么？",
    "@self 先这样实现：把 claim 放到事务里",
    "@self we have no more budget, prioritize the fix",
    "@self We're done with step 1, now run step 2",
    "@self don't stop here, finish the migration",
    "@self 这个 bug 停在登录流程",
    "@self 能不能 wrap this up",
  ]) {
    assert.equal(hasPeerCloseSignal(agentId, [peer(content)]), false, content);
  }
  // 人类消息（即使措辞像收束）不算 peer 收束：人类的信号归 hasMustRespondSignal 管。
  assert.equal(
    hasPeerCloseSignal(agentId, [
      { content: "停在。", author_id: "owner", author: { type: "human" } },
    ]),
    false,
  );
  // 人类随后发话（哪怕没 @）= 人类语境，不是收束：不得为旧收束语开静默收口的口子。
  assert.equal(
    hasPeerCloseSignal(agentId, [
      peer("停在。"),
      { content: "把 X 修一下", author_id: "owner", author: { type: "human" } },
    ]),
    false,
  );
  // 只看最后一条他人消息：之后 peer 又提问 → 收束信号失效（重新可回复）。
  assert.equal(
    hasPeerCloseSignal(agentId, [
      peer("停在。"),
      peer("@self 还有个边界问题：claim 的互斥怎么保证？"),
    ]),
    false,
  );
});

test("a peer's explicit sign-off in a thread closes it: a reply is dropped, acked and stays online", async () => {
  // 现场回归（2026-10-20 showcase task #1 线程）：peer 收口「一致，无补充…停在」并 @ 本 agent。
  // 收束后本 agent 不得再被拉回对话——即使模型仍在 reply，代码层也不落库、不记 error、不点红。
  const { agent, channel } = setupAgentAndChannel({ name: "peer-signoff" });
  const peer = joinPeer(channel, {
    name: "peer-signoff-closer",
    wsPrefix: "worksplice-peer-signoff-",
  });
  const anchor = sendAsOwner(channel.id, "refactor the module");
  sendMessage({
    targetId: anchor.id,
    authorId: peer.id,
    content: "@peer-signoff 一致，无补充。task #1 在我名下 in_review，不动。停在。",
  });

  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [{ text: '{"action":"reply","content":"收到，那我再说一句"}' }],
    },
  });
  const outcome = await runAgentRound(agent.id, anchor.id, runtime);

  assert.equal(outcome.status, "yielded");
  assert.equal(outcome.reason, "peer closed the exchange");
  assert.equal(getAgent(agent.id).status, "online", "不落 error 状态点");
  assert.equal(
    globalThis.__workspliceDb.listMessages(anchor.id).length,
    1,
    "不得产出新的对话消息",
  );
  assert.equal(
    globalThis.__workspliceDb.getConsumedSeq(agent.id, anchor.id),
    1,
    "游标推进到本轮房间版本",
  );
  // 收束语仍进 prompt：peer @ 是注意力信号，不被过滤，只是不再强制回应。
  assert.match(runtime.sessions.get(agent.id).prompts[0], /一致，无补充/);
  assert.match(
    runtime.sessions.get(agent.id).prompts[0],
    /Closed exchange/,
    "prompt 与判定同源",
  );
});

test("a newer peer question reopens a signed-off thread: the reply lands", async () => {
  // 收束信号的范围：只压制「peer 最后一条消息是收束语」的轮次；之后 peer 又提问 → 照常可回复。
  const { agent, channel } = setupAgentAndChannel({ name: "peer-reopened" });
  const peer = joinPeer(channel, {
    name: "peer-reopener",
    wsPrefix: "worksplice-peer-reopen-",
  });
  const anchor = sendAsOwner(channel.id, "refactor the module");
  sendMessage({
    targetId: anchor.id,
    authorId: peer.id,
    content: "@peer-reopened 一致，无补充。停在。",
  });
  sendMessage({
    targetId: anchor.id,
    authorId: peer.id,
    content: "@peer-reopened 还有个边界问题：claim 的互斥怎么保证？",
  });

  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [{ text: '{"action":"reply","content":"用 baseSeq 在事务内比对"}' }],
    },
  });
  const outcome = await runAgentRound(agent.id, anchor.id, runtime);

  assert.equal(outcome.status, "replied");
  assert.equal(
    globalThis.__workspliceDb.listMessages(anchor.id).length,
    3,
    "新提问照常回复落库",
  );
});

test("a human message after a peer sign-off is not suppressed: the reply lands", async () => {
  // 人类随后发话（哪怕没 @）= 人类语境，不是收束——不得吞掉人类指向的工作。
  const { agent, channel } = setupAgentAndChannel({ name: "human-after-signoff-noat" });
  const peer = joinPeer(channel, {
    name: "peer-then-human",
    wsPrefix: "worksplice-human-noat-",
  });
  const anchor = sendAsOwner(channel.id, "refactor the module");
  sendMessage({
    targetId: anchor.id,
    authorId: peer.id,
    content: "@human-after-signoff-noat 一致，无补充。停在。",
  });
  sendAsOwner(anchor.id, "把 claim 的互斥补上");

  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [{ text: '{"action":"reply","content":"好，补事务内比对"}' }],
    },
  });
  const outcome = await runAgentRound(agent.id, anchor.id, runtime);

  assert.equal(outcome.status, "replied");
  assert.equal(
    globalThis.__workspliceDb.listMessages(anchor.id).length,
    3,
    "人类的话照常回复落库",
  );
});

test("a human message earlier in the round blocks peer-close suppression: the reply lands", async () => {
  // 人类同一轮先说话（没 @）再轮 peer 收束：本轮是人类语境，不得静默收口吞掉人类的工作请求。
  const { agent, channel } = setupAgentAndChannel({ name: "human-before-signoff" });
  const peer = joinPeer(channel, {
    name: "peer-after-human",
    wsPrefix: "worksplice-human-before-",
  });
  const anchor = sendAsOwner(channel.id, "refactor the module");
  sendAsOwner(anchor.id, "把 claim 的互斥补上");
  sendMessage({
    targetId: anchor.id,
    authorId: peer.id,
    content: "@human-before-signoff 一致，无补充。停在。",
  });

  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [{ text: '{"action":"reply","content":"好，我来补"}' }],
    },
  });
  const outcome = await runAgentRound(agent.id, anchor.id, runtime);

  assert.equal(outcome.status, "replied");
  assert.equal(
    globalThis.__workspliceDb.listMessages(anchor.id).length,
    3,
    "人类的工作请求照常回复落库",
  );
});

test("a human @mention in a thread stays a must-respond signal after a peer sign-off", async () => {
  // 不变量 (1)：人类的 @ 仍是确定信号，不因 peer 收束被放宽——ignore 仍 error、不 ack、点红。
  const { agent, channel } = setupAgentAndChannel({ name: "human-after-signoff" });
  const peer = joinPeer(channel, {
    name: "peer-signoff-then-human",
    wsPrefix: "worksplice-human-signal-",
  });
  const anchor = sendAsOwner(channel.id, "refactor the module");
  sendMessage({
    targetId: anchor.id,
    authorId: peer.id,
    content: "@human-after-signoff 一致，无补充。停在。",
  });
  sendAsOwner(anchor.id, "@human-after-signoff 请确认最终结论");

  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: '{"action":"ignore"}' }] },
  });
  const outcome = await runAgentRound(agent.id, anchor.id, runtime);

  assert.equal(outcome.status, "error");
  assert.equal(outcome.reason, "ignore on must-respond signal");
  assert.equal(getAgent(agent.id).status, "error");
  assert.equal(
    globalThis.__workspliceDb.getConsumedSeq(agent.id, anchor.id),
    0,
    "确定信号下 ignore 不 ack",
  );
});

test("a peer @mention in a thread without a sign-off is an attention signal: ignore advances and stays online", async () => {
  // 不变量 (2) 的线程形态：peer @ 不是确定信号，ignore 落 ignored（游标推进、状态点不红、零新增）。
  const { agent, channel } = setupAgentAndChannel({ name: "thread-peer-mentioned" });
  const peer = joinPeer(channel, {
    name: "thread-peer-asker",
    wsPrefix: "worksplice-thread-peer-",
  });
  const anchor = sendAsOwner(channel.id, "refactor the module");
  sendMessage({
    targetId: anchor.id,
    authorId: peer.id,
    content: "@thread-peer-mentioned 这个边界你怎么看？",
  });

  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: '{"action":"ignore"}' }] },
  });
  const outcome = await runAgentRound(agent.id, anchor.id, runtime);

  assert.equal(outcome.status, "ignored");
  assert.equal(getAgent(agent.id).status, "online", "不落 error 状态点");
  assert.equal(
    globalThis.__workspliceDb.getConsumedSeq(agent.id, anchor.id),
    1,
    "游标照常推进",
  );
  assert.equal(
    globalThis.__workspliceDb.listMessages(anchor.id).length,
    1,
    "没有空回复落库",
  );
});

test("repeated must-respond ignores cap at 2 then ack with error (escape hatch)", async () => {
  // §05 防死循环：同一 (agent, target) 连续两次确定信号下 ignore → cap-ack（游标推进）
  // 并保持 error 状态点——不无限重试也不永久 pending
  const { agent, channel } = setupAgentAndChannel({ name: "capped-ignorer" });
  sendAsOwner(channel.id, "hey @capped-ignorer respond now");
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [{ text: '{"action":"ignore"}' }, { text: '{"action":"ignore"}' }],
    },
  });

  const first = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(first.status, "error");
  assert.equal(globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id), 0);

  const second = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(second.status, "error");
  assert.equal(second.reason, "ignore on must-respond signal (capped at 2)");
  assert.equal(getAgent(agent.id).status, "error");
  assert.equal(
    globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id),
    1,
    "capped: cursor acked as the escape hatch",
  );
});

test("a successful reply between failures resets the must-respond streak", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "streak-reset" });
  sendAsOwner(channel.id, "hey @streak-reset first");
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        { text: '{"action":"ignore"}' },
        { text: '{"action":"reply","content":"on it"}' },
        { text: '{"action":"ignore"}' },
        { text: '{"action":"ignore"}' },
      ],
    },
  });

  const first = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(first.status, "error", "failure #1 — streak at 1");

  sendAsOwner(channel.id, "hey @streak-reset second");
  const second = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(second.status, "replied", "successful reply resets the streak");

  sendAsOwner(channel.id, "hey @streak-reset third");
  const third = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(third.status, "error", "failure #1 again — not capped");

  sendAsOwner(channel.id, "hey @streak-reset fourth");
  const fourth = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(fourth.status, "error", "failure #2 — capped");
  assert.equal(
    globalThis.__workspliceDb.getConsumedSeq(agent.id, channel.id),
    5,
    "cap-ack advances to the channel maxSeq (5: first+second+reply+third+fourth)",
  );
});

test("buildReplyPrompt documents the response judgment rubric", () => {
  const { agent, channel } = setupAgentAndChannel({ name: "rubric" });
  const prompt = buildReplyPrompt({
    agent,
    channel,
    messages: [],
    tasks: [],
    targetId: channel.id,
    baseSeq: 0,
  });
  assert.match(prompt, /MUST reply/);
  assert.match(prompt, /MAY reply/);
  assert.match(prompt, /MUST ignore \(do not chime in\)/);
  assert.match(prompt, /"action":"reply"\|"ignore"\|"conclude"/);
  assert.match(prompt, /conclude": acknowledge receipt without posting/);
  assert.match(prompt, /needs only a closing confirmation/);
  assert.match(prompt, /legal under a certain signal instead of "ignore"/);
  assert.match(prompt, /never to dodge direct questions or explicit work requests/);
  // rubric 与判定同源：只有人类的 @ 是 MUST reply；agent 的 @ 只是注意力信号
  assert.match(prompt, /a human \(the Owner\) personally @mentions you/);
  assert.match(
    prompt,
    /An @mention from another agent is an attention signal, not a demand/,
  );
  assert.doesNotMatch(prompt, /An @mention of you overrides all of this/);
});

test("a shared-cwd BusyCwdError round reports busy-cwd and does not error the status", async () => {
  // 02-决策一：BusyCwdError 映射为 busy-cwd（driver 重试），不再是 error 轮（丢弃）
  const { agent, channel } = setupAgentAndChannel({ name: "cwd-busy" });
  sendAsOwner(channel.id, "hello there");
  const runtime = makeFakeRuntime();
  runtime.startSession = async (member) => {
    throw new BusyCwdError(member.workspace_path);
  };
  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "busy-cwd");
  assert.notEqual(getAgent(agent.id).status, "error", "busy-cwd 不落 error 状态");
  assert.equal(outcome.baseSeq, 1, "07-承诺：busy-cwd 轮也携带房间版本（round_logs base_seq 非 0）");
});

// ---------------------------------------------------------------------------
// 05 实测整改：prompt_done ≠ 会话空闲（hold 后 revise 的 settle 缝）
// ---------------------------------------------------------------------------
// 真实运行里 revise 曾经 100% 失败：`prompt_done` 只说明这一轮 prompt 调用返回了，
// pi SDK 仍在收尾，此时发第二个 prompt 会被直接拒绝——SDK 原文：
//   "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp')
//    to queue the message."
// → 空文本 → error 轮（消息不丢，靠下一轮 wake 重试）。
// 此前所有 revise 测试都注入假 promptFn，因此缝在 loop 与 wrapper 之间，从未被覆盖。

function fakePromptSession({ idleAfterMs = 0, replyText = '{"action":"reply","content":"revised"}' } = {}) {
  let running = idleAfterMs > 0;
  const listeners = new Set();
  const sent = [];
  if (idleAfterMs > 0) setTimeout(() => { running = false; }, idleAfterMs);
  return {
    sent,
    isRunning: () => running,
    onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    send: async (command) => {
      if (command.type === "prompt") {
        // 镜像 pi SDK + wrapper：仍在处理时拒绝这个 prompt，并如实发 prompt_error
        // （wrapper 的 .catch 就是发这个事件——所以等待方不会留下悬挂的定时器）
        if (running) {
          queueMicrotask(() => {
            for (const listener of listeners) {
              listener({
                type: "prompt_error",
                errorMessage:
                  "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
              });
            }
          });
          throw new Error(
            "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
          );
        }
        sent.push(command.message);
        queueMicrotask(() => { for (const listener of listeners) listener({ type: "prompt_done" }); });
        return null;
      }
      if (command.type === "get_last_assistant_text") return { text: replyText };
      return null;
    },
  };
}

test("promptSession 先等会话空闲再发：revise 不再撞 SDK 的 processing 拒绝", async () => {
  const session = fakePromptSession({ idleAfterMs: 200 });
  const result = await promptSession(session, "[worksplice:revision] 重写");
  assert.equal(result.ok, true, "会话空闲后应当发得出去（修前这里是 ok:false）");
  assert.equal(result.text, '{"action":"reply","content":"revised"}');
  assert.deepEqual(session.sent, ["[worksplice:revision] 重写"], "prompt 在会话空闲之后才发出");
});

test("waitForSessionIdle 超时不抛：返回 false，把原始错误留给 SDK 如实暴露", async () => {
  const stuck = { isRunning: () => true, onEvent: () => () => {}, send: async () => null };
  assert.equal(await waitForSessionIdle(stuck, 60, 10), false);
  assert.equal(await waitForSessionIdle(fakePromptSession(), 60, 10), true);
});

test("buildReplyPrompt injects the per-round workspace context and the member-op protocol", () => {
  const { agent, channel } = setupAgentAndChannel({ name: "ctx-agent" });
  const prompt = buildReplyPrompt({
    agent,
    channel,
    messages: [
      {
        id: "m1",
        target_id: channel.id,
        seq: 1,
        author_id: OWNER_MEMBER_ID,
        content: "please look at this",
        created_at: "",
        author: { id: OWNER_MEMBER_ID, name: "Owner" },
      },
    ],
    tasks: [],
    targetId: channel.id,
    baseSeq: 1,
    context: {
      channels: [
        { name: channel.name, type: "public", seq: 3, joined: true, archived: false },
        { name: "elsewhere", type: "private", seq: 0, joined: false, archived: true },
      ],
      members: [
        { name: "Owner", type: "human" },
        { name: "ctx-agent", type: "agent" },
      ],
      defaultModel: { provider: "zenmux", modelId: "claude-sonnet-4-6" },
    },
  });
  // 频道列表 / 成员列表 / 默认模型 = ADR-0013 §1.5 里「已在每轮语境里」的三条（可指认的注入点）
  assert.match(prompt, new RegExp(`Workspace channels: #${channel.name} \\(public, seq 3\\)`));
  assert.match(prompt, /#elsewhere \(private, seq 0, not joined, archived\)/);
  assert.match(prompt, /Workspace members: @Owner \(human\), @ctx-agent \(agent\)/);
  assert.match(prompt, /Default model for new agents: zenmux\/claude-sonnet-4-6/);
  // 七条 op 的教学行（协议面）
  for (const op of ["react", "pin", "remind", "post", "createChannel", "createAgent", "search"]) {
    assert.match(prompt, new RegExp(`"op":"${op}"`), `${op} 应在 prompt 里被教到`);
  }
  assert.match(prompt, /Human-only/);
});

test("buildReplyPrompt without an injected context keeps the legacy prompt shape", () => {
  const { agent, channel } = setupAgentAndChannel({ name: "legacy-agent" });
  const prompt = buildReplyPrompt({
    agent,
    channel,
    messages: [],
    tasks: [],
    targetId: channel.id,
    baseSeq: 0,
  });
  assert.ok(!prompt.includes("Workspace channels:"), "没给 context 就不注入频道列表");
  assert.ok(!prompt.includes("Workspace members:"), "没给 context 就不注入成员列表");
});

// ---------------------------------------------------------------------------
// B5：每轮注入有界（票 08）——fake session 的每轮 prompt 捕获缝
// ---------------------------------------------------------------------------

/** 合成积压：一条早期关键事实 + N 条填充消息 + 一条当轮要回的消息。 */
function seedBacklog(targetId, { filler = 200, earlyFact = "EARLY-FACT-7F3", latest = "当轮要回的问题：请确认最新一条消息" } = {}) {
  sendAsOwner(targetId, `关键事实：早期轮的检索暗号 ${earlyFact}（只有最早那条消息里有）`);
  for (let i = 0; i < filler; i += 1) {
    sendAsOwner(targetId, `填充消息 ${i} ${"x".repeat(160)}`);
  }
  return sendAsOwner(targetId, latest);
}

test("B5：长会话积压下每轮注入形状受应用层恒定上界约束", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "bounded-round" });
  seedBacklog(channel.id);
  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: '{"action":"reply","content":"ok"}' }] },
  });
  activeRuntime = runtime;

  const outcome = await runAgentRound(agent.id, channel.id, runtime);
  assert.equal(outcome.status, "replied");

  const prompt = runtime.sessions.get(agent.id).prompts[0];
  assert.ok(
    prompt.length <= ROUND_INJECTION_BUDGET_CHARS,
    `注入形状 ${prompt.length} 应 ≤ 恒定上界 ${ROUND_INJECTION_BUDGET_CHARS}`,
  );
});

test("B5：超界的早期关键事实不在注入中，最近消息仍在；原始记录未删改", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "bounded-keeps-recent" });
  const latest = seedBacklog(channel.id);
  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: '{"action":"reply","content":"ok"}' }] },
  });
  activeRuntime = runtime;

  await runAgentRound(agent.id, channel.id, runtime);
  const prompt = runtime.sessions.get(agent.id).prompts[0];

  assert.ok(prompt.length <= ROUND_INJECTION_BUDGET_CHARS);
  assert.ok(!prompt.includes("EARLY-FACT-7F3"), "超界的早期关键事实不得进入注入");
  assert.ok(
    prompt.includes(`#${latest.seq}`),
    "当轮要回的最新消息必须仍在注入中（保近期、裁远期）",
  );
  // 非破坏分层（D1/D4）：裁掉只发生在注入投影里，原始会话记录原样保留
  const stored = globalThis.__workspliceDb.listMessages(channel.id);
  assert.ok(
    stored.some((message) => message.content.includes("EARLY-FACT-7F3")),
    "原始消息仍在（未删未改写）",
  );
  // 202 条种子消息 + agent 本轮的回复
  assert.equal(stored.length, 203, "填充消息一条不少：注入裁剪不动原始记录");
});

test("B5：逐轮上界恒定——轮次累积不改变每轮注入的上界", async () => {
  const { agent, channel } = setupAgentAndChannel({ name: "bounded-multi" });
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        { text: '{"action":"reply","content":"first"}' },
        { text: '{"action":"reply","content":"second"}' },
      ],
    },
  });
  activeRuntime = runtime;

  seedBacklog(channel.id, { filler: 150 });
  await runAgentRound(agent.id, channel.id, runtime);
  seedBacklog(channel.id, { filler: 150, earlyFact: "EARLY-FACT-SECOND" });
  await runAgentRound(agent.id, channel.id, runtime);

  const prompts = runtime.sessions.get(agent.id).prompts;
  assert.equal(prompts.length, 2, "两轮各一条 decide prompt");
  for (const [index, prompt] of prompts.entries()) {
    assert.ok(
      prompt.length <= ROUND_INJECTION_BUDGET_CHARS,
      `第 ${index + 1} 轮注入 ${prompt.length} 应 ≤ ${ROUND_INJECTION_BUDGET_CHARS}`,
    );
  }
  assert.ok(
    !prompts[1].includes("EARLY-FACT-SECOND"),
    "第二轮同样裁掉超界的历史积压（上界与会话长度无关）",
  );
});

test("B5：裁剪提示写明被裁内容与回查入口（不静默丢弃）", () => {
  const { agent, channel } = setupAgentAndChannel({ name: "bounded-notice" });
  const messages = Array.from({ length: 40 }, (_, index) => ({
    id: `m${index}`,
    target_id: channel.id,
    seq: index + 1,
    author_id: OWNER_MEMBER_ID,
    content: `第 ${index} 条 ${"y".repeat(400)}`,
    created_at: "",
    author: { id: OWNER_MEMBER_ID, name: "Owner" },
  }));
  const prompt = buildReplyPrompt({
    agent,
    channel,
    messages,
    tasks: [],
    targetId: channel.id,
    baseSeq: 40,
  });
  assert.ok(prompt.length <= ROUND_INJECTION_BUDGET_CHARS);
  assert.match(prompt, /条较早的消息不在本轮注入中/, "被裁内容应在注入里显式声明");
  assert.match(prompt, /search/, "裁剪提示应指向既有 search 回查入口");
});

// ---------------------------------------------------------------------------
// 票 10 机制基线①：每轮注入规模（D5「机制层＝每轮注入规模＋contextUsage 峰值」的前半）
// ---------------------------------------------------------------------------
// 口径：度量＝注入文本的字符数（仓库内无 tokenizer，字符是模型输入的单调代理）；
// 上界＝ROUND_INJECTION_BUDGET_CHARS，覆盖整轮注入形状的合计。两种绑定情形都记下来：
// 近期窗口（条数）先绑定、字符上界后绑定——两者都不越界才算「恒定上界」成立。

/** ①-B 的积压形状：条数远小于窗口，但单条正文远超预算 ⇒ 绑定量是字符上界。 */
const FAT_BACKLOG_COUNT = 40;
const FAT_MESSAGE_CHARS = 4_000;
/**
 * 「注入真的吃到上界」的容差：消息按整条保留（不部分填充），单条 4000 字，
 * 所以最少填充量天然比上界少一整条消息；再加 500 字覆盖骨架与提示行的正常增长。
 */
const BOUND_TOLERANCE_CHARS = FAT_MESSAGE_CHARS + 500;

/** 注入里出现的消息行 seq（行首 `#<seq> @<author>:`），按出现顺序。 */
function injectedSeqs(prompt) {
  return [...prompt.matchAll(/^#(\d+) @/gm)].map((match) => Number(match[1]));
}

test("B5 机制基线①-A：积压灌满近期窗口时，注入 ≤ 上界且相对原始积压显著缩小", async (t) => {
  const { agent, channel } = setupAgentAndChannel({ name: "baseline-window" });
  const latest = seedBacklog(channel.id);
  const runtime = makeFakeRuntime({
    repliesByAgent: { [agent.id]: [{ text: '{"action":"reply","content":"ok"}' }] },
  });
  activeRuntime = runtime;

  await runAgentRound(agent.id, channel.id, runtime);
  const prompt = runtime.sessions.get(agent.id).prompts[0];
  const stored = globalThis.__workspliceDb.listMessages(channel.id);
  const rawChars = stored.reduce((total, message) => total + message.content.length, 0);

  assert.ok(
    prompt.length <= ROUND_INJECTION_BUDGET_CHARS,
    `注入 ${prompt.length} 应 ≤ 恒定上界 ${ROUND_INJECTION_BUDGET_CHARS}`,
  );
  assert.ok(
    prompt.length < rawChars,
    `注入 ${prompt.length} 应小于原始积压 ${rawChars}（活动上下文按注入形状缩小）`,
  );
  t.diagnostic(
    `机制基线①-A：注入 ${prompt.length} 字符 / 原始积压 ${rawChars} 字符（${stored.length} 条），` +
      `缩小 ${rawChars - prompt.length} 字符，上界 ${ROUND_INJECTION_BUDGET_CHARS}`,
  );

  // 窗口绑定：只保留最近 INJECTION_MESSAGE_WINDOW 条，且当轮最新一条必在
  const seqs = injectedSeqs(prompt);
  assert.ok(seqs.length > 0, "注入里应有消息行");
  assert.ok(
    seqs.length <= INJECTION_MESSAGE_WINDOW,
    `注入消息行 ${seqs.length} 应 ≤ 窗口 ${INJECTION_MESSAGE_WINDOW}`,
  );
  assert.equal(seqs[seqs.length - 1], latest.seq, "当轮最新一条消息必须在注入中（保近期）");
  assert.equal(seqs[0], latest.seq - seqs.length + 1, "保留的是一段连续的近期窗口（裁远期）");
});

test("B5 机制基线①-B：单条正文撑爆窗口时字符上界绑定（而非只有条数窗口）", (t) => {
  const { agent, channel } = setupAgentAndChannel({ name: "baseline-budget" });
  const messages = Array.from({ length: FAT_BACKLOG_COUNT }, (_, index) => ({
    id: `m${index}`,
    target_id: channel.id,
    seq: index + 1,
    author_id: OWNER_MEMBER_ID,
    content: `第 ${index} 条 ${"y".repeat(FAT_MESSAGE_CHARS)}`,
    created_at: "",
    author: { id: OWNER_MEMBER_ID, name: "Owner" },
  }));
  const prompt = buildReplyPrompt({
    agent,
    channel,
    messages,
    tasks: [],
    targetId: channel.id,
    baseSeq: FAT_BACKLOG_COUNT,
  });

  assert.ok(
    prompt.length <= ROUND_INJECTION_BUDGET_CHARS,
    `注入 ${prompt.length} 应 ≤ 恒定上界 ${ROUND_INJECTION_BUDGET_CHARS}`,
  );
  assert.ok(
    prompt.length > ROUND_INJECTION_BUDGET_CHARS - BOUND_TOLERANCE_CHARS,
    `注入 ${prompt.length} 应当真正吃到预算上界（否则上界只是摆设）`,
  );
  const seqs = injectedSeqs(prompt);
  assert.equal(seqs[seqs.length - 1], FAT_BACKLOG_COUNT, "最新一条仍保留（必要时截断其正文）");
  const rawChars = messages.reduce((total, message) => total + message.content.length, 0);
  t.diagnostic(
    `机制基线①-B：注入 ${prompt.length} 字符 / 原始积压 ${rawChars} 字符` +
      `（${FAT_BACKLOG_COUNT} 条 × ${FAT_MESSAGE_CHARS}），保留 ${seqs.length} 条，` +
      `上界 ${ROUND_INJECTION_BUDGET_CHARS}`,
  );
});

// ---------------------------------------------------------------------------
// P2：内容分工 rubric——固定骨架块，不动消息块裁剪与预算常量
// ---------------------------------------------------------------------------

test("the content-placement rubric survives a full message backlog and the message window is unchanged", () => {
  const { agent, channel } = setupAgentAndChannel({ name: "rubric-budget" });
  const messages = Array.from({ length: FAT_BACKLOG_COUNT }, (_, index) => ({
    id: `m${index}`,
    target_id: channel.id,
    seq: index + 1,
    author_id: OWNER_MEMBER_ID,
    content: `第 ${index} 条 ${"y".repeat(FAT_MESSAGE_CHARS)}`,
    created_at: "",
    author: { id: OWNER_MEMBER_ID, name: "Owner" },
  }));
  const prompt = buildReplyPrompt({
    agent,
    channel,
    messages,
    tasks: [],
    targetId: channel.id,
    baseSeq: FAT_BACKLOG_COUNT,
  });

  for (const line of CONTENT_PLACEMENT_RUBRIC) {
    assert.ok(prompt.includes(line), `rubric 固定骨架行必须在注入里：${line}`);
  }
  assert.ok(
    prompt.length <= ROUND_INJECTION_BUDGET_CHARS,
    `注入 ${prompt.length} 应 ≤ 恒定上界 ${ROUND_INJECTION_BUDGET_CHARS}`,
  );
  const seqs = injectedSeqs(prompt);
  assert.ok(
    seqs.length <= INJECTION_MESSAGE_WINDOW,
    `注入消息行 ${seqs.length} 应 ≤ 窗口 ${INJECTION_MESSAGE_WINDOW}`,
  );
  assert.equal(
    seqs[seqs.length - 1],
    FAT_BACKLOG_COUNT,
    "rubric 只吃骨架预算，消息窗口的「保近期」语义不变",
  );

  // revise 轮不重复注入该 rubric（重写指引已由 hold 的四选一承担）
  const revision = buildRevisionPrompt({
    channel,
    originalContent: "原稿",
    held: { roomSeq: FAT_BACKLOG_COUNT, whatHappened: "new messages arrived" },
    newMessages: messages.slice(-2),
    targetId: channel.id,
  });
  assert.ok(
    !revision.includes(CONTENT_PLACEMENT_RUBRIC[0]),
    "buildRevisionPrompt 不注入内容分工 rubric",
  );
});

test("机制基线①-C：注入规模与积压长度无关——积压翻十倍后每轮注入仍受同一上界", async (t) => {
  const { agent, channel } = setupAgentAndChannel({ name: "baseline-scale" });
  const runtime = makeFakeRuntime({
    repliesByAgent: {
      [agent.id]: [
        { text: '{"action":"reply","content":"first"}' },
        { text: '{"action":"reply","content":"second"}' },
      ],
    },
  });
  activeRuntime = runtime;

  seedBacklog(channel.id, { filler: 40, earlyFact: "EARLY-FACT-SMALL" });
  await runAgentRound(agent.id, channel.id, runtime);
  const smallBacklog = runtime.sessions.get(agent.id).prompts[0].length;

  seedBacklog(channel.id, { filler: 400, earlyFact: "EARLY-FACT-LARGE" });
  await runAgentRound(agent.id, channel.id, runtime);
  const largeBacklog = runtime.sessions.get(agent.id).prompts[1].length;

  for (const [label, size] of [["小积压", smallBacklog], ["大积压", largeBacklog]]) {
    assert.ok(
      size <= ROUND_INJECTION_BUDGET_CHARS,
      `${label}注入 ${size} 应 ≤ ${ROUND_INJECTION_BUDGET_CHARS}`,
    );
  }
  // 积压翻十倍，注入规模不随会话长度线性增长（上界恒定 ⇒ 差值被上界压住）
  assert.ok(
    largeBacklog - smallBacklog < 2_000,
    `注入规模不随积压长度增长：${smallBacklog} → ${largeBacklog}`,
  );
  t.diagnostic(
    `机制基线①-C：积压 42 条 → 注入 ${smallBacklog} 字符；积压 444 条 → 注入 ${largeBacklog} 字符` +
      `（差 ${largeBacklog - smallBacklog} 字符，上界恒定）`,
  );
});

test("replyPromptContext lists public channels and joined ones only (private un-joined names are not injected)", () => {
  const { agent } = setupAgentAndChannel({ name: "ctx-scope-agent" });
  const privateRoom = createChannel({
    name: `hidden-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: "private",
  });
  const publicRoom = createChannel({
    name: `open-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: "public",
  });
  const context = replyPromptContext(agent);

  assert.equal(
    context.channels.some((channel) => channel.name === privateRoom.name),
    false,
    "未加入的私有频道不得进语境（读类不提升可见面）",
  );
  const visible = context.channels.find((channel) => channel.name === publicRoom.name);
  assert.ok(visible, "公开频道应进语境");
  assert.equal(visible.joined, false, "未加入的公开频道标注 not joined");
});
