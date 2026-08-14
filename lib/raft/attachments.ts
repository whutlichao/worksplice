import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getDb } from "./db-singleton.ts";
import { MAX_ATTACHMENT_BYTES } from "../preview.ts";
import type { AttachmentRow } from "../data/types.ts";

export { MAX_ATTACHMENT_BYTES } from "../preview.ts";

/** 客户端随消息提交的附件草案（文件实体尚未落盘）。 */
export interface MessageAttachmentDraft {
  fileName: string;
  mime?: string;
  data: Uint8Array;
}

/** 已落盘待链接的附件（磁盘路径为随机名，原始名只存库）。 */
export interface StagedAttachment {
  fileName: string;
  mime: string;
  sizeBytes: number;
  diskPath: string;
}

function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  return base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

/**
 * 校验 + 写盘（§3.5）：文件实体存 `attachments/` 目录（随机文件名，原始名入库）。
 * 超限抛错；调用方（sendMessage）在事务失败/held 时负责 discard 清理。
 */
export function stageAttachmentFiles(drafts: MessageAttachmentDraft[]): StagedAttachment[] {
  return drafts.map((draft) => {
    const fileName = sanitizeFileName(draft.fileName);
    if (!fileName) throw new Error("File name is required");
    const sizeBytes = draft.data.byteLength;
    if (sizeBytes > MAX_ATTACHMENT_BYTES) {
      throw new Error("Attachment exceeds the 50 MB limit");
    }
    const diskPath = path.join(getDb().paths.attachmentsDir, randomUUID());
    fs.writeFileSync(diskPath, draft.data);
    return {
      fileName,
      mime: draft.mime ?? "",
      sizeBytes,
      diskPath,
    };
  });
}

/** 清理已落盘但未链接的附件（held / 抛错路径；单个文件失败不阻断清理）。 */
export function discardAttachmentFiles(staged: Array<{ diskPath: string }>): void {
  for (const item of staged) {
    try {
      fs.rmSync(item.diskPath, { force: true });
    } catch {
      // 清理尽力而为
    }
  }
}

/** 下载/预览路由用：按 id 取附件行。 */
export function getAttachmentRow(id: string): AttachmentRow | undefined {
  return getDb().getAttachment(id);
}
