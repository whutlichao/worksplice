# pi SDK 升级（pi-sdk-upgrade-1.5）：0.99.2 → 1.5.2

Status: ready-for-agent

> 本文件的每一条技术断言都能追到两个来源之一：`docs/pi-sdk-upgrade-1.5-assessment.md`
> （已合并进 `main`，commit `815dbd6`，下文标 `评估 §x`）或仓内 `文件:行号`。
> 本 effort 是**规划**：只产出本 spec 与一张实施票，不含任何实施。

## Problem Statement

用 worksplice 的人被锁在 12 个发布版本之前。四个 pi 包在 `package.json:57-60` **精确 pin** 在
`0.99.2`，此后上游发了 `1.0.0` … `1.5.2` 共 12 个版本（评估 §2.2），全部拿不到：

- **安全公告不修**：`1.5.0` 把 `undici` 提到 `8.12.3` 是安全修复（评估 §4.8，`CHANGELOG.md:222`）；
  worksplice 自己 pin 在 `8.5.0`（`package.json:67`）。
- **我们的自研补丁在上游已经变成内置能力，而我们还在维护它**：`/api/sessions/[id]/export` 里
  60 余行「把递归树遍历改成迭代」的 HTML 补丁（`app/api/sessions/[id]/export/route.ts:130-214`）
  在 `1.5.2` 里被上游自己做掉了（评估 §4.11/R4）。补丁靠**逐字字符串锚点**匹配，
  锚点消失即 500，所以这笔债不是「性能问题」，是**升级即挂**。
- **我们的安全钩子在上游被静默停掉了**：`GrepOperations.readFile` 在 `1.5.1` 变成
  `@deprecated Ignored`（评估 §8.2），`lib/tool-path-guard-extension.ts:193` 那道读拦截
  在升级后**不再被调用**。`tsc` 不会报（可选字段）、运行时不会报（永不执行）、
  现有测试也不会红（没有「符号链接 + 上下文行」用例）。
- **成本口径会悄悄变**：`Usage.cost.total` 从「目录价估算」变成「有报价时用实付」
  （评估 §5.3/R2），字段名与类型全不变。

拖延本身有代价：版本跨度越大，取证与实跑成本越高；这次跨 6 条 minor 线、4 个版本带
`### Breaking Changes` 小节（评估 §2.4），越晚越难把「哪一条是上游改的、哪一条是我们自己的」
分开。

## Solution

以**一个原子切片 + 一次实跑**的形态升到 `1.5.2`（评估 §11）。不分段升：类型面几乎不动
（44/44 主入口符号仍在、41 个签名相同或纯加法、`AgentSessionLike` 43 个成员一个不少、
26 个方法签名逐字相同 —— 评估 §3.2/§3.3），分段拿不到「先把类型磨平」的渐进收益，
却要为每个中间版本各付一次实跑成本。

切片有四件事，缺一不可（任何一件落下都会得到「装上了但行为不对」的树）：

```text
1. 四包同一步 pin 0.99.2 → 1.5.2，bun.lock 一次重算，node_modules 清空重装
2. 三处代码改动
   a. R1  grep 上下文行的读拦截恢复（当前会静默失效）—— 必须由测试主动断言
   b. R4  删掉导出 HTML 的补丁块（上游已内置），不是重写锚点
   c. theme-schema 测试改读新路径（schemas/theme.schema.json）
3. 依赖与打包面复核：undici 对齐 8.12.3；serverExternalPackages 零改动；pi-schema 不落进 .next
4. 15 项实跑验证（评估 §10.2），其中 V3 / V7 / V8 本轮特有
```

## User Stories

1. 作为 worksplice 的使用者，我希望升级后仍能用同一套模型与凭证继续工作，不需要重新登录，
   以便升级不打断我手上的会话。
2. 作为 worksplice 的使用者，我希望升级后「导出会话 HTML」这个动作照常可用，
   以便我保存或分享一段对话时不会撞 500。
3. 作为 worksplice 的使用者，我希望升级后成本看板还给出可信的数字，
   并且我被告知这个数字现在是「provider 报价优先、缺失时回落目录估算」，
   以便我不把口径变化误读成账单异常。
