import { NextResponse } from "next/server";
import { markChannelRead, getChannel } from "@/lib/domain/collab";

/**
 * POST /api/channels/[id]/read（BAI-6 未读角标）：
 * 把 Owner 在该频道的已读游标推进到当前 max(seq)，清除未读角标。
 * 打开频道 / 窗口聚焦到该频道时调用；幂等（游标只前进）。
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!getChannel(id)) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    const maxSeq = markChannelRead(id);
    return NextResponse.json({ readSeq: maxSeq });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
