import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
    jsx: { runtime: "automatic" },
    tsconfigPaths: true,
});
const {
    AgentDetailPanel,
    TaskHistoryList,
    RoundLogsList,
    RuntimeProbeFeedback,
} = await jiti.import("./AgentDetailPanel.tsx");
const { ModelPicker } = await jiti.import("./ModelPicker.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function renderWith(component) {
    return renderToStaticMarkup(
        React.createElement(I18nProvider, null, component),
    );
}

function renderPanel(agent, overrides = {}) {
    return renderWith(
        React.createElement(AgentDetailPanel, {
            agent,
            onClose: () => undefined,
            onChanged: () => undefined,
            onOpenDM: () => undefined,
            ...overrides,
        }),
    );
}

const AGENT = {
    id: "agent-1",
    type: "agent",
    name: "bob",
    description: "the helper",
    role: "member",
    workspace_path: "/tmp/ws/bob",
    pi_session_file: "/tmp/ws/bob/123_session.jsonl",
    status: "offline",
    deleted: 0,
    model_provider: null,
    model_id: null,
    thinking_level: null,
    created_at: "2026-08-03T00:00:00.000Z",
};

test("AgentDetailPanel renders identity, status, workspace, reset and observability sections", () => {
    const html = renderPanel(AGENT);

    assert.match(html, /bob/);
    assert.match(html, /the helper/);
    assert.match(html, /Member/);
    assert.match(html, /Offline/);
    assert.match(html, /\/tmp\/ws\/bob/);
    assert.match(html, /Restart/);
    assert.match(html, /Session reset/);
    assert.match(html, /Full reset/);
    assert.match(html, /Delete identity/);
    assert.match(html, /Tokens \/ cost/);
    assert.match(html, /Task history/);
    assert.match(html, /Session export/);
});

test("runtime section renders the model picker and apply button", () => {
    const html = renderPanel(AGENT);
    // ModelPicker 默认显示"继承全局默认"（Inherit global default）
    assert.match(html, /Inherit global default/);
    assert.match(html, /pi default/);
    assert.match(html, /Apply/);
    // 初始无覆盖时 Apply 处于 disabled 状态（避免无意义空保存）
    assert.match(html, /disabled/);
});

test("lifecycle buttons are enabled for ticket 05 (no longer placeholders)", () => {
    const html = renderPanel(AGENT);
    // reset 按钮（Restart/Session reset/Full reset/Delete）不带 disabled
    assert.match(html, /Restart/);
    assert.doesNotMatch(html, /restarting/i);
    // 删除身份按钮存在
    assert.match(html, /Delete identity/);
});

test("an unbound agent shows the not-bound label and workspace hint", () => {
    const html = renderPanel({
        ...AGENT,
        workspace_path: null,
        pi_session_file: null,
    });
    assert.match(html, /Not bound yet/);
    assert.match(html, /Bind a workspace first/);
});

test("a working agent shows the working status label", () => {
    const html = renderPanel({ ...AGENT, status: "working" });
    assert.match(html, /Working/);
    // 票 04：脉冲形态由内联 `ws-status-pulse` 迁到 `.presence.working` class（形态在 class，
    // 语义 token 仍在 markup）；断言按同一意图改写法，护栏（working 态可辨识）不变。
    assert.match(html, /presence working/);
    assert.match(html, /var\(--working\)/);
});

test("ModelPicker groups models by provider and shows the current model", () => {
    const html = renderWith(
        React.createElement(ModelPicker, {
            models: {
                models: { "zenmux:claude-sonnet-4-6": "Claude Sonnet 4.6" },
                modelList: [
                    {
                        id: "claude-sonnet-4-6",
                        name: "Claude Sonnet 4.6",
                        provider: "zenmux",
                    },
                    { id: "gpt-5", name: "GPT-5", provider: "openai" },
                ],
                defaultModel: null,
                thinkingLevels: {},
                thinkingLevelMaps: {},
                thinkingLevelPins: {},
            },
            model: { provider: "zenmux", modelId: "claude-sonnet-4-6" },
            thinkingLevel: "high",
            onModelChange: () => undefined,
            onThinkingChange: () => undefined,
        }),
    );
    assert.match(html, /Claude Sonnet 4.6/);
    assert.match(html, /zenmux/);
    assert.match(html, /openai/);
    assert.match(html, /High reasoning/);
});

