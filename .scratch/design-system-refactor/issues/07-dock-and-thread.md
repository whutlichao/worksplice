# 07 — 右栏：单槽容器 / 线程 / agent 详情

**What to build:** `components/DetailPanel.tsx` 单槽容器（`--surface` 底 + 左发丝；容器自身不吃圆角，`--r-lg` 只作用于内部区块）。`components/ThreadPanel.tsx`：`.tt-summary`（sticky）/ `.tt-status`（状态胶囊，色取 ED-10 映射）/ `.assignee`（胶囊 + 内嵌 `.avatar.sm`）/ `.tt-actions`（chip 行）/ `.tt-log`（时间线，`ok`/`warn`/`err`/`is-now` 四种点）/ `.tt-reply`（sticky composer，accent 焦点环）。`components/AgentDetailPanel.tsx`：`.dock-head` / `.dock-id` / `.avatar.lg` / `.dock-name` / `.dock-role`（`.presence` + 文字）/ `.icon-btn` 关闭 / `.dock-tabs` / `.dock-tab`（下划线 tab，mono 计数转 accent）/ `.dock-scroll` / `.d-sec` + `.d-sec-title`（mono 大写）/ `.kv`（点线引导的 key/value 行）/ `.meter` / `.stat-grid`（2×2，数字 mono 17px/700 `tabular-nums`）/ `.log-row` + `.lv`（级别标签）。

**Blocked by:** 03, 04

**Status:** resolved

- [x] `.tt-status` 与任务状态色一致；`.tt-log` 四种点色取四态 token
      → **按范围裁决 A 降级为规则体断言**（见下「降级登记」）：`.tt-log li.ok/.warn/.err/.is-now::before`
      逐条取 `--online` / `--working` / `--error` / `--accent`+`--accent-soft`（`components/dock.test.mjs`
      的「`.tt-log` 时间线的四种点色逐条取四态 token」）；`.tt-status .dot` 的色不在 CSS 里而在
      消费点的 inline 映射（与原型 JS 的 `STATUS_COLOR` 同形）——本票零消费者，故断言落在
      **那份 ED-10 映射本身**：`ChannelView.tsx` 的 `TASK_STATUS_COLOR` 五状态逐条比对 spec 表。
- [x] 统计数字用 `var(--mono)` + `font-variant-numeric: tabular-nums`
      → `.stat .n` / `.kv .v` / `.log-row .ts` / `.log-row .lv` / `.d-sec-title` / `.dock-tab .count`
      的规则体都带 `tabular-nums`（`components/dock.test.mjs` 两处规则体断言）；渲染面断言证明
      统计数字真的渲染在 `.stat .n` 里（`TokensCostStats` 的 4×`.stat`/`.n`/`.l` + 3×`.kv`，
      2000 / $0.42 / 41 / 2 与 1200 / 800 / 300 全部在位）。
- [x] `DetailPanel` 的按 kind 分派逻辑零改动（`components/DetailPanel.test.mjs` 全绿）
      → 分派 switch 逐字保留（只从组件体移到同文件的 `renderPanelSlot(props)`，为的是在外面套一层
      `.dock` 且**保住**「找不到成员就整体空渲染」语义——naive 包裹会让 `html === ""` 退化成
      `<div class="dock"></div>`，踩 `DetailPanel.test.mjs` 的空渲染断言）。该文件 10 条断言全绿。
- [x] 右栏无 `2px solid`；分隔发丝
      → 渲染面：三个 kind 的 markup 都 `doesNotMatch /2px solid/`；本票自有 markup 另断
      `doesNotMatch /\d+px \d+px 0 0/`（旧方向硬偏移阴影——ThreadPanel 复用 ChannelView 的
      MessageRow / Composer，那两处的硬阴影归票 05，本票不跨票改）；规则体侧 `.dock*` / `.tt-*` /
      `.kv` / `.meter` / `.stat*` / `.log-row` 全部只出现 `1px solid` / `1px dashed`（`.dock-tab` 的
      `2px solid transparent` 是上游的下划线槽，T-C 的既有断言同样放行 transparent）。
