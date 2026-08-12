# Spec: agent 隔离与频道对话可靠性

来源：wayfinder 地图 `.scratch/agent-isolation/map.md`（9 个决策 ticket 全部 resolved）塌缩。
本 effort 形态为**边诊断边修**（map Notes 明文）：每个 ticket 决策后即携带修复代码 + 单测落地，
因此本 spec 是对已落地变更集的完整记录与验收基线，供 review 与提交使用，而非新的构建指令。

## Problem Statement

频道内 agent 对话存在三种失效症状，用户无法区分「agent 看过消息但决定不理」与「agent 根本没处理」：

1. **有时不回复**——状态点回 online 但无回复，游标推进、消息被静默消费；
2. **继承其他 agent 的会话/上下文**——答非所问、记得别人的历史；
3. **唤醒面过宽**——一条消息多 agent 刷屏、任务线程混入无关 agent。

## Solution

从用户视角：agent 回复行为可靠且可解释——该回的回、不该回的不回、放弃时能看到「别等了」；
每个 agent 只在自己的会话上下文里工作，绝不继承他人历史；频道消息只唤醒相关 agent。

## User Stories

1. 作为频道用户，我发送消息后 agent 正常回复，因为回复失败不再被静默吞掉（空文本/无 content 按失败处理，不推进游标）。
2. 作为频道用户，agent 暂时没回复时，我能在消息流上看到「未回复（已放弃）」badge，不再无限等待。
3. 作为频道用户，agent 出错时状态点显示 error，且不会被 idle 推导覆盖，我知道它没处理完。
4. 作为频道用户，agent 的回复即使因房间变化被 hold，也会按 agent 声明的策略 revise/resend，而不是丢失。
5. 作为频道用户，多个 agent 共享同一项目目录时，同一 cwd 的会话串行启动（BusyCwdError 等待重试），不会双启动竞态。
6. 作为频道用户，新消息只唤醒订阅了频道的 agent 成员，@mention 可穿透唤醒未加入者，任务线程不再混入无关 agent。
7. 作为频道用户，被点名/任务 owner 收到他人消息时 agent 必须回应，连续 ignore 会被 cap-ack 兜底并可见 error。
8. 作为频道用户，agent 自判 ignore 是正常协议选择，在可观测页轮次记录中可见，但不上状态点、不刷屏。
9. 作为 Owner，我能在 agent 详情面板看到每轮的 status/reason/target/#baseSeq/时间（轮次记录），区分「自判 ignore」与「处理失败」。
10. 作为 Owner，我删除的 agent（soft-delete）其会话文件登记仍计入归属引用集，backfill 不会把崩溃窗口的回复按其他 agent 补写。
11. 作为 Owner，共享目录中无主 session 文件永不解析——agent 启动一律新建会话，不会粘性继承他人上下文。
12. 作为 Owner，agent 重启后会话按同一文件恢复（上下文保留），但 session reset / full reset 删净该 cwd 下无主文件，重建即全新会话。
13. 作为 Owner，backfill 崩溃恢复只补写归属门禁通过的轮次（cwd 一致 + 不被他人引用 + mtime 晚于成员创建），任一不过整文件跳过。
14. 作为 Owner，我能在消息流 badge 上 hover 看到放弃明细（agent：reason），点击直达该 agent 的轮次记录页。

## Implementation Decisions

以下决策全部已在对应 ticket 落地（实现细节见各 ticket `## Answer`）：

