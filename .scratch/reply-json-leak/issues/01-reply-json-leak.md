# 01-reply-json-leak

Type: implement
Status: resolved
Assignee: worksplice-dev (this session)
Blocked by: （无）

## Problem Statement

bob（一个 agent）的模型输出自 2026-10-07T02:23:33Z 起发生形态突变：JSON 代码块的开头 `{"` 被输出成 `","`（21 次）或 `,"`（1 次）。原始输出逐字形如：

```text
```json","action":"reply","content":"睡前最后一次核对，确认主触发点健康：\n\n```\n2026-10-07 10:41 CST\n…","onConflict":"resend"}
```
```

（```json``` 后直接跟 `","action`，没有换行也没有 `{`；文本里的 `\n` 是字面转义序列。）

`parseAgentAction`（`lib/agent-loop/loop.ts`）的解析链完全救不回来：整串 `JSON.parse` 失败 → `extractJsonObject` 找不到对象开头（`",` 之后没有 `{`）→ 走兜底 `content = cleaned || text.trim()`，把整段（含 JSON 碎片与字面 `\n`）当正文落库。

结果：受影响消息的 content 形如 `","action":"reply","content":"…","onConflict":"resend"}`，在 UI 里显示为 JSON 碎片 + 字面 `\n` 不换行（用户报告的「消息渲染有问题」）。

coordinator 用数据副本复核（2026-10-07）：形态以 `","action` 开头为主、少量 `,"action` 开头（两者都有）；**全部**满足「把开头 `","` / `,"` 替换为 `{"` 后 `JSON.parse` 成功且形状合法（action=reply|ignore、content 为字符串）」，可 100% 还原。其中存在一条 `","action":"ignore","content":"",…`（修复后 content 为空串）——按统一判据处理，不特判。存量条数随 bob 继续被唤醒而增长（修复尚未部署前每轮都可能新增），故本票只按**形态**描述，不写死条数。

## Solution

owner 已拍板：**修代码防未来 + 写一次性清洗脚本，备份后修复存量**。

1. **A（防未来）**：在 `parseAgentAction` 的既有解析链（直接 parse → extractJsonObject）与兜底之间新增一档「序言修复」，只认 `/^"?,"/` 这两种已实证形态，parse 成功且形状合法才合流进既有 `if (parsed)` 提取逻辑。判定抽成零依赖纯函数模块 `lib/agent-loop/json-prologue.ts`。
2. **B（存量）**：新增一次性离线清洗脚本 `scripts/fix-reply-json-leak.mjs`（CLI 契约照 `scripts/migrate-i18n-content.mjs`）：扫描 `messages` 表 content 命中形态的候选 → **同一个** `json-prologue.ts` 判定 → 只有校验通过才修，失败的跳过并进报告；`--apply` 先备份再单事务内 DROP/UPDATE/CREATE 触发器。
3. **C（回归）**：`lib/agent-loop/loop.test.mjs` 先红后绿。

## Implementation Decisions

- **同源同形**：A 与 B 的「修复判定」共用 `lib/agent-loop/json-prologue.ts` 一个实现，两处不得各写一份。
- **A 的合流点**：修复结果直接赋给既有 `parsed` 变量，后续 `if (parsed)` 里 content/onConflict/task/ops 的提取与校验一处不改、不另写一套。
- **兜底不动**：纯自然语言仍整段当 content（既有 `falls back to the whole text` 用例必须继续绿）。
- **不猜测未知形态**：只处理 `","` 与 `,"`，不做「看起来像」的模糊修复。
- **不把「改消息」开成产品能力**：Store 契约保持无消息写路径；脚本在头部注释写明旁路理由后直连底层连接（`owner 授权的一次性离线修复工具`）。
- **触发器重建与 UPDATE 必须同事务**：SQLite 的 DDL 是事务性的，中途失败整体回滚、触发器不丢；重建 SQL 与 `lib/data/schema.ts` 逐字一致（含 `IF NOT EXISTS`）。
- **测试位置**：脚本测试落 `lib/agent-loop/fix-reply-json-leak.test.mjs`（沿用 `lib/domain/collab/migrate-i18n-content.test.mjs` 为 `scripts/migrate-i18n-content.mjs` 测 CLI 的仓库惯例），不新增 `scripts/**/*.test.mjs` glob——`docs/engineering-standards.md` §2.2 明确「新增测试文件被 `**` glob 自动纳入，不需要手动改 `scripts.test`」，且 `package.json` 不在本票可编辑范围。

## Testing Decisions

- seam = `parseAgentAction`（防未来）+ 清洗脚本 CLI（子进程 + 临时数据目录，断言「存量样子 → 修后样子」）。
- 所有测试自建 `mkdtemp` 临时库，**绝不触碰 `~/.worksplice`**。
- 红绿证据：`node --test lib/agent-loop/loop.test.mjs` 先红（坏形态用例）再绿。

## Out of Scope

- 渲染层（`components/`、`lib/markdown.ts`）一个字不改——owner 已确认显示问题就是这批脏数据。
- 不改 `lib/data/schema.ts` 的触发器定义。
- 不改 `sendMessage` / `deliverWithFreshness` 的既有语义。
- live 库（`~/.worksplice`）的实际执行由 coordinator 在验收后另行进行（先拿数据副本演习）。
- 不改 `docs/engineering-standards.md`（见 Answer「留给 coordinator 的后续」）。

## Further Notes

- 门禁：G-impl（第 0–5 条全过）。
- 交付分支：`whutlichao/reply-json-leak`，base `b6f7f35`，五个 commit。
- PR：**#100** https://github.com/whutlichao/worksplice/pull/100

## Comments

## Answer

### 交付形态

| 文件 | 性质 | 行数 |
| --- | --- | --- |
| `lib/agent-loop/json-prologue.ts` | **新增**，零依赖纯函数模块（无 import、无 IO） | +55 |
| `lib/agent-loop/loop.ts` | `parseAgentAction` 新增一档「序言修复」 | +8 / -0 |
| `lib/agent-loop/loop.test.mjs` | 4 条回归用例（先红后绿） | +50 / -0 |
| `lib/agent-loop/fix-reply-json-leak.test.mjs` | **新增**，脚本 CLI 的 15 条行为用例 | +475 |
| `scripts/fix-reply-json-leak.mjs` | **新增**，一次性清洗脚本 | +290 |

`git diff --numstat b6f7f35...HEAD` 全部为「纯新增」或 `loop.ts` 的 +8/-0，无任何整文件重写。
`components/`、`lib/markdown.ts`、`lib/data/schema.ts`、`package.json` 一个字没动（`git diff b6f7f35...HEAD --stat` 可证）。

---

### 1. 红绿证据

**红**——先加坏形态用例，尚未实现修复时（`node --test lib/agent-loop/loop.test.mjs`）：

```
$ node --test lib/agent-loop/loop.test.mjs

✖ parseAgentAction repairs the leaked `{"` prologue into a protocol reply (0.6485ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
    {
      action: 'reply',
  +   content: '","action":"reply","content":"ok","onConflict":"silent"}',
  +   onConflict: 'revise'
  -   content: 'ok',
  -   onConflict: 'silent'
    }

✖ parseAgentAction unescapes literal \n sequences in a repaired reply (0.167791ms)
  + actual: '","action":"reply","content":"a\\nb","onConflict":"resend"}'
  - expected: { action: 'reply', content: 'a\nb', onConflict: 'resend' }

✖ parseAgentAction carries task and member ops through the repaired prologue (0.196292ms)
  + actual: '","action":"reply","content":"开工","task":{"number":7,"op":"claim"}}'

ℹ tests 47
ℹ pass 44
ℹ fail 3
```

注意 actual 那三行正是**用户报告的症状**：JSON 碎片被整段当 content 落库，且 `\n` 是字面反斜杠 n。

**绿**——实现修复后：

```
$ node --test lib/agent-loop/loop.test.mjs

ℹ tests 47
ℹ pass 47
ℹ fail 0
```

47 = base 的 43 + 新增 4；既有 `parseAgentAction strips json code fences and falls back to the whole text`（兜底用例）继续绿。

### 2. A 的实现与「合流进既有提取逻辑」

`lib/agent-loop/loop.ts` 的全部改动（`git diff b6f7f35...HEAD -- lib/agent-loop/loop.ts`）：

```diff
+import { parseRepairedReply } from "./json-prologue.ts";
@@ parseAgentAction
       }
     }
   }
