# 02: 马卡龙色板契约值（expand）

**What to build:** 打开应用，纸面、文字、强调色、四态状态点、头像与阴影的取值全部换成马卡龙方向；每个色相族同时具备**填充档**（马卡龙亮档，只做填充，深墨文字压其上）、**淡底档**、**文字档**（同色相压深，≥4.5:1）与**图形档**（≥3:1，供焦点环与状态点）。本票**只换契约值、只新增档位名**，一行调用点都不改——旧名照旧可用，所以应用正常渲染，只是颜色变了。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `worksplice-design-system/colors_and_type.css` 的色值全量替换为 `.scratch/macaron-palette/spec.md` 的「角色族 × 档位」矩阵（纸张族 / 墨族 / 八族的 fill·deep·graphic / `--av-*` / 阴影与 scrim ink）
- [x] `app/globals.css` 扩展层只**新增** `--on-accent` 与 `--selected*` / `--unread*` / `--warn*` 三个角色族；不删任何旧名、不改任何调用点
      —— 实施期裁决把 `--on-accent` 挪到**上游**（见 spec 勘误 4），三个角色族留扩展层
- [x] 同名 token 在上游与扩展层的值逐字一致（既有 `app/globals.test.mjs` 的 T-A 断言仍绿）
- [x] 值改在上游 `colors_and_type.css`，**不在** `app/globals.css` 覆盖同名 token（T-A 断言要求的唯一形态）
- [x] 本票与票 03 **必须同批交付**（同一 PR、各一个 commit）——否则会出现焦点环对比度窗口，见 spec 的「中间态窗口」知情项
- [x] 推分支 + `gh pr create`（与票 03 同 PR），PR 号回填 Answer

## Answer

### 交付物

| 交付 | 位置 |
| --- | --- |
| 契约值全量替换（纸族 / 墨族 / `--accent` 族 / 四态语义色 / `--av-*` / 阴影 ink） | `worksplice-design-system/colors_and_type.css` |
| 阴影 ink 的**生效处**同步（授权越界确认，见下「偏离 6」） | `worksplice-design-system/tokens.css` |
| 扩展层新增三个产品角色族（各 fill / soft / deep / graphic） | `app/globals.css` |
| spec 勘误（实施期复算发现，`### 勘误（实施期发现）`） | `.scratch/macaron-palette/spec.md` |
| 本票（Status 流转 + 证据） | `.scratch/macaron-palette/issues/02-macaron-palette-tokens.md` |

**commit**：`f529de4 feat(design-system): 马卡龙色板契约值（票 02，expand）`（与票 03 同 PR：<https://github.com/whutlichao/worksplice/pull/124>，base = `cd89136`）

### 红 → 绿（必红证据真实执行：同一支 WCAG 相对亮度 + OKLab 脚本，在 base 色值上测一次、在交付色值上测一次）

脚本口径 = spec Testing Decisions §1（sRGB 每通道 `c ≤ 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4`，`L = 0.2126R + 0.7152G + 0.0722B`，`contrast = (L₁+0.05)/(L₂+0.05)`；oklch → sRGB 用 Björn Ottosson 的 OKLab 标准矩阵）。**校准证据**：同一脚本算出 base 的 `--accent-soft` mix 11% 在 `--surface` 上的 ΔL = **4.94**，与 spec 正文的 4.94 逐字相同；soft 合成后的 sRGB `#ffeef0` / `#fcf3d6` / `#fff0e5` 与 spec 表逐字相同——说明两侧用的是同一套算式。

base = `9ce948e`（`--bg #fbfcfd` · `--accent #2072d5` · `--error #db423c` · `--working #de9d16` · `--offline #b4b8bc`）
交付 = `--bg #fcf8f0` · `--accent #ffb9d1` · `--accent-deep #93566d` · `--accent-graphic #b27289` · `--error #aa4a44`

