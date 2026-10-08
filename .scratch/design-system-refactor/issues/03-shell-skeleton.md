# 03 — 三栏骨架与响应式

**What to build:** 把 `AppShell.tsx` 与 `app/globals.css` 的 `ws-*` 骨架改成设计系统的三栏形态：`.app` 语义（`display:flex; height:100dvh; overflow:hidden`）、rail 消费 `--rail-w`（252px，替换硬编码 236px）、dock 消费 `--dock-w` 380px 与 `--dock-w-md` 340px（替换 `min(480px, 44vw)`）、发丝分隔（`1px solid var(--border)`，替换 `2px solid var(--ink)`）、`--z-*` 阶梯（替换 300/490/500 硬编码）、`--dur-drawer` + `--ease`（替换硬编码 0.2s）。响应式：抽屉断点 960 → 900；新增 ≤1080 的 dock 收窄。`WorkspaceSidebar` 的 `.rail` 形态：`.rail-head` / `.brand`（`.brand-mark` + `.brand-name` + `.brand-sub`）/ `.search-btn`（`:focus-within` accent 环）/ `.rail-actions` / `.group-label`（mono 9.5px + `letter-spacing .1em`）/ `.nav-row`（激活 = `--surface` 填充 + inset 发丝 + 2px accent `::before` 竖条 + accent mono `#`）/ `.rail-foot`。

**Blocked by:** 02

**Status:** resolved

- [x] rail 宽度来自 `var(--rail-w)`；dock 宽度来自 `var(--dock-w)` / `var(--dock-w-md)` —— 桌面宽度落在 AppShell 的 inline token（`style={{ width: "var(--rail-w)" }}` / `"var(--dock-w)"`，渲染级契约）；`≤1080` 收窄落在 `.ws-right { max-width: var(--dock-w-md) }`。证据：`components/AppShell.test.mjs` 前两条 + 浏览器实测 1081→380 / 1080→340（见 Answer 的 E2E 表）
- [x] 骨架分隔一律 1px 发丝；无 2px ink —— `.ws-left`/`.ws-right`/`.rail-actions`/`.rail-foot` 全为 `1px solid var(--border)`；「无有色 2px」由 `app/globals.test.mjs` 的 T-C（全局）+ `AppShell.test.mjs` 的 `skeletonSection()`（骨架段）两级断言守（做过变异验证：注入 `2px solid` 见红，恢复见绿）
- [x] `z-index` 全部来自 `--z-*` —— 四个取值点（`.ws-mobile-toggle`/`.ws-left`/`.ws-right`/`.ws-backdrop`）；骨架段「无数字 z-index」断言同样做过变异验证
- [x] 抽屉过渡用 `--dur-drawer` + `--ease`；test 断言 `max-width: 900px` 存在、`960px` 不存在 —— 过渡断言在 `AppShell.test.mjs`；900/1080 成对断言（含 960 退场）在 `app/globals.test.mjs` 的 **T-C**（票 02 落地，本票复核为绿）
- [x] `≤1080px` 下 dock 收窄到 340px（E2E 或源码断言） —— 两侧都做了：源码断言（`max-width: var(--dock-w-md)`）+ Chromium 实测（1080→340 / 1000→340 / 800→320 且抽屉化）
- [x] 导航激活态…（**口径冲突已收敛，见 Answer 偏离 ①**）——实落 `--surface` 填充 + `inset 0 0 0 1px var(--border)` + `::before` 2px `--accent` 竖条 + `.hash` accent mono；「不是黄色实心」满足（`--yellow` 全仓 0 次，票 02 已灭绝）。票面 What-to-build 与本行口径不同，取上游 `app.css:88` + spec §3 组件表第 2 行
- [x] `AppShell` 渲染断言：markup 里出现 `var(--rail-w)` / `var(--dock-w)`，不出现 `236px` / `480px` —— rail 走渲染级（markup 实测命中 `width:var(--rail-w)`、无 `236px`/`480px`）；**dock 走源码级 + 规则体 + 媒体查询**（条件渲染，静态渲染无该元素——coordinator 裁决 1A，理由与证据见 Answer 偏离 ②）
- [x] **rail 的 agent 行头像**尺寸 28 → 22px（`size="sm"` = `--avatar-sm`）；行高随之重校 —— markup `class="avatar sm av-N"`；浏览器实测头像 22px / 行高 34px（`.nav-row` padding 6px + 行距 1px）
- [x] `components/MobilePwaLayout.test.mjs` 的 4 条护栏断言全绿（安全区 / `--app-viewport-height` / 输入框 16px）—— 全量测试绿；该文件本票未改（行为面：`useViewportHeight()`、四个 safe-area padding、inline `height: var(--app-viewport-height, 100dvh)` 一字未动）
- [x] `npm test` / `tsc --noEmit` 通过 —— `npm test` **1173 pass / 0 fail**（基线 1161，+12 为新断言）；`tsc --noEmit` clean；`npm run lint` 仅 1 条基线既有 warning（零新增）

