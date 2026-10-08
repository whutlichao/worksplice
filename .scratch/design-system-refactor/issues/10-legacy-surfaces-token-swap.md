# 10 — 遗留面换皮（agent 会话面 / 文件面 / 配置面）

**What to build:** 15 个原型未覆盖的模块**只换 token、去 2px ink 边框、去 0 圆角，形态结构不动**，按 spec 的 `ED-1…ED-10` 外推：`MessageView`（气泡 → `--surface` + `--r-md` + 发丝；`--user-bg`/`--assistant-bg`/`--tool-bg` → `--surface`/`--panel`）、`ChatInput`（输入条 → `--border-strong` + accent 焦点环）、`MarkdownBody`（正文 14 → `--fs-body` 13px；代码块底 `--panel-2` + `--r-md`；`.linenumber` → `--faint`）、`MentionText`（mention 底 `--accent-soft` + 文字 `--accent`）、`MermaidBlock`（工具栏 → `.icon-btn`；画布底 `--surface`）、`FileExplorer`（行 hover `--fg-soft`；选中 `--accent-soft` + `--accent`）、`FileViewer`（工具栏高 `--control-h`；行号 `--faint`）、`FileIcons`（核验后若确无样式引用则不动）、`ModelPicker`、`ModelsConfig`（162 处）、`PluginsConfig`（83 处）、`SkillsConfig`（84 处）、`DirectoryPicker`、`ProjectTrustDialog`（若票 08 已覆盖则此处只核对）、`ExtensionStatusBar`（上发丝 + 四态色）。`useIsMobile` 的 640 断点**不动**（D5）。

**Blocked by:** 02

**Status:** resolved

- [x] 15 个模块里 `--text*` / `--bg-panel` / `--bg-hover` / `--bg-selected` / `--bg-subtle` / `--user-bg` / `--assistant-bg` / `--tool-bg` / `--ink` / 马卡龙 7 色 / `--font-space-*` / `--font-hanken*` 出现 0 次
- [x] 无 `2px solid`；无 `border-radius: 0`
- [x] 每个可聚焦元素有焦点环
- [x] `hooks/useIsMobile.ts` 的 `MOBILE_QUERY` 仍是 `(max-width: 640px)`，且注释写明「这是配置面的紧凑断点，不是布局断点」
- [x] **行为零改动**：props 名、i18n key、事件处理、轮询节奏、freshness `baseSeq` 来源一字不动
- [x] `components/*.test.mjs` 全绿（`ChatInput.test.mjs` / `ChatInput.dormancy.test.mjs` / `MessageView.test.mjs` / `MarkdownBody.test.mjs` / `MermaidBlock.test.mjs` 是这一层的护栏）
- [x] `npm test` / `tsc --noEmit` / `npm run lint` 通过

## Answer

### 交付摘要

15 个原型未覆盖面按 `ED-1…ED-10` 完成形态层收口：**形态结构、props、i18n key、事件处理一字未动**，
只改样式表达（inline style 值 / className / `app/globals.css` 的 `.markdown-*` / `.mermaid-*` /
`.file-viewer-*` 段）。硬编码 hex/rgb 全部换成 token 或 `color-mix(in oklch, …)`；字号全部落到 `--fs-*` 标尺
（正文 13px）；圆角全部落到 `--r-*`；交互控件边框升到 `--border-strong`；hover 一律提亮表面；
`outline: "none"` 从可聚焦按钮上撤掉，让 reset 的 `:focus-visible` 环可达。

`git diff --numstat` 最大单文件 `ChatInput.tsx` 128/128（全为逐行替换，无整文件重写）；
`MarkdownBody.tsx` 与 `FileIcons.tsx` **零 diff**（前者样式在 `globals.css` 段内，后者确无样式引用，票面已授权不动）。

### 验收清单（逐条 + 证据）

