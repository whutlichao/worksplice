# 用 AgentScope 重构 worksplice 的可行性评估

> 这是一份**评估**，不是重构本身，也不是重构方案。**本轮交付终点 = 这份文档；不动任何源码**
> （用户已定：动机是可行性评估，先不动代码）。
>
> **一手证据规则**（沿用 `docs/pi-sdk-upgrade-assessment.md` 开头的取证声明并加严）：外部事实
> **只认** registry 元数据（npm `npm view` / PyPI JSON API）、包内产物（`npm pack` / wheel 解包后的
> `package.json`、`src`、`dist`）、GitHub 一手 API/raw 响应。**博客、聚合站、搜索结果摘要、
> 二手 changelog 一律不采信**——本文件不引用任何一条。本仓事实一律给 `文件:行号`。
> 每条关键论断后附取证命令原文或产物路径；原始输出落
> `.scratch/agentscope-refactor-assessment/issues/evidence/`（`E01–E38` 与 `R01–R61` 两套语料，
> 后者是本报告作者的独立重跑，见 §8）。
>
> **起点假设是 coordinator 的粗测，不是可引用证据**：本文每条都自己重跑并给出自己的数字，
> 不一致处以本文为准并注明差异（见 §3.6 复核表）。

---

## 1. 结论（TL;DR）

**判断：条件成立（conditional），但证据不支持现在换底座。推荐先做 C 的有界 spike，不做 A/B 的全面重构。**

一句话理由：**AgentScope 与 worksplice 不是同一层的东西**。worksplice 的承重部分是「房间层」
（频道 + `UNIQUE(target_id, seq)` 消息序 + 每成员消费游标 + freshness-hold + 任务状态机与互审门
+ 未读角标 + 会话文件所有权），这一层在两份 AgentScope 发行物里**没有对应物**；
AgentScope 承重的是「agent 框架层」（agent 循环、工具、模型、工作区沙箱、多 agent pipeline）。
两者可以叠，但不能互换——现在的位置是 **worksplice 房间层 + pi 作 agent 框架层**，
换成 AgentScope 只替换了后一层，前一层一行都不会少。

具体到三条路：

1. **A（保留 TS/Next.js，只换底座为 AgentScope TS）不可行的判据是「成熟度倒挂」**：
   `@agentscope-ai/agentscope@0.0.15` 的 `src` 只有 **47 个文件 / 8106 行**、**15 个发布版本**
   （`0.0.1` 2026-03-13 → `0.0.15` 2026-07-24，**最近一次发布距今约 81 天**）、GitHub
   `agentscope-ai/agentscope-typescript` **88 stars**、仓库里只有**一个包 + 一个 Electron app**、
   registry 元数据里 `description` 为空且**无 `repository`/`license`/`engines`/`peerDependencies`**。
   而 worksplice 实现面是 **53774 行 / 248 文件**、测试 **37834 行 / 170 个 `*.test.mjs`**。
   更硬的一条：AgentScope TS 的 `permission` 子路径**只有类型词汇、没有引擎实现**，
   全 `src` 里 `sandbox|workspace|chroot|seccomp|bwrap` **零命中**——
   也就是说 ADR-0011 的路径守卫与 ADR-0012 的 shell 沙箱**在 TS 侧没有可落的缝**，
   而 pi 现在恰好给了这条缝（`resourceLoaderOptions.extensionFactories` + 工具的 `operations`）。
2. **B（后端迁 Python AgentScope 2.x、Next.js 只做 UI）的证据不支持**：迁移面是**整个服务端**
   （`lib` **22892** + `app` **5259** 行、**79** 个 `route.ts`），代价是双语言双运行时，
   外加 **ADR-0007（`pi 管 pi、worksplice 管 worksplice`）整条作废**；而且 Python 侧最像
   worksplice 房间语义的那部分（`channels`）是**外部平台机器人绑定**（Feishu/DingTalk/Discord），
   不是应用内协作频道，`consumed_seq`/`read_seq`/`freshness`/`base_seq`/`max_seq` **零命中**。
   另外**部署发行物 `agentscope-runtime@1.1.6.post2` 依赖的是 `agentscope>=1.0.14`（1.x 线）**，
   与 2.x 核心不是同一条线，且最后发布是 2026-06-04（距今约 4 个月）。
3. **C（不换底座，把既有 seam 收紧成 substrate 中立接口 + 有界 spike）是唯一有正收益的短期动作**：
   worksplice 的结构恰好友好——`lib/agent-loop/loop.ts` **完全不 import SDK**，
   协作域（3287 行）与数据层（2437 行）也不 import，pi 的接触面收敛在**两个 seam**
   （`AgentRuntime`、`LoopRuntime`）。C 买的是**信息**而不是能力，所以它的产出必须是一个
   能证伪 A 的实测数字，而不是一份接口文档。

**净结论**：用 AgentScope 重构 worksplice 在技术上不是不可能，但**当前证据下三条路里没有一条
现在就该做**；本轮交付终点就是这份评估。若将来推进，顺序是 **先 C 的 spike，再据 spike 结论决定 A 或 B**。

### English summary

> **Verdict: conditional feasibility — the swap is not impossible, but the evidence does not
> justify doing it now. Deliverable of this round is this assessment only; no code changes.**
>
> AgentScope and worksplice live on different layers. worksplice's load-bearing half is the
> *room layer* — channels, `UNIQUE(target_id, seq)` message ordering, per-member consumption
> cursors, freshness-hold, the task state machine with a non-owner review gate, unread badges,
> and session-file ownership. None of that has a correspondent in either AgentScope
> distribution. AgentScope's load-bearing half is the *agent framework layer* (agent loop,
> tools, models, OS-level workspaces, multi-agent pipelines). Today that layer is pi; swapping
> it to AgentScope replaces only that layer and removes none of the room layer.
>
> Path A (keep Next.js, swap substrate to AgentScope TS) fails on a **maturity inversion**:
> `@agentscope-ai/agentscope@0.0.15` ships 47 source files / 8106 lines, 15 releases
> (`0.0.1` on 2026-03-13 → `0.0.15` on 2026-07-24, last publish ≈81 days ago), 88 GitHub stars,
> one package plus one Electron app, and registry metadata with an empty `description` and no
> `repository`/`license`/`engines`. worksplice is 53774 implementation lines across 248 files
> with 37834 test lines across 170 `*.test.mjs`. Decisively, the TS `permission` subpath is a
> **type vocabulary with no engine** and `sandbox|workspace|chroot|seccomp|bwrap` has **zero
> hits** in `src` — so ADR-0011's path guard and ADR-0012's shell sandbox have **no seam** on
> the TS side, while pi currently supplies exactly that seam.
>
> Path B (port the backend to Python AgentScope 2.x) is not supported by the evidence: the port
> is the whole server (`lib` 22892 + `app` 5259 lines, 79 `route.ts` files), at the price of two
> languages and two runtimes, and it voids ADR-0007 wholesale. Python's `channels` are *external
> platform bot bindings* (Feishu/DingTalk/Discord), not in-app collaboration rooms;
> `consumed_seq|read_seq|freshness|base_seq|max_seq` returns zero hits. The deployment
> distribution `agentscope-runtime@1.1.6.post2` pins `agentscope>=1.0.14` (the 1.x line) and was
> last published 2026-06-04 — a different line from the 2.x core.
>
> Path C (keep the substrate; tighten the two existing seams into substrate-neutral interfaces
> and run a bounded spike) is the only short-term move with positive payoff. worksplice is
> already favourable here: `lib/agent-loop/loop.ts` does not import the SDK at all, and the
> collaboration domain (3287 lines) and data layer (2437 lines) do not either; the pi surface is
> two seams (`AgentRuntime`, `LoopRuntime`). C buys information, not capability — so it must
> produce a falsifiable measurement, not an interface document.

---

## 2. 两侧事实基线

### 2.1 worksplice 规模与堆栈（本仓一手，逐条命令见 §8）

| 项 | 值 | 命令 |
| --- | --- | --- |
| 实现行数（`.ts`/`.tsx`，非 `*.test.mjs`） | `app` 5259 / `lib` 22892 / `components` 21742 / `hooks` 3881 = **53774** | `R03a` |
| 实现文件数 | **248** | `R03a` |
| 测试 | **170** 个 `*.test.mjs` / **37834** 行 | `R03c` |
| 路由 | **79** 个 `app/api/**/route.ts`（18 个 `app/api` 文件引用 pi，其中 17 个是 `route.ts`） | `R04a`–`R04c` |
| 域规模 | `lib/rpc` 1806 / `lib/domain/collab` 3287 / `lib/data` 2437 / `lib/agent-loop` 3799 行 | §8 命令 |
| pi 版本 | 四包**精确 pin** `0.99.2` | `package.json:57-60` |
| 数据形状 | `SCHEMA_VERSION = 15`（`lib/data/schema.ts:3`），`UNIQUE (target_id, seq)`（`:49`），`consumed_seqs`（`:120`），`messages_fts` trigram（`:148`） | `R05c`、`R06` |
| 运行形态 | Next.js 单进程（`bin/worksplice.js`），better-sqlite3 + FTS5（`docs/spec.md` §5.2 架构图） | — |