## Answer

### 交付摘要

把三栏骨架的**形态**做成设计稿（数字由票 02 对齐，本票只落形状）：`AppShell` 的 `.ws-shell` 取 `.app` 语义（`display:flex` + `overflow:hidden`，视口高度仍由 inline `var(--app-viewport-height, 100dvh)` 接管，iOS 键盘护栏不动）；rail/dock 的桌面宽度改由 AppShell 的 inline token 承担（`var(--rail-w)` / `var(--dock-w)`，渲染级契约）；`≤1080` 由 CSS `max-width: var(--dock-w-md)` 收窄；`≤900` 抽屉（scrim + transform + `--dur-drawer`/`--ease` + `--z-*` 阶梯）保持并复核。

`WorkspaceSidebar` 的内联样式整体退场，改成上游 `ui_kits/app/app.css` 的 rail 块：`.rail-head` / `.brand` + `.brand-mark` + `.brand-name` + `.brand-sub` / `.search-shell` + `.search-btn`（`:focus-within` accent 环）/ `.rail-actions` / `.rail-scroll` / `.group` + `.group-label`（mono 9.5px + `--ls-wider` 0.1em + 大写）/ `.nav-row`（`.is-active` = `--surface` 填充 + inset 发丝 + 2px accent `::before` 竖条 + accent mono `#`）/ `.rail-foot`——13 个 class 块逐字搬进 `app/globals.css`（含裁剪登记），文件净减 260 行（hardcode 的内联样式换成 class 块）；rail 的 agent 行头像收 28 → 22px（票 04 已迁移的 `.avatar.sm`）并由 `.nav-row` 重校行高。

**零行为改动**：props、事件处理器、i18n key、面板转移（`openPanel`/`closePanel`/`onChannelSwitched`/`memberPanel`）、URL hash 深链、15s 轮询节奏全部一字不动；`lib/**` 只新增一件 i18n 文案键（`shell.brandSub`，coordinator 裁决 2）；`app/api/**` 零改动。唯一触碰事件面的地方是删掉两个创建按钮的纯视觉 press-effect 内联 mouse 处理器（偏离 ⑧ 登记）。

### 红绿节奏（TDD）

**红（真实执行，两侧都录）**：`components/AppShell.test.mjs` 先落 8 条断言，在 base `c21602a` 的实现上跑 → **6 fail / 2 pass**：

```text
✖ 骨架三栏：AppShell 渲染出 ws-* 钩子，rail 宽度消费 var(--rail-w)（不用字面量 236px）
✖ dock 宽度契约：AppShell 源码级 var(--dock-w) + .ws-right 规则体 + ≤1080 收窄到 --dock-w-md
✖ .ws-shell 取 .app 语义（flex 列 + overflow:hidden），两栏分隔是发丝
✔ z-index 阶梯全部取自 --z-*（骨架段无数字 z-index）      ← 票 02 已落，本票复核
✔ ≤900 抽屉：scrim + transform + --dur-drawer/--ease（960 退场由 T-C 守）  ← 同上
✖ rail 形态落盘：rail-head / brand* / search-btn / rail-actions / rail-scroll / rail-foot
✖ .group-label：mono 9.5px + letter-spacing .1em + 大写（--faint）
✖ 导航激活态 = --surface 填充 + inset 发丝 + 2px accent 竖条 + accent mono #（不是黄色实心）
ℹ tests 8 · pass 2 · fail 6
```

