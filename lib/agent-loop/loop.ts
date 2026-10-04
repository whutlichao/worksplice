import { existsSync, readFileSync, statSync } from "fs";
import { join, normalize } from "path";
import { getDb } from "../data/db-singleton.ts";
import {
  type MessageWithAuthor,
  type SendMessageResult,
  type WakeHint,
  type WakeReason,
  ack,
  agentHomePath,
  claimTask,
  drain,
  extractMentionedMemberIds,
  fireDueReminders,
  getAgent,
  getSince,
  isChannelMember,
  isDM,
  joinChannel,
  listAgents,
  listRelatedTasks,
  logRoundOutcome,
  normalizeWorkspacePath,
  resolveTargetChannel,
  sendMessage,
  subscribeWake,
  updateTaskStatus,
} from "../domain/collab/index.ts";
import {
  publishAgentStatus,
  startAgentStatusSweeper,
} from "../agent-status.ts";
import { BusyCwdError, getAgentRuntime } from "../agent-runtime.ts";
import { MEMORY_FILE_NAME } from "../data/dirs.ts";
import { OWNER_MEMBER_ID } from "../data/schema.ts";
import type {
  ChannelRow,
  MemberRow,
  MessageRow,
  TaskRow,
} from "../data/types.ts";
import {
  BUSY_CWD_RETRY_DELAY_MS,
  PROMPT_DONE_EVENTS,
  SETTLE_EVENTS,
  scheduleBusyRetry,
  waitForSettle as waitForCwdSettle,
} from "../cwd-mutex.ts";

/**
 * agent-loop 深模块（§5.4，Ticket 02 合并自 loop/wake/driver/backfill/reminder-cron 五文件）：
 * 编排面 = wake 驱动队列（driver）+ 崩溃恢复补拉（backfill）+ 提醒 cron（reminder-cron）
 * 全部收进本文件；公共接口 = createAgentLoop() → { start, stop, tick }（index.ts 只 re-export 它）。
 * wake 发布/订阅原语已下沉 lib/domain/collab/wake.ts（协作服务层发、本模块订阅，依赖方向 collab ← agent-loop）。
 *
 * 轮次核心（runAgentRound）：wake → drain → decide → act → reply 收口。
 * - drain：按 consumed_seqs 拉增量，组装 channel 语境 + 新消息 + 相关任务状态；
 * - decide：AX 原则——prompt 给出"能直接用的信息 + 一个明确的 next action"，回复为结构化 JSON；
 * - act：经 协作服务层执行（回复带 freshness 校验），held 时四选一（§3.3 与 §6.3）：
 *   revise（重读重写）/ resend（原样重试）/ silent（静默放弃）/ anyway（显式逃逸口）；
 * - reply 收口：回复走双写流落 SQLite，每轮结束后 ack 推进 consumed_seqs（§3.8/§5.5）。
 *
 * 接缝：runtime 注入（AgentRuntime 结构子集）；测试传 fake，生产默认 getAgentRuntime()。
 * 绝不静态 import lib/rpc（node TS strip 无法解析 parameter properties）。
 */

export interface LoopSession {
  send(command: {
    type: string;
    message?: string;
    [key: string]: unknown;
  }): Promise<unknown>;
  onEvent(
    listener: (event: { type: string; [key: string]: unknown }) => void,
  ): () => void;
  isRunning(): boolean;
}

export interface LoopRuntime {
  findSession(member: MemberRow): LoopSession | undefined;
  startSession(
    member: MemberRow,
  ): Promise<{ sessionId: string; sessionFile: string | null }>;
  /** 02-决策一：同 cwd 被他人会话占用时返回占用中的会话（busy-cwd 的等待对象）。 */
  findBusySessionForCwd?(cwd: string): LoopSession | undefined;
}

// ----------------------------------------------------------------------------
// 结构化回复协议（AX）：action + content + onConflict（freshness-hold 四选一）
// ----------------------------------------------------------------------------

export type ConflictChoice = "revise" | "resend" | "silent" | "anyway";
const CONFLICT_CHOICES = new Set(["revise", "resend", "silent", "anyway"]);

/** 任务操作（§3.7）：claim = 认领并开工；complete = 完成（置 in_review 待互审）；unclaim = 释放回池。 */
export type TaskOp = "claim" | "complete" | "unclaim";
export const TASK_OPS = new Set<TaskOp>(["claim", "complete", "unclaim"]);

/** §05 兜底上限：确定信号（个人 @mention / 进行中任务线程收到他人消息）下连续 ignore 达此值 → ack 并记 error（防死循环）。 */
export const MUST_RESPOND_FAILURE_CAP = 2;

declare global {
  var __workspliceMustRespondFailures: Map<string, number> | undefined;
}

function mustRespondFailureCount(agentId: string, targetId: string): number {
  return (
    globalThis.__workspliceMustRespondFailures?.get(`${agentId}|${targetId}`) ??
    0
  );
}

function recordMustRespondFailure(agentId: string, targetId: string): number {
  if (!globalThis.__workspliceMustRespondFailures) {
    globalThis.__workspliceMustRespondFailures = new Map();
  }
  const next = mustRespondFailureCount(agentId, targetId) + 1;
  globalThis.__workspliceMustRespondFailures.set(
    `${agentId}|${targetId}`,
    next,
  );
  return next;
}

function resetMustRespondFailures(agentId: string, targetId: string): void {
  globalThis.__workspliceMustRespondFailures?.delete(`${agentId}|${targetId}`);
}

export interface AgentAction {
  action: "reply" | "ignore";
  content: string;
  onConflict: ConflictChoice;
  /** 可选：本轮附带的任务操作（先 claim 再开工；claim 失败就让路）。 */
  task?: { number: number; op: TaskOp };
}

