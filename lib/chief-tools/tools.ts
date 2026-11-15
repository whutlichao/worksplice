// 首席领域工具的**扩展工厂**（票 chief-tools）：五个 `worksplice_*` 工具经
// `resourceLoaderOptions.extensionFactories` 接缝注册进会话（与路径守卫 / bash 沙箱同一条缝，
// ADR-0011 决策四）。本文件只做三件事：判 actor 是否**仍然是**全局首席、把参数交给
// `./decisions.ts` 的判定层、把通过的值交给协作域服务。
//
// 为什么是「薄壳 + 判定层」两层：注册这一层拖 SDK 类型与领域服务，判定那一层（参数校验、
// 配额、可见面、事件文案）是纯函数，能在没有 SDK / 数据库的情况下逐条取证。安全边界的
// 每一条规则都落在判定层，所以它们都有单测；本文件里只有「读库 → 调服务 → 包结果」。

import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionFactory,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { BUILTIN_CHANNEL_ID, OWNER_MEMBER_ID } from "../data/schema.ts";
import { CHIEF_DOMAIN_TOOL_NAMES } from "../member-tool-policy.ts";
import {
  createAgent,
  createChannel,
  getChannel,
  getMember,
  isChannelMember,
  isSecretaryMember,
  listAgents,
  listChannelMembers,
  listChannels,
  listChannelTasks,
  notifyChiefSystemAction,
} from "../domain/collab/index.ts";
import {
  AGENT_CREATE_QUOTA_ERROR,
  AGENT_NAME_PATTERN,
  CHIEF_ONLY_ERROR,
  agentCreateEventContent,
  channelCreateEventContent,
  channelSummary,
  createAgentCreateQuota,
  decideAgentCreateInput,
  decideChannelCreateInput,
  decideListChannelsInput,
  decideListMembersInput,
  decideListTasksInput,
  isChannelVisibleToActor,
  memberIdRejection,
  memberSummary,
  taskSummary,
} from "./decisions.ts";

/**
 * 工具结果：成功回 JSON 文本（模型读得懂、也便于人复核），失败回 `isError` + 英文原因。
 *
 * 失败一律走 `isError` 而不是抛：抛出的异常会被 SDK 包成结果，中间的 `details` 会丢，
 * 而且「拒绝」在这套工具里是**正常路径**（非首席 / 参数不合规 / 配额用尽），不是崩溃。
 */
type ChiefToolResult = AgentToolResult<undefined>;

function success(payload: unknown): ChiefToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], details: undefined };
}

function failure(message: string): ChiefToolResult {
  return { content: [{ type: "text", text: message }], details: undefined, isError: true };
}

/** 服务层抛错 → 可读英文（`DuplicateAgentNameError` 等自带的 message 原样透出，不吞成通用错误）。 */
function reasonOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export interface ChiefToolsOptions {
  /** 会话归属的成员 id：每次调用都用它**重新**判定首席身份，也是写操作的署名者。 */
  actorId: string;
}

/**
 * 五个领域工具的定义（未注册）。一次调用 = 一份配额实例：配额挂在这里而不是模块级，
 * 是因为工厂每次 `startSession` 执行一次，天然就是「一次连续工作窗口」的边界。
 */
