## Problem Statement

创建 Task 时，系统会在所属 Channel 主序列中写入一条任务创建事件消息，并用它唤醒频道内的 agent，使其看见可认领任务。Task 本身仍锚定于创建前已有的顶层消息；任务进展写在该锚点的 thread。当前事件消息在 Channel 流中容易被看成普通 Owner 消息，Task 锚点又没有稳定标识，普通消息、创建事件与 Task 讨论因此难以区分。

Owner 目前只能从 Channel 侧栏的顶层消息未读数发现普通消息。Task thread 以锚点消息为独立 target，拥有独立 seq；打开 Channel 不代表读过其中多个 Task thread。随着同一 Channel 中的 Task 增多，单靠逐条翻找锚点无法定位新回复，也无法从侧栏看出有多少 Task 讨论仍未读。

本设计为任务创建事件、Task 锚点和 Task thread 未读分别定义清晰呈现与已读语义，并为大量 Task thread 提供可筛选、可排序的入口。

## Solution

- 任务创建事件保留在 Channel 主序列并继续承担 agent 唤醒作用；在人类视图中呈现为静态、低强调度的系统信息，不提供 hover / pop action、点击、链接、键盘停靠点或「转为任务」动作。
- 原始顶层消息作为唯一 Task 锚点，常驻显示 Task 编号与状态，并提供「打开任务讨论」入口。新回复数作为锚点上的次级未读标记；入口即使在零回复时也存在。
- 侧栏分别呈现普通 Channel 未读消息数与有未读回复的 Task 数。选中 Channel 后，未读 Task 数仍显示；点入 Channel 不会清除 Task thread 未读。
- Channel 内增加明确的「未读任务讨论 N」入口，打开现有 Task View 的未读筛选。未读筛选沿用 List / Board 的状态分组，按最新未读 thread 回复时间排序，任务卡片可直接打开对应 thread。
- Task thread 的已读位置按 Owner、按 Task 独立持久保存。打开一个 thread 只清该 thread；查看总览不会清未读；其他 Task thread 的未读不受影响。

视觉沿用现代简约 + 暖奶霜马卡龙视觉契约：事件提示使用既有中性色表面，Task 标识与未读计数使用现有状态和未读角色色，不新增色族、不改变圆角、边线、字体或全局导航。信息同时通过文字、无障碍名称和焦点样式表达，不靠颜色单独传意。

## User Stories

- 作为 Owner，我在把消息转成 Task 后能看见已创建的提示，但不会误以为提示是可回复消息或再次转 Task 的目标。
- 作为 Owner，我能在 Channel 消息流中快速扫出 Task 锚点，并从常驻入口直达它的讨论，即使 thread 尚无回复。
- 作为 Owner，我能区分普通 Channel 消息未读与 Task thread 未读，并从侧栏进入 Channel 后找到未读 Task 总览。
- 作为 Owner，我能在许多 Task thread 中按未读与最近讨论定位目标；打开一个 thread 只清该 thread，其他未读保留。
- 作为 Owner，我在 thread 前台打开期间看到的新回复会成为已读；关闭或切走后到达的新回复仍显示未读，应用刷新后状态仍准确。

## Implementation Decisions