/** 崩溃恢复补拉用的房间标记（§5.3）：随 prompt 落进 session jsonl 的 user 条目。 */
export const ROOM_MARKER_PATTERN =
  /\[worksplice:target=([A-Za-z0-9#-]+) seq=(\d+)\]/;

export function roomMarker(targetId: string, seq: number): string {
  return `[worksplice:target=${targetId} seq=${seq}]`;
}

/** 提取文本中首个完整平衡的 JSON 对象子串（字符串字面量内的 {} 不参与配对）。 */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** 解析 agent 的结构化回复；非 JSON（或 json 代码块）按整段文本作为回复内容。 */
export function parseAgentAction(text: string): AgentAction {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, "$1")
    .trim();
  // 整串直接解析失败时（模型常夹带 <|eom|> 之类的记号或前后散文），
  // 在杂质文本里提取首个完整 JSON 对象再试；仅当对象符合协议形状（有合法 action 字段）
  // 才采纳，避免把含 JSON 字面量的普通散文误判成协议回复。
  let parsed: Record<string, unknown> | null = null;
  try {
    const direct = JSON.parse(cleaned);
    if (direct && typeof direct === "object" && !Array.isArray(direct))
      parsed = direct;
  } catch {
    const candidate = extractJsonObject(cleaned);
    if (candidate) {
      try {
        const extracted = JSON.parse(candidate) as Record<string, unknown>;
        if (
          extracted &&
          typeof extracted === "object" &&
          !Array.isArray(extracted) &&
          (extracted.action === "reply" || extracted.action === "ignore")
        ) {
          parsed = extracted;
        }
      } catch {
        // 提取出的候选仍是坏 JSON：按明文处理
      }
    }
  }
  if (parsed) {
    const action: AgentAction["action"] =
      parsed.action === "ignore" ? "ignore" : "reply";
    const content =
      typeof parsed.content === "string" ? parsed.content.trim() : "";
    const onConflict: ConflictChoice = CONFLICT_CHOICES.has(
      String(parsed.onConflict),
    )
      ? (parsed.onConflict as ConflictChoice)
      : "revise";
    let task: AgentAction["task"];
    const rawTask = parsed.task;
    if (rawTask && typeof rawTask === "object" && !Array.isArray(rawTask)) {
      const number = Number((rawTask as Record<string, unknown>).number);
      const op = String((rawTask as Record<string, unknown>).op);
      if (
        Number.isInteger(number) &&
        number > 0 &&
        TASK_OPS.has(op as TaskOp)
      ) {
        task = { number, op: op as TaskOp };
      }
    }
    return task
      ? { action, content, onConflict, task }
      : { action, content, onConflict };
  }
  return {
    action: "reply",
    content: cleaned || text.trim(),
    onConflict: "revise",
  };
}

// ----------------------------------------------------------------------------
// prompt 组装
// ----------------------------------------------------------------------------

const MESSAGE_CONTENT_CAP = 4000;

/** decide 的 prompt（§5.4 AX 原则）：新消息（带 seq/作者）+ 相关任务状态 + 明确的 next action 选项。 */
export function buildReplyPrompt(input: {
  agent: MemberRow;
  channel: ChannelRow;
  messages: MessageWithAuthor[];
  tasks: Array<{
    number: number;
    status: string;
    preview: string;
    ownerName: string;
    reopened?: boolean;
  }>;
  targetId: string;
  baseSeq: number;
  memoryFile?: string | null;
}): string {
  const lines: string[] = [];
  lines.push(
    `You are @${input.agent.name}, a member of the worksplice workspace.`,
  );
  lines.push(`New activity arrived in channel ${input.channel.name}:`);
  // 11-整改（自激循环）：续工轮的 drain 全是 agent 自己的历史回复（线程游标留口），
  // 模型看到 `@自己` 会误以为被 @mention 而继续回复——标注这些是自己的消息，
  // 不是他人新活动，@mention 也不构成"必须回应"信号。
  const ownMessagesOnly =
    input.messages.length > 0 &&
    input.messages.every((m) => m.author_id === input.agent.id);
  if (ownMessagesOnly) {
    lines.push(
      "(The messages below are YOUR OWN — your prior progress in this thread. They are not new activity from others; being @mentioned within them is a self-mention, not a demand. Decide: continue working, complete the task, or say nothing.)",
    );
  }
  lines.push("");
  for (const message of input.messages) {
    const author = message.author?.name ?? "unknown";
    const content =
      message.content.length > MESSAGE_CONTENT_CAP
        ? `${message.content.slice(0, MESSAGE_CONTENT_CAP)}…`
        : message.content;
    lines.push(`#${message.seq} @${author}: ${content}`);
  }
  if (input.tasks.length > 0) {
    lines.push("");
    lines.push("Related open tasks:");
    for (const task of input.tasks) {
      const reopened = task.reopened
        ? " — REOPENED, awaiting the owner: do not claim"
        : "";
      lines.push(
        `- task #${task.number} [${task.status}] "${task.preview}" (owner: ${task.ownerName})${reopened}`,
      );
    }
  }
  lines.push("");
  lines.push(
    'Choose ONE next action and reply with JSON only: {"action":"reply"|"ignore","content":"your reply text","onConflict":"revise"|"resend"|"silent"|"anyway"}',
  );
  lines.push('- "reply" posts content to the channel; "ignore" says nothing.');
  lines.push("- Deciding is yours, but follow these response rules:");
  lines.push(
    "- MUST reply: you are personally @mentioned in the message (channel or thread); you are the owner of an in_progress task and someone else posted in its thread; a reminder is addressed to you; a question is asked directly of you.",
  );
  if (input.channel.type === "dm") {
    lines.push(
      "- DM rule: this channel is your direct message with the owner — a human message from the owner here is always a MUST reply; ignoring it is treated as a failure.",
    );
  }
  lines.push(
    "- MAY reply: the message concerns your role, your workspace, or your current work — answer when you can add value.",
  );
  lines.push(
    "- MUST ignore (do not chime in): task threads you do not own, are not mentioned in, and have not participated in; others' progress reports or status updates; unrelated small talk. An @mention of you overrides all of this — being mentioned is a demand for a response, and ignoring it is treated as a failure.",
  );
  lines.push(
    "- Never @mention yourself: writing @your-own-name in a reply mentions no one and only creates noise.",
  );
  lines.push(
    '- A "reply" must carry non-empty content text — a reply without content cannot be posted.',
  );
  lines.push(
    "- onConflict applies only if the room changed while you were writing (freshness-hold): revise = read the new messages and rewrite; resend = send the draft as-is; silent = stay silent; anyway = send without the freshness check.",
  );
  lines.push(
    '- Task protocol: to work on an open task, add {"task":{"number":N,"op":"claim"}} — it claims task N and posts your reply in that task\'s thread (progress lives there); if the claim fails, someone else took it: yield, do not reply.',
  );
  lines.push(
    '- When you finish a task you own: {"task":{"number":N,"op":"complete"}} — the task moves to in_review for someone else to verify (builders never verify their own work). To step away: {"task":{"number":N,"op":"unclaim"}}.',
  );
  if (input.memoryFile) {
    lines.push(
      `- Long-term memory: your memory file is at ${input.memoryFile}. Read it when you need context about who you are or ongoing work; after meaningful progress, update its "## Current work" section and clear it when the work is done. It survives session resets.`,
    );
  }
  lines.push(roomMarker(input.targetId, input.baseSeq));
  return lines.join("\n");
}

/** held 后的 revise prompt（§3.3 修正方式 1）：期间发生了什么 + 新消息正文 + 原稿 + 重写指示。 */
export function buildRevisionPrompt(input: {
  channel: ChannelRow;
  originalContent: string;
  held: { roomSeq: number; whatHappened: string };
  newMessages: MessageWithAuthor[];
  targetId: string;
}): string {
  const lines: string[] = [];
  lines.push(
    `Your reply to channel ${input.channel.name} was held because the room changed while you were writing.`,
  );
  lines.push(`What happened: ${input.held.whatHappened}`);
  lines.push(`The room is now at seq ${input.held.roomSeq}.`);
  if (input.newMessages.length > 0) {
    lines.push("");
    lines.push("Messages that arrived while you were writing:");
    for (const message of input.newMessages) {
      const author = message.author?.name ?? "unknown";
      const content =
        message.content.length > MESSAGE_CONTENT_CAP
          ? `${message.content.slice(0, MESSAGE_CONTENT_CAP)}…`
          : message.content;
      lines.push(`#${message.seq} @${author}: ${content}`);
    }
  }
  lines.push("");
  lines.push("Your held draft was:");
  lines.push("---");
  lines.push(input.originalContent);
  lines.push("---");
  lines.push(
    'Decide one of: rewrite the reply and resend (reply JSON again with your new content); resend the draft as-is ({"action":"reply","content":"<draft>","onConflict":"resend"}); stay silent ({"action":"ignore"}); or send anyway without the freshness check ({"action":"reply","content":"<draft>","onConflict":"anyway"}).',
  );
  lines.push(
    'Reply with JSON only: {"action":"reply"|"ignore","content":"...","onConflict":"revise"|"resend"|"silent"|"anyway"}',
  );
  lines.push("[worksplice:revision]");
  lines.push(roomMarker(input.targetId, input.held.roomSeq));
  return lines.join("\n");
}

// ----------------------------------------------------------------------------
// prompt 执行
// ----------------------------------------------------------------------------

// 11-收敛：PROMPT_DONE_EVENTS / SETTLE_EVENTS / BUSY_CWD_RETRY_DELAY_MS 唯一来源 lib/cwd-mutex；
// 本模块 re-export 以保持对既有测试（从 loop 导入）的兼容。
export { BUSY_CWD_RETRY_DELAY_MS, PROMPT_DONE_EVENTS, SETTLE_EVENTS };

/** 等待一次 prompt 完成（prompt_done / agent_end / agent_settled；prompt_error 视为失败）。 */
export function waitForPromptCompletion(
  session: LoopSession,
  timeoutMs = 10 * 60 * 1000,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    let unsub: () => void = () => {};
    const timer = setTimeout(() => {
      unsub();
      resolve({ ok: false, error: "prompt timed out" });
    }, timeoutMs);
    unsub = session.onEvent((event) => {
      if (event.type === "prompt_error") {
        clearTimeout(timer);
        unsub();
        resolve({
          ok: false,
          error: String(event.errorMessage ?? "prompt failed"),
        });
      } else if (PROMPT_DONE_EVENTS.has(event.type)) {
        clearTimeout(timer);
        unsub();
        resolve({ ok: true });
      }
    });
  });
}

