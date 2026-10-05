# 07 — 渠道顺序、每次出手的形态与发布日历

**Type:** grilling
**Blocked by:** 01
**Status:** resolved

## Question

landscape 给出了每个渠道的真实门槛与期望值，现在要排顺序、定形态、给日期：

- **首发**：pi Discord（17,638 成员 / 3,465 在线）——发在哪个频道、什么形态（一条消息？90 秒录屏？先潜水多久、要不要先回答几个别人的问题再发）。**注意 pi Discussions 没有 Show & Tell 类目，Discord 的具体频道结构需要在建图后第一次进群时确认。**
- **留档**：「pi Discussions 的 `General`」帖——定位是**可被搜索到的权威落点**，不是获客（同类帖历史最佳 1 条评论）。现有草稿 `docs/design-notes/pi-community-show-and-tell.md` 是按 Discussions 写的，要判断它是改投 Discord 还是留作留档帖。
- **中文**：HelloGitHub（每月 28 号，**下一个窗口 10-28**；模板要求标题约 20 字 + 描述 32–256 字符）、V2EX `/go/create`（**新账号 30 天冷却**——landscape 查不到 `whutlichao` 的 V2EX 会员信息，本票第一步要确认作者有没有账号；没有则现在注册并真实参与，否则只能发 `promotions`）、掘金（只能技术文章形态，官方罚则把「以推广曝光为目的」定义为垃圾广告）。
- **收录位**：`slavakurilyak/awesome-ai-agents`（无 star 门槛，可立刻做）、`Agent-Analytics/awesome-multi-agent-orchestrators`（149 stars，范围逐词吻合）；`kaushikb11/awesome-llm-agents` 卡 **25 stars** → 交里程碑。
- **暂不投**：HN（Q18：等 `--demo` 可用）、Reddit（landscape 无一手数据，需先验证规则）。

**产出**：一张发布日历（日期 → 渠道 → 出手形态 → 期望值 → 失败判据）+ 每个渠道的格式硬要求清单（标题字数、模板字段、节点规则、提交入口）。

## Answer

2026-10-02 谈定（两轮 8 问）。锚点 **D-day = 2026-10-16（周五，暂定，票 09 钉死；备料滑期则整表平移）**。

### 1. 发布日历

| 时间 | 渠道 | 出手形态 | 期望值 | 失败判据 |
| --- | --- | --- | --- | --- |
| D-14 → D-7 | pi Discord | **进群潜水**：确认频道结构与自荐规则、回答 2–3 个别人的问题 | 建立「不是来发广告的」履历 | — |
| D-7 → D-3 | 仓库 | 出 `v0.1.0` Release + **`npm publish`**（票 12）+ `npm pack` 资产、实现 `--demo`、中英 README 首段与 Quick Start（票 04 执行清单） | 一行安装可用（`npx worksplice`） | 任一项未就绪 → D-day 顺延，不发半成品 |
| D-3（10-13） | Awesome ×2 | 静默提交：`awesome-ai-agents` 走 issue 表单；`awesome-multi-agent-orchestrators` 按其目录条目格式提 PR | 收录＝长期入口，不求即时流量 | 被拒看理由；`awesome-llm-agents` 卡 25 star，达标后补投 |
| D-2（10-14） | pi Discussions | **克制版留档帖**（票 13 定）：纯技术内容 + 仓库链接，**删掉草稿里的邀请与推销语气**，不 @ 任何人 | 0–1 评论；它是「可被引用的公开落点」，不是获客渠道 | 不作为指标 |
| **D-day（10-16）** | **pi Discord** | **主帖**：自包含长帖 = 痛点开场 → 三条语义 → 90 秒录屏 → 一行安装 → 链接设计长文 | ≥2–3 条实质回应（问装法／说自己在跑多会话）。**无一手数据，属估计** | **48h 内 0 条实质回应 → 启动票 06 的主动私聊（Plan B 第一条）** |
| D+2（10-18） | HelloGitHub | 提交 issue（6 字段，含必填「亮点」） | 争取进 **10-28** 那期月刊 | 未入选 → 按反馈改文案，先问维护者是否接受重复投稿再投下期 |
| D+2 → D+7 | V2EX `/go/create` | 一次作品分享帖（账号已满 30 天，可用） | 0–6 条回复（landscape 实测量级） | 被移到 `promotions` 节点＝文案不像作品分享，需重写 |
| 第 2–6 周 | 掘金 | 1–2 篇**纯技术文**（从连载改写，选题由票 08 定） | 长期可被搜索引擎引用 | 被判垃圾广告（红线：「以推广曝光为目的」） |
| 每周 | pi Discord / 连载 | 每周一篇；选题与渠道映射由票 08 定 | 累积 | — |

### 2. 每个渠道的格式硬要求

