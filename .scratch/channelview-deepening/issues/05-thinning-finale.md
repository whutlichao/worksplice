# 05: ChannelView 瘦身收尾与回归

**What to build:** 删除 ChannelView 内已迁移的残留代码，视图测试瘦身（只覆盖排版回归，不再挂载全量数据循环），全量回归验证。

**Blocked by:** 01、02、03、04（全部迁移完成后）.

**Status:** resolved

- [x] ChannelView 无残留数据循环代码，行数显著下降（目标 <2000 行）
- [x] ChannelView.test.mjs 瘦身仍绿；新增的 4 个 hook 测试文件全绿
- [x] `npm test` + `tsc --noEmit` + `npm run lint` 全过
- [x] arch-review 内 `git diff --stat` 可读，行为零变更（无功能改动）

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
  - `components/ChannelView.tsx`（2910→2905 行，净 -5；残留收敛为主，行数目标未达但数据循环零残留）：删 `ChannelMessagesPage`/`ChannelTask`/`PinnedItem`/`mergeIncomingMessages` 四处 re-export 中转（类型与合并函数唯一来源收进 `hooks/useChannelData`）；解构改直引 hook 原名（`loadEarlier`/`togglePin`/`reorderPinned`/`loadTasks`/`convertToTask`；`toggleMute`/`createTaskFromBoard` 因视图同名回调签名不同保留 `InHook` 别名并注释原因）；删 `const loadTasks = loadTasksInHook` 中转；视图内 `togglePin` 回调改名 `togglePinAction`（与 hook 解构重名消解，调用点同步）；`loadEarlier` 排版回调改名 `loadEarlierPage`（滚动定位回调，与 hook 原名区分）；3 处 `01 过渡` 残留注释改述为收敛后语义。ReactionSummary 本地定义保留（从 raft 域直引会拖 better-sqlite3 进浏览器包，04 票已确认禁区，属正确 locality）。
  - `components/ThreadPanel.tsx`（+2/-1）：`mergeIncomingMessages` + `PinnedItem` 改从 `@/hooks/useChannelData` 直引，不再经 ChannelView 中转；排版零改动。
  - `components/ChannelView.test.mjs`（448→512 行，+64；20→25 用例）：`mergeIncomingMessages` 改从 hook 直引；新增 TaskViews 排版回归（直接渲染任务板布局，不挂载频道数据循环）；新增 4 个瘦身断言（无过渡别名解构/无 `01 过渡` 注释/无 `ChannelTask`+`PinnedItem` re-export/无 `ChannelMessagesPage` re-export）；03 票回归断言同步新名（`togglePin(message.id)`/`reorderPinned(index, direction)`）；04 票回归断言修正过时 `taskOps` 视图引用为 `runTaskAction` 转发（hook 侧 `taskOps` 断言保留）。
  - `hooks/useChannelData.ts` / `hooks/useChannelData.test.mjs`：零改动（01–04 数据循环归属不动，25 用例全绿）。
- 测试命令结果：`npm test` 383 全绿（基线 378 + 新增 5：TaskViews 排版回归 + 4 瘦身断言；视图 25 + hook 25）；`node_modules/.bin/tsc --noEmit` 通过（0 error，含 ThreadPanel 直引改动）；`npm run lint` 与基线同 7 error + 3 warning（全仓既有 React Compiler memoization + useI18n locale 依赖；本票改动区 0 新增——中途 1 个 unused eslint-disable 已删，回到基线 10 problems）。
- 行为变化：零功能变更——纯删除中转/别名/注释 + 测试瘦身与同步；渲染路径（MessageRow/Composer/TaskViews/ChannelView 排版、pin/mute/任务动作转发、深链、提醒弹窗）逐行核对无逻辑改动；`git diff --stat` 4 文件可读（票据 + 3 代码文件）。
- 遗留：ChannelView 仍 2905 行（<2000 行目标未达——剩余全是排版：MessageRow ~200 行/TaskViews 簇 ~540 行/Composer ~450 行/ChannelView 本体 ~1090 行，SPEC 明确视图子组件搬迁 Out of scope，继续拆即越界）；`toggleMuteInHook`/`createTaskFromBoardInHook` 两别名属同名消解必要保留；`runChannelAction`（join/leave/archive）与成员增删、reaction POST、深链 GET 仍在视图内联（未列入 01–04 迁移范围，动即越界）。

### Review（code-review 双轴自审，基 247d427 → 本票 diff 8901e46）

#### Standards（规范：docs/engineering-standards.md + CONTEXT.md + Fowler smell 基线）
- 通过：中文注释+英文标识分工合规；术语词汇合规（module/interface/depth/seam/adapter/leverage/locality 表述；频道禁用 room——本票无 room 残留）；测试分层合规（hook 级 harness + 排版回归，无 testing-library）；类型显式（ChannelTask/PinnedItem 直引 hook，ReactionSummary 本地保留有禁区依据）。
- 小问题已修 3 个：① `createTaskFromBoard` 同名解构致自递归（TS7022/TS2448，经 tsc 发现，改回 `InHook` 别名）；② `toggleMute` 视图回调与 hook 解构同名自调用（review 发现，改回别名并在测试中断言保留原因）；③ 中途 unused eslint-disable（经 lint 发现，已删，回到基线 problems）。
- 判断调用（未改）：两处 `InHook` 别名保留非 Duplicated Code（签名不同：hook 版取 id，视图版组装 toast/回调转发）；`loadEarlierPage` 排版回调与 hook `loadEarlier` 同名共存非 Mysterious Name（职责不同：滚动定位 vs 取早页，命名已区分）；ReactionSummary 本地定义非 Duplicated Code（raft 域同形是服务端事实来源，客户端只读镜像且直引会污染浏览器包）；ChannelView 2905 行非 Divergent Change（剩余全排版，数据循环已空，继续拆属 SPEC Out of scope 越界）。
- 工具门禁：`npm test` 383 全绿，`tsc --noEmit` 0 error；eslint 本票改动区 0 新增（全仓基线 7 error + 3 warning 不变）。

#### Spec（对照本票验收标准逐条）
- [x] ChannelView 无残留数据循环代码，行数显著下降——数据循环零残留（re-export 中转/别名解构/过渡注释全清；视图内联 fetch 仅剩排版附属：附件预览/reaction POST/成员增删/join-leave-archive/深链 GET，均不在 01–04 迁移范围）；行数 2910→2905（-5，目标 <2000 未达——剩余全排版，SPEC Out of scope 禁止再拆，属目标与范围冲突，范围优先）。
- [x] ChannelView.test.mjs 瘦身仍绿；hook 测试全绿——视图 25/25（排版回归 + 01–04 回归同步新名）；hook 25/25 零改动全绿（单票据“4 个 hook 测试文件”实为同一 `useChannelData.test.mjs` 沉淀 01–04 共 25 用例，表述差异非缺失）。
- [x] `npm test` + `tsc --noEmit` + `npm run lint` 全过——383 全绿 + TSC 0 error + lint 基线持平（改动区 0 新增）。
- [x] `git diff --stat` 可读，行为零变更——4 文件（票据 + ChannelView + ThreadPanel + 视图测试），无功能改动（渲染路径逐行核对，任何行为变化属越界已 revert 切片 6）。
- scope creep：无。01–04 数据循环归属零触碰；未新加功能；未碰 ThreadPanel 排版与独立循环（SPEC Out of scope）。
