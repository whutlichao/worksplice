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
- 初始双轴复核摘要遗漏了后续独立 Standards review 发现的焦点环硬 finding；该 finding 已由本 follow-up 修复，分别的 Standards 与 Spec 结论见下方新增报告。
- 验证：`npm test`（1375/1375）、`node_modules/.bin/tsc --noEmit`、`npm run lint`（0 errors；只有未改 `hooks/useI18n.tsx:61` 的既有 warning）。
- PR：[#159](https://github.com/whutlichao/worksplice/pull/159)（base: `main`）。

### 后续：键盘焦点环

- 修复：色格的选中态改由边框宽度/颜色表达，不再以内联 `outlineWidth: 0` 覆盖全局 `:focus-visible`；未选中色格聚焦时保留 2px `--accent-graphic` 焦点环。
- TDD：新增回归测试先红（未选中色格 `outlineWidth` 实为 `0`），再绿；测试同时断言选中态视觉标记与全局焦点环规则仍在。
- 验收：`node --test components/AgentDetailPanel.test.mjs components/Avatar.test.mjs`（34/34）；`node_modules/.bin/tsc --noEmit` 通过；`npm run lint` 0 errors。唯一 warning 位于未改的 `hooks/useI18n.tsx:61`，该文件与 `origin/main` 无差异。
- PR：[#160](https://github.com/whutlichao/worksplice/pull/160)（base: `main`；follow-up PR，未合并）。

### Review — Standards

- 硬 finding 已修复：移除会覆盖全局焦点样式的 inline outline；色格保留 `aria-pressed` 与边框选中标记。
- 非阻断判断 a：`member-route.test.mjs` 直接调用 `PATCH` handler，而非用 `readFile` 检查源码。保留此路由行为测试：它以真实 `Request` 验证状态码、JSON 与持久化，不启动 HTTP server。
- 非阻断判断 b：`members.ts` 与 `sqlite.ts` 重复校验 tint 是跨 seam 防御。领域入口校验不可信 `unknown`；Store 适配器独立拒绝非法调用；SQLite CHECK 约束再保护持久数据不变量。保留三层校验。
- `setAgentAvatarTint` 的 `value` 命名保留：参数在领域入口处是待验证的 `unknown`，通过约束后才作为 tint 写入；没有把未验证输入伪装成强类型 tint。

### Review — Spec

- 本 PR 只审票 02 的七条验收：色域/无障碍名称/自动映射与重复选择/恢复自动/成功与失败呈现/身份生命周期/非 Avatar 语义色均通过；本次只调整焦点可见性，不改变上述行为。
- 整体规格 D3/D4 的跨呈现面同步与 Pi transcript 头像已明确拆分至 `issues/03`、`issues/04`，不作为票 02 或本 PR 缺陷，留待后续票完成。
