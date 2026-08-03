import { NextResponse } from "next/server";
import { getChannel } from "@/lib/raft/channels";
import { listMessages, getMessageWithAuthor } from "@/lib/raft/messages";

/**
 * 消息流读取（§5.7）：channel 消息与 thread 消息共用同一路由——
 * `targetId` 省略时为该 channel 本身，否则必须为该 channel 内的顶层消息（thread 锚点）。
 * seq 游标分页：`before` = 上次返回的最早 seq（不含），`limit` 默认 50。
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const channel = getChannel(id);
    if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });

    const url = new URL(_request.url);
    const targetId = url.searchParams.get("targetId") ?? id;
    if (targetId !== id) {
      const anchor = getMessageWithAuthor(targetId);
      if (anchor.target_id !== id) {
        return NextResponse.json({ error: "Message does not belong to this channel" }, { status: 400 });
      }
    }
    const beforeRaw = url.searchParams.get("before");
    const limitRaw = url.searchParams.get("limit");
    const beforeNum = beforeRaw === null ? undefined : Number(beforeRaw);
    const limitNum = limitRaw === null ? undefined : Number(limitRaw);
    const before = beforeNum !== undefined && Number.isFinite(beforeNum) ? beforeNum : undefined;
    const limit = limitNum !== undefined && Number.isFinite(limitNum) ? limitNum : undefined;

    const page = listMessages(targetId, { before, limit });
    return NextResponse.json({
      targetId,
      targetKind: targetId === id ? "channel" : "thread",
      ...page,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
