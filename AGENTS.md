# worksplice - Development Notes

## 
使用中文进行交流。
## Quick Start

```bash
npm run dev   # port 30142
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
  messages/route.ts               POST { targetId, content, baseSeq?, quoteId? } — freshness-hold（409 held）；
                                  multipart 形态：字段 + `files`（附件随消息一次原子提交，§3.5）
  messages/[id]/route.ts          GET single message w/ author
  messages/[id]/thread/route.ts   GET thread（锚点归一化）
  messages/[id]/reactions/route.ts GET 聚合 | POST { emoji } 切换（§3.4 toggle，无通知）
  attachments/[id]/route.ts       GET 附件下载/预览（图片 inline，其余 attachment；文件实体在 ~/.worksplice/attachments/）
  channels/[id]/pinned/route.ts   GET ?sort=manual|recent|az（当前成员个性化 pinned）| POST { messageId } pin | DELETE ?messageId= unpin
  channels/[id]/pinned/reorder/route.ts POST { order: [messageId...] } — Manual 排序重排
  members/route.ts                GET agent 列表（附 home_path）| POST 创建 agent（name/description/provider/modelId/thinkingLevel 必选，家目录自动生成）
  members/[id]/route.ts           GET 单个 agent | DELETE 删除身份（§3.6，soft-delete）
  members/[id]/workspace/route.ts POST { workspacePath } — 更换绑定目录（换目录即换会话）
  members/[id]/restart/route.ts   POST Restart（沿用 session 重启运行时）
  members/[id]/session-reset/route.ts POST 清会话上下文（workspace 保留）
  members/[id]/full-reset/route.ts   POST 会话 + workspace 内容全清
  members/events/route.ts         GET SSE — 状态点快照流（§3.6 四态）
  members/[id]/inbox/route.ts     GET ?targetId= — drain + ack（§5.7 inbox；无 targetId 时 drain 全部待处理 channel）
  members/[id]/observability/route.ts GET — 可观测性（§3.6/§6.5）：状态点 + session jsonl 只读统计 + 任务历史/时间线 + 会话导出信息
  members/[id]/runtime/route.ts   GET/PATCH — per-agent 模型/provider/thinking（§3.10，覆盖全局默认；存活会话立即应用）
  tasks/route.ts                  POST { messageId } 转任务 | { channelId, content } 发消息并建任务
  tasks/[id]/claim/route.ts       POST { baseSeq? } — claim；409 held / 409 conflict（失败让路）
  tasks/[id]/update-status/route.ts POST { status, baseSeq? } — 状态机转移；409 held
  channels/[id]/tasks/route.ts    GET 任务板（按 number 升序，UI 侧按状态分组；每任务附 reachable 拖拽落点，ADR-0002）
  reminders/route.ts              GET ?authorId=&targetId= 列表 | POST { title, fireAt, recurrence?, targetId?, authorId? }
                                  （authorId 仅 Owner 可替 agent 设，§3.9 唤醒作者本人）
  reminders/[id]/route.ts         PATCH update（title/fireAt/recurrence/targetId）| GET 单条
  reminders/[id]/snooze/route.ts  POST { minutes?=15 } — fire_at = max(now, fire_at) + minutes
  reminders/[id]/cancel/route.ts  POST cancel（仅 scheduled → canceled，cron 不再触发）
  reminders/[id]/log/route.ts     GET 生命周期事件流（schedule/fire/reschedule/snooze/update/cancel/error）
  search/route.ts                 GET ?q=&limit= — FTS5 全文搜索（结果 = id + 命中上下文摘要 + 归属 channel/thread + 作者）
  secretary/init/route.ts         POST 启动助手入口（spec-bootstrap-agent §6.3）：薄封装 initSecretaryFlow（§6.2 五步初始化），
                                  provider/modelId/thinkingLevel 可选（缺省继承全局默认）

lib/raft/                         raft 服务层（app/api 仅薄封装）
  channels.ts                     create/join/leave/archive/members + mute/unmute/getChannelMute（§3.2 mute）
                                  + CURRENT_MEMBER_ID（恒为 owner）
  messages.ts                     sendMessage（freshness + thread 校验 + quote + 附件落盘 + 提交后发 wake）
                                  / listMessages / getThreadInfo / messageWithAuthor（附 reactions+attachments）
                                  / summarizeChanges（held 摘要，任务 claim/updateStatus 复用）
  reactions.ts                    §3.4 toggleReaction（存在即删，UNIQUE 先查后写；channel 成员才可点，无通知）
                                  / listReactionSummaries（count 降序 + memberIds）
  pinned.ts                       §3.5 个性化 pinned：pinMessage（order=max+1，幂等）/ unpinMessage / listPinned
                                  （sort=manual|recent|az）/ setPinnedOrder；消息须属于该 channel（thread 经锚点）
  attachments.ts                  §3.5 附件：MAX_ATTACHMENT_BYTES=50MB / stageAttachmentFiles（随机名落盘 attachments/）
                                  / discardAttachmentFiles（held/抛错清理）/ getAttachmentRow
  tasks.ts                        createTask（顶层消息可转，thread 内不可，number 按 channel 递增）/ claimTask
                                  （重开封锁：reopened 下仅 Owner 认领接管）/ updateTaskStatus（状态机 + 互审授权
                                  + freshness-hold + reopen 置 reopened 标记）/ listChannelTasks / getTaskView
  inbox.ts                        inbox 服务层：getSince / drain（不推进游标）/ ack / drainAndAck / getPendingTargets
                                  （§3.2 mute 过滤：静音后普通消息不进 inbox、@mention 穿透）/ listRelatedTasks
                                  / resolveTargetChannel（§5.5 本地实现形态）
  members.ts                      listAgents/createAgent/updateAgentWorkspace/setAgentStatus/deleteAgent
                                  （workspace 绑定唯一性校验；删除 = soft-delete）
  reminders.ts                    schedule/list/snooze/update/cancel/log/fireDueReminders（§3.9/§5.6）
                                  fire 投递系统消息（wake:false）+ 定向唤醒作者（agent → emitWake reason=reminder）
  search.ts                       §6.4 搜索服务层：searchMessages（trigram FTS 双路径 + LIKE 兜底；结果附 channel/author/inThread）
  search.ts                       §6.4 搜索服务层：searchMessages（trigram FTS 双路径 + LIKE 兜底；结果附 channel/author/inThread）
  observability.ts                §6.5 任务历史服务层：listAgentTasks（owner/锚点作者/thread 进展参与判定）+ buildAgentTimeline（消息 + 任务状态点时间线）
  recurrence.ts                   recurrence DSL 纯解析器：every:Nm/Nh/Nd / daily@HH:MM / weekly:mon,fri@HH:MM
                                  + nextFireAt（严格晚于 from，时区安全，delay 语义）
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
                                  + reason="reminder" 时"只有自己的消息"不 noop/skip（§3.9 自提醒可见）
                                  + §3.2 mention 穿透：非成员被 @mention 推进本轮，回复公开 channel 时自行加入
  backfill.ts                     崩溃恢复按 seq 补拉：扫描 session jsonl 找回缺失的 assistant 回复按序补写（§5.3）
  driver.ts                       wake → 逐 agent 串行队列；同 (agent,target) hint 合并（保留首个 reason）；
                                  busy 时 settle 后重试
  reminder-cron.ts                §5.6 逐分钟 cron：tickReminderCron 扫描 scheduled 且 fire_at<=now → fireDueReminders
  index.ts                        startAgentLoop()（instrumentation 调用：状态扫掠 + 补拉 + 驱动 + cron，幂等）

lib/data/                         raft SQLite 数据层（better-sqlite3，同步 API）
  db.ts                           RaftStore：表 CRUD + maxSeq/freshness 原语 + seq 游标分页
  schema.ts                       schema v4（reminder_logs 事件表；members.deleted 为 v3 ALTER 迁移）+ 消息不可变触发器 + FTS5
  dirs.ts                         ~/.worksplice 数据目录解析（WORKSPLICE_DATA_DIR 覆盖）

lib/
  agent-status.ts     状态点事实来源：现场推导（存活 wrapper）/ DB 回落 + publish 广播 + 低频扫掠
  agent-runtime.ts    AgentRuntime 接缝（fake 可注入）+ 真实实现（惰性 import rpc-manager/SDK）+ deriveLiveAgentStatus
                      + startSession 应用 per-agent 模型覆盖（§3.10）
  agent-lifecycle.ts  Restart / Session reset / Full reset（仅家目录）/ 换 workspace / 删除身份（只 rm 家目录，fs + 运行时 + DB 编排）
  agent-client.ts     typed fetch helper for /api/agent commands
  draft-store.ts       local draft persistence helpers
  file-access.ts       allowed file roots for /api/files and worktrees
  file-paths.ts        client/server path encoding helpers
  markdown.ts          shared markdown helpers
  npx.ts               npx runner used by skill install
  panel-state.ts       ticket 13 面板转移纯模块：openPanel（单槽替换）/ closePanel / onChannelSwitched（清空）
                       + memberPanel（mention → 面板映射）+ subscribePinnedChanged/notifyPinnedChanged（面板↔中央 pinned 双端收敛）
  pi-types.ts          local structural types for pi SDK objects
  rpc-manager.ts      AgentSessionWrapper + registry + startRpcSession
  session-reader.ts   SessionManager wrappers + path cache + buildSessionContext adapter
  session-stats.ts    §6.5 session jsonl 只读解析（token/cost/compaction，与 SDK getSessionStats 同口径，不落库）
                      + listAgentSessionFiles（pi_session_file 精确 + workspace cwd 下全部会话）+ aggregateAgentUsage
  tool-presets.ts     PRESET_NONE/DEFAULT/FULL + getPresetFromTools()
  types.ts            shared TypeScript types
  normalize.ts        normalizeToolCalls() — field name mismatch between file format and our types
  worktree.ts         project/worktree resolution and git worktree operations

components/
  AppShell.tsx           三栏骨架 + URL hash 深链（#c/<channelId>?m=<messageId>）+ 弹窗编排；
                         ticket 13：中央（centerSelection）与右栏面板（panelContent）状态解耦——点 agent/人类/线程只在右栏展示，中央频道不动；
                         切换频道清空面板；右栏非长驻（无选中整栏消失）
  WorkspaceSidebar.tsx   channel 列表 + agent 成员列表（状态点）；只高亮频道行，agent 行点击 = 打开右栏面板
  ChannelView.tsx        channel 消息流：seq 分页 / 引用 / 复制链接 / join-leave-archive
                          / 右键菜单（Open Thread + Convert to Task）/ As Task 勾选 / TaskViews（§3.7 List|Board 切换，ADR-0002）
                          / 提醒入口（header ⏰ + 消息动作栏 ⏰，§5.6）
                          / reaction（快捷栏 + 选择器 + 聚合条，§3.4）/ pinned 区（header `Pin` 展开，sort 三选一 + 重排，§3.5）
                          / 附件（Composer `Paperclip` + 消息内预览/下载，§3.5）
                          / 线程经 onOpenPanel 在右栏打开（ticket 13 起不再内嵌侧栏）
  DetailPanel.tsx        右栏单槽容器：按 kind 分派 agent → AgentDetailPanel / human → 薄资料卡 / thread → ThreadPanel（ticket 13）
  ThreadPanel.tsx        右栏线程面板：锚点 + 消息 + composer + 面板局部引用 + 3s 轮询（THREAD_POLL_MS，后台 tab 暂停）
                         freshness baseSeq 按线程自己的 seq 空间；pin/unpin 经 notifyPinnedChanged 通知中央刷新
  CreateChannelModal.tsx 建 channel（公开/私有/描述/初始成员）
  CreateAgentModal.tsx   建 agent
  ReminderModal.tsx      提醒设置/管理弹窗（target 锚定 + 唤醒谁 + recurrence 预设 + snooze/cancel）
  MyRemindersModal.tsx   全局提醒面板（全部提醒列表 + snooze/cancel + 定位跳转，15s 轮询）
  AgentDetailPanel.tsx   agent 详情面板：状态/workspace/runtime（§3.10 ModelPicker 覆盖全局默认）/可观测性（§6.5 统计+任务历史+时间线+导出）/重置
  BrutalModal.tsx        马卡龙 × brutalist 模态框外壳
  PixelAvatar.tsx        8×8 像素头像（seed 确定性）
  StatusDot.tsx          状态点四态（绿/黄脉冲/橙/灰）
  ChatInput.tsx          pi-web 遗留 chat 输入条（agent 会话用，保留复用）
  MessageView.tsx        pi-web 遗留会话消息渲染（agent 会话用，保留复用）
  MarkdownBody.tsx       markdown 渲染器（channel 消息复用）
  ModelsConfig.tsx       modal for editing models.json (opened from sidebar bottom)
  ModelPicker.tsx        模型/思考级别选择器（§3.10 runtime 区复用；provider 分组 + 过滤 + 继承全局默认）
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

### UI 图标规则（lucide 优先）
- 除反应数据（`QUICK_REACTIONS` / `REACTION_GRID` / 已存 reaction 的渲染——持久化用户内容）外，UI 一律使用 lucide icon，**禁止新增 emoji**；同一字符可能同时是数据与装饰（如 📌 既是反应选项也是 pin 头部按钮），替换按出现处编辑，禁止全局 replaceAll。

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
- **服务层 = 唯一事实来源**：`lib/raft/channels.ts` / `messages.ts` 直接操作 SQLite（`db-singleton`），API route 仅薄封装；join/leave/archive/mute 的权限规则、freshness-hold、thread 不可嵌套都在服务层强制，route 层不重复实现。
- **Target 归一化**（§6.1）：消息 `target_id` 单列——命中 `channels` 即 channel，否则是 thread 锚点消息 id；`resolveTarget` 拒绝 thread 消息作为新 target（不可嵌套）。thread 读接口（`getThreadInfo`）会把 thread 内消息归一化回锚点。
- **Freshness-hold**（§6.3）：`sendMessage` 带 `baseSeq`（客户端最新 `maxSeq`），事务内比对 `maxSeq(targetId)`，不等返回 `{ held, roomSeq, whatHappened }`，route 层 409；UI 收 held 后重新拉取并提示，agent 的四选一流程属 ticket 06。
- **权限面**：写消息要求作者是 channel 成员（thread 回复继承 channel 规则）；私有 channel 加入/移除成员、归档都仅 Owner（`CURRENT_MEMBER_ID` = `"owner"`，人类恒为 Owner）；`#all` 不可离开；新 agent 创建时自动加入 `#all`（seed 也会在迁移时补齐既有成员）。
- **引用 = 物化**：消息不可编辑，quote 以块引用文本（`> **#seq author**\n> preview`）拼进发送内容，不留结构化引用。
- **UI 单一引用态**：`ChannelView` 的 `quoting` 是组件级单一状态，channel composer 独享（ticket 13 线程迁出右栏后引用态变面板局部——`ThreadPanel` 自持 quoting，channel 与 thread 引用互不污染）；`handleSend` 按 target 决定 baseSeq 来源（channel → `maxSeq`，thread → 该线程最后一条 seq）。
- **agent 回复轮询**：`ChannelView` 3s 一次轮询最新页增量合并（`mergeIncomingMessages` 按 id 去重 + seq 排序），后台 tab 暂停——agent-loop 的回复自然落入消息流（§5.4 demo）。右栏线程面板（`ThreadPanel`）另有同纪律 3s 轮询（`THREAD_POLL_MS`），任务线程回复自动冒出，与中央轮询并存为两套循环。

