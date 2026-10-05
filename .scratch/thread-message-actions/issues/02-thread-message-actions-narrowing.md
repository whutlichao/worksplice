# 02: 线程消息操作气泡收窄落地（实现票）

**What to build:** 落地 `.scratch/thread-message-actions/spec.md` 的 D1–D6 裁决：把 `MessageActions` / `MessageRow` 的
`onReply` 从必填 prop 变可选、Reply 按钮与右键菜单 reply 项按可选门控；`ThreadPanel` 两个调用点删掉
`onReply` / `onTogglePin` / `pinned` 并清扫随之无消费者的 pinned 回路；显式裁决 pinned 广播总线的存废；
`AGENTS.md` 三处改写；spec 的 Testing Decisions 同步为 S1（新增 1–2 条 `MessageRow` 渲染断言）。

**Blocked by:** None — can start immediately.

**Type:** implementation

**Status:** claimed

- [ ] tdd 红：新增断言在未改实现时为红
- [ ] A：`ChannelView.tsx` 收窄机制 4 处（两个 prop 类型 / Reply 按钮门控 / 菜单项条件展开 / 透传不改）
- [ ] B：`ThreadPanel.tsx` 两个调用点 + 死代码清扫（`loadTasks` 保留）
- [ ] C：pinned 广播总线存废显式裁决（(a) 删 / (b) 留）
- [ ] D：`AGENTS.md` 三处改写（Pin 收窄为 channel only + 代价；ThreadPanel 条目；panel-state 条目）
- [ ] E：spec 的 Testing Decisions 同步为 S1（其余六节与 D1–D6 一字不动）
- [ ] tdd 绿：窄档测试（ChannelView / DetailPanel / panel-state）全绿
- [ ] tsc `--noEmit` 退出码 0
- [ ] `oxlint .` 在改动文件上零新增
- [ ] 双轴 code-review（Standards + Spec 两份报告），findings 逐条处置
- [ ] 人工回归 6 条（真浏览器 / ego-browser，临时数据目录）
- [ ] 票据收敛（`Status: resolved` + `## Answer`）

## 票据协议（worker 必读）

- 开工直接干，不用改本文件；完工后 append `## Answer`，并把 `Status:` 流转到 `resolved`。
- 提问通道一律 `orca orchestration ask`，禁 AskUserQuestion；open 决策 ask 回来，不编造。
- Ownership：本票正本在本 worktree 内，coordinator 在 main 上只读验收。

## Answer

（待 worker 完工后填写）
