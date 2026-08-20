# 目标架构的分层与深模块切分

**背景**：`lib/rpc 1479`/`agent-loop 1442`/`raft 2626`/`data 1813` 行四域分散、76 路由薄封装 4968 行（`03 E01-E69` 库存量扫描），`pi 管 pi、raft 管 raft` 切分线（ADR-0007）与 `lib/cwd-mutex` 抽取（ADR-0005）已立，但全域的依赖方向、深模块 entry point、子模块直引纪律与 `Store` 宽总线/`getDb()` 单例的去留仍未冻结，需一张目标架构图与模块清单为 `spec-rebuild.md §5` 定骨架（ticket 06，1 轮 grilling 6 问全 A）。

**决策（ticket 06）**：
- **分层与依赖方向固化（单向）**：`lib/data (Store + SQLiteAdapter + schema + db-singleton)` ← `lib/domain/raft (唯一导入面)` ← `lib/rpc + lib/agent-loop + lib/cwd-mutex + lib/model-scope` ← `app/api (薄封装)`，`app/api` 禁止直引 `lib/data`，`lib/domain/raft` 子模块间直引不经索引回环；`getDb(): Store` 单例 + `__workspliceDbOpenedVersion !== SCHEMA_VERSION` 热重载守卫保留（`lib/data/db-singleton.ts:17-24`），测试经 `globalThis.__workspliceDb = openDataDb(tmp)` 直连覆盖。
- **Store 宽总线保留、不拆窄接口**：`lib/data/store.ts` 57 方法 13 分组单体保留（ADR-0006 `Store 57 宽总线暂不拆分` 延续），收敛仅体现在 spec 模块清单按分组罗列与命名收敛，不改接口形状；后续若需隔离另立子面，不进本次重构。
- **lib/domain/raft 唯一导入面**：`lib/domain/raft/index.ts` `export *` 单口为 raft 域唯一对外导入面，`app/api/*` 与 `lib/agent-loop` 只 `from "@/lib/domain/raft"` 单条 import，域内子模块（channels/members/messages/tasks/inbox/wake/reactions/pinned…）互相经相对路径直引，测试缝 `mock 整个 raft 域` 保留（`lib/domain/raft/index.ts` 唯一 seam）。
- **lib/rpc 四件套冻结**：`session.ts`（薄 Wrapper，仅 `promptRunning` + 薄订阅）+ `registry.ts`（per-member `__workspliceSessions` 记账，不按 cwd 猜归属）+ `caller.ts`（`createAgentSessionServices→resolveVisibleModels→createAgentSessionFromServices` 二段式）+ `events.ts`（`subscriber+broadcaster` 合并窄面）；`withCwdStartLock/trackStarting` 已迁至 `lib/cwd-mutex.ts`，`lib/rpc/index.ts` 11 导出保持，`SessionManager.listAll` 不替代 registry（SDK 无 BusyCwd）。
- **lib/cwd-mutex独立深模块**：`lib/cwd-mutex.ts` 窄接口 `withCwdMutex(cwd, fn) + isCwdBusy(cwd) + findBusySession(cwd)`（`realpathSync` 归一 + `Map<realpath,count>` + `waitForSettle(SETTLE_EVENTS)` + `BUSY_CWD_RETRY_DELAY_MS=250`）为 `lib/agent-runtime` 与 `lib/agent-loop/driver` 共用唯一串行事实来源。
- **lib/agent-loop 单文件深模块保留**：`lib/agent-loop/loop.ts` 内聚 round+driver+backfill+cron 四段（~1442 行），`lib/agent-loop/index.ts` 仅 re-export `createAgentLoop` 窄出口，不拆 `driver.ts/backfill.ts/cron.ts` 子文件；`globalThis.__workspliceWakeListeners` 热重载守卫与 `MUST_RESPOND_CAP=2` / error-silent 分级（ADR-0005）同此纪律保留。
- **lib/model-scope thin adapter 定位**：`lib/model-scope.ts:71` 委托 `resolveModelScopeWithDiagnostics` 的 10 行薄委托 + `selectInitialModelScope` 本地规则 + `models-cache.ts` per-cwd 缓存，作为 `lib/rpc/caller.ts` 下游，不升为独立域。
- **`tool-presets` 去硬编码保留**：`PRESET_NONE/DEFAULT/FULL` 保留为 UX 快捷，`BUILTIN_TOOL_NAMES` 改由 `getAllTools()` 动态推导（ADR-0007），`allowedToolNames` 由 `caller.ts toolsOption` 注入（`[]`=全禁、`undefined`=不过滤）。

**Consequences**：
- `spec-rebuild.md §5` 可直接引用本 ADR 的 Mermaid 图与模块清单（见 ticket 06 Answer 资产），`06 → 09` 解锁 `spec 形态` 终票仅剩形态与颗粒度决策，不再回溯分层。
- 深模块切分零 schema 影响（`SCHEMA_VERSION 12` 仅 `round_logs` 三列增量，ADR-0006），后续分步 ticket 按深模块维度切分（`lib/cwd-mutex` → `lib/rpc` → `lib/agent-loop` 重塑 → UI B 首版），每步验收 `tsc --noEmit + lint + npm test` 不引入 DI 容器或窄接口拆分。
- 术语 **深模块 / 唯一导入面** 已落 `CONTEXT.md`，`docs/engineering-standards.md` 的导入纪律可直接引用。

**Status**: accepted
