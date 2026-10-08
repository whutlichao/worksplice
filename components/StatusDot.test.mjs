/**
 * 状态点原语（票 04）：markup 契约 = `.presence.{status}` 形态 + 该状态的语义 token。
 *
 * 断言落在产品真正渲染出的 markup 上（仓库既有 seam：jiti + renderToStaticMarkup）。
 * 形态（7px / 圆角 / working 脉冲 / reduce 收敛）由 globals.css 的 `.presence` class 块提供，
 * 见 components/primitives.test.mjs；本文件守的是「组件取那个形态、四个状态各连对语义 token」。
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
const { StatusDot } = await jiti.import("./StatusDot.tsx");

/** 四态 → 语义 token（spec ED-10 / 契约 colors_and_type.css）。 */
const STATUS_TOKEN = {
  online: "var(--online)",
  working: "var(--working)",
  error: "var(--error)",
  offline: "var(--offline)",
};

function render(status) {
  return renderToStaticMarkup(React.createElement(StatusDot, { status }));
}

test("StatusDot 四态各取 .presence.{status} 形态", () => {
  for (const status of Object.keys(STATUS_TOKEN)) {
    const html = render(status);
    assert.match(
      html,
      new RegExp(`class="presence ${status}"`),
      `${status} 未渲染 .presence.${status}`,
    );
  }
});

test("StatusDot 四态各渲染出对应的语义 token", () => {
  for (const [status, token] of Object.entries(STATUS_TOKEN)) {
    const html = render(status);
    const escaped = token.replace(/[()]/g, "\\$&");
    assert.match(html, new RegExp(escaped), `${status} 未消费 ${token}`);
  }
});

test("StatusDot 不再带 ink 粗边框与 9px 尺寸（7px 由 .presence 提供）", () => {
  for (const status of Object.keys(STATUS_TOKEN)) {
    const html = render(status);
    assert.doesNotMatch(html, /2px solid/);
    assert.doesNotMatch(html, /border/);
    assert.doesNotMatch(html, /width:\s*9px|height:\s*9px/);
  }
});

test("StatusDot working 的脉冲交给 class（不在 markup 内联 animation，reduce 才能覆盖）", () => {
  assert.doesNotMatch(render("working"), /animation/);
});

test("StatusDot 未知名状态兜底走 offline 形态（既有行为）", () => {
  const html = render("bogus");
  assert.match(html, /class="presence offline"/);
  assert.match(html, /var\(--offline\)/);
});
