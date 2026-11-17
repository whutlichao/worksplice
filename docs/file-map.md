# File Map

> 从根目录 `AGENTS.md` 搬出的完整文件地图；内容按原文保留，供定位路由、服务层与模块时查阅。

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
  pi-env/status/route.ts          GET 两档结论 { agentDir, finding, reason | null }（issue #226 薄封装：
                                  判定层 lib/pi-env-status.ts、探测 lib/pi-env-probe.ts；不缓存不落库）
  pi-env/init/route.ts            POST 初始化 ~/.pi/agent 骨架 { agentDir, created[] }（幂等 / 不覆盖 /
                                  不装 CLI；目标目录固定取 getAgentDir()，经 HTTP 指定目录一律 400；
                                  权限 ⇒ 403、路径形态冲突 ⇒ 409、其余 ⇒ 500，正文可读）
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
  channels/[id]/read/route.ts     POST — BAI-6 未读角标：推进 Owner 已读游标到当前 max(seq)，清除角标
  lib/domain/collab/reads.ts       BAI-6 未读角标服务层：unreadCount / markChannelRead / listChannelsWithUnread
  channels/[id]/archive/route.ts  POST { archived } — Owner only，冻结写入
  channels/[id]/stop/route.ts     POST — Owner 停当前房间波次（只调 stopTurn；不销毁会话/
                                  不写消费游标/不 ack 任务事件；DM 403、不存在 404）
  channels/[id]/chief/route.ts    POST { memberId | null } — 设 / 换 / 清空频道首席（#250 薄封装：
                                  ChannelChiefError 的 status + code；Owner only，目标须是本频道未软删
                                  agent 成员）；回 chiefMemberId + 生效首席 + chiefSource
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
  global-chief/route.ts           POST { memberId | null } — 设 / 换 / 清空全局首席（#251 薄封装：
                                  GlobalChiefError 的 status + code，与频道首席同一组成员类码；
                                  回 { chief }）

