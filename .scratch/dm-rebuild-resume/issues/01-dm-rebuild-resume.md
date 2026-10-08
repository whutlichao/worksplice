# 01: DM 重建接续（同名 agent 重建后就地接续同一条私信）

**What to build:** 删除同名 agent 后重建（createAgent 得到新 member id）时，确定性 id 的 `dm:owner↔<名字>` 必须自动回到可用态——`archived=0`、成员恰为 {owner, 新 agent}、新身份对该 DM 的消费游标推到修复时刻的 `max(seq)`；历史消息一条不动、不重放。既有坏数据（存活 agent 存在、同名 DM 仍归档或缺该成员）由开库期幂等步骤同义修复，用户不需要再删一次重建一次。

**Blocked by:** 无（DM 地基 01 与懒创建 01 均已 resolved）

**Status:** resolved

- [x] 服务层接续入口 `resumeDirectChannel(agentId)`：解档 + 成员补回 owner/agent + 新身份游标 = 修复时刻 `max(seq)`，三条写入同事务、幂等（已在预期态时不写一行）
- [x] `createAgent` 重建路径同步接续（与原生命周期同事务语义）
- [x] 开库期幂等修复步骤（`runMigrations` 事务内、紧邻 `cleanupEmptyDms`，不 bump `SCHEMA_VERSION`、可重跑）
- [x] 反例守卫：删除后不重建的 DM 保持 `archived=1`（不无差别解档）；join / leave / archive / mute 对 DM 仍一律拒绝
- [x] 服务层测试覆盖上述全部行为（红→绿）

## 语义裁定（用户裁定，逐条必须成立）

1. 删除同名 agent 后重建 → 该 DM 自动可用：`archived=0`、成员恰为 {owner, 新 agent}、新 agent 对其消费游标 = 修复时刻 `max(seq)`；历史消息一条不动、仍可读。
2. 治理既有坏行（存活 agent + 同名 DM 归档或缺成员）——开库期幂等步骤，无需再删再建。
3. 不重放历史：新身份不被旧对话唤醒（游标推到当前 `max`）；人类发新消息后 DM 是确定信号（§R4），新 agent 必须被唤醒并回应。
4. 既有限制一个不动：删除身份仍归档其 DM；没有存活同名 agent 的旧 DM 保持 `archived=1`；join / leave / archive / mute 对 DM 一律拒绝；命名仍由名字决定（不引入新 id 方案、不改 schema 表形状）。
5. 修复与原生命周期同事务语义：不产生「解档了但成员没加回」「成员加了但游标没推」这类半修复状态。

## 实施方式（强制）

1. 先读 skill 文件：`/Users/apple/.pi/agent/skills/implement/SKILL.md`，按其流程驱动
2. 内部按 `/tdd`（`/Users/apple/.pi/agent/skills/tdd/SKILL.md`）一次一个红-绿切片推进：先写失败测试，再写实现，再重构
3. 收尾按 `/code-review`（`/Users/apple/.pi/agent/skills/code-review/SKILL.md`）双轴自审（Standards + Spec）后报完工

## 验收标准（行为级）

1. 红→绿：先写测试跑出红（给命令与红输出），再实现转绿（给绿输出）。测试至少覆盖：
   - a) 删除 → 同名重建 → DM `archived=0`、成员 = owner + 新 agent、消费游标 = 当时 max seq、旧消息仍在；
   - b) 重建后人类 sendMessage 不抛错，且新 agent 收到 wake（`subscribeWake` 断言 target = DM id + agentId = 新 id）；旧历史不产生 pending（该 agent 对 DM 的 drain 为空）；
   - c) 坏行（构造：DM 归档 + 成员被移除 + 无游标）→ 开库修复步骤恢复；可重跑（第二次开库不改动任何东西）；
   - d) 反例守卫：删除后不重建，其 DM 仍 `archived=1`；DM 禁改守卫仍拒（join/leave/archive/mute 至少两条）。