- [x] **两处 dock 头像**尺寸 44px（`size="lg"` = `--avatar-lg`，圆角 `--r-md`）
      → 渲染面：agent 详情 `class="avatar lg av-<n>"`，人类资料卡 `class="avatar lg av-4"`
      （`type === "human"` 恒 `av-4`）；规则体侧 `.avatar.lg` 断言 `width/height: var(--avatar-lg)` +
      `border-radius: var(--r-md)`。两处调用点未动（票 04 已迁 `Avatar`）。
- [x] `components/AgentDetailPanel.test.mjs` 全绿
      → 19 条全绿（含 `RoundLogsList` 的 D2 三态：真值不截断 / 无 `Invalid Date` / `/#1 · —/` 回落；
      含 `TaskHistoryList` 的重复 key 不变式——`.log-row` 与 `.stat` 化后 key 与树形都未变）。
- [x] `npm test` / `tsc --noEmit` 通过
      → `npm test`：**1211 pass / 0 fail**（基线 1188 + 本票新增 23，实测 13.9s）；
      `tsc --noEmit` 退出 0；`npm run lint` 与基线逐字一致（仅 `hooks/useI18n.tsx:61` 那条既有 warning）。

## Answer

### 交付物

| 文件 | 改动 |
| --- | --- |
| `app/globals.css` | +120 / −5：右栏 class 块 `.dock*` / `.d-sec*` / `.kv` / `.meter` / `.stat*` / `.log-row` / `.lv` / `.tt-*`（首批 +118 / −0 纯追加；并入 `origin/main` 后因 `.kv` 去重改为 +120 / −5，见下「合并冲突处置」） |
| `components/DetailPanel.tsx` | `.dock` 单槽容器 + 人类资料卡按 `.dock-head` / `.kv` 收形态 |
| `components/ThreadPanel.tsx` | `.tt-summary` / `.tt-scroll` / `.tt-reply` |
| `components/AgentDetailPanel.tsx` | `.dock-head` / `.dock-scroll` / `.d-sec`+`.d-sec-title` / `.kv` / `.meter` / `.stat-grid`+`.stat` / `.log-row`+`.lv`；新增 `TokensCostStats`（纯展示，测试 seam） |
| `components/dock.test.mjs` | 新增 23 条：14 条 class 块规则体 + 9 条渲染面 |

### 降级登记（哪些验收因**无实体**而降低档位、降到哪一层、为什么）

范围裁决来自 `orchestration ask` 的答复（选项 A）。原型里的任务线程 chrome 在本仓**没有对应 DOM**：
AgentDetailPanel 是一根滚动 + `.d-sec` 分组（无 tab），ThreadPanel 只渲染锚点 + 回复 + composer
（无任务状态胶囊 / owner 胶囊 / 转移 chip 行 / 状态变更时间线）。新增它们 = 新增显示面与交互
（`.tt-actions` 还要接 `/api/tasks/[id]/update-status` 写操作与状态机 UI），那是功能开发，
与「只改样式表达（inline style 值 / className / CSS）」的红线互斥，也不在本 spec 授权范围内。

| 票面要求 | 处置 | 验证档位 |
| --- | --- | --- |
| `.dock-tabs` / `.dock-tab`（下划线 tab，mono 计数转 accent） | 只落 class 块，零消费者 | 规则体断言（`.dock-tab` / `:hover` / `.is-active` / `.dock-tab .count`），并**反向断言** markup 里不出现这两个 class |
| `.tt-status`（状态胶囊，色取 ED-10 映射） | 只落 class 块，零消费者 | 规则体断言（发丝 + 药丸 + mono + hover 走 accent-soft）+ 「ED-10 五状态映射」逐条比对 `TASK_STATUS_COLOR` |
| `.assignee`（胶囊 + 内嵌 `.avatar.sm`） | 只落 class 块，零消费者 | 规则体断言（26px 药丸 + hover 走 `--border-strong` + `.unassigned` 斜体） |
| `.tt-actions`（chip 行） | 只落 class 块，零消费者 | 规则体断言（`.tt-actions` / `.tt-actions-row` / `.tt-label` mono 大写 / `.tt-chips` 直排换行） |
| `.tt-log`（时间线，四色点） | 只落 class 块，零消费者 | 规则体断言：四种点色**逐条**取四态 token（ok→`--online`、warn→`--working`、err→`--error`、is-now→`--accent` + `--accent-soft` 环） |

