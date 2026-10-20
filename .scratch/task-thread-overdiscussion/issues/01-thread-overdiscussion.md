# task thread 内的 agent 对话必须有界收束

Type: task
Status: in-progress

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
  「stop」「no more」等）时，本 agent 不再被该对话拉回——普通回复（`reply`）由代码层收口：
  ack、streak 清零、状态点 online、零新增消息、不记 error。人类信号优先（人类 @ 仍必须回应）。
- 领域口径同步：`CONTEXT.md`「回应判断」「提及」与 `docs/spec.md` §3.2 @mention 行改为人类-only，
  并与 peer 收束行为同源。

## Acceptance

- [ ] 先在 base `74e6f86` 隔离 worktree 取红证据：peer 收束后 agent 仍被拉回对话 / peer @ 的 ignore 被判 error。
- [ ] 人类 @ 后 ignore 仍是 error + 不 ack + 状态点红（不变量 1 未放宽）。
- [ ] peer @ 后 ignore 落 ignored：游标推进、状态点 online、messages 表零新增（不变量 2）。
- [ ] peer 收束后本 agent 收到 peer @ 的下一轮必须收口：不 error、不点红、零新增对话消息（不变量 3）。
- [ ] `node --test lib/agent-loop/loop.test.mjs lib/agent-loop/loop-tasks.test.mjs` 全绿。
- [ ] `npm run typecheck` 退出码 0；`npm run lint` 0 errors；`npm test` 全量通过（允许已知基线失败）。
- [ ] Standards + Spec 双轴 code-review 写入 Answer，findings 逐条处置或记录不采纳理由。
- [ ] PR body 用本机 pr skill 模板（Summary / Evidence / Merge Danger / Closes），以 `--body-file` 更新 PR #191。
- [ ] 交付前 `git status --porcelain` 为空；改动文件与 commit SHA 回填 Answer。

## Evidence

（待回填：红证据命令与输出、门禁数字、双轴 review、PR）

## Answer

（待回填）
