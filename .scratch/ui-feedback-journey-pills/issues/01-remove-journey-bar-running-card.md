# 实施票 01：删掉旅程条与「让它跑」引导卡 + 成员条等宽

Status: resolved

- 日期：2026-11-11
- 分支：`ui-feedback-journey-pills`
- 基地：`40af86e`（`main`，含 PR #215；全量基线 1748/1748）
- 来源：用户对频道消息页的四条界面反馈——① 去掉顶部旅程条；② 去掉「让它跑」引导卡；
  ③ 静音面板的成员条等宽；④ 成员面板的成员条等宽。①② 是删功能，③④ 是调用点排版。

## 范围

### A. 删掉频道消息页顶部的旅程条

`components/ChannelView.tsx` 删 `JOURNEY_STEPS` 常量与 `JourneyBar` 组件，以及它在
`{channel && tab === "messages" && !messagesLoading && !loadError}` 门控里的唯一渲染点
（门控整体删除，不留空条件）。`lib/journey-state.ts` 删 `JourneyStep` 类型、
`JourneyState.step` 字段与 `deriveJourneyState` 的全部 step 计算；`guideKind` /
`hasTasks` / `openTaskCount` 保留，`ChannelView` 里的 `journey` useMemo 保留（引导卡与
Tasks badge 仍从它取值）。两包各删 8 个只有旅程条在用的键：`journey.label`、
`journey.describe`、`journey.handoff`、`journey.run`、`journey.review`、`journey.done`、
`journey.active`、`journey.stepStatus`。

### B. 删掉「让它跑」引导卡

`JourneyGuideKind` 去掉 `"running"`，只剩 `describe` / `handoff` / `review`。
`deriveJourneyState` 的 guideKind 判定（用户已定夺，口径不改）：

| 频道状态 | guideKind |
| --- | --- |
| 无消息 | `describe` |
| 有消息、无任务 | `handoff` |
| 任一 `in_review` | `review` |
| 任一 `todo`（含与 `in_progress` 并存） | `handoff`（等待交接或认领） |
| 其余（只有 `in_progress`，或全部 done/closed） | `null` |

即 `in_progress` 不再产出任何卡；有 todo 时回落 handoff。`resolveJourneyGuideContent`
删 running 分支，最后的 `else if (kind === "review")` + `default` 走 `never` 穷尽检查，
以后新增 kind 时编译失败而不是静默渲染「去复核」文案。两包各删 `journey.running.title`
/ `journey.running.hint` / `journey.running.cta`。

### C. 静音面板的成员胶囊等宽

列表容器由 `display:flex; flexDirection:column; gap:6; alignItems:flex-start` 改为
`display: grid` + `gridTemplateColumns: "fit-content(100%)"` + `gap: 6` +
`justifyItems: "stretch"`。用 `fit-content(100%)` 而非裸 `max-content`：装得下时两者等价，
装不下（超长成员名）时前者退化为容器宽并允许折行，不会被面板的 `overflow:hidden` 裁掉。

### D. 成员面板的成员行胶囊等宽

列表改两列 grid（`fit-content(100%) max-content`，`columnGap` / `rowGap` 均 6），每行
`display: grid` + `gridTemplateColumns: "subgrid"` + `gridColumn: "1 / -1"` + `columnGap: 6`
+ `alignItems: "center"`；行内两个子元素显式落列（`button.member-opt` → `gridColumn: "1",
gridRow: "1"`，移除键 → `gridColumn: "2", gridRow: "1"`），不依赖自动排布。人类行没有移除
键时第二列留空、胶囊仍与其它行等宽。「添加成员」胶囊区（wrap 流式）不动。

约束：不改 `.member-opt` / `.journey-guide-*` 全局 CSS，不动引导卡粒子与 CSS 过渡、
`lib/journey-guide-particles.ts`、`app/globals.css`；不改任务板 / 消息流 / pinned /
composer 行为；不改 `openTaskCount` 口径与 Tasks badge。

## Answer

### 落地情况

