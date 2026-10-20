# 崩溃恢复补拉的跨 target 判重：已投递到 task thread 的回复不得再写进频道顶层

Type: task
Status: resolved

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

- [x] 必红 → 必绿：base `74e6f86` 隔离 worktree 上取得红证据（已投递到 task thread 的回复被回拉补写进频道顶层），修复后同命令转绿；三条必需回归齐备——(1) 线程已有同内容 → 顶层不新增；(2) DB 确实不存在 → 仍补写；(4) 别的作者同内容不触发跳过。
- [x] 基线说明：`74e6f86` 上 `npm test` = 1536 tests / 1535 pass / 1 fail（唯一失败 `lib/model-listing.test.mjs` 的 lite path 用例，本机模型目录环境问题）；typecheck 退出码 0；lint 0 errors / 1 warning（`hooks/useI18n.tsx:61`，既有）。
- [x] `node --test lib/agent-loop/backfill.test.mjs` 全绿；`node_modules/.bin/tsc --noEmit` 退出码 0；`npm run lint` 0 errors；`npm test` 允许上述那条既有失败，其余不得新增失败。
- [x] 存量现状：报告当前 DB 里的跨 target 重复内容对数（只读取证），并说明处理方式与理由。
- [x] 双轴 code-review（Standards + Spec 两份独立报告）写入 Answer，findings 逐条处置或记录不采纳理由。
- [x] 本机 pr skill 模板写 PR body，`--body-file` 创建 PR；PR 号与 body 路径回填 Answer。
- [x] 交付前 `git status --porcelain` 为空；改动文件列表与 commit SHA 回填 Answer。

## Constraints

- 只改 Target 列出的文件；**不改 DB schema**（schema v15 不动）——跨 target 判重用 `Store` 接口新增查询方法实现。
- `messages` 表有不可变触发器（`messages_no_update` / `messages_no_delete`），回拉写路径不得依赖 UPDATE/DELETE 绕过。
- ADR-0004（文件级归属门禁 + 轮级跨作者去重）既有语义不得被削弱。
- 不改前端、不改 REST 契约、不改 agent-loop 的回复路由逻辑（PR #190 已定：任务回复落 thread）。
- 不跑 `next build`；不改 `~/.worksplice/worksplice.db`（只读取证）。

## Comments

- 2026-10-20：按 coordinator 的 ticket 正本路径创建本票；base `74e6f86`（= 本 worktree HEAD）用 `git worktree add --detach` 隔离取证，`node_modules` 软链到本 worktree 保持依赖一致。

## Answer

### 根因（diagnosing-bugs）

回拉把「标记轮」按**标记里的 target** 补写，而房间标记记的是**频道版本**：PR #190 起任务回复的
真实投递目标是 task thread 的锚点消息，标记却仍是 `[worksplice:target=<频道> seq=<频道版本>]`。
`applyBackfillTarget` 的判重只有 `hasMessage(reply.targetId, …)`——查的是频道顶层，命中不到
「同一段内容已经在线程里」。于是启动扫描把已投递的回复又写了一份到频道顶层。

### 假设、预测与探测

| 排名 | 假设 | 可证伪预测 | 探测结果 |
|---|---|---|---|
| 1 | marker=频道、真实投递=线程 ⇒ 同 target 判重漏判（**根因，确认**） | 加一层「本频道任一 thread 里同作者同内容」判重后，顶层新增数 = 0 | 红测 `1 !== 0`；绿后 `inserted 0`、顶层仍 1 条、线程仍 1 条 |
| 2 | 跨作者去重误伤（`hasMessageByContentByOther` 查频道） | 本例同作者，跨作者分支不该命中 | 排除：作者不同才命中；该分支保持同 target 原口径，未见命中 |
| 3 | marker 指向线程时也漏判（`hasMessage(thread)` 没覆盖） | 构造 marker=锚点的轮次 → 应已幂等 | 排除：`hasMessage(reply.targetId, …)` 覆盖；新增用例锁定线程轮次仍正常补写 |
| 4 | scanner 把无标记的 assistant 输出也当成回复 | 去掉标记 → 不该有补写 | 排除：`assistant messages before any marker are skipped` 既有用例；scanner 未改一字 |
| 5 | 游标未推进导致反复补写 | 崩溃于 ack 前 → 应反复重写 | 排除：标记存在即推进游标（既有用例）；重复来源是判重缺失，不是游标 |

