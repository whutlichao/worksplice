# 02 — token 契约与地基

**What to build:** 把 `modern-minimal` 契约接进产品，并拆掉旧方向的整套骨架规则。具体：`app/globals.css` 顶部改 `@import "../../worksplice-design-system/colors_and_type.css"` + `…/tokens.css`；搬 `ui_kits/app/app.css` 的 reset 段（含 `:focus-visible { outline:2px solid var(--accent); outline-offset:2px }` 与 composer/字段的 `0 0 0 3px var(--accent-soft)` 环）；删 Tailwind（`@import "tailwindcss"` / `@theme` 块 / `postcss.config.mjs` 的插件 / `tailwind.config.ts` / 两个 devDependency）并把 2 处实用工具类（`components/MarkdownBody.tsx` 的 `text-xs px-2 py-1`、`components/ChannelView.tsx` 的 `overflow-x-hidden overflow-y-auto`）改成普通 class 或 inline style；`app/layout.tsx` 退掉三个 `next/font`、`viewport.themeColor` 改新值；断点常量（≤900 抽屉 / ≤1080 dock）；全仓按 spec 的映射表替换旧 token 名（含 `--border` 的 168 处逐处重写宽度与颜色、`--bg-selected` 的 fill+fg 成对改、`--yellow`/`--pink` 按调用点语义分流）；无对应的四个（`--user-bg` / `--assistant-bg` / `--tool-bg` / `--bg-subtle`）由扩展层重定义；解开全局 `* { border-radius: 0 !important }`。

**Blocked by:** 无

**Status:** pending

- [ ] `app/globals.css` 顶部出现两条 `@import`，指向 `worksplice-design-system/` 的 token 文件
- [ ] 旧 token 名全仓出现 0 次（spec T-B 的枚举集；`--border` / `--bg` / `--accent` / `--accent-hover` / `--font-mono` 是同名保留项，不在集内）
- [ ] 不再有 `border-radius: 0 !important`、不再有 `2px solid`、不再有取 `var(--ink)` 的阴影
- [ ] `package.json` 无 `tailwindcss` / `@tailwindcss/postcss`；`tailwind.config.ts` 已删；`postcss.config.mjs` 无 Tailwind 插件
- [ ] `app/layout.tsx` 无 `next/font`；字体角色走 `--font` / `--mono`
- [ ] 存在 `@media (max-width: 900px)` 与 `@media (max-width: 1080px)`；不存在 `@media (max-width: 960px)`
- [ ] `@media (prefers-reduced-motion: reduce)` 存在，且 `@keyframes` 组数不减（12 组）
- [ ] 新增 `app/globals.test.mjs` 落 T-A（上游契约镜像断言）+ T-B（旧名灭绝）+ T-C（骨架规则）
- [ ] `components/MobilePwaLayout.test.mjs` 的 4 条护栏断言仍全绿（若某条必须改，理由写进本 Answer）
- [ ] `node_modules/.bin/tsc --noEmit` 通过；`npm test` 通过；`git diff --numstat` 无整文件重写

## Answer
