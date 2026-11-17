import { NextResponse } from "next/server";
import { updateReminder, getReminderView, CURRENT_MEMBER_ID } from "@/lib/domain/collab";
import { jsonError } from "@/lib/domain/errors";

/**
 * reminders 路由组（§5.7）：PATCH /api/reminders/[id]（update）。
 * body: { title?, fireAt?, recurrence?, targetId? } —— 校验同创建；仅 scheduled。
 * 作者本人或 Owner 可改；404 不存在 / 403 越权 / 400 校验失败。
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      title?: unknown;
      fireAt?: unknown;
      recurrence?: unknown;
      targetId?: unknown;
    };
    const reminder = updateReminder(
      id,
      {
        title: typeof body.title === "string" ? body.title : undefined,
        fireAt: typeof body.fireAt === "string" ? body.fireAt : undefined,
        recurrence:
          body.recurrence === null
            ? null
            : typeof body.recurrence === "string"
              ? body.recurrence
              : undefined,
        targetId: typeof body.targetId === "string" ? body.targetId : undefined,
      },
      CURRENT_MEMBER_ID,
    );
    return NextResponse.json({ reminder });
  } catch (error) {
    return jsonError(error, 400);
  }
}

/** GET /api/reminders/[id]：单条提醒（UI 详情/管理用）。 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ reminder: getReminderView(id) });
  } catch (error) {
    return jsonError(error, 400);
  }
}
