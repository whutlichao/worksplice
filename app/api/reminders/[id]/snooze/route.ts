import { NextResponse } from "next/server";
import { snoozeReminder, ReminderNotFoundError, ReminderNotAuthorizedError } from "@/lib/raft/reminders";
import { CURRENT_MEMBER_ID } from "@/lib/raft/channels";

/**
 * reminders 路由组（§5.7）：POST /api/reminders/[id]/snooze。
 * body: { minutes? } —— 默认 15；fire_at = max(now, fire_at) + minutes。仅 scheduled。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { minutes?: unknown };
    const minutes = typeof body.minutes === "number" ? body.minutes : 15;
    const reminder = snoozeReminder(id, minutes, CURRENT_MEMBER_ID);
    return NextResponse.json({ reminder });
  } catch (error) {
    if (error instanceof ReminderNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ReminderNotAuthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
