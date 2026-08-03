# 03 — 三栏骨架 + 马卡龙视觉 token

**What to build:** 界面骨架整体重写为 raft 式三栏（左：channel 列表（含 #all）+ agent 成员列表，创建入口在顶部；中央：channel 消息流 + Tasks tab；右：agent 详情面板），不复用 pi-web 单聊天窗口骨架；§4 视觉 token 全量落地——马卡龙色板（cream 底 / yellow 主 / bubble pink CTA / 等 12 色）、全局 0 圆角、2px ink 边框、硬偏移阴影阶梯（hover 抬起 / 按压 1px）、Space Grotesk / Hanken Grotesk / Space Mono 字体、8×8 像素头像；删除 fork/分支 UI、会话树浏览、侧栏 worktree 切换器。空状态可跑（spec §3.1、§4、§5.8 重写/删除项）。

**Blocked by:** 01

**Status:** resolved

- [x] 三栏布局按 §3.1 骨架渲染；左右栏条目与中央视图切换可用；仅亮色、不响应 prefers-color-scheme
- [x] 主题 token 与 §4.1–4.3 数值一致；边框/圆角/阴影规则按 §4.2–4.4 贯穿卡片/按钮/消息气泡/导航栏
- [x] 按钮语义正确（粉 = 行动、黄 = 当前位置）；像素头像渲染（image-rendering: pixelated）
- [x] fork/分支 UI、会话树、worktree 切换器已从 UI 移除

## Answer

- 骨架重写：`AppShell`（三栏）+ `WorkspaceSidebar`（channels + agents + 顶部创建入口）+ `ChannelView`（消息流 / Tasks tab 空态）+ `AgentDetailPanel`（§3.6 区块，重置换代占位）；删除 `SessionSidebar` / `ChatWindow` / `TabBar` / `ChatMinimap` / `BranchNavigator`。
- 视觉 token：`app/globals.css` 落 §4.1 12 色（hex/oklch 与 spec 一致）+ §4.2 0 圆角、2px ink 边框、sm/md/lg/pressed 硬阴影 + §4.3 Space Grotesk / Hanken Grotesk / Space Mono（`app/layout.tsx` next/font）；`useTheme` 恒亮色，删除深色脚本与 `prefers-color-scheme`。
- 新组件：`PixelAvatar`（8×8 确定性镜像图案，`image-rendering: pixelated`）、`StatusDot`（四态，working 黄脉冲）、`BrutalModal` + `CreateChannelModal` / `CreateAgentModal`（粉 CTA / 黄选中）。
- API：`GET/POST /api/channels`、`GET /api/channels/[id]`、`GET/POST /api/members`，服务层 `lib/raft/{channels,members}.ts`。
- 清理：删除 49 条已死 `sidebar.*` i18n key（en/zh-CN），无 fork/worktree/会话树残留引用。
- 验证：tsc 通过；eslint 通过；254 项 node --test 中 253 通过（唯一失败为 `app/api/models-config/test/route.ts` 被 node --test 因 `test/` 目录名误拾取，HEAD 上同样失败，与本 ticket 无关）；dev 服务器 + Playwright 冒烟：三栏渲染、agent 详情面板、Tasks tab、建 channel 全链路（SQLite 落库）均正常。