### Agent 成员与生命周期（ticket 05，§3.6）
- **身份 vs 会话**：agent 是持久身份（members 行），会话是 pi session（`pi_session_file` 回填）。三种重置粒度只动会话/工作区，身份与绑定保持；**删除 = soft-delete**（`members.deleted=1`，schema v3 ALTER 迁移）——行保留以承载不可变消息的外键与作者渲染，但移出全部 channel、任务 owner 置空、消费游标清空。
- **目录两分（ADR-0001）**：创建 agent 自动生成唯一**家目录** `<dataDir>/agents/<slug>-<id8>`（slug = 名字小写化 sanitize，空回退 `agent`）并预置 MEMORY.md 固定大纲（角色描述/当前工作/工作流程/Skill 使用/工具使用/其他，正文可空、缺失不补种、Full reset 保留）；**项目目录**可显式绑定且**允许多 agent 共享**（无绑定唯一性），但服务层拒绝把其他 agent 的家目录绑成项目目录（`homeDirOfAnotherAgent`）。工作区 = 单槽 `workspace_path ?? 家目录`。**删除身份只 rm 家目录**（`isOwnHome` 判定，绑共享项目目录时绝不 rm）；**Full reset 只作用于家目录**（项目目录 → 400 拒绝）。创建契约：POST /api/members 必选 provider/modelId/thinkingLevel（预选全局默认），不传目录。
- **运行串行**：session 启动时 `hasBusyRpcSessionForCwd`（realpath 语义）拒绝同一 cwd 并发活跃会话（`BusyCwdError` → route 409）——共享目录协作是串行的，真并行走 worktree（不同 cwd）。
- **共享 cwd 的 session 文件精确作用**：`resolveLatestSessionFile` 跳过被其他成员 `pi_session_file` 引用的文件（避免继承他人上下文）；`removeSessionFilesForCwd` 只删无任何成员引用的文件（调用方先清本成员引用）。
- **状态点 = 现场推导 + DB 回落**（`lib/agent-status.ts`）：`statusLookup` 有存活 wrapper 时推导（running → working / idle 且 DB 非 error → online），wrapper 不在时 DB error 保留、其余回落 offline；低频扫掠（10s）兜底 idle shutdown 的漂移。`prompt_error` 事件写 error 且不会被 idle 推导覆盖，直到下次 `agent_start` 或重启。lookup/listeners/snapshot 全部挂在 globalThis（热重载安全）；agent-runtime 用 `__workspliceAgentSessions` 按成员 id 记账 wrapper，**不按 cwd 猜归属**——同一 cwd 上的人类/他 agent 会话不会张冠李戴。
- **生命周期接缝**：`AgentRuntime` 接口（start/destroy/find/removeSessionFilesForCwd）由 `lib/agent-runtime.ts` 实现，**惰性 import rpc-manager/SDK**（`getAgentRuntime()` 才拉起），测试注入 fake 即可单测 `agent-lifecycle`——node 的 TS strip 模式无法解析 rpc-manager 的 parameter properties，绝不能静态 import 它。
- **换目录即换会话**：`changeAgentWorkspace` 先校验新路径（坏路径不伤旧会话；拒绑他人家目录）→ 销毁旧 cwd 的会话 → 改绑定并清空 `pi_session_file`；Restart 按同一 session 文件重启（上下文保留）。**Session reset / Full reset 删掉该 cwd 下无成员引用的 session 文件**（`removeSessionFilesForCwd`），保证按需重建时是全新会话而不是复活旧上下文；共享项目目录下他 agent 的文件保留。
- **`db-singleton` 版本守卫**：`openDataDb` 记录打开时的 `SCHEMA_VERSION` 到 `__workspliceDbOpenedVersion`，`getDb()` 比对版本，热重载后 RaftStore 类已变时重建实例——避免拿到旧原型的 `setMemberPiSessionFile` 等新方法缺失报错；测试直连（`globalThis.__workspliceDb = openDataDb(tmp)`）同样经过 openDataDb，不会被误重建或误开 `~/.worksplice/raft.db`。

