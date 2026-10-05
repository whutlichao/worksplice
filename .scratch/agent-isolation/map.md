# Map: agent 隔离与频道对话可靠性

## Destination

确认并修复 agent 隔离失效：频道内 agent 对话不再出现三种症状——①**有时不回复**（状态回 online 但无回复，游标推进、消息被静默消费）；②**继承其他 agent 的会话/上下文**（答非所问、记得别人的历史）；③**唤醒面过宽**（一条消息多 agent 刷屏、任务线程混入无关 agent）。每个症状有代码级根因确认，修复自带回归测试并落地——本 effort **边诊断边修**（不产出决策文档就停，直接携带修复）。

## Notes

- 领域：TypeScript / Next.js worksplice。关键文件：`lib/agent-loop/`（loop.ts / driver.ts / wake.ts / backfill.ts）、`lib/agent-runtime.ts`、`lib/rpc-manager.ts`、`lib/raft/inbox.ts`
- 症状（用户确认）：①「没有回复」时**状态点回到 online**（游标推进、静默消费）；②「继承」= 继承了**其他 agent** 的会话（不是人类会话、不是频道历史淹没）；③唤醒面过宽纳入范围
- 优先级：**不回复 > 继承 > 唤醒面**
- 部署形态：既有**共享项目目录**的 agent，也有**独立家目录**的 agent——两种配置都在排查范围内
- **在途未提交改动 = 本 effort 的一部分**（`git status`：`lib/agent-loop/loop.ts` 空文本=失败、`lib/agent-runtime.ts` error 状态保留、`lib/rpc-manager.ts` per-agent 模型对老 session 生效、`lib/raft/tasks.ts` 等）——ticket 01 先把它们验证落地为基线，再找剩余失效路径
- 每个 ticket 边诊断边修：先确认根因（结论即决策），决策后**立即携带修复代码 + 单测**，ticket 才算 resolved
- 验证命令：`node_modules/.bin/tsc --noEmit` + `npm run lint` + 相关 `lib/agent-loop/*.test.mjs` / `lib/raft/*.test.mjs`；**绝不 `next build`**
- 热重载陷阱（AGENTS.md 明文）：改 agent-loop/driver/wake/backfill 后**必须重启 dev server**（globalThis 闭包持有旧代码，热重载不生效）；验证手段 `ps aux | grep next-server` 启动时间晚于改动
- 每 session 应 consult 的 skills：grilling（HITL ticket）、research（AFK ticket）、domain-modeling（术语：成员/会话/工作区/频道/穿透，见 CONTEXT.md）
- 文档正文一律简体中文

## Decisions so far

<!-- 图表索引：一个 closed ticket 一行，够判断相关性即可，细节在链接里 -->

