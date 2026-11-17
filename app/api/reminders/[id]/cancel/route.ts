import { NextResponse } from "next/server";
import { cancelReminder, CURRENT_MEMBER_ID } from "@/lib/domain/collab";
import { jsonError } from "@/lib/domain/errors";

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
    return jsonError(error, 400);
  }
}
