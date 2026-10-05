# Spec: Agent 名字唯一性（禁止重名创建，根治 @mention 双响应）

来源：用户 bug 报告；修复方向已由用户确认（禁止重名创建；存量重名 agent 手动处理，票内不做）。

## Problem Statement

worksplice 允许创建重名 agent（`createAgent` 仅校验非空与 ≤32 字符，无唯一性约束）。@mention 解析 `extractMentionedMemberIds`（lib/domain/raft/members.ts）按名字全等匹配时对重名成员**全部**返回 id（注释自述"重名成员都算，与旧语义一致"），因此 @其中一个重名 agent 时两个都被 emitWake 唤醒、各自跑一轮 runAgentRound 回复——#all 与其他频道均复现。名字是 mention 句柄，重名即歧义，应在创建源头禁止。

## Solution

创建 agent 时在服务层强制名字唯一：`name.trim()` 后大小写不敏感全等比对**未删除**成员（`listMembers()` 天然排除 soft-delete），重名抛专用错误 `DuplicateAgentNameError`；`POST /api/members` route 捕获映射 409（对齐 BusyCwdError/TaskAlreadyExistsError → 409 惯例）；CreateAgentModal 已展示 response body 的 error 字段，服务端消息即用户提示，UI 零改动。@mention 解析与 wake/inbox 通路零改动——名字唯一后同名至多一个成员；仅更新 members.ts 中失真注释。

## User Stories

1. 作为 Owner，创建与现有 agent 重名（含仅大小写不同、首尾空格差异）的 agent 时被拒绝，弹窗显示明确错误（如 "Agent name "X" already exists"），成员列表不出现第二个同名 agent。
2. 作为 Owner，删除（soft-delete）某 agent 后，可创建同名新 agent——被删成员不占名。
3. 作为 Owner，@一个名字唯一的 agent，只有该 agent 被唤醒回复（既有正确行为回归锁定）。

## Implementation Decisions

1. **校验位置 = 服务层 `createAgent`（唯一事实来源）**：在现有非空/长度校验后追加唯一性检查；trim 后 toLowerCase 全等比对 `listMembers()`（deleted=0）。定义并导出 `DuplicateAgentNameError`（消息含重名，如 `Agent name "X" already exists`），经 raft 域唯一导入面（lib/domain/raft/index.ts `export *`）自然可达。
2. **route 映射 409**：`app/api/members/route.ts` POST 的 catch 分支判 `error instanceof DuplicateAgentNameError` → 409 `{ error: message }`；其余错误维持 400。
3. **mention 通路零改动**：`extractMentionedMemberIds` / `parseMentionTokens` / `notifyMessageWakes` / inbox mute 穿透判定均不改行为；仅更新 members.ts 中"重名成员都算，与旧语义一致"的失真注释（改为：重名已被创建期禁止，按名字匹配至多命中一个成员）。
4. **唯一性判定范围含 human**：agent 与 human（Owner）重名同样造成 mention 歧义（parseMentionTokens 按名字跨全部成员匹配），唯一性比对覆盖 `listMembers()` 全部行。若实测 Owner 默认名导致合理名字被误伤，在 Answer 记录决策。

## Testing Decisions

- 服务层 `lib/domain/raft/members.test.mjs`（tmp 内存 DB，既有测试 seam）：
  - 重名拒绝：精确同名 → `DuplicateAgentNameError`；仅大小写不同（"Alice" vs "alice"）→ 拒绝；首尾空格差异（" Alice" vs "Alice"）→ trim 后拒绝。
  - 名字可复用：soft-delete 后创建同名 → 成功。
- route `lib/domain/raft/members-route.test.mjs`：POST /api/members 重名 → 409 + error 消息；非重名校验错误仍 400。
- tight 回路先行：先写「创建重名 agent 必须被拒」的必红测试（现状无校验必红），再实现转绿。
- 回归：`npm test` 全绿；既有用例零回归。

## Out of Scope

- 存量重名 agent 的改名/迁移（用户手动删除其一，名字即可复用；不做 rename 功能）
- @mention 精确化（composer 插成员 id、唤醒协议改形）——方向已被用户否决
- 人类 Owner 名字的编辑/唯一性管理 UI
- mention 渲染侧 parseMentionTokens 行为改动

## Further Notes

- **根因已由 coordinator 只读确认**（worker 以 tight 回路复证）：`lib/domain/raft/members.ts` createAgent 无唯一性校验；`extractMentionedMemberIds` 注释自述"重名成员都算"。
- **ADR 判定**：不建——单一约束补齐，逆转成本低，无真实权衡。
- **验收命令**：`node_modules/.bin/tsc --noEmit` + `npm test` 全绿 + `npm run lint`（对改动文件做改前/改后增量对照，既有问题不算新增）；**绝不 `next build`**。
- `[DEBUG-]`/临时脚本用后即删，grep 确认零残留。