| 项 | 落地 |
| --- | --- |
| A1 | `ChannelView.tsx` 删 `JOURNEY_STEPS`（12 行）与 `JourneyBar`（约 100 行）及其渲染门控；`Check` 图标仍被复制链接按钮使用，import 保留 |
| A2 | `journey-state.ts` 删 `JourneyStep` / `JourneyState.step` / 全部 step 计算（73 → 55 行，纯 guideKind 推导） |
| A3 | 两包各删 8 键；`journey.describe.*` / `journey.handoff.*` / `journey.review.*` 原样保留 |
| B4–B6 | 联合类型收窄为三态；`in_progress` 单独不再出卡；`resolveJourneyGuideContent` 的 else 分支改为显式 `review` + `never` 兜底 |
| B7 | 两包各删 3 个 `journey.running.*` 键；`journey.handoff.ctaTasks` / `journey.review.cta` 保留 |
| C8 | 静音面板容器改一列 grid + `fit-content(100%)` + `justifyItems: stretch` |
| D9 | 成员面板两列 grid + 每行 subgrid，胶囊与移除键显式落列 |
| E10 | `AGENTS.md` 237 / 291 行改为「引导卡三态、不再推导 step、无旅程条」 |
| E11 | 本票据 |

删掉的导出无残留：「仅测试引用」的 `JourneyBar` / `JourneyStep` / `step` 一律删干净，
`ChannelView.test.mjs` 的 import 与整条旅程条测试同时删除。

### 测试（TDD 红 → 绿）

红证据（改动前，`.scratch/ui-feedback-journey-pills/evidence/`）：
`red-journey-state.txt`（2 fail：只有 in_progress 仍返回 `running`、in_progress+todo 仍返回
`running`）、`red-ui-tests.txt`（6 fail：旅程条未删、running 分支仍在、接线断言仍要求
`<JourneyBar`、两处排版契约、轮询用例仍期待 `running`）。

新增 / 改写的用例：

- `lib/journey-state.test.mjs`：覆盖 describe / handoff / review / null 五条优先级路径，
  **不再有任何 `step` 断言**；`openTaskCount` 口径用例保留。
- `hooks/useChannelData.test.mjs`：轮询用例 `in_progress → null`，其余（in_review→review、
  todo→handoff、done/closed→null）保持。
- `components/ChannelView.test.mjs`：删 `JourneyBar` import 与整条旅程条测试；`GUIDE_KINDS`、
  卡壳静止样本、过渡状态机样本的 `running` 换成 `handoff` / `review`；「进行中与待审核引导卡
  分别提示」拆成只测 review，并断言联合类型里不再有 `"running"`、源码里不再有
  `journey.running`；接线测试删 `<JourneyBar step={journey.step}` 断言，其余保留。
  新增两条排版契约弱证据：静音面板容器带 `gridTemplateColumns: "fit-content(100%)"` 与
  `justifyItems`；成员面板两列 grid + 每行 `subgrid` + 两个子元素显式落列。

全量：`env -u BASH_ENV -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u DEEPSEEK_API_KEY
-u STARSHIP_SESSION_KEY npm test` → **1751 tests / 1751 pass / 0 fail**（基线 1748，本票 +3）。
`node_modules/.bin/tsc --noEmit` 退出 0；`npm run lint` 0 error（1 条 base 既有 warning
`hooks/useI18n.tsx:61`，未动）。

### 浏览器实测

隔离实例：`WORKSPLICE_DATA_DIR=/tmp/ws-ui-feedback-data`，端口 30199（未指向
`~/.worksplice`、未用 30142）；数据经 `node scripts/seed-demo.mjs` 播种。基线读数取自
`40af86e` 的独立 worktree（端口 30198，同一份 seed 的副本）。ego-browser（Chromium）。
完整读数见 `.scratch/ui-feedback-journey-pills/evidence/browser-measurements.json`。

**旅程条**（`#stream-sync`）：基线 `nav > ol` 命中 1，文本「描述→交接→让它跑→4复核」；
改动后 `nav > ol` 计数 0，`Guided journey` / `上手旅程` 文案均无命中。

**「让它跑」引导卡**（`#infra-cost`，只有 1 个 `in_progress` 任务）：基线消息流末尾有
`section.journey-guide-card`「让它跑」；改动后计数 0，也没有回落成复核卡或交接卡。
`#all` 有 1 个 `in_review` 任务，复核卡在改动前后都存在（保留行为，未误删）。

**静音面板成员胶囊宽度**（6 个 `@成员` 胶囊）：

