# Answer：旅程引导卡形态切换过渡（粒子消散 → 重聚）

## 结果（行为变化）

消息页旅程引导卡（`JourneyGuideCard`，四种形态 describe / handoff / running / review）在
任务状态推进时不再是整块瞬间替换：

- **形态切换**（handoff→running、running→review 等）：卡面播放一次「粒子消散 → 重聚」，
  新卡面同时淡入/轻微缩放；切换瞬间只有一张卡（React 原地替换内容，粒子层掩盖替换）。
- **首次出现**（null→某形态）：播放重聚进入；切到另一个频道时也按新频道首现处理
  （过渡状态按频道 id 作用域重置，不会沿用上一个频道的卡面）。
- **卡面消失**（guideKind→null）：先用局部状态保留最后一张卡面的 kind 340ms，播完消散
  再卸载；保留状态只服务动画，不改 journey 推导。
- 动画总时长 ≤900ms（切换 520ms 卡面 + 粒子错峰至 605ms；退场 320ms 卡面 / 340ms 保留），
  只动 `transform` / `opacity`，不参与布局，消息流不抖动；动画结束后卡面 opacity 1、
  无位移、粒子 opacity 0。
- `prefers-reduced-motion: reduce`：卡面立即处于最终态（无动画、opacity 1），粒子瞬间走完
  且全程不可见。

可观察契约不变：`section[aria-label]` 仍是当前形态标题；标题/hint/按钮文案与 i18n key
未动；卡片宽度、字号、间距、边框、阴影等视觉 token 未动；按钮点击行为未动。

## 实现方案

### 状态机（纯函数，可单测）

`components/ChannelView.tsx` 新增：

```text
nextJourneyGuideView(previous, kind)
  kind === null
    previous 为空或已在退场 → 原样返回（同一引用，不重播）
    否则                   → { kind: previous.kind, phase: "exit", generation+1 }
  kind !== null
    previous 为空          → { kind, phase: "enter", generation: 1 }
    kind 未变且非退场      → 返回 previous（同一引用，不重渲染）
    否则                   → { kind, phase: "switch", generation+1 }
    （退场中改回形态仍按 switch：旧卡面还在屏幕上）
```

`completeJourneyGuideExit` 只在视图仍为 `exit` 时清空，避免计时器误杀新状态。
`useJourneyGuideView(scope, kind)` 用 `useLayoutEffect` 在绘制前驱动状态机，并在
`phase === "exit"` 时挂 `JOURNEY_GUIDE_EXIT_MS`（340ms）计时器；`generation` 作为卡片
`key`，保证同类动画（如 handoff→running→review 都是 switch）每次都能重播 CSS 动画。

- **scope = 频道 id**：ChannelView 在 AppShell 里不按频道重新挂载，局部过渡状态必须按
  频道作用域重置。渲染期比较 `viewScope` 并直接丢弃旧频道的 view（React 的「props 变化
  时调整 state」模式），切换频道首帧就不会显示旧卡。
- **无消息时传 `kind = null`**：空态有自己的静态 describe 卡，消息流末尾不渲染引导卡。
  这样频道数据到达后的第一张流内卡面是 `null → handoff`，走 enter（重聚进入），而不是
  从加载期推导出的 describe 切过来。
- `phase === "exit"` 的卡面加 `inert`，退场 340ms 内不再接受点击/键盘焦点。

SSR/hydration：hook 初始值由 `kind` 同步推导（`null` 或 `{kind, phase:"enter", gen:1}`），
不读时钟/随机，服务端与客户端首帧一致；浏览器探针采集 `console.error` 0 条、
hydration 警告 0 条。

### 粒子

- 12 个 DOM `<span>`（8–16 要求内），父层 `aria-hidden="true"`、`pointer-events: none`；
  不使用 canvas / 动画库 / 新依赖，不新增路由。
- 方向、距离、错峰延迟、尺寸全部由索引查表确定性给出（`JOURNEY_GUIDE_PARTICLES`，
  表项与 `data-guide-particle-index` 一一对应）；渲染期无 `Math.random()`，也不用
  三角函数，SSR 与浏览器两次渲染 markup 逐字一致（有单测）。
- CSS 变量 `--guide-dx/--guide-dy/--guide-delay` 由组件内联给出，keyframes 只消费变量。

### 时长与 CSS

`app/globals.css` 新增（只增不改既有 keyframes）：

| 场景 | 卡面 | 粒子 | 上限 |
| --- | --- | --- | --- |
| 进入（enter） | `journey-guide-card-in` 420ms | 重聚 320ms + 0–45ms 错峰 | 365ms |
| 切换（switch） | `journey-guide-card-switch` 520ms | 消散 260ms → 重聚 300ms（+260ms 起，错峰 0–45ms） | 605ms |
| 退场（exit） | `journey-guide-card-out` 320ms | 消散 260ms + 错峰 | 340ms 后卸载 |

