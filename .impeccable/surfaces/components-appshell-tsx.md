---
version: 1
slug: "components-appshell-tsx"
primary_target: "components/AppShell.tsx"
related_targets: []
---

# Surface brief · worksplice app shell

scope: 整个应用外壳——工作区栏 / 频道流 / 任务板 / 线程与 agent 详情坞 / 弹层与命令面板 / 移动端。Route `/`，单页 shell 内的全部视图。
mode: Operate。使用者是房间的人类 Owner，以及第一次试装的开发者。
audience & job: 读流并回消息、认领与评审任务、找人找活（成员状态 / 游标未读 / 搜索 / 提醒）、低频配置面。第一屏不点任何东西就必须看出：谁在动、我漏读什么、谁在等我裁决。
constraints: 本地单机；双语 en / zh-CN 同步（`lib/i18n/messages/*`）；正文 ≥4.5:1、图形 ≥3:1；图标只用 lucide；消息不可变、freshness-hold、任务状态机零改动；三栏骨架与 1080 / 900 断点保留；13px 密度与 14px 消息正文、68ch 度量保留。
memorable moment: 一条任务等审时，它右侧出现一枚方形付印章：虚线圈是待校、绿框是付印签（带署名与时间）、红框是退校；批准必须由作者以外的人按下。
unresolved: 无。

## Direction contract

THESIS: 房间是一张校样：每个任务带着校次与签名，没有任何工作能在缺少第二个人署名时看起来「完成」——它拒绝的类别默认，是把工作状态藏在悬浮提示里的聊天气泡流。
OWN-WORLD: 校样白与墨；四色只做角色（青=动作与焦点、品红=等你审、黄=进行中、绿=付印、红=退校）；发丝规则、0–3px 圆角；全大写等宽标签与等宽数字；唯一装饰是方形付印章。
STORY: 打开频道不点任何东西就看见三件事——谁在动、我漏读过什么、谁在等我签名；读到带章的那一条，按付印或退校，状态只有作者以外的人能改。
FIRST VIEWPORT: 252px 校样白栏（名称 + 四色套准点、搜索、墨色主按钮、五条频道带未读、六行成员带状态词）；1000px 消息列（频道头 + 消息/任务页签 + 四条消息：46px 序号时间栏、22px 首字块、作者、13px 正文 68ch、带词的状态片、右端方形章）；底部 composer 与路由提示。
FORM: 七个 grounded 方向中的第 5 位（印刷厂校样 / press okay）；seed:a946e85ad432fd91。
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
