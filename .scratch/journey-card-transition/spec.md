# 旅程引导卡形态切换过渡（内容燃尽 → 重聚）

- **Status**: Done（2026-10-23 最终设计复验通过；同日跨频道探针语义打回补修后 3/3 GREEN）
- **票型**: 实施票
- **门禁**: G-impl
- **分支 / worktree**: `journey-card-transition`
- **前置 skill**: `implement`（开工前完整阅读并按其流程执行）+ `tdd` + `code-review` + `pr`

## Problem Statement

消息页的旅程引导卡（`JourneyGuideCard`，四种形态 describe / handoff / running / review）
在任务状态推进时被整块替换：内容、标题和按钮在同一帧直接换掉，读起来像页面抖动而不是
一次状态推进。用户看不到「上一形态结束、下一形态开始」的连续性，也没有任何动效提示卡面
已经更新；卡面因全部任务完成而消失时同样是瞬间卸载。

## Solution（最终设计：只动内容层）

卡壳（边框、背景、圆角、阴影、宽高、位置）全程静止，不挂任何整卡动画；**只有内容层**
（标题 / hint / CTA）参与过渡：

- **切换**（同频道 kind 变化）：旧内容先燃尽成粒子（原位短暂停留 → 向上/向外飘散并熄灭），
  旧内容层本身在 140ms 内燃尽淡出，与粒子淡入交叉（不留空白帧/叠字）；新内容由粒子从
  四周聚拢成文字/按钮形状，实体内容在重聚约 90% 时开始淡入接管；粒子在结束后从 DOM
  移除。切换期间同时只保留一层可交互内容（新内容重聚前不可见/不可点）。
- **首次出现**（含切频道后的首张卡）：内容按「重聚进入」播放。
- **退场**（guideKind→null）：内容燃尽后由状态机卸载卡壳；卡壳本身不做整卡退场动画。

固定参数（写死在 `lib/journey-guide-particles.ts`，不提供 UI 调节）：

| 参数 | 值 |
| --- | --- |
| 采样密度 | 2.6px 网格（细） |
| 速度 | 1.35×（基准 760 / 320 / 560ms） |
| 消散 | 563ms（760 / 1.35） |
| 消散 → 新内容快照的等待 | 237ms（320 / 1.35） |
| 重聚 | 415ms（560 / 1.35） |
| 实体内容开始淡入 | 重聚约 90%（374ms），淡入 140ms |

采样与几何全部以 DOM 排版为准：

- 逐字符 `document.createRange().getBoundingClientRect()`，按 `top` 归并为真实行盒
  （折行/居中交给浏览器，不自算宽度）。
- 离屏 canvas 以 `textAlign=left`、`textBaseline=alphabetic` 绘制：x = 行盒 left，
  baseline = 行盒 top + `ctx.measureText(...).fontBoundingBoxAscent`；按钮底板按元素
  rect + computed `border-radius` 绘制。
- 2.6px 网格取四象限 alpha（0.25/0.75），落点为 alpha 加权重心（不是格子中心），
  颜色/透明度取加权 alpha；新内容在 opacity 0 且仍参与排版时采样。

确定性与可访问性：

- 粒子坐标来自 DOM 文本 + 固定网格；随机只用于飞散方向/错峰，且只在客户端 effect 内，
  SSR 不产出任何粒子坐标；几何收敛为 `lib/journey-guide-particles.ts` 纯函数。
- 粒子层 `aria-hidden="true"`、`pointer-events: none`；可访问名称/焦点顺序/文案/i18n key/
  视觉 token 不变。
- `prefers-reduced-motion: reduce`：不产生可见粒子/位移，内容立即终态。
- 连续切换必须取消上一轮计时器并清理粒子（结束时 `fx.children.length === 0`）。

跨频道（打回修复保留）：切频道后首张卡必须按 `enter` 重建，不得沿用上一频道的卡面或
`switch` 相位；用 messages 数组引用做数据归属门控，不加 sleep/延时。

## Observable Acceptance

1. `node --test components/ChannelView.test.mjs app/globals.test.mjs` 全绿；新增断言：
   - 卡壳静止：阶段只进 `data-guide-phase`，`section` 不挂动画类/不写 animation/transform/opacity；
   - SSR 只渲染空粒子层（`aria-hidden`），不产出粒子坐标，两次渲染一致；
   - 纯几何：行盒归并（跨字符/容差）与网格采样（合成位图两带、加权重心、确定性）；
   - 引导卡过渡状态机（enter / switch / exit / 快照归属 / 连续切换）；
   - 新 keyframes 存在，reduce 块隐藏粒子并让内容立即终态。
2. `npm run typecheck` 与 `npm run lint` 通过。
3. 浏览器证据（隔离实例 30199 + `WORKSPLICE_DATA_DIR=/tmp/ws-journey-card-transition`）：
   自建私有频道「消息→任务」，经 HTTP 依次驱动 todo → in_progress → in_review → done；
   断言：
   - 切换期间卡壳 computed `animation-name=none`、`opacity=1`、`transform=none`；
   - 内容层粒子命中 `journey-guide-content-dissolve` / `journey-guide-content-reform`，
     旧内容层 140ms 燃尽淡出（与粒子交叉后 opacity 0），新内容重聚前 opacity 0；
   - 消散中段与重聚中段截图；结束态 `fx.children.length === 0`、内容 opacity 1、卡壳仍静止；
   - 粒子墨迹与 DOM 行盒/按钮矩形的对齐 ≤1.5px；窄容器下 hint 折行后逐行对齐；
   - 连续两次切换无粒子/旧内容残留；
   - reduce 下无可见粒子、内容立即终态；
   - aria-label 依次「等待交接或认领」→「让它跑」→「去复核」→ 卸载；console.error /
     hydration 警告 0。
   证据存 `.scratch/journey-card-transition/evidence/`。
