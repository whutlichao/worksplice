# 03: 马卡龙迁移——调用点读到对的那一档（migrate）

**What to build:** 界面里凡是**用颜色说话**的地方都读到对的那一档——正文与链接走文字档、焦点环与状态点走图形档、填充走填充档。改完之后肉眼能分辨「行动 / 选中 / 未读 / 警示」四种状态各有自己的色相，且每一处都清晰可读（对比度达标）。

**Blocked by:** 02（**同一 PR 内满足**：两票必须同批合入，见票 02 的最后一条）

**Status:** resolved

- [x] 约 100 处 accent 族文字 / 图形调用点改指 `-deep` / `-graphic`（清单与判据见 spec 的「消费点账」）
- [x] 7 处 `--accent-line` → `-graphic`；约 20 处 on-accent 字面量 → `var(--on-accent)`；约 14 处 error 填充 → `--error-fill`
- [x] 四态状态点 → 各族的图形档；`.meter.warn` / `.lv.warn` → `--warn*`；`--online-text` / `--working-text` 改实值
- [x] 既有断言按**意图**改写（spec 的 Testing Decisions 表里标「按意图改写」的逐条登记，每条写明「为什么这条断言该改」）
- [x] 红→绿证据：改动前能指认到的失明/不达标项 → 改动后达标（用实测对比度，不用推断）
- [x] 交付前把 spec「消费点账」的口径重跑一遍（逐文件计数），若与 216 = 78 + 138 有出入，在 Answer 里如实记录差异
- [x] 双轴 code-review（Standards + Spec 两份报告，不合并）+ Answer 小节
- [x] 推分支后**并入票 02 的同一 PR**（同批交付），PR 号回填 Answer

## Answer

### 交付物

**commit**：`b397dfc feat(design-system): 调用点读到对的那一档（票 03，migrate）`（与票 02 同 PR：<https://github.com/whutlichao/worksplice/pull/124>，base = `cd89136`；分支已 rebase 到最新 main，PR 无冲突）

迁移映射（一条规则贯穿全仓，逐处按语义归属）：

| 语法位置 | 去向 | 依据 |
| --- | --- | --- |
| `color` / `text-decoration-color` | `-deep`（各族文字档） | D6：文字 ≥4.5:1 |
| `border-color` / `outline` / `border-left` / `stroke` / 拖拽落点 | `-graphic`（各族图形档） | D6：图形与边界 ≥3:1 |
| `background` = 实底填充 | 不动（base 名即填充档） | D7 |
| `background` = 徽标 / 横幅底（其上压文字） | `-fill` + `var(--on-accent)` | D7「徽标与横幅底改指 `-fill`」 |
| 「当前位置」（导航激活 / 锚点行 / tab / 选中 chip / 时间线 now） | `--selected*` | D3 + Implementation Decisions §3 |
| 未读角标 / 命中高亮 | `--unread*` | D3 + §3 |
| 警示（`.warn` 词汇 + `role="alert"` 的两条警示横幅） | `--warn*` | D9 |
| `oklch(99% .01 256)` 字面量 | `var(--on-accent)` | D5 |
| 阴影 / scrim ink | `oklch(33% 0.045 300 / …)` | D10 |

**收口三项机械判据全部为 0**（spec Testing Decisions §2 的证明方式）：`oklch(99% \.?0?1 256)` **0 处** · `var(--accent-line)` **0 处** · 旧阴影 ink `oklch(21% 0.02 255` 在 `app/components/hooks/lib` + 两份 token 文件 **0 处**（`ui_kits` 静态原型另有 1 处，登记在票 02 的遗留项）。

### 消费点账口径重跑（与 spec 的 216 对账）

口径同 spec：「`var(--accent*)` 在 `app/**` + `components/**` + `hooks/**` + `lib/**` 的 `.ts/.tsx/.css` 逐文件出现次数」。

| | base（`9ce948e`） | 交付 | 差异 |
| --- | --- | --- | --- |
| `--accent` | 150 | 21 | −129（迁到 `-deep` / `-graphic` / 三个角色族） |
| `--accent-soft` | 56 | 53 | −3（7 处并入选中族淡底、另新增 2 处） |
| `--accent-line` | 7 | **0** | −7（全部改指 `-graphic`；定义留给票 04 删） |
| `--accent-hover` | 3 | 3 | 0 |
| **`var(--accent*)` 合计** | **216** | **191** | **−25** |
| 其中 `app/globals.css` | 78 | 56 | −22 |
| 其中 `components/**` | 138 | 135 | −3 |

