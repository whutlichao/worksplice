# 08 — reminders

**What to build:** 提醒闭环：app 内 cron 逐分钟轮询 reminders 表（status=scheduled 且 fire_at <= now）；到点投递系统消息到锚定 target + 唤醒作者本人（作者是 agent 走 agent-loop wake，是 human 走 UI 通知）；recurrence DSL（`every:15m` / `every:2h` / `every:1d` / `daily@09:00` / `weekly:mon,fri@09:00`，相对时间用 delay 语义由服务端算绝对时间、时区安全）；recurrence 到期后按 DSL 计算下一次 fire_at，cancel 后不再触发；管理操作 schedule / list / snooze / update / cancel / log（生命周期事件流）；UI 提供对消息/thread 设置提醒的入口。演示：every:1m 提醒触发、系统消息可见、agent 被唤醒（spec §3.9、§5.6、§5.7 reminders 路由组）。

**Blocked by:** 04, 06

**Status:** ready-for-agent

- [ ] DSL 各形式解析与下一次 fire_at 计算正确（含时区安全）
- [ ] 到点投递系统消息到锚定 target 并唤醒作者（agent 与 human 两条路径）
- [ ] snooze / update / cancel 生效；cancel 后不再触发；recurrence 到期自动续算
- [ ] log 记录完整生命周期事件（schedule/fire/snooze/update/cancel）
- [ ] UI 入口可设置/查看/取消提醒
