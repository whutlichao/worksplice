# 任务回复路由：最新创建事件决定线程投递

Type: task
Status: in_progress
Spec: [spec.md](../spec.md)

## What to build

修复频道轮次的任务回复路由：`claimTaskFromReply` 改为只认本轮最新一条其他作者消息；匹配开放任务 N 的 Owner 创建事件必须把回复投到 N 的锚点线程。任务已有 owner 时以参与者身份回线程；无 owner 时先 claim，held 时同轮按 `roomSeq` 重试（上限 3 次），耗尽才让路且游标停在创建事件之前，并在同一进程内记住该 agent+任务，下一轮没有更新的任务信号时优先收敛。同步改写 `docs/spec.md` §3.7 自动认领行，并补齐 R1 / R2 / R3 / R3b / D / F 回归。

## Acceptance

- [ ] 基线 `21878b9` 隔离 worktree 取得红证据（R1 / R2 / R3 / R3b 及受影响的旧用例），实现后同命令转绿。
- [ ] R1：混合未读 + 任务已被他人持有 → 回复 target = 锚点 id，频道顶层 0 条，owner / status 不变。
- [ ] R2：混合未读 + 无 owner → claim 成功，owner = 本 agent，回复 target = 锚点 id，频道顶层 0 条。
- [ ] R3：claim held → 同轮重试后 claim 成功，回复落锚点线程，频道顶层 0 条，任务不留在 todo。
- [ ] R3b：重试耗尽 → 让路，创建事件保持未消费（游标 = event.seq - 1）。
- [ ] R3c：held 耗尽后下一轮普通消息 → pending 优先 claim 成功、回复落线程、频道顶层 0 条；历史 todo 任务不被认领；成功后 pending 清除。
- [ ] R3d：最新创建事件指向 closed 任务 → 不落到 pending，普通答复回频道。
- [ ] R4：崩溃窗口（最新消息是自己的频道回复、但本轮仍有创建事件）→ 不跳过，claim 成功并回线程。
- [ ] D：自己持有任务 → 回线程；F：最新一条是普通消息 → 回频道，历史开放任务不被认领。
- [ ] `node --test lib/agent-loop/loop-tasks.test.mjs` 全绿；`npm run typecheck`；`npm run lint` 0 error；`npm test` 全量记录 pass/fail 与基线来源。
- [ ] Standards + Spec 两份独立 code-review 报告写入 Answer，findings 逐条处置或说明不采纳。
- [ ] PR 用 `--body-file` 创建，PR 号与 body 路径回填 Answer；交付前 `git status --porcelain` 为空。

## Comments

- 2026-10-20：按 coordinator 的 ticket 正本路径创建 spec 与 issue；基线 `21878b9` 已用 `git worktree add --detach` 隔离，node_modules 软链到本 worktree 以保持依赖环境一致。
- 2026-10-20 双轴复核：首轮 Standards/Spec findings 已处置（更名 resolveTaskReplyRoute、deliverReply、claimFailureReason、pending 优先级、投递失败不 ack、closed 事件不落 pending、崩溃窗口早退放行）；新增 R3c/R3d/R4/E 回归。待最终独立复核与门禁数字回填。
- 2026-10-20 Q→A（held 耗尽后的收敛）：Spec C 要求事件保持未消费、供后续轮次重新收敛，但 A/F 只认本轮最新一条其他作者消息；若下一轮先到普通消息，仅停游标仍会重演 #10。Coordinator 裁决选 (b)：增加同进程 pending-claim 优先级，仅对 claim 重试耗尽且事件仍未消费的 agent+task 生效，不落 DB；成功后清除，done/closed 清除；F 的新轮不变；补 R3c 回归（下一轮普通消息仍 claim 成功、历史 todo 不被认领）。

## Answer

（待收敛后填充：diagnosing-bugs 假设与探测、红绿证据、门禁数字、改动文件、双轴 review、PR。）
