import assert from "node:assert/strict";
import test from "node:test";

/**
 * 泄漏修复判据模块（lib/agent-loop/json-prologue.ts）在接缝上的行为测试。
 *
 * 模块的**判定接缝**只有两条：`parseLeakedReply`（能不能修、修成什么）与
 * `isLeakedReplyCandidate`（值不值得当候选看）。本文件只跨这两条接缝专钉**三档判据各自的边界**，
 * 特别是第三档（尾部冗余空键）带出的那个区分：**进入候选面 ≠ 可修**。
 *
 * 位置说明：仓库惯例是一个模块一个同名测试文件（member-ops.ts / member-ops.test.mjs、
 * injection-budget.ts / injection-budget.test.mjs），本模块此前只在 loop.test.mjs 与
 * fix-reply-json-leak.test.mjs 里被间接覆盖，没有自己的接缝测试。
 */

const { parseLeakedReply, isLeakedReplyCandidate } = await import("./json-prologue.ts");

/**
 * 第三形态（reply-json-leak-tail）：对象的最后一个成员名是空字符串，没有冒号也没有值，
 * 紧接 `}` 闭合。live 实测一条（messages.id fc9bc7f1…）尾部逐字是 `…汇报验证结果。",""}`。
 * 下面的样本是本文件自造的等价最小形态（不含 live 正文），正文里的 `\n` 是字面转义
 * ——本档与裸控制字符档无关，只有「尾部空键」这一个缺陷。
 */
const TRAILING_KEY = '{"action":"reply","content":"第一行\\n第二行","onConflict":"revise",""}';

test("第三档：尾部冗余空键被剥离，form=trailing-key，content 是真正文", () => {
  assert.ok(TRAILING_KEY.includes('\\n'), "样本的换行必须是字面转义（本档不处理裸控制字符）");
  const repaired = parseLeakedReply(TRAILING_KEY);
  assert.ok(repaired, "尾部空键形态必须命中第三档");
  assert.equal(repaired.form, "trailing-key");
  assert.equal(repaired.content, "第一行\n第二行");
  assert.equal(repaired.value.onConflict, "revise", "其余字段一个字都不动");
});

test("第三档：逗号与空成员名、闭合括号之间的空白不影响判定", () => {
  for (const sample of [
    '{"action":"reply","content":"ok", ""}',
    '{"action":"reply","content":"ok",""  }',
    '{"action":"reply","content":"ok" ,  ""   }',
  ]) {
    const repaired = parseLeakedReply(sample);
    assert.ok(repaired, `空白形态必须命中：${sample}`);
    assert.equal(repaired.form, "trailing-key");
    assert.equal(repaired.content, "ok");
  }
});

test("第三档：字符串字面量里的 `,\"\"}` 是正文，不是判据", () => {
  // 合法 JSON：`,""}` 出现在 content 的字符串值里。字符串里的任何序列一律不动。
  const inside = '{"action":"reply","content":"示例 ,\\"\\"} 结束"}';
  assert.equal(JSON.parse(inside).content, '示例 ,""} 结束', "样本本身必须是合法 JSON");
  assert.equal(isLeakedReplyCandidate(inside), false);
  assert.equal(parseLeakedReply(inside), null, "字面量里的 ,\"\"} 不得被当成尾部空键");
});

test("第三档：字面量内与尾部同时出现时，只剥离尾部那一个", () => {
  const mixed = '{"action":"reply","content":"嘴里的 ,\\"\\"} 保留",""}';
  const repaired = parseLeakedReply(mixed);
  assert.ok(repaired);
  assert.equal(repaired.form, "trailing-key");
  assert.equal(repaired.content, '嘴里的 ,""} 保留', "正文里的字面量序列逐字保留");
});

test("第三档仍过 acceptProtocolObject：action 不合法就维持 null", () => {
  // 结构上可剥离（`,""}` 在字面量之外），但形状不合协议 —— 校验不过即 null，不猜
  for (const sample of [
    '{"action":"archive","content":"x",""}',
    '{"action":["reply"],"content":"x",""}',
    '{"content":"x",""}',
  ]) {
    assert.equal(parseLeakedReply(sample), null, `形状不合协议必须维持 null：${sample}`);
  }
});

