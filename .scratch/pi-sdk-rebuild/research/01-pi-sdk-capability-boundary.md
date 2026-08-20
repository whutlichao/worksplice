# 01-pi SDK 能力边界研究

> 证据索引（Evidence Index）——本文所有断言均可追溯至下列一级来源，格式 `文件:行号`。未通过二级转述。
>
> **SDK 源码（node_modules/@earendil-works/pi-*@0.83.0，dist 声明为权威面）**
> - `pi-agent-core` 总出口: `node_modules/@earendil-works/pi-agent-core/dist/index.d.ts:1-30`（re-export agent/loop/harness/session/types）
> - `pi-agent-core` Agent 核心: `node_modules/@earendil-works/pi-agent-core/dist/agent.d.ts:1-60`（Agent 类 + subscribe/waitForIdle/reset/prompt）
> - `pi-agent-core` Session 抽象: `node_modules/@earendil-works/pi-agent-core/dist/harness/session/session.d.ts:1-80`（Session 类声明）
> - `pi-coding-agent` 总出口（SDK 中层主入口）: `node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts:1-35`（createAgentSession/SessionManager/SettingsManager/ModelRuntime 等）
> - `pi-coding-agent` AgentSession: `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.d.ts:1-120`（AgentSessionConfig/AgentSessionEvent/ThinkingLevel/ModelCycle）
> - `pi-coding-agent` 会话管理: `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts:1-200`（SessionManager, SessionHeader, SessionEntry, CURRENT_SESSION_VERSION=3, buildSessionContext, getDefaultSessionDir）
> - `pi-coding-agent` SDK 工厂: `node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.d.ts:1-80`（CreateAgentSessionOptions/createAgentSession/createAgentSessionServices/createAgentSessionFromServices）
> - `pi-coding-agent` ModelRuntime: `node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.d.ts:1-100`（ModelRuntime.create/getAvailable/login/logout/stream/complete）
> - `pi-coding-agent` ModelResolver: `node_modules/@earendil-works/pi-coding-agent/dist/core/model-resolver.d.ts:1-40`（resolveModelScopeWithDiagnostics/ScopedModel）
> - `pi-coding-agent` ModelRegistry: `node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.d.ts:1-50`（ModelRegistry 兼容门面，委托 ModelRuntime）
> - `pi-coding-agent` SettingsManager: `node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.d.ts:1-150`（Settings 接口、FileSettingsStorage、enabledModels/thinkingLevel/compaction/retry 等 30+ getter/setter）
> - `pi-coding-agent` Skills: `node_modules/@earendil-works/pi-coding-agent/dist/core/skills.d.ts:1-40`（loadSkills/formatSkillsForPrompt/Skill/LoadSkillsResult）
> - `pi-coding-agent` ResourceLoader: `node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.d.ts:1-80`（DefaultResourceLoader/ResourceLoader 接口, getSkills/getPrompts/getThemes/getSystemPrompt/reload）
> - `pi-coding-agent` PackageManager: `node_modules/@earendil-works/pi-coding-agent/dist/core/package-manager.d.ts:1-80`（DefaultPackageManager/resolve/install/remove/ResolvedPaths）
> - `pi-coding-agent` Extensions: `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/index.d.ts:1-15`（ExtensionRunner, discoverAndLoadExtensions, defineTool）
> - `pi-coding-agent` Tools: `node_modules/@earendil-works/pi-coding-agent/dist/core/tools/index.d.ts:1-30`（createCodingTools/createToolDefinition/ToolsOptions/withFileMutationQueue）
> - `pi-coding-agent` Compaction: `node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts:5-7` 转 `core/compaction/index.ts`（compact/shrink/shouldCompact/generateSummary）
> - `pi-coding-agent` Config 路径: `node_modules/@earendil-works/pi-coding-agent/dist/config.d.ts:60-90` + `dist/config.js:412-453`（getAgentDir/getSessionsDir/getSettingsPath/getAuthPath/getModelsPath）
> - `pi-ai` 总出口: `node_modules/@earendil-works/pi-ai/dist/index.d.ts:1-25`（Model/Provider/CredentialStore/AuthInteraction, TypeBox）
> - `pi-ai` Auth 存储: `node_modules/@earendil-works/pi-ai/dist/auth/types.d.ts:1-120`（CredentialStore/Credential/ApiKeyAuth/OAuthAuth/ProviderAuth）
> - `pi-ai` Models 存储: `node_modules/@earendil-works/pi-ai/dist/models-store.d.ts:1-30`（ModelsStore/ModelsStoreEntry）
> - `pi-tui` 出口: `node_modules/@earendil-works/pi-tui/dist/index.d.ts:1-30`（TUI 组件、Keybindings、Terminal）
>
> **worksplice 分散点（当前实现，均为 `lib/` / `app/api` 一级来源）**
> - `lib/rpc/session.ts:1-80`（AgentSessionWrapper, withExtensionTools, isRunning/isStreaming 判定）
> - `lib/rpc/session.ts:120-180`（start/subscribe/onEvent/idleTimer，RUNNING_STATE_EVENT_TYPES, IDLE_RESET_EVENT_TYPES）
> - `lib/rpc/caller.ts:1-60`（RpcCaller.start, __workspliceStartLocks, toolsOption 逻辑, createAgentSessionServices→resolveVisibleModels→selectInitialModelScope→createAgentSessionFromServices 链）
> - `lib/rpc/caller.ts:60-150`（trustReloadOptions, scopedModels, persistExplicitStartupPreferences, withExtensionTools 激活）
> - `lib/rpc/registry.ts:1-90`（RpcRegistry, __workspliceSessions/globalThis, hasBusyForCwd/findBusyForCwd/trackStarting）
> - `lib/rpc/broadcaster.ts:1-40`（RpcBroadcaster/lastSnapshot, notifyRunningChange）
> - `lib/rpc/subscriber.ts:1-60`（RpcSubscriber/__workspliceRunningListeners）
> - `lib/rpc/index.ts:1-38`（公共出口 11 导出）
> - `lib/model-scope.ts:1-142`（resolveVisibleModels/selectInitialModelScope, 委托 resolveModelScopeWithDiagnostics）
> - `lib/tool-presets.ts:1-34`（PRESET_NONE/DEFAULT/FULL, getPresetFromTools/getToolNamesForPreset）
> - `lib/agent-runtime.ts:1-383`（AgentRuntime 接口/BusyCwdError/chooseSessionFileForStart/withCwdStartLock/createRealAgentRuntime/resolveLatestSessionFile）
> - `lib/agent-runtime.ts:184-260`（getAgentRuntime 惰性 import, memberSessions 按 member.id 记账）
> - `lib/agent-status.ts:1-70`（getAgentStatusSnapshot, publishAgentStatus, setAgentStatusLookup, sweeper）
> - `lib/agent-lifecycle.ts:1-80`（restart/sessionReset/fullReset/changeWorkspace/deleteIdentity）
> - `lib/session-reader.ts:1-80`（listAllSessions→SessionManager.listAll, cacheSessionPath, invalidateSessionListCache）
> - `lib/models-cache.ts:1-60`（withModelRuntimeError, loadModelsWithCache, __workspliceModelsCacheState）
> - `lib/skills-service.ts:1-15`（loadSkillsWithInstallInfo → DefaultResourceLoader.reload + trustReloadOptions）
> - `lib/provider-listing.ts:1-90`（buildApiKeyProviderList/buildOAuthProviderList, CUSTOM_PROVIDER_SOURCES, dedupeById）
> - `lib/provider-listing-runtime.ts:1-40`（collectProviderListingInputs, credentialTypes Map）
> - `lib/project-trust.ts:1-40`（getProjectTrustStatus/projectTrustReloadOptions, hasTrustRequiringProjectResources/ProjectTrustStore）
> - `lib/startup-preferences.ts:1-60`（persistExplicitStartupPreferences, 避免重复 setModel/setThinkingLevel）
> - `lib/data/store.ts:1-150`（Store 接口, maxSeq/withTransaction/channels/messages/members/tasks/reminders 等）
> - `lib/data/schema.ts:1-60`（SCHEMA_VERSION=11, 9 张表 + trigger/FTS）
> - `lib/data/db-singleton.ts:1-40`（getDb/globalThis.__workspliceDb, 版本守卫）
> - `app/api/models/route.ts:1-80`（GET /api/models → createAgentSessionServices + resolveVisibleModels + selectInitialModelScope）
> - `app/api/models-config/route.ts:1-50`（GET/PUT models.json 直读写 + sanitizeModelsJson + invalidateModelsCache）
> - `app/api/models-config/discover/route.ts:1-80`（POST 上游模型发现, buildModelsListUrl/parseDiscoveredModels）
> - `app/api/models-config/test/route.ts:1-80`（POST 模型连通性测试, 临时 ModelRuntime + completeSimple）
> - `app/api/skills/route.ts:1-80`（GET uses DefaultResourceLoader, PATCH disable-model-invocation frontmatter 手术）
> - `app/api/skills/search/route.ts:1-80`（skills.sh HTTP + npx fallback）
> - `app/api/skills/install/route.ts:1-60`（npx skills add --agent pi, scope global/project + trust gate）
> - `app/api/plugins/route.ts:1-120`（DefaultPackageManager.resolve/enable/disable, settingsManager.packages, isDisabledPackage）
> - `app/api/agent/new/route.ts:1-80`（POST new → startRpcSession(tempKey,"",cwd), allowFileRoot, thinkingLevel 解析）
> - `app/api/agent/running/route.ts:1-15`（GET running → getRunningRpcSessionIds）
> - `app/api/agent/[id]/events/route.ts:1-60`（GET SSE → getRpcSession or startRpcSession + onEvent + heartbeat）

