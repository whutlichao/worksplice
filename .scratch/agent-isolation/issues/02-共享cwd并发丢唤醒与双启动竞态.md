# 02-共享cwd并发丢唤醒与双启动竞态

Type: grilling
Status: resolved
Assignee: worksplice-dev (this session)
Blocked by: （无）

## Question

症状①的共享目录变体 + 症状②的并发根源。两个决策，每个携带修复 + 单测：

**决策一：BusyCwdError 的轮语义。**
`startSession` 在成员无存活 wrapper 且 `hasBusyRpcSessionForCwd(cwd)` 为真时抛 `BusyCwdError`（ADR-0001 串行协作）。但 `runAgentRound` 把 startSession 抛错 catch 成 `{status:"error"}`，而 driver 只在 `status==="busy"` 时才 `waitForSettle` 重试——**error 轮被直接丢弃，hint 永久丢失** → 共享项目目录的两个 agent 同时被唤醒时，后一个永远不回复。
- 决策：BusyCwdError 应映射为 busy 语义（等 settle 后把 target 放回队列重试，不丢 hint）。确认 driver `processAgent` 对 error 是否也该泛化重试
- 顺带确认 `hasBusyRpcSessionForCwd` 的检查面：是否该排除**同成员自己的**会话（当前先查 `findSession` 短路，验证无遗漏）；人类 pi 会话在同一 cwd 是否该挡（涉及 agent 与人类协作同一目录的语义，与 03 的所有权规则联动）

**决策二：并发双启动竞态。**
两 agent 共享 cwd 同时被唤醒：`startSession` 的启动锁键是 `agent-<member.id>`（不同成员不互斥），若两者都在对方 `hasBusyRpcSessionForCwd` 检查通过后的窗口里启动，会各自 `resolveLatestSessionFile` 解析到**同一最新 session 文件** → 同文件两个独立 wrapper、两个真实 session id，随后 `setAgentSessionFile` 把同一文件固化给两个成员 → 互相继承上下文、双作者刷屏（也是症状②的并发来源之一）。
- 决策：启动互斥怎么加——per-cwd 启动锁跨成员（`__workspliceStartingSessionCwds` 已有雏形，`trackStartingSession` 是否覆盖了本窗口）、还是解析后二次校验文件已被占用则让路/重试
- 与 02-决策一 的 BusyCwd 检查合并考虑：检查在 `startSession` 入口、竞态在检查与 resolve 之间，需要原子化或二次校验

## Notes

- 涉及文件：`lib/rpc-manager.ts`（`hasBusyRpcSessionForCwd`/`startRpcSession`/启动锁）、`lib/agent-runtime.ts`（`startSession`）、`lib/agent-loop/loop.ts`（startSession 调用处）、`lib/agent-loop/driver.ts`（busy/error 重试分支）
- 复现场景：两 agent 绑同一项目目录，频道同时唤醒两者
- 修复需配 `lib/agent-loop/driver.test.mjs` 或 `lib/agent-runtime` 相关测试；验证命令见 map Notes
- 结论记录在 `## Answer`

## Comments

- 2026-08-12（接管）：上个 session 的认领无在途代码（git diff 核实均为 01 的落地），本 session 接管继续。03 已 resolved：无主文件永不解析——「同文件双 session」的继承后果已被 03 拆除，本 ticket 聚焦：BusyCwdError→hint 丢弃（并发丢唤醒）与启动窗口竞态本身。

## Answer

### 根因确认（代码级）

- **并发丢唤醒的直接机制**：`runAgentRound` 把 `startSession` 抛错一律 catch 成 `{status:"error"}`，driver 只对 `busy` 重试——error 轮 target 已 shift 出队，hint 永久丢失。共享 cwd 并发唤醒时，后一个 agent 最常撞上的是**前者的启动窗口**（`trackStartingSession` 在 open 文件后才置位，检查与置位之间有窗口），而非对方真在跑。
- **同文件双 session**（ticket 原假设的 ② 候选）：已被 03 拆除（无主文件永不解析）；本 ticket 的启动互斥同时堵住窗口内的并发双启动本身。
- 修正：`startSession` 的 `findSession` 短路在 busy 检查之前——**同成员自己的会话无遗漏**（Q4 确认，不改代码）。