切换时重聚动画用 `animation-fill-mode: forwards`（不是 `both`）：用 `both` 时延迟阶段会以
0% 关键帧压住同一属性，消散段粒子会被藏掉（浏览器探针中段 opacity 实测 0 → 0.44 才发现
并修正）。

### reduce

`@media (prefers-reduced-motion: reduce)`：

- `.journey-guide-card { animation: none !important; transform: none !important; opacity: 1 !important; }`
  —— 卡面立即最终态；
- `.journey-guide-particle { animation-duration: 0.001s !important; animation-delay: 0s !important; }`
  —— 粒子瞬间收敛且基态 opacity 0，全程不可见；同时保留既有全局属性级 reset。

## 基线无改动行为

- `lib/journey-state.ts` 推导与优先级未改；`hooks/useChannelData.ts` 轮询未改；无服务端 /
  API / 数据库改动；无新依赖、无 canvas/WebGL/动画库、无新路由。
- 既有引导卡测试（四种形态文案、按钮数量、秘书入口门控、Tasks badge）全部保持通过；
  `journey` 推导仍同时服务 JourneyBar 与 Tasks badge。
- 既有 `@keyframes` 与 reduce 规则未改；T-C「@keyframes 只增不减」仍成立（新增 5 组）。

## 红 → 绿

- **红**：`evidence/red-unit-tests.log` —— 先写测试、在未实现代码上跑：
  `tests 84 / pass 80 / fail 4`。失败点为：粒子层缺失、`journey-guide-card` 阶段类名缺失、
  `nextJourneyGuideView` 未导出、新 keyframes 不存在。
- **绿**：`evidence/narrow-gate.log` ——
  `node --test --test-timeout=60000 components/ChannelView.test.mjs app/globals.test.mjs`
  → `tests 84 / pass 84 / fail 0`。
- 覆盖：四形态粒子层存在 + `aria-hidden` + 数量 8–16 + 两次 SSR markup 一致；阶段类名
  （enter/switch/exit）与 `aria-label` 不变；状态机进入/切换/退场保留/重入/同引用；
  reduce 块 `animation-duration: 0.001s` 与 5 组新 keyframes 存在。

review 追加的跨频道红→绿（`probe-cross-channel.ego.mjs`）：

- **红**（HEAD 旧 hook）：`evidence/cross-channel-red.log` → RED。从「去复核」卡所在的
  频道 A 切到无卡频道 B 后，B 的第一张消息流卡面是加载期残留的 `describe / switch`
  （`journey-guide-card is-switching`），说明过渡状态跨频道沿用。
- **绿**（本票修复）：`evidence/cross-channel.log` → GREEN。B 的首张消息流卡面为
  `handoff / enter`（`is-entering`），900ms 采样内从未出现 A 的「去复核」；切回 A 时
  卡面按 enter 重建。

## 浏览器真实证据（ego-browser）

探针 `.scratch/journey-card-transition/probe.ego.mjs`：自建**私有**频道 + 消息 + 任务
（`POST /api/channels`、`POST /api/messages`、`POST /api/tasks`），打开 `#c/<id>`，
用本地 HTTP 接口依次制造 claim（todo→in_progress）→ `in_review` → `done`；
状态只由探针制造（私有频道，不让 agent-loop 抢先认领）。

隔离实例：`WORKSPLICE_DATA_DIR=/tmp/ws-journey-card-transition PORT=30199
./node_modules/.bin/next dev -H 127.0.0.1 -p 30199`，全程未触碰 `~/.worksplice`，
用户 30142 未动；取证结束后已停。

结论（`evidence/after.log` → `VERDICT GREEN (0 failure(s))`，`evidence/after.json`）：

| 断言 | 实测 |
| --- | --- |
| 切换时卡面 computed animation-name | `journey-guide-card-switch`（非 none） |
| 切换时粒子 computed animation-name | `journey-guide-particle-out, journey-guide-particle-in`（非 none） |
| 切换中段（冻结 150ms）粒子可见 | opacity 0.442489 |
| 终态 | 卡面 opacity 1、`matrix(1,0,0,1,0,0)`、粒子 opacity 0 |
| reduce 下粒子 animation-duration | `0.001s`（opacity 0，卡面 opacity 1 且文本可见） |
| 退场 | 卡面 `journey-guide-card-out`、粒子 `journey-guide-particle-out`，播完卸载 |
| aria-label 序列 | 「等待交接或认领」→「让它跑」→「去复核」→ 无 |
| console.error / hydration 警告 | 0 条 / 0 条 |

截图：`evidence/after-00-initial.png`（初始 handoff）、
`after-01-switch-running-mid.png`（切换瞬间，粒子在途）、
`after-02-running-final.png`（终态）、`after-03-reduce-review.png`（reduce 下内容可见、
无粒子）、`after-04-exit-mid.png`（退场中，任务已 done 但卡面仍在消散）、
`after-05-done-gone.png`（卸载后）。

