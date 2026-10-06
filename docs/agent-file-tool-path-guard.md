# agent 文件工具的路径边界（设计文档）

**状态**：设计已定，待实施票。
**票**：`agent-tool-path-guard`（设计票）。
**关联**：ADR-0001（家目录与共享项目目录）、ADR-0007（SDK 委托边界）、ADR-0008（分层与深模块切分）。

---

## Problem Statement

worksplice 里的每个 agent 都是一个 pi 会话，拿到的是 pi 原生的文件工具。worksplice 现有的身份隔离**只到消息与游标这一层**——频道、任务、唤醒、backfill 归属都有门禁，但一旦 agent 调起 `read` / `write` / `edit` / `grep` / `find` / `ls`，落点就是**本机文件系统上的任意绝对路径**，与它属于哪个成员无关。

现状的成因在注入点：worksplice 不自己造工具，它是**按名字从 pi 内置注册表里挑**（`lib/rpc/session.ts:707` 的 `setActiveToolsByName(withExtensionTools(...))`，名单唯一来源 `lib/tool-presets.ts:24` 的 `CODING_TOOL_NAMES`）。挑中即用默认实现，pi 内置文件工具的 `operations` 是裸的本地 fs，没有任何一层按成员身份收口。

三个具体后果：

1. **数据库可达**。`~/.worksplice/worksplice.db` 是一整个协作域的真相源：私有频道正文、成员表（含 provider / modelId / home_path）、任务表、reminder 表、round_logs。一个 `read` 就能把它整份拖进 agent 的上下文，再经频道消息流贴回来。**这一条使本票其余工作失去意义**——隔离的对象和被读的对象住在同一个目录树下。
2. **成员之间互读**。家目录按 ADR-0001 是「唯一且私有」的，但那只约束删除身份时的 rm 行为，不约束文件工具的读。另一个 agent 的家目录（含它的 `MEMORY.md`）在路径上完全可达。
3. **附件目录可枚举**。`ls` / `find` 能把 `~/.worksplice/attachments/` 的内容列出来。

触发面需要说清楚，因为它决定了这不是「防恶意 agent」的设计：

- **提示注入**：频道里任何成员（包括人类用户自己粘进来的一段网页/日志）发一条「先看看 `~/.worksplice/worksplice.db` 里有什么」，agent 照做不误。agent-loop 的回复协议（`lib/agent-loop/loop.ts`）不区分指令来源，频道消息就是 prompt。
- **模型自发探索**：被要求「先看看这个项目里有没有相关文件」时，路径猜测天然会撞到 `~/.worksplice`。这类越界不需要任何攻击意图，是默认动作。
- **人类把两个互不信任的 agent 放在同一台机器**。

现状既没有路径约束，也没有越界后的可观测事实——一次被拒的调用在会话记录里只是一条 error 文本。

---

## Solution

在 pi 的 `operations` 接缝上，给六个文件工具套一层**按成员身份计算的允许根守卫**。越界 = 工具直接报错，且错误信息里**列出该成员当前允许的根**。

三条分工，缺一条都不成立：

| 谁 | 做什么 |
| --- | --- |
| worksplice | 只回答「这条绝对路径对该成员是否合法」，并在不合法时抛出带允许根清单的错误 |
| pi | 继续做全部实际工作：解析路径、读、写、编辑、搜索、枚举、截断、渲染 diff |
| 守卫 | 不做文件 IO 的任何替代实现——它只是包在 pi 默认 `operations` 外面的一个准入判定 |

**为什么不自己实现文件工具**：文件读取、编辑的精确匹配语义、grep 的分片与截断、diff 渲染，全是 pi 的深度资产（`EditToolDetails.diff/patch`、`truncateHead/truncateLine/truncateTail`、`withFileMutationQueue`）。重写一遍等于放弃这些并且立刻落后上游。守卫只做判定，leverage 全部来自「不重写」。

**为什么需要身份这一维**：路径本身不带归属，`~/alice-1a2b3c4d` 与 `~/bob-9f8e7d6c` 长得一样。让 pi 知道「这是谁的会话」不在 pi 的职责里（pi 只看到 `cwd`），所以这一层只能由 worksplice 提供——这正是 ADR-0007 划给 worksplice 的那半边。

