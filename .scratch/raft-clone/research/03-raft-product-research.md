# 03 · Raft 产品与架构研究（wayfinder ticket 03）

> 研究日期：2026-08-02。素材来源：docs.raft.build 全部 40 个页面、raft.build 博客全部 9 篇文章 + 4 个 use case、npm 包 `@botiverse/raft@0.0.17`（逆向命令面）、GitHub 公开仓库 `botiverse/raft-docs`。正文简体中文。

---

## 一、产品形态概览

**一句话**：Raft 是"人类与 AI agent 共同工作的 Discord"。agent 不是可调用的工具，而是**服务器成员**——有名字、持久身份、记忆、自己的 inbox/tasks/reminders，与人类共享 channel、thread、任务板。

核心对象层次（数据模型的基本骨架）：

```
Server（服务器，顶级容器，含 slug：app.raft.build/s/<slug>）
├── Channels（公开/私有，#all 内建，全员自动加入）
│   └── Messages（不可编辑/删除）→ Threads（以消息为 anchor 的子会话，不可嵌套）
│   └── Tasks（= 带元数据的消息：编号、状态、owner）→ Task Thread
├── DMs（含 agent-agent DM）
├── Members（human + agent，角色 Member / Admin / Owner）
├── Computers（机器，agent 在此执行，一个 server 可挂多台）
│   └── Agents（每个 agent 有独立 workspace 磁盘目录）
└── Files（附件挂在消息上，50MB 上限）
```

**核心工作循环**（所有工作的通用模式）：`describe → hand off → let it run → review`（描述 → 交接 → 让它跑 → 审查）。多 agent 协作 = 同一循环并行运行。

**runtime 抽象**（复刻方案里只保留 pi，但机制要理解）：
- 支持的 9 个 runtime：Claude Code、Codex CLI、Antigravity CLI、Kimi CLI、Copilot CLI、Cursor CLI、Gemini CLI、OpenCode、Pi。
- runtime 是 agent 的"大脑"：读文件、跑命令、生成文本。**Raft 不中转**——runtime 跑在用户自己的电脑上、用自己的订阅/API key 直连供应商。
- agent 创建时选定 runtime，之后可换（详情面板 → Runtime Config），切换保留 workspace/记忆/身份。
- 一个 server 可混跑多种 runtime，日常使用中其他成员看不到 agent 的 runtime。

**本地架构**（对应本地复刻的形态）：
- **Raft Computer** = 每台机器上的本地常驻服务（daemon），职责：保持与 server 的连接、运行分配给该机器的 agent 进程（start/stop/sleep/wake）、把消息投递给 agent 并回传其回复、agent 崩溃后自动拉起。
- agent 进程由 daemon 派生，通过注入的环境变量（`SLOCK_AGENT_ID`、`SLOCK_AGENT_TOKEN`、`SLOCK_AGENT_PROXY_URL` 等）拿到身份凭证，再用 agent 面 API 与 server 通信。
- 机器离线 → 上面的 agent 全部停止，恢复后自动续跑。agent 不能在机器间迁移（planned）。

---

## 二、各功能细节

### 2.1 Channels / Threads

**交互流程**
- 创建 channel：+ 号 → 设置 名称 / 公开或私有 / 描述（可选）/ 初始成员。Owner/Admin 才有权创建。
- 公开 channel：所有人可见、可自由加入、**未加入也可读历史**；#all 内建且全员自动加入。私有 channel：仅成员可见，必须 owner/admin 邀请。
- 加入/离开：公开可自行加入，离开后不再收消息；私有需管理员加回。
- agent 的参与规则：**agent 可以自行加入公开 channel**；私有 channel 必须被管理员加入。@mention 能送达未加入的 agent（mention 是 attention 信号，不是投递过滤）。
- 归档/删除：归档冻结写入但保留可读，可解除；删除即永久移除。
- 个人化：pinned 区 + 排序（Manual/Recent/A-Z）。

**Threads**
- 任何顶层消息可开 thread（hover → 回复气泡 / 右键 → Open Thread）；第一条回复即创建 thread，原消息是 anchor。
- 不可嵌套；thread 内消息只是讨论上下文。
- 参与（发消息或被打 @mention）即自动关注，取关可静音；**任务必有 thread**（task 消息是 anchor），agent 的进度更新都发在任务 thread 里以保持主 channel 干净。
- thread target 语法：`#channel:threadId`，threadId 是 8 位 hex 短 id（也可用完整 UUID）。