### 红 → 绿证据

基线隔离 worktree（base `74e6f86` = 本 worktree 的起点，`git worktree add --detach`，`node_modules` 软链）：

```sh
RED="$TMPDIR/opencode/ws-red-backfill-74e6f86"   # 74e6f86afc5487b094610ddac166f6c2a5410163
git worktree add --detach "$RED" 74e6f86
ln -s "$PWD/node_modules" "$RED/node_modules"
cp lib/agent-loop/backfill.test.mjs "$RED/lib/agent-loop/"
cd "$RED" && node --test lib/agent-loop/backfill.test.mjs
```

红（基线 + 最终测试文件）：

```text
ℹ tests 24
ℹ pass 23
ℹ fail 1
✖ cross-target: a reply already delivered to the task thread is not re-inserted at channel top level
  AssertionError [ERR_ASSERTION]: 已投递到线程的回复不得再写进频道顶层
  1 !== 0
```

绿（本 worktree，同一命令）：`tests 24 / pass 24 / fail 0`。

### 实现（seam / interface）

- **Store 新查询**：`hasAuthorContentInChannel(channelId, authorId, content)`——`UNION ALL` 两段
  （频道顶层 / 以顶层消息为锚点的 thread），两段都走 `UNIQUE (target_id, seq)` 的 `target_id`
  索引范围查。thread 不可嵌套（§6.1），一层锚点解析即穷尽频道内全部 target。
- **判重层**（`applyBackfillTarget`）：`resolveTargetChannel(targetId)` 归一化后收窄为
  `isChannelTarget = resolved.id === targetId`——只有「marker 指向频道本身」才跨 target 判重；
  marker 指向线程的补写仍只看线程本身（线程回复不会反向漏到频道，多判一层只会扩大误伤真实补拉的面）。
  命中即跳过顶层补写、**游标照常推进**（标记存在即证明该轮已投递，与同 target 幂等同一口径）。
- **同作者约束**：跨 target 层只认同作者；ADR-0004 的轮级跨作者去重（`hasMessageByContentByOther`）
  仍按**同 target** 原口径判定，语义未被削弱。
- 不改 schema（`SCHEMA_VERSION` 仍 15），不加表不加列、不碰 `messages_no_update` /
  `messages_no_delete`，不改前端 / REST / 回复路由。回拉判重是**读**，写路径仍只有 `insertMessageAt`。

### 存量现状（只读 `~/.worksplice/worksplice.db`）

```sql
SELECT c.name, count(*) FROM messages top
JOIN channels c ON c.id = top.target_id
JOIN messages reply ON reply.author_id = top.author_id AND reply.content = top.content AND reply.id != top.id
JOIN messages anchor ON anchor.id = reply.target_id AND anchor.target_id = c.id
GROUP BY c.name;
```

| 频道 | 对数 | 顶层 seq / 线程 seq | 长度 | 作者 | 顶层 created_at |
|---|---|---|---|---|---|
| dev | 5 | 16/1、19/1、23/1、29/1、40/1 | 75 / 52 / 35 / 47 / 795 | f29c6e3e…（同一 agent） | 10-10 04:35 … 10-12 16:08 |
| secretary-office | 2 | 9/1、140/1 | 353 / 2336 | f29c6e3e… / e83e3800… | 10-05 15:41、10-20 02:16 |
| showcase | 2 | 7/3、8/1 | 2113 / 2673 | 07edf1f2… / e83e3800… | 10-20 03:08（服务器启动 6 秒后） |

