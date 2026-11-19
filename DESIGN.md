---
name: worksplice
description: 本地房间的校样板 —— 校样纸、单墨、四色角色与一枚方形付印章。
colors:
  # 纸族（校样纸，暖白 + 极低彩度）
  proof-paper: "oklch(98.5% 0.004 91.4)"
  card-paper: "oklch(100% 0 89.9)"
  rail-paper: "oklch(96% 0.008 98.9)"
  well-paper: "oklch(92.7% 0.011 100.8)"
  hairline: "oklch(88.7% 0.011 100.8)"
  hairline-strong: "oklch(65.1% 0.009 248)"
  # 墨族（正文 + 唯一强调色 + 纸白）
  ink: "oklch(20% 0.009 264.4)"
  ink-muted: "oklch(43.5% 0.011 243.1)"
  ink-faint: "oklch(49.3% 0.012 248.1)"
  paper-white: "oklch(100% 0 89.9)"
  ink-action: "oklch(20% 0.009 264.4)"
  ink-action-hover: "oklch(29.7% 0.012 264.4)"
  # 青 · 当前位置
  cyan-current: "oklch(84.2% 0.05 224.5)"
  cyan-current-deep: "oklch(41.5% 0.072 222.8)"
  cyan-current-graphic: "oklch(51% 0.092 227.2)"
  # 品红 · 等你签
  magenta-review: "oklch(86.5% 0.06 348.6)"
  magenta-review-deep: "oklch(43.6% 0.149 353.2)"
  magenta-review-graphic: "oklch(50% 0.169 353.3)"
  # 黄 · 警示 / 待办（浅黄）
  yellow-warn: "oklch(88.8% 0.103 91.3)"
  yellow-warn-deep: "oklch(50.2% 0.101 86.7)"
  yellow-warn-graphic: "oklch(60.5% 0.124 78.7)"
  # 黄 · 进行中（同族琥珀档）
  amber-working: "oklch(52.9% 0.127 53.7)"
  amber-working-fill: "oklch(85.6% 0.075 70.5)"
  amber-working-text: "oklch(47.1% 0.112 53.7)"
  # 绿 · 付印 / 在线
  green-press-okay: "oklch(47.9% 0.079 161.4)"
  green-press-okay-fill: "oklch(86.2% 0.049 159.1)"
  green-press-okay-text: "oklch(41.5% 0.067 162.8)"
  # 红 · 退校 / 失败
  red-revise: "oklch(48.5% 0.15 28.1)"
  red-revise-fill: "oklch(85.7% 0.056 27.9)"
  # 灰 · 离线 / 已关闭
  grey-closed: "oklch(55.6% 0.012 248)"
  grey-closed-fill: "oklch(90% 0 247.9)"
  grey-closed-deep: "oklch(47.1% 0.011 243)"
  # 头像五格（确定性取色的纸灰）
  avatar-paper-0: "oklch(93.4% 0.004 100)"
  avatar-paper-1: "oklch(89.6% 0.004 100)"
  avatar-paper-2: "oklch(85.8% 0.004 100)"
  avatar-paper-3: "oklch(95.2% 0.004 100)"
  avatar-paper-4: "oklch(82.4% 0.004 100)"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 680
    lineHeight: 1.5
    letterSpacing: "-0.02em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 680
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  prose:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "ui-monospace, SF Mono, JetBrains Mono, Menlo, Consolas, monospace"
    fontSize: "9.5px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.08em"
  meta:
    fontFamily: "ui-monospace, SF Mono, JetBrains Mono, Menlo, Consolas, monospace"
    fontSize: "10.5px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "2px"
  md: "3px"
  lg: "4px"
  xl: "6px"
  pill: "3px" # --r-pill 不是胶囊：伪胶囊一律近方角
spacing:
  sp-1: "2px"
  sp-2: "4px"
  sp-3: "6px"
  sp-4: "8px"
  sp-5: "12px"
  sp-6: "14px"
  sp-7: "16px"
  sp-8: "18px"
  sp-9: "20px"
  sp-10: "24px"
  sp-11: "30px"
  sp-12: "56px"
