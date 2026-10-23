# 旅程引导卡形态切换过渡（粒子消散→重聚）

- **Status**: Done
- **票型**: 实施票
- **门禁**: G-impl
- **分支 / worktree**: `journey-card-transition`
- **前置 skill**: `implement`（开工前完整阅读并按其流程执行）+ `tdd` + `code-review` + `pr`

## Problem Statement

消息页的旅程引导卡（`JourneyGuideCard`，四种形态 describe / handoff / running / review）
在任务状态推进时被整块替换：内容、标题和按钮在同一帧直接换掉，读起来像页面抖动而不是
一次状态推进。用户看不到「上一形态结束、下一形态开始」的连续性，也没有任何动效提示卡面
已经更新；卡面因全部任务完成而消失时同样是瞬间卸载。

## Solution

为引导卡增加一次性的形态切换过渡，视觉语义是「粒子消散再重聚」：

- 任一次 `kind` 变化（handoff→running、running→review 等）播放一次消散→重聚序列，
  同时新卡面淡入/轻微缩放；切换瞬间由粒子密度掩盖内容替换，不出现两张完整卡片叠加。
- `guideKind` 变为 `null` 时先播消散退场再卸载（ChannelView 用局部状态短暂保留最后一张
  卡面的 kind，时长与退场动画一致；该状态只服务动画，不改 journey 推导）。
- 首次出现（null→某形态）播放重聚进入。
- 动画总时长 ≤900ms，只动 `transform` / `opacity`（可少量 `filter: blur`），不引起消息流
  布局抖动；结束后卡面处于最终稳定态（opacity 1、无位移、粒子不可见）。

粒子用 DOM 元素实现（8–16 个，不使用 canvas、不引入动画库/新依赖）。位置、角度、延迟
全部由索引确定性推导，渲染期禁止 `Math.random()`；粒子层 `aria-hidden="true"`。

`prefers-reduced-motion: reduce` 下不出现可见粒子位移/缩放，卡面内容立即处于最终态；
需确认 `app/globals.css` 既有全局 reduce reset 覆盖新增动画。

## Observable Acceptance

1. `node --test components/ChannelView.test.mjs app/globals.test.mjs` 全绿；新增断言：
   - 四种 kind 均渲染粒子层（稳定 data 属性/类名）且 `aria-hidden`；
   - 粒子数量与 markup 确定性（同一输入两次渲染完全一致）；
   - 过渡纯状态机（`nextJourneyGuideView`）的进入/切换/退场/重入路径；
   - 新增 keyframes 存在，reduce 块覆盖粒子动画时长。
2. `npm run typecheck` 与 `npm run lint` 通过。
3. 浏览器证据（隔离实例 30199 + `WORKSPLICE_DATA_DIR=/tmp/ws-journey-card-transition`）：
   自建私有频道「消息→任务」，经 HTTP 依次驱动 todo → in_progress → in_review → done；
   切换后粒子层 computed `animation-name` 命中本票 keyframes（非 none）；切换瞬间与终态截图；
   CDP 强制 `prefers-reduced-motion: reduce` 后粒子层 computed `animation-duration` 为
   `0.001s` 且卡面内容可见；终态 aria-label 依次为「让它跑」→「去复核」→ 卡消失。
   证据存 `.scratch/journey-card-transition/evidence/`。
4. 对本票 diff 跑一次双轴 `code-review`（Standards + Spec），findings 处置写进 Answer.md。
5. Answer.md 记录：行为变化、实现方案、基线无改动行为、证据路径、review 结论、未完成项。

## Constraints

- 不改 `lib/journey-state.ts` 推导、`hooks/useChannelData.ts` 轮询、服务端/API/数据库。
- 不引入依赖，不用 canvas/WebGL/动画库，不新增路由。
- `@keyframes` 只增不改；既有动画与 reduce 规则不得被削弱。
- 既有可观察契约不变：`section[aria-label]` 仍是当前形态标题；标题/hint/按钮文案与
  i18n key 不变；卡片宽度、字号、间距等视觉 token 不变。
- 粒子位置确定性，禁止渲染期 `Math.random()`；不得造成 SSR/hydration 警告。
- 注释语言与周边一致（中文），不写与实现相反的注释。

## Out of Scope

- 全量 `npm test`（窄档失败需要定位时再按失败文件补跑）。
- G-docs / G-spec / G-tickets 门禁。
- `.scratch/task-card-poll-sync/` 既有票据与证据、用户主工作副本（main）。

## Testing Decisions

- 测试档：窄（受影响测试 + 指定文件）。选择器：
  `node --test components/ChannelView.test.mjs app/globals.test.mjs`，加 `npm run typecheck`、
  `npm run lint`。
- 组件测试走既有 `renderToStaticMarkup` + `I18nProvider`；纯状态机单独做纯函数单测。
- 浏览器证据用 ego-browser（仓库浏览器纪律），步骤与 `task-card-poll-sync` 探针同源。

## Ownership

- 可编辑：`components/ChannelView.tsx`、`app/globals.css`、
  `components/ChannelView.test.mjs`、`app/globals.test.mjs`，以及本目录下的票据、证据与 PR body。
