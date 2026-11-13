import assert from "node:assert/strict";
import test from "node:test";

/**
 * 上下文占用格式化（`lib/context-usage-format.ts`）：面板 ④「会话导出与上下文状态」
 * 里那一行 `value` 与 meter 宽度的唯一判据。
 *
 * 用户反馈原话：「这里百分比用两位小数就可以了。」——SDK 的 `percent` 是原始浮点
 * （`tokens / contextWindow * 100`），旧实现直接拼进模板串，真实数据渲染成
 * `10.1919% (101,919 / 1,000,000)`；compaction 之后 `percent` / `tokens` 为 null 时
 * 更会渲染出 `null% (null / 1,000,000)`。
 *
 * 只测外部行为：给定数值，得出展示字符串；不断言内部实现。
 */

const {
  formatContextUsagePercent,
  formatContextUsageValue,
  contextUsageMeterWidth,
} = await import("./context-usage-format.ts");

test("百分比固定两位小数（四舍五入到百分位）", () => {
  // 真实现场：10.1919 = 101919 / 1000000 * 100
  assert.equal(formatContextUsagePercent(10.1919), "10.19%");
  assert.equal(formatContextUsagePercent(0), "0.00%");
  assert.equal(formatContextUsagePercent(100), "100.00%");
  // 进位边界：10.195 → 10.20（toFixed 的舍入语义由测试钉住，避免后续换实现时漂移）
  assert.equal(formatContextUsagePercent(10.195), "10.20%");
  // 小数不足两位时补零，不省略
  assert.equal(formatContextUsagePercent(7.5), "7.50%");
});

test("percent 为 null 时显示破折号，不出现字面 null / NaN", () => {
  assert.equal(formatContextUsagePercent(null), "—");
  // 非有限值（contextWindow 为 0 时理论上的除零结果）同样按未知处理
  assert.equal(formatContextUsagePercent(Number.NaN), "—");
  assert.equal(formatContextUsagePercent(Number.POSITIVE_INFINITY), "—");
});

test("整行：百分比 + 千分位 tokens / contextWindow，括号与斜杠间距不变", () => {
  assert.equal(
    formatContextUsageValue({
      percent: 10.1919,
      tokens: 101919,
      contextWindow: 1000000,
    }),
    "10.19% (101,919 / 1,000,000)",
  );
  // 千分位仍走既有 toLocaleString 口径（formatNumber），不是本模块自造
  assert.equal(
    formatContextUsageValue({
      percent: 100,
      tokens: 1000000,
      contextWindow: 1000000,
    }),
    "100.00% (1,000,000 / 1,000,000)",
  );
});

test("tokens 为 null 时仅 tokens 位置显示破折号（compaction 后的真实状态）", () => {
  assert.equal(
    formatContextUsageValue({
      percent: 10.1919,
      tokens: null,
      contextWindow: 1000000,
    }),
    "10.19% (— / 1,000,000)",
  );
  assert.equal(
    formatContextUsageValue({
      percent: null,
      tokens: null,
      contextWindow: 1000000,
    }),
    "— (— / 1,000,000)",
  );
  // 只有 percent 未知：tokens 照常显示（null 只污染自己那一格）
  assert.equal(
    formatContextUsageValue({
      percent: null,
      tokens: 101919,
      contextWindow: 1000000,
    }),
    "— (101,919 / 1,000,000)",
  );
});

test("meter 宽度与百分比同源；null 宽度为 0% 而非 null% / NaN%", () => {
  assert.equal(contextUsageMeterWidth(10.1919), "10.19%");
  assert.equal(contextUsageMeterWidth(100), "100.00%");
  assert.equal(contextUsageMeterWidth(null), "0%");
  assert.equal(contextUsageMeterWidth(Number.NaN), "0%");
  for (const width of [
    contextUsageMeterWidth(10.1919),
    contextUsageMeterWidth(null),
  ]) {
    assert.doesNotMatch(width, /NaN|null|undefined/);
  }
});
