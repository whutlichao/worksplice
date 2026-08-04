import { NextResponse } from "next/server";
import { CURRENT_MEMBER_ID } from "@/lib/raft/channels";
import { pinMessage, unpinMessage, listPinned, type PinSortMode } from "@/lib/raft/pinned";

/**
 * §3.5 个性化 pinned 区（channel 头部可展开）：
 * GET  ?sort=manual|recent|az → 当前成员在该 channel 的 pinned 列表；
 * POST { messageId }          → pin（幂等，重复 pin 返回既有行）；
 * DELETE ?messageId=          → unpin（幂等）。
 * 权限/存在性校验由服务层强制（lib/raft/pinned.ts），route 仅薄封装。
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const sortRaw = url.searchParams.get("sort");
    const sort: PinSortMode = sortRaw === "recent" || sortRaw === "az" ? sortRaw : "manual";
    const pinned = listPinned({ channelId: id, memberId: CURRENT_MEMBER_ID, sort });
    return NextResponse.json({ pinned });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { messageId?: unknown };
    if (typeof body.messageId !== "string" || !body.messageId) {
      return NextResponse.json({ error: "messageId is required" }, { status: 400 });
    }
    const row = pinMessage({ channelId: id, messageId: body.messageId, memberId: CURRENT_MEMBER_ID });
    return NextResponse.json({ pinned: row }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const messageId = url.searchParams.get("messageId");
    if (!messageId) return NextResponse.json({ error: "messageId is required" }, { status: 400 });
    const removed = unpinMessage({ channelId: id, messageId, memberId: CURRENT_MEMBER_ID });
    return NextResponse.json({ unpinned: removed });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
