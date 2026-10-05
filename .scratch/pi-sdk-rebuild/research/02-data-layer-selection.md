# 02-数据层选型与 Store 契约去留研究

> 证据索引（Evidence Index）——一级来源 `文件:行号`，未转述二级资料。
>
> **数据层核心**
> - `lib/data/store.ts:35-242`（Store 契约 242 行，~57 方法 + 事务/游标原语）
> - `lib/data/sqlite.ts:35-994`（SQLiteAdapter 同步实现 994 行，`better-sqlite3` WAL + FK）
> - `lib/data/schema.ts:1-266`（SCHEMA_VERSION 11，SCHEMA_STATEMENTS 14 语句 + 4 迁移函数 + seed）
> - `lib/data/db-singleton.ts:1-25`（`getDb(): Store` 单例 + `__workspliceDbOpenedVersion` 热重载守卫）
> - `lib/data/dirs.ts:1-57`（`resolveDataDir/ensureDataDir/DataPaths`，`~/.worksplice` + attachments/agents 子目录）
> - `lib/data/types.ts:1-229`（行类型 + 枚举 + `toFtsQuery/buildSearchSnippet/escapeLike` 纯函数）
> - `package.json:46-47`（`better-sqlite3 13.0.2` + `@types/better-sqlite3 9.6.0`）
>
> **raft 消费面**
> - `lib/domain/raft/index.ts:1-35`（`export *` 汇合 15 子模块，唯一对外导入面；`getDb` 不在此面）
> - `lib/domain/raft/messages.ts:1-219`（`sendMessage` freshness-hold + thread 归一化 + wake 触发面）
> - `lib/domain/raft/*` 15 文件（channels/members/messages/tasks/inbox/wake/reminders/search 等）
> - `docs/engineering-standards.md:15-16`（分层纪律：`Store` 契约 + `getDb(): Store`，业务不写 SQL）
>
> **pi SDK 存储面（0.83.0，dist 声明为准）**
> - `pi-agent-core` 总出口: `node_modules/@earendil-works/pi-agent-core/dist/index.d.ts:1-15`（re-export harness/session/types）
> - `pi-agent-core` Session 抽象: `node_modules/@earendil-works/pi-agent-core/dist/harness/types.d.ts:337-380`（`SessionStorage/SessionRepo/JsonlSessionRepoApi` 三接口）
> - `pi-agent-core` README: `node_modules/@earendil-works/pi-agent-core/README.md:13`（SQLite session backend 在独立包 `@earendil-works/pi-storage-sqlite-node`，core 默认不带）
> - `pi-coding-agent` SessionManager: `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts:60-350`（`SessionManager` 类 + jsonl 追加树，`CURRENT_SESSION_VERSION=3`）
> - `pi-coding-agent` 依赖: `node_modules/@earendil-works/pi-coding-agent/package.json:dependencies`（无 `better-sqlite3/sqlite` 依赖）
> - `pi-agent-core` 依赖: `node_modules/@earendil-works/pi-agent-core/package.json:dependencies`（仅 `diff/ignore/typebox/yaml`，无数据库）
> - 失踪包证据: `ls node_modules/@earendil-works/pi-storage* → No such file`（未安装，core/README 所指的独立包不在本次安装集中）

---

## 0. 摘要（面向 06/08 决策，结论先行）

**选型建议：保留并收敛（Retain & Narrow）—— `保留 better-sqlite3 + Store 契约，零委托 pi 存储，零换库`。**

| 维度 | 结论 | 一句话理由 |
|---|---|---|
| **pi 存储可委托性** | **零**。pi SDK 无 raft 域通用存储能力 | SDK 仅有 `SessionStorage`（LLM 会话树，`message/compaction/branch_summary` 8 变体）与 `SessionManager` jsonl 追加树，无 channels/tasks/members 等 raft 表能力；`@earendil-works/pi-storage-sqlite-node` 独立包未安装且定位仍是 session 后端而非通用 KV（README 证据） |
| **换库必要性** | **零**。`drizzle/postgres/pglite/prisma` 均不满足单机单进程 + 零服务 + 同步事务 + FTS5 刚需 | 详见 §4 成本收益表 |
| **Store 契约** | **保留，适度收敛**（窄接口 + 内聚事务原语） | 57 方法面已是"每表一组 CRUD + 2 游标/2 freshness"的最小事实面；收敛点在 §5.3，不动迁移链 |
| **对 SCHEMA 兼容** | **无破坏**。`SCHEMA_VERSION 11` 链保持增量 only，`user_version` 守卫与 `db-singleton` 热重载守卫保留 | 06 的深模块切分与 08 的迁移分期均可在不重置 `raft.db` 的前提下落地；唯一风险是若换库则需全量重写 11 版迁移（见 §5.4） |

**一句话背书**：raft 数据面（12 表 + FTS5 trigram + `UNIQUE(target_id,seq)` + 不可变 trigger + 4 游标体系）是 worksplice 自研产品的核心状态机，pi SDK 的定位是"中层能力底座（tools/extensions/skills/session/model）"，两者按 `.scratch/pi-sdk-rebuild/map.md:12` 的"pi 管 pi，raft 管 raft"原则天然正交；把 raft 委托给 pi 或换库都是以高成本换零收益。

---

## 1. 现状盘点

### 1.1 Store 契约方法清单（`lib/data/store.ts:35-242`）

契约共 **57 方法 + 2 属性**，按域分组如下（行号为 `store.ts` 声明首行）：

