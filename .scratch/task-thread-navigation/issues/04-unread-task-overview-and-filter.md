# 04 — 未读任务总览与筛选

## Parent

`.scratch/task-thread-navigation/spec.md`

## What to build

Owner 能从侧栏分别辨认普通 Channel 未读消息数和有未读讨论回复的 Task 数，并从 Channel 进入现有 Task View 的未读筛选；筛选结果保留原有状态结构，帮助定位并打开具体未读讨论。

## Blocked by

03 — 持久化任务线程未读

Status: resolved
Type: task

## Acceptance criteria

- [x] 侧栏分别呈现普通 Channel 未读消息数和有未读回复的 Task 数；Task 数按有未读的 Task 计数而非回复总数，并提供能说明单位且即使视觉截断仍包含精确数字的无障碍名称。
- [x] 选中 Channel 后，侧栏仍显示该 Channel 的未读 Task 数；进入 Channel、Task View 或未读筛选目录本身均不推进任何 Task 的已读位置。
- [x] Channel 提供「未读任务讨论 N」入口；选择后进入现有 Task View 的未读筛选，不自动打开某个讨论。
- [x] 未读筛选涵盖 todo、in_progress、in_review、done、closed 全部 Task 状态；新回复不会改变 Task 状态。
- [x] List 仍按 Task 状态分组，Board 仍按 Task 状态分列；每个状态组或列内按最新未读讨论回复时间倒序排列，同一时间时按 Task 编号升序稳定排列；Task 状态变化本身不改变该排序。
- [x] 每个筛选结果显示 Task 状态、编号和未读回复数，并能打开对应 Task 的讨论。
- [x] 从未读筛选结果打开一个 Task 的讨论，只清除该 Task 的未读；其他 Task 的已读位置与未读状态不变。

## Answer

### 实现
- Store/SQLite 查询为侧栏提供“至少有一条未读 thread 回复的 Task 数”，Task 视图附带最新未读回复时间；Channel 和 Task 未读分别显示。
- Channel 入口进入 Task View 的未读筛选。筛选保留 List 分组、Board 列与所有五种状态，按最新未读回复时间倒序、Task 编号升序排列；卡片带未读数和可访问状态描述。目录浏览不推进游标，打开讨论只清该 Task。
- 首轮 Spec review 发现未读 Task 徽标会隐藏归档标记；已保留既有归档标记行为并新增回归测试。

### TDD
- 功能测试红绿证据：`tdd-01-red.log`、`tdd-02-red.log`、`tdd-03-red.log` 与对应 focused green 日志，见 `/tmp/orch-worksplice/evidence/task-thread-navigation-04/`。
- 归档标记回归：`tdd-04-red.log` → `tdd-04-green-final.log`（19/19 通过）。

### 验证
- `npm test`：1345 passed，0 failed（`npm-test.final2.log`）。`npm run typecheck` 通过；`npm run lint` 为 0 errors、1 条既有 `hooks/useI18n.tsx:61` warning。typecheck/lint 输出经路径归一化后与改前基线完全一致。
- 隔离 ego-browser 验收覆盖两种侧栏徽标、选中 Channel 后 Task 数保留、List/Board 全状态筛选、浏览筛选不读游标，以及只清除打开的 Task。证据和复现步骤见 `/tmp/orch-worksplice/evidence/task-thread-navigation-04/browser-acceptance.md`；使用独立临时数据目录与 `WORKSPLICE_DEMO=1`，未触及 live data 或调用真实模型。
- `git diff --check` 通过。

### Review
- **Standards**：最终审查未发现硬性标准违规。Shotgun Surgery 与 Data Clumps 均为判断性提示；跨层改动符合 Store/协作域/UI 分层，不为减少文件数合并模块；未读计数与时间暂不抽象为新类型。
- **Spec**：最终审查未发现问题。首轮指出的归档标记回归已修复并纳入最终审查。

### 交付
- 提交：`c494be0`（实现）、`cd26647`（Review 修复）、`7e5fb40`（Ticket Answer/Status）。
- PR：[#140](https://github.com/whutlichao/worksplice/pull/140)
