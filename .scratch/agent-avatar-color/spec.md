# Agent 头像色选择与一致呈现（设计票）

日期：2026-10-11 · 来源：`.scratch/agent-avatar-color/issues/01-agent-avatar-color.md`（Type: grilling，已 resolved）。

性质：**设计契约**；本文件记录经产品所有者确认的可观察行为，供后续实现工作使用。本票只做需求对齐与设计，不包含实现、拆票或源码改动。

## Problem Statement

产品所有者原话：**「给 agent 详情页里增加一个头像颜色选择器，选择后同步更改 agent 所有的颜色，不限于左侧 menu tree，session中」**。

当前头像由 `components/Avatar.tsx` 渲染，消费 `--av-0…--av-4` 五格；agent 的稳定 member ID 确定性映射至前四格，人类固定使用第五格中性颜色。agent 详情面板目前没有头像色选择器，也没有可覆盖自动取色的持久设置。

头像色不只出现在左侧成员列表。当前 agent 身份头像还出现在 agent 详情、频道与线程消息作者、任务 owner、建频道成员选项及搜索结果等呈现面；同一个 `MessageRow` 同时承载频道与线程消息。HumanProfileCard 也使用 Avatar，但只呈现 human。独立 Pi session transcript 由 `MessageView` 呈现，现状没有 Avatar，因此将头像放入 agent transcript 是这项需求要求新增的呈现，不是已有头像的单纯重着色。

“session中”的归属必须精确：成员的 `pi_session_file` 是当前能够将 transcript 文件关联到 agent 的事实；workspace/cwd 可以共享，仅凭目录不能推断 session 的作者身份。产品所有者确认只为 transcript 文件与该 agent 的 `pi_session_file` 精确对应的 Pi session 显示 agent 头像。

## Solution

### 已确认决策

| 决策 | 裁决 | 来源与理由 |
| --- | --- | --- |
| D1 色域 | 只开放现有四个 agent 色格 `av-0…av-3`；`av-4` 保留给 human，不支持任意色值或新增色 | Q1 人定：沿用现有五格约定，避免扩大色板；agent 不占用 human 中性格 |
| D2 颜色语义 | 选择只改变身份 Avatar tile 的底色；status dot、任务状态色、作者名字色、按钮与主题语义色不变 | Q2 人定：用户要求的是头像色跨面一致，不是改造全部 agent 相关颜色 |
| D3 协作呈现面 | 全部代表 agent 身份的现有 Avatar 使用当前头像色：侧栏、详情、频道/线程消息、任务 owner、成员选择与搜索等 | Q2 人定：不能收窄到左侧 menu tree；历史消息按当前成员身份呈色，不冻结旧色 |
| D4 Pi session 呈现面 | 在属于 agent 的 Pi session transcript 中为 assistant 消息显示其 Avatar；普通 human session 不加 | Q3 人定：原话明确包含 session 呈现 |
| D5 Pi session 归属 | 仅 transcript 文件与该 agent 的 `pi_session_file` 精确对应时显示头像；普通 session、仅 cwd 相同的 session、无明确归属的历史/分叉文件不显示 | Q8 人定：workspace/cwd 可共享，不能据目录推断身份，避免误标 |
| D6 持久性 | 头像色属于 agent 身份，跨应用重载、Restart、Session reset、Full reset、换 workspace 与改名保留 | Q4 人定：它是身份外观，不是会话或工作区属性 |
| D7 自动默认与恢复 | 既有和新 agent 默认沿用 member ID 确定性取色；用户显式选色才覆盖；提供“自动/恢复默认”清除覆盖并回到自动色 | Q5 人定：存量外观不变，覆盖可以撤销 |
| D8 重复使用 | 不同 agent 可选同一色格，不因其他 agent 已选而禁用 | Q6 人定：色格仅四个、agent 数量不限，色彩不是唯一身份标识；自动取色本来也可能同色 |
| D9 提交行为 | 点击色格即保存；成功后所有该 agent 头像呈现同步更新，不需要额外 Save；失败保留旧色并提示 | Q7 人定：符合“选择后同步更改”，避免草稿状态造成误解 |
| D10 领域术语与 ADR | `CONTEXT.md` 采用“头像色（Avatar Tint）”；本设计不新增 ADR | Q9 人定冻结：头像色只指身份头像 tile 底色；没有同时满足难逆、意外且有真实权衡的架构裁决 |

