# 04 — 原语层与状态点/头像

**What to build:** 把上游 `ui_kits/app/app.css` 的原语 class 块搬进 `app/globals.css`：`.btn`（32px / `--surface` / `--border-strong`）/ `.btn-primary`（`--accent` 底 + 浅 ink，hover 换 `--accent-hover` 且两通道同时换）/ `.btn-ghost` / `.btn-danger` / `.btn-sm`（27px）/ `.btn:disabled{opacity:.45}` / `.icon-btn`（30px，透明边框，hover → `--surface` 填充 + `--border` 强化）/ `.is-on`（`--accent-soft` / `--accent`）/ `.badge` / `.tag` / `.input` / `.textarea` / `.select` / `.field` / `.card`（`--surface` + `--border` + `--r-md`；hover 强化边框 + `--shadow-card`）。`StatusDot.tsx` 改 `.presence.{online|working|error|offline}` 形态（7px 圆点、无 ink 边框、`working` 脉冲 1.5s 且 `reduce` 下 `animation:none`）。`PixelAvatar.tsx` 换 tile 外壳（`border-radius:7px`、`--av-0…--av-4` 按成员序号取色、「我」用 `--av-4`、去 2px ink 边框与硬阴影，`image-rendering:pixelated` 保留）。搬运 `.card` / `.field` / `.input` 等通用名前先 grep 一次本仓既有出现（ED-7）。

**Blocked by:** 02

**Status:** pending

- [ ] 原语 class 块落盘，`.btn-primary` hover 同时换底色与文字色通道（不降对比）
- [ ] 每个可聚焦元素有 `:focus-visible` 环；字段/composer 用 `--accent-soft` 环
- [ ] `StatusDot` 四态各取 `var(--online)` / `var(--working)` / `var(--error)` / `var(--offline)`；无 `2px solid`
- [ ] `PixelAvatar` tile 出现 7px 半径与 `--av-*` 取色；像素图案仍渲染；无 ink 边框/硬阴影
- [ ] 渲染断言：`StatusDot` 四态 + `PixelAvatar` tile（新增或扩既有 `components/*.test.mjs`）
- [ ] `npm test` / `tsc --noEmit` 通过；`npm run lint` 通过

## Answer
