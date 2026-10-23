## Summary

主频道 Task 锚点的讨论入口：主数字改为该 Task thread 的**总回复数**，未读数以独立的「未读 N」常驻呈现（含 0）。

```diff
 MessageRow (Task anchor)
   task.totalReplyCount   ← threadReplyCounts(anchor)：所有作者、不含锚点、不看已读游标
-  主数字 = unreadReplyCount
+  主数字 = totalReplyCount
+  "Unread {n}"（始终显示，0 也显示）
+  aria-label = Task # / 总回复数 / 未读回复数 / 打开讨论
```

数据与刷新路径（无新接口、无 schema）：

```text
listChannelTasks
  threadReplyCounts(tasks.map(message_id))        # 一次 GROUP BY，无 N+1
  toTaskView(..., totalReplyCount)
GET /api/channels/[id]/tasks
  loadTasksPage                                   # 现有 3s 定时器，document.hidden 暂停不变
  mergeTaskUnreadCounts(current, refresh)
    totalReplyCount / unreadReplyCount / latestUnreadReplyAt / taskThreadReadSeq
  MessageRow（Task 锚点）
```

- `Task View` 卡片、侧栏未读 Task 数、未读总览/筛选、打开 thread 后的标读规则均未改。
- 普通消息 thread 的计数与刷新路径未改。
- i18n：`tasks.openDiscussionLabel` 增加 `{totalCount}`，新增 `tasks.unreadBadge`（en/zh-CN 同步）。

## Evidence

- **Before:** 基线 `3b86a28` 的隔离 worktree（只拷入新测试）：
  `node --test lib/domain/collab/tasks.test.mjs components/ChannelView.test.mjs hooks/useChannelData.test.mjs`
  → 127 tests / 123 pass / 4 fail：总数域测试、锚点渲染测试、轮询合并测试、旧锚点断言全部红。
  **After:** 同一组目标测试 → 128 tests / 128 pass / 0 fail。
- `npm run typecheck` → exit 0。
- `npm run lint` → 0 error（仅 `hooks/useI18n.tsx:61` 既有 warning）。
- `env -u DEEPSEEK_API_KEY npm test` → 1555 tests / 1555 pass / 0 fail；同环境基线 `3b86a28` 为 1551 / 1551。（本机 `DEEPSEEK_API_KEY` 会让既有的 `lib/model-listing.test.mjs` 看到真实模型而失败，基线同样失败，与本改动无关。）

## Merge Danger

**Door:** two-way

无数据库 schema、迁移或持久化格式变更；`TaskView` / `GET /api/channels/[id]/tasks` 仅新增只读字段。

**Blast Radius:** localized

只动 Task 锚点讨论入口的计数呈现与 3s 任务板计数合并；Task 视图卡片、未读筛选、普通 thread 计数与标读语义不变。唯一行为变化是锚点主数字从「未读数」变为「总回复数」，未读数改为独立文本。

## Closes

无对应 GitHub issue（本票来自 Orca 派发工单；票据正本 `.scratch/task-thread-total-count/issues/02-task-thread-total-count.md`）。