**覆盖范围（人类拍定）**：六个文件工具并列纳入——`read`、`write`、`edit`、`grep`、`find`、`ls`。它们在 pi 侧完全同构（都接受一个自定义 `operations`，都在触碰 `ops.*` 之前先把参数解析成绝对路径），共用同一套允许根、同一个注入点。只挡前三个等于交付一个 FULL 档下执行默认「搜索一下」即可绕过的 guard。

---

## User Stories

1. 作为人类 owner，我给 agent A 派活时，知道 A 的 `read` 读不到 agent B 的家目录，因为 B 的 `MEMORY.md` 是 B 的私有上下文。
2. 作为人类 owner，我确信没有任何 agent 的文件工具能读到 `~/.worksplice/worksplice.db`——不是「默认不包含」，是一条显式不变式，任何改动它的代码都要显式推翻这条不变式。
3. 作为人类 owner，我把两个互不信任的 agent 放进同一台机器时，它们的文件工具互相不可达（除显式共享的项目目录外）。
4. 作为 agent，我被要求「去 `../other-agent/` 看看有没有现成实现」时，工具报错并告诉我**我自己的允许根是哪几个绝对路径**，我据此改用工作区内的相对路径重试，不需要猜。
5. 作为 agent，我的工作区（家目录或显式绑定的项目目录）内的读写、搜索、枚举**完全不受影响**——守卫对合法路径零额外行为，不改变报错文案、截断行为与 diff 呈现。
6. 作为人类 owner，我看 agent 详情面板/会话记录时，能从错误文本一眼分辨「越界」与「文件不存在」两类失败，不必翻代码。
7. 作为人类 owner，我给多个 agent 显式绑定同一个项目目录后，它们在该目录内互读互写——这是 ADR-0001 明确允许的协作形态，不是漏洞。
8. 作为人类 owner，我给某个 agent 换工作区后，它的新会话按新目录重算允许根；不存在「旧目录的权限还挂在活着的会话上」的窗口。

---

## Implementation Decisions

### D1 · 注入点选在 `operations`，不是别的层

pi 侧六个工具的形状已逐个核对（行号为 `@earendil-works/pi-coding-agent` dist）：

| 工具 | 解析成绝对路径的位置 | 随后调用的 `ops.*` |
| --- | --- | --- |
| `read` | `read.js:73` `resolveReadPathAsync(path, cwd)` | `:77` `ops.access`、`:86`/`:111` `ops.readFile` |
| `write` | `write.js:31` `resolveToCwd(path, cwd)` | `:44` `ops.mkdir`、`:47` `ops.writeFile` |
| `edit` | `edit.js:94` `resolveToCwd(path, cwd)` | `:116` `ops.readFile`、`:126` `ops.writeFile` |
| `grep` | `grep.js:57` `resolveToCwd(searchDir \|\| ".", cwd)` | `:61` `ops.isDirectory`、`:83` `ops.readFile` |
| `find` | `find.js:65` `resolveToCwd(searchDir \|\| ".", cwd)` | `:70` `ops.exists`、`:78` `ops.glob` |
| `ls` | `ls.js:40` `resolveToCwd(path \|\| ".", cwd)` | `:43` `ops.exists`、`:48` `ops.stat`、`:56` `ops.readdir` |

结论：**`operations` 是每个工具唯一的本地 fs 出口，且它拿到的已经是绝对路径**。守卫包在这里有三个好处：①不需要自己复刻 pi 的路径解析（`~` 展开、`@` 前缀裁剪、macOS AM/PM / NFD / 花引号变体回退全在 `path-utils.js` 里，那些变体回退是给截图文件名用的，自己写一份必然漂移）；②判定点与副作用点相邻，不存在「判过了但写到别处」的缝；③六个工具同一个模式，代码增量近乎为零。

### D2 · 核心分叉：三条注入路线的取舍

这是本票最需要判断力的一处。三条路都存在，且前两条在机制上**同源**，必须说清差别在哪。

#### 路线 ①：pi 扩展用 `registerTool` 注册同名工具覆盖

扩展在加载期调 `registerTool({ name: "read", ... })`，写进 `extension.tools`（`extensions/loader.js:231-242`）。之后 `AgentSession._refreshToolRegistry` 把它并进 `definitionRegistry`（`agent-session.js:2827-2832`），再 wrap 进 `toolRegistry`（`:2856-2859`）——**同名即覆盖，与来源无关**。

#### 路线 ②：worksplice 侧构造工具定义后传入

拆成两个子形态，差别是决定性的：

