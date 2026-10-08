# 马卡龙配色：暖奶霜底 + pastel 角色族（设计票）

日期：2026-10-08 · 票据：`.scratch/macaron-palette/issues/01-macaron-palette-contract.md`（Type: grilling / 设计票）
性质：**设计票**，本文件不含任何源码改动；色值落盘与调用点迁移由后续实施票（本文件 Further Notes 的「拆票建议」）落地。本文件即本 effort 的 spec 正本，位置依 `docs/agents/issue-tracker.md` 的约定（`.scratch/<feature-slug>/spec.md`），骨架参照先例 `.scratch/design-system-refactor/spec.md`（同类改判：七节 + 决策表 + 零行为改动声明）。

**零行为改动声明**：消息不可变、freshness-hold、任务状态机、inbox 游标、权限面、agent-loop 语义一字不动。本 effort 只作用于视觉层的**色值**。形态面一个字不动——小圆角（6/8/12/16）、发丝边框、柔和阴影、首字头像（`components/Avatar.tsx`）、三栏骨架、断点（1080/900/640）、字体（系统 sans + 系统 mono）；token 名契约面（`--bg` / `--surface` / `--panel` / `--panel-2` / `--fg` / `--muted` / `--faint` / `--border` / `--border-strong`）逐字保留。**不恢复** 0 圆角 / 2px ink 边框 / 硬偏移阴影 / 像素头像 / Space Grotesk 三字体。

## Problem Statement

产品所有者（人类）原话：**「当前 UI 蓝色为基调有点过于深沉了，可不可以改成马卡龙配色。」**

现状：本仓视觉方向由 `docs/adr/0014-visual-direction-modern-minimal.md` 裁决为 `modern-minimal`（Linear / Vercel 语域）——近白纸面 `--bg oklch(99% 0.002 240)`、单一 indigo 强调色 `--accent oklch(56% 0.17 256)`、发丝分隔、小圆角。该裁决**已全量落地、不是纸面文档**：实施票 02–10 全部合入 main（`5b98e5c` … `10d20aa`），`worksplice-design-system/` 30 个文件入库并成为运行时真源。

ADR-0014 同时写死了一条与本票直接冲突的裁决原文：**「马卡龙 × brutalist 的 token 体系整体退役——不是叠加、不是并存」**，以及「单一 indigo 强调色」。用户现在要的正是被它推翻的方向 ⇒ 本票是**既有裁决的再改判**，必须由自己的 ADR（`docs/adr/0015-*.md`）承载论证，不能靠「用户说了」直接实施。

ADR-0014 当年推翻马卡龙的理由是**证据层级**：马卡龙方向是「设计者自拟的方向声明」，而 modern-minimal 是「产品所有者提供的、带来源与保真度说明的可执行契约」。**现在这个层级关系变了——提出马卡龙要求的人就是产品所有者本人**，他既是方向的来源也是契约的授权者。新 ADR 正面处理这一点，不复述旧论证。

**本票要解决的第二件事：马卡龙亮档在对比度上不可能自洽。** 实测（WCAG 相对亮度公式，见 Testing Decisions）：

- 最亮的柠檬 `#f6e193` 作文字落在暖底纸上只有 **1.23:1**（正文 AA 要 4.5:1）；薰衣草作焦点环 **1.60:1**（非文本 AA 要 3:1）。
- 候选语义色 `--error #f28b82` 作文字 **2.26:1**、作状态点在卡面上 **2.35:1**——比现状 `#db423c` 的 4.32:1 更差。
- 现状 `--accent` 作文字落在 `--panel-2` 上已经只有 **4.17:1**、`--error` 作文字 **4.21:1**、`--faint` 落在 `--panel-2` 上 **4.10:1**——今天就有三处贴着或低于 AA 线。

所以「换成马卡龙」不是「改几个色值」，而是**给每条色相补一套对比度分层**（本文件称**档位**，见 CONTEXT.md）。这一层结构既是本票的最大设计产物，也是后续实施票的验收对象。

## Solution

本票的 Solution 就是**契约定稿**：一份可机械验收的色板 + 一套档位规则 + 一份调用点迁移账。实施票只做落地，不再做取舍。

### 决策表

**来源**列：**产品所有者答复** = 经 `orca orchestration ask` 问回人类产品所有者并获答复（问题 ID、逐条答复与轮次记录见票据 `01` 的 `## Answer`）；**coordinator 代答** = 派活方按 §5.3 代答（可被后续挑战）；**spec 产物** = spec 作者按资料与实测推断的形态（不由人裁决）。

| 决策 | 裁决 | 来源 |
| --- | --- | --- |
| **D0-1 范围** | **只改配色，形态一字不动**；保留小圆角 6/8/12/16、发丝边框、柔和阴影、首字头像、三栏骨架、断点与上列 token 名；不恢复 0 圆角 / 2px ink / 硬阴影 / 像素头像 / 三字体 | 产品所有者答复（冻结前提） |
| **D0-2 色板策略** | **多色 pastel 分区**（不是一个 pastel 品牌色）——对「single brand hue」这条契约表述的实质修改 | 产品所有者答复（冻结前提） |
| **D0-3 底纸与墨色** | **暖奶霜底 + 深墨**：`--bg` 移到暖色相（hue 85）、`--panel` / `--panel-2` 同族暖一档、`--fg` 转深梅墨 | 产品所有者答复（冻结前提） |
| **D0-4 语义色与头像色板** | **一起马卡龙化**（`--online` / `--working` / `--error` / `--offline` 与 `--av-0…--av-4`）；`--error` 必须仍一眼是「错」 | 产品所有者答复（冻结前提） |
| **D1 token 映射形态** | **(a) 同名 + 分档 + 新增角色族**：`--accent*` 名字保留（`--accent` = 马卡龙填充档），新增 `--accent-deep` / `--accent-graphic` 与 `--selected*` / `--unread*` / `--warn*` 三个角色族；**否决 (b) 按角色重命名**（216 处逐处归位 + 约 60 条字符串级断言重写，零视觉收益，且正是 ADR-0014 引 DESIGN.md 反模式第一条所禁的动作） | **产品所有者答复（Q-A1 = a）** |
| **D2 对比度补齐策略** | **甲 = 三档**：fill（马卡龙亮档，只做填充）+ tint（淡底）+ deep（文字档）/ graphic（焦点环与状态点档），后两者由同色相压深派生 | **产品所有者答复（Q-A2 = 甲）** |
| **D3 角色分工表** | 行动=樱粉 · 选中/导航=薰衣草 · 未读=柠檬 · 警示=蜜桃 · 在线=薄荷 · 进行中=杏 · 出错=珊瑚红 · 离线=藕灰 · 头像=五格确定性取色 | **产品所有者答复（Q-A2，与荐答一致）** |
| **D4 语义色的部分改判** | **状态点保持今天的饱和度、不马卡龙化**（马卡龙亮档只落到填充档）——这是对 D0-4「一起马卡龙化」的**部分改判（否决前一条答复的一半）**；理由是实测：马卡龙亮档作状态点只有 1.6–2.4:1，那是「状态点看不见」的产品问题，不只是合规问题 | **产品所有者答复（改判，否决 D0-4 的一半）** |
| **D5 `--on-accent` 立** | 新增 `--on-accent` = 深梅墨（`var(--fg)`），把全仓 20 处 `oklch(99% 0.01 256)` 硬编码收口到它（`app/globals.css` 5 · `components/**` 15）。票 03 当年豁免该 token 的理由（「上游没有、会牵动票 04 的块」）在此不成立：上游正是本次要改的东西，而 pastel 亮底 + 白色前景必然不达标 | coordinator 代答（票面 §「我（coordinator）已代答的细节」） |
| **D6 对比度硬门槛** | 文字 **4.5:1**、大字与图形边界 **3:1**（WCAG AA）为下限，不达不通过；每个「填充 + 其上文字」配对给实测值（本文件已给）；不改暗色主题 | coordinator 代答（票面 §Implementation Decisions） |
| **D7 档位命名与用途** | **base 名 = 该族在今天的实际主用途档**（迁移面最小、且该用途的对比度必须达标）；新增档一律加后缀（`-deep` / `-graphic` / `-fill` / `-soft`）。族 × 档位矩阵见下 | spec 产物 |
| **D8 头像取色映射** | `--av-0…--av-4` 的确定性映射函数（成员 index / id → 色格）与「我」恒 `--av-4` 的例外见下；由 spec 作者定 | spec 产物（票面授权「由你定，写进 spec」） |
| **D9 警示族的摊派** | `--warn*` 承接今天借 `--working` 的**警示语义**站点（`.meter.warn` / `.lv.warn` / 横幅类），`--working` 只留给「正在干活 / in_review」 | spec 产物（D3 分工表落到调用点的推断） |
| **D10 阴影与遮罩的 ink** | `--shadow-*` 与 `.overlay` 的 scrim 的 ink 由 `oklch(21% 0.02 255)` 换到梅墨族（几何与透明度档位不动）——阴影带色相，属配色面 | spec 产物 |
| **D11 值落在哪** | 色值全部落在 `worksplice-design-system/colors_and_type.css`（+ `tokens.css` 不涉），**不在 `app/globals.css` 覆盖同名 token**——这是 `app/globals.test.mjs` 的 T-A「同名值逐字相同」断言要求的唯一形态（见 Testing Decisions） | spec 产物（由既有断言导出，不是自由选择） |
| **D12 拆票** | 三张实施票（expand → migrate → contract），见 Further Notes | spec 产物（形状由 coordinator 预先对齐，本票确认） |

