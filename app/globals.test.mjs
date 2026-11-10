/**
 * 视觉契约地基的机械断据（ticket 02，spec.md 的 Testing Decisions）。
 *
 * T-A 上游契约镜像：设计系统 token 真的进了产品，且没有被本仓偷偷改值。
 * T-B 旧名灭绝：旧方向的 token 名全仓 0 次，防「新代码新名、旧代码旧名」的双轨漂移。
 * T-C 骨架规则与文档一致性：0 圆角压制 / 2px ink 结构线 / 断点 900+1080 / reduce 收敛 /
 *     docs/spec.md §4 与 AGENTS.md 的契约段不漂移。
 * T-D 渲染面：组件真的在消费新契约（markup 里出现新 token 名），不只是断言 CSS 源文本。
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const globalsUrl = new URL("./globals.css", import.meta.url);
const repoUrl = new URL("../", import.meta.url);

const globalsCss = await readFile(globalsUrl, "utf8");

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 抽 `:root {}` 块里的 `--<名>: <值>;` 声明；值折叠空白便于逐字比对。 */
function extractRootDecls(css) {
  const decls = new Map();
  for (const block of stripComments(css).matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const decl of block[1].matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) {
      decls.set(decl[1], decl[2].replace(/\s+/g, " ").trim());
    }
  }
  return decls;
}

async function recursiveFiles(dirUrl, predicate, out = []) {
  const entries = await readdir(dirUrl, { withFileTypes: true });
  for (const entry of entries) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dirUrl);
    if (entry.isDirectory()) {
      await recursiveFiles(child, predicate, out);
    } else if (predicate(entry.name)) {
      out.push(child);
    }
  }
  return out;
}

// ─── T-A 上游契约镜像 ─────────────────────────────────────────────────────────

