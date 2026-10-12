# 决定归档、索引与检索的实施方案（含基线与防丢失验证）

Type: grilling
Status: resolved
Blocked by: 01, 02, 03

## Question

在已决的「分路径、非破坏分层治理」方向（见票 02）下，为实施规格（票 05）定下以下要点，
每点给出推荐选项、理由与备选：

1. 归档存储形态：原始记录归档放在哪里（复用现有 SQLite FTS5 表 / 独立归档表 / 文件系统 +
   索引库），与 `messages` 不可变触发器及现有备份三件套的关系；
2. 关键词/全文索引与按需检索：索引什么、如何建、agent-loop 的检索入口与现有 `searchMessages`、
   loop `search` op 的关系；
3. 检索权限：单人 owner 产品下权限的合理解释（范围、敏感数据、避免越权）；
4. 与 Pi compact 的协作边界：活动上下文有界化靠 compact 还是应用的轮级截断/摘要，
   compact 摘要如何参与按需回查；
5. 基线测量：token/cost 基线与关键事实召回、任务质量的测量方法（只用合成数据，不读
   `~/.pi`、`~/.worksplice` 真实用户会话），以及数值目标如何随基线确定；
6. 防丢失验证：「保留完整历史但降低活动上下文 token」的验收场景与通过条件。

## Answer

经两轮 grilling（Q1–Q9，逐点问答）裁定；全部决策类问题经 `orca orchestration ask` 回收协调者答复
（人定与代答的标注见 Comments），文档措辞类细节按仓库惯例处理。六点裁决：

