/**
 * 头像原语（票 04，D6 改判）：首字 tile。
 *
 * 断言落在产品真正渲染出的 markup 上（仓库既有 seam：jiti + renderToStaticMarkup）：
 * 首字 / 三档 `.avatar` class / `--av-*` 取色 / 人类恒 `--av-4` / 名称缺失的回退；
 * 形态（尺寸取自 `--avatar-sm|md|lg`、7px 圆角、`.lg` 用 `--r-md`）见
 * components/primitives.test.mjs 的 `.avatar` class 块断言。
 */
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { Avatar } = await jiti.import("./Avatar.tsx");

function render(props) {
  return renderToStaticMarkup(React.createElement(Avatar, props));
}

test("Avatar 渲染 agent 名称首字符并转大写", () => {
  const html = render({ name: "bob", colorKey: "agent-1" });
  assert.match(html, />B</);
  assert.doesNotMatch(html, />b</);
});

test("Avatar 人类恒「我」并恒取 --av-4", () => {
  const html = render({ name: "Lin", type: "human", size: "lg", colorKey: "owner" });
  assert.match(html, />我</);
  assert.match(html, /var\(--av-4\)/);
});

test("Avatar 人类形态压过取色参数（即便传了别的 id）", () => {
  const html = render({ name: "Lin", type: "human", colorKey: "agent-9" });
  assert.match(html, /var\(--av-4\)/);
});

test("Avatar 三档尺寸走 .avatar / .avatar.sm / .avatar.lg", () => {
  assert.match(render({ name: "bob", colorKey: "a" }), /class="avatar"/);
  assert.match(render({ name: "bob", size: "sm", colorKey: "a" }), /class="avatar sm"/);
  assert.match(render({ name: "bob", size: "lg", colorKey: "a" }), /class="avatar lg"/);
});

test("Avatar 名称为空 → 占位 ?，aria-label 回退到 member id", () => {
  const html = render({ name: undefined, colorKey: "hit-author-id" });
  assert.match(html, />\?</);
  assert.match(html, /aria-label="hit-author-id"/);
});

test("Avatar 取色：序号直接映射 --av-0…--av-4（列表内调用点）", () => {
  assert.match(render({ name: "a", colorKey: 0 }), /var\(--av-0\)/);
  assert.match(render({ name: "b", colorKey: 2 }), /var\(--av-2\)/);
  assert.match(render({ name: "c", colorKey: 7 }), /var\(--av-2\)/);
});

test("Avatar 取色：同一 member id 在任何位置恒定同色", () => {
  const first = render({ name: "bob", size: "sm", colorKey: "agent-42" });
  const second = render({ name: "bob", size: "lg", colorKey: "agent-42" });
  const tokenOf = (html) => html.match(/var\(--av-[0-4]\)/)[0];
  assert.equal(tokenOf(first), tokenOf(second));
  assert.match(first, /var\(--av-[0-4]\)/);
});

test("Avatar 无像素图案 / 无 ink 边框 / 无硬阴影", () => {
  const html = render({ name: "bob", colorKey: "agent-1" });
  assert.doesNotMatch(html, /pixelated/);
  assert.doesNotMatch(html, /2px solid/);
  assert.doesNotMatch(html, /border/);
  assert.doesNotMatch(html, /<svg/);
});
