# 04 — 原语层与状态点/头像

**What to build:** 把上游 `ui_kits/app/app.css` 的原语 class 块搬进 `app/globals.css`：`.btn`（32px / `--surface` / `--border-strong`）/ `.btn-primary`（`--accent` 底 + 浅 ink，hover 换 `--accent-hover` 且两通道同时换）/ `.btn-ghost` / `.btn-danger` / `.btn-sm`（27px）/ `.btn:disabled{opacity:.45}` / `.icon-btn`（30px，透明边框，hover → `--surface` 填充 + `--border` 强化）/ `.is-on`（`--accent-soft` / `--accent`）/ `.badge` / `.tag` / `.input` / `.textarea` / `.select` / `.field` / `.card`（`--surface` + `--border` + `--r-md`；hover 强化边框 + `--shadow-card`）。`StatusDot.tsx` 改 `.presence.{online|working|error|offline}` 形态（7px 圆点、无 ink 边框、`working` 脉冲 1.5s 且 `reduce` 下 `animation:none`）。

**头像（D6 = 换首字 tile，产品所有者改判）**：**新建 `components/Avatar.tsx`（导出 `Avatar` 与 `AvatarSize = "sm" | "md" | "lg"`），删除 `components/PixelAvatar.tsx`**。形态照上游 `.avatar`：`--avatar-sm` 22px（`.sm`）/ `--avatar-md` 26px（默认）/ `--avatar-lg` 44px（`.lg`，圆角 `--r-md` 8px，其余 7px），`display:grid; place-items:center`，`font-weight:700`（22px 档 10px、26px 档 11px、44px 档 16px），`color:var(--fg)`，`overflow:hidden`，**无 2px ink 边框、无硬阴影、无像素图案**。内容 = 首字：`type === "human"` 显示「我」，agent 显示名称首字符（ASCII 转大写），名称为空时占位 `?`、`aria-label` 回退到 member id。底色 = `--av-0…--av-4`，人类恒 `--av-4`；取色的具体落法（有列表序号传序号、无序号传 id 入纯函数）见 spec D6 的「取色」段。

**7 个调用点逐个迁移（`grep -rn 'PixelAvatar' components/*.tsx` 的每一处）**：

| 调用点 | 新形态 | 取色参数 |
| --- | --- | --- |
| `components/WorkspaceSidebar.tsx:460`（rail 的 agent 行） | `<Avatar name={agent.name} size="sm" />` | agent 在 `agents` 列表里的序号 |
| `components/CreateChannelModal.tsx:181`（成员挑选项） | `<Avatar name={agent.name} size="sm" />` | agent 在 `agents` 列表里的序号 |
| `components/SearchView.tsx:202`（搜索命中作者） | `<Avatar name={hit.author?.name} size="sm" />` | `hit.author_id`（无列表序号）；名称 `undefined` → 占位 `?` |
| `components/ChannelView.tsx:1288`（任务 owner chip） | 有 owner → `<Avatar name={task.owner?.name} size="sm" />`；**未认领 → 不渲染头像** | `task.owner_id` |
| `components/ChannelView.tsx:910`（消息作者） | `<Avatar name={message.author?.name} size="md" />` | `message.author_id`；作者是 owner → `--av-4` |
| `components/AgentDetailPanel.tsx:708`（dock 头部） | `<Avatar name={agent.name} size="lg" />` | `agent.id` |
| `components/DetailPanel.tsx:117`（人类资料卡） | `<Avatar name={member.name} size="lg" />` | `member.type === "human"` → `--av-4` |
| `components/PixelAvatar.tsx`（模块自身） | **删除**，由 `components/Avatar.tsx` 取代 | — |

