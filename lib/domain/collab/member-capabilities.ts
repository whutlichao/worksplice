/**
 * 成员能力表（ADR-0013 决策一 §1.3）：把「成员能做什么」从请求头自述搬到**结构身份**上——
 * 调用点（agent-loop 的一轮）天然知道它代表哪个成员，能否执行由本表按动作名裁决。
 *
 * 判据（ADR-0013 决策一原话）：**默认拒绝，逐条开口；开口的判据是「该动作不提升调用者的
 * 权限，只扩大协作面」**。
 * 开口的九项（`OPS_ARRAY_NAMES` 的七条 op + 协议既有的 `reply`/`task`）都不给调用者任何它本来
 * 没有的东西：读类只读它自己频道内的内容（频道列表注入也只给公开频道与它已加入的；search 的调用者
 * 作用域在 lib/domain/collab/search.ts 落地），写类要么以它自己的名义落库（react / pin /
 * remind / post / reply），要么创建的新对象受**同一套**约束（createAgent 造出的新身份跟它一样：
 * 无凭证、路径守卫 + 沙箱同一套；createChannel 只多一个协作面）。成本面（建 agent 的开销）
 * 归 docs/cost-monitoring-baseline.md，与本层无关。
 * - 人类专属操作（归档 / 删除身份 / 三种 reset / 改 runtime / 改 workspace）一律不开：
 *   它们改变的是别人的身份与运行形态，不是扩大协作面。
 * - 不在任何一张表里的名字**默认拒绝**——不靠「恰好没写」这种脆弱形态（fail-closed，
 *   与 ADR-0011 决策六第三条、ADR-0012 决策五同构）。
 *
 * 术语：本模块是「成员面」（Member Face）的开口表；「人类面」（Human Face）走 HTTP 路由，
 * 进门恒 Owner（`CURRENT_MEMBER_ID`），本表对它只作人类专属操作的正向放行。
 */

import { OWNER_MEMBER_ID } from "../../data/schema.ts";
import type { MemberRow } from "../../data/types.ts";

/**
 * `ops` 数组词表（协议层，见 lib/agent-loop/member-ops.ts）：开口表从它派生，两边不会漂移。
 */
export const OPS_ARRAY_NAMES = [
  "post", // 跨 target 指针消息
  "react", // reaction toggle
  "pin", // 个性化 pinned
  "remind", // 设提醒
  "createChannel", // 建频道
  "createAgent", // 建 agent
  "search", // 全文搜索（调用者频道作用域）
] as const;

export type OpsArrayName = (typeof OPS_ARRAY_NAMES)[number];

/** 协议自己的字段（**不是** `ops` 数组条目）：`reply` = action，`task` = 任务操作。 */
export const PROTOCOL_FIELD_NAMES = ["reply", "task"] as const;

export type ProtocolFieldName = (typeof PROTOCOL_FIELD_NAMES)[number];

/** 成员经结构化回复协议可请求的全部动作名 = ops 数组词表 + 协议字段。 */
export type MemberOpName = OpsArrayName | ProtocolFieldName;

export type MemberActorType = "human" | "agent";

export interface CapabilityVerdict {
  allowed: boolean;
  /** 允许/拒绝的理由：拒绝时给出边界（「报边界、不静默改写」，ADR-0011 D7 的意图）。 */
  reason: string;
}

/**
 * 逐条开口的清单 = `ops` 数组词表 + 协议字段（从两处唯一来源拼出，不再手抄——
 * 新增 op 时只需改 `OPS_ARRAY_NAMES`，这张表与协议里的 switch 都会在编译期报错直到同步）。
 * 注：七条能力里落在 op 面的只有六条（发消息 = reply、跨 target = post、建频道 / 建 agent /
 * 搜索 / 设提醒），另两条（频道列表 / 成员列表）走每轮语境注入，不占 op。
 * 每条的开口理由见文件头注释；reply/task 列为开口是为了让「成员面词表」在一处完整。
 */
export const MEMBER_OPEN_OPS: readonly MemberOpName[] = [
  ...OPS_ARRAY_NAMES,
  ...PROTOCOL_FIELD_NAMES,
];

/**
 * 人类专属操作（ADR-0013 §1.3 明列）：归档 / 删除身份 / 三种 reset / 改 runtime / 改 workspace。
 * 这些名字**不在**协议词表里——它们是「成员试图请求时应当被拒」的边界标记；
 * 单独列成常量是为了让边界可枚举、可断言（默认拒绝之外显式开口的反面）。
 */
export const HUMAN_ONLY_OPERATIONS = [
  "archiveChannel",
  "unarchiveChannel",
  "deleteIdentity",
  "restart",
  "sessionReset",
  "fullReset",
  "setRuntime",
  "setWorkspace",
] as const;

export type HumanOnlyOperation = (typeof HUMAN_ONLY_OPERATIONS)[number];