### agent-loop（ticket 06，§3.8/§5.3–5.5）
- **拉取式 inbox，不推送正文**：`consumed_seqs(agent_id, target_id, seq)` 是持久化游标；`drain` 不推进游标（重复 drain 不重不漏），`ack` 由 loop 每轮收口；HTTP 语义（`GET /api/members/[id]/inbox`）是 drain + ack 一步到位。wake hint 只含 `{agentId, targetId, seq, reason}`，正文由 agent 自己 drain。
- **wake 触发面**：`sendMessage` 提交成功后（事务外）调 `notifyMessageWakes`——目标 channel 的 agent 成员（不含作者）全唤醒（§3.2 静音成员除外，不因普通消息唤醒），未加入 channel 但被 `@mention` 的 agent 穿透送达；thread 消息以锚点消息 id 为目标。回滚的 held 不会误唤醒。
- **mute（ticket 12，§3.2/§3.8）**：channel 级静音 = `channel_mutes` 表（PK channel+member）记录静音时刻的 `mute_from_seq`（channel max(seq)）与 `mute_rowid`（全表 max(messages.rowid)）。drain/getPendingTargets 过滤：静音后的普通消息不进 inbox，个人 @mention 仍穿透；channel 消息按 seq 比，thread 消息无 channel seq 可比（thread 自己的 seq 空间）按 rowid 比（全局插入序，避免同毫秒 created_at 歧义）。静音前的消息照常投递；取消 mute 后不补投静音期间被压制的消息（游标已推进）。`GET/POST /api/channels/[id]/mute`（Owner 可替任意 agent 设）；ChannelView 头部 `BellOff` 面板逐个 agent 开关。
- **一轮的结构化协议**：`runAgentRound` = drain（过滤自己的消息）→ 检查"最新消息是本人的回复"则只 ack 不重复应答（崩溃窗口自愈）→ 起会话 → 发 prompt（`buildReplyPrompt`：channel 语境 + `#seq @author` 消息 + 相关任务状态 + JSON 指示 + 房间标记）→ `parseAgentAction` 解析 `{"action":"reply"|"ignore","content","onConflict"}` → 回复经 `sendMessage` 带 baseSeq 走 freshness → ack 推进游标。非 JSON 回复整段作为内容，默认 revise。**ack 语义**：ack 到 agent 本轮实际读到/被告知的房间版本（`deliverWithFreshness` 返回 ackSeq，held 后随 roomSeq 推进），避免游标停在旧 baseSeq 导致 target 永久 pending。
- **freshness-hold 四选一**（`deliverWithFreshness`）：held 后按 agent 声明的 onConflict 执行——revise（`buildRevisionPrompt` 携带期间新消息正文重读重写，最多 2 次）/ resend（携带新 roomSeq 原样重试，最多 3 次）/ silent（静默放弃）/ anyway（不带 baseSeq 显式绕过，连续 hold 的逃逸口）；重试耗尽归入 silent。发送器可注入（`send` 参数，测试脚本化用）。
- **崩溃恢复补拉**（`backfill.ts`）：loop 的 prompt 末尾带房间标记 `[worksplice:target=<id> seq=<N>]` 落进 session jsonl 的 user 条目（revise prompt 额外带 `[worksplice:revision]`）；启动时（`startAgentLoop`，instrumentation 调用）扫描各 agent 的 session jsonl——**每个标记轮只保留最后一条 assistant 文本**（revise 草稿/工具中间产物被下一轮 prompt 丢弃），回复内容按 `parseAgentAction` 解析（JSON 取 content，ignore 不落库），缺失于 SQLite 的按序补写（同 target 同作者同内容去重）；**游标推进到每个标记轮的标记 seq**（标记存在即证明该轮 prompt 已进入上下文——即使回复已存在也推进，覆盖"崩溃于补写后 ack 前"窗口）。**不回放 wake**（补写直接落库）。wake 由 driver 订阅；`__workspliceWakeListeners` 挂 globalThis。
- **driver 编排**：每 agent 一个 FIFO 队列，同 (agent, target) hint 合并；busy（会话运行中）时挂一次 settle 监听（agent_end/agent_settled/prompt_done）后重试，不丢 hint；状态挂 `__workspliceAgentLoopDriver`。loop 只依赖 `LoopRuntime` 结构子集（findSession/startSession），测试注入 fake，**不静态 import rpc-manager**。
- **⚠️ 热重载陷阱（改代码必须重启 dev server）**：wake 监听器（`__workspliceWakeListeners`）在 server 启动时由 `startAgentLoopDriver` 注册，`started` 守卫阻止热重载后重新订阅——**旧监听器闭包永久持有旧 `runAgentRound`/`parseAgentAction`**。改 agent-loop/driver/wake/backfill 等被 globalThis 闭包引用的模块后，热重载不生效，行为照旧（曾因 parseAgentAction 修复不生效，脏 JSON 消息继续落库数小时）。验证手段：查 `ps aux | grep next-server` 的启动时间是否晚于改动。同理，`getAgentRuntime()` 的 wrapper 记账与 session 启动路径同此约束。
- **状态点**：loop 在 prompt 前后 publish working/online（与 wrapper 的 agent_start/agent_end 事件双保险）；会话错误 publish error 且不推进游标（下次 wake 重试）。

