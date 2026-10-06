/**
 * 成员 op 协议（ADR-0013 决策一）：成员经 loop 的结构化回复协议请求系统动作——
 * 与既有的 `task`（claim / complete / unclaim）同一条缝、同一套 freshness 纪律。
 *
 * 三件事在这里收口：
 * 1. **解析**（`parseMemberOps`，纯函数）：`{"ops":[...]}` 数组 → 名字 + 原始字段；
 *    未知名字与坏条目**保留**下来（不静默丢弃——「报边界、不静默改写」，ADR-0011 D7 的意图）。
 * 2. **裁决 + 校验**（`planMemberOps`，纯函数）：先过能力表（默认拒绝、逐条开口，见
 *    lib/domain/collab/member-capabilities.ts），再逐 op 校验字段形状；两项任缺即拒绝。
 * 3. **执行**（`executeMemberOps`）：以**结构身份**（调用点握有的 agent）落库，不经请求头自述。
 *    `search` 单独一趟：它产出观察（命中列表），由调用方（runAgentRound）用一条后续 prompt
 *    交回模型；同轮的非 search op 延后到那条 prompt 之后再执行——避免同一动作落两次
 *    （react 是 toggle，落两次等于没落），也避免模型在没看到搜索结果时就写死回复。
 *
 * 不注册新工具：本模块是协议层，`lib/tool-presets.ts` 全程不动。
 */

import { getDb } from "../data/db-singleton.ts";
import {
  canMemberPerform,
  createAgent,
  createChannel,
  isValidRecurrence,
  pinMessage,
  readDefaultModelFromSettings,
  resolveChannelForTarget,
  resolveTargetRef,
  scheduleReminder,
  searchMessages,
  sendMessage,
  toggleReaction,
  type DefaultModelConfig,
  type MessageSearchHit,
} from "../domain/collab/index.ts";
import type { ChannelRow, MemberRow } from "../data/types.ts";

// ---------------------------------------------------------------------------
// 协议形状
// ---------------------------------------------------------------------------

/** 一轮里最多执行的 op 数（一条回复不得无限扇出）。 */
export const MAX_MEMBER_OPS_PER_ROUND = 8;

export interface RawMemberOp {
  /** op 名；未知/坏条目一律记为 "unknown"（执行器默认拒绝）。 */
  op: string;
  /** 原始字段（逐 op 校验后才成为强类型动作）。 */
  fields: Record<string, unknown>;
}

/** 解析 `{"ops":[...]}`：不是数组 → 空（向后兼容，没有 ops 的老协议一字不变）。 */
export function parseMemberOps(value: unknown): RawMemberOp[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry): RawMemberOp => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { op: "unknown", fields: {} };
    }
    const record = entry as Record<string, unknown>;
    const name = typeof record.op === "string" ? record.op.trim() : "";
    if (!name) return { op: "unknown", fields: record };
    const fields: Record<string, unknown> = { ...record };
    delete fields.op;
    return { op: name, fields };
  });
}

/** 消息句柄：`messageId` 直指；或 `seq` +（可选的）`targetId` 在某个 target 的 seq 空间里定位。 */
export interface MessageRef {
  messageId: string | null;
  seq: number | null;
  targetRef: string | null;
}

export type MemberAction =
  | { op: "react"; messageRef: MessageRef; emoji: string }
  | { op: "pin"; messageRef: MessageRef }
  | {
      op: "remind";
      title: string;
      fireAt: string | null;
      inMinutes: number | null;
      recurrence: string | null;
      targetRef: string | null;
    }
  | { op: "post"; targetRef: string; content: string; baseSeq: number | null }
  | {
      op: "createChannel";
      name: string;
      type: "public" | "private";
      description: string;
      members: string[];
    }
  | {
      op: "createAgent";
      name: string;
      description: string;
      provider: string | null;
      modelId: string | null;
      thinkingLevel: string | null;
    }
  | { op: "search"; query: string; limit: number | null };

export type MemberOpPlan =
  | { kind: "planned"; action: MemberAction }
  | { kind: "rejected"; name: string; reason: string };

