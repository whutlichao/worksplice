/**
 * ProjectTrustDialog 的形态收口断言（票 08 第 3 条：`DirectoryPicker` / `ProjectTrustDialog`
 * 收形态；危险动作按协调裁决落在提醒的 cancel，见票 08 Answer 的 Q2 记录）。
 *
 * 断在渲染出的 markup + globals.css 的原语规则体两半上（与 primitives.test.mjs 同档）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ProjectTrustDialog } = await jiti.import("./ProjectTrustDialog.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function renderDialog(props = {}) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, [
      React.createElement(ProjectTrustDialog, {
        key: "dialog",
        cwd: "/tmp/project",
        busy: false,
        error: null,
        onCancel: () => undefined,
        onConfirm: () => undefined,
        ...props,
      }),
    ]),
  );
}

test("ProjectTrustDialog：对话结构与无障碍契约不变（标题 / 正文 / cwd / 按钮序）", () => {
  const html = renderDialog();
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-labelledby="project-trust-title"/);
  assert.match(html, /id="project-trust-title"/);
  assert.match(html, /Trust this project\?/);
  assert.match(html, /\/tmp\/project/);
  assert.match(html, /Cancel/);
  assert.match(html, /Trust project/);
});

test("ProjectTrustDialog：两个动作走 .btn / .btn.btn-primary 原语（旧 inline 边框底退场）", () => {
  const html = renderDialog();
  assert.match(html, /class="btn"/);
  assert.match(html, /class="btn btn-primary"/);
  assert.doesNotMatch(html, /rgba\(20,\s*17,\s*17/);
  assert.doesNotMatch(html, /2px solid/);
});

test("ProjectTrustDialog：忙碌态仍走 disabled（行为未变），授权动作不红化", () => {
  const html = renderDialog({ busy: true });
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /btn-danger/);
  assert.match(html, /Trusting\.\.\./);
});

test("ProjectTrustDialog：错误提示走 --error（危险语义只在真有破坏性动作处）", () => {
  const html = renderDialog({ error: "boom" });
  assert.match(html, /role="alert"/);
  assert.match(html, /color:var\(--error\)/);
});
