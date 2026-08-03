# Raft 视觉参考与马卡龙配色研究

> Wayfinder Ticket 02：为"马卡龙配色"风格复刻提取 raft.build 的设计参考。
> 研究方法：抓取 raft.build 生产站点的 HTML/CSS 源码（`/assets/main-vCnKLAWl.css`）与运行时 computed style（Playwright），配合 docs 站 CSS 与 raft-docs 开源仓库的 commit 记录交叉验证。所有 hex 值均来自实际源码，非推测。

---

## 1. 品牌与配色概览

Raft（raft.build，AI agent 协作平台）自称 **brutalist**（粗野主义）设计体系——官方命名空间即 `--color-brutal-*`。它的视觉配方是"马卡龙 × 粗野主义"的混合体：

- **奶油色纸面**：页面底色为奶油白 `#fffaef`（`--color-brutal-cream`），偶用纯白区块分隔，制造"纸张/卡片"感。
- **粉彩高饱和点缀**：黄、粉、青、橙、柠檬绿、薰衣草紫六种柔和粉彩色（马卡龙本尊），大量用作大面积色块（导航栏、跑马灯条、头像、按钮），而非仅作强调色。
- **墨色结构线**：文字与线条统一用"ink"深色 `#141111`，2px 粗边框 + 0 圆角 + 硬偏移阴影（`2px 2px`/`4px 4px`/`6px 6px`）——这是 brutalist 的一面，保证粉彩底色不显腻。
- **千禧年怀旧**：用户证言称其 UI 有"millennial web chat nostalgia"；agent 头像是 8x8 像素网格（`image-rendering: pixelated`）的彩色方块，代码用 Space Mono 等宽字体。
- **整体氛围**：明亮、糖果色、硬朗线条、游戏感（"Build with Raft. Build with fun."），无深色模式（仅亮色一档）。

语义映射（源码确认）：**primary = 品牌黄**、**accent = Bubble Pink**、**secondary = stone 灰**；状态色 info = 青、success = 绿、warning = 琥珀、danger = 珊瑚红。

---

## 2. 色板 token 表

### 2.1 品牌色（"brutal" 系列，源码 `:root` 定义，全部确认）

| 名称 | Hex | 用途 | 来源 |
|---|---|---|---|
| Brutal Cream | `#fffaef` | 页面背景（body 背景实测 `rgb(255,250,239)`） | ✅ CSS 变量 + computed style |
| Brutal Yellow | `#ffd440` | **品牌主色（primary）**：导航栏、跑马灯条、页内高亮、文档站当前页位置色 | ✅ CSS 变量 |
| Brutal Pink "Bubble Pink" | `#fe7da8` | **强调色（accent）**：所有 CTA 按钮（"Get started"）底色、hover 态 | ✅ CSS 变量 + raft-docs commit |
| Brutal Cyan | `#27ccf3` | 状态 info、像素头像、色块点缀 | ✅ CSS 变量 |
| Brutal Orange | `#f8a16f` | 像素头像、色块点缀 | ✅ CSS 变量 |
| Brutal Lime | `#a9d877` | 色块点缀（`bg-brutal-lime`） | ✅ CSS 变量 |
| Brutal Red | `#f97264` | 状态 danger / 珊瑚红点缀（正文 74 处内联出现，为红色高亮字色） | ✅ CSS 变量 |
| Brutal Lavender | `#bbafe6` | 薰衣草紫点缀、像素头像 | ✅ CSS 变量 |
| Brutal Stone (400) | `oklch(78.9% .014 71.29)` | 中性灰（secondary），浅灰阶（50–950 全阶可用） | ✅ CSS 变量（仅 oklch，未给 hex） |
| Ink / Black | `#141111` / `oklch(0% 0 0)` | 文字、2px 边框、硬阴影色；纯黑用于边框（border-black） | ✅ CSS 变量 + computed style |

### 2.2 文字色阶（brutal 主题 `[data-theme=brutal]`，全部确认）

| 名称 | 值 | 用途 |
|---|---|---|
| foreground-strong / foreground | `oklch(18% .006 25)` ≈ `#141111` | 正文、标题（实测 h1/body color `rgb(20,17,17)`） |
| foreground-muted | 同上 / 60% 透明度 | 次级文字 |
| foreground-placeholder | 同上 / 50% | 占位符 |
| foreground-disabled | 同上 / 30% | 禁用态 |
| foreground-inverse | `oklch(100% 0 0)` | 反色文字（深底上用） |

### 2.3 状态色（确认）

| 名称 | 值 | 用途 |
|---|---|---|
| info | `#27ccf3`（brutal-cyan） | 信息态 |
| success | `oklch(71.4% .176 153.079)`（薄荷绿） | 成功态 |
| warning | `oklch(70% .202 44.441)`（琥珀黄） | 警告态 |
| danger | `oklch(61.6% .249 26.758)` ≈ `#f97264` | 错误态 |

### 2.4 推断/未确认项

| 名称 | 值 | 说明 |
|---|---|---|
| Stone 中性灰 hex | 未提供 | 仅 oklch；复刻可用 `#c9c7c2` 一类近似（推断值，勿当官方色） |
| 各色 50–950 色阶 | oklch 全阶存在 | 未逐一换算 hex；需要时可按 oklch 转换 |
| "Elegant" 主题 | `[data-theme=elegant]` 在 CSS 中完整定义（深色面板 `oklch(21% .006 285)`、深页面 `oklch(14.5% 0 0)`） | 当前站点未启用、无切换入口，属备用主题（推断） |
| docs 站（VitePress） | 使用同款 token：`#ffd440`、`#fe7da8`、`#f8a16f` 均在 docs CSS 中出现 | 与 landing 一致，确认 |

