# 11 — 并发写裁决这一幕：首发前修 revise，还是改叙事？

**Type:** grilling
**Blocked by:** 05
**Status:** resolved

## Question

票 05 的实测把首发主打场景（票 02 定的「并发写裁决」）撕开一道口子：

- **成立**：写被 hold 而不是覆盖（证据 A，确定性）、互审/构建者不验证（证据 C，确定性）；
- **不成立**：被 hold 之后 agent 选 `revise` 的那条路——revise prompt 在 `prompt_done` 后立刻发出，pi SDK 认为 agent 仍在处理并拒绝（`Agent is already processing. Specify streamingBehavior ('steer' or 'followUp')`），于是拿到空文本、记 `error`。4 次独立运行全部复现（详情见 [05 的 Answer](./05-evidence-run.md)）。

而票 02 定的首发主打场景正是「第二个写被 hold，**它选择 revise**，房间没有被覆盖」。所以必须在开枪前决定：

1. **首发前修**：让 revise prompt 等 agent 真正 settle，或按 SDK 报错给的原话用 `streamingBehavior:'followUp'` 入队（`lib/rpc/session.ts` 已经支持透传该字段）。修完重跑票 05 的 B 部分，验收判据 = 拿到 `[worksplice:revision]` 标记且该轮 `round_logs` 为 `replied`。
2. **改叙事**：首発只讲已经被证明的两条（写被 hold 而不是 last-write-wins、构建者不验证自己），把 revise 明确写成 roadmap（诚实、且不阻塞首发）。
3. **两条都做**：先修（它同时是一篇极好的技术文章素材——「我们的 hold 路径在真实接下线里失效了，问题出在 SDK 的 settle 语义」），若修不动就落 (2)。

**产出**：决定 + 若修，修法与验收判据（含重跑 05-B 的证据要求）；若改叙事，票 02 的定位句与对比表里涉及 revise 的措辞要一并改。

**注**：本票只做决定；修代码属于执行，不进本图（与 Release/`--demo` 同处理）。

## Answer

2026-10-03。作者直接指示「先把 revise 修掉，然后继续 11」——修复已完成并验证，本票据此收口。

### 1. 修了什么（已完成）

- `lib/agent-loop/loop.ts`：新增 `waitForSessionIdle`（按 `LoopSession.isRunning()` 轮询，默认 10s 上限；**超时照发**，让 SDK 的原始错误如实暴露而不是被静默吞掉），`promptSession` 发送前调用它。
- `lib/agent-loop/loop.test.mjs`：两条回归测试——假 session 在「仍在处理」时拒绝 prompt 并如实发 `prompt_error`（镜像 wrapper 的 `.catch`）；**修前红、修后绿**（`AssertionError: 会话空闲后应当发得出去（修前这里是 ok:false）`）。
- PR：[#67](https://github.com/whutlichao/worksplice/pull/67)（`node --test lib/agent-loop/loop.test.mjs` 40/40、`tsc --noEmit` 与 eslint 无输出）。**已合并进 main**（merge commit `5f74cad`，2026-10-03），合并后在本机 main 上复跑 40/40 仍全绿。

### 2. 修复验证（同一剧本重跑）

- session 出现 `[worksplice:revision]` 标记（1 轮）；
- 该轮 `round_logs = replied, base_seq=5`；
- 频道出现修订稿（#6「收到，引号内逗号这点我原来的方案漏了，补充如下」，仍不改代码）；
- **没有任何人的消息被覆盖**；
- 可公开素材：`evidence/part-b-revision-prompt.txt`——逐字含 `Your reply to channel … was held because the room changed while you were writing` / `What happened: 2 new message(s) arrived in this target (seq 4–5)` / `Your held draft was:`，且**不含任何本机路径**。

### 3. 决策（HITL 确认）

- **首发叙事保留 revise**（它现在真的工作），并且**把「我们发现它坏了 → 定位到 SDK 的 settle 缝 → 修好 → 补回归测试」写进证据文与连载**——一次真实的失效比一次展示更能建立可信度。
- **票 09 就绪门槛新增硬项**：PR #67 已合并（✅ 2026-10-03，`5f74cad`）**且** 在 D-day 的 Release 构建里重跑证据 B 拿到 `[worksplice:revision]`（⏳ 待做）。「合并了」不等于「发布的构建里是好的」——本次教训正是单测全绿而真实链路 100% 断。

### 4. 影响面（已同步）

- 票 02 的主打场景措辞**无需改写**（revise 保留）；
- 票 05 的证据文骨架升级：「我们哪里做错了」一节从「未修的失效」变成「怎么发现的、怎么修的」，并附修复后的成功证据；
- 票 08 的连载选题多一个高份量篇目：**「一条在单测里永远绿、在真实接线下 100% 失败的路径」**（含 SDK 原文报错与 settle 语义）。

### 5. 未验证项（诚实记录）

- 修复只在本机验证过一次（生产构建 + 免费模型 + 频道静音隔离）。免费模型的不稳定性意味着「一次成功」不等于「次次成功」；09 门槛里那次重跑建议**跑 2–3 次**提高置信度。
