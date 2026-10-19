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
- [x] Task #9 回归覆盖本 agent 自己的旧 drain 消息，以及“锚点 + 创建事件”和 event-only 两条入口；两者均须认领成功并将答复持久化到任务锚点线程。
- [x] 其他作者的额外活动、多任务、同轮锚点与创建事件非相邻或不匹配、closed / reopened / 已有 owner 与竞争 claim 仍按原规则阻止或让路；普通频道回复语义保持不变。
- [x] `docs/spec.md` §3.7 与本地 spec 明确忽略本 agent 自己的历史 drain 消息；追加 Task #9 Answer，记录红绿证据、改动文件、双轴 review 处置和 PR。

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

### Task8 后续：仅收到任务创建事件时的回复路由

**实现**

- `runAgentRound` 对普通非空 reply 仅在本轮 channel 新活动恰好为以下之一时合成现有 `task: claim` 操作：单个可识别的 Owner `Task #N created` 事件，或唯一任务锚点及其紧随的创建事件。锚点从本轮全部 drained messages 中匹配（包含接收 agent 自己发出的消息）；创建事件仍须由 Owner 发布。任务经既有 claim/freshness/reopened 裁决；成功回复到锚点 thread，失败让路且不在 channel 发回复。
- task protocol 与 `docs/spec.md` §3.7 已同步：多任务、混合 channel 活动、普通消息或不确定匹配不自动选任务；明确 task op 保留，规则文字使用中文描述 Owner 发布与唯一负责人约束。
- 回归与复现均使用 agent-loop 测试夹具创建的临时数据库；默认 `~/.worksplice` 未使用。

**红绿证据**

- 红：在隔离基线 `2c5619f048da26d32a0895d229daad7fb91442f3` 中只带入新增测试文件，运行 `node --test --test-name-pattern='an ordinary reply claims a task created from an already consumed anchor' lib/agent-loop/loop-tasks.test.mjs`。结果 `tests 1, pass 0, fail 1`；channel-target 断言的实际值为 `['60f44c2c-afa8-4a29-b698-3ee02fd3fd01']`，期望 `[]`，明确显示修复前回复落在 channel。
- 新增 agent-authored 锚点 + Owner 创建事件回归：`node --test --test-name-pattern='an agent-authored task anchor and creation event route an ordinary reply to the thread' lib/agent-loop/loop-tasks.test.mjs`。实现前 channel-target 断言失败（`pass 0, fail 1`，实际 target 为 channel ID `4f3dbc5d-8f6f-4346-bddf-f5547c046cf7`，期望 `[]`）；实现后定向测试 `pass 1, fail 0`。
- 绿：event-only 定向命令 `tests 1, pass 1, fail 0`；最终 `node --test lib/agent-loop/loop-tasks.test.mjs` 为 `tests 27, pass 27, fail 0`。

**门禁**

- `npm run typecheck`：退出码 0。
- `npm run lint`：退出码 0，0 errors；1 条未修改文件中的 warning：`hooks/useI18n.tsx:61` 缺少 `locale` dependency。
- 最终 `npm test`：`1511 passed, 1 failed`，失败为 `lib/model-listing.test.mjs:50` 的 `lite path returns a working runtime without loading extensions`。同一命令在隔离基线 `2c5619f048da26d32a0895d229daad7fb91442f3` 得到 `1507 passed, 1 failed`，同一断言意外返回 DeepSeek 模型列表；已按 coordinator 指示记录为无关的基线/环境失败，未改票外文件。
- `git diff 2c5619f048da26d32a0895d229daad7fb91442f3...HEAD --check`：通过。

**规范评审发现与处置**

- 初审指出新增测试使用双引号，违反 `docs/engineering-standards.md` §1 的单引号约定；已在 `38e44e7` 改为单引号，最终 agent-loop 回归通过。
- 最终 Standards review 指出 `docs/engineering-standards.md` §1 的简体中文正文要求；已将 `Owner-authored` / `one-owner` 改成“由 Owner 发布” / “唯一负责人”。
- 后续审查指出两条路由路径重复判断 done/closed；已在 `9cdf9e3` 预先筛出 `openTasks` 并复用，避免状态定义漂移。
- 初审另报告一个可能的 Duplicated Code smell：agent-loop 事件解析与 `ChannelView.tsx` 显示解析相似。后续 Standards review 未保留此项为 finding；仍未让服务端依赖 UI 组件或越出三文件范围抽取共享模块。

**规格评审**

