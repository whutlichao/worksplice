# 实施票 04：目录选择器与模型下拉的焦点/语义收口 + 补上票 03 漏掉的断言

Status: resolved

- 日期：2026-11-11
- 分支：`interface-picker-popover-focus`
- 基地：`2312501`（`main`，含 PR #214；全量基线 1740/1740）
- 来源：界面评审同源缺陷里还剩下的两个组件，外加票 03 的测试缺口
  （`.scratch/interface-audit-fixes/issues/03-config-overlays-a11y.md` 的自审漏项）。

## 范围

### T1 (HIGH) `DirectoryPicker` 是唯一漏掉接线的对话框

有 `role="dialog"` + `aria-modal="true"` + backdrop 上的自带 Esc，但没有焦点移入、
没有 Tab 陷阱、关闭不归还焦点。它是 `createPortal` 到 body 的子树，被
`AgentDetailPanel` 的「Change workspace」使用。

叠加时的后果（coordinator 在 `main` 上实测）：父层的 `useModalFocus` 会在
`focusInChildDialog()` 时让路，而子对话框自己没有陷阱——Tab 从最后一个控件继续、
Shift+Tab 从第一个控件往回，焦点都逃出两个对话框。

要做：接上 `hooks/useModalFocus.ts`；`dialogRef` 挂在 `.directory-picker-backdrop`
（`role="dialog"` 那个元素）而不是内层 panel。

### T2 (MEDIUM) `ModelPicker` 下拉没有 popover 契约

触发按钮无 `aria-expanded` / `aria-haspopup`；面板 `div` 无 `role`；打开时焦点不进入
面板；关闭后焦点不回触发按钮；组件自己没有任何 Escape 处理（关闭路径是间接的）。

要做：最小 popover 契约——触发按钮 `aria-expanded` + `aria-haspopup`、面板 `role`
（按选定的键盘模型真实现对应语义）、打开移焦、Esc 由本组件关闭并归还焦点。
**不**把非模态 popover 硬套 `aria-modal` / 焦点陷阱。

### T3 (MEDIUM) 票 03 漏掉的断言

`components/config-overlays.test.mjs` 只断 markup。把 `SkillsConfig` 的
`useModalFocus(onClose)` 换成 `useModalFocus(() => {})`，该文件仍 10/10 绿。

要做：补到能守住接线——两个浮层的源码断言「关闭回调必须是被传进来的那个」，
并给 T1 / T2 的新契约各补对应断言。行为面仍以浏览器实测为准（不引入 jsdom）。

## Answer

### 落地情况

| 条目 | 落地 | 关键位置 |
|---|---|---|
| T1 | `DirectoryPicker` 接 `useModalFocus`：`dialogRef` 挂在 `.directory-picker-backdrop`（`role="dialog"` 的那个元素）上，`tabIndex={-1}` 兜底落点；打开移焦 / Tab 回绕 / Esc / 关闭归还 opener 全部走共享接线层。Esc 在 backdrop 上 `stopPropagation()`（见偏离 2） | `components/DirectoryPicker.tsx` |
| T2 | 两个下拉补非模态 popover 契约：触发按钮 `aria-expanded` + `aria-haspopup="dialog"` + `aria-controls`（`useId` 生成），面板 `role="dialog"` + 本地化 `aria-label` + `tabIndex={-1}`；打开移焦到面板首个可聚焦项（`collectTabbables`），Esc 由本组件关闭并归还触发按钮，选中/清除同样归还 | `components/ModelPicker.tsx` |
| T3 | `config-overlays.test.mjs` 新增「关闭回调必须是调用方传进来的那个」源码断言（两个浮层各一条），另加 T1 / T2 的契约断言共 6 条 | `components/config-overlays.test.mjs` |

### 红绿节奏

同一命令两次跑，逐项取证。

**T3（先红，补上票 03 漏掉的守卫）**

- 复现票 03 的红检查：`git show 2312501:components/config-overlays.test.mjs` 覆盖回旧测试文件，
  把 `SkillsConfig` 的 `useModalFocus(onClose)` 改成 `useModalFocus(() => {})` →
  `node --test components/config-overlays.test.mjs` 仍是 **10/10 绿**（缺口确认）。
- 加上新断言后（本次新增 2 条）做同一变异 → `pass 11 / fail 1`，失败项正是
  `票03 漏项（技能配置）：关闭回调必须是调用方传进来的 onClose`；恢复实现后 **12/12**。