- [x] **① 旧 token 名 0 次**：15 个模块对 `--text*` / `--bg-panel` / `--bg-hover` / `--bg-selected` /
      `--bg-subtle` / `--user-bg` / `--assistant-bg` / `--tool-bg` / `--ink` / 马卡龙 7 色 /
      `--font-space-*` / `--font-hanken*` 的 grep 计数合计 **0**（范围含 `globals.css`）。
- [x] **② 无 `2px solid`、无 `border-radius: 0`**：15 个模块计数均为 **0**；`MermaidBlock` 的
      `customStyle.borderRadius: 0`（旧写法，压掉语法高亮主题的圆角）已删。
- [x] **③ 每个可聚焦元素有焦点环**：机制是票 02 的 reset —— `:focus-visible { outline: 2px solid var(--accent);
      outline-offset: 2px }` 覆盖一切可聚焦元素；字段走 `input/textarea/select:focus-visible {
      box-shadow: 0 0 0 3px var(--accent-soft) }`。本票做的是**撤掉压掉环的三处 `outline: "none"`**：
      `MentionText` 的 mention 按钮、`PluginsConfig` 与 `SkillsConfig` 的 Toggle 开关（三处都不是字段，
      原先靠 `outline: none` + 边框变色表示焦点，低于 ED-8 的要求）。`DirectoryPicker` 的输入框环改用
      `0 0 0 3px var(--accent-soft)`（原先自造 `color-mix(in srgb, … 18%, …)`）。
- [x] **④ `useIsMobile` 不动**：`MOBILE_QUERY = "(max-width: 640px)"`，注释保持「配置面的紧凑断点……
      不是布局断点」；该文件**不在改动清单里**（`git diff --name-only` 无此路径）。
- [x] **⑤ 行为零改动**：见下方「行为零改动的机械自查」。
- [x] **⑥ 既有护栏全绿**：`ChatInput.test.mjs` / `ChatInput.dormancy.test.mjs` / `MessageView.test.mjs` /
      `MarkdownBody.test.mjs` / `MermaidBlock.test.mjs` / `MobilePwaLayout.test.mjs` 全绿（未改任何既有断言，
      只新增断言，见「渲染级断言」）。
- [x] **⑦ 门禁**：`tsc --noEmit` 通过；`npm test` **1136 pass / 0 fail**（基线 1135 + 新增 1 例；
      另一处是在既有用例内追加断言，不改计数）；`npm run lint` = 0 error / 1 warning，
      与基线**同一条**（`hooks/useI18n.tsx:61`），**零新增**。

**附加（本票任务要求 ≥1 条渲染级断言）**：两处 `renderToStaticMarkup` 断言 —— `MermaidBlock.test.mjs`
的 `legacy code block consumes the ticket-10 surface contract`（断言代码块渲染出 `--panel-2` 底、
`--fs-sm` 字号、且不再叠第三方主题的硬编码边框），`ExtensionStatusBar.test.mjs` 追加
`font-size:var(--fs-*-)` 断言。两者都证明「遗留面真的在消费新契约」，不是「源码里恰好没有旧名」。

### 红绿证据（TDD）

1. **红（MermaidBlock）**：先加断言 `assert.match(html, /background:var\(--panel-2\)/)`，`node --test
   components/MermaidBlock.test.mjs` → **1 fail**（`✖ legacy code block consumes the ticket-10 surface
   contract`，失败回显里能看到旧值 `background:color-mix(in srgb, var(--bg) 92%, var(--panel))`）。
2. **绿**：改 `CodeBlock.customStyle`（`--panel-2` + `--fs-sm` + `border: none`）后同一命令 → **25 pass / 0 fail**
   （含 T-A/T-B/T-C/T-D 与 4 个既有 Mermaid 用例）。
3. **红（ExtensionStatusBar）**：加断言后用 `git checkout HEAD -- components/ExtensionStatusBar.tsx` 退回父提交跑一次
   → `✖ renders a single status line without identifier keys`（1 fail）；恢复改动后 → **3 pass / 0 fail**。

