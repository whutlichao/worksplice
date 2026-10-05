# 01: 线程消息操作气泡收窄（只留 表情 / 引用 / 复制链接 / ⏰）

**What to build:** 不写任何代码。把「在任务线程的消息操作气泡里只留 表情添加、引用、链接复制」这条诉求问透到可实施的粒度：逐条裁决 D1–D6，产出 `.scratch/thread-message-actions/spec.md`（线程面与频道面各自的最终按钮清单 + `MessageActions` 收窄机制的具体形状 + 被收窄的已写明裁决清单）。

**Blocked by:** None — can start immediately.

**Type:** grilling

**Status:** resolved

- [x] 复核全部 `file:line`（coordinator 给的行号逐条 grep，不采信转述）
- [x] D1 scope 裁决
- [x] D2 线程两处「回复」死 affordance 处置 + 空菜单行为后果
- [x] D3 线程内 Pin 去留
- [x] D4 锚点消息 ⏰ 去留
- [x] D5 表情添加形态
- [x] D6 收窄裁决后的 `AGENTS.md` 同步安排
- [x] 设计文档七节齐全、无自由章节，两张按钮清单落纸
- [x] ADR 三条件逐条判定（建 / 不建）
- [x] 术语决议：有新术语才改 `CONTEXT.md`，否则明写不改
- [x] 源码面为空（`git diff <base> HEAD --name-only | grep -v '^docs/\|^CONTEXT.md\|^\.scratch/'` 为空）
- [x] design tree frontier 为空

## 票据协议（worker 必读）

- 开工直接干，不用改本文件；完工后 append `## Answer`，并把 `Status:` 流转到 `resolved`。
- 本票**不改任何源码**——源码面为空是它被判定为设计票、从而免跑测试与双轴 code-review 的机械依据。
- 提问通道一律 `orca orchestration ask`，禁 AskUserQuestion；open 决策 ask 回来，不编造。

## Answer

### 产出物

- `.scratch/thread-message-actions/spec.md`——设计文档本体（七节齐全，无自由章节）。原始产出位置是 `docs/design-notes/2026-10-05-thread-message-actions.md`，**当时的理由「`.scratch/` 未被跟踪，spec 只能落 `docs/`」已失效**：`.scratch/` 自 PR #86（commit `223a4af`）起入库，本文件已按 `docs/agents/issue-tracker.md` 的约定归位到 `.scratch/<feature-slug>/spec.md`（归位经过见末尾「归位记录」小节）。
- `.scratch/thread-message-actions/issues/01-thread-message-actions-bubble.md`——本票据（Status 已流转 `claimed` → `resolved`）。
- `CONTEXT.md` **未改**：无新术语（详见设计文档「术语决议」节）。
- `docs/adr/` **未新增**：ADR 三条件逐条判定后不建（详见设计文档「ADR 判定」节）。
- **源码零改动**：`git diff 2ab2535 HEAD --name-only | grep -v '^docs/\|^CONTEXT.md\|^\.scratch/'` 为空。

### D1–D6 逐条裁决（含人定 / 代答标记）

| 决策 | 裁决 | 标记 |
| --- | --- | --- |
| D1 scope | 只收窄线程面，频道面一字不动；收窄机制 = `onReply` 必填转可选 + 右键菜单 items 只由真实回调组装 | **人定**（coordinator 问回，理由：频道面 Reply 的文案「在线程中回复」与其行为「打开线程面板」自洽，没有要修的东西） |
| D2 线程两处「回复」死 affordance | 气泡不渲染 Reply；菜单 items 不再恒含 reply 首项；items 为空时不弹菜单（零新增代码，守卫已在 `components/ChannelView.tsx:1032`）。频道面菜单维持 `[在线程中回复 / 转为任务]` | **人定**（coordinator 首轮已定「为空时不弹菜单」，第二轮补确认 D2=A；B「补一个恒在项」与 C「空菜单照弹」均被否） |
| D3 线程内 Pin | 彻底删除：既不进 hover 气泡，也不进线程右键菜单 | **人定**（coordinator 倾向「迁右键菜单」，被**人否**，改彻底删） |
| D4 锚点消息 ⏰ | 保留在 hover 气泡（仅锚点行）；`AGENTS.md:425` / `AGENTS.md:240` 不被收窄 | **人定**（coordinator 倾向「迁右键菜单」，被**人否**，选保留） |
| D5 表情添加形态 | 保持二级（点 SmilePlus 展开 👍❤️🎉👀 + ＋ 选择器），不改成 hover 直出 | **代答**（我提议，coordinator 认可并补一条理由：(a) `AGENTS.md:434` 现有措辞描述的就是两级形态，改直出会收窄该裁决；(b) 用户原话只要求「只留表情添加」，未要求改形态，不动即忠于诉求。我的补充理由：删掉 Pin/Reply 后气泡只剩 3–4 键，再直出 4 个会撑到 7 键，右栏窄面板换行风险上升） |
| D6 文档同步 | 本票只记录待改写段落清单，改写随实施票落地 | **代答**（coordinator 代答并给判据：`AGENTS.md` 描述的是当前实现，设计票阶段改它会让文档先于代码说谎。我按 G-docs 判据复核后维持——同因，且设计票的源码面为空正是「文档先于代码说谎」的成因） |

