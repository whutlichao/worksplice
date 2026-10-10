# Worksplice 消息可读性：频道消息流与线程回复

日期：2026-10-10 · 设计票：`.scratch/message-readability/issues/01-design.md`（Type: grilling）

性质：**设计票**；本文件与 ADR 仅裁决消息呈现，不修改产品源码。

## Problem Statement

产品所有者反馈：「消息区域太密集了，非常影响人的阅读。」这项反馈重新打开了既有视觉裁决中的消息密度部分，而不是整体撤销 Worksplice 的视觉方向。

当前，频道消息行与右栏线程回复复用 `MessageRow` 与 `.msg` 规则。频道消息正文区域最大宽度为 880px；消息行当前 8px 内边距、段落间距 6px。外层 `.msg-text` 设为 13px / `--lh-text`（1.55），但其内嵌 `.markdown-body` 将普通 Markdown 正文设为 `var(--fs-body)`（13px）/ 1.7；实际普通正文行高是 1.7，而不是外层的 1.55。线程面在更窄的右栏中沿用该 Markdown 正文规则。作者名为 13px 粗体，`#seq` 为 10.5px mono / `--muted`，时间为 10.5px mono / `--faint`。行内 code 为 12px 且没有独立 line-height；Markdown fenced code 经 React `CodeBlock` 渲染，`SyntaxHighlighter` 使用 `--fs-sm`（当前 12px）/ 1.62。`.msg-text pre` 的 11.5px / `--lh-code`（1.6）不是这条 React 渲染路径的实际值。

这些事实分别见 `app/globals.css:147-155,1347,1394,1399,1402-1407,1440,1569-1572`、`components/MarkdownBody.tsx:21-43`（fence 分派到 `CodeBlock`、inline 保持 code）、`components/MermaidBlock.tsx:259-274`、`components/ChannelView.tsx:1042-1049,1115`、`components/ThreadPanel.tsx:8,398-420` 与设计系统 `worksplice-design-system/colors_and_type.css:84-85,92,108-109,116`、`worksplice-design-system/tokens.css:10-11,39`。`ThreadPanel` 调用同一 `MessageRow`，而任务活动摘要的 `.log-row .msg` 另有紧凑覆盖，不是本次频道消息流/线程回复阅读面（`app/globals.css:1569-1574`）。

反馈包含三个都要纳入的场景：频道连续短消息、频道长消息/多段正文、右栏线程回复。产品所有者未给这些场景排序；本设计覆盖三者，但不声称它们优先级相等。

## Solution

### 已确认方向

