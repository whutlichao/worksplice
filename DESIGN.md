---
name: worksplice
description: 暖沙直觉动作面（Warm Action Surface）—— 暖沙画布、浮起暖白工作面、深咖墨与单一克制的朱砂红行动色。
colors:
  # 表面与发丝（暖沙底面 + 浮起暖白动作面）
  warm-sand: "oklch(93.8% 0.014 70)"
  warm-white: "oklch(99.2% 0.004 75)"
  sand-rail: "oklch(94.6% 0.013 70)"
  warm-oat: "oklch(90.6% 0.017 68)"
  warm-hairline: "oklch(86.5% 0.017 68)"
  warm-hairline-strong: "oklch(61% 0.018 60)"
  # 墨族（深咖墨 + 纸白）
  espresso-ink: "oklch(22.5% 0.015 50)"
  warm-umber: "oklch(41.5% 0.018 55)"
  warm-taupe: "oklch(44.5% 0.018 58)"
  on-accent: "oklch(99.5% 0.002 75)"
  # 唯一主强调色（朱砂陶土 · 行动与等你拍板）
  terracotta-vermilion: "oklch(54.5% 0.182 37)"
  terracotta-vermilion-hover: "oklch(49% 0.172 35)"
  terracotta-vermilion-deep: "oklch(50% 0.172 35)"
  terracotta-vermilion-graphic: "oklch(55% 0.182 37)"
  # 暖陶棕 · 当前位置与选中态
  warm-clay-selected: "oklch(82.5% 0.042 62)"
  warm-clay-selected-deep: "oklch(41.5% 0.068 55)"
  warm-clay-selected-graphic: "oklch(52% 0.075 55)"
  # 朱砂珊瑚 · 未读角标 / 待审 / 命中高亮
  vermilion-review: "oklch(86% 0.065 39)"
  vermilion-review-deep: "oklch(50% 0.172 35)"
  vermilion-review-graphic: "oklch(55% 0.182 37)"
  # 暖蜜赭石 · 警示 / 防撞锁 / 提醒横幅
  honey-ochre-warn: "oklch(86.5% 0.088 82)"
  honey-ochre-warn-deep: "oklch(44.5% 0.105 68)"
  honey-ochre-warn-graphic: "oklch(55.5% 0.125 68)"
  # 语义四态（森林鼠尾草绿 / 暖琥珀 / 深锈红 / 暖石灰）
  forest-sage-online: "oklch(50.5% 0.095 158)"
  forest-sage-online-fill: "oklch(86% 0.052 158)"
  forest-sage-online-text: "oklch(40.5% 0.085 158)"
  warm-amber-working: "oklch(53% 0.128 58)"
  warm-amber-working-fill: "oklch(86% 0.072 72)"
  warm-amber-working-text: "oklch(44.5% 0.112 56)"
  deep-rust-error: "oklch(45.5% 0.155 24)"
  deep-rust-error-fill: "oklch(85% 0.062 24)"
  warm-stone-offline: "oklch(54.5% 0.015 62)"
  warm-stone-offline-fill: "oklch(87% 0.012 65)"
  warm-stone-offline-deep: "oklch(43.5% 0.015 60)"
  # 头像五格（暖陶/暖沙/鼠尾草亚麻/暖麦/烤沙）
  avatar-oat: "oklch(90.5% 0.022 68)"
  avatar-apricot: "oklch(89.5% 0.032 48)"
  avatar-sage: "oklch(90% 0.028 148)"
  avatar-wheat: "oklch(89% 0.03 82)"
  avatar-toasted: "oklch(86.5% 0.022 58)"
