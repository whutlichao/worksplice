# 实施票 02：收掉界面评审残留的 3 项 HIGH（模态焦点 / 消息动作栏键盘可达 / 看板窄屏堆叠）

Status: resolved

- 日期：2026-11-11
- 分支：`interface-audit-fixes-residual`
- 基地：`ecbd287`（`main`，含 PR #212；全量基线 1698/1698）
- 范围来源：上一票（`.scratch/interface-audit-fixes/issues/01-interface-audit-fixes.md`）
  漏掉的 3 项——评审报告里有，但上一张 spec 未列成条目。

## 范围

### R1 (HIGH) 模态打开后焦点不移入、背景不设防

`components/BrutalModal.tsx` 原先只有一个 `Escape` keydown 监听：`role="dialog"` /
`aria-modal="true"` 写了，但打开后焦点不进模态、关闭后不回触发按钮、背景仍可 Tab。

范围核对：派发文字把「模型配置 / 技能配置 / 项目信任」也列进 `BrutalModal` 的复用清单，
与代码不符——`ModelsConfig` / `SkillsConfig` 是独立的 `position: fixed` 浮层（无
`role="dialog"` / `aria-modal`、无 Esc、无焦点陷阱），`ProjectTrustDialog` 有 dialog 语义
但全仓没有渲染点。本票只修真正的 `BrutalModal` 消费方（创建频道 / 创建 agent / 提醒 /
我的提醒 / 任务关闭确认 / 描述编辑 / 危险操作确认）；上面三者的无障碍缺口不属于
「`BrutalModal` 复用点」，未在本票扩张（见 Answer 的偏离记录）。

### R2 (HIGH) 消息动作栏纯指针可达

`app/globals.css` 的 `.ws-message-actions { display: none; }` + hover 揭示，配合
`.msg:focus-within` 的补救规则——后者**永远不会生效**：`display: none` 的后代不在 Tab
序里，行内没有任何元素能触发 `:focus-within`。整条动作栏（回复 / 引用 / 复制链接 /
表情 / 置顶 / 提醒 / 转为任务 / `···`）键盘用户够不到。

### R3 (HIGH) 看板在 ≤900px 不堆叠成单列

`.board-cols` 横向排、`.col` 固定 236px，全文件没有媒体查询覆盖；设计系统
`worksplice-design-system/SKILL.md §3.5` 要求 ≤900px "board stacks to a single
full-width column"。实测 500px 视口下 5 列里 3 列落在视口外。

## Answer

### 落地情况

| 条目 | 落地 | 关键位置 |
|---|---|---|
| R1 | 焦点陷阱：打开移入模态（`.modal-head` 关闭键）、Tab/Shift+Tab 边界回绕、关闭归还 opener；子浮层（portal `role=dialog`）在场时让路 | `components/BrutalModal.tsx` / `lib/modal-focus.ts` |
| R2 | 消息行 `tabIndex=0` + `role="article"` + i18n 名称（`message.rowLabel`）；揭示钩子 = 行根 `:focus-visible` + 带否定的 `:focus-within`；动作完成后焦点留在行上 | `components/ChannelView.tsx` / `app/globals.css` / 两套语言包 |
| R3 | ≤900px 段：`.board-cols` 纵向 + `height: auto` + `min-width: 0`、`.col` 满宽 + `flex-basis: auto`（前两条逐字取上游 app.css 的 ≤900 段，本仓当初漏搬）、`.board.is-board` 纵向滚动 | `app/globals.css` |

### 红绿节奏

每项都是先红后绿，同一命令两次跑。

**R1（规则层 + 组件层两半）**

- 先红 ①（判定层）：`node --test lib/modal-focus.test.mjs`
  → `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../lib/modal-focus.ts'`，
  `fail 1`（1 条文件级失败）。
- 先红 ②（组件层，用 `git show ecbd287:components/BrutalModal.tsx` 临时还原 base 再跑）：
  `node --test components/BrutalModal.test.mjs`
  → 3 条失败：`R1: 对话框本身可承接兜底焦点`（base 无 `tabindex="-1"`）、
  `R1: 打开时移入焦点、Tab 边界回绕、关闭时归还 opener`（无 `collectTabbables` /
  `nextTabTarget` / `opener.focus()`）、`R1: 子浮层…父模态让路`（无 `focusInChildDialog`）。
  还原 workflow：`git show ecbd287:... > components/BrutalModal.tsx` → 跑 → `cp` 回原位。
