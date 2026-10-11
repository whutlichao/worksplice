# Worksplice 三项代码优化设计

日期：2026-10-11 · 来源：设计票 `.scratch/code-optimization-enhancement/issues/01-design.md`（Type: grilling，已 resolved）。

性质：**设计规格**；描述三项候选优化、正确性约束与实施验收，不把尚未测得的性能收益写成事实。三项均纳入本 effort 是用户既定决定；是否同时发布、如何拆票由 coordinator 在设计合并后决定。

## Problem Statement

本 effort 检查三处潜在的重复工作与启动开销：频道/线程消息合并的去重、含短 token 的消息搜索、以及 agent-loop 启动时的会话文件补拉。用户提出的优化目标尚未由性能基线证明；先以当前实现建立可复现比较，再决定候选实现是否确有收益。

### 已核实的现状

1. **消息合并**：`hooks/useChannelData.ts:106-116` 的 `mergeIncomingMessages` 在非空 incoming 时，逐项用 `prev.some` 查 ID，再拼接并按 `seq` 升序排序；空 incoming 原样返回 `prev`。该函数供轮询页合并（`applyPollPage`）、hook 状态更新及 `components/ThreadPanel.tsx` 等调用。测试位于 `hooks/useChannelData.test.mjs`，UI 调用面也有 `components/ChannelView.test.mjs`。
2. **消息搜索**：`lib/data/sqlite.ts:414-446` 按 token 长度分流：所有 token 长度至少 3 时走 FTS5 trigram、`ORDER BY rank`；任一 token 短于 3 时走转义后的 `LIKE` AND 条件、`ORDER BY rowid DESC`。FTS trigram 表在 `lib/data/schema.ts` 由同步触发器维护。两条路径的排序当前不同。`lib/domain/collab/search.ts:24-50` 将 limit 收敛到 1–50（默认 20）；成员面至多先取 50 条再按频道成员资格过滤并切片，未改变权限语义。摘要使用 `buildSearchSnippet`，两条路径共享。
3. **agent-loop 启动补拉**：`lib/agent-loop/loop.ts:2066-2091` 的 `createAgentLoop().start()` 先启动状态扫掠，同步执行全员 `backfillAllAgents()`，捕获补拉异常后才启动 wake driver 与 reminder cron。全员扫描按 agent 顺序执行；单文件使用同步文件读取/mtime 检查与同步 SQLite。`instrumentation.ts` 在 Node runtime、非 demo 形态下异步排入 `createAgentLoop().start()`，启动 agent-loop 后再创建秘书。

本设计不主张上述实现已经造成可感知的慢；“优化有效”必须由相同输入和环境下的重复测量证明。

## Solution

在三个独立的设计切片中先采集基线，再比较保留既有外部行为的候选实现。候选方案允许独立实施、独立验收；没有三项必须同一发布的依赖。若基线没有显示稳定且超过噪声的改善，不以“性能优化”为由推进该切片。

### 已确认方向

| 切片 | 用户确认的方向 | 可观察行为与正确性约束 |
| --- | --- | --- |
| 消息合并 | 用 `Set` 替换 `prev.some` 的成员检查，只把 `prev` 的 ID 装入集合，不在遍历 incoming 时添加 ID。 | 空 incoming 仍返回同一 `prev` 引用；保留 `prev` 内部重复；排除 ID 已在 `prev` 的 incoming；incoming 自身重复仍逐个保留；结果仍按 `seq` 升序且不修改输入。只改变查重数据结构，不改变消息内容/合并时机。 |
| 短 token 搜索 | 混合查询可由长度至少 3 的 token 生成 FTS 候选，再用原有 LIKE 语义验证短 token；纯 1–2 字符查询先保留 LIKE。纯短查询只有基线证明值得时才另行评估双字符索引/迁移。 | 每个 token 仍须命中（AND）；短词 CJK 仍能匹配；通配符转义、摘要、limit、成员资格过滤与各路径原排序不变。所有长 token 查询仍按 rank；纯短和混合查询仍按 rowid DESC，即使混合查询用 FTS 候选也必须维持旧 LIKE 排序。 |
| 启动补拉 | 把 backfill 从启动关键路径移出，以可取消、有界分批扫描让出 Node 主事件循环；按 agent/target 建立独立串行屏障。 | 对应键的 wake 在补拉结束前排队；成功补拉或所有权门禁明确拒绝后才放行。可恢复文件系统/扫描/写入异常时保留该键待处理与游标，不阻塞其他就绪键；错误可观察、可重试，有限次重试耗尽后该键隔离，待显式重试或进程重启。其余恢复语义及 agent-loop 的既有行为不变。 |

