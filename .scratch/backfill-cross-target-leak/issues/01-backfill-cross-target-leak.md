# 崩溃恢复补拉的跨 target 判重：已投递到 task thread 的回复不得再写进频道顶层

Type: task
Status: in-progress

## What to build

修掉「消息渗透进 main session」：已投递到 task thread 的回复，被崩溃恢复补拉（backfill）再次写进频道顶层，同一段内容在两处各存一份。

现场（2026-10-20，showcase 频道 `814f48c1-4d3a-4c49-8b06-99f5b4834ca2`，task #1 锚点 `589e26ed-6094-43f2-bc10-c0589b9ee442`）：

- thread `589e26ed` 内 seq 1（MattDev，02:18:12.465Z，2673 字符）与 seq 3（Susan，02:18:31.322Z，2113 字符）；
- 频道顶层 seq 8（MattDev，03:08:04.367Z）与 seq 7（Susan，03:08:04.354Z）与上面两条**逐字节相同**；
- 两条顶层消息的 `created_at` 与 next-server 启动时刻（11:07:58 本地 = 03:07:58Z）相邻 —— 补拉落库；
- 频道 seq 6 是 Owner 的「Task #1 created」事件；PR #190 起 agent 的回复按路由投递到 task thread。

根因：回拉按「内容存在于**同一 target**」判重（`hasMessage(targetId, authorId, content)`），而 `scanSessionReplies` 从房间标记 `[worksplice:target=814f48c1 seq=6]` 推断出的是**频道**——标记记的是频道版本，真实投递目标是 thread 锚点。于是判重查频道、命中不到「已存在于 thread」，内容被补写进频道顶层。

必须同时满足：

1. 不得把已投递到 task thread 的回复再写进频道顶层：判重跨 target 成立（同作者 + 同内容已存在于本频道任一 thread ⇒ 顶层不补写）。
2. 不得因此丢掉真正的补拉：DB 里确实不存在的回复仍必须补写进它所属的 target。
3. 不得回拉本 agent 未投递过的内容：回拉只认 session jsonl 里带房间标记的 assistant 轮次（`scanSessionReplies` 契约不变）。
4. 判重跨 target 时 author 仍必须是同一 member（ADR-0004 的轮级跨作者去重维持同 target 原口径）。
5. 存量泄漏的处理方式（脚本 / 留给后续票 / 其它）需在 Answer 说明理由。

## Acceptance

- [ ] 必红 → 必绿：base `74e6f86` 隔离 worktree 上取得红证据（已投递到 task thread 的回复被回拉补写进频道顶层），修复后同命令转绿；三条必需回归齐备——(1) 线程已有同内容 → 顶层不新增；(2) DB 确实不存在 → 仍补写；(4) 别的作者同内容不触发跳过。
- [ ] 基线说明：`74e6f86` 上 `npm test` = 1536 tests / 1535 pass / 1 fail（唯一失败 `lib/model-listing.test.mjs` 的 lite path 用例，本机模型目录环境问题）；typecheck 退出码 0；lint 0 errors / 1 warning（`hooks/useI18n.tsx:61`，既有）。
- [ ] `node --test lib/agent-loop/backfill.test.mjs` 全绿；`node_modules/.bin/tsc --noEmit` 退出码 0；`npm run lint` 0 errors；`npm test` 允许上述那条既有失败，其余不得新增失败。
- [ ] 存量现状：报告当前 DB 里的跨 target 重复内容对数（只读取证），并说明处理方式与理由。
- [ ] 双轴 code-review（Standards + Spec 两份独立报告）写入 Answer，findings 逐条处置或记录不采纳理由。
- [ ] 本机 pr skill 模板写 PR body，`--body-file` 创建 PR；PR 号与 body 路径回填 Answer。
- [ ] 交付前 `git status --porcelain` 为空；改动文件列表与 commit SHA 回填 Answer。

## Constraints

- 只改 Target 列出的文件；**不改 DB schema**（schema v15 不动）——跨 target 判重用 `Store` 接口新增查询方法实现。
- `messages` 表有不可变触发器（`messages_no_update` / `messages_no_delete`），回拉写路径不得依赖 UPDATE/DELETE 绕过。
- ADR-0004（文件级归属门禁 + 轮级跨作者去重）既有语义不得被削弱。
- 不改前端、不改 REST 契约、不改 agent-loop 的回复路由逻辑（PR #190 已定：任务回复落 thread）。
- 不跑 `next build`；不改 `~/.worksplice/worksplice.db`（只读取证）。

## Comments

- 2026-10-20：按 coordinator 的 ticket 正本路径创建本票；base `74e6f86`（= 本 worktree HEAD）用 `git worktree add --detach` 隔离取证，`node_modules` 软链到本 worktree 保持依赖一致。
