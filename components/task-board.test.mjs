/**
 * 任务板两视图的落盘断言（票 06，spec D7 组件表第 4 行 / ED-10）。
 *
 * 两根 seam，与票 04 的 primitives.test.mjs 同形：
 * ① **globals.css 的规则体**——`.board*` / `.col*` / `.card*` / `.seg` / `.filter-chip` /
 *    `.drop-hint` / 拖拽态这些 class 块逐字搬自 `worksplice-design-system/ui_kits/app/app.css`，
 *    可观察面是「CSS 规则体 + 组件渲染出的 markup」两半；形态全在 CSS，所以断在规则体上。
 * ② **产品渲染出的 markup**（jiti + renderToStaticMarkup）——列/卡片/工具条真的带上这些 class、
 *    真的渲染出 ED-10 的状态色与 owner/未认领分支；不是断「class 字符串在源码里出现」。
 *
 * 拖拽中的态（`.col.drag-over` / `.col.invalid-over` / `.card.dragging`）在静态渲染里不可达
 * （dragOver/dragId 是交互期状态），所以它们由 ①（规则体存在）+ `.card.dragging` 的 prop
 * 渲染断言（display-only 的 `dragging`）+ 落点裁决表达式的源码级断言三层证据守住。
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

/** 任务板段的源码切片（从状态色映射到 Composer 之前，两端都是稳定符号名）——红线自查只看这一段。 */
function boardSectionSource() {
    const start = channelViewSource.indexOf("const TASK_STATUS_COLOR");
    const end = channelViewSource.indexOf("export function Composer", start);
    assert.ok(
        start !== -1 && end > start,
        "ChannelView.tsx 应当有任务板段（TASK_STATUS_COLOR → Composer 之前）",
    );
    return channelViewSource.slice(start, end);
}

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

/** 任务板 class 块（从「task board」段标到下一段 `/* ===` 块注释之前）——「这一段里不许有视口魔数」的判定面。 */
function taskBoardCssBlock() {
    const start = globalsCss.indexOf("/* ─── task board");
    assert.notEqual(start, -1, "globals.css 应当有「task board」class 块段标");
    const end = globalsCss.indexOf("/* ===", start + 1);
    assert.ok(end > start, "任务板段应当有结束界标");
    return globalsCss.slice(start, end);
}

function renderI18n(children) {
    return renderToStaticMarkup(
        React.createElement(I18nProvider, null, children),
    );
}

const TASK_STATUS_COLOR = {
    todo: "var(--faint)",
    // 票 03：点档改名（--accent 今为填充档，点上看不见）→ 图形档。
    in_progress: "var(--accent-graphic)",
    in_review: "var(--working)",
    done: "var(--online)",
    closed: "var(--offline)",
};

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
    target_id: "c1",
    seq: 4,
    author_id: "owner",
    content: "hello world",
    created_at: "2026-08-03T08:00:00.000Z",
    author: OWNER,
};

function task(overrides = {}) {
    return {
        id: "task-1",
        message_id: "msg-1",
        number: 1,
        status: "todo",
        owner_id: null,
        reopened: 0,
        updated_at: "2026-08-03T08:00:00.000Z",
        channelId: "c1",
        anchor: MESSAGE,
        owner: null,
        reachable: ["in_progress"],
        ...overrides,
    };
}

// ─── ① globals.css 的规则体（逐字搬运） ──────────────────────────────────────

