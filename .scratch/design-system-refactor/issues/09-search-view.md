# 09 — 搜索视图

**What to build:** `components/SearchView.tsx` 按原型形态重做：`.search-view` / `.search-field`（`:focus-within` accent 环，替换 ink 边框）/ `.facet-row` / `.filter-chip`（选中 `.is-on` → `--accent-soft` + `--accent`）/ 结果 `.group` / `.group-label`（mono 大写 + `letter-spacing .1em`）/ 命中摘要的 `#seq` 与作者名（mono / accent）/ `.empty`（空态：`--panel-2` 图标底 + 13.5px 标题）。

**Blocked by:** 03, 04

**Status:** resolved

- [x] 搜索框焦点环走 `--accent-soft`；无 ink 边框 —— `.search-field:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft) }`；浏览器实测 computed `box-shadow: oklch(0.56 0.17 256 / 0.11) 0 0 0 3px`
- [x] facet chip 选中态 = `--accent-soft` 底 + `--accent` 文字 —— **无实体、未渲染**（coordinator 裁决 3，见 Answer 的 D1）：`.filter-chip.is-on` 本体已在票 06 落位（`app/globals.css:1218`），本票复核确认本仓没有 facet 状态可挂，故不新增显示面
- [x] 结果分组的 `#seq` 用 `var(--mono)` + `tabular-nums` —— 结果分组无实体（D2），`#seq` 落在命中行的 `.result .r-top .hash`（mono + accent + tabular-nums），渲染断言 + 规则体断言双证
- [x] **命中作者头像**尺寸 28 → 22px（`size="sm"`）；`hit.author?.name` 为 `undefined` 时渲染占位符 `?`，`aria-label` 回退到 `hit.author_id` —— 尺寸在票 04 迁移时已改 `size="sm"`（本票**故意不改**，只补端到端断言：`.avatar.sm` → `--avatar-sm` → `tokens.css:22px`，浏览器实测 `22px`）；占位与 `aria-label` 回退同样补渲染断言
- [x] 新增渲染断言：facet chip 选中态（落在无障碍名上）—— 按裁决 3 改记「无实体、未渲染」，以**反向断言 + 零消费者扫描**守（渲染 markup 无 `facet-row|filter-chip`；全 `components/*.tsx` 的 `className` 无这两个 class）。无障碍名的正向断言落在既有实体上：关闭钮 `aria-label="Close search"`、搜索框 `aria-label="Search messages…"`
- [x] 搜索行为零改动（`GET /api/search` 的调用与参数不动）
- [x] `npm test` / `tsc --noEmit` 通过

## Answer

**交付**：`components/SearchView.tsx` 换到设计系统的搜索视图形态（class 结构 + 样式表达）、`app/globals.css` **追加**搜索视图 class 块（逐字搬自上游）、新增 `components/SearchView.test.mjs`（21 条断言的渲染 / 规则体 seam）。

**提交**：`12b87d1`（主体）+ `f10b0e3`（review 收口：陈旧注释、溢出收口、断言去牙、登记补全）+ 本票据收敛 commit（`Status: resolved` + 本 Answer）。

### 验收清单逐条证据

| 票面项 | 证据 |
| --- | --- |
| 焦点环 `--accent-soft` / 无 ink | `globals.css` 的 `.search-field` / `.search-field:focus-within` 规则体断言（测试②③）+ 浏览器 computed（ring 3px、`radius 12px`、聚焦时 `border-color: var(--accent)`） |
| facet chip 选中态 | 裁决 3 ⇒ 无实体。`.filter-chip.is-on` 本体在票 06 段落位（未重复声明）；本票不渲染（D1） |
| `#seq` mono + tabular-nums | `.result .r-top .hash` 规则体（`var(--mono)` + `tabular-nums` + `var(--accent)`）+ 渲染 markup `class="hash">#4` + 浏览器 computed `font-variant-numeric: tabular-nums` |
| 头像 22px / `?` 占位 / `aria-label` 回退 | 渲染断言（`.avatar.sm av-N`、`>?</span>`、`aria-label="ghost-7"`）+ 浏览器实测 `avatar sm av-3`、`22px`、`aria-label="Susan"` |
| facet 渲染断言 | 反向断言 + 零消费者扫描（`SearchView.test.mjs` 的「facet 行与结果分组不渲染」）；浏览器实测 `facetConsumers: 0` |
| 搜索行为零改动 | 源码级守卫：`fetch(\`/api/search?q=${encodeURIComponent(trimmed)}\`)` 逐字、`DEBOUNCE_MS = 250`、Enter/Escape、9 条 `search.*` 键、props 名与事件处理一字未动 |
| `npm test` / `tsc` | 见「门禁输出」 |

