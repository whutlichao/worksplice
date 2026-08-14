import { getDb } from "../../data/db-singleton.ts";
import { getChannel, resolveChannelForTarget } from "./channels.ts";
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

/** 全文搜索（§5.7 search 路由组 / §6.4）：空查询返回 []，limit 收敛到 [1, MAX_SEARCH_LIMIT]。 */
export function searchMessages(query: string, opts: { limit?: number } = {}): MessageSearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const raw = opts.limit ?? 20;
  const limit = Number.isFinite(raw) ? Math.min(Math.max(1, Math.floor(raw)), MAX_SEARCH_LIMIT) : 20;
  return getDb().searchMessages(q, limit).map((hit) => ({
    ...hit,
    channel: resolveChannelForTarget(hit.target_id) ?? null,
    author: getMember(hit.author_id) ?? null,
    inThread: getChannel(hit.target_id) === undefined,
  }));
}