/**
 * 等会话真正空闲：`prompt_done` 只说明这一轮 prompt 调用返回了，pi SDK 可能仍在收尾。
 * 此时再发下一个 prompt 会被 SDK 直接拒绝——原文是
 * "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp')
 *  to queue the message."；而 hold 后的 revise 正是「一轮之内发第二个 prompt」，
 * 所以发之前必须等。返回是否在超时前等到空闲：超时也照发，让 SDK 的原始错误如实暴露，
 * 不在这里把它变成静默失败。
 */
export async function waitForSessionIdle(
  session: LoopSession,
  timeoutMs = 10_000,
  pollMs = 100,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (session.isRunning() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return !session.isRunning();
}

/** 发 prompt 并等待完成，取最后一条 assistant 文本作为回复。 */
export async function promptSession(
  session: LoopSession,
  prompt: string,
  options: { idleTimeoutMs?: number } = {},
): Promise<{ ok: boolean; error?: string; text: string }> {
  await waitForSessionIdle(session, options.idleTimeoutMs);
  const completion = waitForPromptCompletion(session);
  try {
    await session.send({ type: "prompt", message: prompt });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      text: "",
    };
  }
  const result = await completion;
  if (!result.ok) return { ok: false, error: result.error, text: "" };
  const last = (await session.send({ type: "get_last_assistant_text" })) as
    | { text?: string }
    | undefined;
  const text = (last?.text ?? "").trim();
  // SDK 对模型/API 报错（如 openrouter 402）不 reject prompt()：事件流照发 prompt_done，
  // 但最后一条 assistant 无文本。空文本只能来自失败轮（合法的 ignore 也返回 JSON 文本），
  // 必须按失败处理——否则游标被 ack、消息被静默消费、agent 永不回复。
  if (!text)
    return {
      ok: false,
      error: "model returned no text (request failed?)",
      text: "",
    };
  return { ok: true, text };
}

// ----------------------------------------------------------------------------
// act：freshness-hold 四选一
// ----------------------------------------------------------------------------

export const MAX_REVISE_RETRIES = 2;
export const MAX_RESEND_RETRIES = 3;

export type ReplySender = (opts: {
  targetId: string;
  authorId: string;
  content: string;
  baseSeq?: number;
}) => SendMessageResult;

export type DeliverOutcome =
  | { status: "replied"; message: MessageRow; ackSeq: number }
  | { status: "anyway"; message: MessageRow; ackSeq: number }
  | { status: "silent"; reason?: string; ackSeq: number }
  | { status: "error"; reason?: string; ackSeq: number };

/**
 * 回复投递（§3.3/§6.3）：携带写稿时的 baseSeq 走 freshness 校验；
 * 被 held 后按 agent 指定的 onConflict 四选一执行。
 * send 可注入（默认 协作域 sendMessage）；promptFn 用于 revise 重写。
 * ackSeq = agent 本轮实际读到/被告知的最新房间版本（held 后按 roomSeq 推进，
 * 避免游标停在旧 baseSeq 导致 target 永久 pending）。
 */
export async function deliverWithFreshness(input: {
  targetId: string;
  agent: MemberRow;
  channel: ChannelRow;
  action: AgentAction;
  baseSeq: number;
  promptFn: (promptText: string) => Promise<string>;
  send?: ReplySender;
}): Promise<DeliverOutcome> {
  const send: ReplySender = input.send ?? ((opts) => sendMessage(opts));
  let action = input.action;
  let baseSeq = input.baseSeq;
  let ackSeq = input.baseSeq;
  let reviseRetries = 0;
  let resendRetries = 0;

  for (;;) {
    const result = send({
      targetId: input.targetId,
      authorId: input.agent.id,
      content: action.content,
      baseSeq,
    });
    if (!result.held)
      return { status: "replied", message: result.message, ackSeq };

    ackSeq = result.roomSeq;
    switch (action.onConflict) {
      case "anyway": {
        // --anyway 逃逸口：连续 hold 后的显式绕过（不带 baseSeq 重试）
        const forced = send({
          targetId: input.targetId,
          authorId: input.agent.id,
          content: action.content,
        });
        if (forced.held)
          return {
            status: "silent",
            reason: "anyway send was held again",
            ackSeq,
          };
        return { status: "anyway", message: forced.message, ackSeq };
      }
      case "silent":
        return {
          status: "silent",
          reason: "agent chose to stay silent",
          ackSeq,
        };
      case "resend": {
        if (resendRetries >= MAX_RESEND_RETRIES) {
          return {
            status: "silent",
            reason: "resend retries exhausted",
            ackSeq,
          };
        }
        resendRetries += 1;
        baseSeq = result.roomSeq;
        continue;
      }
      case "revise":
      default: {
        if (reviseRetries >= MAX_REVISE_RETRIES) {
          return {
            status: "silent",
            reason: "revise retries exhausted",
            ackSeq,
          };
        }
        reviseRetries += 1;
        const revisedText = await input.promptFn(
          buildRevisionPrompt({
            channel: input.channel,
            originalContent: action.content,
            held: {
              roomSeq: result.roomSeq,
              whatHappened: result.whatHappened,
            },
            newMessages: getSince(input.targetId, baseSeq),
            targetId: input.targetId,
          }),
        );
        const revised = parseAgentAction(revisedText);
        if (revised.action === "ignore") {
          return { status: "silent", reason: "revised to ignore", ackSeq };
        }
        if (!revised.content) {
          // 11-整改：重写也退化（reply 无内容）与直接空 reply 路径归类一致 = error 轮——
          // 不推进游标（被 hold 的消息保持 pending 供下次 wake 重试）、error 状态点；
          // 不再是 silent：silent 会被 isAbandonedRound 标成「已放弃」badge，但实际会重试——badge 说谎。
          // 区别于 "revised to ignore"（ackSeq 已推进、真正终止，保持 silent）。
          return {
            status: "error",
            reason: "revised reply had no content",
            ackSeq: input.baseSeq,
          };
        }
        action = revised;
        baseSeq = result.roomSeq;
        continue;
      }
    }
  }
}

// ----------------------------------------------------------------------------
// runAgentRound：一轮 wake → drain → decide → act → reply → ack
// ----------------------------------------------------------------------------

export type RoundStatus =
  | "noop" // 无新消息
  | "skipped" // 无条件响应（未绑定/非成员/已回复）
  | "busy" // 会话正忙（driver 在 settle 后重试）
  | "busy-cwd" // 同 cwd 被他人会话占用（BusyCwdError；driver 等占用会话 settle 后重试）
  | "replied"
  | "ignored"
  | "silent"
  | "anyway"
  | "yielded" // 任务 claim 失败/房间变化：本轮让路（§3.7 自动认领）
  | "error";

export interface RoundOutcome {
  status: RoundStatus;
  reason?: string;
  message?: MessageRow;
  baseSeq?: number;
}

// ----------------------------------------------------------------------------
// 任务操作（§3.7 自动认领）：先 claim 再开工，claim 失败就让路
// ----------------------------------------------------------------------------

/** 任务状态更新的 freshness 重试上限（回复已落线程，状态更新是机械收口）。 */
export const MAX_TASK_STATUS_RETRIES = 3;

function taskInChannel(
  channelId: string,
  taskNumber: number,
): TaskRow | undefined {
  return getDb().getTaskByChannelNumber(channelId, taskNumber);
}

/**
 * 带任务操作的一轮（§3.7）：
 * - claim：先认领（channel freshness）；成功 → 回复投递到任务线程（thread freshness）；
 *   失败（held/conflict）→ 让路：不回复、channel 游标只推进到已读版本（更新的消息经 wake 重试）；
 * - complete：完成者置 in_review（互审约定）；回复先落线程，状态更新 held 时按 roomSeq 重试；
 * - unclaim：释放回池（owner 清空）。
 * 游标收口：channel 推进到本轮已读版本；任务线程仅在任务离开进行中状态时收口
 * （进行中时故意留口——回复落线程会自醒续工，下一轮 drain 自己的进度继续干，见 wake.ts）。
 */
