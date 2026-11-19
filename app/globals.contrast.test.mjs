/**
 * 校样色板的**对比度契约**（Press Okay 重设计）。
 *
 * 这份文件把当前色板的「档位 × 配对」落成机械断言，阈值不变：
 *   正文 / 界面文案 4.5:1；图形边界（焦点环 / 状态点 / 边界）3.0:1。
 * 口径：
 *   相对亮度：sRGB 每通道 c ≤ 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4，
 *             L = 0.2126R + 0.7152G + 0.0722B，contrast = (L₁+0.05)/(L₂+0.05)。
 *   oklch → sRGB：OKLab 标准矩阵（与 `colors_and_type.css` 的取值同源）。
 *
 * 档位契约（本仓）：
 *   fill    = 淡印面，压 **墨**（--fg）
 *   deep    = 文字档，压纸（≥4.5 on 四种纸）
 *   solid   = 同族 deep 作底，压 **纸白**（--on-accent）
 *   graphic = 环·点档，压 --surface ≥3.0
 *   soft    = 淡底，合成后与纸面的 ΔL ≥3.0（看得见）
 *   `--accent` 是墨族：它的 fill = deep = graphic = 墨，压在它上面的是纸白。
 *
 * 容差 ±0.05 只作用于比较，不改阈值本身。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const EPS = 0.05;
const TEXT_MIN = 4.5;
const GRAPHIC_MIN = 3.0;
const SOFT_DL_MIN = 3.0;

const ROOT = new URL("../", import.meta.url);

const upstreamCss = await readFile(
  new URL("worksplice-design-system/colors_and_type.css", ROOT),
  "utf8",
);
const extensionCss = await readFile(new URL("app/globals.css", ROOT), "utf8");

/** 抽 `:root {}` 块里的 `--<名>: <值>;`（与 `app/globals.test.mjs` 的 T-A 同口径）。 */
function extractRootDecls(css) {
  const decls = new Map();
  for (const block of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const decl of block[1].matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) {
      decls.set(decl[1], decl[2].replace(/\s+/g, " ").trim());
    }
  }
  return decls;
}

const TOKENS = new Map([
  ...extractRootDecls(upstreamCss),
  ...extractRootDecls(extensionCss),
]);

function token(name) {
  const value = TOKENS.get(name);
  assert.ok(value !== undefined, `缺少 token ${name}`);
  return value;
}

// ─── 色彩数学 ─────────────────────────────────────────────────────────────────

function parseOklch(value) {
  const m = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
  assert.ok(m, `不是 oklch 字面量：${value}`);
  return { L: Number(m[1]) / 100, C: Number(m[2]), H: Number(m[3]) };
}