export function chiefToolDefinitions(options: ChiefToolsOptions): ToolDefinition[] {
  const { actorId } = options;
  const quota = createAgentCreateQuota();

  /**
   * 每次调用重新判定 actor 仍是当前全局首席（唯一判据 `isSecretaryMember`）。
   * 会话创建时判定过**不算数**：首席是角色，换人 / 软删 / 清空之后旧会话里的工具必须立刻失效。
   */
  const chiefOnly = (run: () => ChiefToolResult): ChiefToolResult =>
    isSecretaryMember(getMember(actorId)) ? run() : failure(CHIEF_ONLY_ERROR);

  const actorName = () => getMember(actorId)?.name ?? actorId;

  /**
   * 频道可达判定的唯一一处（三个读面 + 两个写面共用）：不存在 → 报错；actor 不是成员 → 报错。
   * 两条都是「拒绝」而不是「换个频道」（不静默改投）。
   */
  const channelAccessError = (channelId: string): string | null => {
    if (!getChannel(channelId)) return `Channel not found: ${channelId}`;
    if (!isChannelMember(channelId, actorId)) {
      return `The global chief is not a member of channel ${channelId}`;
    }
    return null;
  };

  const listChannelsTool: ToolDefinition = {
    name: "worksplice_list_channels",
    label: "List channels",
    description:
      "List the channels the global chief can see (public channels plus channels it belongs to). " +
      "Returns id, name, type, archived and memberCount only, at most `limit` rows (default 20, max 50). " +
      "Read-only.",
    promptSnippet: "List channels the chief can see (id, name, type, archived, memberCount)",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of channels to return (default 20, max 50)",
        },
      },
      additionalProperties: false,
    },
    // 注册 ≠ 激活：激活面由 CHIEF_TOOL_NAMES 显式点名（与路径守卫的同名覆盖同一条纪律）。
    defaultActive: false,
    execute: async (_toolCallId, input) =>
      chiefOnly(() => {
        const decision = decideListChannelsInput(input);
        if (!decision.ok) return failure(decision.error);
        const visible = listChannels().filter((channel) =>
          isChannelVisibleToActor(channel, isChannelMember(channel.id, actorId)),
        );
        return success({
          channels: visible
            .slice(0, decision.value.limit)
            .map((channel) => channelSummary(channel, listChannelMembers(channel.id).length)),
        });
      }),
  };

  const listMembersTool: ToolDefinition = {
    name: "worksplice_list_members",
    label: "List members",
    description:
      "List live agent members and the human owner (id, name, type, status). " +
      "With `channelId`, only that channel's members are returned and the chief must be a member of it. " +
      "Read-only.",
    promptSnippet: "List live agents and the owner (optionally for one channel)",
    parameters: {
      type: "object",
      properties: {
        channelId: {
          type: "string",
          description: "Restrict the list to this channel's members (the chief must be a member)",
        },
      },
      additionalProperties: false,
    },
    defaultActive: false,
    execute: async (_toolCallId, input) =>
      chiefOnly(() => {
        const decision = decideListMembersInput(input);
        if (!decision.ok) return failure(decision.error);
        const { channelId } = decision.value;
        if (channelId !== null) {
          const accessError = channelAccessError(channelId);
          if (accessError) return failure(accessError);
        }

        // 存活 agent 来自 listAgents（软删不在清单里）；Owner 是人类，单独补进来。
        // 给了 channelId 就按成员关系过滤——Owner 本身是每个频道的成员，所以照常出现。
        const owner = getMember(OWNER_MEMBER_ID);
        const everyone = owner && owner.deleted !== 1 ? [...listAgents(), owner] : listAgents();
        const rows =
          channelId === null
            ? everyone
            : everyone.filter((member) => isChannelMember(channelId, member.id));
        return success({ members: rows.map(memberSummary) });
      }),
  };

  const listTasksTool: ToolDefinition = {
    name: "worksplice_list_tasks",
    label: "List tasks",
    description:
      "List the tasks of one channel: number, status, ownerName and a 120-character preview only. " +
      'Optional `status` filter: "todo" | "in_progress" | "in_review" | "done" | "closed". ' +
      "The chief must be a member of the channel. Read-only.",
    promptSnippet: "List a channel's tasks (number, status, ownerName, preview)",
    parameters: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "Channel whose tasks to list" },
        status: {
          type: "string",
          enum: ["todo", "in_progress", "in_review", "done", "closed"],
          description: "Only return tasks in this status",
        },
      },
      required: ["channelId"],
      additionalProperties: false,
    },
    defaultActive: false,
    execute: async (_toolCallId, input) =>
      chiefOnly(() => {
        const decision = decideListTasksInput(input);
        if (!decision.ok) return failure(decision.error);
        const { channelId, status } = decision.value;
        const accessError = channelAccessError(channelId);
        if (accessError) return failure(accessError);
        const tasks = listChannelTasks(channelId).filter(
          (task) => status === null || task.status === status,
        );
        return success({ tasks: tasks.map(taskSummary) });
      }),
  };

  const channelCreateTool: ToolDefinition = {
    name: "worksplice_channel_create",
    label: "Create channel",
    description:
      "Create a channel and post one channel system event signed by the chief. " +
      "`type` is \"public\" (default) or \"private\"; a private channel must include the chief itself " +
      "in `memberIds` (the chief can only create channels it belongs to). `memberIds` accept live agent " +
      "members only. The channel service enforces the name rules (trimmed, non-empty, at most 32 characters).",
    promptSnippet: "Create a channel (public or private) as the global chief",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Channel name (trimmed, non-empty, at most 32 characters)" },
        type: { type: "string", enum: ["public", "private"], description: "Channel type (default public)" },
        description: { type: "string", description: "Optional channel description" },
        memberIds: {
          type: "array",
          items: { type: "string" },
          description: "Live agent member ids to add; required for private channels to include the chief",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    defaultActive: false,
    execute: async (_toolCallId, input) =>
      chiefOnly(() => {
        const decision = decideChannelCreateInput(input, actorId);
        if (!decision.ok) return failure(decision.error);
        // memberIds 的准入在写之前判：只允许存活 agent 成员（判据见 decisions.ts 的 memberIdRejection）。
        for (const memberId of decision.value.memberIds) {
          const rejection = memberIdRejection(getMember(memberId), memberId);
          if (rejection) return failure(rejection);
        }
        try {
          const channel = createChannel({
            name: decision.value.name,
            type: decision.value.type,
            ...(decision.value.description !== null ? { description: decision.value.description } : {}),
            memberIds: decision.value.memberIds,
          });
          notifyChiefSystemAction(
            channel.id,
            actorId,
            channelCreateEventContent(actorName(), channel.name),
          );
          return success(channelSummary(channel, listChannelMembers(channel.id).length));
        } catch (error) {
          return failure(reasonOf(error));
        }
      }),
  };

  const agentCreateTool: ToolDefinition = {
    name: "worksplice_agent_create",
    label: "Create agent",
    description:
      "Create one agent identity per session; it inherits the global default model " +
      "(no provider / modelId / thinkingLevel parameter is accepted). " +
      `\`name\` must match /${AGENT_NAME_PATTERN.source}/. ` +
      "On success a channel system event signed by the chief is posted to `channelId` (default #all); " +
      "the chief must be a member of it.",
    promptSnippet: "Create one `ops-*` agent identity per session (inherits the default model)",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: `Agent name: /${AGENT_NAME_PATTERN.source}/ (lowercase, hyphens, at most 32 characters)`,
        },
        description: { type: "string", description: "Optional agent description" },
        channelId: {
          type: "string",
          description: "Channel that receives the system event (default #all; the chief must be a member)",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    defaultActive: false,
    execute: async (_toolCallId, input) =>
      chiefOnly(() => {
        const decision = decideAgentCreateInput(input);
        if (!decision.ok) return failure(decision.error);
        if (quota.isExhausted()) return failure(AGENT_CREATE_QUOTA_ERROR);

        // 缺省目标 = #all；给了 channelId 就必须可达（不静默改投到别处）。
        const channelId = decision.value.channelId ?? BUILTIN_CHANNEL_ID;
        const accessError = channelAccessError(channelId);
        if (accessError) return failure(accessError);

        try {
          const agent = createAgent({
            name: decision.value.name,
            ...(decision.value.description !== null ? { description: decision.value.description } : {}),
            // 显式 null：新身份继承全局默认模型，首席不得指定 provider / model。
            provider: null,
            modelId: null,
          });
          // 只在成功之后记账：失败（重名 / 参数 / 权限）不消耗配额。
          quota.recordSuccess();
          notifyChiefSystemAction(channelId, actorId, agentCreateEventContent(actorName(), agent.name));
          return success(memberSummary(agent));
        } catch (error) {
          return failure(reasonOf(error));
        }
      }),
  };

  const definitions: ToolDefinition[] = [
    listChannelsTool,
    listMembersTool,
    listTasksTool,
    channelCreateTool,
    agentCreateTool,
  ];
  assertPolicyCoverage(definitions);
  return definitions;
}