### 任务板（ticket 07，§3.7/§5.7 tasks 路由组）
- **task = 消息 + 元数据**（`lib/raft/tasks.ts`）：`tasks` 表锚定 `message_id`（UNIQUE）；创建三途径——右键菜单 Convert to Task / 发送时勾 As Task / Tasks tab Create Task，全部收敛到 `createTask({messageId})`（board 创建先 `sendMessage` 再转）；**thread 内消息不可转**（锚点 target 必须是 channel）、消息不可重复转（`TaskAlreadyExistsError` → 409）。`number` 按 channel 内递增（join messages 算 max+1），跨 channel 各自从 #1 起。
- **状态机只走合法转移**（`TRANSITIONS` 表，服务层强制）：`todo ─claim→ in_progress ─complete→ in_review ─approve→ done`；`unclaim/reject` 回退（in_progress→todo、in_review→in_progress，owner 保留）；in_progress/in_review ─close→ closed；`done/closed ─reopen→ todo`（**reopen/unclaim 清 owner 回池**）。claim 只认未认领任务（`owner_id IS NULL`）；**互审"构建者不验证"**：approve/reject 必须由非 owner 的 channel 成员执行，owner 完成置 in_review 后由另一 agent 或人批准。
- **重开封锁**（schema v8 `tasks.reopened` 列）：reopen 置标记回池——**agent-loop 不可自动认领**（`claimTask` 返回 `blocked` → route 409 / loop yielded "task reopened — awaiting the owner"），仅人类（`CURRENT_MEMBER_ID`）可认领接管并**清标**；人类 unclaim 后任务恢复 agent 可认领，再次重开再次封锁。unclaim/reject 不置标。向前生效，存量不追溯。`TaskView`/`listRelatedTasks` 带出标记：UI 任务板显示"重开"徽标、`buildReplyPrompt` 标注 "REOPENED … do not claim" 让模型不发起 claim。
- **并发保护**（§6.3 同消息语义）：claim/updateStatus 携带 `baseSeq` = channel `max(seq)`，事务内比对不等返回 held（`summarizeChanges` 摘要复用）；claim 已认领返回 conflict（route 409）。UI 收 held 后刷新并提示。
- **自动认领（agent-loop）**：协议扩展 `"task":{"number":N,"op":"claim"|"complete"|"unclaim"}`（`parseAgentAction` 向后兼容，无 task 字段行为不变）；`runTaskOperation` 先 `claimTask` 再开工——**held/conflict/非 owner → 让路**（`RoundStatus "yielded"`，不回复、channel 游标只推进到已读版本，更新的消息经 wake 重试重读）。回复投递到**任务线程**（anchor 消息 target，thread 自己的 seq/freshness 空间）；complete 的回复先落线程再置 in_review（状态更新 held 按 roomSeq 重试 ≤3 次，失败不吞回复）。
- **任务延续自醒**（wake.ts）：任务 owner 的回复落任务线程且任务仍 in_progress → 自醒续工；`runAgentRound` 的 drain 对"全是我自己的消息但我在该线程有 in_progress 任务"不再 noop/skip（`ownsInProgressTaskAt`），而是以自身进度为语境续工或 complete。**游标收口**：channel 游标每轮推进；线程游标在任务离开 in_progress（complete/unclaim）时才推进，进行中留口供续工轮 drain 到自己的进度。
- **板视图**：`GET /api/channels/[id]/tasks` 按 number 升序、每任务附 `reachable`（ADR-0002：服务端按人类 owner 身份推导的合法转移落点，含 todo→in_progress 的 claim 边；客户端不镜像状态机表）；UI 侧 List|Board 两种任务视图（ADR-0002，localStorage 记忆，默认列表）——List 按状态分组（todo→in_progress→in_review→done→closed），Board 5 列 = 5 状态常显、跨列拖拽 = 请求一次状态转移（HTML5 DnD，**不做乐观移动**：松手等服务端确认，非法落点弹回+提示）；卡片显示 #number/首行预览/owner/状态 + 按身份与状态出动作（Claim / Complete / Unclaim / Close / Approve / Reject / Reopen，与拖拽同权）；点卡片打开任务 thread（进展只在线程里，视图只显示状态）。

