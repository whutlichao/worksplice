# Answer：回复 JSON 泄漏第三形态（尾部冗余空键）

Status: resolved
Base: `6719ccef19e55ba09671c450ffccef6102b8dc9c`
分支：`reply-json-leak-tail`（交付 commit：`fix(agent-loop): 修复尾部空键导致的回复 JSON 泄漏`）

## 结果

模型偶发把协议 JSON 的**最后一个成员名写成空字符串**（没有冒号、没有值，紧接 `}`）：

```
…用正确格式重提 #1 并在本串外汇报验证结果。",""}
```

`JSON.parse` 报 `Expected ':' after property name`；`extractJsonObject` 取得到平衡的 `{…}`（空键不影响
括号配对）但再 parse 报同一个错；前两档都不命中（不以 `","` / `,"` 开头、也没有裸控制字符）→ 整段
JSON 当正文落库，顺带把 `task` / `ops` 声明整段吞掉。

本轮加**第三档**（`form: "trailing-key"`）把它判出来并还原成真回复，同时把存量清洗脚本的候选面补上
一条结构前置筛。判据只剥离**结构上可判定为冗余**的那一段，不做任何猜测性修复。

## 改动清单

| 文件 | 改动 |
| --- | --- |
| `lib/agent-loop/json-prologue.ts` | 新增第三档：`scanProtocolTail`（一次字符级走查，跟踪字面量/转义/括号深度）+ `matchTrailingKeyAt`（字面量之外的 `,` `[空白]` `""` `[空白]` `}`）+ `repairTrailingKey` + `parseTrailingKeyReply`；`ReplyLeakForm` 加 `"trailing-key"`；`parseLeakedReply` 串上第三档；`isLeakedReplyCandidate` 覆盖第三档的**候选面**（含未闭合尾）。模块头补第三档实证形态与「为什么不共用判据」 |
| `scripts/fix-reply-json-leak.mjs` | `CANDIDATE_SQL` 增加第三条候选条件 `trim(content, 空格/制表/LF/CR) GLOB '{"*'`；头部注释补第三档形态与「未闭合只报告」的边界 |
| `lib/agent-loop/json-prologue.test.mjs` | **新建**：模块接缝测试（第三档正向/空白/字面量内不动/协议形状门/未闭合候选≠可修/8 条反例不回归） |
| `lib/agent-loop/loop.test.mjs` | `parseAgentAction` 层第三档用例：内容还原、围栏、`task`/`ops` 不被吞、`ignore`、未闭合仍兜底 |
| `lib/agent-loop/fix-reply-json-leak.test.mjs` | 脚本层第三档用例（dry-run 计划 / apply 回填 / 幂等）+ 未闭合「进候选面但绝不修」用例；不变式用例 JS 候选面断言 `7→8`（新增样本后 `9`），并修掉两句与断言不符的注释 |

### 判据为什么是这一档（凭什么是「可判定」而不是「猜测」）

合法 JSON 在**字符串字面量之外**永远不会出现 `,` + `""` + `}` 这个序列：逗号后必须是成员名，而成员名
必须跟冒号与值。所以它既能被无歧义识别，也能被无歧义剥离。命中后仍过同一份 `acceptProtocolObject`
（对象 / 非数组 / `action ∈ {reply, ignore, conclude}`），校验不过维持 `null`。

明确**不做**：引号配平、通用尾部垃圾剥离、截断补全、任何启发式猜测。字面量内出现的任何序列一律不动
（有专门用例：`{"action":"reply","content":"示例 ,\"\"} 结束"}` 的 `isLeakedReplyCandidate` 必须为
`false`，且字面量与尾部同时出现时只剥离尾部那一个）。

## 决策（本轮问回人，用户裁决）

基线读数与票面期望冲突，我先把实测摆出来问回 coordinator，没有自行扩大判据：

- 我报的实测：副本库上改前 `repaired=0 / skipped=6`；`fc9bc7f1` 尾部确实逐字是 `,""}`，但现有 SQL
  候选面捞不到它；票面要求 `skipped=8` 里的两条「未闭合」（`9134592b`、`611588b3`）**今天就被 SQL
  GLOB 捞到**（含裸换行），但 JS 侧 `isLeakedReplyCandidate` 判 false（档二前置筛要求 trim 后以 `}`
  结尾）→ 走静默超集分支，不进 `skipped`。所以「skipped=8」必须把「协议形状但尾部不完整」也算候选。
