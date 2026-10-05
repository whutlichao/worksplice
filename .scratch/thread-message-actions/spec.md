# 线程消息操作气泡收窄：只留 表情 / 引用 / 复制链接

日期：2026-10-05 · 票据：`.scratch/thread-message-actions/issues/01-thread-message-actions-bubble.md`（Type: grilling）
性质：**设计票**，本文件不含任何源码改动；改写由后续实施票落地。
本文件即本 effort 的 spec 正本，位置依 `docs/agents/issue-tracker.md` 的约定（`.scratch/<feature-slug>/spec.md`）。

## Problem Statement

用户诉求原话：「在任务线程对于某条消息操作气泡中，我觉得应该只留表情添加，引用，链接复制，其余都不需要，你觉得是否合理。」

诉求指向的现状是：消息动作栏（`MessageActions`，`components/ChannelView.tsx:582`）被**频道主流程与右栏线程面板共用**，一次渲染六个按钮。其中三个已经按 optional prop 门控——表情入口 `onToggleReaction && onToggleReactOpen`（`components/ChannelView.tsx:618`）、设提醒 `onReminder`、Pin `onTogglePin`——只有「回复」是**无条件渲染**（`components/ChannelView.tsx:631-638`），它的 prop 也是六个里唯一必填的（`components/ChannelView.tsx:595`，`MessageRow` 侧同样必填于 `components/ChannelView.tsx:843`）。

线程面板的两个调用点都传 `onReply={() => undefined}`（`components/ThreadPanel.tsx:383` 锚点行、`components/ThreadPanel.tsx:407` 线程内消息行）。由此产生两处**假 affordance**：

1. 线程内 hover 浮出的气泡里点「回复」，什么也不发生；
2. 右键菜单的 items（`components/ChannelView.tsx:872-877`）恒以 `{ label: t("message.reply"), onClick: () => onReply(message) }` 开头（`components/ChannelView.tsx:873`），在线程里同样点了没反应。因为这一项恒在，`items.length > 0` 恒真，菜单在没有任何可执行项时照样弹出。

所以诉求里「其余都不需要」这个判断，在**线程面上有一半是准确的**——六键里的 Reply 与 Pin 确实是线程内的低价值或无价值项，⏰ 则相反：它是 §5.6「消息锚定提醒 → 到点系统消息 → 从线程回复角标发现线程内进展」这条链在面板内唯一的创建入口。诉求本身没有回答的三个问题是：**只改线程还是两个面一起收**（两个面共用一个模块）、「回复」那两处死 affordance 怎么处置、以及被砍掉的动作有没有替代入口。本文件把这三点连同表情形态、文档同步一起问透。

需要收窄的两条**已写明裁决**：`AGENTS.md:434`「动作栏 `Pin`（pinned 态黄底）channel/thread 消息通吃」、`AGENTS.md:425` 与 `AGENTS.md:240`「消息动作栏 ⏰（目标 = 该消息/thread 锚点，标题预填首行预览）」。收窄它们必须有自己的论证与交代。

## Solution

裁决 D1–D6 逐条如下（「人定」= 决策类问题问回来由人拍板；「代答」= 实现手感类问题，带理由自行记账）：

| 决策 | 裁决 | 来源 |
| --- | --- | --- |
| **D1 scope** | **只收窄线程面，频道面一字不动。** 收窄机制 = 把 `onReply` 从必填 prop 变可选 + 右键菜单 items 改为只由「有真实回调的可选项」组装 | 人定 |
| **D2 线程两处「回复」** | **删掉。** hover 气泡不渲染 Reply；右键菜单 items 不再恒含 reply 首项；items 为空时不弹菜单（现有守卫已覆盖，零新增代码）。频道面右键菜单维持 `[在线程中回复 / 转为任务]` 不变 | 人定 |
| **D3 线程内 Pin** | **彻底删除**——不进 hover 气泡，也**不进**线程右键菜单。置顶动作只能在频道主流程做 | 人定 |
| **D4 锚点消息 ⏰** | **保留在 hover 气泡里**（仅锚点消息有，线程内消息行本来就没有）。`AGENTS.md:425` / `AGENTS.md:240` 两条裁决**不被收窄** | 人定 |
| **D5 表情添加形态** | **保持二级**：点 SmilePlus 才展开 👍❤️🎉👀 快捷条 + ＋ 选择器，不改成 hover 直出 | 代答 |
| **D6 文档同步** | **本票只记录待改写段落清单，改写随实施票落地**——`AGENTS.md` 描述当前实现，设计票阶段改它会让文档先于代码说谎 | 代答 |

