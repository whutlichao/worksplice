# Map: 用 pi SDK 完全重构 worksplice

## Destination

一份可交付的重构 spec + 分步迁移计划：在保留 raft 产品语义与数据兼容的前提下，将 pi SDK 收敛为中层能力底座（tools/extensions/skills/session/model 归 SDK，raft 域归 worksplice），并解决 token 成本/可靠性/可观测性三类稳定性问题，UI 向更普适、更简洁的方向重做信息架构。

## Notes

- 领域：TypeScript / Next.js worksplice（单进程常驻，`bin/worksplice.js` → `next start -p 30142`），pi SDK `@earendil-works/pi-*` 0.83.0，raft 域（channel/thread/message/task/inbox/reminder/reaction/pinned/attachment/search，`UNIQUE(target_id, seq)` + freshness-hold + 不可变消息）
- 形态：本 effort **只做规划不做实现**（Plan, don't do）——终点是 spec 文档与迁移路线图，不含代码落地；每 session 产出决策而非交付物
- 立场：产品语义保留、实现可重写、数据平滑迁移（存量 `~/.worksplice/raft.db` SCHEMA_VERSION 11 + `~/.pi/agent/sessions/*.jsonl` 向后兼容，迁移链不断）
- 中层收敛原则：**pi 管 pi，raft 管 raft** —— `lib/rpc` 的薄 Wrapper 形态与 `agent-loop` 的自研驱动耦合是本次重构的主战场；tools/extensions/skills/model/session 尽可能委托 SDK 原生能力，worksplice 只保留 raft 编排
- UI 立场：保留 Next.js + Tailwind brutalist 基建，保留单机单进程部署；但**信息架构重做**——降低一次呈现的概念数，重排层级与空状态引导，让非专业用户也能走通 `describe → hand off → let it run → review`
- 工程纪律：延续 `docs/engineering-standards.md` —— `tsc --noEmit` + `npm run lint` + `npm test`（`node:test` 全量 343 用例）全绿；绝不 `next build`；中文正文、英文标识符
- 术语：以 `CONTEXT.md` 为准（成员/agent/家目录/项目目录/工作区/会话文件/频道/订阅/唤醒/回应判断/轮次/任务等），新增术语经 `domain-modeling` 落 CONTEXT.md；架构决策落 `docs/adr/`
- 每 session 应 consult 的 skills：`grilling`（HITL 决策）、`domain-modeling`（术语/ADR）、`research`（AFK 研究）、`prototype`（UI 低保真）、`docs-sprint`（spec 撰写形态）

## Decisions so far

<!-- 图表索引：一个 closed ticket 一行，够判断相关性即可，细节在链接里 -->

- [01-pi SDK 能力边界研究](issues/01-pi-sdk-capability-boundary.md) — 可委托 SDK（tools/enabledModels/SessionManager/SettingsManager/ModelRuntime/ResourceLoader/compaction）与不可委托（registry/per-member 记账/BusyCwd/双轨状态/raft 全域/Store 57 方法）清单已收敛，`文件:行号`证据索引完备，04/05/06 可直接引用行号决策
- [02-数据层选型与 Store 契约去留研究](issues/02-data-layer-selection.md) — 选型 **保留并收敛**（保留 better-sqlite3 + Store 契约，零委托 pi 存储，零换库），`SCHEMA_VERSION 11` 链无破坏，Store 57 方法最小事实面保留、适度收敛，06/08 可在不重置 `raft.db` 前提下落地
- [03-现状盘点与库存量扫描](issues/03-current-state-inventory.md) — 基线已固化 `research/03` 491 行（E01-E69）：`lib/rpc 1479`/`agent-loop 1442`/`raft 2626`/`data 1813` 行数与 3 处热重载守卫、76 路由 4968 行薄封装、ChannelView 11 概念承载、`SCHEMA_VERSION 11` 14 表 + 5 触发器、Store 57 方法 13 分组、`npm test` 347 全绿；后续 04-09 直接引用行号

## Not yet specified

<!-- 迷雾区：在 scope 内但尚不尖锐、无法立刻 ticket 化；随 frontier 推进逐步毕业为新 ticket -->

- 目标架构的深模块切分细节（`lib/` 具体边界、Store 契约是否收窄、agent-loop 是否拆 driver/wake/backfill/cron 的新形态）——待 01/02 研究与 04/05 边界决策后方可细化
- token 成本优化的具体手段（prompt 压缩、revision 次数、freshness-hold 策略、模型路由）——待 05  grilling 明确优化面后毕业
- 可靠性保障的量化目标（busy-cwd 串行、游标推进、backfill 门禁、crash 恢复的 SLO）——待 05 决策后毕业
- 可观测性的产品形态（轮次结果之外的成本/错误看板、用户可感知的失败解释）——待 05 决策后毕业
- UI 原型的具体交互形态（频道/任务/线程的渐进披露、秘书驱动的轻入口是否纳入）——待 07 原型对比后毕业
- 迁移计划的分步颗粒度与兼容策略（分几期、每期迁移哪些表/文件、回滚点）——待 02/08 兼容决策后毕业
- 性能基线与回归门禁（`docs/cost-monitoring-baseline.md` 是否需更新为重构后基线）

## Out of scope

<!-- 明确超出目的地scope，永不毕业；若 ticket 误入则 close 并在此留一行 -->

- 多人 / 多机 / 服务器部署、daemon 分离、邀请/joint channels、跨团队协作、外部 agent 接入（沿用 `docs/spec.md` §2.2）
- 非 pi 的 runtimes（Claude Code / Codex / OpenCode 等 8 个）
- 手机端 / 云端托管、OAuth/apps 生态
- 品牌与发布形态重动（`worksplice` npm 名、`bin/worksplice.js`、`WORKSPLICE_*` 环境变量、`~/.pi/agent` 目录与 `PI_*` 变量保持不变）
- pi session 文件格式改动（读写权归 SDK，app 只读不解析）——重构不碰 SDK 存储格式
