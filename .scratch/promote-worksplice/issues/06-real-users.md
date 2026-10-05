# 06 — 真实用户：判定标准、反馈入口、触达名单与话术

**Type:** grilling
**Blocked by:** —
**Status:** resolved

## Question

验收指标是「**≥3–5 个真实用户装上并给回反馈**」（Q4），而这本质是**私聊工作**而不是发帖工作（Q10）。要定四件事：

1. **「真实用户」怎么算**：装上并跑起来？跑过一轮 agent 协作？还是给出任意一句反馈？标准要能证伪「这东西有没有用」——不是「有人 star 了」。
2. **反馈从哪收**：worksplice 仓库开 Discussions？加一个「我用了」的 issue 模板（仓库已有 bug_report 模板与 SECURITY.md）？私聊？还是 README 里一句明确的邀请？
3. **触达谁**（名单要具体到可执行）：pi Discord 里哪些人/频道；pi Discussions 里问过「多会话 / 跨会话工具 / 协作 / 共享上下文」的帖子作者（landscape 已列 Top 讨论，如 2025-12-22「Thoughts on implementing "cross sessions" tools?」）；扩展作者（例如 `agent-chat` 的作者——同类不一定是敌人的判断要在这里做）；以及身边真在用 pi 的人。
4. **话术**：第一句怎么说不被当成广告。V2EX 的教训是「为发广告而注册会被当场识破」；Discord 各频道也有自我推广规范——话术要按「我在解决自己的一个具体问题」来写，而不是「请 star 我的项目」。

**产出**：判定标准 + 反馈通道 + 一份具体到人的触达名单与话术模板（可直接复制发送）。

## Answer

2026-10-03 谈定（四个决策全部按推荐定案）。名单由调研子代理产出，落在 [research/outreach-list.md](../research/outreach-list.md)。

### 1. 判定标准（两条线分开记）

| 线 | 判据 | 用途 |
| --- | --- | --- |
| **反馈数**（验收线） | 装上并给出**任意一句真实反馈**——**含「装不上」「看不懂」** | 验收是否达标（≥3–5） |
| **有效用户数**（讲故事线） | 跑过**一轮真实的 agent 协作**（频道里真的产生了 agent 的消息或任务状态变化） | 对外引用 |

**不算数**：star、转发、点进来看看。landscape 已经证明 star 与使用无关（claude-squad 首发 HN 只拿 5 分却有 8,561 stars，agentapi 拿 163 分只有 1,500 stars）。

### 2. 反馈入口

- **新增 issue 模板** `.github/ISSUE_TEMPLATE/tried-it.md`（Markdown 模板，与现有 `bug_report.md` 同体例；需要新建 `feedback` 标签）。**故意做短**——每多一个必填字段，就少一个真人：
  - `What happened`（一句话就够：装上跑起来了？卡在哪？看懂了还是没看懂？）
  - `Where it stopped`（勾选：没装上 / 跑起来但不知道下一步做什么 / agents 没干出有用的事 / 其它）
  - `Environment`（怎么装的、Node 版本、有没有 pi、平时跑几个 pi 会话）
  - `Anything else`（截图/报错/想法；**不要贴 key 与原始 session 内容**——沿用 bug_report 的安全提示）
- **README 中英双版各加一句邀请**：位置定在 **`## Try It with Demo Data` / `## 用演示数据试试` 一节末尾**（那正是读者"刚试完"的时刻），`## Contributing` / `## 参与贡献` 再补一行。
  - EN：`Tried it? [Tell us what happened](https://github.com/whutlichao/worksplice/issues/new?template=tried-it.md) — "it did not work" is a useful answer.`
  - ZH：`试过了？[说说发生了什么](https://github.com/whutlichao/worksplice/issues/new?template=tried-it.md)——「没装上」同样是有用的答案。`
- **不开 GitHub Discussions**：landscape 已证明这类展示位实际使用率极低（pi Discussions 同类帖历史最佳 1 条评论），多开一个面只是多一个没人看的地方。

### 3. 触达姿态与话术

**姿态**：先展示、对方感兴趣再求助；**明确愿意为前 3 个人手把手陪跑**——这同时补上「从源码安装 → 一行安装」这段你自己还没走过一遍的路。

**话术三段式（≤120 词，禁止群发感）**：

1. **锚定他公开说过的一句具体的话**（引用原话 + permalink 语境）——这一句就证明不是群发；
2. **一句话定位 + 一个链接**（README 或 90 秒录屏，按对方偏好：写代码的人给 README，玩工具的人给录屏）；
3. **低门槛、可拒绝的请求**：不求 star，只问一件事——「你也在跑多个 pi 会话吗？愿不愿意试一下；**装不上或看不懂都算反馈**，我可以陪你把它跑起来。」

