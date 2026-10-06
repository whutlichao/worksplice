# agent 文件工具的路径边界：允许根取家目录 + 显式绑定的项目目录，worksplice 数据目录显式排除

**背景**：worksplice 的每个 agent 就是一个 pi 会话，拿的是 pi 原生的文件工具。worksplice 的身份隔离只到消息与游标这一层——频道、任务、唤醒、backfill 归属都有门禁，但 `read` / `write` / `edit` / `grep` / `find` / `ls` 的落点是**本机文件系统上的任意绝对路径**，与调用者属于哪个成员无关。成因在注入点：worksplice 不自造工具，它按名字从 pi 内置注册表里挑（`lib/rpc/session.ts:707` 的 `setActiveToolsByName(withExtensionTools(...))`，名单唯一来源 `lib/tool-presets.ts:24`），挑中即默认实现，pi 内置文件工具的 `operations` 是裸的本地 fs，没有任何一层按成员身份收口。

**决策一（允许根）**：守卫的允许根是一个**具体的目录列表**——`[ 成员自己的家目录, 该成员显式绑定的项目目录（若有） ]`。根的构成复用 ADR-0001 已有的判定：家目录取 `lib/data/dirs.ts` 的 `agentHomeDir`，并沿用 ADR-0001「家目录派生绑定不落库绝对路径、读取侧按当前 dataDir 重推」的规则（`isDerivedAgentHomePath`）——**不新造第二套目录解析**。根在会话创建时算一次并随会话持有，不做每次调用回查：换工作区本身就会销毁旧 cwd 的会话，不存在旧目录权限挂在活会话上的窗口。

**决策二（显式排除，写成不变式）**：**永不**纳入允许根的是——`~/.worksplice/` 作为**根本身**、`~/.worksplice/worksplice.db`、`~/.worksplice/attachments/`、其他成员的家目录。逐条列明而非「默认不包含」，因为其中两条经不起「顺手放开」的诱惑：

- **`worksplice.db` 永不可达**是本决策最显眼的一条：它一可读，注入即可读走全部私有频道正文 + 成员表（含 provider / modelId / home_path）+ 任务表 + reminder 表 + round_logs。数据库与被保护对象住在同一棵目录树下，这条不变式一破，整层隔离即失效。
- **排除 `attachments/` 几乎不亏**：附件落盘用 `randomUUID()` 作文件名、无扩展名（`lib/domain/collab/attachments.ts:42`），真实文件名与消息的映射存在 SQLite（`lib/data/schema.ts:96-104`）。agent 本来就无法通过路径定位到任何具体附件——排除目录真正防住的是 `ls` / `find` 对它的枚举。写清这一点，是为了让「让 agent 能看附件」不会成为重新开口子的理由；正确的形态是给受控的读取通道，不是开目录。

**措辞上必须区分的两件事**：排除的是「`~/.worksplice/` 这个根本身可整棵可达」，**不是**「这个根下不许有任何路径」。成员自己的家目录 `<dataDir>/agents/<slug>-<id8>` 恰恰就在被排除的父目录下，它作为一条更窄的、单独的白名单条目被显式开口。若把排除写成「`~/.worksplice/` 整个」，未绑定项目目录的成员白名单为空、任何文件工具调用都被拒——那等于把功能关掉，而不是加一层隔离。这两种写法只差一个词，含义相反，故在此写死。

**决策三（共享项目目录不是漏洞）**：ADR-0001 明确允许多个成员绑定同一项目目录（为的是协作代码库），多个 agent 在其中互读互写是既有设计的有意结果。本决策收的只有「非白名单一律不可达」这一条，**不顺手收共享目录**。写清这一点，是为了避免后来者把既有设计当成漏网。

