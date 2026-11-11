import assert from "node:assert/strict";
import test from "node:test";
import { focusableWithin, isTabbable, nextTabTarget } from "./modal-focus.ts";

// ---------------------------------------------------------------------------
// 模态焦点陷阱的判定层（界面评审残留 R1）：Tab 边界回绕 + 可聚焦元素的判定。
// 真正的可聚焦性（display:none、visibility:hidden、inert、disabled）只能由浏览器裁定，
// 所以 isTabbable 吃的是「元素快照」，行为面用 ego-browser 实测；这里钉的是规则本身。
// ---------------------------------------------------------------------------

const ITEMS = ["close", "input", "submit"];

test("R1: 正向 Tab 在末项回绕到首项", () => {
  assert.equal(nextTabTarget(ITEMS, "submit", false), "close");
});

test("R1: Shift+Tab 在首项回绕到末项", () => {
  assert.equal(nextTabTarget(ITEMS, "close", true), "submit");
});

test("R1: 中间项交给浏览器原生顺序（不拦截）", () => {
  assert.equal(nextTabTarget(ITEMS, "input", false), null);
  assert.equal(nextTabTarget(ITEMS, "input", true), null);
});

test("R1: 无可聚焦元素时不吞掉 Tab（返回 null，浏览器自行处理）", () => {
  assert.equal(nextTabTarget([], null, false), null);
  assert.equal(nextTabTarget([], "close", true), null);
});

test("R1: 焦点尚未在模态内（null）时按方向拉进边界", () => {
  assert.equal(nextTabTarget(ITEMS, null, false), "close");
  assert.equal(nextTabTarget(ITEMS, null, true), "submit");
});

test("R1: 焦点在外来元素（如挂在 body 的 createPortal 选择器）时不抢", () => {
  // 组件层另有「嵌套 role=dialog 直接让路」的前置判断；规则层对「不在列表里」保守返回 null。
  assert.equal(nextTabTarget(ITEMS, "portal-entry", false), null);
  assert.equal(nextTabTarget(ITEMS, "portal-entry", true), null);
});

test("R1: 单项列表里正反向都回绕到自己", () => {
  assert.equal(nextTabTarget(["only"], "only", false), "only");
  assert.equal(nextTabTarget(["only"], "only", true), "only");
});

// ─── 可聚焦元素的判定规则 ────────────────────────────────────────────────────

test("R1: 按钮与带 href 的链接可聚焦，纯文本容器不可", () => {
  assert.deepEqual(
    focusableWithin([
      { tag: "button" },
      { tag: "a", href: "#x" },
      { tag: "a" },
      { tag: "div" },
      { tag: "span" },
    ]),
    [0, 1],
  );
});

test("R1: tabindex=-1 的容器不进 Tab 序，tabindex=0 的容器进", () => {
  assert.deepEqual(
    focusableWithin([
      { tag: "div", tabIndex: -1 },
      { tag: "div", tabIndex: 0 },
      { tag: "section", tabIndex: 0 },
    ]),
    [1, 2],
  );
});

test("R1: disabled 与 inert 子树退出 Tab 序", () => {
  assert.deepEqual(
    focusableWithin([
      { tag: "button", disabled: true },
      { tag: "button" },
      { tag: "input", inert: true },
      { tag: "input" },
    ]),
    [1, 3],
  );
});

test("R1: 被 CSS 驱逐的元素（display:none / visibility:hidden / 无布局盒）不可聚焦", () => {
  // `display: none` 的后代不在 Tab 序里——正是 R2 那条失效补救规则的成因，
  // 焦点陷阱同样不能把它算作边界。
  assert.deepEqual(
    focusableWithin([
      { tag: "button", rendered: false },
      { tag: "button", visible: false },
      { tag: "button", hasBox: false },
      { tag: "button" },
    ]),
    [3],
  );
});

test("R1: hidden input 不进 Tab 序，其余表单控件进", () => {
  assert.deepEqual(
    focusableWithin([
      { tag: "input", type: "hidden" },
      { tag: "input", type: "text" },
      { tag: "textarea" },
      { tag: "select" },
      { tag: "audio", controls: true },
      { tag: "video" },
    ]),
    [1, 2, 3, 4],
  );
});

test("R1: 缺省快照（无 CSS 驱逐、无禁用）按语义判定，不靠 DOM 存在", () => {
  assert.equal(isTabbable({ tag: "button" }), true);
  assert.equal(isTabbable({ tag: "div" }), false);
});