lib/domain/collab/                协作服务层（app/api 仅薄封装；唯一导入面）
  index.ts                      协作域唯一对外导入面：`export *` 汇合全部子模块（channels/members/
                                messages/tasks/inbox/wake/…），消费方只 `from "@/lib/domain/collab"` 一条
                                import；`getDb()` 不在此面（归 lib/data/db-singleton.ts）。子模块内部
                                互相用相对路径直引，不经索引回环（测试在一个 seam mock 整个 协作域）；
                                `index.test.mjs` **动态发现**子模块（目录里的 `*.ts`，排除测试与自身）并与
                                `export *` 清单**双向比对**——清单不再手抄，新模块不会静默不设防。
  channels.ts                     create/join/leave/archive/members + mute/unmute/getChannelMute（§3.2 mute）
                                  + CURRENT_MEMBER_ID（恒为 owner）
  chief.ts                        首席身份的唯一解析口（#248–#252）：getGlobalChief / setGlobalChief
                                  （GlobalChiefError）/ resolveEffectiveChief（频道 → 全局 → 无）
                                  / isEffectiveChiefForChannel（只回答某成员是否是该频道此刻的生效首席）
                                  / isChiefOfAnyChannel（只回答是否有未归档频道的频道首席身份；
                                  不缓存、不重走回落链，也不把全局回落算进这一档）
                                  / setChannelChief（ChannelChiefError）/ canRouteToChief（对本频道是否
                                  可达：成员 + 未静音，选人 · wake · 频道行共用）/ chiefRefOf（ChiefRef）
  secretary-identity.ts           秘书身份判定源（#248 起是角色判定）：isSecretaryMember = 是不是当前
                                  全局首席；isTaskStatusAuthority = 人类 Owner 或当前全局首席（#295 任务
                                  状态写权唯一入口）；getReachableGlobalChief = 全局首席对本频道可达性
                                  的唯一解析口；SUSAN_MEMBER_NAME 只是引导期默认名（不参与判定）
  task-reference.ts               「正文提到了哪些任务」的共享纯判定（parseTaskReferenceNumbers /
                                  hasTaskReference）：handoff 触发与选人共用，断开 handoff-trigger ← invitations
                                  的反向依赖；引用块 / 代码块里的 Task #N 不算
  handoff-trigger.ts              消息触发的任务分流判定（#240 / #270）：selectSecretaryHandoffTask
                                  （#295 授权 = 当前全局首席；创建事件 / 任务锚点 / 任务线程 / 唯一引用；
                                  多任务 / 无关联 / 已分流 / 有 owner / reopened / 非 todo 不选）+
                                  isHandoffEligibleTask；频道首席保留默认收件人，不再参与任务 handoff
  handoff.ts                      handoff 写路径：handoffTask（授权 = 当前全局首席；
                                  候选排除 / 事务内直接改 owner / freshness / blocked / 提交后定向唤醒 chosen）+
                                  listHandoffCandidates / recoverHandoffWakes；成功通知写明实际执行者
  rounds.ts                       §07 轮次结果服务层：logRoundOutcome / listRoundLogs（camelCase 出线
                                  RoundLogView）+ v19 `role`（这一轮怎么进来的：chief / 点名 / 任务 / 提醒 / DM）
  messages.ts                     sendMessage（freshness + thread 校验 + quote + 附件落盘 + 提交后发 wake）
                                  / listMessages / getThreadInfo / messageWithAuthor（附 reactions+attachments）
                                  / getMessage（**轻量读取**：不联表、不抛错；存在性判断用它，展示面仍走 messageWithAuthor）
                                  / summarizeChanges（held 摘要，任务 claim/updateStatus 复用）
  event-messages.ts               Owner 署名事件（任务创建 / 入群 / 建频道 / 欢迎）+ actor 署名系统动作；
                                  notifyTaskCompletionRequest（#295）：非权威完成请求事件（幂等 requestKey、
                                  roomNotice:true + wake:false）并只定向唤醒当前全局首席（reason=task-status）
  reactions.ts                    §3.4 toggleReaction（存在即删，UNIQUE 先查后写；channel 成员才可点，无通知）
                                  / listReactionSummaries（count 降序 + memberIds）
  pinned.ts                       §3.5 个性化 pinned：pinMessage（order=max+1，幂等）/ unpinMessage / listPinned
                                  （sort=manual|recent|az）/ setPinnedOrder；消息须属于该 channel（thread 经锚点）
  attachments.ts                  §3.5 附件：MAX_ATTACHMENT_BYTES=50MB / stageAttachmentFiles（随机名落盘 attachments/）
                                  / discardAttachmentFiles（held/抛错清理）/ getAttachmentRow
  tasks.ts                        createTask（顶层消息可转，thread 内不可，number 按 channel 递增）/ claimTask
                                  （#295：仅人类 Owner / 当前全局首席；重开封锁由同一权威接管）/
                                  updateTaskStatus（状态机 + isTaskStatusAuthority + freshness-hold +
                                  reopen 置 reopened 标记）/ reachableStatuses（非权威为空）/
                                  listChannelTasks(actorId) / getTaskView(actorId)（视图按调用者权威给出 reachable）
  inbox.ts                        inbox 服务层：getSince / drain（不推进游标）/ ack / drainAndAck / getPendingTargets
                                  （§3.2 mute 过滤：静音后普通消息不进 inbox、@mention 穿透）/ listRelatedTasks
                                  / resolveTargetChannel（§5.5 本地实现形态）
  members.ts                      listAgents/createAgent/updateAgentWorkspace/setAgentStatus/deleteAgent
                                  （workspace 绑定唯一性校验；删除 = soft-delete）
  reminders.ts                    schedule/list/snooze/update/cancel/log/fireDueReminders（§3.9/§5.6）
                                  fire 投递系统消息（wake:false）+ 定向唤醒作者（agent → emitWake reason=reminder）
  invitations.ts                  模型调用前邀请判定（#237）：selectMessageInvitations（人类正文点名 / @all；
                                  引用块 / 代码块 / 行内代码不算；任务线程 owner 续工；reopened 清空候选）
                                  + parseTaskCreationEventNumber（创建事件正文唯一解析）
  member-capabilities.ts          成员能力表的两个面（ADR-0013 决策一 + 票 chief-capability-converge）：
                                  canMemberPerform = **开口面**（能不能做；默认拒绝、逐条开口）
                                  / memberOpConstraint = **约束面**（以什么形状做：createAgent 的名字正则 +
                                  每会话上限 + 不接受的模型字段；createChannel 的私有必含 actor + memberIds
                                  只收存活 agent）+ 四条判据函数（agentNameRejection / modelSelectionRejection /
                                  privateChannelActorRejection / memberIdRejection）——约束常量**只在这里定义一次**，
                                  ops 面执行器与首席 tools 判定层都从这里取值
  member-op-quota.ts              createAgent 的配额 store（跨路径共享的单一实例）：
                                  createMemberOpQuotaStore / getMemberOpQuotaStore（挂 `globalThis.
                                  __workspliceMemberOpQuota`）/ setMemberOpQuotaStore(null)（测试接缝）；
                                  键 = agentId + 会话标识；拿不到会话标识 ⇒ 退化为「该 agent 在本进程内至多 1 次」
                                  并记一条退化日志（fail-closed，绝不退化成「跳过配额」）
  admission.ts                    轮次准入纯判定（#237/#295）：decideRoundAdmission + ROUND_SKIP_REASONS
                                  （DM / reminder bypass；任务线程 owner / in_review / done / closed / reopened 矩阵；
                                  in_review 非 owner 在人类或任务 owner @ 时以 task-reviewer 准入，仍非 must-respond；
                                  reason=task-status 只对当前任务状态权威开放 in_progress 线程，角色 task-status-authority）
  patrol.ts                       任务巡检的**判定层**（票 #267）：纯函数、零 IO。三个阈值 + 7 天窗口的
                                  单一定义处（PATROL_UNCLAIMED_TODO_MS / PATROL_HANDOFF_BLOCKED_MS /
                                  PATROL_IN_REVIEW_MS / PATROL_WINDOW_MS）+ findPatrolFindings（时间与任务快照注入；
                                  卡住时长按任务行 updated_at、7 天窗口按锚点 created_at）
                                  + patrolSignatureOf（去重签名 = 任务+状态+详情，**不含时长**）
                                  + buildPatrolSummary（每轮最多一条消息的正文；空发现 null = 沉默）。
                                  可见面判定（哪条发现可上报）在接入层，不在这里：判定层只认任务行
  patrol-run.ts                   任务巡检的**接入层**（票 #267）：runPatrolOnce（读首席 / 频道范围 / 任务快照
                                  / 投递器全可注入；tick 与测试共用）+ isPatrolDisabled（WORKSPLICE_PATROL_DISABLED=1，
                                  现算不求值到常量）+ 进程内签名集（挂 `globalThis.__worksplicePatrolSignatures`，
                                  setPatrolSignatureStore(null) 是测试接缝）。落点：她作为生效首席的频道 →
                                  她所在的第一个**公开**频道（`isPublic`：joined ∧ 未归档 ∧ 非 DM 之外再按
                                  `type === "public"` 取；私有频道不参与兜底）→ 静默；**可见性过滤**
                                  （`visibleFindings`）：汇总只带落点自己的发现 + 公开频道的发现，其余私有
                                  频道的发现不上报；签名集只记可上报的发现；投递走 `wake:false` +
                                  `roomNotice:true`（系统事件，不占房间预算）
  room-budget.ts                  房间轮次预算（PR #218，设计记录 `.scratch/room-turn-budget/spec.md`）：
                                  createRoomTurnStore（场次状态机 / 选人水位线 / 迟到补充轮次）/ getRoomTurnStore
                                  （生产单例挂 `globalThis.__workspliceRoomTurns`）/ setRoomTurnStore(null)（测试接缝）
                                  + DEFAULT_ROOM_LIMITS（注入式上限）+ ROOM_PRIVATE_CHANNEL_MESSAGE /
                                  RoomPrivateChannelForbidden（I6 房间可见性）+ 直连链原语 advanceRequestHop /
                                  createDirectRequestBridge
  search.ts                       §6.4 搜索服务层：searchMessages（trigram FTS 双路径 + LIKE 兜底；结果附 channel/author/inThread）
  observability.ts                §6.5 任务历史服务层：listAgentTasks（owner/锚点作者/thread 进展参与判定）+ buildAgentTimeline（消息 + 任务状态点时间线）
  recurrence.ts                   recurrence DSL 纯解析器：every:Nm/Nh/Nd / daily@HH:MM / weekly:mon,fri@HH:MM
                                  + nextFireAt（严格晚于 from，时区安全，delay 语义）
  wake.ts                         wake 事件总线（§5.4/§5.5）：WakeHint（只含 agentId/targetId/seq/reason
                                  + 可选 recovery，不含正文）；
                                  subscribeWake/emitWake；notifyMessageWakes（#237：人类正文点名 / @all 候选；
                                  普通 agent @ 不穿透；DM 不变；开放任务创建事件 / 明确任务关联只定向
                                  getReachableGlobalChief 解析出的当前全局首席，一个事件最多一个收件人，
                                  不可达则静默）；§3.7 任务延续自醒；
                                  @mention 解析 re-export（协作服务层发，agent-loop 驱动订阅）

