# Agent 头像色选择与一致呈现（规格）

日期：2026-10-11 · 来源：`.scratch/agent-avatar-color/issues/01-agent-avatar-color.md`（Type: grilling，已 resolved）。

性质：**可实施规格**；本文件记录经产品所有者确认的可观察行为与实现约束，供后续实施工作使用。本票只细化规格，不包含源码改动。

## Problem Statement

产品所有者原话：**「给 agent 详情页里增加一个头像颜色选择器，选择后同步更改 agent 所有的颜色，不限于左侧 menu tree，session中」**。

当前头像由 `components/Avatar.tsx` 渲染，消费 `--av-0…--av-4` 五格；agent 的稳定 member ID 确定性映射至前四格，人类固定使用第五格中性颜色。agent 详情面板目前没有头像色选择器，也没有可覆盖自动取色的持久设置。

头像色不只出现在左侧成员列表。当前 agent 身份头像还出现在 agent 详情、频道与线程消息作者、任务 owner、建频道成员选项及搜索结果等呈现面；同一个 `MessageRow` 同时承载频道与线程消息。HumanProfileCard 也使用 Avatar，但只呈现 human。独立 Pi session transcript 由 `MessageView` 呈现，现状没有 Avatar，因此将头像放入 agent transcript 是这项需求要求新增的呈现，不是已有头像的单纯重着色。

“session中”的归属必须精确：成员的 `pi_session_file` 是当前能够将 transcript 文件关联到 agent 的事实；workspace/cwd 可以共享，仅凭目录不能推断 session 的作者身份。产品所有者确认只为 transcript 文件与该 agent 的 `pi_session_file` 精确对应的 Pi session 显示 agent 头像。

用户还需要在 Agent 详情右栏直接浏览该成员当前登记的 Pi session transcript。现有“会话导出”仍保留；transcript 以旁侧可展开区只读呈现，不提供会话操作或分支切换。

## Solution

### 已确认决策

| 决策 | 裁决 | 来源与理由 |
| --- | --- | --- |
| D1 色域 | 只开放现有四个 agent 色格 `av-0…av-3`；`av-4` 保留给 human，不支持任意色值或新增色 | Q1 人定：沿用现有五格约定，避免扩大色板；agent 不占用 human 中性格 |
| D2 颜色语义 | 选择只改变身份 Avatar tile 的底色；status dot、任务状态色、作者名字色、按钮与主题语义色不变 | Q2 人定：用户要求的是头像色跨面一致，不是改造全部 agent 相关颜色 |
| D3 协作呈现面 | 全部代表 agent 身份的现有 Avatar 使用当前头像色：侧栏、详情、频道/线程消息、任务 owner、成员选择与搜索等 | Q2 人定：不能收窄到左侧 menu tree；历史消息按当前成员身份呈色，不冻结旧色 |
| D4 Pi session 呈现面 | Agent 详情右栏在现有“会话导出”旁提供可展开的 transcript viewer；票 05 实现只读查看，票 04 仅为精确归属 agent 的 assistant 消息显示其 Avatar，普通 human session 不加 | Q3 人定：原话明确包含 session 呈现；viewer 入口与行为由本次确认 |
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

### Transcript 查看行为

- Agent 详情右栏在现有“会话导出”入口旁提供 transcript 展开区。只展示该成员当前 `pi_session_file` 精确指向的单个 Pi session；没有登记文件或登记文件已不存在时显示空态。不得从 workspace、cwd、project root、相同 basename、分叉关系或文件名推断归属，也不列出或切换其它 session。
- 展开区只读呈现该 Pi session **当前分支路径**上的消息，涵盖现有 Pi 消息类型（包括 user、assistant、tool/custom、compaction 等）。不提供编辑、回复、工具执行、分支切换或其它写入操作；头像色与消息内容均不写入 Pi 文件。
- 一次展开/打开建立当前分支的文件快照；手动刷新或关闭后重新展开时读取新快照。不会 SSE/流式实时跟随新消息。分页继续读取本次快照，避免同一次查看期间消息追加造成重复或遗漏；刷新建立新快照并重置分页位置。
- 首次载入当前分支最新的 100 条消息；用户可向前加载更早消息，直至浏览完整个当前分支。每页以当前分支路径中的位置作为连续边界，较早消息按时间顺序插入列表，不重复、不跳过；到达该分支最早消息后停止提供“加载更早”。
- 展开区有高度上限并在内部滚动，约 `50vh` 作为设计建议而非固定产品承诺；小屏适配及现有面板/设计 token 若要求更合适的高度，由实现保持可用性。
- 未登记 session、登记文件缺失或文件/当前分支为空时显示明确空态；读取或解析失败显示与空态不同的错误状态。提供手动刷新入口，以便用户重试。加载、空态、错误态均留在详情展开区中，不替换现有会话导出入口。

