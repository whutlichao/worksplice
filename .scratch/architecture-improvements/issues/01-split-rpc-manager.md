# Ticket 01: Split RPC Manager

**Status:** Ready  
**Priority:** High  
**Estimated effort:** Medium

## Description

Replace `lib/rpc-manager.ts` (1,307 lines, 11 exports) with four narrow modules, each responsible for a distinct concern.

## Motivation

- Interface nearly matches implementation (shallow module)
- Testing requires mocking the entire module
- Different concerns (registration, calling, subscription, broadcasting) are interleaved

## Acceptance Criteria

- [ ] All existing RPC functionality works without regression
- [ ] `RpcRegistry` handles handler registration
- [ ] `RpcCaller` handles method invocation
- [ ] `RpcSubscriber` handles subscribe/unsubscribe
- [ ] `RpcBroadcaster` handles event broadcasting
- [ ] Each new module has its own test file
- [ ] Existing tests pass
- [ ] No functionality regression

## Files Affected

- `lib/rpc-manager.ts` → split into 4 files
- `lib/rpc-manager.test.mjs` → split into 4 test files
- Any imports of `lib/rpc-manager` updated to use new modules

## Implementation Steps

1. Create `lib/rpc/registry.ts` with register/unregister
2. Create `lib/rpc/caller.ts` with call/invoke
3. Create `lib/rpc/subscriber.ts` with subscribe/unsubscribe
4. Create `lib/rpc/broadcaster.ts` with broadcast
5. Create `lib/rpc/index.ts` re-exporting all four
6. Update all imports from `rpc-manager` to `rpc`
7. Move/rename tests accordingly
8. Delete old `rpc-manager.ts`

## Dependencies

None — can be done immediately.

## Notes

- Preserve all existing public APIs during transition
- Run tests after each step to catch regressions early
