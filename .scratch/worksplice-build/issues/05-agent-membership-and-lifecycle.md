# 05 — agent 成员化与生命周期

**What to build:** agent 从"会话"变成工作区成员：创建 agent（名字/描述 + 绑定 cwd 的持久 pi session，members 表持久化；同一 cwd 同时仅一个活跃会话）；左栏 agent 成员列表带实时状态点（绿 = 在线可响应 / 黄脉冲 = 干活 / 橙 = 出错 / 灰 = 离线，idle 时沿用 10 分钟 shutdown，新消息/mention/reminder 触发激活，留待 06/08 接线）；agent 详情面板——Restart / Session reset / Full reset 三种重置粒度 + 删除身份（历史消息保留、状态点与认领消失、workspace 目录清理）；workspace 绑定目录查看与更换（DirectoryPicker）。演示：创建 agent → 列表出现 → 打开详情 → 各粒度重置（spec §3.6、§5.1–5.2、§5.7 agent 路由组）。

**Blocked by:** 02, 03

**Status:** resolved（2026-10-23）

- [x] 创建 agent 端到端（名字/描述/cwd 绑定、session 按需重建）；应用重启后 agent 身份与绑定保持
- [x] 状态点四态正确切换并实时反映到列表；Stopped ≠ 删除（只停止响应）
- [x] 三种重置粒度行为符合 §3.6（Restart 沿用 session；Session reset 清上下文保留 workspace；Full reset 全清）
- [x] 删除身份后：历史消息保留、状态点/认领消失、workspace 目录被清理
- [x] workspace 目录查看与更换可用；同一 cwd 并发活跃会话被拒绝

## Answer

**结论**：完成（2026-10-23 复核；本票为只读审计，未改源码）。

**证据**：
- 创建与持久化：`lib/domain/collab/members.ts:167` `createAgent`（名字/描述/workspace/session 绑定落 members 表）；`members.test.mjs:43`；重启后身份与绑定由 `members` 表读取（`lib/agent-reconcile.ts` 负责对账）。
- 四态状态点：`lib/data/types.ts:13` `"online" | "working" | "error" | "offline"`；`lib/domain/collab/members.ts:281` `setAgentStatus`；`lib/agent-status.ts:69` `publishAgentStatus` 实时广播；测试 `members.test.mjs:156`、`lib/agent-status.test.mjs:33`。
- 三种重置：`lib/agent-lifecycle.ts:106` `restartAgent`（沿用 session）、`:116` `sessionResetAgent`（清上下文保留 workspace）、`:124` `fullResetAgent`（清 workspace 内容，共享项目目录拒绝全量清）；测试 `lib/agent-lifecycle.test.mjs:82`、`:130`、`:387`、`:411`。
- 删除身份：`lib/domain/collab/members.ts:331` `deleteAgent`（soft-delete、移出 channel、清 owner/游标）；`lib/agent-lifecycle.ts:167` `deleteAgentIdentity`（清私有会话/归档/记忆/家目录）；测试 `members.test.mjs:184`、`agent-lifecycle.test.mjs:475`、`:518`。
- workspace 查看/更换：`members.ts:268` `updateAgentWorkspace`；UI `components/AgentDetailPanel.tsx:1778-1780` 使用 `DirectoryPicker`；测试 `members.test.mjs:121`。
- 同一 cwd 并发拒绝：`lib/agent-runtime.ts:251-252` `isCwdBusy` → `BusyCwdError`；`lib/agent-lifecycle.ts:189-193` 映射 409；测试 `agent-lifecycle.test.mjs:119`。

**偏差**：无。

**验证方式**：只读审计（未改源码），核对上述实现与测试文件。本票零源码改动，故未跑 npm test / tsc / lint。