2. `npm test` 全量 0 fail。
3. `node_modules/.bin/tsc --noEmit` → 0 error；`npm run lint` → 本票改动文件 0 新增问题。
4. 双轴 code-review（Standards + Spec 两份报告不合并、不重排）：findings 逐条处理或写明豁免理由。Standards 轴额外必查：DM 生命周期判据在服务层与开库步骤两处是否一致。
5. `git status --porcelain` 为空；`git diff --numstat` 只覆盖真正改动的少量行。
6. 推分支 + `gh pr create`，PR 号回填 Answer 与本票据。

## 测试 seam

`lib/domain/collab/dm-rebuild-resume.test.mjs`（服务层，内存 tmp DB）：两个触发点（`createAgent` 重建 / 开库修复步骤）共用同一份「接续后预期态」断言；反例守卫同文件。

## 不在本票范围

- `.scratch/dm/**` 既有票据（历史正本不动）
- `lib/agent-loop/**`、`lib/rpc/**`、UI 组件（composer 的归档禁用已有测试覆盖）
- schema 表形状 / `SCHEMA_VERSION`（修复步骤无形状变更）

## Answer

### 实现决策

1. **服务层接续入口**（`lib/domain/collab/channels.ts` 的 `resumeDirectChannel(agentId): void`）：同名 DM 存在且处于非预期态（归档 / 缺 owner / 缺该 agent）时，同事务内三条写入——
   - 该 agent 还不是 DM 成员 ⇒ 消费游标推到修复时刻 `max(seq)`（成员缺失 ⇔ 这是重建出来的新身份，旧对话不重放；仍在成员里的身份保留自己的未读游标，不被吞）；
   - 成员补回 owner + 该 agent（`addChannelMember`，INSERT OR IGNORE）；
   - 解档（`archived=0`）。
   已在预期态（非归档 + 两名成员）时一行不写（幂等）；DM 尚未懒创建时不建行、不抛（懒创建语义不变）；非 agent / 软删身份 / 不存在的 id 抛错。
2. **触发点恰好两个，且同形**：① `createAgent`（运行期重建——身份行 + #all 加入 + DM 接续落在同一事务，与 `deleteAgent` 的单事务写法对称）；② `runMigrations` 的开库期步骤（存量坏行）。`createDirectChannel` **不挂**接续：可达的坏行只由「删除（身份不再存活）+ 同名重建」产生——前者由开库步骤覆盖，后者由 `createAgent` 覆盖，第三处是冗余。
   **同形证据**：同一派生 id（服务层 `DM_ID_PREFIX + name` / SQL `? || m.name`）、同一修复谓词（非归档 ∧ owner 在 ∧ 该 agent 在）、同一组三条写入与同一顺序（游标 → 成员 → 解档）、同一游标分句条件（「该 agent 不在成员里」）。数据层不得 import 协作域（依赖方向：业务依赖数据契约，反之不成立），故开库步骤直接写 SQL 而非走 Store 契约；两侧共用同一份「接续后预期态」断言 `assertResumedDm`（判据漂移会让两个用例一起红）。
3. **开库步骤形态**（`lib/data/schema.ts` 的 `resumeDirectChannels`）：`runMigrations` 事务内、`cleanupEmptyDms` **之后**（空 DM 已回收，故不会为零消息 DM 落游标）。先 SELECT 出「存活 agent + 同名 DM + 非预期态」的行，再逐行按同一顺序写；第二次开库 `sqlite.total_changes` 增量 = 0（测试断言「不改动任何东西」）。不 bump `SCHEMA_VERSION`（无表形状变更）。
4. **一处刻意的派生差异（空 DM）**：若重建时命中的是一条 0 消息的归档 DM，服务层会把它接续成可用态，而 `cleanupEmptyDms` 的「空 DM 一律回收」在下一次开库照旧生效（回收后按需懒创建）。两个策略不冲突：空 DM 没有历史可失去，而**不接续**会让用户在「重建后第一次发消息」时撞上 archived 只读（空 DM 不在侧栏显示，只能从「发送消息」入口进）——接续是更安全的一侧。
5. **命名规则一字未改**：DM id 仍由名字原样派生（`id == name`，票 01 R7）。大小写变体重建（删 `Foo` 后重建 `foo`）是**另一条 DM 身份**——这不是本票引入的行为，而是「id == name（大小写敏感）」与「名字唯一性大小写不敏感（仅比对存活成员）」两个既有限制相交的产物；支持折叠会改 DM 命名/解析规则（票面明令「不引入新 id 方案」），已用测试显式锁住该边界并记为后续票候选。

