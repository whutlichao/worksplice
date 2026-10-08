# 设计系统重构：视觉契约、token 映射与实施顺序

日期：2026-10-08 · 票据：`.scratch/design-system-refactor/issues/01-design-system-contract.md`（Type: grilling / 设计票）
性质：**设计票**，本文件不含任何源码改动；改写由后续实施票（本文件的「拆票方案」）落地。
本文件即本 effort 的 spec 正本，位置依 `docs/agents/issue-tracker.md` 的约定（`.scratch/<feature-slug>/spec.md`）。

**零行为改动声明**：消息不可变、freshness-hold、任务状态机、inbox 游标、权限面、agent-loop 语义一字不动。本 effort 只作用于视觉层——token、形态、间距、动效。

## Problem Statement

产品所有者提供了一份新的设计系统资料 `worksplice-design-system/`（30 个文件 / 344KB），方向为 `modern-minimal`（Linear / Vercel 语域）。它是一份**带来源与保真度说明的可执行契约**，不是方向声明：`context/provenance.md` 逐项记录每个值的出处（哪些是逐字摘录、哪些是 SVG 重建），`colors_and_type.css` 与 `tokens.css` 是 oklch token 事实来源，`ui_kits/app/app.css` 是应用层 class 库，`worksplice-app.html`（1865 行自包含原型）是唯一完整的视觉证据。

仓库当前的方向是**马卡龙 × brutalist**，由 `.scratch/worksplice-build/issues/03-shell-and-visual-tokens.md`（Status: resolved）确立并在 `docs/spec.md` §4 逐条标注 **`[锁定] 02`**：cream 底 / yellow 主 / bubble pink CTA 的 12 色板、全局 0 圆角、2px ink 粗边框、硬偏移阴影阶梯（无模糊）、Space Grotesk / Hanken Grotesk / Space Mono 三个 Google 字体、8×8 像素头像。两个方向的**骨架判据互斥**——不是调色差异：旧方向用「墨色结构线 + 直角 + 硬阴影」表达结构，新方向用「发丝分隔 + 小圆角 + 分层表面亮度阶梯（`--bg` → `--panel` → `--panel-2` → `--surface`）」表达结构。二者无法叠加，只能择一。

改判的理由与影响面记在 `docs/adr/0014-visual-direction-modern-minimal.md`。本文件解决改判之后的实施契约：**设计资料怎么进产品、旧 token 名怎么退、Tailwind 去留、30 个组件各自改成什么形态、按什么顺序改、怎么机械证明改对了。**

本文件落笔前需要问明的六条在这里已裁决：交付边界（D1）、上游资料在运行时的角色（D2）、旧 token 名退役（D3）、Tailwind 去留（D4）、响应式断点对齐（D5）、头像形态（D6）；后续三条在同一轮 frontier 之后裁决：class 词汇表（D7）、原型未覆盖界面的外推原则（D8）、拆票与依赖（D9）。

**裁决来源与留痕（须读）**：D1–D7 是**决策类**问题，按 grilling 纪律经 `orchestration ask` 逐条问回人类产品所有者（每条附推荐答案与代价账）。这条访谈经历了两个阶段，两段都留在记录里：

1. **第一阶段（首轮）——未获答复**。7 条问题发出后经 4 次 resume 等待（累计约 2.5 小时）超时，另发 escalation 一次。根因在 **coordinator 侧**：唤醒闹钟被停掉，导致 escalation / 补问 / `worker_done` 静默排队；已修复（闹钟改为按期续装、永不停）。那个阶段按**荐答**落盘——落盘值带完整推理链、被否决备选与代价账，正是这个形态让第二阶段可以「只改一条、无需重做分析」。
2. **第二阶段（本轮）——答复到达并收敛**。人类产品所有者对 7 条逐条答复：**Q1–Q5 与 Q7 与荐答一致，Q6 改判**（头像从「保留像素图案」改为「换首字 tile」，见 D6）。本文件已按答复收敛：D6 的决策行、决策节、User Story、组件表、拆票表、Testing Decisions 全部更新，旧裁决的论证保留在 D6 的「被否决的备选」里（它是改判的语境）。

D8（外推原则）与 D9（拆票）是**spec 作者的产物**（形态推断与排期），不是待决问题。

资料本身**不完整是已知事实**（README 与 DESIGN.md 引用的 6 个文件不存在，`screens/` 与 `fonts/` 是空目录）；处置见 Further Notes 的 Known gaps。

## Solution

裁决表。**来源**列：**产品所有者答复** = 决策类问题经 `orchestration ask` 问回人类产品所有者**并获答复**（问题 ID、逐条答复与轮次记录见票据 `01-design-system-contract.md` 的 `## Answer`），标「一致」或「改判，否决荐答」；**spec 产物** = spec 作者按资料推断的形态与排期。

| 决策 | 裁决 | 来源 |
| --- | --- | --- |
| **D1 交付边界** | **分层落地**：`shell + 原语 + 面板`三层按原型逐字对齐（= 原型覆盖的 15 个 tsx），**遗留 agent 会话面 + 文件面 + 配置面**只换 token / 去 2px ink 边框 / 去 0 圆角，形态结构不动 | 产品所有者答复（Q1 · 与荐答一致） |
| **D2 上游资料的运行时角色** | `worksplice-design-system/colors_and_type.css` 与 `tokens.css` **作为运行时真源被 `@import`**，本仓只叠扩展层；资料目录进入产品构建路径 | 产品所有者答复（Q2 · 与荐答一致） |
| **D3 旧 token 名退役** | **逐处改名，不留别名层**；不同构的三个各给一条明文处置；无对应的四个由扩展层重定义 | 产品所有者答复（Q3 · 与荐答一致） |
| **D4 Tailwind 去留** | **删除**（`@import "tailwindcss"` / `@theme` / PostCSS 插件 / `tailwind.config.ts` / 两个 devDependency），reset 层改由设计系统的 reset 段承担 | 产品所有者答复（Q4 · 与荐答一致） |
| **D5 响应式断点** | **布局对齐上游（1080 / 900），`useIsMobile` 保持 640** | 产品所有者答复（Q5 · 与荐答一致） |
| **D6 头像形态** | **换首字 tile，与上游原型逐字一致；`PixelAvatar` 退役 → 新建 `Avatar`**：人类 owner「我」/ agent 名称首字符（ASCII 转大写），`.avatar` 26px / `.sm` 22px / `.lg` 44px、`border-radius:7px`、`--av-0…--av-4` 按成员确定性取色、「我」恒用 `--av-4` | **产品所有者答复（Q6 · 改判，否决荐答）** |
| **D7 class 词汇表** | 采纳上游 `ui_kits/app/app.css` 的 class 名与 class 块作为 shell / 原语 / 面板三层的形态载体；本仓的 `ws-*` 只保留为**骨架布局钩子**（`.ws-shell` / `.ws-left` / `.ws-center` / `.ws-right` / `.ws-backdrop` / `.ws-mobile-toggle` / `.ws-message-row` / `.ws-message-actions`），不逐字改名 | 产品所有者答复（Q7 · 与荐答一致） |
| **D8 未覆盖面外推** | 十条外推原则（`ED-1…ED-10`），逐条可判定；不做原型之外的新形态发明 | spec 产物 |
| **D9 拆票** | 10 张实施票（`.scratch/design-system-refactor/issues/02…11`），frontier：`02 → {03, 04, 10} → {05, 06, 07, 08, 09} → 11` | spec 产物 |

### D1 交付边界

原型（`worksplice-app.html`）覆盖的界面只有：三栏壳（rail / 中央频道头 + 消息流 + composer / 右 dock）、任务板、搜索视图、通用模态框（新建频道 / 新建任务 / 新建 Agent / 提醒 / 设置 / 频道成员）、命令面板、toast、移动端 topbar。

原型**未覆盖**的 15 个 tsx：`MessageView`、`ChatInput`、`FileExplorer`、`FileViewer`、`FileIcons`、`ModelsConfig`（162 处 inline style）、`PluginsConfig`（83）、`SkillsConfig`（84）、`ModelPicker`、`DirectoryPicker`、`ProjectTrustDialog`、`MermaidBlock`、`ExtensionStatusBar`、`MyRemindersModal`、`MentionText` / `MarkdownBody`。

**裁决 = 分层落地**，理由是三条：

1. 只换 token 值会留下**自相矛盾的中间态**。旧形态的骨架判据（`border-radius: 0 !important`、`2px solid var(--ink)`、`--shadow-md: 4px 4px 0 0 var(--ink)`）与 token 值同处 `app/globals.css` 一块，拆不开；只换值会出现「8px 圆角配 2px ink 边框」。
2. 全量对齐会把本 effort 从「换视觉」膨胀成「重做配置 UI」——遗留三面（`ModelsConfig` / `PluginsConfig` / `SkillsConfig`）合计约 330 处 inline style，是 pi-web 遗留面，与用户诉求（换方向）不成比例。
3. 分层落地让「实施票能证伪的断言」有明确边界：本 effort 的可判定断言只覆盖 shell / 原语 / 面板三层，遗留层只断言「旧 token 名灭绝 + 新 token 有消费点」。

**三层定义**：

