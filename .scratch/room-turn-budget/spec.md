# 房间轮次预算（room-turn-budget）

Status: resolved

## Problem Statement

多 agent 群聊里，agent 之间可以互相 @、互相接话。当前仓只有「广播唤醒 + 每轮判定」，
没有任何**结构性**上界：两个 agent 互道「你怎么看」可以无限循环，礼貌性的 `(pass)`
也会一遍遍重跑，一个忙碌成员的会话会拖住整场对话，而 Stop / 用户新消息无法让在跑的
轮次真正让路。**提示词里写「请注意不要过度回复」不算方案**——那是自律，不是约束。

本票把这件事落成代码里的**计数器 / 序号水位线 / 状态机 / 显式取消**，并接进本仓已有的
两个共享接缝：`lib/domain/collab/messages.ts::sendMessage`（全部消息写入的唯一漏斗）与
`lib/agent-loop/loop.ts::runAgentRound`（全部 agent 轮次的唯一入口）。

## Solution

新增深模块 `lib/domain/collab/room-budget.ts`（`createRoomTurnStore` / `getRoomTurnStore`），
它持有「房间状态机」，对外只有 `beginTurn / gate / noteReply / notePass / noteBusy / pump /
markSuperseded / stopTurn / isCurrent / snapshot` 一小组操作；波次推进（谁被问、何时收口）
全在内部，调用方无法跳过预算。

```text
sendMessage（唯一漏斗）
  ├─ 提交成功
  ├─ 人类(Owner) → beginTurn(channelId, triggerSeq)      ← I5 epoch+1 / I7 lateTurns=0 / 第一波选人
  ├─ agent       → noteReply(...)                        ← I1 计数 + 水位线 + 引用边
  └─ 系统/事件   → 跳过预算（roomNotice / wake:false）

runAgentRound（唯一轮次入口）
  ├─ CP0  gate(...)  → not-elected ⇒ skipped（不推进游标）
  ├─ CP2  场次已被取代 ⇒ 只收口场次记录（不中止、不动游标；理由见「与规格的差异」D3）
  ├─ 投递时 roomContext  → sendMessage 的 I6 守卫（RoomPrivateChannelForbidden）
  └─ CP3  投递后 !isCurrent ⇒ markSuperseded（回复照常落库，标 stale）
```

## 不变量 × 机制 × 用例映射

| ID | 不变量 | 落地机制 | 验收用例 |
|---|---|---|---|
| I1 | 一条用户消息引发的 bot 发言 ≤ `MAX_REPLIES` | `TurnState.replies`（跨轮累计，只在「本波被问且未结算」的实质发言上 +1） | T1、T3 |
| I2 | 对话波次 ≤ `MAX_ROUNDS` | `TurnState.wave`（已执行波次）+ `pump` 的预算检查 | T1、T2 |
| I3 | 单成员超时视为未发言，房间继续、不阻塞 | `releaseTimeouts`（只记 `askedAt`，从不 `await` 成员）+ `noteBusy` 立刻释放槽位 | T6 |
| I4 | 同一条 @ 不二次唤起；环在第二轮被切断 | 单调水位线 `seen` 比较（I4-a）+ `isBackEdge` 回边抑制（I4-b） | T1、T2 |
| I5 | 用户新消息 / Stop 使 epoch 递增，在跑轮次在检查点退出 | `beginTurn`/`stopTurn` 推 `epoch`；CP0/CP2/CP3 + `isCurrent`/`markSuperseded` | T5、T6 |
| I6 | 房间回合不得走房间看不见的通道 | `sendMessage` 的 `roomContext` 守卫 → `RoomPrivateChannelForbidden` | T7 |
| I7 | 迟到回答的补充轮次 ≤ `MAX_LATE_TURNS`；Stop 之后归零 | `noteLateReply` + `lateTurns` + `pendingLateSeq` | T6 |
| I8 | 成员不能自助重置预算 | 预算只挂房间状态；`beginTurn` 是唯一重置点；`@all` 只影响选人 | T3、T4、T6 |

## 常量（默认值即实现，全部经 `createRoomTurnStore({ limits })` 注入改小）

```ts
export const DEFAULT_ROOM_LIMITS = {
  MAX_REPLIES: 10,                    // I1
  MAX_ROUNDS: 3,                      // I2（0 基波次，含第一波）
  MEMBER_TIMEOUT_MS: 600_000,          // I3
  MAX_LATE_TURNS: 3,                   // I7
  HISTORY_LINES: 24,                   // 场次转写保留行数（超出丢最老的）
  LINE_CHARS: 2000,                    // 单行保留字符数
  MAX_REQUEST_HOPS: 8,                 // 直连链跳数（第 8 跳被拒）
  MAX_PENDING_MESSAGES: 64,            // 待回信全局上限
  MAX_PENDING_MESSAGES_PER_SENDER: 16, // 待回信单发送者上限
} as const;
```

硬要求已满足：**不读环境变量、不读配置文件、不热更新、不把上限留给模型判断**。
测试用极小上限跑：`MAX_ROUNDS: 2 / MAX_REPLIES: 3 / MEMBER_TIMEOUT_MS: 50 / MAX_LATE_TURNS: 1`。

## 选人算法（防环核心）

第一波（wave 0）= `responders()`：

- 候选 = 触发消息里被 @ 的 agent ∪ 被 reply-to 的 agent（含未入频道的成员——@mention 穿透是既有语义）；
- 无人被点名，或写了 `@all` / `@everyone` → 候选 = 频道全体 agent 成员；
- 作者不入选（自己永不 @ 自己）。

后续波（wave ≥ 1）= `candidates()`：

```text
seen = 场次单调水位线
for msg in 触发消息之后的成员实质发言（按 order 升序）:
    if msg 不是实质发言（pass / busy-notice / timeout-notice）: continue
    seen[msg.author] = max(seen[msg.author] ?? 0, msg.order)
    for m in @mentioned(msg) 且 m != msg.author:
        citedAt[m] = max(citedAt[m] ?? 0, msg.order); citers[m] += msg.author

speakers = { m | citedAt[m] 存在
               且 (seen[m] ?? -1) < citedAt[m]        // I4-a：同一条 @ 不二次唤起
               且 不是回边（isBackEdge） }             // I4-b：环在数据层被切断
speakers 排序后 rotate_left(wave % len(speakers))         // 起点轮转，避免固定先开口
```

**水位线口径**：房间内单调。channel 消息用自己的 `seq`；跨 target（任务线程）时由调用方
传全局插入序（`MessageRow.rowid`）——thread 有自己的 `seq` 空间，直接混用会把「后插入的
线程消息」误判成「更早」。

## 回边抑制（I4-b，coordinator 已批准的偏差）

两条判据，任一命中即丢弃这条引用边：

