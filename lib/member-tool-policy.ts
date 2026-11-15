/**
 * 成员会话的**工具面策略**判定层（票 chief-tool-surface）。
 *
 * 分工照 `lib/pi-env-status.ts` 的同一套纪律：本模块不 import React、不 import Next、
 * 不碰 SDK、不碰数据库——身份结论经注入进来（`isChief`），判定是对一份结论的纯函数。
 * 谁是首席的唯一判据是 `isSecretaryMember`（`lib/domain/collab/secretary-identity.ts`，
 * 它要读库），调用方（`lib/agent-runtime.ts`）算好再传进来；本模块**不重复**那套判定，
 * 否则「首席是谁」会出现第二个答案。
 *
 * ## 为什么首席要窄面
 *
 * 首席会收到下沉的 handoff 任务并被唤醒干活，它的会话是**长期在线、可被他人消息驱动**的
 * 那一个。给它 `bash` / `write` / 扩展工具，等于把「别人的消息」接到一条具备任意执行与
 * 网络能力的链路上。本票只做收窄：留 `read`（落点仍受 ADR-0011 路径守卫限制在该成员自己的
 * 家目录与绑定目录内），其余内置工具与全部扩展 / 包工具一律不激活。
 *
 * ## 窄面不是「全部关闭」
 *
 * `toolNames: []` 在本仓有**另一套**语义：关掉全部工具，并让 caller / session 强制空
 * system prompt（`lib/rpc/forced-empty-system-prompt.ts`）。本模块**绝不允许**产出 `[]`：
 * 首席要能读自己家目录里的 MEMORY.md 与任务上下文，产 `[]` 会连这一点也关掉，还会顺带
 * 触发那条空 prompt 路径。窄面 = 一个非空的具体清单。
 *
 * ## 非首席：空对象，不是「默认值」
 *
 * 返回 `{}` 的含义是「调用方什么都不传」——不传 `toolNames`、不传 `includeExtensionTools`，
 * 于是 `startRpcSession` 走今天那条完全不变的路径（扩展工具照旧并回，人类 UI 的档位照旧生效）。
 * 这里刻意不写 `toolNames: undefined` 之类的显式键：空策略的契约就是「不表态」。
 */

/** 全局首席会话可激活的工具面：只有读。落点由 ADR-0011 的路径守卫收窄。 */
export const CHIEF_TOOL_NAMES: readonly string[] = ["read"];

/** 判定输入：调用方注入的身份结论（`isSecretaryMember(member)`）。 */
export interface MemberToolPolicyInput {
  /** 该成员是否**当前**全局首席（= 秘书）。判定来源唯一，见模块头注释。 */
  isChief: boolean;
}

/**
 * 策略产物：结构上与 `RpcSessionStartOptions` 的两个字段同形，但不 import 它
 * （那个模块拖 SDK）。字段缺省 = 不表态 = 沿用今天的默认行为。
 */
export interface MemberToolPolicy {
  /** 期望激活的工具名；缺省 = 不指定（caller 不设活动工具面）。 */
  toolNames?: string[];
  /** 是否把扩展 / 包工具并回活动面；缺省 = 是（`withExtensionTools` 的默认语义）。 */
  includeExtensionTools?: boolean;
}

/** 对一份身份结论求策略：首席 → 窄面；其余 → 空策略（与今天逐字节相同）。 */
export function resolveMemberToolPolicy(input: MemberToolPolicyInput): MemberToolPolicy {
  if (!input.isChief) return {};
  // 每次都新建数组：策略是产物不是共享状态，调用方 mutate 不到第二次调用的结果。
  return { toolNames: [...CHIEF_TOOL_NAMES], includeExtensionTools: false };
}