- coordinator 裁决（要点，逐字）：「裁决：按 A 做。并更正一条：spec 里 skipped=8 的写法是我按 JS 候选面
  推的、没实测脚本读数，基线错误在我，不在你——感谢你把它当真测了。」随后给出采纳后的验收口径：
  候选面语义 = 「协议形状 + 尾部结构缺陷」，两类并列 —— (1) 冗余空成员名尾：可修；(2) 未闭合尾：只报告、
  绝不修（`parseLeakedReply` 必须继续返回 null）；`CANDIDATE_SQL` 同步扩到能捞这两类；既有不变式用例
  断言 `7→8` 并修掉与断言不符的注释。
- 同一条裁决里的**红线**（原样遵守）：「A 不得被读成通用放宽，越界即 escalation」——不得做引号配平、
  不得做通用尾部垃圾剥离、不得对未闭合做任何补全尝试；「进入候选面」≠「可修」，须有独立测试钉住。
  这条区分落在 `lib/agent-loop/json-prologue.test.mjs` 的「未闭合尾：进入候选面，但绝不修」用例，
  以及脚本层「未闭合协议对象：进候选面报告，但绝不修」用例（样本**不带**裸控制字符，只能靠新的
  `{"` 结构前置筛被捞到，同时钉住 SQL 侧那一半）。

实现上没有为「未闭合」新增任何修复分支：`scanProtocolTail` 只在结构上报告 `kind: "unclosed"`，
`repairTrailingKey` 对非 `trailing-key` 直接返回 `null`。

## 红 → 绿

紧反馈环（`diagnosing-bugs` 阶段 1）：`/tmp/rjl-loop.mjs`——最小样本喂 `parseLeakedReply` 与
`parseAgentAction`，`verdict` 非 GREEN 时退出码 1；秒级、确定性、只看用户可见症状（「整段 JSON 当正文，
声明字段被吞」）。

**红（改前，`loop-before.log`）**

```json
{ "verdict": "RED",
  "isCandidate": false,
  "parseLeakedReply": null,
  "parseAgentAction": { "action": "reply", "content": "{\"action\":\"reply\",…,\"\"}" },
  "withOps": { "task": null, "ops": null },
  "failures": ["parseLeakedReply 返回 null（整段 JSON 被当正文）",
               "parseAgentAction 走兜底：content = 整段原文（泄漏）",
               "task 被吞：undefined", "ops 被吞：undefined"] }
```

**绿（改后，`loop-after.log`）**

```json
{ "verdict": "GREEN", "isCandidate": true,
  "parseLeakedReply": { "form": "trailing-key", "content": "第一行\n第二行" },
  "parseAgentAction": { "action": "reply", "content": "第一行\n第二行" },
  "withOps": { "task": { "number": 3, "op": "claim" },
               "ops": [{ "op": "react", "fields": { "seq": 9, "emoji": "👍" } }] },
  "failures": [] }
```

**单测红 → 绿（TDD 节奏：先写失败的测试再改实现，未先写实现）**

- 红：先落 `json-prologue.test.mjs` 与两个既有测试文件的新用例，跑
  `node --test --test-timeout=60000 lib/agent-loop/json-prologue.test.mjs lib/agent-loop/fix-reply-json-leak.test.mjs`
  → `tests 29 / pass 21 / fail 8`（8 条全在第三档与未闭合候选的新断言上；边界用例
  「字面量内不动」「协议形状门」改前就是绿的，说明红不是「整片塌」）。
- 绿：实现 `scanProtocolTail` / `repairTrailingKey` / `parseTrailingKeyReply` 与 SQL 候选面后同一命令
  → `29 / 29` 通过。

**窄档门禁**：`node --test --test-timeout=60000 "lib/agent-loop/*.test.mjs"` → `tests 303 / pass 303 / fail 0`。
`node_modules/.bin/tsc --noEmit` 干净；`eslint` 只跑本票 5 个改动文件 → 0 问题（未跑全仓 lint 基线）。
未跑 `next build`。

**变异验证（证明新用例真的会咬）**：把 SQL 的 `trim(content, …)` 临时去掉（只剩 `content GLOB '{"*'`），
「SQL 候选捞取不漏斗」用例立刻变红（前导空格样本只能靠 trim 捞到）；随后还原文件并确认
`git diff --stat scripts/fix-reply-json-leak.mjs` 为空。

## 存量清洗验证（**副本库**，live 库零写入）

副本取自 `~/.worksplice/` 的 `worksplice.db` + `-wal` + `-shm` → `/tmp/rjl-live-copy/`（只 `cp`，
从未打开 live 库；脚本一律带 `--data-dir /tmp/rjl-live-copy`）。

`node scripts/fix-reply-json-leak.mjs --data-dir /tmp/rjl-live-copy --dry-run --json`：