D1 的裁决依据：用户诉求只点名了任务线程；频道面的 Reply 并不坏——`message.reply` 的中文文案是「在线程中回复」（`lib/i18n/messages/zh-CN.ts:462`），而频道面传的是 `onReply={openThreadPanel}`（`components/ChannelView.tsx:3642`，`openThreadPanel` 定义于 `components/ChannelView.tsx:2481`），其行为正是打开右栏线程面板。**标签与行为自洽**，频道面没有要修的东西，因此不扩 scope。

D5 的代答依据：(a) `AGENTS.md:434` 现有措辞「消息 hover 快捷 reaction（👍❤️🎉👀）+ ＋ 选择器（24 常用 emoji 网格）」描述的就是现有两级形态，改成 hover 直出会收窄这条已写明裁决；(b) 用户原话只要求「只留表情添加」，没有要求改表情的交互形态，不动就是忠于诉求；(c) 补充代价账：Pin 与 Reply 删掉后气泡只剩 3–4 键，再直出 4 个 emoji 会把 hover 气泡撑到 7 键，右栏窄面板里换行风险上升；24 常用 emoji 仍经 ＋ 选择器可达，功能不丢。

### 线程面最终按钮清单

`ThreadPanel`（`components/ThreadPanel.tsx:374` 锚点行 / `:398` 线程内消息行）hover 浮出的动作栏：

| 按钮 | 触发行为 | 是否 hover-only | 去掉后的替代入口 |
| --- | --- | --- | --- |
| 表情添加（SmilePlus） | 展开二级快捷条 👍❤️🎉👀 + ＋ 选择器（`QUICK_REACTIONS` 见 `components/ChannelView.tsx:115`），点 emoji 即 toggle reaction | 是 | 无（保留项） |
| 引用（Quote） | 面板局部引用态 `setQuoting`（`components/ThreadPanel.tsx:384` / `:408`），引用 chip 出现在面板底部 composer | 是 | 无（保留项） |
| 复制链接（Link） | 复制 `#c/<channelId>?m=<messageId>` 深链，1.2s 内图标切 Check | 是 | 无（保留项） |
| 设提醒（⏰ AlarmClock） | 打开 `ReminderModal`，目标 = 该锚点消息，标题预填首行预览（`components/ThreadPanel.tsx:387`，`joined` 时） | 是 | 无（保留项；线程内消息行本就没有） |
| ~~回复（Reply）~~ | **删除**——此前是死按钮 | — | 面板底部 composer 本身就是该线程的回复入口，且常驻可见 |
| ~~Pin~~ | **删除**——迁不走也不保留 | 是（此前） | 置顶只能在频道主流程做；**已置顶的线程消息仍可达**：频道头部 pinned 区点击条目会定位频道内消息或展开线程（`openPinnedMessage` 见 `components/ChannelView.tsx:2739`，渲染于 `:3465` 起） |

线程面右键菜单（`MessageRow` 内的 `ContextMenu`，`components/ChannelView.tsx:731`）：

| 消息类型 | 菜单项 | 说明 |
| --- | --- | --- |
| 锚点消息，未转任务 | `转为任务`（`components/ThreadPanel.tsx:386`） | 唯一项 |
| 锚点消息，已是任务 | *（空）* | 不弹菜单 |
| 线程内消息 | *（空）* | 不弹菜单 |

**「回复」死 affordance 的显式处置**：线程 hover 气泡的 Reply（`components/ThreadPanel.tsx:383` / `:407` 传空函数导致）与线程右键菜单的 Reply（由 `components/ChannelView.tsx:873` 恒定注入导致）**一并删除**，做法不是「传空函数让按钮不做事」而是「不传这个 prop，让按钮与菜单项根本不存在」——因为假 affordance 的代价不是点下去没反应，而是**用户会反复尝试并怀疑自己的操作**。删除后线程内消息右键不再弹出任何菜单（items 为空 → `components/ChannelView.tsx:1032` 的 `menu && items.length > 0` 守卫不成立），这是**刻意接受的行为变化**：弹出点什么都不能按的框是假 affordance 的最后残留。

