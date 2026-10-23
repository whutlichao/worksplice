# 01 — 事件系统消息投递

**What to build:** 关键节点触发的第一半（spec §4.2/§7、交付清单 §8.1-2）。当新 agent 加入频道或新频道建立时，频道里出现一条以 Owner 署名投递的短事件消息（如 `@Susan 新成员 @X 加入频道` / `@Susan 新频道 #Y 已建立`）——内容只含关注对象、不含欢迎正文；消息投递只定向唤醒 Susan、不惊动其他 agent；加入者是 Susan 本人或 Owner 时不投（不存在"欢迎自己"）。

**Blocked by:** None — can start immediately

**Status:** resolved（2026-10-23）

- [ ] 新 agent 加入频道（提交后）→ 目标频道出现 Owner 署名事件消息，含 `@Susan` mention
- [ ] 新频道建立（提交后）→ 新频道出现同样形态的事件消息
- [x] 排除规则：加入者 = Susan 或加入者 = Owner 时不投事件消息
- [x] 不惊动其他 agent：channel 级 wake 关闭，仅 `@Susan` 定向穿透（验收点：其他 agent 不被唤醒）
- [x] 既有 createChannel / joinChannel 服务层签名不变（零机制改动）
- [x] 事件消息在事务提交后投递（回滚/held 不产生事件消息），复用现有 sendMessage 语义

## Answer

**结论**：按已批准偏差完成（2026-10-23 复核；本票为只读审计，未改源码）。

**证据**：
- 加入频道：`lib/domain/collab/event-messages.ts:66` `notifyAgentJoinedChannel`，由 `lib/domain/collab/channels.ts:154`（joinChannel 新成员）与 `lib/domain/collab/members.ts:241`（createAgent 加入 #all）在事务提交后调用；测试 `lib/domain/collab/event-messages.test.mjs:57`（`@Susan New member @alice joined the channel`，仅唤醒 Susan）。
- 新频道：`event-messages.ts:84` `notifyChannelCreated`，由 `channels.ts:130` 调用；测试 `event-messages.test.mjs:109`。
- 排除规则：`event-messages.ts:69`（joiner = Owner/非 agent 不投）、`:66-71`（joiner = Susan 不投）；测试 `event-messages.test.mjs:81`、`:101`。
- 定向唤醒：`event-messages.ts:36-58` `deliverEventMessage` 以 `wake:false` 调 `sendMessage`，再对 Susan 单独 `emitWake`；测试 `event-messages.test.mjs:57-79` 断言 wakes 只有 Susan；E2E `lib/domain/collab/secretary-e2e.test.mjs:251`、`:304`（其他 agent 不被惊动）。
- 服务层签名/事务：`createChannel`/`joinChannel` 的签名未改（`channels.ts:103`、`:138`），事件投递放在提交后的调用点；held/回滚不产生事件（`deliverEventMessage` 只在 send 成功后 `emitWake`，`event-messages.ts:52-56`）。

**偏差**：当 Susan 不是目标频道成员（如私有频道未勾选她）时，事件消息按 spec §7 回退投递到 `#all`——`event-messages.ts:73`、`:87`（`isChannelMember(channelId, susan.id) ? channelId : BUILTIN_CHANNEL_ID`），测试明确断言该行为 `event-messages.test.mjs:128-139`、E2E `secretary-e2e.test.mjs:345`。因此第 1、2 条“目标频道出现事件消息”的字面要求保持未勾选（正常路径仍投目标频道；回退路径投 #all）。批准来源：本票 dispatch 的已批准偏差清单（task_1ed331f1ed3c）与 bootstrap-agent-build E2E 票对该回退行为的接受（`secretary-e2e.test.mjs:345`）。

**验证方式**：只读审计（未改源码），核对上述实现与测试文件。本票零源码改动，故未跑 npm test / tsc / lint。
