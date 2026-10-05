# 03-现状盘点与库存量扫描

> 基线时间：2026-08-20 · `SCHEMA_VERSION 11` · `npm test` 347 用例全绿  
> 口径：`wc -l` + `grep -rn` 手工扫描事实，不做决策；后续 ticket 直接引用本文件行号而非重述盘点。数据以 evidence index 为准。

---

## 0. Evidence Index（文件:行号）

| # | 文件 | 行号 | 说明 |
|---|------|------|------|
| E01 | `lib/data/schema.ts:3` | 3 | `SCHEMA_VERSION = 11` |
| E02 | `lib/data/schema.ts:9-266` | 9 | 整份 schema 定义（含表/虚拟表/触发器/迁移/seed） |
| E03 | `lib/data/store.ts:35-242` | 35 | `Store` 接口完整定义 |
| E04 | `lib/data/store.ts:9-33` | 9 | 数据层共享类型 import 段（契约只依赖 `lib/data/types.ts`） |
| E05 | `lib/data/types.ts:10-230` | 10 | 共享类型 + `toFtsQuery`/`buildSearchSnippet` 纯函数 |
| E06 | `lib/data/sqlite.ts:1-994` | 1 | `SQLiteAdapter implements Store` 全实现 |
| E07 | `lib/data/sqlite.ts:987-994` | 987 | `openSqliteAdapter` / `openDataDb` 工厂 + `__workspliceDbOpenedVersion` 版本戳 |
| E08 | `lib/data/db-singleton.ts:19-24` | 19 | `getDb(): Store` 单例守卫（比对 `SCHEMA_VERSION` 重建） |
| E09 | `lib/data/db-singleton.ts:8-10` | 8 | `__workspliceDb` 挂 globalThis |
| E10 | `lib/data/dirs.ts:1-57` | 1 | 数据目录解析 + `agentSlug`/`agentHomeDir`/`buildMemoryTemplate` |
| E11 | `lib/rpc/session.ts:1-1038` | 1 | `AgentSessionWrapper` 主体 |
| E12 | `lib/rpc/session.ts:28-57` | 28 | `AgentEvent` 类型 |
| E13 | `lib/rpc/session.ts:90-128` | 90 | `RpcSessionStartOptions` + `withExtensionTools` |
| E14 | `lib/rpc/session.ts:144-863` | 144 | `AgentSessionWrapper` 类（27 分支 `send` + lifecycle） |
| E15 | `lib/rpc/registry.ts:6-141` | 6 | `RpcRegistry` + `globalThis.__workspliceSessions / __workspliceStartingSessionCwds` |
| E16 | `lib/rpc/registry.ts:125-138` | 125 | 兼容函数 `getRpcSession / hasBusyRpcSessionForCwd / findBusyRpcSessionForCwd / destroyRpcSessionsForCwd` |
| E17 | `lib/rpc/caller.ts:1-197` | 1 | `RpcCaller.start = startRpcSession`（SDK 委托起点） |
| E18 | `lib/rpc/caller.ts:30-31` | 30 | `globalThis.__workspliceStartLocks` 并发启动锁 |
| E19 | `lib/rpc/caller.ts:91-147` | 91 | `createAgentSessionServices` + `createAgentSessionFromServices` SDK 创建链 |
| E20 | `lib/rpc/subscriber.ts:1-61` | 1 | `RpcSubscriber` + `globalThis.__workspliceRunningListeners` |
| E21 | `lib/rpc/broadcaster.ts:1-58` | 1 | `RpcBroadcaster` + `lastSnapshot` 去重 |
| E22 | `lib/rpc/index.ts:1-38` | 1 | rpc 域唯一对外导入面（原 `rpc-manager.ts` 11 导出平移） |
| E23 | `lib/agent-loop/loop.ts:1-1442` | 1 | 深模块 lot（round + driver + backfill + cron 全收编） |
| E24 | `lib/agent-loop/loop.ts:50-95` | 50 | `LoopSession/LoopRuntime` + `mustRespondFailures` 的 globalThis |
| E25 | `lib/agent-loop/loop.ts:895-929` | 895 | `__workspliceAgentLoopDriver` globalThis + `getDriverState` |
| E26 | `lib/agent-loop/loop.ts:918-1035` | 918 | driver 编排（FIFO + hint 合并 + busy/busy-cwd 退避 + `BUSY_CWD_RETRY_DELAY_MS 250`） |
| E27 | `lib/agent-loop/loop.ts:1097-1330` | 1097 | backfill 段（`roomMarker` / `scanSessionReplies` / `backfillAgentReplies`） |
| E28 | `lib/agent-loop/loop.ts:1345-1390` | 1345 | reminder cron 段（`REMINDER_POLL_MS 60000` + `__workspliceReminderCron`） |
| E29 | `lib/agent-loop/loop.ts:1405-1442` | 1405 | `AgentLoop` + `createAgentLoop()` 公共接口 |
| E30 | `lib/agent-loop/index.ts:1-7` | 1 | 窄公共面（仅 re-export `createAgentLoop`） |
| E31 | `lib/domain/raft/index.ts:1-35` | 1 | raft 域唯一对外导入面（`export *` 汇合 17 子模块） |
| E32 | `lib/domain/raft/channels.ts:1-236` | 1 | channel 服务层 |
| E33 | `lib/domain/raft/messages.ts:1-219` | 1 | message 服务层（`sendMessage` + freshness-hold） |
| E34 | `lib/domain/raft/tasks.ts:1-327` | 1 | task 服务层（`TRANSITIONS` 状态机 + `reopened` 封锁） |
| E35 | `lib/domain/raft/inbox.ts:1-119` | 1 | inbox 服务层（`drain/ack/getPendingTargets` + mute 过滤） |
| E36 | `lib/domain/raft/members.ts:1-244` | 1 | members 服务层（家目录两分 + soft-delete） |
| E37 | `lib/domain/raft/reminders.ts:1-344` | 1 | reminder 服务层（`fireDueReminders` + not_due 幂等） |
| E38 | `lib/domain/raft/reactions.ts:1-70` | 1 | `toggleReaction / listReactionSummaries` |
| E39 | `lib/domain/raft/pinned.ts:1-110` | 1 | `pinMessage / unpinMessage / listPinned / setPinnedOrder` |
| E40 | `lib/domain/raft/attachments.ts:1-67` | 1 | `stageAttachmentFiles / discardAttachmentFiles` |
| E41 | `lib/domain/raft/search.ts:1-32` | 1 | `searchMessages`（`MAX_SEARCH_LIMIT 50`） |
| E42 | `lib/domain/raft/wake.ts:1-89` | 1 | wake 总线（`__workspliceWakeListeners` + `notifyMessageWakes`） |
| E43 | `lib/domain/raft/reads.ts:1-37` | 1 | 未读角标服务层（`unreadCount/markChannelRead`） |
| E44 | `lib/domain/raft/observability.ts:1-157` | 1 | `listAgentTasks / buildAgentTimeline` |
| E45 | `lib/domain/raft/recurrence.ts:1-120` | 1 | DSL 纯解析器（`every/daily/weekly` + `nextFireAt`） |
| E46 | `lib/domain/raft/rounds.ts:1-116` | 1 | `logRoundOutcome / ROUND_LOG_RETAIN 200` |
| E47 | `lib/agent-runtime.ts:1-383` | 1 | `AgentRuntime` 缝 + busy-cwd + wrapper 记账 |
| E48 | `lib/agent-runtime.ts:137-198` | 137 | `globalThis.__workspliceCwdStartLocks / __workspliceAgentSessions` |
| E49 | `lib/agent-status.ts:1-104` | 1 | `StatusLookup` 现场推导 + publish + `__workspliceAgentStatus*` 3 守卫 |
| E50 | `lib/agent-lifecycle.ts:1-134` | 1 | `restart/sessionReset/fullReset/changeWorkspace/deleteIdentity` |
| E51 | `lib/session-reader.ts:1-350` | 1 | `listAllSessions / buildSessionContext / readSessionHeader / getSessionEntries` + `__workspliceSessionListCache` |
| E52 | `lib/session-stats.ts:1-198` | 1 | `parseSessionFileStats / sumSessionStats / listAgentSessionFiles / aggregateAgentUsage` |
| E53 | `lib/models-cache.ts:1-84` | 1 | `loadModelsWithCache / __workspliceModelsCacheState / TTL 60000 / MAX 32` |
| E54 | `lib/agent-loop/loop.ts:107-310` | 107 | `parseAgentAction / buildReplyPrompt / buildRevisionPrompt / SETTLE_EVENTS / PROMPT_DONE_EVENTS` |
| E55 | `lib/data/schema.ts:136-142` | 136 | `messages_fts` trigram 虚拟表定义 |
| E56 | `lib/data/schema.ts:144-157` | 144 | 5 触发器（no_update/no_delete + fts 3） |
| E57 | `lib/data/schema.ts:170-243` | 170 | 3 老→新迁移函数（`migrateMessagesFtsTrigram / MembersDeleted / MembersModelColumns / TasksReopened` 实 4 函数） |
| E58 | `lib/data/schema.ts:246-265` | 246 | `seed()`（`#all` + Owner + 全员加入 + 软删补丁） |
| E59 | `lib/domain/raft/channels.ts:7` | 7 | `CURRENT_MEMBER_ID = OWNER_MEMBER_ID ("owner")` 恒 Owner |
| E60 | `package.json:scripts.test/typecheck/lint` | — | `typecheck: tsc --noEmit` / `lint: eslint .` / `test: node --test …` |
| E61 | `docs/cost-monitoring-baseline.md:15-40` | 15 | token/成本采集口径（`session-stats.ts` + `cacheRead/cacheWrite` + `cost.total`） |
| E62 | `docs/engineering-standards.md:15-16` | 15 | 分层（Store 契约 + raft 唯一导入面）+ 错误码纪律（409/400/404） |
| E63 | `components/ChannelView.tsx:1-3117` | 1 | ChannelView（最大概念承载组件） |
| E64 | `components/AppShell.tsx:1-392` | 1 | 三栏骨架 + hash 深链 |
| E65 | `components/WorkspaceSidebar.tsx:1-486` | 1 | 频道/成员侧栏 |
| E66 | `components/ThreadPanel.tsx:1-435` | 1 | 右栏线程面板 |
| E67 | `components/AgentDetailPanel.tsx:1-1025` | 1 | agent 详情（状态/workspace/runtime/可观测性） |
| E68 | `components/DetailPanel.tsx:1-178` | 1 | 右栏单槽分派容器 |
| E69 | `docs/cost-monitoring-baseline.md:2.2` | — | 基线表 3 agent / 104 消息 / 2.46M token / $0.14 |

