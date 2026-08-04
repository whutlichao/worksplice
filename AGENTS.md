# worksplice - Development Notes

## 
使用中文进行交流。
## Quick Start

```bash
npm run dev   # port 30141
```

Typecheck: `node_modules/.bin/tsc --noEmit`  
Lint: `npm run lint`  
**Never run `next build` during dev** — pollutes `.next/` and breaks `npm run dev`.

---

## Architecture

```
Browser                Next.js Server              AgentSession (in-process)
  │                        │                               │
  ├─ GET /api/sessions ────▶ reads ~/.pi/agent/sessions/   │
  ├─ GET /api/sessions/[id] reads .jsonl file directly     │
  ├─ GET /api/agent/running ───────▶ running id snapshot   │
  │                        │                               │
  ├─ send message ─────────▶ POST /api/agent/[id]          │
  │                        │   startRpcSession() ─────────▶│ createAgentSession()
  │                        │   session.send(cmd) ─────────▶│ session.prompt()
  │                        │                               │
  ├─ SSE connect ──────────▶ GET /api/agent/[id]/events    │
  │                        │   session.onEvent() ◀─────────│ session.subscribe()
  │◀── data: {...} ─────────│                               │
```

**Session browsing** (read-only): reads `.jsonl` files through SDK `SessionManager` helpers and `lib/session-reader.ts` — no AgentSession created.  
**Sending a message**: `startRpcSession()` in `lib/rpc-manager.ts` creates an AgentSession in-process.

---

## File Map

```
app/api/
  sessions/route.ts               GET  list all sessions
  sessions/[id]/route.ts          GET/PATCH/DELETE session
  sessions/[id]/context/route.ts  GET ?leafId= — context for a specific leaf
  sessions/[id]/export/route.ts   GET exported HTML for a session
  agent/new/route.ts              POST { cwd, message, toolNames?, provider?, modelId? }
  agent/[id]/route.ts             GET state | POST any command
  agent/[id]/events/route.ts      GET SSE stream
  agent/running/route.ts          GET currently-running session ids
  agent/running/events/route.ts   GET SSE stream of currently-running session ids
  auth/all-providers/route.ts     GET API-key provider list
  auth/api-key/[provider]/route.ts GET/POST/DELETE provider API key status/storage
  auth/login/[provider]/route.ts  GET OAuth/device-code SSE | POST manual code
  auth/logout/[provider]/route.ts POST OAuth logout
  auth/providers/route.ts         GET OAuth provider list
  cwd/validate/route.ts           POST validate/select a cwd
  default-cwd/route.ts            POST create ~/pi-cwd-YYYYMMDD
  files/[...path]/route.ts        GET file contents for viewer
  home/route.ts                   GET user home directory
  models/route.ts                 GET { models, modelList, defaultModel }
  models-config/route.ts          GET/PUT — read/write ~/.pi/agent/models.json
  models-config/catalog/route.ts  GET models.dev pricing presets
  models-config/discover/route.ts POST fetch a configured provider's upstream model list
  models-config/test/route.ts     POST test a configured model/provider
  plugins/route.ts                GET/POST package plugin management
  skills/route.ts                 GET/PATCH loaded skills and disable-model-invocation
  skills/install/route.ts         POST install skills through npx skills add
  skills/search/route.ts          GET/POST skills.sh search
  worktrees/route.ts              GET/POST/DELETE git worktrees
  channels/route.ts               GET channels w/ joined+memberCount | POST create (memberIds 初始成员)
  channels/[id]/route.ts          GET single channel
  channels/[id]/messages/route.ts GET ?targetId&before&limit — seq 游标分页（channel/thread 共用）
  channels/[id]/join/route.ts     POST { memberId? } — 公开自由加入；私有须 Owner
  channels/[id]/leave/route.ts    POST { memberId? } — `#all` 不可离开
  channels/[id]/archive/route.ts  POST { archived } — Owner only，冻结写入
  channels/[id]/members/route.ts  GET member list
  messages/route.ts               POST { targetId, content, baseSeq?, quoteId? } — freshness-hold（409 held）
  messages/[id]/route.ts          GET single message w/ author
  messages/[id]/thread/route.ts   GET thread（锚点归一化）
  members/route.ts                GET agent 列表 | POST 创建 agent（name/description/workspacePath）
  members/[id]/route.ts           GET 单个 agent | DELETE 删除身份（§3.6，soft-delete）
  members/[id]/workspace/route.ts POST { workspacePath } — 更换绑定目录（换目录即换会话）
  members/[id]/restart/route.ts   POST Restart（沿用 session 重启运行时）
  members/[id]/session-reset/route.ts POST 清会话上下文（workspace 保留）
  members/[id]/full-reset/route.ts   POST 会话 + workspace 内容全清
  members/events/route.ts         GET SSE — 状态点快照流（§3.6 四态）
  members/[id]/inbox/route.ts     GET ?targetId= — drain + ack（§5.7 inbox；无 targetId 时 drain 全部待处理 channel）
  tasks/route.ts                  POST { messageId } 转任务 | { channelId, content } 发消息并建任务
  tasks/[id]/claim/route.ts       POST { baseSeq? } — claim；409 held / 409 conflict（失败让路）
  tasks/[id]/update-status/route.ts POST { status, baseSeq? } — 状态机转移；409 held
  channels/[id]/tasks/route.ts    GET 任务板（按 number 升序，UI 侧按状态分组）