/**
 * 注册面与激活面必须逐字对齐（`CHIEF_DOMAIN_TOOL_NAMES` 是唯一来源）。
 *
 * 对不齐的后果是**静默**的：定义注册了但名字不在激活清单里 → 工具永远不可用；反过来
 * 激活清单里写了个没注册的名字 → 调用时报 tool not found。这两种都不是崩溃，只是「半开」，
 * 而这是给 agent 开系统操作权限的口子——半开也要当缺陷。于是注册那一刻就抛。
 */
function assertPolicyCoverage(definitions: readonly ToolDefinition[]): void {
  const names = definitions.map((definition) => definition.name);
  const missing = CHIEF_DOMAIN_TOOL_NAMES.filter((name) => !names.includes(name));
  const extra = names.filter((name) => !CHIEF_DOMAIN_TOOL_NAMES.includes(name));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `chief tool surface drifted from CHIEF_DOMAIN_TOOL_NAMES: missing [${missing.join(", ")}], ` +
        `extra [${extra.join(", ")}]`,
    );
  }
}

/** 内联扩展名；`builtin:` 前缀使它在诊断里读起来就是 worksplice 自己的东西。 */
export const CHIEF_TOOL_EXTENSION = "builtin:worksplice-chief-tools";

/** 注册五个领域工具（扩展工厂执行体）。 */
export function registerChiefTools(pi: ExtensionAPI, options: ChiefToolsOptions): void {
  for (const definition of chiefToolDefinitions(options)) pi.registerTool(definition);
}

/**
 * `resourceLoaderOptions.extensionFactories` 的 `InlineExtension` 条目；hidden 不进扩展列表。
 * 只在首席会话里挂（`lib/rpc/caller.ts` 按 `domainTools` 在场与否决定），非首席**不注册**。
 */
export function chiefToolsExtension(options: ChiefToolsOptions): {
  name: string;
  factory: ExtensionFactory;
  hidden: boolean;
} {
  const factory: ExtensionFactory = (pi) => registerChiefTools(pi, options);
  return {
    name: CHIEF_TOOL_EXTENSION,
    factory,
    hidden: true,
  };
}
