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
const { CreateChannelModal } = await jiti.import("./CreateChannelModal.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const globalsCss = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

/** 取一条规则的声明体（选择器与 `{` 之间只允许空白），与 primitives.test.mjs 同档 seam。 */
function blockBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = globalsCss.match(new RegExp(`(?:^|[}])\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"));
  assert.ok(match, `globals.css 缺少规则 \`${selector}\``);
  return match[1];
}

function renderModal(agents) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, [
      React.createElement(CreateChannelModal, {
        key: "modal",
        agents,
        onClose: () => undefined,
        onCreated: () => undefined,
      }),
    ]),
  );
}

test("CreateChannelModal: renders type toggle, member list with every agent (Susan included)", () => {
  const html = renderModal([
    { id: "m1", name: "bob", type: "agent" },
    { id: "m2", name: "Susan", type: "agent" },
  ]);
  assert.match(html, /Create channel/);
  assert.match(html, /Private/);
  assert.match(html, /Initial members/);
  assert.match(html, />bob</);
  assert.match(html, />Susan</);
});

test("CreateChannelModal: initial state (public) pre-checks nobody — pre-check applies on the private path only", () => {
  const html = renderModal([
    { id: "m1", name: "bob", type: "agent" },
    { id: "m2", name: "Susan", type: "agent" },
  ]);
  // 初始 memberIds 为空：任何成员按钮都不渲染选中态（lucide-check 图标只出现在选中行）；
  // 预勾选状态机（private 切入/切出、手动触碰尊重）在 lib/secretary-bootstrap 纯函数层测试。
  assert.doesNotMatch(html, /lucide-check/);
});

test("CreateChannelModal: no agents -> no member list section", () => {
  const html = renderModal([]);
  assert.doesNotMatch(html, /Initial members/);
});

// ─── 票 08：模态内容形态（.modal-body / .modal-foot + 字段 + 拣选 + 底按钮） ──

test("票 08 形态：内容分 .modal-body / .modal-foot，底部动作走 .btn / .btn.btn-primary", () => {
  const html = renderModal([{ id: "m1", name: "bob", type: "agent" }]);
  assert.match(html, /class="overlay"/);
  // 原型 openNewChannel 走 wide（成员胶囊行需要宽度）：--modal-wide-max 档
  assert.match(html, /class="modal wide"/);
  assert.match(html, /class="modal-body"/);
  assert.match(html, /class="modal-foot"/);
  assert.match(html, /class="sep"/);
  assert.match(html, /class="btn"/);
  assert.match(html, /class="btn btn-primary"/);
});

test("票 08 形态：名称/描述字段走 .field + .input / .textarea（label 关联不变）", () => {
  const html = renderModal([]);
  assert.match(html, /class="field"/);
  assert.match(html, /class="input"/);
  assert.match(html, /class="textarea"/);
  assert.match(html, /<label[^>]*for="channel-name"[^>]*>Name<\/label>/);
  assert.match(html, /<label[^>]*for="channel-description"[^>]*>/);
});

test("票 08 形态：公开/私有走 .radio-row + .radio-card（旧硬阴影选中态退场）", () => {
  const html = renderModal([]);
  assert.match(html, /class="radio-row"/);
  assert.equal((html.match(/class="radio-card[^"]*"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /rgba\(20,\s*17,\s*17/);
  assert.doesNotMatch(html, /\d+px \d+px 0 0/);
  // 选中态 = accent 淡底 + accent 边（不是黄色实心）
  const on = blockBody(".radio-card.is-on");
  assert.match(on, /border-color:\s*var\(--accent\)/);
  assert.match(on, /background:\s*var\(--accent-soft\)/);
});

test("票 08 形态：成员挑选项 = .member-pick / .member-opt，头像 22px（--avatar-sm）", () => {
  const html = renderModal([
    { id: "m1", name: "bob", type: "agent" },
    { id: "m2", name: "Susan", type: "agent" },
  ]);
  assert.match(html, /class="member-pick"/);
  assert.equal((html.match(/class="member-opt[^"]*"/g) ?? []).length, 2);
  assert.match(html, /class="avatar sm av-\d"/);
  // 22px 由票 04 的 `.avatar.sm` 规则承担（本票只把头像放进挑选项）
  assert.match(blockBody(".avatar.sm"), /width:\s*var\(--avatar-sm\)/);
  assert.match(blockBody(".member-opt"), /border-radius:\s*var\(--r-pill\)/);
  const on = blockBody(".member-opt.is-on");
  assert.match(on, /background:\s*var\(--accent-soft\)/);
  assert.match(on, /color:\s*var\(--accent\)/);
});

test("票 08 形态：模态内可聚焦元素都不压掉焦点环（无 inline outline）", () => {
  const html = renderModal([{ id: "m1", name: "bob", type: "agent" }]);
  const focusables = html.match(/<(?:button|input|select|textarea)\b[^>]*>/g) ?? [];
  assert.ok(focusables.length > 0);
  for (const tag of focusables) {
    assert.doesNotMatch(tag, /outline/i, `可聚焦元素不得压掉焦点环：${tag}`);
  }
});