> 注：行号以 2026-08-20 仓库 HEAD 为准；后续若增删行，请以 `grep -n` 重新锚定并在本文件追记偏移。

---

## 1. lib/ 域清单

### 1.1 lib/rpc — RPC 会话管理（原 `lib/rpc-manager.ts` 一分为四 + 薄出口）

rpc 域总代码量：`lib/rpc/*` 6 文件共 `≈ 1.48k` 行（session 1038 + registry 141 + caller 197 + subscriber 61 + broadcaster 58 + index 38）。

| 文件 | 行数 | 职责（一句话） | 对外导入面 | globalThis 守卫点 | 与 SDK 的委托关系 |
|------|------|---------------|-----------|-------------------|-------------------|
| `lib/rpc/session.ts:E11` | 1038 | 单会话封装（事件订阅 `onEvent` / 27 分支 `send` / 扩展绑定 / idle 10min 超时 / fork 自毁） | `AgentSessionWrapper`, `AgentEvent`, `RpcSessionStartOptions`, `withExtensionTools`（经 `lib/rpc/index.ts:E22` 暴露） | 无（实例 State 由 registry 托管） | 直接持有 `AgentSessionLike`（`@earendil-works/pi-coding-agent` 的 `AgentSession`），委托 `getAllTools/getActiveToolNames/setActiveToolsByName/prompt/shutdown`；`SessionManager/Theme/getAgentDir` 用于会话文件与主题初始化 |
| `lib/rpc/registry.ts:E15` | 141 | 存活 wrapper 注册表 + per-cwd busy 探测 + starting 窗口计数 | `RpcRegistry`, `getRpcSession`, `hasBusyRpcSessionForCwd`, `findBusyRpcSessionForCwd`, `destroyRpcSessionsForCwd`, `normalizeRpcCwd` | `globalThis.__workspliceSessions: Map<string, Wrapper>`；`globalThis.__workspliceStartingSessionCwds: Map<string, number>`（E15:98/109） | 无 SDK 导入（仅 `type-only import AgentSessionWrapper`），避免循环 |
| `lib/rpc/caller.ts:E17` | 197 | 会话启动编排（单例锁 + Settings 快照 + SDK 服务构造 → wrapper 包装 → 注册表登记） | `RpcCaller`, `startRpcSession` | `globalThis.__workspliceStartLocks: Map<string, Promise<{session, realSessionId}>>`（E18:30） | `createAgentSessionServices({cwd, model, thinking, scopedModels})` → `createAgentSessionFromServices`（`@earendil-works/pi-coding-agent` 会话工厂）；`withExtensionTools` 合并扩展工具白名单 |
| `lib/rpc/subscriber.ts:E20` | 61 | running-id 订阅集合（subscribe/unsubscribe/hasListeners/forEach） | `RpcSubscriber`, `subscribeRunningSessions` | `globalThis.__workspliceRunningListeners: Set<listener>`（E20:38-45） | 无 SDK |
| `lib/rpc/broadcaster.ts:E21` | 58 | running-id 变化广播（重算 `getRunningIds` → 快照去重 → 通知 subscribers） | `RpcBroadcaster`, `getRunningRpcSessionIds`, `notifyRunningChange` | `lastSnapshot: string` 为实例字段（随模块重生重置，E21 实例级） | 无 SDK；`getRunningIds` 读 `RpcRegistry.getRunningIds()=filter(isRunning())` |
| `lib/rpc/index.ts:E22` | 38 | 公共出口（11 导出平移 `session/registry/caller/subscriber/broadcaster`） | 上述全部（消费方只 `from "@/lib/rpc"`） | — | — |

**隐式依赖与陷阱**：
- **热重载安全三板斧**：`__workspliceSessions / __workspliceStartingSessionCwds / __workspliceStartLocks / __workspliceRunningListeners` 全挂 `globalThis`，plain `Map` 随模块热重载丢失会导致幽灵会话与并发超限。
- **Fork 自毁**：`session.ts` 的 `send("fork")` 捕获 `newSessionId` 后立即 `this.destroy()`，否则 registry 仍以旧 id 持有已 fork 的 wrapper，下一请求拿到 `inner.sessionId` 已突变的实例，`parentSession` 链腐败（AGENTS.md §Fork must destroy…）。
- **单一启动锁**：`caller.ts:E18` 并发 `startRpcSession()` 在 `__workspliceStartLocks` 上共享同一 Promise，失败的 holder 不阻塞后继（`finally` 清理）。
- **realpath 语义的 cwd 判等**：`registry.ts:normalizeRpcCwd` 用 `realpathSync(resolve(cwd))`，同一物理目录的不同符号路径被视为同一 cwd（busy-cwd 的单位）。

### 1.2 lib/agent-loop — 深模块（1 深文件 + 1 窄出口）

总代码量：`lib/agent-loop/*` 2 文件共 `≈ 1.449k` 行（loop 1442 + index 7）。

| 模块/段 | 文件:行号 | 行数 | 职责 | 对外导入面 | 热重载陷阱点 |
|---------|----------|------|------|-----------|-------------|
| **公共面** | `lib/agent-loop/index.ts:E30` | 7 | 仅 `createAgentLoop` re-export（窄 API） | `createAgentLoop, AgentLoop` | — |
| **round** | `lib/agent-loop/loop.ts:E23/98-700` | ~650 | `runAgentRound`（wake→drain→decide→act→reply→ack）+ `parseAgentAction`/`buildReplyPrompt`/`buildRevisionPrompt`/`deliverWithFreshness`/`runTaskOperation` + 结构化回复协议 `{"action":"reply|ignore","content","onConflict":"revise|resend|silent|anyway","task":{"number,op"}}` | `runAgentRound`, `parseAgentAction`, `buildReplyPrompt`, `buildRevisionPrompt`, `deliverWithFreshness`, `runTaskOperation`, `roomMarker`, `ROOM_MARKER_PATTERN`（测试） | — |
| **driver** | `lib/agent-loop/loop.ts:E26/895-1035` | ~140 | per-agent FIFO + 同 `(agent,target)` 合并 + busy/busy-cwd 时 `SETTLE_EVENTS` 后重试 + `BUSY_CWD_RETRY_DELAY_MS 250` | `startAgentLoopDriver`, `stopAgentLoopDriver`, `peekAgentLoopQueues`, `BUSY_CWD_RETRY_DELAY_MS` | `globalThis.__workspliceAgentLoopDriver: {queues, busy, settleWaiters}`（E25:918）；旧监听器闭包永久持有旧 `runAgentRound`——改 `loop.ts/driver/wake` 后 **必须重启 dev server**（`ps aux | grep next-server` 启动时间晚于改动才算生效） |
| **backfill** | `lib/agent-loop/loop.ts:E27/1097-1330` | ~233 | 启动时扫描 `session jsonl` 补写 SQLite（`[worksplice:target=… seq=…]` 标记轮 + `parseAgentAction`） | `scanSessionReplies`, `backfillAgentReplies`, `backfillAllAgents`, `readSessionHeaderCwd` | 无 globalThis；`SessionReply` 按标记轮去重（仅最后一条 assistant 文本有效） |
| **reminder-cron** | `lib/agent-loop/loop.ts:E28/1345-1390` | ~45 | 逐分钟扫描 `scheduled && fire_at<=now` → `fireDueReminders` | `startReminderCron`, `stopReminderCron`, `tickReminderCron`, `REMINDER_POLL_MS` | `globalThis.__workspliceReminderCron: {timer, pollMs}`（E28:1348）；幂等启停（`started` 守卫） |
| **跨切面常量** | `lib/agent-loop/loop.ts:E54/310` | — | `MAX_REVISE_RETRIES 2` / `MAX_RESEND_RETRIES 3` / `MAX_TASK_STATUS_RETRIES 3` / `PROMPT_DONE_EVENTS` / `SETTLE_EVENTS` / `MUST_RESPOND_FAILURE_CAP 2` | 同上 | `globalThis.__workspliceMustRespondFailures: Map<agentId|targetId, count>`（E24:86） |

