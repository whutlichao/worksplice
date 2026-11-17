# Key Design Decisions & Traps

> 从根目录 `AGENTS.md` 搬出的完整设计决策与陷阱记录，保留原文事实、issue/ADR/PR/票号、路径与命令。`AGENTS.md` 的「改动前必读」用本文的 `id` 锚点定位。

<a id="ui-icons"></a>

## UI 图标规则（lucide 优先）

- 除反应数据（`QUICK_REACTIONS` / `REACTION_GRID` / 已存 reaction 的渲染——持久化用户内容）外，UI 一律使用 lucide icon，**禁止新增 emoji**；同一字符可能同时是数据与装饰（如 📌 既是反应选项也是 pin 头部按钮），替换按出现处编辑，禁止全局 replaceAll。

<a id="agent-session-lifecycle"></a>

## AgentSession lifecycle (`lib/rpc/`)

- One `AgentSessionWrapper` per session id, keyed in `globalThis.__workspliceSessions`
- `globalThis` survives Next.js hot-reload; plain module-level Map does not
- Idle timeout: 10 minutes. Concurrent `startRpcSession()` calls share a single start Promise (`globalThis.__piStartLocks`)

<a id="fork-wrapper"></a>

## Fork must destroy the wrapper immediately

`AgentSession.fork()` **mutates the wrapper's inner state in-place** — after fork, `inner.sessionId` is the *new* session's id. If the wrapper stays alive in the registry under the old id, the next request gets the already-forked state and subsequent forks produce a corrupt `parentSession` chain.

**Fix**: `send("fork")` captures `newSessionId`, then calls `this.destroy()` before returning. The next request for the original session reloads a clean AgentSession from the original file.

<a id="branching"></a>

## Two kinds of branching — don't confuse them

- **Fork** (Fork button on user message): creates a new independent `.jsonl` file. Shown as a child in the sidebar tree via `parentSession` header field.
- **In-session branch** (Continue button / BranchNavigator): calls `navigate_tree` within the same file. Multiple entries share the same `parentId`. Switching between them calls `/api/sessions/[id]/context?leafId=`.

<a id="session-file-rewrite"></a>

## Session files can be fully rewritten

`parentSession` in the header is **display metadata only** — has zero effect on chat content. Safe to `writeFileSync` the entire file (pi does this itself during migrations). Used when cascade-reparenting children on delete.

<a id="toolcall-normalization"></a>

## ToolCall field normalization

Pi stores toolCall blocks as `{type:"toolCall", id, name, arguments}` but `ToolCallContent` uses `{toolCallId, toolName, input}`. `normalizeToolCalls()` in `lib/normalize.ts` handles this — called in both `session-reader.ts` (file load) and `ChatWindow.handleAgentEvent()` (streaming).

<a id="tool-preset"></a>

## New session tool preset

Tool names are passed at session creation (`POST /api/agent/new` → `toolNames[]`). For existing sessions, the active preset is inferred on mount via `get_tools` → `getPresetFromTools()`, and a preset change re-reads `get_tools` to filter the requested names against what the session actually has (`getToolNamesForPreset(preset, availableTools)` in `lib/tool-presets.ts`; a failed probe falls back to the verbatim preset). When tools are fully disabled (`toolNames = []`), `lib/rpc/caller.ts` passes an empty tool allow-list and forces `agent.state.systemPrompt = ""` after startup/reload/resource discovery.

<a id="model-defaults"></a>

## Model defaults for new sessions

`GET /api/models` returns `defaultModel` read from `~/.pi/agent/settings.json`. `ChatWindow` pre-selects this on mount for new sessions. Explicit browser model/thinking selections are applied atomically during AgentSession construction, then `lib/startup-preferences.ts` persists their effective values without replaying `set_model`/`set_thinking_level`; implicit `enabledModels` fallbacks and thinking pins are not persisted.

<a id="enabled-models"></a>

## `enabledModels` scoping

The `enabledModels` setting uses pi's `--models` syntax: minimatch globs against `provider/modelId` or a bare `modelId`, fuzzy matching for non-glob patterns, and an optional `:thinkingLevel` suffix. Never compare those patterns as literal strings — `lib/model-scope.ts` delegates to the SDK's `resolveModelScopeWithDiagnostics()` so worksplice and the TUI agree on the visible model list, and falls back to all available models when patterns resolve to nothing. `startRpcSession()` resolves that scope before creating an AgentSession and passes the selected initial model, thinking pin, and SDK-native `scopedModels` atomically; `GET /api/models` reuses the helper only for selector data, `thinkingLevelPins`, and `modelScopeWarnings` display.

<a id="sse-reconnect"></a>

## SSE reconnect on page refresh mid-stream

On `ChatWindow` mount, `GET /api/agent/[id]` is called. If `state.isStreaming === true`, SSE is reconnected automatically. `thinkingLevel` and `isCompacting` are also synced from this response.

<a id="compaction-sse"></a>

## Compaction SSE events

Newer pi emits `compaction_start` / `compaction_end`; older versions emitted `auto_compaction_start` / `auto_compaction_end`. `handleAgentEvent` accepts both sets to keep `isCompacting` in sync. Manual compact is a blocking POST — the button stays disabled until the response returns.

<a id="running-state"></a>

## Running state polling + reconciliation

- The sidebar polls `/api/agent/running` every 2.5 seconds while the tab is visible and pauses polling in background tabs. The session-list response remains the initial fallback.
- `useAgentSession` treats per-session SSE as primary for chat events and opens it before each prompt. `prompt_done` completes the current UI stage and notification immediately, but the idle SSE stays open for a 30-second grace window and is reused by the next prompt. `agent_start` cancels that close timer; `agent_settled` finishes extension-injected runs that have no wrapper-level `prompt_done` and starts a fresh grace window. Do not close on the first `agent_end`: retries, compaction, and extension-queued messages can continue the same logical prompt.
- While a run is active, `useAgentSession` periodically calls `GET /api/agent/[id]` and also reconciles on `visibilitychange`/`online`. This fixes missed terminal events from background tabs or half-open connections.
- Prompt runs use a monotonic run id; late SSE or slow reconciliation responses from an old run must be ignored so they cannot resurrect stale streaming bubbles.

<a id="worktrees"></a>

## Worktrees and project grouping

- `lib/worktree.ts` resolves linked worktree top-levels back to the main repo `projectRoot`; `listAllSessions()` attaches that to each `SessionInfo` so all worktrees for one repo are grouped together in the sidebar.
- Worktree operations are served by `/api/worktrees` and guarded by the same allowed-root rules as `/api/files`.
- New worktrees are created under `<repoRoot>-worktrees/<sanitized-branch>`. Existing branches are reused; otherwise `git worktree add -b` creates the branch.
- Removing a dirty worktree returns `409` with `{ dirty: true }` so the UI can ask before retrying with `force`.
- Sessions whose cwd points at a removed worktree are inferred back into the main project instead of becoming a phantom project row.

<a id="file-access"></a>

## File access allow-list

- `/api/files` is intentionally not a general filesystem browser. Allowed roots come from session cwds, their resolved project roots, `~/pi-cwd-*`, and roots explicitly added with `allowFileRoot()`.
- `/api/cwd/validate`, `/api/default-cwd`, and `/api/worktrees` call `allowFileRoot()` when they make a new location browsable.

<a id="plugins-skills"></a>

## Plugins and skills

- `/api/plugins` uses pi's `SettingsManager` + `DefaultPackageManager` for global/project package install, remove, update, enable, and disable. Disabling writes empty `extensions/skills/prompts/themes` arrays for that package entry.
- `/api/skills` uses `DefaultResourceLoader` so settings paths, package skills, and project `.agents/skills` are listed the same way the runtime sees them.
- Skill toggling edits only the `disable-model-invocation` frontmatter key on the target `SKILL.md`; keep that surgical so user formatting survives.
- `/api/skills/install` shells through `npx skills add ... --agent pi`; project installs run with the selected cwd.

<a id="auth-model-config"></a>

## Auth and model config