4. 作为 worksplice 的使用者，我希望 `enabledModels` 里跨 provider 同名的模式升级后不会
   悄悄少给我模型，以便我的模型选择器看起来还是我记得的样子。
5. 作为安全审阅者，我希望升级后「成员会话的 grep 不会把允许根之外的上下文行漏出来」这条
   性质有**自动断言**守着，而不是靠一次人工实跑的记忆。
6. 作为安全审阅者，我希望「搜索根本身在允许根之外仍被拒绝」这条既有性质在升级后仍成立，
   以便「grep 守卫」这件事不会因为上游改实现而整块消失。
7. 作为维护者，我希望导出 HTML 的补丁代码被**删除**而不是「更新锚点」，
   以便我们不再维护一份上游已经有了的实现。
8. 作为维护者，我希望四个 pi 包在 `package.json` 与 `bun.lock` 里**只有一套版本**，
   以便「哪份代码在跑」这个问题永远只有一个答案。
9. 作为维护者，我希望 `bun.lock` 里 `@earendil-works/chord` 消失、`pi-schema` 出现、
   `undici` 只剩一条，以便依赖图变化被机械核对而不是靠回忆。
10. 作为维护者，我希望 `undici` 与 pi 包要求的版本对齐，以便不再维护
    「根 8.5.0 + 嵌套 8.10.2」这种两份并存的漂移（评估 §6.1）。
11. 作为维护者，我希望 `serverExternalPackages` 保持零改动，并且构建后用探针确认
    `pi-schema` 没有被打进 `.next/server`，以便「加不加 external」这个问题有证据而不是猜测。
12. 作为维护者，我希望 `tsc --noEmit` 在升级后先跑一遍再改代码，
    以便分清楚「类型层没说话」和「我已经改对了」这两件事。
13. 作为维护者，我希望 PRESET_NONE（`toolNames: []`）路径在升级后仍把 system prompt 清空，
    以及 `tools` 字段的省略行为被真实请求体确认，以便「全禁工具」这个能力不被协议层改动带走。
14. 作为维护者，我希望「run 启动期即 busy」这条行为变化被实跑观测（而不是推理），
    以便 cwd 互斥与 idle 计时器没有时序漂移。
15. 作为维护者，我希望升级后的 15 项验证被逐项记录意图与结果，
    以便下一轮升级（1.5.2 之后）能复用同一份清单而不是从头想。
16. 作为维护者，我希望 Azure provider 改名这类「必须做一次配置迁移」的变化被写进票面，
    以便用到 Azure 的实例知道自己要迁 `auth.json` / `models.json` / `settings.json`。
17. 作为维护者，我希成本口径、trust 语义分歧这类**不改代码但要记**的变化被显式记下来，
    以便下一个人看到「worksplice 说信任、SDK 说不信任」时不把它当成新 bug。
18. 作为维护者，我希望这次升级**不被拆成多张票**，以便不会出现「四个包半装」的中间态。

## Implementation Decisions

### 决策 1：四包同一步 pin 到 `1.5.2`，`bun.lock` 一次重算

`package.json:57-60` 的四个 `"0.99.2"` 改成 `"1.5.2"`，一步完成。理由不只是「一起改更省事」：
`1.3.0` 起上游把内部 pi 依赖从 `^0.99.2` 改成**精确版本**（评估 §2.1，`CHANGELOG.md:329`），
所以「精确版本只有同版本才可解」——分批只会得到一棵不可解的树。

安装只走 `bun install`。`preinstall` 会拦 `npm install`（`bin/install-guard.js:13-21`，
`package.json` 的 `preinstall` 脚本），所以「用 npm 装一下试试」不是选项，
`bun.lock` 是唯一可复现路径。

`node_modules` **清空重装**（评估 §10.1 第 3 步）：`pi-agent-core` 删掉了 `./harness/*`、
`./search/*` 等整片子路径（评估 §7.3，tarball 4.8 MB → 332 KB），旧树里的嵌套布局会
掩盖真实解析结果。不碰 `.next/`，且升级期间不跑 `next build`（`AGENTS.md` 的既有禁忌）。

### 决策 2：`undici` 对齐到 `8.12.3`，与本步同批

