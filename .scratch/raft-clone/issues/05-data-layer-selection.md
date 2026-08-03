# 05 — 数据层选型与数据建模

Type: grilling
Status: resolved
Blocked by: 01

## Question

本地单机存储方案与技术选型：channels/threads/messages/tasks/agent 状态的数据建模；SQLite 或其他方案；是否复用 pi 的 jsonl 会话格式；与 pi-web 现有代码（lib/session-reader.ts 等）的关系。

## Answer

经六问 grilling 确认（2026-08-03，HITL）：

1. **数据边界**：两套存储并存，互不掺和。pi session jsonl 保持 pi 原生格式、读写权完全交 SDK（`SessionManager`），app 只持有文件路径、只读不解析不修改（agent 详情面板历史走 `session-reader` 式只读复用）；raft app 数据（channels/threads/messages/tasks/reminders/members/inbox 游标）新建独立存储层。
2. **存储技术**：better-sqlite3（同步 API；事务 + FTS5 是本建模的刚需）。
3. **核心 schema 骨架**：`channels`（含 `#all` 内建行）、`members`（human/agent 统一，含 role、workspace 路径）、`messages`（**target_id 单列归一化**：channel 或 thread 锚点消息 id；`UNIQUE(target_id, seq)`，消息不可编辑）、`tasks`（`message_id` FK；task = message + metadata：number/status/owner；状态机 todo→in_progress→in_review→done/closed）、`reminders`（recurrence 存 DSL 串，fire 由 app 内 cron 驱动）、`reactions`、`attachments`（文件存磁盘目录，库内只存元数据）、`consumed_seqs`（agent_id + target_id 的 inbox 游标）。
4. **freshness-hold 不建表**：消息不可编辑 + seq 单调递增 ⇒ 房间版本 = 该 target 的 `max(seq)`；提交时事务内比较 `base_seq == max(seq)`，相等才写；claim/updateStatus 同理。竞态保护免费获得。
5. **agent 回复双写流**：raft 消息表 = 房间事实唯一来源；pi session 只承载认知过程。用户发消息 → 写 SQLite（事务内 seq 递增 + freshness 校验）→ SDK `prompt` 喂 agent → agent 完成回复、SDK 自写 session jsonl → app 读回回复补写 SQLite。非跨存储事务，崩溃恢复靠 `consumed_seqs` 游标 + 启动按 seq 补拉。pi 升级改 session 格式不影响 raft 数据。
6. **搜索**：FTS5 全文搜索（触发器同步虚拟表，零额外依赖）。
7. **token/成本可观测性**：从 pi session jsonl 只读解析统计，不落库（与"session 读写权交 SDK、app 只读"边界一致）；任务历史直接查 `messages`/`tasks`，无需额外表。

## Comments

（grilling 过程）2026-08-03：Q1 数据边界→认可；Q2 SQLite→接受推荐；Q3 schema 骨架→无异议；Q4 双写流→无异议；Q5 FTS5→接受推荐；Q6 token 只读解析→无异议。
