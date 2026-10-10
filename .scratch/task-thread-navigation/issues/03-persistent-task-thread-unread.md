# 03 — 持久化任务线程未读

## Parent

`.scratch/task-thread-navigation/spec.md`

## What to build

Owner 能在各个 Task 之间独立追踪未读讨论回复；每个 Task 的已读位置跨刷新与应用重启保留，并在功能启用及普通讨论后来成为 Task 时按设计建立历史已读基线。

## Blocked by

02 — 任务创建事件与锚点导航

Status: resolved
Type: task

## Acceptance criteria

- [x] 每个 Task thread 的未读只计算该讨论中作者不是 Owner、且位于该 Task 已读位置之后的回复；Owner 自己的回复不计入，普通频道消息和任务创建事件也不计入或推进该讨论的已读位置。
- [x] 未读回复数与 Owner 对应 Task 的已读位置相符，并显示在该 Task 锚点上；锚点讨论按钮的无障碍名称说明 Task 编号与精确未读回复数（包括零），不同 Task 的回复数与已读位置彼此独立。
- [x] 功能首次启用时，已有 Task thread 当前最新回复作为已读基线；已有普通 thread 后来转为 Task 时，Task 建立时已有的回复也作为已读基线，只有之后的新回复计为未读。
- [x] 打开一个 Task 的讨论，只将该讨论推进到打开当时的最新回复；其他 Task 的未读状态不变。
- [x] Task 讨论在前台保持打开期间，新呈现的回复自动成为已读；关闭讨论、切换频道或改看其他面板后到达的新回复计为未读。
- [x] Owner 刷新页面或重启应用后，各 Task 的已读位置与未读回复数仍保持准确。
- [x] done 或 closed Task 收到非 Owner 的新讨论回复时，该回复仍计为未读；收到回复不改变 Task 状态。

## Answer

### 实现
- schema v13 新增 `task_thread_reads`，既有 thread 以迁移时最新非 Owner 回复建立基线；新 Task 的基线随创建事务写入。已读游标只推进到请求所报序号之前最近的非 Owner 回复，并按 Task 独立计数。
- 新增 `POST /api/tasks/[id]/read`；Task View 返回 `unreadReplyCount`。ThreadPanel 仅在对应 Task 已加载且页面前台可见时推进游标；Task 线程轮询独立刷新锚点未读数，普通 Channel 未读语义不变。
- 锚点入口始终显示计数（包括 0），可访问名称包含 Task 编号与准确未读数；未加入 Ticket 04 的未读总览/筛选。

### TDD
- 行为红绿证据：`tdd-01-red.log` → `tdd-01-green.log`（计数与 Owner 排除）；`tdd-04-red.log` → `tdd-04-green.log`（Task read 请求）；`tdd-05-red.log` → `tdd-05-green.log`（未读数增量合并）；`tdd-06-red.log` → `tdd-06-green.log`（锚点无障碍名称）。
- Review 补充的前台自动标读门控：`review-d8-red.log`（缺少可测试 seam）→ `review-d8-green.log`；`final-threadpanel-tests.log` 另验证 ThreadPanel 将当前序号接入门控且卸载时清理轮询。

### 验证
- `npm test`：1337 passed，0 failed（`final-npm-test-after-review.log`）。
- `node_modules/.bin/tsc --noEmit`：基线与改后均通过（`base-typecheck.log`、`after-review-tsc.log`）。`npm run lint`：基线与改后均为 0 errors、1 条既有 `hooks/useI18n.tsx:61` warning（`base-lint.log`、`after-review-lint.log`）。`git diff --check` 通过。
- ego-browser 在隔离临时 `WORKSPLICE_DATA_DIR` 验收：独立清除、Task View 浏览不清除、前台新回复自动标读、关闭/切换后的新回复保持未读、Channel 未读隔离、精确无障碍名称及应用重启持久性；证据见 `browser-acceptance.log`、`restart-before.json`、`restart-after.json`。未使用真实模型或 live data；未运行 `next build`。

### Review
- Standards：`dual-review.standards.md` 未发现文档标准违规；指出的重复 maxSeq fallback 已收敛为 `ThreadPanel.threadMaxSeq`。
- Spec：`dual-review.spec.md` 确认 D4/D7/D9 与 Ticket 03 scope；指出 D8 行为回归测试不足。已新增可执行的 `markVisibleTaskThreadRead` 门控测试，覆盖前台序号推进、隐藏/加载/切换/非 Task 不推进；结合真实浏览器验收覆盖关闭与切走后的回复行为。
