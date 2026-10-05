# 11 — 可观测性 + 模型/技能配置

**What to build:** agent 详情面板补全：可观测性 tab——① 状态点 ② token/成本（从 pi session jsonl 只读解析统计、按 agent 聚合、**不落库**，与"session 读写权交 SDK"边界一致）③ 任务历史（该 agent 参与的任务 + 状态变更时间线，直接查 messages/tasks 无需额外表）④ 会话导出与上下文状态（export/context、cost/compaction 可见性）；runtime 区 per-agent 模型/provider/thinking 选择（复用 ChatInput 模型选择器，覆盖全局默认）；全局 models.json 面板与技能管理保留为全局设置（复用 ModelsConfig / SkillsConfig，几乎不改）（spec §3.6、§3.10、§6.5）。

**Blocked by:** 05, 07

**Status:** ready-for-agent

- [ ] token/成本/compaction 从 session jsonl 只读解析并聚合展示；不写入 raft 数据
- [ ] 任务历史时间线正确（该 agent 的消息 + 认领/状态变更记录）
- [ ] export/context 可用；cost/compaction 可见
- [ ] per-agent 模型/provider/thinking 覆盖全局默认并实际生效
- [ ] 全局 models/skills 面板可编辑且被 agent 实际采用
