# 01: 频道主流程消息 hover 动作栏新增「转为任务」键

**What to build:** 频道主流程消息的 hover 动作栏（`MessageActions`，`components/ChannelView.tsx:579`）在现有键
**之后（行尾）**新增一枚 lucide `ListPlus` 键，`title={t("tasks.convert")}`（与右键菜单项逐字同名：zh「转为任务」/
en "Convert to task"），点击调用与右键项**同一个** handler `onConvertToTask(message)`。门槛与右键项同权——
仅当「该消息还不是任务」且 handler 存在时渲染，**不加 `joined` 门槛**。门控形制照 #88：靠「只有频道调用点传的
prop」——**不传 prop ⇒ 键根本不存在**；禁止「传空函数让它不做事」，禁止在模块内嗅探渲染表面。落地形制（pin 死）：
`MessageRow` 新增可选布尔 prop `convertInActionBar?: boolean`（缺省 = 不渲染该键），`MessageRow` 只把它与
`canConvertToTask && onConvertToTask` 合流后透传给 `MessageActions`；`MessageActions` 侧仍是「传了 handler prop
才渲染」的既有形制。右键菜单三处（`ContextMenu` 模块、`MessageRow` 的 `items` 构造、`ThreadPanel` 锚点项）
**行为零变化**；`components/ThreadPanel.tsx` **不得编辑**（不传新 prop 即自然收窄）。

**Blocked by:** None — can start immediately.

**Type:** implementation

**Status:** resolved

- [x] 红：新增断言在未改实现时跑出红（`git checkout ccbee0d -- components/ChannelView.tsx` + `node --test`）
- [x] 绿 1：频道形制（`canConvertToTask` + `onConvertToTask` + `convertInActionBar`）⇒ html 中
      `title="Convert to task"` **恰 1 次**（防重复入口）
- [x] 绿 2：已是任务（`canConvertToTask={false}`，其余同上）⇒ 该 title 0 次
- [x] 绿 3：无 handler（不传 `onConvertToTask`、但传 `convertInActionBar`）⇒ 该 title 0 次
- [x] 绿 4：线程锚点形制（传 `canConvertToTask` + `onConvertToTask`，**不传 `convertInActionBar`**）⇒ 该 title 0 次
- [x] 绿 5：`components/DetailPanel.test.mjs` 既有 thread 用例追加集成级否定断言（真实 `ThreadPanel`
      `initialAnchor` 渲染出的 html 里该 title 0 次）
- [x] 既有 `MessageRow` 用例（含 "renders author, seq, content and the three §3.2 actions"、
      "omits the reply action when onReply is absent" 等）**零改动仍绿**——它们不传新 prop
- [x] 窄档测试：`node --test components/ChannelView.test.mjs components/DetailPanel.test.mjs` 全绿（48/48）
- [x] `npm run typecheck` 退出码 0
- [x] `npm run lint` 对改动文件改前/改后增量对照零新增
- [x] 双轴 code-review（Standards + Spec 两份报告，不合并不重排），findings 逐条处置
- [x] 换 prop 调用点逐个清点（ChannelView 频道列表 / ThreadPanel 锚点 / ThreadPanel 线程行）并标注
      「改了 / 故意不改 + 理由」
- [x] 交付：`git status --porcelain` 空 + 本票提交 + OPEN PR（PR 号回填 `## Answer`）

## 票据协议（worker 必读）

- 开工直接干，不用改本文件；完工后 append `## Answer`，并把 `Status:` 流转到 `resolved`。
- 提问通道一律 `orca orchestration ask`，禁 AskUserQuestion；open 决策 ask 回来，不编造。
- Ownership：本票正本在本 worktree 内，coordinator 在 main 上只读验收。

## 本票可编辑范围

只许改三个文件：

1. `components/ChannelView.tsx`（`MessageActions` 动作栏 + `MessageRow` 的门控与透传 + 频道调用点）
2. `components/ChannelView.test.mjs`（TDD 主战场）
3. `components/DetailPanel.test.mjs`（**只允许**在既有 thread 用例里追加一条否定断言）