**绿**：实现后同文件 **8/8** ✔。`components/WorkspaceSidebar.test.mjs`：形态改造使一条既有断言见红（`assert.match(tag, /width:34px/)`——提醒按钮从 34px 内联宽高改为 `.icon-btn` 原语）→ 按**意图**改写该断言（守卫不变量不变：宽度固定、不被 flex 拉伸、图标 18px 不被压缩；`.icon-btn` 自身的 30px 形态断言在 `primitives.test.mjs`）并新增 `.is-on` 标记断言 → **17/17** ✔。全量：**1173 pass / 0 fail**。

**红侧可复现命令**（本票 commit 后，按父提交回退单文件是安全的）：

```sh
git checkout c21602a -- app/globals.css components/AppShell.tsx components/WorkspaceSidebar.tsx
node --test components/AppShell.test.mjs      # 6 fail / 2 pass
git checkout HEAD -- app/globals.css components/AppShell.tsx components/WorkspaceSidebar.tsx
```

（实现前那次红是在**未 commit** 状态下跑的，所以当时不能用 `git checkout <父提交> -- <文件>` 复现——那会丢工作区；commit 前用「备份到 /tmp + 写回 base 版本 + 恢复」的等价做法重放了一次，tally 与实现前一致：**6 fail / 2 pass**，且恢复后 md5 逐文件相同。）

### E2E 形态实测（Chromium，真实 markup + 真实 stylesheet）

做法：`renderToStaticMarkup` 出**真实** rail markup（`WorkspaceSidebar` + 真实数据），配 `<link rel="stylesheet" href="/app/globals.css">`（含两条设计系统 `@import`），静态服务 + ego-browser 量 computed style；harness 文件用后即删（本票 `git status` 干净）。

| 视口宽 | `.ws-left` | `.ws-right` | `.ws-right` 定位 | `max-width` |
| --- | --- | --- | --- | --- |
| 1440 | 252 | 380 | static | none |
| 1081 | 252 | 380 | static | none |
| 1080 | 252 | **340** | static | 340px |
| 1000 | 252 | **340** | static | 340px |
| 901 | 252 | **340** | static | 340px |
| 800 | 252 | **320** | fixed（抽屉） | 320px |

- 全部视口 `documentElement.scrollWidth === innerWidth`（无横向溢出）；`.rail-scroll` 与 `.rail-foot` 的 `scrollWidth === clientWidth`（不裁切、不溢出）。
- `.nav-row.is-active` 实测：`background = oklch(1 0 0)`（`--surface`）、`box-shadow = … 0 0 0 1px inset`（发丝）、`::before` = 2px `--accent`（`left: -8px` ⇒ 精确落在 `.rail-scroll` 的 8px padding 内，不裁切）、`.hash` = `--accent`、`font-weight: 600`。
- `.group-label` 实测：mono / **9.5px** / `letter-spacing: 0.95px`（= 0.1em）/ `text-transform: uppercase` / `--faint`。
- `.brand-sub` 实测：**9.5px** / `letter-spacing: 0.76px`（= `--ls-wide` 0.08em）/ uppercase。`.brand-mark` 26×26 / 7px 圆角 / `--accent` 底。
- `.search-btn` 聚焦实测：`border-color → --accent`、`box-shadow: 0 0 0 3px --accent-soft`（alpha ≈ 0.094）；内层 input 自己的字段环被压掉（`inputShadow: none`）——双环已消除。
- agent 行实测：头像 **22px**、行高 **34px**（旧形态是 28px 头像 + 4px 外边距）；`.rail-foot` 四件（提醒 `.icon-btn` / Models / Skills / 语言 `.select`）都放得下，无裁剪。
- `≤900` 实测：关闭按钮桌面端 `display: none`、紧凑端 `display: grid`（30×30，`.icon-btn` 形态；这条靠 `.rail-head .ws-sidebar-close` 的复合选择器压过原语段的 `display:grid`）；rail/dock 均 `position: fixed`，dock 过渡 = `0.2s, 0.2s` on `transform, box-shadow`。

