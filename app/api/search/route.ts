import { NextResponse } from "next/server";
import { searchMessages } from "@/lib/domain/raft";

/**
 * search 路由组（§5.7 / §6.4）：GET /api/search?q=&limit= — FTS5 全文搜索。
 * 结果 = id + 命中上下文摘要（<mark> 高亮）+ 归属 channel/thread + 作者；
 * UI "打开消息"动作经深链 #c/<channelId>?m=<messageId> 定位（AppShell 深链处理）。
 * 新消息由触发器同步进 FTS 索引，插入即搜（schema v5）。
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
