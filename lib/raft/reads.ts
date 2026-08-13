import { getDb } from "./db-singleton.ts";
import { getChannel } from "./channels.ts";
import { OWNER_MEMBER_ID } from "../data/schema.ts";

/**
 * BAI-6 频道未读角标：Owner 对每个频道的已读游标 + 未读数。
 *
 * 语义：
 * - 已读游标（channel_reads.read_seq）= 该成员在频道内已读到的最大 seq（打开频道即推进）。
 * - 未读数 = 频道内「作者非本人且 seq > read_seq」的消息数（自己的消息不算未读）。
 * - 本特性只对 Owner（本地单机的人类用户）有意义——agent 侧 inbox/游标语义由 consumed_seqs 承担，
 *   频道已读游标不参与 agent 的唤醒/drain 判定，是纯 UI 呈现层状态。
 */

/** BAI-6 当前未读计数：本地单机形态下未读角标只针对 Owner。 */
export function unreadCount(channelId: string, memberId = OWNER_MEMBER_ID): number {
  if (!getChannel(channelId)) return 0;
  return getDb().countUnreadChannelMessages(memberId, channelId);
}

/**
 * BAI-6 标记频道已读：把成员在该频道的已读游标推进到当前 max(seq)。
 * 幂等（游标只前进，不会回退）；channel 不存在时静默（打开期间被删除的场景）。
 */
export function markChannelRead(channelId: string, memberId = OWNER_MEMBER_ID): number {
  if (!getChannel(channelId)) return 0;
  const maxSeq = getDb().maxSeq(channelId);
  getDb().setChannelReadSeq(memberId, channelId, maxSeq);
  return maxSeq;
}

/** BAI-6 侧栏角标：列出所有频道并附 Owner 的未读数。 */
export function listChannelsWithUnread(): Array<{ channelId: string; unread: number }> {
  return getDb()
    .listChannels()
    .map((channel) => ({ channelId: channel.id, unread: unreadCount(channel.id) }));
}