**设计约束**：
- driver 对外仅依赖 `LoopRuntime` 结构子集（`findSession/startSession/findBusySessionForCwd`），测试注入 fake，**不静态 import `lib/rpc`**（`node --test` TS strip 无法解析 `session.ts` 的 parameter properties）。
- wake 发布面已下沉 `lib/domain/raft/wake.ts:E42`，agent-loop 仅 `subscribeWake`。

### 1.3 lib/domain/raft — 唯一导入面 + 17 子域

总代码量：`lib/domain/raft/*` 17 文件共 `≈ 2.626k` 行。

**域规则**：唯一对外导入面为 `lib/domain/raft/index.ts:E31`（`export * from "./*.ts"` 17 行），消费方只 `from "@/lib/domain/raft"`；`getDb(): Store` 不在此面，归 `lib/data/db-singleton.ts:E08`。子域之间用相对路径直引，不经索引回环（测试一个 seam mock 全域）。

| 子域 | 文件:行号 | 行数 | 职责（一句话） | 对外导入面（主要符号） | 存储/约束要点 |
|------|-----------|------|---------------|------------------------|---------------|
| `channels` | `lib/domain/raft/channels.ts:E32` | 236 | 频道 CRUD + join/leave/archive/mute + `#all` 成员管理 | `CURRENT_MEMBER_ID`, `listChannels`, `getChannel`, `createChannel`, `joinChannel`, `leaveChannel`, `setChannelArchived`, `muteChannel`, `unmuteChannel`, `getChannelMute`, `listChannelMutes`, `resolveChannelForTarget`, `listChannelMembers`, `listChannelsWithMeta` | `CURRENT_MEMBER_ID = OWNER_MEMBER_ID` 恒 Owner（E59）；`#all` 不可 leave；私有仅 Owner 可改成员 |
| `messages` | `lib/domain/raft/messages.ts:E33` | 219 | 发消息（freshness + thread 校验 + quote + 附件随消息原子提交 + 提交后 wake）+ thread 归一化 + 已读/搜索辅助 | `sendMessage`, `listMessages`, `getMessageWithAuthor`, `messageWithAuthor`, `getThreadInfo`, `summarizeChanges`, `formatQuote` | `baseSeq` 事务内比 `maxSeq(targetId)`，不等→ `{held, roomSeq, whatHappened}`；thread 不可嵌套；wake 在事务外发 |
| `tasks` | `lib/domain/raft/tasks.ts:E34` | 327 | 任务元数据（`message+tasks`，`number`按 channel 递增）+ 状态机 + 互审 + 重开封锁 + freshness-hold | `TaskView`, `createTask`, `claimTask`, `updateTaskStatus`, `listChannelTasks`, `getTaskView`, `reachableStatuses`, `TaskAlreadyExistsError`, `InvalidTaskTransitionError`, `TaskClaimConflictError` | `TRANSITIONS: todo→in_progress→in_review→done/closed→todo`（`tasks.ts:87`）；`reopened` 标记仅 Owner 可领；`baseSeq` 冲突 409 |
| `inbox` | `lib/domain/raft/inbox.ts:E35` | 119 | 拉取式 inbox（`consumed_seqs(agent,target)` 游标）+ mute 过滤 + pending 探测 | `getSince`, `drain`, `ack`, `drainAndAck`, `getPendingTargets`, `listRelatedTasks` | `drain`不推进游标；mute 后普通消息不进 inbox、`@mention`穿透（按 `mute_rowid`/`mute_from_seq` 双轨） |
| `members` | `lib/domain/raft/members.ts:E36` | 244 | agent 身份 CRUD（家目录两分/soft-delete/workspace 校验/mention 解析） | `listAgents`, `getMember`, `getAgent`, `createAgent`, `validateAgentWorkspace`, `updateAgentWorkspace`, `setAgentStatus`, `setAgentSessionFile`, `deleteAgent`, `extractMentionedMemberIds`, `agentHomePath`, `homeDirOfAnotherAgent` | `homeDirOfAnotherAgent` 拒绝把他人家目录绑为项目目录；`deleteAgent` = soft-delete + 移出全部 channel + 清 `consumed_seqs` |
| `reminders` | `lib/domain/raft/reminders.ts:E37` | 344 | 提醒生命周期（schedule/snooze/update/cancel/fire）+ 事务幂等 + 定向唤醒 | `scheduleReminder`, `listReminders`, `getReminderView`, `snoozeReminder`, `updateReminder`, `cancelReminder`, `getReminderLog`, `fireReminder`, `fireDueReminders` | 失败落 `error` log 并收口 `fired`；`reason="reminder"` 时 agent-loop 不跳过自消息 |
| `reactions` | `lib/domain/raft/reactions.ts:E38` | 70 | 先查后写 toggle（存在即删 UNIQUE） | `toggleReaction`, `listReactionSummaries` | trigger？无； channel 成员才可点，无通知不进 inbox |
| `pinned` | `lib/domain/raft/pinned.ts:E39` | 110 | 个性化 pinned（每成员每 channel 独立，`order=max+1`） | `pinMessage`, `unpinMessage`, `listPinned`, `setPinnedOrder` | 消息须属于该 channel（thread 经锚点归一化跨 channel 拒） |
| `attachments` | `lib/domain/raft/attachments.ts:E40` | 67 | 附件随消息原子落地（`stage/discard`） | `stageAttachmentFiles`, `discardAttachmentFiles`, `getAttachmentRow`, `MAX_ATTACHMENT_BYTES 50MB` | 随机文件名落盘 `attachments/`，原始名只存库；held/抛错清理 |
| `search` | `lib/domain/raft/search.ts:E41` | 32 | `searchMessages`（FTS trigram 双路径 + LIKE 兜底） | `searchMessages`, `MAX_SEARCH_LIMIT 50` | `toFtsQuery`/`buildSearchSnippet` 在 `lib/data/types.ts:E05`，`search.ts` 只包一层 `limit` 收敛 |
| `wake` | `lib/domain/raft/wake.ts:E42` | 89 | wake 总线 + 通知分发（channel 成员除作者 + @mention 穿透 + 任务 owner 自醒） | `WakeHint`, `subscribeWake`, `emitWake`, `notifyMessageWakes`, `extractMentionedMemberIds`（re-export） | `globalThis.__workspliceWakeListeners: Set<listener>`（E42:29）；只含 `agentId/targetId/seq/reason` 不含正文 |
| `reads` | `lib/domain/raft/reads.ts:E43` | 37 | 未读角标服务层（仅 UI 呈现，不进 agent inbox） | `unreadCount`, `markChannelRead`, `listChannelsWithUnread` | `read_seq = max(seq)` 推进；未读 = `author≠me && seq>read_seq` |
| `observability` | `lib/domain/raft/observability.ts:E44` | 157 | `listAgentTasks`（owner/锚点作者/进展参与判定）+ `buildAgentTimeline` | `listAgentTasks`, `buildAgentTimeline`, `AgentTaskView` | 查 `messages/tasks` 不落额外表 |
| `recurrence` | `lib/domain/raft/recurrence.ts:E45` | 120 | DSL 纯解析器 | `isValidRecurrence`, `parseRecurrence`, `nextFireAt` | `every:Nm/Nh/Nd` / `daily@HH:MM` / `weekly:mon,fri@HH:MM`；`nextFireAt` 严格晚于 `from`（时区安全） |
| `rounds` | `lib/domain/raft/rounds.ts:E46` | 116 | 轮次结果落盘（ring cap 200/agent） | `logRoundOutcome`, `listRoundLogs`, `listAbandonedMarks`, `isAbandonedRound`, `ROUND_LOG_RETAIN`, `ROUND_LOG_LIST_LIMIT 50` | status ∈ `replied/ignored/silent/anyway/yielded/error/busy-cwd` |
| `event-messages` | `lib/domain/raft/event-messages.ts` | 100 | 系统事件消息（加入/建频道/欢迎） | `notifyAgentJoinedChannel`, `notifyChannelCreated`, `notifySecretaryWelcome`, `SECRETARY_WELCOME_CONTENT` | 以系统消息落库，不参与 wake 特殊路径 |
| `secretary-init` / `secretary-auto-create` | `lib/domain/raft/secretary-init.ts` 125 / `secretary-auto-create.ts` 79 | 204 | 秘书初始化五步流 + 首次启动自动创建 | `initSecretaryFlow`, `autoCreateSecretary`, `readDefaultModelFromSettings` | 薄封装 `secretary-bootstrap.ts` |