`package.json:67` 现在精确 pin `8.5.0`，而 `pi-coding-agent@0.99.2` 要求 `8.10.2`，
bun 无法 dedupe 只能嵌套 —— **今天就已经是两份并存**（`bun.lock:2029` 根条 + `:2141` 嵌套条，
评估 §6.1）。升到 `1.5.2` 后嵌套那份变 `8.12.3`，漂移从 7 个 minor 变成更宽。
对齐后两份合一：拿 1.5.0 的安全修复，且 `lib/http-dispatcher.ts` 用到的 6 个符号
（`Client` / `Dispatcher` / `Pool` / `EnvHttpProxyAgent` / `install` / `setGlobalDispatcher`）
在 `8.12.3` 上逐个命中（评估 §6.2）。

不选「放宽成 range」（本仓纪律是精确 pin，`package.json:57-60` / `:67` / `:68` 都是精确值）,
不选「直接吃 SDK 的传递版本」（`lib/http-dispatcher.ts:2` 是**直接** import undici，
必须有直接声明，靠传递依赖拿类型是隐式依赖）。

### 决策 3：R1（grep 上下文行）—— 静默失效，必须由测试主动断言

**这是本票最该写清的一条。** `GrepOperations.readFile` 在 `1.5.2` 的声明是
`@deprecated Ignored`（评估 §8.2；本票在 `pi-coding-agent@1.5.2` tarball 上复核：
`dist/core/tools/grep.d.ts:31-34`，`readFile?` 声明在 `:34` 且带 `@deprecated Ignored`；
评估文里写的 `:40` 是行号漂移，以此处复核读数为准），运行时 `grep.js` 全文件
`readFile` **零出现**，上下文行改由 ripgrep 的 `--context` + `context` 事件给出。
我们 `lib/tool-path-guard-extension.ts:193` 那道
`readFile: guarded((absolutePath) => fsp.readFile(absolutePath, "utf-8"))` 因此变成**死代码**。

这条变更的三重静默性质必须写进验收入口：**`tsc` 绿**（把原本必需的字段改成可选，实现方
提供它是合法的）、**运行时无错**（字段根本不被调用）、**既有测试不红**（现有负向用例是
`grep` 的 `path` 在允许根外，被 `isDirectory` 守卫拦下 —— `lib/tool-path-guard-extension.test.mjs:188`；
没有「允许根内符号链接指向根外 + `context`」这类用例）。唯一能抓住它的东西是**新写的断言**，
不是一次人工点验。

所以决策是：**先用一条会红的自动断言把缩水钉死，再决定修法**。断言形态见 Testing Decisions 的
接缝 1。修法优先取「把判定补在定义级 `execute`」（与同文件 `find` 的既有形态同形，
`lib/tool-path-guard-extension.ts:71-82` 已经这么写）；退路是接受缩水并在 ADR-0011 显式记录
（评估 §8.2 的选项 B），但**退路必须留下那条断言**（改成断言「已知缩水」也比没有强）。

范围要说得精确，不要夸大：`grep` 的 `isDirectory` 仍是守卫过的（`:189-192`），
所以**搜索根本身在允许根之外仍会被拒**；`find` 的搜索根判定在定义级 `execute`，不受影响。
缩水的只有「上下文行的逐文件读取」。对成员会话而言这一块另有整进程沙箱覆盖（ADR-0012），
但**人类会话没有沙箱，只有路径守卫**。

### 决策 4：R4（导出 HTML）—— 删补丁块，不重写锚点

`app/api/sessions/[id]/export/route.ts:130-138` 的 `replaceRequired` 在「锚点命中数 !== 1」时
显式 throw；三处调用在 `:140` / `:163` / `:181`，锚点是 `sortChildren` / `mapNodes` / `markActive`
三个函数定义（说明性注释在 `:89-112`）。`1.5.2` 的 `template.js` 已经把这些遍历写成显式栈
（评估 §4.11/R4，`template.js:157-162`、`:188-201`），三个锚点字符串**全部消失**。

