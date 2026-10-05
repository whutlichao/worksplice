# Map: 启动 agent（秘书）

> 状态：**已达成**（2026-08-08——spec 逐章确认通过，目的地交付；构建 effort 另起）

## Destination

一份经确认的《启动 agent（秘书）》设计 spec 文档（`docs/spec-bootstrap-agent.md`，简体中文）：普通 agent 成员形态的"秘书"角色——自动加入全部频道（公开必加/私有建时默认加）、熟悉系统（MEMORY.md 速查 + SYSTEM-GUIDE.md 手册）、bash+curl 代办创建频道/agent、首次启动自动创建（模型未配置时 UI 降级引导）、关键节点主动引导。spec 经确认后**另起构建 effort**。

## Notes

- 领域：worksplice（Next.js + agent-loop + raft 服务层），基于 `docs/spec.md` 已确认的主 spec
- **零机制改动原则**（charting 时用户确认）：秘书 = 普通成员身份 + 内容（MEMORY.md/SYSTEM-GUIDE.md/prompt 预设/创建引导），不碰 agent-loop / rpc-manager / raft 服务层的机制代码
- 文档正文一律简体中文
- 本 effort 只产出决策与 spec，不产出实现代码（"Plan, don't do"）
- 每 session 应 consult 的 skills：grilling（HITL ticket）、research（AFK ticket）、prototype（手册大纲草稿）、domain-modeling（术语）
- 已锁决策（charting 时用户确认，共 16 项）：
  - 目的地 = 独立 spec 文档，构建另起 effort
  - 形态 = 普通 agent 成员，复用现有架构；**秘书角色**
  - 频道覆盖 = 自动加入所有频道；公开必加、私有建时默认加（可取消）
  - 知识源 = MEMORY.md 速查（每轮必读）+ SYSTEM-GUIDE.md 详查（按需读取）
  - CLI 能力 = bash + curl 调本地 API（`bin/worksplice.js` 非管理 CLI，无认证 localhost API）；零机制改动
  - 创建方式 = 首次启动自动创建（幂等，已存在不重建）
  - 模型未配置 = 自动尝试 + UI 降级引导（创建 agent 弹窗内「创建启动助手」入口）
  - 唯一性 = 全系统唯一；删除后不自动重建，手动入口保留
  - 开口规则 = 被动为主（被 @ 才答）+ 关键节点主动（新 agent 加入欢迎/新频道报到/Owner 首次登录欢迎）
  - 服务对象 = 人类 Owner 为主，其他 agent 也可 @ 求助
  - 操作权限 = 只读 + 创建类（查频道/成员/任务/提醒/搜索 + 建频道/建 agent + 发消息）；归档/删除/重置/改 runtime/改 workspace 保留 Owner UI 操作
  - 手册保鲜 = 人工初版 + 构建 effort 交付清单固定步骤 + 失效兜底（如实说不确定，不硬编）
  - 任务板 = 不主动认领（MEMORY.md 行为约束，机制不改）
  - 工作目录 = 不绑项目目录，家目录 + 手册足矣
  - 语言 = 对话语言跟随用户（按用户消息语言回复，歧义回落简体中文；手册/文档正文仍简体中文）——决策 16 修订（02 grilling 确认）
  - 身份细节（名字/描述/头像）= spec 起草时与 Owner 确认
  - 沟通场所 = 秘书首次启动自动创建私有频道（如 `#秘书办公室`，成员 = Owner + 秘书）作为 1:1 沟通场所；欢迎语落此频道；通用 agent DM 属平台级机制改动，另起 effort（02 grilling 确认）

## Decisions so far

<!-- 图表索引：一个 closed ticket 一行，够判断相关性即可，细节在链接里 -->

