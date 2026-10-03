import assert from "node:assert/strict";
import test from "node:test";
import { parseRecurrence, isValidRecurrence, nextFireAt } from "./recurrence.ts";

// ---------------------------------------------------------------------------
// parseRecurrence：every / daily / weekly 三族 + 非法输入
// ---------------------------------------------------------------------------

test("parseRecurrence: every:N<unit>（m/h/d）", () => {
  assert.deepEqual(parseRecurrence("every:15m"), { kind: "every", amount: 15, unit: "m" });
  assert.deepEqual(parseRecurrence("every:2h"), { kind: "every", amount: 2, unit: "h" });
  assert.deepEqual(parseRecurrence("every:1d"), { kind: "every", amount: 1, unit: "d" });
  assert.deepEqual(parseRecurrence("every:1m"), { kind: "every", amount: 1, unit: "m" });
});

test("parseRecurrence: daily@HH:MM", () => {
  assert.deepEqual(parseRecurrence("daily@09:00"), { kind: "daily", hour: 9, minute: 0 });
  assert.deepEqual(parseRecurrence("daily@23:59"), { kind: "daily", hour: 23, minute: 59 });
});

test("parseRecurrence: weekly:mon,fri@HH:MM（大小写不敏感、任意顺序、去重）", () => {
  assert.deepEqual(parseRecurrence("weekly:mon,fri@09:00"), {
    kind: "weekly",
    weekdays: [1, 5],
    hour: 9,
    minute: 0,
  });
  assert.deepEqual(parseRecurrence("weekly:fri,mon@09:00"), {
    kind: "weekly",
    weekdays: [1, 5],
    hour: 9,
    minute: 0,
  });
  assert.deepEqual(parseRecurrence("weekly:Sun@08:30"), {
    kind: "weekly",
    weekdays: [0],
    hour: 8,
    minute: 30,
  });
});

test("parseRecurrence: 非法 DSL 返回 null", () => {
  for (const dsl of [
    "",
    "every:",
    "every:0m",
    "every:1",
    "every:1w",
    "every:15min",
    "every:1.5h",
    "daily@",
    "daily@9:00",
    "daily@09:0",
    "daily@24:00",
    "daily@09:60",
    "weekly:",
    "weekly:mon@",
    "weekly:mon@9:00",
    "weekly:mon,tuesday@09:00",
    "weekly:mon,fri@24:00",
    "cron:*/5",
    "every:1m,every:2h",
  ]) {
    assert.equal(parseRecurrence(dsl), null, `expected null for ${JSON.stringify(dsl)}`);
    assert.equal(isValidRecurrence(dsl), false, `expected invalid for ${JSON.stringify(dsl)}`);
  }
});

test("isValidRecurrence mirrors parseRecurrence", () => {
  assert.equal(isValidRecurrence("every:15m"), true);
  assert.equal(isValidRecurrence("daily@09:00"), true);
  assert.equal(isValidRecurrence("weekly:mon,fri@09:00"), true);
});

// ---------------------------------------------------------------------------
// nextFireAt：严格晚于 from；时区安全（本地时区构造）
// ---------------------------------------------------------------------------

test("every: delay 语义 —— 服务端算绝对时间（from + 延迟）", () => {
  const from = new Date("2026-08-04T08:00:00.000Z");
  assert.equal(nextFireAt("every:15m", from)?.toISOString(), "2026-08-04T08:15:00.000Z");
  assert.equal(nextFireAt("every:2h", from)?.toISOString(), "2026-08-04T10:00:00.000Z");
  assert.equal(nextFireAt("every:1d", from)?.toISOString(), "2026-08-05T08:00:00.000Z");
});

test("daily: 当天已过则推到下一天（严格晚于 from）", () => {
  // 本地时区 09:00
  const beforeNine = new Date(2026, 7, 4, 8, 30);
  assert.equal(
    nextFireAt("daily@09:00", beforeNine)?.getTime(),
    new Date(2026, 7, 4, 9, 0).getTime(),
  );
  const afterNine = new Date(2026, 7, 4, 9, 30);
  assert.equal(
    nextFireAt("daily@09:00", afterNine)?.getTime(),
    new Date(2026, 7, 5, 9, 0).getTime(),
  );
  const atNine = new Date(2026, 7, 4, 9, 0);
  assert.equal(
    nextFireAt("daily@09:00", atNine)?.getTime(),
    new Date(2026, 7, 5, 9, 0).getTime(),
  );
});

test("weekly: 下一个匹配的工作日（跨周、不含当天已过时刻）", () => {
  // 2026-08-04 是周二
  const tuesday = new Date(2026, 7, 4, 8, 0);
  // mon,fri：下一个周五
  assert.equal(
    nextFireAt("weekly:mon,fri@09:00", tuesday)?.getTime(),
    new Date(2026, 7, 7, 9, 0).getTime(),
  );
  // 仅 mon：下周一
  assert.equal(
    nextFireAt("weekly:mon@09:00", tuesday)?.getTime(),
    new Date(2026, 7, 10, 9, 0).getTime(),
  );
  // 周三 10:00，weekly:wed@09:00 → 下周三（当天已过）
  const wednesdayLate = new Date(2026, 7, 5, 10, 0);
  assert.equal(
    nextFireAt("weekly:wed@09:00", wednesdayLate)?.getTime(),
    new Date(2026, 7, 12, 9, 0).getTime(),
  );
  // 周日 + 跨月边界：2026-08-31 是周一，weekly:sun@09:00 → 2026-09-06
  const monday = new Date(2026, 7, 31, 8, 0);
  assert.equal(
    nextFireAt("weekly:sun@09:00", monday)?.getTime(),
    new Date(2026, 8, 6, 9, 0).getTime(),
  );
});

test("nextFireAt: 非法 DSL 返回 null", () => {
  assert.equal(nextFireAt("bogus", new Date()), null);
});
