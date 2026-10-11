# 02: 持久化 agent 头像色并提供详情页即时选择

**What to build:** agent 详情页提供身份头像色选择与恢复自动色的入口；用户点击后立即保存，详情头像反映当前选择。新旧 agent 的默认外观仍按 member ID 自动取色，显式选择作为身份级持久设置。

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] 详情页只允许为 agent 选择现有 `av-0…av-3` 色格；人类头像保持 `av-4`，不接受任意色值。
- [x] 每个色格都有与其对应、可访问的名称；当前选择不只依赖颜色本身表达。
- [x] 未显式选择的既有和新建 agent 都沿用原有 member ID 自动色；选择色格后立即保存，多个 agent 可以重复使用同一色格。
- [x] 恢复“自动”后，详情头像回到该 agent 原有的 member ID 默认色；选择与恢复的结果在应用重载后保持一致。
- [x] 选择成功后详情头像显示已保存色；保存失败时继续显示原色，并向用户显示失败提示，不呈现未保存的新色。
- [x] 保存后的身份头像色在 Restart、Session reset、Full reset、换 workspace 与改名后仍保持；这些操作不改变 agent 身份色。
- [x] 选择头像色不改变 status dot、任务状态、作者名或其他非 Avatar 语义色。

## Answer

- 实现：成员身份新增受限 nullable `avatar_tint`（schema v14）；经 Store、协作域和成员 PATCH 路由持久化。Agent 详情页提供四个有名色格及“自动/恢复默认”，服务端成功后才更新头像，失败保留旧色并呈现错误。
- TDD：覆盖存储/迁移/非法值、PATCH 合法与非法请求、详情页成功/失败与恢复自动、默认色与重复使用、Restart/reset/workspace 生命周期；另以成员行改名验证 tint 仍附着于同一身份行。当前没有独立的成员改名业务入口。
- Review — Standards：数据访问遵循 `Store → lib/domain/collab → route`；schema 有版本递增及旧库迁移；UI 不直连 DB。Spec：仅允许 0…3 或 null；human `av-4` 与既有自动映射不变；状态/任务/作者等非 Avatar 语义未改。双轴复核未发现遗留问题。
- 验证：`npm test`（1375/1375）、`node_modules/.bin/tsc --noEmit`、`npm run lint`（0 errors；只有未改 `hooks/useI18n.tsx:61` 的既有 warning）。
