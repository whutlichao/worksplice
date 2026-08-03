import { NextResponse } from "next/server";
import { getChannel } from "@/lib/raft/channels";
import { getDb } from "@/lib/raft/db-singleton";
import { getMember } from "@/lib/raft/members";

/** 只读消息流（§5.7 messages 组）；写入/thread 属 ticket 04。 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const channel = getChannel(id);
    if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    const messages = getDb().listMessages(id).map((m) => ({
      ...m,
      author: getMember(m.author_id) ?? null,
    }));
    return NextResponse.json({ messages });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
