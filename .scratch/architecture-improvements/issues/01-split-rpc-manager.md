# Ticket 01: Split RPC Manager

**Status:** resolved（2026-10-23）  
**Priority:** High  
**Estimated effort:** Medium

## Description

Replace `lib/rpc-manager.ts` (1,307 lines, 11 exports) with four narrow modules, each responsible for a distinct concern.

## Motivation

- Interface nearly matches implementation (shallow module)
- Testing requires mocking the entire module
- Different concerns (registration, calling, subscription, broadcasting) are interleaved

## Acceptance Criteria

- [x] All existing RPC functionality works without regression
- [x] `RpcRegistry` handles handler registration
- [x] `RpcCaller` handles method invocation
- [x] `RpcSubscriber` handles subscribe/unsubscribe
- [x] `RpcBroadcaster` handles event broadcasting
- [x] Each new module has its own test file
- [x] Existing tests pass
- [x] No functionality regression

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

## Answer

**结论**：完成（2026-10-23 复核；本票为只读审计，未改源码）。

**证据**：
- 四模块 + 公共面：`lib/rpc/registry.ts`（`RpcRegistry`）、`lib/rpc/caller.ts`（`RpcCaller`）、`lib/rpc/subscriber.ts`（`RpcSubscriber`）、`lib/rpc/broadcaster.ts`（`RpcBroadcaster`）、`lib/rpc/index.ts`（公共出口，`:1-40` 保持原 11 导出）。
- 旧模块删除：仓库无 `lib/rpc-manager.ts`/`lib/rpc-manager.test.mjs`；全仓 `rpc-manager` 只余注释与守卫测试文字（`grep -rn rpc-manager` 命中 `lib/rpc/index.ts:1`、`lib/rpc/index.test.mjs:12` 等说明性文字），无运行时 import。
- 每模块自带测试：`lib/rpc/registry.test.mjs`、`caller.test.mjs`、`subscriber.test.mjs`、`broadcaster.test.mjs`、`session.test.mjs`，加 `index.test.mjs:28`（原 11 导出完整性守卫）。
- 无回归：迁移记录与验证结果见 `.scratch/architecture-improvements/PROGRESS.md:7-20`（tsc ✓、lint 0 error ✓、全量 675 测试 ✓）。

**偏差**：无。

**验证方式**：只读审计（未改源码），核对上述文件与测试；未重跑全量测试（本票零源码改动）。

**本轮票据收敛 PR**：#196（https://github.com/whutlichao/worksplice/pull/196；body 路径 `/tmp/ticket-status-reconcile-pr-body.md`）。