typography:
  headline:
    fontFamily: "Onest, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Onest, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Onest, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  prose:
    fontFamily: "Onest, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "9.5px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.08em"
  meta:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "10.5px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  xl: "18px"
  pill: "999px"
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
    backgroundColor: "{colors.terracotta-vermilion}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.terracotta-vermilion-hover}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
  button-rail-primary:
    backgroundColor: "{colors.espresso-ink}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "32px"
  button-default:
    backgroundColor: "{colors.warm-white}"
    textColor: "{colors.espresso-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  input-field:
    backgroundColor: "{colors.warm-white}"
    textColor: "{colors.espresso-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "7px 10px"
    height: "32px"
  card:
    backgroundColor: "{colors.warm-white}"
    textColor: "{colors.espresso-ink}"
    rounded: "{rounded.lg}"
    padding: "12px 14px"
  nav-item-active:
    backgroundColor: "{colors.warm-white}"
    textColor: "{colors.espresso-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
  badge-unread:
    backgroundColor: "{colors.terracotta-vermilion}"
    textColor: "{colors.on-accent}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "0 6px"
    height: "18px"
  badge-soft:
    backgroundColor: "{colors.warm-oat}"
    textColor: "{colors.warm-umber}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "0 6px"
    height: "18px"
  status-pill-review:
    backgroundColor: "{colors.vermilion-review-deep}"
    textColor: "{colors.on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  status-pill-done:
    backgroundColor: "{colors.forest-sage-online-fill}"
    textColor: "{colors.forest-sage-online-text}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
---

# Design System: worksplice

## Overview

**Creative North Star: "暖沙直觉动作面（Warm Action Surface）"**

worksplice 是面向本地多 pi coding agent 的协作工作区：一个人类 Owner 在同一间安静的本地工作室里，同时浏览频道消息流、看板任务、线程讨论与 agent 状态。视觉世界以「暖沙底面上的浮起暖白工作纸」为核心隐喻——外围暖沙（`--bg`）托住左栏导航与两张圆角浮起的暖白工作纸（中央频道/任务面与右侧详情坞），让长时间盯屏既柔和耐看，又一眼分得清层级边界。

整套系统坚持「有颜色的地方就是你能动手的地方」：界面 90% 以上停留在暖沙、暖白、暖燕麦与深咖墨之间，将唯一饱和的朱砂陶土色（`--accent`）严格留给当前视口的主动作（发送、批准、新建任务）与等你处理的信号（真实未读角标、`in_review` 待审提示），绝不浪费在被动计数、静态装饰或普通正文上。所有状态都坚持「同色同词」，无需悬停或翻文档就能直读谁在干活、哪条未读、谁在等你拍板。

它明确放弃了旧版冷灰高锐度的校样直角风（2px 近直角、四色套准装饰点、虚线方形付印章、左侧单边激活条），转向更温润、直观、触感友好的软角浮卡与真实胶囊语言，同时完整保留 13px 紧凑操作密度、14px / 68ch 消息阅读预算、WCAG AA 对比度门禁与 `lucide-react` 单一图标纪律。

**Key Characteristics:**
- 暖沙外框（10px）托起 18px 柔角暖白主工作纸与右侧详情坞，层级靠表面明度差与极轻暖咖阴影共同建立。
- 单一饱和朱砂陶土色严格按「≤10% 行动色预算」使用；左栏创建按钮降为深咖墨（`--fg`），被动计数一律退回暖燕麦（`.badge.soft`）。
- 自托管可变字体 `Onest`（拉丁/数字）与 `JetBrains Mono`（序号/时间/状态词）无缝衔接中文字体栈（`PingFang SC` / `Hiragino Sans GB` / `Microsoft YaHei`），100% 离线可用。
- 首屏直读机制：左栏顶部常驻房间脉搏条（`.rail-pulse`），待审任务卡片直接呈现朱砂「待审」胶囊、一行审批权限提示（`.card-review-hint`）与主色「批准」CTA。
- 所有状态点、状态胶囊与成员存在态均坚持「同色同词」，零表情符号装饰，全部图标来自 `lucide-react`。

## Colors

全仓色值以 `oklch()` 为唯一真源（`worksplice-design-system/colors_and_type.css` 声明基础纸/墨/行动/语义四态与头像五格，`app/globals.css` 扩展层声明选中/未读/警示三个产品角色族），每个颜色家族都按 `fill / soft / deep / graphic` 四档受 `app/globals.contrast.test.mjs` 机械把关（正文 ≥4.5:1，图形边界 ≥3.0:1，淡底 ΔL ≥3.0）。

### Primary
- **Terracotta Vermilion（朱砂陶土）** (`--accent` / `oklch(54.5% 0.182 37)`，悬停 `--accent-hover` `oklch(49% 0.172 35)`，文字档 `--accent-deep` `oklch(50% 0.172 35)`，图形档 `--accent-graphic` `oklch(55% 0.182 37)`): 唯一饱和强调色，仅用于当前视口主 CTA（`发送消息`、`批准`、`+ 新建任务`）、真实未读角标、待审状态提示、输入聚焦环与 agent 作者识别。