---

## 1. 摘要（面向 04/05/06 决策）

- **可委托 SDK 的**（中层收敛主收益）：`tools` 的定义与激活（AgentSession.setActiveToolsByName）、`enabledModels` 的解析与 `scopedModels` 模型轮转、`SessionManager` 的 session jsonl 读写与 `buildSessionContext`、`SettingsManager` 的 settings.json 读写与锁、`ModelRuntime` 的 provider/model/auth 编排、`DefaultResourceLoader` 的 skills/prompts/themes/extensions 发现与加载、`DefaultPackageManager` 的 packages 安装/解析、`getAgentDir/getSessionsDir` 等路径、`compaction` 自动/手动、`ThinkingLevel` 预算。
- **不可委托、必须保留在 worksplice 侧的**：`lib/rpc/registry + caller` 的 per-member 记账与 `BusyCwdError`/`withCwdStartLock` 串行、`hasBusyRpcSessionForCwd/findBusyRpcSessionForCwd` 的 realpath 语义、`AgentStatus` 现场推导与 DB 回落双轨、`lifecycle` 的家目录 vs 共享项目目录两分与 `pi_session_file` 所有权门禁、`raft` 域全部（channels/members/messages/tasks/.../FTS5/freshness-hold/mute/inbox/wake）、`project-trust` 信任门禁的编排、`models-cache` 的 per-cwd 缓存与去重、`provider-listing` 纯函数（但数据源委托 SDK）。
- **灰区（可收敛但需新 ADR）**：`tool-presets` 的 none/default/full 三档可保留为 UX 快捷，但不应再持有工具名硬编码；`skills` 的 PATCH `disable-model-invocation` 手术是 SDK 未暴露的 file-level API，短期保留、长期推动 SDK 提供 `updateSkill()`。

---

## 2. SDK 各包实际导出清单（`@earendil-works/pi-*@0.83.0`）

> 以 `dist/*.d.ts` 为准，`src/` 与 `dist/` 一致（tsgo 构建）。`types` 行号指声明文件首现处。

### 2.1 `pi-agent-core` — 底层 Agent 循环与会话原语

**包定位**：不依赖 TUI/coding 扩展的纯 Agent 内核。`pi-coding-agent` 依赖它（`package.json: dependencies @earendil-works/pi-agent-core ^0.83.0`）。

| 导出 | 来源 | 能力 | 证据 |
|---|---|---|---|
| `Agent` | `dist/agent.d.ts:8-60` | 状态机（`state.systemPrompt/model/thinkingLevel/tools/messages`）、`subscribe(listener)`、`prompt()/continue()/steer()/followUp()`、`waitForIdle()`、`abort()`、`reset()` | `agent.d.ts:12-20` AgentOptions, `agent.d.ts:55-70` 方法列表 |
| `agentLoop / runAgentLoop` | `dist/agent-loop.d.ts:5-15` | 底层 LLM 循环（`AgentContext + AgentLoopConfig + StreamFn → EventStream<AgentEvent>`） | `agent-loop.d.ts:8` |
| `Session`（通用会话） | `dist/harness/session/session.d.ts:18-90` | `getMetadata/getStorage/getLeafId/getEntry/getEntries/buildContext/buildSessionContext/appendMessage/appendModelChange/appendCompaction/moveTo` 等 15+ 方法 | `session.d.ts:20-45` |
| `SessionStorage / JsonlStorage / MemoryStorage` | `dist/harness/session/*.d.ts` | 存储后端抽象（文件/内存） | `index.d.ts:7` re-export |
| `ThinkingLevel` | `dist/types.d.ts` + `agent.d.ts` | `"off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max"` | `types.d.ts` ThinkingLevel 定义 |
| `AgentState / AgentEvent / AgentContext` | `dist/types.d.ts` | `systemPrompt/model/thinkingLevel/tools/messages/isStreaming/pendingToolCalls` | `types.d.ts:80-120` |
| `createBashTool/createEditTool/...` | `dist/harness/tools/index.d.ts` | 底层工具工厂（read/bash/edit/write） | `tools/index.d.ts:1-3` |
| `compact/shouldCompact/generateSummary` | `dist/harness/compaction/*.d.ts` | 上下文压缩 | `index.d.ts` 中转 |

**worksplice 实际使用**：`lib/rpc/session.ts` 间接（经 `pi-coding-agent` 的 AgentSession）；`lib/model-scope.ts:1` 仅 import `ThinkingLevel` 类型；`app/api/agent/new/route.ts:2` import `ThinkingLevel` 作校验。**未直接创建 `Agent` 实例**——全部经 `pi-coding-agent` 的 `AgentSession` 工厂。

### 2.2 `pi-ai` — Model/Provider/Auth 传输层

| 导出 | 能力 | 证据 |
|---|---|---|
| `Model<Api> / Provider / Api` | 模型与提供方数据模型 | `index.d.ts:1-10` |
| `CredentialStore` | `read/list/modify/delete`（每 provider 一凭证，`modify` 串行化，文件锁） | `auth/types.d.ts:80-110` |
| `Credential / ApiKeyCredential / OAuthCredential` | `type: "api_key" \| "oauth"` + `key/env/refresh/access/expires` | `auth/types.d.ts:10-40` |
| `ProviderAuth { apiKey?, oauth? }` | 每 provider 声明 `apiKey.login/resolve/check` 与 `oauth.login/refresh/toAuth` | `auth/types.d.ts:140-200` |
| `AuthInteraction { prompt/notify, signal }` | 登录交互回调（device_code/manual_code/select/secret） | `auth/types.d.ts:90-110` |
| `ModelsStore / InMemoryModelsStore` | provider 维度的模型目录缓存（`models/providers/*/models.json` 远端 ETag/lastModified） | `models-store.d.ts:1-25` |
| `Models` (`getModels/getAvailable/getProvider/getAuth/stream/complete`) | 与 `ModelRuntime` 同构的接口，更底层 | `index.d.ts` Models 声明 |
| `getSupportedThinkingLevels(model)` | 模型能力查询 | `app/api/models/route.ts:3` 实际调用 |

**worksplice 实际使用**：`app/api/models-config/test/route.ts:4` 用 `completeSimple` 作连通性探测；`app/api/models/route.ts:2` 用 `getSupportedThinkingLevels`。**auth.json 的读写不经 `pi-ai` 直接操作**，而是经 `ModelRuntime`（上层封装）。

### 2.3 `pi-coding-agent` — 中层底座（本次收敛主对象）

> 这是 `pi` TUI 与 worksplice 共用的"重型 SDK"，`dist/index.d.ts` 为唯一对外门面（`SessionManager/AgentSession/SettingsManager/ModelRuntime/ResourceLoader/PackageManager` 等一次性导出）。

#### Session 域

| 导出 | 能力 | 证据 |
|---|---|---|
| `SessionManager` | `create(cwd, sessionDir?) / open(path) / continueRecent(cwd) / inMemory(cwd) / forkFrom(src, targetCwd) / list(cwd) / listAll()`；实例方法 `getCwd/getSessionDir/getSessionId/getSessionFile/getLeafId/getEntry/getBranch/buildContextEntries/buildSessionContext/appendMessage/appendCompaction/branch/createBranchedSession` 等 20+ | `core/session-manager.d.ts:40-160` |
| `SessionHeader { id, cwd, timestamp, parentSession? }` | session 文件首行 | `session-manager.d.ts:8-15` |
| `SessionEntry`（8 变体） | `message / thinking_level_change / model_change / compaction / branch_summary / custom / custom_message / label / session_info` | `session-manager.d.ts:20-60` |
| `buildSessionContext / buildContextEntries` | 压缩感知、leaf 路径回放、compaction 后的"保留 entry"展开 | `session-manager.d.ts:30-45` |
| `CURRENT_SESSION_VERSION = 3` | 文件版本 | `session-manager.d.ts:5` |
| `getDefaultSessionDir(cwd, agentDir?)` | `~/.pi/agent/sessions/<encoded-cwd>/` 路径计算 | `session-manager.d.ts` |
| `getAgentDir/getSessionsDir/getSettingsPath/getAuthPath/getModelsPath/getPromptsDir` | `~/.pi/agent/*` 路径族 | `config.d.ts:60-90` |
| `SessionContext { messages, thinkingLevel, model }` | LLM 上下文快照 | `session-manager.d.ts:70-80` |