因此修法是**删除**，不是「找到新锚点再打一遍补丁」：上游的实现已经是我们要的形态
（递归改迭代以免深链爆栈）。`route.ts` 里 `replaceRequired` 这个 helper 也一并消失
（没有第四个调用者时它就是死代码）。删除约 60 行，是本次升级里唯一的「负代码量」改动。

R4 是**响亮失败**（`replaceRequired` 显式 throw），所以不能靠「先修了再说」——
实施时必须**先观察到 501/500 红**，再删（评估 §10.2 V8：先红后绿，否则你不知道 R4 是真的
还是自己想多了）。

### 决策 5：theme-schema 测试改读 `schemas/theme.schema.json`

`lib/rpc/session.test.mjs:323` 用相对路径读**已装包内**的
`dist/modes/interactive/theme/theme-schema.json`，并在 `:329` / `:344-345` 断言
`properties.colors.required`。`1.5.2` 删掉了该文件，改放 `schemas/theme.schema.json`
（评估 §4.5，`CHANGELOG.md:365`）。`required` 仍是 **51 项**，可选集合仍是那 5 个
（评估 §3.4），所以**只改路径，不改断言内容**。

顺带记录一条同源事实：`Theme` 构造参数类型从 `Record<Exclude<…>> & Partial<Record<…>>` 改写成
`Pick<ThemeColorValues<…>, ThemeColor>`，语义等价（评估 §3.4），所以
`lib/rpc/session.ts:152-207` 那两份 `EMPTY_*_COLOR_TOKENS`（41 foreground + 6 background，
刻意省掉 5 个可选 token）**一行都不用改**。这条测试是那道不变式的机械守卫，改路径时不要顺手
放宽断言。

### 决策 6：`serverExternalPackages` 零改动 + `pi-schema` 探针

`next.config.ts:31-38` 的 6 项（`undici`、`better-sqlite3` + 四个 pi 包）**不动**：
`1.5.2` 新增的 `@earendil-works/pi-schema`、替换进来的 `lovely-mermaid`、
提升为直接依赖的 `brace-expansion`，挂载位置都在**已 external 的 pi 包之下**
（评估 §7.1），webpack 根本不遍历它们。

但这条结论里有一个**没有被上一轮实跑覆盖**的新包：`pi-schema` 是这次才出现的一等包。
所以补一个构建后探针：`.next/server` 里**不出现** `pi-schema`（写法照
`docs/pi-sdk-upgrade-spike.md:493-495` 的探针）。

### 决策 7：R2 / R3 / trust 语义 —— 不改代码，只把口径写死

- **R2 成本口径**：`lib/session-stats.ts:59` 的 `typeof cost.total !== "number"` 校验照旧通过，
  类型兼容（评估 §5.3）。不改代码，但**必须**把「成本 = provider 报价优先、缺失时回落目录估算」
  这句话写进成本看板相关的对外说明，否则「按目录价估算」这类承诺就成了假话。
- **R3 `enabledModels` 跨 provider 歧义**：`lib/model-scope.ts:71-72` 只消费 diagnostic 的
  `message`，新 `code: "ambiguous"` 不会造成类型错误；行为上是「全加入 + 一条警告」。
  不改代码，接受「选择器多出同 id 条目 + 一句警告」（评估 §9.1），并在 V9 里看一眼实际形态。
- **trust 语义分歧**：`lib/project-trust.ts:5-7` 在「项目没有 trust-requiring 资源」时提前返回
  `trusted: true`，即使 `trust.json` 存了 `false`；`1.5.0` 起 SDK 改成「保存的决定优先」
  （评估 §9.2）。**这不是升级引入的破坏**，本票不修；只作为观察项记下
  「worksplice 说信任 / SDK 说不信任」的解释。

### 决策 8：本 effort 只有一张实施票

四包必须同步升、`bun.lock` 一次重算，拆开只会得到半装状态（决策 1）。三处代码改动里，
R1 与 R4 都属于「升级后立刻必须做，否则要么静默缩水要么 500」，theme-schema 路径是一行级。
把它们挂到「先升包再改代码」的两张票上，会让第一张票的树处于「升级了但守卫失效」的状态——
那正是本票要避免的中间态。所以：**一张票，一次交付**。

## Testing Decisions

### 什么算一条好测试

