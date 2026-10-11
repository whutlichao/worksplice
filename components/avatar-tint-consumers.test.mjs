import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
    jsx: { runtime: "automatic" },
    tsconfigPaths: true,
});
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");
const { DetailPanel } = await jiti.import("./DetailPanel.tsx");
const { MessageRow, TaskBoard, TaskCard } = await jiti.import("./ChannelView.tsx");
const { CreateChannelModal } = await jiti.import("./CreateChannelModal.tsx");
const { SearchHitRow } = await jiti.import("./SearchView.tsx");
const { ThreadPanel } = await jiti.import("./ThreadPanel.tsx");
const { WorkspaceSidebar } = await jiti.import("./WorkspaceSidebar.tsx");

function render(component) {
    return renderToStaticMarkup(
        React.createElement(I18nProvider, null, component),
    );
}

function avatarTints(html) {
    return [...html.matchAll(/class="avatar(?: (?:sm|lg))? av-([0-4])"/g)].map(
        (match) => Number(match[1]),
    );
}

function normalizeAvatarTint(html) {
    return html.replace(
        /class="avatar((?: (?:sm|lg))?) av-[0-4]"/g,
        'class="avatar$1 av-TINT"',
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
    deleted: 0,
    model_provider: null,
    model_id: null,
    thinking_level: null,
    avatar_tint: null,
    created_at: "2026-08-03T00:00:00.000Z",
};

const AGENT = {
    ...OWNER,
    id: "agent-1",
    type: "agent",
    name: "Nova",
    role: "member",
    status: "working",
    avatar_tint: null,
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

function message(id, seq, author = AGENT) {
    return {
        id,
        target_id: id === "anchor" ? CHANNEL.id : "anchor",
        seq,
        author_id: author.id,
        content: "same message body",
        created_at: "2026-08-03T08:00:00.000Z",
        author,
    };
}

const ANCHOR = message("anchor", 1);
const TASK = {
    id: "task-1",
    message_id: ANCHOR.id,
    number: 1,
    status: "in_progress",
    owner_id: AGENT.id,
    reopened: 0,
    updated_at: "2026-08-03T08:00:00.000Z",
    channelId: CHANNEL.id,
    anchor: ANCHOR,
    owner: AGENT,
    reachable: [],
    unreadReplyCount: 0,
    latestUnreadReplyAt: null,
};

function renderSidebar(agents) {
    return render(
        React.createElement(WorkspaceSidebar, {
            channels: [],
            agents,
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
}

function renderAgentDetail(agent) {
    return render(
        React.createElement(DetailPanel, {
            content: { kind: "agent", id: agent.id },
            channel: CHANNEL,
            agents: [agent],
            owner: OWNER,
            currentMemberId: OWNER.id,
            onClose: () => undefined,
            onChanged: () => undefined,
            onOpenPanel: () => undefined,
            onOpenDM: () => undefined,
        }),
    );
}

function renderMessage(author, currentAuthor = author) {
    return render(
        React.createElement(MessageRow, {
            message: message("message", 2, author),
            currentAuthor,
            onQuote: () => undefined,
            onCopyLink: () => undefined,
        }),
    );
}

function renderThread(currentAgent) {
    return render(
        React.createElement(ThreadPanel, {
            anchorId: ANCHOR.id,
            channel: CHANNEL,
            currentMemberId: OWNER.id,
            agents: [currentAgent],
            owner: OWNER,
            onOpenPanel: () => undefined,
            onClose: () => undefined,
            initialAnchor: ANCHOR,
            initialMessages: [message("thread-old", 1), message("thread-new", 2)],
        }),
    );
}

function renderTaskCard(currentAgent) {
    return render(
        React.createElement(TaskCard, {
            task: TASK,
            currentMembersById: new Map([
                [currentAgent.id, currentAgent],
                [OWNER.id, OWNER],
            ]),
            currentMemberId: OWNER.id,
            busy: false,
            onAction: () => undefined,
            onOpenThread: () => undefined,
        }),
    );
}

function renderSearchHit(currentAgent) {
    return render(
        React.createElement(SearchHitRow, {
            hit: {
                ...message("search-hit", 3),
                snippet: "same message body",
                channel: CHANNEL,
                inThread: false,
            },
            currentAuthor: currentAgent,
            onOpen: () => undefined,
        }),
    );
}

function renderMemberPicker(agents) {
    return render(
        React.createElement(CreateChannelModal, {
            agents,
            onClose: () => undefined,
            onCreated: () => undefined,
        }),
    );
}

function renderTaskBoard(currentAgent) {
    return render(
        React.createElement(TaskBoard, {
            tasks: [TASK],
            currentMembersById: new Map([
                [currentAgent.id, currentAgent],
                [OWNER.id, OWNER],
            ]),
            currentMemberId: OWNER.id,
            busy: false,
            onAction: () => undefined,
            onOpenThread: () => undefined,
            onInvalidDrop: () => undefined,
        }),
    );
}

function renderAllAgentSurfaces(agent) {
  return {
        sidebar: renderSidebar([agent]),
        detail: renderAgentDetail(agent),
        channelMessage: renderMessage(AGENT, agent),
        thread: renderThread(agent),
        taskOwner: renderTaskCard(agent),
        memberPicker: renderMemberPicker([agent]),
        searchAuthor: renderSearchHit(agent),
        taskBoard: renderTaskBoard(agent),
  };
}

function assertAgentIdentitySurfacesUseTint(agent, expectedTint) {
    const rendered = renderAllAgentSurfaces(agent);
    const expectedBySurface = {
        sidebar: [expectedTint],
        detail: [expectedTint],
        channelMessage: [expectedTint],
        thread: [expectedTint, expectedTint, expectedTint],
        taskOwner: [expectedTint],
        memberPicker: [expectedTint],
        searchAuthor: [expectedTint],
    };
    for (const [surface, expected] of Object.entries(expectedBySurface)) {
        assert.deepEqual(avatarTints(rendered[surface]), expected, surface);
    }

    assert.match(rendered.sidebar, /class="presence working" style="background:var\(--working\)"/);
    assert.match(rendered.channelMessage, /class="msg-author is-agent">Nova<\/span>/);
    assert.match(rendered.channelMessage, /same message body/);
    assert.match(rendered.taskBoard, /class="st-dot" style="background:var\(--accent-graphic\)"/);
}

test("all agent identity markup uses the current tint or the existing ID-based automatic tint", () => {
    assertAgentIdentitySurfacesUseTint(AGENT, 0);
    assertAgentIdentitySurfacesUseTint({ ...AGENT, avatar_tint: 3 }, 3);
});

test("a refreshed MemberRow recolors historical and new channel/thread messages without changing their text", () => {
    const refreshed = { ...AGENT, avatar_tint: 2 };
    const staleMessage = renderMessage({ ...AGENT, avatar_tint: null }, refreshed);
    const staleThread = renderThread(refreshed);

    assert.deepEqual(avatarTints(staleMessage), [2]);
    assert.match(staleMessage, /class="msg-author is-agent">Nova<\/span>/);
    assert.match(staleMessage, /same message body/);
    assert.deepEqual(avatarTints(staleThread), [2, 2, 2]);
    assert.equal(
        normalizeAvatarTint(staleThread).match(/same message body/g)?.length,
        3,
        "existing thread messages remain visible and unchanged",
    );
});

test("human profile and message avatars remain neutral av-4, and agents may share a tint", () => {
    const humanProfile = render(
        React.createElement(DetailPanel, {
            content: { kind: "human", id: OWNER.id },
            channel: CHANNEL,
            agents: [AGENT],
            owner: OWNER,
            currentMemberId: OWNER.id,
            onClose: () => undefined,
            onChanged: () => undefined,
            onOpenPanel: () => undefined,
            onOpenDM: () => undefined,
        }),
    );
    const humanMessage = renderMessage(OWNER);
    assert.deepEqual(avatarTints(humanProfile), [4]);
    assert.deepEqual(avatarTints(humanMessage), [4]);

    const sharedTint = renderSidebar([
        { ...AGENT, id: "agent-a", avatar_tint: 1 },
        { ...AGENT, id: "agent-b", avatar_tint: 1 },
    ]);
    assert.deepEqual(avatarTints(sharedTint), [1, 1]);
});

test("changing tint alters only identity avatar markup, not task or presence semantics", () => {
    const automatic = renderAllAgentSurfaces(AGENT);
    const explicit = renderAllAgentSurfaces({ ...AGENT, avatar_tint: 1 });

    for (const surface of ["sidebar", "channelMessage", "thread", "taskOwner", "memberPicker", "searchAuthor"]) {
        assert.equal(
            normalizeAvatarTint(automatic[surface]),
            normalizeAvatarTint(explicit[surface]),
            `${surface} should differ only in its avatar tint`,
        );
    }
    assert.equal(
        automatic.taskBoard.match(/<span class="st-dot"[^>]*><\/span>/)?.[0],
        explicit.taskBoard.match(/<span class="st-dot"[^>]*><\/span>/)?.[0],
    );
    assert.equal(
        automatic.sidebar.match(/class="presence working"[^>]*/)?.[0],
        explicit.sidebar.match(/class="presence working"[^>]*/)?.[0],
    );
    assert.equal(
        automatic.detail.match(/class="presence working"[^>]*/)?.[0],
        explicit.detail.match(/class="presence working"[^>]*/)?.[0],
    );
    assert.match(explicit.detail, /class="dock-name"[^>]*>.*?Nova/s);
});