**T1 + T2（先红）**

- 先红：新写的 6 条契约断言在 base 组件上跑 →
  `ℹ tests 18 / pass 12 / fail 6`，逐条对应缺口：
  `T1：DirectoryPicker 接共享接线层…`（无 `useModalFocus` / 无 `tabIndex`）、
  `T1：DirectoryPicker 的 Esc 拦住 React 树冒泡…`、`T1：DirectoryPicker 的关闭键复用 DialogCloseButton…`、
  `T2：两个触发按钮声明 aria-expanded / aria-haspopup=dialog`、
  `T2：两个面板是带可访问名的非模态 dialog（不写 aria-modal）`、
  `T2：打开时焦点移入面板、Esc 由本组件关闭并归还触发按钮`。
- 转绿：同一命令 → **18/18**；全量 `npm test` → **1748/1748**（基线 1740 + 8）。

### Review（双轴自审）

**Standards 轴**

- **接线只有一份**：两个组件都没有重复实现「哪些元素进 Tab 序」——`DirectoryPicker`
  消费 `hooks/useModalFocus.ts`，`ModelPicker` 消费 `lib/modal-focus.ts` 的
  `collectTabbables`（非模态，不能套 `useModalFocus`：它会装焦点陷阱与 opener 归还，
  而 popover 两者都不需要）。分层与 02/03 票一致：判定层纯函数、接线层 hook、组件只管 markup。
- **关闭键复用**：`DirectoryPicker` 头部的裸 `×` 换成 `DialogCloseButton`（`.icon-btn` +
  lucide `X` + `common.close`），与 `BrutalModal` / 两个配置浮层同形。实测形态：
  `aria-label="关闭"`、30×30、内含 `<svg>`。没有新增文案键。
- **i18n**：T2 的面板可访问名复用既有 `runtime.model` / `runtime.thinking`（两包都有，
  zh 为「模型」「思考级别」），未新增任何键，`docs/i18n.md` 的分层规则未被触碰。
- **a11y 声明与实现相符**：刻意选 `role="dialog"` 而不是 `listbox`——面板里有过滤输入框与
  provider 分组标题，`listbox` 会承诺方向键 / type-ahead（界面评审 A5 的同类教训）。
  也**不写** `aria-modal`：popover 不拦整页 Tab；而且 `useModalFocus` 的子浮层判定按
  `[role=dialog][aria-modal=true]` 走，写上去会让外层模态误以为有叠层对话框。
- **重复代码**：模型 / 思考两个面板的「打开移焦」「关闭并归还」各自抽成一个
  `focusIntoPanel` + `closeModel` / `closeThinking`，并在 `ModelPicker` 头部注释里
  把两处同构关系写清；没有为了消重把两个面板合成一个通用组件（形态差异真实存在：
  一个有过滤框、一个没有）。
- **判断项（已记录）**：`DirectoryPicker` 的 `useModalFocus` 回调写成内联箭头而非
  `useCallback`，是为了让 hook 的 effect 在 portal 挂载后的那次重渲染重跑
  （首帧 `dialogRef.current === null` 时 effect 早退）。这是接线层既有的依赖约定，
  不改 hook 去迁就单个消费方。

**Spec 轴**（逐条对回派发语句与验收表）

