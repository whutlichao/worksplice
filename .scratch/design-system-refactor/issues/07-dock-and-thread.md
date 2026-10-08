# 07 — 右栏：单槽容器 / 线程 / agent 详情

**What to build:** `components/DetailPanel.tsx` 单槽容器（`--surface` 底 + 左发丝；容器自身不吃圆角，`--r-lg` 只作用于内部区块）。`components/ThreadPanel.tsx`：`.tt-summary`（sticky）/ `.tt-status`（状态胶囊，色取 ED-10 映射）/ `.assignee`（胶囊 + 内嵌 `.avatar.sm`）/ `.tt-actions`（chip 行）/ `.tt-log`（时间线，`ok`/`warn`/`err`/`is-now` 四种点）/ `.tt-reply`（sticky composer，accent 焦点环）。`components/AgentDetailPanel.tsx`：`.dock-head` / `.dock-id` / `.avatar.lg` / `.dock-name` / `.dock-role`（`.presence` + 文字）/ `.icon-btn` 关闭 / `.dock-tabs` / `.dock-tab`（下划线 tab，mono 计数转 accent）/ `.dock-scroll` / `.d-sec` + `.d-sec-title`（mono 大写）/ `.kv`（点线引导的 key/value 行）/ `.meter` / `.stat-grid`（2×2，数字 mono 17px/700 `tabular-nums`）/ `.log-row` + `.lv`（级别标签）。

**Blocked by:** 03, 04

**Status:** pending

- [ ] `.tt-status` 与任务状态色一致；`.tt-log` 四种点色取四态 token
- [ ] 统计数字用 `var(--mono)` + `font-variant-numeric: tabular-nums`
- [ ] `DetailPanel` 的按 kind 分派逻辑零改动（`components/DetailPanel.test.mjs` 全绿）
- [ ] 右栏无 `2px solid`；分隔发丝
- [ ] **两处 dock 头像**尺寸 44px（`size="lg"` = `--avatar-lg`，圆角 `--r-md`）：`AgentDetailPanel.tsx:708`（agent 详情）与 `DetailPanel.tsx:117`（人类资料卡，`type === "human"` 恒 `--av-4`）；票 04 已迁到 `Avatar`，本票只校形态与尺寸
- [ ] `components/AgentDetailPanel.test.mjs` 全绿（可观测性/任务历史/导出的**行为**断言不得因样式改动而变）
- [ ] `npm test` / `tsc --noEmit` 通过

## Answer
