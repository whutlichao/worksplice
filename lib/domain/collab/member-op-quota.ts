/**
 * `createAgent` 的**配额 store**（票 chief-capability-converge）：与
 * `lib/domain/collab/room-budget.ts` 同一套形态（单一实例挂 `globalThis`、可注入、测试可替换），
 * 因为同一个纪律在两条执行路径上都适用——
 *
 * - ops 面（`lib/agent-loop/member-ops.ts`，任何 agent 的 `{"ops":[{"op":"createAgent"}]}`）
 * - 首席 tools 面（`lib/chief-tools/` 的 `worksplice_agent_create`）
 *
 * 本票之前配额只装在首席 tools 的**工厂闭包**上（`lib/chief-tools/decisions.ts` 的
 * `createAgentCreateQuota`），所以同一件事换个写法就没有配额。现在两条路径都过这一个实例，
 * 「同一 agent 的同一会话内成功至多 1 次」才真的成立。
 *
 * ## 口径
 *
 * - **只有成功消耗配额**：`recordSuccess` 由执行器在写操作成功之后调用；参数不合规、名字冲突、
 *   配额已满、越权——都不消耗（否则一次失败的重试就白花掉了这一次机会）。
 * - **会话标识**：`agentId + sessionKey` 才是配额键。会话换了（session reset / restart 后的新
 *   session 文件）就是新窗口，这与「每个会话一份配额」的既有语义一致。
 * - **fail-closed**：`sessionKey` 缺失（拿不到标识）时**退化为**「该 agent 在本进程内至多 1 次」，
 *   并在日志里说明退化原因——绝不退化成「拿不到标识就跳过配额」，那会把 fail-closed 的约束
 *   变成一条绕过路径。
 *
 * ## 为什么上限不可注入
 *
 * 上限的唯一来源是 `MEMBER_AGENT_CREATE_LIMIT`（能力表）。这里刻意**不接受** `limit` 参数：
 * 一旦可注入，「把上限调大」就成了第二条绕过路径，而它不是业务能力，是安全边界。
 */

import { MEMBER_AGENT_CREATE_LIMIT } from "./member-capabilities.ts";

export interface MemberOpQuotaStore {
  /** 该 agent 的该会话是否已用尽 `createAgent` 配额（只读，不产生副作用）。 */
  isExhausted(agentId: string, sessionKey: string | null): boolean;
  /** 只在**成功创建之后**调用；失败不消耗配额。 */
  recordSuccess(agentId: string, sessionKey: string | null): void;
  /** 已成功次数（观测 / 测试用；退化时读的是退化键）。 */
  used(agentId: string, sessionKey: string | null): number;
  /** 清空全部计数（测试隔离 / 运维重开窗口）。 */
  reset(): void;
}

export interface MemberOpQuotaOptions {
  /** 退化告警的落点（测试注入以断言「日志里说明了原因」）。 */
  warn?: (message: string) => void;
}

/** 退化键的后缀：不是会话，是「该 agent 在本进程内的唯一窗口」。 */
const DEGRADED_SCOPE = "process";

function quotaKey(agentId: string, sessionKey: string | null): string {
  // 空字符串也算「拿不到标识」：身份不明时不假装知道是哪个会话。
  const scope = sessionKey ? `session:${sessionKey}` : DEGRADED_SCOPE;
  return `${agentId}|${scope}`;
}

export function createMemberOpQuotaStore(
  options: MemberOpQuotaOptions = {},
): MemberOpQuotaStore {
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const counts = new Map<string, number>();
  /** 已告警过的 agent：退化说明只报一次（每轮都刷屏的日志等于没有日志）。 */
  const degradedWarned = new Set<string>();

  const used = (agentId: string, sessionKey: string | null): number =>
    counts.get(quotaKey(agentId, sessionKey)) ?? 0;

  /** 退化路径的说明：既要点名「为什么」，也要点明退化成的是什么口径。 */
  const noteDegraded = (agentId: string): void => {
    if (degradedWarned.has(agentId)) return;
    degradedWarned.add(agentId);
    warn(
      `[member-op-quota] no session key for agent ${agentId}: createAgent quota degrades to ` +
        `"at most ${MEMBER_AGENT_CREATE_LIMIT} success per agent per process" — session-scoped ` +
        `accounting needs the session id at the call site`,
    );
  };

  return {
    isExhausted(agentId, sessionKey) {
      if (!sessionKey) noteDegraded(agentId);
      return used(agentId, sessionKey) >= MEMBER_AGENT_CREATE_LIMIT;
    },
    recordSuccess(agentId, sessionKey) {
      if (!sessionKey) noteDegraded(agentId);
      counts.set(quotaKey(agentId, sessionKey), used(agentId, sessionKey) + 1);
    },
    used,
    reset() {
      counts.clear();
      degradedWarned.clear();
    },
  };
}

declare global {
  var __workspliceMemberOpQuota: MemberOpQuotaStore | undefined;
}

/**
 * 配额单例（与 `__workspliceRoomTurns` / `__workspliceWakeListeners` 同一套热重载纪律：
 * 挂 `globalThis`，否则 Next 的热重载会把已用配额清零——一次会话又能再建一个 agent）。
 */
export function getMemberOpQuotaStore(): MemberOpQuotaStore {
  if (!globalThis.__workspliceMemberOpQuota) {
    globalThis.__workspliceMemberOpQuota = createMemberOpQuotaStore();
  }
  return globalThis.__workspliceMemberOpQuota;
}

/** 测试/运维：替换或清空单例（`null` = 下次访问重建）。 */
export function setMemberOpQuotaStore(store: MemberOpQuotaStore | null): void {
  globalThis.__workspliceMemberOpQuota = store ?? undefined;
}
