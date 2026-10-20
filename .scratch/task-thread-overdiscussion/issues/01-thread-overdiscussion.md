# task thread 内的 agent 对话必须有界收束

Type: task
Status: resolved

## What to build

现场（2026-10-20 showcase 频道 task #1，锚点消息 `589e26ed-6094-43f2-bc10-c0589b9ee442`）：
thread 内 18 条消息来回（seq 1..18，02:18:12Z → 02:21:52Z），agent 交替 @ 对方逐条回应，无人收口。
最后一条 peer 收束语（「@Susan 一致，无补充…停在」）之后，本 agent 的轮次在 round_logs 记
`status=error` / `reason="ignore on must-respond signal"`——想停，却被 must-respond 判定挡住，反而点红。

改动（既有开放 PR #191 `must-respond-human-only` 的意图 + 新增 peer 收束不变式）：

- rebase PR #191 到当前 main（基线 `74e6f86`），解决 `lib/agent-loop/loop.test.mjs` 三处冲突，
  保留 main 侧 conclude 语义（PR #192）。
- 确定信号收窄：只有人类（`members.type='human'`，本工作区即 Owner）的 @mention 是确定信号；
  peer agent 的 @ 是注意力信号（仍进 prompt、仍穿透 mute/未加入）——ignore 落既有 `ignored` 分支
  （ack 推进、状态点 online、不记 error、不触发 cap-ack）。
- 新增 peer 收束不变式：thread 内其他 agent 的最后一条消息是收束语（「一致，无补充」「停在」
  「stop」「no more from me」等）时，本 agent 不再被该对话拉回——普通回复（`reply`）由代码层收口：
  ack、streak 清零、状态点 online、零新增消息、不记 error。人类信号优先（人类 @ 仍必须回应）。
- 领域口径同步：`CONTEXT.md`「回应判断」「提及」与 `docs/spec.md` §3.2 @mention 行改为人类-only，
  并与 peer 收束行为同源。

## Acceptance

- [x] 先在 base `74e6f86` 隔离 worktree 取红证据：peer 收束后 agent 仍被拉回对话 / peer @ 的 ignore 被判 error。
- [x] 人类 @ 后 ignore 仍是 error + 不 ack + 状态点红（不变量 1 未放宽）。
- [x] peer @ 后 ignore 落 ignored：游标推进、状态点 online、messages 表零新增（不变量 2）。
- [x] peer 收束后本 agent 收到 peer @ 的下一轮必须收口：不 error、不点红、零新增对话消息（不变量 3）。
- [x] `node --test lib/agent-loop/loop.test.mjs lib/agent-loop/loop-tasks.test.mjs` 全绿。
- [x] `npm run typecheck` 退出码 0；`npm run lint` 0 errors；`npm test` 全量通过（允许已知基线失败）。
- [x] Standards + Spec 双轴 code-review 写入 Answer，findings 逐条处置或记录不采纳理由。
- [x] PR body 用本机 pr skill 模板（Summary / Evidence / Merge Danger / Closes），以 `--body-file` 更新 PR #191。
- [x] 交付前 `git status --porcelain` 为空；改动文件与 commit SHA 回填 Answer。

## Evidence

### 必红（base `74e6f86` 隔离 worktree）

`git worktree add --detach <TMP>/ws-red-74e6f86 74e6f86`，仅拷入 `lib/agent-loop/loop.test.mjs`
（无实现、`must-respond-human-only` 也未落地），跑：

```
node --test --test-name-pattern "hasPeerCloseSignal recognizes|a peer's explicit sign-off in a thread|an agent-authored @mention is not|thread without a sign-off|a human @mention in a thread stays" lib/agent-loop/loop.test.mjs
```

```
✖ an agent-authored @mention is not a must-respond signal: ignore is a normal ignored round
    actual: 'error', expected: 'ignored'          ← (2) peer @ 的 ignore 被判失败
✖ hasPeerCloseSignal recognizes explicit peer sign-offs and ignores ordinary peer messages
    TypeError: hasPeerCloseSignal is not a function
✖ a peer's explicit sign-off in a thread closes it: a reply is dropped, acked and stays online
    actual: 'replied', expected: 'yielded'         ← (3) 收束后仍产出新对话消息
✖ a peer @mention in a thread without a sign-off is an attention signal: ignore advances and stays online
    actual: 'error', expected: 'ignored'
✔ a human @mention in a thread stays a must-respond signal after a peer sign-off
```

（最后一条是不变量 (1) 的守卫：base 与修复后都必须绿。）

### 必绿（本分支）

```
node --test lib/agent-loop/loop.test.mjs lib/agent-loop/loop-tasks.test.mjs
tests 120 / pass 120 / fail 0        （loop.test 78 + loop-tasks 42）
```

关键回归（`lib/agent-loop/loop.test.mjs`）：