被消费的部分全部落在**产品真正渲染出的 markup** 上（`renderToStaticMarkup` + `jiti`，仓库既有 seam）：
`.dock` 三个 kind 的根、`.dock-head`/`.dock-id`/`.meta`/`.dock-name`/`.dock-role`(+`.presence`)=文字、
`.icon-btn` 关闭、`.dock-scroll`、`.d-sec`/`.d-sec-title`、`.kv`/`.k`/`.v`、`.stat-grid`/`.stat`/`.n`/`.l`、
`.log-row`/`.ts`/`.lv ok`/`.lv err`/`.msg`、`.tt-summary`/`.tt-title`/`.tt-scroll`/`.tt-reply`、两处 `.avatar.lg`。

### 红→绿证据（真实执行）

```text
# 红：git checkout HEAD~1 -- <新增前的四个源文件> （只留新测试），跑本票测试文件
$ node --test components/dock.test.mjs
ℹ tests 23 / ℹ pass 2 / ℹ fail 21        ← 21 条红（CSS 块不存在 + markup 还是旧形态）

# 绿：git checkout HEAD -- <四个源文件> 恢复后原样重跑
$ node --test components/dock.test.mjs
ℹ tests 23 / ℹ pass 23 / ℹ fail 0
$ npm test
ℹ tests 1211 / ℹ pass 1211 / ℹ fail 0     (real 13.9s)
$ node_modules/.bin/tsc --noEmit           → 退出 0
$ npm run lint                             → 0 error / 1 warning（与基线同一条，非本票文件）
$ git diff --numstat                       → globals.css 118/0（首版纯追加），三组件 239/404、66/113、35/37（无整文件重写）
```

### 偏离与判断（逐条）

1. **`.dock` 的左发丝不在这里声明**：宽度与 `border-left` 已在骨架钩子 `.ws-right`（票 03，
   `AppShell.test.mjs` 断的就是它）。两处都写会叠成 2px 双线（ED-2 判「分隔一律发丝」）。`.dock`
   只取「`--surface` 底 + flex 列 + `min-height:0`」。
2. **`.tt-scroll` 的内边距被 ThreadPanel 用 inline `padding: 0` 抹掉**：它的 16px 是给 `.tt-log`
   条目的；面板内装的是 `.ws-message-row`（自带 `10px 16px`），再叠一层会双重缩进。
3. **`.tt-reply .composer-box:focus-within` 显式重声明 accent 环**：与文件顶部 reset 的
   `.composer-box:focus-within` 同特异度、靠顺序决胜，不重声明会被上游的 `box-shadow: none` 盖掉。
   该选择器的消费点（`.composer-box`）归票 05——本票落地即生效的是 reset 里的
   `textarea:focus-visible`，两条路都给到 accent 环。
4. **`.lv.ok` / `.lv.warn` 的前景色不取上游 `oklch()` 字面量**，改本仓扩展层的 `--online-text` /
   `--working-text`（票 10 按「状态色作文字时的浅底高对比派生」落盘）——同一件事只留一处定义（ED-10）。
5. **字号取 `--fs-*` 标尺**（ED-5）：上游 11.5 / 12 / 14.5 / 17px → `--fs-caption` / `--fs-sm` /
   `--fs-title` / `--fs-stat`，`.log-row .lv` 的 10px → `--fs-mono-micro`（9.5px，与 `.card-tag` 同档）。
   上游逐字保留的像素值只剩间距（`13px` / `9px` / `5px 0` / `11px` / `26px` 等），与票 03/06 同档。