- **a) 反向重试**：该成员上一次就是被同一个引用者叫进来的，而现在唯一引用者仍是它；
- **b) 互引对**：该成员与唯一引用者互为对方的唯一引用者——这正是 A↔B 乒乓的形状。

第三方同时 @ 它（`citers.size > 1`）一律保留。

### 与原始规格伪代码的差异（必须写明的三条）

**D1：规范自带的 `cited()` 伪代码不足以单独切断环。**
后发言者的 @ 必然比先发言者自己的发言更晚（`citedAt[A] = B 的 seq > A 自己的 seq`），
所以 I4-a 的水位线比较**只能**挡住「已经看过这条 @ 的人」，挡不住「刚被 @ 的人反手 @ 回去」。
A↔B 乒乓的形状下，第一轮之后每个人都只被对方引用一次——水位线永远成立、环永远成立。
真正的切断靠 I4-b 的回边抑制。`MAX_ROUNDS: 50 / MAX_REPLIES: 100` 下双人乒乓仍只走一波
（T2 是这条的验收：删掉 `isBackEdge` 该用例必红）。

**D2：本仓没有阻塞式 `for` 循环，所以「选人」是状态机 + 惰性推进。**
规格的参考实现是「用户消息 → while 有候选 → 逐个 await 成员 → 下一波」。本仓是事件驱动
（wake hint → driver 队列 → `runAgentRound`），所以：`beginTurn` 开场并立刻选第一波；
`noteReply / notePass / noteBusy` 收口单人；`pump` 在波次结算后推进下一波（或按预算收口）；
新一波的唤醒由 store 自己 `emitWake`（复用既有 wake 总线，**`wake.ts` 一字未改**）。
`runAgentRound` 入场只问「我是否被这一波选中」。

**D3：CP2 检查点只收口场次记录，不中止本轮、不推进游标。**
规格写「任一检查点发现 `!isCurrent` → 收口 superseded」。实测把 CP2 做成「中止 + ack」会
**静默消费任务创建事件**——`lib/agent-loop/loop-tasks.test.mjs` 的 R3b/R3c/R3d 守的正是
「让路轮必须停在创建事件之前」。所以：

- CP2 = `markSuperseded`（收口场次：`stale = true`、`endedReason = "superseded"`）+ 继续本轮；
- I5 的**退出**语义落在 CP0（已被取代的场次根本进不来）与 CP3（发言人结束后的第一检查点，
  回复照常落库、但按 `stale` 记账、不续波），与 I5 原文「在当前发言者结束后的第一个检查点退出」一致；
- 同目标并发本来就由既有 freshness-hold 负责，CP2 不承担这件事。

**D4（记录 N/A）**：规格「direct 回合不得再发起新的 bot→bot 请求」在本仓**没有对应能力**
——不存在 agent→agent 派发工具（成员只能 `sendMessage` 进房间、`@` 人、认领任务）。
判据：`grep` 全仓 agent 侧工具面（`lib/agent-loop/member-ops.ts` 的 op 集合 + pi 工具预设）
不存在「向另一个 agent 派发任务并等待回信」的原语。因此不写死代码，只把**预算原语**
（`advanceRequestHop` / `createDirectRequestBridge`：跳数 + 待回信上限，`dispatch` 不返回 Promise）
先落地并由 T8 守住；将来真出现派发工具时直接接这两个函数即可。

## pass 协议

`(pass)`、纯空白、空 `content`、协议动作 `{"action":"ignore"}`、以及 silent 让路
→ **不计 `replies`、不进 `spoke`**，只把槽位还给房间（`notePass`）。
一波 `spoke.size === 0` → 整场收口（`endedReason = "no_speakers"`）。

## 禁止项（逐条，已写进 `room-budget.ts` 文件头 + 实现注释）

1. 不得用「在提示里要求成员不要多说话」替代计数器。
2. 不得让房间等待一个忙碌成员（会卡住整场）。
3. 不得让成员在房间回合里使用房间看不见的通道。
4. 不得把 `(pass)` 计入发言预算。
5. 不得在没有「用户新消息」的情况下重置 `lateTurns`。
6. 不得让同一条 @ 在环里第二次唤起同一成员。
7. 不得把上限留给模型判断或外部配置热更新。

## 兼容性

- 房间场次不活跃时行为逐字节不变：`wake.ts` 一字未改；`runAgentRound` 只在门判定为
  「有活跃场次且未被问过」时才改变走向。
- DM 频道没有房间语义（`isRoomChannel` = false）：`beginTurn` 只推进 epoch，不设预算。
- 无 `roomContext` 的 `sendMessage` 调用（人类 UI / 事件消息 / 秘书 DM / 路由层）行为不变。

## Testing Decisions

接缝（都在公共面上，不碰实现细节）：

1. `createRoomTurnStore` 的公共操作（`beginTurn / gate / noteReply / notePass / noteBusy /
   stopTurn / pump / snapshot`）——脚本化 fake 成员 `(prompt) => string` + 可注入时钟 +
   注入式目录/@解析，不碰数据库、不接真模型、无网络、无真实 sleep。
2. `sendMessage` 的 `roomContext` 守卫（真库、真漏斗）。
3. 直连链预算纯原语。

每条用例在文件里点名它守的不变量；红证据按**机制消融**（mutation）取得——逐条删掉被守的
机制后跑同一测试文件，记录失败输出（不是「文件不存在」式红）。

## Out of Scope

- 不改 `wake.ts` 的广播口径、不改 driver 的队列语义。
- 不新增 Stop 的 UI/路由接线（本票 Target 只允许改两个接缝 + 新模块；`stopTurn` 已作为
  公共 API 暴露，接线属后续票）。
- 不实现 agent→agent 派发工具（本仓无该能力，见 D4）。
- 内容层语言：I6 的报错文案按规格**逐字**保留中文（见 Answer 的偏差记录）。

## Further Notes

- 房间状态挂 `globalThis.__workspliceRoomTurns`（与 `__workspliceWakeListeners` 同一套热重载
  纪律）。⚠️ 改本模块后必须重启 dev server，否则旧闭包永远持有旧预算实现。
- `HISTORY_LINES / LINE_CHARS` 只约束场次转写（选人裁决用），不拼进 prompt；丢最老的行只会
  让候选变少，不会放大预算。

## Answer

### 改了什么（4 个文件 + 1 个新模块 + 本记录）