lib/agent-loop/                  agent-loop（§5.4 驱动层，Ticket 02 合并为单文件深模块）
  loop.ts                         深模块（round + driver + backfill + reminder-cron 全收编）：
                                  runAgentRound（wake→drain→decide→act→reply→ack）；结构化回复协议
                                  {"action":"reply"|"ignore","content":...,"onConflict":"revise"|"resend"|"silent"|"anyway",
                                  "task":{"number":N,"op":"claim"|"complete"|"unclaim"|"handoff"}}
                                  + buildReplyPrompt / buildRevisionPrompt / parseAgentAction / deliverWithFreshness
                                  + runTaskOperation（权威先 claim 再开工，失败让路 → "yielded"；权威 complete →
                                  in_review；非权威 complete → 完成请求事件 + task-status 唤醒全局首席）
                                  + handoff 授权 = 当前全局首席；`recipient.canHandoff` 只对当前全局首席为真，
                                  只控制「建完即派」提示
                                  + reason="reminder" 时"只有自己的消息"不 noop/skip（§3.9 自提醒可见）
                                  + §3.2 mention 穿透：非成员被**人类正文** @mention 推进本轮（#237），回复公开 channel 时自行加入
                                  + in_review 任务 owner（agent 成员）最新消息的 @：只放开 task-reviewer 准入，
                                  不进 must-respond；收束语 / 签退不算
                                  + driver 编排：wake → 逐 agent 串行队列；同 (agent,target) hint 合并
                                  （reason 取宽松侧：含 reminder 即按 reminder 处理）；
                                  busy 时 settle 后重试
                                  + backfill 崩溃恢复按 seq 补拉（§5.3）：扫描 session jsonl 找回缺失的
                                  assistant 回复按序补写
                                  + maintenance cron（§5.6 逐分钟）：tickReminderCron 扫描 scheduled 且
                                  fire_at<=now → fireDueReminders；同 tick 补发丢失的 handoff 定向唤醒
                                  （启动一次 + 每 60s；每 task/target 每进程最多 3 次，60s/120s 退避）；
                                  同一节拍还跑一次任务巡检（#267：runPatrolOnce，见 collab/patrol-run.ts）
                                  + 公共接口 createAgentLoop() → { start, stop, tick }（start 幂等组装
                                  状态扫掠 + 补拉 + 驱动 + cron；tick 手动推进 cron 扫描）
  injection-budget.ts              每轮注入预算（票 08）：ROUND_INJECTION_BUDGET_CHARS / INJECTION_MESSAGE_WINDOW
                                  / elasticBudget + projectMessages（保近期、裁远期）；
                                  消息 id 句柄的唯一字面来源 messageIdTag `(messageId <完整 id>)`
                                  （票 #266：轮次注入行行尾 + 搜索命中行同形，形状只此一处）；
                                  InjectableMessage.id 必填；截断只吃正文（行首句柄与行尾 id 是固定
                                  开销——被截掉的 id 会让模型永远调不对建任务工具）
  json-prologue.ts                回复 JSON 泄漏修复的四档判据唯一实现（prologue / raw-control / trailing-key /
                                  unescaped-quote）：parseAgentAction 与 scripts/fix-reply-json-leak.mjs 共用的 seam；
                                  零依赖纯函数，候选面（isLeakedReplyCandidate，含只报告不修的未闭合尾）
                                  与可修面（parseLeakedReply）分开；未转义双引号档只在能确定 content 边界
                                  （重新 parse 成协议对象）时采纳，只转义边界内引号与裸控制字符
  index.ts                        AgentLoop 公共 API 面（窄）：仅 re-export createAgentLoop / AgentLoop 类型；
                                  内部函数测试面直接从 ./loop.ts 导入
                                  （协作域 wake 总线见 lib/domain/collab/wake.ts：协作服务层发、本模块订阅）

