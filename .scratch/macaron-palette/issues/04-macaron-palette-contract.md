# 04: 马卡龙契约收口（contract）

**What to build:** 新契约成为唯一事实来源——没人再引用退役的旧档位，仓库里有一道**机械断言**守住对比度下限（以后谁把马卡龙亮档当文字色或状态点用，测试立刻红），四份设计文档与代码说的是同一件事。

**Blocked by:** 03（等它合入 main 后，从**新的 origin/main** 切本票 worktree）

**Status:** resolved

- [x] 清掉不再被引用的旧档位（`--accent-line`；以实际引用计数为准，若仍有引用则不能清并须在 Answer 说明）
- [x] **`--shadow-*` 重复声明去重（产品所有者已定：纳入本票）**：`--shadow-pop` / `--shadow-card` / `--shadow-composer` 只保留 `tokens.css` 那份生效声明，`colors_and_type.css` 的 3 条死声明删除、值逐字不变
- [x] **`worksplice-app.html` 同批迁（产品所有者已定）**：内联 `:root` 色板与直写字面量同步到马卡龙矩阵（形态 / 几何 / 脚本零改动）
- [x] **ui_kits 依赖就地登记（产品所有者已定）**：`ui_kits/app/app.css` + `SKILL.md §1` 写明「装进产品时额外消费产品层角色族」（不搬定义）
- [x] 新增 `app/globals.contrast.test.mjs`：把 spec 的两张表（族 × 档位矩阵、配对实测值）与 ΔL 可见性落成机械断言
- [x] **双向对照**：新断言在票 02 之前的色值上必须**红**（证明断言不是空转），在收口后的色值上绿
- [x] 同步 `worksplice-design-system/DESIGN.md`（色板 / 语义色 / 头像三段）、`SKILL.md`（§4 的 on-accent 措辞、§7 的 token 名条款）、`AGENTS.md` 的 CSS 变量段（顺手对齐 ADR-0014 遗留的旧 token 名漂移）、`docs/spec.md` §4 整节
- [x] **设计系统 live 制品清到 0（coordinator 裁定 a）**：`preview/*` 四张卡片 + `README.md` + `CONTEXT.md` 的 token 名词表 + `ui_kits` 的旧色值与 `--accent-line` 一并同步
- [x] `npm test` 全绿（本票新增了测试，属 G-impl「宽」档：影响面是全局色板契约）+ `npm run typecheck` / `npm run lint` 增量零新增
- [x] 双轴 code-review（Standards + Spec）+ Answer 小节
- [x] 额外交付物（产品所有者指定）：`.scratch/modelsconfig-oauth-hardening/issues/01-modelsconfig-oauth-hardening.md`（`needs-triage`，只登记不修）
- [x] 推分支 + `gh pr create`，PR 号回填 Answer

## Answer