### 偏离与豁免登记

① **导航激活态底色口径**：票面清单第 6 行写「`--accent-soft` 底 + `--accent` 文字/竖条」，而同一份 What-to-build、spec §3 组件表第 2 行与上游 `ui_kits/app/app.css:88` 都写 `--surface` 填充 + inset 发丝 + 2px accent `::before` 竖条 + accent mono `#`。落 **`--surface`**（上游是形态来源，D7 明写 class 块即形态载体）；「不是黄色实心」满足。spec 自身的三处口径不一致在此登记，供票 11 收口。
② **dock 的 markup 级断言缺位**（coordinator 裁决 1A）：`.ws-right` 自 ticket 13 起条件渲染（`{resolvablePanel && …}`——无选中整栏消失），静态渲染的 AppShell 里没有这个元素。故 rail 走**渲染级**断言（markup 实测出现 `var(--rail-w)`、无 `236px`/`480px`），dock 走「AppShell 源码级 `var(--dock-w)` + `.ws-right` 规则体 + ≤1080/≤900 媒体查询」三件套；**DOM 结构零改动**（不改成常驻 `hidden`）。
③ **桌面宽度从 CSS 搬到 AppShell 的 inline**：`.ws-left`/`.ws-right` 的 CSS 规则不再声明 `width`（同一值只留一处，避免两处同值的漂移——inline 会静默赢过 CSS，那比多一个编辑面更糟）；CSS 保留断点收窄（`max-width`）。代价 =「CSS 单独读不出桌面宽度」，已写在 `app/globals.css` 骨架段头注并与 `AppShell.tsx` 的两处注释互相指认；双轴 review 的 Standards 第 6 条把它登记为 Divergent Change（处置见下）。⚠ 若日后去掉那条源码级断言，应把宽度收回 `.ws-left`/`.ws-right` 规则体，恢复单一形态来源。
④ **≤1080/≤900 用 `max-width` 而非 `width`**：inline 宽度只能被 `max-width` 收窄——断点因此仍归样式表，不需要 `!important`（同特异性下后者胜出，E2E 实测 340 / 320）。
⑤ **`.rail` 容器块不搬**：其角色（`--panel` 底 + 右发丝 + 固定宽度）已由骨架钩子 `.ws-left` 承担；再加一层会让上游那条 ≤900 `position:fixed` 规则与本仓抽屉规则套在同一元素上打架。裁剪登记写在 CSS 段头（同处还登记了 `.group-label button`、`.search-btn span`/`kbd` 两条无消费者的规则）。
⑥ **`.search-btn` 的 markup 偏离上游**：上游是「打开命令面板的按钮 + `span` + `kbd`」，本仓是真实输入框 + 提交按钮（§6.4 的 Enter/Escape 行为不动）→ input 取上游 `span` 的位置、焦点环落在 shell 上（内层 input 自己的环压掉，防双环）。名字 `search-btn` 的「说谎」是**故意的**（D7 的逐字对照优先于命名的字面诚实），已在组件注释里挑明。
⑦ **`.rail-foot` 的内容控件连带换形**：提醒按钮 `34×28 内联` → `.icon-btn`（30px）+ `.is-on`（有到期待触发提醒时）+ `.badge` 计数；Models/Skills → `.btn-sm`（27px）；语言 `<select>` → `.select`（压到 `--control-h-sm`）。票面只点名 `.rail-foot` 容器，这四个控件是它的内容面（ED-2/ED-4 推得动）；`WorkspaceSidebar.test.mjs` 的 reminder 断言按意图改写、另加 `.is-on` 断言。同理 unread 角标 20 → `.badge`（18px min-width）、archived 标记改 `.badge.soft`（票面未逐条写，属 `.nav-row` 子件收口）。
⑧ **删掉两个创建按钮的 press-effect 内联 mouse 处理器**：原 `onMouseDown/onMouseUp/onMouseLeave` 写的是旧方向的硬墨阴影（`3px 3px 0 0 rgba(20,17,17,…)`）+ 位移——纯视觉内联样式改写，与 ED-4「静止内容不加阴影」和 `--ink` 灭绝冲突。删的是视觉表达；`onClick`、props、i18n key 零改动，按压反馈由 `.btn` 的 hover 态承担。**这是本票唯一触碰事件面的地方**，特此登记。
⑨ **DM 行仍是 `MessageSquare` 图标**（上游是 `.avatar.sm`）：票 04 的 avatar 调用点清点表（7 处）不含 DM 行，新增调用点会越出该表，本票不动它。
⑩ **`.brand-mark` 字形 + `.brand-sub` 的 uppercase**：上游 mark 是 SVG 重建的自定义字形 → 按 AGENTS.md 的 lucide 规则取 `List`（`strokeWidth 2.2` 对齐上游描边）；`.brand-sub` 加 `text-transform: uppercase`（上游原型写的是字面 "LOCAL · E2EE"，不需要 transform）——让 i18n 串保持正常大小写、由 CSS 出 postmark 形态（zh 无大小写，是 no-op）。新增 i18n 键 `shell.brandSub`（en "Local workspace" / zh「本地工作区」，取自 README 原话）经 coordinator 裁决 2 批准。
⑪ **`.brand-mark` 的 `oklch(99% 0.01 256)` 字面量**：逐字来自上游 `app.css:67`（on-accent 前景色）；不立 `--on-accent` 的理由 = 那会新增一个上游没有的 token，并要动票 04 的 `.btn-primary`/`.badge` 块（越界）。Standards review 第 3 条登记为豁免。

