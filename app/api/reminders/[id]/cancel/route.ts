import { NextResponse } from "next/server";
import { cancelReminder, ReminderNotFoundError, ReminderNotAuthorizedError } from "@/lib/raft/reminders";
import { CURRENT_MEMBER_ID } from "@/lib/raft/channels";

/**
 * reminders 路由组（§5.7）：POST /api/reminders/[id]/cancel。
 * status → canceled：cron 不再触发（§3.9 cancel 后不再触发）。仅 scheduled。
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const reminder = cancelReminder(id, CURRENT_MEMBER_ID);
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