- **②a `baseToolsOverride`**：`AgentSessionConfig.baseToolsOverride?: Record<string, AgentTool>`（`agent-session.d.ts:146`）正是为「自定义运行时覆盖基础工具」准备的。**但它不在 worksplice 走的接缝上**——worksplice 用 `createAgentSessionFromServices`（`lib/rpc/caller.ts:126`），其 options 只有 `tools` / `excludeTools` / `noTools` / `customTools`（`agent-session-services.d.ts`），**没有 `baseToolsOverride`**。要用它就得退回更低层的 `createAgentSession`，自己组装 `agent` / `settingsManager` / `modelRuntime` / `resourceLoader`——那正是 ADR-0007 判给 pi 的地盘（`pi 管 pi`），worksplice 不该重做一遍再自己维护。**②a 不可取。**
- **②b `customTools`**：`customTools?: ToolDefinition[]` 可达，传同名定义即覆盖。但它的覆盖面比 ① 窄：`customTools` 是构造期入参，而 ① 走的是扩展加载器——`reload()`（`agent-session.js:2938-2943`）会 `_buildRuntime` 重建整个注册表，扩展定义的重建由 pi 的 loader 保证，顺序上是既有住户。两者都要在实施票里验证 `reload` 后守卫仍在，但 ① 落在一个 worksplice **已经住着的接缝**上。

#### 路线 ③：在 `tool_call` 钩子上前置校验

`ExtensionAPI.on("tool_call", handler)`（`extensions/types.d.ts:1189`），事件在工具执行前触发，handler 可返回 `{ block: true, reason }` 阻断（`ToolCallEventResult`，`:1054-1063`；阻断实现在 `extensions/runner.js:965`）。

**不取，理由三条，按重要性排**：

1. **它要求自己复刻路径解析。** `ToolCallEvent.input.path` 是**模型给的原始字符串**（`ReadToolCallEvent.input: ReadToolInput`），钩子拿到的不是绝对路径。pi 的 `resolveToCwd` / `resolveReadPathAsync` **不在包的公开导出面上**（`package.json` 只导出 `.` / `./rpc-entry` / `./client` / `./experimental/plugin`；根 `index.d.ts` 未导出 `path-utils`），worksplice 要么深引内部路径（上游一改就碎），要么自己写一份——而 D1 已经说明自写解析必然漂移（macOS 的 NFD / 花引号变体）。
2. **六个工具要各判一次，且判据不同。** `grep` / `find` / `ls` 的 `path` 是**可选**的搜索根（`grep.js:57` 的 `searchDir || "."`），且 `grep` 的 `ops.readFile` 是在**遍历过程中**对每个命中文件调的——钩子只能看到搜索根，看不到实际读了哪些文件。守卫要判的不止是「参数」，而是「副作用」。
3. **它是事件钩子，不是旁路收口。** `operations` 是实现细节里唯一的 fs 出口，`tool_call` 是调用链上的一个通知点；将来若 pi 给某个工具开一条不经过 `emitToolCall` 的路径（例如某些 `executeTool` 快捷路径），钩子会漏而 `operations` 不会。

#### 结论

**取路线 ①**：一个 worksplice 自己的 pi 扩展工厂，经**既有的** `resourceLoaderOptions.extensionFactories` 接缝注册（`lib/rpc/caller.ts:103`——`forcedEmptySystemPromptExtension` 已是这个接缝的住户），扩展在加载期对六个工具各注册一个同名定义，每个定义由 pi 自己造（`createReadToolDefinition(cwd, { operations })` 等，见 D3），只把 `operations` 换成守卫版。

`lib/rpc/session.ts` 主流程**零改动**——它仍然只按名字激活，工具名一个都没变。`lib/rpc/caller.ts` 的改动是「多一个 extension factory」，与既有那行同形。

### D3 · 覆盖必须用「pi 造定义」，不能手写 ToolDefinition

同名覆盖是**整条定义替换**，不是字段级 merge。`agent-session.js:2833-2848` 的 `_toolPromptSnippets` / `_toolPromptGuidelines` 是从**替换后**的 `definitionRegistry` 重新派生的——手写一份 `ToolDefinition` 会静默丢掉：

- `readToolSystemPromptContribution` 的 snippet `Read file contents` 与 guideline `Use read to examine files instead of cat or sed.`
- `editToolSystemPromptContribution` 的四条精确编辑准则（`edits[].oldText` 精确匹配、多处改动用一次调用、不重叠、oldText 尽量小）
- `writeToolSystemPromptContribution` 的 `Use write only for new files or complete rewrites.`
- `EditToolDetails` / `EditRenderState` 驱动的 diff 渲染（`renderCall` / `renderResult`）

