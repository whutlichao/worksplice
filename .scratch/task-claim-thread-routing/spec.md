# 任务创建后的认领与线程路由

## 问题

Owner 通过“发送消息并创建任务”在频道创建任务后，Task 可能保持未认领；多个 agent 可能把任务答复写到频道主 target，而不是任务锚点消息的线程。

## 目标行为

- 通过实际“发送消息并创建任务”入口创建任务后，收到任务锚点的合格 agent 若提交实质回复，应至少有一个成功认领，并把答复持久化到锚点线程。
- 多 agent 竞争时，认领失败者必须让路，不得把同一任务答复发成频道顶层消息。
- 普通非任务频道消息继续回复到频道 target。
- 保留 freshness hold、认领互斥、任务状态机与既有普通消息语义。

## 实施与验收

- 先建立快、确定的真实反馈循环：从“发送消息并创建任务”入口，经任务事件、wake、drain 与 agent-loop seam，断言 Task owner/status 以及回复持久化 `target_id`。
- 先记录当前实现的红测，再实现修复并记录红转绿及原始复现再次通过。
- 覆盖单 agent 成功认领、回复落锚点线程、竞争认领失败者无频道顶层任务答复、普通频道回复仍落频道 target；不得只测试手工传入 `task.op=claim`。
- 运行 `npm run test`、`node_modules/.bin/tsc --noEmit`、`npm run lint`。
- Answer 记录 diagnosing-bugs 的假设排序、预测与探测结果、根因、红绿证据、改动文件、Standards 与 Spec 两份独立 code review 报告，以及 PR 号。
- 票据 Status 收敛为 resolved；交付前工作区干净且无格式化噪声；推分支并创建 PR。

## 范围

仅限 agent-loop、协作任务实现与本票回归测试，以及本票 spec/issue 文档。若无法在代码 seam 确定性复现症状，应先升级协调，不添加猜测性启发或扩展范围。

## Task #9 follow-up：忽略本 agent 自己的历史 drain 消息

- 判断普通答复周围是否存在竞争或歧义活动时，只统计其他作者的 incoming 消息；本 agent 自己的旧消息即使因消费游标仍留在 drain 中，也不构成额外活动。
- 有效入口包括唯一开放任务锚点及其紧邻 Owner 创建事件，以及锚点已消费时唯一 Owner 创建事件；两者都可忽略本 agent 自己的旧 drain 消息并投递到任务锚点线程。
- 其他作者的额外活动、多任务、非相邻或不匹配事件、closed / reopened 封锁、他人已认领及竞争 claim 仍依既有规则阻止自动选择或让失败者让路；普通频道回复、显式 task op、freshness 与互斥语义保持不变。
- 回归使用 agent-loop 测试文件创建的隔离数据库，不访问默认数据目录。
