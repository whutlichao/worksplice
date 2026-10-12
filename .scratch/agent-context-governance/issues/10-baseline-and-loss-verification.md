# 基线与防丢失验证

Type: task
Status: resolved
Blocked by: 06, 07, 08, 09

## Question

用合成数据建立机制层基线并执行防丢失验证的机制层通过条件：注入形状、截断、检索可达性与
`contextUsage` 峰值可断言，产出数值目标与证据。

## Scope

- 目标：落实 [`spec.md`](../spec.md) 的 Testing Decisions（验证两层通过条件、测量口径、数值目标
  留实施期）与裁决 D5（机制层＝每轮注入规模＋`contextUsage` 峰值；现状口径＝session 累计 token/cost）
  和 D6（机制断言＋合成端到端两层）。
- 改动面：只复用既有测试缝（spec.md Testing Decisions「seams（复用既有测试缝，不新造）」）——
  每轮 prompt 捕获 [`loop.test.mjs`](../../../lib/agent-loop/loop.test.mjs)、`search` op → 观察相
  [`loop-ops.test.mjs`](../../../lib/agent-loop/loop-ops.test.mjs)、归档落点/清理
  [`agent-lifecycle.test.mjs`](../../../lib/agent-lifecycle.test.mjs)、合成 JSONL＋临时目录
  [`session-stats.test.mjs`](../../../lib/session-stats.test.mjs)、恢复幂等
  [`backfill.test.mjs`](../../../lib/agent-loop/backfill.test.mjs)；session 级现状口径见
  [`session-stats.ts:101-156`](../../../lib/session-stats.ts#L101-L156)。
- 不变量：只用合成数据（合成 JSONL、临时数据目录、fake runtime），不读 `~/.pi`／`~/.worksplice`
  真实用户数据（先例 [`default-datadir-guard.test.mjs`](../../../lib/data/default-datadir-guard.test.mjs)）；
  不引入外部索引服务；轮级 usage 归属「待核实 SDK 能力」不作为断言前提；行为层（真实 provider
  质量/召回评测）不在本票，另起 effort。

## Answer

已交付（PR [#181](https://github.com/whutlichao/worksplice/pull/181)；PR body：
`/Users/apple/orca/workspaces/worksplice/context-governance-10-pr-body.md`，在仓库外）。
**只加测试与基线记录，未改任何产品代码**；全部数据为合成数据（合成 JSONL／临时数据目录／
fake runtime），未读 `~/.pi`／`~/.worksplice` 真实用户会话。

### 基线口径与数字

- **base commit**：`2abcca0`（从最新 `origin/main` 切出；复核 `git rev-parse 2abcca0`）。
- **测试基数**：base `2abcca0` 复核 **1464**（与协调者实测同值）→ 本票新增 **10** → **1474**。
  分布：`loop.test.mjs` +3（53→56）、`loop-ops.test.mjs` +2（17→19）、
  `session-stats.test.mjs` +3（6→9）、`observability-route.test.mjs` +2（4→6）。
- **机制基线**（合成夹具实测；绝对值随夹具形状小幅波动，量级稳定）：

  | 项 | 实测 | 上界 |
  | --- | ---: | ---: |
  | ①-A decide 注入（202 条积压 / 原始 33_749 字符） | 9_698 字符 | 20_000 |
  | ①-B decide 注入（40 条 × 4_000 / 原始 160_270） | 19_449 字符 | 20_000 |
  | ①-C 积压 42 条 → 444 条（翻十倍） | 9_788 → 9_830（差 42） | 20_000 |
  | 观察相最坏形状（50 条 × snippet 240） | 14_439 字符 | 20_000 |

- **现状口径**（`session-stats.ts:101-156`，2 个合成 session 文件聚合）：
  `messages=3 total=2195（cached 700 / uncached 1240）cost=0.063 compaction=1/7800`。

### 机制层三条断言（均引用对应 B 编号）

1. **① B5 每轮注入有恒定上界** —— `loop.test.mjs` 的 `B5 机制基线①-A/B/C`
   （缝：fake session 每轮 prompt 捕获）。A：积压灌满近期窗口时注入 9_698 ≤ 20_000 且远小于
   原始积压 33_749；B：单条正文撑爆窗口时字符上界绑定（19_449，吃到上界的 97.2%）；
   C：积压翻十倍，注入持平（差 42 字符）⇒ 上界与会话长度解耦。
2. **② B2/B4/B8 关键事实可检索命中并经观察相回交** —— `loop-ops.test.mjs` 的
   `B2/B8 合成端到端：事实 → compact 后投影（截断出注入）→ search 回查命中 → 回复引用事实`
   与 `B2/B4/B8 合成端到端：回查只回成员自己的归档，他人归档不泄漏`
   （缝：成员面 `search` op → 观察相；归档副本经 `archiveAgentSessionFiles` 投到检索面）。
   剧情：第 1 轮埋事实 → 注入 compact 后投影形态（原始记录归档副本＋compaction summary，
   **不依赖真实 provider 阈值触发**）→ 积压灌满窗口把事实挤出注入投影 → 第 2 轮声明 `search` 回查
   → 命中经观察相文本回交 → 最终回复引用该事实；同一轮复核 B8：只有一条观察相 prompt。
3. **③ `contextUsage` 峰值可观测 + 口径边界** —— `observability-route.test.mjs` 的
   `contextUsage 峰值可观测：live 载荷逐字带出 percent/tokens/contextWindow` 与
   `contextUsage 口径边界：compact 后到下一次有效 assistant usage 前为 null，不得当 0`
   （缝：既有假存活会话 `globalThis.__workspliceAgentSessions` → `get_state`，路由 `route.ts:44`
   逐字透传 `lib/rpc/session.ts:547` 的三元组）。
   峰值采样 4_000 → 9_500 → 15_600 tokens（窗口 200_000）；未知按 `null` 带出，
   并显式断言 `!== 0`——**0 是有值（占用为 0），不得当未知**。
   落盘面代理：`session-stats.test.mjs` 的 `contextUsage 峰值代理（落盘面）：compaction.tokensBefore
   单列，不混入 token 桶` 与 `口径边界：落盘统计面不产出 contextUsage——未知不拿 0 冒充`。

### 数值目标及其推导（从基线出发，不凭空给数）

| 量 | 目标 | 推导 |
| --- | --- | --- |
| 整轮注入上界 | 维持 20_000 字符 | ①-B 最坏 19_449 ＝ 上界 97.2%，余 551 字符＝骨架（指令＋marker）与提示行固定占位。下压到 19_000 以下会裁掉「最新一条」之前的内容，破坏「当轮要回的消息必在注入中」；抬升则失去上界意义 ⇒ 维持，并以「≤ 上界」＋「最坏情形 ≥ 上界−2_000」双钉防两端漂移。 |
| 近期窗口（条数） | 维持 20 条 | ①-A 短消息场景注入 9_698 < 20_000 ⇒ 条数窗口先绑定；20 取 ADR-0005 决策一已裁定口径，不新造数。 |
| 单条正文上限 | 维持 4_000 字符 | ADR-0005 决策一保留值；它决定「弹性预算 ÷ 单条上限＝装得下几条」（①-B 实测 4 条）。 |
| 注入规模 vs 积压长度 | 差值 < 上界的 10%（2_000 字符） | ①-C 实测差 42 字符（0.2%）⇒ 上界与积压长度解耦；取 10% 作回归阈值，容忍语境块（硬顶 2×2_400＝4_800）带来的自然波动。 |
| 观察相（回查）预算 | 维持既有 snippet 240 / 上限 50 | 最坏形状 14_439 ≤ 20_000（72%）⇒ 既有 B8 形状在最坏情形下仍不越界，无需调整；只需断言它 ≤ 上界。 |
| `contextUsage` 口径 | 三元组逐字透传；未知＝null 且不得为 0 | compact 后到下一次有效 assistant usage 之前没有有效 usage ⇒ 占用未知；把未知当 0 会让峰值口径失真。 |

### 两层通过条件（行为层只定边界、不执行）

- **机制层（本票执行，全绿）**：活动上下文按注入形状缩小；关键事实在原始记录／归档面可检索命中
  并经观察相回交；`contextUsage` 峰值可观测、未知为 null。
- **行为层（另起 effort）**：真实 provider 下「模型实际引用／答案正确」的评测集与阈值另起票；
  本票只定入口边界——机制层断言全绿是行为层评测的前置条件，行为层不改变机制层口径，
  本票不引入真实 provider 调用。

### code-review：单轴（Standards），理由

本票最终 diff = 4 个 `*.test.mjs`（+ 票据 Status/Answer），**零产品代码改动、零新规格**：
Spec 轴审的是「本票是否忠实实现了规格/票据要求」，而本票的规格本体（spec.md Testing
Decisions、D5/D6、B5/B2/B4/B8）与行为语义均由票 06/07/08/09 已交付并审过，本票不新增规格条目，
故 Spec 轴无新对象可审 ⇒ 走单轴（Standards／测试规范：缝复用、合成数据纪律、命名与断言可解释性）。
**若最终 diff 出现产品代码改动，则按票面改为双轴。**

单轴 findings 与处置（对最终 diff）：
- 硬性（术语）：用例标题原写「注入规模与**会话长度**无关」，而 CONTEXT.md 约定「会话/session」
  归 pi session ⇒ 已改为「**积压长度**」。
- Duplicated Code：两处端到端用例的填充积压循环 ⇒ 抽出 `seedFillerBacklog()`；
  `observability-route.test.mjs` 两处同形 fake 会话 ⇒ 抽出 `fakeLiveSession({ contextUsage })`。
- Primitive Obsession：①-B 的裸数与诊断串写死的「160_270」⇒ 改为 `FAT_BACKLOG_COUNT`／
  `FAT_MESSAGE_CHARS`／`BOUND_TOLERANCE_CHARS` 常量，诊断串改为按夹具计算。
- 冗余断言：落盘面同时断言 `in` 与 `=== undefined` ⇒ 只保留语义更强的「口径缺席」；
  ③ 的 `!== 0` 保留——它是票面明确要求的「未知≠0」口径声明，不是重复。
- 未处置（记录）：新词（存活会话面／落盘解析面／峰值代理／积压）未进 CONTEXT.md——本票硬边界禁改
  docs，留后续 docs 票；`map.md` Decisions-so-far 本票未回填——Ownership 未授权该文件，留后续票。

### 红证据（隔离副本取得）

- 关掉注入投影（保留上界常量 20_000）后，①-A／①-B／② 端到端与既有 `revise` 上界断言全部变红，
  实测注入 42_272／160_270／41_397／26_174 字符 ⇒ 断言确实会咬，不是空跑。
- ③ 把「未知」落成 0 后，`contextUsage 口径边界` 变红（`actual: 0, expected: null`）。

### 遗留

1. 阈值（20_000 字符／窗口 20 条／单条 4_000）是「按基线确认维持」的结论，若后续 effort 的
   真实 provider 评测给出新的成本证据，需连同本票基线数字一起重定。
2. 轮级 token/cost 仍缺（`round_logs` 无 token/cost 列）——待核实 SDK 能力后另起票；
   本票的 `contextUsage` 峰值只覆盖存活会话面，落盘面只有累计口径与 `compactionTokens` 代理。
3. 行为层（真实 provider 的质量／召回评测）按 D6 属另起 effort。

## Acceptance

- 机制层三条断言（spec.md Testing Decisions）：①活动上下文按注入形状缩小——每轮 prompt 有恒定上界
  （引用 B5）；②关键事实在原始记录/归档面可检索命中，并经观察相回交（引用 B2/B4/B8）；
  ③`contextUsage` 峰值可观测（compact 后到下一次有效 assistant usage 前为未知）。
- 合成多轮端到端：fake 回复脚本走「事实 → 压缩/截断 → 回查」剧情；compact 触发以「注入 compact 后
  投影形态」为主，不依赖真实 provider 的阈值触发；B8 的「一轮最多一次观察相」在回查剧情中复核。
- 基线与数值目标：机制基线（每轮注入规模＋`contextUsage` 峰值）与现状口径（session 累计 token/cost）
  分别产出；数值目标在本票内确定并记录；两层通过条件中行为层只定义边界、不执行。
- 证据形式：测试输出与基线数字写进 Answer。
- 项目文件有改动时：解析并使用本机 pr skill 编写 PR body，推分支创建 PR，PR 号及 body 路径回填
  Answer；最后发送并核实 worker_done 回执。
