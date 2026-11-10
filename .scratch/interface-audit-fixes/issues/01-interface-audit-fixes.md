# 界面评审修复：12 HIGH + 15 补充项（实施票）

Status: resolved

- 日期：2026-11-11
- 分支：`interface-audit-fixes`
- 基地：`f58aa2d`（全量基线 1665/1665）
- 正本由协调者派发；本文件记录范围与交付摘要。

## 范围（派发清单原文要点）

### A. 无障碍
- **A1 (HIGH)** composer 无可访问名 → `<textarea className="composer-input">` 补 `aria-label={t("message.composerPlaceholder")}`。
- **A2 (HIGH)** 关闭态抽屉仍可 Tab 聚焦 → 用 CSS 在 ≤900px 关闭态 `visibility: hidden`，`.ws-left-open` / `.ws-right-open` 恢复 `visible`；汉堡键补 `aria-expanded` + `aria-controls="ws-left"`，打开后焦点移入抽屉关闭键、关闭后回汉堡键，Escape/遮罩关闭；右栏 ≤900 同样处理。
- **A3 (HIGH)** 任务卡片 / 搜索命中行嵌套交互控件 → `TaskCard` 去外层 `role="button"`/`tabIndex`/`onClick`/`onKeyDown`，标题改原生 `<button className="card-title">`；`SearchHitRow` 外层同样退回 `<div>`，作者名改 `<button>`（右侧「打开」保留为兄弟）。
- **A4 (MEDIUM)** 创建频道模态分组与选中态 → `role="group"` + `aria-labelledby`，`radio-card` / 成员按钮补 `aria-pressed`。
- **A5 (MEDIUM)** 菜单与 @ 补全 ARIA → 删 `role="menu"` / `role="menuitem"`（保留 `aria-label`）；@ 弹层 `role="listbox"` + `role="option"` + `aria-selected`，textarea `aria-expanded` / `aria-controls` / `aria-activedescendant`；关闭后焦点回触发按钮。
- **A6 (MEDIUM)** 状态点语义与本地化 → `StatusDot` 接受 `label` / `translate`，输出 `presence.*` 文案；两包各加 4 键（在线/干活中/出错/离线）。

### B. 布局与排版
- **B1 (HIGH)** 频道标题窄屏被压成 0 宽 → `.chan-top` 换行、`.chan-title` 伸缩、`.chan-tools` 不收缩；频道名 `<span>` 补 `title`。
- **B2 (HIGH)** 任务板创建表单 320px 溢出 → textarea 改 `flex: "1 1 100%", minWidth: 0`；`.board-toolbar` 加换行与 row-gap。
- **B3 (HIGH)** 模态矮视口被裁 → `maxHeight: min(640px, calc(100dvh - 2*var(--sp-10)))`；`.overlay` 补 `overflow-y: auto`。
- **B4 (HIGH)** 搜索视图头被汉堡压住 → ≤900px 段补 `.search-view header { padding-left: 52px }`。
- **B5 (MEDIUM)** 旅程条 320px 断链 / 搜索结果行不换行 → 旅程条 `nowrap` + `overflowX: auto` + `scrollbarWidth: thin`；`.result .r-top` 换行 + row-gap 2px，时间改 `marginInlineStart`。
- **B6 (HIGH)** @mention 切断 Markdown 结构 → token 先换成 `[@name](#mention:<id>)`、整段只跑一次 `<MarkdownBody>`，`a` 分支识别该协议渲染成原 `.mention` 按钮；协议选择理由见 Answer。

### C. 颜色
- **C1 (HIGH)** 字段边界对比度 → `--border-strong` 78% → 63%；`.search-btn` 边框改 `--border-strong`。
- **C2 (HIGH)** 开关关闭态不可见 → 轨道 `--border-strong`、滑块 `--surface`。
- **C3 (MEDIUM)** `border` 当状态填充 + 色板外裸色 → ModelsConfig 未连接用 `--offline`；`.seg button.is-active` 文字改 `--surface`；删 `.msg-text pre` 三条冷蓝规则；`saved-pop` keyframes 改从 `--online-fill` 派生。
- **C4 (HIGH)** 旅程条当前步边框 → `--accent` → `--accent-graphic`。