### 红绿节奏（TDD，全部真实执行）

1. **红①**（base `SearchView.tsx` + 新 CSS）：`node --test components/SearchView.test.mjs` → **8 fail**（`.search-view`/`.search-field` 容器、`.result` 命中行、头像 `.avatar.sm`、`?` 占位、摘要 JSX 渲染、`.empty`、新段落旧残留、keyframes 断言）。
2. **红②**（base `app/globals.css` + 新组件）：同命令 → **11 fail**（`.search-field` / `:focus-within` / 内层输入去双环 / `.result*` / `.hash` / `.empty*` / `.facet-row` 规则体缺失）。
3. **红③**（两边都在位）暴露 **5 条断言自身的缺陷**（不是实现缺陷）：注释里的 `dangerouslySetInnerHTML` 子串被当成用法、`\d+px solid` 把 1px 发丝判成违规、`@keyframes` 把注释计数成 13（真实 12 组，与 `globals.test.mjs` 同基线）、import 列表未去重、零消费者扫描把注释算作消费点。逐条修好后 **21/21 绿**。
4. 回退手法按纪律：备份 → `git checkout HEAD -- <单文件>` → 跑 → 还原（交付时 `git diff --numstat` 只覆盖真改的行）。

### 门禁输出（本 worktree）

```text
git status --porcelain                 → 空（.pi-lens.json 已进 .git/info/exclude，不进仓库）
git diff cad909b..HEAD --name-only     → app/globals.css / components/SearchView.tsx / components/SearchView.test.mjs（+ 本票据）
git diff --numstat（cad909b..HEAD）  → globals.css 62/1（唯一一处删改 = 票 06 陈旧登记注释的作废括注，D3；其余纯追加）；SearchView.tsx 208/198（组件体重做，非整文件重写）；SearchView.test.mjs 331/0（新增）；本票据 136/8
npm test                               → 1242 pass / 0 fail（基线 1221；本票 +21，含全量并发跑两次）
node_modules/.bin/tsc --noEmit         → 通过（无输出）
npm run lint                           → 0 error / 1 warning（与基线逐字相同：hooks/useI18n.tsx:61 既有项）
grep -c '@keyframes' app/globals.css   → 12 组（= 基线，未减；注释里那一处不计）
prefers-reduced-motion: reduce         → 3 处（= 基线，未减）
新增行 emoji 扫描（python3 逐字符）      → 0
浏览器实测（ego-browser，dev :30143）    → `.search-view/.search-scroll/.search-inner` 在位；焦点环 3px accent-soft；
                                         `.hash` mono + tabular-nums + accent；答案 20 条；`.empty` 标题 13.5px + svg；
                                         `.card-tag` 线程徽标 mono 9.5px；`.r-snip` overflow-wrap: anywhere；facet 消费者 0
```

### 偏离登记（逐条、带理由）