合计 **9 对**，全部形态一致：同作者、逐字节相同内容，thread 副本更早、频道顶层副本更晚。
dev 的 5 对发生在 10-10/11/12（早于 PR #190），确认这不是 #190 引入的新缺陷，而是更早就存在、被 #190 放大。

**处理方式：本票不写清洗脚本，留给后续票。** 理由：`messages` 有 `messages_no_delete` /
`messages_no_update` 不可变触发器，删除频道顶层副本必须 DROP TRIGGER 旁路（`fix-reply-json-leak.mjs`
的先例是 UPDATE 修复，不是删历史），而且删除前要审计引用面（pinned / reactions / attachments /
task 锚点 / 引用文本 / FTS），并决定被删消息留下的 seq 空洞是否可接受——这是一次破坏性 live 数据
操作，属于需要人类决策 + 单独迁移设计的范围，不在「行为修复」票内。本 PR 的职责是止血（不再新增），
存量 9 对保持现状可读（主题内容在线程里仍然完整）。

### 双轴代码复核

固定点 `74e6f86`（`git diff 74e6f86...HEAD`），两个独立 sub-agent 并行，互不共享上下文。

#### Standards（首轮）

> 硬违规：(1) 决策未落 ADR-0004 / CONTEXT.md（`docs/engineering-standards.md` §5）；(2) AGENTS.md
> 「agent-loop」段仍写补拉「同 target 同作者同内容去重」；(3) 票据 Status 仍 in-progress、无 Answer。
> 判断项：(4) Duplicated Code——`db.getChannel(targetId)` 绕过 `resolveTargetChannel` 这个归一化单点；
> (5) Speculative Generality——`OR m.target_id = ?` 在唯一调用点不可达且名字过度承诺；
> (6) Mysterious Name——`threadDelivered` 计的是被跳过的轮数；(7) 两个 warn 块同形；
> (8) 行内注释与 doc block 重复；(9) 测试 5 处同形 `writeSessionFile`。

#### Spec（首轮）

> (a) 缺失：存量对数 / 处理方式 / Answer / PR 未落地；红证据未留痕；收尾项未做。
> (b) scope creep：无，改动面严格落在 Target 内。
> (c) 可疑：要求 2 只做到一半（DB 里确实缺失的**任务轮**回复仍落到频道顶层，target 不是线程）；
> 内容级判重无轮级区分（短回复可能让真实补拉被保守跳过）；判重覆盖「任一 thread」而非仅 task thread。

#### findings 处置

| # | Finding | 处置 |
|---|---|---|
| S-1 | ADR-0004 / CONTEXT.md 未记录新决策 | **不采纳（越界）**：不在本票 Target，且本票显式不跑 G-docs；已在 PR「已知残余 4」与本节记录待办 |
| S-2 | AGENTS.md 补拉契约陈述过期 | **不采纳（越界）**，同上 |
| S-3 | 票据 Status/Answer 未收口 | **已处置**：本节 + `Status: resolved` + Acceptance 勾选 |
| S-4 | 归一化绕过 `resolveTargetChannel` | **采纳**：改用 `resolveTargetChannel` 再收窄 `resolved.id === targetId` |
| S-5 | `OR m.target_id = ?` 不可达 + 名字过度承诺 | **部分采纳**：改写为 `UNION ALL` 双段（两段都走 `target_id` 索引），方法契约不再依赖调用顺序；顶层段保留是 interface 语义的一部分（见「取舍」） |
| S-6 | `threadDelivered` 命名 | **采纳**：`skippedAsThreadDelivered` |
| S-7 | 两个 warn 块折成数组循环 | **不采纳**：两种失败原因、两种日志文本（跨作者 / 跨 target），合并只增加间接层，且测试与运维按文本检索 |
| S-8 | 行内注释与 doc block 重复 | **采纳**：行内只留归一化事实 |
| S-9 | 测试 5 处同形 `writeSessionFile` | **采纳**：抽 `writeMarkerRound(agent, markerTarget, markerSeq, replyText)` |
| P-1 | 存量 / Answer / PR 未落地 | **已处置**：本节清单 + PR body |
| P-2 | 红证据未留痕 | **已处置**：上方红 → 绿证据 |
| P-3 | 任务轮缺失回复仍落频道顶层 | **已知残余**：marker 不含投递 target，根治要改 marker 格式并动回复路由（越出本票约束）；记入 Answer + PR |
| P-4 | 短内容保守跳过 | **取舍并记录**：要求 1（不得重复）优先于要求 2 的极端情形；跳过留 `[backfill] … cursor advanced` 日志 |
| P-5 | 判重覆盖「任一 thread」而非仅 task thread | **确认一致**：票面括号定义即「thread 的 target 是该频道某条顶层消息的 id」 |