### Neutral
- **Warm Sand（暖沙画布）** (`--bg` `oklch(93.8% 0.014 70)`): 应用最底层画布、桌面端 10px 四周外框与三栏间 10px 缝隙。
- **Warm White（暖白工作面）** (`--surface` `oklch(99.2% 0.004 75)`): 浮起的中央频道/看板纸面、右侧详情坞、任务卡片、输入框、激活导航胶囊与模态框主体。
- **Sand Rail（暖沙栏面）** (`--panel` `oklch(94.6% 0.013 70)`): 看板列底面、分段页签槽底、移动端抽屉背景与温和胶囊底。
- **Warm Oat（暖燕麦次井）** (`--panel-2` `oklch(90.6% 0.017 68)`): 房间脉搏条、被动计数徽标（`.badge.soft`）、轻量元信息胶囊、代码块与嵌套井。
- **Espresso Ink（深咖墨）** (`--fg` `oklch(22.5% 0.015 50)`): 主正文、标题、品牌标识底与左栏次级深色主按钮（`+ 新建频道`、看板分段选中态）。
- **Warm Umber / Taupe（暖褐 / 暖灰褐）** (`--muted` `oklch(41.5% 0.018 55)` / `--faint` `oklch(44.5% 0.018 58)`): 次级说明、时间戳、序号、占位提示与列表项目符号；四张浅纸上均 ≥4.5:1。
- **Warm Hairline / Strong（暖石发丝与交互边）** (`--border` `oklch(86.5% 0.017 68)` / `--border-strong` `oklch(61% 0.018 60)`): `--border` 只做分隔线与卡片静息轮廓；`--border-strong` 承担输入框、按钮与可选控件边界（≥3.0:1）。
- **Avatar Clay Palette（头像五格）** (`--av-0` 至 `--av-4`): 暖燕麦、暖杏陶、鼠尾草亚麻、暖麦与烤沙（人类 Owner 恒取 `--av-4`），按成员 ID 确定性取色，深咖墨首字压其上 ≥4.5:1。

### Semantic Status & Product Roles
- **Warm Clay Selected（暖陶棕 · 当前位置）** (`--selected*`): 锚点消息整圈描边与极淡底、激活导航序号与筛选开启态，沉稳落位不抢朱砂行动色。
- **Vermilion Review（朱砂珊瑚 · 等你处理）** (`--unread*`): `in_review` 待审实心胶囊、待审权限提示、搜索命中高亮与真实未读数。
- **Honey Ochre Warn（暖蜜赭石 · 警示）** (`--warn*`): freshness-hold 防撞锁、提醒与非致命提示横幅。
- **Forest Sage Online（森林鼠尾草绿 · 在线/完成）** (`--online*`): 在线状态点、`done` 完成署名胶囊与保存成功反馈。
- **Warm Amber Working（暖琥珀 · 工作中/进行中）** (`--working*`): 正在干活的脉冲圆点与 `in_progress` 状态胶囊。
- **Deep Rust Error（深锈红 · 出错/危险）** (`--error*`): 会话异常、拒绝/关闭危险操作与非法拖拽反馈。
- **Warm Stone Offline（暖石灰 · 离线/已关闭）** (`--offline*`): 离线成员与 `closed` 已关闭任务。

### Named Rules
**The One Action Voice Rule.** 饱和朱砂陶土色（`--accent`）在任一视口中严格控制在 ≤10% 面积内，只分配给当前主动作或真实待处理信号；被动计数（总回复数、成员数、无未读的任务总数）一律使用暖燕麦 `.badge.soft`，左栏全局创建入口收敛为深咖墨 `--fg`。

**The Four-Tier Discipline Rule.** 每个语义色族严格区分 `fill`（淡底压墨）、`soft`（低不透明度提示底）、`deep`（正文 ≥4.5:1）与 `graphic`（圆点/焦点环 ≥3.0:1），禁止混用档位导致对比度跌破 AA 下限。

**The Same Color, Same Word Rule.** 任何状态点、任务胶囊、列头或成员行都必须同时给出明确状态词（工作中 / 在线 / 离线 / 待审 / 完成），颜色永远只是第二线索。

## Typography