### 性能基线与重复测量

- 先固定运行环境、SQLite 数据快照和可重放输入；有合适代表性数据时从现有数据形态抽取规模与分布，不适合使用真实数据时以合成数据建立可重放的小/中/大规模集合。报告记录数据规模、输入、运行环境和命令/脚本入口，不对外暴露真实消息正文。
- 每个基准预热后至少采集 30 个计时样本，报告原始样本、中位数、P90 与离散程度；基线与候选使用同一输入、数据快照和环境。
- **合并**：交叉测量 prev/incoming 长度增长、ID 重叠率及重复 ID 分布；分别记录合并/排序整体耗时及集合查重耗时（若工具允许拆分）。用语义测试确认 Set 候选与现状参考结果逐元素一致。
- **搜索**：消息总量逐级增长；查询覆盖 1/2/3+ 长度、纯 CJK 短词、长短混合、中日文/拉丁混合及多 token AND。分开记录 FTS、纯短 LIKE、混合候选路径的耗时与扫描规模；对相同输入逐 ID 比较结果，确认摘要、顺序、limit 和成员过滤相同。
- **补拉**：构造不同 agent 数、session 文件数/大小及 marker 轮数的数据集；记录扫描阶段、文件分批让出、从调用 start 到返回，以及 driver/cron 可用时间。注入读文件/写入失败并记录屏障等待、重试和恢复时间；不使用用户 live 数据，不捏造当前基线数字。
- 不预设最低百分比。候选必须在事先记录的目标规模上有稳定且超过噪声的改善，并通过行为与正确性验收；报告负向结果、未改善的规模区间及额外复杂度。若切片内出现性能回归，先决定是否值得其余收益，不以平均值掩盖。

## User Stories

1. 作为查看频道或线程消息的人，我希望轮询增量合并后仍得到同一组消息、同一 seq 顺序，而重复消息不会因更快的查找而意外消失或新增。
2. 作为搜索短中文/日文词的人，我希望短词仍能命中原有消息；混合长短 token 查询在降低候选开销时，结果内容、顺序、摘要和可见范围仍与原规则一致。
3. 作为使用 Worksplice 的人，我希望服务启动时消息补拉不长时间占住主事件循环；在恢复期间到来的 wake 不会绕过补拉造成重复回答、漏读或游标跳跃。
4. 作为维护者，我希望能用可重放数据比较每项优化与现状，而不是依赖主观感觉或无法复现的单次数字。

## Implementation Decisions