### 呈现范围矩阵

| 呈现面 | 头像色行为 |
| --- | --- |
| `WorkspaceSidebar` agent 行、`AgentDetailPanel` 头像 | 使用当前 agent 头像色；详情面板另提供选色入口 |
| 频道与线程消息作者、任务卡片 owner | 使用作者/owner 当前头像色；历史消息与新消息一致 |
| 建频道成员选项、搜索命中作者、其他 agent 身份 Avatar | 使用同一当前头像色，不依赖该处列表序号 |
| Agent 详情 transcript viewer | 仅显示该成员当前 `pi_session_file` 所指向的单一 session 当前分支；assistant 消息仅在票 04 的精确归属契约下显示该 agent 当前 Avatar 色，user/tool/custom 等消息不显示该 agent Avatar |
| HumanProfileCard、人类作者及普通 Pi session | 保持既有 human 中性色或既有普通 session 呈现，不受 agent 选色影响 |
| status dot、任务状态、作者名字文字、主题与其他非 Avatar 颜色 | 保持其原有语义色，不随头像色变化 |

### 持久数据语义

后续实现应将显式选色作为 agent 身份的可空属性保存：空值代表沿用现有 ID 确定性默认，显式值代表选中的四格之一。存储的是现有色格选择而非任意色值，因此视觉 token 仍由现有色板提供。头像色不复制进消息或 Pi session 文件；协作消息和 Pi transcript 的归属判定分别依赖现有作者身份及精确 `pi_session_file` 关联。

## User Stories

1. 作为 agent 管理者，我可以从 agent 详情选择 `av-0…av-3`，并在保存成功后看到该 agent 的所有身份 Avatar 呈现同一色格。
2. 作为新建 agent 的使用者，我看到它按稳定 member ID 使用自动默认色，无需先设置头像色。
3. 作为既有 agent 的使用者，升级后仍看到相同的 ID 自动默认色；我可以覆盖该默认，也可以清除覆盖恢复自动色。
4. 作为查看侧栏、详情、频道/线程消息作者、任务 owner、建频道成员选项或搜索结果的人，我看到同一 agent 使用一致的当前头像色，历史消息也随当前身份色更新。
5. 作为使用 agent Pi session 的人，我能在精确归属该 agent 的 transcript 中从 assistant 消息旁辨认该 agent；普通 human session、同 cwd 但文件不同及无明确归属的 session 不出现 agent Avatar。
6. 作为 agent 管理者，我可以让多个 agent 使用相同色格，不会遇到颜色被占用而不可选择。
7. 作为 agent 管理者，我点击色格后无需额外保存；成功后各处呈现同步更新，失败时旧色保持且我能看到失败提示。
8. 作为 agent 管理者，我在重载、Restart、Session reset、Full reset、换 workspace 或改名后仍保留身份头像色。
9. 作为使用状态点、任务状态或其他颜色语义的人，我看到这些颜色仍表达原有含义，不受头像色选择影响。
10. 作为 agent 管理者，我可以在详情右栏“会话导出”旁展开 transcript，在同一处只读查看 agent 当前登记 session 的当前分支。
11. 作为 transcript 使用者，我首次展开能看到当前分支最近 100 条消息，并可逐页加载更早消息，直到该分支的起点。
12. 作为 transcript 使用者，我可以手动刷新，或关闭后重新展开以读取文件新快照；查看期间不会误以为内容是实时流式更新。
13. 作为 transcript 使用者，若成员没有登记 session、登记文件不存在或当前分支为空，我会看到明确空态；读取失败时会看到独立的错误状态并可刷新重试。
14. 作为 transcript 使用者，我只能浏览当前分支路径，不能编辑/回复、执行工具、切换分支，也不会看到通过目录或文件名猜测关联的其它 session。

## Implementation Decisions