**关键结构事实**：pi 的接触面**不**在协作域也不在 agent-loop。
`lib/agent-loop/loop.ts` 全文件 `grep -n "earendil"` 零命中（`docs/pi-sdk-upgrade-assessment.md` §3.3 亦已核实），
协作域与数据层同样不 import。接触面是 **39 个实现文件 / 6476 行**（`R01f`/`R01h`），
其中唯一的重镇是 `lib/rpc`（1806 行，`lib/rpc/session.ts` 一个文件 1233 行）。

### 2.2 pi 耦合面：三种读法，三个数字（**必须分清口径**）

票面给的「≈71 处 / 44 文件」只有在**明确后缀与排除集**之后才有意义。我的三种读数：

| 读法 | hits | files | 产物 |
| --- | --- | --- | --- |
| 票面命令原文 `grep -rn "@earendil-works" . --exclude-dir=node_modules --exclude-dir=.next` | 507 | 77 | `R01a`/`R01b` |
| 同上 + 全排除（加 `--exclude-dir=.git --exclude-dir=.codegraph --exclude-dir=.scratch`） | 209 | 58 | `R61` §H4 |
| 源码后缀（`--include=*.ts --include=*.tsx --include=*.mjs`）+ 全排除 | **67** | **47** | `R61` §H1 |
| impl 面（`app lib components hooks next.config.ts`，`*.ts/*.tsx`，去 `*.test.mjs`） | **58** | **39** | `R61` §H3、`R01f` |

> **产物后缀说明**：`issues/evidence/` 下所有**导出面**与**包元数据**产物一律用 `.txt`
> 后缀（如 `E24-agentscope-ts-export-surface.txt`、`R14-ts-package.meta.txt`），
> 以免在 `git status` / 仓库质检里看起来像源码或 `package.json`——本票零源码改动，
> **evidence 目录下不得出现 `.ts/.tsx/.mjs/package.json` 命名的文件**。

**票面数字的复盘**：`71` 恰好等于「源码后缀、只排 `node_modules`/`.next`」的 hits（`R01c`）——
即**把 `.scratch/` 下两个历史草稿文件也算进来**了（`.scratch/architecture-improvements/abandoned-rpc-split/lib-rpc/{registry,ui}.ts`，
各 2 处，共 4 处；71 − 4 = 67 = 我的全排除读数）。**44 文件在我这里复现不出来**：
ts-only 全排除是 41、ts/tsx 全排除是 47、impl 面是 39，都不等于 44。差异原因无法回溯，
**以本文的分层读数为准**。

> **⚠️ 自指污染（本票最重要的一条采集纪律）**：`R01a` 是**裸命令原文**，它会把
> `issues/evidence/` 里含该字符串的证据文件也算进 hits——上一轮 Dispatch 的磁盘事故
> （105GB，见 §9）根因正是这条：`grep -rn` 的输出重定向落进了它自己扫描的目录树。
> 本报告一律引用 `R61` 的全排除读数（67/47 与 58/39），并把 `R01a` 只当「裸命令可以有多脏」的对照。

### 2.3 适配器行数（7 个文件，三法自洽）

`wc -l` / `grep -c ''` / `awk END{NR}` 三法在我的环境里**完全一致**（产物 `R02`），且末尾均为 `0a`（换行结尾）：

| 文件 | 我的读数 | 票面 | 差 |
| --- | --- | --- | --- |
| `lib/rpc/session.ts` | **1233** | ≈1234 | −1 |
| `lib/session-reader.ts` | **438** | ≈439 | −1 |
| `lib/agent-runtime.ts` | **387** | ≈388 | −1 |
| `app/api/sessions/[id]/export/route.ts` | **282** | 282 | 0 |
| `lib/session-stats.ts` | **234** | ≈235 | −1 |
| `lib/rpc/caller.ts` | **235** | ≈236 | −1 |
| `lib/pi-types.ts` | **189** | 189 | 0 |

**差异原因**：7 个文件里 5 个恰好差 1，且都显示「票面 = 我的 + 1」。这不是内容差异——
`git show` 三个历史版本读数与我一致（§8 命令），说明这是**计数口径**造成的
（很可能是票面工具按「行数 = 换行符数 + 1」或计入了文件末尾的虚拟空行）。
**以 `wc -l` 为准**，行号引用直接用本文数字。

### 2.4 AgentScope TS `@agentscope-ai/agentscope@0.0.15`

| 项 | 值 | 产物 |
| --- | --- | --- |
| registry | `dist-tags.latest = 0.0.15`；共 **15 个版本**：`0.0.1` 2026-03-13 → `0.0.15` 2026-07-24 | `R12`、`R13` |
| 包元数据 | `description: ""`；**无** `repository`/`homepage`/`license`/`engines`/`peerDependencies` | `R14`、`R10` |
| `exports` 面 | **10 个子路径**：`./agent` `./message` `./model` `./tool` `./formatter` `./event` `./mcp` `./storage` `./state` `./permission` | `R14` |
| 依赖 | `zod` `openai` `ollama` `@modelcontextprotocol/sdk` `uuid` `jsonrepair` `gray-matter` `string-format` `mime-types` `zod-to-json-schema` `@cfworker/json-schema` | `R14` |
| `src` 规模 | **47 文件 / 8106 行**（`agent/agent.ts` 1087、`tool/toolkit.ts` 616、`message/message.ts` 605） | `R15`、`R16` |
| GitHub | `agentscope-ai/agentscope-typescript`，`created 2026-03-11`，`pushed 2026-09-16`，**88 stars / 21 forks**，Apache-2.0，`size 583` KB，`description: "Born for agent systems"` | `R51` |
| 仓库结构 | `packages/` 下**只有** `packages/agentscope`；`apps/` 下**只有** `apps/desktop`（Electron） | `R54` |

**能力盘点（全部来自包内 `src`，不是 README）**：

- **model**（4 个）：`OpenAIChatModel`、`OllamaChatModel`、`DashScopeChatModel`、`DeepSeekChatModel`
  + `ChatModelBase` + 5 个 formatter（`src/model/index.ts`、`src/formatter/index.ts`）。
  构造入参只有 `modelName/stream/maxRetries/fallbackModelName/formatter`（`src/model/base.ts:11-17`）
  与各实现的 `apiKey`/`baseURL`。**无 Anthropic/Gemini/Bedrock/Vertex**（依赖里也没有）。
- **permission**：`PermissionMode`（5 值）、`PermissionBehavior`（4 值）、`PermissionRule`、
  `PermissionContext`（含 `working_directories`）、`PermissionDecision`（含 `bypass_immune`）、
  `createPermissionContext()`——**全在 `src/permission/index.ts` 一个文件里，共 201 行，只有类型与工厂**。
  全 `src` 搜 `PermissionEngine|evaluatePermission|checkPermission`：**零实现命中**，
  唯一命中是 `permission/index.ts:8` 与 `:181` 的 **doc 注释**（`R21`）。
  `AgentOptions`（`src/agent/agent.ts:103-115`）**不接收 permission 入参**（`R60` §S8 零命中）。
- **tool**：`Bash` `Read` `Write` `Edit` `Glob` `Grep` + `TaskCreate/TaskUpdate/TaskGet/TaskList`
  （`src/tool/index.ts`）；每个定义带 `requireUserConfirm: boolean`（`src/tool/base.ts:22`）。
  `Bash` 走 `child_process.exec(command, { shell: process.env.SHELL || '/bin/bash' })`
  （`src/tool/bash.ts:96-113`）——**无 cwd 参数、无可注入后端、无沙箱**。
- **storage**：`StorageBase{loadAgentState, saveAgentState, offloadContext}` + `LocalFileStorage`
  写 `<saveDir>/<agentId>/state.json` 与 `context.jsonl`（`src/storage/file-system.ts`）。
  `AgentState = { context: Msg[]; metadata: Record<string, unknown> }`（`src/storage/base.ts:6-21`）。
- **state**：只有 `Task`/`TaskContext`（会话内待办：`pending|in_progress|completed`，`src/state/index.ts`）。
- **多 agent 编排**：**无**。`\b(hub|pipeline|team|swarm|orchestrat|sub_?agent|multi.?agent)\b`
  在 `src` 全量只有 **2 处 doc 注释**（`message/block.ts:38`、`event/index.ts:189` 的 "team messages"），
  `R54` 的 tree 里也没有对应目录（`R19`）。
- **分叉/导航**：**无**。`\b(fork|navigate|rewind|checkpoint)\b` 在 `src` **零命中**（`R60` §S3）。
- **压缩**：`CompressionConfig`（`enabled/triggerThreshold/tokenCountFunc/compressionModel/compressionPrompt/summarySchema/keepRecent`）
  + 内置 zod summary schema（`src/agent/agent.ts:52-100`）。
- **成本**：`ChatUsage = { type, inputTokens, outputTokens, time, metadata? }`（`src/model/usage.ts`）——
  **无金额字段**。
- **事件**：`EventType` 覆盖 `REPLY_START/END`、`MODEL_CALL_*`、`{TEXT,THINKING,DATA}_BLOCK_*`、
  `HINT_BLOCK`、`TOOL_*`、`EXCEED_MAX_ITERS`（`src/event/index.ts:4-34`）；
  但 `session_id` 在 `agent.ts:478` 与 `:558` 被**硬编码为空串**——事件层还没有会话身份概念。