| 决策 | 已确认裁决 | 来源与理由 |
| --- | --- | --- |
| D1 场景 | 连续短消息、频道长文/多段正文、线程回复全部纳入；不设先后排序 | Q1 人定：多个场景都影响阅读；不把纳入等同于排名 |
| D2 问题信号 | 行间留白、正文/段落节奏、行长、字号/字重、作者/时间/序号层级均作为待处理信号 | Q2 人定：设计逐项说明处置，不预设单一视觉手段 |
| D3 目标 | 阅读舒适优先，可接受同屏消息减少、更多滚动与略慢的快速浏览 | Q3 人定：阅读反馈已影响人的阅读；线程增幅更明显也知情接受 |
| D4 场景差异 | 频道与线程都采用更宽松的消息阅读节奏，线程因窄栏与长回复额外增加纵向舒适度 | Q4 人定；Q6 人定：不强求两处相同垂直尺度 |
| D5 字号例外 | 普通频道正文与线程回复为 14px；其他界面继续使用原字号基线 | Q5 人定：只重开消息面的 13px 限制，不重开全局尺度 |
| D6 正文尺度 | 两处正文同为 14px；线程不再放大字号，而是通过行距、段距、消息间距额外照顾 | Q7 人定：避免窄栏同时叠加更大字号与所有留白代价 |
| D7 行长 | 限制消息正文自身的可读行长，不改变整体 stream 容器或 composer 的宽度 | Q8 人定：行长是问题信号，宽度限制只落在正文 |
| D8 行分隔 | 用纵向留白区分相邻消息；不增加分隔线或卡片底 | Q9 人定：接受留白带来的滚动增长，不加额外 chrome |
| D9 元信息 | 作者、时间、序号完整保留；作者清晰，时间/序号较正文弱；不隐藏、不改内容或交互 | Q10 人定：改善层级但不丢失定位信息 |
| D10 标定值 | 正文 14px；`max-width: 68ch`；频道/线程垂直 padding 分别 12px/16px；line-height 分别 1.65/1.7；段距分别 8px/12px；作者 14px；时间与序号 10.5px mono / `--faint` | Q11 人定确认整组方案；具体滚动代价已说明并接受 |
| D11 代码 | 14px 只用于普通正文；行内 code 维持 12px 且无独立 line-height；fenced code 经现有 React `CodeBlock` 维持 12px / 1.62；不改渲染路径或横向滚动 | Q12 人定（事实基线修正）：`SyntaxHighlighter` 读 `--fs-sm`（当前 12px）并设 1.62；`.msg-text pre` 的 11.5px / 1.6 不适用于此渲染路径 |
| D12 基线更正 | `#seq` 当前是 10.5px mono / `--muted`，时间当前是 10.5px mono / `--faint`；新决定把二者都设为 `--faint`。行内 code 有显式 12px 字号，但没有独立 line-height 声明 | Q13 人定事实更正：不得把新样式误写成现状，也不得声称行内 code 有固定独立行高 |
| D13 文档同步范围 | 授权最小更新 `worksplice-design-system/DESIGN.md` 与 `worksplice-design-system/SKILL.md`，使两份契约准确反映消息局部例外；其他 Ownership 不变 | Q14 人定：只同步这两份设计系统说明，不编辑其他未授权文件 |
| D14 后续文档同步范围 | 额外最小更新 README、字体样张 preview，以及 `colors_and_type.css` 中 `--fs-body` 的注释；不改 token 值或其他文件 | Q15 人定（本次追加授权）：使说明/样张区分通用 UI 13px 与消息 14px，并展示频道/线程 1.65/1.7 行高 |

### 消息密度提案

| 维度 | 频道消息 | 线程回复 | 对应的现状与代价 |
| --- | --- | --- | --- |
| 普通正文 | 14px，line-height 1.65 | 14px，line-height 1.7 | `--fs-body:13px` 与全局 `--lh-text:1.55` 不改；只作消息内容局部覆盖 |
| 正文最大行长 | `max-width: 68ch` | 同一上限；窄栏通常由可用宽度自然限制 | `ch` 随系统字体度量变化，不换算成固定 px。它比当前 880px 的整列上限更窄，长文会增加换行与滚动；实施时以中英文样本检验 |
| 消息行垂直 padding | 12px（现有 `--sp-5`） | 16px（现有 `--sp-7`） | 当前两处均为 8px（`--sp-4`）；频道每行增高，线程更明显。保持水平 padding 与现有对齐规则 |
| 段落间距 | 8px（现有 `--sp-4`） | 12px（现有 `--sp-5`） | 当前 6px（`--sp-3`）；多段正文高度与滚动相应增加 |
| 消息边界 | 增加留白，不加线、不加卡片 | 同左 | 避免短消息连成一片而不引入额外装饰 |
| 元信息 | 作者 14px、保持现有明确粗体；序号和时间 10.5px mono / `--faint` | 同左 | `#seq` 从当前 `--muted` 降为 `--faint`；两者始终可见 |
| 代码内容 | 普通正文限宽；行内 code 12px；React fenced `CodeBlock` 12px / 1.62 | 同左 | 保留现有渲染路径与横向滚动；行内 code 没有独立 line-height。`.msg-text pre` 的 11.5px / 1.6 不是 React `CodeBlock` 的渲染值 |

68ch 是设计作者基于现有 14px 系统 sans 正文与当前 880px 整列上限提出、并经 Q11 人定确认的**字符度量上限**，不是既有 token，也不是固定像素值。它把宽屏频道正文从整列宽度收至中等阅读行长；拉丁文本与 CJK 的实际字数/行会不同，因此未来实施验证要覆盖两类文本、长短消息与窄栏。线程正文复用此上限，但 dock 可用宽度更小，不再额外缩窄。

