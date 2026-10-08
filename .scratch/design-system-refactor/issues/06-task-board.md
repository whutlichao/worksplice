# 06 — 任务板两视图

**What to build:** `components/ChannelView.tsx` 的任务板段按原型形态重做：`.board-wrap` / `.board-toolbar` / `.seg`（看板 / 列表分段控件）/ `.filter-chip` / `.board` / `.board-cols`（列定宽 236px = `--board-col-w`，横向滚动，不拉伸）/ `.col`（`--panel`）/ `.col-head` / `.col-body` / `.card`（`--surface` + `--border` + `--r-md`；hover 强化边框 + `--shadow-card`）/ `.card-num`（mono）/ `.card-title` / `.card-meta` / `.card-owner`（内嵌 `.avatar.sm`）/ `.card-tag` / `.drop-hint`（虚线空槽）/ 拖拽态 `.drag-over`（accent）/ `.invalid-over`（`--error`）/ 拖拽中 `opacity:.4`。**不做乐观移动**（ADR-0002）——视觉只表达「合法/非法落点」，不动服务端裁决。状态色按 ED-10：`todo→--faint` / `in_progress→--accent` / `in_review→--working` / `done→--online` / `closed→--offline`。

**Blocked by:** 04

**Status:** resolved

- [x] 列宽来自 `var(--board-col-w)`；列不拉伸
- [x] **任务卡片 owner 头像**（`ChannelView.tsx:1288`）尺寸 28 → 22px（`size="sm"`）；**未认领**任务渲染 `t("tasks.unassigned")` 文案、**不**渲染头像（票 04 已迁到 `Avatar`，本票只收尺寸与未认领分支）
- [x] 卡片 hover 用 `--shadow-card`；静止卡片无阴影
- [x] 拖拽落点可达性视觉（accent / `--error`）仍在；`reachable` 渲染断言仍绿（`components/AgentDetailPanel.test.mjs` 或 `ChannelView.test.mjs` 的既有 seam）
- [x] 五种状态色全部来自四态 token + `--faint`/`--accent`，无马卡龙色
- [x] 列表视图分组顺序与状态徽标形态不变（行为零改动）
- [x] `npm test` / `tsc --noEmit` 通过

## Answer

### 交付摘要

票 06 落地：`app/globals.css` 追加任务板 class 块（`.board-wrap` / `.board-toolbar` / `.seg` /
`.filter-chip` / `.board` / `.board-cols` / `.col*` / `.card-title|meta|num|tag|owner` / `.drop-hint` /
`.col.drag-over` / `.col.invalid-over` / `.card.dragging`，逐字搬自
`worksplice-design-system/ui_kits/app/app.css` 的 task board 段）；`components/ChannelView.tsx` 的任务板段
（`TASK_STATUS_COLOR` → `TaskViews`，第 1068–1632 行）从 inline style 改为消费这批 class。零行为改动：
拖拽 DnD 事件、`reachable` 落点判定、状态转移请求、轮询、`baseSeq` 来源、既有 props 名一字未动；
i18n 新增一条键（`.drop-hint` 文案，见 D6）。

### 验收清单（逐条）

- [x] **列宽来自 `var(--board-col-w)`；列不拉伸**——`app/globals.css` 的 `.col { width: var(--board-col-w);
      flex: 0 0 var(--board-col-w); }` + `.board-cols { align-items: flex-start; min-width: min-content; }`
      （断言：`components/task-board.test.mjs` 的规则体断言 + 「markup 里不许再出现旧内联盒模型」的渲染断言）；
      真实浏览器实测 5 列各 236px、`flex: 0 0 236px`、板面 `clientWidth === scrollWidth`。
- [x] **任务卡片 owner 头像 22px / 未认领不出头像**——`<Avatar size="sm" />` → `.avatar.sm` →`--avatar-sm: 22px`，
      markup 不带内联尺寸；未认领分支渲染 `.card-owner.unassigned` + `t("tasks.unassigned")`、头像挂
      `task.owner` 真值分支（`components/Avatar.test.mjs` 的两条源码级断言仍绿）。浏览器实测 22×22px、
      7px 圆角，未认领卡文案「未认领」且无头像节点。
