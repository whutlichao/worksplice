/**
 * 原语 class 块的落盘断言（票 04，spec D7 的第一层）。
 *
 * 病根：这些 class 块搬自上游 `worksplice-design-system/ui_kits/app/app.css`，但本仓的
 * 可观察面是「组件渲染出的 markup + globals.css 的 class 块」两半——组件只写 class 名，
 * 形态全在 CSS。所以断在 globals.css 的**规则体**上（源码级 seam，与
 * components/MobilePwaLayout.test.mjs / app/globals.test.mjs 同档），而不是断一个字符串计数。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const globalsCss = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

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

// ─── buttons ─────────────────────────────────────────────────────────────────

test("原语 .btn：32px / --surface / --border-strong / --r-md", () => {
  const body = blockBody(".btn");
  assert.match(body, /height:\s*var\(--control-h\)/);
  assert.match(body, /background:\s*var\(--surface\)/);
  assert.match(body, /border:\s*1px solid var\(--border-strong\)/);
  assert.match(body, /border-radius:\s*var\(--r-md\)/);
  assert.match(body, /color:\s*var\(--fg\)/);
});

test("原语 .btn-primary：accent 实底 + --on-accent 深墨，hover 两个通道一起换（不降对比）", () => {
  const body = blockBody(".btn-primary");
  assert.match(body, /background:\s*var\(--accent\)/);
  // 票 03：填充档上的字从 `oklch(99% .01 256)` 浅墨改为 `var(--on-accent)`（深梅墨）——
  // 马卡龙亮档 + 白字只有 1.4:1；深墨 7.74:1。判据（填充 + 其上文字达 AA）不变。
  assert.match(body, /color:\s*var\(--on-accent\)/);

  const hover = blockBody(".btn-primary:hover");
  assert.match(hover, /background:\s*var\(--accent-hover\)/);
  assert.match(hover, /border-color:\s*var\(--accent-hover\)/);
  assert.match(hover, /color:\s*var\(--on-accent\)/);
});

test("原语 .btn-ghost / .btn-danger / .btn-sm / .btn:disabled", () => {
  assert.match(blockBody(".btn-ghost"), /background:\s*transparent/);
  assert.match(blockBody(".btn-ghost:hover"), /color:\s*var\(--fg\)/);
  assert.match(blockBody(".btn-danger"), /color:\s*var\(--error\)/);
  assert.match(blockBody(".btn-danger:hover"), /border-color:\s*var\(--error\)/);
  assert.match(blockBody(".btn-sm"), /height:\s*var\(--control-h-sm\)/);
  assert.match(blockBody(".btn:disabled"), /opacity:\s*\.45/);
});

test("原语 .btn:hover 不把文字推向 --muted（ED-7）", () => {
  assert.doesNotMatch(blockBody(".btn:hover"), /color:\s*var\(--muted\)/);
});

// ─── icon button ─────────────────────────────────────────────────────────────

test("原语 .icon-btn：30px 透明边框，hover 换 --surface + --border，.is-on 走 accent-soft/accent", () => {
  const body = blockBody(".icon-btn");
  assert.match(body, /width:\s*var\(--icon-btn\)/);
  assert.match(body, /border:\s*1px solid transparent/);

  const hover = blockBody(".icon-btn:hover");
  assert.match(hover, /background:\s*var\(--surface\)/);
  assert.match(hover, /border-color:\s*var\(--border\)/);
  assert.match(hover, /color:\s*var\(--fg\)/);

  const on = blockBody(".icon-btn.is-on");
  assert.match(on, /background:\s*var\(--accent-soft\)/);
  // 文字走文字档（票 03）：填充保持不变，只把不可读的填充档字改成 --accent-deep。
  assert.match(on, /color:\s*var\(--accent-deep\)/);
});

// ─── badge / fields / card ───────────────────────────────────────────────────

test("原语 .badge：pill + 未读族实底", () => {
  const body = blockBody(".badge");
  assert.match(body, /border-radius:\s*var\(--r-pill\)/);
  // 票 03：未读角标从「借 --accent」改为未读族（D3：未读是注意力信号，与行动不同族）；
  // 判据（实底 + 深墨达 AA，9.52:1）不变。
  assert.match(body, /background:\s*var\(--unread\)/);
});

test("原语 .input / .textarea / .select / .field：发丝边框 + r-md（焦点环在 reset 段）", () => {
  const body = blockBody(".input, .textarea, .select");
  assert.match(body, /border:\s*1px solid var\(--border-strong\)/);
  assert.match(body, /border-radius:\s*var\(--r-md\)/);
  assert.match(body, /background:\s*var\(--surface\)/);

  assert.match(blockBody(".textarea"), /resize:\s*vertical/);
  assert.match(blockBody(".field"), /margin-bottom:/);
  assert.match(blockBody(".field .hint"), /color:\s*var\(--faint\)/);
});

test("原语 .card：--surface + --border + --r-md；hover 强化边框 + --shadow-card", () => {
  const body = blockBody(".card");
  assert.match(body, /background:\s*var\(--surface\)/);
  assert.match(body, /border:\s*1px solid var\(--border\)/);
  assert.match(body, /border-radius:\s*var\(--r-md\)/);

  const hover = blockBody(".card:hover");
  assert.match(hover, /border-color:\s*var\(--border-strong\)/);
  assert.match(hover, /box-shadow:\s*var\(--shadow-card\)/);
});

// ─── presence / avatar ───────────────────────────────────────────────────────

test("原语 .presence：7px 圆点、无 ink 边框、四态 token、working 脉冲 1.5s", () => {
  const body = blockBody(".presence");
  assert.match(body, /width:\s*7px/);
  assert.match(body, /height:\s*7px/);
  assert.match(body, /border-radius:\s*var\(--r-pill\)/);
  assert.doesNotMatch(body, /border:\s*\d+px/);

  assert.match(blockBody(".presence.online"), /background:\s*var\(--online\)/);
  assert.match(blockBody(".presence.working"), /background:\s*var\(--working\)/);
  assert.match(blockBody(".presence.error"), /background:\s*var\(--error\)/);
  assert.match(blockBody(".presence.offline"), /background:\s*var\(--offline\)/);

  assert.match(blockBody(".presence.working"), /animation:\s*pulse 1\.5s/);
  // 波形取上游 app.css 的同名 keyframe（50% 处 0.3），不是旧内联动画的 0.5。
  assert.match(globalsCss, /@keyframes\s+pulse\s*\{[\s\S]*?50%\s*\{\s*opacity:\s*0?\.3;/);
  assert.match(
    globalsCss,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.presence\.working\s*\{\s*animation:\s*none/,
  );
});

test("原语 .avatar：三档尺寸取自 --avatar-sm|md|lg、7px 圆角（.lg 用 --r-md）、无像素槽位", () => {
  const body = blockBody(".avatar");
  assert.match(body, /width:\s*var\(--avatar-md\)/);
  assert.match(body, /height:\s*var\(--avatar-md\)/);
  assert.match(body, /border-radius:\s*7px/);
  assert.match(body, /display:\s*grid/);
  assert.match(body, /place-items:\s*center/);
  assert.match(body, /font-weight:\s*var\(--fw-black\)/);
  assert.match(body, /color:\s*var\(--fg\)/);
  assert.match(body, /overflow:\s*hidden/);

  const sm = blockBody(".avatar.sm");
  assert.match(sm, /width:\s*var\(--avatar-sm\)/);
  assert.match(sm, /font-size:\s*10px/);

  const lg = blockBody(".avatar.lg");
  assert.match(lg, /width:\s*var\(--avatar-lg\)/);
  assert.match(lg, /font-size:\s*16px/);
  assert.match(lg, /border-radius:\s*var\(--r-md\)/);
});

test("原语 .av-0…--av-4：五格 tint 逐字搬自上游，各格绑自己的 token", () => {
  for (let tint = 0; tint < 5; tint += 1) {
    assert.match(
      blockBody(`.av-${tint}`),
      new RegExp(`background:\\s*var\\(--av-${tint}\\)`),
      `.av-${tint} 未绑 --av-${tint}`,
    );
  }
});

test("像素头像的槽位整体退场（globals.css 里不再有 image-rendering / .pixelated 的规则）", () => {
  // 注释里允许提它（搬迁说明要写清哪条槽位被踩掉），所以先剥注释再看规则。
  const css = globalsCss.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /image-rendering/);
  assert.doesNotMatch(css, /\.pixelated\b/);
});
