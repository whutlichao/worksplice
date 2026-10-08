/**
 * 马卡龙色板的**对比度契约**（票 04；正本 `.scratch/macaron-palette/spec.md` 的
 * Solution 两张表 + Testing Decisions §1）。
 *
 * 这份文件把 spec 的「族 × 档位矩阵」「配对实测值」「淡底可见性」落成机械断言：
 * 以后谁把马卡龙亮档（fill）当文字色 / 焦点环 / 状态点用，或把 `-soft` 的配比调小
 * 到看不见，这里立刻红——字符串级断言（T-A/T-B/T-C）看不见这些。
 *
 * 口径（与 spec Testing Decisions §1 同）：
 *   相对亮度：sRGB 每通道 c ≤ 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4，
 *             L = 0.2126R + 0.7152G + 0.0722B，contrast = (L₁+0.05)/(L₂+0.05)。
 *   oklch → sRGB：Björn Ottosson 的 OKLab 标准矩阵（与 `colors_and_type.css` 的取值同源）。
 *   `-soft` 先按 `color-mix(in oklch, var(--<族>) <配比>%, transparent)` 解成
 *   「族色 + 透明度」（配比是契约的一部分，见下表的 ratio），再按 source-over 合成到
 *   给定纸张上；合成在 gamma sRGB 空间（CSS 的默认合成空间）——这套算式逐字复现了
 *   spec 登记的合成 sRGB 值（`#ffeef0` / `#fcf3d4` / `#ffefe3` …）与全部配对实测值
 *   （最大偏差 0.03，见 Answer 的校准小节）。
 *   ΔL：合成色与纸张各自的 OKLab L 之差 ×100（spec 写明「用 oklch 的 L 差即可」）。
 *
 * 阈值：文字 4.5:1；大字与图形边界（环 / 点 / 边界）3.0:1（ADR-0015 的 D6）。
 * 容差 ±0.05：spec 明写（「防浮点/取整抖动」），只作用于**比较**，不改阈值本身。
 *
 * ── 双向对照证据的运行方式（仅此一处环境钩子，默认关）──────────────────────
 * 设 `WORKSPLICE_CONTRAST_ROOT=<目录>` 时，本文件从该目录读
 * `<目录>/worksplice-design-system/colors_and_type.css` 与 `<目录>/app/globals.css`
 * 作为 token 来源，其余（配对表、阈值、容差、算式）一字不变。这是为了把**同一批
 * 断言**跑在 base `9ce948e` 的旧色值上，真实跑出红灯（见票 04 Answer 的「红 → 绿」
 * 小节）；默认运行（不设该变量）没有这条路径。
 * 旧色值时代还没有档位名（一族一值），因此历史运行下允许把「新增档位名」回落到该族
 * 当年的裸名（`--accent-deep` → `--accent`、`--agent-fill` 形态同理见 `HISTORICAL_ALIAS`）
 * ——目的是让同一条阈值断言以**实测值**失败（如 base 的 accent 作文字 on --panel-2 =
 * 4.16 < 4.5），而不是以「token 缺失」失败。回落表在默认运行下不生效。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import test from "node:test";

const EPS = 0.05;
const TEXT_MIN = 4.5;
const GRAPHIC_MIN = 3.0;
const SOFT_DL_MIN = 3.0;

const DEFAULT_ROOT = new URL("../", import.meta.url);
const HISTORICAL = process.env.WORKSPLICE_CONTRAST_ROOT;
const ROOT = HISTORICAL ? pathToFileURL(`${HISTORICAL}/`) : DEFAULT_ROOT;

const upstreamCss = await readFile(
  new URL("worksplice-design-system/colors_and_type.css", ROOT),
  "utf8",
);
const extensionCss = await readFile(new URL("app/globals.css", ROOT), "utf8");

// ─── 契约（spec 的族 × 档位矩阵；此处即断言数据） ─────────────────────────────

/** 纸张与墨族（spec Solution 的纸张族表）。 */
const PAPER = {
  "--bg": "oklch(98% 0.011 85)",
  "--surface": "oklch(99.4% 0.006 85)",
  "--panel": "oklch(95.7% 0.018 85)",
  "--panel-2": "oklch(93.1% 0.022 84)",
  "--fg": "oklch(33% 0.045 300)",
  "--muted": "oklch(46% 0.030 300)",
  "--faint": "oklch(52% 0.024 300)",
  "--border": "oklch(90% 0.013 86)",
  "--border-strong": "oklch(78% 0.020 86)",
  "--on-accent": "var(--fg)",
  "--av-0": "oklch(84.9% 0.081 299.9)",
  "--av-1": "oklch(80.8% 0.108 159.6)",
  "--av-2": "oklch(86.3% 0.084 52.2)",
  "--av-3": "oklch(91% 0.100 94.8)",
  "--av-4": "oklch(82.5% 0.026 303.4)",
};

