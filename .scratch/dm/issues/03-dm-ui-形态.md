# 03: DM UI 形态（侧栏私信分组 + 复用 ChannelView）

**What to build:** 侧栏新增独立「私信」分组，按 agent 列出；点击后中央复用 ChannelView 渲染 DM 消息流，右栏 DetailPanel 不变；DM 头部隐藏成员管理、归档、静音入口。

**Blocked by:** 01, 02

**Status:** ready-for-agent

- [ ] 侧栏渲染独立「私信」分组（`type='dm'` 过滤，按 agent 名排序）
- [ ] 点击私信进入 DM 消息流，复用频道消息体验（消息/引用/reaction/pin/附件）
- [ ] DM 头部不渲染成员管理（加人/移除）、归档、静音入口
- [ ] 未读角标对 DM 生效（合并口径与频道一致，实施时定）
- [ ] 组件渲染测试覆盖
