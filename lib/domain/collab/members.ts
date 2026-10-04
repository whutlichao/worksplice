import { existsSync, mkdirSync, statSync, writeFileSync } from "fs";
import { isAbsolute, join, resolve } from "path";
import { randomUUID } from "crypto";
import { getDb } from "../../data/db-singleton.ts";
import { notifyAgentJoinedChannel } from "./event-messages.ts";
import { getDMFor } from "./channels.ts";
import type { MemberRow, MemberStatus } from "../../data/types.ts";
import { BUILTIN_CHANNEL_ID } from "../../data/schema.ts";
import {
  agentHomeDir,
  buildMemoryTemplate,
  MEMORY_FILE_NAME,
} from "../../data/dirs.ts";
import { parseMentionTokens } from "../../mention.ts";

/**
 * workspace 路径归一化（§5.2 隔离单位是 cwd）：绝对路径化，
 * 使 `~/repo` 与相对路径落到同一比较基准；存储保留用户输入形态。
 * 活跃会话冲突由 lib/rpc registry 的 realpath 语义校验（hasBusyRpcSessionForCwd）。
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

/**
 * 家目录保护（ADR-0001）：同一目录允许多 agent 绑定（协作项目目录），但不得把
 * 另一存活 agent 的家目录绑成项目目录——Full reset/删除语义按家目录判定，跨绑会误伤。
 * 软删除身份的家目录已随身份删除，不计。
 */
export function homeDirOfAnotherAgent(
  workspacePath: string,
  excludeMemberId: string,
): boolean {
  const normalized = normalizeWorkspacePath(workspacePath);
  return getDb()
    .listMembers()
    .some(
      (m) =>
        m.id !== excludeMemberId &&
        m.type === "agent" &&
        m.deleted === 0 &&
        normalizeWorkspacePath(agentHomePath(m)) === normalized,
    );
}

/**
 * 确定性家目录推导（ADR-0001 单槽工作区）：`workspace_path ?? 家目录`；新 agent 创建时即建。
 * 存库的 `workspace_path` 只表达**显式项目目录绑定**（家目录派生绑定存 NULL）；历史行里
 * 「绝对家目录」形态的值由数据层读侧视图按当前数据目录重推（lib/data/sqlite.ts）。
 */