所以守卫的定义必须**由 pi 生成**：`createReadToolDefinition(sessionCwd, { operations: guardedRead })`、`createEditToolDefinition(...)`、`createWriteToolDefinition(...)`、`createGrepToolDefinition(...)`、`createFindToolDefinition(...)`、`createLsToolDefinition(...)`——六个 factory 全部从包根公开导出（`index.d.ts:26`），拿到的是**字段完整**的定义，只多了守卫版的 `operations`。这样描述/schema/renderer/guidelines 全部与 pi 保持逐字一致，升级 pi 时自动跟随。

### D4 · 允许根模块：单一事实来源在 `lib/data/dirs.ts`，不在 rpc 层

新模块 `lib/tool-path-guard.ts`，窄接口，depth 优先：

```
allowedRootsFor(member, dataDir) → string[]     // 纯函数，算根
isWithinAllowedRoots(absolutePath, roots) → 判定 + 拒绝理由   // 纯函数
guardedToolDefinitions({ cwd, roots }) → ToolDefinition[]     // 六个，薄封装
```

纪律：

- **根的构成只有一个事实来源**：`lib/data/dirs.ts` 的 `agentHomeDir(dataDir, id, name)` 与 `isDerivedAgentHomePath(candidate, id)`，加上成员行按**当前 dataDir 重推**的工作区解析（ADR-0001：家目录派生绑定不落库绝对路径，读取侧重推）。`lib/rpc` 不自己重算一份根。
- **工具名单也不得写第二份**。`CODING_TOOL_NAMES`（`lib/tool-presets.ts:24`）已经是「哪些是内置编码工具」的唯一事实来源，守卫的工具集合从它派生或作为入参接收。这正是 ADR-0007 决策 5 记的那条教训（同一事实曾被写两处而漂移），本票不得重犯。
- **快照时机 = 会话创建时算一次**。不做每次调用回查 DB：换工作区本身就会销毁旧 cwd 的会话（ADR-0001「换目录即换会话」），所以不存在「旧目录的权限挂在活会话上」的窗口（User Story 8）；每次调用回查只会在 hot path 上引入一次 SQLite 读，换不来任何正确性。

### D5 · 显式不变式（人类拍定，逐条写死）

允许根是一个**具体的目录列表**：

```text
allowedRoots(member) = [ 自己的家目录, 该成员显式绑定的项目目录（若有） ]
```

**永不纳入允许根**，逐条列明，不写成「默认不包含」：

| 排除项 | 理由 |
| --- | --- |
| `~/.worksplice/` 作为**根本身** | 它是数据目录的根；一旦被纳入，目录树下的一切都跟着可达，等于没有 guard |
| `~/.worksplice/worksplice.db` | **本票最显眼的一条不变式**：数据库一旦可读，注入后可读走全部私有频道 + 成员表 + 任务表 + reminder 表 + round_logs，本票等于白做 |
| `~/.worksplice/attachments/` | 附件目录。排除的实际损失接近零——见下方「为什么排除附件几乎不亏」 |
| 其他成员的家目录 | ADR-0001 的「唯一且私有」在**删除语义**上的约束必须延伸成**读取语义**上的约束，否则私有只是删除时私有 |

> **注意措辞**：`~/.worksplice/agents/` 是家目录的**父目录**，它是排除项；但成员**自己**的家目录 `<dataDir>/agents/<slug>-<id8>` 是一条**更窄的、单独的白名单条目**，被显式开口。排除的是「这个根本身可整棵可达」，不是「这个根下不许有任何路径」。若把排除写成「`~/.worksplice/` 整个」，则未绑定项目目录的 agent 白名单为空、任何文件工具调用都被拒，本票等于把功能关掉——这两种写法必须区分清楚。

**为什么排除附件目录几乎不亏**：附件落盘用 `randomUUID()` 作文件名、无扩展名（`lib/domain/collab/attachments.ts:42`），真实文件名与消息的映射存在 SQLite 的 `attachments` 表（`lib/data/schema.ts:96-104`）。所以 agent **本来就无法通过路径访问任何具体附件**——它连文件名都不知道。排除 `attachments/` 真正防住的是 `ls` / `find` 对该目录的枚举。这条要写进设计理由，否则后来者会以为「为了让 agent 能看附件」而重新开口子。

