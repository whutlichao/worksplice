# 01 — Task 讨论总回复数与未读标记（设计票）

Type: grilling
Status: in-progress
Spec: [spec.md](../spec.md)

## What to decide

重开 `.scratch/task-thread-navigation/spec.md` D3/D4 的 Task 锚点数字呈现裁决：确认锚点主数字的统计单位、范围与刷新时机；确认 Task 未读游标、侧栏未读 Task 数、未读总览/筛选如何保留并与总回复数区分；确认零值与无障碍名称。不得改写已完成 Ticket 03 / 04 的 Acceptance 或 Answer。

## Acceptance

- [ ] 全部开放决定通过 `orchestration ask` 交由用户确认；共享理解确认后 design-tree frontier 清零。
- [ ] 新设计 spec 按 Problem Statement / Solution / User Stories / Implementation Decisions / Testing Decisions / Out of Scope / Further Notes 七节组织，明确其对旧 D3/D4 的有限取代范围。
- [ ] `CONTEXT.md` inline 记录「线程回复总数」及其与「任务线程未读」的领域区别，不添加实现步骤。
- [ ] 新增顺序 ADR-0017，标明所取代的旧裁决及仍有效的部分。
- [ ] 不修改原 `.scratch/task-thread-navigation/spec.md`、Ticket 03 / 04，且不改产品源码、不跑测试、typecheck、lint、双轴 review 或浏览器验收。
- [ ] Answer 记录本轮 Q→A 审计、用户理由、frontier 清零证据、`git diff --check`、文件清单、状态收敛与 PR 信息。

## Comments

- 本 Dispatch 在当前 worktree 中没有同名 issue 正本；依 `.scratch/` Markdown 追踪约定新增本设计票文件。它是设计票，不创建任何实施票。
- 最新用户说明优先：Task 锚点主数字表示总回复数。此前选择把主数字保留为未读数的回答已被重开，不作为本票裁决。