**Primary UI & Prose Font:** `Onest`（自托管可变 WOFF2，`400..700`）+ `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif`
**Monospace / Meta Font:** `JetBrains Mono`（自托管可变 WOFF2，`400..700`）+ `ui-monospace, "SF Mono", Menlo, Consolas, monospace`

**Character:** `Onest` 具备温润开放的字怀与克制的几何人文笔形，在 13px–16px 密排界面下与中文黑体（`PingFang SC`）重心贴合，毫无冷硬工业感；`JetBrains Mono` 开启 `tabular-nums`，让 `#seq` 序号、时间戳、计数徽标和全大写微标签严丝合缝对齐。

### Hierarchy
- **Headline（频道主标题）** (650, `16px`, line-height `1.4`, letter-spacing `-0.02em`): 顶栏频道名称（`h1`），紧跟朱砂 `#` 符号。
- **Title（面板与卡片标题）** (650, `14px`, line-height `1.4`, letter-spacing `-0.01em`): 右侧详情坞标题、线程标题与模态框标题。
- **Body（界面常规密度）** (400 / 550 / 600, `13px`, line-height `1.5`): 导航行、按钮、表单控件、工具条与列表项。
- **Prose（消息正文阅读预算）** (400, `14px`, line-height `1.55`, max-width `68ch`): 频道消息与线程回复正文，确保长段 Markdown 讨论长时间阅读不累眼。
- **Caption（次级提示与元数据）** (400 / 550, `11.5px`–`12px`, line-height `1.45`): 待审卡片审批权限提示（`.card-review-hint`）、房间脉搏条与辅助说明。
- **Meta / Label（等宽序号与分组头）** (400–600, `10.5px` / `9.5px`, letter-spacing `0.06em`–`0.08em`, `tabular-nums`): 时间戳、`#seq` 编号、徽标数字与左侧全大写分组标签（`频道` / `AGENT 成员`）。

### Named Rules
**The Quiet Instrument Type Rule.** 整套工作区不设巨幅 Display 字阶，界面密度锚定在 `13px`，仅把放大与行宽余量（`14px` / `68ch`）留给需要深度阅读的消息正文，所有动态数字强制 `tabular-nums`。

## Layout

- **三栏浮纸桌面骨架（`≥901px`）**：`.ws-shell` 在暖沙底面上留出四周 `10px` 外框（与 `env(safe-area-inset-*)` 合并）及 `10px` 栏间缝隙。左栏 `.ws-left` 固定 `252px`（`--rail-w`）直接落在透明暖沙画布上；中央 `.ws-center`（`flex: 1`）与按需展开的右侧详情坞 `.ws-right`（`380px` `--dock-w`）各自独立为带 `1px --border` 描边与 `18px` 圆角的暖白浮纸，内部各自独立纵向滚动，外壳永不整体滚动。
- **平板收窄（`≤1080px`）**：右侧详情坞自动收窄至 `340px`（`--dock-w-md`），保持三栏不挤压消息流可读宽度。
- **紧凑与移动端（`≤900px`）**：外框与缝隙归零，中央 `.ws-center` 恢复满屏无边框暖白画布；左栏与右栏转为带暖咖遮罩（`oklch(22.5% 0.015 50 / 0.36)`）的固定滑入抽屉（关闭态带 `visibility: hidden` 退出 Tab 序与读屏树）；顶栏左上角露出 `36×36px` 柔角汉堡按钮，标题左让 `52px`；看板五列自动堆叠为单列竖排并由 `.board` 承接纵向滚动。
- **小屏触控保护（`≤640px`）**：输入框字号锁定 `16px` 防止 iOS 聚焦放大，触控区遵循 `--tap-min`（`44px`）与安全区底距。

## Elevation & Depth

本系统采用「暖沙底面 + 浮起暖白纸面 + 极克制暖咖环境阴影」的三层深度语法，所有阴影统一以深咖墨色相 `oklch(22.5% 0.015 50 / α)` 着色，绝不使用纯黑或零模糊硬偏移阴影：