| ID | 决定 | 用户选择与依据 |
|---|---|---|
| D1 | **事件消息与锚点消息分开。** Task 创建事件是 Channel 主序列中的持久信息事件，也是现有 agent 唤醒信号；它不承载 Task 元数据、不拥有 Task thread，也不是 Task 锚点。原始顶层消息继续承载 Task 元数据，所有任务讨论围绕它的 thread 展开。事件消息仍按当前 Owner 消息语义进入 Channel 序列；Owner 自己的事件消息不计入 Owner 的 Channel 未读。 | Q1：保留持久事件和 agent 唤醒；与锚点语义分开。 |
| D2 | **创建事件只读呈现。** 事件在流中使用安静的系统信息样式、清楚的「Task #N 已创建」文字与普通文本预览。整行没有 hover 动作栏、上下文菜单、链接、可点击区域或键盘停靠点；预览中的 URL 也作为普通文本。首次动态出现时以 polite 状态播报一次，焦点留在触发操作处；页面重载时的历史事件不重复播报。 | 用户需求及最终共享理解确认：信息纯读、不可点击、不可再转任务，并明确可访问性。 |
| D3 | **锚点常驻区分并直达。** Task 锚点行显示 Task 编号、当前状态，以及非 Owner 新回复的未读回复数；未读为零时仍提供「打开任务讨论」按钮。按钮以键盘可达的真实按钮呈现，并在无障碍名称中说明 Task 编号与未读回复数；focus-visible 清楚。事件提示、状态标识、未读计数和 thread 入口各有独立语义，不以整行点击代替入口。 | Q2：锚点常驻显示标识/状态与直接入口。 |
| D4 | **两种未读单位分开。** Channel 未读沿用 BAI-6：Owner 未读数是作者非 Owner、位于 Channel 顶层序列且高于 Channel 已读位置的消息条数。Task thread 未读按各自锚点计算，单位是该 thread 内作者非 Owner 且高于该 thread 已读位置的回复条数。锚点徽标显示回复条数；侧栏额外显示「有未读的 Task 数」，不是回复总数。侧栏的两个数字分别有文字无障碍名称；视觉截断时无障碍名称仍给出精确数字。 | Q4、Q8：保持 Channel / thread 来源分离，Owner 自己的消息不算未读。 |
| D5 | **未读总览扩展现有 Task View。** Channel 头部的「未读任务讨论 N」入口把当前中心切到现有 Task View 的未读筛选，不自动跳转；选中 Channel 本身仍遵循当前 Channel / center tab 行为。Task View 未读筛选是目录，不推进任何 Task 的已读位置；每个结果展示状态、Task 编号和未读回复数，点任务项打开其 thread。筛选覆盖所有状态（todo、in_progress、in_review、done、closed）；新回复不自动改写 Task 状态。 | Q3、Q9、Q13：复用现有 Task View，选中 Channel 后由用户显式进入；已完成/关闭 Task 仍可有未读讨论。 |
| D6 | **未读筛选排序不取代状态结构。** List 仍按既有状态分组，Board 仍按既有状态分列；未读筛选在各组/列中按最新未读 thread 回复时间倒序排列，并以 Task 编号升序作为稳定并列顺序。Task 状态变化不会伪装成新 thread 活动，也不会使其越过更近的未读回复。 | Q3、Q10：最近活动以未读 thread 回复为准，Task 编号稳定排序。 |
| D7 | **Channel 与 Task thread 分别已读。** 选中或查看 Channel 只推进普通 Channel 主序列；不会清除任何 Task thread 未读，且 Channel 选中时仍显示其未读 Task 数。打开一个 Task thread（从锚点或 Task View）时，只把该 thread 推进到当时最新回复；其它 Task 不变。Task View、未读筛选与消息流浏览本身都不清未读。 | Q4–Q6：进入 Channel 与查看总览不代表读过各个 Task thread。 |
| D8 | **打开期间自动推进。** 当前 Task thread 面板打开且页面在前台时，新到达的 thread 回复随呈现推进该 thread 的已读位置。关闭面板或切换 Channel 后停止推进；之后到达的回复重新计入未读。单槽右栏打开另一个面板时，先前 thread 的已读位置不回退，之后的新回复保持未读。 | Q7：前台打开期间新回复同步已读，关闭/切走后仍未读。 |
| D9 | **已读位置持久，历史先定基线。** Owner 对每个 Task thread 的已读位置跨页面刷新与应用重启保留。功能启用时，已存在 thread 的当前回复位置作为已读基线；一个已有普通 thread 后来成为 Task 时，Task 建立时已有的回复也作为已读基线。只有该基线之后到达的回复进入未读。 | Q11–Q12：持久保存；无法推断历史消息是否曾被读过，因此不把旧讨论灌成新未读。 |

