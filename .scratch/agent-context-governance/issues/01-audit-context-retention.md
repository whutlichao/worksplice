# 审计 agent 与 coding session 的上下文保留和成本机制

Type: research
Status: resolved

## Question

基于仓库代码、配置、测试与项目文档，核实 Worksplice 协作成员 agent（agent-loop）和 Pi coding session 两条路径的现状，并给出可追溯证据：

- 每轮模型输入由哪些历史、系统提示、工具结果、频道/任务语境组成；有哪些裁剪、限长或重复注入机制？
- 自动与手动 compact 如何触发；compact 后活动上下文、持久会话文件和可回溯原文之间是什么关系？
- 协作 agent 的 `MEMORY.md` 如何创建、提示读取、更新、跨重置保留；是否存在自动提取、校验或按需搜索？
- 哪些 token/成本、context usage、compact 事件或历史数据已被记录/展示？是否能用现有代码与测试建立两条路径各自的基线，而不读取用户真实会话内容？
- 按本地图景列出现有缓解措施、覆盖不到的膨胀来源，以及“保留完整历史但降低活动上下文 token”这一目标下仍缺少的能力。

结论需区分“代码已保证”“SDK 默认行为”“仅靠提示约定”“尚无证据”，引用文件与符号；不要修改产品代码或读取 `~/.pi`、`~/.worksplice` 中的真实用户数据。

## Answer

- 两条路径都使用持久 Pi session 与 SDK compaction；compact 改变后续活动上下文投影，但原始 entries 保留。显式 reset/delete 仍会删除 session 文件，因此完整可追溯不是无条件保证。
- agent-loop 每轮虽主要注入增量消息，旧轮 prompt、回复和工具结果仍在同一活动分支累积直到 compact；inbox drain 无条数上限，且环境/任务语境会重复注入。单条消息有字符截断，但没有整轮 token 上限。
- `MEMORY.md` 是跨 session 的持久文件；代码只提示模型按需读取和更新，不保证自动读取、提取、校验或检索。
- Pi coding session 有当前 context usage 和 session 级 token/cost 统计；agent-loop 没有轮级 token/cost 记录。共享 cwd 的聚合可能混入其他 session；另有 reset 删除未被成员登记的人类 session 的风险。
- 可以用合成 session 与 fake runtime 建立机制基线；当前没有关键事实召回率或任务质量评估集/阈值。

完整证据与源码/官方文档引用见[研究报告](https://github.com/whutlichao/worksplice/blob/research/agent-context-audit/.scratch/agent-context-governance/research/context-audit.md)（`research/agent-context-audit`，commit `509a28c`，已推送，未开 PR）。本次未读取真实用户 session 数据，也未运行测试。

- 状态注记：研究报告仍位于 `research/agent-context-audit` 分支（`509a28c`），作为本票引用证据保留，不单独合并 main；该分支保持原样。