- 转绿：`node --test lib/modal-focus.test.mjs` → **13/13**；
  `node --test components/BrutalModal.test.mjs` → **12/12**。

**R2**

- 先红：`node --test components/message-stream.test.mjs`
  → `✖ R2: 消息行是键盘停靠点…`（根元素无 `tabindex` / `role` / `aria-label`）、
  `✖ R2: 行首获得焦点时揭示整条动作栏…`（缺揭示规则）；`pass 17 / fail 2`。
- 转绿：同一命令 → **19/19**（后续又补了「动作完成后焦点留在行根」与 i18n 键同步两条，现为 20/20 与 8/8）。

**R3**

- 先红：`node --test components/task-board.test.mjs`
  → `✖ R3：≤900px 看板堆叠成单列…`、`✖ R3：堆叠态下纵向滚动归 .board…`；
  `pass 22 / fail 2`。
- 转绿：同一命令 → **24/24**。

### Review（双轴自审）

**Standards 轴**

- **CSS 分层**：新增规则全部落在既有 class 块的扩展层，不复制上游同名规则的形态值；
  逐字搬运清单（`task-board.test.mjs` 的 `blockBody` 首处声明口径）保持全绿。
- **组件分派**：R1 的实现放在 `BrutalModal` 外壳（7 处调用点共享），没有逐调用点重写；
  纯判定逻辑抽到 `lib/modal-focus.ts`（与 `lib/tool-path-guard.ts` / `lib/journey-state.ts`
  同款的「判定层纯函数 + 消费层挂载」分法），DOM 读取与规则判定分开。
- **i18n 分层**：新增的 `message.rowLabel` 是浏览器可见的 `aria-label`，按 `docs/i18n.md`
  走两套语言包；中文文案不含 `channel` / `thread`（`D7` 守卫仍绿）。
- **术语**：`aria-label` 用「发言 / Message #N by author」而不是新造实体名，未与
  `CONTEXT.md` 现有术语冲突。
- **判断项（已记录，不改）**：`MessageRow` 的 `role="article"` 给每条消息一个地标式语义。
  这是让行成为可聚焦容器时的最小合法语义（`role="button"` 会与行内真实按钮嵌套，
  重复 A3 修过的错误）；代价是读屏的 landmark 列表会变长，接受。
- **判断项（已记录，不改）**：`lib/modal-focus.ts` 的 `isTabbable` 对 `radio` 组按
  「每个 radio 都算一个停靠点」保守处理（浏览器对同名 radio 组只留一个 Tab 停靠点）。
  BrutalModal 的子树里没有 radio 组；为这条浏览器细节加分支属于投机泛化（YAGNI）。

**Spec 轴**（逐条对回派发语句）

| 验收语句 | 结论 |
|---|---|
| R1 打开任一模态后 `document.activeElement` 是模态内元素 | ✅ 实测（见下） |
| R1 连续 Tab 不把焦点送出模态（含 Shift+Tab） | ✅ 实测：30 步正反向均 0 次外溢 |
| R1 Escape / 关闭键关闭后 `activeElement` 是打开它的按钮 | ✅ 实测：均为「新建频道」按钮 |
| R1 模态内 `createPortal` 的选择器仍可聚焦与点选 | ✅ 实测 `DirectoryPicker` 可 Tab 进、可点进目录、可选当前目录 |
| R2 纯键盘到达并操作动作栏每个按钮 | ✅ 实测按钮清单见下 |
| R2 未聚焦未 hover 时行高与基线逐像素一致 | ✅ 同 DOM 对照，21 行高度逐一相同 |
| R2 hover 揭示与二级条展开手感不变 | ✅ 实测：hover 只揭示被悬停那一行；`···` 菜单四项可达并打开二级条 |
| R2 触屏（`hover: none`）下不出现「看不见但可点」 | ✅ 实测：21 行隐藏态下 0 个不可见但可点元素（机制见「偏离 2」） |
| R3 500px / 360px 下 5 列全在视口内、无横向裁切、列宽 = 容器宽 | ✅ 实测见下 |
| R3 1440px 下 `.col` 仍 236px 固定宽、横向滚动、不拉伸 | ✅ 实测见下 |
| R3 堆叠态下跨列拖放仍可用 | ✅ 实测（500px 堆叠态、真实指针）：`#4` 从「待审」拖到「完成」，服务端确认后列分布刷新 |
| 既有不变量不破 | ✅ 窄档 462/462；全量 1723/1723（基线 1698 + 新增 25）；tsc 0 error；lint 0 error（1 条既有 warning） |