test("ModelPicker with no model shows inherit-global placeholder", () => {
    const html = renderWith(
        React.createElement(ModelPicker, {
            models: null,
            model: null,
            thinkingLevel: null,
        }),
    );
    assert.match(html, /Inherit global default/);
    assert.match(html, /pi default/);
});

test("DM button shows Send message when the DM has no messages", () => {
    const html = renderPanel(AGENT, { hasMessages: false });
    assert.match(html, /Send message/);
    assert.doesNotMatch(html, /Open DM/);
});

test("DM button shows Open DM when the DM has messages", () => {
    const html = renderPanel(AGENT, { hasMessages: true });
    assert.match(html, /Open DM/);
    assert.doesNotMatch(html, /Send message/);
});

test("DM button click wires onOpenDM(agent.id)", async () => {
    const source = await readFile(
        new URL("../components/AgentDetailPanel.tsx", import.meta.url),
        "utf-8",
    );
    assert.match(source, /onOpenDM\(agent\.id\)/);
    assert.match(source, /MessageSquare/);
});

/**
 * 同一 agent 在**两个 channel** 各有一个 #1 任务：listAgentTasks 聚合跨 channel 的
 * 任务，而 number 是 channel 内序号（§3.7），所以 obs.tasks 里会有两条 number 相同
 * 的不同任务。这正是浏览器报 “Encountered two children with the same key, `1`” 的输入形态。
 * （参与支线——认领 owner / 锚点作者 / thread 进展者——在 panel 这一层不可见，只体现在
 *  “哪几条任务进了列表”，故用 owner 有/无两态代表；真实形态另见 Answer 里的 live 数据实证。）
 */
const CROSS_CHANNEL_SAME_NUMBER_TASKS = [
    {
        number: 1,
        status: "in_progress",
        owner: { name: "bob" },
        channelId: "chan-a",
        anchor: { id: "anchor-a", content: "fix the duplicate key" },
        progressCount: 0,
    },
    {
        number: 1,
        status: "todo",
        owner: null,
        channelId: "chan-b",
        anchor: { id: "anchor-b", content: "write the regression test" },
        progressCount: 2,
    },
];

/**
 * React 的重复 key 报警只发生在 client 渲染器（react-dom-client）里：SSR 会静默丢弃
 * key，仓库也没有 jsdom。所以这里直接取组件真实返回的元素树，逐个父节点检查**同一父下
 * 已给出的 key 互异**——正是 React 报警的那条不变式。
 * （静态写死的 children 本来就没有 key，React 也不要求，所以只查重复、不查缺失；
 *  TaskHistoryList 不用 hook，可安全地当普通函数调用。）
 */
function assertUniqueSiblingKeys(node, path = "TaskHistoryList") {
    const children = Array.isArray(node) ? node : [node];
    const elements = children.filter((child) => React.isValidElement(child));
    const keys = elements
        .map((el) => el.key)
        .filter((key) => key !== null && key !== undefined);
    const seen = new Set();
    const duplicates = keys.filter((key) => {
        if (seen.has(key)) return true;
        seen.add(key);
        return false;
    });
    assert.deepEqual(
        duplicates,
        [],
        `duplicate sibling keys under ${path}: ${JSON.stringify(duplicates)}`,
    );
    for (const element of elements) {
        assertUniqueSiblingKeys(element.props?.children, `${path}>${element.key}`);
    }
}

test("task history rows get unique keys when two channels each hold task #1", () => {
    const tree = TaskHistoryList({
        tasks: CROSS_CHANNEL_SAME_NUMBER_TASKS,
        t: (key) => key,
    });
    assertUniqueSiblingKeys(tree);
});

// ── §3.10 runtime 保存后的探测结论（票据 02）─────────────────────────────
// 判定层由服务端裁决；面板只负责把结论渲染到既有消息槽（复用同一组件，测试渲染产品自己的 markup）。

function renderProbeFeedback(probe) {
    return renderWith(React.createElement(RuntimeProbeFeedback, { probe }));
}

test("runtime probe feedback renders the verified verdict copy", () => {
    const html = renderProbeFeedback({ attempted: true, ok: true, latencyMs: 12 });
    assert.match(html, /connection verified/i);
    assert.doesNotMatch(html, /probe failed/i);
});

