# 实施票 03：模型配置 / 技能配置两个浮层补齐对话框语义与焦点管理（与 R1 同源）

Status: resolved

- 日期：2026-11-11
- 分支：`interface-config-overlays-a11y`
- 基地：`fb024f0`（`main`，含 PR #213；全量基线 1723/1723）
- 来源：上一票（`.scratch/interface-audit-fixes/issues/02-residual-a11y-layout.md`）的偏离记录 5
  点名的独立缺口——`ModelsConfig` / `SkillsConfig` 不走 `BrutalModal`，R1 的焦点陷阱没覆盖到。

## 范围

### S1 (HIGH) 两个浮层成为真正的对话框

`ModelsConfig`（侧栏「模型」）与 `SkillsConfig`（侧栏「技能」）原先都是手写的
`position: fixed` 浮层：无 `role="dialog"` / `aria-modal`、无打开移焦、无 Tab 回绕、
无 Esc（模型配置的 Esc 只挂在「添加 Provider」子浮层的搜索框上）、关闭后焦点丢到 BODY。

### S2 (HIGH) 行为只写一份，三处共用

R1 把**判定**收进了 `lib/modal-focus.ts`，但**接线**（渲染期抓 opener、初始移焦、
Tab 边界回绕、叠加 dialog 让路、关闭归还）仍整段写在 `BrutalModal` 的 effect 里。
本票把它抽成 `hooks/useModalFocus.ts`，`BrutalModal` / `ModelsConfig` / `SkillsConfig`
以及模型配置内部叠加的「添加 Provider」子浮层一起消费。宽度留在各外壳自己手里
（440/560 两档 vs 860/820），接线层不碰尺寸。

### S3 (MEDIUM) 关闭入口可见性

两个浮层原先只有「点 backdrop」（模型配置另有搜索框上的 Esc）可关，且关闭键是裸 `×`
文本按钮、无 `aria-label`。补 `.icon-btn` + lucide `X` + 本地化 `aria-label` 的关闭键，
与 `BrutalModal` 的 `.modal-head` 同形，并且**就是打开后的初始焦点**（进 Tab 序）。

## Answer

### 落地情况

| 条目 | 落地 | 关键位置 |
|---|---|---|
| S1 | 两个浮层根面板：`role="dialog"` + `aria-modal="true"` + `aria-labelledby` 指向可见标题 + `tabIndex={-1}` 兜底落点；打开移焦、Tab/Shift+Tab 回绕、Esc 关闭、关闭归还 opener 全走共享接线层 | `components/ModelsConfig.tsx` / `components/SkillsConfig.tsx` / `hooks/useModalFocus.ts` |
| S2 | 接线层抽成 `useModalFocus`（`dialogRef` + 一个 effect）；`BrutalModal` 删掉整段内联 effect（-146 行），四个消费方共用；判定仍在 `lib/modal-focus.ts` | `hooks/useModalFocus.ts` / `components/BrutalModal.tsx` |
| S3 | `DialogCloseButton`（`.icon-btn` + lucide `X` + `aria-label={t("common.close")}`），`BrutalModal` / 两个配置浮层三处共用；不再是裸 `×` | `components/DialogCloseButton.tsx` |

### 红绿节奏

每项都是先红后绿，同一命令两次跑。

**S2（共享接线层）**

- 先红：`node --test hooks/useModalFocus.test.mjs`
  → `Error: ENOENT: no such file or directory, .../hooks/useModalFocus.ts`，
  `ℹ tests 1 / pass 0 / fail 1`（文件级失败：8 条用例全被吞）。
- 转绿：同一命令 → **8/8**。

**S1 + S3（两个浮层）**

- 先红：`node --test components/config-overlays.test.mjs`（在 base 的两个组件上）
  → 6 条失败，逐条对应缺口：
  - `S1（模型配置）：根面板是 aria-modal 对话框…` / `S1（技能配置）…` —— `role=dialog` 计数 0；
  - `S1（模型配置）：对话框自身可承接兜底焦点（tabindex=-1…）` / 技能同 —— 无 `tabindex`；
  - `S3（模型配置）：关闭键是 .icon-btn + lucide X…` / 技能同 —— 只有裸 `×`。
  （全量跑时这 6 条 + hook 文件级 1 条 = `1727 pass / 7 fail`，其余全绿。）
- 转绿：同一命令 → **10/10**；全量 `npm test` → **1740/1740**。

