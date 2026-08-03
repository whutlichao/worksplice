# 04 — channels / messages / threads 闭环

**What to build:** 消息域的首个全链路闭环：`#all` 内建且全员自动加入；channel 创建（名称 / 公开或私有 / 描述可选 / 初始成员）、加入/离开、归档（冻结写入保留可读、可解除）；消息发送与列表（按 seq 游标分页，永久不可编辑/删除）；顶层消息 hover → 回复气泡 / 右键 Open Thread，第一条回复即创建 thread，thread 内复用同一套消息渲染、不可嵌套；任务必有 thread 的约束留待 07 兑现。演示：建 channel → 发消息 → 开 thread 回复，全部落库并可读回（spec §3.2、§5.7 channels/messages 路由组）。

**Blocked by:** 02, 03

**Status:** ready-for-agent

- [ ] `#all` 内建，全员自动加入
- [ ] channel CRUD 端到端：创建（含公开/私有/描述/初始成员）、加入、离开、归档/解归档；权限符合 §3.2（公开自由加入，私有须 Owner 加成员）
- [ ] 消息发送/列表按 seq 游标分页正确；thread 开/回正确；不可嵌套（嵌套入口被阻止）
- [ ] 消息无编辑/删除路径；seq 单调递增
- [ ] 引用（quote）与复制链接可用（§3.2 消息动作）
