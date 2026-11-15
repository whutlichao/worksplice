# 任务分流跟随频道生效首席；互审 @ 只是准入信号

**背景**：用户把 `#开发群` 的频道首席设为 `dev` 后，任务创建事件仍被全局首席 `Susan` 接走并 handoff；随后任务 owner 在 `in_review` 任务线程里 `@PM` 请求反向审查，`PM` 在模型调用前被 `taskReviewerNotInvited` 挡掉。前者来自 #247 的具体取舍「频道首席只做默认收件人，任务分流仍归全局首席」，后者来自 #237 的「`in_review` reviewer 只认人类正文点名」。本决策推翻这两点，并保留其余边界。

**决策一（任务分流跟随本频道的生效首席）**：

- **唯一身份解析不变**：`resolveEffectiveChief(channelId)` 仍按「频道首席 → 全局首席 → 无」回答唯一答案；新增 `isEffectiveChiefForChannel(channelId, memberId)` 只比较该结论，调用点不得重走回落链。该 helper 不判静音——静音是可达性，由 `canRouteToChief(channelId, memberId)` 单独回答。
- **一个任务事件只叫一个收件人**：任务创建事件、任务锚点 / 任务线程、唯一 `Task #N` 引用都交给本频道生效首席；频道首席存在时不再同时叫全局首席。没有生效首席、生效首席不可达、任务已被认领 / 已分流、作者就是首席本人时静默，不回落给另一个 agent、不广播。人类个人点名仍可穿透静音，并在本轮执行 handoff；handoff 授权看生效首席身份，不看静音。
- **授权与通知一致**：`selectSecretaryHandoffTask` 与 `handoffTask` 的授权都从全局首席改为本频道生效首席，非首席 agent 仍被拒绝。成功通知由实际执行者署名，正文为 `Task #N owner set to @X by @Y (chief handoff).`，避免频道首席的 handoff 被读成全局首席。
- **one-model-call 约束**：一次任务分流最多产生一次首席轮次。频道首席与全局首席不得因同一个任务事件各起一轮；这是拒绝「双叫再让路」的直接原因。
- **工具面不扩张**：`worksplice_task_create` / `worksplice_agent_create` 等领域工具仍只注册在全局首席会话；频道首席能够执行既有 handoff op，但不能从无点名消息新建任务。`recipient.canHandoff` 继续表示全局工具面，不表示「频道首席能否 handoff」。
- **旧记账名保留**：`round_logs.role = 'secretary-handoff'` 不改值；其中的 `secretary` 语义从此指「本频道生效首席」，不是全局首席同义词。

**决策二（`in_review` 任务 owner 的 @ 是互审注意力信号）**：

- `RoundAdmissionInput` 增加 `taskOwnerMentioned`。只在以下条件同时成立时为 true：这是任务线程且状态为 `in_review`；当前 agent 是频道成员且不是 owner；任务 owner 是本频道未软删 agent；本轮 drain 里**最新一条 owner 消息**点名了当前 agent；该消息不是收束语 / 签退。
- 该信号让非 owner 以 `task-reviewer` 准入，`useRoomGate: false`。它**不进入** `hasMustRespondSignal`：reviewer 进入 prompt 后仍可按既有 rubric 选择 reply / ignore / conclude，合法 ignore 不记 error。
- 不修改 `selectMessageInvitations` 的「只有人类作者产生新邀请」语义。普通 agent 消息本来就投给频道成员；这里只放开模型调用前的准入层。非 owner 的 agent @、`in_progress` 的 owner-only 矩阵、`done` / `closed` 只认人类点名、`reopened` 的人类接管限制都保持原样。
- 不新增 must-respond prompt 规则；既有「An @mention from another agent is an attention signal, not a demand」保持不变。

**Consequences**：

- 频道设置首席后，任务创建与明确任务引用会在该频道内闭环；未设置 / 失效的频道首席仍按原语义回落全局首席。没有可用首席时静默，不制造第二个路由者。
- 频道首席可以 handoff，但不会获得全局领域工具；它仍不能把一条无点名的人类消息直接建成任务。领域工具面与巡检接入继续由全局首席承担，本决策只改消息触发的任务分流与互审准入。
- 静音仍是可达性：任务事件不自动唤醒被静音的频道首席；人类显式点名仍送达，且该轮可按生效首席身份执行 handoff。
- 互审 @ 的模型调用成本最多增加一轮每位被任务 owner 最新消息点名的成员；被点名者仍可不回复。owner 的收束语 / 签退不会制造新轮次。
- 文档与测试必须使用两个名字：**生效首席**决定消息触发分流的收件人与 handoff 授权；**全局首席**只表示回落档与全局工具面。

**非目标**：

- 不把 `worksplice_task_create` / `worksplice_agent_create` 等工具扩给频道首席，不改 `lib/member-tool-policy.ts` 或 `lib/chief-tools/` 的注册面。
- 不把普通 agent @ 升级为频道级广播，不改变 DM 语义，不把 agent @ 升为 must-respond。
- 不修改任务状态机、互审授权、freshness-hold、数据库 schema、HTTP 契约、UI 或房间轮次预算默认值。
- 不删除 / 重命名 `round_logs.role = 'secretary-handoff'`。
- 不扩大本决策到巡检接入：巡检仍按其现有全局首席接入面运行。

**被否决的备选**：

- **频道首席与全局首席双叫，再由一个让路**：同一任务事件产生两次模型调用，且让路失败时会双 handoff；违反 one-model-call。
- **频道首席不可达时回落另一名首席或广播**：会制造用户没有指定的路由者，并把「没有可用首席」伪装成一次成功投递。
- **把 agent @ 一律升为 must-respond**：会重新打开 #237 关闭的 agent 间自激与频道噪音；本决策只给任务 owner 在 `in_review` 的明确互审动作开一道窄门。
- **给频道首席开放全局建任务工具**：省一条 handoff 路径，却让「频道首席」与「全局工具面」两个概念重新混在一起；本决策只复用既有 handoff op。

**Status**: accepted（#270 实施；文档落 `GLOSSARY.md`「首席 (Chief)」「唤醒 (Wake)」「回应判断 (Response Judgment)」，模块边界落 `AGENTS.md`）

Superseded specific bullet: channel chief task_create is now allowed by ADR-0020
