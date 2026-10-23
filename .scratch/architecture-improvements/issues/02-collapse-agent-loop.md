# Ticket 02: Collapse Agent-Loop Orchestration

**Status:** resolved（2026-10-23）  
**Priority:** High  
**Estimated effort:** Medium

## Description

Consolidate `lib/agent-loop/` from 5 files into a single deep module with a narrow public interface.

## Motivation

- `loop.ts` (871 lines) orchestrates but pulls in 4 satellite files
- Dependencies leak across the seam
- Understanding the loop requires bouncing between 5 files

## Acceptance Criteria

- [x] One `AgentLoop` module with interface: `start()`, `stop()`, `tick()`
- [ ] Internal orchestration hidden inside the module
- [ ] Satellite files (`wake.ts`, `driver.ts`, `backfill.ts`, `reminder-cron.ts`) are deleted
- [x] Existing agent loop behaviour unchanged
- [x] All tests pass

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

## Answer

**结论**：按已批准偏差完成（2026-10-23 复核；本票为只读审计，未改源码）。

**证据**：
- 单文件深模块：`lib/agent-loop/loop.ts` 内聚 round/driver/backfill/reminder-cron；`lib/agent-loop/index.ts:1-6` 仅 re-export `createAgentLoop`（`start/stop/tick` 公共面）。
- 卫星文件：`lib/agent-loop/` 下已无 `wake.ts`/`driver.ts`/`backfill.ts`/`reminder-cron.ts`（仅保留对应测试文件）；`driver`/`backfill`/`reminder-cron` 编排并入 `loop.ts`（如 `:2048` driver、`:2789` backfill、`:3209` cron）。
- 测试：`lib/agent-loop/loop.test.mjs`、`driver.test.mjs`、`backfill.test.mjs`、`reminder-cron.test.mjs`、`wake.test.mjs` 全部改为从 `./loop.ts` / 协作域导入并通过；迁移记录 `.scratch/architecture-improvements/PROGRESS.md:22-35`（343 官方脚本 ✓、全量 702 ✓）。
- wake 新归属：`lib/domain/collab/wake.ts:35` `subscribeWake`、`:43` `emitWake`、`:62` `notifyMessageWakes`，协作服务层发布、agent-loop 订阅。

**偏差**：wake 未合入 `loop.ts`，而是下沉 `lib/domain/collab/wake.ts`（依赖反转），因此两条字面验收保持未勾选：
1. “Internal orchestration hidden inside the module”——内部函数保留为测试面（测试直接从 `./loop.ts` 导入），`index.ts` 只收窄公共出口。
2. “Satellite files ... are deleted/merged into loop”——`wake.ts` 是迁出到协作域，不是并入 loop。

批准来源：`.scratch/architecture-improvements/PROGRESS.md:29-32`（“wake 下沉……偏离 ticket 字面 'merged into loop'，属有意的架构决策，Spec review 认可”）与 `docs/adr/0008-target-architecture-deep-modules.md:8`（`lib/domain/collab` 唯一导入面，wake 为域内子模块）、`:11`（agent-loop 单文件深模块保留）。

**验证方式**：只读审计（未改源码），核对上述文件与测试；未重跑全量测试（本票零源码改动）。
