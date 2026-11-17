import { NextResponse } from "next/server";
import {
  CURRENT_MEMBER_ID,
  chiefRefOf,
  resolveEffectiveChief,
  setChannelChief,
} from "@/lib/domain/collab";
import { jsonError } from "@/lib/domain/errors";

/**
 * POST /api/channels/[id]/chief（票 #250）：Owner 设置 / 清除频道首席。
 * 薄封装：只校验入参形态并把服务层结果（含生效首席）翻译成响应；绑定校验、Owner 权限
 * 与「不留半条绑定」都在协作域（`setChannelChief`）里。
 *
 * 响应用一个形状给全三件事：绑定本身（`chiefMemberId`）、此刻生效的首席（`chief`）
 * 与它的来源（`chiefSource`）——UI 不在客户端按绑定重新推导。
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object" || !("memberId" in body)) {
      return NextResponse.json({ error: "memberId is required" }, { status: 400 });
    }
    const memberId = (body as { memberId: unknown }).memberId;
    if (memberId !== null && (typeof memberId !== "string" || memberId.trim() === "")) {
      return NextResponse.json(
        { error: "memberId must be a non-empty string or null" },
        { status: 400 },
      );
    }

    const channel = setChannelChief(id, memberId, CURRENT_MEMBER_ID);
    const { chief, source } = resolveEffectiveChief(channel.id);
    return NextResponse.json({
      channelId: channel.id,
      chiefMemberId: channel.chief_member_id,
      chief: chiefRefOf(chief),
      chiefSource: source,
    });
  } catch (error) {
    return jsonError(error);
  }
}
