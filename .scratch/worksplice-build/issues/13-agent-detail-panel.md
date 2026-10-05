# 13 — Agent 详情面板重构：中央/面板状态解耦 + 非长驻右栏 + 线程迁移

**Status:** ready-for-agent

**What to build:** 右栏从"常驻 300px 占位 + agent 详情"改为"非长驻单槽 dock"：中央（当前频道）与面板（agent | human | thread | null）状态解耦——点 agent/人类/线程只在右栏展示，中央频道消息流不再被清空；无选中时整栏消失、中央占满；面板加宽；切换频道清空面板。channel 内 thread 侧栏删除，线程迁入右栏并自带 3s 轮询；人类简介弹窗删除，人类进右栏薄卡片；左栏只高亮频道行。

## Problem Statement

用户在用 channel 时点击某个 agent 的意图是"瞄一眼它的状态/信息，然后继续留在 channel 里读消息"。但现状下这个意图无法达成：

- **点 agent = 被跳走**：`selected` 是单一联合状态（channel | agent），点击 agent 后 `selectedChannel` 变 null，中央频道消息列表被清成"请选择频道"空态。用户看完详情必须重新点频道、重新翻回原阅读位置——操作链长，打断了在 channel 里的停留。
- **右栏一直显示**：右栏常驻 300px，无选中时只显示 ● 占位符，永不消失；用户无法通过操作让它不占空间。
- **线程自成体系**：线程侧栏内嵌在 ChannelView 内部，与右栏 agent 详情是两个互不相干的侧栏；点 thread 只能在 channel 内部弹侧栏，无法与 agent 详情共用一个容器。
- **人类是模态框**：点人类成员弹出简介弹窗（阻塞式），与 agent 详情的面板式展示心智不一致。

## Solution

从用户视角，重构后：

- 中央（频道）与右栏（面板）彻底解耦：点 agent/人类/线程，详情在右栏出现，**中央频道消息流纹丝不动**。
- 右栏是非长驻单槽 dock：没选中任何东西时整栏消失（中央吃满宽度）；点击 agent/人类/线程时滑入（加宽至 ~380px）；点 X 关闭；**切换频道清空**。
- 线程迁入右栏：channel 内 thread 侧栏删除；线程在右栏打开，自带 3s 轮询——agent 在任务线程里的回复会自己冒出来。
- 人类简介弹窗删除，人类进右栏（薄资料卡片，与 agent 同一容器、同一生命周期）。
- 左栏只高亮频道行；点左栏 agent 行 = 打开右栏面板，中央频道不动。

## User Stories

1. 作为 channel 读者，我想在消息流中点 agent 名字/头像后看到它的详情，以便了解它的状态——中央频道必须保持原样，不被清空或跳转。
2. 作为 channel 读者，我想在看完 agent 详情后点 X 关闭面板，以便回到纯阅读布局——右栏整栏消失，中央占满宽度。
3. 作为 channel 读者，我想在切换频道时让右栏自动清空，以便不被上一个频道的残留详情误导。
4. 作为 channel 读者，我想点人类成员时在右栏看到资料卡片（名字/角色/描述/状态），以便不阻塞地继续浏览频道——简介弹窗删除。
5. 作为 channel 读者，我想点消息的"在线程中回复"时线程在右栏打开，以便线程不挤压 channel 消息流的阅读宽度。
6. 作为任务观察者，我想打开任务线程后 agent 在其中的回复自动出现在右栏，以便不离开线程也能看到任务进展——面板线程自带 3s 轮询。
7. 作为线程参与者，我想在右栏线程里发消息时 freshness 按线程自己的 seq 空间计算，以便并发下收到 held 提示而非静默丢消息。
8. 作为 channel 读者，我想在右栏线程打开时继续滚动中央频道消息读上下文，以便对比线程与频道内容——中央轮询继续运行。
9. 作为侧栏用户，我想点左栏 agent 行时右栏打开详情、左栏频道行仍高亮，以便始终知道"中央在看哪个频道"。
10. 作为紧凑端用户，我点击 agent 时面板滑入覆盖频道，以便与现状行为保持一致（接受不对称）。
11. 作为多查看用户，我开着 agent 详情再点一个线程时，右栏内容替换为线程，以便单槽容器不叠加。
12. 作为 agent 观察者，我在右栏看 agent 详情时其状态点实时变化（SSE 继续流入），以便观察 agent 工作过程。
13. 作为反复查看者，我关闭面板再重开同一 agent 时详情重新拉取（observability/runtime），以便看到最新数据（接受每次开关的重取成本）。
14. 作为桌面端用户，我接受开关面板时中央消息流宽度跳动（reflow），以便换取非长驻布局。
15. 作为首次进入用户，我没有选中任何东西时界面上没有右栏，以便消息流从第一像素开始就是满宽的。
16. 作为引用用户，我在右栏线程里引用消息时引用态是面板局部的，以便不与中央 composer 互相污染（接受"引用后切换目标携带"行为消失）。

## Implementation Decisions

