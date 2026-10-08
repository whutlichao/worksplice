/**
 * 视觉契约地基的机械断据（ticket 02，spec.md 的 Testing Decisions）。
 *
 * T-A 上游契约镜像：设计系统 token 真的进了产品，且没有被本仓偷偷改值。
 * T-B 旧名灭绝：旧方向的 token 名全仓 0 次，防「新代码新名、旧代码旧名」的双轨漂移。
 * T-C 骨架规则：0 圆角压制 / 2px ink 结构线 / 断点 900+1080 / reduce 收敛。
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
];

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
      const pattern = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`);
      assert.doesNotMatch(
        source,
        pattern,
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

// ─── T-D 渲染面：组件真的在消费新契约 ────────────────────────────────────────

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { StatusDot } = await jiti.import("../components/StatusDot.tsx");

test("T-D: StatusDot 四态渲染出在线/干活/出错/离线四个新语义 token", () => {
  const rendered = {};
  for (const status of ["online", "working", "error", "offline"]) {
    rendered[status] = renderToStaticMarkup(
      React.createElement(StatusDot, { status }),
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