- **MCP**：`./mcp` 子路径，http + stdio（`src/mcp/index.ts`）。

### 2.5 AgentScope Python `agentscope@2.0.10`

| 项 | 值 | 产物 |
| --- | --- | --- |
| PyPI | `2.0.10`，**2026-10-12T08:15:54Z** 发布（距今 1 天），`requires_python >=3.11`，`requires_dist` **118** 条 | `R30`、`R32` |
| 规模 | **641 个 `.py` / 122548 行** | `R34`、`R35` |
| 目录规模 | `app` **207**、`workspace` **39**、`tool` 30、`model` 28、`middleware` 26、`rag` 21、`realtime` 18、`credential` 14、`pipeline` 4、`permission` 6 | `R36` |
| GitHub | `agentscope-ai/agentscope`，**33152 stars / 3641 forks**，`created 2024-01-12`，`pushed 2026-10-13`（今天），Apache-2.0，topics 含 `multi-agent` | `R52` |
| model providers（**12**） | `Anthropic` `DashScope` `DeepSeek` `Gemini` `MiniMax` `Ollama` `OpenAIChat` `XAI` `Moonshot` `OpenAIResponse` `Volcengine` + `ChatModelBase` | `R37` |
| credential | **14 个文件**，按 provider 一类（`credential/_anthropic.py` 等）+ `_factory.py` | `R34` |
| workspace 后端（**8**） | `Local`、`Bubblewrap`、`Docker`、`E2B`、`Daytona`、`K8s`、`OpenSandbox`、`AppleContainer` | `R37` |
| pipeline | `PipelineProtocol`、`GoalPipeline`（execute→verify）、`TeamPipeline` + `TeamMember`（leader 经 `TeamAssign` 外部分派） | `R37` |
| permission | `PermissionEngine`（5 模式 `DEFAULT/EXPLORE/ACCEPT_EDITS/BYPASS/DONT_ASK`，`_engine.py` **848 行**，按 `_check_<mode>` 分派；规则匹配委托 `ToolBase.match_rule`）；`Agent._check_permission` + 中间件洋葱（`agent/_agent.py:2340`），状态上挂 `permission_context`（`state/_state.py:274`） | `R37`、§8 |

**`requires_dist` 的 extra 面**（正是「workspace/sandbox 后端清单」的答案）：
`workspace-docker`(aiodocker) `workspace-e2b` `workspace-daytona` `workspace-k8s`(kubernetes-asyncio)
`workspace-opensandbox`；`service`(fastapi/uvicorn/apscheduler/ag-ui-protocol/aiortc)；
`storage-redis`/`storage-sql`(sqlalchemy+alembic)/`storage-s3`；`channel`(lark-oapi/discord.py/dingtalk-stream)；
`tools`(ripgrep)；`realtime`、`tui`(textual)、`a2a`、`vdb-*`、`rag`（`R32`）。

**service 层（`app/`，207 文件）实际有什么**：

- `app/_service/_chat.py`（1600+ 行）：一次 run 的编排（`run`/`interrupt`/`_parked_dispatch`/`_project_event`）。
- `app/_manager/_wakeup_dispatcher.py`：**每进程一个** asyncio dispatcher，消费**持久化 trigger 队列**，
  两种 kind——`wake`（空闲会话唤醒，`input_msg=None`）与 `resume`（喂 HITL 结果）；
  队列项**永不丢弃**，会话被锁时退避重入。
- `app/_manager/_scheduler/`：apscheduler + `ScheduleCreate/Delete/List/View` 四个工具。
- `app/storage/_sql/_tables.py`：`credentials` `agents` `sessions` `sops` `sop_runs` `schedules`
  `teams` `knowledge_bases` `knowledge_documents` `mcps` `skills` `channels` **`messages`**（`R42`）。
- `app/message_bus/`：`MessageBus` 抽象（in-memory + Redis），按**消费语义**分三模式
  （drain queue / replay log / registry），`log_read` 由**读者各自维护游标**（`_base.py:1-40`）。
- `app/channel/`：**外部平台**适配器（Feishu/DingTalk/Discord）+ `ChannelBinding` 路由规则
  （`match_key/match_value/agent_id/session_scope`，`app/storage/_model/_channel.py:46-70`）。
- `app/_router/_session.py`：SSE 事件重放带 **checkpoint cursor**（`:821`）。

### 2.6 第三个发行物：`agentscope-runtime@1.1.6.post2`

| 项 | 值 | 产物 |
| --- | --- | --- |
| PyPI | `1.1.6.post2`，**2026-06-04** 发布（距今约 4 个月），`requires_python >=3.10` | `R31`、`R33` |
| summary | "A production-ready runtime framework for agent applications, providing secure sandboxed execution environments and scalable deployment solutions with multi-framework support." | `R33` |
| **关键依赖** | **`agentscope>=1.0.14`**（1.x 线，**不是 2.x**）；另有 `docker`/`kubernetes`/`celery[redis]`/`fastapi`/`a2a-sdk` | `R33` |
| GitHub | `agentscope-ai/agentscope-runtime`，876 stars，`pushed 2026-06-04` | `R53` |

**这条是本报告的一条硬约束**：`agentscope` 核心已到 **2.0.10**，而承担「安全沙箱执行 + 可伸缩部署」
的 runtime 发行物仍钉在 **`>=1.0.14`**，且两者发布节奏相差 4 个月。
**选型时不能把「核心 2.x 有 workspace 后端」与「runtime 能部署」当成同一件事**——它们不是同一条线。

---

## 3. 层错位与可替换 seam

### 3.1 两条不同的层

```text
worksplice 房间层（两套 AgentScope 都没有对应物）        ← 承重
  频道 / thread 锚点 / UNIQUE(target_id,seq) 消息序
  每成员消费游标 consumed_seqs（drain 不推进 / ack 收口）
  freshness-hold（baseSeq 事务内比对，held 返回 roomSeq）
  任务状态机 todo→in_progress→in_review→done/closed + 互审门 + reopen 封锁
  未读角标 channel_reads / 提醒 cron / FTS trigram 搜索
  会话文件所有权（ADR-0003/0004）
─────────────────────────────────────────────────────────
agent 框架层（pi 现在占位，AgentScope 想做这一层）
  一轮 agent 循环 / 工具表 / 模型目录与凭证 / 事件流
  工作区与 shell 沙箱 / 会话持久化与恢复 / 成本统计
  MCP / 技能与插件 / 压缩
```

换底座**只动下划线以下那半**。而 worksplice 的复杂度恰好集中在上面那半
（协作域 3287 + 数据层 2437 + agent-loop 3799 = **9523 行**，不含 UI），
下一半的总接触面是 **39 文件 / 6476 行**。

### 3.2 既有的两个 seam（换底座的唯一杠杆点）

| seam | 位置 | 界面（成员） | 谁消费 | 换底座要改什么 |
| --- | --- | --- | --- | --- |
| `AgentRuntime` | `lib/agent-runtime.ts:21-30` | `findSession(member)` / `findBusySessionForCwd(cwd)` / `startSession(member)` / `destroySession(member)` | `lib/agent-lifecycle.ts`、`lib/agent-status.ts`、agent-loop driver | **只有 4 个成员**——这是子座上唯一的窄接口 |
| `LoopRuntime` | `lib/agent-loop/loop.ts:106-118` | `findSession` / `startSession` / `findBusySessionForCwd` 的结构子集 | `runAgentRound`（`loop.ts:1241`）的 `runtime ?? (await getAgentRuntime())` | loop 只依赖结构子集，测试注入 fake |

**这两条缝的质量是本仓最有利的事实**：`LoopRuntime` 是 `AgentRuntime` 的**结构子集**，
而 `lib/agent-loop/loop.ts` 全文件**不 import SDK**（§2.1）。也就是说子座的第一层适配器
**已经存在**，缺的只是「缝以下」——`AgentRuntime` 的真实实现 `lib/agent-runtime.ts`
现在直接落 `lib/rpc`（`lib/rpc/session.ts` 1233 行 + `lib/rpc/caller.ts` 235 行），
而 `lib/rpc/caller.ts:119-131` 的 `createAgentSessionServices({ resourceLoaderOptions: { extensionFactories: [...] } })`
是 pi 特有的装配形态。

### 3.3 缝以下要自建什么（逐条对应「层错位」）

