# Answer：旅程引导卡形态切换过渡（内容燃尽 → 重聚）

## 结果（行为变化，最终设计）

消息页旅程引导卡（`JourneyGuideCard`，describe / handoff / running / review）在任务状态
推进时不再是整块瞬间替换，也不是整卡动画：

- **卡壳静止**：`section.journey-guide-card` 的边框、背景、圆角、阴影、宽高、位置全程不动，
  不挂 `animation` / `transform` / `opacity`；阶段只写进 `data-guide-phase`。
- **切换**（同频道 kind 变化）：旧内容燃成粒子（原位短暂驻留 → 向上/向外飘散熄灭），新内容
  由粒子从四周聚拢成文字/按钮形状，实体内容在重聚约 90% 时淡入接管；粒子结束后从 DOM
  移除。旧内容层用 140ms 燃尽淡出（`is-burning`），与粒子 10% 处的淡入交叉，避免瞬时空白帧。
- **首现**（含切频道后的首张卡）：内容按「重聚进入」播放。
- **退场**（guideKind→null）：内容先燃尽（`is-burning` 140ms + 消散粒子），随后由状态机
  卸载卡壳；没有整卡退场动画。
- 固定参数：2.6px 网格、1.35×；消散 563ms、等待 237ms、重聚 415ms、约 90% 重聚开始淡入
  （374ms）、淡入 140ms。切换总清理点 782ms，进入 575ms。
- `prefers-reduced-motion: reduce`：不产生粒子/位移，内容立即终态。
- **跨频道**：切频道后首张卡按 `enter` 重建；用 messages 数组引用做数据归属门控，不加
  sleep/延时（打回修复保留）。

可观察契约不变：`section[aria-label]` 仍是当前标题；标题/hint/按钮文案与 i18n key、
视觉 token、焦点顺序、按钮点击行为均未动。

## 实现方案

### 状态机与作用域（沿用打回修复）

`components/ChannelView.tsx`：

- `JourneyGuideState`（scope / view / awaitingSnapshot / snapshot）与纯函数
  `initialJourneyGuideState`、`syncJourneyGuideState`、`advanceJourneyGuideState`、
  `completeJourneyGuideExitState`；`nextJourneyGuideView(previous, kind)` 给出
  enter / switch / exit。
- `useJourneyGuideView(scope, kind, snapshot)`：渲染期同步（React「props 变化时调整
  state」模式）丢弃旧频道 view；`useLayoutEffect` 在绘制前推进状态机；退场用
  `JOURNEY_GUIDE_EXIT_MS`（663ms）计时器清空。
- `snapshot = messages 数组引用`：切频道首帧数据仍属于上一频道，先置 `awaitingSnapshot`，
  快照换新后才用 `nextJourneyGuideView(null, kind)` 起算首张卡（enter）；之后同频道变化
  才 switch。等待期间不消费 kind。
- `generation` 作为 prop 传入（不再用 `key`），同一实例内每次过渡都能重播；`phase` 只进
  `data-guide-phase`，`exit` 时卡壳 `inert`。

### 内容层粒子流水线

- **内容快照**：`resolveJourneyGuideContent(kind, hasTasks, t, handlers)` 产出
  `{ title, hint, actions }`（i18n key/按钮 class/handler 原样保留）；`lastContentRef`
  保存上一份已提交内容，切换时作为消散源；退场沿用当前内容。
- **同构内容层**：`JourneyGuideContentLayer` 渲染标题/hint/按钮，带
  `data-guide-sample="text" | "button"`；旧内容副本绝对定位（`.journey-guide-content-outgoing`）
  覆盖在同一位置，`aria-hidden`/`inert`，切换时播 `is-burning`（140ms 燃尽淡出）与粒子
  交叉；切换时 root 锁定 `min-height = max(旧, 新)`，避免内容层切换引起卡壳跳动。
