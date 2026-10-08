/**
 * 搜索视图的渲染落盘断言（票 09，spec §3 组件表第 16 行 / Testing Decisions 的 T-D「09」行）。
 *
 * 两根 seam，与票 04 的 primitives.test.mjs / 票 06 的 task-board.test.mjs 同形：
 * ① **产品渲染出的 markup**（jiti + renderToStaticMarkup）——`.search-field` 是焦点环的落点、
 *    命中行带 `.result` / `#seq` 的 `.hash`、命中作者头像 22px（`.avatar.sm`）与名称缺失的
 *    `?` 占位分支、空态 `.empty`。命中的**结果行**要等异步 fetch 才出现，静态渲染不可达，
 *    所以它经 `SearchHitRow` 导出（同票 06 的 `TaskCard` / `TaskBoard`）在真 props 上渲染。
 * ② **globals.css 的规则体**——形态全在 CSS：accent-soft 焦点环、`.hash` 的 mono +
 *    tabular-nums、`.empty b` 的 13.5px 标题；以及零消费者登记（`.facet-row`）。
 *
 * facet 行与结果分组**不渲染**是本票的裁决（coordinator 裁决 3）：本仓没有实体——
 * `docs/spec.md` §6.4 只锁消息正文、无 facet 状态、结果平铺、i18n 无 facet 键。
 * 这里断言的是「只搬 class、不新增显示面」，不是「忘了写」。
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { SearchView, SearchHitRow } = await jiti.import("./SearchView.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const globalsCss = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const designTokens = await readFile(
  new URL("../worksplice-design-system/tokens.css", import.meta.url),
  "utf8",
);
const searchViewSource = await readFile(
  new URL("./SearchView.tsx", import.meta.url),
  "utf8",
);
const componentsDir = new URL("./", import.meta.url);

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
  assert.ok(match, `globals.css 缺少规则 \`${selector}\``);
  return match[1];
}

function renderI18n(children) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, children));
}

const renderSearch = (query = "") =>
  renderI18n(
    React.createElement(SearchView, {
      initialQuery: query,
      onClose: () => undefined,
      onOpenMessage: () => undefined,
    }),
  );

// ─── 命中行夹具（渲染级断言跑在真 props 上，同 ChannelView.test.mjs 的 MESSAGE） ──

const CHANNEL = {
  id: "chan-design",
  name: "design-system",
  type: "public",
  description: "",
  archived: 0,
  created_at: "2026-10-01T00:00:00.000Z",
};

const AUTHOR = {
  id: "agent-9",
  type: "agent",
  name: "Sentry",
  description: "",
  role: "member",
  workspace_path: null,
  pi_session_file: null,
  status: "online",
  deleted: 0,
  model_provider: null,
  model_id: null,
  thinking_level: null,
  created_at: "2026-10-01T00:00:00.000Z",
};

const HIT = {
  id: "msg-42",
  target_id: "chan-design",
  seq: 4,
  author_id: "agent-9",
  created_at: "2026-10-08T08:00:00.000Z",
  snippet: "hello <mark>world</mark> &lt;script&gt; &amp; more",
  channel: CHANNEL,
  author: AUTHOR,
  inThread: false,
};

const renderHit = (hit = HIT) =>
  renderI18n(
    React.createElement(SearchHitRow, { hit, onOpen: () => undefined }),
  );

// ─── 搜索框：`.search-field` 是焦点环的落点 ─────────────────────────────────

test("骨架：`.search-view` 列 + `.search-field` 容器包住 input（不是并列的兄弟）", () => {
  const html = renderSearch();
  assert.match(html, /class="search-view"/);
  assert.match(html, /class="search-field"/);
  assert.match(html, /class="search-field"[^>]*>[\s\S]*?<input/);
  assert.match(html, /placeholder="Search messages…"/);
  assert.match(html, /aria-label="Search messages…"/);
});

test("`.search-field` 形态：--border-strong 发丝 + --r-lg + --surface；无 ink 粗线", () => {
  const field = blockBody(globalsCss, ".search-field");
  assert.match(field, /border:\s*1px solid var\(--border-strong\)/);
  assert.match(field, /border-radius:\s*var\(--r-lg\)/);
  assert.match(field, /background:\s*var\(--surface\)/);
  assert.doesNotMatch(field, /--ink|2px solid/);
});

test("焦点环在字段容器上：`:focus-within` = accent 边 + accent-soft 3px 环", () => {
  const focus = blockBody(globalsCss, ".search-field:focus-within");
  assert.match(focus, /border-color:\s*var\(--accent\)/);
  assert.match(focus, /box-shadow:\s*0 0 0 3px var\(--accent-soft\)/);
  assert.doesNotMatch(focus, /--ink/);
});

test("内层 input 不叠第二圈（字段环只在容器上，同票 03 `.search-btn input` 的处置）", () => {
  const body = blockBody(globalsCss, ".search-field input:focus-visible");
  assert.match(body, /box-shadow:\s*none/);
});

// ─── 命中行：`.result` + `#seq` 的 mono/tabular-nums ───────────────────────

test("命中行形态：`.result` 卡片 + `.r-top` 元信息 + `.r-snip` 摘要", () => {
  const html = renderHit();
  assert.match(html, /class="result"/);
  assert.match(html, /class="r-top"/);
  assert.match(html, /class="r-snip"/);
  // 作者名与归属频道都在元信息行里；#seq 走 `.hash`
  assert.match(html, /Sentry/);
  assert.match(html, /design-system/);
  assert.match(html, /class="hash">#4</);
  // 作者名是 accent（票面：命中摘要的 #seq 与作者名——mono / accent）
  assert.match(html, /style="color:var\(--accent\)[^"]*">Sentry</);
});

test("`.result` 形态：--surface + 发丝 + --r-md；hover = 边框强化 + 落到更深的 --panel 表面", () => {
  const card = blockBody(globalsCss, ".result");
  assert.match(card, /background:\s*var\(--surface\)/);
  assert.match(card, /border:\s*1px solid var\(--border\)/);
  assert.match(card, /border-radius:\s*var\(--r-md\)/);
  const hover = blockBody(globalsCss, ".result:hover");
  assert.match(hover, /border-color:\s*var\(--border-strong\)/);
  assert.match(hover, /background:\s*var\(--panel\)/);
});

test("命中摘要的长 token 不横向溢出（原先 inline 的 wordBreak 改由 .r-snip 兜住）", () => {
  assert.match(blockBody(globalsCss, ".result .r-snip"), /overflow-wrap:\s*anywhere/);
});

test("线程命中的徽标借票 06 的 `.card-tag`（原型搜索结果里的 kind 槽位）", () => {
  const html = renderHit({ ...HIT, inThread: true });
  assert.match(html, /class="card-tag">thread</);
  assert.doesNotMatch(renderHit(), /card-tag/);
});

test("`#seq` 走 `var(--mono)` + `tabular-nums`（ED-6 / 票面验收）", () => {
  const hash = blockBody(globalsCss, ".result .r-top .hash");
  assert.match(hash, /font-family:\s*var\(--mono\)/);
  assert.match(hash, /font-variant-numeric:\s*tabular-nums/);
  assert.match(hash, /color:\s*var\(--accent\)/);
});

// ─── 命中作者头像：22px（`.avatar.sm`）+ `?` 占位分支 ───────────────────────

test("命中作者头像 22px：`.avatar.sm` 消费 `--avatar-sm`（= 22px）", () => {
  const html = renderHit();
  assert.match(html, /class="avatar sm av-\d"/);
  assert.match(blockBody(globalsCss, ".avatar.sm"), /var\(--avatar-sm\)/);
  assert.match(designTokens, /--avatar-sm:\s*22px/);
});

test("命中作者名称缺失：渲染 `?` 占位，`aria-label` 回退到 `hit.author_id`", () => {
  const html = renderHit({ ...HIT, author: null, author_id: "ghost-7" });
  assert.match(html, />\?</);
  assert.match(html, /aria-label="ghost-7"/);
  // 元信息行的作者位同样回退到 id（不是空白）
  assert.match(html, />ghost-7</);
});

// ─── 命中摘要：JSX 渲染，`<mark>` 高亮保留、实体不二次转义 ──────────────────

test("命中摘要按 JSX 渲染：`<mark>` 保留、其余标签当文本、实体只解一重", () => {
  const html = renderHit();
  assert.match(html, /hello <mark>world<\/mark> &lt;script&gt; &amp; more/);
  assert.doesNotMatch(searchViewSource, /dangerouslySetInnerHTML\s*=/);
});

test("命中摘要在 `.result mark` 上有高亮形态（票面的 mark 高亮仍在）", () => {
  const mark = blockBody(globalsCss, ".result mark");
  assert.match(mark, /background:\s*color-mix\(in oklch, var\(--working\) 45%, transparent\)/);
  assert.match(mark, /color:\s*inherit/);
});

// ─── 空态：`.empty` ─────────────────────────────────────────────────────────

test("空态走 `.empty`：图标 + 13.5px 标题（--fs-body-lg / --fw-semi）", () => {
  const html = renderSearch();
  assert.match(html, /class="empty"/);
  assert.match(html, /<svg/);
  assert.match(html, /Type keywords to search message bodies/);
  assert.match(blockBody(globalsCss, ".empty"), /color:\s*var\(--faint\)/);
  const title = blockBody(globalsCss, ".empty b");
  assert.match(title, /font-size:\s*var\(--fs-body-lg\)/);
  assert.match(title, /font-weight:\s*var\(--fw-semi\)/);
});

// ─── 零消费者登记（coordinator 裁决 3）：只搬 class、不新增显示面 ──────────

test("facet 行与结果分组不渲染：`.facet-row` 只作词汇表（零消费者）", async () => {
  const html = renderSearch();
  assert.doesNotMatch(html, /facet-row|filter-chip|group-label/);
  // 词汇表本身逐字落盘（搬入但不消费）
  const facetRow = blockBody(globalsCss, ".facet-row");
  assert.match(facetRow, /gap:\s*7px/);
  assert.match(facetRow, /flex-wrap:\s*wrap/);

  // 组件侧 0 消费点：全 components/*.tsx 无这两个 class 的 className 用法（源码级反证；
  // 只扫 className，注释里提到 class 名不算消费点）
  const files = (await readdir(componentsDir)).filter((name) =>
    name.endsWith(".tsx"),
  );
  for (const name of files) {
    const source = await readFile(new URL(name, componentsDir), "utf8");
    assert.doesNotMatch(
      source,
      /className=\{?"[^"]*(?:facet-row|filter-chip)/,
      `${name} 出现 facet 消费点`,
    );
  }
});

// ─── 零行为改动红线（源码级守卫：请求 / 防抖 / i18n / 键盘） ────────────────

test("搜索请求与防抖一字不动（GET /api/search 的调用与参数）", () => {
  assert.match(
    searchViewSource,
    /fetch\(`\/api\/search\?q=\$\{encodeURIComponent\(trimmed\)\}`\)/,
  );
  assert.match(searchViewSource, /const DEBOUNCE_MS = 250;/);
});

test("i18n key 一字不动：九条搜索键全部仍在用", () => {
  for (const key of [
    "search.title",
    "search.placeholder",
    "search.close",
    "search.results",
    "search.emptyHint",
    "search.noResults",
    "search.thread",
    "search.open",
    "search.error",
  ]) {
    assert.ok(
      searchViewSource.includes(`t("${key}"`),
      `SearchView.tsx 不再消费 ${key}`,
    );
  }
});

test("键盘与无障碍面不动：Enter 跑搜索 / Escape 关闭 / 关闭钮带无障碍名", () => {
  assert.match(searchViewSource, /if \(e\.key === "Enter"\) run\(query\);/);
  assert.match(searchViewSource, /if \(e\.key === "Escape"\) onClose\(\);/);
  assert.match(searchViewSource, /aria-label=\{t\("search\.close"\)\}/);
  assert.match(searchViewSource, /title=\{t\("search\.close"\)\}/);
});

test("新段落不留旧方向残留：无 --ink / 旧 token / rgba 字面量 / 2px 结构线", () => {
  const section = globalsCss.slice(globalsCss.indexOf("搜索视图 class 块"));
  assert.ok(section.length > 0, "globals.css 应有搜索视图段");
  assert.doesNotMatch(section, /--ink|--bg-panel|--bg-selected|--text-dim|rgba\(/);
  // 分隔只有 1px 发丝（ED-2）：不允许任何非 1px 的 solid 边框
  assert.doesNotMatch(
    section,
    /(?:^|[;\s])border(?:-[a-z]+)?\s*:\s*(?!1px\b)\d+px\s+solid/,
  );
});

test("头文件红线：@keyframes 组数不减（12，与 globals.test.mjs 同基线）、reduce 收敛仍在", () => {
  const keyframes = [...globalsCss.matchAll(/@keyframes\s+[\w-]+/g)];
  assert.ok(keyframes.length >= 12, `@keyframes 只剩 ${keyframes.length} 组`);
  assert.match(globalsCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  // 本票新增的搜索视图段自己不含 keyframes（只增不减的护栏不被本票消耗）
  const section = globalsCss.slice(globalsCss.indexOf("搜索视图 class 块"));
  assert.doesNotMatch(section, /@keyframes/);
});

test("测试自己也得守门：SearchView.tsx 落在允许的改动面内（UI 不直连数据层）", () => {
  const imports = [...searchViewSource.matchAll(/from "([^"]+)"/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(
    [...new Set(imports)].sort(),
    [
      "@/hooks/useI18n",
      "@/lib/domain/collab",
      "lucide-react",
      "react",
      "./Avatar",
    ].sort(),
  );
  // 工程规范 §1：UI 不直连数据层（数据一律经 协作服务层 / 路由）
  assert.doesNotMatch(searchViewSource, /@\/lib\/data/);
  assert.doesNotMatch(searchViewSource, /\/api\/search\/[^?]/);
});
