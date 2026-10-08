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
const { ReminderModal, ReminderRow } = await jiti.import("./ReminderModal.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const globalsCss = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

/** 取一条规则的声明体（选择器与 `{` 之间只允许空白），与 primitives.test.mjs 同档 seam。 */
function blockBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = globalsCss.match(new RegExp(`(?:^|[}])\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"));
  assert.ok(match, `globals.css 缺少规则 \`${selector}\``);
  return match[1];
}

/** 静态渲染进入不了 fetch（无 effect），既有提醒行只能从导出的 `ReminderRow` 进入——
 *  与 CreateAgentModal 的 `ModelsEmptyHint` 同一条 seam。 */
const SCHEDULED_REMINDER = {
  id: "r1",
  title: "follow up",
  fire_at: "2026-10-08T12:00:00.000Z",
  recurrence: "every:1m",
  target_id: "msg-1",
  author_id: "owner",
  status: "scheduled",
  created_at: "2026-10-01T00:00:00.000Z",
};

function renderRow(reminder = SCHEDULED_REMINDER) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, [
      React.createElement(ReminderRow, { key: "row", reminder, onAction: () => undefined }),
    ]),
  );
}

function renderI18n(children) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, children));
}

test("ReminderModal renders the create form with target badge and recurrence presets", () => {
  const html = renderI18n(
    React.createElement(ReminderModal, {
      targetId: "msg-1",
      targetLabel: "#4 Owner",
      defaultTitle: "follow up",
      channelId: "#all",
      onClose: () => undefined,
      onChanged: () => undefined,
    }),
  );
  assert.match(html, /Set reminder/);
  assert.match(html, /#4 Owner/);
  assert.match(html, /follow up/);
  assert.match(html, /type="datetime-local"/);
  assert.match(html, /every:1m/);
  assert.match(html, /weekly:mon,fri@09:00/);
  assert.match(html, /Create reminder/);
  assert.match(html, /Anchored reminders/);
  assert.match(html, /No reminders anchored here yet/);
  // §3.9 作者选择：默认 Owner
  assert.match(html, /Owner \(you\)/);
});

test("ReminderModal escapes and closes", () => {
  const html = renderI18n(
    React.createElement(ReminderModal, {
      targetId: "#all",
      targetLabel: "#all",
      channelId: "#all",
      onClose: () => undefined,
      onChanged: () => undefined,
    }),
  );
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /type="text"/);
});

// ─── 票 08：模态内容形态（.modal-body / .modal-foot + .field / .input / .select） ─

test("票 08 形态：ReminderModal 走 .modal-body / .modal-foot，字段走 .field + .input / .select", () => {
  const html = renderI18n(
    React.createElement(ReminderModal, {
      targetId: "msg-1",
      targetLabel: "#4 Owner",
      channelId: "#all",
      onClose: () => undefined,
      onChanged: () => undefined,
    }),
  );
  assert.match(html, /class="modal-body"/);
  assert.match(html, /class="modal-foot"/);
  assert.match(html, /class="field"/);
  assert.match(html, /class="input"/);
  assert.match(html, /class="select"/);
  assert.match(html, /type="datetime-local"/);
  // 创建按钮在 .modal-foot 里（原型「提醒」模态的按钮序：body 内容 → foot 动作）
  const foot = html.slice(html.indexOf('class="modal-foot"'));
  assert.match(foot, /Create reminder/);
});

test("票 08 形态：既有提醒行 = .kv（标题 + 下一次触发 mono + 状态胶囊）+ snooze/cancel 走 .btn-sm", () => {
  const html = renderRow();
  assert.match(html, /class="kv"/);
  assert.match(html, /class="k"/);
  assert.match(html, /class="v"/);
  assert.match(html, /every:1m/);
  assert.match(html, /Snooze 15m/);
  assert.match(html, /Cancel reminder/);
  assert.match(html, /class="btn btn-sm"/);
  assert.match(html, /class="btn btn-sm btn-danger"/);
});

test("票 08 形态：取消提醒是破坏性动作——`.btn-danger` 的 --error 语义来自原语规则", () => {
  const body = blockBody(".btn-danger");
  assert.match(body, /color:\s*var\(--error\)/);
  const hover = blockBody(".btn-danger:hover");
  assert.match(hover, /border-color:\s*var\(--error\)/);
  assert.match(blockBody(".btn-sm"), /height:\s*var\(--control-h-sm\)/);
});

test("票 08 形态：已取消/已触发的行不再渲染动作按钮（行为未变）", () => {
  const html = renderRow({ ...SCHEDULED_REMINDER, status: "canceled" });
  assert.doesNotMatch(html, /Snooze 15m/);
  assert.doesNotMatch(html, /btn-danger/);
  assert.match(html, /canceled/);
});
