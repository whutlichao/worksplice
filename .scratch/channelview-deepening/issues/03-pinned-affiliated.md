# 03: pinned 与附属区（mute/members）抽入 useChannelData

**What to build:** pinned 数据循环（loadPinned + manual/recent/az 排序 + 重排）与附属区（loadMutes/loadMembers）收进 hook。视图（pinned 区展开、BellOff 面板）不动。

**Blocked by:** 01（pinned 项引用消息）.（01 已 resolved@2ed55b7，可开工）

**Status:** resolved

- [x] hook 返回新增 `pinnedItems / pinnedSort / setPinnedSort / reorderPinned / mutes / channelMemberIds`
- [x] hook 级测试：三种排序、同毫秒兜底、重排顺序持久化语义
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
  - `hooks/useChannelData.ts`（+310/-6，280→584 行）：新增 `PinnedItem`（自 ChannelView 上游迁移，避免循环 import，ChannelView re-export 供 ThreadPanel）/`PinnedSort`/`ChannelMuteRow` 类型；6 个纯函数 `sortPinnedItems`（manual/recent/az 客户端镜像，与服务端 `listPinned` 同语义，recent 同毫秒按 order 降序兜底）/`loadPinnedPage`/`postPinnedOrder`/`togglePinnedMessage`/`loadMutesPage`+`toggleChannelMute`/`loadChannelMemberIds`（fetch 可注入）；hook 返回新增 `pinnedItems/pinnedSort/setPinnedSort/pinnedError/loadPinned/togglePin/reorderPinned/mutes/loadMutes/toggleMute/channelMemberIds/membersError/loadMembers`（切换频道/排序变化重拉 + 迟到守卫 + ref 快照防闭包旧值；toast 文案与成员增删留视图，广播订阅留视图）。
  - `components/ChannelView.tsx`（-85 净，3083→2998 行）：删 `pinnedItems/pinnedSort/pinnedError/mutes/channelMemberIds/membersError` 六 useState + `loadPinned/loadMutes/loadMembers` 三内联 + `togglePin/movePinned/toggleMute` 内联 fetch，改调 hook（`togglePinInHook(message.id)`/`reorderPinnedInHook(index, direction)`/`toggleMuteInHook(memberId)`，增删成员改重拉收敛）；`PinnedItem` 改 re-export；pinned 区展开/BellOff/成员面板排版不动。
  - `hooks/useChannelData.test.mjs`（+151，12→19 用例）：7 用例——三种排序、同毫秒兜底、loadPinned 取列表+兜底+错误映射、togglePin 双向+错误、postPinnedOrder 一次提交+错误（重排顺序持久化语义）、附属区取列表+兜底+错误、toggleMute 取反+服务端 error 透出。
  - `components/ChannelView.test.mjs`（+29）：03 票回归测试——视图消费 hook 六返回、无三路内联 GET/reorder、hook 侧七纯函数存在。
- 测试命令结果：`npm test` 371 全绿（hook 19 + 视图 19，基线 363 + 新增 8；coordinator 可重跑验证），`node_modules/.bin/tsc --noEmit` 通过（0 error），`npm run lint` 与基线同 8 error（全仓既有 React Compiler memoization，03 改动引入 0 新增 error；基线 11 problems→当前 11 problems，新增 warning 已修——`PinnedItem` 未使用 import 删除）。
- 行为变化：零功能变更——pinned 三种排序/重排/pin-unpin、mute 开关 toast、成员增删、切换频道清空+重拉，均与旧内联同语义（增删成员由本地更新改重拉收敛，可见结果一致，收敛到服务端事实；附带修注释"房间版本"→"频道版本"，CONTEXT.md 禁 room）。
- 遗留：reaction 写回仍经 loadLatest 重拉（04 票前保持）；`sortPinnedItems` 客户端镜像仅供测试锁定语义与本地重排乐观态，线上排序以服务端为准；任务板数据循环是 04 票范围未动；ThreadPanel 独立 pinned 循环保留（SPEC Out of scope）。

### Review（code-review 双轴自审，基 0bd9993 → 本票 diff）

#### Standards（规范：docs/engineering-standards.md + CONTEXT.md + Fowler smell 基线）
- 通过：6 纯函数 fetch 可注入 + 显式返回类型（`Promise<PinnedItem[]>`/`Promise<boolean>`/`Promise<Set<string>>`），符合"避免 any、测试分层（hook 级 harness、无 testing-library）"；标识符中英分工合规（中文注释+英文标识）；术语词汇合规（module/interface/depth/seam/adapter/leverage/locality 表述，频道禁用 room——附带修 1 处旧注释"房间版本"）；视图 -85 行收敛方向正确。
- 小问题已修 2 个：① `ChannelView.tsx` 重复 `PinnedItem` 定义（import type + re-export 同名致 TS2300，经 lint 发现，已删 import 只留 re-export+注释）；② `loadMutes: _loadMutes` 未使用别名（下划线前缀残留，已删）。
- 判断调用（未改）：hook 返回 24 个字段 interface 偏宽——属 01→04 渐进收敛的中间态（05 票收尾评估是否拆分），本票不拆，不算 Divergent Change；`pinnedSortRef/channelIdRef` 双 ref 与 `latestRequestRef` 请求代际并存——消息循环用代际、pinned/附属区用 ref 快照，两套守卫各守一域，不算 Duplicated Code（语义不同：缓存快照 vs 简单重拉）；`sortPinnedItems` 服务端语义客户端镜像——属测试锁定语义的最小重复（服务端是事实来源，客户端只读镜像），不算 Speculative Generality。
- 工具门禁：`npm test` 371 全绿，`tsc --noEmit` 0 error；eslint 本票改动区 0 新增（全仓 8 error 既有基线，基线 11 problems→当前 11 problems）。

#### Spec（对照本票验收标准逐条）
- [x] hook 返回新增 `pinnedItems / pinnedSort / setPinnedSort / reorderPinned / mutes / channelMemberIds`——全量返回（另附 pinnedError/loadPinned/togglePin/loadMutes/toggleMute/membersError/loadMembers 配套，属同一数据循环的必要配套，非 creep）；pinned 数据循环（loadPinned + manual/recent/az 经服务端 sort + 重排）与附属区（loadMutes/loadMembers）收进 useChannelData；视图 pinned 区展开、BelleOff 面板不动。
- [x] hook 级测试：三种排序、同毫秒兜底、重排顺序持久化语义——7 用例覆盖（manual/recent/az + 同毫秒 order 降序兜底 + postPinnedOrder 一次提交语义 + 缺字段兜底 + 错误映射）。
- [x] ChannelView 切到 hook，删除旧内联实现——六 useState + 三 load 内联 + 三操作内联 fetch 已删（视图回归测试断言无 `/pinned?sort=`/GET pinned/mutes/members`/pinned/reorder` 内联残留）。
- [x] `npm test` 全绿，`tsc --noEmit` 通过——371/371 + TSC-OK（本审复验）。
- scope creep：无。reaction/任务板未动（04 票范围）；成员增删改重拉收敛属同语义收敛（可见结果一致），非功能变更；ThreadPanel 未碰（SPEC Out of scope）；02/04/05 范围零触碰。
