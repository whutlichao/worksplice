import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ChatInput, ModelErrorBanner, ModelScopeWarningBanner, filterModelOptions, toolPresetDescription } = await jiti.import("./ChatInput.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

test("renders the upstream model error", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ModelErrorBanner, {
        error: "Invalid models.json schema:\nproviders.custom.models.0.id must not be empty",
      }),
    ),
  );

  assert.match(html, /role="alert"/);
  assert.match(html, /Model error/);
  assert.match(html, /providers\.custom\.models\.0\.id must not be empty/);
});

test("does not render an empty model error", () => {
  assert.equal(
    renderToStaticMarkup(
      React.createElement(I18nProvider, null, React.createElement(ModelErrorBanner, { error: null })),
    ),
    "",
  );
});

test("renders enabledModels scope warnings", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ModelScopeWarningBanner, {
        warnings: ['No models match pattern "ghost-gateway/*"'],
      }),
    ),
  );

  assert.match(html, /Model scope warning/);
  assert.match(html, /ghost-gateway/);
  assert.equal(
    renderToStaticMarkup(
      React.createElement(I18nProvider, null, React.createElement(ModelScopeWarningBanner, { warnings: [] })),
    ),
    "",
  );
});

test("keeps the model selector visible when a model error leaves no options", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onModelChange() {},
        isStreaming: false,
        modelError: "Invalid models.json schema",
        modelList: [],
        modelNames: {},
      }),
    ),
  );

  assert.match(html, />No models</);
  assert.match(html, /title="No available models"/);
});

test("filters model options by name and id", () => {
  const options = [
    { provider: "ollama", modelId: "qwen3:latest", name: "Qwen 3" },
    { provider: "anthropic", modelId: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { provider: "openai", modelId: "gpt-5.4", name: "GPT-5.4" },
  ];

  assert.deepEqual(filterModelOptions(options, "QWEN"), [options[0]]);
  assert.deepEqual(filterModelOptions(options, "claude-sonnet"), [options[1]]);
  assert.equal(filterModelOptions(options, "OpenAI").length, 0);
  assert.equal(filterModelOptions(options, "anthropic/claude").length, 0);
  assert.equal(filterModelOptions(options, "missing").length, 0);
  assert.equal(filterModelOptions(options, "  "), options);
});

test("renders compact errors above the input as a wrapping alert", () => {
  const error = "Compaction failed: OpenAI API error (403): <html>request forbidden</html>";
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onCompact() {},
        isStreaming: false,
        compactError: error,
      }),
    ),
  );

  assert.match(html, /role="alert"/);
  assert.match(html, /Compaction failed: OpenAI API error/);
  assert.match(html, /&lt;html&gt;request forbidden&lt;\/html&gt;/);
  assert.match(html, /white-space:pre-wrap/);
  assert.ok(html.indexOf('role="alert"') < html.indexOf("<textarea"));
});

// ---------------------------------------------------------------------------
// 档位展示解释（ADR-0012 决策五：fail-closed 平台上不允许静默不一致）
// ---------------------------------------------------------------------------

test("沙箱不可用时档位说明里带原因，可用时不带", () => {
  const t = (key, params) => ({
    "chat.noTools": "No tools, read-only",
    "chat.builtInTools": `${params?.count ?? "?"} built-in tools`,
    "chat.allBuiltInTools": "All built-in tools",
    "chat.toolPresetWithBashNote": `${params?.preset ?? ""} \u2014 no OS-level sandbox on this platform, so bash is not activated here`,
  })[key] ?? key;

  const usable = { available: true, mechanism: "sandbox-exec", reason: null };
  const unusable = { available: false, mechanism: null, reason: "no OS-level sandbox on win32" };

  assert.equal(toolPresetDescription("default", t, usable), "4 built-in tools");
  assert.equal(toolPresetDescription("full", t, null), "All built-in tools");
  // 不可用：default / full 都要解释「名义上有 bash、实际没有」。
  assert.equal(
    toolPresetDescription("default", t, unusable),
    "4 built-in tools \u2014 no OS-level sandbox on this platform, so bash is not activated here",
  );
  assert.match(toolPresetDescription("full", t, unusable), /^All built-in tools \u2014 /, "整句来自语言包，base 只是参数");
  assert.match(toolPresetDescription("full", t, unusable), /bash is not activated here/);
  // off 档位本来就没有 bash，不需要解释。
  assert.equal(toolPresetDescription("off", t, unusable), "No tools, read-only");
});

test("沙箱不可用时档位按钮的 title 也解释原因（不打开菜单也看得到）", () => {
  const render = (bashContainment) => renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        isStreaming: false,
        toolPreset: "default",
        onToolPresetChange() {},
        bashContainment,
      }),
    ),
  );

  assert.match(render({ available: false, mechanism: null, reason: "no OS-level sandbox on win32" }), /bash is not activated here/);
  assert.equal(/bash is not activated here/.test(render({ available: true, mechanism: "sandbox-exec", reason: null })), false);
  assert.equal(/bash is not activated here/.test(render(null)), false);
});
