import { existsSync } from "fs";
import { join } from "path";
import { getDb } from "../raft/db-singleton.ts";
import { getAgent, agentHomePath } from "../raft/members.ts";
import { isChannelMember, joinChannel } from "../raft/channels.ts";
import { sendMessage, type SendMessageResult } from "../raft/messages.ts";
import { claimTask, updateTaskStatus } from "../raft/tasks.ts";
import {
  drain,
  ack,
  getSince,
  resolveTargetChannel,
  listRelatedTasks,
  type MessageWithAuthor,
} from "../raft/inbox.ts";
import { extractMentionedMemberIds } from "./wake.ts";
import { publishAgentStatus } from "../agent-status.ts";
import { getAgentRuntime } from "../agent-runtime.ts";
import { MEMORY_FILE_NAME } from "../data/dirs.ts";
import type { ChannelRow, MemberRow, MessageRow, TaskRow } from "../data/db.ts";

/**
 * agent-loop（§5.4）：wake → drain → decide → act → reply 收口的驱动层。
 * - drain：按 consumed_seqs 拉增量，组装 channel 语境 + 新消息 + 相关任务状态；
 * - decide：AX 原则——prompt 给出"能直接用的信息 + 一个明确的 next action"，回复为结构化 JSON；
 * - act：经 raft 服务层执行（回复带 freshness 校验），held 时四选一（§3.3 与 §6.3）：
 *   revise（重读重写）/ resend（原样重试）/ silent（静默放弃）/ anyway（显式逃逸口）；
 * - reply 收口：回复走双写流落 SQLite，每轮结束后 ack 推进 consumed_seqs（§3.8/§5.5）。
 *
 * 接缝：runtime 注入（AgentRuntime 结构子集）；测试传 fake，生产默认 getAgentRuntime()。
 * 绝不静态 import rpc-manager（node TS strip 无法解析 parameter properties）。
 */

export interface LoopSession {
  send(command: { type: string; message?: string; [key: string]: unknown }): Promise<unknown>;
  onEvent(listener: (event: { type: string; [key: string]: unknown }) => void): () => void;
  isRunning(): boolean;
}

export interface LoopRuntime {
  findSession(member: MemberRow): LoopSession | undefined;
  startSession(member: MemberRow): Promise<{ sessionId: string; sessionFile: string | null }>;
}

// ----------------------------------------------------------------------------
// 结构化回复协议（AX）：action + content + onConflict（freshness-hold 四选一）
// ----------------------------------------------------------------------------

export type ConflictChoice = "revise" | "resend" | "silent" | "anyway";
const CONFLICT_CHOICES = new Set(["revise", "resend", "silent", "anyway"]);

/** 任务操作（§3.7）：claim = 认领并开工；complete = 完成（置 in_review 待互审）；unclaim = 释放回池。 */
export type TaskOp = "claim" | "complete" | "unclaim";
export const TASK_OPS = new Set<TaskOp>(["claim", "complete", "unclaim"]);

export interface AgentAction {
  action: "reply" | "ignore";
  content: string;
  onConflict: ConflictChoice;
  /** 可选：本轮附带的任务操作（先 claim 再开工；claim 失败就让路）。 */
  task?: { number: number; op: TaskOp };
}

/** 崩溃恢复补拉用的房间标记（§5.3）：随 prompt 落进 session jsonl 的 user 条目。 */
export const ROOM_MARKER_PATTERN = /\[worksplice:target=([A-Za-z0-9#-]+) seq=(\d+)\]/;

export function roomMarker(targetId: string, seq: number): string {
  return `[worksplice:target=${targetId} seq=${seq}]`;
}

/** 解析 agent 的结构化回复；非 JSON（或 json 代码块）按整段文本作为回复内容。 */
export function parseAgentAction(text: string): AgentAction {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, "$1")
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const action: AgentAction["action"] = parsed.action === "ignore" ? "ignore" : "reply";
      const content = typeof parsed.content === "string" ? parsed.content.trim() : "";
      const onConflict: ConflictChoice = CONFLICT_CHOICES.has(String(parsed.onConflict))
        ? (parsed.onConflict as ConflictChoice)
        : "revise";
      let task: AgentAction["task"];
      const rawTask = parsed.task;
      if (rawTask && typeof rawTask === "object" && !Array.isArray(rawTask)) {
        const number = Number((rawTask as Record<string, unknown>).number);
        const op = String((rawTask as Record<string, unknown>).op);
        if (Number.isInteger(number) && number > 0 && TASK_OPS.has(op as TaskOp)) {
          task = { number, op: op as TaskOp };
        }
      }
      return task ? { action, content, onConflict, task } : { action, content, onConflict };
    }
  } catch {
    // 非 JSON：整段文本即回复
  }
  return { action: "reply", content: cleaned || text.trim(), onConflict: "revise" };
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
  tasks: Array<{ number: number; status: string; preview: string; ownerName: string; reopened?: boolean }>;
  targetId: string;
  baseSeq: number;
  memoryFile?: string | null;
}): string {
  const lines: string[] = [];
  lines.push(`You are @${input.agent.name}, a member of the worksplice workspace.`);
  lines.push(`New activity arrived in channel ${input.channel.name}:`);
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
      const reopened = task.reopened ? " — REOPENED, awaiting the owner: do not claim" : "";
      lines.push(`- task #${task.number} [${task.status}] "${task.preview}" (owner: ${task.ownerName})${reopened}`);
    }
  }
  lines.push("");
  lines.push(
    'Choose ONE next action and reply with JSON only: {"action":"reply"|"ignore","content":"your reply text","onConflict":"revise"|"resend"|"silent"|"anyway"}',
  );
  lines.push('- "reply" posts content to the channel; "ignore" says nothing.');
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
      `- Long-term memory: your memory file is at ${input.memoryFile}. Read it when you need context about who you are or ongoing work; after meaningful progress, update its "## 当前工作" section and clear it when the work is done. It survives session resets.`,
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
  lines.push(`Your reply to channel ${input.channel.name} was held because the room changed while you were writing.`);
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

