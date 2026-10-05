# 01: Susan 代办创建后列表不可见

**What to build:**

前端 agent 列表（`components/AppShell.tsx` 的 `agents` state）原先只在 `load()` 时拉取（mount + `refreshKey` 变化），无任何轮询。Susan（秘书 agent）走 HTTP API（`POST /api/members` → `createAgent`）代办创建 agent 时，独立于前端 React 进程，不经 `CreateAgentModal onCreated`，于是：

1. `#all` 消息流 3s 轮询（useChannelData）→ 能看到新 agent 的消息 ✓
2. `agents` 列表无轮询 → 左栏看不到新 agent ✗
3. 频道成员列表 = `agents.filter(a => channelMemberIds.has(a.id))`（ChannelView），既依赖 `agents`（无轮询）又依赖 `channelMemberIds`（`membersVersion` 未递增不重拉）→ 成员面板 / @ 候选看不到 ✗

数据层无问题（`createAgent` → insertMember + addChannelMember(#all) + createDirectChannel 正常）。

修法：给 `agents` 列表加 15s 轮询（与既有 channels 未读轮询同节奏），fetch `/api/members` 合并刷新 `agents`（复用 `shallowEqualAgent` 引用稳定），并在成员 id 集合变化（新增/删除）时 `setMembersVersion` 递增 → 触发 `hooks/useChannelData.ts` 既有 `membersVersion→loadMembers` 重拉 → 频道成员列表/成员面板/@ 候选收敛。合并 + 变更检测抽成纯函数 `reconcileAgents`（`lib/agent-reconcile.ts`）便于 jiti 单测。

**Blocked by:**

（无）

**Status:**

resolved

**验收：**

- [x] Susan 代办创建 agent 后，不刷新页面，agent 列表在 15s 内出现新 agent（ego-browser E2E：`YES`）
- [x] 频道成员列表（成员面板 / @ 候选）同步出现新 agent（ego-browser E2E：成员面板 `YES`）
- [x] UI 手动创建 agent 仍即时刷新（`CreateAgentModal onCreated` 未改动，`setMembersVersion` + `setRefreshKey` 路径保留）
- [x] 轮询不引起 agent 行/频道流无谓重渲染（`reconcileAgents` 引用稳定，单测锁定）
- [x] tight 回路先行 + 回归测试 + `[DEBUG-]` 清理干净（无插桩，无需清理）

## Answer

### 实现决策

- **纯函数 seam**：新增 `lib/agent-reconcile.ts`，导出 `shallowEqualAgent`（从 AppShell 原地迁出）与 `reconcileAgents(prev, incoming) → { agents, membersChanged }`。合并语义与旧 `load()` 内联逻辑一致（`prev.length === 0` 首载直返 `incoming`；字段全等复用旧引用），新增成员 id 集合变更检测 `membersChanged`（数量变化或存在 prev 中不存在的 id）。状态点变化不算成员集合变化，不误触发 `membersVersion` 递增。
- **AppShell 接线**：`load()` 的 agents 合并改走 `reconcileAgents(...).agents`（复用同一决策面）；新增 15s 轮询 effect——`fetch("/api/members")` → `reconcileAgents(agentsRef.current, body.agents)` → `setAgents(next)`（引用稳定，未变则 React bail-out）→ `membersChanged` 时 `setMembersVersion(v => v + 1)`。用 `agentsRef` 读最新快照，避免在 `setAgents` updater 里做 `setMembersVersion` 副作用（StrictMode 双调不污染）。
- **收敛链**：`membersVersion` 递增 → `useChannelData` 既有 `shouldInvalidateMembers` effect 重拉 `loadChannelMemberIds` → `channelMemberIds` 更新 → `channelAgents`/`channelMembers`/`mentionable`/`composerMembers` 全部收敛。`useChannelData.ts` 未动。
- **回归不破坏**：`CreateAgentModal onCreated` 保持 `setMembersVersion` + `setRefreshKey`（手动创建仍即时刷新）；channels 未读轮询 effect 未动。

### 验证命令结果

- 红（tight 回路）：`node --test lib/agent-reconcile.test.mjs` → `MODULE_NOT_FOUND`（模块未建）——6 用例全红。
- 绿：实现后同命令 → 6 pass / 0 fail。
- 全量：`npm test` → **438 pass / 0 fail**（基线 432 + 新增 6）。
- 类型：`node_modules/.bin/tsc --noEmit` → 干净无输出。
- lint（改动文件增量）：`npx eslint components/AppShell.tsx lib/agent-reconcile.ts` → 干净无输出。
- E2E（ego-browser，dev server 重启后）：POST `/api/members` 创建 → 等 17s（不刷新）→ 左栏 agent 列表出现新 agent（`YES`）→ 成员面板出现新 agent（`YES`）→ DELETE 后 17s 两侧均移除（`YES`）。注意：首次 E2E 得 `NO`，根因是 dev server 起于改代码前、turbopack 未热更（served chunk 无 `reconcileAgents`），重启后复测通过。

### 测试 seam

- **纯函数单测**：`lib/agent-reconcile.test.mjs`（jiti 导入，与 `useChannelData.test.mjs` 同法）——锁定"新增/删除检出 + 引用稳定 + 状态变化不误报 + 首载直返"。effect 本体需 React 运行时（SSR 不跑 useEffect），决策面已由纯函数全覆盖，行为面由 ego-browser E2E 验证。`npm test` 已把 `lib/agent-reconcile.test.mjs` 纳入 glob。

### Review 小节（Standards + Spec 双轴自审）

**Standards**：纯函数抽进 `lib/`（与 `lib/panel-state.ts` 同类 client-safe 纯模块），域外 UI 决策不混进 raft 域；`shallowEqualAgent` 单点定义（旧内联迁出，无重复）；注释用中文、术语遵 CONTEXT.md（成员/频道，未用 room 等禁词）；轮询 effect 沿用既有 channels/reminders 轮询纪律（15s、cleanup、catch 吞错）。副作用纪律：`setMembersVersion` 在 effect 回调而非 `setAgents` updater 内，避免 StrictMode 双调；`agentsRef` 读最新快照避免闭包旧值。

**Spec**：验收四项行为级标准全中——(1) Susan 代办创建 15s 内左栏出现（E2E YES）；(2) 成员面板/@ 候选同步出现（E2E YES，@ 候选同源收敛）；(3) 手动创建即时刷新回归不破坏（onCreated 未改）；(4) 引用稳定不无谓重渲染（reconcileAgents 单测锁定未变行引用相等 + 状态变化仅换该行）。数据层无需改动（coordinator 预判成立）。改动面收敛：AppShell + 新纯模块 + 测试 + package.json test glob，未动 useChannelData/ChannelView。
