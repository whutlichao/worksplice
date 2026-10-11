# Task 锚点区分回复总数与未读回复数

Task 锚点的讨论入口主数字表示该 thread 的回复总数（不含锚点、包含所有作者的回复且不受已读状态影响），并以独立的「未读 N」表达未读回复；Task 两个计数每 3 秒更新，即使频道顶层消息序列未变化，普通消息 thread 的现有计数行为则不在本决定范围内。此分离避免已读状态把总讨论量显示为零，同时保留 Task 未读游标、侧栏未读 Task 数及未读总览/筛选。

**Status**: accepted
**Supersedes**: `.scratch/task-thread-navigation/spec.md` D3 中 Task 锚点主数字为未读回复数及其单一计数无障碍语义；D4 中锚点徽标作为未读回复数的呈现部分。D3 的稳定入口、Task 编号/状态、键盘与焦点要求，以及 D4 的未读定义、Channel 与 Task 未读分离和侧栏计数单位仍有效。已完成 Ticket 03 / 04 的 Acceptance 与 Answer 原样保留；新设计记录见 `.scratch/task-thread-total-count/spec.md`。