- [x] **卡片 hover `--shadow-card`、静止无阴影**——`.card` / `.card:hover` 是票 04 落位（本票不重抄）；本票把卡片上的
      内联硬偏移阴影（`2px 2px 0 0 rgba(20,17,17,.35)`）整体删掉，任务板段源码断言「无 `boxShadow` / 无 `rgba(`」。
      浏览器实测：静止 `box-shadow: none`，hover → `0 2px 8px -4px …/0.18`（= `--shadow-card`）+ 边框强化。
- [x] **拖拽落点可达性视觉仍在 / `reachable` 断言仍绿**——`.col.drag-over`（`--accent` 边 + `--accent-soft` 底）、
      `.col.invalid-over`（只有 `--error` 边，不填充）、`.card.dragging`（`opacity:.4`）三条规则体断言 +
      `ChannelView.test.mjs` 既有的 `reachable.includes(status)` 源码级断言仍绿（新文件里也锁一次）。
      浏览器实测（合成 DragEvent）：todo 卡（`reachable=["in_progress"]`）拖到「进行中」= `col drag-over`
      （accent 边 + accent-soft 底），拖到「待审/完成/已关闭」= `col invalid-over`（--error 边）；
      拖动中卡片 `class="card dragging"` / `opacity: 0.4` / `cursor: grabbing`，`dragend` 后类名回退。
      不做乐观移动的语义未动（松手仍走 `onAction` → 服务端裁决）。
- [x] **五种状态色全部来自四态 token + `--faint`/`--accent`，无马卡龙色**——ED-10 的映射收敛成模块内唯一一张表
      `TASK_STATUS_COLOR`（与原型 `worksplice-app.html:806` 的 `STATUS_COLOR` 逐字相同），看板列头状态点与
      List 分组徽标共用。渲染断言：五个列头状态点的 `style="background:var(…)"` 一一对应；浏览器实测五点 computed
      color 与 `--faint` / `--accent` / `--working` / `--online` / `--offline` 一一对应；任务板段无 hex/rgb、无旧色板 token。
- [x] **列表视图分组顺序与状态徽标形态不变**——`TaskList` 的分组头（徽标 + 计数 + 发丝引导线）与分组顺序一字未改，
      只把徽标背景的来源从函数内映射改成共享常量（同值，见 D11）；卡片仍用同一 `TaskCard`（列表不可拖 ⇒ 光标 pointer，见 D8）。
      浏览器实测列表视图分组/徽标/计数仍在、`.board-wrap` 内容高度（不撑满，由 main 滚）。
- [x] **`npm test` / `tsc --noEmit` 通过**——全量 1175 pass / 0 fail（基线 1161 + 新增 14）；tsc exit 0；lint 见下表。

### 红绿节奏（TDD，真实执行）

| 步 | 命令 | 结果 |
| --- | --- | --- |
| 红 ① | `node --test components/task-board.test.mjs`（CSS 规则体 + 渲染断言 13 例先写） | **13 红 / 0 绿** |
| 绿 ① | `app/globals.css` 逐字搬入任务板 class 块后重跑 | 6 绿 / 7 红（渲染面仍红） |
| 绿 ② | `ChannelView.tsx` 任务板段换成 class 结构后重跑 | 11 绿 / 2 红（两条断言过宽，收窄断言） |
| 绿 ③ | 断言收窄（重开标记改断「只有 class + title、无内联底色」；rgba 断言改按任务板段切片） | **13 绿** |
| 红 ② | 双轴 review 后补 `.drop-hint` 渲染断言（第 14 例） | **1 红**（`class="drop-hint"` 计数 0） |
| 绿 ④ | 渲染 `.drop-hint` + 新增 `tasks.dropHint` 两套包文案后重跑 | **14 绿** |
| 绿 ⑤ | 修 review F3（切片锚点改稳定符号名）后重跑 | 14 绿 |

### 门禁

