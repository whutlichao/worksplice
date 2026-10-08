# 视觉方向再改判：modern-minimal（单一 indigo）→ 马卡龙暖奶霜 + pastel 角色族

**背景**：本仓视觉方向由 `docs/adr/0014-visual-direction-modern-minimal.md`（Status: accepted）裁决为 `modern-minimal`（Linear / Vercel 语域）：近白纸面 `--bg oklch(99% 0.002 240)`、单一 indigo 强调色 `--accent oklch(56% 0.17 256)`、单一品牌色相。该裁决已全量落地——实施票 02–10 全部合入 main（`5b98e5c` … `10d20aa`），`worksplice-design-system/` 30 个文件入库并经 `app/globals.css` 的顶层 `@import` 成为**运行时真源**。ADR-0014 同时写死了与本轮诉求直接冲突的一句：「**马卡龙 × brutalist 的 token 体系整体退役——不是叠加、不是并存**」，以及「单一 indigo 强调色」。

**决策**：改用**马卡龙配色**——暖奶霜底（`--bg oklch(98% 0.011 85)`）+ 深梅墨文字（`--fg oklch(33% 0.045 300)`）+ **多色 pastel 角色族**（行动=樱粉 / 选中=薰衣草 / 未读=柠檬 / 警示=蜜桃 / 在线=薄荷 / 进行中=杏 / 出错=珊瑚红 / 离线=藕灰，头像五格确定性取色）。每个色相族按**档位**组织：填充档（马卡龙亮档，只做填充，深墨文字压其上）、淡底档、文字档（同色相压深，≥4.5:1）、图形档（≥3:1，供焦点环与状态点）。完整色值、角色分工、对比度实测与调用点迁移账见 `.scratch/macaron-palette/spec.md`（本 ADR 的配套正本）。

**本轮只想改配色，形态一字不动**：小圆角（6/8/12/16）、发丝边框、柔和阴影、首字头像、三栏骨架、断点（1080/900/640）、字体（系统 sans + 系统 mono）、以及 `--bg / --surface / --panel / --panel-2 / --fg / --muted / --faint / --border / --border-strong` 这批 token 名**逐字保留**——ADR-0014 的**形态段整体继续有效**。**不恢复** 0 圆角 / 2px ink 边框 / 硬偏移阴影 / 像素头像 / Space Grotesk 三字体（那一套是更早的 `docs/spec.md` §4 方向，它已被 ADR-0014 推翻且不因本次改判复活）。

**为什么再改判（不是复述 ADR-0014 的论证）**：ADR-0014 推翻马卡龙的依据是**证据层级**——马卡龙方向是「设计者自拟的方向声明」，而 modern-minimal 是「产品所有者提供的、带来源与保真度说明的可执行契约」，冲突时以契约资料为准。**这个层级关系现在反了过来**：提出马卡龙要求的人**就是产品所有者本人**，他既是方向的来源，也是那份契约的授权者；他的一句话本身就是最高层级的证据，不需要再由某份资料替他作证。契约的可执行性（oklch token 文件 + `@import` 进产品）与来源的权威性（产品所有者）本轮变成同一个人，因此新方向同样以「可执行契约 + 带来源的方向声明」的形态成立——只是这次的来源是所有者本人，载体是我们自己维护的 `colors_and_type.css`。

**为什么不是「改几个色值」（影响面是面，不是行数）**：

- **视觉层**：`worksplice-design-system/colors_and_type.css` 的色板段（纸张 / 文字 / accent / 语义四态 / 头像五格 / 阴影 ink）整体换值；`app/globals.css` 的扩展层新增 `--on-accent` 与三个角色族、重配比各族淡底；`app/globals.css` 的**调用点面**——216 处 `var(--accent*)` 消费点（`app/globals.css` 78 · `components/**` 138）中约 100 处（文字 68 · 边框与焦点环 27 · 图形 5）改指新的文字档 / 图形档；`components/**` 其余状态色、头像、阴影字面量按同一套档位归位。
- **可访问性面**：本仓首次引入**可机械判定的对比度契约**（文字 4.5:1 / 图形 3:1），并把今天的 4 处不达标（`--accent` 作文字 on `--panel-2` 4.17、`--error` 作文字 4.21、`--faint` on `--panel-2` 4.10、`--working` / `--offline` 点 2.35 / 2.00）一并修到达标。这是现代化方向留下的债，不是马卡龙带来的。
- **结构面**：色板从「一族一值」变成「一族多档」，这是新的**契约维度**（CONTEXT.md 的「档位」词条）；`--accent-line` 因此退役（被图形档取代）。
- **文档面**：`worksplice-design-system/DESIGN.md`（色板 / 语义 / 头像三段）、`SKILL.md`（§4 的 on-accent 措辞、§7 的 token 名条款）、`AGENTS.md` 的 CSS 变量段（它至今仍是**更早**的旧 token 名，属 ADR-0014 遗留漂移）、`docs/spec.md` §4——全部失效，随实施票的 contract 段一次到位。
- **不动的面**：行为语义（消息不可变 / freshness-hold / 任务状态机 / inbox 游标 / 权限面 / agent-loop）、数据面（schema / `~/.worksplice` / HTTP 面）、形态面（圆角 / 边框宽度 / 阴影几何 / 间距 / 字号 / 动效 / 断点）、token 名契约面。**零行为改动**。

