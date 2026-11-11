/**
 * 模型配置 / 技能配置两个浮层的对话框契约（票 03，S1 / S3）。
 *
 * 为什么两个组件一个文件：它们在本票里共享同一条验收语句（S1 对话框语义 + S3 关闭入口），
 * 断言也几乎同构。渲染 seam 与 `AppShell.test.mjs` / `BrutalModal.test.mjs` 同档：
 * `renderToStaticMarkup` + jiti 打到真正渲染出的 markup，再取 `role=dialog` 元素本身断言。
 *
 * 行为面（打开移入 / Tab 回绕 / Esc / 归还 opener / 叠层让路）不在 node 里断言——
 * 它需要真实焦点与 Tab 序，由 ego-browser 实测，读数见票据 Answer。
 */
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
const { ModelsConfig } = await jiti.import("./ModelsConfig.tsx");
const { SkillsConfig } = await jiti.import("./SkillsConfig.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");
const { enLocale } = await jiti.import("../lib/i18n/messages/en.ts");
const { zhCNLocale } = await jiti.import("../lib/i18n/messages/zh-CN.ts");

function render(element) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, element),
  );
}

const OVERLAYS = [
  {
    name: "模型配置",
    render: () => render(React.createElement(ModelsConfig, { onClose: () => undefined })),
    titleId: "models-config-title",
    widthPx: 860,
  },
  {
    name: "技能配置",
    render: () => render(React.createElement(SkillsConfig, { onClose: () => undefined })),
    titleId: "skills-config-title",
    widthPx: 860,
  },
];

/** 取 `role="dialog"` 的开标签（本票两个浮层各自只渲染一个顶层对话框）。 */
function dialogTag(html) {
  const tag = html.match(/<div[^>]*\brole="dialog"[^>]*>/)?.[0];
  assert.ok(tag, "浮层根面板应带 role=dialog");
  return tag;
}

for (const overlay of OVERLAYS) {
  test(`S1（${overlay.name}）：根面板是 aria-modal 对话框，可访问名指向可见标题`, () => {
    const html = overlay.render();
    const tag = dialogTag(html);
    assert.match(tag, /aria-modal="true"/);
    assert.match(tag, new RegExp(`aria-labelledby="${overlay.titleId}"`));
    assert.match(
      html,
      new RegExp(`id="${overlay.titleId}"`),
      "aria-labelledby 必须指向 markup 里真实存在的可见标题",
    );
  });

  test(`S1（${overlay.name}）：对话框自身可承接兜底焦点（tabindex=-1，不进 Tab 序）`, () => {
    assert.match(dialogTag(overlay.render()), /tabindex="-1"/);
  });

  test(`S3（${overlay.name}）：关闭键是 .icon-btn + lucide X，带本地化可访问名`, () => {
    const html = overlay.render();
    // 关闭键必须是 .icon-btn（与 .modal-head 同形），且带 aria-label
    const buttons = html.match(/<button\b[^>]*class="icon-btn"[^>]*>[\s\S]*?<\/button>/g) ?? [];
    const close = buttons.find((button) => /aria-label="Close"/.test(button));
    assert.ok(close, "应有一个 aria-label=Close 的 .icon-btn 关闭键");
    assert.match(close, /<svg/, "关闭键内应渲染 lucide X 图标");
    assert.doesNotMatch(close, /outline/i, "关闭键不得压掉焦点环");
    // 不得再留纯文本「×」按钮
    assert.doesNotMatch(html, />\s*×\s*</);
  });

  test(`S1（${overlay.name}）：宽度自带，不借道 --modal-max / --modal-wide-max`, () => {
    const html = overlay.render();
    assert.match(html, new RegExp(`width:\\s*${overlay.widthPx}px`));
    assert.doesNotMatch(html, /class="modal(?: wide)?"/);
  });
}

test("S3：关闭键的可访问名复用两包已有的 common.close（不新增文案）", () => {
  for (const messages of [enLocale.messages, zhCNLocale.messages]) {
    assert.ok(messages["common.close"], "两包都应有 common.close");
  }
  assert.equal(enLocale.messages["common.close"], "Close");
  assert.equal(zhCNLocale.messages["common.close"], "关闭");
});

test("S2：模型配置里叠加的「添加 Provider」子浮层同样是对话框（叠层时下层让路）", async () => {
  // 该子浮层只在 `pickerOpen` 时渲染，静态渲染够不着；断言落在源码契约上：
  // 它必须自己带 role=dialog / aria-modal，并接同一个 `useModalFocus`
  // （少一条，叠层时下层模型配置就会抢走 Esc / Tab）。行为读数见票据 Answer。
  const source = await readFile(
    new URL("./ModelsConfig.tsx", import.meta.url),
    "utf8",
  );
  const picker = source.slice(source.indexOf("function AddProviderPicker"));
  assert.ok(picker.length > 0, "应存在 AddProviderPicker");
  assert.match(picker, /role="dialog"/);
  assert.match(picker, /aria-modal="true"/);
  assert.match(picker, /aria-label=\{t\("i18n\.addProvider"\)\}/);
  assert.match(picker, /useModalFocus<HTMLDivElement>\(onClose\)/);
  assert.doesNotMatch(picker, /onKeyDown=\{\(e\) => \{ if \(e\.key === "Escape"\)/, "Esc 应交给共享接线层，不再挂在搜索框上");
});