- **pi Discord**：无公开自荐规则文档；**频道结构无法远程确认**（guild widget 关闭，`widget.json` 返回 `Widget Disabled`）→ 日历已含「D-14 进群后确认」这一步。主帖定为自包含长帖。
- **pi Discussions**：唯一类目是 `General`（无 Show & Tell 类目）；同类帖历史最佳 1 条评论 → 只作留档。
- **HelloGitHub**：`521xueweihan/HelloGitHub` 的 issue 表单 6 个字段——项目地址（必填，仅 GitHub）、类别（必填，选「人工智能」）、项目标题（必填，约 20 字）、项目描述（必填，32–256 字符）、**亮点（必填）**、示例代码（可选）、截图或演示视频（可选）；每月 28 号发刊 → D+2 投递争取 10-28 期。标题 17 字与描述约 120 字符已备（票 02），亮点见 §4。
- **V2EX**：发 `/go/create`（官方文案：「V2EX 非常欢迎独立开发者把他们的新作发布到这里…可以为你获得第一批用户」）；`claudecode` 节点 header 明文「🈲 发广告或引流内容会被删除」；只想曝光才发 `promotions`。作者账号已满 30 天，可用。
- **掘金**：只能技术文形态；官方罚则把「以推广曝光为目的」定义为垃圾广告（多账号配合、欺骗性外链、SEO 外链一律删内容 + 拉黑且不恢复）。
- **Awesome ×2**：
  - `slavakurilyak/awesome-ai-agents`：**走 issue 表单**（CONTRIBUTING 明说这是 founders 的首选路径，且 PR 路径要求跑 Go 校验命令）；门槛 = 公开仓库 + 默认分支近 6 个月内有实质非自动化提交（worksplice 30 天 175 commits，满足）+ **无 license / 无 star 门槛**。
  - `Agent-Analytics/awesome-multi-agent-orchestrators`：按目录条目格式提 PR（要截图、摘要、源码链接，成本高于前者）；范围逐词吻合（"parallel coding-agent work"、"agent workspaces with memory, tools, and execution"）；CONTRIBUTING 要求「避免营销语言」。
  - `kaushikb11/awesome-llm-agents`：**25 star 硬门槛**，达标后补投（交票 09 作为里程碑）。

### 3. 决策（HITL 确认）

- **D-1 静默提清单 PR ＋ 留档帖；D-day 只打 Discord 主帖**（把不需要人看的动作提前静默做完，首发当天不分散注意力）。
- **Discord 主帖 = 自包含长帖**（同类帖的教训是「短帖没人接」）。
- **HelloGitHub 在 D+2 提交**，赶 10-28 那期。
- **V2EX 发一次**（账号已满 30 天），排在 D+2 → D+7。
- **中文形态 = HelloGitHub 一次 + 掘金 1–2 篇技术文**。
- 事实确认：作者**没有任何现成受众阵地**（X／公众号／知乎／B 站等皆无）→ pi Discord 是唯一有人流的渠道，本图的渠道结构因此不再有「一次性大流量」选项。

### 4. 补写内容：HelloGitHub「亮点」字段

> 同类工具大多在解决「怎么同时跑更多 agent」，worksplice 解决的是跑起来之后的事：唤醒不推正文、收件箱是游标不是队列、并发写被 hold 而不是 last-write-wins、任务必须由非作者批准。这些不是 UI 装饰，是多个 agent 共用同一个仓库而不互相覆盖的前提。

### 5. 执行清单（不在本图内 → 票 09 检查单与票 10 计划）

- 改造 `docs/design-notes/pi-community-show-and-tell.md`：换定位句、加一行安装、删掉「未发布 npm／从源码跑」段（D+2 前它就会过时）。
- D-14 起进 pi Discord 潜水，确认频道与自荐规则。
- 出 Release + `--demo`（票 04 执行清单）。
- V2EX 与掘金正文在票 08 选题确定后一次改写。

### 6. 未验证 / 待确认（诚实记录）

- 🔴 **D-2 的「pi Discussions 留档帖」被后续调研动摇了**（2026-10-03）：同类展示帖 **6 条里 5 条 0 评论、最佳 1 条**，而 pi 官方 `CONTRIBUTING.md` 对推广的敌意是**账号级**的（「spam the tracker… your GitHub account will be permanently blocked. No taksies backsies.」——该条款针对 issue/PR，Discussions 是另一个面）。这一行是否保留，见 [票 13](./13-pi-official-distance.md)。
- **pi Discord 的频道结构与自荐规则**：widget 关闭、无公开规则页 → 只能进群后确认（日历已含）。
- **Discord 主帖的期望值**（≥2–3 条实质回应）**无一手依据**，是按同类生态渠道量级做的估计；本图所有渠道里，它是唯一「有明确人流但零历史数据」的一个。
- **HelloGitHub 是否接受同一项目重复投稿**：未确认；若未入选，先问维护者。
- **Reddit / HN**：见地图「Not yet specified」。
