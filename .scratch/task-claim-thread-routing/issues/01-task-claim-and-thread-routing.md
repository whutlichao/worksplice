# 任务创建后的认领与线程路由

Type: task
Status: in-progress
Spec: [spec.md](../spec.md)

## What to build

修复 Owner 通过“发送消息并创建任务”创建频道任务后的认领与答复路由。以实际任务创建入口进入 task event、wake、drain 和 agent-loop seam，确保合格 agent 认领并把答复写入任务锚点线程；竞争认领失败者让路，普通频道消息继续回复频道 target。保留 freshness、认领互斥、状态机和既有普通消息语义。

## Acceptance

- [ ] 有能在当前实现复现症状的确定性快速回归命令，并记录红→绿与原始复现复跑输出。
- [ ] 测试经实际“发送消息并创建任务”路径与 agent-loop seam，检查任务 owner/status 及持久化 reply target。
- [ ] 覆盖成功认领、锚点线程答复、竞争失败者不发频道顶层任务回复、普通频道回复仍正常。
- [ ] 完成 diagnosing-bugs 假设验证；全量测试、typecheck、lint 记录真实输出。
- [ ] Answer 包含两份独立 Standards / Spec review 报告及 PR 号；Status 为 resolved，工作区干净。

## Comments

- 2026-10-10 Q→A：本 Dispatch 的任务文本已完整给出问题、范围与验收，但当前 checkout 的 `.scratch` 中没有对应 feature/ticket 文件。Coordinator 按 `docs/agents/issue-tracker.md` 的本地 Markdown 约定指定本票路径为 `.scratch/task-claim-thread-routing/issues/01-task-claim-and-thread-routing.md`，并指定 `1c6db0a` 为 review fixed point；该提交经 coordinator 只读确认同时是当前 `main` 与 `origin/main`。据此创建本 `spec.md` 与 issue 正本后继续收敛。
