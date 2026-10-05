# 03 — 手册结构大纲（MEMORY.md + SYSTEM-GUIDE.md）

Type: prototype
Status: resolved
Assignee: worksplice-dev (this session)
Blocked by: 01

## Question

产出秘书两本手册的**章节大纲草稿**（artefact 供用户逐章反应/修改，最终并入 spec）：

1. **MEMORY.md 速查**（每轮 prompt 必读，必须精简）：身份与开口规则 / 能力边界（只读+创建类，不认领任务）/ 操作速查（建频道、建 agent 的 curl 命令一行式）/ SYSTEM-GUIDE.md 的读取指引
2. **SYSTEM-GUIDE.md 手册**（按需读取）：产品概念（频道/thread/任务板/提醒/inbox/搜索/附件/reaction/pinned）/ 系统 API 用法（只读类 + 创建类，含 curl 示例与地址来源）/ 常见操作路径（用户问"怎么 X"的标准指引）/ 权限边界与兜底话术 / 术语表
3. **内容来源**：哪些章节直接引用 `docs/spec.md` / `AGENTS.md` 的既有描述，哪些需新写；篇幅预算（速查 ≤ 数百行，手册可控）
4. 依赖 01 的 bash 工具可用性结论（curl 写法的可行性）

产出大纲后经用户确认即视为 resolved。

## Answer

大纲草稿已产出并经 Owner 逐章确认，资产：[manual-outline.md](../manual-outline.md)（已确认版，A 速查 5 章 ≤150 行 / B 手册 5 章完整缩写 / C 内容来源表 / D 三点全拍板）。

**Owner 拍板三项**（03-1/2/3）：
1. **MEMORY.md 整体重写为速查结构**——不与 ADR-0001 固定六节兼容，创建后重写、保留"当前工作"节名；构建 effort 交付清单按此写（`buildMemoryTemplate` 先落模板、秘书初始化流程随后覆盖，顺序细节归 spec 起草定）
2. **速查 curl 集 7 条够用**（频道/成员/发消息/建频道/建 agent/搜索/设提醒；provider/modelId 从 `GET /api/models` 现取）
3. **手册概念章完整缩写**（~25 行/概念，预算放宽至 ~700 行）

对 spec 起草（ticket 04）的影响：知识体系章节 = 本大纲结构 + 已确认内容；构建 effort 交付清单须含"初始化流程重写 MEMORY.md"步骤。

## Comments

- 2026-08-08（worksplice-dev）：prototype 资产已产出——[manual-outline.md](../manual-outline.md)。等 Owner 逐章反应（含 D 节三个待确认点）后写 Answer 收口。
