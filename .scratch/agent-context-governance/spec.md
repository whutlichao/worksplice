# 上下文治理实施规格（待撰写）

来源：[票 04](./issues/04-decide-archive-and-retrieval.md) 的决策 + [票 01](./issues/01-audit-context-retention.md) 审计报告（分支 `research/agent-context-audit` 的 `509a28c`，见[研究报告](https://github.com/whutlichao/worksplice/blob/research/agent-context-audit/.scratch/agent-context-governance/research/context-audit.md)）。
状态：本文件为蓝图占位，票 04 resolved 后按 to-spec 填充。

预计结构（五段）：

1. 现状缺口：两条路径上下文保留与成本的现状、缓解措施与未覆盖缺口（依据票 01 审计）。
2. 分层目标：原始会话记录、活动上下文、持久记忆三层各自的职责与边界。
3. 分路径方案：agent-loop 为主（有界活动上下文 + 按需回查）；coding session 沿用 Pi compact。
4. 基线与验证方法：token/cost 基线、关键事实召回与任务质量测量（只用合成数据）。
5. 迁移与兼容约束：reset/delete 保留语义按[票 03](./issues/03-decide-reset-retention-contract.md)；该语义为目标语义，非当前代码保证。

术语遵循仓库 `GLOSSARY.md`。
