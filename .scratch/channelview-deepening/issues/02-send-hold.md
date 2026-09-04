# 02: 发送与 freshness-hold 抽入 useChannelData

**What to build:** 发送通道收进 hook：handleSend（含 baseSeq 携带、held 后重拉提示 heldNotice）+ busAction/busy 状态。依赖 01 的 maxSeq/baseSeq。

**Blocked by:** 01（需 maxSeq/baseSeq 来源稳定）.（01 已 resolved@2ed55b7，可开工）

**Status:** resolved

- [x] hook 返回新增 `send / heldNotice / busyAction`，held 语义与现有 UI 提示一致
- [x] hook 级测试：正常发送、held 后重拉、重试耗尽行为
- [x] ChannelView 切到 hook，删除旧内联实现
- [x] `npm test` 全绿，`tsc --noEmit` 通过

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

### Review（02 票补审，基 704d3eb → 3129a2e + c097223，code-review 双轴）

#### Standards（规范：docs/engineering-standards.md + Fowler smell 基线）
- 通过：纯函数 `postChannelMessage` fetch 可注入 + union 返回 `sent|held`，符合"避免 any、服务层返回显式 union"与测试分层（hook 级 harness、无 testing-library）；注释/标识符中英分工合规；视图删内联 -40 行，收敛方向正确。
- 小问题已修（c097223）：`useChannelData.ts` 注释称 busyAction 是"发送通道的并发锁，本票只收发送"，与实现不符——`send` 本体不读写 busyAction，锁实际仍由视图 `runTaskAction` 驱动（旧内联同语义共享锁）。只改注释，不改行为。
- 判断调用（未改，供后续票参考）：`t` 经 hook 参数传入致 `send` useCallback 随 locale 变化重建——属 Middle Man 级轻味，无行为影响；`useChannelData(channel?.id, t)` 签名扩展是 02 范围内最小改动，不算 Speculative Generality。`postChannelMessage` JSON 分支 `quoteId: undefined` 会序列化显式 null 键——服务端容忍（旧实现同形），不改。
- 工具门禁：`npm test` 363 全绿，`tsc --noEmit` 通过；eslint 本文件 0 新增（全仓 8 error 既有基线，02 改动区干净）。

#### Spec（对照本票验收标准逐条）
- [x] hook 返回新增 `send / heldNotice / busyAction`，held 语义与现有 UI 提示一致——`send` 携调用时 baseSeq（maxSeqRef 快照）、held 置 heldNotice + loadLatest 重拉 + 抛 `message.held` 文案，与旧内联同语义。
- [△] hook 级测试：正常发送、held 后重拉、重试耗尽行为——前两项有（5 用例覆盖 JSON/held/非held抛错/multipart/空响应）；"重试耗尽"不适用：人类发送通道本就无重试语义（重试上限是 agent-loop 侧 revise 2 次/resend 3 次，见工程规范 §3），票据措辞沿用 agent 语义，视为验收口径偏差而非缺失，不行动。
- [x] ChannelView 切到 hook，删除旧内联实现——`handleSend` 改调 `sendMessage`，POST/multipart/held 分支已删，quoting 清理与 As Task 转化留视图（票据允许范围）。
- [x] `npm test` 全绿，`tsc --noEmit` 通过——363/363 + TSC-OK（本审复验）。
- scope creep：无。`runTaskAction`/reaction/pin 未动（04/03 票范围），测试补的 01 票断言前缀修复属附带最小修。
