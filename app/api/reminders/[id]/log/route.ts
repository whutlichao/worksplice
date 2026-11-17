import { NextResponse } from "next/server";
import { getReminderLog } from "@/lib/domain/collab";
import { jsonError } from "@/lib/domain/errors";

/**
 * reminders 路由组（§5.7）：GET /api/reminders/[id]/log —— 生命周期事件流
 * （schedule / fire / reschedule / snooze / update / cancel / error，§3.9 log）。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ reminderId: id, log: getReminderLog(id) });
  } catch (error) {
    return jsonError(error, 400);
  }
}