| 文件 | 改动 |
|---|---|
| `lib/domain/collab/room-budget.ts`（新增，935 行） | 房间轮次预算深模块：`createRoomTurnStore` / `getRoomTurnStore`（挂 `globalThis.__workspliceRoomTurns`）、`DEFAULT_ROOM_LIMITS`、`RoomPrivateChannelForbidden`、直连链预算原语（`advanceRequestHop` / `createDirectRequestBridge`） |
| `lib/domain/collab/room-budget.test.mjs`（新增，437 行） | 8 条验收用例（T4b 为 T4 子用例，T6 内含 I3 超时子场景）；脚本化 fake 成员 + 可注入时钟 + 注入式目录/@解析；只有 T7 用真库真漏斗 |
| `lib/domain/collab/index.ts` | 从唯一导入面导出新模块 + 一段使用纪律注释 |
| `lib/domain/collab/messages.ts` | 新入参 `roomContext` / `roomNotice`；I6 守卫；新增 `recordRoomTurn`（唯一预算写入面：Owner 消息 → `beginTurn`，agent 消息 → `noteReply`，`roomNotice` / `wake:false` 跳过） |
| `lib/agent-loop/loop.ts` | `runAgentRound` 的 CP0 选人门（`not elected by room turn`，不推进游标）、CP2/CP3 的 I5 检查点、`notePass`（ignore/空回复/silent/private 让路）、`noteBusy`（busy / busy-cwd）、投递时带 `roomContext`（I6） |
| `lib/domain/collab/room-budget.test.mjs` 之外的实现点 | 无（`wake.ts` 一字未改） |

### 红绿证据（机制消融 / mutation，全部在隔离 worktree `/tmp/rtb-red` 上跑，不动工作区）

红不是「文件不存在」式红：每条红都是**删掉该用例所守的机制**之后跑同一测试文件得到的。

| # | 消融的机制 | 变红用例 | 首个断言 |
|---|---|---|---|
| M1 | `isBackEdge` 整段删除（回边抑制没了） | **T2** | `只应执行一波选人 / 2 !== 1` |
| M2 | `notePass` 记成 speech（pass 计入预算） | **T3** | `pass 不计发言预算` |
| M3 | `beginTurn` 不重置 `lateTurns` | **T6** | `1 !== 0`（新场次 lateTurns） |
| M4 | `noteReply` 的 epoch 守卫整段删除 | **T5** | `false !== true`（stale） |
| M5 | `messages.ts` 的 I6 守卫删除 | **T7** | `Missing expected exception.` |
| M6 | 直连链单发送者预算删除 | **T8** | `Missing expected exception.` |
| M7 | `responders()` 忽略点名（恒回退全员） | **T4 / T4b / T5** | `Expected values to be strictly deep-equal` |
| — | 恢复后复跑 | 全绿 | `tests=9 pass=9 fail=0` |

补充：M1 单独不足以为 T1 造红（T1 的 `endedReason` 断言是一个允许集，回边抑制去掉后
预算会以 `round_budget` 兜住）；T1 的红需要「回边抑制 + I1/I2 预算检查」同时删除——
这也正是 T1 与 T2 的分工：**T1 守「预算兜得住」，T2 守「环本身在数据层就被切断」**。

### 过程中被测试抓到的真实缺陷（记录在案）

`openWave` 最初只重置 `spoke`、没有重置 `settled`，于是**第二波及迟到补充波的当选者一进来
就被视为「已结算」**，波次刚开就被 `pump` 判成「无人发言」而收口。绿灯测试没抓到（T6 当时只
断言 `askLog` 里 A 出现两次，而记账在 pump 之前），是 mutation 演练（M1+M8 场景下快照显示
`elected=['A'] settled=[] pending=[]`）暴露的。已修（`openWave` 重置 `settled`）并补强 T6：
断言补充波里 `elected.has("A")` 且 `settled.has("A") === false` 且 `endedReason === null`。

### 门禁读数

| 门禁 | 读数 |
|---|---|
| `node --test lib/domain/collab/room-budget.test.mjs` | 9/9 绿（8 条验收 + T4b 子用例） |
| `node_modules/.bin/tsc --noEmit` | 干净（`TSC_OK`） |
| `npm run lint` | 0 error / 1 warning —— 与 `origin/main` 基线**逐字相同**（`hooks/useI18n.tsx:61` 既存 `react-hooks/exhaustive-deps`），无新增 |
| `npm test` | 1767 用例，1766 pass / **1 fail**：`lib/model-listing.test.mjs` 的 `lite path returns a working runtime without loading extensions`——**既存环境相关红**（读的是本机真实 `~/.pi/agent/models.json`）。已在 `origin/main` 的独立 worktree 上复现同一条红（3 pass / 1 fail），与本票改动无关 |
| 既有 agent-loop 用例 | 287/287 绿（含 R3b/R3c/R3d 等 claim/freshness 回归） |

### 兼容性与既有用例因果（§9）

全量里**没有**任何既有用例因新增选人门改变行为，因此无需放宽判据或改期望。过程中出现过一次
真实冲突并已按 §9 的「不符合则改实现」处置：

- CP2 检查点最初做成「中止 + ack 游标」，导致 `loop-tasks.test.mjs` 的 **R3b / R3c / R3d** 变红
  （`skipped` 而非 `yielded`）。核对后判定：这三条守的是「让路轮必须停在任务创建事件之前，
  否则创建事件被静默消费成永无 owner」——那是既有契约，我的实现越界了。故 CP2 改为
  「只收口场次记录、不中止、不动游标」（见 D3），三条用例恢复绿，I5 的退出语义落在 CP0 与 CP3。

### 双轴 review

> 加载方式：`code-review` skill 的流程要求「两个并行 sub-agent」，但本次 dispatch 明确禁止
> subagent / helper worker，故**双轴由我顺序各做一遍**（Standards 一遍、Spec 一遍，互不回看），
> 下面分别是两份结论。固定点 = `origin/main`（`git diff origin/main...HEAD`）。

#### Standards（对照 `docs/engineering-standards.md` / `docs/i18n.md` / AGENTS.md + Fowler smell 基线）

1. **【硬冲突，需协调者裁决】错误消息用中文**：`docs/engineering-standards.md` §1 写「标识符、
   API 路径、**错误消息**用英文（对外契约）」，`docs/i18n.md` 也把「进模型上下文的内容」定为
   **英文硬编码**；而本票 §6.6 明确要求 I6 报错**逐字**为中文，T8 也要求含「请问用户」。
   处置：**按票面实现**（票面是显式、逐字、且被验收断言锁定的），并在 PR body 的 Merge Danger
   里点名这条张力。要改成英文只需替换 `ROOM_PRIVATE_CHANNEL_MESSAGE` 与两处 `RoomBudgetError`
   文案（+ T7/T8 断言），属一行级改动，但那是改票面语义 → 不在本 worker 权限内。
2. **【判断项】`createRoomTurnStore` 复杂度**（cc 128）：一个闭包内聚了状态机全部转移。
   评估：这是「深模块」的代价——接口只有 10 个操作、外部无法跳过预算；拆成多文件会把内部状态
   暴露成跨模块协作。保留，并在文件头写清禁止项。`sendMessage` 的 cc 19→22 已把新逻辑抽到
   `recordRoomTurn` 里单独记账。
