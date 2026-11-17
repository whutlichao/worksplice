# 任务状态权威归当前全局首席，而非频道首席

**背景**：频道的“生效首席”同时承担默认收件人与任务分流两个职责。任务写权此前沿 owner / 互审 / 首席三条路径散落：普通 agent、频道首席和全局首席都能通过 agent-loop 直接 claim / complete / unclaim，频道首席在 `handoff` 授权上也与全局首席等价。结果是任务归属与任务状态收敛没有单一负责人：一个非 Susan owner 的 `in_progress` 任务无人能替它收口，频道首席换个频道就能继续改状态，而普通 agent 的完成动作又直接落成状态写。

**决策一（单一任务状态权威）**：

- `secretary-identity.ts` 新增 `isTaskStatusAuthority(memberId)`：人类 Owner 或**当前**全局首席（现存模型里的 Susan / 秘书）。这是唯一判定口；不看名字、不看任务 owner、不看频道首席绑定。
- `claimTask` / `updateTaskStatus` / `handoffTask` 在服务层事务前复核该判定；非权威 agent 一律 `TaskNotAuthorizedError`，数据库状态与 owner 不变。`handoffTask` 接受任务状态权威（当前全局首席或人类 Owner），自动触发仍只由当前全局首席发起。
- 状态机合法边、freshness-hold、消息不可变、thread 不可嵌套、room budget / `roomNotice` 语义全部不变。权威只解决“谁能写”，不新增边；非法边仍由 `TRANSITIONS` 拒绝。
- `TaskView.reachable` 从“按 owner / 互审谓词投影”改为“非权威为空；权威按合法边投影”。频道首席恢复为只有默认收件人职责；任务 handoff 的触发、写权、prompt 暗示与 wake 目标都只看当前全局首席。

**决策二（完成从状态写入改为定向请求）**：

- 非权威 owner 的 `{"task":{"op":"complete"}}` 是**完成请求**，不是状态写：任务保持 `in_progress`；完成内容落任务线程，并追加一条 actor 署名的系统事件（`roomNotice:true` + `wake:false`，不占房间预算）。
- 同一份完成报告以线程回复 id / 轮次 key 幂等去重；提交后由服务端只定向唤醒当前全局首席，`WakeHint.reason="task-status"`。不依赖正文 `@`，不惊醒频道首席或普通 agent。
- 准入层只在该全局首席进入 `in_progress` 任务线程时因 `task-status` 开放；`round_logs.role` 复用语义最接近的既有值 `task-reviewer`，不新增 schema CHECK 取值。全局首席不存在 / 非频道成员 / 静音时，事件仍留线程，不唤醒、不降级、任务保持原状态。
- handoff 的 owner 只是归属：被指派的普通 agent 不需要任务状态权威；它完成时走完成请求，由全局首席在合法边上把 `in_progress` 收口到 `in_review`。

**为什么是全局首席而不是频道首席**：

- 状态权威必须跨频道唯一，否则“同一任务由谁收口”取决于频道配置而不是任务生命周期。全局首席与 Owner 一样是工作区级身份；频道首席仍可做本频道的默认收件人与建任务，但不承担任务生命周期裁决。
- 该边界是**单向门**：一旦普通 agent 的完成动作不再改状态，放宽回“每个频道首席都能改”会让任务 owner、审计语义与完成请求的幂等假设同时失效，回滚成本远高于改 prompt。

**Consequences**：

- 普通 agent 在任务线程仍可正常讨论、汇报进展；显式 claim / unclaim / handoff 被服务层拒绝后 agent-loop 必须让路，不崩溃、不误投频道顶层。
- 频道首席仍能接一般无点名消息、仍可按 `worksplice_task_create` 建任务；它不再收到任务 handoff 指令，也不能借 chief 身份改任务状态。
- 完成请求事件是一条持久审计记录；它的 actor 是提交者，唤醒与状态收口是服务端动作。全局首席必须在 prompt 与秘书手册中被告知“普通 agent 只是请求你收口，不要声称它们直接改了状态”。
- 不新增数据库 schema / 迁移 / HTTP 公共接口；`round_logs.role` 复用 `task-reviewer`，历史行与 CHECK 约束不变。

**被否决的备选**：

- **给频道首席保留状态写权**：会让同一个任务在跨频道时出现多个权威，且频道首席变更直接改变历史任务的收口人。
- **让普通 owner 直接 complete，再事后通知 Susan**：状态已经被改写，通知只是旁路，无法保证“只有权威能改”这条安全边界。
- **按名字 `Susan` 判定**：违反既有身份模型；换人、改名、软删都会失效。
- **为完成请求新增表或列**：本决策只需要一条幂等事件与现有消息线程，新增 schema 会把一次权限收敛变成迁移工程。

**Status**: accepted（#295 实施；本决策部分取代 ADR-0019 决策一中的“任务 handoff 跟随频道生效首席”，并保留其默认收件人与互审注意力信号部分；术语以 `GLOSSARY.md` 的“首席”“唤醒”与本文为准。）
