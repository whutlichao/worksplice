/**
 * 频道面（消息流 / composer / 频道头 / pinned 区 / reaction）的落盘断言（票 05，
 * spec D7 组件表第 3 行 / ED-1…ED-10）。
 *
 * 两根 seam，与票 04 的 primitives.test.mjs、票 06 的 task-board.test.mjs 同形：
 * ① **globals.css 的规则体**——频道面的形态全在 class 块里（逐字搬自
 *    `worksplice-design-system/ui_kits/app/app.css`），可观察面是「规则体 + 渲染出的 markup」两半。
 * ② **产品渲染出的 markup**（jiti + renderToStaticMarkup）——消息行 / composer / 频道头真的带上
 *    这些 class，不是断「class 字符串在源码里出现」。
 *
 * 票面没点名、但上游 app.css 里同块的四个 class（`.day-sep` / `.task-chip` / `.composer-hint` /
 * `.msg-tag`，其中 `.day-sep` / `.msg-tag` 在 spec 组件表第 3 行被点名）只作**词汇表**、无渲染点
 * （coordinator 开工前裁决：四条都属新增可见实体）——本文件不为它们落渲染断言，其存在性由 ① 的
 * 逐字搬运清单覆盖。
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
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");
const { MessageRow, Composer, ChannelView } =
    await jiti.import("./ChannelView.tsx");
const { WorkspaceSidebar } = await jiti.import("./WorkspaceSidebar.tsx");
const { CreateChannelModal } = await jiti.import("./CreateChannelModal.tsx");

const globalsCss = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
);
const upstreamCss = await readFile(
    new URL(
        "../worksplice-design-system/ui_kits/app/app.css",
        import.meta.url,
    ),
    "utf8",
);
const channelViewSource = await readFile(
    new URL("./ChannelView.tsx", import.meta.url),
    "utf8",
);

function escapeRe(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 取一条规则的声明体（选择器与 `{` 之间只允许空白，避免误命中更长的选择器）。 */
function blockBody(css, selector) {
    const pattern = new RegExp(
        `(?:^|[}])\\s*${escapeRe(selector)}\\s*\\{([^}]*)\\}`,
        "m",
    );
    const match = css.match(pattern);
    assert.ok(match, `缺少规则 \`${selector}\``);
    return match[1];
}

function normalize(body) {
    return body.replace(/\s+/g, " ").trim();
}

function renderI18n(children) {
    return renderToStaticMarkup(
        React.createElement(I18nProvider, null, children),
    );
}

const OWNER = {
    id: "owner",
    type: "human",
    name: "Owner",
    description: "",
    role: "owner",
    workspace_path: null,
    pi_session_file: null,
    status: "online",
    created_at: "2026-08-03T00:00:00.000Z",
};

const AGENT = { ...OWNER, id: "agent-1", type: "agent", name: "Nova" };

const MESSAGE = {
    id: "msg-1",
    target_id: "#all",
    seq: 4,
    author_id: "owner",
    content: "hello **world**",
    created_at: "2026-08-03T08:00:00.000Z",
    author: OWNER,
};

const CHANNEL = {
    id: "c1",
    name: "general",
    type: "public",
    description: "chat",
    archived: 0,
    created_at: "2026-08-03T00:00:00.000Z",
    joined: true,
    memberCount: 2,
};

/** 频道面三段源码切片（两端都是稳定符号名）——红线自查只看这三段。 */
function channelFaceSlices() {
    const messageFlowStart = channelViewSource.indexOf("function EmptyState(");
    const messageFlowEnd = channelViewSource.indexOf(
        "const TASK_STATUS_COLOR",
        messageFlowStart,
    );
    const composerStart = channelViewSource.indexOf("export function Composer(");
    const composerEnd = channelViewSource.indexOf(
        "export function ChannelView(",
        composerStart,
    );
    const channelStart = channelViewSource.indexOf("export function ChannelView(");
    assert.ok(
        messageFlowStart !== -1 &&
            messageFlowEnd > messageFlowStart &&
            composerStart !== -1 &&
            composerEnd > composerStart &&
            channelStart !== -1,
        "ChannelView.tsx 应当有「消息流 → TASK_STATUS_COLOR」/「Composer → ChannelView」两段稳定切片",
    );
    return {
        messageFlow: channelViewSource.slice(messageFlowStart, messageFlowEnd),
        composer: channelViewSource.slice(composerStart, composerEnd),
        channel: channelViewSource.slice(channelStart),
    };
}