**与派发清单的偏离（3 处）**

1. **R3 的 `@media (max-width: 900px)` 声明位置**：派发写「在既有 900 段补」。实际
   声明放在任务板 class 块的逐字搬运行**之后**（仍是 `max-width: 900px` 断点层）。
   理由：本仓的逐字搬运断言（`task-board.test.mjs` / `message-stream.test.mjs`）用
   `blockBody` 取**文件内第一个**同名规则体作为「上游形态」判据，不区分是否在 `@media` 里。
   把覆盖行放进骨架段的 900 块会让它排在 236px 定宽与 `min-width: min-content` 之前，
   直接打红那批断言——而派发同时要求「现有不变量不许破」。同选择器后声明正是本仓窄屏
   覆盖的既有手法（`.board-toolbar` / `.chan-top`）。断点语义与结果一致。

2. **R2 的揭示选择器最终是 `:focus-visible` + 带否定的 `:focus-within` 两条**，不是单一条
   `:focus`（派发选项 1 的字面写法）。理由（实测得出，不是推断）：
   - 裸 `:focus` 会让**鼠标点进正文**（选文字、点内联 mention）也把动作栏点成常显——
     指针手感变了，违反「hover 揭示手感不变」。
   - `:focus-visible` 单独用**不够**：行根获得键盘焦点时动作栏确实展开（实测
     `display: flex`），但下一次 Tab 把焦点移到行内第一个控件（reaction chip）时，
     行自身的 `:focus-visible` 在**浏览器遍历 Tab 序之前**就已失效，`display` 回到
     `none`，动作栏整条被跳过——最小复现（`about:blank` 注入同构 DOM）：
     `:focus-visible` 单独用 → `["BODY","after1","BODY"]`；`:focus-within` → `["a1","a2","after1"]`。
   - 但裸 `:focus-within` 又回到「鼠标点住」：实测点行正文或**点行内 chip** 后指针移开，
     动作栏仍是 `display: flex`。因此给它加**两重**否定：
     `:not(:focus:not(:focus-visible))`（行根是鼠标聚焦的）+ 
     `:not(:has(:focus:not(:focus-visible)))`（焦点在行内某个鼠标聚焦的控件）。
     键盘进入时两条都不成立。三种路径最终实测：
     键盘行根 → `[在线程中回复][引用][复制链接][更多消息操作]`；
     鼠标点正文后移开指针 → `display: none`（`rowFocused: true, focusVisible: false`）；
     鼠标点行内 reaction chip 后移开指针 → `display: none`（`focusWithin: true` 但两条否定都成立）；
     hover → `flex`。闸门仍是 `display: none`，未聚焦未 hover 时零变化。

3. **R2 的 「触屏 `hover: none`」实证方式**：ego-browser 的 Chromium 拒绝
   `Emulation.setEmulatedMedia` 对 `hover` / `pointer` 的覆盖（实测覆盖后
   `matchMedia("(hover: none)").matches` 仍为 `false`）。改用等价更强的判据：
   在桌面环境量 21 行**未聚焦未 hover** 状态下每个可点击元素的 computed
   `display` / `opacity` / `visibility` / `getClientRects()`——「看不见但可点」
   需要 `display ≠ none ∧ 有布局盒 ∧ opacity: 0 ∨ visibility: hidden ∧ pointer-events ≠ none`，
   实测命中 **0** 个。同时核对 `app/globals.test.mjs` 的 E2 断言：`.ws-message-row:hover`
   与 `.msg:hover` 都包在 `@media (hover: hover)` 里，触屏不会「粘住」；而键盘入口
   在触屏上不会触发（无键盘 Tab），`:focus-visible` 也不成立，揭示面不出现。

**Spec 轴**（独立 sub-agent，逐条对回派发语句）复核后的处置：