### 色板

**纸张族**（oklch 为契约值，sRGB 为便于核对与写断言的近似值）：

| token | oklch | sRGB | 角色 | 关键实测（配谁） |
| --- | --- | --- | --- | --- |
| `--bg` | `oklch(98% 0.011 85)` | `#fcf8f0` | 页面画布（暖奶霜） | —（画布；与 `--fg` 11.71:1） |
| `--surface` | `oklch(99.4% 0.006 85)` | `#fffdf9` | 卡片 / chrome / 弹层 | 与 `--fg` 12.21:1 |
| `--panel` | `oklch(95.7% 0.018 85)` | `#f6f0e4` | 栏 / 列 / well | 与 `--fg` 10.93:1 · 与 `--muted` 6.38:1 |
| `--panel-2` | `oklch(93.1% 0.022 84)` | `#efe7d8` | 嵌套 well / chip / 代码块 | 与 `--fg` 10.10:1 · 与 `--faint` 4.52:1 |
| `--fg` | `oklch(33% 0.045 300)` | `#393049` | 主文字（深梅墨）· 兼 `--on-accent` | on `--bg` 11.71:1 · on `--panel-2` 10.10:1 |
| `--muted` | `oklch(46% 0.030 300)` | `#5a5467` | 次级文字 | on `--bg` 6.84:1 · on `--panel-2` 5.90:1 |
| `--faint` | `oklch(52% 0.024 300)` | `#6b6675` | 三级 / meta / placeholder | on `--bg` 5.24:1 · on `--panel-2` 4.52:1 |
| `--border` | `oklch(90% 0.013 86)` | `#e2ded5` | 发丝分隔 | vs `--bg` 1.27:1（分隔线，非边界；继承缺口见 Out of Scope） |
| `--border-strong` | `oklch(78% 0.020 86)` | `#bdb7a9` | 输入 / 交互边界 | vs `--surface` 1.97:1（同比改善但未达 3:1，继承缺口） |
| `--fg-soft` | `color-mix(in oklch, var(--fg) 5%, transparent)`（配方不变） | over `--bg` ≈ `#f2eee8` | hover 填充 | over `--bg` ΔL 2.95（可见性判据） |
| `--shadow-*` / scrim ink | `oklch(33% 0.045 300 / …)`（透明度档位不动） | 同 `--fg` | 阴影与遮罩的色相（D10） | —（带 alpha，不参与文字配对） |
| `--on-accent` | `var(--fg)` | `#393049` | 填充档上的文字（D5） | on 八个 fill 档 5.19–9.52:1 |

**族 × 档位**（`fill` 亮档 / `soft` 淡底 / `deep` 文字档 / `graphic` 环·点档）：

> `soft` 的配方 = `color-mix(in oklch, var(--<族>) <配比>%, transparent)`（配比见行内）；表里的 sRGB 是它**合成在 `--surface` 上**的结果——文档校对与实施票断言都以这个合成为准。淡底的可见性判据是 ΔL ≥ 3.0（同样对 `--surface`）。

| 族 | 角色 | fill（+ 深墨 on fill） | soft | deep（on `--panel-2`） | graphic（on `--panel-2`） |
| --- | --- | --- | --- | --- | --- |
| `--accent` | 行动 · 主按钮 / 徽标 / composer send / agent 身份 | `oklch(85.7% 0.086 356.8)` `#ffb9d1` · 7.75:1 | mix 22% `#ffeef0` | `oklch(53% 0.086 356.3)` `#93566d` · 4.51:1 | `oklch(62.6% 0.086 356.7)` `#b27289` · 3.02:1 |
| `--selected` | 选中 / 导航激活 / 锚点行 / tab / 选中 chip | `oklch(84.9% 0.081 299.9)` `#d5c2fb` · 7.64:1 | mix 21% `#f6f1f9` | `oklch(52.4% 0.081 299.8)` `#715f92` · 4.55:1 | `oklch(62.4% 0.081 300.5)` `#8f7cb1` · 3.01:1 |
| `--unread` | 未读角标 / 未读点 | `oklch(91% 0.100 94.8)` `#f6e193` · 9.52:1 | mix 34% `#fcf3d6` | `oklch(51.8% 0.100 94.5)` `#7b6712` · 4.51:1 | `oklch(61.6% 0.099 94.7)` `#988437` · 3.00:1 |
| `--warn` | 警示 / 待审提示 / 横幅 | `oklch(86.3% 0.084 52.2)` `#ffc39f` · 8.01:1 | mix 22% `#fff0e5` | `oklch(52.6% 0.084 51.9)` `#915c3b` · 4.50:1 | `oklch(62.1% 0.083 51.6)` `#af7857` · 3.03:1 |
| `--online` | 在线点 / 任务 done / 成功徽标 | `oklch(80.8% 0.108 159.6)` `#7fd6a8` · 7.14:1 | mix 20% `#e5f5e9` | `oklch(50.6% 0.107 159.9)` `#16774f`（=`--online-text`）· 4.51:1 | `oklch(60.1% 0.108 159.4)` `#3b9469`（base）· 3.04:1 |
| `--working` | 正在干活脉冲 / in_review / 处理中 | `oklch(84.3% 0.110 74.6)` `#f6c177` · 7.57:1 | mix 20% `#fdf1df` | `oklch(52.3% 0.110 75.2)` `#8e5f01`（=`--working-text`）· 4.51:1 | `oklch(61.9% 0.110 74.2)` `#ad7b2f`（base）· 3.02:1 |
| `--error` | 出错 / 危险 / 失败 | `oklch(74.5% 0.127 25.8)` `#f28b82` · 5.19:1 | mix 20% `#fce6e1` | `oklch(53.2% 0.128 25.9)` `#aa4a44`（base）· 4.53:1 | `oklch(63.1% 0.127 25.5)` `#cb6861` · 3.00:1 |
| `--offline` | 离线点 / 任务 closed | `oklch(82.5% 0.026 303.4)` `#c9c2d4` · 7.18:1 | mix 20% `#f4f1f2` | `oklch(51.8% 0.026 302.5)` `#6b6575` · 4.57:1 | `oklch(61.8% 0.026 304.2)` `#898293`（base）· 3.01:1 |

