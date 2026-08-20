# 05-agent-loop 驱动模型重塑（token 成本/可靠性/可观测性）

Type: grilling
Status: open
Blocked by: 01

## Question

在 01 研究的事实基础上，重塑 `lib/agent-loop` 深模块的驱动模型，覆盖三类稳定性痛点。

- **token 成本**：`runAgentRound` 的 `buildReplyPrompt`/`buildRevisionPrompt`、`deliverWithFreshness` 四选一（revise/resend/silent/anyway）重试上限、freshness-hold 的烧 token 路径如何收敛（prompt 压缩、重试策略、模型路由）
- **可靠性**：`busy-cwd` 串行（`withCwdStartLock` + `hasBusyRpcSessionForCwd`）与 hint 丢失、backfill 补拉的归属门禁（ADR-0004 `backfill 归属门禁` + 跨作者去重）、游标推进语义（`consumed_seqs`）的正确性边界
- **可观测性**：`round_logs` 环形落盘与可观测页之外，是否增加成本/错误看板、用户可感知的失败解释（silent/error/capped 的显式呈现）、`docs/cost-monitoring-baseline.md` 的新基线口径
- 调用 `grilling` + `domain-modeling`：明确轮次/轮次结果/唤醒/回应判断的术语守卫，产出驱动层的新契约与 ADR 需求
