# 07 — spec 文档形态

Type: grilling
Status: resolved
Blocked by:

## Question

spec 文档的形态：读者（人类 + 实现 agent）、格式与粒度（章节结构）、存放位置（docs/）、验收标准（如何算确认、由谁确认）。

## Answer

- **位置**：`docs/spec.md`（仓库根 `docs/` 下，与 `docs/agents/` 并列；不进 `.scratch/`，不建 `docs/specs/` 子目录）
- **格式**：Markdown，含两张 Mermaid 图（整体架构图、数据模型 ER 图），其余一律表格 + 文字
- **章节结构（8 章，已确认）**：
  1. 概述（愿景、读者、术语表）
  2. 产品范围（核心能力 + Out of scope 清单）
  3. 用户体验与交互（骨架 UI、agent 详情面板、任务板状态机、inbox 拉取、修正流程）
  4. 视觉设计 token（马卡龙色板、Space Grotesk、2px 粗边框、仅亮色）
  5. 技术架构（pi 多实例、前后端结构、pi-web 组件库化改造策略）
  6. 数据模型（better-sqlite3 表结构、`UNIQUE(target_id, seq)`、freshness-hold、token/成本只读解析）
  7. 命名与品牌脱钩（worksplice、标识符替换清单、保留不动的 pi SDK 接口面）
  8. 验收标准（本 spec 如何被确认合格）
- **读者**：人类 + 实现 agent（ticket 原文给定）
- **验收标准（已确认）**：① 八章齐全且无遗留开放问题（TBD）；② 与地图 6 个已锁决策一致，不一致处显式标注理由；③ 术语与 glossary 用词一致；④ Out of scope 与地图一致；⑤ 实现 agent 凭 spec 可写出表结构/组件清单/改造步骤而无需再问（"实现 agent 试读"检查，保留）。最终确认权在人类——逐章通读后明确说"确认"，agent 不自证合格。
