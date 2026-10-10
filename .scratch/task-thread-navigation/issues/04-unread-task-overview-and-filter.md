# 04 — 未读任务总览与筛选

## Parent

`.scratch/task-thread-navigation/spec.md`

## What to build

Owner 能从侧栏分别辨认普通 Channel 未读消息数和有未读讨论回复的 Task 数，并从 Channel 进入现有 Task View 的未读筛选；筛选结果保留原有状态结构，帮助定位并打开具体未读讨论。

## Blocked by

03 — 持久化任务线程未读

Status: ready-for-agent
Type: task

## Acceptance criteria

- [ ] 侧栏分别呈现普通 Channel 未读消息数和有未读回复的 Task 数；Task 数按有未读的 Task 计数而非回复总数，并提供能说明单位且即使视觉截断仍包含精确数字的无障碍名称。
- [ ] 选中 Channel 后，侧栏仍显示该 Channel 的未读 Task 数；进入 Channel、Task View 或未读筛选目录本身均不推进任何 Task 的已读位置。
- [ ] Channel 提供「未读任务讨论 N」入口；选择后进入现有 Task View 的未读筛选，不自动打开某个讨论。
- [ ] 未读筛选涵盖 todo、in_progress、in_review、done、closed 全部 Task 状态；新回复不会改变 Task 状态。
- [ ] List 仍按 Task 状态分组，Board 仍按 Task 状态分列；每个状态组或列内按最新未读讨论回复时间倒序排列，同一时间时按 Task 编号升序稳定排列；Task 状态变化本身不改变该排序。
- [ ] 每个筛选结果显示 Task 状态、编号和未读回复数，并能打开对应 Task 的讨论。
- [ ] 从未读筛选结果打开一个 Task 的讨论，只清除该 Task 的未读；其他 Task 的已读位置与未读状态不变。
