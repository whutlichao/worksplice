import { NextResponse } from "next/server";
import { sendMessage, getMessageWithAuthor, CURRENT_MEMBER_ID } from "@/lib/domain/collab";
import type { MessageAttachmentDraft } from "@/lib/domain/collab";

interface SendInput {
  targetId?: unknown;
  content?: unknown;
  baseSeq?: unknown;
  quoteId?: unknown;
}

interface SendOutput {
  held: boolean;
  roomSeq?: number;
  whatHappened?: string;
  message?: ReturnType<typeof getMessageWithAuthor>;
  error?: string;
}

function handleSend(input: SendInput, attachments: MessageAttachmentDraft[]): SendOutput {
  if (typeof input.targetId !== "string" || !input.targetId) {
    return { held: false, error: "targetId is required" };
  }
  if (typeof input.content !== "string" || (!input.content.trim() && attachments.length === 0)) {
    return { held: false, error: "Message content is required" };
  }
  const result = sendMessage({
    targetId: input.targetId,
    authorId: CURRENT_MEMBER_ID,
    content: input.content,
    baseSeq: typeof input.baseSeq === "number" ? input.baseSeq : undefined,
    quoteId: typeof input.quoteId === "string" && input.quoteId ? input.quoteId : undefined,
    attachments,
  });
  if (result.held) {
    return { held: true, roomSeq: result.roomSeq, whatHappened: result.whatHappened };
  }
  return { held: false, message: getMessageWithAuthor(result.message.id) };
}

/**
 * 发送消息（§5.7 POST /api/messages）：freshness 校验（§6.3）。
 * body 两种形态：
 * - JSON: { targetId, content, baseSeq?, quoteId? }
 * - multipart/form-data: 字段 targetId/content/baseSeq/quoteId + `files`（多文件，§3.5 附件 ≤50MB）
 * baseSeq 不匹配时返回 409 held（§3.3 四选一的触发面）。
 */
export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const input: SendInput = {
        targetId: form.get("targetId"),
        content: form.get("content"),
        baseSeq: form.get("baseSeq") === null ? undefined : Number(form.get("baseSeq")),
        quoteId: form.get("quoteId"),
      };
      const files = form.getAll("files").filter((value): value is File => value instanceof File);
      const attachments: MessageAttachmentDraft[] = [];
      for (const file of files) {
        attachments.push({
          fileName: file.name,
          mime: file.type,
          data: new Uint8Array(await file.arrayBuffer()),
        });
      }
      return respond(handleSend(input, attachments));
    }

    const body = (await request.json().catch(() => ({}))) as SendInput;
    return respond(handleSend(body, []));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function respond(output: SendOutput) {
  if (output.error) {
    return NextResponse.json({ error: output.error }, { status: 400 });
  }
  if (output.held) {
    return NextResponse.json(
      { held: true, roomSeq: output.roomSeq, whatHappened: output.whatHappened },
      { status: 409 },
    );
  }
  return NextResponse.json({ message: output.message }, { status: 201 });
}
