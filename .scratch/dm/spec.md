# Spec: DM 私信（一对一 owner↔agent 频道）

来源：grill-with-docs 需求对齐访谈（grilling 设计树 6 个 sharp question R1–R6 + 边角收口 R7，frontier 已空、决策全对齐，无遗留缺口）。
本 spec 按 repo effort 模板重写对齐结论：R1–R7 已决策，User Stories 为行为级验收基线，Implementation Decisions 逐条落 R1–R7，实施票据此落地。

## Problem Statement

多 agent 协作消息系统里，人类 owner 与单个 agent 之间缺一条一对一的私密通道：
现有 `频道` 是多人广播形态（唤醒面 = 全部订阅成员），owner 想与某个 agent 私下对话
只能挤在频道里公开喊话，没有「只对该 agent 可见」的私聊路径。

## Solution

复用 `频道`（channel）加 `type='dm'` 建一对一私信通道：DM 即一行 `type='dm'` 的频道 +
两名固定成员（owner + 1 agent），数据/消息/任务/提醒/搜索/未读全链路复用既有 channel 机制，
仅对成员规则、回应语义、UI 形态、禁用项做窄范围差异化。每个 agent 自动拥有一条
`dm:owner↔<agent名>`，owner 可私下对话；DM 内人类消息是确定信号，agent 默认必回应。

## User Stories

1. 作为 Owner，我能在侧栏独立的「私信」分组里看到每个 agent 的私信入口，点击后中央消息流复用频道体验（消息/引用/reaction/pin/附件/任务/提醒/搜索/未读全部可用）。
2. 作为 Owner，我发 DM 给某个 agent 时，它是确定信号——agent 必须回应，ignore 按失败处理（不 ack + error 状态点 + 连续 2 次 cap-ack），不会像普通频道那样被静默忽略。
3. 作为 Owner，DM 严格一对一：创建时定死两人（我 + 1 agent），我无法加人、退订、归档、离开或静音，命名 `dm:owner↔<agent名>` 不可改。
4. 作为 agent，我收到指向我的 DM 人类消息时必须回应；DM 内我自己的消息/系统事件沿用既有跳过规则，任务线程自醒与游标收口在 DM 内同样生效。
5. 作为 Owner，我在 DM 内可把消息转任务/认领/走状态机/互审，任务 number 按 DM 内递增；也可设提醒锚定 DM 消息，到点触发系统消息并唤醒作者。
6. 作为 Owner，新建 agent 时系统自动为它建一条 DM（与自动加入 `#all` 同处），存量 agent 由幂等迁移补齐，迁移可重跑不重复建。
7. 作为 Owner，被删除的 agent（soft-delete）其 DM 保留可读（对标 `#all` 与消息不可变外键语义），但不再可写。

## Implementation Decisions

以下决策均已对齐（R1–R7），实施票据此落地：

1. **数据形态 = 复用 channel 加 `type='dm'`**（R1）：`channels.type` CHECK 扩展为 `('public','private','dm')`；`target_id/seq/UNIQUE(target_id,seq)/FTS5/任务锚定` 全复用，不建新表、不开独立 seq 空间。服务层窄入口 `createDirectChannel(owner, agent)` / `isDM(channel)` / `getDMFor(agent)`；既有 `resolveChannelForTarget` 等路径对 `dm` 与 `private` 同权（除禁用项外）。
2. **成员 = 严格两人**（R2）：DM 恒为 `owner + 1 agent`，创建时定死；`join/leave` 全拒（含 Owner，对标 `#all` 不可离开）；agent soft-delete 后 DM 保留可读、不可写。
3. **UI = 侧栏「私信」分组 + 复用 ChannelView**（R3）：侧栏新增独立私信分组（`type='dm'` 过滤，按 agent 名排序）；中央复用 `ChannelView`，右栏 `DetailPanel` 不动；DM 头部隐藏成员管理（加人/移除）、归档、静音入口。
4. **回应 = DM 默认必回应**（R4）：`回应判断` 新增确定信号——DM target 下作者为 owner 的人类消息必须 `reply`；`ignore` 按失败处理（不 ack、error 状态点、连续 2 次 cap-ack，沿用既有确定信号失败路径）。DM 内 agent 自己的消息 / 系统事件沿用跳过规则；任务线程自醒/游标收口在 DM 内同样适用。
5. **功能面 = 大部分可用 + mute 禁用**（R5）：消息/引用/reaction/pin/附件/任务/提醒/搜索/未读全可用（任务锚定 DM 消息，number 按 DM 递增；提醒可锚 DM）；mute 禁用（服务层拒绝 + UI 不渲染）；归档/离开/加人禁用。
6. **迁移 = 幂等补齐**（R6）：migration 按现存未删除 agent 逐个 `INSERT … SELECT WHERE NOT EXISTS` 建 `dm:owner↔<name>`（仅缺失才建、可重跑）；新建 agent 在 `createAgent` 内与自动加入 `#all` 同处同步建 DM。
7. **命名 / 生命周期 / 秘书**（R7）：命名固定 `dm:owner↔<agent名>` 不可改；DM 不可归档/离开（对标 `#all`，soft-delete 保留可读）；秘书 agent 与普通 agent 同权，同样配一条 DM。