| 验收语句 | 结论 |
|---|---|
| 打开「Change workspace」焦点在 picker 内 | ✅ 实测 `activeElement` = `.directory-picker-path` 输入框（`autoFocus` 赢，与接线层「子内容已拿焦点就不抢」一致） |
| Tab 从最后一个控件继续 → 仍在 picker 内（回绕到第一个） | ✅ 实测：`选择此文件夹` → Tab → `关闭`（`.icon-btn`），`insidePicker: true` |
| Shift+Tab 从第一个控件 → 仍在 picker 内 | ✅ 实测：`关闭` → Shift+Tab → `选择此文件夹` |
| 一整圈不逃逸 | ✅ 从首个控件连续 Tab 235 次：**escapes 0**，231 个不同停靠点 |
| Cancel / Esc / backdrop 点关闭后焦点回「更换」 | ✅ 三条路径逐条实测，`activeElement === button[data-ws-change]`，右栏仍开着 |
| picker 叠在 `AgentDetailPanel` 上按 Esc 只关 picker | ✅ 实测 `pickerGone: true` 且 `asideOpen: true`（base 上这一条会把 agent 面板一起关掉，见偏离 2） |
| picker 关闭后再按 Esc 仍关右栏（未被吞掉） | ✅ 实测：第二次 Esc 后 `asideOpen: false` |
| 打开模型下拉：`aria-expanded="true"`、焦点进面板首个可聚焦项、面板有 role 且与键盘语义一致 | ✅ 实测 `expanded: true`、`role: "dialog"`、`aria-label: "模型"`、`aria-modal: null`；焦点落在筛选框（面板内首个可聚焦项，同时也是主控件） |
| 模型下拉按 Esc 只关下拉、焦点回触发按钮 | ✅ 实测：`asideOpen: true`、`expanded: false`、`display: none`、`activeElement === 触发按钮` |
| 窗口/滚动后打开下拉，面板仍对齐触发按钮 | ✅ 实测：面板内滚动 `scrollTop=150` 后打开 → `deltaTop: 30 / deltaLeft: 0`；真实视口改为 1180×760 后 → 同样 `30 / 0`，且面板完整在视口内 |
| 非模态：Tab 不被拦住 | ✅ 实测：打开后 Shift+Tab 直接回到触发按钮；Tab 走 51 步后自然离开面板到「思考级别」按钮 |
| 模态内用下拉时 Esc 的分层 | ✅ 实测（`CreateAgentModal`）：下拉打开时 Esc 只关下拉、模态仍开；再 Esc 才关模态 |
| 既有不变量 | ✅ tsc 0 error；lint 0 error（1 条 base 既有 warning `hooks/useI18n.tsx:61`）；全量 1748/1748 |

### 实测读数

**环境**：`WORKSPLICE_DATA_DIR=/tmp/ws-t04/data`（`/tmp/ws-r02/data` 的副本，含 seed 演示数据），
端口 30142；浏览器 ego-browser（Chromium）。改前读数取自 `main`（`2312501`）同一份数据，
改后取自本分支。

**T1 改前（`2312501`）**

| 动作 | 读数 |
|---|---|
| 打开「Change workspace」 | `tabindex` = `null`；232 个可聚焦控件；焦点在 `.directory-picker-path` 内（靠 `autoFocus`） |
| 焦点放最后一个控件，Tab | `activeElement` = **BODY**，`inAnyDialog: false`（逃出两层对话框） |
| 焦点放第一个控件，Shift+Tab | `activeElement` = **NEXTJS-PORTAL**，`inAnyDialog: false` |
| 点「Cancel」 | picker 卸载，`activeElement` = **BODY**（不归还 opener） |
| picker 内 Esc | picker 关，但**背后的 agent 面板也一起关**（`asideOpen: false`） |

**T1 改后**

| 动作 | 读数 |
|---|---|
| 打开 | `tabindex="-1"`；232 个可聚焦控件；首个 = `.icon-btn`「关闭」；焦点在路径输入框内 |
| 最后一个 → Tab | `.icon-btn`「关闭」，`insidePicker: true` |
| 第一个 → Shift+Tab | 「选择此文件夹」，`insidePicker: true` |
| Tab ×235 | `escapes: 0`，231 个停靠点 |
| Cancel / Esc / backdrop / 头部关闭键 | 四条路径 `activeElement` 均 = 「更换」按钮，`asideOpen: true` |
| Esc 后右栏仍在；再 Esc 关右栏 | ✅ |

**T2 改前（`2312501`）**

| 动作 | 读数 |
|---|---|
| 触发按钮属性 | `aria-expanded: null`、`aria-haspopup: null`、`aria-controls: null` |
| 打开后 | 面板 `role: null`、`aria-label: null`；50 个可聚焦项；`activeElement` = **触发按钮**（`activeInsidePanel: false`） |
| 按 Esc | 面板关闭但**不是本组件关的**（源码里没有 keydown）；焦点不入面板，关闭后也不回触发按钮 |
| 选中一项 | 面板收起，焦点丢到页面根 |

**T2 改后**