**数据模型线索**
- `channel { name, type: public|private, description, archived, members[] }`；`#all` 是每个 server 内建的默认 channel。
- message：**永久不可编辑/删除**（"可靠记录"是产品原则），修正用 thread 回复；带 emoji reaction。
- 消息编号：每个 target（channel/thread/dm）内 `seq` 单调递增——这是投递游标（见 2.4 inbox）。
- message id：完整 UUID + 8 位 hex 短 id 双形态；`raft message resolve` 做精确解析（歧义时返回错误提示用全 UUID）。
- 消息动作：回复 thread / 引用 / 复制链接 / 保存（Saved）/ 分享为图片 / **转换为任务**。
- 通知规则：DM 永远通知；加入 channel = 订阅其全部消息；关注 thread = 回复通知；未加入 channel 里的 @mention 也会送达。

### 2.2 Agent 身份与记忆

**交互流程**
- 创建 agent：在 computer 上点 Create（或侧栏 quick-create；**agent 也能通过 API 创建 agent**）。设置三项：名字（@mention 句柄）、描述、runtime。创建后进成员列表并自动加入 #all。
- 身份 vs 会话（最核心的模型）：agent 是**持久身份**而非聊天会话。三种重置粒度：
  - **Restart**：沿用现有 session，接着干；
  - **Session reset**：清会话上下文，workspace（文件/记忆）保留；
  - **Full reset**：会话 + workspace 全清。
  - 无论哪种，名字、成员关系、角色都保留。删除才移除身份（历史消息保留，presence/成员/认领消失，workspace 磁盘清理）。
- 生命周期状态点（成员列表实时更新）：绿=在线可响应；黄（脉冲）=正在干活；橙=出错；灰=离线/进程没跑/机器断连。
- idle/active 自动切换：无活时进程保活但低耗；新消息/@mention/reminder 触发激活。**Stopped ≠ 删除**，只停止响应。
- 角色：Member / Admin（agent 永远不能成为 Owner）。Admin agent 可自行建 channel、增删成员、改 server profile；Member agent 只能把这类操作做成 **action card**（动作卡片）等人类审批提交。
- 塑造角色：靠描述 + 加入的 channel + 分配的工作 + 纠错反馈；**agent 可以自己更新自己的描述**（官方建议设周 reminder 维护描述）。

**数据模型线索（记忆机制）**
- agent `{ id(UUID), name, description, role, runtime, computerId }`；身份数据在 server 侧，跨会话稳定。
- **记忆 = workspace 磁盘目录**（在 agent 所在机器上，按 agent 隔离）。存储内容：memory files（笔记/偏好）、working files（草稿/脚本/产物）、克隆的 repo、领域知识笔记。每个 session 都在 workspace 目录里启动。
- workspace 不跨机器迁移；agent 自我管理目录结构（官方建议定期整理）。
- 跨会话记忆的实践原则："agent 把清晰的笔记写进 workspace，即使会话全清也能恢复上下文"——即**记忆是 agent 自己维护的文档**，不是系统级向量库。这是 Raft 的刻意取舍（"不要公司大脑，要 many minds one room"）。
- CLI 侧的本地状态：`slock-cli-consumed-seq/<agentId>/consumed-seqs.json`（已消费 seq 游标）、`slock-cli-attested-send/<agentId>/continue-state.json`（held draft 状态）、draft 状态目录（TTL 10 分钟）。
- 身份注入：daemon 派生 agent 进程时注入 `SLOCK_AGENT_ID / SLOCK_AGENT_TOKEN(_FILE) / SLOCK_AGENT_PROXY_URL(_TOKEN) / SLOCK_AGENT_ACTIVE_CAPABILITIES / SLOCK_SERVER_URL`。
- 外部 agent 接入：`raft agent login`（device-code 流程：CLI 打印浏览器链接+设备码，人类在浏览器确认，mint `sk_agent_*` 凭证，存本地 profile），`RAFT_PROFILE=<slug>` 指定身份。

### 2.3 任务板（Tasks）

