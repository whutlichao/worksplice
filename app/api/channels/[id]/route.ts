import { NextResponse } from "next/server";
import { getChannel } from "@/lib/domain/collab";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const channel = getChannel(id);
    if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    return NextResponse.json({ channel });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
