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
review 收口另修四处：锚点行 hover 回归（`.msg:hover` 吃掉票 03 的锚点 hover）、composer 根补回
`flexShrink: 0`、注释与规格表述对齐、头部角标/22px 尺寸去重（`IconCount` + `SMALL_ICON_BTN_STYLE`）。

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
| 红 ③ | review 收口：锚点 hover 断言（`.msg.ws-message-row-anchor:hover`）先落，在未补规则的实现上跑 | **1 fail（12/13）** |
| 绿 ③ | 补 `.msg.ws-message-row-anchor:hover { background: var(--accent-soft) }` 后重跑 | **13 pass / 0 fail** |

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
| `.composer-box` / `.composer-send` | `--r-lg` + `--border-strong` + `--shadow-composer`；聚焦 → `0 0 0 3px --accent-soft`；send 30×30（禁用态 `--panel-2`）；`.member-opt`（As task，见 Rebase 节） |
| 静音 / 成员面板 | 每个成员一行 `.member-opt`（胶囊 / 发丝 / `.is-on` 转 accent，见 Rebase 节） |
| 折叠面板 | 关闭态网格行 **0**（修掉 25px×2 的隐形死空间；tabs 上移 62px） |
| 溢出 | `documentElement.scrollWidth === innerWidth`；dock `scrollWidth === clientWidth`；720px 视口同样无横向溢出、抽屉形态正常 |

### 门禁（G-impl 第 0–5 条）

| 项 | 结果 |
| --- | --- |
| `git status --porcelain` | 交付前为空（`.pi-lens.json` 已进本地 `.git/info/exclude`，不进仓库） |
| `npm test`（**全量**） | **1201 pass / 0 fail**（基线 1188；新增 13，其中一条断言在 review 收口时加严） |
| `node_modules/.bin/tsc --noEmit` | exit 0 |
| `npm run lint`（增量对照） | 本票 0 error / 1 warning；基线 = `git checkout 5506fc4 -- app/globals.css components/ChannelView.tsx` 后重跑 → **逐字同一条** `hooks/useI18n.tsx:61` → **零新增** |
| `git diff --numstat` | `app/globals.css` **+118/−0**（追加段）、`components/ChannelView.tsx` **+599/−809**（净减 210）、`components/message-stream.test.mjs` +425（新增）——无整文件重写 |
| `@keyframes` / `prefers-reduced-motion` | 13 组（不减）；reduce 段两处保留 |
| emoji | 未新增（`＋` 文本字形换 lucide `SmilePlus`；`QUICK_REACTIONS` / `EMOJI_PICKER_OPTIONS` 是反应数据，未动） |

### 偏离（逐条、带理由）

- **D1 `.day-sep` / `.task-chip` / `.composer-hint` / `.msg-tag` = 只作词汇表、无渲染点**
  （coordinator 开工前裁决）。四条都属**新增可见实体**：本仓消息流没有按日分组的实体、没有消息下挂
  任务的 chip、Enter 提示由 composer 的 placeholder 承担、没有 Agent 胶囊这一可见元素（裁决的判据是
  「本仓有没有现成实体」，**不是「票面有没有列」**——spec 组件表第 3 行确实点名了 `.day-sep` 与
  `.msg-tag`，票 11 docs-sync 按实况描述即可；票 07 的右栏同样情形由产品所有者裁决「只换皮、不扩面」）。
  与票 06 的 `.drop-hint` P1 **不同类**：那条是「本仓已有空列实体，只缺提示」。已写进 `globals.css` 段头
  注释与 `message-stream.test.mjs` 头注；四个 class 的逐字搬运由测试的「逐字搬运清单」覆盖
  （是**存在性**断言，不是渲染断言）。
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
- **D9 composer 结构换形 + 四处调用点偏离**：`.composer-box` 包住 textarea 与 `.composer-bar`
  （附件 `.icon-btn` + As task `.member-opt` + `.sep` + `.composer-send`）。① send 从文字按钮改
  **图标方块**（`aria-label` / `title` 仍取 `t("message.send")`，既有 `/Send/` 断言仍绿）；
  ② textarea 保留 `resize: vertical`（上游 `resize: none` 配自动长高，本仓没有自动长高，去掉等于
  收回一个既有用户能力）；③ 根节点保留 `flex-shrink: 0`（上游无此声明；同屏 header/tabs 也都带，
  短视口下面板全开时不被压扁——review 收口时补回）；④ 引文 / 附件 chip、@ 菜单、emoji picker、
  右键菜单的弹层统一 `--shadow-pop` + `--r-md`（ED-4 / ED-3）。
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