**PR:** [#125](https://github.com/whutlichao/worksplice/pull/125)　**分支:** `whutlichao/macaron-contract`
**提交:** `cc96c37`（实施）、`4168148`（双轴 review 的 findings 处置）　**base:** `8a1edab`（票 02+03 同批合入的 #124）

### 0. 结论

新契约成为唯一事实来源：退役档位与死声明清干净、第三份内联色板与设计系统的 live 制品同步到零、ui_kits 的跨层依赖在册、对比度契约落成 12 条机械断言——**同一批断言在 base `9ce948e` 的旧色值上真实跑出 12/12 红（含 8 处实测值低于阈值的条目），在交付色值上 12/12 绿**。四份文档（DESIGN.md / SKILL.md / AGENTS.md / docs/spec.md §4）与代码逐段对齐。产品所有者的三条裁定（shadow 去重 / `worksplice-app.html` 同批迁 / ui_kits 就地登记）逐条执行；额外交付物是一张**只登记不修**的 needs-triage 安全票。

### 1. 交付物与改动面（`git diff --stat 8a1edab..HEAD`）

| 交付 | 位置 | 规模 |
| --- | --- | --- |
| 退役档位 + 死声明清理 | `worksplice-design-system/colors_and_type.css`（−4 条声明）、`tokens.css`（注释同步） | 10 + 4 行 |
| 第三份内联色板同批迁 | `worksplice-design-system/worksplice-app.html` | 167 行（全为色值 / 档位名） |
| 设计系统 live 制品清到 0 | `preview/colors-primary.html` · `colors-semantic.html` · `colors-avatars.html` · `typography-specimens.html` · `preview.css` · `README.md`；`CONTEXT.md`（一个字） | 95 行 |
| ui_kits 跨层依赖登记 | `ui_kits/app/app.css` 头注释 + `SKILL.md §1` | 16 + 12 行 |
| 对比度契约 | **新增** `app/globals.contrast.test.mjs` | 451 行 / 12 用例 |
| 退役名灭绝集补登 | `app/globals.test.mjs`（T-B 的 `RETIRED_TOKEN_NAMES`） | 1 行 |
| 文档同步 | `DESIGN.md`（147）· `SKILL.md`（60）· `AGENTS.md`（29）· `docs/spec.md` §4（84） | 320 行 |
| 额外交付物 | **新增** `.scratch/modelsconfig-oauth-hardening/issues/01-modelsconfig-oauth-hardening.md` | 79 行 |

`git status --porcelain` 为空、无格式化噪声（`git diff --check` 干净；没有对任何源码跑过 `--write` 类工具）。

### 2. 票面 Change 逐项：机械判据与实测

| # | 改动 | 判据（命令） | 结果 |
| --- | --- | --- | --- |
| 1 | 删 `--accent-line` 定义 | `grep -rn "var(--accent-line)" .`（排除 `.git`/`node_modules`） | **0**（唯一 2 处命中在 `.scratch/macaron-palette/issues/03-*.md` 的历史 Answer 里，属正本记录，按「不改写 01–03 历史结论」保留）；`--accent-line *:` 定义 **0** 行 |
| 2 | `--shadow-*` 去重 | `grep -cE "^\s*--shadow" colors_and_type.css` · `... tokens.css` | **0** vs **3**；`diff` 逐字核对：`tokens.css` 三条声明值与 `8a1edab` **逐字相同**（只换了上方注释）；T-A（同名值逐字一致）仍绿 |
| 3 | `worksplice-app.html` 迁移 | 旧阴影 ink `oklch(21% .02 255` · `oklch(99% .01 256` · `oklch(99% .01 27` · `--accent-line` 各 `grep -c` | **0 / 0 / 0 / 0**；diff 全是色值与档位名（`:root` 换成马卡龙矩阵 + 26 处规则体改档 + `STATUS_COLOR` 的点档 + 开关轨道的 inline 色），**形态 / 几何 / 脚本逻辑未动** |
| 4 | ui_kits 依赖登记 | 引用计数 | `--selected*` **16** · `--unread*` **2** · `--warn*` **4**（票面估「约 12 处」，实测 22 处）；kit 头注释与 `SKILL.md §1` 各写明「装进产品时额外消费产品层角色族」，并点名 `--online-text` 基线先例 |
| 5 | 新增对比度断言 | `node --test app/globals.contrast.test.mjs` | **12/12 绿**（详见 §3 / §4） |
| 6 | 文档同步 | 逐段点名见 §5 | 四份全覆盖 |
| 7 | 额外交付物 | `head -6 .scratch/modelsconfig-oauth-hardening/issues/01-*.md` | `Status: needs-triage` · `Blocked by: None`；三条发现的行号 `:1116` / `:1124` / `:1133` 在 HEAD 与 base **逐字相同**；`git diff 9ce948e..8a1edab -- components/ModelsConfig.tsx \| grep -c "window.open\|JSON.parse"` = **0**，该文件 33/33 行改动逐行核对全为色值 |

### 3. 红 → 绿（**双向对照，两侧真实执行**，同一支断言）

断言文件只有一个，阈值 / 配对表 / 算式在两次运行里**一字不变**；唯一变量是 token 来源目录（默认 = 本仓；对照运行 = base 检出的两份文件）。

**绿（交付态，默认运行）**

```console
$ node --test app/globals.contrast.test.mjs
ℹ tests 12   ℹ pass 12   ℹ fail 0

$ npm test
ℹ tests 1302  ℹ pass 1302  ℹ fail 0        # 基线 1290 + 本票新增 12
```

**红（base `9ce948e` 的色值）**

```console
$ mkdir -p /tmp/macaron-base-hist/{worksplice-design-system,app}
$ git show 9ce948e:worksplice-design-system/colors_and_type.css > /tmp/macaron-base-hist/worksplice-design-system/colors_and_type.css
$ git show 9ce948e:app/globals.css > /tmp/macaron-base-hist/app/globals.css
$ WORKSPLICE_CONTRAST_ROOT=/tmp/macaron-base-hist node --test app/globals.contrast.test.mjs
ℹ tests 12   ℹ pass 0   ℹ fail 12
```

12 条用例全红，其中 **8 处是「实测值低于阈值」**（不是「缺 token」）——这正是断言不是空转的证据：

| 阈值断言 | base 实测 | 交付实测 |
| --- | --- | --- |
| `--faint` 作文字 on `--panel-2` | **4.092 < 4.5** | 4.53 |
| `--faint` 作文字 on `--panel`（spec 未登记的一处） | **4.314 < 4.5** | 4.90 |
| accent 族文字档 on `--panel-2`（回落 base `--accent`） | **4.156 < 4.5** | 4.52 |
| accent 族文字档 on 自家淡底 | **4.086 < 4.5** | 4.94 |
| `--error` 作文字 on `--bg` | **4.208 < 4.5** | 5.27 |
| `--error` 作文字 on `--panel-2`（spec 未登记的一处） | **3.811 < 4.5** | 4.55 |
| `--working` 点 on `--surface` | **2.351 < 3.0** | 3.66 |
| `--offline` 点 on `--surface` | **2.000 < 3.0** | 3.64 |

另有：`--online` / `--working` / `--offline` 点 on `--bg` / `--panel-2` 2.07–2.77（阈值 3.0）、离线族的文字档 1.76–1.94（阈值 4.5）、`--accent-line` 仍存在、以及 7 族 `-soft` 缺失。base 的 `--accent-soft`（mix 11%）ΔL = 4.99 **本来就达标**——本 effort 提高配比（22% 等）是为了让 pastel 的 tint 在换成亮档后仍然看得见（spec 陷阱 2），不是把红变绿。

> **历史回落的口径（写在断言文件头，也是本文件的诚实边界）**：base 时代一族一值、没有档位名，断言里出现的新档位名按后缀剥离回落到该族当年的裸名（`--accent-deep` / `--online-fill` → `--accent` / `--online`），这样一部分断言会以**实测值**失败而不是退化成「缺 token」。两类在 base 本就没有对应物的条目只能以「缺 token」失败，这是如实的：① `--on-accent`（base 的填充档压的是白色**字面量**，不是 token）；② `--selected*` / `--unread*` / `--warn*` 三个产品角色族与各族的 `-soft`（accent 除外）——整轮 66 处不达标里有 28 处属于这一类。**回落在默认运行下不可达**：`resolveName()` 在 `!HISTORICAL` 时直接返回原名（默认运行不设该 env），阈值与配对表也不接受任何注入。

### 4. 校准证据（本文件的算式 ↔ spec / 票 02 的表）

断言用的算式 = WCAG 相对亮度 + Ottosson 的 OKLab 矩阵 + `color-mix` 的 alpha 合成（gamma sRGB 空间）。它与两家旧记录对得上：

- **合成 sRGB 逐字复现**：`--accent-soft` 22% over `--surface` = `#ffeef0`、`--unread-soft` 36% = `#fcf3d4`、`--warn-soft` 24% = `#ffefe3`、`--working-soft` 20% = `#fdf1df`、`--error-soft` 20% = `#fce6e1`（与 spec 勘误 2 修正后的值逐字相同）；`--selected` = `#f6f0f9`、`--online` = `#e5f5e8`、`--offline` = `#f4f1f1`（与 spec 的 `#f6f1f9` / `#e5f5e9` / `#f4f1f2` 差 1/255，取整抖动）。
- **配对实测值**：`fill + --on-accent` 8 族 + `--accent-hover` 与票 02 的 Answer 逐格一致（7.74 / 7.65 / 9.52 / 8.02 / 7.13 / 7.57 / 5.19 / 7.17 / 6.21，最大偏差 0.01）；四态点 on `--surface` 与票 02 **逐字相同**（3.67 / 3.66 / 5.48 / 3.64）；各族 `-deep` / `-graphic` on 两档纸张全部落在 spec 的区间内。
- **ΔL**：本文件算 3.05–5.23（最薄 `--selected` 3.05），spec 登记 3.08–5.28——**最大偏差 0.05**，方向一致、8/8 达标；这是两套实现之间唯一的系统性差异，故 ΔL 只断阈值（≥3.0），不断表值。
- **ΔL 容差口径**：spec 的 ±0.05 只写给「配对 `contrast ≥ min`」（Testing Decisions §1），勘误 2 又明写「阈值 3.0 不动（降阈值等于把标准改成迁就值）」——review 指出后，ΔL 断言已去掉容差，严格 ≥3.0（实测最薄 3.05 仍绿）；对比度配对保留 ±0.05。

### 5. 文档同步：逐段点名

**`worksplice-design-system/DESIGN.md`**——改：文件头 `Direction` 行、§1 首段（「near-white paper + single indigo-blue accent」）与 §1 的 restraint 第一条（「One accent hue」→ 一角色一色相 + 四档）、**§2「Surfaces & text」表整表**（含删 `--accent-line` 行、新增 `--on-accent` 行与档位段）、**§2「Semantic status」表整表**（新增 tier 列与 4 条 `-fill` / `-text` 行、任务状态映射改为 `--accent-graphic`、补徽标底规则）、**§2「Avatar palette」段**（五格色名 blue/teal/amber/coral/neutral → lavender/mint/peach/lemon/lotus grey + 对比度）、§6 的 11 条组件配方（`.btn-primary` 的 ink、`.icon-btn.is-on`、`.nav-row` 的条与 `#`、搜索环、tab 计数、pin-strip、`.msg-author.is-agent`、`.task-chip`、composer 环、`.drag-over` / `.filter-chip` / `.radio-card` / `.member-opt`、`.meter`、`.tt-log` 四色点、`.cmd-item`、`.toast.err`）、§7 的 `:focus-visible` 环、§9 的两条色板反模式。**未改（逐段核过，仍为真）**：§3 字体、§4 间距 / 圆角 / 阴影（几何与 `tokens.css` 为真源）、§5 布局与断点、§8 品牌语域、§9 其余条目、文末 Known gaps。

**`worksplice-design-system/SKILL.md`**——改：frontmatter `description`（原写 `modern-minimal direction, single indigo accent`）、§1（新增档位段与产品角色族的跨层说明）、§4 的 Primary button（`oklch(99% .01 256)` → `--on-accent`）等 8 条配方、§5（环改 `--accent-graphic` + 「fill 只与 `--on-accent` 配对」）、§7（token 名条款扩到档位后缀 + 「不得复活 `--accent-line`」+ 「不许无色相的色」）、§8 两条 checklist。**未改**：§2 选壳、§3 结构规则、§6 文案与语言（与配色无关）。

**`AGENTS.md`**——只改 `## CSS Variables` 一段：把 ADR-0014 之前的旧名清单（`--bg-panel --bg-hover --bg-selected --text --text-muted --text-dim --user-bg --tool-bg`，全部不在现行契约里）换成现行 token 面（纸 / 墨 / 行动 / 选中 / 未读 / 警示 / 状态 / 头像 / 尺度 / 阴影 + 档位规则 + 两道机械断言的指引），并写明「设计系统即真源、本仓只叠扩展层」。**同文件其余段落（含派活策略等治理段）一字未动**。

**`docs/spec.md` §4**——整节重写：§4 引言（方向 + 沿革三段）、§4.1 色板（角色族 × 档位矩阵 + 纸张 / 墨族表 + 对比度门槛）、§4.2 边框 / 圆角 / 阴影（改为 ADR-0014 的形态：小圆角 / 发丝 / 柔和阴影，撤销 0 圆角 / 2px ink / 硬阴影）、§4.3 字体（系统 sans + mono，撤销三字体）、§4.4 组件风格（四条 + 状态点 / 徽标分档）、§4.5 实现载体（`worksplice-design-system/` 即真源，撤销 Tailwind）。另在「已锁决策索引」的第 02 行加了一处**指向性**注记（原文保留 + 「已被 ADR-0014 / ADR-0015 先后改判，终局值见 §4」）——不改写那条历史决策本身。

**顺手清到 0 的 live 制品（coordinator 裁定 a）**：`preview/colors-primary.html`（`--accent-line` swatch → `--accent-graphic`、标题「单一品牌色」→「行动族 · 樱粉」、14 处旧色值文本）、`preview/colors-semantic.html`（`.lv.*` 块改档 + 状态点改 `--accent-graphic` + 4 处 token 表值 + 一处正文里的 token 名）、`preview/colors-avatars.html`（5 处头像值与色名）、`preview/typography-specimens.html`（1 处样本字符串）、`preview/preview.css`（`.pv-nav a.is-on` 的 `--accent-line` → `--accent-graphic`，删定义后它本会退化成 `currentColor`）、`README.md`（`Core principles` 第一条 + `Direction` 段，用 ADR-0015 已有语言改写）、`CONTEXT.md:188`（「视觉契约」词条里删掉 `--accent-line` 一个名字，其余逐字不动）。

### 6. 门禁（与本票 base 的基线对照）

| 门禁 | 基线（`8a1edab`，coordinator 实测） | 本票 | 判定 |
| --- | --- | --- | --- |
| `npm test` | 1290 pass / 0 fail | **1302 pass / 0 fail** | +12 = 本票新增用例，无回归 |
| `npm run typecheck` | exit 0 | **exit 0** | 零新增 |
| `npm run lint` | 0 error / 1 warning（`hooks/useI18n.tsx:61`） | **0 error / 1 warning（同一条）** | 零新增 |

### 7. 双轴 code-review（原文，不合并不重排）

两轴各由**独立评审子代理**跑（fresh context、只读、不许改文件）。固定点 = `origin/main`（`8a1edab`），面 = `git diff origin/main...HEAD`。两位评审都自陈了取证限制；其中 Spec 轴评审跑了全量 `npm test` 并遇到一次 `lib/agent-loop/driver.test.mjs:495` 的时序敏感超时（该文件不在本 diff 内、产品代码零改动；本票交付态在同一 worktree 里的全量运行均为 1302/1302、20–27 s，判为环境负载型 flake，非本票引入）。

#### Standards 轴

> **取证方式/限制**：只读。读了 `docs/engineering-standards.md`、`AGENTS.md`(HEAD)、邻近测试（`app/globals.test.mjs`、`components/primitives.test.mjs`）、`ui_kits/app/app.css`；跑了 `git show cc96c37`、`node --test app/globals.contrast.test.mjs`（12/12 绿）、`npx --no-install eslint app/globals.contrast.test.mjs`（干净）、以及 `WORKSPLICE_CONTRAST_ROOT=/private/tmp/base-macaron node --test app/globals.contrast.test.mjs`（12/12 红），并用同口径算式复算阈值余量。未跑全量 `npm test`。**注意：工作区脏**——HEAD 之外还有两处未提交改动：`app/globals.contrast.test.mjs:436`（去掉 `- EPS`）与 `worksplice-design-system/README.md:49`（Seven→Eight）；下列结论按 `git show cc96c37` 的提交内容判定。
>
> **正确（已有证据）**
> - `--accent-line` 定义删除且当前无消费点：`git grep` 仅剩注释/断言里的提及（`components/task-board.test.mjs:238`）；`--accent-line` 在 `worksplice-design-system/` 只剩 `SKILL.md:1` 的「不得复活」条款。
> - 三条 `--shadow-*` 确为死声明：`app/globals.css:8-9` 先 `@import colors_and_type.css` 再 `tokens.css`，被删值与 `tokens.css:30-33` 逐字相同。
> - 测试与仓库既有 seam 一致：`app/globals.contrast.test.mjs` 与 `app/globals.test.mjs` 同目录、同 node:test 写法、中文注释、`extractRootDecls` 同口径；被 `app/**/*.test.mjs` glob 自动纳入；lint 干净。
> - 阈值断言非空转：`each`/`collect` 把缺 token 也计为不达标（:271-296），历史运行确实红；header 举的例子 `--accent-deep on --panel-2 = 4.156 < 4.5` 实测复现。
> - 默认运行不可被 env 钩子削弱：`resolveName` 在 `!HISTORICAL` 时直接短路返回原名（:164），alias 路径默认不可达；钩子指向别处只会「红得更早」（矩阵是硬编码契约值），不能悄悄变绿。
> - `app/globals.contrast.test.mjs:445-456` 的退役断言、`docs/spec.md` §4、`AGENTS.md` 的 token 清单、`.scratch/modelsconfig-oauth-hardening/issues/01`（79 行、有 base/HEAD 逐字取证）与提交范围吻合，无越界改动；`worksplice-app.html` 只改色值与档位归位。
>
> **Finding: P2 — 历史钩子的「红」有 28/66 处是「缺 token」，与文件头承诺不符**
> 证据：`app/globals.contrast.test.mjs:29-32` 明写「目的是让同一条阈值断言以**实测值**失败……而不是以『token 缺失』失败」；实跑 `WORKSPLICE_CONTRAST_ROOT=/private/tmp/base-macaron` 得 66 处不达标，其中 28 处是 `缺少 token`：`填充 + --on-accent` 整条只有缺 token，ΔL 用例 8 族里 7 族也是如此，`--selected/--unread/--warn` 的 deep/graphic 全缺（alias 表只覆盖部分名字）。另外 :30 的示例 `--agent-fill` 全仓不存在（`git grep agent-fill` 只命中该注释）；:151-160 的 `HISTORICAL_ALIAS` 除自映射 `"--accent-soft": "--accent-soft"`（空转）外，7 条全部与 :165 的正则回落结果重复，真机制是正则，注释却指向表。
> 最小修法：把 header 改成「部分条目（`-soft` 族、`--on-accent`）在 base 本就无 token，其红属缺 token」；删空转自映射；示例换成 `--online-fill`；或把 alias 表删掉只留正则并说明。
>
> **Finding: P2 — 新退役的 `--accent-line` 没有进仓库既有的「旧名灭绝」清单**
> 证据：`app/globals.test.mjs:101-131` 的 `RETIRED_TOKEN_NAMES` 已收录上一轮退役的 `--shadow-sm/-pressed`、`--cream` 等，本票却没有加入 `--accent-line`；新测试只断言两个 token 文件的 `:root` 定义里没有它（:445-450），标题「已退役」比实际守卫宽——`var(--accent-line)` 若将来出现在 `components/**` 的 `.tsx/.css` 里不会被任何断言拦住（T-B 只扫 `app/components/hooks/lib` 的 `.tsx/.ts/.css`，加进去今天仍绿）。
> 最小修法：在 `RETIRED_TOKEN_NAMES` 里加 `"--accent-line"`（一词）。
>
> **Finding: P2 — ΔL 用例套用了 ±0.05 容差，标题的「ΔL ≥ 3.0」实际放行 ≥2.95**
> 证据：`app/globals.contrast.test.mjs:436`（HEAD）`if (deltaL < SOFT_DL_MIN - EPS)`，`:21` 称容差「spec 明写……只作用于比较」。但 spec 的 ±0.05 只写在 `contrast ≥ min` 的配对断言上（`.scratch/macaron-palette/spec.md:248`），ΔL 是另立一条且未附容差（:249）。实测最紧的族是 `--selected-soft` ΔL 3.053，余量 0.053——容差几乎把守卫放宽一倍，降到 2.96 仍绿。
> 最小修法：ΔL 处去掉 `- EPS`（工作区未提交改动正是这一处，请提交或明确改口径为 ≥2.95）。
>
> **Finding: P2 — README 族数写错：「Seven pastel role families」**
> 证据：`git show cc96c37:worksplice-design-system/README.md:49` 写 Seven，紧随的枚举是 accent/selected/unread/warn + 四态 = 8；DESIGN.md 与测试均按八族（`app/globals.contrast.test.mjs:306`「八族」）。工作区已有未提交的 Seven→Eight 修正。
> 最小修法：采纳工作区那一词改动。
>
> **Finding: P2 — preview 卡片里漏进 Markdown 粗体语法**
> 证据：`worksplice-design-system/preview/colors-primary.html:15`：`……不得引入 hex。方向是**马卡龙暖奶霜 + pastel 角色族**（ADR-0015）……`，在 `<p>` 里会原样渲染星号（README 指该卡片是 reviewer 首看页）。
> 最小修法：改成 `<b>` 或去掉 `**`。
>
> **Baseline smells（judgement calls）**
> - env 钩子是默认永不被 CI 覆盖的常驻分支，只能靠人记得重跑；换成 `.scratch` 脚本可减少测试面，但票里明确要求双向对照留证，现状可接受（关键结论：不削弱默认运行）。
> - 契约矩阵把 100+ 字面值复制进测试，属契约测试的本意（改值先改测试），但与 docs 三处同源数字有重复记账风险。
> - `--fg-soft`（spec 记 ΔL 2.95 over `--bg`）不在任何 ΔL 断言内——与 spec 的 8 族口径一致，但它的可见性下限无人守。
>
> **Merge verdict**: OK with notes — 无阻塞缺陷；建议把工作区那两处修正一并提交，并补 `--accent-line` 进 T-B 灭绝集。

#### Spec 轴

> **限制**：（1）全量 `npm test` 我跑出 **1301/1302**：唯一失败是 `lib/agent-loop/driver.test.mjs:495`（waitFor 超时，单条耗时 925 s / 全程 964 s，时序敏感）——本 diff 零产品代码、该文件不在 `...HEAD` 变更列表内，判为环境型；但我没有在 main 上复跑以排除。（2）票 04 的 `## Answer`、PR 回填、"红→绿"运行留痕按约定未写，不计缺陷。（3）淡底 ΔL 与票 02 登记值有系统性 ~0.03 偏差（我 3.05–5.23 vs 登记 3.08–5.28），未定位到口径来源，故只按我自己的数判。
>
> **Correct（抽样证实）**
> - **1. `--accent-line`**：定义已从 `worksplice-design-system/colors_and_type.css`（原 :38）删除；全仓 `var(--accent-line)` = **0**。剩余字符串命中分三类：**陈述/禁止**（`AGENTS.md:570`、`SKILL.md:121` "no reviving the retired…"）、**缺席断言**（`app/globals.contrast.test.mjs:445,447,449`）、**注释**（`components/task-board.test.mjs:238`）——均非活消费者；**授权保留**为 ADR（`0014:5`、`0015:15,23,35,37`）与 `.scratch/**`（`02:96`、`03:38,81`、`spec.md:257`）。`CONTEXT.md:188` 的 token 名清单已清。
> - **2. 阴影**：三条只在 `tokens.css:30-32`，值与 `origin/main` **逐字相同**（只换注释）；`colors_and_type.css` 0 条声明。T-A 重跑绿（2/2）。`worksplice-app.html:58` 另有一份自包含 `--shadow-pop`，属静态原型的内联 `:root`，非 token 层。
> - **3. `worksplice-app.html`**：四类旧值全 0。纯色性我做了机械判据——把颜色表达式归一化后 `-`/`+` 行**多重集合完全一致**，唯一差异是文件头注释与新增/删除的 token 声明 ⇒ 无形态/几何/脚本结构变化。未迁者见 P2。
> - **4. kit 登记**：`ui_kits/app/app.css:7-18` 与 `SKILL.md` §1 段都写 "registered, not moved"，并给出 `--online-text` 基线先例；引用数复核 = 16 / 2 / 4（+注释各 1）+ `--online-text` 1，与文字一致。
> - **5. 对比度断言**：12/12 绿；阈值 4.5 / 3.0 / 3.0 与 D6 逐字，无放宽。钩子证伪：`WORKSPLICE_CONTRAST_ROOT=/Users/apple/orca/worksplice`（8a1edab，仍声明 `--accent-line`）→ **11 绿 / 1 红**，且 env 未被任何 npm script 设置 ⇒ 该路径只会更红，不能静默削弱默认运行。我独立复算（WCAG + OKLab→sRGB）：fill+`--on-accent`(accent) **7.740**（断言 7.75）· `--accent-deep` on `--panel-2` **4.517**（4.51）· `--error` on `--bg` **5.266**（5.26）· `--faint` on `--panel-2` **4.531**（4.52）· `--warn-graphic` on `--panel-2` **3.039**（3.04）· `--offline` on `--surface` **3.641**（3.64）· `--unread`+fg **9.524**（9.52）——全部 ≤0.03 偏差。base `--accent` 作文字 on base `--panel-2` = **4.156**（票 02 记 4.16，spec 的 4.17 是实施前数）。ΔL 自算 8/8 ≥ 3.0，最薄 selected **3.05**。（备注：spec 配对表里以**区间**给出的行——各族 deep/graphic on 纸/淡底——只做 ≥阈值断言，未断言区间；这与 spec Testing Decisions §1 的 `(fg,bg,min)` 口径一致，故不列 finding。）
> - **6. 文档**：DESIGN.md（§1/§2 色板·语义·头像/§6/§7/§9）、SKILL.md（§1/§4/§5/§7/§8）、AGENTS.md CSS 变量段、`docs/spec.md` §4 整节（含顶部沿革 + §4.1–4.5）均已同步；抽查 20+ 处文档 oklch 与 token 文件逐字一致；旧方向表述只剩两份 ADR（应留）。
> - **7. 新登记票**：`needs-triage` ✓；`:1116/:1124/:1133` 在 HEAD 与 `9ce948e` 逐字相同 ✓；`grep -c` = 0 ✓、numstat `33 33` ✓，且我逐对核对 33 组 `-`/`+` 去掉颜色表达后完全相同（`oklch(99% 0.01 256)` → `var(--on-accent)` 等）⇒ 确为纯色改动。
>
> **Finding P2 — README 族数写错**：`worksplice-design-system/README.md:49` "**Seven** pastel role families" 却列 8 个（accent/selected/unread/warn + online/working/error/offline）；代码与测试口径是"八族"（`app/globals.contrast.test.mjs:76,306`，`FAMILIES` 实为 8 条）。修法：Seven → Eight。
>
> **Finding P2 — ΔL 断言带了 −0.05 容差**：`app/globals.contrast.test.mjs:436` 用 `deltaL < SOFT_DL_MIN - EPS`，而 spec 勘误 2 明确"2.95 不满足 ≥3.0…阈值 3.0 不动（降阈值等于把标准改成迁就值）"。ΔL 是纯浮点算式，不需要防取整抖动；当前最薄实测 3.05，离 2.95 只剩 0.10。最小修法：该行去掉 `- EPS`（对比度比较保留 ±0.05，与 spec 一致）。
>
> **Finding P2 — "旧色板 0 处"只对枚举四类成立，且两处残留未登记**：设计系统内仍有 6 个 hue 250/255/256 值、11 处。`.msg-text pre`/`.cmt`/`.kw`（`worksplice-app.html:227-229`、`ui_kits/app/app.css:195-197`、`preview/preview.css:84`）已在票 02 遗留项 2 登记（矩阵未覆盖深色面），**判为合理保留**；但 `.seg button.is-active` 的 `oklch(98% 0.005 250)` 与 `.toast` 的 `oklch(97% 0.006 250)`（`worksplice-app.html:270,452`、`ui_kits/app/app.css:235,410`、产品侧 `app/globals.css:1245`）**无任何登记**。最小修法：不改值（矩阵没有"深底上的墨"这一档，就地改值属发明），在票 04 的登记段与 `.msg-text pre` 并列点名。
>
> **Merge verdict**: OK with notes（无 P0/P1；票面验收项逐条成立，剩余为文档数字、ΔL 容差与登记缺口三条 P2，可随后续票或一次补登记处理）

### 8. findings 处置（逐条：已处理 / 有理由豁免）

**已处理（`4168148`）**

| 轴 | finding | 处置 |
| --- | --- | --- |
| Standards P2 | 历史钩子的「红」有 28/66 处是「缺 token」，与文件头承诺不符；`--agent-fill` 示例不存在；`HISTORICAL_ALIAS` 大部分空转/重复 | 改文件头：如实写明两类例外（`--on-accent`、三个产品角色族与各族 `-soft`）在 base 本就没有对应物、只能以「缺 token」失败；删掉空转的 alias 表，只留后缀回落；示例换成真实存在的 `--online-fill` |
| Standards P2 | 新退役的 `--accent-line` 没进 T-B 的 `RETIRED_TOKEN_NAMES` | 补进（1 行）。补后 T-B 仍绿（`.mjs` 不在它的扫描扩展名内，故 `components/task-board.test.mjs:238` 的注释不会误伤）；**越界说明**：`app/globals.test.mjs` 不在票面逐字列出的可编辑面里，但它是 `app/globals.css` 的同名测试文件（票面写「`app/globals.css` 一族」），且这条改动正是「退役」这件事的机械收口——登记在此，若判定越界，回退面是 1 行 |
| Standards P2 / Spec P2 | ΔL 断言套了 ±0.05 容差（实际放行 2.95） | 去掉 `- EPS`，严格 ≥3.0；实测最薄 3.05 仍绿、对照运行仍 12/12 红 |
| Standards P2 / Spec P2 | README「Seven pastel role families」 | → Eight（枚举实为 8 族） |
| Standards P2 | `preview/colors-primary.html:15` 的 `**…**` 会原样渲染星号 | 改 `<b>…</b>` |
| Spec P2 | `.seg button.is-active` / `.toast` 的冷色墨值（`oklch(98% 0.005 250)` / `oklch(97% 0.006 250)`）未登记 | **登记（不改值）**：见 §9「未迁的深色面字面量」。矩阵没有「深底上的墨」这一档，两个值分别是 `--fg` 填充上的浅墨与深填充上的浅墨，就地改值属发明 |

**有理由豁免**

- **Spec 轴自陈的 1301/1302**（`lib/agent-loop/driver.test.mjs:495` 时序超时）：该文件不在本 diff 内，产品代码零改动；同一 worktree 内我方三次全量运行均 1302/1302（20–27 s）。评审那次跑到 964 s，判为环境负载型 flake，非本票引入。
- **Standards「契约矩阵把 100+ 字面值复制进测试，与 docs 有重复记账风险」**：契约测试的本意就是「改值先改测试」；docs 与测试同源正是本票要的「文档与代码说同一件事」，重复是刻意的双份锁。
- **Standards「env 钩子永不被 CI 覆盖」**：双向对照是票面硬要求（Observable acceptance 1），且断言只在**取证**时切换输入文件；默认运行无此分支。已把这条写进文件头，供后续读者判断。
- **Spec「spec 配对表里以区间给出的行只断阈值、不断区间」**：判据（WCAG 下限）不放宽，区间是 spec 的观测记录；且 spec 自己的区间行对四态族并不整齐（`--offline-deep` on `--panel-2` 实测 4.58 略高于上界 4.57），断区间会把观测精度当判据。已在断言文件里把「表值 vs 阈值」的分工写明。

### 9. 偏离与登记（逐条，不静默）

1. **spec 的表格单元格修正 1 处**：`--muted on --surface`，spec 列 7.13 → **7.08**。原因：7.13 是从**取整后的 sRGB 近似列**（`#5a5467` on `#fffdf9`）算出来的（我复算得 7.131），而 oklch 口径是 7.079；spec 陷阱 5 明写「两者不一致时以 oklch 为准」，且票 02 的复测值正是 7.08。断言文件里写明了这一处的来龙去脉。
2. **票 02 Answer 的两行 `-text` 表值是改判前的数**（登记，不改写 02 的历史）：`--online-text` / `--working-text` on 两档纸张，02 记 **6.87 / 5.94** 与 **7.01 / 6.06**；实测（我 + Spec 轴评审独立复算 + spec 矩阵自称的 4.51）是 **5.23 / 4.52** 与 **5.24 / 4.53**。差异来自 02 把 `color-mix` 派生时代的旧档值写进了「交付实测」列。交付值本身达标。**同时登记契约最薄的两格**：这两族文字档 on `--panel-2` 的余量只有 0.02–0.03，未来调整 `-text` 或 `--panel-2` 必须连带复算。
3. **spec 未登记、但实测同样不达标的 base 项 2 处**：`--faint` 作文字 on `--panel`（base **4.314**）与 `--error` 作文字 on `--panel-2`（base **3.811**）——spec 只登记了 `--panel-2` 的 4.10 与 `--bg` 的 4.21。新断言的对覆盖更宽（`--faint` × 四档纸张、各族文字档 × 两档纸张），所以这两处在对照运行里也红。
4. **未迁的深色面字面量（登记，不改值）**：`.msg-text pre` / `.cmt` / `.kw`（票 02 遗留项 2 已登记）之外，另有 `.seg button.is-active` 的 `oklch(98% 0.005 250)` 与 `.toast` 的 `oklch(97% 0.006 250)`（`worksplice-app.html`、`ui_kits/app/app.css` 与产品侧 `app/globals.css:1245` 同形）。矩阵没有「深底上的墨」这一档；就地改值属发明，登记给后续票。
5. **`--fg-soft` 不在 ΔL 断言内**：spec 自己记它 over `--bg` 的 ΔL = 2.95（低于本 effort 的 3.0 可见性判据），但 spec 的族 × 档位矩阵把 ΔL 判据写成「8 族 `-soft`」，`--fg-soft` 是墨族配方、不在八族内。按 spec 原样实现，并把这一格登记为**继承缺口**（与 `--border-strong` 未达 3:1 同类）。
6. **`worksplice-app.html` 里的第三份 `--shadow-pop`**：它是自包含原型的内联 `:root`（非 token 层），本次只换了 ink、没有并进 `tokens.css`；原型的 `--shadow-card` / `--shadow-composer` 仍是行内字面量（票面明写 diff 只能是色值，故保持字面量形态、只换 ink）。
7. **`app/globals.test.mjs` 的 1 行改动属越界确认**（见 §8 表格），登记为越界面。
8. **`worksplice-design-system/context/provenance.md` 未改（登记）**：它是「这份资料是怎么从源 HTML 抽出来的」的**取证记录**，其中「`:root` 块已声明 modern-minimal 方向、原样抄进 `colors_and_type.css`」这句描述的是**抽取那一刻**的事实，方向在抽取之后的两次改判（ADR-0014 → ADR-0015）由 ADR 承载。本票的文档面是四份（DESIGN.md / SKILL.md / AGENTS.md / docs/spec.md §4）+ coordinator 裁定的 live 制品，provenance 属历史记录类；若后续认为该段需要一条指向 ADR-0015 的时效注记，回退面是 `context/provenance.md:20-22` 的两行。
9. **越界面外的两处不改**：`components/task-board.test.mjs:238` 的迁移注释（`.mjs`、且 `components/**` 不在本票可编辑面）与 `.scratch/design-system-refactor/**` 的历史票据——它们是「退役」这件事的记录，不是引用。

### 10.「全仓 0」的精确口径

票面验收写「`--accent-line` 全仓引用 0（定义已删）」。按**代码与制品面**（`*.ts` / `*.tsx` / `*.css` / `*.html` / `*.mjs`，排除 `node_modules` / `.git`）实测：

```console
$ grep -rn --include="*.ts" --include="*.tsx" --include="*.css" --include="*.html" --include="*.mjs" -- "--accent-line" . | wc -l
5
$ grep -rn ... "var(--accent-line)" . | wc -l
0
$ grep -rn --include="*.css" --include="*.html" -- "--accent-line *:" . | wc -l
0
```

- **定义 0 · 消费引用 `var(--accent-line)` 0** —— 退役的两个硬判据都成立。
- 代码与制品面残留的 5 处**全部是「否定它」的守卫**：`app/globals.test.mjs:131`（T-B 灭绝集）、`app/globals.contrast.test.mjs:440/442/444`（缺席断言 + 用例名）、`components/task-board.test.mjs:238`（票 03 的迁移注释——`.mjs` 且 `components/**` 不在本票可编辑面，不改）。
- **设计系统 live 制品**（`worksplice-app.html`、`preview/**`、`ui_kits`、`README.md`、`SKILL.md` 的配方段）**0 处**——本次全部清掉（coordinator 裁定 a）；`CONTEXT.md` 的 token 名词表也清了。
- 文档面（`*.md`）的命中分两类，都不是引用：**历史记录**（两份 ADR 的 supersede 段落、`spec.md`、`01–03` 票据、`design-system-refactor` 旧票——按「不改写历史结论 / ADR 只加不删」保留）与**本票自己的记录**（这份 Answer 与 checklist 在讨论它）。

即：**定义 0、消费引用 0、live 制品 0**；剩余字符串全部是「否定它的守卫」与「记录它退役的历史」。旧阴影 ink / `oklch(99% .01 256)` / `--accent-line` 三类在 `worksplice-app.html` 内均为 0。

### 11. 残留与非目标

- **`.scratch/modelsconfig-oauth-hardening/issues/01`**：`needs-triage`，**不流转**（按票面「不要把它流转成 resolved」）；本票不碰 `components/ModelsConfig.tsx` 任何代码。
- **未迁的深色面字面量**（§9.4）与 **`--fg-soft` 的 ΔL 缺口**（§9.5）：登记，留给后续票。
- **非目标（未动）**：形态 / 几何 / 间距 / 字号 / 动效 / 断点；行为语义、schema、HTTP 面、`~/.worksplice`；`docs/spec.md` §4 之外的章节（除「已锁决策索引」那一行指向性注记）；`docs/agents/**` 与全局治理段。
