# Ticket 03: Separate Data Layer from Business Logic

**Status:** Ready  
**Priority:** Medium  
**Estimated effort:** Large

## Description

Define a `Store` interface and move SQLite implementation to an adapter. This creates a clean seam between business logic and data access.

## Motivation

- `db.ts` (1,186 lines) is a shallow facade — interface is the entire schema
- Raft modules and agent-loop import `db.ts` directly
- Testing requires real SQLite, no in-memory option

## Acceptance Criteria

- [ ] `Store` interface defined with ~50 method signatures
- [ ] `SQLiteAdapter` implements `Store`
- [ ] `InMemoryAdapter` implements `Store` (for tests)
- [ ] Business modules import `Store`, not `db.ts`
- [ ] All existing data access works
- [ ] Tests pass with either adapter
- [ ] `db.ts` no longer exposed directly

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
