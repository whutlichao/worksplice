import { NextResponse } from "next/server";
import { updateTaskStatus, getTaskView, TaskClaimConflictError, CURRENT_MEMBER_ID } from "@/lib/domain/collab";
import type { TaskStatus } from "@/lib/data/types";

const TASK_STATUSES = new Set<TaskStatus>(["todo", "in_progress", "in_review", "done", "closed"]);

/**
 * POST /api/tasks/[id]/update-status（§5.7 tasks 路由组）：
 * 状态机转移（§3.7）——claim/unclaim/complete/approve/reject/close/reopen。
 * body: { status, baseSeq? } — 房间版本不匹配返回 409 held；非法转移/越权返回 400；
 * claim 边冲突（todo→in_progress 已认领/重开封锁）返回 409 conflict/blocked（与 /claim 同语义）。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { status?: unknown; baseSeq?: unknown };
    if (typeof body.status !== "string" || !TASK_STATUSES.has(body.status as TaskStatus)) {
      return NextResponse.json({ error: "Invalid task status" }, { status: 400 });
    }
    const task = getTaskView(id);
    const result = updateTaskStatus({
      channelId: task.channelId,
      taskNumber: task.number,
      status: body.status as TaskStatus,
      memberId: CURRENT_MEMBER_ID,
      baseSeq: typeof body.baseSeq === "number" ? body.baseSeq : undefined,
    });
    if (result.status === "held") {
      return NextResponse.json(
        { held: true, roomSeq: result.roomSeq, whatHappened: result.whatHappened },
        { status: 409 },
      );
    }
    return NextResponse.json({ task: result.task });
  } catch (error) {
    if (error instanceof TaskClaimConflictError) {
      return NextResponse.json(
        error.kind === "blocked"
          ? { blocked: true, reason: error.message }
          : { conflict: true, reason: error.message },
        { status: 409 },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
