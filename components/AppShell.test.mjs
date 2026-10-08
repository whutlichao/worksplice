/**
 * 三栏骨架的形态断据（票 03，spec §3 组件表第 1/2 行 + D5/D7）。
 *
 * 两半证据，与票 02 的 T-A/T-C、票 04 的原语断言同一档：
 * ① **渲染级**：`AppShell` / `WorkspaceSidebar` 真正渲染出的 markup 里消费设计系统 token
 *    （rail 宽度 = `var(--rail-w)`、导航行 = `.nav-row`/`.is-active`、rail agent 行 = `.avatar.sm`）；
 * ② **规则体级**：骨架 class 块的形态断在 `app/globals.css` 的规则体上（与
 *    `components/primitives.test.mjs` 的 `blockBody` 同法），因为组件只写 class 名，形态全在 CSS。
 *
 * **dock 的例外（coordinator 裁决 1A）**：`.ws-right` 自 ticket 13 起是条件渲染
 * （`AppShell.tsx` 的 `{resolvablePanel && <aside className="ws-right …">}`——无选中时整栏消失），
 * 静态渲染的 `AppShell` 里**不存在**这个元素，markup 级断言够不着它。它的宽度契约因此断在
 * AppShell 源码级（inline style 里的 `var(--dock-w)`）+ `.ws-right` 规则体（含 ≤1080 收窄）。
 * 这不是断言降级：dock 在静态渲染下确实没有 markup 可断（`components/MobilePwaLayout.test.mjs`
 * 就是同类的源码级 seam）。
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
const { AppShell } = await jiti.import("./AppShell.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const globalsCss = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const appShellSource = await readFile(
  new URL("./AppShell.tsx", import.meta.url),
  "utf8",
);

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 取一条规则的声明体（选择器与 `{` 之间只允许空白，避免误命中更长的选择器）。 */
function ruleBody(selector) {
  const pattern = new RegExp(
    `(?:^|[}])\\s*${escapeRe(selector)}\\s*\\{([^}]*)\\}`,
    "m",
  );
  const match = globalsCss.match(pattern);
  assert.ok(match, `globals.css 缺少规则 \`${selector}\``);
  return match[1];
}

/** 抽一段 at-rule / 规则块（花括号配平；媒体查询里有多条规则）。 */
function cssBlock(header) {
  const start = globalsCss.indexOf(header);
  assert.ok(start >= 0, `globals.css 缺少 \`${header}\``);
  const open = globalsCss.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < globalsCss.length; i += 1) {
    if (globalsCss[i] === "{") depth += 1;
    else if (globalsCss[i] === "}") {
      depth -= 1;
      if (depth === 0) return globalsCss.slice(open + 1, i);
    }
  }
  assert.fail(`globals.css 的 \`${header}\` 块未闭合`);
}

/** 骨架段正文：`.ws-shell` 起、到原语段注释前的整段（`ws-*` 骨架 + 票 03 新落的 rail 块）。 */
function skeletonSection() {
  const start = globalsCss.indexOf(".ws-shell {");
  assert.ok(start >= 0, "globals.css 缺少 `.ws-shell` 规则");
  const end = globalsCss.indexOf("原语 class 块");
  assert.ok(end > start, "globals.css 缺少原语段标记（骨架段的右边界）");
  return globalsCss.slice(start, end);
}

let cachedShell = null;
function shellHtml() {
  if (cachedShell === null) {
    cachedShell = renderToStaticMarkup(
      React.createElement(I18nProvider, null, React.createElement(AppShell)),
    );
  }
  return cachedShell;
}

// ─── .app 语义与三栏容器 ─────────────────────────────────────────────────────

test("骨架三栏：AppShell 渲染出 ws-* 钩子，rail 宽度消费 var(--rail-w)（不用字面量 236px）", () => {
  const html = shellHtml();
  assert.match(html, /class="ws-shell"/);
  assert.match(html, /class="ws-left"/);
  assert.match(html, /class="ws-center"/);
  // 渲染级 token 契约：rail 的宽度取自设计系统（252px），不是票 02 之前的 236px 字面量。
  assert.match(html, /width:var\(--rail-w\)/);
  assert.doesNotMatch(html, /236px/);
  assert.doesNotMatch(html, /480px/);
});

