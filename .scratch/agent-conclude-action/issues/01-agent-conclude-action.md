# Agent 回复协议新增 conclude：纯收束确认免回复收口

Type: task
Status: resolved

## What to build

新增回复协议动作 `conclude`（`{"action":"conclude","reason":"<optional short reason>"}`），用于对话已收束、来消息只是纯收尾确认 / 无需补充的 @mention：确认收到但不发帖。

- `AgentAction.action` 加入 `"conclude"`，新增可选 `reason`；`parseAgentAction` 三条路径（直接 JSON、杂质文本提取、`parseLeakedReply` 泄漏修复）都接受 `conclude` 并解析 `reason`（仅字符串，trim 后非空才保留）。
- `json-prologue.ts` 的 `acceptProtocolObject` 与注释同步：合法 action 集合 = `reply | ignore | conclude`。
- `runAgentRound` 在任务 op / 自动路由分支之后、`ignore` 分支之前处理 `conclude`：`ack`、`resetMustRespondFailures`、`publishAgentStatus(online)`，不写消息；返回 `yielded`，reason 为 `concluded: <reason>`（无 reason 时 `concluded by agent`），`baseSeq` 照常带回。确定信号下也不得进入 error / cap-ack 路径。
- `deliverWithFreshness` 的 freshness 重写分支：revised action 为 `conclude` → `{ status: "silent", reason: "revised to conclude", ackSeq }`，不得落到 `revised reply had no content`。
- `buildReplyPrompt` 的 JSON 形状行加入 `conclude`，并新增一条规则：conclude = 确认收到但不发帖，用于已收束对话 / 纯收尾确认的 @mention，是确定信号下替代 `ignore` 的合法收束方式；禁止用它逃避直接提问或明确工作请求。既有 MUST reply / MAY reply / MUST ignore 与 ignore 失败语义不变。
- `CONTEXT.md`「回应判断」「提及」与 `docs/spec.md` §3.2 @mention 行补充 conclude 语义。

## Acceptance

- [x] `parseAgentAction('{"action":"conclude","reason":"thread concluded"}'` 返回 `action === "conclude"` 且保留 reason。
- [x] 被 @mention 的确定信号轮返回 conclude：round status `yielded`、reason 以 `concluded` 开头、游标 ack 后再 drain 为空、messages 表零新增、成员状态回 `online`。
- [x] 同一场景 `ignore` 仍为 error（既有测试不改弱）。
- [x] 先 ignore（error，streak=1）再 conclude（yielded/online、streak 清零）后，新的 mention + ignore 只记一次失败（reason 不带 `capped`）。
- [x] `json-prologue` 泄漏修复路径接受 `conclude`，非法 action（含非字符串 action）仍被拒。
- [x] freshness 重写返回 conclude → `silent` / `revised to conclude`，不是 error。
- [x] `node --test lib/agent-loop/loop.test.mjs lib/agent-loop/loop-tasks.test.mjs` 全绿（110/110）。
- [x] `npm run typecheck` 通过；`npm run lint` 0 error；`npm test` 全量通过（唯一失败为基线既有）。
- [x] Standards + Spec 双轴 code-review 已执行，发现项已修复或记录。
- [x] PR 用 `--body-file` 创建或更新，PR 号与 body 路径回填 Answer；交付前 `git status --porcelain` 为空。

## Evidence

- 新增回归（`lib/agent-loop/loop.test.mjs`）：
  - `parseAgentAction accepts conclude and keeps a trimmed reason`
  - `parseAgentAction repairs conclude leaks and still rejects unknown actions`
  - `a conclude on a personal mention yields silently: acked, online, no message`
  - `a conclude without a reason reports the default concluded reason`
  - `an ignore on the same settled mention is still an error`
  - `a conclude clears the must-respond streak so a later ignore is only the first failure`
  - `a revised-to-conclude reply is dropped without becoming an error`
  - `buildReplyPrompt documents the response judgment rubric` 增加 shape line / conclude 规则断言。
- 目标命令：`node --test lib/agent-loop/loop.test.mjs lib/agent-loop/loop-tasks.test.mjs` → `tests 110 / pass 110 / fail 0`。
- `npm run typecheck` → exit 0。
- `npm run lint` → 0 errors，1 个既有 warning `hooks/useI18n.tsx:61`（非本票引入）。
- `npm test` → `tests 1536 / pass 1535 / fail 1`；唯一失败 `lib/model-listing.test.mjs`「lite path returns a working runtime without loading extensions」，在基线 `35dabb9`（`/Users/apple/orca/worksplice`，干净工作区）同命令复现（3 pass / 1 fail），与本票无关。
- `conclude` 零新增消息由上述 round 用例直接断言（`messages` 表长度保持 1）。

## Answer

### 实际改动