// ---------------------------------------------------------------------------
// 字段读取（纯）
// ---------------------------------------------------------------------------

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** 无符号整数（正数）。字符串数字不接受——字段形状要明确，别让模型碰运气。 */
function positiveInt(value: unknown, max = Number.MAX_SAFE_INTEGER): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value <= 0 || value > max) return null;
  return value;
}

function optionalPositiveInt(value: unknown, max = Number.MAX_SAFE_INTEGER): number | null {
  if (value === undefined || value === null) return null;
  return positiveInt(value, max);
}

function messageRefFrom(fields: Record<string, unknown>): MessageRef | null {
  const messageId = optionalString(fields.messageId);
  const seq = optionalPositiveInt(fields.seq);
  const targetRef = optionalString(fields.targetId);
  if (!messageId && !seq) return null;
  return { messageId, seq, targetRef };
}

function planForOp(name: string, fields: Record<string, unknown>): MemberOpPlan {
  switch (name) {
    case "react": {
      const emoji = nonEmptyString(fields.emoji);
      if (!emoji) return { kind: "rejected", name, reason: '"emoji" is required' };
      if (emoji.length > 32) return { kind: "rejected", name, reason: '"emoji" is too long' };
      const messageRef = messageRefFrom(fields);
      if (!messageRef) {
        return { kind: "rejected", name, reason: 'a message handle is required ("messageId" or "seq")' };
      }
      return { kind: "planned", action: { op: "react", messageRef, emoji } };
    }
    case "pin": {
      const messageRef = messageRefFrom(fields);
      if (!messageRef) {
        return { kind: "rejected", name, reason: 'a message handle is required ("messageId" or "seq")' };
      }
      return { kind: "planned", action: { op: "pin", messageRef } };
    }
    case "remind": {
      const title = nonEmptyString(fields.title);
      if (!title) return { kind: "rejected", name, reason: '"title" is required' };
      const fireAt = optionalString(fields.fireAt);
      const inMinutes = optionalPositiveInt(fields.inMinutes, 60 * 24 * 365);
      if (fireAt && inMinutes) {
        return { kind: "rejected", name, reason: 'give exactly one of "fireAt" or "inMinutes"' };
      }
      if (!fireAt && !inMinutes) {
        return { kind: "rejected", name, reason: 'one of "fireAt" (ISO) or "inMinutes" is required' };
      }
      if (fireAt && Number.isNaN(Date.parse(fireAt))) {
        return { kind: "rejected", name, reason: '"fireAt" must be a valid ISO date string' };
      }
      const recurrence = optionalString(fields.recurrence);
      if (recurrence && !isValidRecurrence(recurrence)) {
        return { kind: "rejected", name, reason: '"recurrence" must be a valid recurrence DSL string' };
      }
      return {
        kind: "planned",
        action: {
          op: "remind",
          title,
          fireAt: fireAt ? new Date(fireAt).toISOString() : null,
          inMinutes,
          recurrence,
          targetRef: optionalString(fields.targetId),
        },
      };
    }
    case "post": {
      const targetRef = nonEmptyString(fields.targetId);
      if (!targetRef) return { kind: "rejected", name, reason: '"targetId" is required' };
      const content = nonEmptyString(fields.content);
      if (!content) return { kind: "rejected", name, reason: '"content" is required' };
      const baseSeq = optionalPositiveInt(fields.baseSeq);
      if (fields.baseSeq !== undefined && fields.baseSeq !== null && baseSeq === null) {
        return { kind: "rejected", name, reason: '"baseSeq" must be a positive integer' };
      }
      return { kind: "planned", action: { op: "post", targetRef, content, baseSeq } };
    }
    case "createChannel": {
      const channelName = nonEmptyString(fields.name);
      if (!channelName) return { kind: "rejected", name, reason: '"name" is required' };
      if (channelName.length > 32) {
        return { kind: "rejected", name, reason: '"name" must be 32 characters or fewer' };
      }
      const type = fields.type === undefined || fields.type === null ? "public" : fields.type;
      if (type !== "public" && type !== "private") {
        return { kind: "rejected", name, reason: '"type" must be "public" or "private"' };
      }
      const members = Array.isArray(fields.members)
        ? fields.members
            .map((entry) => nonEmptyString(entry))
            .filter((entry): entry is string => Boolean(entry))
        : [];
      return {
        kind: "planned",
        action: {
          op: "createChannel",
          name: channelName,
          type,
          description: optionalString(fields.description) ?? "",
          members,
        },
      };
    }
    case "createAgent": {
      const agentName = nonEmptyString(fields.name);
      if (!agentName) return { kind: "rejected", name, reason: '"name" is required' };
      if (agentName.length > 32) {
        return { kind: "rejected", name, reason: '"name" must be 32 characters or fewer' };
      }
      const provider = optionalString(fields.provider);
      const modelId = optionalString(fields.modelId);
      if (Boolean(provider) !== Boolean(modelId)) {
        return { kind: "rejected", name, reason: '"provider" and "modelId" must be given together' };
      }
      return {
        kind: "planned",
        action: {
          op: "createAgent",
          name: agentName,
          description: optionalString(fields.description) ?? "",
          provider,
          modelId,
          thinkingLevel: optionalString(fields.thinkingLevel),
        },
      };
    }
    case "search": {
      const query = nonEmptyString(fields.query);
      if (!query) return { kind: "rejected", name, reason: '"query" is required' };
      const limit = optionalPositiveInt(fields.limit, 50);
      return { kind: "planned", action: { op: "search", query, limit } };
    }
    default:
      // 能走到这里说明名字在能力表里判为开口，但不是 `ops` 数组里的条目——
      // `reply` / `task` 是这一轮自己的字段（action / task），不是 op。理由要说准，
      // 不能对刚判为开口的名字回一句「default deny」（报边界要准确，ADR-0011 D7）。
      return {
        kind: "rejected",
        name,
        reason: `"${name}" is not an "ops" entry — it is the round's own action/task field`,
      };
  }
}

