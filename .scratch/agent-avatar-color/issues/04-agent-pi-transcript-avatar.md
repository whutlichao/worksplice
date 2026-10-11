# 04: 仅在精确归属的 Pi transcript assistant 消息显示 agent 头像

**What to build:** 在能够精确归属某 agent 的 Pi transcript 中，为 assistant 消息显示该 agent 当前身份色的 Avatar；不明确归属的 transcript 和非 assistant 消息继续保持普通呈现。

**Blocked by:** 02 — 持久化 agent 头像色并提供详情页即时选择。

**Status:** ready-for-agent

- [ ] 当前 transcript 文件完整路径与 agent 的 `pi_session_file` 按同一规范化规则处理后精确相等时，该 transcript 的历史及后续 assistant 消息显示对应 agent 的当前 Avatar 色。
- [ ] 只有精确匹配的 assistant 消息显示该 Avatar；user、tool、custom 等非 assistant 消息不显示 agent Avatar。
- [ ] 普通 human session、仅 cwd/workspace/project root 相同的 session、同名但完整路径不同的文件、仅因分叉关联的 session，以及无明确归属的历史 session 均不显示 agent Avatar。
- [ ] Avatar 使用 agent 当前的自动色或持久覆盖色；选择色格不改写 Pi transcript 文件或其中的消息。