### 提醒（ticket 08，§3.9/§5.6 reminders 路由组）
- **触发 = 系统消息 + 定向唤醒作者**：cron 到点 → `fireReminder` 以**作者署名**投递 `⏰ Reminder: <title>` 到**频道主流程**——channel 锚定投该 channel；消息锚定归一化后投其**归属 channel**（原设计投 thread 不可见，已修正为频道可见；正文附 `(anchored on #seq)` 锚点引用），`sendMessage({wake:false})` **不触发 channel 级 wake**（不惊动其他 agent）；随后仅当作者是 agent 才 `emitWake({reason:"reminder"})`（§3.9 唤醒作者本人；human 作者 = UI 轮询看到系统消息即通知）。
- **作者选择 = 唤醒谁**：POST 默认 author = Owner；Owner 可替 agent 设（authorId = 某 agent，仅 Owner 权限，§3.6）——演示路径"给 agent 设 every:1m → 系统消息 + agent 被唤醒"靠这个闭环。ReminderModal 的"唤醒谁"下拉列出 channel 内 agent。
- **自提醒可被 agent 看到**：系统消息以作者署名 → agent 自己设的提醒在 drain 里"全是自己的消息"，普通轮次会 noop/skip；`runAgentRound` 增加 reason 参数（driver 队列按 hint 合并保留首个 reason），`reason==="reminder"` 时"只有自己的消息"与"最新是本人消息"两条跳过都不生效，agent 以自身提醒为语境决定行动（loop 测试 reminded 用例）。
- **recurrence DSL**（`lib/raft/recurrence.ts` 纯模块）：`every:Nm/Nh/Nd`（delay 语义，服务端算绝对时间）/ `daily@HH:MM` / `weekly:mon,fri@HH:MM`（大小写不敏感、未知星期名整体拒绝）；`nextFireAt` **严格晚于 from**（等值视为已到点）——否则 reschedule 会立即重触发死循环；daily/weekly 用本地时区 Date 构造（时区安全）。
- **幂等与收口**：fire 全程同步（无 await，单进程内不交错）；状态迁移 + log 在一个事务里，重复 tick/重复 fire 返回 not_due 不重复投递。**消息投递失败（作者已退出 channel 等）→ 记 error log 并收口 fired**（不无限重试），不 wake。
- **生命周期 log**：schema v4 新增 `reminder_logs` 表（事件 schedule/fire/reschedule/snooze/update/cancel/error）；列表按 rowid 排序（同毫秒 created_at 的时序保真）；fire 事件先于 reschedule 写入（时间序）。
- **管理权限**：snooze/update/cancel 仅作者本人或 Owner 可操作，且仅 `scheduled`（fired/canceled 报错）；snooze = `max(now, fire_at) + minutes`（默认 15）。
- **UI**：channel 头部 ⏰（目标 = channel，joined 才显示）+ 消息动作栏 ⏰（目标 = 该消息/thread 锚点，标题预填首行预览）；ReminderModal 内可创建（datetime-local + recurrence 预设 chips）、列出锚定提醒、snooze/cancel；到点系统消息经 3s 轮询落入消息流。**全局「我的提醒」入口**（侧栏底部 ⏰ 按钮，带待触发计数角标，15s 轮询）→ MyRemindersModal 列出**全部**提醒（ReminderView 附 channelId/channelName/anchorSeq，跨 target 可见），可 snooze/cancel/定位（深链 `#c/<channelId>[?m=<id>]` 跳转）。锚点消息行显示**线程回复角标**（`threadReplyCount` 批量查询，点击展开线程）——消息锚定提醒触发后可从角标发现 thread 内进展。