**禁忌**：不提"竞品/同类项目"的优劣；不在公开频道 @ 人做推广；不群发同一段文字（Discord 与 V2EX 的教训都在 landscape 里）。

**同行作者单列一类**（A 档里的 `agent-chat` 作者等）：开场用「不同层」框架——「你写的 agent-chat 有意不做编排器，我做的正好是那一层，想听你的意见」，不比较优劣。

### 4. 触达名单

全文（23 人、每人含 handle / 生态位置 / 公开言行 permalink / 为什么值得接触 / 开场第一句）落在 [research/outreach-list.md](../research/outreach-list.md)。**优先 12 人**（其余 11 人是备选池，第一批无人回应时替换）：

| 档 | 优先人选 |
| --- | --- |
| **A 档 · 明确在做多会话/协作的人** | **nicobailon**（pi 生态下载量第一：pi-mcp-adapter 51.4 万次/周；且亲手做过共享 chat room / 会话间通信 / session sharing）、**tristone13th**（唯一描述**已跑起来**的多会话并发，需求清单与 worksplice 逐条对齐）、**Hysilens-Helektra**（agent-chat 作者，「有意不做编排器」，理念最接近）、boadij、tmustier、tintinweb、prassanna-ravishankar、shmuelamit、liushihao456 |
| **B 档 · 扩展/工具作者** | alennartz、heresyrj（两人都是「一进程多会话」的架构级踩坑者，与 worksplice 同构） |
| **C 档 · 高活跃用户** | eterps（pi 社区评论最多的讨论 #3373 的作者；**明确只用 GitHub、不用 Discord**，是最容易命中的高价值目标） |

**最值得先接触的 3 人**：nicobailon（技术深度＋分发杠杆双高）、tristone13th（需求清单逐条对齐）、Hyselens-Helektra（理念最接近，但账号很新，当作一次性高质量技术对话）。

### 4b. 触达纪律（有原文证据，写死）

1. ⛔ **绝对不要用 `whutlichao` 去 `earendil-works/pi` 发 issue / PR**。`CONTRIBUTING.md` 原文：「All issues and PRs from new contributors are **auto-closed by default**」；「if you **spam the tracker with agent-generated issues, your GitHub account will be permanently blocked**… **No taksies backsies.**」——**这是账号级、不可逆的风险**，赌的是推广主账号。
2. ✅ **一对一触达走对方自己的仓库**（A 档几乎人人有自己的 repo），开一条不带推销语气的技术讨论 issue；不要走 pi 官方 tracker。`Hysilens-Helektra` 在帖尾写的「Any observations or edge cases are welcome」就是这类邀请。
3. ⚠️ **Show & tell 不是获客渠道**：pi Discussions 只有一个类目，6 条同类展示帖 **5 条 0 评论、最佳 1 条**。只能当「留档 + 被搜到」。（它是否还值得发，见 [票 13](./13-pi-official-distance.md)。）
4. ✅ **真正有规模的分发路径是 npm → `pi.dev/packages` 官方目录**（页面原文：Extensions/skills/themes published to npm；当前 5382 个包、按下载量排序）。这条把 npm 从「可选」变成了「分发杠杆」，见 [票 12](./12-npm-first-wave.md)。
5. ⚠️ **pi 官方在规划 "pi server"**（badlogic：「this is what pi server will be for」），A 档已有 3 人当面追问进展且无公开答复。一对一开场**要主动交代分工假设**，回避的话最聪明的几个人会当场问出来——见 [票 13](./13-pi-official-distance.md)。
6. 细节：生态里**有两个不同的 `pi-subagents`**（tintinweb 1244★ / nicobailon 3823★），给两人写开场白别张冠李戴；`nicobailon` 的 npm 维护者名是 `nicopreme`（GitHub 无此账号）；中文候选（plus1998、Q1y1ng）沟通成本最低，适合先跑通流程。

**最大盲区（诚实记录）**：**Discord 里的对话完全没覆盖**（pi README 首屏入口；shmuelamit 自述在 Discord 上和 mitsuhiko 讨论过用例，eterps 则明确说他不用 Discord）——那里面很可能有一批比 GitHub 更活跃的多 agent 用户，需要人工账号才能补。

### 5. 执行清单（不在本图内 → 票 09 检查单与票 10 计划）

- 新建 `.github/ISSUE_TEMPLATE/tried-it.md` 与 `feedback` 标签；
- 中英 README 各加一句邀请（位置见 §2）；
- 首发后按名单触达（D-day → D+7），并为前 3 个人预留陪跑时间。
