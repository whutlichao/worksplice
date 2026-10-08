# 01 — 设计系统重构：视觉契约、token 映射与实施顺序（设计票）

**Type:** grilling
**What to build:** 把产品所有者新提供的 `worksplice-design-system/`（`modern-minimal`）从「未跟踪的资料目录」变成「仓库内、有契约、有迁移路径」的事实来源：资料原样入库（A）、七节设计契约落 `spec.md`（B）、视觉方向改判落 ADR-0014（C）、术语按 domain-modeling 规则 inline 落盘（D）。**零源码改动**——视觉改写的实施属本 effort 的票 `02…11`。
**Blocked by:** 无

**Status:** resolved

- [x] `worksplice-design-system/` 复制入库（30 文件 / 344KB，排除 `.DS_Store` 与 `**/.DS_Store`），内容与源逐字一致（`diff -r --exclude=.DS_Store` 无差异），且复制后未做任何内容修改
- [x] `.scratch/design-system-refactor/spec.md` 七节模板齐全、无「待定」占位、无 open 决策残留；覆盖 token 契约逐条映射（含「无对应」处置）、Tailwind 去留、30 个组件的目标形态与分层/顺序、原型未覆盖面的外推原则、响应式、可访问与动效、Testing Decisions、Known gaps
- [x] `docs/adr/0014-visual-direction-modern-minimal.md` 写明被推翻的既有裁决（`.scratch/worksplice-build/issues/03` 的视觉部分 + `docs/spec.md` §4）、推翻理由、影响面与迁移策略、被否决的备选
- [x] `CONTEXT.md` 新增「视觉契约 (Visual Contract)」词条（inline 落盘，不攒批）；其余候选术语按 domain-modeling 判据逐条否决并记理由
- [x] `.scratch/design-system-refactor/issues/02…11` 十张实施票落盘，含 Blocked by 边与验收清单
- [x] 零源码改动（`app/**` / `components/**` / `hooks/**` / `lib/**` / `package.json` 一字不动）
- [x] `git status --porcelain` 为空（`.pi-lens.json` 进 `.git/info/exclude`，不出现在 untracked 列表）
- [x] 分支推送 + PR（中文标题与正文）：`whutlichao/design-system-refactor` → **PR #109**
- [x] grilling 轮次记录落本 Answer（每轮问题、每条最终答案、谁给的答复）
- [x] **本轮（follow-up）：决策回填与改判收敛**——产品所有者对 7 条逐条答复（Q1–Q5、Q7 与荐答一致，Q6 改判）；D6 的决策行/决策节/User Story/组件表/拆票表/Testing Decisions 与 `issues/04` 全部按答复收敛；`PixelAvatar` 的 7 个调用点逐个点名处置；ADR-0014 影响面措辞相应对齐（不改裁决）

## Answer

### 交付物

**PR**：https://github.com/whutlichao/worksplice/pull/109（分支 `whutlichao/design-system-refactor`；首轮 commit `f9767dd`，本轮 commit 见 `git log`）

| 交付 | 位置 |
| --- | --- |
| 设计资料入库 | `worksplice-design-system/`（30 文件；`diff -r --exclude=.DS_Store` 与源逐字一致） |
| 设计契约 | `.scratch/design-system-refactor/spec.md`（七节模板 + 逐条 token 映射 + 30 组件形态/分层/顺序 + `ED-1…ED-10` 外推原则 + Testing Decisions + Known gaps） |
| 方向改判 ADR | `docs/adr/0014-visual-direction-modern-minimal.md` |
| 术语 | `CONTEXT.md` 新增「视觉契约 (Visual Contract)」 |
| 实施票 | `.scratch/design-system-refactor/issues/02…11`（10 张） |

### grilling 轮次记录

**访谈对象**：人类产品所有者。**通道**：`orca orchestration ask`（禁 `AskUserQuestion`）。**轮次结构**：第 1 轮 = 6 条 frontier（交付边界 / 上游资料运行时角色 / 旧 token 名退役 / Tailwind 去留 / 响应式断点 / 头像形态）；第 1 轮补问 = 1 条（class 词汇表）。第 2 轮的 frontier 只剩余下三条，而它们**不由人裁决**（外推原则是形态推断、拆票是排期），故访谈在此收敛。

访谈经历两个阶段，两段都留在记录里（流程教训比结论更值钱）：

**第一阶段——未获答复（coordinator 侧故障）**。7 条附带推荐答案与代价账后，经 4 轮 resume 等待（每轮 15–30 分钟，累计约 2.5 小时）超时，另发 escalation 一次（`msg_143e2b846cee`，2026-10-08）。**根因在 coordinator 侧**：唤醒闹钟被停掉，导致 escalation / 补问 / `worker_done` 静默排队。当时按**荐答**落盘——因为落盘值带完整推理链、被否决备选与代价账，正是这个形态让第二阶段可以「只改一条、无需重做分析」。

