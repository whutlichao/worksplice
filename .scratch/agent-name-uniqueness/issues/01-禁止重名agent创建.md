# 01: 禁止重名 agent 创建（服务层唯一性校验 + route 409）

**What to build:** `createAgent` 在现有非空/长度校验后追加名字唯一性检查（trim 后 toLowerCase 全等比对未删除成员，含 human）；重名抛专用错误 `DuplicateAgentNameError`（消息含重名）；`POST /api/members` route 捕获映射 409。@mention 解析与 wake/inbox 通路零改动，仅更新 members.ts 失真注释。

**Blocked by:** None — can start immediately.

**Status:** in-progress

- [ ] 精确同名创建被拒，抛 `DuplicateAgentNameError`，消息含重名（如 `Agent name "X" already exists`）
- [ ] 仅大小写不同（"Alice" vs "alice"）被拒；首尾空格差异（" Alice" vs "Alice"）trim 后被拒
- [ ] soft-delete 后同名可复用（被删成员不占名）
- [ ] human（Owner）名字同在唯一性范围内（agent 不可叫 "Owner"）
- [ ] `POST /api/members` 重名 → 409 + error 消息；非重名校验错误维持 400
- [ ] CreateAgentModal 展示服务端错误（UI 零改动，既有 error 字段渲染）
- [ ] `extractMentionedMemberIds` 行为零改动，失真注释更新
- [ ] 回归：`npm test` 全绿；既有用例零回归

## 实施方式（强制）

本票必须走 `/implement` skill 流程实施，不接受自由发挥：

1. 先读 skill 文件：`/Users/apple/.pi/agent/skills/implement/SKILL.md`，按其流程驱动
2. 内部按 `/tdd`（`/Users/apple/.pi/agent/skills/tdd/SKILL.md`）一次一个红-绿切片推进：先写失败测试，再写实现，再重构
3. 收尾按 `/code-review`（`/Users/apple/.pi/agent/skills/code-review/SKILL.md`）双轴自审（Standards + Spec）后报完工

## 实施指路

1. **tight 回路先行**：先在 `lib/domain/raft/members.test.mjs` 写「创建重名 agent 必须被拒」的必红测试（现状无校验必红），运行确认红，再实现转绿。
2. **服务层校验**（`lib/domain/raft/members.ts`）：`createAgent` 内非空/长度校验后，`name.trim()`（已 trim）toLowerCase 全等比对 `getDb().listMembers()` 全部行（listMembers 天然排除 deleted=1）；命中即抛 `DuplicateAgentNameError`（class 定义并导出，消息 `Agent name "X" already exists`）。经 raft 域唯一导入面自然可达。
3. **route 映射 409**（`app/api/members/route.ts`）：POST catch 分支 `error instanceof DuplicateAgentNameError` → 409 `{ error: message }`；其余维持 400（对齐 BusyCwdError/TaskAlreadyExistsError → 409 惯例）。
4. **注释修正**（`lib/domain/raft/members.ts`）：`extractMentionedMemberIds` 内"重名成员都算，与旧语义一致"注释改为"重名已被创建期禁止，按名字匹配至多命中一个成员"；解析逻辑本身零改动。
5. **测试 seam**：服务层 `members.test.mjs`（tmp 内存 DB）；route 层 `members-route.test.mjs`（源码级断言）。

## 票据协议（worker 必读）

- 开工直接干，本票 Status 由你流转 in-progress→resolved，并在下方 append `## Answer`。
- 词汇用 CONTEXT 词表；注释简体中文、错误消息英文。
- 改 schema/seed 后必须重启 dev server 验证（本票不改 schema/seed，无此要求）。

## Answer
