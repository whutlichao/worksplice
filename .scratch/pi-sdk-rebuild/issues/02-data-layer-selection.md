# 02-数据层选型与 Store 契约去留研究

Type: research
Status: resolved
Blocked by:

## Question

研究数据层的去留与 Store 契约的收敛方向，回答「保留 better-sqlite3 + Store 契约」vs「委托 pi 存储」vs「换库」的 trade-off。

- 现状盘点：`lib/data/store.ts`（Store 接口契约）、`lib/data/sqlite.ts`（SQLiteAdapter 同步 API）、`lib/data/schema.ts` SCHEMA_VERSION 11 迁移链（含 FTS5 trigram、channel_mutes/channel_reads/round_logs 等）、`lib/data/db-singleton.ts` 单例与热重载守卫
- pi SDK 侧是否有存储能力可委托 raft 数据（channels/members/messages/tasks/reminders/reactions/attachments/pinned/consumed_seqs/round_logs），若无则明确边界
- 换库选项（drizzle/postgres 等）的成本与收益评估，结合单机单进程、零依赖、事务 + FTS5 刚需
- 产出写入 `.scratch/pi-sdk-rebuild/research/02-data-layer-selection.md`，给出明确选型建议与理由（保留并收敛 / 部分委托 / 换库），并列出对 SCHEMA 兼容与迁移链的影响，为 06/08 的架构与兼容决策提供输入

## Answer

详见 findings：[research/02-data-layer-selection.md](../research/02-data-layer-selection.md)

要点（结论先行：**保留并收敛 — 保留 better-sqlite3 + Store 契约，零委托 pi 存储，零换库**）：
- **pi 存储可委托性 = 0**：SDK 仅有 `SessionStorage`/`SessionManager`（LLM 会话 jsonl 追加树，`message/compaction/branch_summary` 8 变体，`types.d.ts:337-362` 11 方法），无 channels/tasks/members 等 raft 表能力；`@earendil-works/pi-storage-sqlite-node` 未安装且定位仍是 session 后端可插拔而非通用 KV（`README.md:13` 证据）。
- **换库必要性 = 0**：`drizzle/postgres/pglite/prisma` 均不满足单机零服务 + 同步事务（`withTransaction` 同步闭包，`messages.ts:111` freshness-hold 同事务 `maxSeq` 比对）+ FTS5 trigram 刚需；`better-sqlite3 13.0.2`（`package.json:46` WAL+FK 同步 API）已是最小事实面。
- **Store 契约保留、适度收敛**：57 方法 + 2 属性（`store.ts:35-242`）为"每表一组 CRUD + 2 游标/2 freshness"最小事实面；收敛点在 §5.3（窄接口 + 内聚事务原语），不动迁移链。
- **SCHEMA 兼容无破坏**：`SCHEMA_VERSION 11`（`schema.ts:3`）14 语句 + 4 迁移函数（幂等 `IF NOT EXISTS`/`ALTER ADD COLUMN`）+ WAL 事务内 `seed`（`#all`+Owner）；06 深模块切分与 08 迁移分期均可不重置 `raft.db` 落地。
- 证据索引覆盖 `lib/data/*` 5 文件 + `lib/domain/raft/index.ts` 唯一导入面 + SDK 两包无 DB 依赖（`package.json:dependencies` 全文 grep 为空）+ `ls pi-storage* → No such file`，后续 06/08 直接引用行号。
