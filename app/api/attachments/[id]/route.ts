import fs from "node:fs";
import { NextResponse } from "next/server";
import { getAttachmentRow } from "@/lib/domain/raft";

/**
 * §3.5 附件下载/预览：文件实体存 `~/.worksplice/attachments/`（随机文件名），
 * 库内只有元数据。图片 inline（<img> 预览），其余 attachment（下载）。
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const attachment = getAttachmentRow(id);
    if (!attachment) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }
    const data = fs.readFileSync(attachment.disk_path);
    const isImage = attachment.mime.startsWith("image/");
    const disposition = isImage
      ? `inline; filename="${attachment.file_name.replace(/"/g, "")}"`
      : `attachment; filename="${attachment.file_name.replace(/"/g, "")}"`;
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": attachment.mime || "application/octet-stream",
        "Content-Disposition": disposition,
        "Content-Length": String(data.byteLength),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
