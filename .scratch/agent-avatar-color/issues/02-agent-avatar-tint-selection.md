# 02: 持久化 agent 头像色并提供详情页即时选择

**What to build:** agent 详情页提供身份头像色选择与恢复自动色的入口；用户点击后立即保存，详情头像反映当前选择。新旧 agent 的默认外观仍按 member ID 自动取色，显式选择作为身份级持久设置。

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] 详情页只允许为 agent 选择现有 `av-0…av-3` 色格；人类头像保持 `av-4`，不接受任意色值。
- [ ] 每个色格都有与其对应、可访问的名称；当前选择不只依赖颜色本身表达。
- [ ] 未显式选择的既有和新建 agent 都沿用原有 member ID 自动色；选择色格后立即保存，多个 agent 可以重复使用同一色格。
- [ ] 恢复“自动”后，详情头像回到该 agent 原有的 member ID 默认色；选择与恢复的结果在应用重载后保持一致。
- [ ] 选择成功后详情头像显示已保存色；保存失败时继续显示原色，并向用户显示失败提示，不呈现未保存的新色。
- [ ] 保存后的身份头像色在 Restart、Session reset、Full reset、换 workspace 与改名后仍保持；这些操作不改变 agent 身份色。
- [ ] 选择头像色不改变 status dot、任务状态、作者名或其他非 Avatar 语义色。