### 被收窄的既有裁决

- ADR-0014 的“13px 密度”只对频道/线程的普通消息正文作例外；单一整体视觉方向及其他界面规范保留。
- ADR-0015 第 7、17、37 行明确保留形态、间距、字号及全局尺度。本次只重新裁决消息阅读密度：全局 token 名、值与尺度表不动，消息规则局部使用确认值；所有非消息表面保持原样。
- `.scratch/design-system-refactor/spec.md` ED-5 的“消息与正文 13px / 不许把 13px 正文吹大”仅由本设计在频道消息与线程回复的普通正文范围内收窄。其他 UI、agent-session transcript、composer、任务活动摘要仍按现行字号和密度。
- ADR-0016 记录以上窄例外。任务活动 `.log-row .msg` 的紧凑样式不受影响；不把这类摘要当作频道消息行或线程回复。

### 可观察验收与实施边界

实施后应可观察到：频道与线程的普通消息正文均为 14px 且受 68ch 最大行长约束；短消息之间靠留白而非分隔线/卡片区分；频道行垂直间距为 12px，线程为 16px，线程正文行距/段距也更宽；作者仍清晰、时间和序号仍可见且视觉次要。窄视口正文收缩、不产生横向页面溢出；stream 与 composer 仍使用原 880px 全局列宽。

仅消息阅读样式可调整：`app/globals.css` 中 `.msg` / `.msg-text` 及线程垂直节奏相关的局部规则。若既有 render 结构需要包装正文以便局部限宽，只能在频道和线程共用的消息呈现路径内做不改变内容的布局调整。不得改 `--fs-body`、`--lh-text`、`--stream-max`、全局 spacing/type token，不得改变 `.log-row .msg`、agent-session transcript、composer、消息内容、动作栏、reaction、pin、任务状态或数据/调用契约。

## User Stories

1. 作为在频道里快速浏览的人，我能从连续短消息间的留白辨认每条消息的起止，而不是依靠新增卡片或分隔线。
2. 作为阅读频道长文的人，我看到适中的消息正文行长与段落节奏，能顺畅地逐行阅读，并知道这会增加纵向滚动。
3. 作为在右栏线程中阅读回复的人，我看到与频道一致的 14px 正文，同时获得更多行距、段距和消息间留白；窄栏下的滚动代价明确且可接受。
4. 作为需要定位消息的人，我仍能看到作者、时间与序号；作者保持清楚，时间/序号弱于正文但不消失。
5. 作为查看任务活动摘要或 agent 会话记录的人，我看到的不是这项消息流改判；这些独立阅读面不被顺带加宽或增密度。

## Implementation Decisions

1. **限于消息正文**：14px 与 68ch 只约束频道消息/线程回复的普通正文；不改整个 stream 容器、composer 或 agent-session transcript。
2. **不改全局 token**：`--fs-body:13px`、`--lh-text:1.55`、`--sp-*`、`--stream-max:880px` 的全局值保持不动。14px、1.65/1.7 与 68ch 是消息局部例外；padding/段距复用既有 spacing 标尺。
3. **频道与线程共用内容尺度、分化纵向节奏**：正文 14px、68ch 上限相同；频道使用 12px 行 padding / 8px 段距 / 1.65 行高，线程使用 16px / 12px / 1.7。线程水平内边距和现有 dock 对齐规则不变。
4. **只用空白分隔**：不加卡片背景或分隔线，不改变 hover/anchor、action toolbar、reaction、attachment 或 pin 的视觉语义与交互。
5. **保留消息信息**：作者、序号、时间仍全部渲染且顺序不变；作者为 14px 明确粗体，序号/时间均 10.5px mono / `--faint`。序号的颜色是有意从现状 `--muted` 降为 `--faint`。
6. **保留代码专用排版**：普通正文为 14px；行内 code 继续 12px（不附加独立 line-height 声明）；fenced code 继续由现有 React `CodeBlock` 以 `--fs-sm`（当前 12px）/ 1.62 渲染。不得切换渲染方式或改横向滚动。68ch 限制正文容器。`.msg-text pre` 的 11.5px / 1.6 不属于此 CodeBlock 路径。
7. **保留活动摘要形态**：`.log-row .msg` 的 0 padding / 0 margin / muted text 和 hover 规则不动；不把活动摘要当消息流密度的一部分。
8. **文档裁决同步**：ADR-0016 具体收窄 ADR-0014/0015 与 ED-5 的消息密度条款；按 Q14、Q15 仅更新 DESIGN.md、SKILL.md、README.md、`preview/typography-specimens.html`，并仅调整 `colors_and_type.css` 的 `--fs-body` 注释。所有全局 token 值不变。`CONTEXT.md` 不改，因为“消息阅读密度”是呈现属性，不是新增领域术语，`Channel` 与 `Task` 的既有定义不变。