lib/raft/                         raft 服务层（app/api 仅薄封装）
  channels.ts                     create/join/leave/archive/members + CURRENT_MEMBER_ID（恒为 owner）
  messages.ts                     sendMessage（freshness + thread 校验 + quote + 提交后发 wake）/ listMessages / getThreadInfo
                                  / summarizeChanges（held 摘要，任务 claim/updateStatus 复用）
  tasks.ts                        createTask（顶层消息可转，thread 内不可，number 按 channel 递增）/ claimTask
                                  / updateTaskStatus（状态机 + 互审授权 + freshness-hold）/ listChannelTasks / getTaskView
  inbox.ts                        inbox 服务层：getSince / drain（不推进游标）/ ack / drainAndAck / getPendingTargets
                                  / listRelatedTasks / resolveTargetChannel（§5.5 本地实现形态）
  members.ts                      listAgents/createAgent/updateAgentWorkspace/setAgentStatus/deleteAgent
                                  （workspace 绑定唯一性校验；删除 = soft-delete）
  db-singleton.ts                 globalThis.__workspliceDb 单例（schema 版本号兜底重建，扛热重载）

lib/agent-loop/                  agent-loop（§5.4 驱动层）
  wake.ts                         wake hint（只含 agentId/targetId/seq/reason，不含正文）；notifyMessageWakes
                                  （channel agent 成员除作者 + 未加入被 @mention 的穿透）；@mention 解析；
                                  §3.7 任务延续自醒：任务 owner 的回复落任务线程且任务 in_progress → 自醒续工
  loop.ts                         runAgentRound（wake→drain→decide→act→reply→ack）；结构化回复协议
                                  {"action":"reply"|"ignore","content":...,"onConflict":"revise"|"resend"|"silent"|"anyway",
                                  "task":{"number":N,"op":"claim"|"complete"|"unclaim"}}
                                  + buildReplyPrompt / buildRevisionPrompt / parseAgentAction / deliverWithFreshness
                                  + runTaskOperation（先 claim 再开工，失败让路 → "yielded"；complete → in_review）
  backfill.ts                     崩溃恢复按 seq 补拉：扫描 session jsonl 找回缺失的 assistant 回复按序补写（§5.3）
  driver.ts                       wake → 逐 agent 串行队列；同 (agent,target) hint 合并；busy 时 settle 后重试
  index.ts                        startAgentLoop()（instrumentation 调用：状态扫掠 + 补拉 + 驱动，幂等）