### 两轴 code-review（Standards + Spec，不合并）

两份报告由两个独立 reviewer 子代理并行跑出（同一 base `5b98e5c`、同一 diff），findings 逐条处置如下。

#### Standards 轴（原文摘要）

> **硬违规**
> - **P1 — `ModelsConfig.tsx:1966` 漏换硬编码色**：同行 `fontSize`/`borderRadius` 已被 diff 改写，却留下
>   `background: "rgba(99,102,241,0.12)"`；同一字面量在 `PluginsConfig:165`、`SkillsConfig:144` 已换。
>   违反 SKILL §1/§8、ED-10、票面「全量换 token」。**已修** → `var(--accent-soft)`。
> - **P2 — `ChatInput.tsx:2077/2079/2382` 残留 `color-mix(in srgb, …)`**：同对象相邻行已 token 化，说明该对象被编辑而混色空间漏换。SKILL §1 要求 `in oklch`。**已修**（另修 `1221`）。
> **判断项（有据但属取舍）**
> - 圆角按旧 px 就近取值而非按角色：`inputStyle` / `ProjectTrustDialog:113,131` / `DirectoryPicker:155` 的**输入与按钮**用 `--r-sm`，ED-3 写「按钮/输入/卡片用 `--r-md`」。**已修**（见「圆角角色规则」）。
> - 对比度自相矛盾：新增 `--online-text/--working-text` 的理由是四态色作正文 <4.5:1，但同批文件仍用 `color: "var(--error)"` 当正文（`MessageView:545`、`FileExplorer:781/812`、`PluginsConfig:1059`）。**豁免**：`--error`（oklch 60% 0.19 27）作为正文色是**上游 kit 自己的写法**（`ui_kits/app/app.css` 的 `.lv.err`、`.btn-danger` 都这么用），且它比 `--online`/`--working` 深一档；`-text` 派生只给那两个「亮到不能当字」的状态色，不为 `--error` 另造第三个名字。
> - ED-10 / DESIGN §9 被扩用到非状态语义：tps 徽标、git 状态、插件 `update-available`。**豁免**：这三处是**质量/状态**语义（快慢、diff 类型、可更新），不是装饰；ED-10 禁的是「无意义的颜色」与「第二强调色」，本票没有引入新色相（四态 + `--accent` 以内）。
> - 测试越界（spec 对票 10 写「遗留面无新增渲染断言」）与 `MermaidBlock` 的 `/border:none/` 断言自证。**豁免且必须**：本票任务显式要求「另加至少一条渲染级断言」，高于 spec 的 T-D 表；`border: none` 是本次修复（第三方主题写死 `#dddddd` 边框，与新的发丝重复），断言是它的回归钉。
> - `MessageView.tsx:205-207` 新增 `// SAFETY:` 注释越出「只改样式表达」。**豁免**：仓库 lens 自扫规则 `require-safety-comment-for-type-assertion` 对这两处既有 `as unknown as` 报 blocker；补的是注释，零行为改动。

#### Spec 轴（原文摘要）

> **Correct（证据）**：旧名灭绝达标；无 `2px solid` / `border-radius: 0`；`MermaidBlock:270` 去掉
> `borderRadius: 0`；`MentionText:60` 与两个 Toggle 去掉 `outline:"none"`；字号全走 `--fs-*`；
> `useIsMobile` 640 未动；`lib/**`、`app/api/**`、`worksplice-design-system/**` 零改动；
> `MarkdownBody`/`FileIcons` 无 diff 正确。
> **Findings**：(1) `ModelsConfig:1966` 靛蓝字面量 → **已修**；(2) `LEVEL_COLORS` 折叠后
> `low==medium`、`high==xhigh` → **豁免**（见下）；(3) ED-3 角色映射未落实（按钮/输入应用 `--r-md`）
> → **已修**；(4) `ProjectTrustDialog:131` 主按钮 `color:"white"` 未换 + `ChatInput` composer 的环落在内部
> textarea → **white 已修**；composer **豁免并说明**（见下）。
> **Scope creep**：新增全局 `:root{--online-text,--working-text}` 与整站 reduce reset → **保留并留档**（见下）。