export async function runTaskOperation(input: {
  agent: MemberRow;
  channel: ChannelRow;
  targetId: string;
  action: AgentAction;
  baseSeq: number;
  promptFn: (promptText: string) => Promise<string>;
  send?: ReplySender;
}): Promise<RoundOutcome> {
  const { agent, channel, action, baseSeq } = input;
  const taskOp = action.task;
  if (!taskOp) throw new Error("runTaskOperation requires a task op");
  const taskNumber = taskOp.number;

  const task = taskInChannel(channel.id, taskNumber);
  if (!task) {
    ack(agent.id, input.targetId, baseSeq);
    return {
      status: "yielded",
      reason: "task not found in this channel",
      baseSeq,
    };
  }
  // §6.3 写稿时版本：thread 回复用决策时刻的线程版本；状态更新用 agent 语境里的 channel 版本
  // （当前轮 drain 过 channel 则为其 maxSeq，否则取其已消费游标 = 上一轮读到的最新版本）
  const threadBaseSeq =
    input.targetId === task.message_id
      ? input.baseSeq
      : getDb().maxSeq(task.message_id);
  const channelVersion =
    input.targetId === channel.id
      ? input.baseSeq
      : getDb().getConsumedSeq(agent.id, channel.id);

  // ---- claim：先认领再开工；失败就让路 --------------------------------------
  if (taskOp.op === "claim") {
    const claim = claimTask({
      channelId: channel.id,
      taskNumber,
      memberId: agent.id,
      baseSeq,
    });
    if (claim.status !== "claimed") {
      ack(agent.id, input.targetId, baseSeq);
      return {
        status: "yielded",
        reason:
          claim.status === "held"
            ? "claim held — the room changed"
            : claim.status === "blocked"
              ? "claim blocked — task was reopened, awaiting the owner"
              : "claim conflict — task already claimed",
        baseSeq,
      };
    }
    const delivered = await deliverToTaskThread({
      agent,
      channel,
      targetId: input.targetId,
      anchorId: claim.task.anchor.id,
      action,
      threadBaseSeq,
      promptFn: input.promptFn,
      send: input.send,
    });
    ack(agent.id, input.targetId, baseSeq);
    return delivered;
  }

  // ---- complete / unclaim：须为本 agent 拥有的任务 ----------------------------
  if (task.owner_id !== agent.id) {
    ack(agent.id, input.targetId, baseSeq);
    return {
      status: "yielded",
      reason: "task is not owned by this agent",
      baseSeq,
    };
  }

  const replyOutcome =
    action.action === "reply" && action.content
      ? await deliverToTaskThread({
          agent,
          channel,
          targetId: input.targetId,
          anchorId: task.message_id,
          action,
          threadBaseSeq,
          promptFn: input.promptFn,
          send: input.send,
        })
      : { threadAckSeq: getDb().maxSeq(task.message_id) };

  // 状态收口（§6.3）：以 agent 语境里的 channel 版本起步，held 后按 roomSeq 重试；
  // 并发审查者已 close/reject（转移失效/越权）→ 不炸本轮：进展已在线程里，收口游标后让路
  const targetStatus = taskOp.op === "complete" ? "in_review" : "todo";
  let statusSeq = channelVersion;
  try {
    for (let attempt = 0; ; attempt += 1) {
      const result = updateTaskStatus({
        channelId: channel.id,
        taskNumber,
        status: targetStatus,
        memberId: agent.id,
        baseSeq: statusSeq,
      });
      if (result.status === "updated") break;
      if (attempt >= MAX_TASK_STATUS_RETRIES) {
        ack(agent.id, input.targetId, baseSeq);
        ack(agent.id, task.message_id, replyOutcome.threadAckSeq);
        return {
          status: "silent",
          reason: `${targetStatus} update held after ${MAX_TASK_STATUS_RETRIES} retries`,
          baseSeq,
        };
      }
      statusSeq = result.roomSeq;
    }
  } catch (error) {
    ack(agent.id, input.targetId, baseSeq);
    ack(agent.id, task.message_id, replyOutcome.threadAckSeq);
    return {
      status: "silent",
      reason: `${targetStatus} update failed: ${error instanceof Error ? error.message : String(error)}`,
      baseSeq,
    };
  }
  ack(agent.id, input.targetId, baseSeq);
  ack(agent.id, task.message_id, replyOutcome.threadAckSeq);
  if ("status" in replyOutcome && replyOutcome.status === "error") {
    // 11-整改：线程回复失败（revised 空内容等）= error 轮——不标「已放弃」badge；
    // 线程游标停在已读版本、被 hold 的消息保持 pending，下次 wake 续工重试
    // （任务状态收口已完成，不阻塞；claim 路径的同类 error 也透传）
    return {
      status: "error",
      reason:
        "reason" in replyOutcome
          ? replyOutcome.reason
          : "reply delivery failed",
      baseSeq,
    };
  }
  return {
    status: "silent",
    reason: `task ${taskOp.op} → ${targetStatus}`,
    baseSeq,
  };
}

/** 把回复投递到任务线程（thread 自己的 seq 空间与 freshness），返回线程版本；游标由调用方收口。 */
async function deliverToTaskThread(input: {
  agent: MemberRow;
  channel: ChannelRow;
  targetId: string;
  anchorId: string;
  action: AgentAction;
  threadBaseSeq: number;
  promptFn: (promptText: string) => Promise<string>;
  send?: ReplySender;
}): Promise<RoundOutcome & { threadAckSeq: number }> {
  const outcome = await deliverWithFreshness({
    targetId: input.anchorId,
    agent: input.agent,
    channel: input.channel,
    action: input.action,
    baseSeq: input.threadBaseSeq,
    promptFn: input.promptFn,
    send: input.send,
  });
  const delivered = "message" in outcome ? outcome.message : undefined;
  const threadAckSeq = delivered
    ? delivered.seq
    : (outcome.ackSeq ?? input.threadBaseSeq);
  return {
    status: outcome.status,
    message: delivered,
    // 11：透传失败原因（revised 空内容等），任务路径的 error 轮 reason 不丢失
    reason: "reason" in outcome ? outcome.reason : undefined,
    // baseSeq 此处为线程版本（非 channel 版本）：线程收口用，见调用方 ack
    baseSeq: threadAckSeq,
    threadAckSeq,
  };
}

/** §3.7 任务延续信号：agent 拥有锚定于此目标（线程）的 in_progress 任务。 */
export function ownsInProgressTaskAt(
  agentId: string,
  targetId: string,
): boolean {
  const task = getDb().getTaskByMessageId(targetId);
  return Boolean(
    task && task.status === "in_progress" && task.owner_id === agentId,
  );
}

/** §05 确定信号：当轮 incoming 里个人 @mention 了本 agent，或本 agent 是进行中任务 owner
 * 且任务线程来了别人的消息——这类轮次必须回应，ignore 按失败处理（rubric 同款标准）。 */
export function hasMustRespondSignal(
  agentId: string,
  targetId: string,
  incoming: Array<{ content: string; author_id: string }>,
): boolean {
  if (
    incoming.some((message) =>
      extractMentionedMemberIds(message.content).includes(agentId),
    )
  ) {
    return true;
  }
  // DM 确定信号（R4）：DM target 下作者为 owner（人类）的消息必须回应。
  // DM 内 agent 自己的消息/系统事件已由 drain 的 author 过滤与 reminder 轮次规则
  // 挡在 incoming 之外，此处的 owner 消息即真实的人类私信。
  if (
    incoming.length > 0 &&
    isDM(targetId) &&
    incoming.some((message) => message.author_id === OWNER_MEMBER_ID)
  ) {
    return true;
  }
  if (incoming.length > 0 && ownsInProgressTaskAt(agentId, targetId)) {
    return true;
  }
  return false;
}

/**
 * channel 目标的无信号短消息判定（greeting 乒乓收敛）：
 * 一条人类消息扇出后，各 agent 的"收到/在的"式 greeting 回复会互相 wake，
 * 形成"你回我也回"的乒乓（rubric 本就要求 MUST ignore 小 talk，但模型不总遵守）。
 * 这类消息：作者是 agent（人类消息永不过滤）+ 没 @我 + 无问号 + 无任务引用 + 短文本
 * → 视为 noise：不触发 prompt，直接 ack 越过（静默消费）。
 * 只用于 channel 主流程；thread 目标不过滤（任务协作信号优先，见 hasMustRespondSignal）。
 */
export const CHANNEL_NOISE_MAX_LENGTH = 80;

