import assert from "node:assert/strict";
import test from "node:test";
import {
  INJECTION_MESSAGE_WINDOW,
  ROUND_INJECTION_BUDGET_CHARS,
  clampLines,
  clampText,
  elasticBudget,
  projectMessages,
} from "./injection-budget.ts";

/** 合成消息：seq 递增，正文长度可控。 */
function messages(count, bodyLength = 40) {
  return Array.from({ length: count }, (_, index) => ({
    seq: index + 1,
    content: `#${index + 1} `.padEnd(bodyLength, "x"),
    author: { name: "Owner" },
  }));
}

test("projectMessages 保近期、裁远期：超界时留下最新的，并报出被裁条数", () => {
  const projection = projectMessages(messages(50), 2_000);
  assert.ok(projection.omitted > 0, "超界必然有裁剪");
  assert.equal(projection.lines.length, 50 - projection.omitted);
  assert.ok(
    projection.lines.at(-1).includes("#50"),
    "最新一条必须在注入里（本轮要回的内容）",
  );
  assert.ok(
    !projection.lines[0].includes("#1 "),
    "最早的积压被裁出注入（仍在原始记录里）",
  );
  assert.match(projection.notice, /条较早的消息不在本轮注入中/);
  assert.match(projection.notice, /search op/, "提示指向既有回查入口");
});

test("projectMessages 的条数上界是注入窗口（与正文长度无关）", () => {
  const projection = projectMessages(messages(200, 10), 100_000);
  assert.equal(projection.lines.length, INJECTION_MESSAGE_WINDOW);
  assert.equal(projection.omitted, 200 - INJECTION_MESSAGE_WINDOW);
});

test("projectMessages 的字符上界：单条就能撑爆预算时也保住最新一条", () => {
  const projection = projectMessages(
    [
      { seq: 1, content: "y".repeat(30_000), author: { name: "Owner" } },
      { seq: 2, content: "z".repeat(30_000), author: { name: "Owner" } },
    ],
    1_000,
  );
  assert.equal(projection.lines.length, 1);
  assert.ok(projection.lines[0].includes("#2"), "保住的是最新一条");
  const used = projection.lines.join("\n").length + (projection.notice?.length ?? 0);
  assert.ok(used <= 1_000, `消息块 ${used} 应 ≤ 预算 1000`);
});

test("projectMessages 不越界：整轮上界减去骨架后一定装得下", () => {
  const skeleton = ["骨架".repeat(1_000)];
  const budget = elasticBudget(skeleton, skeleton);
  const projection = projectMessages(messages(500, 200), budget);
  const total =
    skeleton.join("\n").length * 2 + projection.lines.join("\n").length + (projection.notice?.length ?? 0);
  assert.ok(
    total <= ROUND_INJECTION_BUDGET_CHARS,
    `合计 ${total} 应 ≤ ${ROUND_INJECTION_BUDGET_CHARS}`,
  );
});

test("clampText / clampLines 只截断注入投影，不改写原文", () => {
  assert.equal(clampText("short", 100), "short");
  assert.equal(clampText("abcdef", 3).length, 3);
  assert.match(clampText("abcdef", 3), /…$/);

  const lines = ["", "header", "a".repeat(100), "b".repeat(100)];
  const clamped = clampLines(lines, 150);
  assert.ok(clamped.length < lines.length, "超界时从尾部丢行");
  assert.equal(clamped[0], "", "块首的空行是格式，不是可丢的内容");
  assert.equal(clamped[1], "header");
});
