# spec 形态：独立 docs/spec-rebuild.md 与五段式排期

**背景**：wayfinder `pi-sdk-rebuild` 地图 8 票已决（01 pi SDK 能力边界 / 02 数据层保留 Store 57 / 03 库存量 E01-E69 / 04 SDK 委托边界 + 05 agent-loop 重塑 + 06 目标架构七域 22 文件 + 07 UI B·Guided Journey + 08 单向前兼容 v12 三列增量），仅剩 **09-spec 文档形态与迁移计划颗粒度** 未定。`docs/spec.md`（486 行，8 章，2026-08-03 已确认锁定）为产品事实来源，不宜追加技术重构内容；重构终点（`map.md Destination`）要求一份可交付的技术 spec + 分步迁移计划，保留 raft 语义与数据兼容、收敛 SDK 为中层底座、解决成本/可靠性/可观测性、UI 信息架构重做。需冻结 spec 落点、章节骨架、切分维度、验收门禁、ADR 联动与确认流程（ticket 09，1 轮 grilling 7 问全 A，人类接受推荐）。

**决策（ticket 09）**：
- **落点：单独立档 `docs/spec-rebuild.md`**：`docs/spec.md` 保持产品 spec 锁定不变（`spec.md:1-6 已锁决策索引` 不动）；技术重构另立 `docs/spec-rebuild.md`，`docs/rebuild-plan.md` 不单立（避免与 `docs/release.md` 发布计划混淆），`docs/spec.md` 不追加 v2 章节。
- **章节骨架：五段式 + 附录**（不复刻 8 章）：`1 现状盘点 → 2 目标架构 → 3 分步迁移 → 4 兼容清单 → 5 成本基线` + 附录 `A Mermaid 全图 / B 7域22文件模块清单 / C ADR 索引 / D 术语增量 / E 原型链接`。五段分别直引 `03 E01-E69 库存量` / `06 Mermaid + 模块清单` / `04-06 深模块依赖序` / `08 单向前兼容 + 三件套备份` / `05 双视图成本看板`。
- **切分维度：主轴按深模块，横切按稳定性/兼容验收（混合）**：一期 `lib/cwd-mutex.ts` 独立（`realpathSync` 单测）；二期 `lib/rpc` 四件套收窄 + `lib/model-scope thin adapter`（04 证据链）；三期 `lib/agent-loop` 不拆文件但落地 `MAX_REVISE 1 / prompt_tokens 三列 + 成本看板双视图`（05）；UI B 首版 `旅程条 + 空状态 + 折叠` 随三期验证。数据表无独立切分（v12 仅 `round_logs` 三列，ADR-0006），稳定性主题不单列 ticket、随模块落地验收。
- **每步验收门禁：硬门禁 + 4 项手动清单**：硬门禁 `tsc --noEmit + npm run lint + npm test (347 用例)` 全绿（`docs/engineering-standards.md §2.2`），绝不 `next build`；手动清单 ① `isCwdBusy/findBusySession` 共享 project 目录并发串行 ② `chooseSessionFileForStart` 固化 + `backfillOwnershipGate` 回放无误判 ③ `round_logs.prompt_tokens/cost` 可观测页 badge 非空 ④ 热重载三守卫 `__workspliceDb/__workspliceSessions/__workspliceWakeListeners` 重启后无旧闭包。
- **ADR 联动：spec 摘要 + 链接，不重述**：正文每段末尾「详见 ADR-000N 行号」指向 0005–0008 已立 ADR；本决策本身立 `ADR-0009`（文档形态为 hard-to-reverse 的契约）；不复制 ADR 正文，避免双写漂移。
- **确认流程：按段逐章确认**（复刻 `raft-clone ticket 09` 成功路径）：每段独立放行，人类按五段逐段确认，全部放行后在 `spec-rebuild.md` 头部标 **已确认（日期，ticket 09）**，随后另起 effort 执行迁移（`map.md Notes: Plan, don't do` 边界不越线）。
- **术语（domain-modeling）：不新增 glossary**：`CONTEXT.md` 117 行 4+2 条增量（SDK 委托边界/薄 Wrapper/深模块/唯一导入面/Cwd 互斥/成本看板）已够，09 的文档形态词（重构 spec / 迁移计划 / 验收标准）仅为过程词，不入领域词表；用词在 `docs/engineering-standards.md` 与本 ADR 约束（统一叫 `spec-rebuild.md`，不叫 `rebuild-plan.md`）。

**Consequences**：
- `docs/spec-rebuild.md` 可直接以五段式开写，每段行号可追溯到 `03/04/05/06/08 + ADR-0005~0008 + prototype-ui`，图表零漂移。
- 分步 ticket 按 `cwd-mutex → lib/rpc → lib/agent-loop → UI B` 依赖序天然顺排，每步零 schema（`runMigrations` 单事务全量幂等每次全量跑，分期仅为排期）。
- 验收 5 条可测标准（见 `spec-rebuild.md §6 验收标准`）成为独立 effort 的合闸条件：行号可追溯 / 门禁全绿 / 图表一致 / 兼容可回滚 / 旅程可演示。
- `CONTEXT.md` 保持领域纯粹，文档纪律不污染 glossary；`docs/spec.md` 产品锁定稿不受技术重构影响。

**Status**: accepted