**关键约束**：
- `SessionManager.create(cwd)` 的 `cwd` 写入 `SessionHeader.cwd`，`listAll()` 按 `cwd` 分组靠此字段；worksplice 的 `lib/session-reader.ts:12-20` 正是依赖它做 `projectRoot` 解析。
- `forkFrom` 的语义与 worksplice 的"Fork button"（`send("fork")`→`inner.sessionId` 突变）不同，前者是文件复制、后者是 wrapper 内状态突变（见 `lib/rpc/session.ts:178` 注释"mutates inner state in-place"）。
- `SessionManager` 无"多实例互斥"——同一 `cwd` 可并发 `create` 多个 `SessionManager` 实例，文件锁由 `AgentSession` 层（`proper-lockfile`）承担；`withCwdStartLock` 是 worksplice 侧补的进程内互斥。

#### AgentSession 域

| 导出 | 能力 | 证据 |
|---|---|---|
| `createAgentSession(options)` | 一站式工厂：`cwd/agentDir/model/thinkingLevel/scopedModels/tools/excludeTools/customTools/resourceLoader/sessionManager/settingsManager` → `{ session, extensionsResult, modelFallbackMessage }` | `core/sdk.d.ts:30-70` |
| `createAgentSessionServices({ cwd, agentDir })` | 拆步：先建 `SettingsManager+ModelRuntime+ResourceLoader`（不建 Agent），供调用方先做 `resolveVisibleModels` 再建 session | `sdk.d.ts:15-20`, `lib/rpc/caller.ts:72-85` 实际用法 |
| `createAgentSessionFromServices({ services, sessionManager, model, thinkingLevel, scopedModels, tools })` | 二段式：复用 services + 选好的 model/scope 建 `AgentSession` | `sdk.d.ts:20-30` |
| `AgentSession` 类 | `prompt(text, opts)/steer/followUp/sendCustomMessage/sendUserMessage`；`subscribe(listener)`；`setModel/cycleModel/setThinkingLevel/cycleThinkingLevel/getAvailableThinkingLevels`；`setActiveToolsByName/getActiveToolNames/getAllTools`；`compact/abortCompact/abortRetry`；`bindExtensions`；`getSessionStats/getContextUsage/exportToHtml`；`branch/navigateTree/fork` 等 30+ 方法 | `core/agent-session.d.ts:80-250` |
| `AgentSessionConfig.initialActiveToolNames / allowedToolNames / excludedToolNames / baseToolsOverride` | 工具过滤三件套（SDK 层） | `agent-session.d.ts:30-50` |
| `AgentSessionEvent` | `agent_start/agent_end/agent_settled/turn_start/turn_end/message_start/message_update/message_end/tool_execution_*` + `compaction_start/end` + `auto_retry_*` + `entry_appended` + `thinking_level_changed` | `agent-session.d.ts:15-80` |
| `AgentSessionRuntime / createAgentSessionRuntime` | 更细粒度的 runtime 工厂（`loadSkills` 等可定制） | `sdk.d.ts` |

**关键约束**：
- `createAgentSession({ tools: [] })` 传入空数组 = `allowedToolNames = []`，**禁用全部工具**（含扩展工具）；非空数组则为 allow-list，仅保留指定工具名。worksplice 的 `lib/rpc/caller.ts:58-68` 对此有长注释：`toolsOption = []` 时禁用全部，`undefined` 时不过滤（保留扩展工具）。
- `setActiveToolsByName` 是实例级"激活"（非注册表过滤），`lib/rpc/caller.ts:90-95` 启动后额外调用 `withExtensionTools(inner, toolNames)` 把扩展工具加回激活集，以对齐 `pi` CLI 的行为。
- `AgentSession` 的 `subscribe` 内部做 session 持久化（`SessionManager.appendMessage`），调用方无需手动落盘。
- `AgentSession.isStreaming/isCompacting/isBashRunning/isIdle` 四态由 SDK 维护；worksplice 的 `AgentSessionWrapper.isRunning()` 在此之上再叠 `promptRunning` 标记（`session.ts:55-65`）。

#### Model 域

| 导出 | 能力 | 证据 |
|---|---|---|
| `ModelRuntime.create({ credentials/authPath/modelsPath/modelsStore/allowModelNetwork })` | 构建 `Models` 集合 + `CredentialStore` + `ModelsStore` + provider 合成 | `model-runtime.d.ts:8-25` |
| `ModelRuntime.getAvailable()/getModels()/getProvider()/getProviderAuthStatus()/getAuth()/checkAuth()` | 模型枚举与认证查询 | `model-runtime.d.ts:30-60` |
| `ModelRuntime.setRuntimeApiKey/removeRuntimeApiKey/login/logout/refresh/registerProvider` | 运行时 auth 变更 | `model-runtime.d.ts:60-80` |
| `ModelRegistry` | **同步兼容门面**，委托 `ModelRuntime`（`getAll/getAvailable/find/hasConfiguredAuth/getApiKeyAndHeaders`），供扩展同步调用 | `model-registry.d.ts:1-40` |
| `resolveModelScopeWithDiagnostics(patterns, modelRuntime)` | `enabledModels` 模式解析（minimatch glob + fuzzy + `:thinkingLevel` 后缀），返回 `{ scopedModels, diagnostics }` | `core/model-resolver.d.ts:1-15`, `lib/model-scope.ts:71` 实际委托 |
| `ScopedModel { model, thinkingLevel? }` | 模式命中后的模型 + pin 的 thinkingLevel | `model-resolver.d.ts:10` |

#### Settings 域

| 导出 | 能力 | 证据 |
|---|---|---|
| `SettingsManager.create(cwd, agentDir)` | 读 `~/.pi/agent/settings.json` + `cwd/.pi/settings.json`，`withLock` 文件锁（`proper-lockfile`） | `settings-manager.d.ts:60-90` |
| `Settings` 接口 | `defaultProvider/defaultModel/defaultThinkingLevel/enabledModels/packages/extensions/skills/prompts/themes/steeringMode/followUpMode/compaction/retry/thinkingBudgets/...` 30+ 字段 | `settings-manager.d.ts:15-55` |
| `InMemorySettingsStorage` | 内存后端（测试用） | `settings-manager.d.ts:55-65` |
| `SettingsManager.getEnabledModels()/setEnabledModels()` | `enabledModels` 读写 | `settings-manager.d.ts:140-150` |
| `SettingsManager.getDefaultProvider()/getDefaultModel()/setDefaultModelAndProvider()` | 默认模型读写 | `settings-manager.d.ts:100-120` |
| `SettingsManager.getPackages()/setPackages()` | `packages` 读写 | `settings-manager.d.ts:120-130` |
| `ProjectTrustStore` | `get(cwd)/set(cwd, bool)`，判定 `hasTrustRequiringProjectResources(cwd)` | `lib/project-trust.ts:1-15`, SDK 同名导出 |
| `FileSettingsStorage` | `withLock(scope, fn)` 文件锁 | `settings-manager.d.ts:40-55` |

**关键约束**：`SettingsManager` 的 `withLock` 是**同步文件锁**（`proper-lockfile` sync），worksplice 的 `persistExplicitStartupPreferences` 在工厂后 `await settingsManager.flush()`（`startup-preferences.ts:30-40`）以确保显式选择落盘。

#### Skills / Extensions / Tools 域

