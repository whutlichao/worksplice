# 01-reply-json-leak

Type: implement
Status: in-progress
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

结果：22 条消息（2026-10-07T02:23:33Z–02:41:32Z 之间落库）的 content 形如 `","action":"reply","content":"…","onConflict":"resend"}`，在 UI 里显示为 JSON 碎片 + 字面 `\n` 不换行（用户报告的「消息渲染有问题」）。

coordinator 已验证：这 22 条全部满足「把开头 `","` / `,"` 替换为 `{"` 后 `JSON.parse` 成功且形状合法（action=reply、content 为字符串）」，可 100% 还原。

## Solution

owner 已拍板：**修代码防未来 + 写一次性清洗脚本，备份后修复这 22 条**。

1. **A（防未来）**：在 `parseAgentAction` 的既有解析链（直接 parse → extractJsonObject）与兜底之间新增一档「序言修复」，只认 `/^"?,"/` 这两种已实证形态，parse 成功且形状合法才合流进既有 `if (parsed)` 提取逻辑。判定抽成零依赖纯函数模块 `lib/agent-loop/json-prologue.ts`。
2. **B（存量）**：新增一次性离线清洗脚本 `scripts/fix-reply-json-leak.mjs`（CLI 契约照 `scripts/migrate-i18n-content.mjs`）：扫描 `messages` 表 content 命中形态的候选 → **同一个** `json-prologue.ts` 判定 → 只有校验通过才修，失败的跳过并进报告；`--apply` 先备份再单事务内 DROP/UPDATE/CREATE 触发器。
3. **C（回归）**：`lib/agent-loop/loop.test.mjs` 先红后绿。

## Implementation Decisions

- **同源同形**：A 与 B 的「修复判定」共用 `lib/agent-loop/json-prologue.ts` 一个实现，两处不得各写一份。
- **A 的合流点**：修复结果直接赋给既有 `parsed` 变量，后续 `if (parsed)` 里 content/onConflict/task/ops 的提取与校验一处不改、不另写一套。
- **兜底不动**：纯自然语言仍整段当 content（既有 `falls back to the whole text` 用例必须继续绿）。
- **不猜测未知形态**：只处理 `","` 与 `,"`，不做「看起来像」的模糊修复。
- **不把「改消息」开成产品能力**：Store 契约保持无消息写路径；脚本在头部注释写明旁路理由后直连底层连接（`owner 授权的一次性离线修复工具`）。
- **触发器重建与 UPDATE 必须同事务**：SQLite 的 DDL 是事务性的，中途失败整体回滚、触发器不丢；重建 SQL 与 `lib/data/schema.ts` 逐字一致。
- **测试位置**：脚本测试落 `lib/agent-loop/fix-reply-json-leak.test.mjs`（沿用 `lib/domain/collab/migrate-i18n-content.test.mjs` 为 `scripts/migrate-i18n-content.mjs` 测 CLI 的仓库惯例），不新增 `scripts/**/*.test.mjs` glob——`docs/engineering-standards.md` §2.2 明确「新增测试文件被 `**` glob 自动纳入，不需要手动改 `scripts.test`」。

## Testing Decisions

- seam = `parseAgentAction`（防未来）+ 清洗脚本 CLI（子进程 + 临时数据目录，断言「存量样子 → 修后样子」）。
- 所有测试自建 `mkdtemp` 临时库，**绝不触碰 `~/.worksplice`**。
- 红绿证据：`node --test lib/agent-loop/loop.test.mjs` 先红（坏形态用例）再绿。

## Out of Scope

- 渲染层（`components/`、`lib/markdown.ts`）一个字不改——owner 已确认显示问题就是这批脏数据。
- 不改 `lib/data/schema.ts` 的触发器定义。
- 不改 `sendMessage` / `deliverWithFreshness` 的既有语义。
- live 库（`~/.worksplice`）的实际执行由 coordinator 在验收后另行进行（先拿数据副本演习）。

## Further Notes

- 门禁：G-impl（第 0–5 条全过）。
- 验收证据（红绿输出、npm test 命中、tsc/eslint 对照、双轴 review、PR 号）见 `## Answer`。

## Comments

## Answer

（进行中）