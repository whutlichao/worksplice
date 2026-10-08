# 02 — token 契约与地基

**What to build:** 把 `modern-minimal` 契约接进产品，并拆掉旧方向的整套骨架规则。具体：`app/globals.css` 顶部改 `@import "../../worksplice-design-system/colors_and_type.css"` + `…/tokens.css`；搬 `ui_kits/app/app.css` 的 reset 段（含 `:focus-visible { outline:2px solid var(--accent); outline-offset:2px }` 与 composer/字段的 `0 0 0 3px var(--accent-soft)` 环）；删 Tailwind（`@import "tailwindcss"` / `@theme` 块 / `postcss.config.mjs` 的插件 / `tailwind.config.ts` / 两个 devDependency）并把 2 处实用工具类（`components/MarkdownBody.tsx` 的 `text-xs px-2 py-1`、`components/ChannelView.tsx` 的 `overflow-x-hidden overflow-y-auto`）改成普通 class 或 inline style；`app/layout.tsx` 退掉三个 `next/font`、`viewport.themeColor` 改新值；断点常量（≤900 抽屉 / ≤1080 dock）；全仓按 spec 的映射表替换旧 token 名（含 `--border` 的 168 处逐处重写宽度与颜色、`--bg-selected` 的 fill+fg 成对改、`--yellow`/`--pink` 按调用点语义分流）；无对应的四个（`--user-bg` / `--assistant-bg` / `--tool-bg` / `--bg-subtle`）由扩展层重定义；解开全局 `* { border-radius: 0 !important }`。

**Blocked by:** 无

**Status:** resolved

- [x] `app/globals.css` 顶部出现两条 `@import`，指向 `worksplice-design-system/` 的 token 文件
- [x] 旧 token 名全仓出现 0 次（spec T-B 的枚举集；`--border` / `--bg` / `--accent` / `--accent-hover` / `--font-mono` 是同名保留项，不在集内）
- [x] 不再有 `border-radius: 0 !important`、不再有 `2px solid`、不再有取 `var(--ink)` 的阴影
- [x] `package.json` 无 `tailwindcss` / `@tailwindcss/postcss`；`tailwind.config.ts` 已删；`postcss.config.mjs` 无 Tailwind 插件
- [x] `app/layout.tsx` 无 `next/font`；字体角色走 `--font` / `--mono`
- [x] 存在 `@media (max-width: 900px)` 与 `@media (max-width: 1080px)`；不存在 `@media (max-width: 960px)`
- [x] `@media (prefers-reduced-motion: reduce)` 存在，且 `@keyframes` 组数不减（12 组）
- [x] 新增 `app/globals.test.mjs` 落 T-A（上游契约镜像断言）+ T-B（旧名灭绝）+ T-C（骨架规则）
- [x] `components/MobilePwaLayout.test.mjs` 的 4 条护栏断言仍全绿（若某条必须改，理由写进本 Answer）
- [x] `node_modules/.bin/tsc --noEmit` 通过；`npm test` 通过；`git diff --numstat` 无整文件重写

## Answer

### 交付摘要

票 02 落地：设计系统（`worksplice-design-system/`）作为运行时真源被 `app/globals.css` 顶层
`@import`；Tailwind v4 整条链退场；旧方向的 token 名全仓逐处替换；`border-radius: 0 !important`
与 2px ink 结构线拆除；断点对齐上游 900 / 1080；新增 `app/globals.test.mjs`（T-A/T-B/T-C + 渲染面）。

### 验收清单（逐条）

- [x] `app/globals.css` 顶部两条 `@import`，指向 `worksplice-design-system/colors_and_type.css` 与
      `tokens.css`。**路径是 `../worksplice-design-system/…`（不是票/spec 写的 `../../…`）**：见下方「偏离」D1。
- [x] 旧 token 名全仓 0 次（spec T-B 枚举集；`--border` / `--bg` / `--accent` / `--accent-hover` /
      `--font-mono` 同名保留项不在集内）——`app/globals.test.mjs` 的 T-B 逐文件断言。
