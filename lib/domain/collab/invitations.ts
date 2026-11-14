import { getDb } from "../../data/db-singleton.ts";
import { hasAllMention } from "../../mention.ts";
import { listChannelMembers, resolveChannelForTarget } from "./channels.ts";
import { resolveEffectiveChief } from "./chief.ts";
import { extractMentionedMemberIds, getMember } from "./members.ts";
import type { ChannelRow } from "../../data/types.ts";

/**
 * 一条消息产生的新邀请（Ticket #237）：
 * - 只有人类正文点名 / `@all` 才邀人；引用块、代码块、行内代码里的 @ 不算；
 * - 普通 agent 正文 @ 不新增候选、不穿透；
 * - 任务线程里，in_progress / in_review 的 owner 自动续工（可归属任务），
 *   reopened 则清空候选（只允许人类接管）。
 *
 * `beginTurn` 与 wake 分发共用这一份判定，避免「场次选了谁」与「唤醒了谁」漂移。
 */
export interface MessageInvitations {
  /** 正文里出现 `@all` / `@everyone`。 */
  all: boolean;
  /** 正文点名的 agent（含未加入频道者——人类点名可穿透）。 */
  mentioned: string[];
  /** 本条消息实际邀请的 agent（去重；任务 owner 续工与默认首席也在这里）。 */
  candidates: string[];
  /** 本条消息接住它的生效首席（#248）；不是首席轮时为 null。 */
  chief: string | null;
}

const EMPTY: MessageInvitations = {
  all: false,
  mentioned: [],
  candidates: [],
  chief: null,
};

/** Owner 任务创建事件正文（与 loop 的自动路由同一格式）。 */
export function parseTaskCreationEventNumber(content: string): number | null {
  const match = /^Task #(\d+) created(?: — (.*))?$/.exec(content);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) ? number : null;
}

/**
 * 一条人类消息是否由生效首席默认接住（#248）：只在那四条已有路径全部不成立时成立——
 * 非 DM、无个人点名、无 `@all`、不涉及任务（不是任务线程、不是 `Task #N created` 创建事件）。
 * 首席在本频道不可用（已软删 / 不是该频道 agent 成员 / 静音了该频道）⇒ null
 * （「没有可用首席」与「没有首席」同义：不换人、不兜底广播）。
 *
 * 判定住在这里，是因为它复用与邀请候选同一份点名 / 任务解析；`beginTurn`、wake
 * 与 agent-loop 的准入都调它，不另开第二条选人路径。
 */
export function selectChiefRecipient(input: {
  channel: ChannelRow;
  targetId: string;
  content: string;
}): string | null {
  if (input.channel.type === "dm") return null;
  if (hasAllMention(input.content)) return null;
  const namesAnAgent = extractMentionedMemberIds(input.content).some(
    (memberId) => getMember(memberId)?.type === "agent",
  );
  if (namesAnAgent) return null;
  if (getDb().getTaskByMessageId(input.targetId)) return null;
  if (parseTaskCreationEventNumber(input.content) !== null) return null;

  const { chief } = resolveEffectiveChief(input.channel.id);
  if (!chief || chief.type !== "agent") return null;
  if (!getDb().isChannelMember(input.channel.id, chief.id)) return null;
  if (getDb().getChannelMute(input.channel.id, chief.id)) return null;
  return chief.id;
}

export function selectMessageInvitations(input: {
  targetId: string;
  authorId: string;
  content: string;
}): MessageInvitations {
  const channel = resolveChannelForTarget(input.targetId);
  if (!channel) return EMPTY;
  const author = getMember(input.authorId);
  if (!author || author.type !== "human") return EMPTY;

  const all = hasAllMention(input.content);
  const mentioned = extractMentionedMemberIds(input.content).filter(
    (memberId) => memberId !== author.id && getMember(memberId)?.type === "agent",
  );
  const mentionedCandidates = new Set<string>();
  if (all) {
    for (const member of listChannelMembers(channel.id)) {
      if (member.type === "agent" && member.id !== author.id) {
        mentionedCandidates.add(member.id);
      }
    }
  } else {
    for (const memberId of mentioned) mentionedCandidates.add(memberId);
  }

  const task = getDb().getTaskByMessageId(input.targetId);
  const candidates = new Set<string>();
  if (task) {
    if (task.reopened === 1) {
      // reopened：只允许人类接管，agent 一律不邀。
    } else if (task.status === "in_progress") {
      // owner 续工轮：非 owner 一律不邀（人类点名也不放开）。
      if (
        task.owner_id &&
        task.owner_id !== author.id &&
        getMember(task.owner_id)?.type === "agent"
      ) {
        candidates.add(task.owner_id);
      }
    } else if (task.status === "in_review") {
      // owner 可继续；reviewer 只由人类正文点名 / @all 邀。
      if (
        task.owner_id &&
        task.owner_id !== author.id &&
        getMember(task.owner_id)?.type === "agent"
      ) {
        candidates.add(task.owner_id);
      }
      for (const memberId of mentionedCandidates) candidates.add(memberId);
    } else {
      // todo / done / closed：没有自动 owner 轮次，只认人类点名。
      for (const memberId of mentionedCandidates) candidates.add(memberId);
    }
  } else {
    for (const memberId of mentionedCandidates) candidates.add(memberId);
  }

  // #248：四条已有路径都不成立时，生效首席接住这条消息（点名轮不额外追加首席）。
  const chief = selectChiefRecipient({
    channel,
    targetId: input.targetId,
    content: input.content,
  });
  if (chief) candidates.add(chief);

  return { all, mentioned, candidates: [...candidates], chief };
}
