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

function stripComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, "");
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
    // 界面评审 B1：本仓在逐字搬运行**之后**用同选择器追加了窄屏覆盖（`.chan-top` 换行、
    // `.chan-title` 伸缩、`.chan-tools` 不收缩）。`blockBody` 取首处声明 ⇒ 这里比的仍是
    // 「搬自上游」那一条；覆盖行由本文件末尾的窄屏测试单独守。
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

/** 选择器特异度三元组（id, class/属性/伪类, 元素），用于比较两条规则谁赢。 */
function specificity(selector) {
    const ids = (selector.match(/#[\w-]+/g) ?? []).length;
    const classes = (
        selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(?:\([^)]*\))?/g) ?? []
    ).length;
    const stripped = selector
        .replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+(?:\([^)]*\))?/g, " ")
        .trim();
    const elements = stripped ? stripped.split(/\s+/).length : 0;
    return [ids, classes, elements];
}

function compareSpecificity(a, b) {
    for (let i = 0; i < 3; i += 1) {
        if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
}

test("`···` 二级菜单项不受动作栏图标键几何泄漏：专属 class 以更高特异度收回 display/height/width", () => {
    // 泄漏源本身保持逐字不改（port 块声明体是上游事实，本仓只叠扩展层）。
    assert.equal(
        normalize(blockBody(globalsCss, ".msg-tools button")),
        normalize(blockBody(upstreamCss, ".msg-tools button")),
        "`.msg-tools button` 必须与上游 app.css 逐字一致",
    );
    const iconKey = blockBody(globalsCss, ".msg-tools button");
    // 这就是泄漏：图标键的 grid 居中 + 写死 24px：后代选择器会连带命中菜单项。
    assert.match(iconKey, /display:\s*grid/);
    assert.match(iconKey, /place-items:\s*center/);
    assert.match(iconKey, /height:\s*24px/);

    // 本仓局部规则把泄漏的几何收回来：一行一个 flex 项，宽高随内容。
    const item = blockBody(globalsCss, ".msg-tools .msg-more-menu-item");
    assert.match(item, /display:\s*flex/);
    assert.match(item, /align-items:\s*center/);
    assert.match(item, /justify-content:\s*flex-start/);
    assert.match(item, /height:\s*auto/);
    assert.match(item, /width:\s*100%/);
    assert.match(item, /padding:/);
    assert.match(item, /gap:/);
    assert.match(item, /white-space:\s*nowrap/);
    assert.match(item, /text-align:\s*left/);
    assert.doesNotMatch(item, /place-items/);
    assert.doesNotMatch(item, /height:\s*\d+px/);

    // 单类 (0,1,0) 打不过 `.msg-tools button` 的 (0,1,1)，必须落到 `.msg-tools <class>` 这一级。
    assert.ok(
        compareSpecificity(
            specificity(".msg-tools .msg-more-menu-item"),
            specificity(".msg-tools button"),
        ) > 0,
        "菜单项规则的合法特异度必须高于 `.msg-tools button`：否则 height/display 仍被图标键几何钉死",
    );
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

// ─── 界面评审残留 R2：消息动作栏的键盘入口 ────────────────────────────────────

/**
 * 红→绿证据（先红后绿都跑过同一条命令）：
 *   node --test components/message-stream.test.mjs
 * 红：`MessageRow` 根元素没有 `tabindex`，动作栏拿不到任何行内焦点揭示钩子。
 * 绿：根元素 `tabIndex={0}` + `role="article"` + `aria-label`，CSS 补
 *     `:focus-visible`（行根）+ `:focus-within`（行内）两条揭示选择器。
 *
 * 为什么不是「把 display 换成 opacity」：`display: none` 的后代不在 Tab 序里，
 * 而这条动作栏是**整条消息唯一**的操作入口（反应 chip / 线程角标只覆盖部分消息）。
 * 让行本身成为停靠点，键盘从行首 Tab 一次就能进动作栏；未聚焦时布局零变化。
 */
test("R2: 消息行是键盘停靠点（tabindex=0 + 文章语义 + 含作者与序号的名称）", () => {
    const html = renderI18n(
        React.createElement(MessageRow, {
            message: MESSAGE,
            onReply: () => undefined,
            onQuote: () => undefined,
            onCopyLink: () => undefined,
        }),
    );
    const rootTag = html.match(/<div class="msg ws-message-row"[^>]*>/)?.[0] ?? "";
    assert.ok(rootTag, "消息行根元素应带 .msg.ws-message-row");
    assert.match(rootTag, /tabindex="0"/);
    assert.match(rootTag, /role="article"/);
    // 名称里既有作者名也有 #seq：读屏用户停在行首就知道「这是谁的第几条」。
    assert.match(rootTag, /aria-label="[^"]*Owner/);
    assert.match(rootTag, /aria-label="[^"]*#4/);
    // 不得声明 aria-haspopup：动作栏不是弹出层，是行内展开的一块。
    assert.doesNotMatch(rootTag, /aria-haspopup/);
});

test("R2: 键盘焦点进到行内时揭示整条动作栏（focus-visible + focus-within）", () => {
    // 旧补救规则 `.msg:focus-within` 永远不生效——display:none 的后代不在 Tab 序里，
    // 没有任何元素能在行内触发 :focus-within。行根用 :focus-visible 揭示
    // （不是裸 :focus：鼠标点进正文也会让行获得焦点，那会让动作栏被「点住」常显），
    // 焦点进到行内其它控件后由 :focus-within 续上。
    const stripped = stripComments(globalsCss);
    const reveal = stripped.match(
        /\.msg:not\(\.ws-message-actions-dismissed\):focus-visible \.ws-message-actions,\s*\n\.msg:not\(\.ws-message-actions-dismissed\):focus-within:not\(:focus:not\(:focus-visible\)\):not\(:has\(:focus:not\(:focus-visible\)\)\) \.ws-message-actions \{([^}]*)\}/,
    );
    assert.ok(reveal, "缺键盘揭示规则（行根 focus-visible + 行内 focus-within 两条选择器同一条规则）");
    assert.match(reveal[1], /display:\s*flex/);
    // 焦点已进到行内其它控件（reaction chip / mention / 线程角标）时动作栏不得重新隐藏：
    // 实测 `:focus-visible` 单独用不够——焦点从行根移到行内第一个控件时它立即失效，
    // 浏览器在遍历 Tab 序**之前**就把 display 收回 none，动作栏整条被跳过。
    assert.match(
        stripped,
        /\.msg:not\(\.ws-message-actions-dismissed\):focus-within:not\(:focus:not\(:focus-visible\)\):not\(:has\(:focus:not\(:focus-visible\)\)\) \.ws-message-actions \{[^}]*display:\s*flex/,
    );
    // `:focus-within` 那条必须带两重否定：否则鼠标点进正文 / 点行内 chip 后动作栏
    // 被点住常显（指针手感回归）。实测：点行内 chip 后移开指针仍是 flex；两重否定后回到 none。
    assert.match(stripped, /:not\(:focus:not\(:focus-visible\)\)/);
    assert.match(stripped, /:not\(:has\(:focus:not\(:focus-visible\)\)\)/);
    // 鼠标路径手感不变：揭示钩子不得用裸 `:focus`。
    assert.doesNotMatch(
        stripComments(globalsCss),
        /\.msg:not\(\.ws-message-actions-dismissed\):focus \.ws-message-actions/,
    );
    // 揭示机制不改成常驻：未聚焦未 hover 时仍是 display:none。
    assert.match(blockBody(globalsCss, ".ws-message-actions"), /display:\s*none/);
});

test("R2: 键盘停靠点不改变未聚焦时的行高（不加 outline/边框，只在 :focus-visible 上给环）", () => {
    // 行本身不新增任何占位形态：padding/border/margin 与改动前一致。
    const msg = blockBody(globalsCss, ".msg");
    assert.match(msg, /padding:\s*var\(--sp-5\) var\(--sp-4\)/);
    assert.match(msg, /margin:\s*0 -8px/);
    assert.doesNotMatch(msg, /border:/);
    // 焦点环由 reset 的 `:focus-visible` 承担（键盘可达、鼠标点击不出现环）。
    assert.match(globalsCss, /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent-graphic\)/);
});

test("R2: 键盘按下动作后焦点留在行上（动作栏收起不把键盘用户甩到 BODY）", () => {
    // `completeAction` → `onDismiss` → `.ws-message-actions { display: none }`：被按的
    // 按钮随动作栏一起下线。若不接手，`:focus` 落回 BODY——键盘用户丢掉位置。
    const start = channelViewSource.indexOf("const dismissActions = () => {");
    const end = channelViewSource.indexOf("const actionsRef", start);
    assert.ok(start !== -1 && end > start, "ChannelView 应有 dismissActions 切片");
    const dismiss = channelViewSource.slice(start, end);
    assert.match(dismiss, /rowRef\.current\?\.contains\(active\)/);
    assert.match(dismiss, /rowRef\.current\.focus\(\)/);
    // 行根承接焦点的那条 ref 真的挂在根元素上
    assert.match(channelViewSource, /ref=\{rowRef\}/);
});