- [x] 无 `border-radius: 0 !important`；无「有色 2px solid」结构线（保留的两处 2px 见「偏离」D2）；
      无取 `var(--ink)` 的阴影（`--ink` 本身已灭绝）。
- [x] `package.json` 无 `tailwindcss` / `@tailwindcss/postcss`；`tailwind.config.ts` 已删；
      `postcss.config.mjs` 为 `plugins: {}`；`bun.lock` 同步删除（`bun install --frozen-lockfile` 已复验通过）。
- [x] `app/layout.tsx` 无 `next/font`（三个 Google 字体整体退役）；字体角色走上游 `--font` / `--mono`；
      `viewport.themeColor` = `#fbfcfd`（`--bg` = `oklch(99% 0.002 240)` 的 sRGB 近似，meta 不接受 oklch）。
- [x] 存在 `@media (max-width: 900px)`（抽屉 + scrim）与 `@media (max-width: 1080px)`（dock 收窄
      `--dock-w-md`）；不存在 960px；`hooks/useIsMobile.ts` 保持 640 并在注释写明「配置面紧凑断点，非布局断点」。
- [x] `@media (prefers-reduced-motion: reduce)` 存在；`@keyframes` 12 组（不减）。
- [x] `app/globals.test.mjs` 新增，落 T-A / T-B / T-C，并加 T-D 渲染面断言（StatusDot 四态各渲染出
      `--online` / `--working` / `--error` / `--offline`，且 markup 内无 `2px solid`、无旧语义色名）。
- [x] `components/MobilePwaLayout.test.mjs` 4 条护栏全绿；其中 1 条按票/ spec 授权改断言（见「偏离」D3）。
- [x] `tsc --noEmit` 通过；`npm test` 1134 全绿；`git diff --numstat` 无整文件重写（最大单文件
      ChannelView 181/179 行）。

### 红绿证据（TDD）

1. **红**：先落 `app/globals.test.mjs`（T-A×2 / T-B×2 / T-C×5 / T-D×1），`node --test app/globals.test.mjs`
   → **9 fail / 1 pass**（唯一先绿的是 T-C 的 reduce+keyframes 护栏，它本就是「只增不减」守卫），
   证据留存 `/tmp/ds02/red.log`（本次会话内，未入库）。
2. **绿**：实现后同一命令 → **10 pass / 0 fail**；收尾 `npm test` → 1134 pass / 0 fail。
3. 渲染级证据（票要求「至少一条渲染级断言」）：T-D 用 `renderToStaticMarkup` + `jiti`（既有 seam）
   渲染 `StatusDot` 四态并断言新语义 token；另在 smoke 阶段起本地 `next dev`（隔离
   `WORKSPLICE_DATA_DIR`、端口 30242）取真实页面与编译产物 CSS，确认上游 token 真进了 bundle
   （`--panel` / `--accent: #2072d5` / `--rail-w: 252px` / `--fs-body: 13px` / accent-soft 焦点环），
   旧名（`--yellow` / `--bg-panel` / `--text-dim` / `--ink` …）在编译产物里为 0。会话结束后已 kill。

### 三个陷阱的逐处处理

- **`--border` 同名不同物（168 处）**：**未做机械 sed**。先全局把 `2px solid ${INK}` / `2px solid var(--ink)` /
  `2px solid var(--border)` / `1px solid ${INK}` / `2px dashed ${INK}` 五种形状重写为
  `1px solid var(--border)`（drop zone 用 `1px dashed var(--border-strong)`），随后逐文件清理
  已无消费者的 `const INK = "#141111"`（12 个文件）。`var(--border)` 现在是 1px 发丝色。
- **`--bg-panel` → `--panel` 层次方向翻转（65 处）**：按 spec 逐处改名；语义上「栏 / 列 / well」保持深一档,
  原 `--bg-panel` 作为「比画布亮的副底」的用法在 `--surface` 面（卡片 / chrome）由后续票 03–10 接管
  （本票不改形态结构，只换名）。
