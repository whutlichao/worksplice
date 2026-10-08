# 06 — 任务板两视图

**What to build:** `components/ChannelView.tsx` 的任务板段按原型形态重做：`.board-wrap` / `.board-toolbar` / `.seg`（看板 / 列表分段控件）/ `.filter-chip` / `.board` / `.board-cols`（列定宽 236px = `--board-col-w`，横向滚动，不拉伸）/ `.col`（`--panel`）/ `.col-head` / `.col-body` / `.card`（`--surface` + `--border` + `--r-md`；hover 强化边框 + `--shadow-card`）/ `.card-num`（mono）/ `.card-title` / `.card-meta` / `.card-owner`（内嵌 `.avatar.sm`）/ `.card-tag` / `.drop-hint`（虚线空槽）/ 拖拽态 `.drag-over`（accent）/ `.invalid-over`（`--error`）/ 拖拽中 `opacity:.4`。**不做乐观移动**（ADR-0002）——视觉只表达「合法/非法落点」，不动服务端裁决。状态色按 ED-10：`todo→--faint` / `in_progress→--accent` / `in_review→--working` / `done→--online` / `closed→--offline`。

**Blocked by:** 04

**Status:** pending

- [ ] 列宽来自 `var(--board-col-w)`；列不拉伸
- [ ] 卡片 hover 用 `--shadow-card`；静止卡片无阴影
- [ ] 拖拽落点可达性视觉（accent / `--error`）仍在；`reachable` 渲染断言仍绿（`components/AgentDetailPanel.test.mjs` 或 `ChannelView.test.mjs` 的既有 seam）
- [ ] 五种状态色全部来自四态 token + `--faint`/`--accent`，无马卡龙色
- [ ] 列表视图分组顺序与状态徽标形态不变（行为零改动）
- [ ] `npm test` / `tsc --noEmit` 通过

## Answer
