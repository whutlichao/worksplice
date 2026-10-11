# 04 — 将会话补拉移出启动关键路径并按 target 隔离

Type: task
Status: ready-for-agent
Blocked by: None (can start immediately)
Spec: ../spec.md

**What to build:** Worksplice 启动时会话补拉不再同步占住主事件循环；补拉期间到达的唤醒仍按 agent/target 安全排队，单个 target 的可恢复故障不会阻止其他就绪 target 前进。

## Acceptance criteria

- [ ] 启动先安排有界、可取消的补拉工作，再让 driver 与 reminder cron 可用；补拉以有限工作单元执行并定期让出主事件循环，停止 loop 会取消后续批次。
- [ ] 同一 agent/target 的 wake 在补拉成功或所有权门禁明确拒绝后才放行；真实 ENOENT 沿用 missing-file no-op：不补写、不推进游标并放行对应 wake。
- [ ] EACCES 与其他 stat/read/scan/write I/O 错误不伪装成缺失或所有权拒绝：对应键保持 pending、不推进游标、记录可观察原因并可重试。有限次重试耗尽后只隔离该键，直至显式重试或进程重启；其他就绪 target 仍可运行。
- [ ] 保持同一 agent 同时最多一个 runAgentRound；一个 target 被补拉阻塞或隔离时，同一 agent 的其他就绪 target 可依序运行，不得并发执行 round。
- [ ] 保持 ADR-0003/0004 所有权门禁、跨作者内容去重、每 marker 轮只取最后一条 assistant 文本、revision 草稿丢弃、同作者幂等及 marker seq 游标收口语义。
- [ ] 以现有 backfill/driver 测试接缝覆盖成功、所有权拒绝、ENOENT、可恢复错误、重试、隔离、取消及不同 target 的推进；错误注入不得触碰真实用户数据。
- [ ] 用固定的合成/可重放数据覆盖 agent 数、文件数/大小与 marker 轮数；基线和候选各预热后至少采集 30 个样本，记录补拉阶段耗时及从 start 到 driver/cron 可用的时间，并归档原始样本、中位数、P90 和离散程度。
- [ ] 候选在预先记录的目标规模上有稳定且超过噪声的改善才作为优化保留；若没有，保持现有行为并记录 no-go 及测量证据，不得宣称性能收益。