**两个可见的尺寸变化（须由容器所属票一并验收）**：消息作者头像 40 → 26px（票 05）、rail 行头像 28 → 22px（票 03），两处行高会跟着变（这是与上游逐字一致的必然结果）；其余调用点的容器分别在票 06（任务 owner chip / 未认领分支）、票 07（两处 dock 头像 44px 不变）、票 08（成员挑选项）、票 09（搜索命中行）。**迁移本身全部在本票内完成**（删除 `PixelAvatar.tsx` 与切 7 个调用点必须原子，否则中间态编译不过）。已验证 `components/*.test.mjs` 里没有任何断言提到 avatar / `PixelAvatar`，所以无测试耦合。

搬运 `.card` / `.field` / `.input` 等通用名前先 grep 一次本仓既有出现（ED-7）。

**Blocked by:** 02

**Status:** resolved

- [x] 原语 class 块落盘，`.btn-primary` hover 同时换底色与文字色通道（不降对比）
- [x] 每个可聚焦元素有 `:focus-visible` 环；字段/composer 用 `--accent-soft` 环
- [x] `StatusDot` 四态各取 `var(--online)` / `var(--working)` / `var(--error)` / `var(--offline)`；无 `2px solid`
- [x] `components/Avatar.tsx` 新建；`components/PixelAvatar.tsx` 删除；`grep -rn 'PixelAvatar' components/` 为空（含 `.test.mjs`）
- [x] `Avatar` 渲染出**首字**（agent 名首字符转大写 / 人类标记，见偏离 D5）、`.avatar.sm|lg` 三档尺寸取自 `--avatar-sm|md|lg`、7px 圆角（`.lg` 用 `--r-md`）、`--av-*` 取色；**无** `image-rendering: pixelated`、**无** ink 边框/硬阴影
- [x] 7 个调用点逐个迁移到位；`ChannelView:1288` 的未认领分支**不**渲染头像；`type === "human"` 恒 `--av-4`
- [x] 渲染断言：`StatusDot` 四态 + `Avatar` 首字（新增或扩既有 `components/*.test.mjs`）
- [x] `npm test` / `tsc --noEmit` 通过；`npm run lint` 通过

## Answer

### 交付摘要

票 04 落地：`app/globals.css` 追加原语层（`.btn` / `.btn-primary` / `.btn-ghost` / `.btn-danger` /
`.btn-sm` / `.btn:disabled` / `.icon-btn`(+`.is-on`) / `.badge` / `.field` / `.input` / `.textarea` /
`.select` / `.card` / `.presence` / `.avatar` / `.av-0…--av-4`，逐字搬自
`worksplice-design-system/ui_kits/app/app.css`）；`StatusDot` 转 `.presence.{online|working|error|offline}`
形态；`PixelAvatar` 退役、新建 `components/Avatar.tsx`（首字 tile，`AvatarSize = "sm" | "md" | "lg"`）
并原子迁移 7 个调用点。零行为改动：props 名 / i18n key / 事件处理 / 轮询节奏 / `baseSeq` 来源一字未动。

### 验收清单（逐条）

- [x] **原语 class 块落盘**（清单见「交付摘要」）；`.btn-primary` hover 同时换底色与文字色通道
      （`--accent-hover` + 浅 ink `oklch(99% 0.01 256)`，两通道都写在 `.btn-primary:hover` 里，
      断言见 `components/primitives.test.mjs`）。**票面 `.tag` 与独立 `.is-on` 未落**：上游 `app.css` 与
      `worksplice-app.html` 都没有独立 `.tag` 规则（tag 家族只有 `.msg-tag` / `.card-tag`），`.is-on` 也只以
      复合态存在（`.icon-btn.is-on` 属本票、`.filter-chip.is-on` 归票 09、`.member-opt.is-on` /
      `.radio-card.is-on` 归票 08）——按 D8「不做原型之外的新形态发明」，未发明独立 `.tag`/`.is-on`。见偏离 D1。