差异的构成（实测对账，不是估算）：
1. `app/globals.css` −22 = 21 处改族到 `--selected*` / `--unread`（导航激活 2 · 锚点行 3 · `.filter-chip.is-on` 3 · `.tab.is-active .count` 1 · `.dock-tab .count` 1 · `.member-opt.is-on` 3 · `.radio-card.is-on` 2 · `.reaction.mine` 3 · `.tt-log li.is-now` 2 · `.badge` 1）+ 1 处 `.result mark`（它本来借的是 `--working`，改指 `--unread`，属跨族）。
2. `components/**` −3 = 4 处 `accentColor`（复选控件的原生强调色）改选中族图形档（−4）+ `TASK_STATUS_BADGE_BG.in_progress` 新增 1 处填充档引用（+1）。
3. 新增角色族的消费点：`--selected*` 26 · `--unread*` 3 · `--warn*` 10 · `--on-accent` 22。

spec 的角色口径（「≈100 处文字/环迁移 + ≈79 处零改动 + ≈36 处逐处判」）在交付态落地为：**文字档 77 处 + 图形档 37 处 = 114 处改档**（比 ≈100 略多，因为 `--accent*` 之外 `--error` / `--working` 的文字站点也一并归位），填充与淡底 0 改动（`--accent` 21 + `-soft` 53 + `-hover` 3 = 77 处），逐处判的 33 处按上表逐条归类并在本节登记。

### 既有断言按意图改写：逐条登记（原 → 新 + 为什么该改）

**改写纪律**：改的是**断言的落点**（token 名），**判据**（对比度 / 成对性 / 可达性 / 形态）一条没放宽；没有任何一条被删除或静默跳过。