1. **消息合并保持非集合化语义**：预建 `Set(prev.map(m => m.id))`，过滤条件仅看该集合且不扩充集合。这样保留 prev 内已有重复，也保留 incoming 内部重复；若未来要全局 ID 唯一化，需另行提出用户可见行为变更。对空 incoming 保持早返回，以维护引用相等这一调用方可观察性质。
2. **搜索优先用索引缩小混合查询候选，但不改匹配语义**：当前任何短 token 都让整条查询走 LIKE。候选设计只在有至少一个长度 ≥3 的 token 时用这些长 token 建候选，再以原有转义 LIKE AND 条件验证全部 token。FTS 候选必须是旧 LIKE 匹配集合的超集；大小写、标点或 tokenizer 差异若可能漏掉 LIKE 命中，则该候选路径不能启用，须差分验证并保留安全回退。候选 SQL 必须在短 token 验证后再应用最终 limit；不能先截断 FTS 候选再过滤造成漏结果/少结果。混合候选路径按 `rowid DESC` 排序，以匹配现有 LIKE 路径，而不是把已有结果排序悄悄改成 rank。此处 rowid DESC 是用户对“保留现有按查询路径区分的排序”的明确澄清：混合查询现状属于 LIKE 路径；只有所有 token ≥3 的查询使用 rank。
3. **纯短查询保守处理**：现有 trigram tokenizer 对小于 3 字符 token 不提供可用 trigram 候选；因此先保留纯短 LIKE 扫描。新增双字符索引会带来存储、维护、初始化和 schema 迁移成本；只有基线显示纯短查询值得该复杂度时，才作为单独设计评估，不预先扩展本票。
4. **访问范围与 limit 是既有契约**：不改 `searchMessages` 的成员可见频道过滤；成员面依旧先最多取 `MAX_SEARCH_LIMIT=50` 再过滤，Owner 面仍直接按请求 limit 取结果。不改变该既有“宁少不泄”的上限行为，不增加跨范围查询。空查询、`LIKE` 特殊字符转义、snippet HTML 转义/高亮及 FTS trigger 同步均保持。
5. **补拉应当分批 yield，而非只包一层 Promise**：当前文件读取、stat 与 SQLite 均为同步操作；只把既有全量函数放进 Promise 并不能降低事件循环阻塞。实施需要有界工作单元和让出点，并提供可取消生命周期。当前 driver 的 `queues`、`processing` 与 `waitingForSettle` 均以 agent 为键，`waitForSettle` 会阻塞该 agent 的整个队列；实现必须把 backfill 阻塞/隔离状态落实到 `(agent, target)`，park 单个被阻塞目标且继续依序处理同 agent 其他就绪目标，同时维持每个 agent 最多一个 `runAgentRound` 在执行。现有 `busy` / `busy-cwd` settle 等待仍按 agent 级串行，不将按键独立屏障误解为同 agent 并发 round。
6. **补拉错误与屏障**：所有权门禁明确拒绝是结束态（维持现有整文件跳过、不推进游标，并允许该键继续正常 wake）；文件系统瞬时错误不是门禁拒绝。对已固化绑定文件的实际 `ENOENT` 保留现有“session file missing on disk”门禁结果：不补写、不推进游标并放行对应 wake。`readSessionHeaderCwd` / `scanSessionReplies` 当前把部分读取失败折叠为 `null` / `[]`，`existsSync` 也可能把无权访问表现成不存在，`statSync` 则会抛错；后台实现必须用能区分 `ENOENT` 与其他文件操作错误的方式，避免把 EACCES、I/O error、临时 stat/read/scan/write 错误误判为缺失或所有权拒绝。后者需记录原因、使对应 agent/target 继续 pending、不推进游标并可重试。隔离键可重试，其他键继续工作；实现需避免重复并发补拉/round。耗尽有限重试后保留隔离状态直到显式重试或新进程恢复扫描。具体最大重试数、退避值及显式重试 seam 留给实施票基于基线和现有 driver 结构落定，不在本设计编造常量。
7. **依赖与交付独立性**：三项无数据契约依赖，可分别实现和发布；共享的只有基线纪律。搜索若最终需要双字符索引会引入 schema 依赖，必须单独规划迁移/兼容与回滚；在获得新裁决前不包含在本规格。Coordinator 在合并设计后执行 to-spec → to-tickets，确定拆票、依赖和发布顺序。

### 与现有决策的关系

- 与 **ADR-0005** 一致：优化不得削弱 agent-loop 的可靠性、错误可观测性或既有 cursor 语义；本设计不改模型重试/回复规则。
- 与 **ADR-0008** 一致：`lib/agent-loop/loop.ts` 仍作为 round/driver/backfill/cron 的单文件深模块，不借启动优化拆成新的文件或扩大 `index.ts` 导出面；按其窄 public entry point 使用现有 seam。
- 遵守 **ADR-0003**：`pi_session_file` 固化仍是唯一所有权凭证；启动补拉不得解析无主会话文件。
- 遵守 **ADR-0004** 与 `CONTEXT.md` 的 backfill 归属门禁：header cwd 等于成员 workspace、文件不被其他成员（含 soft-delete 登记）引用、mtime 不早于成员创建时间；任一不符整文件跳过，不补写、不推进游标、不清绑。跨作者 `(target, content)` 去重命中时跳过对应轮次且 target 游标保持 pending。
- 保留 `scanSessionReplies` 的轮次语义：每个 marker 轮只取最后一条 assistant 文本；revise 草稿不作为回复；同作者同 target 同内容的写入幂等。marker 存在表示 prompt 已进入上下文，已存在的回复轮仍将游标推进到 marker seq；不得以“加速”为由只在插入时推进、漏推进崩溃窗口。

## Testing Decisions

本票是设计票，未修改产品源码/测试，**不运行测试、typecheck、lint、双轴 code-review 或真浏览器几何验收**。实施票应优先复用现有测试 seam：