- **`--bg-selected` 成对改（21 处）**：全部改为 `--accent-soft` 底，并在同行/同对象补
  `color: var(--accent)`（选中态的分支色：`active/isSelected/isActive/scope === s/addMode` 等）；
  ModelsConfig 4 处 inline style 也补了 `color`（1 行内联对象）。
- **`--yellow` / `--pink` 语义分流（44 / 10 处）**：`--yellow` → 「当前位置 / 选中」一律
  `--accent-soft`（+ accent 字），例外逐处裁决：任务状态 `in_progress` → `--accent`（ED-10）、
  `StatusDot.working` → `--working`、`AgentDetailPanel` 的 DM 入口与 saveRuntime / `CreateAgentModal`
  bootstrap / `WorkspaceSidebar` 的新建频道与未读角标 → 实心 `--accent` + 浅 ink；
  `--pink` → 「行动」实心 `--accent`（+ `oklch(99% 0.01 256)` 浅字），SearchView 的 inThread 标签
  降为 `--accent-soft` + accent 字（是标签不是主按钮）。
- **`--ink` 三合一**：文字位 → `--fg`；边框位 → `--border` / `--border-strong`；阴影位 → `--shadow-card` /
  `--shadow-pop`（`--shadow-sm/md` 两个消费点分别改 `--shadow-card`；`--shadow-lg/pressed` 零消费者）。
- **`--cyan` / `--coral` / `--lime` / `--orange` / `--stone` / `--success`**：`--coral`/`--success`→
  `--error`/`--online`、`--lime`→`--online`、`--orange`→`--working`、`--stone`→`--offline`、
  `--cyan` 的 6 个调用点按语义分流（通知条/徽标→`--panel-2` 中性、mention 选中行→`--accent-soft`、
  任务 `in_review`→`--working`）。
- **字面量换 token（spec 1f）**：`--rail-w` / `--dock-w` / `--dock-w-md`（`.ws-left` / `.ws-right`）、
  `--z-topbar/scrim/rail/dock`（ws 骨架四处 z-index）、`--dur*` / `--ease`（抽屉与消息行 transition）、
  `--fs-body`（html/body 14→13px、`.markdown-body` 14→13px、markdown 表格与代码块 13px）、
  `--control-h` / `--control-h-lg`（组件里 14 处 `height: 32`、1 处 `height: 38`，**32/38 是唯一能对上
  上游标尺的字面量**；34/36/40 没有对应 token，属各面形态票的重做范围，本票不动）。

### 偏离（逐条、带理由）

- **D1 `@import` 相对路径用 `../` 而非票/spec 字面的 `../../`**。`app/globals.css` 的目录是 `app/`，
  `../worksplice-design-system/…` 才指向仓库根的 `worksplice-design-system/`；`../../` 会解析到
  `/Users/apple/orca/workspaces/worksplice/worksplice-design-system`（不存在）。已实测：用 `../` 起
  `next dev` 页面 200、编译产物 CSS 含全部上游 token（见「红绿证据」第 3 条）。T-A/T-C 的断言按
  可解析路径写，并断言两条 import 真的被解析（T-A 读入两份上游文件、逐 token 比对值）。
- **D2 保留 2px 的两处**：`ui_kits/app/app.css` 的 reset 逐字搬入，其中 `:focus-visible` 的
  `outline: 2px solid var(--accent)` 与 `::-webkit-scrollbar-thumb` 的 `border: 2px solid transparent`
  （scrollbar padding 技巧）本身含 2px。票的 Change 2 明确要求前者（也是 ED-8 的契约），
  T-C 的「不存在 2px solid」因此按**有色 border 结构线**实现（透明 padding 与 outline 不在断言范围），
  并在测试注释里写明判据。除此之外全仓 0 处 `2px solid/dashed` 结构线。