- **第 0 层（暖沙画布）**：`--bg` 与透明左栏 `.ws-left`、看板列 `.col`（`--panel`），承托全部工作内容。
- **第 1 层（工作纸与静息卡片）**：`.ws-center` / `.ws-right` 浮纸（`0 2px 10px -2px oklch(22.5% 0.015 50 / 0.06)`）、常驻输入盒 `--shadow-composer`、激活导航胶囊与分段页签的轻抬阴影。
- **第 2 层（交互抬升）**：任务卡片与动作条悬停时启用 `--shadow-card`（`0 3px 10px -4px ... / 0.12`），强化发丝边至 `--border-strong`。
- **第 3 层（临时浮层）**：模态框、命令面板、下拉菜单与移动端滑入抽屉使用 `--shadow-pop`（`0 12px 30px -14px ... / 0.28`）。

**The Lifted Paper Rule.** 静态信息层次优先通过暖沙（`--bg`/`--panel`）与暖白（`--surface`）的明度差和 `1px` 发丝边建立，阴影只用于「浮起的工作纸、悬停反馈与临时浮层」，不为装饰而堆叠多层重阴影。

## Shapes

圆角阶梯从旧版近直角整体升级为触感友好的暖沙软角体系：

- **微元与嵌套块（`--r-sm: 6px`）**：代码块、轻量提示块、下拉菜单项与内部小徽标。
- **标准控件（`--r-md: 10px`）**：按钮、输入框、搜索框、激活导航行、移动端汉堡按钮、小/中尺寸柔和圆角方形头像（`22px`/`26px`）与品牌标。
- **卡片与容器（`--r-lg: 14px`）**：任务卡片、看板列、输入区外壳（`.composer-box`）与大号详情头像（`44px`）。
- **主工作纸与模态（`--r-xl: 18px`）**：桌面中央 `.ws-center`、右侧 `.ws-right` 与模态框外框。
- **真胶囊与正圆（`--r-pill: 999px`）**：房间脉搏条、分段页签槽、未读与被动计数徽标、任务状态胶囊（`.card-stamp` / `.ws-task-anchor-status`）、成员存在态小胶囊与 `7px` 正圆状态点（`.presence`）。

**The Tactile Soft-Corner Rule.** 外层容器圆角永远大于内层子元素圆角（18px 纸面 → 14px 列与卡 → 10px 按钮与行 → 999px 胶囊与圆点），消除同心圆角打架与生硬方角割裂。

## Components

### Buttons
- **Shape:** 柔和圆角（`10px`，`--r-md`），常规高度 `32px`（`--control-h`），紧凑尺寸 `27px`（`--control-h-sm`）。
- **Primary（主画布/详情坞行动）:** 朱砂陶土实底（`--accent`）+ 暖白字（`--on-accent`），悬停切换 `--accent-hover`，用于 `发送消息`、`批准`、`+ 新建任务` 与模态主确认。
- **Rail Primary（左栏创建入口）:** 深咖墨实底（`--fg`）+ 暖白字（`--on-accent`），悬停轻提亮，保持高可辨识度且不与主画布朱砂 CTA 争抢焦点。
- **Default / Ghost / Danger:** 默认按钮为暖白底（`--surface`）+ `1px --border-strong` 描边；幽灵图标按钮（`30×30px`）静息无边框、悬停呈 `--fg-soft`；危险操作（关闭/删除）用深锈红（`--error`）文字并在确认后执行。

### Chips, Badges & Status Pills
- **Unread Badge（`.badge`）:** 全圆胶囊（`999px`），朱砂实底 + 暖白等宽数字，仅用于真实未读计数。
- **Passive Count Badge（`.badge.soft`）:** 全圆胶囊，暖燕麦底（`--panel-2`）+ 暖褐字（`--muted`），用于顶栏成员/置顶数、总回复数与无未读的开放任务数。
- **Task Status Pills（`.card-stamp` / `.ws-task-anchor-status`）:** 全圆胶囊 + 大写等宽状态词：`in_review` 为朱砂实底白字（全看板最醒目）；`in_progress` 暖琥珀淡底深字；`done` 森林绿淡底深字并带审批署名；`todo` / `closed` 为暖沙/暖石中性胶囊。

### Cards & Containers
- **Task Card（`.card`）:** 暖白底（`--surface`）、`1px --border` 描边、`14px` 圆角（`--r-lg`），悬停强化至 `--border-strong` 并升起 `--shadow-card`；点击整卡通过标题按钮 `::after` 扩展热区进入任务讨论，动作按钮浮于上层。
- **Pending Review Card（`in_review`）:** 直接显示朱砂「待审」胶囊、`11.5px` 朱砂文字审批权限提示（`.card-review-hint`）与主色朱砂「批准」CTA，首屏即可直觉决策。