export function isChannelNoise(
  agentId: string,
  message: {
    content: string;
    author_id: string;
    author?: { type?: string } | null;
  },
): boolean {
  // 人类（Owner）消息永不过滤
  if (message.author?.type === "human") return false;
  // @了我 = 注意力信号，不是 noise
  if (extractMentionedMemberIds(message.content).includes(agentId))
    return false;
  // 问号 = 可能是问题
  if (/[?？]/.test(message.content)) return false;
  // 任务引用 = 实质内容
  if (/task\s*#\d+/i.test(message.content)) return false;
  // 长文本 = 可能是实质内容（保守不过滤）
  if (message.content.length > CHANNEL_NOISE_MAX_LENGTH) return false;
  return true;
}

/** MEMORY.md 路径（ADR-0001）：家目录预置存在才告知 agent，缺失不补种。 */
export function agentMemoryFile(agent: MemberRow): string | null {
  const file = join(agentHomePath(agent), MEMORY_FILE_NAME);
  return existsSync(file) ? file : null;
}

export async function runAgentRound(
  agentId: string,
  targetId: string,
  runtime?: LoopRuntime,
  reason: "message" | "reminder" = "message",
): Promise<RoundOutcome> {
  const rt: LoopRuntime = runtime ?? (await getAgentRuntime());
  const agent = getAgent(agentId);
  if (!agent.workspace_path)
    return { status: "skipped", reason: "no workspace bound" };
  const channel = resolveTargetChannel(targetId);
  if (!channel) return { status: "skipped", reason: "unknown target" };
  if (channel.archived === 1)
    return { status: "skipped", reason: "channel archived" };

  const drained = drain(agentId, targetId);
  if (drained.messages.length === 0)
    return { status: "noop", baseSeq: drained.maxSeq };
  // 本轮房间版本（回复 freshness + error 轮 baseSeq 共用；= drain 时的 max(seq)）
  const baseSeq = drained.maxSeq;
  const incoming = drained.messages.filter(
    (message) => message.author_id !== agent.id,
  );
  // greeting 乒乓收敛：channel 主流程里，其他 agent 的无信号短 greeting
  // （收到/在的式 ack，无 @我、无问号、无任务引用）不触发 prompt——
  // 直接从 incoming 剔除，后续走正常 noop/skip 路径 ack 越过（静默消费）。
  // thread 目标不过滤（任务协作信号优先）。
  const effectiveIncoming =
    targetId === channel.id
      ? incoming.filter((message) => !isChannelNoise(agentId, message))
      : incoming;
  // §3.2 @mention = 注意力信号而非投递过滤：未加入 channel 的 agent 被个人 @mention
  // 时穿透送达——非成员仍推进本轮（drain 语境可见），未被 mention 则跳过。
  const isMember = isChannelMember(channel.id, agent.id);
  if (!isMember) {
    const mentioned = effectiveIncoming.some((message) =>
      extractMentionedMemberIds(message.content).includes(agent.id),
    );
    if (!mentioned) {
      return { status: "skipped", reason: "not a member of the channel" };
    }
  }
  // §3.7 任务延续：drain 到的全是我自己的回复，但我在该线程有进行中的任务
  // （自醒续工信号：回复落任务线程 → 继续干或 complete，见 wake.ts）
  const continuing = ownsInProgressTaskAt(agentId, targetId);
  // §3.9 reminder 唤醒：系统提醒消息以作者署名投递（作者本人视角 = 全是自己的消息），
  // reminder 驱动的轮次不能按"只有自己的消息"跳过——agent 要看到自己的提醒并行动
  const reminderDriven = reason === "reminder";
  if (effectiveIncoming.length === 0 && !continuing && !reminderDriven) {
    ack(agentId, targetId, drained.maxSeq);
    return {
      status: "noop",
      reason:
        incoming.length === 0
          ? "only the agent's own messages"
          : "only channel noise (agent greetings)",
      baseSeq: drained.maxSeq,
    };
  }
  // 崩溃窗口（回复已写、游标未推）内的自愈：最新消息是自己的回复 → 只推进游标，不重复应答
  const latest = getDb().getLatestMessage(targetId);
  if (
    latest &&
    latest.author_id === agent.id &&
    !continuing &&
    !reminderDriven
  ) {
    ack(agentId, targetId, drained.maxSeq);
    return {
      status: "skipped",
      reason: "already replied to the latest message",
      baseSeq: drained.maxSeq,
    };
  }

  let session = rt.findSession(agent);
  if (!session) {
    try {
      await rt.startSession(agent);
    } catch (error) {
      // 02-决策一：BusyCwdError 是瞬态（占用会话必然 settle）——映射为 busy-cwd，
      // driver 等占用会话 settle 后重试：不丢 hint、状态不变 error（error 轮会被丢弃）。
      if (error instanceof BusyCwdError) {
        // 07-承诺：busy-cwd 轮同 error 轮——携带本轮 drain 的房间版本（round_logs base_seq 非 0）
        return { status: "busy-cwd", reason: error.message, baseSeq };
      }
      publishAgentStatus(agent.id, "error");
      return {
        status: "error",
        reason: error instanceof Error ? error.message : String(error),
        // 11-整改：error 轮携带本轮 drain 的房间版本（round_logs base_seq 非 0）
        baseSeq,
      };
    }
    session = rt.findSession(agent);
  }
  if (!session) return { status: "skipped", reason: "no session after start" };
  if (session.isRunning()) return { status: "busy" };

  publishAgentStatus(agent.id, "working");
  const prompt = buildReplyPrompt({
    agent,
    channel,
    messages:
      effectiveIncoming.length > 0 ? effectiveIncoming : drained.messages,
    tasks: listRelatedTasks(targetId),
    targetId,
    baseSeq,
    memoryFile: agentMemoryFile(agent),
  });
  try {
    const first = await promptSession(session, prompt);
    if (!first.ok) {
      publishAgentStatus(agent.id, "error");
      // 11-整改：prompt-fail 的 error 轮携带本轮 drain 的房间版本
      return { status: "error", reason: first.error, baseSeq };
    }
    const action = parseAgentAction(first.text);
    // §3.7 任务操作：先 claim 再开工；claim 失败就让路（不回复、只收口游标）
    if (action.task) {
      // 非成员无 channel 成员资格，不做任务操作（claim 服务层会拒绝）
      if (!isMember) {
        ack(agentId, targetId, baseSeq);
        return {
          status: "yielded",
          reason: "not a member of the channel",
          baseSeq,
        };
      }
      const outcome = await runTaskOperation({
        agent,
        channel,
        targetId,
        action,
        baseSeq,
        promptFn: async (revisionPrompt) => {
          const revised = await promptSession(session, revisionPrompt);
          return revised.ok ? revised.text : "";
        },
      });
      if (outcome.status === "error") {
        // 05-终检整改：任务 error 轮不是成功轮——不重置 must-respond streak
        // （与 reply 路径一致：成功投递/任务收口/无信号 ignore 才重置）。
        // 否则模型可交替「ignore → 任务 error」无限规避 cap-ack 逃逸口。
        publishAgentStatus(agent.id, "error");
      } else {
        resetMustRespondFailures(agent.id, targetId);
        publishAgentStatus(agent.id, "online");
      }
      return outcome;
    }
    if (action.action === "ignore") {
      // §05 兜底：确定信号（个人 @mention / 进行中任务线程收到他人消息）下 ignore 不合法——
      // 本轮按失败处理（不 ack、error 状态点可见、触发消息保持 pending 供下次 wake 重试）。
      // 连续失败达 MUST_RESPOND_FAILURE_CAP 后 ack 并记 error：防模型系统性 ignore 造成的
      // 永久 pending + 反复失败（cap-ack 是逃逸口，状态点仍可见 error）。
      if (hasMustRespondSignal(agent.id, targetId, effectiveIncoming)) {
        const failures = recordMustRespondFailure(agent.id, targetId);
        publishAgentStatus(agent.id, "error");
        if (failures >= MUST_RESPOND_FAILURE_CAP) {
          ack(agentId, targetId, baseSeq);
          resetMustRespondFailures(agent.id, targetId);
          console.error(
            `[worksplice] agent ${agent.name} ignored a must-respond signal ${MUST_RESPOND_FAILURE_CAP} times; cursor acked at ${baseSeq} (capped)`,
          );
          return {
            status: "error",
            reason: `ignore on must-respond signal (capped at ${MUST_RESPOND_FAILURE_CAP})`,
            baseSeq,
          };
        }
        return {
          status: "error",
          reason: "ignore on must-respond signal",
          baseSeq,
        };
      }
      resetMustRespondFailures(agent.id, targetId);
      ack(agentId, targetId, baseSeq);
      return { status: "ignored", baseSeq };
    }
    if (!action.content) {
      // §3.8 空内容回复（模型退化输出 {"action":"reply"} 无 content）：声明了 reply
      // 却给不出文本 = 本轮失败，与空文本同语义——不推进游标、publish error，触发消息
      // 保持 pending 供下次 wake 重试；否则消息被静默消费、agent 永不回复。
      publishAgentStatus(agent.id, "error");
      return {
        status: "error",
        reason: "reply action without content",
        baseSeq,
      };
    }
    // §3.2 mention 穿透的回复：agent 可自行加入公开 channel（加入 = 订阅全部消息）；
    // 私有 channel 不能自行加入——回复不可投递，收口游标后静默让路
    if (!isMember) {
      if (channel.type === "private") {
        ack(agentId, targetId, baseSeq);
        return {
          status: "silent",
          reason: "not a member of the private channel",
          baseSeq,
        };
      }
      joinChannel(channel.id, agent.id);
    }
    const outcome = await deliverWithFreshness({
      targetId,
      agent,
      channel,
      action,
      baseSeq,
      promptFn: async (revisionPrompt) => {
        const revised = await promptSession(session, revisionPrompt);
        return revised.ok ? revised.text : "";
      },
    });
    if (outcome.status === "error") {
      // 11-整改：revised 空内容 = error 轮——不推进游标（触发消息保持 pending 供下次 wake
      // 重试）、error 状态点；与直接空 reply 路径（reply action without content）归类一致
      publishAgentStatus(agent.id, "error");
      return {
        status: "error",
        reason: outcome.reason,
        baseSeq: outcome.ackSeq,
      };
    }
    // ack 到 agent 本轮实际读到/被告知的房间版本（held 后随 roomSeq 推进）
    // 11-整改（自激循环）：续工轮（任务 in_progress 线程、drain 全是自己消息）回复落库后，
    // 游标必须推进到回复自身——否则每次回复都触发 wake 自醒、drain 又看到自己的回复，
    // 形成无界续工循环（模型不 complete 时反复回复 progress + 自 @mention）。
    // replied/anyway 都有消息落库（anyway 的回复 seq = roomSeq+1，仅 ack 到 roomSeq
    // 同样漏掉回复自身），统一按落库消息的 seq 收口。
    ack(
      agentId,
      targetId,
      continuing &&
        targetId !== channel.id &&
        (outcome.status === "replied" || outcome.status === "anyway")
        ? (outcome.message?.seq ?? outcome.ackSeq ?? baseSeq)
        : (outcome.ackSeq ?? baseSeq),
    );
    resetMustRespondFailures(agent.id, targetId);
    publishAgentStatus(agent.id, "online");
    if (outcome.status === "silent") {
      return {
        status: "silent",
        reason: outcome.reason,
        baseSeq: outcome.ackSeq,
      };
    }
    return {
      status: outcome.status,
      message: outcome.message,
      baseSeq: outcome.ackSeq,
    };
  } catch (error) {
    publishAgentStatus(agent.id, "error");
    // 11-整改：catch 的 error 轮携带本轮 drain 的房间版本
    return {
      status: "error",
      reason: error instanceof Error ? error.message : String(error),
      baseSeq,
    };
  }
}

// ----------------------------------------------------------------------------
// driver 编排（§5.4，原 driver.ts）：把 wake hint 编排成逐 agent 串行的 runAgentRound。
// - 每个 agent 一个 FIFO 队列；同一 (agent, target) 的并发 hint 合并（一次 drain 取尽）；
// - 合并保留 reason 的宽松侧：只要 hint 里有 reminder 就以 reminder 处理
//   （reminder 轮不跳过"只有自己的消息"，message 轮次覆盖；反之会丢自提醒）；
// - 会话正忙（busy / 同 cwd 被他人占用 busy-cwd）时不丢 hint：在 settle 事件后重试一次；
// - 状态全部挂 globalThis（热重载安全）；runtime 可注入（测试传 fake）。
// ----------------------------------------------------------------------------

interface QueuedTarget {
  targetId: string;
  reason: WakeReason;
}

interface DriverState {
  started: boolean;
  runtime: LoopRuntime | null;
  stopWake: (() => void) | null;
  queues: Map<string, QueuedTarget[]>;
  processing: Set<string>;
  waitingForSettle: Set<string>;
  settleUnsubs: Map<string, () => void>;
}

declare global {
  var __workspliceAgentLoopDriver: DriverState | undefined;
}

function getDriverState(): DriverState {
  if (!globalThis.__workspliceAgentLoopDriver) {
    globalThis.__workspliceAgentLoopDriver = {
      started: false,
      runtime: null,
      stopWake: null,
      queues: new Map(),
      processing: new Set(),
      waitingForSettle: new Set(),
      settleUnsubs: new Map(),
    };
  }
  return globalThis.__workspliceAgentLoopDriver;
}

export function startAgentLoopDriver(
  deps: { runtime?: LoopRuntime } = {},
): () => void {
  const state = getDriverState();
  if (state.started) return stopAgentLoopDriver;
  state.started = true;
  state.runtime = deps.runtime ?? null;
  state.stopWake = subscribeWake(enqueueWake);
  return stopAgentLoopDriver;
}

export function stopAgentLoopDriver(): void {
  const state = getDriverState();
  if (!state.started) return;
  state.started = false;
  state.stopWake?.();
  state.stopWake = null;
  state.queues.clear();
  state.processing.clear();
  state.waitingForSettle.clear();
  for (const unsub of state.settleUnsubs.values()) unsub();
  state.settleUnsubs.clear();
  state.runtime = null;
}

/** 测试观察用：当前排队中的 (agent, target, reason) 清单。 */
export function peekAgentLoopQueues(): Array<{
  agentId: string;
  entries: Array<{ targetId: string; reason: WakeReason }>;
}> {
  return Array.from(getDriverState().queues, ([agentId, targets]) => ({
    agentId,
    entries: targets.map((entry) => ({
      targetId: entry.targetId,
      reason: entry.reason,
    })),
  }));
}

/** 测试观察用：当前正在等待 settle 的 agent 清单（busy/busy-cwd 等待中）。 */
export function peekAgentLoopSettleWaiters(): string[] {
  return [...getDriverState().waitingForSettle];
}

function enqueueWake(hint: WakeHint): void {
  const state = getDriverState();
  if (!state.started) return;
  let queue = state.queues.get(hint.agentId);
  if (!queue) {
    queue = [];
    state.queues.set(hint.agentId, queue);
  }
  const existing = queue.find((entry) => entry.targetId === hint.targetId);
  if (existing) {
    // 同 (agent, target) 合并：reminder 是更宽松的处理模式（不跳过自己的消息），
    // 已排队的 message 轮升级为 reminder 轮也不损失什么；反之会丢自提醒
    if (hint.reason === "reminder") existing.reason = "reminder";
    return;
  }
  queue.push({ targetId: hint.targetId, reason: hint.reason });
  void processAgent(hint.agentId);
}

async function processAgent(agentId: string): Promise<void> {
  const state = getDriverState();
  if (state.processing.has(agentId)) return;
  if (state.waitingForSettle.has(agentId)) return;

  const runtime: LoopRuntime = state.runtime ?? (await getAgentRuntime());
  state.processing.add(agentId);
  try {
    for (;;) {
      const queue = state.queues.get(agentId);
      const queued = queue?.shift();
      if (!queued) break;

      let outcome;
      try {
        outcome = await runAgentRound(
          agentId,
          queued.targetId,
          runtime,
          queued.reason,
        );
      } catch (error) {
        // 成员已删除 / target 消失等：跳过该轮，继续队列
        console.error(
          "[worksplice] agent loop round failed:",
          error instanceof Error ? error.message : String(error),
        );
        continue;
      }
      // §07 轮次结果落盘（有结论的轮次；noop/skipped/busy 由服务层过滤）。
      // driver 是 runAgentRound 的唯一生产调用点（index.ts 仅 re-export 供测试）。
      logRoundOutcome(agentId, queued.targetId, outcome);
      if (outcome.status === "busy" || outcome.status === "busy-cwd") {
        waitForSettle(agentId, queued.targetId, queued.reason);
        break;
      }
    }
  } finally {
    state.processing.delete(agentId);
  }
  if (
    state.queues.get(agentId)?.length &&
    !state.waitingForSettle.has(agentId)
  ) {
    void processAgent(agentId);
  }
}

// 11-收敛：busy-cwd 重试改用 cwd-mutex 原语（waitForCwdSettle + scheduleBusyRetry），行为不变。
async function waitForSettle(
  agentId: string,
  targetId: string,
  reason: WakeReason,
): Promise<void> {
  const state = getDriverState();
  if (state.waitingForSettle.has(agentId)) return;
  state.waitingForSettle.add(agentId);
  const retry = () => {
    state.waitingForSettle.delete(agentId);
    const unsub = state.settleUnsubs.get(agentId);
    if (unsub) {
      unsub();
      state.settleUnsubs.delete(agentId);
    }
    const queue = state.queues.get(agentId);
    if (queue && !queue.some((entry) => entry.targetId === targetId)) {
      queue.push({ targetId, reason });
    }
    void processAgent(agentId);
  };
  try {
    const agent = getAgent(agentId);
    const runtime: LoopRuntime = state.runtime ?? (await getAgentRuntime());
    // 02-决策一：自身无会话的 busy-cwd 等占用该 cwd 的会话 settle；
    // 自身有会话的 busy 等自己 settle。两者同一条等待路径。
    const waitTarget =
      runtime.findSession(agent) ??
      (agent.workspace_path
        ? runtime.findBusySessionForCwd?.(agent.workspace_path)
        : undefined);
    if (!waitTarget) {
      // starting 窗口（对方会话尚未入 registry）：退避后重试，避免热自旋。
      // 11-收敛：退避由 cwd-mutex 的 scheduleBusyRetry 提供（BUSY_CWD_RETRY_DELAY_MS 唯一来源）。
      const cancel = scheduleBusyRetry(retry);
      state.settleUnsubs.set(agentId, cancel);
      return;
    }
    // 11-收敛：settle 等待由 cwd-mutex 的 waitForCwdSettle 提供（SETTLE_EVENTS 唯一来源 + 订阅后 isRunning 复核）。
    // SAFETY: waitTarget 是 LoopSession，结构上满足 SettleableSession（isRunning + onEvent）；
    // 仅接口名不同，且 LoopSession 的 onEvent 监听器参数更宽（{type:string}&Record<string,unknown>）——
    // 逆变安全，cast 仅弥合类型命名差异，无运行时风险。
    const unsub = waitForCwdSettle(
      waitTarget as unknown as import("../cwd-mutex.ts").SettleableSession,
      retry,
    );
    state.settleUnsubs.set(agentId, unsub);
  } catch {
    retry();
  }
}

// ----------------------------------------------------------------------------
// 崩溃恢复补拉（§5.3，原 backfill.ts）：启动时按 seq 补拉。
// 双写流中 消息表是房间事实唯一来源；agent 回复的写序是
// SDK 写 session jsonl → app 读回补写 SQLite。若在两步之间崩溃，SQLite 落后于
// session jsonl 的已投递回复——本模块扫描 jsonl（user 条目携带的 target 标记，
// 见 roomMarker）找回缺失的 assistant 回复，按序补写并推进消费游标。
// 只读不解析 pi 原生文件（读写权归 SDK），不 import SDK（保持启动路径轻量）。
//
// 与实时路径同构：一个标记轮只投递最后一条 assistant 文本（revise 的草稿、
// 工具调用中间产物都会被后续条目覆盖）；回复内容按 parseAgentAction 解析
// （JSON 协议取 content，非 JSON 整段为内容，ignore 不落库）。
// ----------------------------------------------------------------------------

export interface SessionReply {
  targetId: string;
  markerSeq: number;
  content: string;
}

/**
 * 解析 session jsonl 文件头（type:"session" 条目）的 cwd 字段。
 * 与 SDK SessionManager.listAll 的 cwd 同源（同从 header 解析，已核对），
 * 使 backfill 做归属校验时无需 import SDK（保持启动路径轻量）。
 */
export function readSessionHeaderCwd(filePath: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { type?: string; cwd?: unknown };
      if (
        entry?.type === "session" &&
        typeof entry.cwd === "string" &&
        entry.cwd
      ) {
        return entry.cwd;
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * 固化引用的 session 文件集合（不含本成员自己的登记；含 soft-deleted 成员——
 * ticket 08：软删行保留 pi_session_file 是 ADR-0003 的所有权凭证，被删成员仍登记
 * 的文件同样不得由其他成员补写）。
 */
function referencedSessionFilesExcluding(agentId: string): Set<string> {
  const referenced = new Set<string>();
  for (const member of getDb().listMembersIncludingDeleted()) {
    if (member.id === agentId) continue;
    if (member.pi_session_file)
      referenced.add(normalize(member.pi_session_file));
  }
  return referenced;
}

/**
 * backfill 归属门禁（ticket 04，ADR-0003 的 backfill 侧落地，文件级）：
 * 补写前确认该文件仍属于该 agent——
 * 1. header cwd 必须等于成员 workspace（跨 cwd 错绑 = 历史脏数据）；
 * 2. 文件不得被其他活成员固化引用（03 修复前双绑定残留 → 防同文件双作者补写）；
 * 3. 文件 mtime 不得早于成员创建时间（成员不可能在自己创建之前拥有会话——
 *    继承自 deleted/他人 agent 的旧文件必然更老，确定性规则无逻辑误杀）。
 * 任一不过 → 整文件跳过：不补写、不推进游标（避免"只补写跳过、游标却推进"的半截态）。
 */
export function backfillOwnershipGate(
  agent: MemberRow,
  referencedByOthers: ReadonlySet<string>,
): { pass: boolean; reason: string | null } {
  const file = agent.pi_session_file;
  if (!file) return { pass: false, reason: "no session file bound" };
  if (!existsSync(file))
    return { pass: false, reason: "session file missing on disk" };
  if (!agent.workspace_path)
    return { pass: false, reason: "member has no workspace" };
  const headerCwd = readSessionHeaderCwd(file);
  if (headerCwd === null) {
    return { pass: false, reason: "session file header has no cwd" };
  }
  if (normalize(headerCwd) !== normalizeWorkspacePath(agent.workspace_path)) {
    return {
      pass: false,
      reason: `header cwd (${headerCwd}) != workspace (${agent.workspace_path})`,
    };
  }
  if (referencedByOthers.has(normalize(file))) {
    return {
      pass: false,
      reason: "session file also referenced by another member",
    };
  }
  const mtime = statSync(file).mtime.getTime();
  const createdAt = new Date(agent.created_at).getTime();
  if (mtime < createdAt) {
    return {
      pass: false,
      reason: `file mtime (${new Date(mtime).toISOString()}) predates member creation (${agent.created_at})`,
    };
  }
  return { pass: true, reason: null };
}

/** 从 message.content（string 或 text 块数组）提取纯文本；两处内容分支共用（02-review 提取）。 */
function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (block) =>
          block &&
          typeof block === "object" &&
          (block as { type?: string }).type === "text",
      )
      .map((block) => (block as { text?: string }).text ?? "")
      .join("\n");
  }
  return "";
}