| pi 现在免费提供 | AgentScope TS 侧 | AgentScope Py 侧 | 结论 |
| --- | --- | --- | --- |
| `AgentSession`（start/prompt/events/settle/steer/followUp） | `Agent.replyStream/reply` + `EventType` 流（可委托） | `Agent.reply_stream/reply`（可委托） | **可委托** |
| `SessionManager`（会话清单/打开/树/分叉/导航） | 只有 `StorageBase`+`LocalFileStorage`（`state.json`+`context.jsonl`） | DB `sessions` 行 + per-session 存储 | **自建** |
| `resourceLoaderOptions.extensionFactories` + 工具 `operations` 覆盖缝（ADR-0011/0012 的落点） | **无**（工具直接 `fs`/`child_process`） | `ToolBase.match_rule` + `PermissionEngine`（形态不同） | **自建**（A 侧最贵的一条） |
| OS 级沙箱（`sandbox-exec` / 按端口 deny） | **无**（§S1 零命中） | `workspace` 8 后端，但 bubblewrap 只有 `--share-net` 布尔（无按端口过滤） | **自建/降级** |
| 模型目录 + `enabledModels` 语法 + thinking 档 | 4 provider，无目录概念 | 12 provider + 14 credential 类 | A 侧**自建**；B 侧**可委托** |
| OAuth/设备码 + 双认证 provider 列举 | **无** | credential 类含 OAuth 型（`app/channel/_credential_binding.py` 有 scan-QR/consent 流程） | A 侧**自建** |
| `DefaultResourceLoader` / `DefaultPackageManager`（技能/插件） | **无** | `app/hub/_skill`、`app/storage` `skills`/`mcps` 表 | A 侧**自建** |
| 成本统计（jsonl 口径） | `ChatUsage` 无金额 | `ChatUsage` 有 cache token，无金额 | **自建** |
| 会话导出 HTML | **无** | 无 | **自建** |
| MCP | `./mcp`（http+stdio） | `app/hub/_mcp` | **可委托** |
| 压缩 | `CompressionConfig` 内建 | `compress_context` | **可委托** |

---

## 4. 替换面清单表（pi 能力 → 现仓落点 → 换 AgentScope 后）

行号均为本文实测（§2.3）。「必须重建」= AgentScope 侧无对应物或对应物语义不等价。

| # | pi 能力 | 现仓落点（`文件:行号`） | 换 AgentScope TS | 换 AgentScope Py |
| --- | --- | --- | --- | --- |
| 1 | 会话启动与装配 | `lib/rpc/caller.ts:226`（`startRpcSession`）、`:119-131`（`createAgentSessionServices` + `extensionFactories`） | 可委托（改装配为 `new Agent(...)`） | 可委托（`app/_service/_chat.py`） |
| 2 | 会话包装与 RPC 命令面 | `lib/rpc/session.ts:268`（`AgentSessionWrapper`）；`:585` `setModel`、`:642` `setThinkingLevel`、`:778` `setActiveToolsByName`、`:620` `createBranchedSession`、`:636`/`:1210` `navigateTree` | 分叉/导航**重建**；其余可委托 | 分叉/导航**重建** |
| 3 | 会话清单与只读解析 | `lib/session-reader.ts:19`（`SessionManager.listAll`）、`:201`（`getEntries`）；`:386-433` 的 `switch`（`message`/`compaction`/`branch_summary`/`custom_message`/`context_edit`/`usage`） | **重建**（TS 无会话清单/条目类型） | **重建**（DB 行形态完全不同） |
| 4 | 成本/token 统计 | `lib/session-stats.ts:73`（`addUsage`）、`:87`（`addCostOnly`）、`:137-139` | **重建**（无金额字段） | **重建** |
| 5 | 会话导出 HTML | `app/api/sessions/[id]/export/route.ts:57`（`resolver(...)`）、`:134`（`matches !== 1` → throw）、`:236`（深路径） | **重建** | **重建** |
| 6 | 模型作用域（`enabledModels` 语法） | `lib/model-scope.ts:71`（`resolveModelScopeWithDiagnostics`）；`lib/model-listing.ts`(73)、`lib/model-discovery-auth.ts`(58)、`lib/provider-listing-runtime.ts`(37) | **重建** | 可部分委托（`model/_model_card.py`） |
| 7 | 凭证存储 / OAuth 设备码 | `lib/provider-credential-store.ts`(114)、`app/api/auth/login/[provider]/route.ts`(192)、`app/api/auth/{providers,all-providers,logout,api-key}` | **重建**（TS 只有 `apiKey` 入参） | 可部分委托（`credential/` 14 类） |
| 8 | 双认证 provider 列举 | `lib/provider-listing.ts:81`（`buildApiKeyProviderList`）、`:103`（`buildOAuthProviderList`） | **重建** | **重建**（语义不同） |
| 9 | `models.json` 读写 | `app/api/models-config/route.ts`(67)、`app/api/models-config/test/route.ts`(80) | **重建** | **重建** |
| 10 | 插件（包管理） | `app/api/plugins/route.ts`(364, `DefaultPackageManager`) | **重建** | 部分可委托（`mcps`/`skills` 表） |
| 11 | 技能（含 frontmatter 手术） | `app/api/skills/route.ts`(77)、`lib/skills-service.ts`(16)、`lib/skill-updates.ts`(263) | **重建** | 部分可委托（`app/hub/_skill`） |
| 12 | project-trust | `lib/project-trust.ts`(48)、`app/api/project-trust/route.ts`(66) | **重建** | **重建** |
| 13 | **路径守卫（6 文件工具）** | `lib/tool-path-guard.ts:62`（`allowedRootsFor`）、`:79`（`pathGuardScopeFor`）、`:96`（`isWithinAllowedRoots`）；`lib/tool-path-guard-extension.ts:146`（`guardFileOperations`）、`:200`（`registerGuardedTools`） | **重建**（**TS 无 `operations` 缝**，`R18` 零命中） | 形态不同：`ToolBase.match_rule` + `PermissionEngine`，要重写判定 |
| 14 | **bash 沙箱** | `lib/bash-containment.ts:195`（`gateBashSandbox`）、`:250`（`planBashSandbox`）；`lib/bash-containment-extension.ts:100`（`createContainedBash`） | **重建**（TS 无任何沙箱抽象） | 部分可委托：`BubblewrapWorkspace` 但**只支持 `--share-net` 布尔**，无按端口 deny（`R38`） |
| 15 | 工具表/预设 | `lib/tool-presets.ts:24`（`CODING_TOOL_NAMES` = `read/bash/edit/write/grep/find/ls`）、`:70`（`getToolNamesForPreset`） | 需**重映射**：TS 是 `Bash/Read/Write/Edit/Glob/Grep/Task*`（**无 `find`/`ls`**、大小写不同） | 需**重映射**：`Bash/Read/Write/Edit/Glob/Grep/PowerShell/AskUser/Task*` |
| 16 | MCP | 无自研（走 pi 扩展面） | 可委托（`./mcp`） | 可委托（`app/hub/_mcp`） |
| 17 | 事件订阅/广播（SSE 内层） | `lib/rpc/subscriber.ts`(61)、`lib/rpc/broadcaster.ts`(58) | 可委托（`EventType` 流） | 可委托（`_router/_session.py` SSE + cursor） |
| 18 | 会话文件所有权（ADR-0003/0004） | `lib/agent-runtime.ts:123-195`（归属裁决）；`lib/agent-loop/loop.ts` backfill 段 | **语义消失**：TS 无会话文件身份 | **语义转换**：Py 会话是 DB 行（`sessions` 表），变成「谁拥有这行」 |
| 19 | 消费游标 / inbox | `lib/domain/collab/inbox.ts:40`（`drain`）、`:69`（`ack`）、`:74`（`drainAndAck`）；schema `consumed_seqs`（`lib/data/schema.ts:120`） | **重建** | **重建**（Py bus 的 log cursor 在不同层） |
| 20 | freshness-hold | `lib/domain/collab/messages.ts:96`（`baseSeq` 事务内比对）、`:136`（`held`） | **重建** | **重建** |
| 21 | 任务板与状态机 | `lib/domain/collab/tasks.ts:251`（`createTask`）、`:291`（`claimTask`）、`:340`（`updateTaskStatus`）、`:419`（`listChannelTasks`） | **重建**（TS `Task*` 是会话内待办） | **重建**（Py `TaskUpdate` 只有 `pending/completed/in_progress/deleted`，`R40`/`R60` §S6 零命中 `in_review`/`unclaim`/`reopen`） |
| 22 | 提醒 | `lib/domain/collab/reminders.ts:111`（`scheduleReminder`）、`:339`（`fireDueReminders`） | **重建** | 可部分委托（`schedules` + `Schedule*` 工具） |
| 23 | FTS 搜索 | `lib/domain/collab/search.ts:60`（`searchMessages`）+ `lib/data/schema.ts:148`（trigram FTS5） | **重建** | **重建**（Py 有 RAG/vdb，形态不同） |
| 24 | 未读角标 | `lib/domain/collab/reads.ts:16`（`unreadCount`）、`:25`（`markChannelRead`） | **重建** | **重建** |
| 25 | 频道/thread 语义本体 | `lib/domain/collab/` 20 文件 / 3287 行 | **重建** | **重建**（Py `channels` = 外部机器人绑定） |

**读表方式**：只有标注「可委托」的 8 行（#1、#16、#17 及部分 #2/#6/#7/#10/#11/#14/#22）能省下工作；
其余 16 行在 A 与 B 两条路上**都要自建**。这正是「换底座 ≠ 省重写」的量化形态。

---

## 5. 必须回答的开问题（逐条结论）

### Q1 AgentScope TS 的 `permission` 能否表达 ADR-0011 路径守卫 / ADR-0012 OS 沙箱？

**结论：不能。TS 侧 `permission` 只有类型词汇，没有实现；也没有 workspace/sandbox 抽象。**

