# worksplice — design system

> Category: Project Design System · Surface: web
> Direction: **press proof**（校样纸 + 墨 + 四色角色 + 方形付印章）
> Machine source: `colors_and_type.css`（色与字）、`tokens.css`（间距 / 圆角 / 阴影 / 布局）。
> 本文件是**人向摘要**；构建后的完整契约以仓库根 `DESIGN.md` 为准。

## 1. 方向

房间是一张校样。每个任务带着校次与签名；没有任何工作能在缺少第二个人署名时看起来「完成」。
它拒绝的类别默认，是把工作状态藏在悬浮提示里的聊天气泡流。

## 2. 色法

- 纸：`--bg` 校样白 / `--surface` 卡面 / `--panel` 栏与井 / `--panel-2` 嵌套井。
- 墨：`--fg` / `--muted` / `--faint`，外加发丝 `--border` 与交互边 `--border-strong`。
- **四色只做角色，不做装饰**：
  - 青 `--selected*` — 当前所在（导航激活、锚点、选中）
  - 品红 `--unread*` — 等你审的那一类（`in_review` 章、审阅请求）
  - 黄 `--warn*` — 进行中 / 待办提示
  - 绿 `--online*` — 付印 / 完成
  - 红 `--error*` — 退校 / 出错（与品红分开，不许混用）
- 每一族四档：`fill`（淡印面，压墨）· `soft`（淡底）· `deep`（文字档，压纸 ≥4.5:1）· `graphic`（环·点，压纸 ≥3:1）。
  `--accent` 是墨族：它的 base 就是实印面，纸白压其上。
- 状态永远**同色同词**：任何状态片、章、成员行都写出状态词。颜色不是唯一线索。

## 3. 字

系统 sans（`--font`）+ 系统 mono（`--mono`），不引入 webfont（CJK 与拉丁同栈）。
13px 界面正文、14px 消息正文 / 68ch、9.5px 全大写等宽标签、等宽数字 `tabular-nums`。

## 4. 形态

圆角 2 / 3 / 4 / 6px（`--r-sm…--r-xl`），发丝边框，阴影只用于浮层（`--shadow-pop`）。
签名动作是**方形付印章**：`in_review` 虚线品红、`done` 实线绿并带署名、`closed` 灰、`in_progress` 黄、`todo` 墨。
印章之外不加装饰：四色套准点只出现在栏头一次。

## 5. 反模式

- 不把 `fill` 当文字或状态点；不用品红表示「未读」（未读是墨底 + 数字）。
- 不加第二种强调色；不为好看降低密度；不发丝以外的重边框；不用零模糊硬阴影。
- 不让状态片只有颜色没有词；不引入第二套图标语言（只用 lucide）。
