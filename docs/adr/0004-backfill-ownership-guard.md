# backfill 作者归属护栏：文件级门禁 + 轮级跨作者去重

**背景**：`backfillAgentReplies`（§5.3 崩溃恢复补拉）在启动时扫描 `agent.pi_session_file` 的
`[worksplice:target=... seq=...]` 标记轮，把最后一条 assistant 文本按该 agent 作者补写进 SQLite 并推进消费游标。
它只读 `pi_session_file`，03 修复后新固化的文件都通过 `startSession` 的所有权校验——但 **03 修复前已固化的错绑
仍可能在 backfill 阶段被读到**（`startAgentLoop` 启动时 `backfillAllAgents` 先于任何 `startSession` 运行），
且 03 的复用校验（cwd 一致 ∧ 不被他人引用 ∧ 在清单内）**挡不住「同 cwd 继承文件」**：A soft-deleted 后其文件
不在引用集、header cwd 与 B 的 workspace 匹配 → 校验通过 → B 继续复用 A 的文件，backfill 按 B 作者补写 A 的
回复 → 作者错乱（症状②的另一来源，发生在重启时，静默且具破坏性）。

**决策（ticket 04）**：

- **文件级归属门禁**：`backfillAgentReplies` 补写前对 `pi_session_file` 做归属校验，任一不过 → **整文件跳过**
  （不补写、不推进游标、`console.warn` 记日志、不清绑——清绑是 `startSession` 自愈的职责，backfill 是只读恢复路径）：
  1. **header cwd == 成员 workspace**：jsonl 文件头（`type:"session"` 条目）的 `cwd` 字段——与 SDK
     `SessionManager.listAll()` 的 cwd 同源（同从 header 解析），backfill 无需 import SDK（保持启动路径轻量）。
  2. **不被其他活成员固化引用**：防 03 修复前的双绑定残留（同一文件被 A、B 同时固化 → 双作者补写同一份回复）。
  3. **文件 mtime ≥ 成员 created_at**：成员不可能在自己创建之前拥有会话——mtime 早于创建时间的文件**必然**
     不是该成员自己的（继承自 deleted/他人 agent 的旧文件），确定性规则，无逻辑误杀面。
- **轮级跨作者内容去重（兜底）**：文件级门禁通过后，补写前查 `(target, content)` 是否已被**其他**作者落库——
  命中 = 疑似继承文件的他人回复（soft-delete 保留消息）→ 跳过该轮补写，且该 target 游标**不推进**（保持
  pending，留给正常 wake 流程重读重做），避免把他人回复冒充为本 agent 的投递。真实崩溃恢复中同内容跨作者
  几乎不可能（各 agent 回复独立），误杀率极低。这覆盖文件级门禁漏掉的子集：mtime 被原 owner 更新过的继承文件。
- **门禁粒度 = 文件级**：归属是文件级性质，轮级校验会留下「只补写跳过、游标却推进」的半截状态——文件不过关
  整文件内容都不可信，整文件跳过。
- **人类会话文件天然免疫**：无 `[worksplice:...]` 标记轮，`scanSessionReplies` 返回空，无需额外机制。

**Consequences**：

- 03 修复前的存量错绑（跨 cwd、双活绑定、mtime 老的继承文件）在 backfill 侧全部保守跳过，不再产生作者错乱补写；
  错绑本身仍由 `startSession` 首次唤醒时自愈清绑（ADR-0003）。
- backfill 对「文件属于当前成员」的判定与 `startSession` 同源但独立——startSession 看「可否复用」，
  backfill 看「补写是否安全」，两者共享 cwd/引用基准，职责不重叠。
- 新增 DB 查询 `hasMessageByContentByOther`（`(target_id, content)` 且 `author_id != ?`）。
- 测试辅助 `writeSessionFile` 自动把 header 哨兵值 `/ws` 修正为 agent 真实 workspace（既有用例零改动；
  跨 cwd 用例用非 `/ws` 的 header 规避修正）。
