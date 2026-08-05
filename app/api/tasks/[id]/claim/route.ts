import { NextResponse } from "next/server";
import { claimTask, getTaskView } from "@/lib/raft/tasks";
import { CURRENT_MEMBER_ID } from "@/lib/raft/channels";

/**
 * POST /api/tasks/[id]/claim（§5.7 tasks 路由组）：claim 即"我负责"。
 * body: { baseSeq? } — 房间版本不匹配返回 409 held（§3.7 并发保护）；
 * 已认领返回 409 conflict（claim 失败方让路）；
 * 重开封锁返回 409 blocked（§3.7 重开后不可自动认领——仅 Owner 认领接管）。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { baseSeq?: unknown };
    const task = getTaskView(id);
    const result = claimTask({
      channelId: task.channelId,
      taskNumber: task.number,
      memberId: CURRENT_MEMBER_ID,
      baseSeq: typeof body.baseSeq === "number" ? body.baseSeq : undefined,
    });
    if (result.status === "held") {
      return NextResponse.json(
        { held: true, roomSeq: result.roomSeq, whatHappened: result.whatHappened },
        { status: 409 },
      );
    }
    if (result.status === "conflict") {
      return NextResponse.json({ conflict: true, reason: result.reason }, { status: 409 });
    }
    if (result.status === "blocked") {
      return NextResponse.json({ blocked: true, reason: result.reason }, { status: 409 });
    }
    return NextResponse.json({ task: result.task });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
