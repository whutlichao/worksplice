import {
  createReadStream,
  existsSync,
  promises as fsPromises,
  readFileSync,
  statSync,
} from "node:fs";
import { join, normalize } from "node:path";
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
  getPendingTargets,
  getSince,
  isChannelMember,
  isDM,
  joinChannel,
  listAgents,
  listChannels,
  listRelatedTasks,
  logRoundOutcome,
  normalizeWorkspacePath,
  readDefaultModelFromSettings,
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
import {
  executeMemberOps,
  planMemberOps,
  parseMemberOps,
  type MemberOpOutcome,
  type RawMemberOp,
} from "./member-ops.ts";
import { parseLeakedReply, isProtocolAction } from "./json-prologue.ts";
import type { ProtocolAction } from "./json-prologue.ts";
import {
  INJECTION_CONTEXT_CHARS,
  INJECTION_DRAFT_CHARS,
  INJECTION_TASK_CHARS,
  INJECTION_TASK_WINDOW,
  clampLines,
  clampText,
  elasticBudget,
  projectMessages,
} from "./injection-budget.ts";

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
  action: ProtocolAction;
  content: string;
  onConflict: ConflictChoice;
  /** 可选：conclude 的简短理由（仅保留 trim 后非空的字符串）。 */
  reason?: string;
  /** 可选：本轮附带的任务操作（先 claim 再开工；claim 失败就让路）。 */
  task?: { number: number; op: TaskOp };
  /** 可选：本轮附带的成员 op（ADR-0013 决策一；解析见 ./member-ops.ts）。 */
  ops?: RawMemberOp[];
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
          isProtocolAction(extracted.action)
        ) {
          parsed = extracted;
        }
      } catch {
        // 提取出的候选仍是坏 JSON：按明文处理
      }
    }
  }
  // 泄漏修复（reply-json-leak，两档）：
  //  ① 坏序言——模型偶发把 `{"` 输出成 `","` / `,"`，上面两档都救不回来（坏序言之后没有 `{`，
  //     提取器找不到对象开头）；
  //  ② 裸控制字符——协议 JSON 形状写对了，但字符串字面量里是真实换行/制表（< 0x20）而非 `\n`/`\t`，
  //     parse 报 Bad control character，提取器取得到对象也一样 parse 不过。
  // 命中已实证形态 + 协议形状校验通过才补这一档，结果直接合流进下面的 `if (parsed)`——
  // content/onConflict/task/ops 的提取与校验一处不改，行为与「直接 parse 成功」完全一致；
  // 校验不过则维持现状走兜底（不猜测、不模糊修复）。
  if (!parsed) {
    parsed = parseLeakedReply(cleaned)?.value ?? null;
  }
  if (parsed) {
    const action: AgentAction["action"] = isProtocolAction(parsed.action)
      ? parsed.action
      : "reply";
    const content =
      typeof parsed.content === "string" ? parsed.content.trim() : "";
    const reason =
      typeof parsed.reason === "string" ? parsed.reason.trim() : "";
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
    // 成员 op（ADR-0013 决策一）：与 task 同一条缝；空数组不落字段（向后兼容既有 deepEqual 断言）
    const ops = parseMemberOps(parsed.ops);
    const result: AgentAction = { action, content, onConflict };
    // reason 只属于 conclude；空串/非字符串不落字段。
    if (action === "conclude" && reason) result.reason = reason;
    if (task) result.task = task;
    if (ops.length > 0) result.ops = ops;
    return result;
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

/**
 * 每轮语境注入（ADR-0013 §1.5 的「只读类每轮语境里本来就有」——这就是那两行）：
 * 频道列表（含每个频道的 seq 版本，post 的 freshness 参照）与成员列表。
 * 注入点固定在本函数的 prompt 文本里；调用方（runAgentRound）从 DB 组装（replyPromptContext）。
 */
export interface ReplyPromptContext {
  channels: Array<{
    name: string;
    type: string;
    seq: number;
    joined: boolean;
    archived: boolean;
  }>;
  members: Array<{ name: string; type: "human" | "agent" }>;
  defaultModel: { provider: string; modelId: string } | null;
}

const PROMPT_CHANNEL_CAP = 100;
const PROMPT_MEMBER_CAP = 100;
const DM_MENTION_RULE =
  '- DM mention rule: do not @mention other agents in this direct message; refer to their names in plain text instead.';

function formatChannelContext(channels: ReplyPromptContext["channels"]): string {
  const shown = channels.slice(0, PROMPT_CHANNEL_CAP);
  const parts = shown.map(
    (channel) =>
      `#${channel.name} (${channel.type}, seq ${channel.seq}${channel.joined ? "" : ", not joined"}${channel.archived ? ", archived" : ""})`,
  );
  if (channels.length > shown.length) parts.push(`(+${channels.length - shown.length} more)`);
  // 票 08：语境块有硬顶，整轮上界才成立（只截注入投影，频道表本身不动）
  return clampText(parts.join(", "), INJECTION_CONTEXT_CHARS);
}

function formatMemberContext(members: ReplyPromptContext["members"]): string {
  const shown = members.slice(0, PROMPT_MEMBER_CAP);
  const parts = shown.map((member) => `@${member.name} (${member.type})`);
  if (members.length > shown.length) parts.push(`(+${members.length - shown.length} more)`);
  return clampText(parts.join(", "), INJECTION_CONTEXT_CHARS);
}

/** 每轮 ctx 的组装（runAgentRound 用；频道列表排除与该成员无关的 DM——DM 是 owner↔agent 的一对一，无从加入）。 */
export function replyPromptContext(agent: MemberRow): ReplyPromptContext {
  const channels = listChannels()
    // 读类不提升可见面（能力表判据）：公开频道（任何人可加入）+ 该成员已加入的频道；
    // 未加入的私有频道连名字/类型都不注入（DM 只有自己是成员时在列）。
    .filter((channel) => channel.type === "public" || isChannelMember(channel.id, agent.id))
    .map((channel) => ({
      name: channel.name,
      type: channel.type,
      seq: getDb().maxSeq(channel.id),
      joined: isChannelMember(channel.id, agent.id),
      archived: channel.archived === 1,
    }));
  const members = getDb()
    .listMembers()
    .map((member) => ({ name: member.name, type: member.type as "human" | "agent" }));
  return { channels, members, defaultModel: readDefaultModelFromSettings() };
}

/**
 * decide 的 prompt（§5.4 AX 原则）：新消息（带 seq/作者）+ 相关任务状态 + 明确的 next action 选项。
 *
 * 票 08（spec B5）：整轮注入形状受 `ROUND_INJECTION_BUDGET_CHARS` 约束——
 * 固定骨架（指令与 marker）先占位，语境块/任务块各有硬顶，剩下的预算全给消息块；
 * 消息块按「保近期、裁远期」投影（见 ./injection-budget.ts），超界的历史积压不进注入，
 * 但原始记录一行不改，仍可经 `search` op 回查（B8 的回查面）。
 */
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
  /** 语境注入（频道/成员/默认模型）；缺省不注入（直调本函数的单测保持原状）。 */
  context?: ReplyPromptContext;
}): string {
  // 头部（骨架，永不裁）
  const head: string[] = [];
  head.push(`You are @${input.agent.name}, a member of the worksplice workspace.`);
  head.push(`New activity arrived in channel ${input.channel.name}:`);
  // 11-整改（自激循环）：续工轮的 drain 全是 agent 自己的历史回复（线程游标留口），
  // 模型看到 `@自己` 会误以为被 @mention 而继续回复——标注这些是自己的消息，
  // 不是他人新活动，@mention 也不构成"必须回应"信号。
  const ownMessagesOnly =
    input.messages.length > 0 &&
    input.messages.every((m) => m.author_id === input.agent.id);
  if (ownMessagesOnly) {
    head.push(
      "(The messages below are YOUR OWN — your prior progress in this thread. They are not new activity from others; being @mentioned within them is a self-mention, not a demand. Decide: continue working, complete the task, or say nothing.)",
    );
  }
  head.push("");

  // 尾部（任务/语境/指令/marker）：任务与语境各有硬顶，指令骨架永不裁
  const lines: string[] = [];
  const shownTasks = input.tasks.slice(0, INJECTION_TASK_WINDOW);
  const droppedTasks = input.tasks.length - shownTasks.length;
  if (shownTasks.length > 0) {
    const taskLines: string[] = ["", "Related open tasks:"];
    for (const task of shownTasks) {
      const reopened = task.reopened
        ? " — REOPENED, awaiting the owner: do not claim"
        : "";
      taskLines.push(
        `- task #${task.number} [${task.status}] "${task.preview}" (owner: ${task.ownerName})${reopened}`,
      );
    }
    // 票 08：任务被裁也要显式声明（不静默丢弃），回查走既有 search op
    if (droppedTasks > 0) {
      taskLines.push(
        `（另有 ${droppedTasks} 条开放任务不在本轮注入中：需要时用 search op 回查）`,
      );
    }
    lines.push(...clampLines(taskLines, INJECTION_TASK_CHARS));
  }
  if (input.context) {
    lines.push("");
    lines.push(`Workspace channels: ${formatChannelContext(input.context.channels)}`);
    lines.push(`Workspace members: ${formatMemberContext(input.context.members)}`);
    if (input.context.defaultModel) {
      lines.push(
        `Default model for new agents: ${input.context.defaultModel.provider}/${input.context.defaultModel.modelId}`,
      );
    }
  }
  lines.push("");
  lines.push(
    'Choose ONE next action and reply with JSON only: {"action":"reply"|"ignore"|"conclude","content":"your reply text","onConflict":"revise"|"resend"|"silent"|"anyway"}',
  );
  lines.push('- "reply" posts content to this target; task replies may be routed to an anchor thread; "ignore" says nothing.');
  lines.push("- Deciding is yours, but follow these response rules:");
  lines.push(
    "- MUST reply: you are personally @mentioned in the message (channel or thread); you are the owner of an in_progress task and someone else posted in its thread; a reminder is addressed to you; a question is asked directly of you.",
  );
  if (input.channel.type === 'dm') {
    lines.push(
      "- DM rule: this channel is your direct message with the owner — a human message from the owner here is always a MUST reply; ignoring it is treated as a failure.",
    );
    lines.push(DM_MENTION_RULE);
  }
  lines.push(
    "- MAY reply: the message concerns your role, your workspace, or your current work — answer when you can add value.",
  );
  lines.push(
    "- MUST ignore (do not chime in): task threads you do not own, are not mentioned in, and have not participated in; others' progress reports or status updates; unrelated small talk. An @mention of you overrides all of this — being mentioned is a demand for a response, and ignoring it is treated as a failure.",
  );
  lines.push(
    '- "conclude": acknowledge receipt without posting when a settled thread or @mention needs only a closing confirmation; legal under a certain signal instead of "ignore"; never to dodge direct questions or explicit work requests.',
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
    '- Task protocol: a non-empty ordinary reply auto-claims only when this round\'s only new channel activity is either (1) one open task anchor and its immediately following Owner-authored "Task #N created" event, or (2) one Owner-authored, format-matching "Task #N created" event that uniquely matches one open task.',
    '  In both cases, claim first and post in the task thread; if claim fails (freshness hold, another owner, reopened block), yield without posting anywhere.',
    '  Multiple task events, unmatched events, other channel activity, and ordinary messages do not auto-select a task.',
    '  If other activity arrives, add an explicit {"task":{"number":N,"op":"claim"}} op only when choosing to claim that task; ordinary replies stay in the channel.',
  );
  lines.push(
    '- When you finish a task you own: {"task":{"number":N,"op":"complete"}} — the task moves to in_review for someone else to verify (builders never verify their own work). To step away: {"task":{"number":N,"op":"unclaim"}}.',
  );
  lines.push(
    '- Extra operations: add "ops":[ ... ] to your JSON. Every op runs with YOUR identity; permissions are decided by the app, anything not listed here is refused.',
  );
  lines.push(
    '  react {"op":"react","seq":N,"emoji":"👍"} | pin {"op":"pin","seq":N} | remind {"op":"remind","title":"...","inMinutes":30} (or "fireAt":"<ISO>"; "targetId" defaults to this target; optional "recurrence") | post {"op":"post","targetId":"#channel","content":"...","baseSeq":N} (pointer to another channel) | createChannel {"op":"createChannel","name":"...","type":"public"|"private","description":"...","members":["@Name"]} | createAgent {"op":"createAgent","name":"...","description":"...","provider":"...","modelId":"..."} | search {"op":"search","query":"...","limit":N}',
  );
  lines.push(
    "  A search runs first and its hits come back to you in the same round — write your reply after you see them; the other ops you declared are kept for that second step. Only one search step per round.",
  );
  lines.push(
    "  Human-only (never yours to do — point the Owner to the UI instead): archive a channel, delete an identity, Restart / Session reset / Full reset, change runtime, change workspace.",
  );
  if (input.memoryFile) {
    lines.push(
      `- Long-term memory: your memory file is at ${input.memoryFile}. Read it when you need context about who you are or ongoing work; after meaningful progress, update its "## Current work" section and clear it when the work is done. It survives session resets.`,
    );
  }
  lines.push(roomMarker(input.targetId, input.baseSeq));

  // 消息块吃剩余预算：先量出骨架与硬顶块已占的字符，再按「保近期、裁远期」投影
  const projection = projectMessages(
    input.messages,
    elasticBudget(head, lines),
  );
  return [
    ...head,
    ...projection.lines,
    ...(projection.notice ? [projection.notice] : []),
    ...lines,
  ].join("\n");
}

