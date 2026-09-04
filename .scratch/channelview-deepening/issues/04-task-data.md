# 04: 任务板数据抽入 useChannelData

**What to build:** 任务板数据循环（loadTasks + claim/complete/unclaim/close/approve/reject/reopen 转移序列，complete 先落线程回复再置 in_review）收进 hook。TaskViews 视图与拖拽手势不动。

**Blocked by:** 01、02（需消息引用 + 发送通道，complete 依赖 send）.

**Status:** resolved

- [x] hook 返回新增 `tasks / tasksError / taskNotice / taskOps{claim,complete,unclaim,...}`
- [x] hook 级测试：claim 让路语义（held/conflict）、complete 两步序列、reopen 封锁标记透出
- [x] ChannelView 切到 hook，删除旧内联实现
- [x] `npm test` 全绿，`tsc --noEmit` 通过

## 实施方式（强制）

本票必须走 `/implement` skill 流程实施：先读 `/Users/apple/.pi/agent/skills/implement/SKILL.md`，内部按 `/tdd` 一次一个红-绿切片推进，收尾按 `/code-review` 双轴自审（Standards + Spec）后报完工。hook 测试用 node --test + jiti 自写 harness，不引 testing-library。只做本票范围。

## 票据协议（worker 必读）

- 开工直接干，不用改本文件。
- 完工后 append 一个 `## Answer` 段（改了哪些文件 + 测试命令结果 + 遗留），再 worker_done。
- 禁止碰 `Status:` 行与 `Blocked by` 行——状态收敛权归 coordinator（多 worktree 下原地改 Status 会分叉冲突）。

## Answer 必须含 review 小节（验收钩子）

完工的 `## Answer` 必须含 `code-review` 双轴自审小节：Standards（发现几个问题/无问题）、Spec（缺失/creep/实现错误各是什么）。无问题也要写"双轴自审无问题"。**没有 review 小节 = 验收不通过，打回。**

## Answer

- 改了哪些文件：
  - `hooks/useChannelData.ts`（+352/-6）：新增 `ChannelTask` 类型（自 ChannelView 上游迁移，re-export 供 TaskViews 复用，避免循环 import）；7 个纯函数 `loadTasksPage`（GET 任务板 + 缺字段兜底 + 错误映射）/`parseTaskTransitionBody`（409 三分支 held/conflict/blocked 解析，未知形态抛错）/`claimChannelTask`（baseSeq 携带 + 让路不抛错）/`updateChannelTaskStatus`（status+baseSeq 携带）/`completeTaskWithReply`（先落线程回复再置 in_review，复用 hook 内 postChannelMessage 发送通道：线程回复用线程版本，状态更新用频道版本）/`convertMessageToTaskRow`/`createBoardTaskRow`（创建两途径，409/错误抛错由调用方提示）；hook 返回新增 `tasks/tasksError/taskNotice/setTaskNotice/loadTasks/runTaskTransition/completeTask/convertToTask/createTaskFromBoard/taskOps{claim,complete,unclaim,close,approve,reject,reopen}`（切换频道清空+重拉+迟到守卫；busy 沿旧 runTaskAction 同一共享锁；toast 文案留视图侧）。
  - `components/ChannelView.tsx`（-162 净）：删 `ChannelTask` 内联定义（改 re-export）+ `tasks/tasksError/creatingTask/taskNotice` 四 useState + `loadTasks` 内联 GET + `runTaskAction` 内联 claim/update-status fetch + `createTaskFromBoard` 内联 POST；改调 hook（`runTaskTransition` 转发/`convertToTaskInHook` + alreadyTask 文案/`createTaskFromBoardInHook`）；TaskViews 视图与拖拽手势不动（TaskList/TaskBoard/reachable 落点校验保留）；`maxSeq` 解构删除（视图不再直接用，baseSeq 携带收进 hook）。
  - `hooks/useChannelData.test.mjs`（+138，19→25 用例）：6 用例——任务板取列表+兜底+错误、claim 四分支+baseSeq 携带+错误、update-status 携带+held+错误、reopened 标记透出、complete 两步顺序（回复落线程 → in_review，顺序断言）、创建两途径+409 透出。
  - `components/ChannelView.test.mjs`（+25）：04 票回归测试——视图消费 hook 任务板返回、无三路内联残留（tasks GET/claim POST/创建 POST）、hook 侧七纯函数存在、TaskViews/拖拽不动。
