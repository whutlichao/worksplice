/**
 * DirectoryPicker 的形态收口断言（票 08 第 3 条）。
 *
 * ⚠ seam 降级（协调裁决 Q1-B）：该组件没有「选中行」实体——目录行是导航入口
 * （点击即进入），唯一与「当前目录」绑定的是 path 输入框；且它用 `createPortal`
 * 挂到 body，`renderToStaticMarkup` 不跑 effect 时 `portalTarget` 仍为 null，
 * 组件直接 `return null`，markup 级断言物理不可达。因此本文件的断言落在
 * `app/globals.css` 的规则体（class 块形态）与组件源码的 class/inline 分工上。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const globalsCss = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const source = await readFile(new URL("./DirectoryPicker.tsx", import.meta.url), "utf8");

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function blockBody(selector) {
  const pattern = new RegExp(
    `(?:^|[}])\\s*${escapeRe(selector)}\\s*\\{([^}]*)\\}`,
    "m",
  );
  const match = globalsCss.match(pattern);
  assert.ok(match, `globals.css 缺少规则 \`${selector}\``);
  return match[1];
}

test("DirectoryPicker：目录行 hover 走 --fg-soft、文字走 --fg（ED-7：不降对比）", () => {
  const hover = blockBody(".directory-picker-entry:hover");
  assert.match(hover, /background:\s*var\(--fg-soft\)/);
  assert.match(hover, /color:\s*var\(--fg\)/);
});

test("DirectoryPicker：行底色/文字交给 class——inline 不再写死，否则 hover 永远不生效", () => {
  const entries = [
    ...source.matchAll(/className="directory-picker-entry"[\s\S]{0,400}?style=\{\{([^}]*)\}\}/g),
  ];
  assert.equal(entries.length, 2, "目录行与驱动器行两处都走 .directory-picker-entry");
  for (const [, style] of entries) {
    assert.doesNotMatch(style, /background:/, `行 style 不得写死 background：${style}`);
    assert.doesNotMatch(style, /(^|[\s,])color:/, `行 style 不得写死 color：${style}`);
  }
});

test("DirectoryPicker：仍无选中态（票面「选中行」无实体，Answer 已登记豁免）", () => {
  // 组件只有导航入口 + path 输入，没有 selected/is-on 之类的选中标记。
  assert.doesNotMatch(source, /is-selected|is-on|selected-\w*["']/);
  assert.doesNotMatch(globalsCss, /\.directory-picker-(entry|row)\.is-on/);
});

test("DirectoryPicker：面板形态仍消费 --shadow-pop / --r-md（票 10 的换皮不回退）", () => {
  assert.match(source, /boxShadow:\s*"var\(--shadow-pop\)"/);
  assert.match(source, /borderRadius:\s*"var\(--r-md\)"/);
  assert.doesNotMatch(source, /rgba\(0,\s*0,\s*0/);
});
