# 02: 线程消息操作气泡收窄落地（实现票）

**What to build:** 落地 `.scratch/thread-message-actions/spec.md` 的 D1–D6 裁决：把 `MessageActions` / `MessageRow` 的
`onReply` 从必填 prop 变可选、Reply 按钮与右键菜单 reply 项按可选门控；`ThreadPanel` 两个调用点删掉
`onReply` / `onTogglePin` / `pinned` 并清扫随之无消费者的 pinned 回路；显式裁决 pinned 广播总线的存废；
`AGENTS.md` 三处改写；spec 的 Testing Decisions 同步为 S1（新增 1–2 条 `MessageRow` 渲染断言）。

**Blocked by:** None — can start immediately.

**Type:** implementation

**Status:** resolved

- [x] tdd 红：新增断言在未改实现时为红
- [x] A：`ChannelView.tsx` 收窄机制 4 处（两个 prop 类型 / Reply 按钮门控 / 菜单项条件展开 / 透传不改）
- [x] B：`ThreadPanel.tsx` 两个调用点 + 死代码清扫（`loadTasks` 保留）
- [x] C：pinned 广播总线存废显式裁决（选 **(a) 删**）
- [x] D：`AGENTS.md` 三处改写（Pin 收窄为 channel only + 代价；ThreadPanel 条目；panel-state 条目）
- [x] E：spec 的 Testing Decisions 同步为 S1（其余六节与 D1–D6 一字不动）
- [x] tdd 绿：窄档测试（ChannelView 33 / DetailPanel 10 / panel-state 6）全绿
- [x] tsc `--noEmit` 退出码 0
- [x] lint 增量对照零新增（eslint 改前改后均 0 问题）
- [x] 双轴 code-review（Standards + Spec 两份报告），findings 逐条处置
- [x] 人工回归 7 条（真浏览器 / ego-browser，临时数据目录）
- [x] 票据收敛（`Status: resolved` + `## Answer`）

## 票据协议（worker 必读）

- 开工直接干，不用改本文件；完工后 append `## Answer`，并把 `Status:` 流转到 `resolved`。
- 提问通道一律 `orca orchestration ask`，禁 AskUserQuestion；open 决策 ask 回来，不编造。
- Ownership：本票正本在本 worktree 内，coordinator 在 main 上只读验收。

## Answer

### 一句话

线程面板 hover 气泡收窄为 表情+ / 引用 / 复制链接 / ⏰（仅锚点）、右键只剩「转为任务」（为空时不弹），
频道主流程六键 + 右键两项**行为零变化**；D3 连带清掉线程面整条 pinned 回路，并按决策 5 选 **(a) 删掉**
随之失去生产者的 pinned 广播总线。

### tdd 红绿证据

**红（未改实现，`.gate-logs/red.txt`）**——两条新断言，其中只有一条有牙齿：

```text
✖ MessageRow omits the reply action when onReply is absent (2.84075ms)
  AssertionError [ERR_ASSERTION]: The input was expected to not match
  the regular expression /title="Reply in thread"/.
  operator: 'doesNotMatch'
✔ MessageRow omits the pin action when onTogglePin is absent, even when pinned (3.005292ms)
ℹ tests 33   ℹ pass 32   ℹ fail 1
```

**如实标注覆盖率（不虚报）**：

| 断言 | 红阶段状态 | 有没有牙齿 | 覆盖什么 |
| --- | --- | --- | --- |
| 不传 `onReply` ⇒ 无 `title="Reply in thread"`（`ChannelView.test.mjs:69`） | **红** | **有** | **D2 的自动化覆盖**。失败原因正确：`doesNotMatch` 的 actual markup 仍含该 title，且断言落在**无障碍名**上而非 class 字符串 |
| 不传 `onTogglePin`（传 `pinned`）⇒ 无 `title="Unpin"` / `title="Pin to channel"`（`:86`） | **绿** | **无** | **特征化测试（防回归护栏）**。`onTogglePin` 本来就是可选 prop、Pin 按钮本来就有 `{onTogglePin && …}` 门控，所以它改动前后都成立。留它的价值是：若将来有人把 `pinned` 布尔重新耦合到渲染，这条会红 |

**D3 的真实覆盖不在这条断言上，而在人工回归第 2 条**（线程面板 hover 线程内消息行 = 三键，见下）。
局限出在 S1 选项的描述（它把这条写成"新增 1–2 条"），不是实现问题。