### 双轴 code-review（两份报告，未合并）

#### Standards

> ## Review
>
> **范围**：`git diff c21602a`（8 文件，全部工作区未提交；`.scratch` 票据 + globals.css + AppShell.tsx + WorkspaceSidebar.tsx + 两份测试 + i18n 两条）。**只读**，未改任何文件。
>
> **Correct（已核对，符合本仓文档标准）**
> - i18n 分层（docs/i18n.md「UI 文案必须走两套语言包」）：`shell.brandSub` 在 `lib/i18n/messages/en.ts` 与 `zh-CN.ts` 同步补齐，组件走 `t(...)`，无硬编码文案。✔
> - UI 图标规则（AGENTS.md「lucide 优先，除反应数据外禁新增 emoji」）：新增 `List` / `Plus`（WorkspaceSidebar.tsx:3）均为 lucide，diff 无新增 emoji。✔
> - 注释/测试遵循 §1（中文注释）与 §2.1（node:test + jiti + renderToStaticMarkup）。✔
> - 门禁命令（需 supervisor 执行）：`npm run typecheck`、`npm run lint`、`npm test`——仓库 test glob 用 `components/**/*.test.mjs`，新文件自动纳入。
>
> **Finding（均为 P2，报告项；无硬违规、无 P0/P1）**
>
> 1. **Duplicated Code（测试基建）**：`escapeRe`/`ruleBody`/`cssBlock` 与 `components/primitives.test.mjs:15,20` 的 `escapeRe`/`blockBody` 是复制粘贴（AppShell.test.mjs:40,45,56）。仓库无「测试辅助共享模块」约定，可接受；最小修法是把这三个纯函数提到 `components/css-test-helpers.mjs` 两边共引。
> 2. **Mysterious Name**：`<div className="search-btn">`（WorkspaceSidebar.tsx:161）现在包着 `<input>`+`<button>`，语义是字段壳而非按钮。名字来自上游逐字搬运（裁剪登记已有理由），但「btn」在说谎。判断项。
> 3. **Primitive Obsession**：`.brand-mark` 新引入字面量 `oklch(99% 0.01 256)`（globals.css:1023）。这是「accent 上的前景色」，设计系统无对应 token，该字面量在 globals.css 已出现 4 次、全仓 ~15 次。diff 新增了其中一处。最小修法：在扩展层立 `--on-accent`，`.brand-mark`/`.btn-primary`/`.badge` 共用。
> 4. **Primitive Obsession（轻微）**：外推的 `EMPTY_NOTE_STYLE` 与 error 行用字面量 `12px`（WorkspaceSidebar.tsx:13 附近、:196 附近），而 `--sp-5 === 12px`（tokens.css）。ED-3/ED-5 要求外推走 token 标尺。
> 5. **Source-level assertion 触 §2.1「只测外部行为，不测实现细节」**：`AppShell.test.mjs:96` 对 `AppShell.tsx` 源码做正则（`width:\s*"var\(--dock-w\)"`）。仓库只对薄路由允许源码级断言，组件档是渲染断言。因 dock 条件渲染、静态渲染无 markup，此处无可替代的 seam——判为可辩护的 P2，但它同时把下面第 6 条的设计决定钉死。
> 6. **Divergent Change / Shotgun Surgery**：见下（问题答复）。
>
> **Merge verdict: OK with notes。**
>
> ---
>
> ## 单独回答：宽度搬到 inline 是「规避 Duplicated Code」还是坏味道？
>
> **判断：不是规避 Duplicated Code，是一个该被记录的 Divergent Change（骨架形态被拆到两个文件）。不构成阻断，但「理由是测试」这点应写清。**
>
> 理由：搬 inline 并没有消除重复——改前 CSS 一处声明、改后 TSX 一处声明，声明数不变。它真正改变的只是**宽度的归属文件**：`.ws-left` / `.ws-right` 的桌面宽度现在在 `AppShell.tsx:455,518`，断点收窄（≤1080 `max-width` globals.css:875、≤900 抽屉 :970）在 CSS。于是「把 dock 从 380 改到 400」要动 TSX，「改窄屏行为」要动 CSS，一个概念两个编辑面——这正是 Divergent Change；副产品是「CSS 单独读不出桌面宽度」的 locality 损失（spec D7 明说 `ws-*` 是骨架布局钩子的形态载体，宽度属骨架布局）。
>
> 唯一的动机是可测性：票 03 验收要求「markup 里出现 `var(--rail-w)` / `var(--dock-w)`」，而 CSS 规则给不了渲染级 markup 证据，于是值被挪进 inline、测试（第 5 条）再把它钉住——**测试反向决定了设计**。缓解因素真实存在：本仓已有先例（`--app-viewport-height` 同样 inline 在 AppShell，globals.css:829 注释交叉引用），且两处都留了互相指认的注释，读代码不会迷路。
>
> 建议：保留现状（先例 + 注释已抵消大部分代价），但在 `docs/engineering-standards.md` 或 spec 里补一句「骨架宽度为渲染级契约、故意 inline；断点收窄仍归 CSS」，把「为什么 CSS 读不到它」写下——否则下一个读 CSS 的人会当成遗漏。若日后去掉那条源码级断言，应把宽度收回 `.ws-left` / `.ws-right` 规则体，恢复单一形态来源。

