# 04 — 线程迁入右栏

**What to build:** 线程从 channel 内部侧栏迁入右栏容器的 thread 变体：锚点 + 消息列表 + composer（freshness baseSeq 按线程末条 seq）+ 分页 + 面板局部引用态 + 自带 3s 轮询（后台 tab 暂停、卸载清理）；"在线程中回复"与任务卡片入口改路由到右栏；channel 内线程侧栏状态与渲染删除。

**Blocked by:** 03 — 右栏容器 + 人类资料卡

**Status:** resolved

- [x] 消息"在线程中回复" → 线程在右栏打开，中央频道不动
- [x] 任务卡片点击 → 任务线程在右栏打开
- [x] agent 在任务线程的回复经面板轮询自动出现（≤3s，后台 tab 暂停、卸载清理）
- [x] 右栏线程内发消息：freshness 按线程 seq 空间，held 时提示 + 重拉线程
- [x] 线程打开期间中央频道轮询持续运行，两者并存
- [x] 切 channel → 面板清空（线程状态随容器销毁）
- [x] 线程轮询 setInterval 源码断言测试 + tsc + eslint + node --test 通过

## Answer

实现随 commit `d580305`（#13）落地，逐项验收：

- **"在线程中回复"/线程角标 → 右栏**：`ChannelView.tsx:2686`（`onReply`）与 `:2693`（`onOpenThread` 角标）统一路由 `onOpenPanel({ kind: "thread", id })`；`AppShell.tsx` 中央（centerSelection）与面板（panelContent）状态解耦——打开线程不触碰中央频道消息流与阅读位置
- **任务卡片点击 → 任务线程右栏打开**：`ChannelView.tsx:1002` 卡片点击 → `onOpenThread(task.anchor)` → `:2737` `onOpenPanel`
- **面板轮询自动收 agent 回复**：`ThreadPanel.tsx:167-185`——`THREAD_POLL_MS=3000`，`document.hidden` 后台暂停，卸载 `clearInterval` + `cancelled` 标志；增量 `mergeIncomingMessages`（id 去重 + seq 排序）
- **freshness 按线程 seq 空间**：`ThreadPanel.tsx:201-236`——`baseSeq = 线程最后一条 seq`；`held` → `loadThread(anchorId)` 重拉 + 提示 `t("message.held")`，不静默丢消息
- **两套轮询并存**：中央 `ChannelView` 自有 `INBOX_POLL_MS` effect（`ChannelView.test.mjs` 断言其存在），面板轮询独立 effect——打开线程期间中央照常轮询
- **切 channel → 面板清空**：`AppShell.tsx:197` `handleSelectChannel` → `onChannelSwitched(prev)`（面板随容器销毁，线程状态不残留）
- **测试通过**：`components/DetailPanel.test.mjs`（14 例：thread 变体渲染锚点/消息/加载态 + ThreadPanel 轮询 `setInterval`/`THREAD_POLL_MS`/`document.hidden`/清理的源码断言 + 轮询自愈断言）+ `lib/panel-state.test.mjs` 全绿；`tsc --noEmit` 干净；`npm run lint` 干净；全量 `node --test` 566/568 通过（2 例失败为存量环境依赖问题——`lib/skill-lock.test.mjs` 取真实 HOME、`app/api/models-config/test/route.ts` 被 `node --test` 误当测试文件加载 `next/server`——均与本次无关，文件自 repo bootstrap 后未改动）

**Code review 修正**：Spec 轴发现"初始拉取失败后锚点永不自愈"（`ThreadPanel` 轮询 `setAnchor` 在 `prev` 为 null 时丢弃 `body.anchor`，线程永久停留无锚点空列表，违反验收 3）——已修复为 `!prev || prev.id === body.anchor.id`（轮询自愈采纳锚点），并补源码断言测试。

备注：同 commit 亦包含 01–03（panel-state 纯模块 / 状态解耦非长驻右栏 / 容器 + 人类资料卡），验收随本 commit 一并完成。
