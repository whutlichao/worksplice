import { getDb } from "../../data/db-singleton.ts";
import { getChannel, isChannelMember, resolveChannelForTarget } from "./channels.ts";
import { getMember } from "./members.ts";
import type { ChannelRow, MemberRow, SearchResult } from "../../data/types.ts";

export const MAX_SEARCH_LIMIT = 50;

/**
 * §6.4 搜索结果：id + 命中上下文摘要（<mark> 高亮）+ 归属（channel/thread）+ 作者。
 * UI "打开消息"动作 = 深链 #c/<channelId>?m=<messageId>，thread 消息自动展开其线程。
 */
export interface MessageSearchHit extends SearchResult {
  /** 消息归属 channel（thread 消息经锚点消息解析，§6.1）；孤儿 target 为 null。 */
  channel: ChannelRow | null;
  author: MemberRow | null;
  /** true = thread 消息（target_id 是锚点消息 id 而非 channel id，§6.1 归一化约定）。 */
  inThread: boolean;
}

/** 全文搜索（§5.7 search 路由组 / §6.4）：空查询返回 []，limit 收敛到 [1, MAX_SEARCH_LIMIT]。
 *  传 memberId（成员面：loop 的 search op）→ 只返回**该成员所在频道**的命中——调用者的可见面
 *  由它的成员资格决定，不由请求头自述（ADR-0013 决策一的「不提升调用者权限」）；
 *  不传（人类面：GET /api/search）→ Owner 语义，行为与今天一致。 */
export function searchMessages(
  query: string,
  opts: { limit?: number; memberId?: string } = {},
): MessageSearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const raw = opts.limit ?? 20;
  const limit = Number.isFinite(raw) ? Math.min(Math.max(1, Math.floor(raw)), MAX_SEARCH_LIMIT) : 20;
  // 调用者作用域在 DB 的 LIMIT 之后过滤（不可见的频道挤占名额也不能放宽可见性）。
  // 为了不让「看不见的命中」把应得条数提前耗尽，有作用域时先取到既有上限（MAX_SEARCH_LIMIT）
  // 再过滤、最后切片——比“多取一点”确定，且不引入新的 SQL 面（代价：非成员命中 >50 条时
  // 成员仍可能少拿几条；宁少不泄，记在票据残留里）。
  const fetchLimit = opts.memberId ? MAX_SEARCH_LIMIT : limit;
  const hits = getDb()
    .searchMessages(q, fetchLimit)
    .map((hit) => ({
      ...hit,
      channel: resolveChannelForTarget(hit.target_id) ?? null,
      author: getMember(hit.author_id) ?? null,
      inThread: getChannel(hit.target_id) === undefined,
    }))
    .filter(
      (hit) =>
        !opts.memberId ||
        (hit.channel ? isChannelMember(hit.channel.id, opts.memberId) : false),
    );
  return hits.slice(0, limit);
}