```json
{ "mode": "dry-run", "changes": 1,
  "counts": { "repaired": 1, "skipped": 8, "backups": 0 },
  "repaired": [ { "id": "fc9bc7f1-26f6-4a1a-be2f-a9735f0c2746", "form": "trailing-key" } ],
  "skipped": ["487a5e7b…","47336f4d…","7ea41786…","8867cca0…","48a27e97…","611588b3…","159f00cd…","9134592b…"] }
```

`--apply`（同一副本）读数（独立核对脚本 `/tmp/rjl-verify-copy.mjs`）：

| 项 | 读数 |
| --- | --- |
| `changes` / `counts` | `1` / `{repaired:1, skipped:8, backups:1}` |
| 备份 | `worksplice.db.bak-<时间戳>` 已生成；只读打开备份，`fc9bc7f1` 内容 = 修复前字节（可回退凭据） |
| 回填值独立来源①（剪掉尾部 `,""}` 后再 parse） | 与落库值一致 |
| 回填值独立来源②（防未来链路 `parseAgentAction(content)`） | 与落库值一致；`task = {number:2, op:"claim"}`、`ops` 1 条都被取回 |
| 回填后内容 | 以 `# 深圳 2026/2027 年冬季…` 开头、以 `…汇报验证结果。` 结尾，不再以 `{"action"` 开头 |
| 8 条 skipped | content **逐字节不变**（逐条 sha256 比对） |
| 第二遍 `--dry-run` | `changes=0 / repaired=0 / skipped=8`（幂等；`skipped` 仍是那 8 条不可修的） |
| 不可变触发器 | 既有用例继续绿（`--apply` 后 UPDATE 仍被 `messages are immutable` ABORT） |

**live 库未被我写入**：`--apply` 只对 `/tmp/rjl-live-copy` 执行。会话期间 `~/.worksplice/worksplice.db-wal`
的 mtime 有变化（19:09），那是别的进程（运行中的实例）在写，本票全程只 `cp` 读取，未打开该目录。

## 双轴 code-review（Standards + Spec，未豁免）

加载方式：直接读取 `/Users/apple/.pi/agent/skills/code-review/SKILL.md`（宿主无原生 Skill 调用），按其
§4 用**两个全新上下文的并行子 agent**（`reviewer`）分轴审 `git diff 6719ccef…HEAD`。两条轴的原始结论
与处置：

### Standards 轴

- **P1（已改）**：空白集的两份表示（`json-prologue.ts` 的 `[ \t\n\r]` 与脚本 SQL 的
  `char(32)||char(9)||char(10)||char(13)`）只有注释互指、无用例钉住 → 在不变式用例加一条
  **前导空格 + 未闭合**样本（它没有裸控制字符，只能靠 SQL 的 `trim` 捞到），并用上面那条变异实验
  证明它真会红；同时在常量注释里写清「制表/LF/CR 开头的行另已被裸控制字符 GLOB 捞到，那三个字符上
  漂移只会多捞不会漏斗」。
- **P2（已改）**：`parseLeakedReply` 上方小节标题仍写「两档合一」→ 改「三档合一」。
- **P2（已改）**：`json-prologue.test.mjs` 头部称「模块的公共面只有两条」与实际导出不符 → 改为
  「本文件只跨 `parseLeakedReply` / `isLeakedReplyCandidate` 这两条判定接缝」。
- **P2（已改）**：`ProtocolTailDefect` 导出但无外部消费者（Speculative Generality）→ 收回为模块内
  `type`。
- **判断（不改，说明理由）**：possible *Duplicated Code* —— 三个 `parse*Reply` 包装与两处
  `inString/escaped` 走查。三个包装各自只有 3 行且形状完全一致（`candidate → parseCandidate(form)`），
  是「同一份校验 + 每档一个候选生成器」的既定形态；两条走查的**策略**不同（档二逐字符改写、
  档三只判定结构并要跟踪逗号/括号）。抽公共 walker 需要回调钩子，复杂度高于两段十几行的直走查，
  且在档二身上动刀会违反票面「不扩大另一档」的纪律 → 保留现状。
- **判断（已按说法修正注释）**：「取最靠后」与实现（文档序最后一个，嵌套对象内的同类缺陷也会命中）
  有轻微措辞漂移 → 注释改为「文档序最后一个，即最贴近文本末尾的；嵌套对象里的同名缺陷同属本档」。
- **遗留（超出可编辑面，未改）**：`AGENTS.md` 的 File Map 没有 `json-prologue.ts` 条目（改前就缺，
  本票新增第三档后更值得补）；`AGENTS.md` 属全局治理文档，不在本票 Ownership 内。

### Spec 轴