#### 本轮因审查而落的改动

| finding | 处置 |
| --- | --- |
| `ModelsConfig:1966` 靛蓝字面量 | `background: "var(--accent-soft)"` |
| `ChatInput` 4 处 `color-mix(in srgb, …)` | 全部改 `in oklch` |
| `PluginsConfig:402` / `ProjectTrustDialog:133` 的 `color: "white"` | `oklch(99% 0.01 256)`（= 上游 `.btn-primary` 的浅 ink） |
| 输入 / 标准高度按钮 / 分段控件圆角角色 | `--r-sm` → `--r-md`（46 处，含 `ModelPicker` 过滤输入框补上缺失的圆角） |

### 圆角角色规则（ED-3 的可判定落法）

ED-3 的硬规则是「只从 `--r-sm/--r-md/--r-lg/--r-xl/--r-pill` 里选」（本票全部满足），角色映射按
**控件体量**落：**输入框 / 文本域 / 下拉、分段控件容器、高度 ≥ 26px 的按钮 → `--r-md`**；
**紧凑 chip、菜单行、导航行、24px 图标按钮、内联提示块 → `--r-sm`**；模态 / 大面板 → `--r-lg`；
圆点 / 计数 / 状态 → `--r-pill`。这条子规则的理由：14px 的复选框与 22px 的 chip 用 8px 圆角会失真，
ED-3 的「按钮/输入用 8px」是给标准体量控件的。

### 豁免与留档（逐条，均可复核）

1. **`走原语` 兑现方式**：本票的 base 是票 02（`5b98e5c`），与票 04 同 frontier —— 开工时
   `.btn` / `.icon-btn` / `.card` / `.input` **尚未存在**。因此票面的「工具栏按钮 → `.icon-btn`」
   「`.file-viewer-mode-switch` 走原语」「主按钮 = `.btn.btn-primary`」兑现为**与 04 逐字同源的 token 形态**：
   主按钮 = `var(--accent)` 底 + `oklch(99% 0.01 256)` 浅 ink（= `.btn-primary` 的取值）、
   次按钮 = `--surface`/透明 + `--border-strong`（= `.btn`）、图标按钮 = `--border-strong` + `--r-sm` +
   `--fg-soft` hover（= `.icon-btn`）。**交票时 04 已合入 main（#111），但本分支不切 class**：
   `.btn` 的 32px 高 / 12.5px 字号会把配置面与工具栏从 22–24px 吹大，正撞本票最大的硬约束
   「形态结构不动」（且 ED-5 明写不许吹大字号）；要不要把遗留面整体换成原语 class，是 04/11 的形态裁决，
   不是本票的值替换。`git merge-tree` 验过：本分支与含 04 的 `origin/main` **无冲突**（纯 token 改动与
   原语块不重叠）。
2. **`ExtensionStatusBar` 的四态色**：状态文本的颜色来自 `lib/ansi.ts` 的 ANSI 16 色表（`parseAnsiLine`
   的产物），而 `lib/**` 是本 effort 的零改动区；组件自身只有容器（已改上发丝 + `--fs-caption`）。
   四态色在此模块**无落点**，不在本票的改动面内。
3. **`ChatInput` 的「输入条焦点环」**：composer 是 inline-style 的 `<div>`，`:focus-within` 无从声明；
   实际焦点环由容器内的 `<textarea>` 承接（reset 的 `textarea:focus-visible` → `0 0 0 3px var(--accent-soft)`），
   环真实可见。实测若给容器再加 `.composer-box` 会与内层形成双环，故不加。
