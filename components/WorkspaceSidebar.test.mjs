import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
    jsx: { runtime: "automatic" },
    tsconfigPaths: true,
});
const { WorkspaceSidebar } = await jiti.import("./WorkspaceSidebar.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function renderI18n(children) {
    return renderToStaticMarkup(
        React.createElement(I18nProvider, null, children),
    );
}

function reminderButtonHtml(count) {
    const html = renderI18n(
        React.createElement(WorkspaceSidebar, {
            channels: [],
            agents: [],
            error: null,
            selectedChannelId: null,
            onSelectChannel: () => undefined,
            onOpenAgent: () => undefined,
            onNewChannel: () => undefined,
            onNewAgent: () => undefined,
            onOpenModels: () => undefined,
            onOpenSkills: () => undefined,
            onOpenReminders: () => undefined,
            scheduledReminderCount: count,
            onCloseMenu: () => undefined,
            onSearch: () => undefined,
        }),
    );
    const btn = html.match(
        /<button[^>]*title="My reminders"[^>]*>[\s\S]*?<\/button>/,
    )?.[0];
    assert.ok(btn, "reminder button should render");
    const tag = btn.match(/^<button[^>]*>/)?.[0] ?? "";
    return {
        html,
        tag,
        inner: btn.replace(/^<button[^>]*>/, "").replace(/<\/button>$/, ""),
    };
}

test("reminder entry is a compact icon-only button (§5.6): no label to wrap or shrink the icon", () => {
    const { tag, inner } = reminderButtonHtml(0);
    // 回归：40px 宽 flex:1 按钮内 "My reminders" 折行、AlarmClock 被 flex-shrink 压到 7px
    assert.doesNotMatch(inner, /My reminders/);
    assert.doesNotMatch(tag, /flex:/);
    // 票 03：按钮从「34px 内联宽高 + 内联边框/底色」改为 `.icon-btn` 原语（`--icon-btn` 30px 固定网格，
    // 透明边框 + hover 换 --surface）。守卫不变：宽度固定、不被 flex 拉伸、图标 18px 不被压缩
    // （`.icon-btn` 的形态断言在 components/primitives.test.mjs）。
    assert.match(tag, /class="icon-btn"/);
    assert.match(inner, /width="18" height="18"/);
});

test("reminder entry marks the scheduled state with the primitive's .is-on", () => {
    const { tag, inner } = reminderButtonHtml(2);
    assert.match(tag, /class="icon-btn is-on"/);
    assert.match(inner, /class="badge"/);
    assert.match(inner, />2<\/span>/);
});

test("reminder entry shows a count badge when scheduled reminders exist", () => {
    const { inner } = reminderButtonHtml(3);
    assert.match(inner, />3<\/span>/);
    assert.doesNotMatch(inner, /My reminders/);
});

test("reminder entry stays icon-only when count is 0 (no stub label)", () => {
    const { inner } = reminderButtonHtml(0);
    assert.doesNotMatch(inner, /<span/);
});

function sidebarHtml(channels, { agents = [], selectedChannelId = null } = {}) {
    return renderI18n(
        React.createElement(WorkspaceSidebar, {
            channels,
            agents,
            error: null,
            selectedChannelId,
            onSelectChannel: () => undefined,
            onOpenAgent: () => undefined,
            onNewChannel: () => undefined,
            onNewAgent: () => undefined,
            onOpenModels: () => undefined,
            onOpenSkills: () => undefined,
            onOpenReminders: () => undefined,
            scheduledReminderCount: 0,
            onCloseMenu: () => undefined,
            onSearch: () => undefined,
        }),
    );
}

function channelRow(html, name) {
    const re = new RegExp(
        `<button[^>]*>[\\s\\S]*?${name}[\\s\\S]*?<\\/button>`,
    );
    const row = html.match(re)?.[0];
    assert.ok(row, `channel row for ${name} should render`);
    return row;
}

test("BAI-6: a channel with unread shows a count badge", () => {
    const html = sidebarHtml([
        { id: "c1", name: "reads", type: "public", unread: 3 },
    ]);
    const row = channelRow(html, "reads");
    assert.match(row, />3 msg<\/span>/);
    assert.match(row, /99\+ msg|3 msg/);
});

test("message and Task unread badges stay separate, unit-labelled, and exact for assistive tech", () => {
    const channels = [
        { id: "c1", name: "both", type: "public", unread: 3, unreadTaskCount: 2 },
    ];
    const row = channelRow(sidebarHtml(channels), "both");
    assert.match(row, /aria-label="3 unread messages">3 msg<\/span>/);
    assert.match(
        row,
        /aria-label="2 Tasks with unread discussion replies">2 tasks<\/span>/,
    );

    const selectedRow = channelRow(
        sidebarHtml(channels, { selectedChannelId: "c1" }),
        "both",
    );
    assert.doesNotMatch(selectedRow, /3 unread messages/);
    assert.match(selectedRow, /2 Tasks with unread discussion replies/);
});