// ─── ① globals.css：逐字搬运 + 票面判据的 token 绑定 ──────────────────────────

test("频道面 class 块逐字搬自上游 app.css（形态来源唯一）", () => {
    // `.msg:hover` 是唯一逐字差异（票面明写 `--fg-soft`，上游是 3.5% 的 color-mix），单独断言在下一例。
    const ported = [
        ".chan-head",
        ".chan-top",
        ".chan-title",
        ".chan-title .hash",
        ".chan-desc",
        ".chan-tools",
        ".chan-divider",
        ".pin-strip",
        ".pin-strip b",
        ".pin-strip .icon",
        ".stream",
        ".stream-inner",
        ".day-sep",
        ".msg",
        ".msg-body",
        ".msg-head",
        ".msg-author",
        ".msg-author.is-agent",
        ".msg-tag",
        ".msg-time",
        ".msg-text",
        '.msg-text > .markdown-body',
        '.msg-text p',
        '.msg-text p:last-child',
        ".msg-tools",
        ".task-chip",
        ".reactions",
        ".reaction",
        ".reaction.mine",
        ".composer",
        ".composer-inner",
        ".composer-box",
        ".composer-box:focus-within",
        ".composer-input",
        ".composer-bar",
        ".composer-hint",
        ".composer-send",
        ".tabs",
        ".tab",
        ".tab.is-active",
    ];
    for (const selector of ported) {
        assert.equal(
            normalize(blockBody(globalsCss, selector)),
            normalize(blockBody(upstreamCss, selector)),
            `${selector} 与上游 app.css 的声明体不一致`,
        );
    }
});

test('message prose uses the approved channel and thread reading scales', () => {
    const prose = blockBody(globalsCss, '.msg-text > .markdown-body');
    const channelParagraphs = blockBody(globalsCss, '.msg-text p');
    const threadRow = blockBody(globalsCss, '.ws-right .msg');
    const threadProse = blockBody(
        globalsCss,
        '.ws-right .msg-text > .markdown-body',
    );
    const threadParagraphs = blockBody(
        globalsCss,
        '.ws-right .msg-text p:not(:last-child)',
    );
    const author = blockBody(globalsCss, '.msg-author');
    const time = blockBody(globalsCss, '.msg-time');
    const inlineCode = blockBody(globalsCss, '.msg-text code');

    assert.match(
        blockBody(globalsCss, '.msg'),
        /padding:\s*var\(--sp-5\)\s+var\(--sp-4\)/,
    );
    assert.match(author, /font-size:\s*14px/);
    assert.match(time, /font-family:\s*var\(--mono\)/);
    assert.match(time, /font-size:\s*var\(--fs-mono-xs\)/);
    assert.match(time, /color:\s*var\(--faint\)/);
    assert.match(prose, /max-width:\s*68ch/);
    assert.match(prose, /font-size:\s*14px/);
    assert.match(prose, /line-height:\s*1\.65/);
    assert.match(channelParagraphs, /margin:\s*0 0 var\(--sp-4\)/);
    assert.match(threadRow, /padding-inline:\s*var\(--sp-7\)/);
    assert.match(threadRow, /padding-block:\s*var\(--sp-7\)/);
    assert.match(threadProse, /line-height:\s*1\.7/);
    assert.match(threadParagraphs, /margin-bottom:\s*var\(--sp-5\)/);
    assert.match(inlineCode, /font-size:\s*12px/);
    assert.doesNotMatch(inlineCode, /line-height:/);
});

