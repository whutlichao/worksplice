# 10 — pi SDK 重构 spec（可构建）

**What to build:** 用 pi SDK 完全重构 worksplice 的可构建 spec：SDK（`@earendil-works/pi-*` 0.83.0）收敛为中层能力底座（tools/extensions/skills/session/model 归 SDK），raft 域归 worksplice，保留 raft 产品语义与数据兼容（`SCHEMA 11→12` 一键升、三件套回滚），解决 token 成本/可靠性/可观测性三类稳定性问题，UI 信息架构重做为 B·Guided Journey 首版（11→≤4 概念/屏）。迁移按四期排期：`lib/cwd-mutex → lib/rpc 四件套+model-scope → agent-loop 重塑+成本看板 → UI B 首版`，每期 `tsc --noEmit + lint + npm test` 全绿。技术事实来源 = `docs/spec-rebuild.md`（ADR-0009 契约）+ ADR-0005~0009；本文档为构建输入视图（Problem/Solution/Stories/Decisions/Testing）。

**Blocked by:** —

**Status:** ready-for-agent

## Problem Statement

用户面对的不是单点故障，而是一组结构性债务叠加，重构前无法在单次小改中解决：

- **稳定性三痛点**：token 成本不可控（`deliverWithFreshness` 四选一重试 2/3/3 次 + 大 prompt 每轮全量重读）、可靠性靠自研 busy-cwd 双层防护（`lib/rpc` 与 `agent-loop driver` 两处各自实现 cwd 串行，职责重复易漂移）、可观测性 `round_logs` 无 token/cost 列（成本只能靠 session jsonl 事后解析，无法按轮归因）。
- **中层收敛**：`lib/rpc` 1479 行厚 Wrapper 复刻 SDK 状态机（`isStreaming/isCompacting` 等 SDK 已有能力），`model-scope/models.json/skills/plugins` 分散 20+ 文件自管存储，与 SDK 提供的 `SessionManager/SettingsManager/ModelRuntime/ResourceLoader/DefaultPackageManager` 重叠——worksplice 在为 SDK 已经管好的能力重复造轮子。
- **UI 信息架构**：`ChannelView` 单组件一次呈现 11 概念/屏（分页/引用/任务 List|Board 拖拽/提醒/reaction/pinned/附件/线程入口/As Task/mention/轮询），新用户被淹没，`describe → hand off → let it run → review` 核心循环不可见。
- **迁移恐惧**：`~/.worksplice/raft.db`（SCHEMA_VERSION 11 链）与 `~/.pi/agent/sessions/*.jsonl` 是长期资产，重构必须承诺数据不断、升级不丢、回滚可达，且不能碰 SDK 存储格式。

## Solution

在保留 raft 产品语义（channel/thread/message/task/inbox/reminder/reaction/pinned/attachment/search，`UNIQUE(target_id, seq)` + freshness-hold + 不可变消息）与数据兼容的前提下，把 pi SDK 收敛为中层能力底座，worksplice 只保留 raft 编排与 per-member 记账：

- **切分线**：pi 管 pi，raft 管 raft。SDK 管 tools/enabledModels/ThinkingLevel/SessionManager/SettingsManager/ModelRuntime/ResourceLoader/compaction；worksplice 管 registry 记账、Cwd 互斥、双轨状态、生命周期两分、会话文件固化门禁、raft 全域（Store 57 宽总线 + 单例守卫）。
- **分层单向**：`lib/data ← lib/domain/raft (唯一导入面) ← lib/rpc|agent-loop|cwd-mutex|model-scope ← app/api (薄封装)`，7 域 22 文件。
- **稳定性**：freshness-hold 重试收敛 50%（revise 2→1 / resend 3→1 / task status 3→2，默认 `revise→resend`）；`lib/cwd-mutex` 窄接口成为 cwd 串行唯一事实来源；`round_logs` 增 token/cost 三列 + 成本看板双视图（全量聚合 + 最近 50 轮滑动）。
- **UI**：B·Guided Journey 首版——旅程条 4 步常显（describe → hand off → let it run → review）+ 强空状态卡 + `···` 收敛高级 + 秘书五步流作首访入口，一次呈现 ≤4 概念。
- **迁移**：单向前兼容，存量 v1..v11 一键升至 v12（仅 `round_logs` 三列 `ALTER ADD COLUMN` 幂等），三件套文件覆写回滚；执行按四期排期，每期全量门禁全绿。