- [x] 每个可聚焦元素有 `:focus-visible` 环；字段 / composer 用 `--accent-soft` 的 3px 环——两段都在票 02 的
      reset 段（本票 Ownership 明禁改它），`app/globals.test.mjs` 的 T-C 断言保持绿。
- [x] `StatusDot` 四态各渲染出 `var(--online)` / `var(--working)` / `var(--error)` / `var(--offline)`，
      且 markup 内无 `2px solid`：`components/StatusDot.test.mjs`（5 例，新）+ `app/globals.test.mjs`
      的 T-D（票 02 落的同一条断言仍绿）。
- [x] `components/Avatar.tsx` 新建；`components/PixelAvatar.tsx` 删除；`grep -rn 'PixelAvatar' components/`
      **0 行**（含 `.test.mjs`——本票的测试源码里刻意不出现这个名字，否则会污染这条红线 grep；迁移的机械守卫
      是 tsc + 模块文件已不存在）。
- [x] `Avatar` 渲染首字（agent 名首字符转大写）、`.avatar` / `.avatar.sm` / `.avatar.lg` 三档
      （`--avatar-sm|md|lg`）、7px 圆角（`.lg` 用 `--r-md`）、`av-0…av-4` 取色；无 `pixelated`、无 ink 边框、
      无硬阴影（`components/Avatar.test.mjs` 9 例 + `components/primitives.test.mjs` 的 class 块 → token 绑定断言）。
      人类标记见偏离 D5（走 i18n，zh-CN = 「我」）。
- [x] 7 个调用点逐个迁移（`WorkspaceSidebar` / `CreateChannelModal` / `SearchView` / `ChannelView` ×2 /
      `AgentDetailPanel` / `DetailPanel`）；`ChannelView` 的未认领任务 chip **不**渲染头像（源码级断言在
      `Avatar.test.mjs`）；`type === "human"` 恒 `av-4`。
- [x] 渲染断言（`renderToStaticMarkup` + `jiti`，本仓既有 seam）：`components/StatusDot.test.mjs`（新）、
      `components/Avatar.test.mjs`（新）、`components/primitives.test.mjs`（新，原语 class 块 → token 的绑定）。
- [x] `npm test` 1161 pass / 0 fail；`node_modules/.bin/tsc --noEmit` exit 0；`npm run lint` 0 error /
      1 warning（与基线同一条既有警告）。

### 红绿证据（TDD：三个切片，先红后绿）

| 切片 | 红 | 绿 |
| --- | --- | --- |
| `StatusDot` → `.presence` | `node --test components/StatusDot.test.mjs` → 5 tests / 1 pass / **4 fail** | 5 pass / 0 fail |
| 原语 class 块 | `node --test components/primitives.test.mjs` → 11 tests / **11 fail** | 11 pass（补 `.av-*` / pulse 断言后 12 pass） |
| `Avatar` | `node --test components/Avatar.test.mjs` → **1 fail**（模块不存在） | 8 pass（走 i18n 后 9 pass） |

既有回归网全程绿：`app/globals.test.mjs`（票 02 的 T-A/T-B/T-C/T-D）**11 pass**；T-C 的
「`@keyframes` 只增不减（≥12）」仍成立（12 组定义、本票净增 0 组）。`components/AgentDetailPanel.test.mjs`
有一条断言按意图改写法（见偏离 D10），其余全绿。

### 门禁（G-impl 第 0–5 条）

| 项 | 结果 |
| --- | --- |
| `npm test`（**全量**，本票动共享的 `globals.css`，不作窄档论证） | 1161 pass / 0 fail（基线 1135） |
| `node_modules/.bin/tsc --noEmit` | exit 0 |
| `npm run lint`（增量对照） | 本票 0 error / 1 warning；基线 = `git merge-base origin/main HEAD` = `5b98e5c` = 本分支起点，同一条 `hooks/useI18n.tsx` 既有警告 → **零新增** |
| `git diff --numstat` | 最大单文件 `app/globals.css` +80/−7（追加段）；其余均为小改或新建测试文件，**无整文件重写** |
| `git status --porcelain` | 交付前为空（`.pi-lens.json` 已进本地 `.git/info/exclude`，不进仓库） |