### 1.4 lib/data — 数据层（Store 契约 + SQLiteAdapter）

| 文件 | 行数 | 职责 | 关键事实 |
|------|------|------|---------|
| `lib/data/store.ts:E03` | 242 | `Store` 数据契约（业务唯一依赖的存储抽象面） | 见 §3 完整分组；2 属性（`paths` + 事务）+ 57 方法 |
| `lib/data/types.ts:E05` | 229 | 共享词表（行类型/输入类型/枚举）+ 搜索纯函数 | `ChannelRow/MemberRow/MessageRow/TaskRow/ReminderRow/ReminderLogRow/RoundLogRow/ReactionRow/AttachmentRow/PinnedMessageRow/ChannelMuteRow/SearchResult` 等 15 类型；`toFtsQuery:171` / `buildSearchSnippet:199` / `escapeHtml` |
| `lib/data/sqlite.ts:E06` | 994 | `SQLiteAdapter implements Store` + 工厂 | 同步 `better-sqlite3`；预编译语句 + `maxSeq/freshness/seq 游标分页`；`openSqliteAdapter:987` 设 `__workspliceDbOpenedVersion` |
| `lib/data/schema.ts:E02` | 266 | `SCHEMA_VERSION 11` 的全部 DDL/DML + 迁移链 + seed | 见 §3 表/触发器清单 |
| `lib/data/db-singleton.ts:E08` | 25 | `getDb(): Store` 单例（`globalThis` + 版本号兜底重建） | `globalThis.__workspliceDb` + `__workspliceDbOpenedVersion !== SCHEMA_VERSION` 时重建（E08:19-22） |
| `lib/data/dirs.ts:E10` | 57 | 数据目录解析（`WORKSPLICE_DATA_DIR` 覆盖）+ 家目录/模板 | `resolveDataDir/dataPaths/ensureDataDir` + `agentSlug:43` + `agentHomeDir:49`（`<agents>/<slug>-<id8>`）+ `buildMemoryTemplate:52`（6 章大纲） |

**分层纪律**（`docs/engineering-standards.md:15`）：业务模块只依赖 `Store`，经 `getDb(): Store` 取实例，不写 SQL、不 `import` `sqlite.ts`；新增查询 = `Store` 声明 + `SQLiteAdapter` 实现；`toFtsQuery/buildSearchSnippet` 落 `types.ts` 保持纯函数可复用。

### 1.5 编排层（agent-runtime / status / lifecycle / session 存取）

| 文件 | 行数 | 职责 | 对外导入面 | globalThis 点 |
|------|------|------|-----------|---------------|
| `lib/agent-runtime.ts:E47` | 383 | `AgentRuntime` 缝（fake 可注入）+ 真实现（惰性 `import lib/rpc/SDK`）+ `deriveLiveAgentStatus` + per-agent 模型覆盖的 `startSession` | `AgentRuntime`, `BusyCwdError`, `referencedSessionFiles`, `isOwnHomeDir`, `chooseSessionFileForStart`, `withCwdStartLock`, `getAgentRuntime`, `deriveLiveAgentStatus` | `globalThis.__workspliceCwdStartLocks`（E48:137）,`__workspliceAgentSessions` 按成员 id 记账（E48:195） |
| `lib/agent-status.ts:E49` | 104 | 状态点事实来源（现场推导 wrapper / DB 回落）+ publish + 低频扫掠 | `setAgentStatusLookup`, `subscribeAgentStatuses`, `getAgentStatusSnapshot`, `publishAgentStatus`, `startAgentStatusSweeper`, `stopAgentStatusSweeper` | `__workspliceAgentStatusListeners`（E49:25）, `__workspliceAgentStatusLookup`（32）, `__workspliceAgentStatusLastSnapshot`（80）, `__workspliceAgentStatusSweeper`（95） |
| `lib/agent-lifecycle.ts:E50` | 134 | Restart / Session reset / Full reset / 换 workspace / 删身份（fs + 运行时 + DB 编排） | `restartAgent`, `sessionResetAgent`, `fullResetAgent`, `changeAgentWorkspace`, `deleteAgentIdentity`, `toLifecycleErrorStatus` | 无（通过 `AgentRuntime` 缝与 `getDb()` 间接） |
| `lib/session-reader.ts:E51` | 350 | `SessionManager` 包装 + 路径缓存 + `buildSessionContext` 适配 | `listAllSessions`, `invalidateSessionListCache`, `resolveSessionPath`, `cacheSessionPath`, `readSessionHeader`, `getSessionEntries`, `buildSessionContext` | `globalThis.__workspliceSessionListCache` + `__workspliceSessionListPromise` + `__workspliceSessionListGeneration`（E51:50-60） |
| `lib/session-stats.ts:E52` | 198 | session jsonl 只读解析（token/cost/compaction 口径）+ 按 agent 聚合 | `parseSessionFileStats`, `sumSessionStats`, `listAgentSessionFiles`, `aggregateAgentUsage`, `SessionUsageStats`, `SessionFileStats`, `AgentUsageSummary` | 无 |
| `lib/models-cache.ts:E53` | 84 | 模型目录缓存（TTL 去重 + 并发合并） | `loadModelsWithCache`, `invalidateModelsCache`, `withModelRuntimeError`, `ModelsData` | `globalThis.__workspliceModelsCacheState`（E53:28；`TTL 60s / MAX 32`） |
| `lib/panel-state.ts` | 63 | 面板单槽状态（open/close/切换清空 + pinned 变更通知） | `openPanel`, `closePanel`, `onChannelSwitched`, `subscribePinnedChanged` | 无 |
| `lib/worktree.ts` | 230 | worktree 解析 + `projectRoot` 缓存 + git 操作 | `resolveProjectRoot`, `listAllSessions` 侧同名 | `globalThis.__workspliceProjectCache` |
| 其他 `lib/*.ts` | `≈ 6.6k`（44 文件） | 支撑层（`model-scope.ts:142`/`model-catalog.ts:404`/`file-access.ts:75`/`mention.ts:98`/`http-dispatcher.ts:86` 等） | 见 §1.4-1.5 以外分散导出；`lib/api-types.ts:105` 等契约弥合前后端 | `http-dispatcher.ts:11 __worksplice` + `allowed-roots.ts:13 __workspliceAdditionalAllowedRoots` + `worktree.ts:43 __workspliceProjectCache` |

---

## 2. app/api 与 components 清单

### 2.1 app/api 路由组（76 个 `route.ts`）— 薄封装全量

统计口径：`find app/api -name route.ts | wc -l = 76`，总行数 `≈ 4.97k`。

**路由职责纪律**：校验入参 → 调 `lib/domain/raft` 服务层 → 映射错误码（§6.3 `held` 409 / 冲突 409 / 非法 400 / 缺失 404）；不重复实现域规则。

#### 2.1.1 raft 域（频道/消息/任务/成员/提醒/搜索 等 33 路由）