- **D1 facet 行与结果分组不渲染**（coordinator 裁决 3，原文：「以 Constraints 为准：无现成实体只搬 CSS、登记零消费者，不新增显示面」）。依据：① 产品所有者在本 effort 的同类情形上已裁决「只换皮、不扩面」（票 07 右栏的 tabs / 状态胶囊 / 时间线同理不做）；② 选项 1（客户端筛选）新增筛选语义会撞 `docs/spec.md` §6.4 的锁定范围（搜索只覆盖消息正文，任务/Agent facet 没有数据源），选项 2（display-only 假控件）是新增显示元素 + 不可交互的误导控件，比不做更糟；③ 判据是**有没有现成实体**：`.search-view` / `.search-field` / 命中摘要 / `.empty` / 命中作者头像都有（本票照常做形态），facet 行与结果分组没有。`.facet-row` 逐字搬入作词汇表并登记零消费者（`globals.css` 段头登记①），测试用反向断言 + 全组件 className 扫描守。
- **D2 `.group` / `.group-label` 不搬也不渲染**：这两个 class 属 rail（票 03 已落位、`WorkspaceSidebar` 消费），搜索结果是平铺列表、没有分组实体；再声明一遍会在 `globals.css` 制造两份同名规则（形态来源分叉）。
- **D3 票 06 的 `.filter-chip` 登记注释补作废括注**（`globals.css:1201`，一行）：两轴 reviewer 都指出它与本票新段头自相矛盾；改为「票 09 核查后作废：本仓没有 facet 实体，渲染点不成立」。
- **D4 命中摘要的渲染机制改写**（`dangerouslySetInnerHTML` → JSX 解析，越出 spec §6「只允许改样式表达」）：**登记为故意的等价改写**。触发点是 pi-lens 的 `dangerously-set-inner-html` 规则（severity `error` / `inline_tier: blocking` / `has_fix: false`——只能移除 sink，无法用 sanitize 满足），它阻断写入。等价性三层证据：① 服务端 `buildSearchSnippet` 只产 5 个 HTML 实体（`lib/data/types.ts` 的 `HTML_ESCAPES`）与裸 `<mark>`/`</mark>`；② `SNIPPET_ENTITIES` 是单遍替换（`&amp;lt;` 仍是字面 `&lt;`，与浏览器行为一致，不做二次转义）；③ 渲染断言 + 浏览器实测 `.result mark` 高亮仍在（`markCount: 1`）。**显示内容逐字等价**，`.result mark` 的形态仍被消费。
- **D5 `SNIPPET_ENTITIES` 是 `HTML_ESCAPES` 的手写逆表**（Duplicated Code / Shotgun Surgery 判断题）：不能把共享 unescape 放进 `lib/**`（spec §6 红线：`lib/**` 零改动），故留为组件内常量，注释指明真源，并以渲染断言守等价。reviewer 已核实两表五实体一一对应。
- **D6 `.result .r-snip` 加一条 `overflow-wrap: anywhere`**：命中行原先 inline 的 `wordBreak: break-word` 随 class 化退场，长无空格 token（URL / 长标识符）会横向溢出；这条收口与 `.msg-text` 的既有处置对齐（Spec 轴 find），并配渲染无关的规则体断言。
- **D7 线程徽标改借票 06 的 `.card-tag`**（旧 inline：accent-soft 底 + `--accent` 字 + 1px 边 + 10px）：原型搜索结果里的 kind 槽位就是 `.card-tag`（mono micro + `--panel-2` 底 + `--muted` 字）；形态变化 + 新增渲染断言（`inThread` → `class="card-tag">thread<`，非线程命中不渲染）。
- **D8 逐字上游字面量不换 token**：`.search-field input` 的 `14px`、`.result .r-top` 的 `12px`、`.result .r-snip` 的 `12.5px`、`.result mark` 的 `border-radius: 2px` 都是上游原值，按「逐字搬运优先」保留（票 08 偏离登记 5 同款豁免），登记在段头。
- **D9 `.empty` 的「`--panel-2` 图标底」票面口径与上游不符**：`ui_kits/app/app.css:311-314` 与原型 `:337-340` 的 `.empty` 只有 `svg { margin-bottom; opacity: .7 }`，没有图标底；按「两者冲突以原型为准 + 不做原型之外的新形态发明（D8）」不发明该槽位，13.5px 标题照做。
- **D10 三个零消费者槽位不搬**：`.search-field kbd`（原型是 ESC 键帽提示，本仓的关闭入口是真实按钮）、`.result .r-title`（本仓命中行的「标题」位置是作者名，落在 `.r-top`）、`.empty p`（两处空态各只有一条文案）；按票 03 / 08 先例裁掉并在段头登记。
- **D11 新增 `SearchHitRow` 导出**（render seam）：命中的结果行只在异步 fetch 之后出现，静态渲染不可达，而票面要求渲染级断言落在产品 markup 上；同票 06 的 `TaskCard`/`TaskBoard`、票 05 的 `MessageRow` 先例。`SearchView` 自己的 props 名与事件处理一字未动。
- **D12 视图头是本仓 chrome**（原型搜索视图没有标题与关闭钮）：标题 + 关闭钮按 ED-1…ED-10 外推（标题 `--fs-title` / `--fw-heavy`；关闭钮取票 04 的 `.icon-btn`），无边框、底色 `--bg`；两条 i18n 键（`search.title` / `search.close`）与 aria 面保持。
- **D13 prop / 字段取值来源逐个标注**（本票唯一 UI 消费点 `MessageSearchHit` 在 `components/SearchView.tsx`，全仓 `grep MessageSearchHit` 的组件侧命中只此一处）：