**决策四（注入点）**：守卫落在 pi 六个文件工具的 `operations` 接缝上（`read`/`write`/`edit`/`grep`/`find`/`ls` 各自在触碰 `ops.*` 之前已把参数解析为绝对路径），由一个 worksplice 自己的 pi 扩展工厂经既有的 `resourceLoaderOptions.extensionFactories` 接缝注册（`lib/rpc/caller.ts:103`，`forcedEmptySystemPromptExtension` 已是该接缝住户），在加载期对六个工具各注册一个**同名**定义覆盖内置实现；`lib/rpc/session.ts` 主流程零改动。覆盖用的定义**必须由 pi 自己造**（`createReadToolDefinition(cwd, { operations })` 一类，全部从包根公开导出），不得手写——同名覆盖是整条定义替换，手写会静默丢掉 `read`/`edit`/`write` 的 system prompt snippet 与 guideline、以及 `edit` 的 diff 渲染。

**为什么不是另外两条路**：`baseToolsOverride` 虽写在 `AgentSessionConfig` 上，但 worksplice 走的 `createAgentSessionFromServices` 未暴露它，要用就得退回更低层的 `createAgentSession` 自行组装 `agent`/`settingsManager`/`modelRuntime`，那是 ADR-0007 判给 pi 的地盘；`tool_call` 钩子虽可 `{ block: true }`，但它拿到的是模型给的**原始字符串**路径而非绝对路径（pi 的 `resolveToCwd` / `resolveReadPathAsync` 不在包的公开导出面上，自写一份必然与上游的 macOS 文件名变体回退漂移），且 `grep` 的 `ops.readFile` 发生在遍历途中、钩子只能看到搜索根看不到实际读了哪些文件——守卫要判的不只是参数，还有副作用。

**决策五（越界处置）**：越界 = 工具报错，且错误文本**列出该成员当前允许的根**。只报错会让模型反复换路径重试、烧轮次，而 `MUST_RESPOND_FAILURE_CAP = 2`（ADR-0005）在连续失败后 cap-ack 推进游标——一次注入就能作废一个正常成员的这一轮；给出清单等于让模型一次就自我纠正。**不清静改写**（重定向到工作区内的同名相对路径，会让模型以为自己读到了目标文件，是比拒绝更坏的失效形态），**不静默截断**（同样让模型拿到「看起来能用」的错误内容）。

**Consequences**：

- 本决策是**纵深防御的一层，不是隔离的完成态**。`bash` 不在本决策内，且 bash 无约束意味着它构成剩余绕过面——`PRESET_DEFAULT`（`read`/`bash`/`edit`/`write`）档下它是唯一绕过面，`PRESET_FULL` 档下还需注意 `grep`/`find`/`ls` 的同构读取能力，故六个文件工具并列纳入而非只挡三个。收口 bash 是另一张票的授权范围（受限 shell / 路径重写 / 文件系统 sandbox / 收掉 bash 四种形态之一），本决策不改任何工具档位的构成。
- ADR-0001 的「家目录唯一且私有」此前只约束**删除语义**（删身份时 rm 家目录、绑共享目录时绝不 rm）；本决策把它延伸为**读取语义**上的约束。两处措辞互补，不冲突。
- 工具名单的唯一事实来源仍是 `lib/tool-presets.ts:24` 的 `CODING_TOOL_NAMES`（ADR-0007 决策 5：同一事实不写两处）。守卫的工具集合从它派生或作为入参接收，不得另抄一份。
- 已知残留：`operations` 判定到实际 IO 之间存在 TOCTOU 窗口，本决策不处理——威胁模型是「提示注入 + 模型自发越界」，不是能在毫秒级窗口里抢 symlink 的对手；要处理需 openat / `O_NOFOLLOW` 一类机制。
- 本决策不设计任何人在环审批流。本地单人多 agent 场景下权责划分取「隔离优先、可观测性另议」；若将来加审批，它是叠加在自动拒绝之上的一层，不改变默认拒绝语义。
- 术语「允许根」「路径守卫」入 `CONTEXT.md`；设计全文见 `docs/agent-file-tool-path-guard.md`。

**Status**: accepted