lib/data/                         raft SQLite 数据层（better-sqlite3，同步 API）
  db.ts                           RaftStore：表 CRUD + maxSeq/freshness 原语 + seq 游标分页
  schema.ts                       schema v3（members.deleted soft-delete 列 + ALTER 迁移）+ 消息不可变触发器 + FTS5
  dirs.ts                         ~/.worksplice 数据目录解析（WORKSPLICE_DATA_DIR 覆盖）

lib/
  agent-status.ts     状态点事实来源：现场推导（存活 wrapper）/ DB 回落 + publish 广播 + 低频扫掠
  agent-runtime.ts    AgentRuntime 接缝（fake 可注入）+ 真实实现（惰性 import rpc-manager/SDK）+ deriveLiveAgentStatus
  agent-lifecycle.ts  Restart / Session reset / Full reset / 换 workspace / 删除身份（fs + 运行时 + DB 编排）
  agent-client.ts     typed fetch helper for /api/agent commands
  draft-store.ts       local draft persistence helpers
  file-access.ts       allowed file roots for /api/files and worktrees
  file-paths.ts        client/server path encoding helpers
  markdown.ts          shared markdown helpers
  npx.ts               npx runner used by skill install
  pi-types.ts          local structural types for pi SDK objects
  rpc-manager.ts      AgentSessionWrapper + registry + startRpcSession
  session-reader.ts   SessionManager wrappers + path cache + buildSessionContext adapter
  tool-presets.ts     PRESET_NONE/DEFAULT/FULL + getPresetFromTools()
  types.ts            shared TypeScript types
  normalize.ts        normalizeToolCalls() — field name mismatch between file format and our types
  worktree.ts         project/worktree resolution and git worktree operations

components/
  AppShell.tsx           三栏骨架 + URL hash 深链（#c/<channelId>?m=<messageId>）+ 弹窗编排
  WorkspaceSidebar.tsx   channel 列表 + agent 成员列表（状态点）
  ChannelView.tsx        channel 消息流：seq 分页 / thread 侧栏 / 引用 / 复制链接 / join-leave-archive
                          / 右键菜单（Open Thread + Convert to Task）/ As Task 勾选 / TaskBoard（§3.7）
  CreateChannelModal.tsx 建 channel（公开/私有/描述/初始成员）
  CreateAgentModal.tsx   建 agent
  AgentDetailPanel.tsx   agent 详情面板（占位，ticket 05）
  BrutalModal.tsx        马卡龙 × brutalist 模态框外壳
  PixelAvatar.tsx        8×8 像素头像（seed 确定性）
  StatusDot.tsx          状态点四态（绿/黄脉冲/橙/灰）
  ChatInput.tsx          pi-web 遗留 chat 输入条（agent 会话用，保留复用）
  MessageView.tsx        pi-web 遗留会话消息渲染（agent 会话用，保留复用）
  MarkdownBody.tsx       markdown 渲染器（channel 消息复用）
  ModelsConfig.tsx       modal for editing models.json (opened from sidebar bottom)
  PluginsConfig.tsx      modal for installed package plugins
  SkillsConfig.tsx       modal for loaded/search/installable skills
  FileExplorer.tsx       file tree inside sidebar
  FileIcons.tsx          file icon helpers
  FileViewer.tsx         file content in a tab

hooks/
  useAgentSession.ts  messages + streaming + SSE + fork/navigate/reconciliation logic
  useAudio.ts         completion sound + browser AudioContext unlock
  useDragDrop.ts      shared drag/drop state
  useIsMobile.ts      responsive breakpoint hook
  useTheme.ts         theme state