**不得编辑 `components/ThreadPanel.tsx`**（不传新 prop 即自然收窄）。越界 → `ask`，不擅自扩 scope。

## 取舍记录（本票的「非目标」）

- **不给线程面上这枚键**：线程内消息本来就不能转任务（服务层与右键项都只允许频道主流程的顶层消息），
  加键只会制造假 affordance——这正是 #88（`.scratch/thread-message-actions/issues/02-*.md`）削掉的形态。
- **不动右键菜单**：`ContextMenu` 模块与 `MessageRow` 的 `items` 构造保持不变（除必要的 prop 透传），
  右键仍是「在线程中回复 / 转为任务」两项（频道面）。动作栏键与右键项**共用同一 handler**，两条入口不打架。
- **不加 `joined` 门槛**：与右键项同权——右键项本来就不看 `joined`，动作栏键也不看。转任务由服务层授权判定。
- **不新增 i18n key**：`tasks.convert` 已存在（`lib/i18n/messages/zh-CN.ts:570` / `en.ts:585`）。
- **图标不用 `List` / `Kanban`**：它们已是任务视图切换键（List|Board）；本票用 lucide `ListPlus`，无 emoji。
- **不改 `actionButtonStyle` 与其它键的既有闸门**，不改 `MessageActions` 现有键的顺序（新键排在**行尾**，
  即现有 Pin 之后、二级 reaction 条之前）。
- **不跑整份重写文件的命令**（`prettier --write` / `oxlint --fix` / `biome --write` / `eslint --fix`），
  也不跑 `next build`（污染 `.next/` 并破坏 dev server）。

## Answer

**PR:** https://github.com/whutlichao/worksplice/pull/90
**分支:** `whutlichao/msg-actionbar-convert-task` · **提交:** `25d3bfb`（实现）+ 收敛提交（接线守卫 + 票据 Status/Answer）
**固定点:** `ccbee0d`（origin/main tip = 本分支 base）

### 一句话

频道主流程消息的 hover 动作栏在**行尾**（Pin 之后、二级 reaction 条之前）新增一枚 lucide `ListPlus` 键，
`title = t("tasks.convert")`（与右键项逐字同名），点击走与右键项**同一个** handler；门槛与右键项同权
（该消息还不是任务 + handler 存在，**不看 `joined`**）。线程面板气泡里没有这枚键——靠 `convertInActionBar`
这个只有频道调用点传的 prop，`components/ThreadPanel.tsx` **零改动**；右键菜单三处行为零变化。

### tdd 红 → 绿

红证据用「单文件回退实现、保留新断言」取得（不是整份重写）：

```text
$ git checkout ccbee0d -- components/ChannelView.tsx
$ node --test components/ChannelView.test.mjs components/DetailPanel.test.mjs
✖ MessageRow renders the convert-to-task action bar key on the channel surface
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: 0 !== 1
✖ ChannelView wires convertInActionBar and onConvertToTask into the channel message list
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /convertInActionBar/. Input:
  '<MessageRow\n                    message={m}\n                    currentMemberId={currentMemberId}\n ...'
ℹ tests 48   ℹ pass 46   ℹ fail 2
$ git checkout HEAD -- components/ChannelView.tsx
```

绿（同两条 + 全部窄档）：

```text
$ node --test components/ChannelView.test.mjs components/DetailPanel.test.mjs
ℹ tests 48   ℹ pass 48   ℹ fail 0
```

**如实标注覆盖率**（哪条有牙齿、哪条是防回归护栏）：

