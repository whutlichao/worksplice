/**
 * 右栏（票 07，spec §3 组件表第 5–7 行）的落盘断言，两半各断在自己的 seam 上：
 *
 * ① **class 块**（`.dock*` / `.d-sec*` / `.kv` / `.meter` / `.stat*` / `.log-row` / `.lv` / `.tt-*`）
 *    搬自上游 `worksplice-design-system/ui_kits/app/app.css`，本仓的可观察面是「组件渲染出的
 *    markup + globals.css 的规则体」两半——组件只写 class 名，形态全在 CSS。所以断在规则体上
 *    （与 components/primitives.test.mjs / app/globals.test.mjs 同档的源码级 seam）。
 * ② **渲染面**：`renderToStaticMarkup` + `jiti`（仓库既有 seam），断 AgentDetailPanel /
 *    ThreadPanel / DetailPanel 真正渲染出的 markup。
 *
 * 范围裁决（orchestration ask 的答复，见票 07 Answer 的「降级登记」）：`.dock-tabs` / `.dock-tab` /
 * `.tt-status` / `.assignee` / `.tt-actions` / `.tt-log` 只落 class 块、**零消费者**——本仓的
 * AgentDetailPanel 是一根滚动 + `.d-sec` 分组（无 tab），ThreadPanel 只渲染锚点 + 回复 + composer
 * （无任务状态胶囊 / owner 胶囊 / 状态变更时间线）；原型的任务线程 chrome 属功能开发，不是视觉重构。
 * 因此 `.tt-status` 的「色取 ED-10 映射」与 `.tt-log` 的「四色点」按规则体 + 映射表比对验证。
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
const { DetailPanel } = await jiti.import("./DetailPanel.tsx");
const { AgentDetailPanel, RoundLogsList, TokensCostStats } = await jiti.import(
  "./AgentDetailPanel.tsx",
);
const { ThreadPanel } = await jiti.import("./ThreadPanel.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const globalsCss = await readFile(
  new URL("../app/globals.css", import.meta.url),
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
function blockBody(selector) {
  const pattern = new RegExp(
    `(?:^|[}])\\s*${escapeRe(selector)}\\s*\\{([^}]*)\\}`,
    "m",
  );
  const match = globalsCss.match(pattern);
  assert.ok(match, `globals.css 缺少规则 \`${selector}\``);
  return match[1];
}

function renderWith(component) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, component),
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

const OWNER = {
  id: "owner",
  type: "human",
  name: "Owner",
  description: "the human boss",
  role: "owner",
  workspace_path: null,
  pi_session_file: null,
  status: "online",
  deleted: 0,
  model_provider: null,
  model_id: null,
  thinking_level: null,
  created_at: "2026-08-03T00:00:00.000Z",
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

const ANCHOR = {
  id: "m1",
  target_id: "c1",
  seq: 3,
  author_id: "owner",
  content: "anchor message",
  created_at: "2026-08-03T08:00:00.000Z",
  author: OWNER,
};

const REPLY = {
  id: "m2",
  target_id: "m1",
  seq: 4,
  author_id: "agent-1",
  content: "thread reply",
  created_at: "2026-08-03T08:00:01.000Z",
  author: AGENT,
};

function renderAgentPanel(overrides = {}) {
  return renderWith(
    React.createElement(AgentDetailPanel, {
      agent: AGENT,
      onClose: () => undefined,
      onChanged: () => undefined,
      onOpenDM: () => undefined,
      ...overrides,
    }),
  );
}

function renderThreadPanel() {
  return renderWith(
    React.createElement(ThreadPanel, {
      anchorId: "m1",
      channel: CHANNEL,
      currentMemberId: "owner",
      agents: [AGENT],
      owner: OWNER,
      onOpenPanel: () => undefined,
      onClose: () => undefined,
      initialAnchor: ANCHOR,
      initialMessages: [REPLY],
    }),
  );
}

function renderDetailPanel(content) {
  return renderWith(
    React.createElement(DetailPanel, {
      content,
      channel: CHANNEL,
      agents: [AGENT],
      owner: OWNER,
      currentMemberId: "owner",
      onClose: () => undefined,
      onChanged: () => undefined,
      onOpenPanel: () => undefined,
    }),
  );
}

// ─── ① class 块：单槽容器与 dock 头 ─────────────────────────────────────────

test("`.dock` 容器：`--surface` 底 + flex 列，容器自身不吃圆角、不重复声明左发丝", () => {
  const body = blockBody(".dock");
  assert.match(body, /background:\s*var\(--surface\)/);
  assert.match(body, /display:\s*flex/);
  assert.match(body, /flex-direction:\s*column/);
  assert.match(body, /min-height:\s*0/);
  // 容器自身不吃圆角：`--r-lg` 只作用于内部区块（票 07 Change 1）。
  assert.doesNotMatch(body, /border-radius/);
  // 左发丝归骨架钩子 `.ws-right`（票 03，AppShell.test.mjs 断的就是它）——两条会叠成双线。
  assert.doesNotMatch(body, /border-left/);
});

test("`.dock-head` / `.dock-id` / `.dock-name` / `.dock-role` 逐字上游形态", () => {
  assert.match(blockBody(".dock-head"), /border-bottom:\s*1px solid var\(--border\)/);
  assert.match(blockBody(".dock-id"), /display:\s*flex/);
  assert.match(blockBody(".dock-id .meta"), /min-width:\s*0/);
  assert.match(blockBody(".dock-name"), /font-size:\s*var\(--fs-title\)/);
  assert.match(blockBody(".dock-name"), /font-weight:\s*var\(--fw-heavy\)/);
  assert.match(blockBody(".dock-role"), /color:\s*var\(--muted\)/);
  assert.match(blockBody(".dock-role"), /display:\s*flex/);
});

test("`.dock-scroll` / `.d-sec` / `.d-sec-title`：mono 大写分组标签 + 发丝分隔", () => {
  const scroll = blockBody(".dock-scroll");
  assert.match(scroll, /overflow-y:\s*auto/);
  assert.match(scroll, /min-height:\s*0/);

  const title = blockBody(".d-sec-title");
  assert.match(title, /font-family:\s*var\(--mono\)/);
  assert.match(title, /text-transform:\s*uppercase/);
  assert.match(title, /color:\s*var\(--faint\)/);
  assert.match(title, /font-size:\s*var\(--fs-mono-micro\)/);
  assert.match(title, /letter-spacing:\s*var\(--ls-wider\)/);
});

test("`.kv`：点线引导（`1px dashed`）的 key/value 行，值走 mono", () => {
  const body = blockBody(".kv");
  assert.match(body, /justify-content:\s*space-between/);
  assert.match(body, /border-bottom:\s*1px dashed var\(--border\)/);
  assert.match(blockBody(".kv .k"), /color:\s*var\(--muted\)/);
  const value = blockBody(".kv .v");
  assert.match(value, /font-family:\s*var\(--mono\)/);
  assert.match(value, /color:\s*var\(--fg\)/);
});

test("`.meter`：6px 药丸槽 + accent 填充（`.warn` 走警示族 `--warn`）", () => {
  const body = blockBody(".meter");
  assert.match(body, /height:\s*6px/);
  assert.match(body, /border-radius:\s*var\(--r-pill\)/);
  assert.match(body, /background:\s*var\(--panel-2\)/);
  // 票 03：条状指示器走**图形档**（D6：图形边界 ≥3:1；填充档落在槽上只有 1.30:1）。
  assert.match(blockBody(".meter i"), /background:\s*var\(--accent-graphic\)/);
  // 票 03 / D9：警示语义从「借 --working」改为警示族；且 `.meter i` 与 `.meter.warn i`
  // 都是**指示条**（不是压文字的填充底），故取各族图形档。判据（条状指示器可见）不变。
  assert.match(blockBody(".meter.warn i"), /background:\s*var\(--warn-graphic\)/);
});

test("`.dock-tab`（零消费的词汇表）：下划线 tab，mono 计数转 accent", () => {
  const body = blockBody(".dock-tab");
  assert.match(body, /border-bottom:\s*2px solid transparent/);
  assert.match(body, /color:\s*var\(--muted\)/);
  assert.match(blockBody(".dock-tab:hover"), /color:\s*var\(--fg\)/);
  assert.match(blockBody(".dock-tab.is-active"), /border-bottom-color:\s*var\(--fg\)/);
  const count = blockBody(".dock-tab .count");
  assert.match(count, /font-family:\s*var\(--mono\)/);
  // 票 03：tab 的 mono 计数是「当前位置」语义 → 选中族文字档。判据（mono 计数走高对比族色）不变。
  assert.match(count, /color:\s*var\(--selected-deep\)/);
});

// ─── ① class 块：线程面板 ──────────────────────────────────────────────────

test("`.tt-summary` sticky / `.tt-reply` composer 槽 / `.tt-scroll` 滚动槽", () => {
  const summary = blockBody(".tt-summary");
  assert.match(summary, /position:\s*sticky/);
  assert.match(summary, /background:\s*var\(--surface\)/);
  assert.match(summary, /border-bottom:\s*1px solid var\(--border\)/);
  assert.match(summary, /z-index:\s*2/);

  const reply = blockBody(".tt-reply");
  assert.match(reply, /border-top:\s*1px solid var\(--border\)/);
  assert.match(reply, /background:\s*var\(--surface\)/);
  // 常驻阴影退场（ED-4：静止内容不加阴影），焦点环保留 accent（ED-8）。
  assert.match(blockBody(".tt-reply .composer-box"), /box-shadow:\s*none/);
  assert.match(
    blockBody(".tt-reply .composer-box:focus-within"),
    /0 0 0 3px var\(--accent-soft\)/,
  );

  assert.match(blockBody(".tt-scroll"), /overflow-y:\s*auto/);
});

test("`.tt-status` 胶囊：`--border-strong` 发丝 + 药丸；点色由 ED-10 映射在消费点给（本票零消费者）", () => {
  const body = blockBody(".tt-status");
  assert.match(body, /border:\s*1px solid var\(--border-strong\)/);
  assert.match(body, /border-radius:\s*var\(--r-pill\)/);
  assert.match(body, /background:\s*var\(--surface\)/);
  assert.match(body, /font-family:\s*var\(--mono\)/);
  assert.match(blockBody(".tt-status:hover"), /background:\s*var\(--accent-soft\)/);
  assert.match(blockBody(".tt-status .dot"), /border-radius:\s*var\(--r-pill\)/);

  // 「色取 ED-10 映射」= 任务状态色映射本身（与原型 JS 的 STATUS_COLOR 同形、同值）。
  // 本仓那份映射在 ChannelView 的 TASK_STATUS_COLOR（票 06 落盘），逐条比对 spec ED-10 表。
  const expected = {
    todo: "--faint",
    // 票 03：in_progress 的**点档**从 --accent（今为填充档，点上看不见）改为图形档；
    // 其余四态的名字不变（它们的 base 名本就持有各自的点档值）。
    in_progress: "--accent-graphic",
    in_review: "--working",
    done: "--online",
    closed: "--offline",
  };
  for (const [status, token] of Object.entries(expected)) {
    assert.match(
      channelViewSource,
      new RegExp(`${status}:\\s*"var\\(${token}\\)"`),
      `ED-10 任务状态色 ${status} → var(${token}) 不在 TASK_STATUS_COLOR 里`,
    );
  }
});

test("`.assignee`（零消费的词汇表）：胶囊 + 内嵌 `.avatar.sm` 的槽位形态", () => {
  const body = blockBody(".assignee");
  assert.match(body, /border-radius:\s*var\(--r-pill\)/);
  assert.match(body, /height:\s*26px/);
  assert.match(body, /color:\s*var\(--muted\)/);
  assert.match(blockBody(".assignee:hover"), /border-color:\s*var\(--border-strong\)/);
  assert.match(blockBody(".assignee.unassigned"), /font-style:\s*italic/);
});

test("`.tt-actions` / `.tt-chips`（零消费的词汇表）：chip 行的行距与 mono 标签", () => {
  const body = blockBody(".tt-actions");
  assert.match(body, /display:\s*flex/);
  assert.match(body, /flex-direction:\s*column/);
  assert.match(body, /border-bottom:\s*1px solid var\(--border\)/);
  assert.match(blockBody(".tt-chips"), /flex-wrap:\s*wrap/);
  const label = blockBody(".tt-actions .tt-label");
  assert.match(label, /font-family:\s*var\(--mono\)/);
  assert.match(label, /text-transform:\s*uppercase/);
});

// ─── ① class 块：`.tt-log` 四种点色逐条取四态 token（ED-10） ────────────────

test("`.tt-log` 时间线的四种点色逐条取四态 token", () => {
  const item = blockBody(".tt-log li");
  assert.match(item, /position:\s*relative/);
  assert.match(blockBody(".tt-log li::before"), /border-radius:\s*var\(--r-pill\)/);
  assert.match(blockBody(".tt-log li::after"), /background:\s*var\(--border\)/);

  // 逐条比对 ED-10 的四态映射：ok → --online / warn → --working / err → --error / is-now → --accent。
  assert.match(blockBody(".tt-log li.ok::before"), /background:\s*var\(--online\)/);
  // 票 03：`.warn` 级别与 `.lv.warn` 同一份警示词汇 → 警示族图形档（点 ≥3:1）。
  assert.match(blockBody(".tt-log li.warn::before"), /background:\s*var\(--warn-graphic\)/);
  assert.match(blockBody(".tt-log li.err::before"), /background:\s*var\(--error\)/);
  const now = blockBody(".tt-log li.is-now::before");
  // 票 03：`is-now` = 时间线上的「当前位置」→ 选中族（图形档 + 选中淡底）。判据（now 点可见 + 有光环）不变。
  assert.match(now, /background:\s*var\(--selected-graphic\)/);
  assert.match(now, /box-shadow:\s*0 0 0 3px var\(--selected-soft\)/);
});

// ─── ① class 块：`.log-row` + `.lv` 级别标签（AgentDetailPanel 的轮次记录） ──

test("`.log-row` / `.lv`：级别标签的行内形态与四档前景色", () => {
  const row = blockBody(".log-row");
  assert.match(row, /display:\s*flex/);
  assert.match(blockBody(".log-row .ts"), /font-family:\s*var\(--mono\)/);
  assert.match(blockBody(".log-row .ts"), /color:\s*var\(--faint\)/);
  const lv = blockBody(".log-row .lv");
  assert.match(lv, /font-family:\s*var\(--mono\)/);
  assert.match(lv, /display:\s*inline-flex/);
  // 票 03：`.lv.info` 是文字 → 文字档（填充档作字只有 1.4:1）。判据（四档前景色各自可读）不变。
  assert.match(blockBody(".lv.info"), /color:\s*var\(--accent-deep\)/);
  assert.match(blockBody(".lv.ok"), /color:\s*var\(--online-text\)/);
  // 票 03 / D9：`.lv.warn` 的警示语义改为警示族（淡底 + 文字档）。判据（级别标签高对比）不变。
  assert.match(blockBody(".lv.warn"), /color:\s*var\(--warn-deep\)/);
  assert.match(blockBody(".lv.err"), /color:\s*var\(--error\)/);
  assert.match(blockBody(".log-row .msg"), /color:\s*var\(--muted\)/);
});

test("`.log-row` 长 reason：非空的行独占整行（两行封顶），空 reason 的行保持单行", () => {
  // 用户反馈：error 轮的 reason 是模型原文（可上千字符）。四个列分完 329px 后
  // `.msg` 只剩 42px 残余宽、再被 `.ws-right .msg` 的 16px 缩进吃掉 32px，于是
  // 逐字竖排成 378–1741px 的窄柱。形状判据：非空 reason 折到第二行、整行宽、两行截断。
  assert.match(blockBody(".log-row.has-reason"), /flex-wrap:\s*wrap/);
  const long = blockBody(".log-row.has-reason .msg");
  assert.match(long, /order:\s*1/, "reason 排到 `.ts:last-child` 之后，meta 行四列顺序不变");
  assert.match(long, /flex-basis:\s*100%/);
  assert.match(long, /-webkit-line-clamp:\s*2/);
  assert.match(long, /overflow:\s*hidden/);
  // 频道 `.msg` 的 8px/16px 内边距（class 复用）在 log 行收回：整行宽里再缩进 32px
  // 就白折行了；hover 灰底同理收回（折成整行宽后它是整行灰带）。
  assert.match(blockBody(".log-row .msg"), /padding:\s*0/);
  assert.match(blockBody(".log-row .msg"), /margin:\s*0/);
  assert.match(blockBody(".log-row .msg:hover"), /background:\s*none/);
  // target 先让位（缩到内容下 + ellipsis），序号·时间不换行、钉行尾。
  assert.match(blockBody(".log-row .ts"), /white-space:\s*nowrap/);
  const firstTs = blockBody(".log-row .ts:first-child");
  assert.match(firstTs, /flex-shrink:\s*1/);
  assert.match(firstTs, /min-width:\s*0/);
  assert.match(blockBody(".log-row .ts:last-child"), /margin-left:\s*auto/);
});

// ─── ① class 块：统计数字的 mono + tabular-nums（spec 硬约束） ──────────────

test("`.stat-grid` 2×2 + `.stat .n` 数字 mono 17px/700 `tabular-nums`", () => {
  const grid = blockBody(".stat-grid");
  assert.match(grid, /display:\s*grid/);
  assert.match(grid, /grid-template-columns:\s*1fr 1fr/);
  const stat = blockBody(".stat");
  assert.match(stat, /border:\s*1px solid var\(--border\)/);
  assert.match(stat, /border-radius:\s*var\(--r-md\)/);
  assert.match(stat, /background:\s*var\(--panel\)/);
  const n = blockBody(".stat .n");
  assert.match(n, /font-family:\s*var\(--mono\)/);
  assert.match(n, /font-variant-numeric:\s*tabular-nums/);
  assert.match(n, /font-size:\s*var\(--fs-stat\)/);
  assert.match(n, /font-weight:\s*var\(--fw-black\)/);
});

test("统计/标识数字在 mono 处一律带 `tabular-nums`（ED-6：`.kv .v` / `.log-row .ts` / `.dock-tab .count`）", () => {
  for (const selector of [".kv .v", ".log-row .ts", ".log-row .lv", ".dock-tab .count", ".d-sec-title"]) {
    assert.match(blockBody(selector), /font-variant-numeric:\s*tabular-nums/, selector);
  }
});

// ─── ② 渲染面：单槽容器与两处 dock 头像 ────────────────────────────────────

test("三个 kind 都渲染在 `.dock` 单槽容器里（human / agent / thread）", () => {
  for (const content of [
    { kind: "human", id: "owner" },
    { kind: "agent", id: "agent-1" },
    { kind: "thread", id: "m1" },
  ]) {
    assert.match(
      renderDetailPanel(content),
      /^<div class="dock">/,
      `${content.kind} 变体的根不是 .dock 容器`,
    );
  }
});

test("两处 dock 头像走 `.avatar.lg`（44px = `--avatar-lg`，圆角 `--r-md`）", () => {
  const agentHtml = renderAgentPanel();
  const humanHtml = renderDetailPanel({ kind: "human", id: "owner" });
  assert.match(agentHtml, /class="avatar lg av-\d"/);
  assert.match(humanHtml, /class="avatar lg av-4"/);

  const lg = blockBody(".avatar.lg");
  assert.match(lg, /width:\s*var\(--avatar-lg\)/);
  assert.match(lg, /height:\s*var\(--avatar-lg\)/);
  assert.match(lg, /border-radius:\s*var\(--r-md\)/);
});

test("右栏三块渲染面都没有 `2px solid`；本票自有 markup 里也没有旧方向的硬偏移阴影", () => {
  const agentHtml = renderAgentPanel();
  const humanHtml = renderDetailPanel({ kind: "human", id: "owner" });
  const threadHtml = renderThreadPanel();
  for (const html of [agentHtml, humanHtml, threadHtml]) {
    assert.doesNotMatch(html, /2px solid/);
  }
  // 旧方向 `Npx Npx 0 0 rgba(20, 17, 17, …)` 硬偏移阴影（ED-4：静止内容不加阴影）。
  // 只断本票的两个模块：ThreadPanel 复用 ChannelView 的 MessageRow / Composer，
  // 那些动作栏与发送键的硬阴影归票 05（本票不得跨票改它）。
  for (const html of [agentHtml, humanHtml]) {
    assert.doesNotMatch(html, /\d+px \d+px 0 0/);
  }
});

// ─── ② 渲染面：AgentDetailPanel 的 dock 头与分节 ───────────────────────────

test("agent 详情头渲染 `.dock-head` / `.dock-id` / `.avatar.lg` / `.dock-name` / `.dock-role`（`.presence` + 文字）/ `.icon-btn` 关闭", () => {
  const html = renderAgentPanel();
  assert.match(html, /class="dock-head"/);
  assert.match(html, /class="dock-id"/);
  assert.match(html, /class="meta"/);
  assert.match(html, /class="dock-name"/);
  assert.match(html, /class="dock-role"/);
  assert.match(html, /class="presence offline"/);
  assert.match(html, /class="icon-btn"/);
  assert.match(html, /aria-label="Close panel"/);
  // 文字仍是状态文案（`.presence` + 文字，不只剩一个点）。
  assert.match(html, /Offline/);
  assert.match(html, /the helper/);
});

test("agent 详情主体渲染 `.dock-scroll` + `.d-sec` / `.d-sec-title` 分节 + `.kv` 行", () => {
  const html = renderAgentPanel();
  assert.match(html, /class="dock-scroll"/);
  assert.match(html, /class="d-sec"/);
  assert.match(html, /class="d-sec-title"/);
  assert.match(html, /class="kv"/);
  assert.match(html, /class="k"/);
  assert.match(html, /class="v"/);
  // 分组标题文本仍在（mono 大写标签换形态，不换文案）。
  // 注：原来的 `agent.observability` 卡组标签在本次形态对齐里退场——四个卡片各成为
  // 一个 `.d-sec` 并带自己的 `.d-sec-title`（“Tokens / cost”“Task history”“Rounds”
  // “Session export”），再留一层父标签会把同一批内容双重命名。i18n key 不删不改。
  assert.match(html, /Workspace/);
  assert.match(html, /Runtime/);
  assert.match(html, /Tokens \/ cost/);
  assert.match(html, /Task history/);
  assert.match(html, /Rounds/);
  assert.match(html, /Session export/);
  assert.match(html, /Reset/);
});

test("token / 成本的 2×2 统计格渲染 `.stat .n`（数字）与 `.stat .l`（标签），余量走 `.kv` 行", () => {
  const html = renderWith(
    React.createElement(TokensCostStats, {
      totals: {
        messageCount: 41,
        cachedTokens: 1200,
        uncachedTokens: 800,
        totalTokens: 2000,
        costTotal: 0.42,
        compactionCount: 2,
        compactionTokens: 300,
      },
      t: (key) => key,
    }),
  );
  assert.match(html, /class="stat-grid"/);
  // 2×2 四格：数字在 `.n`，标签在 `.l`，格子是 `.stat`。
  assert.equal(html.split('class="stat"').length - 1, 4);
  assert.equal(html.split('class="n"').length - 1, 4);
  assert.equal(html.split('class="l"').length - 1, 4);
  assert.match(html, />2,000</);
  assert.match(html, />\$0\.42</);
  assert.match(html, /observability\.totalTokens/);
  assert.match(html, /observability\.cost/);
  // 明细三项不丢：cached / uncached / compaction tokens 仍是 `.kv` 行。
  assert.equal(html.split('class="kv"').length - 1, 3);
  assert.match(html, />1,200</);
  assert.match(html, />800</);
  assert.match(html, />300</);
});

test("轮次记录渲染 `.log-row` + `.lv` 级别标签 + `.ts` 时间戳（markup 级）", () => {
  const html = renderWith(
    React.createElement(RoundLogsList, {
      rounds: [
        {
          id: "r1",
          targetId: "chan-alpha",
          status: "replied",
          reason: "ok",
          baseSeq: 3,
          createdAt: "2026-10-01T03:38:05.447Z",
        },
        {
          id: "r2",
          targetId: "chan-beta",
          status: "error",
          reason: "boom",
          baseSeq: 4,
          createdAt: "2026-10-01T03:39:05.447Z",
        },
        {
          id: "r3",
          targetId: "chan-gamma",
          status: "replied",
          reason: "",
          baseSeq: 5,
          createdAt: "2026-10-01T03:40:05.447Z",
        },
      ],
      t: (key) => key,
    }),
  );
  // 长文本形状（用户反馈）：非空 reason 的行带 `has-reason`（CSS 折第二行 + 两行封顶），
  // 空 reason 的行仍是单行 `log-row`（占位 `—` 在残余宽里）。
  assert.match(html, /class="log-row has-reason"/);
  assert.match(html, /class="log-row"/);
  assert.match(html, /class="ts"/);
  assert.match(html, /class="lv ok"/);
  assert.match(html, /class="lv err"/);
  assert.match(html, /class="msg"/);
});

// ─── ② 渲染面：ThreadPanel 的 `.tt-*` 消费 ─────────────────────────────────

test("线程面板渲染 `.tt-summary`（头，sticky）/ `.tt-scroll` / `.tt-reply`（composer 槽）", () => {
  const html = renderThreadPanel();
  assert.match(html, /class="tt-summary"/);
  assert.match(html, /class="tt-title"/);
  assert.match(html, /class="tt-scroll"/);
  assert.match(html, /class="tt-reply"/);
  assert.match(html, /<textarea/);
  // 负载仍在：锚点 + 回复 + 关闭按钮。
  assert.match(html, /#3/);
  assert.match(html, /anchor message/);
  assert.match(html, /thread reply/);
  assert.match(html, /aria-label="Close panel"/);
});

test("线程面板的零消费者 class 不出现在 markup 里（`.tt-status` / `.assignee` / `.tt-actions` / `.tt-log` / `.dock-tab`）", () => {
  const html = renderThreadPanel() + renderAgentPanel();
  for (const cls of ["tt-status", "assignee", "tt-actions", "tt-log", "dock-tab", "dock-tabs"]) {
    assert.doesNotMatch(
      html,
      new RegExp(`class="[^"]*\\b${cls}\\b`),
      `${cls} 在本票里应零消费者（范围裁决 A），却出现在 markup 里`,
    );
  }
});