| # | 文件 | 原断言 | 新断言 | 为什么该改 |
| --- | --- | --- | --- | --- |
| 1 | `app/globals.test.mjs` T-C | `:focus-visible { outline: 2px solid var(--accent) }` | `… var(--accent-graphic)` | 环是**图形档**（D6 ≥3:1）；旧落点已是 1.4–1.6:1 的亮档。判据「环必须存在且是 accent 族」不变（后一条 `0 0 0 3px var(--accent-soft)` 原样保留）。 |
| 2 | `primitives.test.mjs` | `.btn-primary` `color: oklch(99%` | `color: var(--on-accent)` | 填充档上的字必须达 AA：亮档 + 白字 1.4:1 → 深墨 **7.74:1**。判据「填充 + 其上文字达 AA」不变。 |
| 3 | `primitives.test.mjs` | `.btn-primary:hover` `color: oklch(99%` | `color: var(--on-accent)` | 同上（hover 填充档也是亮档）。 |
| 4 | `primitives.test.mjs` | `.icon-btn.is-on` `color: var(--accent)` | `var(--accent-deep)` | spec 明写「填充保持绿」，只有**文字**不可读需改档。判据「开启态可辨」不变。 |
| 5 | `primitives.test.mjs` | `.badge` `background: var(--accent)` | `var(--unread)` | 未读是**注意力**信号（D3），与「行动」不同族；判据「实底 + 深墨达 AA」（9.52:1）不变。 |
| 6 | `dock.test.mjs` | `.meter.warn i` `background: var(--working)` | `var(--warn)` | D9：警示语义从「借 `--working`」独立成族；`.meter i` 与 `.meter.warn i` 都是条状填充 → 同取填充档。判据「条状填充」不变。 |
| 7 | `dock.test.mjs` | `.dock-tab .count` `color: var(--accent)` | `var(--selected-deep)` | tab 计数是「当前位置」→ 选中族文字档。判据「mono 计数走高对比族色」不变。 |
| 8 | `dock.test.mjs` | expected 映射 `in_progress: "--accent"` | `"--accent-graphic"` | 点档改名：`--accent` 今为填充档，作点只有 1.3:1。判据「五态点各有可辨认色」不变。 |
| 9 | `dock.test.mjs` | `.tt-log li.warn::before` `var(--working)` | `var(--warn-graphic)` | 与 `.lv.warn` **同一份警示级词汇**（同一文件两块），不迁就分叉出两种色相。点 ≥3:1。 |
| 10 | `dock.test.mjs` | `.tt-log li.is-now::before` `background/box-shadow = --accent / --accent-soft` | `--selected-graphic` / `--selected-soft` | spec 把 is-now 的两条候选（`--selected-graphic` 或 `--accent-graphic`）交给实施票定：选前者，因为它是时间线上的「**当前位置**」语义（与 `.nav-row.is-active::before` 同源）。判据「现在点可见 + 有光环」不变。 |
| 11 | `dock.test.mjs` | `.lv.warn` `color: var(--working-text)` | `var(--warn-deep)` | D9：警示族有自己的文字档。判据「级别标签高对比（4.92:1）」不变。 |
| 12 | `dock.test.mjs` | `.lv.info` `color: var(--accent)` | `var(--accent-deep)` | 文字档（填充档作字只有 1.4:1）。判据「四档前景色各自可读」不变。 |
| 13 | `task-board.test.mjs` | 映射 `in_progress: "var(--accent)"` | `"var(--accent-graphic)"` | 同 #8（本仓两份测试各持一份映射副本，逐条比对源码）。 |
| 14 | `task-board.test.mjs` | `.col.drag-over` `border-color: var(--accent)` | `var(--accent-graphic)` | 拖拽落点是**边界**（≥3:1）；背景 `--accent-soft` 保留。判据「落点边界可见」不变。 |
| 15 | `task-board.test.mjs` | `.filter-chip.is-on` `border-color: var(--accent-line)` + `background: var(--accent-soft)` | `--selected-graphic` + `--selected-soft` | `--accent-line` 退役；选中 chip 归选中族（D3）。判据「选中态 = 淡底 + 可见边界，成对出现」不变。 |
| 16 | `message-stream.test.mjs` | `.ws-message-row-anchor` 的填充 / 竖条 / hover 三处 `--accent-soft` / `--accent` | `--selected-soft` / `--selected-graphic` / `--selected-soft` | 锚点行是「当前位置」（spec §3 明点名）。判据「不是黄色实心、竖条宽 2px」不变。 |
| 17 | `message-stream.test.mjs` | `.msg-author.is-agent` `color: var(--accent)` | `var(--accent-deep)` | agent 作者名是**文字**。判据「agent 与人类作者可区分」不变。 |
| 18 | `message-stream.test.mjs` | `.reaction.mine` `background: var(--accent-soft)` | `var(--selected-soft)` | 「我点过」= 选中态。判据「我的反应与别人的可区分」不变。 |
| 19 | `message-stream.test.mjs` | `.chan-title .hash` `color: var(--accent)` | `var(--accent-deep)` | 频道名的 `#` 是文字（mono 强调），spec §4 明点名。判据「mono + accent 族强调色」不变。 |
| 20 | `AppShell.test.mjs` | `.search-btn:focus-within` `border-color: var(--accent)` | `var(--accent-graphic)` | 字段环 = 图形档（≥3:1）。判据「环存在且是 accent 族」不变（3px `--accent-soft` 环原样保留）。 |
| 21 | `AppShell.test.mjs` | `.nav-row.is-active::before` `var(--accent)` + `.hash` `var(--accent)` | `--selected-graphic` + `--selected-deep` | 导航激活是「当前位置」（spec §3 明点名）；测试标题一并改为「选中族」，不假装它还是 accent。判据「不是黄色实心、竖条可见、mono `#` 可读」不变。 |
| 22 | `SearchView.test.mjs` | `.search-field:focus-within` `border-color: var(--accent)` | `var(--accent-graphic)` | 字段环 = 图形档。判据「容器上有可见焦点环」不变。 |
| 23 | `SearchView.test.mjs` | 命中作者名 inline `color:var(--accent)` | `color:var(--accent-deep)` | 作者名是文字。 |
| 24 | `SearchView.test.mjs` | `.result .r-top .hash` `color: var(--accent)` | `var(--accent-deep)` | `#seq` 是文字（同时仍断言 mono + tabular-nums）。 |
| 25 | `SearchView.test.mjs` | `.result mark` `background: color-mix(working 45%)` | `var(--unread)` | spec §4 明点名：命中高亮是**注意力**信号，与「进行中」无关。取填充档（其上 `--muted` 文字实测 **5.53:1** ≥4.5）。判据「mark 高亮仍在」不变。 |
| 26 | `BrutalModal.test.mjs` | `:focus-visible { outline: 2px solid var(--accent) }` | `var(--accent-graphic)` | 同 #1。 |
| 27 | `BrutalModal.test.mjs` | `.overlay` scrim `oklch(21% 0.02 255 / 0.42)` | `oklch(33% 0.045 300 / 0.42)` | D10：scrim 的 ink 换梅墨族，**几何与透明度档位不动**（0.42 逐字保留）。判据「全屏遮罩 + blur」不变。 |
| 28 | `CreateChannelModal.test.mjs` | `.radio-card.is-on` `border-color: var(--accent)` + `background: var(--accent-soft)` | `--selected-graphic` + `--selected-soft` | 选中卡片归选中族。判据「选中态 = 淡底 + 可见边界（不是黄色实心）」不变。 |
| 29 | `CreateChannelModal.test.mjs` | `.member-opt.is-on` `background/color = --accent-soft / --accent` | `--selected-soft` / `--selected-deep` | 选中 chip 归选中族。判据「选中态可读、成对出现」不变。 |

