# 04: 任务板数据抽入 useChannelData

**What to build:** 任务板数据循环（loadTasks + claim/complete/unclaim/close/approve/reject/reopen 转移序列，complete 先落线程回复再置 in_review）收进 hook。TaskViews 视图与拖拽手势不动。

**Blocked by:** 01、02（需消息引用 + 发送通道，complete 依赖 send）.

**Status:** ready-for-agent

- [ ] hook 返回新增 `tasks / tasksError / taskNotice / taskOps{claim,complete,unclaim,...}`
- [ ] hook 级测试：claim 让路语义（held/conflict）、complete 两步序列、reopen 封锁标记透出
- [ ] ChannelView 切到 hook，删除旧内联实现
- [ ] `npm test` 全绿，`tsc --noEmit` 通过

## 实施方式（强制）

本票必须走 `/implement` skill 流程实施：先读 `/Users/apple/.pi/agent/skills/implement/SKILL.md`，内部按 `/tdd` 一次一个红-绿切片推进，收尾按 `/code-review` 双轴自审（Standards + Spec）后报完工。hook 测试用 node --test + jiti 自写 harness，不引 testing-library。只做本票范围。

## 票据协议（worker 必读）

- 开工直接干，不用改本文件。
- 完工后 append 一个 `## Answer` 段（改了哪些文件 + 测试命令结果 + 遗留），再 worker_done。
- 禁止碰 `Status:` 行与 `Blocked by` 行——状态收敛权归 coordinator（多 worktree 下原地改 Status 会分叉冲突）。

## Answer 必须含 review 小节（验收钩子）

完工的 `## Answer` 必须含 `code-review` 双轴自审小节：Standards（发现几个问题/无问题）、Spec（缺失/creep/实现错误各是什么）。无问题也要写"双轴自审无问题"。**没有 review 小节 = 验收不通过，打回。**
