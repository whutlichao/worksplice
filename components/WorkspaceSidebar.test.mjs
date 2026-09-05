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

function sidebarHtml(channels) {
  return renderI18n(
    React.createElement(WorkspaceSidebar, {
      channels,
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
      scheduledReminderCount: 0,
      onCloseMenu: () => undefined,
      onSearch: () => undefined,
    }),
  );
}

function channelRow(html, name) {
  const re = new RegExp(`<button[^>]*>[\\s\\S]*?${name}[\\s\\S]*?<\\/button>`);
  const row = html.match(re)?.[0];
  assert.ok(row, `channel row for ${name} should render`);
  return row;
}

test("BAI-6: a channel with unread shows a count badge", () => {
  const html = sidebarHtml([{ id: "c1", name: "reads", type: "public", unread: 3 }]);
  const row = channelRow(html, "reads");
  assert.match(row, />3<\/span>/);
  assert.match(row, /99\+|3/);
});

test("BAI-6: unread is capped at 99+", () => {
  const html = sidebarHtml([{ id: "c1", name: "many", type: "public", unread: 120 }]);
  const row = channelRow(html, "many");
  assert.match(row, /99\+/);
});

test("BAI-6: no badge when unread is 0", () => {
  const html = sidebarHtml([{ id: "c1", name: "quiet", type: "public", unread: 0 }]);
  const row = channelRow(html, "quiet");
  assert.doesNotMatch(row, /99\+|>[1-9]\d*<\/span>/);
});

test("DM channels render in a separate 私信 group, stripped of the dm:owner↔ prefix", () => {
  const html = sidebarHtml([
    { id: "dm:owner↔Zeta", name: "dm:owner↔Zeta", type: "dm", unread: 0 },
    { id: "c1", name: "general", type: "public", unread: 0 },
    { id: "dm:owner↔Alpha", name: "dm:owner↔Alpha", type: "dm", unread: 0 },
    { id: "dm:owner↔Mike", name: "dm:owner↔Mike", type: "dm", unread: 0 },
  ]);
  // 独立分组标题（私信）与频道组并存
  assert.match(html, /Direct messages/);
  assert.match(html, /Channels/);
  // 前缀剥离：不渲染原始 dm:owner↔ 前缀
  assert.doesNotMatch(html, /dm:owner↔/);
  // 只显示 agent 名
  assert.match(html, /Alpha/);
  assert.match(html, /Mike/);
  assert.match(html, /Zeta/);
});

test("DM channels are sorted by agent name (id 形如 dm:owner↔<名>)", () => {
  const html = sidebarHtml([
    { id: "dm:owner↔Zeta", name: "dm:owner↔Zeta", type: "dm", unread: 0 },
    { id: "dm:owner↔Alpha", name: "dm:owner↔Alpha", type: "dm", unread: 0 },
    { id: "dm:owner↔Mike", name: "dm:owner↔Mike", type: "dm", unread: 0 },
  ]);
  assert.ok(html.indexOf(">Alpha<") < html.indexOf(">Mike<"), "Alpha before Mike");
  assert.ok(html.indexOf(">Mike<") < html.indexOf(">Zeta<"), "Mike before Zeta");
});

test("DM channel unread badge renders (unread 口径与频道一致)", () => {
  const html = sidebarHtml([{ id: "dm:owner↔Nova", name: "dm:owner↔Nova", type: "dm", unread: 7 }]);
  const row = channelRow(html, "Nova");
  assert.match(row, />7<\/span>/);
});
