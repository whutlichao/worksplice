# Map: 本地 raft 复刻（基于 pi-web）

## Destination

一份经确认的《本地 raft 复刻》产品与架构 **spec 文档**（简体中文）：包含产品范围（channels/threads、持久 agent、任务板、inbox+提醒、历史与可观测性）、马卡龙配色 UI 设计 token、技术选型（数据层、pi 多实例方案、前后端架构）、与 pi-web 的脱钩与改造策略、项目命名。spec 经确认后即进入构建阶段（另起 effort）。

## Notes

- 领域：TypeScript / Next.js，代码基于 pi-web（agegr/pi-web）改造；pi coding agent（badlogic/pi-mono）为唯一 runtime
- 既有约束（charting 时用户确认）：
  - 部署形态：保留 pi-web 本地单机形态（单进程、本机运行）；无 daemon 分离、无多人服务器
  - 范围：raft 完整核心能力本地化；DMs / joint channels / 多用户 out of scope
  - 目的地：先出 spec，再构建
  - 命名：spec 阶段确定项目名；与 pi-web 完全脱钩（删除 git 历史）
- 文档正文一律简体中文（spec、issue、研究产出）
- 本 effort 只产出决策与 spec，不产出实现代码（"Plan, don't do"）
- 每 session 应 consult 的 skills：grilling（HITL ticket）、research（AFK ticket）、domain-modeling（术语）

## Decisions so far

<!-- 图表索引：一个 closed ticket 一行，够判断相关性即可，细节在链接里 -->

- [pi 能力边界与多实例模型](issues/01-pi-multi-instance-model.md) — 持久 agent = 绑定 cwd 的 AgentSession / `pi --mode rpc` 子进程；多实例可行，隔离单位是 cwd；SDK 同进程嵌入为 pi-web 当前做法
- [raft 视觉参考与马卡龙配色](issues/02-raft-visual-reference.md) — 官方色板 `--color-brutal-*`（奶油底/品牌黄/泡泡粉等）+ 2px 粗边框 + 0 圆角 brutalist 风格；仅亮色；字体 Space Grotesk 等
- [raft 产品与架构细节研究](issues/03-raft-product-research.md) — 拉取式 inbox（seq 游标）、freshness-hold 竞态地基、任务板状态机（自动认领/互审）、记忆=workspace 磁盘目录、recurrence DSL；可观测性需自研
- [pi-web 功能去留与 raft 能力映射](issues/04-pi-web-feature-triage.md) — 骨架重写为 raft 式、pi-web 降级为组件库；会话树/fork 删除，生命周期改造为 agent 详情面板重置粒度；模型配置=全局+per-agent；技能=全局设置；文件预览三分（附件/workspace 浏览/保留项目 Explorer）；worktree 降级为 agent workspace 管理；可观测性=agent 详情 tab（状态点+token/成本+任务历史）；i18n=en+zh-CN 默认英文
- [数据层选型与数据建模](issues/05-data-layer-selection.md) — 两套存储：pi session jsonl 原生格式归 SDK 读写，raft 数据独立存储层用 better-sqlite3；target_id 归一化 + `UNIQUE(target_id, seq)`，freshness-hold 用 max(seq) 事务比较不建表；agent 回复顺序双写+seq 游标恢复；FTS5 搜索；token/成本从 session jsonl 只读解析不落库
- [命名与品牌脱钩](issues/06-naming-and-brand.md) — 产品名与 npm 包名统一为 **worksplice**（npm 直名可用）；单包仓库（Next.js + lib/，沿用 pi-web 单包模式）；脱钩清单：git 历史重开、README 重写、LICENSE 保留 pi-web 原版权行+追加自己的、品牌资源与内部标识符替换（`bin/worksplice.js`、`WORKSPLICE_*` env），pi SDK 接口面（`@earendil-works/pi-*`、`PI_*` env、`~/.pi/agent`）保留不动
- [spec 文档形态](issues/07-spec-format.md) — `docs/spec.md`，Markdown + 两张 Mermaid 图（架构图、ER 图），8 章结构（概述/产品范围/UX 交互/视觉 token/技术架构/数据模型/命名脱钩/验收标准）；验收 = 5 条客观标准（无 TBD、与已锁决策一致、术语一致、Out of scope 一致、实现 agent 试读）+ 人类逐章通读确认，agent 不自证合格
- [撰写 spec 草稿](issues/08-spec-writing.md) — 草稿已交付 `docs/spec.md`（8 章 + 决策索引，两张 Mermaid 图）；07 五条验收自检通过；骨架 UI 细节展开为新提议（修正流程四选一/reaction/pinned/附件 50MB/agent-loop/inbox 本地实现/数据位置/环境变量/action card 排除），待确认
- [spec 逐章确认](issues/09-spec-confirmation.md) — 8 章全部确认无修改；9 个 [展开] 项全部放行；spec 状态更新为"已确认"（docs/spec.md 头部）。**effort 收尾：目的地（确认后的 spec）已达成，构建 effort 另起**；§7.1 仓库地址已填（https://github.com/whutlichao/worksplice，2026-08-03）

## Not yet specified

（effort 已完成——地图走到底，无剩余 fog；构建 effort 另起时新建 map）

## Out of scope

- 多人/多机/服务器部署：daemon 分离、邀请、joint channels、跨团队协作
- 非 pi 的 runtimes（Claude Code、Codex、OpenCode 等 8 个）
- 手机端 / 云端托管
- 构建实现本身（spec 确认后另起 effort）
