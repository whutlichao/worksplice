import { statSync } from "fs";
import { isAbsolute, resolve } from "path";
import { getDb } from "./db-singleton.ts";
import type { MemberRow, MemberStatus } from "../data/db.ts";
import { BUILTIN_CHANNEL_ID } from "../data/schema.ts";

/**
 * workspace 路径归一化（§5.2 隔离单位是 cwd）：绝对路径化，
 * 使 `~/repo` 与相对路径落到同一比较基准；存储保留用户输入形态。
 * 活跃会话冲突由 rpc-manager 的 realpath 语义校验（hasBusyRpcSessionForCwd）。
 */
export function normalizeWorkspacePath(workspacePath: string): string {
  return isAbsolute(workspacePath) ? workspacePath : resolve(workspacePath);
}

function assertWorkspaceDir(workspacePath: string): string {
  const normalized = normalizeWorkspacePath(workspacePath);
  let stat;
  try {
    stat = statSync(normalized);
  } catch {
    throw new Error(`Workspace directory does not exist: ${workspacePath}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Workspace path is not a directory: ${workspacePath}`);
  }
  return normalized;
}

/** 同一 cwd 同一时刻只能绑定一个活跃 agent 身份（§5.2）；软删除身份不计。 */
export function agentWorkspaceByAnother(
  workspacePath: string,
  excludeMemberId: string,
): boolean {
  const normalized = normalizeWorkspacePath(workspacePath);
  return getDb()
    .listMembers()
    .some(
      (m) =>
        m.id !== excludeMemberId &&
        m.workspace_path !== null &&
        normalizeWorkspacePath(m.workspace_path) === normalized,
    );
}

/** 左栏 agent 成员列表（§3.1）：只列 agent 类型、未删除成员。 */
export function listAgents(): MemberRow[] {
  return getDb()
    .listMembers()
    .filter((m) => m.type === "agent");
}

export function getMember(id: string): MemberRow | undefined {
  return getDb().getMember(id);
}

export class AgentNotFoundError extends Error {
  constructor(id: string) {
    super(`Agent not found: ${id}`);
    this.name = "AgentNotFoundError";
  }
}

export function getAgent(id: string): MemberRow {
  const member = getDb().getMember(id);
  if (!member || member.type !== "agent" || member.deleted === 1) {
    throw new AgentNotFoundError(id);
  }
  return member;
}

export function createAgent(input: {
  name: string;
  description?: string;
  workspacePath?: string | null;
}): MemberRow {
  const name = input.name.trim();
  if (!name) throw new Error("Agent name is required");
  if (name.length > 32) throw new Error("Agent name must be 32 characters or fewer");

  let workspacePath: string | null = null;
  if (input.workspacePath) {
    workspacePath = assertWorkspaceDir(input.workspacePath);
    if (agentWorkspaceByAnother(workspacePath, "")) {
      throw new Error("This workspace directory is already bound to another agent");
    }
  }

  const agent = getDb().insertMember({
    type: "agent",
    name,
    description: (input.description ?? "").trim(),
    role: "member",
    workspacePath,
    status: "offline",
  });
  // #all 全员自动加入（§3.2）
  getDb().addChannelMember(BUILTIN_CHANNEL_ID, agent.id);
  return agent;
}

/**
 * 校验候选绑定目录（§3.6 workspace 区）：存在、可写校验前先抛错——变更类操作
 * 必须在动 session/绑定之前校验，避免坏路径先杀掉存活会话。
 */
export function validateAgentWorkspace(agentId: string, workspacePath: string): string {
  getAgent(agentId);
  const normalized = assertWorkspaceDir(workspacePath);
  if (agentWorkspaceByAnother(normalized, agentId)) {
    throw new Error("This workspace directory is already bound to another agent");
  }
  return normalized;
}

/**
 * 更换绑定目录（§3.6 workspace 区）：目录必须存在、不得与他 agent 绑定冲突；
 * 换目录即换会话，旧 pi_session_file 一并清空（下次激活按需重建）。
 */
export function updateAgentWorkspace(agentId: string, workspacePath: string): MemberRow {
  const normalized = validateAgentWorkspace(agentId, workspacePath);
  const agent = getAgent(agentId);
  if (normalized === normalizeWorkspacePath(agent.workspace_path ?? "")) {
    return agent;
  }
  getDb().updateMemberWorkspace(agentId, normalized);
  return getAgent(agentId);
}

export function setAgentStatus(agentId: string, status: MemberStatus): void {
  const agent = getAgent(agentId);
  getDb().updateMemberStatus(agent.id, status);
}

export function setAgentSessionFile(agentId: string, sessionFile: string | null): void {
  getAgent(agentId);
  getDb().setMemberPiSessionFile(agentId, sessionFile);
}

/**
 * §3.10 per-agent runtime：设置模型/provider/thinking 覆盖（覆盖全局默认）。
 * 传 null 清空该维度回全局；未提供的维度保持原值。模型成对校验（provider+modelId）。
 */
export function setAgentRuntimeConfig(
  agentId: string,
  input: {
    modelProvider?: string | null;
    modelId?: string | null;
    thinkingLevel?: string | null;
  },
): MemberRow {
  const agent = getAgent(agentId);
  const modelProvider = input.modelProvider !== undefined ? input.modelProvider : agent.model_provider;
  const modelId = input.modelId !== undefined ? input.modelId : agent.model_id;
  if ((modelProvider === null) !== (modelId === null)) {
    throw new Error("Model provider and model id must be set or cleared together");
  }
  getDb().setMemberModel(agent.id, {
    modelProvider: input.modelProvider !== undefined ? input.modelProvider : undefined,
    modelId: input.modelId !== undefined ? input.modelId : undefined,
    thinkingLevel: input.thinkingLevel !== undefined ? input.thinkingLevel : undefined,
  });
  return getAgent(agent.id);
}

/**
 * 删除身份（§3.6）：soft-delete，保留成员行以承载不可变消息的外键与渲染；
 * 状态点/认领消失——移出全部 channel、清空任务 owner 与消费游标。
 */
export function deleteAgent(agentId: string): void {
  const agent = getAgent(agentId);
  getDb().withTransaction(() => {
    getDb().setMemberDeleted(agent.id, 1);
    getDb().removeMemberFromAllChannels(agent.id);
    getDb().clearTaskOwners(agent.id);
    getDb().clearConsumedSeqsForAgent(agent.id);
  });
}
