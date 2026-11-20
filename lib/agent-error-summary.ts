/**
 * 错误摘要纯函数（票 #300）：把持久化的原始错误文本压成详情面板可读的一行摘要，
 * 完整原文保留在 `detail` 供 `title` 悬停查看。
 *
 * 只做结构解包与空白折叠，不翻译服务端/上游 API 的英文错误内容
 * （docs/i18n.md 第 5、6 条：服务端错误详情保持原样）。
 */

export interface AgentErrorSummary {
  /** 精简后的核心错误短语（用于面板 2 行截断展示）。 */
  summary: string;
  /** trim 后的完整原始错误（用于 `title` 悬停）。 */
  detail: string;
}

const SUMMARY_MAX_LENGTH = 160;

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncateSummary(text: string): string {
  if (text.length <= SUMMARY_MAX_LENGTH) return text;
  return `${text.slice(0, SUMMARY_MAX_LENGTH).trimEnd()}…`;
}

function stripHtml(text: string): string {
  return text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

/** 多行错误/HTML/堆栈：取首条有意义的非空行（跳过纯 HTML 标签与堆栈帧）。 */
function firstMeaningfulLine(raw: string): string {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^at\s+\S+/.test(trimmed)) continue;
    if (/^node\.js\s+v\d+/i.test(trimmed)) continue;
    const stripped = collapseWhitespace(stripHtml(trimmed));
    if (stripped) return stripped;
  }
  return collapseWhitespace(stripHtml(raw)) || collapseWhitespace(raw);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 常见错误 JSON 形状：error.message / message / detail（含 error 为字符串）。 */
function extractMessageFromJson(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  const record = asRecord(value);
  if (!record) return null;
  for (const key of ["message", "detail", "error"]) {
    const entry = record[key];
    if (typeof entry === "string" && entry.trim()) return entry.trim();
    const nested = asRecord(entry);
    if (!nested) continue;
    const message = extractMessageFromJson(nested);
    if (message) return message;
  }
  return null;
}

function parseJsonLike(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // 继续尝试从「前缀 + JSON」里截取对象。
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

function extractJsonMessage(text: string): string | null {
  const parsed = parseJsonLike(text);
  if (parsed === null) return null;
  return extractMessageFromJson(parsed);
}

function summarize(raw: string): string {
  const trimmed = raw.trim();

  // 裸 JSON（可跨行）：直接解包，避免只取到第一行的 `{`。
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const jsonMessage = extractJsonMessage(trimmed);
    if (jsonMessage) return truncateSummary(collapseWhitespace(jsonMessage));
  }

  let text = collapseWhitespace(firstMeaningfulLine(trimmed));
  text = text.replace(/^model\s+error\s*:\s*/i, "").trim();

  // 常见模型/API 包装：`429: {"error":{"message":...}}` / `402 {...}`。
  const statusMatch = /^(\d{3})\b\s*(:?)\s*([\s\S]*)$/.exec(text);
  const code = statusMatch?.[1] ?? null;
  const hadColon = statusMatch?.[2] === ":";
  const rest = (statusMatch?.[3] ?? text).trim();

  if (rest) {
    const jsonMessage = extractJsonMessage(rest) ?? extractJsonMessage(trimmed);
    if (jsonMessage) {
      const message = collapseWhitespace(jsonMessage);
      return truncateSummary(code ? `${code}: ${message}` : message);
    }
    const collapsed = collapseWhitespace(rest);
    return truncateSummary(
      code ? (hadColon ? `${code}: ${collapsed}` : text) : collapsed,
    );
  }

  return truncateSummary(code ?? (text || collapseWhitespace(raw)));
}

/**
 * 无内容/全空白返回 null；否则给出精简摘要与完整原文。
 * 翻译边界：摘要只做空白折叠与结构解包，服务端英文错误内容原样保留。
 */
export function formatAgentErrorSummary(
  raw: string | null | undefined,
): AgentErrorSummary | null {
  if (typeof raw !== "string") return null;
  const detail = raw.trim();
  if (!detail) return null;
  return { summary: summarize(detail), detail };
}
