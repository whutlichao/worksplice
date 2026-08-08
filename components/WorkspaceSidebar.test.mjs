import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { WorkspaceSidebar } = await jiti.import("./WorkspaceSidebar.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function renderI18n(children) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, children));
}

function reminderButtonHtml(count) {
  const html = renderI18n(
    React.createElement(WorkspaceSidebar, {
      channels: [],
      agents: [],
      error: null,
      selectedChannelId: null,
      onSelectChannel: () => undefined,
      onOpenAgent: () => undefined,
      onNewChannel: () => undefined,
      onNewAgent: () => undefined,
      onOpenModels: () => undefined,
      onOpenSkills: () => undefined,
      onOpenReminders: () => undefined,
      scheduledReminderCount: count,
      onCloseMenu: () => undefined,
      onSearch: () => undefined,
    }),
  );
  const btn = html.match(/<button[^>]*title="My reminders"[^>]*>[\s\S]*?<\/button>/)?.[0];
  assert.ok(btn, "reminder button should render");
  const tag = btn.match(/^<button[^>]*>/)?.[0] ?? "";
  return { html, tag, inner: btn.replace(/^<button[^>]*>/, "").replace(/<\/button>$/, "") };
}

test("reminder entry is a compact icon-only button (§5.6): no label to wrap or shrink the icon", () => {
  const { tag, inner } = reminderButtonHtml(0);
  // 回归：40px 宽 flex:1 按钮内 "My reminders" 折行、AlarmClock 被 flex-shrink 压到 7px
  assert.doesNotMatch(inner, /My reminders/);
  assert.doesNotMatch(tag, /flex:/);
  assert.match(tag, /width:34px/);
  assert.match(inner, /width="18" height="18"/);
});

test("reminder entry shows a count badge when scheduled reminders exist", () => {
  const { inner } = reminderButtonHtml(3);
  assert.match(inner, />3<\/span>/);
  assert.doesNotMatch(inner, /My reminders/);
});

test("reminder entry stays icon-only when count is 0 (no stub label)", () => {
  const { inner } = reminderButtonHtml(0);
  assert.doesNotMatch(inner, /<span/);
});
