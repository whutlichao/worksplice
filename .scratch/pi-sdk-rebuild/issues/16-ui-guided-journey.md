# 16 — UI B·Guided Journey 首版

**What to build:** 新用户首访不被 11 概念淹没：中央一次呈现概念 11→≤4——旅程条 4 步常显（describe → hand off → let it run → review，按频道状态显隐）、强空状态卡引导（无消息→"描述任务"；有消息无任务→"转为任务 @agent 交接"；任务进行中→"让它跑"看状态点；待审核→"去复核"）、reaction/pinned/附件收进 `···` 二级、任务板中央 Tab 保留 + badge 引导切换；首访空状态默认入口 = 秘书五步流（建频道+建 agent+首条消息闭环）。保留三栏骨架与现有路由薄封装，`ChannelView` 不拆文件。

**Blocked by:** 15 — round_logs 三列 + SCHEMA v12 + 成本看板双视图（地图/ADR-0009 排期：UI 首版随三期验证）

**Status:** ready-for-agent

- [ ] 旅程条 4 步按频道状态显隐（无消息/有消息无任务/任务进行中/待审核），文案口语化且与 `describe → hand off → let it run → review` 对应
- [ ] 空状态卡引导正确；首屏概念 ≤4（reaction/pinned/附件在 `···` 二级可达，功能不丢）
- [ ] 任务板中央 Tab 保留 + 有任务时 badge 引导切换，不藏进抽屉
- [ ] 秘书入口挂首访空状态（首卡），文案与 spec-bootstrap-agent 一致，不新增路由
- [ ] 组件渲染断言覆盖旅程条显隐/空状态卡/`···` 折叠/秘书入口（renderToStaticMarkup + jiti）；全量门禁 `tsc --noEmit + npm run lint + npm test`（347）全绿
- [ ] 手动⑤：`prototype-ui/index.html?variant=b` 走通 `describe→hand off→let it run→review`，秘书五步流首访闭环可演示