| 取值 | 出现位置 | 处置 |
| --- | --- | --- |
| `Avatar size` | `SearchHitRow` 头像 | **故意不改**（base 已是 `size="sm"`，票 04 迁移时落地；本票补 22px 端到端断言） |
| `Avatar name` | 同上 | **故意不改**（`undefined` → `Avatar.initials()` 返 `?`；本票补断言） |
| `Avatar colorKey` | 同上 | **故意不改**（`aria-label` 回退到 `hit.author_id` 由 `Avatar` 的 `label` 承担；本票补断言） |
| `Avatar type` | 同上 | **故意不改**（人类恒 `av-4`） |
| `hit.channel` / `hit.inThread` / `hit.seq` / `hit.created_at` / `hit.snippet` | 命中行 | **故意不改**（仍读同一批字段，只换承载的 class / 内联样式） |
| `hit.author_id`（作者名文本回退） | 命中行元信息 | **故意不改**（`hit.author?.name ?? hit.author_id` 原样保留） |

### 双轴 code-review（两份报告不合并，措辞原样）

固定点 `cad909b`（= origin/main），diff 落盘 `/tmp/ds09.diff`（828 行），两个独立 reviewer 并行、互不共享上下文。

**Standards 轴**（独立 reviewer，措辞原样）

> **Correct（已核）**：CSS 块逐字对上游 `ui_kits/app/app.css:294–313` 一致；三处裁剪（`.search-field kbd` / `.r-title` / `.empty p`）与两处本仓收口（`globals.css:1318` 内层 input 去双环、`:1326` `.hash` + tabular-nums）均在段头登记（`:1281–1308`）。i18n 分层（docs/i18n.md）：文案全走 `t(...)`，9 个 `search.*` 键在 `en.ts:438–447` / `zh-CN.ts:429–437` 齐备，无硬编码、无新增键。UI 图标规则（AGENTS.md）：仅 lucide 的 `Search`/`X`，diff 无新增 emoji。无 hex/rgb/渐变：新增 CSS 全 `var()`/`color-mix(in oklch,…)`（SKILL.md §7、ED-10）。`height:100%`→`flex:1` 无回归：父 `.ws-center` 是 flex column（`globals.css:890–896`）。
>
> **Findings**
> - **P1（硬，spec §6 红线）`SearchView.tsx:189–215,283`**：把 `dangerouslySetInnerHTML={{__html:hit.snippet}}` 换成自写 JSX 解析器 + `SNIPPET_ENTITIES` 解码表。§6 明写「只允许改样式表达（inline style 值 / className / CSS）」，HTML 渲染路径改写不在其列；票 09 清单无此条、`## Answer` 为空 ⇒ **未登记**。渲染结果与浏览器等价（服务端 `escapeHtml` 只产这 5 个实体，`lib/data/types.ts:181`），但仍是越线改动。最小修：票 09 Answer 登记该偏离（安全理由 + 单遍解码等价），或保留 `dangerouslySetInnerHTML`。
> - **P2（判断题，Duplicated Code / Shotgun Surgery）** 同 hunk：`SNIPPET_ENTITIES` 是 `lib/data/types.ts:181 HTML_ESCAPES` 的手写逆表，须两处同步改；被 §6「`lib/**` 零改动」压制（不许在 lib 立共享 unescape）⇒ 仅登记。
> - **P2（判断题，Speculative Generality）`globals.css:1321 .facet-row`** 死规则——段头已「零消费者登记」，合票 06 D1/D2 先例 + coordinator 裁决 3 ⇒ 规范认可，压制。
> - **P2（判断题）`SearchView.test.mjs:320`** `!fileURLToPath(componentsDir).includes("/lib/")` 恒真（恒为 `…/components/`），无牙断言；删或改断真实不变量。
> - **P2（判断题）** 段头只登记 2 收口 + 3 裁剪，未登记 `.search-field input:14px`、`.r-top:12px`、`.r-snip:12.5px`、`.result mark{r:2px}` 与 ED-3/ED-5 标尺的紧张（全逐字上游，可比票 08 偏离登记 5 豁免）；`SearchView.tsx:271` 借票 06 `.card-tag` 改线程徽标形态（旧 accent-soft → `--panel-2`/`--muted`），无断言、无登记。建议段头补两行。
> - 测试 helper `escapeRe`/`blockBody` 与 `primitives.test.mjs` 重复：票 06/08 已豁免，沿例。
>
> **Merge verdict: OK with notes**（无 P0；P1 须先在票 09 Answer 登记该红线偏离）。

