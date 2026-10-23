## Summary

消息页旅程引导卡（describe / handoff / running / review）切换时只让**内容层**燃尽再重聚，
卡壳保持完全静止；`guideKind` 变为 `null` 时内容先燃尽，再由状态机卸载卡壳。

- 卡壳不挂 animation / transform / opacity，阶段只写 `data-guide-phase`。
- 切换：旧内容消散成粒子（原位驻留 → 上浮熄灭），新内容由粒子聚拢成形后实体淡入；
  旧内容层 140ms 燃尽淡出，与粒子淡入交叉，避免空白帧与叠字；粒子结束从 DOM 移除。
- 首现（含切频道首张卡）按 enter 重聚进入；退场无整卡动画。
- 固定参数：2.6px 网格、1.35×（消散 563ms / 等待 237ms / 重聚 415ms / 90% 处开始
  140ms 淡入）。
- `prefers-reduced-motion: reduce`：无可见粒子/位移，内容立即终态。

```diff
 components/ChannelView.tsx
   JourneyGuideCard
+    generation / phase="enter | switch | exit"   # 同一实例内可重播，不换 key
+    JourneyGuideContentLayer                    # 标题/hint/按钮；旧内容同构副本
+    JourneyGuideFxState + 时间线 effect          # 消散/重聚/清理，token 取消
+  measure / draw / sample                       # Range 行盒 + 离屏 canvas + 网格采样
+  nextJourneyGuideView + JourneyGuideState      # 按频道作用域；等新频道数据快照后再起算
+  useJourneyGuideView(scope, kind, snapshot)

 lib/journey-guide-particles.ts   (new)
+  groupJourneyGuideTextLines                    # 逐字符行盒归并（纯函数）
+  sampleJourneyGuideParticles                   # 2.6px 网格、四象限 alpha、加权重心

 app/globals.css
+  @keyframes journey-guide-content-{dissolve,reform,burn}
+  .journey-guide-content / -outgoing / -particles + reduce 规则
```

状态机（沿用打回修复）：

```text
nextJourneyGuideView(prev, kind)
  kind === null
    prev 为空或已在退场 → 原样返回（不重播）
    否则               → { kind: prev.kind, phase: exit }，663ms 后卸载
  kind !== null
    prev 为空          → { kind, phase: enter }
    kind 未变且非退场  → 返回同一引用（不重渲染 / 不重播）
    否则               → { kind, phase: switch }（退场中改回也走这里）
```

切频道时 `scope` 变化 → 先丢弃旧 view 并等待新频道数据快照（`messages` 数组引用换新）
再起算：该频道首张卡必定 `enter`，后续同频道变化才 `switch`。这是数据归属判断，
不是 sleep/延时。

## Evidence

- **单元/几何**：`evidence/final-narrow-gate.log` — `node --test
  components/ChannelView.test.mjs app/globals.test.mjs` **88 pass / 0 fail**（卡壳静止、
  SSR 空粒子层无坐标、行盒归并/网格采样确定性、状态机与快照归属、reduce 规则）；
  `final-typecheck.log` 0 error；`final-lint.log` 0 error（仅既存 `useI18n.tsx` 一条
  warning）。红证据：`evidence/red-unit-tests.log`、`rework-red-unit-tests.log`。
- **主探针**：`evidence/after.log` → `VERDICT GREEN`。卡壳在消散/重聚/退场/终态均为
  `animation-name: none / opacity: 1 / transform: none`；消散 884 粒子
  `journey-guide-content-dissolve`，旧内容 opacity 0；重聚 692 粒子
  `journey-guide-content-reform`；结束态 `fx.children.length === 0`、内容 opacity 1；
  连续两次切换无残留；退出时内容 `journey-guide-content-burn`。
  截图：`after-02-switch-dissolve-mid.png`、`after-05-switch2-reform-mid.png`、
  `after-06-exit-mid.png`、`after-10-narrow-wrapped-dissolve-mid.png` 等。
- **对齐**：冻结在消散驻留段，粒子墨迹 bbox vs「DOM 行盒 + canvas 字体度量」/按钮矩形，
  宽视口四边 ≤1.30px、按钮 ≤0.93px（容差 1.5px）；300px 窄视口 hint 折 2 行后逐行
  ≤1.30px。
- **reduce**：CDP 强制 `prefers-reduced-motion: reduce` → 首现/切换均 `fx=0`、粒子元素
  0、内容 opacity 1（`after-08-reduce-initial.png` / `after-09-reduce-switch.png`）。
- **跨频道**：`evidence/cross-channel-run{1,2,3}` → **3/3 GREEN**。header 切换后 900ms
  泄漏窗内无 A 的「去复核」；B（消息 + done 任务）稳定态本就不该有卡——瞬时 handoff 卡
  只存在于数据到达顺序的中间态，出现则必须 `enter`，缺席同样合法，6s 观测后断言稳定
  终态无卡；新增确定性 handoff 频道 C（只有消息、没有任务），首卡必为 `enter / handoff`；
  切回 A 也是 `enter`。旧实现红证据 `rework-red-run{1,2,3}`（3/3 RED）。
- aria-label 序列「等待交接或认领」→「让它跑」→「去复核」→ 卸载；`console.error` 0、
  hydration 警告 0。

取证说明：ego 截图在粒子密集时可能耗时 1s+，探针在文档创建时把 200–900ms 的
`setTimeout` ×8 放缓，使状态机清理点落在截图之后；CSS duration/关键帧/布局/采样参数
未改，冻结帧仍是真实动画中间帧。注入只在探针内，不进产品代码。

## Merge Danger

**Door:** two-way —— 纯前端动效与局部状态，回滚只需 revert 本票提交；不改数据、接口、
轮询、journey 推导或既有文案。

**Blast Radius:** 单组件 + 一段 CSS + 一个纯函数模块。动画只在内容层，卡壳不参与布局，
不影响消息流、任务板与其他页面；粒子层 `aria-hidden` 且 `pointer-events: none`。