固定点 `5506fc4`（父提交），代码 diff 落盘 `/tmp/ds05.diff`（2441 行），两个独立 reviewer（`reviewer`
子代理，只读）并行；两份报告原样如下。

#### Standards

> **硬违规：无。** 逐条对读 `docs/engineering-standards.md`、`AGENTS.md`（图标/i18n）、`docs/i18n.md`、spec D7 + ED-1…ED-10：
>
> - **图标（AGENTS.md 禁新增 emoji）**：diff 只移除 `＋`/`↑`/`↓`（`/tmp/ds05.diff:490/1875/1892`），新增全是 lucide（`Send`/`ChevronUp|Down`/`SmilePlus`）；`⚠` 仅出现在注释。合规。
> - **i18n（docs/i18n.md 分层规则）**：本票新增 `aria-label`/`title` 全走 `t(...)`；发送键由文案改图标仍保留无障碍名（`message-stream.test.mjs:352-353` 断言 `aria-label="Send"`），无硬编码用户文案。合规。
> - **ED-2/ED-4**：新增块无 2px ink、无 rgba；`--shadow-pop` 只落 `.msg-tools`/弹层，`.composer-box` 用 `--shadow-composer`（`globals.css:1302/1337`）。合规。
> - **ED-9**：`.msg-tools`/`.composer-box`/折叠壳的 transition 均被 `globals.css:99-105` 的 reduce 属性级 reset 覆盖。
> - **逐字搬运**：抽检 `.msg`/`.reaction`/`.composer-send`（`globals.css:1286/1310/1344` vs `app.css:171/197/211`）逐字一致；token 全在 `tokens.css`/`colors_and_type.css` 有定义，无悬空引用。
>
> **判断题（基线味道，非阻断）**
>
> - **P2 Duplicated Code**：频道头三个图标按钮（pinned/mute/members，`ChannelView.tsx` ≈2760-2830）逐块重复 `<span className="badge" style={{position:"absolute",top:-6,right:-6}}>` + `loading?"…":count`；`width:22,height:22,flex:"0 0 22px"` 在 4 个 `icon-btn` 上重复。最小改法：抽局部 `<IconBadge>` 组件或共享常量。
> - **P2 Duplicated Code**：`<main className="stream">`（`ChannelView.tsx:3264-3272`）同时内联 `flex/minHeight/overflowY`，与 `.stream` 规则重复声明。
> - **P2 文档准确性/规格冲突**：`message-stream.test.mjs:18` 称“票面没点名的**三个** class”却列了四个；且 spec D7 组件表**第 3 行确实点名** `.day-sep`/`.msg-tag`/`.task-chip`/`.composer-hint`。裁剪本身合法（`globals.css:1249` 已记 coordinator 裁决），但测试注释与 spec 表述冲突。最小改法：改注释措辞，并把该裁剪记入 Answer 供票 11 docs-sync 收敛。
> - **P2（边界）ED-5**：本仓独有角标仍内联 `fontSize: 10`（`ChannelView.tsx:890/917`），不在 `--fs-*` 标尺（10.5 = `--fs-mono-xs`）。属既有值、diff 未改数值，未“引入”，故不计硬违规。
>
> **Merge verdict: OK with notes.**

#### Spec