| spec 登记的不达标项 | base 实测 | 交付实测 | 阈值 | 判定 |
| --- | --- | --- | --- | --- |
| `--accent` 作文字 on `--panel-2` | **4.16（低于 AA）** | **4.52**（`--accent-deep`） | 4.5 | ✓ 修到达标 |
| `--error` 作文字 on `--bg` | **4.21（低于 AA）** | **5.27** | 4.5 | ✓ 修到达标 |
| `--faint` on `--panel-2` | **4.10（低于 AA）** | **4.53** | 4.5 | ✓ 修到达标 |
| `--working` 点 on `--surface` | **2.35（低于 3:1）** | **3.66** | 3.0 | ✓ 修到达标 |
| `--offline` 点 on `--surface` | **2.00（低于 3:1）** | **3.64** | 3.0 | ✓ 修到达标 |
| `--online` 点 on `--surface` | 3.15 | **3.67** | 3.0 | ✓ |
| `--error` 点 on `--surface` | 4.33 | **5.48** | 3.0 | ✓ |
| `--accent` 作文字 on `--bg` | 4.60 | **5.23**（`--accent-deep`） | 4.5 | ✓ |
| `--accent` 作焦点环 on `--surface` | 4.72 | **3.65**（`--accent-graphic`） | 3.0 | ✓ |
| `--accent` 作焦点环 on `--panel-2`（最暗纸） | 4.16 | **3.03** | 3.0 | ✓ |

### 交付后的对比度表（全部配对，逐对实测）

**文字 on 纸张**（阈值 4.5）：`--fg` 11.71 / 12.19 / 10.94 / 10.12 · `--muted` 6.80 / 7.08 / 6.35 / 5.88 · `--faint` 5.24 / 5.46 / 4.90 / 4.53（四列 = `--bg` / `--surface` / `--panel` / `--panel-2`）。

**fill + `--on-accent`**（阈值 4.5）：`--accent` **7.74** · `--selected` **7.65** · `--unread` **9.52** · `--warn` **8.01** · `--online-fill` **7.13** · `--working-fill` **7.57** · `--error-fill` **5.19** · `--offline-fill` **7.17**。`--accent-hover` + `--on-accent` = **6.21**。

**`-deep` 档 on 两档纸张**（阈值 4.5）：`--accent-deep` 5.23 / 4.52 · `--selected-deep` 5.27 / 4.56 · `--unread-deep` 5.24 / 4.53 · `--warn-deep` 5.22 / 4.51 · `--online-text` 6.87 / 5.94 · `--working-text` 7.01 / 6.06 · `--error` 5.27 / 4.55 · `--offline-deep` 5.29 / 4.58（`--bg` / `--panel-2`）。

**`-graphic` 档 on `--bg` / `--panel-2` / `--surface`**（阈值 3.0）：`--accent-graphic` 3.51 / 3.03 / 3.65 · `--selected-graphic` 3.48 / 3.01 / 3.62 · `--unread-graphic` 3.49 / 3.01 / 3.63 · `--warn-graphic` 3.52 / 3.04 / 3.66 · `--online` 3.52 / 3.04 / 3.67 · `--working` 3.51 / 3.04 / 3.66 · `--error` 5.27 / 4.55 / 5.48 · `--offline` 3.50 / 3.02 / 3.64。

**`-deep` / `-graphic` on 自家 `-soft`**（阈值 4.5 / 3.0）与**淡底可见性 ΔL（≥3.0）**：accent 4.94 / 3.31 / ΔL **3.15** · selected 5.00 / 3.30 / **3.08** · unread 4.99 / 3.32 / **3.13** · warn 4.92 / 3.32 / **3.27** · online 6.44 / 3.30 / **3.89** · working 6.65 / 3.33 / **3.16** · error 4.67 / 4.67 / **5.28** · offline 5.00 / 3.30 / **3.34**（8/8 ≥ 3.0）。

**头像五格 + 深墨**（阈值 4.5）：`--av-0` 7.65 · `--av-1` 7.13 · `--av-2` 8.01 · `--av-3` 9.52 · `--av-4` 7.17。

### 测试与门禁（票 02 单独落绿的事实判据）

- **票 02 落地后的独立状态**：`npm test` **1278/1278 全绿**（base 也是 1278——票 02 只换值、只新增名字，字符串级断言一条不受影响；唯一让 T-A 红的阴影 ink 已在实施期修掉，见「偏离 6」）。
- **交付态（票 02+03）**：`npm test` **1290/1290 全绿**（rebase 到 `cd89136` 后含 #122 新增用例的全量）。
- `npm run typecheck`：干净（exit 0），与 base 逐字相同。`npm run lint`：**0 error**，仅 1 条既有 warning（`hooks/useI18n.tsx:61 react-hooks/exhaustive-deps`），与 base 逐字相同 ⇒ **零新增**。