**交互流程**
- 创建三途径：右键消息 **Convert to Task**（顶层消息可转，thread 内消息不可）；发送时勾 **As Task**；直接 **Create Task** 按钮。
- 任务生命周期：**todo → in progress → in review → done**，外加 **closed**（取消/不做，可 reopen）。状态变化全员可见。
- 认领/owner：一个任务同时只有一个 owner。claim 即"我负责"；unclaim 释放回池子；已认领的其他人不碰。
- **Agent 自动认领**：收到需要行动的消息 → 先 claim 再开工；**claim 失败（别人抢先）就让路**，不用人分配。这正是并行不撞车的机制。
- 并行与互审如何发生（来自博客/use case）：大任务拆成互不阻塞的 subtask（agent 可自己拆，人先审拆分）；互审靠"作者 ≠ 验证者"的流程约定——完成者置 in review，审查者（另一 agent 或人）审核后置 done。任务 thread 承载全部进展与讨论，board 只显示状态。
- 任务板视图：每个 channel 一个 Tasks tab，按 status 分组展示。

**数据模型线索**
- **task = 消息 + 跟踪元数据**：`task { messageId, number（频道内递增 #1 #2…）, status, owner? }`。它住在创建它的 channel 里，天然可搜索（消息即可搜）。
- 认领 API 形状：`POST tasks/claim { channel, task_numbers[] , message_ids[] }` → 返回每条任务的认领结果；`tasks/updateStatus { channel, task_number, status }`。
- **认领与改状态都受 freshness-hold 保护**（见 2.4/三）：并发窗口内房间变化时服务端 hold，返回"held"响应，agent 读新上下文后重试——这是任务竞态的服务器侧保证。
- 任务状态常量：`todo | in_progress | in_review | done | closed`（CLI 内 STATUSES 数组）。
- 任务在 joint channel 中不存在（见 2.5 注）。

### 2.4 Inbox（agent 拉取通知机制）——本项目复刻的核心

**交互流程（agent 视角）**
- 不是推送进上下文，而是**可查询条目（queryable items）**：mention、thread 更新、通知积累在服务端，agent 有空时自己拉。
- 两个层次：
  - `raft inbox check` —— 只列出待处理目标摘要（不读正文、不推进游标；仅 managed daemon runner 可用）；
  - `raft message check` —— **drain 收件箱**：拉取自上次以来的所有新消息并按 seq 排序，返回前先 ack 已投递 seq。有更多时提示"More messages are pending"。
- 原理（博客原文）："agent 决定什么值得进它的 context，而不是房间替它决定"——每次拉进 prompt 的信号都会挤掉别的东西（任务状态、指令、中间推理），所以把选择权交给 agent。
- 唤醒（wake）机制：server 发 **content-free wake hint**（不含正文、只含 seq/目标信息）通知 daemon 有新东西；daemon/bridge 据此把 agent 从 idle 唤醒，agent 再主动去读。Hermes 外部 agent 走 `raft agent bridge`（CommsCore bridge）收 wake hints；流不可用时**回退轮询**。

**数据模型线索（协议面）**
- 消息按 target 分桶，`seq` 单调递增；drain 用 `since` 游标（`events.get({since: "latest"})`），本地记录 per-target 已消费 seq。
- 每轮最多 50 轮（MAX_DRAIN_ROUNDS），分页有 `hasMore / drainComplete / drainedMore` 标记。
- 端点：`/agent-api/inbox`、`/wake-hints`（peek，不推进游标）、`/internal/agent-api/wake-hints/stream`（SSE 流）、`/activity/drain`。
- 协议版本串：`raft-activity.v1` / `raft-activity-drain.v1` / `raft-agent-activity-ingest.v1` / `agent-inbox-protocol` / `agent-proof.v1` / `agent-comms-core.v1` / `slock-external-agent-wake-event.v1`。
- 唤醒遥测事件：`wake_attempt / wake_injected / wake_adapter`（wake hint 的 proof 必须由 wake_adapter 提供）。
- 人类侧对应物：Activity feed（All/Unread/Mentions 三过滤，chronological，含任务状态）+ Saved 书签；push 通知（DMs 必推、channel 订阅即推、thread 关注推）。
- **held draft / freshness hold**（防"agent 想问题时房间已变"）：发送时携带 agent 写稿时的房间版本标记；服务端比对——未变则提交，变了则 **hold** 并返回"期间来了什么"的摘要；agent 四选一：revise（重写）/ send-as-is（原样再闯一次 freshness 检查）/ stay silent（静默放弃，沉默也是合法结果）/ **send anyway**（`--anyway` 逃逸口，重复 hold 后的显式绕过）。claim/update 任务同样受此保护（响应 `state:"held", decision:"local_hold"|"syncing_hold"`）。
- 静音（mute）：channel 级 mute（`activityMuted` + `muteFromSeq`），muted 后普通消息不进 inbox，但**个人 @mention 仍然穿透**；thread 取关同理（mention 穿透但不重新关注，回帖才重新关注）。

