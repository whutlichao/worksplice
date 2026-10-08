# 05 — 消息流与 composer

**What to build:** `components/ChannelView.tsx` 的频道面按原型形态重做：`.chan-head`（`--surface` 底 + 下边发丝）/ `.chan-top` / `.chan-title`（16px / 680 / `letter-spacing -.02em`，`#` 号是 accent mono）/ `.chan-desc` / `.chan-tools` / `.chan-divider` / `.pin-strip`（`--panel` callout + accent pin 图标）/ `.day-sep` / `.msg`（hover `--fg-soft` 填充）/ `.msg-head` / `.msg-author`（`.is-agent` → accent）/ `.msg-tag`（"Agent" 胶囊）/ `.msg-time`（mono 10.5px）/ `.msg-body` / `.msg-text` / `.msg-tools`（绝对定位，hover/focus 才出，`--shadow-pop`，`opacity` 过渡 0.12s）/ `.reactions` / `.reaction` / `.task-chip` / `.composer` / `.composer-box`（`--surface` + `--border-strong` + `--r-lg` + `--shadow-composer`，`:focus-within` → `0 0 0 3px var(--accent-soft)`）/ `.composer-bar` / `.composer-hint` / `.composer-send`（accent 方块）。锚点行高亮从「黄色实心」改为 `--accent-soft` 底 + 左侧 accent 条（与 D3 的 `--bg-selected` 处置同源）。

**Blocked by:** 03, 04

**Status:** resolved

- [x] 消息行 hover 走 `--fg-soft`；锚点行不再是黄色实心（渲染断言：hover 类不指向 `--yellow`）
- [x] **消息作者头像**（`ChannelView.tsx:910`）尺寸 40 → 26px（`size="md"` = `--avatar-md`）；行高随之重校（票 04 已迁到 `Avatar`，本票只收尺寸与行高）
- [x] 消息行与动作栏无 `2px solid`
- [x] composer 有 accent 焦点环 + `--shadow-composer`；常驻输入不吃 `--shadow-pop`
- [x] 时间戳与 `#seq` 用 `var(--mono)` + `tabular-nums`
- [x] 既有 8 个 `MessageRow` 用例（`components/ChannelView.test.mjs`）全绿——它们断的是无障碍名，视觉票不得改行为
- [x] `components/MobilePwaLayout.test.mjs` 的 `overflow-x-hidden overflow-y-auto` 断言按票 02 的处置保持或同步更新
- [x] `npm test` / `tsc --noEmit` 通过

## Answer

### 交付摘要

`app/globals.css` 追加频道面 class 块（`.chan-*` / `.pin-strip` / `.stream*` / `.day-sep` / `.msg*` /
`.reactions` / `.reaction` / `.task-chip` / `.composer*` / `.tabs`，逐字搬自
`worksplice-design-system/ui_kits/app/app.css`）；`components/ChannelView.tsx` 的**频道面**（频道头 /
pinned 区 / 消息行 / 动作栏 / reaction / composer / 切换条）从 inline style 改为消费这批 class，
消息作者头像 40 → 26px（`.avatar` = `--avatar-md`）、时间戳与 `#seq` 走 mono + `tabular-nums`、
锚点行 = `--accent-soft` 底 + 左侧 accent 条。`components/message-stream.test.mjs` 新增 13 例
（逐字搬运 + 票面判据 + 渲染面）。**零行为改动**：props 名 / i18n key / 事件处理 / 轮询节奏 /
freshness `baseSeq` 来源 / 权限面一字未动；`lib/**`（除 i18n 文案，本票未新增键）与 `app/api/**` 零改动。
任务板段（`TASK_STATUS_COLOR` → `TaskViews`，票 06 已合并）与 `EmptyState` 未动。

### 验收清单（逐条）

- [x] **消息行 hover 走 `--fg-soft`；锚点行不再是黄色实心**：`.msg:hover { background: var(--fg-soft) }`
      逐字规则体断言 + 悬停实测 `oklch(0.21 0.014 255 / 0.05)`；锚点 fill 仍是票 03 骨架钩子的
      `.ws-message-row-anchor { background: var(--accent-soft) }`（本票补的是左侧 accent 条，`::before`
      2px `--accent`，实测 `left: 0 / width: 2px`）；全仓 `--yellow` 由票 02 的 T-B 守（0 命中）。