- **D3 `MobilePwaLayout.test.mjs` 第 3 条断言随 Tailwind 卸载改写法**（票/ spec 预设的授权路径：
  「若某条确需改，理由写进 Answer，不得静默删断言」）。原文断言
  `className="overflow-x-hidden overflow-y-auto"`；该 className 是 Tailwind 工具类，卸载后必须换形态，
  已改为 inline style（`overflowX: "hidden"` + `overflowY: "auto"`），断言改为断同一语义的新写法——
  护栏守的「纵向滚动、横向不溢出，iOS 键盘不撑宽布局」一字未变。其余 3 条未动。
- **D4 无对应的四个（`--user-bg` / `--assistant-bg` / `--tool-bg` / `--bg-subtle`）按 spec §1b 映射表
  收敛**（`--surface` / `--surface` / `--panel` / `--fg-soft`），而不是在扩展层保留旧名。理由：票同段要求
  「旧 token 名全仓出现 0 次」且 T-B 把四个名字列入灭绝集——保留旧名的「扩展层重定义」与 T-B 直接冲突；
  按任务书「本 spec 与票冲突时以本 spec 为准」，取 spec §1b 的映射表。扩展层因此只定义
  `--font-mono: var(--mono)`（T-B 的同名保留项，豁免；避免改写 83 处调用点与一条既有测试断言）。
- **D5 `components/MarkdownBody.tsx` 的 `text-xs px-2 py-1` 实际在 `ChatInput.tsx:1800`**（spec §2 与票
  都记错了文件）。按「2 处实用工具类」的意图逐处处理：ChatInput 那处改 inline style（12px / 4px 8px），
  ChannelView 的 `overflow-x-hidden overflow-y-auto` 见 D3。
- **D6 `bun.lock` 同步**（不在票的清单里但必须做）：删两个 devDependency 后不同步会让后续 worker 的
  `bun install --frozen-lockfile` 直接失败（AGENTS.md 指定的装依赖方式）。已 `bun install` 收敛
  （0 增 / 80 删），并复验 `--frozen-lockfile` 通过。
- **D7 `--font-mono` 不替换为 `--mono`**：T-B 的同名保留清单明确把 `--font-mono` 排除在灭绝集外；
  按其值在扩展层指向 `--mono`，83 处调用点与 `ExtensionStatusBar.test.mjs` 的既有断言都不用动。

### 红线自查

`git diff 354f749 HEAD --name-only` 的 35 个文件里：`lib/**` 0 个、`app/api/**` 0 个；
`components/**` 的变更全部是样式表达（inline style 值 / className→inline style / CSS class），
无 props、无 i18n key、无事件处理、无轮询节奏、无 `baseSeq` 来源改动。`npm test` 1134 全绿
（含 ChannelView 的 8 个 MessageRow 用例、DetailPanel 分派、CreateChannel/CreateAgent/Reminder 模态、
WorkspaceSidebar 的 DM/未读用例）即行为未动的机械证据。

### 门禁

| 项 | 结果 |
| --- | --- |
| `npm test`（宽档全量） | 1134 pass / 0 fail |
| `node_modules/.bin/tsc --noEmit` | 通过（exit 0） |
| `npm run lint` 增量对照 | 基线（`/tmp/ds02-base` worktree @354f749）= 0 error / 1 warning（useI18n 既有）；本票 = **0 error / 1 warning（同一条既有）**，零新增 |
| `git diff --numstat` | 最大单文件 181/179 行，无整文件重写 |
| dev smoke | `next dev` 200 + 编译产物 CSS 含上游 token、无旧名 |

### 双轴 code-review

（见下方「Review」小节）

### 与票 03 的重叠（登记，不重复做）

