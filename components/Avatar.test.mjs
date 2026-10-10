/**
 * 头像原语（票 04，D6 改判）：首字 tile。
 *
 * 断言落在产品真正渲染出的 markup 上（仓库既有 seam：jiti + renderToStaticMarkup）：
 * 首字 / `.avatar` 三档 class / `av-N` 色格 / 人类恒 `av-4` / 名称缺失的回退；
 * class 与 token 的绑定（`--avatar-sm|md|lg`、`--av-*`、7px 圆角、`.lg` 用 `--r-md`）
 * 见 components/primitives.test.mjs 的 `.avatar` 块断言。
 * 人类标记「我」是 UI 文案，走 i18n（docs/i18n.md 分层规则）而非硬编码。
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
const { Avatar } = await jiti.import("./Avatar.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function render(props) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(Avatar, props)),
  );
}

test("Avatar 渲染 agent 名称首字符并转大写", () => {
  const html = render({ name: "bob", colorKey: "agent-1" });
  assert.match(html, />B</);
  assert.doesNotMatch(html, />b</);
});

test("Avatar 人类的「我」走 i18n：zh-CN 包为「我」，渲染取当前语言（SSR 默认 en）", async () => {
  const { zhCNLocale } = await import("../lib/i18n/messages/zh-CN.ts");
  assert.equal(zhCNLocale.messages["avatar.you"], "我");

  const html = render({ name: "Lin", type: "human", size: "lg", colorKey: "owner" });
  assert.match(html, />You</);
  assert.match(html, /av-4/);
});

test("Avatar 人类形态压过取色参数（即便传了别的 id）", () => {
  const html = render({ name: "Lin", type: "human", colorKey: "agent-9" });
  assert.match(html, /av-4/);
  assert.doesNotMatch(html, /av-[0-3]\b/);
});

test("Avatar 三档尺寸走 .avatar / .avatar.sm / .avatar.lg", () => {
  assert.match(render({ name: "bob", colorKey: "a" }), /class="avatar av-\d"/);
  assert.match(render({ name: "bob", size: "sm", colorKey: "a" }), /class="avatar sm av-\d"/);
  assert.match(render({ name: "bob", size: "lg", colorKey: "a" }), /class="avatar lg av-\d"/);
});

test("Avatar 名称为空 → 占位 ?，aria-label 回退到 member id", () => {
  const html = render({ name: undefined, colorKey: "hit-author-id" });
  assert.match(html, />\?</);
  assert.match(html, /aria-label="hit-author-id"/);
});

test("Avatar 取色：数字 key 显式映射色板位置，不作成员列表身份", () => {
  assert.match(render({ name: "a", colorKey: 0 }), /class="avatar av-0"/);
  assert.match(render({ name: "b", colorKey: 2 }), /class="avatar av-2"/);
  assert.match(render({ name: "c", colorKey: 7 }), /class="avatar av-2"/);
  assert.match(render({ name: "d", colorKey: 4 }), /class="avatar av-4"/);
});

test("Avatar 取色：同一 member id 在任何位置恒定同色", () => {
  const tintOf = (html) => html.match(/av-[0-4]/)[0];
  const sm = render({ name: "bob", size: "sm", colorKey: "agent-42" });
  const lg = render({ name: "bob", size: "lg", colorKey: "agent-42" });
  assert.equal(tintOf(sm), tintOf(lg));
});

test("Avatar 取色：agent 字符串 ID 只用四色，人类仍保留中性 av-4", () => {
  const agentHtml = render({
    name: "Fixture",
    type: "agent",
    colorKey: "agent-fixture-0",
  });
  assert.match(agentHtml, /class="avatar av-[0-3]"/);
  assert.doesNotMatch(agentHtml, /class="avatar av-4"/);

  const humanHtml = render({
    name: "Owner",
    type: "human",
    colorKey: "owner",
  });
  assert.match(humanHtml, /class="avatar av-4"/);
  assert.doesNotMatch(humanHtml, /class="avatar av-[0-3]"/);
});

test("Avatar 无像素图案 / 无 ink 边框 / 无硬阴影 / 无内联尺寸", () => {
  const html = render({ name: "bob", colorKey: "agent-1" });
  assert.doesNotMatch(html, /pixelated/);
  assert.doesNotMatch(html, /2px solid/);
  assert.doesNotMatch(html, /border/);
  assert.doesNotMatch(html, /<svg/);
  assert.doesNotMatch(html, /style=/);
});

test("未认领任务 chip 不渲染头像（有 owner 才渲染 Avatar）", async () => {
  const source = await readFile(new URL("./ChannelView.tsx", import.meta.url), "utf8");
  assert.match(
    source,
    /task\.owner \? \(\s*<Avatar\b[\s\S]*?\) : null\}/,
    "owner chip 的头像必须挂在 task.owner 分支里",
  );
  assert.match(
    source,
    /\{task\.owner \? task\.owner\.name : t\("tasks\.unassigned"\)\}/,
    "未认领文案仍在",
  );
});
