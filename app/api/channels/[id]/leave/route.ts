import { NextResponse } from "next/server";
import { leaveChannel, getChannel, CURRENT_MEMBER_ID } from "@/lib/raft/channels";

/** 离开 channel（§3.2）：成员自离或 Owner 移除；`#all` 不可离开。 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    if (!getChannel(id)) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    const body = (await request.json().catch(() => ({}))) as { memberId?: unknown };
    const memberId = typeof body.memberId === "string" && body.memberId ? body.memberId : CURRENT_MEMBER_ID;
    leaveChannel(id, memberId, CURRENT_MEMBER_ID);
    return NextResponse.json({ left: true, memberId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