| 导出 | 能力 | 证据 |
|---|---|---|
| `loadSkills(options)` / `loadSkillsFromDir(options)` / `formatSkillsForPrompt(skills)` | 按 `cwd/agentDir/skillPaths/includeDefaults` 发现 `SKILL.md`，`disable-model-invocation` 过滤 | `core/skills.d.ts:1-40` |
| `DefaultResourceLoader` | 统一资源加载器：`getSkills/getPrompts/getThemes/getExtensions/getSystemPrompt/reload(extendResources?)`，内部委托 `PackageManager + loadSkills + discoverAndLoadExtensions` | `core/resource-loader.d.ts:60-120` |
| `DefaultPackageManager` | `resolve()/install()/installAndPersist()/remove()/update()/listConfiguredPackages()/resolveExtensionSources()` | `core/package-manager.d.ts:20-60` |
| `discoverAndLoadExtensions / createExtensionRuntime / ExtensionRunner` | 扩展发现与运行 | `core/extensions/index.d.ts:5-10` |
| `createCodingTools(cwd) / createCodingToolDefinitions(cwd) / createToolDefinition(name,cwd,opts)` | 7 个内置工具（read/bash/edit/write/grep/find/ls）的 `ToolDefinition` 工厂 | `core/tools/index.d.ts:10-25` |
| `withFileMutationQueue` | 文件变更队列（edit/write 串行化） | `core/tools/index.d.ts:3` |
| `defineTool` | 扩展自定义工具 | `extensions/index.d.ts` |

#### 其他

| 导出 | 能力 | 证据 |
|---|---|---|
| `VERSION / getAgentDir / getDocsPath / getReadmePath` | 版本与路径常量 | `config.d.ts:40-60` |
| `expandTildePath / getSessionsDir / getToolsDir` | 辅助路径 | `config.d.ts:70-90` |
| `Theme / initTheme / getMarkdownTheme` | 主题系统（TUI 用，web 侧用 `PlainTextTheme` 桩） | `core/agent-session.d.ts` 间接（`lib/rpc/session.ts:30-50` PlainTextTheme） |
| `InteractiveMode / RpcClient / runPrintMode / runRpcMode` | TUI/Print/RPC 三种运行模式 | `modes/index.d.ts:1-10` |

### 2.4 `pi-tui` — 终端 UI 框架（与重构无关）

| 导出 | 能力 | 证据 |
|---|---|---|
| `TUI / Component / Container / Box / Text / Input / Editor / SelectList` | 终端组件 | `dist/index.d.ts:1-20` |
| `KeybindingsManager / TUI_KEYBINDINGS / Key / parseKey` | 快捷键 | `dist/index.d.ts:10-15` |
| `Terminal / ProcessTerminal / StdinBuffer` | 终端抽象 | `dist/index.d.ts:20-30` |

**worksplice 实际使用**：仅 `lib/rpc/session.ts:4` import `TuiKeybindingsManager, TUI_KEYBINDINGS` 作空桩 + `Theme` 桩；**无 TUI 渲染**，`PlainTextTheme` 把所有样式方法重写为直通（`session.ts:30-50`）。

---

## 3. worksplice 分散点现状（文件:行号）

### 3.1 `lib/rpc` 四模块（Wrapper + Registry + Caller + Subscriber/Broadcaster）

> 总量约 650 行，分散在 7 个文件，涉及 `globalThis` 热重载守卫 5 处、idle 超时 1 处、`realpath` 归一 2 处。

| 模块 | 文件:行号 | 职责 | 依赖方向 |
|---|---|---|---|
| `AgentSessionWrapper` | `lib/rpc/session.ts:50-250` | 订阅中转（`subscribe/emit`）、命令分发（`send` 27 分支：prompt/steer/followUp/abort/compact...）、扩展绑定（`beginExtensionBinding/forceEmptySystemPrompt`）、idle 定时（`resetIdleTimer` 10min）、`withExtensionTools` 扩展工具合并 | 依赖 SDK `AgentSession`，被 `caller/registry/broadcaster` 依赖 |
| `RpcRegistry` | `lib/rpc/registry.ts:1-110` | `__workspliceSessions: Map<id,Wrapper>`、busy-cwd 探测（`hasBusyForCwd/findBusyForCwd` via `normalizeRpcCwd(realpathSync)`）、`trackStarting(cwd)` 计数器（starting 窗口）、`destroyForCwd` | 仅 type-only 依赖 `session.ts` |
| `RpcCaller` | `lib/rpc/caller.ts:1-150` | `start(sessionId, sessionFile, cwd, opts)` 唯一构造入口：`SessionManager.create/open` → `createAgentSessionServices` → `resolveVisibleModels` → `selectInitialModelScope` → `createAgentSessionFromServices` → `persistExplicitStartupPreferences` → `setActiveToolsByName(withExtensionTools)` → `register + beginExtensionBinding`；并发锁 `__workspliceStartLocks` | 依赖 `registry/session/model-scope/startup-preferences/session-reader` |
| `RpcSubscriber` | `lib/rpc/subscriber.ts:1-60` | `__workspliceRunningListeners: Set<fn>`，`subscribe/hasListeners/forEach` | 无 SDK 依赖 |
| `RpcBroadcaster` | `lib/rpc/broadcaster.ts:1-40` | `lastSnapshot` 去重，`broadcast()` 通知 `subscriber` | 依赖 `registry/subscriber` |
| `__workspliceStartLocks` | `lib/rpc/caller.ts:12-18` | `Map<sessionId, Promise<{session, realSessionId}>>`，防止同一 `sessionId` 并发建两 session | `globalThis` |
| `__workspliceSessions` | `lib/rpc/registry.ts:10-20` | `Map<id,Wrapper>`，随 `onDestroy` 自动注销 | `globalThis` |
| `__workspliceStartingSessionCwds` | `lib/rpc/registry.ts:60-75` | `Map<realpathCwd, count>`，starting 窗口 busy 判定 | `globalThis` |

**分散点诊断**：
- **与 SDK 重叠最多的是 `caller` 的"建 session 前 scope 解析"**：`resolveVisibleModels + selectInitialModelScope` 本可由 SDK 内聚（`createAgentSession({ enabledModels })`），但 SDK 当前要求调用方先建 `services`、再调 `resolveModelScopeWithDiagnostics`、再选 `initialModel`，worksplice 的封装恰好补了这一"两段式跳跃"（`caller.ts:72-105`）。
- **`Wrapper` 的 `send` 27 分支**中，约 60% 是 SDK 已有能力的透传（`prompt/steer/followUp/abort/setModel/setThinkingLevel/compact/get_state`），40% 是 web 定制（`custom_ui` 终端桩、`shell/restart/reload` 未暴露）。
- **`registry` 的 busy-cwd 语义无 SDK 对应物**：`hasBusyRpcSessionForCwd` 按 `realpathSync` 归一，`starting` 窗口用计数器而非 boolean，支持同一 cwd 并发 `trackStarting` 多次。

### 3.2 `lib/model-scope.ts`（142 行）

| 函数 | 文件:行号 | 职责 | 委托关系 |
|---|---|---|---|
| `resolveVisibleModels(runtime, patterns)` | `lib/model-scope.ts:57-97` | 清洗 patterns → `resolveModelScopeWithDiagnostics` → `visible/scopedModels/thinkingLevelPins/warnings`；空/全不命中时回落 `getAvailable()` | **唯一委托点**：`@earendil-works/pi-coding-agent: resolveModelScopeWithDiagnostics` |
| `selectInitialModelScope(scope, { requestedModel, defaultModel, thinkingLevel })` | `lib/model-scope.ts:107-142` | 按 `requested > defaultScoped > fallbackScoped > defaultVisible` 优先级选模型；`thinkingLevel` 显式优先于 pin | 纯本地规则，无 SDK 对应（SDK 的 `createAgentSession` 内部另有一套默认模型回落，但不含"requested 显式校验"） |

**分散点诊断**：`resolveVisibleModels` 是**薄委托**（10 行逻辑 + 1 行 SDK 调用），收敛价值低、保留成本也低；`selectInitialModelScope` 是**worksplice 定制规则**（显式 model 校验、defaultVisible 回落），SDK 无等价物，若收归需新增 SDK API 或保留本地。

### 3.3 `lib/tool-presets.ts`（34 行）

| 导出 | 文件:行号 | 职责 |
|---|---|---|
| `PRESET_NONE=[]` / `PRESET_DEFAULT=[read,bash,edit,write]` / `PRESET_FULL=[bash,read,edit,write,grep,find,ls]` | 三档预设常量 | `tool-presets.ts:9-11` |
| `getPresetFromTools(ToolEntry[])` | 活跃工具名集合 → preset（精确匹配 default/full，其余回落 default） | `tool-presets.ts:15-28` |
| `getToolNamesForPreset(preset)` | preset → 工具名数组 | `tool-presets.ts:30-34` |
| `BUILTIN_TOOL_NAMES = Set(PRESET_FULL)` | 硬编码 7 工具白名单 | `tool-presets.ts:13` |

**分散点诊断**：与 SDK 的 `createCodingTools/createAllTools/allToolNames` 语义重叠，但 worksplice 的"3 档"是**产品级快捷**（UI 下拉），SDK 侧无 preset 概念。`BUILTIN_TOOL_NAMES` 硬编码与 SDK 的 `allToolNames` 可能漂移（若 SDK 新增工具）。