**design tree frontier = 空**：D1–D6 全部结算，两轮 grilling（Round 1 = D1/D3/D4，Round 2 = D2 + D5/D6 代答确认）无遗留开放节点，无一条以「留待后续」收尾。

### 事实复核（coordinator 给了 13 处行号，我逐条重 grep；1 处修正）

- 全部命中，**唯一修正**：`components/ChannelView.tsx:873` 那一项的 `items` 数组实际是 **872–877**（`const items = [` 在 872，reply 项在 873，convert 展开项在 874–876，`];` 在 877），不是 coordinator 说的单行 873。
- coordinator 未给、但本票需要而我自己核出来的新事实：
  - `onReply` 是六个 prop 里**唯一必填**的（`MessageActions` 侧 `components/ChannelView.tsx:595`、`MessageRow` 侧 `:843`），而另外三个按钮（reaction `:618`、⏰、Pin）**早已是 optional-prop 门控**——「哪个面」这个问题在现有形状里已有答案，这是收窄机制只需改 3 处的判据。
  - 死 affordance 的**根因**在菜单：`items` 恒以 reply 项开头（`:873`）⇒ `items.length > 0` 恒真 ⇒ 无有效项也弹菜单。
  - **D3 的次生后果**：`notifyPinnedChanged`（`lib/panel-state.ts:60`）全仓唯一调用点是 `components/ThreadPanel.tsx:276`，订阅方是 `components/ChannelView.tsx:2542`。Pin 从线程删除后这条「面板↔中央 pinned 双端收敛」总线变成**无生产者的空壳**。已写进设计文档决策 5，标注为**实施票必须显式裁决**（推荐连同订阅方一并删），不默认留着。
  - 同理，线程面整条 pinned 回路（`ThreadPanel.tsx:58` state、`:9` type import、`:13` import、`:113` `loadPinned` + `:124-126` effect、`:259-282` `togglePin`）在删掉 `onTogglePin` 后无残留消费者 → 已列成清扫清单（设计文档决策 4）。
  - **既有测试预期零改动**：`components/ChannelView.test.mjs` 四个 `MessageRow` 用例（`:47` / `:67` / `:84` / `:299`）**全部显式传了 `onReply`**，`onReply` 转可选不会让它们变红；`:299` 传了 `onTogglePin` + `pinned: true`，Pin 在频道面保留也不受影响。`DetailPanel.test.mjs` 只按 kind 分派、不传消息行 props。

### 两条「回复」死 affordance 的处置（验收项 3 要求显式写出）

**事实**：线程里 hover 气泡的「回复」按钮（`components/ThreadPanel.tsx:383` / `:407` 传 `onReply={() => undefined}`）与线程右键菜单的「回复」项（由 `components/ChannelView.tsx:873` 恒定注入）**都是点了没反应的假 affordance**。

**处置**：一并**删除**，且做法不是「继续传空函数」，而是「不传这个 prop，让按钮与菜单项根本不存在」。理由写在设计文档 Solution 节：假 affordance 的代价不是点下去没反应，而是用户会反复尝试并怀疑自己的操作。删除后的显式行为变化 = **线程内普通消息右键不再弹出任何菜单**（items 空 ⇒ `:1032` 守卫不成立），这是刻意接受的——弹出点什么都不能按的框是假 affordance 的最后残留。

### 被收窄 / 不需收窄的已写明裁决（验收项 4）

**需改写（随实施票）**：
- `AGENTS.md:434`「动作栏 `Pin`（pinned 态黄底）channel/thread 消息通吃」→ 收窄为 channel only；同段前半句 hover 快捷 reaction 措辞**不动**（D5 未收窄）。代价须一并写入：线程内消息无法置顶、置顶只能在频道主流程做、已置顶的线程消息仍可从频道头部 pinned 区定位/展开。
- `AGENTS.md:246`（File Map 的 `ThreadPanel.tsx` 条目）「pin/unpin 经 notifyPinnedChanged 通知中央刷新」→ 线程侧不再有 pin/unpin 入口。
- `AGENTS.md:220`（`lib/panel-state.ts` 条目）「`subscribePinnedChanged`/`notifyPinnedChanged`（面板↔中央 pinned 双端收敛）」→ 与上一条同一次改写，取决于决策 5 选删还是留。