### Review（双轴自审）

**Standards 轴**

- **分层贴合 repo 既有分法**：`lib/modal-focus.ts`（判定，纯函数，node 可测）→
  `hooks/useModalFocus.ts`（接线，浏览器行为）→ 各外壳（markup + 自身尺寸），
  与 02 票「判定层纯函数 + 消费层挂载」同一条分层线，只是把消费层从单个组件提到 hook。
  hook 放进 `hooks/`（与 `useIsMobile` / `useKeyboardShortcuts` 同档），不是 `lib/`——
  它带 React 生命周期，不是纯逻辑。
- **接线真的只有一份**：`BrutalModal` 的 118 行内联 effect 全部删除（净 -146 行），
  三个组件文件里不再出现 `collectTabbables` / `nextTabTarget` / `initialFocusDoneRef` /
  `focusInChildDialog` 任一字样；`hooks/useModalFocus.test.mjs` 有一条反向断言钉住这点。
- **宽度契约不越界**：接线层不读 `width`、不写 style；`BrutalModal` 仍是
  `--modal-max` / `--modal-wide-max` 两档（既有落盘断言全绿），两个配置浮层保留
  `860px` / `820px` 内联宽度，没有为塞进 560 而改尺寸。
- **i18n 分层**：本票没有新增文案——关闭键复用两包已有的 `common.close`
  （en `Close` / zh `关闭`），叠加子浮层复用已有的 `i18n.addProvider`。
  `lib/i18n/messages.test.mjs` 的 D7 守卫（中文不混用 channel / thread）保持全绿。
- **视觉动作零改动**：`.icon-btn` 是设计系统既有原语，lucide `X` 与 `BrutalModal`
  原关闭键同一图标同一尺寸（13px），未动任何 token。
- **判断项（已记录）**：`Config-overlays` 的「宽度自带」断言读 markup 里的
  `width: 860px`，锁的是「不借道 `--modal-max` 两档」这条契约而非像素本身——
  两个浮层的实际尺寸本来就由各自的移动分支（`isMobile`）覆盖，断 desktop 值即可。

**Spec 轴**（逐条对回派发语句）

| 验收语句 | 结论 |
|---|---|
| S1 `role="dialog"` + `aria-modal="true"` + 可访问名 | ✅ 实测：模型配置 `aria-labelledby=models-config-title` → 「Models / 模型」；技能配置 `aria-labelledby=skills-config-title` → 「Skills / 技能」 |
| S1 打开时焦点移入（首选主控件；已有 autoFocus 就让它赢） | ✅ 模型配置 / 技能配置落到对话框内首个可聚焦控件（头部关闭键）；`BrutalModal` 里创建频道的 `autoFocus` 输入框仍然赢，未被抢 |
| S1 Tab / Shift+Tab 在浮层内回绕，背景不进 Tab 序 | ✅ 实测 0 次外溢（读数见下） |
| S1 Escape 关闭 | ✅ 两浮层均实测；叠加子浮层只关自己 |
| S1 关闭后焦点回到打开它的按钮 | ✅ 模型配置 → 侧栏「模型」、技能配置 → 侧栏「技能」；叠层场景回到底层模态里的 opener |
| S1 backdrop 点击关闭的既有行为不变 | ✅ 实测：两个浮层+子浮层 backdrop 点击均仍只关自己 |
| S2 `BrutalModal` 行为不许回退（打开移入、Tab 16 次回绕、Shift+Tab 5 次、Esc 归还） | ✅ 逐条复跑，读数与上一票一致（见下） |
| S2 不许把浮层塞进 440/560 宽度契约 | ✅ `--modal-max` / `--modal-wide-max` 两档未动，落盘断言全绿；浮层 860 / 820 原样 |
| S2 保持 z 序语义（1100 / 1000 > `--z-overlay` 60） | ✅ 内联 `zIndex` 一字未动 |
| S2 叠层：焦点在新层、Tab 不出新层、Esc 只关新层、再 Esc 关下层 | ✅ 实测（真实叠层 + 子浮层两种） |
| S3 可见、可聚焦、带本地化 `aria-label` 的关闭键（`.icon-btn` + lucide `X`） | ✅ 三处共用 `DialogCloseButton`，实测 en `/` zh 文案正确 |
| S3 关闭键进 Tab 序、给即时焦点 | ✅ 实测：打开后 `activeElement` 即该键，且在一圈 Tab 的循环里 |
| 既有不变量 | ✅ tsc 0 error；lint 0 error（1 条 base 既有 warning）；全量 1740/1740（基线 1723 + 17） |

