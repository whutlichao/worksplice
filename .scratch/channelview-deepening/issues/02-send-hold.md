# 02: 发送与 freshness-hold 抽入 useChannelData

**What to build:** 发送通道收进 hook：handleSend（含 baseSeq 携带、held 后重拉提示 heldNotice）+ busAction/busy 状态。依赖 01 的 maxSeq/baseSeq。

**Blocked by:** 01（需 maxSeq/baseSeq 来源稳定）.（01 已 resolved@2ed55b7，可开工）

**Status:** resolved

- [ ] hook 返回新增 `send / heldNotice / busyAction`，held 语义与现有 UI 提示一致
- [ ] hook 级测试：正常发送、held 后重拉、重试耗尽行为
- [ ] ChannelView 切到 hook，删除旧内联实现
- [ ] `npm test` 全绿，`tsc --noEmit` 通过

## 实施方式（强制）

本票必须走 `/implement` skill 流程实施：先读 `/Users/apple/.pi/agent/skills/implement/SKILL.md`，内部按 `/tdd` 一次一个红-绿切片推进，收尾按 `/code-review` 双轴自审（Standards + Spec）后报完工。hook 测试用 node --test + jiti 自写 harness，不引 testing-library。只做本票范围。

## 票据协议（worker 必读）

- 开工直接干，不用改本文件。
- 完工后 append 一个 `## Answer` 段（改了哪些文件 + 测试命令结果 + 遗留），再 worker_done。
- 禁止碰 `Status:` 行与 `Blocked by` 行——状态收敛权归 coordinator（多 worktree 下原地改 Status 会分叉冲突）。

## Answer

- 改了哪些文件：`hooks/useChannelData.ts`（+92：`postChannelMessage` 纯函数 + `SendChannelMessageResult` 类型 + hook 新增 `send/heldNotice/busyAction/setBusyAction/setHeldNotice`，`send` 经 `maxSeqRef` 取调用时 baseSeq，held 后置 heldNotice + loadLatest 重拉 + 抛 `message.held` 文案）；`components/ChannelView.tsx`（-40 净：`handleSend` 改调 `sendMessage`，删旧内联 POST/multipart/held 分支，quoting 清理与 As Task 转化留视图）；`hooks/useChannelData.test.mjs`（+87：5 用例——正常 JSON 发送携 baseSeq、409 held 返回摘要、非 held 服务端错误透出、附件 multipart 一次提交、空成功响应抛错）；`components/ChannelView.test.mjs`（+18：02 票回归测试——视图经 hook send、无内联 POST/baseSeq 组装；01 票既有断言修 `useChannelData(channel?.id` 前缀匹配 + 补缺失的 readFile 头）。
- 测试命令结果：`npm test` 363 全绿（含新增 6 用例），`node_modules/.bin/tsc --noEmit` 通过；`npm run lint` 与基线同 8 error（全仓既有 React Compiler memoization 跳过，02 改动引入 0 新增 error，exhaustive-deps 新增 warning 已用稳定 setter 豁免注释消除）。
- 遗留：`runTaskAction`/`createTaskFromBoard` 的 baseSeq 携带与 busyAction 锁仍在视图内联（04 票范围）；reaction/pin 写回仍经 loadLatest 重拉（03–04 票）；`send` 成功后仍重拉收敛，未做乐观追加（后续票可选）。
