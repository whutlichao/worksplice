# 04 — 原语层与状态点/头像

**What to build:** 把上游 `ui_kits/app/app.css` 的原语 class 块搬进 `app/globals.css`：`.btn`（32px / `--surface` / `--border-strong`）/ `.btn-primary`（`--accent` 底 + 浅 ink，hover 换 `--accent-hover` 且两通道同时换）/ `.btn-ghost` / `.btn-danger` / `.btn-sm`（27px）/ `.btn:disabled{opacity:.45}` / `.icon-btn`（30px，透明边框，hover → `--surface` 填充 + `--border` 强化）/ `.is-on`（`--accent-soft` / `--accent`）/ `.badge` / `.tag` / `.input` / `.textarea` / `.select` / `.field` / `.card`（`--surface` + `--border` + `--r-md`；hover 强化边框 + `--shadow-card`）。`StatusDot.tsx` 改 `.presence.{online|working|error|offline}` 形态（7px 圆点、无 ink 边框、`working` 脉冲 1.5s 且 `reduce` 下 `animation:none`）。

**头像（D6 = 换首字 tile，产品所有者改判）**：**新建 `components/Avatar.tsx`（导出 `Avatar` 与 `AvatarSize = "sm" | "md" | "lg"`），删除 `components/PixelAvatar.tsx`**。形态照上游 `.avatar`：`--avatar-sm` 22px（`.sm`）/ `--avatar-md` 26px（默认）/ `--avatar-lg` 44px（`.lg`，圆角 `--r-md` 8px，其余 7px），`display:grid; place-items:center`，`font-weight:700`（22px 档 10px、26px 档 11px、44px 档 16px），`color:var(--fg)`，`overflow:hidden`，**无 2px ink 边框、无硬阴影、无像素图案**。内容 = 首字：`type === "human"` 显示「我」，agent 显示名称首字符（ASCII 转大写），名称为空时占位 `?`、`aria-label` 回退到 member id。底色 = `--av-0…--av-4`，人类恒 `--av-4`；取色的具体落法（有列表序号传序号、无序号传 id 入纯函数）见 spec D6 的「取色」段。

**7 个调用点逐个迁移（`grep -rn 'PixelAvatar' components/*.tsx` 的每一处）**：

| 调用点 | 新形态 | 取色参数 |
| --- | --- | --- |
| `components/WorkspaceSidebar.tsx:460`（rail 的 agent 行） | `<Avatar name={agent.name} size="sm" />` | agent 在 `agents` 列表里的序号 |
| `components/CreateChannelModal.tsx:181`（成员挑选项） | `<Avatar name={agent.name} size="sm" />` | agent 在 `agents` 列表里的序号 |
| `components/SearchView.tsx:202`（搜索命中作者） | `<Avatar name={hit.author?.name} size="sm" />` | `hit.author_id`（无列表序号）；名称 `undefined` → 占位 `?` |
| `components/ChannelView.tsx:1288`（任务 owner chip） | 有 owner → `<Avatar name={task.owner?.name} size="sm" />`；**未认领 → 不渲染头像** | `task.owner_id` |
| `components/ChannelView.tsx:910`（消息作者） | `<Avatar name={message.author?.name} size="md" />` | `message.author_id`；作者是 owner → `--av-4` |
| `components/AgentDetailPanel.tsx:708`（dock 头部） | `<Avatar name={agent.name} size="lg" />` | `agent.id` |
| `components/DetailPanel.tsx:117`（人类资料卡） | `<Avatar name={member.name} size="lg" />` | `member.type === "human"` → `--av-4` |
| `components/PixelAvatar.tsx`（模块自身） | **删除**，由 `components/Avatar.tsx` 取代 | — |

**两个可见的尺寸变化（须由容器所属票一并验收）**：消息作者头像 40 → 26px（票 05）、rail 行头像 28 → 22px（票 03），两处行高会跟着变（这是与上游逐字一致的必然结果）；其余调用点的容器分别在票 06（任务 owner chip / 未认领分支）、票 07（两处 dock 头像 44px 不变）、票 08（成员挑选项）、票 09（搜索命中行）。**迁移本身全部在本票内完成**（删除 `PixelAvatar.tsx` 与切 7 个调用点必须原子，否则中间态编译不过）。已验证 `components/*.test.mjs` 里没有任何断言提到 avatar / `PixelAvatar`，所以无测试耦合。

搬运 `.card` / `.field` / `.input` 等通用名前先 grep 一次本仓既有出现（ED-7）。

**Blocked by:** 02

**Status:** pending

- [ ] 原语 class 块落盘，`.btn-primary` hover 同时换底色与文字色通道（不降对比）
- [ ] 每个可聚焦元素有 `:focus-visible` 环；字段/composer 用 `--accent-soft` 环
- [ ] `StatusDot` 四态各取 `var(--online)` / `var(--working)` / `var(--error)` / `var(--offline)`；无 `2px solid`
- [ ] `components/Avatar.tsx` 新建；`components/PixelAvatar.tsx` 删除；`grep -rn 'PixelAvatar' components/` 为空（含 `.test.mjs`）
- [ ] `Avatar` 渲染出**首字**（agent 名首字符转大写 / 人类「我」）、`.avatar.sm|lg` 三档尺寸取自 `--avatar-sm|md|lg`、7px 圆角（`.lg` 用 `--r-md`）、`--av-*` 取色；**无** `image-rendering: pixelated`、**无** ink 边框/硬阴影
- [ ] 7 个调用点逐个迁移到位；`ChannelView:1288` 的未认领分支**不**渲染头像；`type === "human"` 恒 `--av-4`
- [ ] 渲染断言：`StatusDot` 四态 + `Avatar` 首字（新增或扩既有 `components/*.test.mjs`）
- [ ] `npm test` / `tsc --noEmit` 通过；`npm run lint` 通过

## Answer