**未改而保持绿的**（spec §4 表里标「保持绿」的，逐条复核过）：`app/globals.test.mjs` 的 T-A（上游 / 生效值逐字一致）与 T-D（四态渲染绑 `--online` / `--working` / `--error` / `--offline`）、`primitives.test.mjs` 的 `.btn-danger` / 四态点 / 五格 `--av-N`、`StatusDot.test.mjs` 四态、`Avatar.test.mjs`、`ReminderModal.test.mjs` 的 `.btn-danger`、`ProjectTrustDialog.test.mjs` 的 `--error`、`AgentDetailPanel.test.mjs` 的 `var(--working)`、`MobilePwaLayout.test.mjs` 四条。

### 红 → 绿（迁移面：spec 登记的 4+1 处失明 / 不达标，两侧实测）

| 配对 | base（改动前） | 交付（改动后） | 阈值 |
| --- | --- | --- | --- |
| `--accent` 作文字 on `--panel-2` | **4.16** | **4.52** | 4.5 |
| `--error` 作文字 on `--bg` | **4.21** | **5.27** | 4.5 |
| `--faint` on `--panel-2` | **4.10** | **4.53** | 4.5 |
| `--working` 点 on `--surface` | **2.35** | **3.66** | 3.0 |
| `--offline` 点 on `--surface` | **2.00** | **3.64** | 3.0 |

计算口径与全表见票 02 的 Answer（同一支 WCAG + OKLab 脚本；该脚本复现了 spec 的 4.94 ΔL 与全部 soft 合成 sRGB，两侧可比）。

### 渲染面证据（迁移后产品自己渲染出的是什么）

真浏览器（ego-browser，端口 30143，`WORKSPLICE_DATA_DIR=/tmp/macaron-tokens-data`）读到：

- **焦点环**：真 `button.icon-btn` 的 `:focus-visible` → `outline: 2px solid lab(55.5095 28.405 -1.56869)`，与 `--accent-graphic` 的序列化值**逐字相等**；`.search-btn:focus-within` / `.composer-box:focus-within` 的 `border-color` 同样等于 `--accent-graphic`，`box-shadow` = `oklch(0.857 0.0859833 356.814 / 0.22) 0 0 0 3px`（= `--accent-soft` 环）。
- **四态点**：真 `.presence.online` = `lab(55.1443 -35.6071 14.5089)`（= `--online`）；`working` / `error` / `offline` 用产品自己的 class 规则取计算值，分别等于 `--working` / `--error` / `--offline` 的序列化值。
- **pastel 填充 + 其上文字**：`.brand-mark` / `.btn.btn-primary` 的 `bg` = `--accent`、`color` = `--on-accent`；`.badge` 的 `bg` = `--unread`、`color` = `--on-accent`；`.avatar.sm.av-0` 的 `bg` = `--selected`、`color` = `--on-accent`。
- **根上**：`--bg` = `lab(97.7239% .318408 4.19663)`、`--fg` = `--on-accent` = `lab(21.7051% 8.71933 -14.2173)`、`--accent` = `lab(82.3067% 28.5758 -1.52109)`。

