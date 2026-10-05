# 07-UI 信息架构简化原型

Type: prototype
Status: resolved
Blocked by:
Assignee: wayfinder-session-07

## Question

以 prototype 提升讨论保真度：针对「UI 太像 raft.build、元素太复杂」的痛点，产出信息架构简化低保真原型。

- 对比现状 `ChannelView`/`ThreadPanel`/`AgentDetailPanel`/`WorkspaceSidebar` 一次呈现的概念数，提出「渐进披露」后的三栏新布局草图（保留三栏骨架，重排层级与空状态引导，术语向非专业用户友好）
- 覆盖关键路径 `describe → hand off → let it run → review` 在新架构下的走通演示（新用户首次创建 channel/agent、发消息、看任务板、回 thread）
- 产出为可预览的静态原型（`output/index.html` 或 `docs/` 下草图 + 交互说明），调用 `prototype` skill，链接作为本 ticket 资产；结论为「采用/改动/否决」及与秘书引导的联动是否纳入

## Answer

**原型资产**：`.scratch/pi-sdk-rebuild/prototype-ui/index.html`（单文件双击即开，`?variant=a|b|c` 直达，底部悬浮条切换；零后端、纯静态）

**现状审计（E63/E65/E66/E67）**：
- `ChannelView.tsx:1-3117` 单组件承载 **11 概念/屏**：消息流(seq 分页+3s轮询) / 引用(单一 quoting) / 任务(List|Board 5列拖拽) / 提醒(header ⏰+动作栏 ⏰) / reaction(快捷4+24网格+聚合条) / pinned(Header Pin+3排序+重排) / 附件(Paperclip多选+预览) / 线程入口(右键 Open Thread→右栏) / As Task勾选 / mention(@补全) / 轮询订阅 — 是 07 重做主战场。
- `AppShell 392` 三栏骨架（centerSelection/panelContent 解耦）与 `WorkspaceSidebar 486` / `ThreadPanel 435` / `AgentDetailPanel 1025` 保留骨架，仅重排层级。

**三变体对比（同屏原型一键切换）**：

| 维度 | 变体 A · Focus Modes | 变体 B · Guided Journey ⭐ | 变体 C · Minimal + Drawer |
|---|---|---|---|
| 中央一次呈现概念数 | **3**（Discuss/Track/Review 三档，每档 3–4） | **4**（消息流为主）+ 旅程条 + 空状态卡，reaction/pinned/附件收进「···」二级 | **2**（仅消息流+Composer），余下全进抽屉 |
| 任务板可达性 | Track 全屏独占，消息与任务互斥聚焦，符合“任务是主实体” | 保留 中央 Tab（Discuss/任务），有任务时 Tab badge 引导切换，不与消息争抢首屏 | 抽屉内需一次点击才见，发现性差 |
| 关键路径 `describe→hand off→let it run→review` | 三模式隐式对应但无显式引导 | **旅程条 4 步常显 + 强空状态卡**（无消息→“描述任务”；有消息无任务→“转为任务 @Atlas 交接”；任务进行中→“让它跑”看状态点；待审核→“去复核”） | 路径被抽屉藏起，需探索 |
| 术语友好 | Discuss/Track/Review 更通用 | 保留 channel/任务但文案口语化（讨论/跟踪/复核）+ 秘书口吻 | 同 B |
| 改造成本 | 中高（ChannelView 拆 3 视图+状态机） | **低**（在现有三栏+76路由薄封装上加旅程条+空状态+折叠） | 中（抽屉手势+覆盖层） |
| 与秘书联动 | Review 可加秘书总结 | **首访空状态首卡即秘书入口**：“让秘书帮你搭第一间房”一键走 `initSecretaryFlow` 五步（建频道+建 agent+发首条消息闭环） | 同 B |

**走通演示（原型内可点 toast 演示）**：
1. 新用户首访无频道/成员 → 左栏“+频道/+成员” + 中央空状态“让秘书搭第一间房” → 秘书五步流完成建 #all+首个 agent。
2. 发消息（Composer 支持 @提及/引用 chip/附件≤50MB/As Task 勾选）→ 消息落流。
3. 看任务：消息“转为任务”（顶层可转，thread 内不可）→ 任务板（List|Board 拖拽即状态转移，服务端 `reachable` 裁决，不乐观移动）。
4. 回 thread：锚点 `#seq` 角标 `↳ N` 点击 → 右栏 `ThreadPanel` 单槽打开，composer 局部 quoting，3s 轮询；pinned/reaction 在 thread 内同样可用。

**结论：采用 B，A 为演进方向，C 否决；秘书联动纳入首版。**
- **采用 B 首版**：在保留 `Next.js+Tailwind brutalist` 基建与单机单进程部署前提下，以最低成本将 11→≤4 概念/视图，且把 `describe→hand off→let it run→review` 做成可见进度；`ChannelView` 不拆文件，仅加旅程条/空状态/折叠，`06 目标架构` 的深模块切分不受阻。
- **A 为二期方向**：待 `06 目标架构` 将 `ChannelView` 拆为 `DiscussView/TrackView/ReviewView` 三个深模块时一并落地，届时 `lib/panel-state.ts` 单槽模型同步演进。
- **C 否决**：把任务藏进抽屉违背 `spec §3.7 任务是协作主实体` 定位。
- **秘书联动纳入**：首访与空频道均以秘书为默认引导，文案与 `spec-bootstrap-agent.md` 一致；不新增路由，仅在空状态卡片与旅程条第1步挂入口。

**对后续票据输入**：
- 06 目标架构：首版不拆 `ChannelView` 文件，仅在规格中记“B 首版 + A 二期”；深模块清单需为 `Discuss/Track/Review` 预留拆分点，`lib/panel-state.ts` 保持单槽。
- 08 迁移：零数据迁移，仅前端呈现调整，无 SCHEMA 影响。
- 09 spec 形态：`spec-rebuild.md` §3 用户体验章以 B 为基线，A 记为“演进”附录，附原型链接与对比表。

> 资产分支：原型文件置于 `.scratch/pi-sdk-rebuild/prototype-ui/`（throwaway），非 `output/` 发布件；验证为 `open prototype-ui/index.html` 双击预览。