**绿（改完实现）**：

```text
ℹ tests 49   ℹ pass 49   ℹ fail 0
  components/ChannelView.test.mjs  → pass 33
  components/DetailPanel.test.mjs  → pass 10
  lib/panel-state.test.mjs         → pass 6
```

`node_modules/.bin/tsc --noEmit` → 退出码 **0**。
eslint（改前基线在 main worktree `ed1651b` 同提交取样 vs 本 worktree）：两侧均 **0 问题**，零新增。
> **门禁命令的一处修正**：验收清单写的是 `oxlint .`，但本仓**没装 oxlint**（`package.json` 无该依赖，
> 全局也没有）。本仓声明的 lint 门禁是 `AGENTS.md` 的「Lint: `npm run lint`」= `eslint .`。
> 我按仓库实际门禁跑的 eslint（只报告，不带 `--fix`），并用 main worktree 同提交做了改前/改后对照。

### 决策 C：pinned 广播总线的存废 —— 选 (a) 删

**结论：删。** 连同 `lib/panel-state.ts` 的 `subscribePinnedChanged` / `notifyPinnedChanged` 一对函数、
`ChannelView.tsx` 的订阅 effect 与它的 import、以及 `lib/panel-state.test.mjs` 里直接测这两个函数的用例。

**理由**（spec 推荐 + 本票复核后维持）：

1. **生产者归零是机械事实**，不是判断题。`notifyPinnedChanged` 全仓唯一调用点是 `ThreadPanel` 的
   `togglePin`（原 `:276`）；D3 把线程面 Pin 入口删掉，`togglePin` 整条回路随之删除，广播总线再无生产者。
   订阅方 `ChannelView` 永不触发 ⇒ 零生产者的空壳。
2. **`lib/panel-state.ts` 是窄模块**（单槽面板状态 + `memberPanel` 映射）。留一个没有生产者的订阅总线，
   正是本仓 `channelview-deepening` effort 一直在削的浅层残留——它让读代码的人以为"面板 pin 会通知中央"，
   而代码里已无这条路径。
3. **(b) 的代价高于收益**：作扩展点意味着这个 seam 没有任何已知消费者，而 `Deep` 的判据是"接口背后有真实
   复杂度"。真要恢复，代价是分钟级（重建一对函数 + 一个 effect），远小于长期留一个诱饵订阅的代价。
4. **删除是完整的，不是断链**：不留孤儿生产者 / 订阅方 / 导出 / 解构 / 测试（见下「完整性核验」）。

**连带（tsc/lint 逼出来的必然，非我选择）**：删掉订阅 effect 后，`loadPinned` 在 `ChannelView` 侧解构出来
却无人使用 → `no-unused-vars` 报错 → 必须从解构里摘掉。**经 `ask` 问回，coordinator 裁决 (C)**：
本票 Ownership 窄扩到 `hooks/useChannelData.ts` 一个文件，删掉因此失效的 2 行注释（`:533-534`，
原文提到已不存在的 `subscribePinnedChanged` 与"hook 只暴露 loadPinned 供订阅回调调用"），
并把 `loadPinned` 改为**模块内私有、不再导出**（函数本体保留——hook 内部 `togglePin` / `reorderPinned` /
切频道 effect 三处仍在用）。

**完整性核验**（`grep -rn "notifyPinnedChanged\|subscribePinnedChanged"`，源码与测试全仓）：命中仅剩
`.scratch/` 下的历史文档（票据 01 的 Answer 与 spec 决策 5 原文，按"历史事实原样保留"处理），
**源码与测试零命中**。

### 验收 6：三个 prop 的全部出现位置，逐个标注

> 统计口径：`onReply` 在 `lib/agent-loop/loop.ts` 的 `SessionReply` / `scanSessionReplies` 是**另一个标识符**
> （session 里的回复扫描），不是本 prop，未动。

#### `onReply`