跨频道证据（review 追加）：`evidence/cross-channel-red.log`（旧实现 RED，channel B 首张
流内卡面 `describe / switch`）→ `evidence/cross-channel.log`（本票 GREEN，`handoff /
enter`，且 B 从未出现 A 的「去复核」）；截图 `cross-01-channel-b-no-card.png`、
`cross-02-channel-a-card.png`。

## 验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `node --test components/ChannelView.test.mjs app/globals.test.mjs` | 84 pass / 0 fail（`evidence/narrow-gate.log`） |
| `npm run typecheck` | 0 error（`evidence/typecheck.log`） |
| `npm run lint` | 0 error，仅既存 `hooks/useI18n.tsx:61` 一条 warning（`evidence/lint.log`） |
| ego 浏览器探针（主） | VERDICT GREEN（`evidence/after.log` / `after.json`） |
| ego 浏览器探针（跨频道） | 旧实现 RED（`evidence/cross-channel-red.log`）→ 本票 GREEN（`evidence/cross-channel.log`） |

本票按窄档未跑全量 `npm test`（票据明确「本票不跑」）。

## Review（双轴 code-review，对 `origin/main...HEAD`）

### Standards 轴

| # | 级别 | Finding | 处置 |
| --- | --- | --- | --- |
| S1 | 硬（判断） | reduce 下粒子用 `0.001s`，而仓库既有 reset 用 `0.001ms`，被读作「削弱」 | **保留 `0.001s`**。票据 Observable Acceptance 逐字要求浏览器断言该值；该规则是本票新增、更具体的选择器，既有全局 reset（`0.001ms`）与其他 reduce 规则一字未改，1ms 内仍是瞬时收敛。作为票据内部取舍记录于此 |
| S2 | 硬 | 注释称时长「对齐」，但 `EXIT_MS=340` ≠ CSS 320ms，switch 粒子最长 605ms；另有两个未使用的导出常量 | **已改**：删除未使用的 `ENTER_MS/SWITCH_MS`；注释逐段写明 420/520/320ms、粒子序列约 605ms、340ms 是退场保留窗口 |
| S3 | 判断 | `phase` / `generation` 未进 CONTEXT.md 词表 | **不改**：CONTEXT.md 不在本票 Ownership；两者是组件内实现词汇，不是领域术语 |
| S4 | 判断 | `useState` 初始化重复 `nextJourneyGuideView` 的 enter 分支 | **已改**：初始化直接调 `nextJourneyGuideView(null, kind)` |
| S5 | 判断 | CSS 缓动/duration 重复、`phaseClass` 三元级联与 CSS 类映射是两份表达 | **不改**：单处 3 项映射，抽表只增加间接层 |
| S6 | 判断 | 空态分支是另一处 `JourneyGuideCard`，不吃过渡状态 | **保持**：空态卡与消息流末尾卡是两个渲染位置；本票只给消息流卡做过渡状态 |

### Spec 轴

| # | 级别 | Finding | 处置 |
| --- | --- | --- | --- |
| P1 | 硬 | Answer.md（Acceptance 4/5）缺失 | **已补**：本文件即 Answer，随本票提交 |
| P2 | 硬 | Change 2「时长与退场动画一致」口径不一致 | **已改**：见 S2，注释与探针口径统一 |
| P3 | 硬（重要） | **跨频道状态泄漏**：ChannelView 不按频道重挂载，过渡状态会带到新频道 | **已修**：hook 增加 `scope`（频道 id），渲染期丢弃旧频道 view；无消息时 `kind=null`，首个非空卡面走 enter。新增 `probe-cross-channel.ego.mjs`：旧实现 RED → 本票 GREEN |
| P4 | 判断 | `useEffect` 晚一帧，旧卡多画一帧 | **已改**：状态机改由 `useLayoutEffect` 在绘制前驱动，配合渲染期 scope 修正 |
| P5 | 判断 | reduce 下退场未单独测 | **不改**：reduce 下卡面立即终态（opacity 1），340ms 后卸载；探针已断言 reduce 下内容可见、粒子 0.001s |
| P6 | 判断 | 退场中按钮仍可键盘聚焦 | **已改**：`is-exiting` 卡面加 `inert` |
| P7 | 判断 | globals 测试的 reduce 断言可能命中任意块 | **已改**：从 reduce 块中选出包含粒子规则的那一块再断言 |
| P8 | 判断 | 粒子「由索引推导」实为硬编码 12 项表 | **保持**：表项按索引一一对应、确定性与 SSR 一致性由单测与 hydration 0 警告覆盖；spec 要求的是确定性，不是数学推导 |

**结论**：两轴无未处置的硬 finding。P3 的跨频道问题由 review 发现并修复，附旧实现红证据。

## 未完成项

- 无。

## PR

- 分支：`journey-card-transition`
- PR body：`.scratch/journey-card-transition/pr-body.md`
- PR 号：（创建后回填）