**base 名与档位的对应（D7）**——表里「base」列出的族，其同名 token 就是那一档，其余档位带后缀：

| 族 | base 名指向 | 迁移含义 |
| --- | --- | --- |
| `--accent` | **fill** | 26 处填充调用点零改动；文字 / 环调用点改指 `--accent-deep` / `--accent-graphic` |
| `--selected` / `--unread` / `--warn` | **fill** | 新增族，无存量调用点；由实施票在选中 / 未读 / 警示站点接管现用的 `--accent*` 与 `--working*` |
| `--online` / `--working` / `--offline` | **graphic** | 点 / 条 / 标记的调用点（填充 18 / 10 / 3 处）零改动；徽标与横幅底改指 `-fill` |
| `--error` | **deep** | 56 处「error 作文字」零改动且对比度从 4.21 提升到 5.26；点与描边同样达标（5.26:1）→ **不另设 `--error-graphic`**（同值第二名字）；14 处填充改指 `--error-fill` |
| `--online` / `--working` 的文字档 | **`-text`** | 沿用既有名字（`--online-text` / `--working-text`，18 + 14 处零改名），配方由 `color-mix` 改为**实值**（可审计，不再随两个输入漂移） |

> **D7 的代价（明写，不假装一名一义）**：`--accent` 一名多义——它同时是「行动」这个角色的族名，又是该族的填充档。这对读者是多一层要记的对应关系。缓解有三条：① 本表就是唯一权威对照，实施票与后续读者以它为准；② `colors_and_type.css` 里每个族块头写一行档位注释（`/* fill = 马卡龙亮档：填充；deep = 文字；graphic = 环/点 */`）；③ 只有 `--accent` 一名多义（其余族的 base 指向见上表），blast radius 有限。**不允许**在文档里把它写成「名字已经表达档位」。

### 对比度实测（全部配对，WCAG AA 下限）

**文字 on 纸张**（阈值 4.5:1）：

| 前景 \ 背景 | `--bg` | `--surface` | `--panel` | `--panel-2` |
| --- | --- | --- | --- | --- |
| `--fg` | 11.71:1 | 12.21:1 | 10.93:1 | 10.10:1 |
| `--muted` | 6.84:1 | 7.13:1 | 6.38:1 | 5.90:1 |
| `--faint` | 5.24:1 | 5.46:1 | 4.89:1 | 4.52:1 |

**每个「填充 + 其上文字」配对**（fill + 深墨 `--on-accent`）与 deep / graphic 在两档纸张上的实测：

| 配对 | 实测 | 阈值 | 判定 |
| --- | --- | --- | --- |
| `--accent` fill + `--on-accent` | 7.75:1 | ≥4.5 | ✓ |
| `--selected` fill + `--on-accent` | 7.64:1 | ≥4.5 | ✓ |
| `--unread` fill + `--on-accent` | 9.52:1 | ≥4.5 | ✓ |
| `--warn` fill + `--on-accent` | 8.01:1 | ≥4.5 | ✓ |
| `--online-fill` + `--on-accent` | 7.14:1 | ≥4.5 | ✓ |
| `--working-fill` + `--on-accent` | 7.57:1 | ≥4.5 | ✓ |
| `--error-fill` + `--on-accent` | 5.19:1 | ≥4.5 | ✓ |
| `--offline-fill` + `--on-accent` | 7.18:1 | ≥4.5 | ✓ |
| 各族 `-deep` on `--bg` | 5.22–5.30:1 | ≥4.5 | ✓（8/8） |
| 各族 `-deep` on `--panel-2`（最暗纸张） | 4.50–4.57:1 | ≥4.5 | ✓（8/8） |
| 各族 `-deep` on 自家 `-soft`（如 `.filter-chip.is-on`） | 4.65–5.03:1 | ≥4.5 | ✓（8/8） |
| 各族 `-graphic` on `--bg` | 3.48–3.52:1 | ≥3.0 | ✓（8/8） |
| 各族 `-graphic` on `--panel-2` | 3.00–3.04:1 | ≥3.0 | ✓（8/8） |
| 各族 `-graphic` on 自家 `-soft`（选中 chip 的边界） | 3.08–3.34:1 | ≥3.0 | ✓（8/8） |
| `--fg` 落在每格头像 tile 上（`--av-0…--av-4`） | 7.14–9.52:1 | ≥4.5 | ✓（5/5） |
| 淡底可见性：`-soft` 在 `--surface` 上的 ΔL | 3.02–5.32 | ≥3.0（本 effort 自定判据，见 Testing Decisions） | ✓（8/8） |

**与现状的对照（不得回归）**：

| 配对 | 现状 | 本方案 | 结论 |
| --- | --- | --- | --- |
| `--accent` 作文字 on `--bg` | 4.62:1 | 5.23:1（`--accent-deep`） | 改善 |
| `--accent` 作文字 on `--panel-2` | 4.17:1（**低于 AA**） | 4.51:1 | 改善并达标 |
| `--error` 作文字 on `--bg` | 4.21:1（**低于 AA**） | 5.26:1 | 改善并达标 |
| `--faint` on `--panel-2` | 4.10:1（**低于 AA**） | 4.52:1 | 改善并达标 |
| `--online` 点 on `--surface` | 3.16:1 | 3.04:1 | 持平（仍 ≥3:1） |
| `--working` 点 on `--surface` | 2.35:1（**低于 3:1**） | 3.02:1 | 改善并达标 |
| `--offline` 点 on `--surface` | 2.00:1（**低于 3:1**） | 3.01:1 | 改善并达标 |
| `--error` 点 on `--surface` | 4.32:1 | 5.26:1 | 改善 |
| `--border-strong` vs `--surface` | 1.58:1 | 1.97:1 | 改善但仍未达 3:1（继承缺口，见 Out of Scope） |

### 消费点账（迁移面的定量口径）

口径：`var(--accent*)` 在 `app/**` + `components/**` + `hooks/**` + `lib/**` 的 `.ts/.tsx/.css` 里的**逐文件出现次数**。

**总计 216 处 = `app/globals.css` 78 + `components/**` 138**（`--accent` 150 · `--accent-soft` 56 · `--accent-line` 7 · `--accent-hover` 3）。按最近属性名判定的角色拆分（脚本口径，逐行取 `var()` 之前最近的 `属性名:`）：

