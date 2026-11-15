import { previewLine } from "../preview.ts";

/**
 * 首席领域工具的**判定层**（票 chief-tools）：参数校验、配额、可见面、读面摘要与事件文案。
 * 纯函数 + 零领域依赖（只引入 `lib/preview.ts` 这一个纯工具模块）——所以每条规则都能用一次
 * 调用取证，不需要 SDK、不需要数据库，也不需要起会话。
 *
 * 分工照 `lib/tool-path-guard.ts` / `lib/pi-env-status.ts` 的同一套纪律：判定在纯函数里，
 * 副作用（读库、建频道、建 agent、投事件消息）留在 `lib/chief-tools/tools.ts` 的薄壳里。
 * 薄壳只做三件事：判 actor 是否仍是全局首席（唯一判据 `isSecretaryMember`）、把参数交给这里、
 * 把通过的值交给领域服务。
 *
 * ## 为什么「不静默」是硬要求
 *
 * 这是本仓第一次给 agent 系统操作能力。凡是写「必须报错」的地方都**不许**降级成静默忽略、
 * 默认值兜底或只记日志：参数越界要报出字段与允许面（`limit must be an integer between 1 and 50`），
 * 多余字段要报错（`agent_create` 不接受 `provider` / `modelId` / `thinkingLevel`），
 * 枚举外的值要列出五态。模型据此就能改一次重试，而不是拿到一个悄悄变了语义的成功。
 *
 * ## null 不是「没传」
 *
 * 只有 `undefined` 算「没传」。`null` 一律按类型错误拒绝：pi 对**真实工具调用**的可选字段
 * 会把 `null` 强制转换成「省略」(`validateToolArguments` → pi-schema 的 `parse`)，所以生产路径
 * 上这里根本见不到 `null`；见到就说明调用方绕过了那层，此时报错比替它猜一个默认值安全。
 *
 * ## 英文硬编码
 *
 * 这些字符串会进**模型上下文**（工具结果与工具描述），按 `docs/i18n.md` 的分层规则一律英文，
 * 不做服务端 locale 感知（`docs/engineering-standards.md` §1）。
 */

/** 首席复判失败的唯一文案（票据逐字要求）。薄壳在每次工具调用**重新**判定 actor 后返回它。 */
export const CHIEF_ONLY_ERROR = "Only the global chief may use this tool";

/** `worksplice_list_channels` 的默认条数与上限（bounded read：不给全量清单）。 */
export const DEFAULT_LIST_CHANNELS_LIMIT = 20;
export const MAX_LIST_CHANNELS_LIMIT = 50;

/** 任务摘要里 preview 的上限（字符）。 */
export const TASK_PREVIEW_MAX_LENGTH = 120;

/** 任务五态（与 `lib/data/types.ts` 的 `TaskStatus` 同值；判定层不引数据层，故就地声明）。 */
export type TaskStatus = "todo" | "in_progress" | "in_review" | "done" | "closed";
export const TASK_STATUSES: readonly TaskStatus[] = ["todo", "in_progress", "in_review", "done", "closed"];

/**
 * `worksplice_agent_create` 的名字形状：`ops-` 前缀 + 小写字母 / 数字 / 连字符，总长 ≤ 32。
 * 让「首席自建的身份」与人类命名的成员在名字上一眼可分（名字同时是 mention 句柄）。
 */
export const AGENT_NAME_PATTERN = /^ops-[a-z0-9][a-z0-9-]{1,27}$/;

/** 配额耗尽的文案（票据逐字要求）。 */
export const AGENT_CREATE_QUOTA_ERROR =
  "agent_create is limited to one new agent per session; ask a human for more";

/** 判定结果：拒绝时带**可直接回给模型**的英文原因。 */
export type Decision<T> = { ok: true; value: T } | { ok: false; error: string };

function accept<T>(value: T): Decision<T> {
  return { ok: true, value };
}

function reject<T>(error: string): Decision<T> {
  return { ok: false, error };
}

/** 参数值的可读描述：报告里点名「收到了什么」（对象/数组也照原样）。 */
function describeValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function asObject(input: unknown): Record<string, unknown> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}

/**
 * 多余字段的拒绝：`agent_create` 的 `provider` / `thinkingLevel` 之类必须报错，不能忽略。
 * 返回第一条多余字段的完整错误（一次报一个，模型改掉就能过；一次报全反而更啰嗦）。
 */
function unknownParameter(input: Record<string, unknown>, allowed: readonly string[]): string | null {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      return `unknown parameter "${key}"; allowed parameters: ${allowed.join(", ")}`;
    }
  }
  return null;
}

function readOptionalString(
  input: Record<string, unknown>,
  field: string,
): Decision<string | null> {
  const value = input[field];
  if (value === undefined) return accept(null);
  if (typeof value !== "string" || value.trim() === "") {
    return reject(`${field} must be a non-empty string (received ${describeValue(value)})`);
  }
  return accept(value);
}

