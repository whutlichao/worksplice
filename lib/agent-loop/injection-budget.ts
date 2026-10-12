/**
 * 每轮注入预算（票 08 / spec B5）：把 agent-loop 每轮送入模型的形状钉死为**有界**。
 *
 * 术语对齐 GLOSSARY.md：这里的「注入投影」＝每轮**活动上下文**的选择视图；被裁掉的内容
 * 仍在**原始会话记录**（不可变消息与 Pi session 原文）里，经票 06/07 的归档＋检索面可达。
 *
 * 度量与裁剪策略（本票实现期按 D5 裁定）：
 * - 度量＝注入文本的字符数（仓库内无 tokenizer；字符是模型输入的单调代理，可确定性断言）；
 * - 上界＝`ROUND_INJECTION_BUDGET_CHARS` 一个常量，覆盖整轮注入形状的合计：
 *   历史积压消息 + 本期新消息 + 任务语境 + 频道/成员语境 + 固定骨架 + 观察相；
 * - 裁剪＝**保近期、裁远期**：只从注入投影里裁，不删不改写任何原始记录。
 *
 * 不变量（D4）：本模块只钉注入形状——不接管 compact 阈值、不生成摘要、不引入应用层自动注入。
 * 会话长尾（前几轮 prompt 文本在 Pi session 里的累积）仍由 Pi compact 管辖。
 */

/** 整轮注入的恒定上界（字符）：decide / revise / 观察相三种 prompt 一律不许超过它。 */
export const ROUND_INJECTION_BUDGET_CHARS = 20_000;

/**
 * 注入窗口（条数上界）：只保留最近的消息。
 * 依据：ADR-0005 决策一已裁定「prompt 保守压缩＝MESSAGE_CONTENT_CAP=4000/条 + 最近 20 条」；
 * 近期消息承载本轮要回的内容与房间当前版本，远期积压是纯粹的上下文体积。
 */
export const INJECTION_MESSAGE_WINDOW = 20;

/** 相关任务条数上界（开放任务语境；远多于一条线程会有的并发任务）。 */
export const INJECTION_TASK_WINDOW = 12;

/** 任务块的字符上界（preview 本身已按 80 字截断，这里是整块的兜底硬顶）。 */
export const INJECTION_TASK_CHARS = 2_400;

/** 频道/成员语境块各自的字符上界（两条列表各一，合计另有整轮上界兜住）。 */
export const INJECTION_CONTEXT_CHARS = 2_400;

/** 待发草稿（revise 的原稿）的字符上界：它是本轮要发的内容，给比普通正文更宽的额度。 */
export const INJECTION_DRAFT_CHARS = 12_000;

/** 单条消息正文上限（ADR-0005 决策一保留的 4000）。 */
const MESSAGE_CONTENT_CAP = 4_000;

/** 裁剪提示行的预留长度（无论是否真的裁剪都先占住，保证合计不越界）。 */
const NOTICE_RESERVE_CHARS = 120;

/** 最新一条消息至少保住的正文长度（当轮要回的内容不得被裁到读不出）。 */
const MIN_MESSAGE_CHARS = 200;

/** 单条消息被预算截断时的行前缀（让模型看得见「这是截断过的」，而不是以为是原文全貌）。 */
const TRUNCATED_PREFIX = "（正文已按注入预算截断）";

/** 可被注入的消息（结构子集：不绑定领域类型，loop.ts 的 MessageWithAuthor 直接满足）。 */
export interface InjectableMessage {
  seq: number;
  content: string;
  author?: { name?: string | null } | null;
}

export interface MessageProjection {
  /** 注入的消息行（seq 升序）。 */
  lines: string[];
  /** 被裁掉的较早消息条数（0 = 无裁剪）。 */
  omitted: number;
  /** 裁剪提示（注入里显式声明被裁内容与回查入口）；无裁剪时为 null。 */
  notice: string | null;
}

/** 截断到 cap 个字符（超长部分以省略号收尾，不改写原文内容本身）。 */
export function clampText(text: string, cap: number): string {
  if (text.length <= cap) return text;
  if (cap <= 1) return "…";
  return `${text.slice(0, cap - 1)}…`;
}

/** 多行文本的字符量（含行间换行，向上取整，宁可高估）。 */
function measureLines(lines: readonly string[]): number {
  return lines.reduce((total, line) => total + line.length + 1, 0);
}

/**
 * 弹性块（消息块 / 观察文本）可用的预算＝整轮上界减去骨架与硬顶块已占的字符。
 * 三种 prompt 共用这一个算式，避免上界的口径在调用点漂移。
 */
export function elasticBudget(
  head: readonly string[],
  tail: readonly string[],
  elasticHeader: readonly string[] = [],
): number {
  return (
    ROUND_INJECTION_BUDGET_CHARS -
    measureLines([...head, ...elasticHeader, ...tail])
  );
}

/** 把一块多行文本压到 cap 字符内：从尾部丢行（只剩一行仍超就截断它）。 */
export function clampLines(lines: readonly string[], capChars: number): string[] {
  const kept = [...lines];
  while (kept.length > 1 && measureLines(kept) > capChars) kept.pop();
  if (kept.length === 1 && measureLines(kept) > capChars) {
    kept[0] = clampText(kept[0], Math.max(capChars - 1, 0));
  }
  return kept;
}

/**
 * 消息块投影：在 `budgetChars` 内保留最近的若干条消息，更早的从注入投影里裁掉。
 * 保证：返回行的字符量 + 提示行 ≤ `budgetChars`（最新一条永远在，必要时截断它的正文）。
 */
export function projectMessages(
  messages: readonly InjectableMessage[],
  budgetChars: number,
): MessageProjection {
  const rendered = messages.map((message) => {
    const author = message.author?.name ?? "unknown";
    return `#${message.seq} @${author}: ${clampText(message.content, MESSAGE_CONTENT_CAP)}`;
  });
  const usable = Math.max(budgetChars - NOTICE_RESERVE_CHARS, 0);
  const kept: string[] = [];
  let used = 0;
  for (let index = rendered.length - 1; index >= 0; index -= 1) {
    if (kept.length >= INJECTION_MESSAGE_WINDOW) break;
    const cost = rendered[index].length + 1;
    if (used + cost > usable) break; // 装不下 → 更早的都不进注入（保近期、裁远期）
    kept.unshift(rendered[index]);
    used += cost;
  }
  // 至少保住最新一条：它是本轮要回的内容，必要时截断正文也要留在注入里
  if (kept.length === 0 && rendered.length > 0) {
    const newest = rendered[rendered.length - 1];
    const room = Math.max(usable - 1, 0);
    kept.push(
      room >= TRUNCATED_PREFIX.length + MIN_MESSAGE_CHARS
        ? `${TRUNCATED_PREFIX}${clampText(newest, room - TRUNCATED_PREFIX.length)}`
        : clampText(newest, room),
    );
  }
  const omitted = rendered.length - kept.length;
  return {
    lines: kept,
    omitted,
    notice:
      omitted > 0
        ? `（${omitted} 条较早的消息不在本轮注入中：原始记录未删改，需要时用 search op 回查）`
        : null,
  };
}
