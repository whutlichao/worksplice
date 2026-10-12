# agent-loop 有界注入

Type: task
Status: pending
Blocked by: 06, 07

## Question

在 agent-loop 应用层把每轮注入形状钉死为有界：超界的历史内容不进入注入，但可经既有 `search`
回查，回交维持既有观察相形状。

## Scope

- 目标：落实 [`spec.md`](../spec.md) 的 B5（每轮注入有界）与 B8（回查协作维持既有形状约束）；
  对应裁决 D4（agent-loop 组合：compact 管会话长尾＋应用层钉死注入形状；阈值主权维持 SDK 默认＋
  用户 settings，产品不接管）与 D5（机制与预算数值留实现期按基线确定，规格不锁定单一机制）。
- 改动面：每轮 prompt 构建路径（[`loop.ts`](../../../lib/agent-loop/loop.ts)）——现状唯一的注入侧
  封顶是观察相每轮 1 次（[`loop.ts:498-499`](../../../lib/agent-loop/loop.ts#L498-L499)），inbox
  drain 无条数上限（[`inbox.ts:19-20`](../../../lib/domain/collab/inbox.ts#L19-L20)）；总预算必须
  覆盖整轮注入形状（历史轮、inbox、任务/频道语境），而非只封观察相。
- 不变量：超界历史不删除、不重写，仍留在原始会话记录中（经票 06/07 的归档＋检索面可达）；
  不接管 compact 阈值、应用层不做摘要生成；无应用层自动注入；不注册新工具、不改权限模型（B9）；
  回查入口沿用 `search` op 与既有观察相
  （[`member-ops.ts:575-586`](../../../lib/agent-loop/member-ops.ts#L575-L586)）。

## Acceptance

- B5：合成会话下逐轮 prompt 形状 ≤ 应用层定义的恒定上界（上界的度量与预算数值属本票实现选择，
  spec 不锁定唯一机制，但必须是代码保证、可断言的）；早期轮埋入的关键事实不在注入中，却能经
  `search` 命中并经观察相交回。
- B8：一轮最多一次观察相；命中以观察相文本回交；无应用层自动注入、无新工具。
- 证据形式：fake session 每轮 prompt 捕获缝（[`loop.test.mjs`](../../../lib/agent-loop/loop.test.mjs)）
  与 `search` op → 观察相缝（[`loop-ops.test.mjs`](../../../lib/agent-loop/loop-ops.test.mjs)）扩展断言；
  数值目标（阈值）不在本票设定，由票 10 按基线产出后在实施票内确定。
- 项目文件有改动时：解析并使用本机 pr skill 编写 PR body，推分支创建 PR，PR 号及 body 路径回填
  Answer；最后发送并核实 worker_done 回执。
