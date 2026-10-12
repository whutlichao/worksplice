# 上下文治理实施规格

来源：[票 04](./issues/04-decide-archive-and-retrieval.md) 的六点裁决（Q1–Q9）、[票 01](./issues/01-audit-context-retention.md) 的审计结论与[预研材料](./research/options-pre-study.md) 的现状证据；上游方向见[票 02](./issues/02-decide-recommendation-direction.md)（分路径非破坏分层）与[票 03](./issues/03-decide-reset-retention-contract.md)（重置/删除保留语义）。审计报告原文在 `research/agent-context-audit` 分支（`509a28c`，未并入 main），见[研究报告](https://github.com/whutlichao/worksplice/blob/research/agent-context-audit/.scratch/agent-context-governance/research/context-audit.md)。
状态：**已交付**（票 05，2026-10-12）。本文件为可实施规格：描述目标行为、约束与验收口径；**凡标注「目标语义」处均非当前代码保证**，现状与目标的差异已逐条显式标注。
术语遵循仓库 [GLOSSARY.md](../../GLOSSARY.md)：**活动上下文**、**原始会话记录**、**持久记忆**。

## Problem Statement

现状是「两条路径分别治理」的起点（完整审计见[票 01](./issues/01-audit-context-retention.md) 及其引用的研究报告；下列引用的代码行号以本 worktree 复核为准）：

- **活动上下文无应用层上界**：agent-loop 每轮主要注入增量消息、相关任务与频道/成员语境，但旧轮 prompt、回复与工具结果留在同一 Pi session 活动分支里持续累积，直到 SDK compact 触发；inbox drain 无条数上限（[`inbox.ts:19-20`](../../lib/domain/collab/inbox.ts#L19-L20)），注入侧只对观察相设了每轮 1 次封顶（[`loop.ts:498-499`](../../lib/agent-loop/loop.ts#L498-L499)），没有任何整轮 token/字符上界；`loop.ts` 全文不引用 compact/usage。
- **无轮级 token/cost**：`round_logs` 没有 token/cost 列（[`schema.ts:86-94`](../../lib/data/schema.ts#L86-L94)），现状只有 session 级解析口径（[`session-stats.ts:101-156`](../../lib/session-stats.ts#L101-L156)），且按路径聚合在共享 cwd 会混入其他/人类 session。
- **compact summary 不可检索**：全文检索只覆盖协作消息（FTS 只挂 `messages`，[`schema.ts:148-169`](../../lib/data/schema.ts#L148-L169)）；Pi session 原文（含 compaction summary）没有索引，只能经会话 UI 或 HTML 导出人工查阅。
- **归档形态未落**：reset/delete 当前会删除 session 文件（[`agent-lifecycle.test.mjs`](../../lib/agent-lifecycle.test.mjs) 断言了这一现状），[票 03](./issues/03-decide-reset-retention-contract.md) 的「重置清空活动上下文、原始记录归档且可检索」尚是**目标语义**；协作消息面有不可变触发器与 FTS（[`schema.ts:154-169`](../../lib/data/schema.ts#L154-L169)），但没有显式的归档读取层契约；备份口径在项目文档里两处矛盾且仓库没有备份实现（处置见「迁移与兼容约束」）。
- **持久记忆靠提示约定**：`MEMORY.md`（[`dirs.ts:96-100`](../../lib/data/dirs.ts#L96-L100)）的读取与更新只由提示要求模型做，没有自动提取、校验或检索机制。

目标：在不破坏原始会话记录可追溯的前提下，给两条路径落一层非破坏、可验收的上下文治理面。

## Solution

### 分层总览：原始会话记录 / 活动上下文 / 持久记忆

- **原始会话记录**＝按会话保存的交互条目（Pi session 原文、协作消息记录），是回溯与检索的来源；本规格要求它完整、可检索、不被重置破坏（重置保留为目标语义）。
- **活动上下文**＝每轮真正送入模型的选择视图；本规格要求它在 agent-loop 有应用层上界，在 coding session 继续由 Pi compact 决定。
- **持久记忆**＝`MEMORY.md` 等跨会话信息，与对话记录分开讨论；本规格**不改造**其机制（见 Out of Scope）。

非破坏性：全部改动只增加「归档副本/读取面」与「注入形状的上界」，不删除、不重写既有原始记录；协作消息保持不可变。

### 分路径方案

**agent-loop（协作成员 agent，主要治理缺口）**

- **有界活动上下文**：应用层把每轮注入形状钉死为**有界**——「每轮送入模型的形状存在一个由代码保证、可在测试中断言的恒定上界」是本规格的验收目标；具体机制（轮级截断/摘要/预算常量等）属于实现级细节，实现期可按基线自由选择，本规格不把任何未验证方案当成唯一解，注入预算的具体数值留实现期按基线确定。
- **相关内容按需回查**：归档后的会话原文进入检索面；模型仍通过既有 `search` op 主动声明检索，命中经观察相回交——不引入应用层自动注入，不注册新工具。
- compact 继续管会话长尾；应用层只钉注入形状、提供回查面，不改 compact 阈值主权（SDK 默认＋用户 settings）。

**coding session（Pi coding session）**

- 沿用 Pi compact，**不加新机制**；compact 阈值主权同样维持 SDK 默认＋用户 settings。
- 仅新增「归档副本＋索引」的读取面：会话重置时原始 session 原文以归档副本落数据目录并进索引，compact summary 随原始会话原文一起可检索（不单独建面）。

### 已确认决策（票 04 六点裁决）

以下裁决是实施目标；其中涉及 reset/delete 的部分是**目标语义**（票 03），非当前代码保证。

| # | 决策点 | 裁决（票 04 Answer） | 来源与证据 |
| --- | --- | --- | --- |
| D1 | 归档存储形态 | A+C 分层：协作消息面复用 `messages`（归档＝读取层契约，不搬数据）；原始会话记录在重置时以归档副本落数据目录，SQLite 侧只建索引；否决新增归档表。归档进备份面、口径统一为「数据目录整体可复制」；Pi 活动 session 维持不在备份清单；删除 agent 清私有归档副本、协作历史保留。 | 票 04 Answer 点 1（Q1 人定、Q6 代答）；pre-study 第 1 点：消息不可 UPDATE/DELETE 且 FTS 插入即索引（[`schema.ts:154-169`](../../lib/data/schema.ts#L154-L169)）；`attachments`/`tasks` 等以 `message_id` 外键引用消息（[`schema.ts:51-60`](../../lib/data/schema.ts#L51-L60)、[`schema.ts:103-112`](../../lib/data/schema.ts#L103-L112)）；数据目录形状见 [`dirs.ts:12-40`](../../lib/data/dirs.ts#L12-L40) |
| D2 | 索引与按需检索 | 索引对象＝消息正文（现状 FTS 不变）＋归档会话原文（含 compact summary）；任务/提醒暂不并入。检索入口沿用现有服务层与成员面 `search` op／人类搜索 UI 的同一入口扩面，不注册新工具（不重开 ADR-0013）；触发维持模型主动声明 op，不引入应用层自动注入。 | 票 04 Answer 点 2（Q7 代答）；pre-study 第 2 点：两消费面共用 `searchMessages`（[`search.ts:24-51`](../../lib/domain/collab/search.ts#L24-L51)）；search op 身份取结构身份（[`member-ops.ts:575-586`](../../lib/agent-loop/member-ops.ts#L575-L586)）；[ADR-0013 决策一](../../docs/adr/0013-http-corridor-caller-identity.md#L5)「不注册新工具」 |
| D3 | 检索权限 | 现状语义显式化（channel membership）：成员只检索所在频道；不新增 ACL 层、不按 workspace 分区、不做全库可检索；接受 DM/私密频道内容对非成员 agent 永久不可见；owner 面维持 Owner 语义。 | 票 04 Answer 点 3（Q2 人定）；pre-study 第 3 点：成员 scoping（[`search.ts:36-51`](../../lib/domain/collab/search.ts#L36-L51)）；无多用户身份模型（[`channels.ts:8`](../../lib/domain/collab/channels.ts#L8)）；隔离姿态见 [ADR-0011 决策一/二](../../docs/adr/0011-agent-file-tool-path-guard.md#L5-L7) |
| D4 | 与 Pi compact 的协作边界 | 分路径——coding session 纯 compact；agent-loop 组合（compact 管会话长尾＋应用层把每轮注入形状钉死为有界）；阈值主权维持 SDK 默认＋用户 settings，产品不接管；compact summary 进检索面（随归档会话原文索引覆盖，不单独建面），应用层不做摘要生成。 | 票 04 Answer 点 4（Q3 人定、Q8 代答）；pre-study 第 4 点：`loop.ts` 无 compact/usage 引用、注入上限只到观察相（[`loop.ts:498-499`](../../lib/agent-loop/loop.ts#L498-L499)）；FTS 只挂 messages（[`schema.ts:148-169`](../../lib/data/schema.ts#L148-L169)） |
| D5 | 基线测量（含文档漂移处置） | 「B+C 起步」：合成会话固定形状测机制基线；session 级聚合作为真实使用观测口径（不读 `~/.pi`／`~/.worksplice` 真实数据）；轮级 usage 归属标记「待核实 SDK 能力」再定，不作为基线前提；数值目标本票不定。单位：机制层＝每轮注入规模＋`contextUsage` 峰值；现状口径＝session 累计 token/cost。文档漂移以当前代码为准，待修清单留后续 docs 票；本规格不复制漂移数字、不改 docs。 | 票 04 Answer 点 5（Q4 人定、Q5 人定）；pre-study 第 5 点：session 级口径（[`session-stats.ts:101-156`](../../lib/session-stats.ts#L101-L156)）；`round_logs` 无 token/cost 列（[`schema.ts:86-94`](../../lib/data/schema.ts#L86-L94)） |
| D6 | 防丢失验证 | 机制断言＋合成端到端两层作为落地方案验收（标准写进本规格，实施 effort 执行）；真实 provider 的质量/召回评测另起 effort 建评测集。通过条件两层：机制层＝活动上下文按注入形状缩小且关键事实在原始记录中可检索命中并回交观察相；行为层＝模型实际引用／答案正确（另起 effort）。compact 触发在合成验收里以「注入 compact 后投影形态」为主。 | 票 04 Answer 点 6（Q9 人定）；pre-study 第 6 点：机制设施（[`loop.test.mjs`](../../lib/agent-loop/loop.test.mjs)、[`backfill.test.mjs`](../../lib/agent-loop/backfill.test.mjs)、[`session-stats.test.mjs`](../../lib/session-stats.test.mjs)、[`agent-lifecycle.test.mjs`](../../lib/agent-lifecycle.test.mjs)） |

注：观察相 1 次、snippet 240 字符、检索上限 50 条等既有常量只作现状基线事实，**不是本规格的固定承诺**；具体预算由实施期按基线确定（票 04 点 2/5）。

### 行为条目（可观察断言）

每条以「给定…当…则…」描述目标行为，并附可观察断言。涉及 reset/delete 的条目是**目标语义，非当前代码保证**。

**B1 归档落点与备份口径（重置保留，目标语义）**
给定 一个 agent 已有原始会话记录，且发生 Session Reset 或 Full Reset；
当 重置流程完成；
则 原 session 原文以归档副本形式落入数据目录（`WORKSPLICE_DATA_DIR`，默认 `~/.worksplice`）内，副本进入「数据目录整体可复制」的备份口径；Pi 活动 session 维持不在备份清单。
断言：归档副本存在于数据目录内、可解析出与重置前一致的会话条目；备份说明以「数据目录整体」为对象而非逐件清单。

**B2 归档会话原文可检索**
给定 归档副本已落盘并进索引；
当 以其中某条消息的关键事实发起检索；
则 命中返回该归档会话原文，并可定位到具体归档会话。
断言：检索命中集合包含来自归档副本的条目；同一事实在归档＋索引前不可经检索面命中。

**B3 compact summary 可检索且不单独建面**
给定 一个发生过 compact 的归档会话；
当 以 summary 文本里的关键事实发起检索；
则 summary 随归档会话原文被**同一检索面**覆盖，不依赖独立的 summary 索引面。
断言：同一检索入口能命中 summary 文本；不存在只索引 summary 的独立面。

**B4 检索权限沿用 channel membership**
给定 成员 agent 发起检索（成员面 `search` op）；
当 查询命中不在其 channel membership 内的频道（含 DM／私密频道）的消息或归档内容；
则 不返回该命中；命中其所在频道的内容才返回；owner 面维持 Owner 语义不变。
断言：非成员频道命中数为 0（含归档面）；成员面结果与其频道可见面同构；不新增 ACL 层、不按 workspace 分区、不做全库可检索。

**B5 每轮注入有界（agent-loop）**
给定 agent-loop 在长会话中运行、历史累积远超注入预算；
当 构造某一轮的回复输入（prompt）；
则 注入形状受应用层定义的恒定上界约束（上界的度量与数值由实现期按基线确定，但必须是代码保证、可断言的）；超界的历史内容不在注入中，但经「按需回查」可达。
断言：合成会话下逐轮 prompt 形状 ≤ 上界；早期轮埋入的关键事实不在注入中，却能经 `search` 命中并经观察相交回（机制层）。

**B6 session 原始记录完整保留（reset 不清，目标语义）**
给定 Session Reset／Full Reset 已发生；
当 读取该 agent 的归档副本或索引；
则 重置前的原始会话记录仍完整可获取；reset 只清空活动上下文与工作状态，不删除原始记录。
断言：重置后可解析出重置前的全部会话条目；活动上下文不再包含它们。

**B7 删除 agent 的私有归档清理（票 03 语义，目标语义）**
给定 某个 agent 被显式永久删除；
当 删除流程完成；
则 其私有归档副本与私有持久记忆被清除；协作历史（频道消息等）保留；共享 workspace 只清理可确认归属该 agent 的 session，归属不明或人类 session 保留。
断言：删除后其私有归档对任何检索面不可见，协作消息仍在；共享 cwd 中他人/归属不明 session 未被删除。

**B8 回查协作维持既有形状约束**
给定 模型在某轮声明 `search` op 且命中归档内容；
当 结果回到模型；
则 经既有观察相回交（每轮最多一次观察相）；snippet 截断与条数上限沿用既有机制，具体预算常量由实施期按基线确认或调整。
断言：一轮最多一次观察相；命中以观察相文本回交；无应用层自动注入、无新工具。

**B9 不新增工具、不改变权限模型**
给定 任何检索扩展落地；
当 检查工具集与权限面；
则 入口仍是现有服务层检索函数及其两个消费面（成员面 `search` op、人类搜索 UI）；不注册新工具（不重开 ADR-0013）、不引入工具式检索、不改变 channel membership 权限模型。
断言：工具集锁定条目不变；`search` op 的声明式触发不变。

## User Stories

1. 作为 Worksplice 的 owner，我希望协作成员 agent 长期运行后每轮送入模型的上下文仍有明确上界，以便 token 成本可预期，而不是随会话单调增长。
2. 作为 owner，我希望 agent 在需要旧信息时能按需回查归档后的原始会话记录，以便减少注入的同时不丢失重要事实。
3. 作为 agent 管理者，我希望 Session Reset / Full Reset 只清空活动上下文、原始记录归档保留且可检索，以便重置不摧毁可追溯的历史。
4. 作为 agent 管理者，我希望发生过 compact 的会话摘要也能被全文检索命中，以便被压缩过的关键事实仍可找回。
5. 作为频道成员，我希望检索严格沿用 channel membership 权限，以便 DM 与私密频道内容不会因归档或索引扩面而泄漏给非成员 agent。
6. 作为 owner，我希望归档产物纳入「数据目录整体可复制」的备份口径，以便备份与迁移不遗漏上下文治理产物。
7. 作为 agent 管理者，我希望显式删除 agent 时只清理它的私有归档与持久记忆、协作历史保留，以便删除个体不等于抹掉团队记录。
8. 作为共享 workspace 的使用者，我希望重置与清理只作用于可确认归属该 agent 的 session，以便共享目录里他人或人类的 session 不被误删。
9. 作为 coding session 使用者，我希望它的上下文继续由 Pi compact 管理、不叠加新机制，只新增归档副本与索引读取面，以便既有行为不被扰动。
10. 作为实现者，我希望规格把「有界注入」写成可验收的目标与约束、而不是锁定某一未验证机制，以便按基线选择实现。
11. 作为实现者，我希望基线与防丢失验证只用合成数据、机制层可断言，以便不读取任何真实用户数据也能验收。
12. 作为维护者，我希望文档漂移以当前代码为准并集中留待后续 docs 票，以便本规格不复制可能过期的数字、不扩大本轮改动面。

## Implementation Decisions

（按 to-spec 约定，本节不写具体文件路径与代码片段，只记模块/接口/契约层面的决定；代码引用见上文决策表与行为条目。）

1. **归档＝读取层契约（协作消息面）**：不搬移、不复制协作消息数据；复用现有不可变消息与其全文索引作为归档读取来源；「归档」语义由检索面显式承载。
2. **原始会话记录归档副本**：session 原文（含 compact summary）在重置路径上以副本落数据目录，是文件侧持久内容；SQLite 侧只建索引。归档副本归属该 agent 私有，与协作历史分开治理。
3. **索引与检索入口**：索引对象＝消息正文（现状不变）＋归档会话原文（含 summary）；检索入口沿用现有服务层检索函数扩面，两个消费面（成员面 `search` op、人类搜索 UI）同源；不注册新工具、不加应用层自动注入；任务/提醒暂不并入。
4. **检索权限**：沿用 channel membership 过滤；owner 面维持 Owner 语义；不新增 ACL 层。
5. **agent-loop 有界注入**：验收要求＝每轮注入形状存在代码保证、可断言的恒定上界；机制与预算数值留实现期按基线确定（轮级截断/摘要/预算常量等均属实现选择，本规格不锁定）。
6. **compact 协作**：阈值主权维持 SDK 默认＋用户 settings，产品不接管；应用层不做摘要生成；summary 进检索面（随归档原文覆盖，不单独建面）。
7. **基线口径**：机制层＝每轮注入规模＋`contextUsage` 峰值；现状口径＝session 累计 token/cost（session 级聚合）；轮级 usage 归属标记「待核实 SDK 能力」，不作为基线前提；数值目标本规格不定。
8. **隔离与数据约束**：基线与验收只用合成数据（合成 JSONL、临时数据目录、fake runtime）；不读 `~/.pi`／`~/.worksplice` 真实用户数据；不引入外部索引服务。

### 迁移与兼容约束

- **schema 增量原则**：若实施需要新表/新列，遵守现有迁移链（`SCHEMA_VERSION` 单调递增）并保持启动迁移幂等；新增面不得依赖不可重复执行的变更。当前版本与列形状以 `lib/data/schema.ts` 为准，本规格不复制数字。
- **reset/delete 保留语义是目标语义**：票 03 的保留语义（重置保留可检索原始记录、删除 agent 清私有归档留协作历史、共享目录只清可确认归属的 session）是**目标语义，非当前代码保证**；当前 reset/delete 会删除 session 文件。实施应先落地归档副作用，再按目标语义收口删除范围。
- **文档漂移处理**：以当前代码与仓库事实为基准；已知漂移（备份口径两处矛盾、部分 ADR/rebuild 规划文字超前于实现）不改 docs，集中列为待修清单留后续 docs 票；本规格不复制漂移数字。
- **兼容性**：不改变协作消息格式与不可变触发器；不改变 Pi session 文件的所有权与格式；不改工具集锁定条目与权限模型；coding session 行为不新增机制。

## Testing Decisions（基线与验证方法）

- **验证两层通过条件**（票 04 点 6）：
  - **机制层（本规格的验收口径，实施 effort 执行）**：合成会话固定形状下断言 ①活动上下文按注入形状缩小（每轮 prompt 有恒定上界）；②关键事实在原始记录/归档面可检索命中，并经观察相回交；③`contextUsage` 峰值可观测（compact 后到下一次有效 assistant usage 前为未知）。
  - **行为层（另起 effort）**：真实 provider 下的「模型实际引用／答案正确」评测另起 effort 建评测集；本规格只定义它的存在与边界。
- **只读约束**：只用合成数据，不读 `~/.pi`／`~/.worksplice`；测试沿用「无参打开默认数据目录」的机械禁令先例（[`default-datadir-guard.test.mjs`](../../lib/data/default-datadir-guard.test.mjs)）。
- **seams（复用既有测试缝，不新造）**：
  - 每轮注入形状缝：fake session 捕获每轮 prompt（[`loop.test.mjs`](../../lib/agent-loop/loop.test.mjs)）；
  - 检索回查缝：`search` op → 观察相（[`loop-ops.test.mjs`](../../lib/agent-loop/loop-ops.test.mjs)）；
  - 归档落点/清理缝：数据目录 + fake runtime 生命周期（[`agent-lifecycle.test.mjs`](../../lib/agent-lifecycle.test.mjs)）；
  - session 解析与统计缝：合成 JSONL + 临时目录（[`session-stats.test.mjs`](../../lib/session-stats.test.mjs)）；
  - 恢复幂等缝：合成 JSONL + marker 轮（[`backfill.test.mjs`](../../lib/agent-loop/backfill.test.mjs)）。
- **验收场景形态**：机制断言型（早期轮埋关键事实 → 构造 compact/截断后的投影 → 断言原文可检索且 op 可命中回交）＋合成多轮端到端（fake 回复脚本走「事实 → 压缩/截断 → 回查」剧情）。compact 触发在合成验收里以「注入 compact 后投影形态」为主，不依赖真实 provider 的阈值触发。
- **测量口径**：机制基线用注入形状＋`contextUsage`；真实使用观测口径用 session 级聚合（不读真实数据）；轮级 token 数在设施就绪前不作为断言依据。
- **数值目标**：本规格不设阈值；由基线产出后在实施票内确定。

## Out of Scope

- 本规格的实施本身：不写源码、不建表、不创建实施票文件；实施票由下一轮 to-tickets 产出。
- 真实 provider 的质量/召回评测（另起 effort 建评测集）。
- 任务/提醒进入检索面（暂不并入）。
- 工具式检索与任何新工具注册（不重开 ADR-0013）。
- 新增 ACL/权限模型、按 workspace 分区检索、全库可检索。
- 持久记忆（`MEMORY.md`）机制的改造（自动提取/校验/检索）。
- 修改 docs 修漂移清单（留后续 docs 票）；不接管 Pi compact 阈值。
- 不引入外部索引服务；不改变协作消息不可变语义与既有备份/导出实现。

## Further Notes

### 实施入口

实施票由下一轮 to-tickets 按本规格产出（本轮不拆票、不创建票文件）。规格体量已明确，下列建议清单供下一轮参考（标题＋一句话范围＋依赖）：

1. **归档副本落盘与索引**：Reset/Full Reset 时把 session 原文（含 compact summary）归档进数据目录并建立可检索索引，含迁移与幂等——依赖 B1/B2/B3。
2. **检索面扩到归档原文**：在既有服务层检索入口上扩面（成员面 `search` op 与人类搜索 UI 同步），权限沿用 channel membership——依赖 1。
3. **agent-loop 有界注入**：应用层把每轮注入形状钉死为有界（机制与预算常量按基线定）——依赖 1/2 提供的回查面。
4. **删除 agent 的私有归档清理收口**：按票 03 目标语义清理私有归档、保留协作历史与共享目录他人 session——依赖 1。
5. **基线与防丢失验证**：合成数据机制层基线（注入形状/截断/检索可达性/`contextUsage`）＋两层通过条件——依赖 1–4。

（以上为建议，具体拆分以下一轮 to-tickets 为准。）

### 证据边界

- 现状证据以本 worktree（从 `origin/main` `56cbad2` 切出）复核过的代码与文档为准；行号引用以本 worktree 为准。
- 审计研究报告位于 `research/agent-context-audit` 分支（`509a28c`），作为票 01 的引用证据保留，不并入 main；本规格只引用其结论与已转录到[预研材料](./research/options-pre-study.md) 的证据。
- 本规格不复制已知漂移数字（Q5 原则）；所有引用指向存在的路径。