### 3.4 `lib/agent-runtime.ts`（383 行）

| 导出 | 文件:行号 | 职责 |
|---|---|---|
| `AgentRuntime` 接口 | `findSession/findBusySessionForCwd/startSession/destroySession/removeSessionFilesForCwd` | `agent-runtime.ts:19-30` |
| `referencedSessionFiles(excludeMemberId?)` | 扫描 `listMembersIncludingDeleted()` 收集 `pi_session_file` 所有权凭证 | `agent-runtime.ts:62-69` |
| `chooseSessionFileForStart(input)` | 纯函数：`boundFileExists+boundFileCwd+referencedByOthers+isOwnHome+latestUnreferenced` → `{ sessionFile, clearedBinding }`（共享目录永不回填、人家文件不复用） | `agent-runtime.ts:108-130` |
| `withCwdStartLock(cwd, fn)` | per-cwd 互斥（`globalThis.__workspliceCwdStartLocks` + `realpathSync` + `prev.then(fn,fn)`） | `agent-runtime.ts:150-169` |
| `getAgentRuntime()` | 惰性 `import("@earendil-works/pi-coding-agent") + import("./rpc")`，避免测试/纯服务路径拉起 SDK | `agent-runtime.ts:177-182` |
| `createRealAgentRuntime()` | `memberSessions: Map<memberId,Wrapper>`（`__workspliceAgentSessions` globalThis）、`setAgentStatusLookup(deriveLiveAgentStatus)`、`resolveLatestSessionFile(cwd)`（listAll+合并 referenced 过滤）、`startSession/destroySession/removeSessionFilesForCwd` 三实现 | `agent-runtime.ts:184-369` |
| `deriveLiveAgentStatus(member, session)` | `isAlive→isRunning→working/online/null`，error 时返回 null 让 DB 回落保留 error | `agent-runtime.ts:376-383` |

**分散点诊断**：`AgentRuntime` 是**worksplice 自研的 raft↔SDK 接缝**，SDK 无对应；`chooseSessionFileForStart` 的"共享目录不回填、被引用文件不复用、家目录才回填 latestUnreferenced"规则是 ADR-0001/0003 的核心，无 SDK 对应，必须保留。

### 3.5 `app/api/models*`（3 路由 + 1 cache）

| 文件:行号 | 职责 | SDK 依赖 |
|---|---|---|
| `app/api/models/route.ts:18-70` | `GET ?cwd= → createAgentSessionServices(cwd) → resolveVisibleModels → selectInitialModelScope → { models/modelList/defaultModel/thinkingLevels/thinkingLevelPins/warnings }` | `createAgentSessionServices`, `getAvailable`, `getSupportedThinkingLevels`, `resolveVisibleModels` |
| `app/api/models-config/route.ts:12-45` | `GET/PUT ~/.pi/agent/models.json` 直读写（`readFileSync/writePrivateFileAtomicSync` + sanitize 空 id 过滤 + invalidateModelsCache） | 无（直操作文件，SDK 无 models.json 读写 API） |
| `app/api/models-config/discover/route.ts:30-90` | `POST { providerName, provider: { baseUrl, api } } → resolveModelDiscoveryAuth → fetch(baseUrl/models) → parseDiscoveredModels` | `resolveModelDiscoveryAuth/buildModelsListUrl`（worksplice 私有，不在 SDK） |
| `app/api/models-config/test/route.ts:30-120` | `POST { providerName, provider, model } → 临时 ModelsStore + ModelRuntime.create({modelsPath}) → getModel → getAuth → completeSimple("Reply with OK only.")` | `ModelRuntime.create, getModel, getAuth, completeSimple` |
| `lib/models-cache.ts:30-60` | `loadModelsWithCache(cwd, loader)`：60s TTL + 32 entry LRU + inFlight 去重 + generation 世代 | 无 SDK 对应（SDK 无缓存层） |

**分散点诊断**：`models/route.ts` 与 `caller.ts` 共享同一"services→scope→initial"链，重复；`models-config` 的 `models.json` 直读写是**绕过 SDK**（SDK 无 `models.json` 编辑 API，仅有 `ModelRuntime.registerProvider` 运行时注册）。

### 3.6 `app/api/skills*` + `app/api/plugins*`

| 文件:行号 | 职责 | SDK 依赖 |
|---|---|---|
| `app/api/skills/route.ts:10-35` | `GET ?cwd= → DefaultResourceLoader({cwd,agentDir}).reload(trustReloadOptions) → getSkills()` | `DefaultResourceLoader, getSkills` |
| `app/api/skills/route.ts:40-110` | `PATCH { filePath, disable: bool } → parseFrontmatter → 正则手术增删 "disable-model-invocation: true"` | `parseFrontmatter`（SDK 仅读，无写 API） |
| `app/api/skills/search/route.ts:20-80` | `POST {query} → fetch(skills.sh/api/search) 降级 npx` | 无 |
| `app/api/skills/install/route.ts:20-60` | `POST {package, scope, cwd} → runNpx(["skills","add",pkg,"-y","--agent","pi", "-g"?])` | `runNpx`（worksplice 私有） |
| `lib/skills-service.ts:5-15` | `loadSkillsWithInstallInfo` = `DefaultResourceLoader.reload + annotateSkillsWithInstallInfo` | `DefaultResourceLoader` |
| `app/api/plugins/route.ts:30-150` | `GET → DefaultPackageManager.resolve() → ResolvedPaths → PluginPackageInfo`；`POST {install/remove/update/disable/enable} → pm.install/remove + settingsManager.setPackages/setProjectPackages` | `DefaultPackageManager`, `SettingsManager` |

**分散点诊断**：`skills/route.ts:GET` 是**纯委托**（3 行 SDK 调用）；`PATCH` 的 frontmatter 手术是**SDK 空白**（SDK 仅 `loadSkills`，无 `updateSkill`）；`plugins` 的 `DefaultPackageManager` 已充分委托，仅 `disable` 的"空数组覆写"技巧（`isDisabledPackage` 判定）是 worksplice 约定。

### 3.7 `app/api/auth/*`

| 文件:行号 | 职责 | SDK 依赖 |
|---|---|---|
| `app/api/auth/all-providers/route.ts:5-10` | `GET → ModelRuntime.create() → collectProviderListingInputs → buildApiKeyProviderList` | `ModelRuntime.create` |
| `app/api/auth/providers/route.ts:5-10` | `GET → ModelRuntime.create() → collectProviderListingInputs → buildOAuthProviderList` | `ModelRuntime.create` |
| `lib/provider-listing.ts:1-90` | `buildApiKey/OAuthProviderList` 纯函数（按 `hasApiKeyLogin/hasOAuth` 判定，排除 `models_json_*` source，去重） | 无（纯函数） |
| `lib/provider-listing-runtime.ts:5-30` | `collectProviderListingInputs(runtime)` = `runtime.getProviders().map(...)` + `runtime.listCredentials()` | `ModelRuntime.getProviders/getProviderAuthStatus/listCredentials` |
| `app/api/auth/api-key/[provider]/route.ts`（未详读，模式同 test） | `GET/POST/DELETE api-key` → `ModelRuntime.setRuntimeApiKey/removeRuntimeApiKey` | `ModelRuntime` |

---

## 4. Session 生命周期与存储边界

### 4.1 SDK 侧 `SessionManager` 的 cwd 隔离模型

```
SessionManager.create(cwd, sessionDir?)          — 新建会话，cwd 写入 SessionHeader.cwd
SessionManager.open(path, sessionDir?, cwdOverride?) — 打开指定文件
SessionManager.continueRecent(cwd, sessionDir?)  — 续最近会话（按 modified 排序）
SessionManager.forkFrom(sourcePath, targetCwd)   — 文件级 fork（复制 history 到新 cwd）
SessionManager.list(cwd, sessionDir?)            — 列该 cwd 下会话
SessionManager.listAll()                         — 列全部会话（扫描 getSessionsDir() 下所有 encoded-cwd 子目录）
getDefaultSessionDir(cwd, agentDir)              — 路径：join(getAgentDir(), "sessions", encode(cwd))
```