| 断言 | 红阶段 | 有牙齿 | 覆盖 |
| --- | --- | --- | --- |
| 频道形制 ⇒ `title="Convert to task"` 恰 1 次 | **红** | **有** | 键本体 + 防重复入口 |
| 接线守卫：频道调用点传 `convertInActionBar` + `onConvertToTask={handleConvertToTask}` | **红** | **有** | 频道调用点的接线（少传字面量时产品面静默失效） |
| 已是任务（`canConvertToTask={false}`）⇒ 0 次 | 绿 | 护栏 | 与右键项同门槛 |
| 无 handler ⇒ 0 次 | 绿 | 护栏 | 动作栏既有形制 |
| 不传 `convertInActionBar` ⇒ 0 次 | 绿 | **护栏（有区分力）** | 线程形制收窄；忽略 `convertInActionBar` 会打破它 |
| `DetailPanel` thread 用例：真 `ThreadPanel` 渲染 0 次 | 绿 | **集成护栏** | 线程面板真的没有这枚键 |

### 绿证据 = 产品渲染出的 markup（落在无障碍名上）

```text
== 1) 频道形制（canConvertToTask + onConvertToTask + convertInActionBar）==
count(title="Convert to task") = 1
action bar titles (in order) = ["Add a reaction","Reply in thread","Quote","Copy link",
  "Set a reminder on this message","Pin to channel","Convert to task"]
button markup = <button type="button" title="Convert to task" style="...">
  <svg ... class="lucide lucide-list-plus" aria-hidden="true">...</svg></button>

== 2) 已是任务（canConvertToTask=false）==             count = 0
== 3) 无 handler ==                                    count = 0
== 4) 线程锚点形制（不传 convertInActionBar）==         count = 0
   action bar titles = ["Quote","Copy link"]
== 5) 真实 ThreadPanel（initialAnchor + 1 条回复）==    count = 0
   action bar titles = ["Add a reaction","Quote","Copy link",
                        "Set a reminder on this message", ...回复行三键...]
```

（脚本 `.gate-logs/evidence.mjs`，输出 `.gate-logs/evidence.txt`；`renderToStaticMarkup` 直渲真模块。
静态渲染不展开 `ContextMenu`（`menu` state 为 null），所以频道形制的 1 次真指动作栏那唯一入口。）

### 换 prop 调用点逐个清点（全仓 `<MessageRow` 恰 3 处）

| 调用点 | 处置 | 理由 |
| --- | --- | --- |
| `ChannelView.tsx:3651` 频道消息列表 | **改了** | 唯一传 `convertInActionBar` 的调用点；`canConvertToTask={!taskMessageIds.has(m.id)}`、`onConvertToTask={handleConvertToTask}`（与右键项同一个 handler，非包装） |
| `ThreadPanel.tsx:328` 锚点行 | **故意不改** | 传 `canConvertToTask` + `onConvertToTask`（右键项仍可转任务），**不传** `convertInActionBar` ⇒ 动作栏无该键 |
| `ThreadPanel.tsx:349` 线程内消息行 | **故意不改** | `canConvertToTask={false}` 且无 handler ⇒ 与 #88 收窄后的三键形态一致 |

新 prop 自身的出现位置：`MessageRow` 解构 + 类型（`ChannelView.tsx:826` / `:845`）、合流透传（`:1044`）、
频道调用点（`:3656`）；`MessageActions.onConvertToTask` 类型 `:600`、门控渲染 `:684`。
全仓 grep `convertInActionBar`：`ChannelView.tsx` 4 处 + 两测试 + 本票，`ThreadPanel.tsx` **0 处**。

### 门禁

