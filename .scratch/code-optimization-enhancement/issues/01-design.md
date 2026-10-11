# 01 — 三项代码优化设计

Type: grilling
Status: resolved
Blocked by: None

本票核验并设计消息合并、短 token 搜索、agent-loop 启动补拉三项候选优化；三项均纳入的范围由用户先前“1 2 3 一起”人定。设计正本为 [spec.md](../spec.md)。本票不实现源码、不改测试；不运行测试/typecheck/lint、双轴 review 或真浏览器验收，按 G-docs 收口。

## Answer

### Grill 轮次索引

| 轮次 | 问题范围 | 答复 |
| --- | --- | --- |
| 第 1 轮 | Q1 合并重复行为；Q2 搜索排序；Q3 启动顺序/屏障目标；Q4 性能基线 | coordinator 回复“按推荐方案执行，并记录为用户决策”，四项均已回答。 |
| 第 2 轮 | Q1 纯短词是否扩展索引；Q2 后台补拉失败收口；Q3 样本与统计门槛；Q4 事件循环让出 | coordinator 回复“四项都按推荐方案执行，并记录为用户决策”，四项均已回答。 |
| 第 3 轮 | 混合搜索路径的最终排序 | worker 发现两轮决定的实现交叉点后追加 ask；用户答复该问题已由第一轮“保留当前按查询路径区分的排序”覆盖，混合查询仍按 rowid DESC，只有全长 FTS 查询按 rank。 |
| 补充澄清 | backfill 文件错误分类 | 用户确认真实 ENOENT 维持当前 missing-file 门禁 no-op；EACCES/其他文件 I/O 错误不能折叠成缺失，须保持 pending 并重试。 |

设计树 frontier 已清空；无需保留 pending ask。此前“三项一起”仍是用户直接确认的范围决定，未在访谈中重复询问。

### Q→A 审计

#### 范围 — 三项是否全部纳入
**既定决定 → A（人定）**：消息合并、短 token 搜索、启动补拉三项全部纳入本 effort。

**理由**：用户上一轮明确答复“1 2 3 一起”；本设计负责完整覆盖，不把范围决定再交由推荐方案替代。

#### 第 1 轮 Q1 — 消息合并的重复语义
**Q1 → A（人定；coordinator 确认按用户决策记录）**：只用 Set 替换 `prev.some` 的重复查询，Set 仅预载 prev IDs，不把 incoming ID 继续加入集合。空 incoming 仍回同一引用；prev 内部重复保留；incoming 中与 prev 相撞的项过滤；incoming 内部重复仍保留；最后仍按 seq 排序。

**理由**：这是纯查重复杂度优化，不借机改变消息可观察语义。

#### 第 1 轮 Q2 — 搜索排序
**Q2 → A（人定；coordinator 确认按用户决策记录）**：全长 token FTS 路径保留 rank 排序；短词 LIKE 路径保留 rowid DESC。跨路径不统一排序，混合路径候选优化也必须保持旧 LIKE 的 rowid DESC。

**理由**：不把性能优化变成搜索结果排序变更。

**第 3 轮澄清 → A（人定）**：混合查询原本因含短 token 而走 LIKE；即使优化后用长 token FTS 取候选，最终仍按 rowid DESC。只有所有 token 均 ≥3 的查询继续按 rank。

**理由**：排序归属由用户明确的既有查询路径裁决，不由候选生成器的内部实现决定。

#### 第 1 轮 Q3 — 补拉与启动顺序
**Q3 → A（人定；coordinator 确认按用户决策记录）**：backfill 从启动关键路径移出；相关 agent/target 的 wake 在补拉前排队，补拉与 wake 串行；失败可观察且可恢复，同时保留 ADR-0003/0004 所有权、跨作者去重及 marker/cursor 语义。

**理由**：减少启动等待不应引入竞跑或削弱既有恢复安全性。

#### 第 1 轮 Q4 — 性能测量纪律
**Q4 → A（人定；coordinator 确认按用户决策记录）**：先建立可复现基线，在同一数据和环境下比较，报告原始样本、中位数与离散程度；搜索覆盖 query 长度/CJK/数据量，合并覆盖规模和重叠，补拉覆盖文件数/大小与 scan、driver/cron ready 时间；无证据不承诺百分比收益。

**理由**：候选方向不能替代性能证据。

#### 第 2 轮 Q1 — 纯短词搜索范围
**Q1 → A（人定；coordinator 确认按用户决策记录）**：混合查询以至少一个 ≥3 字符 token 生成 FTS 候选，再以 LIKE 验证短 token；纯 1–2 字符查询暂保留 LIKE。只有基线证明值得时才另行评估双字符索引/迁移。