- `hasPeerCloseSignal recognizes explicit peer sign-offs and ignores ordinary peer messages`
- `a peer's explicit sign-off in a thread closes it: a reply is dropped, acked and stays online`
- `a newer peer question reopens a signed-off thread: the reply lands`
- `a human message after a peer sign-off is not suppressed: the reply lands`
- `a human message earlier in the round blocks peer-close suppression: the reply lands`
- `a human @mention in a thread stays a must-respond signal after a peer sign-off`
- `a peer @mention in a thread without a sign-off is an attention signal: ignore advances and stays online`

`lib/agent-loop/loop-tasks.test.mjs`：

- `a peer agent's @mention in someone else's in_review task thread is not a must-respond signal`
- `a peer sign-off in someone else's in_review task thread closes it: a reply does not land`

现场字符串 `@Susan 一致，无补充。task #1 在我名下 in_review，不动。停在。` 经
`lastSentence` → `停在`，无 veto 命中，判定为收束（由上列行为回归覆盖）。

### 门禁

- `npm run typecheck`：exit 0。
- `npm run lint`：0 errors（1 个既有 warning `hooks/useI18n.tsx:61`，非本票）。
- `npm test`：1546 tests / 1545 pass / 1 fail。唯一失败 `lib/model-listing.test.mjs`
  「lite path returns a working runtime without loading extensions」——在基线 `74e6f86`
  隔离 worktree 上 `node --test lib/model-listing.test.mjs` 复现（3 pass / 1 fail），与本票无关。
  基线来源 = 本 worktree base commit `74e6f86`（main），数字与派单给定基线一致。

## Answer

### 实际改动

- `lib/agent-loop/loop.ts`
  - `hasMustRespondSignal` 拆出 `hasHumanMustRespondSignal`：人类的个人 @mention 与 DM owner 消息；
    人类-only 的 @ 判定由 `isHumanAuthor` 承担（`members.type === "human"`）。
  - 新增 `IncomingMessage`（复用 `MemberType`）、`isAgentAuthor`；`isChannelNoise` 复用同一形状与判据。
  - 新增 peer 收束信号：`PEER_CLOSE_PATTERNS`（中英文收束语）、`PEER_CLOSE_VETO`（提问/请求否决）、
    `lastSentence`（按中英文句末标点断句）、`isPeerCloseText`（收束语必须**结束**最后一句）、
    `hasPeerCloseSignal`（最新一条他人消息必须是 agent 收束语；人类随后发话即解除）。
  - `buildReplyPrompt` 新增 `peerClosedExchange?` 输入：命中时追加 `Closed exchange` 行
    （选择 conclude / ignore；reply 会被丢弃）——prompt 与判定同源。
  - `runAgentRound`：`peerClosedExchange = thread 目标 ∧ 非 reminder ∧ 本轮无人类消息
    ∧ !hasMustRespondSignal ∧ hasPeerCloseSignal`；`reply` 在任务 op / 自动路由之后走
    `closeWithoutPosting("peer closed the exchange")`（ack + streak 清零 + online + 零新增消息，
    status `yielded`，与 conclude 同款收口）；conclude 分支改用同一 helper。
- `lib/agent-loop/loop.test.mjs`：6 条新回归 + `hasPeerCloseSignal` 纯谓词用例（含误判负例）+
  `joinPeer` 前置 helper。
- `lib/agent-loop/loop-tasks.test.mjs`：in_review 任务线程的 peer 收束回归 +
  `setupPeerOwnedInReviewTask` 前置 helper（与 #191 的 peer @ 用例共用）。
- `CONTEXT.md`「回应判断」「提及」：确定信号收窄为人类（Owner）的 @；peer @ = 注意力信号；
  补 peer 收束行为（最后一句、本轮有人类发话即不抑制）。
- `docs/spec.md` §3.2 @mention 行：同上口径。

### 不变量核对

1. **人类 @ 不放宽**：`hasMustRespondSignal` 的人类分支原样保留（谓词等价拆分）；`peerClosedExchange`
   在 `!hasMustRespondSignal` 且本轮无任何人类消息时才成立。回归：线程内 peer 收束 + 人类 @ 后
   ignore 仍 `error` / 不 ack / 状态点 `error`；人类消息（含无 @）在收束前/后都解除抑制。
2. **peer @ = 注意力信号**：ignore 落既有 `ignored`（ack + online + 零新增 + 不触发 cap-ack）；
   `isChannelNoise` 未加任何 peer 过滤，消息照旧进 prompt（用例断言 prompt 含正文）。
3. **peer 收束 ⇒ 不再被拉回**：代码层丢弃 `reply`（不依赖模型自觉），ack + online + 零新增消息；
   最后一句判定 + 提问/请求 veto 防止吞掉工作消息。
4. **文档同源**：CONTEXT.md / docs/spec.md 与实现一致（人类-only + peer 收束）。
5. **PR #191 rebase**：`3eb58f4` 为 rebase 结果（三处 `loop.test.mjs` 冲突按意图解：保留 #192 的
   conclude 测试 + #191 的人类-only 测试，去掉被 #191 替换的旧 rubric 断言）；#192 的 conclude
   语义与 streak 清零未动。