- [关键节点触发机制与 bash 工具可用性研究](issues/01-key-events-and-bash-research.md) — 非消息事件零感知通道（wake 仅"消息落库/提醒到点"两触发面，join/create/agent 创建零事件，无登录概念）；欢迎触发采纳方案 A——服务层以 Owner 署名投事件系统消息 + @秘书 mention 穿透唤醒（机制现成、成本低），**铁律：不得以秘书署名触发**（loop 对全己消息 noop）；bash 在 DEFAULT preset，秘书 curl 开箱即用（禁忌 toolNames:[]）；base URL 写死 http://127.0.0.1:30141 可靠，自定义端口写入 MEMORY.md
- [秘书行为契约定稿](issues/02-secretary-behavior.md) — 关键节点三处（新成员加入欢迎/新频道报到/办公室频道欢迎语，克制 ≤2 句）；Owner 署名事件消息 + @mention 穿透唤醒，欢迎语=秘书正常回复；对话语言跟随用户（歧义回落中文，手册/文档仍中文）；创建类一行式回执；缺关键参数先问后做；兜底三话术（不硬编/不越权/失败如实报错）；自称"秘书"克制工具型语气；与 loop 既有规则零例外；新增已锁决策 17（办公室私有频道，通用 agent DM 另起平台 effort 入 Out of scope）
- [手册结构大纲](issues/03-manual-outline.md) — 两本手册大纲已确认（[manual-outline.md](manual-outline.md)）：MEMORY.md 速查 5 章 ≤150 行（身份/开口、能力边界、curl 速查 ×7、SYSTEM-GUIDE 读取指引、当前工作占位）+ SYSTEM-GUIDE.md 手册 5 章完整缩写（概念 ~25 行/概念、API 用法含 curl、操作路径、权限与兜底话术、术语表）；内容来源 = spec.md/AGENTS.md 缩写 + 01 结论 + 02 契约；**MEMORY.md 整体重写为速查结构**（保留"当前工作"节名，构建 effort 交付清单须含初始化重写步骤）
- [撰写 spec 草稿](issues/04-spec-drafting.md) — 九章 spec 草稿已产出 [docs/spec-bootstrap-agent.md](../docs/spec-bootstrap-agent.md)：身份细节 Owner 确认（名字 **Susan**、描述推荐版、头像沿用 seed=member id 机制）；自动创建 = 启动路径幂等判定（名字全等 + deleted 标记，删除后不重建）+ 模型未配置跳过并 UI 降级；初始化流程五步（手册重写 / 全频道静默加入 / 办公室频道幂等建 / Owner 署名欢迎事件）；启动助手入口（无存活 Susan 时显示）；频道维护排除"欢迎 Susan 自己"；交付清单 15 项含手册更新步骤——待 ticket 05 逐章确认
- [spec 逐章确认与 effort 收尾](issues/05-spec-confirmation.md) — 九章逐章确认通过（2026-08-08）：五条验收自检全过（九章齐全无 TBD / 17 项已锁决策一致 / 术语沿用主 spec §1.3 / Out of scope 以 map 为准 / §8 清单 15 项可开工）；[展开] 项全数放行（§2.3 身份细节、§5.5 手册保鲜、§6.1–6.4 创建细节、§7 频道维护）；spec 头部标记"已确认"；**effort 收尾——目的地（确认后的 spec）已达成，构建 effort 另起**

## Not yet specified

<!-- 05 逐章确认后全部落定，无剩余 fog（04 展开项 + 05 放行的 [展开] 项均已入 spec） -->


## Out of scope

- 通用 agent DM 通道（任意 agent 1:1）——平台级机制改动（消息模型/UI/inbox），另起平台 effort（02 grilling 确认）
- 秘书代做破坏性/管理操作（归档、删除身份、重置会话、改 runtime、改 workspace）——保留 Owner 专属（已锁决策 11）
- 秘书参与任务板认领/工程交付——不主动认领（已锁决策 14）
- 给 agent-loop 增加 worksplice 专属工具（createChannel/createAgent 等）——机制改动，spec 中记为"增强可选"，不进核心范围
- 构建实现本身（spec 确认后另起 effort）
