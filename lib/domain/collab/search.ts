import { getDb } from "../../data/db-singleton.ts";
import { getChannel, isChannelMember, resolveChannelForTarget } from "./channels.ts";
import { getMember } from "./members.ts";
import {
  MAX_ARCHIVE_SEARCH_LIMIT,
  searchArchivedSessionEntries,
} from "../../session-archive.ts";
import type {
  ChannelRow,
  MemberRow,
  SearchResult,
  SessionArchiveSearchHit,
} from "../../data/types.ts";

export const MAX_SEARCH_LIMIT = 50;

/**
 * §6.4 搜索结果：id + 命中上下文摘要（<mark> 高亮）+ 归属（channel/thread）+ 作者。
 * UI "打开消息"动作 = 深链 #c/<channelId>?m=<messageId>，thread 消息自动展开其线程。
 */
export interface MessageSearchHit extends SearchResult {
  /** 来源判别（上下文治理票 07）：消息命中恒为 "message"，与归档命中同列返回。 */
  source: "message";
  /** 消息归属 channel（thread 消息经锚点消息解析，§6.1）；孤儿 target 为 null。 */
  channel: ChannelRow | null;
  author: MemberRow | null;
  /** true = thread 消息（target_id 是锚点消息 id 而非 channel id，§6.1 归一化约定）。 */
  inThread: boolean;
}

/**
 * 归档会话原文命中（上下文治理票 07，spec B2/B3）：票 06 的索引定位列原样携带
 * （archive_id / source_path / entry_index / entry_type，可定位到具体归档会话与条目），
 * snippet 与消息命中同一 buildSearchSnippet 口径（<mark> 高亮 + HTML 转义）。
 */
export interface ArchiveSearchHit extends SessionArchiveSearchHit {
  /** 来源判别（票 07）：归档命中恒为 "archive"，消费面据此标注「来自归档会话」。 */
  source: "archive";
  /** 归档归属 agent（索引只有 agent_id，解析成员名供消费面呈现；成员行缺失时为 null）。 */
  agent: MemberRow | null;
}

/** 检索结果 = 消息命中 | 归档命中：两个来源同列返回，靠 `source` 判别（票 07）。 */
export type SearchHit = MessageSearchHit | ArchiveSearchHit;

/** 全文搜索（§5.7 search 路由组 / §6.4）：空查询返回 []，limit 收敛到 [1, MAX_SEARCH_LIMIT]。
 *  传 memberId（成员面：loop 的 search op）→ 只返回**该成员所在频道**的命中——调用者的可见面
 *  由它的成员资格决定，不由请求头自述（ADR-0013 决策一的「不提升调用者权限」）；
 *  不传（人类面：GET /api/search）→ Owner 语义，行为与今天一致。
 *
 *  上下文治理票 07 扩面（spec B2/B3/D2/D3）：同一入口同时检索消息正文与归档会话原文
 *  （票 06 的 session_archive_index，含 compact summary——summary 不单独建面）。
 *  归档命中的权限语义：归档索引行只有 agent_id 归属、没有频道维度，因此按「归档副本归属
 *  该 agent 私有」（D1/B7）过滤——成员面只命中**该成员自己的归档**，owner 面无过滤
 *  （Owner 语义不变）；不新增 ACL 层、不按 workspace 分区、不做全库可检索。
 *  结果顺序与 limit：两来源**交替合并**（各自内部顺序不变）——任一来源的命中都不会被
 *  另一来源整体挤出 limit 名额（否则 owner 默认 limit=20 时，消息命中占满后归档命中永不可达）；
 *  limit 收口合并后的总条数；两来源都沿用「在 DB LIMIT 之后过滤」的宁少不泄语义（作用域命中
 *  超过取数上限时可能少拿，不可见内容绝不会多拿）。 */
export function searchMessages(
  query: string,
  opts: { limit?: number; memberId?: string } = {},
): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const raw = opts.limit ?? 20;
  const limit = Number.isFinite(raw) ? Math.min(Math.max(1, Math.floor(raw)), MAX_SEARCH_LIMIT) : 20;
  // 调用者作用域在 DB 的 LIMIT 之后过滤（不可见的频道挤占名额也不能放宽可见性）。
  // 为了不让「看不见的命中」把应得条数提前耗尽，有作用域时先取到既有上限（MAX_SEARCH_LIMIT）
  // 再过滤、最后切片——比“多取一点”确定，且不引入新的 SQL 面（代价：非成员命中 >50 条时
  // 成员仍可能少拿几条；宁少不泄，记在票据残留里）。
  const fetchLimit = opts.memberId ? MAX_SEARCH_LIMIT : limit;
  const messageHits: MessageSearchHit[] = getDb()
    .searchMessages(q, fetchLimit)
    .map((hit) => ({
      ...hit,
      source: "message" as const,
      channel: resolveChannelForTarget(hit.target_id) ?? null,
      author: getMember(hit.author_id) ?? null,
      inThread: getChannel(hit.target_id) === undefined,
    }))
    .filter(
      (hit) =>
        !opts.memberId ||
        (hit.channel ? isChannelMember(hit.channel.id, opts.memberId) : false),
    );
  // 归档面：与消息面同一处置——有作用域时先取到归档上限再按归属过滤（宁少不泄）；
  // 成员面只命中自己的归档（归档副本私有），owner 面全量。
  const archiveFetchLimit = opts.memberId ? MAX_ARCHIVE_SEARCH_LIMIT : limit;
  const archiveHits: ArchiveSearchHit[] = searchArchivedSessionEntries(q, {
    limit: archiveFetchLimit,
  })
    .filter((hit) => !opts.memberId || hit.agent_id === opts.memberId)
    .map((hit) => ({
      ...hit,
      source: "archive" as const,
      agent: getMember(hit.agent_id) ?? null,
    }));
  // 交替合并（见函数头「结果顺序与 limit」）：两来源都不被对方挤出名额，limit 收口总条数。
  const merged: SearchHit[] = [];
  const total = Math.max(messageHits.length, archiveHits.length);
  for (let index = 0; index < total && merged.length < limit; index += 1) {
    if (index < messageHits.length) merged.push(messageHits[index]);
    if (merged.length < limit && index < archiveHits.length) merged.push(archiveHits[index]);
  }
  return merged;
}