/**
 * 八族 × 档位。`fillName` 是该族填充档的名字（也是 `-soft` 的合成基底），
 * `deepName` / `graphicName` 是文字档与环·点档的名字——按 D7「裸名 = 改判前的
 * 主用途档」：`--accent` / `--selected` / `--unread` / `--warn` 裸名即 fill；
 * `--online` / `--working` / `--offline` 裸名即 graphic；`--error` 裸名即 deep
 * （点与描边同值，不另立第二名字）。`ratio` 是 `-soft` 的契约配比（%, 勘误 2）。
 */
const FAMILIES = [
  { base: "--accent", fill: "oklch(85.7% 0.086 356.8)", deep: "oklch(53% 0.086 356.3)", graphic: "oklch(62.6% 0.086 356.7)", ratio: 22,
    fillName: "--accent", deepName: "--accent-deep", graphicName: "--accent-graphic", softName: "--accent-soft" },
  { base: "--selected", fill: "oklch(84.9% 0.081 299.9)", deep: "oklch(52.4% 0.081 299.8)", graphic: "oklch(62.4% 0.081 300.5)", ratio: 21,
    fillName: "--selected", deepName: "--selected-deep", graphicName: "--selected-graphic", softName: "--selected-soft" },
  { base: "--unread", fill: "oklch(91% 0.100 94.8)", deep: "oklch(51.8% 0.100 94.5)", graphic: "oklch(61.6% 0.099 94.7)", ratio: 36,
    fillName: "--unread", deepName: "--unread-deep", graphicName: "--unread-graphic", softName: "--unread-soft" },
  { base: "--warn", fill: "oklch(86.3% 0.084 52.2)", deep: "oklch(52.6% 0.084 51.9)", graphic: "oklch(62.1% 0.083 51.6)", ratio: 24,
    fillName: "--warn", deepName: "--warn-deep", graphicName: "--warn-graphic", softName: "--warn-soft" },
  { base: "--online", fill: "oklch(80.8% 0.108 159.6)", deep: "oklch(50.6% 0.107 159.9)", graphic: "oklch(60.1% 0.108 159.4)", ratio: 20,
    fillName: "--online-fill", deepName: "--online-text", graphicName: "--online", softName: "--online-soft" },
  { base: "--working", fill: "oklch(84.3% 0.110 74.6)", deep: "oklch(52.3% 0.110 75.2)", graphic: "oklch(61.9% 0.110 74.2)", ratio: 20,
    fillName: "--working-fill", deepName: "--working-text", graphicName: "--working", softName: "--working-soft" },
  { base: "--error", fill: "oklch(74.5% 0.127 25.8)", deep: "oklch(53.2% 0.128 25.9)", graphic: "oklch(53.2% 0.128 25.9)", ratio: 20,
    fillName: "--error-fill", deepName: "--error", graphicName: "--error", softName: "--error-soft" },
  { base: "--offline", fill: "oklch(82.5% 0.026 303.4)", deep: "oklch(51.8% 0.026 302.5)", graphic: "oklch(61.8% 0.026 304.2)", ratio: 20,
    fillName: "--offline-fill", deepName: "--offline-deep", graphicName: "--offline", softName: "--offline-soft" },
];

/** spec 的「填充 + 其上文字」配对实测值。 */
const FILL_ON_ACCENT = [
  ["--accent", 7.75], ["--selected", 7.64], ["--unread", 9.52], ["--warn", 8.01],
  ["--online-fill", 7.14], ["--working-fill", 7.57], ["--error-fill", 5.19],
  ["--offline-fill", 7.18], ["--accent-hover", 6.21],
];