| 层 | 内容 | 改造深度 |
| --- | --- | --- |
| **shell** | `AppShell`、`WorkspaceSidebar`、`ChannelView` 的头部与骨架、`DetailPanel` 单槽容器 | 按原型逐字对齐（结构 + 形态） |
| **原语** | 按钮 / icon-btn / 输入 / 徽标 / 标签 / 卡片 / 焦点环 / 状态点 / 头像 / 模态外壳 | 按原型逐字对齐（class 块落盘） |
| **面板** | `ChannelView` 消息流 + composer + reaction + pin 区、任务板两视图、`ThreadPanel`、`AgentDetailPanel`、`SearchView`、四个模态的内容 | 按原型逐字对齐（形态） |
| **遗留** | 15 个未覆盖面（agent 会话面 / 文件面 / 配置面） | 只换 token、去 2px ink 边框、去 0 圆角；形态结构不动，按 `ED-1…ED-10` 外推 |

### D2 上游资料的运行时角色

`app/globals.css` 顶部改为：

```css
@import "../../worksplice-design-system/colors_and_type.css";
@import "../../worksplice-design-system/tokens.css";
```

理由：`DESIGN.md` 的反模式段明写「不许破坏 token 契约（`--bg/--surface/--fg/--muted/--border/--accent`），改名会重新扯断整个 app」——这句话只有在**上游就是那个契约的载体**时才成立。复制一份 `:root` 出来等于把契约变成一份会漂移的转录：以后上游改了值，本仓不知道。

**代价（须知情）**：`worksplice-design-system/**` 从「只读资料」升格为「产品运行时代码」——它进入 Next 的构建图，此后任何票都不能再把它当草稿区随手覆盖。`Change A` 的「逐字不得修改」纪律因此从本票的约束升级为长期不变式。

`ui_kits/app/app.css` **不被 `@import`**（它是 424 行的应用层 kit，含 `.app` / `.rail` / `.main` 等本仓 `AppShell` 已有的骨架职责，直接引入会与 `ws-*` 骨架打架）；它的角色是**逐字对照的形态来源**——class 块按需搬进 `app/globals.css` 的本仓层。这一条同时是 D7 的边界。

### D3 旧 token 名退役

**裁决 = 逐处改名，不留别名层。** 两套名字（新名 + 旧别名）会把「哪个才是契约」变成永久歧义，而上游明写「不许改名」正是为了防这件事。落地拆成两步、可独立验：先落新契约块（含扩展层补齐无对应者），再机械替换调用点。

逐条映射见 Implementation Decisions 的 token 契约映射表；`--bg-selected` 的处置（成对改 fill + fg，而不是只映射底色）见该表末段。

### D4 Tailwind 去留

**裁决 = 删除。** 事实是 Tailwind v4 在本仓近似空转：`@theme` 里 13 个 `--color-*` 别名有**零个消费者**（全仓 `bg-bg-panel` / `text-text-dim` 这类工具类出现 0 次），实际用到的 Tailwind 工具类只有 2 处（`className="text-xs px-2 py-1"`、`className="overflow-x-hidden overflow-y-auto"`）；组件样式 100% 走 inline `style` + `var(--token)`（1144 处）。保留它等于维护一层没有消费者的映射，以后每个读代码的人都要问「这层是干什么的」。

**必须补 reset**：`@import "tailwindcss"` 顺带带进了 preflight（按钮 / 标题 / 列表的浏览器默认样式归零）。上游 `ui_kits/app/app.css` 开头恰好有一段 reset（`*,*::before,*::after{box-sizing:border-box}`、`button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}`、`input,textarea,select{font:inherit}`、`h1,h2,h3{margin:0;font-weight:var(--fw-bold)}`、`code,.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}`、`:focus-visible{outline:2px solid var(--accent);outline-offset:2px}`、`[hidden]{display:none!important}`、scrollbar），把它作为 reset 层搬进本仓——一举两得：既补上 preflight 的空缺，又落上 D5/可访问性要求的焦点环。

被否决的备选：(B) 保留 Tailwind 只换值（留一层没人用的映射）；(C) 分层共存（与上游 `SKILL.md`「用 class 块组装」的配方直接冲突）。

### D5 响应式断点

上游是 **1080px**（dock 380 → 340）与 **900px**（转列 + 抽屉 + scrim + 看板单列）。本仓现状是 `@media (max-width: 960px)`（rail/dock 变滑入浮层）+ `@media (max-width: 640px)`（输入框 16px 防 iOS 缩放）+ `hooks/useIsMobile.ts` 的 **640px**。

**裁决 = 布局对齐上游、hook 不动**：抽屉断点 `960 → 900`，新增 `≤1080px` 的 dock 收窄（消费 `--dock-w-md: 340px`），`useIsMobile` **保持 640**。

理由：`useIsMobile` 的消费者只有 4 个（`ModelsConfig` / `SkillsConfig` / `PluginsConfig` / `ChatInput` 的移动分支）——把断点抬到 900 会让 640–900 区间里三个配置面切到移动分支，而这三面正是 D1 里划到「只换 token、形态不动」的那一层，窄屏形态不重做就会坏。代价：`useIsMobile` 与布局断点不再同值，需要在 hook 注释里写明「这是**配置面的紧凑断点**，不是布局断点」，避免下一个人「顺手对齐」。

被否决：全量对齐（需把「三个配置弹窗的窄屏形态重做」补成第 11 张票，超出本 effort 的视觉改判范围）；只加 1080 收窄（留下 900 与 960 两套上游/本仓数字并存）。

### D6 头像

上游原型的实测形态：**方 tile + 首字**——`.avatar{width:26px;border-radius:7px;display:grid;place-items:center;font-size:11px;font-weight:700;color:var(--fg);overflow:hidden}`，`.avatar.sm` 22px、`.avatar.lg` 44px，5 色 `--av-0…--av-4` 按成员序号确定性取色、「我」恒用 `--av-4`；尺寸 token 是 `--avatar-sm:22px` / `--avatar-md:26px` / `--avatar-lg:44px`。同一规则里另有 `.avatar img{width:100%;height:100%;display:block;image-rendering:pixelated}` —— 一个**上游自己没用的可选槽位**。

**裁决 = 换首字 tile，与上游原型逐字一致；`PixelAvatar` 退役。** 头像 = 方 tile + 首字：人类 owner 显示「我」，agent 显示名称首字符（ASCII 名转大写）。外壳取 `.avatar` / `.avatar.sm` / `.avatar.lg`，7px 圆角、无 2px ink 边框与硬阴影。

**产品所有者答复（改判，否决荐答）**：首轮我荐答「保留 8×8 像素图案作内容、只换 tile 外壳」，答复选 B「换首字 tile」，并**接受**「同首字母成员不可区分」（原型 demo 里 `Susan` / `Sentry` 都是 `S`）这一代价。这是本轮**唯一**改判：D1–D5、D7 与荐答一致。

#### 尺寸与形态（消费上游的尺寸 token，替换本仓的 `28 \| 40 \| 44 \| 48`）

| 形态 | token | 圆角 | 字号 | 用在哪 |
| --- | --- | --- | --- | --- |
| `.avatar.sm` | `--avatar-sm` 22px | 7px | 10px | rail 的 agent 行、成员挑选项、搜索结果行、任务 owner chip |
| `.avatar` | `--avatar-md` 26px | 7px | 11px | 消息作者行 |
| `.avatar.lg` | `--avatar-lg` 44px | `--r-md` 8px（上游 `.avatar.lg` 显式覆盖） | 16px | dock 头部（agent 详情 / 人类资料卡） |

字重照上游 `700`，字色 `var(--fg)`，`display:grid; place-items:center`，`overflow:hidden`。

#### 取色

`--av-0…--av-4` 五色，按**成员身份确定性**取——同一成员在本仓任何位置恒定同色；「我」（人类 owner / `CURRENT_MEMBER_ID`）恒用 `--av-4`（`MemberRow.type === "human"` 即人类面）。

**取色的具体落法是代答（答复只说了「按成员序号取色」）**：序号是上游原型的做法（`av(AGENTS.indexOf(m))`），但真实产品的列表顺序随成员增删漂移，且 7 个调用点里有 5 个根本没有列表上下文。落法是：**有列表序号的调用点传序号，没有序号的调用点传 `member.id`，由模块内一个纯函数做确定性映射**——「恒定同色」这个**意图**保住了，「序号」这个**手段**降级为可选。产品所有者若要求严格按序号，需要在票 04 之外**新增 props 与查询**（属行为改动，触本 effort 的零行为改动红线），因此不在本 effort 内。

#### `PixelAvatar.tsx` 的处置 = 退役，改建 `Avatar.tsx`

裁决：**新建 `components/Avatar.tsx`（导出 `Avatar`），删除 `components/PixelAvatar.tsx`**；不保留旧名做原地改造。理由三条：

1. 7 个调用点的 props 全都要换（`seed` → 名称 + 取色参数），本来就没有「零改动」的迁移路径；
2. 名字与内容不符是**真实的维护成本**——本 effort 已经在 `--border`（同名不同物）上吃过一次这个亏，把「名字说谎」当成新债留下来与刚立的规矩冲突；3. 一次机械的 import 替换（7 处）换掉一个会误导人的模块名，收益是长期的；locality 不受影响（新模块仍在 `components/` 同层、接口同样窄）。

`PixelAvatarSize`（`28 \| 40 \| 44 \| 48`）随之退役，换成 `AvatarSize = "sm" \| "md" \| "lg"`。仓库 30 个 tsx 的计数不变（一个模块退役、一个模块新建）。

#### 消费者清点（7 个调用点，逐个点名）

`grep -rn 'PixelAvatar' components/*.tsx` 的**每一处**在新形态下的处置：