test("任务板骨架：.board-wrap 竖排不溢出；列不拉伸、宽度取自 --board-col-w", () => {
    const wrap = blockBody(globalsCss, ".board-wrap");
    assert.match(wrap, /flex:\s*1/);
    assert.match(wrap, /min-height:\s*0/);
    assert.match(wrap, /display:\s*flex/);
    assert.match(wrap, /flex-direction:\s*column/);
    assert.match(wrap, /overflow:\s*hidden/);

    const toolbar = blockBody(globalsCss, ".board-toolbar");
    assert.match(toolbar, /display:\s*flex/);
    assert.match(toolbar, /padding:\s*var\(--sp-5\) var\(--sp-9\)/);
    assert.match(toolbar, /border-bottom:\s*1px solid var\(--border\)/);
    assert.match(blockBody(globalsCss, ".board-toolbar .sep"), /flex:\s*1/);

    const board = blockBody(globalsCss, ".board");
    assert.match(board, /flex:\s*1/);
    assert.match(board, /min-height:\s*0/);
    assert.match(board, /overflow:\s*auto/);

    const cols = blockBody(globalsCss, ".board-cols");
    assert.match(cols, /display:\s*flex/);
    assert.match(cols, /gap:\s*var\(--sp-5\)/);
    // 票 task-view-scroll：列等高铺满（align-items 由 flex-start 改 stretch），
    // 高度跟容器可用高度走而不是跟视口走——原值 flex-start + `.col` 的
    // `calc(100dvh - 168px)` 让列永远比可视区高一点，页面与列内同时出滚动条。
    assert.match(cols, /align-items:\s*stretch/);
    assert.match(cols, /height:\s*100%/);
    assert.match(cols, /min-width:\s*min-content/);

    // 列定宽 236px = --board-col-w；flex: 0 0 ⇒ 不随容器拉伸。
    const col = blockBody(globalsCss, ".col");
    assert.match(col, /width:\s*var\(--board-col-w\)/);
    assert.match(col, /flex:\s*0 0 var\(--board-col-w\)/);
    assert.match(col, /background:\s*var\(--panel\)/);
    assert.match(col, /border:\s*1px solid var\(--border\)/);
    assert.match(col, /border-radius:\s*var\(--r-lg\)/);

    assert.match(blockBody(globalsCss, ".col-head"), /display:\s*flex/);
    assert.match(blockBody(globalsCss, ".col-head .st-dot"), /width:\s*8px/);
    assert.match(
        blockBody(globalsCss, ".col-head .col-count"),
        /font-family:\s*var\(--mono\)/,
    );
    const body = blockBody(globalsCss, ".col-body");
    assert.match(body, /flex-direction:\s*column/);
    assert.match(body, /overflow-y:\s*auto/);
    assert.match(body, /min-height:\s*44px/);
    // 票 task-view-scroll：列体吃满列高（`flex: 1`）才有「列内滚、页面不滚」的结果。
    // 声明顺序是承重的：`flex` 简写写在 `flex-direction` **之后**会把列体拍回 row。
    assert.match(body, /flex:\s*1/);
    assert.ok(
        body.indexOf("flex: 1") < body.indexOf("flex-direction"),
        "`flex` 简写必须写在 `flex-direction` 之前，否则简写把它重置成 row",
    );
});

test("board 视图滚动归属：列等高铺满、视口魔数退场、.board 纵向不滚（只留横向）", () => {
    // 列高跟容器可用高度走：`max-height: calc(100dvh - 168px)` 这类视口魔数退场——
    // 它与工具条/tabs/header/安全区 inset 无关，任一变化就偏，于是「列内滚 + 页面滚」两套滚动条同时在场。
    const col = blockBody(globalsCss, ".col");
    assert.doesNotMatch(col, /max-height/);
    assert.doesNotMatch(col, /100dvh/);
    assert.match(col, /min-height:\s*0/);

    const cols = blockBody(globalsCss, ".board-cols");
    assert.doesNotMatch(cols, /100dvh/);

    // 整段任务板 class 块里不得再有视口魔数（机械判定，不靠逐条枚举）。
    assert.doesNotMatch(taskBoardCssBlock(), /100dvh/);

    // board 视图：页面级纵向滚动退场（`is-board` 修饰类由 TaskViews 按 view 打），
    // 横向滚动保留——5 列窄屏时仍要能横着走。
    const boardIsBoard = blockBody(globalsCss, ".board.is-board");
    assert.match(boardIsBoard, /overflow-x:\s*auto/);
    assert.match(boardIsBoard, /overflow-y:\s*hidden/);
});