| 项 | 结果 |
| --- | --- |
| 窄档 `node --test components/ChannelView.test.mjs components/DetailPanel.test.mjs` | **48 pass / 0 fail**（红档 46 pass / 2 fail） |
| 全量 `npm test` | **929 pass / 0 fail**（改前基线 924；差值 = 本票新增 5 条断言） |
| `npm run typecheck` | 退出码 **0**（输出空） |
| `npm run lint` 增量对照 | 改动文件：改前 0 / 改后 0（`diff` 无输出）；全仓：改前 8 problems / 改后 8 problems，**零新增**（8 条全在 `ChatInput.tsx` / `useAgentSession.ts` / `useI18n.tsx`，本票未触碰） |
| 改动面 `git diff --numstat ccbee0d...HEAD` | 3 个文件（`ChannelView.tsx` +23/−1、`ChannelView.test.mjs` +64、`DetailPanel.test.mjs` +3，守卫提交再 +20）；`components/ThreadPanel.tsx` **0 行** |
| `git diff --name-only ccbee0d...HEAD` | `components/ChannelView.test.mjs` / `components/ChannelView.tsx` / `components/DetailPanel.test.mjs` |
| 格式化噪声 | 未跑 `prettier --write` / `oxlint --fix` / `biome --write` / `eslint --fix` / `next build` |

### 双轴 code-review（两份报告原文，不合并不重排）

固定点 `ccbee0d`，被审提交 `25d3bfb`；两个 fresh-context 只读 reviewer 并行跑。
**两位 reviewer 的工具面都没有 shell**（`reviewer` 只有 read/grep/find/ls/watchdog_diff），
故「跑测试 / `git diff --name-only`」两项由本 Answer 代跑并留痕（见上表），其余逐行引源核对源码与 `.gate-logs/` 留痕。

#### 报告一：Standards 轴

> **限制说明**：可用工具仅 `watchdog_diff`，它报告工作树对 HEAD 无 staged/unstaged 增量——**committed range `ccbee0d...25d3bfb` 无法直接取证**。以下基于 HEAD 状态源码逐点核实 + `.gate-logs/`（red/green/evidence/tsc/lint/full-suite）。
>
> **Correct（逐条已独立核实）**
>
> 1. **调用点清点完整**：全仓 `<MessageRow` 仅 3 处——`components/ChannelView.tsx:3651`（频道列表，传 `convertInActionBar`）、`components/ThreadPanel.tsx:328`（锚点行）、`components/ThreadPanel.tsx:349`（线程行）。后两处**不传**新 prop，`.gate-logs/evidence.txt` 第 4/5 项实测 title 计数 0，且 `ThreadPanel.tsx` 无新 prop 痕迹（符合本票「不得编辑」）。
> 2. **无假门控形态**：`ChannelView.tsx:1043-1047` 走 `... ? onConvertToTask : undefined`（传 `undefined`，非空函数）；全模块无 `variant`/`surface` 嗅探 prop，无 `any`。形制与 #88 一致（`{onReply && …}` 同形）。
> 3. **断言落在无障碍名**：`ChannelView.test.mjs:114/133/147`、`DetailPanel.test.mjs:147` 全部 `split('title="Convert to task"')`，无 class 字符串断言；`evidence.txt` 第 1 项证明按键序为行尾（Pin 之后、二级反应条之前）。
> 4. **无新 emoji / 无新 i18n key**：图标为 lucide `ListPlus`（`ChannelView.tsx:23,691`），符合 AGENTS.md「UI 图标规则」；`tasks.convert` 在 `lib/i18n/messages/zh-CN.ts:570` / `en.ts:585`——与本票开工前引用行号逐字相同（键未增、上方未移位）。注释全中文、标识符英文，符合 `docs/engineering-standards.md` §1。
>
> **Findings（均为 judgement，无 hard violation）**
>
> - **P2 Duplicated Code**：`canConvertToTask && onConvertToTask` 出现两次（`ChannelView.tsx:891` 菜单项、`:1044` 透传）。最小修法：`const convert = canConvertToTask && onConvertToTask ? onConvertToTask : undefined;` 复用。不阻塞（TS 收窄惯用形，且原状更贴 #88 同形）。
> - **P2 覆盖缺口**：`:3656` 频道调用点的接线无自动断言（两处 `ChannelView` 集成用例渲染无消息，`ChannelView.test.mjs:245-290`）；删掉该 prop 字面量后绿 1–5 仍全绿。修法非必需（票据把正例放在 `MessageRow` seam），宜照 #88 第 3 项记入人工回归。
> - **P2 测试骨架重复**（4 条新用例同 props 骨架）：沿用 #88 已有豁免理由（该文件既有 10 条同骨架用例），不违反标准。
> - **P2 票据未收敛**：`.scratch/msg-actionbar-convert-task/issues/01-*.md` 在本快照仍为 untracked / `Status: claimed` / 无 `## Answer`，与 `docs/engineering-standards.md` §5 及 AGENTS.md 验收三件套不符；但我无法列举提交文件清单，可能是陈旧副本，请以 25d3bfb 实际文件为准。
>
> **门禁（须由 supervisor 独立重跑）**：`node --test components/ChannelView.test.mjs components/DetailPanel.test.mjs`、`npm run typecheck`、`npm run lint`、`npm test`。判据留痕：`green.txt` 47/47、`full-suite.txt` 928/928 fail 0、`tsc.txt` 与 `lint-changed-after.txt` 均空输出。
>
> Merge verdict: OK with notes

