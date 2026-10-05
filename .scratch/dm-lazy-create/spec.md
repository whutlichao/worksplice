# Spec: DM 懒创建（私信「发送了消息才出现」）

来源：grill-with-docs 需求对齐访谈（对已有 DM effort `.scratch/dm/spec.md` R1–R7 的修订，改变 eager 创建语义）。
grilling 设计树 Q1–Q5 已逐轮对齐，frontier 已空、无遗留缺口；术语决议 inline 落 CONTEXT.md，ADR 判定见 Further Notes。

## Problem Statement

worksplice 现有「私信 (DM)」是 eager 创建：`createAgent` 末尾自动 `createDirectChannel(agent.id)`（每建一个 agent
就同步生成一条 DM），schema seed §R6 每次开库对存量未删 agent 幂等补齐空 DM。后果是侧栏「私信」分组在建 agent 的
瞬间就冒出一整排空私信——用户认为「每建一个 agent 侧栏就自动出现一个私信」不合理，理应「发送了消息才出现」。

## Solution

把 DM 从 eager 创建改为**懒创建 (Lazy Create)**：DM 不随 agent 创建而存在，而是 owner 首次打开 agent 详情面板的
「发送消息」入口时才幂等建空 DM；侧栏「私信」分组只显示已有消息（顶层消息数 > 0）的 DM。同时一次性迁移删除现存
空 DM，彻底回到「无消息无 DM」的干净语义。agent 详情面板顶部新增醒目主按钮（无消息 →「发送消息」，有消息 →
「打开私信」），点击即建/取 DM、导航中央复用 ChannelView 并聚焦 composer、关闭右栏面板。

## User Stories

1. 作为 Owner，新建 agent 时侧栏「私信」分组不会自动冒出空私信——DM 只在真正有消息后才出现。
2. 作为 Owner，我在 agent 详情面板顶部看到一个醒目的「发送消息」按钮，点击后中央打开该 agent 的私信
   （复用频道消息体验），输入框已聚焦，可直接发首条消息。
3. 作为 Owner，首条消息发出后，该 agent 的私信才出现在侧栏「私信」分组；对有消息的 agent，按钮文案变为
   「打开私信」，点击跳转到既有私信。
4. 作为 Owner，升级后存量库里已存在的空 DM（0 消息）被自动清理，不再残留。
5. 作为 Owner，被软删的 agent 其有消息的 DM 仍保留在侧栏显示为「归档可读」（沿用 R7），无消息则随清理消失。

## Implementation Decisions

1. **懒创建时机 = 首次打开「发送消息」入口（Q1=A）**：移除 `createAgent` 末尾的 `createDirectChannel(agent.id)`；
   移除 schema seed §R6 的 DM 补齐三段（channels + owner member + agent member 的 `INSERT OR IGNORE`）。
   DM 由「发送消息」入口触发幂等 `createDirectChannel`（点即建空 DM，复用既有确定性 id `dm:owner↔<名>` +
   幂等语义，不建新表、不开独立 seq 空间——R1 数据形态不变）。
2. **存量空 DM 迁移删除（Q2=A）**：新增一次性迁移——删除全部 `type='dm'` 且 0 消息的频道行及其 `channel_members`
   关联行（幂等可重跑；有消息的 DM 保留）。「空」的判定 = 无任何 `target_id = dm.id` 的顶层消息（DM 首条消息必为
   顶层，故「无顶层消息」⟺「无消息」）。放在 seed 之前/之后的迁移链里，按 schema 版本惯例起一版。
3. **侧栏过滤 = 有消息才显示（Q4=A）**：`listChannelsWithMeta` 附「有消息」信号（`maxSeq(channel.id) > 0` 即
   有顶层消息，或新增显式 `countMessages` 读原语——实现二选一，但与迁移的「空」判定必须同源一致）；
   `WorkspaceSidebar` 的 `dmChannels` 在 `type==='dm'` 之上再加「有消息」过滤。软删 agent 的有消息 DM 仍显示
   （归档可读，沿用 R7；软删 DM 由 `deleteAgent` 归档）。空状态沿用 `shell.noDm`（「还没有私信」）。
4. **「发送消息」入口（Q3=A）**：`AgentDetailPanel` 顶部（身份头正下方）新增醒目主按钮；文案动态——无 DM 或无消息
   →「发送消息」，有消息 →「打开私信」。点击流程：新 route `POST /api/members/[id]/dm`（薄封装：幂等
   `createDirectChannel` + 返回 DM channel，软删/不存在 agent 404）→ AppShell 把返回的 DM 合并进 channels 状态 →
   `handleSelectChannel(dm.id)`（导航中央 + 聚焦 composer + 关闭右栏面板，对齐「点频道行=切中央」）。入口回调以
   新 prop（如 `onOpenDM(channelId)`）经 DetailPanel 下传到 AgentDetailPanel。