### D. 文案
- **D1 (HIGH)** 提醒行双花括号 → 单层 `{channel}` / `{seq}` / `{count}`。
- **D2 (HIGH)** 发送被拦截文案 → `summarizeChanges` 走中文模板（`summarizeChangesTemplates`）；`message.held` 改「发送被拦截——房间已变化，请重新发送」。
- **D3 (HIGH)** 任务「取消」既放弃表单又终止任务 → `tasks.close` 改「关闭任务」/「Close task」，关闭动作 `btn-danger` + `TaskViews` 层共享 `BrutalModal` 确认。
- **D4 (HIGH)** 危险确认按钮复述对象 → `agent.confirmDeleteAction` / `confirmSessionResetAction` / `confirmFullResetAction`；`agent.confirmDelete` 补「此操作不可撤销。」。
- **D5 (MEDIUM)** `tasks.complete` 实际进入待审 → 「提交待审」/「Submit for review」。
- **D6 (MEDIUM)** 空态不给下一步 → 新增 `messages.selectChannelHint` / `messages.emptyDMHint`，无消费者的 `messages.emptyHint` 删除。
- **D7 (MEDIUM)** 术语冲突 → zh-CN 不再混用 channel / thread；`tasks.asTask` 与 `tasks.convert` 统一「转为任务」。

### E. UI 细节
- **E1 (MEDIUM)** 两处静止阴影 → 旅程引导卡与 `EmptyState` 的 glyph 方块删除 `--shadow-card`。
- **E2 (LOW)** 触屏 hover 粘住 → `.ws-message-row:hover` / `.card:hover` 包进 `@media (hover: hover)`，`.msg:hover` 在 `hover: none` 下退回无底色。
- **E3 (LOW)** `.kv` 长 id 右对齐断行 → 新增 `.kv.stack`，工作区与会话文件行改用。

### F. 补充项
- 频道创建失败兜底走 `t("channel.createFailed")`（两包新增）。
- 当前频道行补 `aria-current="page"`。

## Answer

### 落地情况

派发清单的 12 项 HIGH + 15 项补充项全部落地。分条摘要：