| 分组 | 行号 | 方法（签名缩写） | 备注 |
|---|---|---|---|
| **生命周期** | `store.ts:37` `store.ts:39` `store.ts:42` | `paths: DataPaths` / `close()` / `withTransaction<T>(fn)=>T` | `withTransaction` 为同步事务原语（`sqlite.ts:58-61` 委托 `db.transaction(fn)`），内存实现需自保证原子性 |
| **freshness** | `store.ts:46` | `maxSeq(targetId)→number` | 房间版本，`sqlite.ts:64-69` 为 `SELECT COALESCE(MAX(seq),0)` |
| **channels** | `store.ts:49-62` | `listChannels/getChannel/insertChannel/setChannelArchived/listChannelMembers/isChannelMember/addChannelMember/removeChannelMember` | 8 方法，`insertChannel` 含 `id/name/type/description/createdAt` 5 选参 |
| **messages** | `store.ts:65-79` | `listMessagesBefore/hasMessagesBefore/threadReplyCount/threadReplyCounts/listMessagesAfter/listMessages/getMessage/insertMessageAt/appendMessage/searchMessages/countThreadMessagesByAuthor/getLatestMessage/listMessagesByAuthor/hasMessage/hasMessageByContentByOther` | 15 方法，`appendMessage` 为"事务内 max+1"（`sqlite.ts:360-365`），`searchMessages` 为双路径 FTS（`sqlite.ts:373-405`） |
| **members** | `store.ts:82-115` | `listMembers/listMembersIncludingDeleted/getMember/getMemberByName/insertMember/updateMemberStatus/setMemberWorkspace/updateMemberWorkspace/setMemberPiSessionFile/setMemberModel/setMemberDeleted/clearTaskOwners/clearConsumedSeqsForAgent/removeMemberFromAllChannels` | 14 方法，`insertMember` 9 选参（含 `modelProvider/modelId/thinkingLevel` §3.10）；`listMembersIncludingDeleted` 含 soft-deleted 供消息渲染 |
| **tasks** | `store.ts:118-137` | `insertTask/listTasks/listChannelTasks/getTaskById/getTaskByMessageId/getTaskByChannelNumber/nextTaskNumber/updateTask/listTasksForAgent` | 9 方法，`nextTaskNumber` 按 channel 递增 #1.. |
| **reminders** | `store.ts:140-171` | `insertReminder/listReminders/getReminderById/listRemindersByAuthor/listRemindersForTarget/updateReminder/insertReminderLog/listReminderLogs` | 8 方法，`reminder_logs` 生命周期全量留痕 |
| **round_logs** | `store.ts:174-185` | `insertRoundLog/listRoundLogs/listRoundLogsByTarget/pruneRoundLogs` | 4 方法，§07 可观测性 ring cap（每 agent 200 轮） |
| **reactions** | `store.ts:188-197` | `insertReaction/listReactions/hasReaction/deleteReaction` | 4 方法，`UNIQUE(message_id,member_id,emoji)` |
| **attachments** | `store.ts:200-210` | `insertAttachment/listAttachments/getAttachment` | 3 方法，`disk_path` 指向 `~/.worksplice/attachments/` 随机文件名 |
| **pinned** | `store.ts:213-224` | `insertPinnedMessage/listPinnedMessages/getPinnedMessage/deletePinnedMessage/setPinnedOrder` | 5 方法，per-member 个性化，`order` 手动排序 |
| **consumed_seqs** | `store.ts:227-228` | `getConsumedSeq/setConsumedSeq` | inbox 游标（§5.3/5.4 driver 持久化） |
| **channel_reads** | `store.ts:231-233` | `getChannelReadSeq/setChannelReadSeq/countUnreadChannelMessages` | BAI-6 未读游标，`countUnread` = `author!=me && seq>read_seq`（`sqlite.ts:934-942`） |
| **channel_mutes** | `store.ts:236-241` | `setChannelMute/maxMessageRowid/clearChannelMute/getChannelMute/listChannelMutes` | §3.2 mute，`mute_rowid = max(rowid)` 供 thread 消息判定（`sqlite.ts:944-979`） |

**统计口径**：按 `grep "^\s*[a-z].*(" lib/data/store.ts | wc -l` 57 声明行；不含注释与重载。

**实现唯一性**：
- 契约当前**仅一实现**：`SQLiteAdapter implements Store`（`sqlite.ts:35-980`）；注释 `store.ts:5` 的"预留 InMemoryAdapter"尚未实现（`grep InMemoryAdapter lib/` 仅 2 行注释，无类定义）。
- `withTransaction` 与 `appendMessage` 的事务绑定是 freshness-hold 正确性前提（`messages.ts:111-119` 事务内 `maxSeq` 比对，不等 → `held`）。

### 1.2 数据目录与文件面（`lib/data/dirs.ts:1-57`）

```
resolveDataDir()              // WORKSPLICE_DATA_DIR ? resolve : ~/.worksplice  (dirs.ts:10-13)
ensureDataDir(dir)            // mkdir -p dataDir/attachments/agents          (dirs.ts:31-37)
DataPaths { dataDir, dbFile~ raft.db, attachmentsDir, agentsDir } (dirs.ts:15-20)
agentHomeDir(dataDir,id,name) // <agentsDir>/<slug>-<id8> （ADR-0001）      (dirs.ts:49-51)
buildMemoryTemplate(name,desc)// MEMORY.md 六段式固定大纲                        (dirs.ts:54-56)
```

`SQLiteAdapter.open(dataDir?)`（`sqlite.ts:44-52`）在实例化时即 `ensureDataDir` + `pragma journal_mode=WAL` + `pragma foreign_keys=ON` + `runMigrations`（原子事务内）。

### 1.3 `better-sqlite3` 绑定（`package.json:46` + `sqlite.ts:2,47-49`）

