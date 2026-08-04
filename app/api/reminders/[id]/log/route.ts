import { NextResponse } from "next/server";
import { getReminderLog, ReminderNotFoundError } from "@/lib/raft/reminders";

/**
 * reminders 路由组（§5.7）：GET /api/reminders/[id]/log —— 生命周期事件流
 * （schedule / fire / reschedule / snooze / update / cancel / error，§3.9 log）。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ reminderId: id, log: getReminderLog(id) });
  } catch (error) {
    if (error instanceof ReminderNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