- `hooks/useChannelData.test.mjs`：验证 empty 返回同一引用、prev 内重复保留、与 prev 冲突的 incoming 被排除、incoming 内重复保留、seq 排序稳定、输入不被修改；以现状参考实现对小型重复/乱序集合做确定性差分验证。
- `lib/domain/collab/search.test.mjs` 与 `lib/domain/collab/dm-features.test.mjs`：覆盖纯短 CJK、混合长短 AND、多语言、LIKE `%`/`_`/反斜杠转义、snippet 高亮、FTS/LIKE 排序各自保持、默认/最大 limit、成员过滤先取最多 50 再过滤的权限/数量语义；对同一组数据比较候选与旧实现完整命中 ID 序列。
- `lib/agent-loop/backfill.test.mjs` 与 driver 测试：验证启动先返回/后台扫描可 yield、成功键屏障释放、未完成键 wake 保持排队、不同键可前进；同一 agent 的两个 target 中，一个 backfill 阻塞/隔离不妨碍另一个按序运行，且同一 agent 同时至多一个 round；busy/busy-cwd settle 仍阻塞该 agent 后续 round。验证真实 ENOENT/missing-file 与所有权拒绝按现有门禁 no-op 释放；可恢复 EACCES/读/stat/扫描/写入错误不释放、不推进、可见且可重试；重试幂等、停止取消分批工作、每 marker 最后一条 assistant/修订草稿规则、跨作者内容去重、同作者去重、marker 序号游标收口。另以启动调度测试覆盖状态扫掠、backfill、driver、cron 的 ready 顺序和 coordinator 选择的停止/重启语义。
- 性能 harness 不替代语义测试；固定随机种子/数据快照，跑本规格规定的至少 30 个预热后样本，并归档输入规模、原始样本与统计。任何性能结果必须附一组相同输入的完整结果集等价检查。

## Out of Scope

- 修改源码、测试、schema 或实际执行三项优化；本票只记录设计。
- 预设三项同批发布、优先级、票据拆分数量或发布顺序；由 coordinator 在合并设计后规划。
- 纯短 token 的新索引/schema 迁移；待基线证明确有价值后另行设计。
- 改变消息重复/排序/可见性/摘要、搜索权限/limit、agent 回复协议、session 文件格式、backfill 所有权、跨作者去重、轮次抽取或游标推进规则。
- 为了启动性能改变 `lib/agent-loop/loop.ts` 的深模块形态、将 SDK 会话文件写入权移给 app，或依赖真实用户库进行测量。
- 声称一个预先指定的性能百分比、延迟目标或已达到的数字；本票没有测量数据支撑这些断言。

## Further Notes

### 代码与测试核验索引

- 合并函数及调用：`hooks/useChannelData.ts:103-116,137-147`、`components/ThreadPanel.tsx`、`hooks/useChannelData.ts`；测试 `hooks/useChannelData.test.mjs` 和 `components/ChannelView.test.mjs`。
- 搜索：`lib/data/sqlite.ts:408-446`、`lib/data/types.ts:179-187,204-237`、`lib/domain/collab/search.ts:20-51`；测试 `lib/domain/collab/search.test.mjs`、`lib/domain/collab/dm-features.test.mjs`。
- 启动与恢复：`lib/agent-loop/loop.ts:1824-1971,2051-2091`、`instrumentation.ts:18-51`；测试 `lib/agent-loop/backfill.test.mjs` 与相关 driver/round 用例。
- 领域/架构依据：`CONTEXT.md` 的“会话文件”“无主文件”“backfill 归属门禁”“跨作者内容去重”“轮次”“深模块”；ADR-0003、ADR-0004、ADR-0005、ADR-0008；`docs/agents/domain.md`。

### 文档裁决

- 未新增 `CONTEXT.md` 词条：Set 查重、FTS 候选过滤、性能基线、启动屏障均是本地实现/测量概念，不构成新的产品领域概念。
- 未新增 ADR：本设计选择的候选均可撤回，并且尚未形成要求稳定全局约束的难逆转决定；背后取舍已在本规格记录。纯短词索引/schema 迁移仍未决定，不应提前形成 ADR。
- 本票只产出本目录的 `spec.md` 与设计 issue；不编辑其他文档或代码。