### 红→绿证据

红（把三处实现文件回退到父提交 `10d20aa`，新测试保留）：

```
$ git checkout 10d20aa -- lib/domain/collab/channels.ts lib/domain/collab/members.ts lib/data/schema.ts
$ node --test lib/domain/collab/dm-rebuild-resume.test.mjs
✖ delete then rebuild with the same name resumes the same dm in place (unarchived, two members, cursor at max seq)
  AssertionError: rebuild path: unarchived (writable again)   1 !== 0
✖ after rebuild a new human dm message wakes the new identity, and old history is not pending
  AssertionError: old history produces no pending for the new identity
✖ open-time repair restores a pre-existing bad dm row (archived + member removed + no cursor) and re-run changes nothing
  AssertionError: open-time repair: unarchived (writable again)   1 !== 0
✖ a resumed dm still rejects join / leave / archive / mute (DM rules unchanged)
✖ dm id stays name-derived after resume (no new id scheme)
✖ resume is idempotent at the service layer and never creates a dm that lazy creation has not made yet
✖ repair follows its predicate clause by clause (archived-only / missing owner / missing agent)
✖ the real rebuild entry (initSecretaryFlow -> createAgent) resumes the secretary dm too
ℹ tests 11   ℹ pass 3   ℹ fail 8
```

（3 条通过 = 反例守卫：删除后不重建仍归档 / 存活旁人的 DM 不被吞游标 / 大小写变体是另一条身份——它们在实现前就应当成立。恢复：`git checkout HEAD -- <三个文件>`。）

绿（恢复实现后）：

```
$ node --test lib/domain/collab/dm-rebuild-resume.test.mjs
ℹ tests 11   ℹ pass 11   ℹ fail 0
```

### 门禁结果

| 命令 | 结果 |
| --- | --- |
| `npm test`（宽档） | **1289 tests / 1289 pass / 0 fail**（基线 `10d20aa` 实测 = 1278/1278；本票 +11） |
| `node_modules/.bin/tsc --noEmit` | exit 0，0 error |
| `npm run lint` | exit 0，与基线输出 `diff` 逐字节一致（0 error / 1 既有 warning 在 `hooks/useI18n.tsx`） |
| `eslint <4 个改动文件>` | 0 problem |
| `git status --porcelain` | 空（`.pi-lens.json` / `.review-diff.patch` / `.gate-logs/` 走 `.git/info/exclude`，不进仓库） |
| `git diff --numstat` | 仅本票 4 个文件少量行，无整份重排 |
| 未跑 | `next build`（铁律）；用户 live 库（所有验证在 `mkdtempSync` 临时数据目录） |

### Review（双轴，两份报告不合并、不重排）

#### Standards 轴（独立 reviewer，fresh context）

**（a）明文标准违规：无硬违规。** 注释简体中文、错误消息英文（channels.ts:69-73 注释 + `"Agent not found"`）、协作域子模块相对直引（members.ts:6，未走索引回环）、分层方向（schema.ts 不 import 协作域、无环）、未引入新 id 方案——均合规。两条 P2 缺口：