只断言**外部行为**：工具调用返回的结果、被拒时抛出的错误文本、路由返回的 payload、
`node --test` 里能观测到的文件系统副作用。不断言 SDK 的内部形状（`operations` 的函数签名一类
会随版本漂移的东西），也不把「某个字段存在」当作行为证据。这条纪律在本仓已有明文
（`lib/tool-path-guard-extension.test.mjs:9-12` 的头注释）。

### 接缝（尽量少：两处自动 + 一处实跑）

1. **真实会话集成接缝**（既有，优先复用）：`lib/tool-path-guard-extension.test.mjs` 的
   `startGuarded()` + `callTool()` —— 起真会话、用真工具定义、只看返回与被拒文本。
   R1 的新断言挂在这里：允许根内放一个指向根外文件的符号链接，`grep` 带 `context: 1` 命中它，
   断言根外内容**不出现在结果里**。升级到 `1.5.2` 后这条**必须先红**（红就是 R1 的证据），
   修完转绿。同时补一条反向断言：搜索根在允许根外仍被拒（保住「没有整块消失」这半条）。
2. **`node --test` 常量守卫接缝**（既有）：`lib/rpc/session.test.mjs` 的
   「plain-text theme token record matches the SDK theme schema」用例 —— 只改 schema 路径，
   断言不动。
3. **实跑接缝**（新增，不可自动化）：导出 HTML（`/api/sessions/[id]/export`）目前**没有**测试，
   R4 只能靠实跑：升级后先看到 500（证明 R4 真实），删掉补丁块后 200 且导出文件能打开。
   不为了这一条临时造一个 HTML 快照测试——快照会把上游模板形态钉死，反而增加下次升级成本。

### 评估 §10.2 的 15 项验证意图（逐项不漏，按「抓的是哪条风险」组织）

自动 / 手工标记说明：`自动`= 由上面的接缝或既有测试网覆盖；`实跑`= 必须在真机/真会话上看。

| # | 验证意图 | 抓的风险 | 形态 |
| --- | --- | --- | --- |
| V1 | dev server 起得来，首页与会话列表正常（重点：import 期崩溃那一类，上一轮栽在这里） | 通用启动面 | 实跑 |
| V2 | 建 agent + 建会话 + 跑完一轮真实会话 | 通用；顺带覆盖「run 启动期即 busy」 | 实跑 |
| V3 | **`toolNames: []` 建会话**，确认 system prompt 仍被清成空 | `BeforeAgentStartEvent` 变 union（R5）；上一轮炸过的路径 | 实跑（**本轮特有**） |
| V4 | 任务板 claim → complete，含一次 claim 被 hold 让路的场景 | settle 事件语义 + `lib/agent-loop` 全链路 | 自动（既有）+ 实跑 |
| V5 | 成员会话里 bash 撞允许根外的墙 → 归因文案与拒绝行为不变 | `BashOperations` 零差异（评估 §8.3）+ ADR-0012 | 自动（mock 该行为的档位）/ 实跑 |
| V6 | 成员会话里 grep 搜允许根外的路径 → **搜索根仍被拒** | R1 的「仍生效」那半条 | 自动（决策 3 的反向断言） |
| V7 | **人类会话里 grep 一个指向根外的符号链接、带 `context`** → 看上下文行是否露出 | R1 的「失效」那半条 | 自动（决策 3 的主动断言）**本轮特有** |
| V8 | **导出一次会话 HTML** → 先红（证明 R4 真实），删补丁后转绿 | R4 | 实跑（**本轮特有**，先红后绿） |
| V9 | ModelsConfig 打开 → 能读模型列表 → 测一次模型连通性 | `ModelRuntime` / `resolveModelScopeWithDiagnostics` / R3 的 `ambiguous` 形态 | 实跑 |
| V10 | PRESET_NONE 会话发一条消息，抓请求体确认 `tools` 字段**是否存在** | 1.5.1 不再发 `"tools": []`（评估 §4.9） | 实跑 |
| V11 | 用 Anthropic provider 跑两轮，第 2 轮确认增量消息路径正常 | 1.5.1 message threads（评估 §4.9） | 实跑 |
| V12 | 成本看板读数与 SDK `getSessionStats()` 对齐 | R2 的 `cost.total` 口径 | 实跑 |
| V13 | 同一 cwd 启动第二个成员会话 → 应报 `BusyCwdError` | `_startRun` 让 busy 提前后，cwd 互斥是否有时序漂移 | 自动（既有用例）+ 实跑 |
| V14 | `npm test` 全绿（先记录升级前基线，再对照升级后） | 回归网 | 自动 |
| V15 | `npm run build` exit 0，且 `.next/server` 无 `pi-schema` | 决策 6 的探针 | 实跑 + 探针 |

