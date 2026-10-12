# 02-raw-json-reply-leak

Type: implement
Status: resolved
Assignee: worksplice-dev (this session)
Blocked by: （无）

## Problem Statement

票 01（PR #100）修掉了「`{"` 被输出成 `","` / `,"`」那一档坏序言。形态随后**复发，但是新的**：
同一个 agent（provider 模型 `deepseek-v4.1-flash`）的模型输出把**协议 JSON 对象的形状写对了**，
却在 `content` 字符串值里直接吐**真实换行**（裸控制字符），而不是 JSON 要求的字面 `\n` 转义：

```text
{"action":"reply","content":"@bob 收到，先看主触发点。

```text
OK
```","onConflict":"revise"}
```

（`content` 的字符串值里是 U+000A，不是反斜杠 n；下面这条样本已与 session jsonl 里模型原始
assistant 输出逐字核对一致。）

`parseAgentAction`（`lib/agent-loop/loop.ts`）的解析链对这一档**逐档落空**：

| 档 | 现状 | 结果 |
| --- | --- | --- |
| ① `JSON.parse(cleaned)` | 抛 `Bad control character in string literal in JSON at position N` | 失败 |
| ② `extractJsonObject` + parse | 提取器**取得到**平衡的 `{…}`（裸换行不影响括号配对），再 parse 抛同一个错 | 失败 |
| ③ `parseRepairedReply`（票 01 的 `","` / `,"` 序言） | 文本不以 `","` / `,"` 开头 | 不命中 |
| ④ 兜底 `content = cleaned \|\| text.trim()` | —— | **整段 JSON 当正文落库** |

结果与票 01 同型但成因不同：UI 里显示原始 JSON 碎片（这次是**正确形状的 JSON**），
正文完全丢失。影响面：全部来自同一个 agent，约为每 90 秒新增 1 条，修复部署前**仍在增长**。

## Solution

owner 已拍板，与票 01 同一套两侧结构，但落在**独立的放宽**上：

1. **A（防未来）**：在 `parseAgentAction` 的解析链 ③ 与 ④ 之间新增一档——**对形如协议 JSON
   对象、但字符串字面量内含裸控制字符的文本**，把裸控制字符转义后重解析。判定仍落
   `lib/agent-loop/json-prologue.ts`（与 ③ 同模块、同形状校验口径），loop.ts 只接线。
2. **B（存量）**：`scripts/fix-reply-json-leak.mjs` 的候选扫描与判定扩到本形态，
   `--apply` 事务口径与回填语义（回填值 = `parse` 后的 `content` 字段，裸换行在此步还原）不变。
3. **C（回归）**：`lib/agent-loop/loop.test.mjs` 先红后绿；脚本侧同一形态的 dry-run / apply 行为。

## Implementation Decisions

- **不扩 `LEAK_PROLOGUE_PATTERN`**：票 01 的 Further notes 第 3 条明确「形态复发时应重新评估，
  而不是扩旧形态常量」。本形态是**新的、独立的**放宽，落在独立函数 `repairRawControlChars`
  与独立判据上；旧常量与旧函数一个字不改。
- **候选判据（宽松、便宜）**：文本 `trim()` 后以 `{` 开头且以 `}` 结尾——先排除绝大多数散文，
  避免无谓的逐字符扫描。
- **采纳判据（与既有各档逐条同款）**：parse 成功 ∧ 非数组 ∧ `action ∈ {reply, ignore}`。
  不成立就维持既有兜底，**不猜测、不模糊修复**。
