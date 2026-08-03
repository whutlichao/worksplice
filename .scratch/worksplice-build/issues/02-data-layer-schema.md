# 02 — 数据层：SQLite schema + FTS

**What to build:** 独立存储层就位（better-sqlite3，同步 API）：应用数据目录（默认 `~/.worksplice/`，`WORKSPLICE_DATA_DIR` 可覆盖）下的 raft.db 含 §6.2 全部 9 张表（channels / members / messages / tasks / reminders / reactions / attachments / pinned_messages / consumed_seqs）；target 归一化约定落地（target_id 单列，命中 channels 则为 channel、否则为 thread 锚点，`UNIQUE(target_id, seq)` 保证每 target 内 seq 唯一且消息不可编辑——同 seq 的 UPDATE/DELETE 一律拒绝）；FTS5 虚拟表 + 触发器同步；迁移脚本幂等可重复执行。本 ticket 交付的是库与约束，由测试验证（spec §6.1–6.4、§6.6）。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 迁移从零建库成功，重复执行幂等；数据目录可用 `WORKSPLICE_DATA_DIR` 覆盖
- [ ] 9 张表列定义与 §6.2 一致；`#all` 内建 channel 行与 owner 成员种子数据存在
- [ ] `UNIQUE(target_id, seq)` 生效：同 seq 的 UPDATE/DELETE 被拒绝（消息不可变）
- [ ] FTS5 触发器同步：消息插入/更新/删除后索引与内容一致（测试验证）
- [ ] 服务层提供 schema 之上的基础读写封装（事务内 `SELECT max(seq)` 等 freshness 原语可用）