- **cwd 是 header 字段，非目录隔离**：`list(cwd)` 通过比对 `header.cwd === cwd` 过滤，而非子目录天然隔离；`listAll()` 需扫描全部 encoded 子目录（`session-manager.d.ts:60-90`）。
- **文件格式**：`{type:"session", id, timestamp, cwd, parentSession?}` 首行 + 若干 `{type:"message"|"model_change"|"compaction"|..., id, parentId, timestamp, ...}`（`session-manager.d.ts:8-35`）。版本号 `CURRENT_SESSION_VERSION=3`（`session-manager.d.ts:5`）。
- **树结构**：`parentId` 形成树，`leafId` 指向当前分支末端；`buildSessionContext(entries, leafId?)` 按 leaf 路径回放，`compaction` 后仅保留 `summary + firstKeptEntryId` 之后（`session-manager.d.ts:90-110`）。
- **读写权归 SDK**：`SessionManager.appendMessage/appendCompaction/branch` 等是唯一写入口；worksplice 的 `session-reader.ts` 仅读（`SessionManager.listAll()/open().getEntries()/buildContextEntries()`），无直接 `writeFileSync`（除 `lib/agent-lifecycle.ts` 的 `rmSync` 删文件）。

### 4.2 worksplice 的"所有权门禁"（ADR-0003）在 SDK 之上的叠加

| 规则 | 实现 | 证据 |
|---|---|---|
| 家目录唯一私有，共享项目目录不回填无主文件 | `chooseSessionFileForStart: isOwnHome && latestUnreferenced → 回填；否则 null` | `agent-runtime.ts:126-130` |
| `pi_session_file` 是所有权凭证，被引用文件不复用 | `referencedSessionFiles()` 收集所有 `pi_session_file`，`resolveLatestSessionFile` 过滤 `referenced.has(path)`，`choose` 校验 `!referencedByOthers.has(boundFile)` | `agent-runtime.ts:62-69, 219-228` |
| 归属校验：`boundFileCwd === member.workspace_path` 且在 `listAll()` 清单内 | `boundFileCwd = sessions.find(s.path===boundFile)?.cwd`，`owned = boundFileCwd!==null && normalize(boundFileCwd)===normalize(cwd) && !referenced...` | `agent-runtime.ts:266-285` |
| 脏绑定自愈：校验失败 → `setAgentSessionFile(id, null)` + 新建空会话 | `if (choice.clearedBinding) { setAgentSessionFile(member.id, null); sessionFile=null; }` | `agent-runtime.ts:294-300` |
| 删除/重置只删未被引用文件 | `removeSessionFilesForCwd: !referenced.has(s.path)` | `agent-runtime.ts:355-365` |

> SDK 无上述任何规则；`SessionManager` 允许多实例指向同一文件，无所有权概念。worksplice 的门禁是**进程内单机多 agent 共享 cwd**场景的必需品，若委托 SDK 需新增 API（或保留本地）。

### 4.3 多实例模型与 `hasBusyRpcSessionForCwd / withCwdStartLock` 对应关系

**SDK 的多实例模型**：
- `AgentSession` 是单实例绑定一个 `SessionManager`（文件）+ `ModelRuntime` + `ResourceLoader`；同一文件可被多个 `AgentSession` `open`（无文件锁互斥），但 `isStreaming` 状态仅在实例内有效。
- `SessionManager` 无"busy-cwd"概念；`AgentSession.isStreaming/isCompacting` 仅反映该实例。

**worksplice 的双层串行**（`lib/agent-runtime.ts:136-169` + `lib/rpc/registry.ts:30-70`）：

```
Layer 1: withCwdStartLock(cwd)           — 进程内 per-cwd 互斥，把 [hasBusy检查 → 文件选择 → startRpcSession] 串行化
Layer 2: hasBusyRpcSessionForCwd(cwd)    — 运行时探测：starting 窗口计数器 + isRunning() 扫描
```

| SDK 能力 | worksplice 叠加 | 能否合一 |
|---|---|---|
| 无 cwd 级互斥 | `withCwdStartLock`：`globalThis.__workspliceCwdStartLocks: Map<realpathCwd, Promise>`，`prev.then(fn,fn)` 链式串行，`realpathSync` 归一 | SDK 若提供 `SessionManager.withLock(cwd)` 可替代，但当前无 |
| 无 starting 窗口 | `trackStarting(cwd): Map<realpathCwd, count>`，`start` 前置位、`finally` 清位，`hasBusy` 包含 `startingCwds.has(cwd)` | SDK 的 `AgentSession` 构造是异步的，中间有窗口；需保留或移入 SDK |
| 无 cross-agent 感知 | `findBusyRpcSessionForCwd(cwd) → Wrapper`（供 driver 等待） | 纯 worksplice 编排，SDK 无需感知 raft member |

**结论**：SDK 的"单 session 单实例"模型与 worksplice 的"单 cwd 多 agent 串行"需求错位；`withCwdStartLock + trackStarting` 的双层防护**短期必须保留**（重构后仍保留），长期可考虑抽为独立 `@worksplice/cwd-mutex`，不指望 SDK 提供。

---

## 5. 可委托 / 不可委托清单（带理由）

### 5.1 可委托 SDK（收敛后由 SDK 原生能力承载，worksplice 仅薄编排）

| # | 能力 | 现分散点 | 委托目标（SDK API） | 理由 | 风险 |
|---|---|---|---|---|---|
| D1 | 模型可用性枚举与过滤 | `app/api/models/route.ts:30-60` + `lib/model-scope.ts:57-97` | `ModelRuntime.getAvailable/getModels` + `resolveModelScopeWithDiagnostics`（已委托一半） | SDK 已有 `scopedModels` 一等公民（`AgentSessionConfig.scopedModels` + `cycleModel` scoped 轮转），再包一层 `visible` 是重复 | 低。需统一"空 patterns 回落全量"语义（已一致） |
| D2 | 模型目录与认证存储 | `app/api/models-config/*` 的 `models.json` 直读写 | `ModelRuntime.registerProvider/unregisterProvider + setRuntimeApiKey/removeRuntimeApiKey/login/logout` 运行时 API + `SettingsManager` 的磁盘持久 | `models.json` 的"文件形态"是实现细节，SDK 的 `registerProvider` 才是语义 API；直读写导致 `ModelRuntime` 缓存与文件不一致（需 `invalidateModelsCache` 补丁） | 中。需明确 `models.json` 仍由 SDK 的 `SettingsManager`/`ModelRuntime` 持久化，worksplice 不再手写文件 |
| D3 | 工具注册与激活 | `lib/tool-presets.ts:9-28` + `lib/rpc/caller.ts:90-95` withExtensionTools | `AgentSessionConfig.tools / allowedToolNames / excludedToolNames` + `AgentSession.setActiveToolsByName/getActiveToolNames/getAllTools` + `createCodingTools/createToolDefinition` | SDK 已有工具定义工厂与运行时激活，preset 硬编码与 `BUILTIN_TOOL_NAMES` 漂移风险可消除 | 低。preset 作为 UX 快捷保留，但不应再硬编码工具名，应调 `getAllTools().filter(t=>builtin)` 动态推导 |
| D4 | session 文件读写与上下文构建 | `lib/session-reader.ts:10-50` 的 `listAllSessions/buildSessionContext` 包装 + `lib/rpc/caller.ts:72-105` 的建 session 链 | `SessionManager.{create,open,list,listAll,buildContextEntries,buildSessionContext,branch,createBranchedSession}` | SDK 已是读写唯一入口；worksplice 的"projectRoot 解析 + cacheSessionPath"可在 SDK 之上薄封装，但不应重实现 listAll 扫描 | 低。保留 `cacheSessionPath/invalidateSessionListCache` 作为 web 侧优化 |
| D5 | skills 发现与加载 | `app/api/skills/route.ts:GET` + `lib/skills-service.ts` | `DefaultResourceLoader.getSkills/reload` + `loadSkills/loadSkillsFromDir/formatSkillsForPrompt` | 已是纯委托；worksplice 仅需 `trustReloadOptions` 编排 | 低 |
| D6 | packages/extensions/skills 的安装与解析 | `app/api/plugins/route.ts` + `app/api/skills/install/route.ts` | `DefaultPackageManager.resolve/install/remove/update` + `DefaultResourceLoader`（内部委托 PackageManager） | SDK 已有 `ResolvedPaths/ResolvedResource` 模型，worksplice 的 `isDisabledPackage` 仅是"空数组覆写"约定，可保留为 UI 层 | 低 |
| D7 | skills/prompts/themes 的资源编排 | `DefaultResourceLoader.extendResources/reload` | 同上，SDK 已支持 `additionalExtensionPaths` + `extensionsOverride` 注入 | 测试 seam 可用 `InMemorySettingsStorage`/`MemoryStorage` | 低 |
| D8 | compaction / branch 摘要 | `lib/rpc/session.ts` 的 `compact/reload` 透传 | `AgentSession.compact/abortCompaction + SessionManager.appendCompaction + compact/generateSummary` | SDK 已有阈值驱动的 `shouldCompact` + 手动 `compact(customInstructions?)`，worksplice 仅透传 | 低 |
| D9 | thinkingLevel 预算与可用性 | `app/api/models/route.ts` 的 `getSupportedThinkingLevels` + `lib/model-scope.ts:85-90` pins | `AgentSession.getAvailableThinkingLevels/supportsThinking/cycleThinkingLevel` + `Model.thinkingLevelMap` | SDK 已按 `provider/modelId` 的 `thinkingLevelMap` 做 clamp，worksplice 的 `thinkingLevelPins` 解析可合入 SDK 的 `ScopedModel.thinkingLevel` | 低 |
| D10 | auth 交互（OAuth device_code / api_key） | `app/api/auth/*` | `ModelRuntime.login(providerId, type, interaction)/logout` + `CredentialStore` | SDK 已有 `AuthInteraction { prompt/notify, signal }` 全流程，worksplice 仅需薄 SSE 透传 | 中（SSE device_code 轮询需保留 web 适配） |
| D11 | 路径常量 | `lib/data/dirs.ts` 等 | `getAgentDir/getSessionsDir/getSettingsPath/getAuthPath/getModelsPath` | SDK 已 canonical，worksplice 的 `DIRS` 重实现可删除 | 低 |