/** held 后的 revise prompt（§3.3 修正方式 1）：期间发生了什么 + 新消息正文 + 原稿 + 重写指示。 */
export function buildRevisionPrompt(input: {
  channel: ChannelRow;
  originalContent: string;
  held: { roomSeq: number; whatHappened: string };
  newMessages: MessageWithAuthor[];
  targetId: string;
}): string {
  // 头部（骨架，永不裁）
  const head: string[] = [];
  head.push(
    `Your reply to channel ${input.channel.name} was held because the room changed while you were writing.`,
  );
  head.push(`What happened: ${input.held.whatHappened}`);
  head.push(`The room is now at seq ${input.held.roomSeq}.`);
  if (input.channel.type === 'dm') {
    head.push(DM_MENTION_RULE);
  }

  // 尾部（原稿 + 重写指示 + marker）：原稿是本轮要发的内容，给比普通正文更宽的额度
  const lines: string[] = [];
  const draft = clampText(input.originalContent, INJECTION_DRAFT_CHARS);
  lines.push("");
  lines.push("Your held draft was:");
  lines.push("---");
  lines.push(draft);
  lines.push("---");
  if (draft !== input.originalContent) {
    // 截断必须可见：否则模型会把截断稿当成原稿 resend 出去
    lines.push("（上面的原稿已按本轮注入预算截断，不是原稿全文）");
  }
  lines.push(
    'Decide one of: rewrite the reply and resend (reply JSON again with your new content); resend the draft as-is ({"action":"reply","content":"<draft>","onConflict":"resend"}); stay silent ({"action":"ignore"}); or send anyway without the freshness check ({"action":"reply","content":"<draft>","onConflict":"anyway"}).',
  );
  lines.push(
    'Reply with JSON only: {"action":"reply"|"ignore","content":"...","onConflict":"revise"|"resend"|"silent"|"anyway"}',
  );
  lines.push("[worksplice:revision]");
  lines.push(roomMarker(input.targetId, input.held.roomSeq));

  // 消息块吃剩余预算（与 decide 同一套投影：保近期、裁远期）
  const messageHeader =
    input.newMessages.length > 0
      ? ["", "Messages that arrived while you were writing:"]
      : [];
  const projection = projectMessages(
    input.newMessages,
    elasticBudget(head, lines, messageHeader),
  );
  return [
    ...head,
    ...messageHeader,
    ...projection.lines,
    ...(projection.notice ? [projection.notice] : []),
    ...lines,
  ].join("\n");
}

// ----------------------------------------------------------------------------
// 成员 op 的轮内执行（ADR-0013 决策一）：与 task 同一条缝，身份取结构身份
// ----------------------------------------------------------------------------

/** 一轮里最多几条观察相 prompt（search 的结果要交回模型；封顶防模型反复搜）。 */
export const MAX_OPS_OBSERVATION_PHASES = 1;

/**
 * 观察相 prompt：把 op 结果（搜索命中 / 未执行 / 拒绝）交回模型，让它据此写回复。
 * 票 08（spec B8）：形状约束不变——命中仍以观察相文本回交、一轮仍最多一次、无新工具；
 * 只多一层：观察文本吃剩余预算（既有 snippet 240 / 上限 50 的形状在最坏情形下仍在界内）。
 */
export function buildOpsObservationPrompt(input: {
  observation: string;
  targetId: string;
  baseSeq: number;
  keptTask?: { number: number; op: TaskOp };
}): string {
  // 头部（骨架，永不裁）
  const head: string[] = ["Results of the operations you requested:"];
  // 尾部（保留的任务操作 + 重写指示 + marker）
  const tail: string[] = [""];
  if (input.keptTask) {
    tail.push(
      `Your task operation is kept for this round: ${input.keptTask.op} #${input.keptTask.number} (say so in your next action only if you want to change it).`,
    );
  }
  tail.push(
    'Now write your reply as JSON only: {"action":"reply"|"ignore","content":"your reply text","onConflict":"revise"|"resend"|"silent"|"anyway"}',
  );
  tail.push(
    'Operations that already ran are not repeated — if you still want the ones marked as NOT executed, list them again in "ops":[ ... ].',
  );
  tail.push("[worksplice:observe]");
  tail.push(roomMarker(input.targetId, input.baseSeq));
  // 观察文本是唯一的弹性块：先量出骨架，剩下的预算全给它（既有 snippet/条数上限不变）。
  // 截断提示要占位置，先把它预留出来，避免「加了提示反而越界」。
  const truncatedNote = "（观察结果已按本轮注入预算截断）";
  const observation = clampText(
    input.observation,
    elasticBudget(head, tail) - truncatedNote.length - 1,
  );
  return [
    ...head,
    observation,
    ...(observation === input.observation ? [] : [truncatedNote]),
    ...tail,
  ].join("\n");
}