### 颜色选择行为

- agent 详情面板提供四个既有 agent 色格的选择入口，并呈现当前实际色格；颜色名称/无障碍名称应与色格对应，不能只靠颜色本身表达当前选择。
- 初始值为当前 member ID 确定性默认色；选择色格后即提交为该 agent 的持久覆盖。提供“自动/恢复默认”入口，清除覆盖并回到相同的确定性默认色。
- 多个 agent 可以选同一个色格；即使其他 agent 已使用该色，所有选项仍可选。颜色不用于保证成员可区分性，姓名与其他身份信息继续承担该职责。
- 保存成功后，任何显示该 agent 的 Avatar 都消费当前身份色；已有频道/线程历史消息同样随作者身份的当前颜色呈现，不改消息作者或消息内容。保存失败时不谎报新色已生效，保留此前颜色并向用户说明失败。

### 呈现范围矩阵

| 呈现面 | 头像色行为 |
| --- | --- |
| `WorkspaceSidebar` agent 行、`AgentDetailPanel` 头像 | 使用当前 agent 头像色；详情面板另提供选色入口 |
| 频道与线程消息作者、任务卡片 owner | 使用作者/owner 当前头像色；历史消息与新消息一致 |
| 建频道成员选项、搜索命中作者、其他 agent 身份 Avatar | 使用同一当前头像色，不依赖该处列表序号 |
| Pi session `MessageView` assistant 消息 | 仅 session 文件精确匹配 agent 的 `pi_session_file` 时显示该 agent 头像；该文件中的历史与后续 assistant 消息均使用身份当前色 |
| HumanProfileCard、人类作者及普通 Pi session | 保持既有 human 中性色或既有普通 session 呈现，不受 agent 选色影响 |
| status dot、任务状态、作者名字文字、主题与其他非 Avatar 颜色 | 保持其原有语义色，不随头像色变化 |

### 持久数据语义

后续实现应将显式选色作为 agent 身份的可空属性保存：空值代表沿用现有 ID 确定性默认，显式值代表选中的四格之一。存储的是现有色格选择而非任意色值，因此视觉 token 仍由现有色板提供。头像色不复制进消息或 Pi session 文件；协作消息和 Pi transcript 的归属判定分别依赖现有作者身份及精确 `pi_session_file` 关联。

## User Stories

1. 作为产品所有者，我能从 agent 详情面板选择现有四种 agent 头像色之一，并在成功保存后立即看到该 agent 在应用各身份头像位置呈现同一色格。
2. 作为查看旧频道/线程消息或搜索结果的人，我看到同一个 agent 的历史头像随当前身份头像色一致呈现，而消息内容与作者身份不变。
3. 作为使用 agent Pi session 的人，我能在该 agent 当前绑定的 Pi transcript 的 assistant 消息旁辨认同一头像；普通人类 session 和不能精确归属的其他 session 不被误标。
4. 作为使用既有 agent 的人，升级后 agent 仍保留原有 ID 默认色；我可以显式换色，也可以随时恢复自动默认。
5. 作为有多个 agent 的人，我可以让不同 agent 使用同一个色格，不会遇到被占用而无法选择的颜色。
6. 作为使用状态点、任务板或其他颜色语义的人，我仍看到这些颜色表达其原有状态，不会因修改 agent 头像色而变义。
7. 作为操作选色器的人，我点击后无需再提交一次；若保存失败，旧色继续生效且失败可见。

## Implementation Decisions

1. **选择入口归 AgentDetailPanel**：符合原始需求；选择作用于持久 agent 身份，而非只改详情面板的局部呈现。
2. **持久字段表达 override**：在 agent 身份记录上保存 nullable 的色格标识；空值继续走稳定 member ID 默认映射，重置“自动”即清除此 override。使用色格标识，不落盘任意 CSS 色值。
3. **统一读取当前成员颜色**：现有协作消息作者与 agent 列表消费同一 Member 身份数据，所有 Avatar 呈现以当前 agent 属性为准，不在各调用点复制颜色值，也不把颜色快照写进历史消息。
4. **Pi transcript 只认精确文件归属**：`MessageView` 仅在当前文件路径与某一 agent 的 `pi_session_file` 精确对应时取得该成员身份。不得按 session cwd、project root、文件名或展示顺序猜测。匹配失败时按普通 session 呈现，不加 agent 头像。
5. **Pi session 文件只读**：头像是展示层身份信息，不写入或重写 Pi jsonl，也不更改 assistant/user/tool message 内容。
6. **选中即提交**：点色格后保存；成功时刷新共享成员数据，使所有当前应用呈现消费新值。失败不乐观覆盖身份数据，保留当前已保存色并显示错误。
7. **不新建 ADR**：这是用户直接要求的、局限于单个身份属性的视觉契约；既有 palette、消息作者模型、Pi session 文件所有权均不改变。没有需要通过 ADR 保存的难逆、反直觉的架构权衡。