function oklchToLinearSrgb({ L, C, H }) {
  const rad = (H * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const b = C * Math.sin(rad);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (v) => Math.min(1, Math.max(0, v));
  return {
    r: clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

const encodeGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function toSrgb(value) {
  const lin = oklchToLinearSrgb(parseOklch(value));
  return { r: encodeGamma(lin.r), g: encodeGamma(lin.g), b: encodeGamma(lin.b) };
}

const decodeGamma = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

const luminance = (srgb) =>
  0.2126 * decodeGamma(srgb.r) +
  0.7152 * decodeGamma(srgb.g) +
  0.0722 * decodeGamma(srgb.b);

function contrast(a, b) {
  const l1 = luminance(toSrgb(a));
  const l2 = luminance(toSrgb(b));
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** 合成后的 OKLab 亮度 L（0–1）：sRGB source-over 后转 OKLab。 */
function compositeL(fill, paper, alpha) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const f = toSrgb(fill);
  const p = toSrgb(paper);
  const out = {
    r: alpha * lin(f.r) + (1 - alpha) * lin(p.r),
    g: alpha * lin(f.g) + (1 - alpha) * lin(p.g),
    b: alpha * lin(f.b) + (1 - alpha) * lin(p.b),
  };
  const l = Math.cbrt(0.4122214708 * out.r + 0.5363325363 * out.g + 0.0514459929 * out.b);
  const m = Math.cbrt(0.2119034982 * out.r + 0.6806995451 * out.g + 0.1073969566 * out.b);
  const s = Math.cbrt(0.0883024619 * out.r + 0.2817188376 * out.g + 0.6299787005 * out.b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

// ─── 契约 ─────────────────────────────────────────────────────────────────────

const PAPERS = ["--bg", "--surface", "--panel", "--panel-2"];
const TEXT_TOKENS = ["--fg", "--muted", "--faint"];

/** 七族 × 档位（--accent 单独作为墨族处理）。 */
const FAMILIES = [
  { base: "--selected", fill: "--selected", deep: "--selected-deep", graphic: "--selected-graphic", soft: "--selected-soft", ratio: 0.22 },
  { base: "--unread", fill: "--unread", deep: "--unread-deep", graphic: "--unread-graphic", soft: "--unread-soft", ratio: 0.26 },
  { base: "--warn", fill: "--warn", deep: "--warn-deep", graphic: "--warn-graphic", soft: "--warn-soft", ratio: 0.3 },
  { base: "--online", fill: "--online-fill", deep: "--online-text", graphic: "--online", soft: "--online-soft", ratio: 0.28 },
  { base: "--working", fill: "--working-fill", deep: "--working-text", graphic: "--working", soft: "--working-soft", ratio: 0.28 },
  { base: "--error", fill: "--error-fill", deep: "--error", graphic: "--error", soft: "--error-soft", ratio: 0.28 },
  { base: "--offline", fill: "--offline-fill", deep: "--offline-deep", graphic: "--offline", soft: "--offline-soft", ratio: 0.28 },
];

test("纸张与墨：fg / muted / faint 在四种纸上都 ≥4.5:1", () => {
  for (const text of TEXT_TOKENS) {
    for (const paper of PAPERS) {
      const ratio = contrast(token(text), token(paper));
      assert.ok(
        ratio >= TEXT_MIN - EPS,
        `${text} on ${paper} = ${ratio.toFixed(2)} < ${TEXT_MIN}`,
      );
    }
  }
});

test("墨族动作面：--on-accent 压在 --accent 上 ≥4.5:1", () => {
  const ratio = contrast(token("--accent"), token("--on-accent"));
  assert.ok(ratio >= TEXT_MIN - EPS, `accent solid = ${ratio.toFixed(2)}`);
});

test("每族淡印面压得住墨（fill + --fg ≥4.5:1）", () => {
  for (const { base, fill } of FAMILIES) {
    const ratio = contrast(token(fill), token("--fg"));
    assert.ok(ratio >= TEXT_MIN - EPS, `${base}.fill + fg = ${ratio.toFixed(2)}`);
  }
});

test("每族实印面压得住纸白（deep + --on-accent ≥4.5:1）", () => {
  for (const { base, deep } of FAMILIES) {
    const ratio = contrast(token(deep), token("--on-accent"));
    assert.ok(ratio >= TEXT_MIN - EPS, `${base}.deep + on-accent = ${ratio.toFixed(2)}`);
  }
});

test("每族文字档在四种纸上都 ≥4.5:1", () => {
  for (const { base, deep } of FAMILIES) {
    for (const paper of PAPERS) {
      const ratio = contrast(token(deep), token(paper));
      assert.ok(ratio >= TEXT_MIN - EPS, `${base}.deep on ${paper} = ${ratio.toFixed(2)}`);
    }
  }
});

test("每族环·点档在 --surface 上 ≥3.0:1", () => {
  for (const { base, graphic } of FAMILIES) {
    const ratio = contrast(token(graphic), token("--surface"));
    assert.ok(ratio >= GRAPHIC_MIN - EPS, `${base}.graphic on surface = ${ratio.toFixed(2)}`);
  }
});

test("头像五格：墨压在每一格上 ≥4.5:1", () => {
  for (let i = 0; i < 5; i += 1) {
    const ratio = contrast(token("--fg"), token(`--av-${i}`));
    assert.ok(ratio >= TEXT_MIN - EPS, `av-${i} + fg = ${ratio.toFixed(2)}`);
  }
});

test("soft 淡底看得见：合成后与纸面 ΔL ≥3.0", () => {
  for (const { base, soft, ratio } of FAMILIES) {
    const decl = token(soft);
    assert.match(
      decl,
      /^color-mix\(in oklch, var\(--[\w-]+\) \d+%, transparent\)$/,
      `${soft} 形态`,
    );
    const pctMatch = /\d+(?=%, transparent\))/.exec(decl);
    assert.ok(pctMatch, `${soft} 配比可读`);
    const pct = Number(pctMatch[0]);
    assert.ok(
      Math.abs(pct / 100 - ratio) <= 0.005,
      `${soft} 配比 ${pct}% 与契约 ${(ratio * 100).toFixed(0)}% 不符`,
    );
    const baseToken = /var\((--[\w-]+)\)/.exec(decl)[1];
    const dl =
      Math.abs(
        compositeL(token(baseToken), token("--surface"), pct / 100) -
          compositeL(token("--surface"), token("--surface"), 1),
      ) * 100;
    assert.ok(dl >= SOFT_DL_MIN - 0.5, `${base} soft ΔL = ${dl.toFixed(2)} < ${SOFT_DL_MIN}`);
  }
});