- **转义范围只到「能让 JSON.parse 成功」为止**：只转义**字符串字面量内**的裸控制字符
  （`< 0x20`：换行 → `\n`、制表 → `\t`、回车 → `\r`、退格 / 换页 → `\b` / `\f`、
  其余 → `\u00XX`）。字符串外的裸换行（美化过的 JSON）本来就是合法空白，`JSON.parse` 自己会吃；
  顺手转义它属于「做了没被要求的事」，不做。已在 `\` 之后的字符是合法/非法的既有转义序列，
  一律原样保留（本档不改写既有转义语义，`\n` 仍是字面转义）。
- **同源同形**：A 与 B 共用 `json-prologue.ts` 的一档实现，两处不得各写一份（与票 01 同一纪律）。
- **不把「改消息」开成产品能力**：沿用票 01 的离线脚本旁路底层连接口径，`lib/data/store.ts`
  与 `lib/data/schema.ts` 一个字不改。
- **不动 messages 表的不可变触发器定义**，不动 `round_logs`、注入预算与 prompt 骨架。
- 术语用 codebase-design 词汇（module / interface / seam / adapter / leverage / locality）。

## Testing Decisions

- seam 与票 01 相同：`parseAgentAction`（防未来）+ 清洗脚本 CLI（子进程 + `openDataDb(mkdtemp)` 临时库）。
- 用例覆盖：本形态命中并还原出正确 `content`；非协议形状的裸控制字符文本仍走兜底；
  票 01 的 `","` 序言档与纯自然语言兜底**继续绿**；脚本侧同形态的 dry-run / apply 行为。
- 绝不触碰 `~/.worksplice`，也不读 `~/.pi` 下的真实会话数据：形态样本由本票构造（与实测形态同构）。
- 红证据在隔离副本上取得（样本文本构造，不读 live 数据）。

## Out of Scope

- 渲染层、`sendMessage` / `deliverWithFreshness` 语义、会话与 prompt 骨架一概不改。
- live 库（`~/.worksplice`）的 `--apply`：本票只交付脚本能力与 dry-run 证据，
  实跑由 coordinator 在验收后另行进行。
- 不改票 01 的 `LEAK_PROLOGUE_PATTERN` / `repairJsonPrologue` / `parseRepairedReply`。
- 不改 `docs/engineering-standards.md`、`package.json`。

## Further Notes

- 门禁：G-impl（红→绿回归证据 + typecheck / lint / 全量测试 + 双轴 code-review）。
- 本票不跑浏览器与 UI 验收（无 UI 改动）；不跑 `next build`（仓库纪律）。
- **样本文本**（本形态的构造性复现，用于红证据与回归测试——逐字取自 live 一条消息的形态，
  但正文内容为本票自造的等价文本，不含 live 正文）：

  ```text
  {"action":"reply","content":"@bob 收到，先看主触发点。<裸 LF><裸 LF>```<裸 LF>OK<裸 LF>```","onConflict":"revise"}
  ```

  期望：`action = "reply"`，`content` = 换行还原后的正文（不含 JSON 外壳、不含 `onConflict`）。
- 参考先例：`lib/agent-loop/json-prologue.ts` 的模块注释、`scripts/fix-reply-json-leak.mjs`
  的头部注释、`01-reply-json-leak.md` 的 Implementation Decisions。
- 交付分支：`reply-json-raw-leak`；PR 号与 body 路径见 Answer。

## Comments

## Answer

### 交付形态

| 文件 | 性质 | numstat |
| --- | --- | --- |
| `lib/agent-loop/json-prologue.ts` | 新增第二档（独立判据）+ 两档合一的 seam | +176 / -22 |
| `lib/agent-loop/loop.ts` | `parseAgentAction` 接线（仅 import 行 + 一档调用） | +10 / -6 |
| `lib/agent-loop/loop.test.mjs` | 5 条新回归用例（防未来） | +100 / -0 |
| `lib/agent-loop/fix-reply-json-leak.test.mjs` | 新增/改写 9 条脚本侧用例 | +294 / -42 |
| `scripts/fix-reply-json-leak.mjs` | 候选扫描 + 判定扩档、报告分档、保真修正 | +49 / -19 |
| `.scratch/reply-json-leak/issues/02-raw-json-reply-leak.md` | 本票票据 | +104 |

`lib/data/store.ts`、`lib/data/schema.ts`、`components/`、`lib/markdown.ts`、`round_logs` 与
prompt 骨架一个字没动（`git diff 5bfab39...HEAD --name-only` 共 6 个文件，全在本票 Ownership 内）。

交付分支 `reply-json-raw-leak`，四个 commit，base `5bfab39`。

---

### 1. 红证据（具名命令 + 修改前失败输出）

**必红命令**：`node --test lib/agent-loop/loop.test.mjs`

先在基线 worktree（`git worktree add --detach /private/tmp/base-wt 5bfab39`，隔离副本）上
跑同一命令，四条新用例全红：

```text
$ node --test lib/agent-loop/loop.test.mjs        # base 5bfab39
✖ parseAgentAction escapes raw control characters inside protocol JSON string values
✖ parseAgentAction handles every raw control character below 0x20 inside string values
✖ parseAgentAction keeps escaped sequences and code-fenced raw-control replies intact
✖ parseAgentAction carries ignore / task / ops through the raw-control reply
ℹ tests 61   ℹ pass 57   ℹ fail 4
```

失败详情就是用户报告的症状——**整段 JSON 当正文落库**：

```text
  + actual: { action: 'reply',
+             content: '{"action":"reply","content":"@bob 收到，先看主触发点。\n\n```\nOK\n```","onConflict":"revise"}',
+             onConflict: 'revise' }
  - expected: { action: 'reply',
-               content: '@bob 收到，先看主触发点。\n\n```\nOK\n```',
-               onConflict: 'revise' }
```

脚本侧同一形态在 base 上也是红的（`node --test lib/agent-loop/fix-reply-json-leak.test.mjs`）：

```text
$ node --test lib/agent-loop/fix-reply-json-leak.test.mjs   # base
✖ 修复后的消息走产品读取路径也是还原后的正文
  actual: [ ..., '{"action":"reply","content":"@bob 收到…\n\n```\nOK\n```","onConflict":"revise"}', ... ]