export function agentHomePath(member: MemberRow): string {
  return agentHomeDir(getDb().paths.dataDir, member.id, member.name);
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

/** 创建 agent 重名（名字是 mention 句柄，重名即歧义）：大小写不敏感、trim 后全等未删除成员。 */
export class DuplicateAgentNameError extends Error {
  constructor(name: string) {
    super(`Agent name "${name}" already exists`);
    this.name = "DuplicateAgentNameError";
  }
}

export function getAgent(id: string): MemberRow {
  const member = getDb().getMember(id);
  if (!member || member.type !== "agent" || member.deleted === 1) {
    throw new AgentNotFoundError(id);
  }
  return member;
}

/**
 * §3.2 @mention 解析：内容里的 @名字 token → 成员 id（大小写不敏感、全等 token 匹配）。
 * 支持两种形态：`@名字`（无空白名）与 `@"带空格名字"`（引号形式，兼容含空白成员名）。
 * 服务层事实来源：wake 的穿透分发与 inbox 的 mute 穿透判定共用同一解析（inbox/wake 同源）。
 * 解析器与渲染侧共用 lib/mention.ts 的 parseMentionTokens（语义不变，行为一致）。
 */
export function extractMentionedMemberIds(content: string): string[] {
  const members = getDb().listMembers();
  const tokens = parseMentionTokens(
    content,
    members.map((m) => ({ id: m.id, name: m.name, type: m.type })),
  );
  // 名字全等匹配即算（重名已被创建期禁止，按名字匹配至多命中一个成员）；去重保序。
  const ids: string[] = [];
  for (const token of tokens) {
    for (const member of members) {
      if (
        member.name.toLowerCase() === token.name.toLowerCase() &&
        !ids.includes(member.id)
      ) {
        ids.push(member.id);
      }
    }
  }
  return ids;
}

/** 人类成员（Owner，恒为单数）：mention 解析与简介弹窗的数据来源。 */
export function getOwner(): MemberRow | undefined {
  return getDb()
    .listMembers()
    .find((m) => m.type === "human");
}

/**
 * 创建 agent（ADR-0001）：默认自动在 <dataDir>/agents/<slug>-<id8>/ 生成专属家目录
 * 并预置 MEMORY.md 固定大纲（删除身份时随家目录一并删除），但**不把家目录写进**
 * `workspace_path`（存 NULL——家目录是派生值，见 agentHomePath）；显式 workspacePath
 * 仅用于测试/内部路径（生产创建流程不传，绑定项目目录走 changeAgentWorkspace）。
 * 模型/推理强度为可选项：route 层创建契约强制必选；null = 继承全局默认。
 */
export function createAgent(input: {
  name: string;
  description?: string;
  workspacePath?: string | null;
  provider?: string | null;
  modelId?: string | null;
  thinkingLevel?: string | null;
}): MemberRow {
  const name = input.name.trim();
  if (!name) throw new Error("Agent name is required");
  if (name.length > 32)
    throw new Error("Agent name must be 32 characters or fewer");

  // 名字唯一性（mention 句柄不可歧义）：trim 后大小写不敏感全等比对未删除成员（含 human；
  // listMembers 天然排除 soft-delete，被删成员不占名）。
  const nameLower = name.toLowerCase();
  if (
    getDb()
      .listMembers()
      .some((m) => m.name.toLowerCase() === nameLower)
  ) {
    throw new DuplicateAgentNameError(name);
  }

  const modelProvider = input.provider ?? null;
  const modelId = input.modelId ?? null;
  const thinkingLevel = input.thinkingLevel ?? null;
  if ((modelProvider === null) !== (modelId === null)) {
    throw new Error(
      "Model provider and model id must be set or cleared together",
    );
  }

  const agentId = randomUUID();
  // 家目录派生绑定不落库绝对路径（ADR-0001）：workspace_path = NULL 表示「未显式绑定项目目录，
  // 工作区即家目录」，由 `workspace_path ?? 家目录`（agentHomePath）在读取侧按**当前**数据目录推导——
  // 因此数据目录被复制/搬迁后，写路径跟着当前数据目录走，不会回流旧目录。
  let workspacePath: string | null = null;
  if (input.workspacePath) {
    workspacePath = assertWorkspaceDir(input.workspacePath);
  } else {
    const homeDir = agentHomeDir(getDb().paths.dataDir, agentId, name);
    mkdirSync(homeDir, { recursive: true });
    const memoryFile = join(homeDir, MEMORY_FILE_NAME);
    if (!existsSync(memoryFile)) {
      writeFileSync(
        memoryFile,
        buildMemoryTemplate(name, input.description ?? ""),
      );
    }
  }

  const agent = getDb().insertMember({
    id: agentId,
    type: "agent",
    name,
    description: (input.description ?? "").trim(),
    role: "member",
    workspacePath,
    status: "offline",
    modelProvider,
    modelId,
    thinkingLevel,
  });
  // #all 全员自动加入（§3.2）
  getDb().addChannelMember(BUILTIN_CHANNEL_ID, agent.id);
  notifyAgentJoinedChannel(BUILTIN_CHANNEL_ID, agent.id);
  // 懒创建（dm-lazy-create）：DM 不随 agent 创建，只在 owner 打开「发送消息」入口时幂等建
  return agent;
}

/**
 * 校验候选绑定目录（§3.6 workspace 区）：存在、可写校验前先抛错——变更类操作
 * 必须在动 session/绑定之前校验，避免坏路径先杀掉存活会话。
 * ADR-0001：不再拒绝多 agent 绑定同一目录（协作项目目录），仅拒绝绑定他人家目录。
 */
export function validateAgentWorkspace(
  agentId: string,
  workspacePath: string,
): string {
  getAgent(agentId);
  const normalized = assertWorkspaceDir(workspacePath);
  if (homeDirOfAnotherAgent(normalized, agentId)) {
    throw new Error(
      "This directory is another agent's home; bind a shared project directory instead",
    );
  }
  return normalized;
}

/**
 * 更换绑定目录（§3.6 workspace 区）：目录必须存在、不得与他 agent 绑定冲突；
 * 换目录即换会话，旧 pi_session_file 一并清空（下次激活按需重建）。
 */
export function updateAgentWorkspace(
  agentId: string,
  workspacePath: string,
): MemberRow {
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

export function setAgentSessionFile(
  agentId: string,
  sessionFile: string | null,
): void {
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
  const modelProvider =
    input.modelProvider !== undefined
      ? input.modelProvider
      : agent.model_provider;
  const modelId = input.modelId !== undefined ? input.modelId : agent.model_id;
  if ((modelProvider === null) !== (modelId === null)) {
    throw new Error(
      "Model provider and model id must be set or cleared together",
    );
  }
  getDb().setMemberModel(agent.id, {
    modelProvider:
      input.modelProvider !== undefined ? input.modelProvider : undefined,
    modelId: input.modelId !== undefined ? input.modelId : undefined,
    thinkingLevel:
      input.thinkingLevel !== undefined ? input.thinkingLevel : undefined,
  });
  return getAgent(agent.id);
}

/**
 * 删除身份（§3.6）：soft-delete，保留成员行以承载不可变消息的外键与渲染；
 * 状态点/认领消失——移出全部 channel、清空任务 owner 与消费游标。
 */
export function deleteAgent(agentId: string): void {
  const agent = getAgent(agentId);
  // §R7 soft-delete 后 DM 保留可读、不可写：归档冻结写入（复用 sendMessage 的 archived 只读语义）。
  // 在事务前取 DM（agent 尚存活），归档与 soft-delete 同事务原子提交。
  const dm = getDMFor(agent.id);
  getDb().withTransaction(() => {
    getDb().setMemberDeleted(agent.id, 1);
    getDb().removeMemberFromAllChannels(agent.id);
    getDb().clearTaskOwners(agent.id);
    getDb().clearConsumedSeqsForAgent(agent.id);
    if (dm) getDb().setChannelArchived(dm.id, 1);
  });
}
