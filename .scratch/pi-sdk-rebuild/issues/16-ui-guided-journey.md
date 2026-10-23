# 16 — UI B·Guided Journey 首版

**What to build:** 新用户首访不被 11 概念淹没：中央一次呈现概念 11→≤4——旅程条 4 步常显（describe → hand off → let it run → review，按频道状态显隐）、强空状态卡引导（无消息→"描述任务"；有消息无任务→"转为任务 @agent 交接"；任务进行中→"让它跑"看状态点；待审核→"去复核"）、reaction/pinned/附件收进 `···` 二级、任务板中央 Tab 保留 + badge 引导切换；首访空状态默认入口 = 秘书五步流（建频道+建 agent+首条消息闭环）。保留三栏骨架与现有路由薄封装，`ChannelView` 不拆文件。

**Blocked by:** 15 — round_logs 三列 + SCHEMA v12 + 成本看板双视图（地图/ADR-0009 排期：UI 首版随三期验证）

**Status:** resolved（2026-10-23）

- [x] 旅程条 4 步按频道状态显隐（无消息/有消息无任务/任务进行中/待审核），文案口语化且与 `describe → hand off → let it run → review` 对应
- [x] 空状态卡引导正确；首屏概念 ≤4（reaction/pinned/附件在 `···` 二级可达，功能不丢）
- [x] 任务板中央 Tab 保留 + 有任务时 badge 引导切换，不藏进抽屉
- [x] 秘书入口挂首访空状态（首卡），文案与 spec-bootstrap-agent 一致，不新增路由
- [x] 组件渲染断言覆盖旅程条显隐/空状态卡/`···` 折叠/秘书入口（renderToStaticMarkup + jiti）；全量门禁 `tsc --noEmit + npm run lint + npm test`（本 worktree 1569 用例，1 项基线环境失败）全绿
- [x] 手动⑤：`prototype-ui/index.html?variant=b` 走通 `describe→hand off→let it run→review`，秘书五步流首访闭环可演示

## Answer

**依赖判断**：票面 `Blocked by: 15` 是排期依赖（地图/ADR-0009：UI 首版随三期验证），不是代码依赖。本票不需要 `round_logs` 成本列，在当前 `main`（3b86a28）上独立实施。

**状态推导（纯函数 `lib/journey-state.ts`）**：

```text
deriveJourneyState({ messageCount, tasks }) -> { step, guideKind, hasTasks, openTaskCount }
  无消息                                       -> step 1, describe
  有消息、无任务                               -> step 2, handoff（转最新消息）
  只有 todo（无 in_progress/in_review）        -> step 2, handoff（等待交接/认领）
  有 in_progress（无 in_review）               -> step 3, running
  有 in_review                                 -> step 4, review（最高优先）
  全部 done/closed                             -> step 4, guideKind=null（不再出卡）
openTaskCount = todo + in_progress + in_review（Tasks Tab badge，不含 done/closed）
```

**红证据（旧 UI）**：

```text
$ node --test lib/journey-state.test.mjs
ERR_MODULE_NOT_FOUND: lib/journey-state.ts

$ node --test components/ChannelView.test.mjs
ℹ tests 64  ℹ pass 54  ℹ fail 10
✖ 旅程条按四种频道状态标注当前步骤与已完成步骤
✖ 无消息引导卡：描述 CTA 聚焦输入，秘书入口可打开现有创建流程
✖ 有消息无任务引导卡：给出把消息转为任务的入口
✖ Central Tabs 保留 Messages/Tasks 切换，并为未完成任务显示数量 badge
✖ ··· 二级菜单展开后包含 reaction、pin、提醒与转为任务，门控与旧动作栏一致
…
```

**绿证据（新 UI）**：

```text
$ node --test lib/journey-state.test.mjs components/ChannelView.test.mjs
ℹ tests 72  ℹ pass 72  ℹ fail 0

$ npm run typecheck   -> exit 0
$ npm run lint        -> 0 errors, 1 warning（hooks/useI18n.tsx，基线既有）
$ npm test            -> tests 1569 / pass 1568 / fail 1
```

- 基线（HEAD 3b86a28 独立 worktree）：tests 1551 / pass 1550 / fail 1；最终 +18 用例。
- 唯一失败 `lib/model-listing.test.mjs » lite path returns a working runtime without loading extensions` 在基线 worktree 同样失败：宿主环境预置 DeepSeek 模型，lite 路径测试期望空列表。与本票改动无关（未碰模型/运行时）。
- 手动走查（临时 `WORKSPLICE_DATA_DIR` demo 库）：四态全部复现——空频道 step 1（描述卡 + 秘书入口；CTA 聚焦 composer，秘书入口打开现有 `CreateAgentModal`）→ 发消息 step 2（交接卡）→ 卡片转任务后 step 2 等待认领 → 认领 step 3（让它跑）→ 完成 step 4（去复核）；Tasks Tab badge `1` 可切换；`···` 菜单含 添加回应/置顶/提醒/转为任务，栏上回复/引用/复制链接仍可达。
- 原型 B 走查：`file://…/prototype-ui/index.html?variant=b` 载入，确认信息架构（旅程条 + 四态卡 + Tab badge + `···`）已借鉴；未复制其 brutalist CSS/2px 边框/配色，未采用右栏“下一步”常驻卡（首屏概念 ≤4）。

**双轴 review（`git diff HEAD`，HEAD=3b86a28）**：

- Standards：修 5 项——`journey.stepStatus` 单键插值替代 `t()+t()` 拼接并把 `aria-label` 移到 `li`；`AGENTS.md` File Map 补 `journey-state.ts`/ChannelView 新面；`JourneyState` 删除仅测试消费的 `hasOpenTodo/hasInProgress/hasInReview`；去掉 `MessageActions`/`MessageMoreMenu` 重复的 convert 门控（收敛回 `MessageRow` 单一表达式）；`guide` 改名 `guideKind`。保留 2 项：术语“复核”按本票验收原文（`docs/spec.md` 用“审查”，票面优先）；测试文件 4 空格沿用本文件既有风格。
- Spec：修 1 项——引导卡 CTA 改走 `selectTab("tasks")`，进任务板时清掉“仅看未读回复”筛选。记录 1 项边界：秘书入口按本票 brief 只复用 `CreateAgentModal`（不新增路由/五步流），文案用“让秘书搭第一间房”；`attachment` 按 brief 保持在消息内与 composer 回形针（未收进 `···`）。

**Door:** two-way（UI 可见行为变化；无数据/API/持久化变更）。

**PR:** #203（body: `.scratch/pi-sdk-rebuild/pr-16-body.md`）