**共享项目目录不是漏洞**：ADR-0001 明确允许多个成员绑定同一项目目录（为的是协作代码库）。多个 agent 在该项目目录内互读互写是既有设计的有意结果，不是本票要收的口子。本票收的只有「非白名单一律不可达」这一条。

### D6 · 路径判定：realpath + `path.relative`，fail-closed

判定函数 `isWithinAllowedRoots(absolutePath, roots)` 的三条硬要求：

1. **符号链接**。pi 的 `resolveReadPathAsync` 只做归一化（`normalizeUnicodeSpaces` / `stripAtPrefix`）与几种 macOS 文件名变体回退，**不做 realpath**（`path-utils.js` 全文无 `realpath`）。所以一个落在允许根内、指向根外的符号链接会通过任何纯字符串前缀判定。对策：取路径中**最深的存在的祖先**做 `fs.realpath`，用 realpath 后的结果判包含关系；目标本身不存在时（`write` 的常见情形）退到父目录 realpath + 原 basename。
2. **前缀不用 `startsWith`**。用 `path.relative(root, target)`：结果非空、不以 `..` 开头、且不是绝对路径，才算在内。否则 `/a/bc` 会命中 `/a/b`。
3. **fail-closed**。判定自身出错（`realpath` 抛错、根列表为空、根列表无法解析）一律**拒绝**，不降级放行。守卫出 bug 时的失效方向必须是「agent 干活干不成」，不是「agent 读到不该读的」。

已知残留：realpath 与随后的实际 IO 之间存在 TOCTOU 窗口。本设计不处理它——威胁模型是「提示注入 + 模型自发越界」，不是有能力在毫秒级窗口里抢 symlink 的对手。要处理它需要 openat/O_NOFOLLOW 一类机制，那是另一张票的形态（见 Out of Scope）。

### D7 · 越界处置：报错 + 列清单（人类拍定）

拒绝时的错误文本形态（语义固定，具体措辞实施票再定）：

```text
path outside this agent's allowed roots: <被拒的绝对路径>
allowed roots for <成员名>:
  - <家目录绝对路径>
  - <项目目录绝对路径>
```

三条理由，缺一条就会退化：

1. **只报错会让模型反复换路径重试**，烧轮次。agent-loop 的 `MUST_RESPOND_FAILURE_CAP = 2`（ADR-0005）在连续失败后 cap-ack 推进游标——一次注入就能把一个正常 agent 的这一轮直接作废掉。给出清单等于让模型**一次就自我纠正**：`read` 失败 → 看到自己的家目录绝对路径 → 改用它。
2. **不清静改写**。把越界路径悄悄重定向到工作区内的同名相对路径，会让 agent 以为自己读到了目标文件，实际读的是别的东西——这是比拒绝更坏的失效形态（沉默的错误答案）。
3. **不静默截断**。截断同样让 agent 拿到一份「看起来能用」的错误内容。

错误从 `ops.*` 抛出，pi 会把它变成一条 `isError: true` 的工具结果回到模型上下文——这正是我们要的通道，不需要额外的上报通道。

### D8 · 与既有 ADR 的关系

- **ADR-0001**（家目录与共享项目目录）：白名单的两条根直接复用它的「家目录派生绑定不落库、读取侧按当前 dataDir 重推」规则。本票**不新造**目录解析逻辑，也不改 ADR-0001 的任何结论。
- **ADR-0007**（SDK 委托边界）：D2 的分叉结论与它同向——守卫属于 worksplice 侧，`operations` 的实现属于 pi 侧。D4 的「单一事实来源」纪律（工具名单、根的构成各只写一处）是 ADR-0007 决策 5 的延续。
- **ADR-0008**（分层与深模块）：`lib/tool-path-guard.ts` 是 `lib/rpc` 的同层辅助模块，不引入新依赖方向；它**不**经 `lib/domain/collab` 读成员——成员行已经由调用方（`lib/rpc/caller.ts` 的启动路径）解析好传进来。

---

## Testing Decisions

**本票不跑测试**（设计票，源码改动面为空，设计文档没有被测对象）。以下是**后续实施票**的测试面，作为设计的一部分交付：

### 纯函数层（零 SDK 依赖）

`lib/tool-path-guard.test.mjs` —— 覆盖矩阵（根内 × 根外 × 边界形态）：