### 实测读数

**环境**：`WORKSPLICE_DATA_DIR=/tmp/ws-t03/data`（`scripts/seed-demo.mjs` 生成的数据目录副本），
端口 30145（改后）；对照组用 `git archive fb024f0` 解出的同源快照，端口 30146，
`WORKSPLICE_DATA_DIR=/tmp/ws-t03/base-data`。浏览器：ego-browser（Chromium）。
语言先设为 `en` 量行为，`zh-CN` 单独验文案。

**改前（base = `fb024f0`，30146）**

| 动作 | `[role=dialog]` | `activeElement` | 结论 |
|---|---|---|---|
| 点侧栏「Models」 | **0**（`aria-modal` 也是 0） | 仍是 `BUTTON:Models` | 不是对话框、焦点不动 |
| 浮层内 Tab ×6 | 0 | `Skills → Language → Set a channel reminder → …` | 焦点直接走到背景 |
| 在浮层内按 Esc | 0 | 不变 | 浮层仍开着（主浮层没有 Esc 监听） |
| 点侧栏「Skills」 | **0** | 仍是 `BUTTON:Skills` | 同上 |
| 技能浮层内 Tab ×6 / Esc | 0 | 走到背景 / 不变 | 同上 |

**改后（30145）**

| 动作 | `[role=dialog]` | `aria-modal` | 可访问名 | `activeElement` |
|---|---|---|---|---|
| 点侧栏「Models」 | **1** | 1 | 「Models」 | `BUTTON.icon-btn`（`aria-label=Close`，对话框内） |
| 点侧栏「Skills」 | **1** | 1 | 「Skills」 | `BUTTON.icon-btn`（同上） |

**Tab 回绕（正 / 反向，0 次外溢）**

- 模型配置，从关闭键起正向 13 次（一圈 12 个停靠点）：
  `OAuth 行 → + Add provider → Delete → INPUT ×3 → Show details → SELECT(api) → Import models… → Cancel → Save → icon-btn Close →` 回到 `OAuth 行`；
  位移全部在对话框内，**出界 0 次**。
- 模型配置反向 4 次：`Close → Save → Cancel → Import models…`，**出界 0 次**。
- 技能配置，从关闭键起正向 16 次（一圈 7 个）：`列表行 → 更新按钮 → skills.sh 链接 → Check → Check updates → Close(页脚) → icon-btn Close →` 回到列表行，**出界 0 次**；
  反向 5 次 `… → icon-btn Close → Close(页脚) → Check updates → Check`，**出界 0 次**。
- 关闭路径：`Escape` 后 `activeElement` = 侧栏 `BUTTON.btn`「Models」/「Skills」；
  点头部关闭键同样回到同一 opener。

**叠层 A：`CreateAgentModal`（BrutalModal，z=`--z-overlay` 60）→ 模型配置（z=1000）**

| 步骤 | 读数 |
|---|---|
| 叠层打开后 | `role=dialog` = 2，`activeElement` 在**新层**（`icon-btn Close`），`inWhich = [false, true]` |
| 新层内 Tab ×14 | 焦点全部留在新层，**出界 0 次**（下层模态的输入框 / 按钮均未进入序列） |
| 新层 Esc #1 | 只剩 `["Create agent"]`；焦点回到**下层模态里打开它的那个按钮**（注入到 `.modal-foot` 的真实 opener 按钮，`inTop=true`） |
| 再 Esc #2 | 两层全关，焦点回到侧栏「New agent」 |
| 同一路径的程序化变体（打开新层时焦点仍停在下层模态的名称输入框） | Esc #1 后焦点回到那个输入框——opener 在渲染期被正确捕成「下层模态内的当前焦点」，不是 BODY |

**叠层 B：模型配置 → 「添加 Provider」子浮层（820px、z=1100）**

| 步骤 | 读数 |
|---|---|
| 子浮层打开 | `role=dialog` = 2（`["Models","Add provider"]`），`activeElement` = 子浮层搜索框 |
| 子浮层内 Tab ×60（一整圈以上） | **出界 0 次**（焦点始终在子浮层里，回绕到搜索框） |
| 子浮层 Esc | 只关子浮层，`activeElement` 回到下层「+ Add provider」（它的 opener）；下层仍开 |
| 再 Esc | 下层也关，焦点回侧栏「Models」 |
| 点子浮层面板内的非可聚焦留白（焦点落回子浮层根）再 Esc | 仍只关子浮层（`dialogs 2 → 1`）——「活动焦点在哪个 dialog 里」的判定按 `closest` 走，落在根上也算本层 |
| backdrop 点击（两层各自） | 仍只关被点的那层（既有行为不变） |