| finding | 处置 |
|---|---|
| 派发把 `ModelsConfig` / `SkillsConfig` / `ProjectTrustDialog` 列进 `BrutalModal` 复用清单，实际都不是 | **不改（已记录）**：三者不走 `BrutalModal`，属独立缺口；见「偏离 5」 |
| `DirectoryPicker` 只挂在 `AgentDetailPanel` 旁、不在任何 `BrutalModal` 子树内 | **不改（口径已说明）**：「模态内 portal 选择器」在现有调用关系里不存在；改为「父模态 + 注入的顶层 `role=dialog`」实测让路语义（见下） |
| 陷阱把 `document.activeElement`（无焦点时是 `body`）直接传入，`active === null` 分支不可达 | **已修**：`dialog.contains(activeElement) ? activeElement : null` —— 背景有焦点时按方向拉回模态边界 |
| effect 依赖 `[onClose]`，父级重渲染会让初始移焦重跑、把焦点从 portal / BODY 抢回关闭键 | **已修**：`initialFocusDoneRef` 只做一次 |
| R2 的 `:not(:focus:not(:focus-visible))` 只看行根；鼠标点行内 chip / mention 时动作栏仍「点住常显」 | **已修**：加第二重 `:not(:has(:focus:not(:focus-visible)))`；实测点 chip → 移开指针 → `display: none` |
| 新测试多为源码正则；R3 拖放证据是合成 `DragEvent` | **部分改**：`BrutalModal.test.mjs` 的组件层断言收窄到「是否接上 `lib/modal-focus`」这一条接缝，行为改由 13 条规则单测 + 浏览器实测；拖放改用 ego-browser 的高层 `dragAndDrop()`（真实指针）重测，见下 |
| `ChannelView.test` / `DetailPanel.test` 去掉 `^` 锚点属削弱断言 | **已修**：收紧为「作者名 → `#seq` → 时间戳」三者相邻的正则，比原断言更严 |

### 实测读数

**R1 · activeElement 序列**（隔离实例：`WORKSPLICE_DATA_DIR=/tmp/ws-r02/data`，端口 30143）

| 动作 | 序列 |
|---|---|
| 点「新建频道」（子内容有 `autoFocus` 输入框） | `BODY` → open → `INPUT.input`（模态内） |
| 该模态内连续 Tab ×25 | 全部在 `.modal` 内：`radio-card 公开 → radio-card 私有 → textarea → member-opt×6 → btn 取消 → icon-btn 关闭 → INPUT → …`，出界 **0** 次 |
| 该模态内 Shift+Tab ×25 | 反向同样成环，出界 **0** 次 |
| Escape 关闭 | `document.activeElement` = `BUTTON.btn.btn-primary`，`textContent` = 「新建频道」（即 opener） |
| 关闭键关闭 | 同上，opener 命中 |
| 点「我的提醒」（无 autoFocus 子内容） | open → `BUTTON.icon-btn[aria-label="关闭"]`（`.modal-head` 内） |
| 该模态内 Tab ×24 / Shift+Tab ×24 | 关闭键 + 9 个行内按钮成环，出界 **0** 次 |
| `DirectoryPicker`（`createPortal` 到 body） | 打开后 `activeElement` = `INPUT.directory-picker-path`，`backdrop.parentElement === document.body`；Tab ×4 全部在 picker 内（→ 子目录 → 取消 → 选择此文件夹）；点目录条目 `path` 从 `/Users/apple` 变 `/Users/apple/.adal`；点「选择此文件夹」picker 关闭 |
| 父模态 + 注入的顶层 `role=dialog`（模拟 portal 子浮层） | Tab 不被拉回 `.modal`（`portal-btn-1 → portal-btn-2`）；Escape 后父模态仍开着、子 dialog 收到 Escape |

**R2 · 键盘到达的动作栏按钮清单**（频道 `stream-sync`，21 行；起点 = 首行行根，全程不碰鼠标）

从行根 Tab 后的完整序列（节选，`[BAR]` = 焦点在 `.ws-message-actions` 内）：

```
BUTTON:👍3
BUTTON:在线程中回复 [BAR]
BUTTON:引用 [BAR]
BUTTON:复制链接 [BAR]
BUTTON:更多消息操作 [BAR]
DIV:Nova 在 #2 的发言 [ROW]
BUTTON:在线程中回复 [BAR]
…（后续每行同构）
```

