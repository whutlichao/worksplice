/** 内容首行预览（引用块/任务卡片/提醒标题预填共用）；无依赖，client/server 皆可安全导入。 */
export function previewLine(content: string, maxLength = 80): string {
  const firstLine = content.split("\n")[0].trim();
  return firstLine.length > maxLength ? `${firstLine.slice(0, maxLength)}…` : firstLine;
}