/**
 * spec 的「文字 on 纸张」实测值（列 = --bg / --surface / --panel / --panel-2）。
 * 取值口径 = **oklch**（spec 陷阱 5：契约值是 oklch，sRGB 列只是近似，冲突时以 oklch 为准），
 * 逐字采用票 02 Answer 的复测值——本文件的算式与它逐字一致（见文件头的校准说明）。
 * 唯一与 spec 表格不同的单元格：`--muted on --surface`（spec 列 7.13 系从取整后的
 * sRGB 近似列导出；oklch 口径实测 7.079，票 02 复测 7.08）。
 */
const TEXT_ON_PAPER = [
  ["--fg", [11.71, 12.19, 10.94, 10.12]],
  ["--muted", [6.80, 7.08, 6.35, 5.88]],
  ["--faint", [5.24, 5.46, 4.90, 4.53]],
];
const PAPERS = ["--bg", "--surface", "--panel", "--panel-2"];

/** spec 的「--fg 落在每格头像 tile 上」实测值。 */
const FG_ON_AVATAR = [[7.64], [7.14], [8.01], [9.52], [7.18]];

/** ticket 02 Answer 的「四态作点 on --surface」实测值（spec 的对照表同源）。 */
const DOT_ON_SURFACE = [["--online", 3.67], ["--working", 3.66], ["--error", 5.48], ["--offline", 3.64]];

// ─── 解析 ─────────────────────────────────────────────────────────────────────

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

// 上游先声明、扩展层后声明（与 `app/globals.css` 的 @import 顺序一致）。
const TOKENS = new Map([
  ...extractRootDecls(upstreamCss),
  ...extractRootDecls(extensionCss),
]);

/**
 * 历史回落表（只在 `WORKSPLICE_CONTRAST_ROOT` 生效）：base 时代一族一值，契约里
 * 「新增的档位名」在 base 不存在，此时回落到该族当年的裸名。默认运行下是恒等映射。
 */
const HISTORICAL_ALIAS = {
  "--accent-deep": "--accent",
  "--accent-graphic": "--accent",
  "--offline-deep": "--offline",
  "--online-fill": "--online",
  "--working-fill": "--working",
  "--error-fill": "--error",
  "--offline-fill": "--offline",
  "--accent-soft": "--accent-soft",
};

function resolveName(name) {
  if (TOKENS.has(name)) return name;
  if (!HISTORICAL) return name;
  const alias = HISTORICAL_ALIAS[name] ?? (/^--[a-z0-9-]+-(fill|graphic|deep)$/.test(name) ? name.replace(/-(fill|graphic|deep)$/, "") : name);
  return TOKENS.has(alias) ? alias : name;
}

function token(name) {
  const value = TOKENS.get(resolveName(name));
  assert.ok(value !== undefined, `缺少 token ${name}（resolve → ${resolveName(name)}）`);
  return value;
}

// ─── 色彩数学（~40 行纯函数，spec Testing Decisions §1） ───────────────────────

function parseOklch(value) {
  const m = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
  assert.ok(m, `不是 oklch 字面量：${value}`);
  return { L: Number(m[1]) / 100, C: Number(m[2]), H: Number(m[3]) };
}

/** oklch → 线性 sRGB（OKLab 标准矩阵；溢出通道按 CSS 的 gamut 行为夹到 [0,1]）。 */
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
const decodeGamma = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function toGamma(linear) {
  return { r: encodeGamma(linear.r), g: encodeGamma(linear.g), b: encodeGamma(linear.b) };
}

function relativeLuminance(rgb) {
  return 0.2126 * decodeGamma(rgb.r) + 0.7152 * decodeGamma(rgb.g) + 0.0722 * decodeGamma(rgb.b);
}