| 调用点 | 现值 | 新形态 | 取色参数 |
| --- | --- | --- | --- |
| `components/WorkspaceSidebar.tsx:460`（rail 的 agent 行） | `seed={agent.id} name={agent.name} size={28}` | `<Avatar name={agent.name} size="sm" />`（22px） | 该 agent 在 `agents` 列表里的序号 |
| `components/CreateChannelModal.tsx:181`（成员挑选项） | `seed={agent.id} name={agent.name} size={28}` | `<Avatar name={agent.name} size="sm" />`（22px） | 该 agent 在 `agents` 列表里的序号 |
| `components/SearchView.tsx:202`（搜索命中作者） | `seed={hit.author_id} name={hit.author?.name} size={28}` | `<Avatar name={hit.author?.name} size="sm" />`（22px） | `hit.author_id`（无列表序号）；名称 `undefined` → 占位 `?`，`aria-label` 回退到 `hit.author_id` |
| `components/ChannelView.tsx:1288`（任务 owner chip） | `seed={task.owner_id ?? "none"} name={task.owner?.name ?? "?"} size={28}` | 有 owner → `<Avatar name={task.owner?.name} size="sm" />`（22px）；**未认领 → 不渲染头像** | 有 owner → `task.owner_id`；否则不适用 |
| `components/ChannelView.tsx:910`（消息作者） | `seed={message.author_id} name={message.author?.name ?? "?"} size={40}` | `<Avatar name={message.author?.name} size="md" />`（26px） | `message.author_id`；作者是 owner → `--av-4` |
| `components/AgentDetailPanel.tsx:708`（dock 头部） | `seed={agent.id} name={agent.name} size={44}` | `<Avatar name={agent.name} size="lg" />`（44px） | `agent.id` |
| `components/DetailPanel.tsx:117`（人类资料卡） | `seed={member.id} name={member.name} size={44}` | `<Avatar name={member.name} size="lg" />`（44px） | `member.type === "human"` → `--av-4` |
| `components/PixelAvatar.tsx`（模块自身） | （旧）8×8 像素图案生成器 | **删除**，由 `components/Avatar.tsx` 取代 | — |

**未认领任务那条的处置说明**：`task.owner_id ?? "none"` 现在会把「未认领」画成一个问号头像。新形态下「未认领」渲染 `t("tasks.unassigned")` 文案、不渲染头像——这不是新行为，是把已有的兜底值（`?? "?"`）还原成它本来的语义（占位文案，不是一个成员）。

**迁移必须原子上线**：`PixelAvatar.tsx` 的删除与 7 个调用点的切换**同在票 04 内完成**（不能拆到各自的容器票里——中间态会让树编译不过）。票 03 / 05 / 06 / 07 / 08 / 09 不重复迁移，只负责**重校自己容器里那处头像的尺寸与行高**：`WorkspaceSidebar` rail 行（票 03）、`ChannelView` 消息行（票 05）、任务 owner chip 与未认领分支（票 06）、两处 dock 头像（票 07）、成员挑选项（票 08）、搜索命中行（票 09）——各票的验收清单已逐条列出。

**两个可见的尺寸变化（须知情）**：消息作者头像 40 → 26px、rail 行头像 28 → 22px，两处行高会跟着变。这是「与上游逐字一致」的必然结果（上游消息作者头像就是 26px、rail 行就是 `.sm`），但会动到 `ChannelView`（票 05）与 `WorkspaceSidebar`（票 03）的行高。**已验证无测试耦合**：`components/*.test.mjs` 里没有任何断言提到 avatar / `PixelAvatar`。

#### 被否决的备选（保留完整论证，它是改判的语境）

**（否决）保留 8×8 像素图案作内容、只换 tile 外壳**：`PixelAvatar` 继续做头像内容，外壳改成 7px 圆角方 tile、去 2px ink 边框与硬阴影、底色由 seed 哈希取马卡龙 6 色改为 `--av-*`。

荐答方的论证（保留在此，不删）：(a) 上游反模式只禁「圆形头像」「药丸卡片」，**未禁**像素，所以像素并不违规；(b) 8×8 图案是本仓「成员身份的确定性视觉」的唯一载体（seed → 图案），去掉它之后「谁是谁」退化成首字母——原型 demo 里 `Susan` 与 `Sentry` 首字母都是 `S`，两者头像将完全相同；(c) 上游 `.avatar img{image-rendering:pixelated}` 这个槽位从此无人使用（它仍留在 `ui_kits/app/app.css` 里，因为上游资料逐字不改）。

选首字 tile 的理由（产品所有者本轮的首要判据）：与设计稿原型**逐字一致**。两者不可兼得，取一致性。

### D7 class 词汇表

上游 `ui_kits/app/app.css` 的 class 清单（`.app` / `.rail` / `.nav-row` / `.btn` / `.btn-primary` / `.icon-btn` / `.badge` / `.avatar` / `.presence` / `.chan-head` / `.msg` / `.msg-tools` / `.reactions` / `.task-chip` / `.composer-box` / `.board` / `.col` / `.card` / `.dock*` / `.tt-*` / `.overlay` / `.modal` / `.field` / `.input` / `.search-field` / `.toast` / …）**作为 shell / 原语 / 面板三层的形态载体**逐块搬进 `app/globals.css` 的本仓层。

本仓的 `ws-*`（12 个）只保留**骨架布局钩子**：`.ws-shell` / `.ws-left` / `.ws-center` / `.ws-right` / `.ws-backdrop` / `.ws-mobile-toggle` / `.ws-sidebar-close` / `.ws-center-header` / `.ws-message-row` / `.ws-message-row-anchor` / `.ws-message-actions` / `.ws-message-actions-open`。理由：它们被 `components/*.tsx` 的 `className` 直接引用，改名会把「视觉重构」变成「30 个 tsx 的机械重命名」，而重命名**不产生任何视觉收益**——locality 收益只落在「新 class 块与上游逐字对照」这一件事上，骨架钩子不参与上游对照。

**不加前缀的通用名（`.card` / `.field` / `.input`）落进本仓的注意点**：本仓没有 CSS Modules、`globals.css` 是全局作用域，所以 `.card` / `.field` / `.input` 这类名字会全局生效。裁决是**接受**（上游就是全局 class 库；本仓的遗留面用 inline style + `ws-*` / `markdown-*` / `mermaid-*` / `file-viewer-*` 命名，与这批通用名无碰撞），但 `ED-7` 要求每次搬运前 grep 一次新 class 名在本仓的既有出现，避免覆盖。

### D8 未覆盖面外推原则

原型未覆盖的界面按以下十条外推（每条可判定，实施票的验收据此）：

- **ED-1 表面分层照抄上游亮度阶梯**：页面画布 `--bg`、卡片与 chrome `--surface`、栏与 well `--panel`、嵌套 well 与 chip `--panel-2`；不新造第五档。遗留面的 `--bg-panel` → `--panel`、`--tool-bg` → `--panel`（或 `--panel-2`，视嵌套深度）。
- **ED-2 分隔一律发丝**：`1px solid var(--border)`；交互控件（输入 / composer / 可点卡片）用 `--border-strong`。**禁止**任何 2px ink 边框。
- **ED-3 圆角只从 `--r-sm/--r-md/--r-lg/--r-xl/--r-pill` 里选**：行与 chip 用 `--r-sm`（6px），按钮 / 输入 / 卡片用 `--r-md`（8px），composer / 模态 / 栏用 `--r-lg`（12px），模态大档用 `--r-xl`。药丸形只给计数、标签、状态与 reaction chip。
- **ED-4 阴影只在分层表面**：`--shadow-composer`（常驻输入框）、`--shadow-card`（卡片 hover）、`--shadow-pop`（弹层 / 模态 / 抽屉）。**静止内容不加阴影**。
- **ED-5 字号取自 `--fs-*` 标尺，正文 13px**：`--fs-sm`（12px）chip / 列表行 / 辅助文字，`--fs-caption`（11.5px）卡片元信息与字段提示，`--fs-body`（13px）消息与正文，`--fs-body-lg`（13.5px）品牌名与空态标题，`--fs-title`（14px）面板标题，`--fs-heading`（16px）频道标题，`--fs-mono-xs`（10.5px）时间戳与计数，`--fs-mono-micro`（9.5px）大写分组标签，`--fs-stat`（17px）统计数字（mono + `tabular-nums`）。**不许把 13px 正文吹大**。
- **ED-6 mono 是结构声部**：一切标识符、时间戳、计数、token 度量、key/value 行、大写分组标签都用 `var(--mono)` + `font-variant-numeric: tabular-nums`。
- **ED-7 hover 不降对比**：表面往亮处走（`--surface` 填充、`--border` → `--border-strong`），文字往 `--fg` 走，**永不**往 `--muted` 走。禁用态是唯一允许降对比的状态（`.btn:disabled{opacity:.45}`）。搬运通用 class 名（`.card` / `.field` / `.input`）前先 grep 本仓既有出现。
- **ED-8 每个可聚焦元素都有 `:focus-visible` 环**：`outline: 2px solid var(--accent); outline-offset: 2px`；字段与 composer 改用 `0 0 0 3px var(--accent-soft)` 环。
- **ED-9 动效短、且尊重 `prefers-reduced-motion`**：`background/border/color` 0.1–0.12s（`--dur-fast` / `--dur`），抽屉 `transform` 0.2s（`--dur-drawer`），缓动 `--ease`；每个 keyframe 与 transition 都要有 `reduce` 收敛。
- **ED-10 颜色只在有语义时出现**：`--online/--working/--error/--offline` 是成员状态点与任务状态的专用色（任务映射 `todo→--faint`、`in_progress→--accent`、`in_review→--working`、`done→--online`、`closed→--offline`，取自原型 JS 的 `STATUS_COLOR`），其余一律用中性阶梯 + `--accent`。**不引入第二强调色、不引入渐变、不引入 hex/rgb 字面量**。