### 频道面最终按钮清单

`ChannelView`（`components/ChannelView.tsx:3634`）——**本票零改动**，此处列出以固定「不动的边界」：

| 按钮 | 触发行为 | 是否 hover-only | 备注 |
| --- | --- | --- | --- |
| 表情添加（SmilePlus） | 同上，两级形态不变 | 是 | — |
| 回复（Reply） | `openThreadPanel` → 右栏线程面板 | 是 | 文案「在线程中回复」与行为自洽，见 Further Notes |
| 引用（Quote） | 中央 composer 引用态 | 是 | — |
| 复制链接（Link） | 复制深链 | 是 | — |
| 设提醒（⏰） | 打开 `ReminderModal`，目标 = 该消息 | 是 | — |
| Pin | pin / unpin 本频道消息 | 是 | 线程侧删除后，Pin 成为**频道面专属**动作 |

频道面右键菜单维持 `[在线程中回复 / 转为任务]` 不变。

## User Stories

1. 作为在任务线程里跟进讨论的人，hover 一条消息时只看到「表情 / 引用 / 复制链接 / 设提醒（仅锚点）」四个键，气泡窄了一截，不会在一个点下去毫无反应的「回复」上浪费点击。
2. 作为在任务线程里跟进讨论的人，右键一条**线程内**消息时不再弹出一个只有死项的菜单（不弹比弹空框诚实）；右键**锚点**消息仍能「转为任务」。
3. 作为想把某条线程内消息置顶的人，知道这件事要在频道主流程做——而一旦置顶，从频道头部 pinned 区点它仍能展开线程（既有能力，不因本票丢失）。
4. 作为给锚点消息设过提醒的人，设提醒的入口仍在锚点行的 hover 气泡里，到点后仍能从锚点行的线程回复角标发现进展（§5.6 场景链完整）。
5. 作为频道主流程的日常使用者，消息动作栏的六个键、右键菜单的两项、hover 才浮出的节奏**全部保持原样**——本票不改变频道内的任何操作。

## Implementation Decisions

1. **收窄机制 = 补齐已有的 optional-prop 门控，不新增形状。** `MessageActions` 六个按钮里已有三个按 optional prop 门控，「哪个面」这个问题在现有形状里已经有答案：`onReply` 是唯一漏网的必填项。改动共三处：
   - `components/ChannelView.tsx:595` 与 `components/ChannelView.tsx:843`（`MessageActions` 与 `MessageRow` 两处 prop 类型）：`onReply: (...) => void` → `onReply?: (...) => void`。
   - `components/ChannelView.tsx:631-638` 的 Reply 按钮块包一层 `{onReply && ( ... )}`，与紧邻的 `onToggleReaction` 门控（`:618`）同形。
   - `components/ChannelView.tsx:872-877` 的 `items` 改为只由可选项组装：reply 项包 `...(onReply ? [...] : [])`，与紧随其后的 convert 项（`:874-876`，已是 `...(cond ? [...] : [])` 形状）同形。
   - `components/ChannelView.tsx:1020` 的透传 `onReply={onReply}` 不改（可选值透传为 `undefined` 是合法的）。
