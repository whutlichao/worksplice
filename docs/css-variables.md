# CSS Variables（`app/globals.css` 的 `@import` 链）

设计系统即运行时真源：`worksplice-design-system/colors_and_type.css`（色 + 字型、
按**角色族 × 档位**组织，ADR-0015）与 `tokens.css`（间距 / 圆角 / 高度 / 阴影 /
动效 / z-index）由 `app/globals.css` 顶层 `@import` 进来；本仓只叠扩展层
（三个产品角色族 + `--font-mono`），**不复制上游同名 token**。

```
纸族   --bg --surface --panel --panel-2 --border --border-strong
墨族   --fg --muted --faint --fg-soft --on-accent
行动   --accent --accent-hover --accent-soft --accent-deep --accent-graphic
选中   --selected --selected-soft --selected-deep --selected-graphic     （扩展层）
未读   --unread --unread-soft --unread-deep --unread-graphic             （扩展层）
警示   --warn --warn-soft --warn-deep --warn-graphic                     （扩展层）
状态   --online --working --error --offline
       --online-fill --working-fill --error-fill --offline-fill
       --online-soft --working-soft --error-soft --offline-soft
       --online-text --working-text --offline-deep
头像   --av-0 … --av-4
尺度   --font --mono --font-mono --sp-* --r-* --fs-* --lh-* --fw-* --z-* --dur* --ease
阴影   --shadow-composer --shadow-card --shadow-pop                       （只在 tokens.css）
```

每族四档：`-fill` 填充（其上压 `--on-accent`）/ `-soft` 淡底 / `-deep` 文字（≥4.5:1）/
`-graphic` 环 · 点（≥3:1）。`--accent-line` 已退役（被 `--accent-graphic` 取代）；
`--online-text` / `--working-text` 是状态色作文字时的深档。改值只改上游。
机械断言：`app/globals.test.mjs`（同名值逐字一致）+ `app/globals.contrast.test.mjs`（对比度与淡底可见性）。
