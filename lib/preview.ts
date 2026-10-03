/** 内容首行预览（引用块/任务卡片/提醒标题预填共用）；无依赖，client/server 皆可安全导入。 */
export function previewLine(content: string, maxLength = 80): string {
  const firstLine = content.split("\n")[0].trim();
  return firstLine.length > maxLength ? `${firstLine.slice(0, maxLength)}…` : firstLine;
}

/** 字节数 → 人类可读大小（附件 chip 等展示共用）。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** §3.5 单文件上限 50MB（服务端 lib/domain/collab/attachments.ts 与客户端共用同一来源）。 */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
