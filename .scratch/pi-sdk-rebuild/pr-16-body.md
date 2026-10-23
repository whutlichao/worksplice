## Summary

中央主视图从「11 个概念同屏」收到 **≤4**：顶部常显旅程条，空状态/当前状态给一张引导卡，Tasks 保留中央 Tab 并挂未完成数量 badge，消息 hover 只留高频动作、其余收进 `···`。三栏骨架、现有路由薄封装与 `ChannelView` 单文件边界不变。

```text
ChannelView
├─ CenterTabs                 Messages | Tasks(1)   ← badge = todo+in_progress+in_review
├─ JourneyBar                 描述 → 交接 → 让它跑 → 复核
├─ messages
│  ├─ MessageRow
│  │  └─ 回复 / 引用 / 复制链接 + ···（reaction / pin / 提醒 / 转为任务）
│  └─ JourneyGuideCard        四态之一；有消息时在流末尾，不遮挡消息
└─ Composer                   附件回形针 / As Task 原样
```

状态推导收进纯函数 `lib/journey-state.ts`（SSR 可测，无新后端接口）：

```text
deriveJourneyState({ messageCount, tasks })
  0 条消息                    → 1 describe
  有消息、无任务              → 2 handoff
  只有 todo                   → 2 handoff（等待交接/认领）
  有 in_progress              → 3 running
  有 in_review                → 4 review（最高优先）
  全部 done/closed            → 4，guideKind=null（不再出卡）
```

| 状态 | 旅程条 | 引导卡 CTA |
|---|---|---|
| 无消息 | 1 active | 描述任务（聚焦 composer）+ 让秘书搭第一间房（现有 `CreateAgentModal`） |
| 有消息无任务 | 2 active | 把最新消息转为任务（复用现有 Convert 路径） |
| 只有待办 | 2 active | 打开任务板（清“仅看未读”） |
| 进行中 | 3 active | 打开任务板 |
| 待审核 | 4 active | 打开任务板（去复核） |

## Evidence

**Before（旧 UI，红）**

```text
$ node --test lib/journey-state.test.mjs
ERR_MODULE_NOT_FOUND: lib/journey-state.ts

$ node --test components/ChannelView.test.mjs
ℹ tests 64  ℹ pass 54  ℹ fail 10
✖ 旅程条按四种频道状态标注当前步骤与已完成步骤
✖ 无消息引导卡：描述 CTA 聚焦输入，秘书入口可打开现有创建流程
✖ 有消息无任务引导卡：给出把消息转为任务的入口
✖ Central Tabs 保留 Messages/Tasks 切换，并为未完成任务显示数量 badge
✖ ··· 二级菜单展开后包含 reaction、pin、提醒与转为任务
```

**After（新 UI，绿）**

```text
$ node --test lib/journey-state.test.mjs components/ChannelView.test.mjs
ℹ tests 72  ℹ pass 72  ℹ fail 0

$ npm run typecheck   -> exit 0
$ npm run lint        -> 0 errors, 1 warning（useI18n.tsx，基线既有）
$ npm test            -> tests 1569 / pass 1568 / fail 1
```

- 基线（HEAD 3b86a28 独立 worktree）：tests 1551 / pass 1550 / fail 1。
- 唯一失败 `lib/model-listing.test.mjs » lite path…` 在基线同样失败（宿主预置 DeepSeek 模型，lite 路径期望空列表），与本 PR 无关。

**手动走查（临时 demo DB）**

- 四态：空频道 step 1 → 发消息 step 2 → 卡片转任务后等待认领（step 2）→ 认领 step 3 → 完成 step 4；旅程条 active/done、Tasks badge、引导卡文案均与预期一致。
- `···` 展开：添加回应 / 置顶到频道 / 设置提醒 / 转为任务；栏上回复、引用、复制链接仍直接可达。
- 秘书入口打开现有 `CreateAgentModal`，未新增路由。
- 原型 `prototype-ui/index.html?variant=b` 走查通过：只借鉴信息架构与文案，未复制 brutalist CSS/配色/2px 边框。

## Merge Danger

**Door:** two-way

UI 可见行为变化（动作栏分组、引导卡、旅程条），无数据/API/schema/持久化变更；回滚只需回退前端。

**Blast Radius:** medium

中央主视图的交互面变宽（旅程条/引导卡/Tab badge/`···` 菜单），但消息流、任务状态机、freshness-hold、线程面动作收窄规则与发送路径均未改语义；受影响测试已迁移到新 seam，未删护栏。

Closes: ticket 16 — `.scratch/pi-sdk-rebuild/issues/16-ui-guided-journey.md`