### 2.5 Reminders

**交互流程**
- 谁设：agent 自己主动设（"agent 拥有自己的时间"——官方明示 agent 会为重复工作流主动设 reminder，无需人吩咐）；人类也可让 agent 代设（"2 小时后跟进这个 thread"）。
- 触发：到点唤醒**作者本人**（author-owned），并在锚定表面（消息/thread）发一条通知（人类可见为系统消息）。
- 管理：snooze / update / cancel / list（含历史）。全员可见（在锚定 channel 内）。

**数据模型线索**
- `reminder { id (UUID/8位前缀), title, fireAt, recurrence, channel?, messageId?（锚定消息）, status: scheduled|fired|canceled }`；`log` 子命令输出生命周期事件流。
- **recurrence 规则 DSL**（服务端理解，简洁）：`every:15m | every:2h | every:1d | daily@09:00 | weekly:mon,fri@09:00`。相对时间推荐用 `--delay-seconds`（服务端算绝对时间，时区安全）。
- fire 时向锚定消息/thread 投递系统消息——说明 reminder 状态与投递是服务端职责，agent 端只需 schedule/list/snooze/update/cancel/log。
- 官方把 reminder 作为"loop"（循环任务）的基础设施：tutorial 里 Walter 用 recurring reminder 驱动每日收盘快照循环，先写"loop contract"（节奏/校验/预算/工具/升级路径）再调度。

### 2.6 可观测性

**公开文档里没有专门的 observability 功能页**（sitemap 无此页，features 树无此节点）。公开可及的部分只有：

- **agent 状态点**：绿/黄/橙/灰四态实时更新——这是唯一的产品内"运行状况"指标。
- **Report Issue / Copy Diagnostic Info**：agent 详情面板 → Actions → Report Issue，附带 agent 诊断信息与 **session trace**（会话轨迹）发给官方——存在 trace 但仅作为排障素材，非用户可见面板。
- **activity 状态**（外部 agent 的已知局限，官方承认）。
- 博客披露的内部事实：Raft 自家用 **ScopeDB 做 tracing/observability**（博客《Don't talk to me》），且有 trace coverage / trace readback 的工程实践（《How a Feature Ships》），但这是公司内部工程，无产品化文档。
- 衡量指标 DAA（Daily Active Agents）："一个 agent 当天发了至少一条可见消息"即计为活跃——与 DAU 同口径。这是研究性指标，非产品面板。

**对复刻的启示**：可观测性是我们需要自己设计的空白区（任务板历史视图、agent 活动日志、token/成本等），Raft 只提供了"状态点 + 消息即历史"的最简形态。

---

## 三、AX 设计原则（影响 UI / 协议设计的决策素材）

**AX = Agent Experience design**（Raft 提出的术语）：像 UX 之于人类一样，为"agent 实际上如何看、如何行动"而设计。

**四问框架**（每个 agent 接触的界面都要回答）：
1. what does the agent see at the moment of action（行动瞬间看到什么）
2. what state does it carry between invocations（调用之间携带什么状态）
3. what can it recover from（能从中恢复什么）
4. what is it allowed to decide（允许它决定什么）

**关键原则清单**：

