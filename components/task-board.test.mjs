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

function renderI18n(children) {
    return renderToStaticMarkup(
        React.createElement(I18nProvider, null, children),
    );
}

const TASK_STATUS_COLOR = {
    todo: "var(--faint)",
    in_progress: "var(--accent)",
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

test("任务板骨架：.board-wrap 竖排不溢出；.board 独自滚动；列不拉伸、宽度取自 --board-col-w", () => {
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
    assert.match(cols, /align-items:\s*flex-start/);
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
});

test("任务板拖拽态：.drag-over 走 --accent、.invalid-over 走 --error、拖拽中 opacity .4", () => {
    assert.match(
        blockBody(globalsCss, ".col.drag-over"),
        /border-color:\s*var\(--accent\)/,
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
    const chipOn = blockBody(globalsCss, ".filter-chip.is-on");
    assert.match(chipOn, /border-color:\s*var\(--accent-line\)/);
    assert.match(chipOn, /background:\s*var\(--accent-soft\)/);
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

    assert.match(html, /class="board-wrap"/);
    assert.match(html, /class="board-toolbar"/);
    assert.match(html, /class="sep"/);
    assert.match(html, /class="seg"/);
    assert.equal(html.split('class="seg"').length - 1, 1);
    // 首帧恒为列表视图（localStorage 偏好由 useEffect 应用）⇒ 列表键 is-active。
    assert.match(html, /class="is-active"/);
    assert.match(html, /class="btn btn-sm"/);
    assert.match(html, /class="board"/);

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