**不需改写（有理由，非遗漏）**：
- `AGENTS.md:425` 与 `AGENTS.md:240`（消息动作栏 ⏰）——D4 保留 ⏰，裁决未被收窄；§5.6「消息锚定提醒 → 到点系统消息 → 从线程回复角标发现进展」这条场景链因 D4 完整保留。
- 「频道面『回复』按钮文案与行为耦合」——只留痕（设计文档 Further Notes），不改代码、不收窄任何裁决；理由：不在本诉求范围 + D1=A 已定频道面一字不动 + 文案与行为方向一致不构成误导。留痕的目的是防止下一个人把它当 bug 顺手改坏。

### ADR 与术语

- **ADR：不建**。三条件逐条判定：①难以逆转 = **不满足**（单面 UI 收窄，逆转成本分钟级，无数据迁移/对外契约/跨模块承诺）；②无上下文会困惑 = **不满足**（诉求由用户直接提出、方向与直觉一致、代码自身解释形状）；③真实权衡 = **满足**（D2/D3 确为真权衡）。三条件未全满足 ⇒ 不建。选中的分支 + 被否决的分支（variant prop / 拆两个模块 / 动作注册表）连同理由已完整落在设计文档 Solution 裁决表与决策 2、决策 9 里，ADR 要提供的价值没有丢失，单独建只会制造第二处需同步的真相。
- **术语：无新术语，`CONTEXT.md` 不改**。本票全部词汇取自仓库既有语言（频道 / 线程 / 锚点 / 置顶 / 消息动作栏）；「假 affordance / 死按钮」是对既有代码事实的描述，不是这个项目的领域概念，不入词表。描述动作栏时用 module / interface / seam / leverage / locality，未用 component / service / API / boundary 描述设计；引用 `AGENTS.md` 既有措辞（如「动作栏」）按仓库语言一致性保留。

### 门禁自检（G-docs）

> **判据 4 已由 coordinator 修正**（原写「**全仓** grep `不进版本库|不被 git 跟踪|gitignore:50|必须落 docs/` → 命中为零，或全部位于标注为『#86 之前的历史事实』的那一节内」，与同票 Ownership「不许碰其他 effort 的任何文件」自相矛盾）：现收窄为**只管本票自己的两个文件**（本 spec.md + 本票据）。全仓残留按 (a)/(b)/(c) 三类逐条分类记在末尾「归位记录」，判据是**被修正过的**，不是漏检。
> **本节后半的 git 命令结果、`docs/design-notes/...` 路径与 `.gitignore:50` 描述，均为 #86 之前的历史事实**，按当时原样保留、不回填成现在（`.scratch/` 自 PR #86 commit `223a4af` 起已入库）。归位后的现状见末尾「归位记录」。

- 七节齐全：Problem Statement / Solution / User Stories / Implementation Decisions / Testing Decisions / Out of Scope / Further Notes；`## ` 顶层无自由章节（两张按钮清单等均为既有章节内的 `###` 子节）。
- 源码面为空：`git diff 2ab2535 HEAD --name-only | grep -v '^docs/\|^CONTEXT.md\|^\.scratch/'` → 空（见下方「命令结果」）。
- 不跑测试 / 不做双轴 code-review / 不跑 typecheck / lint（设计票门禁；无被测对象）。
- `git status --porcelain` 干净（`.pi-lens.json` 已写入并加进 `.git/info/exclude`，不出现）。
- `git diff --numstat` 无四位数行改动（新增 1 个 markdown 文件 + 本地票据，票据因 `.gitignore:50` 不入库）。
- design tree frontier 为空；`Status:` 已收敛到 `resolved`。
- 提问全程走 `orca orchestration ask`（2 轮 / 2 次调用），未用 AskUserQuestion；open 决策无一自行拍板。

### 命令结果

> **以下命令结果为 #86 之前的历史事实**（base `2ab2535`，当时 spec 还在 `docs/design-notes/`、本票据尚未入库），路径按当时原样保留。

- `git diff 2ab2535 HEAD --name-only | grep -v '^docs/\|^CONTEXT.md\|^\.scratch/'` → 无输出（源码面为空 ✅）
- `git status --porcelain` → 仅 `A  docs/design-notes/2026-10-05-thread-message-actions.md`（`.pi-lens.json` 已被 exclude）
- `git diff --numstat` → `157  0  docs/design-notes/2026-10-05-thread-message-actions.md`（无四位数行 ✅）
- 未执行 `next build` / `prettier --write` / `eslint --fix` / `oxlint --fix` / `biome --write`（BEHAVIOR RULE 6）
- 行号复核脚本：文档内 36 处 `file:line` 全量 grep 校验，逐处比对行内容，零错