**第二阶段——答复到达并收敛（本轮）**。修复方式：**闹钟改为按期续装、永不停**。人类产品所有者对 7 条逐条答复，已在 `spec.md` 与 `issues/04` 逐处收敛（改动清单见下方「本轮改动清单」）。

**访谈中途确认的一条子决策（代答）**：Q6 的答复只说了「按成员序号取色」，而 7 个调用点里有 5 个根本没有列表上下文。落法是「有列表序号传序号、无序号传 `member.id` 入纯函数」——保住「恒定同色」的意图，把「序号」降级为可选。这一条**不是**产品所有者的答复，已在 `spec.md` D6 的「取色」段显式标为代答；若要严格按序号，需新增 props 与查询（属行为改动，不在本 effort 内）。

| Q | 问题 | 问题 ID | 最终答案 | 谁给的答复 |
| --- | --- | --- | --- | --- |
| Q1 | 交付边界：只换 token / 全量对齐 / 分层落地？ | `msg_d4b3d5f1bdf9` | **C 分层落地**：shell + 原语 + 面板三层按原型逐字对齐（原型覆盖的 15 个 tsx）；遗留 agent 会话面 + 文件面 + 配置面只换 token、去 2px ink 边框、去 0 圆角，形态不动 | **产品所有者答复（与荐答一致）** |
| Q2 | `worksplice-design-system/` 是运行时真源还是只作文档？ | `msg_827e2b5b7d15` | **B `@import` 直引作运行时真源**，本仓只叠扩展层；代价 = 资料目录进入产品构建路径，此后不得当草稿区覆盖 | **产品所有者答复（与荐答一致）** |
| Q3 | 旧 token 名退役方式：改名 / 别名层 / 混合？ | `msg_8391eaf6c26e` | **A 逐处改名、不留别名层**；`--bg-selected` 成对改 fill + fg（`--accent-soft` 底 + `--accent` 文字）而非只映射底色 | **产品所有者答复（与荐答一致）** |
| Q4 | Tailwind 去留？ | `msg_5aa5951c58f8` | **A 删除**（`@import` / `@theme` / PostCSS 插件 / `tailwind.config.ts` / 两个 devDependency）；reset 改由设计系统的 reset 段承担 | **产品所有者答复（与荐答一致）** |
| Q5 | 断点对齐：全量 / 布局对齐 hook 不动 / 只加 1080？ | `msg_3f9f0583fd76` | **B 布局对齐上游（1080 / 900），`useIsMobile` 保持 640**（它是配置面的紧凑断点，不是布局断点） | **产品所有者答复（与荐答一致）** |
| Q6 | 头像：保留像素图案 / 换首字 tile / 并存？ | `msg_f9fdb24b3849` | **B 换首字 tile，与上游原型逐字一致；`PixelAvatar` 退役 → 新建 `Avatar`**（人类 owner「我」/ agent 名称首字符，`.avatar` 26px / `.sm` 22px / `.lg` 44px、7px 圆角、`--av-0…--av-4` 按成员确定性取色、「我」恒用 `--av-4`）。产品所有者**接受**「同首字母成员不可区分」（`Susan` / `Sentry` 都是 `S`）这一代价 | **产品所有者答复（改判，否决荐答）** |
| Q7 | class 词汇表：采纳上游名 / 保留 `ws-*` / 加前缀？ | `msg_53087e098922` | **A 采纳上游 class 名与 class 块**作三层形态载体；`ws-*` 只保留为骨架布局钩子（不机械重命名——零视觉收益） | **产品所有者答复（与荐答一致）** |

**facts 自查（未问人，按 grilling 纪律「facts 是你的活」）**：上游资料缺失清单（6 个被引用但不存在的文件 + `screens/` 与 `fonts/` 空目录）、`.presence` 四态与本仓 `StatusDot` 一一对应（不需新术语）、原型 JS 的 `STATUS_COLOR` 任务状态色映射、原型「设置」模态的「跟随系统」是 demo chrome（与 DESIGN.md 无深色主题冲突）、字体栈由 DESIGN.md 明确裁决为系统栈、Tailwind 在本仓实际用量（`@theme` 别名零消费者、工具类 2 处）、`useIsMobile` 的 4 个消费者、`.ws-*`（12 个）与 `.avatar` 的上游规则实测。

### 本轮改动清单（D6 改判的逐处收敛）