/**
 * 裁决 + 校验（纯函数）：先过能力表（默认拒绝、逐条开口），再逐 op 校验字段形状。
 * 未知名字与人类专属名字在裁决阶段被拒；形状不合格在计划阶段被拒——两处理由都要能读。
 */
export function planMemberOps(raw: RawMemberOp[]): MemberOpPlan[] {
  return raw.map((entry, index): MemberOpPlan => {
    if (index >= MAX_MEMBER_OPS_PER_ROUND) {
      return {
        kind: "rejected",
        name: entry.op,
        reason: `at most ${MAX_MEMBER_OPS_PER_ROUND} ops per round`,
      };
    }
    const verdict = canMemberPerform(entry.op, "agent");
    if (!verdict.allowed) {
      return { kind: "rejected", name: entry.op, reason: verdict.reason };
    }
    return planForOp(entry.op, entry.fields);
  });
}

// ---------------------------------------------------------------------------
// 执行（以调用点握有的 agent 为结构身份）
// ---------------------------------------------------------------------------

export interface MemberOpOutcome {
  op: string;
  status: "applied" | "held" | "denied" | "deferred" | "error";
  detail: string;
}

export interface MemberOpsOutcome {
  outcomes: MemberOpOutcome[];
  /** 观察相文本（search 命中）；null = 不需要后续 prompt。 */
  observation: string | null;
}

/** 搜索观察里每条命中的摘要上限（prompt 预算）。 */
const OBSERVATION_SNIPPET_CAP = 240;

function stripMarks(snippet: string): string {
  return snippet.replace(/<\/?mark>/g, "");
}

function channelLabel(targetId: string): string {
  const channel = getDb().getChannel(targetId);
  if (channel) return `#${channel.name}`;
  return `thread of ${targetId}`;
}

/** 搜索命中 → 观察文本（含消息句柄，便于模型用 react / pin 引用命中）。 */
export function formatSearchObservation(query: string, hits: MessageSearchHit[]): string {
  const lines = [`Search results for "${query}" (scoped to the channels you belong to):`];
  if (hits.length === 0) {
    lines.push("(no matches)");
    return lines.join("\n");
  }
  for (const hit of hits) {
    const author = hit.author?.name ?? "unknown";
    const snippet = stripMarks(hit.snippet).replace(/\s+/g, " ").slice(0, OBSERVATION_SNIPPET_CAP);
    // channel 命中：seq + channel 名即可回指（react/pin 的 seq + targetId）；
    // thread 命中：seq 属线程自己的空间，附 messageId 句柄，否则模型拿不到引用。
    const where = hit.inThread
      ? `${channelLabel(hit.target_id)} (thread, messageId ${hit.id})`
      : channelLabel(hit.target_id);
    lines.push(`- #${hit.seq} @${author} in ${where}: ${snippet}`);
  }
  return lines.join("\n");
}