## User Stories

**人类 Owner**
1. 作为 Owner，我希望升级后我现有的全部频道/消息/任务/提醒/附件原样保留，这样我无需任何数据操作即可继续协作。
2. 作为 Owner，我希望重构不改变发消息/开 thread/引用/转任务/设提醒的交互语义，这样我的既有习惯不失效。
3. 作为 Owner，我希望 agent 状态点（绿/黄/橙/灰）仍然实时准确，这样我知道谁在干活、谁出错。
4. 作为 Owner，我希望任务板拖拽仍然可用且非法落点被服务端拒绝并弹回，这样状态机不会被绕过。
5. 作为 Owner，我希望在 agent 详情可观测页看到每轮 `prompt_tokens/completion_tokens/cost`，这样我能按轮归因成本。
6. 作为 Owner，我希望成本看板同时提供全量聚合与最近 50 轮滑动视图，这样既能看长期趋势也能看近期波动。
7. 作为 Owner，我希望 silent/error/capped 轮次在可观测页有显式 badge 与 reason 原文，这样我能区分"自判不回应"与"处理失败"。
8. 作为 Owner，我希望 freshness-hold 重试烧 token 的路径收敛（默认 held 后原样重试一次），这样单轮成本更可预测。
9. 作为 Owner，我希望首访时秘书五步流（建频道+建 agent+首条消息闭环）自动出现，这样新用户 5 分钟内走通第一间房。
10. 作为 Owner，我希望空频道显示引导卡而非空白，这样我知道下一步该做什么。
11. 作为 Owner，我希望一次屏幕最多呈现 4 个概念（reaction/pinned/附件等收进 `···`），这样界面不被高级功能淹没。
12. 作为 Owner，我希望旅程条 4 步常显告诉我 `describe → hand off → let it run → review` 当前走到哪一步，这样我能知道协作进度。
13. 作为 Owner，我希望任务板在中央 Tab 保留且有 badge 引导切换，这样任务不被藏进抽屉。
14. 作为 Owner，我希望同一项目目录被共享时并发会话互斥让路（busy-cwd），这样不会出现两个 agent 挤占同一 cwd。
15. 作为 Owner，我希望重启/热重载后没有旧行为残留（三守卫无旧闭包），这样不会出现改了不生效的幽灵行为。
16. 作为 Owner，我希望回滚 = 三件套文件覆写（`raft.db + attachments/ + agents/`），这样出问题时我能恢复到迁移前状态。
17. 作为 Owner，我希望 SDK 读不到 token 统计时 cost 列为 null 而不是报错，这样可观测面板永不因数据缺失崩坏。
18. 作为 Owner，我希望模型/技能/插件配置面板行为不变（存储委托 SDK），这样配置管理不因重构而退化。

**Agent 成员**
19. 作为 agent，我希望被唤醒后照旧 drain→decide→act→reply→ack，这样我的行为契约在重构后不变。
20. 作为 agent，我希望 held 后默认原样重试一次（resend）而非重写，这样我烧的 token 更少。
21. 作为 agent，我希望崩溃后 backfill 仍按序补写我的回复且不误判归属，这样恢复不丢上下文。
22. 作为 agent，我希望我的任务线程回复仍触发自醒续工，这样我能持续推进 in_progress 任务。
23. 作为 agent，我希望提醒仍以我的署名投递并定向唤醒我本人，这样"agent 拥有自己的时间"不回归。
24. 作为 agent，我希望静音后普通消息不打扰我、个人 @mention 仍穿透，这样 mute 语义不因重构改变。
25. 作为 agent，我希望跨作者内容去重仍拦截继承文件的他人回复，这样我不会把别人的话当自己的。
26. 作为 agent，我希望错误轮次不推进游标、下次 wake 重试，这样失败不吞消息。

**新用户**
27. 作为新用户，我希望首访不被 11 个概念淹没，秘书引导我走通首间房闭环。
28. 作为新用户，我希望每个空状态都告诉我"下一步做什么"，这样我不需要文档也能开始。

