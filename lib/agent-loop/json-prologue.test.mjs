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
// 第四形态（reply-json-leak-unescaped-quote）：content 值里未转义的双引号
// ---------------------------------------------------------------------------

/**
 * live 最新一条（messages.id 074b079b…）的最小同形样本：**没有**裸换行、没有裸控制字符，
 * 只有 content 值里那对未转义的双引号——第二档的候选面（裸控制字符 GLOB）捞不到它，
 * 第三档的尾部分析也不认识它。末尾的 `task` 是本档最关键的一处：改前整段 JSON 当正文，
 * `task` 声明被一起吞掉。
 */
const UNESCAPED_WITH_TASK =
  '{"action":"reply","content":"风险清单已交付。能挡掉一半的"其实不用改代码"。三个未验证项要定案我再查。","task":{"number":5,"op":"complete"}}';
const UNESCAPED_WITH_TASK_CONTENT =
  '风险清单已交付。能挡掉一半的"其实不用改代码"。三个未验证项要定案我再查。';

test("第四档：无裸控制字符的未转义内部双引号被转义，form=unescaped-quote，正文与 task 都保住", () => {
  assert.equal(
    /[\u0001-\u001f]/.test(UNESCAPED_WITH_TASK),
    false,
    "样本刻意不带裸控制字符：第二档的候选面捞不到它，只能靠第四档",
  );
  const repaired = parseLeakedReply(UNESCAPED_WITH_TASK);
  assert.ok(repaired, "未转义双引号形态必须命中第四档");
  assert.equal(repaired.form, "unescaped-quote");
  assert.equal(repaired.content, UNESCAPED_WITH_TASK_CONTENT, "正文里的引号保留为正文引号");
  assert.deepEqual(
    repaired.value.task,
    { number: 5, op: "complete" },
    "后续协议成员不得被吞进正文",
  );
  assert.doesNotMatch(repaired.content ?? "", /"task"|onConflict/, "结构字段不能出现在正文里");
});

test("第四档：裸换行 + Markdown `rel=\"…\"` 片段同样可修（两条缺陷同时在场）", () => {
  const markdown =
    '{"action":"reply","content":"我改了这一行：\n`<link rel="stylesheet" href="tokens.css">`\n请确认。","onConflict":"revise"}';
  const repaired = parseLeakedReply(markdown);
  assert.ok(repaired, "带裸换行的未转义引号形态同样落到第四档");
  assert.equal(repaired.form, "unescaped-quote");
  assert.equal(
    repaired.content,
    '我改了这一行：\n`<link rel="stylesheet" href="tokens.css">`\n请确认。',
    "正文逐字保留（含裸换行与 Markdown 片段）",
  );
  assert.equal(repaired.value.onConflict, "revise", "边界之外的 onConflict 一字不改");
});