/** target 引用解析（`#name` / id）与「不可嵌套」规则由服务层拥有：lib/domain/collab/messages.ts 的
 *  `resolveTargetRef`——成员面 op 与 sendMessage 共用同一处归一化，不在这里第二份实现。 */

function resolveMessageId(ref: MessageRef, defaultTargetId: string): string {
  if (ref.messageId) {
    const message = getDb().getMessage(ref.messageId);
    if (!message) throw new Error(`Message not found: ${ref.messageId}`);
    return message.id;
  }
  const targetId = ref.targetRef ? resolveTargetRef(ref.targetRef) : defaultTargetId;
  const seq = ref.seq ?? 0;
  const rows = getDb().listMessagesBefore(targetId, seq + 1, 1);
  const row = rows[0];
  if (!row || row.seq !== seq) {
    throw new Error(`No message #${seq} in ${channelLabel(targetId)}`);
  }
  return row.id;
}

function resolveMemberIds(refs: string[]): string[] {
  const ids: string[] = [];
  for (const ref of refs) {
    const name = ref.startsWith("@") ? ref.slice(1) : ref;
    const member = getDb().getMemberByName(name);
    if (!member || member.deleted === 1) throw new Error(`Member not found: ${ref}`);
    if (!ids.includes(member.id)) ids.push(member.id);
  }
  return ids;
}

export interface ExecuteMemberOpsInput {
  agent: MemberRow;
  channel: ChannelRow;
  targetId: string;
  plans: MemberOpPlan[];
  /** 建 agent 的默认模型解析器（测试注入）；缺省读 settings.json。 */
  resolveDefaultModel?: () => DefaultModelConfig | null;
  /** 相对时间基准（inMinutes）；测试注入。 */
  now?: () => Date;
}

/**
 * 执行一轮的 op 计划（调用点在 runAgentRound，身份 = input.agent）。
 * - search 先跑一趟并把命中放进 observation；同轮其它 op 标 deferred（等观察相后的重申）；
 * - 其余 op 按声明序执行；拒绝/失败只记 outcome（不炸整轮，回复照常投递）。
 */
