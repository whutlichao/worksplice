import { existsSync, rmSync } from "fs";
import type { MemberRow } from "./data/db.ts";
import { normalizeWorkspacePath, setAgentSessionFile } from "./raft/members.ts";
import { publishAgentStatus, setAgentStatusLookup } from "./agent-status.ts";
import type { AgentSessionWrapper } from "./rpc-manager.ts";

/**
 * agent 运行时抽象：ticket 05 生命周期操作与 pi 运行时之间的接缝。
 * 测试注入 fake；生产使用 getAgentRuntime()（惰性加载，避免纯服务路径拉起 SDK）。
 */
export interface AgentRuntime {
  /** 该成员当前存活（已启动且未 shutdown）的 wrapper。 */
  findSession(member: MemberRow): AgentSessionWrapper | undefined;
  /** 按需启动 session；同一 cwd 已有他人活跃会话时抛 BusyCwdError（§5.2）。 */
  startSession(member: MemberRow): Promise<{ sessionId: string; sessionFile: string | null }>;
  /** 销毁该成员的 session（idle shutdown 同语义）。 */
  destroySession(member: MemberRow): Promise<void>;
  /** 删除某 cwd 下的全部 pi session 文件（清会话上下文；按需重建时得到全新会话）。 */
  removeSessionFilesForCwd(cwd: string): Promise<void>;
}

export class BusyCwdError extends Error {
  constructor(cwd: string) {
    super(`Another agent session is already active in ${cwd}`);
    this.name = "BusyCwdError";
  }
}

/** 状态点事件映射（§3.6）：干活/回闲/出错。 */
const STATUS_BY_EVENT: Record<string, "working" | "online" | "error"> = {
  agent_start: "working",
  agent_end: "online",
  agent_settled: "online",
  compaction_end: "online",
  auto_compaction_end: "online",
  prompt_error: "error",
};

let runtimePromise: Promise<AgentRuntime> | null = null;

declare global {
  var __workspliceAgentSessions: Map<string, AgentSessionWrapper> | undefined;
}

/** 惰性单例：首次调用才 import pi SDK 与 rpc-manager（node 测试注入 fake 时不会拉起）。 */
export function getAgentRuntime(): Promise<AgentRuntime> {
  if (!runtimePromise) {
    runtimePromise = createRealAgentRuntime();
  }
  return runtimePromise;
}

async function createRealAgentRuntime(): Promise<AgentRuntime> {
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const {
    hasBusyRpcSessionForCwd,
    startRpcSession,
  } = await import("./rpc-manager.ts");
  const { normalize } = await import("path");

  // 成员 → 会话映射：agent 的 wrapper 以真实 session id 入 registry（rpc-manager），
  // 这里按成员 id 记账，状态推导不把同一 cwd 上的人类/他 agent 会话张冠李戴。
  const memberSessions = (() => {
    if (!globalThis.__workspliceAgentSessions) {
      globalThis.__workspliceAgentSessions = new Map();
    }
    return globalThis.__workspliceAgentSessions;
  })();

  const findSession = (member: MemberRow): AgentSessionWrapper | undefined => {
    const session = memberSessions.get(member.id);
    if (session?.isAlive()) return session;
    return undefined;
  };

  // 现场状态推导（§3.6 状态点）：有存活 wrapper 时按运行态推导，否则交回 DB。
  setAgentStatusLookup((member) => {
    if (!member.workspace_path) return null;
    return deriveLiveAgentStatus(member, findSession(member));
  });

  /**
   * 按 cwd 解析该 agent 最近一个 session 文件（§5.2 按需重建：
   * members.pi_session_file 未回填或文件已丢失时，沿用 cwd 下最新 jsonl）。
   */
  async function resolveLatestSessionFile(cwd: string): Promise<string | null> {
    const sessions = await SessionManager.listAll();
    const targetCwd = normalize(cwd);
    const matches = sessions.filter((s) => s.cwd && normalize(s.cwd) === targetCwd);
    if (matches.length === 0) return null;
    const latest = matches.sort((a, b) => {
      const ta = a.modified instanceof Date ? a.modified.getTime() : 0;
      const tb = b.modified instanceof Date ? b.modified.getTime() : 0;
      return tb - ta;
    })[0];
    return latest.path;
  }

  const runtime: AgentRuntime = {
    findSession,

    async startSession(member) {
      if (!member.workspace_path) throw new Error("Agent has no workspace bound");
      const cwd = normalizeWorkspacePath(member.workspace_path);
      if (!existsSync(cwd)) {
        throw new Error(`Workspace directory does not exist: ${cwd}`);
      }

      const existing = findSession(member);
      if (existing?.isAlive()) {
        return { sessionId: existing.sessionId, sessionFile: existing.sessionFile || null };
      }
      if (hasBusyRpcSessionForCwd(cwd)) {
        throw new BusyCwdError(cwd);
      }

      let sessionFile = member.pi_session_file && existsSync(member.pi_session_file)
        ? member.pi_session_file
        : null;
      if (!sessionFile) {
        sessionFile = await resolveLatestSessionFile(cwd);
      }

      // 以成员 id 为锁键：并发请求合并、重启复用同一键，且 registry 卸载时按真实 id 清理
      const { session, realSessionId } = await startRpcSession(
        `agent-${member.id}`,
        sessionFile ?? "",
        cwd,
      );

      const actualFile = session.sessionFile || sessionFile || null;
      if (actualFile && actualFile !== member.pi_session_file) {
        setAgentSessionFile(member.id, actualFile);
      }

      memberSessions.set(member.id, session);
      session.onEvent((event) => {
        const status = STATUS_BY_EVENT[event.type];
        if (status) publishAgentStatus(member.id, status);
      });

      publishAgentStatus(member.id, "online");
      return { sessionId: realSessionId, sessionFile: actualFile };
    },

    async destroySession(member) {
      const session = findSession(member);
      if (session) {
        memberSessions.delete(member.id);
        await session.shutdown();
        publishAgentStatus(member.id, "offline");
      }
    },

    async removeSessionFilesForCwd(cwd) {
      const targetCwd = normalize(cwd);
      const sessions = await SessionManager.listAll();
      for (const s of sessions) {
        if (s.cwd && normalize(s.cwd) === targetCwd && s.path) {
          rmSync(s.path, { force: true });
        }
      }
    },
  };
  return runtime;
}

/**
 * 现场状态推导（§3.6 状态点）：
 * - wrapper 存活：正在干活 → working；空闲 → DB 无 error 则 online（否则保留 error 展示）；
 * - wrapper 不在（idle shutdown / 未启动 / 应用重启）→ null，交回 DB 回落逻辑。
 */
export function deriveLiveAgentStatus(
  member: MemberRow,
  session: AgentSessionWrapper | undefined,
): "working" | "online" | null {
  if (!session?.isAlive()) return null;
  if (session.isRunning()) return "working";
  return member.status === "error" ? null : "online";
}
