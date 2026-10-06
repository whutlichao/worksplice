/**
 * 成员能力表（ADR-0013 决策一 §1.3）：把「成员能做什么」从请求头自述搬到**结构身份**上——
 * 调用点（agent-loop 的一轮）天然知道它代表哪个成员，能否执行由本表按动作名裁决。
 *
 * 判据（ADR-0013 决策一原话）：**默认拒绝，逐条开口；开口的判据是「该动作不提升调用者的
 * 权限，只扩大协作面」**。
 * - 开口的八条（七条能力 + 协议既有 op）都不给调用者任何它本来没有的东西：读类只读它自己
 *   频道内的内容（search 的调用者作用域在 lib/domain/collab/search.ts 落地），写类要么以它
 *   自己的名义落库（react / pin / remind / post / reply），要么创建的新对象受**同一套**约束
 *   （createAgent 造出的新身份跟它一样：无凭证、路径守卫 + 沙箱同一套；createChannel 只多一个
 *   协作面）。成本面（建 agent 的开销）归 docs/cost-monitoring-baseline.md，与本层无关。
 * - 人类专属操作（归档 / 删除身份 / 三种 reset / 改 runtime / 改 workspace）一律不开：
 *   它们改变的是别人的身份与运行形态，不是扩大协作面。
 * - 不在任何一张表里的名字**默认拒绝**——不靠「恰好没写」这种脆弱形态（fail-closed，
 *   与 ADR-0011 决策六第三条、ADR-0012 决策五同构）。
 *
 * 术语：本模块是「成员面」（Member Face）的开口表；「人类面」（Human Face）走 HTTP 路由，
 * 进门恒 Owner（`CURRENT_MEMBER_ID`），本表对它只作人类专属操作的正向放行。
 */

import { OWNER_MEMBER_ID } from "../../data/schema.ts";

/** 成员经结构化回复协议可请求的动作名（op 名，见 lib/agent-loop/member-ops.ts 的协议）。 */
export type MemberOpName =
  | "reply" // 发消息（本轮 target）
  | "task" // 任务操作（claim / complete / unclaim）
  | "post" // 跨 target 指针消息
  | "react" // reaction toggle
  | "pin" // 个性化 pinned
  | "remind" // 设提醒
  | "createChannel" // 建频道
  | "createAgent" // 建 agent
  | "search"; // 全文搜索（调用者频道作用域）

export type MemberActorType = "human" | "agent";

export interface CapabilityVerdict {
  allowed: boolean;
  /** 允许/拒绝的理由：拒绝时给出边界（「报边界、不静默改写」，ADR-0011 D7 的意图）。 */
  reason: string;
}

/**
 * 逐条开口的清单（顺序即 prompt 里的教学顺序）。每一条的开口理由见文件头注释；
 * reply/task 是协议既有 op，列出是为了让「成员面词表」在一处完整（本票不改其行为）。
 */
export const MEMBER_OPEN_OPS: readonly MemberOpName[] = [
  "reply",
  "post",
  "react",
  "pin",
  "remind",
  "createChannel",
  "createAgent",
  "search",
  "task",
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
