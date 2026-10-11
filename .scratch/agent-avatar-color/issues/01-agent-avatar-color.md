# 01 — Agent 头像色选择与一致呈现

Type: grilling
Status: resolved
Blocked by: None

用户原话：「给 agent 详情页里增加一个头像颜色选择器，选择后同步更改 agent 所有的颜色，不限于左侧 menu tree，session中」。本票按 `grill-with-docs` 完成需求访谈与设计；七节设计正本为 [spec.md](../spec.md)。只交付文档与术语决议，不实现源码，不拆实现 tickets。

## Answer

### Grill 轮次索引

| 轮次 | 问题范围 | 提交与答复记录 |
| --- | --- | --- |
| 第 1 轮 | Q1–Q4：色域、头像色语义、Pi transcript 范围、持久性 | 经 `orca orchestration ask` 提交；答复记录在同一任务线程，message ID `msg_65518ba12fbd`。产品所有者确认均采纳荐答。 |
| 第 2 轮 | Q5–Q7：默认/恢复、重复色、点击即保存 | 经 `orca orchestration ask` 提交；答复记录在同一任务线程，message ID `msg_0a53c31727d5`。产品所有者确认均采纳荐答。 |
| 第 3 轮 | Q8：Pi session 文件如何归属 agent | 经 `orca orchestration ask` 提交；原回复 message ID `msg_345172da3b34` 的 `pi_session_file` 字段因 shell 引号在回传时缺失。协调者在同一 thread 追加更正 `msg_0c44de45d6c9`，明确精确匹配 agent 的 `pi_session_file`，本票以更正为准。 |
| 冻结确认 | Q9：完整设计摘要与术语/ADR裁决 | 向协调者提交共同理解摘要并请求确认；产品所有者确认 Q1–Q8 契约已冻结，要求继续设计并记录 Q→A。 |

### Q→A 审计

#### Q1 — 头像色可选范围

**Q1 → A（人定）**：仅开放现有 agent 色格 `av-0…av-3`，`av-4` 保留给 human；不提供任意色值或新增色。

**理由**：沿用既有五格色板与 human 中性色约定，不扩张色板范围。

#### Q2 — “所有颜色”的含义

**Q2 → A（人定）**：所有代表 agent 身份的 Avatar tile 随选择同步；包含侧栏、频道/线程消息、任务 owner、搜索等已有呈现。status dot、任务状态色、作者名字文字色、按钮/主题等独立语义颜色不改。

**理由**：要求所有头像身份呈现同色，但不把“头像颜色”扩成无关的语义色改造。

#### Q3 — “session中”的范围

**Q3 → A（人定）**：明确把 agent 头像加入其独立 Pi session transcript 的 assistant 消息呈现；普通 human session 不加。

**理由**：用户原话明确提到 session；已有 `MessageView` transcript 当前没有 Avatar，因此应将其作为新增身份呈现纳入，而不是假定左侧/协作消息头像已覆盖。

#### Q4 — 持久性

**Q4 → A（人定）**：颜色属于 agent 身份级持久属性，跨应用重载、Restart、Session reset、Full reset、换 workspace 与改名保留。

**理由**：头像色是身份外观，不属于一次会话或工作区设置。

#### Q5 — 默认色与恢复方式

**Q5 → A（人定）**：现有及新 agent 继续按 member ID 自动取色；用户显式选择后才形成持久覆盖；提供“自动/恢复默认”清除覆盖并回到 ID 色。

**理由**：存量 agent 默认外观不变，且用户可撤销选色。

#### Q6 — 多 agent 能否重复选色

**Q6 → A（人定）**：允许多个 agent 使用相同色格，不因其他 agent 已选而禁用色格。

**理由**：只有四个色格而 agent 数量不限；颜色不是唯一身份标识，当前自动取色亦可能碰撞。

#### Q7 — 选择器提交时机

**Q7 → A（人定）**：点击色格即保存；成功后所有该 agent Avatar 呈现同步更新，不需额外 Save；失败时保留旧色并提示。

**理由**：符合“选择后同步更改”的原始要求，避免额外草稿状态造成误解。

#### Q8 — Pi transcript 的 agent 归属

**Q8 → A（人定；以协调者更正为准）**：仅当当前 transcript 文件与该 agent 的 `pi_session_file` 精确对应时显示 agent 头像；普通 session、仅 cwd 相同的 session、无明确成员归属的历史/分叉 session 不显示。

**理由**：workspace/cwd 可共享，不能仅凭目录安全推断 session 身份，避免将 human 或其他 agent 的对话错染。

#### Q9 — 共同理解冻结

**Q9 → A（人定）**：确认 Q1–Q8 的行为与精确文件归属，并确认采用“头像色（Avatar Tint）”作为文档术语；本设计不新增 ADR。

**理由**：该汇总与前述逐项确认一致；精确 `pi_session_file` 关联避免共享 workspace 下误标 session。

### G-docs 自验

- 七节设计结构完整：Problem Statement / Solution / User Stories / Implementation Decisions / Testing Decisions / Out of Scope / Further Notes。
- 记录了用户原话、Q1–Q9 的问答与理由；设计树无未决 frontier。
- 现有 agent 色格和 human 中性色、全部既有 Avatar 呈现、Pi transcript 新增面、精确 session 文件归属、持久性、生命周期、自动恢复、允许重复色、提交失败行为均有可观察描述。
- 术语“头像色”已 inline 加入 `CONTEXT.md`；没有符合 ADR 三条件的新增架构裁决，因此不新增 ADR。
- 仅 G-docs；未运行测试、typecheck、lint、双轴 code-review 或浏览器验收；未改任何源码。

### 文件清单

- `.scratch/agent-avatar-color/spec.md`
- `.scratch/agent-avatar-color/issues/01-agent-avatar-color.md`
- `CONTEXT.md`

### PR

待协调者授权发布分支并创建 PR 后回填。