2. **空菜单不弹是既有守卫的自然结果，零新增代码。** `components/ChannelView.tsx:1032` 已是 `{menu && items.length > 0 && (`。这意味着 **D2 不需要为「线程内消息右键」写任何分支**——items 空 ⇒ 不弹。判据：不为了「让空菜单出现」而改守卫。
3. **线程面 prop 改动清单**（`components/ThreadPanel.tsx`）：锚点行（`:374`）删 `onReply`（`:383`）与 `onTogglePin`（`:389`）；线程内消息行（`:398`）删 `onReply`（`:407`）与 `onTogglePin`（`:411`）。**保留** `onQuote`（`:384` / `:408`）、`onCopyLink`（`:385` / `:409`）、`onToggleReaction`（`:388` / `:410`）、锚点行的 `onSetReminder`（`:387`）与 `onConvertToTask`（`:386`）。`pinned` prop（`:378` / `:402`）随之不再传——它在 `MessageActions` 里只服务于 Pin 按钮的 label 与黄底态，Pin 一走就没有消费者。
4. **线程面死代码清扫清单**（Pin 从线程消失后的必然连带，`components/ThreadPanel.tsx`）：`pinnedItems` state（`:58`）、`PinnedItem` type import（`:9`）、`notifyPinnedChanged` import（`:13`）、`loadPinned`（`:113`）及其挂载 effect（`:124-126`）、`togglePin`（`:259-282`，含 `notifyPinnedChanged()` 调用点 `:276`）。核验依据：`pinnedItems` 在本模块内只被 `togglePin`（`:262`）与两处 `pinned=` prop（`:378` / `:402`）消费，`togglePin` 只被两处 `onTogglePin=` 消费——删掉入口，整条回路无残留消费者。**不删** `loadTasks`（`:129`，锚点转任务的判定要用）。
5. **⚠️ 面板↔中央 pinned 广播总线将变成无生产者的空壳**（本决策的次生后果，实施票必须显式裁决，不得默认留着）。`notifyPinnedChanged` 在 `lib/panel-state.ts:60` 定义，全仓唯一调用点是 `components/ThreadPanel.tsx:276`；其订阅方 `subscribePinnedChanged` 在 `components/ChannelView.tsx:2542` 挂载。Pin 从线程删除后，生产者归零，订阅方永不触发。两条路：(a) 连同 `lib/panel-state.ts:53-63` 的这对函数、`ChannelView.tsx:2542` 的订阅 effect、`AGENTS.md:220` 的描述一并删除；(b) 保留为扩展点。**本票推荐 (a)**——判据是 `lib/panel-state.ts` 是窄模块（单槽面板状态 + 少量订阅），留一个没有生产者的订阅总线正是本仓 `channelview-deepening` effort 一直在削的浅层残留；但这是实施票的活，实施票若选 (b) 必须在 Answer 里写明理由。
6. **i18n 键不删。** `message.reply`（`lib/i18n/messages/zh-CN.ts:462` / `lib/i18n/messages/en.ts:473`）仍被频道面按钮与频道面右键菜单使用，只是不再被线程面渲染。删除键会连带删掉频道面的文案，属于 D1=A 禁止的频道面改动。
7. **频道面零改动清单（实施票的验收红线）**：`components/ChannelView.tsx:3634-3650` 的调用点不动；`openThreadPanel`（`:2481`）不动；`MessageActions` 里 Quote / Link / ⏰ / Pin 四个按钮块与 reaction 二级条不动；`ChannelView` 的右键菜单 items 组装结果不变（频道面仍恒有 reply 项）。
8. **拆票方案：1 票**（本 effort 只需一张实施票，票间依赖为空）：
   - **票 01 `thread-message-actions-narrowing`**：交付 = `MessageActions`/`MessageRow` 的 `onReply` 转可选 + Reply 按钮与菜单项门控 + `ThreadPanel` 两处调用点删 `onReply`/`onTogglePin`/`pinned` + 线程面 pinned 回路死代码清扫 + 决策 5 的总线存废裁决 + `AGENTS.md:246` / `AGENTS.md:220` 改写。**Blocked by**：无。
   - 之所以不拆：六处改动共享同一根因（`onReply` 必填导致线程面无法收窄），拆成两票会让中间态既不满足用户诉求又不满足任何测试断言；改动量以「单文件 ~30 行 + 单文件 ~60 行」计，落在同一票内可一次走完 `/implement` 的红-绿循环。
9. **收窄机制被否决的备选形状（记录以免下一个人重提）**：(i) `variant="thread" | "channel"` prop——把两个面的差异塞进模块内部，换来一次接口改动、付出的是「哪个面」的分支渗进实现，depth 反而变浅；(ii) 拆成 `ChannelMessageActions` 与 `ThreadMessageActions` 两个模块——locality 好，但六个键里四个（表情/引用/链接/⏰）的实现逐字相同，等于把一段 UI 复制两份换一个可数的差异；(iii) 动作注册表（`actions: Array<{id, icon, label, onClick}>`，由调用方组装）——leverage 最高，但它是比本诉求大一个量级的改写，且本诉求的全部需求已被「补齐已有门控」覆盖。三者都在「为两个面的三键差异新建机制」的量级上超出诉求。

## Testing Decisions

