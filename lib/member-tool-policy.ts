/**
 * 成员会话的**工具面策略**判定层（票 chief-tool-surface）。
 *
 * 分工照 `lib/pi-env-status.ts` 的同一套纪律：本模块不 import React、不 import Next、
 * 不碰 SDK、不碰数据库——身份结论经注入进来（`chiefScope`），判定是对一份结论的纯函数。
 * 谁是首席的唯一判据是 `isSecretaryMember` / `isChiefOfAnyChannel`（协作域，要读库），
 * 调用方（`lib/agent-runtime.ts`）算好再传进来；本模块**不重复**那套判定，否则「首席是谁」
 * 会出现第二个答案。
 *
 * ## 为什么全局首席要窄面
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
 * ## 全局首席的窄面（票 chief-tools / chief-task-create）
 *
 * `read` 之外再加六个 `worksplice_*` 领域工具（建频道 / 建 agent / 三个有界读面 / 建任务），
 * 它们的实现与注册在 `lib/chief-tools/`。清单留在本模块而不是工具模块，是因为它同时是
 * **激活面**与**注册面**的唯一来源：`lib/chief-tools/tools.ts` 注册的定义名必须与本清单
 * 逐字对齐（那边有运行期守卫 + 测试双向断言），否则会变成「注册了但永远不被激活」——
 * 给 agent 开系统操作的口子上，静默半开与静默全开同样不可接受。
 *
 * ## 第三批：再加一个写面（票 chief-task-create）
 *
 * `worksplice_task_create` —— 把一条既有消息转成任务。仍然从同一份清单来：加名字就是
 * 同时改注册面与激活面，不会出现「定义了但没激活」的半开状态。
 *
 * 仍然**不并回**扩展 / 包工具：领域能力只从这份白名单来，不从「装了什么都算」来。
 *
 * ## 频道首席：空策略，普通工具面不收窄（票 #272 / ADR-0020）
 *
 * 频道首席只补 `worksplice_task_create` 一个最小写面，不获得读面 / 管理员写面。但它和全局
 * 首席不同：它本来就是一个正常工作的成员，普通工具面（内置 + 扩展）不应因「当上频道首席」
 * 而收窄。因此 `chiefScope: "channel"` 返回 `{}`（不表态），`worksplice_task_create` 由
 * `domainTools.surface === "channel"` 以 `defaultActive: true` 补入——**不能**在这里写成
 * `toolNames: [...]`，那会把 bash / write / 扩展工具全部关掉。
 *
 * 身份变化后需要该 agent 的会话重启 / 重建才拿到新工具面；本模块不做动态热更新。
 *
 * ## 非首席：空对象，不是「默认值」
 *
 * 返回 `{}` 的含义是「调用方什么都不传」——不传 `toolNames`、不传 `includeExtensionTools`，
 * 于是 `startRpcSession` 走今天那条完全不变的路径（扩展工具照旧并回，人类 UI 的档位照旧生效）。
 * 这里刻意不写 `toolNames: undefined` 之类的显式键：空策略的契约就是「不表态」。
 */

/**
 * 首席会话的六个领域工具名（票 chief-tools / chief-task-create）：建频道 / 建 agent /
 * 把既有消息转任务 / 三个有界读面。
 * 注册侧（`lib/chief-tools/tools.ts`）从这份清单取齐定义名，不另抄一份。
 */
export const CHIEF_DOMAIN_TOOL_NAMES: readonly string[] = [
  "worksplice_list_channels",
  "worksplice_list_members",
  "worksplice_list_tasks",
  "worksplice_channel_create",
  "worksplice_agent_create",
  "worksplice_task_create",
];

/**
 * 频道首席的额外工具面（票 #272 / ADR-0020）：只此一个写面，**不含**三个读面与两个管理员
 * 写面。注册面（`lib/chief-tools/tools.ts` 的 channel surface）与激活面共用这一份清单。
 */
export const CHANNEL_CHIEF_TOOL_NAMES: readonly string[] = ["worksplice_task_create"];

/**
 * 全局首席会话可激活的工具面：`read` + 六个领域工具。`read` 的落点由 ADR-0011 的路径守卫收窄；
 * 六个领域工具的参数面与可见面由 `lib/chief-tools/` 的判定层收窄。
 */
export const CHIEF_TOOL_NAMES: readonly string[] = ["read", ...CHIEF_DOMAIN_TOOL_NAMES];

/** 首席作用域：全局首席 / 频道首席 / 不是首席。 */
export type ChiefToolSurface = "global" | "channel";
export type ChiefScope = ChiefToolSurface | "none";

/** 判定输入：调用方注入的身份结论（全局 / 频道 / 无）。 */
export interface MemberToolPolicyInput {
  /**
   * 该成员**当前**的首席作用域：全局优先（`isSecretaryMember`），否则看是否有频道首席身份
   * （`isChiefOfAnyChannel`）；两者都不是 = `"none"`。判定来源唯一，见模块头注释。
   */
  chiefScope: ChiefScope;
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

/**
 * 对一份身份结论求策略：
 * - `global` → 窄面（`read` + 六个领域工具，不并回扩展工具）；
 * - `channel` → 空策略（保留普通工具面；额外工具走 domainTools 的 channel surface）；
 * - `none` → 空策略（与今天逐字节相同）。
 */
export function resolveMemberToolPolicy(input: MemberToolPolicyInput): MemberToolPolicy {
  if (input.chiefScope !== "global") return {};
  // 每次都新建数组：策略是产物不是共享状态，调用方 mutate 不到第二次调用的结果。
  return { toolNames: [...CHIEF_TOOL_NAMES], includeExtensionTools: false };
}