- [x] **消息作者头像 26px**：`MessageRow` 传 `size="md"`，`.avatar` 规则体 `width: var(--avatar-md)`
      + markup 断言「不高 40 / 不带行内尺寸」；浏览器实测 26×26（`.avatar av-3`）。行高由上游 `.msg`
      （`gap: 11px; padding: 5px 8px`）与 `.msg-head`（`baseline` 对齐）重校。
- [x] **消息行与动作栏无 `2px solid`**：三段源码切片断言（无 `2px solid` / 无 `rgba(` / 无 `Npx Npx 0 0`）
      + 渲染 markup 断言；`app/globals.test.mjs` 的 T-C 全绿。
- [x] **composer 有 accent 焦点环 + `--shadow-composer`；常驻输入不吃 `--shadow-pop`**：
      `.composer-box` 规则体含 `--surface` / `1px solid var(--border-strong)` / `var(--r-lg)` /
      `var(--shadow-composer)` 且不含 `--shadow-pop`；`:focus-within` 规则体 `0 0 0 3px var(--accent-soft)`；
      浏览器聚焦实测 `box-shadow: …accent-soft 0 0 0 3px` + 边框转 `--accent`。
- [x] **时间戳与 `#seq` 用 `var(--mono)` + `tabular-nums`**：两者都带 `msg-time mono`（`.msg-time`
      规则体 mono + `--fs-mono-xs`；reset 的 `code, .mono` 组含 `tabular-nums`）；浏览器实测
      `ui-monospace…` / 10.5px / `tabular-nums`。
- [x] **既有 8 个 `MessageRow` 用例全绿**：`components/ChannelView.test.mjs` 38/38 pass（含 8 条
      `MessageRow` 无障碍名用例 + Composer/ChannelView 的行为与源码级断言），未改一字。
- [x] **`MobilePwaLayout.test.mjs` 保持**：`overflowX: "hidden", overflowY: "auto",` 与
      `paddingBottom: "env(safe-area-inset-bottom)"` 仍在 `<main>` 的行内样式上（该文件未改）。
- [x] **`npm test` / `tsc --noEmit`**：1201 pass / 0 fail（基线 1188 + 本票 13）；tsc exit 0；
      lint 0 error / 1 warning（基线同一条既有警告，见门禁表）。

### 红绿节奏（TDD，真实执行）

先落 `components/message-stream.test.mjs` 的 13 例断言（逐字搬运清单 + 票面判据 + 渲染面），在 base
`5506fc4` 上跑 **13 fail / 0 pass**，实现后 **13 pass / 0 fail**。

| 步 | 命令 | 结果 |
| --- | --- | --- |
| 红 | `node --test components/message-stream.test.mjs`（base `5506fc4` 的两个文件） | **13 fail / 0 pass** |
| 绿 ① | `app/globals.css` 追加频道面 class 块后重跑 | 4 pass / 9 fail（渲染面仍红） |
| 绿 ② | `ChannelView.tsx` 频道面换形后重跑 | **13 pass / 0 fail** |

红侧可复现命令（交付后仍可复跑；按父提交回退单文件是安全的）：

```sh
git checkout 5506fc4 -- app/globals.css components/ChannelView.tsx
node --test components/message-stream.test.mjs   # 13 fail / 0 pass
git checkout HEAD -- app/globals.css components/ChannelView.tsx
```

### 浏览器实测（真实 dev server + 隔离数据目录）

`WORKSPLICE_DATA_DIR=/tmp/ds05-smoke node scripts/seed-demo.mjs`（5 agent / 4 频道 / 40 消息 /
11 reaction / 2 pinned）+ `next dev -p 30177`（36142 被其它 worktree 占用）+ ego-browser 量 computed style：