1. **头像色属于 agent 身份**：成员身份持久数据保存 nullable 的受限色格索引（`0…3`）；`null` 表示按稳定 member ID 使用既有自动默认，显式索引表示 override。写入只接受 `null` 或整数 `0…3`，不保存任意 CSS 色值。新建及既有 agent 的 `null` 均沿用相同默认映射；清除 override 即恢复该映射。
2. **成员身份是唯一读写 seam**：详情页色格点击即调用专用成员写入 interface，以索引更新或以 `null` 清除 override。成功后返回/刷新共享的规范成员身份数据，既有身份 Avatar 呈现据此更新；任何展示位置都不复制独立色值或把颜色快照写进消息。写入失败时不乐观改动已保存身份值，保留旧色并提示失败。重复色格始终可选。
3. **Pi session 归属由成员读取 seam 决定**：公开 GET handler 以 member ID 取数，不接受调用方提供的任意文件路径；服务端只查该成员当前 `pi_session_file`，并对完整路径按同一规范化规则处理后精确相等。不得以 cwd、workspace、project root、文件名、分叉关系或展示顺序推断归属，也不扫描目录寻找替代文件。只有当前登记文件可作为该成员 transcript 的来源。
4. **Pi transcript 只为 assistant 呈现身份 Avatar**：票 05 的 transcript viewer 展示当前分支路径上的现有消息类型；在其产品 markup 中，只有票 04 所定义的精确归属 assistant 消息呈现 agent Avatar。user、tool、custom、compaction 等非 assistant 消息不加该 Avatar。身份色从当前成员身份读取；不把归属或头像色快照附到单条消息。
5. **颜色语义保持局部**：选择只改变 agent 身份 Avatar tile 的底色。human 固定使用 `av-4`；status dot、任务状态、作者名、human Avatar、主题及其他语义色不变。既有色板与默认映射不扩展或重排。
6. **身份生命周期不变**：头像色随 agent 身份保留，跨应用重载、Restart、Session reset、Full reset、换 workspace 与改名不变；Pi jsonl 只读，不写入或重写该文件，不更改其中任何消息内容。
7. **不新建 ADR**：本规格落实已确认的身份外观契约，不改变既有色板、作者归属或 Pi session 文件所有权，没有新增需要 ADR 记录的架构裁决。
8. **Transcript 入口与只读语义**：Agent 详情右栏在“会话导出”旁展开 viewer；既有导出保持不变。viewer 仅加载成员当前精确登记的一个 session，不接受任意路径，不提供编辑、回复、工具执行或分支切换。
9. **当前分支与快照分页**：只读取 Pi session 当前分支路径。每次展开/打开或手动刷新建立新快照；同一快照初始显示最新 100 条，加载更早沿当前分支路径向前连续分页，按时间顺序呈现且无重漏，直至分支起点。关闭后重开也读取新快照；不做 SSE/流式跟随。
10. **空间与状态呈现**：展开区高度受限并内部滚动，约 `50vh` 是建议值；适配小屏和现有面板/设计 token。无 `pi_session_file`、文件缺失或空分支显示明确空态；读取/解析错误显示独立错误态并可手动刷新重试。
11. **实施票分工**：票 05 交付详情 viewer、精确成员取数、安全读取和当前分支分页；票 04 仅在票 05 的 viewer 产品 markup 中消费其精确归属结果，为 assistant 消息呈现当前 Avatar，不重复实现读取与分页。

## Testing Decisions

本规格票没有源码改动，按票面不运行测试、typecheck、lint、双轴 code-review 或真浏览器检查。后续实现应测试外部可观察行为，不将断言绑定到内部状态形状或具体调用顺序；优先复用现有成员读写、session 详情读取及 Avatar 呈现 seam。先例方向包括成员生命周期持久性测试、session-reader 路径/详情测试，以及消息流中身份呈现测试。

- **模块与 prior art**：覆盖成员身份持久读写、agent 详情选色、共享 Avatar 呈现，以及 Pi session 详情归属和 transcript 呈现。可参照 `lib/agent-lifecycle.test.mjs` 的身份生命周期行为、`lib/session-reader.test.mjs` 的 session 路径/详情行为，以及 `components/message-stream.test.mjs` 的消息呈现行为。
- **默认与索引约束**：新建和既有 agent 在 `null` 时均按 member ID 映射到 `av-0…av-3`；整数 `0…3` 各自可写入并持久化，`null` 清除覆盖。负数、非整数、超范围值及任意字符串均不能成为持久色格值；human 始终为 `av-4`。
- **交互与失败**：点选立即提交，成功后侧栏、详情、频道/线程作者、任务 owner、成员选项及搜索等所有身份 Avatar 同步呈现；重复色格可选。写入失败时原值仍呈现且错误可见，不出现未保存的新色；恢复自动后回到同一 member ID 默认色。
- **身份持久性**：重载、Restart、Session reset、Full reset、换 workspace 与改名后仍使用身份当前色；身份 Avatar 不依赖列表序号。历史消息按当前作者身份色呈现，不因选色改变消息内容或作者关系。
- **Pi 精确归属**：session 详情读取对规范化后的完整路径作精确相等匹配；命中才附带 agent 身份信息。同 cwd 但 session 文件不同、同名但路径不同、仅有分叉关联及无归属的 session 均不匹配。命中时只有 assistant 消息显示 Avatar，非 assistant 消息不显示；不匹配时全 transcript 不显示 agent Avatar。
- **Transcript viewer 行为**：在实际 `AgentDetailPanel` 中验证展开、手动刷新、加载更早、关闭后重开；公开 GET handler 以 member ID 取数，只读取该成员当前 `pi_session_file`，请求不接受任意路径。验证当前分支快照首屏最多 100 条、较早页的连续边界/顺序/去重/终点，以及多种现有消息类型的呈现。无登记、缺失文件、空文件/空分支及读取/解析错误分别呈现明确空态或错误态；展开区限制高度并内部滚动。
- **Avatar 与 viewer 分工**：票 04 在实际 transcript viewer 产品 markup 验证仅精确关联 agent 的 assistant 消息有当前 Avatar 色；user/tool/custom/compaction 等均无 agent Avatar，human 与未关联 transcript 不新增 agent Avatar。头像色选择不写 Pi 文件或消息。若服务端以成员当前 `pi_session_file` 保证归属，测试验证公开的 member-ID GET 契约，不额外制造通用任意 path 参数。
- **语义与文件不变**：头像色更新不改 status dot、任务状态、作者名、human Avatar、主题或其他非 Avatar 语义；不向消息记录或 Pi jsonl 写入头像色/归属快照。