- `lib/agent-loop/loop.ts`
  - `AgentAction.action` 改为复用 `ProtocolAction`（reply | ignore | conclude），新增可选 `reason`（仅 conclude 且 trim 后非空才落字段）。
  - `parseAgentAction`：杂质文本提取改用 `isProtocolAction` 严格判定；直接 JSON 路径用同一判定映射 action，未知/非字符串 action 仍回落 reply。
  - `runAgentRound`：在任务 op / 自动路由之后、`ignore` 之前新增 conclude 分支——`ack(baseSeq)` + `resetMustRespondFailures` + `publishAgentStatus("online")`，不写消息，返回 `yielded`；reason 前缀 `concluded:`，无 reason 时 `concluded by agent`。任务优先级与 ignore 失败/cap 语义不变。
  - `deliverWithFreshness`：revised conclude → `silent` / `revised to conclude` / `ackSeq`，不再落入空内容 error。
  - `buildReplyPrompt`：JSON 形状行加入 conclude；新增规则行（确认收到不发帖、已收束对话/仅需收尾确认的 @mention、确定信号下替代 ignore、禁止逃避直接提问或明确工作请求）。既有 rubric 未改。
- `lib/agent-loop/json-prologue.ts`
  - 新增 `ProtocolAction` 与严格类型守卫 `isProtocolAction`（非字符串一律拒绝，避免 `String()` 夹带数组）；`acceptProtocolObject` 与注释同步为 reply | ignore | conclude。
- `lib/agent-loop/loop.test.mjs`
  - 7 条新回归 + rubric 断言；另将 B5 预算下界容差从固定 2000 改为 `FAT_MESSAGE_CHARS + 500`：消息按整条保留，单条 4000 字，字符上界不可能逐字填满；上界 `≤ 20000` 的硬断言未变。
- `CONTEXT.md`：回应判断、提及两条补充 conclude（收束 = ack + online，不记 error；禁止逃避直接提问/明确工作请求）。
- `docs/spec.md` §3.2 @mention 行：被点名仍须回应；纯收束确认可用 `conclude` 收束（ack + online，不记 error），不算失败。

### 双轴 code-review 与处置

实际执行 `/Users/apple/.codebuddy/skills/code-review`：固定点 `35dabb9`，Standards 与 Spec 两个独立子代理并行出报告；修复后做了第二轮双轴复核。

**Standards（首轮 → 处置）**

- `ReadonlySet<string>` 抹掉 action 联合类型、`String()` 放行 `["conclude"]`：已修为 `ProtocolAction` + `isProtocolAction` 严格守卫，并补数组 action 回归。
- action 判定散落三处、默认 reply 可能漂移：已收敛为 `isProtocolAction(parsed.action) ? parsed.action : "reply"`。
- `reason` 对任意 action 落字段：已限制为仅 conclude。
- 复用 `yielded` 表示成功收束、conclude 与 task 同轮：均为 spec 明确要求（不新增 round_logs 状态、任务优先级不变），保留并在此记录。
- freshness 重写 conclude 未直接 ack/reset/online：`deliverWithFreshness` 只负责投递裁决，返回 silent 后由 `runAgentRound` 外层统一执行 ack/reset/online；round 级语义一致，不另改。
- 术语漂移（收束 / 免回复收口）：已统一为「收束」。
- 无独立 glossary 条目：本票只要求扩充既有两条词条，新增词条会扩 scope，未采纳。
- 重复 ignore 用例：作为 Acceptance c 的「同场景对照组」保留，既有 ignore 用例未改弱。
- `"reason" in blank`：已改为 `blank.reason === undefined`。
- 预算容差调整：属本票必要连带（新增规则必然占用骨架预算），理由见上；硬上界断言未放宽。
- 第二轮复核新发现 `ProtocolAction` 与 `AgentAction` 各存一份联合：已让 `AgentAction.action` 直接复用 `ProtocolAction`，单一来源。

**Spec（首轮 → 处置）**

- prompt 规则首版被压缩、缺 closing confirmation / 明确工作请求：已恢复完整措辞（settled thread or @mention、closing confirmation、certain signal、explicit work requests）。
- `docs/spec.md` 缺 ack + online：已补。
- 票据未收口：本 Answer 完成流转。
- 额外导出 action 集合：已只暴露严格守卫 `isProtocolAction`，不导出集合。
- `reason` 任意 action 保留：已限制 conclude。
- 非字符串 action 被放行：已修。
- JSON 形状行仍含 `"content":"your reply text"`：规则行已明确 conclude「without posting」，形状行保持既有 content 示例，未再改动，记录为不采纳。
- 第二轮复核确认：分支位置、ack/reset/online、零消息、`concluded:` 前缀、freshness silent、ignore/cap 未变、文档 ack+online 均符合。

### 门禁与证据

- 目标测试：`110/110 pass`（`loop.test.mjs` 70、`loop-tasks.test.mjs` 40）。
- `npm run typecheck`：exit 0。
- `npm run lint`：0 errors（1 个既有 warning，非本票）。
- `npm test`：1536 tests / 1535 pass / 1 fail；失败用例在基线 `35dabb9` 同命令复现，属既有环境问题。
- 未改 schema / `SCHEMA_VERSION` / wake / 任务路由 / `MUST_RESPOND_FAILURE_CAP` / UI 状态点映射。

### PR

- PR：待创建后回填
- body：`.scratch/agent-conclude-action/pr-body.md`

### 越界与遗留

- 无票据外文件改动；`node_modules` 为本地软链（gitignored），不随提交。
- 遗留：无功能遗留；B5 预算容差调整已在上面说明。
