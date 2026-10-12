# Worksplice 上下文保留与成本机制审计

**审计对象**：协作成员 agent-loop 与 Pi coding session 两条路径。
**代码基线**：本研究分支从 `c7fa01a`（`main` 当前 HEAD）隔离；[`package.json`](../../../package.json#L56-L60) 固定 Pi 四包为 `0.99.2`。
**证据规则**：**代码保证**=当前仓库实现/测试；**SDK 默认**=Pi 官方 `v0.99.2` 文档所述默认，仍可能被设置覆盖；**提示约定**=文本要求模型做、没有执行机制保证；**暂无证据**=本次审计的仓库代码、测试、项目文档及 Pi 官方文档未发现相应能力。引用均指向源码符号或一手文档。

## 结论摘要

1. **两条路径都由 Pi 的持久 session 保留活动会话历史，并由 SDK 负责 compaction。** compaction 改变模型后续可见的上下文投影，不删除 JSONL 原始 entry；但显式 Session reset / session 删除会删文件，因此“历史完整可追溯”不是无条件保证。[`RpcCaller.start`](../../../lib/rpc/caller.ts#L63-L69)；[Pi Sessions](https://github.com/earendil-works/pi/blob/v0.99.2/packages/coding-agent/docs/sessions.md)；[Pi Compaction Reference](https://github.com/earendil-works/pi/blob/v0.99.2/packages/coding-agent/docs/compaction.md)
2. **agent-loop 的每轮新 prompt 虽主要只包含增量消息，但旧轮仍留在同一 Pi session 的活动分支中，直到 SDK compact 或用户重置。** 同时目前 `drain` 无分页上限；每条消息 4,000 字符截断不限制条数，因此 backlog、反复注入的环境列表/任务摘要及工具结果仍可放大输入。[`runAgentRound` / `buildReplyPrompt`](../../../lib/agent-loop/loop.ts#L273-L329)；[`drain`](../../../lib/domain/collab/inbox.ts#L32-L60)
3. **MEMORY.md 是持久文件，不是每轮注入的记忆机制。** 创建与 Full reset 保留由代码保证；每轮只在文件存在时给出路径，并提示模型“需要时读取、进展后更新”，读写与更新都不是代码保证。未发现自动提取、校验或自动检索流水线。[`createAgent`](../../../lib/domain/collab/members.ts#L150-L207)；[`agentMemoryFile` / `buildReplyPrompt`](../../../lib/agent-loop/loop.ts#L443-L449)
4. **Pi coding session 有会话级累计 token/cost 与当前 context usage；agent-loop 当前没有已实现的每轮 token/cost 字段。** `round_logs` 仅含状态/原因/房间版本/时间；尽管部分 ADR/spec 写着已有 token/cost 列，当前 schema、Store 和 UI 类型均不支持，文档与代码不一致。[`SCHEMA_VERSION` / `round_logs`](../../../lib/data/schema.ts#L3-L3)；[`round_logs` DDL](../../../lib/data/schema.ts#L83-L94)；[`RoundLogRow`](../../../lib/data/types.ts#L120-L129)；[`insertRoundLog`](../../../lib/data/sqlite.ts#L797-L820)；[ADR-0005](../../../docs/adr/0005-agent-loop-reshaping-cost-reliability-observability.md#L5-L14)
5. **安全基线可用合成文件与 fake runtime 测，但现有测试不测关键事实召回率或任务质量。** 代码/测试能够建立 prompt 形状、session usage 解析、compaction 记录和 reset 行为的机制基线；没有无真实 provider 请求的模型行为/质量基线，也没有本票确定的指标阈值。[`session-stats.test.mjs`](../../../lib/session-stats.test.mjs#L15-L19)；[`loop.test.mjs`](../../../lib/agent-loop/loop.test.mjs#L265-L280)；[`agent-lifecycle.test.mjs`](../../../lib/agent-lifecycle.test.mjs#L9-L14)

## 1. 协作成员 agent-loop

### 每轮上下文如何构造

- **代码保证**：`drain(agentId, targetId)` 从持久化 `consumed_seqs` 之后取目标内全部可见新消息，`hasMore` 恒为 false；没有分页或条数上限。通常过滤 agent 自己的消息后，将新消息、当前目标未完结任务、频道/成员列表和默认模型信息拼为一条文本 prompt，再发送到 agent 当前 Pi session。相关定义见 [`drain`](../../../lib/domain/collab/inbox.ts#L16-L60)、[`listRelatedTasks`](../../../lib/domain/collab/inbox.ts#L97-L119)、[`replyPromptContext`](../../../lib/agent-loop/loop.ts#L312-L329)、[`buildReplyPrompt`](../../../lib/agent-loop/loop.ts#L331-L449) 与 [`runAgentRound`](../../../lib/agent-loop/loop.ts#L1179-L1289)。
- 每条 incoming/revision 消息内容最多注入 **4,000 个 JS 字符**；频道与成员列表各显示最多 100 项，超过后只加数量提示；任务预览默认是首行最多 80 字符。**这些是内容/列表截断，不是整轮 token 上限**。消息条数、相关任务数与先前 Pi transcript 长度没有本地上限。[`MESSAGE_CONTENT_CAP` 与格式化](../../../lib/agent-loop/loop.ts#L273-L309)；[`previewLine`](../../../lib/preview.ts#L1-L5)；[`listRelatedTasks`](../../../lib/domain/collab/inbox.ts#L101-L119)
- **跨轮累积**：`runAgentRound` 每次对同一成员 session 调 `session.send({type:"prompt", message})`；Pi 将用户/assistant/tool messages 追加到活动分支。故“本轮只 drain 新消息”不等于“模型只看本轮消息”：之前轮次 prompt、JSON 回复、工具调用/结果和补充 prompt，在 compact 前仍可进入后续请求。该路径没有在轮次边界新建 session 或自动 compact 的代码。[`promptSession`](../../../lib/agent-loop/loop.ts#L639-L668)；[`runAgentRound`](../../../lib/agent-loop/loop.ts#L1278-L1318)；[`AgentSessionWrapper.send(prompt)`](../../../lib/rpc/session.ts#L498-L538)；[Pi How Pi Works—Agent loop/Context](https://github.com/earendil-works/pi/blob/v0.99.2/packages/coding-agent/docs/how-pi-works.md#agent-loop)
- **重复注入/额外调用**：每轮再次注入当前频道列表、成员列表、default model 和相关开放任务；可选 `search` op 走最多一次 observation prompt；freshness hold 默认可重写最多 2 次（最多 3 次含首 prompt）。当前源常量为 `MAX_REVISE_RETRIES=2`、`MAX_RESEND_RETRIES=3`、`MAX_TASK_STATUS_RETRIES=3`。后两类 resend/状态重试不必然增加模型调用，但 revise 与 observation 会。见 [`buildReplyPrompt`](../../../lib/agent-loop/loop.ts#L386-L449)、[`applyMemberOps`](../../../lib/agent-loop/loop.ts#L498-L580)、[`deliverWithFreshness`](../../../lib/agent-loop/loop.ts#L694-L821)。
- **按需检索而非自动检索**：全局消息全文搜索与 loop 的 search op 存在；agent 需要在结构化回复中主动声明，search 命中才会在同轮 observation prompt 返回，最多一个观察阶段。它不自动查询历史/其他频道，也不能保证模型会调用。[`buildReplyPrompt` 搜索约定](../../../lib/agent-loop/loop.ts#L432-L439)；[`searchMessages`](../../../lib/domain/collab/search.ts#L6-L51)

### Compact、保留、恢复

- **SDK 默认**：项目依赖 Pi `0.99.2`。Pi 默认 `compaction.enabled=true`，当 projected context 超过 `contextWindow - reserveTokens` 时 compact，默认保留约 `keepRecentTokens=20,000`；`reserveTokens` 默认 16,384。全局/项目 settings 与 per-model overrides 可改阈值；关闭自动 compact 不关闭手动 compact。[Pi Compaction Reference—When It Triggers/Settings](https://github.com/earendil-works/pi/blob/v0.99.2/packages/coding-agent/docs/compaction.md#when-it-triggers)
- **Worksplice 未覆盖该默认**：`RpcCaller.start` 创建 SDK services/session 时没有在此路径传 compaction 专用设置；包装器暴露当前 `autoCompactionEnabled`、手动 `compact` 和 `set_auto_compaction` 命令。真实有效值受 Pi user/project settings 或显式 RPC 改动影响，所以“自动 compact 一定开启”是 SDK 默认，不是 Worksplice 保证。[`RpcCaller.start`](../../../lib/rpc/caller.ts#L119-L160)；[`get_state` / `compact` / `set_auto_compaction`](../../../lib/rpc/session.ts#L545-L575)；[`AgentSessionWrapper.send`](../../../lib/rpc/session.ts#L660-L716)
- **原始记录与活动上下文分离**：Pi append `compaction` summary 与 `firstKeptEntryId`，未来上下文以 summary + 保留边界后的 entry 重建；原 session tree entries 保留。Pi 的 `context_edit` 同样只影响以后模型上下文投影，原目标 entry 仍在 raw history/export/session accounting 中。[Pi Session File Format—CompactionEntry/ContextEditEntry/Context Building](https://github.com/earendil-works/pi/blob/v0.99.2/packages/coding-agent/docs/session-format.md#compactionentry)；[Pi Compaction Reference](https://github.com/earendil-works/pi/blob/v0.99.2/packages/coding-agent/docs/compaction.md#how-it-works)
- **Worksplice 崩溃补拉范围有限**：prompt 带 `[worksplice:target=… seq=…]` 标记。`scanSessionReplies` 按每个标记轮保留最后一条 assistant 文本；`backfillAgentReplies` 将缺失回复补入协作 SQLite、推进消费游标并去重。它恢复的是“遗漏的协作回复”，不是把 session 全 transcript/compact summary 恢复为 inbox 或结构化知识。[标记定义](../../../lib/agent-loop/loop.ts#L156-L162)；[`scanSessionReplies` / `backfillAgentReplies`](../../../lib/agent-loop/loop.ts#L2033-L2051)；[`applyBackfillTarget`](../../../lib/agent-loop/loop.ts#L2216-L2260)；[回归用例](../../../lib/agent-loop/backfill.test.mjs#L156-L275)

### MEMORY.md 生命周期与强度

- **代码保证**：正常创建 agent 时在其专属家目录预置固定六节模板；`agentMemoryFile()` 只检查 home 下 `MEMORY.md` 是否存在，不读取文件正文。prompt 仅包含路径与读取/更新指令。因此正文不随每轮 prompt 自动重复，读取成本由模型按需承担。[`buildMemoryTemplate`](../../../lib/data/dirs.ts#L96-L100)；[`createAgent`](../../../lib/domain/collab/members.ts#L190-L207)；[`agentMemoryFile`](../../../lib/agent-loop/loop.ts#L1173-L1177)
- **提示约定**：prompt 建议“需要身份或工作背景时读；有实质进展后更新 `## Current work`，完成时清掉；会话重置后仍在”。没有写入 API/触发器保证模型真的读或更新。[`buildReplyPrompt`](../../../lib/agent-loop/loop.ts#L443-L449)；[ADR-0001](../../../docs/adr/0001-agent-home-and-shared-project-directories.md#L12-L12)
- **重置**：Session reset 删除成员绑定 session 文件和 cwd 下未被任何成员 `pi_session_file` 引用的 session 文件；不清 workspace 文件。Full reset 只允许 home workspace，清 home 内容但跳过 `MEMORY.md`。相反，删除 agent 的代码只在当前 workspace 被判为本 agent home 时 rm 该目录；若已绑定 project workspace，未看到它另行删除派生 home 的代码，和 ADR 描述的“删除身份删除家目录”存在实现/文档差异。[`clearSessionFilesForAgent` / `fullResetAgent`](../../../lib/agent-lifecycle.ts#L44-L94)；[`deleteAgentIdentity`](../../../lib/agent-lifecycle.ts#L114-L127)；[ADR-0001](../../../docs/adr/0001-agent-home-and-shared-project-directories.md#L7-L12)
- **共享目录删除范围需留意**：`removeSessionFilesForCwd` 删除同 cwd 下未被任一成员行引用的 Pi session 文件。成员 reset 在共享 project cwd 执行时，代码层所有权检查看的是 agent 登记，不区分“人类 Pi coding session”；因此未登记的人类 session 也落入可删除集合。现有 lifecycle 测试验证旧 session 删除/新建，但未覆盖 shared cwd 中人类 session 的保留。[`removeSessionFilesForCwd`](../../../lib/agent-runtime.ts#L324-L335)；[`sessionResetAgent`](../../../lib/agent-lifecycle.ts#L53-L60)；[`sessionResetAgent` 测试](../../../lib/agent-lifecycle.test.mjs#L125-L166)
- **暂无证据**：未发现通用成员 MEMORY.md 的自动事实抽取、格式/事实校验、按需检索索引或回写摘要机制。README/秘书资料是内容模板或专用引导，不能视为通用记忆机制。[`MEMORY_FILE_NAME` 的创建/提示/重置调用点](../../../lib/domain/collab/members.ts#L190-L207)；[`loop.ts` memory path](../../../lib/agent-loop/loop.ts#L1173-L1177)；[ADR-0001](../../../docs/adr/0001-agent-home-and-shared-project-directories.md#L12-L12)

## 2. Pi coding session（人类 coding 会话）

### 活动上下文

- **代码保证**：Worksplice 用 `SessionManager.open(sessionFile)` 续开已存在文件，或 `SessionManager.create(cwd)` 新建；随后以 Pi `createAgentSessionServices` 与 `createAgentSessionFromServices` 建立 session。App 的 `prompt` 命令进入 SDK，同一 active branch 继续增长。[`RpcCaller.start`](../../../lib/rpc/caller.ts#L39-L69)；[`createAgentSessionServices`](../../../lib/rpc/caller.ts#L119-L160)；[`AgentSessionWrapper.send(prompt)`](../../../lib/rpc/session.ts#L498-L538)
- **SDK 默认**：每次请求组合 active branch 对话、system prompt、工具定义、skill descriptions、发现的 context files 与模型设置；Pi 只把当前 branch 送入上下文，不把 session 中所有 branch 一股脑送入。完整 skill 指令按需加载。对 coding session 而言，工具结果、bash 结果、图片/选中文本也可能成为历史消息。[Pi How Pi Works—Context](https://github.com/earendil-works/pi/blob/v0.99.2/packages/coding-agent/docs/how-pi-works.md#context)；[Pi Sessions—Manage conversation context](https://github.com/earendil-works/pi/blob/v0.99.2/packages/coding-agent/docs/sessions.md#manage-conversation-context)
- **context files 与 MEMORY.md 区分**：Pi 自动发现 agent directory、cwd 和父目录中的 `AGENTS.md`/`CLAUDE.md` 等 context 文件；没有把 Worksplice 家目录 `MEMORY.md` 作为默认 context-file 名称。Worksplice 的成员 loop 显式给模型 MEMORY 路径；普通 Pi coding session 无此应用层注入。[Pi Configuration—Context files](https://github.com/earendil-works/pi/blob/v0.99.2/packages/coding-agent/docs/configuration.md#context-files)；[`agentMemoryFile`](../../../lib/agent-loop/loop.ts#L1173-L1177)

### Compact 与 raw history

- **SDK 默认**：自动 compact 在新 prompt 前、工具轮间阈值检查，以及 context overflow/length recovery 中可能触发；手动 compact 可附自定义指示。Pi 也能在 branch 导航时生成 branch summary。生成 compact/branch summary 的模型调用自身 usage 会记入会话总量。[Pi Compaction Reference](https://github.com/earendil-works/pi/blob/v0.99.2/packages/coding-agent/docs/compaction.md)
- **代码保证**：RPC wrapper 的 `compact` 转发至 `inner.compact(customInstructions)`；coding UI 调用 compact 并展示 tokens before/estimated after；Pi 两类 compaction 事件均向 UI 透传并更新 busy/compacting 状态。[`compact` command](../../../lib/rpc/session.ts#L660-L668)；[`useAgentSession` compact/stats](../../../hooks/useAgentSession.ts#L1450-L1568)；[`RUNNING_STATE_EVENT_TYPES`](../../../lib/rpc/session.ts#L90-L105)
- **记录查阅**：Pi `SessionManager` 保存 JSONL entry tree；Worksplice session GET 使用 `SessionManager.getEntries()` + SDK `buildSessionContext()` 显示活动上下文，并另提供指定 leaf 的 context、Pi 导出 HTML 和删除 session 路由。`context_edit` 与 `usage` 在 Worksplice 对话气泡中不显示（前者是上下文账本，后者是 billing metadata），但 raw session file/export 另有记录面。[`buildSessionContext` / `entryToUiMessage`](../../../lib/session-reader.ts#L285-L321)；[`context_edit` / `usage` display handling](../../../lib/session-reader.ts#L428-L436)；[`GET /api/sessions/[id]`](../../../app/api/sessions/[id]/route.ts#L116-L167)；[`context` route](../../../app/api/sessions/[id]/context/route.ts#L5-L27)；[`export` route](../../../app/api/sessions/[id]/export/route.ts#L241-L280)
- **显式删除例外**：Pi compact 不删旧 entries，但 Worksplice `DELETE /api/sessions/[id]` 会 unlink session 文件；agent Session reset/Full reset 也可能删除文件。故原文可追溯依赖文件未被显式删掉。[DELETE session](../../../app/api/sessions/[id]/route.ts#L197-L244)；[agent reset](../../../lib/agent-lifecycle.ts#L53-L94)；[Pi Session File Format—Deleting Sessions](https://github.com/earendil-works/pi/blob/v0.99.2/packages/coding-agent/docs/session-format.md#deleting-sessions)

## 3. 原始记录、搜索与恢复

- **协作消息**：消息写入 SQLite `messages`，schema 建立 `messages_no_update` 与 `messages_no_delete` 触发器；FTS5 trigram 建索引，服务层 `searchMessages` 提供带归属/作者的结果，限最多 50 条。只要 DB 保留，原协作消息可以全文检索；但 agent-loop 不自动把全部命中带入每轮上下文，需主动 search op。数据文件/DB 被外部删除不在这些触发器保护范围。[`messages` schema / immutability / FTS triggers](../../../lib/data/schema.ts#L42-L49)；[immutability triggers](../../../lib/data/schema.ts#L154-L169)；[`searchMessages`](../../../lib/domain/collab/search.ts#L6-L51)
- **Pi transcript**：append-only session tree 持有原始消息、工具结果、compaction、usage 与 context_edit；active context projection 可以省略/替换历史消息但原始 target 保留。Worksplice `buildSessionContext` 调 Pi projection，branch UI 展示活动路径而非完整 raw file；通过 session entry/tree/export 可进一步追溯。[Pi Session File Format—Context Building](https://github.com/earendil-works/pi/blob/v0.99.2/packages/coding-agent/docs/session-format.md#context-building)；[`buildSessionContext`](../../../lib/session-reader.ts#L285-L321)
- **可恢复范围不同**：agent-loop backfill 利用 marker 补写协作 reply；coding session 则由 Pi 的 JSONL/SessionManager 重开。两者都不是将所有原文自动浓缩为可查询、可验证的“关键事实”索引。[`backfillAgentReplies`](../../../lib/agent-loop/loop.ts#L2262-L2301)；[`RpcCaller.start`](../../../lib/rpc/caller.ts#L63-L69)；[Pi SessionManager persistence](https://github.com/earendil-works/pi/blob/v0.99.2/packages/coding-agent/docs/sdk.md#sessionmanager-api)

## 4. Token、成本与上下文可观测性

### coding session 与 session 聚合

- **SDK / live API**：`get_session_stats` 给出整份 session 的 input/output/cacheRead/cacheWrite/total token、cost 与当前 `contextUsage`；当前 context usage 会在 compact 后、下一次有效 assistant usage 前暂时未知（token/percent 为 null）。Worksplice `get_state` 暴露当前 contextUsage；`get_session_stats` wrapper 暴露 SDK 累计统计。[Pi RPC—get_session_stats](https://github.com/earendil-works/pi/blob/v0.99.2/packages/coding-agent/docs/rpc-commands.md#get_session_stats)；[`get_state` / `get_session_stats`](../../../lib/rpc/session.ts#L545-L570)；[`get_session_stats` dispatch](../../../lib/rpc/session.ts#L678-L683)
- **代码保证**：`parseSessionFileStats` 只读解析 JSONL；统计 assistant `message.usage` 与 compaction/branch_summary usage；standalone `usage` 只加 cost，不把 cache-warm 等 token 混入上下文 token 桶；另外累加 compaction count 和 `tokensBefore`。统计 API 在 Agent 详情页聚合展示。[`parseSessionFileStats`](../../../lib/session-stats.ts#L100-L155)；[`addUsage` / `addCostOnly`](../../../lib/session-stats.ts#L39-L91)；[`session-stats.test.mjs`](../../../lib/session-stats.test.mjs#L39-L116)；[observability route](../../../app/api/members/%5Bid%5D/observability/route.ts#L7-L62)
- **归属限制**：`listAgentSessionFiles` 将 agent 绑定文件与其 workspace cwd 下全部 Pi session 文件合并。共享 project cwd 时，agent 的汇总可能包括同 cwd 的其他成员/人类 session；这是按路径聚合而不是严格按 agent session ownership 的口径。[`listAgentSessionFiles`](../../../lib/session-stats.ts#L185-L217)；[`agent-runtime` session ownership`](../../../lib/agent-runtime.ts#L54-L69)
- cost 缺失会表现为 0（不区分“真零费用”和 JSONL/模型未记录 cost）；项目 baseline 文档本身也提示过这一点。因此数值只能按 usage 元数据解读，不等价于 provider 账单核对。[`readUsage`](../../../lib/session-stats.ts#L39-L70)；[历史成本基线注释](../../../docs/cost-monitoring-baseline.md#L24-L39)

### agent-loop 每轮

- **当前实现事实**：`round_logs` 持久化每 agent 最近 200 个有结论轮次的 `status/reason/base_seq/target/time`，瞬态 noop/skipped/busy 不记录；service/UI 类型没有 `prompt_tokens`、`completion_tokens`、`cost`。因此可看轮次结果/失败原因，不能从当前产品 API 按轮查看 token/cost。[`logRoundOutcome` / retention`](../../../lib/domain/collab/rounds.ts#L6-L17)；[`RoundLogRow`](../../../lib/data/types.ts#L120-L129)；[`round_logs` DDL](../../../lib/data/schema.ts#L83-L94)；[`RoundLogsList`](../../../components/AgentDetailPanel.tsx#L134-L148)
- agent 详情页的 session usage 是文件级累计值，live 区域只显示存活 session 当前 context usage；没有 round 级前后差值或每次模型请求 token 事件与 round id 的关联。[`aggregateAgentUsage`](../../../lib/session-stats.ts#L227-L234)；[observability payload](../../../app/api/members/%5Bid%5D/observability/route.ts#L19-L60)
- **文档漂移**：ADR-0005/`docs/spec-rebuild.md` 记载 `round_logs` 新增三成本列、最近 20 条 prompt cap、较低 retry 次数；当前 `schema.ts` 为 v14 且无三列，`loop.ts` 仍有 revise=2/resend=3/status=3，`inbox.drain` 无消息条数上限。需以当前源码而非规划/旧验收文字作为“已实现”依据。[ADR-0005](../../../docs/adr/0005-agent-loop-reshaping-cost-reliability-observability.md#L5-L14)；[spec-rebuild](../../../docs/spec-rebuild.md#L58-L84)；[`loop.ts` retry constants](../../../lib/agent-loop/loop.ts#L694-L695)；[`MAX_TASK_STATUS_RETRIES`](../../../lib/agent-loop/loop.ts#L850-L852)；[`drain`](../../../lib/domain/collab/inbox.ts#L32-L60)

## 5. 可建立的基线与未覆盖指标

| 维度 | 现有可用证据 | 限制 |
|---|---|---|
| prompt 形状/截断/任务和频道语境 | `buildReplyPrompt` 单测及 fake runtime；可在不调模型时断言注入文本 | 不测实际 tokenizer token 数、模型是否遵循 |
| session usage / cost / compaction 解析 | `session-stats.test.mjs` 在 OS 临时目录造合成 JSONL；包含 usage、compaction、aggregate 与损坏行用例 | 仅验证解析口径；不是实时 provider 账单，也不是每轮 attribution |
| agent reply 崩溃恢复 | `backfill.test.mjs` 用合成 JSONL 与临时 DB，覆盖 idempotency、marker、ignore/revise 与游标 | 只恢复协作回复和游标，不恢复完整语义状态/记忆 |
| reset 和 MEMORY 生命周期 | lifecycle tests 用临时目录、临时 DB、fake runtime | shared cwd 中的人类 session 保留与已绑定 project 后 home 清理未覆盖 |
| 关键事实召回 / 任务质量 | 业务有消息、任务、状态时间线与搜索 | 未发现检索 recall rubric、事实保留/召回评测集、任务质量评分或回归阈值 |

现有 `docs/cost-monitoring-baseline.md` 是 **2026-08-13 的历史全周期 session aggregate 快照**，并明确成本为 0 也可能是没有 cost metadata；它不是此代码 HEAD 的刷新基线，也不含每轮成本、关键事实召回或任务质量。代码/合成测试可以建立安全的机制基线而不读取用户目录；实际模型输入/输出 token 与任务质量仍需另行定义可复现测试条件，数值阈值按用户约束暂未定。[`cost-monitoring-baseline.md`](../../../docs/cost-monitoring-baseline.md#L12-L39)；[合成统计测试](../../../lib/session-stats.test.mjs#L15-L19)；[fake runtime prompt 测试](../../../lib/agent-loop/loop.test.mjs#L265-L280)

## 6. 不读取用户 session 数据的限制声明

本审计只读取当前隔离 worktree 的仓库源码、配置、项目文档、测试和 Pi 官方 `v0.99.2` 文档；**没有读取、枚举、stat、解析或打开 `~/.pi` / `~/.worksplice` 下任何真实用户会话/数据库文件**，也没有启动 Worksplice 服务。项目中的历史基线文档和合成测试 fixture 仅作为仓库证据引用。