test("dock 宽度契约：AppShell 源码级 var(--dock-w) + .ws-right 规则体 + ≤1080 收窄到 --dock-w-md", () => {
  // dock 条件渲染（见文件头），源码级断据 + 规则体断据是它的正解。
  assert.match(appShellSource, /width:\s*"var\(--dock-w\)"/);
  assert.doesNotMatch(appShellSource, /\b(?:236|480)px\b/);

  const dock = ruleBody(".ws-right");
  assert.doesNotMatch(dock, /\b(?:236|380|480)px\b/);
  assert.match(dock, /border-left:\s*1px solid var\(--border\)/);
  assert.match(dock, /background:\s*var\(--surface\)/);

  // D5：≤1080 收窄到 --dock-w-md（340px）；桌面宽度由 AppShell 的 inline token 给
  // （inline 宽度是渲染级契约，故断点收窄走 max-width——作者样式表无需 !important）。
  const md = cssBlock("@media (max-width: 1080px)");
  assert.match(md, /\.ws-right\s*\{[^}]*max-width:\s*var\(--dock-w-md\)/);
});

test(".ws-shell 取 .app 语义（flex 列 + overflow:hidden），两栏分隔是发丝", () => {
  const shell = ruleBody(".ws-shell");
  assert.match(shell, /display:\s*flex/);
  assert.match(shell, /overflow:\s*hidden/);
  // 视口高度由 AppShell 的 inline var(--app-viewport-height, 100dvh) 接管
  // （iOS 键盘护栏，见 components/MobilePwaLayout.test.mjs）。

  assert.match(ruleBody(".ws-center"), /display:\s*flex/);
  assert.match(ruleBody(".ws-left"), /border-right:\s*1px solid var\(--border\)/);
  assert.match(ruleBody(".ws-left"), /background:\s*var\(--panel\)/);
  assert.match(ruleBody(".ws-right"), /border-left:\s*1px solid var\(--border\)/);

  // 「无有色 2px 结构线」的全局断言在 app/globals.test.mjs 的 T-C；此处把**整段骨架**
  // （ws-* + 票 03 的 rail 块）单独再钉一次。
  assert.doesNotMatch(
    skeletonSection(),
    /border(?:-[a-z]+)?:\s*[^;{}]*\b2px\s+solid\s+(?!transparent)/,
  );
});

test("z-index 阶梯全部取自 --z-*（骨架段无数字 z-index）", () => {
  assert.match(cssBlock("@media (max-width: 900px)"), /z-index:\s*var\(--z-rail\)/);
  assert.match(cssBlock("@media (max-width: 900px)"), /z-index:\s*var\(--z-dock\)/);
  assert.match(cssBlock("@media (max-width: 900px)"), /z-index:\s*var\(--z-scrim\)/);
  assert.match(ruleBody(".ws-mobile-toggle"), /z-index:\s*var\(--z-topbar\)/);

  assert.doesNotMatch(skeletonSection(), /z-index:\s*\d/);
});

