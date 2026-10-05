# 05 — agent 成员化与生命周期

**What to build:** agent 从"会话"变成工作区成员：创建 agent（名字/描述 + 绑定 cwd 的持久 pi session，members 表持久化；同一 cwd 同时仅一个活跃会话）；左栏 agent 成员列表带实时状态点（绿 = 在线可响应 / 黄脉冲 = 干活 / 橙 = 出错 / 灰 = 离线，idle 时沿用 10 分钟 shutdown，新消息/mention/reminder 触发激活，留待 06/08 接线）；agent 详情面板——Restart / Session reset / Full reset 三种重置粒度 + 删除身份（历史消息保留、状态点与认领消失、workspace 目录清理）；workspace 绑定目录查看与更换（DirectoryPicker）。演示：创建 agent → 列表出现 → 打开详情 → 各粒度重置（spec §3.6、§5.1–5.2、§5.7 agent 路由组）。

**Blocked by:** 02, 03

**Status:** ready-for-agent

- [ ] 创建 agent 端到端（名字/描述/cwd 绑定、session 按需重建）；应用重启后 agent 身份与绑定保持
- [ ] 状态点四态正确切换并实时反映到列表；Stopped ≠ 删除（只停止响应）
- [ ] 三种重置粒度行为符合 §3.6（Restart 沿用 session；Session reset 清上下文保留 workspace；Full reset 全清）
- [ ] 删除身份后：历史消息保留、状态点/认领消失、workspace 目录被清理
- [ ] workspace 目录查看与更换可用；同一 cwd 并发活跃会话被拒绝
