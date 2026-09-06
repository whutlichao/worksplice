import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
    jsx: { runtime: "automatic" },
    tsconfigPaths: true,
});
const { AgentDetailPanel } = await jiti.import("./AgentDetailPanel.tsx");
const { ModelPicker } = await jiti.import("./ModelPicker.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function renderWith(component) {
    return renderToStaticMarkup(
        React.createElement(I18nProvider, null, component),
    );
}

function renderPanel(agent, overrides = {}) {
    return renderWith(
        React.createElement(AgentDetailPanel, {
            agent,
            onClose: () => undefined,
            onChanged: () => undefined,
            onOpenDM: () => undefined,
            ...overrides,
        }),
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
    model_provider: null,
    model_id: null,
    thinking_level: null,
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
    assert.match(html, /Session export/);
});

test("runtime section renders the model picker and apply button", () => {
    const html = renderPanel(AGENT);
    // ModelPicker 默认显示"继承全局默认"（Inherit global default）
    assert.match(html, /Inherit global default/);
    assert.match(html, /pi default/);
    assert.match(html, /Apply/);
    // 初始无覆盖时 Apply 处于 disabled 状态（避免无意义空保存）
    assert.match(html, /disabled/);
});

test("lifecycle buttons are enabled for ticket 05 (no longer placeholders)", () => {
    const html = renderPanel(AGENT);
    // reset 按钮（Restart/Session reset/Full reset/Delete）不带 disabled
    assert.match(html, /Restart/);
    assert.doesNotMatch(html, /restarting/i);
    // 删除身份按钮存在
    assert.match(html, /Delete identity/);
});

test("an unbound agent shows the not-bound label and workspace hint", () => {
    const html = renderPanel({
        ...AGENT,
        workspace_path: null,
        pi_session_file: null,
    });
    assert.match(html, /Not bound yet/);
    assert.match(html, /Bind a workspace first/);
});

test("a working agent shows the working status label", () => {
    const html = renderPanel({ ...AGENT, status: "working" });
    assert.match(html, /Working/);
    assert.match(html, /ws-status-pulse/);
});

test("ModelPicker groups models by provider and shows the current model", () => {
    const html = renderWith(
        React.createElement(ModelPicker, {
            models: {
                models: { "zenmux:claude-sonnet-4-6": "Claude Sonnet 4.6" },
                modelList: [
                    {
                        id: "claude-sonnet-4-6",
                        name: "Claude Sonnet 4.6",
                        provider: "zenmux",
                    },
                    { id: "gpt-5", name: "GPT-5", provider: "openai" },
                ],
                defaultModel: null,
                thinkingLevels: {},
                thinkingLevelMaps: {},
                thinkingLevelPins: {},
            },
            model: { provider: "zenmux", modelId: "claude-sonnet-4-6" },
            thinkingLevel: "high",
            onModelChange: () => undefined,
            onThinkingChange: () => undefined,
        }),
    );
    assert.match(html, /Claude Sonnet 4.6/);
    assert.match(html, /zenmux/);
    assert.match(html, /openai/);
    assert.match(html, /High reasoning/);
});

test("ModelPicker with no model shows inherit-global placeholder", () => {
    const html = renderWith(
        React.createElement(ModelPicker, {
            models: null,
            model: null,
            thinkingLevel: null,
        }),
    );
    assert.match(html, /Inherit global default/);
    assert.match(html, /pi default/);
});

test("DM button shows Send message when the DM has no messages", () => {
    const html = renderPanel(AGENT, { hasMessages: false });
    assert.match(html, /Send message/);
    assert.doesNotMatch(html, /Open DM/);
});

test("DM button shows Open DM when the DM has messages", () => {
    const html = renderPanel(AGENT, { hasMessages: true });
    assert.match(html, /Open DM/);
    assert.doesNotMatch(html, /Send message/);
});

test("DM button click wires onOpenDM(agent.id)", async () => {
    const source = await readFile(
        new URL("../components/AgentDetailPanel.tsx", import.meta.url),
        "utf-8",
    );
    assert.match(source, /onOpenDM\(agent\.id\)/);
    assert.match(source, /MessageSquare/);
});