| 档 | 属性 | 处数 | 迁移去向 |
| --- | --- | --- | --- |
| 文字 | `color` 66 · `text-decoration-color` 2 | 68 | `--accent-deep` |
| 边框 / 焦点环 | `border-color` 21 · `-line` 6 | 27 | `--accent-graphic` |
| 图形 | `stroke` 4 · `-line` 1 | 5 | `--accent-graphic` |
| **迁移小计** | | **≈100** | |
| 填充 | `background` 26 · `-soft` 43 · `-hover` 3 | 72 | 零改动（`--accent` 即 fill 档） |
| 图形阴影 | `-soft` 的 `box-shadow` 7 | 7 | 零改动（tint 用途不变） |
| **零改动小计** | | **≈79** | |
| 逐处判 | 行内多属性样式行 + `color-mix` 表达式（未能机械判定） | ≈36 | 实施票逐处按语义归属 |

> 口径修正（诚实记录）：本票的 Q-A1 提问里写的「约 78 处文字/环调用点」是 `app/globals.css` 的**文件口径**，与角色口径不是同一件事。角色口径的迁移面是 **≈100 处**（上表）。spec 以 100 为准，A1 裁决的成本模型（(a) ≈100 迁移 vs (b) 216 处全量改名 + 约 60 条断言重写）依然成立且差距仍是 2× 以上。

### 头像取色映射（D8）

`--av-0…--av-4` = 薰衣草 · 薄荷 · 蜜桃 · 柠檬 · 藕灰（第 5 格仍是**中性格**，沿用「我」恒用 `--av-4` 的既有语义，DESIGN.md 与 design-system-refactor spec 的 D6 都依赖它）；五格的 oklch / sRGB 与「深墨落在 tile 上」的实测：

| token | oklch | sRGB | 色名 | 深墨 on tile |
| --- | --- | --- | --- | --- |
| `--av-0` | `oklch(84.9% 0.081 299.9)` | `#d5c2fb` | 薰衣草 | 7.64:1 |
| `--av-1` | `oklch(80.8% 0.108 159.6)` | `#7fd6a8` | 薄荷 | 7.14:1 |
| `--av-2` | `oklch(86.3% 0.084 52.2)` | `#ffc39f` | 蜜桃 | 8.01:1 |
| `--av-3` | `oklch(91% 0.100 94.8)` | `#f6e193` | 柠檬 | 9.52:1 |
| `--av-4` | `oklch(82.5% 0.026 303.4)` | `#c9c2d4` | 藕灰（中性，「我」） | 7.18:1 |

确定性映射（纯函数，无随机、无时间）：

1. 人类（`member.type === "human"` / `CURRENT_MEMBER_ID`）→ `--av-4`；
2. 有列表序号的调用点 → `--av-{index % 4}`；
3. 无列表序号的调用点 → `--av-{stableHash(memberId) % 4}`，`stableHash` = 对 UTF-16 码元做 FNV-1a 32 位散列（溢出按 `Math.imul`，与平台无关）。

三条一起保证「同一成员在任何位置恒定同色」；第 3 条把「序号」从**手段**降级为**可选**（7 个调用点里有 5 个没有列表上下文——见 design-system-refactor spec D6 的取色段）。

## User Stories

1. 作为产品所有者，我打开任一界面（频道流 / 任务板 / 右栏 / 模态），第一眼看到的基调是**暖奶霜底 + pastel 填充**而不是深蓝——具体判据是：`--bg` 的 oklch 色相落在 80–90（暖），`--accent` 的亮度 ≥ 84%（亮档），且 `--accent` 不再出现在任何文字 / 焦点环的调用点上。
2. 作为产品所有者，我能从颜色上区分**行动**（主按钮 / 焦点环 / agent 身份）与**选中态**（导航 / 未读）——它们是不同的 pastel（樱粉 vs 薰衣草 vs 柠檬），而不是同一个蓝的深浅。
3. 作为使用者，我在任何 pastel 填充上读到的文字都达到 AA（正文 4.5:1，实测 5.19–9.52:1），并且在没有色觉辅助时也能靠明度差读出层级（deep 档与 fill 档的亮度差 ≥ 30pt，实测约 32pt）。
4. 作为出错的人，我看到的 `error` 态仍然一眼是「出错了」：填充档是珊瑚红（色相 25.8），文字 / 描边 / 点档是 `oklch(53.2% 0.128 25.9)`，与暖色 pastel 装饰（蜜桃 52.2 / 樱粉 356.8）既不同亮度也不同饱和度，且对比度比今天更高（4.21 → 5.26）。
5. 作为用键盘的人，我 Tab 到任意可聚焦元素时都看到对比度 ≥3:1 的焦点环——ring 走 `-graphic` 档（实测 3.48–3.52:1 on 底纸），不再是 1.4:1 的马卡龙亮档。
6. 作为下游的 agent 消费者，我打开 `worksplice-design-system/` 就能读到唯一一份色板契约（值 + 角色 + 档位 + 对比度），不需要回去问人：`colors_and_type.css` 是值的事实来源，`DESIGN.md` 的色板段与它逐值对齐。
7. 作为将来改视觉的人，我把 `--accent` 从樱粉换成别的过去色时，不需要重新推导对比度——因为档位规则（每族 fill / deep / graphic 三层）与验收断言（contrast 表）都在 spec 与测试里，我只需要让新值过同一张表。
8. 作为审计这套改判的人，我读 `docs/adr/0015-*.md` 就知道被推翻的是什么（ADR-0014 的色板段）、为什么推翻（证据层级反转 + 产品所有者的实测约束）、保留了什么（形态段与 token 名契约）、以及被否决的备选与被否决的代价。

## Implementation Decisions

### 1. 交付物（本票产出，全部是文档）

| # | 交付 | 位置 |
| --- | --- | --- |
| 1 | 本 effort 的 spec 正本（本文件，七节模板） | `.scratch/macaron-palette/spec.md` |
| 2 | 新 ADR：色板段的再改判 | `docs/adr/0015-macaron-palette-warm-cream-pastel.md` |
| 3 | 术语决议（inline 落盘） | `CONTEXT.md` |
| 4 | 拆票建议 | 本文件 Further Notes |

### 2. 值落在哪里（D11，由既有断言导出）

`app/globals.test.mjs` 的 T-A 断言「设计系统每个 token 都在产品里取到，且同名值逐字相同」——它读 `worksplice-design-system/colors_and_type.css` 与 `tokens.css` 的 `:root` 声明集合，再读 `app/globals.css`（含其 `@import`）的有效集合，逐值比对。推论有两条，都不是可选的：

1. **色值必须改在 `colors_and_type.css` 里**（上游即运行时真源，ADR-0014 的 D2 已确立）。若改在 `app/globals.css` 的扩展层覆盖同名 token，T-A 立刻红——那是把「上游是契约」改成「上游是参考」，属另一场裁决。
2. `app/globals.css` 的扩展层**只加不改**：新档位（`-deep` / `-graphic` / `-fill` / `-soft` 的族名）与 `--on-accent` 是上游没有的名字，加在扩展层不触 T-A；`--online-text` / `--working-text` 的**实值**也落扩展层（它们是本仓的组合名，不是上游名，T-A 不覆盖）。

### 3. 三个角色族的形状（D1 + D7）

- `--selected*`：fill / soft / deep / graphic 四档。承接「当前位置」语义（导航激活、锚点行、tab、选中 chip）——旧方向的 `--yellow` 曾同时承担「当前位置」与「正在干活」，ADR-0014 把它拆到 `--accent-soft` / `--working`；本票把「当前位置」独立成族，语义回到一色一义。
- `--unread*`：fill / soft / deep / graphic 四档。承接未读角标与未读点（今天由 `--accent` 兼任，见 `.badge`）。未读是**注意力**信号，与「行动」不同族。
- `--warn*`：fill / soft / deep / graphic 四档。承接今天借 `--working` 的警示站点（`.meter.warn i`、`.lv.warn`、上传/信任类横幅），`--working` 只留给「正在干活 / in_review」。这一条会改到既有断言（见 Testing Decisions 的回归清单）。
- **点缀不另立色相**：提及、标签、徽标这些「装饰性强调」由**行动族**的 `soft` / `deep` 承担（今天就是 `--accent-soft` + `--accent`）。马卡龙色板不是「每格都上墙」，而是「每个角色恰好一个色相」——这条同时守住 DESIGN.md 反模式里的「颜色只在有语义时出现」。