#### 复核轮（改后同一固定点）

> Standards：「处置陈述与事实不符的：无」；无残留硬违规；新增三条轻微判断项——
> ① `topLevelChannelId` 恒等于 `targetId`（恒等变量）；② F8 只删了字面重复，语义重复仍在；
> ③ UNION 顶层段在当前调用点被前置 `hasMessage` 覆盖；④「跳过即推进游标」是 ADR-0004 拒绝的
> 半截态形态（归属门禁语境），本票要求 1 显式授权。
> Spec：「确认 (1)–(4) 在最终实现中成立」，逐条指名锁定用例；scope creep 无；代码层未满足项无。

复核轮处置：①**采纳**→ `isChannelTarget` 布尔谓词、查询直接用 `targetId`；②**采纳**→ 行内注释只留归一化事实；
③**记录取舍**：方法语义是「频道范围内」，保留顶层段使它的正确性不依赖调用方先查过什么；代价只是一次
索引范围查（补拉是启动期低频路径）。④**记录依据**：ADR-0004 的「不推进游标」服务于**归属存疑**（可能是
他人回复，留 pending 让正常 wake 重读）；本层命中是**本 agent 自己已投递**的确证，推进游标才是正确收口。

### 门禁数字（基线来源 commit `74e6f86`，与本 worktree 起点同源）

| 门禁 | 基线 `74e6f86` | 本票 HEAD |
|---|---|---|
| `node --test lib/agent-loop/backfill.test.mjs` | 19/19（新增 5 例未加时）→ 加入最终测试文件后 24 / 23 pass / 1 fail（红证据） | 24 / 24 pass / 0 fail |
| `node_modules/.bin/tsc --noEmit` | 退出码 0 | 退出码 0 |
| `npm run lint` | 0 errors / 1 warning（`hooks/useI18n.tsx:61`） | 0 errors / 1 warning（同一处） |
| `npm test` | 1536 / 1535 pass / 1 fail（`lib/model-listing.test.mjs` lite path） | 1541 / 1540 pass / 1 fail（同一处） |

新增 5 例 = 1536 → 1541；无新增失败。

### 交付物

- 改动文件：
  - `lib/agent-loop/loop.ts`（跨 target 判重层）
  - `lib/data/store.ts`（`Store` 新查询方法）
  - `lib/data/sqlite.ts`（`hasAuthorContentInChannel` 实现）
  - `lib/agent-loop/backfill.test.mjs`（+5 回归、`writeMarkerRound` 辅助）
  - `.scratch/backfill-cross-target-leak/issues/01-backfill-cross-target-leak.md`、`pr-body.md`
- commit：`4fe0e45`（修复 + 回归）、`71fd28f`（查询改 UNION ALL、归一化收窄）、`af1c553`（布尔谓词）、
  后续 docs commit（本 Answer + PR body）
- PR：**#193**，body 路径 `.scratch/backfill-cross-target-leak/pr-body.md`，
  https://github.com/whutlichao/worksplice/pull/193
