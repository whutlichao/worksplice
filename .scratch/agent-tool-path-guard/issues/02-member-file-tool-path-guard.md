# 02-成员文件工具的路径守卫

Type: task
Status: resolved
Blocked by: 01

Spec: `.scratch/agent-tool-path-guard/spec.md`
设计: `docs/agent-file-tool-path-guard.md`
ADR: `docs/adr/0011-agent-file-tool-path-guard.md`

## What to build

每个成员（agent）调起文件工具时，落点被限制在它自己的允许根内——自己的家目录，加上它显式
绑定的项目目录。落在根外的调用被拒绝，拒绝的报错里同时说出**哪个绝对路径被拒**和**该成员当前的
允许根清单**。

从人类 Owner 视角，这张票交付的是一件可验证的事：无论成员被注入什么指令、无论它改用六个文件
工具里的哪一个，都读不到 worksplice 的数据库、读不到别的成员的家目录、枚举不了附件目录；
而在共享项目代码库里协作的成员之间，互读互写照常不被拦。

成员自己的记忆文件与草稿照常可写——它自己的家目录必须在允许根内（措辞陷阱：排除的是数据目录
作为**根**，不是它下面的任何路径；自己的家目录恰在被排除的父目录下，作为更窄的单独条目开口）。

## Acceptance criteria

- [ ] 六个文件工具全部受同一份约束：成员调 `read` / `write` / `edit` / `grep` / `find` / `ls` 中任一个，落在允许根外的路径都被拒绝（不只挡前三个）。
- [ ] 拒绝时的错误文本含被拒的绝对路径，且含该成员当前的允许根清单。
- [ ] 拒绝是 fail-closed：判定逻辑自身出错（根列表为空、realpath 解析异常）时一律拒绝，不放行。
- [ ] `worksplice.db` 永不可达——用**反向断言**证明：构造一个把允许根设成数据目录的假成员，断言数据库仍被拒。这是「显式不变式」而非「恰好不在列表里」的唯一证据。
- [ ] 共享项目目录下的多个成员互读互写不被拦（ADR-0001 允许的既有设计，不是漏洞）。
- [ ] 成员自己的家目录读写正常，不被数据目录排除规则误伤。
- [ ] 根内符号链接指向根外被拒；指向根内放行。
- [ ] 前缀陷阱不漏：家目录 `/a/b` 不得让 `/a/bc` 通过判定。
- [ ] 对尚不存在的深层目标路径（`write` 新建文件）判定正确（父目录 realpath + basename 回退）。
- [ ] 合法路径零行为变化：同一文件在守卫开/关下读出的内容一致。
- [ ] 覆盖后的工具定义仍带 pi 原生的提示片段与编辑准则（描述未退化——手写定义会静默丢掉它们，这条必须有断言）。
- [ ] 会话 reload 之后守卫仍然生效。
- [ ] 守卫覆盖的工具集合从唯一事实来源派生，不另抄一份名单（ADR-0007 决策 5）。
- [ ] 拒绝**不做**静默路径改写、**不做**静默内容截断。

### 门禁

- 测试档位：**宽**（全量）。理由：这票改的是每个会话的工具注册路径，影响面圈定不了；且本仓全量
  `npm test` 实测仅 8.7 秒 / 941 用例，付全量的成本接近零，不接受窄档。
- `tsc --noEmit` 零错误；lint 只报告不修；`npm test` 全绿。
- **绝不 `next build`**。
- **双轴 code-review（Standards + Spec）不可省**：本票跨 pi 扩展注册 / 新守卫模块 / 会话生命周期 /
  工具名单四处 seam，不满足「无跨模块 seam」这条可数判据，所以不能按小票省掉。

## Notes

- 涉及模块：pi 扩展工厂（既有住户已在此接缝）、新增的允许根判定模块、家目录派生（既有）、
  工具名单唯一来源（既有）。