3. **【判断项】`roomNotice` 入参当前没有调用方**（Speculative Generality 的气味）：票面 §6.2
   要求这个开关，且现有系统消息调用点（`event-messages.ts` / `reminders.ts`）不在本票 Target
   内。保留（票面要求）+ 用 `wake:false` 覆盖现行的系统消息路径 + 在 Further Notes 记为已知限制。
4. **【已修】§-引用歧义**：我最初在注释里写 `§6.3` / `§5` / `§4`，在本仓这些编号默认指向
   `docs/spec.md`，会误导读者。已全部改成「本票 spec §x」。
5. **【已修】测试替身里的 ``new RegExp(`@${member}`)``**：改用 `text.includes`，避免把成员名
   拼进正则（semgrep 也提示过同类问题）。
6. **无**重复代码 / Feature Envy / Data Clumps：`RoomLine`、`AskRecord` 是把「几个总一起走的
   字段」收成了一个类型；无原始类型代替领域概念（`RoomTurnEndReason` 是显式 union）。
7. 命名动词开头为主（`beginTurn` / `noteReply` / `notePass` / `noteBusy` / `markSuperseded` /
   `stopTurn` / `isCurrent` / `snapshot` / `reset`），`gate` 按动词用法保留（票面用词）。

#### Spec（对照本文件 §1–§10）

| 票面要求 | 状态 |
|---|---|
| I1–I8 全部落地机制 | ✅ 见上文映射表；每条都有直接断言 |
| §2 常量 + 注入改小 + 禁环境变量/配置/热更新 | ✅ `DEFAULT_ROOM_LIMITS` + `createRoomTurnStore({ limits })`；无 `process.env` / 无文件读取 |
| §4 选人算法（第一波 responders / 后续波 cited + 水位线 + 回边抑制 + 轮转） | ✅；回边抑制两条判据（反向重试 + 互引对）见 D1 |
| §5 pass 协议（不计 replies / 不入 spoke / 空波收口） | ✅ T3 |
| §6.1–§6.9 接入点 | ✅ 逐点落地；§6.9 的「尽力 abort」记为 N/A（本仓无阻塞等待，`stopTurn` 只做状态取消 + epoch 推进） |
| §7 八条验收用例 | ✅ 全绿（含 T4b 子用例、T6 内的 I3 超时子场景） |
| §8 七条禁止项 | ✅ 文件头逐条 + 实现点注释 |
| §9 兼容性 | ✅ 既有 287 条 agent-loop 用例全绿；唯一冲突按「不符合则改实现」处置（D3） |
| §10 交付面（分支 / 提交 / PR / Answer） | ✅ 分支 `room-turn-budget`；PR 见 worker_done 回报 |

**Spec 轴缺口（诚实记录，不粉饰）**：

- ~~**runAgentRound 的选人门没有 black-box 回归**~~ → **已补**（验收打回【必改 2】）：
  新增 `lib/agent-loop/room-gate.test.mjs`，三条用例分别断言「未当选 ⇒ skipped 且游标不动」、
  「当选 ⇒ 不被该门拦」、「无场次 ⇒ 不拦（legacy）」。删掉 CP0 的 `return` 整段，该文件必红
  （见下方 follow-up 的红证据）。
- ~~**Owner 署名的事件消息会开新房次并重置 lateTurns**~~ → **已修**（验收打回【必改 1】）：
  `notifyTaskCreated` 与 `deliverEventMessage` 显式传 `roomNotice: true`（`wake: true` 保留），
  回归用例 T9 锁住「epoch / lateTurns / 当选者 / 场次 supersede 都不许动，但 wake 照常扇出」。
- **Stop 的 UI/路由接线**仍不在本票 Target 内：`stopTurn` 已作为公共 API 暴露并有用例覆盖，
  但没有 `/api/.../stop` 路由与按钮接线。
- **I6 报错文案的语言**（中文逐字 vs `docs/engineering-standards.md` §1「错误消息用英文」）
  等用户裁决；本轮按要求**未动**文案与 T7/T8 断言。

### Follow-up：验收打回后的两处必改（同一 PR、同一分支）

#### 必改 1 —— 系统/事件消息不得开房间场次、不得重置 `lateTurns`（禁止项 #5）

**事实**：`notifyTaskCreated` 用 `sendMessage({ authorId: OWNER_MEMBER_ID, wake: true })`，
在唯一漏斗里与人类消息不可区分 ⇒ `beginTurn` ⇒ epoch+1、`lateTurns` 归零、在跑场次被
supersede。这是 I8 / 禁止项 #5 的**直接违反**，不是「边缘偏差」。

**改法**（`lib/domain/collab/event-messages.ts`）：

- `notifyTaskCreated`：加 `roomNotice: true`，**保留 `wake: true`**（全 channel 扇出是既有
  语义：抢占认领失败让路，§3.7）；
- `deliverEventMessage`：同样显式加 `roomNotice: true`（它本来就因 `wake: false` 被跳过，
  但语义要显式，不依赖两个开关的巧合）。

**红 → 绿**（T9，`lib/domain/collab/room-budget.test.mjs`）：

```text
改前：✖ T9 … AssertionError: 事件消息不得推进 epoch  →  actual: 2, expected: 1
改后：✔ T9 Owner 署名的任务创建事件不开新房次、不重置 lateTurns、wake 照常扇出
```

T9 的构造（真库真漏斗 + 注入时钟/上限）：人类消息开场次 → 成员超时被释放为迟到 → 其迟到回答
`@beta` 触发补充波（此时 `lateTurns === 1`、场次重新活跃）→ 期间投递 `Task #1 created` 事件消息。
断言：`epoch` 不变、`lateTurns` 仍为 1、`turn.epoch` 不变、`turn.stale === false`、
`turn.endedReason === null`、`askLog` 长度不变（不产生新当选者），且 wake 仍扇出到两个
agent 成员（事件消息照常唤醒）。

#### 必改 1 的扫描清单（本域全部 `sendMessage` 调用点，逐个处置）

