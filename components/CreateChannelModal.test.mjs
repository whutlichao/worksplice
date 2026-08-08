import assert from "node:assert/strict";
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