| 项 | 值 | 证据 |
|---|---|---|
| 运行时 | `better-sqlite3 13.0.2`（native 同步 API） | `package.json:46` |
| 类型 | `@types/better-sqlite3 9.6.0` | `package.json:57` |
| 打开 | `new Database(paths.dbFile)` + `pragma WAL/FK` | `sqlite.ts:47-49` |
| 事务 | `db.transaction(fn)` 同步闭包 | `sqlite.ts:58-60` |
| 覆盖 | 全部 57 方法均走 `db.prepare(...).get/all/run` 同步调用，无 async/promise | `sqlite.ts:64-979` 全文 |
| 单例守卫 | `globalThis.__workspliceDb` + `__workspliceDbOpenedVersion !== SCHEMA_VERSION` 重建 | `db-singleton.ts:17-24` + `sqlite.ts:987-990` |

> 同步 API 是 freshness-hold 与 `consumed_seqs` 游标正确性的基石：单进程内无交错，`maxSeq` 比对到 `appendMessage` 提交在同一 `db.transaction` 内完成（`messages.ts:111`）。

---

## 2. Schema 11 迁移链清单（`lib/data/schema.ts:1-266`）

### 2.1 SCHEMA_VERSION 与存储形态

- **当前版本**：`SCHEMA_VERSION = 11`（`schema.ts:3`），`user_version = 11` 落盘（`schema.ts:202`）。
- **建表语句**：`SCHEMA_STATEMENTS: string[]` 含 **16 语句**（`schema.ts:8-160`，含 `CREATE TABLE ×12` + `CREATE VIRTUAL TABLE ×1` + `CREATE TRIGGER ×5` 的部分定义，实际 counting 含 `IF NOT EXISTS` 幂等）。
- **执行顺序**（`runMigrations: schema.ts:192-204`，单事务内）：

```
db.transaction(() => {
  migrateMessagesFtsTrigram(db)        // v5: unicode61→trigram 检测+重建  (schema.ts:194,170-190)
  for (statement of SCHEMA_STATEMENTS) db.exec(statement) // 幂等建表/触发器  (schema.ts:195-197)
  migrateMembersDeletedColumn(db)      // v3: ALTER ADD deleted             (schema.ts:198,210-215)
  migrateMembersModelColumns(db)       // v6: ALTER ADD model_provider/id/thinking_level (schema.ts:199,221-232)
  migrateTasksReopenedColumn(db)       // v8: ALTER ADD reopened            (schema.ts:200,239-244)
  seed(db)                             // #all + Owner 幂等种子               (schema.ts:201,246-266)
  db.pragma(`user_version = ${SCHEMA_VERSION}`)                           // (schema.ts:202)
})()
```

### 2.2 表与触发器清单（按 `SCHEMA_STATEMENTS` 出现序）

| # | 对象 | 行号 | 关键约束/索引 | 引入版本* |
|---|---|---|---|---|
| 1 | `channels` | `schema.ts:9-16` | `id PK`, `type CHECK(public/private)`, `archived BOOLEAN` | v1 |
| 2 | `channel_members` | `schema.ts:17-22` | `PK(channel_id,member_id)`, `FK→channels/members` | v1 |
| 3 | `members` | `schema.ts:23-37` | `id PK`, `type CHECK(human/agent)`, `role CHECK(owner/member)`, `status CHECK(online/working/error/offline)`, `deleted BOOLEAN DEFAULT 0`, `model_provider/model_id/thinking_level NULL` | v1 + v3 `deleted` + v6 三列 |
| 4 | `messages` | `schema.ts:38-46` | `id PK`, `UNIQUE(target_id,seq)`（freshness 锚点）, `FK author→members`, 不可变 trigger 2 个（见下） | v1 |
| 5 | `tasks` | `schema.ts:47-55` | `id PK`, `message_id UNIQUE FK→messages`, `status CHECK(todo/in_progress/in_review/done/closed)`, `reopened BOOLEAN DEFAULT 0` | v1 + v8 `reopened` |
| 6 | `reminders` | `schema.ts:56-65` | `id PK`, `recurrence/target_id NULL`, `FK author→members`, `status CHECK(scheduled/fired/canceled)` | v1 |
| 7 | `reminder_logs` | `schema.ts:66-72` | `id PK`, `FK reminder→reminders`, `event CHECK(7变体)`, `detail DEFAULT ''` | v4 |
| 8 | `round_logs` | `schema.ts:76-84` | `id PK`, `FK agent→members`, `status CHECK(replied/ignored/silent/anyway/yielded/error/busy-cwd)` | v7 |
| 9 | `reactions` | `schema.ts:85-92` | `id PK`, `UNIQUE(message_id,member_id,emoji)`, `FK→messages/members` | v1 (reactions) |
| 10 | `attachments` | `schema.ts:93-101` | `id PK`, `FK message→messages`, `disk_path TEXT` | v1 |
| 11 | `pinned_messages` | `schema.ts:102-109` | `id PK`, `FK→channels/messages/members`, `"order" INTEGER` | v1 |
| 12 | `consumed_seqs` | `schema.ts:110-115` | `PK(agent_id,target_id)`, `seq DEFAULT 0` | v1 |
| 13 | `channel_mutes` | `schema.ts:119-126` | `PK(channel_id,member_id)`, `mute_from_seq/rowid` 双游标 | v10-ish |
| 14 | `channel_reads` | `schema.ts:129-135` | `PK(member_id,channel_id)`, `read_seq DEFAULT 0` | v11 |
| 15 | `messages_fts` | `schema.ts:138-143` | `VIRTUAL TABLE fts5(content, content='messages', content_rowid='rowid', tokenize='trigram')` | v5 trigram（原 unicode61 迁移） |
| 16 | triggers (×5) | `schema.ts:144-159` | `messages_no_update/no_delete`（ABORT 不可变）+ `messages_fts_insert/update/delete`（FTS 同步） | v1 + v5 重建 |