| # | 改了哪里 | 改成了什么 |
| --- | --- | --- |
| 1 | `spec.md` **Solution 来源列图例** | 「荐答」→「产品所有者答复（标「一致」或「改判，否决荐答」）」 |
| 2 | `spec.md` **「裁决来源与留痕」段** | 重写为两阶段记录：第一阶段未获答复 + coordinator 侧闹钟停摆根因；第二阶段答复到达并收敛 |
| 3 | `spec.md` **D1–D7 决策表**（D1–D7 共 7 行） | D6 行裁决改为「换首字 tile，`PixelAvatar` 退役 → 新建 `Avatar`」；7 行的来源列全部改为「产品所有者答复（…）」；D6 标「**改判，否决荐答**」 |
| 4 | `spec.md` **D6 节** | **整节重写**：新裁决 + 尺寸/形态表（消费 `--avatar-sm/md/lg`）+ 取色段（含代答声明）+ `PixelAvatar.tsx` 处置（退役，改建 `Avatar.tsx`，三条理由）+ **7 个调用点逐个点名表** + 两个可见尺寸变化的知情项 + 被否决备选（**保留首轮完整论证**） |
| 5 | `spec.md` **User Story 7** | 从「凭 8×8 图案区分 agent」改为「方 tile 首字 + 五色 tint、同一成员恒定同色」 |
| 6 | `spec.md` **Implementation Decisions 的 30 组件表第 9 行** | 改为「~~`PixelAvatar.tsx`~~ → **`Avatar.tsx`（新建）**」，给出首字内容、三档尺寸、`AvatarSize` 与调用点指引 |
| 7 | `spec.md` **拆票表票 04 行** | 去掉「`PixelAvatar` tile 外壳」，改为「新建 `Avatar.tsx`（首字 tile）、删除 `PixelAvatar.tsx`、迁移 7 个调用点」 |
| 8 | `spec.md` **Testing Decisions 表票 04 行** | 改为首字渲染断言（agent 名首字符 / 人类「我」、`.avatar` 形态、**无** `image-rendering: pixelated`、未认领 chip 不渲染头像、源码级断言 `grep 'PixelAvatar' components/*.tsx` 为空） |
| 9 | `issues/04-primitives-and-presence.md` | What to build 的 `PixelAvatar` 段改写为首字 tile；新增 7 个调用点迁移表与尺寸变化知情项；验收清单从 6 条扩到 9 条（新增 `PixelAvatar` 清零、首字/尺寸/取色、未认领分支） |
| 10 | `docs/adr/0014-visual-direction-modern-minimal.md` **影响面段** | 「`PixelAvatar.tsx` / `StatusDot.tsx` 的取色与形态」→ 「`PixelAvatar.tsx` 的退役（D6 改判：头像换首字 tile）与 `StatusDot.tsx` 的形态」。**裁决本身（改判 modern-minimal）一字未动** |
| 11 | `CONTEXT.md` | **无需改动**：头像不是领域概念（它是视觉表达，不是业务语义）；上一轮落的「视觉契约」词条仍准确 |

**机械判据核对**：`grep -n '像素' .scratch/design-system-refactor/spec.md .scratch/design-system-refactor/issues/*.md` 的每一处要么是**被否决备选**（D6 的「被否决的备选」段）、要么是**历史描述**（Problem Statement 描述旧方向、`issues/11` 描述 `docs/spec.md` §4 的旧内容），不得是当前裁决。

### 关键发现（供验收参考）

1. **Tailwind v4 在本仓近似空转**：`@theme` 的 13 个 `--color-*` 别名消费者数为 0；全部组件样式走 inline `style` + `var(--token)`（1144 处引用）。这让 D4（删除）的代价几乎为零，只需补一份 reset。
2. **`--border` 是同名不同物**：168 处调用点零改名，但旧值是 `2px solid var(--ink)`、新值是 1px 发丝色——机械替换变量名会得到「1px 宽但仍是近乎黑」的第三种方向。已写成陷阱条目。
3. **`--bg-panel` 与 `--panel` 的层次方向相反**：旧 panel 比 bg **亮**，新 panel 比 bg **暗**。已写成陷阱条目。
4. **`--bg-selected` 只换底会杀掉选中态**：旧的「黄色实心底 + 墨色字」变成「11% 淡底 + 近黑字」= 选中消失。裁决要求 fill 与 fg 成对改。
5. **既有护栏会踩到**：`components/MobilePwaLayout.test.mjs` 的 4 条断言直接断在 `app/globals.css` 与 `components/*.tsx` 的源码字符串上，票 02–05 ≥3 条会踩到。判据已写进 spec：让它们保持绿（它们守的是 iOS 视觉视口与键盘探测），不得静默删断言。
6. **原型的命令面板 / toast / 移动端 topbar 在本仓没有对应模块**——原型画了不等于本仓要有，已列入 Out of Scope，本 effort 不新增功能。