#### Spec

> 轴：Spec 忠实度（只读，未改任何文件）。核对对象：基地 `c21602a` 工作区 delta（8 文件，无 commit），规格源逐字读过：票正本、spec §3/§1c/D5–D8/§6、ADR-0014、上游 `ui_kits/app/app.css:40–91` 与原型 460–540 行。
>
> **Correct**
> - 逐字对照成立：`.rail-head`/`.brand*`/`.search-btn`/`.rail-actions`/`.rail-scroll`/`.group*`/`.nav-row`/`.rail-foot`（`app/globals.css:1016–1078`）与上游 `app.css:40–91` 逐声明一致；`--ls-wider`=0.1em、`--fs-mono-micro`=9.5px 与票面「mono 9.5px + `letter-spacing .1em`」吻合（`colors_and_type.css:50,66`）。
> - 票面第 1/2/3/4/5 条全部落地：rail inline `var(--rail-w)`、dock inline `var(--dock-w)` + `max-width: var(--dock-w-md)`（`globals.css:873–876`）、发丝分隔、`--z-*` 全量（globals.css 已无数字 z-index）、`--dur-drawer`/`--ease`。
> - 已登记裁决 1（dock 源码级）**站得住**：`AppShell.tsx:513–518` 条件渲染 + `resolvablePanel` 出自默认 `null` 的 `panelContent`（`AppShell.tsx:80,415–427`），静态渲染确无该标记，与 `MobilePwaLayout.test.mjs` 同类 seam。
> - 已登记裁决 2 方向对：spec §3 组件表第 2 行原文即「激活 = `--surface` 填充 + inset 发丝 + 2px accent `::before` 竖条」，上游 `app.css:88` 同为 `--surface`；票面第 6 条与 spec §1c 的 `--yellow` 分裂句是第三条口径，属 spec 自相矛盾，取形态来源为正解。
> - 已登记裁决 3 最小：仅 en/zh-CN 各加一键（`lib/i18n/messages/*.ts`），默认 locale=`en`（`useI18n.tsx:9,80`），断言 "Local workspace" 可复现。
>
> **Finding**
> - **P2** 票面第 6 条口径未收敛且无处登记：`globals.css:1071` 落 `--surface`（正确），但票正本 11 条清单**全部仍 `- [ ]`**、`## Answer` 为空——而 `globals.css:1012` 与 `WorkspaceSidebar.tsx:81` 的注释都写「见票 03 Answer 的偏离登记」，属悬空引用。最小修：把第 6 条口径改成 `--surface` 并在 Answer 登记三处偏离；否则该票的 Evidence 链（red/green + Review）不成立。
> - **P2** `AppShell.test.mjs:122–124` 注释称「把骨架段单独再钉一次」，但 `cssBlock(".ws-shell {")` 只返回 `.ws-shell` **单条**规则体（helper 从 header 的 `{` 配平），断言实际不覆盖整段骨架；同文件 `:130–135` 用 slice 到「原语 class 块」才是骨架级。全局兜底在 `globals.test.mjs` T-C，覆盖不丢，纯口径不符。
> - **P2（scope，可辩护）** 票面只点名 `.rail-foot` 容器，实现连带把提醒/模型/技能/语言改 `.icon-btn`/`.btn-sm`/`.select`/`.badge`（`WorkspaceSidebar.tsx:275–330`），并因此改 `WorkspaceSidebar.test.mjs` 的 `width:34px` 断言 + 新增 3 条；unread badge 20→18px、archived 改 `.badge.soft` 亦票面未写。ED-2/ED-4 推得动，但票面应补一行。
> - **P2** `.brand-sub` 加了上游没有的 `text-transform: uppercase`（`globals.css:1029–1032` vs `app.css:47`；原型是字面 "LOCAL · E2EE"）。为让 i18n 串出 postmark 大写，可接受，属形态外新增。
>
> 未发现 P0/P1：`width → max-width` 换法自洽（≤1080 在 `globals.css:873`、≤900 在 `:947`，同特异性后者胜出），新 class 名全仓无碰撞（ED-7 满足），旧 inline 样式助手已清干净。
>
> **待 supervisor 跑**：`npm test`（含 `components/AppShell.test.mjs`、`WorkspaceSidebar.test.mjs`、`MobilePwaLayout.test.mjs`、`app/globals.test.mjs`）与 `node_modules/.bin/tsc --noEmit`。
>
> **Merge verdict: OK with notes**（须补 Answer/清单收敛与第 6 条口径改写）。