| 动作 | 读数 |
|---|---|
| 触发按钮属性 | `aria-expanded="false"`、`aria-haspopup="dialog"`、`aria-controls="_r_0_-model-panel"`（`useId`，两个实例不冲突） |
| 打开后 | `aria-expanded="true"`；面板 `role="dialog"`、`aria-label="模型"`、`aria-modal: null`、`tabindex="-1"`；50 个可聚焦项；焦点 = 筛选框（面板内首个） |
| 按 Esc | `expanded: false`、`display: none`、右栏仍开、`activeElement` = 触发按钮 |
| 思考级别下拉 | `aria-expanded="true"`、`role="dialog"`、`aria-label="思考级别"`；焦点 = 首项「pi 默认」；Esc 后回触发按钮 |
| 选中一项（Claude Fable 5） | 触发按钮文案更新、`expanded: false`、`display: none`、焦点回触发按钮 |
| 面板内 Tab 一圈后 | 第 51 步离开面板到「思考级别」触发按钮（无陷阱，符合非模态） |
| 叠在 `CreateAgentModal` 里 | 下拉 Esc 只关下拉（`modalOpen: true`），再 Esc 关模态 |

### 偏离与理由

1. **T2 选 `role="dialog"` 而非 `listbox`，且不加 `aria-modal`**。派发允许二选一，要求
   「选定后真实现对应键盘语义」。面板包含过滤输入框、provider 分组标题（非 option）与
   「继承全局默认」清除项，`listbox` 的 option 模型装不下这些，且会承诺方向键 / type-ahead。
   `dialog` 的键盘模型就是真实 Tab 序——已逐条实现并在浏览器验证（包括「不拦 Tab」）。
   `aria-modal` 缺席是有意的：它会让 `useModalFocus` 的 `focusInChildDialog()` 把 popover
   误判成叠层对话框。
2. **`DirectoryPicker` 的 Esc 加了 `stopPropagation()`（派发未点名，但属同一缺陷）**。
   实测 base 上 picker 按 Esc 会把背后的 `AgentDetailPanel` 一起关掉：picker 虽然 portal 到
   body，但在 React 树里仍是右栏 `aside` 的子节点，Esc 冒泡到 aside 的 `onKeyDown`
   （`handleClosePanel`）。共享接线层的 Esc 监听挂在 `window` 上，管不到 React 树，
   所以必须在 backdrop 上截断。这条也补了断言。
3. **头部关闭键从裸 `×` 换成 `DialogCloseButton`（派发未明确要求，但约束里写了
   「关闭键一律复用 `components/DialogCloseButton.tsx`」）**。顺带补齐了 `aria-label`
   （原先用 `i18n.close`，语义相同但键不同，统一到 `common.close`）；`busy` 期间不关闭的
   原有守卫保留。
4. **`ModelPicker` 筛选项的 `autoFocus` 被删除**。面板是「常驻 DOM + `display` 切换」，
   元素从不重新挂载，`autoFocus` 永远作用在「面板还隐藏」的那一帧上——是死代码，
   而且会让人误以为移焦由它负责。移焦改由显式 effect 做（实测焦点仍落在筛选框），
   并加了反向断言防止它被加回来。
5. **选中项 / 清除项关闭后也归还焦点（派发只点名 Esc）**。这两条路径原来都是
   `setModelOpen(false)`，焦点会丢到页面根——与 Esc 同一个缺陷，一并收口。
6. **T3 的断言落在源码上而不是渲染 markup**。`onClose` 是调用方传进来的引用，静态
   markup 里看不见；`DirectoryPicker` 又因为 portal 在首帧为 null 而无法静态渲染。
   这两处只能读源码；`ModelPicker` 的 markup 契约（`aria-*` / `role` / id 唯一性）仍走
   `renderToStaticMarkup`。
7. **`--` 无（未改动任何 token / 视觉尺寸 / 业务逻辑）**：`AgentDetailPanel`、
   `CreateAgentModal` 一行未改；`ModelPicker` 的 `rect` 定位逻辑（`top + 30` / `left`）
   原样保留，浏览器实测对齐不变。

### 门禁

- `npx tsc --noEmit`：0 error。
- `npm run lint`：0 error（1 条 base 既有 warning，`hooks/useI18n.tsx:61`，非本票引入）。
- 全量 `env -i PATH=… HOME=… TMPDIR=… npm test`：**1748/1748**（基线 1740 + 8）。
  其中 `lib/bash-containment-extension.test.mjs` 的「正例一b：出网照常」在沙箱/无出网时
  会 skip（用例自带 `egressReachable` 守卫）；本机首次跑出现过 1 次 skip，重跑为
  `skipped 0`，与本次改动无关。
- 未跑 `next build`；依赖只用 `bun install --frozen-lockfile`。
- 证据实例：30142 + `/tmp/ws-t04/data`，收尾时已停止 ego-browser 任务空间。