- 覆盖定义必须由 pi 自己造，不得手写——同名覆盖是整条定义替换。
- 术语用 `CONTEXT.md` 的领域词：允许根、路径守卫。实现里叫「白名单」不是错，但注释与文档用领域词。
- 红绿节奏按 tdd 走，纯函数层先红后绿。

## Answer

### 交付物（PR #94）

| 文件 | 说明 |
| --- | --- |
| `lib/tool-path-guard.ts` | 判定层（**零 SDK 依赖**）：`allowedRootsFor` / `pathGuardScopeFor` / `isWithinAllowedRoots` / `assertWithinAllowedRoots` / `assertSearchRootWithinAllowedRoots` / `resolvePathForGuard` / `pathGuardMessage` |
| `lib/tool-path-guard-extension.ts` | pi 侧装配：六个同名覆盖定义（**全部由 pi 的 factory 生成**）+ `extensionFactories` 接缝外壳；工具集合从 `CODING_TOOL_NAMES` 派生 |
| `lib/tool-path-guard.test.mjs` | 纯函数层 21 例（根内 / 根外 / 前缀陷阱 / 符号链接 / 不存在的深层目标 / 根列表异常 fail-closed / 注入形态 / 显式不变式反向断言 / 搜索根判定） |
| `lib/tool-path-guard-extension.test.mjs` | 集成层 8 例（真实会话，`jiti` + `RpcCaller`，零凭证） |
| `lib/rpc/caller.ts` (+8/-2) · `lib/rpc/session.ts` (+6) · `lib/agent-runtime.ts` (+4) | 接线：`RpcSessionStartOptions.pathGuard` + 成员会话按成员算判定域；`session.ts` 主流程零改动 |
| `AGENTS.md` File Map | 登记两个新模块 |
| `.scratch/agent-tool-path-guard/evidence/` | 红绿证据、全量测试汇总、find 洞取证、双轴 review 编排脚本、既有 lens 发现归属取证 |

### outcome

resolved。六个文件工具（read / write / edit / grep / find / ls）对成员会话全部受**同一份**允许根约束；拒绝文本 = 被拒的绝对路径 + 该成员当前允许根清单；ADR-0011 决策六三条硬要求逐条落地（realpath 取最深存在祖先 + basename 回退 / `path.relative` 而非前缀 / 判定自身出错一律拒绝）；`worksplice.db` 永不可达写成**判定层**的显式不变式（数据目录树整棵不可达，唯一例外 = 成员自己家目录这条更窄的单独条目），并有反向断言证明它不是「恰好不在列表里」。

### 测试数字（宽档 = 全量）

- `npm test`：**970 / 970 pass，0 fail**（7.6s）。基线 941 → 新增 **29**（纯函数 21 + 集成 8）。汇总：`evidence/full-suite.txt`
- `node_modules/.bin/tsc --noEmit`：**0 error**
- `npm run lint`：**0 error**（1 warning 在未改动的 `hooks/useI18n.tsx`，与本票无关）
- 红绿节奏（tdd）：纯函数层先红（`MODULE_NOT_FOUND`，`evidence/red-pure.txt`）→ 绿；集成层先红（`evidence/red-extension.txt`）→ 绿
- 绝不 `next build`（未跑）

### 对 ADR-0011 / 设计文档取证的事实修正（实测，非推测）

设计 D1 的表断言「`operations` 是每个工具唯一的本地 fs 出口」在 pi 0.99.2 上**对 find 不成立**：`find.js` 只在 `customOps?.glob` 为真时才走 ops 分支（`if (customOps?.glob)`），否则 `spawn(fd)` 真实遍历、ops 一次不碰。取证：只做 ops 守卫时 `find "*" <dataDir>` 能列出 `agents/… attachments/… worksplice.db`（`evidence/find-hole.txt`）。grep 同源问题：它把自己的 `ops.isDirectory` 异常改写成 `Path not found`，调用被拒但**允许根清单到不了模型**（票面 AC 第 2 条对 grep 不成立）。