| 面 | 实测 |
| --- | --- |
| `.msg` | `display:flex` / `gap:11px` / `padding:5px 8px` / `position:relative` / `border-radius:6px`；悬停底色 = `--fg-soft` |
| 消息作者头像 | **26×26**（`.avatar av-3`），行内无尺寸 |
| `.msg-time` / `.msg-time.mono` | `ui-monospace…` / **10.5px** / `font-variant-numeric: tabular-nums`（一条消息两处：seq + 时间） |
| `.msg-tools` | `position:absolute` / `top:-12px` / `right:8px` / `opacity:0` → 悬停 `1` / `box-shadow: --shadow-pop` / `transition: opacity 0.12s`；键 **26×24**；二级 reaction 条 5 个 `.reaction` chip（29×17、`--r-pill`）右对齐 |
| 锚点行（右栏线程面板） | `class="msg ws-message-row ws-message-row-anchor"`、bg = `--accent-soft`（alpha 0.11）、`::before` 2px `--accent` / `left:0` |
| `.chan-head` | `--surface` 底 + 1px 发丝，`padding: 13px 20px 12px`；`.chan-title` **16px / 680 / -0.32px**；`.hash` = `--accent` + mono |
| `.chan-tools` | 4 个 `.icon-btn`（30×30）+ `.badge` 计数 + `.chan-divider`（1×20） |
| `.tabs` / `.tab` | `--surface` + 发丝；首个 tab 左缘 **272px = 标题左缘**；`.is-active` 2px `--fg` 下划线 |
| `.pin-strip` | `--panel` 底 + 发丝 + `--r-md`；accent pin 图标；↑↓✕（22×22 `.icon-btn`） |
| `.composer-box` / `.composer-send` | `--r-lg` + `--border-strong` + `--shadow-composer`；聚焦 → `0 0 0 3px --accent-soft`；send 30×30（禁用态 `--panel-2`）；`.filter-chip`（As task） |
| 静音 / 成员面板 | 每个成员一行 `.filter-chip`（30px 高 / `--r-md` / 发丝） |
| 折叠面板 | 关闭态网格行 **0**（修掉 25px×2 的隐形死空间；tabs 上移 62px） |
| 溢出 | `documentElement.scrollWidth === innerWidth`；dock `scrollWidth === clientWidth`；720px 视口同样无横向溢出、抽屉形态正常 |

### 门禁（G-impl 第 0–5 条）

| 项 | 结果 |
| --- | --- |
| `git status --porcelain` | 交付前为空（`.pi-lens.json` 已进本地 `.git/info/exclude`，不进仓库） |
| `npm test`（**全量**） | **1201 pass / 0 fail**（基线 1188；新增 13） |
| `node_modules/.bin/tsc --noEmit` | exit 0 |
| `npm run lint`（增量对照） | 本票 0 error / 1 warning；基线 = `git checkout 5506fc4 -- app/globals.css components/ChannelView.tsx` 后重跑 → **逐字同一条** `hooks/useI18n.tsx:61` → **零新增** |
| `git diff --numstat` | `app/globals.css` **+118/−0**（追加段）、`components/ChannelView.tsx` **+599/−809**（净减 210）、`components/message-stream.test.mjs` +425（新增）——无整文件重写 |
| `@keyframes` / `prefers-reduced-motion` | 13 组（不减）；reduce 段两处保留 |
| emoji | 未新增（`＋` 文本字形换 lucide `SmilePlus`；`QUICK_REACTIONS` / `EMOJI_PICKER_OPTIONS` 是反应数据，未动） |

### 偏离（逐条、带理由）

- **D1 `.day-sep` / `.task-chip` / `.composer-hint` / `.msg-tag` = 只作词汇表、无渲染点**
  （coordinator 开工前裁决）。依据：**判据是「本仓有没有现成实体」，不是「票面有没有列」**——
  本仓消息流没有按日分组的实体、没有消息下挂任务的 chip、Enter 提示由 composer 的 placeholder 承担、
  Agent 胶囊需要新增文案与作者类型分支，四条都属**新增显示面**（票 07 的右栏同样情形由产品所有者裁决
  「只换皮、不扩面」）。与票 06 的 `.drop-hint` P1 **不同类**：那条是「本仓已有空列实体，只缺提示」。
  已写进 `globals.css` 段头注释与 `message-stream.test.mjs` 头注；四个 class 的逐字搬运由测试的
  「逐字搬运清单」覆盖（是**存在性**断言，不是渲染断言）。
