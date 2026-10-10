# 01 — 消息流与线程回复可读性设计

Type: grilling
Status: resolved
Blocked by: None

用户反馈：「消息区域太密集了，非常影响人的阅读。」本票经 `grill-with-docs` 收敛频道消息流与线程回复的视觉密度，设计正本为 [spec.md](../spec.md)。不实现产品源码、不运行测试/typecheck/lint、不做双轴 review 或真浏览器验收；按 G-docs 交付。

## Answer

### Grill 轮次索引

以下分组按实际 `grill-with-docs` 会话中提交给协调端的 frontier 轮次记录；每轮问题均经 `orca orchestration ask` 提交，答案由该 ask 或基于同一 message ID 的 `--resume` 返回。ask 超时仍保持 pending 时续等原消息，没有重发同一问题。

| 轮次 | 问题范围 | 提交与答复记录 |
| --- | --- | --- |
| 第 1 轮 | Q1–Q4 | 2026-10-10 10:31 UTC 提交；首次 ask 超时后使用 `msg_981902becce4` 多次 resume，11:55 UTC 返回用户答复，确认三类场景均纳入但不排序、五类密集信号均处理、阅读舒适优先，以及频道/线程按场景分别决定。 |
| 第 2 轮 | Q5–Q6 | 2026-10-10 11:59 UTC 通过新的 ask 提交并在该调用收到答复：允许仅频道消息与线程回复高于 13px，并要求两处均放宽、线程额外照顾。 |
| 第 3 轮 | Q7–Q10 | 2026-10-10 12:05 UTC 提交；ask 超时后以 `msg_865d548d7056` resume，12:16 UTC 返回用户答复，确定正文尺度、只限正文行长、以留白分隔消息、元信息保留且降低次要信息强调。 |
| 第 4 轮 | Q11 | 2026-10-10 12:35 UTC 通过带“确认方案/调整方案”选项的 ask 提交；超时后以 `msg_8b175bd63232` resume，12:45 UTC 收到确认。该答复还重申了 Q14 已授权最小更新 DESIGN.md 与 SKILL.md；Q14 仍作为独立授权项保留在下方审计，不另造一轮。 |
| 第 5 轮 | Q12 | 2026-10-10 13:00 UTC 通过带代码范围选项的 ask 提交；超时后以 `msg_459e2d0332a4` resume，13:10 UTC 收到用户答复：14px 仅用于普通消息正文，行内 code 保持 12px，代码不放大且横向滚动不变。该答复中的 fenced-code 基线随后经源码核验更正，见 Q12/Q13；更正不改变用户确认的范围。 |

**轮次边界与后续审计**：Q13 是 Q12 后续的事实更正，不是实际 grill 历史中的新一轮问题；它修正序号/时间与 inline code 的现状记述，并保留 Q12 的原决定。后续源码核验又确认 fenced React `CodeBlock` 实际为 12px / 1.62，而不是最初问句误引的 `.msg-text pre` 11.5px / 1.6；该事实修正记在 Q12，未伪装为用户另选了一种代码样式。Q15 是原 grill 完成后的追加设计系统文档授权，也不计入产品取舍轮次。

### Q→A 审计

#### Q1 — 最受影响的阅读场景
**Q1 → A（人定）**：频道长消息/多段正文、连续短消息、线程回复三类场景都纳入。用户未给出排序；本设计覆盖三者，但不写成优先级相等。


**理由**：三类都被选为受影响场景；没有排序信息，不可推断权重。

#### Q2 — 造成密集感的可观察现象
**Q2 → A（人定）**：全部五类信号均纳入：相邻行留白不足、正文/段落节奏紧、正文行过长、字号/字重偏小或偏轻、作者/时间/序号层级干扰。


**理由**：设计需逐项处置或说明不改，不能预设只调行距、正文宽度或行高。