test("list 视图：工具条吸顶 + 底部留白（.board-wrap 不是滚动容器，main 才是）", () => {
    // 吸顶形态与 `.tt-summary` 同形（position: sticky + top: 0 + z-index）。
    const sticky = blockBody(globalsCss, ".board-wrap.is-list .board-toolbar");
    assert.match(sticky, /position:\s*sticky/);
    assert.match(sticky, /top:\s*0/);
    assert.match(sticky, /z-index:\s*\d+/);
    // 能盖住滚上来的内容：工具条本体自带不透明底 + 下边框（上游逐字那条，不动它）。
    const toolbar = blockBody(globalsCss, ".board-toolbar");
    assert.match(toolbar, /background:\s*var\(--bg\)/);
    assert.match(toolbar, /border-bottom:\s*1px solid var\(--border\)/);
    // sticky 的滚动容器必须是 main：`.board-wrap` 自带 overflow: hidden 时它是最近的
    // scrollport 而永不滚动 ⇒ 工具条钉不住。列表视图下把它放回 visible。
    assert.match(
        blockBody(globalsCss, ".board-wrap.is-list"),
        /overflow:\s*visible/,
    );
    // 列表内容末尾的呼吸位（末张卡片不再贴视口底边）。
    assert.match(
        blockBody(globalsCss, ".board.is-list"),
        /padding-bottom:\s*var\(--sp-12\)/,
    );
});

test("list 分组 class：可点的分组头 + `.task-group-body[hidden]` 显式收起", () => {
    assert.match(blockBody(globalsCss, ".task-group"), /margin-bottom/);
    const head = blockBody(globalsCss, ".task-group-head");
    assert.match(head, /display:\s*flex/);
    assert.match(head, /align-items:\s*center/);
    assert.match(head, /width:\s*100%/);
    // 按钮默认居中文字，分组头要左对齐才与看板列头同一基线。
    assert.match(head, /text-align:\s*left/);
    assert.match(blockBody(globalsCss, ".task-group-caret"), /flex:\s*0 0 auto/);
    assert.match(
        blockBody(globalsCss, ".task-group-count"),
        /font-family:\s*var\(--mono\)/,
    );
    // 作者样式里的 `display: flex` 会盖掉 UA 的 `[hidden] { display: none }`——
    // 折叠态必须由这条显式收掉，否则 hidden 不生效。
    assert.match(
        blockBody(globalsCss, ".task-group-body[hidden]"),
        /display:\s*none/,
    );
});

test("任务板拖拽态：.drag-over 走 --accent-graphic、.invalid-over 走 --error、拖拽中 opacity .4", () => {
    // 票 03：拖拽落点是**边界**语义 → 图形档（≥3:1）。判据（落点边界可见）不变。
    assert.match(
        blockBody(globalsCss, ".col.drag-over"),
        /border-color:\s*var\(--accent-graphic\)/,
    );
    assert.match(
        blockBody(globalsCss, ".col.drag-over"),
        /background:\s*var\(--accent-soft\)/,
    );
    // 非法落点只有红边——不填充，不与可达态混成同一种手势反馈。
    const invalid = blockBody(globalsCss, ".col.invalid-over");
    assert.match(invalid, /border-color:\s*var\(--error\)/);
    assert.doesNotMatch(invalid, /background/);

    const dragging = blockBody(globalsCss, ".card.dragging");
    assert.match(dragging, /opacity:\s*\.4/);
    assert.match(dragging, /cursor:\s*grabbing/);
});

test("任务板卡片：.card-title / .card-meta / .card-num（mono）/ .card-owner（未认领斜体）/ .card-tag", () => {
    assert.match(
        blockBody(globalsCss, ".card-title"),
        /overflow-wrap:\s*anywhere/,
    );
    assert.match(blockBody(globalsCss, ".card-meta"), /flex-wrap:\s*wrap/);
    assert.match(
        blockBody(globalsCss, ".card-num"),
        /font-family:\s*var\(--mono\)/,
    );
    assert.match(
        blockBody(globalsCss, ".card-num"),
        /color:\s*var\(--faint\)/,
    );
    const owner = blockBody(globalsCss, ".card-owner");
    assert.match(owner, /display:\s*flex/);
    assert.match(owner, /align-items:\s*center/);
    assert.match(owner, /gap:\s*5px/);
    assert.match(owner, /font-size:\s*11px/);
    const unassigned = blockBody(globalsCss, ".card-owner.unassigned");
    assert.match(unassigned, /font-style:\s*italic/);
    assert.match(unassigned, /color:\s*var\(--faint\)/);
    assert.match(
        blockBody(globalsCss, ".card-tag"),
        /font-family:\s*var\(--mono\)/,
    );
});