> *`引入版本`为 `git log --oneline --follow lib/data/schema.ts` 推断：`c98ac32` data 初始 → `9676681` members 生命期 → `cc9d4c8` reminders → `98d64b5` search FTS → `79e3e99` observability `round_logs` → `321b4e3` mute → `02846eb` tasks reopened → `5d387ce` channel_reads v11。`SCHEMA_VERSION` 单调递增，未出现"重编号"或"压缩迁移"。

### 2.3 增量迁移函数（`ALTER` 兼容老库）

| 函数 | 行号 | 守卫 | 行为 |
|---|---|---|---|
| `migrateMessagesFtsTrigram` | `schema.ts:170-190` | `sqlite_master.sql includes("trigram") ? return : drop triggers+table → CREATE trigram → INSERT SELECT 回填` | v5：存量消息回填，触发器先 DROP 再建 |
| `migrateMembersDeletedColumn` | `schema.ts:210-215` | `PRAGMA table_info(members) 不含 deleted → ALTER ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0` | v3 soft-delete |
| `migrateMembersModelColumns` | `schema.ts:221-232` | 同上三列逐一检测 → `ALTER ADD COLUMN model_provider/model_id/thinking_level TEXT` | v6 §3.10 per-agent 模型 |
| `migrateTasksReopenedColumn` | `schema.ts:239-244` | `PRAGMA table_info(tasks) 不含 reopened → ALTER ADD COLUMN reopened INTEGER NOT NULL DEFAULT 0` | v8 重开封锁 |

> 全部迁移为 `IF NOT EXISTS / 列存在检测` 幂等，且在 `db.transaction` 内与 `SCHEMA_STATEMENTS` 同批提交（`schema.ts:193-204`）。无 `DROP COLUMN / RENAME TABLE` 破坏性操作，适合存量 `~/.worksplice/raft.db` 一键升级。

### 2.4 Seed（`schema.ts:246-266`）

- 幂等插入 `channels(#all, public)` + `members(owner, human, owner, online)`（`INSERT OR IGNORE`）。
- 软删成员打扫：`DELETE FROM channel_members WHERE member_id IN (SELECT id FROM members WHERE deleted=1)`（`schema.ts:259-261`，修复幽灵成员 `6adb851`）。
- `#all` 全员自动加入：`INSERT OR IGNORE SELECT id FROM members WHERE deleted=0`。

---

## 3. pi SDK 是否有存储能力可委托 raft 数据（带证据）

### 3.1 结论：无

> **pi SDK 0.83.0 的全部存储能力仅覆盖"LLM 会话树"（`SessionStorage/SessionManager/jsonl`），无通用 raft 数据（channels/tasks/.../FTS5）能力；即使未来推出 `@earendil-works/pi-storage-sqlite-node`（`pi-agent-core/README.md:13` 所述），其定位仍是 session 后端可插拔，而非通用 KV/ORM。**

### 3.2 证据链（文件:行号）

| 断言 | 证据 | 行号 |
|---|---|---|
| pi SDK 无 `raft` 领域模型 | `grep -rn "raft|KV|LevelDB|IndexedDB" node_modules/@earendil-works/pi-agent-core/src` 无命中；`store.ts:20-33` 的 `ChannelRow/MemberRow/TaskRow/...` 等 12 行类型在 SDK dist 全量 `grep` 无对应 | `store.ts:10-33` 类型清单 vs SDK `index.d.ts:1-15` 导出清单 |
| SDK 有的是 `SessionStorage`（LLM 会话）而非通用 DB | `pi-agent-core/dist/harness/types.d.ts:337-362` `SessionStorage<TMetadata>`：仅 `getMetadata/getLeafId/setLeafId/createEntryId/appendEntry/getEntry/findEntries/getLabel/getSessionName/getSessionStats/getPathToRootOrCompaction/getEntries` 11 方法，`SessionTreeEntry` 仅 8 变体（`message/thinking_level_change/model_change/compaction/branch_summary/custom/custom_message/label/session_info`） | `types.d.ts:337-360` + `session-manager.d.ts:10-55` |
| SDK 的持久化是 jsonl 追加树，不是表 | `session-manager.d.ts:60-150` `SessionManager` 类：`appendMessage/appendCompaction/branch/buildContextEntries/buildSessionContext/getTree` 等，仅操作单个 jsonl 文件；`list(cwd)/listAll()` 按 `SessionHeader.cwd` 扫描 `~/.pi/agent/sessions/<encoded-cwd>/` | `session-manager.d.ts:200-350` |
| SDK 的"SQLite"提及仅在 README 的"session 后端可插拔"上下文 | `pi-agent-core/README.md:13` "The SQLite session backend and the `node:sqlite` adapter live in a separate package, `@earendil-works/pi-storage-sqlite-node`, so the core package does not pull in runtime builtins..." —— 且该包未安装（`ls pi-storage* → No such file`） | `README.md:13` + `ls` 空结果 |
| SDK 两个发布包均无 DB 依赖 | `pi-coding-agent/package.json:dependencies` 与 `pi-agent-core/package.json:dependencies` 均不含 `better-sqlite3/sqlite/level/pglite/drizzle/prisma` | `package.json` 全文 |
| raft 的 `UNIQUE(target_id,seq) + trigger 不可变 + FTS5 trigram` 在 SDK 无对应物 | `schema.ts:45` UNIQUE + `schema.ts:144-159` triggers vs SDK `SessionStorage` 无类似约束；SDK 的 FTS 能力为零 | `schema.ts:38-46,144-159` |

### 3.3 边界划分（"pi 管 pi，raft 管 raft"）

