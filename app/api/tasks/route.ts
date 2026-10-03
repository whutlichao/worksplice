import { NextResponse } from "next/server";
import { sendMessage, createTask, TaskAlreadyExistsError, getTaskView, CURRENT_MEMBER_ID, getChannel } from "@/lib/domain/collab";

/**
 * POST /api/tasks（§5.7 tasks 路由组）：创建任务 = 消息 + 元数据（§3.7）。
 * - { messageId }：把已有顶层消息转为任务（右键 Convert to Task）；
 * - { channelId, content }：在 channel 内先发消息再建任务（Tasks tab Create Task）。
 * 任务住在创建它的 channel 里；number 按 channel 内递增。
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      messageId?: unknown;
      channelId?: unknown;
      content?: unknown;
    };
    let task;
    if (typeof body.messageId === "string" && body.messageId) {
      task = createTask({ messageId: body.messageId });
    } else if (typeof body.channelId === "string" && body.channelId && typeof body.content === "string" && body.content.trim()) {
      const channel = getChannel(body.channelId);
      if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
      const sent = sendMessage({
        targetId: body.channelId,
        authorId: CURRENT_MEMBER_ID,
        content: body.content,
      });
      if (sent.held) {
        return NextResponse.json(
          { held: true, roomSeq: sent.roomSeq, whatHappened: sent.whatHappened },
          { status: 409 },
        );
      }
      task = createTask({ messageId: sent.message.id });
    } else {
      return NextResponse.json(
        { error: "Provide { messageId } or { channelId, content }" },
        { status: 400 },
      );
    }
    return NextResponse.json({ task: getTaskView(task.id) }, { status: 201 });
  } catch (error) {
    if (error instanceof TaskAlreadyExistsError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