### 4. `--on-accent`（D5）

- 值 = `var(--fg)`（深梅墨）。**不**按角色给多个 on-* token：全仓 8 个填充档的实测对比度都在 5.19–9.52:1，一个值即可覆盖，多开一个 token 面只增加漂移风险。
- 收口面：20 处 `oklch(99% 0.01 256)` 字面量（`app/globals.css` 5——含 1 处 `.01` 拼写变体——与 `components/**` 15：`ModelsConfig` 9 · `SkillsConfig` 2 · `PluginsConfig` 1 · `DirectoryPicker` 1 · `ChatInput` 1 · `ChannelView` 1）。
- 机械判据：改完后全仓 `grep -rn 'oklch(99% \?\.\?0\?1 256)' app components hooks lib` 为 0。

### 5. 不动的面（硬边界，本票与实施票同受约束）

- 形态：圆角、边框宽度、阴影几何、间距、字号、行高、mono 用法、动效时长与缓动、断点、z-index 阶梯——一字不动。**唯一例外**是 D10 的阴影 / scrim **色相**（几何与透明度档位不动）。
- token 名：`--bg` / `--surface` / `--panel` / `--panel-2` / `--fg` / `--muted` / `--faint` / `--border` / `--border-strong` / `--accent*` / `--online` / `--working` / `--error` / `--offline` / `--av-*` / `--sp-*` / `--r-*` / `--fs-*` / `--z-*` / `--dur*` / `--ease` 全部保留；只新增（`--on-accent` / `-deep` / `-graphic` / `-fill` / 三个角色族），只退役一个（`--accent-line`——它被 `-graphic` 取代，见 Further Notes 的拆分票）。
- 行为与数据：见零行为改动声明；不触 schema、不触 HTTP 面、不触 `~/.worksplice`。
- 不做暗色主题（`hooks/useTheme.ts` 恒亮色；DESIGN.md 明写「无深色主题、单档亮色」）。

### 6. 本票自身的边界（零源码改动）

不改 `worksplice-design-system/colors_and_type.css` / `tokens.css` 的任何值；不改 `app/globals.css`、`components/**`、`app/**`、`hooks/**`、`lib/**` 任何一行；不改 `worksplice-design-system/DESIGN.md` / `SKILL.md`，不改 `docs/spec.md` §4，不改 `AGENTS.md`——按 ADR-0014 立下的纪律「文档改写随实施票落地」。新 ADR 与 spec 是**裁决与设计正本**，不是「描述当前代码」的文档，所以它们可以先落。

## Testing Decisions

本票不跑测试（源码改动面为零，无被测对象）。本节给后续实施票留下**可机械判定**的判据。

### 1. 对比度（唯一硬门槛）

**计算方式**：WCAG 2.x 相对亮度公式——对 sRGB 每个通道 `c`：`c ≤ 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4`，`L = 0.2126R + 0.7152G + 0.0722B`，`contrast = (L₁+0.05)/(L₂+0.05)`（L₁ 为亮者）。oklch → sRGB 用 OKLab 标准矩阵（Björn Ottosson 版）。本文件的所有比值都由该公式算出，过程可在实施票里用同一份 ~40 行纯函数复现（仓库无既有对比度工具，需新增；见第 2 条）。

**下限**：文字 **4.5:1**；大字与图形边界（焦点环、状态点、拖拽落点、选中 chip 的边界）**3:1**。**每个「填充 + 其上文字」配对必须有实测值**，见 Solution 的两张表。

**判定方式**：新增 `app/globals.contrast.test.mjs`（node:test + 纯函数），把 Solution 的配对表与实测值写成断言数据：
- 从 `colors_and_type.css` 解析 `:root` 的档位值（含 `color-mix` 的族需先按 spec 的配比合成——配比写在 spec 表中，是契约的一部分）；
- 对每对 `(fg, bg, min)` 断言 `contrast ≥ min`，容差 ±0.05（防浮点/取整抖动）；
- 淡底可见性另立一条：`ΔL_perceptual(soft ≠ surface) ≥ 3.0`（用 oklch 的 L 差即可，避免引入第二套色彩模型）。

### 2. token 面收口（「硬编码字面量没了」的机械证明）

| 现在的字面量 | 改完之后 | 证明方式 |
| --- | --- | --- |
| `oklch(99% 0.01 256)`（20 处：globals.css 5 · components 15） | `var(--on-accent)` | 全仓正则计数为 0（含 `.01` 拼写变体） |
| `oklch(21% 0.02 255 / …)`（阴影 ink，`colors_and_type.css` 的 `--shadow-*` + `globals.css` 的 2 处 scrim/dialog 背景） | `oklch(33% 0.045 300 / …)` | 全仓正则计数为 0 |
| `--accent-line`（7 处） | `--accent-graphic` | `--accent-line` 的定义与引用都为 0（退役） |
| 新的档位值散落在组件里 | 只出现在 token 文件 | 组件内 `grep -c 'oklch('` 不增（这条是**不回归**判据，不是新增约束） |

### 3. 渲染面证据（实施票的绿证据）

绿证据必须是**产品自己渲染出的东西**，不许只断「某个 class 字符串在不在」。本仓既有 seam 有两个，实施票复用、不新增夹具：

- `components/*.test.mjs` 的 `renderToStaticMarkup` + `jiti`（范本：`components/Avatar.test.mjs`、`components/ProjectTrustDialog.test.mjs`、`components/StatusDot.test.mjs`）——断言**渲染出的 style/class** 绑到了正确的档位 token。
- 若某处只能读源码（CSS 规则体），沿用 `components/primitives.test.mjs` / `dock.test.mjs` 的 `ruleBody()`+正则 seam，并在票面写明「此处无渲染面可断言」的理由——**不得**用它替代渲染面断言。

具体到本 effort：

| 面 | 断言 |
| --- | --- |
| `StatusDot` 四态 | 四个 status 各渲染出对应 token（`--online-graphic` / `--working-graphic` / `--error` / `--offline-graphic`），且**不再**出现马卡龙亮档（`#7fd6a8` 等不进入点） |
| `Avatar` | 五格 tint 仍各绑 `--av-N`；人类 tile 恒 `--av-4`；同一 id 两次渲染同色（确定性） |
| 焦点环 | `.btn` / 输入 / composer 的 `:focus-visible` 与 `:focus-within` 规则体取 `-graphic` 档（≥3:1） |
| 主按钮 / 徽标 | `.btn-primary` / `.badge` / `.composer-send` 的填充取 `-fill` 档、文字取 `--on-accent` |
| 选中态 | `.nav-row.is-active` / `.filter-chip.is-on` / `.member-opt.is-on` / `.reaction.mine` 的 fill + deep 成对出现（这正是 ADR-0014 里 `--bg-selected` 的「成对改 fill + fg」教训的复现） |

### 4. 回归风险（实地 grep 过的既有断言，逐个点名）