- **采样**（`measureJourneyGuideTextNode` / `drawJourneyGuideSample` /
  `sampleJourneyGuideContent`）：逐字符 Range → 行盒归并；离屏 canvas（DPR≤2）以
  `textAlign=left`、`textBaseline=alphabetic` 绘制，x=行盒 left，baseline=行盒 top +
  `fontBoundingBoxAscent("国")`；按钮按元素 rect + computed `border-radius` 画底板；
  新内容在 opacity 0 且仍排版时采样。位图交给纯函数
  `sampleJourneyGuideParticles`（2.6px 网格、四象限 alpha、加权重心、size 0.98×step）。
- **时间线**（`useLayoutEffect([fx])`，token + 计时器表保证取消/清理）：
  - switch：采样旧/新 → 生成 `is-out` 粒子；237ms 后生成 `is-in`；611ms 内容淡入；
    782ms 清空粒子层、释放 min-height、`setFx(null)`。
  - enter：采样 → `is-in`；374ms 内容淡入；575ms 清理。
  - exit：采样 → `is-out` + 内容 `is-burning` 140ms；563ms 清空粒子；卡壳由状态机 663ms
    后卸载。
- **粒子生成**：DOM `<span class="journey-guide-particle is-out|is-in">`，内联
  left/top/width/height/background 与 `--p-*` 变量；`Math.random()` 只在这里用于飞散方向/
  距离/错峰/时长抖动（out 0.9–1.0×、in 0.9–1.05×），只在客户端 effect 内执行。
- **纯几何模块** `lib/journey-guide-particles.ts`：常量 + `groupJourneyGuideTextLines` +
  `sampleJourneyGuideParticles`，node:test 直接断言。

### CSS

`app/globals.css` journey 段：

- `.journey-guide-card { position: relative; }`（不声明动画）；`.journey-guide-root` 相对
  定位承载内容层/粒子层。
- `.journey-guide-content-outgoing` 绝对定位；`.is-burning` 播 `journey-guide-content-burn`
  140ms。
- `.journey-guide-particles` 绝对铺满、`z-index: 3`、`pointer-events: none`、
  `overflow: visible`。
- `journey-guide-content-dissolve`：0/10/30% 原地驻留，58% 半程上浮，100% 熄灭；
  `journey-guide-content-reform`：从 `--p-from-*` 聚拢，82% 到位，100% 交叉淡出交给实体内容。
- reduce 块：卡壳 `animation/transform: none` + `opacity: 1`；内容
  `animation/transition: none` + `opacity: 1`；粒子 `display: none` + `animation: none`。
- 旧的整卡 keyframes（card-in/switch/out、particle-out/in）已删除，避免与最终设计并存的
  过时规则。

## 基线无改动行为

- `lib/journey-state.ts` 推导、`hooks/useChannelData.ts` 轮询、服务端/API/数据库未改；
  无新依赖、无新路由。
- 既有引导卡文案/按钮/秘书入口门控/Tasks badge 测试全部保持通过；`@keyframes` 只增不改
  （新增 dissolve/reform/burn 三组，删除本票首版遗留的整卡三组）。
- 既有 reduce 全局 reset 未削弱；本票更具体的 reduce 规则只覆盖自己的选择器。

## 红 → 绿

- **首版红**：`evidence/red-unit-tests.log`（先写测试、在未实现代码上跑，4 条失败）。
- **打回红**：`evidence/rework-red-unit-tests.log` →
  `TypeError: initialJourneyGuideState is not a function`。
- **跨频道红**：`evidence/rework-red-run{1,2,3}.log/json`（旧实现 3/3 RED，B 首张流内卡
  `describe / switch`）。
- **最终绿**：
  - `evidence/final-narrow-gate.log` → `tests 88 / pass 88 / fail 0`；
  - `evidence/final-typecheck.log` → 0 error；
  - `evidence/final-lint.log` → 0 error（仅既存 `hooks/useI18n.tsx:61` warning）；
  - 跨频道 `evidence/cross-channel-run{1,2,3}.log/json` → 3/3 GREEN；
  - 主探针 `evidence/after.log` → `VERDICT GREEN (0 failure(s))`。

新增测试覆盖：卡壳静止（section 无动画类/内联 animation/transform/opacity）、SSR 只渲染空
粒子层（无坐标、两次渲染一致）、行盒归并与合成位图采样（含确定性/加权重心）、enter/
switch/exit 状态机、跨频道快照归属、连续切换、reduce 规则与新 keyframes。

