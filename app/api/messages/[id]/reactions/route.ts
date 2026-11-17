import { NextResponse } from "next/server";
import { toggleReaction, listReactionSummaries, getMessageWithAuthor, CURRENT_MEMBER_ID } from "@/lib/domain/collab";
import { jsonError } from "@/lib/domain/errors";

/**
 * §3.4 reaction 读写：
 * GET  → 该消息的 reaction 聚合（count 降序 + 成员 id）；消息不存在 404；
 * POST { emoji } → 切换（存在即删，再次点击取消），返回切换后的完整聚合。
 * 无需通知 / 无需进入 inbox（§3.4）。
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    getMessageWithAuthor(id);
    const reactions = listReactionSummaries(id);
    return NextResponse.json({ reactions });
  } catch (error) {
    return jsonError(error, 404);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { emoji?: unknown };
    const result = toggleReaction({
      messageId: id,
      memberId: CURRENT_MEMBER_ID,
      emoji: typeof body.emoji === "string" ? body.emoji : "",
    });
    return NextResponse.json({ ...result, reactions: listReactionSummaries(id) });
  } catch (error) {
    return jsonError(error, 400);
  }
}
