# 任务回复路由：最新创建事件决定线程投递

Type: task
Status: resolved
Spec: [spec.md](../spec.md)

## What to build

修复频道轮次的任务回复路由：`claimTaskFromReply` 改为只认本轮最新一条其他作者消息；匹配开放任务 N 的 Owner 创建事件必须把回复投到 N 的锚点线程。任务已有 owner 时以参与者身份回线程；无 owner 时先 claim，held 时同轮按 `roomSeq` 重试（上限 3 次），耗尽才让路且游标停在创建事件之前，并在同一进程内记住该 agent+任务，下一轮没有更新的任务信号时优先收敛。同步改写 `docs/spec.md` §3.7 自动认领行，并补齐 R1 / R2 / R3 / R3b / D / F 回归。

## Acceptance

- [x] 基线 `21878b9` 隔离 worktree 取得红证据（R1 / R2 / R3 / R3b 及受影响的旧用例），实现后同命令转绿。
- [x] R1：混合未读 + 任务已被他人持有 → 回复 target = 锚点 id，频道顶层 0 条，owner / status 不变。
- [x] R2：混合未读 + 无 owner → claim 成功，owner = 本 agent，回复 target = 锚点 id，频道顶层 0 条。
- [x] R3：claim held → 同轮重试后 claim 成功，回复落锚点线程，频道顶层 0 条，任务不留在 todo。
- [x] R3b：重试耗尽 → 让路，创建事件保持未消费（游标 = event.seq - 1）。
- [x] R3c：held 耗尽后下一轮普通消息 → pending 优先 claim 成功、回复落线程、频道顶层 0 条；历史 todo 任务不被认领；成功后 pending 清除。
- [x] R3d：最新创建事件指向 closed 任务 → 不落到 pending，普通答复回频道。
- [x] R4：崩溃窗口（最新消息是自己的频道回复、但本轮仍有创建事件）→ 不跳过，claim 成功并回线程。
- [x] D：自己持有任务 → 回线程；F：最新一条是普通消息 → 回频道，历史开放任务不被认领。
- [x] `node --test lib/agent-loop/loop-tasks.test.mjs` 全绿；`npm run typecheck`；`npm run lint` 0 error；`npm test` 全量记录 pass/fail 与基线来源。
- [x] Standards + Spec 两份独立 code-review 报告写入 Answer，findings 逐条处置或说明不采纳。
- [x] PR 用 `--body-file` 创建，PR 号与 body 路径回填 Answer；交付前 `git status --porcelain` 为空。

## Comments

- 2026-10-20：按 coordinator 的 ticket 正本路径创建 spec 与 issue；基线 `21878b9` 已用 `git worktree add --detach` 隔离，node_modules 软链到本 worktree 以保持依赖环境一致。
- 2026-10-20 双轴复核：首轮 Standards/Spec findings 已处置（更名 resolveTaskReplyRoute、deliverReply、claimFailureReason、pending 优先级、投递失败不 ack、closed 事件不落 pending、崩溃窗口早退放行）；新增 R3c/R3d/R4/E 回归。待最终独立复核与门禁数字回填。
- 2026-10-20 Q→A（held 耗尽后的收敛）：Spec C 要求事件保持未消费、供后续轮次重新收敛，但 A/F 只认本轮最新一条其他作者消息；若下一轮先到普通消息，仅停游标仍会重演 #10。Coordinator 裁决选 (b)：增加同进程 pending-claim 优先级，仅对 claim 重试耗尽且事件仍未消费的 agent+task 生效，不落 DB；成功后清除，done/closed 清除；F 的新轮不变；补 R3c 回归（下一轮普通消息仍 claim 成功、历史 todo 不被认领）。

## Answer

### 根因（diagnosing-bugs）

1. **混合活动压制任务信号**：旧 `claimTaskFromReply` 用 `hasOtherActivity` 把「同轮更早的其他作者未读消息」当成竞争活动，只有 incoming 恰好是锚点 + 紧随创建事件（或只有一条事件）才路由。#11 的 base_seq=126 轮次因此把创建事件当成「额外活动」，回复写进频道顶层（seq 127）。
2. **held 让路消费创建事件**：旧 claim 失败分支无条件 `ack(baseSeq)`，把创建事件一起推进到已消费。#10 的轮次之后没有任何 wake 能再看到事件，任务永久 todo、无 owner。
3. **已持有任务没有参与者路径**：任务已由他人（或自己）持有时，普通答复没有「不 claim、直接回线程」的分支；显式 claim 冲突只能让路，回复丢失。
4. **线程投递失败仍收口**：回复投递返回 error / silent 时仍 ack 频道，事件被消费但回复没落线程。
5. **崩溃窗口早退抢先**：频道最新消息是本 agent 自己的回复时，`runAgentRound` 在路由裁决前直接 skipped + ack，若 drain 里还有未处理创建事件会被静默消费。

