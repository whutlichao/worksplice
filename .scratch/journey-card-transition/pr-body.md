## Summary

消息页旅程引导卡在四种形态（describe / handoff / running / review）之间切换时播放一次
「粒子消散 → 重聚」；`guideKind` 变为 `null` 时先消散退场再卸载。

```diff
 components/ChannelView.tsx
   JourneyGuideCard
+    phase="enter | switch | exit"          # 本次渲染的动画语义
+    <JourneyGuideParticles>                # 12 个确定性 DOM 粒子，aria-hidden
+  nextJourneyGuideView(prev, kind)         # 纯状态机：enter / switch / exit
+  completeJourneyGuideExit(view)           # 只清退场中的视图
+  JourneyGuideState + sync/advance/…       # 按频道作用域；等新频道数据快照后再起算
+  useJourneyGuideView(scope, kind, snap)   # guideKind→null 保留卡面 340ms
   ChannelView
-    {journey.guideKind && <JourneyGuideCard … />}
+    {guideView && <JourneyGuideCard key={generation} phase={…} … />}

 app/globals.css
+  @keyframes journey-guide-card-{in,switch,out}
+  @keyframes journey-guide-particle-{out,in}
+  .journey-guide-* 过渡类 + reduce 规则（粒子 0.001s、卡面立即终态）
```

状态机：

```text
nextJourneyGuideView(prev, kind)
  kind === null
    prev 为空或已在退场 → 原样返回（不重播）
    否则               → { kind: prev.kind, phase: exit }，340ms 后卸载
  kind !== null
    prev 为空          → { kind, phase: enter }
    kind 未变且非退场  → 返回同一引用（不重渲染 / 不重播）
    否则               → { kind, phase: switch }（退场中改回也走这里）
```

切频道时 `scope` 变化 → 先丢弃旧 view 并等待新频道数据快照（`messages` 数组引用换新）
再起算：该频道首张卡必定 `enter`，后续同频道变化才 `switch`；不会用上一频道的残留
数据推出 `switch`。这是数据归属判断，不是 sleep/延时。

## Evidence

- **Before:** `evidence/red-unit-tests.log` — 新增断言在未实现时 4 条失败（粒子层缺失、
  阶段类名缺失、状态机未导出、keyframes 缺失）。
  **After:** `evidence/narrow-gate.log` — `node --test components/ChannelView.test.mjs
  app/globals.test.mjs` 84 pass / 0 fail；打回修复后新增 2 条状态机测试 →
  `evidence/rework-narrow-gate.log` 86 pass / 0 fail；`typecheck.log` / `lint.log` 0 error
  （仅既存 `useI18n.tsx` 一条 warning）。
- **Before:** 卡面整块瞬间替换，无过渡、消失时瞬间卸载。
  **After:** ego 探针 `evidence/after.log` → GREEN：切换时卡面
  `animation-name=journey-guide-card-switch`、粒子
  `journey-guide-particle-out, journey-guide-particle-in`（非 none）；冻结 150ms 截到消散
  中段（`after-01-switch-running-mid.png`，粒子 opacity 0.44）；终态 opacity 1、transform
  无位移、粒子不可见（`after-02-running-final.png`）；退场中截图 `after-04-exit-mid.png`，
  播完卸载（`after-05-done-gone.png`）。
- reduce：CDP `Emulation.setEmulatedMedia` 强制 `prefers-reduced-motion: reduce` →
  粒子 computed `animation-duration: 0.001s`、opacity 0；卡面 opacity 1 且内容可见
  （`after-03-reduce-review.png`）。
- aria-label 序列：「等待交接或认领」→「让它跑」→「去复核」→ 无；`console.error` 0 条、
  hydration 警告 0 条。
- 跨频道（review 追加 + 打回修复）：旧实现切到无卡频道 B 时首张流内卡面是残留的
  `describe / switch`（`evidence/cross-channel-red.log` → RED）。首版作用域修复后单次
  GREEN，但打回复跑发现仍有竞态：切频道首帧数据仍属上一频道，B 的首张卡可能被算成
  `switch`（`evidence/rework-red-run{1,2,3}` → **RED 3/3**）。返工改为按数据快照归属
  起算后，跨频道探针 **3/3 GREEN**（`evidence/rework-green-run{1,2,3}`）：B 首张流内卡面
  `handoff / enter`，900ms 采样内从未出现 A 的「去复核」，切回 A 也是 `enter`。

## Merge Danger

**Door:** two-way —— 纯前端动效与局部状态，回滚只需 revert 本票提交；不改数据、接口、
轮询、journey 推导或既有文案。

**Blast Radius:** 单组件 + 一段 CSS。动画只动 transform / opacity，不参与布局，不影响
消息流、任务板与其他页面；粒子层 `aria-hidden` 且 `pointer-events: none`。