换色会踩到的**既有断言**（全部是字符串级：断言 `var(--token)` 名或色值字面量；本 effort 改的是**名字与用途的对应**，所以下列断言要么保持绿、要么按意图改写并写明理由）：

| 文件 | 行 | 断言内容 | 本 effort 下的处置 |
| --- | --- | --- | --- |
| `app/globals.test.mjs` | 202–208（T-C） | `:focus-visible { outline: 2px solid var(--accent) }` + `0 0 0 3px var(--accent-soft)` | **红**：环改 `-graphic` → 按意图改写（保留「环必须存在且用 accent 族」的判据） |
| `app/globals.test.mjs` | 260–263 | 四态渲染绑 `--online/--working/--error/--offline` | 保持绿（base 名不变） |
| `app/globals.test.mjs` | T-A（50–105） | 上游 token 与产品逐值相同 | **必须保持绿**（值改在上游，见 Implementation Decisions §2） |
| `components/primitives.test.mjs` | 41–49 | `.btn-primary` `background: var(--accent)` + `color: oklch(99%` | 填充断言保持绿；`oklch(99%` → `var(--on-accent)`（按意图改写） |
| `components/primitives.test.mjs` | 55–56 · 121–124 · 156–161 | `.btn-danger` 走 `--error`；四态点；五格 `--av-N` | 保持绿（名字不变） |
| `components/primitives.test.mjs` | 78–79 · 87 | `.icon-btn.is-on` / `.badge` 走 `--accent` + `--accent-soft` | 填充分别保持绿；若 `.icon-btn.is-on` 的**文字**改 deep 则按意图改写 |
| `components/StatusDot.test.mjs` | 22–25 · 67 | 四态 token 名 | **红**（点改 `-graphic`）→ 按意图改写 |
| `components/dock.test.mjs` | 218–224 | `.meter i` `--accent`（绿）· `.meter.warn i` `--working` | `.meter.warn` → `--warn`（D9）→ **红**，按意图改写 |
| `components/dock.test.mjs` | 273–276 · 315–320 | 任务状态映射 / `.tt-log` 四色点（ok→online、warn→working、err→error、is-now→accent） | 点档改名 → **红**，按意图改写（`is-now` 走 `--selected-graphic` 或 `--accent-graphic`，实施票定） |
| `components/dock.test.mjs` | 334–337 | `.lv.info` `--accent`（文字）· `.lv.ok` `--online-text` · `.lv.warn` `--working-text` · `.lv.err` `--error` | `.lv.warn` → `--warn-deep`（**红**，按意图改写）；其余绿 |
| `components/message-stream.test.mjs` | 187–202 · 271–282 · 320–355 · 362–413 | `.msg-author.is-agent` / `.chan-title .hash` 走 `--accent`（文字）· `.composer-send` 走 `--accent`（填充）· accent-soft 焦点环 | 文字类 **红** → `--accent-deep`；填充类绿；环按意图改写 |
| `components/task-board.test.mjs` | 78–81 | `in_progress: "var(--accent)"` / `in_review: "var(--working)"` / `done/closed` | 点档改名 → **红**，按意图改写 |
| `components/task-board.test.mjs` | 172–183 · 219–238 | `.drag-over` `--accent` · `.invalid-over` `--error` · `.filter-chip.is-on` `--accent-line` | `-line` 退役 + 拖拽边界走 graphic → **红**，按意图改写 |
| `components/AppShell.test.mjs` | 193 · 204–207 · 227–237 | `.brand-mark` `--accent`（填充）· `.search-btn:focus-within` `--accent` + accent-soft 环 · 导航激活 2px accent 竖条 + accent mono `#` | 填充绿；环与文字 **红** → 按意图改写 |
| `components/CreateChannelModal.test.mjs` | 94–113 | `.member-opt.is-on` 走 `--accent` + `--accent-soft` | 环/文字类按意图改写 |
| `components/SearchView.test.mjs` | 135–138 · 158–159 · 216–217 | 焦点环 `--accent` + accent-soft；命中作者名与被搜中 `--accent`；`.result mark` 走 `color-mix(--working 45%)` | 焦点环与命中文字 → `-graphic` / `-deep`（**红**，按意图改写）；`.result mark` 的**高亮语义**应改指 `--unread*`（未读/命中高亮与「进行中」无关），一并登记 |
| `components/BrutalModal.test.mjs` | 92 · 103 | `:focus-visible` 走 `--accent`；scrim 字面量 `oklch(21% 0.02 255 / 0.42)` | 两条都 **红**（环改 graphic、scrim ink 换族）→ 按意图改写 |
| `components/ReminderModal.test.mjs` | 123–127 | `.btn-danger` 走 `--error` | 保持绿 |
| `components/ProjectTrustDialog.test.mjs` | 63–66 | `color:var(--error)` | 保持绿（`--error` base = deep 档） |
| `components/AgentDetailPanel.test.mjs` | 107 | 渲染出 `var(--working)` | 若该处是「进行中」标记 → 保持绿；若是警示 → 按意图改写 |
| `components/Avatar.test.mjs` | 6 · 全文 | `--av-*` 绑定与 7px 圆角 | 保持绿（名字与形态都不变） |
| `components/MobilePwaLayout.test.mjs` | 四条 | 视口 / 安全区 / 640px 输入框 / `overflow-x-hidden overflow-y-auto` | **不得踩**：本 effort 不碰 className 与 `@media`，应全绿 |

**改写纪律**：凡上表标「按意图改写」，改的是**断言的落点**（token 名），不是**判据**（对比度、成对性、可达性不放宽）；每条改写都要在被改票的 Answer 里登记「原断言 → 新断言 + 理由」，不得静默删除。

## Out of Scope

- **形态改回 brutalist**（0 圆角 / 2px ink / 硬阴影 / 像素头像 / Space Grotesk）——D0-1 已排除；ADR-0015 的「被否决的备选」保留它的论证与代价。
- **暗色主题**（`hooks/useTheme.ts` 恒亮色；DESIGN.md 明写单档亮色）。
- **本票的 token 实际替换与文档同步**（属实施票；本票零源码改动）。
- **`issues/NN-*.md` 的建立**（属 coordinator 的 `to-tickets`；本票只给拆票建议）。
- **`--border-strong` 提升到 3:1**：今天 1.58:1、本方案 1.97:1，都没到 WCAG 1.4.11 的非文本 3:1。把输入边界提到 3:1 需要 L≈62% 的暖灰（`#8b8577` 级），那是**表单 chrome 的形态决定**（发丝感的取舍），不是配色改判；登记为继承缺口，留给独立票据。
- **`AGENTS.md` 第 546 行「CSS Variables」段的漂移修复**：该段至今仍是 ADR-0014 之前的旧 token 名（`--bg-panel --bg-hover --bg-selected --text --text-muted --text-dim --user-bg --tool-bg`）。本票**只登记**（见 Further Notes），实施票的 contract 段顺手对齐，不在本票修。
- **与本 effort 无关的既有文档漂移**（`docs/spec.md` §4 之外的部分、`worksplice-design-system/README.md` 引用的缺失文件等）。
- **新功能 / 新形态**：不新增组件、不新增交互、不引入渐变、不引入第二套字号。

## Further Notes

### 拆票建议

**拆 3 张票**（文件编号 `02…04`，`01` 是本设计票）。三票串行：`02 → 03 → 04`，每票单独落绿（测试绿），但见下方「中间态窗口」的知情项。