**维护者 / 实现 agent**
29. 作为实现 agent，我希望每期验收有硬门禁 `tsc --noEmit + npm run lint + npm test`（347 用例）全绿，这样合闸标准客观无歧义。
30. 作为实现 agent，我希望 `lib/cwd-mutex` 有单测覆盖 realpath 归一、per-cwd 串行与 `waitForSettle`，这样 cwd 互斥逻辑有回归保护。
31. 作为实现 agent，我希望 `lib/rpc` 收窄期不引入新测试 seam（node TS strip 无法静态 import），靠路由源码断言 + 全量基线回归，这样测试基建不膨胀。
32. 作为实现 agent，我希望 `round_logs` 三列迁移幂等可重复跑，这样每次启动全量跑不炸。
33. 作为实现 agent，我希望老库 v11 一键升 v12 不重置、旧二进制忽略新列（显式列名查询），这样升级链不断。
34. 作为实现 agent，我希望 UI 期有组件渲染断言覆盖旅程条/空状态/折叠，这样呈现层回归靠渲染测试即可。
35. 作为实现 agent，我希望共享 project 目录并发探活、固化+backfill 回放、cost badge、热重载守卫有 4 项手动清单可走，这样自动化覆盖不到的地方有明确人工步骤。
36. 作为实现 agent，我希望改 agent-loop 深模块后必须重启 dev server 并验证启动时间晚于改动，这样热重载陷阱被流程约束。

## Implementation Decisions

以下全部源自 wayfinder `pi-sdk-rebuild` 地图已决票据 01–09（细节与证据行号见各自 ticket Answer 与 `docs/spec-rebuild.md`）：

**SDK 能力边界（01）**
- 可委托 SDK：tools/enabledModels/ThinkingLevel/SessionManager/SettingsManager/ModelRuntime/ResourceLoader/compaction；不可委托（worksplice 保留）：registry per-member 记账、BusyCwd 互斥、双轨状态、raft 全域、Store 57 方法。

**数据层（02）**
- 保留 better-sqlite3 + `Store` 57 方法宽总线（13 分组），零换库、零委托 pi 存储；不拆 `ChannelStore/TaskStore` 窄接口；`getDb(): Store` 单例 + `__workspliceDbOpenedVersion !== SCHEMA_VERSION` 热重载重建守卫保留。

**SDK 委托边界（04，ADR-0007）**
- `lib/rpc` 冻结四件套：`session`（薄 Wrapper，仅 `promptRunning` + 薄订阅，不复刻 SDK 状态机）、`registry`（per-member 记账，不按 cwd 猜归属）、`caller`（`createAgentSessionServices → resolveVisibleModels → createAgentSessionFromServices` 二段式，透传 per-agent 模型三列）、`events`（subscriber+broadcaster 合并窄面）。`SessionManager.listAll` 不替代 registry。
- `model-scope` 委托 `resolveModelScopeWithDiagnostics` 的 thin adapter；`enabledModels` 读写走 SettingsManager；models.json 走 `SettingsManager.withLock` + `invalidateModelsCache`；skills 走 DefaultResourceLoader；plugins 走 DefaultPackageManager；`PATCH disable-model-invocation` 手术短期保留（sunset = SDK 提供 updateSkill 后）。
- `tool-presets` 三档保留为 UX 快捷、去硬编码（`getAllTools()` 子集过滤），`allowedToolNames` 由 caller `toolsOption` 注入（`[]`=全禁、`undefined`=不过滤）。

**agent-loop 重塑（05，ADR-0005）**
- 重试收敛：`MAX_REVISE_RETRIES 2→1`、`MAX_RESEND_RETRIES 3→1`、`MAX_TASK_STATUS_RETRIES 3→2`；默认 `onConflict` `revise→resend`；prompt 保守压缩（`MESSAGE_CONTENT_CAP=4000/条` + 最近 20 条 + 任务 preview 120 字截断）；不引入模型路由。
- `round_logs` 增 `prompt_tokens/completion_tokens/cost` 三列（SDK 可取则写否则 null）+ 成本看板双视图；`MUST_RESPOND_CAP=2` 与 error/silent 分级不变。
- backfill 双层门禁（文件级归属 + 跨作者内容去重）与"标记存在即推进游标"语义保留。

