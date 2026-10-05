# 04-backfill作者归属护栏

Type: grilling
Status: resolved
Assignee: worksplice-dev (this session)
Blocked by: （无）

## Question

`backfillAgentReplies` 只读 `agent.pi_session_file` 并把其中 `[worksplice:target=... seq=...]` 标记轮的最后一条 assistant 文本**按该 agent 作者**补写进 SQLite。若该文件是被继承来的（03 修复前已固化、或人类会话文件被解析），backfill 会把**他人的回复补写成新 agent 的作者**——消息归属错乱的另一来源，且发生在重启时（`startAgentLoop` 启动即全量补拉），静默且具破坏性。

**决策（依赖 03 定下的所有权规则）：**
- backfill 补写前的所有权校验：文件必须仍是该 agent 的 `pi_session_file`，且其 cwd 归属与成员 workspace 一致；不满足则跳过并记日志（不补写、不推进游标）
- 对 03 修复前的**历史脏数据**（已错绑的 `pi_session_file`）如何处理：解除错绑、还是保守跳过——给出判定手段（文件归属 = 其 cwd 下的时间/文件特征？或记录解析来源？）
- backfill 推进游标与补写是否要同一所有权门禁（避免只补写跳过、游标却被推进的半截状态）

## Notes

- 涉及文件：`lib/agent-loop/backfill.ts`（`backfillAgentReplies`）、`lib/agent-loop/index.ts`（`backfillAllAgents` 启动入口）、`lib/agent-runtime.ts`
- 依赖 03 的所有权规则——03 先 resolved 本 ticket 才解除阻塞
- 修复需配 `lib/agent-loop/backfill.test.mjs`（跨作者文件不补写）；验证命令见 map Notes
- 结论记录在 `## Answer`

## Comments

## Answer

### 决策（grilling Q1-Q5，全部按推荐定案）

1. **校验基准 = jsonl header cwd**（Q1）：`type:"session"` 条目的 `cwd` 字段与 SDK `SessionManager.listAll()` 同源（同从 header 解析，已核对 `session-manager.js`）——backfill 无需 import SDK，保住启动路径轻量约束。
2. **校验项 = cwd 一致 ∧ 不被其他活成员引用**（Q2）：引用集 = `listMembers()`（deleted=0）的 `pi_session_file`，排除自己；防 03 修复前的双活绑定残留（同文件双作者补写）。
3. **校验失败 = 保守跳过 + 记日志 + 不清绑**（Q3）：backfill 是只读恢复路径，清绑归 startSession 自愈（ADR-0003 职责边界）；启动序上 backfill 先跑，错绑在 agent 首次被唤醒时由 startSession 清掉。
4. **门禁粒度 = 文件级**（Q4）：归属是文件级性质，轮级校验会留下「只补写跳过、游标却推进」的半截状态——文件不过关整文件跳过（不补写、不推进）。
5. **同 cwd 继承文件兑底 = 时间确定性规则 + 跨作者内容去重**（Q5-C）：
   - **时间规则（确定性，无逻辑误杀）**：文件 mtime < 成员 created_at ⇒ 必然不是该成员自己的会话（成员不可能在自己创建前拥有会话）→ 整文件跳过；只覆盖「原 owner 在 B 创建后没再跑」的子集。
   - **跨作者内容去重（轮级兑底）**：补写前查 `(target, content)` 是否已被其他作者落库 → 跳过该轮且该 target 游标**不推进**（保持 pending 留给正常 wake 重读重做）；覆盖 mtime 被原 owner 更新过的继承文件。真实崩溃恢复中同内容跨作者几乎不可能，误杀率极低。

### 关键事实（grilling 前已核实）

- `backfillAgentReplies` 原实现零归属校验；`startAgentLoop` 启动时 `backfillAllAgents` **先于任何 startSession** 运行 → 03 修复前固化的错绑在 backfill 阶段仍被读到，等不到 startSession 自愈。
- 03 的复用校验挡不住「同 cwd 继承文件」：A soft-deleted → 文件不在引用集、header cwd 匹配 → 校验通过 → B 复用 A 文件，backfill 按 B 作者补写 A 的回复（作者错乱，重启时静默发生）。
- 人类会话文件无 `[worksplice:...]` 标记轮 → `scanSessionReplies` 返回空 → 天然免疫，无需额外机制。

### 修复（携带代码 + 单测）

- `lib/agent-loop/backfill.ts`：新增 `readSessionHeaderCwd`（header cwd 解析）、`backfillOwnershipGate`（文件级门禁：cwd / 他人引用 / mtime≥created_at）、`referencedSessionFilesExcluding`；`backfillAgentReplies` 接入门禁（不过 → warn + 整文件跳过）与跨作者去重（命中 → 跳过该轮 + 该 target 游标不推进）。
- `lib/data/db.ts`：新增 `hasMessageByContentByOther`（`(target_id, content)` 且 `author_id != ?`）。
- `lib/agent-loop/backfill.test.mjs`：既有 10 用例的 header 哨兵值 `/ws` 由 `writeSessionFile` 自动修正为 agent 真实 workspace（门禁需 header cwd==workspace）；新增 5 用例——跨 cwd 错绑跳过 / 双活绑定双跳过 / mtime 早于创建跳过 / 跨作者内容去重（跳过补写 + 游标 pending + 同文件正常轮照常）/ 门禁通过不回归。
- 新增 `docs/adr/0004-backfill-ownership-guard.md`；CONTEXT.md 术语表追加「backfill 归属门禁」「跨作者内容去重」。

### 关联

- 与 03 的分工：03 拆掉继承的**源头**（无主文件永不解析 + startSession 复用校验自愈）；04 堵住**存量脏数据**在 backfill 侧的作者错乱补写（历史错绑保守跳过）。两者共享 cwd/引用基准，职责不重叠（startSession 看可否复用，backfill 看补写是否安全）。
- 人类会话免疫 + 双活绑定跳过均记录在 ADR-0004。

### 验证

`tsc --noEmit` ✓、`npm run lint` ✓、全量 `node --test lib/*.test.mjs lib/agent-loop/*.test.mjs lib/raft/*.test.mjs` = 548/548 ✓（新增 5 条）。

⚠️ 热重载陷阱：本次改了 `lib/agent-loop/backfill.ts`（`backfillAllAgents` 由 `startAgentLoop` 启动路径持有），**dev server 必须重启**才能让修复生效。