### 假设、预测与探测

| 排名 | 假设 | 可证伪预测 | 探测结果 |
|---|---|---|---|
| 1 | `hasOtherActivity` 压制任务信号（根因，确认） | 去掉该否决后，混合未读轮次的回复 target = 锚点 | 红测 R1/R2：target 实际为频道 id；绿后为锚点 id，频道顶层 0 条 |
| 2 | held 后 ack 到 baseSeq 消费事件（根因，确认） | 只停 event.seq-1 并在同轮重试 → R3 成功；R3b 游标 = event-1 | 红测 R3 为 `error`、R3b 为 `error`、R3c 游标 `5 !== 3`（事件被频道 ack 消费）；绿后 R3 replied、R3b/R3c 游标停在 event-1 |
| 3 | 已持有任务缺参与者回线程（根因，确认） | owner 非空不 claim、直接线程 → R1/D | 红测 target 为频道 id；绿后为锚点 id，owner/status 不变 |
| 4 | 线程投递失败仍消费事件（次要根因，确认） | 投递 error 时不推进频道游标 → E | 红测旧 seam 直接抛 `requires a task op`；绿后 error 且游标 0 |
| 5 | 崩溃窗口早退抢先（边界根因，确认） | 放行可路由创建事件 → R4 | 红测 `skipped`；绿后 `replied` 且回复落线程 |
| 6 | wake/drain 丢消息（排除） | prompt 看不到创建事件 | 红测 prompt 含创建事件与 Related open tasks，排除 |

### 红→绿证据

基线隔离 worktree：

```sh
git worktree add --detach /tmp/worksplice-red-21878b9 21878b9
ln -s <本 worktree>/node_modules /tmp/worksplice-red-21878b9/node_modules
cp lib/agent-loop/loop-tasks.test.mjs /tmp/worksplice-red-21878b9/lib/agent-loop/
cd /tmp/worksplice-red-21878b9 && node --test lib/agent-loop/loop-tasks.test.mjs
```

红（基线 21878b9 + 最终测试文件，原始输出摘要）：

```text
ℹ tests 40
ℹ pass 26
ℹ fail 14
R1  AssertionError: actual '<频道 id>', expected '<锚点 id>'
R2  AssertionError: actual '<频道 id>', expected '<锚点 id>'
R3  AssertionError: actual 'error', expected 'replied'
R3b AssertionError: actual 'error', expected 'yielded'
R3c AssertionError: 5 !== 3（频道 ack 已消费创建事件）
R3d AssertionError: actual 'error', expected 'yielded'
R4  AssertionError: actual 'skipped', expected 'replied'
D   AssertionError: actual '<频道 id>', expected '<锚点 id>'
E   Error: runTaskOperation requires a task op（旧代码没有 route seam）
```

F 反例在基线与实现后都通过（基线 26 pass 中包含 F），证明它锁的是「不得放宽」的既有行为。

绿（实现 worktree，同一命令）：

```text
node --test lib/agent-loop/loop-tasks.test.mjs
ℹ tests 40
ℹ pass 40
ℹ fail 0
```

覆盖：R1 混合未读 + 他人持有、R2 混合未读 + 无 owner、R3 held 同轮重试、R3b 重试耗尽/事件 pending、R3c pending 下一轮收敛且不认领历史 todo、R3d closed 事件不落 pending、R4 崩溃窗口、D 自己持有、E 投递失败不消费事件、F 反例。

### 门禁

- `node --test lib/agent-loop/loop-tasks.test.mjs`：40/40 pass，exit 0。
- `npm run typecheck`：exit 0，无输出。
- `npm run lint`：0 errors，1 个既有 warning `hooks/useI18n.tsx:61`（`react-hooks/exhaustive-deps`，非本票引入）。
- `npm test`：1529 tests / 1528 pass / 1 fail。唯一失败是既有的 `lib/model-listing.test.mjs`「lite path returns a working runtime without loading extensions」（本机 models 配置导致，与代码无关）。
- 基线来源：21878b9 隔离 worktree 上实现前运行 `npm test`，1519 tests / 1518 pass / 1 fail（同一 `model-listing` 失败）；目标测试文件当时 30/30。本次新增 10 条测试（30→40），全量 1519+10=1529。
- `git status --porcelain`：交付前为空。

### 改动文件