```

---

## Key Design Decisions & Traps

### AgentSession lifecycle (`lib/rpc-manager.ts`)
- One `AgentSessionWrapper` per session id, keyed in `globalThis.__workspliceSessions`
- `globalThis` survives Next.js hot-reload; plain module-level Map does not
- Idle timeout: 10 minutes. Concurrent `startRpcSession()` calls share a single start Promise (`globalThis.__piStartLocks`)

### Fork must destroy the wrapper immediately
`AgentSession.fork()` **mutates the wrapper's inner state in-place** — after fork, `inner.sessionId` is the *new* session's id. If the wrapper stays alive in the registry under the old id, the next request gets the already-forked state and subsequent forks produce a corrupt `parentSession` chain.

**Fix**: `send("fork")` captures `newSessionId`, then calls `this.destroy()` before returning. The next request for the original session reloads a clean AgentSession from the original file.

### Two kinds of branching — don't confuse them
- **Fork** (Fork button on user message): creates a new independent `.jsonl` file. Shown as a child in the sidebar tree via `parentSession` header field.
- **In-session branch** (Continue button / BranchNavigator): calls `navigate_tree` within the same file. Multiple entries share the same `parentId`. Switching between them calls `/api/sessions/[id]/context?leafId=`.

### Session files can be fully rewritten
`parentSession` in the header is **display metadata only** — has zero effect on chat content. Safe to `writeFileSync` the entire file (pi does this itself during migrations). Used when cascade-reparenting children on delete.

### ToolCall field normalization
Pi stores toolCall blocks as `{type:"toolCall", id, name, arguments}` but `ToolCallContent` uses `{toolCallId, toolName, input}`. `normalizeToolCalls()` in `lib/normalize.ts` handles this — called in both `session-reader.ts` (file load) and `ChatWindow.handleAgentEvent()` (streaming).

### New session tool preset
Tool names are passed at session creation (`POST /api/agent/new` → `toolNames[]`). For existing sessions, the active preset is inferred on mount via `get_tools` → `getPresetFromTools()`. When tools are fully disabled (`toolNames = []`), `rpc-manager.ts` passes an empty tool allow-list and forces `agent.state.systemPrompt = ""` after startup/reload/resource discovery.

### Model defaults for new sessions
`GET /api/models` returns `defaultModel` read from `~/.pi/agent/settings.json`. `ChatWindow` pre-selects this on mount for new sessions. Explicit browser model/thinking selections are applied atomically during AgentSession construction, then `lib/startup-preferences.ts` persists their effective values without replaying `set_model`/`set_thinking_level`; implicit `enabledModels` fallbacks and thinking pins are not persisted.

### `enabledModels` scoping
The `enabledModels` setting uses pi's `--models` syntax: minimatch globs against `provider/modelId` or a bare `modelId`, fuzzy matching for non-glob patterns, and an optional `:thinkingLevel` suffix. Never compare those patterns as literal strings — `lib/model-scope.ts` delegates to the SDK's `resolveModelScopeWithDiagnostics()` so worksplice and the TUI agree on the visible model list, and falls back to all available models when patterns resolve to nothing. `startRpcSession()` resolves that scope before creating an AgentSession and passes the selected initial model, thinking pin, and SDK-native `scopedModels` atomically; `GET /api/models` reuses the helper only for selector data, `thinkingLevelPins`, and `modelScopeWarnings` display.

### SSE reconnect on page refresh mid-stream
On `ChatWindow` mount, `GET /api/agent/[id]` is called. If `state.isStreaming === true`, SSE is reconnected automatically. `thinkingLevel` and `isCompacting` are also synced from this response.

### Compaction SSE events
Newer pi emits `compaction_start` / `compaction_end`; older versions emitted `auto_compaction_start` / `auto_compaction_end`. `handleAgentEvent` accepts both sets to keep `isCompacting` in sync. Manual compact is a blocking POST — the button stays disabled until the response returns.

### Running state polling + reconciliation
- The sidebar polls `/api/agent/running` every 2.5 seconds while the tab is visible and pauses polling in background tabs. The session-list response remains the initial fallback.
- `useAgentSession` treats per-session SSE as primary for chat events and opens it before each prompt. `prompt_done` completes the current UI stage and notification immediately, but the idle SSE stays open for a 30-second grace window and is reused by the next prompt. `agent_start` cancels that close timer; `agent_settled` finishes extension-injected runs that have no wrapper-level `prompt_done` and starts a fresh grace window. Do not close on the first `agent_end`: retries, compaction, and extension-queued messages can continue the same logical prompt.
- While a run is active, `useAgentSession` periodically calls `GET /api/agent/[id]` and also reconciles on `visibilitychange`/`online`. This fixes missed terminal events from background tabs or half-open connections.
- Prompt runs use a monotonic run id; late SSE or slow reconciliation responses from an old run must be ignored so they cannot resurrect stale streaming bubbles.

### Worktrees and project grouping
- `lib/worktree.ts` resolves linked worktree top-levels back to the main repo `projectRoot`; `listAllSessions()` attaches that to each `SessionInfo` so all worktrees for one repo are grouped together in the sidebar.
- Worktree operations are served by `/api/worktrees` and guarded by the same allowed-root rules as `/api/files`.
- New worktrees are created under `<repoRoot>-worktrees/<sanitized-branch>`. Existing branches are reused; otherwise `git worktree add -b` creates the branch.
- Removing a dirty worktree returns `409` with `{ dirty: true }` so the UI can ask before retrying with `force`.
- Sessions whose cwd points at a removed worktree are inferred back into the main project instead of becoming a phantom project row.

### File access allow-list
- `/api/files` is intentionally not a general filesystem browser. Allowed roots come from session cwds, their resolved project roots, `~/pi-cwd-*`, and roots explicitly added with `allowFileRoot()`.
- `/api/cwd/validate`, `/api/default-cwd`, and `/api/worktrees` call `allowFileRoot()` when they make a new location browsable.

### Plugins and skills
- `/api/plugins` uses pi's `SettingsManager` + `DefaultPackageManager` for global/project package install, remove, update, enable, and disable. Disabling writes empty `extensions/skills/prompts/themes` arrays for that package entry.
- `/api/skills` uses `DefaultResourceLoader` so settings paths, package skills, and project `.agents/skills` are listed the same way the runtime sees them.
- Skill toggling edits only the `disable-model-invocation` frontmatter key on the target `SKILL.md`; keep that surgical so user formatting survives.
- `/api/skills/install` shells through `npx skills add ... --agent pi`; project installs run with the selected cwd.

### Auth and model config
- `ModelsConfig` combines models from `~/.pi/agent/models.json` with provider auth status from pi's `AuthStorage`/`ModelRegistry`.
- Provider listing is capability-driven, never id-driven: `lib/provider-listing.ts` decides membership from `auth.apiKey.login` / `auth.oauth` plus the stored credential type, so dual-auth providers (anthropic and github-copilot today — which providers declare both changes between SDK releases, so never assume it from an id) appear exactly once and never fall through both lists (#309). `lib/provider-listing-runtime.ts` adapts `ModelRuntime` to those pure helpers.
- auth.json holds **one** credential per provider and `ModelRuntime.logout()` deletes whichever it is. The delete routes therefore use `removeStoredCredentialIfType()` to compare and delete under the same file lock used by pi's auth storage. `ModelsConfig` also refreshes *both* provider lists after any auth change — refreshing one leaves a dual-auth provider rendered twice.
- OAuth/device-code/manual-code flows are streamed by `GET /api/auth/login/[provider]`; manual code responses POST back with a short-lived token stored in `globalThis.__piLoginCallbacks`.
- API-key routes store and remove keys through `AuthStorage`. Status endpoints must never return the raw key.
- The model test route is `app/api/models-config/test/route.ts`; `app/api/models/test/` is not a real route.

### Completion sound
- `hooks/useAudio.ts` stores the toggle in `localStorage` as `pi-sound-enabled` and reuses one `AudioContext`.
- Browser autoplay policy means sound must be unlocked from a user gesture; `ChatInput` calls the unlock hook from interactive controls, and `ChatWindow` plays the tone from `onAgentEnd`.

### Exported session HTML
- `/api/sessions/[id]/export` delegates to pi's export helper, then patches recursive tree helpers in the generated HTML to iterative versions so very deep linear sessions do not overflow the browser call stack.

### Raft message domain (`lib/raft/`)
- **服务层 = 唯一事实来源**：`lib/raft/channels.ts` / `messages.ts` 直接操作 SQLite（`db-singleton`），API route 仅薄封装；join/leave/archive 的权限规则、freshness-hold、thread 不可嵌套都在服务层强制，route 层不重复实现。
- **Target 归一化**（§6.1）：消息 `target_id` 单列——命中 `channels` 即 channel，否则是 thread 锚点消息 id；`resolveTarget` 拒绝 thread 消息作为新 target（不可嵌套）。thread 读接口（`getThreadInfo`）会把 thread 内消息归一化回锚点。
- **Freshness-hold**（§6.3）：`sendMessage` 带 `baseSeq`（客户端最新 `maxSeq`），事务内比对 `maxSeq(targetId)`，不等返回 `{ held, roomSeq, whatHappened }`，route 层 409；UI 收 held 后重新拉取并提示，agent 的四选一流程属 ticket 06。
- **权限面**：写消息要求作者是 channel 成员（thread 回复继承 channel 规则）；私有 channel 加入/移除成员、归档都仅 Owner（`CURRENT_MEMBER_ID` = `"owner"`，人类恒为 Owner）；`#all` 不可离开；新 agent 创建时自动加入 `#all`（seed 也会在迁移时补齐既有成员）。
- **引用 = 物化**：消息不可编辑，quote 以块引用文本（`> **#seq author**\n> preview`）拼进发送内容，不留结构化引用。
- **UI 单一引用态**：`ChannelView` 的 `quoting` 是组件级单一状态，channel 与 thread 两个 Composer 共享——两个 Composer 各持自己的 `targetId`，`handleSend` 按 target 决定 baseSeq 来源（channel → `maxSeq`，thread → 该线程最后一条 seq）。
- **agent 回复轮询**：`ChannelView` 3s 一次轮询最新页增量合并（`mergeIncomingMessages` 按 id 去重 + seq 排序），后台 tab 暂停——agent-loop 的回复自然落入消息流（§5.4 demo）。