## 浏览器真实证据（ego-browser）

探针 `.scratch/journey-card-transition/probe.ego.mjs`：自建**私有**频道 + 消息 + 任务，
用本地 HTTP 依次制造 claim → in_review → done；另建 reduce 频道与 300px 窄视口频道。
隔离实例：`WORKSPLICE_DATA_DIR=/tmp/ws-journey-card-transition PORT=30199
./node_modules/.bin/next dev -H 127.0.0.1 -p 30199`，未触碰 `~/.worksplice` 与用户 30142。

| 断言 | 实测（`evidence/after.log`） |
| --- | --- |
| 卡壳（enter/dissolve/reform/exit/final） | `animation-name: none`、`opacity: 1`、`transform: none`，class 仅 `journey-guide-card` |
| 切换消散 | 884 个 `is-out`，`journey-guide-content-dissolve`；旧内容层 `is-burning`（140ms 燃尽）；新内容 opacity 0 |
| 重聚 | 692 个 `is-in`，`journey-guide-content-reform`；新内容文案已是「去复核」 |
| 结束态 | `fx.children.length = 0`、无旧内容层、内容 opacity 1 |
| 连续两次切换 | 第二次开始前 fx=0 / outgoing=0；结束后同样清零 |
| 对齐（宽） | 标题行四边偏差 ≤1.29px；hint 行 ≤0.81px；按钮底板 ≤0.93px |
| 对齐（窄 300px，hint 折 2 行） | 3 行逐行 ≤1.29px；按钮同样通过 |
| 退场 | 内容 `journey-guide-content-burn` + `is-burning`，692 个消散粒子，播完卸载 |
| reduce | 首现与切换均 `fx=0`、粒子元素 0、内容 opacity 1 |
| aria-label 序列 | 「等待交接或认领」→「让它跑」→「去复核」→ 卸载 |
| console.error / hydration | 0 条 / 0 条 |

截图：`after-00-initial.png`、`after-01-enter-mid.png`（重聚进入）、
`after-02-switch-dissolve-mid.png`（消散驻留）、`after-04-switch-final.png`、
`after-05-switch2-reform-mid.png`（重聚中段）、`after-06-exit-mid.png`（内容燃尽）、
`after-07-done-gone.png`、`after-08-reduce-initial.png`、`after-09-reduce-switch.png`、
`after-10-narrow-wrapped-dissolve-mid.png`（窄容器逐行粒子）。

取证细节（如实记录）：ego 的截图在粒子密集时可能耗时 1s+，超过 782ms 的清理窗口。探针在
文档创建时注入 `setTimeout` 放缓（仅 200–900ms 的延时 ×8），把状态机清理点推后到截图
之后；CSS duration/关键帧/布局/采样参数一律未改，截图冻结帧仍是真实动画中间帧（探针只
冻结粒子与 burn 动画，不碰内容 opacity transition）。该注入写在探针里，不进产品代码。

跨频道证据：`evidence/cross-channel-run{1,2,3}.json/log`（3/3 GREEN，B 首张流内卡
`handoff / enter`；header 切换后的 900ms 泄漏窗内无 A 的「去复核」，B 自己的首张卡
最多等 6s——首次取数受浏览器负载影响，不作为产品 SLA）；截图
`cross-01-channel-b-no-card.png`、`cross-02-channel-a-card.png`。

## 验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `node --test components/ChannelView.test.mjs app/globals.test.mjs` | **88 pass / 0 fail**（`evidence/final-narrow-gate.log`） |
| `npm run typecheck` | 0 error（`evidence/final-typecheck.log`） |
| `npm run lint` | 0 error，仅既存 `hooks/useI18n.tsx:61` warning（`evidence/final-lint.log`） |
| ego 主探针 | 1× GREEN（`evidence/after.log` / `after.json`） |
| ego 跨频道探针 | 3/3 GREEN（`evidence/cross-channel-run{1,2,3}.log/json`） |

