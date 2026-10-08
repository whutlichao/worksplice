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

## Answer

### 交付物

**PR**：https://github.com/whutlichao/worksplice/pull/109（分支 `whutlichao/design-system-refactor`，commit `f9767dd`）

| 交付 | 位置 |
| --- | --- |
| 设计资料入库 | `worksplice-design-system/`（30 文件；`diff -r --exclude=.DS_Store` 与源逐字一致） |
| 设计契约 | `.scratch/design-system-refactor/spec.md`（七节模板 + 逐条 token 映射 + 30 组件形态/分层/顺序 + `ED-1…ED-10` 外推原则 + Testing Decisions + Known gaps） |
| 方向改判 ADR | `docs/adr/0014-visual-direction-modern-minimal.md` |
| 术语 | `CONTEXT.md` 新增「视觉契约 (Visual Contract)」 |
| 实施票 | `.scratch/design-system-refactor/issues/02…11`（10 张） |

### grilling 轮次记录

**访谈对象**：人类产品所有者。**通道**：`orca orchestration ask`（禁 `AskUserQuestion`）。**轮次结构**：第 1 轮 = 6 条 frontier（交付边界 / 上游资料运行时角色 / 旧 token 名退役 / Tailwind 去留 / 响应式断点 / 头像形态）；第 1 轮补问 = 1 条（class 词汇表）。第 2 轮的 frontier 只剩余下三条，而它们**不由人裁决**（外推原则是形态推断、拆票是排期），故访谈在此收敛。

**⚠️ 答复情况：7 条问题全部未获答复。** 每条附带推荐答案与代价账后，经 4 轮 resume 等待（每轮 15–30 分钟，累计约 2.5 小时）超时，另发 escalation 一次（`msg_143e2b846cee`，2026-10-08）。因此下表「谁给的答复」列全部为 **worker 荐答**——落盘值是**带完整推理的推荐答案**，产品所有者可据此直接改写任一条而无需重做分析。这一条是本票最大的未闭合风险，已在 `worker_done` 正文里显式点名。

| Q | 问题 | 问题 ID | 最终答案（荐答） | 谁给的答复 |
| --- | --- | --- | --- | --- |
| Q1 | 交付边界：只换 token / 全量对齐 / 分层落地？ | `msg_d4b3d5f1bdf9` | **分层落地**：shell + 原语 + 面板三层按原型逐字对齐（原型覆盖的 15 个 tsx）；遗留 agent 会话面 + 文件面 + 配置面只换 token、去 2px ink 边框、去 0 圆角，形态不动 | worker 荐答（未获答复） |
| Q2 | `worksplice-design-system/` 是运行时真源还是只作文档？ | `msg_827e2b5b7d15` | **`@import` 直引作运行时真源**，本仓只叠扩展层；代价 = 资料目录进入产品构建路径，此后不得当草稿区覆盖 | worker 荐答（未获答复） |
| Q3 | 旧 token 名退役方式：改名 / 别名层 / 混合？ | `msg_8391eaf6c26e` | **逐处改名、不留别名层**；`--bg-selected` 成对改 fill + fg（`--accent-soft` 底 + `--accent` 文字）而非只映射底色 | worker 荐答（未获答复） |
| Q4 | Tailwind 去留？ | `msg_5aa5951c58f8` | **删除**（`@import` / `@theme` / PostCSS 插件 / `tailwind.config.ts` / 两个 devDependency）；reset 改由设计系统的 reset 段承担 | worker 荐答（未获答复） |
| Q5 | 断点对齐：全量 / 布局对齐 hook 不动 / 只加 1080？ | `msg_3f9f0583fd76` | **布局对齐上游（1080 / 900），`useIsMobile` 保持 640**（它是配置面的紧凑断点，不是布局断点） | worker 荐答（未获答复） |
| Q6 | 头像：保留像素图案 / 换首字 tile / 并存？ | `msg_f9fdb24b3849` | **保留 8×8 像素图案作内容，换 tile 外壳**（7px 圆角、`--av-0…4` 按成员序号取色、「我」用 `--av-4`）。这是与上游原型唯一的显式偏离，且上游 `.avatar img{pixelated}` 留了槽位 | worker 荐答（未获答复） |
| Q7 | class 词汇表：采纳上游名 / 保留 `ws-*` / 加前缀？ | `msg_53087e098922` | **采纳上游 class 名与 class 块**作三层形态载体；`ws-*` 只保留为骨架布局钩子（不机械重命名——零视觉收益） | worker 荐答（未获答复） |

**facts 自查（未问人，按 grilling 纪律「facts 是你的活」）**：上游资料缺失清单（6 个被引用但不存在的文件 + `screens/` 与 `fonts/` 空目录）、`--presence` 四态与本仓 `StatusDot` 一一对应（不需新术语）、原型 JS 的 `STATUS_COLOR` 任务状态色映射、原型「设置」模态的「跟随系统」是 demo chrome（与 DESIGN.md 无深色主题冲突）、字体栈由 DESIGN.md 明确裁决为系统栈、Tailwind 在本仓实际用量（`@theme` 别名零消费者、工具类 2 处）、`useIsMobile` 的 4 个消费者、`.ws-*`（12 个）与 `.avatar` 的上游规则实测。

### 关键发现（供验收参考）

1. **Tailwind v4 在本仓近似空转**：`@theme` 的 13 个 `--color-*` 别名消费者数为 0；全部组件样式走 inline `style` + `var(--token)`（1144 处引用）。这让 D4（删除）的代价几乎为零，只需补一份 reset。
2. **`--border` 是同名不同物**：168 处调用点零改名，但旧值是 `2px solid var(--ink)`、新值是 1px 发丝色——机械替换变量名会得到「1px 宽但仍是近乎黑」的第三种方向。已写成陷阱条目。
3. **`--bg-panel` 与 `--panel` 的层次方向相反**：旧 panel 比 bg **亮**，新 panel 比 bg **暗**。已写成陷阱条目。
4. **`--bg-selected` 只换底会杀掉选中态**：旧的「黄色实心底 + 墨色字」变成「11% 淡底 + 近黑字」= 选中消失。裁决要求 fill 与 fg 成对改。
5. **既有护栏会踩到**：`components/MobilePwaLayout.test.mjs` 的 4 条断言直接断在 `app/globals.css` 与 `components/*.tsx` 的源码字符串上，票 02–05 ≥3 条会踩到。判据已写进 spec：让它们保持绿（它们守的是 iOS 视觉视口与键盘探测），不得静默删断言。
6. **原型的命令面板 / toast / 移动端 topbar 在本仓没有对应模块**——原型画了不等于本仓要有，已列入 Out of Scope，本 effort 不新增功能。