test("任务板工具条：.seg 分段控件（is-active 走 --fg 实底）/ .filter-chip（is-on 走 accent）", () => {
    const seg = blockBody(globalsCss, ".seg");
    assert.match(seg, /display:\s*inline-flex/);
    assert.match(seg, /border-radius:\s*var\(--r-md\)/);
    assert.match(seg, /background:\s*var\(--surface\)/);

    const segButton = blockBody(globalsCss, ".seg button");
    assert.match(segButton, /height:\s*var\(--icon-btn\)/);
    assert.match(segButton, /color:\s*var\(--muted\)/);
    assert.match(
        blockBody(globalsCss, ".seg button.is-active"),
        /background:\s*var\(--fg\)/,
    );

    const chip = blockBody(globalsCss, ".filter-chip");
    assert.match(chip, /height:\s*var\(--icon-btn\)/);
    assert.match(chip, /border-radius:\s*var\(--r-md\)/);
    // 票 03：选中 chip 归选中族（`--accent-line` 退役、淡底与边界都改族）。
    // 判据（选中态 = 淡底 + 可见边界，成对出现）不变。
    const chipOn = blockBody(globalsCss, ".filter-chip.is-on");
    assert.match(chipOn, /border-color:\s*var\(--selected-graphic\)/);
    assert.match(chipOn, /background:\s*var\(--selected-soft\)/);
});

test("任务板空槽 .drop-hint：虚线 + --r-md + --faint（无 2px 结构线）", () => {
    const hint = blockBody(globalsCss, ".drop-hint");
    assert.match(hint, /border:\s*1px dashed var\(--border-strong\)/);
    assert.match(hint, /border-radius:\s*var\(--r-md\)/);
    assert.match(hint, /text-align:\s*center/);
    assert.match(hint, /color:\s*var\(--faint\)/);
});

test("逐字搬运：本仓的任务板规则体与上游 app.css 的同名规则逐字相同", () => {
    // 逐条比对（不比对整块文本：上游块里 `.card` / `.card:hover` 已由票 04 的原语段落位，
    // 本仓不会再抄第二份——否则同一个 class 有两处声明，形态来源就分叉了）。
    const selectors = [
        ".board-wrap",
        ".board-toolbar",
        ".board-toolbar .sep",
        ".seg",
        ".seg button",
        ".seg button:last-child",
        ".seg button:hover",
        ".seg button.is-active",
        ".filter-chip",
        ".filter-chip:hover",
        ".filter-chip.is-on",
        ".board",
        ".board-cols",
        ".col",
        ".col-head",
        ".col-head .st-dot",
        ".col-head b",
        ".col-head .col-count",
        ".col-head .col-add",
        ".col-head .col-add:hover",
        ".col-body",
        ".col.drag-over",
        ".col.invalid-over",
        ".card.dragging",
        ".card-title",
        ".card-meta",
        ".card-num",
        ".card-tag",
        ".card-owner",
        ".card-owner.unassigned",
        ".drop-hint",
    ];
    for (const selector of selectors) {
        assert.equal(
            blockBody(globalsCss, selector).replace(/\s+/g, " ").trim(),
            blockBody(upstreamCss, selector).replace(/\s+/g, " ").trim(),
            `${selector} 与上游 app.css 不一致`,
        );
    }
});

// ─── ② 产品渲染出的 markup ───────────────────────────────────────────────────

