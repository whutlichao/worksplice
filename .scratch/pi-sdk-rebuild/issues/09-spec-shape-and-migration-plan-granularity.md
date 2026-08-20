# 09-spec 文档形态与迁移计划颗粒度

Type: grilling
Status: open
Blocked by: 06

## Question

决策重构 spec 文档的形态与迁移计划的颗粒度（地图终点的交付物形态）。

- spec 形态：沿用 `docs/spec.md` 8 章结构 + Mermaid 架构/ER 图 + ADR 索引，还是为重构单立 `docs/spec-rebuild.md` / `docs/rebuild-plan.md`；章节是否包含「现状盘点→目标架构→分步 ticket→兼容清单→成本基线」五段式
- 迁移计划颗粒度：分步 ticket 的切分维度（按深模块 / 按数据表 / 按稳定性主题）、每步的验收门禁（tsc/lint/test + 手动验证清单）、与 `docs/adr/` 的联动
- 调用 `grilling` + `domain-modeling`：以 `docs/engineering-standards.md` 的流程纪律为约束，确定 spec 的验收标准（类 `docs/spec.md` §8 的 5 条客观标准）与确认流程