components:
  button-primary:
    backgroundColor: "{colors.ink-action}"
    textColor: "{colors.paper-white}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.ink-action-hover}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.md}"
  button-default:
    backgroundColor: "{colors.card-paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  input-field:
    backgroundColor: "{colors.card-paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 10px"
  badge-unread:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper-white}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 5px"
    size: "18px"
  stamp-todo:
    backgroundColor: "{colors.card-paper}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "1px 5px"
  stamp-in-review:
    backgroundColor: "{colors.card-paper}"
    textColor: "{colors.magenta-review-deep}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "1px 5px"
  stamp-done:
    backgroundColor: "{colors.card-paper}"
    textColor: "{colors.green-press-okay-text}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "1px 5px"
  composer-box:
    backgroundColor: "{colors.card-paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "11px 13px 4px"
  presence-online:
    backgroundColor: "{colors.green-press-okay}"
    size: "7px"
  presence-working:
    backgroundColor: "{colors.amber-working}"
    size: "7px"
  presence-error:
    backgroundColor: "{colors.red-revise}"
    size: "7px"
  presence-offline:
    backgroundColor: "{colors.grey-closed}"
    size: "7px"
---

# Design System: worksplice

> **本文件写于构建之后，依据是已发出的代码，不是任何视觉稿。**
> 唯一取值来源：`worksplice-design-system/colors_and_type.css`（色与字）、`worksplice-design-system/tokens.css`（间距 / 圆角 / 阴影 / 布局）、`app/globals.css`（本仓扩展层与 class 块，末段「校样世界」）、`app/layout.tsx`（`themeColor`）。方向契约见 `.impeccable/surfaces/components-appshell-tsx.md`（seed `a946e85ad432fd91`）：它给了世界，代码给了取值——两者不一致时以代码为准，并在此标注。
> **本项目没有 comp，也没有被批准的视觉稿**：下面每一条都是对成品行为的描述，不是对设计意图的转述。

## Overview

**Creative North Star: "校样"（The Press Proof）**

房间是一张摊开的校样纸，工作是一份份等待付印的印张。每条任务带着校次（`#3`）和签名；没有任何一件工作能在缺少第二个人署名时看起来「完成」。世界只借四样东西：纸、墨、四色印、一个盖章动作——其余一律让位给密度和可读性。

克制是这条世界的主线。纸是暖白，墨是唯一强调色，边框是发丝，角几乎直角，阴影只在东西真的浮起来时才出现。全屏唯一的装饰是那枚方形章和栏头的四个套准小方点；系统连一个圆形都不画（点、头像、徽章、胶囊全部是带 1–3px 倒角的方）。字只有系统 sans 与系统 mono 两支，不加载 webfont——CJK 与拉丁同栈，界面不会被字重节奏绑住。

**它明确拒绝的类别默认：**

- 把工作状态藏在悬浮提示里的聊天气泡流——状态必须是常驻的、可扫读的、带字的一枚章。
- 第二种强调色、彩色圆形状态点、零模糊的硬偏移阴影、真正的圆胶囊徽章。
- 以「好看」为由放大字号或加装饰来填补密度。

**Key Characteristics:**

- 纸族四级递进（`--bg` → `--surface` → `--panel` → `--panel-2`）承担全部层次，不靠边框堆叠。
- 一个墨族同时是**正文色**和**唯一强调色**（`--accent === --fg`），纸白压在实印面上。
- 五个角色墨：青=当前位置、品红=等你签、黄=进行中 / 待办 / 警示、绿=付印 / 完成、红=退校 / 失败；灰只做离线与已关闭。
- 每个状态**同色同词**，颜色永不单独承担语义。
- 签名动作：方形付印章（默认 1px，待审与完成 1.5px；`done` 章里写署名）。
- 13px 界面正文、14px 消息正文 / 68ch、9.5px 全大写等宽标签、一切数字 `tabular-nums`。

## Colors

一张暖白校样纸上只压一种墨和五支角色印；每支印按「淡印面 / 文字档 / 环点档」分层，颜色只在它该出现的那一层出现。

### Primary

- **墨（Ink）**（`oklch(20% 0.009 264.4)`）：正文、标题、章上的字，同时也是 `--accent`——主按钮、发送键、品牌标、agent 署名色的实印面。它的悬停面是 `oklch(29.7% 0.012 264.4)`（越按越浅，不是越按越深）。压在实印面上的永远是**纸白** `--on-accent`（`oklch(100% 0 89.9)`）。
- **次级墨**（`oklch(43.5% 0.011 243.1)`）与**三级墨**（`oklch(49.3% 0.012 248.1)`）：说明文字、标签、元信息。三级墨就是这一族的底——四种纸上它都还压得住 4.5:1，不要再往下生出第四级更浅的墨。

### Secondary