4. 跨频道探针连续 3 次 GREEN（B 的 900ms 泄漏窗内无 A 卡；瞬时首卡若出现必为
   `handoff / enter`，稳定态无卡；确定性 handoff 频道 C 首卡 `enter / handoff`），
   主探针 1 次 GREEN。
5. 对本票 diff 跑一次双轴 `code-review`（Standards + Spec），findings 处置写进 Answer.md。
6. Answer.md 记录：行为变化、实现方案、基线无改动行为、证据路径、review 结论、未完成项。

## Constraints

- 不改 `lib/journey-state.ts` 推导、`hooks/useChannelData.ts` 轮询、服务端/API/数据库。
- 不引入依赖、不新增路由；粒子显示仍为确定性 DOM。canvas 只用于离屏采样，不用于渲染。
- `@keyframes` 只增不改；既有动画与 reduce 规则不得被削弱。
- 既有可观察契约不变：`section[aria-label]` 仍是当前形态标题；标题/hint/按钮文案与
  i18n key 不变；卡片宽度、字号、间距等视觉 token 不变；焦点顺序不变。
- 渲染期禁止 `Math.random()`；不得造成 SSR/hydration 警告。
- 注释语言与周边一致（中文），不写与实现相反的注释。

## Out of Scope

- 全量 `npm test`（窄档失败需要定位时再按失败文件补跑）。
- G-docs / G-spec / G-tickets 门禁。
- `.scratch/task-card-poll-sync/` 既有票据与证据、用户主工作副本（main）。

## Testing Decisions

- 测试档：窄（受影响测试 + 指定文件）。选择器：
  `node --test components/ChannelView.test.mjs app/globals.test.mjs`，加 `npm run typecheck`、
  `npm run lint`。
- 组件测试走既有 `renderToStaticMarkup` + `I18nProvider`；纯几何/状态机单独做纯函数单测。
- 浏览器证据用 ego-browser（仓库浏览器纪律），步骤与 `task-card-poll-sync` 探针同源。

## Ownership

- 可编辑：`components/ChannelView.tsx`、`lib/journey-guide-particles.ts`、`app/globals.css`、
  `components/ChannelView.test.mjs`、`app/globals.test.mjs`，以及本目录下的票据、证据与 PR body。

## 打回修复（2026-10-23，跨频道首张卡 enter）

- **问题**：协调者在隔离环境连续 3 次复跑 `probe-cross-channel.ego.mjs` 均 RED——频道 B
  的第一张流内卡片是 `handoff` 且 `data-guide-phase="switch"`，与「切频道后首张卡必须
  `enter`」矛盾。
- **根因**：ChannelView 不按频道重挂载；切换首帧 `useChannelData` 仍持有上一频道的
  messages/tasks（其切换 effect 在提交后才清空或命中缓存），旧实现用这帧的 kind 起算，
  形成 `enter(旧 review) → exit → switch(handoff)`。数据到达顺序不同导致时好时坏。
- **修复**：过渡状态机增加数据快照归属判断（`JourneyGuideState.snapshot` = messages 数组
  引用）。切频道先进入 `awaitingSnapshot` 并丢弃旧 view，快照换新后才用
  `nextJourneyGuideView(null, kind)` 起算首张卡（enter）；后续同频道变化才 switch。
  不使用 sleep/延时，不改 journey 推导与轮询频率。
- **复验（最终实现）**：跨频道探针 3/3 GREEN（`evidence/cross-channel-run{1,2,3}.log/json`，
  900ms 内无 A 的「去复核」；瞬时首卡若出现必为 `handoff / enter`，稳定态无卡）；主探针
  1× GREEN；窄门 88 pass / 0 fail；typecheck 0 error；lint 0 error（仅既存
  `useI18n.tsx:61` warning）。
- **红证据**：旧实现 3/3 RED（`evidence/rework-red-run{1,2,3}.log/json`）；新增状态机测试
  在旧实现上失败（`evidence/rework-red-unit-tests.log`）。

## 打回补修（2026-10-23，跨频道探针语义）

- **复现**：coordinator 在最终 head `0766af78` 的隔离实例连续复跑旧探针 **1 RED / 2 GREEN**。
  RED 失败项为「切到频道 B 后 6s 内未出现消息流卡面」，该次 `leakWindowCards=0`、
  `leakLabels=[]`（无 A 卡泄漏，只是 B 全程无卡）。本地用旧断言语义的临时副本复跑
  6/6 GREEN（`evidence/old-probe-semantics-6x.log`），说明这是数据到达顺序的竞态窗口，
  不是稳定失败。
- **根因**：频道 B 稳定态为「1 条消息 + 1 个 done 任务」，`deriveJourneyState` 返回
  `guideKind: null`（`lib/journey-state.ts:62-64`），本来就不该有卡；瞬时 handoff 卡只存在于
  「消息先到、任务快照后到」的中间态。旧探针把“必须有瞬时卡”当成规格，比本票 Acceptance
  更严。
- **探针语义**：B 只断言 900ms 泄漏窗无 A 卡 + 稳定终态无卡；瞬时卡若出现必须
  `enter / handoff`，缺席合法。新增确定性频道 C（只有消息、没有任务），断言首卡必为
  `enter / handoff`。未发现产品缺陷，产品代码与既有测试未改。
- **复验**：新探针 3/3 GREEN（`evidence/cross-channel-run{1,2,3}`；三次瞬时卡 t=77–149ms，
  `B final` 均 `anyCards=0`；C 首卡 t=66–131ms）；主探针 1× GREEN。
