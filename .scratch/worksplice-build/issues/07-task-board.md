# 07 — 任务板

**What to build:** 任务闭环：三种创建途径（右键顶层消息 Convert to Task / 发送时勾 As Task / Tasks tab Create Task，thread 内消息不可转）；任务 = 消息 + 元数据（message_id 锚点、channel 内递增 number、status、owner）；claim/unclaim 与 updateStatus 状态机（todo → in_progress → in_review → done / closed，reopen 回池，done 可 reopen）；并发保护——claim/updateStatus 均受 freshness-hold 保护；agent-loop 自动认领（收到需行动的消息先 claim 再开工，**claim 失败就让路**）；互审约定（完成者置 in_review，另一 agent 或人审查后置 done，"构建者不验证"）；Tasks tab 按状态分组视图，任务 thread 承载全部进展、board 只显示状态。演示：建任务 → agent 自动认领完成 → in_review → 人批准 → done（spec §3.7、§5.7 tasks 路由组）。

**Blocked by:** 04, 05, 06

**Status:** ready-for-agent

- [ ] 三种创建途径可用；thread 内消息不可转任务
- [ ] 状态机只允许合法转移；number 按 channel 内递增
- [ ] claim 并发保护：同时认领仅一人成功；agent 认领失败自动让路（unclaim 释放回池）
- [ ] 自动认领 + 互审闭环：agent 完成置 in_review，审查者批准置 done
- [ ] Tasks tab 按状态分组正确；进展只出现在任务 thread
