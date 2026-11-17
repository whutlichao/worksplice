import { NextResponse } from "next/server";
import { CURRENT_MEMBER_ID, setPinnedOrder } from "@/lib/domain/collab";
import { jsonError } from "@/lib/domain/errors";

/** §3.5 Manual 排序：POST { order: [messageId, ...] } 按顺序重排当前成员的 pinned。 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { order?: unknown };
    const order = Array.isArray(body.order) ? body.order.filter((x): x is string => typeof x === "string") : [];
    setPinnedOrder({ channelId: id, memberId: CURRENT_MEMBER_ID, order });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error, 400);
  }
}
