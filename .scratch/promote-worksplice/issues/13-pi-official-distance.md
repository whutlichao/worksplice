# 13 — 与 pi 官方的距离：pi server 阴影下的叙事 + 官方区纪律

**Type:** grilling
**Blocked by:** —
**Status:** resolved

## Question

[票 06 的调研](../research/outreach-list.md)带回三件与「pi 官方」有关的事实，合起来需要三个决定：

**事实一 · 定位风险（也是机会）**：pi 官方在规划 **"pi server"**，功能面与 worksplice 重叠。

> badlogic（pi 作者）：「**this is what pi server will be for.** shoehorning this on the current architecture will not work, due to the way extensions need to be started and stopped.」<https://github.com/earendil-works/pi/issues/5700#issuecomment-4779558575>

mitsuhiko（earendil-works 创始人、Flask 作者）保留该 issue 作为多 agent 讨论位。**A 档已有三人（shmuelamit、tristone13th、prassanna-ravishankar）当面追问 pi server 进展，截至 2026-10-03 无公开答复。**
同一份证据里也有好消息：pi README 原文「skips features like sub-agents and plan mode… **install a package that does it your way**」——**外挂/package 路线在官方立场上是受认可的**。

**事实二 · 官方区的推广红线**：`CONTRIBUTING.md` 明文「All issues and PRs from new contributors are **auto-closed by default**」；「spam the tracker with agent-generated issues, your GitHub account will be **permanently blocked**… No taksies backsies.」**这是账号级、不可逆的风险。**

**事实三 · 同类展示帖的实际成绩**：6 条 Show & tell 帖里 **5 条 0 评论、最佳 1 条**。

### 要定的三件事

- **(a) 首发叙事要不要主动交代与 pi server 的分工？**
  - 主动交代（把自己讲成「今天就能用、本地、可读」的方案，并承认未来可能有官方版本）vs 不提（等被问）。
- **(b) 票 07 日历里的 D-2「pi Discussions 留档帖」还发不发？**
  - 收益近零（同类帖 5/6 零评论），而官方区对推广的敌意是账号级的——虽然封号条款针对 issue/PR，Discussions 是另一个面（已有 6 人在这里发过展示帖）。
- **(c) 一对一触达纪律是否写死为「只走对方仓库、绝不去 pi tracker」？**（票 06 已按此记录，这里把它确认为硬约束。）

**产出**：三条决定；若 (a) 选主动交代，给出一句话的**分工假设**（写进首发文案与一对一开场，回写票 02 的定位句与票 06 的话术）；若 (b) 选不发，回写票 07 的日历（删掉 D-2 那一行）。

## Answer

2026-10-03 谈定（三条全部按推荐定案）。

### (a) 主动交代与 pi server 的分工 —— 放「诚实说明」段，不放开场

一句话（中英各一版，进首发长帖的诚实说明段与一对一开场）：

> **EN** — One honest note on overlap: pi's roadmap includes a **pi server** that will cover part of what worksplice does. This is the version that exists today — local, one SQLite file, readable end to end — and if the official one makes it redundant, that is a good outcome.
>
> **中文** — 一句实话：pi 的路线图里有 **pi server**，会覆盖 worksplice 的一部分。worksplice 是**今天就能用**的那个版本——本地、一个 SQLite 文件、从头到尾可读；如果官方版本让它变得多余，那是好事。

放段落的理由：这是加分项而不是主菜——主动说出来显得想过，但放在开场会把自己变成"pi server 的影子"。**A 档三人已经公开追问过 pi server 进展**，回避的代价比承认高。

### (b) D-2 的 pi Discussions 留档帖 —— 发，但改成「技术留档」定位

- **纯技术留档，不带任何请求**（不写"欢迎试用""求反馈"，不 @ 任何人）。
- 成本几乎为零；封号条款针对 **issue/PR**，Discussions 是另一个面（已有 6 人在这里发过展示帖）。
- 它的价值是：**Discord 主帖可以引用的公开落点** + 被搜索到。
- 票 07 的日历 D-2 那一行据此改写（原措辞是"改造现有草稿"，现在要**删掉草稿里的邀请与推销语气**，只留技术内容 + 仓库链接）。

### (c) 一对一触达纪律 —— 写死为硬约束

**只走对方自己的仓库与私聊（GitHub issue 技术讨论 / 仓库里留下的联系方式），绝不去 `earendil-works/pi` 发 issue 或 PR。**

依据（原文在 [research/outreach-list.md](../research/outreach-list.md)）：`CONTRIBUTING.md`「All issues and PRs from new contributors are auto-closed by default」＋「spam the tracker with agent-generated issues, your GitHub account will be **permanently blocked**. No taksies backsies.」——风险是**账号级、不可逆**的，赌的是推广主账号 `whutlichao`。

另外两条来自票 06 的话术纪律继续有效：不群发同一段文字；不提同类项目的优劣（同行作者用「不同层」框架）。

### 回写

- 票 02 的定位句**不改**（分工假设是长帖里的一段，不是定位句的一部分）。
- 票 07 的日历 D-2 行改写（见 (b)）。
- 票 06 的触达纪律升格为硬约束（其 §4b 已按此记录）。