## Testing Decisions

- 测试原则：只测外部行为，不测实现细节；服务层测试经 `lib/domain/raft` 唯一导入面 mock 整域 + 内存 tmp DB；agent-loop 测试注入 fake runtime（`LoopRuntime` 结构子集）零 SDK 依赖——node TS strip 模式无法解析 rpc-manager 的 parameter properties，绝不能静态 import。
- 测试 seam（实施票要求）：
  - `lib/raft/*.test.mjs`：DM 服务层——`createDirectChannel` 两人定死、`isDM`/`getDMFor`、join/leave/archive/mute/改名全拒、迁移幂等可重跑、新建 agent 同步建 DM、soft-delete 后 DM 保留可读。
  - `lib/agent-loop/*.test.mjs`：DM 回应判断——owner 人类消息必回应、ignore 按失败（不 ack + error + 连续 2 次 cap-ack）、agent 自己消息/系统事件沿用跳过、任务线程自醒与游标收口。
  - `components/ChannelView.test.mjs`：DM 头部隐藏成员管理/归档/静音入口；`WorkspaceSidebar` 私信分组渲染。
  - `*-route.test.mjs`：DM 相关 route 源码级断言（403/409 拒绝路径）。
- 基线：红绿单切片——先写「DM 成员规则 / 回应判断」必红测试，再实现转绿；每实施票自留回归测试。

## Out of Scope

- 多人/多机/服务器部署（本地单机形态不变）
- 非 pi runtime（Claude Code / Codex / OpenCode 等）
- pi session 文件格式改动（读写权归 SDK）
- DM 独立消息表 / 独立 seq 空间（R1 已否决：复用 channel）
- 频道消息流 UI 重构（与 DM 无关的在途改动）
- DM 加密 / 端到端私密性（本地单机单进程，「私密」仅指「只对该 agent 可见」的业务语义）

## Further Notes

- **ADR 判定（DM 复用 channel）**：三条件不全满足，**不建 ADR**。逐条：(1) 难逆转 ✗——`type='dm'` 是加法式 schema 扩展（CHECK 加一个值）+ 局部服务层守卫，逆转成本是「有界、可脚本化的迁移」，非「quarter 级锁定」；(2) 无上下文会意外 ✗（弱）——未来读者见 `type='dm'` 会想「为何不建独立表」，但理由（全链路复用 target/seq/FTS5/任务锚定/freshness-hold）已在本 spec 的 R1 决策显式记录，spec 即上下文；(3) 真实权衡 ✓——确有「独立 dm 表」备选且被具体理由否决。条件 1 不满足，按域建模纪律（三条件全满足才建）跳过 ADR，判定结论落在本 spec。
- 实施阶段待定（不阻塞本票、不改 spec 结论）：DM id 生成规则（随机 vs 确定性 `dm:<agentId>`）、侧栏私信分组未读合并口径、DM 内任务 reopen 封锁语义是否与频道完全一致、SQLite CHECK 改写迁移写法——由实施票按 schema 版本惯例定。
- 热重载陷阱：改 agent-loop/driver/wake/backfill 等被 globalThis 闭包引用的模块后必须重启 dev server（改代码后查 `ps aux | grep next-server` 启动时间晚于改动）。
- 验收命令：`node_modules/.bin/tsc --noEmit` + `npm run lint` + `node --test lib/raft/*.test.mjs lib/agent-loop/*.test.mjs components/ChannelView.test.mjs`；**绝不 `next build`**。
- 原型指针：`.scratch/dm/dm-logic-prototype.html`（logic 分支 throwaway 原型：`DMRules` 纯模块 + 页面壳 + 4 引导页签：私信必回应 / 频道对照 / 非法操作拦截 / 幂等补齐）；验证性断言本地跑过、不提交测试文件（prototype 反模式）。