test("第四档：已转义引号不被二次破坏", () => {
  const mixed =
    '{"action":"reply","content":"已转义的 \\"xxx\\" 与未转义的 "yyy" 混排","onConflict":"silent"}';
  assert.equal(/\\"/.test(mixed), true, "样本必须真的含既有转义序列");
  const repaired = parseLeakedReply(mixed);
  assert.ok(repaired);
  assert.equal(repaired.form, "unescaped-quote");
  assert.equal(repaired.content, '已转义的 "xxx" 与未转义的 "yyy" 混排');
  assert.equal(repaired.value.onConflict, "silent");
});

test("第四档：边界落在后续协议成员之前，绝不把 ,\"task\" / ,\"onConflict\" 吞进正文", () => {
  const withConflict = '{"action":"reply","content":"他说"先别动"，对吧？","onConflict":"anyway"}';
  const repaired = parseLeakedReply(withConflict);
  assert.ok(repaired);
  assert.equal(repaired.form, "unescaped-quote");
  assert.equal(repaired.content, '他说"先别动"，对吧？');
  assert.equal(repaired.value.onConflict, "anyway");

  // 正文末尾本身就是引号：边界仍必须落在 `,"task"` 之前（选早的那个可 parse 边界）
  const endsWithQuote =
    '{"action":"reply","content":"结论是"先不动"","task":{"number":5,"op":"complete"}}';
  const endsRepaired = parseLeakedReply(endsWithQuote);
  assert.ok(endsRepaired);
  assert.equal(endsRepaired.content, '结论是"先不动"');
  assert.deepEqual(endsRepaired.value.task, { number: 5, op: "complete" });

  // 后续成员是 `ops` 也一样：正文里的引号不得把它一起吞掉
  const withOps =
    '{"action":"reply","content":"他说"先字面看看"","ops":[{"op":"pin","seq":3}]}';
  const opsRepaired = parseLeakedReply(withOps);
  assert.ok(opsRepaired);
  assert.equal(opsRepaired.content, '他说"先字面看看"');
  assert.deepEqual(opsRepaired.value.ops, [{ op: "pin", seq: 3 }]);
});

test("第四档：合法 JSON 不进候选面、也不被改写（原生解析路径负责）", () => {
  for (const sample of [
    '{"action":"reply","content":"ok"}',
    '{"action":"reply","content":"已转义的 \\"x\\""}',
    '{"action":"reply","content":"示例 ,\\"\\"} 结束"}',
  ]) {
    JSON.parse(sample);
    assert.equal(isLeakedReplyCandidate(sample), false, `合法 JSON 不得进候选面：${sample}`);
    assert.equal(parseLeakedReply(sample), null, `合法 JSON 不得被改写：${sample}`);
  }
  // 没有 content 字段 / content 不是字符串：本档不认（不是「正文里带引号」的形态）
  assert.equal(parseLeakedReply('{"action":"reply","content":42,"note":"a"}'), null);
  assert.equal(parseLeakedReply('{"action":"reply"}'), null);
});

// ---------------------------------------------------------------------------
// 反例不回归：未闭合截断仍明确不修
// ---------------------------------------------------------------------------

/**
 * 未闭合截断（live 9134592b / 611588b3 同形）**仍然不修**：补全括号、把 `"content":"` 之后的
 * 残文当正文都是有损猜测。产品要求变了的是同一批样本里的**未转义双引号**（现在由第四档修），
 * 不是这一条。
 */
const NOT_REPAIRABLE = [
  '{"action":"reply","content":"断在这里',
  '{"action":"reply","onConflict":"revise","content":"也没写完',
  '{"action":"reply","content":"未闭合但带了 "未转义引号',
];

test("未闭合截断：parseLeakedReply 全部维持 null（不为多修而放宽）", () => {
  for (const sample of NOT_REPAIRABLE) {
    assert.equal(parseLeakedReply(sample), null, `不得修复：${sample}`);
  }
  // 但它们确实在候选面上（值得报告，而不是静默吞掉）
  for (const sample of NOT_REPAIRABLE) {
    assert.equal(isLeakedReplyCandidate(sample), true, `必须在候选面上：${sample}`);
  }
});

/**
 * 曾经「明确不修」的 6 条未转义内部双引号形态（含 Markdown 片段），产品要求已改变：
 * 它们现在都该被第四档修好，正文逐字保留（引号仍是引号、换行仍是换行）。
 */
const UNESCAPED_QUOTE_FORMS = [
  '{"action":"reply","content":"见 <link rel="stylesheet" href="x.css">\n请确认。","onConflict":"revise"}',
  '{"action":"reply","content":"第一行\n改的是 `<link rel="stylesheet" href="x.css">`","onConflict":"revise"}',
  '{"action":"reply","content":"```html\n<link rel="stylesheet" href="x.css">\n```"}',
  '{"action":"reply","content":"我读了 `href="a"` 与 `href="b"` 两处\n结论如上","onConflict":"silent"}',
  '{"action":"reply","content":"改前：`href="old"`\n改后：`href="new"`","onConflict":"anyway"}',
  '{"action":"reply","content":"见 `rel="preload"` 那一行\n其余不动"}',
];

test("未转义双引号形态：6 条存量样本全部修好，正文里的引号与换行逐字保留", () => {
  for (const sample of UNESCAPED_QUOTE_FORMS) {
    const repaired = parseLeakedReply(sample);
    assert.ok(repaired, `必须修复：${sample}`);
    assert.equal(repaired.form, "unescaped-quote", `必须落在第四档：${sample}`);
    assert.equal(repaired.value.action, "reply");
    assert.doesNotMatch(repaired.content ?? "", /"action"|onConflict|\{\{/, "不得把外壳写进正文");
    assert.match(repaired.content ?? "", /rel="|href="/, "正文里的 Markdown 片段逐字保留");
  }

  // 逐字期望值（手工写死，不从被测量的代码反推）
  const repaired = parseLeakedReply(UNESCAPED_QUOTE_FORMS[1]);
  assert.equal(
    repaired.content,
    '第一行\n改的是 `<link rel="stylesheet" href="x.css">`',
    "正文与它的裸换行逐字保留",
  );
});
