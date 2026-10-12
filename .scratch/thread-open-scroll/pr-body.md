## What changed

右栏线程面板打开时的**初始滚动落点**改为按线程种类决定：Task thread 有未读 → 停在**最早一条未读回复**（贴顶，更早已读历史留在上方可上翻）；Task thread 无未读、以及普通非 Task thread → 停在**底部**。落点判定是纯函数 seam（`threadInitialScroll` / `applyThreadInitialScroll`），组件只消费结论。

```diff
 components/ThreadPanel.tsx        # useLayoutEffect 落点一次（landedRef 按 anchorId）+ data-thread-message-seq 句柄
 components/ChannelView.tsx        # 线程打开收敛到唯一装配点 threadPanel()；带 Task 已读游标快照
 components/DetailPanel.tsx        # 透传 taskReadSeq
 lib/panel-state.ts                # threadPanel() 装配点 + threadInitialScroll() 判定 + applyThreadInitialScroll() 应用
 lib/domain/collab/tasks.ts        # TaskView.taskThreadReadSeq（读取面，不推进游标）
* hooks/useChannelData.ts         # mergeTaskUnreadCounts 合并字段集加入 taskThreadReadSeq（见下）
+ components/thread-open-scroll.test.mjs
```

## Why

打开任务讨论时，无论多少未读都从顶部（锚点）开始展示，未读回复要手动往下翻才看得见。改成按未读定位后，「打开即看到该读的东西」；同时明确**只改初始落点**——3s 线程轮询合并新回复时不得抢滚动（用户上翻阅读不被拽回底部），也不顺带加「新消息自动滚到底」。

已读语义一字未动：`markTaskThreadRead` / `advanceTaskThreadRead` 的推进时机与范围、BAI-6 普通 Channel 未读、agent inbox 的 `consumed_seqs` 全部未改；不新增 schema 字段 / 表（复用 `task_thread_reads.read_seq`）。

**Scope 扩展及理由**：`hooks/useChannelData.ts` 的 `mergeTaskUnreadCounts` 刻意只合并 `unreadReplyCount` / `latestUnreadReplyAt`，于是 tasks 缓存里的 `taskThreadReadSeq` **永远停在频道挂载那一刻**——落点只对「每次挂载后首次打开」正确，其后每次重开都违反规则 2，且出现「徽标说 0 条未读、点进去却停在旧未读」的矛盾。逐秒实测确认这不是「3s 窗口」而是**永久陈旧**（关闭面板后 1..8s 重开全部落在旧的最早未读）。经 coordinator 授权，只把 `taskThreadReadSeq` 加进该函数的合并字段集（不新增跨模块回写 seam：tasks 缓存与面板打开路径同属 `ChannelView`），残余陈旧回到真正的 ≤3s、与徽标同拍。

## How it was verified

- `npm test`：**1491 passed / 0 failed**（基线 1474，+17）｜`node_modules/.bin/tsc --noEmit` exit 0｜`npm run lint` 0 errors + 既有 1 warning，与基线**逐字一致**（零新增）｜`git diff --check` 通过。
- TDD 红→绿：落点 seam 与接线 **pass 1 / fail 15** → **pass 16 / fail 0**；范围扩展 **fail 1** → **pass 35 / fail 0**。红证据取在本票 base commit `5bfab39` 的源码上（先备份 6 个源文件并 `shasum -c` 校验，`git checkout --` 还原后按哈希复原改动版，字节一致）。
- 真浏览器验收（ego-browser，隔离临时 `WORKSPLICE_DATA_DIR`，假消息**直接落库**，全程 `wake:false` / 不建会话 / 不调真实模型）：

| 场景 | 实测 | 结论 |
| --- | --- | --- |
| Task 有未读 | `firstVisibleSeq=9 @+0px`，`seqsAboveViewport=[1..8]` | 落在最早未读且贴顶，已读历史在上方可上翻 |
| 上翻到 `scrollTop=300` 跨 2 个轮询周期 | `scrollTop=300` 逐字不变 | 轮询不抢滚动 |
| Task 全已读 | `atBottom=true` | 落底部 |
| 普通非 Task thread | `atBottom=true` | 落底部 |

## Checklist

If you renamed the PR section headings (Summary / Evidence / Merge Danger), keep them:

- [x] No agent-internal working state is included. `.scratch/`、`.codex/`、`.commandcode/`、`.agent-teams/` are untracked on purpose and must not appear in a PR.
- [x] If `README.md` or `README.zh-CN.md` changed, both changed and their section order, heading levels, and bullet counts still match. （未改 README）
- [x] No credentials, API keys, session file contents, or other private data is included, including in test fixtures and pasted logs.