- **本票无被测对象**（不改一行源码），故不跑测试、不做双轴 code-review、不跑 typecheck/lint。设计票的门禁是文档与裁决的完整性。
- **既有测试的受影响面已核（实施票的起点）**：`components/ChannelView.test.mjs` 四个 `MessageRow` 用例——`:47`（断言 `title="Reply in thread"`，用例名「the three §3.2 actions」）、`:67`（⏰ 入口）、`:84`（三个 handler 触发）、`:299`（reaction 快捷条 + Pin + 附件）——**全部显式传了 `onReply`**，因此把 `onReply` 转可选不会让它们变红；`:299` 传了 `onTogglePin` + `pinned: true`，断言 `title="Unpin"`，也不受影响。`components/DetailPanel.test.mjs` 只按 kind 分派到 `ThreadPanel`，不传消息行 props。**结论：既有测试预期零改动。**
- **不新增测试的理由与替代**：本票的行为差异是「某一面少渲染几个按钮」，而 `MessageRow` 的渲染测试是源码级/renderToStaticMarkup 断言，为「线程面少两个键」补一条测试需要新造 ThreadPanel 的 props 夹具（anchor + 消息 + members + tasks + pinned 五路加载），成本远大于收益。
- **实施票的人工回归清单（无自动化覆盖，替代自动化测试）**：
  1. 线程面板 hover 锚点行 = 表情 / 引用 / 复制链接 / ⏰ 四键，无 Reply、无 Pin；
  2. 线程面板 hover 线程内消息行 = 表情 / 引用 / 复制链接 三键；
  3. 右键线程内消息 → 不弹菜单；右键锚点消息（未转任务）→ 弹「转为任务」且点击生效；
  4. 右键频道主流程消息 → 仍弹「在线程中回复 / 转为任务」，两项均生效；
  5. 频道主流程 hover 气泡 → 仍是六键，Pin 仍能 pin/unpin 且频道头部 pinned 区即时刷新；
  6. 线程内不再发 `notifyPinnedChanged`，频道侧 pinned 区不再因线程操作而重拉（决策 5 的 (a)/(b) 都要验这一条）；
  7. 锚点行 ⏰ 仍能打开 `ReminderModal` 且标题预填首行预览。

## Out of Scope

- **频道主流程动作栏的任何改动**（D1=A）。包括：六键的增删改、hover 节奏、右键菜单两项、`openThreadPanel` 的接线、「回复」按钮的 label 或行为。
- **表情添加的交互形态**（D5 = 保持二级），包括 hover 直出快捷条、选择器网格、reaction 聚合条。
- **⏰ 入口的位置**（D4 = 留在气泡），包括是否迁到右键菜单、是否常驻、是否只对锚点之外的行开放。
- **pinned 区的渲染与交互**（排序三选一、Manual ↑/↓ 重排、点击定位/展开线程）——它是 Pin 删除后被置顶线程消息的可达性保证，本票**依赖**它，不动它。
- **任务板卡片、composer、面板单槽容器**（`DetailPanel`）与线程轮询节奏。
- **服务端与协作服务层**：消息、reaction、pin、reminder 的任何端点与数据层行为。
- **`AGENTS.md` 的实际改写**（D6 = 随实施票落地），本票只产出待改写清单。

## Further Notes

### 被收窄 / 不需收窄的已写明裁决（逐条）

