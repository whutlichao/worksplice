# 02: Task 锚点显示总回复数并独立刷新未读数

**What to build:** 主频道 Task 锚点上的讨论入口显示该 thread 的总回复数，同时以独立的“未读 N”表达未读回复数。总数不含锚点、包含所有作者的回复且不受已读位置影响；入口始终可用，零回复显示 `0`。新回复后，两个 Task 计数都在频道可见时按现有 3 秒节奏更新，即使没有新的频道顶层消息。无障碍名称清楚区分 Task 编号、总回复数、未读回复数和打开讨论动作。

**Blocked by:** None — can start immediately.

**Type:** implementation

**Status:** resolved（2026-10-23）

- [x] Task 锚点主数字统计所有 thread 回复（含 Owner 回复），不含锚点，已读状态不会减少总数。
- [x] 总回复数之外独立呈现精确的“未读 N”；未读仍按该 Task 自己的已读位置与现有作者规则计算。
- [x] 讨论入口始终存在，零回复时显示总数 `0`，并能打开对应 Task thread。
- [x] Task 回复变化后，在频道可见时不晚于下一个 3 秒刷新周期更新总数与未读数；即使频道顶层序列不变也会更新，浏览器后台遵循现有暂停刷新行为。
- [x] 无障碍名称分别说明 Task 编号、总回复数、未读回复数和打开讨论动作，不将总数读成未读数。
- [x] 既有 Task 未读游标、侧栏未读 Task 数、未读总览/筛选和标读规则保持不变；普通消息 thread 计数刷新行为不变，Task View 卡片不新增总数。
- [x] 测试验证产品渲染出的计数、按钮语义与无障碍名称，以及只有 Task thread 回复变化时的刷新；不以 CSS class 字符串替代用户可观察行为断言。

## Comments

- 拆票决策（人定）：用户选择一张端到端实施票，无前置票；同一票交付总数/未读分离、刷新与验证，避免先交付一个仍缺自动刷新的中间状态。

## Answer

已按 spec 交付：Task 锚点讨论入口主数字 = 该 thread 的总回复数（所有作者、含 Owner、不含锚点、不受已读游标影响），未读数以独立「未读 N」常驻呈现（0 也显示）。总回复数复用现有 `threadReplyCounts` 一次 `GROUP BY` 批量计算（无 N+1），并随现有 3 秒任务板轮询经 `mergeTaskUnreadCounts` 与未读数一起刷新；频道顶层 seq 不变时同样更新，`document.hidden` 暂停行为未改。无 schema / 迁移 / 持久化格式变更。

### 改动文件

- `lib/domain/collab/tasks.ts`：`TaskView.totalReplyCount`；`toTaskView` 单任务缺省计算；`listChannelTasks` 批量取数后传入。
- `hooks/useChannelData.ts`：`ChannelTask.totalReplyCount`（可选，缺失时合并保留当前值）；`mergeTaskUnreadCounts` 同步合并总数。
- `components/ChannelView.tsx`：Task 锚点主数字改为总数；独立 `tasks.unreadBadge`；`title` / `aria-label` 同时说明 Task 编号、总数、未读数和打开动作。
- `lib/i18n/messages/en.ts`、`lib/i18n/messages/zh-CN.ts`：`openDiscussionLabel` 增加 `{totalCount}`，新增 `tasks.unreadBadge`。
- 测试：`lib/domain/collab/tasks.test.mjs`、`hooks/useChannelData.test.mjs`、`components/ChannelView.test.mjs`。

### 红绿证据

- **红（隔离基线 worktree `3b86a28`，只拷入新测试）**：`node --test lib/domain/collab/tasks.test.mjs components/ChannelView.test.mjs hooks/useChannelData.test.mjs` → **127 tests / 123 pass / 4 fail**：
  - `Task views expose the total reply count with Owner replies included, anchor excluded, and read state irrelevant`
  - `Task anchor discussion entry shows total replies and an independent exact unread count`
  - `mergeTaskUnreadCounts refreshes total and unread replies from the same Task poll`
  - `Task 锚点显示编号和状态，并为零未读提供精确讨论名称`（旧 aria-label 契约随新语义更新）
- **绿（本票 worktree）**：同一组目标测试 → **128 tests / 128 pass / 0 fail**；新增 `mergeTaskUnreadCounts advances the total when only an Owner reply arrives` 固定「仅 Owner 回复（总数变、未读不变）」路径。

### 测试命令与结果

- 基线：`env -u DEEPSEEK_API_KEY npm test` → 1551 tests / 1551 pass / 0 fail；`npm run typecheck` 0 error；`npm run lint` 0 error（1 个既有 warning `hooks/useI18n.tsx:61`）。
- 最终：`env -u DEEPSEEK_API_KEY npm test` → **1555 tests / 1555 pass / 0 fail**；`npm run typecheck` exit 0；`npm run lint` **0 error**（同一既有 warning）。
- 说明：本机导出的 `DEEPSEEK_API_KEY` 会让既有的 `lib/model-listing.test.mjs` 枚举到真实模型而失败（基线同样失败，与本改动无关），故全量命令统一用 `env -u DEEPSEEK_API_KEY` 取稳定基线。

### 双轴 code-review

- **Standards**：初轮 FAIL——`ChannelTask.totalReplyCount` 必填与运行期缺失兜底互相矛盾；`unreadById` 命名未覆盖总数字段；`title` / `aria-label` 重复构造 label；注释仍写「三个字段」。已整改：字段改可选并注明兜底语义、重命名 `countersById`、提取 `discussionLabel`、注释改为按来源表述；复检通过。
- **Spec**：PASS（D1–D7、用户故事 1–11、范围收敛、实现正确性均通过）。唯一 minor：合并层缺「仅总数前进」用例，已补测试后复检通过。

### PR

- PR **#199**：https://github.com/whutlichao/worksplice/pull/199（未合并）
- PR body：`.scratch/task-thread-total-count/pr-body.md`（Summary / Evidence / Door: two-way / Blast Radius / Closes）