### Agent 成员与生命周期（ticket 05，§3.6）
- **身份 vs 会话**：agent 是持久身份（members 行），会话是 pi session（`pi_session_file` 回填）。三种重置粒度只动会话/workspace，身份与绑定保持；**删除 = soft-delete**（`members.deleted=1`，schema v3 ALTER 迁移）——行保留以承载不可变消息的外键与作者渲染，但移出全部 channel、任务 owner 置空、消费游标清空、workspace 目录整体删除。
- **workspace 唯一性**：`agentWorkspaceByAnother` 按归一化绝对路径拒绝同一目录绑定多个 agent；session 启动时 `hasBusyRpcSessionForCwd`（realpath 语义）拒绝同一 cwd 并发活跃会话（`BusyCwdError` → route 409）。
- **状态点 = 现场推导 + DB 回落**（`lib/agent-status.ts`）：`statusLookup` 有存活 wrapper 时推导（running → working / idle 且 DB 非 error → online），wrapper 不在时 DB error 保留、其余回落 offline；低频扫掠（10s）兜底 idle shutdown 的漂移。`prompt_error` 事件写 error 且不会被 idle 推导覆盖，直到下次 `agent_start` 或重启。lookup/listeners/snapshot 全部挂在 globalThis（热重载安全）；agent-runtime 用 `__workspliceAgentSessions` 按成员 id 记账 wrapper，**不按 cwd 猜归属**——同一 cwd 上的人类/他 agent 会话不会张冠李戴。
- **生命周期接缝**：`AgentRuntime` 接口（start/destroy/find/removeSessionFilesForCwd）由 `lib/agent-runtime.ts` 实现，**惰性 import rpc-manager/SDK**（`getAgentRuntime()` 才拉起），测试注入 fake 即可单测 `agent-lifecycle`——node 的 TS strip 模式无法解析 rpc-manager 的 parameter properties，绝不能静态 import 它。
- **换目录即换会话**：`changeAgentWorkspace` 先校验新路径（坏路径不伤旧会话）→ 销毁旧 cwd 的会话 → 改绑定并清空 `pi_session_file`；Restart 按同一 session 文件重启（上下文保留）。**Session reset / Full reset 会删掉该 cwd 下全部 session 文件**（`removeSessionFilesForCwd`），保证按需重建时是全新会话而不是复活旧上下文。
- **`db-singleton` 版本守卫**：`openDataDb` 记录打开时的 `SCHEMA_VERSION` 到 `__workspliceDbOpenedVersion`，`getDb()` 比对版本，热重载后 RaftStore 类已变时重建实例——避免拿到旧原型的 `setMemberPiSessionFile` 等新方法缺失报错；测试直连（`globalThis.__workspliceDb = openDataDb(tmp)`）同样经过 openDataDb，不会被误重建或误开 `~/.worksplice/raft.db`。

