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

// ─── 界面评审 A6：可访问名本地化（不再是 `online` / `working` 枚举） ─────────

test("A6：无 I18nProvider 时取 en 包文案（不再是枚举原文），四态各自对得上", () => {
  const expected = { online: "Online", working: "Working", error: "Error", offline: "Offline" };
  for (const [status, label] of Object.entries(expected)) {
    const html = render(status);
    assert.match(html, new RegExp(`aria-label="${label}"`), `${status} 的可访问名`);
    assert.match(html, new RegExp(`title="${label}"`), `${status} 的 title`);
    assert.doesNotMatch(html, /aria-label="(online|working|error|offline)"/);
  }
});

test("A6：传入 translate（useI18n().t）时取 presence.* 文案（中文界面读中文）", async () => {
  const { I18nProvider, useI18n } = await jiti.import("../hooks/useI18n.tsx");
  const WithT = ({ status }) => {
    const { t } = useI18n();
    return React.createElement(StatusDot, { status, translate: t });
  };
  const renderIn = (props) =>
    renderToStaticMarkup(
      React.createElement(I18nProvider, null, React.createElement(WithT, props)),
    );
  // I18nProvider 首帧按 en 输出（hydration 一致），presence.working 的英文值是 Working。
  assert.match(renderIn({ status: "working" }), /aria-label="Working"/);
});