- `lib/agent-loop/loop.ts`：`resolveTaskReplyRoute`（原 `claimTaskFromReply`）、held 同轮重试、参与者线程回复、pending-claim 优先级、投递失败不 ack、崩溃窗口放行、`claimFailureReason`/`deliverReply` 收敛重复。
- `lib/agent-loop/loop-tasks.test.mjs`：R1/R2/R3/R3b/R3c/R3d/R4/D/E/F 回归，更新与新语义冲突的旧用例（非相邻事件、多事件、已持有、混合输入、端到端双 agent）。
- `docs/spec.md` §3.7 自动认领行：改为「最新一条裁决 + 持有者参与者回线程 + held 同轮重试 + 耗尽 pending + done/closed 不路由 + F 反例」。
- `.scratch/task-thread-reply-routing/spec.md`、`.scratch/task-thread-reply-routing/issues/01-task-thread-reply-routing.md`：票据正本与 Answer。

### 双轴 code review

实际执行 `/Users/apple/.codebuddy/skills/code-review`：固定点 `21878b9`，两轮独立子代理（首轮 + 最终复核），Standards 与 Spec 分开出报告。

#### Standards（最终独立复核）

> 结论：最终 diff 无阻断性 Standards 硬违规。`eslint` 无告警、`tsc` 通过、`loop-tasks` 40/40、工作区洁净。
> 非阻断项：① `route!`/`taskOp!` 非空断言与 `TaskReplyRoute` 未导出（无 d.ts 产物，非硬违规；建议后续用判别联合收窄）；② 测试 `withChangingRoom` 仍 monkeypatch `db.maxSeq`（已 finally delete 还原；判断性）；③ `.scratch` Status 仍 in_progress（流程项，本 Answer 已收口 resolved）。
> `docs/spec.md` 自动认领条款与实现一致；CONTEXT.md / AGENTS.md 的旧表述不在本 diff 内，不计入本次判定。

处置：① 保留 `!`（守卫已保证非空；判别联合属过度改造），`TaskReplyRoute` 保持内部类型；② 保留测试注入手法（不新增生产 seam，避免 speculative generality）；③ 已改 resolved。首轮发现的命名/重复分派/op 命名/action 恒等返回均已修复（`resolveTaskReplyRoute`、`deliverReply`、`claimFailureReason`、`mode`）。

#### Spec（最终独立复核）

> 结论：未发现实质性 Spec 缺口，A–G 主路径均闭合；`loop-tasks` 40/40。
> A 取 `incoming.at(-1)`，早退前检查创建事件/pending；B/D owner 非空直接线程；C 无 owner 先 claim、held 按 roomSeq 重试上限 3；E 耗尽 ack 到 max(consumed, eventSeq-1) 并记 pending，投递 error/silent 不推进游标；F 最新非创建事件且无 pending 回频道，closed/不存在直接 return null；G 仅自动路由走线程，非 reply op 不进入 route；pending 仅 held 耗尽且事件未消费生效，成功/done/closed/已消费清除，多条按 eventSeq 降序。
> 非阻断：claim 冲突窗口内自己持有会 yield（单进程几乎不可达）；早退放行未校验事件任务状态；stale pending 可能一次性绕过早退。

处置：冲突窗口自己持有已改为按 D 回线程；早退改为只放行**可路由**创建事件（`hasRoutableTaskEvent`，done/closed 不算）；`hasPendingTaskClaim` 已校验 consumed/status。三项修复后 40/40 与全量 1528 pass 保持。首轮 Spec 的三项（held 收敛、投递失败 ack、prompt/route 集合口径）中，前两项已修，第三项**不采纳**：A/F 明确以「本轮最新一条其他作者消息」为唯一信号，用过滤后的 `effectiveIncoming` 会让更早的创建事件越过更新的普通消息，违反 F；prompt 过滤与路由不过滤是有意的不对称（最终 Spec 复核也认可可接受）。

### 越界与遗留

- **票据外文档冲突**：`CONTEXT.md` 的 rubric「他人任务线程…必须 ignore 不插话」与 `AGENTS.md` 的「held/conflict/非 owner → 让路」仍描述旧语义，与本票 B（他人持有 → 参与者回线程）不一致。本票文件范围只允许 `loop.ts` / `loop-tasks.test.mjs` / `docs/spec.md` / `.scratch` 票据，未越界修改；建议另开票据同步 CONTEXT.md / AGENTS.md。
- pending 为同进程 Map，进程重启丢失可接受（事件游标仍停在 event.seq-1，无更新消息时可重新收敛）；agent 删除时不会主动清理该 Map，量级为每 agent+task 一条，属于可接受的进程内状态。

### PR

创建后回填 PR 号与 body 路径。
