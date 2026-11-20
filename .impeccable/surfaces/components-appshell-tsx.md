---
version: 1
slug: "components-appshell-tsx"
primary_target: "components/AppShell.tsx"
related_targets: []
---

# Surface brief · worksplice app shell

scope: 整个应用外壳——工作区栏 / 频道流 / 任务板 / 线程与 agent 详情坞 / 弹层与命令面板 / 移动端。Route `/`，单页 shell 内的全部视图。
mode: Operate。使用者是房间的人类 Owner，以及第一次试装的开发者。
audience & job: 读流并回消息、认领与评审任务、找人找活（成员状态 / 游标未读 / 搜索 / 提醒）、低频配置面。第一屏不点任何东西就必须看出：谁在动、我漏读什么、谁在等我裁决，且无需先看文档就能理解游标未读、freshness-hold 与非作者审批权。
constraints: 本地单机；双语 en / zh-CN 同步（`lib/i18n/messages/*`）；正文 ≥4.5:1、图形 ≥3:1；图标只用 lucide；消息不可变、freshness-hold、任务状态机零改动；三栏骨架与 1080 / 900 / 640 断点保留；13px UI 密度与 14px 消息正文、68ch 度量保留。
memorable moment: 整屏铺开温润的暖沙底面与柔角纯白工作区；唯一饱和赤橘色只出现在「此刻可点、需要你拍板」的动作与待审/未读信号上——一眼扫过就知道哪里需要我动手，静态信息全部安静退回暖灰与深咖墨。
unresolved: 无。

## Direction contract

THESIS: 把多 Agent 本地协作工作区放进一张呼吸感十足的暖沙直觉动作面：只有此刻可点击、或正在等你拍板的动作与未读信号才点亮饱和赤橘色，静态内容全退回温润暖石与深咖墨——它拒绝的类别默认，是把所有状态、边框和按钮都压成一片冷灰方框或过度极简黑白的开发者工具模板。
OWN-WORLD: 暖沙底面（`#F2EBE2`）承载柔角暖白工作面与详情坞（`#FCFBF9` / `#FFFFFF`）、温润暖石边框与深咖墨字（`#2B241F`）；唯一饱和赤橘（Terracotta Vermilion）严格保留给主动作（发送 / 批准 / 创建）、待审信号与游标未读；运行中状态用森林绿/暖琥珀实心胶囊与空闲态区分重量；柔和圆角（6 / 10 / 14 / 18px 与胶囊）；Plus Jakarta Sans + 汉字系统黑体配等宽右对齐预算/序号；完全退场旧校样世界的四色套准点、直角方框与虚线付印章。
STORY: 打开页面无需点击就立刻看见三件事——左栏顶部的实时房间脉搏（「N 位运行中 · M 项待验收」）与频道赤橘未读角标、中央暖白卡片内的赤橘游标未读分割线与待审批任务操作条、以及底部直白的默认路由与 freshness-hold 保护提示；点进待审项一键批准或退回，一切有颜色的地方就是你能动手的地方。
FIRST VIEWPORT: 暖沙底面外框（12px 间距与柔角分栏）：左侧 260px 暖沙工作区栏（品牌标识 + 房间实时脉搏胶囊、搜索框、主创建按钮、带白底柔角选中卡与赤橘未读胶囊的频道列表、带显式运行态胶囊的成员列表）；中央柔角暖白主卡片（频道头 + 胶囊分段「消息流 / 任务板（带待审计数）」页签 + 消息流 + 赤橘游标未读线 + 清晰待审卡 + 带默认路由与防撞锁说明的底部 composer）；右侧柔角暖白详情坞（Agent 实时焦点 / 统计 / 轮次或线程面板）。
FORM: Competitive challenger from digital-design-canon-warm-consumer-app-surface（暖沙直觉动作面 / Warm Action Surface），吸收 cassette-j-card 的右对齐预算/时间列与 zoo-gardens-guide-map 的状态芯片实心重量位移；seed:42382d731009a775。
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