（探针方法学：token 与三态点的对照值用同页探针元素取，探针只设 inline `transition:none`；`--dur` 实测 `.12s`，第一轮读 `:focus-within` 卡在过渡起点即因后台 tab 不推进过渡。）

### 双轴 code-review

### 双轴 code-review

两轴各由**独立评审子代理**跑（fresh context，只读、不许改文件）；下面是两份报告的**原文**，不合并、不重排。固定点 = `origin/main`（`cd89136`，本 PR 的 base），命令 `git diff origin/main...HEAD`。两位评审都声明了取证限制（无 shell/git 权限，靠 base 检出对读 / 只读交付态源码），故它们**未跑测试**——门禁结果由我在 worktree 内独立跑（见上一节）。

#### Standards 轴

## Review（Standards 轴）

**取证限制（先声明）**：本会话无 shell/git 权限，`watchdog_diff` 只能看工作区（当前为空）。我用 **base 检出**（主仓 `/Users/apple/orca/worksplice`，reflog 末条 `pull → cd89136`，无后续 checkout）与 HEAD 逐文件对读重建了 diff 面。若该检出已移动，结论需复核。未执行任何命令。

**正确（已有证据）**
- 色值只动上游：`colors_and_type.css:20-59` 全量换值+档位名，`app/globals.css:79-98` 只加产品角色族（未覆盖同名 token）→ 符合 ADR-0015「上游即真源」与 T-A。
- 零行为改动成立：`components/**` 内 `oklch(` 计数 0；`ui_kits/app/app.css`、`globals.css` 的 diff 全是色值/注释（`base globals.css:41 → HEAD:41` 环、`1185` 徽标底仅换 token）。
- 注释简体中文（i18n.md「注释层」）、29 条断言改写逐条登记（票 03 Answer）、`app/layout.tsx:42-43` 注释与色值同步。

**Finding: P2 — 零消费者 token 未登记**。本 PR 新增 `--working-soft`（colors_and_type.css:57）· `--offline-soft`（:59）· `--unread-soft`（globals.css:90）· `--unread-graphic`（:92）· `--offline-deep`（:54）五处全仓无 `var()` 消费者（全仓正则仅命中定义行）。本仓成文先例要求登记：`app/globals.css:1570`「零消费者登记（coordinator 裁决 3）」、`:1607`、`:1411`；票 02 只登记了 `--offline-deep` 一个。最小修：在两处族块头补一行登记（或列入票 04 的清理清单）。`--accent-line`（定义仍在、0 引用）同理，已登记在票 03 偏离 7，无需重复。

**Finding: P2（判断项）— ui_kits 依赖产品扩展层**。`worksplice-design-system/ui_kits/app/app.css:89/96/199/226/284-285/343/372-376` 引用 `--selected*`/`--unread*`/`--warn*`，全仓唯一定义在 `app/globals.css:83-98`；SKILL.md §1 声明 kit 的底座只有 `colors_and_type.css`+`tokens.css`（`preview/*.html` 亦只链这两份）。镜像是为保「逐字搬运」断言（票 03 偏离 4，ask 超时后执行），但 kit 现依赖 11 个产品层名（基线仅 `--online-text`/`--working-text` 两个，同模式先行存在）。最小修：三者上游化，或在 kit/SKILL 就地登记这条依赖。

**Finding: P2（判断项，baseline）— Duplicated Code**。同一「状态→档位」形状本 diff 必须同步改多处：`ReminderModal.tsx:98` 与 `MyRemindersModal.tsx:105` 是逐字相同的 `scheduled ? --online-fill : --offline-fill`；任务态映射在 `ChannelView.tsx:1023-1039`（两张表）+ `AgentDetailPanel.tsx:222` + 两份测试副本各一份。最小修：抽一个映射模块，测试 import 它。

**未报（合规）**：`--accent` 一名多义（ADR/spec D7 明文承认并给缓解，仓库标准优先）；`--error-fill` 同值不立第二名字、`-text` 沿用旧名（D7 裁决）；`layout.tsx` 的 `#fcf8f0` 字面量（meta 不接受 `var()`，基线同形）。

