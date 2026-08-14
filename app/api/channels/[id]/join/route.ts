import { NextResponse } from "next/server";
import { joinChannel, getChannel, CURRENT_MEMBER_ID } from "@/lib/domain/raft";

/** 加入 channel（§3.2）：公开自由加入；私有由 Owner 加成员。默认代表当前人类用户（Owner）。 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    if (!getChannel(id)) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    const body = (await request.json().catch(() => ({}))) as { memberId?: unknown };
    const memberId = typeof body.memberId === "string" && body.memberId ? body.memberId : CURRENT_MEMBER_ID;
    joinChannel(id, memberId, CURRENT_MEMBER_ID);
    return NextResponse.json({ joined: true, memberId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
