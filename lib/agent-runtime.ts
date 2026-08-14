import { existsSync, realpathSync, rmSync } from "fs";
import { normalize, resolve } from "path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { MemberRow } from "./data/types.ts";
import { getDb } from "./data/db-singleton.ts";
import {
  agentHomePath,
  getMember,
  normalizeWorkspacePath,
  setAgentSessionFile,
} from "./domain/raft/index.ts";
import { publishAgentStatus, setAgentStatusLookup } from "./agent-status.ts";
import type { AgentSessionWrapper } from "./rpc/index.ts";

/**
 * agent 运行时抽象：ticket 05 生命周期操作与 pi 运行时之间的接缝。
 * 测试注入 fake；生产使用 getAgentRuntime()（惰性加载，避免纯服务路径拉起 SDK）。
 */
export interface AgentRuntime {
  /** 该成员当前存活（已启动且未 shutdown）的 wrapper。 */
  findSession(member: MemberRow): AgentSessionWrapper | undefined;
  /** 同 cwd 正在运行的会话（02-决策一：BusyCwdError 的等待对象；无则 undefined）。 */
  findBusySessionForCwd(cwd: string): AgentSessionWrapper | undefined;
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

// ============================================================================
// 会话文件所有权（ticket 03）：所有权凭证 = 成员固化登记（pi_session_file）
// ============================================================================

/**
 * 固化引用的 session 文件集合（ticket 10：含 soft-deleted 成员——软删行保留
 * pi_session_file 是 ADR-0003 的所有权凭证，被删成员仍登记的文件同样不得被复用；
 * 与 08 backfill 侧 referencedSessionFilesExcluding 同款访问器与排除语义）。
 * excludeMemberId：排除本成员自己的登记（自己的登记不算他人引用）；
 * 未传则全量登记（removeSessionFilesForCwd 删文件时的保留面，含调用方已清绑的成员）。
 */
export function referencedSessionFiles(excludeMemberId?: string): Set<string> {
  const referenced = new Set<string>();
  for (const member of getDb().listMembersIncludingDeleted()) {
    if (member.id === excludeMemberId) continue;
    if (member.pi_session_file) referenced.add(normalize(member.pi_session_file));
  }
  return referenced;
}

/** cwd 是否为该成员自己的家目录：家目录由构造唯一私有（他 agent 家目录不可绑定），
 * 其内 session 文件天然属于本成员，可安全回填。 */
export function isOwnHomeDir(member: MemberRow, cwd: string): boolean {
  return normalize(cwd) === normalizeWorkspacePath(agentHomePath(member));
}

export interface SessionFileStartInput {
  member: MemberRow;
  cwd: string;
  /** pi_session_file 非空且文件存在于磁盘。 */
  boundFileExists: boolean;
  /** 绑定文件在 SessionManager.listAll() 中解析出的 cwd（null = 不在清单，无法解析）。 */
  boundFileCwd: string | null;
  /** 其他成员固化引用的 session 文件集合（不含本成员自己的登记）。 */
  referencedByOthers: ReadonlySet<string>;
  /** cwd 是否为该成员自己的家目录。 */
  isOwnHome: boolean;
  /** 家目录回填候选：cwd 下最新未被引用的 session 文件（仅家目录场景会传入）。 */
  latestUnreferenced: string | null;
}

export interface SessionFileStartChoice {
  /** 传给 startRpcSession 的 session 文件（null = 新建空会话）。 */
  sessionFile: string | null;
  /** 归属校验失败、已自愈清除错绑绑定（调用方负责落地清绑 + 记日志）。 */
  clearedBinding: boolean;
}

/**
 * startSession 的会话文件选择与归属裁决（ticket 03 所有权规则，纯函数可测）：
 * - pi_session_file 现值存在且通过归属校验（文件 cwd == 成员 workspace、不被其他
 *   成员引用、在 session 清单内）→ 复用；
 * - 校验失败 = 历史脏数据 → 清绑 + 新建空会话（自愈）；
 * - 无绑定/文件丢失 → 仅家目录（构造上唯一私有）回填 latest unreferenced；
 *   共享项目目录不解析任何无主文件——人类 pi 会话、soft-deleted agent 遗留、他人
 *   历史文件均无固化登记，永不解析，一律新建空会话。
 */
export function chooseSessionFileForStart(input: SessionFileStartInput): SessionFileStartChoice {
  const {
    member,
    cwd,
    boundFileExists,
    boundFileCwd,
    referencedByOthers,
    isOwnHome,
    latestUnreferenced,
  } = input;
  if (member.pi_session_file && boundFileExists) {
    const owned =
      boundFileCwd !== null &&
      normalize(boundFileCwd) === normalizeWorkspacePath(cwd) &&
      !referencedByOthers.has(normalize(member.pi_session_file));
    if (owned) return { sessionFile: member.pi_session_file, clearedBinding: false };
    return { sessionFile: null, clearedBinding: true };
  }
  if (isOwnHome && latestUnreferenced) {
    return { sessionFile: latestUnreferenced, clearedBinding: false };
  }
  return { sessionFile: null, clearedBinding: false };
}

// ============================================================================
// per-cwd 启动互斥（02-决策二）：把 [busy 检查 → 文件选择 → 启动] 串行化
// ============================================================================

function getCwdStartLocks(): Map<string, Promise<unknown>> {
  if (!globalThis.__workspliceCwdStartLocks) {
    globalThis.__workspliceCwdStartLocks = new Map();
  }
  return globalThis.__workspliceCwdStartLocks;
}

/**
 * per-cwd 启动互斥（02-决策二）：共享 cwd 并发唤醒的多个 agent 排队执行，
 * 后一个等前一个完成后重新决策（对方 idle → 正常启动；running → BusyCwdError），
 * 不再撞启动窗口（trackStartingSession 置位）抛错丢 hint。
 * 键按 realpath 归一（与 hasBusyRpcSessionForCwd 的 normalizeRpcCwd 同基准）；
 * 链式 Promise 挂 globalThis（热重载安全）；失败的 holder 不阻塞后继。
 */
export function withCwdStartLock<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const resolved = resolve(cwd);
  let key: string;
  try {
    key = realpathSync(resolved);
  } catch {
    key = resolved;
  }
  const locks = getCwdStartLocks();
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

declare global {
  var __workspliceAgentSessions: Map<string, AgentSessionWrapper> | undefined;
  var __workspliceCwdStartLocks: Map<string, Promise<unknown>> | undefined;
}

/** 惰性单例：首次调用才 import pi SDK 与 lib/rpc（node 测试注入 fake 时不会拉起）。 */
export function getAgentRuntime(): Promise<AgentRuntime> {
  if (!runtimePromise) {
    runtimePromise = createRealAgentRuntime();
  }
  return runtimePromise;
}

async function createRealAgentRuntime(): Promise<AgentRuntime> {
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const {
    findBusyRpcSessionForCwd,
    hasBusyRpcSessionForCwd,
    startRpcSession,
  } = await import("./rpc/index.ts");

  // 成员 → 会话映射：agent 的 wrapper 以真实 session id 入 registry（lib/rpc），
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
   * 按 cwd 解析该 agent 最近一个 session 文件（§5.2 按需重建）。
   * ticket 03 收窄后仅由家目录场景调用（家目录唯一私有，安全回填）；
   * 共享项目目录不解析无主文件，见 chooseSessionFileForStart。
   * ADR-0001 共享项目目录：跳过被其他成员引用（pi_session_file）的文件。
   */
  async function resolveLatestSessionFile(cwd: string): Promise<string | null> {
    const sessions = await SessionManager.listAll();
    const targetCwd = normalize(cwd);
    const referenced = referencedSessionFiles();
    const matches = sessions.filter(
      (s) =>
        s.cwd &&
        normalize(s.cwd) === targetCwd &&
        !(s.path && referenced.has(s.path)),
    );
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
    findBusySessionForCwd: findBusyRpcSessionForCwd,

    async startSession(member) {
      if (!member.workspace_path) throw new Error("Agent has no workspace bound");
      const cwd = normalizeWorkspacePath(member.workspace_path);
      if (!existsSync(cwd)) {
        throw new Error(`Workspace directory does not exist: ${cwd}`);
      }

      // 02-决策二：per-cwd 启动互斥——[busy 检查 → 文件选择 → 启动] 串行化，
      // 共享 cwd 并发唤醒的多个 agent 排队决策，不再撞启动窗口抛 BusyCwdError。
      return withCwdStartLock(cwd, async () => {
        const existing = findSession(member);
        if (existing?.isAlive()) {
          return { sessionId: existing.sessionId, sessionFile: existing.sessionFile || null };
        }
        if (hasBusyRpcSessionForCwd(cwd)) {
          throw new BusyCwdError(cwd);
        }

        // ticket 03 所有权规则：文件选择经归属校验。
        // - pi_session_file 现值存在 → 校验归属后复用；校验失败（跨 cwd 绑定、被其他
        //   成员固化引用、文件不在 session 清单）＝ 历史脏数据 → 自愈：清绑 + 新建空会话；
        // - 无绑定/文件丢失 → 仅家目录回填 latest unreferenced（家目录由构造唯一私有）；
        //   共享项目目录不解析无主文件——人类会话、soft-deleted agent 遗留、他人历史
        //   文件均无固化登记，永不解析，一律新建空会话。
        const boundFile =
          member.pi_session_file && existsSync(member.pi_session_file)
            ? member.pi_session_file
            : null;
        let boundFileCwd: string | null = null;
        if (boundFile) {
          const sessions = await SessionManager.listAll();
          const match = sessions.find(
            (s) => s.path && normalize(s.path) === normalize(boundFile),
          );
          boundFileCwd = match?.cwd ?? null;
        }
        // ticket 10：引用集 = 全量成员（含软删）排除本成员自己的登记——软删成员的
        // pi_session_file 仍是所有权凭证（ADR-0003），B 残留绑定 A 的遗留文件时不得
        // 因 A 软删而放行（08 同款语义；按成员 id 排除，路径删除会连带抹掉 A 的登记）。
        const referencedByOthers = referencedSessionFiles(member.id);
        const ownHome = isOwnHomeDir(member, cwd);
        const latestUnreferenced =
          !boundFile && ownHome ? await resolveLatestSessionFile(cwd) : null;
        const choice = chooseSessionFileForStart({
          member,
          cwd,
          boundFileExists: boundFile !== null,
          boundFileCwd,
          referencedByOthers,
          isOwnHome: ownHome,
          latestUnreferenced,
        });
        if (choice.clearedBinding) {
          console.warn(
            `[agent-runtime] session file ${member.pi_session_file} fails ownership check ` +
              `(member ${member.id}, cwd ${cwd}); clearing binding, starting a fresh session`,
          );
          setAgentSessionFile(member.id, null);
        }
        const sessionFile = choice.sessionFile;

        // 以成员 id 为锁键：并发请求合并、重启复用同一键，且 registry 卸载时按真实 id 清理
        const { session, realSessionId } = await startRpcSession(
          `agent-${member.id}`,
          sessionFile ?? "",
          cwd,
          {
            // §3.10 per-agent runtime：覆盖全局默认（provider/modelId 成对；thinking 可单独）
            ...(member.model_provider && member.model_id
              ? { initialModel: { provider: member.model_provider, modelId: member.model_id } }
              : {}),
            ...(member.thinking_level
              ? { thinkingLevel: member.thinking_level as ThinkingLevel }
              : {}),
          },
        );

        const actualFile = session.sessionFile || sessionFile || null;
        if (actualFile && actualFile !== member.pi_session_file) {
          setAgentSessionFile(member.id, actualFile);
        }

        memberSessions.set(member.id, session);
        session.onEvent((event) => {
          const status = STATUS_BY_EVENT[event.type];
          if (!status) return;
          // §3.6 error 保留：agent_end/agent_settled 不覆盖错误状态。模型/API 失败
          // （如 openrouter 402）时 SDK 只发 agent_end/prompt_done 不发 prompt_error，
          // loop 判空后 publish error 可能晚于收尾事件——收尾事件不得把状态洗回 online；
          // error 只被下一次 agent_start（新轮开始）清除。
          if (
            getMember(member.id)?.status === "error" &&
            (event.type === "agent_end" || event.type === "agent_settled")
          ) {
            return;
          }
          publishAgentStatus(member.id, status);
        });

        publishAgentStatus(member.id, "online");
        return { sessionId: realSessionId, sessionFile: actualFile };
      });
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
      // ADR-0001 共享项目目录：只删未被任何成员引用的文件——调用方已先清掉本成员
      // 的 pi_session_file 引用，故本成员的文件会被删、其他 agent 的会被保留。
      const referenced = referencedSessionFiles();
      const sessions = await SessionManager.listAll();
      for (const s of sessions) {
        if (s.cwd && normalize(s.cwd) === targetCwd && s.path && !referenced.has(s.path)) {
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
