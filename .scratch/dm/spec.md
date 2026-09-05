# DM（私信）需求规格（对齐结论，待实施票落实）

> 来源：与 coordinator 六轮 orchestration ask 对齐（R1–R6），不编造未确认语义。
> 原型：`.scratch/dm/dm-prototype.html`（prototype skill · logic 分支，throwaway，双击即开）。
> 原型验证：纯逻辑模块 9 断言全 PASS（建 DM / 重复建幂等 / 拉第三人拒绝 / 离开拒绝 / 归档拒绝 / mute 拒绝 / DM 消息 wake 必回应 / ignore 判失败 / reply 正常 ack）。

## 1. 数据形态（R1：复用 channel 加 dm 类型）

- `channels.type` 新增 `'dm'` 取值（CHECK 放宽 + 老库 ALTER 兼容）；不建新表。
- DM 即一条 type='dm' 的频道：`messages`（seq/freshness-hold）、`inbox`（drain/ack 游标）、`wake` 全套复用既有机制。
- 命名：`dm-<agentId>`（或等价确定性命名，保证幂等查找）。

## 2. 成员规则（R2：固定两人、不许多 DM）

- 成员恒为 `owner + 单个 agent`，不可扩员：`joinChannel` / `leaveChannel` 对 dm 全部拒绝。
- 每 agent 最多一个 DM：`createDM(agentId)` 先查既有，有则幂等返回，无则创建（创建者 Owner + 指定 agent）。
- 不可归档（`setChannelArchived` 对 dm 拒绝；`#all` 同理已有先例）。

## 3. UI 形态（R3：侧栏分组 + 复用 ChannelView）

- 侧栏新增独立 DM 分组，按 agent 列出（与频道列表分开）。
- 中央复用 `ChannelView` 只读渲染消息流；右栏 `DetailPanel` 不变（仍按 kind 分派 agent/human/thread）。
- DM 内隐藏 join/leave/archive/成员管理入口（前端隐藏 + 服务层拒绝双保险）。

## 4. agent-loop 回应语义（R4：DM 默认必回应，其余不变）

- 1 对 1 下对方任何消息 = 确定信号：必须回应，`ignore` 按失败处理（不 ack + error 状态点 + 连续 2 次后 cap-ack，沿用既有回应判断失败路径）。
- 提醒 / 任务延续自醒 / 静音穿透（DM 内 mute 已禁用，此条空转）等其余语义不变。
- 落点推测（实施时确认）：`loop.ts` 的回应判断按 `channel.type === 'dm'` 短路为 must-respond。

## 5. 功能面（R5：全可用且 DM 禁用 mute）

- 任务 / 提醒 / pin / reaction / 附件在 DM 内全可用。
- 任务互审（构建者不验证）下另一方只能是 Owner（DM 只有两人，无第三方可审）。
- `channel_mutes` 对 dm 拒绝写入（1 对 1 下静音 = 失联，故禁用）；个人提及穿透条款在 DM 内无意义（成员恒在）。

## 6. 迁移与 seed（R6：存量幂等补齐 + 新建即建）

- schema 迁移：`channels.type` CHECK 加 `'dm'` + 老库兼容（ALTER 重建或约束放宽，以实施票定）。
- seed/迁移：为每个既有 agent 幂等补齐 DM（类似 `#all` 成员补齐）；之后新建 agent 时即建 DM（`members.ts` 创建路径挂钩）。
- `SCHEMA_VERSION` 递增。

## 7. 实施落点（给实施票的指针，不在本 worker 落实）

- `lib/data/schema.ts`：type CHECK + 版本 + seed 补齐。
- `lib/domain/raft/channels.ts`：createDM（幂等）+ join/leave/archive 对 dm 拒绝。
- `lib/domain/raft/` mute 路径：dm 拒绝。
- `lib/agent-loop/loop.ts`：DM 短路 must-respond。
- 侧栏 DM 分组 + `ChannelView` 在 dm 下隐藏管理入口。

## 8. 待决策（open，实施前需 ask）

1. DM 命名与 id 方案（`dm-<agentId>` vs 随机 id + 唯一索引）。
2. DM 内任务 number 空间是否与频道共享（按 target 独立计仍是每 DM 从 #1 起，与既有"跨容器各自从 #1"一致，待确认）。
3. 既有 `#all` 自动加新 agent 的 seed 是否同样自动补 DM（R6 已定"是"，但与秘书静默加入规则的交互待实施时核对）。
