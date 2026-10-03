import { NextResponse } from "next/server";
import { listChannelTasks } from "@/lib/domain/collab";

/** GET /api/channels/[id]/tasks（§3.7 视图）：channel 任务板，按 number 升序、按状态分组在 UI 侧完成；每任务附 reachable（ADR-0002 看板拖拽落点）。 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ tasks: listChannelTasks(id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