test("消息行 hover 走 --fg-soft；锚点行不再是黄色实心且带左侧 accent 条", () => {
    const hover = blockBody(globalsCss, ".msg:hover");
    assert.match(hover, /background:\s*var\(--fg-soft\)/);
    assert.doesNotMatch(hover, /--yellow/);

    // 锚点 fill 归票 03 的骨架钩子；本票补的是左侧 accent 条（spec D3 的「当前位置」处置）。
    // 票 03：锚点是「当前位置」→ 选中族（淡底 + 图形档竖条）。判据（不是黄色实心、竖条可见）不变。
    const anchorFill = blockBody(globalsCss, ".ws-message-row-anchor");
    assert.match(anchorFill, /background:\s*var\(--selected-soft\)/);
    assert.doesNotMatch(anchorFill, /--yellow|var\(--accent\);/);
    const anchorBar = blockBody(globalsCss, ".ws-message-row-anchor::before");
    assert.match(anchorBar, /background:\s*var\(--selected-graphic\)/);
    assert.match(anchorBar, /width:\s*2px/);
    // 锚点行的 hover 也要留在「当前位置」色：`.msg:hover` 与票 03 的锚点 hover 同特异度、后者会被吃掉。
    assert.match(
        blockBody(globalsCss, ".msg.ws-message-row-anchor:hover"),
        /background:\s*var\(--selected-soft\)/,
    );
});

test("消息时间戳与 #seq 走 var(--mono) + tabular-nums", () => {
    const msgTime = blockBody(globalsCss, ".msg-time");
    assert.match(msgTime, /font-family:\s*var\(--mono\)/);
    assert.match(msgTime, /font-size:\s*var\(--fs-mono-xs\)/);
    // `.mono` 是设计系统 reset 的 mono 角色（tabular-nums 在那一组里）。
    assert.match(globalsCss, /code,\s*\.mono\s*\{[^}]*tabular-nums/);
});

test("消息动作栏：绝对定位、hover/focus 才出、--shadow-pop、opacity 过渡", () => {
    const tools = blockBody(globalsCss, ".msg-tools");
    assert.match(tools, /position:\s*absolute/);
    assert.match(tools, /opacity:\s*0/);
    assert.match(tools, /box-shadow:\s*var\(--shadow-pop\)/);
    assert.match(tools, /transition:\s*opacity var\(--dur\) var\(--ease\)/);
    const reveal = blockBody(
        globalsCss,
        ".msg:hover .msg-tools, .msg:focus-within .msg-tools",
    );
    assert.match(reveal, /opacity:\s*1/);
    // 常驻内容不吃 --shadow-pop；消息行与动作栏无 2px 结构线
    assert.doesNotMatch(blockBody(globalsCss, ".msg"), /2px solid/);
    assert.doesNotMatch(tools, /2px solid/);
});


// ─── ② 渲染面 ────────────────────────────────────────────────────────────────

