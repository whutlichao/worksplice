# 07 — 任务板

**What to build:** 任务闭环：三种创建途径（右键顶层消息 Convert to Task / 发送时勾 As Task / Tasks tab Create Task，thread 内消息不可转）；任务 = 消息 + 元数据（message_id 锚点、channel 内递增 number、status、owner）；claim/unclaim 与 updateStatus 状态机（todo → in_progress → in_review → done / closed，reopen 回池，done 可 reopen）；并发保护——claim/updateStatus 均受 freshness-hold 保护；agent-loop 自动认领（收到需行动的消息先 claim 再开工，**claim 失败就让路**）；互审约定（完成者置 in_review，另一 agent 或人审查后置 done，"构建者不验证"）；Tasks tab 按状态分组视图，任务 thread 承载全部进展、board 只显示状态。演示：建任务 → agent 自动认领完成 → in_review → 人批准 → done（spec §3.7、§5.7 tasks 路由组）。

**Blocked by:** 04, 05, 06

**Status:** resolved（2026-10-23）

- [x] 三种创建途径可用；thread 内消息不可转任务
- [x] 状态机只允许合法转移；number 按 channel 内递增
- [x] claim 并发保护：同时认领仅一人成功；agent 认领失败自动让路（unclaim 释放回池）
- [x] 自动认领 + 互审闭环：agent 完成置 in_review，审查者批准置 done
- [x] Tasks tab 按状态分组正确；进展只出现在任务 thread

## Answer

**结论**：完成（2026-10-23 复核；本票为只读审计，未改源码）。

**证据**：
- 三种创建途径：右键 Convert to Task `components/ChannelView.tsx:896`；发送时勾 As Task `ChannelView.tsx:1966-1983`、`:3014-3026`；Tasks tab Create Task `ChannelView.tsx:1830`、`:3159`。三者收敛到 `lib/domain/collab/tasks.ts:251` `createTask`；thread 内消息不可转 `tasks.ts:255`，测试 `lib/domain/collab/tasks.test.mjs:99`。
- 状态机：`tasks.ts:26-27` 状态定义、`:145-170` `TRANSITIONS` 唯一裁决表、`:340` `updateTaskStatus`；非法转移测试 `tasks.test.mjs:626`。
- 原子编号：`tasks.ts:263-274` 事务内 `nextTaskNumber` + 二次查重；测试 `tasks.test.mjs:70`（按 channel 递增）、`:86`（跨 channel 重置）。
- claim 并发：`tasks.ts:291` `claimTask`；冲突/held 测试 `tasks.test.mjs:154`、`:179`；agent 失败让路由 `loop.ts:943` `MAX_TASK_CLAIM_RETRIES` + `loop-tasks.test.mjs` 覆盖。
- 互审：`tasks.ts:121-170` 授权表（in_review → done 需非 owner 审者）；测试 `tasks.test.mjs:257`（builder 不能自审）、`:292`（reject 回 in_progress）。
- 分组与 thread：`ChannelView.tsx:1537-1542` 按 `TASK_STATUS_ORDER` 分组；任务 thread 承载进展（`tasks.ts:419` `listChannelTasks`）。

**偏差**：无。

**验证方式**：只读审计（未改源码），核对上述实现与测试文件。本票零源码改动，故未跑 npm test / tsc / lint。