/** 一次性把「不是对象」与「多余字段」两条前置拒绝收口，免得每个工具各写一遍。 */
function readParameters(
  input: unknown,
  allowed: readonly string[],
): Decision<Record<string, unknown>> {
  const object = asObject(input);
  if (!object) return reject(`parameters must be a JSON object (received ${describeValue(input)})`);
  const unknown = unknownParameter(object, allowed);
  if (unknown) return reject(unknown);
  return accept(object);
}

// ---------------------------------------------------------------------------
// 读面 1：worksplice_list_channels —— { limit?: number }
// ---------------------------------------------------------------------------

export function decideListChannelsInput(input: unknown): Decision<{ limit: number }> {
  const params = readParameters(input, ["limit"]);
  if (!params.ok) return params;

  const limit = params.value.limit;
  if (limit === undefined) return accept({ limit: DEFAULT_LIST_CHANNELS_LIMIT });
  if (
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_LIST_CHANNELS_LIMIT
  ) {
    return reject(
      `limit must be an integer between 1 and ${MAX_LIST_CHANNELS_LIMIT} (received ${describeValue(limit)})`,
    );
  }
  return accept({ limit });
}

/** 可见面判定：公开频道人人可见；私有 / DM 频道只对成员可见（§3.2）。 */
export function isChannelVisibleToActor(channel: { type: string }, isMember: boolean): boolean {
  return channel.type === "public" || isMember;
}

/** 频道摘要：只带约定五字段，不给描述与绑定细节。 */
export interface ChannelSummary {
  id: string;
  name: string;
  type: string;
  archived: boolean;
  memberCount: number;
}

export function channelSummary(
  channel: { id: string; name: string; type: string; archived: number },
  memberCount: number,
): ChannelSummary {
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    archived: channel.archived === 1,
    memberCount,
  };
}

// ---------------------------------------------------------------------------
// 读面 2：worksplice_list_members —— { channelId?: string }
// ---------------------------------------------------------------------------

export function decideListMembersInput(input: unknown): Decision<{ channelId: string | null }> {
  const params = readParameters(input, ["channelId"]);
  if (!params.ok) return params;

  const channelId = readOptionalString(params.value, "channelId");
  if (!channelId.ok) return channelId;
  return accept({ channelId: channelId.value });
}

/** 成员摘要：只带约定四字段（不给描述、workspace、模型覆盖）。 */
export interface MemberSummary {
  id: string;
  name: string;
  type: string;
  status: string;
}

export function memberSummary(member: {
  id: string;
  name: string;
  type: string;
  status: string;
}): MemberSummary {
  return { id: member.id, name: member.name, type: member.type, status: member.status };
}

// ---------------------------------------------------------------------------
// 读面 3：worksplice_list_tasks —— { channelId: string, status?: 五态 }
// ---------------------------------------------------------------------------

export function decideListTasksInput(
  input: unknown,
): Decision<{ channelId: string; status: TaskStatus | null }> {
  const params = readParameters(input, ["channelId", "status"]);
  if (!params.ok) return params;

  const channelId = readOptionalString(params.value, "channelId");
  if (!channelId.ok) return channelId;
  if (channelId.value === null) return reject("channelId is required");

  const status = params.value.status;
  if (status === undefined) return accept({ channelId: channelId.value, status: null });
  if (typeof status !== "string" || !TASK_STATUSES.includes(status as TaskStatus)) {
    return reject(
      `status must be one of: ${TASK_STATUSES.join(", ")} (received ${describeValue(status)})`,
    );
  }
  return accept({ channelId: channelId.value, status: status as TaskStatus });
}

/** 任务摘要：只带四字段，preview 截断到 120 字符（全文留在频道/线程里）。 */
export interface TaskSummary {
  number: number;
  status: string;
  ownerName: string | null;
  preview: string;
}

export function taskSummary(task: {
  number: number;
  status: string;
  owner: { name: string } | null;
  anchor: { content: string };
}): TaskSummary {
  return {
    number: task.number,
    status: task.status,
    ownerName: task.owner?.name ?? null,
    preview: previewLine(task.anchor.content, TASK_PREVIEW_MAX_LENGTH),
  };
}

// ---------------------------------------------------------------------------
// 写面 1：worksplice_channel_create —— { name, type?, description?, memberIds? }
// ---------------------------------------------------------------------------

export interface ChannelCreateIntent {
  /** 原样交给 `createChannel`：trim / 非空 / ≤32 的规则由它自己抛，本层不重写一套。 */
  name: string;
  type: "public" | "private";
  description: string | null;
  memberIds: string[];
}

/**
 * 写面参数判定。`actorId` 参与判定只有一处：私有频道必须把 actor 放进 `memberIds`。
 * `createChannel` 只自动加 Owner 与**公开频道**的全局首席，所以「首席建了一个自己不在里面
 * 的私有频道」在服务层是可成立的——这里把它堵在写之前，而不是建完再补救。
 */