```
pi SDK 职责边（可委托，已在 01 研究收敛）        raft 自研边（不可委托，保留在 Store）
─────────────────────────────────────────        ─────────────────────────────────
SessionManager / SessionStorage / jsonl 追加树      Store 57 方法（12 表 + 4 游标 + 2 freshness）
  └─ Agent 轮次、compaction、branch、leafId       channels/members/messages/tasks/reminders/…
SettingsManager / ModelRuntime / ResourceLoader    FTS5 trigram 全文 + LIKE 兜底（sqlite.ts:373）
  └─ model/thinkingLevel/skills/extensions 等      consumed_seqs / channel_mutes / channel_reads
                                                  reactions/attachments/pinned
                                                  UNIQUE(target_id,seq) + immutability
                                                  withTransaction 同步事务
```

> 试图把 raft 塞进 `CustomEntry(data?: unknown)`（`session-manager.d.ts:CustomEntry`）是反模式：`CustomEntry` 按设计不参与 `buildSessionContext`，需自建索引与约束，等价于在 jsonl 上重造 SQLite。

---

## 4. 换库选项评估

> 评估基线：**单机单进程、零外部服务、同步事务 + FTS5 刚需、worksplice 由 `bin/worksplice.js → next start -p 30142` 拉起（`package.json:32-35`），数据在 `~/.worksplice/raft.db` 单文件**。

### 4.1 评估表

| 选项 | 能力覆盖 | 成本 | 收益 | 结论 |
|---|---|---|---|---|
| **A. 现状 `better-sqlite3`（同步）** | ✅ 同步 `db.prepare/get/all/run`（`sqlite.ts:35-980` 全同步）；✅ `WAL + FK`（`sqlite.ts:48-49`）；✅ `FTS5 trigram + 5 triggers`（`schema.ts:138-159`）；✅ `db.transaction` 同步原子性支撑 `maxSeq→appendMessage`（`sqlite.ts:58-61,360-365`）；✅ 零服务、单文件、Node 原生 addon、与 `proper-lockfile` 互补 | 维持成本低（11 版迁移已幂等）；native 构建在部分 CI/ARM 需预编译 | —（基线） | **保留** |
| **B. `drizzle-orm` + `better-sqlite3`（ORM 层）** | ✅ 仍用 `better-sqlite3` 驱动，能力不增不减；❌ FTS5 虚拟表与 triggers 需手写 `sql` 逃逸；❌ 同步事务写法与 drizzle 异步 `await db.transaction` 心智错位；❌ 需引入 `drizzle-kit` 迁移工具与 `schema.ts` 双源 | 新增 1 依赖 + 2 配置文件 + 全部 57 方法重写为 `drizzle` 查询构造器；迁移链需从 `SCHEMA_STATEMENTS` 16 语句转 `drizzle-kit generate`，`migrateMessagesFtsTrigram` 等 4 检测函数需重做 | 类型推导更强，但 `types.ts:17-69` 已有显式 `Row` 接口，增益有限；`Store` 契约本身已是类型边界 | **不选**——以重写成本换微弱类型增益，且引入"ORM vs 原生 SQL"双心智 |
| **C. `postgres`（`pg` / `postgres.js` / `drizzle-pg`）** | ❌ 需外部 `postgres` 服务（`worksplice` 单机零依赖承诺破裂，`package.json:32` `next start` 单进程模型不含 sidecar）；❌ `~/.worksplice` 单文件便携性丧失；❌ `FTS5 trigram` → `pg_trgm/gin` 方言重写；❌ `better-sqlite3` 同步 API → pg 异步 `await`，`withTransaction` 与 `maxSeq` freshness 语义需重做并发模型 | 部署成本跃升（用户需自建/托管 PG）；备份/迁移需 `pg_dump` 而非单文件拷贝；测试需 `docker`/`testcontainers` | 多写并发/复制/行级锁等能力在单进程 `withTransaction` 串行模型下无收益；数据量级（`npm test` 343 用例，全量消息通常 <1e5 行）无需 PG 扩展性 | **不选**——收益为零，成本破坏"零依赖单机"产品约束 |
| **D. `pglite`（WASM PG）** | △ 嵌入式 PG 但仍为 PG 方言（FTS 重写）；△ `pglite` 同步 API 有限，需 async；△ 包体积 ~30MB WASM，启动延迟 | 引入 WASM 运行时与 PG 方言适配，16 语句 + 5 triggers 需重写 | 单文件嵌入（贴近现状），但相较 `better-sqlite3` 无优势 | **不选**——为"换方言而换"，无功能增益 |
| **E. `prisma`（`better-sqlite3` 驱动）** | △ 仍用 SQLite 但由 Prisma 管理 schema/迁移；❌ FTS5 虚拟表与 triggers 在 Prisma schema 中为 unsupported（需 `@@ignore` + 原生 SQL 逃逸）；❌ `prisma generate` 额外构建步；❌ `Store` 57 方法 → `PrismaClient` 模型 API 重写 | 新增 `prisma/schema.prisma` + `prisma/migrations` 目录，11 版迁移需转 Prisma 迁移链（且 `PRAGMA table_info` 检测逻辑需保留） | 类型与 DX 提升，但 `Store` 已是强类型契约（`types.ts` 显式 Row），增益有限 | **不选**——同 B 的 ORM 成本，且对 FTS/triggers 支持更差 |
| **F. `node:sqlite`（Node 22.5+ built-in `DatabaseSync`）** | ✅ 能力对等（WAL/FTS5/triggers 均支持）；△ 同步 API 形态与 `better-sqlite3` 略异（`prepare` 返回类型、备份 API 差异） | 需改 `sqlite.ts:2,47-49` 3 处 import/pragma，57 方法的 `Database.Database` 类型替换；Node 22.19 约束已满足（`package.json:15 eng: node >=22.19.0`），无需 polyfill；但 `better-sqlite3` 生态（`@types/better-sqlite3`、`backup` 等）需验证等价 | 移除 native addon 编译依赖，CI 更稳；但 `better-sqlite3 13.0.2` 在 Node 22 已稳定，未现构建痛点 | **可选未来演进**（06/08 不决策）：若未来出现 native 构建痛点，可在 `Store` 契约不变前提下替换 `SQLiteAdapter` 内部驱动，作为纯 adapter 替换，不动 `store.ts/types.ts/schema.ts/db-singleton.ts` 任何契约 |
| **G. 委托 pi 的 `SessionStorage` / 独立 `@earendil-works/pi-storage-sqlite-node`** | ❌ 见 §3 证据链，SDK 无 raft 表能力；`pi-storage-sqlite-node` 即使可用，其接口仍是 `SessionStorage<TMetadata>`（会话树），非通用表 | 需在 `CustomEntry` 上重造 12 表 + FTS + 事务 + 游标，成本等同自研 | 零 | **不选** |