test("TaskBoard 渲染 5 列（ED-10 状态色 / 列头 / 列体），列宽不再内联", async () => {
    const mod = await jiti.import("./ChannelView.tsx");
    assert.equal(typeof mod.TaskBoard, "function");

    const html = renderI18n(
        React.createElement(mod.TaskBoard, {
            tasks: [task()],
            currentMemberId: "owner",
            busy: false,
            onAction: () => undefined,
            onOpenThread: () => undefined,
            onInvalidDrop: () => undefined,
        }),
    );

    // 五列常显（ADR-0002）：todo/in_progress/in_review/done/closed。
    assert.equal(html.split('class="col"').length - 1, 5);
    assert.equal(html.split('class="col-head"').length - 1, 5);
    assert.equal(html.split('class="col-body"').length - 1, 5);
    assert.equal(html.split('class="st-dot"').length - 1, 5);

    // 列宽/拉伸由 CSS 决定，markup 里不许再出现旧内联盒模型。
    assert.doesNotMatch(html, /236px/);
    assert.doesNotMatch(html, /flex:0 0 236px|flex: 0 0 236px/);

    // ED-10：五种状态色全部落在列头状态点上（四态 token + --faint/--accent）。
    for (const color of Object.values(TASK_STATUS_COLOR)) {
        assert.match(
            html,
            new RegExp(`style="background:${escapeRe(color)}"`),
            `列头状态点缺 ${color}`,
        );
    }
    // 无马卡龙色 / 无新色值 / 无内联盒模型（列宽/拉伸归 CSS）。
    assert.doesNotMatch(html, /--(cream|yellow|pink|cyan|orange|lime|lavender|coral)/);
    assert.doesNotMatch(html, /#[0-9a-fA-F]{3,6}\b/);
    const boardSection = boardSectionSource();
    assert.doesNotMatch(boardSection, /236px/);
    assert.doesNotMatch(boardSection, /boxShadow/);
    assert.doesNotMatch(boardSection, /rgba\(/);
});

test("TaskBoard 卡片：.card-title / .card-num / .card-tag / .card-owner（头像走 .avatar.sm）", async () => {
    const mod = await jiti.import("./ChannelView.tsx");
    const html = renderI18n(
        React.createElement(mod.TaskBoard, {
            tasks: [
                task({
                    status: "in_progress",
                    owner_id: "agent-1",
                    owner: AGENT,
                    reachable: [],
                }),
            ],
            currentMemberId: "owner",
            busy: false,
            onAction: () => undefined,
            onOpenThread: () => undefined,
            onInvalidDrop: () => undefined,
        }),
    );

    assert.match(html, /class="card"/);
    assert.match(html, /class="card-title"/);
    assert.match(html, /hello world/);
    assert.match(html, /class="card-meta"/);
    assert.match(html, /class="card-num"/);
    assert.match(html, />#1</);
    // owner 行：名称 + `.avatar.sm`（22px 由 .avatar.sm → --avatar-sm 决定；markup 不带内联尺寸）
    assert.match(html, /class="card-owner"/);
    assert.match(html, />Nova</);
    assert.match(html, /class="avatar sm av-\d"/);
    // owner 行不带内联尺寸/颜色：22px 由 `.avatar.sm` → `--avatar-sm` 决定。
    assert.match(html, /<span class="card-owner">\s*<span class="avatar sm av-\d" role="img"/);
});

test("TaskBoard 未认领卡片：出 tasks.unassigned 文案、不出头像", async () => {
    const mod = await jiti.import("./ChannelView.tsx");
    const html = renderI18n(
        React.createElement(mod.TaskBoard, {
            tasks: [task()],
            currentMemberId: "owner",
            busy: false,
            onAction: () => undefined,
            onOpenThread: () => undefined,
            onInvalidDrop: () => undefined,
        }),
    );

    assert.match(html, /class="card-owner unassigned"/);
    assert.match(html, />unassigned</);
    assert.doesNotMatch(html, /class="avatar/);
});

test("TaskBoard 重开标记走中性 .card-tag（ED-10：--working 只归 in_review 状态色）", async () => {
    const mod = await jiti.import("./ChannelView.tsx");
    const html = renderI18n(
        React.createElement(mod.TaskBoard, {
            tasks: [task({ status: "todo", reopened: 1 })],
            currentMemberId: "owner",
            busy: false,
            onAction: () => undefined,
            onOpenThread: () => undefined,
            onInvalidDrop: () => undefined,
        }),
    );

    // 重开标记走中性 `.card-tag`（`--panel-2` + `--muted`）：只有 class + title，无内联底色。
    assert.match(
        html,
        /<span class="card-tag" title="[^"]*">REOPENED<\/span>/,
    );
});

test("TaskCard 拖拽中带 .dragging（display-only prop，落点 opacity .4）", async () => {
    const mod = await jiti.import("./ChannelView.tsx");
    assert.equal(typeof mod.TaskCard, "function");

    const props = {
        task: task(),
        currentMemberId: "owner",
        busy: false,
        onAction: () => undefined,
        onOpenThread: () => undefined,
    };
    const idle = renderI18n(React.createElement(mod.TaskCard, props));
    assert.match(idle, /class="card"/);
    assert.doesNotMatch(idle, /class="card dragging"/);

    const dragging = renderI18n(
        React.createElement(mod.TaskCard, { ...props, dragging: true }),
    );
    assert.match(dragging, /class="card dragging"/);
});

test("TaskBoard 空列渲染 .drop-hint（原型形态；新键 tasks.dropHint 两套包都有）", async () => {
    const mod = await jiti.import("./ChannelView.tsx");
    const html = renderI18n(
        React.createElement(mod.TaskBoard, {
            tasks: [task()],
            currentMemberId: "owner",
            busy: false,
            onAction: () => undefined,
            onOpenThread: () => undefined,
            onInvalidDrop: () => undefined,
        }),
    );
    // 5 列里 1 列有卡片 ⇒ 空列 4 个虚线空槽（上游原型：空列渲染“拖拽任务到此”）。
    assert.equal(html.split('class="drop-hint"').length - 1, 4);
    assert.match(html, /class="drop-hint">Drag a task here</);
    // UI 文案走 i18n（docs/i18n.md 分层规则）：zh-CN 包也有这个键。
    const { zhCNLocale } = await import("../lib/i18n/messages/zh-CN.ts");
    assert.equal(zhCNLocale.messages["tasks.dropHint"], "拖拽任务到此");
});

test("TaskViews 工具条：.board-toolbar + .seg 分段控件（选中走 is-active）+ .btn 按钮", async () => {
    const mod = await jiti.import("./ChannelView.tsx");
    const html = renderI18n(
        React.createElement(mod.TaskViews, {
            tasks: [task()],
            currentMemberId: "owner",
            busy: false,
            disabled: false,
            error: null,
            notice: null,
            onCreateTask: () => undefined,
            onAction: () => undefined,
            onOpenThread: () => undefined,
            onNotice: () => undefined,
        }),
    );

    // 票 task-view-scroll：滚动归属靠视图修饰类表达（首帧恒为 list）。
    assert.match(html, /class="board-wrap is-list"/);
    assert.match(html, /class="board-toolbar"/);
    assert.match(html, /class="sep"/);
    assert.match(html, /class="seg"/);
    assert.equal(html.split('class="seg"').length - 1, 1);
    // 首帧恒为列表视图（localStorage 偏好由 useEffect 应用）⇒ 列表键 is-active。
    assert.match(html, /class="is-active"/);
    assert.match(html, /class="btn btn-sm"/);
    assert.match(html, /class="board is-list"/);

    // 旧方向的硬偏移阴影与 rgba 字面量在任务板段退场（ED-4 / ED-10）。
    assert.doesNotMatch(html, /rgba\(/);
    assert.doesNotMatch(boardSectionSource(), /rgba\(/);
});

test("落点裁决仍在视图侧：drag-over / invalid-over 由 reachable 推导（行为零改动）", () => {
    // reachable 是行为（ADR-0002 的服务端裁决投影），视觉票只换它的表达方式：
    // 可达 → .drag-over、不可达 → .invalid-over，裁决表达式本身不动。
    assert.match(channelViewSource, /reachable\.includes\(status\)/);
    assert.match(channelViewSource, /drag-over/);
    assert.match(channelViewSource, /invalid-over/);
    assert.match(channelViewSource, /dragId === task\.id/);
});

// ─── ③ 列表视图的分组折叠（票 task-view-scroll） ─────────────────────────────

/** TaskList 的调用 props：折叠集合默认空（默认全展开）。 */
function taskListProps(overrides = {}) {
    return {
        tasks: [
            task(),
            task({
                id: "task-2",
                number: 2,
                status: "in_progress",
                owner_id: "agent-1",
                owner: AGENT,
                reachable: [],
            }),
        ],
        currentMemberId: "owner",
        busy: false,
        folded: new Set(),
        onToggleGroup: () => undefined,
        onAction: () => undefined,
        onOpenThread: () => undefined,
        ...overrides,
    };
}

test("TaskList 分组头：默认展开（aria-expanded=true）+ 计数；折叠后 aria-expanded=false 且徽标/计数仍在", async () => {
    const mod = await jiti.import("./ChannelView.tsx");
    assert.equal(typeof mod.TaskList, "function");

    const expanded = renderI18n(
        React.createElement(mod.TaskList, taskListProps()),
    );
    // 两个状态分组 ⇒ 两个可点的分组头 + 两个组体
    assert.equal(expanded.split('class="task-group"').length - 1, 2);
    assert.equal(expanded.split('class="task-group-head"').length - 1, 2);
    assert.equal(expanded.split('aria-expanded="true"').length - 1, 2);
    assert.doesNotMatch(expanded, /aria-expanded="false"/);
    // 默认展开 ⇒ 组体不带 hidden
    assert.doesNotMatch(expanded, /class="task-group-body"[^>]*hidden/);
    // 计数渲染出来（两个分组各 1 个任务）
    assert.equal(expanded.split('class="task-group-count">1<').length - 1, 2);
    // 无障碍名走 i18n（文案随展开态切换）
    assert.match(expanded, /aria-label="Collapse the Pool group \(1 tasks\)"/);

    const collapsed = renderI18n(
        React.createElement(
            mod.TaskList,
            taskListProps({ folded: new Set(["todo"]) }),
        ),
    );
    // 只有被折叠的那组翻面
    assert.match(collapsed, /aria-expanded="false"/);
    assert.equal(collapsed.split('aria-expanded="true"').length - 1, 1);
    assert.equal(collapsed.split('aria-expanded="false"').length - 1, 1);
    // 折叠态：状态徽标与计数仍在（折起来不丢计数）
    assert.match(collapsed, /class="task-group-count">1</);
    assert.match(collapsed, /aria-label="Expand the Pool group \(1 tasks\)"/);
    // 组体在 DOM 里但收起（aria-controls 指向的元素始终存在）
    assert.match(
        collapsed,
        /<div class="task-group-body" id="task-group-todo" hidden="">/,
    );
    assert.match(collapsed, /<div class="task-group-body" id="task-group-in_progress">/);
    // 折叠用 lucide 图标，不引入装饰字符
    assert.doesNotMatch(expanded, /[▼▶]/);
    assert.doesNotMatch(collapsed, /[▼▶]/);
});

test("TaskViews：折叠是交互态（setFolded 派生），TaskList 是这层交互的纯视图", async () => {
    const mod = await jiti.import("./ChannelView.tsx");
    const html = renderI18n(
        React.createElement(mod.TaskViews, {
            tasks: [task()],
            currentMemberId: "owner",
            busy: false,
            disabled: false,
            error: null,
            notice: null,
            onCreateTask: () => undefined,
            onAction: () => undefined,
            onOpenThread: () => undefined,
            onNotice: () => undefined,
        }),
    );
    // 首帧（服务端与客户端一致）全展开 ⇒ 分组头带 aria-expanded=true
    assert.match(html, /class="task-group-head"/);
    assert.match(html, /aria-expanded="true"/);

    // 折叠态由 TaskViews 的 useState 持有（切视图不丢折叠），TaskList 只渲染给定集合。
    // 静态渲染断不出「点一下」——这三条是源码级证据，与上面的渲染证据合并读。
    const boardSection = boardSectionSource();
    assert.match(boardSection, /useState<ReadonlySet<TaskStatus>>/);
    assert.match(boardSection, /setFolded\(/);
    assert.match(boardSection, /next\.has\(status\)[\s\S]{0,120}next\.delete\(status\)[\s\S]{0,120}next\.add\(status\)/);
    assert.match(boardSection, /folded=\{folded\}/);
    assert.match(boardSection, /onToggleGroup=\{toggleGroup\}/);
    // 折叠不落 localStorage（本票不做持久化，也不与 TASK_VIEW_KEY 分叉出第二份偏好存储）
    assert.doesNotMatch(boardSection, /localStorage\.setItem\(TASK_GROUP/);
});

test("分组折叠的无障碍名两套语言包成对存在（docs/i18n.md 分层规则）", async () => {
    const { enLocale } = await import("../lib/i18n/messages/en.ts");
    const { zhCNLocale } = await import("../lib/i18n/messages/zh-CN.ts");
    assert.equal(
        enLocale.messages["tasks.collapseGroup"],
        "Collapse the {status} group ({count} tasks)",
    );
    assert.equal(
        zhCNLocale.messages["tasks.collapseGroup"],
        "折叠 {status} 分组（{count} 个任务）",
    );
    assert.equal(
        enLocale.messages["tasks.expandGroup"],
        "Expand the {status} group ({count} tasks)",
    );
    assert.equal(
        zhCNLocale.messages["tasks.expandGroup"],
        "展开 {status} 分组（{count} 个任务）",
    );
});
