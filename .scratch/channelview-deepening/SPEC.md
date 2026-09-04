# ChannelView 深模块化 Spec

## Problem Statement

`components/ChannelView.tsx`（3239 行、~40 个 useState、11 个 useEffect）是全仓体积第一、热度第二的 shallow 模块：interface（props 传参与回调）几乎与 implementation 等宽。每个新 ticket（任务板、提醒、反应、附件）都必须穿过它，导致合并冲突频发、频道数据 bug 无处收敛、测试只能挂载整个 3k 行视图。

## Solution

把频道数据循环收进 `hooks/useChannelData.ts` 深模块（窄 interface），ChannelView 只剩排版。ThreadPanel 保持现状（统一是后续工作，不在本 spec）。mute/members 并入 pinned 附属区。

## Implementation Decisions（grilling 两轮结论）

- 粒度：只抽数据循环（A），视图子组件（MessageRow/TaskViews/Composer）本次不动
- 范围：先只做 ChannelView（A），ThreadPanel 独立循环暂时保留
- 测试：先加 hook 级测试锁定行为（A），自写最小 harness（Q7-A），不引 testing-library
- 工作区：arch-review 子 worktree 内顺序实施 6 票（Q4-A）
- 命名：`useChannelData`（CONTEXT.md Avoid "room"，报告的 useChannelRoom 弃用）
- 切分顺序：01 轮询+merge → 02 发送+hold → 03 pinned（含 mute/members）→ 04 任务板数据 → 05 瘦身收尾（Q6，05 并入 03 后剩 5 票）
- Out of scope：ThreadPanel 统一、视图子组件搬迁、MessageRow/Composer 独立文件化

## Testing Decisions

- 每票为抽出的数据函数写 hook 级测试（node --test + jiti，与 ChannelView.test.mjs 同 harness）
- 好测试只测外部行为：轮询 merge 去重、hold 重试语义、pinned 排序、任务转移序列，不测实现细节
- 每票结束 `npm test` 全绿 + `tsc --noEmit` 通过；05 票视图测试瘦身后 ChannelView.test.mjs 仍覆盖排版回归