**消息序列与计数的具体关系**：Channel 主消息使用 Channel 自己的 seq；每个 thread 使用锚点对应的独立 seq。交错到达的普通 Channel 消息、Task 创建事件和 Task thread 回复不会合成一个全局计数或互相推进已读位置。普通 Channel 消息只影响 Channel 未读；Task thread 回复只影响对应锚点和侧栏的未读 Task 数；事件消息不是 Task thread 回复。Owner 自己的 thread 回复不增加未读；Task 为 done/closed 不改变新回复是否计未读，回复也不隐式重开 Task。

**读状态转移**：打开 Channel → 只推进 Channel 主序列；打开未读 Task 总览 → 不推进任何 Task thread；打开 Task thread A → 只推进 A；A 保持前台打开时收到的新回复 → 推进 A；离开 A 后的新回复 → A 再次未读；Task thread B 与其他普通 Channel 消息在这些动作中分别保持自己的已读位置。

## Testing Decisions

本票是设计票，只产出文档；不跑测试、不做双轴 code-review、不取真浏览器几何证据。未来实现票至少验证以下行为：

- 新建 Task 的事件仍能唤醒 agent；其静态历史呈现没有按钮、链接、hover / pop action、上下文菜单或再次转 Task 的 affordance；新事件被辅助技术礼貌播报一次，刷新历史不重复打断。
- Channel 流中的 Task 锚点显示编号、状态和未读回复数；零回复 Task 仍能经键盘入口打开正确 thread；辅助名称同时说明 Task 与未读单位。
- 单条普通 Channel 消息只影响普通未读；一个 Task thread 回复只增加该锚点的回复数和侧栏未读 Task 数；Owner 自己的消息不计入；多个未读 Task 只在打开对应 thread 后逐个清除。
- 打开 Channel 或 Task View 未读目录不清 Task 未读；打开 thread 清当前 thread 到最新回复；前台打开期间新回复推进已读；关闭 / 切走后新回复仍未读；刷新与重启后已读位置保留。
- 旧 thread 回复的启用基线与「普通 thread 后来成为 Task」的基线按本 spec 处理；done / closed Task 的新回复仍在未读筛选中，状态保持不变。
- 未读筛选在 List / Board 中保留既有状态分组/列，组内以最近未读回复排序；同一 Channel 有大量 Task 时仍能通过筛选到达目标，侧栏数是 Task 数、锚点数是回复数。

## Out of Scope

- 不修改产品源码、数据表或迁移；不创建实现代码或测试代码。
- 不改变普通 Channel 未读的作者排除、seq 推进与打开期间行为；不改变任务创建事件的 agent 唤醒、任务认领流程、Task 状态机或互审规则。
- 不把普通非 Task thread 纳入未读统计，不改变 agent 的 inbox / consumed-seq 语义，也不引入多人 Owner 的已读模型。
- 不增加「全部标为已读」、snooze 或通知推送；未读总览只是定位入口。
- 不重开颜色、圆角、边线、字体、全局导航或 List / Board 状态结构的既有视觉裁决。

## Further Notes

- 本 spec 依据用户在三轮 `orchestration ask` 中对 Q1–Q13 的选择，并在最终共享理解确认中确认无遗漏；设计 tree frontier 已清零，没有待决产品选项。
- `CONTEXT.md` 已 inline 补充「任务创建事件消息」和「任务线程未读」词条，并把 Task 锚点与其讨论 thread 的关系写清。术语只描述领域含义，没有写入数据库字段或实现步骤。
- 不新增 ADR。现有 ADR-0002（Task View 的状态投影）、ADR-0014（modern-minimal 形态）与 ADR-0015（暖奶霜马卡龙角色族）均继续有效。本次已读位置是可追加、可重置的本地阅读事实；分开计数的理由及代价已由此 spec 与 glossary 明确，不满足新增 ADR 的「难以逆转」门槛。
- 交付为纯文档设计；PR 与提交信息登记在本票 Answer 中。