1. **归档存储形态**：取「A+C 分层」——协作消息面复用 `messages`（归档＝读取层契约，不搬数据）；
   原始会话记录（Pi session JSONL）在会话重置时以归档副本落入数据目录、SQLite 侧只建索引
   （文件＋索引库）；否决新增归档表（B）。归档进备份面，口径统一为「数据目录整体可复制」，
   Pi 活动 session 维持不在备份清单；删除 agent 清私有归档副本、协作历史保留。
   依据：`messages` 不可 UPDATE/DELETE 且 FTS5 插入即索引（[`schema.ts:154-169`](../../../lib/data/schema.ts#L154-L169)），
   `attachments`/`reactions`/`pinned_messages`/`tasks` 均以 `message_id` 外键引用消息
   （[`schema.ts:51-119`](../../../lib/data/schema.ts#L51-L119)），复制或搬移只会造成双份真相。
2. **关键词/全文索引与按需检索**：索引对象＝消息正文（现状 FTS 不变）＋归档会话原文（含 compact
   summary）；任务/提醒暂不并入。检索入口沿用现有服务层与成员面 `search` op／人类搜索 UI 的同一
   入口扩面，不注册新工具（不重开 ADR-0013）；检索触发维持模型主动声明 op，不引入应用层自动注入；
   预算常量（观察相 1 次／snippet 240／上限 50）留基线后由票 05 调。
   依据：两消费面共用 `searchMessages`（[`search.ts:24-51`](../../../lib/domain/collab/search.ts#L24-L51)），
   工具式会动 `PRESET_DEFAULT` 锁定条目并与减 token 目标相抵。
3. **检索权限**：取现状语义显式化（channel membership）——成员只检索所在频道；不新增 ACL 层、
   不按 workspace 分区、不做全库可检索；接受 DM/私密频道内容对非成员 agent 永久不可见的后果；
   owner 面维持 Owner 语义。
   依据：成员 scoping 已是唯一可见性原语（[`search.ts:36-49`](../../../lib/domain/collab/search.ts#L36-L49)），
   全库可检索与 [ADR-0011](../../../docs/adr/0011-agent-file-tool-path-guard.md#L5-L7) 的隔离姿态相反。
4. **与 Pi compact 的协作边界**：分路径——coding session 纯 compact；agent-loop 组合（compact 管
   会话长尾＋应用层把每轮注入形状钉死为有界）；compact 阈值主权维持 SDK 默认＋用户 settings，
   产品不接管；compact summary 进检索面（随归档会话原文索引覆盖，不单独建面），应用层不做摘要生成。
   依据：SDK compact 不删原始 entries 但阈值受用户 settings／per-model 影响（Pi v0.99.2 官方文档），
   agent-loop 旧轮留在同一活动分支直至 compact 且无应用层上界（`loop.ts` 无 compact/usage 引用，
   注入上限只到观察相 [`loop.ts:498-499`](../../../lib/agent-loop/loop.ts#L498-L499)）。
5. **基线测量（含文档漂移处置）**：取「B+C 起步」——合成会话固定形状测机制基线，session 级聚合
   作为真实使用观测口径（不读 `~/.pi`／`~/.worksplice` 真实数据）；轮级 usage 归属标记「待核实
   SDK 能力」再定，不作为基线前提；数值目标本票不定。单位：机制层＝每轮注入规模＋`contextUsage`
   峰值，现状口径＝session 累计 token/cost。文档漂移以当前代码与仓库事实为基准，两处备份口径矛盾
   与 ADR-0005/spec-rebuild 漂移表列为待修清单留后续 docs 票，本票 04/05 不复制漂移数字、不改 docs。
   依据：[`session-stats.ts:101-156`](../../../lib/session-stats.ts#L101-L156) 已有 session 级口径，
   `round_logs` 无 token/cost 列（[`schema.ts:86-94`](../../../lib/data/schema.ts#L86-L94)），
   ADR-0005 与 v14 实测不一致（见 [pre-study 第 5 点对照表](../research/options-pre-study.md)）。
6. **防丢失验证**：机制断言＋合成端到端两层作为落地方案的验收（标准写进票 05，实施 effort 执行）；
   真实 provider 的质量/召回评测另起 effort 建评测集。通过条件分两层：机制层＝活动上下文按注入
   形状缩小且关键事实在原始记录中可检索命中并回交观察相；行为层＝模型实际引用／答案正确
   （另起 effort）。compact 触发在合成验收里以「注入 compact 后投影形态」为主。
   依据：机制设施已备（[`loop.test.mjs`](../../../lib/agent-loop/loop.test.mjs)、
   [`backfill.test.mjs`](../../../lib/agent-loop/backfill.test.mjs)、
   [`session-stats.test.mjs`](../../../lib/session-stats.test.mjs)），且无轮级 token 事件、
   只能按注入形状与 `contextUsage` 断言。

## Comments

本轮决策全部经 `orca orchestration ask` 回收（第 1 轮 5 问 msg_914c31b1a6ff；第 2 轮 4 问
msg_b6044e4f4e92，其中曾多次超时，按协议续等同一 message ID、未重复提问）。逐条审计：

- **Q1 → A（人定）**：问归档存储形态（A 复用 `messages`／B 新归档表／C 文件系统＋索引库）及与
  不可变触发器、现有备份三件套的关系。协调者答复：「同意 A+C 分层（协作消息面 A 不搬；session
  原始记录面 C 归档副本进数据目录+索引库）」。依据：[pre-study 第 1 点](../research/options-pre-study.md)
  （`schema.ts` 不可变触发器＋FTS、`message_id` 外键组、票 03 目标语义）与本 worktree 行号复核。
- **Q2 → A（人定）**：问检索权限面（A 现状语义显式化／B 全库可检索／C 按 workspace 分区）。
  协调者答复：「同意 A 现状语义（channel membership，不新增 ACL 层；接受 DM/私密频道对非成员
  永久不可见）」。依据：pre-study 第 3 点（`search.ts:36-49` 成员 scoping、`channels.ts:8`
  无多用户身份、ADR-0011 隔离姿态）。
- **Q3 → A（人定）**：问与 Pi compact 的协作边界（纯 compact／应用层轮级截断／组合）。协调者答复：
  「同意分路径 A+C（coding session 纯 compact；agent-loop 组合：compact 管长尾+应用层钉死每轮
  注入形状有界；compact 阈值主权维持 SDK 默认+用户 settings）」。依据：pre-study 第 4 点
  （Pi v0.99.2 文档、`caller.ts` 扩展装配、`loop.test.mjs` 断言设施）。
- **Q4 → A（人定）**：问基线测量路径与单位。协调者答复：「同意 B+C 起步（C 合成机制基线、B
  session 级聚合为观测口径不读真实数据；A 轮级归属标记待核实 SDK 后定；数值目标本票不定）」。
  依据：pre-study 第 5 点（`session-stats.ts`、`schema.ts:86-94`、`docs/cost-monitoring-baseline.md`）。
- **Q5 → A（人定）**：问文档漂移与备份口径处置（先对齐文档／先修代码／以代码为准标记待修）。
  协调者答复：「同意以代码为准+标记待修（口径矛盾与漂移表列为待修清单留后续 docs 票；本票不复制
  漂移数字、不改 docs；备份口径待归档面定后按「数据目录为备份对象」原则收口）」。依据：pre-study
  第 5 点漂移表与第 1 点备份口径矛盾（`docs/spec.md:472` vs `docs/spec-rebuild.md:77-78`＋ADR-0006），
  本 worktree 复核（`schema.ts:3`＝v14）。
- **Q6 → A（代答）**：问归档是否进备份面及清除边界（a 进、口径统一为数据目录整体／b 不进）。
  协调者答复：「同意 (a)。依据：Q1 人定 session 归档落数据目录，备份面按已定原则「数据目录整体
  可复制」自然覆盖；Pi live session 维持不在备份清单、spec.md:472 标记待修（Q5 原则）；清除边界
  沿用票 03 语义（删除 agent 清私有归档副本，协作消息不可删）」。依据：Q1 裁决与 pre-study 第 1 点
  备份面事实。
- **Q7 → A（代答）**：问索引对象范围与检索入口（扩展 `searchMessages`／新索引面／agent 工具式，
  含 ADR-0013「不注册新工具」冲突）。协调者答复：「同意推荐（索引=消息正文现状+归档会话原文含
  summary；入口=现有 searchMessages 之上扩面，维持 op 声明触发；否决工具式——与减 token 目标
  相悖且需重开 ADR-0013；任务/提醒暂不并入、预算常量留票 05 按基线调）」。依据：pre-study 第 2 点
  （`search.ts`、`member-ops.ts:575-586`、ADR-0013:5）。
- **Q8 → A（代答）**：问 compact summary 是否进检索面。协调者答复：「同意「进且不单独建面」
  （summary 随归档会话原文索引自然覆盖；应用层不做摘要生成）」。依据：pre-study 第 4 点（summary
  当前不可检索的缺口：FTS 只挂 `messages`，`schema.ts:160-169`）。
- **Q9 → A（人定）**：问防丢失验证形态、通过条件与归属。协调者答复：「机制+合成两层（A+B 为
  落地方案验收，写进票 05 spec；C 真实 provider 评测另起 effort 建评测集；通过条件两层：机制层=
  注入形状缩小+关键事实可检索命中并回交观察相，行为层另起 effort）」。依据：pre-study 第 6 点
  （机制设施清单；无轮级 token 事件，只能按注入形状/`contextUsage` 断言）。