| 位置 | 处置 | 理由 |
| --- | --- | --- |
| `ChannelView.tsx:592` `MessageActions` prop 类型 | **改了** | 必填 → 可选（spec 决策 1 第 1 处） |
| `ChannelView.tsx:628` `{onReply && (` | **改了** | 新增门控（决策 1 第 2 处） |
| `ChannelView.tsx:633` `onClick={() => onReply(message)}` | **故意不改** | 在门控内部，频道面点击行为逐字不变 |
| `ChannelView.tsx:842` `MessageRow` prop 类型 | **改了** | 必填 → 可选（决策 1 第 1 处） |
| `ChannelView.tsx:872-873` 右键菜单 reply 项 | **改了** | 恒在首项 → 条件展开（决策 1 第 3 处） |
| `ChannelView.tsx:1021` `onReply={onReply}` 透传 | **故意不改** | spec 决策 1 明写不改：可选值透传 `undefined` 合法，且改它会动到频道面共用的渲染路径 |
| `ChannelView.tsx:3638` `onReply={openThreadPanel}` 频道面调用点 | **故意不改** | **D1=A 验收红线**：频道面 Reply 文案「在线程中回复」与行为（开右栏线程面板）自洽 |
| `ChannelView.test.mjs` 9 处 `onReply:` | **故意不改** | 8 处既有用例 + 1 处新 pin 用例；新 reply 用例**刻意不传**（那正是被测条件）。10 个 `MessageRow` 渲染用例里 9 个传、1 个不传 |
| `ThreadPanel.tsx` 锚点行 / 线程内消息行 原 `onReply={() => undefined}` | **删了** | D2：假 affordance 的代价是"用户反复尝试并怀疑自己的操作"，处置是"键根本不存在"而非"传空函数" |

#### `onTogglePin`

| 位置 | 处置 | 理由 |
| --- | --- | --- |
| `ChannelView.tsx:597` / `:668` / `:676` / `:848`（类型 + 门控 + onClick + `MessageRow` 类型） | **故意不改** | Pin 门控**本来就存在**；D3 只删线程面入口，不动共享模块的实现 |
| `ChannelView.tsx:1026` `onTogglePin={onTogglePin}` 透传 | **故意不改** | 同 `onReply` 透传，可选值透传合法 |
| `ChannelView.tsx:3644` 频道面调用点 | **故意不改** | **D1=A 红线**：频道面 Pin 必须保留 |
| `ChannelView.test.mjs:368`（传 `onTogglePin` + `pinned: true`，断言 `title="Unpin"`） | **故意不改** | 这条是**频道面 Pin 仍工作的回归护栏**，双轴 review 都点名它证明了"频道 Pin 未被削" |
| `ThreadPanel.tsx` 两处 `onTogglePin={joined ? togglePin : undefined}` | **删了** | D3：线程面彻底删 Pin，**不进右键菜单**（人否掉了 coordinator 的"挪进右键菜单"方案） |

#### `pinned`

| 位置 | 处置 | 理由 |
| --- | --- | --- |
| `ChannelView.tsx:590` / `:601` / `:832`（解构 + 两处类型） | **故意不改** | `pinned` 仍服务于**频道面** Pin 按钮的 label（`pinned ? unpin : pin`）与黄底态 |
| `ChannelView.tsx:1027` `pinned={pinned}` 透传 | **故意不改** | 同上 |
| `ChannelView.tsx:3633` `pinned={pinnedSet.has(m.id)}` | **故意不改** | **D1=A 红线**：频道面仍需判断该消息是否已置顶 |
| `ThreadPanel.tsx` 两处 `pinned={pinnedItems.some(...)}` | **删了** | D3 连带：Pin 一走，`pinnedItems` 在本模块内**再无消费者**（只剩 `togglePin` 与这两处 prop），整条 state → loadPinned → togglePin 回路随之删除 |

**另外两处 coordinator 点名"不用重查但要列入故意不改"的**：`openThreadPanel`（`ChannelView.tsx:2481`）
与 `loadTasks`（`ThreadPanel.tsx`）——前者是频道面 Reply 的行为本体（D1=A），后者是锚点行
`canConvertToTask` 判定的数据源（删了会让锚点行的「转为任务」恒显示），**两者都故意保留**。

### 验收 7：同形对照

**（a）Reply 按钮门控 vs 紧邻的 `onToggleReaction` 门控**——同一个 `{cond && ( … )}` 形状，
条件表达式位置、条件块、缩进、闭合括号全部一致：

```tsx
{onToggleReaction && onToggleReactOpen && (      // ← 既有门控（未动）
  <button type="button" title={t("message.addReaction")} ...>
    <SmilePlus size={13} />
  </button>
)}
{onReply && (                                    // ← 本票新增，与上同形
  <button type="button" title={t("message.reply")} style={actionButtonStyle}
    onClick={() => onReply(message)}>
    <Reply size={13} />
  </button>
)}
```