> **D1 裁定（独立判断）**：`.day-sep` / `.composer-hint` / `.task-chip` 的「只搬 class、无渲染点」站得住——本仓消息流无按日分组实体（`ChannelView.tsx:178-183` 的 `messageTime` 只在非当天把日期内联进行内）；composer 无提示元素（Enter 提示在 `chat.tabEnter` 的 @ 菜单里）；`.task-chip` 要让消息行显示任务号，须把 task number 新灌进 `MessageRow`（现仅有 `canConvertToTask` 布尔），属数据+显示扩面。**`.msg-tag` 的理由偏弱**：实体与分支本 diff 已具备（`ChannelView.tsx:845` `const isAgent = message.author?.type === "agent"`；`.msg-author.is-agent` 已渲染 accent），且「需要新增文案」不成立——spec §6 红线明写 `lib/i18n` 文案可改。不渲染可保留（「只换皮不扩面」），但该条理由应改写为「新增可见元素」，而非「需要新分支/文案」。
>
> **Finding（P2，做得不对）**：锚点行 hover 被新规则吃掉。`.msg:hover{background:var(--fg-soft)}`（`app/globals.css:1286`）与票 03 的 `.ws-message-row-anchor:hover{background:var(--accent-soft)}`（:961）同特异度、前者在后 ⇒ 锚点行 hover 由 accent-soft 变 fg-soft，「当前位置」色在 hover 时消失（:956 静止态仍在）。最小修法：补 `.msg.ws-message-row-anchor:hover{background:var(--accent-soft)}`。
>
> **Finding（P2，未登记的行为/布局改动）**：composer 根丢掉 `flexShrink: 0`——diff 删掉旧的 `style={{flexShrink:0,…}}` 改 `className="composer"`，上游 `.composer` 无此声明，D9 三处偏离未登记；同屏 header/tabs 仍各自保留行内 `flexShrink:0`。视口极短（面板全开/移动端键盘）时 composer 可被压缩并与内容重叠。最小修法：`<div className="composer" style={{ flexShrink: 0 }}>`（不能写进 class，否则破逐字断言）。
>
> **Finding（P2，文档）**：`message-stream.test.mjs:11` 头注称「票面没点名的三个 class」却列了四个，且票面 Change 明列这四个，「没点名」与事实相反。
>
> **Scope creep**：`.tabs`/`.stream(-inner)`/`.ws-right .msg`/`.pin-strip` 多行化/图标化工具条均已登记（D4/D7/D14/D3），未见未登记扩张。
>
> **Correct**：逐字搬运与 `ui_kits/app/app.css` 逐条相符，唯一差异 `.msg:hover` 正是票面明写的 `--fg-soft`（D2 成立）；`isAgent` 有数据支撑（`getMember` 返回带 `type` 的 `MemberRow`）；`MobilePwaLayout.test.mjs` 四条护栏完好；未发现行为改动（As task 仍 label 包 input、send 仍带 `title`/`aria-label`、`＋` 已换 lucide）。
>
> **Merge verdict: OK with notes**（仅 P2；未改任何文件）。测试未运行：请 supervisor 跑 `npm test`、`node_modules/.bin/tsc --noEmit`。

#### findings 逐条处置

| 轴 | finding | 处置 |
| --- | --- | --- |
| Spec | P2 锚点行 hover 被 `.msg:hover` 吃掉（同特异度、后者在后 ⇒ accent-soft 变 fg-soft） | **已修**：补 `.msg.ws-message-row-anchor:hover { background: var(--accent-soft) }`（更高特异性）。断言先红（12/13）后绿（13/13）；浏览器实测 hover 仍 `oklch(0.56 0.17 256 / 0.11)` |
| Spec | P2 composer 根丢掉 `flexShrink: 0`（上游 `.composer` 无此声明） | **已修**：`<div className="composer" style={{ flexShrink: 0 }}>`（不进 class，保逐字断言）；浏览器实测 `flex-shrink: 0` |
| Spec + Standards | P2 测试头注「三个 class」却列四个、「没点名」与事实相反 | **已修**：头注与 `globals.css` 段头改写（四个 class；`.day-sep`/`.msg-tag` 在 spec 组件表第 3 行被点名）；裁剪理由统一改为「新增可见实体」 |
| Spec | D1 里 `.msg-tag` 的理由偏弱（「需新文案/分支」，而 `isAgent` 已具备、`lib/i18n` 文案可改） | **已修**：理由改写为「新增可见元素」（与另三条同一判据） |
| Standards | P2 Duplicated Code：三处角标 + 四处 22px 内联尺寸 | **已修**：抽 `IconCount`（`loading`/`count`，`useMemo` 的 `mutedCount` 一并提取）+ `SMALL_ICON_BTN_STYLE`（4 个调用点） |
| Standards | P2（边界）ED-5：消息头部角标内联 `fontSize: 10` | **已修**：两处改 `var(--fs-mono-xs)`（本仓独有 chip，不在上游 `.badge` 的 10px 家族里） |
| Standards | P2 `<main className="stream">` 内联 `flex/minHeight/overflowY` 与 `.stream` 重复 | **豁免**：同一份行内样式要同时服务 Tasks tab（那里没有 `.stream` class，看板的 `flex:1/min-height:0` 只能由 `main` 提供），且 `overflowX/overflowY` 是票 02 明写的护栏（`MobilePwaLayout.test.mjs` 断的就是行内串）；拆成条件样式会引入同一元素的第二份来源 |
| Spec | 裁剪切片记进 Answer 供票 11 docs-sync 收敛 | **已登记**（D1）：spec 组件表第 3 行点名 `.day-sep`/`.msg-tag`，本票只落 class 不渲染——票 11 按实况描述即可 |

### 持久化