**Merge verdict: OK with notes**（无 P0/P1；两条 P2 建议随后续票或一次补注释处理）。剩余风险：本评审基于重建 diff；请 supervisor 在 worktree 内跑 `npm test`（票面称 1290/1290）、`node_modules/.bin/tsc --noEmit`、`npm run lint` 复核。

#### Spec 轴

## Review（Spec 轴）

**限制**：`watchdog_diff` 只给工作区增量、读不到已提交区间（本次为空）；以下基于交付态源码 + 票面/Answer 对账，未跑测试。

**Correct（抽样证实）**
- 矩阵取值逐字对上：纸/墨族、`--accent`(fill 85.7% / hover 79.4% / deep 53% / graphic 62.6%)、selected/unread/warn 四档、`-soft` 配比（22/21/36/24，勘误 2）、四态 base 指向（online/working/offline=graphic、error=deep）、`--av-*`、阴影 ink（`colors_and_type.css:19-70`、`globals.css:83-98,118-119`）。
- `--accent-line` 定义仍在（`colors_and_type.css:38`）、`app/`+`components/` 引用 0 → 合「删除属票 04」；`--error-graphic` 确未新增；`--on-accent` 在上游（`:30`）、三角色族在扩展层（`globals.css:82-98`），与勘误 4 逐条一致。
- 徽标/点分表有依据：D7 原句「徽标与横幅底改指 `-fill`」→ `TASK_STATUS_BADGE_BG`（`ChannelView.tsx:1034`）；点档走 `--accent-graphic` 属 §4「点档改名 → 按意图改写」。
- 无未授权 scope creep：`ui_kits/app/app.css` 镜像被两条「逐字搬运」断言强制；`app/layout.tsx:43` themeColor 是 `--bg` 近似；三处越界均在票面登记。

**Finding P1** `Toggle` 启用态：轨道 `var(--accent)` vs 旋钮 `var(--bg)` = **1.51:1**（改前 #2072d5 约 4.6:1），轨道 vs 纸 1.58:1（`SkillsConfig.tsx:71,214`、`PluginsConfig.tsx:214`）；`.meter i`(globals.css:1458，`AgentDetailPanel.tsx:1046` 消费) vs 槽 `--panel-2` = **1.30:1**（改前 3.86:1）。spec §1 配对表只覆盖「fill + `--on-accent`」与「deep/graphic on 纸/soft」，D6「图形边界 ≥3:1，不达不通过」未覆盖 fill on 纸，票面也未登记。最小动作：这两类站点改走 graphic 档，或明写继承缺口并相应改断言（现断言锁 `var(--accent)`）。

**Finding P2** `ProjectTrustDialog.tsx:62` 信任盾牌仍 `--working-text`。D9「`--warn*` 承接今天借 `--working` 的警示语义站点」+§3「上传/信任类横幅」；上传横幅（`FileExplorer.tsx:759,764`）已迁 warn，信任面漏。修法：`var(--warn-deep)`。

**Finding P2** `worksplice-design-system/worksplice-app.html` 未随动：旧 ink 3 行 4 处（:33/:227/:382）、`oklch(99% .01 256)` 2 处（:67/:234）、`.filter-chip.is-on`/`.reaction.mine` 仍 `--accent-line` + `color:var(--accent)`。spec §2 判据原文「全仓正则计数为 0」，票面只在 app/components/hooks/lib + token 文件口径称 0、只登记 `app.css:289` 一处；ADR-0014 把该文件列为契约第四件。修法：同批迁，或点名进票 04 清单（现只列 DESIGN.md/SKILL.md/AGENTS.md/docs/spec.md）。

**Merge verdict: OK with notes**（P1 先定性：修或登记）。

#### findings 的处置（逐条：已处理 / 有理由豁免）