#### Q3 — 取舍优先级
**Q3 → A（人定）**：阅读舒适优先，接受频道同屏消息减少、滚动增长、快速浏览略慢；线程纵向占用增长更明显也接受。


**理由**：反馈明确指出密度影响阅读，故不把保留现有 viewport 行数放在首位。

#### Q4 — 频道与线程密度关系
**Q4 → A（人定）**：按场景分别决定，不要求完全相同。


**理由**：线程处于较窄右栏，长回复持续阅读和频道扫描有不同约束。

#### Q5 — 是否重开 13px 正文约束
**Q5 → A（人定）**：允许频道消息与线程回复正文高于 13px；范围只限这两处，其他界面保持现有基线。


**理由**：用户也把字号/字重列为问题信号，且阅读舒适优先；全局放大会波及非消息面。

#### Q6 — 两处的宽松尺度
**Q6 → A（人定）**：频道与线程都使用更宽松节奏，线程因窄栏及长回复额外照顾。


**理由**：三类场景都纳入，无须靠牺牲线程阅读恢复频道密度；代价是频道扫描变慢、线程滚动更长。

#### Q7 — 正文尺度
**Q7 → A（人定）**：频道与线程正文均 14px；线程不放大到 15px，而通过行间、段落、消息间距额外照顾。


**理由**：直接回应字号偏小，同时避免窄栏把放大字号与全部留白代价叠加。

#### Q8 — 正文行长
**Q8 → A（人定）**：只限制消息正文的可读行长，不改变整体消息流容器或 composer 宽度；数值由设计方案基于现有尺度提出。


**理由**：行长是已选信号，但整列与输入框不是本票目标。

#### Q9 — 相邻消息的边界感
**Q9 → A（人定）**：增加纵向留白，不加分隔线或卡片底。


**理由**：以节奏区分短消息，避免新增 chrome；留白带来的更多滚动已接受。

#### Q10 — 作者、时间、序号层级
**Q10 → A（人定）**：所有元信息完整可见、内容和交互不变；作者保持清楚，时间/序号相对正文降低强调，不隐藏。


**理由**：保留消息定位信息，同时处理元信息对正文阅读的干扰。

#### Q11 — 完整标定方案
**Q11 → A（人定）**：确认整组方案：普通正文 14px；消息正文 `max-width:68ch`；stream/composer 仍宽 880px；频道/线程垂直 padding 为 12px/16px；line-height 为 1.65/1.7；段距 8px/12px；作者 14px；时间与序号 10.5px mono / `--faint`；无分隔线/卡片底。只作用于频道消息与线程回复，不作用于 agent-session transcript、`.log-row .msg` 或其他面；全局尺度/token 值不变。接受增加换行与滚动，线程增幅更大。


**理由**：此组值逐项处理已确认的五类信号，同时把例外局限到消息阅读面。

#### Q12 — 普通正文与代码内容范围
**Q12 → A（人定；本次事实基线修正）**：14px 只用于普通消息正文；行内 code 保持 12px（无独立 line-height，详见 Q13）。fenced code 沿用现有 React `CodeBlock` 渲染路径，`SyntaxHighlighter` 使用 `--fs-sm`（当前 12px）/ 1.62；不改渲染方式或横向滚动。此前写为 11.5px / 1.6 是把 `.msg-text pre` CSS 规则误当作该 fenced CodeBlock 的实际值。68ch 只限制正文容器；接受代码相对 14px 正文更小、长代码仍需横向阅读。渲染路径与源码基线：`components/MarkdownBody.tsx:21-43`、`components/MermaidBlock.tsx:259-274`。


**理由**：普通正文 14px 单独处理；行内 code 与 fenced CodeBlock 保持各自现有样式/渲染方式，避免把 `.msg-text pre` 的非目标规则错当成实际 fenced 渲染值。