| 路由 | 方法 | 行数 | 薄封装调用 | 关键错误码 |
|------|------|------|-----------|-----------|
| `app/api/channels/route.ts` | GET / POST | 30 | `listChannels` / `createChannel`（自动加入 Owner + 种子成员） | 400 缺名 |
| `app/api/channels/[id]/route.ts` | GET | 13 | `getChannel` | 404 |
| `app/api/channels/[id]/members/route.ts` | GET | 15 | `listChannelMembers` | 404 |
| `app/api/channels/[id]/join/route.ts` | POST | 20 | `joinChannel({channelId, memberId})` | 400 私有非 Owner；404 channel/member |
| `app/api/channels/[id]/leave/route.ts` | POST | 20 | `leaveChannel` | 400 `#all` 不可离开；409 archived |
| `app/api/channels/[id]/archive/route.ts` | POST `{archived:bool}` | 19 | `setChannelArchived` | 403 非 Owner；404 |
| `app/api/channels/[id]/mute/route.ts` | GET / POST | 68 | `getChannelMute/listChannelMutes / muteChannel/unmuteChannel` | 403/404 |
| `app/api/channels/[id]/read/route.ts` | POST | 21 | `markChannelRead`（推至 `max(seq)`） | —（幂等） |
| `app/api/channels/[id]/messages/route.ts` | GET `?before&limit` | 42 | `listMessagesBefore`（seq 游标分页，`PAGE_LIMIT 50`） | 400 limit |
| `app/api/channels/[id]/pinned/route.ts` | GET `?sort=manual|recent|az` / POST `{messageId}` / DELETE `?messageId` | 52 | `listPinned / pinMessage / unpinMessage` | 400 消息不属于该 channel；404 |
| `app/api/channels/[id]/pinned/reorder/route.ts` | POST `{order:[messageId...]}` | — | `setPinnedOrder` | 400 长度不一致 |
| `app/api/channels/[id]/tasks/route.ts` | GET | 13 | `listChannelTasks`（按 number 升序，附 `reachable`） | 404 |
| `app/api/messages/route.ts` | POST `{targetId,content,baseSeq?,quoteId?,files?}` | — | `sendMessage`（`multipart` 时 `files` 经 `stageAttachmentFiles`） | 400 非法/quote 缺失；409 `held`（`{roomSeq, whatHappened}`） |
| `app/api/messages/[id]/route.ts` | GET | — | `getMessageWithAuthor`（含 reactions+attachments） | 404 |
| `app/api/messages/[id]/thread/route.ts` | GET | 17 | `getThreadInfo`（锚点归一化） | 404 |
| `app/api/messages/[id]/reactions/route.ts` | GET / POST `{emoji}` | 41 | `listReactionSummaries / toggleReaction` | 404 消息；400 非法 emoji；403 非成员 |
| `app/api/attachments/[id]/route.ts` | GET | — | `getAttachmentRow` → `fs.readFile`（图片 inline 其余 attachment） | 404 |
| `app/api/tasks/route.ts` | POST `{messageId}\|{channelId,content}` | — | `createTask` 或 `sendMessage→createTask` | 400 thread 内不可转；409 已是任务 |
| `app/api/tasks/[id]/claim/route.ts` | POST `{baseSeq?}` | 38 | `claimTask` | 409 `held` / 409 `conflict`（已认领）/ 409 `blocked`（reopened 锁） |
| `app/api/tasks/[id]/update-status/route.ts` | POST `{status,baseSeq?}` | 47 | `updateTaskStatus`（状态机 + 互审 + freshness） | 409 `held`/`conflict`/`blocked`；400 非法转移/越权 |
| `app/api/members/route.ts` | GET / POST | — | `listAgents / createAgent`（自动加入 `#all` + 设 `workspace?`） | 400 缺 name/provider/modelId/thinking |
| `app/api/members/[id]/route.ts` | GET / DELETE | — | `getMember / deleteAgent`（soft-delete） | 404；400（删 Owner 不可） |
| `app/api/members/[id]/workspace/route.ts` | POST `{workspacePath}` | 23 | `updateAgentWorkspace`（`validateAgentWorkspace` 拒他人家目录） | 400 坏路径/`homeDirOfAnotherAgent`；404 |
| `app/api/members/[id]/restart/route.ts` | POST | 17 | `restartAgent`（沿用 `pi_session_file` 重启） | 404；409 `BusyCwdError` |
| `app/api/members/[id]/session-reset/route.ts` | POST | 17 | `sessionResetAgent`（清 `pi_session_file` + `removeSessionFilesForCwd`） | 404 |
| `app/api/members/[id]/full-reset/route.ts` | POST | 17 | `fullResetAgent`（家目录全清，绑共享项目时 400 拒） | 400 绑共享项目目录；404 |
| `app/api/members/[id]/runtime/route.ts` | GET / PATCH | 107 | `getMember` / `setAgentRuntimeConfig`（provider/modelId/thinkingLevel，活会话立即应用） | 400 非法模型；404 |
| `app/api/members/[id]/inbox/route.ts` | GET `?targetId=` | 28 | `drainAndAck`（无 target 时 drain 全部 pending channel） | 404 |
| `app/api/members/[id]/observability/route.ts` | GET | 64 | `listAgentTasks` + `buildAgentTimeline` + `aggregateAgentUsage` + `listRoundLogs` | 404 |
| `app/api/members/events/route.ts` | GET SSE | — | `subscribeAgentStatuses` 流 | — |
| `app/api/reminders/route.ts` | GET `?authorId&targetId` / POST | — | `listReminders / scheduleReminder`（Owner 可替 agent 设） | 400 `isValidRecurrence`；409 非 `scheduled` |
| `app/api/reminders/[id]/route.ts` | GET / PATCH | — | `getReminderView / updateReminder` | 400/403/404 |
| `app/api/reminders/[id]/snooze/route.ts` | POST `{minutes?15}` | 25 | `snoozeReminder`（`max(now, fire_at)+minutes`） | 400/409 |
| `app/api/reminders/[id]/cancel/route.ts` | POST | 23 | `cancelReminder` | 409 非 `scheduled` |
| `app/api/reminders/[id]/log/route.ts` | GET | 19 | `getReminderLog` | 404 |
| `app/api/search/route.ts` | GET `?q&limit` | — | `searchMessages` | 400 空查询 |
| `app/api/secretary/init/route.ts` | POST | — | `initSecretaryFlow`（五步初始化薄封装） | 400 |

#### 2.1.2 agent / session / model / skill / auth / file 等 43 路由

| 分组 | 路由数 | 代表路由 | 关键事实 |
|------|--------|---------|---------|
| `agent` | 7 | `agent/new` 43行 / `agent/[id]/events` SSE / `agent/running/events` SSE | `new` 经 `startRpcSession`；`running` 轮询 `getRunningRpcSessionIds()` |
| `sessions` | 7 | `sessions/[id]/export` 282行 / `context?leafId` 31行 | export 把递归树改迭代防栈溢出；`entries[id]/thinking` 支流 |
| `models-config` | 4 | `catalog` 62行 / `discover` 33行 / `test` 28行 / `models-config` 54行 | `~/.pi/agent/models.json` 读写；`models.dev` 预设；provider 探测 |
| `skills` | 5 | `skills/search` 91行 / `skills/install` 13行 | `npx skills add` 透传；`disable-model-invocation` 精确编辑 |
| `auth` | 5 | `auth/api-key/[provider]` 68行 / `auth/login/[provider]` 192行 | `AuthStorage` 原子读写；OAuth/device-code SSE；`__piLoginCallbacks` token |
| `plugins` | 1 | `plugins` 298行 | `SettingsManager+DefaultPackageManager` 全量 |
| `files/git/worktree/cwd` 等 | 9 | `files/[...path]` 414行 / `worktrees` 76行 / `cwd/validate` 15行 / `file-index` 117行 | `allowFileRoot` + `file-access.ts` allow-list；worktree `dirty 409` |
| `models/home/default-cwd/project-trust` | 4 | `models` 95行 / `home` 4行 / `default-cwd` 9行 / `project-trust` 35行 | `models` 返回 `{models,modelList,defaultModel,thinkingLevels,modelScopeWarnings}` |

### 2.2 components — 三栏骨架与概念承载

三栏：`AppShell` 中央 | `WorkspaceSidebar` 左栏 | `DetailPanel` 右栏（+ 共享 `BrutalModal` 外壳）。

