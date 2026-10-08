# 01 — 马卡龙配色：暖奶霜底 + pastel 角色族（设计票）

**Type:** grilling
**What to build:** 把产品所有者的诉求「当前 UI 蓝色为基调有点过于深沉，改成马卡龙配色」从一句方向声明变成**可机械验收的配色契约**：七节 spec 落 `.scratch/macaron-palette/spec.md`（色值 + 角色分工 + 档位规则 + 对比度实测 + 调用点迁移账 + 拆票建议）、色板段再改判落的 ADR-0015、术语（档位 / 角色族）inline 落 `CONTEXT.md`。**零源码改动**——色值替换、调用点迁移与文档同步属本 effort 的票 `02…04`。
**Blocked by:** 无

**Status:** resolved

- [x] `.scratch/macaron-palette/spec.md` 存在，严格七节（Problem Statement / Solution / User Stories / Implementation Decisions / Testing Decisions / Out of Scope / Further Notes）、无自造章节、含零行为改动声明与决策表
- [x] 决策表每条标来源（产品所有者答复 / spec 产物 / coordinator 代答）；open 决策全部有答复、全文无「待定」
- [x] 色板表完整：每个 token 给 `名 + oklch + sRGB 近似 + 角色 + 对比度实测比值`；每个「填充 + 其上文字」配对达 AA，计算方式可复核（WCAG 相对亮度公式，写在 Testing Decisions）
- [x] `docs/adr/0015-macaron-palette-warm-cream-pastel.md` 存在、`Status: accepted`、`Supersedes` 精确指向 ADR-0014 的**色板段**并明写保留**形态段**、含证据层级论证与被否决备选（含代价）
- [x] `CONTEXT.md` 新增「档位 (Tier)」与「角色族 (Role Family)」两词条（inline 落盘），并在「视觉契约」词条内指认 ADR-0015 的新维度
- [x] Further Notes 有拆票建议：票数（3）+ 每票交付物 + 票间依赖，无「一刀/两刀」类自造词
- [x] 零源码改动：`worksplice-design-system/**`、`app/**`、`components/**`、`hooks/**`、`lib/**`、`package.json` 一字不动（`git diff --name-only` 仅 4 个文档路径）
- [x] `git status --porcelain` 为空（`.pi-lens.json` 进 `.git/info/exclude`，未出现在 untracked 列表）
- [x] 分支推送 + PR（`#121`，正文含决策留痕与零源码改动的事实判据）
- [x] grilling 轮次记录落本 Answer（每轮问题、每条最终答案、谁给的答复）

## Answer

### 交付物

| 交付 | 位置 |
| --- | --- |
| 配色契约（七节 spec + 决策表 + 色板表 + 对比度表 + 迁移账 + 拆票建议） | `.scratch/macaron-palette/spec.md` |
| 色板段再改判 ADR | `docs/adr/0015-macaron-palette-warm-cream-pastel.md` |
| 术语（档位 / 角色族） | `CONTEXT.md` |
| 本票（状态流转与决策留痕） | `.scratch/macaron-palette/issues/01-macaron-palette-contract.md` |

**PR**：https://github.com/whutlichao/worksplice/pull/121（分支 `whutlichao/macaron-palette`，base 已 rebase 到 `origin/main` = `859f14c`）。rebase 后在最新 base 上复核过关键计数：216 = `app/globals.css` 78 + `components/**` 138 不变；`#120`（composer 内层焦点环）只新增一条 `.composer-input:focus-visible { box-shadow: none; }`，未改动任何 spec 依赖的判据。

### grilling 轮次记录

**访谈对象**：人类产品所有者。**通道**：`orca orchestration ask`（禁 `AskUserQuestion`）。**轮次结构**：第 1 轮 = 2 条 frontier（token 映射形态 A1 / 角色分工表 + 对比度补齐策略 A2）。两条都当场获答复，访谈一轮收敛——没有需要下一轮的前沿（其余决策是 facts 或 spec 产物）。

> 问题 ID 未留：两次 `ask` 的答复由 CLI 同步返回给本 worker，返回体只含答复正文；`check`/`inbox` 里已无残留（答复被消费）。故下表记 Q/A 与答复人，不编造 message id。