**（b）右键菜单 reply 项 vs 紧随其后的 convert 项**——同一个 `...(cond ? [{…}] : [])` 形状，
都是三元包在展开里、都是单行 label + onClick：

```tsx
const items = [
  ...(onReply                                    // ← 本票新增，与下一项同形
    ? [{ label: t("message.reply"), onClick: () => onReply(message) }]
    : []),
  ...(canConvertToTask && onConvertToTask        // ← 既有项（未动）
    ? [{ label: t("tasks.convert"), onClick: () => onConvertToTask(message) }]
    : []),
];
```

**未采用被否决的形状**（spec 决策 9 留痕，本票不重提）：`variant="thread" | "channel"` prop、拆两个模块、
动作注册表。三者都是"为两个面的三键差异新建机制"，leverage 换不来——本诉求已被"补齐已有门控"全覆盖。

### 双轴 code-review（两份报告分开，不合并不重排）

固定点 `ed1651b`（origin/main tip），diff = `git diff ed1651b...HEAD`，单个提交 `56e4fcf`。
两个轴各起一个 fresh-context reviewer 并行跑（Standards / Spec 分离，不互相污染）。

#### 报告一：Standards 轴

**Correct**：同形门控核实通过（Reply 块与 reaction 门控形状一致、菜单 reply 项与 convert 项同形，
菜单位序未变，频道面调用点零改动）；文档改写准确且落到行（`AGENTS.md:246-247` / `:435` / File Map
`panel-state.ts` 条目，均与代码现状相符）；死代码清扫彻底（`ThreadPanel` 无 `pinned*` 残留，
`loadTasks` 按 spec 决策 4 保留，`panel-state.ts` 模块头注释现声明"无事件总线"与实现相符，
测试无孤儿用例）；断言落在无障碍名上，无 class 字符串断言；术语无越界（新注释讲形状不讲设计词汇，
未出现 component/service/API/boundary 误用）；未新增 emoji 图标（`AGENTS.md` UI 图标规则）。

**Findings**：

1. **P1 票据未收敛** —— `Status: claimed`、勾选框全空、`## Answer` 待填。违反 `docs/agents/issue-tracker.md`
   与 `AGENTS.md` 验收三件套第三件。→ **已处置**（本 `## Answer` + `Status: resolved`）。
2. **P2 遗留注释指向已删除物** —— `hooks/useChannelData.ts:533-534` 仍描述已删的
   `subscribePinnedChanged` 订阅与"hook 只暴露 loadPinned 供订阅回调调用"。→ **已处置**：经 `ask` 问回，
   coordinator 裁决 (C)，删掉这 2 行并把 `loadPinned` 改为模块内私有不再导出（函数本体保留，hook 内部三处仍在用）。
3. **P2（judgement）重复代码** —— 两条新用例各自重复同一 5–6 行 props 骨架。→ **豁免，理由**：该文件既有
   10 个 `MessageRow` 用例全是逐例平铺同一骨架，抽取一个工厂反而给这个 seam 增加一层间接；
   保持与既有写法一致优先于 DRY（仓库语言一致性 > 教科书 DRY）。

**Merge verdict**：OK with notes —— 代码与文档本身无标准违背；两项 notes 均已处置/豁免。

#### 报告二：Spec 轴

**Correct**（逐条对照 spec）：D1=A 红线全部守住（频道面调用点 `onReply={openThreadPanel}` /
`pinned={pinnedSet.has(m.id)}` / `onTogglePin` / `onOpenThread` 均未动；Quote/Link/⏰/Pin 四块与
reaction 二级条原样；`menu && items.length > 0` 守卫未动；既有回归用例证明频道 Pin 未被削）；
决策 1 三处改动到位、透传未改；决策 4 清扫清单逐项全中、`loadTasks` 保留；决策 5 取 (a) 且删除完整
（无孤儿生产者/订阅方/导出/解构/测试）；决策 6 i18n 键未删；D3/D4 未被回退、D5 二级形态未动；
`AGENTS.md` 三处改写落地且 435 段前半句 reaction 措辞未动、代价句已写入；Testing Decisions 重写与代码一致。

**Findings**：