test("an archived channel keeps its archive marker beside unread Task discussions", () => {
    const row = channelRow(
        sidebarHtml([
            {
                id: "c1",
                name: "archived",
                type: "public",
                archived: 1,
                unread: 0,
                unreadTaskCount: 2,
            },
        ]),
        "archived",
    );

    assert.match(row, /aria-label="2 Tasks with unread discussion replies">2 tasks<\/span>/);
    assert.match(row, />Archived<\/span>/);
});

test("BAI-6: unread is capped at 99+", () => {
    const html = sidebarHtml([
        { id: "c1", name: "many", type: "public", unread: 120 },
    ]);
    const row = channelRow(html, "many");
    assert.match(row, /99\+/);
});

test("BAI-6: no badge when unread is 0", () => {
    const html = sidebarHtml([
        { id: "c1", name: "quiet", type: "public", unread: 0 },
    ]);
    const row = channelRow(html, "quiet");
    assert.doesNotMatch(row, /99\+|>[1-9]\d*<\/span>/);
});

test("DM channels render in a separate 私信 group, stripped of the dm:owner↔ prefix", () => {
    const html = sidebarHtml([
        { id: "dm:owner↔Zeta", name: "dm:owner↔Zeta", type: "dm", unread: 0, messageCount: 1 },
        { id: "c1", name: "general", type: "public", unread: 0, messageCount: 1 },
        { id: "dm:owner↔Alpha", name: "dm:owner↔Alpha", type: "dm", unread: 0, messageCount: 1 },
        { id: "dm:owner↔Mike", name: "dm:owner↔Mike", type: "dm", unread: 0, messageCount: 1 },
    ]);
    // 独立分组标题（私信）与频道组并存
    assert.match(html, /Direct messages/);
    assert.match(html, /Channels/);
    // 前缀剥离：不渲染原始 dm:owner↔ 前缀
    assert.doesNotMatch(html, /dm:owner↔/);
    // 只显示 agent 名
    assert.match(html, /Alpha/);
    assert.match(html, /Mike/);
    assert.match(html, /Zeta/);
});

test("DM channels are sorted by agent name (id 形如 dm:owner↔<名>)", () => {
    const html = sidebarHtml([
        { id: "dm:owner↔Zeta", name: "dm:owner↔Zeta", type: "dm", unread: 0, messageCount: 1 },
        { id: "dm:owner↔Alpha", name: "dm:owner↔Alpha", type: "dm", unread: 0, messageCount: 1 },
        { id: "dm:owner↔Mike", name: "dm:owner↔Mike", type: "dm", unread: 0, messageCount: 1 },
    ]);
    assert.ok(
        html.indexOf(">Alpha<") < html.indexOf(">Mike<"),
        "Alpha before Mike",
    );
    assert.ok(
        html.indexOf(">Mike<") < html.indexOf(">Zeta<"),
        "Mike before Zeta",
    );
});

test("DM channel unread badge renders (unread 口径与频道一致)", () => {
    const html = sidebarHtml([
        { id: "dm:owner↔Nova", name: "dm:owner↔Nova", type: "dm", unread: 7, messageCount: 1 },
    ]);
    const row = channelRow(html, "Nova");
    assert.match(row, />7 msg<\/span>/);
});

/** 用固定 collator 替换 String.prototype.localeCompare，模拟不同宿主 locale 的字符串排序。 */
function withLocaleCompare(collator, fn) {
    const original = String.prototype.localeCompare;
    String.prototype.localeCompare = function (that) {
        return collator.compare(String(this), String(that));
    };
    try {
        return fn();
    } finally {
        String.prototype.localeCompare = original;
    }
}

test("DM 分组排序与宿主 locale 无关（服务端/客户端首帧渲染一致，防 hydration mismatch）", () => {
    // 中英混排：en collation 把「张伟」排到 Zeta 之后，zh-CN collation 把它排到最前。
    // 若排序依赖环境 localeCompare，服务端（Node en-US）与客户端（浏览器 zh-CN）会排出不同顺序。
    const channels = [
        { id: "dm:owner↔张伟", name: "dm:owner↔张伟", type: "dm", unread: 0, messageCount: 1 },
        { id: "dm:owner↔Zeta", name: "dm:owner↔Zeta", type: "dm", unread: 0, messageCount: 1 },
        { id: "dm:owner↔Alpha", name: "dm:owner↔Alpha", type: "dm", unread: 0, messageCount: 1 },
    ];

    const server = withLocaleCompare(new Intl.Collator("en"), () =>
        sidebarHtml(channels),
    );
    const client = withLocaleCompare(new Intl.Collator("zh-CN"), () =>
        sidebarHtml(channels),
    );

    assert.equal(client, server);
});