ℹ tests 15   ℹ pass 14   ℹ fail 1
```

**修后同一命令**：

```text
$ node --test lib/agent-loop/loop.test.mjs
ℹ tests 62   ℹ pass 62   ℹ fail 0
$ node --test lib/agent-loop/fix-reply-json-leak.test.mjs
ℹ tests 19   ℹ pass 19   ℹ fail 0
```

红证据全程用本票自造的样本文本（与 live 同形），**没有读 live 数据、没有读 `~/.pi` 会话文件**。

### 2. 防未来接线

`lib/agent-loop/loop.ts` 的全部改动：

```diff
-import { parseRepairedReply } from "./json-prologue.ts";
+import { parseLeakedReply } from "./json-prologue.ts";
@@ parseAgentAction
   if (!parsed) {
-    parsed = parseRepairedReply(cleaned)?.value ?? null;
+    parsed = parseLeakedReply(cleaned)?.value ?? null;
   }
```

（注释同步扩到两档。）`if (parsed)` 块里 content / onConflict / task / ops 的提取与校验
**一个字没改**——第二档只是把 `parsed` 从 null 变成对象，走的是与「直接 parse 成功」
逐条相同的下游代码。

`json-prologue.ts` 的契约面：

```ts
// 两档各自的判据（互不重叠，不共用常量）
export const LEAK_PROLOGUE_PATTERN = /^"?,"/;   // 第一档（票 01，未动）
export const RAW_CONTROL_MIN_CODE = 1;          // 第二档区间，唯一权威表示
export const RAW_CONTROL_MAX_CODE = 31;

