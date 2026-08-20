# 向后兼容与数据迁移策略

**背景**：存量 `~/.worksplice/raft.db` 已历 `SCHEMA_VERSION 11`（14 表 + FTS5 trigram + 5 triggers，4 个增量迁移函数幂等），`~/.worksplice/attachments/` 与 `~/.worksplice/agents/` 为文件面，`~/.pi/agent/sessions/*.jsonl` 由 pi SDK 读写；重构需在保留 `lib/rpc`/`agent-loop` 自研驱动耦合的同时，承诺数据不断、升级不丢、回滚可达。

**决策（ticket 08）**：
- **单向前兼容**：承诺 v1..v11 任一历史库一键升至 v12+（`SCHEMA_STATEMENTS IF NOT EXISTS` + `PRAGMA table_info` 列检测幂等），不支持 `user_version` 自动降级；回滚以文件覆写三件套 `raft.db + attachments/ + agents/` 为准，spec 显式声明。
- **单事务全量幂等不变式**：`runMigrations()` 保持 `db.transaction(() => { migrateMessagesFtsTrigram → 16 语句 → 4 检测 ALTER → seed → pragma user_version })` 单事务全量执行，每次启动全量跑，分期仅为 spec 排期，不引入 `drizzle-kit/prisma migrate`。
- **SCHEMA_VERSION 12 仅三列增量**：`round_logs` 新增 `prompt_tokens/completion_tokens/cost`（ADR-0005 成本看板），`migrateRoundLogsCostColumns()` 逐列 `ALTER ADD COLUMN` 幂等，无其他搭车；后续深模块切分零 schema 影响。
- **热重载与单例保留**：`getDb(): Store` 单例 + `__workspliceDbOpenedVersion !== SCHEMA_VERSION` 重建（`lib/data/db-singleton.ts:17-24`）保留，`Store 57 方法` 宽总线暂不拆分。
- **会话文件门禁保留在 worksplice 侧**：`固化 / 无主文件永不解析 / backfill 归属门禁 / 跨作者内容去重`（`CONTEXT.md:28-40`，ADR-0003/0004）不移入 SDK；`pi session 文件格式` 读写权归 SDK、app 只读，备份清单不含 `~/.pi/agent/sessions/`。
- **文件面不入 `runMigrations`**：`attachments/` 随机文件名与 `agents/MEMORY.md` 六段大纲仅入备份清单，非 DB 迁移。

**Consequences**：
- `SCHEMA_VERSION` 严格 `+1` 递增、不压缩；破坏单事务幂等视为兼容断点。
- 06 目标架构与 09 spec 分期可在不触 `schema.ts` 前提下落地；`cost-monitoring-baseline.md` 采用双视图口径。

**Status**: accepted
