# 11 — cwd 互斥唯一事实来源

**What to build:** 共享同一项目目录的并发会话从 `lib/rpc`（registry）与 `agent-loop`（driver）两处各自实现的串行门禁收敛到单一 `lib/cwd-mutex` 深模块：窄接口 `withCwdMutex/isCwdBusy/findBusySession`（`realpathSync` 归一 + per-cwd 窗口计数 + `waitForSettle(SETTLE_EVENTS)` + `BUSY_CWD_RETRY_DELAY_MS=250`）成为 `agent-runtime` 与 `driver` 共用的唯一事实来源；行为不变——共享目录并发仍串行让路、不丢 wake hint、热重载守卫保留。

**Blocked by:** None — can start immediately

**Status:** resolved（2026-10-23）

- [x] `withCwdStartLock/trackStarting/hasBusyRpcSessionForCwd` 从 agent-runtime 与 rpc/registry 迁入 `lib/cwd-mutex`，旧调用点改走新接口，行为不变（共享目录并发串行、busy 让路、不丢 hint）
- [x] `realpathSync` 归一 + 窗口计数器 + `waitForSettle(SETTLE_EVENTS)` + `BUSY_CWD_RETRY_DELAY_MS=250` 有纯模块单测（zero SDK / zero HTTP / zero DB）
- [x] `agent-loop` driver 的 busy-cwd 重试改用 cwd-mutex，`globalThis.__workspliceCwdStartLocks/__workspliceStartingSessionCwds` 热重载守卫保留
- [x] 全量门禁 `tsc --noEmit + npm run lint + npm test`（347 用例）全绿
- [ ] 手动①：共享 project 目录并发探活——两个 agent 抢同一 cwd，后者等待/让路且不丢 hint

## Answer

**结论**：完成（2026-10-23 复核；本票为只读审计，未改源码）。

**证据**：
- 单一事实来源：`lib/cwd-mutex.ts:1-14` 职责说明、`withCwdMutex`（`:57`）、`isCwdBusy`（`:107`）、`findBusySession`（`:116`）；归一 `normalizeCwd`（`realpathSync`，`:33`）、窗口计数 `trackStarting`（`:87`）、`SETTLE_EVENTS`/`BUSY_CWD_RETRY_DELAY_MS=250`（`:136-138`）。
- 调用点收敛：`lib/agent-runtime.ts:15` 从 `./cwd-mutex.ts` 导入并在 `:251-252` 做 busy 检查；`lib/agent-loop/loop.ts:58` 导入，`:2219-2263` busy-cwd 重试改用 `waitForCwdSettle`/`scheduleBusyRetry`；`lib/rpc/registry.ts` 保留别名兼容（`lib/cwd-mutex.ts:125-126`）。
- 热重载守卫：`lib/cwd-mutex.ts:24-27` `globalThis.__workspliceCwdStartLocks` / `__workspliceStartingSessionCwds`。
- 纯单测：`lib/cwd-mutex.test.mjs`（`normalizeCwd`、串行、不同 cwd 不阻塞、失败 holder 不阻塞、引用计数、busy 探测、settle/retry；`zero SDK/HTTP/DB`）。
- 门禁基线：`npm test` 347/347 全绿记录见 `.scratch/pi-sdk-rebuild/research/03-current-state-inventory.md:370-371`；本次审计按票据约束未重跑（零源码改动）。

**偏差**：无。

**未勾选项说明**：最后一条“手动①：共享 project 目录并发探活”未勾选——需要两个真实 agent 抢同一 cwd 的人工场景，本票审计无法自动复现。等价行为由自动化覆盖：`lib/agent-lifecycle.test.mjs:119`（同 cwd 第二个 session 必须等待/拒绝）、`lib/cwd-mutex.test.mjs:79`（同 cwd 串行）、`lib/agent-loop/driver.test.mjs:307`（busy session 在 settle 后重试，不丢 hint）。

**验证方式**：只读审计（未改源码），核对上述实现与测试文件。