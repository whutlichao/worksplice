# 双轴 code-review 处置记录（`.scratch/thread-open-scroll/issues/01-thread-open-scroll.md`）

两份报告由两个独立 subagent 各跑一轴（Standards / Spec），互不可见；本文件只记结论与逐条处置。

## Standards

报告结论：**OK with notes（无硬违规）**。确认干净的 hunk 含：`tasks.ts` 经 `getDb().getTaskThreadRead()`
读游标（Store 契约、无 SQL、不 import adapter，符合「服务层 = 唯一事实来源」）；无新增色族 / 视觉 token /
emoji / `next build`；`data-thread-message-seq` 用 data 属性（先例 `data-notice` / `data-line-number`），
形态仍归 CSS；渲染期写 ref 是仓库既有形态。

findings 处置：

| # | Finding | 处置 |
| --- | --- | --- |
| S1 | **P2 硬（注释与契约失实）**：`lib/panel-state.ts` 文件头仍写「纯函数、无副作用…AppShell 仅消费这里导出的规则」，但新增的 `applyThreadInitialScroll` 会写 `port.scrollTop`，消费方是 `ThreadPanel` 不是 AppShell | **已修**：文件头改为「两类消费者」段落，写明 `applyThreadInitialScroll` 是唯一触容器的一侧、容器由调用方提供 |
| S2 | **P2 判断题（Magic literal 替代领域常量）**：`input.ownerId ?? "owner"` 把 `OWNER_MEMBER_ID` 抄成字面量 | **已修**：改引 `OWNER_MEMBER_ID`（相对路径 `./data/schema.ts`，理由见下 S5） |
| S3 | **P2 判断题（Mysterious Name / Middle Man）**：`onReplyAdapter` 只转手却同时挂到 `onReply` 与 `onOpenThread`，名字谎称只服务 reply | **已修**：改名 `openThreadPanelForMessage`（并按 S4 把锚点回查提成 `openAnchorTaskThread`） |
| S4 | **小（Duplicated Code）**：`ChannelView` 两处同样的「按锚点查 task 再开面板」两行 | **已修**：提取 `openAnchorTaskThread(anchorId)`，pinned 跳转与深链共用 |
| S5 | **小（非空断言）**：闭包内 `input.readSeq!` | **已修**：提到局部 `const readSeq` 后收窄生效 |
| S6 | **P2 判断题（Duplicated Code，建议只登记）**：未读判据在 SQL（`sqlite.ts`）与 TS（`panel-state.ts`）各一份 | **登记不改**，与报告一致：票面明确要求纯函数 seam；把规则上收到 collab 会把 `better-sqlite3` 拖进 client 包（AGENTS.md 记录的 `lib/preview.ts` 同款陷阱）。`panel-state.ts` 的注释已写明「与 `countUnreadTaskThreadReplies` 同一份口径」 |

S2 引常量时踩到一个新问题并已一并处置：`lib/panel-state.ts` 被 `lib/panel-state.test.mjs`
以**裸 node:test** 直接 import，不吃 tsconfig 的 `@/` 别名（jiti 才吃）——用 `@/lib/data/schema`
会让该用例 `ERR_MODULE_NOT_FOUND`（全量 `npm test` 实测 1 fail）。改为相对路径 `./data/schema.ts`：
`schema.ts` 对 better-sqlite3 只有 `import type`，运行时不拉依赖，client 安全。该 broken 状态是
自审发现的，未在报告里。

## Spec

报告结论：**OK with notes**。确认三条落点规则**首开**实测成立、判据与 `countUnreadTaskThreadReplies`
同口径（`sqlite.ts` 不在 diff 内）、轮询不抢滚动成立、红绿证据可信（red = pass 1 / fail 15，
green = pass 16 / fail 0）。

findings 处置：

| # | Finding | 处置 |
| --- | --- | --- |
| P1 | **规则 2 在「二次打开」时被违反**：`taskReadSeq` 取自 tasks 客户端缓存，而 `mergeTaskUnreadCounts` 只合并 `unreadReplyCount` / `latestUnreadReplyAt`，**永不刷新游标**；关面板也不重拉 | **已修（scope 扩展，coordinator 授权）**：逐秒实测确认不是报告推测的「3s 窗口」而是**只要不切走频道就永久陈旧**（`browser-reopen-window-probe.log` 1..8s 逐秒重开全落旧的最早未读）；把 `taskThreadReadSeq` 加进 `mergeTaskUnreadCounts` 的合并字段集，红→绿日志 `red/green-mergeTaskUnreadCounts.log`，修复后复测见 `browser-reopen-window-probe-after.log` |
| P2 | **lint zero-new 未满足**：`ChannelView.tsx:3094`（多余依赖 `onOpenPanel`）与 `:3184`（缺 `taskIndexes.byMessageId`）两条新增 warning | **已修**：把 tasks 索引改经 ref 读取、收口 `openAnchorTaskThread` 后，`after-lint.log` 与 `baseline-lint.log` 逐字一致（仅既有 `hooks/useI18n.tsx:61`） |
| P3 | **`dock.test.mjs` 未改**（Target 里写了「若因 props 变化失效需同步」）；Answer 仍空 | `taskReadSeq` 是可选 prop，`dock.test.mjs` 的 ThreadPanel 渲染不传它 ⇒ 未失效，无需改动（报告亦确认其用例全过）；Answer 随本文件落盘 |
| P4 | **规则 3「与现状一致」措辞存疑**：base 版 ThreadPanel 无任何滚动代码 | 属实：base 无自动滚动（打开停在顶部），票面把「初始落点」定为**新行为**（底部）并要求「缺失 taskId 时不报错、不降级成顶部」。已按票面实现为落底部，并把这一点写进 `run-browser-acceptance.sh` 的场景 3 断言 |

### 自审另发现并已修（报告未覆盖，浏览器实测暴露）

| # | 问题 | 处置 |
| --- | --- | --- |
| A1 | **面板内换线程时落点用错 anchor**：新 `anchorId` 的 effect 会先带着**上一条线程的 anchor** 跑一轮（anchor state 在后一个 effect 里重拉），此时判定用的是上一条的消息 ⇒ 实测普通 thread 被停到**顶部**（规则 3 违反） | **已修**：落点门控加 `threadReady`（`anchor?.id === anchorId`）；被陈旧 anchor 拦下的那一轮**不写 `landedRef`**，否则真正就绪那轮不再落点——修复后 `s3_plainThread` 回到 `atBottom: true`。回归断言写在 `components/thread-open-scroll.test.mjs` |
| A2 | **`offsetTop` 相对 offsetParent 而非滚动容器**：实测差 58px，落点越过该行顶部（未贴合） | **已修**：改按视口矩形差算并减掉容器上内边距（`getComputedStyle(container).paddingTop`）；修复后 `s1` 实测 `firstVisibleSeq=9`、`offsetFromTop=+0px` |
