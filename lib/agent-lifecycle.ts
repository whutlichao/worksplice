import { existsSync, readdirSync, rmSync } from "fs";
import { join, normalize } from "path";
import {
  getAgent,
  deleteAgent,
  setAgentSessionFile,
  updateAgentWorkspace,
  validateAgentWorkspace,
  agentHomePath,
  normalizeWorkspacePath,
  AgentNotFoundError,
} from "./domain/collab/index.ts";
import { publishAgentStatus } from "./agent-status.ts";
import {
  getAgentRuntime,
  BusyCwdError,
  chooseOwnedSessionFilesInHome,
  referencedSessionFiles,
  type AgentRuntime,
} from "./agent-runtime.ts";
import { archiveAgentSessionFiles, deleteAgentSessionArchives } from "./session-archive.ts";
import { MEMORY_FILE_NAME } from "./data/dirs.ts";
import type { MemberRow } from "./data/types.ts";

/**
 * agent 生命周期（§3.6 重置粒度，ADR-0001 目录两分）：
 * - Restart：沿用现有 session 接着干（销毁运行时，按同一 session 文件重启）；
 * - Session reset：清会话上下文（归档后只清理可确认归属该 agent 的 session 文件），workspace 保留；
 * - Full reset：仅当工作区是家目录——清会话 + 家目录内容（MEMORY.md 保留）；共享项目目录拒绝；
 * - 更换 workspace：先校验新路径，再销毁旧 cwd 会话（换目录即换会话），最后改绑定；
 * - 删除身份（显式永久删除）：清可确认归属的 session，清私有归档副本与私有持久记忆
 *   （MEMORY.md），soft-delete 成员（协作历史保留）。
 */

export type LifecycleErrorCode = 400 | 404 | 409;

function resolveRuntime(runtime?: AgentRuntime): Promise<AgentRuntime> {
  return runtime ? Promise.resolve(runtime) : getAgentRuntime();
}

/**
 * 列出可确认归属该 agent 的 session 文件（票 09 归属判定 / 票 03 目标语义；重置与删除共用）。
 * 凭证两条：
 * ① 成员固化登记 `pi_session_file`（ADR-0003 所有权凭证）：被其他成员（含 soft-deleted）
 *    登记时视为登记冲突、归属不确定 ⇒ 保留；
 * ② 家目录私有性（ADR-0001：家目录由构造唯一私有）：cwd 清单内排除被其他成员登记的路径。
 * 共享项目目录只认凭证 ①：无登记的文件（人类会话、已删 agent 遗留、他人历史文件）一律不可确认
 * ⇒ 不归档、不清理（**不确定 = 保留**）。
 */
async function listOwnedSessionFiles(
  agent: MemberRow,
  cwd: string | null,
  runtime: AgentRuntime,
): Promise<string[]> {
  const referencedByOthers = referencedSessionFiles(agent.id);
  const owned = new Set<string>();
  if (agent.pi_session_file && !referencedByOthers.has(normalize(agent.pi_session_file))) {
    owned.add(agent.pi_session_file);
  }
  const ownHome = isOwnHome(agent);
  const homeCwdSessionFiles = cwd && ownHome ? await runtime.listSessionFilesForCwd(cwd) : [];
  for (const sessionFile of chooseOwnedSessionFilesInHome({
    homeCwdSessionFiles,
    referencedByOthers,
  })) {
    owned.add(sessionFile);
  }
  return [...owned];
}

/** 当前工作区是否为该 agent 自己的家目录（ADR-0001：删除/Full reset 只作用于家目录）。 */
function isOwnHome(agent: MemberRow): boolean {
  if (!agent.workspace_path) return false;
  return normalizeWorkspacePath(agent.workspace_path) === normalizeWorkspacePath(agentHomePath(agent));
}

/** 清空 workspace 目录内容（保留目录本身与 MEMORY.md——长期记忆是身份资产，ADR-0001）。 */
function clearWorkspaceContents(workspacePath: string | null): void {
  if (!workspacePath || !existsSync(workspacePath)) return;
  for (const entry of readdirSync(workspacePath, { withFileTypes: true })) {
    if (entry.name === MEMORY_FILE_NAME) continue;
    rmSync(`${workspacePath}/${entry.name}`, { recursive: true, force: true });
  }
}

/**
 * 清会话上下文：归档后只清理**可确认归属该 agent** 的 session 文件，保证按需重建时是全新会话。
 *
 * 归档副作用先行（上下文治理票 06 / spec B1、B6：重置不再等于丢失原始记录）+ 归属判定收口
 * （票 09 / 票 03 目标语义）：**归档与清理共用同一集合**（listOwnedSessionFiles）——
 * 绑定文件 + 家目录 cwd 下的 session 文件；共享项目目录里归属不明/他人/人类的 session
 * 一律保留。归档只复制不删除，失败即抛出、不进入删除阶段（宁可重置失败，不丢原始记录）。
 */