#### Q13 — 对 Q12 基线的事实更正
**Q13 → A（人定更正，原审计保留）**：当前 `#seq` 是 10.5px mono / `--muted`，时间戳是 10.5px mono / `--faint`；新裁决把两者都设为 `--faint`。行内 code 当前显式字号 12px，但没有独立 line-height 声明，不得描述为已有固定行高。此更正仍只涵盖序号/时间和 inline code 事实；fenced CodeBlock 的实际 12px / 1.62 基线由 Q12 单独纠正。现状依据 `components/ChannelView.tsx:1045-1049` 与 `app/globals.css:1406`。


**理由**：纠正问句中对现状/继承关系的概括，避免把序号的 `--muted` 写成既有 `--faint`，也避免给行内 code 编造行高。

#### Q14 — 设计系统文档同步授权
**Q14 → A（人定）**：授权对 `worksplice-design-system/DESIGN.md` 与 `worksplice-design-system/SKILL.md` 做最小密度说明更新；其他 Ownership 不变。


**理由**：两份设计系统契约原本把 13px/6–8px 密度写为通用规范，需准确标注频道/线程的局部例外；不能据此改 token 或其他界面。

#### Q15 — 追加的设计系统文档授权
**Q15 → A（人定；本次追加授权）**：额外授权最小更新 `worksplice-design-system/README.md`、`worksplice-design-system/preview/typography-specimens.html`，以及只修改 `worksplice-design-system/colors_and_type.css` 中 `--fs-body` 这一条注释。README 与 preview 明确区分 13px 通用 UI 正文和 14px 频道/线程消息正文，并展示频道/线程行高 1.65/1.7；CSS token 的声明值及其他规则不改。

**理由**：让入口说明、视觉样张和 token 注释与既有 Q14 授权、ADR-0016 的局部例外一致，同时不改变通用尺度或实际渲染路径。

### 交付路径

- 设计正本：`.scratch/message-readability/spec.md`
- 设计票：`.scratch/message-readability/issues/01-design.md`
- ADR：`docs/adr/0016-message-readability-local-density-override.md`
- 设计系统契约与样张最小同步：`worksplice-design-system/DESIGN.md`、`worksplice-design-system/SKILL.md`、`worksplice-design-system/README.md`、`worksplice-design-system/preview/typography-specimens.html`、`worksplice-design-system/colors_and_type.css`（仅 `--fs-body` 注释）
- 未改 `CONTEXT.md`：未澄清/新增领域术语；“消息阅读密度”是视觉呈现属性，`Channel` 与 `Task` 词条不变。

### G-docs 自验

- 七节设计结构齐全：Problem Statement / Solution / User Stories / Implementation Decisions / Testing Decisions / Out of Scope / Further Notes。
- 决策记录保留 Q1–Q14，并新增 Q15 的追加授权审计；场景未排序，不写成优先级相等。
- Markdown 普通消息正文现状记录为嵌套 `.markdown-body` 的 13px / 1.7；外层 `.msg-text` 的 13px / 1.55 不冒充实际 Markdown 行高。fenced CodeBlock 记录为 React `SyntaxHighlighter` 的 12px / 1.62；不误用 `.msg-text pre` 的 11.5px / 1.6。
- ADR-0016 明确收窄 ADR-0014 的 13px 密度、ADR-0015 的消息密度形态保持部分与 ED-5；全局 token、非消息面与 `.log-row .msg` 排除项写明。产品源码与测试改动为零；未运行测试、typecheck、lint、双轴 review 或浏览器。
- 保持 `.pi-lens.json` 只在本地 `.git/info/exclude`，不进入提交。

### 差异摘要

更新 spec、设计票 Answer 与 ADR 的渲染事实；同步 DESIGN.md、SKILL.md、README.md、typography preview，并仅修改 `colors_and_type.css` 的 `--fs-body` 注释。无 `CONTEXT.md`、产品源码、token 值或测试文件改动。

### PR

PR **#142** — https://github.com/whutlichao/worksplice/pull/142
