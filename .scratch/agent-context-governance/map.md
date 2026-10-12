# Agent 长期使用中的上下文膨胀治理

## Destination

形成一份基于仓库实现和项目文档的现状与缺口报告，覆盖 Worksplice 协作成员 agent 与 Pi coding session。若发现关键缺口，附上在原始记录可追溯、可检索前提下减少活动上下文 token 的建议方向；本 effort 不实施改造。

## Notes

- 范围同时覆盖协作成员 agent（agent-loop）和 Pi coding session；两条路径分别审计，不混为一种会话。
- “记忆完整”按已确认的目标解释：原始消息/session 记录完整保留且可追溯检索；活动上下文只携带相关摘要与近期内容，需要时回查原文。
- 先建立当前 token/成本基线，并同时检查事实召回与任务质量；数字目标留待基线出来后制定。
- 持续区分活动上下文、原始会话记录和持久记忆，术语见仓库根目录 `GLOSSARY.md`。
- 适用技能：`research`（事实审计）、`grilling` 与 `domain-modeling`（后续决策）、必要时 `codebase-design`（方案设计）。

## Decisions so far

- [审计 agent 与 coding session 的上下文保留和成本机制](./issues/01-audit-context-retention.md)：两条路径都有 Pi session/compact，但 agent-loop 旧轮仍累积且无轮级 token 计量；`MEMORY.md` 靠提示约定；reset/delete 可能移除原始记录，且共享 cwd 有误删风险。证据见票据答案和所链研究报告。
- [明确重置与删除对原始会话记忆的保留语义](./issues/03-decide-reset-retention-contract.md)：Reset 清空活动状态而保留可检索原始记录；Full Reset 保留稳定记忆；共享目录只清理可确认归属的 session；删除 agent 清除私有记忆/归档但保留协作历史。
- [决定上下文治理报告的建议方向](./issues/02-decide-recommendation-direction.md)：采纳两条路径分别治理的非破坏性分层方向；先建各自成本基线，再以召回与任务质量验证，暂不锁定阈值或实现。

## Not yet specified

- 归档的具体存储、索引、检索权限和与 compact 摘要的协作方式尚未指定；整体建议方向的决策可能将其中部分拆成后续票。
- 在建立当前基线后，成本、关键事实召回和任务质量的具体数值目标与安全测试场景才能进一步确定。

## Out of scope

- 本 effort 不修改运行时代码或会话格式，不删除/重写原始会话记录，也不部署上下文治理方案；实现与上线验证应在采纳建议后另开 effort。
