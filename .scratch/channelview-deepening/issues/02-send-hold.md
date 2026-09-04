# 02: 发送与 freshness-hold 抽入 useChannelData

**What to build:** 发送通道收进 hook：handleSend（含 baseSeq 携带、held 后重拉提示 heldNotice）+ busAction/busy 状态。依赖 01 的 maxSeq/baseSeq。

**Blocked by:** 01（需 maxSeq/baseSeq 来源稳定）.（01 已 resolved@2ed55b7，可开工）

**Status:** ready-for-agent

- [ ] hook 返回新增 `send / heldNotice / busyAction`，held 语义与现有 UI 提示一致
- [ ] hook 级测试：正常发送、held 后重拉、重试耗尽行为
- [ ] ChannelView 切到 hook，删除旧内联实现
- [ ] `npm test` 全绿，`tsc --noEmit` 通过

## 实施方式（强制）

本票必须走 `/implement` skill 流程实施：先读 `/Users/apple/.pi/agent/skills/implement/SKILL.md`，内部按 `/tdd` 一次一个红-绿切片推进，收尾按 `/code-review` 双轴自审（Standards + Spec）后报完工。hook 测试用 node --test + jiti 自写 harness，不引 testing-library。只做本票范围。

## 票据协议（worker 必读）

- 开工直接干，不用改本文件。
- 完工后 append 一个 `## Answer` 段（改了哪些文件 + 测试命令结果 + 遗留），再 worker_done。
- 禁止碰 `Status:` 行与 `Blocked by` 行——状态收敛权归 coordinator（多 worktree 下原地改 Status 会分叉冲突）。