| 门禁 | 结果 |
| --- | --- |
| `npm test`（全量） | 1175 pass / 0 fail（基线 1161） |
| `node_modules/.bin/tsc --noEmit` | exit 0 |
| `npm run lint`（增量对照） | 0 error / 1 warning；基线（`git checkout HEAD~1 -- components/ChannelView.tsx app/globals.css` 后重跑）逐字相同的同一条 `hooks/useI18n.tsx:61` 既有警告 → **零新增** |
| `git status --porcelain` | 交付前为空（`.pi-lens.json` 已进本地 `.git/info/exclude`，不进仓库） |
| `git diff --numstat` | `app/globals.css` +48/−0（追加段）、`components/ChannelView.tsx` +99/−244、`components/task-board.test.mjs` +470（新增）、`lib/i18n/messages/{en,zh-CN}.ts` 各 +1——**无整文件重写** |

### 浏览器实测（真实 dev server + 隔离数据目录）

`WORKSPLICE_DATA_DIR=/tmp/ds06-smoke node scripts/seed-demo.mjs` + `npm run dev`（ego-browser 驱动，
见验收清单逐条的实测数字）。实测覆盖：列宽 236 / 不拉伸、`.board` 独自滚动而 `.board-wrap` 撑满、
卡片的静止无阴影 vs hover `--shadow-card`、拖拽中 `opacity:.4`、合法/非法落点两条视觉、五状态点颜色、
22px 头像与未认领分支、空列 `.drop-hint`（3 个空列 3 个虚线槽）、列表视图分组不变。**未做**：真实鼠标落
`drop`（会改演示库数据）；拖拽的**裁决路径**零改动，本票只验证了 dragover 的视觉表达。

### 偏离（逐条、带理由）

- **D1 `.col-head .col-add` 逐字搬入但无渲染点**：原型在列头提供「按列新建任务」，本仓任务板没有这条创建途径，
  本票不得新增功能（零行为改动 + 不新增 i18n key 之外的 UI）。裁决来自 coordinator 的开工前代答：
  「CSS 块逐字搬入，本票不渲染，登记为逐字搬运优先于裁剪」。
- **D2 `.filter-chip` 逐字搬入但无渲染点**：本仓任务板没有筛选功能（新增筛选 = 新功能）；渲染点归票 09 的
  SearchView facet（spec 组件表第 16 行）。同一次裁决。
- **D3 `TaskCard` 新增 display-only 可选 prop `dragging?: boolean`**：`.card.dragging{opacity:.4}` 是票面明列的
  拖拽形态，而卡片当前拿不到「我正被拖」；`TaskBoard` 传 `dragId === task.id`。既有 props 名与行为一字未动，
  `dragging` 不参与落点裁决（coordinator 代答 Q2 授权）。
- **D4 「重开」标记从 `--working` 实底改中性 `.card-tag`**：ED-10 把 `--working` 限定给 `in_review` 这一个任务状态色，
  而 `reopened` 是独立于 status 的标记；信息不丢——`title` 提示与 i18n 文案保留（coordinator 代答 Q3，
  并已同步产品所有者知情）。
- **D5 为渲染断言 seam 导出 `TaskCard` / `TaskBoard`**：票面要求「渲染级断言必须落在产品渲染出的 markup 上」，
  而看板视图在静态渲染里不可达（`localStorage` 偏好只在 `useEffect` 里应用，服务端首帧恒为 list）。导出与既有
  `MessageRow` / `Composer` / `TaskViews` 同性质（coordinator 代答 Q4 授权导出 `TaskBoard`，`TaskCard` 同理由延伸）。
- **D6 空列渲染 `.drop-hint` + 新增 i18n 键 `tasks.dropHint`**：Spec 轴把「只搬 CSS 不渲染」判为 P1（票面 Change 明列
  `.drop-hint`，原型在空列真渲染），并指出 spec §6 的红线是「i18n key 一字不**改**」且明许「`lib/**` 除 `lib/i18n`（文案）
  外零改动」。coordinator 复核后按 A 裁决：空列渲染 + 新增键（en「Drag a task here」/ zh-CN「拖拽任务到此」）+ 渲染断言。
- **D7 `.seg` 次序保持「列表 | 看板」**：原型是「看板 | 列表」且默认 board，但本仓 ADR-0002 明确默认**列表**，
  分段控件第一项 = 默认视图才自洽。coordinator 复核后按 A 裁决（「逐字对齐原型」的适用范围是形态，不含推翻本仓 ADR 的默认视图裁决）。