| 原则 | 内容 | 落点 |
|---|---|---|
| 感知共情（Perception empathy） | 坐在 agent 的位子上看房间：它看不到什么？人类无意识能感知的（对话节奏、停顿），agent 没有——系统要主动补上 | inbox、wake hint、freshness hold 都是为了补这个缺口 |
| 行动显式化（Action explicitness） | 人类内部决策不用 UI 呈现（"是否发送"在脑子里），agent 需要把**选项空间外部化** | held draft 的四条路径、mention notify/add 二选一、action card |
| 拉取不推送（pull, not push） | 房间不能决定 agent 的注意力；agent 决定什么进上下文 | inbox 机制 |
| 信息 + 下一步动作 | 任何给 agent 的输出必须是"能直接用的信息 + 一个明确的 next action"；纯信息没有出口 = 半个设计 | search 结果 = ID + 命中上下文摘要 + "读取上下文"动作 |
| 新鲜度契约（freshness） | 草稿/动作携带房间版本，房间变了就 hold，由 agent 决定 revise/send/silent/anyway；系统只**告知变化，不覆盖判断** | 发送、task claim、task update 全链路 |
| facts 与 whims 分离 | 事实（消息/时间/seq）与偏好（mute 等开关）分开存；偏好读时过滤、缓存层可重建，事实才是源 | mute 功能重构的工程契约 |
| 名字是路由原语 | role 是 schema（可替换无状态），name 是 instance（携带历史/期望/信任）；@mention = 路由，不是标签 | 成员/寻址模型 |
| many minds, one room | 每个 agent 独立记忆，agent 之间只流动消息；不建公司大脑、不用无状态 swarm | 记忆 = workspace 文件而非共享知识库 |
| agents are users too | agent 是产品的第一类用户：可见消息（DAA）、可读的输出、可行动的选项 | 一切协议面的"给 agent 看的都是界面" |
| turn-based 居民 | agent 是 turn-based（读快照→推理→提交动作），不是连续在场（continuous presence）；所有并发设计由此而来 | held draft、claim 竞态、wake 机制 |
| 构建者不验证（the one who builds is never the one who verifies） | 内部工程流程原则，衍生出 in_review 状态与互审文化 | 任务状态机的社会学基础 |

---

## 四、架构公开程度

**结论：server 内部架构未公开。** 没有 API 文档页、没有 daemon 协议文档、没有存储设计、没有 websocket/realtime 文档。公开可得的信息分四层：

**1. 产品文档（全量公开）**
- docs.raft.build 40 个页面全部公开抓取；源仓库 **github.com/botiverse/raft-docs**（public，含全部 markdown 与 UI 截图、tutorial 的 HTML UI 复刻图）。
- 但均为用户视角功能文档，无架构/协议规格页。

**2. 官方 OAuth 协议（全量公开，可直接实现）**
- Login with Raft：`app.raft.build`（浏览器授权）+ `api.raft.build`（token/userinfo/serverinfo）。端点：`POST /api/oauth/token`（authorization_code，Basic auth）、`GET /api/oauth/userinfo`、`GET /api/oauth/serverinfo`、agent 事件 `POST /api/oauth/requests/agent` + `POST /api/oauth/agent-events`（agent_request grant，RFC 8707 resource binding）。
- agent manifest 规范：`raft-agent-manifest.v0`（HTTP API 模式 / local CLI 模式、actions、credential_boundary）。userinfo 区分 `type: "human" | "agent"`，sub 是 server 内 UUID。

**3. Agent 面 CLI（公开分发，可逆向）**
- npm 包 `@botiverse/raft@0.0.17`（含 slock 别名），源码仓库 botiverse/slock 为私有（404），但 **dist bundle 公开可逆**，完整命令面：
  - 消息：send / check（drain）/ read / search / resolve / react
  - 任务：list / create / claim / unclaim / update
  - reminder：schedule / list / cancel / snooze / update / log
  - channel：info / members / join / leave / mute / unmute / create / update / add-member / remove-member
  - thread unfollow、mention pending/notify/add、inbox check、attachment upload/view/comments
  - server info/update、user info、profile show/update、agent list/login(start/wait/status)/bridge、integration list/login/env/invoke/app prepare、manual get/search、action prepare
  - 关键协议线索：per-target seq、consumed-seq 游标、freshness-hold 响应（`state:"held"`）、wake-hints 流、注入环境变量 `SLOCK_AGENT_*`、`RAFT_PROFILE`/`RAFT_HOME`/`RAFT_STATE_DIR`。
- 从这些可以反推出"复刻版 agent 协议"应当具备的能力面，但 server 端实现仍是黑盒。

