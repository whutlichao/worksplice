# 频道首席获得最小任务写面

> **部分被 ADR-0021 取代（#295）**：建任务工具仍按消息所属频道的生效首席授权；`CREATE_THEN_HANDOFF_RULE` 现只对当前全局首席注入，频道首席不再获得任务 handoff 提示。

**背景**：#270 / ADR-0019 已让任务创建事件与 handoff 跟随本频道的生效首席，但频道首席仍不能从**普通无点名消息**新建任务：`worksplice_task_create` 只注册在全局首席会话，且每次调用只认 `isSecretaryMember`。结果是频道首席读到「这件事得有人做」时，只能在回复里描述，不能把消息转成任务。用户决定「补这一半工具面」（#272）。

**决策**：

- **只补一个写面**：频道首席获得 `worksplice_task_create`，不获得三个 `worksplice_list_*` 读面，也不获得 `worksplice_channel_create` / `worksplice_agent_create` 管理员写面。`CHIEF_DOMAIN_TOOL_NAMES` 仍是六个名字；新增 `CHANNEL_CHIEF_TOOL_NAMES = ["worksplice_task_create"]`，两份常量都是注册面与激活面的唯一来源。
- **非对称工具面**：`resolveMemberToolPolicy` 从 `isChief` 改为 `chiefScope`（`global` / `channel` / `none`）。`global` 保持现有窄面（`read` + 六个领域工具，不并回扩展工具）；`channel` 返回空策略 `{}`，**不收窄**频道首席原有的普通工具面（内置 + 扩展）；额外工具由 `domainTools.surface === "channel"` 以 `defaultActive: true` 补入。全局首席与频道首席因此不是同一套工具面：前者是窄面，后者是「普通工具面 + task_create」。
- **按 surface 注册**：`chiefToolDefinitions` / `assertPolicyCoverage` 按 surface 的期望清单校验；global surface 仍注册六个定义（`defaultActive: false`，由 `CHIEF_TOOL_NAMES` 显式激活），channel surface 只注册 `worksplice_task_create`（`defaultActive: true`）。频道首席会话的注册表里不得出现三个读面与两个管理员写面。
- **task_create 的授权 = 消息所属频道的生效首席**：先判 actor 仍是任一频道的生效首席（全局或频道），不是任何首席则拒绝且不读消息；再解析消息所属频道，用 `isEffectiveChiefForChannel(channel.id, actorId)` 判该频道的授权。频道已有频道首席时，全局首席不得越权；没有频道首席时全局首席仍可回落建任务。原有的「actor 须是该频道成员」要求保留（只有全局回落可能不满足它，频道首席按绑定定义必然是成员）。消息不存在 / thread 内消息仍交给 `createTask` 报服务层错误，不把授权错误伪装成消息错误。拒绝文案为 `TASK_CREATE_CHIEF_ERROR`；其余五个工具继续只认全局首席并使用 `CHIEF_ONLY_ERROR`。
- **身份 helper**：`isChiefOfAnyChannel(memberId)` 遍历未归档频道，通过 `resolveEffectiveChief` 的唯一结论判断该成员是否有频道首席身份；不缓存、不重走回落链，归档频道不算，也不把「全局回落」算成频道首席。它只回答「是否有频道首席身份」，不替代 `isEffectiveChiefForChannel`。
- **prompt 跟随生效首席**：`runAgentRound` 的 `recipient.canHandoff` 改为 `isEffectiveChief`（global 或 channel），使频道首席也收到 `CREATE_THEN_HANDOFF_RULE`；候选提示改为先看轮次里的 member context（若本会话有 `worksplice_list_members` 也可用）。`DEFAULT_RECIPIENT_RULE` 的字面不变；`hasMustRespondSignal`、response rubric、handoff op 语义均不改。
- **角色变化需会话重启**：`chiefScope` 在 `startSession` 时算一次并随会话持有；角色变化后必须重启 / 重建该 agent 的会话才能拿到新工具面。不做动态热更新。

**Consequences**：

- 频道首席现在可以直接把本频道顶层消息转成任务，并在同一轮按既有 `handoff` op 派活；频道已有频道首席时全局首席不再能跨频道建任务。
- 全局首席的工具面与扩展工具隔离保持不变；频道首席的 bash / write / 扩展工具不因身份变化被关闭。
- `chiefScope` 是会话属性：运行中的会话不会因频道首席换人 / 清空 / 归档立即换工具面；工具调用仍会复判授权，但「能否看到这个工具」以会话创建时为准。
- 两档错误文案分工明确：`TASK_CREATE_CHIEF_ERROR` 只属于建任务，`CHIEF_ONLY_ERROR` 继续覆盖读面与管理员写面。

**非目标**：

- 不给频道首席开放三个读面、建频道、建 agent，也不改 `CHIEF_DOMAIN_TOOL_NAMES` 的六个名字。
- 不把频道首席会话改成窄面，不引入动态工具热更新，不改 agent 生命周期 / rebuild 语义。
- 不改数据库 schema / 迁移、HTTP 路由、UI、i18n、任务状态机、handoff / freshness / 房间预算 / must-respond 语义。
- 不改 handoff 的任务事件路由与准入矩阵（#270 的结论保持）。

**Status**: accepted（#272 实施；文档落 `GLOSSARY.md`「首席 (Chief)」与 `AGENTS.md`）