6. **`agent.observability` 这层父标签退场**：四个卡片各成为一个 `.d-sec` 并带自己的 `.d-sec-title`
   （Tokens / cost、Task history、Rounds、Session export）——再留一层父标签会把同一批内容双重命名。
   i18n key 未删未改（两份语言包逐字未动），只是不再被本组件消费；四条子标题的文案全部保留
   （`AgentDetailPanel.test.mjs` 断的就是它们）。
7. **`.badge.soft` 承担角色标**：原型用 `.msg-tag`，但它属票 05 的 class 块（未合并）；本仓可用
   的原语是票 04 的 `.badge`（`.badge.soft` = `--fg-soft` 底 + `--muted` 字）。
8. **`.log-row` 的时间戳位置**：`:30%` 的 targetId + 级别标签 + reason + `#seq · 时间`。
   `#<seq> · <time>` 这个字符串逐字保留（`AgentDetailPanel.test.mjs` 断的就是它，含非法日期回落 `—`）。
9. **`compactionCount` 从 `String(...)` 改为 `formatNumber(...)`**：它进了 `.stat` 数字格，与另外三格
   同口径（千分位）。
10. **`RoundLogsList` 的失败行底色 `#ffe9e9` / `#ff6b6b` 退场**（ED-10 禁 hex 字面量）：语义色改由
    `.lv.err` 承担。
11. **`TaskHistoryList` 只做 token 归一**（`--r-sm` 圆角 / `--fs-*` 字号 / `tabular-nums` / 去掉
    `var(--font-mono)` 别名），不引入新结构——它不在票面的 class 清单里，`.log-row`+`.lv` 的消费点
    是轮次记录（同样是「纯展示、数据由调用方传入」的既有测试 seam）。

### 双轴 code-review

固定点 `origin/main`（diff 只含本票 5 个文件）；spec 来源 = 本票 + `.scratch/design-system-refactor/spec.md`
（D1–D10 / ED-1…ED-10）+ `docs/adr/0014`。两轴**分别**报告，不合并。

#### Standards（仓库标准 + 气味基线）

- **硬违规：0**。逐条核对：UI 图标规则（只用 lucide `X` / `MessageSquare`，无新 emoji）；
  ED-2 发丝（无有色 `2px solid`，T-C 的多文件断言仍绿）；ED-3 圆角取 `--r-*`；ED-4 静止内容无阴影
  （`--shadow-card` 的 `Card` 外壳整体退场）；ED-5 字号走 `--fs-*`；ED-6 标识符 / 计数 / kv 行进 mono + `tabular-nums`；
  ED-7 hover 不降对比（`.dock-tab:hover` / `.assignee:hover` 都往 `--fg` 走）；ED-8 焦点环（`.icon-btn` / `.btn` 复用既有环）；
  ED-10 无新增色值、无 hex/rgb 字面量。
- **判断项 1（Middle Man，保留）**：`SectionTitle` 是 `<div className="d-sec-title">` 的一行包装。
  它是**既有形状**（原 `SectionLabel` 同角色，只是形态从 inline style 换到 class），保留它让 9 处
  调用点保持一行的信噪比；内联会让那 9 处各带一段 class 名。
- **判断项 2（组件当函数调用，保留）**：`renderPanelSlot(props)` 是直接调用而非 `<... />` 元素。
  动机与代价已写进代码注释与「降级登记」段：元素形态会让空渲染语义退化，进而踩既有护栏。
- **判断项 3（Duplicated Code，保留）**：`.d-sec` 的骨架（title + 内容）在面板里出现 7 次。
  这是**结构重复**不是逻辑重复（每节的标题 key、数据来源、加载分支都不同），抽成一个通用
  Section 组件会把 7 种分支塞进一组 props，depth 反而变浅。
- **判断项 4（`.log-row .lv` 的 4px 圆角）**：上游逐字值（与票 06 的 `.card-tag` 同档）；
  组件侧的 chip 圆角已统一走 `var(--r-sm)`。

#### Spec