1. **P2 票据未收敛**（勾选框 + Answer）。→ **已处置**。
2. **P2 清单条数不符** —— spec 的 Testing Decisions 人工回归是 **7** 条，本票 checklist 原写"6 条"。→ **已处置**：
   checklist 改为 7 条，且第 7 条（线程内不再发 `notifyPinnedChanged`）已实际验（见人工回归第 7 项）。

**Merge verdict**：OK with notes —— 规格实现面无偏差、无 scope creep、无实现错误；两项 notes 均已处置。

**分轴小结**：Standards 3 项（1 已处置 / 1 已处置 / 1 豁免），最重的是"票据未收敛"；Spec 2 项（均已处置），
最重的是"清单条数不符"。两轴不合并、不跨轴排序。

### 人工回归（真浏览器 ego-browser，7 条全过）

**数据安全**：全程用临时数据目录 `WORKSPLICE_DATA_DIR=/tmp/ws-tma-regress`
（`scripts/seed-demo.mjs` 自带"不设该变量即拒跑"的门禁），**未触碰 `~/.worksplice`**。
未跑 `next build`。测试对象是本 worktree 的 `next dev`（`:30142`）。

| # | 项 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 线程面板 hover **锚点行** = 四键，无 Reply、无 Pin | ✅ | DOM 实测 `actions(4): ["添加回应","引用","复制链接","给这条消息设置提醒"]`；截图 `/tmp/tma-item1-anchor-hover-bubble.png`（右栏锚点行黄底下恰好 4 个图标） |
| 2 | 线程面板 hover **线程内消息行** = 三键 | ✅ | 两条回复行均 `actions(3): ["添加回应","引用","复制链接"]` |
| 3 | 右键线程内消息 → 不弹菜单；右键锚点（未转任务）→ 弹「转为任务」且生效 | ✅ | 线程内消息右键 `[]`（空）；已是任务的锚点右键 `[]`；**未转任务的锚点**右键 `["转为任务"]`，点它之后 bug-hunt 的任务从 2 条变 **3 条**（`#3 todo 28dc84a9-…`，API 复核） |
| 4 | 右键频道主流程消息 → 仍弹「在线程中回复 / 转为任务」，两项均生效 | ✅ | 右键频道消息 `["在线程中回复","转为任务"]`；点「在线程中回复」确实打开了右栏线程面板（截图 `/tmp/tma-item4-channel-menu.png`） |
| 5 | 频道主流程 hover 气泡仍是**六键**；Pin 能 pin/unpin 且频道头部 pinned 区即时刷新 | ✅ | 6 条频道消息行全部 `actions(6): ["添加回应","在线程中回复","引用","复制链接","给这条消息设置提醒","置顶到频道"]`；已置顶那行显示"取消置顶"。点 Pin 后按钮翻成「取消置顶」，API 复核 `c400c8b4` 已进 pinned 列表、该频道 pinned 计数 1→2（截图 `/tmp/tma-item5b-channel-pin.png`） |
| 6 | 锚点行 ⏰ 仍能打开 `ReminderModal` 且标题预填首行预览 | ✅ | 弹窗标题预填 `"Task: the terminal event is lost after an SSE drop. Make rec…"`，与锚点正文首行一致；出现 `重复（可选）`/`创建提醒`/`已锚定的提醒`（截图 `/tmp/tma-item6-reminder-modal.png`） |
| 7 | 线程内不再发 `notifyPinnedChanged`；频道侧 pinned 区不因线程操作而重拉 | ✅ | 决策 5 已选 (a)，该对函数**源码与测试全仓零命中**，没有可发的通道；第 5 项同时证明**频道面自己的 pin 路径不依赖这条总线**（`useChannelData` 内部重拉收敛），删除未伤频道行为 |

> 「items 为空 → 右键不弹菜单」**无自动化覆盖**（需 DOM `contextmenu` 模拟，现有 seam 是静态渲染），
> 已如约归入本清单第 3 项，用真实右键事件验过。

### 文档改写（D6，3 处，按文本定位非行号）

- `AGENTS.md:435`（消息增强 · UI 段）：`Pin`（pinned 态黄底）`channel/thread 消息通吃` →
  **仅频道主流程**（线程面板不提供），并在该段末写明代价：线程内消息无法置顶、置顶只能在频道主流程做、
  已置顶的线程消息仍可从频道头部 pinned 区定位/展开线程。同段前半句「消息 hover 快捷 reaction
  （👍❤️🎉👀）+ ＋ 选择器」**未动**（D5 未收窄）。