- **青 · 当前位置**（`oklch(84.2% 0.05 224.5)`，文字档 `oklch(41.5% 0.072 222.8)`，环点档 `oklch(51% 0.092 227.2)`）：导航激活行的左侧 2px 竖条与 `#` 记号、消息锚点行的底色与竖条、打开中的线程、选中的 chip / 分段控件 / 单选卡、`is-now` 时间点环。它回答的只有一个问题：「你此刻在哪」。
- **品红 · 等你签**（`oklch(86.5% 0.06 348.6)`，文字档 `oklch(43.6% 0.149 353.2)`，环点档 `oklch(50% 0.169 353.3)`）：`in_review` 的虚线章、审阅请求。它是「需要你动一下」的那一类，不是「有变化」的那一类。

### Tertiary

- **黄 · 警示 / 待办**（`oklch(88.8% 0.103 91.3)`，文字档 `oklch(50.2% 0.101 86.7)`，环点档 `oklch(60.5% 0.124 78.7)`）：常驻警示条、`.lv.warn` 级别签、meter 的警示段、栏头套准点第 3 格、「没有默认收件人」提示。
- **琥珀 · 进行中**（`oklch(52.9% 0.127 53.7)`，填充档 `oklch(85.6% 0.075 70.5)`，文字档 `oklch(47.1% 0.112 53.7)`）：黄族里压深的一支，专门表示「有人正在干」——`in_progress` 章的框、成员行的 `working` 点与词。
- **绿 · 付印 / 在线**（`oklch(47.9% 0.079 161.4)`，填充档 `oklch(86.2% 0.049 159.1)`，文字档 `oklch(41.5% 0.067 162.8)`）：`done` 章的框、在线点、`ok` 级别签。
- **红 · 退校 / 失败**（`oklch(48.5% 0.15 28.1)`，填充档 `oklch(85.7% 0.056 27.9)`）：拒绝、关闭、错误、危险动作。红族的 base / 图形 / 文字**同值**——它不需要分层就已经够重。
- **灰 · 离线 / 已关闭**（`oklch(55.6% 0.012 248)`，填充档 `oklch(90% 0 247.9)`，文字档 `oklch(47.1% 0.011 243)`）：离线点、`closed` 章、归档项。灰不是「禁用」，只是「没在跑 / 已结束」。

### Neutral

- **校样纸**（`oklch(98.5% 0.004 91.4)`）：页面画布、频道栏与 composer 的底色。
- **卡面纸**（`oklch(100% 0 89.9)`）：消息行、卡片、频道头、右栏、输入框、浮层。比画布更亮——层次靠纸的明度递进，靠发丝断开。
- **栏纸**（`oklch(96% 0.008 98.9)`）：左栏、看板列、置顶条、统计格。
- **井纸**（`oklch(92.7% 0.011 100.8)`）：嵌在纸里的东西——行内 code、mono 小标签、嵌套井。
- **发丝**（`oklch(88.7% 0.011 100.8)`）：一切分隔。**交互边**（`oklch(65.1% 0.009 248)`）：输入框、可选控件的边界——只有这一档才够 3:1，发丝不够。
- **头像五格**（`--av-0` … `--av-4`，`oklch(93.4% … 82.4% 0.004 100)`）：全是没有色相的纸灰，人类固定落在最深那格（`--av-4`）。头像不用彩色，是为了让「谁在动」只由状态点与状态词说。

**档位契约（每族四档，机械可验）** —— `app/globals.contrast.test.mjs`：

| 档 | 名字 | 用法 | 阈值 |
| --- | --- | --- | --- |
| fill | `--X` / `--X-fill` | 只有背景（徽标底、横幅底、章底），墨压其上 | `--fg` 压 fill ≥ 4.5:1 |
| deep | `--X-deep` / `--X-text` | 只在纸上作**文字** | 四种纸各 ≥ 4.5:1 |
| solid | 取 deep 作底 | 实印面，纸白压其上 | `--on-accent` ≥ 4.5:1 |
| graphic | `--X-graphic` | **只**做焦点环、状态点、边界 | 压 `--surface` ≥ 3:1 |
| soft | `color-mix(--X-fill 22–30%, transparent)` | 淡底，永不单独承担边界 | 与纸面 ΔL ≥ 3 |

命名上有一处必须记住的例外：**绿与琥珀的「文字档」叫 `--online-text` / `--working-text`，不叫 `--deep`**（历史命名，语义等同 deep）。软档不写死色值，一律用 `color-mix`：青 22%、品红 26%、黄 30%、绿 / 琥珀 / 红 / 灰 28%。

### Named Rules

**The One Ink Rule.** `--accent` 就是墨本身（`--accent === --fg === --accent-deep === --accent-graphic`）。主按钮、发送键、品牌标都是墨底纸白字。**不引入第二种强调色**——一旦出现第二个「主色」，四色角色就退化成了配色表。

