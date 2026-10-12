# 归档、索引与检索：六决策点预研（grilling 输入材料）

> **本文件是 grilling 输入材料，不是决策**：为[票 04](../issues/04-decide-archive-and-retrieval.md) 的六个决策点摆出**现状 / 候选 / 开放问题**，不写推荐结论，裁决留给人。
> **证据分层**（沿用[上下文审计报告](https://github.com/whutlichao/worksplice/blob/research/agent-context-audit/.scratch/agent-context-governance/research/context-audit.md)的口径）：**代码保证**＝当前仓库实现/测试；**SDK 默认**＝Pi 官方 `v0.99.2` 文档所述默认，仍可能被用户设置覆盖；**提示约定**＝文本要求模型做、没有执行机制保证；**暂无证据**＝本轮未在仓库代码/测试/文档及 Pi 官方文档中发现相应能力。
> 术语遵循仓库 [`GLOSSARY.md`](../../../GLOSSARY.md)：活动上下文 / 原始会话记录 / 持久记忆。
> 代码基线：本分支从 `origin/main` `c26e54e` 切出；Pi 四包固定 `0.99.2`（[`package.json`](../../../package.json#L57-L60)）。本调查只读，未启动服务、未读 `~/.pi` / `~/.worksplice`。

---

## 1. 归档存储形态

### 现状

- **代码保证（协作消息面）**：消息存 SQLite `messages`（id / target_id / seq / author / content，`UNIQUE(target_id, seq)`），见 [`schema.ts:42-50`](../../../lib/data/schema.ts#L42-L50)；`messages_no_update` / `messages_no_delete` 触发器让任何 UPDATE/DELETE 直接 ABORT（[`schema.ts:154-159`](../../../lib/data/schema.ts#L154-L159)）；FTS5 trigram 外部内容表挂在 messages 上，插入即同步索引（[`schema.ts:148-153`](../../../lib/data/schema.ts#L148-L153)、[`schema.ts:160-169`](../../../lib/data/schema.ts#L160-L169)）；数据层查询 = FTS 候选 + 全 token LIKE 校验/兜底（[`sqlite.ts:429-490`](../../../lib/data/sqlite.ts#L429-L490)）；服务层 `searchMessages` 上限 50（[`search.ts:6`](../../../lib/domain/collab/search.ts#L6)）。
- **代码保证（附件面）**：附件落 `attachments/` 目录，文件名 `randomUUID()`、真实名与消息的映射在 `attachments` 表（[`dirs.ts:24-31`](../../../lib/data/dirs.ts#L24-L31)、[`schema.ts:103-111`](../../../lib/data/schema.ts#L103-L111)）。
- **代码保证（原始会话记录面）**：Pi session JSONL 在 `~/.pi/agent/sessions/`，读写权归 SDK、app 只读，且**备份清单明确不含它**（[`spec-rebuild.md:77`](../../../docs/spec-rebuild.md#L77)）；Worksplice 只有一个逐 session 的 HTML 导出路由（[`export route:241-280`](../../../app/api/sessions/%5Bid%5D/export/route.ts#L241-L280)），不构成库级备份或归档。
- **负向核实（无备份机制）**：`scripts/`、`app/api/`、`package.json` scripts、`bin/` 均无备份脚本/路由/命令（grep 无命中）。文档口径**两处不一致**：`docs/spec.md` 写「备份 = 复制 `worksplice.db` + `attachments/` + `~/.pi/agent/sessions/` 对应 cwd 目录（首版不做内建备份 UI）」（[`spec.md:472`](../../../docs/spec.md#L472)）；而 `spec-rebuild.md` 与 ADR-0006 写「三件套 = `worksplice.db + attachments/ + agents/`」且明确 Pi session 文件不在清单内（[`spec-rebuild.md:78`](../../../docs/spec-rebuild.md#L78)、[`ADR-0006:6`](../../../docs/adr/0006-backward-compat-and-migration-strategy.md#L6)）。唯一落在代码里的"备份"是一次性 i18n 迁移工具写 `MEMORY.md.bak-<时间戳>`（[`i18n.md:35`](../../../docs/i18n.md#L35)）。
- **代码保证（隔离面）**：agent 文件工具的允许根 = 自家目录 + 显式绑定的项目目录；数据目录（含 `worksplice.db`/`attachments/`）与其他成员家目录永不纳入（[`ADR-0011:5-7`](../../../docs/adr/0011-agent-file-tool-path-guard.md#L5-L7)，实现装配 [`agent-runtime.ts:284`](../../../lib/agent-runtime.ts#L284)）。
- **代码保证（既有文件面先例）**：数据目录里已有两类"文件侧持久内容"——附件（`attachments/`）与每个 agent 家目录的持久记忆 `MEMORY.md`（固定六节模板，[`dirs.ts:96-100`](../../../lib/data/dirs.ts#L96-L100)）；二者都不是 SQLite 表形态，说明"文件 + 索引库"在仓库里不是全新形态。
- **术语提醒（代码保证）**：现有产品里的"archive"专指**频道归档**（`channels.archived` 列，[`schema.ts:17`](../../../lib/data/schema.ts#L17)；路由 [`channels/[id]/archive`](../../../app/api/channels/%5Bid%5D/archive/route.ts)），与上下文治理要谈的"归档"不是同一概念；本文件谈后者。

### 候选（成本 / 收益）

- **A. 复用现有 SQLite 表（归档 = 读取层契约，数据不搬）**：
  - 收益 = 零新基建，不可变触发器与 FTS 原样保证"原始消息可全文检索"（[`schema.ts:154-169`](../../../lib/data/schema.ts#L154-L169)）；归档面与活动面共用同一检索入口（[`search.ts:24-51`](../../../lib/domain/collab/search.ts#L24-L51)）。
  - 成本 = `messages` 没有归档/保留维度列，"归档"停留在语义概念；库文件与 FTS 索引随使用量单调增长，备份面同步变大。
  - 与现有事实的关系：不触碰触发器与 FTS 结构，但也不解决"活动上下文变小"本身（那是注入侧问题，见第 4/5 点）。
- **B. 新增归档表（同库或独立 DB 文件）+ 自己的索引**：
  - 收益 = 归档与活动面可分离、可定义独立 schema/保留策略/备份颗粒；若独立 DB 文件，归档增长不推高主库的 FTS/维护成本。
  - 成本 = 不可变触发器只防 `messages` 表（[`schema.ts:154-159`](../../../lib/data/schema.ts#L154-L159)），新表要另定写入/删除纪律；`attachments`/`reactions`/`pinned_messages`/`tasks` 对 `message_id` 的外键（[`schema.ts:51-119`](../../../lib/data/schema.ts#L51-L119)）在分库时要跨库处理或整组搬；跨表检索要合并两套结果面。
  - 与现有事实的关系：备份面出现"第四面"或需扩写三件套口径（[`spec-rebuild.md:78`](../../../docs/spec-rebuild.md#L78)）；数据层是单一 `Store` 宽总线（[`sqlite.ts`](../../../lib/data/sqlite.ts)），新增独立库要决定适配方式。
- **C. 文件系统 JSONL（数据目录/workspace 内）+ 索引库**：
  - 收益 = 与 Pi 原始会话记录形态对称、人工可翻看、工具通用（既有附件/`MEMORY.md` 已证明文件侧持久内容可行，[`dirs.ts:24-40`](../../../lib/data/dirs.ts#L24-L40)、[`dirs.ts:96-100`](../../../lib/data/dirs.ts#L96-L100)）。
  - 成本 = 无事务/触发器保证（幂等、去重、损坏行自理，参考 `session-stats` 对损坏行的容忍口径 [`session-stats.ts:118-125`](../../../lib/session-stats.ts#L118-L125)）、需要索引重建机制、文件名与读取权限面要另行定义。
  - 与现有事实的关系：落点位置决定权限后果——放数据目录内则 agent 文件工具不可达（数据目录被 ADR-0011 排除）、检索只能经 app 介导；放进 agent 允许根内（如 workspace）则文件工具可读写，但隔离姿态不同（[`ADR-0011:5-7`](../../../docs/adr/0011-agent-file-tool-path-guard.md#L5-L7)）。
- 三候选共同对照的事实：`messages` 不可 UPDATE/DELETE（触发器 ABORT），任何"物理搬移/搬走"方案都不能删除原消息，只能复制或视图化（[`schema.ts:154-159`](../../../lib/data/schema.ts#L154-L159)）；重建同名 DM 等维护动作也只动 channels/成员行、不动消息（[`schema.ts:398-401`](../../../lib/data/schema.ts#L398-L401)）。
- 三候选共同对照的第二个事实：`attachments`、`reactions`、`pinned_messages`、`tasks` 都以 `message_id` 外键引用消息（[`schema.ts:51-59`](../../../lib/data/schema.ts#L51-L59)、[`schema.ts:95-119`](../../../lib/data/schema.ts#L95-L119)），归档若做"分库/分文件"，引用完整性要么跨库处理、要么把关联表一起搬。

### 开放问题

- 「归档」是物理搬移、独立存储，还是读取层契约？票 03 给的是**目标语义**（Reset 后原始记录归档且可检索），形态由票 04 定（[`03-decide-reset-retention-contract.md:13-18`](../issues/03-decide-reset-retention-contract.md#L13-L18)）。
- 归档是否进入备份面：三件套是否扩展为四件？"Pi session 文件不在备份清单"这条口径是否维持（[`spec-rebuild.md:77`](../../../docs/spec-rebuild.md#L77)）？
- "显式永久删除"（删除 agent 时清私有归档，票 03）在 A/B/C 三个候选里分别落到哪张表/哪些文件？协作消息不可删（[`schema.ts:154-159`](../../../lib/data/schema.ts#L154-L159)），与"清私有归档"的边界要写清。

---

## 2. 索引与按需检索

### 现状

- **代码保证（检索面）**：服务层 `searchMessages(query, {limit, memberId})`：空查询 `[]`、limit 收敛 [1,50]、成员面在 DB LIMIT 之后按频道成员资格过滤（"宁少不泄"，[`search.ts:24-51`](../../../lib/domain/collab/search.ts#L24-L51)）；人类面 `GET /api/search?q=&limit=`（[`search route:10-27`](../../../app/api/search/route.ts#L10-L27)）。数据层三路径：全长 token 走 FTS5 rank；混合长短 token 走 FTS 候选 + 全 token LIKE 校验；纯短 token 走 LIKE 全表（trigram 需 ≥3 字符）（[`sqlite.ts:425-490`](../../../lib/data/sqlite.ts#L425-L490)，设计注释 [`schema.ts:146-147`](../../../lib/data/schema.ts#L146-L147)）。
- **代码保证（loop 的 search op）**：每轮 prompt 广告 `{"op":"search","query","limit"}`（[`loop.ts:435-439`](../../../lib/agent-loop/loop.ts#L435-L439)）；执行以结构身份 `memberId: agent.id`（[`member-ops.ts:575-586`](../../../lib/agent-loop/member-ops.ts#L575-L586)）；命中经观察相 prompt 回交，snippet 截 240 字符（[`member-ops.ts:324-354`](../../../lib/agent-loop/member-ops.ts#L324-L354)）；每轮最多一次观察相（`MAX_OPS_OBSERVATION_PHASES = 1`，[`loop.ts:498-499`](../../../lib/agent-loop/loop.ts#L498-L499)；集成 [`loop.ts:1306-1322`](../../../lib/agent-loop/loop.ts#L1306-L1322)）；测试 [`loop-ops.test.mjs:188-211`](../../../lib/agent-loop/loop-ops.test.mjs#L188-L211)。
- **代码保证（与每轮注入的关系）**：`buildReplyPrompt` 每轮注入的是 drain 出的新消息 + 相关开放任务 + 频道/成员语境（[`loop.ts:331-449`](../../../lib/agent-loop/loop.ts#L331-L449)、[`inbox.ts:40-61`](../../../lib/domain/collab/inbox.ts#L40-L61)）；检索**不自动发生**——需要模型在回复 JSON 里主动声明 op，属提示约定，没有执行机制保证它会声明。
- **代码保证（结果呈现）**：命中摘要由 `buildSearchSnippet` 构建（`<mark>` 高亮，供 UI 深链 `#c/<channelId>?m=<messageId>`），成员面观察文本会剥掉标记并截断（[`search.ts:8-18`](../../../lib/domain/collab/search.ts#L8-L18)、[`member-ops.ts:337-354`](../../../lib/agent-loop/member-ops.ts#L337-L354)）；搜索是无状态单次查询，没有"上一轮检索过什么"的记忆面（暂无证据表明存在检索历史记录）。
- **代码保证（两个消费面共用一处检索）**：人类面 UI 是 `SearchView.tsx`（250ms 防抖 + 命中深链定位/展开线程，[`SearchView.tsx:24-27`](../../../components/SearchView.tsx#L24-L27)），与成员面 search op 走同一个 `searchMessages`——任何检索面扩展会同时影响两侧。

### 候选（成本 / 收益）

- **A. 扩展现有 `searchMessages`（新过滤维度、排序、面向 agent 的访问面）**：
  - 收益 = 变更面最小，UI 与 loop 共用一处、可见性语义单点维护（[`search.ts:20-23`](../../../lib/domain/collab/search.ts#L20-L23)）。
  - 成本 = 只能检索消息正文（FTS 只索引 `content`，[`schema.ts:148-153`](../../../lib/data/schema.ts#L148-L153)），表达不了"事实级"回查（任务、决策、摘要）；成员面 ≥50 条非成员命中时仍可能少拿（[`search.ts:32-35`](../../../lib/domain/collab/search.ts#L32-L35)）。
  - 与每轮注入的关系：不改变 `buildReplyPrompt` 的形状，模型仍靠 op 声明触发（[`loop.ts:435-439`](../../../lib/agent-loop/loop.ts#L435-L439)）。
- **B. 新增索引型检索（messages 之外的第二索引：任务/决策/摘要/归档面）**：
  - 收益 = 可检索对象超出消息正文，可承载摘要与结构化事实，归档形态（第 1 点）可一起设计。
  - 成本 = 索引维护与失效策略（消息不可变使消息侧增量简单，但任务/摘要会变，[`schema.ts:51-59`](../../../lib/data/schema.ts#L51-L59)）、谁生成索引条目待定、与 FTS 的替换/并存关系要定。
  - 与每轮注入的关系：索引条目若进注入面，需要新的"注入多少/何时注入"预算，与观察相封顶（[`loop.ts:498-499`](../../../lib/agent-loop/loop.ts#L498-L499)）同一本账。
- **C. agent 工具式按需检索（注册检索工具而非结构化 op）**：
  - 收益 = 工具调用对模型的显著性通常高于 op 声明；检索可带结构化参数（时间范围、目标类型）。
  - 成本 = 与已决的 [ADR-0013:5](../../../docs/adr/0013-http-corridor-caller-identity.md#L5)「不注册新工具」（动 `PRESET_DEFAULT` 锁定条目）冲突，选它需先重开该决策；且新工具的权限仍要落回服务层裁决（同 ADR 决策一）。
  - 与每轮注入的关系：工具定义本身进入每轮上下文（工具集 = `PRESET_DEFAULT` 的一部分），"加工具"本身就是活动上下文成本项。
- 三个候选都绕不开的现状约束：模型当前一**轮**只有一次观察相（[`loop.ts:498-499`](../../../lib/agent-loop/loop.ts#L498-L499)），检索入口的"次数 × 注入量"直接构成每轮活动上下文成本（[`buildReplyPrompt`](../../../lib/agent-loop/loop.ts#L331-L449)）。

### 开放问题

- 索引什么对象：仅消息正文，还是任务/提醒/摘要/归档的合并检索面？
- 检索结果的注入形状与预算：观察相 1 次、snippet 240 字符、最多 50 条（[`member-ops.ts:324`](../../../lib/agent-loop/member-ops.ts#L324)、[`search.ts:6`](../../../lib/domain/collab/search.ts#L6)）是否够用，要不要分页/提炼？
- 若走工具式（C），是否接受重开 ADR-0013 的"不注册新工具"？该问题的成本由谁承担（工具集锁定条目的改动面）？

---

## 3. 检索权限

### 现状

- **代码保证（无多用户身份模型）**：人类 HTTP 面一律按 Owner 处理（`CURRENT_MEMBER_ID = OWNER_MEMBER_ID`，[`channels.ts:8`](../../../lib/domain/collab/channels.ts#L8)）；人类面准入 = loopback 零配置 / 非 loopback fail-closed（[`ADR-0013:7`](../../../docs/adr/0013-http-corridor-caller-identity.md#L7) 决策二）。成员面整体不经 HTTP，身份取结构（[`ADR-0013:5`](../../../docs/adr/0013-http-corridor-caller-identity.md#L5) 决策一）。
- **代码保证（成员检索可见面）**：`searchMessages` 传 `memberId` 时只返回该成员所在频道的命中（[`search.ts:36-49`](../../../lib/domain/collab/search.ts#L36-L49)）；loop 的 search op 固定传 `memberId: agent.id`（[`member-ops.ts:576-578`](../../../lib/agent-loop/member-ops.ts#L576-L578)）；DM 只有 owner 与该 agent 两名成员（[`channels.ts:81-95`](../../../lib/domain/collab/channels.ts#L81-L95)）。
- **代码保证（成员资格是唯一可见性原语）**：频道成员关系存 `channel_members`（[`schema.ts:20-25`](../../../lib/data/schema.ts#L20-L25)），加入/退出走 `joinChannel` / `leaveChannel`（[`channels.ts:138-171`](../../../lib/domain/collab/channels.ts#L138-L171)），检索 scoping 直接调 `isChannelMember`（[`channels.ts:198`](../../../lib/domain/collab/channels.ts#L198)）——没有独立于成员关系的 ACL 层。
- **代码保证（跨 agent workspace 的文件可见性）**：允许根 = 自家目录 + 显式绑定的项目目录；`~/.worksplice/` 根本身、`worksplice.db`、`attachments/`、其他成员家目录永不纳入（[`ADR-0011:5-7`](../../../docs/adr/0011-agent-file-tool-path-guard.md#L5-L7)），实现见 [`tool-path-guard.ts`](../../../lib/tool-path-guard.ts) 与装配点 [`agent-runtime.ts:284`](../../../lib/agent-runtime.ts#L284)、[`caller.ts:102-128`](../../../lib/rpc/caller.ts#L102-L128)。
- **暂无证据**：未发现检索权限表、敏感数据分级或"按 workspace 分区检索"的任何机制；可见性完全由 channel membership（消息面）+ 路径守卫（文件面）两层构成。

### 候选（成本 / 收益）

- **A. 按 owner/参与者范围（现状语义显式化）**：
  - 收益 = 与现有 scoping 一致、无新模型，成员检索面与频道可见面同构（[`search.ts:36-49`](../../../lib/domain/collab/search.ts#L36-L49)）。
  - 成本 = 归档扩面后要重申同一边界，且 DM/私密频道内容对非成员 agent 永久不可见（含归档后被要求"团队可查"的场景）。
- **B. 全库可检索（agent 与 owner 同等）**：
  - 收益 = 召回面最大、实现最简，`searchMessages` 的 memberId 分支可直接不用。
  - 成本 = 与"成员只能读所在频道"的现状**反转**，私密频道与 DM 内容对所有成员可见，与 ADR-0011 的"隔离优先"姿态（[`ADR-0011:29`](../../../docs/adr/0011-agent-file-tool-path-guard.md#L29)）方向相反。
- **C. 按 workspace 隔离**：
  - 收益 = 与"agent 绑定一个工作目录"的模型契合，归档可按 workspace 分区。
  - 成本 = 消息的组织维度是频道/线程而非 workspace（[`schema.ts:42-50`](../../../lib/data/schema.ts#L42-L50)），需要新增"频道 → workspace"映射，DM/跨项目频道的归属难定义。
- 共同对照：无论选哪个，`messages` 不可变意味着权限变化只能改变**读取面**，不能靠"搬走数据"实现隔离（[`schema.ts:154-159`](../../../lib/data/schema.ts#L154-L159)）。

### 开放问题

- 归档检索的默认面：参与者范围 / 全库 / 按 workspace？DM 内容是否进入任何 agent 的检索面？
- 删除 agent 后的可见性：票 03 定「保留协作历史、清除私有归档」（[`03-decide-reset-retention-contract.md:18`](../issues/03-decide-reset-retention-contract.md#L18)）——"私有归档"与"协作消息"的检索边界在实现规格里怎么切？
- owner 面（无 memberId，Owner 语义）是否需要显式区分"我自己看"与"agent 可见"两种结果面？

---

## 4. 与 Pi compact 的协作边界

### 现状

- **SDK 默认（Pi v0.99.2）**：自动 compact 触发条件 `contextTokens > contextWindow - reserveTokens`；`reserveTokens` 默认 **16384**；`keepRecentTokens` 默认 **20000**；检查点 = 新 prompt 前、工具结果追加后（下一次 assistant 响应前）、overflow/length 恢复；`compaction.enabled=false` 关自动但不关手动 `/compact`；per-model `compaction.modelOverrides` 可覆盖阈值。见 [Pi Compaction Reference](https://github.com/earendil-works/pi/blob/v0.99.2/packages/coding-agent/docs/compaction.md#when-it-triggers)。
- **SDK 默认（条目与投影）**：compaction entry 字段 `summary` / `firstKeptEntryId` / `tokensBefore` / `usage`；重建上下文 = summary + `firstKeptEntryId` 起的 entries，**原始 entries 不删**；`context_edit` 只改未来模型上下文投影，raw history / export / session accounting 不变。见 [Pi Session File Format](https://github.com/earendil-works/pi/blob/v0.99.2/packages/coding-agent/docs/session-format.md#compactionentry)。
- **代码保证（Worksplice 侧钩子）**：`compact` RPC 转发（可带 customInstructions，[`session.ts:660-668`](../../../lib/rpc/session.ts#L660-L668)）；`set_auto_compaction`（[`session.ts:713-716`](../../../lib/rpc/session.ts#L713-L716)）；`get_state.contextUsage`（compact 后到下一次有效 assistant usage 前为未知，[`session.ts:545-575`](../../../lib/rpc/session.ts#L545-L575)）；`get_session_stats`（[`session.ts:678-683`](../../../lib/rpc/session.ts#L678-L683)）；UI 触发手动 compact（[`useAgentSession.ts:1466`](../../../hooks/useAgentSession.ts#L1466)）；session-stats 统计 compaction 条数与 `tokensBefore` 之和（[`session-stats.ts:101-156`](../../../lib/session-stats.ts#L101-L156)、[`session-stats.test.mjs:59-70`](../../../lib/session-stats.test.mjs#L59-L70)）。
- **代码保证（投影/呈现）**：`buildSessionContext` 调 SDK 投影（[`session-reader.ts:285-321`](../../../lib/session-reader.ts#L285-L321)）；compaction entry 在气泡里以"正文 = summary"的自定义消息显示（[`session-reader.ts:400-404`](../../../lib/session-reader.ts#L400-L404)）；`context_edit` 故意不渲染（[`session-reader.ts:428-434`](../../../lib/session-reader.ts#L428-L434)）。
- **代码保证（compact 实时可观测）**：RPC wrapper 把 `auto_compaction_start/end`、`compaction_start/end` 事件纳入运行态事件集合并透传 UI（[`session.ts:90-105`](../../../lib/rpc/session.ts#L90-L105)）；但事件只驱动 busy/compacting 状态与列表刷新，不落库、不产生轮级记录（[`session.ts:660-668`](../../../lib/rpc/session.ts#L660-L668)）。
- **代码保证（agent-loop 未介入 compact）**：`loop.ts` 全文无 compact / usage / token 引用；`RpcCaller` 创建会话时不传 compaction 专用设置（[`caller.ts:119-160`](../../../lib/rpc/caller.ts#L119-L160) 无 compaction 命中）。即 agent-loop 每轮仅追加 prompt，旧轮留在同一 Pi session 活动分支里，是否 compact 由 SDK 默认 + 用户 settings 决定。
- **SDK 默认（未使用的钩子）**：Pi 提供 `session_before_compact` 扩展钩子（可取消或提供自定义 summary，reason 区分 manual/threshold/overflow），但 Worksplice 的会话扩展工厂只装配 forced-empty / 路径守卫 / bash 沙箱三个（[`caller.ts:122-128`](../../../lib/rpc/caller.ts#L122-L128)），**没走**这个钩子——"应用层参与 compact 时点"在 SDK 侧有现成接缝（[Pi Compaction Reference](https://github.com/earendil-works/pi/blob/v0.99.2/packages/coding-agent/docs/compaction.md#extension-hooks-relevant-to-compaction)）。
- **compact summary 可检索性（代码保证）**：Worksplice 全文检索只覆盖 SQLite `messages`（FTS 触发器只挂 messages，[`schema.ts:160-169`](../../../lib/data/schema.ts#L160-L169)）；Pi session JSONL（含 compaction summary）无任何全文索引，summary 只能经会话 UI（[`session-reader.ts:400-404`](../../../lib/session-reader.ts#L400-L404)）或 HTML 导出（[`export route:241-280`](../../../app/api/sessions/%5Bid%5D/export/route.ts#L241-L280)）人工查阅 → **当前不可检索**。

### 候选（成本 / 收益）

- **A. 纯靠 compact 兜底**：收益 = 零应用改造，SDK 保证原始会话记录不删（[Pi Session File Format](https://github.com/earendil-works/pi/blob/v0.99.2/packages/coding-agent/docs/session-format.md#compactionentry)）；成本 = 阈值是 SDK 默认、受用户 settings 与 per-model override 影响，不是 Worksplice 的可测常量；每轮注入形状仍无应用层上界；summary 进不了检索面（见上）。
- **B. 应用层轮级截断/摘要**：收益 = 注入形状由代码钉死、可在 `loop.test.mjs` 断言（[`loop.test.mjs:268-296`](../../../lib/agent-loop/loop.test.mjs#L268-L296)），不受用户 settings 影响；成本 = 新增机制面（摘要生成/存放、与 ack/freshness/backfill 的协作），摘要文本可能失真，且与 compact 叠加时两层边界要划清。
- **C. 两者组合**：收益 = compact 管原始会话记录长尾，应用层管每轮活动上下文形状，检索回查落回原始记录面；成本 = 两层阈值/时点的交互需要观测与解释（何时哪层生效、回查命中哪层），基线测量要做双口径（第 5 点）。

### 开放问题

- 活动上下文阈值主权归谁：Pi 用户 settings（SDK 默认）、Worksplice 固定值，还是按 agent 配置？现状 `set_auto_compaction` 已存在但无产品面调用（[`session.ts:713-716`](../../../lib/rpc/session.ts#L713-L716)）。
- compact summary 是否要进检索面？若进，第 1/2 点的索引候选必须覆盖 summary 条目（形态是 session JSONL，不是 SQLite）。
- 应用层摘要与 compact summary 的关系：并存、择一，还是应用层只做"注入形状"不做摘要？

---

## 5. 基线测量（含文档漂移核实）

### 现状

- **代码保证（可建立的机制基线）**：session 级 usage/cost 只读解析 `parseSessionFileStats`——assistant `message.usage`、compaction/branch_summary 的 usage、独立 `usage` 条目只记 cost（[`session-stats.ts:39-156`](../../../lib/session-stats.ts#L39-L156)）；聚合按 agent 合并绑定文件 + workspace cwd 下全部 session（**按路径聚合**，共享 cwd 会混入他人/人类会话，[`session-stats.ts:185-217`](../../../lib/session-stats.ts#L185-L217)）；观测接口返回 stats + live `contextUsage`（[`observability route:17-63`](../../../app/api/members/%5Bid%5D/observability/route.ts#L17-L63)）。
- **代码保证（合成测试口径）**：`session-stats.test.mjs` 在 OS 临时目录造 JSONL，覆盖 usage/compaction/损坏行/独立 cost 条目（[`session-stats.test.mjs:15-116`](../../../lib/session-stats.test.mjs#L15-L116)）；prompt 形状可由 fake session 直接断言（[`loop.test.mjs:76-99`](../../../lib/agent-loop/loop.test.mjs#L76-L99)、[`loop.test.mjs:268-296`](../../../lib/agent-loop/loop.test.mjs#L268-L296)）；search 观察相断言见 [`loop-ops.test.mjs:188-211`](../../../lib/agent-loop/loop-ops.test.mjs#L188-L211)。
- **代码保证（历史快照）**：`docs/cost-monitoring-baseline.md` 是 2026-08-13 的 session 级全周期快照（3 agent），并写明 cost=0 也可能是无 cost 元数据（[`cost-monitoring-baseline.md:12-39`](../../../docs/cost-monitoring-baseline.md#L12-L39)）。
- **缺口（代码保证）**：无轮级 token/cost 归属——`round_logs` 只有 status / reason / base_seq / created_at（[`schema.ts:86-94`](../../../lib/data/schema.ts#L86-L94)、[`types.ts:121-129`](../../../lib/data/types.ts#L121-L129)），写入形状无成本列（[`sqlite.ts:797-821`](../../../lib/data/sqlite.ts#L797-L821)），`loop.ts` 全文无 usage/token 引用；无召回/质量评测集（仓库未发现 recall rubric 或任务质量评分设施）。
- **文档漂移核实（明确对照结论）**：
  | ADR-0005 / spec-rebuild 声称 | 出处 | 当前实际（代码保证） |
  |---|---|---|
  | `SCHEMA_VERSION 12` 仅 `round_logs` 三列增量（`prompt_tokens/completion_tokens/cost`），`migrateRoundLogsCostColumns()` 幂等 ALTER | [`ADR-0005:8`](../../../docs/adr/0005-agent-loop-reshaping-cost-reliability-observability.md#L8)、[`ADR-0005:14`](../../../docs/adr/0005-agent-loop-reshaping-cost-reliability-observability.md#L14)、[`ADR-0006:8`](../../../docs/adr/0006-backward-compat-and-migration-strategy.md#L8)、[`spec-rebuild.md:58`](../../../docs/spec-rebuild.md#L58)、[`spec-rebuild.md:73-75`](../../../docs/spec-rebuild.md#L73-L75) | `SCHEMA_VERSION = 14`（[`schema.ts:3`](../../../lib/data/schema.ts#L3)）；`round_logs` DDL 无三列（[`schema.ts:86-94`](../../../lib/data/schema.ts#L86-L94)）；全仓库 grep 无 `migrateRoundLogsCostColumns` / `prompt_tokens` 命中 |
  | 重试收敛 `MAX_REVISE 2→1 / MAX_RESEND 3→1 / MAX_TASK_STATUS 3→2`，默认 `onConflict` revise→resend | [`ADR-0005:6`](../../../docs/adr/0005-agent-loop-reshaping-cost-reliability-observability.md#L6)、[`spec-rebuild.md:64`](../../../docs/spec-rebuild.md#L64) | 常量为 **2 / 3 / 3**（[`loop.ts:694-695`](../../../lib/agent-loop/loop.ts#L694-L695)、[`loop.ts:851`](../../../lib/agent-loop/loop.ts#L851)）；默认 `onConflict: "revise"`（[`loop.ts:265`](../../../lib/agent-loop/loop.ts#L265)） |
  | prompt 截断新增"最近 20 条"、task preview 120 字 | [`ADR-0005:6`](../../../docs/adr/0005-agent-loop-reshaping-cost-reliability-observability.md#L6)、[`spec-rebuild.md:64`](../../../docs/spec-rebuild.md#L64) | drain 无条数上限（[`inbox.ts:19-20`](../../../lib/domain/collab/inbox.ts#L19-L20)、[`inbox.ts:57`](../../../lib/domain/collab/inbox.ts#L57)）；task preview 默认 80（[`preview.ts:2`](../../../lib/preview.ts#L2)）；`loop.ts` 无 20 条裁剪 |
  | 双视图成本看板（全量聚合 + 最近 50 轮滑动）、`round_logs.prompt_tokens/cost` badge 非空 | [`spec-rebuild.md:84-86`](../../../docs/spec-rebuild.md#L84-L86)、[`ADR-0009:9`](../../../docs/adr/0009-spec-shape-and-migration-plan.md#L9) | 轮级成本列不存在（见上）；列表上限 50 存在但无 token/cost 可展示（[`rounds.ts:17`](../../../lib/domain/collab/rounds.ts#L17)） |
  结论：以上属**规划文字超前于当前代码**，且 `SCHEMA_VERSION 12` 的记载与当前 v14 不符；"已实现"的依据应取当前 schema 与源码，不应取 ADR/rebuild 的承诺文字。

### 候选（测量路径）

- **A. 轮级 usage 归属（新机制）**：收益 = 可把 token/cost 归因到轮/目标（`round_logs` 是天然的挂点，[`rounds.ts:6-17`](../../../lib/domain/collab/rounds.ts#L6-L17)）；成本 = 需要新钩子与口径（一轮含 prompt + 观察相 + 重试的哪些调用）、SDK 是否提供轮级数据**暂无证据**；近似做法（每轮前后 session usage 差）的误差需接受。
- **B. session 级聚合为基线（现状口径）**：收益 = 今天就有、经合成测试验证、零改造（[`session-stats.ts:101-156`](../../../lib/session-stats.ts#L101-L156)）；成本 = 无法按轮/按路径归因，共享 cwd 聚合混杂（[`session-stats.ts:185-217`](../../../lib/session-stats.ts#L185-L217)），且含 cost=0 语义不清的问题（[`cost-monitoring-baseline.md:28-39`](../../../docs/cost-monitoring-baseline.md#L28-L39)）。
- **C. 合成会话固定形状基线（机制层）**：收益 = 不依赖真实 provider，可断言 prompt 形状、截断与检索可达性（设施见第 6 点：[`loop.test.mjs:76-99`](../../../lib/agent-loop/loop.test.mjs#L76-L99)、[`session-stats.test.mjs:15-20`](../../../lib/session-stats.test.mjs#L15-L20)）；成本 = 只证机制不证模型行为，"关键事实召回/任务质量"仍需另建评测集。

### 开放问题

- 轮级归属是否必须经由 SDK 新接口（待核实）？"每轮前后差"的近似口径误差如何接受与解释（口径必须自证，不能与其他轮次的观察相/重试混淆）？
- 基线单位：每轮 input/output token、`contextUsage` 峰值（[`session.ts:564-566`](../../../lib/rpc/session.ts#L564-L566)）、还是 session 累计（[`session-stats.ts:101-156`](../../../lib/session-stats.ts#L101-L156)）？与 `docs/cost-monitoring-baseline.md` 的快照口径怎么衔接（[`cost-monitoring-baseline.md:12-39`](../../../docs/cost-monitoring-baseline.md#L12-L39)）？
- 文档漂移的处置：本票不改 docs（[`ADR-0005:8`](../../../docs/adr/0005-agent-loop-reshaping-cost-reliability-observability.md#L8) 与 [`schema.ts:3`](../../../lib/data/schema.ts#L3) 已实测不一致）；票 04/05 是先对齐文档、先修代码，还是以当前代码为准并标记文档待修？

---

## 6. 防丢失验证

### 现状（可复用设施，均为合成数据）

- **代码保证**：`loop.test.mjs` 用临时 data db（[`loop.test.mjs:8-14`](../../../lib/agent-loop/loop.test.mjs#L8-L14)）+ fake session 捕获每轮 prompt（[`loop.test.mjs:76-99`](../../../lib/agent-loop/loop.test.mjs#L76-L99)），可断言"注入形状 → 回复落库 → 游标推进"全链路（[`loop.test.mjs:336-364`](../../../lib/agent-loop/loop.test.mjs#L336-L364)）。
- **代码保证**：`backfill.test.mjs` 用合成 JSONL + marker 轮 + 临时 DB（[`backfill.test.mjs:32-40`](../../../lib/agent-loop/backfill.test.mjs#L32-L40)、[`backfill.test.mjs:156-275`](../../../lib/agent-loop/backfill.test.mjs#L156-L275)），覆盖幂等、ignore 不补、游标推进——可复用为"原始会话记录 → 协作面"的恢复断言。
- **代码保证**：`session-stats.test.mjs` 合成 JSONL 覆盖 usage/compaction/损坏行（[`session-stats.test.mjs:15-116`](../../../lib/session-stats.test.mjs#L15-L116)）；`agent-lifecycle.test.mjs` 用 fake runtime + 临时目录覆盖 reset 删除语义（[`agent-lifecycle.test.mjs:33-57`](../../../lib/agent-lifecycle.test.mjs#L33-L57)、[`agent-lifecycle.test.mjs:125-166`](../../../lib/agent-lifecycle.test.mjs#L125-L166)）。
- **代码保证（摘要与 op 形态）**：compaction summary 的解析（`<read-files>`/`<modified-files>` 尾部块）有独立单测（[`compaction-summary.test.mjs:6-39`](../../../lib/compaction-summary.test.mjs#L6-L39)，消费方 [`MessageView.tsx:1088`](../../../components/MessageView.tsx#L1088)）；search op 的形状/limit 校验由 `planMemberOps` 单测钉住（[`member-ops.test.mjs:100-122`](../../../lib/agent-loop/member-ops.test.mjs#L100-L122)）。
- **代码保证（隔离约束）**：`default-datadir-guard.test.mjs` 机械禁止测试无参打开默认数据目录（[`default-datadir-guard.test.mjs:1-22`](../../../lib/data/default-datadir-guard.test.mjs#L1-L22)），与"只用合成数据、不读 `~/.pi` / `~/.worksplice`"同向。

### 候选（验收场景形态）

- **A. 机制断言型（无模型）**：早期轮次埋关键事实 → 构造 compact/截断后的活动上下文 → 断言原文仍在 SQLite + FTS 且 search op 可命中（FTS 触发 [`schema.ts:160-169`](../../../lib/data/schema.ts#L160-L169)，op 链路 [`loop-ops.test.mjs:188-211`](../../../lib/agent-loop/loop-ops.test.mjs#L188-L211)）；收益 = 稳定、可进 `npm test`；成本 = 不证明模型"愿意回查"，只证机制可达。
- **B. 合成多轮端到端（fake runtime）**：用 fake 回复脚本走"事实 → compact/截断 → 回查"剧情，断言 prompt 形状（摘要 + 近期）与观察相内容；收益 = 覆盖轮间状态与 ack/backfill 协作（设施如上）；成本 = fake 模型行为是写死的，"防丢失"验证只到机制层。
- **C. 真实 provider 的质量/召回评测（另起 effort）**：收益 = 唯一能测"模型能否找回并用上事实"；成本 = 需要评测集与可复现条件（约束：只用合成数据、阈值后定，[`02-decide-recommendation-direction.md:15-17`](../issues/02-decide-recommendation-direction.md#L15-L17)），仓库当前无此设施。
- 三个候选共享一个现状限制：Worksplice 侧没有"轮级 token 事件"，验收里"活动上下文变小"只能按 prompt 形状/`contextUsage` 断言，不能按轮级 token 数断言（第 5 点缺口）。

### 开放问题

- "compact 后关键事实可回查"的通过条件：检索命中即算、要求模型在新轮实际引用、还是要求答案正确？
- 评测集规模、关键事实的标注者与维护者是谁？合成 session 覆盖多少轮/多少 compact 周期算够？
- 真实 compact 触发依赖用户 settings 与模型阈值（SDK 默认，[Pi Compaction Reference](https://github.com/earendil-works/pi/blob/v0.99.2/packages/coding-agent/docs/compaction.md#settings)）——验收要在合成 session 里复现触发，还是允许注入 compact 后的投影形态？

---

## 附录：六点 × 关键证据来源速览

| 决策点 | 关键证据（本文件已展开引用） |
|---|---|
| 1 归档存储形态 | `messages` 不可变触发器 + FTS（[`schema.ts:42-169`](../../../lib/data/schema.ts#L42-L169)）；备份口径两处不一致（[`spec.md:472`](../../../docs/spec.md#L472)、[`spec-rebuild.md:77-78`](../../../docs/spec-rebuild.md#L77-L78)）；文件侧先例（[`dirs.ts:24-40`](../../../lib/data/dirs.ts#L24-L40)） |
| 2 索引与按需检索 | `searchMessages`（[`search.ts:24-51`](../../../lib/domain/collab/search.ts#L24-L51)）；数据层三路径（[`sqlite.ts:429-490`](../../../lib/data/sqlite.ts#L429-L490)）；search op 与观察相（[`member-ops.ts:575-586`](../../../lib/agent-loop/member-ops.ts#L575-L586)、[`loop.ts:498-499`](../../../lib/agent-loop/loop.ts#L498-L499)） |
| 3 检索权限 | 无多用户身份（[`channels.ts:8`](../../../lib/domain/collab/channels.ts#L8)）；成员 scoping（[`search.ts:36-49`](../../../lib/domain/collab/search.ts#L36-L49)）；文件面隔离（[`ADR-0011:5-7`](../../../docs/adr/0011-agent-file-tool-path-guard.md#L5-L7)） |
| 4 与 Pi compact 协作 | Pi Compaction/Session Format 官方文档（v0.99.2）；Worksplice 钩子（[`session.ts:545-575`](../../../lib/rpc/session.ts#L545-L575)、[`session.ts:660-716`](../../../lib/rpc/session.ts#L660-L716)）；summary 不可检索（[`schema.ts:160-169`](../../../lib/data/schema.ts#L160-L169)） |
| 5 基线测量 | `session-stats.ts`（[`session-stats.ts:101-217`](../../../lib/session-stats.ts#L101-L217)）；`round_logs` 无成本列（[`schema.ts:86-94`](../../../lib/data/schema.ts#L86-L94)）；文档漂移表（本文件第 5 点） |
| 6 防丢失验证 | `loop.test.mjs` / `backfill.test.mjs` / `session-stats.test.mjs` / `agent-lifecycle.test.mjs`（本文件第 6 点逐条行号）；隔离守卫（[`default-datadir-guard.test.mjs:1-22`](../../../lib/data/default-datadir-guard.test.mjs#L1-L22)） |

---

## 交付边界与待明确事实

- 本文件为 grilling 输入：六点均**未裁决**，候选取舍留待票 04；本文件不修改 `map.md`、`issues/01-05`、`spec.md` 或任何源码。
- 本调查发现的三处待明确事实：①"备份三件套"文档口径两处不一致（[`spec.md:472`](../../../docs/spec.md#L472) vs [`spec-rebuild.md:78`](../../../docs/spec-rebuild.md#L78)），且仓库无备份实现；②文档漂移（第 5 点表格，ADR-0005 / spec-rebuild 与 schema v14 不一致）；③SDK 是否提供轮级 usage 数据，暂无证据。
- 证据边界：只读当前仓库源码/配置/文档/测试与 Pi `v0.99.2` 官方文档；未读、未枚举、未解析 `~/.pi` / `~/.worksplice` 任何真实数据；未启动 Worksplice 服务。