/** 一次 prompt 完成/失败的会话事件集合（driver 的 busy 重试复用同一份清单）。 */
export const PROMPT_DONE_EVENTS = new Set(["prompt_done", "agent_end", "agent_settled"]);

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
        resolve({ ok: false, error: String(event.errorMessage ?? "prompt failed") });
      } else if (PROMPT_DONE_EVENTS.has(event.type)) {
        clearTimeout(timer);
        unsub();
        resolve({ ok: true });
      }
    });
  });
}

/** 发 prompt 并等待完成，取最后一条 assistant 文本作为回复。 */
export async function promptSession(
  session: LoopSession,
  prompt: string,
): Promise<{ ok: boolean; error?: string; text: string }> {
  const completion = waitForPromptCompletion(session);
  try {
    await session.send({ type: "prompt", message: prompt });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), text: "" };
  }
  const result = await completion;
  if (!result.ok) return { ok: false, error: result.error, text: "" };
  const last = (await session.send({ type: "get_last_assistant_text" })) as
    | { text?: string }
    | undefined;
  return { ok: true, text: (last?.text ?? "").trim() };
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
  | { status: "silent"; reason?: string; ackSeq: number };

/**
 * 回复投递（§3.3/§6.3）：携带写稿时的 baseSeq 走 freshness 校验；
 * 被 held 后按 agent 指定的 onConflict 四选一执行。
 * send 可注入（默认 raft sendMessage）；promptFn 用于 revise 重写。
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
    if (!result.held) return { status: "replied", message: result.message, ackSeq };

    ackSeq = result.roomSeq;
    switch (action.onConflict) {
      case "anyway": {
        // --anyway 逃逸口：连续 hold 后的显式绕过（不带 baseSeq 重试）
        const forced = send({ targetId: input.targetId, authorId: input.agent.id, content: action.content });
        if (forced.held) return { status: "silent", reason: "anyway send was held again", ackSeq };
        return { status: "anyway", message: forced.message, ackSeq };
      }
      case "silent":
        return { status: "silent", reason: "agent chose to stay silent", ackSeq };
      case "resend": {
        if (resendRetries >= MAX_RESEND_RETRIES) {
          return { status: "silent", reason: "resend retries exhausted", ackSeq };
        }
        resendRetries += 1;
        baseSeq = result.roomSeq;
        continue;
      }
      case "revise":
      default: {
        if (reviseRetries >= MAX_REVISE_RETRIES) {
          return { status: "silent", reason: "revise retries exhausted", ackSeq };
        }
        reviseRetries += 1;
        const revisedText = await input.promptFn(
          buildRevisionPrompt({
            channel: input.channel,
            originalContent: action.content,
            held: { roomSeq: result.roomSeq, whatHappened: result.whatHappened },
            newMessages: getSince(input.targetId, baseSeq),
            targetId: input.targetId,
          }),
        );
        const revised = parseAgentAction(revisedText);
        if (revised.action === "ignore" || !revised.content) {
          return { status: "silent", reason: "revised to ignore", ackSeq };
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

function taskInChannel(channelId: string, taskNumber: number): TaskRow | undefined {
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
    return { status: "yielded", reason: "task not found in this channel", baseSeq };
  }
  // §6.3 写稿时版本：thread 回复用决策时刻的线程版本；状态更新用 agent 语境里的 channel 版本
  // （当前轮 drain 过 channel 则为其 maxSeq，否则取其已消费游标 = 上一轮读到的最新版本）
  const threadBaseSeq =
    input.targetId === task.message_id ? input.baseSeq : getDb().maxSeq(task.message_id);
  const channelVersion =
    input.targetId === channel.id ? input.baseSeq : getDb().getConsumedSeq(agent.id, channel.id);

  // ---- claim：先认领再开工；失败就让路 --------------------------------------
  if (taskOp.op === "claim") {
    const claim = claimTask({ channelId: channel.id, taskNumber, memberId: agent.id, baseSeq });
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
    return { status: "yielded", reason: "task is not owned by this agent", baseSeq };
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
  return { status: "silent", reason: `task ${taskOp.op} → ${targetStatus}`, baseSeq };
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
  const threadAckSeq = delivered ? delivered.seq : (outcome.ackSeq ?? input.threadBaseSeq);
  return {
    status: outcome.status,
    message: delivered,
    // baseSeq 此处为线程版本（非 channel 版本）：线程收口用，见调用方 ack
    baseSeq: threadAckSeq,
    threadAckSeq,
  };
}

/** §3.7 任务延续信号：agent 拥有锚定于此目标（线程）的 in_progress 任务。 */
export function ownsInProgressTaskAt(agentId: string, targetId: string): boolean {
  const task = getDb().getTaskByMessageId(targetId);
  return Boolean(task && task.status === "in_progress" && task.owner_id === agentId);
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
  if (!agent.workspace_path) return { status: "skipped", reason: "no workspace bound" };
  const channel = resolveTargetChannel(targetId);
  if (!channel) return { status: "skipped", reason: "unknown target" };
  if (channel.archived === 1) return { status: "skipped", reason: "channel archived" };

  const drained = drain(agentId, targetId);
  if (drained.messages.length === 0) return { status: "noop", baseSeq: drained.maxSeq };
  const incoming = drained.messages.filter((message) => message.author_id !== agent.id);
  // §3.2 @mention = 注意力信号而非投递过滤：未加入 channel 的 agent 被个人 @mention
  // 时穿透送达——非成员仍推进本轮（drain 语境可见），未被 mention 则跳过。
  const isMember = isChannelMember(channel.id, agent.id);
  if (!isMember) {
    const mentioned = incoming.some((message) =>
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
  if (incoming.length === 0 && !continuing && !reminderDriven) {
    ack(agentId, targetId, drained.maxSeq);
    return { status: "noop", reason: "only the agent's own messages", baseSeq: drained.maxSeq };
  }
  // 崩溃窗口（回复已写、游标未推）内的自愈：最新消息是自己的回复 → 只推进游标，不重复应答
  const latest = getDb().getLatestMessage(targetId);
  if (latest && latest.author_id === agent.id && !continuing && !reminderDriven) {
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
      publishAgentStatus(agent.id, "error");
      return { status: "error", reason: error instanceof Error ? error.message : String(error) };
    }
    session = rt.findSession(agent);
  }
  if (!session) return { status: "skipped", reason: "no session after start" };
  if (session.isRunning()) return { status: "busy" };

  publishAgentStatus(agent.id, "working");
  const baseSeq = drained.maxSeq;
  const prompt = buildReplyPrompt({
    agent,
    channel,
    messages: incoming.length > 0 ? incoming : drained.messages,
    tasks: listRelatedTasks(targetId),
    targetId,
    baseSeq,
    memoryFile: agentMemoryFile(agent),
  });
  try {
    const first = await promptSession(session, prompt);
    if (!first.ok) {
      publishAgentStatus(agent.id, "error");
      return { status: "error", reason: first.error };
    }
    const action = parseAgentAction(first.text);
    // §3.7 任务操作：先 claim 再开工；claim 失败就让路（不回复、只收口游标）
    if (action.task) {
      // 非成员无 channel 成员资格，不做任务操作（claim 服务层会拒绝）
      if (!isMember) {
        ack(agentId, targetId, baseSeq);
        return { status: "yielded", reason: "not a member of the channel", baseSeq };
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
      publishAgentStatus(agent.id, "online");
      return outcome;
    }
    if (action.action === "ignore" || !action.content) {
      ack(agentId, targetId, baseSeq);
      return { status: "ignored", baseSeq };
    }
    // §3.2 mention 穿透的回复：agent 可自行加入公开 channel（加入 = 订阅全部消息）；
    // 私有 channel 不能自行加入——回复不可投递，收口游标后静默让路
    if (!isMember) {
      if (channel.type === "private") {
        ack(agentId, targetId, baseSeq);
        return { status: "silent", reason: "not a member of the private channel", baseSeq };
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
    // ack 到 agent 本轮实际读到/被告知的房间版本（held 后随 roomSeq 推进）
    ack(agentId, targetId, outcome.ackSeq ?? baseSeq);
    publishAgentStatus(agent.id, "online");
    if (outcome.status === "silent") {
      return { status: "silent", reason: outcome.reason, baseSeq: outcome.ackSeq };
    }
    return { status: outcome.status, message: outcome.message, baseSeq: outcome.ackSeq };
  } catch (error) {
    publishAgentStatus(agent.id, "error");
    return { status: "error", reason: error instanceof Error ? error.message : String(error) };
  }
}