**The Tier Rule.** `fill` 只能当背景（墨压其上），`deep` 只能当文字（纸压其下），`graphic` 只能做环、点、边界。把 `fill` 当文字或状态点，就是把一层淡印当成墨来用——对比度会直接崩。

**The Magenta-Means-Sign Rule.** 品红只表示「等你签」。**未读绝不是品红**：未读是墨底 + 数字的角标（`.badge`，纸白压墨）。搜索命中的 `<mark>` 借用品红 `fill` 档压墨字，是同一族在另一个视图里的第二个消费点，不与等审章同屏出现——不要把它推广成第五种语义。

## Typography

**Display Font:** 无（本系统没有 display 字面；最大的字是 16px 的频道名）
**Body Font:** 系统 sans 栈（`-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif`）
**Label/Mono Font:** 系统 mono 栈（`ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace`）

**Character:** 一支无个性的系统 sans 承担全部正文，一支等宽承担全部「机器说的东西」——标签、编号、时间、计数、章上的字。没有 webfont，没有斜体强调，没有字号跳跃；所有层级靠 0.5–2px 的字号差、字重和全大写等宽来区分。CJK 与拉丁在同一栈里，中英混排不会换脸。

### Hierarchy

- **Headline**（680，16px，1.5，字距 -0.02em）：频道标题。全屏只有这一处 16px。
- **Title**（680，14px，1.4，字距 -0.01em）：右栏面板名、线程摘要。消息作者名同为 14px，但用 650——比标题软一档，避免名字比内容更响。
- **Body**（400，13px，1.5）：一切界面文案——按钮、行、标签值、表单。13px 是密度基线，不要为了「更好读」把它整体吹大；需要更好读的地方是消息正文。
- **Prose**（400，14px，1.65，**行宽 ≤ 68ch**）：频道消息与线程回复的正文。这是全系统唯一被允许偏离 13px 的正文面（ADR-0016 的局部例外），也只在这里偏离——`.msg-text > .markdown-body` 同时给了 14px 与 68ch，两者绑定出现。
- **Label**（600，9.5px，字距 0.08em，全大写，mono）：分组标题、章、成员状态词、卡片的 mono 小标签。9.5px 是这套字阶的底，全大写 + 0.08em 字距让它在小尺寸仍然可读。
- **Meta**（400，10.5px，mono）：时间戳、计数、序号、`kbd`。
- 其余档位：11.5px 提示与卡片元信息、12px chip 与列表行、12.5px 按钮 / 频道描述 / 卡片标题、13.5px 品牌名与空态标题、17px 统计数字（mono，700）。

### Named Rules

**The Mono-Is-A-Label Rule.** mono 只出现在三类地方：标签（全大写、9.5px、字距 0.08em）、数字（编号、计数、时间、统计）、代码。**mono 不写句子**——一旦用等宽排一句自然语言，它就从「机器说的」变成了「另一种正文」。

**The 68ch Rule.** 消息正文的行宽上限是 68ch，字号同时是 14px。改其中一个就必须改另一个——只放大字号会得到更长的行，只收窄行宽会让 13px 的密度失去意义。68ch 不换算成像素：它随系统字体度量变化。

**The Tabular Rule.** 一切会并排比较的数字都开 `font-variant-numeric: tabular-nums`（计数、时间戳、`#` 编号、统计、轮次记录）。比例数字会让列表里的编号左右跳。

## Layout

**三栏壳**：左栏（频道 + 成员）／中栏（频道流、任务板、搜索）／右栏（单槽：agent 详情 / 线程 / 人类详情，**无选中时整栏不渲染**，中栏吃满宽度）。壳占满视口且 `overflow: hidden`，滚动归各自的列，页面本身不滚。

| 常量 | 值 | 用途 |
| --- | --- | --- |
| `--rail-w` | 252px | 左栏定宽（移动端抽屉沿用同一宽度） |
| `--dock-w` | 380px | 右栏桌面宽 |
| `--dock-w-md` | 340px | ≤1080 时收窄的右栏 |
| `--stream-max` | 1000px | 中栏内容列上限（消息流 + composer 共用） |
| `--board-col-w` | 236px | 看板列基准宽，最大 320px |
| `--modal-max` / `--modal-wide-max` | 440 / 560px | 弹层两档宽 |
| 搜索内栏 | 760px | 搜索结果列 |