### 偏离（逐条、带理由）

- **D1 票面 `.tag` / 独立 `.is-on` 未落**：上游 `ui_kits/app/app.css`（424 行）与 `worksplice-app.html`
  的 `<style>` 段都没有独立 `.tag` 规则，独立 `.is-on` 同样不存在。按 D8「不做原型之外的新形态发明」
  与 Change 的「逐字搬运」纪律，不凭票面名字发明原型里没有的 class；`.icon-btn.is-on` 已搬，其余复合态
  随各自容器票（08 / 09）。这是**票面笔误**（同票 02 Answer 的 D5 先例）。若产品所有者仍要一个独立
  `.tag` 原语，请回一句，我按 `.msg-tag` 的声明补块——但那会与票 05/06 各自容器里的 tag 家族形成重复定义。
- **D2 像素槽位不搬**：上游 `.avatar img { image-rendering: pixelated }` 不搬（D6 退役像素头像），
  同时删掉 `globals.css` 里旧方向的 `.pixelated` 规则（唯一消费者随 `PixelAvatar` 一起退役，否则留下死规则）。
  刻意不动 `.avatar img` 的替代形态：那会把「上游自己没用的可选槽位」变成产品里的死代码。
- **D3 `.card` 的拖拽态归票 06**：`.card.dragging` / `.drag-over` / `.invalid-over` 与 6 个看板容器 class
  是票 06 的交付面；本票只落 Change 1 描述的 `.card`（`--surface` + `--border` + `--r-md`）+ `.card:hover`
  （强化边框 + `--shadow-card`），块体逐字含 `cursor: grab` 与 transition（上游那行整体搬）。
- **D4 `StatusDot` 的颜色 class 与内联双写**：形态（7px / 圆角 / 脉冲 / `reduce` 停跳）由 `.presence.working`
  class 提供，颜色按状态内联。原因是票 02 落的 `app/globals.test.mjs` T-D **断的就是 StatusDot markup 里的语义
  token**，而该文件不在本票 Ownership 内；改成纯 class 会让那条既有断言变红。内联只用于「让 token 出现在
  markup 里」，两处值恒等（同一份 token 名）。
- **D5 人类标记「我」走 i18n**：`docs/i18n.md` 的分层规则把「client component 里用户可见的文字 / `aria-label` /
  `title`」定为必须走 `lib/i18n/messages/{en,zh-CN}.ts`、**不得硬编码任何语言**。新增 `avatar.you`
  （zh-CN = 「我」／en = "You"），`Avatar` 用 `t("avatar.you")`；zh-CN 下即票面要求的「我」，en 下不再是
  「英文界面读到中文」。`aria-label` / `title` 仍取成员名（内容层）。
- **D6 `@keyframes pulse` 的 50% 值 0.5 → 0.3**：`.presence.working` 复用仓内既有的 `pulse`（此前零消费者），
  值对齐上游 `app.css` 的同名 keyframe（波形与形态来源一致）。不新增同名 keyframe（重复定义会让前一份变死），
  keyframe 组数因此保持 12。
- **D7 `Avatar` 取 `.av-N` class 而非内联 `var(--av-N)`**：D6 把取色映射交给模块内的纯函数，但**形态载体**仍是
  上游 class 库（`spec.md` 组件表第 9 行：`.avatar` + `.av-0…--av-4`；原型 markup 即 `class="avatar sm av-1"`）。
  于是 `.av-0…--av-4` 五格逐字搬进 `globals.css`、`Avatar` 输出 `av-N`——「同色恒等」由 `Avatar.test.mjs` 的
  确定性断言守，class → token 的绑定由 `primitives.test.mjs` 守（两份断言，不重复）。