`···` 二级菜单（键盘）：`Enter` 打开 → 焦点落在第一项「添加回应」→ 四项
`添加回应 / 置顶到频道 / 给这条消息设置提醒 / 转为任务` 全部在 `.msg-more-menu-item` 内
（`focusedInMenu: true`）→ 再 `Enter` 打开二级 reaction 条：`actionsDisplay: flex`、
`toolsOpacity: 1`、`ws-message-actions-open` 类命中，聚焦回到 `···` 触发器（A5 的归还语义不变）。

覆盖到的按钮：回复（在线程中回复）/ 引用 / 复制链接 / `···` / 二级条里的表情选择与
「添加回应」。`ws-message-actions-dismissed` 的完成动作收起语义未改（既有
`scripts/verify-message-actions-dismissal.ego.mjs` 的断言对象仍是同一条 CSS 链）。

**R2 · 动作完成后的焦点归属**（键盘实测）：行根聚焦 → Tab 两次到「在线程中回复」→
`Enter` → 行获得 `ws-message-actions-dismissed`、动作栏 `display: none`、
`document.activeElement` 仍是**行根**（`aria-label="Marlow 在 #1 的发言"`）→ 再 Tab 落到
下一条消息的行根，继续 Tab 就进它的动作栏。若不做这一步，被按的按钮随动作栏下线，
焦点跌到 `BODY`，键盘用户丢失位置（鼠标用户看不出来）。鼠标路径不受影响：焦点本来就不在
行内时 `rowRef.current?.contains(active)` 为假，不抢焦点。

**R2 · 鼠标路径手感**（同一个隔离实例，指针真实移动）：

| 操作 | 结果 |
|---|---|
| 指针移到某行正文 | 该行动作栏 `flex`，其余 20 行仍 `none`（只揭示被悬停那一行） |
| 指针点进正文后移开 | `rowFocused: true`、`focusVisible: false`、动作栏 `display: none`（行获得焦点但**不**把动作栏点住） |
| 点动作栏「引用」并移开指针再回来 | `dismissed` 复位、动作栏 `flex`（既有 hover 复位语义不变） |

**R2 · 线程面板复用**（`ThreadPanel` 的锚点与回复行用的是同一个 `MessageRow`）：
右栏 3 行全部带 `tabindex="0"`，从行根 Tab 依次命中该行收窄后的动作栏（`引用 / 复制链接 /
更多消息操作`，仍无 `Reply` / `Pin`——收窄取舍未动）。

**R2 · 行高对照**（21 行，未聚焦未 hover）

| | 行高序列 |
|---|---|
| 改后（键盘入口 + 揭示规则在位） | 141.03, 161.47, 117.28, 161.47, 164.13, 208.56, 115.28, 185.47, 187.22, 138.38, 171.38, 148.28, 115.28, 194.47, 194.47, 194.47, 194.47, 171.38, 148.28, 148.28, 171.38 |
| 同一 DOM 上摘掉 `tabindex`/`role`/`aria-label` + 用 `display: none !important` 覆盖回改动前的揭示 | 逐项**完全相同**（`sameHeights: true`，`sameTops: true`，`.stream` 的 `scrollHeight` 两态均为 3975） |

同 DOM 对照而不是跨构建对照，是为了排除 dev server 热重载与字体加载的抖动；`.stream`
滚动高度也一致，说明总占位零变化。hover 实测：指针移到某行正文时**只有该行**的
`ws-message-actions` 变 `flex`，移开后计数回到 0。

**R3 · scrollWidth / clientWidth 与列宽**（真实浏览器，CDP 设备度量覆盖）

| 视口 | `.board` scrollWidth / clientWidth | 5 列宽度 | 5 列 top | 结论 |
|---|---|---|---|---|
| 500px | 491 / 491 | 459×5 | 206.3 / 305.5 / 803.3 / 1115 / 1426.8 | 无横向裁切；列宽 = `.board-cols` 容器宽 459 |
| 360px | 351 / 351 | 319×5 | 292 / 391.3 / 906.5 / 1218.3 / 1530 | 同上（容器 319）；`.board` 滚到底后第 5 列完整落在视口内 |
| 900px | 891 / 891 | 859×5 | 187.5 / 286.8 / 718.5 / 997.3 / 1276 | 堆叠生效（`flex-direction: column`） |
| 901px | 1260 / 309 | 236×5 | 全部 292 | 桌面形态（`row`，横向可滚）——断点精确切在 900 |
| 1440px | 1260 / 808 | 236×5（全部） | 全部 187.5 | 横向可滚（`scrollWidth > clientWidth`），列宽等于 `--board-col-w`，不拉伸 |

