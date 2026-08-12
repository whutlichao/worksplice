# 11-error轮语义收口与baseSeq补全

**What to build:** review 整改（Standards #1/#3 + Spec #2/#3 同源）：
1. `deliverWithFreshness` 的 `revised reply had no content` 从 `silent` 改为 `error`（不推进游标、error 状态点、pending 供下次 wake 重试）——与直接空 reply 路径（已是 error）归类一致；`isAbandonedRound` 不再把它标成「已放弃」，badge 不再说谎（现状：silent → 标 badge，但实际会重试）。`revised to ignore` 保持 silent（ackSeq 已推进、真正终止，语义成立）。
2. 所有 error 轮补 baseSeq：`runAgentRound` 的 prompt-fail 分支（`{ status: "error", reason: first.error }`）与 catch 分支不带 baseSeq → round_logs `base_seq=0`，可观测页「#baseSeq」显示 0，与 07「每轮 status/reason/target/#baseSeq/时间」承诺不符。补上本轮 `baseSeq`（= drained.maxSeq）。

**Blocked by:** None — can start immediately

**Status:** done

- [x] revise 空内容轮：status 归 error、不推进游标、publish error；`revised to ignore` 保持 silent 不变
- [x] prompt-fail / catch 的 error 轮携带 baseSeq（round_logs `base_seq` 非 0）
- [x] 测试：loop.test.mjs revise 空内容断言 silent→error；rounds 断言 error 轮 base_seq 正确
- [x] `tsc --noEmit` + `npm run lint` + `node --test lib/agent-loop/*.test.mjs lib/raft/*.test.mjs` 全绿（311 通过）
- [x] 改 agent-loop 相关代码后 dev server 必须重启验证（当时无 dev server 在跑，无陈旧闭包）