- Spec review 发现 agent-authored 锚点被 `incoming` 排除，导致锚点 + 创建事件路径退回 channel target。处置：锚点从 `roundMessages` 匹配，Owner-authored 事件仍从 `incoming` 匹配；新增红绿回归，验证实际 thread target、Task owner/status 与 channel 无回复。
- 最终双轴 review 的 Standards 与 Spec 报告均为 `findings: []`、`overall_correctness: correct`。Standards 摘要另提到两项 §1 风格问题和一项重复代码 smell，但没有给出可复核位置；此前有具体依据的问题及其处置见上文。

**PR**

- [PR #188：修复任务创建后的回复线程路由](https://github.com/whutlichao/worksplice/pull/188)
- PR body 文件：`/tmp/worksplice-task8-thread-routing-pr-body.md`。
- 按 coordinator 指示，最终 head SHA 随 worker_done 外部报告提交；不写入同一 PR 内的 Answer，避免 Answer 提交后该 SHA 立即失效。

**PR #188 单引号门禁补充**

- 修正：仅将本 PR 新增代码行的 JS/TS 字符串分隔双引号改为单引号；JSON payload 内容中的双引号保留；两个评审标题改为“规范评审发现与处置”和“规格评审”。
- 验证：`node --test lib/agent-loop/loop-tasks.test.mjs` 为 27 passed、0 failed；`npm run typecheck` 通过；`npm run lint` 为 0 errors、1 条 `hooks/useI18n.tsx:61` warning；`git diff --check` 通过。
- 最终双轴评审（Standards / Spec）：两份报告均为 `findings: []`、`overall_correctness: correct`；Standards 未发现剩余规范违规或可报告的 code smell，Spec 未发现行为或范围问题。

### Task #9 后续：忽略本 agent 自己的历史 drain 消息

**根因与修复**

- `claimTaskFromReply` 的混合活动检查使用全部 `roundMessages`，把接收 agent 自己因消费游标未越过其输出而留在 drain 的旧消息当成竞争活动。event-only 分支也要求整个 drain 恰好只有一条消息，因此同样拒绝了包含旧自回复的唯一 Owner 创建事件。
- 混合活动和 event-only 匹配改为依据 `incoming`（仅其他作者的消息）；唯一开放任务锚点仍从完整 drain 查找，保证 agent-authored 锚点可参与锚点 + 紧邻事件路径。event-only fallback 仅在 drain 不含开放任务锚点时运行，避免非相邻事件或其他可见任务锚点导致误选。
- Task #9 回归先提交并将 Status 设为 `in_progress`（`b8d3f40`），随后提交实现；本 Answer 完成后 Status 收敛为 `resolved`。旧 PR #188 Answer 与证据保留不变。

**红绿证据**

- 主回归标题：`a self-authored reply left in the drain does not block automatic task claims`。
- 红命令：`node --test --test-name-pattern='a self-authored reply left in the drain does not block automatic task claims' lib/agent-loop/loop-tasks.test.mjs`。在隔离 worktree 的原实现上 `tests 1, pass 0, fail 1`；锚点 + event 与 event-only 两种情形都实际得到 `taskStatus: 'todo'`、`claimedByAgent: false`、答复 target 为 `channel`、频道任务答复数为 1。
- 绿：同一命令最终为 `tests 1, pass 1, fail 0`；两种情形均为 `in_progress`、接收 agent 成为 owner、答复 target 等于任务锚点、频道任务答复数为 0。
- 规格边界回归 `an unconsumed task anchor with a nonadjacent Owner event does not auto-claim`：修正前失败（实际 `in_progress`，预期 `todo`），修正后通过。
- 规格边界回归 `a visible unmatched task anchor blocks event-only auto-claim`：修正前失败（实际 `in_progress`，预期 `todo`），修正后通过。
- 测试文件使用 `fs.mkdtempSync` 打开临时 SQLite fixture；未访问默认 Worksplice 数据库。

**最终验证**

- `node --test lib/agent-loop/loop-tasks.test.mjs`：`tests 30, pass 30, fail 0`。
- `npm run typecheck`：退出码 0。
- `npm run lint`：退出码 0，0 errors；1 条既有 warning：`hooks/useI18n.tsx:61` 缺少 `locale` dependency。
- `git diff --check`：通过。未运行全仓全量测试，符合本票范围。

**改动文件**

- `lib/agent-loop/loop.ts`：只以其他作者 incoming 消息判断竞争活动；event-only 需无可见开放任务锚点。
- `lib/agent-loop/loop-tasks.test.mjs`：覆盖两条成功入口，以及非相邻事件和可见歧义锚点的拒绝行为。
- `docs/spec.md` §3.7：说明忽略本 agent 的旧 drain 消息，并保留多任务、非相邻事件与可见锚点保护。
- `.scratch/task-claim-thread-routing/spec.md`：追加 Task #9 follow-up 规则。
- `.scratch/task-claim-thread-routing/issues/01-task-claim-and-thread-routing.md`：状态、Acceptance 与本 Answer。

**双轴 code review**

Review fixed point：`main`（`1e5741e120a946ee0e973cb762d10e21fa05d103`）。Standards 与 Spec 由独立 reviewer 分别执行。

**Standards（前一轮复核）**

- 报告：`findings: []`，`overall_correctness: correct`。未发现 `docs/engineering-standards.md` §§1、2、5 的违规或可报告的 smell；回归沿用 agent-loop fake runtime 与隔离数据库约定。

**Standards（map 补齐前的最终 diff 复核）**

- 报告：`findings: 1`，`overall_correctness: incorrect`。Finding：`.scratch/task-claim-thread-routing/map.md` 不存在；`docs/engineering-standards.md` §5 要求将 ticket 结论写入该 effort 的 `map.md` → Decisions-so-far。
- 处置：coordinator follow-up 确认 §5 是必需仓库流程记录，并授权补齐；已新增 `.scratch/task-claim-thread-routing/map.md`，记录 Task #9 决定及 ticket / PR #189 链接。此 finding 已处理，ticket 保持 resolved。

**Spec**

- 初审发现 event-only fallback 在 drain 仍含未消费锚点且创建事件不相邻时仍会认领。处置：新增红绿回归；fallback 仅在 drain 没有开放任务锚点时进入。
- 后续复核发现一个已消费任务的事件可能越过 drain 中另一个可见开放任务锚点。处置：event-only 路径要求 `anchoredTasks.length === 0`；新增可见歧义锚点回归并验证未认领。
- 初审指出 Task #9 Answer 尚未追加；本节补齐根因、红绿证据、改动文件、双轴发现与处置以及 PR 号。
- 最终 diff 复核：`findings: []`，`overall_correctness: correct`；未发现行为缺口或范围外改动。

**PR**

- [PR #189：忽略自有历史 drain 消息后自动认领任务](https://github.com/whutlichao/worksplice/pull/189)。

### 协调方后续：§5 Decisions-so-far 记录

- Coordinator 确认 `docs/engineering-standards.md` §5 要求每个 ticket 的结论写入 `.scratch/<effort>/map.md`，并指示本票补齐该仓库记录。
- 已新增 `.scratch/task-claim-thread-routing/map.md`，记录忽略接收 agent 自己的历史 drain 消息、event-only 路径保留“drain 中无开放任务锚点”约束，以及 ticket / PR #189 链接；此前 Standards finding 已处理，Status 保持 `resolved`。
- 补充复验：三条聚焦回归 `3 passed, 0 failed`；完整 `loop-tasks.test.mjs` `30 passed, 0 failed`；typecheck 通过；lint 为 0 errors、1 条既有 `hooks/useI18n.tsx:61` warning。

**Standards（map 补齐后的最终 diff review）**

- 报告：`findings: 3`，`overall_correctness: incorrect`。
- `docs/engineering-standards.md` §2.2 要求 `npm test` 全量门禁；本票明确要求不跑全仓全量测试，因此按任务范围跳过，已运行完整受影响文件 `node --test lib/agent-loop/loop-tasks.test.mjs`（30 passed）。不以另一 base 的全量数字替代，也不扩跑全量。
- §5 的 retained agent-loop dev-server finding 已处理：`loop.ts` 最后相关提交为 `2026-10-19T22:54:52+08:00`；随后以 `WORKSPLICE_DATA_DIR=/tmp/worksplice-task9-dev-smoke npm run dev` 启动，进程开始时间 `2026-10-19 23:24:14 +0800`，首页 HTTP 200、HTML 26,552 bytes；使用隔离目录，随后停止进程并确认端口无 listener。
- 可能的 Duplicated Code（`loop-tasks.test.mjs` 两条用例的首轮 fixture setup）：判定为非阻塞判断项，保留独立 setup。两用例分别验证锚点 + 创建 event / event-only 成功路由与可见未消费锚点 + 非相邻 Owner event 的拒绝顺序；抽取共享 helper 会隐藏各自的消息时序。

**Spec（map 补齐后的最终 diff review）**

- 报告：`findings: []`，`overall_correctness: correct`。确认自有历史 drain 消息过滤、两条允许路由、可见未消费锚点 guard、既有 claim/yield 保护及 Answer/map 收口符合要求。