**先红后绿的顺序纪律**：V7（R1）与 V8（R4）必须在**改代码之前**先观察到红。
V7 的红要作为测试命令的输出留证（不是「我记得会红」），V8 的红要留 500 的响应体。

**基线口径**：V14 的「全绿」是相对基线说的。本仓既有环境相关红
（`lib/model-listing.test.mjs` 的一条读真实 `~/.pi/agent/models.json` 的用例）必须在升级前
先跑一遍记下来，升级后与它对照，不要把既存红算成本票的失败。

## Out of Scope

- **本 effort 不含实施。** 本票只产出本 spec 与一张实施票；不改 `package.json` / `bun.lock` /
  `node_modules` / 任何源码。
- 不评估 `1.5.2` **之后**的版本；升级完成即止。
- 不为 `pi-ai` / `pi-tui` / `pi-agent-core` 做完整差异审计（评估 §12 已限定「只核到本仓用到的符号层」）。
- 不迁移 Azure 配置：`azure-openai-responses` → `azure`（评估 §4.3/R6）是**使用方实例的一次运维动作**，
  本票只在票面写清「谁用了 Azure 谁要迁 `auth.json` / `models.json` / `settings.json`」。
- 不重构 `lib/pi-types.ts` 的 `AgentSessionLike` 镜像（43 个成员全在，26 个方法签名逐字相同，
  没有修改理由）。
- 不改 `lib/http-dispatcher.ts`（`undici` 版本对齐后 6 个符号仍然命中）。
- 不修 `lib/project-trust.ts` 的 trust 语义分歧（决策 7）：只记录，不修。
- 不把 15 项实跑全部固化成自动用例：只有 R1 / R4 / theme-schema 三处需要新增或修改自动断言，
  其余按「实跑 + 记录」。
- 不碰 `next.config.ts`（决策 6）。
- 不更新 `docs/pi-sdk-upgrade-1.5-assessment.md` 与更早那份评估：它们是历史记录，
  实施过程中发现的事实落在票的 `## Answer` 里，不回填旧文档。
- 不做「分段升级」（评估 §11）。

## Further Notes

### 风险排序按「会不会静默变行为」，不按改动行数

这是本 effort 最重要的一条组织原则（评估 §1 / §11）：改 60 行的那处（R4）是**响亮失败**，
改 1 行的那处（R1）是**完全静默**。所以实施顺序应当是「先修 R1 并让它有测试守着」，
而不是「先删那 60 行看起来更划算」。

| 排序 | 面 | 静默程度 | 唯一防线 |
| --- | --- | --- | --- |
| 1 | R1 grep 上下文行绕过守卫 | 完全静默（`tsc` 绿 / 运行无错 / 既有测试绿） | V7 的主动断言 |
| 2 | R2 `cost.total` 口径 | 完全静默（字段名与类型不变） | V12 + 一句对外说明 |
| 3 | R3 `enabledModels` 歧义 | 半静默（有 warning 文案） | V9 |
| 4 | R5 类型面三处变化 | 响亮（`tsc`），但**预判 0 错误** | V3 |
| 5 | run 启动期即 busy | 推理上是改善，无证据 | V2 / V13 |
| 6 | R4 导出三锚点消失 | 响亮（`replaceRequired` throw） | V8 先红后绿 |
| 7 | R6 Azure 改名 | 响亮（模型消失 / 会话回落） | 使用方迁移 |
| 8 | `pi-schema` external | 预判不需要；失败响亮（构建红） | V15 探针 |

### 三处代码改动的性质**各不相同**，不要用同一种方式对待

