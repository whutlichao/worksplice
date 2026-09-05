# Worksplice

多 agent 协作消息系统：人类（owner）与若干 agent 通过频道协作，agent 由 agent-loop 驱动消费消息并回复。

## Language

**成员 (Member)**:
持久身份行，类型为 agent 或 owner（人类，恒为 `owner`）。删除 = soft-delete：行保留以承载不可变消息的作者渲染，但移出全部频道。
_Avoid_: 会话、session（那是 pi session，临时运行状态）

**Agent**:
拥有家目录、可绑定项目目录的成员。可被唤醒、进入频道、认领任务。
_Avoid_: 机器人、bot

**家目录 (Home)**:
每个 agent 创建时自动获得的专属目录，唯一且私有；删除身份时一并删除。
_Avoid_: 默认工作区、个人目录

**项目目录 (Project Directory)**:
可被多个 agent 绑定共享的目录（协作代码库）；不随任一身份删除，也不被全量重置清理。
_Avoid_: 仓库、共享目录

**工作区 (Workspace)**:
成员当前绑定的目录——未绑定项目目录时为家目录，绑定后为项目目录；更换工作区即更换会话。
_Avoid_: 目录、文件夹

**会话文件 (Session File)**:
pi 运行时在工作区写出的会话记录（jsonl），app 只读不解析（读写权归 SDK）。成员行 `pi_session_file` 登记某个会话文件 = **固化 (Fixation)**：文件归该成员所有，是会话文件所有权的唯一凭证。
_Avoid_: 会话、session

**无主文件 (Unowned Session File)**:
工作区内未被任何成员固化引用的会话文件——人类 pi 会话、已删除 agent 遗留、他人历史文件均属此类。规则：**永不解析**——agent 启动只复用自己固化过的文件；家目录（构造上唯一私有）内的文件例外，可安全回填。
_Avoid_: 孤儿文件（内部术语，避免对外）

**backfill 归属门禁 (Backfill Ownership Gate)**:
启动补拉（backfill）补写前对 session 文件做的文件级归属校验（ADR-0004）——header cwd == 成员 workspace ∧ 不被其他活成员引用 ∧ 文件 mtime 不早于成员创建时间；任一不过 → **整文件跳过**（不补写、不推进游标、记日志、不清绑）。与 startSession 的复用校验（ADR-0003）同基准但职责独立：startSession 看可否复用，backfill 看补写是否安全。
_Avoid_: 复用校验（那是 startSession 的）

**跨作者内容去重 (Cross-author Content Dedup)**:
backfill 补写前查 `(target, content)` 是否已被**其他**作者落库；命中 = 疑似继承文件的他人回复（soft-delete 保留消息）→ 跳过该轮补写且该 target 游标保持 pending（留给正常 wake 重读重做）。兜底文件级门禁漏掉的「mtime 被原 owner 更新过」的继承文件。
_Avoid_: 内容查重（会与同作者幂等去重混淆）

**频道 (Channel)**:
消息的聚合容器。加入 = 订阅该频道的全部普通消息（可见性）。
_Avoid_: 群组、room

**私信 (DM)**:
owner 与单个 agent 之间的一对一频道：成员创建时定死两人（owner + 1 agent），不可加人、退订、归档、离开或静音；其中的人类消息是确定信号，agent 必须回应。
_Avoid_: 私聊、room、dm 小群

**订阅 (Subscription)**:
加入频道即订阅——drain 可见该 target 全部消息（拉取式，与是否被唤醒无关）。订阅 ≠ 行动：被唤醒后是否回应由 agent 自判（见回应判断）。
_Avoid_: 通知

**唤醒 (Wake)**:
消息落库后触发 agent 跑一轮的注意力信号（hint 只含 agentId/targetId/seq/reason，不含正文）。面 = 目标频道的全部 agent 成员（除作者、静音者）+ 未加入但被点名的穿透 + 定向（任务 owner 自醒 / 提醒作者 / 秘书）。全量唤醒下"是否回应"由 agent 自判——唤醒是注意力，不是命令。
_Avoid_: 通知、提醒

**回应判断 (Response Judgment)**:
agent 每轮 decide 的回应规则（rubric，§05）：确定信号（被点名 / 进行中任务 owner 收到线程他人消息 / 提醒指向自己）= 必须回应；明确无关（他人任务线程、进度播报、无关闲聊）= 必须 ignore 不插话；其余按相关性自判。确定信号下 ignore 按失败处理（不 ack、error 状态点、连续 2 次后 cap-ack 防死循环）。
_Avoid_: 过滤、优先级

**轮次 (Round)**:
agent 一次 wake→drain→decide→act→reply→ack 的处理周期。每轮以**轮次结果**收口，是回应判断的执行载体。
_Avoid_: 会话、session（那是 pi session）

**轮次结果 (Round Outcome)**:
一轮的处理结论（status/reason/baseSeq/target/时间），有结论的轮次（已回复/忽略/静默/强制发送/让路/失败/等待占用）落盘 round_logs 供可观测页展示——区分「自判 ignore（正常协议选择）」与「处理失败（需排查）」的事实来源；cap-ack 的 `(capped)` 标记在 reason 里可见。瞬态轮次（无新消息/已回复/正忙）不落盘。
_Avoid_: 日志（console 日志不落盘、不可事后查）