处置：对这两个工具补一层**定义级搜索根判定**——仍走同名覆盖定义（不新开注入路线）、复用 `isWithinAllowedRoots` 同一份规则（不写第二份判据）、不改写参数、不截断结果；搜索根按 pi `resolveToCwd` 同源形态解析（`@` → `~` → `file://` 的顺序与 pi 的 `normalizePath` 一致），且绝对形态的原文另判一次。这是本票唯一超出票面字面的实现，取舍见下方 Spec 报告与代码注释。

**提问记录**：开工时就此走 `orchestration ask`（`msg_797b4e29a8be`）给出 A/B/C/D 四选一，900s 超时无应答；按「find 的洞会让 AC-1/AC-4 对六工具之一不成立」取 **A**（find + grep 都补），并在此如实标注为超时后的自主决策——需要时可回退到 B（只补 find，grep 文案缺口记豁免）。

### 已知边界与残留（本票承诺之外，已写进代码注释 / 设计文档口径）

- **bash 不收口**：`PRESET_DEFAULT` 下 bash 仍是唯一绕过面（票 03 的范围，本票不改档位构成）。
- **只覆盖成员会话**：守卫经 `lib/agent-runtime.ts` 的成员启动路径传入；人类会话（`/api/agent/new`、`/api/agent/[id]`、auto-name）不传 `pathGuard` 即不装守卫——人类是可信的 Owner，且这些路径不承载频道注入。直接由 API 起的「某 agent 的 session 文件」不带守卫，属残留观察点（不在本票授权内）。
- **`ls` 对根内指向根外的符号链接条目**：`ops.stat` 被拒后 pi 自身 `catch { continue }` 跳过该条目的后缀标记，条目名仍会出现（列出目录本身是允许行为）。
- **TOCTOU**：判定与实际 IO 之间的窗口按设计不处理（ADR-0011 决策六）。

### Review

按 `code-review` skill 的流程做**双轴独立评审**（两个并行只读子代理，固定点 `f57bfd8`，diff `f57bfd8..28a9b18`，编排脚本见 `evidence/double-axis-review.workflow.mjs`）。两份报告**不合并、不重排**，原文如下。

#### Standards（独立子代理报告，原文）

**Correct（有证据的既有优点）**
- 唯一事实来源守住了：`GUARDED_TOOL_NAMES = CODING_TOOL_NAMES.filter(键在表内)`（`tool-path-guard-extension.ts:57`）、根由 `agentHomeDir` 派生（`tool-path-guard.ts:63`），未另抄名单——符合 ADR-0007 决策 5 / ADR-0011 Consequences「同一事实不写两处」。
- i18n 分层正确（`docs/i18n.md`）：注释/证据文档中文，进模型上下文的拒绝文本英文（`pathGuardMessage`）——属「产品内容 · 英文硬编码」。
- 测试落 `lib/*.test.mjs` + node:test（`engineering-standards.md §2.1`）；证据自洽：纯层 20 + 集成 8 = 28，941→969 与 `evidence/full-suite.txt` 对上；`.scratch/**` 入库是 repo 明确约定（`eslint.config.mjs` 注释）。