- **D8 列表视图的卡片内联 `cursor: pointer`**：`.card` 是 List/Board 共用的形态载体且自带 `cursor: grab`（上游逐字），
  而列表卡片不可拖（`draggable` 缺省 false）。改用一行内联光标纠正指针暗示，其余形态仍全走 class。
- **D9 列头状态点颜色内联**：与上游原型同形（`worksplice-app.html:1173` 即 `style="background:${STATUS_COLOR[col.id]}"`），
  不另造 `.col-head .st-dot.is-*` 一族新 class（D8「不做原型之外的新形态发明」）。
- **D10 新增独立测试文件 `components/task-board.test.mjs`**：票面 Target 写的是 `components/*.test.mjs`，
  Acceptance ④ 指的是「复用既有 **seam**」——即 `renderToStaticMarkup` + `jiti`（同 `primitives.test.mjs` 与票 04 的分工）；
  既有 `ChannelView.test.mjs` / `Avatar.test.mjs` 的相关断言全部保持绿，未改一字。
- **D11 `taskBadgeStyle` 的内联色表提成模块常量 `TASK_STATUS_COLOR`**：同一份 ED-10 映射要被「列头状态点」与
  「List 分组徽标」两处消费（Duplicated Code 的前置消除）；徽标形态与值不变。

### 三条红线自查

- `git diff c21602a HEAD --name-only` = `app/globals.css` / `components/ChannelView.tsx` /
  `components/task-board.test.mjs`（+ 本票据与 `lib/i18n/messages/{en,zh-CN}.ts`）——**`app/api/**` 0 个**；
  `lib/**` 只有 `lib/i18n/messages/{en,zh-CN}.ts`（spec 明许的唯一例外，D6）。
- `ChannelView.tsx` 的改动**全部落在任务板段**：`git diff -U0` 的 hunk 头覆盖第 1066–1632 行
  （`TASK_STATUS_COLOR` → `TaskViews`），消息流 / composer / pinned 区 / reaction / 提醒入口零改动；
  `TaskList` 的分组头仅随 D11 变动一行。
- `worksplice-design-system/**` 逐字未改（不在 diff 名单）；`hooks/useIsMobile.ts`、`spec.md`、其他票文件零改动；
  `@keyframes` 13 组（不减）、`prefers-reduced-motion` 两处保留、无新增 emoji。

### 双轴 code-review（两份报告不合并）

固定点 `c21602a`（HEAD~1），diff 落盘 `/tmp/ds06.diff`（供无 shell 的 reviewer 对读），两个独立 reviewer 并行。

**Standards 轴**（独立 reviewer，措辞原样）

> **Correct（证据）**：逐字搬运可核（抽验 `.seg button.is-active` / `.col-head .col-add` / `.card-tag`；未重抄票 04 的
> `.card`/`.card:hover`）；改动全落在任务板段，未越界到消息流/composer；无新 emoji、无 hex/rgb 与马卡龙色；
> `tasks.unassigned` 两套包都有。**硬违规：无。**
>
> Finding（全为 P2 判断项）：
> 1. Speculative Generality（死 CSS）：`.filter-chip*` / `.col-head .col-add*` / `.drop-hint` 无渲染点。
> 2. Duplicated Code：测试里的 `escapeRe`+`blockBody` 与 `primitives.test.mjs` 同形。
> 3. 断言实现细节：测试以注释串切源码。
> 4. 缩进漂移：新测试 4 空格 vs 同目录部分文件 2 空格。
> 5. Data Clumps（弱）：`TaskCard` props 达 9，同一 5 项 clump 重复。
> 6. 形态来源分叉（弱）：状态点色走 inline `style`。
>
> **Merge verdict: OK with notes**（无阻塞项）。

**Spec 轴**（独立 reviewer，措辞原样）