**沟槽只有一条。** 中栏的一切（频道头 `13px 20px 0`、消息流 `18px 20px 8px`、任务工具条 `12px 20px`、composer `10px 20px 16px`）共用 20px（`--sp-9`）的左右沟槽与 `--stream-max` 的居中列，所以头、流、输入框的左缘永远对齐。右栏与弹层改用 16px（`--sp-7`）、弹层再放宽到 18px（`--sp-8`）。

**间距节奏**：4px 基、2px 半步（`--sp-1…--sp-12` = 2/4/6/8/12/14/16/18/20/24/30/56）。行内用 2–8px，块间用 12–18px，分节用 20–24px，空态留白用 56px。

**控件尺度**：输入与按钮 32px（`--control-h`），小按钮 27px，图标按钮 30px，头像 22 / 26 / 44px。`--tap-min` 44px 是产品层的触控下限声明——**当前壳里的 30/32px 控件仍在它之下**，这是一件未收口的事，不要拿这条去论证移动端已达标。

**断点**：

- **≤1080**：右栏压到 340px（`max-width` 收窄内联的 380px）。
- **≤900**：两栏退场成左右滑入抽屉（`--z-rail` 50 / `--z-dock` 55 + 40 的遮罩），中栏头部让出 52px 给汉堡位，看板从 5 列横排改成单列纵向堆叠、纵向滚动交给 `.board`。抽屉关闭态带 `visibility: hidden`，把离屏控件同时移出 Tab 序与无障碍树。
- **≤640**：表单控件字号强制 16px（避免 iOS 聚焦缩放）。

**密度取舍**：桌面端不发明视口魔数（不用 `46vh` 这类值），高度一律从容器算；看板列高跟容器可用高度走，纵向滚动在列内，列表视图则把滚动交回页面、工具条吸顶。

### Named Rules

**The One Gutter Rule.** 中栏所有块共用一条 20px 沟槽和 `--stream-max` 的居中列。新加一个块时先对齐这条线，而不是给它单独的内边距——左缘错开一像素，整页的「校样」感就没有了。

**The Column-Owns-Its-Scroll Rule.** 页面不滚。每一栏自己决定滚什么：中栏滚内容、看板滚列内、右栏滚面板、抽屉滚整体。给外壳加 `overflow: auto` 会让吸顶头（频道头、线程摘要、任务工具条）全部失效。

## Elevation & Depth

**混合，但以纸面分层为主。** 这套系统首先靠纸的四级明度（`--bg` → `--surface` → `--panel` → `--panel-2`）表达「谁在谁上面」，靠 1px 发丝表达「这里断开了」。阴影是第三种语言，只给真的浮起来的东西，而且全部带模糊与极低透明度：

- `--shadow-composer`（`0 1px 2px oklch(20% 0.009 264.4 / 0.05)`）：composer 外壳的常驻 1px 落影。它坐在页面上而不是浮层里，所以只有这一档。
- `--shadow-card`（`0 1px 3px -1px oklch(20% 0.009 264.4 / 0.12)`）：任务卡在 `:hover` 时才拿到。静止的卡片没有影子。
- `--shadow-pop`（`0 8px 24px -16px … / 0.32` + `0 1px 2px … / 0.1`）：真正的浮层——弹层、消息动作条、移动端抽屉、汉堡按钮。

静止的内容不带阴影：右栏线程的 composer 显式把 `--shadow-composer` 归零（`.tt-reply .composer-box { box-shadow: none }`），只有拿到焦点才出现 1px 的 accent 环。遮罩是压暗幕 + `backdrop-filter: blur(2px)`（现值 `oklch(33% 0.045 300 / 0.42)`，带极低彩度的冷相）。

### Shadow Vocabulary

- **Composer settle**（`0 1px 2px oklch(20% 0.009 264.4 / 0.05)`）：输入条与页面之间的纸厚。
- **Card hover lift**（`0 1px 3px -1px oklch(20% 0.009 264.4 / 0.12)`）：只在 `@media (hover: hover)` 下生效，防止触屏「粘住」。
- **Pop**（`0 8px 24px -16px … / 0.32`、`0 1px 2px … / 0.1`）：与页面脱离的一层。

### Named Rules

**The Flat-By-Default Rule.** 静止的表面是平的。阴影是状态（hover / 浮起 / 打开），不是装饰；给常驻卡片加影子会让「浮在页面上」这件事失去信息量。

**The Blur-Or-Nothing Rule.** 阴影必须带模糊且透明度在 0.05–0.32 之间。零模糊的硬偏移阴影属于另一个世界（更早的方向里被整体作废过），不要以「复古印刷」为由让它回来。

## Shapes

