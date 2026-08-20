# 08-向后兼容与数据迁移策略

Type: grilling
Status: open
Blocked by: 02

## Question

在 02 选型结论基础上，决策向后兼容与数据迁移策略。

- 存量 `~/.worksplice/raft.db`（SCHEMA_VERSION 11 链）与 `~/.pi/agent/sessions/*.jsonl` 的兼容承诺（是否平滑迁移、是否支持旧库一键升级、回滚点）
- 迁移形态：分几期、每期迁移哪些表/列（如 `round_logs`/`channel_reads`/`channel_mutes` 等近期新增表）、迁移脚本的幂等与版本守卫（`db-singleton` 热重载守卫是否保留）
- 附件与家目录（`~/.worksplice/attachments/`、`~/.worksplice/agents/<slug>/` MEMORY.md）是否纳入迁移范围
- 调用 `grilling` + `domain-modeling`：明确会话文件固化（`pi_session_file`）、无主文件永不解析等已有门禁在新架构下是否保留
