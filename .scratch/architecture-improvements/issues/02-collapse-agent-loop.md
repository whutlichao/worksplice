# Ticket 02: Collapse Agent-Loop Orchestration

**Status:** Ready  
**Priority:** High  
**Estimated effort:** Medium

## Description

Consolidate `lib/agent-loop/` from 5 files into a single deep module with a narrow public interface.

## Motivation

- `loop.ts` (871 lines) orchestrates but pulls in 4 satellite files
- Dependencies leak across the seam
- Understanding the loop requires bouncing between 5 files

## Acceptance Criteria

- [ ] One `AgentLoop` module with interface: `start()`, `stop()`, `tick()`
- [ ] Internal orchestration hidden inside the module
- [ ] Satellite files (`wake.ts`, `driver.ts`, `backfill.ts`, `reminder-cron.ts`) are deleted
- [ ] Existing agent loop behaviour unchanged
- [ ] All tests pass

## Files Affected

- `lib/agent-loop/loop.ts` → consolidated
- `lib/agent-loop/wake.ts` → merged into loop
- `lib/agent-loop/driver.ts` → merged into loop
- `lib/agent-loop/backfill.ts` → merged into loop
- `lib/agent-loop/reminder-cron.ts` → merged into loop
- `lib/agent-loop/index.ts` → updated

## Implementation Steps

1. Identify all internal functions from the 4 satellite files
2. Move them into `loop.ts` as internal functions (not exported)
3. Ensure `loop.ts` exports only `start()`, `stop()`, `tick()`
4. Update any external imports to use `agent-loop` only
5. Delete `wake.ts`, `driver.ts`, `backfill.ts`, `reminder-cron.ts`
6. Update `index.ts` to re-export only the public interface
7. Run tests and verify behaviour

## Dependencies

None — can be done in parallel with Ticket 01.

## Notes

- Keep the internal structure clean — don't just concatenate files
- Use the `tick()` method as the single entry point for loop progression