本票按窄档未跑全量 `npm test`（票据明确「本票不跑」）。

## Review（双轴 code-review，对 origin/main...worktree）

说明：并行子代理运行超过 7 分钟仍无输出，先后两次被停止；改为在主管上下文按同一
Standards / Spec 双轴清单逐项核对（diff 为 `git diff origin/main -- components/ChannelView.tsx
lib/journey-guide-particles.ts app/globals.css components/ChannelView.test.mjs app/globals.test.mjs`）。

### Standards

| # | 级别 | Finding | 处置 |
| --- | --- | --- | --- |
| S1 | 违反仓库约束（硬） | `JourneyGuideView.generation` 的注释仍写「作为 key 强制重播 CSS 动画」，与最终设计（作为 prop 驱动 layout effect，不换 key）相反。spec 约束「不写与实现相反的注释」。 | **已修**：注释改为「作为 prop 驱动一次内容过渡（同一实例内重播，不换 key）」。 |
| S2 | 判断项 | `JourneyGuideContentLayer` 用 4 个布尔 prop（`accessible`/`clickable`/`burning`/`outgoing`），有 boolean blindness 嫌疑。 | **接受**：`accessible` 与 `clickable` 在 enter 期间必须分离（可读不可点），其余各对应一个明确语义；改成配置对象只增加样板。 |
| S3 | 判断项 | `ChannelView.tsx` 本票净增约 665 行，文件已很大（Divergent Change 风险）。 | **接受**：仓库既有结构把 ChannelView 子组件集中在该文件；确定性几何已抽到 `lib/journey-guide-particles.ts`，继续拆分超出本票 Ownership。 |
| S4 | 判断项 | `completeJourneyGuideExit` 是薄包装，仅被状态版与测试使用。 | **接受**：与 `completeJourneyGuideExitState` 成对，单测直接覆盖该纯函数；删除会让测试改走不透明路径。 |

### Spec

| # | 级别 | Finding | 处置 |
| --- | --- | --- | --- |
| P1 | 实现与 spec 文本不一致 | 内联 review 发现：切换瞬间旧内容层直接 `opacity: 0`，粒子在 10% 前还有 60–140ms 延迟，出现空白帧。 | **已修**：旧内容层播 `is-burning` 140ms 燃尽淡出，与粒子淡入交叉（`app/globals.css`、`components/ChannelView.tsx`）。 |
| P2 | 文档与实现不一致 | 本票 spec 验收仍写「旧内容层立即让位（opacity 0）」，与 P1 的最终实现相反。 | **已修**：spec 改为「140ms 燃尽淡出（与粒子交叉后 opacity 0）」。 |
| P3 | 探针假设错误（非产品回归） | 跨频道探针把「B 首张卡在 900ms 内到达」当断言；浏览器负载高时数据晚到导致 run2 误红（`firstStream: null`，header 17ms 已切换、无 A 卡泄漏）。 | **已修**：900ms 只作泄漏窗（A 的「去复核」不得出现），B 首张卡最多等 6s 再断言 `handoff / enter`；重跑 3/3 GREEN。 |
| P4 | 判断项 | reduce 下退场仍等状态机 663ms 才卸载（静止终态，无粒子/位移）。 | **接受**：spec 只要求「无可见粒子/位移，内容立即终态」，未要求立即卸载；不为此扩大状态机改动。 |
| P5 | 判断项 | 切换瞬间 `aria-label` 已是新标题，而旧内容视觉上还在燃尽 140ms。 | **接受**：可访问名称始终等于「当前形态标题」，瞬时视觉交叠不改变语义契约。 |

Spec 其余条目（参数表、DOM 采样、确定性/SSR、粒子清理、连续切换、跨频道作用域、
reduce、测试与证据）逐项核对均已落实；未发现 scope creep（未改 journey 推导、轮询、
服务端、i18n 文案与视觉 token）。

## 未完成项

- 无。

## PR

- 分支：`journey-card-transition`
- PR body：`.scratch/journey-card-transition/pr-body.md`
- PR 号：**#208** — https://github.com/whutlichao/worksplice/pull/208
