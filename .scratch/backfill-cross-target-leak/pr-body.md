## Summary

崩溃恢复补拉的判重从「同一 target」扩到「同一频道范围」：marker 记的是频道版本，任务轮的真实投递目标是 task thread 锚点，所以补写频道顶层前要先确认这段内容没有已经落在本频道的某个 thread 里。

```diff
 applyBackfillTarget(agent, targetId, replies)
   resolveTargetChannel(targetId)            # §6.1 唯一归一化实现
+  isChannelTarget = resolved.id === targetId   # 只有「marker 指向频道本身」才跨 target 判重
   for each reply:
     hasMessageByContentByOther(reply.targetId, …)   # ADR-0004 轮级跨作者去重，不变
     cursorSeq = max(cursorSeq, markerSeq)
     hasMessage(reply.targetId, …) → 已投递，跳过
+    isChannelTarget ∧ hasAuthorContentInChannel(targetId, agent, content) → 已投递到 thread，跳过
     insertMessageAt(reply.targetId, maxSeq+1)

Store
+  hasAuthorContentInChannel(channelId, authorId, content)
     UNION ALL
       messages WHERE target_id = channelId            # 频道顶层
       messages t JOIN messages m ON m.target_id = t.id # 以顶层消息为锚点的 thread
      WHERE t.target_id = channelId
```

- 判重**只跨 target 认同作者**：ADR-0004 的轮级跨作者去重仍按同 target 原口径判定，别的作者写过的同内容不触发本 agent 的跳过。
- 命中即跳过顶层补写，**游标照常推进**——标记存在即证明该轮已投递，与同 target 幂等同一口径，不会反复重读。
- marker 指向线程的补写仍只看线程本身（线程回复不会反向漏到频道，多判一层只会增加误伤真实补拉的面）。
- 不改 schema（`SCHEMA_VERSION` 仍 15）、不加表不加列、不碰 `messages` 不可变触发器、不改回复路由与 REST 契约。

## Evidence

- **Before:** base `74e6f86` 隔离 worktree（`git worktree add --detach`，`node_modules` 软链到本 worktree），`node --test lib/agent-loop/backfill.test.mjs` → `tests 24 / pass 23 / fail 1`：

  ```text
  ✖ cross-target: a reply already delivered to the task thread is not re-inserted at channel top level
    AssertionError [ERR_ASSERTION]: 已投递到线程的回复不得再写进频道顶层
    1 !== 0
  ```

- **After:** 同一命令 → `tests 24 / pass 24 / fail 0`。新增 5 例锁定票面四条约束：
  - 线程已有同内容 → 频道顶层 0 新增，线程仍 1 条，游标推进到标记 seq（要求 1）；
  - DB 里确实不存在的回复 → 仍补写（含「线程里有本 agent 的其它进展」不误判，要求 2）；
  - marker 指向线程的轮次 → 仍补写进线程，顶层不凭空多一条（要求 2）；
  - 别的作者在线程里写过同内容 → 不触发本 agent 跳过（要求 4）；
  - 别的频道线程里有同内容 → 不触发跳过（判重作用域 = 该 target 所属频道）。
- `node_modules/.bin/tsc --noEmit` 退出码 0；`npm run lint` 0 errors（1 个既有 warning `hooks/useI18n.tsx:61`）。
- `npm test` → `tests 1541 / pass 1540 / fail 1`；唯一失败是既有 `lib/model-listing.test.mjs` 的 lite-path 环境用例（基线 `74e6f86` 同命令 1536/1535/1 同样失败）。新增 5 例 = 1536 → 1541。

## Merge Danger

**Door:** two-way

回滚只需撤回本 PR：无数据迁移、无 schema 变更、无不可逆副作用。

**Blast Radius:** localized

只影响启动期补拉 `applyBackfillTarget` 的判重层与 `Store` 的一个只读查询；运行期回复投递、wake 路由、任务状态机、REST/前端全部不动。

已知残余（票据外，建议后续票）：

1. **存量泄漏未清理**：live DB 仍有 9 对「频道顶层 + task thread 同作者同内容」重复（dev 5 / secretary-office 2 / showcase 2）。本 PR 只止血，不清洗——`messages` 有 `messages_no_delete` 不可变触发器，删除历史是破坏性 live 数据操作，需要单独票决定（旁路触发器的离线脚本 + 引用面审计：pinned / reactions / attachments / task 锚点 / 引用文本）。
2. **marker 不含真实投递 target**：DB 里确实缺失的**任务轮**回复仍按 marker 落到频道顶层（内容不丢、不再重复，但 target 不是线程）。根治要改 marker 格式带上投递目标，与本票「不改回复路由」的约束冲突。
3. **内容级判重的保守面**：同作者早先在 thread 投递过的**短回复**（如 `Acknowledged.`）会让本轮真实的频道补拉被保守跳过，只留 `[backfill] … skipped … cursor advanced` 日志。这是要求 1（不得重复）与要求 2（不得丢补拉）之间的取舍，已按「重复不可接受、跳过可见」取向选择。
4. **文档未同步**：ADR-0004 / CONTEXT.md / AGENTS.md 的补拉契约仍只描述「同 target 同作者判重」。这三份文件在本票 Target 之外且本票显式不跑 G-docs，留待后续票补。

## Closes

无对应 GitHub issue：票据正本在仓内 `.scratch/backfill-cross-target-leak/issues/01-backfill-cross-target-leak.md`（Status: resolved，Answer 含红→绿证据、存量清单与双轴复核）。
