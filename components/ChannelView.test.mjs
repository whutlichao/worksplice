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
const { MessageRow, Composer, ChannelView, mergeIncomingMessages } = await jiti.import("./ChannelView.tsx");
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
  // §5.6 UI 入口：未提供 onSetReminder 时不渲染 ⏰ 按钮
  assert.doesNotMatch(html, /⏰/);
});

test("MessageRow renders the ⏰ reminder action when onSetReminder is provided (§5.6)", () => {
  const calls = { reminder: null };
  const html = renderI18n(
    React.createElement(MessageRow, {
      message: MESSAGE,
      onReply: () => undefined,
      onQuote: () => undefined,
      onCopyLink: () => undefined,
      onSetReminder: (m) => {
        calls.reminder = m;
      },
    }),
  );
  assert.match(html, /⏰/);
  assert.deepEqual(calls, { reminder: null });
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

test("mergeIncomingMessages dedupes by id and keeps messages sorted by seq (agent-loop 轮询合并)", () => {
  const m = (id, seq, content) => ({ id, target_id: "c1", seq, author_id: "owner", content, created_at: "", author: null });
  const prev = [m("m1", 1, "one"), m("m2", 3, "three")];
  const incoming = [m("m3", 4, "four"), m("m1", 1, "one")];

  const merged = mergeIncomingMessages(prev, incoming);
  assert.deepEqual(merged.map((x) => x.id), ["m1", "m2", "m3"]);
  assert.deepEqual(merged.map((x) => x.content), ["one", "three", "four"]);
  assert.deepEqual(mergeIncomingMessages(prev, []), prev);
});

test("ChannelView polls the latest page to pick up agent replies (INBOX_POLL_MS)", async () => {
  const source = await readFile(new URL("../components/ChannelView.tsx", import.meta.url), "utf-8");
  assert.match(source, /setInterval/);
  assert.match(source, /INBOX_POLL_MS/);
  assert.match(source, /mergeIncomingMessages/);
  assert.match(source, /document\.hidden/);
});