| 条目 | 落地 | 关键位置 |
|---|---|---|
| A1 | composer `aria-label` 取 `message.composerPlaceholder` | `ChannelView.tsx` Composer |
| A2 | ≤900px 关闭态 `visibility: hidden`（CSS 方案，**未用 `inert`**）；`#ws-left` / `#ws-right`；汉堡键 `aria-expanded` + `aria-controls`；打开后焦点进 `.ws-sidebar-close`、关闭回汉堡键；两栏根 `onKeyDown` 处理 Escape | `app/globals.css` 900 段 + `AppShell.tsx` |
| A3 | `TaskCard` 去外层 `role`/`tabIndex`/`onClick`/`onKeyDown`，标题改原生 `<button className="card-title">`；`SearchHitRow` 外层退回 `<div>`，作者名成 `<button>` | `ChannelView.tsx` / `SearchView.tsx` |
| A4 | 类型与成员两组补 `role="group"` + `aria-labelledby`，`radio-card` / `member-opt` 补 `aria-pressed` | `CreateChannelModal.tsx` |
| A5 | 删 `role="menu"` / `role="menuitem"`，容器改 `role="group"` + 保留 `aria-label`；@ 弹层 `role="listbox"` / `option` / `aria-selected` + textarea `role="combobox"` / `aria-expanded` / `aria-controls` / `aria-activedescendant`；`···` 与表情弹层关闭后焦点回触发器 | `ChannelView.tsx` |
| A6 | `StatusDot` 接受 `label` / `translate`，输出 `presence.*`；两包各加 4 键；5 处调用点透传 `t` | `StatusDot.tsx` + 5 个消费点 |
| B1 | `.chan-top` 换行 + `.chan-title` 伸缩 + `.chan-tools` 不收缩（同选择器覆盖行，上游条逐字保留）；频道名补 `title` | `app/globals.css` + `ChannelView.tsx` |
| B2 | textarea 改 `flex: "1 1 100%", minWidth: 0`；`.board-toolbar` 换行 + row-gap | `ChannelView.tsx` / `app/globals.css` |
| B3 | `maxHeight: min(640px, calc(100dvh - 2 * var(--sp-10)))`；`.overlay` 补 `overflow-y: auto` | `BrutalModal.tsx` / `app/globals.css` |
| B4 | ≤900px 段 `.search-view header { padding-left: 52px !important }` | `app/globals.css` |
| B5 | 旅程条 `nowrap` + `overflowX: auto` + `scrollbarWidth: thin`；`.result .r-top` 换行 + row-gap 2px；时间改 `marginInlineStart` | `ChannelView.tsx` / `app/globals.css` / `SearchView.tsx` |
| B6 | token → `[@name](#mention:<id>)`，整段一次 `MarkdownBody`；`a` 分支识别协议渲染原 `.mention` 按钮 | `MentionText.tsx` / `MarkdownBody.tsx` |
| C1 | `--border-strong: oklch(63% 0.020 86)`；`contrast.test.mjs` PAPER 表同步；`.search-btn` 改 `--border-strong` | 设计系统 + 测试 |
| C2 | 轨道 `--border-strong`、滑块 `--surface` | `SkillsConfig.tsx` |
| C3 | 模型未连接改 `--offline`；`.seg button.is-active` 文字改 `--surface`；删 `.msg-text pre` 三条冷蓝规则；`saved-pop` 改从 `--online-fill` 派生（keyframes 仍 12+） | `ModelsConfig.tsx` / `app/globals.css` |
| C4 | 旅程条当前步边框改 `--accent-graphic` | `ChannelView.tsx` |
| D1 | 三个提醒键改单层占位符；`MyRemindersModal.test.mjs` 注释与断言同步 | 两包 + 测试 |
| D2 | `summarizeChanges` 改参数化模板（缺省中文），`message.held` 两包同步 | `lib/domain/collab/messages.ts` |
| D3 | `tasks.close` → 「关闭任务」/「Close task」；关闭动作 `btn-danger` + `TaskViews` 层共享 `BrutalModal` 确认（新键 `tasks.closeConfirm`） | `ChannelView.tsx` + 两包 |
| D4 | 三个 `agent.confirm*Action` 键；`agent.confirmDelete` 补「此操作不可撤销。」 | `AgentDetailPanel.tsx` + 两包 |
| D5 | `tasks.complete` → 「提交待审」/「Submit for review」 | 两包 |
| D6 | 新增 `messages.selectChannelHint` / `messages.emptyDMHint`；无消费者的 `messages.emptyHint` 删除 | 两包 + `ChannelView.tsx` |
| D7 | zh-CN 的 `channel` / `thread` 混用清零（`mute.none` / `journey.handoff.hint`）；`tasks.asTask` 与 `tasks.convert` 统一「转为任务」 | 两包 |
| E1 | 旅程引导卡与 `EmptyState` glyph 方块删 `--shadow-card` | `ChannelView.tsx` |
| E2 | `.ws-message-row:hover` / `.card:hover` 包 `@media (hover: hover)`；`.msg:hover` 在 `hover: none` 下退回无底色 | `app/globals.css` |
| E3 | 新增 `.kv.stack`；工作区与会话文件行改 `className="kv stack"` | `app/globals.css` + `AgentDetailPanel.tsx` |
| F | 建频道失败兜底走 `t("channel.createFailed")`；频道行补 `aria-current="page"` | `CreateChannelModal.tsx` / `WorkspaceSidebar.tsx` |

### 与派发清单的偏离（5 处）

1. **A2 用 CSS，不用 `inert`。** 派发清单允许二选一且**优先 CSS**。`inert` 的问题在于它没有视口条件：桌面宽度下两栏常驻可见，加 `inert` 会把桌面控件一并禁用。落地：≤900px 关闭态 `visibility: hidden`（`transition ... visibility 0s linear var(--dur-drawer)` 让它在滑出动画结束后才生效），`.ws-left-open` / `.ws-right-open` 立即 `visible`。焦点可达性已在 320px 实测（打开后 activeElement = `.ws-sidebar-close`，Escape 后 = `.ws-mobile-toggle`）。右栏关闭时整个元素从 DOM 卸载（`resolvablePanel` 为 null），因此关闭态不存在可 Tab 的离屏控件。

2. **B6 协议选 `#mention:<id>`，不是 `mention://`。** 实测 `rehype-sanitize` 的默认 allowlist 会把未知 scheme 的 `href` 清成空串（渲染成 `<a href="">`），mention 按钮会退化成普通链接；`#` 片段标识符本就在 allowlist 内，且 `resolveLocalFileHref` 第一步就按 `#` 切掉 fragment，文件链接链路无需改动。`data:` 也能通过 allowlist，但它会与「本地文件 href」的语义混淆，故未选。