### 双轴 code-review 与处置

固定点 `74e6f86`，Standards / Spec 两个独立子代理并行；首轮后修复，第二轮复核（同两轴）。

**Standards（首轮 → 处置）**

- 重复的五步收尾（conclude / peer 收束）→ 抽 `closeWithoutPosting(reason)`。
- must-respond 规则写两处（`!continuing && !hasHuman…`）→ 改用 `!hasMustRespondSignal(...)` 单一来源。
- 入站形状内联三遍、`type?: string` 降级 → `IncomingMessage` + `MemberType`；补 `isAgentAuthor`。
- 不可达 `/一致[，,、\s]*无补充/` → 删除（被 `/无补充/` 覆盖）。
- 代码层收口却记 `ignored`（CONTEXT 区分「自判 ignore」与代码收口）→ 统一 `yielded`。
- `loop-tasks` 两条用例前置 ~30 行重复 → `setupPeerOwnedInReviewTask`；`loop.test` 六处 peer 前置 →
  `joinPeer`。
- 第二轮新增：收束语只按句中命中会误判（`We're done with step 1, now run step 2` /
  「这个 bug 停在登录流程」/「能不能 wrap this up」）→ 改为「必须结束最后一句」+ veto；
  `PEER_CLOSE_VETO` 的 `[?？]` 分支不可达 → 删除，问号由断句处理；`isChannelNoise` 仍内联形状 →
  统一；`closeWithoutPosting` 恒为 `yielded` 的 status 参数 → 删除。
- 未采纳（记录理由）：收束轮仍先 prompt 再丢弃 reply。理由：该轮仍可能带合法的 task op / 成员 op
  （todo 认领、`applyMemberOps`），且 prompt 与判定同源；成本已在注释写明（判定纯本地、
  每个收束线程至多一次既有 prompt）。

**Spec（首轮 → 处置）**

- 首轮 (c)：`PEER_CLOSE_PATTERNS` 子串匹配过宽，四类工作消息被误吞 → 最后一句 + 提问/请求 veto +
  收窄英文 `no more` + 删除 `先这样|就这样`，并补四条负例；第二轮复核确认修复。
- 首轮 (c)：人类随后发话（无 @）被跳过 → 要求最新一条他人消息就是 agent 收束语，且本轮有任何人类
  消息即不抑制；补「人类在收束前/后发话」两条行为回归。
- 首轮 (c)：丢弃的回复在 round_logs 里是成功形态 → 改 `yielded` + reason `peer closed the exchange`。
- 首轮 (a)：票据 Evidence/Answer 待回填 → 本节完成，Status 流转 resolved。
- 第二轮待办：文档补「最后一句 / 本轮有人类发话即不抑制」→ 已补 CONTEXT.md 与 docs/spec.md。
- 残留（记录，不阻塞）：英文句号未参与断句（末句内出现工作请求但无 veto 词时仍可能误收）；
  peer @ 在「本 agent 名下 in_progress 任务线程」里 ignore 仍按失败处理（既有语义，非本票回归）。

### 门禁与证据

见上「Evidence」：红 4 条 / 绿 120 条、`npm test` 1546/1545/1（已知基线失败）、typecheck 0、lint 0 errors。

### PR

- [PR #191：只有人类的 @mention 构成确定信号 + peer 收束后不再拉回对话](https://github.com/whutlichao/worksplice/pull/191)
- body：`.scratch/task-thread-overdiscussion/pr-body.md`

### 提交与文件

- `3eb58f4` fix(agent-loop): 只有人类的 @mention 构成确定信号（rebase #191，冲突按意图解）
- `1685ef2` fix(agent-loop): peer 收束后不再把 agent 拉回 thread 对话
- `5e787d3` fix(agent-loop): 收窄 peer 收束判定，避免吞掉人类/工作信号
- `f85596d` fix(agent-loop): 收束语必须结束最后一句，人类在场即不抑制
- 文件：`lib/agent-loop/loop.ts`、`lib/agent-loop/loop.test.mjs`、`lib/agent-loop/loop-tasks.test.mjs`、
  `CONTEXT.md`、`docs/spec.md`、`.scratch/task-thread-overdiscussion/`

### 越界与遗留

- 未改 schema / REST 契约 / 前端 / wake 路由 / 任务路由 / `MUST_RESPOND_FAILURE_CAP`。
- `node_modules` 为本地软链（gitignored），不随提交；未跑 `next build`。
- 遗留：收束判定是启发式——peer 若在收束语之前夹带工作请求（如 `Fix the bug. Stopping here.`），
  本轮普通回复仍会被丢弃（工作消息只能经 task / 成员 op 落地）。按不变量 (3) 这是有意的保守侧；
  若后续观察到误收，可把请求词 veto 从「请/麻烦/please…」扩到动词级。
