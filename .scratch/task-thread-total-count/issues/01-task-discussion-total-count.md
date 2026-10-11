# 01 — Task 讨论总回复数与未读标记（设计票）

Type: grilling
Status: resolved
Spec: [spec.md](../spec.md)

## What to decide

重开 `.scratch/task-thread-navigation/spec.md` D3/D4 的 Task 锚点数字呈现裁决：确认锚点主数字的统计单位、范围与刷新时机；确认 Task 未读游标、侧栏未读 Task 数、未读总览/筛选如何保留并与总回复数区分；确认零值与无障碍名称。不得改写已完成 Ticket 03 / 04 的 Acceptance 或 Answer。

## Acceptance

- [x] 全部开放决定通过 `orchestration ask` 交由用户确认；共享理解确认后 design-tree frontier 清零。
- [x] 新设计 spec 按 Problem Statement / Solution / User Stories / Implementation Decisions / Testing Decisions / Out of Scope / Further Notes 七节组织，明确其对旧 D3/D4 的有限取代范围。
- [x] `CONTEXT.md` inline 记录「线程回复总数」及其与「任务线程未读」的领域区别，不添加实现步骤。
- [x] 新增顺序 ADR-0017，标明所取代的旧裁决及仍有效的部分。
- [x] 不修改原 `.scratch/task-thread-navigation/spec.md`、Ticket 03 / 04，且不改产品源码、不跑测试、typecheck、lint、双轴 review 或浏览器验收。
- [x] Answer 记录本轮 Q→A 审计、用户理由、frontier 清零证据、`git diff --check`、文件清单、状态收敛与 PR 信息。

## Comments

- 本 Dispatch 在当前 worktree 中没有同名 issue 正本；依 `.scratch/` Markdown 追踪约定新增本设计票文件。它是设计票，不创建任何实施票。
- 最新用户说明优先：Task 锚点主数字表示总回复数。此前选择把主数字保留为未读数的回答已被重开，不作为本票裁决。

## Answer

### 结论

完成本设计票：Task 锚点主数字按所有作者、已读无关的 thread 回复总数呈现；独立保留精确「未读 N」与现有未读能力。Task 总回复数与未读数在频道可见时每 3 秒刷新，即使频道主序列未变化；普通消息 thread 计数保持现有刷新行为，不在本票修改。零回复时按钮仍显示 `0`，无障碍名称明确区分 Task 编号、总回复数、未读回复数和打开动作。

### 问答审计

本轮所有决定均通过 `orchestration ask` 由用户确认，以下均为**人定**：

| Q | 用户决定 | 用户给出的理由 |
|---|---|---|
| Q1 | Task 主数字镜像普通 thread 数字，统计所有回复，不含锚点；所有作者（包括 Owner）都计入；已读状态不影响总数。 | 与普通线程数字同义；截图中普通 thread 显示 5，Task 讨论也应显示消息数量。 |
| Q2 | Task 计数按每 3 秒节奏刷新，thread 回复变化即更新，即使频道主序列未变。 | 新回复后主频道上的数字不应滞后，并与可见刷新节奏一致。 |
| Q3 | 保留 Task 已读游标、侧栏未读 Task 数、未读总览/筛选；总数和未读状态分开表达。 | 满足总数可见诉求，同时不丢现有未读能力。 |
| Q4 | 讨论按钮始终存在，零回复显示 `0`；无障碍名称说明 Task 编号、总回复单位与打开动作。 | 入口位置稳定且数字语义清楚。 |
| Q3a | 锚点在总回复数之外显示精确、独立的「未读 N」；无障碍名称分别说明两种数字。 | 保留 Ticket 03 已交付的精确未读信息，不让主数字被误读为未读数。 |
| Q5 | 3 秒独立刷新只适用于 Task 总回复数与未读 N；普通消息 thread 计数保持现有刷新行为。 | 本次只重开 Task 锚点数字，避免扩大到普通消息线程。 |

用户最后确认，除 Q5 对刷新范围的修正外，共享理解准确且 design-tree frontier 清零。此前歧义下“保留未读数为主数字”的回答被最新说明明确取代。

### 产物与历史保护

- `.scratch/task-thread-total-count/spec.md`：严格按七个 effort 标题记录新裁决、问答审计及 D3/D4 有限 supersession。
- `CONTEXT.md`：inline 新增「线程回复总数」，并澄清其与「任务线程未读」的区别；无实现步骤。
- `docs/adr/0017-task-thread-total-reply-count.md`：记录接受决定及新旧裁决关系。
- 本 issue：记录访谈、frontier 与交付状态；未创建实施票。
- `.scratch/task-thread-navigation/spec.md`、Ticket 03 与 Ticket 04 均保持原样，未改产品源码。

### Frontier 清零

最终 `orchestration ask` 汇总确认后，用户补充 Q5：普通消息 thread 数字不在本票修改。用户随后明确表示该范围修正后的共享理解准确、frontier 清零，且除 Q5 外先前各项均已确认。未留待决定的产品分支。

### 门禁

本票按 G-docs 执行：不运行测试、typecheck、lint、双轴 code-review 或浏览器验收；只做文档结构/术语/ADR/frontier 核验。`git diff --check HEAD` 通过，覆盖本票所有已暂存 Markdown 变更；`git diff --cached --numstat` 中最大文件为新设计 spec（91 行新增），无格式化噪声。`.pi-lens.json` 已按要求设置 `{"format":{"enabled":false}}`，`.git/info/exclude` 原已包含该路径，文件未进入 Git 状态。

### PR

- 分支：`task-thread-total-count-design`
- PR：[#152](https://github.com/whutlichao/worksplice/pull/152)
