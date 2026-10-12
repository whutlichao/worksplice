# 02-raw-json-reply-leak

Type: implement
Status: in-progress
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

（进行中）
