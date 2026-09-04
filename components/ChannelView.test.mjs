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
  assert.match(html, /title="Reply in thread"/);
  assert.match(html, /title="Quote"/);
  assert.match(html, /title="Copy link"/);
  // §5.6 UI 入口：未提供 onSetReminder 时不渲染提醒按钮
  assert.doesNotMatch(html, /Set a reminder on this message/);
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
  assert.match(html, /Set a reminder on this message/);
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

test("ChannelView shows the channel header with the members entry and archive badge", () => {
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
  assert.match(html, /Archived/);
  // 成员数不再有独立徽标：数量只出现在可展开的成员面板入口按钮（含人类）
  assert.match(html, /Channel members/);
  assert.doesNotMatch(html, /2 members/);
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

test("ChannelView 轮询收敛：消息数据循环由 useChannelData 持有（01 票）", async () => {
  const source = await readFile(new URL("../components/ChannelView.tsx", import.meta.url), "utf-8");
  const hookSource = await readFile(new URL("../hooks/useChannelData.ts", import.meta.url), "utf-8");
  // 视图侧：消费 hook，不再自持有轮询/合并实现。
  assert.match(source, /useChannelData\(channel\?\.id\)/);
  assert.match(source, /loadEarlierPage\(\)/);
  // hook 侧：持有轮询纪律（setInterval + 3s + 后台 tab 暂停 + 卸载清理）与合并。
  assert.match(hookSource, /setInterval/);
  assert.match(hookSource, /CHANNEL_POLL_MS/);
  assert.match(hookSource, /applyPollPage/);
  assert.match(hookSource, /document\.hidden/);
  assert.match(hookSource, /clearInterval/);
});

test("MessageRow renders quick reactions, picker, pin and attachments (§3.4/§3.5)", () => {
  const html = renderI18n(
    React.createElement(MessageRow, {
      message: {
        ...MESSAGE,
        reactions: [
          { emoji: "👍", count: 2, memberIds: ["owner", "agent-1"] },
          { emoji: "❤️", count: 1, memberIds: ["agent-1"] },
        ],
        attachments: [
          {
            id: "att-1",
            message_id: "msg-1",
            file_name: "note.txt",
            mime: "text/plain",
            size_bytes: 2048,
            disk_path: "/tmp/attachments/att-1",
            created_at: "2026-08-03T08:00:00.000Z",
          },
          {
            id: "att-2",
            message_id: "msg-1",
            file_name: "bundle.zip",
            mime: "application/zip",
            size_bytes: 4096,
            disk_path: "/tmp/attachments/att-2",
            created_at: "2026-08-03T08:00:00.000Z",
          },
        ],
      },
      currentMemberId: "owner",
      onReply: () => undefined,
      onQuote: () => undefined,
      onCopyLink: () => undefined,
      onToggleReaction: () => undefined,
      onTogglePin: () => undefined,
      pinned: true,
    }),
  );

  assert.match(html, /👍/);
  assert.match(html, /❤️/);
  assert.match(html, /2/);
  // 动作栏默认折叠：只出 SmilePlus 入口；emoji 快捷条与 ＋ 选择器需展开才有
  assert.match(html, /title="Add a reaction"/);
  assert.doesNotMatch(html, /＋/);
  assert.match(html, /title="Unpin"/);
  // text-like 附件 = 展开预览按钮；其余 = 下载链接
  assert.match(html, /note\.txt/);
  assert.match(html, /2\.0 KB/);
  assert.match(html, /lucide-file-text/);
  assert.match(html, /bundle\.zip/);
  assert.match(html, /\/api\/attachments\/att-2/);
});

test("MessageRow hides reaction UI when handlers are absent", () => {
  const html = renderI18n(
    React.createElement(MessageRow, {
      message: MESSAGE,
      onReply: () => undefined,
      onQuote: () => undefined,
      onCopyLink: () => undefined,
    }),
  );
  assert.doesNotMatch(html, /＋/);
  assert.doesNotMatch(html, /📌/);
});

test("MessageRow renders the not-replied badge with agent name in the tooltip (§09)", () => {
  const calls = { member: null };
  const html = renderI18n(
    React.createElement(MessageRow, {
      message: {
        ...MESSAGE,
        abandonedMarks: [
          { agentId: "agent-1", agentName: "Nova", reason: "retries exhausted", baseSeq: 4, createdAt: "2026-08-12T00:00:00.000Z" },
        ],
      },
      onReply: () => undefined,
      onQuote: () => undefined,
      onCopyLink: () => undefined,
      onOpenMember: (memberId) => {
        calls.member = memberId;
      },
    }),
  );

  assert.match(html, /title="Nova：retries exhausted"/);
  assert.match(html, /No reply/);
  assert.match(html, /lucide-circle-slash/);
});

test("MessageRow renders a count badge when multiple agents abandoned the message", () => {
  const html = renderI18n(
    React.createElement(MessageRow, {
      message: {
        ...MESSAGE,
        abandonedMarks: [
          { agentId: "agent-1", agentName: "Nova", reason: "r1", baseSeq: 4, createdAt: "2026-08-12T00:00:00.000Z" },
          { agentId: "agent-2", agentName: "Pulse", reason: "r2", baseSeq: 4, createdAt: "2026-08-12T00:00:00.000Z" },
        ],
      },
      onReply: () => undefined,
      onQuote: () => undefined,
      onCopyLink: () => undefined,
    }),
  );

  assert.match(html, /title="Nova：r1；Pulse：r2"/);
  assert.match(html, /2 agents did not reply/);
});

test("MessageRow does not render the not-replied badge without abandonedMarks", () => {
  const html = renderI18n(
    React.createElement(MessageRow, {
      message: MESSAGE,
      onReply: () => undefined,
      onQuote: () => undefined,
      onCopyLink: () => undefined,
    }),
  );
  assert.doesNotMatch(html, /No reply/);
  assert.doesNotMatch(html, /lucide-circle-slash/);
});

test("Composer renders the paperclip attach control (§3.5)", () => {
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
  assert.match(html, /Attach files \(max 50 MB each\)/);
  assert.match(html, /type="file"/);
});

test("ChannelView header exposes the pinned toggle for joined members (§3.5)", () => {
  const channel = {
    id: "c1",
    name: "general",
    type: "public",
    description: "",
    archived: 0,
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
  assert.match(html, /Toggle pinned messages/);
});
