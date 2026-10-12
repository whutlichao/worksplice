# 归档副本落盘与索引

Type: task
Status: pending

## Question

在 Session Reset 与 Full Reset 路径上，把该 agent 的原始会话记录（session 原文，含 compact summary）
以归档副本落入数据目录并建立可检索索引，且迁移与重跑幂等——让重置不再等于丢失原始记录。

## Scope

- 目标：落实 [`spec.md`](../spec.md) 的 B1（归档落点与备份口径）、B2/B3（归档原文与 compact summary
  可经索引命中）、B6（重置保留原始记录，目标语义）；对应裁决 D1（A+C 分层：session 原件归档副本落
  数据目录、SQLite 侧只建索引、否决新增归档表）与 D4（summary 随归档原文索引覆盖、不单独建面）。
- 改动面：重置流程先落归档副作用、再收口删除范围（spec.md「迁移与兼容约束」）——现状重置删 session
  文件（[`agent-lifecycle.ts:33-61`](../../../lib/agent-lifecycle.ts#L33-L61)、
  [`agent-lifecycle.ts:73-94`](../../../lib/agent-lifecycle.ts#L73-L94)）；归档副本必须落在数据目录内
  （[`dirs.ts:12-40`](../../../lib/data/dirs.ts#L12-L40)），索引走既有 SQLite 面
  （[`schema.ts`](../../../lib/data/schema.ts)），新表/新列遵守 `SCHEMA_VERSION` 迁移链（单调递增、
  启动迁移幂等；当前版本与列形状以该文件为准，不复制数字）。
- 不变量：不删除、不重写既有原始记录；不改变协作消息格式与不可变触发器
  （[`schema.ts:148-169`](../../../lib/data/schema.ts#L148-L169)）；Pi 活动 session 维持不在备份清单；
  不注册新工具、不改权限模型（B9）；「消费面扩面」由票 07 收口，「删除/重置清理的归属收口」由票 09
  承担——本票只先落归档副作用。

## Acceptance

- B1：合成重置流程（Session Reset／Full Reset）后，归档副本存在于数据目录内、可解析出与重置前一致的
  会话条目；归档产物落在数据目录内 ⇒ 被「数据目录整体可复制」的备份口径覆盖（不改 docs）。
- B2/B3：同一关键事实在归档＋索引前不可经检索面命中；归档＋索引后可在索引层/服务层命中归档会话
  原文并可定位到具体归档会话；发生 compact 的归档会话中 summary 文本随归档原文进入同一索引，
  不建只索引 summary 的独立面。证据形式：合成 JSONL＋临时数据目录的服务层/存储层测试。
- B6：重置后可解析出重置前的全部会话条目，且活动上下文不再包含它们（目标语义）。
- 迁移与幂等：新表/新列随既有迁移链落地，重复执行幂等；扩展既有测试缝
  [`agent-lifecycle.test.mjs`](../../../lib/agent-lifecycle.test.mjs)（归档落点/清理缝），既有断言不因本票失效。
- 项目文件有改动时：解析并使用本机 pr skill 编写 PR body，推分支创建 PR，PR 号及 body 路径回填
  Answer；最后发送并核实 worker_done 回执。