## Testing Decisions

本设计阶段没有源码改动，按票面不运行测试、typecheck、lint、双轴 code-review 或真浏览器检查。后续实现阶段应以产品渲染与持久数据行为验证本契约，最低覆盖：

- 默认/显式选色/恢复自动分别渲染预期的 `av-0…av-3`，human 始终为 `av-4`；同一 agent 的侧栏、详情、频道消息、线程回复、任务 owner、成员选择及搜索结果同色。
- 选择成功后各身份头像消费同一新值；旧消息仍按当前作者身份呈色。保存失败时旧值仍在，且用户获得失败提示。
- 重载及 Restart、Session reset、Full reset、换 workspace、改名后所选色仍与 agent 身份绑定；恢复自动后回到 ID 确定性默认。
- 两个或更多 agent 可选择相同色格。
- Pi transcript 仅在精确命中对应 agent 的 `pi_session_file` 时为 assistant 消息显示头像；cwd 相同但文件不匹配、普通 human session 与无归属历史/分叉文件不显示 agent 头像。
- status dot、任务状态、作者名、human Avatar、普通 session 及消息正文/作者关系均保持原语义。

## Out of Scope

- 任意颜色输入、颜色吸管、扩充/重画五格头像 palette、把 human 中性格开放给 agent。
- 为 agent 强制分配唯一颜色、将颜色作为身份唯一凭证，或因重名/色盲另做成员识别体系。
- 修改 status dot、任务状态色、作者姓名颜色、角色语义色、按钮、主题、全局 token 或视觉方向。
- 改 human 头像、头像字形、姓名、角色、消息内容、消息作者、reaction、任务或其他业务行为。
- 将头像色写入消息历史或 Pi session 文件；按 cwd 把无明确归属的 transcript 推断为 agent session；为 workspace 下的全部历史/分叉 session 追溯归属。
- 本票源码实现、测试执行、实现票拆分、to-spec/to-tickets 流程或 ADR。

## Further Notes

### 现状证据与归属规则

- `components/Avatar.tsx`：`--av-0…--av-4` 五格；human 固定第五格，agent 字符串 member ID 映射前四格；数字 key 是显式色格索引。调色板取值与对比度沿用已确认的 `.scratch/macaron-palette/spec.md` D8，不在本设计重开。
- 当前 Avatar 消费面至少包括 `WorkspaceSidebar`、`AgentDetailPanel`、`ChannelView` 的消息/任务卡片、`ThreadPanel` 复用的 `MessageRow`、`CreateChannelModal`、`SearchView` 与 `DetailPanel` 中仅供 human 使用的 `HumanProfileCard`。
- Pi transcript 由 `MessageView` 的 `UserMessageView` / `AssistantMessageView` 呈现，现状没有 Avatar；人类消息维持原呈现，新增头像只代表精确归属 agent 的 assistant 消息。
- agent 可共享 workspace，因此 cwd 不是身份归属。只把精确 `pi_session_file` 关联作为 Pi transcript 身份来源；没有该关联时宁可不加头像，不做猜测。
- 领域术语“头像色”已 inline 添加至 `CONTEXT.md`。未发现需要新 ADR 的决策；实现状态字段是常规成员身份扩展，不改变已有数据所有权架构。

### 交付内容

本设计交付仅为本目录 `spec.md`、本目录 `issues/01-agent-avatar-color.md` 与根目录 `CONTEXT.md`。不修改应用源码、测试、设计系统色值、现有 ADR 或其他 `.scratch` effort。所有用户决策与共同理解冻结记录在 issue 的 Answer 中；设计树无待决 frontier。
