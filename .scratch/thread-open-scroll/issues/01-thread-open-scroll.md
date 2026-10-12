# 01: 线程面板打开时的滚动落点（未读回复 / 底部）

**What to build:** 右栏线程面板打开后，初始滚动位置按「这条 thread 是什么」决定——
Task thread 有未读回复时落在**最早一条未读回复**上（该条尽量贴近滚动区顶部，更早的已读历史留在窗口上方可上翻）；
Task thread 无未读、以及普通非 Task thread，都落到底部（最新回复）。

只改**初始落点**。线程轮询把新回复并进列表时不得抢滚动。

**Blocked by:** 无。

**Type:** implementation

**Status:** resolved

## Target

- `components/ThreadPanel.tsx`（主战场：初始落点）
- `components/ChannelView.tsx`（`onOpenThread` 的两个 Task 调用点：锚点按钮、Task 卡片）
- `lib/panel-state.ts`（`thread` 面板内容携带 Task 已读游标）
- `components/DetailPanel.tsx`（透传新字段）
- `lib/domain/collab/tasks.ts`（`TaskView` 暴露该 Task thread 的已读游标）
- `components/thread-open-scroll.test.mjs`（新增）
- `components/dock.test.mjs`（props 变化后同步）

## Change

三条落点规则：

1. **Task thread 有未读回复** → 初始滚动落在最早一条未读回复（贴滚动区顶部），更早的已读历史保留在上方可上翻。
   未读判据与 `countUnreadTaskThreadReplies` 同一口径：作者非 Owner 且该 thread 的 `seq` 大于
   `task_thread_reads.read_seq`。要注意「已读游标之后的 Owner 回复不算未读」——Owner 的回复
   不能成为落点，也不能把落点判成 unread。
2. **Task thread 无未读** → 初始落到底部。
3. **普通非 Task thread**（无 taskId）→ 初始落到底部，行为与现状一致，不报错、不降级成顶部。

落点判定必须是可测的纯函数 seam（`messages` + `readSeq` + `taskId` → `{ kind: "unread", seq } | { kind: "bottom" }`），
组件只消费它的结论；不用「读 DOM 测滚动」当唯一证据。

## Constraints

- 不改已读语义：`markTaskThreadRead` / `advanceTaskThreadRead` 的推进时机与范围、BAI-6 普通 Channel 未读、
  agent inbox 的 `consumed_seqs` 全部一字不动。
- 不新增色族 / 视觉 token；不改 ThreadPanel 的消息渲染、动作栏门控（无 Reply / Pin）、composer 行为。
- 不引入破坏性迁移：不新增 schema 字段或表，复用既有 `task_thread_reads.read_seq`。
- 术语用 codebase-design 词汇（module / interface / seam / adapter / leverage / locality）。
- 浏览器验收只用隔离的临时 `WORKSPLICE_DATA_DIR` + 直接落库的假消息；不得使用 live data、不得调用真实模型。
- 禁止 `next build`；装依赖只用 `bun install`。

## Answer

### 实现

三条落点规则由一个**纯函数 seam** 判定、一个**注入容器**的应用侧落地，组件只消费结论：

- 判定 `threadInitialScroll({ replies, taskId, readSeq, ownerId })` → `{ kind: "unread", seq } | { kind: "bottom" }`；未读口径与
  `countUnreadTaskThreadReplies` 同一份（作者非 Owner 且 `seq > read_seq`），落点取**最早**一条未读，不是最新一条。
  无 `taskId` / 无游标快照 / 无未读一律 `bottom`。
- 应用 `applyThreadInitialScroll(port, target)`（`ThreadScrollPort` = 最小结构子集：`scrollTop` / `scrollHeight` / `replyRowOffset(seq)`）；
  行找不到或容器不在时退到 bottom（不退化成停在顶部）。
- 落点只在 `useLayoutEffect` 里**落一次**（`landedRef` 按 anchorId 记忆），线程 3s 轮询一字未碰滚动。
- 线：`ChannelView` → `threadPanel(anchorId, { id, readSeq })`（唯一装配点）→ `DetailPanel` → `ThreadPanel`；
  消费点三处（消息锚点按钮 / Task 卡片 / 消息行角标）全部经该装配点。
