# 03-现状盘点与库存量扫描

Type: task
Status: resolved
Blocked by:

## Question

执行现状盘点的手工/半自动扫描，为重构 spec 提供「从哪出发」的事实基线（不做决策，只出清单与度量）。

- 产出 `lib/` 域清单：`lib/rpc`、`lib/agent-loop`、`lib/domain/raft`、`lib/data`、`lib/agent-runtime`、`lib/agent-status` 等的模块职责、对外导入面、隐式依赖（globalThis 闭包、热重载陷阱点）
- 产出 `app/api` 路由薄封装清单与 `components/` 三栏骨架（AppShell/WorkspaceSidebar/ChannelView/ThreadPanel/AgentDetailPanel 等）的呈现概念数统计
- 产出数据基线：`SCHEMA_VERSION` 11 全表/列/索引/触发器清单、seed 数据、FTS5 配置、Store 接口方法数
- 产出测试与工程基线：`npm test` 基线 343 用例分布、typecheck/lint 门禁、`docs/cost-monitoring-baseline.md` 的 token/成本口径
- 结果写入 `.scratch/pi-sdk-rebuild/research/03-current-state-inventory.md`（表格 + 文件:行号索引），后续 ticket 直接引用行号而非重述盘点

## Answer

详见 findings：[research/03-current-state-inventory.md](../research/03-current-state-inventory.md)

要点（2026-08-20 基线，`SCHEMA_VERSION 11`，`npm test` 347 用例全绿）：
- **lib 域**：`lib/rpc` 6 文件 1479 行（3 处 `globalThis` 热重载守卫、fork 自毁、realpath 判等）、`lib/agent-loop` 深模块 1442 行（round/driver/backfill/cron 四段 + 3 热重载陷阱改后必重启）、`lib/domain/raft` 唯一导入面 `index.ts:1` 汇 17 子域 2626 行、`lib/data` 6 文件 1813 行（Store 57 方法 + `SCHEMA_VERSION 11` 14 表 + FTS5 trigram）、编排层 `agent-runtime 383`/`agent-status 104`/`lifecycle 134`/`session-reader 350` 等；库存表覆盖职责/导入面/行数/陷阱/证据 `E01-E69`
- **app/api 与 components**：`app/api` 76 路由 4968 行薄封装（raft 33 路由逐行错误码 409 held/conflict/blocked、400/404 映射）、`components` 三栏 `ChannelView` 3117 行为单组件 11 概念承载核心（07 重做主战场），`AppShell 392`/`WorkspaceSidebar 486`/`ThreadPanel 435`/`AgentDetailPanel 1025`
- **数据基线**：`SCHEMA_VERSION 11` 14 表（含 `channel_mutes`/`channel_reads`/`round_logs`）+ FTS5 trigram + 5 触发器 + 4 迁移函数 + seed（`#all`+Owner）；Store 57 方法按 13 分组表；`toFtsQuery`/`buildSearchSnippet` 纯函数
- **测试与工程**：`npm test` 347 用例全绿（raft 242 + loop 101 + components 53）、`typecheck`/`lint` 双门禁、`cost-monitoring-baseline` 2.46M token/$0.14 口径、`engineering-standards` 分层与错误码纪律；后续 04/05/06/07/08/09 直接引用 `E01-E69` 行号