### 交给实施票的产物

- 实施票 **1 张**：`thread-message-actions-narrowing`，Blocked by 无，交付物 = 决策 1/3/4/5/7 + AGENTS.md 三处改写 + Testing Decisions 的 7 条人工回归清单。
- 拆票判断：**不拆**。六处改动共享同一根因（`onReply` 必填导致线程面无法收窄），拆两票会让中间态既不满足诉求又不满足任何断言；改动量（`ChannelView.tsx` ~30 行 + `ThreadPanel.tsx` ~60 行）落在同一票内可一次走完 `/implement` 的红-绿循环。

### PR

- 分支：`whutlichao/thread-message-actions`（`new-top-level` 从 origin/main 切出，base `2ab2535`）
- PR：**#85** — https://github.com/whutlichao/worksplice/pull/85 （`whutlichao/thread-message-actions` → `main`，files=1，+157/−0，OPEN）

### 归位记录：spec 移回 `.scratch/`（#86 之后）

**依据**：PR #86（commit `223a4af`）已从 `.gitignore` 移除 `.scratch/` 并把本 effort 的票据提交进库，`docs/agents/issue-tracker.md` 约定的 spec 位置（`.scratch/<feature-slug>/spec.md`）重新可用且被跟踪；本票据当时「`.scratch/` 未被跟踪、spec 只能落 `docs/`」的理由就此失效。**人定：只重做存放位置**——D1–D6 六条裁决、两张按钮清单、被收窄裁决清单、ADR 判定、术语决议逐字保留，不重跑 grill。

**改了什么**：

1. `git mv docs/design-notes/2026-10-05-thread-message-actions.md .scratch/thread-message-actions/spec.md`（保留文件历史）。原位置**不留指针文件**——留一份就有两份真相，而仓库约定只有 `.scratch/<feature-slug>/spec.md` 一个位置。
2. `spec.md` 头部在「性质」那行后补一句位置说明（正本 + 位置依 `docs/agents/issue-tracker.md`）；**正文逐字未动**：`git diff -M` = `similarity index 99%`、`numstat` 为 `1 0`，唯一内容差异就是那一行。
3. 本票据三处失效表述：`What to build` 的产出路径改指 `.scratch/thread-message-actions/spec.md`；「产出物」条目同步新位置并写明旧理由失效的新事实；「门禁自检」「命令结果」两节**加标注而不改写**（其中的 `docs/design-notes/...` 路径、`git status` / `git diff --numstat` 结果、`.gitignore:50` 描述是当时的历史事实，按当时原样保留，并已标明为 #86 之前）。

**门禁**：G-docs —— 文件到位（旧路径已不存在、新路径七节齐全）、裁决逐字未丢（grep 复核 D1 / D3 / D4 原文与两张按钮清单仍在）、失效表述已处理、design tree frontier 仍为空。本票**不跑测试、不做双轴 code-review、不跑 typecheck / lint**（设计票门禁，无被测对象）；源码面为空：`git diff afc9a11 HEAD --name-only | grep -v '^\.scratch/\|^docs/'` 无输出。除本票的两个文档外无其他改动；`.pi-lens.json` 按 BEHAVIOR RULE 6 写在本仓并本地 exclude，未入库。

**判据 4 收窄与全仓残留分类**（`ask` 里问回、coordinator 代答：判据是 spec 写错，不是 worker 越界）——grep `不进版本库|不被 git 跟踪|gitignore:50|必须落 docs/` 的残留分三类：

- **(a) 本 effort 两个文件内**：`门禁自检` 节的两条标注 + 该节保留的旧路径 / `.gitignore:50` 描述 + `归位记录` 节的元描述，**全部在已标注为「#86 之前的历史事实」的范围内** ✅ 不需处理。
- **(b) 语义无关，不算残留**：`.gitignore:55`、`bin/demo-data.js`、`scripts/build-demo-db.mjs` 的「不进版本库」说的是**打包期生成的演示库**，不是 `.scratch/`。
- **(c) 别的 effort 的文件，本票一律不碰**（与 Ownership 一致）：`.scratch/promote-worksplice/{map.md,plan-private.md,issues/10-plan-assembly.md}`（私有计划）；另有 `docs/spike-systemprompt-fix.md:868`「（`.scratch/` 已在 `.gitignore:50`，不进 PR）」是 **#86 之后真的失效的表述**，但属另一个 effort，**本票不碰**——作为**遗留项**记入此处，是否另开清理票由人另行决定。

**PR**：#87 — https://github.com/whutlichao/worksplice/pull/87 （分支 `whutlichao/thread-message-actions-spec-home` → `main`，纯文档移动 + 几处表述；diff = 1 个高相似度 rename（相似度 99%）+ 少量行改动，源码面为空）