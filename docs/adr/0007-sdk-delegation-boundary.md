# SDK 委托边界：lib/rpc 与 model/skills/extensions 收敛

**背景**：`lib/rpc`（`session.ts`/`registry.ts`/`caller.ts`/`subscriber.ts`/`broadcaster.ts` 1479 行，3 处 `globalThis` 热重载守卫）与 `model-scope/thinkingLevelPins/enabledModels/models.json/skills/plugins` 分散在 20+ 文件，SDK `@earendil-works/pi-coding-agent@0.83.0` 已提供 `AgentSession/SessionManager/SettingsManager/ModelRuntime/DefaultResourceLoader/DefaultPackageManager/resolveModelScopeWithDiagnostics` 等中层能力，但 `SessionManager` 无 cwd 互斥、收款无 raft 域存储，需明确 `pi 管 pi、raft 管 raft` 切分线（ticket 04，`research/01 §1-2` 证据索引）。

**决策（ticket 04，2 轮 grilling 7 问全 A）**：
- **AgentSessionWrapper 四模块保留、职责收窄**：`registry` 保留 per-member `__workspliceSessions` 记账（不按 cwd 猜归属，`lib/agent-runtime.ts:184-260` 按 `member.id` 记账纪律），`withCwdStartLock/trackStarting` 抽至 `lib/cwd-mutex.ts`（ADR-0005 已立，`realpathSync` 归一 + 计数器 + `isCwdBusy/findBusySession + waitForSettle(SETTLE_EVENTS)`），`caller` 保留 `createAgentSessionServices→resolveVisibleModels→createAgentSessionFromServices` 二段式（含 `trustReloadOptions/withExtensionTools`），`session.ts` 瘦身为仅叠 `promptRunning` + 薄订阅，`subscriber/broadcaster` 合为 `lib/rpc/events.ts` 窄面。`SDK SessionManager.listAll` 不替代 registry 记账（SDK 无 `BusyCwdError`）。
- **model-scope 委托 SDK、thin adapter 保留**：`lib/model-scope.ts:71` 委托 `resolveModelScopeWithDiagnostics(patterns, runtime)`（`provider/modelId + :thinkingLevel` 全语法），`thinkingLevelPins` 随 `ScopedModel.thinkingLevel` 回传不自算，`enabledModels` 读写走 `SettingsManager`，`models-cache.ts` per-cwd 缓存与去重保留（`03 E04`）。
- **models.json/skills/plugins 存储委托 SDK、面板薄封装、手术短期保留**：`models.json` 经 `SettingsManager` `withLock` 读写 + `invalidateModelsCache`，`skills` 经 `DefaultResourceLoader.reload`，`plugins` 经 `DefaultPackageManager`（`research/01 §2.3`）；`ModelsConfig`/`SkillsConfig` 仅为 UI 薄封装；`PATCH /api/skills disable-model-invocation` 的 `SKILL.md` frontmatter 手术短期保留，`sunset 条件：待 SDK 提供 updateSkill() 后移除`（`01 §1 灰区`）。
- **per-agent runtime 保留、工厂透传**：`members` 表 `model_provider/model_id/thinking_level` 保留，`startSession` 二段式透传 `model/thinkingLevel/scopedModels` 至 `createAgentSessionFromServices`（不二次 `setModel`），`startup-preferences.ts` 显式选择去重落盘语义保留，`thinkingLevelPins` 随 `scopedModels` 走。
- **`tool-presets.ts` 三档保留为 UX 快捷、去硬编码**：`PRESET_NONE/DEFAULT/FULL` 不再持有工具名硬编码，`getToolNamesForPreset()` 改为 `getAllTools()` 子集过滤（`AgentSession.getAllTools/getActiveToolNames`），`allowedToolNames` 由 `caller.ts toolsOption` 注入（`[]`=全禁，`undefined`=不过滤）。

**Consequences**：
- `lib/cwd-mutex.ts` 成为 `agent-runtime` 与 `agent-loop driver` 共用唯一串行事实来源（ADR-0005 补充），`lib/rpc` 行数收敛但 `globalThis` 三守卫与 `realpath` 单测保留。
- `lib/model-scope.ts` 与 `models-cache` 成为后续 06 深模块图中 `lib/rpc` 的依赖下游，`Store 57` 宽总线与 `lib/domain/raft/index.ts` 唯一导入面不变（ADR-0006）。
- 技能开关手术为已知 tech debt，spec §5 显式标注 sunset。

**Status**: accepted