**`BrutalModal` 回归（验收会原样复跑的四条）**

| 断言 | 读数 |
|---|---|
| 打开后焦点在模态内首个可聚焦控件 | `INPUT.input`（创建频道的 `autoFocus` 名称框，符合「autoFocus 赢」） |
| Tab ×16，0 次逃出并回绕 | `radio Public → radio Private → textarea → member-opt ×6 → Cancel → icon-btn Close → INPUT`（循环），**出界 0 次** |
| Shift+Tab ×5，0 次逃出并反向回绕 | `textarea → Private → Public → INPUT → icon-btn Close`，**出界 0 次** |
| Escape 后焦点回到 opener | `BUTTON.btn`，`textContent` =「New channel」 |

**文案（zh-CN）**：侧栏按钮「模型」「技能」→ 对话框标题「模型」「技能」，
关闭键 `aria-label="关闭"`（en 为 `Close`），两包均取既有 `common.close`。

### 偏离与理由

1. **S1「模型配置的首选主控件是搜索框」在代码里不存在**。主模型配置面板（860px）
   没有搜索输入框——`i18n.searchProviders` 那个搜索框属于叠加的「添加 Provider」子浮层
   （820px）。主面板的初始焦点因此落在对话框内首个可聚焦控件，即头部关闭键，
   与 `BrutalModal` 同一口径；子浮层打开后焦点仍按原逻辑进它的搜索框（主控件）。
   不改业务布局去凭空加搜索框（YAGNI，也超出「只改壳」的边界）。
2. **宽度读数与派发表述差一处**：派发写「模型配置 820px、技能配置 860px」；实测主模型配置
   是 860px、它的「添加 Provider」子浮层是 820px。两者都原样保留，未做任何尺寸调整。
3. **Esc 从子浮层搜索框的 `onKeyDown` 收回到共享接线层**（派发没点名但属同一缺口）：
   子浮层此前只有搜索框能关，焦点不在搜索框时 Esc 无效。改由 hook 统一处理，
   搜索框不再自带 Esc 分支（`config-overlays.test.mjs` 有反向断言）。
4. **`BrutalModal.test.mjs` 的三条组件层断言合并为两条**（13 → 12）：原先三条都在断
   「组件里那段 effect 的写法」，现在那段代码搬到了 hook；改为断「组件只消费共享接线层，
   hook 里各自只有一份」，行为断言仍在 `hooks/useModalFocus.test.mjs` + 浏览器实测。
   → 全量 1723 + 8（hook）+ 10（浮层）- 1 = **1740**。
5. **当前产品的真实调用路径并不产生「`CreateAgentModal` → 模型配置」叠层**：
   `AppShell.tsx` 的 `onOpenModelsConfig` 是 `setCreateAgentOpen(false)` 再
   `setModelsOpen(true)`（先关下层再开上层）。所以派发要求的叠层语义我用两种方式实测：
   ① 真实叠层 B（模型配置 → 它的「添加 Provider」子浮层，这是产品里真实存在、且原来就会叠的）；
   ② 叠层 A 的注入验证：在 `CreateAgentModal` 的 `.modal-foot` 里放一个真实按钮作为
   opener，点它打开模型配置，复跑「焦点在新层 / Tab 不出新层 / Esc 只关新层 /
   焦点回下层模态内的 opener / 再 Esc 关下层」五条。两条路径都通过；叠层行为不依赖
   调用方是否先关下层。

### 门禁

- `npx tsc --noEmit`：0 error。
- `npm run lint`：0 error（1 条 base 既有 warning，`hooks/useI18n.tsx:61`，非本票引入）。
- 全量 `env -i PATH=… HOME=… TMPDIR=… npm test`：**1740/1740**（基线 1723 + 17）。
- 未跑 `next build`；依赖只用 `bun install --frozen-lockfile`。
- 证据实例：30145 / 30146 两个 dev server、`/tmp/ws-t03/{data,base-data}`，
  收尾时停掉并关闭 ego-browser TaskSpace。