function summarizeMemberOpOutcomes(outcomes: MemberOpOutcome[], note?: string): string {
  const parts = outcomes.map((outcome) =>
    outcome.status === "applied"
      ? `${outcome.op}=applied`
      : `${outcome.op}=${outcome.status}(${outcome.detail})`,
  );
  if (note) parts.push(note);
  return parts.length > 0 ? `ops: ${parts.join(", ")}` : "";
}

/**
 * 执行本轮声明的成员 op（结构身份 = input.agent）。
 * search 先跑一趟并把命中交回（观察相 prompt）；观察相后模型的新动作替换原动作，
 * 但它声明的 task 操作默认保留（同一轮的意图，不应因后续 prompt 丢失）。
 */
async function applyMemberOps(input: {
  agent: MemberRow;
  targetId: string;
  action: AgentAction;
  promptFn: (promptText: string) => Promise<string>;
}): Promise<{ action: AgentAction; summary: string }> {
  let action = input.action;
  let phases = 0;
  const outcomes: MemberOpOutcome[] = [];
  for (;;) {
    const result = executeMemberOps({
      agent: input.agent,
      targetId: input.targetId,
      plans: planMemberOps(action.ops ?? []),
    });
    outcomes.push(...result.outcomes);
    if (!result.observation || phases >= MAX_OPS_OBSERVATION_PHASES) {
      const note =
        result.observation && phases >= MAX_OPS_OBSERVATION_PHASES
          ? "further operation results were not returned (one observation phase per round)"
          : undefined;
      return { action, summary: summarizeMemberOpOutcomes(outcomes, note) };
    }
    phases += 1;
    const text = await input.promptFn(
      buildOpsObservationPrompt({
        observation: result.observation,
        targetId: input.targetId,
        baseSeq: getDb().maxSeq(input.targetId),
        keptTask: action.task,
      }),
    );
    // 观察相 prompt 失败（模型无文本）→ 保留原动作继续投递，不把整轮打成失败。
    if (!text) return { action, summary: summarizeMemberOpOutcomes(outcomes) };
    const next = parseAgentAction(text);
    // 后续动作默认继承原动作的 task（同一轮意图）；它自己声明了就用自己的。
    action = next.task || !action.task ? next : { ...next, task: action.task };
  }
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
  // SDK 对模型/API 报错（如 openrouter 402 / new-api 429）不 reject prompt()：事件流照发
  // prompt_done，但最后一条 assistant 无文本。空文本只能来自失败轮（合法的 ignore 也返回
  // JSON 文本），必须按失败处理——否则游标被 ack、消息被静默消费、agent 永不回复。
  if (!text)
    return { ok: false, error: await emptyTextFailureReason(session), text: "" };
  return { ok: true, text };
}

/**
 * 空文本失败的真实原因（D1）：pi SDK 把模型/API 报错只写进末条 assistant message 的
 * stopReason/errorMessage（与 session jsonl 同源），事件流不报错。这条只读命令把它取出来，
 * 让可观测面板看得见「agent 为什么失败」（形如 "model error: 429: {...}"）。
 * 「拿不到细节」是合法形态：LoopSession 是结构接口，测试 fake / 不认识该命令的会话
 * 会回 null 或抛错——两者都回落既有通用文案，绝不因此让本轮再失败。
 */
