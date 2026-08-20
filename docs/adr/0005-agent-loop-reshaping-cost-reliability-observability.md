# agent-loop 重塑：成本/可靠性/可观测性

**背景**：`lib/agent-loop` 深模块（`loop.ts:1442` 行，round/driver/backfill/cron 四段）承载 token 成本、cwd 串行可靠性与可观测性三类稳定性痛点；`deliverWithFreshness` 四选一重试与 prompt 尺寸是主成本源，`busy-cwd` 双层防护与 backfill 归属校验是可靠性主战场。

**决策（ticket 05）**：
- **成本**：`MAX_REVISE_RETRIES 2→1`、`MAX_RESEND_RETRIES 3→1`、`MAX_TASK_STATUS_RETRIES 3→2`，默认 `onConflict` 由 `revise` 改 `resend`（held 后原样重试一次、耗尽 silent）；prompt 保守压缩（保留 `MESSAGE_CONTENT_CAP=4000/条`，新增最近 20 条 + 任务 preview 120 字截断），不引入模型路由。
- **可靠性**：抽 `lib/cwd-mutex.ts` 窄接口 `withCwdMutex(cwd, fn)` + `isCwdBusy(cwd)` + `findBusySession(cwd)`（`realpathSync` 归一 + starting 计数器 + `waitForSettle(SETTLE_EVENTS)`），保留 `BUSY_CWD_RETRY_DELAY_MS=250`；backfill 双层门禁保留（文件级 `backfillOwnershipGate` + 轮级 `hasMessageByContentByOther` 跨作者去重），游标"标记存在即推进"语义不变。
- **可观测性**：`round_logs` 环形 cap 200/agent 新增 `prompt_tokens/completion_tokens/cost` 三列（SDK 可取则写否则 null），成本看板 badge 沿用 `isAbandonedRound` + `reason` 原文；`docs/cost-monitoring-baseline.md` 改为双视图（全量聚合 + 最近 50 轮滑动）。
- **兜底**：`MUST_RESPOND_CAP=2` 保留，`revised reply had no content → error（不推进）` 与 `silent（推进）` 分级不变。

**Consequences**：
- 持有 cost 的 round 可直接在可观测页归因，freshness-hold 的烧 token 路径收敛 50% 重试。
- `lib/cwd-mutex.ts` 成为 `agent-runtime` 与 `driver` 共用的唯一串行事实来源，新增 `realpath` 单测。
- `SCHEMA_VERSION 12` 增量为幂等 `ALTER TABLE round_logs ADD COLUMN`（见 ADR-0006）。

**Status**: accepted