## Out of Scope

- 任意颜色输入、颜色吸管、扩充/重画五格头像 palette、把 human 中性格开放给 agent。
- 为 agent 强制分配唯一颜色、将颜色作为身份唯一凭证，或因重名/色盲另做成员识别体系。
- 修改 status dot、任务状态色、作者姓名颜色、角色语义色、按钮、主题、全局 token 或视觉方向。
- 改 human 头像、头像字形、姓名、角色、消息内容、消息作者、reaction、任务或其他业务行为。
- 将头像色写入消息历史或 Pi session 文件；按 cwd 把无明确归属的 transcript 推断为 agent session；为 workspace 下的全部历史/分叉 session 追溯归属。
- 浏览或切换非当前分支/其它 session；从 workspace、cwd、project root、basename 或分叉关系回退推断 transcript；对 transcript 实时流式跟随；编辑、回复或执行 transcript 中的工具。
- 本票源码实现、测试执行、实现票拆分、to-spec/to-tickets 流程或 ADR。

## Further Notes

### 现状证据与归属规则

- `components/Avatar.tsx`：`--av-0…--av-4` 五格；human 固定第五格，agent 字符串 member ID 映射前四格；数字 key 是显式色格索引。调色板取值与对比度沿用已确认的 `.scratch/macaron-palette/spec.md` D8，不在本设计重开。
- 当前 Avatar 消费面至少包括 `WorkspaceSidebar`、`AgentDetailPanel`、`ChannelView` 的消息/任务卡片、`ThreadPanel` 复用的 `MessageRow`、`CreateChannelModal`、`SearchView` 与 `DetailPanel` 中仅供 human 使用的 `HumanProfileCard`。
- Pi transcript 由 `MessageView` 的 `UserMessageView` / `AssistantMessageView` 呈现，现状没有 Avatar；人类消息维持原呈现，新增头像只代表精确归属 agent 的 assistant 消息。
- agent 可共享 workspace，因此 cwd 不是身份归属。只把精确 `pi_session_file` 关联作为 Pi transcript 身份来源；没有该关联时宁可不加头像，不做猜测。
- transcript viewer 读取和分页独立于票 04 的 Avatar 专项：票 05 管理详情入口、成员 ID 取数、当前分支快照与向前分页；票 04 只消费 viewer 中的精确归属身份。
- 首屏 100 条与后续“加载更早”基于同一当前分支快照；手动刷新或关闭后重新展开才读取新快照并重置分页。约 `50vh` 是布局建议，不锁定跨设备固定像素高度。
- 领域术语“头像色”已 inline 添加至 `CONTEXT.md`。未发现需要新 ADR 的决策；实现状态字段是常规成员身份扩展，不改变已有数据所有权架构。

### 本规格收敛

本文件保留已 resolved 的 D1–D10，不重开头像色产品决策；本次补充的 transcript 查看行为由票 05 实现，精确归属 assistant Avatar 仍由票 04 单独消费。实施 seams 为成员身份持久读写、member-ID transcript 读取/分页与 viewer 内身份 Avatar 呈现。规格 tracker 文件保持本地 Markdown 形态，不添加 `ready-for-agent`；实施工作按此规格验证外部行为。无待定占位，也不新增 ADR。
