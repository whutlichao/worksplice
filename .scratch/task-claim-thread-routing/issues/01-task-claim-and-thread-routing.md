# 任务创建后的认领与线程路由

Type: task
Status: resolved
Spec: [spec.md](../spec.md)

## What to build

修复 Owner 通过“发送消息并创建任务”创建频道任务后的认领与答复路由。以实际任务创建入口进入 task event、wake、drain 和 agent-loop seam，确保合格 agent 认领并把答复写入任务锚点线程；竞争认领失败者让路，普通频道消息继续回复频道 target。保留 freshness、认领互斥、状态机和既有普通消息语义。

## Acceptance

- [x] 有能在当前实现复现症状的确定性快速回归命令，并记录红→绿与原始复现复跑输出。
- [x] 测试经实际“发送消息并创建任务”路径与 agent-loop seam，检查任务 owner/status 及持久化 reply target。
- [x] 覆盖成功认领、锚点线程答复、竞争失败者不发频道顶层任务回复、普通频道回复仍正常。
- [x] 完成 diagnosing-bugs 假设验证；全量测试、typecheck、lint 记录真实输出。
- [x] Answer 包含两份独立 Standards / Spec review 报告及 PR 号；Status 为 resolved，工作区干净。

## Comments

- 2026-10-10 Q→A：本 Dispatch 的任务文本已完整给出问题、范围与验收，但当前 checkout 的 `.scratch` 中没有对应 feature/ticket 文件。Coordinator 按 `docs/agents/issue-tracker.md` 的本地 Markdown 约定指定本票路径为 `.scratch/task-claim-thread-routing/issues/01-task-claim-and-thread-routing.md`，并指定 `1c6db0a` 为 review fixed point；该提交经 coordinator 只读确认同时是当前 `main` 与 `origin/main`。据此创建本 `spec.md` 与 issue 正本后继续收敛。

## Answer

### 根因与 diagnosing-bugs 假设

根因是 `runAgentRound` 只有在模型返回显式 `task` 操作时才进入 `runTaskOperation`；普通的非空 `reply` 直接走 `deliverWithFreshness`，沿用频道主 target，也没有触发 claim。认领互斥与线程投递逻辑本身有效，遗漏发生在普通任务答复进入既有认领流程的路由处。

| 排名 / 假设 | 可证伪预测 | 探测结果 |
|---|---|---|
| 1. 普通 reply 没触发 claim（根因，确认） | 实际创建入口后任务仍 todo、无 owner，答复落频道 | 红测看到 `todo`、`hasOwner=false`、2 条顶层任务答复、0 条线程答复 |
| 2. 任务事件未送达或 wake/drain 漏消息 | prompt 看不到创建事件或任务 | 两位 agent 的 prompt 均有 `Task #1 created` 与 `Related open tasks:`，排除此因 |
| 3. 竞争认领失败后仍落顶层回复 | loser 未 yield 或冲突路径允许绕过 | 既有 conflict 用例保持 yield；新竞争用例 loser 为 `yielded` 且无顶层任务答复，排除此因 |
| 4. 显式任务操作的线程 target 解析错误 | 显式 claim 后仍写频道 | Convert-to-Task 路径验证显式 claim 可落锚点线程，故非本次根因 |

### 红绿证据与行为

- 原始快速复现：`node --test --test-name-pattern='Owner 发消息并创建任务后' lib/agent-loop/loop-tasks.test.mjs`。修复前经真实 `POST /api/tasks`、任务事件、wake、driver/drain 和 agent-loop seam 运行失败：任务 `todo`、无 owner；两个 agent 均在频道顶层回复，锚点线程没有回复。
- 修复前红测结果：`tests 1`、`pass 0`、`fail 1`；断言观测到 `{ taskStatus: 'todo', hasOwner: false, topLevelTaskReplies: 2, threadReplyCount: 0 }`，目标为 `{ taskStatus: 'in_progress', hasOwner: true, topLevelTaskReplies: 0, threadReplyCount: 1 }`。
- 实现后重跑同一命令：1 项通过。回归检查持久化 Task owner/status、频道顶层任务答复数、线程回复 `target_id === task.message_id` 与 author；竞争失败者记录 `yielded`。
- 修复后原始命令输出：`tests 1`、`pass 1`、`fail 0`，退出码 0。
- 混合消息保护：`node --test --test-name-pattern='task anchor 与普通频道消息同轮到达时' lib/agent-loop/loop-tasks.test.mjs`。前缀识别的初版会错误认领任务（实际 `in_progress`、预期 `todo`）；最终实现通过，普通消息即使以 `Task #1 created` 开头也留在频道且 Task 保持 `todo`。
- 自动认领只在本轮包含唯一开放任务锚点，且其余消息只有紧随锚点的 Owner 任务创建事件时生效；事件要求 `seq === anchor.seq + 1` 且内容以 `Task #N created` 开头。若本轮另有普通消息，不推断意图。原显式 `task.op`、freshness、互斥和任务状态机均复用既有逻辑。

### 门禁

- `npm run test`：1322 passed，0 failed，退出码 0。
- `node_modules/.bin/tsc --noEmit`：退出码 0，无输出。
- `npm run lint`：0 errors，1 个既有 warning：`hooks/useI18n.tsx:61` 的 `react-hooks/exhaustive-deps` 缺少 `locale` 依赖。
- `git diff --check` 通过；交付前 `git status --porcelain` 为空，fixed point `1c6db0a` 至 HEAD 的 numstat 无格式化噪声，仅覆盖本票 4 个文件。

### 改动文件

- `lib/agent-loop/loop.ts`：受限任务自动 claim、竞争失败让路、答复目标提示。
- `lib/agent-loop/loop-tasks.test.mjs`：真实任务创建入口、竞争认领、持久化 target、混合输入与普通频道回复回归。
- `.scratch/task-claim-thread-routing/spec.md`：本票行为与验收边界。
- `.scratch/task-claim-thread-routing/issues/01-task-claim-and-thread-routing.md`：状态、验收与本 Answer。

### Code review

两份独立报告均针对 `1c6db0a` fixed point 后的本票变更；Standards 复核了初审修正，Spec 复核了混合输入保护。

**Standards**

- 初审发现提交标题与 JSDoc 为英文，以及测试重复断言 Task 状态和线程回复数。
- 处置：提交标题改为 `fix(agent-loop): 认领任务并将答复发到线程`；JSDoc 改成简体中文；删掉重复断言。
- 独立复核报告：findings 均已消除，工作区干净，没有残余。

**Spec**

- 初审发现同轮混有普通消息时，单凭任务锚点存在可能把无关答复误投线程。
- 处置：添加混合输入回归；自动 claim 仅限唯一任务锚点及其紧随的 Owner 创建事件，其他消息在场时保留普通频道 target。回归还验证普通 Owner 消息即使以同一前缀开头，也不会被当成事件。
- 独立复核报告：该 finding 已消除。剩余极窄边界是任务事件投递失败且下一条 Owner 消息紧随锚点、恰好使用同一前缀；正常创建路径同步写事件，审查者认为这不构成当前 Spec 下的实质性 finding。

### PR

[PR #134：修复新建任务认领与线程回复路由](https://github.com/whutlichao/worksplice/pull/134)