- **术语词表**：docs/agents/domain.md「当你的输出命名某个领域概念时…使用 CONTEXT.md 中定义的术语…还不在术语表中…记录下来供 /domain-modeling 处理」；「接续（resume）」是新领域概念（`resumeDirectChannel`/`resumeDirectChannels`），CONTEXT.md 有「私信/懒创建」词条却无「接续」，diff 未落条目。
- **票据收敛**：AGENTS.md「worker 全权负责本票文件（含 Status 流转 in-progress→resolved + append Answer）」，而 diff 内票据仍 `Status: in-progress`、勾选框全空、无 Answer。

**（必查项）两处判据一致性：逐项同形。** 派生 id 同（channels.ts:78 `DM_ID_PREFIX+name` / schema.ts:397 `? || m.name`）；修复谓词同（channels.ts:83-85 / schema.ts:398-405）；游标条件同（「agent 不在成员里」:90 / :404）；三条写入同序（游标→owner→agent→解档：:91-96 / :411-415）；SQL 与 Store 原语逐字等价（`setConsumedSeq`/`addChannelMember`/`setChannelArchived`/`maxSeq` 的 `COALESCE(MAX(seq),0)`）。差异仅参数形态与 `joined_at` 取值方式，分层约束下正当。唯一派生不一致：服务层不判空消息，会复活空 DM（schema.ts:363 注释「空 DM 一律回收」），下次开库再删——P2。

**（b）Fowler 判断性意见：**

- **Duplicated Code**（channels.ts:83-96 / schema.ts:398-415）：同一谓词 + 三条写入两份。可按 `lib/data/types.ts` 已有纯函数先例（`toFtsQuery`）抽 `dmNeedsResume()` 单点，防漂移。
- **Shotgun Surgery / Divergent Change**：DM 生命周期现散在 members.ts:196-211、channels.ts、schema.ts:363/385；改一条规则动四处，且 schema.ts 兼「表形状」与「DM 生命周期」两因变化。
- **Speculative Generality**：`resumeDirectChannel` 的 `ChannelRow | undefined` 返回值无消费者（members.ts:215 忽略）。
- Mysterious Name / Data Clumps / Primitive Obsession / Message Chains / Middle Man / Refused Bequest / Repeated Switches：无证据，或与既有风格一致。

**Merge verdict: OK with notes**（无 blocker；上列 P2 与票据收敛由 coordinator 处置）。

#### Spec 轴（独立 reviewer，fresh context）

**Correct**：裁定 1/2/4/5 主路径成立——`resumeDirectChannel`（channels.ts:76-99）与开库步骤（schema.ts:369-421）共用同一 id 派生、同一修复谓词、同一「游标→成员→解档」顺序；`createAgent`（members.ts:196-222）与原生命周期同事务；DM 四条守卫未动；游标推 `max(seq)`、历史不动。

**（a）缺失/部分**
1. 验收 1 红→绿证据、验收 4 双轴报告、验收 6 PR 号在本 diff/worktree 无证据（无 Answer 文件），票据勾选与 Status 仍 `in-progress`。
2. 清单第 1 条「幂等＝已在预期态不写一行」无服务层断言（仅开库路径用 `total_changes` 覆盖，测试 c）。
3. 裁定 1「成员恰为 {owner, 新 agent}」只走「缺成员」方向：两处只补不清理，无「多成员」反例（守卫下不可达，可接受）。

**（b）scope creep**：无产品行为扩张；新增两用例（sibling 游标不被吞、名字派生 id）属额外覆盖。

**（c）存疑**
1. 同名口径不一：`createAgent` 名字唯一性大小写不敏感（members.ts:152-159），而 DM id/接续用原样 name（channels.ts:33、schema.ts:382）。删 `Foo` 重建 `foo` → 不接续、旧 DM 永留 `archived=1`，与裁定 1「同名重建即自动可用」冲突。
2. 仅「agent 不在成员里」才推游标（channels.ts:88、schema.ts:404）：成员在但游标=0 的坏行会重放历史，与裁定 3 字面有边界（票据未列该坏行，不算违规）。

