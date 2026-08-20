# 04-lib/rpc 与 model/skills/extensions 收敛边界

Type: grilling
Status: claimed
Blocked by: 01
Assignee: wayfinder-session-04

## Question

在 01 研究的事实基础上，决策「pi 管 pi」的切分线：`lib/rpc` 与 `model/skills/extensions` 相关代码哪些收归 SDK、哪些保留为 raft 编排。

- `AgentSessionWrapper` 的封装厚度（registry/caller/subscriber/broadcaster 四模块是否保留、哪些可由 SDK 原生能力替代）
- `model-scope` / `thinkingLevelPins` / `enabledModels` / `models.json` / `skills` / `plugins` 的归属（SDK 侧 `ModelRegistry`/`AuthStorage`/`SettingsManager` vs worksplice 侧 `ModelsConfig`/`SkillsConfig` 面板）
- per-agent runtime 覆盖（`members.model_provider/model_id/thinking_level` → `startSession` 的 `initialModel` 注入）是否保留及形态
- 调用 `grilling` + `domain-modeling`：以 `CONTEXT.md` 术语（成员/会话/工作区/会话文件）为基准，明确新边界的术语与 ADR 落点（是否新增 `docs/adr/` 记录「SDK 委托边界」）
