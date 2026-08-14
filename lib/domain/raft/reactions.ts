import { getDb } from "../../data/db-singleton.ts";
import { resolveChannelForTarget, isChannelMember } from "./channels.ts";
import type { MessageRow } from "../../data/types.ts";

const MAX_EMOJI_LENGTH = 32;

/** §3.4 某 emoji 的聚合：count + 参与成员（UI 用 memberIds 判定"我是否已点"）。 */
export interface ReactionSummary {
  emoji: string;
  count: number;
  memberIds: string[];
}

function assertReactable(messageId: string): { message: MessageRow; channelId: string } {
  const message = getDb().getMessage(messageId);
  if (!message) throw new Error("Message not found");
  // thread 消息经其锚点（message.target_id）解析归属 channel
  const channel = resolveChannelForTarget(message.target_id);
  if (!channel) throw new Error("Message not found");
  return { message, channelId: channel.id };
}

function assertEmoji(emoji: string): string {
  const trimmed = emoji.trim();
  if (!trimmed) throw new Error("emoji is required");
  if (trimmed.length > MAX_EMOJI_LENGTH) throw new Error("emoji is too long");
  return trimmed;
}

/**
 * 切换 reaction（§3.4）：存在即删（再次点击取消），不存在即加。
 * 同一成员同一消息同一 emoji 唯一（UNIQUE 约束由先查后写保证，无并发竞争——单进程串行事务）。
 * 无需通知 / 无需进入 inbox（§3.4）。
 */
export function toggleReaction(input: {
  messageId: string;
  memberId: string;
  emoji: string;
}): { active: boolean } {
  const emoji = assertEmoji(input.emoji);
  const { message, channelId } = assertReactable(input.messageId);
  if (!isChannelMember(channelId, input.memberId)) {
    throw new Error("You are not a member of this channel");
  }
  const active = getDb().withTransaction(() => {
    if (getDb().hasReaction(message.id, input.memberId, emoji)) {
      getDb().deleteReaction(message.id, input.memberId, emoji);
      return false;
    }
    getDb().insertReaction({ messageId: message.id, memberId: input.memberId, emoji });
    return true;
  });
  return { active };
}

/** §3.4 消息的 reaction 聚合（按 count 降序，同 count 按首次出现序）。 */
export function listReactionSummaries(messageId: string): ReactionSummary[] {
  const rows = getDb().listReactions(messageId);
  const byEmoji = new Map<string, ReactionSummary>();
  for (const row of rows) {
    let summary = byEmoji.get(row.emoji);
    if (!summary) {
      summary = { emoji: row.emoji, count: 0, memberIds: [] };
      byEmoji.set(row.emoji, summary);
    }
    summary.count += 1;
    summary.memberIds.push(row.member_id);
  }
  return [...byEmoji.values()].sort((a, b) => b.count - a.count);
}