| 调用点 | 署名 | wake | 判定 | 处置 |
|---|---|---|---|---|
| `event-messages.ts` `notifyTaskCreated`（被 `tasks.ts:286` 的三条建任务途径共用） | Owner | `true` | **系统事件**（人类敲的是锚点消息，不是这条） | ✅ 加 `roomNotice: true`，`wake: true` 保留 |
| `event-messages.ts` `deliverEventMessage`（`notifyChannelCreated` / `notifySecretaryWelcome`，含 `secretary-init.ts:133`） | Owner | `false` | **系统事件** | ✅ 加 `roomNotice: true`（原本由 `wake:false` 跳过，现显式） |
| `reminders.ts` `fireReminder`（到点投递系统提醒） | 提醒作者（Owner 或 agent） | `false` | **系统事件** | ⚠️ **未改**：`reminders.ts` 不在本轮可编辑范围；已由 `wake:false` 覆盖预算语义。**建议**：后续票加 `roomNotice: true` 显式化 |
| `agent-loop/member-ops.ts` `post` op | 该 agent | 默认 `true` | **真的是成员发言**（agent 主动在房间说话） | 保持原样（应计入 I1 预算、参与 `cited()`） |
| `app/api/messages/route.ts` | `CURRENT_MEMBER_ID`(Owner) | 默认 | **真的是人类消息** | 保持原样（开场次） |
| `app/api/tasks/route.ts`（发送并建任务） | `CURRENT_MEMBER_ID`(Owner) | 默认 | **真的是人类消息**（随后的创建事件才由 `notifyTaskCreated` 负责） | 保持原样 |
| `lib/domain/collab/secretary-auto-create.ts` / `tasks.ts` | — | — | 无直接 `sendMessage` 调用（前者不发消息，后者经 `notifyTaskCreated`） | 无需处置 |
| `scripts/seed-demo.mjs` / `scripts/screencast/*` | 脚本 | — | 演示/取证脚本，不在 lib 运行面 | 不在本票范围 |

#### 必改 2 —— 选人门的 black-box 回归（`lib/agent-loop/room-gate.test.mjs`）

三条用例（真库 + fake runtime，不真起会话、不接模型）：

1. **① 未当选 ⇒ 跳过且游标不动**：人类消息只点名 alpha（第一波 = {alpha}），beta 是成员且有待
   消费消息；`runAgentRound(beta)` → `{ status: "skipped", reason: "not elected by room turn" }`，
   `consumedSeq(beta)` 未推进，且**根本没有起会话**（`runtime.sessions` 里没有 beta）。
2. **② 当选者不被该门拦**：同一场次对 alpha 跑一轮 → `status === "replied"`、消息落库、游标推进。
3. **③ 无活跃场次 ⇒ legacy 不变**：只有 agent 消息（不开场次）时，同一成员不被门拦
   （`reason !== "not elected by room turn"`，走到正常回复）。

**红证据（机制消融，隔离 worktree `/tmp/rtb-red2`）**：把 `runAgentRound` 里 CP0 的
`if (roomGate.state === "not-elected") { return ... }` 整段删掉后：

```text
✖ ① … actual: 'replied', expected: 'skipped'
ℹ tests 3 / pass 2 / fail 1      （②③ 仍绿——它们守的是「不要拦错」）
── 同时跑 lib/domain/collab/room-budget.test.mjs：10/10 仍绿
   （证明这条门只在 agent-loop 接缝上，store 侧用例管不到它——所以必须由本文件守）
恢复后：room-gate 3/3 绿
```

#### Follow-up 的门禁读数（第 2 轮）

```text
node --test lib/domain/collab/room-budget.test.mjs   →  10/10 绿（新增 T9）
node --test lib/agent-loop/room-gate.test.mjs        →  3/3 绿（新增文件）
node --test lib/data/default-datadir-guard.test.mjs  →  绿（新测试文件走 globalThis.__workspliceDb，不碰默认数据目录）
node_modules/.bin/tsc --noEmit                       →  TSC_OK
npm run lint                                         →  0 error / 1 warning（与 origin/main 逐字相同）
npm test                                             →  1771 用例：1770 pass / 1 fail
                                                        唯一红仍是既存环境红（lib/model-listing.test.mjs）
```

#### Follow-up 的双轴自审（增量）

- **Standards**：原先「`roomNotice` 没有调用方（Speculative Generality 气味）」的观察**已消解**
  ——它现在有两个真实调用点，且注释写清「为什么它不能只靠 `wake:false` 的巧合」。新测试文件遵守
  仓库纪律（node:test、tmp 库、`globalThis.__workspliceDb`、fake runtime 零 SDK 依赖、不碰默认
  数据目录）。`reminders.ts` 的同类调用点留在扫描清单里，是本轮范围的诚实边界。
- **Spec**：禁止项 #5 从「边缘偏差」升级为「已闭合」；§6.3 的选人门从「只有机制级断言」升级为
  「有 black-box 回归且可被一行删除判红」。剩余未闭合项只有 Stop 接线与 I6 文案语言（等裁决）。

### skill 执行记录

| skill | 加载方式 | 关键产物 |
|---|---|---|
| `implement` | **直接读取** `/Users/apple/.pi/agent/skills/implement/SKILL.md`（宿主未确认原生 `/implement` 入口，按 fallback 读取并遵循流程） | 按「取票 → 说明标题 → 在预先约定的接缝用 tdd → 定期 typecheck/单测 → 收尾全量 → code-review → commit」推进 |
| `tdd` | **直接读取** `.../skills/tdd/SKILL.md` | 先写测试再实现（store 接缝 9 条）；垂直切片（选人 → I5/I7 → I6 → 直连链 → 接缝接入）；红证据按机制消融取得（见上表），不写实现耦合/同义反复断言（期望值来自票面数字与手算序列） |
| `code-review` | **直接读取** `.../skills/code-review/SKILL.md` | 固定点 `origin/main`；两轴按 skill 的 brief 各做一遍（subagent 被 dispatch 规则禁止，见上方说明）；结论就是上面两节 |
| `pr` | **直接读取** `.../skills/pr/SKILL.md` | PR body 用其模板（Summary / Evidence / Merge Danger），以 `--body-file` 提交 |

### Further Notes（留给后来者）

- ⚠️ 改本模块后必须重启 dev server：房间状态挂在 `globalThis.__workspliceRoomTurns` 上，
  旧闭包会继续持有旧实现（与 `__workspliceWakeListeners` 同一套陷阱）。
- 房间场次转写（`transcript`）只用于选人裁决，**不拼进 prompt**；`HISTORY_LINES / LINE_CHARS`
  只约束它的内存占用，丢最老的行只会让候选变少。
- 生产上限是 `MAX_REPLIES=10 / MAX_ROUNDS=3`：一个用户消息最多引发 3 波、10 条 bot 发言；
  迟到回答另有 3 次补充波预算。
- **新增「Owner 署名 + 系统事件」的 `sendMessage` 调用点时，必须带 `roomNotice: true`**：
  否则它会开启新房次、重置 `lateTurns`、把在跑的场次 supersede（禁止项 #5）。判据只有一句：
  这条消息是**人类真的敲出来的**吗？不是 → `roomNotice: true`（`wake` 照各自语义，别顺手改）。
  当前全部调用点的处置见 Answer 的「必改 1 扫描清单」；`reminders.ts` 仍靠 `wake:false` 覆盖，
  待后续票显式化。