**目标架构（06，ADR-0008）**
- 分层单向：`lib/data ← lib/domain/raft (唯一导入面 `export *`) ← lib/rpc|agent-loop|cwd-mutex|model-scope ← app/api (薄封装)`；`app/api` 禁止直引 `lib/data`；测试 seam = `lib/domain/raft/index.ts` 单口 mock 整域。
- `lib/agent-loop/loop.ts` 保持单文件深模块（round+driver+backfill+cron 四段），`index.ts` 仅 re-export `createAgentLoop`。
- 7 域 22 文件模块清单与 Mermaid 全图见 `docs/spec-rebuild.md` 附录 A/B。

**UI 信息架构（07）**
- 采用 B·Guided Journey 首版（原型 `prototype-ui/index.html?variant=b`，来自 prototype 资产）：旅程条 4 步常显 + 强空状态卡 + `···` 收敛高级；`ChannelView` 不拆文件；秘书五步流作首访默认入口；A（Discuss/Track/Review 深拆）为二期方向，C 否决。
- 旅程条四步来自原型：`describe → hand off → let it run → review`，各步按频道状态显隐（无消息→"描述任务"；有消息无任务→"转为任务 @agent 交接"；任务进行中→"让它跑"；待审核→"去复核"）。

**兼容与迁移（08，ADR-0006）**
- 单向前兼容：v1..v11 任一历史库一键升 v12+；不支持自动降级，回滚 = 三件套文件覆写（`raft.db + attachments/ + agents/`）。
- 单事务全量幂等不变式：`runMigrations()` 保持单事务全量执行、每次启动全量跑；`SCHEMA_VERSION` 严格 `+1`；`SCHEMA_VERSION 12` 仅 `round_logs` 三列 `ALTER ADD COLUMN` 幂等（`PRAGMA table_info` 检测），不引入 drizzle-kit/prisma。
- 会话文件门禁（固化/无主文件永不解析/backfill 归属门禁/跨作者去重）保留在 worksplice 侧，不移入 SDK；`~/.pi/agent/sessions/*.jsonl` 读写权归 SDK、app 只读，不在备份清单。

**spec 形态与排期（09，ADR-0009）**
- 技术事实来源 `docs/spec-rebuild.md`（五段式），本 issue 为构建输入视图；验收 5 条标准见 Further Notes。
- 迁移四期（主轴按深模块、横切按稳定性/兼容验收）：

| 期 | 交付物 | 关键改动 |
|---|---|---|
| 1 | `lib/cwd-mutex` 独立 | 窄接口 `withCwdMutex/isCwdBusy/findBusySession`（realpathSync 归一 + 计数器 + `waitForSettle` + `BUSY_CWD_RETRY_DELAY_MS=250`）从 rpc/registry 与 agent-loop/driver 抽取共用；`globalThis.__workspliceCwdStartLocks/__workspliceStartingSessionCwds` 守卫保留 |
| 2 | `lib/rpc` 四件套 + model-scope | session 瘦身薄 Wrapper；registry per-member 记账；caller 二段式透传；events 合并窄面；model-scope thin adapter；models.json/skills/plugins 存储委托 SDK；tool-presets 去硬编码；手术保留 |
| 3 | agent-loop 重塑 + 成本看板 | 重试 1/1/2 + 默认 resend + prompt 截断；`round_logs` 三列迁移（v12）；成本看板双视图；backfill 门禁与游标语义不动 |
| 4 | UI B·Guided Journey 首版 | 旅程条 4 步 + 强空状态 + `···` 收敛 + 秘书首访入口；三栏骨架与 76 路由薄封装不动 |

每期零 schema 大动（v12 三列已在期 3 落地）、不引入 DI 容器/窄接口拆分；分期仅为排期，`runMigrations()` 每次全量跑。

## Testing Decisions

**好测试的标准**（沿用 `docs/engineering-standards.md §2`）：只测外部行为、不测实现细节；改动带回归测试为硬性要求；新增表/列必须带版本号递增 + 迁移函数 + 老库兼容；全局 DB 用 `globalThis.__workspliceDb = openDataDb(tmp)` 直连，不得碰 `~/.worksplice/raft.db`。

**测试模块与先例**（seams 已与用户确认）：