test("MessageRow 渲染出 .msg 形态：行 / 头 / 作者 / 正文 / 动作栏", () => {
    const html = renderI18n(
        React.createElement(MessageRow, {
            message: MESSAGE,
            onReply: () => undefined,
            onQuote: () => undefined,
            onCopyLink: () => undefined,
        }),
    );

    assert.match(html, /class="msg ws-message-row"/);
    assert.match(html, /class="msg-body"/);
    assert.match(html, /class="msg-head"/);
    assert.match(html, /class="msg-author"/);
    assert.match(html, /class="msg-text"/);
    assert.match(html, /class="msg-tools"/);
    // 头像走 26px 档（`.avatar` = `--avatar-md`），行内不再写尺寸
    assert.match(html, /class="avatar av-\d"/);
    assert.doesNotMatch(html, /width:\s*40/);
    assert.match(blockBody(globalsCss, ".avatar"), /width:\s*var\(--avatar-md\)/);
    // 旧方向的粗结构线与硬偏移阴影在渲染面全退场
    assert.doesNotMatch(html, /2px solid/);
    assert.doesNotMatch(html, /rgba\(20/);
    assert.doesNotMatch(html, /\d+px \d+px 0 0/);
});

test("MessageRow 的锚点行带骨架钩子，不再是黄色实心", () => {
    const html = renderI18n(
        React.createElement(MessageRow, {
            message: MESSAGE,
            isAnchor: true,
            onQuote: () => undefined,
            onCopyLink: () => undefined,
        }),
    );
    assert.match(html, /class="msg ws-message-row ws-message-row-anchor"/);
    assert.doesNotMatch(html, /--yellow|bg-selected/);
});

test("MessageRow 的 agent 作者带 .msg-author.is-agent（accent）", () => {
    const html = renderI18n(
        React.createElement(MessageRow, {
            message: { ...MESSAGE, author_id: "agent-1", author: AGENT },
            onQuote: () => undefined,
            onCopyLink: () => undefined,
        }),
    );
    assert.match(html, /class="msg-author is-agent"/);
    // 票 03：agent 作者名是**文字** → 文字档。判据（agent 与人类作者可区分）不变。
    assert.match(
        blockBody(globalsCss, ".msg-author.is-agent"),
        /color:\s*var\(--accent-deep\)/,
    );
});

test("同一 agent ID 在消息、侧栏与成员挑选项的渲染头像使用同一色调", () => {
    const fixtureAgent = { ...AGENT, id: "agent-fixture-0" };
    const messageHtml = renderI18n(
        React.createElement(MessageRow, {
            message: {
                ...MESSAGE,
                author_id: fixtureAgent.id,
                author: fixtureAgent,
            },
            onQuote: () => undefined,
            onCopyLink: () => undefined,
        }),
    );
    const sidebarHtml = renderI18n(
        React.createElement(WorkspaceSidebar, {
            channels: [],
            agents: [fixtureAgent],
            error: null,
            selectedChannelId: null,
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
    const pickerHtml = renderI18n(
        React.createElement(CreateChannelModal, {
            agents: [fixtureAgent],
            onClose: () => undefined,
            onCreated: () => undefined,
        }),
    );
    const avatarTint = (html, surface) => {
        const tint = html.match(/class="avatar(?: sm)? av-(\d)"/)?.[1];
        assert.ok(tint, `${surface} 应渲染带 av-* 色调的头像`);
        return tint;
    };

    const messageTint = avatarTint(messageHtml, "消息行");
    assert.match(messageHtml, /class="avatar av-[0-3]"/, "agent 不占用中性 av-4");
    assert.equal(
        avatarTint(sidebarHtml, "侧栏 Agent 行"),
        messageTint,
        "同一 member ID 在消息行与侧栏应使用同一色调",
    );
    assert.equal(
        avatarTint(pickerHtml, "成员挑选项"),
        messageTint,
        "同一 member ID 在消息行与成员挑选项应使用同一色调",
    );
});

test("MessageRow 的时间戳与 #seq 都带 mono 角色类", () => {
    const html = renderI18n(
        React.createElement(MessageRow, {
            message: MESSAGE,
            onQuote: () => undefined,
            onCopyLink: () => undefined,
        }),
    );
    // seq + 时间戳两处（`#seq` 是可引用的消息身份，色阶比时间戳高一档）
    assert.equal(html.split('class="msg-time mono"').length - 1, 2);
    assert.match(html, /#4/);
});

test("reaction 聚合条走 .reactions / .reaction（我点过 → .mine）", () => {
    const html = renderI18n(
        React.createElement(MessageRow, {
            message: {
                ...MESSAGE,
                reactions: [
                    { emoji: "👍", count: 2, memberIds: ["owner", "agent-1"] },
                    { emoji: "❤️", count: 1, memberIds: ["agent-1"] },
                ],
            },
            currentMemberId: "owner",
            onQuote: () => undefined,
            onCopyLink: () => undefined,
            onToggleReaction: () => undefined,
        }),
    );
    assert.match(html, /class="reactions"/);
    assert.match(html, /class="reaction mine"/);
    assert.match(html, /class="reaction"/);
    // 票 03：`mine` = 我点过 = 选中态 → 选中族淡底。判据（我的反应与别人的可区分）不变。
    assert.match(
        blockBody(globalsCss, ".reaction.mine"),
        /background:\s*var\(--selected-soft\)/,
    );
});

test("Composer 走 .composer/.composer-box/.composer-bar/.composer-send（accent 焦点环）", () => {
    const html = renderI18n(
        React.createElement(Composer, {
            targetId: "#all",
            disabled: false,
            disabledHint: "",
            quoting: MESSAGE,
            onClearQuote: () => undefined,
            onSend: async () => undefined,
        }),
    );

    assert.match(html, /class="composer"/);
    assert.match(html, /class="composer-inner"/);
    assert.match(html, /class="composer-box"/);
    assert.match(html, /class="composer-bar"/);
    assert.match(html, /class="composer-input"/);
    assert.match(html, /class="composer-send"/);
    // 焦点环与常驻输入的阴影都在 box 上；--shadow-pop 归弹层，不进 composer
    const box = blockBody(globalsCss, ".composer-box");
    assert.match(box, /background:\s*var\(--surface\)/);
    assert.match(box, /border:\s*1px solid var\(--border-strong\)/);
    assert.match(box, /border-radius:\s*var\(--r-lg\)/);
    assert.match(box, /box-shadow:\s*var\(--shadow-composer\)/);
    assert.doesNotMatch(box, /--shadow-pop/);
    assert.match(
        blockBody(globalsCss, ".composer-box:focus-within"),
        /0 0 0 3px var\(--accent-soft\)/,
    );
    // 内层 textarea 不再叠第二圈：字段环已在外壳（`:focus-within`）上，内层自己的环
    // 会落在外壳环内侧 1px 处叠成双层、且近直角不跟 `--r-lg` 圆角——同 `.search-btn input`
    // （票 03）与 `.search-field input`（票 09）两处既有处置。
    assert.match(
        blockBody(globalsCss, ".composer-input:focus-visible"),
        /box-shadow:\s*none/,
    );
    assert.match(
        blockBody(globalsCss, ".composer-send"),
        /background:\s*var\(--accent\)/,
    );
    // 行为面不动：引用 chip 仍在，发送键仍带无障碍名
    assert.match(html, /aria-label="Clear quote"/);
    assert.match(html, /aria-label="Send"/);
});

test("频道头走 .chan-head/.chan-top/.chan-title（# 号 accent mono）/.chan-desc/.chan-tools/.chan-divider", () => {
    const html = renderI18n(
        React.createElement(ChannelView, {
            channel: CHANNEL,
            tab: "messages",
            onTabChange: () => undefined,
            currentMemberId: "owner",
            onChannelChanged: () => undefined,
            focusMessageId: null,
        }),
    );

    assert.match(html, /class="ws-center-header chan-head"/);
    assert.match(html, /class="chan-top"/);
    assert.match(html, /class="chan-title"/);
    assert.match(html, /class="hash"/);
    assert.match(html, /class="chan-desc"/);
    assert.match(html, /class="chan-tools"/);
    assert.match(html, /class="chan-divider"/);
    assert.match(html, /class="badge soft"/);
    const head = blockBody(globalsCss, ".chan-head");
    assert.match(head, /background:\s*var\(--surface\)/);
    assert.match(head, /border-bottom:\s*1px solid var\(--border\)/);
    const title = blockBody(globalsCss, ".chan-title");
    assert.match(title, /font-size:\s*var\(--fs-heading\)/);
    assert.match(title, /font-weight:\s*var\(--fw-heavy\)/);
    assert.match(title, /letter-spacing:\s*var\(--ls-tight\)/);
    const hash = blockBody(globalsCss, ".chan-title .hash");
    // 票 03：频道名的 # 是文字 → 文字档。判据（mono + accent 族强调色）不变。
    assert.match(hash, /color:\s*var\(--accent-deep\)/);
    assert.match(hash, /font-family:\s*var\(--mono\)/);
});

test("频道头切换条走 .tabs/.tab（旧方向的硬偏移阴影退场）", () => {
    const html = renderI18n(
        React.createElement(ChannelView, {
            channel: CHANNEL,
            tab: "messages",
            onTabChange: () => undefined,
            currentMemberId: "owner",
            onChannelChanged: () => undefined,
            focusMessageId: null,
        }),
    );
    assert.match(html, /class="tabs"/);
    assert.match(html, /class="tab is-active"/);
    assert.match(html, /class="tab"/);
    const tabs = blockBody(globalsCss, ".tabs");
    assert.match(tabs, /background:\s*var\(--surface\)/);
    assert.match(tabs, /border-bottom:\s*1px solid var\(--border\)/);
    assert.match(
        blockBody(globalsCss, ".tab.is-active"),
        /border-bottom-color:\s*var\(--fg\)/,
    );
});

test("频道面源码无 rgba 硬阴影 / 无硬偏移阴影 / 无 2px 结构线（三段切片）", () => {
    for (const [name, section] of Object.entries(channelFaceSlices())) {
        assert.doesNotMatch(section, /rgba\(/, `${name} 段仍有 rgba 硬阴影`);
        assert.doesNotMatch(
            section,
            /\d+px \d+px 0 0/,
            `${name} 段仍有硬偏移阴影`,
        );
        assert.doesNotMatch(
            section,
            /2px solid(?!\s+transparent)/,
            `${name} 段仍有有色 2px 结构线`,
        );
    }
});