### agent-loop（ticket 06，§3.8/§5.3–5.5）
- **拉取式 inbox，不推送正文**：`consumed_seqs(agent_id, target_id, seq)` 是持久化游标；`drain` 不推进游标（重复 drain 不重不漏），`ack` 由 loop 每轮收口；HTTP 语义（`GET /api/members/[id]/inbox`）是 drain + ack 一步到位。wake hint 只含 `{agentId, targetId, seq, reason}`，正文由 agent 自己 drain。
- **wake 触发面**：`sendMessage` 提交成功后（事务外）调 `notifyMessageWakes`——目标 channel 的 agent 成员（不含作者）全唤醒，未加入 channel 但被 `@mention` 的 agent 穿透送达；thread 消息以锚点消息 id 为目标。回滚的 held 不会误唤醒。
- **一轮的结构化协议**：`runAgentRound` = drain（过滤自己的消息）→ 检查"最新消息是本人的回复"则只 ack 不重复应答（崩溃窗口自愈）→ 起会话 → 发 prompt（`buildReplyPrompt`：channel 语境 + `#seq @author` 消息 + 相关任务状态 + JSON 指示 + 房间标记）→ `parseAgentAction` 解析 `{"action":"reply"|"ignore","content","onConflict"}` → 回复经 `sendMessage` 带 baseSeq 走 freshness → ack 推进游标。非 JSON 回复整段作为内容，默认 revise。**ack 语义**：ack 到 agent 本轮实际读到/被告知的房间版本（`deliverWithFreshness` 返回 ackSeq，held 后随 roomSeq 推进），避免游标停在旧 baseSeq 导致 target 永久 pending。
- **freshness-hold 四选一**（`deliverWithFreshness`）：held 后按 agent 声明的 onConflict 执行——revise（`buildRevisionPrompt` 携带期间新消息正文重读重写，最多 2 次）/ resend（携带新 roomSeq 原样重试，最多 3 次）/ silent（静默放弃）/ anyway（不带 baseSeq 显式绕过，连续 hold 的逃逸口）；重试耗尽归入 silent。发送器可注入（`send` 参数，测试脚本化用）。
- **崩溃恢复补拉**（`backfill.ts`）：loop 的 prompt 末尾带房间标记 `[worksplice:target=<id> seq=<N>]` 落进 session jsonl 的 user 条目（revise prompt 额外带 `[worksplice:revision]`）；启动时（`startAgentLoop`，instrumentation 调用）扫描各 agent 的 session jsonl——**每个标记轮只保留最后一条 assistant 文本**（revise 草稿/工具中间产物被下一轮 prompt 丢弃），回复内容按 `parseAgentAction` 解析（JSON 取 content，ignore 不落库），缺失于 SQLite 的按序补写（同 target 同作者同内容去重）；**游标推进到每个标记轮的标记 seq**（标记存在即证明该轮 prompt 已进入上下文——即使回复已存在也推进，覆盖"崩溃于补写后 ack 前"窗口）。**不回放 wake**（补写直接落库）。wake 由 driver 订阅；`__workspliceWakeListeners` 挂 globalThis。
- **driver 编排**：每 agent 一个 FIFO 队列，同 (agent, target) hint 合并；busy（会话运行中）时挂一次 settle 监听（agent_end/agent_settled/prompt_done）后重试，不丢 hint；状态挂 `__workspliceAgentLoopDriver`。loop 只依赖 `LoopRuntime` 结构子集（findSession/startSession），测试注入 fake，**不静态 import rpc-manager**。
- **状态点**：loop 在 prompt 前后 publish working/online（与 wrapper 的 agent_start/agent_end 事件双保险）；会话错误 publish error 且不推进游标（下次 wake 重试）。

