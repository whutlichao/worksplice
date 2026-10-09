/**
 * MyRemindersModal 的渲染面断言（票 08）。
 *
 * 静态渲染进入不了 fetch（无 effect，列表为空），既有提醒行只能从导出的
 * `MyReminderRow` 进入——与 CreateAgentModal 的 `ModelsEmptyHint` 同一条 seam。
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
const { MyRemindersModal, MyReminderRow } = await jiti.import("./MyRemindersModal.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const SCHEDULED_REMINDER = {
  id: "r1",
  title: "follow up",
  fire_at: "2026-10-08T12:00:00.000Z",
  recurrence: "every:1m",
  target_id: "msg-1",
  author_id: "owner",
  status: "scheduled",
  created_at: "2026-10-01T00:00:00.000Z",
  target: { kind: "message", id: "msg-1" },
  channelId: "#all",
  channelName: "all",
  anchorSeq: 4,
  author: null,
};

function renderRow(reminder = SCHEDULED_REMINDER) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, [
      React.createElement(MyReminderRow, {
        key: "row",
        reminder,
        onAction: () => undefined,
        onLocate: () => undefined,
      }),
    ]),
  );
}

function renderModal() {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, [
      React.createElement(MyRemindersModal, { key: "modal", onClose: () => undefined, onLocate: () => undefined }),
    ]),
  );
}

test("MyRemindersModal 走 .overlay + .modal wide（520 档 > --modal-max）+ .modal-body", () => {
  const html = renderModal();
  assert.match(html, /class="overlay"/);
  assert.match(html, /class="modal wide"/);
  assert.match(html, /class="modal-body"/);
  assert.match(html, /My reminders/);
  assert.match(html, /No reminders yet/);
});

test("票 08 形态：行 = .kv（频道名 + 锚点 seq mono + 下一次触发 mono）+ .btn-sm 动作", () => {
  const html = renderRow();
  assert.match(html, /class="kv"/);
  assert.match(html, /class="k"/);
  assert.match(html, /class="v"/);
  // 频道名 + 锚点 seq（i18n: "in #{{channel}} · #{{seq}}"；插值后的花括号形态不在本票面内）
  assert.match(html, /class="v">in [^<]*all[^<]*4[^<]*<\/span>/);
  assert.match(html, /every:1m/);
  assert.match(html, /Snooze 15m/);
  assert.match(html, /Cancel reminder/);
  assert.match(html, /Locate/);
  assert.match(html, /class="btn btn-sm"/);
  assert.match(html, /class="btn btn-sm btn-danger"/);
});

test("票 08 形态：没有频道归属的提醒不渲染定位按钮（行为未变）", () => {
  const html = renderRow({ ...SCHEDULED_REMINDER, channelId: null, channelName: null, anchorSeq: null });
  assert.doesNotMatch(html, /Locate/);
  assert.match(html, /class="kv"/);
});

test("票 08 形态：已触发/已取消的行没有 snooze/cancel，只看得到定位（行为未变）", () => {
  const html = renderRow({ ...SCHEDULED_REMINDER, status: "fired" });
  assert.doesNotMatch(html, /Snooze 15m/);
  assert.doesNotMatch(html, /btn-danger/);
  assert.match(html, /Locate/);
  assert.match(html, /fired/);
});

/** 取开标签上的 style 声明表：断在产品渲染出的 markup 上，而不是推断。 */
function styleDecls(tag) {
  const style = tag.match(/style="([^"]*)"/);
  assert.ok(style, `元素应带行内样式：${tag}`);
  return new Map(
    style[1]
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => [d.slice(0, d.indexOf(":")), d.slice(d.indexOf(":") + 1).trim()]),
  );
}

test("en 溢出修复：标题先让位到下限，右簇到「行宽 − 下限 − gap」才折行", () => {
  const html = renderRow();

  // 标题（.k）：既有 ellipsis 形态 + 显式让位下限（不再是裸的 0）
  const kTag = html.match(/<span class="k" style="[^"]*"/)?.[0];
  assert.ok(kTag, `.k 应带行内样式：${html}`);
  const k = styleDecls(kTag);
  assert.equal(k.get("overflow"), "hidden");
  assert.equal(k.get("text-overflow"), "ellipsis");
  assert.equal(k.get("white-space"), "nowrap");
  const floor = k.get("min-width") ?? "";
  assert.match(floor, /^\d+px$/, "标题下限应是显式 px：标题先让位到这个宽度");
  assert.ok(Number.parseFloat(floor) > 0, `标题下限可读（> 0）：${floor}`);

  // 右簇：承载 .v / 状态 chip / 动作按钮的那个 inline-flex——刚性（不被比例压缩），
  // 只在标题已到下限后由上限触发折行。
  const start = html.indexOf('<span style="display:inline-flex');
  assert.ok(start >= 0, `右簇（inline-flex 容器）应在 markup 里：${html}`);
  const tagEnd = html.indexOf(">", start);
  const tag = html.slice(start, tagEnd + 1);
  const tail = html.slice(tagEnd + 1);
  assert.match(tail, /class="v"/);
  assert.match(tail, /Snooze 15m/);
  const c = styleDecls(tag);
  assert.equal(c.get("flex"), "0 0 auto", "右簇不被比例压缩——否则标题未到下限它就折行了");
  assert.equal(c.get("flex-wrap"), "wrap", "触到上限才折到第二行");
  assert.equal(c.get("justify-content"), "flex-end", "折到第二行后右对齐");
  assert.equal(
    c.get("max-width"),
    `calc(100% - ${floor} - var(--sp-5))`,
    "右簇上限 = 行宽 − 标题下限 − .kv 行内 gap：同一常量驱动两侧（标题先让位、右簇后折行）",
  );
  // 不恒定两行：markup 里没有强制换行元素，放得下时仍是单行
  assert.doesNotMatch(tail, /<br\b/);
});
