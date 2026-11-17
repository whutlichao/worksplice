import { NextResponse } from "next/server";
import { getMessageWithAuthor } from "@/lib/domain/collab";
import { jsonError } from "@/lib/domain/errors";

/** 单条消息（引用 / 复制链接深链的数据面）。 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const message = getMessageWithAuthor(id);
    return NextResponse.json({ message });
  } catch (error) {
    return jsonError(error, 404);
  }
}
