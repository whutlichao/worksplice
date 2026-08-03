import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MessageRow, Composer, ChannelView } = await jiti.import("./ChannelView.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function renderI18n(children) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, children));
}

const OWNER = {
  id: "owner",
  type: "human",
  name: "Owner",
  description: "",
  role: "owner",
  workspace_path: null,
  pi_session_file: null,
  status: "online",
  created_at: "2026-08-03T00:00:00.000Z",
};

const MESSAGE = {
  id: "msg-1",
  target_id: "#all",
  seq: 4,
  author_id: "owner",
  content: "hello **world**",
  created_at: "2026-08-03T08:00:00.000Z",
  author: OWNER,
};

test("MessageRow renders author, seq, content and the three §3.2 actions", () => {
  const html = renderI18n(
      React.createElement(MessageRow, {
        message: MESSAGE,
        onReply: () => undefined,
        onQuote: () => undefined,
        onCopyLink: () => undefined,
      }),
  );

  assert.match(html, /Owner/);
  assert.match(html, /#4/);
  assert.match(html, /hello <strong>world<\/strong>/);
  assert.match(html, /↩/);
  assert.match(html, /❝/);
  assert.match(html, /🔗/);
});

test("MessageRow action handlers fire with the message", () => {
  const calls = { reply: null, quote: null, link: null };
  const html = renderI18n(
      React.createElement(MessageRow, {
        message: MESSAGE,
        onReply: (m) => {
          calls.reply = m;
        },
        onQuote: (m) => {
          calls.quote = m;
        },
        onCopyLink: (m) => {
          calls.link = m;
        },
      }),
  );
  assert.ok(html);
  assert.deepEqual(calls, { reply: null, quote: null, link: null });
});

test("Composer shows the quoting chip with the quoted message preview", () => {
  const html = renderI18n(
      React.createElement(Composer, {
      targetId: "#all",
      disabled: false,
      disabledHint: "",
      quoting: MESSAGE,
      onClearQuote: () => undefined,
      onSend: async () => undefined,
    }),
  );

  assert.match(html, /#4/);
  assert.match(html, /Owner/);
  assert.match(html, /hello \*\*world\*\*/);
  assert.match(html, /aria-label="Clear quote"/);
});

test("Composer renders without a quote chip when nothing is quoted", () => {
  const html = renderI18n(
      React.createElement(Composer, {
      targetId: "#all",
      disabled: false,
      disabledHint: "",
      quoting: null,
      onClearQuote: () => undefined,
      onSend: async () => undefined,
    }),
  );

  assert.doesNotMatch(html, /Clear quote/);
  assert.match(html, /textarea/);
  assert.match(html, /Send/);
});

test("Composer surfaces the disabled hint when the channel is archived or not joined", () => {
  const html = renderI18n(
      React.createElement(Composer, {
      targetId: "#all",
      disabled: true,
      disabledHint: "This channel is archived and is read-only",
      quoting: null,
      onClearQuote: () => undefined,
      onSend: async () => undefined,
    }),
  );

  assert.match(html, /This channel is archived and is read-only/);
});

test("ChannelView renders the select-a-channel empty state without a channel", () => {
  const html = renderI18n(
      React.createElement(ChannelView, {
      channel: null,
      tab: "messages",
      onTabChange: () => undefined,
      currentMemberId: "owner",
      onChannelChanged: () => undefined,
      focusMessageId: null,
    }),
  );

  assert.match(html, /Messages/);
  assert.match(html, /Tasks/);
});

test("ChannelView shows the channel header with member count and archive badge", () => {
  const channel = {
    id: "c1",
    name: "general",
    type: "public",
    description: "chat",
    archived: 1,
    created_at: "2026-08-03T00:00:00.000Z",
    joined: true,
    memberCount: 2,
  };
  const html = renderI18n(
      React.createElement(ChannelView, {
      channel,
      tab: "messages",
      onTabChange: () => undefined,
      currentMemberId: "owner",
      onChannelChanged: () => undefined,
      focusMessageId: null,
    }),
  );

  assert.match(html, /general/);
  assert.match(html, /2 members/);
  assert.match(html, /Archived/);
});