**Finding（均为判断题；未发现硬违规）**
- P2 · Speculative Generality / 死 ops：`tool-path-guard-extension.ts:165` 的 `findOperations = { exists } as unknown as FindOperations` 与 `:197` 的 `find: findOperations` 是死重。证据：`find.js:67-69` 只在 `customOps?.glob` 为真时才碰 ops，`find.d.ts:37,39` 的 `operations` 是可省参数且 `defaultFindOperations.glob` 是占位 `() => []` —— 传 `{exists}` 与不传走同一条 fd 分支，`exists` 永不被调用（本文件自己的注释也承认）。最小改法：删这 6 行与断言，`find` registrar 改调 `createFindToolDefinition(cwd)`。
- P2 · 同一事实两处持有（Data Clumps）：`PathGuardScope.homeDir` 恒等于 `allowedRoots[0]`（`allowedRootsFor` 必以 homeDir 打头），且 `pathGuardScopeFor:75/77` 把 `agentHomeDir` 算了两遍。手工构造的 scope（测试用 spread）可让两者不一致。最小改法：`homeDir` 由 `allowedRoots[0]` 派生，或 `agentHomeDir` 算一次传入。
- P2 · Duplicated Code（测试夹具）：两个新测试文件各自复制 `write` / `agentRow` / 夹具常量；`tool-path-guard-extension.test.mjs` 的 `FULL` 与内联 `["read","bash","edit","write"]` 抄了 `CODING_TOOL_NAMES` / `PRESET_DEFAULT`。夹具重复可抽；期望值独立抄写本身有价值，故仅记。
- P2 · 文档漂移：本 diff 引入全仓首个 `jiti.import("./rpc/caller.ts")` 的真会话集成层，`§2.1` 测试类型表未收录，而该文自称活文档「新增约定在此集中记录」；`AGENTS.md` File Map 也未登记两个新 lib 模块。
- P2 ·（过期文档，非本 diff 引入）：新 `.ts` 用双引号，`§1` 写「字符串统一单引号」，但全仓 `lib/*.ts` 一致且 lint 0 error，属文档过期。
- 判断但不计违规：ops 实现与 pi 默认同形、`resolvePathForGuard` 部分镜像 pi `resolveToCwd`——ADR-0011 决策一/四授权且注释已记；`lib/rpc → lib/data/dirs` 是 ADR-0008 允许的向下边。

**Merge verdict: OK with notes**（无 P0/P1；上述 P2 建议在释放前清理 `findOperations` 死码）。

#### Spec（独立子代理报告，原文）

**Correct（已核实）**
- 六工具同一约束、拒绝文案（绝对路径 + 允许根清单）、fail-closed、反向断言（数据目录设为根仍拒 DB）、家目录不被误伤、符号链接（双向）、前缀陷阱、不存在深层目标、描述未退化、reload 存活、工具集合由 `CODING_TOOL_NAMES.filter(name in GUARDED_REGISTRARS)` 派生——逐条有断言，`lib/tool-path-guard.ts` 与 `lib/rpc/caller.ts:101-110` 实现与 ADR-0011 决策一/二/四/五、D6 三条硬要求一致。成员会话唯一启动路径 `lib/agent-runtime.ts:270-284` 已传 `pathGuard`，restart 复用 `startSession`，人类会话不传即不装守卫（符合规范）。CONTEXT.md 已录入术语。工作区干净（仅一个 scratch 文件未跟踪），无提交后改写。

**Finding**
- **P1** `lib/tool-path-guard.ts:177-186` `resolvePathForGuard`：`expandHome` 排在 `stripAtPrefix` **之前**，与 pi `normalizePath`（`utils/paths.js:64` 先 strip@ 再 `:70` expandTilde）顺序相反。故 `find` 的搜索根传 `@~` 时守卫把它解析成 `<cwd>/~`（在根内→放行），pi 实际解析成 `os.homedir()`（通常不在允许根内），fd 分支于是遍历整个家目录（含 `~/.worksplice` 结构泄漏）——正是本 diff 要堵的洞。注释自称"与 pi 同源展开"（该文件 168-175 行）与此不符。最小修：把 `stripAtPrefix` 提到 `expandHome` 之前，并补 `@~` 用例。
- **P2** 同函数缺 pi 的 `normalizeUnicodeSpaces`（`paths.js:61-63`）与 win32 `normalizeWindowsShellPath`；dir 分隔差异可致判定与 pi 不一致（本机 macOS 影响小）。

