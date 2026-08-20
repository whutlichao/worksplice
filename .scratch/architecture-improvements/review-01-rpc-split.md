# Code Review — Ticket 01: Split RPC Manager

**Reviewer:** 代码评审
**Date:** 2026-08-14
**Scope:** 工作区未提交变更（`lib/rpc-manager.ts` 删除 → `lib/rpc/`，以及 10 个 API route 改 import `@/lib/rpc`）

## 结论

**阻塞（BLOCKER）** — 迁移未完成且代码无法编译/运行。当前状态**不可以合入**，必须停工整改。

---

## 1. 阻塞问题（必须先修）

### 1.1 `lib/rpc/session.ts` 截断，语法错误（编译 blocker）
- 文件末尾（echo 897 行起）开了一个 `declare global {` 块，但**缺少收尾 `}`**。
- `node_modules/.bin/tsc --noEmit` 报错：
  ```
  lib/rpc/session.ts(904,1): error TS1005: '}' expected.
  ```
- 整个文件无法 parse → 编译失败。

### 1.2 `lib/agent-runtime.ts` 仍导入已删除的 `lib/rpc-manager.ts`（运行 crash）
- 该文件**不在本次 diff 内**（是已提交代码），却仍引用被删文件：
  - 第 13 行顶层 `import type { AgentSessionWrapper } from "./rpc-manager.ts";`
  - 第 190 行 **运行时** `await import("./rpc-manager.ts");`（`createRealAgentRuntime`）
- 第 190 行是惰性 import，`getAgentRuntime()` 一旦被调用（任何 agent 会话启动/唤醒路径）即抛 ENOENT → **整个 agent 生命周期不可用**。这是最致命的回归。
- 且第 13 行静态 type import 违背 AGENTS.md 明确纪律：**`agent-runtime` 绝不能静态 import rpc-manager**（node TS strip 无法解析 parameter properties）。

### 1.3 `lib/project-trust.test.mjs` 读已删除文件（测试失败）
- 第 78、109 行 `readFile(new URL("./rpc-manager.ts", ...))` → ENOENT。
- 该测试是源码级规范守门测试，删除旧文件后必然红。

---

## 2. 规格偏离（Spec / Ticket 01 验收未达成)

Ticket 01 明确要求拆出 **`RpcRegistry` / `RpcCaller` / `RpcSubscriber` / `RpcBroadcaster`** 四模块，且 **每个新模块有自己的测试文件**，现有测试通过。实际交付：

- 拆成了完全不同的 **`events` / `ui` / `registry` / `session`** 四个文件，`RpcRegistry/Caller/Subscriber/Broadcaster` 均不存在。
- **没有任何新的 per-module 测试文件**；原有 `rpc-manager.test.mjs`、`rpc-manager-shutdown.test.mjs` 被直接删除（133 行 + 77 行测试成果丢失），未拆分迁移。
- 验收标准：`Each new module has its own test file`、`Existing tests pass`、`No functionality regression` —— **三项均未满足**。

如果这是预研/草稿而非定稿提交，请与父会话确认策略；若作为 PR 评审则上述均为 blockers。

---

## 3. 设计质量问题（应整改）

### 3.1 `ui.ts` 的 `createUiHelpers` 是死代码 + 与 `session.ts` 重复
- `lib/rpc/ui.ts` 导出 `createUiHelpers`，经 `index.ts` re-export，**但全库无任何调用方**。
- `session.ts` 用相同逻辑的 private 方法**内联重新实现**了一遍（`requestExtensionCustomUi`/`createExtensionUiContext`/`emitCustomUiRender` 等）。
- 两份实现的事件契约**不一致**：`ui.ts` 的 `emitCustomUiRender` emit `type:"custom_ui_render"`；`session.ts` emit `type:"extension_ui_request"`。同一概念两套协议，将来必漂移。
- 建议：二选一，删除未被使用的 `ui.ts` 中的死代码，或以 `ui.ts` 收敛 `session.ts` 的自定义 UI 逻辑。

### 3.2 `registry.ts` 是"厨房水槽"，未解决浅模块问题
- 名为 registry 却同时承担：handler 注册、busy-cwd 探测、running-status 广播、以及整个 `startRpcSession` 的服务构造逻辑（SDK services/模型作用域/持久化 prefs）。
- Ticket 的动机是"接口宽度≈实现宽度，难 mock"。拆分后 `registry.ts` 仍是一个宽接口聚合并依赖 SDK，**没有实质加深**，反而把 `startRpcSession` 塞进"registry"名不副实。

### 3.3 `declare global` 跨文件重复 + 截断暴露的脆弱性
- `session.ts` 与 `registry.ts` 都声明了 `__workspliceSessions` / `__workspliceStartLocks`（重复声明），`__workspliceRunningListeners` 只在 registry 声明，而 `session.ts` 的 `start()` 又调用 `notifyRunningChange()`（定义在 registry）。
- 拆文件的 `declare global` 边界脆弱——这次截断正是它没被发现就落盘。

### 3.4 相关文档索引未同步（次要）
- `AGENTS.md`、`README.md`、`README.zh-CN.md`、`docs/spec.md`、`docs/spec-bootstrap-agent.md` 仍引用 `rpc-manager.ts`（文件已删）。

---

## 4. 整改建议（分优先级）

1. **P0**：修复 `session.ts` 截断（补全 `declare global` 收尾，或移除该多余重复块）。
2. **P0**：更新 `agent-runtime.ts` 的 import —— 运行时 `await import` 改指 `./rpc.ts`（或 `./rpc/session`/`./rpc/registry`）；顶层 type import 依赖改为从 `lib/rpc` 引，且遵守"惰性 import、不静态拉 SDK"纪律。
3. **P0**：修复 `project-trust.test.mjs` 对 `rpc-manager.ts` 的源码断言（改指 `lib/rpc/*` 的实际文件与内容）。
4. **P1**：与父会话/架构师确认四模块命名是否可偏离 Ticket（`RpcCaller/Subscriber/Broadcaster`）——若坚持 Ticket，需补 `caller/subscriber/broadcaster` 并补 per-module 测试；若接受新拆分，应更新 Ticket 与 SPEC 记录偏离。
5. **P1**：消除 `ui.ts` 死代码或收敛重复逻辑，统一自定义 UI 事件契约。
6. **P1**：为拆出的模块补回被删除的 210 行测试（registry/session 生命周期、idle shutdown、fork 双分支、set_thinking_level xhigh 等既有覆盖）。
7. **P2**：`registry.ts` 解耦 `startRpcSession`（可独立 `session-starter`），或至少重命名使其名副其实；文档索引同步。

**验证建议**：整改后跑 `node_modules/.bin/tsc --noEmit`（当前必红）、`npm run lint`、以及 `lib/*.test.mjs` 全量。dev 期间禁跑 `next build`。