3. **D2 的 `summarizeChanges` 保持英文，本地化改在界面层。** 派发清单要求「改为走 i18n 或直接返回中文摘要」。落地时发现该函数的返回值经 `whatHappened` 进 **agent 的 revise prompt**（`lib/agent-loop/loop.ts:562`、`member-ops.ts:534`），按 `docs/i18n.md` 的分层规则属于「产品内容」——必须英文硬编码、不做服务端 locale 感知。若照字面中文化，中文会漏进模型上下文与英文界面。处置：领域层保持英文（加注释说明归属），界面侧新增 `message.heldNoticeAction`（两包）承担本地化，`NoticeToast` 的 held 槽只显示这条 UI 文案，不再贴英文摘要；`hooks/useChannelData.ts` 的 task 槽 notice 同改。**净效果满足清单意图**（用户看到的不再是英文长句），但实现位置与清单字面不同。

4. **A3 的标题按钮用 `fontFamily: "inherit"` 而非 `font: "inherit"`。** 派发清单给的样式里有 `font: "inherit"`，但 `font` 是简写属性，会连带把 `.card-title` 的 12.5px / semi 字重重置成卡片默认值（内联优先于 class），是形态回归。改为只继承字族并保留 `color: "inherit"`；`SearchView` 的作者名按钮同理（`fontFamily` + `fontSize` + 显式 `fontWeight`）。320/1440 实测字重与字号与改造前一致。

5. **B6 的量化验收口径调整。** 派发清单写「字面 `**` 从 53 条降到 0、丢 `<li>` 从 13 条降到 0」。按真实库（`~/.worksplice/worksplice.db`，558 条消息、334 条含 mention）复测：旧实现 **80** 条、新实现 **30** 条、丢 `<li>` 1 → **0**。剩下的 30 条与「不含 mention 的普通消息」基线是同一批源文本问题（全角引号包裹的 `**`、行内代码里的 `**`、源里本就奇数个 `**`）——即由 mention 切割造成的额外破坏归零，但「降到绝对 0」需要改 Markdown 解析器，超出本票范围。

### 同步更新的既有断言（因契约变更，逐条点名）

- `app/globals.test.mjs` T-D：`StatusDot` 渲染需包 `I18nProvider`（A6 让它消费 i18n）。
- `components/task-board.test.mjs`：`.seg button.is-active` 从「逐字搬自上游」清单剔除（C3 把唯一一个色板外色相换成 `--surface`）；`blockBody` 取首处声明，覆盖行由新增用例单独守。
- `components/message-stream.test.mjs`：逐字清单注释补充「覆盖行在后声明」的说明（`.chan-top` / `.chan-title` / `.chan-tools` 仍逐字比对首处声明）。
- `components/AppShell.test.mjs`：`.search-btn` 边框断言改 `--border-strong`（C1）。
- `components/dock.test.mjs`：`.kv` 行断言改 `.kv stack`（E3，fixture 里的工作区行）。
- `components/ChannelView.test.mjs`：`···` 菜单的 `role="menu"` / `role="menuitem"` 断言改为反向（A5）+ 数量改按 `.msg-more-menu-item` 计；`aria-haspopup="menu"` 断言改为「不声明 haspopup + 只声明 aria-expanded」。
- `components/MyRemindersModal.test.mjs`：D1 注释与「无 `{{` / `#{`」断言。

### 定量证据

- `npx tsc --noEmit`：0 error。
- `npm run lint`：0 error（1 条既有 warning 在 `hooks/useI18n.tsx:61`，非本票引入）。
- 窄档 12 个测试文件：**229/229**。
- 全量 `npm test`（剔除 `BASH_ENV` 等 5 个变量）：**1695/1695**（base 1665 + 新增 30）。
- 对比度（Playwright canvas 采样 computed color）：`--border-strong` vs `--surface` **3.43**、vs `--bg` **3.29**、vs `--panel` **3.07**；开关关闭态轨道 vs `--bg` **3.29**、滑块 vs 轨道 **3.43**；旅程条当前步边框 vs `--surface` **3.65**、vs 淡底 **3.32**。
- 布局实测：320px 频道名 27px / 长名 121px 且带 `title`；搜索标题与汉堡间隙 **+10px**（修复前 −22px）；任务工具条 5 控件全在视口内且无横向溢出；640×400 模态滚到底后「创建频道」按钮 `bottom: 383 ≤ 400`；「我的提醒」渲染 `在 ##all`，无 `{{` / `#{`。
- 截图：`/tmp/ws-interface-fixes/after/`；证据汇总：`/tmp/ws-interface-fixes/evidence.md`。

