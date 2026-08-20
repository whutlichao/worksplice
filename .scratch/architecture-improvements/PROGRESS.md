# Architecture Deepening — 进度交接（2026-08-14）

> 跨会话交接文档：新会话从本文件 + `SPEC.md` + `issues/` 起步即可继续。

## 当前状态

**Ticket 01「Split RPC Manager」已完成并提交 ✅**

- 提交：`df985ca`（main 分支，33 文件，+2149/−40）
- 内容：`lib/rpc-manager.ts`（1,307 行）拆为 `lib/rpc/` 五文件 + index 出口：
  - `session.ts` — AgentSessionWrapper（原样搬移）
  - `registry.ts` — RpcRegistry（注册表 + busy-cwd + starting 窗口 + destroyForCwd）
  - `caller.ts` — RpcCaller（start = startRpcSession + call 薄封装）
  - `subscriber.ts` — RpcSubscriber（running 订阅集合）
  - `broadcaster.ts` — RpcBroadcaster（快照去重广播 + getRunningIds）
  - `index.ts` — 公共 API 面 = 原 11 导出 + 4 个模块类
- 测试：5 个 per-module 测试文件（32 例）+ index 完整性守卫；旧 210 行测试全迁移不丢
- 文档：AGENTS.md / README / README.zh-CN / docs/spec / spec-bootstrap-agent / engineering-standards 全同步
- 验证：tsc ✓、lint 0 error ✓、全量 675 测试 ✓
- 遗留收尾：`a0f2080` 补删被 lib/rpc/ 取代的 rpc-manager 三文件

**Ticket 02「Collapse Agent-Loop Orchestration」已完成并提交 ✅**

- 提交：`db6fa59`（main 分支，22 文件，+632/−607）
- 内容：`lib/agent-loop/` 五文件（loop 871 + wake/driver/backfill/reminder-cron）→ 单文件深模块：
  - `loop.ts`（~1430 行）收编 round + driver + backfill + reminder-cron 全部编排
  - 公共接口 `createAgentLoop()` → `{ start, stop, tick }`（start 幂等组装状态扫掠 + 补拉 + 驱动 + cron；tick = 手动推进 cron 扫描）
  - `index.ts` 只 re-export 公共面；内部函数保留为测试面（既有 600 行单测直接导入 ./loop.ts）
  - **wake 下沉**：`lib/raft/wake.ts`（新）承接 WakeHint/subscribeWake/emitWake/notifyMessageWakes——
    raft 服务层（messages/reminders/event-messages）发、agent-loop 驱动订阅，依赖方向反转
    （raft ← agent-loop，消除 raft → agent-loop 反向依赖；偏离 ticket 字面"merged into loop"，
    属有意的架构决策，Spec review 认可）
  - instrumentation 改用 `createAgentLoop().start()`；4 个卫星文件删除
- 测试：全部迁移（driver/backfill/reminder-cron/wake 测试改导入路径，inbox-route 断言改窄面），343 官方脚本 ✓、全量 702 ✓
- 双轴 code-review：Standards 1 硬-ish（AGENTS.md"保留首个 reason"措辞与代码 upgrade 语义不符——已修）+ 2 判断项（textFromContent 去重已修；Data Clumps 留待后续）；Spec 验收标准全达成（loop.ts 导出面宽 = 有意测试面，已文档化）

**Ticket 04「Extract Raft Domain」已完成并提交 ✅**（2026-08-14 收尾）

- 提交：`d7b70e9`（main 分支，106 文件）+ 配套 flake 修复 `5225b43`（独立提交）
- 内容：`lib/raft/`（18 子模块 + 测试，~2,525 行）整体迁移为 `lib/domain/raft/` 单索引模块：
  - `index.ts` = raft 域唯一导入面（`export *` 汇合全部子模块；`getDb(): Store` 不在此面，归 `lib/data/db-singleton.ts`——db-singleton 从 lib/raft/ 迁入 lib/data/）
  - 消费方收敛 7→1：31 个 app/api route + instrumentation.ts + components/SearchView.tsx（`@/lib/domain/raft`）+ lib/agent-loop/loop.ts（一条 `../domain/raft/index.ts`）+ agent-runtime/status/lifecycle/session-stats（榜外断链一并修复）
  - 子模块内部相对导入按新深度修正（`../../data`、`../../preview`、`../../mention`）；测试文件相对导入与 9 个 route 测试的 `readRoute` 深度同步修正
  - **seam 守卫测试** `index.test.mjs`（3 用例）：18 子模块 export* 覆盖 + 运行时同绑定 + getDb 不在面（Spec AC5/AC7 举证）
