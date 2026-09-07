# 01: 禁止重名 agent 创建（服务层唯一性校验 + route 409）

**What to build:** `createAgent` 在现有非空/长度校验后追加名字唯一性检查（trim 后 toLowerCase 全等比对未删除成员，含 human）；重名抛专用错误 `DuplicateAgentNameError`（消息含重名）；`POST /api/members` route 捕获映射 409。@mention 解析与 wake/inbox 通路零改动，仅更新 members.ts 失真注释。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] 精确同名创建被拒，抛 `DuplicateAgentNameError`，消息含重名（如 `Agent name "X" already exists`）
- [x] 仅大小写不同（"Alice" vs "alice"）被拒；首尾空格差异（" Alice" vs "Alice"）trim 后被拒
- [x] soft-delete 后同名可复用（被删成员不占名）
- [x] human（Owner）名字同在唯一性范围内（agent 不可叫 "Owner"）
- [x] `POST /api/members` 重名 → 409 + error 消息；非重名校验错误维持 400
- [x] CreateAgentModal 展示服务端错误（UI 零改动，既有 error 字段渲染）
- [x] `extractMentionedMemberIds` 行为零改动，失真注释更新
- [x] 回归：`npm test` 全绿；既有用例零回归

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

### 实现决策

1. **服务层唯一事实来源**（`lib/domain/raft/members.ts`）：`createAgent` 在非空/长度校验后追加唯一性检查——`name.trim()` 后 `toLowerCase()` 全等比对 `getDb().listMembers()` 全部行（天然排除 soft-delete，含 human）。`DuplicateAgentNameError` 定义于 members.ts 并导出（消息 `Agent name "X" already exists`），经 raft 域唯一导入面 `export *` 自然可达。
2. **route 映射 409**（`app/api/members/route.ts`）：POST catch 判 `instanceof DuplicateAgentNameError` → 409 `{ error: message }`；其余维持 400。
3. **mention 通路零改动**：`extractMentionedMemberIds` 逻辑不变，失真注释改为「重名已被创建期禁止，按名字匹配至多命中一个成员」。
4. **决策 4（唯一性含 human）实测记录**：seed Owner 默认名 `"Owner"`，agent 创建 "Owner"/"owner"/"OWNER" 均被拒——符合 spec（human 与 agent 重名同属 mention 歧义）。实测未发现合理 agent 名被 Owner 默认名误伤的场景，维持全覆盖，不加豁免。
5. **测试夹具机械改名**（spec「既有用例零回归」的实现代价）：唯一性新约束使 9 个测试文件里既有夹具（在同一 tmp DB 内二次创建 alice/bob/pending/Susan/reviewer 等）撞新校验。改为唯一后缀（`alice-${fixtureSeq}`）；observability/rounds 的名字断言改用夹具变量（独立期望来源）；inbox 的 `@pending` mention 改为动态 `@${agent.name}`（mention 穿透断言语义不变）；event-messages 的 Susan 排除用例改为「软删原 Susan 释放名字 → 重建 Susan 验证排除静默 → 重建还原单秘书状态」。生产行为断言零改动。

### 红绿节奏证据

- **Red #1**：`node --test lib/domain/raft/members.test.mjs` → 新增 3 用例中 2 红（`createAgent rejects a duplicate name…`、`…colliding with the human owner`：`Missing expected exception`——现状无校验必红）；「soft-delete 后复用」用例先绿（回归锁定）。
- **Green #1**：实现 `DuplicateAgentNameError` + 唯一性检查后 → members.test.mjs 21/21 pass。
- **中途回归**：`npm test` 暴露 53 处既有夹具重名失败（全为 `DuplicateAgentNameError`，零生产断言失败），逐文件夹具唯一化后 455/455。
- **Red #2**：`node --test lib/domain/raft/members-route.test.mjs` → 409 映射用例红；**Green #2**：route 映射后 8/8。
- **终态**：`npm test` 456 pass / 0 fail。

### 测试命令结果

- `node_modules/.bin/tsc --noEmit`：exit 0
- `npm test`：456 pass / 0 fail
- `npm run lint`：10 problems（7 errors / 3 warnings）与基线完全一致（均在 hooks/useAgentSession.tsx 等未改动文件，pre-existing）；对 12 个改动文件单独 `npx eslint` 改前/改后均零发现
- 未执行 `next build`（spec 禁令遵守）；`[DEBUG-]`/临时脚本零残留（未加任何临时打点，grep 确认）

### 行为变化清单

1. 创建重名 agent（精确同名 / 仅大小写不同 / 首尾空格差异 / 与 human Owner 重名）被拒：服务层抛 `DuplicateAgentNameError`，`POST /api/members` → 409 + `{ error: "Agent name \"X\" already exists" }`；CreateAgentModal 既有 error 渲染直接展示，UI 零改动。
2. soft-delete 后同名可复用（原行为允许，新增测试锁定）。
3. @mention/wake/inbox 行为零变化：重名禁止后按名字匹配至多命中一个成员，@ 唯一名 agent 只唤醒它（既有正确行为回归锁定）。
4. 测试文件：夹具唯一化（见实现决策 5），生产行为断言零改动。

### Review

**Standards**：

- 服务层唯一事实来源、route 薄封装（AGENTS.md raft 约定）✓；注释简体中文、错误消息英文 ✓；无新增 emoji / UI 改动 ✓；词汇无禁词 ✓。
- 无 Duplicated Code / Feature Envy / Speculative Generality / Shotgun Surgery（生产改动收敛在 members.ts + route.ts 两处）。
- judgement call 1：唯一性检查为服务层线性扫描（O(n) `listMembers`）而非 DB UNIQUE 索引——比较语义是 trim + 大小写不敏感 + 排除 soft-delete 的应用层规则，索引无法直接表达，且单工作区成员量级小；维持 spec 决策 1。
- judgement call 2：`fixtureSeq` 计数器在 tasks/reminders/reminder-cron 三个测试文件的 setup 里重复（轻量 Duplicated Code）——但它们是独立测试文件各自的局部状态，抽公共 helper 反而引入测试间耦合，保留。

**Spec**：

- 票 01 checklist 8/8 命中；spec Implementation Decisions 1–4 全落地；Testing Decisions 全命中（服务层三态拒绝 + 删除后复用 + route 409/400 + 必红先行 + 全量回归）。
- 无 scope creep：生产代码改动仅 members.ts（+错误类/+校验/+注释修正）与 route.ts（+409 映射/+import）；其余均为测试夹具唯一化（新约束的必然结果，未改任何生产行为断言）。
- 秘书面兼容性核验：`initSecretaryFlow` 经 `findSusanMember`（过滤软删）判定已存在，软删 Susan 后重建走 `createAgent`——软删成员不占名，重建路径可用（secretary 三测试文件 20/20 pass）。