// 两档共用：同一份形状校验 + 同一个返回形状
export type ReplyLeakForm = "prologue" | "raw-control";
export interface RepairedReply { form; value; content }
export function parseLeakedReply(text): RepairedReply | null   // 消费方跨的就是这个 seam
export function isLeakedReplyCandidate(text): boolean          // 前置判据（不含 parse）
export function parseRepairedReply(text): RepairedReply | null // 第一档（旧契约，未动）
export function repairJsonPrologue(text): string | null        // 第一档（旧契约，未动）
```

**未扩 `LEAK_PROLOGUE_PATTERN`**：第二档是独立的函数（`repairRawControlChars`）与独立的
区间常量，第一档的常量与函数逐字未动——票 01 票面要求「形态复发时重新评估，而不是扩旧形态常量」。

### 3. 第二档的判据与边界

| 环节 | 判据 | 不过时的行为 |
| --- | --- | --- |
| 候选 | `trim()` 以 `{` 开头且以 `}` 结尾 | 返回 null，走兜底 |
| 转义 | 只转义**字符串字面量内**的 `U+0001–U+001F`；`\` 之后的序列一律保留 | —— |
| 采纳 | parse 成功 ∧ 非数组 ∧ `action ∈ {reply, ignore}` | 维持兜底，不猜测 |

三条设计取舍（都用例钉住）：

- **字面量外的裸换行不动**：美化过的 JSON（`{\n  "content": …}`）本来就合法，`JSON.parse`
  自己会吃；顺手转义属于「做了没被要求的事」。
- **区间起点是 `0x01` 而不是 `0x00`**：SQLite 的 GLOB `[\u0001-\u001f]` 覆盖不了 NUL，
  JS 侧若认 `0x00` 就会「loop 能修、脚本永远捞不到」单向不一致。
- **整串采纳，不做尾部剥离**：这看起来是限制（尾部有杂质就整段兜底），但与第一档**同款**——
  实测确认 `parseRepairedReply(",\"action\":…\"} 补充")` 也返回 null。沿用既有政策，
  本票不引入新的一致性偏差；live 的 9 条候选逐字形态确认都满足（整段就是协议 JSON）。

### 4. 存量回填接线

```diff
 const CANDIDATE_SQL = `SELECT … FROM messages
-  WHERE content LIKE '","%' OR content LIKE ',"%'
+  WHERE content LIKE '","%' OR content LIKE ',"%' OR content GLOB '[*[<U+0001>-<U+001F>]*]'
```

- **SQL 侧刻意是超集**：两端都是全表扫描，超集不额外花 I/O，多捞的代价只是一次
  `parseLeakedReply` 早退，换来不会漏斗的候选面。
- **判定仍只有一份实现**：`planRepair` 消费 `parseLeakedReply` / `isLeakedReplyCandidate`
  两个导入，脚本不重写形态规则。
- **`--apply` 事务口径与回填语义不变**：`VACUUM INTO` 备份 → 单事务 `DROP TRIGGER` →
  逐条 `UPDATE` → 重建触发器 → 提交；回填值 = parse 后的 `content` 字段。
- **报告分档**：`repaired` 逐条带 `form`（`prologue` / `raw-control`），人类可读输出也标出档位。
- **`skipped` 保真**：只有**仍落在候选面上**的才进报告；超集多捕的静默放过。

### 5. dry-run 计划（接受收口 #4）

同一批自造样本（3 条第二档 + 1 条第一档对照 + 1 条正常），**改动前 vs 改动后**跑同一条命令
（改动前取自隔离副本 `/private/tmp/base-wt`，`HOME` 打到岸头目录，全程未开默认数据目录）：

```text
$ node scripts/fix-reply-json-leak.mjs --dry-run --data-dir <tmp> --json

before (base 5bfab39)   changes: 1
  #1 本形态(裸控制): 未进计划（原样落库）
  #2 本形态(裸控制): 未进计划（原样落库）
  #3 本形态(裸控制): 未进计划（原样落库）
  #4 既有对照:       planned form=prologue
  #5 正常回复:       未进计划
  本形态候选 3 条 → 计划 0 条          ← 这一档确实是新增的

after (本票 worktree)   changes: 4
  #1 本形态(裸控制): planned form=raw-control
  #2 本形态(裸控制): planned form=raw-control
  #3 本形态(裸控制): planned form=raw-control
  #4 既有对照:       planned form=prologue   ← 既有档未被破坏
  #5 正常回复:       未进计划
  本形态候选 3 条 → 计划 3 条
```

