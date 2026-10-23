# 11 — 可观测性 + 模型/技能配置

**What to build:** agent 详情面板补全：可观测性 tab——① 状态点 ② token/成本（从 pi session jsonl 只读解析统计、按 agent 聚合、**不落库**，与"session 读写权交 SDK"边界一致）③ 任务历史（该 agent 参与的任务 + 状态变更时间线，直接查 messages/tasks 无需额外表）④ 会话导出与上下文状态（export/context、cost/compaction 可见性）；runtime 区 per-agent 模型/provider/thinking 选择（复用 ChatInput 模型选择器，覆盖全局默认）；全局 models.json 面板与技能管理保留为全局设置（复用 ModelsConfig / SkillsConfig，几乎不改）（spec §3.6、§3.10、§6.5）。

**Blocked by:** 05, 07

**Status:** resolved（2026-10-23）

- [x] token/成本/compaction 从 session jsonl 只读解析并聚合展示；不写入 raft 数据
- [x] 任务历史时间线正确（该 agent 的消息 + 认领/状态变更记录）
- [x] export/context 可用；cost/compaction 可见
- [x] per-agent 模型/provider/thinking 覆盖全局默认并实际生效
- [x] 全局 models/skills 面板可编辑且被 agent 实际采用

## Answer

**结论**：完成（2026-10-23 复核；本票为只读审计，未改源码）。

**证据**：
- 只读解析：`lib/session-stats.ts:101` `parseSessionFileStats`（jsonl 只读，`:131-154` 统计 compaction/cost/token），不写库；聚合展示 `components/AgentDetailPanel.tsx:447` `TokensCostStats`、`:492` 四态余量档。
- 任务历史：`lib/domain/collab/observability.ts:59` `listAgentTasks`、`:101` `buildAgentTimeline`；UI `components/AgentDetailPanel.tsx:370` `TaskHistoryList`；测试 `observability.test.mjs:43`、`:137`。
- export/context：`app/api/sessions/[id]/export/route.ts`、`app/api/sessions/[id]/context/route.ts`；UI `AgentDetailPanel.tsx:1138-1139`（导出 URL）、`:1584`（export/context + cost/compaction 区块）。
- per-agent runtime：`lib/domain/collab/members.ts:298` `setAgentRuntimeConfig`；`lib/agent-runtime.ts:305-309` 启动会话时把 `model_provider/model_id/thinking_level` 传给 SDK（实际生效）；UI `AgentDetailPanel.tsx:907-912`；测试 `members.test.mjs:243`、`:265`。
- 全局 models/skills：`app/api/models-config/route.ts` + `components/ModelsConfig.tsx`、`components/SkillsConfig.tsx`；runtime 测试 `app/api/models-route.test.mjs`。

**偏差**：无。

**验证方式**：只读审计（未改源码），核对上述实现与测试文件。本票零源码改动，故未跑 npm test / tsc / lint。