**频道成员 (Channel Member)**:
已加入某频道的成员。`#all` 自动加入且不可离开；thread 回复继承频道规则。

**提及 (Mention / @mention)**:
消息正文里的 `@名字` token（含空格的名字用 `@"带空格名字"` 引号形式）解析为成员 id。个人提及是注意力信号：被提及的 agent 被唤醒，且穿透 mute 与未加入限制。渲染侧命中成员名的 token 高亮显示，点击可查看成员（agent → 详情面板，人类 → 简介弹窗）。被点名是确定信号——必须回应，ignore 按失败处理（见回应判断）。
_Avoid_: @ 关联、艾特

**穿透 (Penetration)**:
未加入频道的 agent 被个人提及时仍被唤醒送达（但回复需自行加入频道）。mute 的静音只挡普通消息，个人提及仍穿透。

**静音 (Mute)**:
频道的退订开关：静音后普通消息不进该成员 inbox、不唤醒，个人提及仍穿透；取消后不补投静音期间被压制的消息。与回应判断正交：mute 是"连看都不看"，回应判断是"看着但决定不回应"。

**任务 (Task)**:
锚定于一条频道消息的协作单元，带状态机（todo→in_progress→in_review→done/closed→reopen）。互审：构建者不验证自己。
_Avoid_: ticket、工单

**任务视图 (Task View)**:
任务在频道内的两种呈现方式：**列表**（按状态分组纵向堆叠）与**看板**（按状态分列横向排布）。看板列与任务状态一一对应，跨列拖移即请求一次状态转移；拖拽是按钮动作的另一种手势，状态机仍是唯一裁决者。
_Avoid_: 任务面板、kanban 直译

**成员面板 (Member Panel)**:
频道头部 `Users` 图标展开区，列出该频道的 agent 成员及状态点，点击打开成员详情。

**补全 (Mention Completion)**:
Composer 输入 `@` 弹出的成员菜单，列出全部 agent（非频道成员标注"未加入"），插入 `@名字` 或引号形式。
_Avoid_: 提及菜单

**Cwd 互斥 (CwdMutex)**:
单机单进程下同一 `workspace_path` 的串行门禁——`withCwdMutex(cwd, fn)` per-cwd promise 链（`realpathSync` 归一）+ starting 窗口计数器 + `isCwdBusy`/`findBusySession` 探测与 `waitForSettle(SETTLE_EVENTS)` 等待。深模块 `lib/cwd-mutex.ts` 唯一事实来源，供 `agent-runtime` 与 `driver` 共用。
_Avoid_: busy-cwd 锁（仅描述现象）、文件锁（那是 `proper-lockfile`）

**成本看板 (Cost Board)**:
轮次结果随盘 `prompt_tokens/completion_tokens/cost`（`round_logs` 新增三列）+ `cost-monitoring-baseline.md` 双视图（全量 session 聚合 + 最近 50 轮滑动）的可观测形态。silent/error/capped 显式 badge + reason 原文，must-respond capped 单独解释。
_Avoid_: 成本日志（不可事后查的 console 日志）

**SDK 委托边界 (SDK Delegation Boundary)**:
`pi 管 pi、raft 管 raft` 的切分线：SDK 侧收敛 `tools/enabledModels/ThinkingLevel/SessionManager/buildSessionContext/SettingsManager/ModelRuntime/AuthStorage/DefaultResourceLoader/DefaultPackageManager/compaction`，worksplice 侧保留 `lib/rpc registry+caller` 的 per-member 记账与 `Cwd 互斥`、`双轨状态`、`lifecycle 家目录两分`、`pi_session_file 固化门禁`、`raft 域全量`（`Store 57`/`UNIQUE(target_id,seq)`/`freshness-hold`/`FTS5`）与 `project-trust/models-cache/provider-listing` 编排。
_Avoid_: SDK 边界（泛指）、中层收敛（未指明归属）

**薄 Wrapper (Thin Wrapper)**:
`AgentSessionWrapper`（`lib/rpc/session.ts:55-65`）的封装厚度约束：仅叠 `promptRunning` 标记 + 订阅转发，不复刻 SDK 的 `isStreaming/isCompacting` 状态机与 `setActiveToolsByName` 激活语义；`toolsOption` 空数组=全禁、`undefined`=不过滤的 SDK 语义直通。
_Avoid_: 厚 Wrapper（复刻 SDK 状态机）、代理（proxy 泛称）

**深模块 (Deep Module)**:
对外暴露窄而深的 entry point（`index.ts` 仅 re-export 深层能力），内部子模块直引不经索引回环、实现细节对外隐藏的模块形态。
_Avoid_: 浅封装（仅做 re-export 转发）、大杂烩模块

**唯一导入面 (Single Entry / Facade)**:
一域对外唯一的 `index.ts` 聚合出口（如 `lib/domain/raft/index.ts: export *`），消费方只经此单口导入，域内子模块互相直引；测试缝以此单口 mock 整域。
_Avoid_: 散导入（直引子模块）、桶文件（仅为缩短路径）