- 分支：`whutlichao/ds-05-stream`
- 提交：`e66fe22`（主体）+ `49389e3`（票据收敛）+ review 收口 commit
- PR：**#118** —— https://github.com/whutlichao/worksplice/pull/118

## Rebase（第二次交付）

**触发**：协调端 `gh pr merge` 报 `CONFLICTING` —— 本票基于 `5506fc4`，`origin/main` 已前进到
`47c83b2`（票 08 #115、票 07 #116/#117、票 09 #119 并入）。

### 冲突清单与解法

| 文件 | 冲突形态 | 解法 |
| --- | --- | --- |
| `app/globals.css` | **单个冲突块**：四票都往文件尾**追加各自的 class 块**（HEAD = 票 07/08/09 的三段；ours = 票 05 的频道面段） | **两边的块都保留**（互不相干，不是二选一）；取序 = **05 → 07 → 08 → 09**（票号顺序）；本票的块另补一行注释起始符（git 把两侧共用的那行 `/* =====` hoist 出了冲突区，本票侧因此丢了开头） |
| `components/ChannelView.tsx` | 无冲突（main 侧没有任何票改过它） | 自动合并 |
| `components/message-stream.test.mjs`（新文件） | 无冲突 | 自动合并 |
| 票据 05 | 无冲突 | 自动合并 |

**取序理由（两条）**：
1. 按**票据顺序**（coordinator 开工前指定的口径）；
2. **CSS 级联无影响**：跨段没有同名 selector（脚本核对：本段 31 个 class 块在合并后的文件里各恰好一份；
   `origin/main` 侧对这批 selector 的定义数为 0）。唯一相邻的一对（票 07 的 `.tt-reply .composer-box` ×
   本票的 `.composer-box`）由票 07 显式**重声明**、特异性更高，与顺序无关。
3. 顺序还有一个副作用收益：票 09 的源码级断言用 `indexOf("搜索视图 class 块")` **切到文件尾**——
   本票的块排在它前面后，那条切片的覆盖范围回到它自己的段落（否则会把本票的 `.tab` / `.task-chip`
   扫进去，它的「无非 1px solid 边框」断言会误红）。

**rebase 后首跑了红（证据）**：`npm test` = **2 fail / 1276 pass**，两条都落在票 09 的 `SearchView.test.mjs`：
① `新段落不留旧方向残留`（切片越界扫到本票的 `.tab` 的 2px 透明下划线 / `.task-chip` 的 3px accent 左边）
→ 由**取序**（05 排在 09 之前）解掉，零文件改动；
② `facet 行与结果分组不渲染`（全局扫 `filter-chip`）→ 由下面的收口 4 解决。两条解完后 **1278 pass / 0 fail**。

### 合并收口（解冲突后的四处跨票调整）

1. **票 08 段缺注释起始符（origin/main 上既有破损，非本票引入，但必须修）**：
   `模态族 class 块（票 08…` 那一段的 `/* =====` 起始行在票 08/09 的合并里丢了 → 该段散文被当成
   **活 CSS**（`Invalid dangling combinator in selector`）→ **dev server 全站 500**。证据：
   `next dev` → `⨯ ./app/globals.css:1482:18 Parsing CSS source code failed`；`origin/main` 上同一处
   （1361 行）同样缺（rebase 前后都在 → 不是解冲突引入）。修法：补回一行起始符（**纯注释，零 CSS 语义**）。
   为确认只有这一处，写了一个按 CSS 注释语义（非嵌套、遇第一个 `*/` 闭合）剥注释后找活散文行的小扫描器：
   **活代码里的散文行 5 → 0**；修后 `curl /` = 200。
   （注：中文文档里写 `/* ─── xxx ───` 这种片段会给注释计数造成假性不平衡；真正的破损只有上面这一处。）
2. **右栏线程行内边距 14px → 16px**：D7 的 14px 是按**合并前**的 ThreadPanel 头部推的；票 07 合并后
   头部是 `.tt-summary`（`padding: 13px 16px 14px`）→ 16px。按「两边意图都在」（票 07 的「行自带内边距、
   不双重缩进」+ 本票的「与线程头部对齐」）取 `--sp-7`。实测：锚点行 `padding: 5px 16px`，与头部左缘同列。
3. **`.tt-reply` 槽里的 composer 内边距归零**：票 07 的槽自带 `11px 16px 14px`，本仓 Composer 在频道面
   自带 `10px 20px 16px`，合并后在线程里叠成 36px。按票 07 处理 `.tt-reply .composer-box` 的同款手法，
   在本票的 composer 规则里加 `.tt-reply .composer { padding: 0 }` → 回复框回到 16px（实测框左缘
   1619 = 1603 + 16，与头部/消息行对齐）。
