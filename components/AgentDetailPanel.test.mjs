import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { AgentDetailPanel } = await jiti.import("./AgentDetailPanel.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function renderPanel(agent) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null,
      React.createElement(AgentDetailPanel, {
        agent,
        onClose: () => undefined,
        onChanged: () => undefined,
      }),
    ),
  );
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
  created_at: "2026-08-03T00:00:00.000Z",
};

test("AgentDetailPanel renders identity, status, workspace, reset and observability sections", () => {
  const html = renderPanel(AGENT);

  assert.match(html, /bob/);
  assert.match(html, /the helper/);
  assert.match(html, /Member/);
  assert.match(html, /Offline/);
  assert.match(html, /\/tmp\/ws\/bob/);
  assert.match(html, /Restart/);
  assert.match(html, /Session reset/);
  assert.match(html, /Full reset/);
  assert.match(html, /Delete identity/);
  assert.match(html, /Tokens \/ cost/);
  assert.match(html, /Task history/);
});

test("lifecycle buttons are enabled for ticket 05 (no longer placeholders)", () => {
  const html = renderPanel(AGENT);
  assert.doesNotMatch(html, /disabled/);
});

test("an unbound agent shows the not-bound label", () => {
  const html = renderPanel({ ...AGENT, workspace_path: null, pi_session_file: null });
  assert.match(html, /Not bound yet/);
});

test("a working agent shows the working status label", () => {
  const html = renderPanel({ ...AGENT, status: "working" });
  assert.match(html, /Working/);
  assert.match(html, /ws-status-pulse/);
});
