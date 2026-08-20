# 05-agent-loop 驱动模型重塑（token 成本/可靠性/可观测性）

Type: grilling
Status: resolved
Blocked by: 01
Assignee: wayfinder-session-05

## Question

在 01 研究的事实基础上，重塑 `lib/agent-loop` 深模块的驱动模型，覆盖三类稳定性痛点。

- **token 成本**：`runAgentRound` 的 `buildReplyPrompt`/`buildRevisionPrompt`、`deliverWithFreshness` 四选一（revise/resend/silent/anyway）重试上限、freshness-hold 的烧 token 路径如何收敛（prompt 压缩、重试策略、模型路由）
- **可靠性**：`busy-cwd` 串行（`withCwdStartLock` + `hasBusyRpcSessionForCwd`）与 hint 丢失、backfill 补拉的归属门禁（ADR-0004 `backfill 归属门禁` + 跨作者去重）、游标推进语义（`consumed_seqs`）的正确性边界
- **可观测性**：`round_logs` 环形落盘与可观测页之外，是否增加成本/错误看板、用户可感知的失败解释（silent/error/capped 的显式呈现）、`docs/cost-monitoring-baseline.md` 的新基线口径
- 调用 `grilling` + `domain-modeling`：明确轮次/轮次结果/唤醒/回应判断的术语守卫，产出驱动层的新契约与 ADR 需求

## Answer

**决策总览（3 轮 grilling，12 问全采纳推荐）**：

**Token 成本（Q1+Q2）**：
- 主战场定为 **A+B 组合**：Prompt 压缩 + 重试收紧，**不引入模型路由**（基线 $0.14/2.46M token，缓存 74%，路由过早分流）。
- 压缩落地 **保守策略**：保留 `MESSAGE_CONTENT_CAP=4000/条` 截断，新增「新消息最近 20 条上限 + 任务 preview 120 字截断」；`listRelatedTasks(targetId)` 与 `agentMemoryFile` 现逻辑保持按需/存在才附加。
- 重试上限收敛：`MAX_REVISE_RETRIES 2→1`、`MAX_RESEND_RETRIES 3→1`、`MAX_TASK_STATUS_RETRIES 3→2`；`parseAgentAction` 默认 `onConflict` 由 `revise` → **`resend`**（held 后原样重试一次，耗尽再 silent）；保留 `anyway` 仅作显式逃逸口。

**可靠性（Q3+Q5）**：
- **Cwd 互斥深模块化**：抽 `lib/cwd-mutex.ts`，窄接口 `withCwdMutex(cwd, fn)`（内部自管 `trackStarting` 计数器 + `realpathSync` 归一 + `Map<realpath,count>` 状态）+ `isCwdBusy(cwd)` + `findBusySession(cwd)` 供 driver `waitForSettle(SETTLE_EVENTS)` 探测；保留 `BUSY_CWD_RETRY_DELAY_MS=250` 退避与 `SETTLE_EVENTS` 全面。
- **Backfill 双层门禁保留、语义不变**：文件级 `backfillOwnershipGate`（header cwd==workspace ∧ 不被他人引用 ∧ mtime≥createdAt，整文件跳过不推进）+ 轮级 `hasMessageByContentByOther` 跨作者去重（该 target 游标保持 pending 供 wake 重做）；游标推进维持“标记存在即推进”（含已存在回复也推进，覆盖补写后 ack 前崩溃窗口）；两条不变式写入 spec。

**可观测性（Q4）**：
- **轻量成本/错误看板**：`round_logs` 环形 cap 200/agent **新增三列** `prompt_tokens/completion_tokens/cost`（SDK 可取则同步写否则 null）；看板 badge 沿用 `isAbandonedRound`（silent+error/capped 的 abandoned 分离）+ `reason` 原文 + `must-respond capped` 显式解释。
- **Baseline 双视图**：`docs/cost-monitoring-baseline.md` 由全量 session 聚合单视图改为 **全量 + 最近 50 轮滑动** 双视图；`session-reader.ts` 只读聚合保留作全量校核。

**兜底与分级（R3-Q1/Q2）**：
- `MUST_RESPOND_FAILURE_CAP` **保留 2**（一次改过机会，二次 capped 强制 ack）。
- 错误分级保持：`revised reply had no content → error`（`ackSeq=input.baseSeq` 不推进，pending 可重试）与 `silent`（推进，已放弃）分离；badge 仅在 silent+exhausted/capped 时标 abandoned。

**术语与 ADR（R3-Q3）**：
- `CONTEXT.md` 新增 **Cwd 互斥 (CwdMutex)** 与 **成本看板 (Cost Board)** 两条（已落盘）。
- 新增 **ADR-0005 `agent-loop 重塑：成本/可靠性/可观测性`**（重试收敛 + 默认 resend + CwdMutex 抽取 + round_logs 增列），并在 ADR-0004 追加跨作者去重第二层段落。

**对后续票据输入**：
- 06 目标架构：`lib/cwd-mutex.ts` 为独立深模块，`lib/agent-loop` 内 driver/wake/backfill/cron 保持单深模块但依赖其窄接口；`round_logs` 三列增量与 `getDb(): Store` 单例保留。
- 07 UI：可观测页需承载新增 badge/双视图，但三栏骨架不变。
- 08 迁移：`round_logs` 新增列为幂等 `ALTER TABLE ADD COLUMN`（不重置 raft.db，沿用 `SCHEMA_VERSION` 链 11→12）。
- 证据：`lib/agent-loop/loop.ts:74-96,193-296,364-663,1031-1082,1183-1313` + `lib/data/schema.ts:3` + `docs/cost-monitoring-baseline.md:12-39`。

> Grilling 3 轮 12 问全记录于本票；`domain-modeling` 同步落 `CONTEXT.md`。
