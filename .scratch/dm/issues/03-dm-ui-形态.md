# 03: DM UI 形态（侧栏私信分组 + 复用 ChannelView）

**What to build:** 侧栏新增独立「私信」分组，按 agent 列出；点击后中央复用 ChannelView 渲染 DM 消息流，右栏 DetailPanel 不变；DM 头部隐藏成员管理、归档、静音入口。

**Blocked by:** 01, 02

**Status:** resolved

- [x] 侧栏渲染独立「私信」分组（`type='dm'` 过滤，按 agent 名排序）
- [x] 点击私信进入 DM 消息流，复用频道消息体验（消息/引用/reaction/pin/附件）
- [x] DM 头部不渲染成员管理（加人/移除）、归档、静音入口
- [x] 未读角标对 DM 生效（合并口径与频道一致，实施时定）
- [x] 组件渲染测试覆盖

## Answer

### 实现决策

1. **侧栏分组（`WorkspaceSidebar.tsx`）**：把 `channels` prop 按 `type === 'dm'` 拆成 `regularChannels`（普通频道）与 `dmChannels`（私信，`.filter` 后 `.sort`，不 mutate 原 prop）。DM 组独立标题用 i18n key `shell.dm`（私信 / Direct messages），排序用 `dmAgentName(name).localeCompare(...)`（`dmAgentName` = 剥离 `DM_ID_PREFIX` 前缀后的 agent 名）。行渲染提取为模块级 `ChannelRow` 组件（两组复用，避免重复 JSX——普通频道用 `#` 字形，DM 用 `MessageSquare` lucide 图标 + agent 名）。点击走既有 `onSelectChannel` 同一路径（ticket 13 中央/右栏解耦不变，不动 DetailPanel）。
2. **DM 头部隐藏（`ChannelView.tsx`）**：新增 `isDM = channel?.type === "dm"`，三处入口加 `!isDM` 门禁——(a) leave/join + archive 块（`channel.id !== BUILTIN_CHANNEL_ID && !isDM`）、(b) 静音 `BellOff`、(c) 成员面板 `Users`（含加人/移除）。保留提醒 `AlarmClock` 与 pinned `Pin`（spec R5 功能面可用）。类型徽标从「public/private 二选一」扩为「dm → 私信 / private → 私有 / public → 公开」（新增 `channel.dm` key），DM 不再误显「公开」。
3. **未读角标**：`listChannelsWithMeta` 已对全部频道（含 dm）算 `unread`（`countUnreadChannelMessages`），侧栏 `ChannelRow` 对 DM 同渲染 badge——零服务层改动，纯 UI 复用。
4. **测试 seam**：`react-dom/server` 渲染断言（参照既有 `WorkspaceSidebar.test.mjs` / `ChannelView.test.mjs` 写法）；新增 3 个侧栏用例（分组标题 + 前缀剥离 / 按 agent 名排序 / DM 未读 badge）+ 1 个 ChannelView 用例（DM 头部隐藏 leave/join/archive/mute/members，保留 reminder/pinned + DM 徽标）。把 `components/WorkspaceSidebar.test.mjs` 加入 `npm test` 脚本，使验收「npm test 全绿（含两组件测试文件）」字面成立。
5. **顺带修一处 pi-lens blocker**（编辑 ChannelView 整文件自扫命中）：`runChannelAction` 的 `body: object` → `body: Record<string, unknown>`（纯类型收紧，调用点 JSON.stringify 无影响）。

### 验证命令结果

- `node_modules/.bin/tsc --noEmit` → 0 error 干净
- `node --test components/ChannelView.test.mjs` → 29 pass / 0 fail
- `node --test components/WorkspaceSidebar.test.mjs` → 9 pass / 0 fail
- `npm test` → 412 pass / 0 fail（已含两组件测试文件）
- `npx eslint components/WorkspaceSidebar.tsx components/ChannelView.tsx components/WorkspaceSidebar.test.mjs components/ChannelView.test.mjs lib/i18n/messages/en.ts lib/i18n/messages/zh-CN.ts` → 0 error
- `npm run lint`：本票改动文件 0 error（全仓既有 7 个 React Compiler memoization error 位于 components/ChatInput.tsx / hooks/useAgentSession.ts / hooks/useI18n.tsx，+3 warning，均非本票引入；另有 .scratch/ 下遗留文件，与本票无关）
- 未跑 `next build`（铁律）

### Review

**Spec 轴（对照票据 03 验收标准逐条）**：

1. ✅ 侧栏独立「私信」分组（type='dm' 过滤 + agent 名排序）：`dmChannels` 拆组 + 排序 + `shell.dm` 标题；测试「separate 私信 group」/「sorted by agent name」
2. ✅ 点击私信复用频道消息体验：DM 只是普通 channel id，ChannelView/useChannelData 全链路复用；DM 头部测试断言 reminder/pinned 入口仍在（复用证明）
3. ✅ DM 头部不渲染成员管理/归档/静音：Users/archive/mute 三入口 `!isDM` 门禁 + leave/join 一并隐藏（对齐 CONTEXT「不可加人、退订、归档、离开或静音」）；测试断言 `/Leave|Join/`、`/Archive|Unarchive/`、`/Mute notifications/`、`/Channel members/` 均不出现
4. ✅ 未读角标对 DM 生效：`listChannelsWithMeta` 已对 dm 算 unread，侧栏同渲染 badge；测试「DM channel unread badge」
5. ✅ 组件渲染测试覆盖：3 + 1 个渲染断言用例

**Standards 轴（CONTEXT 词表 + 既有风格）**：

- 术语：私信/DM、频道、成员、agent、owner 全程 CONTEXT 词表；注释简体中文、i18n 文案 en/zh 双语。✅
- UI 铁律：DM 图标用 lucide `MessageSquare`，无新增 emoji；不动 DetailPanel。✅
- 分层：纯 UI 改动（侧栏 + ChannelView 头部 + i18n + 测试），零服务层/schema/route 改动（01 票已收口服务层）。✅
- 无重复代码：行渲染提取 `ChannelRow` 组件，两组复用同一份 JSX（避免 copy-paste）。✅
- 无新增 smell：`dmAgentName`/`isDM` 均 spec R3 明确要求的窄差异点，非 speculative generality。✅
- `runChannelAction` 的 `object` → `Record<string, unknown>` 是 pi-lens 强制的类型收紧，非行为改动。✅