- **缺失/只做了一半：0**（`.dock-tabs` / `.dock-tab` / `.tt-status` / `.assignee` / `.tt-actions` / `.tt-log`
  的「零消费者」是范围裁决 A 的**明确授权**，不是遗漏；降级档位与理由见上表）。
- **范围蔓延：0**。没有新增 fetch / 状态 / props / i18n key / 事件处理；`lib/**`（除零改动的 i18n 包）
  与 `app/api/**` 零改动；`worksplice-design-system/**` 逐字未动；未碰票 03/04/06/08/10 的 class 段。
- **实现可疑处 1（已处置）**：`agent.observability` 这层标签的退场属**显示面收缩**——它不是
  「多了什么」，而是把一组卡片的父标签去掉、让四个子标题直接成为分节标题。已在偏离登记第 6 条留痕；
  若复核认为必须保留，回滚点很小（在 tokens/cost 之上插回一行 `.d-sec-title`）。
- **实现可疑处 2（已处置）**：`.meter` 是**同一份数据换形态**（`contextUsage.percent` 早就在 `.kv` 行里
  以百分比文字出现），不是新显示面；百分比为 100+ 时靠 `.meter{overflow:hidden}` 兜住，不做 clamp（不发明逻辑）。

### 合并冲突处置（推 PR 后发现 `origin/main` 进了票 08）

PR 建好后 `origin/main` 合入了票 08（#115），而**两票都往 `app/globals.css` 末尾追加 class 块**
⇒ PR 变 `CONFLICTING`（冲突只有 `app/globals.css` 一处，append vs append）。按
`resolving-merge-conflicts` 的纪律**按意图解**（不 `--abort`、不 invent）：

1. `git merge origin/main`，两段 class 块**全部保留**（票 08 的模态族段 § 票 07 的右栏段）。
2. **`.kv` 去重**：上游 app.css 里 `.kv` / `.k` / `.v` **只有一处定义**（就在 right dock 段），
   两票各自搬了一份；票 08 自己的块首注释也写明「两票合并后保留其一即可」⇒ 归票 07 的右栏段
   （它的上游原位），票 08 段留一行指针，差值就是那 **−5 行**（4 条规则 + 1 行子块注释）。
   **语义零变化**：存活的那份除 `font-variant-numeric: tabular-nums`（ED-6 要求）与
   `11.5px → var(--fs-caption)`（同值）外逐字相同；票 08 的三个消费方（MyRemindersModal /
   提醒列表 / 成员面）拿到的仍是同一份规则。这一处**是合并被动产生的**，不是本票主动改票 08 的段：
   它只删重复定义，不删任何一条票 08 特有的规则（`.overlay` / `.modal*` / `.member-pick` /
   `.member-opt` / `.radio-*` / `.directory-picker-*` 逐字未动）。
3. 合并后重跑门禁：`npm test` **1244 pass / 0 fail**（基线 1188 + 本票 23 + 票 08 的 33）、
   `tsc --noEmit` 退出 0、`npm run lint` 仍只剩那条既有 warning。
4. squash 合入 main：commit `e3b6af2`（PR #116），之后 `git diff origin/main whutlichao/ds-07-dock` 为空。

### 红线自查

```text
$ git diff --name-only origin/main...HEAD
app/globals.css
components/AgentDetailPanel.tsx
components/DetailPanel.tsx
components/ThreadPanel.tsx
components/dock.test.mjs

$ git diff --name-only origin/main...HEAD | grep -E "^(lib/|app/api/)"   → 空
```

5 个文件全部在本票 Target/Ownership 内：无 `lib/**`（除 `lib/i18n`，且本票连它也没改）、
无 `app/api/**`、无票 03/04/06/08/10 所属文件、无 `worksplice-design-system/**`。

### 交付物持久化

- 分支：`whutlichao/ds-07-dock`；commit：`feat(design-system): 右栏单槽/线程/agent 详情按原型收形态（票 07）`。
- PR：**#116**（https://github.com/whutlichao/worksplice/pull/116）。
