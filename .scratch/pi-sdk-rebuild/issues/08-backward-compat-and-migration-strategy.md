# 08-向后兼容与数据迁移策略

Type: grilling
Status: resolved
Blocked by: 02
Assignee: wayfinder-session-08

## Question

在 02 选型结论基础上，决策向后兼容与数据迁移策略。

- 存量 `~/.worksplice/raft.db`（SCHEMA_VERSION 11 链）与 `~/.pi/agent/sessions/*.jsonl` 的兼容承诺（是否平滑迁移、是否支持旧库一键升级、回滚点）
- 迁移形态：分几期、每期迁移哪些表/列（如 `round_logs`/`channel_reads`/`channel_mutes` 等近期新增表）、迁移脚本的幂等与版本守卫（`db-singleton` 热重载守卫是否保留）
- 附件与家目录（`~/.worksplice/attachments/`、`~/.worksplice/agents/<slug>/` MEMORY.md）是否纳入迁移范围
- 调用 `grilling` + `domain-modeling`：明确会话文件固化（`pi_session_file`）、无主文件永不解析等已有门禁在新架构下是否保留

## Answer

**决策总览（1 轮 grilling，6 问均采纳推荐）**：

**兼容承诺（Q1）**：
- **单向前兼容（Forward-only），不做自动降级**。承诺存量 `~/.worksplice/raft.db` 从任意历史版本 v1..v11 一键升至 v12+（`SCHEMA_STATEMENTS 16 语句` + 4 个 `PRAGMA table_info` 列检测迁移函数幂等）；**不支持 `user_version` 自动 down**。回滚以**文件覆写**为准：备份三件套 `raft.db + attachments/ + agents/` 拷贝还原，旧二进制对 `round_logs` 新增列忽略（显式列名查询已规避 `SELECT *`）。spec 显式声明"降级请用文件备份"。

**迁移执行不变式（Q2）**：
- **单事务全量幂等不变式保留**：`runMigrations()` 保持 `db.transaction(() => { migrateMessagesFtsTrigram → 16 语句 IF NOT EXISTS → 4 检测 ALTER → seed → pragma user_version })` 单事务全量执行（`lib/data/schema.ts:192-204`）；每次启动全量跑，分期仅为 spec/实现排期，不对应运行时分段。`SCHEMA_VERSION` 严格 `+1` 单调递增，不压缩、不重编号，破坏视为兼容断点；不引入 `drizzle-kit/prisma migrate` 新工具链。

**版本落点（Q3）**：
- **SCHEMA_VERSION 12 只含 `round_logs` 三列增量**：`prompt_tokens INTEGER / completion_tokens INTEGER / cost REAL`（05 成本看板所需，`ROUND_LOGS` 新增列），新增 `migrateRoundLogsCostColumns()` 按 `migrateTasksReopenedColumn()` 同模式逐列 `PRAGMA` 检测后 `ALTER TABLE ADD COLUMN` 幂等；`SCHEMA_STATEMENTS 16 语句` 与 `FTS5 trigram 5 triggers + seed` 不动。06 深模块切分零 schema 影响，spec §5 明确"结构重排不碰表"。

**热重载与单例（Q4）**：
- **`getDb(): Store` 单例 + `__workspliceDbOpenedVersion !== SCHEMA_VERSION` 热重载重建双保留**（`lib/data/db-singleton.ts:17-24` + `lib/data/sqlite.ts:987-990`）。`Store` 57 方法宽总线暂不拆 `ChannelStore/TaskStore`（02 §5.3 N6 论证），保留按域分组的窄总线形态；`lib/domain/raft/index.ts` 唯一对外导入面纪律不变。

**会话文件门禁（Q5，domain-modeling）**：
- **`固化 (Fixation)` / `无主文件 (Unowned)` / `backfill 归属门禁` / `跨作者内容去重` 四术语原定义保留不变**（`CONTEXT.md:28-40`），不新增术语。校验逻辑保留在 `lib/agent-runtime.ts:62-130 chooseSessionFileForStart` 与 `lib/agent-loop/loop.ts:1031-1082 backfill`，不移入 SDK。`pi session 文件格式` 读写权归 SDK、app 只读不解析（`CONTEXT.md:28` + `map.md Out of scope`）在 spec §6.5 显式引用 ADR-0003/0004；`lib/cwd-mutex.ts` 单独成章但不影响门禁。

**文件面范围（Q6）**：
- **`attachments/` 与 `agents/<slug>-<id8>/MEMORY.md` 不纳入 `runMigrations`**：`attachments.disk_path` 仅为路径字符串无 FK 级联（`schema.ts:93-101`），`agents/` 为文件面（`dirs.ts:34-36`）；迁移脚本不触文件。**备份/回滚清单三件套** = `~/.worksplice/raft.db 单文件 + ~/.worksplice/attachments/ 目录 + ~/.worksplice/agents/ 家目录`（`lib/data/dirs.ts:22-29` 三路径）；`~/.pi/agent/sessions/*.jsonl` 归 SDK 侧，不在 raft 备份内。`~/.pi/agent/sessions/*.jsonl` 兼容承诺为"格式不碰、读写权归 SDK、app 只读"（02 §5.4 + map Out of scope 末条）。

**术语与 ADR（Q5/Q6 会诊）**：
- `CONTEXT.md` 四术语保留，无新增"数据兼容承诺"术语（以 ADR 文字为准，避免 glossary 膨胀）。
- 新增 **ADR-0006 `向后兼容与数据迁移策略`**（单向前兼容 + 单事务幂等 + v12 三列增量 + 热重载守卫保留 + 固化门禁保留 + 文件面三件套备份），并补 **ADR-0005 `agent-loop 重塑：成本/可靠性/可观测性`**（05 遗留）。

**对后续票据输入**：
- 06 目标架构：零新增表压力，深模块切分可在不触 `schema.ts` 前提下落地；`lib/data` 5 文件扁平保留，`getDb(): Store` 单例与版本守卫为不变式写入 spec §5。
- 09 spec 形态与迁移计划颗粒度：兼容承诺与三件套备份为不变量，迁移分期仅为 spec 章节与回归粒度（每期仍全量跑 `runMigrations`）；性能基线 `docs/cost-monitoring-baseline.md` 采用 05 双视图（全量 + 最近 50 轮滑动），v12 新增列由 `round_logs` 承载。
- 证据：`lib/data/schema.ts:3,8-160,192-204,210-244` + `lib/data/db-singleton.ts:17-24` + `lib/data/dirs.ts:10-36` + `CONTEXT.md:28-40` + `docs/adr/0003-session-file-ownership.md` + `docs/adr/0004-backfill-ownership-guard.md`。

> Grilling 1 轮 6 问均采纳推荐；`domain-modeling` 确认四术语保留、ADR-0006 立项。