| 组件 | 文件:行号 | 行数 | 职责 | 对外概念数 / 呈现概念 |
|------|----------|------|------|-----------------------|
| `AppShell` | `components/AppShell.tsx:E64` | 392 | 三栏骨架 + URL hash 深链（`#c/<channelId>?m=<messageId>`）+ 弹窗编排 + 中央/右栏解耦 | 骨架 3 栏（`centerSelection` 与 `panelContent` 解耦，点 agent/人类/线程只开右栏，切换频道清空面板） |
| `WorkspaceSidebar` | `components/WorkspaceSidebar.tsx:E65` | 486 | channel 列表（未读角标 + 15s 轮询）+ agent 成员列表（状态点四态）+ 底部 Models/Plugins/Skills/Reminders 入口 | 频道行高亮；agent 行仅面板映射 |
| `ChannelView` | `components/ChannelView.tsx:E63` | 3117 | **频道消息流主机**：最大概念承载（见下） | 一次呈现 **11 概念**：①消息流（seq 分页 `PAGE_LIMIT 50` + 3s 轮询增量合并 `mergeIncomingMessages`，后台暂停）②引用（`quoting` 单一态 + 块引用拼写）③任务（`TaskViews: List\|Board` 5 列拖拽，ADR-0002）④提醒（header ⏰ + 消息动作栏 ⏰ + Recurrence 预设）⑤reaction（快捷 `QUICK_REACTIONS 4` + 24 格选择器 + 聚合条 `ReactionChips`）⑥pinned 区（header Pin 展开，三排序 `manual|recent|az` + 重排 `↑/↓`）⑦附件（Composer `Paperclip` 多选 + `AttachmentList` 预览/下载）⑧线程入口（右键 Open Thread → 右栏 `ThreadPanel`）⑨As Task 勾选⑩mention（`@` 候选 + `MentionText`）⑪poll/订阅（`INBOX_POLL_MS 3000`/`THREAD_POLL_MS 3000` + `poller` 启停） |
| `ThreadPanel` | `components/ThreadPanel.tsx` | 435 | 右栏线程面板（锚点 + 消息 + composer + 局部引用 + 3s 轮询，后台暂停） | 线程 composer 独享 `quoting`；`baseSeq` 按线程 seq 空间；`notifyPinnedChanged` 双端收敛 |
| `DetailPanel` | `components/DetailPanel.tsx` | 178 | 右栏单槽分派（`kind: agent|human|thread` → `AgentDetailPanel / 人物卡 / ThreadPanel`） | 非长驻（无选中整栏消失） |
| `AgentDetailPanel` | `components/AgentDetailPanel.tsx` | 1025 | agent 详情（状态点/workspace/runtime `ModelPicker` 覆盖/可观测性：统计+任务历史+时间线+导出/重置三档） | runtime 区 `§3.10` 覆盖全局默认；session 统计来自 `aggregateAgentUsage` |
| `CreateChannelModal` | `components/CreateChannelModal.tsx` | 252 | 建 channel（公开/私有/描述/初始成员） | — |
| `CreateAgentModal` | `components/CreateAgentModal.tsx` | 305 | 建 agent（provider/modelId/thinking 继承全局预选） | — |
| `BrutalModal` | `components/BrutalModal.tsx` | 116 | 马卡龙×brutalist 模态框外壳 | — |
| `ReminderModal` | `components/ReminderModal.tsx` | 373 | 提醒设置（datetime-local + `recurrence` chips + snooze/cancel） | 锚定提醒列表 + 全局入口 |
| `MyRemindersModal` | `components/MyRemindersModal.tsx` | 244 | 全局提醒面板（跨 target 全量列表，15s 轮询，深链定位） | 含 `channelId/channelName/anchorSeq` |
| `SearchView` | `components/SearchView.tsx` | 287 | FTS5 搜索视图 | — |
| `ModelPicker` / `ModelsConfig` | 362 / 2052 | 2414 | 模型/思考档位选择 + `models.json` 编辑 | provider 分组 + `enabledModels` 过滤 |
| `FileExplorer/FileViewer/FileIcons` | 906 / 1242 / 249 | 2397 | 文件树 + 内容 tab | — |
| `ChatInput/MessageView/MarkdownBody` | 2374 / 1482 / 102 | 3958 | pi-web 遗留的 agent 会话消息渲染与输入条 | 保留复用 |
| `StatusDot/PixelAvatar/MentionText` 等 | 32/69/84 | — | 原子件 | 状态点四态（绿/黄脉冲/橙/灰） |

**呈现概念数审计**（重构关键线索）：
- `ChannelView` 单组件 **11 个独立概念**（E63），耦合度最高，是 07 信息架构重做的主战场：任何一次频道呈现同时暴露 消息流 + 引用 + 任务 + 提醒 + reaction + pinned + 附件 + thread + 任务状态机 + mention + 轮询，是典型的"深模块缺失→浅组件臃肿"。
- 信息架构目标（`map.md: UI 立场`）：向更普适、更简洁的层级重排（`describe → hand off → let it run → review`），降低一次呈现的概念数，绝非单纯样式迁移。
- 设计陷阱：**禁止新增 emoji**（除 `QUICK_REACTIONS/REACTION_GRID` 等持久化数据），UI 一律 lucide icon；`ChannelView` 的 24 emoji 与聚合条属数据而非装饰。

---

## 3. 数据基线

### 3.1 SCHEMA_VERSION 11 全量（`lib/data/schema.ts:E02` 266 行）

| 序号 | 表/VT | 列（`name type 约束`） | 关联/索引 | 版本标记 |
|------|-------|------------------------|-----------|---------|
| 1 | `channels` | `id PK TEXT, name TEXT, type TEXT public\|private, description TEXT, archived INTEGER, created_at TEXT` | — | v1 |
| 2 | `channel_members` | `channel_id TEXT FK→channels, member_id FK→members, joined_at TEXT` PK`(channel_id,member_id)` | — | v1 |
| 3 | `members` | `id PK TEXT, type human\|agent, name TEXT, description, role owner\|member, workspace_path TEXT, pi_session_file TEXT, status online\|working\|error\|offline, deleted INTEGER, model_provider/model_id/thinking_level TEXT, created_at TEXT` | `deleted` v3 ALTER（E57:210）；model 三列 v6 ALTER（221） | v1+3 迁移 |
| 4 | `messages` | `id PK TEXT, target_id TEXT, seq INTEGER, author_id FK→members, content TEXT, created_at TEXT` UNIQUE`(target_id, seq)` | `seq` 房间内序号列；`rowid` 为全局插入序（mute 用） | v1 |
| 5 | `tasks` | `id PK TEXT, message_id UNIQUE FK→messages, number INTEGER, status 5态, owner_id FK→members, reopened INTEGER, updated_at TEXT` | UNIQUE`message_id`；`reopened` v8 ALTER（239） | v1+8 |
| 6 | `reminders` | `id PK TEXT, title, fire_at, recurrence TEXT, target_id TEXT, author_id FK→members, status scheduled\|fired\|canceled, created_at` | — | v1 |
| 7 | `reminder_logs` | `id PK TEXT, reminder_id FK→reminders, event 7态(schedule/fire/reschedule/snooze/update/cancel/error), detail, created_at` | 按 `rowid` 排序保序 | v4 新增 |
| 8 | `round_logs` | `id PK TEXT, agent_id FK→members, target_id TEXT, status 7态(replied/ignored/silent/anyway/yielded/error/busy-cwd), reason TEXT, base_seq INTEGER, created_at TEXT` | ring cap 200/agent（`pruneRoundLogs`） | §07 可观测性 |
| 9 | `reactions` | `id PK TEXT, message_id FK→messages, member_id FK→members, emoji TEXT, created_at TEXT` UNIQUE`(message_id,member_id,emoji)` | — | v1 |
| 10 | `attachments` | `id PK TEXT, message_id FK→messages, file_name, mime TEXT, size_bytes INTEGER, disk_path TEXT, created_at TEXT` | `MAX_ATTACHMENT_BYTES 50MB` 校验在 `attachments.ts` | v1 |
| 11 | `pinned_messages` | `id PK TEXT, channel_id FK→channels, message_id FK→messages, member_id FK→members, "order" INTEGER, pinned_at TEXT` | per-member per-channel；`order=max+1` | v1 |
| 12 | `consumed_seqs` | `agent_id TEXT FK→members, target_id TEXT, seq INTEGER` PK`(agent_id,target_id)` | inbox 游标，`drain` 不推，`ack` 推 | v1 |
| 13 | `channel_mutes` | `channel_id/member_id PK, mute_from_seq INTEGER, mute_rowid INTEGER, created_at TEXT` | channel+member 静音锚点（E57:119） | §3.2 |
| 14 | `channel_reads` | `member_id/channel_id PK, read_seq INTEGER, updated_at TEXT` | Owner 已读游标，仅 UI 呈现（E57:129） | BAI-6 v11 |
| V1 | `messages_fts` | VIRTUAL `USING fts5(content, content='messages', content_rowid='rowid', tokenize='trigram')`（E55:138） | trigram 3-gram 索引（中英文子串均可命中）；`<3char` 由 `searchMessages` 走 LIKE 兜底 | v5 重建 |

**触发器 5 个**（`lib/data/schema.ts:144-157 E56`）：

| 触发器 | 事件 | 动作 |
|--------|------|------|
| `messages_no_update` | BEFORE UPDATE `messages` | `RAISE(ABORT, 'messages are immutable')` |
| `messages_no_delete` | BEFORE DELETE `messages` | `RAISE(ABORT, 'messages are immutable')` |
| `messages_fts_insert` | AFTER INSERT `messages` | `INSERT INTO messages_fts(rowid,content) VALUES(new.rowid,new.content)` |
| `messages_fts_update` | AFTER UPDATE OF `content` | `delete + insert`（rebuild row） |
| `messages_fts_delete` | AFTER DELETE `messages` | `delete` entry |

**迁移函数 4 个**（`lib/data/schema.ts:170-243 E57`；02 研究曾记 3，实为 4，`migrateMessagesFtsTrigram` 单独计数）：