| | 宽度读数 |
| --- | --- |
| 基线 | 112.7 / 109.3 / 112.7 / 101.0 / 124.9 / 118.6 px |
| 改动后 | 124.88 / 124.88 / 124.88 / 124.88 / 124.88 / 124.88 px |

**成员面板胶囊宽度与移除键对齐**（`#stream-sync`，6 个 agent + 1 个人类行）：

| 成员 | 基线宽 / 移除键 left | 改动后宽 / 移除键 left |
| --- | --- | --- |
| Iris | 48.0 / 326.0 | 71.87 / 349.87 |
| Quill | 56.3 / 334.3 | 71.87 / 349.87 |
| Nova | 59.7 / 337.7 | 71.87 / 349.87 |
| Marlow | 71.9 / 349.9 | 71.87 / 349.87 |
| Rune | 59.7 / 337.7 | 71.87 / 349.87 |
| Susan | 65.6 / 343.6 | 71.87 / 349.87 |
| Owner（人类，无移除键） | 未单独取基线（基线脚本按移除键定位行） | 71.87，与其它行等宽 |

截图：`evidence/after-members-panel.png`。

### 双轴 code-review

**Standards 轴**（`docs/engineering-standards.md` + Fowler smell baseline）发现 4 处，处置如下：

| finding | 处置 |
| --- | --- |
| 「旅程条已移除」测试用 `readFile` 扫源码，属实现细节 | 保留但收紧：删掉重复的 `<JourneyBar` / `openTaskCount` 断言（与「ChannelView 接线」测试重复），并在用例里写明理由——旅程条在 `!messagesLoading` 门控后才渲染，SSR 永远停在加载态，渲染断言读不到它，只能扫源码（与仓库既有的路由源码级断言同形态） |
| 新增排版断言直接匹配 `style={{…}}` 文本 | 保留：排版本身没有别的可观察面（SSR 输出的是内联样式字符串），票据已声明这是弱证据、真正等宽由浏览器读数背书 |
| 统一类型 / 命名：`deriveJourneyState` 已无 step，仍叫 journey | 不改：改名会牵动 `journey-state.ts` 文件名与多处导入，超出本票授权范围（票面只要求删 step） |
| 两段 grid 容器近乎同形（Duplicated Code） | 不改：两者列数不同（一列 vs 两列 + subgrid 行），共用一个样式对象反而要把差异参数化，得不偿失 |
| 同一 diff 在 `ChannelView.tsx` 做两件无关事（Divergent Change） | 不改：票面 A–D 明确把四项并成一票，是用户反馈的同一批改动 |

**Spec 轴**发现 4 处，处置如下：

| finding | 处置 |
| --- | --- |
| 票据 `## Answer` 的「双轴 code-review」只有占位句 | 已修：即本节 |
| 票据 A2 的行数记录（45 → 60）与实际（73 → 55）不符 | 已修：改为实测值 |
| 「偏离」段里关于 `max-content` 的描述是虚构冲突 | 已修：删掉该段；`§C` 与验收条目都写 `fit-content(100%)`，实现与票面一致 |
| 静音面板「seed 下没有静音记录时列表为空」的说法与 GET 语义矛盾 | 已修：`GET /api/channels/[id]/mute` 返回频道内全部 agent 成员（含未静音），面板从不因无静音记录而空 |

另一条被 review 标为「超出点名的断言范围」的项**不改**：票面验收第 3 条原文是
「『进行中与待审核引导卡分别提示…』拆成只测 review（**并断言 running 不再是合法 kind**）」，
扫联合类型与 `journey.running` 正是这句要求的落地方式。

### 偏离与遗留

- 静音面板与成员面板的等宽结论由浏览器读数背书（见上）；源码里的排版断言只是弱证据。
- `docs/spec-rebuild.md` 仍在「已决索引」与验收第 5 条里把「旅程条 4 步」写成 pi-sdk-rebuild
  票 07 的交付物（`prototype-ui/index.html?variant=b` 可点通四步）。那是那份 effort 的历史决策记录，
  不在本票可编辑范围内，未改；如需同步需另开票。
- `.scratch/ui-feedback-journey-pills/` 只有 `issues/` 与 `evidence/`（无 `map.md` / `spec.md`）：
  与同级 effort 目录（如 `.scratch/interface-audit-fixes/`）及本票 `Ownership` 一致。
- 未跑 `next build`（仓库禁止）；未跑打包期脚本与 Playwright。
