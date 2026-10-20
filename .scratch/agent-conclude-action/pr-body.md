## Summary

新增回复协议动作 `conclude`：确认收到但不发帖，用于已收束对话 / 纯收尾确认的 @mention。

```diff
 parseAgentAction
   direct JSON
   first protocol JSON in noisy text
   parseLeakedReply
+    action: reply | ignore | conclude
+    reason?: string   # conclude only, trimmed non-empty

 runAgentRound
   task op / auto-route        # priority unchanged
+  conclude                    # ack + reset must-respond streak + online, zero messages
   ignore                      # error / cap-ack semantics unchanged

 deliverWithFreshness
   held → revise
+    revised conclude → silent / "revised to conclude"
     revised ignore   → silent / "revised to ignore"
     revised empty    → error
```

轮次结果复用 `yielded`，以 reason 前缀 `concluded:` 区分；不新增 round_logs 状态、不改 schema。prompt rubric、CONTEXT.md、docs/spec.md §3.2 同步。

## Evidence

- **Before:** `{"action":"conclude"}` 会被解析成无 content 的 reply，落入 `reply action without content` error 轮（不 ack、error 状态点）；确定信号下只有 `ignore`，而它会记失败并最终 cap-ack。
- **After:** `node --test lib/agent-loop/loop.test.mjs lib/agent-loop/loop-tasks.test.mjs` → `tests 110 / pass 110 / fail 0`。新增用例覆盖：
  - parse 三条路径接受 conclude 并保留 trim 后的 reason；
  - @mention + conclude → `yielded` / `concluded: thread concluded` / 游标 ack / messages 零新增 / 状态 `online`；
  - 同场景 ignore 仍为 error；conclude 清零 streak 后新的 ignore 只记一次失败；
  - 泄漏修复路径接受 conclude、拒绝未知/非字符串 action；
  - freshness 重写为 conclude → `silent` / `revised to conclude`。
- `npm run typecheck` 通过；`npm run lint` 0 error。
- `npm test`：1536 tests / 1535 pass / 1 fail；唯一失败 `lib/model-listing.test.mjs` 的 lite-path 用例在基线 `35dabb9` 同命令复现，与本改动无关。

## Merge Danger

**Door:** two-way

回滚只需撤回本 PR；无数据迁移、无 schema 变更、无不可逆副作用。

**Blast Radius:** localized

只影响 agent-loop 的回复协议与轮次收口：新增一个 action 分支，不触碰 wake 路由、任务路由、ignore 失败语义、`MUST_RESPOND_FAILURE_CAP`、UI 状态点映射；`conclude` 不写 messages 表，仅推进游标。