- `AGENTS.md:246-247`（File Map · `ThreadPanel.tsx`）：删「pin/unpin 经 notifyPinnedChanged 通知中央刷新」，
  改为「动作栏收窄为 表情 / 引用 / 复制链接 / ⏰（仅锚点），无 Reply / Pin」并指回 spec D2/D3。
- `AGENTS.md:219-220`（File Map · `panel-state.ts`）：删「+ subscribePinnedChanged/notifyPinnedChanged
  （面板↔中央 pinned 双端收敛）」。
- **未动**：`AGENTS.md` 里消息动作栏 ⏰ 的两处（D4 未收窄，裁决仍成立）；`lib/i18n/messages/*` 的
  `message.reply` 键（删键会连带删掉频道面文案，属 D1=A 禁止）。

### spec 正本同步（E，只改 Testing Decisions 一节）

把「不新增测试」推翻为 S1（新增两条 `MessageRow` 渲染断言 + 断言落在无障碍名上 + 人工回归清单 7 条），
节首加了一句说明"本节已被实施票改写，其余六节与 D1–D6 一字未动"。
`git diff --numstat` 该文件 = 26 增 / 5 删，`## Solution` 的 D1–D6 裁决表逐行未动（grep 复核 6 条仍在）。

### 行号修正（spec 写作时快照 vs 当前 main `ed1651b`）

1. **`MessageRow` 用例数**：spec Testing Decisions 写"四个 `MessageRow` 用例"（`:47`/`:67`/`:84`/`:299`），
   实际是 **8 个**（另有 `:354`/`:367`/`:397`/`:429`）。**结论不变**——10 个渲染用例里 9 个显式传了
   `onReply`，唯一不传的就是本票新增的 reply 用例。已在 spec 该节标注此修正。
2. **`notifyPinnedChanged` 定义行**：spec 决策 5 写 `lib/panel-state.ts:60`，实际 `:61`。
3. **`lib/panel-state.ts` 待删区间**：spec 写 `:53-63`，实际总线块是 `:45-63`（含分隔注释）。
4. 其余 coordinator 给的行号（`:595`/`:843`/`:631-638`/`:872-877`/`:1020`/`:1032`/`:2481`/`:3634-3650`/
   `AGENTS.md:219-220`/`:245-246`/`:434`）逐条 grep 复核，**全部命中**，与本票描述一致。

### 门禁结果

| 项 | 结果 |
| --- | --- |
| `git status --porcelain` | 干净（`.pi-lens.json` 已写并加进 `.git/info/exclude`，不入库） |
| `git diff --numstat` | 无四位数行增删；最大单文件为 `ThreadPanel.tsx` 删 53 行（死代码清扫） |
| 窄档测试 | ChannelView 33 / DetailPanel 10 / panel-state 6 = **49 pass, 0 fail** |
| `tsc --noEmit` | 退出码 **0** |
| eslint 增量对照 | 改前基线（同提交 main worktree）0 问题 → 改后 0 问题，**零新增** |
| 双轴 review | Standards 3 项（2 已处置 / 1 豁免）+ Spec 2 项（均已处置） |
| 人工回归 | 7/7 通过，6 张截图 |
| 格式化噪声 | 未跑 `prettier --write` / `oxlint --fix` / `eslint --fix` / `biome --write` / `next build` |

### 遗留项（不在本票 Ownership，未动，留给清理票）

1. `.scratch/pi-sdk-rebuild/research/03-current-state-inventory.md:173` 与 `:251` 仍把
   `subscribePinnedChanged` / `notifyPinnedChanged` 列为 `lib/panel-state.ts` / `ThreadPanel` 的现状——
   那是**另一个 effort 的调研快照**，本票不碰（与上一票处理 `docs/spike-systemprompt-fix.md` 同处置）。
2. `.scratch/agent-detail-panel/issues/01-panel-state-module.md:21` 同样提到这对函数——历史票据，按"历史事实
   原样保留"处理。
3. `loadPinnedPage`（`hooks/useChannelData.ts:166`，`export async function`）与本票无关，未动。

### PR

- 分支：`whutlichao/thread-message-actions-narrowing`（base `ed1651b`）
- PR：**#88** — https://github.com/whutlichao/worksplice/pull/88