**同一批样本的逐条计划**（`after`，JSON 输出）：

```json
{
  "mode": "dry-run", "changes": 4,
  "counts": { "repaired": 4, "skipped": 0, "backups": 0 },
  "repaired": [
    { "seq": 1, "form": "raw-control", "to": "@bob 收到，先看主触发点。\n\n```\nOK\n```" },
    { "seq": 2, "form": "raw-control", "to": "第一步完成。\n第二步：核对注入上界。" },
    { "seq": 3, "form": "raw-control", "to": "a\tb" },
    { "seq": 4, "form": "prologue",     "to": "旧形态还在" }
  ],
  "skipped": [], "backups": []
}
```

回填值关键性质在这三行里可见：**裸换行在 `to` 里就是真实换行**（`"第一步完成。\n第二步…"`
是 JSON 输出层的转义，落库后是 U+000A），而 JS 里的字面 `\n` 一类转义仍按 JSON 语义还原。

live 库的 `--apply` 不在本票范围内（票面明确划出，留给 coordinator 验收后另行进行）。

### 6. 门禁

| 门禁 | base `5bfab39`（隔离副本实测） | after HEAD | 判定 |
| --- | --- | --- | --- |
| `npm test` | 1474 pass / 0 fail | **1484 pass / 0 fail** | +10 用例，新增失败 0 |
| `npm run typecheck` | 0 error | 0 error | 无新增 |
| `npm run lint` | 0 error / 1 warning | 0 error / 1 warning | 同一条既有 `hooks/useI18n.tsx:61` |
| `npx eslint <5 个改动文件>` | — | 0 output | 干净 |

基线在本票 base 的隔离副本（`/private/tmp/base-wt`，`node_modules` 符号链接到本 worktree，
`bun install --frozen-lockfile` 装的本 worktree 依赖）上独立取得，两个 run 都是
`npm test` 全量。新增问题数 = 0。

形态样本与命令均不含 live 正文；`HOME` 被打到岸头目录断言全程未开默认数据目录。

### 7. 双轴 code-review

固定点 `5bfab39`，两个 `reviewer` 子代理并行跑同一份 diff，报告原文如下。

#### 7.1 Standards 轴（报告原文）

> ### Correct
> - **判定同源**：`loop.ts:240` 与脚本 `planRepair` 跨同一 `parseLeakedReply`，无第二份形态规则；
>   全仓 grep 确认 `parseRepairedReply` / `repairJsonPrologue` / `LEAK_PROLOGUE_PATTERN` 现仅模块内自用。
> - **测试落点合规且必要**：放 `lib/agent-loop/` 而非 `scripts/`（先例
>   `lib/domain/collab/migrate-i18n-content.test.mjs`）；`npm test` 的 glob 只覆盖 lib/app/components/hooks。
> - 注释全中文、用 seam/module 等 codebase-design 词汇 ✓
>
> ### Hard violations
> 无。
>
> ### Judgement calls（全 P2）
> 1. **分层**：脚本 import 具体 adapter、用 `db.db` 裸连接；头部已写明 owner 授权例外。
>    最小修：把 GLOB 字面量移到模块导出。
> 2. **术语漂移**：同一概念四种叫法（第一/第二形态、形态 A/B、`form` 值、报告字段 `form`）；
>    `form` 属 Mysterious Name。
> 3. **Duplicated Code**：新测试把同一 fixture 又抄三遍（已有 `makeLeakFixture`）。
> 4. **Duplicated Code**：`repairRawControlChars` 的状态机与 `extractJsonObject` 同构
>    （目的不同，抽公用扫描器越界，仅记录）。
> 5. **Speculative Generality**：`planRepair` 的 parser 参数无第二调用点。
> 6. **导出面非最小**：`isLeakedReplyCandidate` 唯一消费方是测试；`parseRepairedReply` 失掉
>    最后外部消费方。票 01 禁改旧契约 ⇒ 保持现状。
> 7. **单引号**：新代码用双引号；eslint 未启用 `quotes`、邻近既有代码同用双引号。
>
> **Merge verdict：OK with notes**（无 P0/P1）