test("T-A: globals.css 从设计系统 token 文件顶层 @import（上游即运行时真源）", () => {
  // 相对路径按 app/globals.css 的实际位置解析：design system 在仓库根，故上一级即到。
  assert.match(
    globalsCss,
    /@import\s+["']\.\.\/worksplice-design-system\/colors_and_type\.css["']\s*;/,
  );
  assert.match(
    globalsCss,
    /@import\s+["']\.\.\/worksplice-design-system\/tokens\.css["']\s*;/,
  );
});

test("T-A: 设计系统每个 token 都在产品里取到，且同名值逐字相同", async () => {
  const importPaths = [
    ...globalsCss.matchAll(/@import\s+["']([^"']+)["']/g),
  ].map((match) => match[1]);

  const effective = new Map();
  for (const importPath of importPaths) {
    const importedCss = await readFile(new URL(importPath, globalsUrl), "utf8");
    for (const [name, value] of extractRootDecls(importedCss)) {
      effective.set(name, value);
    }
  }
  // 本仓扩展层后声明，覆盖同名项 —— 若它把上游的值改掉，下面的逐字比对会红。
  for (const [name, value] of extractRootDecls(globalsCss)) {
    effective.set(name, value);
  }

  assert.ok(importPaths.length >= 2, "至少两条设计系统 @import");

  for (const upstreamPath of [
    "../worksplice-design-system/colors_and_type.css",
    "../worksplice-design-system/tokens.css",
  ]) {
    const upstreamCss = await readFile(new URL(upstreamPath, globalsUrl), "utf8");
    const upstreamDecls = extractRootDecls(upstreamCss);
    assert.ok(upstreamDecls.size > 20, `${upstreamPath} 应抽出成规模 token`);
    for (const [name, value] of upstreamDecls) {
      assert.ok(effective.has(name), `产品缺少上游 token ${name}`);
      assert.equal(effective.get(name), value, `token ${name} 的值被本仓改写了`);
    }
  }
});

// ─── T-B 旧名灭绝 ─────────────────────────────────────────────────────────────

// spec T-B 的枚举集（写成集合枚举，不用前缀规则，避免误伤同名保留项）。
// `--border` / `--bg` / `--accent` / `--accent-hover` / `--font-mono` 是**同名保留**项，不在集内。
const RETIRED_TOKEN_NAMES = [
  "--text",
  "--text-muted",
  "--text-dim",
  "--bg-panel",
  "--bg-hover",
  "--bg-selected",
  "--bg-subtle",
  "--user-bg",
  "--assistant-bg",
  "--tool-bg",
  "--cream",
  "--yellow",
  "--pink",
  "--cyan",
  "--orange",
  "--lime",
  "--lavender",
  "--coral",
  "--ink",
  "--stone",
  "--font-space-grotesk",
  "--font-space-mono",
  "--font-hanken",
  "--font-hanken-grotesk",
  "--font-grotesk",
  "--shadow-sm",
  "--shadow-md",
  "--shadow-lg",
  "--shadow-pressed",
  "--accent-line",
];

/** token 名边界：两侧都不许接 `[\w-]`，避免 `--panel` 命中 `--panel-2`、`--text` 命中 `--online-text`。 */
function tokenPattern(name) {
  return new RegExp(
    `(?<![\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`,
  );
}

test("T-B: 旧 token 名在 app/components/hooks/lib 的 .tsx/.ts/.css 里出现 0 次", async () => {
  const roots = ["app/", "components/", "hooks/", "lib/"].map(
    (dir) => new URL(dir, repoUrl),
  );
  const files = (
    await Promise.all(
      roots.map((root) =>
        recursiveFiles(root, (name) => /\.(tsx|ts|css)$/.test(name)),
      ),
    )
  ).flat();

  // 本文件自身装着灭绝集（字符串字面量），跳过自己。
  const selfPath = fileURLToPath(import.meta.url);

  for (const file of files) {
    if (fileURLToPath(file) === selfPath) continue;
    const source = await readFile(file, "utf8");
    for (const name of RETIRED_TOKEN_NAMES) {
      assert.doesNotMatch(
        source,
        tokenPattern(name),
        `${fileURLToPath(file)} 仍引用旧 token ${name}`,
      );
    }
  }
});

test("T-B: Tailwind 的 @theme 别名命名空间（--color-*）已退场", async () => {
  const roots = ["app/", "components/"].map((dir) => new URL(dir, repoUrl));
  const files = (
    await Promise.all(
      roots.map((root) =>
        recursiveFiles(root, (name) => /\.(tsx|ts|css)$/.test(name)),
      ),
    )
  ).flat();
  const selfPath = fileURLToPath(import.meta.url);
  for (const file of files) {
    if (fileURLToPath(file) === selfPath) continue;
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(
      source,
      /--color-[\w-]+/,
      `${fileURLToPath(file)} 仍引用 Tailwind @theme 别名 --color-*`,
    );
  }
});

// ─── T-C 骨架规则 ─────────────────────────────────────────────────────────────

test("T-C: 全局 0 圆角压制已解开", () => {
  assert.doesNotMatch(globalsCss, /border-radius:\s*0\s*!important/);
});

test("T-C: 旧方向的 2px ink 结构线与 ink 阴影全部退场", () => {
  // 旧方向用「2px 墨线」表达结构；新方向一律发丝（ED-2）。
  // 注意：`:focus-visible` 的 2px outline 与 scrollbar 的 2px transparent padding
  // 是设计系统 reset 的既有形态，本断言只针对 **border** 声明。
  // 只针对**有色**的粗结构线；`border: 2px solid transparent`（scrollbar 的 padding 技巧，
  // 上游 reset 逐字搬入）不是结构线，不在此断言范围。
  assert.doesNotMatch(
    globalsCss,
    /(?:^|[;{\s])border(?:-[a-z]+)?\s*:[^;{}]*\b2px\s+solid\s+(?!transparent)/m,
  );
  assert.doesNotMatch(globalsCss, /box-shadow[^;{}]*var\(--ink\)/);
});

test("T-C: 焦点环与字段/composer 的 accent-soft 环按设计系统 reset 落位", () => {
  // 环走**图形档**（ADR-0015 的档位规则：环 ≥3:1）——票 03 把落点从 --accent 改指
  // --accent-graphic（后者 on 底纸 3.03–3.65）；判据（「环必须存在且是 accent 族」）不变。
  assert.match(
    globalsCss,
    /:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--accent-graphic\)/,
  );
  assert.match(globalsCss, /outline-offset:\s*2px/);
  assert.match(globalsCss, /0 0 0 3px var\(--accent-soft\)/);
});

test("T-C: reduce 收敛存在，@keyframes 组数只增不减（≥12）", () => {
  assert.match(globalsCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  const keyframes = [...globalsCss.matchAll(/@keyframes\s+[\w-]+/g)];
  assert.ok(keyframes.length >= 12, `@keyframes 只剩 ${keyframes.length} 组`);
});

test("T-C: 旅程引导卡内容过渡 keyframes 存在，卡壳不挂动画，reduce 不显示粒子", () => {
  const css = stripComments(globalsCss);
  // 最终设计：内容粒子燃尽/重聚 + 旧内容燃尽淡出。
  for (const name of [
    "journey-guide-content-dissolve",
    "journey-guide-content-reform",
    "journey-guide-content-burn",
  ]) {
    assert.match(css, new RegExp(`@keyframes\\s+${name}\\b`), `缺少 @keyframes ${name}`);
  }
  // 旧的整卡动画 keyframes（已被最终设计取代）不得残留。
  for (const name of [
    "journey-guide-card-in",
    "journey-guide-card-switch",
    "journey-guide-card-out",
    "journey-guide-particle-out",
    "journey-guide-particle-in",
  ]) {
    assert.doesNotMatch(
      css,
      new RegExp(`@keyframes\\s+${name}\\b`),
      `旧的整卡动画 ${name} 应已删除`,
    );
  }
  // 卡壳静止：.journey-guide-card 不声明 animation，也不存在 is-* 阶段动画类。
  const cardRule = css.match(/\.journey-guide-card\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.doesNotMatch(cardRule, /animation/i);
  assert.doesNotMatch(css, /\.journey-guide-card\.is-(entering|switching|exiting)/);

  // 既有全局 reduce reset（animation-duration）仍在。
  assert.match(
    css,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?animation-duration:\s*0\.001ms\s*!important/,
  );
  // reduce 下粒子不生成可见位移：断言落在覆盖粒子的 reduce 块内。
  const reduceBlocks = css
    .split(/@media\s*\(prefers-reduced-motion:\s*reduce\)/)
    .slice(1);
  const particleReduce = reduceBlocks.find((block) =>
    /\.journey-guide-particle\s*\{[^}]*display:\s*none\s*!important/.test(
      block,
    ),
  );
  assert.ok(particleReduce, "缺少覆盖粒子的 reduce 块");
  assert.match(
    particleReduce,
    /\.journey-guide-particle\s*\{[^}]*display:\s*none\s*!important/,
  );
  // reduce 下内容层立即终态。
  const contentReduce = reduceBlocks.find((block) =>
    /\.journey-guide-content\s*\{[^}]*opacity:\s*1\s*!important/.test(block),
  );
  assert.ok(contentReduce, "缺少覆盖内容层的 reduce 块");
});

test("T-C: 断点对齐上游（900 / 1080），旧的 960 退场", () => {
  assert.match(globalsCss, /@media\s*\(max-width:\s*900px\)/);
  assert.match(globalsCss, /@media\s*\(max-width:\s*1080px\)/);
  assert.doesNotMatch(globalsCss, /@media\s*\(max-width:\s*960px\)/);
});

test("T-C: 有色 2px 结构线在 app/components/hooks 的源码里也为 0（组件侧回归网）", async () => {
  // globals.css 之外同样不能残留 2px ink 线（T-C 的 globals 断言只守一处，防 shotgun 漏点）。
  const roots = ["app/", "components/", "hooks/"].map(
    (dir) => new URL(dir, repoUrl),
  );
  const files = (
    await Promise.all(
      roots.map((root) =>
        recursiveFiles(root, (name) => /\.(tsx|ts|css)$/.test(name)),
      ),
    )
  ).flat();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(
      source,
      /(?<!\/\/)border(?:-[a-z]+)?\s*:\s*[^;{}]*\b2px\s+solid\s+(?!transparent)/,
      `${fileURLToPath(file)} 仍有有色 2px 结构线`,
    );
  }
});

// ─── T-C 文档一致性：docs/spec.md §4 与 AGENTS.md 的契约段 ────────────────────

const specUrl = new URL("../docs/spec.md", import.meta.url);
const agentsUrl = new URL("../AGENTS.md", import.meta.url);

/** 取 `heading` 起、到下一个 `## ` 标题前的正文（markdown 章节）。 */
function extractSection(markdown, heading) {
  const start = markdown.indexOf(heading);
  assert.notEqual(start, -1, `缺少章节 ${heading}`);
  const rest = markdown.slice(start + heading.length);
  const next = rest.search(/\n##\s/);
  return next === -1 ? rest : rest.slice(0, next);
}

test("T-C: docs/spec.md §4 不再出现退役色值与旧契约标记", async () => {
  // 文档与代码同一方向：§4 只留终局值（ADR-0014 形态 + ADR-0015 色板）。
  const spec = await readFile(specUrl, "utf8");
  const section = extractSection(spec, "## 4. 视觉设计 token");
  const retiredMarkers = [
    "#ffd440",
    "#fe7da8",
    "#fffaef",
    "0 圆角",
    "2px ink",
    "[锁定] 02",
    "Space Grotesk",
    "tailwind 配置",
    "沿用 pi-web 的主题基建",
    "像素头像",
    "硬偏移阴影",
  ];
  for (const marker of retiredMarkers) {
    assert.ok(
      !section.includes(marker),
      `docs/spec.md §4 仍含旧契约标记 ${marker}`,
    );
  }
  // 退役 token 名（`--accent-line` / `--text*` / `--bg-panel` …）在 §4 同样 0 次。
  for (const name of RETIRED_TOKEN_NAMES) {
    assert.doesNotMatch(
      section,
      tokenPattern(name),
      `docs/spec.md §4 仍引用已退役 token ${name}`,
    );
  }
  assert.match(section, /Tailwind 已删除/);
});

test("T-C: AGENTS.md 的 CSS 变量段列的是当前契约名", async () => {
  const agents = await readFile(agentsUrl, "utf8");
  const section = extractSection(agents, "## CSS Variables");
  const requiredTokens = [
    "--bg",
    "--surface",
    "--panel",
    "--panel-2",
    "--fg",
    "--muted",
    "--faint",
    "--border",
    "--border-strong",
    "--accent",
    "--accent-hover",
    "--accent-soft",
    "--accent-graphic",
    "--online",
    "--working",
    "--error",
    "--offline",
    "--av-0",
    "--av-4",
    "--font",
    "--mono",
    "--font-mono",
    "--sp-*",
    "--r-*",
    "--shadow-card",
    "--shadow-pop",
    "--shadow-composer",
  ];
  for (const token of requiredTokens) {
    assert.match(
      section,
      tokenPattern(token),
      `AGENTS.md CSS 变量段缺 ${token}`,
    );
  }
  // 已退役的 token 只允许出现在「退役」说明行；把它们重新列为现行契约名即红。
  for (const line of section.split("\n")) {
    for (const name of RETIRED_TOKEN_NAMES) {
      if (!tokenPattern(name).test(line)) continue;
      assert.match(line, /退役/, `AGENTS.md CSS 变量段把退役 token ${name} 当作现行名：${line}`);
    }
  }
});

test("T-C: AGENTS.md File Map 不再指向已删除的旧头像组件", async () => {
  const agents = await readFile(agentsUrl, "utf8");
  const section = extractSection(agents, "## File Map");
  assert.doesNotMatch(section, /PixelAvatar/);
  assert.match(section, /^\s*Avatar\.tsx\s/m);
  assert.doesNotMatch(section, /马卡龙 × brutalist/);
});

// ─── T-D 渲染面：组件真的在消费新契约 ────────────────────────────────────────

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { StatusDot } = await jiti.import("../components/StatusDot.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

test("T-D: StatusDot 四态渲染出在线/干活/出错/离线四个新语义 token", () => {
  const rendered = {};
  for (const status of ["online", "working", "error", "offline"]) {
    // StatusDot 的可访问名走 i18n（界面评审 A6）⇒ 渲染必须包在 I18nProvider 里。
    rendered[status] = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        null,
        React.createElement(StatusDot, { status }),
      ),
    );
  }
  assert.match(rendered.online, /var\(--online\)/);
  assert.match(rendered.working, /var\(--working\)/);
  assert.match(rendered.error, /var\(--error\)/);
  assert.match(rendered.offline, /var\(--offline\)/);
  for (const html of Object.values(rendered)) {
    assert.doesNotMatch(html, /2px solid/);
    assert.doesNotMatch(
      html,
      /var\(--(yellow|coral|stone|success)\)/,
    );
  }
});

// ─── 界面评审：样式契约的机械断言 ──────────────────────────────────────────────

/** 取**最后一处**同名规则的声明体（本仓的覆盖行声明在逐字搬运行之后）。
 *  不加前导边界：覆盖行前面只有注释与空白（`(?:^|[}])` 那种写法要求前一个字符是 `}`
 *  或字符串开头，连续出现两次同选择器时第二次会被漏掉）。选择器 + 紧跟的 `{` 已经足够精确。 */
function lastBlockBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 行首锚定：`.board-wrap.is-list .board-toolbar` 这类后代选择器也以 `.board-toolbar {`
  // 结尾，不加锚点会被当成同一条规则。
  const matches = [
    ...stripComments(css).matchAll(
      new RegExp(`^[ \\t]*${escaped}[ \\t]*\\{([^}]*)\\}`, "gm"),
    ),
  ];
  assert.ok(matches.length > 0, `缺少规则 \`${selector}\``);
  return matches[matches.length - 1][1];
}

test("B1：窄屏频道头允许换行、标题可伸缩、工具条不收缩（上游条逐字保留）", () => {
  // 上游条仍在（首处声明）：逐字搬运的可证性由 message-stream.test.mjs 守；这里守覆盖行。
  assert.match(lastBlockBody(globalsCss, ".chan-top"), /flex-wrap:\s*wrap/);
  assert.match(lastBlockBody(globalsCss, ".chan-top"), /row-gap:\s*var\(--sp-4\)/);
  assert.match(lastBlockBody(globalsCss, ".chan-title"), /flex:\s*1 1 auto/);
  assert.match(lastBlockBody(globalsCss, ".chan-tools"), /flex:\s*0 0 auto/);
});

test("B2 / B3：工具条可换行；`.overlay` 承接滚动（矮视口模态可滚到底栏）", () => {
  assert.match(lastBlockBody(globalsCss, ".board-toolbar"), /flex-wrap:\s*wrap/);
  assert.match(globalsCss, /\.overlay \{[^}]*overflow-y:\s*auto/);
});

test("B4：≤900px 搜索视图头部让开汉堡按钮（内联 padding 需 !important 才能覆盖）", () => {
  const compact = globalsCss.slice(globalsCss.indexOf("@media (max-width: 900px)"));
  assert.match(compact, /\.search-view header\s*\{[^}]*padding-left:\s*52px\s*!important/);
});

test("C1 / C3：`--border-strong` 是字段边界，搜索壳与 `.seg` 选中段不再用色板外色", () => {
  assert.match(lastBlockBody(globalsCss, ".search-btn"), /border:\s*1px solid var\(--border-strong\)/);
  const segActive = lastBlockBody(globalsCss, ".seg button.is-active");
  assert.match(segActive, /background:\s*var\(--fg\)/);
  assert.match(segActive, /color:\s*var\(--surface\)/);
  assert.doesNotMatch(globalsCss, /oklch\(98% 0\.005 250\)/);
  // 被 CodeBlock 遮蔽的三条冷蓝 `pre` 规则已删除（先剥注释：登记说明里会提到选择器名）
  const cssNoComments = stripComments(globalsCss);
  assert.doesNotMatch(cssNoComments, /\.msg-text pre\b/);
  assert.doesNotMatch(cssNoComments, /\.msg-text pre \.(cmt|kw)\b/);
});

test("C3：`saved-pop` 的关键帧从 `--online-fill` 派生（keyframes 总数不减）", () => {
  const savedPop = globalsCss.slice(
    globalsCss.indexOf("@keyframes saved-pop"),
    globalsCss.indexOf("@keyframes saved-check-draw"),
  );
  assert.match(savedPop, /color-mix\(in oklch, var\(--online-fill\) 55%, transparent\)/);
  assert.doesNotMatch(savedPop, /rgba\(74,\s*222,\s*128/);
  assert.ok([...globalsCss.matchAll(/@keyframes\s+[\w-]+/g)].length >= 12);
});

test("E2：会留下持久视觉状态的三条 hover 有 hover 守卫", () => {
  // `.ws-message-row:hover` / `.card:hover` 包进 `@media (hover: hover)`；
  // `.msg:hover` 在 `hover: none` 下退回无底色（触屏不粘住）。
  const blocks = [...stripComments(globalsCss).matchAll(
    /@media \(hover: hover\) \{([\s\S]*?)\n\}/g,
  )].map((m) => m[1]);
  const guarded = blocks.join("\n");
  assert.ok(blocks.length > 0, "缺少 @media (hover: hover) 守卫");
  assert.match(guarded, /\.ws-message-row:hover\s*\{[^}]*var\(--fg-soft\)/);
  assert.match(guarded, /\.card:hover\s*\{[^}]*var\(--border-strong\)/);
  assert.match(guarded, /\.msg:hover\s*\{[^}]*var\(--fg-soft\)/);
  // 三条统一机制：不再有反向的 `hover: none` 复位
  assert.doesNotMatch(stripComments(globalsCss), /@media \(hover: none\)/);
});

test("E3：`.kv.stack` 竖排左对齐（长路径行不再右对齐折行）", () => {
  assert.match(globalsCss, /\.kv\.stack \{[^}]*flex-direction:\s*column/);
  assert.match(globalsCss, /\.kv\.stack \{[^}]*align-items:\s*flex-start/);
  assert.match(globalsCss, /\.kv\.stack \.v \{[^}]*text-align:\s*start/);
});
