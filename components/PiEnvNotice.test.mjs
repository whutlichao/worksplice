import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

// 提示面的渲染层断言（issue #226）：三种环境下的可见性 —— P1 / P2 出现且动作不同，
// 正常环境**渲染 null**（存量用户零感知）。浏览器实测在 issue 的 Answer 里另附。
//
// 只断言外部呈现（文案与动作按钮），不测取数时序：`PiEnvNotice` 的取数外壳在 SSR 下不跑 effect，
// `PiEnvNoticeBar` 是纯呈现，三种状态直接喂进去。
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { PiEnvNoticeBar } = await jiti.import("./PiEnvNotice.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function render(props) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(PiEnvNoticeBar, props)),
  );
}

const uninitialized = { agentDir: "/home/u/.pi/agent", finding: "uninitialized", reason: "settings-unwritten" };
const noCredentials = { agentDir: "/home/u/.pi/agent", finding: "no-credentials", reason: "no-credentials" };
const healthy = { agentDir: "/home/u/.pi/agent", finding: null, reason: null };

test("P1 环境：状态条出现、给「初始化」动作，并给出环境变量凭证的逃生口", () => {
  const html = render({
    variant: "rail",
    status: uninitialized,
    onInitialize: () => undefined,
    onOpenModels: () => undefined,
  });
  assert.match(html, /data-pi-env-notice="uninitialized"/);
  assert.match(html, /The pi config root is not initialized/);
  assert.match(html, /skeleton files/);
  // 侧欄用短版逃生口：只用环境变量供 key 的人不该被这一步打扰。
  assert.match(html, /Skip this if your key comes from the environment/);
  assert.match(html, />Initialize</);
  assert.doesNotMatch(html, /Log in \/ add key/);
});

test("P2 环境：状态条出现、给「去登录 / 填 key」动作，不给「初始化」", () => {
  const html = render({
    variant: "rail",
    status: noCredentials,
    onInitialize: () => undefined,
    onOpenModels: () => undefined,
  });
  assert.match(html, /data-pi-env-notice="no-credentials"/);
  assert.match(html, /No usable model credentials/);
  assert.match(html, /reports no model with usable credentials/);
  assert.match(html, /Log in \/ add key/);
  assert.doesNotMatch(html, />Initialize</);
  assert.doesNotMatch(html, /environment/);
});

test("正常环境：渲染 null（存量用户零感知）", () => {
  assert.equal(
    render({ variant: "rail", status: healthy, onInitialize: () => undefined }),
    "",
  );
  assert.equal(render({ variant: "modal", status: healthy }), "");
});

test("还没拿到结论（null）时也不渲染", () => {
  assert.equal(render({ variant: "rail", status: null }), "");
});

test("ModelsConfig 顶部入口：P2 只指路（provider 列表就在下面），不再给按钮", () => {
  const html = render({ variant: "modal", status: noCredentials });
  assert.match(html, /data-pi-env-notice="no-credentials"/);
  assert.match(html, /Pick a provider below to log in/);
  assert.doesNotMatch(html, /Log in \/ add key/);
});

test("ModelsConfig 顶部入口：P1 仍然给「初始化」按钮", () => {
  const html = render({ variant: "modal", status: uninitialized, onInitialize: () => undefined });
  assert.match(html, /data-pi-env-notice="uninitialized"/);
  assert.match(html, />Initialize</);
});

test("初始化成功的反馈不静默：给出改动条数，并继续指路", () => {
  const html = render({
    variant: "rail",
    status: healthy,
    created: ["settings.json", "models.json", "auth.json", "sessions/"],
    onOpenModels: () => undefined,
  });
  assert.match(html, /Initialized 4 item\(s\)\./);
  assert.match(html, /Log in \/ add key/);
});

test("幂等重跑的空改动清单会说明「没有需要补的」，而不是点了没反应", () => {
  const html = render({
    variant: "rail",
    status: uninitialized,
    created: [],
    onInitialize: () => undefined,
  });
  assert.match(html, /The skeleton already exists/);
});

test("settings.json 损坏时给的是「自己修/备份改名」，不承诺初始化能修好它", () => {
  const html = render({
    variant: "rail",
    status: { ...uninitialized, reason: "settings-unreadable" },
    onInitialize: () => undefined,
  });
  assert.match(html, /never rewrites existing files/);
  assert.doesNotMatch(html, /If you already provide an API key/);
});

test("初始化失败：可读错误就地呈现（role=alert），不是无声失败", () => {
  const html = render({
    variant: "rail",
    status: uninitialized,
    error: "cannot initialise the pi agent dir at /home/u/.pi/agent: EACCES: permission denied",
    onInitialize: () => undefined,
  });
  assert.match(html, /role="alert"/);
  assert.match(html, /Initialization failed/);
  assert.match(html, /EACCES: permission denied/);
});