#### findings 逐条处置

##### Standards

1. 测试辅助函数重复（vs `primitives.test.mjs`）→ **豁免**：仓库没有共享测试辅助模块的约定，抽模块要动票 04 的 `primitives.test.mjs`（跨票手术，越 ownership）；reviewer 自己判「可接受」。
2. `.search-btn` 名不副实（Mysterious Name）→ **豁免 + 补注释**：D7 要求 class 名与上游逐字对照（形态锚点），改名会让「搬自上游哪一块」失去依据；已按要求把这条「说谎」在组件注释里写明（偏离 ⑥）。
3. `.brand-mark` 的 on-accent 字面量（Primitive Obsession）→ **豁免**：逐字上游值，立 `--on-accent` 会新增上游没有的 token 并牵动票 04 的块（偏离 ⑪）。
4. `12px` 字面量（ED-3/ED-5）→ **已修**：`EMPTY_NOTE_STYLE` 与 error 行的 padding 改 `var(--sp-5)`。
5. `AppShell.tsx` 的源码级断言 → **豁免**：coordinator 裁决 1A，且无替代 seam（偏离 ②）；两轴 reviewer 均判可辩护。
6. Divergent Change（宽度归 TSX）→ **接受并落文档**：「骨架宽度是渲染级契约、故意 inline；断点收窄归 CSS」已写进 `app/globals.css` 骨架段头注 + `AppShell.tsx` 两处注释（偏离 ③）；`docs/engineering-standards.md`/spec 的措辞收口不在本票 ownership（票 11 的文档面），在此登记供其取用；reviewer 的备份方案（去掉源码级断言后把宽度收回 CSS）已抄进偏离 ③。

