# 02 — 数据层：SQLite schema + FTS

**What to build:** 独立存储层就位（better-sqlite3，同步 API）：应用数据目录（默认 `~/.worksplice/`，`WORKSPLICE_DATA_DIR` 可覆盖）下的 raft.db 含 §6.2 全部 9 张表（channels / members / messages / tasks / reminders / reactions / attachments / pinned_messages / consumed_seqs）；target 归一化约定落地（target_id 单列，命中 channels 则为 channel、否则为 thread 锚点，`UNIQUE(target_id, seq)` 保证每 target 内 seq 唯一且消息不可编辑——同 seq 的 UPDATE/DELETE 一律拒绝）；FTS5 虚拟表 + 触发器同步；迁移脚本幂等可重复执行。本 ticket 交付的是库与约束，由测试验证（spec §6.1–6.4、§6.6）。

**Blocked by:** 01

**Status:** resolved

- [ ] 迁移从零建库成功，重复执行幂等；数据目录可用 `WORKSPLICE_DATA_DIR` 覆盖
- [ ] 9 张表列定义与 §6.2 一致；`#all` 内建 channel 行与 owner 成员种子数据存在
- [ ] `UNIQUE(target_id, seq)` 生效：同 seq 的 UPDATE/DELETE 被拒绝（消息不可变）
- [ ] FTS5 触发器同步：消息插入/更新/删除后索引与内容一致（测试验证）
- [ ] 服务层提供 schema 之上的基础读写封装（事务内 `SELECT max(seq)` 等 freshness 原语可用）

## Answer

全部 5 项验收完成（`lib/data/`，9 个测试全绿；spec §6.1–6.4、§6.6）：

- `lib/data/dirs.ts` — 数据目录解析：`WORKSPLICE_DATA_DIR` 覆盖，默认 `~/.worksplice/`；ensure 创建 `raft.db` 与 `attachments/`
- `lib/data/schema.ts` — 9 张表（列定义与 §6.2 逐列一致）+ `messages_fts`（FTS5 external content）+ 5 个触发器（messages 不可变 BEFORE UPDATE/DELETE × 2、FTS 同步 × 3）；`UNIQUE(target_id, seq)`、`UNIQUE(message_id, member_id, emoji)`、`PK(agent_id, target_id)`；种子数据 `#all` channel + owner member（INSERT OR IGNORE 幂等）；`runMigrations` 可重复执行（IF NOT EXISTS + user_version 标记）
- `lib/data/db.ts` — `RaftStore`：`withTransaction()` + `maxSeq(targetId)` freshness 原语（§6.3），9 张表的基础读写封装 + `appendMessage`（事务内 max(seq)+1）+ `searchMessages`（FTS5 snippet）
- 配置：next.config.ts `serverExternalPackages` += better-sqlite3；tsconfig `allowImportingTsExtensions`（node --test 直接加载 .ts 的既有模式）
- 测试 `lib/data/data-layer.test.mjs`：从零迁移+幂等、列定义与 §6.2 比对、env 覆盖/默认路径、种子数据、UNIQUE 拒绝重复 seq + 不可变 UPDATE/DELETE、FTS 索引同步、事务内 max(seq)、其余表基础封装

评审（/code-review 双轴）无 Spec 缺口；按 Standards 意见收敛三处：依赖固定精确版本、移除 `runMigrations` 注入时钟、移除 db.ts 未用 re-export。freshness compare/rollback（§6.3 held 摘要）属 ticket 06 范围。