lib/data/                         数据层（Ticket 03 Separate Data Layer：Store 契约 + SQLiteAdapter）
  store.ts                        `Store` 接口（数据契约；业务模块只依赖它，不 import 具体 adapter）
  types.ts                        共享类型（行类型/输入/枚举）+ 搜索纯函数（toFtsQuery/buildSearchSnippet）
  sqlite.ts                       `SQLiteAdapter implements Store`（better-sqlite3，同步 API）+ 工厂
                                  openSqliteAdapter/openDataDb；表 CRUD + maxSeq/freshness 原语 + seq 游标分页
  schema.ts                       schema v4（reminder_logs 事件表；members.deleted 为 v3 ALTER 迁移）+ 消息不可变触发器 + FTS5
  dirs.ts                         ~/.worksplice 数据目录解析（WORKSPLICE_DATA_DIR 覆盖）
  db-singleton.ts                 `getDb(): Store` 单例（globalThis.__workspliceDb，schema 版本号兜底重建，扛热重载）

lib/
  access-gate.ts       人类面准入闸判定层（ADR-0013 决策二）：自连接探针探非 loopback 网卡地址
                       → detectBindScope / getAccessPosture（open|password|closed）/ waitForServerListening /
                       accessGateClosedMessage；非 loopback + 无凭证 ⇒ fail-closed。
                       ⚠ 顶层 import node:net / node:os / node:timers/promises —— 别从 instrumentation.ts 静态引入，见陷阱段
  web-auth.ts          HTTP Basic Auth（username 恒为 `pi`）：isWebPasswordEnabled / isValidBasicAuthorization
                       （node:crypto 定长比较，同样受下条陷阱约束）
  access-gate-startup.ts
                       准入闸的**启动期**段（issue #101 从 instrumentation.ts 搬出）：waitForServerPort /
                       enforceAccessGateAtStartup（端口未知或未 listening 则留给请求门；closed 则
                       process.exit(1)）。只被 instrumentation 的 `await import()` 引用——
                       这就是它不在 edge 静态图里的原因；回归测试 lib/access-gate-startup.test.mjs。
  agent-status.ts     状态点事实来源：现场推导（存活 wrapper）/ DB 回落 + publish 广播 + 低频扫掠
  journey-state.ts     Tasks badge 未完成计数（纯函数）：todo + in_progress + in_review 计入，done / closed 不计
  modal-focus.ts      模态焦点陷阱的判定层（纯函数 + DOM 读取分层）：isTabbable / focusableWithin /
                        nextTabTarget（边界回绕、子浮层让路）+ collectTabbables；BrutalModal 是唯一消费方
                        （行为面由浏览器实测 + lib/modal-focus.test.mjs 守）
  agent-runtime.ts    AgentRuntime 接缝（fake 可注入）+ 真实实现（惰性 import lib/rpc/SDK）+ deriveLiveAgentStatus
                      + startSession 应用 per-agent 模型覆盖（§3.10）+ 计算 chiefScope（global / channel /
                      none）并据此传 domainTools.surface + 工具面策略（#272）
  agent-lifecycle.ts  Restart / Session reset / Full reset（仅家目录）/ 换 workspace / 删除身份（只 rm 家目录，fs + 运行时 + DB 编排）
  agent-recovery.ts   出错状态点恢复服务层（深模块）：saveAgentRuntime = [应用存活会话命令 → 持久化覆盖 → 触发判定
                      → per-agent FIFO 探测 → 发布前置两条 → 结论]；判定与映射为纯函数（shouldProbeOnRuntimeSave /
                      probeVerdictStatus / shouldPublishProbeVerdict）；SDK 经 AgentRuntime 接缝 + 可注入 probe 进入
  model-probe.ts      模型探测内核：凭证判据 + 最小调用（maxTokens 16 / maxRetries 0 / 20s / 同一份 prompt）+ 结论映射；
                      与模型配置面板共用同一份常量与结论语义；不碰状态、不碰 DB、不建会话
  pi-env-status.ts    pi 配置根两档故障的**判定层**（issue #226，纯逻辑：零 React / 零 Next / 零 SDK）：
                      P1 未初始化（目录缺失 / 不可读 / settings 读抛错 / settings 读出为空 ∧ settings.json
                      从未写过）+ P2 无可用凭证（模型面读不出一项带凭证可用的模型）+ 优先级（P1 成立即返回，
                      **一次都不探模型面**）+ readPiEnvStatus 现算一次；探测经注入接口进来
  pi-env-probe.ts     判定层的真实探测接线：readdir/ENOENT 与 EACCES 分流、SettingsManager（projectTrusted:false，
                      只看全局面、错误取自 drainErrors）、ModelRuntime.create 后 getAvailable/hasConfiguredAuth
  pi-env-skeleton.ts  初始化动作：settings.json / models.json / auth.json（各 0600 空壳）+ sessions/，flag:"wx"
                      独占创建（已存在逐字节不动）+ 幂等 + 只碰目标目录 + 不 spawn / 不下载
  agent-client.ts     typed fetch helper for /api/agent commands
  draft-store.ts       local draft persistence helpers
  file-access.ts       allowed file roots for /api/files and worktrees
  file-paths.ts        client/server path encoding helpers
  markdown.ts          shared markdown helpers
  channel-list.ts      频道列表合并纯函数（AppShell.load）：mergeChannelRows 复用未变更行的对象引用
                       + shallowEqualChannel（含 chief / chiefSource / chiefAvailable：结论变了行就换新引用）
  chief-failure.ts     首席写入失败码 → i18n key 的唯一映射（client-safe）：chiefFailureText /
                       isChiefFailureCode；频道设置与建频道弹窗共用，不再前缀猜码
  chief-tools/         首席领域工具（票 chief-tools / chief-task-create / chief-capability-converge，薄壳 + 判定层）：
                       decisions.ts = 判定层（参数校验 / 可见面 / 读面摘要 / 事件文案，纯函数，运行时只依赖
                       lib/preview.ts 与能力表 member-capabilities.ts）；约束常量与配额**都不再住在这里**（名字正则与
                       配额文案是能力表的别名，计数走 member-op-quota 的单例）；tools.ts = 扩展工厂薄壳（六个
                       `worksplice_*` 工具经 `extensionFactories` 按 surface 注册：global 六个、channel 只
                       `worksplice_task_create` 且 `defaultActive:true`；五个读 / 管理员写面每次调用复判
                       `isSecretaryMember`，task_create 复判「消息所属频道的生效首席」；拿 `actorId` +
                       `sessionKey` + `surface` 三样身份）
  member-tool-policy.ts 成员会话的工具面策略判定层（零依赖）：CHIEF_DOMAIN_TOOL_NAMES / CHIEF_TOOL_NAMES
                       （global = `read` + 六个领域工具）/ CHANNEL_CHIEF_TOOL_NAMES（channel 只
                       `worksplice_task_create`）与 resolveMemberToolPolicy（global → 窄面；channel /
                       none → `{}` 不表态，频道首席普通工具面不收窄）
  secretary-name.ts    引导期默认秘书名字的唯一字面来源（零依赖、client-safe；数据层迁移常量 /
                       协作域身份名 / UI 启动助手判定都从这儿取）
  npx.ts               npx runner used by skill install
  panel-state.ts       ticket 13 面板转移纯模块：openPanel（单槽替换）/ closePanel / onChannelSwitched（清空）
                       + memberPanel（mention → 面板映射）
  pi-types.ts          local structural types for pi SDK objects
  rpc/                RPC 会话管理四模块 + 出口：session.ts（AgentSessionWrapper）/ registry.ts（RpcRegistry
                      注册表 + busy-cwd）/ caller.ts（RpcCaller.start = startRpcSession）/ events.ts（运行状态
                      订阅集合 + 快照去重广播）/ index.ts（公共 API 面 = 原 rpc-manager.ts 11 导出 + 4 个模块类）；
                      caller 把 domainTools.surface 原样传给 chiefToolsExtension
  session-reader.ts   SessionManager wrappers + path cache + buildSessionContext adapter
  session-stats.ts    §6.5 session jsonl 只读解析（token/cost/compaction，与 SDK getSessionStats 同口径，不落库）
                      + listAgentSessionFiles（pi_session_file 精确 + workspace cwd 下全部会话）+ aggregateAgentUsage
  tool-presets.ts     PRESET_NONE/DEFAULT/FULL + getPresetFromTools() + getToolNamesForPreset(preset, availableTools?) 子集过滤
  tool-path-guard.ts  路径守卫的判定层（ADR-0011）：allowedRootsFor / pathGuardScopeFor / isWithinAllowedRoots
                      + find·grep 搜索根判定；realpath + path.relative + fail-closed，零 SDK 依赖
  tool-path-guard-extension.ts
                      六个文件工具的同名覆盖定义（全部由 pi 的 factory 造，守卫只换 operations）
                      + `extensionFactories` 接缝外壳（与 forced-empty-system-prompt 同一条缝）
  bash-containment.ts 沙箱的判定层（ADR-0012）：平台适配（macOS sandbox-exec / Linux bwrap /
                      其余 fail-closed）+ 机制能否按端口过滤（`BashSandbox.canFilterPort`）、
                      allow-only profile 与 bwrap bind 清单（由允许根派生，与路径守卫同一份判定）、
                      worksplice 自身端口的推导（`resolveWorksplicePorts` 读 Next 写入的 `PORT`）
                      与按端口 deny、两个前提的合取（`gateBashSandbox`）、`WORKSPLICE_*` env 收口、
                      EPERM/exit 134 可读归因
  bash-containment-extension.ts
                      pi 侧装配：bash 同名覆盖定义（描述带允许根）＋ 工具面与 RPC 面共用的 sandboxed
                      operations（自建 spawn，镜像 pi 的进程监督语义）
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
                          / Messages|Tasks 保留 + Tasks 未完成 badge；高频动作（回复/引用/复制链接）常驻，
                          / reaction / pin / 提醒 / 转为任务收进消息 `···` 二级菜单
                          / 提醒入口（header ⏰ + 消息 `···` ⏰，§5.6）
                          / reaction（快捷栏 + 选择器 + 聚合条，§3.4）/ pinned 区（header `Pin` 展开，sort 三选一 + 重排，§3.5）
                          / 附件（Composer `Paperclip` + 消息内预览/下载，§3.5）
                          / 线程经 onOpenPanel 在右栏打开（ticket 13 起不再内嵌侧栏）
  DetailPanel.tsx        右栏单槽容器：按 kind 分派 agent → AgentDetailPanel / human → 薄资料卡 / thread → ThreadPanel（ticket 13）
  ThreadPanel.tsx        右栏线程面板：锚点 + 消息 + composer + 面板局部引用 + 3s 轮询（THREAD_POLL_MS，后台 tab 暂停）
                         freshness baseSeq 按线程自己的 seq 空间；动作栏收窄为 表情 / 引用 / 复制链接 / ⏰（仅锚点），无 Reply / Pin
                         （收窄理由见 spec `.scratch/thread-message-actions/spec.md` D2/D3）
  CreateChannelModal.tsx 建 channel（公开/私有/描述/初始成员）
  CreateAgentModal.tsx   建 agent
  ReminderModal.tsx      提醒设置/管理弹窗（target 锚定 + 唤醒谁 + recurrence 预设 + snooze/cancel）
  MyRemindersModal.tsx   全局提醒面板（全部提醒列表 + snooze/cancel + 定位跳转，15s 轮询）
  AgentDetailPanel.tsx   agent 详情面板：状态/workspace/runtime（§3.10 ModelPicker 覆盖全局默认）/可观测性（§6.5 统计+任务历史+时间线+导出）/重置
  BrutalModal.tsx        模态外壳（scrim + blur；`.modal` 两档宽度 440/560，模块名沿旧）
  Avatar.tsx             首字 tile 头像（`--av-0…--av-4` 确定性取色，人类恒 `--av-4`）
  StatusDot.tsx          状态点四态（绿/黄脉冲/橙/灰）
  ChatInput.tsx          pi-web 遗留 chat 输入条（agent 会话用，保留复用）
  MessageView.tsx        pi-web 遗留会话消息渲染（agent 会话用，保留复用）
  MarkdownBody.tsx       markdown 渲染器（channel 消息复用）
  ModelsConfig.tsx       modal for editing models.json (opened from sidebar bottom)
  PiEnvNotice.tsx        pi 配置根两档故障的提示面（issue #226）：侧栏配置区常驻状态条（rail）+ ModelsConfig
                        顶部入口（modal）；只消费 /api/pi-env/status 的结论、自己不判定；无结论渲染 null；
                        PiEnvNoticeBar 是纯呈现（SSR 可直接跑三态断言）
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
