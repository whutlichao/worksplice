# 任务回复路由：最新创建事件决定线程投递

## 问题

`lib/agent-loop/loop.ts` 的 `claimTaskFromReply` 把「同轮更早的、其他作者的未读频道消息」当成竞争活动（`hasOtherActivity`），从而压制了本轮真正的任务信号（最新一条 Owner 创建事件）。实际故障：

- secretary-office #11：创建事件 seq 126 是 agent A 本轮最新消息，但同轮更早还有别的未读频道消息；A 的答复写进频道顶层（seq 127）。此后两个 agent 在频道与任务线程各聊一条线（频道 seq 127–138，线程 seq 3–12）。
- secretary-office #10：创建事件所在轮次被消费后无人认领，任务至今 todo、无 owner；两个 agent 的回复都落在频道顶层。旧实现在 claim held 分支 ack 到 baseSeq，把创建事件一并消费，后续轮次不再收敛到 claim。

## 目标行为

1. **频道目标的普通非空答复**（无显式 `task` op）以本轮**最新一条其他作者 incoming channel 消息**为唯一裁决信号。
2. 当该消息是 Owner 发布、格式匹配 `^Task #N created`、且与本频道开放任务 N 匹配的创建事件时，本轮最终回复必须投到任务 N 的锚点线程（`target_id = 任务锚点消息 id`）。同轮更早的其他作者未读消息（混合活动）不阻断。
3. 任务已有 owner（自己或他人，`in_progress` / `in_review`）：不发起 claim，直接把回复作为参与者写入锚点线程。
4. 任务无 owner：先 claim；成功则回复落线程。claim 因 freshness 返回 held 时，同一轮用 held 返回的 `roomSeq` 重试，上限 3 次；成功后回复线程。
5. 重试耗尽才让路，且让路轮不得把创建事件推进到已消费：游标停在创建事件之前；同一进程内记住该 agent+任务，下一轮没有更新的任务信号时优先 claim（已被他人持有则按参与者回线程；done/closed 清除）。进程重启后 pending 丢失可接受——事件仍在游标之后，无更新消息时最新一条仍是创建事件，可重新收敛。
6. 本 agent 自己持有该任务时同样回线程。
7. 所有自动路由路径的频道顶层新增回复数为 0；`reply` 之外的 op（react / pin 等）目标不变。
8. 反例保护：最新一条不是任务信号时，普通频道消息仍按现状回频道；不得因频道里存在开放任务就把普通回复改投线程；不得批量认领历史开放任务。
9. 保持 claim 互斥、freshness-hold、reopened 封锁与任务状态机语义；明确的 `task` op 仍按既有路径处理。

## 范围

- `lib/agent-loop/loop.ts`：自动路由裁决、claim 重试、参与者线程回复、让路游标。
- `lib/agent-loop/loop-tasks.test.mjs`：R1 / R2 / R3 / R3b / D / F 回归。
- `docs/spec.md` §3.7 自动认领行。
- 本目录 spec 与 issue。

不改 UI / REST 契约 / DB schema；不新增依赖；测试只用 `fs.mkdtempSync` 临时 DB。

## 验收

- 基线 `21878b9` 的隔离 worktree 上先取红证据，实现后同命令转绿。
- R1 混合未读 + 他人持有 → 回复 target = 锚点 id，频道顶层 0 条，owner / status 不变。
- R2 混合未读 + 无 owner → claim 成功，owner = 本 agent，回复 target = 锚点 id，频道顶层 0 条。
- R3 claim held → 同轮重试后 claim 成功，回复落锚点线程，频道顶层 0 条，任务不留在 todo。
- R3b 重试耗尽 → 让路且创建事件保持未消费（游标 = event.seq - 1）。
- R3c held 耗尽后下一轮普通消息 → pending 优先 claim 成功、回复落线程、频道顶层 0 条；历史 todo 任务不被认领；成功后 pending 清除。
- R3d 最新创建事件指向 closed 任务 → 不落到 pending，普通答复回频道；pending 任务不被顺带认领。
- R4 崩溃窗口（最新消息是自己的频道回复、但本轮仍有创建事件）→ 不跳过，claim 成功并回线程。
- D 自己持有 → 回线程；F 最新一条普通消息 → 回频道且历史开放任务不被认领。
- `node --test lib/agent-loop/loop-tasks.test.mjs` 全绿；`npm run typecheck`；`npm run lint` 0 error；`npm test` 全量并记录与基线可比的数字。
- 双轴 code-review（Standards + Spec）两份独立报告写进 Answer，findings 逐条处置。
- push 分支并用 `--body-file` 创建 PR；交付前 `git status --porcelain` 为空。