> **Correct（已验证）**：class 块逐字搬自上游并由测试逐条比对；ED-10 与原型 `STATUS_COLOR` 逐字相同；
> 列宽走 `var(--board-col-w)` 且无内联 236px；`.card` 静止无阴影、仅 hover `--shadow-card`；未认领不渲染头像；
> 无乐观移动（落点仍由 `reachable.includes(status)` 裁决）；i18n key 无既有键被改。
>
> Finding（P1）：`.drop-hint` 只落了 class、无人渲染，票面要求只做一半。
> Finding（P2）：票 06 仍 `Status: pending`、验收未勾、Answer 空。
> Finding（P2）：`.seg` 次序与原型相反（原型看板在前且默认 board），建议票主确认是否有意。
> Finding（P2）：spec T-D 06 行点名复用既有 seam，实现改新建测试文件。
> 登记但不算问题：`.filter-chip` / `.col-add` 只落 class 无渲染点（分别归票 09 与 Out of Scope「不新增功能」，理由成立）；
> List 卡片改用 `.card` + 非拖拽 `cursor:pointer` 属样式表达；卡片头像 22px 与原型内联 18px 的差异由 spec D6 消费者表授权。
>
> **Merge verdict: OK with notes**（1×P1 建议随票收敛一并修）。

#### findings 处置（逐条）

| 轴 | finding | 处置 |
| --- | --- | --- |
| Spec | P1 `.drop-hint` 未渲染 | **已修**：空列渲染 + 新增 `tasks.dropHint` + 渲染断言（D6，红/绿证据见「红绿节奏」红②/绿④） |
| Spec | P2 票正本未收敛 | **已修**：本 Answer + `Status: resolved`；门禁数字见上表 |
| Spec | P2 `.seg` 次序与原型相反 | **豁免**（D7）：ADR-0002 默认列表 → 第一项 = 默认视图；coordinator 复核按 A |
| Spec | P2 新建测试文件而非并入既有文件 | **豁免**（D10）：复用同一条 seam（`renderToStaticMarkup` + `jiti`），既有断言全绿未改 |
| Standards | P2 死 CSS（三处无渲染点） | **部分已修 + 部分豁免**：`.drop-hint` 已渲染（D6）；`.col-add` / `.filter-chip` 豁免（D1/D2，coordinator 裁决「逐字搬运优先于裁剪」，渲染点归票 09） |
| Standards | P2 `escapeRe`+`blockBody` 与 `primitives.test.mjs` 重复 | **豁免**：本仓既有测试形态是「每个测试文件自带探针」（`globals.test.mjs` 的 `extractRootDecls`、`renderI18n` 已在 4 个文件重复）；抽公共模块要改票 04 的交付文件，越出本票 ownership |
| Standards | P2 断言切源码（注释串锚点） | **已修**：切片两端改稳定符号名（`const TASK_STATUS_COLOR` → `export function Composer`），并保留切片只为「无 rgba/boxShadow/236px」这三条渲染面之外的红线自查 |
| Standards | P2 缩进 4 空格 vs 2 空格 | **豁免**：`docs/engineering-standards.md` §1 明写「无强制的缩进宽度（沿用 next 脚手架 2 空格）」，且同目录 `ChannelView.test.mjs` / `AgentDetailPanel.test.mjs` 同为 4 空格 |
| Standards | P2/P3 Data Clumps（props 打包） | **豁免**：会改 props 形态（票面「props 名一字不动」+「只改样式表达与 class 结构」），属独立重构票 |
| Standards | P3 状态点颜色内联 | **豁免**（D9）：上游原型即内联形态，不发明新 class 族 |

跨轴不做单一排序：Standards 轴 6 findings（0 硬违规；2 已修、4 豁免），Spec 轴 4 findings（1×P1 已修、1 已收敛、2 豁免）。

### 残留与后续

- **上游 `@media (max-width: 900px)` 里的 `.board-cols{flex-direction:column}` / `.col{width:100%;flex-basis:auto;max-height:none}`
  （看板在窄屏堆成单列）未落**：该断点块归票 03（shell skeleton，本分支未含），本票落的是桌面形态。
  建议票 03 或收口时补上。
- 空列的 `.drop-hint` 现为静态提示；`filterMine` 式的「有筛选时不出提示」在上游存在但我仓无筛选，未实现。
- 真实鼠标 `drop`（服务端状态转移的端到端）未在浏览器里点过：裁决路径零改动，本票只验证了 dragover 视觉与
  `reachable` 的判定仍在视图侧。

### 持久化

- 分支：`whutlichao/ds-06-board`
- 提交：`eb1d2a9`（主体）+ `8699333`（review 收口：空列空槽 + 断言锚点）+ 本票据收敛 commit（`Status: resolved` + 本 Answer）
- PR：**#113**（OPEN，base `main`）