证据：`src/permission/index.ts` 共 201 行，导出 `PermissionMode`(5)、`PermissionBehavior`(4)、
`PermissionRule`、`AdditionalWorkingDirectory`、`PermissionContext`（`working_directories` 是
「`ACCEPT_EDITS` 模式下自动放行哪些路径」的语义，**不是「只允许这些路径」的 allow-only 守卫**）、
`PermissionDecision`（`bypass_immune`）、`createPermissionContext()`。
全 `src` 搜 `PermissionEngine|evaluatePermission|checkPermission` = **只有两处 doc 注释**（`R21`）。
`Agent` 构造参数（`src/agent/agent.ts:103-115`）不接受 permission（`R60` §S8）。
`\b(sandbox|workspace|chroot|seccomp|bwrap)\b` 在 `src` **零命中**（`R18`，即票面 `E26` 的 0 字节）。
工具侧唯一的介入点是 `requireUserConfirm?: boolean`（`src/tool/base.ts:22`），
且 `Bash` 直接 `child_process.exec` 用用户的 `$SHELL`（`src/tool/bash.ts:96-113`）——**无可注入后端**。

对照 worksplice：ADR-0011 的守卫**不是**「一遍检查」，而是把一个按成员身份算出的**允许根判定**
包在 pi 六个工具的 `operations` 外面（`lib/tool-path-guard-extension.ts:146`），
`find`/`grep` 还额外做**定义级搜索根前置判定**（ADR-0011 的 2026-10-06 更正）；
ADR-0012 的沙箱判据落在**进程**（`lib/bash-containment.ts:250` 生成 `sandbox-exec` allow-only profile，
并在 `:195` 做两个前提的合取 fail-closed）。
**这两条在 TS 侧没有可落的缝**——要重建，就等于在 AgentScope 的 `Bash`/`Read`/`Write`/`Edit`/`Glob`/`Grep`
每个工具外面再造一层 pi 式覆盖机制（而 pi 已经免费给了）。

### Q2 AgentScope TS 的 `model` 实际覆盖哪些 provider？凭证/OAuth 面多大？

**结论：4 个 provider（OpenAI / Ollama / DashScope / DeepSeek）+ 1 个 base；凭证面只有「构造时传 apiKey/baseURL」；OAuth 面为零。**

证据：`src/model/index.ts` 导出面（§2.4）；`src/formatter/index.ts` 5 个 formatter；
`dependencies` 里**没有** `@anthropic-ai/sdk`、`@google/genai`、`@aws-sdk/*`（`R14`）；
`R22` 搜 `oauth|login|auth|credential` 只命中各实现的 `apiKey` 注释与 `Authorization: Bearer ${this.apiKey}`。
无 credential store、无 `models.json`、无登录流程、无 provider 列举。

对照 worksplice：6 个 auth 路由 + `ModelRuntime`/`AuthStorage` + OAuth 设备码 SSE +
`lib/provider-credential-store.ts`(114) + 双认证 provider 列举（`lib/provider-listing.ts:81/103`）
+ `models.json` 原子写（`app/api/models-config/route.ts`）。
**这一整块在 A 路上从零建。**

### Q3 AgentScope TS 的 `state`/`storage` 到底持久化什么？有无会话记录/恢复/分叉导航/成本统计？

**结论：持久化「一个 agent 的消息上下文 + 自由 metadata」；没有会话记录类型、没有会话清单/树、
没有分叉导航、没有金额成本。**

证据：`AgentState = { context: Msg[]; metadata: Record<string, unknown> }`（`src/storage/base.ts:6-21`）；
`LocalFileStorage` 落 `<saveDir>/<agentId>/{state.json, context.jsonl}`，
`loadAgentState` 支持按 `_storage_compressionBoundaryMsgId` **增量续读**压缩边界之后的消息
（`src/storage/file-system.ts:52-104`）——这是**压缩恢复**，不是**会话恢复**；
`Agent.toJSON()` 只返回 `{reply_id, confirmedToolCallIds, curIter}`（`src/agent/agent.ts:901-911`）；
`\b(fork|navigate|rewind|checkpoint)\b` 零命中（`R60` §S3）；
`ChatUsage` 无金额（`src/model/usage.ts`）；事件里的 `session_id` 是硬编码 `''`（`agent.ts:478/558`）。

对照 worksplice：`lib/session-reader.ts`(438) 的会话清单/条目解析、
`app/api/sessions/[id]/export/route.ts`(282) 的导出、
`lib/session-stats.ts`(234) 的成本口径、Fork（`createBranchedSession`）/BranchNavigator（`navigateTree`）、
`docs/spec.md` §5.2 的「jsonl 读写权归 SDK、app 只读不解析」锁定条目。
**A 路上这些全部重建。**

### Q4 AgentScope TS 有无多 agent 编排（hub / pipeline / team）？

**结论：没有。**

证据：`R19` 在 `src` 只有 2 处 doc 注释命中（`message/block.ts:38`、`event/index.ts:189` 的 "team messages"）；
`R54` 的 tree 里 `packages/` 下只有 `packages/agentscope`，没有 hub/pipeline/team 目录；
`R23` 的导出符号清单里没有任何编排类型。
（`apps/desktop` 是 Electron 壳，不是编排层。）

对照：**Python 2.x 有** `pipeline/`（`GoalPipeline` / `TeamPipeline` + `TeamMember` + `TeamAssign`），
但那是「leader 经外部分派工具把活派给成员 agent」的形态，
**不等同于** worksplice 的「频道成员 + 任务板 + 互审门 + 每成员游标」形态（见 Q6）。

### Q5 AgentScope TS 工具表 vs `lib/tool-presets.ts` 差在哪？

**结论：名册不同、语义不同、权限介入点不同。**

- **名册**：TS `Bash Read Write Edit Glob Grep TaskCreate/TaskUpdate/TaskGet/TaskList`
  vs worksplice `CODING_TOOL_NAMES = read/bash/edit/write/grep/find/ls`（`lib/tool-presets.ts:24`）。
  TS **没有 `find`、没有 `ls`**（`Glob` 只能部分替代）；TS **多了 `Task*`**，
  但那是**会话内待办**（`state.TaskContext`，`pending|in_progress|completed`），
  **不是** worksplice 的频道任务板（`#number` 按频道递增、`claim`、`complete→in_review`、互审 `approve/reject`、`reopen` 封锁）。
- **命名**：TS 首字母大写（`Bash`），pi/worksplice 全小写（`bash`）——预设映射要重写。
- **权限介入点**：TS 只有 `requireUserConfirm: boolean` + 一个**未实现的**引擎；
  worksplice 是**按调用解析绝对路径**的 `operations` 包装（`lib/tool-path-guard-extension.ts:146`）
  + **定义级搜索根前置判定**（`find`/`grep`）。
- **执行语义**：TS `Bash` 无 cwd 参数、无后端注入、`maxBuffer 30000*1024`、超时上限 600000ms
  （`src/tool/bash.ts:95-113`）；worksplice 的 bash 是**自建 spawn**（ADR-0012：pi 的
  `createLocalBashOperations` 把可执行文件硬编码在 `resolveShellConfig` 里，没有接缝）。

### Q6 Python 2.x 的 workspace/sandbox 后端清单与 service 层能力，vs worksplice 房间语义？

**结论：后端清单很厚（8 个），service 层在「会话/消息/调度/团队」上有形态对应，
但 worksplice 房间语义真正承重的那几条（频道 seq、消费游标、freshness、任务互审门）**没有对应物**。**

**workspace/sandbox 后端清单**（`R37` + `R32` 的 extra）：
`LocalWorkspace`、`BubblewrapWorkspace`、`DockerWorkspace`、`E2BWorkspace`、`DaytonaWorkspace`、
`K8sWorkspace`、`OpenSandboxWorkspace`、`AppleContainerWorkspace`。

**⚠️ 与 ADR-0012 决策五第 ③ 环不兼容的一条**：bubblewrap 后端的网络只有**两档**——
`--unshare-all` + 可选 `--share-net`（`_bubblewrap_backend.py:415`、`:441-442`，`share_net: bool = True`）。
**没有按端口过滤的能力**，而 worksplice 要的正是「保留出网、只封 worksplice 自己的那一个端口」。
这一条在 Py 侧也只有两个选择：整体 `--share-net`（等于不封）或整体 `--unshare-net`（连 `npm install` 一起封死）。
ADR-0012 的「按端口 deny」**必须自建**，或接受语义降级。

**service 层能力 vs worksplice 房间语义**：