### 消息增强（ticket 09，§3.3–3.5 reactions/pinned/attachments）
- **reaction = 先查后写 toggle**（`lib/raft/reactions.ts`）：存在即删、不存在即加，UNIQUE(message_id, member_id, emoji) 单进程串行无竞争；**channel 成员才可点**（thread 消息经 `message.target_id` 锚点解析归属 channel，不可嵌套读侧同语义）；无通知/不进 inbox（§3.4）。聚合 = count 降序 + memberIds（UI 用 `includes(currentMemberId)` 判定"我点过"）。
- **pinned 个性化**（`lib/raft/pinned.ts`）：每成员每 channel 独立 pinned 区；`pinMessage` order = max+1（幂等返回既有行）、`unpinMessage` 幂等 false；**消息须属于该 channel**（thread 消息经锚点归一化，跨 channel 拒绝）；sort=manual（order 升序）/recent（pinned_at 降序，同毫秒按 order 兜底）/az（内容 localeCompare）。`setPinnedOrder` 只重排已 pin 行。
- **附件随消息原子提交**（§3.5）：`sendMessage` 增加 `attachments[]`（≤50MB）——先 `stageAttachmentFiles`（校验 + **随机文件名**落盘 `attachments/`，原始名只存库），事务内 appendMessage + insertAttachment 同生共死，**held/抛错 → `discardAttachmentFiles` 清理**，不留孤儿。文件下载走 `/api/attachments/[id]`（图片 inline 预览，其余 attachment）。
- **messageWithAuthor 统一附料**：reactions（聚合）+ attachments（行）直接内嵌进消息 payload，UI 免 N+1 请求；thread 读接口/agent-loop 双写流同享（纯增量字段，向后兼容）。
- **POST /api/messages 双形态**：JSON（原样）或 multipart（字段 + `files[]`）；单文件 >50MB 由服务层 `stageAttachmentFiles` 校验拒绝（客户端预检兜底）。`formatBytes`/`MAX_ATTACHMENT_BYTES` 在 `lib/preview.ts`（client 可安全导入，**不**从 raft 服务层引——那会拖 better-sqlite3 进浏览器包）。
- **UI**：消息 hover 快捷 reaction（👍❤️🎉👀）+ ＋ 选择器（24 常用 emoji 网格）+ 内容下聚合条（已点高亮黄）；动作栏 `Pin`（pinned 态黄底）channel/thread 消息通吃；Composer `Paperclip` 多选 + 文件 chips（≤50MB 前端预检）；channel 头部 `Pin` 展开 pinned 区（sort 三选一 + Manual ↑/↓ 重排 + 点击定位消息/展开线程）。

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
