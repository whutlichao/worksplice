# 15 — round_logs 三列 + SCHEMA v12 + 成本看板双视图

**What to build:** 每轮 token/成本可观测：`round_logs` 新增 `prompt_tokens/completion_tokens/cost` 三列（SCHEMA_VERSION 11→12，幂等 `ALTER ADD COLUMN`，SDK 可取则写否则 null）；可观测页成本看板双视图（全量聚合 + 最近 50 轮滑动），silent/error/capped badge 沿用 `isAbandonedRound` + reason 原文；老库 v11 一键升 v12 不重置、单事务幂等不变式、三件套文件覆写回滚承诺不变。

**Blocked by:** 14 — agent-loop 重试收敛 + prompt 截断（round 收口同 loop.ts 文件）

**Status:** ready-for-agent

- [ ] `SCHEMA_VERSION 12` 仅三列 `ALTER ADD COLUMN` 幂等（`PRAGMA table_info` 逐列检测），`SCHEMA_STATEMENTS` 16 语句与 FTS5 触发器不动，老库 v11→v12 一键升不重置、`runMigrations()` 单事务全量幂等不变式保留
- [ ] round 收口写三列（prompt 前后各取一次或 SDK 提供则取否则 null），error/silent/capped 轮同样落盘
- [ ] 可观测 API 返回成本双视图（全量聚合 + 最近 50 轮滑动），UI badge 显示 token/cost，SDK 缺数时 null 显示不炸
- [ ] 迁移幂等单测（老库 v11 起跑）+ `rounds.test.mjs`/`observability.test.mjs` 回归；全量门禁 `tsc --noEmit + npm run lint + npm test`（347）全绿
- [ ] 手动③：可观测页 cost badge 非空（真实会话跑一轮后可见 token/cost）