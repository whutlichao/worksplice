# 04 — 将会话补拉移出启动关键路径并按 target 隔离

Type: task
Status: resolved
Blocked by: None (can start immediately)
Spec: ../spec.md

**What to build:** Worksplice 启动时会话补拉不再同步占住主事件循环；补拉期间到达的唤醒仍按 agent/target 安全排队，单个 target 的可恢复故障不会阻止其他就绪 target 前进。

## Acceptance criteria

- [x] 启动先安排有界、可取消的补拉工作，再让 driver 与 reminder cron 可用；补拉以有限工作单元执行并定期让出主事件循环，停止 loop 会取消后续批次。
- [x] 同一 agent/target 的 wake 在补拉成功或所有权门禁明确拒绝后才放行；真实 ENOENT 沿用 missing-file no-op：不补写、不推进游标并放行对应 wake。
- [x] EACCES 与其他 stat/read/scan/write I/O 错误不伪装成缺失或所有权拒绝：对应键保持 pending、不推进游标、记录可观察原因并可重试。有限次重试耗尽后只隔离该键，直至显式重试或进程重启；其他就绪 target 仍可运行。
- [x] 保持同一 agent 同时最多一个 runAgentRound；一个 target 被补拉阻塞或隔离时，同一 agent 的其他就绪 target 可依序运行，不得并发执行 round。
- [x] 保持 ADR-0003/0004 所有权门禁、跨作者内容去重、每 marker 轮只取最后一条 assistant 文本、revision 草稿丢弃、同作者幂等及 marker seq 游标收口语义。
- [x] 以现有 backfill/driver 测试接缝覆盖成功、所有权拒绝、ENOENT、可恢复错误、重试、隔离、取消及不同 target 的推进；错误注入不得触碰真实用户数据。
- [x] 用固定的合成/可重放数据覆盖 agent 数、文件数/大小与 marker 轮数；基线和候选各预热后至少采集 30 个样本，记录补拉阶段耗时及从 start 到 driver/cron 可用的时间，并归档原始样本、中位数、P90 和离散程度。
- [x] 候选在预先记录的目标规模上有稳定且超过噪声的改善才作为优化保留；若没有，保持现有行为并记录 no-go 及测量证据，不得宣称性能收益。

## Answer

### 实施

- `lib/agent-loop/loop.ts` 将补拉扫描放到后续事件循环轮次，并按有界批次让出；driver 与 reminder cron 不等待文件 I/O 完成。
- 按 agent/target 保留 wake 屏障；ENOENT 仍按 missing-file no-op 处理。其他扫描或写入 I/O 错误有限重试，耗尽后仅隔离对应 target，支持显式重试；同一 agent 的 round 仍串行，不同 target 可继续推进。
- 保持 ADR-0003/0004 的所有权拒绝、跨作者内容去重、marker 轮最终 assistant 文本、revision 草稿丢弃、幂等写入与 seq 游标收口语义。
- 独立评审发现 stop/start 竞态：旧扫描在中止后可能清除新扫描的屏障。已用 AbortController 身份检查限制共享状态清理，并新增 stop/start + pending-read 回归测试；测试先红（旧实现提前 prompt），修复后绿。代码注释也按工程规范改为简体中文。

### 验证

- `node --test --test-timeout=60000 lib/agent-loop/backfill.test.mjs lib/agent-loop/driver.test.mjs`：40 通过、0 失败。
- `npm test`：1357 通过、0 失败。
- `node_modules/.bin/tsc --noEmit`：通过；base 同样通过。
- `npm run lint`：0 errors、1 warning；与 base 相同，为 `hooks/useI18n.tsx:61` 的既有 `locale` 依赖警告。
- `git diff --check`：通过。

### 合成基准

基线为 `01369c574c6284dee6d6db54b3685c42451aa0de`。仅使用合成 JSONL、独立临时 SQLite 数据库与 workspace，没有读取真实用户 session 或数据库。每个 workload 两侧各 1 次预热 + 30 个样本；另有每侧 1 次预热 + 30 个屏障样本。原始数据、复现脚本、预登记计划、汇总与验证日志归档于 `evidence/04-background-session-backfill/`。

预登记的 medium 规模（8 agents/files、256 KiB/file、64 marker rounds/file）：start-ready 中位数/P90 从 61.432/65.233 ms 降至 0.113/0.128 ms；中位改善 61.319 ms（99.8%），paired-bootstrap 95% CI 为 [60.794, 62.062] ms，高于 2.643 ms 的噪声阈值，满足保留条件。该结论仅针对启动就绪时间；候选完整恢复中位数为 64.050 ms，略慢于基线扫描中位数 61.777 ms，不宣称端到端恢复更快。环境：macOS、Node v25.0.0、Apple M1 Pro。数据和统计见 `evidence/04-background-session-backfill/benchmark-summary.md` 与 `benchmark-summary.json`。

### 双轴评审

首次 standards review 指出新增英文注释（P2），首次 spec review 指出旧扫描清理新屏障的竞态（P1）；以上均已修正并补回归测试。修正后的独立复审在 Standards 与 Spec 两轴均无新发现，均给出 OK / 可合并结论。
