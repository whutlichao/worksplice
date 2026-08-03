import { NextResponse } from "next/server";
import { sendMessage, getMessageWithAuthor } from "@/lib/raft/messages";
import { CURRENT_MEMBER_ID } from "@/lib/raft/channels";

/**
 * 发送消息（§5.7 POST /api/messages）：freshness 校验（§6.3）。
 * body: { targetId, content, baseSeq?, quoteId? } — targetId 为 channel id 或 thread 锚点消息 id。
 * baseSeq 不匹配时返回 409 held（§3.3 四选一的触发面）。
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      targetId?: unknown;
      content?: unknown;
      baseSeq?: unknown;
      quoteId?: unknown;
    };
    if (typeof body.targetId !== "string" || !body.targetId) {
      return NextResponse.json({ error: "targetId is required" }, { status: 400 });
    }
    if (typeof body.content !== "string" || !body.content.trim()) {
      return NextResponse.json({ error: "Message content is required" }, { status: 400 });
    }
    const result = sendMessage({
      targetId: body.targetId,
      authorId: CURRENT_MEMBER_ID,
      content: body.content,
      baseSeq: typeof body.baseSeq === "number" ? body.baseSeq : undefined,
      quoteId: typeof body.quoteId === "string" && body.quoteId ? body.quoteId : undefined,
    });
    if (result.held) {
      return NextResponse.json(
        { held: true, roomSeq: result.roomSeq, whatHappened: result.whatHappened },
        { status: 409 },
      );
    }
    return NextResponse.json({ message: getMessageWithAuthor(result.message.id) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