export function decideChannelCreateInput(input: unknown, actorId: string): Decision<ChannelCreateIntent> {
  const params = readParameters(input, ["name", "type", "description", "memberIds"]);
  if (!params.ok) return params;

  const name = params.value.name;
  if (typeof name !== "string") {
    return reject(`name must be a string (received ${describeValue(name)})`);
  }

  const rawType = params.value.type;
  // `null` 不算「没传」（见模块头注释）：只有 undefined 取默认值。
  const type = rawType === undefined ? "public" : rawType;
  if (type !== "public" && type !== "private") {
    return reject(`type must be "public" or "private" (received ${describeValue(params.value.type)})`);
  }

  const description = params.value.description;
  if (description !== undefined && typeof description !== "string") {
    return reject(`description must be a string (received ${describeValue(description)})`);
  }

  const memberIds = readMemberIds(params.value.memberIds);
  if (!memberIds.ok) return memberIds;

  if (type === "private" && !memberIds.value.includes(actorId)) {
    return reject(
      "a private channel must include the actor in memberIds: the global chief can only create " +
        "channels it belongs to",
    );
  }

  return accept({
    name,
    type,
    description: typeof description === "string" ? description.trim() : null,
    memberIds: memberIds.value,
  });
}

/** `memberIds`：字符串数组 → 去重保序（`addChannelMember` 本身幂等，重复项只是白跑一遍）。 */
function readMemberIds(value: unknown): Decision<string[]> {
  if (value === undefined) return accept([]);
  if (!Array.isArray(value)) {
    return reject(`memberIds must be an array of member id strings (received ${describeValue(value)})`);
  }
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim() === "") {
      return reject(`memberIds must be an array of member id strings (received ${describeValue(entry)})`);
    }
    if (!ids.includes(entry)) ids.push(entry);
  }
  return accept(ids);
}

// ---------------------------------------------------------------------------
// 写面 2：worksplice_agent_create —— *只有* { name, description?, channelId? }
// ---------------------------------------------------------------------------

export interface AgentCreateIntent {
  name: string;
  description: string | null;
  /** null = 工具层落 `#all`（缺省目标），不是静默改投——channelId 给了就必须可达。 */
  channelId: string | null;
}

/**
 * 写面参数判定。`provider` / `modelId` / `thinkingLevel` **不接受**：新身份一律继承全局默认
 * （服务层显式传 `null`）。出现多余字段按参数校验失败报错，不静默忽略——否则「首席悄悄把
 * 新成员指到别的模型/服务商」会变成一次无人察觉的写操作。
 */
export function decideAgentCreateInput(input: unknown): Decision<AgentCreateIntent> {
  const params = readParameters(input, ["name", "description", "channelId"]);
  if (!params.ok) return params;

  const name = params.value.name;
  if (typeof name !== "string" || !AGENT_NAME_PATTERN.test(name)) {
    return reject(
      'agent name must match /^ops-[a-z0-9][a-z0-9-]{1,27}$/ — start with "ops-", then 1-28 ' +
        `lowercase letters, digits or hyphens (32 characters at most) (received ${describeValue(name)})`,
    );
  }

  const description = params.value.description;
  if (description !== undefined && typeof description !== "string") {
    return reject(`description must be a string (received ${describeValue(description)})`);
  }

  const channelId = readOptionalString(params.value, "channelId");
  if (!channelId.ok) return channelId;

  return accept({
    name,
    description: typeof description === "string" ? description.trim() : null,
    channelId: channelId.value,
  });
}

// ---------------------------------------------------------------------------
// 配额：每个会话至多 1 次成功创建
// ---------------------------------------------------------------------------

/** 一次会话工作窗口内「建 agent」的成功次数配额（实现是薄闭包，测试可直接数）。 */
export interface AgentCreateQuota {
  /** 已经用掉了（第 2 次调用直接拒绝）。 */
  isExhausted(): boolean;
  /** 只在**成功**创建之后调用；失败不消耗配额。 */
  recordSuccess(): void;
}

/** 每个常量只此一处，配额上限不可注入（避免「调大上限」成为一条绕过路径）。 */
const AGENT_CREATE_LIMIT = 1;

/**
 * 新配额实例。挂在**该会话的扩展工厂实例**上（工厂每次 `startSession` 执行一次），
 * 所以它就是「一次连续工作窗口」的天然边界：会话重载 / 重启 = 新窗口 = 新配额。
 */
export function createAgentCreateQuota(): AgentCreateQuota {
  let created = 0;
  return {
    isExhausted: () => created >= AGENT_CREATE_LIMIT,
    recordSuccess: () => {
      created += 1;
    },
  };
}

// ---------------------------------------------------------------------------
// 系统事件文案（写操作留痕，英文，紧跟既有事件消息的写法）
// ---------------------------------------------------------------------------

export function channelCreateEventContent(actorName: string, channelName: string): string {
  return `${actorName} created channel #${channelName}`;
}

export function agentCreateEventContent(actorName: string, agentName: string): string {
  return `${actorName} created agent @${agentName}`;
}