**近直角。** 圆角阶是 2 / 3 / 4 / 6px（`--r-sm…--r-xl`），而且 `--r-pill` 也只是 **3px**——所谓「胶囊」徽章、计数、reaction、分段控件全部是带 3px 倒角的方条。世界不画圆：状态点 7px 方点（1px 倒角）、套准标记 6px 方块（1px 倒角）、头像 26px 方砖（2px 倒角，lg 档 3px）、看板列头点 8px（3px 倒角）。

- **描边**：默认 1px。分隔一律 1px 发丝（`--border`）；只有需要「可交互」的地方才升到 `--border-strong`（3:1）。**用 1.5px 做框的只有章**：`in_review`（虚线）与 `done`（实线）靠这半像素读出「这是被盖上去的，不是框出来的」。
- **分隔**：横向用发丝、纵向用发丝、表格行用虚线发丝（`.kv`）。没有 2px 以上的**框线**，也没有双线（激活 tab / dock tab 的 2px 墨色下划线是标记，不是框）。
- **形状语言的一致性**：所有「点」都是方的；唯一的圆是 `border-radius: 50%` 在 agent 详情的头像色调色板上（14px 圆形色片，与方砖头像语言不符，属未收口漂移，新面不要照抄）。
- **旋转与斜切**：不使用。

### Named Rules

**The Near-Right-Angle Rule.** 任何新元素先取 `--r-sm`（2px）或 `--r-md`（3px）；输入外壳与 composer 可以用 `--r-lg`（4px），整块浮层才配 `--r-xl`（6px）。**不要发明 8/12/16px 的圆角**——那一套属于本轮作废的旧方向。`--r-pill` 不是许可去做真胶囊：它是 3px。

**The Square-Dot Rule.** 状态点、套准标记、头像、徽章都是方的（1–3px 倒角）。一个圆形的彩色点会立刻把这个界面拉回「普通 SaaS 状态灯」。

## Components

### Buttons

**性格：一张纸上的铅字块——平、方、字比框重。**

- **Shape**：高 32px，圆角 3px，1px 交互边，内边距 0 12px，字号 12.5px / 560，图标 13–14px（lucide）。
- **Primary（墨）**：墨底 + 纸白字；hover 走 `--accent-hover`（越按越浅）。左栏「新建频道」、发送键、品牌标都用它。
- **Default**：卡面纸 + 墨字 + `--border-strong`；hover 底色 `--fg-soft`、边框升到 `--faint`。
- **Ghost**：无边框无底，`--muted` 字；hover 才出现 `--fg-soft` 底。
- **Danger**：红字 + 45% 红边框；hover 10% 红底。用在拒绝 / 关闭 / 删除。
- **Small**：27px 高、0 9px 内边距、12px 字（消息锚点行的「打开任务讨论」用它）。
- **禁用**：`opacity: .45`，不改色相。
- **焦点**：全局 `:focus-visible` 是 2px `--accent-graphic`（墨）外环 + 2px 偏移；输入类改走「边框转 accent + 3px `--accent-soft` 环」，避免双环。

### Badges / Chips

- **Unread badge**：mono 10px / 700，最小宽 18px，2px 圆角，**墨底纸白字**——未读的表达是「一块墨 + 一个数」。软版（`.badge.soft`）用 `--fg-soft` 底 + `--muted` 字，表示「零」。
- **Card tag**（`#12`、未读回复数、reopened）：mono 9.5px，井纸底，`--muted` 字，4px 圆角。
- **Level chip**（`.lv.info/ok/warn/err`）：`soft` 底 + 对应 `deep` 文字档；16px 高，mono 9.5px / 700。
- **State chip**（分段控件、选中 chip、member-opt、radio-card）：选中态 = `--selected-soft` 底 + `--selected-graphic` 边 + `--selected-deep` 字。**青色只表示「你选了它 / 你在这」。**

### Cards & Columns

- **Task card**：卡面纸底、1px 发丝、3px 圆角、`10px 11px` 内边距。标题 12.5px / 600（`::after` 拉伸覆盖整卡作为唯一命中区），元行是 `#编号 + 章 + 标签 + owner`。
- **Board column**：栏纸底、1px 发丝、**2px** 圆角（比卡片更硬）、236px 起、最宽 320px，列头是 `8px 方点 + 状态词 + mono 计数`；列高跟容器，滚动在列内。
- **Right dock**：卡面纸底 + 左发丝（宽度由壳给，不重复声明边框）；顶部 `dock-head` 13px 16px 下接发丝；线程摘要是吸顶块（同底色 + 下边框），靠不透明底盖住滚上来的内容。
- **Empty state**：居中、`--faint` 字、lucide 图标 0.7 不透明、留白 56px，标题用 13.5px / 600 的 `--muted`。

