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
    id: `msg-${index + 1}`,
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
      { id: "m1", seq: 1, content: "y".repeat(30_000), author: { name: "Owner" } },
      { id: "m2", seq: 2, content: "z".repeat(30_000), author: { name: "Owner" } },
    ],
    1_000,
  );
  assert.equal(projection.lines.length, 1);
  assert.ok(projection.lines[0].includes("#2"), "保住的是最新一条");
  const used = projection.lines.join("\n").length + (projection.notice?.length ?? 0);
  assert.ok(used <= 1_000, `消息块 ${used} 应 ≤ 预算 1000`);
});

test("projectMessages 的每一行行尾都带该消息的完整 id（唯一的行形状）", () => {
  const projection = projectMessages(
    [
      {
        id: "0f6c1f0f-6f1e-4d1a-9a1e-1b2c3d4e5f60",
        seq: 7,
        content: "先看这条",
        author: { name: "Owner" },
      },
      {
        id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
        seq: 8,
        content: "还有这条",
        author: { name: "chief" },
      },
    ],
    5_000,
  );
  assert.deepEqual(projection.lines, [
    "#7 @Owner: 先看这条 (messageId 0f6c1f0f-6f1e-4d1a-9a1e-1b2c3d4e5f60)",
    "#8 @chief: 还有这条 (messageId 1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d)",
  ]);
  assert.match(projection.lines[0], /^#7 @Owner: /, "旧的 #seq 句柄仍在行首（react / pin 按 seq）");
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

test("带 id 的行仍守三档上界：整轮合计 / 窗口条数 / 单条正文 4000（票 #266 的固定开销）", () => {
  // 真实 id 长度（uuid 36 位）：行尾句柄是固定开销，不能把任何一个既有上限顶大。
  const uuid = (index) => `${String(index).padStart(8, "0")}-1111-4222-8333-444455556666`;
  const rows = Array.from({ length: 500 }, (_, index) => ({
    id: uuid(index),
    seq: index + 1,
    content: `第 ${index + 1} 条 ${"x".repeat(5_000)}`,
    author: { name: "Owner" },
  }));

  const skeleton = ["骨架".repeat(1_000)];
  const budget = elasticBudget(skeleton, skeleton);
  const projection = projectMessages(rows, budget);
  const total =
    skeleton.join("\n").length * 2 +
    projection.lines.join("\n").length +
    (projection.notice?.length ?? 0);
  assert.ok(total <= ROUND_INJECTION_BUDGET_CHARS, `合计 ${total} 应 ≤ ${ROUND_INJECTION_BUDGET_CHARS}`);
  assert.ok(
    projection.lines.length <= INJECTION_MESSAGE_WINDOW,
    `注入条数 ${projection.lines.length} 应 ≤ 窗口 ${INJECTION_MESSAGE_WINDOW}`,
  );
  for (const line of projection.lines) {
    assert.match(line, /\(messageId [0-9a-f-]{36}\)$/, "每条行尾都带完整 id");
    // 单条正文的 4000 字上界（ADR-0005 决策一）不因 id 而放宽：行首 + 4000 + 行尾句柄。
    assert.ok(
      line.length <= "#500 @Owner: ".length + 4_000 + ` (messageId ${uuid(0)})`.length,
      `单条 ${line.length} 字越界：id 不得挤占正文额度`,
    );
  }

  // 预算被压到一条都装不下时，截断只吃正文：行尾 id 必须还在（否则模型拿不到句柄）。
  const squeezed = projectMessages(
    [{ id: uuid(9), seq: 9, content: "y".repeat(30_000), author: { name: "Owner" } }],
    1_000,
  );
  assert.equal(squeezed.lines.length, 1);
  assert.match(squeezed.lines[0], /正文已按注入预算截断/);
  assert.match(squeezed.lines[0], /\(messageId [0-9a-f-]{36}\)$/);
  assert.ok(
    squeezed.lines[0].length + (squeezed.notice?.length ?? 0) <= 1_000,
    "截断后仍守本块字符预算",
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