**具体到遗留面的典型落法**（不穷举，实施票按此推断）：

| 遗留面 | 形态保持 | 必须发生的改变 |
| --- | --- | --- |
| `MessageView` / `ChatInput` | 消息气泡布局、输入条结构、附件 chip、mention 补全菜单 | `--text*` / `--bg*` / `--border` / `--accent` 改名；气泡去 2px ink 边框改发丝 + `--surface`；输入框加 `--accent-soft` 焦点环；气泡圆角 `--r-md`；`--user-bg` / `--assistant-bg` / `--tool-bg` → `--surface` / `--panel` |
| `MarkdownBody` / `MermaidBlock` | 标题阶梯、代码块、表格、折叠块 | `--text-dim` → `--faint`；代码块底 = `--panel-2`、边框 = `--border`、圆角 `--r-md`；`.linenumber` 用 `--faint`；mermaid 工具栏按钮 = `.icon-btn` 形态 |
| `FileExplorer` / `FileViewer` / `FileIcons` / `DirectoryPicker` | 树结构、面包屑、模式切换、行内图标 | 去 2px ink 边框；树行 hover 走 `--fg-soft`；选中行走 `--accent-soft` 底 + `--accent` 文字（**不**用黄色实心）；`.file-viewer-toolbar` 高度对齐 `--control-h` |
| `ModelsConfig` / `PluginsConfig` / `SkillsConfig` / `ModelPicker` | 三面的结构、分组、表单流、弹窗尺寸逻辑 | 颜色与边框全量换 token；输入 / 下拉 / 复选去 2px ink 边框改 `--border-strong` + `--r-md`；主按钮 = `.btn.btn-primary`（`--accent` 底 + 浅 ink）；`useIsMobile` 断点不动（D5） |
| `ProjectTrustDialog` | 对话结构、按钮序 | 模态外壳换 `.overlay` + `.modal`（若它自带外壳则只换 token）；危险动作 = `.btn-danger`（`--error`） |
| `ExtensionStatusBar` | 状态条布局 | 去 2px ink 边框改 `border-top: 1px solid var(--border)`；状态色走 `--online` / `--working` / `--error` / `--offline` |
| `MyRemindersModal` | 列表结构、snooze/cancel 动作 | 与原型「提醒」模态同族：`.overlay` + `.modal` + `.d-sec` + `.log-row` 形态；时间戳 mono |

### D9 拆票

10 张实施票，文件编号 `02…11`（`01` 是本设计票），frontier = `02 → {03, 04, 10} → {05, 06, 07, 08, 09} → 11`。逐票的交付面与阻塞边见 Implementation Decisions 的「拆票方案」。

## User Stories

1. 作为产品所有者，我打开应用时看到的是我提供的那份设计系统（近白纸面、13px 密度、发丝分隔、小圆角、单一 indigo 强调色），而不是上一版的马卡龙 × brutalist——两个方向不会在同一屏上并存出「8px 圆角配 2px 墨线」这种自相矛盾的面。
2. 作为将来改视觉的人，我在 `app/globals.css` 顶部看到 `@import "…/worksplice-design-system/colors_and_type.css"`，因此知道改 token 只有一处可改——上游资料就是契约本身，不是一份会漂移的转录。
3. 作为将来改视觉的人，我 grep `var(--text)` 时得到 0 结果，因此不需要在「旧名还是新名」之间做判断，也不会写出「新代码用新名、旧代码用旧名」的双轨。
4. 作为将来读仓库的人，我看到 `app/globals.css` 顶部没有 Tailwind，`package.json` 里没有 `tailwindcss`，因此不会误以为这套 class 需要 Tailwind 才能工作——也不会去维护那层零消费者的 `@theme` 别名。
5. 作为成员，我在窄窗口（≤1080px）里看到右栏收窄到 340px，因此中央消息流不会被挤扁；在 ≤900px 里看到 rail 与 dock 变成带 scrim 的抽屉、看板堆成单列。
6. 作为在**配置弹窗**里操作的人，我在 640–900px 的窗口里仍然拿到配置面的桌面形态（不是被 `useIsMobile` 突然切到未经重做的移动分支），因为布局断点与配置面密度断点是两件事。
7. 作为成员，我在任意列表 / 卡片 / 消息行 / dock 里都看到与设计稿一致的方 tile 头像（首字 + 五色 tint），且同一成员在 rail、消息流、任务卡片、搜索结果与 dock 里**恒定同色**——颜色告诉我「是不是同一个人」，而不是靠一个会撞名的首字母。
8. 作为用键盘的人，我 Tab 到任意可聚焦元素时都看到 indigo 焦点环，href/按钮/输入无例外。
9. 作为开了「减少动态效果」的人，脉冲状态点与抽屉过渡都收敛，没有残留的无限动画。
10. 作为审计这套改判的人，我读 `docs/adr/0014-visual-direction-modern-minimal.md` 就知道被推翻的是什么、为什么推翻、影响哪些面、怎么回滚。

## Implementation Decisions

### 1. token 契约映射（逐条，覆盖 Change B 点名的高用量旧 token）

计数口径：`app/**` + `components/**` + `hooks/**` + `lib/**` 的 `.tsx/.ts/.css` 里 `var(--<名>)` 的出现次数（本 worktree，base `c73c90b`）。

#### 1a. 语义同构 → 改名

| 旧 | 旧值 / 用量 | 新 | 处置 |
| --- | --- | --- | --- |
| `--bg` | `var(--cream)` = `#fffaef` · 62 | `--bg` | **同名同义**（页面画布）；值改为 `oklch(99% 0.002 240)`。调用点零改写 |
| `--bg-panel` | `#fffdf5` · 65 | `--panel` | 语义同构（栏 / 列 / well）。**层次方向翻转**：旧 `--bg-panel` 比 `--bg` **亮**，新 `--panel`（97.4%）比 `--bg`（99%）**暗**——上游用「`--bg` → `--panel` → `--panel-2` → `--surface`」的亮度阶梯表达深度，不是「主底 + 更亮的副底」。这条翻转是本映射最容易被漏掉的一条 |
| `--text` | `var(--ink)` · 134 | `--fg` | 语义同构 |
| `--text-muted` | `#6f6a5e` · 157 | `--muted` | 语义同构 |
| `--text-dim` | `#a39d8d` · 209 | `--faint` | 语义同构（tertiary / meta / placeholder）。**全仓用量最大的旧 token**，40 处在 `ModelsConfig`、31 处在 `MessageView`、24 处在 `ChatInput` |
| `--accent` | `var(--pink)` · 83 | `--accent` | 同名不同值：bubble pink → indigo-blue `oklch(56% 0.17 256)`。调用点零改写，观感全变 |
| `--accent-hover` | `#f56293` · 1 | `--accent-hover` | 同名不同值：`oklch(50% 0.17 256)` |
| `--border` | `var(--ink)` · 168 | `--border` | **同名不同物**：旧 = `2px solid var(--ink)`（墨色粗结构线），新 = `1px solid oklch(92% 0.006 250)`（发丝）。168 处调用点**不需改名，但每一处的宽度与颜色都要重写**——这是本映射最高风险的「同名陷阱」，实施票必须逐处过一遍（`grep -n 'solid var(--border)\|2px solid'`） |

#### 1b. 语义不同构 → 明文处置

| 旧 | 旧值 / 用量 | 处置 |
| --- | --- | --- |
| `--bg-hover` | `#f5edd9` · 45 | **无对应。** 上游没有 hover 表面 token；它的 hover 契约是「表面往亮处走（`--surface` 填充）+ 边框 `--border` → `--border-strong`」。本仓这 45 处要的是「hover 时比底色深一档」，统一改走上游契约内的 `--fg-soft`（`color-mix(in oklch, var(--fg) 5%, transparent)`），与 `--bg-subtle` 合并到同一处置 |
| `--bg-selected` | `var(--yellow)` · 21 | **无对应，且必须成对改。** 旧语义是「黄色实心底 + 墨色字」（选中即高亮），新方向里选中是「`--accent-soft` 淡底 + `--accent` 文字」。只映射底色会得到「11% 淡底 + 将近黑字」——选中态消失。**fill 与 fg 一起改**：`background: var(--accent-soft)` + `color: var(--accent)`（或 `--fg` 视层级） |
| `--bg-subtle` | `rgba(20,17,17,0.04)` · 9 | `--fg-soft`（语义等价：都是「主文字色 4–5% 的极淡填充」） |
| `--user-bg` | `#ffffff` · 2 | `--surface`。上游没有「按作者分面」的表面 token；消息行统一 `--surface`，作者区分走 `.msg-author.is-agent` 的 accent 文字色与 `.msg-tag` 胶囊，**不靠底色** |
| `--assistant-bg` | `#ffffff` · 1 | `--surface`（同上） |
| `--tool-bg` | `#fbf4e2` · 2 | `--panel`（工具结果块 = 嵌套 well）；若它嵌在已有 `--panel` 容器内则用 `--panel-2` |

#### 1c. 退役（无替身，按下表重导语义）

