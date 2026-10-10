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
const {
    MessageRow,
    TaskCreationEventRow,
    createTaskCreationAnnouncementTracker,
    Composer,
    ChannelView,
} = await jiti.import("./ChannelView.tsx");
const { mergeIncomingMessages } = await jiti.import(
    "../hooks/useChannelData.ts",
);
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

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

const MESSAGE = {
    id: "msg-1",
    target_id: "#all",
    seq: 4,
    author_id: "owner",
    content: "hello **world**",
    created_at: "2026-08-03T08:00:00.000Z",
    author: OWNER,
};

test("MessageRow renders author, seq, content and the three §3.2 actions", () => {
    const html = renderI18n(
        React.createElement(MessageRow, {
            message: MESSAGE,
            onReply: () => undefined,
            onQuote: () => undefined,
            onCopyLink: () => undefined,
        }),
    );

    assert.match(html, /Owner/);
    assert.match(html, /#4/);
    assert.match(html, /hello <strong>world<\/strong>/);
    assert.match(html, /title="Reply in thread"/);
    assert.match(html, /title="Quote"/);
    assert.match(html, /title="Copy link"/);
    // §5.6 UI 入口：未提供 onSetReminder 时不渲染提醒按钮
    assert.doesNotMatch(html, /Set a reminder on this message/);
});

// spec D2：收窄靠「不传 prop ⇒ 键根本不存在」，不是「传空函数让按钮不做事」——
// 线程面板不再传 onReply，动作栏里不该有这个键（真按钮只在频道面渲染）。
test("MessageRow omits the reply action when onReply is absent", () => {
    const html = renderI18n(
        React.createElement(MessageRow, {
            message: MESSAGE,
            onQuote: () => undefined,
            onCopyLink: () => undefined,
        }),
    );

    assert.doesNotMatch(html, /title="Reply in thread"/);
    // 收窄是逐 prop 的：Quote / Copy link 不受影响，仍在
    assert.match(html, /title="Quote"/);
    assert.match(html, /title="Copy link"/);
});

// spec D3：Pin 是频道面专属动作，pinned 布尔本身不渲染任何东西——
// 断言落在无障碍名上（Pin to channel / Unpin），不落在 Pin 图标的 class 上。
test("MessageRow omits the pin action when onTogglePin is absent, even when pinned", () => {
    const html = renderI18n(
        React.createElement(MessageRow, {
            message: MESSAGE,
            onReply: () => undefined,
            onQuote: () => undefined,
            onCopyLink: () => undefined,
            pinned: true,
        }),
    );

    assert.doesNotMatch(html, /title="Unpin"/);
    assert.doesNotMatch(html, /title="Pin to channel"/);
});

// 动作栏「转为任务」键（§3.7 创建途径）：与右键项同权，仅频道调用点传 convertInActionBar 才渲染。
// 断言落在无障碍名上（title = t("tasks.convert")，与右键菜单项逐字同名），并数次数防重复入口。
test("MessageRow renders the convert-to-task action bar key on the channel surface", () => {
    const html = renderI18n(
        React.createElement(MessageRow, {
            message: MESSAGE,
            onQuote: () => undefined,
            onCopyLink: () => undefined,
            canConvertToTask: true,
            onConvertToTask: () => undefined,
            convertInActionBar: true,
        }),
    );

    assert.equal(html.split('title="Convert to task"').length - 1, 1);
});

// 已是任务 ⇒ 键不渲染（与右键项同一门槛 canConvertToTask）。
test("MessageRow omits the convert-to-task action bar key when the message is already a task", () => {
    const html = renderI18n(
        React.createElement(MessageRow, {
            message: MESSAGE,
            onQuote: () => undefined,
            onCopyLink: () => undefined,
            canConvertToTask: false,
            onConvertToTask: () => undefined,
            convertInActionBar: true,
        }),
    );

    assert.equal(html.split('title="Convert to task"').length - 1, 0);
});

// 无 handler ⇒ 键不渲染（动作栏既有形制：传了 handler prop 才渲染）。
test("MessageRow omits the convert-to-task action bar key when onConvertToTask is absent", () => {
    const html = renderI18n(
        React.createElement(MessageRow, {
            message: MESSAGE,
            onQuote: () => undefined,
            onCopyLink: () => undefined,
            canConvertToTask: true,
            convertInActionBar: true,
        }),
    );

    assert.equal(html.split('title="Convert to task"').length - 1, 0);
});

// 线程锚点形制：canConvertToTask + onConvertToTask 都在（右键项仍可弹），但不传 convertInActionBar
// ⇒ 键根本不存在（#88 门控形制：不传 prop，而不是传空函数）。
test("MessageRow keeps the convert-to-task key out of the action bar without convertInActionBar", () => {
    const html = renderI18n(
        React.createElement(MessageRow, {
            message: MESSAGE,
            onQuote: () => undefined,
            onCopyLink: () => undefined,
            canConvertToTask: true,
            onConvertToTask: () => undefined,
        }),
    );

    assert.equal(html.split('title="Convert to task"').length - 1, 0);
});

// 接线守卫（code-review Standards 轴发现 2）：上面四条正例都落在 MessageRow seam，
// 频道调用点少传 convertInActionBar / onConvertToTask 字面量时它们会全绿而产品面静默失效。
// 本仓既有源码扫描惯用形（见「票瘦身」用例）锁住频道列表这一处接线。
test("ChannelView wires convertInActionBar and onConvertToTask into the channel message list", async () => {
    const source = await readFile(
        new URL("../components/ChannelView.tsx", import.meta.url),
        "utf-8",
    );
    const start = source.indexOf("<MessageRow");
    const end = source.indexOf("/>", start);
    assert.ok(
        start !== -1 && end > start,
        "ChannelView 应当渲染一处 MessageRow（频道消息列表）",
    );
    const channelCall = source.slice(start, end);
    assert.match(channelCall, /convertInActionBar/);
    assert.match(channelCall, /onConvertToTask=\{handleConvertToTask\}/);
    assert.match(
        channelCall,
        /canConvertToTask=\{!taskIndexes\.byMessageId\.has\(m\.id\)\}/,
    );
});

test("MessageRow renders the ⏰ reminder action when onSetReminder is provided (§5.6)", () => {
    const calls = { reminder: null };
    const html = renderI18n(
        React.createElement(MessageRow, {
            message: MESSAGE,
            onReply: () => undefined,
            onQuote: () => undefined,
            onCopyLink: () => undefined,
            onSetReminder: (m) => {
                calls.reminder = m;
            },
        }),
    );
    assert.match(html, /Set a reminder on this message/);
    assert.deepEqual(calls, { reminder: null });
});

test("MessageRow action handlers fire with the message", () => {
    const calls = { reply: null, quote: null, link: null };
    const html = renderI18n(
        React.createElement(MessageRow, {
            message: MESSAGE,
            onReply: (m) => {
                calls.reply = m;
            },
            onQuote: (m) => {
                calls.quote = m;
            },
            onCopyLink: (m) => {
                calls.link = m;
            },
        }),
    );
    assert.ok(html);
    assert.deepEqual(calls, { reply: null, quote: null, link: null });
});

test("Composer shows the quoting chip with the quoted message preview", () => {
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

    assert.match(html, /#4/);
    assert.match(html, /Owner/);
    assert.match(html, /hello \*\*world\*\*/);
    assert.match(html, /aria-label="Clear quote"/);
});

test("Composer renders without a quote chip when nothing is quoted", () => {
    const html = renderI18n(
        React.createElement(Composer, {
            targetId: "#all",
            disabled: false,
            disabledHint: "",
            quoting: null,
            onClearQuote: () => undefined,
            onSend: async () => undefined,
        }),
    );

    assert.doesNotMatch(html, /Clear quote/);
    assert.match(html, /textarea/);
    assert.match(html, /Send/);
});

test("Composer surfaces the disabled hint when the channel is archived or not joined", () => {
    const html = renderI18n(
        React.createElement(Composer, {
            targetId: "#all",
            disabled: true,
            disabledHint: "This channel is archived and is read-only",
            quoting: null,
            onClearQuote: () => undefined,
            onSend: async () => undefined,
        }),
    );

    assert.match(html, /This channel is archived and is read-only/);
});

test("ChannelView renders the select-a-channel empty state without a channel", () => {
    const html = renderI18n(
        React.createElement(ChannelView, {
            channel: null,
            tab: "messages",
            onTabChange: () => undefined,
            currentMemberId: "owner",
            onChannelChanged: () => undefined,
            focusMessageId: null,
        }),
    );

    assert.match(html, /Messages/);
    assert.match(html, /Tasks/);
});

test("ChannelView shows the channel header with the members entry and archive badge", () => {
    const channel = {
        id: "c1",
        name: "general",
        type: "public",
        description: "chat",
        archived: 1,
        created_at: "2026-08-03T00:00:00.000Z",
        joined: true,
        memberCount: 2,
    };
    const html = renderI18n(
        React.createElement(ChannelView, {
            channel,
            tab: "messages",
            onTabChange: () => undefined,
            currentMemberId: "owner",
            onChannelChanged: () => undefined,
            focusMessageId: null,
        }),
    );

    assert.match(html, /general/);
    assert.match(html, /Archived/);
    // 成员数不再有独立徽标：数量只出现在可展开的成员面板入口按钮（含人类）
    assert.match(html, /Channel members/);
    assert.doesNotMatch(html, /2 members/);
});

test("mergeIncomingMessages dedupes by id and keeps messages sorted by seq (agent-loop 轮询合并)", () => {
    const m = (id, seq, content) => ({
        id,
        target_id: "c1",
        seq,
        author_id: "owner",
        content,
        created_at: "",
        author: null,
    });
    const prev = [m("m1", 1, "one"), m("m2", 3, "three")];
    const incoming = [m("m3", 4, "four"), m("m1", 1, "one")];

    const merged = mergeIncomingMessages(prev, incoming);
    assert.deepEqual(
        merged.map((x) => x.id),
        ["m1", "m2", "m3"],
    );
    assert.deepEqual(
        merged.map((x) => x.content),
        ["one", "three", "four"],
    );
    assert.deepEqual(mergeIncomingMessages(prev, []), prev);
});

test("ChannelView 发送通道：发送与 held 由 useChannelData 持有（02 票）", async () => {
    const source = await readFile(
        new URL("../components/ChannelView.tsx", import.meta.url),
        "utf-8",
    );
    const hookSource = await readFile(
        new URL("../hooks/useChannelData.ts", import.meta.url),
        "utf-8",
    );
    // 视图侧：经 hook 的 send 发送，不再内联 POST /api/messages / baseSeq 组装 / held 分支
    // （任务动作 runTaskAction 的 baseSeq 携带是 04 票范围，本票不动）。
    assert.match(source, /sendMessage\(targetId, content, quoteId, files\)/);
    assert.doesNotMatch(source, /fetch\("\/api\/messages", \{/);
    assert.doesNotMatch(source, /form\.append\("baseSeq"/);
    // hook 侧：send + heldNotice + busyAction + 重拉收敛。
    assert.match(hookSource, /postChannelMessage/);
    assert.match(hookSource, /heldNotice/);
    assert.match(hookSource, /busyAction/);
    assert.match(hookSource, /maxSeqRef/);
});

test("ChannelView 轮询收敛：消息数据循环由 useChannelData 持有（01 票）", async () => {
    const source = await readFile(
        new URL("../components/ChannelView.tsx", import.meta.url),
        "utf-8",
    );
    const hookSource = await readFile(
        new URL("../hooks/useChannelData.ts", import.meta.url),
        "utf-8",
    );
    assert.match(source, /useChannelData\(channel\?\.id/);
    assert.match(source, /loadEarlierPage\(\)/);
    // hook 侧：持有轮询纪律（setInterval + 3s + 后台 tab 暂停 + 卸载清理）与合并。
    assert.match(hookSource, /setInterval/);
    assert.match(hookSource, /CHANNEL_POLL_MS/);
    assert.match(hookSource, /applyPollPage/);
    assert.match(hookSource, /document\.hidden/);
    assert.match(hookSource, /clearInterval/);
});

test("ChannelView pinned 与附属区：pinned/mute/members 数据循环由 useChannelData 持有（03 票）", async () => {
    const source = await readFile(
        new URL("../components/ChannelView.tsx", import.meta.url),
        "utf-8",
    );
    const hookSource = await readFile(
        new URL("../hooks/useChannelData.ts", import.meta.url),
        "utf-8",
    );
    // 视图侧：经 hook 消费 pinnedItems/pinnedSort/mutes/channelMemberIds，不再内联三路 GET
    // （/pinned?sort=、/mute、/members）与 useState 数据持有；pinned 区展开、BelleOff/成员面板排版不动。
    assert.match(source, /pinnedItems,/);
    assert.match(source, /pinnedSort,/);
    assert.match(source, /setPinnedSort/);
    assert.match(source, /channelMemberIds/);
    assert.match(source, /togglePin\(message\.id\)/);
    assert.match(source, /reorderPinned\(index, direction\)/);
    assert.match(source, /toggleMuteInHook\(m\.memberId\)/);
    assert.doesNotMatch(source, /\/pinned\?sort=\$/);
    assert.doesNotMatch(source, /GET pinned/);
    assert.doesNotMatch(source, /GET mutes/);
    assert.doesNotMatch(source, /GET members/);
    assert.doesNotMatch(source, /\/pinned\/reorder/);
    // hook 侧：返回新增 pinnedItems/pinnedSort/setPinnedSort/reorderPinned/mutes/channelMemberIds。
    assert.match(hookSource, /sortPinnedItems/);
    assert.match(hookSource, /loadPinnedPage/);
    assert.match(hookSource, /postPinnedOrder/);
    assert.match(hookSource, /togglePinnedMessage/);
    assert.match(hookSource, /loadMutesPage/);
    assert.match(hookSource, /toggleChannelMute/);
    assert.match(hookSource, /loadChannelMemberIds/);
    assert.match(hookSource, /reorderPinned/);
    assert.match(hookSource, /channelMemberIds/);
});

test("MessageRow renders quick reactions, picker, pin and attachments (§3.4/§3.5)", () => {
    const html = renderI18n(
        React.createElement(MessageRow, {
            message: {
                ...MESSAGE,
                reactions: [
                    { emoji: "👍", count: 2, memberIds: ["owner", "agent-1"] },
                    { emoji: "❤️", count: 1, memberIds: ["agent-1"] },
                ],
                attachments: [
                    {
                        id: "att-1",
                        message_id: "msg-1",
                        file_name: "note.txt",
                        mime: "text/plain",
                        size_bytes: 2048,
                        disk_path: "/tmp/attachments/att-1",
                        created_at: "2026-08-03T08:00:00.000Z",
                    },
                    {
                        id: "att-2",
                        message_id: "msg-1",
                        file_name: "bundle.zip",
                        mime: "application/zip",
                        size_bytes: 4096,
                        disk_path: "/tmp/attachments/att-2",
                        created_at: "2026-08-03T08:00:00.000Z",
                    },
                ],
            },
            currentMemberId: "owner",
            onReply: () => undefined,
            onQuote: () => undefined,
            onCopyLink: () => undefined,
            onToggleReaction: () => undefined,
            onTogglePin: () => undefined,
            pinned: true,
        }),
    );

    assert.match(html, /👍/);
    assert.match(html, /❤️/);
    assert.match(html, /2/);
    // 动作栏默认折叠：只出 SmilePlus 入口；emoji 快捷条与 ＋ 选择器需展开才有
    assert.match(html, /title="Add a reaction"/);
    assert.doesNotMatch(html, /＋/);
    assert.match(html, /title="Unpin"/);
    // text-like 附件 = 展开预览按钮；其余 = 下载链接
    assert.match(html, /note\.txt/);
    assert.match(html, /2\.0 KB/);
    assert.match(html, /lucide-file-text/);
    assert.match(html, /bundle\.zip/);
    assert.match(html, /\/api\/attachments\/att-2/);
});

test("MessageRow hides reaction UI when handlers are absent", () => {
    const html = renderI18n(
        React.createElement(MessageRow, {
            message: MESSAGE,
            onReply: () => undefined,
            onQuote: () => undefined,
            onCopyLink: () => undefined,
        }),
    );
    assert.doesNotMatch(html, /＋/);
    assert.doesNotMatch(html, /📌/);
});

test("MessageRow renders the not-replied badge with agent name in the tooltip (§09)", () => {
    const calls = { member: null };
    const html = renderI18n(
        React.createElement(MessageRow, {
            message: {
                ...MESSAGE,
                abandonedMarks: [
                    {
                        agentId: "agent-1",
                        agentName: "Nova",
                        reason: "retries exhausted",
                        baseSeq: 4,
                        createdAt: "2026-08-12T00:00:00.000Z",
                    },
                ],
            },
            onReply: () => undefined,
            onQuote: () => undefined,
            onCopyLink: () => undefined,
            onOpenMember: (memberId) => {
                calls.member = memberId;
            },
        }),
    );

    assert.match(html, /title="Nova：retries exhausted"/);
    assert.match(html, /No reply/);
    assert.match(html, /lucide-circle-slash/);
});

test("MessageRow renders a count badge when multiple agents abandoned the message", () => {
    const html = renderI18n(
        React.createElement(MessageRow, {
            message: {
                ...MESSAGE,
                abandonedMarks: [
                    {
                        agentId: "agent-1",
                        agentName: "Nova",
                        reason: "r1",
                        baseSeq: 4,
                        createdAt: "2026-08-12T00:00:00.000Z",
                    },
                    {
                        agentId: "agent-2",
                        agentName: "Pulse",
                        reason: "r2",
                        baseSeq: 4,
                        createdAt: "2026-08-12T00:00:00.000Z",
                    },
                ],
            },
            onReply: () => undefined,
            onQuote: () => undefined,
            onCopyLink: () => undefined,
        }),
    );

    assert.match(html, /title="Nova：r1；Pulse：r2"/);
    assert.match(html, /2 agents did not reply/);
});

test("MessageRow does not render the not-replied badge without abandonedMarks", () => {
    const html = renderI18n(
        React.createElement(MessageRow, {
            message: MESSAGE,
            onReply: () => undefined,
            onQuote: () => undefined,
            onCopyLink: () => undefined,
        }),
    );
    assert.doesNotMatch(html, /No reply/);
    assert.doesNotMatch(html, /lucide-circle-slash/);
});

test("Composer renders the paperclip attach control (§3.5)", () => {
    const html = renderI18n(
        React.createElement(Composer, {
            targetId: "#all",
            disabled: false,
            disabledHint: "",
            quoting: null,
            onClearQuote: () => undefined,
            onSend: async () => undefined,
        }),
    );
    assert.match(html, /Attach files \(max 50 MB each\)/);
    assert.match(html, /type="file"/);
});

test("ChannelView header exposes the pinned toggle for joined members (§3.5)", () => {
    const channel = {
        id: "c1",
        name: "general",
        type: "public",
        description: "",
        archived: 0,
        created_at: "2026-08-03T00:00:00.000Z",
        joined: true,
        memberCount: 2,
    };
    const html = renderI18n(
        React.createElement(ChannelView, {
            channel,
            tab: "messages",
            onTabChange: () => undefined,
            currentMemberId: "owner",
            onChannelChanged: () => undefined,
            focusMessageId: null,
        }),
    );
    assert.match(html, /Toggle pinned messages/);
});

test("DM 头部不渲染成员管理/归档/静音入口，保留提醒与 pinned（§03）", () => {
    const channel = {
        id: "dm:owner↔Nova",
        name: "dm:owner↔Nova",
        type: "dm",
        description: "",
        archived: 0,
        created_at: "2026-08-03T00:00:00.000Z",
        joined: true,
        memberCount: 2,
    };
    const html = renderI18n(
        React.createElement(ChannelView, {
            channel,
            tab: "messages",
            onTabChange: () => undefined,
            currentMemberId: "owner",
            onChannelChanged: () => undefined,
            focusMessageId: null,
        }),
    );
    // 不渲染：离开/加入、归档、静音、成员面板（服务层已拒，UI 隐藏双保险）
    assert.doesNotMatch(html, /Leave|Join/);
    assert.doesNotMatch(html, /Archive|Unarchive/);
    assert.doesNotMatch(html, /Mute notifications/);
    assert.doesNotMatch(html, /Channel members/);
    // 复用频道消息体验：提醒 + pinned 入口仍在
    assert.match(html, /Set a channel reminder/);
    assert.match(html, /Toggle pinned messages/);
    // DM 类型徽标（而非 public/private）
    assert.match(html, />DM</);
});

test("TaskViews renders the task board layout without mounting the channel data loop (05 票排版回归)", async () => {
    const mod = await jiti.import("./ChannelView.tsx");
    assert.equal(typeof mod.TaskViews, "function");
    const task = {
        id: "task-1",
        message_id: "msg-1",
        number: 1,
        status: "todo",
        owner_id: null,
        reopened: 0,
        updated_at: "2026-08-03T08:00:00.000Z",
        channelId: "c1",
        anchor: { ...MESSAGE, id: "msg-1", target_id: "c1" },
        owner: null,
        reachable: ["in_progress"],
    };
    const html = renderI18n(
        React.createElement(mod.TaskViews, {
            tasks: [task],
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
    assert.match(html, /#1/);
    assert.match(html, /todo|Claim|认领/);
});

test("05 票瘦身：视图直接解构 hook 原名（无过渡别名解构）", async () => {
    const source = await readFile(
        new URL("../components/ChannelView.tsx", import.meta.url),
        "utf-8",
    );
    assert.doesNotMatch(source, /loadEarlier: loadEarlierPage/);
    assert.doesNotMatch(source, /loadTasks: loadTasksInHook/);
    assert.doesNotMatch(source, /togglePin: togglePinInHook/);
    assert.doesNotMatch(source, /reorderPinned: reorderPinnedInHook/);
    assert.doesNotMatch(source, /convertToTask: convertToTaskInHook/);
    assert.doesNotMatch(source, /createTaskFromBoard: createTaskFromBoard,/);
    // toggleMuteInHook / createTaskFromBoardInHook 别名保留：视图同名回调签名不同，须别名区分。
    assert.match(source, /toggleMuteInHook/);
    assert.match(source, /createTaskFromBoardInHook/);
});

test("05 票瘦身：视图无过渡残留注释（01 过渡已收敛进 hook 语义）", async () => {
    const source = await readFile(
        new URL("../components/ChannelView.tsx", import.meta.url),
        "utf-8",
    );
    assert.doesNotMatch(source, /01 过渡/);
});

test("05 票瘦身：视图不再 re-export hook 已有的数据循环类型（ChannelTask/PinnedItem 直引 hook）", async () => {
    const source = await readFile(
        new URL("../components/ChannelView.tsx", import.meta.url),
        "utf-8",
    );
    assert.doesNotMatch(source, /export type \{ ChannelTask \}/);
    assert.doesNotMatch(source, /export type \{ PinnedItem \}/);
});

test("05 票瘦身：视图不再 re-export hook 已有的数据循环类型（ChannelMessagesPage 直引 hook）", async () => {
    const source = await readFile(
        new URL("../components/ChannelView.tsx", import.meta.url),
        "utf-8",
    );
    assert.doesNotMatch(source, /export type \{ ChannelMessagesPage \}/);
});

test("ChannelView 任务板数据循环由 useChannelData 持有（04 票）", async () => {
    const source = await readFile(
        new URL("../components/ChannelView.tsx", import.meta.url),
        "utf-8",
    );
    const hookSource = await readFile(
        new URL("../hooks/useChannelData.ts", import.meta.url),
        "utf-8",
    );
    // 视图侧：任务板状态经 hook（tasks/tasksError/taskNotice + loadTasks/转移序列，经 runTaskAction 转发），
    // 不再内联三路旧实现（loadTasks GET / claim-update-status fetch / 创建 POST /api/tasks）。
    assert.match(source, /tasks,\n    tasksError,\n    taskNotice,/);
    assert.match(source, /runTaskTransition/);
    assert.match(source, /runTaskAction/);
    assert.doesNotMatch(
        source,
        /fetch\(`\/api\/channels\/\$\{encodeURIComponent\(id\)\}\/tasks`\)/,
    );
    assert.doesNotMatch(source, /fetch\(url, \{\n          method: "POST",/);
    assert.doesNotMatch(source, /fetch\("\/api\/tasks", \{/);
    // hook 侧：任务板数据循环（loadTasksPage + claim/update-status/complete 两步 + 创建两途径 + taskOps 入口）。
    assert.match(hookSource, /loadTasksPage/);
    assert.match(hookSource, /claimChannelTask/);
    assert.match(hookSource, /updateChannelTaskStatus/);
    assert.match(hookSource, /completeTaskWithReply/);
    assert.match(hookSource, /convertMessageToTaskRow/);
    assert.match(hookSource, /createBoardTaskRow/);
    assert.match(hookSource, /taskOps/);
    // TaskViews 视图与拖拽手势不动：TaskList/TaskBoard/拖拽落点校验仍在视图侧。
    assert.match(source, /function TaskList/);
    assert.match(source, /function TaskBoard/);
    assert.match(source, /reachable\.includes\(status\)/);
});

test("ChannelView 三处可见性同一数据源：新成员进 channelMemberIds 后 channelAgents/mentionable/composer 候选全含（#12 回归）", async () => {
    const { composerMentionCandidates } =
        await jiti.import("../lib/mention.ts");
    // 与 ChannelView 内三处 useMemo 同语义的派生（agents + channelMemberIds → 可见性）：
    // channelAgents（成员面板）/ channelMembers（人数）/ mentionable joined（@ 提及）/ composerMembers（补全）。
    const agents = [
        { id: "a-old", name: "Old", status: "online" },
        { id: "a-new", name: "New", status: "offline" },
    ];
    const owner = { id: "owner", name: "Owner", type: "human" };
    // 失效前：stale 快照只含旧成员——新成员三处全不可见（用户精确症状）。
    const stale = new Set(["a-old", "owner"]);
    assert.deepEqual(
        agents.filter((a) => stale.has(a.id)).map((a) => a.id),
        ["a-old"],
    );
    assert.equal(
        composerMentionCandidates(agents, stale).some((a) => a.id === "a-new"),
        false,
    );
    // 失效后：loadMembers 重拉收敛（含新成员）——三处全可见。
    const fresh = new Set(["a-old", "a-new", "owner"]);
    assert.deepEqual(
        agents.filter((a) => fresh.has(a.id)).map((a) => a.id),
        ["a-old", "a-new"],
    );
    const members = agents.filter((a) => fresh.has(a.id));
    const channelMembers =
        owner && fresh.has(owner.id) ? [...members, owner] : members;
    assert.equal(
        channelMembers.some((m) => m.id === "a-new"),
        true,
    );
    const mentionable = agents.map((a) => ({ ...a, joined: fresh.has(a.id) }));
    assert.equal(mentionable.find((a) => a.id === "a-new").joined, true);
    assert.equal(
        composerMentionCandidates(agents, fresh).some((a) => a.id === "a-new"),
        true,
    );
});

test("ChannelView 透传 membersVersion 给 useChannelData（失效链不断，#12 回归）", async () => {
    const source = await readFile(
        new URL("../components/ChannelView.tsx", import.meta.url),
        "utf-8",
    );
    // ChannelView 解构 membersVersion prop 并透传给 hook（AppShell → ChannelView → hook 链的中段）。
    assert.match(source, /membersVersion,/);
    assert.match(source, /membersVersion\?: number/);
    assert.match(source, /useChannelData\(channel\?\.id, t, membersVersion\)/);
});

test("AppShell 创建 agent 后递增 membersVersion（失效链源头，#12 回归）", async () => {
    const source = await readFile(
        new URL("../components/AppShell.tsx", import.meta.url),
        "utf-8",
    );
    // 源头：CreateAgentModal onCreated 内递增；透传给中央 ChannelView。
    assert.match(source, /setMembersVersion\(\(v\) => v \+ 1\)/);
    assert.match(source, /membersVersion=\{membersVersion\}/);
});

test("TaskViews 服务端与客户端首帧渲染一致（localStorage 偏好为 board 也不 mismatch）", async () => {
    const mod = await jiti.import("./ChannelView.tsx");
    const task = {
        id: "task-1",
        message_id: "msg-1",
        number: 1,
        status: "todo",
        owner_id: null,
        reopened: 0,
        updated_at: "2026-08-03T08:00:00.000Z",
        channelId: "c1",
        anchor: { ...MESSAGE, id: "msg-1", target_id: "c1" },
        owner: null,
        reachable: ["in_progress"],
    };
    const props = {
        tasks: [task],
        currentMemberId: "owner",
        busy: false,
        disabled: false,
        error: null,
        notice: null,
        onCreateTask: () => undefined,
        onAction: () => undefined,
        onOpenThread: () => undefined,
        onNotice: () => undefined,
    };
    // 服务端：无 window（renderToStaticMarkup 环境默认无 window）→ 默认 list
    const server = renderI18n(React.createElement(mod.TaskViews, props));
    // 客户端首帧：localStorage 偏好 board —— 首帧仍须与服务端一致（挂载后 useEffect 才应用偏好）
    const store = { "worksplice-task-view": "board" };
    globalThis.window = {
        localStorage: {
            getItem: (k) => store[k] ?? null,
            setItem: (k, v) => {
                store[k] = String(v);
            },
        },
        navigator: { languages: ["en"], language: "en" },
    };
    try {
        const client = renderI18n(React.createElement(mod.TaskViews, props));
        assert.equal(client, server);
    } finally {
        delete globalThis.window;
    }
});

test("DM bugfix：handleSend 发送成功后上抛 onChannelChanged（侧栏 messageCount 信号即时更新，不依赖 15s 轮询/agent 回复）", async () => {
    const source = await readFile(
        new URL("../components/ChannelView.tsx", import.meta.url),
        "utf-8",
    );
    // 只锁定 handleSend 回调体（而非 runChannelAction 等其它 onChannelChanged 调用点）
    const start = source.indexOf("const handleSend = useCallback(");
    assert.ok(start !== -1, "handleSend useCallback should exist");
    const end = source.indexOf(
        "// eslint-disable-next-line react-hooks/exhaustive-deps",
        start,
    );
    assert.ok(
        end !== -1 && end > start,
        "handleSend deps comment should exist",
    );
    const body = source.slice(start, end);
    // 成功路径（sendMessage await 之后）必须通知 shell 刷新频道列表——
    // 否则 DM 懒创建「有消息」信号冻结在 0，侧栏私信分组直到 15s 轮询/agent 回复才出现
    assert.match(body, /await sendMessage\(/);
    assert.match(body, /onChannelChanged\(\)/);
    assert.ok(
        body.indexOf("onChannelChanged()") > body.indexOf("await sendMessage("),
        "onChannelChanged must be called after the send resolves",
    );
});

// ===========================================================================
// notice 可见性（Converted to task / Room changed 被 composer 遮住且要滚动才看得到）
// ===========================================================================

test("notice toast 渲染在滚动流之外：<main>…</main> 里不再有 heldNotice/taskNotice 呈现位", async () => {
    const source = await readFile(
        new URL("../components/ChannelView.tsx", import.meta.url),
        "utf-8",
    );
    const mainStart = source.indexOf("<main");
    const mainEnd = source.indexOf("</main>", mainStart);
    assert.ok(
        mainStart !== -1 && mainEnd > mainStart,
        "ChannelView 应当渲染可滚动消息流 <main>",
    );
    const stream = source.slice(mainStart, mainEnd);
    // 症状本体：notice 曾经挂在流内 .stream-inner 尾部 —— 被下方 composer 遮住、且不滚动看不见。
    assert.doesNotMatch(
        stream,
        /heldNotice && \(|taskNotice && \(/,
        "notice 呈现位必须挪出滚动流（否则被 composer 遮住）",
    );
    // 位置关系（不是 class 字符串）：toast 挂在 </main> 之后的定位壳里。
    assert.match(
        source.slice(mainEnd, mainEnd + 900),
        /<NoticeToast/,
        "NoticeToast 应当挂在 </main> 之后（消息区底部的定位壳里）",
    );
});

test("notice toast 锚在消息区底部、composer 上方居中，且 z-index 高于 composer", async () => {
    const source = await readFile(
        new URL("../components/ChannelView.tsx", import.meta.url),
        "utf-8",
    );
    const start = source.indexOf("export function NoticeToast");
    assert.ok(start !== -1, "ChannelView 应当导出 NoticeToast");
    const end = source.indexOf("\n}\n", start);
    const body = source.slice(start, end);
    assert.match(body, /position: "absolute"/);
    assert.match(body, /bottom: "var\(--sp-/);
    assert.match(body, /left: "50%"/);
    assert.match(body, /transform: "translateX\(-50%\)"/);
    assert.match(
        body,
        /zIndex: "var\(--z-toast\)"/,
        "z-index 必须高于 composer（--z-toast 80）",
    );
});

test("NoticeToast 渲染出无障碍语义与 i18n 文案（role=status / aria-live / data-notice）", async () => {
    const { NoticeToast } = await jiti.import("./ChannelView.tsx");

    assert.equal(
        renderI18n(React.createElement(NoticeToast, { toast: null })),
        "",
        "无 notice 时不渲染任何东西",
    );

    const task = renderI18n(
        React.createElement(NoticeToast, {
            toast: { kind: "task", text: "Converted to task #6" },
        }),
    );
    assert.match(task, /role="status"/);
    assert.match(task, /aria-live="polite"/);
    assert.match(task, /data-notice="task"/);
    assert.match(task, /Converted to task #6/);

    const held = renderI18n(
        React.createElement(NoticeToast, {
            toast: { kind: "held", text: "@alice replied" },
        }),
    );
    assert.match(held, /data-notice="held"/);
    assert.match(held, /Room changed: @alice replied/);
});

test("pickNoticeToast 单槽仲裁：新 notice 顶掉旧的，被顶掉的旧 notice 不回弹", async () => {
    const { pickNoticeToast } = await jiti.import("./ChannelView.tsx");

    assert.equal(pickNoticeToast({ held: null, task: null }, { held: null, task: null }), null);
    assert.deepEqual(
        pickNoticeToast({ held: null, task: null }, { held: null, task: "converted" }),
        { kind: "task", text: "converted" },
    );
    // 新 notice 顶掉旧的：task 在屏时 held 出现 ⇒ held 上屏
    assert.deepEqual(
        pickNoticeToast({ held: null, task: "converted" }, { held: "held!", task: "converted" }),
        { kind: "held", text: "held!" },
    );
    // 旧 notice 不回弹：held 清空后 task 仍是上一轮已消费过的值 ⇒ 不再上屏
    assert.equal(
        pickNoticeToast({ held: "held!", task: "converted" }, { held: null, task: "converted" }),
        null,
    );
});

test("notice toast 自动消退：setTimeout 到点清空，且 useEffect 清理 timer", async () => {
    const source = await readFile(
        new URL("../components/ChannelView.tsx", import.meta.url),
        "utf-8",
    );
    const start = source.indexOf("const timer = setTimeout(");
    assert.ok(start !== -1, "notice toast 应当由 setTimeout 驱动自动消退");
    const end = source.indexOf("}, [toast]);", start);
    assert.ok(end !== -1 && end > start, "应当能定位到该 useEffect 的依赖行");
    const effect = source.slice(start, end);
    assert.match(effect, /setToast\(null\)/);
    assert.match(
        effect,
        /return \(\) => clearTimeout\(timer\)/,
        "timer 必须清理（否则 notice 切换/卸载后回调打到已卸载的组件）",
    );
});

test("任务创建事件以静态 note 呈现，预览 URL 是普通文本而非交互元素", () => {
    const html = renderI18n(
        React.createElement(TaskCreationEventRow, {
            event: { number: 7, preview: "See https://example.test/task" },
        }),
    );

    assert.match(html, /role="note"/);
    assert.match(html, /Task #7 created/);
    assert.match(html, /See https:\/\/example\.test\/task/);
    assert.doesNotMatch(html, /<(?:a|button|input|textarea|select)\b/i);
    assert.doesNotMatch(html, /\b(?:href|tabindex)=/i);
});

test("Task 锚点显示编号和状态，并提供带编号无障碍名称的讨论按钮", () => {
    const html = renderI18n(
        React.createElement(MessageRow, {
            message: MESSAGE,
            task: { number: 7, status: "in_progress" },
            onQuote: () => undefined,
            onCopyLink: () => undefined,
            onOpenThread: () => undefined,
        }),
    );

    assert.match(html, /Task #7/);
    assert.match(html, /In progress/);
    assert.match(
        html,
        /<button[^>]*aria-label="Open task discussion for Task #7"[^>]*>Open task discussion<\/button>/,
    );
});

test("任务创建事件播报跳过初始历史、只播报新事件一次", () => {
    const tracker = createTaskCreationAnnouncementTracker();
    const event = (id, seq, number, preview) => ({
        ...MESSAGE,
        id,
        target_id: "c1",
        seq,
        content: `Task #${number} created — ${preview}`,
    });
    const history = event("event-1", 2, 1, "First task");

    assert.deepEqual(
        tracker.observe("c1", [history], true),
        [],
        "first loaded page is history and must not be announced",
    );
    assert.deepEqual(tracker.observe("c1", [history], true), []);

    const created = event("event-2", 4, 2, "Second task");
    assert.deepEqual(
        tracker.observe("c1", [history, created], true),
        [{ messageId: "event-2", number: 2, preview: "Second task" }],
    );
    assert.deepEqual(
        tracker.observe("c1", [history, created], true),
        [],
        "polling the same event again must not announce it again",
    );
});

test("任务快照未到达时，动态创建事件仍会被识别并播报", () => {
    const tracker = createTaskCreationAnnouncementTracker();
    const history = {
        ...MESSAGE,
        id: "event-history",
        target_id: "c1",
        seq: 2,
        content: "Task #1 created — First task",
    };
    const created = {
        ...MESSAGE,
        id: "event-new",
        target_id: "c1",
        seq: 4,
        content: "Task #2 created — Second task",
    };

    assert.deepEqual(tracker.observe("c1", [history], true), []);
    assert.deepEqual(
        tracker.observe("c1", [history, created], true),
        [{ messageId: "event-new", number: 2, preview: "Second task" }],
    );
});

test("切换频道后，已知频道中新到达的任务事件仍会播报", () => {
    const tracker = createTaskCreationAnnouncementTracker();
    const history = {
        ...MESSAGE,
        id: "event-1",
        target_id: "c1",
        seq: 2,
        content: "Task #1 created — First task",
    };
    const created = {
        ...MESSAGE,
        id: "event-2",
        target_id: "c1",
        seq: 4,
        content: "Task #2 created — Second task",
    };

    assert.deepEqual(tracker.observe("c1", [history], true), []);
    assert.deepEqual(tracker.observe("c2", [], true), []);
    assert.deepEqual(
        tracker.observe("c1", [history, created], true),
        [{ messageId: "event-2", number: 2, preview: "Second task" }],
    );
});
