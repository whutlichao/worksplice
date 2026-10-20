## Summary

task thread 内的 agent 对话改为**有界收束**：只有人类的 @mention 是确定信号，peer agent 的 @ 是注意力信号；peer 明确收束后，本 agent 不再被对话拉回（代码层收口，不靠模型自觉）。

```diff
 hasMustRespondSignal
   human @mention / DM owner message      # 确定信号（不变，不得放宽）
   own in_progress task thread activity   # 确定信号（不变）
-  any @mention of you                    # ← 删除：peer agent 的 @ 不再强制回应
+  peer agent @mention                    # 注意力信号：仍进 prompt、仍穿透 mute/未加入

 runAgentRound
   task op / auto-route                   # 优先级不变（任务进展照常落库）
   reply                                  # 新增前置判定：
+    peerClosedExchange && reply → closeWithoutPosting("peer closed the exchange")
+                                 # ack + streak 清零 + online + 零新增消息（status=yielded）
   conclude                               # #192 语义不变，与上一行共用 closeWithoutPosting
   ignore                                 # 人类的确定信号下仍 error / 不 ack / cap-ack

 hasPeerCloseSignal(agentId, incoming)
   最新一条他人消息是 agent 作者
   且其最后一句以收束语结束（一致，无补充 / 停在 / stop here / no more from me…）
   且无提问或明确请求（请 / 麻烦 / 能不能 / please / can you…）
   且本轮没有任何人类消息           → true
```

`isChannelNoise` 未加 peer 过滤（peer @ 照旧进 prompt）。`CONTEXT.md`「回应判断」「提及」与 `docs/spec.md` §3.2 @mention 行同步为人类-only + peer 收束口径。本 PR 同时 rebase 了此前的 `must-respond-human-only` 意图到当前 main，冲突按意图解（保留 #192 的 conclude 语义）。

## Evidence

- **Before:** base `74e6f86` 隔离 worktree（仅拷入测试、无实现）——
  ```
  ✖ agent @mention + ignore      actual 'error'   expected 'ignored'
  ✖ peer sign-off + reply        actual 'replied' expected 'yielded'   ← 仍产出新对话消息
  ✖ hasPeerCloseSignal           TypeError: not a function
  ✔ human @mention + ignore      error / no ack / red dot（不变）
  ```
  **After:** `node --test lib/agent-loop/loop.test.mjs lib/agent-loop/loop-tasks.test.mjs` → `tests 120 / pass 120 / fail 0`（`loop.test` 78 + `loop-tasks` 42）。
- 现场字符串 `@Susan 一致，无补充。task #1 在我名下 in_review，不动。停在。` → 判定为收束：`yielded`、ack、状态点 online、messages 零新增（行为回归覆盖）。
- 误判负例（review 后补）：`We're done with step 1, now run step 2`、`don't stop here, finish the migration`、「这个 bug 停在登录流程」、「我这边无补充，但 claim 有 bug，请修」、「能不能 wrap this up」均不算收束；人类在收束前/后发话（含无 @）都解除抑制。
- `npm run typecheck` exit 0；`npm run lint` 0 errors（1 个既有 warning `hooks/useI18n.tsx:61`）。
- `npm test` → 1546 tests / 1545 pass / 1 fail；唯一失败 `lib/model-listing.test.mjs`「lite path returns a working runtime without loading extensions」在基线 `74e6f86` 同命令复现（3 pass / 1 fail），与本 PR 无关。

## Merge Danger

**Door:** two-way

回滚只需撤回本 PR；无 schema 变更、无数据迁移、无不可逆副作用。

**Blast Radius:** localized

只动 `lib/agent-loop/loop.ts` 的确定信号判定 / peer 收束判定 / prompt rubric，外加两份测试与两处文档口径。不改 wake 路由、任务路由、REST 契约、前端或 `MUST_RESPOND_FAILURE_CAP`。

行为变化：① peer agent 的 @ 不再强制回应（若上游依赖「agent @ 必回」，需改为人类显式 @）；② thread 内 peer 收束后，本 agent 的普通回复不再落库（任务/成员 op 不受影响）。改了 agent-loop 深模块，本地 dev server 需重启（engineering-standards §5）。

## Closes

无对应 GitHub issue（本票来自 Orca 派发工单 `task_f15922e14b1c`；票据正本 `.scratch/task-thread-overdiscussion/issues/01-thread-overdiscussion.md`）。
