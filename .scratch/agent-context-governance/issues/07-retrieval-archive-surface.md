# 检索面扩到归档会话原文

Type: task
Status: pending
Blocked by: 06

## Question

在既有服务层检索入口上扩面，让归档会话原文（含 compact summary）与消息正文同源可检索，
成员面 `search` op 与人类搜索 UI 两个消费面同步生效，权限沿用 channel membership。

## Scope

- 目标：落实 [`spec.md`](../spec.md) 的 B2（归档原文可检索并可定位）、B3（summary 随同一检索面
  覆盖）、B4（检索权限沿用 channel membership）、B9（不新增工具、不改权限模型）；对应裁决 D2
  （检索入口沿用既有服务层与两个消费面扩面、模型主动声明触发、不引入应用层自动注入）与 D3
  （现状语义显式化：成员只检索所在频道，owner 面维持 Owner 语义）。
- 改动面：服务层入口 [`search.ts:24-51`](../../../lib/domain/collab/search.ts#L24-L51)（成员 scoping
  在 [`search.ts:36-51`](../../../lib/domain/collab/search.ts#L36-L51)）；两个消费面＝成员面 `search`
  op（[`member-ops.ts:575-586`](../../../lib/agent-loop/member-ops.ts#L575-L586)）与人类面
  `GET /api/search`（[`route.ts`](../../../app/api/search/route.ts)）。归档侧索引由票 06 提供。
- 不变量：不注册新工具（不重开
  [ADR-0013 决策一](../../../docs/adr/0013-http-corridor-caller-identity.md#L5)）；检索触发维持模型
  主动声明 op，不引入应用层自动注入；不新增 ACL 层、不按 workspace 分区、不做全库可检索；不改变
  协作消息不可变语义；回交形状（每轮最多一次观察相）由票 08 收口断言。

## Acceptance

- B2：经两个消费面（成员面 `search` op、人类搜索 UI）以归档内容中的关键事实发起检索，命中返回该
  归档会话原文并可定位到具体归档会话；同一事实在归档＋索引前不可经检索面命中。
- B3：同一检索入口能命中 summary 文本；不存在只索引 summary 的独立面。
- B4：成员面非成员频道命中数为 0（含归档面），结果与其频道可见面同构；owner 面维持 Owner 语义不变。
- B9：工具集锁定条目不变；`search` op 的声明式触发不变。
- 证据形式：扩展既有测试——[`search.test.mjs`](../../../lib/domain/collab/search.test.mjs)、
  [`search-route.test.mjs`](../../../lib/domain/collab/search-route.test.mjs)、
  [`member-ops.test.mjs`](../../../lib/agent-loop/member-ops.test.mjs)、
  [`loop-ops.test.mjs`](../../../lib/agent-loop/loop-ops.test.mjs)；含归档命中的权限断言。
- 项目文件有改动时：解析并使用本机 pr skill 编写 PR body，推分支创建 PR，PR 号及 body 路径回填
  Answer；最后发送并核实 worker_done 回执。