| 旧 | 旧值 / 用量 | 退役后的去向 |
| --- | --- | --- |
| `--ink` | `#141111` · 22 | **三合一拆开**：文字 → `--fg`；边框 → `--border` / `--border-strong`；硬阴影色 → 阴影 token 自带（`oklch(21% 0.02 255 / …)`）。ink 同时是三者是旧方向的形态前提（墨色结构线），新方向里三者各自独立 |
| `--yellow` | `#ffd440` · 44 | 语义**分裂**：「当前位置」（导航选中、tab 激活、锚点行高亮）→ `--accent-soft` 底 + `--accent` 文字/条；「正在干活」（状态点脉冲）→ `--working`（琥珀 `oklch(74% 0.15 78)`）。这两个语义在旧方向里共用一个色，新方向必须分开 |
| `--pink` | `#fe7da8` · 10 | 语义分裂：「行动」→ `--accent`；「危险」→ `--error`（旧方向里 `--pink` 与 `--coral` 都在当危险色） |
| `--coral` | `#f97264` · 18 | `--error`（`oklch(60% 0.19 27)`） |
| `--cyan` | `#27ccf3` · 7 | 无独立 info 色（上游状态色只有四个）→ 信息态降至中性，需要强调时用 `--accent` |
| `--orange` | `#f8a16f` · 1 | `--working` |
| `--lime` | `#a9d877` · 4 | `--online` |
| `--lavender` | `#bbafe6` · 0 | 零消费者，直接删 |
| `--stone` | `#c9c7c2` · 1 | `--offline`（成员离线）或 `--faint`（次级文字），按调用点语义择一 |
| `--cream` | `#fffaef` · 1 | 无 cream 概念；`--bg` 即画布 |
| `--success` | `oklch(71.4% .176 153.079)` · 1 | `--online`（上游 `--online` = agent idle / granted / success，语义更宽） |
| `--warning` | `oklch(70% .202 44.441)` · 0 | `--working`（零消费者） |

#### 1d. 字体与阴影

| 旧 | 用量 | 新 | 处置 |
| --- | --- | --- | --- |
| `--font-space-grotesk` | 20 | `--font` | `DESIGN.md` §3 把系统字体栈列为**刻意裁决**（CJK 原生渲染，不装 webfont），并写进反模式（「不许用渲染不了 CJK 的 webfont」）。`next/font/google` 三个字体整体退役 |
| `--font-hanken` / `--font-hanken-grotesk` | 46 / 2 | `--font` | 同上；上游「No display serif, no third family」 |
| `--font-space-mono` | 67 | `--mono` | 上游 mono 也是系统栈（`ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas`） |
| `--font-mono` | 81 | `--mono` | 同名不同值（旧值前缀是 `next/font` 注入的 Space Mono） |
| `--font-grotesk` | 0 | `--font` | 零消费者 |
| `--font-sans` / `--font-display` / `--font-mono-font`（`@theme` 层） | 0 | — | 随 Tailwind 一并退役 |
| `--shadow-sm` / `--shadow-md` / `--shadow-lg` / `--shadow-pressed` | 2 / 1 / 0 / 0 | `--shadow-card` / `--shadow-pop` / `--shadow-composer` | 旧阶梯表达**交互**（hover 抬起、按压 1px）；新的三个表达**表面分层**（卡片 hover / 弹层 / 常驻输入框）。新契约**没有「按压」档**——上游按压缩小用 `.btn:active` 的位移，不靠阴影。旧值 `Npx Npx 0 0 var(--ink)`（无模糊硬偏移）整体作废 |

#### 1e. `@theme` 命名空间

`@theme` 里的 13 个 `--color-*` 别名（`--color-bg` / `--color-bg-panel` / `--color-bg-hover` / `--color-bg-selected` / `--color-border` / `--color-text` / `--color-text-muted` / `--color-text-dim` / `--color-accent` / `--color-accent-hover` / `--color-user-bg` / `--color-assistant-bg` / `--color-tool-bg` / `--color-bg-subtle`）与 12 个马卡龙色（`--color-cream` … `--color-stone`）**全部随 Tailwind 退役**（D4）——它们的消费者数为 0，不产生任何视觉账。

#### 1f. 新契约里**没有旧对应**的 token（需要新增消费点，或保持未用）

`--surface`、`--panel-2`、`--border-strong`、`--accent-soft`、`--accent-line`、`--online`、`--working`、`--error`、`--offline`、`--av-0…--av-4`、`--fg-soft`、类型标尺（`--fs-*` 10 档 / `--lh-*` 5 / `--fw-*` 6 / `--ls-*` 4）、`--sp-1…--sp-12`、`--r-sm/--r-md/--r-lg/--r-xl/--r-pill`、`--control-h` / `--control-h-sm` / `--control-h-lg`、`--tap-min`、`--icon-btn`、`--avatar-sm/md/lg`、`--rail-w`、`--dock-w` / `--dock-w-md`、`--stream-max`、`--board-col-w`、`--modal-max` / `--modal-wide-max` / `--cmd-max`、`--z-topbar/scrim/rail/dock/overlay/toast`、`--dur-fast` / `--dur` / `--dur-drawer`、`--ease`。

其中**有当前需求但现在是硬编码字面量**的（实施票必须把字面量换成 token，否则「契约进了产品却没人用」）：

| 新 token | 现在的硬编码落点 |
| --- | --- |
| `--rail-w`（252px） | `.ws-left { width: 236px }`（`app/globals.css:907`） |
| `--dock-w` / `--dock-w-md` | `.ws-right { width: min(480px, 44vw) }`（`app/globals.css:924`） |
| `--control-h`（32px） | 各组件 inline style 的 32/34/36/40 |
| `--r-*` | 全局 `* { border-radius: 0 !important }`（`app/globals.css:105`）压掉了所有圆角 |
| `--z-*` | `.ws-mobile-toggle` 的 `z-index: 300`、`.ws-left`/`.ws-right` 的 `500`、`.ws-backdrop` 的 `490` |
| `--dur*` / `--ease` | 抽屉的 `transition: transform 0.2s ease, box-shadow 0.2s ease`、消息行的 `transition: background 0.12s ease` |
| `--avatar-sm` / `--avatar-md` / `--avatar-lg`（22 / 26 / 44px） | `PixelAvatarSize = 28 \| 40 \| 44 \| 48`（`components/PixelAvatar.tsx:7`）与 7 个调用点的字面量尺寸——由票 04 新建的 `Avatar.tsx` 改为 `AvatarSize = "sm" \| "md" \| "lg"`（D6） |
| `--fs-*` | `html,body { font-size: 14px }`、`.markdown-body { font-size: 14px }`（新正文 13px） |

### 2. Tailwind 卸载清单（D4 的落地面）

| 文件 | 动作 |
| --- | --- |
| `app/globals.css:1` | 删 `@import "tailwindcss";`；替换为 D2 的两条 `@import` + reset 段（搬 `ui_kits/app/app.css` 的 reset） |
| `app/globals.css:3-47` | 删整个 `@theme` 块 |
| `postcss.config.mjs` | 删 `"@tailwindcss/postcss"` 插件（`plugins: {}`） |
| `tailwind.config.ts` | 删文件（v4 不用它；它现在也不被任何入口引用） |
| `package.json` | 删 `tailwindcss` 与 `@tailwindcss/postcss` 两个 devDependency |
| `components/MarkdownBody.tsx` | `className="text-xs px-2 py-1"` → 本仓 class 或 inline style |
| `components/ChannelView.tsx` | `className="overflow-x-hidden overflow-y-auto"` → 本仓 class（`MobilePwaLayout.test.mjs` 正断了这个字符串，见 Testing Decisions） |

### 3. 30 个组件的目标形态、分层与改造顺序

**分层**（D1）+ **形态来源**（上游 class 块）：