### Inputs & Fields

- **Style**：卡面纸底、1px **`--border-strong`**（发丝不够 3:1，不能承担输入边界）、3px 圆角（composer 外壳与搜索大框 4px）、`8px 10px` 内边距、13px。placeholder 用 `--faint`。
- **Focus**：边框转 `--accent-graphic` + `0 0 0 3px var(--accent-soft)`。环只画在**外壳**上（`.search-btn` / `.search-field` / `.composer-box`），内层 `<input>`/`<textarea>` 显式清掉自己的环——否则会叠成双环、圆角也对不上。
- **Composer**：外壳 4px 圆角 + `--shadow-composer`，textarea 最大高 160px，动作条里可放工具图标、`As Task` 勾选与发送键；发送键是 30px 墨块。
- **Error / Disabled**：错误走红字或红边（`--error`），禁用走 `opacity: .45`；两者都不新增色值。

### Navigation

- **Rail row**（频道 / 成员）：`6px 9px` 内边距、圆角 2px、13px、`--muted` 字，行间 1px；hover 底色升到卡面纸 + 墨字。**激活行**：卡面纸底 + 1px 内阴影发丝（`inset 0 0 0 1px var(--border)`）+ 左缘 **2px 青条**（`left: -8px`，上下各让 6px）+ `#` 转 `--selected-deep`。
- **Channel tabs**（Messages | Tasks）：12.5px / 560，`--muted`；激活的是**墨色 2px 下划线**（不是色块），计数用 mono 10.5px，激活时计数转 `--selected-deep`。
- **Seg / 分段控件**：1px 发丝外框，激活段是**墨底 + 卡面纸字**（12.19:1）。
- **左栏结构**：品牌头（26px 墨方块标 + 13.5px 字 + 9.5px mono 副标 + 套准点）→ 搜索 → 两个创建按钮（主 + 次）→ 分组标题（mono 9.5px 全大写 `--faint`，字距 0.1em）→ 行 → 底栏图标（带墨底角标计数）。

### 付印章（Signature）

**一条任务等审时，它右侧出现一枚方形章——这是整张校样上唯一被「盖」上去的东西。**

- **形态**：mono 9.5px / 600、全大写、字距 0.08em、`1px 5px` 内边距、2px 圆角。默认 1px 描边，`in_review` 与 `done` 升到 1.5px（虚线 / 实线）。章内永远是**状态词**。
- **一态一形一墨**：

| 状态 | 框 | 字 | 底 | 词（zh / en） |
| --- | --- | --- | --- | --- |
| `todo` | 1px `--border-strong` | `--muted` | 无 | 待认领 / Pool |
| `in_progress` | 1px `--working` | `--working-text` | 无 | 进行中 / In progress |
| `in_review` | 1.5px **dashed** `--unread-graphic` | `--unread-deep` | `--unread-soft` | 待审 / In review |
| `done` | 1.5px **solid** `--online` | `--online-text` | 无（消息锚点行另加 10% 绿淡底） | 完成 / Done |
| `closed` | 1px `--border` | `--offline-deep` | 无 | 已关闭 / Closed |

- **署名**：`done` 且有 owner 时，把署名写进章里（`.signer`，600 字重，左 4px）——「完成 QUINN」。署名不是 tooltip，不是第二行，就是章的一部分。
- **两个载体，一套形**：看板 / 列表卡片用 `.card-stamp`（9.5px），消息下方的任务锚点行用 `.ws-task-anchor-status`（10px、`1px 6px`），状态规则逐条相同。锚点行的顺序固定：`任务 #N` → 「打开任务讨论」（`margin-left: auto`）→ 章。
- **系统事件行**（「任务 #2 已创建」）：没有底、没有框，只有一条顶部发丝 + 11px `--faint` 字——它是校样边上的记录条，不是消息。

**The Stamp Carries The Word Rule.** 章里永远印字，颜色只是第二线索。任何状态片、章、成员行、列头都必须「同色同词」；**只有颜色没有词**是本项目产品所有者的硬失败模式（状态要猜）。

### 成员存在态（Presence）

- **点**：7px 方块（1px 倒角），`online` 绿 / `working` 琥珀（脉冲 1.5s，`prefers-reduced-motion` 下停）/ `error` 红 / `offline` 灰。
- **词**：点旁边永远有一个 9.5px 全大写 mono 状态词（在线 / 正在干活 / 出错 / 离线），`--muted` 打底，`working` → `--working-text`、`error` → `--error`、`offline` → `--offline-deep`。
- **头像**：方砖 + 首字，五格纸灰按成员 id 确定性取色，人类固定最深格；内嵌 1px 14% 墨描边防糊边。