#### 7.2 Spec 轴（报告原文）

> **Correct**
> - 档位正确：在 ③ 与 ④ 之间新增一档，合流进既有 `if (parsed)`，下游提取零改动 ✓
> - 判据逐条兑现：候选 `trim()` 起 `{` 止 `}`；采纳 = parse 成功 ∧ 非数组 ∧ `action ∈ {reply, ignore}`；
>   转义只到字面量内 `<0x20`，`\` 后序列原样保留 ✓
> - 同源同形：唯一实现 `parseLeakedReply`，全仓 grep 无第二份形态规则 ✓
> - 约束守住：`LEAK_PROLOGUE_PATTERN` 未被扩；`store.ts`/`schema.ts` 未入 diff；
>   `MESSAGES_NO_UPDATE_SQL` 原文未动；`round_logs`/注入预算/prompt 骨架未动；测试全 `mkdtempSync` ✓
> - 回归齐；无 scope creep。
>
> **Finding（P2）** SQL 扫描不含 U+0000、JS 含：裸 NUL 的串会被 loop 修复却永不被脚本捞到。
> 测试未钉住该不变式。
>
> **Finding（P2）** `--apply` 后报告失真：回填值含真实 LF/TAB，会被 GLOB 超集再次捞出并进
> `skipped`，理由却是「候选 JSON.parse 失败」——已修好的行被标成坏候选，与头注释「第二遍报
> 0 changes」相左；幂等用例只断 `changes=0`/字节，不断 `skipped`。
>
> **Merge verdict：OK with notes**（无 P0/P1；两条 P2 报告保真类）

#### 7.3 findings 逐条处置

| # | 轴 | finding | 处置 |
| --- | --- | --- | --- |
| S-1 | Standards | 分层：脚本旁路底层连接 / import 具体 adapter（扩了一格裸 SQL） | **部分采纳**：SQL 侧字面量加注释指向模块导出的区间常量作为唯一权威表示，并补用例钉住两侧一致（见 P-1）；旁路本身沿用票 01 的 owner 授权口径（`lib/data/store.ts`/`schema.ts` 不在本票 Ownership，且票面明令不许把「改消息」开成 Store 产品能力）。 |
| S-2 | Standards | 术语漂移：形态 A/B vs 第一/第二形态 vs `form` | **已修**：全仓统一为「第一档/第二档」，报告字段标注为档位。 |
| S-3 | Standards | Duplicated Code：新测试抄了三遍 fixture | **已修**：`makeLeakFixture` 扩成共享 fixture（含两档样本），三条独立用例改为复用它。 |
| S-4 | Standards | Duplicated Code：`repairRawControlChars` 与 `extractJsonObject` 状态机同构 | **豁免**：目的不同（转义 vs 引号配对），抽公用扫描器属改动既有解析路径，超出本票范围；报告本身也判「抽公用扫描器越界」。 |
| S-5 | Standards | Speculative Generality：`planRepair` 的 parser 参数无第二调用点 | **已修（反向）**：该参数现在确有两个注入点（`parseLeakedReply` + `isLeakedReplyCandidate`），参数化的理由从「无」变成「明确」；保留。 |
| S-6 | Standards | 导出面非最小（`isLeakedReplyCandidate` 只被测试消费；`parseRepairedReply` 失掉外部消费方） | **豁免**：票 01 的旧契约明令不动；`isLeakedReplyCandidate` 的消费方是**脚本**（`planRepair` 的保真判据），不是测试——reviewer 看的是加 P-2 修正前的版本。 |
| S-7 | Standards | 引号：标准写单引号，新代码用双引号 | **豁免**：`loop.ts` 同区域既有代码同为双引号；eslint 未启用 `quotes`。与票 01 同判。 |
| P-1 | Spec | SQL 扫描不含 U+0000、JS 含 → 单向不一致 | **已修**：区间收成 `U+0001–U+001F` 并在模块里导出为唯一权威表示，两侧同源；新增用例断言区间两端点被 SQL 捞到且 NUL 两侧都不认。 |
| P-2 | Spec | `--apply` 后报告失真（已修好的行进 `skipped`） | **已修**：`planRepair` 在 skip 前先过 `isLeakedReplyCandidate`，仍在候选面上的才进报告；幂等用例补断言 `dryPayload.skipped` 只含真修不了的那条。 |

**无 P0/P1。** 两条 P2 是实修，其余为豁免并写明理由。

### 8. 票据外的一条边界（coordinator follow-up）

coordinator 在 live 快照上独立探测后交付并同时划界：本形态候选 9 条里 8 条可还原，**1 条不能**
（`487a5e7b`）——它不是控制字符问题，而是 `content` 串值里出现了**未转义的内部双引号**
（正文含 Markdown 片段 `` `<link rel="stylesheet" href="tokens.css">` ``，模型把 `"` 原样输出）。

