# 03 — raft 产品与架构细节研究

Type: research
Status: resolved
Blocked by:

## Question

raft 的产品与架构细节：channels/threads、任务板（认领/并行/互审）、agent inbox/reminders、可观测性的具体交互与数据模型；AX（Agent Experience）设计原则；server 架构与 agent 通信协议（如有公开文档）。

## Answer

详见 findings：[research/03-raft-product-research.md](../research/03-raft-product-research.md)

要点：Discord 式 workspace；inbox 为拉取式（单调 seq 游标 + drain/ack + wake hint 只含 seq）；freshness-hold 竞态核心（房间版本标记 + 四选一：revise/send as-is/silent/anyway）；任务板状态机 todo→in_progress→in_review→done/closed，自动认领、互审"构建者不验证"；记忆 = workspace 磁盘目录（agent 自管文件），身份与 session 分离；reminders 服务端调度、recurrence DSL；AX 四问框架（看到什么/携带什么/能恢复什么/能决定什么）；server 源码私有，可观测性无专门文档页（复刻需自研）。