- 逐条核对后**未发现缺失要求与 scope creep**：第三档判据/候选生成/`form`/串接、`isLeakedReplyCandidate`
  覆盖、模块头注释、`CANDIDATE_SQL` 扩面与不变式、不动 prompt / 数据面 / schema / 零依赖 / 不跑格式化，
  均按票面执行；`--dry-run` / `--apply` 读数在副本库复核通过。
- **P2（已改）**：`fix-reply-json-leak.test.mjs` 不变式用例的注释已过期（「两个 LIKE + 一个 GLOB」现在
  是两个 GLOB；「多捞的行进了 repaired」与断言「多捞的不进任何计划位」相反）→ 两句都按现状重写。
- **P2（已改）**：`loop.test.mjs` 里未闭合样本的注释「候选判据不成立（不以 `}` 结尾）」在本轮后为假
  → 改为「第三档候选面命中但不可修」。
- **P2（遗留，未改）**：`lib/agent-loop/loop.ts:308` 的注释「泄漏修复（reply-json-leak，两档）」只列 ①②，
  现已过时。`loop.ts` **不在本票可编辑面**（票面 Ownership 只给 `json-prologue.ts`、清洗脚本、
  `lib/agent-loop/` 下的测试文件、Answer），改动它会越过授权面 → 留给后续票或 coordinator 裁定。

## 已知边界（有意为之，不是缺陷）

1. **候选 ≠ 可修**：`isLeakedReplyCandidate` 对「未闭合尾」返回 `true`，`parseLeakedReply` 对它返回
   `null`。前者只决定「值不值得报告」，后者决定「能不能改」。
2. **三档不串联**：一行同时含裸控制字符与尾部空键时，档二只改控制字符（parse 仍失败 → null），档三只
   剥空键（控制字符仍在 → parse 失败 → null），合起来修不了。与既有「两档各自独立放宽」的纪律一致；
   形态复发时重新评估一档，而不是让三档互相调用。
3. **空白集两份表示**：JS 侧刻意用自己的 `[ \t\n\r]` 而不是 `trim()`（后者会吃 Unicode 空白，SQLite 的
   `trim` 不吃）。
4. 存量里 8 条不可修的形态（6 条 content 内未转义双引号 + 2 条 JSON 未闭合）本轮**明确不修**：
   前者做引号配平属猜测性修复（`json-prologue.ts` 注释早已裁决），后者无法可靠还原正文完整性。

## 发现 / 遗留

- **根因判断（不在本票开工）**：三种泄漏形态（坏序言 / 裸控制字符 / 尾部空键）同一个根因——**让模型把长
  markdown 正文塞进 JSON 字符串**。前两档是「输出走形」，本轮这档是「模型在 JSON 尾部多写了一个空键」，
  更像协议设计问题而不是解析问题：正文越长、越像文档，走形概率越高。真正的收敛方向应是协议层
  （例如 `content` 之外的结构与正文分离，或改用带分隔符的文本协议），那不是本票范围。
- **遗留 1**：`lib/agent-loop/loop.ts:308` 注释仍写「两档」（不在可编辑面，见上）。
- **遗留 2**：`AGENTS.md` File Map 缺 `json-prologue.ts` 条目（治理文档，不在 Ownership）。
- **遗留 3**：live 库的 `--apply` 按票面分工由 coordinator 在验收阶段执行；本票交付的是副本库上的完整
  可复现验证，命令即上面那三条（`--dry-run --json` / `--apply --json` / 再跑一遍 `--dry-run`）。

## Skill 证据

| skill | 加载方式 | 可核查记录 |
| --- | --- | --- |
| `diagnosing-bugs` | 直接读取（宿主无原生 Skill 调用） | `/Users/apple/.pi/agent/skills/diagnosing-bugs/SKILL.md` 首行 `---`；阶段 1 的紧反馈环 = `/tmp/rjl-loop.mjs`（红/绿输出见上） |
| `tdd` | 直接读取 | `/Users/apple/.pi/agent/skills/tdd/SKILL.md` 首行 `---`；红绿节奏见上（先落测试 8 红，再实现转绿 29/29） |
| `implement` | 直接读取 | `/Users/apple/.pi/agent/skills/implement/SKILL.md` 首行 `---`；typecheck / 单文件测试 / code-review / commit 按其次序执行 |
| `code-review` | 直接读取 + 两个并行子 agent（各轴独立上下文） | `/Users/apple/.pi/agent/skills/code-review/SKILL.md` 首行 `---`；两轴结论与处置见上 |
| `pr` | 直接读取 | `/Users/apple/.pi/agent/skills/pr/SKILL.md` 首行 `---`；PR body 按 Summary / Evidence / Merge Danger 三段写 |