test("懒创建：空 DM（messageCount 0）不渲染，私信分组回退到空状态 shell.noDm", () => {
    const html = sidebarHtml([
        { id: "dm:owner↔Ghost", name: "dm:owner↔Ghost", type: "dm", unread: 0, messageCount: 0 },
        { id: "c1", name: "general", type: "public", unread: 0, messageCount: 1 },
    ]);
    // 空 DM 不出现，也不泄露 dm:owner↔ 前缀
    assert.doesNotMatch(html, /Ghost/);
    assert.doesNotMatch(html, /dm:owner↔/);
    // 空状态沿用 shell.noDm
    assert.match(html, /No direct messages yet/);
});

test("懒创建：有消息的 DM（messageCount > 0）渲染在私信分组", () => {
    const html = sidebarHtml([
        { id: "dm:owner↔Nova", name: "dm:owner↔Nova", type: "dm", unread: 0, messageCount: 3 },
        { id: "dm:owner↔Ghost", name: "dm:owner↔Ghost", type: "dm", unread: 0, messageCount: 0 },
    ]);
    assert.match(html, />Nova</);
    assert.doesNotMatch(html, /Ghost/);
});

test("懒创建：软删 agent 的有消息 DM 仍显示为归档可读（archived 标记）", () => {
    const html = sidebarHtml([
        { id: "dm:owner↔Retired", name: "dm:owner↔Retired", type: "dm", unread: 0, messageCount: 2, archived: 1 },
    ]);
    const row = channelRow(html, "Retired");
    assert.match(row, /Archived/);
});

// ─── 票 03：rail 行的形态（class 在 markup，形态在 globals.css 的 .nav-row / .avatar 块） ──

// ─── 票 03：rail 行的形态（class 在 markup，形态在 globals.css 的 .nav-row / .avatar 块） ──

test("票 03：rail 的控制面在形态重构后一个不少（行为面回归网）", () => {
    const html = sidebarHtml([]);
    // 创建入口 / 搜索入口 / 收集入口 / 语言 / 紧凑端关闭按钮——两两对应 rail-actions /
    // search-shell / rail-foot / rail-head，任何一个在形态重构中掉队都会被这条钉住。
    for (const label of [
        "New channel",
        "New agent",
        "Search messages…",
        "My reminders",
        "Models",
        "Skills",
        "Language",
        "Close panel",
    ]) {
        assert.ok(html.includes(label), `rail 缺少 \`${label}\``);
    }
    assert.match(html, /class="rail-actions"/);
    assert.match(html, /class="search-shell"/);
    assert.match(html, /class="rail-foot"/);
    // 搜索入口仍是「输入框 + 提交按钮」（Enter/Escape 行为不动；形态取上游 .search-btn）
    assert.match(html, /<input type="search"[^>]*placeholder="Search messages…"/);
    assert.match(html, /<button[^>]*title="Search"[^>]*>\s*<svg/);
});

/** 按名字取一条 `.nav-row`（行内无嵌套按钮，非貪婪匹配到本行自己的 `</button>`）。 */
function navRow(html, name) {
    const rows =
        html.match(/<button[^>]*class="nav-row[^"]*"[^>]*>[\s\S]*?<\/button>/g) ?? [];
    const row = rows.find((candidate) => candidate.includes(name));
    assert.ok(row, `nav row for ${name} should render`);
    return row;
}

test("票 03：rail 频道行 = .nav-row / .hash / .grow；选中的行挂 is-active（其余行不挂）", () => {
    const html = sidebarHtml(
        [
            { id: "c1", name: "reads", type: "public", unread: 0, messageCount: 1 },
            { id: "c2", name: "other", type: "public", unread: 0, messageCount: 1 },
        ],
        { selectedChannelId: "c1" },
    );
    const active = navRow(html, "reads");
    assert.match(active, /class="nav-row is-active"/);
    assert.match(active, /class="hash"/);
    assert.match(active, /class="grow"/);

    const inactive = navRow(html, "other");
    assert.match(inactive, /class="nav-row"/);
    assert.doesNotMatch(inactive, /is-active/);
});

test("票 03：rail agent 行头像 = .avatar.sm（--avatar-sm 22px，票 04 迁到 Avatar）+ .presence", () => {
    const html = sidebarHtml([], {
        agents: [{ id: "a1", name: "Nova", status: "online" }],
    });
    const row = html.match(
        /<button[^>]*class="nav-row"[^>]*>[\s\S]*?Nova[\s\S]*?<\/button>/,
    )?.[0];
    assert.ok(row, "agent row should render");
    // 28 → 22px 的尺寸变化：行内头像走 .avatar.sm 档（尺寸 token 与行高重校见
    // components/AppShell.test.mjs 的 .nav-row / .avatar 断言）
    assert.match(row, /class="avatar sm /);
    assert.match(row, /class="presence online"/);
});