const MEMBER_OPEN_SET: ReadonlySet<string> = new Set(MEMBER_OPEN_OPS);
const HUMAN_ONLY_SET: ReadonlySet<string> = new Set(HUMAN_ONLY_OPERATIONS);

export class MemberOperationDeniedError extends Error {
  readonly operation: string;

  constructor(operation: string, reason: string) {
    super(`Member operation "${operation}" is not allowed: ${reason}`);
    this.name = "MemberOperationDeniedError";
    this.operation = operation;
  }
}

/**
 * 裁决一个动作名对某类调用者是否开口。默认拒绝（未知名字对两类调用者都拒绝）；
 * 成员开口清单对全部成员同等开放（不做秘书豁免）；人类专属操作只对人类放行。
 */
export function canMemberPerform(
  operation: string,
  actorType: MemberActorType = "agent",
): CapabilityVerdict {
  if (MEMBER_OPEN_SET.has(operation)) {
    return {
      allowed: true,
      reason: `"${operation}" is member-open: it does not elevate the caller's authority, it only widens collaboration`,
    };
  }
  if (HUMAN_ONLY_SET.has(operation)) {
    if (actorType === "human") {
      return {
        allowed: true,
        reason: `"${operation}" is a human-only operation; the Owner performs it in the UI`,
      };
    }
    return {
      allowed: false,
      reason: `"${operation}" is a human-only operation (archive / delete identity / reset / runtime / workspace) — members cannot perform it`,
    };
  }
  return {
    allowed: false,
    reason: `"${operation}" is not in the member capability table — default deny`,
  };
}

/**
 * 断言形态：成员面 op 执行器与人类专属服务函数共用同一个裁决。
 * - `assertMemberMayPerform(op)`（默认 actor="agent"）：成员面用（执行器也可直查 `canMemberPerform`）；
 * - `assertActorMayPerform(op, actorId)`：服务层用——调用者 id 已知，人类 Owner 恒为 `OWNER_MEMBER_ID`，
 *   其余 id 一律按成员判（本地单机形态下人类只有 Owner 一个，见 §3.6）。
 */
export function assertMemberMayPerform(
  operation: string,
  actorType: MemberActorType = "agent",
): void {
  const verdict = canMemberPerform(operation, actorType);
  if (!verdict.allowed) {
    throw new MemberOperationDeniedError(operation, verdict.reason);
  }
}

/** 服务层入口：按调用者 id 裁决（`OWNER_MEMBER_ID` = human，其余 = agent）。 */
export function assertActorMayPerform(operation: string, actorId: string): void {
  assertMemberMayPerform(operation, actorId === OWNER_MEMBER_ID ? "human" : "agent");
}

// ---------------------------------------------------------------------------
// 约束面（票 chief-capability-converge）：`canMemberPerform` 回答「能不能」，
// 这里回答「以什么形状能」——两条执行路径（ops 面 / 首席 tools 面）共用同一份。
//
// 为什么上移：仓里本来有两条路径能做同一件事（`{"ops":[...]}` 与首席领域工具），
// 而它们的约束是**各自硬编码**的——于是被约束的角色（首席）反而比任何其它 agent 更受限，
// 同样的事换个写法就绕过去了。约束面把不矛盾的规矩收到一处：名字形状、每会话配额、
// 模型选择不接受、私有频道的创建者可见性、`memberIds` 只收存活 agent。
// 开口集合（谁能做）**不变**——本表只补充「以什么形状做」。
//
// 只覆盖两条会「造出东西」的 op：其余五条（post / react / pin / remind / search）没有可
// 争论的形状规则，本层不给它们凭空造一条。
// ---------------------------------------------------------------------------

/**
 * `createAgent` 允许的名字形状：`ops-` 前缀 + 小写字母 / 数字 / 连字符，总长 ≤ 32。
 * 让「系统自建的身份」与人类命名的成员在名字上一眼可分（名字同时是 mention 句柄）。
 */
export const MEMBER_AGENT_NAME_PATTERN = /^ops-[a-z0-9][a-z0-9-]{1,27}$/;

/** 同一 agent 的**同一会话**内 `createAgent` 的成功次数上限（失败不消耗，装在配额 store 里）。 */
export const MEMBER_AGENT_CREATE_LIMIT = 1;

/** `createAgent` **不接受**的字段：新身份一律继承全局默认模型（不接受按次指定）。 */
export const MEMBER_AGENT_MODEL_FIELDS = ["provider", "modelId", "thinkingLevel"] as const;

/**
 * 配额用尽的拒绝文案（两条路径共用同一句）。字面值保持与既有首席工具一致——那条文案是
 * 模型读到的契约，换写法只会让同一个事实在两条路径上说两遍不同的话。
 */
export const MEMBER_AGENT_CREATE_QUOTA_REJECTION =
  "agent_create is limited to one new agent per session; ask a human for more";