| # | 模块 | 层 | 目标形态（上游对照） | 顺序 |
| --- | --- | --- | --- | --- |
| 1 | `AppShell.tsx` | shell | `.app { display:flex; height:100dvh; overflow:hidden }`；`ws-*` 骨架消费 `--rail-w` / `--dock-w(-md)` / `--z-*` / `--dur-drawer` | T2 |
| 2 | `WorkspaceSidebar.tsx` | shell | `.rail`（`--panel` 底 + 右发丝）/ `.rail-head` / `.brand` + `.brand-mark` + `.brand-name` + `.brand-sub` / `.search-btn` / `.rail-actions` / `.group-label`（mono 9.5px + `letter-spacing .1em`）/ `.nav-row`（激活 = `--surface` 填充 + inset 发丝 + 2px accent `::before` 竖条 + accent mono `#`）/ `.rail-foot` | T2 |
| 3 | `ChannelView.tsx` | panel | `.chan-head`（`--surface` 底 + 下边发丝）/ `.chan-top` / `.chan-title`（16px / 680 / `letter-spacing -.02em`，`#` 号是 accent mono）/ `.chan-desc` / `.chan-tools` / `.chan-divider` / `.pin-strip`（`--panel` callout + accent pin 图标）/ `.day-sep` / `.msg`（hover `--fg-soft` 填充）/ `.msg-head` / `.msg-author`（`.is-agent` → accent）/ `.msg-tag`（"Agent" 胶囊）/ `.msg-time`（mono 10.5px）/ `.msg-body` / `.msg-text` / `.msg-tools`（绝对定位、hover/focus 才出、`--shadow-pop`）/ `.reactions` / `.reaction` / `.task-chip` / `.composer` / `.composer-box`（`--surface` + `--border-strong` + `--r-lg` + `--shadow-composer`，`:focus-within` → `0 0 0 3px var(--accent-soft)`）/ `.composer-bar` / `.composer-hint` / `.composer-send`（accent 方块） | T4 |
| 4 | `ChannelView.tsx` 的任务板段 | panel | `.board-wrap` / `.board-toolbar` / `.seg`（看板 / 列表分段控件）/ `.filter-chip` / `.board` / `.board-cols` / `.col`（236px `--panel`）/ `.col-head` / `.col-body` / `.card`（`--surface` + `--border` + `--r-md`；hover 强化边框 + `--shadow-card`）/ `.card-num`（mono）/ `.card-title` / `.card-meta` / `.card-owner` / `.card-tag` / `.drop-hint`（虚线空槽）/ 拖拽 `.drag-over`（accent）/ `.invalid-over`（`--error`）/ 拖拽中 `opacity:.4` | T5 |
| 5 | `DetailPanel.tsx` | shell | 单槽容器，`--surface` 底 + 左发丝；`--r-lg` 只作用于内部区块，容器本身不吃圆角 | T6 |
| 6 | `ThreadPanel.tsx` | panel | `.tt-summary`（sticky）/ `.tt-status`（状态胶囊，色取 ED-10 的任务映射）/ `.assignee`（胶囊，内嵌 `.avatar.sm`）/ `.tt-actions`（chip 行）/ `.tt-log`（时间线，`ok`/`warn`/`err`/`is-now` 四种点）/ `.tt-reply`（sticky composer） | T6 |
| 7 | `AgentDetailPanel.tsx` | panel | `.dock-head` / `.dock-id` / `.avatar.lg` / `.dock-name` / `.dock-role`（`.presence` + 文字）/ `.icon-btn` 关闭 / `.dock-tabs` / `.dock-tab`（下划线 tab，mono 计数转 accent）/ `.dock-scroll` / `.d-sec` + `.d-sec-title`（mono 大写）/ `.kv`（点线引导的 key/value 行）/ `.meter` / `.stat-grid`（2×2，数字 mono 17px/700 `tabular-nums`）/ `.log-row` + `.lv`（级别标签） | T6 |
| 8 | `StatusDot.tsx` | 原语 | `.presence.{online\|working\|error\|offline}`：7px 圆点，`online` → `--online`、`working` → `--working` + `pulse 1.5s`（`reduce` 下 `animation:none`）、`error` → `--error`、`offline` → `--offline`。**去掉 2px ink 边框与 9px 尺寸** | T3 |
| 9 | ~~`PixelAvatar.tsx`~~ → **`Avatar.tsx`（新建）** | 原语 | `.avatar`（`--avatar-md` 26px / `.sm` = `--avatar-sm` 22px / `.lg` = `--avatar-lg` 44px，`border-radius:7px`，`display:grid; place-items:center`，`font-weight:700`，`color:var(--fg)`，`overflow:hidden`）+ `.av-0…--av-4`；内容 = **首字**（人类 owner「我」/ agent 名称首字符）；`PixelAvatar.tsx` **删除**，`PixelAvatarSize` → `AvatarSize = "sm" \| "md" \| "lg"`；7 个调用点逐个迁移见 D6 的消费者清点 | T3 |
| 10 | `BrutalModal.tsx` | 原语 | `.overlay`（scrim + blur）+ `.modal`（`--r-xl` + `--shadow-pop`）+ `.modal-head` / `.modal-body` / `.modal-foot`；`--modal-max` 440px / `--modal-wide-max` 560px。**模块名与对外 props 不改**（改名属行为无关的重命名，不产生视觉收益，见 D7 同一条理由） | T7 |
| 11 | `CreateChannelModal.tsx` | panel | `.field` + `.label` + `.member-pick` / `.member-opt`（可挑胶囊）/ `.radio-card` / `.radio-row` / 底部 `.btn.btn-primary` | T7 |
| 12 | `CreateAgentModal.tsx` | panel | 同上 + `.select` / `.input`，model / thinking 选择走 `ModelPicker` 原语 | T7 |
| 13 | `ReminderModal.tsx` | panel | 原型「提醒」模态：`.modal` + 输入行 + 既有提醒列表（`.kv` 行 + `.icon-btn` 删除）+ `datetime-local` 与 recurrence chips（本仓独有，按 ED-3/ED-5 外推） | T7 |
| 14 | `MyRemindersModal.tsx` | panel | 列表结构不动；行 = `.kv` 形态（频道名 + 锚点 seq mono + 下次触发时间 mono）+ `.btn-sm` snooze/cancel | T7 |
| 15 | `DirectoryPicker.tsx` | 遗留 | 树 / 面包屑结构不动；去 2px ink 边框；行 hover `--fg-soft`；选中 `--accent-soft` 底 + `--accent` 文字 | T7 |
| 16 | `SearchView.tsx` | panel | `.search-view` + `.search-field`（`:focus-within` accent 环）+ `.facet-row` / `.filter-chip` + 结果 `.group` / `.group-label` / `.empty` | T8 |
| 17 | `ProjectTrustDialog.tsx` | 遗留 | 换 token；危险动作 `--error`；`.btn` / `.btn-primary` 形态 | T7 |
| 18 | `MessageView.tsx` | 遗留 | 气泡结构不动；`--user-bg`/`--assistant-bg`/`--tool-bg` → `--surface`/`--panel`；去 2px ink 边框；圆角 `--r-md`；时间戳 mono | T9 |
| 19 | `ChatInput.tsx` | 遗留 | 输入条结构不动；`--border` → `--border-strong`；焦点环 `--accent-soft`；`.composer-send` 形态对齐（若结构允许） | T9 |
| 20 | `MarkdownBody.tsx` | 遗留 | `.markdown-body` 字号 14 → `--fs-body`（13px）；色阶 → `--fg`/`--muted`/`--faint`；`.markdown-code-block` 底 `--panel-2` + 边框 `--border` + `--r-md`；`.linenumber` → `--faint` | T9 |
| 21 | `MentionText.tsx` | 遗留 | mention token 高亮用 `--accent`（底 `--accent-soft`）；不加新形态 | T9 |
| 22 | `MermaidBlock.tsx` | 遗留 | `.mermaid-block` / `.mermaid-zoom-*` 结构不动；工具栏按钮 → `.icon-btn` 形态；画布底 `--surface`（**不是** `--panel`——它是内容面）；去 ink 边框 | T9 |
| 23 | `FileExplorer.tsx` | 遗留 | 树结构不动；行 hover `--fg-soft`；选中 `--accent-soft` + `--accent`；无 ink 边框 | T9 |
| 24 | `FileViewer.tsx` | 遗留 | 工具栏高度对齐 `--control-h`；`.file-viewer-mode-switch` / `.file-viewer-icon-button` 走原语；行号 `--faint`；去 ink 边框 | T9 |
| 25 | `FileIcons.tsx` | 遗留 | 纯图标映射，零样式改动（核验后若确无 `var()` 引用则本票不动它） | T9 |
| 26 | `ModelPicker.tsx` | 遗留 | 下拉与 provider 分组结构不动；`.select` / `.input` 形态；选中项 `--accent-soft` + `--accent` | T9 |
| 27 | `ModelsConfig.tsx` | 遗留 | 形态不动，全量换 token（162 处 inline style）；输入/下拉去 ink 边框；主按钮 `.btn-primary`；`useIsMobile` 不动 | T9 |
| 28 | `PluginsConfig.tsx` | 遗留 | 同上（83 处） | T9 |
| 29 | `SkillsConfig.tsx` | 遗留 | 同上（84 处） | T9 |
| 30 | `ExtensionStatusBar.tsx` | 遗留 | 去 ink 边框改上发丝；状态色走四态 | T9 |
| — | `PwaRegistration.tsx` | — | 无渲染面，不动 | — |

### 4. 拆票方案

10 张实施票，文件编号 `02…11`（`01` 是本设计票），frontier = `02 → {03, 04, 10} → {05, 06, 07, 08, 09} → 11`。票文件在 `.scratch/design-system-refactor/issues/`。

| 票 | 交付 | Blocked by |
| --- | --- | --- |
| **02 `token-contract-and-foundation`** | 两条 `@import`；reset 段（含 `:focus-visible` 环）；删 Tailwind（`@import` / `@theme` / PostCSS 插件 / `tailwind.config.ts` / 两个 devDependency）；换字体栈（`next/font` 三个退役、`layout.tsx` 与 `viewport.themeColor` 改值）；断点常量（900 / 1080）；旧 token 名全仓替换与无对应者的扩展层补齐；`--r-*` 解开全局 `border-radius: 0 !important` | 无 |
| **03 `shell-skeleton`** | `AppShell` + `globals.css` 的 `ws-*` 骨架：三栏、`--rail-w` 252、`--dock-w` 380 / `--dock-w-md` 340、发丝分隔、`--z-*` 阶梯、`--dur-drawer`、≤900 抽屉 + scrim、≤1080 dock 收窄；`WorkspaceSidebar` 的 `.rail` 形态 | 02 |
| **04 `primitives-and-presence`** | 原语 class 块（`.btn` / `.btn-primary` / `.btn-ghost` / `.btn-danger` / `.btn-sm` / `.icon-btn` / `.is-on` / `.badge` / `.tag` / `.input` / `.textarea` / `.select` / `.field` / `.card`）+ `StatusDot` 四态 + **新建 `Avatar.tsx`（首字 tile）、删除 `PixelAvatar.tsx`、迁移 7 个调用点** | 02 |
| **05 `message-stream`** | `ChannelView` 的 `.chan-head` / `.chan-title` / 流 / `.msg*` / `.msg-tools` / `.reactions` / `.pin-strip` / `.day-sep` / `.composer*` | 03, 04 |
| **06 `task-board`** | 任务板两视图（`.seg` 分段控件 / `.board*` / `.col*` / `.card*` / `.drop-hint` / `.drag-over` / `.invalid-over`）与卡片动作的形态 | 04 |
| **07 `dock-and-thread`** | `DetailPanel` 单槽容器 + `ThreadPanel`（`.tt-*`）+ `AgentDetailPanel`（`.dock-*` / `.d-sec` / `.kv` / `.meter` / `.stat-grid` / `.log-row`） | 03, 04 |
| **08 `modals`** | `BrutalModal` 外壳（`.overlay` / `.modal*`）+ 四个模态内容 + `DirectoryPicker` + `ProjectTrustDialog` | 04 |
| **09 `search-view`** | `SearchView`（`.search-view` / `.search-field` / `.facet-row` / `.filter-chip` / `.group*` / `.empty`） | 03, 04 |
| **10 `legacy-surfaces-token-swap`** | 15 个未覆盖面按 `ED-1…ED-10` 换 token（形态结构不动） | 02 |
| **11 `docs-sync`** | `docs/spec.md` §4 整节改写（改判后的契约）；`AGENTS.md` 的 CSS 变量段、File Map 的视觉描述、UI 图标规则段附近的视觉措辞；`CONTEXT.md`（新增的视觉契约词条已由本票落盘，本票只作核对） | 03–10 |