| 裁决 | 行号 | 原文要点 | 实施票需改写什么 |
| --- | --- | --- | --- |
| Pin 双面通吃 | `AGENTS.md:434` | 「动作栏 `Pin`（pinned 态黄底）channel/thread 消息通吃」 | **需改写**：把「channel/thread 消息通吃」收窄为 channel only。同段前半句「消息 hover 快捷 reaction（👍❤️🎉👀）+ ＋ 选择器（24 常用 emoji 网格）+ 内容下聚合条」**不动**（D5 保持二级，未收窄）。**代价须一并写进该段**：线程内消息无法置顶，置顶只能在频道主流程做 |
| ThreadPanel 侧的 pin 说明 | `AGENTS.md:246` | File Map 中 `ThreadPanel.tsx` 条目：「freshness baseSeq 按线程自己的 seq 空间；pin/unpin 经 notifyPinnedChanged 通知中央刷新」 | **需改写**：线程侧不再有 pin/unpin 入口，该分句连同「面板↔中央 pinned 双端收敛」机制（见决策 5）一并收窄或删除 |
| 面板↔中央 pinned 收敛机制 | `AGENTS.md:220` | `lib/panel-state.ts` 条目：「`subscribePinnedChanged`/`notifyPinnedChanged`（面板↔中央 pinned 双端收敛）」 | **需改写**：与 `AGENTS.md:246` 同一次改写，取决于决策 5 选 (a) 删还是 (b) 留 |
| 消息动作栏 ⏰ | `AGENTS.md:425` | 「channel 头部 ⏰ + 消息动作栏 ⏰（目标 = 该消息/thread 锚点，标题预填首行预览）」 | **不需改写**：D4 保留 ⏰，裁决未被收窄。同段末句「锚点消息行显示线程回复角标……消息锚定提醒触发后可从角标发现 thread 内进展」的场景链因 D4 完整保留 |
| File Map 提醒入口 | `AGENTS.md:240` | `ChannelView.tsx` 条目：「提醒入口（header ⏰ + 消息动作栏 ⏰，§5.6）」 | **不需改写**：同上 |
| 「回复」按钮的语义 | — | 频道面 `onReply={openThreadPanel}`（`components/ChannelView.tsx:3642`），文案「在线程中回复」（`lib/i18n/messages/zh-CN.ts:462`） | **不需改写任何文档**：D2 只删线程面的 prop 门控，频道面行为零变化 |

行号核验：以上每条均在本 worktree（base `2ab2535`）grep 复核过原文措辞；`AGENTS.md` 的行号会随上游改动漂移，实施票落地时必须**按文本重新定位**，不要照抄本文行号。

### 频道面「回复」按钮的 label-行为耦合（留痕，不修）

频道面那个「回复」按钮的文案是「在线程中回复」，行为是「打开右栏线程面板」。D1=A 之后这仍是一个**文案与行为不完全同名**的耦合：按钮图标是 `Reply`（`components/ChannelView.tsx:637`），点开的是线程面板而不是就地回复。本文**只做留痕，不改代码、不收窄任何裁决**，理由是：(a) 它不在本诉求范围内（用户说的是任务线程）；(b) D1=A 已定频道面一字不动；(c) 文字与行为方向一致（「去线程里回」），不构成误导。留给下一个人的提示：不要把它当 bug 顺手改掉——它的行为正是 ticket 13 把线程迁到右栏后的正确形态，改成「就地回复」反而会丢掉「线程被提到右栏」这条信息。

### ADR 判定：不建

按 `domain-modeling` 的三条件逐条核对：

1. **难以逆转**——**不满足**。这是单面 UI 收窄：改六个键的渲染条件、删两处 prop、扫一段死代码。逆转成本 = 反向做一遍同样的改动，分钟级。无数据迁移、无对外契约、无跨模块承诺。
2. **无上下文时会让人困惑**——**不满足**。裁决的意外性极低：「线程里的按钮比频道里少」是用户直接提出的诉求，收窄方向与直觉一致；模块里 `onReply` 由必填转可选、其余按钮沿用已有的 optional-prop 门控，代码自身即解释了形状。
3. **真实权衡的结果**——**部分满足**。D3（Pin 删除 vs 迁右键菜单 vs 迁常驻位）与 D2（空菜单 vs 补一个恒在项）确实是真权衡，也确实选了其中一支。

三条件未全满足（第 1 条硬性不满足），**不建 ADR**。选中的分支连同被否决的分支与理由已完整落在本文件 Solution 节的裁决表、Implementation Decisions 决策 2 与决策 9 里——ADR 要提供的「为什么这么选」在这里没有丢失，单独建一份只会制造第二处需要同步的真相。

### 术语决议

**无新术语，不改 `CONTEXT.md`。** 本票全部词汇取自仓库既有语言：「频道」「线程」「锚点」「置顶 / pinned」「消息动作栏」都是 `CONTEXT.md` 与 `AGENTS.md` 已在用的词；「假 affordance / 死按钮」是对既有代码事实的描述（一个点了没反应的控件），不是这个项目的领域概念，不入词表。本文描述动作栏时用 module / interface / seam / leverage / locality 这一套词汇，没有引入需要被记录的新领域名词。