- 新增 `data-thread-message-seq` 在每条回复行上，作为落点定位的稳定句柄（形态仍归 CSS）。

**scope 扩展（coordinator 授权）**：`hooks/useChannelData.ts` 的 `mergeTaskUnreadCounts` 合并字段集加入
`taskThreadReadSeq`。原因：该函数刻意只合并 unread 两字段，导致 tasks 缓存里的已读游标永远停在频道挂载那一刻——
落点只对「每次挂载后首次打开」正确（详细取证见下「遗留」）。

领域读数：`TaskView` / `ChannelTask` 新增 `taskThreadReadSeq`（= `getDb().getTaskThreadRead(task.id)?.read_seq ?? 0`，读取面，不推进）。

### TDD

- 落点 seam 与接线：`evidence/red-thread-open-scroll.log`（**pass 1 / fail 15**；唯一 pass 是「轮询不得触碰滚动」的否定断言）
  → `evidence/green-thread-open-scroll.log`（**pass 16 / fail 0**）。
- 范围扩展：`evidence/red-mergeTaskUnreadCounts.log`（**fail 1**：`taskThreadReadSeq` 仍是 8，服务端已 11）
  → `evidence/green-mergeTaskUnreadCounts.log`（**pass 35 / fail 0**）。
- 红证据在**本票 base commit（`5bfab39`）的源码**上取得：先把 6 个源文件备份并校验哈希（`shasum -c` 逐条 OK），
  `git checkout --` 还原到 base，跑红日志后按哈希逐个还原改动版，确认字节一致——没有 stash、没有丢工作。

### 验证

- **改动前基线（本 worktree 的 base commit `5bfab39` 上自跑）**：`npm test` **1474 tests / pass 1474 / fail 0**；
  `tsc --noEmit` **exit 0**；`npm run lint` **0 errors / 1 warning**（既有 `hooks/useI18n.tsx:61`）。
  日志：`baseline-test.log` / `baseline-tsc.log` / `baseline-lint.log`。
- **改动后**：`npm test` **1491 tests / pass 1491 / fail 0**（+17）；`tsc --noEmit` **exit 0**；
  `npm run lint` **0 errors / 1 warning**——与基线**逐字一致**（零新增）。`git diff --check` 通过。
  日志：`after-npm-test.log` / `after-tsc.log` / `after-lint.log`。
- **真浏览器验收**（ego-browser，隔离临时 `WORKSPLICE_DATA_DIR=/tmp/wsp-thread-open-scroll`，假消息**直接落库**，
  全程 `wake:false`、不建会话、不调真实模型；禁止的 `next build` 未运行）：
  一键复现 `evidence/run-browser-acceptance.sh`，夹具 `evidence/seed-browser-fixture.mjs`，输出 `browser-acceptance.log`。

| 场景 | 实测（`browser-acceptance.log`） | 结论 |
| --- | --- | --- |
| Task 有未读（8 条已读 + 3 条未读 + 8 条 Owner 尾） | `firstVisibleSeq=9 @+0px`，`seqsAboveViewport=[1..8]`（= 已读历史），`atBottom=false` | 落在**最早未读**（seq 9）且贴顶，更早已读历史在上方可上翻 |
| 同上，人工上翻到 `scrollTop=300` 后跨 2 个 3s 轮询周期 | `scrollTop=300` 逐字不变 | 轮询**不抢滚动** |
| Task 全已读（12 条） | `scrollTop=621/621`、`atBottom=true` | 落**底部** |
| 普通非 Task thread（12 条） | `scrollTop=621/621`、`atBottom=true` | 落**底部**（不报错、不降级成顶部） |

  截图：`wsp-1-unread.png`（未读贴顶）、`wsp-2-allread.png`（全已读贴底）、`wsp-3-plain.png`（普通 thread 贴底）。