1. **状态解耦（核心修复）**：AppShell 将单一联合 `selected` 拆为两个独立状态——`centerSelection`（channel id）与 `panelContent`（`{ kind: "agent" | "human" | "thread", id } | null`）。根因即现状联合状态：选中 agent 时 `selectedChannel` 变 null 触发中央 EmptyState。拆开后选中 agent 不再触碰中央。
2. **纯状态模块（主缝）**：新纯模块承载面板转移规则（详见 Testing Decisions）：
   - `open(state, { kind, id })` → 单槽替换（任何内容互斥）
   - `close(state)` → null
   - `onChannelSwitched(state)` → null
   - 不变式：面板内容与中央频道无耦合；线程打开时中央保持当前频道。
3. **右栏容器**：新 `DetailPanel` 容器按 kind 分派——agent → 复用现有 `AgentDetailPanel`（内容原样，仅挂载点变更）；human → 新薄资料卡（avatar/name/role/description/status）；thread → 从 ChannelView 迁移的线程面板（锚点 + 消息列表 + composer + 分页 + 引用 + 轮询）。
4. **线程迁移**：ChannelView 删除 `openThread`/`threadMessages` 状态、线程侧栏渲染、线程 composer、共享 quoting 态、held 时重拉线程逻辑（`loadThread` 随迁）；线程 freshness baseSeq 规则（`threadMessages[last].seq`）原样迁入面板 composer。
5. **面板线程轮询**：独立 3s 轮询（沿用 `INBOX_POLL_MS`），后台 tab 暂停、卸载清理、`document.hidden` 检查——复制中央轮询的纪律；与中央轮询并存为两套循环。
6. **左栏高亮**：`WorkspaceSidebar` 的 `isSelected` 只认 `centerSelection` 的频道行；agent 行取消选中态；点 agent 行回调改为"打开面板"而非"切换选中"。
7. **人类入口**：删除 `setProfileMember` 模态框路径；成员面板与 @提及点击人类 → 面板 `{ kind: "human" }`。
8. **CSS**：右栏非长驻——`panelContent` 为 null 时不渲染右栏（桌面端中央满宽）；宽度 300px → ~380px；紧凑端保持现状（`position: fixed` 滑入覆盖 + backdrop，z-index 500），桌面/紧凑不对称接受。
9. **接受代价（设计决策已签字）**：桌面开关面板中央 ±380px reflow；切 channel 清空面板（线程草稿/分页/agent 详情 in-flight 数据丢弃）；每次打开 agent 重新 fetch observability + runtime；紧凑端"覆盖跳走"行为保留。
10. **不做面板栈/历史**：单槽替换无回退；关闭即销毁，重开即重取。

## Testing Decisions

- **好测试的标准**：只测外部行为——"点了什么 → 面板变成什么"的转移、三变体各自渲染产物、线程轮询存在性与清理；不测 AppShell 内部 state 形状，不测组件间传参。
- **主缝：`lib/panel-state.test.mjs`**（node --test 纯函数，新增纯模块）：open 单槽替换（agent→thread→human 任意两两替换）、close → null、`onChannelSwitched` → null、id 透传、null 上 open 正常。先例：`lib/raft/recurrence.test.mjs` 纯解析器测试风格。
- **次缝：`components/DetailPanel.test.mjs`**（jiti + `renderToStaticMarkup`）：agent 变体渲染详情区块（复用 `AgentDetailPanel.test.mjs` 断言面）、human 变体渲染资料卡、thread 变体渲染锚点与消息；线程轮询用源码级断言（`setInterval` 存在 + 清理函数），先例 `components/ChannelView.test.mjs`（setInterval 断言）。
- **不加**：AppShell 集成测试（依赖 SSE/fetch，太重）、DOM/交互测试——交互规则已全量下沉到主缝纯模块。

## Out of Scope

- 紧凑端面板行为改造（覆盖保持现状）
- 面板 URL 深链 / 刷新持久化（面板是瞬态 UI，不进 hash）
- 面板多槽 / 堆叠 / 历史回退
- `AgentDetailPanel` 内容改动（状态/workspace/runtime/可观测性/重置区块原样保留）
- 面板开关动画 / 过渡打磨
- 中央 reflow 的缓解措施（本次接受现状）
- 线程分页增强（"加载更早"之外的能力）

## Further Notes

- **决策可逆点**：若 reflow 不可忍，可恢复空态占位窄条——只需改 CSS 与空态渲染，状态模块与容器不变。
- **轮询净收益**：现状选中 agent 时中央轮询因 `channel=null` 停止；重构后中央轮询在面板打开期间持续运行，agent 回复不因查看详情而漏刷。
- **任务流联动**：任务板卡片点击 → 右栏任务线程；任务状态变化仍由中央任务板/轮询呈现；agent 任务线程回复经面板线程轮询可见。
- **深链不变**：`#c/<channelId>?m=<messageId>` 仍只定位中央消息，不承载面板状态。
- **引用态变化**：现状 channel 与 thread 两 composer 共享单一引用态；线程迁出后引用态变面板局部——"在 channel 引用后切到线程携带引用"的行为消失，视为接受的语义变化。
- 本 spec 由 /grill-me 会话（agent 详情面板设计）产出，决策点均已与用户逐项确认。