### 双轴 code-review（Standards + Spec，各一个独立 sub-agent）

**Standards 轴** findings 与处置（全部已落地，见 commit `a2b986b`）：

| finding | 处置 |
|---|---|
| `summarizeChanges` 缺省中文，但该文本进模型上下文（`docs/i18n.md`：产品内容英文硬编码） | **已修**：恢复英文；界面侧新增 `message.heldNoticeAction` 承担本地化，`NoticeToast` 不再贴 `whatHappened` |
| `StatusDot` 的中文 fallback 硬编码、无断言守同步 | **已修**：兜底改取 en 包文案（`translateMessage`），不硬编码任何语言 |
| `presence.*` 与 `status.*` 同一四态两套措辞（「干活中」vs「正在干活」） | **已修**：措辞对齐 |
| `docs/spec.md` / `DESIGN.md` 仍写 `--border-strong: 78%` | **已修**：同步为 63% |
| 三处 `:hover` 两种机制（`hover: hover` 与反向 `hover: none`） | **已修**：统一 `hover: hover` |
| `summarizeChanges` 手写 `{count}` 替换、重复插值职责 | **已修**：随中文化回退一并消失 |
| `summarizeChangesTemplates.en` 无调用方 | **已修**：整块删除 |
| `StatusDot` 的 `label` prop 无调用点 | **已修**：删除 |
| `onRequestClose` 三层透传 + 缺省 fallback 仍直接关闭（给跳过确认留后门） | **已修**：三层都改必填 |
| `task-board.test.mjs` 自制第三套规则体解析器 | **已修**：复用 `lastBlockBody` |
| `MentionText.test.mjs` 用例名说「点击回调」但从未触发点击 | **已修**：拆成「形态」与「token→memberId 映射」两条 |
| `.msg-text pre`「无渲染点」的注释理由不实 | **已修**：改为「被 react-syntax-highlighter 的行内样式覆盖，实际不生效」 |

**Spec 轴** findings 与处置：

| finding | 处置 |
|---|---|
| D2 的 `summarizeChanges` 未按字面中文化 | **不改**：该文本进模型上下文，属 `docs/i18n.md` 的「产品内容」层，必须英文；本地化改在界面层（新增 `message.heldNoticeAction`）。理由与净效果见「与派发清单的偏离」第 3 条 |
| B6 未达「字面 `**` 归零」 | **不改（口径已说明）**：增量归零（80 → 30，30 == 无 mention 基线），绝对 0 需改 Markdown 解析器，超出本票。见偏离第 5 条 |
| C3 只改了 OAuth 的未连接点，`provider.configured` 状态点仍用 `--border` 当填充 | **已修**：同文件第二处改 `var(--offline)` |
| A5 的 `ContextMenu` 关闭后无焦点归位、且删角色后无可访问名 | **已修**：容器补 `role="group"` + `aria-label`（右键菜单没有「触发按钮」，焦点归位无对象；命名是不悬空的最小处置） |
| A5 的 `aria-activedescendant` 在无候选时指向不存在的 option | **已修**：加 `atMatches.length > 0` 条件 |
| A5 的 `MessageMoreMenu` 新增 `role="group"` 属 scope creep | **保留**：删掉 `role="menu"` 后 `aria-label` 在裸 `div` 上不进 AX 树，`group` 是让清单要求的「保留 `aria-label`」真正生效的最小代价 |
| A2 左栏桌面端无 `inert` 兜底 | **不改**：CSS 方案按清单优先级选取，且 `inert` 在桌面会误禁常驻栏 |
| B6 的 base 计数与清单的 53/13 不一致 | **说明**：清单的 53/13 是估算口径；本票按真实库逐条复测（旧实现 80/1）。两者都以「新实现 == 无 mention 基线」为判据 |

