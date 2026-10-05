# 04-lib/rpc 与 model/skills/extensions 收敛边界

Type: grilling
Status: resolved
Blocked by: 01
Assignee: wayfinder-session-04

## Question

在 01 研究的事实基础上，决策「pi 管 pi」的切分线：`lib/rpc` 与 `model/skills/extensions` 相关代码哪些收归 SDK、哪些保留为 raft 编排。

- `AgentSessionWrapper` 的封装厚度（registry/caller/subscriber/broadcaster 四模块是否保留、哪些可由 SDK 原生能力替代）
- `model-scope` / `thinkingLevelPins` / `enabledModels` / `models.json` / `skills` / `plugins` 的归属（SDK 侧 `ModelRegistry`/`AuthStorage`/`SettingsManager` vs worksplice 侧 `ModelsConfig`/`SkillsConfig` 面板）
- per-agent runtime 覆盖（`members.model_provider/model_id/thinking_level` → `startSession` 的 `initialModel` 注入）是否保留及形态
- 调用 `grilling` + `domain-modeling`：以 `CONTEXT.md` 术语（成员/会话/工作区/会话文件）为基准，明确新边界的术语与 ADR 落点（是否新增 `docs/adr/` 记录「SDK 委托边界」）

## Answer

**决策总览（2 轮 grilling，7 问全 A）**：

**AgentSessionWrapper 厚度（Q1）**：
- **保留四模块、职责收窄**：`registry` 保留 per-member `__workspliceSessions` 记账（不按 cwd 猜归属），`withCwdStartLock/trackStarting` 抽至 `lib/cwd-mutex.ts`（05 已决，`realpathSync` 归一 + 计数器 + `isCwdBusy/findBusySession` + `waitForSettle(SETTLE_EVENTS)`），`caller` 保留 `createAgentSessionServices→resolveVisibleModels→createAgentSessionFromServices` 二段式，`session.ts` 瘦身为仅叠 `promptRunning` + 薄订阅，`subscriber/broadcaster` 合为 `lib/rpc/events.ts` 窄面。SDK `SessionManager.listAll` 不替代 registry（无 BusyCwd 互斥）。

**model-scope 归属（Q2）**：
- **SDK 为 source of truth，thin adapter 保留**：`lib/model-scope.ts:71` 委托 `resolveModelScopeWithDiagnostics`，`thinkingLevelPins` 随 `ScopedModel.thinkingLevel` 回传，`enabledModels` 读写走 `SettingsManager`，`models-cache.ts` per-cwd 缓存保留。

**models.json/skills/plugins 归属（Q3）**：
- **存储委托 SDK、面板薄封装、手术短期保留**：`models.json` 经 `SettingsManager.withLock` + `invalidateModelsCache`，`skills` 经 `DefaultResourceLoader`，`plugins` 经 `DefaultPackageManager`；`PATCH disable-model-invocation` 的 `SKILL.md` frontmatter 手术短期保留，sunset=SDK 提供 `updateSkill()` 后移除。

**per-agent runtime（Q4）**：
- **保留三列、工厂透传**：`members.model_provider/model_id/thinking_level` 保留，`startSession` 二段式透传 `model/thinkingLevel/scopedModels` 至 `createAgentSessionFromServices`（不二次 `setModel`），`startup-preferences.ts` 显式去重落盘保留。

**术语与 ADR（Q5.1-5.3，domain-modeling）**：
- `CONTEXT.md` 新增 **SDK 委托边界 (SDK Delegation Boundary)** 与 **薄 Wrapper (Thin Wrapper)** 两条（已落盘）。
- 新增 **ADR-0007 `SDK 委托边界：lib/rpc 与 model/skills/extensions 收敛`**（`docs/adr/0007-sdk-delegation-boundary.md`，含三类归属表 + 手术 sunset）。
- `lib/tool-presets.ts` 三档保留为 UX 快捷、去硬编码：`getToolNamesForPreset()` 改为 `getAllTools()` 子集过滤，`allowedToolNames` 由 `caller.ts toolsOption` 注入（`[]`=全禁，`undefined`=不过滤）。

**对后续票据输入**：
- 06 目标架构：`lib/cwd-mutex.ts` 已独立，`lib/rpc` 新形态为 `session+registry+caller+events` 四件套 + `model-scope` adapter，`Store 57` 宽总线与 `lib/domain/raft/index.ts` 唯一导入面不变；`lib/rpc` 行数收敛但 `globalThis` 三守卫保留。
- 07 UI：`ModelsConfig/SkillsConfig` 仅调 SDK，手术保留不影响首版 B·Guided Journey。
- 08 迁移：零 schema 影响，`lib/data` 5 文件不变。
- 证据：`lib/rpc/*:1-383` + `lib/model-scope.ts:71` + `lib/models-cache.ts:1-60` + `lib/agent-runtime.ts:184-260` + `research/01 §1-2` + `CONTEXT.md:28-40`。

> Grilling 2 轮 7 问全 A；`domain-modeling` 同步落 `CONTEXT.md` 与 ADR-0007。