| 票 | 交付物 | Blocked by |
| --- | --- | --- |
| **02 `macaron-palette-tokens`（expand）** | `worksplice-design-system/colors_and_type.css` 的色值全量换成上表（纸张族 / 墨族 / 八族的 fill·deep·graphic / `--av-*` / 阴影与 scrim ink）；`app/globals.css` 扩展层**只加** `--on-accent` 与三个角色族（`--selected*` / `--unread*` / `--warn*`），不改任何调用点、不删任何旧名 | 无 |
| **03 `macaron-palette-migration`（migrate）** | 约 100 处 accent 族文字/环调用点改指 `-deep` / `-graphic`；7 处 `--accent-line` → `-graphic`；20 处 on-accent 字面量 → `var(--on-accent)`；约 14 处 error 填充 → `--error-fill`；四态点 → `-graphic` 档；`.meter.warn` / `.lv.warn` → `--warn*`；`--online-text` / `--working-text` 改实值；其余 `--working` / `--selected` 站点的档位归位；同步 Testing Decisions §4 表里标「按意图改写」的既有断言（逐条登记理由） | 02 |
| **04 `macaron-palette-contract`（contract）** | 清掉不再被引用的旧档位（`--accent-line`；若 03 之后确无引用）；新增 `app/globals.contrast.test.mjs`（Solution 两张表的机械断言 + ΔL 可见性）；同步 `worksplice-design-system/DESIGN.md` 的色板 / 语义色 / 头像三段、`SKILL.md` §4 的 on-accent 措辞与 §7 的 token 名条款、`AGENTS.md` 第 546 行 CSS 变量段（顺手对齐漂移）、`docs/spec.md` §4 整节 | 03 |

**为什么 3 票而不是 1 票**：改动面跨「契约值 / 调用点 / 文档」三类工作面，单票会让红-绿节奏无处落脚（改值与改调用点是两类可独立证伪的切片）。

**为什么 3 票而不是把 02 再拆**：色值是一次原子替换（改一半的色板不是可验收状态）；拆细只会产生「半套色板」的中间态。

**中间态窗口（知情项，实施票必读）**：02 落绿之后、03 落地之前，焦点环仍指 `var(--accent)`，而 `--accent` 已是马卡龙亮档（on 底纸 1.4–1.6:1）——这是**可访问性回归窗口**，虽然测试全绿。缓解有两条，实施时择一：① 02 与 03 **同批合流**（推荐）；② 02 内部把 `--accent` 的 base 档暂定为 graphic 档、由 03 再切回 fill 档（多一次值切换，不推荐）。这条也说明「每段单独落绿」在这次拆分里**不等于**「每段单独可用」。

### 已核过的事实（直接用，不要重查）

1. **改 token 只有一处可改**：`app/globals.css` 头部明写「设计系统即运行时真源……改 token 只有一处可改（上游），此处不复制它的 `:root`」。`colors_and_type.css` 管色板与字型，`tokens.css` 管间距/圆角/高度/动效/z-index——本 effort 只动前者（+扩展层新增名）。
2. **现状值**（供对照，见 Solution 的「与现状的对照」表）：`--bg` = `#fbfcfd` · `--surface` = `#ffffff` · `--panel` = `#f4f7f9` · `--panel-2` = `#edf1f4` · `--fg` = `#14191f` · `--muted` = `#5e646b` · `--faint` = `#6f757c` · `--border` = `#e2e5e8` · `--border-strong` = `#caced3` · `--accent` = `#2072d5` · `--accent-hover` = `#0160c1` · `--online` = `#2ea55c` · `--working` = `#de9d16` · `--error` = `#db423c` · `--offline` = `#b4b8bc`。
3. **契约文本里写着旧方向**（改判要精确引用它）：`colors_and_type.css` 的 `─── accent (indigo-blue, single brand hue)` 注释；`SKILL.md` 的 description（`modern-minimal direction, single indigo accent`）与 §4（`Primary button: --accent fill, ink oklch(99% .01 256)`）与 §7（`no renaming the --bg/--surface/.../--accent tokens`）；`DESIGN.md` §1/§2/§7；`docs/spec.md` §4（第 213 行起）。
4. **on-accent 字面量 20 处**：`app/globals.css` 5（含 1 处 `.01` 拼写变体，`app/globals.css:1353`）+ `components/**` 15（`ModelsConfig` 9 · `SkillsConfig` 2 · `PluginsConfig` 1 · `DirectoryPicker` 1 · `ChatInput` 1 · `ChannelView` 1）。`--on-accent` 这个 token 不存在。
5. **`--accent-line` 的 7 处消费者**：`.filter-chip.is-on` · `.reaction.mine` · `.task-chip`（border-left）· `.member-opt.is-on` · 另有 2 处混用 —— 它们要的都是「≥3:1 的族色边界」，正是 `-graphic` 档的用途 ⇒ `--accent-line` 退役。
6. **ADR-0014 的影响面清单**（写 ADR-0015 时用来说清「为什么只动配色也值得重开裁决」）：`app/globals.css` 的 token 块 + 52 个 class 选择器、`app/layout.tsx` 的 `themeColor`、30 个 `components/*.tsx` 共 1144 处 `var(--*)` 引用、`hooks/useIsMobile.ts` 断点、`PixelAvatar.tsx` → `Avatar.tsx` 的 7 个调用点迁移。
7. **先例**：`.scratch/design-system-refactor/spec.md`（七节 + 决策表 + 零行为改动声明 + 「裁决来源与留痕」段）；其 `issues/03-shell-skeleton.md` 第 91 / 111 / 159 行有 `--on-accent` 豁免的完整上下文（豁免理由在 D5 里被推翻并写明）。
8. **票据体系是本地 Markdown**（`.scratch/<effort>/spec.md` + `issues/NN-<slug>.md`，Status 行见 `docs/agents/triage-labels.md`）。本 effort 目录 = `.scratch/macaron-palette/`，`.scratch/` 是**入库**目录。
9. **ADR 编号**：`docs/adr/` 现有 0001–0014，本票的新 ADR 是 **0015**。
10. **本仓没有对比度工具**，也没有第二个同构的「档位」先例——最近的先例是 `app/globals.css` 扩展层的 `--online-text` / `--working-text`（「状态色作文字时往 `--fg` 混出同族深档」）。本票的三档结构就是把这套派生系统化。

### 术语决议（inline 落盘，见 CONTEXT.md）

新增两个词条：

- **档位 (Tier)**：同一色相族内按对比度用途分层的取值——**填充档**（族的本色，深墨文字压其上）/ **淡底档**（淡到只做背景提示，不做边界）/ **文字档**（同色相压深，≥4.5:1 可作正文）/ **图形档**（同色相中档，≥3:1 可作焦点环、状态点、边界）。它解释「为什么一个色相有三个值」，也是本 effort 唯一的新结构。_Avoid_: 色阶（会被读成同色相的明度渐变序列，那是色板而不是用途分层）、变体（泛指）。
- **角色族 (Role Family)**：以**角色**而不是色相命名的一组档位（`--accent*` / `--selected*` / `--unread*` / `--warn*` / `--online*` / …），每个角色恰好一个色相。它回答「多色 pastel 怎么映射到 token 名」。_Avoid_: 配色组（泛指）、主题（会被读成可切换的一套）。

既有词条**视觉契约 (Visual Contract)** 不变（名字与载体都没动），但本 effort 的「档位」是它的新维度：契约面从 1 档变成每族多档。

**不新增的候选与理由**（domain-modeling 判据：只收本项目特有概念）：马卡龙 / 暖奶霜（方向名，同 ADR-0014 对 modern-minimal 的处置）；对比度 / AA（通用标准）；on-accent（一个 token 名，不是领域概念）；换色 / 迁移（一次性动作）。

