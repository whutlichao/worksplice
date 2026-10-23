# 15 — round_logs 三列 + SCHEMA v16 + 成本看板双视图

**What to build:** 每轮 token/成本可观测：`round_logs` 新增 `prompt_tokens/completion_tokens/cost` 三列（**重定基线：SCHEMA_VERSION 15→16**——票面原写 11→12 已过期，v13/v14/v15 已分别是 task_thread_reads / avatar_tint / session_archive_index；本次仍只加三列、不改既有迁移，幂等 `ALTER ADD COLUMN`，SDK 可取则写否则 null）；可观测页成本看板双视图（全量聚合 + 最近 50 轮滑动），silent/error/capped badge 沿用 `isAbandonedRound` + reason 原文；老库一键升 v16 不重置、单事务幂等不变式、三件套文件覆写回滚承诺不变。

**Blocked by:** 14 — agent-loop 重试收敛 + prompt 截断（round 收口同 loop.ts 文件）

**Status:** resolved（2026-10-23）

- [x] `SCHEMA_VERSION 16` 仅三列 `ALTER ADD COLUMN` 幂等（`PRAGMA table_info` 逐列检测），`SCHEMA_STATEMENTS` 16 语句与 FTS5 触发器不动，老库一键升 v16 不重置、`runMigrations()` 单事务全量幂等不变式保留
- [x] round 收口写三列（轮前/轮后各取一次 SDK `get_session_stats` 累计值，差值为本轮用量；取不到则 null），error/silent/capped/busy-cwd 轮同样落盘
- [x] 可观测 API 返回成本双视图（全量聚合 + 最近 50 轮滑动），UI 显示 prompt/completion/total token 与 cost，SDK 缺数时 null 显示不炸
- [x] 迁移幂等单测（v11 形状库 + v15 形状库各起跑一次到 v16）+ `rounds.test.mjs`/`observability-route.test.mjs`/`driver.test.mjs`/`AgentDetailPanel.test.mjs` 回归；全量门禁 `tsc --noEmit + npm run lint + npm test` 绿（唯一红为基线既有 `model-listing`）
- [x] 手动③：N/A —— 本 worktree 无已配置 provider 的真实会话可跑（不伪造）；等价证据见下方假会话 driver 用例 + SSR 渲染断言

## Answer

### 结论

v15→v16：`round_logs` 增加三列可空用量（`prompt_tokens INTEGER` / `completion_tokens INTEGER` / `cost REAL`），每轮收口落盘；可观测 API 新增 `roundUsage`（`allTime` + `recent`，后者最近 50 轮滑动），面板按双视图展示 token/cost，null 安全显示 `—`。既有 `rounds` 列表、`isAbandonedRound`、reason 原文与 badge 语义未变。

### 红绿证据

- **Red（基线）**：`/tmp/ws-baseline-15`（HEAD=3b86a28 隔离 worktree）`npm test` → `tests 1551 / pass 1550 / fail 1`；唯一红为 `lib/model-listing.test.mjs` “lite path returns a working runtime without loading extensions”（fresh install 下 SDK 默认模型列表非空）——与本票无关，已在基线复现。
- **Green（本 worktree）**：`npm test` → `tests 1560 / pass 1559 / fail 1`（同上基线红）；新增 9 个用例全绿：
  - `lib/data/data-layer.test.mjs`：v11→v16 + v15→v16 迁移（列存在/类型正确、旧行不重置、重复跑幂等）、三列读写与 null、全量 vs 最近 50 轮聚合。
  - `lib/domain/collab/rounds.test.mjs`：usage 出线往返（camelCase、缺数 null）、双视图聚合数字。
  - `lib/agent-loop/driver.test.mjs`：假会话累计统计轮前/轮后差值 → `replied` 行写入 `100 / 25 / 0.001`；无轮前会话时三列 null。
  - `lib/domain/collab/observability-route.test.mjs`：路由载荷 `roundUsage.allTime/recent` 数字与 rounds 行用量。
  - `components/AgentDetailPanel.test.mjs`：`RoundCostStats` 双视图有数渲染、全 null 渲染 `—`、仅 token 无 cost 时成本格 `—`（不伪装 `$0.0000`）、`RoundLogsList` 单轮用量。
- `npm run typecheck`：干净。
- `npm run lint`：0 error；1 个既有 warning（`hooks/useI18n.tsx:61` exhaustive-deps，文件未改）。

### 迁移证据

- `SCHEMA_VERSION = 16`；`migrateRoundLogsCostColumns` 用 `PRAGMA table_info(round_logs)` 逐列检测 + `ALTER TABLE ADD COLUMN`，位置在既有 `db.transaction(() => { … seed … pragma })` 内。
- 未改 `SCHEMA_STATEMENTS` 任何语句与 FTS5 触发器：新库也在同一事务内由 `CREATE TABLE` + 该迁移得到最终形状。
- v11 形状库（含 7 列 `round_logs` + 历史行）与 v15 形状库（`DROP COLUMN` 还原三列缺席）均升级到 v16：三列类型 `INTEGER/INTEGER/REAL`，历史行保留且用量列为 null，`user_version = 16`；再跑一次列集合与行数不变。
- 回滚承诺：只增列，旧数据保留；三件套文件覆写语义未触碰。

### 双轴 review

- **Standards**：修正 i18n 运行时值拼接（`observability.costCoverage` 改为 `{withUsage}/{rounds}` 插值）；修正“有 token 无 cost”窗口把缺数渲染成 `$0.0000` 的语义缺陷（聚合新增 `roundsWithCost`，UI 单列判空）。遗留判断项：`CONTEXT.md` 与 `docs/spec-rebuild.md` 仍写旧口径/v12——不在本票 Ownership，未改，建议单独票据同步。
- **Spec**：逐条对照通过；唯一字面偏差 `SCHEMA_STATEMENTS` 已按约束回退（三列只由迁移补齐）。范围外零改动。

### 兼容与回滚

- 迁移仅 `ALTER TABLE ADD COLUMN`（可空），不重建表、不删行、不改既有列；旧库/新库往返幂等。
- 旧版本进程遇到 v16 库：`getDb()` 版本守卫按 `SCHEMA_VERSION` 重建实例；数据文件本身向前兼容（旧代码 `SELECT *` 忽略新列）。

### 手动项

- ③ 真实会话 cost badge：N/A —— 本机 worktree 未配置可用 provider，无真实 agent 会话可跑；不伪造。替代证据：假会话 driver 用例证明轮收口写数、路由载荷用例证明 API 出数、SSR 用例证明面板渲染有数/缺数两态。真实会话首轮可能因“轮前无会话”记 null（轮内才 `startSession`），次轮起有差值——这是按 spec “可取则取，否则 null” 的预期行为。

### 文档漂移（Ownership 外，未改）

- `docs/spec-rebuild.md:58,75,158` 与 ADR-0006 相关段落仍写 `SCHEMA_VERSION 12` / v11→v12；`CONTEXT.md` “成本看板”写“全量 session 聚合”。本票只在 `docs/cost-monitoring-baseline.md` 同步了新口径。

### PR

- PR #202（https://github.com/whutlichao/worksplice/pull/202），body：`.scratch/pi-sdk-rebuild/pr-body-15-round-logs-cost.md`。
- **Door: one-way**（schema 迁移 / 持久化格式变更）；本票不合并，保留给人工合并。