- **改选人门（`runAgentRound` 的 CP0）必须跑 `lib/agent-loop/room-gate.test.mjs`**：它是把
  「门真的接在轮次入口上」变成机械判定的唯一防线（store 侧用例删掉 CP0 也全绿）。

## Answer（文档落地：把房间轮次预算写进 AGENTS.md）

Status 保持不变（`resolved`，见文件头）。本小节只追加，不改既有内容。

### 交付了什么

| 文件 | 改动 |
|---|---|
| `AGENTS.md` | 三处、纯新增：① File Map 的 `lib/domain/collab/` 段加 `room-budget.ts` 条目（置于 `reminders.ts` 与 `search.ts` 之间，续行对齐 34 列）；② `### Collaboration message domain (…)` 段尾加一条 bullet（`sendMessage` 是唯一写入面、`recordRoomTurn`、`roomContext` / `roomNotice` 两个入参的语义）；③ 在 `### agent-loop（ticket 06…）` 与 `### 任务板（ticket 07…）` 之间新增 `### 房间轮次预算（room turn budget，PR #218）` 整段（默认上限 / 三个构造口 / I1–I8 机制 / 两条接缝 / 七条纪律 / 已知边界 / 指针） |
| `.scratch/room-turn-budget/spec.md` | 本小节（只在文件尾追加） |

零代码改动：本票没碰任何 `.ts` / `.tsx` / `.mjs`，改动全在两个 Markdown 文件里。分支 `room-turn-budget-docs`；PR 号、PR body 路径与 CI 读数在 GitHub 与本轮仓库外台账，不在仓库内追加事实提交。

### 必读：一处提纲与代码的偏差（已 ask 协调者确认）

本文件上方（「双轴 review · Standards 第 1 条」）写「要改需替换 `ROOM_PRIVATE_CHANNEL_MESSAGE` 与**两处** `RoomBudgetError` 文案」。代码里 `RoomBudgetError` 的抛出点实为三处：`room-budget.ts:868`（`hop_limit_exceeded`）、`:888`（`pending_limit_per_sender`）、`:894`（`pending_limit_global`），三处文案都含「请问用户」，`room-budget.test.mjs` 的 T8 也分别断言 code 与 `/请问用户/`。

协调者裁决（补充答复带完整标识符）：以代码为准、**判据用 code、不按位置数**（计数会漂）；并把事实补全为「本模块的中文错误文案共四处（`ROOM_PRIVATE_CHANNEL_MESSAGE` + 三条 `RoomBudgetError`），全部是票面逐字要求，与 `docs/engineering-standards.md` §1 / `docs/i18n.md` 的英文契约故意冲突，用户裁决为票面优先」；陷阱还要写清「为什么必须写全」——后来者英文化时只改 I6 那一条，会留下三处不一致。AGENTS.md 陷阱 #7 按这个口径落笔；本文件既有措辞不回改。

### 逐条对照表（新段每条断言 → 代码出处）

行号对 `main` 的 `5f7302a`（PR #218 合入后）。

#### A · 结构与接口

| 断言 | 代码出处 |
|---|---|
| 模块位置 `lib/domain/collab/room-budget.ts`，经协作域唯一导入面导出 | `lib/domain/collab/index.ts:34` `export * from "./room-budget.ts"` |
| 对外接口 = `beginTurn / gate / noteReply / notePass / noteBusy / pump / markSuperseded / stopTurn / isCurrent / snapshot / reset` | `RoomTurnStore` 接口 `room-budget.ts:193`–`235`（`beginTurn` :196、`gate` :205、`noteReply` :212、`notePass` :221、`noteBusy` :223、`pump` :225、`markSuperseded` :227、`stopTurn` :229、`isCurrent` :230、`snapshot` :231、`reset` :233） |
| `DEFAULT_ROOM_LIMITS` 四个数值：发言上限 / 波次上限 / 成员超时 / 迟到补充轮次上限 | `room-budget.ts:42`；`MAX_REPLIES: 10` :44、`MAX_ROUNDS: 3` :46、`MEMBER_TIMEOUT_MS: 600_000` :48、`MAX_LATE_TURNS: 3` :50（同处还有 `HISTORY_LINES` :52、`LINE_CHARS` :54、`MAX_REQUEST_HOPS` / `MAX_PENDING_MESSAGES` / `MAX_PENDING_MESSAGES_PER_SENDER` :56–60） |
| `createRoomTurnStore` 造实例（`limits` / `now` / `directory` / `notify` 全可注入） | `room-budget.ts:302`；上限合并 `:303`、时钟 `:304`、`notify` `:305`、`directory` `:307` |
| `getRoomTurnStore()` 是生产单例，挂 `globalThis.__workspliceRoomTurns` | `declare global` `room-budget.ts:918`；getter `:925`–`929` |
| `setRoomTurnStore(null)` 是测试接缝（下次访问重建） | `room-budget.ts:933`–`934`（`store ?? undefined`）；测试用法 `room-gate.test.mjs` 每个用例 `setRoomTurnStore(store)` / `finally` 里 `setRoomTurnStore(null)` |
| `RoomPrivateChannelForbidden` + `ROOM_PRIVATE_CHANNEL_MESSAGE` | `:816` / `:813`（文案逐字见 :814） |
| 直连链两个原语 | `advanceRequestHop` `:864`（跳数单调 +1、第 `MAX_REQUEST_HOPS` 跳被拒）、`createDirectRequestBridge` `:876`（单发送者 / 全局待回信上限、`dispatch` 返回同步 ticket 而非 Promise） |

#### B · 不变量 → 机制

| 断言 | 代码出处 |
|---|---|
| I1 场次计数 `replies` 只在「本波当选且未结算」的实质发言上 +1 | `RoomTurnView.replies` `room-budget.ts:118`；`noteReply` `:519`（结算判据 `turn.elected.has && !turn.settled.has`）、`pump` 的 `reply_budget` 收口 `:488` |
| I2 `wave` 记已执行波次，`pump` 先查预算再开下一波 | `RoomTurnView.wave` `:120`；`openWave` 自增 `:442`；`pump` 的 `round_budget` 收口 `:488` |
| I3 `releaseTimeouts` 只比时间戳、从不 `await` 成员；`noteBusy` 立刻释放槽位 | `releaseTimeouts` `:366`（`now - askedAt < limits.MEMBER_TIMEOUT_MS`）；`noteBusy` `:622`（记 `busy-notice` 后立即 `pump`） |
| I4 水位线比较 + 回边抑制 | `candidates` `:389`（`(turn.seen.get(member) ?? -1) >= atSeq` 跳过）；`isBackEdge` `:429`（反向重试 / 互引对两条判据） |
| I5 `beginTurn` / `stopTurn` 推 `epoch`，`isCurrent` 是检查点判据 | `beginTurn` `:647`（`room.epoch += 1`、在跑场次 `retire(…, "superseded", true)`）、`stopTurn` `:770`、`isCurrent` `:784` |
| I6 `sendMessage` 校验 `roomContext.channelId`，不等抛 | `lib/domain/collab/messages.ts:133`–`134` |
| I7 `noteLateReply` + `lateTurns` + `pendingLateSeq`，Stop 后置哨兵 | `noteLateReply` `:574`（`room.lateTurns >= limits.MAX_LATE_TURNS` → `late_budget`）；`stopTurn` 里 `room.lateTurns = limits.MAX_LATE_TURNS` `:770` 段 |
| I8 `beginTurn` 是唯一重置点；`@all` 只影响第一波选人 | `beginTurn` 里 `room.lateTurns = 0` `:647` 段；`ALL_MENTION` `:270`；`responders` `:708` |

