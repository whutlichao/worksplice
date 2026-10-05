# 11 — cwd 互斥唯一事实来源

**What to build:** 共享同一项目目录的并发会话从 `lib/rpc`（registry）与 `agent-loop`（driver）两处各自实现的串行门禁收敛到单一 `lib/cwd-mutex` 深模块：窄接口 `withCwdMutex/isCwdBusy/findBusySession`（`realpathSync` 归一 + per-cwd 窗口计数 + `waitForSettle(SETTLE_EVENTS)` + `BUSY_CWD_RETRY_DELAY_MS=250`）成为 `agent-runtime` 与 `driver` 共用的唯一事实来源；行为不变——共享目录并发仍串行让路、不丢 wake hint、热重载守卫保留。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] `withCwdStartLock/trackStarting/hasBusyRpcSessionForCwd` 从 agent-runtime 与 rpc/registry 迁入 `lib/cwd-mutex`，旧调用点改走新接口，行为不变（共享目录并发串行、busy 让路、不丢 hint）
- [ ] `realpathSync` 归一 + 窗口计数器 + `waitForSettle(SETTLE_EVENTS)` + `BUSY_CWD_RETRY_DELAY_MS=250` 有纯模块单测（zero SDK / zero HTTP / zero DB）
- [ ] `agent-loop` driver 的 busy-cwd 重试改用 cwd-mutex，`globalThis.__workspliceCwdStartLocks/__workspliceStartingSessionCwds` 热重载守卫保留
- [ ] 全量门禁 `tsc --noEmit + npm run lint + npm test`（347 用例）全绿
- [ ] 手动①：共享 project 目录并发探活——两个 agent 抢同一 cwd，后者等待/让路且不丢 hint