> 说明：用户任务描述假设 docs.raft.build 是 Mintlify 样式——实际核实为 **VitePress**（raft-docs 仓库 botiverse/raft-docs，自研 `custom.css` 注入 brutal token）。

---

## 3. UI 组件风格

### 3.1 圆角与边框
- **全局 0 圆角**（方角直角）。`--radius-sm/md/lg` 虽有定义（.25/.375/.5rem）但页面实测按钮、卡片、消息气泡 `border-radius: 0px`。
- **2px 黑色/ink 粗边框**贯穿所有组件：卡片、按钮、消息气泡、导航栏底边、section 分隔线（`border-y-2 border-black`）。
- 分隔方式：section 之间用 2px 黑边横线分隔，非留白卡片堆叠。

### 3.2 卡片（`.card-brutal`，源码确认）
```
border: 2px solid black（纯黑）
background: white
box-shadow: 4px 4px 0px #141111（硬偏移阴影，无模糊）
border-radius: 0
```
硬阴影阶梯：`shadow-brutal-sm` = `2px 2px 0`、`shadow-brutal` = `4px 4px 0`、`shadow-brutal-lg` = `6px 6px 0`、按压态 `shadow-brutal-active` = `1px 1px 0`。hover 时阴影增大一档（物理感"抬起"）。

### 3.3 按钮（实测 computed style）
- 主 CTA：**Bubble Pink `#FE7DA8` 底 + 黑色文字 + 2px ink 边框 + `2px 2px 0` 硬阴影 + 0 圆角**，Hanken Grotesk 700。
- 文档站导航 CTA 规格（raft-docs commit 记录）：32px 高、12px 水平 padding、13px 字号、无阴影/轻量 shadow-brutal-sm、hover 抬起、active 按压。
- 语义：**粉 = 行动**（CTA），**黄 = 当前位置/状态**（导航高亮、跑马灯），与 brand token 完全对应。

### 3.4 字体（源码 + 加载字体双重确认）
| 角色 | 字体 | 用途 |
|---|---|---|
| 正文/标题 | **Space Grotesk**（400–700） | body 实测默认字体；h1 60px/700 |
| 按钮/heading token | **Hanken Grotesk**（`--heading-font`） | CTA 按钮实测 |
| 等宽 | **Space Mono** / Geist Mono（`--font-mono`） | 代码、时间戳、等宽文本（实测 12px） |

### 3.5 布局与页面结构（首页实测）
1. **导航栏**：黄色 `#FFD440` 整条底色 + 底部 2px 黑边。
2. **Hero**：奶油底 + 60px 大标题 + 粉/黄等色块；内嵌**聊天 mock**（白底消息气泡、2px 黑框、0 圆角、Space Mono 时间戳、像素头像）。
3. **信任 logo 跑马灯**：黄色底 + 上下 2px 黑边，logo 灰度 + `mix-blend-multiply` 叠加。
4. **Features**：纯白底，三列卡片。
5. **Testimonials**：奶油底，2px 黑边上下分隔。
6. **像素头像**：8x8 CSS grid + `image-rendering: pixelated`，底色取自马卡龙色板（橙/粉/黄/青/紫），尺寸 28/40/44/48px——这是"千禧年怀旧"的关键细节。

### 3.6 主题模式
- 仅**亮色**一档（奶油亮色），无深色模式切换、不响应 `prefers-color-scheme`。
- CSS 内含未启用的 `[data-theme=elegant]` 深色变体（备用）。

---

## 4. 截图 / 来源链接

**本地截图（本研究产出）**
- `.scratch/raft-clone/research/raft-home-top.png` — raft.build 首页首屏截图（Playwright 实拍，可用于视觉对照；注意：AI 分析时本模型不支持读图，颜色参数全部由 CSS 源码与 computed style 验证）

**在线来源**
- 首页：https://raft.build/ （og-image 为 https://raft.build/android-chrome-512x512.png，无独立 og 大图）
- Launch 视频："Watch the launch video"（首页导航 CTA，未单独抓取）
- 博客：https://raft.build/resources/blog/ （文章页与首页同款奶油/ink/Space Grotesk）
- 文档站：https://docs.raft.build/ （**VitePress**，非 Mintlify；token 同源）
- raft-docs 开源仓库：https://github.com/botiverse/raft-docs （commit a9cef7e 确认 `#FE7DA8` "Bubble Pink" 命名、brutal 按钮规格）

**未能获取**
- 产品应用界面（app.raft.build 需登录）的实际截图与内部 UI token——未获取，产品内配色可能与 landing 不同。
- 官网未提供设计系统页/品牌规范页。

---

## 5. 复刻速查（结论）

马卡龙复刻的核心六色：`#fffaef`（奶油底）、`#ffd440`（主黄）、`#fe7da8`（粉）、`#27ccf3`（青）、`#f8a16f`（橙）、`#a9d877`（柠檬绿）、`#bbafe6`（薰衣草紫）、`#f97264`（珊瑚红），配合 ink `#141111` 的 2px 粗边框 + 0 圆角 + 2/4/6px 硬阴影 + Space Grotesk/Space Mono，即可还原"马卡龙 × brutalist"的 raft 观感。