5. **deleteAgent 兼容懒创建**：`deleteAgent` 里 `getDMFor(agent.id)` 可能返回 undefined（从未发过消息的 agent 无 DM）——
   归档逻辑已是 `if (dm)` 可选，无需改动；实施时补测试锁定「无 DM 的 agent 删除不炸」。
6. **术语（Q5=A）**：CONTEXT.md 已 inline 新增「懒创建 (Lazy Create)」词条 + 更新「私信 (DM)」词条补懒创建语义。

## Testing Decisions

- 测试原则：只测外部行为，不测实现细节；服务层测试经 `lib/domain/raft` 唯一导入面 mock 整域 + 内存 tmp DB；
  组件测试用 `react-dom/server` 渲染断言；route 测试源码级断言。agent-loop 零改动（DM 回应判断 R4 已落地，不重做）。
- 测试 seam（实施票要求）：
  - `lib/domain/raft/*.test.mjs`：`createAgent` 不再建 DM（`getDMFor` 返回 undefined）；迁移删除空 DM（有消息的 DM
    保留、空 DM 连同 channel_members 删除、可重跑幂等）；`listChannelsWithMeta` 附「有消息」信号；`deleteAgent` 无 DM
    的 agent 删除不炸。
  - `components/WorkspaceSidebar.test.mjs`：侧栏只显示有消息的 DM（空 DM 不显示、软删归档有消息 DM 显示）。
  - `components/AgentDetailPanel.test.mjs`：按钮文案动态（发送消息/打开私信）；点击触发 onOpenDM 回调。
  - `*-route.test.mjs`：`POST /api/members/[id]/dm` 幂等建/取 DM（软删/不存在 agent 404）。
- 基线：红绿单切片——先写「懒创建 + 迁移删空 DM」必红测试，再实现转绿；每实施票自留回归测试。

## Out of Scope

- 侧栏 agent 行的「发送消息」快捷入口（用户仅要求 agent 详情面板；hover/右键入口不在本票）
- 「发送消息」入口的草稿暂存 / 未发送空 DM 的自动回收（点开未发留下不可见空 DM，无害，不做 GC）
- 软删 agent 面板入口可达性（软删 agent 从成员列表消失，面板不可达，无需处理）
- 多人/多机部署、pi session 文件格式、DM 独立表 / 独立 seq 空间（R1 已否决）
- DM 回应判断 / 任务互审 / 提醒锚定等 R2–R5 语义（本票不改，沿用 .scratch/dm 已落地实现）

## Further Notes

- **ADR 判定（懒创建）**：三条件不全满足，**不建 ADR**。逐条：(1) 难逆转 ✗——懒创建是删 `createAgent` 调用 +
  迁移删空 DM，逆转成本低（重加 `createDirectChannel` 调用即可），非「quarter 级锁定」；(2) 无上下文会意外 ✗（弱）——
  未来读者见「DM 有消息才出现」会想「为何不随 agent 建」，但理由（避免侧栏空私信噪音）直观；(3) 真实权衡 ✓——
  确有 eager vs lazy 备选且被具体理由否决。条件 1 不满足，按域建模纪律（三条件全满足才建）跳过 ADR，判定落本 spec。
- **对已有 DM effort 的修订面**：R1（数据形态复用 channel）不变，R6（幂等补齐）改为懒创建，R7（软删保留可读）不变；
  R2–R5（成员规则/UI 形态/回应判断/功能面）不受影响。实施时注意：`.scratch/dm/issues/01` 已把 seed §R6 与
  createAgent 同步建 DM 落地，本票是对这两处的逆操作。
- **热重载陷阱**：改 `lib/data/schema.ts`（seed/迁移）、`lib/domain/raft/members.ts` 等被 globalThis 闭包引用的
  模块后必须重启 dev server（改代码后查 `ps aux | grep next-server` 启动时间晚于改动）。
- **验收命令**：`node_modules/.bin/tsc --noEmit` + `npm run lint` + `node --test lib/domain/raft/*.test.mjs
  components/WorkspaceSidebar.test.mjs components/AgentDetailPanel.test.mjs`；**绝不 `next build`**。
- **AppShell 接线细节**（03 票实现参考）：入口创建 DM 后，返回的 channel 需合并进 `channels` 状态（参照 AppShell
  `load()` 的 merge 逻辑，保持行引用稳定避免 ChannelView loader 重建）再导航；`handleSelectChannel` 已有
  `setSidebarOpen(false)` 但**不关面板**——本票要在「发送消息」路径上额外关右栏面板（Q3=A），勿改
  `handleSelectChannel` 本身（它被普通频道行点击共用）。
