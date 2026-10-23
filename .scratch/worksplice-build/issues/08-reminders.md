# 08 — reminders

**What to build:** 提醒闭环：app 内 cron 逐分钟轮询 reminders 表（status=scheduled 且 fire_at <= now）；到点投递系统消息到锚定 target + 唤醒作者本人（作者是 agent 走 agent-loop wake，是 human 走 UI 通知）；recurrence DSL（`every:15m` / `every:2h` / `every:1d` / `daily@09:00` / `weekly:mon,fri@09:00`，相对时间用 delay 语义由服务端算绝对时间、时区安全）；recurrence 到期后按 DSL 计算下一次 fire_at，cancel 后不再触发；管理操作 schedule / list / snooze / update / cancel / log（生命周期事件流）；UI 提供对消息/thread 设置提醒的入口。演示：every:1m 提醒触发、系统消息可见、agent 被唤醒（spec §3.9、§5.6、§5.7 reminders 路由组）。

**Blocked by:** 04, 06

**Status:** resolved（2026-10-23）

- [x] DSL 各形式解析与下一次 fire_at 计算正确（含时区安全）
- [x] 到点投递系统消息到锚定 target 并唤醒作者（agent 与 human 两条路径）
- [x] snooze / update / cancel 生效；cancel 后不再触发；recurrence 到期自动续算
- [x] log 记录完整生命周期事件（schedule/fire/snooze/update/cancel）
- [x] UI 入口可设置/查看/取消提醒

## Answer

**结论**：完成（2026-10-23 复核；本票为只读审计，未改源码）。

**证据**：
- DSL：`lib/domain/collab/recurrence.ts:3-6` 支持 `every:N<unit>` / `daily@HH:MM` / `weekly:…@HH:MM`，`:86` `nextFireAt`（严格晚于 from，本地时区）；测试 `lib/domain/collab/recurrence.test.mjs:9`、`:79`、`:86`。
- 到点投递与唤醒：`lib/domain/collab/reminders.ts:263` `fireReminder`、`:339` `fireDueReminders`；系统消息 `wake:false` 只定向唤醒作者（agent → wake reason=reminder，human 不 wake），测试 `reminders.test.mjs:334`、`:419`。
- 管理操作：`reminders.ts:181` `snoozeReminder`、`:198` `updateReminder`、`:236` `cancelReminder`；recurrence 续算 `:263` 内 reschedule；测试 `reminders.test.mjs:225`、`:273`、`:312`、`:398`。
- log：`reminders.ts:247` `getReminderLog`；生命周期事件断言见 `reminders.test.mjs:74`（schedule）、`:225`（snooze）、`:273`（update）、`:312`（cancel）。
- cron：`lib/agent-loop/loop.ts:3195` `REMINDER_POLL_MS = 60_000`、`:3209` `startReminderCron`；测试 `lib/agent-loop/reminder-cron.test.mjs`。
- UI：`components/ChannelView.tsx:823-827`（消息设提醒）、`:3351`（频道设提醒）、`components/ReminderModal.tsx:109-118`（snooze/cancel 列表操作）。

**偏差**：无。

**验证方式**：只读审计（未改源码），核对上述实现与测试文件。本票零源码改动，故未跑 npm test / tsc / lint。
