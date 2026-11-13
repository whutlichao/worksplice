/**
 * 上下文占用展示的判定层（Agent 详情面板 ④「会话导出与上下文状态」那一行）。
 *
 * 用户反馈原话：「这里百分比用两位小数就可以了。」SDK 的 `percent` 是原始浮点
 * （`tokens / contextWindow * 100`），旧实现把它直接拼进模板串，真实数据渲染成
 * `10.1919% (101,919 / 1,000,000)`。同一个表达式还有一处相邻缺陷：SDK 的
 * `ContextUsage` 是 `{ tokens: number | null; contextWindow: number; percent: number | null }`
 * （`@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` 的 `ContextUsage`）——
 * compaction 之后、下一次模型响应之前这两格就是 null，旧实现下 `percent` 渲染成
 * `null%`，`formatNumber(tokens)` 更是直接 `TypeError`（`null.toLocaleString()`）把
 * 整节渲染打崩。
 *
 * 判据只能落在这里：仓内组件测试是 `renderToStaticMarkup` + 源码检查，**没有 jsdom**，
 * 而且这行数据来自 `fetch`（SSR 时 `obs` 尚未到达），真实渲染只能在浏览器里验。
 * 零依赖：不 import 任何东西，服务端 / 客户端 / 测试都能直接引。
 */

/** 与 SDK `ContextUsage` 同形（只取面板用到的三格）：null = 未知（compaction 之后）。 */
export interface ContextUsageLike {
  percent: number | null;
  tokens: number | null;
  contextWindow: number;
}

/** 未知值的占位：符号而非文案，故不进 i18n 语言包。 */
const UNKNOWN = "—";

/** 两位小数的百分比数值（不带 %）；null 与非有限值（除零产生的 NaN/Infinity）都视为未知。 */
function fixedPercent(percent: number | null): string | null {
  if (percent === null || !Number.isFinite(percent)) return null;
  return percent.toFixed(2);
}

/**
 * 千分位口径与面板既有 `formatNumber`（`toLocaleString`）一致。
 * 在此重写一行而不是 import：本模块必须零依赖（客户端 / 服务端 / 测试同源引用）。
 */
function formatCount(n: number): string {
  return n.toLocaleString();
}

/** `10.1919 → "10.19%"`；`null / NaN / Infinity → "—"`。 */
export function formatContextUsagePercent(percent: number | null): string {
  const fixed = fixedPercent(percent);
  return fixed === null ? UNKNOWN : `${fixed}%`;
}

/** `"10.19% (101,919 / 1,000,000)"`；任一未知格显示 `—`，绝不出现字面 null / NaN。 */
export function formatContextUsageValue(usage: ContextUsageLike): string {
  const tokens =
    usage.tokens === null || !Number.isFinite(usage.tokens)
      ? UNKNOWN
      : formatCount(usage.tokens);
  return `${formatContextUsagePercent(usage.percent)} (${tokens} / ${formatCount(usage.contextWindow)})`;
}

/** meter 宽度与百分比同源；未知时 `0%`（避免 `width: null%` / `width: NaN%`）。 */
export function contextUsageMeterWidth(percent: number | null): string {
  const fixed = fixedPercent(percent);
  return fixed === null ? "0%" : `${fixed}%`;
}
