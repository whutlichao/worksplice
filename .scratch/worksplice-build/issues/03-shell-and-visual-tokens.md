# 03 — 三栏骨架 + 马卡龙视觉 token

**What to build:** 界面骨架整体重写为 raft 式三栏（左：channel 列表（含 #all）+ agent 成员列表，创建入口在顶部；中央：channel 消息流 + Tasks tab；右：agent 详情面板），不复用 pi-web 单聊天窗口骨架；§4 视觉 token 全量落地——马卡龙色板（cream 底 / yellow 主 / bubble pink CTA / 等 12 色）、全局 0 圆角、2px ink 边框、硬偏移阴影阶梯（hover 抬起 / 按压 1px）、Space Grotesk / Hanken Grotesk / Space Mono 字体、8×8 像素头像；删除 fork/分支 UI、会话树浏览、侧栏 worktree 切换器。空状态可跑（spec §3.1、§4、§5.8 重写/删除项）。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 三栏布局按 §3.1 骨架渲染；左右栏条目与中央视图切换可用；仅亮色、不响应 prefers-color-scheme
- [ ] 主题 token 与 §4.1–4.3 数值一致；边框/圆角/阴影规则按 §4.2–4.4 贯穿卡片/按钮/消息气泡/导航栏
- [ ] 按钮语义正确（粉 = 行动、黄 = 当前位置）；像素头像渲染（image-rendering: pixelated）
- [ ] fork/分支 UI、会话树、worktree 切换器已从 UI 移除