async function clearSessionFilesForAgent(
  agentId: string,
  cwd: string | null,
  runtime: AgentRuntime,
): Promise<void> {
  const agent = getAgent(agentId);
  const owned = await listOwnedSessionFiles(agent, cwd, runtime);
  archiveAgentSessionFiles(agent.id, owned);
  if (owned.length > 0) await runtime.removeSessionFiles(owned);
  setAgentSessionFile(agentId, null);
}

export async function restartAgent(
  agentId: string,
  runtime?: AgentRuntime,
): Promise<{ sessionId: string; sessionFile: string | null }> {
  const rt = await resolveRuntime(runtime);
  const agent = getAgent(agentId);
  await rt.destroySession(agent);
  return rt.startSession(agent);
}

export async function sessionResetAgent(agentId: string, runtime?: AgentRuntime): Promise<void> {
  const rt = await resolveRuntime(runtime);
  const agent = getAgent(agentId);
  await rt.destroySession(agent);
  await clearSessionFilesForAgent(agent.id, agent.workspace_path, rt);
  publishAgentStatus(agent.id, "offline");
}

export async function fullResetAgent(agentId: string, runtime?: AgentRuntime): Promise<void> {
  const rt = await resolveRuntime(runtime);
  const agent = getAgent(agentId);
  // ADR-0001：共享项目目录不能全量清（可能绑定多个 agent）；Full reset 只作用于家目录
  if (!isOwnHome(agent)) {
    throw new Error(
      "Full reset only applies to the agent's home directory; the bound project directory is shared with other agents",
    );
  }
  await rt.destroySession(agent);
  await clearSessionFilesForAgent(agent.id, agent.workspace_path, rt);
  clearWorkspaceContents(agent.workspace_path);
  publishAgentStatus(agent.id, "offline");
}

/**
 * 更换绑定目录（§3.6 workspace 区）：先校验新路径（坏路径不伤旧会话），
 * 再销毁旧 cwd 的会话，最后改绑定并清空 session 记录。
 */
export async function changeAgentWorkspace(
  agentId: string,
  workspacePath: string,
  runtime?: AgentRuntime,
): Promise<{ id: string; workspace_path: string | null }> {
  const rt = await resolveRuntime(runtime);
  const agent = getAgent(agentId);
  validateAgentWorkspace(agentId, workspacePath);
  await rt.destroySession(agent);
  const updated = updateAgentWorkspace(agentId, workspacePath);
  publishAgentStatus(agent.id, "offline");
  return updated;
}

/**
 * 显式永久删除（票 03 / spec B7）：只清该 agent 的私有内容——
 * - 可确认归属其身份的 session 文件：绑定文件 + 工作区 cwd 清单（仅当工作区即家目录）；
 *   绑定共享项目目录时只清绑定文件，共享 cwd 里他人/归属不明的 session 与项目目录本体都不动；
 * - 私有归档副本与检索索引（票 06 落点 `session-archives/<agent id>/`，删后对检索面不可见）；
 * - 私有持久记忆 `MEMORY.md`（家目录资产，绑定项目目录时同样清除）。
 * 协作历史（频道消息、任务等）随 soft-delete 保留；家目录本体仅在「工作区即家目录」时整删
 * （ADR-0001，既有语义，不扩大删除范围——绑定项目目录时家目录内未登记的遗留 session 文件
 * 不在本票清理面）。
 */
export async function deleteAgentIdentity(
  agentId: string,
  runtime?: AgentRuntime,
): Promise<void> {
  const rt = await resolveRuntime(runtime);
  const agent = getAgent(agentId);
  await rt.destroySession(agent);
  // 会话文件：只删可确认归属的集合；随后清空绑定登记（登记是身份行数据，删除身份时一并清）
  const owned = await listOwnedSessionFiles(agent, agent.workspace_path, rt);
  if (owned.length > 0) await rt.removeSessionFiles(owned);
  setAgentSessionFile(agent.id, null);
  // 私有归档副本 + 索引：先删（失败即中止，不进入 soft-delete，避免留下可检索的私有归档）
  deleteAgentSessionArchives(agent.id);
  // 私有持久记忆：家目录整删时一并覆盖；绑定项目目录时家目录仍在，这里显式清除 MEMORY.md
  rmSync(join(agentHomePath(agent), MEMORY_FILE_NAME), { force: true });
  // ADR-0001：只删家目录；绑定共享项目目录时绝不 rm（可能正在被其他 agent 使用）
  if (isOwnHome(agent) && agent.workspace_path && existsSync(agent.workspace_path)) {
    rmSync(agent.workspace_path, { recursive: true, force: true });
  }
  deleteAgent(agent.id);
}

/** 路由层统一错误码映射：BusyCwdError → 409、未知成员 → 404、其余 → 400。 */
export function toLifecycleErrorStatus(error: unknown): LifecycleErrorCode {
  if (error instanceof BusyCwdError) return 409;
  if (error instanceof AgentNotFoundError) return 404;
  return 400;
}
