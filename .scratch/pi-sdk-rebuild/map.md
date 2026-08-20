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
- [05-agent-loop 驱动模型重塑（token 成本/可靠性/可观测性）](issues/05-agent-loop-reshaping-cost-reliability-observability.md) — 重试 2/3/3→1/1/2、默认 `revise→resend`、`lib/cwd-mutex.ts` 窄接口抽取、`round_logs` 增 token 三列+成本看板双视图、Backfill 双层门禁与标记即推进保留、`MUST_RESPOND_CAP=2` 与 error/silent 分级不变；`CONTEXT.md` 新增 Cwd 互斥/成本看板，ADR-0005 已立（`docs/adr/0005`）
- [07-UI 信息架构简化原型](issues/07-ui-information-architecture-prototype.md) — 三变体对比原型已交付（`prototype-ui/index.html` 单文件，`?variant=a|b|c`），`ChannelView 11 概念/屏 → ≤4`；**采用 B·Guided Journey 首版**（旅程条 4 步常显+强空状态引导+`···` 收敛高级），A 为二期深模块拆分方向，C 否决；秘书五步流作为首访空状态默认入口纳入
- [08-向后兼容与数据迁移策略](issues/08-backward-compat-and-migration-strategy.md) — 单向前兼容（v1..v11→v12 一键升，不做自动降级、文件覆写回滚）、单事务全量幂等不变式保留、SCHEMA_VERSION 12 仅 `round_logs` 三列 `ALTER ADD COLUMN` 增量、热重载守卫与 `getDb(): Store` 宽总线保留、固化/无主文件/backfill 双门禁保留在 worksplice 侧、附件与家目录不纳入 `runMigrations` 仅入三件套备份清单；ADR-0006 已立、ADR-0005 补立
- [04-lib/rpc 与 model/skills/extensions 收敛边界](issues/04-rpc-boundary-and-sdk-delegation.md) — `pi 管 pi` 切分线已定：`lib/rpc` 保留 `session+registry+caller+events` 四件套（`withCwdStartLock` 抽至 `lib/cwd-mutex.ts`，`session.ts` 仅薄 Wrapper）、`model-scope` 委托 `resolveModelScopeWithDiagnostics` 的 thin adapter、`models.json/skills/plugins` 存储委托 SDK（`SettingsManager/ResourceLoader/PackageManager`）面板薄封装、`PATCH disable-model-invocation` 短期保留、`tool-presets` 去硬编码、`members` 三列工厂透传；`CONTEXT.md` 新增 SDK 委托边界/薄 Wrapper，ADR-0007 已立（`docs/adr/0007`）
- [06-目标架构的分层与深模块切分](issues/06-target-architecture-deep-modules.md) — 分层单向固化 `lib/data ← lib/domain/raft (唯一导入面) ← lib/rpc|agent-loop|cwd-mutex ← app/api (薄封装)`，`Store 57` 宽总线与 `getDb(): Store` 单例保留，`lib/rpc` 四件套冻结，`lib/cwd-mutex.ts` 独立深模块，`lib/agent-loop` 单文件深模块保留；Mermaid 图与 7 域 22 文件模块清单已交付；`CONTEXT.md` 新增深模块/唯一导入面，ADR-0008 已立（`docs/adr/0008`）
- [09-spec 文档形态与迁移计划颗粒度](issues/09-spec-shape-and-migration-plan-granularity.md) — 独立 `docs/spec-rebuild.md` 五段式（现状盘点→目标架构→分步迁移→兼容清单→成本基线）+ 附录 A-E，混合按深模块切四期（`cwd-mutex → lib/rpc → agent-loop → UI B`），硬门禁 + 4 项手动清单，5 条可测验收按段确认；`ADR-0009` 已立，`CONTEXT.md` 无新增，地图闭合

## Not yet specified

<!-- 迷雾区：在 scope 内但尚不尖锐、无法立刻 ticket 化；随 frontier 推进逐步毕业为新 ticket -->

<!-- 地图闭合：09 已决，无剩余前沿，无新增雾区；后续执行按 `docs/spec-rebuild.md §3 四期` 另起 effort 切 ticket -->

## Out of scope

<!-- 明确超出目的地scope，永不毕业；若 ticket 误入则 close 并在此留一行 -->

- 多人 / 多机 / 服务器部署、daemon 分离、邀请/joint channels、跨团队协作、外部 agent 接入（沿用 `docs/spec.md` §2.2）
- 非 pi 的 runtimes（Claude Code / Codex / OpenCode 等 8 个）
- 手机端 / 云端托管、OAuth/apps 生态
- 品牌与发布形态重动（`worksplice` npm 名、`bin/worksplice.js`、`WORKSPLICE_*` 环境变量、`~/.pi/agent` 目录与 `PI_*` 变量保持不变）
- pi session 文件格式改动（读写权归 SDK，app 只读不解析）——重构不碰 SDK 存储格式