1. **回复失败语义**（ticket 01/09）：reply 无 content / 空文本 = 本轮失败（不 ack、error 状态点、保持 pending 重试）；cap-ack 后游标推进，badge 语义「已放弃」= `silent` + `error/capped`。
2. **状态点语义**（ticket 01/07）：四态不变；`prompt_error` 写 error 且不被 idle 推导覆盖，直到下次 agent_start 或重启。
3. **busy-cwd 与启动互斥**（ticket 02）：BusyCwdError 映射 busy-cwd，driver 等占用会话 settle 后重试（不丢 hint、不落 error）；`withCwdStartLock` per-cwd 启动互斥，检查+启动原子化。ADR-0001 串行语义落地为 mutex + 运行期 busy 检查。
4. **会话文件所有权**（ticket 03/04/08，ADR-0003/0004）：凭证 = 固化登记（`pi_session_file`），复用需过归属校验，失败自愈（清绑+新建空会话）；无主文件永不解析；backfill 五条文件级门禁 + 轮级跨作者去重 + 软删成员登记纳入引用集。
5. **唤醒面策略**（ticket 05）：唤醒面不收窄，回应与否下放 agent 自判——`buildReplyPrompt` rubric（MUST/MAY/MUST ignore）+ 确定信号（@mention、in_progress owner 线程他人消息）下 ignore = 失败 + 连续 2 次 cap-ack。
6. **轮次记录**（ticket 07）：round_logs 表（schema v9，7 种有结论状态，ring cap 200/agent，driver 唯一收口点）；可观测页「轮次记录」卡片；状态点保持四态不动。
7. **「未回复（已放弃）」badge**（ticket 09）：派生自 round_logs——`isAbandonedRound`（silent + error/capped）→ 每 (agent,target) 最新一轮 → 锚 `base_seq` 对应 seq 消息 → `listMessages` 批量挂 `abandonedMarks`（`listRoundLogsByTarget` 新查询，SCHEMA_VERSION 10）→ MessageRow 小字 badge（CircleSlash + 未回复/{count} 人未回复 + tooltip + 点击开 agent 面板）。
8. **术语**（ticket 05/07）：订阅/唤醒/点名/退订、轮次/轮次结果 入 CONTEXT.md；ADR-0002/0003/0004 已记录。

## Testing Decisions

- 测试原则：只测外部行为，不测实现细节；fake runtime 注入（`LoopRuntime` 结构子集）零 SDK 依赖——node TS strip 模式无法解析 rpc-manager 的 parameter properties，绝不能静态 import。
- 测试 seam：`lib/agent-loop/*.test.mjs`（fake runtime 驱动 loop/driver/backfill）、`lib/raft/*.test.mjs`（服务层 + 内存 tmp DB）、`components/ChannelView.test.mjs`（react-dom/server 渲染断言）、`lib/request-security.test.mjs` / `*-route.test.mjs`（route 源码级断言）。
- 基线：`ticket06: RED` 复现脚手架（四场景覆盖矩阵）→ 08 修复后转绿；软删 corner 由 08 关闭。
- 当前全量：`node --test lib/agent-loop/*.test.mjs lib/raft/*.test.mjs components/ChannelView.test.mjs` = **323 用例全绿**；`tsc --noEmit` 干净；`npm run lint` 干净。

## Out of Scope

- 多人/多机/服务器部署（本地单机形态不变）
- 非 pi runtime（Claude Code / Codex / OpenCode 等）
- pi session 文件格式改动（读写权归 SDK）
- 频道消息流 UI 重构（与隔离无关的在途改动）

## Further Notes

- 热重载陷阱：改 agent-loop/driver/wake/backfill 等被 globalThis 闭包引用的模块后必须重启 dev server；当前无 worksplice dev server 在跑，`npm run dev` 即全新加载。
- 工作树现状：36 个文件、+2188/-333 的未提交变更 = 本 effort 全部落地物（含 ADR-0002/0003/0004 与 rounds.ts 新文件）；下一个环节 = `/code-review`（对基线 `229b1f6` 双轴审查）+ 提交。
- 验收命令：`node_modules/.bin/tsc --noEmit` + `npm run lint` + `node --test lib/agent-loop/*.test.mjs lib/raft/*.test.mjs components/ChannelView.test.mjs`；**绝不 `next build`**。
