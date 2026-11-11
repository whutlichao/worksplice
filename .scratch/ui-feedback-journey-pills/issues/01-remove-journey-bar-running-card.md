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
| A2 | `journey-state.ts` 删 `JourneyStep` / `JourneyState.step` / 全部 step 计算（45 → 60 行，纯 guideKind 推导） |
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

见下方「Review」段。

### 偏离与遗留

- 席位容器用 `fit-content(100%)` 而非票据口径里的「`max-content`」表述（票文本本身已写明
  这一选择）：两者在装得下时等价，装不下时前者退化为容器宽并允许折行，避免被面板
  `overflow:hidden` 裁掉。验收条目里「静音面板容器带 `gridTemplateColumns: "max-content"`」
  一句与 §C 的 `fit-content(100%)` 冲突，按 §C 的显式口径落地，静态断言也断言
  `fit-content(100%)`。
- 排版契约的源码断言只是弱证据（文本级匹配），真正的等宽由上面的浏览器读数背书。
- 静音面板在 seed 数据下没有静音记录时列表为空，所以 `#all` 面板读到的是 6 个未静音成员；
  等宽结论在空/非空两种状态下都成立（容器与子项排布与内容无关）。
- 未跑 `next build`（仓库禁止）；未跑打包期脚本与 Playwright。