/** `createAgent` 的执行约束。 */
export interface AgentCreateConstraint {
  op: "createAgent";
  namePattern: RegExp;
  perSessionLimit: number;
  rejectedFields: readonly string[];
}

/** `createChannel` 的执行约束。 */
export interface ChannelCreateConstraint {
  op: "createChannel";
  privateRequiresActor: boolean;
  /** `memberIds` 的准入面：只收存活 agent（软删 / 人类 / 不存在一律拒绝）。 */
  memberIds: "live-agent";
}

export type MemberOpConstraint = AgentCreateConstraint | ChannelCreateConstraint;

const CREATE_AGENT_CONSTRAINT: AgentCreateConstraint = Object.freeze({
  op: "createAgent",
  namePattern: MEMBER_AGENT_NAME_PATTERN,
  perSessionLimit: MEMBER_AGENT_CREATE_LIMIT,
  rejectedFields: MEMBER_AGENT_MODEL_FIELDS,
});

const CREATE_CHANNEL_CONSTRAINT: ChannelCreateConstraint = Object.freeze({
  op: "createChannel",
  privateRequiresActor: true,
  memberIds: "live-agent",
});

/**
 * 按动作名取执行约束：**单一来源**。返回 `null` = 该动作没有形状约束（不是「不允许」——
 * 那由 `canMemberPerform` 回答）。批量与单条执行器都从这里取值，不再各写一份。
 */
export function memberOpConstraint(operation: string): MemberOpConstraint | null {
  if (operation === "createAgent") return CREATE_AGENT_CONSTRAINT;
  if (operation === "createChannel") return CREATE_CHANNEL_CONSTRAINT;
  return null;
}

/** 值的可读描述：拒绝时要点名「收到了什么」（对象 / 数组也照原样）。 */
function describeValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * 名字形状判据 → 拒绝理由（`null` = 通过）。
 *
 * 文案在这里只写一份：两条路径拒绝时给模型看到的是**同一句话**（改规则时不可能只改一边）。
 */
export function agentNameRejection(name: unknown): string | null {
  const constraint = memberOpConstraint("createAgent") as AgentCreateConstraint;
  if (typeof name === "string" && constraint.namePattern.test(name)) return null;
  return (
    `agent name must match /${constraint.namePattern.source}/ — start with "ops-", then 1-28 ` +
    `lowercase letters, digits or hyphens (32 characters at most) (received ${describeValue(name)})`
  );
}

/**
 * 模型选择判据：`provider` / `modelId` / `thinkingLevel` 任一**出现**即拒绝（`null`/`undefined`
 * 视为没出现）——新身份继承全局默认，不允许按次指定服务商 / 模型。
 */
export function modelSelectionRejection(fields: Record<string, unknown>): string | null {
  const constraint = memberOpConstraint("createAgent") as AgentCreateConstraint;
  const given = constraint.rejectedFields.filter(
    (field) => fields[field] !== undefined && fields[field] !== null,
  );
  if (given.length === 0) return null;
  return (
    `createAgent does not accept ${given.join(", ")} — a new identity inherits the global default ` +
    `model; retry with "name" only`
  );
}

/**
 * 私有频道的创建者可见性判据：私有频道必须把 actor 放进 `memberIds`。
 *
 * 判据对**声明值**生效（不是执行器自动补完之后的值）：「创建者自动加入」是公开频道的既有语义，
 * 私有频道不能靠它变成立——否则「首席建了一个自己不在里面的私有房间」换个写法又成立了。
 */
export function privateChannelActorRejection(input: {
  type: string;
  memberIds: readonly string[];
  actorId: string;
}): string | null {
  const constraint = memberOpConstraint("createChannel") as ChannelCreateConstraint;
  if (!constraint.privateRequiresActor || input.type !== "private") return null;
  if (input.memberIds.includes(input.actorId)) return null;
  return (
    "a private channel must include its creator (the actor) in memberIds — a private channel is " +
    "visible only to its members, so the creator must be one of them"
  );
}

/**
 * `memberIds` 的准入判据：只允许**存活的 agent 成员**。
 *
 * 「`createChannel` 的 `assertMember` 会拦」这句话不成立：`assertMember` 只查「这一行在不在」
 * （`getDb().getMember` 连软删行一起返回，也不看 `type`），所以软删身份和人类 id 都能被塞进
 * 新频道。软删身份重新出现在频道里违反 §3.6「删除即移出全部 channel」；人类 id 该走
 * 「Owner 自动加入」那条既有语义，不该由调用方决定。
 */
export function memberIdRejection(
  member: Pick<MemberRow, "type" | "deleted"> | null | undefined,
  memberId: string,
): string | null {
  if (!member) return `member not found: ${memberId}`;
  if (member.deleted === 1) return `member ${memberId} is deleted; memberIds accept live agent ids only`;
  if (member.type !== "agent") {
    return `member ${memberId} is not an agent; memberIds accept live agent ids only`;
  }
  return null;
}
