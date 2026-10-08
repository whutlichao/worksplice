import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MermaidBlock } = await jiti.import("./MermaidBlock.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

// Simple sequenceDiagram for testing
const mermaidSrc = `sequenceDiagram
    Alice->>Bob: Hello
    Bob-->>Alice: Hi`;

function renderMermaid(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MermaidBlock, props),
    ),
  );
}

test("MermaidBlock renders source by default", () => {
  const html = renderMermaid({ code: mermaidSrc });

  assert.match(html, />Preview</);
  assert.match(html, /Alice/);
  assert.doesNotMatch(html, /mermaid-block-loading/);
});

test("MermaidBlock can render preview by default", () => {
  const html = renderMermaid({ code: mermaidSrc, defaultPreview: true });

  assert.match(html, />Source</);
  assert.match(html, /mermaid-block-loading/);
  assert.doesNotMatch(html, /Alice/);
});

test("MermaidBlock with isStreaming falls back to source view", () => {
  const html = renderMermaid({ code: mermaidSrc, isStreaming: true, defaultPreview: true });

  assert.match(html, /disabled/);
  assert.match(html, />Preview</);
  assert.match(html, /Alice/);
  assert.match(html, /-&gt;&gt;/);
});

test("MermaidBlock renders empty graph without error", () => {
  const html = renderMermaid({ code: "graph TD", defaultPreview: true });

  assert.doesNotMatch(html, /mermaid-block-error/);
  assert.match(html, /mermaid-block-loading/);
});

// 票 10（遗留面换皮）的渲染级判据：代码块真的在消费新契约，而不是「旧 token 名恰好不在源码里」。
test("legacy code block consumes the ticket-10 surface contract", () => {
  const html = renderMermaid({ code: mermaidSrc });

  // ED-1：代码块是嵌套 well → --panel-2，不是画布底色。
  assert.match(html, /background:var\(--panel-2\)/);
  // ED-5：字号取自 --fs-* 标尺，代码块走 --fs-sm。
  assert.match(html, /font-size:var\(--fs-sm\)/);
  // ED-2：发丝由外层 .markdown-code-block 提供，语法高亮主题不再塞第二条硬编码边框。
  assert.match(html, /border:none/);
});

test("MermaidBlock handles Chinese characters in diagram", () => {
  const chineseMermaid = `sequenceDiagram
    participant PC as PC客户端
    PC->>SV: 请求登录`;

  const html = renderMermaid({ code: chineseMermaid, defaultPreview: true });

  assert.doesNotMatch(html, /mermaid-block-error/);
  assert.match(html, /mermaid-block/);
});