#### 报告二：Spec 轴

> **可核对范围**：工作树干净（`watchdog_diff` 无 staged/unstaged 内容），改动已全在提交 `25d3bfb`；我无 shell，故 **`git diff --name-only ccbee0d...HEAD` 无法自行执行**。
>
> **(c) 实现正确性 — 三处门槛/位置/同一 handler 全部正确（引源）**
>
> - 门槛组合：`ChannelView.tsx:1044` `convertInActionBar && canConvertToTask && onConvertToTask ? onConvertToTask : undefined`；`MessageActions` 侧 `687-693` `{onConvertToTask && (…<ListPlus …/>)}`；与右键项同门槛 `891-893`（`canConvertToTask && onConvertToTask`）——spec 第 7-9 行落地形制一致。
> - 行尾：新键（`686-693`）位于 Pin（`678-683`）之后、二级 reaction 条（`694` `reactOpen &&`）之前，其后无其他主行键——spec 第 60-63 行「现有 Pin 之后、二级 reaction 条之前」✓。
> - 同一 handler：`689` `onClick={() => onConvertToTask(message)}` 与菜单项 `892` 逐字同一调用，且 action bar 拿到的就是频道调用点 `3663` 的 `handleConvertToTask`（非包装）✓。
> - 线程面 0 次：`ThreadPanel.tsx:328-341` 锚点传 `canConvertToTask`+`onConvertToTask` 但**不传** `convertInActionBar`；`349-353` 线程行 `canConvertToTask={false}` 且无 handler ✓。全仓 grep `convertInActionBar` 仅 ChannelView.tsx(826/845/1044/3656)+两测试+票据，ThreadPanel 内 0 次 ✓。
> - 不加 `joined` 门槛 ✓（`3655-3656` 只看 `taskMessageIds`）；未在模块内嗅探渲染表面 ✓。
>
> **四条计数断言成立**：断言落在 `title="Convert to task"`（`en.ts:585`；`zh-CN.ts:570`=「转为任务」；与右键项同一 i18n key，故「逐字同名」成立）。静态渲染不展开 `ContextMenu`（menu state=null），故频道形制计数 1 真指动作栏唯一入口；三例 0 次各自可被「忽略 convertInActionBar / canConvertToTask / handler」单独打破 ⇒ 有区分力；绿 5（`DetailPanel.test.mjs:146-148`）是真 `ThreadPanel`+`initialAnchor` 集成级否定断言（同用例已断言 `/#3/`、`/anchor message/`）。既有 `ChannelView.test.mjs:42-99` 用例确实不传新 prop，零改动仍绿可期。**无位置断言测试**（spec 未要求）。
>
> **(b) scope creep**：无间接证据显示越界（唯一 ticket 相关新增集中在三文件），但**ThreadPanel.tsx 未改、只改三文件我无法证伪** → 请 supervisor 跑 `git diff --name-only ccbee0d...HEAD`。
>
> **(a) 缺失**：票据未收敛——`Status: claimed`、8 项勾选全空、无 `## Answer`（双轴 review 小节与「调用点清点」结论均缺，PR 号未回填），违反 spec 第 18-35 行验收清单末两项。
>
> **Finding P2**｜`.scratch/msg-actionbar-convert-task/issues/01-….md:15-35`｜票据收敛与 Answer 缺失（代码面不受影响）。最小修：append `## Answer` + `Status: resolved`。
>
> **Finding P2**｜三文件范围与"红"证据不可独立复核｜需 supervisor 执行 `node --test components/ChannelView.test.mjs components/DetailPanel.test.mjs` 与 `git diff --name-only ccbee0d...HEAD`。
>
> Merge verdict: OK with notes

