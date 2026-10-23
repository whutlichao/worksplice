# 14 — agent-loop 重试收敛 + prompt 截断

**What to build:** freshness-hold 烧 token 的主成本路径收敛：`MAX_REVISE_RETRIES 2→1`、`MAX_RESEND_RETRIES 3→1`、`MAX_TASK_STATUS_RETRIES 3→2`，默认 `onConflict` 由 `revise` 改 `resend`（held 后原样重试一次、耗尽 silent）；prompt 保守压缩（`MESSAGE_CONTENT_CAP=4000/条` + 最近 20 条 + 任务 preview 120 字截断）；不引入模型路由；`MUST_RESPOND_CAP=2`、error/silent 分级、backfill 双层门禁与"标记存在即推进游标"语义全部不变。行为变化：单轮 freshness-hold 重试次数与每轮上下文尺寸显著下降，成本可预测。

**Blocked by:** 11 — cwd 互斥唯一事实来源（driver 与 round 同文件 gate）

**Status:** resolved（2026-10-23）

- [x] 三组重试常量收敛 1/1/2，默认 `revise→resend`（held 后原样重试一次、耗尽 silent），`revised reply had no content → error（不推进）` / `silent（推进）` 分级不变
- [x] prompt 截断生效：每轮上下文尺寸下降（最近 20 条 + 任务 preview 120 截断，`MESSAGE_CONTENT_CAP=4000` 保留）——核验：窗口 20 / 单条 4000 / 整轮 20k 均已在 `lib/agent-loop/injection-budget.ts`；任务 preview 实际按 `previewLine` 默认 **80** 字截断（≤120，未改动、未缩小）
- [x] `MUST_RESPOND_CAP=2` 与 cap-ack 语义、backfill 双层门禁、游标"标记即推进"不变
- [x] agent-loop 单测（fake `LoopRuntime` 注入）：重试/截断用例回归 + 新增 1/1/2 与默认 resend 用例；全量门禁 `tsc --noEmit + npm run lint + npm test`（本 worktree 基线 1551，改动后 1553）全绿
- [x] 改 loop.ts 深模块后手动验证：dev server 重启，`ps aux | grep next-server` 启动时间晚于改动（热重载陷阱）——**N/A**：本 worktree 无运行中的 dev server；本机唯一 next-server 属于 `guided-journey-ui` worktree，不服务本分支代码，未重启、未伪造

## Answer

### 实现决策

1. **重试常量收敛并保留导出**（`lib/agent-loop/loop.ts:780-781`、`:940`）：`MAX_REVISE_RETRIES = 1`、`MAX_RESEND_RETRIES = 1`、`MAX_TASK_STATUS_RETRIES = 2`。耗尽后的分级一字未动：reply 侧仍返回 `silent`（reason `revise/resend retries exhausted`，`ackSeq = held roomSeq`）；task status 侧仍返回 `silent`（reason `${status} update held after 2 retries`）。
2. **默认 `onConflict` = `resend`**：`parseAgentAction` 的两条兜底都改（`loop.ts:254-258` 合法 JSON 但 onConflict 缺失/非法；`loop.ts:281-285` 非 JSON 整段文本）。显式 `revise/resend/silent/anyway` 的解析与执行完全照旧；泄漏修复（坏序言 / 裸控制字符）合流进同一个 `if (parsed)` 块，因此默认值只有这两处、没有第三处。`deliverWithFreshness` 的 `case "resend"` 是既有分支：held 后原样重试一次，再 held 就 `silent`（发送 2 次封顶）。
3. **error/silent 分级不变**：revise 分支重写后 `reply` 无内容仍返回 `error` 且 `ackSeq = input.baseSeq`（不推进游标、被 hold 的消息保持 pending）；`revised to ignore/conclude` 与 `silent` 路径仍推进到 held 的 `roomSeq`。`MUST_RESPOND_CAP=2`、cap-ack、backfill 双层门禁、"标记存在即推进"均未触碰（diff 只覆盖 loop.ts 的常量与默认值两处语义）。
4. **prompt 压缩只核验不推翻**：`ROUND_INJECTION_BUDGET_CHARS = 20_000`（injection-budget.ts:18）、`INJECTION_MESSAGE_WINDOW = 20`（:25）、`MESSAGE_CONTENT_CAP = 4_000`（:40）均在位且本票未改。任务 preview 由 `previewLine` 默认 `maxLength = 80`（lib/preview.ts:2）生成，已 ≤120：**保持 80，不缩窗、不增预算**。
5. **测试钉字面量，不钉常量对常量**：新增 `retry budgets are pinned to the literals 1 / 1 / 2` 直接断言 `1/1/2`；默认 resend 的端到端用例从 `parseAgentAction('…缺 onConflict…')` 取 action 再跑 `deliverWithFreshness`，断言恰好 2 次 send、第二次内容原样、耗尽 `silent`；显式 revise 用例钉 `promptCalls === 1`、`calls.length === 2`；resend 用例钉 `calls.length === 2`。`loop-tasks` 里两条原本依赖默认 revise 的空内容重写用例，改为显式 `"onConflict":"revise"`（否则会改走 resend，不再覆盖 error 分支）——这是默认值变更的必要适配，不是行为扩张。