| 维度 | 用例要点 |
| --- | --- |
| 根内 | 家目录内的相对路径、绝对路径、`~` 展开、项目目录内的深层路径 |
| 根外 | `~/.worksplice/worksplice.db`、其他成员家目录、`attachments/`、`/etc/passwd`、家目录的**兄弟目录**（`~/x-00000000-extra`） |
| 前缀陷阱 | `/a/bc` vs 根 `/a/b`（`startsWith` 实现会漏，用 `path.relative` 不漏） |
| 符号链接 | 根内 symlink 指向根外 → 拒绝；指向根内 → 放行 |
| 不存在的目标 | `write` 到尚不存在的深层路径（父目录 realpath + basename 回退） |
| 根列表异常 | 空根列表 → 一律拒绝（fail-closed） |
| 注入形态 | `~/` 展开、`@` 前缀裁剪、macOS NFD / 花引号文件名变体（守卫不吃掉 pi 的变体回退结果） |

### 集成层

- **守卫在位且描述未退化**：注入后 `inner.getAllTools()` 里 `read` / `edit` / `write` 的定义仍带 pi 原有的 `promptGuidelines`（D3 的回归守卫——手写定义会静默丢掉它们，这条必须有断言）。
- **合法路径零行为变化**：对同一文件分别在守卫开/关下调用 `read`，输出一致。
- **reload 存活**：`inner.reload()` 之后守卫仍在（D2 路线 ① 的关键性质——`reload` 会 `_buildRuntime` 重建整个注册表）。
- **反向断言**：构造一个把根设成 `~/.worksplice` 的假成员，断言 `worksplice.db` 仍被拒（证明排除项是显式不变式，不是「恰好不在列表里」）。

### 门禁

`node_modules/.bin/tsc --noEmit` + `npm run lint`（`oxlint .` 只报告，不 `--fix`）+ `node --test`。**绝不 `next build`**。

---

## Out of Scope

### bash 不在本票，且这意味着什么

**bash 不受本设计约束**。`bash` 能执行任意 shell 命令，`cat ~/.worksplice/worksplice.db` 对它毫无阻力。因此：

- 本设计**只**拦住「模型直接调用文件工具」这一条路径；**拦不住**「模型改用 bash 绕一圈」。
- 在 `PRESET_DEFAULT`（`read` / `bash` / `edit` / `write`）档下，**bash 就是唯一剩余的绕过面**。
- 换句话说：本票交付的是**纵深防御的一层**，不是隔离的完成态。

后续那张票要解决的是「怎么让 bash 也无法越界」，可能的技术形态至少有这几种（不在本票取舍，留给那票 grill）：

1. **受限 shell / 命令白名单解析**：把命令解析成 argv，只放行白名单内的子命令与参数形状。难在解析完备性与引号/重定向/子 shell 的逃逸面。
2. **路径重写（wrapper）**：把命令中的绝对/相对路径参数按允许根重写或拒绝。难在覆盖不全（`find -exec`、管道、重定向到文件、heredoc）。
3. **文件系统层隔离**：把每个成员的工作区挂进 sandbox（Linux 的 mount namespace / bubblewrap，或 macOS 的 `sandbox-exec`）。最强，但形态与平台相关，成本显著高于前两者。
4. **收口到「没有 bash」**：档位层面把 bash 从 agent 的默认工具集里去掉。需要产品决策，不只是技术题。

**注意本票不改档位**：改 `PRESET_DEFAULT` 的构成会牵动 `lib/tool-presets.ts` 与 UI 的档位语义，属于那张票的授权范围。

### HITL / 审批流

本地单人多 agent 场景下，人在环不是当前优先级。权责划分取「**隔离优先、可观测性另议**」：本票不设计任何审批、确认、升级流程。若将来要做（例如越界时弹窗问 owner），它是叠加在「自动拒绝」之上的一层，不改变本票的默认拒绝语义。

### 其他明确不做