/** 解析 session jsonl：每个房间标记之后只保留最后一条 assistant 文本作为该轮回复。 */
export function scanSessionReplies(filePath: string): SessionReply[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }
  const replies: SessionReply[] = [];
  let current: { targetId: string; seq: number } | null = null;
  let pendingText: string | null = null;

  const flush = () => {
    if (current && pendingText) {
      const parsed = parseAgentAction(pendingText);
      if (parsed.action === "reply" && parsed.content) {
        replies.push({
          targetId: current.targetId,
          markerSeq: current.seq,
          content: parsed.content,
        });
      }
    }
    pendingText = null;
  };

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry: {
      type?: string;
      message?: { role?: string; content?: unknown };
    };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== "message" || !entry.message) continue;
    const message = entry.message;
    if (message.role === "user") {
      const text = textFromContent(message.content);
      const match = ROOM_MARKER_PATTERN.exec(text);
      // 新的 user 条目（无论是否带标记）结束上一轮；带标记才开启新的 协作轮。
      // 若该条目是 revise prompt（带 [worksplice:revision]），上一轮 assistant 是
      // 被 held 的草稿（实时路径从未落库）——丢弃而非按回复补写。
      if (!text.includes("[worksplice:revision]")) flush();
      pendingText = null;
      current = match ? { targetId: match[1], seq: Number(match[2]) } : null;
      continue;
    }
    if (message.role !== "assistant") continue;
    const text = textFromContent(message.content).trim();
    if (!text) continue;
    pendingText = text; // 最后一条胜出
  }
  flush();
  return replies;
}