| 轴 | finding | 处置 |
| --- | --- | --- |
| Standards | **P2 零消费者 token 未登记**（`--working-soft` / `--offline-soft` / `--offline-deep` / `--unread-soft` / `--unread-graphic`） | **已处理**：按本仓既有先例（`app/globals.css` 的「零消费者登记（coordinator 裁决 3）」）就地登记两处——`colors_and_type.css` 的四态块头 + `globals.css` 的三角色族块头，写明「矩阵先落词汇、消费点随后票接、不删（删了就不成矩阵）」。 |
| Standards | **P2（判断项）`ui_kits/app/app.css` 依赖产品扩展层名** | **登记（交票 04 裁决）**：属实，且这是我做镜像迁移换来的代价。事实面：基线已经有 `--online-text` / `--working-text` 两个同形跨层引用，本 PR 把它扩到 11 个。两条出路（① 三个角色族上游化；② 在 kit / SKILL.md §1 就地登记这条依赖）都落在票 04 的文件面（`SKILL.md` 在本票的「不碰」清单里），故本票只登记、不动手。 |
| Standards | **P2（判断项，baseline）Duplicated Code**：状态→档位的映射在 `ChannelView`（两张表）/ `AgentDetailPanel` / `ReminderModal` / `MyRemindersModal` 与两份测试副本里重复 | **有理由豁免**：「一个消费点一张表 + 测试持副本逐条比对源码」是本仓既有的成文惯例（两份任务板测试就是这么读 `TASK_STATUS_COLOR` 的），本 PR 的新增表沿用了同一惯例；抽公共映射模块是重构，越出「本票只作用色值」的边界，登记为后续票候选。 |
| Spec | **P1 条状指示器落在填充档上反差掉到 1.19–1.51:1** | **已处理（改走图形档）**：`.meter i` → `--accent-graphic`（on 槽实测 **3.03**）、`.meter.warn i` → `--warn-graphic`（**3.04**）、两处开关轨道 → `--accent-graphic`（on 纸 **3.51**），`ui_kits/app/app.css` 同步镜像；spec §4 那两条「保持绿」作废并写进 `spec.md` 的勘误 6，`dock.test.mjs` 的两条断言按落点改写（判据「条状指示器可见」不变）。**提问留痕**：这条与 spec §4 的字面冲突我按纪律 ask 回来过（msg_69446509092b，15 分钟超时未获答复），按提问里的推荐项 (a) 执行并如实登记；若最终裁定 (b)（保持零改动 + 登记为继承缺口），回退面是这 4 处 + 2 条断言。 |
| Spec | **P2 `ProjectTrustDialog.tsx:62` 的信任盾牌仍 `--working-text`** | **已处理**：→ `var(--warn-deep)`。spec §3 明写 `--warn*` 承接「上传/信任类横幅」，我漏了这一处（上传横幅迁了、信任面漏了）；该色未被任何断言锁定，改后 1290/1290 仍绿。 |
| Spec | **P2 `worksplice-design-system/worksplice-app.html` 未随动** | **登记（交票 04）**：它是**自带内联 `:root` 的第三份色板副本**（`worksplice-app.html:9-33` 自己声明全套 token）——不是消费者，而是 ADR-0015 D11「色值全部落在 `colors_and_type.css`」在写 spec 时没人核过的一处反例；非运行时、无断言读它。我的「全仓计数为 0」口径一直限定在 `app/components/hooks/lib` + 两份 token 文件（票 02 的 Answer 原文如此），本 finding 的价值在于点出该文件本身需要一次「同批迁 vs 退役」的裁决，登记给票 04（ADR-0014 把它列为契约第四件）。 |


### 偏离与登记

