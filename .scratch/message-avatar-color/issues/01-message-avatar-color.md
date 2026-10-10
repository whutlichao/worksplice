# 01 — Message avatar tint consistency

**Type:** task
**What to build:** 在消息作者、侧栏 agent 行与建频道成员挑选项中，用同一 agent ID 作为头像取色键，确保同一成员跨界面显示同一 `av-*` 色调。保留现有调色板、字符串哈希、人类 `av-4` 与消息 `author_id`；更新 `Avatar` 的 key 注释，不再推荐按列表序号取色。

**Status:** resolved

## 验收条件
- [ ] 新增实际渲染 markup 的回归测试：同一 agent ID 的 `MessageRow` 与侧栏 Agent 行 `av-*` 相同；成员挑选项在现有 seam 可测时一并覆盖。
- [ ] 在修复前确认回归测试因 `av-*` 不同而失败，修复后通过。
- [ ] 只改产品目标文件及相关 `.test.mjs`，不改色板、哈希、人类显示或消息数据。
- [ ] 定向测试、`npm run typecheck` 通过；记录 lint 基线与修改后对照，仅报告新增问题。
- [ ] Answer 含红绿证据、窄测试档 rationale、分开的 Standards / Spec 双轴 review 与 finding disposition、修改文件、Status resolved 和 PR 号。
- [ ] 推送分支并创建 open PR；不合并。

## Answer

### Q→A（票据路径）
- **Q**：worktree 中没有该票的正本，Answer/Status 应写在哪里？
- **A**：按协调者确认，在 `.scratch/message-avatar-color/issues/01-message-avatar-color.md` 建立本票正本，并负责 Status 与 Answer 收敛。理由：本仓以 `.scratch/<feature>/issues/NN-<slug>.md` 为权威 tracker；Ownership 已授权本票收敛，不扩大产品改动范围。

### Q→A（第三方操作）
- **Q**：任务要求 push + 创建 PR，但 Behavior Rule #3 要求第三方操作先 escalation，是否获准？
- **A**：人定批准仅推送 `message-avatar-color` 分支并创建 PR，不含其他 GitHub 操作或强推。理由：本轮交付要求形成 open PR 并继续后续门禁。

### 红→绿与诊断
- **假设（由协调者确认已向用户展示）**：① 列表序号与消息 `author_id` 作为不同取色键造成不同 tint，稳定 member ID 应使其一致；② 消息 `author_id` 与列表 `agent.id` 实际不同；③ markup class 相同但 CSS 计算色不同。
- **最小复现**：同一 `AGENT.id` 同时作为 `MessageRow.message.author_id`、侧栏 `agents[0].id` 和成员挑选项 `agents[0].id`；读取真实 SSR `av-*` class。证据支持①、排除②（输入 ID 相同）与③（markup class 本身已不同）。
- **红**：修复前运行 `node --test --test-name-pattern='同一 agent ID' components/message-stream.test.mjs`，失败：侧栏 `actual '0' !== expected '4'`；先修侧栏后同命令仍因成员挑选项 `actual '0' !== expected '4'` 失败。
- **绿**：侧栏与成员挑选项都改用同一 `agent.id` 后，以上命令 **1/1 pass**；消息继续使用原有 `message.author_id`，人类 `av-4`、调色板与哈希均未改。

### 门禁与测试范围
- 定向命令 `node --test components/message-stream.test.mjs components/WorkspaceSidebar.test.mjs components/CreateChannelModal.test.mjs`：**40/40 pass**。另运行 `node --test components/Avatar.test.mjs`：**9/9 pass**（更新该测试标题，明确数字 key 仅为显式色板位置，不再暗示列表序号是成员身份）。
- `npm run typecheck`（`tsc --noEmit`）：通过。
- ESLint 基线（base `3845cc621b27f1559421c8572459bdf9e3066def`）与修复后均运行 `npx eslint components/Avatar.tsx components/ChannelView.tsx components/WorkspaceSidebar.tsx components/CreateChannelModal.tsx`：两者均退出 0、无输出；改动文件新增 lint finding：**0**。`components/Avatar.test.mjs` 单独 lint 同样无输出。
- 额外 `npm run lint`：0 errors、1 warning（未改动的 `hooks/useI18n.tsx:61` 缺少 `locale` effect dependency）；不属于本票改动文件。
- **窄测 rationale**：单票、无解法分叉、一个 `components` module；仅共享 `Avatar` 的两个成员列表调用点变化，影响面有限，所以按要求跑三份指定测试，不跑全量套件；另以 `Avatar.test.mjs` 覆盖被更新的 key 说明。

### 双轴 code-review
#### Standards
- 独立复审确认稳定 member ID 调用、与 `MessageRow.author_id` 对齐，并确认回归断言测试实际渲染 markup；**未发现 Standards finding**。review verdict：OK with notes（reviewer 自身未运行测试；门禁证据见上）。

#### Spec
- 独立复审确认消息、侧栏、成员挑选项的实现与 tint 比较测试；复审当时报告 **P1**（Answer/PR 与红绿证据尚未记录）和 **P2**（reviewer 未运行测试/typecheck/lint，因此缺验证证据），当时 verdict 为 BLOCK。
- **Disposition：已收敛**。本 Answer 现含红绿、窄测理由、文件与 review 记录；本地已运行并记录对应测试、typecheck 与 base/after lint 对照；PR 已创建为 #139，状态 resolved。复审没有指出实现行为或额外范围问题。

### 修改文件
- `components/Avatar.tsx`
- `components/Avatar.test.mjs`
- `components/CreateChannelModal.tsx`
- `components/WorkspaceSidebar.tsx`
- `components/message-stream.test.mjs`
- `.scratch/message-avatar-color/issues/01-message-avatar-color.md`（本票 Answer/状态）

**PR**：[#139](https://github.com/whutlichao/worksplice/pull/139)（open，未合并）。
