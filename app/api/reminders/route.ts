import { NextResponse } from "next/server";
import { scheduleReminder, listReminders, CURRENT_MEMBER_ID, getMember } from "@/lib/domain/collab";

/**
 * reminders 路由组（§5.7）：GET/POST /api/reminders。
 * - GET ?authorId=&targetId=：提醒列表（含生命周期信息；过滤可选）；
 * - POST { title, fireAt, recurrence?, targetId?, authorId? }：创建提醒。
 *   默认 author = 当前用户（Owner，§3.6）；Owner 可把提醒设给某个 agent
 *   （author = 该 agent）——§3.9 "唤醒作者本人"：到点只有该作者被唤醒，
 *   演示路径：给 agent 设 every:1m → 系统消息 + agent 被唤醒。
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const authorId = url.searchParams.get("authorId") ?? undefined;
    const targetId = url.searchParams.get("targetId") ?? undefined;
    return NextResponse.json({ reminders: listReminders({ authorId, targetId }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      title?: unknown;
      fireAt?: unknown;
      recurrence?: unknown;
      targetId?: unknown;
      authorId?: unknown;
    };
    if (typeof body.title !== "string" || !body.title.trim()) {
      return NextResponse.json({ error: "Reminder title is required" }, { status: 400 });
    }
    if (typeof body.fireAt !== "string") {
      return NextResponse.json({ error: "fireAt must be a valid date string (ISO)" }, { status: 400 });
    }
    // 作者默认 = 当前用户；替 agent 设（authorId = 某 agent）仅 Owner 可为（§3.6 Owner 级操作）
    let authorId = CURRENT_MEMBER_ID;
    if (typeof body.authorId === "string" && body.authorId && body.authorId !== CURRENT_MEMBER_ID) {
      const member = getMember(body.authorId);
      if (!member || member.deleted === 1 || member.type !== "agent") {
        return NextResponse.json({ error: "authorId must be an agent member" }, { status: 400 });
      }
      authorId = body.authorId;
    }
    const reminder = scheduleReminder({
      title: body.title,
      fireAt: body.fireAt,
      recurrence: typeof body.recurrence === "string" ? body.recurrence : undefined,
      targetId: typeof body.targetId === "string" ? body.targetId : undefined,
      authorId,
    });
    return NextResponse.json({ reminder }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