- `ModelsConfig` combines models from `~/.pi/agent/models.json` with provider auth status from pi's `AuthStorage`/`ModelRegistry`.
- Provider listing is capability-driven, never id-driven: `lib/provider-listing.ts` decides membership from `auth.apiKey.login` / `auth.oauth` plus the stored credential type, so dual-auth providers (anthropic and github-copilot today — which providers declare both changes between SDK releases, so never assume it from an id) appear exactly once and never fall through both lists (#309). `lib/provider-listing-runtime.ts` adapts `ModelRuntime` to those pure helpers.
- auth.json holds **one** credential per provider and `ModelRuntime.logout()` deletes whichever it is. The delete routes therefore use `removeStoredCredentialIfType()` to compare and delete under the same file lock used by pi's auth storage. `ModelsConfig` also refreshes *both* provider lists after any auth change — refreshing one leaves a dual-auth provider rendered twice.
- OAuth/device-code/manual-code flows are streamed by `GET /api/auth/login/[provider]`; manual code responses POST back with a short-lived token stored in `globalThis.__piLoginCallbacks`.
- API-key routes store and remove keys through `AuthStorage`. Status endpoints must never return the raw key.
- The model test route is `app/api/models-config/test/route.ts`; `app/api/models/test/` is not a real route.

<a id="pi-env"></a>

## pi 配置根两档故障（issue #226，P1 未初始化 / P2 无可用凭证）

- **判定层 `lib/pi-env-status.ts` 零依赖**（不 import React / Next / SDK）：观测经注入的四个探测接口进来，
  `judgePiEnv` 是对一份观测的纯函数，`readPiEnvStatus` 只做「按优先级现算一次」的编排。测试用临时目录 +
  假读数覆盖每个分支，不碰真实 `~/.pi/agent`。
- **P1 路径一次都不碰模型面**：`ModelRuntime.create` 会补建 `auth.json` / `models-store.json` 两个空壳，
  P1 若靠探模型面判，「检测」就变成了「修改」——空目录用例里「跑完目录仍为空」那条断言守的就是这条。
- **P1(d) 与票面口径的偏离（已裁决，理由见 `lib/pi-env-status.ts` 头注释）**：字面判据「settings 读出为空」
  在初始化骨架之后读数字节相同、永不解除（初始化按钮点了状态不变），还会把「凭证齐全（含环境变量）但
  从未写过 settings.json」的**能用**环境误报成未初始化。收窄为「settings 读出为空 ∧ `settings.json`
  从未被写过」——**文件存在性判据只此一个**，绝不枚举 `auth.json` / `models.json`（那正是决策 1 要挡的
  误报面）。残量误报用文案逃生口兜（「已用环境变量配 key 可忽略」），且用户一旦在界面选过模型，
  `lib/startup-preferences.ts` 会写 `defaultProvider` / `defaultModel`，`settings.json` 随之产生、误报自愈。
- **初始化动作 `lib/pi-env-skeleton.ts`**：`flag: "wx"` 独占创建 ⇒ 已存在文件逐字节不动；幂等（第二次
  `created` 为空）；只碰目标目录；**不** `npm i -g`、不下载、不改 PATH、不动 `package.json` 的 `bin`。
- **目标目录固定 `getAgentDir()`**（尊重 `PI_CODING_AGENT_DIR`）：`POST /api/pi-env/init` 的 body 里指定
  目录一律 400 —— 否则一个网页请求就获得了「在任意路径下建目录写文件」的能力。
- 结论**不缓存、不落库**：环境会在外部被改变（装 CLI、改环境变量），每次请求现算。

<a id="completion-sound"></a>

## Completion sound

- `hooks/useAudio.ts` stores the toggle in `localStorage` as `pi-sound-enabled` and reuses one `AudioContext`.
- Browser autoplay policy means sound must be unlocked from a user gesture; `ChatInput` calls the unlock hook from interactive controls, and `ChatWindow` plays the tone from `onAgentEnd`.

<a id="exported-session-html"></a>

## Exported session HTML

- `/api/sessions/[id]/export` delegates to pi's export helper and returns the generated HTML as-is. The patch that rewrote the template's recursive tree helpers (`sortChildren` / `mapNodes` / `markActive`) into explicit stacks is gone: `pi-coding-agent@1.5.2` already ships those traversals as explicit stacks, so very deep linear sessions no longer overflow the browser call stack and we no longer maintain a copy of an upstream implementation. `app/api/sessions/[id]/export/route.test.mjs` guards the route end to end (status / content type / disposition / payload).

<a id="instrumentation-edge"></a>

## 启动钩子的 edge 双编译：instrumentation 顶层不得静态引 Node 内置模块

Next.js **无条件**把 `instrumentation.ts` 与 middleware 文件编进同一个 edge layer
（`next/dist/build/entries.js:511`，`(isMiddlewareFilename(name) || isInstrumentation) ?
WEBPACK_LAYERS.middleware : …`）——**没有配置项能关掉**，两份编译都会发生。

后果：`instrumentation.ts` **顶层**静态 import 的任何 Node 内置模块（`node:net` / `node:os` /
`node:timers/promises` / `node:crypto`）与 `process.exit`，都会在 edge 那一遍编译里报
`A Node.js module is loaded … not supported in the Edge Runtime`，dev 终端每个请求周期刷一遍。

**功能无碍**：`register()` 第一行的 `if (process.env.NEXT_RUNTIME !== "nodejs") return;`
已经把 edge 那份挡掉了，node 侧照跑。噪音措辞（`Ecmascript file had an error`）却像真错误。

纪律：
- `instrumentation.ts` 只在 `register()` 内、`NEXT_RUNTIME` 守卫**之后**动态 `await import()` 依赖，
  且被引入的模块自身不要再静态拖 Node 内置模块进来（issue #101 的修法：`access-gate` 的启动段
  经动态 import 引入；判定层 `lib/access-gate.ts` 本体不动）。
- 这条契约有常驻回归测试兜底：`lib/access-gate-startup.test.mjs` 用 readFile 断言源码
  （§2.1「路由源码级断言」那一档：不起 dev server，毫秒级）。**改 `instrumentation.ts` 前先跑它。**
- `proxy.ts` 不受此限：Next 16 下 proxy 跑 Node runtime。

<a id="bash-sandbox"></a>

## 成员 bash 的沙箱（ticket 05，ADR-0012）

- **形态**：判据落到**进程**，不落到命令文本。允许面由与路径守卫**同一份**允许根判定派生
  （`planBashSandbox(scope)` 吃 `pathGuardScopeFor` 的产物，不新造目录解析）。profile 是
  **allow-only**：清单 = 成员允许根 + 系统只读面 + 进程自己的 `TMPDIR` + 只读工具链缓存；
  数据目录是**显式不变式**（allow 之后 deny，再把成员自己家目录这条更窄的条目 reopen）。
- **覆盖范围 = 会话归属的成员**：`pathGuard` 在场 ⇒ `caller.ts` 装配沙箱 —— 工具面（同名 `bash`
  覆盖定义）与 RPC 面（`session.ts` 的 `{type:"bash"}` 下面的 `executeBash`）共用同一份 operations；
  无人归属的会话（人类自己的会话）不沙箱。人类在成员会话里敲 `!bash` 也进沙箱（会话属性）。
- **env 收口**（ADR-0013 决策三）与沙箱落在**同一个 operations 包装**上（RPC 面没有 spawnHook，
  唯一杠杆是 operations）：包装**总是显式构造 env**（`options.env ?? process.env` 再按命名空间剥
  `WORKSPLICE_*`），不写成「上游给了就转交」。pi 故意暴露的五个 `PI_*` 保留。
- **越界处置**：机制换成内核的 `Operation not permitted` / exit 134，包装把它们归因成带允许根的
  可读文本注进输出流；允许根另写进**注册期的工具描述**（边界先于撞墙）。不静默改写、不静默截断。
- **平台 fail-closed**：macOS `sandbox-exec`（实测）；Linux `bwrap`（生成有实现、**本机未验证**）；
  Windows 无对应物 → bash 拒绝执行且描述说明原因。
- **成员连不上 worksplice 自己的端口**（ticket 07，ADR-0013 决策五第 ③ 环）：profile 保留
  `(allow network*)`（**不能封死出网**：成员要能 `npm install`、拉依赖、访问外部服务），追加一条
  `(deny network* (remote ip "*:<port>"))` —— 只封这一个端口，同机其它 loopback 不动。**端口推导不硬编码**：
  源是 `process.env.PORT`，由 Next 在 `listening` 事件里写成**真实绑定**的端口（dev 端口被占自动改端口
  也写进去），所以 `-p` / `PORT=` / 四条 npm 脚本全都跟着实例走。
  **⚠️ 两个后来者必知的坑**：① **推导不出端口 ⇒ 不激活成员 bash**（决策五同款 fail-closed），
  绝不退化成「不封端口的沙箱」——不封等于 `POST /api/agent/[id]` 的 `{"type":"bash"}` 对成员敞开；
  `blockedPorts` 为空时 profile 写 `(deny network*)` 整体封死而不是放开。
  ② **Linux 上成员 bash 一律不激活**：bwrap 只有 `--share-net` / `--unshare-net` 两档、封不了单个端口，
  而 `--unshare-net` 会连出网一起封死；「矩阵说可用」≠「有效结论可用」，判据是 `gateBashSandbox`
  的两个前提（拿得到沙箱 ∧ 能按端口过滤 ∧ 推导得出端口）。
- **⚠️ 实测代价（比 ADR 预估更强）**：`gh` 整条命令在沙箱里不可用（它启动就要读 `hosts.yml`，
  那是 token 落点，凭证不进清单）；`git push` 同理。成员要自带凭证是后续票（ADR-0012 决策二的正解）。
- **自建 spawn 的理由**：pi 的 `createLocalBashOperations` 把「可执行文件 + 前缀参数」硬编码在
  `resolveShellConfig` 里，没有接缝可注入沙箱；`BashOperations` 是 pi 文档化的可替换执行后端。
  镜像了 pi 的 `killProcessTree` 与 `waitForChildProcess`（含 pi#5303 的 stdio 空闲宽限），
  逐条注明出处。

<a id="collab-domain"></a>

## Collaboration message domain (`lib/domain/collab/`)

- **服务层 = 唯一事实来源**：`lib/domain/collab/channels.ts` / `messages.ts` 直接操作数据层（`getDb(): Store`——Ticket 03 数据契约，运行时 `SQLiteAdapter`），API route 仅薄封装；join/leave/archive/mute 的权限规则、freshness-hold、thread 不可嵌套都在服务层强制，route 层不重复实现。
- **Target 归一化**（§6.1）：消息 `target_id` 单列——命中 `channels` 即 channel，否则是 thread 锚点消息 id；`resolveTarget` 拒绝 thread 消息作为新 target（不可嵌套）。thread 读接口（`getThreadInfo`）会把 thread 内消息归一化回锚点。
- **Freshness-hold**（§6.3）：`sendMessage` 带 `baseSeq`（客户端最新 `maxSeq`），事务内比对 `maxSeq(targetId)`，不等返回 `{ held, roomSeq, whatHappened }`，route 层 409；UI 收 held 后重新拉取并提示，agent 的四选一流程属 ticket 06。
- **权限面**：写消息要求作者是 channel 成员（thread 回复继承 channel 规则）；私有 channel 加入/移除成员、归档都仅 Owner（`CURRENT_MEMBER_ID` = `"owner"`，人类恒为 Owner）；`#all` 不可离开；新 agent 创建时自动加入 `#all`（seed 也会在迁移时补齐既有成员）。
- **引用 = 物化**：消息不可编辑，quote 以块引用文本（`> **#seq author**\n> preview`）拼进发送内容，不留结构化引用。
- **UI 单一引用态**：`ChannelView` 的 `quoting` 是组件级单一状态，channel composer 独享（ticket 13 线程迁出右栏后引用态变面板局部——`ThreadPanel` 自持 quoting，channel 与 thread 引用互不污染）；`handleSend` 按 target 决定 baseSeq 来源（channel → `maxSeq`，thread → 该线程最后一条 seq）。
- **agent 回复轮询**：`ChannelView` 3s 一次轮询最新页增量合并（`mergeIncomingMessages` 按 id 去重 + seq 排序），后台 tab 暂停——agent-loop 的回复自然落入消息流（§5.4 demo）。右栏线程面板（`ThreadPanel`）另有同纪律 3s 轮询（`THREAD_POLL_MS`），任务线程回复自动冒出，与中央轮询并存为两套循环。
- **未读角标（BAI-6）**：`channel_reads(member_id, channel_id, read_seq)` 是 Owner 每频道已读游标（schema v11，仅 UI 呈现层状态，不参与 agent 唤醒/drain）；未读数 = 频道内「作者非本人且 seq &gt; read_seq」的消息数（自己的消息不算未读）。`markChannelRead` 推进到当前 max(seq)，打开频道即调用（`/api/channels/[id]/read`）；侧栏 15s 轮询刷新角标，选中频道本地立即清零。服务层 `lib/domain/collab/reads.ts`，`listChannelsWithMeta` 附 `unread` 字段。
- **房间轮次预算挂在消息漏斗上**（PR #218）：`sendMessage` 是房间预算的**唯一写入面**——提交成功后调 `recordRoomTurn`：Owner 消息 → `beginTurn`（开新房次 + 第一波选人），agent 消息 → `noteReply`（计发言 + 水位线 + 引用边），`roomNotice: true` 或 `wake: false` 的系统消息整个跳过。两个入参的语义：`roomContext: { channelId, epoch? }` 是「本轮在哪个房间回合里发言」的语境——解析出的频道不等于 `channelId` 时抛 `RoomPrivateChannelForbidden`（I6 房间内无隐身通道），`epoch` 让被取代场次的回复照常落库但按 `stale` 记账；`roomNotice: true` 声明「这是系统 / 事件消息，不是人类真的敲出来的」，不得开新房次、不得重置 `lateTurns`。不变量、陷阱与接入点见 Key Design Decisions 的「房间轮次预算」段。

<a id="chief"></a>

## 首席（Chief，#248–#252、#266–#270：一个身份、两个职责）

- **身份 = 角色，不是名字**：频道首席（`channels.chief_member_id`）→ 全局首席（`members.global_chief`，同一时刻至多一位）→ 无，三档回落；解析口 `resolveEffectiveChief`（`lib/domain/collab/chief.ts`）不缓存、每次现算，绑定失效（离场 / 软删 / 非 agent）按「未设置」处理且**不改写**绑定；`isEffectiveChiefForChannel` 只比较这个唯一结论，调用点不重走回落链。名字不参与任何判定——引导期默认名只有 `lib/secretary-name.ts` 一份字面来源。
- **可达是另一件事（投递判定）**：`canRouteToChief(channelId, memberId)`（本频道未软删 agent 成员 + 未静音）是唯一结论，`selectChiefRecipient`（谁接这条消息）、wake 的定向唤醒、`listChannelsWithMeta` 的 `chiefAvailable` 三处共用；composer 提示只读 `chiefAvailable`（`false` ⇒ 说「没有默认收件人」），客户端不重新推导——否则提示会承诺一次不会发生的投递（可达反例：私有频道不自动加全局首席、频道首席被静音）。
- **收件人只多一条分支**：既有四条路径（个人点名 / `@all` / 任务线程裁决 / 任务创建事件 handoff）全都不成立时，才把生效首席加入候选**一次**；静音优先于首席（静音 ⇒ 不可达，不回落、不换人）。任务事件与明确任务关联不走收件人分支，而是由**当前全局首席**走 handoff（#295）；频道首席保留一般默认收件人身份。「涉及任务」复用 `task-reference.ts` 的 `hasTaskReference`（单一来源，不再单独解析创建事件正文）。
- **工具面按 surface 非对称；建任务按生效首席、任务 handoff 按全局首席**：`global`（全局首席）= `read` + 六个领域工具的窄面、不并回扩展工具；`channel`（频道首席）= 保留自己的普通工具面（内置 + 扩展，**不收窄**）+ `worksplice_task_create` 一个最小写面。三个读面 / 建频道 / 建 agent 仍只注册在 global surface，频道首席**不**获得。`isSecretaryMember` 判定当前全局首席（任务 handoff 与状态权）；`isEffectiveChiefForChannel` 只回答身份问题，不判静音；可达性仍由 `canRouteToChief` 单独回答。
- **默认收件人只路由 / 建完即派（票 chief-recipient-router / #272、#295）**：两段固定骨架行都**只是 prompt**（`loop.ts` 的 `DEFAULT_RECIPIENT_RULE` / `CREATE_THEN_HANDOFF_RULE`）——`handoff` 不受轮次准入约束（准入只决定「这一轮要不要起来」）。注入条件各一条、互不蕴含：A 只在 `role === "chief"` 的轮次（无点名、无任务关联的人类消息 ⇒ 只分流、短答仍走 `action: "reply"` 而非 `ignore`）；B 只对**当前全局首席**注入（频道首席不再获得任务 handoff 提示）。
- **一个身份、两个职责（#268 / #270 / #272、#295）**：身份仍只有一条回落链（上一段），**不因职责分工产生第二个身份、也不新增判定入口**。两个职责各自可判定、可记账，对应 `round_logs.role`（`AdmissionRole`，`lib/data/types.ts`）：**收件人** = `chief`（`admission.ts` 的 `chiefInvited` 分支：无点名、无 `@all`、不涉及任务时接住这条消息，走房间门）；**路由者** = `secretary-handoff`（`isSecretaryMember` ∧ `secretaryHandoff`：当前全局首席把未认领任务下沉 handoff，无房间门）。频道首席保留默认收件人，但任务 handoff 不再按「频道首席 → 全局回落」两级分配，而是只看当前全局首席；全局首席不可达时不换人兜底。路由者的「把需求变成任务」仍按消息所属频道的生效首席授权（`worksplice_task_create`）；「发现卡住的事」由巡检承担且仍按现有全局首席接入面运行。术语与取舍见 `GLOSSARY.md`「首席 (Chief)」、ADR-0019、ADR-0020 与 ADR-0021。
- **消息指认（#266，ADR-0018 决策一）**：她读到的每条消息都带**完整消息 id**。形状只有一处字面来源：`injection-budget.ts` 的 `messageIdTag` → `(messageId <完整 uuid>)`；两个渲染入口同形——轮次注入行由 `projectMessages` 行尾追加（`#seq @author: 正文 (messageId <id>)`，渲染点唯一 ⇒ decide / revise 两个 prompt 自动一致），搜索命中行由 `member-ops.ts` 的 `formatSearchObservation` 用**同一个函数**加句柄（频道命中与线程命中同形）。`InjectableMessage.id` 必填。于是 `worksplice_task_create` 的**参数形状一字未动**（仍只收 `messageId`），也不需要 seq→id 映射。行首 `#seq` 保留（react / pin 的句柄，只在自己 target 内唯一），两者并存。**预算没放宽**：行尾 id 是固定开销，三个上界（`ROUND_INJECTION_BUDGET_CHARS` / `INJECTION_MESSAGE_WINDOW` / `MESSAGE_CONTENT_CAP`）一个没调；截断只吃正文，行首句柄与行尾 id 先占住。归档命中是 session 归档条目、没有频道消息 id —— 保留 archive / entry 定位，**不硬造 messageId**。
- **领域工具面（票 chief-tools / #272）**：`global` surface = `read` + 六个 `worksplice_*` 工具；`channel` surface = 只 `worksplice_task_create`（`defaultActive:true`，随频道首席不收窄的普通工具面激活）。清单只有 `member-tool-policy.ts` 的两份常量（`CHIEF_DOMAIN_TOOL_NAMES` / `CHANNEL_CHIEF_TOOL_NAMES`；注册面与激活面共用，`lib/chief-tools/tools.ts` 注册时 `assertPolicyCoverage` 按当前 surface 防漂移——名字对不上会静默变成「注册了但永不激活」）。工具面**只在首席会话注册**（`RpcSessionStartOptions.domainTools` 不在场 ⇒ 工厂不进 `extensionFactories`，不是「注册了再停用」），五个读 / 管理员写面**每次调用重新复判** `isSecretaryMember`；`worksplice_task_create` 先复判「任一频道生效首席」，再按消息所属频道复判 `isEffectiveChiefForChannel`——频道已有频道首席时全局首席被拒，没有频道首席时全局首席仍可回落。写面三个：`worksplice_channel_create`（私有频道必须把 actor 放进 `memberIds`；`memberIds` 只收**存活 agent**——`createChannel` 的 `assertMember` 只查存在性、`getMember` 连软删行一起返回，所以这层自己判；两条判据自票 chief-capability-converge 起住在能力表，见下节）；`worksplice_agent_create`（只收 `name` / `description` / `channelId`，模型一律 `provider: null` 继承全局默认；名字 `^ops-[a-z0-9][a-z0-9-]{1,27}$`；每会话至多 1 次成功创建、失败不消耗——上限与计数都在能力表 + 跨路径共享的配额 store 里）；`worksplice_task_create`（票 chief-task-create / #272：参数**只有** `messageId`——把一条**既有**顶层消息转成任务，校验 / 取号 / `TaskAlreadyExistsError` 全复用 `createTask`，thread 内消息由它自己抛错；授权 = 消息所属频道的生效首席 + 该频道成员；成功回 `{ number, status, anchorSeq }`。**有意例外：不补 actor 署名事件**——`createTask` 内部已投 Owner 署名的 `Task #N created`（`roomNotice: true` + `wake: true` 全频道扇出），那条既是频道留痕、也是下一轮 handoff 的准入触发）。写操作留痕走 `notifyChiefSystemAction`（**actor 署名** + `wake:false` + `roomNotice:true`——系统事件不得开房间场次、不得重置 `lateTurns`；仅前两个 `*_create` 工具使用）。三个读面都有界：只回约定字段（任务 preview ≤ 120 字符），可见面 = 公开频道 + 本人成员。**角色变化后需重启该 agent 的会话**才拿到新 surface，不做动态热更新。
- **#295 对上一段的修正**：`Task #N created` 仍以 `wake: true` 进入 wake 分发，但 `notifyMessageWakes` 现在只定向当前全局首席，不再“全频道扇出”；工具面的建任务授权未变。
- **巡检（#267，ADR-0018 决策二）**：路由者职责的第三件事，每分钟一次、有界。判定层 `lib/domain/collab/patrol.ts`（纯函数 / 零 IO，时间与任务快照注入）只认**已有任务**的三类卡住——未认领 `todo` 30 分（`PATROL_UNCLAIMED_TODO_MS`）/ `status` 仍为 `todo` 且 `handoff_state=blocked` 30 分（`PATROL_HANDOFF_BLOCKED_MS`；`claimTask` 不清 `handoff_state`，认领过的 blocked 是历史标记、不算卡住）/ `in_review` 24 小时（`PATROL_IN_REVIEW_MS`），7 天窗口（`PATROL_WINDOW_MS`，按锚点 `created_at`；卡住时长按任务行 `updated_at`）；去重签名 = 任务+状态+详情、**不含时长**（状态变了才重报，不按时间冷却）。接入层 `patrol-run.ts` 的 `runPatrolOnce` 搭 `tickAgentLoopMaintenance` 的同一分钟节拍（`WORKSPLICE_PATROL_DISABLED=1` 关闭，现算），每轮**最多一条**汇总、无发现完全沉默；**不读消息内容、不建任务、不派活、不改任务状态**（唯一写入是投递，投递失败不消耗签名）。投递 `wake:false` + `roomNotice:true`（系统事件：不进房间场次、不动迟到名额、不 supersede 在跑场次），只扫她作为成员、未归档、非 DM 的频道；签名集只在进程内（重启后同一批卡住再报一次），语义是 `prior = 已报过 ∧ 本轮仍检出`（淡出不再检出的），投递成功后 `= prior ∪ 进了这条消息的签名`——没进消息的私有发现不被吞掉，将来成为落点还能报出来；投递失败不写签名。落点与可见面：她作为生效首席、且**自己频道里**还有没报过的发现的频道（扫描顺序**逐个试**：前一个报过之后让给下一个，否则两个首席频道都有发现时后面那个会被永久哑掉；判据取「自己的发现」而不是「该频道可上报的发现」，否则全局首席让扫描名单第一个——通常是 `#all`——永远截走所有公开频道的发现）→ 她所在的第一个**公开**频道（`isPublic`，私有频道不参与兜底）→ 静默，不广播、不私信人类；汇总只携带落点自己的发现 + 公开频道的发现，**落在别的私有频道的发现不上报**（否则「私有频道名 + 任务号」会跟着公开落点泄露进更大的可见面；落点是私有频道时聚合公开发现是安全的）。兜底是本轮**新引入**的语义（既有代码只回答「谁是首席」不回答「落在哪」）。
- **schema v19 三列 + 两档幂等迁移**：`members.global_chief`（补列时把存活同名 agent 标一次；用户事后清空后不在开库时复活）/ `channels.chief_member_id`（纯补列，存量 NULL = 回落全局）/ `round_logs.role`（准入角色，可空，历史行 = 未记录）。三列都靠 `PRAGMA table_info` 检查式 ALTER，重复开库幂等。

<a id="member-capabilities"></a>

## 成员能力：开口面 + 约束面（票 chief-capability-converge）

`lib/domain/collab/member-capabilities.ts` 有两个面，各自回答一个问题：

- **开口面** `canMemberPerform(op, actorType)`：**能不能**做——ADR-0013 决策一的默认拒绝 + 逐条开口。签名与判定结果本票一字未动（开口集合不增不减）。
- **约束面** `memberOpConstraint(op)` + 四条判据：**以什么形状**做——`createAgent` 的名字正则 / 每会话上限 / 不接受的模型字段、`createChannel` 的私有必含 actor / `memberIds` 只收存活 agent。常量只在这里定义一次：`lib/chief-tools/decisions.ts` 的 `AGENT_NAME_PATTERN` / `AGENT_CREATE_QUOTA_ERROR` 是它的**别名**（`decisions.test.mjs` 用同一个模块缓存做 `===` 断言，并且禁止判定层再写一份正则字面量或配额上限）。

**为什么上移**：同一个动作本来有两条执行路径、规则各写一份——结果被约束的角色（全局首席）反而比任何 agent 更受限，而同样的事换个写法就绕过去了。约束面把**不矛盾的那部分**收到一处，两条路径同口径；不退役任何一条面，也不动不矛盾的项。

| 动作 | ops 面（任何 agent，`{"ops":[...]}`） | 首席 tools 面（按 surface） | 口径 |
| --- | --- | --- | --- |
| `post` / `react` / `pin` / `remind` / `search` | ✅ | — | 本票不动（与今天逐字节相同） |
| `reply` / `task`（claim / complete / unclaim / handoff） | ✅ | — | 协议字段，不动 |
| `createAgent` | ✅ 受约束 | ✅ 受约束 | **同口径**：同一名字正则、同一配额 store、同一句拒绝文案 |
| `createChannel` | ✅ 受约束 | ✅ 受约束 | **同口径**：私有必须含 actor；`memberIds` 只收存活 agent |
| 建任务（`worksplice_task_create`） | ❌（协议 `task` 只做 claim / complete / unclaim / handoff） | ✅ 仅生效首席（global 窄面 / channel 补面） | 授权按消息所属频道的生效首席；频道已有首席时全局首席不越权 |
| 频道 / 成员 / 任务读面 | 走每轮语境注入（不占 op） | ✅ 三个有界读面 | 只有 tools 面有显式读工具 |
| 归档 / 删除身份 / 三种 reset / 改 runtime / 改 workspace | ❌（`HUMAN_ONLY_OPERATIONS`） | ❌ | 人类专属，两条面都不开 |

**配额 = 跨路径共享的单一实例**：`lib/domain/collab/member-op-quota.ts` 的 `getMemberOpQuotaStore()`。规则是「同一 agent 的同一会话内 `createAgent` **成功**至多 1 次，失败不消耗」。

- 会话标识：tools 面由 `lib/rpc/caller.ts` 传 `sessionManager.getSessionId()`；ops 面由 `lib/agent-loop/loop.ts` 的调用点传 `session.sessionId`（`LoopSession` 的可选字段）。两侧是**同一个 id**，所以同一个会话在两条路径上就是同一个窗口。
- **fail-closed**：拿不到会话标识 ⇒ 退化为「该 agent 在本进程内至多 1 次」并记一条退化日志——**不允许**「拿不到标识就跳过配额」，那本身就是一条绕过路径。
- 上限**不可注入**（`MEMBER_AGENT_CREATE_LIMIT` 是唯一来源）：一旦可注入，「把上限调大」就是第二条绕过路径。

**会静默破坏它的纪律**：

1. 新增 / 修改约束只改能力表：在 `decisions.ts` 或 `member-ops.ts` 里再写一份正则 / 上限 / 文案，两条路径会重新分裂（`lib/chief-tools/decisions.test.mjs` 有源码级断言守这条）。
2. ops 面的拒绝走 `MemberOpOutcome` 的 `denied` 通道、并且在**写操作之前**返回（可读理由会进 `round_logs`）；不要改成抛错（`error` 通道），也不要静默改写（例如替私有频道自动补 actor——那正是绕过的成因）。
3. 配额只在**成功之后**记账（`recordSuccess`），`isExhausted` 永远只读；失败（重名 / 参数 / 权限）不消耗。
4. 热重载：配额单例挂 `globalThis.__workspliceMemberOpQuota`，改本模块或它的接缝后必须重启 dev server（同 `__workspliceRoomTurns` / `__workspliceWakeListeners`）。

<a id="agent-lifecycle"></a>

## Agent 成员与生命周期（ticket 05，§3.6）

- **身份 vs 会话**：agent 是持久身份（members 行），会话是 pi session（`pi_session_file` 回填）。三种重置粒度只动会话/工作区，身份与绑定保持；**删除 = soft-delete**（`members.deleted=1`，schema v3 ALTER 迁移）——行保留以承载不可变消息的外键与作者渲染，但移出全部 channel、任务 owner 置空、消费游标清空。
- **目录两分（ADR-0001）**：创建 agent 自动生成唯一**家目录** `<dataDir>/agents/<slug>-<id8>`（slug = 名字小写化 sanitize，空回退 `agent`）并预置 MEMORY.md 固定大纲（英文节名 `## Role`/`## Current work`/`## Workflow`/`## Skills`/`## Tools`/`## Other`——内容层英文硬编码，存量旧大纲不迁移，见 `docs/i18n.md` 分层规则；正文可空、缺失不补种、Full reset 保留）；**项目目录**可显式绑定且**允许多 agent 共享**（无绑定唯一性），但服务层拒绝把其他 agent 的家目录绑成项目目录（`homeDirOfAnotherAgent`）。工作区 = 单槽 `workspace_path ?? 家目录`；家目录派生绑定**不落库绝对路径**（`createAgent` 存 NULL），读取侧按**当前** dataDir 重推（`lib/data/dirs.ts` 的 `isDerivedAgentHomePath` + `lib/data/sqlite.ts` 的成员行视图）——历史行里的绝对家目录值同样重推，所以数据目录被复制/搬迁后写路径不回流原目录（docs/spec.md §6.2）。**删除身份只 rm 家目录**（`isOwnHome` 判定，绑共享项目目录时绝不 rm）；**Full reset 只作用于家目录**（项目目录 → 400 拒绝）。创建契约：POST /api/members 必选 provider/modelId/thinkingLevel（预选全局默认），不传目录。
- **运行串行**：session 启动时 `hasBusyRpcSessionForCwd`（realpath 语义）拒绝同一 cwd 并发活跃会话（`BusyCwdError` → route 409）——共享目录协作是串行的，真并行走 worktree（不同 cwd）。
- **共享 cwd 的 session 文件精确作用**：`resolveLatestSessionFile` 跳过被其他成员 `pi_session_file` 引用的文件（避免继承他人上下文）；`removeSessionFilesForCwd` 只删无任何成员引用的文件（调用方先清本成员引用）。
- **状态点 = 现场推导 + DB 回落**（`lib/agent-status.ts`）：`statusLookup` 有存活 wrapper 时推导（running → working / idle 且 DB 非 error → online），wrapper 不在时 DB error 保留、其余回落 offline；低频扫掠（10s）兜底 idle shutdown 的漂移。`prompt_error` 事件写 error 且不会被 idle 推导覆盖；**error 的清除触发点共三条**（第三条由 `lib/agent-recovery.ts` 落地）：① 新一轮 `agent_start`；② 生命周期动作（Restart / Session reset / Full reset / 换 workspace / 删除身份，见 `agent-lifecycle.ts`）；③ **runtime 保存后的模型探测结论**——出错中的成员在面板保存**具体模型覆盖**（保存后存在 provider+modelId 覆盖对）时，服务端对刚保存的覆盖对做一次最小连通性探测（`lib/model-probe.ts`：不落会话 / 不进会话历史 / 不唤醒 agent-loop / 不写 `round_logs`），通过 ∧ 有存活会话 ⇒ `online`、通过 ∧ 无存活会话 ⇒ `offline`（红 → 灰）、不通过 ⇒ 保持 error 且原因就地回给那次交互；**发布前置两条**（当前有效模型仍等于本次探测模型 ∧ 当前状态仍为 error）任一不成立则不写状态点。两条「不许推导出绿」的既有规则（收尾事件不覆盖 error / idle 推导不覆盖 error）**一字未动**——新增的是**显式裁决**式清除，不是推导式；`error` 的成因之一是 idle shutdown 走 `AgentSessionWrapper.shutdown()` 不经 `destroySession`、不发状态（所以 DB 里的 error 会一直留到上述三条之一）。lookup/listeners/snapshot 全部挂在 globalThis（热重载安全）；agent-runtime 用 `__workspliceAgentSessions` 按成员 id 记账 wrapper，**不按 cwd 猜归属**——同一 cwd 上的人类/他 agent 会话不会张冠李戴。
- **生命周期接缝**：`AgentRuntime` 接口（start/destroy/find/removeSessionFilesForCwd）由 `lib/agent-runtime.ts` 实现，**惰性 import lib/rpc/SDK**（`getAgentRuntime()` 才拉起），测试注入 fake 即可单测 `agent-lifecycle`——node 的 TS strip 模式无法解析 lib/rpc/session.ts 的 parameter properties，绝不能静态 import 它。
- **换目录即换会话**：`changeAgentWorkspace` 先校验新路径（坏路径不伤旧会话；拒绑他人家目录）→ 销毁旧 cwd 的会话 → 改绑定并清空 `pi_session_file`；Restart 按同一 session 文件重启（上下文保留）。**Session reset / Full reset 删掉该 cwd 下无成员引用的 session 文件**（`removeSessionFilesForCwd`），保证按需重建时是全新会话而不是复活旧上下文；共享项目目录下他 agent 的文件保留。
- `**db-singleton` 版本守卫**：`openSqliteAdapter`/`openDataDb` 记录打开时的 `SCHEMA_VERSION` 到 `__workspliceDbOpenedVersion`，`getDb(): Store` 比对版本，热重载后 `SQLiteAdapter` 类已变时重建实例——避免拿到旧原型的 `setMemberPiSessionFile` 等新方法缺失报错；测试直连（`globalThis.__workspliceDb = openDataDb(tmp)`）同样经过 openSqliteAdapter，不会被误重建或误开 `~/.worksplice/worksplice.db`。

<a id="agent-loop"></a>

## agent-loop（ticket 06，§3.8/§5.3–5.5）

- **拉取式 inbox，不推送正文**：`consumed_seqs(agent_id, target_id, seq)` 是持久化游标；`drain` 不推进游标（重复 drain 不重不漏），`ack` 由 loop 每轮收口；HTTP 语义（`GET /api/members/[id]/inbox`）是 drain + ack 一步到位。wake hint 只含 `{agentId, targetId, seq, reason}`，正文由 agent 自己 drain。
- **wake 触发面（#237/#240/#270、#295）**：`sendMessage` 提交成功后（事务外）调 `notifyMessageWakes`——人类正文点名 / `@all` 才产生新邀请（引用块 / 代码块 / 行内代码里的 @ 不算）；普通 agent 正文 @ 不穿透、不产生第二波；DM 语义不变；开放任务创建事件与明确关联的未认领任务只定向唤醒**当前全局首席**（频道首席不再接收任务 handoff），一个事件最多一个收件人，全局首席不存在 / 非频道成员 / 静音 / 已有 owner / 已分流时不叫任何人且不换人。非权威完成请求另发 `reason="task-status"`，同样只给当前全局首席；不依赖正文 @。thread 消息以锚点消息 id 为目标。回滚的 held 不会误唤醒。`WakeHint.recovery` 只标记丢失 handoff wake 的补发，驱动层据此去重。
- **mute（ticket 12，§3.2/§3.8）**：channel 级静音 = `channel_mutes` 表（PK channel+member）记录静音时刻的 `mute_from_seq`（channel max(seq)）与 `mute_rowid`（全表 max(messages.rowid)）。drain/getPendingTargets 过滤：静音后的普通消息不进 inbox，个人 @mention 仍穿透；channel 消息按 seq 比，thread 消息无 channel seq 可比（thread 自己的 seq 空间）按 rowid 比（全局插入序，避免同毫秒 created_at 歧义）。静音前的消息照常投递；取消 mute 后不补投静音期间被压制的消息（游标已推进）。`GET/POST /api/channels/[id]/mute`（Owner 可替任意 agent 设）；ChannelView 头部 `BellOff` 面板逐个 agent 开关。
- **一轮的结构化协议**：`runAgentRound` = drain（过滤自己的消息）→ **轮次准入**（#237：`decideRoundAdmission`；未准入返回稳定 `skipped` reason，不起会话 / 不发 prompt / 不动游标）→ 检查"最新消息是本人的回复"则只 ack 不重复应答（崩溃窗口自愈）→ 起会话 → 发 prompt（`buildReplyPrompt`：channel 语境 + `#seq @author … (messageId <id>)` 消息行（#266） + 相关任务状态 + JSON 指示 + 房间标记）→ `parseAgentAction` 解析 `{"action":"reply"|"ignore","content","onConflict"}` 与顶层 `task` op（claim / complete / unclaim / handoff）→ 回复经 `sendMessage` 带 baseSeq 走 freshness → ack 推进游标。非 JSON 回复整段作为内容，默认 resend。**ack 语义**：ack 到 agent 本轮实际读到/被告知的房间版本（`deliverWithFreshness` 返回 ackSeq，held 后随 roomSeq 推进），避免游标停在旧 baseSeq 导致 target 永久 pending。
- **prompt 目标身份与内容分工**：`buildReplyPrompt` / `buildRevisionPrompt` 的头部由 `describePromptTarget` 生成——频道轮 `channel X`（与旧文案逐字节一致）、任务线程轮 `the thread of task #N [status] under channel X (anchor seq S)`、普通线程轮 `a thread under channel X (anchor seq S)`（锚点缺失时省略 seq）。`buildReplyPrompt` 的 response rules 里固定注入 `CONTENT_PLACEMENT_RUBRIC`（`onConflict` 之后、`Task protocol` 之前）：交付物的事实/证据/数据/更正 → 该交付物任务线程；可独立成立的方法论 → 频道；可复用事实/口径 → 可留频道但须带来源与日期；频道提到任务仅指针、不带新结论。该 rubric 明写 "the app decides delivery"——只约束内容写在哪，投递方向仍由 §3.7 路由裁决；`buildRevisionPrompt` 不注入它。只加固定骨架行，`projectMessages` / `elasticBudget` / `INJECTION_*` 与消息块裁剪不动。
- **freshness-hold 四选一**（`deliverWithFreshness`）：held 后按 agent 声明的 onConflict 执行——revise（`buildRevisionPrompt` 携带期间新消息正文重读重写，最多 1 次）/ resend（携带新 roomSeq 原样重试；默认路径，最多 1 次）/ silent（静默放弃）/ anyway（不带 baseSeq 显式绕过，连续 hold 的逃逸口）；重试耗尽归入 silent。发送器可注入（`send` 参数，测试脚本化用）。**hold 重路由**：频道轮的普通回复在 resend/revise 重发前，会用写稿版本（`readBaseSeq`，不随 roomSeq 前移）之后的新消息重跑 `resolveTaskReplyRoute`（`allowPendingFallback=false`，只认创建事件）；输入与 drain 共用 `filterVisibleMessages`（§3.2 mute 口径，被静音的创建事件不能触发认领）。命中时 `deliverWithFreshness` 返回 `{status:"reroute", route, action, ackSeq}`，`ackSeq = max(held roomSeq, route.eventSeq)`（revise 重写期间到达的事件也要随本轮消费，否则下一轮重复路由）；由 `runAgentRound` 以 `baseSeq=ackSeq` 交回既有 `runTaskOperation`（claim 重试 / 参与者 / 线程投递 / 游标收口同一条路径），函数自身不投递、不 claim、不写游标。裁决先于重试预算：第二次 hold 才到达的创建事件不会被 "retries exhausted" 吞掉；线程轮 hold 永不重路由。
- **崩溃恢复补拉**（loop.ts 内 backfill 段）：loop 的 prompt 末尾带房间标记 `[worksplice:target=<id> seq=<N>]` 落进 session jsonl 的 user 条目（revise prompt 额外带 `[worksplice:revision]`）；启动时（`createAgentLoop().start()`，instrumentation 调用）扫描各 agent 的 session jsonl——**每个标记轮只保留最后一条 assistant 文本**（revise 草稿/工具中间产物被下一轮 prompt 丢弃），回复内容按 `parseAgentAction` 解析（JSON 取 content，ignore 不落库），缺失于 SQLite 的按序补写（同 target 同作者同内容去重）；**投递目标还原**：① 本轮 assistant 回复带显式 `task` op 时，按 `task.number` 还原到该任务的锚点线程（任务缺失则维持频道）——优先于 marker 启发式；② 否则若 `(targetId, markerSeq)` 那条消息是 Owner 的 `Task #N created` 创建事件且任务存在，该轮真实投递目标是任务锚点线程——补写进线程而不是频道顶层（done/closed 也照常还原，状态不影响历史还原）；同 target 幂等按还原后的目标判定，跨 target 判重仍按 `hasAuthorContentInChannel` + 频道 marker 守卫，游标仍只写 marker target；**游标推进到每个标记轮的标记 seq**（标记存在即证明该轮 prompt 已进入上下文——即使回复已存在也推进，覆盖"崩溃于补写后 ack 前"窗口）。**已知残余（P-3）**：走 hold 重路由的轮 marker 仍停在写稿前版本，若进程在线程写入前崩溃，补拉不会还原到线程；补拉也无法区分「崩溃缺失」与 live 明确让路（reopened / claim 耗尽）或裁决时已 done·closed 的轮，会按创建事件还原到线程（后者是 P3 票面「状态不影响还原」的取舍）。根治需让 session marker / round_log 记录该轮真实投递 target。**不回放 wake**（补写直接落库）。wake 由 driver 订阅；`__workspliceWakeListeners` 挂 globalThis（lib/domain/collab/wake.ts）。
- **driver 编排**：每 agent 一个 FIFO 队列，同 (agent, target) hint 合并；**⚠️ 合并窗口是承重不变式**：`processAgent` 必须在 `queue.shift()` **出队之前**先让出一个微任务（`await null`），同一同步回合内到达的同 target hint 才能并进同一条 entry、一轮 drain 取尽（板上 Create Task 的「用户消息 + 任务创建事件消息」就走这条：合并后第一轮 claim 直接成功，不被自己顶出的那条消息 hold）。改这段时**不要在 `shift` 之前加 `await`、也不要挪动循环**——合并会静默失效（退化成多跑一轮、该轮 claim 被 hold 让路），tsc/lint 都不会报，唯一护栏是 loop-tasks 的特征用例；这条让出以前是「顺带」的：只有生产形态（runtime=null，`state.runtime ?? (await getAgentRuntime())` 走右半）恰好让出，注入 fake runtime 时 `??` 短路不让出，测试与生产形态分叉（见 loop-tasks）；busy（会话运行中）/ busy-cwd（同 cwd 被占用）时挂 settle 监听（`SETTLE_EVENTS`：agent_end/agent_settled/prompt_done/compaction_end/auto_compaction_end）后重试，不丢 hint；busy-cwd 找不到等待对象（对方会话 starting 窗口未入 registry）时退避 `BUSY_CWD_RETRY_DELAY_MS` 后重试（不热自旋，定时器随 stop() 取消）；状态挂 `__workspliceAgentLoopDriver`。loop 只依赖 `LoopRuntime` 结构子集（findSession/startSession/findBusySessionForCwd），测试注入 fake，**不静态 import lib/rpc**。
- **⚠️ 热重载陷阱（改代码必须重启 dev server）**：wake 监听器（`__workspliceWakeListeners`）在 server 启动时由 `startAgentLoopDriver` 注册，`started` 守卫阻止热重载后重新订阅——**旧监听器闭包永久持有旧 `runAgentRound`/`parseAgentAction`**。改 agent-loop/driver/wake/backfill 等被 globalThis 闭包引用的模块后，热重载不生效，行为照旧（曾因 parseAgentAction 修复不生效，脏 JSON 消息继续落库数小时）。验证手段：查 `ps aux | grep next-server` 的启动时间是否晚于改动。同理，`getAgentRuntime()` 的 wrapper 记账与 session 启动路径同此约束。
- **状态点**：loop 在 prompt 前后 publish working/online（与 wrapper 的 agent_start/agent_end 事件双保险）；会话错误 publish error 且不推进游标（下次 wake 重试）。

<a id="room-budget"></a>

## 房间轮次预算（room turn budget，PR #218）

源码 `lib/domain/collab/room-budget.ts`（深模块：对外只有 `beginTurn / gate / noteReply / notePass / noteBusy / pump / markSuperseded / stopTurn / isCurrent / snapshot / reset`，波次推进全在内部，调用方无法跳过预算）。要解决的是「多 agent 群里结构性不可能无限互相接话」——落在计数器 / 序号水位线 / 状态机 / 显式取消上，**不是**提示词自律。

- **默认上限**（`DEFAULT_ROOM_LIMITS`，`room-budget.ts:42`）：`MAX_REPLIES = 10`（一条用户消息引发的 bot 发言总数）/ `MAX_ROUNDS = 3`（对话波次，0 基、含第一波）/ `MEMBER_TIMEOUT_MS = 600_000`（单成员超时）/ `MAX_LATE_TURNS = 3`（迟到回答的补充轮次上限）；同处还有 `HISTORY_LINES` / `LINE_CHARS`（转写内存，见已知边界）与 `MAX_REQUEST_HOPS` / `MAX_PENDING_MESSAGES` / `MAX_PENDING_MESSAGES_PER_SENDER`（直连链）。
- **三个构造口**：`createRoomTurnStore({ limits, now, directory, notify })` 造实例（上限 / 时钟 / 目录 / 唤醒投递全可注入）；`getRoomTurnStore()` 取生产单例（挂 `globalThis.__workspliceRoomTurns`）；`setRoomTurnStore(null)` 是测试接缝，下一次访问重建。
- **I1 发言预算**：场次计数 `replies`（`RoomTurnView.replies`，`room-budget.ts:118`）跨轮累计，只在「本波当选且尚未结算」的实质发言上 +1（`noteReply`），到顶由 `pump` 收口为 `reply_budget`。
- **I2 波次预算**：`wave`（`RoomTurnView.wave`，`room-budget.ts:120`）记已执行波次，`pump` 在波次结算后先查预算再决定开不开下一波，到顶收口为 `round_budget`。
- **I3 超时不阻塞**：`releaseTimeouts` 只比较 `askedAt` 与 `MEMBER_TIMEOUT_MS`，从不 `await` 成员；`noteBusy` 让忙碌成员立刻还回槽位并记一条 `busy-notice`。
- **I4 同一条 @ 不二次唤起**：`candidates()` 用单调水位线 `seen` 比较（`seen[member] >= citedAtSeq` 即视为已看过这条引用）；`isBackEdge` 做回边抑制（反向重试 / 互引对）。
- **I5 用户掐断**：`beginTurn` / `stopTurn` 推进 `epoch`，`isCurrent` 是检查点判据；`runAgentRound` 的 CP0 / CP2 / CP3 据此拒绝入场或标 `stale`。
- **I6 房间内无隐身通道**：`sendMessage` 收到 `roomContext` 时校验解析出的频道是否等于 `roomContext.channelId`，不等抛 `RoomPrivateChannelForbidden`。
- **I7 迟到独立预算**：`noteLateReply` + `lateTurns` + `pendingLateSeq`——忙碌 / 超时被释放的成员之后的发言走补充波，最多 `MAX_LATE_TURNS` 次；`stopTurn` 把 `lateTurns` 置哨兵，Stop 之后零补充波。
- **I8 预算不可自助重置**：预算只挂在房间状态上，`beginTurn`（= 人类新消息）是唯一重置点；`@all` / `@everyone` 只影响第一波邀请候选（#237 起由 `selectMessageInvitations` 显式传入），改不动计数。
- **接入点一 —— `sendMessage` → `recordRoomTurn`**（`lib/domain/collab/messages.ts`）：Owner 消息 → `selectMessageInvitations` 先算候选，再 `beginTurn`（epoch+1、`lateTurns` 归零、显式候选；空候选仍推进 epoch / 取代旧场次，但不选人、不等超时）；agent 消息 → `noteReply`（I1 计数 + 水位线；#237 起生产路径传 `mentions: []`，普通 agent 正文 @ 不产生新候选 / 第二波；跨 target 用 `message.rowid` 当水位线，因为 thread 有自己的 seq 空间）；`roomNotice: true` 或 `wake: false` 的系统消息整个跳过。记账排在 wake hint 之前是承重的——被唤醒的轮次入场第一件事就是问「我是否被这一波选中」。
- **接入点二 —— `runAgentRound` 的准入闸 + CP0 选人门**（`lib/agent-loop/loop.ts`）：先由 `decideRoundAdmission` 判「该不该起会话」（人类正文点名 / `@all`、任务线程 owner / 状态矩阵、in_review 任务 owner 的 @ attention、DM / reminder / 任务创建事件）；`in_review` 的 owner mention 只以 `task-reviewer` 放开模型调用，**不进入 must-respond**，模型仍可选 ignore / conclude。需要房间门的频道轮再问 `gate({ channelId, memberId, reason, continuing })`，`not-elected` 返回既有 `{ status: "skipped", reason: "not elected by room turn" }`；任何未准入都**不推进消费游标**、不起会话、不花模型调用。任务线程不走 channel 房间门；reminder 轮次与任务续工轮次 bypass。CP2 在出 prompt 前、CP3 在回复落库后各复查一次 `isCurrent`，投递时带 `roomContext`（I6）。
- **wake 与选人同源（#237）**：`lib/domain/collab/wake.ts` 的人类消息候选同样由 `selectMessageInvitations` 计算——广播不再是「全员扇出后各自让路」，而是只唤醒本轮邀请候选；普通 agent 正文 @ 不再穿透。房间场次不活跃、或 DM 频道（`isRoomChannel` = false）时行为与旧语义对齐（DM 完全不变）。

**会静默破坏它的纪律**（每条都是「踩了不报错，只会错」）：

1. **「Owner 署名 + 系统事件」的消息必须 `roomNotice: true`**：`recordRoomTurn` 只看作者类型与开关，`OWNER_MEMBER_ID` 署名的系统消息在唯一漏斗里与人类消息**不可区分** ⇒ 开新房次、`lateTurns` 归零、把在跑的场次 supersede（违反禁止项 #5）。判据只有一句「这条消息是人类真的敲出来的吗」。现状：`event-messages.ts` 的 `notifyTaskCreated` / `deliverEventMessage` / `notifyChiefSystemAction` 与巡检的 `patrol-run.ts`（#267，首席署名）已显式声明；`reminders.ts` 的 `fireReminder` 仍只靠 `wake: false` 被跳过、**未显式化**——这是遗留（不是 bug），后续票再补 `roomNotice`。
2. **CP2 只收口场次记录，不中止、不 ack**：改成「中止 + ack」会静默消费掉尚未处理的任务创建事件（既有 `lib/agent-loop/loop-tasks.test.mjs` 的 R3b / R3c / R3d 契约守的正是「让路轮停在创建事件之前」）；I5 的**退出**语义落在 CP0（已被取代的场次进不来）与 CP3（回复照常落库、按 `stale` 记账、不续波）。
3. **改 CP0 必须跑 `lib/agent-loop/room-gate.test.mjs`**：store 侧用例删掉 CP0 也全绿，只有这个文件能把「门真的接在轮次入口上」判成红（删掉那段 `return`，它的「未当选 ⇒ skipped」用例必红）。
4. **回边抑制是切环的实际机制**：仅靠水位线比较不足以切断——后发言者的 `@` seq 必然晚于先发言者自己的发言 seq，A↔B 乒乓下水位数永远成立、环永远成立；删掉 `isBackEdge`，`lib/domain/collab/room-budget.test.mjs` 的 T2 必红（T2 把预算放大到 `MAX_ROUNDS: 50 / MAX_REPLIES: 100`，断言 `wave === 1`）。T1 仍可能被 I1 / I2 预算兜住——T1 守「预算兜得住」，T2 守「环在数据层就被切断」。
5. **上限只走注入的 `RoomLimits`**：禁 env / 配置文件 / 热更新 / prompt 软约束——`createRoomTurnStore({ limits })` 是唯一入口（模块里没有 `process.env`、没有文件读取），测试要能确定地改小。
6. **热重载**：房间状态挂 `globalThis.__workspliceRoomTurns`，改本模块（或 `messages.ts` / `loop.ts` 的接缝）后必须重启 dev server，否则旧闭包继续持有旧预算实现（与 `__workspliceWakeListeners` 同一套陷阱）。
7. **I6 与直连链的中文错误文案是有意的**：本模块的中文错误文案共四处——`ROOM_PRIVATE_CHANNEL_MESSAGE`（I6 房间可见性），以及三条 `RoomBudgetError`（直连链跳数 / 单发送者待回信 / 全局待回信，按 code 定位：`hop_limit_exceeded` / `pending_limit_per_sender` / `pending_limit_global`）。四处都是票面逐字要求（`.scratch/room-turn-budget/spec.md` 的「Out of Scope」末条：按规格逐字保留中文），与 `docs/engineering-standards.md` §1「错误消息用英文（对外契约）」、`docs/i18n.md`「进模型上下文的内容英文硬编码」**故意冲突**，用户裁决为票面优先。**不是 bug，别顺手改成英文**；要改必须一次改全——只英文化 I6 那一条会留下三处不一致（判据用 code，不要按出现位置数），并同步改 `room-budget.test.mjs` 的 T7 / T8 断言。

**已知边界**（都有出处，别当缺陷）：

- `stopTurn()` 已由 `stopChannelTurn()`、`POST /api/channels/[id]/stop` 与非 DM 频道头部 Stop 按钮接通；任何已 ended 的场次（含 `no_speakers`）再次 Stop 都幂等 no-op，不改收口原因、不重复加 epoch。
- `HISTORY_LINES` / `LINE_CHARS` 只约束场次转写（选人裁决用）的内存占用，转写**不拼进 prompt**；丢最老的行只会让候选变少，不会放大预算。
- I3 只做**惰性释放**：`releaseTimeouts` 在 `pump` / `gate` 里跑，比较时间戳后把槽位还回去；不阻塞等待、也没有 `abort` 去打断成员会话。

设计记录（常量理由、7 条禁止项、与原始伪代码的偏差 D1–D4、双轴 review 与红绿证据）在 `.scratch/room-turn-budget/spec.md`。

<a id="task-board"></a>

## 任务板（ticket 07，§3.7/§5.7 tasks 路由组）

- **task = 消息 + 元数据**（`lib/domain/collab/tasks.ts`）：`tasks` 表锚定 `message_id`（UNIQUE）；创建三途径——右键菜单 Convert to Task / 发送时勾 As Task / Tasks tab Create Task，全部收敛到 `createTask({messageId})`（board 创建先 `sendMessage` 再转）；**thread 内消息不可转**（锚点 target 必须是 channel）、消息不可重复转（`TaskAlreadyExistsError` → 409）。`number` 按 channel 内递增（join messages 算 max+1），跨 channel 各自从 #1 起。
- **状态机只走合法转移 + 单一状态权威**（`TRANSITIONS` 表 + `isTaskStatusAuthority`，服务层双重强制）：`todo ─claim→ in_progress ─complete→ in_review ─approve→ done`；`unclaim/reject` 回退（in_progress→todo、in_review→in_progress，owner 保留）；in_progress/in_review ─close→ closed；`done/closed ─reopen→ todo`（**reopen/unclaim 清 owner 回池**）。只有人类 Owner 或**当前全局首席**可以 claim / unclaim / complete / approve / reject / close / reopen；普通 agent 与频道首席一律 `TaskNotAuthorizedError`，任务状态与 owner 不变。任务 owner 只是归属、不是写权；权威可在合法边上管理任意 owner 的任务，非法边仍拒绝。原「构建者不验证自己」不再由普通 agent 的状态写权限承担。
- **完成请求（#295）**：非权威 owner 的 `complete` 只写完成请求，不改状态——任务保持 `in_progress`；完成回复以 `wake:false` 落线程（不广播、不自醒），随后追加一条 actor 署名的系统事件（`roomNotice:true` + `wake:false`，不占房间预算）。同一份完成报告以线程回复 id / 轮次 key 去重；提交后只定向唤醒当前全局首席（`reason="task-status"`），准入层只在 `in_progress` 线程对当前权威开放该 reason，复用 `round_logs.role="task-reviewer"`（不新增 schema CHECK 取值）。**成本上限**：一次完成报告至多一轮全局首席 prompt；没有定时器或按秒重试。全局首席不存在 / 非频道成员 / 静音 ⇒ 事件仍留线程、不唤醒、不降级给频道首席；任务状态不变。
- **重开封锁**（schema v8 `tasks.reopened` 列）：reopen 置标记回池——**非权威 agent 一律不能认领**（服务层 403；不再走旧的 `blocked` 分支），仅当前任务状态权威可认领接管并**清标**；人类 Owner / 全局首席 unclaim 后任务回池，再次重开再次封锁。unclaim/reject 不置标。向前生效，存量不追溯。`TaskView`/`listRelatedTasks` 带出标记：UI 任务板显示"重开"徽标、`buildReplyPrompt` 标注 "REOPENED … do not claim" 让模型不发起 claim。
- **并发保护**（§6.3 同消息语义）：claim/updateStatus 携带 `baseSeq` = channel `max(seq)`，事务内比对不等返回 held（`summarizeChanges` 摘要复用）；claim 已认领返回 conflict（route 409）。UI 收 held 后刷新并提示。
- **自动认领（agent-loop，#295 收紧）**：协议仍是 `"task":{"number":N,"op":"claim"|"complete"|"unclaim"}`（`parseAgentAction` 向后兼容）。只有当前全局首席可能自动 claim；普通 agent / 频道首席的普通回复不自动 claim，路由进任务线程时只作为参与者回复。显式 claim / unclaim、非权威 handoff 被服务层拒绝后 loop **让路**（`RoundStatus "yielded"`，不回复、channel 游标只推进到已读版本，不误投频道顶层）。权威的 reply 投递到任务线程（thread 自己的 seq/freshness）；权威 complete 才置 in_review（held 按 roomSeq 重试 ≤2 次，失败不吞回复），非权威 complete 走上面的完成请求。
- **任务延续自醒**（lib/domain/collab/wake.ts）：任务 owner 的回复落任务线程且任务仍 in_progress → 自醒续工；`runAgentRound` 的 drain 对"全是我自己的消息但我在该线程有 in_progress 任务"不再 noop/skip（`ownsInProgressTaskAt`），而是以自身进度为语境续工或 complete。**游标收口**：channel 游标每轮推进；线程游标在任务离开 in_progress（complete/unclaim）时才推进，进行中留口供续工轮 drain 到自己的进度。
- **板视图**：`GET /api/channels/[id]/tasks` 按 number 升序、每任务附 `reachable`（ADR-0002：服务端按人类 owner 身份推导的合法转移落点，含 todo→in_progress 的 claim 边；客户端不镜像状态机表）；UI 侧 List|Board 两种任务视图（ADR-0002，localStorage 记忆，默认列表）——List 按状态分组（todo→in_progress→in_review→done→closed），Board 5 列 = 5 状态常显、跨列拖拽 = 请求一次状态转移（HTML5 DnD，**不做乐观移动**：松手等服务端确认，非法落点弹回+提示）；卡片显示 #number/首行预览/owner/状态 + 按身份与状态出动作（Claim / Complete / Unclaim / Close / Approve / Reject / Reopen，与拖拽同权）；点卡片打开任务 thread（进展只在线程里，视图只显示状态）。

<a id="reminders"></a>

## 提醒（ticket 08，§3.9/§5.6 reminders 路由组）

- **触发 = 系统消息 + 定向唤醒作者**：cron 到点 → `fireReminder` 以**作者署名**投递 `⏰ Reminder: <title>` 到**频道主流程**——channel 锚定投该 channel；消息锚定归一化后投其**归属 channel**（原设计投 thread 不可见，已修正为频道可见；正文附 `(anchored on #seq)` 锚点引用），`sendMessage({wake:false})` **不触发 channel 级 wake**（不惊动其他 agent）；随后仅当作者是 agent 才 `emitWake({reason:"reminder"})`（§3.9 唤醒作者本人；human 作者 = UI 轮询看到系统消息即通知）。
- **作者选择 = 唤醒谁**：POST 默认 author = Owner；Owner 可替 agent 设（authorId = 某 agent，仅 Owner 权限，§3.6）——演示路径"给 agent 设 every:1m → 系统消息 + agent 被唤醒"靠这个闭环。ReminderModal 的"唤醒谁"下拉列出 channel 内 agent。
- **自提醒可被 agent 看到**：系统消息以作者署名 → agent 自己设的提醒在 drain 里"全是自己的消息"，普通轮次会 noop/skip；`runAgentRound` 增加 reason 参数（driver 队列按 hint 合并取宽松侧 reason——含 reminder 即按 reminder 处理），`reason==="reminder"` 时"只有自己的消息"与"最新是本人消息"两条跳过都不生效，agent 以自身提醒为语境决定行动（loop 测试 reminded 用例）。
- **recurrence DSL**（`lib/domain/collab/recurrence.ts` 纯模块）：`every:Nm/Nh/Nd`（delay 语义，服务端算绝对时间）/ `daily@HH:MM` / `weekly:mon,fri@HH:MM`（大小写不敏感、未知星期名整体拒绝）；`nextFireAt` **严格晚于 from**（等值视为已到点）——否则 reschedule 会立即重触发死循环；daily/weekly 用本地时区 Date 构造（时区安全）。
- **幂等与收口**：fire 全程同步（无 await，单进程内不交错）；状态迁移 + log 在一个事务里，重复 tick/重复 fire 返回 not_due 不重复投递。**消息投递失败（作者已退出 channel 等）→ 记 error log 并收口 fired**（不无限重试），不 wake。
- **生命周期 log**：schema v4 新增 `reminder_logs` 表（事件 schedule/fire/reschedule/snooze/update/cancel/error）；列表按 rowid 排序（同毫秒 created_at 的时序保真）；fire 事件先于 reschedule 写入（时间序）。
- **管理权限**：snooze/update/cancel 仅作者本人或 Owner 可操作，且仅 `scheduled`（fired/canceled 报错）；snooze = `max(now, fire_at) + minutes`（默认 15）。
- **UI**：channel 头部 ⏰（目标 = channel，joined 才显示）+ 消息动作栏 ⏰（目标 = 该消息/thread 锚点，标题预填首行预览）；ReminderModal 内可创建（datetime-local + recurrence 预设 chips）、列出锚定提醒、snooze/cancel；到点系统消息经 3s 轮询落入消息流。**全局「我的提醒」入口**（侧栏底部 ⏰ 按钮，带待触发计数角标，15s 轮询）→ MyRemindersModal 列出**全部**提醒（ReminderView 附 channelId/channelName/anchorSeq，跨 target 可见），可 snooze/cancel/定位（深链 `#c/<channelId>[?m=<id>]` 跳转）。锚点消息行显示**线程回复角标**（`threadReplyCount` 批量查询，点击展开线程）——消息锚定提醒触发后可从角标发现 thread 内进展。

<a id="message-enhancements"></a>

## 消息增强（ticket 09，§3.3–3.5 reactions/pinned/attachments）

- **reaction = 先查后写 toggle**（`lib/domain/collab/reactions.ts`）：存在即删、不存在即加，UNIQUE(message_id, member_id, emoji) 单进程串行无竞争；**channel 成员才可点**（thread 消息经 `message.target_id` 锚点解析归属 channel，不可嵌套读侧同语义）；无通知/不进 inbox（§3.4）。聚合 = count 降序 + memberIds（UI 用 `includes(currentMemberId)` 判定"我点过"）。
- **pinned 个性化**（`lib/domain/collab/pinned.ts`）：每成员每 channel 独立 pinned 区；`pinMessage` order = max+1（幂等返回既有行）、`unpinMessage` 幂等 false；**消息须属于该 channel**（thread 消息经锚点归一化，跨 channel 拒绝）；sort=manual（order 升序）/recent（pinned_at 降序，同毫秒按 order 兜底）/az（内容 localeCompare）。`setPinnedOrder` 只重排已 pin 行。
- **附件随消息原子提交**（§3.5）：`sendMessage` 增加 `attachments[]`（≤50MB）——先 `stageAttachmentFiles`（校验 + **随机文件名**落盘 `attachments/`，原始名只存库），事务内 appendMessage + insertAttachment 同生共死，**held/抛错 → `discardAttachmentFiles` 清理**，不留孤儿。文件下载走 `/api/attachments/[id]`（图片 inline 预览，其余 attachment）。
- **messageWithAuthor 统一附料**：reactions（聚合）+ attachments（行）直接内嵌进消息 payload，UI 免 N+1 请求；thread 读接口/agent-loop 双写流同享（纯增量字段，向后兼容）。
- **POST /api/messages 双形态**：JSON（原样）或 multipart（字段 + `files[]`）；单文件 &gt;50MB 由服务层 `stageAttachmentFiles` 校验拒绝（客户端预检兜底）。`formatBytes`/`MAX_ATTACHMENT_BYTES` 在 `lib/preview.ts`（client 可安全导入，**不**从 协作服务层引——那会拖 better-sqlite3 进浏览器包）。
- **UI**：消息 hover 快捷 reaction（👍❤️🎉👀）+ ＋ 选择器（24 常用 emoji 网格）+ 内容下聚合条（已点高亮黄）；动作栏 `Pin`（pinned 态黄底）**仅频道主流程**（线程面板不提供）；Composer `Paperclip` 多选 + 文件 chips（≤50MB 前端预检）；channel 头部 `Pin` 展开 pinned 区（sort 三选一 + Manual ↑/↓ 重排 + 点击定位消息/展开线程）。收窄的代价：线程内消息无法置顶，置顶只能在频道主流程做；已置顶的线程消息仍可从频道头部 pinned 区定位/展开线程。