**为什么拆 10 票而不是 1 票**：改动面广（30 个模块 / 1144 处 token 引用 / 52 个 class 选择器 / 12 组 keyframe），单票会让 `/implement` 的红-绿节奏无处落脚（没有可独立证伪的切片）。**为什么按「层」而不是按「文件」拆**：shell 与原语是面板的前置（面板的形态依赖原语 class 与骨架 token），按层拆让 frontier 自然，且每票的验收面可独立圈定。**为什么 10 只依赖 02**：遗留面只吃 token，不吃 shell 与原语形态。

### 5. 与既有裁决的冲突面（不改既有正本）

| 既有正本 | 状态 | 处置 |
| --- | --- | --- |
| `.scratch/worksplice-build/issues/03-shell-and-visual-tokens.md` | **视觉部分被推翻**（本票不动该文件，见 Ownership） | 在 ADR-0014 的 `Supersedes` 里留痕。该票的「三栏骨架」与「删除 pi-web 单窗口骨架」两项**仍有效** |
| `docs/spec.md` §4（12 色板 / 0 圆角 / 2px ink / 硬阴影 / 三字体 / 像素头像，逐条 `[锁定] 02`） | **整节失效** | 本票不改（不在 Ownership 内）；改写落在票 11。**这是本 effort 唯一的「文档先于代码说谎」窗口**——从票 02 落地到票 11 落地之间，§4 描述的方向已不在产品里 |
| `AGENTS.md` 的 CSS 变量段 / File Map 视觉描述 | 部分失效 | 同票 11 |
| `docs/spec.md` §4.5「沿用 pi-web 的主题基建（tailwind 配置 + CSS 变量）**[锁定] 04**」 | **被 D4 推翻** | 同票 11 改写；ADR-0014 的 `Supersedes` 覆盖 |

### 6. 实施票必须保持的红线（零行为改动）

- `components/**` 的一切 **行为**、props 名、i18n key、事件处理、轮询节奏、freshness `baseSeq` 来源不动；只允许改样式表达（inline style 值 / className / CSS）。
- `lib/**` 除 `lib/i18n`（文案）外零改动；服务层、数据层、agent-loop、RPC 一字不动。
- `app/api/**` 零改动。
- `app/globals.css` 之外**不新增全局 CSS 文件**（若新增，必须仍从 `app/globals.css` 引入，避免 Next 的 CSS 顺序漂移）。
- 任务状态色映射（ED-10）只是**颜色**的映射，不触 `TRANSITIONS` 或任何状态机代码。
- `AGENTS.md` 的「UI 图标规则」段（lucide 优先、禁新增 emoji）**继续有效**——本 effort 不新增 emoji，`QUICK_REACTIONS` / `REACTION_GRID` 等反应数据不属本 effort 范围。

## Testing Decisions

本仓既有的渲染断言 seam 是 `components/*.test.mjs` 的 `renderToStaticMarkup` + `jiti`（范本：`components/WorkspaceSidebar.test.mjs` 用 `title="My reminders"` 这类**无障碍名**断言，`components/MobilePwaLayout.test.mjs` 用 `readFile` + 正则断言**源码级契约**）。本 effort 复用这两条 seam，不新增夹具。

**T-A 上游契约镜像断言（最高杠杆，新增 `app/globals.test.mjs`）**
读 `worksplice-design-system/colors_and_type.css` 与 `tokens.css`，正则抽出所有 `:root` 里的 `--<名>: <值>` 声明集合 `S_upstream`；读 `app/globals.css`（含它 `@import` 的两份，均在仓库内，可静态读）抽出实际生效集合 `S_app`。断言：
1. `S_upstream ⊆ S_app`（设计系统的每一个 token 都能在产品里取到）；
2. 同名 token 的值**逐字相同**（`--accent` 的 `oklch(56% 0.17 256)` 不被本仓覆盖成别的）。
这条断言是「资料真的进了产品、且没有被本仓偷偷改值」的机械证明。它同时是 D2（上游作真源）的守护：若有人把 `@import` 换回复制粘贴，断言 1 在值漂移时立刻红。

**T-B 旧名灭绝断言（同一个文件）**
对 `app/**`、`components/**`、`hooks/**`、`lib/**` 的 `.tsx/.ts/.css` 做批次 grep，断言以下旧名出现 **0 次**：`--text`、`--text-muted`、`--text-dim`、`--bg-panel`、`--bg-hover`、`--bg-selected`、`--bg-subtle`、`--user-bg`、`--assistant-bg`、`--tool-bg`、`--cream`、`--yellow`、`--pink`、`--cyan`、`--orange`、`--lime`、`--lavender`、`--coral`、`--ink`、`--stone`、`--font-space-grotesk`、`--font-space-mono`、`--font-hanken`、`--font-grotesk`、`--shadow-sm`、`--shadow-md`、`--shadow-lg`、`--shadow-pressed`、`--color-`。
（`--border` / `--bg` / `--accent` / `--accent-hover` / `--font-mono` 是**同名保留**项，不进灭绝集——判据写成集合枚举而不是前缀规则，避免误伤。）防的是「新代码用新名、旧代码留旧名」的双轨漂移。

**T-C 骨架规则断言（同一个文件）**
对 `app/globals.css` 断言：
- **不存在** `border-radius: 0 !important`；不存在在 `--ink` 上取值的阴影声明；
- **不存在** `2px solid`（旧方向的粗结构线）；
- **存在** `@import "../../worksplice-design-system/colors_and_type.css"` 与 `…/tokens.css`；
- **存在** `:focus-visible` 且其 `outline` 用 `var(--accent)`；
- **存在** `@media (prefers-reduced-motion: reduce)`，且 `@keyframes` 计数 ≥ 本票实施前的数量（12 组，只增不减：删动画不算「收敛」，加 `reduce` 才算）；
- **存在** `@media (max-width: 900px)` 与 `@media (max-width: 1080px)`；**不存在** `@media (max-width: 960px)`（D5 的机械判据）。

**T-D 渲染面断言（复用既有 seam，逐票扩）**
在既有 `components/*.test.mjs` 上按层新增：

| 票 | 断言落在什么上（产品真正渲染的东西，不落 class 字符串） |
| --- | --- |
| 02 | T-A + T-B + T-C |
| 03 | `AppShell` 的三栏容器 markup 里出现 `var(--rail-w)` / `var(--dock-w)` 而不是 `236px` / `480px`；`MobilePwaLayout.test.mjs` 的既有断言（安全区、`--app-viewport-height`、`overflow-x-hidden overflow-y-auto`）保持全绿——这四条是**不能动的护栏**，实施票改 `ChannelView` 的 className 前必须先让它们过 |
| 04 | `StatusDot` 四个 status 各渲染出对应 token（`var(--online)` / `var(--working)` / `var(--error)` / `var(--offline)`）；`Avatar` 渲染出**首字**（agent 名首字符转大写 / 人类「我」）与 `.avatar` 形态，且**不再**出现 `image-rendering: pixelated` 与 `2px solid`；**未认领**任务 chip **不**渲染头像；7 个调用点的 import 全部指向 `Avatar`（源码级断言：`grep 'PixelAvatar' components/*.tsx` 为空） |
| 05 | 复用 `ChannelView.test.mjs` 的 8 个 `MessageRow` 用例（它们已按无障碍名断言），新增：消息行不再带 `2px solid`；hover 类不再指向 `--yellow` |
| 06 | 复用 `AgentDetailPanel.test.mjs` 的渲染 seam 断言看板卡片的可达性标记不因样式改动消失（`reachable` 是**行为**，断言它渲染出来 = 视觉票没碰行为） |
| 07 | `DetailPanel.test.mjs` 既有的按 kind 分派断言全绿（视觉票不得改分派） |
| 08 | `CreateChannelModal.test.mjs` / `CreateAgentModal.test.mjs` / `ReminderModal.test.mjs` 既有断言全绿；新增：模态不再带 `2px solid` |
| 09 | `SearchView` 的 facet chip 渲染断言（新增，落在无障碍名上） |
| 10 | 只跑 T-A/T-B/T-C；遗留面无新增渲染断言（形态不变 = 无新可观察面） |
| 11 | T-C 的文档一致性扩展：断言 `docs/spec.md` §4 不再出现 `#ffd440` / `#fe7da8` / `0 圆角` / `[锁定] 02`；`AGENTS.md` 的 CSS 变量段列出的是新 token 名 |