1. **状态徽标与状态点拆成两张表**（`TASK_STATUS_BADGE_BG` 新增，`TASK_STATUS_COLOR` 保持点档）：同一个状态在**点**（图形档，≥3:1）与**徽标底**（其上压深墨文字，≥4.5:1）两个消费点上需要不同档位——一张表满足不了两条硬门槛。依据是 D7「徽标与横幅底改指 `-fill`」；实测五格徽标底 + 深墨 7.13–10.12:1（若沿用点档底色，五个徽标会掉到 2.23–3.35:1，**低于 AA**）。中性态（todo）取中性 chip 底 `--panel-2`（与 `.card-tag` 同一惯例）。两个测试文件里的映射副本同步改（字典序、逐条比对源码的机制不变）。
2. **`--error-fill` 的实际消费点是 1 处，不是 spec 说的「约 14 处」**：全仓「error 作实底 + 其上压文字」的只有 `ModelsConfig` 的两颗激活态禁用钮（同一处）。其余 error 站点分三类，按 D7 不动：① 点 / 描边（`.presence.error` / `.icon-btn .dot` / `.tt-log li.err::before` / `.btn-danger` 边框）——「点与描边同样达标（5.26:1）」；② 低透明度危险底纹（5–16%，其基底是 deep 档，换值后仍可见）；③ error 作文字（107 处，全部零改名、对比度从 4.21 提到 5.27）。
3. **低透明度 tint 不统一改写成 `-soft` 令牌**：矩阵的 `-soft` 是各族**淡底档的契约配比**（已用于 `.lv.*` / `.meter.*` 这些成建制的 class 块）；组件内联的 `color-mix(... var(--error) 7%, transparent)` 之类是「危险区底纹」，其基底是深档（换值后可见性不退化），改写成 20% 的 `--error-soft` 会把这些区域从「淡提示」变成「实提示」，是形态变化。唯一例外：`--accent` 的 12% 内联 tint（`SkillsConfig` / `PluginsConfig` / `ChatInput` / `MessageView` hunk）全部改指 `var(--accent-soft)`——因为 `--accent` 的 base 变成**亮档**，同样的 12% 只有 ΔL ≈ 1.5（spec 陷阱 2 说的那个坑），必须按契约配比。
4. **`ui_kits/app/app.css` 的镜像迁移**（越界确认，ask 两次 30 分钟超时未获答复 → 按推荐项执行）：`components/message-stream.test.mjs` 与 `components/task-board.test.mjs` 各有一条「逐字搬运」断言，把本仓 globals.css 的规则体与设计系统的应用层组件库 `ui_kits/app/app.css` **逐字**比对。票 03 只改本仓那一处就会让这两条红。收窄断言到「只比形态」等于**放宽断言语义**（票面明禁），所以走镜像：把同一套映射应用到原型的 44 处（含 7 处 `oklch(99%…)` 字面量与 `.overlay` / `.rail-scrim` 的旧 scrim），保住「两处规则体逐字相同」这条不变量。回退面 = 这一个文件。
5. **`app/layout.tsx` 的 `themeColor`**（越界确认后授权）：它是 `--bg` 的字面 sRGB 近似（注释自己写着），不改就是本次改动**引入**的可见回归（移动端浏览器 chrome 与奶油底不同色）。`#fbfcfd` → `#fcf8f0` + 注释同步；纯色值、零行为。
6. **`ui_kits/app/app.css` 的 `.msg-text pre` 深色代码块字面量不动**：矩阵没覆盖这套深色面，spec 的收口表也只点名三处字面量；就地改值属发明。登记给后续票（票 02 遗留项 2）。
7. **条状指示器改走图形档**（review 的 Spec 轴 P1；与 spec §4 一条「保持绿」冲突，`spec.md` 勘误 6 记载）：`.meter i` / `.meter.warn i` / 两处开关轨道 4 处 + `ui_kits` 镜像 + 2 条断言落点。
8. **零消费者 token 就地登记**（review 的 Standards 轴 P2）：5 处，两处块头各一行。
9. **`worksplice-app.html` 未随动、`ui_kits` 依赖产品层名**：见上「findings 的处置」表，两条都登记给票 04。
10. **`ModelsConfig.tsx:1116/1124/1133` 的既有静态检查发现不修**：见票 02 的遗留项 4（与 base 逐字相同、本票未碰；修它要改行为，越出零行为改动边界；coordinator 已裁示「登记不修」）。

### 门禁

- `npm test` **1290/1290 全绿**（rebase 到 `cd89136` 后的**全量**；选「宽」档的理由：本票改的是全局色板契约 + 约 100 处调用点，影响面无法提前圈定）。
- `npm run typecheck` 干净；`npm run lint` 0 error / 1 条既有 warning（`hooks/useI18n.tsx:61`）——两者与 base 逐字相同，**零新增**。
- `git status --porcelain` 为空（`.pi-lens.json` 在共用 git dir 的 `.git/info/exclude` 里，未出现）；分支已推；PR #124 已开。
- review 落地后复核：`npm test` **1290/1290**、`npm run typecheck` 干净、`npm run lint` 0 error / 1 条既有 warning（与 base 逐字相同）。
