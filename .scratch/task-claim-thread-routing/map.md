# 决策记录

## Decisions-so-far

### Task #9：忽略本 agent 自己的历史 drain 消息

- 决定：自动认领判断混合活动时排除接收 agent 自己的历史 drain 消息；其他作者的额外 incoming 消息仍阻止自动选择。
- event-only 匹配仅在 drain 中没有任何开放任务锚点时进入，避免可见锚点与已消费锚点事件并存时误认领。
- 结果：已实现并由隔离 SQLite 回归覆盖；Task #9 ticket 已解决。
- 追踪：[Task #9 ticket](issues/01-task-claim-and-thread-routing.md)，[PR #189](https://github.com/whutlichao/worksplice/pull/189)。