- 交付前 `git status --porcelain` 干净（改动全部提交）。

### Review

双轴 code-review（两个独立 subagent 各跑一轴，互不可见）逐条结论与处置见 `evidence/dual-review.md`。

- **Standards：OK with notes（无硬违规）**。6 条 finding 全部处置：注释与契约失实、`ownerId` 字面量改引 `OWNER_MEMBER_ID`、
  `onReplyAdapter` 改名 `openThreadPanelForMessage`、提取 `openAnchorTaskThread` 消重、去掉 `readSeq!` 非空断言；
  未读判据的 SQL/TS 双份**登记不改**（票面要求纯函数 seam；上收会把 better-sqlite3 拖进 client 包）。
  引常量时新暴露一条：`lib/panel-state.test.mjs` 以裸 node:test 加载、不吃 `@/` 别名——改用相对路径（自审发现，报告未覆盖）。
- **Spec：OK with notes**。4 条 finding 全部处置：**P1 = 规则 2 在二次打开时被违反**（已按授权修 `mergeTaskUnreadCounts`）；
  P2 lint 新增两条 warning 已清零；P3 `dock.test.mjs` 确认未失效（`taskReadSeq` 为可选 prop）；
  P4 措辞存疑属实（base 无滚动代码，落底部是本票的新行为，已按票面实现并断言）。
- **自审另发现 2 条（报告未覆盖，浏览器实测暴露，均已修）**：
  （A1）面板内换线程时落点误用**上一条线程的 anchor** ⇒ 普通 thread 被停到顶部；修法：门控加 `threadReady`,
  且被陈旧 anchor 拦下那轮**不写 `landedRef`**（否则真正就绪那轮不再落点）；
  （A2）`offsetTop` 相对 offsetParent 而非滚动容器（实测差 58px）⇒ 落点越过该行顶部；改按视口矩形差减 `paddingTop` 计算。

### 遗留 / 已知限制

- **打开那一刻的快照**是设计必需，不是可优化项：面板挂载后会自行推进 Task 游标（`markVisibleTaskThreadRead`），
  之后再查服务端就永远「无未读」，未读落点再也算不出来。所以落点只读**打开时**由装配点带进来的 `taskReadSeq`。
- **残余陈旧 ≤3s，与徽标同拍**：该快照来自 tasks 缓存，由既有 3s 任务轮询刷新。也就是说，关闭面板后 ≤3s 内
  重开同一条 Task thread，落点可能仍按上一拍游标算（停在旧的最早未读），而锚点徽标同样是上一拍的值——两者同源同新鲜度，
  **不会**出现「徽标说 0 条未读、点进去却停在旧未读」的矛盾。修复前这条是**永久**的（不切走频道就一直错），
  逐秒实测见 `browser-reopen-window-probe.log`（修复前：关闭后 1..8s 重开**全部**落 seq 9）；
  修复后 `browser-reopen-window-probe-after.log`（关闭后 1..8s 重开全部显示最新回复 seq 14..19）。
- 一处需要如实记录的取证瑕疵：`browser-reopen-window-probe-after.log` 的 `firstOpen` 显示的是 seq 14（无未读），
  原因是 `run-browser-acceptance.sh` 本身已先做过一次首开（那次已把游标推进）；同一次运行里的 `browser-acceptance.log`
  才是干净首开（`firstVisibleSeq=9`）。「修复前 vs 修复后逐秒重开」这组对照不受影响，因为两次 `firstOpen` 采集口径相同。
- 存量数据不受影响：不新增 schema 字段 / 表（复用 `task_thread_reads.read_seq`），无迁移。

### 交付

- Commit：`bf19711` — `feat(thread): 线程面板初始滚动落点按未读定位`（分支 `thread-open-scroll`，已推送）
- PR：https://github.com/whutlichao/worksplice/pull/183
- PR body：`.scratch/thread-open-scroll/pr-body.md`（按仓库 `.github/pull_request_template.md` 写）
- 双轴 review 报告与逐条处置：`.scratch/thread-open-scroll/issues/evidence/dual-review.md`