export function executeMemberOps(input: ExecuteMemberOpsInput): MemberOpsOutcome {
  const now = input.now ?? (() => new Date());
  const outcomes: MemberOpOutcome[] = [];
  const searchPlans = input.plans.filter(
    (plan): plan is Extract<MemberOpPlan, { kind: "planned" }> =>
      plan.kind === "planned" && plan.action.op === "search",
  );
  const hasSearch = searchPlans.length > 0;
  const observationParts: string[] = [];

  for (const plan of input.plans) {
    if (plan.kind === "rejected") {
      outcomes.push({ op: plan.name, status: "denied", detail: plan.reason });
      continue;
    }
    const action = plan.action;
    if (hasSearch && action.op !== "search") {
      outcomes.push({
        op: action.op,
        status: "deferred",
        detail: "deferred: restate it in your reply after you see the search results",
      });
      continue;
    }
    try {
      const outcome = runAction(action, {
        agent: input.agent,
        channel: input.channel,
        targetId: input.targetId,
        now,
        resolveDefaultModel: input.resolveDefaultModel,
      });
      outcomes.push(outcome);
      if (action.op === "search" && outcome.observation) {
        observationParts.push(outcome.observation);
      }
    } catch (error) {
      outcomes.push({
        op: action.op,
        status: "error",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const deferred = outcomes.filter((outcome) => outcome.status === "deferred").length;
  if (deferred > 0) {
    observationParts.push(
      `(${deferred} other operation(s) were NOT executed yet — restate the ones you still want in your next reply action.)`,
    );
  }
  return {
    outcomes,
    observation: observationParts.length > 0 ? observationParts.join("\n\n") : null,
  };
}

interface ActionContext {
  agent: MemberRow;
  channel: ChannelRow;
  targetId: string;
  now: () => Date;
  resolveDefaultModel?: () => DefaultModelConfig | null;
}

function runAction(
  action: MemberAction,
  context: ActionContext,
): MemberOpOutcome & { observation?: string } {
  const { agent, targetId } = context;
  switch (action.op) {
    case "react": {
      const messageId = resolveMessageId(action.messageRef, targetId);
      const result = toggleReaction({ messageId, memberId: agent.id, emoji: action.emoji });
      return {
        op: "react",
        status: "applied",
        detail: `${result.active ? "added" : "removed"} reaction ${action.emoji} as @${agent.name}`,
      };
    }
    case "pin": {
      const messageId = resolveMessageId(action.messageRef, targetId);
      // 归属 channel 由消息自己决定（thread 消息经锚点归一化）——与 react 一致，
      // 不假定它在本轮 target 的 channel 里（跨频道引用不该被误拒）。
      const message = getDb().getMessage(messageId);
      const owningChannel = message ? resolveChannelForTarget(message.target_id) : undefined;
      if (!owningChannel) throw new Error(`Message not found: ${messageId}`);
      pinMessage({ channelId: owningChannel.id, messageId, memberId: agent.id });
      return { op: "pin", status: "applied", detail: `pinned a message as @${agent.name}` };
    }
    case "remind": {
      // 缺 targetRef 时默认钉在本轮 target（§3.9：无 target 的提醒到点不投递、不唤醒作者——
      // 那与「提醒唤醒作者本人」相悖，所以默认值必须是能投递的目标）。
      const reminderTarget = action.targetRef ? resolveTargetRef(action.targetRef) : targetId;
      const fireAt = action.fireAt
        ? action.fireAt
        : new Date(context.now().getTime() + (action.inMinutes ?? 0) * 60_000).toISOString();
      const reminder = scheduleReminder({
        title: action.title,
        fireAt,
        recurrence: action.recurrence,
        targetId: reminderTarget,
        authorId: agent.id,
      });
      return {
        op: "remind",
        status: "applied",
        detail: `scheduled reminder "${reminder.title}" for ${reminder.fire_at} as @${agent.name}`,
      };
    }
    case "post": {
      const resolved = resolveTargetRef(action.targetRef);
      const baseSeq = action.baseSeq ?? getDb().maxSeq(resolved);
      const result = sendMessage({
        targetId: resolved,
        authorId: agent.id,
        content: action.content,
        baseSeq,
      });
      if (result.held) {
        return {
          op: "post",
          status: "held",
          detail: `the room changed while you were writing: ${result.whatHappened} (room is now at seq ${result.roomSeq})`,
        };
      }
      return {
        op: "post",
        status: "applied",
        detail: `posted to ${channelLabel(resolved)} as @${agent.name} (#${result.message.seq})`,
      };
    }
    case "createChannel": {
      const memberIds = resolveMemberIds(action.members);
      // 创建者自动加入（人类路径由 createChannel 加 OWNER；成员路径由调用点加自己）。
      const created = createChannel({
        name: action.name,
        type: action.type,
        description: action.description,
        memberIds: [agent.id, ...memberIds.filter((id) => id !== agent.id)],
      });
      return {
        op: "createChannel",
        status: "applied",
        detail: `created channel #${created.name} (${created.type}) as @${agent.name}`,
      };
    }
    case "createAgent": {
      let provider = action.provider;
      let modelId = action.modelId;
      if (!provider || !modelId) {
        const fallback = (context.resolveDefaultModel ?? readDefaultModelFromSettings)();
        if (!fallback) {
          return {
            op: "createAgent",
            status: "error",
            detail:
              "no model configured: pass provider+modelId, or set a default model in the agent settings",
          };
        }
        provider = fallback.provider;
        modelId = fallback.modelId;
      }
      const created = createAgent({
        name: action.name,
        description: action.description,
        provider,
        modelId,
        thinkingLevel: action.thinkingLevel,
      });
      return {
        op: "createAgent",
        status: "applied",
        detail: `created agent @${created.name} (${provider}/${modelId}) as @${agent.name}`,
      };
    }
    case "search": {
      const hits = searchMessages(action.query, {
        limit: action.limit ?? undefined,
        memberId: agent.id,
      });
      return {
        op: "search",
        status: "applied",
        detail: `${hits.length} hit(s) for "${action.query}" (scoped to your channels)`,
        observation: formatSearchObservation(action.query, hits),
      };
    }
  }
}
