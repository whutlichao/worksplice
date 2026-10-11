# 04: 仅在精确归属的 Pi transcript assistant 消息显示 agent 头像

**What to build:** 在票 05 提供的 Agent 详情 transcript viewer 中，仅为精确归属该 agent 的 assistant 消息显示 agent 当前身份色的 Avatar；不明确归属的 transcript 和非 assistant 消息继续保持普通呈现。本票只负责 viewer 内的 Avatar 呈现，不实现 transcript 读取、刷新或分页。

**Blocked by:** 03 — 让全部协作界面的 agent 身份头像同步使用当前头像色；05 — Agent 详情 transcript viewer 与精确会话读取/分页。

**Status:** ready-for-agent

- [ ] 在实际 transcript viewer 产品 markup 中，精确关联 agent 的当前分支 assistant 消息显示该 agent 当前的自动色或持久覆盖色 Avatar；历史消息也使用当前身份色。
- [ ] 只有 assistant 消息显示该 agent Avatar；user、tool、custom、compaction 等非 assistant 消息均不显示该 agent Avatar。
- [ ] human session 与未关联 agent 的 transcript 不新增 agent Avatar；同 cwd/workspace/project root、同 basename、分叉关系或文件名均不能使 transcript 获得 agent Avatar。
- [ ] 归属消费票 05 的公开 member-ID GET 契约：服务端只读取该成员当前 `pi_session_file` 并精确确定 session 归属。测试验证该公开契约，不为测试引入不必要的任意 path 参数。
- [ ] 头像色只影响身份 Avatar tile；选色或恢复自动色不写 Pi 文件或消息内容。
- [ ] 测试实际 transcript viewer markup 中 assistant/non-assistant、human/未关联 transcript 的 Avatar 差异，并验证 Avatar 使用当前成员色；本票不重复实现或验收 viewer 的取数、刷新、消息类型读取或分页行为。

## Comments

- 产品行为范围来自产品所有者在本次 coordinator interview 中已确认的共识；本票只细化 Avatar 专项，不重开 viewer 决策。