- R1 是「上游把我们的钩子停掉」→ 必须**先造出会红的断言**，再补判定；类型层与运行期都不说话。
- R4 是「上游把我们补丁干的事自己干了」→ **删代码**，不要重写补丁。
- theme-schema 是「上游挪了文件位置」→ 改一行路径，断言内容不动。

### 规划自审（三问）

1. **这两份 spec 是否各自可独立进入实施？**
   本 effort 的 spec 可以。它不需要 `pi-env-bootstrap` 的任何产出：升级票改的是
   `package.json` / `bun.lock` / 三处代码，环境初始化票改的是「agent dir 是否可用」的判定与
   提示面。两者唯一的交集是 `~/.pi/agent` 这个目录，但交集是**只读共享**
   （升级票不写该目录，环境票不读 SDK 版本）。反向也成立：环境票不依赖 1.5.2 的任何新符号。
2. **有没有把决策藏在描述里而不是 Implementation Decisions 里？**
   逐条检查过：升级口径（决策 1）、`undici`（2）、R1（3）、R4（4）、theme-schema（5）、
   依赖与打包（6）、不改只记的三项（7）、一张票（8）—— 全部在 Implementation Decisions。
   描述层（Problem Statement / Solution）只解释「为什么」，不新增任何「做什么」。
   风险排序与「三处性质不同」放在 Further Notes，因为它们约束的是**实施顺序**，
   不构成新的技术选型。
3. **术语有没有混进 component / service / API / boundary？**
   扫过一遍：本文件描述代码结构时只用 module / interface / seam / adapter / depth / leverage /
   locality（落成中文即「模块 / interface / 接缝 / 适配器 / 深度 / 杠杆 / 局部性」）。
   出现的 `/api/...` 是**路由路径本身**（仓内既有命名），不是用「API」指代某个代码结构。
   「边界」一词在讨论守卫时已改写成「守卫面 / 拦截面 / 允许根」。

### 来源索引（本文件每条断言的落点）

| 断言 | 来源 |
| --- | --- |
| 四包精确 pin、`preinstall` 拦 npm | `package.json:57-60`；`bin/install-guard.js:13-21`；评估 §2.1 / §10.1 |
| 12 个新版本、4 个版本带 Breaking Changes | 评估 §2.2 / §2.4 |
| 44/44 符号仍在、41 个签名相同或纯加法 | 评估 §3.2（汇总行） |
| `AgentSessionLike` 43 成员 / 26 方法签名逐字相同 | 评估 §3.3；`lib/pi-types.ts:128-189` |
| `Theme` 构造等价、`required` 仍 51 项 | 评估 §3.4；`lib/rpc/session.ts:152-207` |
| `GrepOperations.readFile` 变 `@deprecated Ignored`、`grep.js` 零调用 | 评估 §8.2；`lib/tool-path-guard-extension.ts:189-193` |
| grep 的 `find` 兄弟判定在定义级 `execute` | `lib/tool-path-guard-extension.ts:66-82` |
| 导出三锚点消失、上游已改显式栈 | 评估 §4.11/R4；`app/api/sessions/[id]/export/route.ts:89-112,130-214` |
| theme-schema 路径搬迁 | 评估 §4.5；`lib/rpc/session.test.mjs:316-350` |
| `undici` 今天已两份（`bun.lock:2029` / `:2141`） | 评估 §6.1 |
| `serverExternalPackages` 6 项不变、`pi-schema` 未验证 | `next.config.ts:31-38`；评估 §7.1 / §12 |
| `tools: []` 是「全禁」的唯一传法 | `lib/rpc/caller.ts:81-89`；评估 §4.9 |
| 成本口径兼容但不改代码 | `lib/session-stats.ts:55-61`；评估 §5.3 |
| `enabledModels` 只消费 message | `lib/model-scope.ts:71-72`；评估 §9.1 |
| trust 语义分歧（既有，不是升级引入） | `lib/project-trust.ts:4-13`；评估 §9.2 |
| 15 项验证清单 | 评估 §10.2（V3 / V7 / V8 为本轮特有） |
| 升级为「一个原子切片」 | 评估 §11 |
