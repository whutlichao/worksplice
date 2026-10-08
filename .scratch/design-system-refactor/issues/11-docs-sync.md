# 11 — 文档同步

**What to build:** 让文档与代码同时回到同一个方向。`docs/spec.md` §4 整节（12 色板 / 0 圆角 / 2px ink / 硬阴影阶梯 / 三字体 / 像素头像，逐条 `[锁定] 02`）按 `worksplice-design-system/` 的契约改写，§4.5「沿用 pi-web 的主题基建（tailwind 配置 + CSS 变量）**[锁定] 04**」改用 D4 的裁决（Tailwind 已删）。`AGENTS.md` 的 CSS 变量段（`--bg --bg-panel --bg-hover --bg-selected --border --text --text-muted --text-dim --accent --user-bg --tool-bg --font-mono`）换成新契约名；File Map 与关键决策段里描述「马卡龙 × brutalist」「0 圆角」「2px ink 边框」「硬偏移阴影」「像素头像取色」「三个字体」的措辞逐处改写；`.scratch/worksplice-build/issues/03` 的视觉部分**不改**（它记录的是历史裁决，推翻事实已在 ADR-0014 的 `Supersedes` 留痕）。`CONTEXT.md` 只核对票 01 已落的「视觉契约」词条。

**Blocked by:** 03, 04, 05, 06, 07, 08, 09, 10

**Status:** pending

- [ ] `docs/spec.md` §4 不再出现 `#ffd440` / `#fe7da8` / `#fffaef` / `0 圆角` / `2px ink` / `[锁定] 02` / Space Grotesk
- [ ] `docs/spec.md` §4.5 不再说「沿用 pi-web 的主题基建（tailwind 配置 + CSS 变量）」
- [ ] `AGENTS.md` 的 CSS 变量段列出的是新契约名（`--bg` / `--surface` / `--panel` / `--panel-2` / `--fg` / `--muted` / `--faint` / `--border` / `--border-strong` / `--accent` / `--accent-hover` / `--accent-soft` / `--accent-line` / `--online` / `--working` / `--error` / `--offline` / `--av-0…--av-4` / `--font` / `--mono` / `--shadow-card` / `--shadow-pop` / `--shadow-composer` / `--r-*` / `--sp-*`）
- [ ] `AGENTS.md` 的 File Map 与决策段里视觉措辞与产品一致；「UI 图标规则（lucide 优先）」段保留不动
- [ ] `docs/adr/0014-visual-direction-modern-minimal.md` 的 `Status` 仍为 `accepted`（无需改动，仅核对）
- [ ] 文档正文中文（AGENTS.md 的 Language 段）
- [ ] `npm test` / `tsc --noEmit` 通过；T-C 的文档一致性扩展断言绿

## Answer
