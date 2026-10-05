# 04 — 撰写 spec 草稿

Type: task
Status: resolved
Assignee: worksplice-dev (this session)
Blocked by: 01, 02, 03

## Question

基于 01–03 的产出 + map 的 16 项已锁决策，撰写 `docs/spec-bootstrap-agent.md` 草稿：

- 章节结构：概述与定位 / 角色形态（普通成员、秘书角色） / 能力边界与权限 / 行为规则（开口规则、关键节点、兜底） / 知识体系（MEMORY.md + SYSTEM-GUIDE.md 大纲） / 创建流程（首次启动自动创建 + UI 降级引导 + 唯一性 + 删除语义） / 频道覆盖规则（公开必加、私有默认加） / 构建 effort 交付清单（含手册更新步骤） / 验收标准
- 与主 spec（docs/spec.md）一致：复用术语、引用既有章节（agent-loop、inbox、channel 成员机制），不重复定义
- 写作中展开 Not yet specified 里可定项：身份细节（名字/描述/头像，与 Owner 确认）、自动创建时机与幂等判定、API 地址来源
- 交付后按验收标准自检，交用户逐章通读确认（ticket 05）；agent 不自证合格

## Answer

spec 草稿已产出：**`docs/spec-bootstrap-agent.md`**（九章：概述与定位 / 角色形态 / 能力边界与权限 / 行为规则 / 知识体系 / 创建流程 / 频道覆盖规则 / 构建 effort 交付清单 / 验收标准），供 ticket 05 逐章确认。

- **fog 展开**：身份细节经 Owner 确认（名字 **Susan**、描述推荐版、头像沿用 seed=member id 机制，§2.3）；自动创建时机与幂等判定已定（启动路径 + 名字全等 + deleted 标记，§6.1）；API 地址来源引用 01 结论（§3.3）。
- **新增 [展开] 项**（05 放行后锁定）：初始化流程五步（§6.2，含 MEMORY.md 整体重写为速查结构 + 办公室频道幂等创建 + Owner 署名欢迎事件）；启动助手入口形态（§6.3）；同名边角与删除语义（§6.4）；频道覆盖维护细节含"欢迎事件排除 Susan 自己"（§7）；手册保鲜落地形式（§5.5）。
- **自检**：九章齐全无 TBD / 17 项已锁决策全覆盖 / 术语沿用主 spec §1.3（新术语仅在 §1.3 定义）/ Out of scope 引用 map / §8 交付清单 15 项可开工——按 §9.1 五条全部通过（agent 不自证合格，最终确认归 ticket 05）。

## Answer