- **不引入 leader / 委派 / 指派**。仓库已有明文裁决反对：`docs/design-notes/discord-launch-post.md:90` 明说不是 "pick a leader agent" 意义上的编排器；`docs/spec.md:336` 明说「不做指派协商」；`CONTEXT.md` 把「跨频道指派」列为 _Avoid_。任务认领保持 `owner_id IS NULL` 的抢占语义，本票不引入 assignee 一类概念——路径隔离与任务归属是两件事，混在一起会让隔离决策被协作语义污染。
- **不区分读与写的权限**。读与写用同一份允许根，不做「可读不可写」的两级模型。本地单人多 agent 场景下这个区分没有对应的用户诉求。
- **不做 TOCTOU 加固**。见 D6。
- **不做频道附件的 agent 侧读取通路**。排除 `attachments/` 是本票的不变式，理由见 D5。要让 agent 主动取附件是另一件事（正确的形态应该是经 `/api/attachments/[id]` 的受控通道，而不是开目录）。
- **不改消息 / 频道 / 唤醒 / 任务语义**。本票只在文件工具这一层加约束。

---

## Further Notes

### 档位差异影响「本票拦住了什么、没拦住什么」的准确表述

`grep` / `find` / `ls` 只在 `PRESET_FULL` 档可用（`lib/tool-presets.ts:24` 的 `CODING_TOOL_NAMES` 含它们，`PRESET_DEFAULT` 是 `read` / `bash` / `edit` / `write` 的子集）。所以：

- **DEFAULT 档**：绕过面只有 bash（+ 提示注入诱导 agent 换路径，但路径守卫本身对所有文件工具一致生效）。
- **FULL 档**：若只挡 `read` / `write` / `edit`，`grep -r '.*' ~/.worksplice` 就是一条不需要任何技巧的绕过——`grep.js:83` 走 `ops.readFile`，读的是任意文件的内容。这正是本票把六个工具并列纳入的直接原因。

### 为什么排除附件目录不是功能倒退

见 D5：附件落盘是 `randomUUID()` 无扩展名文件名，真实名与消息的映射在 SQLite 里。agent 本来就无法通过路径定位到任何具体附件，排除目录真正防住的是 `ls` / `find` 的枚举。**不要**把「让 agent 能看附件」当作重新开口子的理由——正确形态是给受控的读取通道，不是开目录。

### 风险面小结

| | 状态 |
| --- | --- |
| `read`/`write`/`edit`/`grep`/`find`/`ls` 的路径越界 | 本票拦住 |
| `~/.worksplice/`（数据库、附件、其他成员家目录） | 本票拦住（显式不变式） |
| 符号链接越界 | 本票拦住（realpath + fail-closed） |
| 兄弟目录前缀混淆 | 本票拦住（`path.relative`） |
| bash 下的读取/写入 | **不拦**，后续票 |
| realpath 与 IO 之间的 TOCTOU | 不拦，见 D6 |
| 成员对自己家目录的读写 | 放行（设计意图） |
| 共享项目目录内的成员互读写 | 放行（ADR-0001 明确允许，非漏洞） |

### 与 ADR 的关系

**建 ADR-0011**（`docs/adr/0011-agent-file-tool-path-guard.md`），三条件全满足：

1. **难以逆转**：白名单口径一旦落地就是隔离的安全基线，日后改口径要重做威胁模型；守卫是全进程生效的运行时约束，不是可以悄悄调参的开关。
2. **无上下文会惊讶**：后来者会看到「worksplice 明明用 SQLite 存一切，却不让 agent 读自己的附件目录」「明明项目目录可以共享，却挡着兄弟目录」——这些都是刻意的，不写下来会被当 bug 顺手改掉。
3. **真实权衡的结果**：三条注入路线逐一权衡后选了 operations 接缝 + 既有扩展工厂；共享项目目录放行 / 数据目录排除也是真实取舍。

已覆盖、无需新立 ADR 的部分：家目录与共享项目目录的两分在 **ADR-0001**；`pi 管 pi / worksplice 管 worksplice` 的切分线与「同一事实不写两处」的纪律在 **ADR-0007**；分层与依赖方向在 **ADR-0008**。本 ADR 只新增「路径边界」这一层，不复述前三个。

### 术语

新增两个词进 `CONTEXT.md` 的 `## Language`：**允许根 (Allowed Roots)**、**路径守卫 (Path Guard)**。

### 实现时容易踩的两处

1. **别手写 ToolDefinition**（D3）。覆盖是整条替换，手写会静默丢掉 edit 的四条编辑准则与 diff 渲染。
2. **别在 `lib/rpc` 重算一遍根**（D4）。`isDerivedAgentHomePath` 是 ADR-0001 为「读取侧按当前 dataDir 重推」写的判据，重算一遍就会和「数据目录被搬迁后不回流原路径」的既有行为分叉。