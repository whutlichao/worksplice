# 03: pinned 与附属区（mute/members）抽入 useChannelData

**What to build:** pinned 数据循环（loadPinned + manual/recent/az 排序 + 重排）与附属区（loadMutes/loadMembers）收进 hook。视图（pinned 区展开、BellOff 面板）不动。

**Blocked by:** 01（pinned 项引用消息）.

**Status:** ready-for-agent

- [ ] hook 返回新增 `pinnedItems / pinnedSort / setPinnedSort / reorderPinned / mutes / channelMemberIds`
- [ ] hook 级测试：三种排序、同毫秒兜底、重排顺序持久化语义
- [ ] ChannelView 切到 hook，删除旧内联实现
- [ ] `npm test` 全绿，`tsc --noEmit` 通过

## 实施方式（强制）

本票必须走 `/implement` skill 流程实施：先读 `/Users/apple/.pi/agent/skills/implement/SKILL.md`，内部按 `/tdd` 一次一个红-绿切片推进，收尾按 `/code-review` 双轴自审（Standards + Spec）后报完工。hook 测试用 node --test + jiti 自写 harness，不引 testing-library。只做本票范围。