#### C · 两条接缝

| 断言 | 代码出处 |
|---|---|
| `sendMessage` 提交成功后调 `recordRoomTurn`，排在 wake hint 之前 | `messages.ts:176`（调用）、`:187`（其后 `notifyMessageWakes`）；注释点明顺序承重 :173–175 |
| `recordRoomTurn` 是唯一写入面：Owner → `beginTurn`、agent → `noteReply`、系统消息跳过 | `messages.ts:206`（定义）、`:215`（`roomNotice` 为真或 `systemMessage` 为真时早退）、`:217`–`233`（agent 分支 `noteReply`、Owner 分支 `beginTurn`） |
| agent 消息跨 target 用 `message.rowid` 当水位线 | `messages.ts:226` 段（`order: input.message.rowid ?? input.message.seq`） |
| CP0：未当选返回 `skipped` 且不推进消费游标 | `lib/agent-loop/loop.ts:1961`（`gate`）、`:1967`–`1969`（`not-elected` → `{ status: "skipped", reason: "not elected by room turn" }`，早于任何 ack）；black-box 回归 `room-gate.test.mjs` 用例 ①（游标前后相等、`runtime.sessions.has` 为 false） |
| CP0 对 reminder / 续工轮次 bypass | `room-budget.ts` 的 `gate` `:737` 段（`reason === "reminder"` 或 `continuing` → `bypass`） |
| CP2 出 prompt 前复查、CP3 回复落库后复查 | `loop.ts:2103`–`2111`（CP2）、`:2304`–`2307`（CP3） |
| 投递带 `roomContext` | `loop.ts:2248`–`2249`；`deliverWithFreshness` 透传 `:1069` / `:1082` |
| `wake.ts` 一字未改 | `git show --stat 5f7302a` 的文件清单里没有 `lib/domain/collab/wake.ts`；`grep -n "room\|Room" lib/domain/collab/wake.ts` 无命中 |
| 房间场次不活跃 / DM 频道行为同旧 | `room-budget.ts` 的 `beginTurn` `:647` 段里 `isRoomChannel` 为假时只推 epoch 不设预算；`gate` 无场次时返回 `no-turn` `:737` |

#### D · 陷阱段

| 断言 | 代码出处 |
|---|---|
| 「Owner 署名 + 系统事件」必须 `roomNotice: true` | `messages.ts:215`（判据只看开关与作者类型）；`event-messages.ts:51`（`deliverEventMessage`）、`:130`（`notifyTaskCreated`）已显式声明 |
| `reminders.ts` 仍靠 `wake: false` 覆盖、未显式化（遗留） | `reminders.ts:283`–`288`（`sendMessage({ … wake: false })`，无 `roomNotice`）；`messages.ts:215` 的 `systemMessage` 分支即 `input.wake === false`（`:182`） |
| CP2 只收口不中止不 ack；改成「中止 + ack」会消费任务创建事件 | `loop.ts:2103`–`2111`（注释写明理由 + 只调 `markSuperseded`）；既有契约 `lib/agent-loop/loop-tasks.test.mjs:2137`（R3b）、`:2188`（R3c）、`:2261`（R3d） |
| 改 CP0 必须跑 `lib/agent-loop/room-gate.test.mjs` | 该文件三条用例（① 未当选 ⇒ skipped 且游标不动、② 当选不被拦、③ 无场次 legacy）；store 侧 `room-budget.test.mjs` 不经过 `runAgentRound` |
| 回边抑制是切环的实际机制；删 `isBackEdge` 则 T2 必红 | `isBackEdge` `room-budget.ts:429`；T2 `room-budget.test.mjs:151`（放大到 `MAX_ROUNDS: 50 / MAX_REPLIES: 100`，断言 `wave === 1` 见 `:168`）；T1 `:115` 的 `endedReason` 是允许集（可被预算兜住） |
| 上限只走注入的 `RoomLimits`，禁 env / 配置 / 热更新 | `room-budget.ts:303`（`{ ...DEFAULT_ROOM_LIMITS, ...options.limits }`）；`grep -c "process.env" lib/domain/collab/room-budget.ts` = 0 |
| 热重载：房间状态挂 `globalThis.__workspliceRoomTurns` | `room-budget.ts:918` / `:925`–`929`（注释 `:920`–`923` 明写与 `__workspliceWakeListeners` 同一套纪律） |
| 中文错误文案共四处：`ROOM_PRIVATE_CHANNEL_MESSAGE` + 三条 `RoomBudgetError`（直连链跳数 / 单发送者待回信 / 全局待回信） | `:813`；`:868`（`hop_limit_exceeded`）、`:888`（`pending_limit_per_sender`）、`:894`（`pending_limit_global`）；断言 T7 `room-budget.test.mjs:372`–`373`（整串等值 + 等于常量）、T8 `:416` / `:439` / `:458`（逐处断言 code 与 `/请问用户/`） |
| 提纲写「两处 `RoomBudgetError`」→ 代码实为三处（且本模块共四处中文错误文案）→ 落笔按 code 点名、不写计数 | 偏差已 ask 裁决（`msg_41575881390c` → 答复 `msg_16ac159e84bc`）；代码事实 `room-budget.ts:813` / `:868` / `:888` / `:894`，判据用 code（计数会漂） |

#### E · 已知边界

| 断言 | 代码出处 |
|---|---|
| `stopTurn()` 只有服务层 API，无路由无按钮 | `grep -rn "stopTurn"` 全仓只有 `room-budget.ts:229` / `:770`、`room-budget.test.mjs:310`、以及该文件头注释 `:18` / `:299`；`app/api/**` 无调用点 |
| `HISTORY_LINES` / `LINE_CHARS` 只约束转写内存，转写不拼进 prompt | `:52` / `:54`；`pushLine` `:353`（`slice(0, limits.LINE_CHARS)` + `while (> limits.HISTORY_LINES) shift()`）；`grep -n "transcript" lib/agent-loop/loop.ts` 无命中 |
| I3 只做惰性释放，不阻塞等待、无 `abort` | `releaseTimeouts` `:366` 只在 `pump` `:488`（及经 `pump` 的 `gate` / `noteReply` 等）里跑；模块无 `AbortController` / 无 `await` 成员处 |