async function emptyTextFailureReason(session: LoopSession): Promise<string> {
  const fallback = "model returned no text (request failed?)";
  const detail = (await session
    .send({ type: "get_last_assistant_error" })
    .catch(() => null)) as
    | { stopReason?: unknown; errorMessage?: unknown }
    | null
    | undefined;
  const message =
    typeof detail?.errorMessage === "string" ? detail.errorMessage.trim() : "";
  return message ? `model error: ${message}` : fallback;
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
        if (revised.action === "conclude") {
          return { status: "silent", reason: "revised to conclude", ackSeq };
        }
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

/** 自动认领的 freshness 重试上限（同一轮内按 held 返回的 roomSeq 重试）。 */
export const MAX_TASK_CLAIM_RETRIES = 3;

/**
 * §3.7 自动路由裁决：频道目标的普通答复，本轮**最新一条其他作者消息**是 Owner 发布、
 * 格式匹配 `Task #N created` 且唯一匹配本频道开放任务 N 的创建事件时：
 * - 任务无 owner → claim（先认领再回线程）；
 * - 任务已有 owner（自己或他人）→ thread（不 claim，直接以参与者身份回线程）。
 * 同轮更早的其他作者未读消息（混合活动）不构成否决——判定只看向最新一条。
 * 最新一条不是创建事件 / 任务不存在或已 done·closed → 不路由，按普通频道回复。
 */
interface TaskReplyRoute {
  taskNumber: number;
  /** 触发本轮路由的创建事件 seq；held 让路时游标必须停在其之前。 */
  eventSeq: number;
  /** claim = 无 owner，先认领；thread = 已有 owner（自己或他人），直接回线程。 */
  mode: "claim" | "thread";
}

function taskInChannel(
  channelId: string,
  taskNumber: number,
): TaskRow | undefined {
  return getDb().getTaskByChannelNumber(channelId, taskNumber);
}

/** 解析 Owner 的任务创建事件；格式与频道中的创建事件一致。 */
function taskCreationEventNumber(message: MessageWithAuthor): number | null {
  if (message.author_id !== OWNER_MEMBER_ID) return null;
  const match = /^Task #(\d+) created(?: — (.*))?$/.exec(message.content);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) ? number : null;
}

/**
 * 普通答复的自动路由裁决（§3.7）：只认**本轮最新一条其他作者消息**。
 * 旧实现（claimTaskFromReply）用 hasOtherActivity 把「同轮更早的未读消息」当竞争活动，
 * 导致混合活动时任务信号被压回频道（secretary-office #11）；判定改看最新一条后，
 * 更早的消息不再否决。返回 null 表示按普通频道回复处理。
 */
function resolveTaskReplyRoute(input: {
  agentId: string;
  action: AgentAction;
  channel: ChannelRow;
  targetId: string;
  incoming: MessageWithAuthor[];
}): TaskReplyRoute | null {
  const { agentId, action, channel, targetId, incoming } = input;
  if (
    targetId !== channel.id ||
    action.task ||
    action.action !== "reply" ||
    !action.content ||
    incoming.length === 0
  ) {
    return null;
  }
  const latest = incoming.at(-1);
  if (!latest) return null;
  const taskNumber = taskCreationEventNumber(latest);
  if (taskNumber !== null) {
    const task = getDb().getTaskByChannelNumber(channel.id, taskNumber);
    // 最新一条是创建事件但任务不存在或已 done/closed：按规范不路由，回频道；
    // 不能落到 pending，否则会把答复投到另一个任务线程（F 的同类错误）。
    if (!task || task.status === "done" || task.status === "closed") {
      return null;
    }
    return {
      taskNumber,
      eventSeq: latest.seq,
      // 有 owner（自己或他人）都不 claim：自己持有 → 回线程；他人持有 → 参与者回线程。
      mode: task.owner_id === null ? "claim" : "thread",
    };
  }
  // 最新一条不是任务信号：只对曾经 held 耗尽的任务优先收敛（F 的新轮不受影响）。
  return pendingTaskRoute(agentId, channel);
}

/**
 * 同进程 pending-claim：claim 重试耗尽、且创建事件仍未被消费的任务。
 * 不落 DB、不扩 schema；进程重启后丢失可接受——游标仍停在事件之前，若没有更新的
 * 消息，最新一条仍是创建事件，下一轮可重新收敛。成功后立即清除。
 */
interface PendingTaskClaim {
  agentId: string;
  channelId: string;
  taskNumber: number;
  eventSeq: number;
}

declare global {
  var __worksplicePendingTaskClaims:
    | Map<string, PendingTaskClaim>
    | undefined;
}

function pendingTaskStore(): Map<string, PendingTaskClaim> {
  if (!globalThis.__worksplicePendingTaskClaims) {
    globalThis.__worksplicePendingTaskClaims = new Map();
  }
  return globalThis.__worksplicePendingTaskClaims;
}

const pendingClaimKey = (
  agentId: string,
  channelId: string,
  taskNumber: number,
) => `${agentId}|${channelId}|${taskNumber}`;

function rememberPendingTaskClaim(claim: PendingTaskClaim): void {
  pendingTaskStore().set(
    pendingClaimKey(claim.agentId, claim.channelId, claim.taskNumber),
    claim,
  );
}

function clearPendingTaskClaim(
  agentId: string,
  channelId: string,
  taskNumber: number,
): void {
  pendingTaskStore().delete(pendingClaimKey(agentId, channelId, taskNumber));
}

/**
 * pending 优先级：只在本轮没有新的任务信号时生效（F 不变）。任务仍无 owner → 优先
 * claim；已被他人持有 → 按 B 以参与者回线程；done/closed 或事件已被消费 → 清除 pending，
 * 按普通消息处理。返回 null 表示没有可收敛的 pending。
 */
function pendingTaskRoute(
  agentId: string,
  channel: ChannelRow,
): TaskReplyRoute | null {
  const store = pendingTaskStore();
  const consumed = getDb().getConsumedSeq(agentId, channel.id);
  const candidates: Array<{
    key: string;
    claim: PendingTaskClaim;
    task: TaskRow;
  }> = [];
  for (const [key, claim] of store) {
    if (claim.agentId !== agentId || claim.channelId !== channel.id) continue;
    if (consumed >= claim.eventSeq) {
      store.delete(key);
      continue;
    }
    const task = getDb().getTaskByChannelNumber(channel.id, claim.taskNumber);
    if (!task || task.status === "done" || task.status === "closed") {
      store.delete(key);
      continue;
    }
    candidates.push({ key, claim, task });
  }
  // 多条 pending 时取 eventSeq 最新（与 A 的最新信号取向一致），避免 Map 插入序
  // 让较新的任务长期饿死。
  candidates.sort((a, b) => b.claim.eventSeq - a.claim.eventSeq);
  const next = candidates[0];
  if (!next) return null;
  if (next.task.owner_id === null) {
    return {
      taskNumber: next.claim.taskNumber,
      eventSeq: next.claim.eventSeq,
      mode: "claim",
    };
  }
  // 已被持有（自己或他人）：按 B/D 回线程，pending 已无 claim 价值。
  store.delete(next.key);
  return {
    taskNumber: next.claim.taskNumber,
    eventSeq: next.claim.eventSeq,
    mode: "thread",
  };
}

/** 该 agent 在频道里是否有仍可收敛的 pending 任务（崩溃窗口早退前检查）。 */
function hasPendingTaskClaim(agentId: string, channelId: string): boolean {
  const consumed = getDb().getConsumedSeq(agentId, channelId);
  for (const claim of pendingTaskStore().values()) {
    if (claim.agentId !== agentId || claim.channelId !== channelId) continue;
    if (consumed >= claim.eventSeq) continue;
    const task = getDb().getTaskByChannelNumber(channelId, claim.taskNumber);
    if (task && task.status !== "done" && task.status !== "closed") {
      return true;
    }
  }
  return false;
}

/** 本轮是否有可路由的创建事件（开放任务；done/closed 不算任务信号）。 */
function hasRoutableTaskEvent(
  agentId: string,
  channel: ChannelRow,
  messages: MessageWithAuthor[],
): boolean {
  return messages.some((message) => {
    if (message.author_id === agentId) return false;
    const taskNumber = taskCreationEventNumber(message);
    if (taskNumber === null) return false;
    const task = getDb().getTaskByChannelNumber(channel.id, taskNumber);
    return Boolean(task && task.status !== "done" && task.status !== "closed");
  });
}

/** claim 失败的原因文案（自动路由与显式 claim 共用，避免两处分派漂移）。 */
function claimFailureReason(claim: {
  status: "held" | "conflict" | "blocked";
}): string {
  switch (claim.status) {
    case "held":
      return "claim held — the room changed";
    case "blocked":
      return "claim blocked — task was reopened, awaiting the owner";
    default:
      return "claim conflict — task already claimed";
  }
}

/**
 * 带任务操作的一轮（§3.7）：
 * - 自动路由（route）：无 owner 先 claim（held 按 roomSeq 同轮重试，上限 MAX_TASK_CLAIM_RETRIES）；
 *   已有 owner（自己或他人）不 claim，直接把回复作为参与者写入任务线程；重试耗尽才让路，
 *   且游标停在创建事件之前，事件保持未消费供后续轮次再收敛到 claim；
 * - 显式 claim：先认领（channel freshness）；成功 → 回复投递到任务线程（thread freshness）；
 *   失败（held/conflict/blocked）→ 让路：不回复、channel 游标只推进到已读版本（更新的消息经 wake 重试）；
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
  /** 自动路由裁决；与 action.task 二选一。 */
  route?: TaskReplyRoute;
  promptFn: (promptText: string) => Promise<string>;
  send?: ReplySender;
}): Promise<RoundOutcome> {
  const { agent, channel, action, baseSeq, route } = input;
  const taskOp = action.task;
  if (!taskOp && !route) {
    throw new Error("runTaskOperation requires a task op or a reply route");
  }
  const taskNumber = taskOp?.number ?? route!.taskNumber;

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
  const deliverReply = (anchorId: string) =>
    deliverToTaskThread({
      agent,
      channel,
      targetId: input.targetId,
      anchorId,
      action,
      threadBaseSeq,
      promptFn: input.promptFn,
      send: input.send,
    });
  // 自动路由的线程回复失败（error / silent）时不推进 channel 游标：创建事件保持
  // pending，下一轮重新路由；只有回复真正落线程才收口到本轮已读版本。
  const finishRoutedReply = async (anchorId: string): Promise<RoundOutcome> => {
    const delivered = await deliverReply(anchorId);
    if (delivered.status === "error" || delivered.status === "silent") {
      return delivered;
    }
    ack(agent.id, input.targetId, baseSeq);
    return delivered;
  };

  // ---- 自动路由（§3.7）：最新创建事件 → 任务线程；无 owner 先 claim ----------
  if (route) {
    if (route.mode === "thread") {
      // B/D：任务已有 owner（自己或他人）→ 不发起 claim，直接把回复作为参与者写入线程。
      clearPendingTaskClaim(agent.id, channel.id, taskNumber);
      return finishRoutedReply(task.message_id);
    }
    // C：无 owner → 先 claim；held 时同一轮用返回的 roomSeq 重试，上限 MAX_TASK_CLAIM_RETRIES。
    // （route.mode === "thread" 已在上面返回。）
    let claimSeq = baseSeq;
    let claim = claimTask({
      channelId: channel.id,
      taskNumber,
      memberId: agent.id,
      baseSeq: claimSeq,
    });
    for (
      let retry = 0;
      claim.status === "held" && retry < MAX_TASK_CLAIM_RETRIES;
      retry += 1
    ) {
      claimSeq = claim.roomSeq;
      claim = claimTask({
        channelId: channel.id,
        taskNumber,
        memberId: agent.id,
        baseSeq: claimSeq,
      });
    }
    if (claim.status === "held") {
      // 重试耗尽才让路；游标停在创建事件之前——事件保持 pending，后续轮次可重新收敛到 claim，
      // 不会像旧实现那样 ack 到 baseSeq 把事件静默消费成「永无 owner」（secretary-office #10）。
      const consumed = getDb().getConsumedSeq(agent.id, input.targetId);
      const yieldSeq = Math.max(
        consumed,
        Math.min(baseSeq, route.eventSeq - 1),
      );
      ack(agent.id, input.targetId, yieldSeq);
      // 记住这次未完成的认领：下一轮没有更新的任务信号时优先收敛（不落 DB）。
      rememberPendingTaskClaim({
        agentId: agent.id,
        channelId: channel.id,
        taskNumber,
        eventSeq: route.eventSeq,
      });
      return {
        status: "yielded",
        reason: `claim held after ${MAX_TASK_CLAIM_RETRIES} retries — the room kept changing`,
        baseSeq,
      };
    }
    if (claim.status === "claimed") {
      clearPendingTaskClaim(agent.id, channel.id, taskNumber);
      return finishRoutedReply(claim.task.anchor.id);
    }
    if (claim.status === "conflict") {
      // 竞争窗口里任务被别人拿走：按 B 作为参与者回线程，不因 claim conflict 丢掉这条回复。
      clearPendingTaskClaim(agent.id, channel.id, taskNumber);
      const current = getDb().getTaskById(task.id);
      if (current && current.owner_id !== null) {
        // 他人持有 → B；自己持有（同一 agent 的竞争窗口）→ D。两种都回线程，不丢回复。
        return finishRoutedReply(current.message_id);
      }
      ack(agent.id, input.targetId, baseSeq);
      return {
        status: "yielded",
        reason: claimFailureReason(claim),
        baseSeq,
      };
    }
    // blocked：reopened 封锁（仅人类可接管）；明确让路，不把回复投到别处。
    clearPendingTaskClaim(agent.id, channel.id, taskNumber);
    ack(agent.id, input.targetId, baseSeq);
    return {
      status: "yielded",
      reason: claimFailureReason(claim),
      baseSeq,
    };
  }

  // ---- claim：先认领再开工；失败就让路 --------------------------------------
  if (taskOp!.op === "claim") {
    const claim = claimTask({
      channelId: channel.id,
      taskNumber,
      memberId: agent.id,
      baseSeq,
    });
    if (claim.status !== "claimed") {
      clearPendingTaskClaim(agent.id, channel.id, taskNumber);
      ack(agent.id, input.targetId, baseSeq);
      return {
        status: "yielded",
        reason: claimFailureReason(claim),
        baseSeq,
      };
    }
    clearPendingTaskClaim(agent.id, channel.id, taskNumber);
    const delivered = await deliverReply(claim.task.anchor.id);
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

  clearPendingTaskClaim(agent.id, channel.id, taskNumber);
  const replyOutcome =
    action.action === "reply" && action.content
      ? await deliverReply(task.message_id)
      : { threadAckSeq: getDb().maxSeq(task.message_id) };

  // 状态收口（§6.3）：以 agent 语境里的 channel 版本起步，held 后按 roomSeq 重试；
  // 并发审查者已 close/reject（转移失效/越权）→ 不炸本轮：进展已在线程里，收口游标后让路
  const targetStatus = taskOp!.op === "complete" ? "in_review" : "todo";
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
    reason: `task ${taskOp!.op} → ${targetStatus}`,
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
  // 崩溃窗口（回复已写、游标未推）内的自愈：最新消息是自己的回复 → 只推进游标，不重复应答。
  // 但若本轮还带着未处理的任务信号（创建事件 / held 耗尽的 pending），早退会把事件
  // 静默消费成「永无 owner」——放行给下面的路由裁决（A 以其他作者消息为准）。
  const latest = getDb().getLatestMessage(targetId);
  const hasUnhandledTaskSignal =
    targetId === channel.id &&
    (hasPendingTaskClaim(agent.id, channel.id) ||
      hasRoutableTaskEvent(agent.id, channel, drained.messages));
  if (
    latest &&
    latest.author_id === agent.id &&
    !continuing &&
    !reminderDriven &&
    !hasUnhandledTaskSignal
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
    context: replyPromptContext(agent),
  });
  // op 结果并进本轮 reason（round_logs 可见；拒绝/held 不静默吞掉）。
  // 声明在 try 之前：catch 的 error 轮也要带 op 结果。
  let opsSummary = "";
  const withOps = (outcome: RoundOutcome): RoundOutcome =>
    opsSummary
      ? {
          ...outcome,
          reason: outcome.reason ? `${outcome.reason}; ${opsSummary}` : opsSummary,
        }
      : outcome;
  try {
    const first = await promptSession(session, prompt);
    if (!first.ok) {
      publishAgentStatus(agent.id, "error");
      // 11-整改：prompt-fail 的 error 轮携带本轮 drain 的房间版本
      return { status: "error", reason: first.error, baseSeq };
    }
    const action = parseAgentAction(first.text);
    // ADR-0013 决策一：本轮随附的成员 op（与 task 同一条缝）——以结构身份执行；
    // search 产出观察后，用一条后续 prompt 把结果交回（观察相最多一次）。
    let effectiveAction = action;
    if (action.ops?.length) {
      const opsApplied = await applyMemberOps({
        agent,
        targetId,
        action,
        promptFn: async (opsPrompt) => {
          const revised = await promptSession(session, opsPrompt);
          return revised.ok ? revised.text : "";
        },
      });
      effectiveAction = opsApplied.action;
      opsSummary = opsApplied.summary;
    }
    const route = resolveTaskReplyRoute({
      agentId: agent.id,
      action: effectiveAction,
      channel,
      targetId,
      incoming,
    });
    // §3.7 任务操作：先 claim 再开工；claim 失败就让路（不回复、只收口游标）
    if (effectiveAction.task || route) {
      // 非成员无 channel 成员资格，不做任务操作（claim 服务层会拒绝）
      if (!isMember) {
        ack(agentId, targetId, baseSeq);
        return withOps({
          status: "yielded",
          reason: "not a member of the channel",
          baseSeq,
        });
      }
      const outcome = await runTaskOperation({
        agent,
        channel,
        targetId,
        action: effectiveAction,
        baseSeq,
        route: route ?? undefined,
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
      return withOps(outcome);
    }
    if (effectiveAction.action === "conclude") {
      // 纯收束确认：确认收到但不发帖——ack 游标、清零 must-respond streak、状态回 online，
      // 不写任何消息。行位在任务 op / 自动路由之后、ignore 之前：任务优先级不变；
      // 确定信号下 conclude 是合法收束，直接返回，不进入下方 ignore 的 error / cap-ack 路径。
      ack(agentId, targetId, baseSeq);
      resetMustRespondFailures(agent.id, targetId);
      publishAgentStatus(agent.id, "online");
      return withOps({
        status: "yielded",
        reason: effectiveAction.reason
          ? `concluded: ${effectiveAction.reason}`
          : "concluded by agent",
        baseSeq,
      });
    }
    if (effectiveAction.action === "ignore") {
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
          return withOps({
            status: "error",
            reason: `ignore on must-respond signal (capped at ${MUST_RESPOND_FAILURE_CAP})`,
            baseSeq,
          });
        }
        return withOps({
          status: "error",
          reason: "ignore on must-respond signal",
          baseSeq,
        });
      }
      resetMustRespondFailures(agent.id, targetId);
      ack(agentId, targetId, baseSeq);
      return withOps({ status: "ignored", baseSeq });
    }
    if (!effectiveAction.content) {
      // §3.8 空内容回复（模型退化输出 {"action":"reply"} 无 content）：声明了 reply
      // 却给不出文本 = 本轮失败，与空文本同语义——不推进游标、publish error，触发消息
      // 保持 pending 供下次 wake 重试；否则消息被静默消费、agent 永不回复。
      publishAgentStatus(agent.id, "error");
      return withOps({
        status: "error",
        reason: "reply action without content",
        baseSeq,
      });
    }
    // §3.2 mention 穿透的回复：agent 可自行加入公开 channel（加入 = 订阅全部消息）；
    // 私有 channel 不能自行加入——回复不可投递，收口游标后静默让路
    if (!isMember) {
      if (channel.type === "private") {
        ack(agentId, targetId, baseSeq);
        return withOps({
          status: "silent",
          reason: "not a member of the private channel",
          baseSeq,
        });
      }
      joinChannel(channel.id, agent.id);
    }
    const outcome = await deliverWithFreshness({
      targetId,
      agent,
      channel,
      action: effectiveAction,
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
      return withOps({
        status: "error",
        reason: outcome.reason,
        baseSeq: outcome.ackSeq,
      });
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
      return withOps({
        status: "silent",
        reason: outcome.reason,
        baseSeq: outcome.ackSeq,
      });
    }
    return withOps({
      status: outcome.status,
      message: outcome.message,
      baseSeq: outcome.ackSeq,
    });
  } catch (error) {
    publishAgentStatus(agent.id, "error");
    // 11-整改：catch 的 error 轮携带本轮 drain 的房间版本
    return withOps({
      status: "error",
      reason: error instanceof Error ? error.message : String(error),
      baseSeq,
    });
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

interface BackfillQuarantine {
  agent: MemberRow;
  targetId: string;
  reason: string;
  replies?: SessionReply[];
}

interface BackfillScanFailure {
  agent: MemberRow;
  reason: string;
}

function backfillTargetKey(agentId: string, targetId: string): string {
  return `${agentId}\u0000${targetId}`;
}

interface DriverState {
  started: boolean;
  runtime: LoopRuntime | null;
  stopWake: (() => void) | null;
  queues: Map<string, QueuedTarget[]>;
  processing: Set<string>;
  waitingForSettle: Set<string>;
  settleUnsubs: Map<string, () => void>;
  backfillScanning: Set<string>;
  backfillPendingTargets: Set<string>;
  backfillQuarantine: Map<string, BackfillQuarantine>;
  backfillScanFailures: Map<string, BackfillScanFailure>;
  backfillAbort: AbortController | null;
  backfillOptions: BackfillOptions | null;
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
      backfillScanning: new Set(),
      backfillPendingTargets: new Set(),
      backfillQuarantine: new Map(),
      backfillScanFailures: new Map(),
      backfillAbort: null,
      backfillOptions: null,
    };
  }
  return globalThis.__workspliceAgentLoopDriver;
}

function isCurrentBackfill(
  state: DriverState,
  controller: AbortController,
): boolean {
  return state.backfillAbort === controller && !controller.signal.aborted;
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
  state.backfillScanning.clear();
  state.backfillPendingTargets.clear();
  state.backfillQuarantine.clear();
  state.backfillScanFailures.clear();
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

/** 测试观察用：被隔离的 agent/target 补拉键与脱敏原因。 */
export function peekAgentLoopBackfillQuarantine(): Array<{
  agentId: string;
  targetId: string;
  reason: string;
}> {
  return [...getDriverState().backfillQuarantine.values()].map((entry) => ({
    agentId: entry.agent.id,
    targetId: entry.targetId,
    reason: entry.reason,
  }));
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
  const scanFailure = state.backfillScanFailures.get(hint.agentId);
  if (scanFailure) {
    const key = backfillTargetKey(hint.agentId, hint.targetId);
    state.backfillPendingTargets.add(key);
    state.backfillQuarantine.set(key, {
      agent: scanFailure.agent,
      targetId: hint.targetId,
      reason: scanFailure.reason,
    });
  }
  void processAgent(hint.agentId);
}

async function processAgent(agentId: string): Promise<void> {
  const state = getDriverState();
  if (state.processing.has(agentId)) return;
  if (state.waitingForSettle.has(agentId)) return;
  if (state.backfillScanning.has(agentId)) return;

  state.processing.add(agentId);
  try {
    const runtime: LoopRuntime = state.runtime ?? (await getAgentRuntime());
    // 合并窗口：出队前让出一个微任务，让同一同步回合内到达的同 target hint 并入本 entry。
    //
    // 为什么必须显式让出：`enqueueWake` → `processAgent` 是一条同步调用链（wake 由
    // sendMessage / notifyTaskCreated 在同步块里发出）。若在这里同步 `shift` 出队，
    // 紧随其后的同 target hint 就再也 `find` 不到条目、只能 `push` 成第二条 entry ⇒
    // 多跑一轮；而那一轮的 drain 早于后一条消息落库，房间版本已过期 ⇒ claim 被自己
    // 顶高的那条消息 hold 让路。板上 Create Task 途径（用户消息 → createTask 的
    // 「任务已创建」事件消息）正是这个形状。
    //
    // 为什么以前"看起来是对的"：上一行的 `state.runtime ?? (await getAgentRuntime())`
    // 在生产（runtime=null，要惰性 import SDK）恰好让出一次微任务，掩盖了同步 shift；
    // 测试注入 fake runtime 时 `??` 短路、**不让出**，于是测试与生产走出不同结果
    // （实测：注入 fake 走两轮、生产形态合并成一条 entry）。显式让出后，合并语义
    // 不再依赖 runtime 是注入还是惰性 import，两条路径同形。
    //
    // 边界只在「出队前」：已经出队/已经在跑的那一轮，它 drain 早已完成，此时到达的
    // hint 仍走 push 起新一轮（不并进在跑的一轮——那会丢 hint），见下方 for 循环。
    await null;
    for (;;) {
      const queue = state.queues.get(agentId);
      const readyIndex = queue?.findIndex(
        (entry) =>
          !state.backfillPendingTargets.has(
            backfillTargetKey(agentId, entry.targetId),
          ),
      ) ?? -1;
      if (!queue || readyIndex < 0) break;
      const [queued] = queue.splice(readyIndex, 1);

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
  const queue = state.queues.get(agentId);
  const hasReadyTarget = queue?.some(
    (entry) =>
      !state.backfillPendingTargets.has(
        backfillTargetKey(agentId, entry.targetId),
      ),
  );
  if (
    hasReadyTarget &&
    !state.waitingForSettle.has(agentId) &&
    !state.backfillScanning.has(agentId)
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

export interface BackfillFileOps {
  stat(filePath: string): Promise<{ mtimeMs: number }>;
  readFile(filePath: string, signal?: AbortSignal): Promise<string>;
  readChunks?(filePath: string, signal?: AbortSignal): AsyncIterable<string>;
}

export interface BackfillOptions {
  fileOps?: BackfillFileOps;
  signal?: AbortSignal;
  batchLines?: number;
  retryDelayMs?: number;
  yieldToEventLoop?: () => Promise<void>;
  onBatchYield?: (agentId: string, lines: number) => void;
}

const BACKFILL_BATCH_LINES = 256;
const BACKFILL_READ_CHUNK_BYTES = 64 * 1024;
const BACKFILL_MAX_ATTEMPTS = 3;
const BACKFILL_CONCURRENCY = 2;
const BACKFILL_RETRY_DELAY_MS = 100;
const defaultBackfillFileOps: BackfillFileOps = {
  stat: (filePath) => fsPromises.stat(filePath),
  readFile: (filePath, signal) =>
    fsPromises.readFile(filePath, { encoding: "utf8", signal }),
  readChunks: (filePath, signal) =>
    createReadStream(filePath, {
      encoding: "utf8",
      highWaterMark: BACKFILL_READ_CHUNK_BYTES,
      signal,
    }),
};
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

function makeAbortError(): Error {
  const error = new Error("backfill cancelled");
  error.name = "AbortError";
  return error;
}

function throwIfBackfillAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw makeAbortError();
}

function isMissingFileError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function backfillErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createSessionReplyScanner() {
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

  return {
    push(line: string): void {
      if (!line.trim()) return;
      let entry: {
        type?: string;
        message?: { role?: string; content?: unknown };
      };
      try {
        entry = JSON.parse(line);
      } catch {
        return;
      }
      if (entry?.type !== "message" || !entry.message) return;
      const message = entry.message;
      if (message.role === "user") {
        const text = textFromContent(message.content);
        const match = ROOM_MARKER_PATTERN.exec(text);
        // 新的 user 条目（无论是否带标记）结束上一轮；带标记才开启新的协作轮。
        // revise prompt 丢弃上一轮 held 草稿，不按回复补写。
        if (!text.includes("[worksplice:revision]")) flush();
        pendingText = null;
        current = match ? { targetId: match[1], seq: Number(match[2]) } : null;
        return;
      }
      if (message.role !== "assistant") return;
      const text = textFromContent(message.content).trim();
      if (text) pendingText = text; // 最后一条胜出
    },
    finish(): SessionReply[] {
      flush();
      return replies;
    },
  };
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
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
  let offset = 0;
  while (offset < raw.length) {
    const newline = raw.indexOf("\n", offset);
    const end = newline < 0 ? raw.length : newline;
    const line = raw.slice(offset, end);
    offset = newline < 0 ? raw.length : newline + 1;
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
  try {
    statSync(file);
  } catch (error) {
    if (isMissingFileError(error)) {
      return { pass: false, reason: "session file missing on disk" };
    }
    throw error;
  }
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
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
  const scanner = createSessionReplyScanner();
  let offset = 0;
  while (offset < raw.length) {
    const newline = raw.indexOf("\n", offset);
    const end = newline < 0 ? raw.length : newline;
    scanner.push(raw.slice(offset, end));
    offset = newline < 0 ? raw.length : newline + 1;
  }
  return scanner.finish();
}

export interface BackfillTargetFailure {
  targetId: string;
  reason: string;
}

export interface BackfillResult {
  inserted: number;
  targets: string[];
  failedTargets?: BackfillTargetFailure[];
}

interface PreparedBackfill {
  skippedReason: string | null;
  repliesByTarget: Map<string, SessionReply[]>;
}

function sessionHeaderCwdFromLine(line: string): string | null | undefined {
  if (!line.trim()) return undefined;
  try {
    const entry = JSON.parse(line) as { type?: string; cwd?: unknown } | null;
    if (entry?.type !== "session") return undefined;
    return typeof entry.cwd === "string" && entry.cwd ? entry.cwd : null;
  } catch {
    return undefined;
  }
}

interface BackfillScanInput {
  agent: MemberRow;
  file: string;
  mtimeMs: number;
  options: BackfillOptions;
  chunks: AsyncIterable<string>;
}

async function scanBackfillChunks({
  agent,
  file,
  mtimeMs,
  options,
  chunks,
}: BackfillScanInput): Promise<PreparedBackfill> {
  const batchLines = Math.max(1, options.batchLines ?? BACKFILL_BATCH_LINES);
  const referencedFiles = referencedSessionFilesExcluding(agent.id);
  const scanner = createSessionReplyScanner();
  let headerFound = false;
  let skippedReason: string | null = null;
  let linesInBatch = 0;
  let lineBuffer = "";

  const processLine = async (line: string): Promise<void> => {
    throwIfBackfillAborted(options.signal);
    if (!headerFound) {
      const headerCwd = sessionHeaderCwdFromLine(line);
      if (headerCwd !== undefined) {
        headerFound = true;
        if (headerCwd === null) {
          skippedReason = "session file header has no cwd";
        } else if (
          !agent.workspace_path ||
          normalize(headerCwd) !== normalizeWorkspacePath(agent.workspace_path)
        ) {
          skippedReason = `header cwd (${headerCwd}) != workspace (${agent.workspace_path})`;
        } else if (referencedFiles.has(normalize(file))) {
          skippedReason = "session file also referenced by another member";
        } else if (mtimeMs < new Date(agent.created_at).getTime()) {
          skippedReason = `file mtime (${new Date(mtimeMs).toISOString()}) predates member creation (${agent.created_at})`;
        }
      }
    } else {
      scanner.push(line);
    }

    linesInBatch += 1;
    if (linesInBatch >= batchLines) {
      await (options.yieldToEventLoop ?? yieldToEventLoop)();
      options.onBatchYield?.(agent.id, linesInBatch);
      linesInBatch = 0;
    }
  };

  for await (const chunk of chunks) {
    throwIfBackfillAborted(options.signal);
    let cursor = 0;
    while (cursor < chunk.length) {
      const newline = chunk.indexOf("\n", cursor);
      if (newline < 0) break;
      lineBuffer += chunk.slice(cursor, newline);
      cursor = newline + 1;
      await processLine(lineBuffer);
      lineBuffer = "";
      if (skippedReason) break;
    }
    if (skippedReason) break;
    lineBuffer += chunk.slice(cursor);
  }
  if (!skippedReason && lineBuffer.length > 0) await processLine(lineBuffer);
  throwIfBackfillAborted(options.signal);

  if (skippedReason) return { skippedReason, repliesByTarget: new Map() };
  if (!headerFound) {
    return { skippedReason: "session file header has no cwd", repliesByTarget: new Map() };
  }

  const repliesByTarget = new Map<string, SessionReply[]>();
  for (const reply of scanner.finish()) {
    const targetReplies = repliesByTarget.get(reply.targetId) ?? [];
    targetReplies.push(reply);
    repliesByTarget.set(reply.targetId, targetReplies);
  }
  return { skippedReason: null, repliesByTarget };
}

async function* readBackfillChunks(
  fileOps: BackfillFileOps,
  file: string,
  signal?: AbortSignal,
): AsyncIterable<string> {
  if (fileOps.readChunks) {
    yield* fileOps.readChunks(file, signal);
    return;
  }
  yield await fileOps.readFile(file, signal);
}

async function prepareAgentBackfill(
  agent: MemberRow,
  options: BackfillOptions = {},
): Promise<PreparedBackfill> {
  throwIfBackfillAborted(options.signal);
  const file = agent.pi_session_file;
  if (!file) return { skippedReason: "no session file bound", repliesByTarget: new Map() };
  const fileOps = options.fileOps ?? defaultBackfillFileOps;
  let stat: { mtimeMs: number };
  try {
    stat = await fileOps.stat(file);
  } catch (error) {
    if (isMissingFileError(error)) {
      return { skippedReason: "session file missing on disk", repliesByTarget: new Map() };
    }
    throw error;
  }
  throwIfBackfillAborted(options.signal);
  if (!agent.workspace_path) {
    return { skippedReason: "member has no workspace", repliesByTarget: new Map() };
  }

  try {
    return await scanBackfillChunks({
      agent,
      file,
      mtimeMs: stat.mtimeMs,
      options,
      chunks: readBackfillChunks(fileOps, file, options.signal),
    });
  } catch (error) {
    if (isMissingFileError(error)) {
      return { skippedReason: "session file missing on disk", repliesByTarget: new Map() };
    }
    throw error;
  }
}

/**
 * 单个 target 的补写。
 *
 * 判重分两层（后者是本票新增的跨 target 层）：
 * - **同 target 幂等**：该 target 里已有本 agent 的同内容 ⇒ 已投递，跳过但推进游标；
 * - **跨 target（仅频道顶层）**：marker 记的是频道版本，而 §3.7 起任务回复的真实投递目标是
 *   task thread 的锚点消息（PR #190 的路由）。所以补写频道顶层前，还要查同作者同内容是否
 *   已存在于**本频道任一 thread**——命中说明该轮已投递，只是 target 不是频道。否则崩溃恢复
 *   会把同一段内容在频道顶层与线程里各存一份。
 *
 * 作用域刻意收窄：只有「marker 指向频道」的顶层补写做跨 target 判重。marker 指向线程的补写
 * 仍只看该线程本身——线程回复不会反向漏到频道，多判一层只会增加误伤真实补拉的面。
 * 跨 target 层只认同作者（ADR-0004 的轮级跨作者去重保持同 target 原口径）。
 */
function applyBackfillTarget(
  agent: MemberRow,
  targetId: string,
  replies: SessionReply[],
): number {
  const db = getDb();
  // target 本身是频道才需要跨 target 判重；thread 锚点返回 undefined。
  const channelId = db.getChannel(targetId)?.id ?? null;
  let inserted = 0;
  let cursorSeq: number | null = null;
  let contentBlocked = 0;
  let threadDelivered = 0;
  db.withTransaction(() => {
    for (const reply of replies) {
      // ADR-0004 轮级跨作者去重；命中轮跳过，不把他人回复冒充为本 agent 投递。
      if (
        db.hasMessageByContentByOther(reply.targetId, agent.id, reply.content)
      ) {
        contentBlocked += 1;
        continue;
      }
      cursorSeq = Math.max(cursorSeq ?? 0, reply.markerSeq);
      if (db.hasMessage(reply.targetId, agent.id, reply.content)) continue;
      // 跨 target：同一内容已在本频道的某个 task thread 里由本 agent 投递过 → 顶层不再补写。
      // 游标照常推进（与同 target 幂等同一口径：标记轮已投递，不该反复重读）。
      if (
        channelId &&
        db.hasAuthorContentInChannel(channelId, agent.id, reply.content)
      ) {
        threadDelivered += 1;
        continue;
      }
      const seq = db.maxSeq(reply.targetId) + 1;
      db.insertMessageAt({
        targetId: reply.targetId,
        authorId: agent.id,
        content: reply.content,
        seq,
      });
      inserted += 1;
    }
  });
  if (threadDelivered > 0) {
    console.warn(
      `[backfill] member ${agent.id}: skipped ${threadDelivered} channel reply round(s) ` +
        `already delivered to a task thread in this channel (target: ${targetId}); ` +
        `cursor advanced`,
    );
  }
  if (contentBlocked > 0) {
    console.warn(
      `[backfill] member ${agent.id}: skipped ${contentBlocked} reply round(s) whose ` +
        `content already exists under another author (target: ${targetId}); cursor left pending for re-read`,
    );
  }
  if (cursorSeq !== null) {
    db.setConsumedSeq(
      agent.id,
      targetId,
      Math.max(db.getConsumedSeq(agent.id, targetId), cursorSeq),
    );
  }
  return inserted;
}

/**
 * 单个 agent 的补拉：异步读取文件、按有限行数让出事件循环，再逐 target 原子补写。
 * marker 存在即推进对应游标；同作者幂等、跨作者去重与 revision 语义保持不变。
 */
export async function backfillAgentReplies(
  agent: MemberRow,
  options: BackfillOptions = {},
): Promise<BackfillResult> {
  const plan = await prepareAgentBackfill(agent, options);
  if (plan.skippedReason) {
    if (
      plan.skippedReason !== "no session file bound" &&
      plan.skippedReason !== "session file missing on disk"
    ) {
      console.warn(
        `[backfill] skipping session file ${agent.pi_session_file} for member ${agent.id}: ${plan.skippedReason}`,
      );
    }
    return { inserted: 0, targets: [] };
  }

  let inserted = 0;
  const targets: string[] = [];
  const failedTargets: BackfillTargetFailure[] = [];
  for (const [targetId, replies] of plan.repliesByTarget) {
    throwIfBackfillAborted(options.signal);
    try {
      const targetInserted = applyBackfillTarget(agent, targetId, replies);
      inserted += targetInserted;
      if (targetInserted > 0) targets.push(targetId);
    } catch (error) {
      failedTargets.push({ targetId, reason: backfillErrorText(error) });
    }
  }
  return {
    inserted,
    targets,
    ...(failedTargets.length > 0 ? { failedTargets } : {}),
  };
}

/** 全员补拉的测试适配器：补写直接落库，不触发 wake。 */
export async function backfillAllAgents(
  options: BackfillOptions = {},
): Promise<BackfillResult> {
  let inserted = 0;
  const targets = new Set<string>();
  const failedTargets: BackfillTargetFailure[] = [];
  for (const agent of listAgents()) {
    throwIfBackfillAborted(options.signal);
    try {
      const result = await backfillAgentReplies(agent, options);
      inserted += result.inserted;
      for (const targetId of result.targets) targets.add(targetId);
      failedTargets.push(...(result.failedTargets ?? []));
    } catch (error) {
      console.error(
        `[backfill] failed for member ${agent.id}: ${backfillErrorText(error)}`,
      );
    }
    await (options.yieldToEventLoop ?? yieldToEventLoop)();
  }
  return {
    inserted,
    targets: [...targets],
    ...(failedTargets.length > 0 ? { failedTargets } : {}),
  };
}

function backfillRetryDelay(options: BackfillOptions, attempt: number): number {
  return (options.retryDelayMs ?? BACKFILL_RETRY_DELAY_MS) * 2 ** (attempt - 1);
}

async function waitForBackfillRetry(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (delayMs <= 0) {
    await yieldToEventLoop();
    throwIfBackfillAborted(signal);
    return;
  }
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });
  });
  throwIfBackfillAborted(signal);
}

function pendingTargetsForFailedScan(
  state: DriverState,
  agentId: string,
): string[] {
  const targets = new Set<string>(state.queues.get(agentId)?.map((item) => item.targetId) ?? []);
  try {
    for (const targetId of getPendingTargets(agentId)) targets.add(targetId);
  } catch {
    // inbox 查询也可能暂时失败；至少隔离已观察到 wake 的键。
  }
  return [...targets];
}

interface BackfillTargetRetry {
  state: DriverState;
  agent: MemberRow;
  targetId: string;
  replies: SessionReply[];
  options: BackfillOptions;
  controller: AbortController;
  firstAttempt?: number;
}

async function applyBackfillTargetWithRetry({
  state,
  agent,
  targetId,
  replies,
  options,
  controller,
  firstAttempt = 1,
}: BackfillTargetRetry): Promise<void> {
  const signal = controller.signal;
  const key = backfillTargetKey(agent.id, targetId);
  for (let attempt = firstAttempt; attempt <= BACKFILL_MAX_ATTEMPTS; attempt += 1) {
    if (!isCurrentBackfill(state, controller)) return;
    try {
      applyBackfillTarget(agent, targetId, replies);
      if (!isCurrentBackfill(state, controller)) return;
      state.backfillPendingTargets.delete(key);
      state.backfillQuarantine.delete(key);
      void processAgent(agent.id);
      return;
    } catch (error) {
      if (!isCurrentBackfill(state, controller)) return;
      const reason = backfillErrorText(error);
      console.error(
        `[backfill] member ${agent.id} target ${targetId} attempt ${attempt}/${BACKFILL_MAX_ATTEMPTS} failed: ${reason}`,
      );
      if (attempt === BACKFILL_MAX_ATTEMPTS) {
        state.backfillQuarantine.set(key, {
          agent,
          targetId,
          reason,
          replies,
        });
        return;
      }
      try {
        await waitForBackfillRetry(backfillRetryDelay(options, attempt), signal);
      } catch (retryError) {
        if (!isCurrentBackfill(state, controller)) return;
        if (isAbortError(retryError)) return;
        throw retryError;
      }
    }
  }
}

interface AgentBackfillRun {
  state: DriverState;
  agent: MemberRow;
  options: BackfillOptions;
  controller: AbortController;
  onlyTargetId?: string;
}

function quarantineScanFailure(
  state: DriverState,
  agent: MemberRow,
  reason: string,
  controller: AbortController,
  onlyTargetId?: string,
): void {
  if (!isCurrentBackfill(state, controller)) return;
  const targets = onlyTargetId
    ? [onlyTargetId]
    : pendingTargetsForFailedScan(state, agent.id);
  state.backfillScanFailures.set(agent.id, { agent, reason });
  for (const targetId of targets) {
    const key = backfillTargetKey(agent.id, targetId);
    state.backfillPendingTargets.add(key);
    state.backfillQuarantine.set(key, { agent, targetId, reason });
  }
  state.backfillScanning.delete(agent.id);
  void processAgent(agent.id);
}

async function scanAgentBackfillWithRetries(
  run: AgentBackfillRun,
): Promise<PreparedBackfill | null> {
  const { state, agent, options, controller, onlyTargetId } = run;
  const signal = controller.signal;
  for (let attempt = 1; attempt <= BACKFILL_MAX_ATTEMPTS; attempt += 1) {
    if (!isCurrentBackfill(state, controller)) return null;
    try {
      const plan = await prepareAgentBackfill(agent, { ...options, signal });
      return isCurrentBackfill(state, controller) ? plan : null;
    } catch (error) {
      if (!isCurrentBackfill(state, controller)) return null;
      if (isAbortError(error)) {
        state.backfillScanning.delete(agent.id);
        void processAgent(agent.id);
        return null;
      }
      const reason = backfillErrorText(error);
      console.error(
        `[backfill] member ${agent.id} scan attempt ${attempt}/${BACKFILL_MAX_ATTEMPTS} failed: ${reason}`,
      );
      if (attempt === BACKFILL_MAX_ATTEMPTS) {
        quarantineScanFailure(state, agent, reason, controller, onlyTargetId);
        return null;
      }
      try {
        await waitForBackfillRetry(backfillRetryDelay(options, attempt), signal);
      } catch (retryError) {
        if (!isCurrentBackfill(state, controller)) return null;
        if (isAbortError(retryError)) {
          state.backfillScanning.delete(agent.id);
          void processAgent(agent.id);
          return null;
        }
        throw retryError;
      }
    }
  }
  return null;
}

function releaseSkippedBackfill(
  state: DriverState,
  agent: MemberRow,
  reason: string,
  controller: AbortController,
  onlyTargetId?: string,
): void {
  if (!isCurrentBackfill(state, controller)) return;
  state.backfillScanFailures.delete(agent.id);
  if (reason !== "no session file bound" && reason !== "session file missing on disk") {
    console.warn(
      `[backfill] skipping session file ${agent.pi_session_file} for member ${agent.id}: ${reason}`,
    );
  }
  if (onlyTargetId) {
    const key = backfillTargetKey(agent.id, onlyTargetId);
    state.backfillPendingTargets.delete(key);
    state.backfillQuarantine.delete(key);
  }
  state.backfillScanning.delete(agent.id);
  void processAgent(agent.id);
}

async function runAgentBackfill(run: AgentBackfillRun): Promise<void> {
  const { state, agent, options, controller, onlyTargetId } = run;
  const plan = await scanAgentBackfillWithRetries(run);
  if (!plan || !isCurrentBackfill(state, controller)) return;
  if (plan.skippedReason) {
    releaseSkippedBackfill(state, agent, plan.skippedReason, controller, onlyTargetId);
    return;
  }

  state.backfillScanFailures.delete(agent.id);
  const targetEntries = [...plan.repliesByTarget].filter(
    ([targetId]) => !onlyTargetId || targetId === onlyTargetId,
  );
  for (const [targetId] of targetEntries) {
    state.backfillPendingTargets.add(backfillTargetKey(agent.id, targetId));
  }
  if (onlyTargetId && !plan.repliesByTarget.has(onlyTargetId)) {
    const key = backfillTargetKey(agent.id, onlyTargetId);
    state.backfillPendingTargets.delete(key);
    state.backfillQuarantine.delete(key);
  }
  state.backfillScanning.delete(agent.id);
  void processAgent(agent.id);
  for (const [targetId, replies] of targetEntries) {
    void applyBackfillTargetWithRetry({
      state,
      agent,
      targetId,
      replies,
      options,
      controller,
    });
  }
}

function startAgentBackfill(options: BackfillOptions = {}): void {
  const state = getDriverState();
  if (state.backfillAbort) stopAgentBackfill();
  const controller = new AbortController();
  state.backfillAbort = controller;
  state.backfillOptions = options;
  let agents: MemberRow[];
  try {
    agents = listAgents();
  } catch (error) {
    console.error(`[backfill] failed to list agents: ${backfillErrorText(error)}`);
    return;
  }
  for (const agent of agents) state.backfillScanning.add(agent.id);
  setImmediate(() => {
    let nextAgent = 0;
    const worker = async () => {
      while (isCurrentBackfill(state, controller)) {
        const agent = agents[nextAgent];
        nextAgent += 1;
        if (!agent) return;
        try {
          await runAgentBackfill({ state, agent, options, controller });
        } catch (error) {
          if (isCurrentBackfill(state, controller)) {
            const reason = backfillErrorText(error);
            console.error(`[backfill] member ${agent.id} failed: ${reason}`);
            state.backfillScanFailures.set(agent.id, { agent, reason });
            state.backfillScanning.delete(agent.id);
            for (const targetId of pendingTargetsForFailedScan(state, agent.id)) {
              const key = backfillTargetKey(agent.id, targetId);
              state.backfillPendingTargets.add(key);
              state.backfillQuarantine.set(key, {
                agent,
                targetId,
                reason,
              });
            }
            void processAgent(agent.id);
          }
        }
        if (isCurrentBackfill(state, controller)) await yieldToEventLoop();
      }
    };
    const workers = Array.from(
      { length: Math.min(BACKFILL_CONCURRENCY, agents.length) },
      () => worker(),
    );
    void Promise.all(workers);
  });
}

function stopAgentBackfill(): void {
  const state = getDriverState();
  const controller = state.backfillAbort;
  state.backfillAbort = null;
  controller?.abort();
  state.backfillOptions = null;
  state.backfillScanning.clear();
  state.backfillPendingTargets.clear();
  state.backfillQuarantine.clear();
  state.backfillScanFailures.clear();
}

/** 仅显式重试被隔离的一个补拉键；其他 target 不受影响。 */
export function retryAgentBackfillTarget(
  agentId: string,
  targetId: string,
): boolean {
  const state = getDriverState();
  const key = backfillTargetKey(agentId, targetId);
  const quarantined = state.backfillQuarantine.get(key);
  const controller = state.backfillAbort;
  if (!quarantined || !state.started || !controller || controller.signal.aborted) {
    return false;
  }
  state.backfillQuarantine.delete(key);
  state.backfillPendingTargets.add(key);
  const options = state.backfillOptions ?? {};
  if (quarantined.replies) {
    void applyBackfillTargetWithRetry({
      state,
      agent: quarantined.agent,
      targetId,
      replies: quarantined.replies,
      options,
      controller,
    });
  } else {
    state.backfillScanning.add(agentId);
    void runAgentBackfill({
      state,
      agent: quarantined.agent,
      options,
      controller,
      onlyTargetId: targetId,
    });
  }
  return true;
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
  deps: {
    runtime?: LoopRuntime;
    pollMs?: number;
    now?: () => Date;
    backfill?: BackfillOptions;
  } = {},
): AgentLoop {
  let started = false;
  return {
    start(): void {
      if (started) return;
      started = true;
      startAgentStatusSweeper();
      // 先同步建立各 agent 的补拉屏障，再启动 driver 和 cron；会话文件 I/O 与解析
      // 留到后续事件循环轮次执行。
      startAgentBackfill(deps.backfill);
      startAgentLoopDriver({ runtime: deps.runtime });
      startReminderCron({ pollMs: deps.pollMs, now: deps.now });
    },
    stop(): void {
      started = false;
      stopAgentBackfill();
      stopAgentLoopDriver();
      stopReminderCron();
    },
    tick(): void {
      tickReminderCron(deps.now ? deps.now() : new Date());
    },
  };
}
