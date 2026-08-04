import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ReminderModal } = await jiti.import("./ReminderModal.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function renderI18n(children) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, children));
}

test("ReminderModal renders the create form with target badge and recurrence presets", () => {
  const html = renderI18n(
    React.createElement(ReminderModal, {
      targetId: "msg-1",
      targetLabel: "#4 Owner",
      defaultTitle: "follow up",
      channelId: "#all",
      onClose: () => undefined,
      onChanged: () => undefined,
    }),
  );
  assert.match(html, /Set reminder/);
  assert.match(html, /#4 Owner/);
  assert.match(html, /follow up/);
  assert.match(html, /type="datetime-local"/);
  assert.match(html, /every:1m/);
  assert.match(html, /weekly:mon,fri@09:00/);
  assert.match(html, /Create reminder/);
  assert.match(html, /Anchored reminders/);
  assert.match(html, /No reminders anchored here yet/);
  // §3.9 作者选择：默认 Owner
  assert.match(html, /Owner \(you\)/);
});

test("ReminderModal escapes and closes", () => {
  const html = renderI18n(
    React.createElement(ReminderModal, {
      targetId: "#all",
      targetLabel: "#all",
      channelId: "#all",
      onClose: () => undefined,
      onChanged: () => undefined,
    }),
  );
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /type="text"/);
});