export interface BackfillResult {
  inserted: number;
  targets: string[];
}

/**
 * 单个 agent 的补拉：缺失回复按序补写。
 * 游标推进到每个标记轮的标记 seq（标记存在即证明该轮 prompt 已进入 agent 上下文，
 * agent 读过 ≤ 标记 seq 的全部消息）——即使回复已存在（崩溃于补写后 ack 前）也推进。
 */
export function backfillAgentReplies(agent: MemberRow): BackfillResult {
  const file = agent.pi_session_file;
  if (!file || !existsSync(file)) return { inserted: 0, targets: [] };

  // ticket 04 归属门禁：文件级校验不过 → 整文件跳过（不补写、不推进游标）。
  const gate = backfillOwnershipGate(
    agent,
    referencedSessionFilesExcluding(agent.id),
  );
  if (!gate.pass) {
    console.warn(
      `[backfill] skipping session file ${file} for member ${agent.id}: ${gate.reason}`,
    );
    return { inserted: 0, targets: [] };
  }

  const replies = scanSessionReplies(file);
  if (replies.length === 0) return { inserted: 0, targets: [] };

  const db = getDb();
  let inserted = 0;
  const targets = new Set<string>();
  const cursorByTarget = new Map<string, number>();
  const contentBlockedTargets = new Set<string>();
  db.withTransaction(() => {
    for (const reply of replies) {
      // ticket 04 轮级兑底（跨作者内容去重）：同 target 同内容已被他人落库 =
      // 疑似继承文件的他人回复（soft-delete 保留消息）——跳过补写，且该 target
      // 游标不推进（保持 pending，留给正常 wake 流程重读重做），避免把他人回复
      // 冒充为本 agent 的投递。真实崩溃恢复中同内容跨作者几乎不可能（各 agent
      // 回复独立），误杀率极低。
      if (
        db.hasMessageByContentByOther(reply.targetId, agent.id, reply.content)
      ) {
        contentBlockedTargets.add(reply.targetId);
        continue;
      }
      cursorByTarget.set(
        reply.targetId,
        Math.max(cursorByTarget.get(reply.targetId) ?? 0, reply.markerSeq),
      );
      if (db.hasMessage(reply.targetId, agent.id, reply.content)) continue;
      const seq = db.maxSeq(reply.targetId) + 1;
      db.insertMessageAt({
        targetId: reply.targetId,
        authorId: agent.id,
        content: reply.content,
        seq,
      });
      inserted += 1;
      targets.add(reply.targetId);
    }
  });
  if (contentBlockedTargets.size > 0) {
    console.warn(
      `[backfill] member ${agent.id}: skipped ${contentBlockedTargets.size} reply round(s) whose ` +
        `content already exists under another author (targets: ${[...contentBlockedTargets].join(", ")}); ` +
        `cursor left pending for re-read`,
    );
  }
  for (const [targetId, seq] of cursorByTarget) {
    db.setConsumedSeq(
      agent.id,
      targetId,
      Math.max(db.getConsumedSeq(agent.id, targetId), seq),
    );
  }
  return { inserted, targets: [...targets] };
}