**迁移策略**：

- 实施拆三票（`.scratch/macaron-palette/` 的 `02` expand → `03` migrate → `04` contract），每票单独落绿；逐票的交付面与依赖见 spec 的 Further Notes。**知情项**：`02` 落地后、`03` 落地前存在一个焦点环对比度窗口（环仍指 `--accent`，而它已是亮档），建议 `02` 与 `03` 同批合流。
- 色值改在 `colors_and_type.css`（上游即运行时真源），**不在 `app/globals.css` 覆盖同名 token**——这是既有断言 `app/globals.test.mjs` T-A「同名 token 值逐字相同」要求的唯一形态；本仓扩展层只加新档位名。
- 旧 token 名**不留长期别名层**（沿用 ADR-0014 的同一条纪律）：`--accent-line` 退役，其余名字保留是因为它们仍是主用途档的名字，不是为了兼容。
- **回滚可达**：改动集中在 `worksplice-design-system/colors_and_type.css` + `app/globals.css` + `components/**` 的色值表达，`git revert` 即回到 modern-minimal；无迁移步骤、无数据形态变化。

**被否决的备选**（含代价，都是真实取舍的另一侧）：

- **（否决）整回到 brutalist**（0 圆角 / 2px ink / 硬阴影 / 像素头像 / Space Grotesk）：产品所有者的诉求原文是「蓝色过于深沉，改成马卡龙配色」——**只针对配色**。整回到 brutalist 会把「换色」膨胀成「换形态 + 换字体 + 换头像」，并推翻 ADR-0014 里产品所有者已经验收过的形态（小圆角 / 发丝 / 柔和阴影 / 首字 tile），代价是全部实施票 02–10 的成果归零且用户没有要求过它。
- **（否决）只把强调色调浅**（保留单一色相，把 `--accent` 换成浅色/浅紫）：最便宜，一晚可落地；但它不满足「多色 pastel 分区」这条所有者答复，且浅色强调色一落地就撞上对比度墙（浅色作文字 1.2–1.6:1）——要么放弃可读性，要么又回到需要档位结构，等于用最差的方式做同一件事。
- **（否决）一档到底的纯马卡龙**（pastel 只做填充与淡底；文字、焦点环、状态点一律退回深墨/中性；状态点直接用马卡龙亮档）：这是 Q-A2 的「乙」方案，收益是**观感纯粹**——色板只有一档，文档与实现都更简单，没有「深档不是马卡龙」的别扭。否决理由是一条实测事实：马卡龙亮档作状态点只有 1.6–2.4:1（现状 `--error` 点 4.32:1），而四态状态点是本产品的核心 affordance（DESIGN.md 的签名特征「status made visible」）——那不是合规之争，是「状态点看不见」的产品问题；同时链接 / 提及 / agent 身份 / 未读会失去色相区分，User Story 2（从颜色上区分行动与选中）在文字面退化。代价账保留在此供日后重估。
- **（否决）按角色重命名 token（`--action*` / `--selected*` … 全量替换 `--accent*`）**：这是 Q-A1 的「b」方案，收益是名字与角色一一对应，消除 `--accent` 一名多义。否决理由：真正的语义分裂（填充档 vs 文字档）两个方案都要付，b 额外付的是 138 处纯填充改名 + 约 60 条字符串级断言重写，而它正好命中 ADR-0014 引 DESIGN.md 反模式第一条所禁的动作（改名 = 重新扯断全部消费点）——这次虽是有意的，但换不到视觉收益，成本是 a 的 2 倍以上。
- **（否决）暗色主题 / 主题开关**：`hooks/useTheme.ts` 恒亮色，DESIGN.md 明写「无深色主题、单档亮色」；加开关等于把两套档位表塞进每个组件的分支。

**Status**: accepted
**Supersedes**: `docs/adr/0014-visual-direction-modern-minimal.md` 的**色板段**——即它的「决策」句里 `--bg / --surface / --panel / --panel-2 / --fg / --muted / --faint / --border / --border-strong / --accent / --accent-hover / --accent-soft / --accent-line / --online / --working / --error / --offline / --av-0…--av-4` 这批 token 的**取值**，以及「单一 indigo 强调色」「single brand hue」「马卡龙 × brutalist 的 token 体系整体退役」三处表述；同段被推翻的还有 `docs/spec.md` §4 里由 ADR-0014 承接的色板描述（该节在 ADR-0014 下已整节失效，本 ADR 只承接其色板面的终局值）。

**ADR-0014 中继续有效、本 ADR 不改的面**（逐条明写，避免下一个人误读 supersede 的范围）：小圆角（6/8/12/16）、发丝边框、柔和阴影的**几何**、首字头像（`Avatar` 与 7px 圆角方 tile）、三栏骨架与断点（1080 / 900 / 640）、`--sp-* / --r-* / --fs-* / --lh-* / --fw-* / --z-* / --dur* / --ease` 全部尺度 token、**token 名契约面**（除 `--accent-line` 退役外名字逐字保留）、上游资料作运行时真源（D2）、不留旧名别名层（D3）、Tailwind 已删除（D4）、`ws-*` 只作骨架钩子（D7）、以及**零行为改动**声明本身。