- **D8 `ws-status-pulse` 留作死 keyframe**：它在票 04 之前是 `StatusDot` 的内联动画名，`StatusDot` 迁到
  `.presence.working` 后失去消费者，但 T-C 断言 `@keyframes` **只增不减（≥12）**——删它会掉到 11 组并弄红票 02
  的回归网。保留并在此登记（**它是「为满足护栏而留的已知残留」，不是遗漏**）。
- **D9 编辑 `lib/i18n`**：spec 的红线写明「`lib/**`（除 `lib/i18n`）零改动」，D5 的新键落在唯一被解禁的那条路径。
- **D10 `components/AgentDetailPanel.test.mjs` 一条断言按意图改写法**：原断言 `/ws-status-pulse/` 断的是被本票
  替换掉的内联动画名。改写为 `/presence working/` + `/var\(--working\)/`（护栏 = 「working 态在 markup 里可辨识」
  一字未变；不是静默删断言，注释就地写明）。

### 三条红线自查

- `git diff 5b98e5c HEAD --name-only` 的 16 个文件里：`lib/**` 只有 `lib/i18n/messages/en.ts` 与
  `lib/i18n/messages/zh-CN.ts`（spec 明许的唯一 lib 例外，D9）；`app/api/**` **0 个**。
- `grep -rn 'PixelAvatar' components/` → **0 行**（含 `.test.mjs`）。
- `worksplice-design-system/**` **零改动**（`git status --porcelain worksplice-design-system/` 为空）；
  `hooks/useIsMobile.ts` / `spec.md` / 其他票文件零改动。

### 双轴 code-review（两份报告不合并）

**Standards 轴**（独立 reviewer；固定点 `5b98e5c`；diff 落盘 `/tmp/ds04/diff.patch` 供无 shell 的 reviewer 对读）

| finding | 处置 |
| --- | --- |
| P1 硬：`Avatar.tsx` 硬编码「我」违反 `docs/i18n.md` 分层规则 | **已修**（见 D5） |
| P2 硬（流程）：票 04 仍 `pending`、Answer 空 | **已修**（本 Answer + `Status: resolved`） |
| P2 Duplicated Code：`.presence.working` 的色在 class 与内联两处声明 | **豁免**（D4：票 02 的 T-D 断的就是 markup 里的 token，且该文件不在本票 Ownership） |
| P2 Primitive Obsession：`colorKey: number \| string` 一参两义 | **豁免**（spec D6「取色」段明确授权：「有列表序号的调用点传序号，没有序号的调用点传 member.id」；「恒定同色」的意图由 id 路径保住） |
| P2 注释不实（「按仓适配只有分组注释」） | **已修**（注释重写为三条裁剪清单；`.av-*` 已搬；pulse 已对齐） |

**Spec 轴**（独立 reviewer；同固定点）

| finding | 处置 |
| --- | --- |
| 票面 `.tag` 缺交付 | **票面错误**，已登记（D1） |
| T-D 的「未认领 chip 不渲染头像」+「源码级 grep」半做 | **已补**：前者进 `Avatar.test.mjs`（源码级断言）；后者的执行证据见「三条红线自查」（测试源码里刻意不出现该名字） |
| `.av-*` 未逐块搬 | **已修**（D7） |
| `pulse` 用 0.5 而非上游 0.3 | **已修**（D6） |
| scope creep | 无 |

**汇总**：Standards 轴 5 findings（1 条硬违规已修、1 条流程已闭合、3 条判断题中 1 已修 2 豁免）；
Spec 轴 4 findings（1 条票面错误已登记、3 条已修）。跨轴不做单一排序。

### 持久化

- 分支：`whutlichao/ds-04-primitives`
- 提交：`2b8df33`（主体）+ `dc6b671`（review 收口）+ 本票据收敛 commit（`Status: resolved` + 本 Answer）
- PR：**#111**（OPEN，base `main`）