/** 启动时全量补拉（对所有未删除 agent）；补写直接落库，不触发 wake。 */
export function backfillAllAgents(): BackfillResult {
  let inserted = 0;
  const targets = new Set<string>();
  for (const agent of listAgents()) {
    const result = backfillAgentReplies(agent);
    inserted += result.inserted;
    for (const targetId of result.targets) targets.add(targetId);
  }
  return { inserted, targets: [...targets] };
}

// ----------------------------------------------------------------------------
// reminder cron（§5.6，原 reminder-cron.ts）：进程常驻期间逐分钟轮询 reminders 表
// （status=scheduled 且 fire_at <= now）→ 触发（fireDueReminders）。
// 状态挂 globalThis 扛热重载；now 可注入（测试）；timer 幂等启停。
// ----------------------------------------------------------------------------

interface CronState {
  started: boolean;
  timer: NodeJS.Timeout | null;
  pollMs: number;
  now: () => Date;
}

declare global {
  var __workspliceReminderCron: CronState | undefined;
}

/** 轮询周期（§5.6 逐分钟）。 */
export const REMINDER_POLL_MS = 60_000;

function getCronState(): CronState {
  if (!globalThis.__workspliceReminderCron) {
    globalThis.__workspliceReminderCron = {
      started: false,
      timer: null,
      pollMs: REMINDER_POLL_MS,
      now: () => new Date(),
    };
  }
  return globalThis.__workspliceReminderCron;
}

export function startReminderCron(
  deps: { pollMs?: number; now?: () => Date } = {},
): () => void {
  const state = getCronState();
  if (state.started) return stopReminderCron;
  state.started = true;
  state.pollMs = deps.pollMs ?? REMINDER_POLL_MS;
  state.now = deps.now ?? (() => new Date());
  state.timer = setInterval(() => {
    try {
      tickReminderCron(state.now());
    } catch (error) {
      console.error(
        "[worksplice] reminder cron tick failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }, state.pollMs);
  return stopReminderCron;
}

export function stopReminderCron(): void {
  const state = getCronState();
  if (!state.started) return;
  state.started = false;
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

/** 单轮扫描（cron interval 与测试共用）：返回本次触发的提醒数。 */
export function tickReminderCron(now: Date = new Date()): number {
  const outcomes = fireDueReminders(now);
  return outcomes.filter((outcome) => outcome.status === "fired").length;
}

// ----------------------------------------------------------------------------
// AgentLoop 公共接口（Ticket 02 窄面）：start / stop / tick。
// start 组装全套服务（幂等，原 index.ts startAgentLoop 语义）：
// 1. 状态点低频扫掠（兜底 idle shutdown 漂移）；
// 2. 崩溃恢复：启动时按 seq 补拉（SQLite 落后于 session jsonl 的回复按序补写，§5.3）；
// 3. wake 驱动：新消息 → 唤醒对应 agent 的 loop（§5.4）；
// 4. reminder cron：逐分钟轮询 reminders 表触发到点提醒（§5.6）。
// tick = 手动推进一次 cron 扫描（测试/诊断入口）；driver 本身是事件驱动（wake → 队列），
// 无 tick 语义。runtime/pollMs/now 可注入（测试传 fake runtime / 假时钟）。
// ----------------------------------------------------------------------------

export interface AgentLoop {
  /** 幂等启动全套服务：状态扫掠 + 崩溃恢复补拉 + wake 驱动 + reminder cron。 */
  start(): void;
  /** 幂等停止：取消 wake 订阅与 cron 定时器、清空驱动队列（重复 stop 不炸）。 */
  stop(): void;
  /**
   * 手动推进一次 reminder cron 扫描（测试/诊断入口；等价 cron 定时器的一轮 tick）。
   * 注意：仅覆盖 cron 子组件——driver 是事件驱动的（wake → 队列），没有 tick 语义。
   */
  tick(): void;
}

export function createAgentLoop(
  deps: { runtime?: LoopRuntime; pollMs?: number; now?: () => Date } = {},
): AgentLoop {
  return {
    start(): void {
      startAgentStatusSweeper();
      try {
        backfillAllAgents();
      } catch (error) {
        console.error(
          "[worksplice] agent reply backfill failed:",
          error instanceof Error ? error.message : String(error),
        );
      }
      startAgentLoopDriver({ runtime: deps.runtime });
      startReminderCron({ pollMs: deps.pollMs, now: deps.now });
    },
    stop(): void {
      stopAgentLoopDriver();
      stopReminderCron();
    },
    tick(): void {
      tickReminderCron(deps.now ? deps.now() : new Date());
    },
  };
}
