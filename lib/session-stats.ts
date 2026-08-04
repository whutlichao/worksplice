import { existsSync, readFileSync, statSync } from "fs";
import { normalize as normalizePath } from "path";
import type { MemberRow } from "./data/db.ts";
import { normalizeWorkspacePath } from "./raft/members.ts";

/**
 * Token / 成本可观测性（spec §6.5）：从 pi session jsonl **只读解析**统计，
 * 按 agent 聚合展示于详情面板；**不落库**（与"session 读写权交 SDK、app 只读"边界一致）。
 *
 * 解析算法与 SDK 的 getSessionStats 一致（assistant message 的 `message.usage`、
 * compaction / branch_summary 条目的 `usage`）；compaction 信息从 `compaction`
 * 条目的 `tokensBefore` 统计。文件以追加方式写入（jsonl），无锁读取安全。
 */

export interface SessionUsageStats {
  messageCount: number;
  cachedTokens: number;
  uncachedTokens: number;
  totalTokens: number;
  costTotal: number;
}

export interface SessionFileStats extends SessionUsageStats {
  path: string;
  /** 文件最后修改时间（ISO，列表展示用）；stat 失败时 null。 */
  modified: string | null;
  /** compaction 条目数（§6.5 上下文状态可见性）。 */
  compactionCount: number;
  /** compaction 条目 tokensBefore 之和（被压缩掉的 token 量）。 */
  compactionTokens: number;
}

export interface AgentUsageSummary {
  sessions: SessionFileStats[];
  totals: SessionUsageStats & { compactionCount: number; compactionTokens: number };
}

/** usage 字段校验 + 聚合（与 pi jsonl-storage.getSessionStats 同口径）。 */
function addUsage(acc: SessionUsageStats, usage: unknown): void {
  if (!usage || typeof usage !== "object") return;
  const u = usage as Record<string, unknown>;
  const cost = u.cost as Record<string, unknown> | undefined;
  if (
    typeof u.input !== "number" ||
    typeof u.output !== "number" ||
    typeof u.cacheRead !== "number" ||
    typeof u.cacheWrite !== "number" ||
    !cost ||
    typeof cost.total !== "number"
  ) {
    return;
  }
  acc.cachedTokens += u.cacheRead;
  acc.uncachedTokens += u.input + u.cacheWrite;
  acc.totalTokens += u.input + u.output + u.cacheRead + u.cacheWrite;
  acc.costTotal += cost.total;
}

interface JsonlEntry {
  type?: string;
  message?: { role?: string; usage?: unknown };
  usage?: unknown;
  tokensBefore?: unknown;
}

/** 逐行解析单个 jsonl 文件（只读，不经过 SDK 打开路径，零副作用）。 */
export function parseSessionFileStats(filePath: string): SessionFileStats | null {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const acc: SessionUsageStats = {
    messageCount: 0,
    cachedTokens: 0,
    uncachedTokens: 0,
    totalTokens: 0,
    costTotal: 0,
  };
  let compactionCount = 0;
  let compactionTokens = 0;

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let entry: JsonlEntry;
    try {
      entry = JSON.parse(line) as JsonlEntry;
    } catch {
      continue; // 半行/损坏行跳过，不影响其余统计
    }
    if (entry.type === "message") {
      acc.messageCount += 1;
      if (entry.message?.role === "assistant") {
        addUsage(acc, entry.message.usage);
      }
    } else if (entry.type === "compaction" || entry.type === "branch_summary") {
      addUsage(acc, entry.usage);
      if (entry.type === "compaction") {
        compactionCount += 1;
        if (typeof entry.tokensBefore === "number") compactionTokens += entry.tokensBefore;
      }
    }
  }

  let modified: string | null = null;
  try {
    modified = statSync(filePath).mtime.toISOString();
  } catch {
    // 文件可能刚被删除；modified 留 null。
  }

  return {
    path: filePath,
    modified,
    ...acc,
    compactionCount,
    compactionTokens,
  };
}

export function sumSessionStats(stats: SessionFileStats[]): SessionUsageStats & { compactionCount: number; compactionTokens: number } {
  const totals: SessionUsageStats & { compactionCount: number; compactionTokens: number } = {
    messageCount: 0,
    cachedTokens: 0,
    uncachedTokens: 0,
    totalTokens: 0,
    costTotal: 0,
    compactionCount: 0,
    compactionTokens: 0,
  };
  for (const s of stats) {
    totals.messageCount += s.messageCount;
    totals.cachedTokens += s.cachedTokens;
    totals.uncachedTokens += s.uncachedTokens;
    totals.totalTokens += s.totalTokens;
    totals.costTotal += s.costTotal;
    totals.compactionCount += s.compactionCount;
    totals.compactionTokens += s.compactionTokens;
  }
  return totals;
}

/** 文件存在性过滤（session 文件可能已被 reset 删除）。 */
function existingOnly(paths: string[]): string[] {
  return paths.filter((p) => existsSync(p));
}

/**
 * 该 agent 的全部 session 文件：
 * 1. members.pi_session_file 精确匹配（当前绑定会话）；
 * 2. workspace cwd 下 SessionManager.listAll() 的全部会话（历史会话）。
 * 按修改时间倒序（最近在前）。
 */
export async function listAgentSessionFiles(
  agent: MemberRow,
  listAll: () => Promise<Array<{ cwd?: string | null; path?: string | null; modified?: Date | string | null }>> = async () => {
    // 惰性加载：纯解析路径（测试）不拉起 SDK。
    const { SessionManager } = await import("@earendil-works/pi-coding-agent");
    return SessionManager.listAll();
  },
): Promise<string[]> {
  const files = new Set<string>();
  if (agent.pi_session_file && existsSync(agent.pi_session_file)) {
    files.add(agent.pi_session_file);
  }
  if (agent.workspace_path) {
    const targetCwd = normalizePath(normalizeWorkspacePath(agent.workspace_path));
    const sessions = await listAll();
    for (const s of sessions) {
      if (s.cwd && s.path && normalizePath(s.cwd) === targetCwd) {
        files.add(s.path);
      }
    }
  }
  return existingOnly([...files]).sort((a, b) => {
    const ma = modifiedMs(a);
    const mb = modifiedMs(b);
    return mb - ma;
  });
}

function modifiedMs(filePath: string): number {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

/** 解析 + 聚合该 agent 的全部 session 统计（§6.5 按 agent 聚合，不落库）。 */
export async function aggregateAgentUsage(agent: MemberRow): Promise<AgentUsageSummary> {
  const files = await listAgentSessionFiles(agent);
  const sessions = files
    .map((file) => parseSessionFileStats(file))
    .filter((s): s is SessionFileStats => s !== null);
  return { sessions, totals: sumSessionStats(sessions) };
}