- 测试命令结果：`npm test` 378 全绿（hook 25 + 视图 20，基线 371 + 新增 7；本机复验），`node_modules/.bin/tsc --noEmit` 通过（0 error），`npm run lint` 与基线同 7 error（全仓既有 React Compiler memoization，04 改动引入 0 新增 error；新增 warning 已修——`AttachmentRow/ChannelRow` 未使用 import 删除、`convertMessageToTask` 缺 setTaskNotice 依赖加豁免、`combinedFetch` 未使用 init 参数删除；视图侧 `maxSeq/setTasksError/taskOps` 未使用解构删除）。
- 行为变化：零功能变更——任务板加载/claim 让路/complete 两步/创建两途径/切换频道清空+重拉，均与旧内联同语义（创建成功收敛由 convert 本地 append 改统一重拉收敛到服务端事实，可见结果一致；附带修注释"房间版本"残留，无）。
- 遗留：reaction 写回仍经 loadLatest 重拉（05 票前保持）；ThreadPanel 独立任务判定循环保留（SPEC Out of scope）；complete 的线程回复附件形态未暴露（旧内联亦无，视图 Composer 线程回复才有附件）。

### Review（code-review 双轴自审，基 647fe78 → 本票 diff d64609a）

#### Standards（规范：docs/engineering-standards.md + CONTEXT.md + Fowler smell 基线）
- 通过：7 纯函数 fetch 可注入 + 显式返回类型（`Promise<ChannelTask[]>`/`Promise<TaskTransitionResult>`/`Promise<ChannelTask>`），符合"避免 any、测试分层（hook 级 harness、无 testing-library）"；标识符中英分工合规（中文注释+英文标识）；术语词汇合规（module/interface/depth/seam/adapter/leverage/locality 表述，频道禁用 room——本票无 room 残留）；视图 -162 行收敛方向正确。
- 小问题已修 4 个：① hook 未使用 import（AttachmentRow/ChannelRow，经 lint 发现，已删）；② 视图未使用解构（maxSeq/setTasksError/taskOps，已删——taskOps 动作名入口在 hook interface 面，视图经 runTaskAction 转发）；③ `convertMessageToTask` 缺 setTaskNotice 依赖（加 hook 稳定 setter 豁免，与 02/03 票同例）；④ 测试 `combinedFetch` 未使用 init 参数（已删）。
- 判断调用（未改）：hook 返回 30+ 字段 interface 偏宽——属 01→04 渐进收敛的中间态（05 票收尾评估是否拆分），本票不拆，不算 Divergent Change；`parseTaskTransitionBody` 路由契约客户端镜像——属测试锁定语义的最小重复（路由是事实来源，客户端只读镜像），不算 Speculative Generality；`taskOps` 经 useMemo 收敛动作名——与 runTaskTransition/completeTask 同层转发，非 Middle Man（视图只认 runTaskAction，taskOps 是票据 interface 面的显式入口）。
- 工具门禁：`npm test` 378 全绿，`tsc --noEmit` 0 error；eslint 本票改动区 0 新增（全仓 7 error 既有基线，基线 11 problems→当前 10 problems，减少 1 warning）。

#### Spec（对照本票验收标准逐条）
- [x] hook 返回新增 `tasks / tasksError / taskNotice / taskOps{claim,complete,unclaim,...}`——全量返回（另附 setTaskNotice/loadTasks/runTaskTransition/completeTask/convertToTask/createTaskFromBoard 配套，属同一数据循环的必要配套，非 creep）；任务板数据循环（loadTasksPage + claim/complete/unclaim/close/approve/reject/reopen 转移序列，complete 先落线程回复再置 in_review，依赖 hook 内已有 postChannelMessage 发送通道）；TaskViews 视图与拖拽手势不动。
- [x] hook 级测试：claim 让路语义（held/conflict）、complete 两步序列、reopen 封锁标记透出——6 用例覆盖（claim 四分支 + complete 顺序断言 + reopened 透出 + 创建两途径）。
- [x] ChannelView 切到 hook，删除旧内联实现——四 useState + loadTasks 内联 + runTaskAction 内联 fetch + createTaskFromBoard 内联 fetch 已删（视图回归测试断言无三路内联残留；taskNotice/tasksError 状态收进 hook）。
- [x] `npm test` 全绿，`tsc --noEmit` 通过——378/378 + TSC-OK（本审复验）。
- scope creep：无。reaction/ThreadPanel 未动（05 票/SPEC Out of scope 范围）；创建成功收敛改重拉属同语义收敛（可见结果一致），非功能变更；01/02/03/05 范围零触碰。