> 评估所引 `package.json:15` 的 `node >=22.19.0` 已具备 `node:sqlite`，但迁移收益仅为"去 native addon"，在 `better-sqlite3 13.0.2` 尚未暴露痛点时不值得在重构窗口引入额外风险。

### 4.2 量化对比（单机约束下的加权打分，仅供直观）

| 维度权重 | 同步事务 | FTS5 | 零部署 | 单文件便携 | 迁移链复用 | 类型收益 | 综合 |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| better-sqlite3 | 5 | 5 | 5 | 5 | 5 | 3 | **4.7** |
| drizzle-sqlite | 3 | 2 | 5 | 5 | 2 | 5 | 3.3 |
| postgres | 2 | 3 | 1 | 1 | 1 | 4 | 1.8 |
| node:sqlite | 5 | 5 | 5 | 5 | 5 | 3 | 4.7 (平) |

> 打分仅示意；决策不以分数定，以"是否破坏单机零依赖 + 是否需重写 FTS/trigger/事务"定。

---

## 5. 选型建议与对兼容迁移的影响

### 5.1 明确建议：保留并收敛（Retain & Narrow）

**一句话**：`保留 better-sqlite3 + Store 契约 + SCHEMA_VERSION 11 链，零委托 pi 存储，零换库；Store 契约适度内收，适配层保留替换自由`。

**三条理由**（按重要度）：

1. **正确性锚点不可移**：`UNIQUE(target_id,seq)`（`schema.ts:45`）+ 不可变 triggers（`schema.ts:144-149`）+ `withTransaction` 同步原子性（`sqlite.ts:58-61`）是 freshness-hold（`messages.ts:111-119`）与 `consumed_seqs` 游标（`rounds.ts`/`inbox.ts`）的正确性前提；换异步驱动将重做并发模型，风险与收益不对称。

2. **FTS5 trigram 是 SQLite 独占能力**：`messages_fts USING fts5(tokenize='trigram')`（`schema.ts:138-143`）+ `trigram↔unicode61 迁移`（`schema.ts:170-190`）+ `searchMessages` 双路径（`sqlite.ts:373-405`，`tokens.every(len>=3) → MATCH else LIKE ESCAPE`）在 PG/Prisma/Drizzle 中均需手写逃逸或重做分词，重写成本 > 保留成本。

3. **Store 契约是唯一经过 11 版迁移验证的数据边界**：`docs/engineering-standards.md:15` 明确"业务模块经 `getDb(): Store` 取实例，不写 SQL、不 import 具体 adapter"，15 个 raft 子模块（`index.ts:18-34`）已收敛到此面；换库或委托 pi 将导致 15 模块回归。

### 5.2 保留什么（Keep）

| 保留项 | 文件:行号 | 保留形态 |
|---|---|---|
| `Store` 契约接口 | `store.ts:35-242` | 保留，见 §5.3 收敛建议 |
| `SQLiteAdapter` 同步实现 | `sqlite.ts:35-980` | 保留；`withTransaction/maxSeq/maxMessageRowid` 等原语不动 |
| `SCHEMA_VERSION 11` + 16 语句 + 5 triggers + seed | `schema.ts:3-266` | 保留，增量 only，见 §5.4 |
| 4 增量迁移函数 | `schema.ts:170-244` | 保留，`PRAGMA table_info` 检测幂等不动 |
| `getDb(): Store` 单例 + 热重载守卫 | `db-singleton.ts:17-24` | 保留；`__workspliceDbOpenedVersion !== SCHEMA_VERSION` 重建逻辑保留 |
| `DataPaths/ensureDataDir/agentHomeDir` | `dirs.ts:1-57` | 保留；`~/.worksplice` + `attachments/agents` 子目录不纳入 DB 迁移 |
| 行类型与 `toFtsQuery/buildSearchSnippet` 纯函数 | `types.ts:1-229` | 保留；`types.ts` 不依赖 adapter，纯类型面 |
| `better-sqlite3 13.0.2` 依赖 | `package.json:46` | 保留；未来可无痛换 `node:sqlite`（见 §4.1 F） |

### 5.3 收敛什么（Narrow，Store 契约的"收窄/扩张"建议，供 06 决策）

> 目标：Store 从"58 方法平铺"收为"每域一聚合 + 事务原语"，为 `lib/data` 深模块化铺路；不改表结构，仅调接口形状。