| 函数 | 版本 | 动作 | 判定 |
|------|------|------|------|
| `migrateMessagesFtsTrigram:170` | v5 | 检测 `sqlite_master.sql` 是否含 `trigram`，缺则 DROP 3 触发器→DROP `messages_fts`→CREATE `trigram`→回填 `INSERT SELECT` | `row.sql.includes("trigram")` |
| `migrateMembersDeletedColumn:210` | v3 | `ALTER ADD COLUMN deleted DEFAULT 0` | `PRAGMA table_info` 缺列 |
| `migrateMembersModelColumns:221` | v6 | 三列 `model_provider/model_id/thinking_level` | 同上 |
| `migrateTasksReopenedColumn:239` | v8 | `ALTER ADD COLUMN reopened DEFAULT 0` | 同上 |

`runMigrations:192` 为 `transaction`（4 迁移 + SCAN `SCHEMA_STATEMENTS` + `seed` + `user_version=SCHEMA_VERSION`）。

**FTS5 trigram 配置**（E55+E57）：
- `tokenize='trigram'`（E55:142）：按 3-gram 索引，连续 CJK 亦可子串命中；`unicode61` 会把连续 CJK 当单 token 导致中文搜不到，故 v5 重建；`<3char` token 由 `searchMessages` 走 `LIKE escapeLike` 兜底。
- 摘要：不走 SQL `snippet()`（不转义正文导致 HTML 透出），统一用 `lib/data/types.ts:199 buildSearchSnippet(content, terms, radius=60)`（转义正文后仅 `<mark>` 包命中词，两路径形态一致）。

**seed 数据**（`lib/data/schema.ts:246 E58`）：
- `channels: id=#all, name=#all, type=public, archived=0`；`members: id=owner, type=human, name=Owner, role=owner, status=online`（均 `INSERT OR IGNORE`）。
- 全员补齐：`INSERT OR IGNORE INTO channel_members SELECT #all,id FROM members WHERE deleted=0`；先 `DELETE FROM channel_members WHERE member_id IN (SELECT id FROM members WHERE deleted=1)` 移除幽灵成员（每次打开都执行）。

### 3.2 Store 接口 57 方法 + 2 属性（`lib/data/store.ts:E03` 242 行）

契约分组按注释段（13 段）；`readonly paths` + `close/withTransaction` 为基础设施，57 数据方法为事实面。

| 分组 | 声明行 | 方法（签名缩写） | 条数 |
|------|--------|-----------------|------|
| `paths/close/withTransaction` | `store.ts:37-42` | `paths: DataPaths`, `close()`, `withTransaction<T>(fn)=>T` | 2+1 |
| `freshness / 房间版本 (§6.3)` | `store.ts:44-46` | `maxSeq(targetId)` | 1 |
| `channels` | `store.ts:48-62` | `listChannels, getChannel, insertChannel, setChannelArchived, listChannelMembers, isChannelMember, addChannelMember, removeChannelMember` | 7 |
| `messages` | `store.ts:64-79` | `listMessagesBefore, hasMessagesBefore, threadReplyCount, threadReplyCounts, listMessagesAfter, listMessages, getMessage, insertMessageAt, appendMessage, searchMessages, countThreadMessagesByAuthor, getLatestMessage, listMessagesByAuthor, hasMessage, hasMessageByContentByOther` | 14 |
| `members` | `store.ts:81-115` | `listMembers, listMembersIncludingDeleted, getMember, getMemberByName, insertMember, updateMemberStatus, setMemberWorkspace, updateMemberWorkspace, setMemberPiSessionFile, setMemberModel, setMemberDeleted, clearTaskOwners, clearConsumedSeqsForAgent, removeMemberFromAllChannels` | 11 |
| `tasks` | `store.ts:117-137` | `insertTask, listTasks, listChannelTasks, getTaskById, getTaskByMessageId, getTaskByChannelNumber, nextTaskNumber, updateTask, listTasksForAgent` | 7 |
| `reminders` | `store.ts:139-171` | `insertReminder, listReminders, getReminderById, listRemindersByAuthor, listRemindersForTarget, updateReminder, insertReminderLog, listReminderLogs` | 6 |
| `round logs (§07)` | `store.ts:173-185` | `insertRoundLog, listRoundLogs, listRoundLogsByTarget, pruneRoundLogs` | 3 |
| `reactions` | `store.ts:187-197` | `insertReaction, listReactions, hasReaction, deleteReaction` | 3 |
| `attachments` | `store.ts:199-210` | `insertAttachment, listAttachments, getAttachment` | 2 |
| `pinned (§3.5)` | `store.ts:212-224` | `insertPinnedMessage, listPinnedMessages, getPinnedMessage, deletePinnedMessage, setPinnedOrder` | 4 |
| `consumed_seqs` | `store.ts:226-228` | `getConsumedSeq, setConsumedSeq` | 2 |
| `未读角标 (BAI-6 reads)` | `store.ts:230-233` | `getChannelReadSeq, setChannelReadSeq, countUnreadChannelMessages` | 2 |
| `channel 级 mute (§3.2)` | `store.ts:235-241` | `setChannelMute, maxMessageRowid, clearChannelMute, getChannelMute, listChannelMutes` | 4 |
| **合计** |  |  | **57 方法 + `paths`/`withTransaction`/`close` 3 基础设施 = 60 条目** |

> 02 决议：57 方法为最小事实面，保留不妄删，06 收敛仅收窄落点不在 03 scope。

**dirs / types / data 补充**：
- `lib/data/dirs.ts:E10`：`DB_FILE_NAME raft.db / ATTACHMENTS_DIR_NAME / AGENTS_DIR_NAME` + `resolveDataDir(WORKSPLICE_DATA_DIR)` + `agentSlug:34`（小写→非 alnum 转 `-`，折叠去首尾，空回退 `agent`）+ `agentHomeDir:49`（`<agents>/<slug>-<id8>`）+ `buildMemoryTemplate:52`（标题 + 角色描述 + 当前工作/工作流程/Skill/工具/其他 5 大纲）。
- `lib/data/types.ts:E05`：15 行类型 + `SearchResult:145` + `InsertMessageInput:154` + `AppendMessageInput:163`；`toFtsQuery:171`（`split(/\s+/).map(token=>\"token\") .join(" AND ")`）与 `buildSearchSnippet:199`（早命中优先，radius 60，`escapeHtml + <mark>`）为纯函数。

---

## 4. 测试与工程基线

### 4.1 npm test 基线（347 用例，`node:test` 零框架依赖）

**门禁命令**（`package.json:scripts`）：

```bash
node --test lib/agent-loop/*.test.mjs lib/domain/raft/*.test.mjs components/ChannelView.test.mjs
# 全量基线（02 记 343 @ BAI-6，现 347；§4.3 起因新增用例）
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
# 绝不 next build（污染 .next/ 破坏 dev，见 AGENTS.md）
```

实测（2026-08-20，`node --test … 2>&1 | grep ℹ`）：

```
ℹ tests 347
ℹ pass 347  ℹ fail 0  ℹ duration_ms ~ 8700
```

> BAI-6 时 343，新增来自 `secretary/auto-create/e2e`、`reads/rounds/search-route` 等覆盖（含 02 后的 4 用例）；工程基线以 347 为准，后续 ticket 有新增再追记增量。

**分布表**（按文件 `grep -c "test("` 手扫，共 50 文件）：

| 域 | 文件 | 用例数 | 说明 |
|----|------|-------|------|
| **lib/domain/raft（29 文件）** | `tasks.test.mjs` 29 / `members.test.mjs` 18 / `reminders.test.mjs` 18 / `channels.test.mjs` 13 / `messages.test.mjs` 13 / `event-messages` 14 / `recurrence` 9 / `search` 7 / `pinned` 7 / `reads` 7 / `attachments` 7 / `secretary-auto-create` 7 / `secretary-init` 7 / `reactions` 5 / `inbox` 10 / `observability` 5 / `rounds` 8 / `*.route.test` 28（含 messages-route 7/tasks-route 5/rounds 3/search-route 2 等）+ `index` 3 + 其他 | **≈ 242** | 内存 tmp DB（`openDataDb(mkdtemp)`），直连 `globalThis.__workspliceDb` 不污染 `~/.worksplice/raft.db` |
| **lib/agent-loop（6 文件）** | `loop.test.mjs` 38 / `loop-tasks` 16 / `backfill` 16 / `driver` 13 / `wake` 11 / `reminder-cron` 4 / `inbox-route` 3 | **101** | fake `LoopRuntime` 注入，零 SDK（`node TS strip` 不解析 parameter properties） |
| **components（7 文件）** | `ChannelView` 17 / `AgentDetailPanel` 7 / `DetailPanel` 7 / `WorkspaceSidebar` 6 / `ChatInput` 6 / `ChatInput.dormancy` 1 / 其他 9 | **53** | `renderToStaticMarkup + jiti` 渲染断言 |
| 其他（`--route` / secretary e2e 等交叉） | `secretary-e2e` 6 / `secretary-route` 1 | 已计入 raft 域 |  |
| **合计（去重）** |  | **347** | `node:test + assert/strict` |