- [01-静默无回复根因确认与修复](issues/01-静默无回复根因确认与修复.md) — 症状①四路径排查：基线三改动落地（空文本=失败 / error 保留 / initialModel 覆盖）；修复两处——reply 无 content 按失败不 ack（b）+ busy 等待监听 compaction_end 且订阅后复核 isRunning（d）；(a) 无竞态、(c) backfill 仅对解析出 reply 的轮次推进游标，均验证不修；BusyCwdError→error 丢弃归 02
- [03-会话文件解析作用域收窄防继承](issues/03-会话文件解析作用域收窄防继承.md) — 症状②根因：无主文件可被解析并固化（粘性继承）。所有权规则（ADR-0003）：凭证=固化登记（pi_session_file）；复用需过归属校验（cwd 一致+不被他人引用+在清单内），失败自愈（清绑+新建空会话）；无主文件永不解析——共享目录一律新建，仅家目录回填。人类会话隐含排除；占用判定归 02
- [02-共享cwd并发丢唤醒与双启动竞态](issues/02-共享cwd并发丢唤醒与双启动竞态.md) — 症状①共享目录变体 + 并发根源：BusyCwdError→error 轮被 driver 丢弃（hint 永久丢失）= 并发丢唤醒直接机制。决策：BusyCwdError 映射 busy-cwd（等占用会话 settle 后重试，不丢 hint 不落 error）；error 不泛化重试；`withCwdStartLock` per-cwd 启动互斥（检查+启动原子化，不撞启动窗口）；人类会话 registry 不可见维持不挡。ADR-0001 串行落地为 启动期 mutex + 运行期 busy 检查
- [04-backfill作者归属护栏](issues/04-backfill作者归属护栏.md) — 症状②的 backfill 侧兑底：文件级归属门禁（header cwd==workspace / 不被活成员引用 / mtime≥成员创建时间，后者为确定性规则）+ 轮级跨作者内容去重；任一不过整文件跳过（不补写、不推进游标、记日志、不清绑）。历史脏数据保守跳过（清绑仍归 startSession 自愈）；人类文件天然免疫；双活绑定防双作者补写。ADR-0004
- [05-唤醒面策略收窄](issues/05-唤醒面策略收窄.md) — 症状③决策：**唤醒面不收窄**（channel/thread 全量唤醒不变，wake.ts 零改动），回应与否下放 agent 自判——`buildReplyPrompt` 新增 rubric（MUST reply：点名/任务 owner 线程他人消息/提醒；MAY reply：相关；MUST ignore：他人任务线程/进度播报/闲聊）；确定信号（@mention、in_progress owner 线程他人消息）下 ignore = 失败（不 ack、error、pending），连续 2 次 cap-ack 防死循环；术语四词（订阅/唤醒/点名/退订）入 CONTEXT.md
- [06-回归测试基线与复现脚手架](issues/06-回归测试基线与复现脚手架.md) — 四场景覆盖矩阵确认全绿（fake runtime 零 SDK 依赖：①空文本/无 content=失败不 ack、②startSession 无主文件不解析+backfill 门禁五条、③busy-cwd 不丢 hint+启动互斥、④rubric/must-respond/cap-ack）；**新发现软删 corner**：deleteAgent 不清 pi_session_file 且引用集按 deleted=0 过滤 → B 残留绑定 A 文件时门禁放行、A 崩溃窗口未投递回复被按 B 补写（红灯基线 `ticket06: RED` 实跑 `inserted 1!==0` 证实）→ 毕业 08
- [07-状态点回应可观测性](issues/07-状态点回应可观测性.md) — 症状①可观测性形态决策：**状态点保持四态不动**（error 已覆盖失败；正常 ignore 上状态点=把正常选择当异常，与 05 语义相悖）；**轮次结果落盘 round_logs**（schema v9，driver 唯一收口点，只记有结论 7 种轮次 + ring cap 200/agent，noop/skipped/busy 不记）；可观测页新增「轮次记录」（status/reason/target/#baseSeq/时间，cap-ack 的 `(capped)` 标记在此可见）；「轮次/轮次结果」术语入 CONTEXT.md；测试 rounds+driver+route 全绿，唯一红灯仍为 08 基线
- [08-backfill软删成员登记纳入归属引用集](issues/08-backfill软删成员登记纳入归属引用集.md) — 症状② backfill 侧剩余路径修复：引用集切换 `listMembersIncludingDeleted()`（新全量访问器）——软删成员的 pi_session_file 固化登记重新计入归属门禁，「被其他成员固化引用」拦截生效；`ticket06: RED` 基线变绿、04 五条门禁零回归、301 测试全绿。ADR-0003 凭证语义闭环（凭证=固化登记，软删行保留正是为承载所有权）
- [09-未回复已放弃消息流即时标记](issues/09-未回复已放弃消息流即时标记.md) — 症状①「别等了」即时可见性：badge 从 round_logs 派生（`isAbandonedRound` = silent + error/capped，普通 error/busy-cwd/yielded/ignored 不标）→ 每 (agent,target) 只看最新一轮（后续任何轮自动清除，ring cap 自然消失，不落表）→ 锚 base_seq 对应 seq 消息 → `listMessages` 批量挂 `abandonedMarks`（`listRoundLogsByTarget` 新查询，SCHEMA_VERSION 10）→ MessageRow 小字 badge（CircleSlash + 未回复/{count} 人未回复 + tooltip 明细 + 点击开 agent 面板）；rounds/messages/ChannelView/route 测试 323 全绿

## Not yet specified

- 08/09 已毕业并闭环；frontier 已无在途 ticket（见 issues/）

## Out of scope

- 多人/多机/服务器部署（本地单机形态不变，raft-clone 已锁；DAU 无关）
- 非 pi runtime（Claude Code / Codex / OpenCode 等）
- pi session 文件格式改动（读写权归 SDK，app 只读不解析）
- 频道消息流 UI 重构（`components/ChannelView.tsx` 等与隔离无关的在途改动）
