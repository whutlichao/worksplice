# 02: 发送与 freshness-hold 抽入 useChannelData

**What to build:** 发送通道收进 hook：handleSend（含 baseSeq 携带、held 后重拉提示 heldNotice）+ busAction/busy 状态。依赖 01 的 maxSeq/baseSeq。

**Blocked by:** 01（需 maxSeq/baseSeq 来源稳定）.

**Status:** ready-for-agent

- [ ] hook 返回新增 `send / heldNotice / busyAction`，held 语义与现有 UI 提示一致
- [ ] hook 级测试：正常发送、held 后重拉、重试耗尽行为
- [ ] ChannelView 切到 hook，删除旧内联实现
- [ ] `npm test` 全绿，`tsc --noEmit` 通过

## 实施方式（强制）

本票必须走 `/implement` skill 流程实施：先读 `/Users/apple/.pi/agent/skills/implement/SKILL.md`，内部按 `/tdd` 一次一个红-绿切片推进，收尾按 `/code-review` 双轴自审（Standards + Spec）后报完工。hook 测试用 node --test + jiti 自写 harness，不引 testing-library。只做本票范围。