| 建议 | 现状 | 目标形态 | 影响 |
|---|---|---|---|
| **N1：`withTransaction` 与 `maxSeq/maxMessageRowid` 保留为"事务原语"** | `store.ts:42,46,238` 3 原语 | 保留；06 中明确为 `StoreTx` 子面（`withTransaction` 回调内可用的 freshness/mute 原语），避免业务层零散 `maxSeq` 误用 | 无破坏；仅文档与类型分组 |
| **N2：`searchMessages` 保留，其纯函数已在 `types.ts`** | `store.ts:74` + `types.ts:171-228` | 保留；06 中考虑将 `toFtsQuery/buildSearchSnippet/escapeLike` 明确为 `lib/data/search-helpers.ts`（或保留在 `types.ts`），`SQLiteAdapter.searchMessages` 仅组装 SQL | 无破坏 |
| **N3：`hasMessage/hasMessageByContentByOther` 合并** | `store.ts:78-79` 两方法仅差 `author_id != ?` | 06 可合并为 `hasMessage(targetId, authorId, content, { excludeSelf?: boolean })` 或保留双方法但抽私有 `existsByContent`；不强求改，仅去重实现（`sqlite.ts:877-897` 已有 2 段近重复 SQL） | 兼容：保留旧签名为 alias |
| **N4：`updateTask/updateReminder/setMemberModel` 的"全字段可选"保留** | `store.ts:133-136,154-163,104-111` | 保留；此类"补丁式更新"是 raft 状态机（`lib/domain/raft/tasks.ts`）的刚需，不收为"单字段 setter"以免状态机写 3 次 | 无破坏 |
| **N5：`DataPaths` 不并入 `Store`** | `store.ts:37 paths: DataPaths` | **保留 `paths` 在 `Store` 上**（06 不移出）：`paths.attachmentsDir/agentsDir` 被 `attachments.ts` 与 `members.ts` 强依赖，移出会导致业务层需 `import { getDataPaths }` 双源 | 无破坏 |
| **N6：不扩张 Store** | — | **不为"去 better-sqlite3 依赖"而新增抽象**（如 `queryBuilder/fork` 等）；`Store` 保持"按业务域命名的方法"，而非"通用 SQL 构造器"——过度抽象会把 11 版迁移的 SQL 语义泄露给业务层 | 无破坏 |
| **N7：`InMemoryAdapter` 仍为"预留"** | `store.ts:5` 注释"或预留的内存后盾" | 06 中 **不实现** `InMemoryAdapter`，保留注释；测试侧已用 `openDataDb(mkdtemp)` 临时文件模拟内存（`docs/engineering-standards.md:30-35`），无需内存 adapter | 无破坏 |

> 06 的深模块切分若採"每域一深模块"（`lib/domain/raft/*` 已是），`lib/data` 可保留为单 `store.ts/types.ts/sqlite.ts/schema.ts/db-singleton.ts/dirs.ts` 5 文件扁平，不拆 `lib/data/channels/store` 子包——`Store` 已是按域分组的"窄总线"。

### 5.4 对 SCHEMA 兼容与迁移链的影响（供 08 决策）

| 影响面 | 在"保留并收敛"下的策略 | 证据/约束 |
|---|---|---|
| **SCHEMA_VERSION 递增纪律** | 保留。`SCHEMA_VERSION 11` 不重置、不压缩；后续新增表/列一律 `SCHEMA_VERSION += 1` + `ALTER ADD COLUMN / CREATE TABLE IF NOT EXISTS` 幂等迁移，保持 `user_version` 单调 | `schema.ts:3,202` 已约束 11 版增量；压缩迁移将破坏存量 `~/.worksplice/raft.db` 一键升级 |
| **存量 `~/.worksplice/raft.db` 兼容** | 保留。`runMigrations` 的 4 检测函数（`PRAGMA table_info`）保证从任意历史版本（v1..v11）一键升级到 11；08 迁移分期不得要求用户 `rm raft.db` | `schema.ts:192-204` 事务内全量执行；`6adb851` 幽灵成员修复等均为幂等 |
| **热重载守卫** | 保留。`db-singleton.ts:19-20` `__workspliceDbOpenedVersion !== SCHEMA_VERSION` 重建，避免 HMR 后 `SQLiteAdapter` 原型漂移 | `db-singleton.ts:17-24` + `sqlite.ts:987-990` 双写版本戳 |
| **迁移分期（08 的"分几期、每期哪些表"）** | 08 可按"新增表"分期落地，但 **不拆 `runMigrations` 的执行分期**——每次启动仍全量跑完 16 语句 + 4 检测 + seed + `user_version`，分期仅是 spec/实现排期，不对应"部分迁移"的运行时形态 | `schema.ts:192-204` 单事务，拆事务将引入半迁移风险 |
| **回滚点** | 单文件回滚：`~/.worksplice/raft.db` + `~/.worksplice/attachments/` + `~/.worksplice/agents/` 三件套文件拷贝即回滚；`user_version` 降级不自动（`runMigrations` 不做降级迁移），回滚后以文件覆盖为准 | `dirs.ts:22-29` 三路径；`schema.ts` 无 `down` 迁移 |
| **附件与家目录是否纳入 DB 迁移** | 不纳入。`attachments/`（随机文件名落盘）与 `agents/<slug>-<id8>/MEMORY.md` 为文件面（`dirs.ts:34-36`），与 `raft.db` 表无外键级联（`attachments.disk_path` 仅为路径字符串）；迁移脚本不触文件，08 的"纳入范围"指备份/回滚清单而非 `runMigrations` | `schema.ts:93-101` attachments 表仅存 `disk_path`；`dirs.ts:54-56` MEMORY 模板 |
| **若 08 考虑"换库"分期** | 不建议分期换库：换库意味着 `SCHEMA_STATEMENTS` 16 语句 + 5 triggers + FTS5 虚拟表 + 4 检测函数的全量重写 + `withTransaction` 异步化，影响 57 方法 + 15 raft 模块；必须一次性全量验证（`npm test` 343 用例 + `lib/domain/raft/*.test.mjs` 全量） | 本研究的"不换库"结论即为 08 的前置输入 |
| **`pi_session_file` 与 `~/.pi/agent/sessions/*.jsonl` 兼容** | 与数据层选型正交。`members.pi_session_file` 仅为 `TEXT NULL` 列（`schema.ts:30`），其指向的 jsonl 文件由 pi SDK `SessionManager`（`session-manager.d.ts:300-350`）管理，重构不改其格式（`.scratch/pi-sdk-rebuild/map.md:41` "pi session 文件格式改动—不碰"） | `store.ts:93 piSessionFile?: string\|null` + `map.md:41` |