- 验证：tsc ✓、lint 0 error ✓、346/346 测试 ✓
- 双轴 code-review：**approve（0 hard violation）**；两条非阻塞整改已落地（AC5 seam 守卫测试 + engineering-standards.md 分层契约句「index.ts 唯一导入面 / getDb 归 lib/data/db-singleton.ts」）
- **配套 flake 修复**（`5225b43`，独立提交）：既有已知 flaky `observability.test.mjs` updated_at 同毫秒排序无 tiebreaker → 根因在 `lib/data/sqlite.ts` `listTasksForAgent`（`ORDER BY updated_at DESC` 无次键）→ 加 `tasks.rowid DESC`；新增确定性复现用例（`updateTask` 强行同 updated_at）。TDD red→green 全程，全量 347/347，单独连跑 5 次稳定
- 文档：AGENTS.md File Map（raft 段重写 + data 段补 db-singleton）/ engineering-standards.md / spec.md / package.json test glob 全同步
- ⚠️ 提交注意：`.scratch/` **不在 .gitignore**（只是从未 add 的惯例存档）——提交必须精确 `git add` 路径，严禁 `git add -A`（会把 .scratch 入库）

**Ticket 03「Separate Data Layer」已完成并提交 ✅**（**范围收窄**：仅 Store 接口 + SQLiteAdapter，InMemoryAdapter 暂缓）

- **范围决定**：SPEC 要求的 `InMemoryAdapter`（"Tests pass with either adapter"）需忠实复刻事务回滚/外键/UNIQUE/消息不可变/FTS5 trigram/rowid/JOIN/upsert 等全部 SQL 行为，等于重写微型关系引擎，且风险"内存语义与 SQLite 悄悄分叉破坏测试基准"。**经与用户确认：本次只做 Store 契约 + SQLiteAdapter**；InMemoryAdapter 待后续单独评估。
- 内容（工作区，未提交）：
  - `lib/data/store.ts`（新）：`Store` 接口——数据契约，业务模块只依赖它
  - `lib/data/types.ts`（新）：raft 共享类型（行/输入/枚举）+ 搜索纯函数（toFtsQuery/buildSearchSnippet/escapeHtml/escapeLike）
  - `lib/data/db.ts` → `sqlite.ts`：`RaftStore` 改名 `SQLiteAdapter implements Store` + 工厂（`openSqliteAdapter` 别名旧名 `openDataDb`）
  - `db-singleton.ts`：`getDb(): Store`（原 `RaftStore`）；`__workspliceDb` 全局类型改 `Store`
  - 消费方：lib/raft/*、lib/agent-loop、lib/agent-{runtime,status,lifecycle}、lib/{mention,session-stats}、components/*（tsx）、app/api/tasks routes 全部类型 import `data/db` → `data/types`
  - 测试：25 个 `.test.mjs` 的 `openDataDb` import 路径 `data/db.ts` → `data/sqlite.ts`
- 验证：tsc ✓、lint 0 error ✓、全量 629 测试 ✓
- 文档：AGENTS.md（file-map `lib/data/` + raft 服务层/版本守卫两处措辞）已同步
- 双轴 code-review：**Spec PASS**（纯重构，82 members 接口↔类零缺失零多余，`db.ts` 删除、业务零残留引用）。**Standards** 1 硬项（`docs/engineering-standards.md` §1 分层仍指 `lib/data/db.ts`——已改指 `Store` 契约）+ 2 判断项（`openDataDb` 别名混淆风险——保留、记遗留跟随清理；死类型 `ConsumedSeqRow`——已删）+ 1 注释（store.ts 引用已删 `data/db` 路径——已改）
- 待办：提交

## 遗留注意

- `abandoned-rpc-split/`：上次失败尝试的存档（含 review-01-rpc-split.md 整改清单），**不要**复活其拆分方案（偏离 Ticket 命名、截断、死代码）
- 改了 agent-loop 深模块后 dev server 需**重启**才生效（AGENTS.md 热重载陷阱——loop.ts 内 driver/wake/backfill/cron 段全被 globalThis 闭包引用）
- `.scratch/` 未跟踪、不进 git，是本目录的跨会话存档惯例
- 已知 flaky（**已修，`5225b43`**）：`observability.test.mjs`「listAgentTasks sorts by updated_at descending」——同步 SQLite 下两任务同毫秒 updated_at 排序无 tiebreaker，偶发失败；已按预演修法在 `listTasksForAgent` 排序加 `tasks.rowid DESC` 兜底次键 + 确定性复现用例（详见 Ticket 04 记录）
- **Ticket 03 遗留**：InMemoryAdapter 未做（见上）；`openDataDb` 是 `openSqliteAdapter` 别名（测试沿用旧标识符，可后续统一改名清理）

## 下一步（按 SPEC.md 依赖图，均已解锁）

| Ticket | 内容 | 依赖 | 说明 |
|---|---|---|---|
| **04** | Extract Raft Domain：`lib/raft/`（7 模块 ~2,525 行）→ 单索引模块 | 依赖 03（已完成） | 消费方 7 imports → 1；此时可顺带把 `lib/raft/` 的服务层与 `getDb(): Store` 收紧

## 新会话接续方式

1. 读 `.scratch/architecture-improvements/SPEC.md` + `issues/02-collapse-agent-loop.md`（或 03）
2. 按 Matt Pocock 流程：implement（user-invoked）→ tdd 接缝确认 → 每步 tsc + 单测 → 全量测试 → code-review → 提交
3. 教训清单（review-01-rpc-split.md）：命名按 Ticket、不删测试、无死代码、每步验证、文档同步
