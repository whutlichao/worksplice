# 06 — inbox + agent-loop + freshness-hold 闭环

**What to build:** 拉取式 inbox 与 agent 驱动闭环，spec 的核心切片：`consumed_seqs` 消费游标持久化；inbox 查询接口（getSince / drain / ack，按 seq 排序、保留 hasMore 语义、本地无分页上限）；wake hint（只含 seq/目标信息、不预组 prompt、不推送正文）；agent-loop 驱动层（wake → drain 组装 channel/thread 语境 + 新消息 + 相关任务状态 → decide 按 AX 原则给出"可用信息 + 明确 next action" → act 经服务层执行（回复/claim/updateStatus/reminder/react/pin，均带 freshness 校验）→ reply 收口推进游标）；agent 回复双写流补写 SQLite，启动时按 seq 补拉恢复崩溃（对每个 agent×target，SQLite 落后于 session jsonl 已投递 seq 则按序补写）；发送/claim/updateStatus 在同一事务内比较 `base_seq` 与 target 的 `max(seq)`，不等则回滚返回 **held** 与"期间发生了什么"摘要，agent 四选一（revise / send as-is / stay silent / --anyway 逃逸口）。演示：人在 channel 发消息 → agent 被唤醒、drain、回复落入消息流，状态点黄→绿（spec §3.3、§3.8、§5.3–5.5、§5.7 inbox 路由组）。

**Blocked by:** 04, 05

**Status:** ready-for-agent

- [ ] drain 按游标拉增量、ack 推进游标；重复 drain 不重不漏
- [ ] agent 回复经双写流落 SQLite 且 seq 正确；模拟崩溃后重启按 seq 补拉恢复
- [ ] freshness-hold：写稿期间房间变化 → 返回 held + 摘要；agent 四选一至少 revise 与 send as-is 两条路径可用，--anyway 为显式逃逸口
- [ ] wake hint 不含正文；agent-loop 每轮结束推进 consumed_seqs
- [ ] 状态点随 loop 活跃黄脉冲、回复落库回绿；会话错误置橙
