# 14 — agent-loop 重试收敛 + prompt 截断

**What to build:** freshness-hold 烧 token 的主成本路径收敛：`MAX_REVISE_RETRIES 2→1`、`MAX_RESEND_RETRIES 3→1`、`MAX_TASK_STATUS_RETRIES 3→2`，默认 `onConflict` 由 `revise` 改 `resend`（held 后原样重试一次、耗尽 silent）；prompt 保守压缩（`MESSAGE_CONTENT_CAP=4000/条` + 最近 20 条 + 任务 preview 120 字截断）；不引入模型路由；`MUST_RESPOND_CAP=2`、error/silent 分级、backfill 双层门禁与"标记存在即推进游标"语义全部不变。行为变化：单轮 freshness-hold 重试次数与每轮上下文尺寸显著下降，成本可预测。

**Blocked by:** 11 — cwd 互斥唯一事实来源（driver 与 round 同文件 gate）

**Status:** ready-for-agent

- [ ] 三组重试常量收敛 1/1/2，默认 `revise→resend`（held 后原样重试一次、耗尽 silent），`revised reply had no content → error（不推进）` / `silent（推进）` 分级不变
- [ ] prompt 截断生效：每轮上下文尺寸下降（最近 20 条 + 任务 preview 120 截断，`MESSAGE_CONTENT_CAP=4000` 保留）
- [ ] `MUST_RESPOND_CAP=2` 与 cap-ack 语义、backfill 双层门禁、游标"标记即推进"不变
- [ ] agent-loop 单测（fake `LoopRuntime` 注入）：重试/截断用例回归 + 新增 1/1/2 与默认 resend 用例；全量门禁 `tsc --noEmit + npm run lint + npm test`（347）全绿
- [ ] 改 loop.ts 深模块后手动验证：dev server 重启，`ps aux | grep next-server` 启动时间晚于改动（热重载陷阱）