4. **`LEVEL_COLORS`（7 档 thinking 等级）**：ED-10 只允许四态色 + 中性阶梯 + `--accent`，7 档必须复用档位
   ——现映射 `off→--offline`、`minimal→--faint`、`low/medium→--accent`、`high/xhigh→--working`、
   `max→--error`（冷 → 暖的序数读法保住了）。色点旁边就是等宽字体的档位名，歧义由文字消除。
5. **新增两个扩展层 token**：`--online-text` / `--working-text`（`color-mix(in oklch, var(--X) 45%, var(--fg))`），
   理由见上（四态色作正文低于 4.5:1）。它们是**扩展层新增**，不改上游任何同名 token 的值（T-A 仍绿），
   与票 02 留下的 `--font-mono` 组合名同一层级。
6. **reduce reset 是唯一跨面改动**：`@media (prefers-reduced-motion: reduce) { *, *::before, *::after {
   animation-duration/transition-duration: 0.001ms !important; animation-iteration-count: 1 !important } }`。
   必须如此的理由：本层大量动效写在 inline style（消息动作栏 opacity、菜单、开关滑块），媒体查询无法逐条覆盖，
   属性级 reset 是唯一机制。它**只在 reduce 下生效**、不改变任何常规动效、且与既有 `.presence.working` /
   `.notice-shelf-item` 的收敛方向一致。若 reviewer 认为这超出「15 模块」边界，删除它即可——
   删掉后 CSS 段的 transition 仍收敛（本段另有 `.mermaid-zoom-canvas` / `.markdown-code-action` /
   `.file-viewer-*` 的显式 `transition: none`），只有 inline 动效会回到「短但不受 reduce 约束」。
7. **`.pixelated` 保留**：它在 `globals.css` 属本票的样式段，但唯一消费者是票 04 要删除的 `PixelAvatar.tsx`
   （本票不碰该模块）；现在删会让一个不属于本票的模块掉样式，故留给 04/11。
8. **`oklch(99% 0.01 256)` 保留**：它是设计系统自己给 `--accent` 实心底用的浅 ink（`ui_kits/app/app.css`
   的 `.btn-primary` / `.badge` 逐字使用），上游没有对应 token；本票把两个 `color: "white"` 字面量也换成它。
9. **与票 08 的重叠**：`DirectoryPicker` / `ProjectTrustDialog` 在 spec 的组件表属于遗留层（本票），
   拆票表又写进了票 08。本票按票面 Target 处理（只换 token / 发丝 / 圆角 / 焦点环，不动结构），
   08 落地时按其票面「若票 08 已覆盖则此处只核对」执行即可。

### 行为零改动的机械自查

- `git diff -U0` 的增删行里，非样式面的命中只有三类，逐条核过：① 事件处理器**内部**的样式表达式
  （`onMouseEnter` 里的 `style.background` 值）；② inline style 对象的值；③ 两条 `SAFETY:` 注释。
  props 名、i18n key（`t("…")`）、`baseSeq` 来源、轮询常量、`aria-*` / `role` / `title` 全部逐字未动。
- 缩进漂移自查（脚本比对新旧行的前导空白）：除一处已修的 `const color` 外无差异。
- 红线：`git diff --name-only HEAD` 里 `lib/**`（除 `lib/i18n`）与 `app/api/**` **0 个文件**；
  `hooks/useIsMobile.ts` **不在清单里**；`worksplice-design-system/**` 零改动。

### 门禁输出（本 worktree，改动后）

```text
node_modules/.bin/tsc --noEmit          → 通过（无输出）
npm test                                → 1136 pass / 0 fail（基线 1135）
npm run lint                            → 0 error / 1 warning（同基线：hooks/useI18n.tsx:61）
git diff --numstat（改动面）              → 16 个文件，最大 ChatInput.tsx 128/128
grep -c '@keyframes' app/globals.css    → 12（不减）；prefers-reduced-motion 块存在
git merge-tree --write-tree HEAD origin/main → 无冲突（origin/main 已含票 04 · #111）
```

**PR:** [#112](https://github.com/whutlichao/worksplice/pull/112)