#### Findings 逐条处置

| 轴 | Finding | 处置 |
| --- | --- | --- |
| Standards | **P2 Duplicated Code**：`canConvertToTask && onConvertToTask` 出现两次（`:891` 菜单项、`:1044` 透传），建议抽 `const convert = …` 复用 | **豁免（有据）**：本票明文 pin 死「右键菜单保留：`ContextMenu` 模块与 `MessageRow` 的 `items` 构造不动（除必要的 prop 透传）」——抽出共享局部量就得改写 `items` 构造，属 spec 禁止；且两处并非同一表达式（菜单项在 `...(cond ? [...] : [])` 展开里，且不含 `convertInActionBar`）。reviewer 自己也标注「不阻塞」。 |
| Standards | **P2 覆盖缺口**：`:3656` 频道调用点接线无自动断言 | **已处置**：新增接线守卫用例，并把红证据补到它上面——`git checkout ccbee0d -- components/ChannelView.tsx` 时它真红（`/convertInActionBar/` 不匹配）。比 #88 走人工回归更硬：删掉 prop 字面量立刻红。 |
| Standards | **P2 测试骨架重复**（新用例同 props 骨架） | **豁免（沿用 #88 先例）**：该文件既有 10 条 `MessageRow` 用例全是逐例平铺同一骨架；抽工厂会给这个 seam 加一层间接。 |
| Standards | **P2 票据未收敛** | **已处置**：收敛提交（`Status: resolved` + 本 Answer + 勾选）。 |
| Spec | **P2 票据未收敛** | **已处置**：同上。 |
| Spec | **P2 三文件范围与「红」证据 reviewer 无法独立复核** | **已处置**：本 Answer 补 `--numstat` / `--name-only ccbee0d...HEAD`（恰 3 个文件，`ThreadPanel.tsx` 0 行）、红绿命令与输出原文，并显式说明两位 reviewer 无 shell。 |
| Spec | 观察：**无位置断言测试**（spec 未要求） | **豁免（有据）**：Change 第 1 条「排在现有键之后（行尾）」用渲染实测键序证明（`…"Pin to channel","Convert to task"`，其后只有二级 reaction 条）；票据的 Observable acceptance 未把位置列为断言项。 |

### 未做的事（逐条交代，避免留白被当遗漏）

1. **没跑人工/真浏览器回归**：本票 Observable acceptance 与门禁 G-impl 均未要求（#88 那条是它自己 spec 的 Testing Decisions 里写的）；
   30142 端口上另有一个 dev server 在跑，不动它。取而代之的是渲染实测 markup + 接线守卫。
2. **没改 `AGENTS.md`**：File Map 只写 ChannelView 的「右键菜单（Open Thread + Convert to Task）」（本票未动），
   消息增强段列举动作栏时只点名 reaction/Pin、未穷举全部键，故本票不引入文档漂移；且 Ownership 只授权三个文件 + 本票。
3. **任务创建三途径的服务层收敛未动**：`createTask({messageId})` 与 `TaskAlreadyExistsError` / thread 内不可转的判定原样，
   本票只是把第 4 条入口接到既有 handler 上。
