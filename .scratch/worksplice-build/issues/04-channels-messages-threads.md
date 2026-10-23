# 04 — channels / messages / threads 闭环

**What to build:** 消息域的首个全链路闭环：`#all` 内建且全员自动加入；channel 创建（名称 / 公开或私有 / 描述可选 / 初始成员）、加入/离开、归档（冻结写入保留可读、可解除）；消息发送与列表（按 seq 游标分页，永久不可编辑/删除）；顶层消息 hover → 回复气泡 / 右键 Open Thread，第一条回复即创建 thread，thread 内复用同一套消息渲染、不可嵌套；任务必有 thread 的约束留待 07 兑现。演示：建 channel → 发消息 → 开 thread 回复，全部落库并可读回（spec §3.2、§5.7 channels/messages 路由组）。

**Blocked by:** 02, 03

**Status:** resolved（2026-10-23）

- [x] `#all` 内建，全员自动加入
- [x] channel CRUD 端到端：创建（含公开/私有/描述/初始成员）、加入、离开、归档/解归档；权限符合 §3.2（公开自由加入，私有须 Owner 加成员）
- [x] 消息发送/列表按 seq 游标分页正确；thread 开/回正确；不可嵌套（嵌套入口被阻止）
- [x] 消息无编辑/删除路径；seq 单调递增
- [x] 引用（quote）与复制链接可用（§3.2 消息动作）

## Answer

**结论**：完成（2026-10-23 复核；本票为只读审计，未改源码）。

**证据**：
- `#all` 内建：`lib/data/schema.ts:5` `BUILTIN_CHANNEL_ID = "#all"`；`lib/domain/collab/members.ts` 的 `createAgent` 同事务 `addChannelMember(BUILTIN_CHANNEL_ID, ...)`（测试 `lib/domain/collab/channels.test.mjs:55`）。
- 频道端到端：`lib/domain/collab/channels.ts:103` `createChannel`、`:138` `joinChannel`、`:160` `leaveChannel`、`:183` `setChannelArchived`；公开/私有权限与 Owner 加成员测试见 `channels.test.mjs:61-131`。
- 消息/线程：`lib/domain/collab/messages.ts:98` `sendMessage`、`:183` `listMessages`、`:226` `getThreadInfo`；首条回复开线程见 `messages.test.mjs:68`；不可嵌套在 `messages.ts:77` 拒绝（`messages.test.mjs:85`）。
- seq 分页：`messages.ts:180-208` 按 seq 游标取页（`messages.test.mjs:192`）；thread 自有 seq 空间见 `messages.test.mjs:226`。
- 无编辑/删除路径、seq 单调：`messages.ts:95` 注释与模块导出面（无 update/delete 导出）；`messages.test.mjs:27`。
- 引用与复制链接：`messages.ts:121-126` 引用拼接、`:238` `formatQuote`；UI 动作栏 `components/ChannelView.tsx:737-812`（复制链接按钮 `:812`）；测试 `messages.test.mjs:160`。

**偏差**：无。

**验证方式**：只读审计（未改源码），核对上述实现与测试文件。本票零源码改动，故未跑 npm test / tsc / lint。
