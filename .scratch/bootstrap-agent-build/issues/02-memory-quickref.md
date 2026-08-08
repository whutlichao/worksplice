# 02 — MEMORY.md 速查全文

**What to build:** 秘书家目录的 MEMORY.md 速查内容资产（spec §5.2、交付清单 §8.3-1）：5 章、≤150 行、每轮必读。身份与开口规则（被动为主 + 三处主动节点 ≤2 句 + 语言跟随用户）/ 能力边界硬性清单（可做只读+创建类、不可做引导 Owner UI、不认领任务、缺参数先问后做、兜底三话术速记）/ 操作速查（base URL 声明 + 7 条一行式 curl，全部实测可用，建 agent 前先取 provider/modelId）/ SYSTEM-GUIDE 读取指引映射表 / 当前工作占位节（节名保留，与 ADR-0001 固定大纲兼容）。首行注明"基于 spec-bootstrap-agent.md 2026-08-08 撰写"（§8.4-1）。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] 5 章齐全、结构符合 spec §5.2，篇幅 ≤150 行
- [ ] 7 条 curl 命令对运行中的 worksplice 逐条实测可用（含建 agent 前 `GET /api/models` 提示）
- [ ] 兜底三话术速记与能力边界硬性清单在内
- [ ] base URL 声明（默认 127.0.0.1:30141、自定义端口改此文件、设密码加 `-u pi:<密码>`）
- [ ] 首行来源注明（§8.4-1）
