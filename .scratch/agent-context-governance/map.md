# Agent 长期使用中的上下文膨胀治理

## Destination

形成一份基于仓库实现和项目文档的现状与缺口报告，覆盖 Worksplice 协作成员 agent 与 Pi coding session。若发现关键缺口，附上在原始记录可追溯、可检索前提下减少活动上下文 token 的建议方向；本 effort 不实施改造。

## Notes

- 范围同时覆盖协作成员 agent（agent-loop）和 Pi coding session；两条路径分别审计，不混为一种会话。
- “记忆完整”按已确认的目标解释：原始消息/session 记录完整保留且可追溯检索；活动上下文只携带相关摘要与近期内容，需要时回查原文。
- 先建立当前 token/成本基线，并同时检查事实召回与任务质量；数字目标留待基线出来后制定。
- 持续区分活动上下文、原始会话记录和持久记忆，术语见仓库根目录 `GLOSSARY.md`。
- 适用技能：`research`（事实审计）、`grilling` 与 `domain-modeling`（后续决策）、必要时 `codebase-design`（方案设计）。

## 阶段二 · 实施规划

目的：把已决方向转成可实施规格（`spec.md`），把遗留雾区转成决策票；本阶段不实施改造，实施另起 effort；入口 `issues/04-decide-archive-and-retrieval.md`。

## Decisions so far

- [审计 agent 与 coding session 的上下文保留和成本机制](./issues/01-audit-context-retention.md)：两条路径都有 Pi session/compact，但 agent-loop 旧轮仍累积且无轮级 token 计量；`MEMORY.md` 靠提示约定；reset/delete 可能移除原始记录，且共享 cwd 有误删风险。证据见票据答案和所链研究报告。
- [明确重置与删除对原始会话记忆的保留语义](./issues/03-decide-reset-retention-contract.md)：Reset 清空活动状态而保留可检索原始记录；Full Reset 保留稳定记忆；共享目录只清理可确认归属的 session；删除 agent 清除私有记忆/归档但保留协作历史。
- [决定上下文治理报告的建议方向](./issues/02-decide-recommendation-direction.md)：采纳两条路径分别治理的非破坏性分层方向；先建各自成本基线，再以召回与任务质量验证，暂不锁定阈值或实现。
- [决定归档、索引与检索的实施方案（含基线与防丢失验证）](./issues/04-decide-archive-and-retrieval.md)：归档取「消息面读取层契约＋session 原件落数据目录并索引」、备份口径统一为数据目录整体；检索沿用既有服务层入口与频道可见面、不注册新工具；agent-loop 走 compact＋应用层有界注入；基线与防丢失验证先用合成数据做机制层，真实 provider 评测另起 effort。
- [产出上下文治理实现规格](./issues/05-spec-implementation-plan.md)：把票 04 的六点裁决与 pre-study 证据合成为可实施 `spec.md`——分路径非破坏分层、归档副本＋索引读取面、检索权限沿用 channel membership、agent-loop 有界注入（机制与预算留实现期按基线定）、基线与防丢失验证两层通过条件；实施票由下一轮 to-tickets 产出。

## Not yet specified

- 归档的具体存储、索引、检索权限和与 compact 摘要的协作方式尚未指定；整体建议方向的决策可能将其中部分拆成后续票。
- 在建立当前基线后，成本、关键事实召回和任务质量的具体数值目标与安全测试场景才能进一步确定。

<!-- 地图闭合：phase-1 收口——票 01/02/03 均已 resolved（审计、重置保留语义、建议方向）；四项遗留雾区（归档存储、索引、检索权限与 compact 协作、基线后的数值目标）移交阶段二实施规划，阶段二完成后由另起 effort 推进实施。阶段二产物位于本目录：`spec.md`、`issues/04-decide-archive-and-retrieval.md`、`issues/05-spec-implementation-plan.md`（由同轮并列 worker 创建，合并顺序以 PR 为准）。 -->

## Out of scope

- 本 effort 不修改运行时代码或会话格式，不删除/重写原始会话记录，也不部署上下文治理方案；实现与上线验证应在采纳建议后另开 effort。