- **D2 `.msg:hover` 取 `--fg-soft`**：上游是 `color-mix(in oklch, var(--fg) 3.5%, transparent)`；
  票面明写 `--fg-soft`（= 5%），且与票 03 的 `.ws-message-row:hover` 同源。这是本块与上游 app.css 的
  **唯一**逐字差异（测试把 `.msg:hover` 单独排除在逐字比对之外，另以规则体断言钉住 `--fg-soft`）。
- **D3 频道头工具条的内容控件连带换形**（票面只点名容器）：pin / mute / members / reminder 从
  「文本计数按钮 + 硬阴影」改 `.icon-btn`（+ `.is-on` + `.badge` 计数，沿用票 03 `.rail-foot` 的先例）；
  join / leave / archive 改 `.btn-sm` / `.btn-primary`（**保留文本标签**：生命周期动作不适合纯图标）；
  类型 / 归档徽标改 `.badge soft`（原本文件私有 `Badge` 组件退役——它只服务这两处）。
- **D4 `.tabs` / `.tab` 落位**：票面 Change 未点名，coordinator 裁决 ⑤「必须做」——本仓已有
  Messages|Tasks 实体，原形态带 `2px 2px 0 0 rgba(20,17,17,.45)` 硬偏移阴影，属旧方向残留。
  两处调用点 inline 偏离：`marginTop: 0`（上游把 `.tabs` 放在 `.chan-head` 内，本仓是它的兄弟——
  逐字块的 `margin-top: 11px` 会在发丝下留一条 `--bg` 缝）、`paddingInline: var(--sp-9)`
  （与 `.chan-head` 的 20px 对齐；上游块是 16px，因为它叠在 head 的 20px 内）。
- **D5 动作栏的揭示机制沿用票 03 的骨架钩子**：`ws-message-actions`（display 开关，未改票 03 段）
  与上游 `.msg-tools`（绝对定位 + opacity + `--shadow-pop`）叠加；本段补两条规则——
  `.msg:focus-within .ws-message-actions { display: flex }`（票 03 的 display 揭示让
  `:focus-within` 失效，补上键盘可达：Tab 进正文即可展开动作栏）与
  `.ws-message-actions-open .msg-tools { opacity: 1 }`（二级条展开时避免「看不见但可点」）。
- **D6 二级 reaction 条**（本仓独有，无上游对应）：形态取 `.reactions` / `.reaction`，放在揭示外壳内、
  `.msg-tools` 之外（否则被 `.msg-tools button` 的 26×24 压扁）；`＋` 文本字形换 lucide `SmilePlus`
  （AGENTS.md 的图标规则）；聚合条保留 `flexWrap`（上游不换行，24 种 reaction 会溢出）。
- **D7 `.ws-right .msg { margin-inline: 0; padding-inline: var(--sp-6) }`**：`.msg` 的 `margin: 0 -8px`
  以容器有 ≥8px 内边距为前提（`.stream` 是 20px）；右栏线程面板的滚动容器当前**无 class 也无内边距**
  （票 07 的 `.tt-scroll` 未落），负边距会溢出 dock → 出横向滚动条（实测 `scrollWidth 379 → 388`）。
  这条把负边距收在 dock 作用域内、padding 对齐 ThreadPanel 头部的 14px，**不碰 ThreadPanel**；
  票 07 落 `.tt-scroll` 的 16px padding 后可以撤掉。
- **D8 锚点竖条 `left: 0`**（不是 `.nav-row.is-active::before` 的 `-8px` 沟槽位）：同 D7，dock 的滚动
  容器没有内边距，负数位会被裁掉。
