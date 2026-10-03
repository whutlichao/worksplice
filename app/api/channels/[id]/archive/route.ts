import { NextResponse } from "next/server";
import { setChannelArchived, getChannel, CURRENT_MEMBER_ID } from "@/lib/domain/collab";

/** 归档/解归档（§3.2）：Owner only；归档冻结写入、保留可读。 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    if (!getChannel(id)) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    const body = (await request.json().catch(() => ({}))) as { archived?: unknown };
    const channel = setChannelArchived(id, body.archived !== false, CURRENT_MEMBER_ID);
    return NextResponse.json({ channel });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
