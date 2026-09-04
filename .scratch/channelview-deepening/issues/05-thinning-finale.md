# 05: ChannelView 瘦身收尾与回归

**What to build:** 删除 ChannelView 内已迁移的残留代码，视图测试瘦身（只覆盖排版回归，不再挂载全量数据循环），全量回归验证。

**Blocked by:** 01、02、03、04（全部迁移完成后）.

**Status:** ready-for-agent

- [ ] ChannelView 无残留数据循环代码，行数显著下降（目标 <2000 行）
- [ ] ChannelView.test.mjs 瘦身仍绿；新增的 4 个 hook 测试文件全绿
- [ ] `npm test` + `tsc --noEmit` + `npm run lint` 全过
- [ ] arch-review 内 `git diff --stat` 可读，行为零变更（无功能改动）

## 实施方式（强制）

本票必须走 `/implement` skill 流程实施：先读 `/Users/apple/.pi/agent/skills/implement/SKILL.md`，内部按 `/tdd` 一次一个红-绿切片推进，收尾按 `/code-review` 双轴自审（Standards + Spec）后报完工。hook 测试用 node --test + jiti 自写 harness，不引 testing-library。只做本票范围。

## 票据协议（worker 必读）

- 开工直接干，不用改本文件。
- 完工后 append 一个 `## Answer` 段（改了哪些文件 + 测试命令结果 + 遗留），再 worker_done。
- 禁止碰 `Status:` 行与 `Blocked by` 行——状态收敛权归 coordinator（多 worktree 下原地改 Status 会分叉冲突）。

## Answer 必须含 review 小节（验收钩子）

完工的 `## Answer` 必须含 `code-review` 双轴自审小节：Standards（发现几个问题/无问题）、Spec（缺失/creep/实现错误各是什么）。无问题也要写"双轴自审无问题"。**没有 review 小节 = 验收不通过，打回。**