function contrast(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** source-over 合成（gamma sRGB 空间，CSS 的默认合成空间）。 */
function over(fg, alpha, bg) {
  return {
    r: fg.r * alpha + bg.r * (1 - alpha),
    g: fg.g * alpha + bg.g * (1 - alpha),
    b: fg.b * alpha + bg.b * (1 - alpha),
  };
}

/** sRGB(gamma) → OKLab L（ΔL 判据用；spec 明写「用 oklch 的 L 差即可」）。 */
function oklabL(rgb) {
  const r = decodeGamma(rgb.r);
  const g = decodeGamma(rgb.g);
  const b = decodeGamma(rgb.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

/** 不透明色的 gamma sRGB（`var()` 引用自身解析）。 */
function solid(name, depth = 0) {
  const value = token(name);
  assert.ok(depth <= 4, `var() 引用成环：${name}`);
  const ref = /^var\((--[a-zA-Z0-9-]+)\)$/.exec(value);
  if (ref) return solid(ref[1], depth + 1);
  return toGamma(oklchToLinearSrgb(parseOklch(value)));
}

/**
 * `-soft` 的合成结果：族色 + 契约配比透明度，压到给定纸张上。
 * 返回 { value, ratio, base, composite }。
 */
function softOver(softName, paperName) {
  const value = token(softName);
  const m = /^color-mix\(in oklch, var\((--[a-zA-Z0-9-]+)\) ([\d.]+)%, transparent\)$/.exec(value);
  assert.ok(m, `${softName} 必须是按契约配比的 color-mix 淡底，实际是：${value}`);
  const composite = over(solid(m[1]), Number(m[2]) / 100, solid(paperName));
  return { value, ratio: Number(m[2]), base: m[1], composite, paper: solid(paperName) };
}

/** spec 的表格值口径：两位小数比较，容差 ±0.05。 */
function checkTable(actual, tabulated, label, violations) {
  if (Math.abs(actual - tabulated) > EPS) {
    violations.push(`  ${label}：实测 ${actual.toFixed(3)} vs 表值 ${tabulated.toFixed(2)}`);
  }
}

function checkAtLeast(actual, min, label, violations) {
  if (actual < min - EPS) {
    violations.push(`  ${label}：实测 ${actual.toFixed(3)} < 阈值 ${min}`);
  }
}

/** 逐项跑检查；单项里缺 token 只记一处不达标，不吞掉其余项（历史运行下尤其重要）。 */
function each(items, violations, body) {
  for (const item of items) {
    try {
      body(item);
    } catch (error) {
      violations.push(`  ${String(error.message).split("\n")[0]}`);
    }
  }
}

/** 一个用例内的逐对检查全部跑完再判红——失败信息一次列全，便于定位与留证。 */
function collect(scope, body) {
  const violations = [];
  try {
    body(violations);
  } catch (error) {
    // 缺 token（历史运行下的档位名）也算一处不达标，并把原因原样带出来。
    violations.push(`  ${String(error.message).split("\n")[0]}`);
  }
  assert.equal(
    violations.length,
    0,
    `\n${scope}：${violations.length} 处不达标\n${violations.join("\n")}`,
  );
}

// ─── 1. 族 × 档位矩阵（值的机械断言） ──────────────────────────────────────────

test("契约矩阵：纸张与墨族的 15 个值逐字", () => {
  for (const [name, value] of Object.entries(PAPER)) {
    assert.equal(token(name), value, `${name} 与契约值不一致`);
  }
});

test("契约矩阵：八族的 fill / soft 配方 / deep / graphic 逐字且配比是契约值", () => {
  for (const family of FAMILIES) {
    const label = `${family.base} 族`;
    assert.equal(token(family.fillName), family.fill, `${label} fill`);
    assert.equal(token(family.deepName), family.deep, `${label} deep`);
    assert.equal(token(family.graphicName), family.graphic, `${label} graphic`);
    const soft = softOver(family.softName, "--surface");
    assert.equal(
      soft.value,
      `color-mix(in oklch, var(${family.fillName}) ${family.ratio}%, transparent)`,
      `${label} soft 的配方 / 配比（勘误 2 定的 ${family.ratio}%）`,
    );
    assert.equal(soft.base, family.fillName, `${label} soft 必须以自家填充档为基底`);
  }
});

// ─── 2. spec 的配对实测值 + 阈值 ──────────────────────────────────────────────

test("文字 on 纸张：≥4.5 且与 spec 表值一致（±0.05）", () => {
  collect("文字 on 纸张", (violations) => {
    for (const [fg, row] of TEXT_ON_PAPER) {
      PAPERS.forEach((bg, i) => {
        const actual = contrast(solid(fg), solid(bg));
        const label = `${fg} on ${bg}`;
        checkAtLeast(actual, TEXT_MIN, label, violations);
        checkTable(actual, row[i], label, violations);
      });
    }
  });
});

test("填充 + --on-accent：≥4.5 且与 spec 表值一致（±0.05）", () => {
  collect("填充 + --on-accent", (violations) => {
    for (const [fill, tabulated] of FILL_ON_ACCENT) {
      const actual = contrast(solid("--on-accent"), solid(fill));
      const label = `${fill} + --on-accent`;
      checkAtLeast(actual, TEXT_MIN, label, violations);
      checkTable(actual, tabulated, label, violations);
    }
  });
});

test("各族文字档 on 两档纸张（--bg / 最暗的 --panel-2）：≥4.5", () => {
  collect("各族文字档 on 两档纸张", (violations) => {
    each(FAMILIES, violations, (family) => {
      for (const paper of ["--bg", "--panel-2"]) {
        checkAtLeast(
          contrast(solid(family.deepName), solid(paper)),
          TEXT_MIN,
          `${family.deepName} on ${paper}`,
          violations,
        );
      }
    });
  });
});

test("各族文字档 on 自家淡底（选中 chip 的成对性）：≥4.5", () => {
  collect("各族文字档 on 自家淡底", (violations) => {
    each(FAMILIES, violations, (family) => {
      const soft = softOver(family.softName, "--surface");
      checkAtLeast(
        contrast(solid(family.deepName), soft.composite),
        TEXT_MIN,
        `${family.deepName} on ${family.softName}(over --surface)`,
        violations,
      );
    });
  });
});

test("各族图形档 on 两档纸张：≥3.0（焦点环 / 状态点 / 边界的下限）", () => {
  collect("各族图形档 on 两档纸张", (violations) => {
    each(FAMILIES, violations, (family) => {
      for (const paper of ["--bg", "--panel-2"]) {
        checkAtLeast(
          contrast(solid(family.graphicName), solid(paper)),
          GRAPHIC_MIN,
          `${family.graphicName} on ${paper}`,
          violations,
        );
      }
    });
  });
});

test("各族图形档 on 自家淡底（选中 chip 的边界）：≥3.0", () => {
  collect("各族图形档 on 自家淡底", (violations) => {
    each(FAMILIES, violations, (family) => {
      const soft = softOver(family.softName, "--surface");
      checkAtLeast(
        contrast(solid(family.graphicName), soft.composite),
        GRAPHIC_MIN,
        `${family.graphicName} on ${family.softName}(over --surface)`,
        violations,
      );
    });
  });
});

test("--fg 落在头像五格上：≥4.5 且与 spec 表值一致（±0.05）", () => {
  collect("--fg on 头像五格", (violations) => {
    for (let i = 0; i < 5; i += 1) {
      const actual = contrast(solid("--fg"), solid(`--av-${i}`));
      const label = `--fg on --av-${i}`;
      checkAtLeast(actual, TEXT_MIN, label, violations);
      checkTable(actual, FG_ON_AVATAR[i][0], label, violations);
    }
  });
});

test("四态作点 on --surface：≥3.0 且与票 02 / spec 对照表的实测值一致（±0.05）", () => {
  collect("四态作点 on --surface", (violations) => {
    for (const [name, tabulated] of DOT_ON_SURFACE) {
      const actual = contrast(solid(name), solid("--surface"));
      const label = `${name} on --surface`;
      checkAtLeast(actual, GRAPHIC_MIN, label, violations);
      checkTable(actual, tabulated, label, violations);
    }
  });
});

// ─── 3. 淡底可见性（本 effort 自定判据） ──────────────────────────────────────

test("每个族的淡底在 --surface 上的 ΔL ≥ 3.0（看不见的 tint 不算 tint）", () => {
  collect("淡底可见性 ΔL", (violations) => {
    each(FAMILIES, violations, (family) => {
      const surface = solid("--surface");
      const soft = softOver(family.softName, "--surface");
      const deltaL = (oklabL(surface) - oklabL(soft.composite)) * 100;
      if (deltaL < SOFT_DL_MIN - EPS) {
        violations.push(`  ${family.softName}：ΔL ${deltaL.toFixed(2)} < ${SOFT_DL_MIN}`);
      }
    });
  });
});

// ─── 4. 退役与不重复（票 04 的机械判据） ─────────────────────────────────────

test("--accent-line 已退役、--error 不立 graphic 第二名字", () => {
  assert.equal(
    TOKENS.has("--accent-line"),
    false,
    "--accent-line 应已删除（退役，边界一律取各族 graphic 档）",
  );
  assert.equal(
    TOKENS.has("--error-graphic"),
    false,
    "--error 的 deep 与 graphic 同值，按 D7 不立第二名字",
  );
});
