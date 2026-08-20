# 07-UI 信息架构简化原型

Type: prototype
Status: open
Blocked by:

## Question

以 prototype 提升讨论保真度：针对「UI 太像 raft.build、元素太复杂」的痛点，产出信息架构简化低保真原型。

- 对比现状 `ChannelView`/`ThreadPanel`/`AgentDetailPanel`/`WorkspaceSidebar` 一次呈现的概念数，提出「渐进披露」后的三栏新布局草图（保留三栏骨架，重排层级与空状态引导，术语向非专业用户友好）
- 覆盖关键路径 `describe → hand off → let it run → review` 在新架构下的走通演示（新用户首次创建 channel/agent、发消息、看任务板、回 thread）
- 产出为可预览的静态原型（`output/index.html` 或 `docs/` 下草图 + 交互说明），调用 `prototype` skill，链接作为本 ticket 资产；结论为「采用/改动/否决」及与秘书引导的联动是否纳入
