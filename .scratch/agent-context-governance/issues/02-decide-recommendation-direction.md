# 决定上下文治理报告的建议方向

Type: grilling
Status: resolved
Blocked by: 01, 03

## Question

在完成“审计 agent 与 coding session 的上下文保留和成本机制”后，基于其证据决定报告应推荐的最小治理方向：如何在保留原始会话/消息记录、支持追溯检索的前提下，减少长期运行时每轮送入模型的 token，并用成本基线、关键事实召回和任务质量验证不会丢失重要记忆？

只决定报告中的方向与关键取舍，不扩写成实现计划；若审计发现现有机制已满足目标，也应明确说明无需新增方案的理由。

## Answer

用户接受“两条路径分别治理，采用原始记录—活动上下文—持久记忆分层”的报告建议：原始消息/session 记录作为可追溯、可检索的来源；活动上下文保持有界，按需从原始记录回查；持久记忆与对话记录分开。coding session 优先沿用 Pi compact；agent-loop 是主要治理缺口，报告方向为有界活动上下文与相关内容按需召回。

建议先分别建立两条路径的 token/cost 基线，再以关键事实召回和任务质量检查验证记忆保真；数值阈值留待基线后确定，不指定索引或摘要实现。Reset/delete 保留语义仅作为报告方向，不得表述为当前代码已保证。用户要求只记录方向与关键取舍，不扩展成实现计划。

依据审计票 [审计 agent 与 coding session 的上下文保留和成本机制](./01-audit-context-retention.md)：两条路径均有持久 Pi session 与 compact，compact 保留原始 entries，但 reset/delete 路径仍可能删除 session 文件；agent-loop 旧轮会累积且无整轮 token 上限，无轮级 token/cost 记录；`MEMORY.md` 仅靠提示约定，缺少自动提取、校验和检索；当前无关键事实召回率或任务质量评估集。重置语义依 [明确重置与删除对原始会话记忆的保留语义](./03-decide-reset-retention-contract.md)，但该票明确其不是当前代码实现保证。具体审计证据见[研究报告](https://github.com/whutlichao/worksplice/blob/research/agent-context-audit/.scratch/agent-context-governance/research/context-audit.md)。

本票未产生新的实现决策或子票；地图中关于归档存储、索引、检索权限、与 compact 协作方式及基线后的目标值仍保留为待明确事项。

## Comments

- **Q → A（人定）**：问是否接受分路径、非破坏性分层治理建议，并询问边界。用户答：“接受推荐方向。两条路径分别治理，采用‘原始记录—活动上下文—持久记忆’分层；保留可追溯原始记录，活动上下文有界并按需回查。coding session 优先沿用 Pi compact；agent-loop 是主要治理缺口，朝有界活动上下文与相关内容按需召回收敛。先分别建立 token/cost 基线，再用关键事实召回和任务质量检查验证；暂不设数值阈值、不指定索引或摘要实现。重置/删除保留语义记录为报告方向，不得声称代码已保证。只记录方向和关键取舍，不扩成实现计划。”