spec 1f 要求本票把 `.ws-left` / `.ws-right` 的宽度与 `.ws-mobile-toggle` / 抽屉的 `--z-*` / `--dur-drawer`
字面量换成 token，票 03 负责骨架**形态**（`.rail` 底、发丝、≤900 抽屉 + scrim 的完整形态）。因此本票在
`app/globals.css` 的 ws 骨架段只做了 token 化与断点数字对齐（236→252 / 480→380 / 300→`--z-topbar` /
500→`--z-rail|--z-dock` / 490→`--z-scrim` / `0.2s ease`→`--dur-drawer var(--ease)`），未改结构；
票 03 可直接在此基础上替换骨架块。**一处可见变化须知情**：rail 236→252px、dock 480→380px。

### Review

**Standards 轴**（独立 reviewer，固定点 354f749；该 reviewer 无 shell/git，改用基线 worktree 逐文件对读）

- P0/P1：无。verdict：**OK with notes**。
- P2（判断题）`AGENTS.md:546-552` 仍把旧 token 名写成 globals.css 契约 → **计划豁免**：ADR-0014 与 spec §5
  明说 `AGENTS.md` 视觉段由票 11 改写，本票 Ownership 不含它。
- P2（偏硬）旧色值字面量残留（`#fffaef` / `#fffdf5` / `#c9c7c2` / `#a9d877` 死兜底）→ **已修**（df1348a）。
- P2（判断题）`taskBadgeStyle` 的 `todo` 应为 `--faint`（DESIGN §2 / ED-10 / 原型 `STATUS_COLOR` 三处一致）
  → **已修**。
- P2（判断题）`--font-mono` 别名层与「不留别名层」冲突 → **保留，理由见偏离 D7**（票 02 验收清单把
  `--font-mono` 列入同名保留项，与 spec T-B 的豁免一致；取舍是零改写的 83 处调用点与一条既有断言）。
- smell（一律判断题）：**Repeated Switches**（任务状态→色在 `ChannelView` / `AgentDetailPanel` / 两个
  Reminder 面各自编码）→ 留票 06 收口（任务板形态票）；**Primitive Obsession**（hex）→ 已修；
  **Shotgun Surgery**（`--border` 逐点重写而旧 T-C 只扫 globals.css，组件侧无回归网）→ **已修**：
  T-C 新增「app/components/hooks 的有色 2px 结构线 = 0」断言。

**Spec 轴**（独立 reviewer，固定点 354f749）

- P2 与 Standards 重叠的两条 hex 残留 → **已修**（同上）。
- P2 票面错误（`text-xs px-2 py-1` 实际在 `ChatInput.tsx:1800`；`@import` 实现为 `../`）→ **实现无误**，
  已记入偏离 D1 / D5。
- P2 Scope creep（`--rail-w` / `--dock-w` / `--z-*` / `--dur-drawer` / ≤900 抽屉属票 03 面）→ **可辩护**：
  spec 1f 明确要求本票消费这些 token；重叠与可见尺寸变化已登记在上一节。
- P2（实现错误）`taskBadgeStyle` 的 `in_progress` 实底配 `--fg` 字（约 3.5:1）→ **已修**：accent 实底配浅 ink。
- 零行为改动红线抽查（ChannelView / ChatInput / WorkspaceSidebar / useIsMobile 的 props、handler、i18n、
  轮询、`baseSeq`）→ 未见改动；`MobilePwaLayout` 护栏的改写法就地写明理由，非静默删。
- reviewer 无 shell，未能自跑测试 / tsc / lint → 由本票在 supervisor 侧执行，证据见「门禁」表。

**汇总**：Standards 轴 5 findings（0 硬违规、5 判断题/近硬项），最重者是旧配色 hex 残留（已修）；
Spec 轴 4 findings（0 缺失、1 scope creep 已登记、2 票面错误实现无误、1 实现错误已修），最重者是
`in_progress` 徽标对比度（已修）。跨轴不做单一排序。

### 持久化

- 分支：`whutlichao/ds-02-token-foundation`
- 提交：`dcd6d09`（主体）+ `df1348a`（review 收口）
- **PR：#110**（OPEN，base `main`）
