# 删除 agent 的私有归档清理收口

Type: task
Status: pending
Blocked by: 06

## Question

按票 03 目标语义收口重置与删除路径的 session 清理归属判定：删除 agent 清其私有归档副本与私有持久
记忆、保留协作历史；共享 workspace 只清理可确认归属该 agent 的 session，归属不明或人类 session 保留。

## Scope

- 目标：落实 [`spec.md`](../spec.md) 的 B7（删除 agent 的私有归档清理，票 03 语义、目标语义）；
  对应裁决 D1 的「删除 agent 清私有归档副本、协作历史保留」与 D3 的隔离姿态。
- 改动面：删除身份路径 [`agent-lifecycle.ts:114-127`](../../../lib/agent-lifecycle.ts#L114-L127)；
  重置路径 [`agent-lifecycle.ts:53-61`](../../../lib/agent-lifecycle.ts#L53-L61)、
  [`agent-lifecycle.ts:73-94`](../../../lib/agent-lifecycle.ts#L73-L94)；共享 cwd 的清理判定现状按
  「未被任何成员引用」删除（[`agent-runtime.ts:324-335`](../../../lib/agent-runtime.ts#L324-L335)），
  归属不明/人类 session 尚未收口（票 01 审计与票 03 目标语义的差异点）；私有归档副本落点由票 06 建立。
- 不变量：不删协作历史（消息不可 UPDATE/DELETE，见
  [`schema.ts:148-169`](../../../lib/data/schema.ts#L148-L169) 的不可变触发器）；不删共享目录他人、
  归属不明或人类 session；不扩大删除范围；不改备份口径实现（统一为「数据目录整体可复制」，
  spec.md D1）；不改 docs。

## Acceptance

- B7：显式永久删除 agent 后，其私有归档副本与私有持久记忆被清除、对任何检索面不可见；协作消息仍在；
  共享 cwd 中他人/归属不明 session 未被删除。
- 重置路径同规则：归属不明或人类 session 不被重置清理误删；B6 的「重置只清活动上下文、原始记录
  保留可获取」不受损。
- 证据形式：扩展 [`agent-lifecycle.test.mjs`](../../../lib/agent-lifecycle.test.mjs) 的 fake
  runtime／数据目录缝断言（含共享 cwd 他人/归属不明 session 保留；现行「删该 cwd 全部 session」的
  断言按目标语义更新）。
- 项目文件有改动时：解析并使用本机 pr skill 编写 PR body，推分支创建 PR，PR 号及 body 路径回填
  Answer；最后发送并核实 worker_done 回执。
