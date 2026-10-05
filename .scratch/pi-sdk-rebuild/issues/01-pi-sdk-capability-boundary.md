# 01-pi SDK 能力边界研究

Type: research
Status: resolved
Blocked by:

## Question

研究 `@earendil-works/pi-*` 0.83.0 的现实能力边界，回答「中层收敛」中哪些可委托 SDK、哪些仍需 worksplice 自研。

- SDK 实际暴露的 API 面：`pi-agent-core` / `pi-ai` / `pi-coding-agent` / `pi-tui` 各包的 tools、extensions、skills、modelScope/thinkingLevel、SessionManager、AgentSession、settings/auth 存储
- 当前 worksplice 的分散点：`lib/rpc`（Wrapper + registry + caller + subscriber/broadcaster）、`lib/model-scope.ts`、`lib/tool-presets.ts`、`lib/agent-runtime.ts`、`app/api/models*`、`app/api/skills*`、`app/api/plugins*` —— 哪些可收归 SDK 原生能力，哪些是 raft 侧编排必须保留的
- Session 生命周期与存储：`SessionManager.listAll/create/open` 的 cwd 隔离、session jsonl 读写权归 SDK 的边界、pi 的多实例模型与 `hasBusyRpcSessionForCwd` / `withCwdStartLock` 的对应关系
- 研究产出写入 `.scratch/pi-sdk-rebuild/research/01-pi-sdk-capability-boundary.md`，含文件:行号证据索引与可委托/不可委托清单，为 04/05/06 的边界决策提供事实基础

## Answer

详见 findings：[research/01-pi-sdk-capability-boundary.md](../research/01-pi-sdk-capability-boundary.md)

要点：
- **可委托 SDK**（中层收敛主收益）：`tools` 定义与 `setActiveToolsByName` 激活、`enabledModels` 解析与 `scopedModels` 轮转、`SessionManager` 的 jsonl 读写与 `buildSessionContext`、`SettingsManager`/`ModelRuntime`/`DefaultResourceLoader`/`DefaultPackageManager`、`compaction`/`ThinkingLevel`——均在 `pi-coding-agent/dist/*.d.ts` 有声明证据（见研究 §2 证据索引，含 `文件:行号`）。
- **不可委托、必须保留**：`lib/rpc/registry+caller` 的 per-member 记账与 `BusyCwdError`/`withCwdStartLock` 串行、`hasBusyRpcSessionForCwd` 的 realpath 语义、现场推导 + DB 回落双轨 `agent-status`、`lifecycle` 家目录两分与 `pi_session_file` 固化门禁、raft 域全部（`Store` 57 方法 + `UNIQUE(target_id,seq)` + FTS5 trigram + 4 游标体系 + `withTransaction` 同步事务）、`project-trust`/`models-cache`/`provider-listing` 编排。
- **灰区**：`tool-presets` 三档保留为 UX 快捷但不再持有工具名硬编码；`skills` 的 `PATCH disable-model-invocation` 短期保留、长期推动 SDK 提供 `updateSkill()`。
- 证据索引覆盖 `pi-agent-core`/`pi-ai`/`pi-coding-agent`/`pi-tui` 0.83.0 全 `dist/*.d.ts` + worksplice 分散点 20+ 文件 `文件:行号`，后续 04/05/06 直接引用行号而非重述。