// ---------------------------------------------------------------------------
// 候选面 ≠ 可修：未闭合尾
// ---------------------------------------------------------------------------

test("未闭合尾：进入候选面，但绝不修（parseLeakedReply 必须为 null）", () => {
  // live 两条（9134592b / 611588b3）就是这个形态：协议对象写到一半断了。
  // 补全括号 / 把 `"content":"` 之后的文本当正文都是有损猜测，本档明确不做。
  const unclosed = '{"action":"reply","content":"写到这里就断了';
  assert.equal(isLeakedReplyCandidate(unclosed), true, "协议形状 + 尾部不完整 = 候选（只报告）");
  assert.equal(parseLeakedReply(unclosed), null, "未闭合不补全、不回填");

  // 带裸控制字符的未闭合同样只进候选面、绝不修（别让裸控制字符档顺手把它救回来）
  const unclosedWithRawControl = '{"action":"reply","content":"第一行\n第二行';
  assert.equal(isLeakedReplyCandidate(unclosedWithRawControl), true);
  assert.equal(parseLeakedReply(unclosedWithRawControl), null);
});

test("候选面不误伤：合法 JSON / 纯正文 / 非协议形状都不进任何档", () => {
  // 合法协议 JSON：原生解析路径负责，泄漏修复三档都不该插手
  assert.equal(isLeakedReplyCandidate('{"action":"reply","content":"ok"}'), false);
  assert.equal(parseLeakedReply('{"action":"reply","content":"ok"}'), null);
  // 空键**带**值 `{"":1}` 是合法 JSON 成员，不是本档的缺陷
  const emptyKeyWithValue = '{"action":"reply","content":"ok","":1}';
  assert.equal(JSON.parse(emptyKeyWithValue).action, "reply");
  assert.equal(isLeakedReplyCandidate(emptyKeyWithValue), false);
  assert.equal(parseLeakedReply(emptyKeyWithValue), null);
  // 纯自然语言（含裸换行）逐字不动
  assert.equal(isLeakedReplyCandidate("第一行\n第二行"), false);
  // 以 `{` 开头但不带 `"` 的散文：不是协议对象形状，不进候选面
  assert.equal(isLeakedReplyCandidate("{普通散文"), false);
});

// ---------------------------------------------------------------------------
// 反例不回归：本轮明确不修的两类（未转义双引号 / 未闭合截断）
// ---------------------------------------------------------------------------

/**
 * 本轮明确不修的形态各一组：6 条未转义内部双引号 + 2 条未闭合截断（与 live 读数同构的最小样本）。
 * 前 6 条都带真实换行——live 那 6 条也都带（Markdown 正文），它们的**候选面**来自第二档的
 * 裸控制字符前置筛，与第三档无关；这里如实保留这个形态，不改写成「无换行」的变体。
 */
const NOT_REPAIRABLE = [
  '{"action":"reply","content":"见 <link rel="stylesheet" href="x.css">\n请确认。","onConflict":"revise"}',
  '{"action":"reply","content":"第一行\n改的是 `<link rel="stylesheet" href="x.css">`","onConflict":"revise"}',
  '{"action":"reply","content":"```html\n<link rel="stylesheet" href="x.css">\n```"}',
  '{"action":"reply","content":"我读了 `href="a"` 与 `href="b"` 两处\n结论如上","onConflict":"silent"}',
  '{"action":"reply","content":"改前：`href="old"`\n改后：`href="new"`","onConflict":"anyway"}',
  '{"action":"reply","content":"见 `rel="preload"` 那一行\n其余不动"}',
  '{"action":"reply","content":"断在这里',
  '{"action":"reply","onConflict":"revise","content":"也没写完',
];

test("未转义双引号 / 未闭合截断：parseLeakedReply 全部维持 null（不为多修而放宽）", () => {
  for (const sample of NOT_REPAIRABLE) {
    assert.equal(parseLeakedReply(sample), null, `不得修复：${sample}`);
  }
  // 但它们确实在候选面上（值得报告，而不是静默吞掉）
  for (const sample of NOT_REPAIRABLE) {
    assert.equal(isLeakedReplyCandidate(sample), true, `必须在候选面上：${sample}`);
  }
});
