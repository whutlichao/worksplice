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
const { DetailPanel } = await jiti.import("./DetailPanel.tsx");
const { ThreadPanel } = await jiti.import("./ThreadPanel.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function renderWith(component) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, component));
}

const AGENT = {
  id: "agent-1",
  type: "agent",
  name: "bob",
  description: "the helper",
  role: "member",
  workspace_path: "/tmp/ws/bob",
  pi_session_file: "/tmp/ws/bob/123_session.jsonl",
  status: "offline",
  deleted: 0,
  model_provider: null,
  model_id: null,
  thinking_level: null,
  created_at: "2026-08-03T00:00:00.000Z",
};

const OWNER = {
  id: "owner",
  type: "human",
  name: "Owner",
  description: "the human boss",
  role: "owner",
  workspace_path: null,
  pi_session_file: null,
  status: "online",
  deleted: 0,
  model_provider: null,
  model_id: null,
  thinking_level: null,
  created_at: "2026-08-03T00:00:00.000Z",
};

const CHANNEL = {
  id: "c1",
  name: "general",
  type: "public",
  description: "chat",
  archived: 0,
  created_at: "2026-08-03T00:00:00.000Z",
  joined: true,
  memberCount: 2,
};

const ANCHOR = {
  id: "m1",
  target_id: "c1",
  seq: 3,
  author_id: "owner",
  content: "anchor message",
  created_at: "2026-08-03T08:00:00.000Z",
  author: OWNER,
};

const REPLY = {
  id: "m2",
  target_id: "m1",
  seq: 4,
  author_id: "agent-1",
  content: "thread reply",
  created_at: "2026-08-03T08:00:01.000Z",
  author: AGENT,
};

function renderDetailPanel(content, overrides = {}) {
  return renderWith(
    React.createElement(DetailPanel, {
      content,
      channel: CHANNEL,
      agents: [AGENT],
      owner: OWNER,
      currentMemberId: "owner",
      onClose: () => undefined,
      onChanged: () => undefined,
      onOpenPanel: () => undefined,
      ...overrides,
    }),
  );
}

test("DetailPanel agent 变体渲染详情区块（复用 AgentDetailPanel 断言面）", () => {
  const html = renderDetailPanel({ kind: "agent", id: "agent-1" });
  assert.match(html, /bob/);
  assert.match(html, /the helper/);
  assert.match(html, /Restart/);
  assert.match(html, /Session reset/);
  assert.match(html, /Tokens \/ cost/);
  assert.match(html, /Task history/);
});

test("DetailPanel agent 变体：未知 agent id 空渲染（不炸）", () => {
  const html = renderDetailPanel({ kind: "agent", id: "ghost" });
  assert.equal(html, "");
});

test("DetailPanel human 变体渲染薄资料卡（名字/角色/描述/状态，无弹窗）", () => {
  const html = renderDetailPanel({ kind: "human", id: "owner" });
  assert.match(html, /Owner/);
  assert.match(html, /the human boss/);
  assert.match(html, /Owner/); // role badge
  assert.match(html, /Online/); // status
  assert.match(html, /aria-label="Close panel"/);
  assert.doesNotMatch(html, /Restart/);
});

test("DetailPanel thread 变体渲染锚点与消息（测试注入 initialAnchor/initialMessages）", () => {
  const html = renderWith(
    React.createElement(ThreadPanel, {
      anchorId: "m1",
      channel: CHANNEL,
      currentMemberId: "owner",
      agents: [AGENT],
      owner: OWNER,
      onOpenPanel: () => undefined,
      onClose: () => undefined,
      initialAnchor: ANCHOR,
      initialMessages: [REPLY],
    }),
  );
  assert.match(html, /Thread/);
  assert.match(html, /#3/);
  assert.match(html, /anchor message/);
  assert.match(html, /thread reply/);
  assert.match(html, /aria-label="Close panel"/);
  assert.match(html, /textarea/);
});

test("DetailPanel thread 变体：无锚点时渲染加载态", () => {
  const html = renderDetailPanel({ kind: "thread", id: "m1" });
  assert.match(html, /Thread/);
  assert.match(html, /Loading/);
});

test("ThreadPanel 轮询纪律：setInterval + THREAD_POLL_MS + document.hidden + 清理", async () => {
  const source = await readFile(new URL("../components/ThreadPanel.tsx", import.meta.url), "utf-8");
  assert.match(source, /setInterval/);
  assert.match(source, /THREAD_POLL_MS/);
  assert.match(source, /mergeIncomingMessages/);
  assert.match(source, /document\.hidden/);
  assert.match(source, /clearInterval/);
});