**特别判断：find/grep 的定义级搜索根判定**
必要修正，非越权：设计 D1 断言"operations 是每个工具唯一的本地 fs 出口"**不成立**（find 无 `customOps.glob` 即走 `spawn(fd)`、ops 一次不碰；grep 吞 `ops.isDirectory` 异常、丢掉允许根清单），不补这层就满足不了票据 AC-1「六个文件工具全部受同一份约束」。但它引入了 D2 路线③被否决的理由——"自写路径解析必然漂移"——当前正是该漂移（上面 P1 即证据）。其余部分（定义仍由 pi factory 造、只包 `path` 判定、不重写不改参）与 spec 一致，可接受；建议按 P1 对齐解析顺序并补 `@~`/unicode-space 用例。

**Scope creep**：无。`presetSafeActivation`(`defaultActive:false`) 超出 spec 字面，但为守住"本票不改档位"所必需，且有 FULL/DEFAULT 双侧断言。

**Merge verdict: OK with notes**（P1 建议发布前修）。需 supervisor 跑：`npm test`、`node_modules/.bin/tsc --noEmit`、`npm run lint`。

### findings 处置

| 轴 | finding | 处置 |
| --- | --- | --- |
| Spec P1 | `@~` 归一步骤顺序与 pi 相反（find 可被 `@~` 绕过） | **已修**（`stripAtPrefix` 提前，注释写明顺序即契约）＋新增用例「`@~` 先裁 `@` 再展开成家目录」（现 21 例纯函数全绿） |
| Standards P2 | find 传 `{exists}` 是死参数 + 一处 `as unknown as` | **已修**：find 不再传 `operations`（`createFindToolDefinition(cwd)`），删断言与死码 |
| Standards P2 | `pathGuardScopeFor` 把 `agentHomeDir` 算两遍 | **已修**：算一次，经 `boundProjectRoots` 复用；`homeDir` 与 `allowedRoots[0]` 的恒等关系写进注释 |
| Standards P2 | AGENTS.md File Map 未登记新模块 | **已修**：登记 `tool-path-guard.ts` / `tool-path-guard-extension.ts` |
| Spec P2 | 缺 `normalizeUnicodeSpaces` / win32 shell 归一 | **豁免（已论证）**：该步只改字形不改包含关系——空格替换不改变「是否绝对」「是否 `~/` 开头」「是否落在某根下」，故不可能翻转放行/拒绝；且绝对形态的原文会另判一次。win32 归一不影响 macOS/Linux 上的 `path.resolve` 语义。风险与理由记在此，供后续统一抽取 pi 解析时一并处理 |
| Standards P2 | 两个测试文件夹具重复 / 期望值手抄清单 | **豁免（判断）**：纯层与集成层各持自己的夹具是刻意的（互不耦合、可独立跑）；`FULL` 与 DEFAULT 清单手抄是「档位不得漂移」的断言本身（照抄 `PRESET_DEFAULT` 就把断言变成同义反复） |
| Standards P2 | `engineering-standards.md §2.1` 测试类型表未收「真会话集成层」 | **豁免（归属）**：该文自称活文档、属全局规范文档；这类真会话窄测在 `lib/rpc/preset-none-start.test.mjs` 已是既有形态（并非本 diff 引入），且本票不扩规范文档的授权。已在 PR 描述里点出，供 coordinator 决定是否单开一条 |
| Standards P2 | §1「字符串统一单引号」与全仓双引号不一致 | **豁免（过期文档，非本 diff 引入）**：全仓 `lib/*.ts` 一致用双引号且 lint 0 error |
| 工具报 | `lib/rpc/session.ts` 19 条 lens 自检发现（`as unknown as` 缺 SAFETY 注释 / chained assertion） | **不改（本票范围外，已取证）**：`evidence/preexisting-lens-findings.txt` 证明被标记行 10/10 逐字存在于改动前的 `HEAD~1`，本票对该文件的改动只有 6 行（一个 type import + 一个接口字段、零断言）；仓库门禁是 `npm run lint` + `tsc`（均 0 error）。改这些既有断言会把 diff 扩到与本票无关的会话生命周期代码上 |