### Inputs & Composer
- **Style:** 暖白底（`--surface`）、`1px --border-strong` 边界（满足 ≥3:1）、`10px`（普通字段）或 `14px`（`.composer-box`）圆角；聚焦统一采用 `--accent-graphic` 边框 + `3px --accent-soft` 柔和外光环，取消浏览器默认双环。
- **Composer Send:** `30×30px` 朱砂圆角方块（`--r-md`），禁用态自动退回暖燕麦（`--panel-2`）+ `--faint` 图标。

### Navigation & Tabs
- **Sidebar Nav（`.nav-row`）:** 落于透明暖沙底面，悬停透出 70% 暖白底；激活态抬升为实心暖白胶囊（`--surface` + 内嵌发丝边 + 轻阴影），彻底摒弃单边色条。
- **Channel Tabs（`.tabs`）:** 暖沙药丸底槽（`--panel` + `1px --border` + `999px` 圆角），当前激活页签（`消息` / `任务`）抬升为暖白胶囊 + 轻阴影。

### Signature Components
- **Room Pulse Strip（`.rail-pulse`）:** 位于左栏品牌头下方，暖燕麦圆胶囊单行汇总当前房间的实时态势（正在干活的 agent 数、在线人数或「房间安静」，以及右侧朱砂色未读总数），无需点开任何频道即可一眼掌握全局。
- **Member Presence Row:** 柔和圆角方形首字母头像 + 成员名 + 明确中文/英文状态词胶囊 + `7px` 正圆状态点（`working` 带 `1.5s` 轻呼吸脉冲，`prefers-reduced-motion` 自动停止）。

## Do's and Don'ts

### Do
- **Do** 用暖沙外画布（`--bg`）托起带 `18px` 圆角的暖白工作纸（`--surface`），并用 `1px --border` 与极轻暖咖阴影区分层次。
- **Do** 严格遵守单一饱和行动色预算：把 `--accent` 留给主 CTA、真实未读数与 `in_review` 待审信号；所有被动计数用 `.badge.soft`，左栏新建按钮用 `--fg`。
- **Do** 让每个状态「同色同词」：任务胶囊、看板列头、成员存在态与脉搏条一律同时展示明确状态词。
- **Do** 仅从 `worksplice-design-system/colors_and_type.css` 与 `tokens.css` 维护真源 token；`app/globals.css` 只在扩展层引用 `var(--token)`，不复制上游色值。
- **Do** 保持 `13px` 界面操作密度与 `14px` / `68ch` 消息阅读预算，所有动态数字、序号与时间戳启用 `JetBrains Mono` + `tabular-nums`。
- **Do** 全界面仅使用 `lucide-react` 图标，为交互图标提供 `aria-label` / `title`；移动端抽屉关闭态保持 `visibility: hidden` 退出 Tab 序。
- **Do** 尊重 `prefers-reduced-motion`（停止脉冲并将过渡收敛至 0.001ms）与触摸端 `@media (hover: hover)` 悬停守卫。

### Don't
- **Don't** 把饱和朱砂红浪费在被动计数（如总回复数、成员总数、无未读的任务总数）或列表圆点/普通加粗正文上。
- **Don't** 把 `fill` 档直接当正文颜色，或拿 `soft` 淡底充当输入框边界（字段边界必须走 `--border-strong`）。
- **Don't** 引入第二种饱和强调色、冷灰纯黑阴影、零模糊硬偏移阴影或 2px 以上粗结构边框。
- **Don't** 复活旧版 Press Proof 元素（2px 尖角按钮/汉堡键、四色套准点、虚线方形付印章、左侧单边激活竖条）。
- **Don't** 让任何状态只靠颜色表达而缺少文字标签，也不要新增 emoji 当 UI 图标（reaction 持久化数据除外）。
- **Don't** 在桌面端用内联 `padding: env(safe-area-inset-*)` 覆盖 `.ws-shell` 的 `10px` 暖沙外框，或给外壳加整体 `overflow: auto`。
- **Don't** 引入外部在线 CDN 字体或第三支字体；`Onest` 与 `JetBrains Mono` 必须由 `public/fonts/` 本地自托管。