test("runtime probe feedback renders the failure copy with the reason", () => {
    const html = renderProbeFeedback({
        attempted: true,
        ok: false,
        error: "402 insufficient quota",
    });
    assert.match(html, /probe failed/i);
    assert.match(html, /402 insufficient quota/);
});

test("runtime probe feedback marks a superseded verdict instead of claiming a status change", () => {
    const html = renderProbeFeedback({ attempted: true, ok: true, superseded: true });
    assert.match(html, /superseded/i);
    assert.doesNotMatch(html, /connection verified/i);
});

test("runtime probe feedback renders nothing when the save did not probe", () => {
    assert.equal(renderProbeFeedback({ attempted: false }), "");
});

test("panel markup without a probe verdict stays as before", () => {
    const html = renderPanel(AGENT);
    assert.doesNotMatch(html, /connection verified/i);
    assert.doesNotMatch(html, /probe failed/i);
    assert.doesNotMatch(html, /superseded/i);
});

test("probe verdict copy exists in both language packs", async () => {
    const { enLocale } = await import("../lib/i18n/messages/en.ts");
    const { zhCNLocale } = await import("../lib/i18n/messages/zh-CN.ts");
    for (const key of [
        "runtime.probeOk",
        "runtime.probeFailed",
        "runtime.probeSuperseded",
    ]) {
        assert.ok(enLocale.messages[key], `en missing ${key}`);
        assert.ok(zhCNLocale.messages[key], `zh-CN missing ${key}`);
    }
});

test("task history renders both same-number tasks from different channels", () => {
    const html = renderWith(
        React.createElement(TaskHistoryList, {
            tasks: CROSS_CHANNEL_SAME_NUMBER_TASKS,
            t: (key) => key,
        }),
    );
    // 两行都在，且各自的 #1 / 摘要 / 状态都是自己的
    assert.match(html, /fix the duplicate key/);
    assert.match(html, /write the regression test/);
    assert.match(html, /task\.status\.in_progress/);
    assert.match(html, /task\.status\.todo/);
});

/**
 * D2：服务层曾把数据层的 snake_case 轮次行直接透传（target_id / base_seq / created_at），
 * 而面板读的是 camelCase（targetId / baseSeq / createdAt）——三个字段全 undefined，
 * 渲染出空白 target、光秃秃的 `#` 与 "Invalid Date"（formatTime 的 try/catch 拦不住：
 * new Date(undefined).toLocaleString() 不抛错，直接返回 "Invalid Date" 字符串）。
 * 这里按 TaskHistoryList 先例渲染真实 markup 断言：可观察证据落在产品真正渲染出的东西上。
 */
const ROUNDS = [
  {
    id: "round-1",
    targetId: "chan-alpha",
    status: "error",
    reason: 'model error: 429: {"message":"Rate limit exceeded. Please try again later."}',
    baseSeq: 12,
    createdAt: "2026-10-01T03:38:05.447Z",
  },
  {
    id: "round-2",
    targetId: "chan-beta",
    status: "replied",
    reason: "",
    baseSeq: 7,
    createdAt: "not-a-date",
  },
];

test("round log rows render the real reason, target, baseSeq and a readable time (D2)", () => {
  const html = renderWith(
    React.createElement(RoundLogsList, { rounds: ROUNDS, t: (key) => key }),
  );

  // 真实失败原因（D1 的产物）在面板里可见，不被截断
  assert.match(html, /Rate limit exceeded\. Please try again later\./);
  // target / #baseSeq 都渲染出真值，而不是空白与光秃秃的 `#`
  assert.match(html, /chan-alpha/);
  assert.match(html, /#12/);
  assert.match(html, /chan-beta/);
  assert.match(html, /#7/);
  // 时间可读：合法 ISO → 本地化时间（含年份），不是 "Invalid Date"
  assert.match(html, /2026/);
  assert.doesNotMatch(html, /Invalid Date/);
  assert.doesNotMatch(html, /undefined/);
});

test("formatTime falls back readably for an unparseable date instead of Invalid Date (D2)", () => {
  const html = renderWith(
    React.createElement(RoundLogsList, {
      rounds: [
        {
          id: "round-bad-time",
          targetId: "chan-alpha",
          status: "error",
          reason: "boom",
          baseSeq: 1,
          createdAt: "not-a-date",
        },
      ],
      t: (key) => key,
    }),
  );
  assert.doesNotMatch(html, /Invalid Date/);
  assert.match(html, /#1 · —/, "非法日期回落到可读的占位符");
});