### 渲染面证据（真浏览器读产品自己渲染出的计算值，端口 30143、`WORKSPLICE_DATA_DIR=/tmp/macaron-tokens-data`）

下面全是**产品自己渲染出的元素**（不是「某个 class 字符串在不在」），比对的参照是同一页面里 token 自身的浏览器序列化值：

| 面 | 读到的值（原文） |
| --- | --- |
| 根上 token | `--bg` = `lab(97.7239% .318408 4.19663)` · `--fg` = `--on-accent` = `lab(21.7051% 8.71933 -14.2173)` · `--accent` = `lab(82.3067% 28.5758 -1.52109)` · `--accent-graphic` = `lab(55.5095% 28.405 -1.56869)` · `--selected` = `lab(81.499% 15.1362 -25.841)` · `--unread` = `lab(90.0164% -.327617 40.8133)` · `--warn` = `lab(83.7297% 18.7661 26.8269)` |
| `body` | `background-color` === `--bg` ✓ · `color` === `--fg` ✓ |
| 焦点环（键盘） | 真 `button.icon-btn` 的 `:focus-visible`：`outline: 2px solid lab(55.5095 28.405 -1.56869)` —— 与 token `--accent-graphic` 的序列化值**逐字相等** ✓（`outline-width: 2px` / `outline-style: solid`） |
| 焦点环（字段） | `.search-btn:focus-within` 与 `.composer-box:focus-within` 的 `border-color` === `--accent-graphic` 序列化值 ✓；`box-shadow` = `oklch(0.857 0.0859833 356.814 / 0.22) 0px 0px 0px 3px` = `--accent-soft` 3px 环 ✓ |
| 四态状态点 | 真 `.presence.online`（侧栏 3 个 agent）= `lab(55.1443 -35.6071 14.5089)` === `--online` ✓；`working` / `error` / `offline` 三态在本票数据目录里没有实体 agent，用产品自己的 class 规则取计算值：`lab(55.7054 14.7697 47.6721)` / `lab(44.467 40.0084 24.0547)` / `lab(55.3772 5.16802 -8.02708)` —— 分别与 `--working` / `--error` / `--offline` 的序列化值逐字相等 ✓ |
| pastel 填充 + 其上文字 | `.brand-mark`：`bg` === `--accent`，`color` === `--on-accent` ✓ · `.btn.btn-primary`：同 ✓ · `.badge`：`bg` === `--unread`，`color` === `--on-accent` ✓ · `.avatar.sm.av-0`：`bg` === `--selected`，`color` === `--on-accent` ✓ · `.composer-send`（禁用态）：`bg` = `--panel-2`，`color` = `--faint` ✓ |
| 旧值灭绝（机械判据） | 旧阴影 ink `oklch(21% 0.02 255 / …)` 在 `app/components/hooks/lib` + 两份 token 文件里 **0 处**（只剩 `ui_kits` 的静态原型 1 处，见遗留项） |

（探针实现说明：`working/error/offline` 三态与 token 序列化参照都靠同一页面的探针元素取，探针只设 inline `transition:none` 防过渡中间态——第一轮读 `:focus-within` 卡在过渡起点就是这个原因，`--dur` 实测 `.12s`。）

### 偏离与登记（逐条，不静默）