| 能力 | Py 2.x 有什么 | worksplice 要什么 | 重叠判定 |
| --- | --- | --- | --- |
| 会话 | `sessions` 表（`user_id/agent_id/source/...`）+ `SessionOrigin` 标签联合（`user/schedule/channel/team/sop`）；SSE 重放带 checkpoint cursor（`app/_router/_session.py:821`） | 会话 = pi session 文件（ADR-0003/0004 归属） | **形态像、语义不同** |
| 唤醒 | 每进程 `WakeupDispatcher` + 持久 trigger 队列（kind `wake`/`resume`），队列项永不丢弃、忙碌退避重入（`app/_manager/_wakeup_dispatcher.py`） | `wake.ts` 的 `WakeHint{agentId,targetId,seq,reason}` + driver FIFO 队列 + busy settle 重试 | **形态高度相似**（可借鉴） |
| 调度 | apscheduler + `ScheduleCreate/Delete/List/View` 工具 | reminder cron + recurrence DSL + 生命周期 log | **可部分委托** |
| 持久化 | SQL（credentials/agents/sessions/teams/mcps/skills/channels/messages…）+ Redis + S3；`messages` PK `(session_id, msg_id)` | SQLite + `UNIQUE(target_id, seq)` + 4 套游标 + trigram FTS5 | **形状冲突**：Py 消息是「per-session 事件」，无频道级 seq |
| channels | **外部平台机器人绑定**（`platform_bot_id` 全局唯一；`ChannelBinding{match_key,match_value,agent_id,session_scope}`） | 应用内协作频道（成员、`#all`、thread 锚点归一化、pin、reaction、未读） | **不同东西** |
| team | `TeamPipeline`（leader + `TeamMember` + `TeamAssign`）；`teams` 表 | 频道成员 + 任务板 + 互审门 | **不同东西** |
| 任务 | `TaskUpdate` 状态 `pending/completed/in_progress/deleted`（`tool/_task/_update_task.py:30-37`） | `todo→in_progress→in_review→done/closed` + 互审 + reopen 封锁 | **不同状态机** |
| 游标 | `MessageBus` 的 `log_read`（读者各自维护游标）+ 频道 stream checkpoint | `consumed_seqs(agent,target,seq)`：**drain 不推进、ack 收口** | **不同语义** |

**游标词汇的硬证据**：`grep -rniE "consumed_seq|read_seq|freshness|base_seq|max_seq" --include=*.py $PY2`
= **零命中**（`R60` §S2，即票面 `E34` 的 0 字节）。
**任务状态机词汇**：`\bin_review\b|\bunclaim\b|\breopen\b` 在 `$PY2` 只有 1 处无关命中
（realtime agent 注释里的 "reopen"）（`R60` §S6）。

### Q7 两侧对「会话文件所有权」（ADR-0003 / ADR-0004）有无对应物？

**结论：都没有。**

- **AgentScope TS**：持久化单位是 `<saveDir>/<agentId>/`（`state.json` + `context.jsonl`），
  **没有会话身份、没有文件级归属登记、没有会话清单**。
  ADR-0003 的问题（「谁拥有这个 session 文件」）在 TS 侧**根本不存在**——因为没有「文件」这个实体。
- **AgentScope Python**：会话是 DB 行（`sessions` 表），上下文由 `StorageBase` 实现按会话存取。
  属于**单写者 DB 行**模型，所以 ADR-0003 的问题被替换成「谁拥有这行」，
  而 ADR-0004 的 backfill 归属护栏（文件级门禁 + 轮级跨作者去重）**没有对应物**：
  Py 侧的 backfill 概念是 `_project_event` 投影与 `try_lock` claim（`app/message_bus/_base.py:374`），
  语义是「防重复消费」而不是「防作者错乱」。
- 因此 ADR-0003/0004 **在 A/B 两条路上都要重新立法**，A 路是「语义消失（无文件）」，
  B 路是「语义转换（文件→行）」。

---

## 6. 三条路径

三条路都按「改动面 / 必须重建项 / 显式收益 / 显式风险」写齐。估算一律标 `[INFERENCE]` 并给推算依据。

### 路径 A：保留 TS/Next.js，仅换底座为 AgentScope TS

**改动面**：`lib/rpc/*`（1806 行）、`lib/session-reader.ts`(438)、`lib/session-stats.ts`(234)、
`lib/session-title.ts`(253)、`lib/pi-types.ts`(189)、`next.config.ts:31-38`（`serverExternalPackages`）、
`lib/tool-path-guard-extension.ts`(245) + `lib/tool-path-guard.ts`、`lib/bash-containment*.ts`(388+)、
`lib/model-scope.ts`/`model-listing.ts`/`model-discovery-auth.ts`/`provider-credential-store.ts`/
`provider-listing-runtime.ts`/`model-probe.ts`/`model-catalog.ts`、
`app/api/{auth,models,models-config,skills,plugins,project-trust,sessions,agent}/**`
（17 个引用 pi 的 `route.ts`）——即 §4 表中全部 **39 个 impl 文件 / 6476 行**量级。

**必须重建项**：§4 表里标「重建」的 16 行，其中三条最贵：
① 路径守卫 + bash 沙箱（TS 无 `operations` 缝、无沙箱抽象——**要在 6 个工具外面自建 pi 式的覆盖机制**）；
② 会话持久化层（清单/条目/恢复/分叉导航/导出/成本）；
③ 模型与凭证面（4 provider、无 OAuth、无 models.json、无双认证列举）。
另加：`READ`/`GREP` 的搜索根前置判定（ADR-0011 更正里的那条）、`find`/`ls` 的工具缺口。

**显式收益**：
- AgentScope TS 的事件模型是**面向前端**设计的（`REPLY_START/END`、成对 block 流），
  比 pi 的事件名（`agent_settled` 延迟派发等）更贴近 worksplice 的 SSE 需求；
- `Toolkit` + `ToolMiddlewareBase` 提供 `check_permission` 中间件洋葱（`src/tool/toolkit.ts` 有 `ToolMiddlewareBase` 导入面）；
- 压缩（`CompressionConfig` + zod schema）内建；
- MCP http/stdio 内建；
- Apache-2.0，无 pi 的 `exports`/深路径脆性（`app/api/sessions/[id]/export/route.ts:236` 那类）。

**显式风险**（**成熟度倒挂**）：
- **0.0.15**：15 个版本、最后一次发布 2026-07-24（约 81 天）、**88 stars**、47 个源文件 / 8106 行、
  registry `description` 为空、无 `repository`/`license`/`engines`；
  仓库里只有一个包 + 一个 Electron app（`R14`/`R51`/`R54`）。
- worksplice 要用它顶替的，是 pi 当前为 **53774 行实现 + 37834 行测试**提供的全部框架层能力。
- **`permission` 是类型词汇而非引擎、无 workspace/sandbox**——即换过来之后
  **worksplice 自己的安全边界要从零重建**，而这不是「框架能力」，是**本仓的核心不变式**。
- 事件里的 `session_id` 是硬编码空串（`agent.ts:478/558`）——会话身份尚未成型，
  这一点会直接顶到 ADR-0003。
- **估算 `[INFERENCE]`**：A 的重建面 ≥ **8800 行实现**。
  推算依据：pi 接触面 6476 行（`R01h`，实测）+ §4 表里「pi 免费给、TS 零对应物」的 5 项
  在本仓的对应实现行数（`session-reader` 438 + `session-stats` 234 + `export` 282 +
  模型/凭证面约 600 + 技能/插件面约 500 ≈ 2054），且**未计**被替换掉的测试面
  （`lib/` 下 125 个 `*.test.mjs` 会大面积失效）。
  这不是「换个 import」。

### 路径 B：后端迁 Python AgentScope 2.x，Next.js 仅作 UI

**改动面**：**整个服务端**——`lib` 22892 行 + `app` 5259 行（其中 79 个 `route.ts`）→ FastAPI 服务；
`components` 21742 + `hooks` 3881 保留为 UI，但所有数据获取从 `/api/*` 改为指向 Python 服务。
pi 四包从 `package.json` 移除。

**必须重建项**：§4 表全部 25 行的「本仓落点」（因为整仓服务端都在动的这一侧），
其中协作域（3287）、数据层（2437）、agent-loop（3799）三块是**纯重写**——
Py 侧的 `channels`/`teams`/`Task*`/`MessageBus` 都不能直接承载 worksplice 的房间语义（Q6）。
另需重立法：ADR-0003/0004（会话所有权，Q7）、ADR-0007（`pi 管 pi`）、ADR-0011/0012（守卫与沙箱，
Q1/Q6：bubblewrap 无按端口过滤）。

**显式收益**：
- Py 2.x 是**成熟线**：`2.0.10` 昨天发布（2026-10-12）、仓库 33152 stars / 3641 forks、今天还在推（`R30`/`R52`）；
- workspace 后端 **8 个**含 OS 级（bubblewrap/docker/k8s）——比 TS 侧「零」强；
- `PermissionEngine` 是真引擎（5 模式 + 中间件洋葱 + `ToolBase.match_rule`）——比 TS 侧的「类型词汇」强；
- 12 provider + 14 credential 类；
- 多 agent（`GoalPipeline`/`TeamPipeline`）；
- service 层现成：FastAPI + SSE cursor + **wakeup dispatcher（形态与 worksplice 的 wake 高度相似）** + apscheduler + 外部 channel 适配器 + SQL/Redis/S3 storage + RAG/hub。

**显式风险**：
- **双语言双运行时**：Node（Next.js UI）+ Python 服务，部署/运维/CI/测试工具链全部翻倍；
- **ADR-0007 整条作废**（`pi 管 pi、worksplice 管 worksplice` 这条切分线随 pi 一起消失），
  连带 ADR-0006 的「门禁留在 worksplice 侧」也要重新表述；
- **测试悬空**：37834 行测试是 node 的 `*.test.mjs`，其中 `lib` 下 125 个直接测的是被替换的服务端，
  **无法对 Python 服务运行**；