## Testing Decisions

本票为设计票，不实现产品源码；按 G-docs 门禁不运行测试、typecheck、lint、双轴 code-review 或浏览器验收。后续实施应使用代表性短消息、长段落、代码片段、拉丁文本与 CJK 文本分别核对频道宽屏、窄屏和线程窄栏，确认正文限宽、纵向节奏、元信息可见性及无横向溢出；并确认 composer、任务活动摘要、agent-session transcript 与全局 token 没有连带变化。此处列的是后续可观察验证面，不声称已经执行。

## Out of Scope

- agent-session transcript（`MessageView`）、任务活动摘要（`.log-row .msg`）、composer、任务板、频道头部、搜索结果和其他非消息面。
- 消息内容、消息序列、作者身份、引用/reaction/pin/提醒/附件/线程交互、任务状态、权限、数据/调用契约。
- 全局 `--fs-body` / `--lh-text` / `--sp-*` / `--stream-max` token 的值或词汇表；其他界面仍服从 ADR-0015。
- 新增消息卡片、分隔线、折叠/截断、内容隐藏、排序或交互机制。
- 本票只产出设计成果，不实现样式、不拆实施票。

## Further Notes

### 既有事实与裁决出处

- 共用行与正文样式：`app/globals.css:1394-1407`；外层 `.msg-text` 是 13px / `--lh-text:1.55`，实际 Markdown 正文由嵌套 `.markdown-body` 在 `:147-155` 设为 `--fs-body`（13px）/ 1.7。频道正文最大列宽：`:1347`；线程水平内边距：`:1440`；线程复用 `MessageRow`：`components/ThreadPanel.tsx:398-420`。
- 当前 meta 实际颜色：`components/ChannelView.tsx:1045-1049`（序号 inline `--muted`、时间继承 `.msg-time` 的 `--faint`）；作者渲染：`:1042-1044`。
- 行内 code 为 12px、无独立 line-height；`components/MarkdownBody.tsx:21-43` 将 fenced code 分派到 React `CodeBlock`，由 `components/MermaidBlock.tsx:259-274` 使用 `--fs-sm`（当前 12px）/ 1.62。`.msg-text pre` 的 11.5px / `--lh-code:1.6` 是另一条 CSS 规则，不是此渲染路径。任务活动摘要覆盖：`app/globals.css:1569-1574`。
- 全局 13px、行高与间距标尺：`worksplice-design-system/colors_and_type.css:84-85,92,108-109`；整列宽度：`worksplice-design-system/tokens.css:39`。
- ADR-0014 的 13px 密度表述：`docs/adr/0014-visual-direction-modern-minimal.md:5`。ADR-0015 在 `docs/adr/0015-macaron-palette-warm-cream-pastel.md:7,17,37` 保留字号/间距/全局 token；ED-5 在 `.scratch/design-system-refactor/spec.md:182` 锁定 13px 正文。
- 本设计记录为领域术语无变化，不编辑 `CONTEXT.md`。`Channel` 与 `Task` 保持原义。

### 文档差异范围

新增 `.scratch/message-readability/spec.md`、设计票 `.scratch/message-readability/issues/01-design.md` 与 `docs/adr/0016-message-readability-local-density-override.md`；按 Q14、Q15 最小同步 DESIGN.md、SKILL.md、README.md、`preview/typography-specimens.html`，仅更新 `colors_and_type.css` 的 `--fs-body` 注释。无产品源码、测试或 token 值改动。