### 决策

1. **BusyCwdError → busy-cwd 语义（决策一）**：`runAgentRound` 区分捕获 `BusyCwdError` 返回新状态 `busy-cwd`（不再 publish error）；driver 对 `busy`/`busy-cwd` 统一走 `waitForSettle`——自身无会话时经 `runtime.findBusySessionForCwd(cwd)` 找到**占用会话**、订阅其 settle 事件后重试（找不到则立即重试，mutex 落地后不可达）。hint 不丢、状态不变 error、触发消息保持 pending。
2. **error 不泛化重试**：01 已保证 error 轮不推进游标、消息 pending（下次 wake 自愈）；泛化重试在模型持续故障（402）时会循环打爆 API。
3. **per-cwd 启动互斥（决策二）**：`withCwdStartLock`（globalThis 链式 Promise，realpath 归一键）把 `[busy 检查 → 文件选择 → 启动]` 串行化——并发唤醒的第二个 agent 排队等前者完成后重新决策（idle → 正常启动各建各的新文件；running → BusyCwdError → busy-cwd 重试），不再撞启动窗口。`trackStartingSession` 保留（覆盖非 loop 路径）。双 wrapper 并存的既有语义不变（ADR-0001 的串行只约束 running 期）。
4. **人类会话占用判定**：`startRpcSession` 唯一调用方是 agent-runtime → 人类 CLI/pi-web 会话永不进 registry → `hasBusyRpcSessionForCwd` 天然不可见 → 维持现状（不挡）；与 03 的继承面（永不解析人类文件）分叉成立，互不牵连。

### 修复（携带代码 + 单测）

- `lib/agent-loop/loop.ts`：`RoundStatus` 新增 `busy-cwd`；`runAgentRound` catch 区分 `BusyCwdError`；`LoopRuntime` 新增可选 `findBusySessionForCwd`。
- `lib/agent-loop/driver.ts`：`processAgent` 对 busy/busy-cwd 统一 `waitForSettle`；`waitForSettle` 等待对象 = 自身会话 ?? 占用会话；新增测试观察口 `peekAgentLoopSettleWaiters`（busy-cwd 用例需在订阅完成后才能 emit，否则踩 01-d 同款订阅窗口竞态）。
- `lib/rpc-manager.ts`：新增 `findBusyRpcSessionForCwd`（同 cwd running wrapper，busy-cwd 等待对象）。
- `lib/agent-runtime.ts`：`AgentRuntime` 接口 + 实现 `findBusySessionForCwd`；新增 `withCwdStartLock` 并把 `startSession` 关键段包入。
- 单测 5 条：driver「BusyCwdError 等占用会话 settle 后重试不丢 hint」端到端；loop「busy-cwd 轮不落 error 状态」；agent-runtime 锁 3 条（同 cwd 串行 / 不同 cwd 并行 / 失败 holder 不阻塞后继）。

### 关联

- 与 01 的分工：01 修的是「session 忙」的静默消费面；02 修的是「启动被占」的 hint 丢弃面——两处合起来覆盖症状①全部路径。
- 与 03 的分工：03 拆掉同文件继承的后果（无主文件不解析）；02 拆掉窗口竞态本身。
- ADR-0001 的「同一 cwd 串行协作」在本 ticket 落地为两层：启动期 mutex（本 ticket）+ 运行期 busy 检查（既有）。

### 验证

`tsc --noEmit` ✓、`npm run lint` ✓、全量 `node --test lib/*.test.mjs lib/agent-loop/*.test.mjs lib/raft/*.test.mjs` = 543/543 ✓（新增 5 条）。

⚠️ 热重载陷阱：本次改了 `lib/agent-loop/loop.ts`/`driver.ts`、`lib/rpc-manager.ts`、`lib/agent-runtime.ts`（globalThis 闭包持有旧代码），**dev server 必须重启**才能让修复生效。