- **runtime 发行物不同线**：`agentscope-runtime@1.1.6.post2` 钉 `agentscope>=1.0.14`（1.x），
  最后发布 2026-06-04（`R33`/`R53`）——「核心 2.x」与「可部署 runtime」不是同一件事；
- **`channels` 是外部平台机器人绑定，不是应用内频道**（Q6）——worksplice 的频道/thread/未读/pin/reaction 无对应物；
- **估算 `[INFERENCE]`**：B 的实现面 ≈ **28151 行**（`lib` 22892 + `app` 5259，实测），
  且**这些行的测试保证归零**（`lib` 下 125 个 `*.test.mjs` 不可移植）。
  推算依据：路径 B 的被替换单位是「服务端」，而服务端就是这两个目录的全部。

### 路径 C（推荐）：不换底座，把既有 seam 收紧成 substrate 中立接口 + 有界 spike

**改动面（本轮）**：**零**。本轮交付终点就是这份文档。

**改动面（下一轮若推进）**：
在既有的两条缝上把 pi 类型从接口签名里挤出去——
`AgentRuntime`（`lib/agent-runtime.ts:21-30`，4 个成员）与 `LoopRuntime`（`lib/agent-loop/loop.ts:106-118`，结构子集）；
使 `lib/agent-lifecycle.ts`、`lib/agent-status.ts`、agent-loop driver 只依赖这两个结构接口，
而 `lib/rpc/*` 退化为其中一种**实现**（另一个实现可以是 fake，也可以是未来某个 Agency 子座）。
`lib/agent-loop/loop.ts` 已经满足这条（全文件不 import SDK）。

**必须重建项**：本轮无。下一轮是**测量**，不是实现——产出一个 spike 报告。

**显式收益**：
- 这是唯一**已被本仓结构支持**的动作：子座接触面只有 **39 文件 / 6476 行**，
  而承重的一半（9523 行）根本不碰它；
- 两条缝已经存在且窄（§3.2），不需要新造抽象；
- 它会让「换 A 还是 B」从**立场问题**变成**数字问题**；
- 零风险：本轮不动代码。

**显式风险**：
- **C 买信息不买能力**：收紧 seam 本身**不降低耦合**，也不省下 A/B 的重写；
- **一个 spike 不能证明一次子座替换便宜**——能证的只是「某一件事不行/行」；
- **`[INFERENCE]`**：若无 spike，「换底座要不要做」会一直停在本文件这一层判断上；risk 不在做错，而在**一直不做决定**。

**建议的 spike 形态（有界、可证伪、一个变量）**：
以「AgentScope TS 能否承载 ADR-0011 + ADR-0012 的判据」为**唯一变量**，在一个隔离 worktree 里
（不碰 `main`）搭最小骨架：注册一个 AgentScope `Toolkit`，把 worksplice 现成的
`guardFileOperations`（`lib/tool-path-guard-extension.ts:146`）与 `createContainedBash`
（`lib/bash-containment-extension.ts:100`）的**判定层**接上去，跑三个必红用例：
① `read` 越界必须被拒且错误文本列出允许根；② `find "*" <dataDir>` 不得枚举出 `agents/…`/`worksplice.db`；
③ 沙箱内 `curl` 打得到本机其它 loopback 端口、打不到 worksplice 端口。
任一用例**无法用 AgentScope 的公开缝表达**即证伪路径 A 的安全边界前提。

---

## 7. 判据与建议

**判据（本报告用这三条定结论，逐条都可被上述证据反驳）**：

1. **层判据**：若两个候选在同一层，替换才有意义。AgentScope 在 agent 框架层，worksplice 的承重部分在房间层
   → 替换只覆盖下半，**不产生房间层收益**（§3.1、§4）。
2. **成熟度判据**：候选要顶替的，是它自己将被用来服务的那套系统的复杂度。
   TS 候选 `0.0.15` / 47 文件 / 8106 行 / 88 stars，被服务对象 53774 行实现 + 37834 行测试
   → **倒挂**（§2.4、§2.1）。
3. **安全边界判据**：候选是否提供本仓核心不变式的落点。ADR-0011/0012 是 worksplice 的安全边界，
   TS 侧 `permission` 无引擎、无 workspace/sandbox → **落点缺失**（Q1）。
   Py 侧有引擎，但 workspace 网络只支持整体开关，ADR-0012 决策五第 ③ 环仍要自建（Q6）。

**建议**：

1. **本轮就到此为止**——交付物是这份评估，**不动代码**（用户已定）。
2. **短期走 C**：把 `AgentRuntime` / `LoopRuntime` 两个缝的签名清理成 substrate 中立，
   并跑 §6 的三用例 spike。这条 spike 是**后续入口**：它的结论决定 A 还是 B 还是都不做。
3. **A 只在 spike 通过后考虑**，且必须把「重建会话持久化 + 模型凭证面 + 路径守卫/沙箱」三项
   写进同一张票的成本里——否则会得到「换了个 import」的错觉。
4. **B 在当前证据下不建议启动**：双运行时 + 整服务端重写 + ADR-0007 作废 +
   测试面归零 + runtime 与核心不同线，收益（成熟度、workspace 后端、真 permission 引擎）
   可以在 spike 阶段用**更小的代价**验证。
5. **不引入 `agentscope-runtime`**：它钉 1.x 线且 4 个月未动，与 2.x 核心不是同一条线。

---

## 8. 取证方式（命令原文）

### 8.1 两套语料

| 套 | 产出 | 说明 |
| --- | --- | --- |
| `E01–E38` + `collect.sh` | 票面既有语料（上一轮 Dispatch 留下） | 保留续用，未重跑；`E12a-*` 是事故文件（见 §9），已不在库 |
| `R01–R61` + `verify.sh` + `R60`/`R61` | **本报告作者的独立重跑** | 本文件的每个数字都出自这一套 |

### 8.2 本仓事实（命令原文）

```sh
REPO=$PWD
EX="--exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=.codegraph --exclude-dir=.scratch"

# pi 耦合面：源码后缀（推荐口径）
grep -rn "@earendil-works" . --include="*.ts" --include="*.tsx" --include="*.mjs" $EX | wc -l   # 67
grep -rl "@earendil-works" . --include="*.ts" --include="*.tsx" --include="*.mjs" $EX | wc -l   # 47

# pi 耦合面：impl（app lib components hooks next.config.ts，去测试）
grep -rn "@earendil-works" app lib components hooks next.config.ts --include="*.ts" --include="*.tsx" \
  $EX | grep -v "\.test\.mjs" | wc -l                                                            # 58
grep -rln "@earendil-works" app lib components hooks next.config.ts --include="*.ts" --include="*.tsx" \
  $EX | grep -v "\.test\.mjs" | wc -l                                                            # 39
cat "$(grep -rln ... )" | wc -l                                                                   # 6476（R01h）

# 规模
for d in app lib components hooks; do printf '%s ' "$d"; \
  find $d -type f \( -name "*.ts" -o -name "*.tsx" \) ! -name "*.test.mjs" -exec cat {} + | wc -l; done
find . -name "*.test.mjs" -not -path "*/node_modules/*" -not -path "*/.next/*" | wc -l            # 170
find . -name "*.test.mjs" -not -path "*/node_modules/*" -not -path "*/.next/*" -exec cat {} + | wc -l  # 37834

# 适配器行数（三法自洽）
wc -l lib/rpc/session.ts lib/session-reader.ts lib/agent-runtime.ts \
  "app/api/sessions/[id]/export/route.ts" lib/session-stats.ts lib/rpc/caller.ts lib/pi-types.ts

# 路由与域
find app/api -name route.ts | wc -l                                                               # 79
grep -rl "@earendil-works" app/api | wc -l                                                        # 18（17 个 route.ts）
for d in lib/domain/collab lib/data lib/agent-loop; do \
  printf '%s impl=%s test=%s\n' $d \
  "$(find $d -maxdepth 1 -name '*.ts' ! -name '*.test.ts' | wc -l)" \
  "$(find $d -maxdepth 1 -name '*.test.mjs' | wc -l)"; done
```

### 8.3 AgentScope TS（registry + 包内 `src`，`npm pack` 解包在 `/tmp`）

```sh
npm view @agentscope-ai/agentscope --json            > /tmp/as-verify/R10-*.json
npm view @agentscope-ai/agentscope time --json       > /tmp/as-verify/R12-*.json
npm view @agentscope-ai/agentscope dist-tags --json  > /tmp/as-verify/R13-*.json
cd /tmp/as-verify && npm pack @agentscope-ai/agentscope@0.0.15     # 落 /tmp，不进仓
tar xzf agentscope-ai-agentscope-0.0.15.tgz -C /tmp/as-verify/ts-0.0.15
TS=/tmp/as-verify/ts-0.0.15/package
find $TS/src -name "*.ts" ! -name "*.test.ts" -exec wc -l {} + | tail -1        # 8106
cat $TS/src/{agent,model,tool,storage,permission,state,formatter,mcp,message}/index.ts
grep -rniE "sandbox|workspace|chroot|seccomp|bwrap" $TS/src --include=*.ts      # 0 命中
grep -rniE "\b(hub|pipeline|team|swarm|orchestrat|sub_?agent|multi.?agent)\b" $TS/src --include=*.ts
grep -rniE "\b(fork|navigate|rewind|checkpoint)\b" $TS/src --include=*.ts       # 0 命中
grep -rn "PermissionEngine\|checkPermissions" $TS/src --include=*.ts            # 只有 doc 注释
grep -n "permission" $TS/src/agent/agent.ts $TS/src/agent/interfaces.ts         # 0 命中
grep -n "apiKey\|baseURL" $TS/src/model/*.ts
```