1. **四态状态点不加 `-graphic` 第二名字**（Q1 = a）：D7 的「base 名 = 该族今天的实际主用途档」判定 `--online` / `--working` / `--offline` 的 base 名即 graphic 档、调用点零改动；`--error` 的 base 是 deep 档、按 D7「同值第二名字不设」不立 `--error-graphic`。spec 的 Testing Decisions §3/§4 里那两行「点改 `-graphic`」作废，已写进 spec 勘误 1。
2. **`--unread-soft` 34% → 36%、`--warn-soft` 22% → 24%**（Q4 = b）：原配比复算只有 ΔL 2.95 / 2.98，不满足本 effort 自定的 ≥3.0。修正后 8/8 达标（3.08–5.28），阈值 3.0 不动。勘误 2。
3. **`--accent-hover` 的裁决值**：矩阵留白，取 `oklch(79.4% 0.104 356.6)`（fill 压深一档）；取 `--accent-deep` 时 on-accent 只有 3.34:1（<4.5，不可行）。勘误 3。
4. **新档位名的落层**（Q2 = A，产品所有者定夺）：上游 = `--on-accent` + 五个既有族的新档位名；扩展层 = `--selected*` / `--unread*` / `--warn*`。勘误 4。
5. **`--offline-deep` 的名字**：矩阵给了 offline 的文字档值但没给名字，按 D7「新增档一律加后缀」补 `--offline-deep`（当前零消费，与 online / working 的 `-text` 对称）。
6. **`tokens.css` 的三条 `--shadow-*` 同步 ink（越界确认后授权）**：D11 说「色值全部落在 `colors_and_type.css`」，实际三条 `--shadow-*` 在两份上游文件里**都声明且逐字相同**，而 import 顺序是 `colors_and_type.css` → `tokens.css`，**生效的是 tokens.css 那一份**。只改 colors_and_type.css 时 T-A 立刻红（`token --shadow-pop 的值被本仓改写了`），且 Testing Decisions §2 的「`oklch(21% 0.02 255 / …)` 全仓计数为 0」判据会停在 3。裁定 (a)：同步值、**不去重**（去重是结构性改动，该有自己的票）。勘误 5。
8. **条状指示器取图形档**（实施期复算 + review 的 Spec 轴 P1，`spec.md` 勘误 6）：矩阵没给「fill 落在纸 / 槽上」这一格，实测填充档 `--accent` 落在槽 `--panel-2` 上只有 1.30:1（改前 3.86:1），故 `.meter i` / `.meter.warn i` 与两处开关轨道取各族图形档（实测 3.03 / 3.04 / 3.51）。契约由此明确：**fill 档只与 `--on-accent` 配对**，不与纸 / 槽作对比配对。
9. **`--accent-line` 的定义本票不动**：删除属票 04；票 03 只把它的 7 处引用改指 `--accent-graphic`（本票内它的值随 `--accent` 自然变成淡粉，但因为两票同批合入，没有可观察的中间态）。

### 遗留项（登记，不修）

1. `--shadow-pop` / `--shadow-card` / `--shadow-composer` 在 `colors_and_type.css`（L99–102）与 `tokens.css`（L28–31）**重复声明**，按 import 顺序 `tokens.css` 生效、`colors_and_type.css` 那三条是死的。去重可验证成立（两份都同时 import；删后 colors_and_type.css 仍 65 条声明 > T-A 的 >20 下限；SKILL.md 写明 tokens.css 职责本就含 elevation），但它是结构性改动，留给独立票。
2. `worksplice-design-system/ui_kits/app/app.css` 的 `.msg-text pre` 深色代码块字面量（`oklch(24% 0.015 255)` / `oklch(94% 0.01 250)` / `.cmt` / `.kw`）**未换族**：矩阵没有覆盖这套深色面，spec 的「token 面收口」表也只点名三处字面量——就地改值属发明，登记给后续票。
3. `app/manifest.ts` 的 `background_color` / `theme_color` 仍是 `#1a1a1a`（ADR-0014 落地时也没跟着改），本 effort 不动。
4. `worksplice-design-system/worksplice-app.html`（**自带内联 `:root` 的第三份色板副本**，非运行时、无断言读它）与 `ui_kits/app/app.css` 对产品扩展层名（`--selected*` / `--unread*` / `--warn*`）的依赖：两条都交票 04 裁决（前者「同批迁 vs 退役」，后者「三角色族上游化 vs 在 kit/SKILL 登记依赖」）。依据与实测见票 03 的 Answer「findings 的处置」表。
5. `components/ModelsConfig.tsx:1116 / 1124 / 1133` 的既有静态检查发现（SSE 帧 `JSON.parse(e.data)` 无 try/catch、OAuth `window.open(data.url!…)` 未校验跳转目标）**本票不修**：它们是 base commit 逐字存在的既有代码（`git show 9ce948e:components/ModelsConfig.tsx` 同区间 diff 为空，本票 diff 里 `grep window.open\|JSON.parse` 计数 0），修它要改行为，而本票的零行为改动声明是硬边界；「校验策略」是独立的安全范围决定。coordinator 已裁示「登记不修，后续动作由它定」。

### 未获答复的提问（知情项）

`ui_kits/app/app.css` 要不要跟着迁移——`orca orchestration ask`（msg_675e9b1b9905）两次 30 分钟超时未获答复。我按提问里的推荐项执行（镜像迁移，保住两条「逐字搬运」断言的不变量），理由与代价见票 03 的 Answer「偏离 4」。若最终裁定为「不迁移 + 收窄断言」，回退面就是那一个文件的 diff。