**理由**：FTS5 trigram 无法直接为 1–2 字符 token 提供候选；新索引会引入存储、维护、迁移成本，先不假定这项成本值得。

#### 第 2 轮 Q2 — 后台补拉失败时的键屏障
**Q2 → A（人定；coordinator 确认按用户决策记录）**：按 agent/target 维持独立屏障。补拉成功或所有权门禁明确拒绝后释放对应键；可恢复扫描/写入错误时该键继续排队、游标不推进，错误可观察并可重试；其他就绪键可运行；有限重试耗尽则隔离到显式重试或进程重启。

**理由**：失败不能被误当成恢复成功，同时避免单键故障全局阻塞。

**补充裁决 → A（人定）**：真实 `ENOENT`（绑定文件不存在）沿用当前“missing file”门禁：不补写、不推进游标并放行对应 wake；EACCES 与其他 stat/read/scan/write I/O 错误必须保持键 pending、记录并重试，不得被 `existsSync` false 或 `null` / `[]` 折叠成缺失。有限重试后按已确认策略隔离。

**理由**：保留明确缺失文件的既有 no-op 行为，同时不把暂时无权访问或 I/O 失败误报成所有权门禁结果。

#### 第 2 轮 Q3 — 基准统计与改善门槛
**Q3 → A（人定；coordinator 确认按用户决策记录）**：预热后每个基准至少 30 个样本；固定环境/数据，覆盖小中大规模并留可重放输入，报告中位数、P90 和离散度。要求指定目标规模上有稳定且超过噪声的改善，且正确性/行为不回归；不指定最低百分比。无数据基线时记录可重放合成规模。

**理由**：避免用不可复现的单次数字或未经用户确认的提升比例作验收。

#### 第 2 轮 Q4 — 事件循环让出
**Q4 → A（人定；coordinator 确认按用户决策记录）**：backfill 采用可取消、有界分批扫描并定期让出 Node 主事件循环，按键屏障仍须保留。只有基线证明分批仍达不到启动目标，才评估 worker thread/子进程。

**理由**：现有读文件、stat 与 SQLite 操作都是同步的；包一层 Promise 不会消除主事件循环阻塞。优先用较小实现复杂度的有界分批。

#### 后续澄清 — 文件系统错误不是所有权门禁拒绝
**用户补充 → A（人定）**：实施设计须区分所有权门禁拒绝与可恢复文件系统错误。现有 `readSessionHeaderCwd` / `scanSessionReplies` 会将部分读取错误折叠为 `null` / `[]`，`existsSync` 可能把不可访问误表现为缺失，`statSync` 会抛错。瞬时读/stat/扫描错误必须让对应键保持 pending、不推进游标、可观察并重试，不能当作明确门禁拒绝而放行。

**理由**：不能将暂时读不到的会话文件误判为不归属；否则启动并发优化可能绕过仍需恢复的 marker 轮。

### 设计结论

- 三项候选及其完整行为约束、实现取舍、性能基线、测试决定与范围外事项见 [spec.md](../spec.md) 的七节结构。
- 现状核验确认：消息合并空 incoming 保持原引用且 incoming 自身重复不去重；搜索两路径的 AND/token、排序、limit/成员权限语义如 spec 所列；启动顺序与 ADR-0003/0004 的门禁、跨作者去重、轮次与游标收口均须保持。
- 三项都可独立交付，不预设一起发布或拆票方案；coordinator 在设计合并后执行 to-spec → to-tickets。
- 未新增 `CONTEXT.md`：没有新领域术语。未新增 ADR：没有满足“难逆转、缺少上下文会令人意外、来自真实取舍”三项的新全局决定；短词索引迁移仍未定。

### 改动文件与门禁证据

- 仅新增 `.scratch/code-optimization-enhancement/spec.md` 与 `.scratch/code-optimization-enhancement/issues/01-design.md`；没有修改源码、测试、`CONTEXT.md`、ADR 或其他文件。
- G-docs：spec 严格具备 Problem Statement / Solution / User Stories / Implementation Decisions / Testing Decisions / Out of Scope / Further Notes 七节；保存完整两轮 Q→A、人定记录、现状与 ADR 冲突检查、性能测量方法及验收决策。
- 按票据要求未运行测试、typecheck、lint、双轴 code-review 或浏览器验收。
- `.pi-lens.json` 已在仓库根本地创建并禁用自动格式化，且仅写入 worktree 对应的 git exclude；不纳入仓库差异。

### PR

PR **#147** — https://github.com/whutlichao/worksplice/pull/147。
