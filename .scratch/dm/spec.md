# DM 私信需求规格（需求对齐结论）

> 状态：6 个 sharp question 已全部决策（R1–R6）+ 边角收口（R7）。`frontier` 为空。
> 术语：`频道`/`订阅`/`唤醒`/`回应判断`/`提及`/`穿透`/`静音` 沿用 CONTEXT.md；新增 `私信`。
> 禁词：`room`（一律用`频道`/`私信`）。

## §1 背景

多 agent 协作消息系统（人类 owner + 若干 agent 经频道协作，agent-loop 拉取式消费）缺一对一私密通道：owner 需与单个 agent 私下对话，不经过频道广播。

## §2 数据形态（R1：复用 channel 加 dm 类型）

- `channels.type` CHECK 扩展为 `('public','private','dm')`；`target_id/seq/UNIQUE(target_id,seq)/FTS5/任务锚定` 全部复用，不建新表、不开独立 seq 空间。
- DM 即一行 `type='dm'` 的频道 + 两名固定成员（§3）。服务层 `createDirectChannel(owner, agent)` / `isDM(channel)` / `getDMFor(agent)` 为窄入口；`resolveChannelForTarget` 等既有路径对 `dm` 與 `private` 同权（除 §6 禁止项外）。
- 迁移：schema 版本 +1（CHECK 改写 + 存量 `dm:*` 幂等补齐，见 §7）。

## §3 成员规则（R2：严格两人）

- DM 成员恒为两人：`owner + 1 个 agent`，创建时定死。
- 不许加人、不许退订（`join/leave` 对 DM 拒绝，含 Owner；对标 `#all` 不可离开语义）。
- agent soft-delete 后 DM 保留可读（消息不可变外键语义不变），不再可写。

## §4 UI 形态（R3：侧栏分组 + 复用 ChannelView）

- 侧栏新增独立「私信」分组（`type='dm'` 过滤，按 agent 名排序），与频道列表视觉分区。
- 中央复用 `ChannelView` 渲染 DM 消息流（消息/引用/reaction/pin/附件/任务视图/提醒入口行为一致）；右栏 `DetailPanel` 不动。
- DM 头部隐藏：成员管理（加人/移除）、归档按钮、静音开关（§6 禁用项不渲染）。

## §5 agent-loop 回应语义（R4：DM 默认必回应）

- DM 内人类消息 = **确定信号**（类比被点名）：`回应判断` 新增一条 —— DM target 下作者为 owner 的人类消息必须 `reply`，`ignore` 按失败处理（不 ack、error 状态点、连续 2 次后 cap-ack，沿用既有确定信号失败路径）。
- DM 内 agent 自己的消息 / 系统事件消息沿用既有跳过规则；任务线程语义（§3.7 自醒/游标收口）在 DM 内同样适用（target 即 DM 锚点）。

## §6 功能面（R5：任务/提醒可用 + mute 禁用）

| 功能 | DM 语义 |
| --- | --- |
| 消息/引用/reaction/pin/附件 | 可用，与频道一致 |
| 任务（转任务/认领/状态机/互审） | 可用，锚定 DM 消息；`number` 按 DM 内递增 |
| 提醒（创建/触发/唤醒作者） | 可用，目标可锚 DM |
| 搜索/未读角标 | 可用（DM 计入未读） |
| 静音 mute | **禁用**（两人私信无退订意义；服务层拒绝 + UI 不渲染） |
| 归档/离开/加人 | **禁用**（见 §7） |

## §7 命名 / 生命周期 / 迁移（R6 + R7）

- **命名**：固定 `dm:owner↔<agent名>`，不可改名（改名请求拒绝）。
- **生命周期**：DM 不可归档、不可离开（对标 `#all`）；随 agent soft-delete 保留可读。
- **秘书**：秘书 agent 与普通 agent 同权，同样配一条 DM。
- **迁移 seed（幂等补齐）**：migration 按现存未删除 agent 逐个 `INSERT … SELECT WHERE NOT EXISTS` 建 `dm:owner↔<name>`（仅缺失才建，可重跑）；新建 agent 时同步建 DM（`createAgent` 内与 `#all` 自动加入同处）。

## §8 待决策（实施阶段回答，不阻塞本票）

1. DM 的 `id` 生成规则：沿用随机 id vs 确定性 `dm:<agentId>`（后者天然幂等，前者需唯一索引兜底）—— 实施票定。
2. `WorkspaceSidebar` 私信分组的未读合并口径（是否与频道角标求和）—— 实施票随 UI 定。
3. DM 内任务 `reopen` 封锁语义是否与频道完全一致（owner 即人类天然可认领，封锁是否冗余）—— 实施票定。
4. 存量 `channels.type` CHECK 改写时的 SQLite 迁移写法（`ALTER` 重建表 vs 新库直接建）—— 实施票按 schema 版本惯例定。

## 行为变化（相对现状）

- 新增：每 agent 一条 DM；侧栏私信分组；`回应判断` +1 确定信号；`channels.type='dm'`。
- 禁止：DM 上的 join/leave/archive/mute/改名（服务层抛错 + UI 隐藏入口）。
- 不变：消息/任务/提醒/reaction/pin/附件/搜索/未读全部复用既有语义。

## 原型指针

- `.scratch/dm/dm-logic-prototype.html` —— logic 分支 throwaway 原型（双击即开）：纯模块 `DMRules`（decideResponse / canJoinLeave / availableFeatures / seedDMs）+ 页面壳（当前状态面板 + 自由点击 + 4 个引导页签：私信必回应 / 频道对照 / 非法操作拦截 / 幂等补齐）。
- 验证性断言本地跑过、不提交测试文件（prototype 反模式）。

## CONTEXT.md 术语草案（实施票落盘，本票仅草案）

```md
**私信 (DM)**:
owner 与单个 agent 的一对一频道（`channels.type='dm'`），成员创建时定死两人，不许加人/退订/归档/离开/静音；人类消息为确定信号（必须回应）。
_Avoid_: 私聊、room、dm 小群
```
