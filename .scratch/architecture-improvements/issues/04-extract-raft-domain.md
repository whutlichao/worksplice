# Ticket 04: Extract Raft Domain into a Proper Module

**Status:** ✅ Done（2026-08-14，提交 `d7b70e9`；配套 flake 修复 `5225b43`）  
**Priority:** Medium  
**Estimated effort:** Medium

## Description

Consolidate `lib/raft/` (7 domain modules, 2,525 lines) into one indexed module with a single seam.

## Motivation

- raft/ is a namespace, not a module
- Each sub-domain is imported separately (7 imports per consumer)
- No single seam for testing or mocking

## Acceptance Criteria

- [x] One `domain/raft` module with indexed exports
- [x] Sub-domains (channels, members, messages, tasks, reminders) are internal（消费方零子路径导入，守卫测试守护）
- [x] Consumers import from one place: `import { channels, members } from 'domain/raft'`
- [x] All raft functionality works（tsc / lint 0 error / 346 测试全绿）
- [x] Tests can mock the whole raft domain via one seam（index.test.mjs seam 守卫：完整性 + 同绑定 + getDb 不在面）
- [x] Imports reduce from 7 to 1 per consumer

## Files Affected

- `lib/raft/*.ts` → moved to `lib/domain/raft/`
- `lib/domain/raft/index.ts` → consolidated exports
- All files importing from `lib/raft/` → update imports

## Implementation Steps

1. Create `lib/domain/raft/` directory
2. Move all `lib/raft/*.ts` files into the new directory
3. Create `lib/domain/raft/index.ts` re-exporting all public APIs
4. Update all imports: `lib/raft/channels` → `domain/raft`
5. Delete old `lib/raft/` directory
6. Run tests and verify behaviour

## Dependencies

This depends on Ticket 03 (data layer separation) — the store interface should be in place first.

## Notes

- This is the final ticket in the sequence
- Keep the public API identical during transition
- The `index.ts` becomes the single seam for the whole raft domain
