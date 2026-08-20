# 06-目标架构的分层与深模块切分

Type: grilling
Status: open
Blocked by: 01, 02, 04

## Question

综合 01/02 研究与 04 边界决策，决策重构后的目标架构分层与深模块切分（`lib/` 域的依赖方向与导入面）。

- 分层：`lib/domain/raft`（唯一导入面 `lib/domain/raft/index.ts`）、`lib/data`（`Store` 契约 + `SQLiteAdapter`）、`lib/agent-loop`（深模块内 driver/wake/backfill/cron）、`lib/rpc` 新形态、`app/api` 薄封装的职责与依赖方向（是否延续 `Store` 契约、是否保留 `getDb(): Store` 单例）
- 深模块化：每个包的 entry point、子模块内部直引不经索引回环、测试 seam（raft 域 mock）如何保留
- 与 02 选型联动：若保留 better-sqlite3，Store 接口是否收窄/扩张；若换库，`lib/data` 的适配层形态
- 产出一张目标架构 Mermaid 图草稿与模块清单，为 spec §5 技术架构章提供骨架