**测试分型纪律**（`docs/engineering-standards.md:32`）：
- 服务层单测 > agent-loop 单测 > 路由源码断言 > 组件渲染断言（优先便宜层）。
- 新增表/列必带 `SCHEMA_VERSION++` + 迁移函数 + 老库兼容单测。
- 全局 DB 固定 `globalThis.__workspliceDb = openDataDb(tmp)` 直连，不开 `~/.worksplice/raft.db`。

### 4.2 提交前门禁（`docs/engineering-standards.md:2.2`）

| 门禁 | 命令 | 作用 | 必绿 |
|------|------|------|------|
| typecheck | `npm run typecheck` = `tsc --noEmit`（`tsconfig.json strict:true, allowImportingTsExtensions:true, moduleResolution bundler`） | 类型完整性 | ✅ |
| lint | `npm run lint` = `eslint .`（`eslint.config.mjs` next 插件） | 风格/命名/术语一致 | ✅ |
| tests | `npm test` = 347 用例全绿 | 回归 | ✅ |

改动票据 05-07 等涉及 `loop.ts` 被 `globalThis` 闭包持有的模块后，**必须重启 dev server**（`docs/engineering-standards.md:5` 日常纪律第 2 条）。

### 4.3 成本与监控口径（`docs/cost-monitoring-baseline.md:E61`）

**采集方式**（`lib/session-stats.ts:E52` 198 行，与 SDK `getSessionStats` 同口径，不落库，详见 `docs/cost-monitoring-baseline.md:2.1`）：
- `message.usage`（assistant 消息）+ `compaction/branch_summary` 条目的 `usage`；
- 缓存 = `cacheRead`；未缓存 = `input + cacheWrite`；总 token = `input + output + cacheRead + cacheWrite`；
- 成本 = 各 `usage.cost.total` 之和。

| 符号 | 来源 |
|------|------|
| `parseSessionFileStats(filePath): SessionFileStats\|null` (`session-stats.ts:67`) | 解析单 `*.jsonl` |
| `sumSessionStats(stats[])` (`122`) | 聚合（`compactionCount/compactionTokens` 附加） |
| `listAgentSessionFiles(agent, SessionManager)` (`155`) | `pi_session_file` 精确 + workspace cwd 下全部会话 |
| `aggregateAgentUsage(agent)` (`192`) | 按 agent 聚合展示于 `AgentDetailPanel` 可观测性 tab |

**基线数据**（2026-08-13 实测，3 agent，`docs/cost-monitoring-baseline.md:2.2` 表）：

| agent | 消息数 | 总 token | 成本 USD |
|-------|-------|----------|----------|
| smoke-bot | 8 | 217,348 | 0.0000 |
| design | 36 | 1,072,610 | 0.1376 |
| Susan | 60 | 1,169,124 | 0.0000 |
| 合计 | 104 | 2,459,082 | ≈ $0.14 |

结论：缓存命中 1.82M/2.46M ≈ 74%，是主要成本抑制；监控建议每 release/每周记录一次 §2.2 表，单 agent 单会话 >$1 即排查非缓存长上下文重调用。

**监控面**（`docs/cost-monitoring-baseline.md:3.1` 已落地 4 机制）：

| 层 | 机制 | 入口 |
|----|------|------|
| 成员状态 | 四态 online/working/error/offline（`deriveLiveAgentStatus:376` + `publishAgentStatus` + 10s 扫掠 `startAgentStatusSweeper`） | `GET /api/members` + UI 侧栏点 |
| 轮次结果 | `round_logs`（7 结论状态，ring cap 200/agent，`listRoundLogs`） | `GET /api/members/[id]/observability → rounds` |
| 任务历史 | `listAgentTasks` + `buildAgentTimeline`（消息+状态点时序，不落额外表） | `observability → tasks/timeline` |
| token/成本 | 上述 `aggregateAgentUsage` 只读解析 | `observability → stats` |

**已内置节流**（`docs/engineering-standards.md:3 成本基线`）：
- `freshness-hold` 重试上限：`revise 2 / resend 3`（`lib/agent-loop/loop.ts:365`），耗尽归 `silent`。
- `must-respond` 连续失败 2 次 cap-ack 逃逸（`MUST_RESPOND_FAILURE_CAP 2`）。
- `busy-cwd 250ms` 退避不热自旋（`BUSY_CWD_RETRY_DELAY_MS`）。
- 附件 ≤50MB，落盘 `~/.worksplice/attachments/`。

### 4.4 工程分层与错误码纪律（`docs/engineering-standards.md:15-16 E62`）

**分层**：
```
UI 组件（components/*, app/*） 
  → 仅经 lib/domain/raft/* 服务层
  → 经 getDb(): Store（lib/data/db-singleton.ts）取实例
  → 具体 Adapter（lib/data/sqlite.ts）不被业务直引
```
- 纯查询辅助（`toFtsQuery/buildSearchSnippet`）例外落在 `lib/data/types.ts`。
- raft 唯一导入面 `lib/domain/raft/index.ts`，消费方一律 `from "@/lib/domain/raft"`；子域互相用相对直引，不绕索引。

**错误码语义**：
- `409 held/conflict/blocked` —— 业务冲突（freshness 不等/已认领/重开封锁）；
- `400` —— 非法入参/状态机越权；
- `404` —— 资源缺失；
- 同语义跨路由必同码（反例已整改：`tasks/[id]/update-status` 的 claim 边 `conflict/blocked` 与 `/claim` 同 409，见 `app/api/tasks/[id]/update-status/route.ts:10-11` 注释）。

**命名与语言**：
- 服务层动词开头（`listXxx/createXxx`）；路由一律 `export async function GET/POST`。
- 术语以 `CONTEXT.md` 域词表为准；代码注释/commit/issue 中文，标识符/API/错误消息英文；单引号（eslint 默认）。
- 密钥绝不进代码/日志/commit（`WORKSPLICE_PASSWORD` 走 `http basic pi`；`~/.pi/agent/models.json`）。

---

## 5. 尺度速览（`wc -l` 度量）

| 域 | 文件数 | 总行数 | 人均行数/文件 | 备注 |
|----|-------|--------|---------------|------|
| `lib/data` | 6 | 1,813 | 302 | `sqlite 994` 占半 |
| `lib/rpc` | 6 | 1,479 | 246 | `session 1038` 占 70% |
| `lib/domain/raft` | 17 | 2,626 | 154 | `tasks 327 / reminders 344` 最厚 |
| `lib/agent-loop` | 2 | 1,449 | 724 | 单深文件 1442 |
| `lib` 编排层（runtime/status/lifecycle/session-reader/stats/models-cache 等） | 6 | 993 | 165 | + 其余 44 支撑文件 6,621 |
| `app/api`（76 route） | 76 | 4,968 | 65 | `files/[...path] 414 / sessions/export 282 / auth/login 192` 最厚三路由 |
| `components`（32 件） | 32 | 19,406 | 606 | `ChannelView 3117 / ModelsConfig 2052 / ChatInput 2374` 最厚三组件 |

---

## 6. 对后续 ticket 的引用指北

- **04-RPC 边界与 SDK 委托**：直接引用 `§1.1 E11-E22`——`session 1038 + registry 141 + caller 197` 的职责切分与 `createAgentSessionServices→FromServices` 委托链，以及 `withExtensionTools + scopedModels` 的白名单口径。
- **05-agent-loop 重塑**：引用 `§1.2 E23-E30`——四段（round/driver/backfill/cron）所在行与 3 个 globalThis 守卫点（`MustRespondFailures E24 / AgentLoopDriver E25 / ReminderCron E28`）及热重载陷阱。
- **06-目标架构深模块**：引用 `§1.3 E31 + §1.4 + §3.2`——raft `export *` 单面、Store 13 段 57 方法、及 `ChannelView 3117`（11 概念）作为深模块拆分的反面样本。
- **07-UI 信息架构原型**：引用 `§2.2` 的 11 概念清单与 5.7k 行三栏骨架尺度，作为 `✓/✗` 评估的 before 度量。
- **08-兼容与迁移**：引用 `§3.1 E57-E58` 的 4 迁移 + seed + `SCHEMA_VERSION 11` 链，以及 `Store 57` 的冻结事实面。
- **09-spec 与计划粒度**：以本文件尺度速览 `§5`（`lib 7k + api 5k + components 19k + data 1.8k`）作为 ticket 排期与回归门禁的成本锚点。

---

*产出：`npm test` 347/347 全绿；`tcc --noEmit` 与 `eslint .` 以 `npm run typecheck/lint` 守门（见 E60）；证据行号以 HEAD 锚定。*
