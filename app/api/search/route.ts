import { NextResponse } from "next/server";
import { searchMessages } from "@/lib/domain/collab";

/**
 * search 路由组（§5.7 / §6.4）：GET /api/search?q=&limit= — FTS5 全文搜索。
 * 结果 = 命中上下文摘要（<mark> 高亮）+ 归属；消息命中带 channel/thread + 作者，UI "打开消息"动作
 * 经深链 #c/<channelId>?m=<messageId> 定位（AppShell 深链处理）。新消息由触发器同步进 FTS 索引，
 * 插入即搜（schema v5）。
 * 上下文治理票 07：同一入口扩到归档会话原文（含 compact summary）——归档命中携带 archive_id /
 * 条目定位 / agent 归属（服务层 searchMessages 合并），本路由是薄封装、两来源同列透传。
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    if (!q) {
      return NextResponse.json({ error: "Search query is required" }, { status: 400 });
    }
    const rawLimit = Number(url.searchParams.get("limit") ?? "20");
    const limit = Number.isFinite(rawLimit) ? rawLimit : 20;
    return NextResponse.json({
      query: q,
      results: searchMessages(q, { limit }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
