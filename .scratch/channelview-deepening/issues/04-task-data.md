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
