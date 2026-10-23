# Ticket 03: Separate Data Layer from Business Logic

**Status:** resolved（2026-10-23）  
**Priority:** Medium  
**Estimated effort:** Large

## Description

Define a `Store` interface and move SQLite implementation to an adapter. This creates a clean seam between business logic and data access.

## Motivation

- `db.ts` (1,186 lines) is a shallow facade — interface is the entire schema
- Raft modules and agent-loop import `db.ts` directly
- Testing requires real SQLite, no in-memory option

## Acceptance Criteria

- [x] `Store` interface defined with ~50 method signatures
- [x] `SQLiteAdapter` implements `Store`
- [ ] `InMemoryAdapter` implements `Store` (for tests)
- [x] Business modules import `Store`, not `db.ts`
- [x] All existing data access works
- [ ] Tests pass with either adapter
- [x] `db.ts` no longer exposed directly

## Files Affected

- `lib/data/db.ts` → becomes `lib/data/store-sqlite.ts`
- `lib/data/store.ts` → new interface definition
- `lib/data/store-memory.ts` → new in-memory adapter
- `lib/raft/*.ts` → update imports
- `lib/agent-loop/*.ts` → update imports
- Any other files importing `db.ts`

## Implementation Steps

1. Create `lib/data/store.ts` with `Store` interface
2. Move `db.ts` logic into `lib/data/store-sqlite.ts` implementing `Store`
3. Create `lib/data/store-memory.ts` for tests
4. Update all imports: `import { db } from 'lib/data/db'` → `import { store } from 'lib/data/store-sqlite'`
5. Update tests to use `InMemoryAdapter` where possible
6. Delete old `db.ts` (or keep as re-export for transition)

## Dependencies

This is a prerequisite for Ticket 04.

## Notes

- Start with the interface definition — get it right before implementing adapters
- Use dependency injection rather than global imports for the store
- This is the largest ticket; consider breaking into sub-tickets

## Answer

**结论**：按已批准偏差完成（2026-10-23 复核；本票为只读审计，未改源码）。

**证据**：
- `Store` 契约：`lib/data/store.ts:39` `export interface Store`（宽总线，57 方法、13 分组）。
- SQLite 适配器：`lib/data/sqlite.ts:50` `export class SQLiteAdapter implements Store`；`lib/data/db-singleton.ts:17` `getDb(): Store` 单例。
- 业务只依赖契约：`lib/domain/collab/*`、`lib/agent-loop/loop.ts` 等经 `getDb(): Store` / `lib/data/types.ts` 取数据，不再 import `data/db`；`lib/data/db.ts` 已不存在。
- 现有数据访问：`lib/data/data-layer.test.mjs` 覆盖迁移/表结构/游标/成员视图等；迁移与验证记录见 `.scratch/architecture-improvements/PROGRESS.md:51-72`（tsc ✓、lint 0 error ✓、全量 629 测试 ✓）。

**偏差**：
1. “`InMemoryAdapter` implements `Store`”保持未勾选——未实现（`lib/data/store-memory.ts` 不存在）。
2. “Tests pass with either adapter”保持未勾选——当前测试只跑 SQLiteAdapter。

批准来源：`.scratch/architecture-improvements/SPEC.md:78`（“Tests pass with either adapter — DEFERRED … 经确认本期只做 Store 契约 + SQLiteAdapter”）与 `.scratch/architecture-improvements/PROGRESS.md:51-53`（范围收窄说明）、`:72`（遗留记录）；`docs/adr/0008-target-architecture-deep-modules.md:6` 冻结的架构形状是 `Store + SQLiteAdapter + schema + db-singleton`，未把 InMemoryAdapter 纳入目标；`docs/adr/0006-backward-compat-and-migration-strategy.md` 冻结 Store 宽总线暂不拆分。

**验证方式**：只读审计（未改源码），核对上述文件与测试；未重跑全量测试（本票零源码改动）。