- **D9 composer 结构换形 + 三处调用点偏离**：`.composer-box` 包住 textarea 与 `.composer-bar`
  （附件 `.icon-btn` + As task `.filter-chip` + `.sep` + `.composer-send`）。① send 从文字按钮改
  **图标方块**（`aria-label` / `title` 仍取 `t("message.send")`，既有 `/Send/` 断言仍绿）；
  ② textarea 保留 `resize: vertical`（上游 `resize: none` 配自动长高，本仓没有自动长高，去掉等于
  收回一个既有用户能力）；③ 引文 / 附件 chip、@ 菜单、emoji picker、右键菜单的弹层统一
  `--shadow-pop` + `--r-md`（ED-4 / ED-3）。
- **D10 折叠面板关闭态真正塌到 0**：网格项自己的 padding（24px）+ 下边框（1px）**不可收缩**，`0fr`
  会停在 25px——票 13 起的遗留，`--bg` 底时不可见，本票把内层底改 `--surface`（ED-1 chrome）后
  会显形为两条白带。处置：padding / bottom-border 随 `open` 收起并同步过渡（同一 220ms / 缓动）；
  **同时修掉 50px 的隐形死空间**，横向 padding 对齐 `.chan-head` 的 `--sp-9`。
- **D11 `.chan-desc` 渲染 `<div>`**（上游原型同形）而不是 `<p>`：设计系统 reset **不归零 `p` 的 UA
  外边距**，`<p>` 会多出 ~13px 底边距（实测 header 90px → 改后 77px）。
- **D12 `EmptyState` 不动**：票面 Change 未点名，`.empty` 归票 09 的 SearchView。已知项：它的静止盒
  带 `--shadow-card`（ED-4 的严格读法不该有），留给票 09 / 收口处置。
- **D13 `.msg-head` 加 `flexWrap: wrap`**（上游不换行）：本仓头部还有线程 / 未回复角标，窄栏需兜底。
- **D14 `.stream` / `.stream-inner` 落位**（票面未点名）：spec §1f 把 `--stream-max` 列为「有当前需求
  但暂无消费者」的 token，本票给它第一个消费者；Tasks tab 不套 `.stream`（看板仍是满宽，票 06 的形态不动）。
- **D15 composer-box 子树整体 +2 缩进**：`.composer-inner`/`.composer-box` 多一层容器导致的**纯空白**
  diff（无语义变化），登记以免被当成噪声。

### 三条红线自查

- `git diff 5506fc4 HEAD --name-only`：`app/globals.css`、`components/ChannelView.tsx`、
  `components/message-stream.test.mjs`（+ 本票据）——**`app/api/**` 0 个**；`lib/**` **0 个**
  （本票未新增 i18n 键，D1 的四条 chip 都不渲染）。
- 票 03/04/06/08/10 所属文件：`AppShell` / `WorkspaceSidebar` / `DetailPanel` / `ThreadPanel` /
  `AgentDetailPanel` / `SearchView` / `StatusDot` / `Avatar` / 模态族 / `MobilePwaLayout.test.mjs` /
  `primitives.test.mjs` / `task-board.test.mjs` / `hooks/useIsMobile.ts` —— **0 命中**。
  `ChannelView.tsx` 的改动全部落在**频道面**：`git diff -U0 5506fc4 e66fe22` 的 130 个 hunk
  （base 行 16 → 3565）在任务板段（base 1068–1637 ≙ 新文件 1004–1573）**区间内 0 个**；
  该 570 行区段与 base 逐字节相同（`diff` 为空）。`EmptyState` 也未改（D12）。
- `worksplice-design-system/**` 逐字未改；`spec.md`、其他票文件零改动；`@keyframes` 13 组不减、
  `prefers-reduced-motion` 保留、未新增 emoji。

### 双轴 code-review（两份报告不合并）

（待补：两个独立 reviewer 并行，固定点 `5506fc4`，diff 落盘 `/tmp/ds05.diff`。）

### 持久化

- 分支：`whutlichao/ds-05-stream`
- 提交：`e66fe22`（主体）+ 本票据收敛 commit
- PR：**待回填**
