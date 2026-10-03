import { existsSync, readdirSync, rmSync } from "fs";
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
import { getAgentRuntime, BusyCwdError, type AgentRuntime } from "./agent-runtime.ts";
import { MEMORY_FILE_NAME } from "./data/dirs.ts";
import type { MemberRow } from "./data/types.ts";

/**
 * agent 生命周期（§3.6 重置粒度，ADR-0001 目录两分）：
 * - Restart：沿用现有 session 接着干（销毁运行时，按同一 session 文件重启）；
 * - Session reset：清会话上下文（删该 cwd 全部 session 文件），workspace 保留；
 * - Full reset：仅当工作区是家目录——清会话 + 家目录内容（MEMORY.md 保留）；共享项目目录拒绝；
 * - 更换 workspace：先校验新路径，再销毁旧 cwd 会话（换目录即换会话），最后改绑定；
 * - 删除身份：销毁会话、仅当工作区是家目录时删除该目录、soft-delete 成员（历史消息保留）。
 */

export type LifecycleErrorCode = 400 | 404 | 409;

function resolveRuntime(runtime?: AgentRuntime): Promise<AgentRuntime> {
  return runtime ? Promise.resolve(runtime) : getAgentRuntime();
}

/** 删除 agent 的 session 文件（文件不存在时静默）并清空绑定记录。 */
function removeSessionFile(agentId: string, sessionFile: string | null): void {
  if (sessionFile && existsSync(sessionFile)) rmSync(sessionFile, { force: true });
  setAgentSessionFile(agentId, null);
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

/** 清会话上下文：删绑定文件 + 该 cwd 下全部 session 文件，保证按需重建时是全新会话。 */
async function clearSessionFilesForAgent(
  agentId: string,
  cwd: string | null,
  runtime: AgentRuntime,
): Promise<void> {
  removeSessionFile(agentId, getAgent(agentId).pi_session_file);
  if (cwd) await runtime.removeSessionFilesForCwd(cwd);
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

export async function deleteAgentIdentity(
  agentId: string,
  runtime?: AgentRuntime,
): Promise<void> {
  const rt = await resolveRuntime(runtime);
  const agent = getAgent(agentId);
  await rt.destroySession(agent);
  removeSessionFile(agent.id, agent.pi_session_file);
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
