/**
 * 模态外壳的落盘断言（票 08，spec D7 的原语层第 10 行）。
 *
 * 两半 seam：① 产品真正渲染出的 markup（renderToStaticMarkup + jiti，既有 seam）；
 * ② `app/globals.css` 的规则体（class 块形态只可能在 CSS 里，与 primitives.test.mjs 同档）。
 * 断言名字一律用「需求语言」（--modal-max / --shadow-pop / 无硬偏移阴影），不锁实现细节。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { BrutalModal } = await jiti.import("./BrutalModal.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const globalsCss = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 取一条规则的声明体（选择器与 `{` 之间只允许空白，避免误命中更长的选择器）。 */
function blockBody(selector) {
  const pattern = new RegExp(
    `(?:^|[}])\\s*${escapeRe(selector)}\\s*\\{([^}]*)\\}`,
    "m",
  );
  const match = globalsCss.match(pattern);
  assert.ok(match, `globals.css 缺少规则 \`${selector}\``);
  return match[1];
}

function renderModal(props = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(
        BrutalModal,
        { title: "New channel", onClose: () => undefined, ...props },
        React.createElement("div", { className: "modal-body" }, "content"),
      ),
    ),
  );
}

// ─── markup 面：外壳 class 契约 ───────────────────────────────────────────────

test("模态外壳渲染 .overlay + .modal（不是旧的内联 fixed/硬阴影卡片）", () => {
  const html = renderModal();
  assert.match(html, /class="overlay"/);
  assert.match(html, /class="modal"/);
  assert.match(html, /class="modal-head"/);
  // 无障碍契约保持（零行为改动）：dialog + aria-modal + 标题名
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-label="New channel"/);
});

test("模态外壳：默认档不带 .wide，宽档（width 传入 > --modal-max）带 .wide", () => {
  assert.doesNotMatch(renderModal({ width: 400 }), /class="modal wide"/);
  assert.match(renderModal({ width: 520 }), /class="modal wide"/);
});

test("模态外壳：scrim 背景与模态形态都不再走硬偏移阴影字面量", () => {
  const html = renderModal();
  assert.doesNotMatch(html, /rgba\(20,\s*17,\s*17/);
  assert.doesNotMatch(html, /\d+px \d+px 0 0/);
  assert.doesNotMatch(html, /6px 6px/);
});

test("模态外壳：关闭按钮走 .icon-btn，且不含压掉焦点环的 inline outline", () => {
  const html = renderModal();
  assert.match(html, /class="icon-btn"/);
  assert.doesNotMatch(html, /outline/);
});

test("模态外壳：每个可聚焦元素都不带 inline outline（焦点环由 reset 的 :focus-visible 承担）", () => {
  const html = renderModal();
  const focusables = html.match(/<(?:button|input|select|textarea)\b[^>]*>/g) ?? [];
  assert.ok(focusables.length > 0, "模态外壳里应至少有一个可聚焦元素（关闭按钮）");
  for (const tag of focusables) {
    assert.doesNotMatch(tag, /outline/i, `可聚焦元素不得压掉焦点环：${tag}`);
  }
  // reset 段的 :focus-visible 环仍在（ED-8）
  assert.match(globalsCss, /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\)/);
});

// ─── globals.css 面：class 块形态逐字取自上游 ────────────────────────────────

test(".overlay：fixed 全屏 + --z-overlay + scrim + blur", () => {
  const body = blockBody(".overlay");
  assert.match(body, /position:\s*fixed/);
  assert.match(body, /inset:\s*0/);
  assert.match(body, /z-index:\s*var\(--z-overlay\)/);
  assert.match(body, /backdrop-filter:\s*blur\(2px\)/);
  assert.match(body, /oklch\(21% 0\.02 255 \/ 0\.42\)/);
  // 逐字搬上游：顶部对齐的居中网格（12vh 起）
  assert.match(body, /place-items:\s*start center/);
});

test(".modal：--r-xl + --shadow-pop + 发丝边框 + --modal-max", () => {
  const body = blockBody(".modal");
  assert.match(body, /max-width:\s*var\(--modal-max\)/);
  assert.match(body, /border:\s*1px solid var\(--border\)/);
  assert.match(body, /border-radius:\s*var\(--r-xl\)/);
  assert.match(body, /box-shadow:\s*var\(--shadow-pop\)/);
  assert.match(body, /background:\s*var\(--surface\)/);
  // 旧方向的粗结构线（2px ink）与本契约互斥
  assert.doesNotMatch(body, /2px solid/);
  assert.doesNotMatch(body, /var\(--ink\)/);
});

test(".modal.wide：宽度来自 --modal-wide-max", () => {
  assert.match(blockBody(".modal.wide"), /max-width:\s*var\(--modal-wide-max\)/);
});

test(".modal-head / .modal-body / .modal-foot：三段结构落盘（foot 有 .sep 弹性占位）", () => {
  assert.match(blockBody(".modal-head"), /padding:/);
  assert.match(blockBody(".modal-head h2"), /font-weight:\s*var\(--fw-heavy\)/);
  assert.match(blockBody(".modal-body"), /padding:/);
  const foot = blockBody(".modal-foot");
  assert.match(foot, /display:\s*flex/);
  assert.match(blockBody(".modal-foot .sep"), /flex:\s*1/);
});