| 期 | 测试模块 | seam 形态 | 先例 |
|---|---|---|---|
| 1 | `lib/cwd-mutex`（**新增 seam**） | 纯模块单测：realpathSync 归一 / per-cwd 串行 / `waitForSettle` / starting 计数器 | 模仿 agent-loop 单测风格（fake 注入、零 SDK 依赖、零 HTTP/DB） |
| 2 | `lib/rpc` 收窄 | 不新增 seam：路由源码级断言 + 全量基线回归（node TS strip 无法静态 import rpc 的 parameter properties） | `*-route.test.mjs`（如 `events-route.test.mjs`） |
| 3 | `lib/agent-loop` | fake `LoopRuntime` 注入：重试 1/1/2、默认 resend、prompt 截断、cost 三列写入、backfill 门禁回归 | `loop.test.mjs` / `driver.test.mjs` / `backfill.test.mjs` / `loop-tasks.test.mjs` |
| 3 | `lib/domain/raft` + schema | 内存 tmp DB：`round_logs` 三列迁移幂等（老库 v11→v12）、成本看板聚合、双视图滑动口径 | `rounds.test.mjs` / `observability.test.mjs` / schema 迁移既有模式 |
| 4 | `components` | `renderToStaticMarkup` + jiti：旅程条四步显隐、空状态卡、`···` 折叠、秘书入口渲染 | `ChannelView.test.mjs` 等 14 个组件测试 |
| — | 全量基线 | `node --test lib/agent-loop/*.test.mjs lib/domain/raft/*.test.mjs components/*.test.mjs` 每期全绿 | `docs/engineering-standards.md §2.1` |

**手动验证清单（自动化 seam 之外，期验收必走）**：① 共享 project 目录并发串行探活（`isCwdBusy/findBusySession`）；② `chooseSessionFileForStart` 固化 + backfill 归属门禁回放无误判；③ `round_logs.prompt_tokens/cost` 在可观测页 badge 非空（SDK 缺数时 null 不炸）；④ 热重载三守卫 `__workspliceDb/__workspliceSessions/__workspliceWakeListeners` 重启 dev server 后无旧闭包（验证启动时间晚于改动）。

## Out of Scope

- 多人/多机/服务器部署、daemon 分离、邀请/joint channels、跨团队协作、外部 agent 接入（`docs/spec.md §2.2` 一致）
- 非 pi 的 runtimes（Claude Code / Codex / OpenCode 等）
- 手机端/云端托管、OAuth/apps 生态
- 品牌与发布形态重动（npm 名、`bin/worksplice.js`、`WORKSPLICE_*` / `PI_*` 变量、`~/.pi/agent` 目录不变）
- pi session 文件格式改动（读写权归 SDK，app 只读不解析）
- UI 变体 A（Discuss/Track/Review 三视图深拆，为二期方向）、变体 C 否决方案
- Store 窄接口拆分、换存储引擎、模型路由引入
- 本 spec 的执行本身（to-tickets 之后由 implement 承接）

## Further Notes

- 技术事实来源：`docs/spec-rebuild.md`（五段式：现状盘点/目标架构/分步迁移/兼容清单/成本基线 + 附录 A-E）+ ADR-0005~0009 + 各 ticket Answer 证据行号。
- 验收 5 条客观标准（合闸条件）：① 行号可追溯（结论可点到 research/01-03 + 04-08 Answer + ADR-0005~0009）② 全量门禁全绿（tsc/lint/test 347，绝不 `next build`）③ 图表零漂移（Mermaid 与 7域22文件清单与 ADR-0008 一致）④ 兼容可回滚（v11→v12 单事务幂等一键升 + 三件套文件覆写回滚可演示）⑤ 旅程可演示（`prototype-ui/index.html?variant=b` 可点通 `describe→hand off→let it run→review`，秘书五步流闭环）。
- 热重载陷阱：改 agent-loop/driver/wake/backfill 等被 globalThis 闭包引用的模块后必须重启 dev server（验证手段：`ps aux | grep next-server` 启动时间）。
- 术语以 `CONTEXT.md` 为准，本次重构无新增 glossary 词（ADR-0009）；新增术语经 domain-modeling 落盘。
- 成本基线口径见 `docs/cost-monitoring-baseline.md` 双视图（BAI-5 实测 3 agent 基线）。
- 后续：本 spec 经 `/to-tickets` 按四期拆 tracer-bullet 实现票（原生 blocking 生 frontier），逐票 `/implement`（内部 `/tdd`，末尾 `/code-review` 双轴）。