test("≤900 抽屉：scrim + transform + --dur-drawer/--ease（960 退场由 T-C 守）", () => {
  const compact = cssBlock("@media (max-width: 900px)");
  assert.match(compact, /\.ws-left\s*\{[^}]*transform:\s*translateX\(/);
  assert.match(
    compact,
    /transition:\s*transform var\(--dur-drawer\) var\(--ease\)/,
  );
  assert.match(compact, /\.ws-left\.ws-left-open\s*\{[^}]*transform:\s*translateX\(0\)/);
  assert.match(compact, /\.ws-right\.ws-right-open\s*\{[^}]*transform:\s*translateX\(0\)/);
  // scrim：抽屉遮罩（点按关闭）在紧凑端出现
  assert.match(compact, /\.ws-backdrop\s*\{[^}]*display:\s*block/);

  // 900/1080 的成对断言（含 960 退场）由 app/globals.test.mjs 的
  // `T-C: 断点对齐上游（900 / 1080），旧的 960 退场` 守；本票不重复。
});

// ─── rail 形态（spec §3 组件表第 2 行；块逐字搬自 ui_kits/app/app.css） ──────

test("rail 形态落盘：rail-head / brand* / search-btn / rail-actions / rail-scroll / rail-foot", () => {
  // 渲染级：AppShell 渲染出的 rail markup 真的挂着这些 class（形态在 CSS，class 在 markup）。
  const html = shellHtml();
  for (const className of [
    "rail-head",
    "brand",
    "brand-mark",
    "brand-name",
    "brand-sub",
    "search-shell",
    "search-btn",
    "rail-actions",
    "rail-scroll",
    "group-label",
    "rail-foot",
  ]) {
    assert.match(
      html,
      new RegExp(`class="[^"]*\\b${className}\\b`),
      `rail markup 缺少 .${className}`,
    );
  }
  // postmark 文案：mono 大写由 CSS 出，字符串本身是正常大小写（`lib/i18n` 的 shell.brandSub）。
  assert.match(html, /class="brand-sub">Local workspace</);

  assert.match(ruleBody(".rail-head"), /padding:\s*var\(--sp-6\) var\(--sp-5\) var\(--sp-5\)/);
  assert.match(ruleBody(".brand"), /flex:\s*1/);
  assert.match(ruleBody(".brand-mark"), /background:\s*var\(--accent\)/);
  assert.match(ruleBody(".brand-mark"), /border-radius:\s*7px/);
  assert.match(ruleBody(".brand-name"), /font-size:\s*var\(--fs-body-lg\)/);
  assert.match(ruleBody(".brand-sub"), /font-family:\s*var\(--mono\)/);
  assert.match(ruleBody(".brand-sub"), /letter-spacing:\s*var\(--ls-wide\)/);

  assert.match(ruleBody(".search-shell"), /padding:\s*0 var\(--sp-5\) 10px/);
  assert.match(ruleBody(".search-btn"), /border:\s*1px solid var\(--border\)/);
  assert.match(ruleBody(".search-btn"), /border-radius:\s*var\(--r-md\)/);
  assert.match(ruleBody(".search-btn"), /background:\s*var\(--surface\)/);
  // 搜索入口的焦点环（ED-8）：字段环落在 shell 上，不是内层 input
  // 票 03：字段环走图形档（≥3:1）。判据（环存在且是 accent 族）不变。
  assert.match(ruleBody(".search-btn:focus-within"), /border-color:\s*var\(--accent-graphic\)/);
  assert.match(
    ruleBody(".search-btn:focus-within"),
    /box-shadow:\s*0 0 0 3px var\(--accent-soft\)/,
  );

  assert.match(ruleBody(".rail-actions"), /gap:\s*var\(--sp-4\)/);
  assert.match(ruleBody(".rail-actions"), /border-bottom:\s*1px solid var\(--border\)/);
  // 行内两个创建按钮的内边距收一档：英文 "New channel"/"New agent" 在 252px rail 下合不拢
  // （自然宽 237.5px > 内容宽 227px）→ 只覆盖这一行，`.btn` 原语保持 `--sp-5`
  assert.match(ruleBody(".rail-actions .btn"), /padding:\s*0 var\(--sp-4\)/);
  assert.match(ruleBody(".btn"), /padding:\s*0 var\(--sp-5\)/);
  assert.match(ruleBody(".rail-scroll"), /overflow-y:\s*auto/);
  assert.match(ruleBody(".rail-scroll"), /min-height:\s*0/);
  assert.match(ruleBody(".rail-foot"), /border-top:\s*1px solid var\(--border\)/);
  assert.match(ruleBody(".rail-foot"), /gap:\s*var\(--sp-3\)/);
});

test(".group-label：mono 9.5px + letter-spacing .1em + 大写（--faint）", () => {
  const label = ruleBody(".group-label");
  assert.match(label, /font-family:\s*var\(--mono\)/);
  assert.match(label, /font-size:\s*var\(--fs-mono-micro\)/);
  assert.match(label, /letter-spacing:\s*var\(--ls-wider\)/);
  assert.match(label, /text-transform:\s*uppercase/);
  assert.match(label, /color:\s*var\(--faint\)/);
});

test("导航激活态 = --surface 填充 + inset 发丝 + 2px 选中族竖条 + 选中族 mono #（不是黄色实心）", () => {
  const active = ruleBody(".nav-row.is-active");
  assert.match(active, /background:\s*var\(--surface\)/);
  assert.match(active, /color:\s*var\(--fg\)/);
  assert.match(active, /box-shadow:\s*inset 0 0 0 1px var\(--border\)/);

  // 票 03：导航激活是「当前位置」→ 选中族（竖条走图形档、mono # 走文字档）。
  // 判据（不是黄色实心、竖条可见、mono # 可读）不变。
  const bar = ruleBody(".nav-row.is-active::before");
  assert.match(bar, /content:\s*""/);
  assert.match(bar, /width:\s*2px/);
  assert.match(bar, /background:\s*var\(--selected-graphic\)/);
  assert.match(ruleBody(".nav-row.is-active .hash"), /color:\s*var\(--selected-deep\)/);

  // 行形态（含行高重校：22px 头像 + 6px 上下 padding = 34px 行，取代旧的 28px 头像 + 4px 外距）
  const row = ruleBody(".nav-row");
  assert.match(row, /display:\s*flex/);
  assert.match(row, /gap:\s*var\(--sp-4\)/);
  assert.match(row, /padding:\s*var\(--sp-3\) 9px/);
  assert.match(row, /border-radius:\s*var\(--r-sm\)/);
  assert.match(row, /color:\s*var\(--muted\)/);
  assert.match(ruleBody(".nav-row .hash"), /flex:\s*0 0 13px/);
  assert.match(ruleBody(".nav-row .grow"), /text-overflow:\s*ellipsis/);
});
