# Orca 派活检查单

每次 `worker-start` / `dispatch` 前逐项确认。不跳项。

- [ ] 任务定级：实施 / 多票并行 / 修 bug / 调研 / 架构评审 / 设计验证 / 合并冲突 / 外部 triage / 需人类步骤？
- [ ] spec 写了 skill 前置（含 `~/.pi/agent/skills/<name>/SKILL.md` 路径 + 本次关键约束），而非只写"好好做"？
- [ ] 实施票：`implement` + `tdd` + `code-review` 三件套齐了？验收标准是行为级（非文件行级）？
- [ ] 多票：frontier 顺序对吗？worktree 隔离了吗？合流与统一 review 安排了吗？
- [ ] bug 票：要求了 tight 回路先行 + 回归测试 + 清理 `[DEBUG-]`？
- [ ] 报告票：产物绝对路径 + 只读约束（不改代码）写了吗？
- [ ] 需人类步骤：明确标了 ask/escalate，不许编？
- [ ] 词汇：`codebase-design` 术语 + CONTEXT.md 禁词（如 room）提醒了吗？
- [ ] worker_done 验收：改了哪些文件 + 测试命令结果 + 行为变化，齐了吗？
- [ ] 复用终端？先 `terminal list` 看 preview 确认空闲——busy 终端 worker-start 会超时熔断并把 task 打成 failed。
- [ ] 文档先行？新 effort 的 spec/tickets 是否已 commit + push（新 worktree 从 origin/main 切，自带票据）？
- [ ] 票据协议写进 spec 了？worker 只 append Answer，Status/Blocked by 收敛权归 coordinator（验收时统一改）。
- [ ] 单分支？所有改动（含票据收敛）只落在任务 worktree，main 保持干净，完工走 PR 合并？
- [ ] lint 在任务 worktree 内对改动文件做增量对照（改前改后），不去 main 上跑全仓？
- [ ] Answer 有 review 小节？无 review 小节验收不通过，直接打回补审。