拖放（堆叠态，500px 视口、**真实指针**）：ego-browser 的高层
`page.dragAndDrop(card, col-body)` 把「待审」列的 `#4` 拖到「完成」列，服务端确认后
`GET /api/channels/<id>/tasks` 与列分布同步刷新为「完成 [#4,#7,#9]」。堆叠布局下
HTML5 DnD 未被破坏，不需要替代路径。（首轮用的是合成 `DragEvent`，Spec 轴指出不可复现，
已改为真实指针拖拽重测。）

### 偏离与判断记录

1. R2 的揭示选择器是「行根 `:focus-visible` + 两重否定的 `:focus-within`」两条（见上「偏离 2」）。
2. R2 的触屏实证改用等价的可点性判据（见上「偏离 3」）。
3. `MessageRow` 的 `role="article"`：给可聚焦行一个合法语义的最小代价，记录在 Standards 轴。
4. `lib/modal-focus.ts` 不做 radio 组特化：子树里没有 radio，按 YAGNI 不加分支。
5. **R1 的实际覆盖面 = `BrutalModal` 的 7 个消费方**。派发把「模型配置 / 技能配置 /
   项目信任」也算作 `BrutalModal` 复用点，实测三者都不走这个外壳（`ModelsConfig` /
   `SkillsConfig` 是独立 fixed 浮层，`ProjectTrustDialog` 无渲染点）。它们各自缺
   `role=dialog` / Esc / 焦点管理，属于独立的无障碍缺口，不在本票的 3 项范围内。
6. **R3 不给 `.col-body` 加 `max-height`**（派发此前提过「或按设计系统给一个合理的
   max-height」）。堆叠态 `.col` 是 `flex: 0 0 auto`、列高随内容，`.col-body` 不再在列内滚；
   再加 `46vh` 这类档位就是任务板段明令禁止的「视口魔数」（`task-board.test.mjs` 那条
   「整段任务板 class 块里不得再有视口魔数」的机械判定，只差把 `vh` 也纳入正则）。
   首版确实加过，Standards 轴发现后按上游原样收掉。

### 同步更新的既有断言（因契约变更，逐条点名）

- `components/ChannelView.test.mjs`（`MessageRow preserves readable long-form…`）：
  `html.indexOf("#43")` 会命中行根新增的 `aria-label="Message #43 by Owner"`，改为在
  可见的 `msg-head` 段内比较「作者在序号之前」。
- `components/DetailPanel.test.mjs`（`DetailPanel thread 变体…`）：同一成因，改为从
  `msg-head` 起点切片；`replyHeader` 的正则去掉行首 `^` 锚点。
- `components/message-stream.test.mjs`：新增 `stripComments` helper；R2 揭示规则的
  断言按「行根 `:focus-visible` + 行内带否定的 `:focus-within`」两条选择器同一条规则来判，
  并反向断言不得出现裸 `:focus`；另加一条「动作完成后焦点留在行根」的源码级断言。

### 门禁

- `npx tsc --noEmit`：0 error。
- `npm run lint`：0 error（1 条既有 warning，`hooks/useI18n.tsx:61`，非本票引入）。
- 窄档 `node --test app/globals.test.mjs app/globals.contrast.test.mjs components/*.test.mjs lib/modal-focus.test.mjs`：**462/462**。
- 全量 `npm test`（剔除 `BASH_ENV` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` /
  `DEEPSEEK_API_KEY` / `STARSHIP_SESSION_KEY`）：**1723/1723**（基线 1698 + 新增 25）。
- 未跑 `next build`。依赖只用 `bun install --frozen-lockfile`。

### 证据实例与清理

- 数据目录：`/tmp/ws-r02/data`（`scripts/seed-demo.mjs` 生成，未触碰 `~/.worksplice`）。
- 端口：30143（`WORKSPLICE_DATA_DIR=/tmp/ws-r02/data`）。
- 浏览器：ego-browser（Chromium），TaskSpace `worksplice residual R1/R2/R3`（space id 7）。
- 票据收敛前会停掉 30143 的 dev server。
