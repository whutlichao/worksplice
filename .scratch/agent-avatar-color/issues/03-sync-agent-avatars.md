# 03: 让全部协作界面的 agent 身份头像同步使用当前头像色

**What to build:** agent 头像色选择后，协作界面中代表该 agent 身份的所有现有 Avatar 都使用其当前身份色；已存在的历史消息也随当前身份色呈现，而非保留旧色快照。

**Blocked by:** 02 — 持久化 agent 头像色并提供详情页即时选择。

**Status:** resolved

- [x] 侧栏、详情、频道与线程消息作者、任务 owner、成员选择、搜索命中作者及其他现有 agent 身份 Avatar 均呈现该 agent 当前的自动色或已保存色。
- [x] 更改头像色后，上述呈现面同步反映新色；频道与线程中的历史消息及新消息都按作者当前身份色呈现，消息作者和消息内容保持不变。
- [x] 人类头像始终使用 `av-4`；agent 头像只使用 `av-0…av-3`，且不同 agent 可呈现相同色格。
- [x] 头像色只改变身份 Avatar tile；status dot、任务状态、作者名、主题及其他非 Avatar 语义色保持原样。

## Answer

- 实现：`Avatar` 显式接收当前 `agentTint`，未设置时仍按 member ID 自动取色；人类优先固定 `av-4`。侧栏、详情、成员选择、消息、线程、任务 owner 与搜索结果均使用当前成员行色值。频道/线程/搜索共用 `indexCurrentMembersById` 覆盖嵌入消息中的旧成员行；成员刷新时 tint 改变会替换旧行，不新增头像色快照或持久字段。
- 覆盖：新增服务端 markup 测试断言自动色、显式色、历史与新消息更新、全部身份 Avatar 消费面、人类 `av-4`、共享色格及 status dot/任务状态/作者名/正文保持不变；`agent-reconcile.test.mjs` 覆盖成员 tint 刷新。
- Review — Standards：无文档标准违规、无最终 smell finding。独立初审指出重复的当前成员索引与重复的色值断言结构，已分别抽取共享索引函数与测试断言 helper 后复审通过。
- Review — Spec：无缺失要求、范围蔓延或行为错误；四项验收均通过。
- 验证：`npm test`（1381/1381）、`node_modules/.bin/tsc --noEmit` 通过；`npm run lint` 0 errors，只有未修改的 `hooks/useI18n.tsx:61` 既有 warning。
- PR：[#162](https://github.com/whutlichao/worksplice/pull/162)（base: `main`，未合并）。