### 5.2 不可委托、必须保留在 worksplice 侧（raft 编排 / 进程模型 / 产品语义）

| # | 能力 | 现分散点 | 不可委托理由 | 证据 |
|---|---|---|---|---|
| N1 | per-cwd 启动互斥与 busy-cwd 串行 | `lib/agent-runtime.ts:150-169` `withCwdStartLock` + `lib/rpc/registry.ts:30-75` `hasBusyForCwd/trackStarting` | SDK 无 cwd 级互斥语义（`AgentSession` 单实例、`SessionManager` 多实例允许并存）；单进程多 agent 共享同一 `workspace_path` 是 raft 产品约束，串行是正确性要求 | `registry.ts:42-55` 注释"02-决策一/二"，`agent-runtime.ts:136-149` 大段注释 |
| N2 | `pi_session_file` 所有权门禁与脏绑定自愈 | `lib/agent-runtime.ts:62-130` `referencedSessionFiles/chooseSessionFileForStart` + `createRealAgentRuntime:294-310` | SDK 无"成员↔文件"所有权概念；共享 cwd 下"谁的文件归谁"、"软删成员文件不复用"、"跨 cwd 绑定自愈"是 ADR-0001/0003 的 raft 语义 | `agent-runtime.ts:100-130` 纯函数可测分支 4 条 |
| N3 | member→Wrapper 记账与状态现场推导 | `lib/agent-runtime.ts:194-211` `memberSessions: Map<memberId,Wrapper>` + `lib/agent-status.ts:20-60` `deriveLiveAgentStatus/publishAgentStatus/sweeper` | SDK 的 `isStreaming` 仅反映单实例，worksplice 需"按 member.id 而非 cwd"精确定位（同 cwd 上人类/pi 会话不张冠李戴）+ DB `error` 保留 + offline 回落；sweeper 补 idle shutdown 漂移 | `agent-runtime.ts:202-211` + `agent-status.ts:40-60` |
| N4 | 生命周期（Restart/SessionReset/FullReset/换目录/删身份） | `lib/agent-lifecycle.ts:30-120` | `Full reset` 的"仅家目录可清"、删身份的"只 rm 家目录"、换目录的"先校验新路径再销毁旧会话"均是 ADR-0001 目录两分产品规则；SDK 只有 `AgentSession.dispose/abort/reset` 原子操作 | `agent-lifecycle.ts:60-90` `isOwnHome` 判定 |
| N5 | rake 域全部（channels/members/messages/tasks/.../FTS5/freshness/mute/inbox/wake） | `lib/domain/raft/*` + `lib/data/store.ts/schema.ts/sqlite.ts` | SDK 无 raft 数据面（`Store` 契约 30+ 方法、`UNIQUE(target_id,seq)`、`trigger` 不可变、FTS5 全文、`channel_mutes/read_seq/consumed_seqs` 游标） | `store.ts:20-150` 接口清单，`schema.ts:10-50` SCHEMA_VERSION 11 |
| N6 | project-trust 门禁 | `lib/project-trust.ts:10-40` + `lib/rpc/caller.ts:72-85` 调用点 | SDK 的 `hasTrustRequiringProjectResources/ProjectTrustStore` 是检测与存储，但"何时 gate reload"的策略在 worksplice（`trustReloadOptions` 注入 `createAgentSessionServices`） | `project-trust.ts:20-40` 长注释 `#236` |
| N7 | 模型结果缓存与去重 | `lib/models-cache.ts:20-60` | SDK 无缓存层，每次 `createAgentSessionServices→getAvailable()` 都走网络/磁盘扫描；web 侧 `?cwd=` 高频触发需 60s TTL + inFlight 去重 | `models-cache.ts:30-50` `generation` 世代 |
| N8 | per-agent runtime 覆盖（provider/modelId/thinkingLevel） | `lib/agent-runtime.ts:305-320` `initialModel/thinkingLevel` 注入 `startRpcSession` | SDK 的 `createAgentSession({ model, thinkingLevel })` 支持，但"按 member 行覆盖全局默认"的编排是 raft 侧（`§3.10`） | `agent-runtime.ts:308-320` |
| N9 | `disable-model-invocation` 的写路径 | `app/api/skills/route.ts:40-110` frontmatter 手术 | SDK 仅 `loadSkills/formatSkillsForPrompt` 读路径，无 `updateSkill` 写 API；短期保留正则手术，长期推动 SDK 新增 `setSkillDisabled(name,bool)` | `skills/route.ts:60-90` |
| N10 | `models.json` 的"空 id 过滤" sanitize | `app/api/models-config/route.ts:20-40` | SDK 侧"空 id 导致整文件加载失败"是已知坑，但 SDK 未内建 sanitize；worksplice 的 `sanitizeModelsJson` 仍需保留直至 SDK 修复 | `models-config/route.ts:25-35` 注释 |
| N11 | 上游模型发现（OpenAI-compat `/models` 探测） | `app/api/models-config/discover/route.ts:30-90` | `buildModelsListUrl/parseDiscoveredModels/resolveModelDiscoveryAuth` 均不在 SDK（SDK 的 `ModelsStore` 仅缓存已配置 providers 的目录） | `discover/route.ts:30-60` |
| N12 | UI 侧三档 preset 的"产品快捷" | `lib/tool-presets.ts:9-34` | SDK 无 preset 概念，preset 作为"一键 none/default/full"交互快捷可保留，但工具名来源应改动态推导（`getAllTools`）而非硬编码 | `tool-presets.ts:13` 硬编码 |
| N13 | `globalThis` 热重载守卫 | `lib/rpc/*` + `lib/agent-runtime.ts` + `lib/models-cache.ts` 7 处 `globalThis.__xxx` | Next.js HMR 会重生模块，SDK 无感知；`__workspliceSessions/__workspliceAgentSessions/__workspliceModelsCacheState/__workspliceSessionListCache` 等必须保留 | 各文件 `declare global` 段 |

### 5.3 灰区 / 需新 ADR 的边界

| 话题 | 建议 | 涉及票 |
|---|---|---|
| `models.json` 直读写是否迁为 `ModelRuntime.registerProvider` 语义化 | ADR：`models.json` 作为"配置源"仍可直读写，但运行时变更走 `registerProvider/setRuntimeApiKey`，落盘由 SDK 负责，避免缓存不一致 | 04 |
| `tool-presets` 硬编码 → 动态推导 | 04 决策：`PRESET_FULL = [...allToolNames]` from SDK，`PRESET_DEFAULT` 由 product 定义但校验 `subsetOf(allToolNames)` | 04 |
| `PATCH /api/skills` 是否推动 SDK 提供写 API | 短期保留手术，长期 issue 到 pi：`SkillFrontmatter` 的写路径标准化 | 04 |
| `withCwdStartLock` 是否抽独立模块 | 06 决策：保留本地，命名 `lib/cwd-mutex.ts`，为 `agent-runtime` 与 `agent-loop/driver` 共用 | 06 |

---

## 6. 对后续票据的直接输入建议

### 6.1 对 04 `lib/rpc 与 model/skills/extensions 收敛边界`（grilling）

