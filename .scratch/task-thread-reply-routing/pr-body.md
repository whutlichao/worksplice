## Summary

频道轮次的任务回复路由：判定信号从「drain 里没有其他作者活动」改为「本轮最新一条其他作者消息」，Owner 创建事件按其 `#N` 投到对应任务线程。

```diff
 runAgentRound
   drain
-  claimTaskFromReply
-    hasOtherActivity → 有更早未读消息就放弃 claim
-    普通 reply 直接回频道
+  resolveTaskReplyRoute
+    只看 incoming 最新一条：
+      Owner 的 Task #N created 且 N 是开放任务
+        无 owner → claim（held 按 roomSeq 同轮重试，上限 3）
+        owner（自己/他人）→ 直接回锚点线程
+    否则 → pending（仅 held 耗尽的任务）→ 普通频道回复
```

- held 耗尽：游标停在 `event.seq - 1`，同进程记住 agent+task，下一轮没有更新的任务信号时优先 claim。
- 线程投递 `error` / `silent` 不推进频道游标；done/closed 创建事件不落 pending；崩溃窗口不早退。
- 频道顶层新增任务回复恒为 0（A–D 全路径），`reply` 之外的 op 目标不变。

## Evidence

- **Before:** 基线 21878b9 隔离 worktree，`node --test lib/agent-loop/loop-tasks.test.mjs` → 40 tests / 26 pass / 14 fail；R1/R2/D 的回复 target 是频道 id，R3/R3b 为 `error`，R3c 游标 `5 !== 3`（事件被频道 ack 消费），R4 `skipped`。
  **After:** 同一命令 → 40 tests / 40 pass / 0 fail；`npm test` 1529 tests / 1528 pass / 1 fail（唯一失败是既有的 `model-listing` 环境用例，基线同样失败）。
- `npm run typecheck` exit 0；`npm run lint` 0 error（1 个既有 warning）。

## Merge Danger

**Door:** two-way

**Blast Radius:** agent-loop 的任务回复路由；显式 `task` op、claim 互斥、freshness-hold、reopened 封锁与任务状态机不变。

- 票据外文档（CONTEXT.md / AGENTS.md）仍描述旧的「非 owner 让路」语义，需另开票据同步；本 PR 未改这两个文件。