### findings 逐条处置

| finding | 轴 | 处置 |
| --- | --- | --- |
| 术语表缺「接续（resume）」条目 | Standards P2 | **豁免（越出 Ownership）**：`CONTEXT.md` / `docs/agents/domain.md` 不在本票可编辑面（Target = 三源文件 + 新测试 + 本目录），域文档归 coordinator；建议条目：`接续（resume）＝同名 agent 重建后把既有 DM 拉回可用态（解档 + 成员补回 + 新身份游标推到当前 max(seq)）` |
| 票据收敛（Status/勾选/Answer） | Standards P2 | **已处置**：本 Answer + `Status: resolved` + 五条勾选 |
| 「空 DM 会复活」派生不一致 | Standards P2（必查项） | **豁免（刻意）**：见实现决策 4——不接续会让重建后第一条消息撞 archived 只读，接续是更安全的一侧；下一次开库仍由 `cleanupEmptyDms` 回收，无历史损失 |
| Duplicated Code（谓词 + 三条写入两份方言） | Standards 判断项 | **豁免（有理由）**：方言差异由分层方向决定（Store 契约 vs 迁移期原始 SQL），仓内先例即 `cleanupEmptyDms`（同为 DM 生命周期 SQL 落在数据层）；抽到数据层会把域规则移出域（Divergent Change），为两处十行 SQL 新开模块/扩 Store 契约不合算。漂移风险改由**测试**兜底：两侧共用 `assertResumedDm` + 逐分句用例 |
| Shotgun Surgery / Divergent Change | Standards 判断项 | **豁免**：三个触发面由票面 Target 指定，职责确不同（域入口 / 重建路径 / 开库治理），每处都是薄封装或薄调用（一处规则一处实现，测试同形断言兜底） |
| Speculative Generality（返回值无消费者） | Standards 判断项 | **已修**：`ChannelRow \| undefined` → `void`，去掉尾部复读（commit `a2c0d8f`） |
| 服务层幂等无断言 | Spec (a)2 | **已修**：新增用例——预期态第二次调用 `total_changes` 增量 0；无 DM 不建行；非 agent / 软删 / 不存在拒接续 |
| 只走「缺成员」方向、无「多成员」反例 | Spec (a)3 | **豁免（不可达）**：DM 加人只有 `joinChannel` 一条路径且已被 `assertNotDM` 全拒（`dm.test.mjs` 锁定），seed 只补 #all，`deleteAgent` 只移除；补「删多余成员」是死代码（Speculative Generality 反例） |
| 大小写变体不接续 | Spec (c)1 | **豁免 + 边界测试**：见实现决策 5——冻结命名规则（`id == name`）下的既有限制，改它需先改 R7 命名/解析规则（本票 scope 外），已用用例显式锁定 |
| 「成员在但游标 0」的坏行不推游标 | Spec (c)2 | **豁免（语义正确且状态不可达）**：游标分句按「**新身份**」判定——票面裁定 3 的措辞本身即「新身份不被旧对话唤醒」；把游标推给同身份会吞掉它真实的未读（用例「repair is scoped」正锁这条）。而「归档 ∧ 成员在」经 app 路径不可达（`deleteAgent` 归档与移出成员同事务），该分句已由逐分句用例覆盖 |

### 交付

- commit：`801a4da`（实现）→ `a2c0d8f`（review 处置）→ 本票据收敛
- PR：**#122**（https://github.com/whutlichao/worksplice/pull/122）
- review 跑在 `801a4da`（diff 快照 `.review-diff.patch`）；`a2c0d8f` 的 delta = 返回值收窄 + 4 条新用例，不改语义，改后全量门禁已重跑（上表）
- 残留风险 / 后续票候选：① 大小写变体重建（需先改 R7 命名/解析规则）② 域术语表补「接续」条目（coordinator 治理文档）③ 「空 DM 是否算可用」若要接续与回收合一，需重定义 |