**Spec 轴**（独立 reviewer，措辞原样）

> **核对基点**：`/tmp/ds09.diff`（仅 3 文件：`app/globals.css`、`components/SearchView.tsx`、`components/SearchView.test.mjs`）；`watchdog_diff` 报 HEAD=12b87d1 工作区无改动。CSS 段与上游逐字对照：`ui_kits/app/app.css:293-314`、`worksplice-app.html:322-338` 一致，新增仅 3 处本仓收口（`input:focus-visible{box-shadow:none}`、`.hash` 加 `tabular-nums`、段头注释）。
>
> - **Correct**：`.search-view/.search-scroll/.search-inner/.search-field/.result*/#seq(mono+tabular-nums)/.empty` 形态与原型一致；头像 22px（`--avatar-sm:22px`，`Avatar.tsx` 的 `initials→"?"` + `label=colorKey` 回退）与票面验收吻合；`fetch("/api/search?q=…")`、`DEBOUNCE_MS`、Enter/Escape、props 名、9 条 i18n key 一字未动（`AppShell.tsx:490-495` 调用点未改）；红线文件面达标（无 `lib/**`、无 `app/api/**`、`worksplice-design-system/**` 零改动）；`@keyframes` 仍 12 组、reduce 块在、无新增 emoji；`.ws-center` 是 flex column（globals.css:890-896），`height:100%→flex:1` 不会塌高。
> - **Finding P2** `components/SearchView.tsx:196-217`：命中摘要由 `dangerouslySetInnerHTML` 改为 JSX 解析，超出 spec §6「只允许改样式表达」（spec.md:378）。等价性已核（`HTML_ESCAPES` 五实体 ↔ `SNIPPET_ENTITIES` 单遍替换、只认裸 `<mark>`），无功能风险；但 Answer 必须登记「故意改动 + 等价论证」，否则应回退。
> - **Finding P2** `app/globals.css:1201`：票 06 旧登记「`.filter-chip` 渲染点归票 09」与新段头 1295-1297（作废、零消费者）同文件互相矛盾。最小修：1201 括注「票 09 核查后作废，见搜索视图段头」。
> - **Finding P2** `.result .r-snip`（globals.css:1327）失去原 inline `wordBreak: break-word`，长无空格 token 可能横向溢出（`.msg-text` 用 `overflow-wrap:anywhere`）；可加一条 `overflow-wrap:anywhere` 收口，或按「逐字搬运」记为接受偏离。
> - **P2（文档）** `SearchView.test.mjs:150` 测试名「hover 往亮处走（--panel）」与值矛盾（97.4% 比 `--surface` 100% 暗）；值逐字合规。
>
> (a) 缺失/半做：T-D「09」行的 facet chip 渲染断言改为「无实体、未渲染」反向断言——属裁决 3 授权，但**尚未执行的 Answer（验收项 4）必须逐条写清**；票面「`.empty` `--panel-2` 图标底」未实现，因原型无该规则（html:337-338/1450/1454 为裸 icon），与「冲突以原型为准」一致，也须登记。
> (b) scope creep：无（仅新增 `SearchHitRow` 导出供既有 seam；header 是本仓既有 chrome，非新增显示面）。
> (c) 实现错误：未发现。
>
> Merge verdict: OK with notes（P2 需在 Answer 登记，不阻断合并）