#### F · 指针

| 断言 | 出处 |
|---|---|
| 设计记录、常量理由、7 条禁止项、偏差 D1–D4、双轴 review 与红绿证据在本文件 | `room-budget.ts:1`–`36`（文件头不变量 + 7 条禁止项）指向 `.scratch/room-turn-budget/spec.md`；本文件「禁止项」「与原始规格伪代码的差异」「红绿证据」「双轴 review」各节 |

### 标识符自查（机械核对，非人工声称）

做法：从 `git diff -U0 AGENTS.md` 里抽出全部反引号 token（65 个符合标识符形态的），逐个 `grep -rIl` 到 `lib/ app/ components/ hooks/ docs/ .scratch/room-turn-budget/`。

```text
checked: 65
MISSING: ['RoomTurnView.replies', 'RoomTurnView.wave']
```

两条「未命中」是**成员访问表达式**（字面串当然查不到），其两半都在代码里：`RoomTurnView` 接口 `room-budget.ts:111`、成员 `replies` `:118` / `wave` `:120`。其余 63 个 token 全部有命中文件。

关键符号的逐条命中行（`grep -n` 实测）：

```text
42:export const DEFAULT_ROOM_LIMITS = {
193:export interface RoomTurnStore {
302:export function createRoomTurnStore(options: RoomTurnStoreOptions = {}): RoomTurnStore {
366:  function releaseTimeouts(turn: InternalTurn): void {
429:  function isBackEdge(
488:  function pump(room: RoomState, turn: InternalTurn): void {
519:  function noteReply(input: {
574:  function noteLateReply(room: RoomState, turn: InternalTurn, line: RoomLine): RoomReplyNote {
600:  function notePass(input: { channelId: string; memberId: string; epoch?: number }): void {
622:  function noteBusy(input: { channelId: string; memberId: string; epoch?: number }): void {
647:  function beginTurn(input: {
737:    gate(input) {
762:    markSuperseded(channelId, epoch) {
770:    stopTurn(channelId) {
784:    isCurrent(channelId, epoch) {
813:export const ROOM_PRIVATE_CHANNEL_MESSAGE =
816:export class RoomPrivateChannelForbidden extends Error {
838:export class RoomBudgetError extends Error {
864:export function advanceRequestHop(input: { hops: number; limits?: Partial<RoomLimits> }): number {
876:export function createDirectRequestBridge(
918:  var __workspliceRoomTurns: RoomTurnStore | undefined;
925:export function getRoomTurnStore(): RoomTurnStore {
933:export function setRoomTurnStore(store: RoomTurnStore | null): void {
```

```text
lib/domain/collab/messages.ts:133:  if (input.roomContext && input.roomContext.channelId !== target.channel.id) {
lib/domain/collab/messages.ts:176:      recordRoomTurn({
lib/domain/collab/messages.ts:206:function recordRoomTurn(input: {
lib/domain/collab/messages.ts:215:  if (input.roomNotice || input.systemMessage) return;
lib/agent-loop/loop.ts:1967:  if (roomGate.state === "not-elected") {
lib/agent-loop/loop.ts:1968:    return { status: "skipped", reason: "not elected by room turn" };
lib/agent-loop/loop.ts:2111:      roomTurns.markSuperseded(channel.id, roomEpoch);
lib/agent-loop/loop.ts:2248:      roomContext:
lib/agent-loop/loop.ts:2307:      roomTurns.markSuperseded(channel.id, roomEpoch);
lib/domain/collab/event-messages.ts:51:      roomNotice: true,
lib/domain/collab/event-messages.ts:130:      roomNotice: true,
```

### 门禁读数（G-impl 文档子型：逐条出处核对 + diff 范围自检）

本票**不跑** `npm test` / `tsc --noEmit` / `npm run lint` / `next build`：改的是 Markdown，不进入任何源码门禁的输入集（`AGENTS.md` 不被任何测试读取），硬跑只会产出与本改动无关的既存红噪声。实际执行的门禁：

| 检查 | 读数 |
|---|---|
| diff 范围自检（`git diff --name-only origin/main..HEAD`） | 只有两个路径：`AGENTS.md`、`.scratch/room-turn-budget/spec.md`（`--stat` 的行数含本小节自身，故不在此写死数字） |
| 逐条出处核对（第 2 节 A–F） | 见上方对照表，每条都指向符号或 `file:line` |
| 标识符存在性（65 个反引号 token 全量 grep） | 63 命中；2 条为成员访问表达式，其组成符号均存在（见「标识符自查」） |
| emoji / 本机路径 / 密钥 / 真实 session id 扫描（只扫新增行） | emoji 命中 0；`/Users/...` 命中 0；UUID 形态串命中 0 |
| 既有章节完整性 | 三处改动都是纯插入（`git diff` 无 `-` 行），未重排、未改邻居段落；`&amp;` 等既有 HTML 实体原样保留，新段用纯 Markdown |

### review 豁免（逐字）

> review 豁免（理由同时写进 Answer）：§3 三条件全满足——①单张票；②方案已定（要写什么在本 spec 第 3 节逐条给出）；③影响面可圈定（一个 Markdown 文件，零代码、零接口）。故不要求双轴 `code-review`；替代证据 = 逐条「断言 → 代码出处」对照表。

### skill 执行证据

| skill | 加载方式 | 关键产物 / 可核查记录 |
|---|---|---|
| `implement` | **直接读取** `/Users/apple/.pi/agent/skills/implement/SKILL.md`（宿主未确认原生 `/implement` 入口；按 fallback 读取全文并遵循流程，原因记录在此） | 流程落点：先取票并复述标题（「房间轮次预算（room-turn-budget）」）；本票为**文档子型**，`tdd` 的接缝在「断言 → 代码出处」表上——先读代码取证再落笔（不接受提纲措辞当事实）；`code-review` 按上方豁免不执行；收尾提交 + 推送 + PR |
| `pr` | **直接读取** `/Users/apple/.pi/agent/skills/pr/SKILL.md` | PR body 用其模板（Summary / Evidence / Merge Danger），以 `--body-file` 提交；Merge Danger 写「纯文档，零代码，回滚 = revert 一个 PR」 |

过程中的一次 ask（禁 AskUserQuestion，走 `orchestration ask`）：提纲「两处 `RoomBudgetError`」与代码三处冲突 → 问回协调者，裁决见「必读」小节。