+  // 序言修复（reply-json-leak）：模型偶发把 `{"` 输出成 `","` / `,"`，上面两档都救不回来
+  // （坏序言之后没有 `{`，提取器找不到对象开头）。命中已实证形态 + 协议形状校验通过才补这一档，
+  // 结果直接合流进下面的 `if (parsed)`——content/onConflict/task/ops 的提取与校验一处不改，
+  // 行为与「直接 parse 成功」完全一致；校验不过则维持现状走兜底。
+  if (!parsed) {
+    parsed = parseRepairedReply(cleaned)?.value ?? null;
+  }
   if (parsed) {
     const action: AgentAction["action"] =
       parsed.action === "ignore" ? "ignore" : "reply";
```

`if (parsed)` 块（content 的 `typeof … === "string"`、onConflict 的 `CONFLICT_CHOICES` 白名单、task 的整数/op 校验、ops 的 `parseMemberOps`）**一个字没改**，修复结果只是把 `parsed` 从 null 变成对象，走的是与「直接 parse 成功」逐条相同的下游代码。

`lib/agent-loop/json-prologue.ts` 的全部契约：

```ts
export const LEAK_PROLOGUE_PATTERN = /^"?,"/;          // 两种已实证形态
export function repairJsonPrologue(text): string | null  // '","' 去 3 字符、',"' 去 2 字符
export function parseRepairedReply(text): RepairedReply | null
export interface RepairedReply { value: Record<string, unknown>; content: string | null }
```

### 3. A 与 B 同源同形（逐行对照）

| 消费方 | 调用 | 位置 |
| --- | --- | --- |
| `parseAgentAction`（防未来） | `import { parseRepairedReply } from "./json-prologue.ts"` | `loop.ts:58` |
| `parseAgentAction` | `parsed = parseRepairedReply(cleaned)?.value ?? null` | `loop.ts:219` |
| 清洗脚本（存量） | `const { parseRepairedReply } = await import("../lib/agent-loop/json-prologue.ts")` | `scripts/fix-reply-json-leak.mjs` `repair()` |
| 清洗脚本 | `const parsed = parseRepairedReply(row.content)` | `planRepair()` |

**两侧走的是同一个函数对象，没有第二份形态规则。** 全仓 grep 佐证：`LEAK_PROLOGUE_PATTERN` 只在 `json-prologue.ts` 定义、`fix-reply-json-leak.test.mjs` 引用；`repairJsonPrologue` 只被 `parseRepairedReply` 调用。

唯一「第二份表示」是脚本 SQL 里的两个 LIKE 前缀——绕不开（要把候选从全表捞出来，得先在 SQL 里说一次「前两字符是这两种之一」）。这条**被一条用例钉死**：`SQL 候选捞取与 JS 形态判据等价：候选集 == LEAK_PROLOGUE_PATTERN 的匹配集`——喂 8 条内容（两种形态各合法/不合法 + `"just-a-quote` / `,a-comma-first` / 带前导空格 / 正常中文），断言进入计划的 4 条**恰好等于** `LEAK_PROLOGUE_PATTERN.test(content)` 命中的 4 条。SQL 多捞（白跑）或少捞（漏修）都红。

### 4. 脚本行为与门禁

实测存量的两条形态（`","` 与 `,"` 各一条）走脚本：

```
$ node scripts/fix-reply-json-leak.mjs --data-dir <tmp>              # dry-run（默认，零写入）
worksplice 回复 JSON 碎片清洗 · dry-run · 数据目录 /tmp/…
  修复 7c1e…（#2 1667…，2026-10-07T03:13:37.221Z）：44 字符
dry-run: 2 changes（修复 2，跳过 0，备份 0） —— 未写入（加 --apply 落盘）
```

**空串 content 的处置**（coordinator 事实修正后核对过）：`","action":"ignore","content":"",…` 修复后 content 是空串。空串**是**字符串，按统一判据照常修、不特判——用例 `空串 content（live 实测的 ignore 形态）修复为空串，不被当成「非字符串」跳过` 钉住这一条。判据里没有任何针对空串的分支（`typeof value.content === "string"` 天然为真）。
只有**根本没有 content 字段**（如 `","action":"ignore"`）的候选才会落进 skipped（`content` 为 null = 无从回填），且带原因列出、绝不静默——同样不特判。

- **CLI**：`--dry-run`（默认）/ `--apply` / `--data-dir <path>`（缺省 `WORKSPLICE_DATA_DIR` → `~/.worksplice`）/ `--json` / `-h`；退出码 0 / 2（用法与环境）/ 1（运行期）。
- **只有校验通过才修**：形状不合协议（parse 失败 / action 不是 reply|ignore / content 不是字符串）→ 跳过并进报告，带 `id` + `reason`，绝不按「看起来像」硬改。
- **回填值** = 候选 parse 后的 `content` 字段，字面 `\n` 在这一步还原为真实换行（用例断言含嵌套 ``` 围栏的真实形态）。
- **`--apply` 事务**：先 `VACUUM INTO` 备份（一致性快照、文件名带时间戳、不覆盖既有备份），再**单事务**内 `DROP TRIGGER messages_no_update` → 逐条 `UPDATE` → `CREATE TRIGGER messages_no_update`（SQL 与 `lib/data/schema.ts` 逐字一致，含 `IF NOT EXISTS`）→ 提交。DDL 与 UPDATE 同事务，中途失败整体回滚、触发器跟着回来。FTS 交给既有 `messages_fts_update` 触发器同步，脚本不碰 `messages_fts`（用例 `FTS 跟着回填走` 验证搜索能命中还原后的正文）。
- **幂等**：第二遍 `--apply` 报 0 changes、字节不变、不新增备份（备份只在有改动时做）。
- **绝不触碰 `~/.worksplice`**：全部用例自建 `mkdtemp` 库；`显式 --dry-run 与默认形态一致，且绝不碰默认数据目录` 那条额外把 `HOME` 打到岸头目录并断言 `~/.worksplice` 不存在。本票自始至终没有对 live 库做任何读写。

### 5. 脚本自动测试进门禁

```
$ npm test
ℹ tests 1061
ℹ pass 1061
ℹ fail 0
```

14 条新用例全部由 `npm test` 命中（另 15 条，空串形态那条见上；贴其中 11 条实际输出）：

```
✔ dry-run 零写入：两条脏形态逐字不动、不建备份，报告里逐条列出计划
✔ --apply 还原两条脏消息：回填值 = 协议 content 字段，字面 \n 变回真换行
✔ 重建的触发器 SQL 与 lib/data/schema.ts 那一条逐字一致（直接对源文件，不是自己对自己比）
✔ --apply 后不可变触发器仍在位：UPDATE 仍被 ABORT
✔ 幂等：第二遍 --apply 报 0 changes、字节不变、不新增备份
✔ 形状不合协议的候选被跳过并进报告，绝不按「看起来像」硬改
✔ content 不是字符串的候选被跳过（无从回填），并列出原因
✔ FTS 跟着回填走：改完的消息能搜到还原后的正文（不手工改 messages_fts）
✔ 显式 --dry-run 与默认形态一致，且绝不碰默认数据目录
✔ 错误路径：数据目录不存在 / 空目录 / 参数未知 → 退出码 2 且不留下任何文件
✔ 备份是可用的一致性快照：里面仍是修复前的坏形态
✔ dry-run 后坏数据仍在（零写入），且报告只列计划
✔ SQL 候选捞取与 JS 形态判据等价：候选集 == LEAK_PROLOGUE_PATTERN 的匹配集
✔ 修复后的消息走产品读取路径也是还原后的正文
```

**测试位置偏离 spec 建议的说明**（spec 允许「若有更贴合仓库惯例的替代做法，Answer 里说明」）：spec 建议 `scripts/fix-reply-json-leak.test.mjs` + 往 `package.json` 加 `"scripts/**/*.test.mjs"` glob。实际落 `lib/agent-loop/fix-reply-json-leak.test.mjs` 且**未改 `package.json`**，理由两条：

1. 仓库已有同一形态的先例——`scripts/migrate-i18n-content.mjs` 的 CLI 测试就落在 `lib/domain/collab/migrate-i18n-content.test.mjs`，不在 `scripts/` 下。
2. `docs/engineering-standards.md` §2.2 明写：「**门禁里看到全量，就真的是全量：新增测试文件被 `**` glob 自动纳入，不需要手动改 `scripts.test`**」。既有 `test` 脚本已含 `"lib/**/*.test.mjs"`，新文件自动纳入（上面的 `npm test` 输出即证）。

顺带一提：`package.json` 本来也不在本票 Ownership 的可编辑范围内，不改它同时满足了 BEHAVIOR RULE 5。

### 6. tsc / eslint 增量对照

基线取自本票 base `b6f7f35`（把改动备份后 `git checkout` 回 base、跑完门禁再恢复，全程用 `git diff` 核验过文件清单）：

| 门禁 | base（b6f7f35） | after（HEAD） | 判定 |
| --- | --- | --- | --- |
| `npx tsc --noEmit` | 0 error / 0 warning | 0 error / 0 warning | 无新增 |
| `npx eslint .` | `✖ 1 problem (0 errors, 1 warning)` | `✖ 1 problem (0 errors, 1 warning)` | 无新增（同一条既有 warning） |
| `npx eslint <本票 5 个改动文件>` | — | 0 output | 干净 |
| `npm test` | — | 1061/1061 | 全绿 |

那条既有 warning 是 `hooks/useI18n.tsx:61 react-hooks/exhaustive-deps`，base 与 after 完全一致。

### 7. 双轴 code-review（Standards + Spec，两份独立，未合并未重排）

固定点 `b6f7f35`，两个 reviewer 子代理并行跑同一份 diff，报告原样贴在这里。

#### 7.1 Standards 轴（报告原文）

> **分层专项判断**（`scripts/fix-reply-json-leak.mjs:249-262`）
> - 脚本 `import("../lib/data/sqlite.ts")` 并用 `db.db` 底层连接跑裸 SQL（DROP TRIGGER / UPDATE / VACUUM INTO），偏离 `docs/engineering-standards.md` §1「分层」的「不写 SQL、不 import 具体 adapter、经 Store 契约」。方向本身正确（离线脚本 → lib/，不反向），`json-prologue.ts` 零依赖、被 `loop.ts:58` 单向引入也无问题。判为 judgement call：标准条文只约束「业务模块」，脚本头部已写明 owner 授权的一次性例外。
> - 但仓库**已有相反先例**：`scripts/migrate-i18n-content.mjs:13-14` 明写「本脚本不新增旁路 SQL；唯一新增的数据层能力是 `Store.renameChannel`」——即先例选择了走契约。本票选了旁路。最小修法：在 engineering-standards §1 补一条「一次性离线修复脚本可直连数据层」的例外条文，让偏离有据；否则两票先例并存会漂移。
>
> - **Correct**：防未来链路合流点最小（`loop.ts:217-220` 只加一档兜底，content/onConflict/task/ops 提取零改动）；判定同源（脚本与 loop 共用 `json-prologue.ts`）；测试落点沿用 `migrate-i18n-content.test.mjs` 先例，glob 自动纳入（§2.2 合规）；注释全中文（§1 合规）。
> - **Finding P2（judgement）Duplicated Code**：`MESSAGES_NO_UPDATE_SQL` 复制 `lib/data/schema.ts` 的触发器定义；已由 `fix-reply-json-leak.test.mjs:200-210` 对照 `sqlite_master` 兜底，可接受，仅记录。
> - **Finding P2（judgement）Mysterious Name**：`fix-reply-json-leak.test.mjs:330` 用例名「只读打开时跑 dry-run 不改库」，但该用例并未以只读方式开库（`run(["--data-dir", dataDir])` 走正常打开路径），名与行为不符。改名为「dry-run 后坏数据仍在」即可。
> - **Finding P2 Duplicated Code**：`json-prologue.ts:59-62` 与 `loop.ts:225-229` 形状校验同款重复；已注释说明且 loop 已改为委托，不建议再动。
> - **Finding P2**：issue `01-reply-json-leak.md` 在 head 仍 `Status: in-progress` / `Answer`（进行中），与 AGENTS.md「worker 全权负责 Status 收敛 + Answer」不符——合并前补齐。
> - 引号：标准写「单引号」，`json-prologue.ts` 全双引号，但 eslint 未启用 quotes 规则且 `loop.ts` 邻近代码同样双引号，不报。
>
> **Merge verdict：OK with notes**（无 P0/P1；上述均 P2 judgement call）

#### 7.2 Spec 轴（报告原文）

> ## 评审（Spec 轴）
>
> **同源同形**：✅ 唯一实现。`lib/agent-loop/json-prologue.ts:47` `parseRepairedReply`；`loop.ts:58` import、`:219` 合流进既有 `if (parsed)`（content/onConflict/task/ops 未改）；`scripts/fix-reply-json-leak.mjs` `repair()` 内 `await import("../lib/agent-loop/json-prologue.ts")`。无第二份形态规则（`loop.test.mjs:210-255`、`fix-reply-json-leak.test.mjs` 的双形态/兜底用例齐）。
>
> **B.6 并发提醒**：✅ 头部注释「运行中的实例建议先 --dry-run 看计划、再挑低频时段 --apply」。
>
> **测试位置**：✅ 偏离被 spec 允许——票面 Implementation Decisions 引用 `docs/engineering-standards.md:48`「新增测试文件被 `**` glob 自动纳入」；`package.json` test 含 `"lib/**/*.test.mjs"`，`npm test` 确实命中该文件。
>
> **Finding**
> - **P1**「交叉校验」是自证的：注释称「与 schema.ts 逐字一致…由 fix-reply-json-leak.test.mjs 盯住」，但该测试比对的是 `sqlite_master.sql` 与脚本自己导出的 `MESSAGES_NO_UPDATE_SQL`——触发器正是脚本建的，等式恒真，schema.ts 漂移不会被发现。最小修：测试里 import `lib/data/schema.ts` 的 `SCHEMA_STATEMENTS` 或 openDataDb 新库读 `sqlite_master.sql` 作对照。
> - **P2** 逐字一致未做到：脚本 SQL 缺 `IF NOT EXISTS`，schema.ts:147 有；测试两边都 replace 掉该词，把差异掩掉了。
> - **P2** `--dry-run` 非严格零写：`openDataDb` → `runMigrations`（`schema.ts:203-215`，含 seed/pragma user_version）会在旧库上真写。注释「照现状开库即可」不足以覆盖 dry-run 承诺。
> - **P2** SQL 前缀 `LIKE '","%' OR ',"%'` 是形态规则的第二份表示（虽注释声明只做捞取）。
> - **P2** Answer 仍「（进行中）」，Status `in-progress`：spec「Answer 里说明」未兑现。
>
> Scope creep 轻微：`--help`、数据目录存在性校验、7 条额外测试，均无害。
>
> **Merge verdict：OK with notes**（P1 建议合并前补真对照；`npm test` 需 coordinator 复跑确认）。

#### 7.3 findings 逐条处置

| # | 轴 | finding | 处置 |
| --- | --- | --- | --- |
| S-1 | Standards | 脚本旁路底层连接 vs `migrate-i18n-content` 走契约的相反先例，建议给 engineering-standards §1 补例外条文 | **豁免**：`docs/engineering-standards.md` 不在本票 Ownership 内（BEHAVIOR RULE 5）。已在本票「留给 coordinator 的后续」点名。脚本头部注释已写明 owner 授权的一次性例外。 |
| S-2 | Standards | P2 Mysterious Name：用例名说「只读打开」但并未只读开库 | **已修**：改名「dry-run 后坏数据仍在（零写入），且报告只列计划」。 |
| S-3 | Standards | P2 Duplicated Code：`MESSAGES_NO_UPDATE_SQL` 复制 schema.ts | **已加固**：对照从「自己对自己比」换成对 `lib/data/schema.ts` 源文件的真对照（见 P-1）。复制本身保留——`SCHEMA_STATEMENTS` 未导出，脚本没法 import。 |
| S-4 | Standards | P2 Duplicated Code：json-prologue 的形状校验与 loop.ts extractJsonObject 分支同款 | **豁免**：那是**既有**代码，且刻意镜像（注释写明「逐条同款」），是「同源同形」要求的一部分。抽掉 extractJsonObject 分支的校验属于改动既有解析路径，超出本票范围。 |
| S-5 | Standards | P2 Status / Answer 未收敛 | **已修**：本条 Answer + `Status: resolved`。 |
| S-6 | Standards | 引号：标准写单引号，`json-prologue.ts` 全双引号 | **豁免**：`loop.ts` 同一区域既有代码同样是双引号；「与仓库既有语言保持一致」是更强的约束。eslint 未启用 quotes 规则。 |
| P-1 | Spec | **P1** 交叉校验自证（`sqlite_master.sql` vs 脚本自己导出的常量，恒真） | **已修**：改成 `readFileSync("lib/data/schema.ts").includes(MESSAGES_NO_UPDATE_SQL)`——直接对**源文件**断言是子串，schema.ts 漂移就红。**已验证会红**：临时把脚本里的 `IF NOT EXISTS` 删掉，该用例立刻红（输出见 commit `84f02d6` 的经过），随后恢复。 |
| P-2 | Spec | P2 未做到逐字一致（脚本缺 `IF NOT EXISTS`；测试两边都 replace 掉该词把差异掩了） | **已修**：脚本常量补齐为 schema.ts 原文（含 `IF NOT EXISTS`）；测试不再做两边的 `replace`（那句归一化现在只保留在注释里，说明 SQLite 存 sqlite_master 时会抹掉该词——这才是保留行为级断言的原因）。 |
| P-3 | Spec | P2 `--dry-run` 非严格零写（`openDataDb` → `runMigrations` 会 seed / pragma） | **已修**：照 `migrate-i18n-content` 的同一口径，在脚本头部补了「关于「dry-run 零写入」的口径」整段（数据层既有的打开语义、绝不制造空库、运行中实例本来就对这些文件有写权）。 |
| P-4 | Spec | P2 LIKE 前缀是形态规则的第二份表示 | **已修**：补用例 `SQL 候选捞取与 JS 形态判据等价`，把两份表示钉死（见第 3 节）；脚本注释同步写明「绕不开 + 被测试钉住」。 |
| P-5 | Spec | P2 Status / Answer 未兑现 | **已修**。 |
| P-6 | Spec | scope creep：`--help`、数据目录存在性校验、7 条额外测试 | **接受**：三者都直接照抄 `migrate-i18n-content` 的同一契约（该脚本的测试也有对应几条），是「形态先例照它」的必然结果，不是新增行为面。 |

### 8. 过程中发现并修掉的一个自身失误（留档）

拿红证据时用了 `git checkout HEAD -- scripts/fix-reply-json-leak.mjs` 做回退，而 HEAD 上那份还没带 `IF NOT EXISTS`——于是**把同一批改动里的 P-2 修复合一起回退了**。全量 `npm test` 立刻把「逐字一致」用例跑红（1061 tests / 1 fail），补回后 1061/1061 全绿。commit `84f02d6` 就是这次补回。留在这里是因为它同时验证了 P-1 那条真对照确实在起作用。

### 9. 留给 coordinator 的后续（不在本票范围）

1. **live 库修复的执行**：`--dry-run` 看计划 → 拿一份数据副本先演习 `--apply` → 挑低频时段对 `~/.worksplice` 实跑。注意存量**仍在增长**（修复部署前 bob 每轮唤醒都可能新增一条），所以实跑前先重新 `--dry-run` 看当次命中数。本票自始至终没碰过 live 库。
2. **`docs/engineering-standards.md` §1 补一条例外条文**：一次性离线修复脚本可直连数据层（当前 `migrate-i18n-content` 走契约、本票脚本走旁路，两票先例并存会漂移）。这是 S-1 finding 的正解，需要独立一票。
3. **观察形态复发**：若 `json-prologue.ts` 之后在 live 数据里再命中（即 `parseRepairedReply` 返回 null 的候选变多），说明模型输出形态又变了，届时应重新评估而不是扩 `LEAK_PROLOGUE_PATTERN`。

### 10. 收口核对

- [x] `node --test lib/agent-loop/loop.test.mjs` 47/47（含既有 falls-back 用例）
- [x] `node --test lib/agent-loop/fix-reply-json-leak.test.mjs` 15/15
- [x] `npm test` 1061/1061，新增测试文件被既有 glob 命中
- [x] `npx tsc --noEmit` 无新增；`npx eslint .` 与 base 同（0 error / 1 既有 warning）
- [x] 双轴 code-review 两份独立报告，findings 逐条处置或写明豁免
- [x] `git status --porcelain` 干净；`.pi-lens.json` 已写入仓库根并加进 `.git/info/exclude`，不进仓库
- [x] 票据 `Status: resolved`