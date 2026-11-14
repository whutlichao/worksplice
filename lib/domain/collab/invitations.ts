import { getDb } from "../../data/db-singleton.ts";
import { hasAllMention } from "../../mention.ts";
import { listChannelMembers, resolveChannelForTarget } from "./channels.ts";
import { extractMentionedMemberIds, getMember } from "./members.ts";

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
  /** 本条消息实际邀请的 agent（去重；任务 owner 续工也在这里）。 */
  candidates: string[];
}

const EMPTY: MessageInvitations = { all: false, mentioned: [], candidates: [] };

/** Owner 任务创建事件正文（与 loop 的自动路由同一格式）。 */
export function parseTaskCreationEventNumber(content: string): number | null {
  const match = /^Task #(\d+) created(?: — (.*))?$/.exec(content);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) ? number : null;
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

  return { all, mentioned, candidates: [...candidates] };
}
