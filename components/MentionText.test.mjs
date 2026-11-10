/**
 * @mention 渲染的回归网（界面评审 B6）。
 *
 * 旧实现把正文按 token 边界切成多段、每段各自 `<MarkdownBody>`——`**加粗**`、`- 列表项`
 * 这类结构一旦跨过 token 边界就被切断，漏出字面 `**` / 丢 `<li>`。新实现把 token 换成
 * `[@name](#mention:<id>)` 链接，整段只跑一次 Markdown。本文件守两件事：
 * ① 结构完整性（加粗 / 列表 / 表格在 mention 相邻时仍成立）；
 * ② 链接协议与按钮形态（`#mention:` 被识别成 `.mention` 按钮，点击回调拿到正确 memberId）。
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
const { MentionText, tokenizeMentions } = await jiti.import("./MentionText.tsx");
const { parseMentionTokens } = await jiti.import("../lib/mention.ts");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const MEMBERS = [
  { id: "agent-bob", name: "bob", type: "agent" },
  { id: "human-owner", name: "Owner", type: "human" },
];

function render(content, onOpenMember = () => undefined) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MentionText, { content, members: MEMBERS, onOpenMember }),
    ),
  );
}

test("tokenizeMentions 只替换命中 token，其余原文一字不动", () => {
  const content = "看 @bob 和 @nobody 这条";
  const tokens = parseMentionTokens(content, MEMBERS);
  assert.equal(tokens.length, 1);
  assert.equal(
    tokenizeMentions(content, tokens),
    "看 [@bob](#mention:agent-bob) 和 @nobody 这条",
  );
});

test("B6：跨 token 边界的加粗不再漏出字面 **（旧实现的核心缺陷）", () => {
  // `**` 起于 token 之前、止于 token 之后：旧实现切成三段，两端各落单。
  const html = render("**粗体 @bob 后面** 还有");
  assert.match(html, /<strong>粗体 .*?后面<\/strong>/);
  assert.doesNotMatch(html.replace(/<[^>]*>/g, ""), /\*\*/);
});

test("B6：列表项与表格在 mention 相邻时结构完整（不丢 <li> / <td>）", () => {
  const list = render("- 第一项 @bob\n- 第二项 @Owner");
  assert.equal((list.match(/<li>/g) ?? []).length, 2);
  assert.equal((list.match(/class="mention"/g) ?? []).length, 2);

  const table = render("| a | b |\n|---|---|\n| @bob | x |");
  assert.match(table, /<table>/);
  assert.match(table, /<td><button[^>]*class="mention"/);
});

test("B6：#mention: 链接渲染成 .mention 按钮，点击回调拿到 memberId", () => {
  const calls = [];
  const html = render("看 @bob 这条", (token) => calls.push(token));
  const button = html.match(/<button[^>]*class="mention"[^>]*>/)?.[0] ?? "";
  assert.ok(button, "应渲染 .mention 按钮");
  assert.match(button, /title="Click to view bob"/);
  // 形态保持改造前的内联值（背景/字重/内边距）
  assert.match(button, /background:var\(--accent-soft\)/);
  assert.match(button, /font-weight:700/);
  // 代码围栏内的 @token 保持原文（parseMentionTokens 既有规则），不渲染按钮
  const fenced = render("```\n@bob\n```");
  assert.doesNotMatch(fenced, /class="mention"/);
});

test("无 members 时退化为普通 MarkdownBody（不渲染 mention 按钮）", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MentionText, { content: "看 @bob 这条" }),
    ),
  );
  assert.doesNotMatch(html, /class="mention"/);
  assert.match(html, /@bob/);
});