**必决策清单**：
1. **收敛 `caller` 的两段式跳跃**：将 `createAgentSessionServices → resolveVisibleModels → selectInitialModelScope → createAgentSessionFromServices` 收为单一 `createScopedAgentSession({ cwd, requestedModel?, thinkingLevel?, toolNames? })` 工厂（worksplice 侧封装，内部仍委托 SDK 三步），消除 `app/api/models/route.ts` 与 `caller.ts` 的重复 scope 链。证据：`caller.ts:72-105` 与 `models/route.ts:30-60` 完全同构。
2. **明确 `Wrapper` 保留厚度**：建议保留 Wrapper，但收窄为"进程内 lifecycle + idle + 扩展绑定 + running 广播"4 职责，`send` 的 27 分支中纯透传部分（`get_state/set_model/set_thinking_level/get_tools/set_active_tools/compact`）改为 `Proxy → inner` 直通，仅保留 `prompt/steer/followUp/abort/fork/navigate_tree/custom_ui` 的定制分支。
3. **工具 preset 去硬编码**：`tool-presets.ts:13` 的 `BUILTIN_TOOL_NAMES = new Set(PRESET_FULL)` 改为 `new Set(sdkAllToolNames)`（`import { allToolNames } from "@earendil-works/pi-coding-agent/core/tools"` 或 `getAllTools().map(t=>t.name)`），避免 SDK 新增 `apply_patch` 等工具后 preset 漂移。
4. **产出**：`docs/adr/000X-sdk-delegation-boundary.md`（记录 D1-D11 vs N1-N13 切分线）+ `lib/rpc/factory.ts`（新薄工厂）或 `lib/rpc/caller.ts` 瘦身。

**grilling 追问**：
- `tools: []`（全关）时 `forceEmptySystemPrompt` 的语义是否由 SDK 保证（`AgentSessionConfig.systemPromptOverride`）还是继续 Wrapper 手动？（现 `session.ts:65-75` + `caller.ts:98-105` 双重保证）
- `allowedToolNames` vs `setActiveToolsByName` 的两层过滤是否合一（当前 `toolsOption` 仅在 `[]` 时传，其余走 `setActiveToolsByName(withExtensionTools)`，心智负担高）。

### 6.2 对 05 `agent-loop 驱动模型重塑（token 成本/可靠性/可观测性）`

**SDK 侧可委托以降低 token 成本**：
- `AgentSession` 的 `compaction` 阈值（`SettingsManager.getCompactionReserveTokens/getCompactionKeepRecentTokens`）与 `shouldCompact` 可替代 loop 侧手工截断；`buildSessionContext` 已做压缩感知，`runAgentRound` 的 `buildReplyPrompt` 拼接可考虑改为 `sessionEntryToContextMessages` 流。
- `prepareNextTurn` / `transformContext` 钩子（`pi-agent-core/dist/types.d.ts:60-90` `AgentLoopConfig.transformContext/prepareNextTurn`）可在不改 `buildReplyPrompt` 文本的前提下做"上下文裁剪"，比文本层压缩更省 token。

**可靠性（不可委托，需 05 重塑）**：
- `withCwdStartLock + trackStarting + hasBusyRpcSessionForCwd` 的双层串行**不在** `agent-loop` 侧，而在 `agent-runtime + rpc/registry`；`agent-loop/driver` 的重试（`runAgentRound` 的 `revise/resend/silent/anyway` 四选一）与 busy-cwd 的等待是两套重试，需明确"谁对谁负责"（建议：runtime 负责"能不能起"，driver 负责"起了之后 freshness-hold 怎么办"）。
- `__workspliceAgentSessions` 按 `memberId` 记账（`agent-runtime.ts:194-211`）是 driver 正确 wake 的前提，若收敛为按 `cwd` 记账则共享 cwd 多 agent 场景必错。

**可观测性**：
- `AgentSession.getSessionStats/getContextUsage`（`agent-session.d.ts:80-100`）可直接暴露给 `members/[id]/observability`，替代 `session-stats.ts:1-80` 的 jsonl 只读解析（两者同源，但 SDK 版含 `usage` 账单）；保留 jsonl 解析仅作"无运行时"的备选。
- `AgentEvent` 的 `message_update/message_end/tool_execution_*` 可作为 `round_logs` 环形落盘的输入，比轮次结束才记更细。

### 6.3 对 06 `目标架构的分层与深模块切分`（grilling）

**建议分层**（`pi 管 pi, raft 管 raft` 落图）：

```
app/api/*  ──薄封装（仅 HTTP 适配 + allowFileRoot/projectTrust 校验）
    │
    ├─▶ lib/rpc (薄)        ── AgentSessionWrapper + RpcRegistry + RpcCaller(新工厂) + Subscriber/Broadcaster
    │        ▲                     ▲ 委托
    │        │                     └── @earendil-works/pi-coding-agent (SessionManager/AgentSession/ModelRuntime/ResourceLoader/PackageManager)
    │        │                             +
    │        │                         @earendil-works/pi-agent-core (Agent/ThinkingLevel)
    │        │                             +
    │        │                         @earendil-works/pi-ai (Model/Provider/CredentialStore)
    │
    ├─▶ lib/domain/raft/*   ── 唯一导入面 lib/domain/raft/index.ts（现已满足）
    │        │
    │        └─▶ lib/data   ── Store 契约 + SQLiteAdapter + schema v11（保留，不委托）
    │
    └─▶ lib/agent-loop/*    ── 深模块（driver/wake/backfill/cron 内聚，经 LoopRuntime 缝注入 SDK）
             │
             └─▶ lib/agent-runtime + lib/cwd-mutex + lib/agent-status/lifecycle
```

**深模块切分建议**：
- `lib/rpc` 保留 4 模块拆分（现 `session/registry/caller/subscriber+broadcaster` 已是深模块雏形），仅做"职责收窄"（caller 瘦身、Wrapper 直通）。
- `lib/data` 保留 `store.ts` 契约 + `sqlite.ts` 适配器 + `db-singleton.ts` 守卫 + `schema.ts` 迁移链（`02` 已论证 better-sqlite3 保留）。
- `lib/agent-loop` 不在本票展开，但其 `LoopRuntime` 对 `AgentRuntime` 的" findSession/findBusySessionForCwd" 依赖应明确为 `lib/agent-runtime.ts:19-30` 的子集，避免环。

**导入面纪律**（延续现有）：
- `lib/domain/raft/index.ts` 唯一对外 `export *`，子模块间相对路径直引、不经索引回环（`AGENTS.md: lib/domain/raft/index.ts` 约定）。
- `lib/data/db-singleton.ts:getDb(): Store` 不经 `lib/domain/raft/index.ts`（避免 raft↔data 环）。

---

## 7. 术语与 ADR 建议

- **新增术语**（经 `domain-modeling` 落 `CONTEXT.md`）：`中层底座 / 委托边界 / 薄工厂 / 所有权凭证（pi_session_file）/ busy-cwd 串行 / starting 窗口`。
- **新增 ADR**：
  - `ADR-000X SDK 委托边界`（D vs N 清单 + 证据索引，关联 04）。
  - `ADR-000Y cwd 互斥与归属门禁保留`（`withCwdStartLock + trackStarting + chooseSessionFileForStart` 为何不委托，关联 04/06）。

---

## 8. 风险与未决项（供 orchestrator 在 04 grilling 中拍板）

| 风险 | 说明 | 缓解 |
|---|---|---|
| `models.json` 直读写与 `ModelRuntime` 缓存不一致 | `app/api/models-config/route.ts:PUT` 写文件后仅 `invalidateModelsCache`，`ModelRuntime` 实例仍持有旧 `models` 快照 | 04 决策：写后 `ModelRuntime.refresh()` 或统一走 `registerProvider` 语义化 |
| `BUILTIN_TOOL_NAMES` 漂移 | `tool-presets.ts:13` 硬编码 7 工具，SDK 新增工具后 preset 误判 | 04 决策：改动态推导 |
| `__worksplice*` globalThis 闭包旧监听器持有旧 `runAgentRound` | `AGENTS.md: 热重载陷阱` 已记录，wake 监听器 `started` 守卫 + `__workspliceWakeListeners` 闭包 | 06 决策：`agent-loop/driver` 的 `createAgentLoop().start()` 改为可重订阅（或 dev 侧提示重启） |
| `PATCH /api/skills` 手术与 SDK 未来 `updateSkill` 冲突 | 正则手术 `^disable-model-invocation:.*\n` 可能误删用户自定义同名前缀 | 短期保留，校验 `parseFrontmatter` 后仅当行精确匹配再删 |

---

*产出：`.scratch/pi-sdk-rebuild/research/01-pi-sdk-capability-boundary.md`（本文件）*
*上游：`.scratch/pi-sdk-rebuild/issues/01-pi-sdk-capability-boundary.md`（Question）*
*下游：`issues/04-rpc-boundary-and-sdk-delegation.md`、`05-agent-loop-reshaping-cost-reliability-observability.md`、`06-target-architecture-deep-modules.md` 的事实输入*
*版本：`@earendil-works/pi-*@0.83.0`（`package.json:42-45`）*
*日期：2026-08-20*
*证据条数：约 45 处 `文件:行号` 一级来源*