#### findings 处置（逐条）

| 轴 | finding | 处置 |
| --- | --- | --- |
| Standards | P1 snippet 渲染机制改写未登记 | **已修（登记）**：D4 + D5 落进本 Answer（等价三层证据 + 阻断规则出处 + 不共享逆表的红线理由）；决定不回退（移除注入 sink 有价值，且等价性有断言与浏览器实测双证） |
| Standards | P2 `SNIPPET_ENTITIES` 逆表（Duplicated Code / Shotgun Surgery） | **登记豁免**（D5）：`lib/**` 零改动红线不允许在 lib 立共享 unescape |
| Standards | P2 `.facet-row` 死规则 | **豁免**（D1）：coordinator 裁决 3 + 票 06 先例，「逐字搬运优先于裁剪」 |
| Standards | P2 `SearchView.test.mjs:320` 无牙断言 | **已修**：删 `!fileURLToPath(componentsDir).includes("/lib/")`（连 `node:url` import）、改断真实不变量「UI 不直连数据层」（`@/lib/data` 0 命中） |
| Standards | P2 段头未登记字面量与 `.card-tag` 形态 | **已修**：段头补「字面量登记」段（14/12/12.5px + `mark` 2px 圆角，票 08 先例）+ `.card-tag` 借用说明；D7/D8 入 Answer；新增线程徽标渲染断言 |
| Standards | P2 测试 helper 与 primitives 重复 | **豁免**（沿票 06/08 先例）：每个测试文件自带探针是本仓既有形态 |
| Spec | P2 snippet 渲染机制改写 | **已修（登记）**：同 D4 |
| Spec | P2 `globals.css:1201` 陈旧注释自相矛盾 | **已修**：补一行作废括注（D3） |
| Spec | P2 `.r-snip` 失去 `wordBreak`，长 token 可能溢出 | **已修**：加 `overflow-wrap: anywhere`（D6）+ 规则体断言 |
| Spec | P2 测试名「hover 往亮处走」与值矛盾 | **已修**：改名「hover = 边框强化 + 落到更深的 `--panel` 表面」 |
| Spec | 票面 `.empty --panel-2` 图标底未实现 | **豁免 + 登记**（D9）：上游/原型都没有该槽位，按「冲突以原型为准 + 不发明新形态」不做 |
| Spec | facet 断言改反向断言需逐条留痕 | **已做**：D1 + 验收清单第 2/5 项的注记 |

跨轴不做单一排序：Standards 轴 6 findings（1×P1 已登记、2 已修、2 豁免、1 沿例），Spec 轴 4 findings（2 已修、2 豁免 + 登记）。

### 三条红线自查

- `git diff cad909b..HEAD --name-only` = `app/globals.css` / `components/SearchView.tsx` / `components/SearchView.test.mjs`（+ 本票据）——**`lib/**` 0 个**（`lib/i18n` 也未改）、**`app/api/**` 0 个**；
- 票 03 / 05 / 06 / 07 / 08 所属文件（`AppShell` / `WorkspaceSidebar` / `ChannelView` / `DetailPanel` / `ThreadPanel` / `AgentDetailPanel` / 模态族 / `Avatar` / `StatusDot`）**零改动**；`hooks/useIsMobile.ts` / `spec.md` / `worksplice-design-system/**` **零改动**（后者逐字不动）；
- `git diff --numstat` 无整文件重写（`globals.css` 62 增 / 1 删，组件体重做 208/198）；`@keyframes` 12 组（未减）、`prefers-reduced-motion: reduce` 3 处（未减）、新增行 emoji 0 个。

### PR

[#119](https://github.com/whutlichao/worksplice/pull/119)
