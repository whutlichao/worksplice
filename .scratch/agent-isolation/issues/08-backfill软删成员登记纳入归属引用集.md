# 08-backfill软删成员登记纳入归属引用集

Type: task
Blocked by: 06
Status: resolved（2026-08-12）

## Answer

**修复落地（代码级）：** `referencedSessionFilesExcluding` 的引用集来源从 `listMembers()`（`deleted=0` 过滤）切换为新增的 `listMembersIncludingDeleted()`（`lib/data/db.ts`，原始行全量查询，与 `getMember`/`getMemberByName` 含软删先例同构）——软删成员的 `pi_session_file` 固化登记重新进入引用集，被删成员仍登记的文件 = 「被其他成员固化引用」→ 门禁第二条（`session file also referenced by another member`）拦截：整文件跳过、不补写、不推进游标、记 warn 日志。语义自洽：ADR-0003 凭证 = 固化登记，软删保留行正是为承载所有权事实（消息外键），backfill 侧同样尊重它；04 界定不变——backfill 不清绑，自愈仍归 startSession。

**验证（全绿）：**
- `lib/agent-loop/backfill.test.mjs` 16/16 pass——`ticket06: RED` 用例变绿（`inserted 0`、频道无作者错乱消息、游标不推进），04 既有五条门禁用例（cross-cwd / 双绑定 / mtime / 跨作者去重 / 正常通过）零回归
- 全量：`node --test lib/agent-loop/*.test.mjs lib/raft/*.test.mjs` 301/301 pass；`tsc --noEmit` + `npm run lint` 干净
- ⚠️ 已改 `lib/agent-loop/backfill.ts`：dev server 必须重启才生效（`ps aux | grep next-server` 启动时间晚于改动）

## Question

症状②在 backfill 侧的残留路径：B 的 `pi_session_file` 残留指向 A 的文件（03 修复前的粘性继承脏数据），A 软删除后 **B 的 backfill 归属门禁放行**，A 崩溃窗口的未投递回复被按 B 作者补写（作者错乱）。06 已立红灯基线 `ticket06: RED — a soft-deleted member's registered file is not backfilled by a sharing member (residual binding)`（`lib/agent-loop/backfill.test.mjs`），本 ticket 修复使其变绿。

**根因（06 已代码级确认）：** `deleteAgent` 软删除保留成员行且**不清 `pi_session_file`**（`lib/raft/members.ts`）——被删成员的固化登记仍在 DB 里；但 `referencedSessionFilesExcluding`（`lib/agent-loop/backfill.ts`）的引用集来自 `listMembers()`（`deleted=0` 过滤，`lib/data/db.ts`），软删成员被排除。门禁三项：header cwd 匹配（同目录）✓、无活成员引用（A 被过滤）✓、mtime ≥ B 创建时间（A 在 B 创建后跑过）✓ → 全过 → `scanSessionReplies` 解析出 A 的未投递回复 → 跨作者内容去重拦不住（内容从未落库）→ 按 B 作者补写并推进游标。修复前，backfill 先于 startSession 运行（`startAgentLoop` 启动序），错绑自愈来不及生效。

**修复方向（ADR-0003 语义自洽）：** 凭证 = 固化登记，软删保留行正是为承载所有权事实（消息外键）。把**软删成员的 `pi_session_file`** 纳入引用集（新建 raw 全量成员查询，`getMember`/`getMemberByName` 已有含 deleted 的先例），被删成员仍登记的文件 = 「被其他成员固化引用」→ 整文件跳过、不补写、不推进游标、记 warn 日志。startSession 侧的 03 自愈语义不变（backfill 门禁与自愈是两条独立防线，04 Answer Q3 已界定：backfill 不清绑）。

## Notes

- 验收：`ticket06: RED` 用例变绿且 04 既有 5 条门禁用例不回归；`tsc --noEmit` + `npm run lint` + `node --test lib/agent-loop/*.test.mjs`（技能无关用例需全绿）
- 涉及文件：`lib/agent-loop/backfill.ts`（`referencedSessionFilesExcluding`）、`lib/data/db.ts`（含 deleted 的全量成员访问器）、`lib/agent-loop/backfill.test.mjs`（红灯基线已存在，无需新增，改产品代码后变绿）
- ⚠️ 热重载陷阱（AGENTS.md 明文）：改了 agent-loop 后 **dev server 必须重启** 才生效（`ps aux | grep next-server` 启动时间晚于改动）
- 关联：ADR-0003（所有权凭证=固化登记）、ADR-0004（backfill 归属门禁）、03（无主文件永不解析）、04（跨作者去重 + mtime 子集——本 ticket 补的是其「只覆盖子集」的剩余面）
- 结论记录在 `## Answer`