### 8.4 AgentScope Python（PyPI JSON API + wheel 解包在 `/tmp`）

```sh
curl -s https://pypi.org/pypi/agentscope/json          > /tmp/as-verify/R30-*.json
curl -s https://pypi.org/pypi/agentscope-runtime/json  > /tmp/as-verify/R31-*.json
python3 -c "import zipfile;zipfile.ZipFile('agentscope-2.0.10-py3-none-any.whl').extractall('/tmp/as-verify/py-2.0.10')"
PY2=/tmp/as-verify/py-2.0.10/agentscope
find $PY2 -name "*.py" -exec cat {} + | wc -l                                   # 122548
cat $PY2/{workspace,permission,pipeline,model,state,tool}/__init__.py
grep -rniE "consumed_seq|read_seq|freshness|base_seq|max_seq" --include=*.py $PY2   # 0 命中
grep -rniE "\bin_review\b|\bunclaim\b|\breopen\b" --include=*.py $PY2            # 1 处无关
grep -rn "share_net\|unshare\|--share-net" $PY2/workspace/_bubblewrap/_bubblewrap_backend.py
grep -rn "__tablename__" $PY2/app/storage/_sql/_tables.py
grep -n "PermissionEngine\|_check_permission" $PY2/agent/_agent.py
```

### 8.5 GitHub 一手（API / raw）

```sh
curl -s https://api.github.com/orgs/agentscope-ai/repos?per_page=100                 > R50-*.json
curl -s https://api.github.com/repos/agentscope-ai/agentscope-typescript             > R51-*.json
curl -s https://api.github.com/repos/agentscope-ai/agentscope                        > R52-*.json
curl -s https://api.github.com/repos/agentscope-ai/agentscope-runtime                > R53-*.json
curl -s "https://api.github.com/repos/agentscope-ai/agentscope-typescript/git/trees/main?recursive=1" > R54-*.json
curl -s https://raw.githubusercontent.com/agentscope-ai/agentscope-typescript/main/README.md         > R55-*.md
curl -s https://raw.githubusercontent.com/agentscope-ai/agentscope-typescript/main/packages/agentscope/package.json > R56-*.meta.txt
curl -s "https://registry.npmjs.org/-/v1/search?text=%40agentscope-ai&size=50"        > R57-*.json
```

（全部命令的可执行原文：`.scratch/agentscope-refactor-assessment/issues/evidence/verify.sh`；
零命中与全排除对照：`R60-zero-hit-and-full-exclusion.txt`、`R61-hardened-pi-ref-counts.txt`。）

### 8.6 采集纪律（本票验收项，来自 coordinator follow-up）

1. 证据**先写 `/tmp/as-verify`，再从 `/tmp` 拷进 `issues/evidence/`**——
   禁止把重定向目标放进被扫描的目录树内（上一轮 105GB 事故的根因）。
2. 递归 `grep` 必须带 `--exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git
   --exclude-dir=.codegraph --exclude-dir=.scratch`，并优先 `--include` 收窄。
3. 单文件 >5MB 立即停止、删除并报告（本次最大产物 `R01a` = **148KB**，全部远低于阈值；
   其余 JSON 产物最大 116KB）。
4. `npm pack` / wheel 解包区在 `/tmp`；仓库根遗留的 `agentscope-ai-agentscope-0.0.15.tgz`（临时产物）
   **已删除**，不入仓（按 coordinator 硬规则「不要提交，收尾前删除」）——取证由 `verify.sh` 里的
   `npm pack @agentscope-ai/agentscope@0.0.15` 可随时复现。
5. 为避免重复提交同一份大 JSON：`R50` 与既有的 `E06`（GitHub 组织 repo 列表）**内容完全一致**
   （解析后逐 repo `full_name`+`pushed_at` 相同，23 个 repo），故已删除 `R50` 的副本，
   把来源记在 `R50-gh-org-repos.provenance.txt`；报告里的 org 读数改用该文件核实。

---

## 9. 局限与未验证项

以下内容本报告**没有**从一手来源确认，读者不应据此行动。

| 条目 | 为什么没核实 / 现状 |
| --- | --- |
| **未装包、未实跑任何 AgentScope** | 全程只用 registry 元数据 + 包内 `src`。TS 的 `permission` 无引擎是**源码事实**，但「AgentScope TS 能否通过非公开手段接上守卫」未验证——那正是 §6 路径 C 的 spike 要回答的问题 |
| **AgentScope TS 的运行时行为** | 0.0.15 的 `dist`（2.0MB，76 文件）未逐文件比对；结论全部来自 `src` |
| **`R01a`（票面命令原文）已受自指污染** | 507 hits / 77 files 是**在 `issues/evidence/` 已入库之后**重跑的读数，会把证据文件自身算进去。§2.2 已给全排除读数（209/58、67/47、58/39）替代。**报告不用 507/77 作判据** |
| **票面的「44 文件」复现不出** | 我得到的所有口径是 39 / 41 / 47 / 49，没有 44。差异原因无法回溯（可能是上一轮的临时树状态）。以本文分层读数为准 |
| **票面适配器行数系统性 +1** | 7 个文件里 5 个都比 `wc -l` 大 1，且 `git show` 三个历史版本读数一致——判定为**计数口径**差异，非内容差异。以 `wc -l` 为准（§2.3） |
| **`R18`（TS sandbox/workspace，票面 `E26`）与 `R39`（Py 游标词汇，票面 `E34`）为 0 字节** | **零命中即是结论**，不是采集失败：TS 侧确实没有 sandbox/workspace 抽象（Q1），Py 侧确实没有 worksplice 的游标词汇（Q6）。`R60` 用带退出码的写法复核了这两个零命中，把「空文件」变成「有退出码记录的证据」 |
| **AgentScope Python 的运行时行为** | wheel 解包只读源码；`PermissionEngine`（`permission/_engine.py` 848 行）与 `WorkspaceBase` 的实际行为未跑。`bubblewrap` 结论（只有 `--share-net` 布尔）来自源码 argv 构造（`_bubblewrap_backend.py:415/441`），未实跑 |
| **GitHub 组织 repo 列表读数** | 本报告作者独立重跑的 `R50` 与既有 `E06` **逐字一致**（23 个 repo，`full_name`+`pushed_at` 全同），故只保留 `E06` 并把来源记入 `R50-gh-org-repos.provenance.txt`。因此 §2.5 的 org 读数以 `E06` 为准 |
| **`agentscope-runtime` 与 2.x 核心的兼容性** | 只核实了它 `requires_dist` 钉 `agentscope>=1.0.14`（`R33`）。**没有**验证它能否与 2.0.10 共存或它自己的 workspace 实现与核心的 `workspace` 模块是什么关系 |
| **AgentScope TS 与 Python 的互操作** | 未核实。TS 的 `permission` 类型注释里提到「Python side」的 `None` 序列化，暗示有人工对齐，但**没有任何互操作机制**被核实 |
| **人日估算** | 本报告**故意只给行数 `[INFERENCE]`，不给「人日」**——行数有实测依据，人日没有；给出来就是编造 |
| **性能/并发/资源** | 未评估。worksplice 的 `globalThis` 热重载守卫、`BusyCwdError` 串行、`withCwdStartLock` 都是 pi/Next 形态特有的，换底座后的并发模型**未验证** |
| **`docs/spec.md` 锁定条目与两条 ADR 的冲突面** | 本报告只指出 ADR-0007 在 B 路作废、ADR-0003/0004 在 A/B 都要重立法（Q7）。**没有**逐条核对 `docs/spec.md` 的锁定条目（那是重构票的范围，不是评估票的范围） |

### 9.1 上轮磁盘事故（复核记录）

coordinator follow-up 记录：上一轮 Dispatch 在采集 `E12a-grep-pi-ref-all-hits.txt` 时，
把 `grep -rn` 的输出重定向**写进了它自己扫描的目录树**，文件涨到 105GB，
grep 自读自写永不 EOF，磁盘打满，该 Dispatch（`ctx_ab67df4b2ded`）失败（`terminal_missing`）。

本报告复核确认：该文件**已不在库**（`find .scratch -name 'E12a*'` 零命中）；
worktree 现约 **40MB**；本报告全部采集走「`/tmp` 落地 → 拷贝入库」，
且最大单文件 148KB（§8.6 第 3 条）。**上一轮的 105GB 事故在本轮不可复现。**

---

**本轮交付终点**：这份评估文档 + 票据 `01-agentscope-refactor-feasibility.md`（`Status: resolved`）。
**未动任何源码**（不碰 `.ts/.tsx/.mjs`、`package.json`、`README*`、`docs/spec.md`、ADR）。
后续入口（若将来推进）：先 §6 路径 C 的三用例有界 spike，再据结论决定 A/B。
