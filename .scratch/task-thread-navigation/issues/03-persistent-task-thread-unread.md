# 03 — 持久化任务线程未读

## Parent

`.scratch/task-thread-navigation/spec.md`

## What to build

Owner 能在各个 Task 之间独立追踪未读讨论回复；每个 Task 的已读位置跨刷新与应用重启保留，并在功能启用及普通讨论后来成为 Task 时按设计建立历史已读基线。

## Blocked by

02 — 任务创建事件与锚点导航

Status: ready-for-agent
Type: task

## Acceptance criteria

- [ ] 每个 Task thread 的未读只计算该讨论中作者不是 Owner、且位于该 Task 已读位置之后的回复；Owner 自己的回复不计入，普通频道消息和任务创建事件也不计入或推进该讨论的已读位置。
- [ ] 未读回复数与 Owner 对应 Task 的已读位置相符，并显示在该 Task 锚点上；锚点讨论按钮的无障碍名称说明 Task 编号与精确未读回复数（包括零），不同 Task 的回复数与已读位置彼此独立。
- [ ] 功能首次启用时，已有 Task thread 当前最新回复作为已读基线；已有普通 thread 后来转为 Task 时，Task 建立时已有的回复也作为已读基线，只有之后的新回复计为未读。
- [ ] 打开一个 Task 的讨论，只将该讨论推进到打开当时的最新回复；其他 Task 的未读状态不变。
- [ ] Task 讨论在前台保持打开期间，新呈现的回复自动成为已读；关闭讨论、切换频道或改看其他面板后到达的新回复计为未读。
- [ ] Owner 刷新页面或重启应用后，各 Task 的已读位置与未读回复数仍保持准确。
- [ ] done 或 closed Task 收到非 Owner 的新讨论回复时，该回复仍计为未读；收到回复不改变 Task 状态。