### 套准标记（Registration Marks）

栏头品牌名**下方一次性**出现四个 6px 方块（间距 3px、1px 倒角）：青 · 品红 · 黄 · 墨。这是印刷厂的四色套准标记，也是这套色板唯一一次同时出场。**全仓只有这一处**——它是一次签名，不是可以散播的小圆点装饰。

### 任务板

- 五列（待认领 / 进行中 / 待审 / 完成 / 已关闭），列头是 `8px 方点 + 状态词 + mono 计数`；列表视图的分组头沿用同一套语汇 + 一条把剩余宽度吃掉的发丝。
- 卡片上的动作按钮由**可达落点**决定（拖拽是服务端裁决的转移，不做乐观移动）；`drag-over` 列用 `--accent-soft` 底 + `--accent-graphic` 边，`invalid-over` 用红边，`dragging` 卡片降到 40% 不透明。
- 列头点走 `graphic` 档：`todo` = `--faint`、`in_progress` = `--accent-graphic`、`done` = `--online`、`closed` = `--offline`。`in_review` 当前落成 `--working`（琥珀），与它的品红虚线章不同族——这是**已知未收口漂移**，新面按 `--unread-graphic` 走。
- 批准 / 拒绝按钮由状态权威决定可见性；「关闭任务」是红字 danger 按钮。

## Do's and Don'ts

### Do

- **Do** 用 `--bg` / `--surface` / `--panel` / `--panel-2` 四级纸面表达层次，再用 1px `--border` 断开；不要先想阴影。
- **Do** 让每个状态「同色同词」：章、徽标、成员行、列头都印出状态词。
- **Do** 只从 `worksplice-design-system/colors_and_type.css` 与 `tokens.css` 取色、取尺度；`app/globals.css` 只在扩展层引用 `var(--token)`，不复制色值。
- **Do** 用 `--r-sm`（2px）/ `--r-md`（3px）做默认圆角，整块浮层才到 `--r-xl`（6px）。
- **Do** 用 `--border-strong` 承担输入框与可选控件的边界（它 ≥3:1），`--border` 只做分隔。
- **Do** 让 mono 承担标签、编号、时间、计数，并给所有数字开 `tabular-nums`。
- **Do** 消息正文用 14px 且行宽 ≤ 68ch；其余界面文案留在 13px。
- **Do** 图标只取 lucide（10–18px，`strokeWidth` 2–2.4），语义靠 `aria-label` / `title` 而不是形状猜测。
- **Do** 焦点态统一定义：纯导航元素用 2px `--accent-graphic` 外环；输入类用 accent 边框 + 3px `--accent-soft` 环。
- **Do** 给抽屉关闭态带 `visibility: hidden`，让离屏控件退出 Tab 序与无障碍树。
- **Do** 尊重 `prefers-reduced-motion`：脉冲停跳、过渡降到 0.001ms（属性级 reset 已挂在 `*` 上）。

### Don't

- **Don't** 把 `fill` 档当文字或状态点，也别拿 `soft` 档单独当边界——它们是印面与淡底，不是墨。
- **Don't** 用品红表示「未读」。未读是墨底角标 + 数字；品红只表示「等你签」。
- **Don't** 引入第二种强调色。`--accent` 就是 `--fg`；第二个主色会让四色角色退化成配色表。
- **Don't** 加零模糊的硬偏移阴影，也不给静止内容加阴影（线程 composer 已经把常驻阴影归零，别加回去）。
- **Don't** 做圆点、圆胶囊、圆形徽章。`--r-pill` 是 3px；状态点、头像、套准标记都是方的。
- **Don't** 让状态片只有颜色没有词（含列头、成员行、章、级别签）。
- **Don't** 用 emoji 当图标或装饰（reaction 的持久化数据除外）；也不要引入第二套图标语言。
- **Don't** 引入 webfont 或第三支字族；不要用 600 以上的字重去做「大标题」——这套字阶没有 display 层。
- **Don't** 把 13px 正文整体放大来「提升可读性」；可读性预算只给消息正文（14px / 68ch）。
- **Don't** 新增视口魔数（`46vh` 之类）或给外壳加 `overflow: auto`——高度从容器算，滚动归各列。
- **Don't** 用 8 / 12 / 16px 的圆角、2px 以上的框线或真正的圆胶囊；这些属于本轮作废的旧方向。