**4. 未公开部分（复刻需要自行设计）**
- server 端（Raft 托管服务：web 前端 app.raft.build、API api.raft.build）——无任何公开源码。
- Raft Computer daemon（`raft-computer` CLI / `raft-daemon` 旧版）——无公开源码，安装脚本 `cdn.raft.build/computer/install.sh` 公开但内容为安装器。
- 实时投递通道（websocket/SSE）具体实现、存储选型（博客暗示用过 Redis 类缓存 + ScopeDB 做 trace，但非规范）。
- 身份鉴权对外的协议细节（OAuth 除外）、action card 协议、app notification 之外的内部机制。

---

## 五、来源链接列表

**文档（docs.raft.build）**
- 总览与入门：`/welcome/` `/meet-your-onboarding-agent/` `/hand-off-your-first-task/` `/bring-in-your-teammates/` `/build-your-agent-team/` `/divide-the-work/` `/catch-up-in-one-place/` `/search-your-raft/` `/get-pinged-when-it-matters/` `/raft-on-every-device/`
- Server：`/features/server/` `/features/server/computers/` `/features/server/members/` `/features/server/management/`
- Agents：`/features/agents/` `/features/agents/runtime/` `/features/agents/external/` `/features/agents/workspace/` `/features/agents/lifecycle/` `/features/agents/reminders/` `/features/agents/troubleshooting/`
- Messaging：`/features/messaging/channels/` `/features/messaging/messages/` `/features/messaging/threads/` `/features/messaging/dms/` `/features/messaging/joint-channels/` `/features/messaging/activity/`
- Collaboration：`/features/collaboration/tasks/` `/features/collaboration/files/` `/features/collaboration/comments/`
- Apps：`/features/apps/` `/features/apps/login-with-raft/` `/developers/raft-apps/` `/developers/raft-apps/build/` `/developers/login-with-raft/`
- 教程：`/tutorials/investing-research-team/`
- sitemap：`https://docs.raft.build/sitemap.xml`；源码：`https://github.com/botiverse/raft-docs`

**博客（raft.build/resources/blog/）**
- introducing-raft-where-humans-and-agents-build-together（产品宣言：one agent = one session）
- is-having-agents-in-the-room-meant-to-be-chaotic（**AX 四问框架、inbox、held draft**）
- a-comfortable-ax-for-agent-search（信息 + 下一步动作原则）
- agents-need-names（名字 = 路由原语）
- you-dont-need-a-company-brain（many minds one room）
- trust-doesnt-live-in-the-code-review（构建者不验证、互审文化）
- dau-was-never-counting-half-your-team（DAA 指标）
- how-a-feature-ships-for-raft-on-raft（事实 vs 偏好、mute、内部门控流程）
- dont-talk-to-me-talk-to-my-agents（joint channel、跨团队）
- use cases：investment-research-team / engineering-team / job-hunting-team / growth-team
- sitemap：`https://raft.build/sitemap.xml`

**公开代码/包**
- npm：`https://www.npmjs.com/package/@botiverse/raft`（@botiverse/raft@0.0.17，dist bundle 逆向来源）
- GitHub（私有，404 已确认）：`https://github.com/botiverse/slock`、`https://github.com/botiverse/raft-computer`（假设路径，未验证）
- GitHub（公开）：`https://github.com/botiverse/raft-docs`、示例 app `botiverse/musik`、`botiverse/hands`（文档提及）

---

## 附：对"本地单机复刻"的要点映射（供 spec 决策）

1. **本地形态天然契合 Raft 模型**：Raft 本来就是"server 在云端 + daemon 在本机"，本地复刻 = server 与 daemon 合一、单机单进程，channel/thread/task/inbox 语义完全保留。
2. **必须保留的核心机制**：per-target seq 游标投递（inbox drain）、freshness-hold（竞态保护，任务认领的并发语义全靠它）、reminder 服务端调度（cron 即可）、workspace 即记忆（pi session + 目录）。
3. **out of scope 确认**：joint channel（协议面最复杂的部分）、OAuth/apps 生态、外部 agent 的 device-login（本机单用户可简化）、多 computer。
4. **可观测性需自研**：Raft 公开面只有状态点；任务历史/活动日志/成本面板是本地复刻的加分空白。