| Q | 问题 | 最终答案 | 谁给的答复 |
| --- | --- | --- | --- |
| **Q-A1** | 马卡龙多色如何映射到现有单色 token 名（本票最大 seam）：(a) 同名保留 + 分档 + 新增角色族 vs (b) 按角色重命名（`--action*`/`--selected*`…）？ | **(a)**：`--accent*` 四个名字保留（`--accent` = 马卡龙填充档），新增 `--accent-deep`（文字档 L≈52%）/ `--accent-graphic`（环·点档 L≈62%）与 `--selected*` / `--unread*` / `--warn*` 三个角色族；否决 (b)。**附带裁示三条**：① 口径用实测 216 = `app/globals.css` 78 + `components/**` 138（不用粗 grep 的 230）；② 拆票写成 expand → migrate → contract 三段窄切片，每段可单独落绿；③「`--accent` 一名多义」要在 spec 的 Implementation Decisions 里显式承认并写缓解 | **产品所有者答复（Q-A1 = a，非 coordinator 代答）** |
| **Q-A2** | 角色分工表 + 只为对比度达标是否允许「同族深档」（实质偏离：深档不再是马卡龙、状态点若走亮档低至 1.6–2.4:1）？ | **甲（三档）** + **角色分工表按荐答**：行动=樱粉 · 选中/导航=薰衣草 · 未读=柠檬 · 警示=蜜桃 · 在线=薄荷 · 进行中=杏 · 出错=珊瑚红 · 离线=藕灰 · 头像=五格确定性取色。**并判「状态点保持今天的饱和度、不马卡龙化」**——这是对 D0-4「语义色与头像色板一起马卡龙化」的**部分改判**，须如实记为改判（不是一致）；乙方案（一档到底的纯马卡龙）的论证与代价保留在 ADR 的「被否决的备选」里 | **产品所有者答复（Q-A2 = 甲 + 荐答分工表；其中语义色一条为改判）** |

**facts 自查（未问人，按 grilling 纪律「facts 是你的活」）**：

| # | 事实 | 手段 |
| --- | --- | --- |
| 1 | 216 处 `var(--accent*)` 消费点 = `app/globals.css` 78 + `components/**` 138（`--accent` 150 · `-soft` 56 · `-line` 7 · `-hover` 3） | 逐文件计数脚本（口径写在 spec 的「消费点账」） |
| 2 | 按角色的迁移面 ≈100 处（文字 68 · 边框与焦点环 27 · 图形 5）、零改动 ≈79 处、未能机械判定 ≈36 处 | 同一脚本按「`var()` 之前最近的属性名」判定；未能判定者如实单列（行内多属性 + `color-mix`） |
| 3 | on-accent 字面量 20 处 = `app/globals.css` 5（含 1 处 `.01` 拼写变体）· `components/**` 15（ModelsConfig 9 / SkillsConfig 2 / PluginsConfig 1 / DirectoryPicker 1 / ChatInput 1 / ChannelView 1） | `grep -rn 'oklch(99% 0.01 256)'` |
| 4 | 马卡龙亮档不能承担文字 / 焦点环 / 状态点：柠檬作文字 1.23:1、薰衣草作环 1.60:1；候选 `--error #f28b82` 作文字 2.26:1、作点在卡面上 2.35:1 | 自建 WCAG 相对亮度脚本（sRGB<->OKLab 标准矩阵） |
| 5 | 现状已有 4 处低于 AA：`--accent` 文字 on `--panel-2` 4.17、`--error` 文字 4.21、`--faint` on `--panel-2` 4.10、`--working`/`--offline` 点 2.35/2.00 | 同上（对照表写在 spec） |
| 6 | 三档全达标：fill + 深墨 5.19–9.52、deep on 底纸 5.22–5.30、graphic on 底纸 3.48–3.52、deep on 自家淡底 4.65–5.03、淡底 ΔL 3.02–5.32 | 同上 |
| 7 | 既有 4 条不达标项中 3 条被本方案修到达标（accent 文字 / error 文字 / faint on panel-2），点档两条（working 2.35 / offline 2.00）也修到 ≥3 | 同上 |
| 8 | T-A 断言「上游 token 值逐字相同」⇒ 色值必须改在 `colors_and_type.css`，不能在本仓覆盖同名 | 读 `app/globals.test.mjs:50–105` |
| 9 | 换色会踩到的既有断言逐个点名（26 行，含文件与行号），见 spec 的 Testing Decisions §4 | 对 `*.test.mjs` 全量 grep `--accent` / 四态 / `--av-` / `oklch(` |
| 10 | `--border-strong` 今天 1.58:1、本方案 1.97:1，都不达 3:1（继承缺口，Out of Scope 登记） | 同上 |