##### Spec

1. 清单未勾选 + `## Answer` 为空 + 注释里「见 Answer 的偏离登记」悬空 → **已修**：本 Answer 即收敛（清单 10 条全勾并逐条给证据；第 6 行的口径不一致在偏离 ① 写明，且**不改写验收原文**）。
2. 「骨架段」断言口径不符（`cssBlock(".ws-shell {")` 只覆盖单条规则）→ **已修**：新增 `skeletonSection()`（`.ws-shell` → 原语段标记的整段），2px 与数字 z-index 两条断言都改用它；并用变异测试验证有牙（在 rail 块内注入 `2px solid` / 数字 `z-index` → 两条断言分别见红；恢复后 8/8 绿、md5 不变）。
3. `.rail-foot` 内容控件的连带改造未在票面 → **登记**（偏离 ⑦）。
4. `.brand-sub` 的 uppercase 上游没有 → **登记**（偏离 ⑩）。

### 红线自查

`git diff c21602a --name-only`：

```text
.scratch/design-system-refactor/issues/03-shell-skeleton.md
app/globals.css
components/AppShell.test.mjs
components/AppShell.tsx
components/WorkspaceSidebar.test.mjs
components/WorkspaceSidebar.tsx
lib/i18n/messages/en.ts
lib/i18n/messages/zh-CN.ts
```

- `lib/**`：只 `lib/i18n/messages/{en,zh-CN}.ts`——spec §6 明写「`lib/**` 除 `lib/i18n`（文案）外零改动」，且 coordinator 裁决 2 批准该键。
- `app/api/**`：**0 命中**。
- 票 04/10 所属文件（`StatusDot` / `Avatar` / `PixelAvatar` / `primitives.test.mjs` / `MobilePwaLayout.test.mjs` / `ChannelView` / `ThreadPanel` / `DetailPanel` / `AgentDetailPanel` / 四个模态 / `SearchView` / `MarkdownBody` / `MessageView` / `ChatInput` / `MermaidBlock` / `FileExplorer` / `FileViewer` / `FileIcons` / `ModelPicker` / `ModelsConfig` / `PluginsConfig` / `SkillsConfig` / `ExtensionStatusBar`）：**0 命中**（`MobilePwaLayout.test.mjs` 只被读来复核护栏，未改）。
- `worksplice-design-system/**`：零改动。`git status --porcelain`：只有上列 8 项（`.pi-lens.json` 已在 `.git/info/exclude` 本地忽略，未进仓库）。
- `git diff --numstat` 无整文件重写：最大一处是 `WorkspaceSidebar.tsx` **138 增 / 398 删**（净减 260 行）——属本票的交付面本身（内联样式 → 上游 class 块），不是格式化噪音。
- 交付时 `@keyframes` 组数不减（13 ≥ 12）、`@media (prefers-reduced-motion: reduce)` 保留（T-C 断言绿）。

### 交付物

- 分支：`whutlichao/ds-03-shell`（已推 origin）
- 收敛 commit：`0078429`（Status + Answer + 代码 + 测试）
- PR：**#114** —— https://github.com/whutlichao/worksplice/pull/114

### 门禁

| 门禁 | 结果 |
| --- | --- |
| `npm test` | **1173 pass / 0 fail**（基线 1161） |
| `node_modules/.bin/tsc --noEmit` | clean |
| `npm run lint` | 1 warning（`hooks/useI18n.tsx:61` `react-hooks/exhaustive-deps`，基线既有，零新增） |
| `git diff --numstat` | 无整文件重写（见红线自查） |