### 任务板（ticket 07，§3.7/§5.7 tasks 路由组）
- **task = 消息 + 元数据**（`lib/raft/tasks.ts`）：`tasks` 表锚定 `message_id`（UNIQUE）；创建三途径——右键菜单 Convert to Task / 发送时勾 As Task / Tasks tab Create Task，全部收敛到 `createTask({messageId})`（board 创建先 `sendMessage` 再转）；**thread 内消息不可转**（锚点 target 必须是 channel）、消息不可重复转（`TaskAlreadyExistsError` → 409）。`number` 按 channel 内递增（join messages 算 max+1），跨 channel 各自从 #1 起。
- **状态机只走合法转移**（`TRANSITIONS` 表，服务层强制）：`todo ─claim→ in_progress ─complete→ in_review ─approve→ done`；`unclaim/reject` 回退（in_progress→todo、in_review→in_progress，owner 保留）；in_progress/in_review ─close→ closed；`done/closed ─reopen→ todo`（**reopen/unclaim 清 owner 回池**）。claim 只认未认领任务（`owner_id IS NULL`）；**互审"构建者不验证"**：approve/reject 必须由非 owner 的 channel 成员执行，owner 完成置 in_review 后由另一 agent 或人批准。
- **并发保护**（§6.3 同消息语义）：claim/updateStatus 携带 `baseSeq` = channel `max(seq)`，事务内比对不等返回 held（`summarizeChanges` 摘要复用）；claim 已认领返回 conflict（route 409）。UI 收 held 后刷新并提示。
- **自动认领（agent-loop）**：协议扩展 `"task":{"number":N,"op":"claim"|"complete"|"unclaim"}`（`parseAgentAction` 向后兼容，无 task 字段行为不变）；`runTaskOperation` 先 `claimTask` 再开工——**held/conflict/非 owner → 让路**（`RoundStatus "yielded"`，不回复、channel 游标只推进到已读版本，更新的消息经 wake 重试重读）。回复投递到**任务线程**（anchor 消息 target，thread 自己的 seq/freshness 空间）；complete 的回复先落线程再置 in_review（状态更新 held 按 roomSeq 重试 ≤3 次，失败不吞回复）。
- **任务延续自醒**（wake.ts）：任务 owner 的回复落任务线程且任务仍 in_progress → 自醒续工；`runAgentRound` 的 drain 对"全是我自己的消息但我在该线程有 in_progress 任务"不再 noop/skip（`ownsInProgressTaskAt`），而是以自身进度为语境续工或 complete。**游标收口**：channel 游标每轮推进；线程游标在任务离开 in_progress（complete/unclaim）时才推进，进行中留口供续工轮 drain 到自己的进度。
- **板视图**：`GET /api/channels/[id]/tasks` 按 number 升序；UI 按状态分组（todo→in_progress→in_review→done→closed），卡片显示 #number/首行预览/owner/状态 + 按身份与状态出动作（Claim / Complete / Unclaim / Close / Approve / Reject / Reopen）；点卡片打开任务 thread（进展只在线程里，board 只显示状态）。

## Pi Session File Format

Location: `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"zenmux","modelId":"claude-sonnet-4-6","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],...}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":N}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`entryIds[]` in `SessionContext` is a parallel array to `messages[]` — maps each displayed message back to its `.jsonl` entry id, used for fork and navigate_tree calls.

---

## CSS Variables (`app/globals.css`)

```
--bg --bg-panel --bg-hover --bg-selected --border
--text --text-muted --text-dim
--accent --user-bg --tool-bg
--font-mono
```
