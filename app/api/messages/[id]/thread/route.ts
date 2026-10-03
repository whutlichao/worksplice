import { NextResponse } from "next/server";
import { getThreadInfo } from "@/lib/domain/collab";

/** 线程读取：锚点消息 + 该线程全部消息（§3.1 回复气泡展开 thread）。 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const thread = getThreadInfo(id);
    return NextResponse.json(thread);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
