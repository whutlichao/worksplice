# 09-spec 文档形态与迁移计划颗粒度

Type: grilling
Status: resolved
Blocked by: 06
Assignee: wayfinder-09

## Question

决策重构 spec 文档的形态与迁移计划的颗粒度（地图终点的交付物形态）。

- spec 形态：沿用 `docs/spec.md` 8 章结构 + Mermaid 架构/ER 图 + ADR 索引，还是为重构单立 `docs/spec-rebuild.md` / `docs/rebuild-plan.md`；章节是否包含「现状盘点→目标架构→分步 ticket→兼容清单→成本基线」五段式
- 迁移计划颗粒度：分步 ticket 的切分维度（按深模块 / 按数据表 / 按稳定性主题）、每步的验收门禁（tsc/lint/test + 手动验证清单）、与 `docs/adr/` 的联动
- 调用 `grilling` + `domain-modeling`：以 `docs/engineering-standards.md` 的流程纪律为约束，确定 spec 的验收标准（类 `docs/spec.md` §8 的 5 条客观标准）与确认流程

## Answer

**决策总览（1 轮 grilling，7 问全 A，人类接受推荐，domain-modeling 同步）**：

**spec 落点（Q1）**：
- **单独立档 `docs/spec-rebuild.md`**：`docs/spec.md`（486 行 8 章，2026-08-03 已确认）保持产品事实来源锁定不变；技术重构另立 `docs/spec-rebuild.md` 独立技术 spec；不单立 `docs/rebuild-plan.md`（避免与 `docs/release.md` 发布计划混淆），不追加 `spec.md v2` 章节。

**章节骨架（Q2）**：
- **五段式 + 附录**（不复刻 8 章）：`1 现状盘点 → 2 目标架构 → 3 分步迁移 → 4 兼容清单 → 5 成本基线` + 附录 `A Mermaid 全图 / B 7域22文件模块清单 / C ADR 索引 / D 术语增量 / E 原型链接`。五段分别直引 `03 E01-E69` / `06 Mermaid+模块清单` / `04-06 深模块依赖序` / `08 单向前兼容+三件套备份` / `05 双视图成本看板`。

**切分维度（Q3）**：
- **主轴按深模块、横切按稳定性/兼容验收（混合）**：一期 `lib/cwd-mutex.ts` 独立 + `realpathSync` 单测；二期 `lib/rpc` 四件套收窄 + `lib/model-scope thin adapter`（04）；三期 `lib/agent-loop` 不拆文件但落地 `MAX_REVISE 1 / prompt_tokens 三列 + 双视图`（05）；UI B·Guided Journey 首版（旅程条+空状态+···收敛）随三期验证。数据表无独立切分（v12 仅 `round_logs` 三列，ADR-0006），稳定性主题不单列 ticket。

**每步验收门禁（Q4）**：
- **硬门禁 + 4 项手动清单**：硬门禁 `tsc --noEmit + npm run lint + npm test (347 用例)` 全绿（`docs/engineering-standards.md §2.2`），绝不 `next build`；手动清单 ① `isCwdBusy/findBusySession` 共享 project 目录并发串行 ② `chooseSessionFileForStart` 固化 + `backfillOwnershipGate` 回放无误判 ③ `round_logs.prompt_tokens/cost` 可观测页 badge 非空 ④ 热重载三守卫 `__workspliceDb/__workspliceSessions/__workspliceWakeListeners` 重启后无旧闭包残留。

**ADR 联动（Q5）**：
- **spec 摘要 + 链接，不重述**：正文每段末尾「详见 ADR-000N 行号」指向 0005–0008 已立 ADR，本决策立 **ADR-0009 `spec 形态：独立 docs/spec-rebuild.md 与五段式排期`**（`docs/adr/0009-spec-shape-and-migration-plan.md`），避免双写漂移。

**验收标准与确认流程（Q6）**：
- **5 条可测标准 + 按段逐章确认**（复刻 `raft-clone ticket 09` 成功路径）：
  1. 行号可追溯（`research/01-03 + 04-08 Answer + ADR-0005~0009` 无孤证）
  2. 全量门禁全绿
  3. 图表零漂移（Mermaid 与 7域22文件清单与 06/ADR-0008 一致）
  4. 兼容可回滚（v11→v12 单事务幂等 + 三件套文件覆写回滚可演示）
  5. 旅程可演示（`prototype-ui/index.html?variant=b` B 首版可点通 `describe→hand off→let it run→review`，秘书五步流闭环）
- 确认流程：人类按五段逐段放行，全部放行后在 `spec-rebuild.md` 头部标 **已确认（日期，ticket 09）**，随后另起 effort 按 §3 四期执行（Plan, don't do 边界不越线）。

**术语（Q7，domain-modeling）**：
- **不新增 glossary**：`CONTEXT.md` 已含 6 条增量（SDK 委托边界/薄 Wrapper/深模块/唯一导入面/Cwd 互斥/成本看板）117 行已够；09 的文档形态词（重构 spec / 迁移计划 / 验收标准）仅为过程词，不入领域词表；用词在 `docs/engineering-standards.md` 与 ADR-0009 约束（统一叫 `spec-rebuild.md`）。

**交付物**：
- `docs/spec-rebuild.md` 五段式骨架已落盘（6 章 + 附录 A-E，Mermaid 全图与模块清单直接引用 06）
- `docs/adr/0009-spec-shape-and-migration-plan.md` 已立
- `CONTEXT.md` 无新增，保持领域纯粹

**对后续 effort 输入**：
- 执行 effort 按 `spec-rebuild.md §3 四期` 切 ticket（tracker 原生 blocking 生 frontier 视图），每期验收见上表；执行本身不在本 wayfinder 地图内（Plan, don't do）。
- `docs/spec.md` 产品锁定稿与 `docs/spec-rebuild.md` 技术重构稿分离，前者不因重构而变更。

> Grilling 1 轮 7 问全 A；`domain-modeling` 确认无新增术语、ADR-0009 已立。