4. **`.filter-chip` → `.member-opt`（跨票测试冲突；**待协调端追认**）**：票 09 的 `SearchView.test.mjs`
   有一条全局反证断言——任何 `components/*.tsx` 都不得出现 `className="…filter-chip"`（依据：票 06
   逐字搬入 `.filter-chip` 后无渲染点，票 09 核查宣布「渲染点作废、零消费者」）。而本票在频道面用
   `.filter-chip` 做 4 处切换胶囊（静音面板成员开关 / 成员面板成员行 / 添加成员 chip / composer 的 As task）
   ——这些显示实体在票 05 之前就存在，本票只是换形态，**没有新增显示面**。
   已用 `orchestration ask`（`msg_45ddc99f7db4`）请协调端裁决（A：窄化票 09 那半条断言 / B：本票换
   `.member-opt`），**两次超时（共 30 分钟）未获答复**。按 BEHAVIOR RULE 2（只编辑本票文件——不擅自改
   跨票测试）＋ 门禁要求全绿，采用 **B**：4 处改票 08 的 `.member-opt`（成员/选项胶囊，`.is-on` 同族）
   ——其中 3 处本来就是**成员**开关（语义更贴），composer 的 As task 是同一族的选项胶囊。
   结果：`.filter-chip` 回到零消费者、**票 09 的断言一字未动**、npm test 全绿。
   **若协调端更认可 A，只需回退这一处（一个 commit）**。

### 重跑的门禁（rebase 后，新 main 基线）

| 项 | 结果 |
| --- | --- |
| `npm test`（**全量**） | **1278 pass / 0 fail**（新 main 基线 = 1278 − 本票 13 = **1265**） |
| `node_modules/.bin/tsc --noEmit` | exit 0 |
| `npm run lint` | 0 error / 1 warning；唯一 warning 在 `hooks/useI18n.tsx:61`，该文件与 `eslint.config.mjs` 在 `5506fc4 → origin/main` 之间**零改动** → 新 main 基线同一条，**零新增** |
| `git diff --numstat origin/main` | `app/globals.css` **+132/−1**、`components/ChannelView.tsx` **+601/−808**、`components/message-stream.test.mjs` +431（新增）、本票据 +233/−9——无整文件重写 |
| `git log --oneline origin/main..HEAD` | 5 个提交**全部是本票的**（主体 / 票据收敛 / review 收口 / rebase 收口 / Answer SHA 回填） |
| `git status --porcelain` | 空 |

### 浏览器抽验（rebase 后，真实 dev server + 隔离数据目录）

`WORKSPLICE_DATA_DIR=/tmp/ds05-smoke` 的 seed 数据 + `next dev -p 30177` + ego-browser：

| 验收项 | 实测（合并后） |
| --- | --- |
| 消息作者头像 26px | **26×26**（`.avatar av-4`） |
| 消息行 hover | 悬停行 `background = oklch(0.21 0.014 255 / 0.05)`（= `--fg-soft`）；动作栏 `opacity 1`、揭示外壳 `display: flex` |
| 时间戳 / `#seq` | `ui-monospace…` / **10.5px** / `tabular-nums` |
| 频道头 / tabs | `.chan-head` = `--surface`（lab 100）+ 下边发丝；标题 16px / 680 / −0.32px；`.hash` = accent；首个 `.tab` 左缘 **272 = 标题左缘 272** |
| composer 焦点环 | 静止 `--shadow-composer`（`…/0.04 0 1px 2px`）；聚焦后 `0 0 0 3px --accent-soft` + 边框转 accent（`boxFocusWithin: true`） |
| 横向溢出 | `documentElement.scrollWidth === innerWidth`（0）；dock `scrollWidth === clientWidth`（379/379） |
| 票 07 合流面 | 锚点行 `padding: 5px 16px` / bg = accent-soft；`.tt-reply` 回复框 `padding: 0`、16px 偏移、静止 `box-shadow: none`、圆角 12px |

### PR 与持久化

- 分支：`whutlichao/ds-05-stream`（`git push --force-with-lease`）
- PR **#118**：`mergeable: MERGEABLE`，**保持 OPEN（未合并）**
- 提交：`430519c`（主体，rebase 后）+ `7493359`（票据收敛）+ `31678ae`（review 收口）+ `6f3c374`（rebase 收口）+ `992a96d`（本 Answer 的 SHA 回填）
