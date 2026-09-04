# 01: 消息轮询与 merge 抽入 useChannelData

**What to build:** `hooks/useChannelData.ts` 新建，收进频道消息数据循环：loadPage / loadLatest / loadEarlier + mergeIncomingMessages 去重合并 + maxSeq/hasMore 状态。ChannelView 改调该 hook，行为不变。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [x] `useChannelData(channelId)` 返回 `{ messages, maxSeq, hasMore, loadError, loadPage, loadLatest, loadEarlier }`
- [x] hook 级测试：merge 去重（按 id）、分页拼接顺序、maxSeq 推进
- [x] ChannelView 切到 hook，删除旧内联实现
- [x] `npm test` 全绿，`tsc --noEmit` 通过

## 实施方式（强制）

本票必须走 `/implement` skill 流程实施，不接受自由发挥：

1. 先读 skill 文件：`/Users/apple/.pi/agent/skills/implement/SKILL.md`，按其流程驱动
2. 内部按 `/tdd`（`/Users/apple/.pi/agent/skills/tdd/SKILL.md`）一次一个红-绿切片推进：先写失败测试，再写实现，再重构
3. 收尾按 `/code-review`（`/Users/apple/.pi/agent/skills/code-review/SKILL.md`）双轴自审（Standards + Spec）：diff 是否符合本 repo 规范、是否忠于本票验收标准；审出问题先修再报完工
4. 命名必须用 `useChannelData`（CONTEXT.md 禁用 room 一词）；hook 测试用 node --test + jiti，自写最小 harness，不引 testing-library
5. 只做本票范围，不要碰发送/pinned/任务