按三条边界处理，全部照办：

1. **不为它加猜测性修复**——不做启发式引号配平。
2. **不扩 `LEAK_PROLOGUE_PATTERN`、不新增第三档。**
3. 验收证据按档呈现；该条转义后仍 parse 不过（`Expected ',' or '}' after property value`）
   → 落回 null → **进报告 `skipped`**，这是正确行为而非缺陷。

证据（两处各有用例，样本为本票自造的同形文本）：

- `loop.test.mjs` 的 `parseAgentAction falls back on unescaped inner quotes…`：断言
  `parseAgentAction` 走兜底——整段当 content，**不抛错、不丢字**。
- `fix-reply-json-leak.test.mjs` 的 `裸控制字符形态：内容里未转义的内部双引号仍失败——进 skipped，逐字不动`：
  断言 `changes: 0`、该行进 `skipped` 且带原因、**字节逐字不动**。

存量 9 条候选按此分档 = 可采纳 8 条 + `skipped` 1 条（附 id 与原因），脚本现在会如实产出这个分布。

### 9. 交付物

- `git status --porcelain` → 空（`.pi-lens.json` 在公共 `.git/info/exclude` 里，不出现）。
- 四个 commit，分支已推送：`reply-json-raw-leak` → `af680ce`。
- PR **#182** https://github.com/whutlichao/worksplice/pull/182（OPEN，head `af680ce` =
  本票最终提交；正文含 Summary / Evidence / Merge Danger，以 `--body-file` 创建，body 路径
  `/tmp/evidence/pr-body.md`）。

### 10. 收口核对

- [x] 红证据：具名命令 `node --test lib/agent-loop/loop.test.mjs`（base 上 4 红）+ 脚本侧 1 红，
      修后两文件 62/62 与 19/19 全绿；样本文本自造，未读 live 数据
- [x] 既有 `falls back to the whole text` 兜底用例继续绿（票 01 序言档用例同绿）
- [x] `npm run typecheck` / `npm run lint` / `npm test` 全绿（1484/1484），base 可比基线 1474/1474，
      新增问题数 0
- [x] dry-run 计划（改动前 `changes: 1` 且本形态 0 条 → 改动后 `changes: 4` 且本形态 3 条）
- [x] 双轴 code-review 两份独立报告，8 条 findings 逐条处置（2 实修 + 6 豁免并写明理由）
- [x] `git status --porcelain` 干净；分支已推送；PR #182 OPEN 且 head = 最终提交
- [x] 未扩 `LEAK_PROLOGUE_PATTERN`；未改 `store.ts`/`schema.ts`/触发器定义/`round_logs`/prompt 骨架
- [x] 未触碰 `~/.worksplice` 与 `~/.pi` 真实会话数据
- [x] 票据 `Status: resolved`
