## Summary

`round_logs` 从「只记发生了什么」升级为「同时记这一轮花了多少」：三列可空用量 + 可观测面板双视图。

```text
agent-loop driver
  snapshotBefore = session.get_session_stats()
  runAgentRound()
  snapshotAfter  = session.get_session_stats()   # same session object only
  logRoundOutcome({ ...outcome, usage: delta })  # null when unavailable

Data / persistence (SCHEMA_VERSION 15 → 16)
  round_logs
+   prompt_tokens     INTEGER   -- input + cacheRead + cacheWrite
+   completion_tokens INTEGER   -- output
+   cost              REAL      -- SDK cost delta; null when absent

Observability
  GET /api/members/[id]/observability
    rounds[]        # unchanged shape + per-round usage
    roundUsage      # { allTime, recent }  ← recent = last 50 rounds
```

- 迁移：`PRAGMA table_info` 逐列检测 + `ALTER TABLE ADD COLUMN`，仍在既有 `runMigrations()` 单事务内；`SCHEMA_STATEMENTS` 与 FTS5 触发器零改动（新库同样由迁移补齐）。
- 口径：`prompt_tokens = input + cacheRead + cacheWrite`（与 `lib/session-stats.ts` 一致），`completion_tokens = output`；取不到写 `null`，不按猜测定价。
- 聚合：`SUM` 忽略 NULL；`roundsWithUsage` / `roundsWithCost` 让 UI 区分「真的 0」与「没有数据」。
- UI：全量 + 最近 50 轮两组 token/cost；任一无数据单元格显示 `—`，token 有数而 cost 缺数时成本格也不伪装成 `$0.0000`。
- 未改：`rounds` 列表形状、`isAbandonedRound`、reason 原文、badge 语义、round 重试语义。

## Evidence

- **Before（基线 worktree `/tmp/ws-baseline-15`，HEAD=3b86a28）：** `npm test` → `tests 1551 / pass 1550 / fail 1`；唯一红为 `lib/model-listing.test.mjs`（environment-dependent，fresh install 下 SDK 默认模型列表非空），与本 PR 无关。
  **After（本分支）：** `npm test` → `tests 1560 / pass 1559 / fail 1`（同一基线红）；新增 9 个用例全绿。
- `npm run typecheck`：干净。
- `npm run lint`：0 error；1 个既有 warning（`hooks/useI18n.tsx:61` exhaustive-deps，文件未改）。
- 迁移证据（`lib/data/data-layer.test.mjs`）：
  - v11 形状库（7 列 `round_logs` + 历史行）→ v16：三列出现且类型 `INTEGER/INTEGER/REAL`，历史行保留、用量列 `null`，`user_version = 16`。
  - v15 形状库（`DROP COLUMN` 还原三列缺席）→ v16：同上；重复跑列集合与行数不变。
- 写入证据（`lib/agent-loop/driver.test.mjs`）：假会话每 prompt 累加 `input 100 / output 25 / cost 0.001`，轮收口落盘 `100 / 25 / 0.001`；轮前无会话（轮内 `startSession`）时三列 `null`。
- API 证据（`lib/domain/collab/observability-route.test.mjs`）：载荷 `roundUsage.allTime` 与 `roundUsage.recent` 数字正确，`rounds[]` 行带 `promptTokens/completionTokens/cost`。
- UI 证据（`components/AgentDetailPanel.test.mjs`，`renderToStaticMarkup`）：双视图有数渲染、全 null → `—`、仅 token 无 cost → 成本格 `—`。

## Merge Danger

**Door:** one-way

schema 迁移 / 持久化格式变更：新增可空列，旧数据保留、重复迁移幂等、无回填与删行；但一旦发布，旧版本读到的仍是同一 DB（`SELECT *` 忽略新列），回滚需保持列存在。

**Blast Radius:** persistence

- 触达 `round_logs` 表形状、`Store` 契约（`insertRoundLog` 入参 + 新 `aggregateRoundUsage`）、observability API 载荷（新增字段）与详情面板渲染。
- 不影响 FTS5、既有 16 条 `SCHEMA_STATEMENTS`、任务/消息/频道读写路径与 round 重试语义。
- 兼容：旧数据三列为 `null`；UI/API 对 `null` 全部按占位符处理。

## Closes

票据：`.scratch/pi-sdk-rebuild/issues/15-round-logs-cost-columns.md`（Status → resolved，含双轴 review 与证据）
