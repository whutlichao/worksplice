import { NextResponse } from "next/server";
import {
  CURRENT_MEMBER_ID,
  getChannel,
  listChannelMembers,
  listChannelMutes,
  muteChannel,
  unmuteChannel,
} from "@/lib/raft/channels";

/**
 * §3.2 mute 路由组：
 * - GET  —— channel 内全部 agent 成员的静音状态（UI mute 面板用，含未静音成员）；
 * - POST —— { memberId, muted } 静音/取消静音（Owner 可替任意 agent 设，§3.6 托管语义）。
 * 静音后普通消息不进该 agent 的 inbox，个人 @mention 仍穿透（§3.8）。
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const channel = getChannel(id);
    if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    const mutes = new Map(listChannelMutes(id).map((m) => [m.memberId, m]));
    const mutesFor = listChannelMembers(id)
      .filter((member) => member.type === "agent")
      .map((member) => {
        const mute = mutes.get(member.id);
        return {
          memberId: member.id,
          name: member.name,
          muted: Boolean(mute),
          muteFromSeq: mute?.muteFromSeq ?? 0,
        };
      });
    return NextResponse.json({ mutes: mutesFor });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await req.json().catch(() => ({}))) as { memberId?: string; muted?: boolean };
    if (!body.memberId) {
      return NextResponse.json({ error: "memberId is required" }, { status: 400 });
    }
    const muted = body.muted !== false;
    const actorId = CURRENT_MEMBER_ID;
    if (muted) {
      const mute = muteChannel(id, body.memberId, actorId);
      return NextResponse.json({ memberId: mute.memberId, muted: true, muteFromSeq: mute.muteFromSeq });
    }
    unmuteChannel(id, body.memberId, actorId);
    return NextResponse.json({ memberId: body.memberId, muted: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Channel not found" || message === "Member not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