**门禁**（本票不跑，留给实施票与本 effort 的收口）：`npm test`（`node --test`，`lib/**` + `app/**` + `components/**` + `hooks/**` 的 `*.test.mjs`）、`node_modules/.bin/tsc --noEmit`、`npm run lint`（`eslint .`）、`git diff --numstat` 无整文件重写。**「Keep it green」的既有护栏**：`components/MobilePwaLayout.test.mjs` 的 4 条断言直接断在 `app/globals.css` 与 `components/*.tsx` 的源码字符串上，票 02–05 会踩到它们，实施票必须让它们保持绿（或按意图同步更新，不得静默删）。

**本票（设计票）的证据形态**：不跑测试（无被测对象）；证据 = `git status --porcelain` 为空 + `diff -r` 与上游逐字一致 + 本文件七节齐全 + ADR-0014 存在。

## Out of Scope

- **任何源码改动**。`app/**`（含 `globals.css` / `layout.tsx`）、`components/**`、`hooks/**`、`lib/**`、`package.json` 在本票一字不动。视觉改写的实施属票 02–11。
- **行为语义**：消息不可变、freshness-hold（`baseSeq` 与 held 四选一）、任务状态机（`TRANSITIONS` / `reopen` 封锁 / 互审授权）、inbox 游标（drain/ack）、权限面、mute 穿透、wake 触发面、agent-loop 的轮次协议与崩溃补拉。
- **数据面**：schema、`~/.worksplice/**`、`~/.pi/agent/sessions/**`、`app/api/**` 的任何端点。
- **原型有而本仓没有的界面**：命令面板（`.cmd` / `.cmd-group` / `.cmd-item`）、toast（`.toast` / `.toast.err`）、移动端 topbar（`.mobile-topbar`）。本 effort **不新增功能**——原型把它们画出来不等于本仓要有；它们不进入任何票的交付面。
- **原型「设置」模态里的「跟随系统」主题选项**：与 `DESIGN.md`「无深色主题、单档亮色」冲突，属 demo chrome。本 effort 不实现主题切换器，`hooks/useTheme.ts` 继续恒亮色。
- **三个配置面的窄屏形态重做**（`ModelsConfig` / `PluginsConfig` / `SkillsConfig` 在 ≤640px 的移动分支）：D5 把它们排除在布局断点之外；重做属第 11 张票，不在本 effort。
- **`docs/spec.md` 的改写**（§4 整节 + §4.5）：不在本票 Ownership 内，落票 11。
- **`.scratch/worksplice-build/**` 的任何编辑**：它是被推翻裁决的正本，保持原样；推翻事实记在 ADR-0014 的 `Supersedes`。
- **`worksplice-design-system/**` 的任何内容修改**：它是上游资料（`Change A` 的「复制后逐字不得修改」）。
- **`AGENTS.md` / `CONTEXT.md` 的既有术语改写**：除 D 段确认的新术语外不改。

## Further Notes

### Known gaps（资料缺失与补足方式）

**`README.md` 与 `DESIGN.md` 引用了但不存在于资料的 6 个文件**：

| 被引用路径 | 引用处 | 状态 |
| --- | --- | --- |
| `preview/index.html` | `README.md`「Start here」第 1 条（审阅清单入口） | **不存在** |
| `preview/components-buttons.html` | `README.md`「Start here」第 1 条（推荐首看卡） | **不存在** |
| `preview/applied-app-shell.html` | `README.md`「Start here」第 1 条（推荐首看卡） | **不存在** |
| `ui_kits/app/index.html` | `README.md`「What's here」与 `SKILL.md` §2 的分派表 | **不存在**（`ui_kits/app/` 只有 `app.css`） |
| `ui_kits/app/spec.css` | `SKILL.md` §2「新组件复制对应的 class 块」 | **不存在** |
| `screens/*.html`（README 列了 10 个切片） | `README.md`「What's here」 | **不存在**；`screens/` 是**空目录** |

`fonts/` 也是空目录（`provenance.md` 说明这是刻意的：系统字体栈是刻意的选择，源里没有字体文件）。`context/provenance.md` 的「What is exact / What is reconstructed」把「哪些是逐字摘录、哪些是 SVG 重建」说清了（品牌 mark / wordmark / 图标集是 SVG 重建，其余逐字）。`preview/` 下**实际存在** 7 个文件（`colors-primary.html` / `colors-semantic.html` / `colors-avatars.html` / `radius-shadows.html` / `spacing-tokens.html` / `typography-specimens.html` / `preview.css`）+ 6 个 `.artifact.json`。

**缺口如何补足（裁决：以 `worksplice-app.html` 为准）**：

1. **原型是唯一完整的形态来源**。它是 1865 行的自包含文件（inline `<style>` + inline `<script>`），`context/provenance.md` 明写「The single HTML file is complete and self-contained… so it carried the entire visual language」。凡 `ui_kits/app/app.css` 里找不到的 class 块（因为它只 424 行），都回 `worksplice-app.html` 的 `<style>` 段取。
2. **`preview/` 的 6 张卡只作审阅证据，不作实现来源**。它们是 token 的可视化陈列（色板 / 语义色 / 头像色 / 半径阴影 / 间距 / 字体样张），用于人工审阅，class 块不看它们。
3. **`ui_kits/app/app.css` 是「组件形态的压缩版」**，`worksplice-app.html` 是「展开版」。二者冲突时**以 `worksplice-app.html` 为准**（`provenance.md` 称 app.css 是从原型「ported」的，原型是 primary evidence）。
4. **不重建缺失文件**。`preview/index.html`（清单页）、`screens/*.html`（切片页）、`ui_kits/app/index.html`（应用装配页）都是**资料的审阅入口**，不是产品代码；本 effort 不生成它们（生成等于伪造上游资料）。若需要人向审阅，用 `worksplice-app.html` 直接在浏览器里开。
5. **缺口对本 effort 的实际影响 = 零**：本 effort 需要的三样东西（token 值 / class 块 / 布局与断点常量）在 `colors_and_type.css` + `tokens.css` + `ui_kits/app/app.css` + `worksplice-app.html` 里齐全。缺的是「更方便翻阅的入口」。这一条写进 Known gaps 是为了让下一个人不去找那 6 个文件。

### 上游资料的三个陷阱（实施票必读）

1. **`--bg-panel` 与 `--panel` 的层次方向相反**。旧 `--bg-panel`（`#fffdf5`）比 `--bg`（`#fffaef`）**亮**；新 `--panel`（97.4%）比 `--bg`（99%）**暗**。机械替换名字会把「比底色更亮的副底」变成「比底色更暗的栏底」——这正是上游的设计（栏与 well 比画布深，卡片与 chrome 比画布浅），但实施票必须**核对每处替换的视觉意图**，不能只看名字。
2. **`--border` 是同名不同物，168 处调用点零改名但每一处都要重写**。旧值 `var(--ink)` + 2px 宽；新值发丝色 + 1px 宽。仅替换变量名会得到「1px 宽但仍是近乎黑的 `#141111`」——那是第三种方向，不是两个方向中的任何一个。
3. **`--bg-selected` 必须成对改 fill + fg**。旧的「黄色实心底 + 墨色字」只换底会得到「11% 淡底 + 近黑字」，选中态彻底消失。同理 `--yellow` 与 `--pink` 各自承担两个语义（详见 1c），必须按**调用点语义**分流，不能按名字一刀切。

### 与既有护栏的关系

- `components/MobilePwaLayout.test.mjs` 的 4 条断言是对 `app/globals.css` 与 `components/*.tsx` 的**源码字符串**断言（`height: var(--app-viewport-height, 100dvh)`、`left: env(safe-area-inset-left)`、`@media (max-width: 640px)` 下的输入框 16px、`overflow-x-hidden overflow-y-auto`、`flex: 1,\s*minWidth: 0,\s*width: "100%",`）。票 02–05 会踩到其中至少 3 条。**判据：让它们保持绿**——它们守的是 iOS 视觉视口与键盘探测（真问题），不是旧方向的美学。若某条必须改（如 `overflow-x-hidden overflow-y-auto` 那处 className 换成设计系统 class），改写理由要写进该票 Answer，**不得静默删断言**。
- `components/ChannelView.test.mjs` 的 8 个 `MessageRow` 用例断言的是无障碍名（`title="Reply in thread"` 等），与形态无关，视觉票应全部保持绿。
- 本票（设计票）不跑任何测试；门禁在实施票与 effort 收口处。

### 术语决议

**新增一个术语进 `CONTEXT.md`：`视觉契约 (Visual Contract)`**。理由：它是这个项目特有的概念，不是通用编程概念——它指的是一条**被下游组件按名消费的 token 名集合**，改名的代价是「重新扯断整个 app 的消费点」而不是「改一处定义」。上游把它写成反模式的第一条（「Never rename」），本 effort 的 D2（上游作运行时真源）与 D3（不留别名层）都以它为据。仓库当前语言里没有词能表达这个约束。落盘见 `CONTEXT.md`。

**不新增的候选与理由**：
- 「presence 四态」「任务状态色语义」——`CONTEXT.md` 已有**状态点**词条（在线 / 正在干活 / 出错 / 离线），本 effort 只换它的**色值**，不改语义，不加新词。
- 「token 契约映射」「旧名退役」——是一次性迁移动作，不是领域概念（`domain-modeling` 的判据：只收本项目特有概念，不收实现动作）。
- 「马卡龙 × brutalist」「modern-minimal」——是**方向名**（上游自述用的词），不构成需要消除歧义的术语对；`docs/adr/0014` 已记录两者的取舍。