### 5.5 对 06（目标架构深模块切分）的直接输入

- **06 的模块清单可直接复用现状 `lib/data` 5 文件**：`store.ts（契约）/ types.ts（行类型+纯函数）/ sqlite.ts（SQLiteAdapter）/ schema.ts（SCHEMA_VERSION 11）/ db-singleton.ts（单例+版本守卫）/ dirs.ts（路径）`——无需为"换库预留"而增 `lib/data/adapter/` 子包。
- **深模块边界**：`lib/data` 的 entry point 为 `lib/data/db-singleton.ts:17 getDb(): Store`（唯一对外面）+ `lib/data/store.ts:35 Store`（类型面）；`lib/domain/raft/index.ts:1-35` 的"唯一对外导入面"纪律与此正交（`lib/domain/raft/*` 消费 `getDb()`，不反向依赖 `lib/data/sqlite.ts` 具体 adapter）。
- **测试 seam 保留**：`globalThis.__workspliceDb = openDataDb(tmpMkdtemp)` 临时文件直连（`db-singleton.ts:22` + `engineering-standards.md:40`）继续作为 06 的 `lib/domain/raft/*.test.mjs` 唯一 DB 替身，无需 `InMemoryAdapter`。

### 5.6 对 08（向后兼容与数据迁移策略）的直接输入

- **08 的兼容承诺**：`~/.worksplice/raft.db` SCHEMA_VERSION 11 存量一键升级到重构后版本（`SCHEMA_VERSION 12+` 增量），**无 `rm raft.db` 要求**；09（spec 定型）与迁移计划颗粒度以此为不变量。
- **08 的迁移脚本形态**：沿用 `schema.ts:192-204` 单事务 + `PRAGMA table_info` 列存在检测 + `CREATE TABLE/VIRTUAL TABLE/TRIGGER IF NOT EXISTS` 幂等，不引入 `drizzle-kit/prisma migrate` 新工具链。
- **08 的分期建议**：分期以"新增域"（如未来新增 `channel_reads` 类游标表）为单位，而非以"迁移链分段执行"为单位；每期仍全量跑 `runMigrations`，分期仅为 spec 章节与回归粒度。
- **08 的回滚与备份**：备份清单 = `raft.db` 单文件 + `attachments/` 目录 + `agents/` 家目录（`dirs.ts:22-29` 三路径）；`~/.pi/agent/sessions/*.jsonl` 不在 raft 备份清单内（归 SDK 侧）。

---

## 6. 风险与未决（供 06/08 grilling 带入）

| 风险 | 描述 | 缓解 | 归属票 |
|---|---|---|---|
| `better-sqlite3` native 构建在 CI/ARM 的偶发失败 | 当前 `13.0.2` 在 Node 22.19 稳定，但跨平台预编译非零风险 | 保留 `node:sqlite` 作为 adapter 内部替换预案（`sqlite.ts` 3 处改动即可），`Store` 契约不动 | 06（深模块切分时预留 `SQLiteAdapter` 内部驱动可替换） |
| `Store` 57 方法平铺导致"总线过宽" | 06 可能以"宽总线"为由主张拆 `ChannelStore/TaskStore/...` | 本研究建议 **不拆**：`Store` 已按域分组且 `lib/domain/raft/index.ts` 汇合，拆为 7 个 Store 将导致 `getDb(): Store` 变 `getChannelStore()+getTaskStore()...` 7 单例，复杂度上升 | 06 grilling |
| FTS5 trigram 的中文分词召回 | `trigram` 按 3-gram 索引，中英文子串均可命中但非语义分词；`searchMessages` 短 token 走 `LIKE` 兜底（`sqlite.ts:398-404`） | 保留；若 07/08 提出语义搜索，再评估 `sqlite-vec` 等扩展，不在数据层选型内解决 | 07/08 |
| `consumed_seqs/channel_mutes/channel_reads` 三游标的一致性 | driver 的 `ack` 与 `drain` 均走 `withTransaction`，但业务层误用 `setConsumedSeq` 可能推进过期 | 保留 `withTransaction` 原语，06 中明确"游标仅由 inbox/wake 域操作"纪律 | 06 |

---

## 7. 参考（便于复核）

- `SCHEMA_VERSION` 演进：`git log --oneline --follow -- lib/data/schema.ts`（`c98ac32`→`4517100`→`9676681`→`cc9d4c8`→`98d64b5`→`79e3e99`→`321b4e3`→`02846eb`→`5d387ce` 共 9 次语义提交，`SCHEMA_VERSION` 从 1 到 11 单调）
- `Store` 契约行数：`wc -l lib/data/store.ts` 242；方法数：`grep "^\s*[a-z].*(" lib/data/store.ts | wc -l` 57
- `SQLiteAdapter` 行数：`wc -l lib/data/sqlite.ts` 994；`better-sqlite3` 依赖：`package.json:46 13.0.2`
- 工程纪律：`docs/engineering-standards.md:15-16` "业务模块经 `getDb(): Store` 取实例，不写 SQL、不 import 具体 adapter"
- 中层收敛原则：`.scratch/pi-sdk-rebuild/map.md:12` "pi 管 pi，raft 管 raft —— `lib/rpc` 的薄 Wrapper 形态与 `agent-loop` 的自研驱动耦合是本次重构的主战场；tools/extensions/skills/model/session 尽可能委托 SDK"