### 证据

- **源码改动面为空**：`git diff --name-only` 仅四个文档路径——`.scratch/macaron-palette/spec.md`、`.scratch/macaron-palette/issues/01-macaron-palette-contract.md`、`docs/adr/0015-macaron-palette-warm-cream-pastel.md`、`CONTEXT.md`。`git diff --name-only | grep -v '^docs/\|^CONTEXT.md\|^\.scratch/'` 为空 ⇒ **无被测对象**，故本票不跑测试。
- **本票语境下的两项豁免**（按票面要求写明理由）：① 「证据目录缺测试」类 finding 豁免——本票 diff 全是文档，没有可测的行为面；② 双轴 code-review 豁免——它审的是源码 diff，本票没有源码 diff。两条都不是「省事」，是判据不成立。
- `git status --porcelain` 为空；`.pi-lens.json`（内容 `{"format":{"enabled":false}}`）已写入 worktree 根并加进 `.git/info/exclude`（worktree 的 gitdir 指向 `orca/worksplice/.git/worktrees/macaron-palette`，exclude 落在公共 `info/exclude`），不出现在 untracked 列表。

### 偏离与登记

1. **状态点部分改判的如实记录**：D0-4 原答复是「语义色与头像色板一起马卡龙化」，Q-A2 的裁决把**状态点**排除在马卡龙亮档之外（改走图形档，保持今天的饱和度水平）。spec 的决策表把它标为 **D4 · 改判（否决前一条答复的一半）**，ADR 的「被否决的备选」保留乙方案（一档到底的纯马卡龙）的完整论证与代价。**没有**把它写成「一致」。
2. **迁移面口径修正（A1 提问里的 78 → spec 里的 100）**：A1 提问时写的「约 78 处文字/环调用点」是 `app/globals.css` 的**文件口径**；按角色判定的真实迁移面是 **≈100 处**。spec 的「消费点账」同时给出两个口径并标注差异来源；A1 的成本结论（(a) 约 100 处迁移 vs (b) 216 处全量改名 + 约 60 条断言重写）不受影响。
3. **`--accent` 一名多义的显式承认**（A1 附带裁示 ③）：spec 的 D7 表 + 三条缓解（矩阵为唯一权威对照 / 族块头档位注释 / 只有 accent 一名多义）写在 Implementation Decisions §3 附近；文档里没有把它写成「名字已表达档位」。
4. **`AGENTS.md` 第 546 行漂移登记**（票面要求只登记不修）：该段「CSS Variables」列的是 ADR-0014 之前的旧 token 名（`--bg-panel --bg-hover --bg-selected --text --text-muted --text-dim --user-bg --tool-bg`）。spec 的 Out of Scope 与 Further Notes 都登记了它，留给实施票的 contract 段顺手对齐。
5. **拆票形状确认 + 一条挑战**（对 coordinator 预对齐的 expand → migrate → contract）：形状采纳；挑战一条——「每段单独落绿」在这个拆分里**不等于**「每段单独可用」：`02` 落地后、`03` 落地前，焦点环仍指 `--accent` 而它已是亮档（1.4–1.6:1），存在**可访问性回归窗口**，虽然测试全绿。处置建议：`02` 与 `03` 同批合流（写在 spec 的 Further Notes「中间态窗口」）。
6. **未获答复的决策：无**。两条 frontier 均当场获答复，全文无「待定」。