### 已知陷阱

1. **马卡龙亮档不能当文字、环、点**——这是本 effort 的存在理由。任何「把 `--accent` 当文字色继续用」的写法都会在 1.2–1.7:1 上静默失明，而且**测试可能仍绿**（字符串断言不看对比度）。新增的 contrast 断言（票 04）就是为了把这个洞堵上。
2. **pastel 的 `color-mix` 淡底要重配比**：今天的 `--accent-soft` = mix 11%（indigo 下 ΔL ≈ 4.94，可见）；同样的 11% 落到 pastel 上只有 ΔL ≈ 0.95–2.08（**看不见**）。各族 `-soft` 的配比必须按上表（20–34%），并连同可见性判据（ΔL ≥ 3.0）一起写进断言。
3. **状态点的对比度不能靠「看起来够」**：候选的 `#7fd6a8` / `#f6c177` / `#f28b82` 在卡面上分别是 1.71 / 1.61 / 2.35:1——全部低于 3:1，且比它们替换掉的现状值更差。这与 D4 的部分改判是同一件事的两面。
4. **`--accent` 一名多义**（D7）：读代码时不要假设「`--accent` 就是填充档」或「就是文字档」——以族 × 档位矩阵为准；实施票的族块头注释是就地提示。
5. **`oklch` 与 sRGB 的双写**：契约值是 oklch（本仓一贯），本文件的 sRGB 列是**便于核对与写断言的近似**；两者不一致时以 oklch 为准（例如 `oklch(51.8% 0.100 94.5)` 的回算 sRGB 是 `#7b6712`，取整误差在 ±1/255 内）。
6. **本票交付面全是文档**：Answer 里的省略说明必须含两条事实判据（源码改动面为空 ⇒ 无被测对象；diff 全是文档 ⇒ 「证据目录缺测试」类 finding 豁免）。

### 勘误（实施期发现）

本节每条都是**实施期用本 spec 自己的公式 / 断言复算**才暴露的（不是读代码得到的结论）——复算脚本复现了本文件的全部数字：现状 4 处不达标逐条对上、现状 `--accent-soft` mix 11% 的 ΔL = 4.94 逐字相同、soft 合成后的 sRGB 逐字相同。上面的七节原文保持不动，**与本节冲突处以本节为准**。

1. **Testing Decisions §3 / §4 里「四态状态点改指 `-graphic` 档」整条作废。** §4 表两行互相矛盾：一行说 `app/globals.test.mjs` 260–263 的两条四态断言「保持绿（base 名不变）」，另一行说 `components/StatusDot.test.mjs` 「**红**（点改 `-graphic`）」；§3 的渲染面表又写「`--online-graphic` / `--working-graphic` / `--offline-graphic`」。按 **D7**「base 名 = 该族在今天的实际主用途档」——`--online` / `--working` / `--offline` 今天的实际主用途就是点 / 条 / 标记，所以它们的 base 名直接持有 **graphic 档的值**、调用点零改动；`--error` 的主用途是文字，base 持 **deep 档**，且按 D7「同值第二名字」**不立** `--error-graphic`。**裁决（实施期，coordinator）**：§3 的 `-graphic` 名与 §4 的 StatusDot 行一并作废，`StatusDot` 与 `.presence.*` 一行不改、两份测试保持绿、不新增任何 `-graphic` 第二名字。
2. **`-soft` 淡底的配比修正：`--unread-soft` 34% → 36%、`--warn-soft` 22% → 24%**（Solution 表里这两族的 soft sRGB 随之变为 `#fcf3d4` / `#ffefe3`；那句「3.02–5.32 ✓（8/8）」作废）。原配比用本节同一套公式复算只有 **unread 2.95**（差 0.05）与 **warn 2.98**（差 0.02），并不满足本 effort 自定的 ΔL ≥ 3.0。修正后实测：accent 3.15 · selected 3.08 · **unread 3.13** · **warn 3.27** · online 3.89 · working 3.16 · error 5.28 · offline 3.34（8/8 ✓）。阈值 3.0 **不动**（降阈值等于把标准改成迁就值）。
3. **`--accent-hover` 的值（矩阵留白）。** 矩阵给了 `--accent` 的 fill / deep / graphic，没给 hover；它必须仍是**填充档**（其上压 `--on-accent` 深墨）——取 `--accent-deep` 时 on-accent 只有 3.34:1（< 4.5，不可行）。**裁决**：`--accent-hover: oklch(79.4% 0.104 356.6)`（fill 压深一档：L 85.7 → 79.4、C 0.086 → 0.104），on-accent **6.21:1**。
4. **新档位名的落层（D11 的补足）。** 票 02 的两条 bullet 对「八族的新档位名」给了相反落点。**裁决（产品所有者定夺）**：上游 `colors_and_type.css` = `--on-accent` + 五个既有族的档位名（`--accent-deep`/`-graphic`、`--online-fill`/`-soft`、`--working-fill`/`-soft`、`--error-fill`/`-soft`、`--offline-fill`/`-soft`/`-deep`）；扩展层 `app/globals.css` = `--selected*` / `--unread*` / `--warn*` 三个**产品角色**族的四档。理由：上游只承担「色板原语」（设计系统资料要能单独复现原语），selected / unread 是 app 特有的角色词汇。`--error` 仍不立 graphic 档（同值第二名字），`--online` / `--working` 的文字档沿用既有 `-text` 名。
5. **D11 的前提有误：`tokens.css` 也在色值面上。** 实际 `--shadow-pop` / `--shadow-card` / `--shadow-composer` 在**两份上游文件里都声明**（值今天逐字相同），而 `app/globals.css` 的 import 顺序是 `colors_and_type.css` → `tokens.css`，**生效的是 tokens.css 那一份**（colors_and_type.css 那三条是死的）。只改 colors_and_type.css 会让 `app/globals.test.mjs` 的 T-A 立刻红（`token --shadow-pop 的值被本仓改写了`）。**裁决（越界确认后授权）**：同步 `tokens.css` 那三条的 ink（`oklch(33% 0.045 300 / …)`，透明度档位与几何逐字不动）、**不去重**——去重是结构性改动，该有自己的票；重复声明本身登记为实施票 Answer 的遗留项。
6. **条状指示器（`.meter i` / `.meter.warn i` / 两个开关轨道）改走图形档**（实施期复算 + 双轴 review 的 Spec 轴 P1）。Testing Decisions §4 曾把 `.meter i` 的 `--accent` 记为「保持绿」——那条按「`background:` 即填充」的分类口径写的，但**没有实测「填充档落在槽/纸上」这一格**：填充档 `--accent`（L 85.7%）落在槽 `--panel-2`（L 93.1%）上只有 **1.30:1**（改前 3.86:1），两个开关轨道落在纸上 **1.19:1**（改前约 4.6:1）。D6 的 3:1 覆盖「图形边界」，而指示条的填充部分正是「可辨认状态」的图形信息 ⇒ 取图形档：`.meter i` → `--accent-graphic`（on `--panel-2` 实测 **3.03**）、`.meter.warn i` → `--warn-graphic`（**3.04**）、两处开关轨道 → `--accent-graphic`（on 纸 **3.51**）。§4 那两条对应断言按落点改写、判据（条状指示器可见）不变。**契约的这一格（fill ↔ 纸/槽）由此明确为：不作为对比度配对，fill 档只与 `--on-accent` 配对**。