### 红→绿证据

基线：`3b86a288085022dfc03f3616c5728392a319b1ed`（本 worktree 起点，未改动实现）。红阶段只改了测试（`git diff --stat` 仅 3 个测试文件），`loop.ts` 仍在基线上：

```
$ env -u DEEPSEEK_API_KEY node --test lib/agent-loop/loop.test.mjs lib/agent-loop/loop-tasks.test.mjs
ℹ tests 122   ℹ pass 106   ℹ fail 16
✖ retry budgets are pinned to the literals 1 / 1 / 2
✖ parseAgentAction parses JSON reply and accepts the four conflict choices   (onConflict: 'revise' !== 'resend')
✖ parseAgentAction strips json code fences and falls back to the whole text  (onConflict: 'revise' !== 'resend')
✖ parseAgentAction extracts the JSON object from text polluted with model tokens or prose
✖ parseAgentAction accepts conclude and keeps a trimmed reason
✖ parseAgentAction repairs the leaked `{"` prologue into a protocol reply
✖ parseAgentAction carries task and member ops through the repaired prologue
✖ parseAgentAction falls back to the whole text when the repaired prologue is not a protocol reply
✖ parseAgentAction handles every raw control character below 0x20 inside string values
✖ parseAgentAction keeps escaped sequences and code-fenced raw-control replies intact
✖ parseAgentAction carries ignore / task / ops through the raw-control reply
✖ parseAgentAction still falls back when raw control characters are not in a protocol reply
✖ parseAgentAction falls back on unescaped inner quotes: not a control-character problem
✖ revise retries are capped, then the reply is dropped   (promptCalls: 2 !== 1; calls: 3 !== 2)
✖ resend retries are capped, then the reply is dropped   (calls: 4 !== 2)
✖ the default conflict choice resends the draft once, then goes silent
```

绿（实现 + review 处置后，最终 head）：

```
$ env -u DEEPSEEK_API_KEY node --test lib/agent-loop/loop.test.mjs lib/agent-loop/loop-tasks.test.mjs
ℹ tests 122   ℹ pass 122   ℹ fail 0

$ env -u DEEPSEEK_API_KEY node --test lib/agent-loop/*.test.mjs
ℹ tests 244   ℹ pass 244   ℹ fail 0
```

### 门禁结果

| 命令 | 结果 |
| --- | --- |
| `node --test lib/agent-loop/loop.test.mjs lib/agent-loop/loop-tasks.test.mjs`（窄档） | 122 / 122 pass，0 fail（基线 120 / 120；+2 新用例） |
| `npm test`（宽档，`DEEPSEEK_API_KEY` 从环境剔除） | **1553 tests / 1553 pass / 0 fail**（基线 `3b86a28` 实测 **1551 / 1551**；本票 +2） |
| `npm run typecheck` | exit 0，0 error |
| `npm run lint` | 0 error，1 既有 warning（`hooks/useI18n.tsx`，与基线相同） |
| `git status --porcelain` | 仅 4 个本票文件 + 票据；无 `[DEBUG-]` 残留、无整文件重排 |
| 未跑 | `next build`（铁律）；dev server 热重载（本 worktree 无 next-server，见验收第 5 条） |

环境说明：ambient `DEEPSEEK_API_KEY` 会让无关的 `lib/model-listing.test.mjs`（lite 路径应返回空模型列表）失败，基线 `3b86a28` 同样失败；剔除该变量后基线 1551 全绿，故宽档以 `env -u DEEPSEEK_API_KEY` 执行。

### Review（双轴，两份报告不合并、不重排）

#### Standards 轴（独立 reviewer，fresh context）

**硬违规：无。** 新默认 `resend` 有真实消费者（`deliverWithFreshness` 的 `case "resend"`），不会静默掉进 revise 的 default 分支；两处字面量是既有成对结构，仅改值。P3 建议：常量 pin 用例原先放在 `parseAgentAction` 分区下、且与两个 cap 用例重复断言常量——**已处置**：移到 freshness-hold 分区，cap 用例只保留行为字面量（`1` / `2` 次 send）。

**P2 文档漂移**：`AGENTS.md:487-500` 与 `docs/design-notes/orchestrating-coding-agents.md:183-188` 仍写默认 revise、2/3 次重试。`docs/adr/0005` 已是 1/1/2 + resend，仓库内出现两套权威描述。

#### Spec 轴（独立 reviewer，fresh context）

**Correct**：两条 fallback 都改到；泄漏修复路径经同一 `if (parsed)` 块，无第三处默认；`resendRetries >= 1` = 原样重试一次（2 sends）后 silent；`reviseRetries >= 1` = 重写一次；`attempt >= 2` = 3 次状态尝试（首发 + 2 重试）；revised-empty 返回 `error` 且 `ackSeq = input.baseSeq`；silent 返回 held `roomSeq`；`MUST_RESPOND_FAILURE_CAP=2` 未动。scope creep：无；两条 `loop-tasks` fixture 补 `"onConflict":"revise"` 属必要适配。

### findings 逐条处置

| finding | 轴 | 处置 |
| --- | --- | --- |
| `AGENTS.md` / design-note 仍写默认 revise、2/3 次 | 两轴 P2 | **豁免（越出 Ownership）**：票据明令只改 loop.ts + 其测试 + 本票文件；两处文档不在可编辑面。已在 PR body 的 Follow-ups 记录，建议 coordinator 另开文档票（改为 1/1/2 + resend 默认） |
| 常量 pin 用例位置错误 | Standards P3 | **已修**：移到 `deliverWithFreshness` 分区开头 |
| cap 用例重复断言常量（三处改一事实） | Standards P3 | **已修**：删除两处 `assert.equal(MAX_*_RETRIES, 1)`，只留行为字面量；常量由 pin 用例一处钉住 |
| 默认 resend 用例与既有 resend 用例重叠 | Standards P3 | **保留**：它是唯一从 `parseAgentAction` 默认值出发、端到端验证「默认 → resend 一次 → silent」的用例，正是本票核心行为；删掉会只剩「显式 resend」覆盖 |
| 两条 fixture 的 JSON 字符串重复 | Standards P3 | **豁免**：既有重复（本票只追加 `onConflict` 字段），抽共享常量属无关重构 |
| task status 耗尽路径无行为用例 | Spec 备注 | **豁免（不可达）**：状态重试在同一次同步循环内完成（`updateTaskStatus` 同步、每次带最新 `roomSeq`），单进程无法在两次尝试间插入新消息；数量由字面量 pin 用例钉住，成功重试语义由 `complete: a channel message landing mid-work holds the status update…` 覆盖 |
| preview「120 字截断」与实现 80 字不一致 | Spec (a)2 | **已记录**：实现为 80（更严），按票面「已 ≤120 保持并记录」处理；未改预算/窗口 |

### 交付

- 基准：`3b86a288085022dfc03f3616c5728392a319b1ed`
- 改动：`lib/agent-loop/loop.ts`、`lib/agent-loop/loop.test.mjs`、`lib/agent-loop/loop-tasks.test.mjs`、`lib/agent-loop/member-ops.test.mjs`、本票据
- PR：**#198**（https://github.com/whutlichao/worksplice/pull/198）
- PR body：`/Users/apple/orca/workspaces/worksplice/loop-retry-convergence-pr-body.md`（未合并 PR，交 coordinator 处置）
- 文档同步：`AGENTS.md`、`docs/engineering-standards.md`、`docs/design-notes/orchestrating-coding-agents.md` 已更新为默认 resend / revise 1 / resend 1 / task status 2；核验命令 `grep -rn "默认 revise\|revise 2 次\|resend 3 次\|MAX_REVISE_RETRIES (2)\|MAX_RESEND_RETRIES (3)" AGENTS.md docs/engineering-standards.md docs/design-notes/orchestrating-coding-agents.md` 无命中（exit 1）。
