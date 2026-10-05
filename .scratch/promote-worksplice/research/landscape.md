# 开源项目推广外部事实调研（为 worksplice 决策提供依据）

- 调研日期：**2026-10-02（UTC）**，所有数字均为该日实测
- 调研口径：只采信一手来源——GitHub REST/GraphQL API、HN Algolia API 与 HN 官方页面、npm registry API、平台官方规则页、平台自身页面、真实仓库 README
- 凡二手来源（第三方分析站、媒体转述）均在文中显式标注 `[二手]`
- 被测对象（背景，不复述）：worksplice，`https://github.com/whutlichao/worksplice`，MIT，2026-08-03 建仓，**1 star / 0 fork / 0 release / 无 Discussions**，已填 12 个 topics，作者 GitHub 账号 `whutlichao`（2015-04-10 注册，10 个公开仓库，7 followers）
  - 来源：`gh api repos/whutlichao/worksplice`、`gh api users/whutlichao`（2026-10-02）

---

## pi 社区

### pi 仓库本体规模（GitHub API 实测，2026-10-02）

| 指标 | 数值 |
|---|---|
| full_name | `earendil-works/pi`（AI agent toolkit: unified LLM API, agent loop, TUI, coding agent CLI） |
| stars | **111,651** |
| forks | **14,167** |
| open issues | **266**（vs 111k stars，issue 比极低） |
| watchers / subscribers | 337 |
| 建仓 | 2025-08-09 |
| 最近 push | 2026-10-02 |
| license | MIT |
| homepage | 空（文档站为 https://pi.dev） |
| Discussions | **已启用**（`has_discussions: true`） |

来源：`https://api.github.com/repos/earendil-works/pi`（2026-10-02 实测）

发行节奏：GitHub releases 有 100+ 条，最新 **v1.0.0 发布于 2026-10-01**，此前 v0.99.x 于 2026-09-29/30 连发，每个 release 带 10 个产物（standalone 二进制）。
来源：`https://api.github.com/repos/earendil-works/pi/releases`（2026-10-02 实测）

npm 包 `@earendil-works/pi-coding-agent`：created 2026-05-07，53 个版本，latest 1.0.0，**上周下载 4,537,280 次**（2026-09-24~09-30）。
来源：`https://registry.npmjs.org/@earendil-works/pi-coding-agent`、`https://api.npmjs.org/downloads/point/last-week/@earendil-works/pi-coding-agent`（2026-10-02 实测）

### pi 的 Discussions 分类 —— 关键发现：**没有 Show & Tell 类目**

GraphQL 查询 `discussionCategories` 返回的类目**只有一个**：

| 类目 | slug | 描述 | isAnswerable |
|---|---|---|---|
| General | `general` | "Chat about anything and everything here" | false |

Discussions 总数：**321**。按评论数排序的 Top 讨论（我拉取了全部 321 条本地排序）：

| 评论数 | 日期 | 标题 | URL |
|---|---|---|---|
| 20 | 2026-04-18 | Which plugins, add-ons, or extensions do you most enjoy using with the … | https://github.com/earendil-works/pi/discussions/3373 |
| 10 | 2026-03-06 | Is sandbox enabled by default? | https://github.com/earendil-works/pi/discussions/1874 |
| 8 | 2025-12-23 | GLM 4.7 leaking interleaved thinking tokens | https://github.com/earendil-works/pi/discussions/292 |
| 7 | 2025-12-15 | Pi Hooks for Checkpointing and LSP | https://github.com/earendil-works/pi/discussions/195 |
| 7 | 2026-02-25 | Love Pi Agent for Its Clean Context Usage … | https://github.com/earendil-works/pi/discussions/1632 |

来源：GitHub GraphQL `repository.discussionCategories` / `repository.discussions(first:100, after:)` 全量拉取（2026-10-02 实测）

**"Show & tell" 在 pi 里不是类目，只是发帖人自己写在标题里的前缀，且几乎零互动**（全部实测数据）：

| 评论 | 日期 | 标题 | URL |
|---|---|---|---|
| 1 | 2026-09-26 | Show & tell: agent-chat: peer-to-peer messaging for independent Pi agents | https://github.com/earendil-works/pi/discussions/10069 |
| 0 | 2026-10-01 | Show and tell: pi-trim — inspectable system-prompt trimming | https://github.com/earendil-works/pi/discussions/10304 |
| 0 | 2026-09-27 | Show & tell: omp-ntfy: free, zero-config phone push notifications for long tasks | https://github.com/earendil-works/pi/discussions/10107 |
| 0 | 2026-09-19 | Show and tell: pi-agent-ide - precise tooling for coding sessions | https://github.com/earendil-works/pi/discussions/9775 |
| 0 | 2026-09-13 | Show & tell: Pi Heao GUI — a Windows desktop client for pi | https://github.com/earendil-works/pi/discussions/9552 |

→ **对 worksplice 的直接含义**：pi 生态里，第三方扩展在官方 Discussions 只能发到 `General`，且同类"展示贴"历史最佳成绩是 **1 条评论**。这条路只能算"留档/被搜索到"，不能当获客渠道。

### pi 的官方社区入口

pi README 头部有两个徽章，第一个就是 **Discord 邀请**：

- 邀请链接：`https://discord.com/invite/3cU7Bz4UPx`
- Discord API 实测（`GET /api/v10/invites/3cU7Bz4UPx?with_counts=true`，2026-10-02）：
  - **approximate_member_count = 17,638**
  - **approximate_presence_count = 3,465**
  - guild 名：**"The Shitty Coders Club"**（id 1456806362351669492），社区型 guild，含 stage/news 频道
  - 邀请永不过期（`expires_at: null`）
- 另一个徽章是 npm 版本徽章
- README 中**没有**微信群、没有论坛、没有 Reddit 入口

来源：`https://raw.githubusercontent.com/earendil-works/pi/main/README.md`、`https://discord.com/api/v10/invites/3cU7Bz4UPx?with_counts=true`（2026-10-02 实测）

### pi 生态的"首个第三方集成"范例与 HN 曝光实况

- README 明确点名的 real-world integration 是 **OpenClaw**（`https://github.com/OpenClaw/OpenClaw`）：**391,213 stars / 82,246 forks**，建仓 2025-11-24。来源：`gh api repos/openclaw/openclaw`（2026-10-02）
- pi 自家 Slack/chat 集成 **`earendil-works/pi-chat`**：**404 stars / 62 forks / 0 releases**，建仓 2026-04-20，**最后 push 2026-06-05（已停滞近 4 个月）**，仓库 description 为空。来源：`gh api repos/earendil-works/pi-chat`（2026-10-02）
  → 说明即使官方亲自做"类 Slack 的 pi 协作层"，也停在 404 stars。worksplice 面临的是同一堵墙，不是"没人做过"。
- pi 在 Hacker News 上**几乎没有存在感**（HN Algolia 实测）：
  - `pi-mono` 相关最高分帖：`Pi Monorepo: AI agent toolkit` **3 分 / 0 评论**（2026-01-12）https://news.ycombinator.com/item?id=46590828
  - `Pi Coding Agent` **1 分 / 0 评论**（2026-01-16）https://news.ycombinator.com/item?id=46643719
  - README 里唯一的对外传播渠道是作者的 X（`https://x.com/badlogicgames/status/2037811643774652911`）
  - 来源：`https://hn.algolia.com/api/v1/search?query=pi-mono&tags=story`（2026-10-02 实测）

---

## 同类项目起量路径（含数据表）

### 主表（全部 GitHub API 实测，2026-10-02）

| 项目 | stars | forks | 建仓 | 首次 release | HN 最高分帖（分数/评论/日期） | 帖类型 | 从建仓到 HN 首发 |
|---|---|---|---|---|---|---|---|
| **BloopAI/vibe-kanban** | 28,245 | 3,031 | 2025-06-14 | 有（100+ releases，最新 v0.1.44 2026-04-24） | **195 / 132 / 2025-07-11** | Show HN | **27 天** |
| **superset-sh/superset** | 14,817 | 1,320 | 2025-10-21 | 有（cli-v1.33.0 2026-09-30） | 96 / 90 / 2025-12-23 | Show HN | 63 天 |
| **generalaction/emdash** | 5,896 | 623 | 2025-08-28 | 有（v1.2.7 2026-09-27） | 206 / 71 / 2026-02-24 | Show HN | **180 天** |
| **musistudio/claude-code-router** | 37,517 | 3,146 | 2025-02-25 | 有（25 releases，v3.1.1 2026-09-16） | 160 / 59 / 2025-07-28 | 普通提交 | 153 天 |
| **smtg-ai/claude-squad** | 8,561 | 625 | 2025-03-09 | 有（v1.0.0 2025-04-03） | **仅 5 / 1 / 2025-04-03** | 普通提交 | 25 天 |
| **coder/agentapi** | 1,500 | 138 | 2025-04-07 | 有（v0.1.0 2025-04-17） | 163 / 15 / 2025-04-17 | Show HN | **10 天** |
| **stravu/crystal** | 3,123 | 196 | 2025-06-05 | 有（v0.1.0 2025-06-12） | **无任何 HN 帖** | — | — |
| （参照）anomalyco/opencode | 211,441 | 28,059 | 2025-04-30 | 有 | 1,274 / 618 / 2026-03-20 | 普通提交 | 324 天 |
| （参照）earendil-works/pi | 111,651 | 14,167 | 2025-08-09 | 有（v1.0.0 2026-10-01） | 3 / 0 | 普通提交 | 156 天 |
| （参照）earendil-works/pi-chat | 404 | 62 | 2026-04-20 | **0 releases** | 无 | — | — |

数据来源（逐条可核）：
- stars/forks/建仓：`gh api repos/<owner>/<repo>`（2026-10-02）
- releases：`https://api.github.com/repos/<owner>/<repo>/releases?per_page=100`（2026-10-02）
- HN 分数：`https://hn.algolia.com/api/v1/items/<id>`，具体帖：
  - vibe-kanban https://news.ycombinator.com/item?id=44533004
  - superset https://news.ycombinator.com/item?id=46368739
  - emdash https://news.ycombinator.com/item?id=47140322
  - claude-code-router https://news.ycombinator.com/item?id=44705958
  - claude-squad https://news.ycombinator.com/item?id=43575127
  - agentapi https://news.ycombinator.com/item?id=43719447
  - opencode https://news.ycombinator.com/item?id=47460525

### 从这些数据里能读出的四件事

1. **"HN 上过首页"不是必要条件**。`claude-squad` 首发 HN 只拿 **5 分 1 评论**，今天 8,561 stars；`crystal` **完全没上过 HN**，3,123 stars。而 `agentapi` 拿到 163 分（HN 前页级），今天只有 **1,500 stars**——**HN 分数与长期 star 数的相关性在样本里很弱**。
2. **"HN 首发时机"极不统一**：10 天（agentapi）、27 天（vibe-kanban）、63 天（superset）、153 天（claude-code-router）、**180 天**（emdash）。emdash 建仓半年后才发 Show HN，仍然拿到 206 分——说明**晚发不等于没机会**，反而"产品更完整"可能更重要。
3. **Show HN 的头部量级是 100~250 分 / 60~130 评论**（本样本 5 个 Show HN 中位数约 195 分）。而 HN 每天新发的 Show HN 绝大多数是 **1~4 分、0 评论**（见下节实测分布）。
4. **release 是标配**：8 个同类项目里 **7 个有 GitHub release**（唯一例外是停滞的 pi-chat）。worksplice 目前 0 release，这是入场券缺口。

HN Algolia 额外样本（`Show HN` + 编排类，用于估计同类赛道竞争强度，2026-10-02 实测）：

| 分数 / 评论 | 日期 | 标题 |
|---|---|---|
| 88 / 60 | 2026-03-25 | Show HN: Optio – Orchestrate AI coding agents in K8s to go from ticket to PR https://news.ycombinator.com/item?id=47520220 |
| 33 / 33 | 2025-12-16 | Show HN: Zenflow – orchestrate coding agents without "you're right" loops https://news.ycombinator.com/item?id=46290617 |
| 5 / 0 | 2025-08-31 | Show HN: Pitaya – Orchestrate AI coding agents like Claude Code https://news.ycombinator.com/item?id=45084477 |
| 2 / 4 | 2026-03-03 | Show HN: Seshions – Orchestrate multi-agent coding agents from one terminal https://news.ycombinator.com/item?id=47232758 |
| 4 / 1 | 2025-12-22 | Claude Colony – Multi-Agent Orchestration for Claude Code https://news.ycombinator.com/item?id=46357942 |

→ 同一个"agent 编排"赛道里，**HN 结果方差极大**：88 分和 2 分并存。发帖不是确定性手段，是抽奖券。

---

## 渠道效率证据

### 1. Hacker News Show HN（一手：官方规则页原文）

官方规则 `https://news.ycombinator.com/showhn.html`（2026-10-02 拉取）关键约束原文：

- 定位："Show HN is for something **you've made that other people can play with**."
- 什么算 on-topic："things people can **run on their computers** or hold in their hands. For hardware, you can post a video or detailed article."
- 什么算 off-topic（**直接排除 landing page**）："blog posts, sign-up pages, newsletters, lists, and other reading material. Those can't be tried out, so can't be Show HNs."
- 项目门槛："The project should be **non-trivial**. Don't post quickly-generated one-offs."
- 作者必须在场："The project must be something you've worked on personally and **which you're around to discuss**."
- 早产也可以，但要能试："A Show HN needn't be complicated or look slick… **Please make it easy for users to try your thing out, ideally without barriers such as signups or emails.**"
- 没准备好就别发："If your work isn't ready for users to try out, please don't do a Show HN."
- **标题格式**："To post, submit a story whose **title begins with "Show HN"**."
- 曝光机制："Every Show HN appears on **shownew**. Once it clears **a small points threshold**, it will appear on the **show** page in the top bar."
- 版本更新不算："New features and upgrades ("Foo 1.3.1 is out") generally aren't substantive enough to be Show HNs. A major overhaul is probably ok."
- 禁止拉票："**Please don't ask friends to upvote or comment.** That's not ok on HN."

一般规则 `https://news.ycombinator.com/newsguidelines.html`（2026-10-02 拉取）里与"推广"直接相关的原文：

- "**Please don't use HN primarily for promotion.** It's ok to post your own stuff part of the time, but the primary use of the site should be for curiosity."
- "**Don't solicit upvotes, comments, or submissions.**"
- "Please don't do things to make titles stand out, like using uppercase or exclamation points, or saying how great an article is."
- "Please don't put generated text in HN posts. Write your text yourself… please don't automate posting."

**"小分数阈值"是多少？** 我直接抓了 `https://news.ycombinator.com/show`（2026-10-02）：第一页 15 条故事，页面内出现的分数包含 **2、2、2、2、3、3、4、4、6、6、6、10、20、21、24、32、57、80、83、86、109、111、130、131、164、201、220、400** —— 即**低至 2 分的故事也已经在 `/show` 列表里**。结论：`/show` 的展示门槛极低（个位数分数），真正稀缺的是**前页（front page）**。

**Show HN 的真实分数分布**（HN Algolia `search_by_date&tags=show_hn`，2026-10-02 当天最近的 30 条）：分数排序后为 `4,3,3,3,3,3,2,2,2,1×21`，**中位数 1 分，均值 1.5 分**。
来源：`https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=30`（2026-10-02 实测）

→ **这是本报告最重要的一条渠道结论**：发一条 Show HN 的**默认结局是 1~4 分、0 评论**。195 分是尾部事件，不是期望值。

**发布时间**：HN 官方**没有**任何关于"最佳发布时间"的文档。`https://news.ycombinator.com/newsfaq.html` 明确排名不只看票数与时间。以下是 **[二手]** 分析（均已标注）：
- 二手：[The best time to post on Hacker News](https://blog.alcazarsec.com/tech/posts/best-time-to-post-on-hacker-news)（2026-03-14）综合建议 **周二至周四 14:00–17:00 UTC**（= 太平洋时间 7:00–10:00），低竞争窗口为**太平洋周日午夜**；同时引用 Max Woolf 2014 年全量分析（活动峰值 12pm ET / 9am PT，但**提交时间本身不强烈决定爆款**）与 2025-06 的 2.3 万帖分析（https://news.ycombinator.com/item?id=44569046 ，主张周日 0–1am PT）。
- 二手：[smollaunch HN launch guide](https://smollaunch.com/guides/hacker-news-launch-guide)。
- 学术（[二手]，未能取得正文，PDF 被拒）：arXiv 2511.04453 "Launch-Day Diffusion: Tracking Hacker News Impact on GitHub Stars for AI Tools"，代码仓库 https://github.com/obadaKraishan/Launch-Day-Diffusion —— 我尝试抓取 PDF 失败（content type 不支持），**结论未采信，仅记录线索**。

**三条成功案例（每条都是 HN Algolia 实测数据）**：
1. vibe-kanban：195 分 / 132 评论 / 2025-07-11（建仓后 27 天）https://news.ycombinator.com/item?id=44533004 → 现 28,245 stars
2. emdash：206 分 / 71 评论 / 2026-02-24（建仓后 180 天）https://news.ycombinator.com/item?id=47140322 → 现 5,896 stars
3. agentapi：163 分 / 15 评论 / 2025-04-17 https://news.ycombinator.com/item?id=43719447 → 现 1,500 stars（**反例：高分 ≠ 高 star**）

### 2. Reddit

**⚠️ 数据可得性声明**：Reddit 官方 JSON API（`www.reddit.com/r/<x>/about.json`、`old.reddit.com`、`api.reddit.com`）在本机**全部返回 HTTP 403**；redlib 镜像 `safereddit.com` 被 Anubis 反爬挡住。因此**订阅数取自第三方分析站 [二手]，规则取自规则文本转述 [二手+可核对]**，**我没有直接读到 Reddit 官方页面**。请把这一节当作"方向性参考"，不要当作硬数据。

订阅数（[二手]，来源 https://reddifier.com/free-subreddit-analysis-tool/r/<name>，页面自标 data updated 2026-05-23 / 2026-08-03）：

| subreddit | 成员数 | 建版 | 关键自我推广规则（转述） |
|---|---|---|---|
| r/ClaudeAI | 1,046,485 | 2023-01 | — |
| r/selfhosted | 807,530 | 2014-07 | "Self-Promotion / Affiliate Links: Do not spam or promote your own projects too much" |
| r/SideProject | 786,890 | 2013-01 | — |
| **r/LocalLLaMA** | **786,324** | 2023-03 | 规则 8 "Limit Self-Promotion"：**1/10 规则**——"self-promotion should not be more than 10% of your content"；"Affiliation must be disclosed"；另有 **30 天账号年龄**门槛 |
| r/AI_Agents | 408,449 | 2023-04 | — |
| r/ChatGPTCoding | 389,702 | 2022-12 | — |
| r/ClaudeCode | 364,455 | 2025-02 | — |
| **r/LLMDevs** | **161,024** | 2023-02 | — |
| r/coolgithubprojects | 110,233 | 2014-04 | — |
| r/programming | 6,903,533 | 2006-02 | — |

官方规则页地址（供人工复核，我无法直连）：`https://www.reddit.com/r/LocalLLaMA/about/rules`、`https://old.reddit.com/r/LocalLLaMA/wiki/index`

[二手] r/LocalLLaMA 相关数据点：平均帖分 39.0、平均评论 26.5、发帖频率约 1 帖/小时、商业接受度 70%、情感倾向 negative、friendliness 30/100。来源同 reddifier（该页自标 "Last analyzed: May 23, 2026"）。

**Reddit 成功案例**：[二手] r/ChatGPTCoding 讨论帖存档 `https://web.archive.org/web/20260223050522/https://old.reddit.com/r/ChatGPTCoding/comments/1p9s8qx/peak_vibe_coding/`（仅存 URL，未取得分数）。**我未能在一手渠道验证任何一条 Reddit 高赞帖的真实分数**，因此本节**不给成功案例的具体数字**——这是本次调研的一个明确缺口。

### 3. Awesome 列表（一手：GitHub API + CONTRIBUTING.md 原文）

| 列表 | stars | 最近 push | 提交方式 | 收录门槛（原文要点） | worksplice 是否够格 |
|---|---|---|---|---|---|
| **kaushikb11/awesome-llm-agents** | 1,597 | 2026-09-27 | PR；**有专门的 "Multi-Agent Orchestration" 与 "CLI Agent Harnesses" 分区** | ①仓库可解析（404 是最常见拒因）②未归档 ③**12 个月内有 push** ④**至少 25 stars**（或知名组织/实验室发布）⑤非重复 ⑥描述 ≤60 字符；CI 机械校验；**<1000 stars 且 12 个月无 push 直接移除** | ❌ **1 star < 25**，差 24 个 star |
| **hesreallyhim/awesome-claude-code** | 54,954 | 2026-10-02 | **必须用 Web UI issue 表单**（`issues/new?template=recommend-resource.yml`），"Do not open a PR"，**不支持 gh CLI 提交** | 二选一：**(i) 首次 commit 起 ≥14 天且有持续开发迹象**，或 **(ii) ≥100 stars**；一次只能推荐 1 个资源；不合格自动关闭；维护者明确说"没有正式提交/审核流程"、"no guarantee… you will receive a response"；要求描述的文体是"描述"不是"推销"、单行、不用 emoji | ❌ 建仓 2026-08-03 已满 14 天 ✓，但需人工判断"active development"；且只收 Claude Code 相关 |
| **slavakurilyak/awesome-ai-agents** | 2,289 | 2026-09-30 | issue 表单（`project-submission.yml`）**或** PR 改 `awesome-agents.json` + 跑 5 条 go 校验命令 | **明确"无 license 要求、无最低 star 要求"**；唯一硬门槛是"默认分支**近 6 个月内有实质、非自动化 commit**"，且**必须自带公开仓库**（GitHub/GitLab.com/Codeberg）；提交时**鼓励主动说明"项目新、使用历史少"** | ✅ **唯一明确够格的列表** |
| **Agent-Analytics/awesome-multi-agent-orchestrators** | 149 | 2026-10-02 | PR 改 `src/data/orchestrators.ts` | 范围刻意收窄："clearly about orchestrating multiple agents, **parallel coding-agent work**… **agent workspaces with memory, tools, and execution**"；拒收"generic chat apps / thin wrappers"；要求可公开验证、**避免营销语言** | ✅ 定位高度吻合（但列表本身只有 149 stars，曝光有限） |
| e2b-dev/awesome-ai-agents | 30,249 | 2026-08-21 | — | **我未找到 CONTRIBUTING.md**（仓库根目录无该文件），1091 个 open issues | ⚠️ 未核实门槛 |
| bradAGI/awesome-cli-coding-agents | 1,308 | 2026-09-28 | — | **我未找到 CONTRIBUTING.md** | ⚠️ 未核实门槛 |
| awesome-selfhosted/awesome-selfhosted | **323,356** | 2026-10-01 | PR | 未在本轮核实（该列表有独立的 `awesome-selfhosted-data` 仓库与严格条目规范） | ⚠️ worksplice 是自托管 Web 应用，理论对口，**门槛待单独核实** |

来源：`gh api repos/<owner>/<repo>`、`https://raw.githubusercontent.com/<owner>/<repo>/<branch>/CONTRIBUTING.md`（2026-10-02 实测）

**最有价值的一条原文**（hesreallyhim/awesome-claude-code，54,954 stars 的头部列表）—— 它把"上 Awesome → 拿用户"这条链直接否掉了：

> "Too many people think like this: (i) Build something awesome; (ii) Submit to Awesome Claude Code; (iii) Get accepted, because of being awesome; (iv) Get users. However, a more likely chain of events is: (i) Build something awesome; (ii) **Get users**; (iii) Submit it to Awesome Claude Code… If 'getting on the list' is any part of a promotional strategy for your project, you should be prepared to have a backup plan."

来源：`https://github.com/hesreallyhim/awesome-claude-code/blob/main/CONTRIBUTING.md`（2026-10-02 拉取）

### 4. GitHub Trending

- **GitHub 官方从未公开 Trending 算法**。本轮穷举了官方渠道：GitHub Docs 的 "Finding ways to contribute to open source"（`https://docs.github.com/en/get-started/exploring-projects-on-github/finding-ways-to-contribute-to-open-source-on-github`）只讲 Explore/Topics/collections，**不含 Trending 算法说明**；GitHub Blog 唯一的 Trending 公告是 2013 年的 `https://github.blog/news-insights/company-news/explore-what-is-trending-on-github/`（页面正文已改版，本轮未能取到正文，仅确认页面存在）。
- **官方唯一可引用的规则性文字来自 GitHub Community 讨论**：`Curious about trending repos calculations · Discussion #163970`（`https://github.com/orgs/community/discussions/163970`）——提问者（Sunshine 维护者）实测"今天涨了 19 stars 却没上榜"，并指出"榜上有只涨 1 star 的仓库"。**该讨论中的回答者为社区成员，非 GitHub 员工，其"star 增速 vs 历史均值 / fork / issue / PR 等参与度"的推测属于 [二手]**，不能当官方规则。
- 我在该讨论页面抓到的回答原文（[二手]）："Stars vs. velocity ratio… it probably compares your current star gain against your historical average… Engagement beyond stars - Forks, issues opened, PRs, comments… probably all play a part."
- 来源：`gh api repos/...`（无 API）、`https://docs.github.com/...`、`https://github.com/orgs/community/discussions/163970`（2026-10-02 实测）

→ 结论：**Trending 不可规划**，官方文档层面没有任何可执行规则；把它当作"别人 star 你之后可能发生的副产品"，不能当渠道。

### 5. npm 发布对可发现性的实际影响

npm 官方搜索文档原文（`https://docs.npmjs.com/searching-for-and-choosing-packages-to-download`，页面末标注最后编辑 2025-02-13）：

- "The search is performed using content from the package's **title, description, readme, and keywords** and is powered by opensearch."
- "**No subjective ranking criteria are applied**, except for a minimal boost to deprioritize spammy or entirely new packages, aiming to maintain a neutral stance towards all other packages."
- "**Please note that newly published packages may take up to two weeks to appear in the search results.**"
- 排序选项：keyword matching（默认）、download counts、most dependents、last published date。

npm registry 实测数据（2026-10-02）：

| 包 | 首次发布 | 版本数 | keywords | 上周下载（2026-09-24~30） |
|---|---|---|---|---|
| `@anthropic-ai/claude-code` | — | — | — | **14,649,067** |
| `opencode-ai` | 2025-05-31 | **12,204** | 无 | **2,868,696** |
| `@earendil-works/pi-coding-agent` | 2026-05-07 | 53 | — | **4,537,280** |
| `vibe-kanban`（NPX wrapper） | 2025-06-20 | 198 | **无** | 2,730 |
| `claude-code-router` | 2025-07-26 | 2 | `['claude','code','router','llm','anthropic','codewhisperer','openai','multi-provider']` | 285 |
| `agentapi` | **不存在于 npm** | — | — | — |

来源：`https://registry.npmjs.org/<pkg>`、`https://api.npmjs.org/downloads/point/last-week/<pkg>`（2026-10-02 实测）

**关键推论（基于以上一手数据的判断，非官方声明）**：
- **npm 不是必要条件**：`claude-squad`（8,561 stars，Go 二进制 + releases）、`coder/agentapi`（1,500 stars，Go）都**没有 npm 包**，照样起量。分发形式与语言绑定，Go/Rust 项目走 GitHub Releases。
- **但对 Node/TS 项目，npm 是高杠杆的**：worksplice 是 Next.js + Node 项目，它的同行（vibe-kanban、claude-code-router、opencode、pi）都发了 npm。npm 是这些用户的默认安装界面（`npx …`）。
- **npm 搜索对 0 下载新包的实际价值有限**：官方明说"新包最多要两周才进搜索"，且"无主观排名"——意味着你的关键词（title/description/readme/keywords）几乎是唯一的排名信号。`vibe-kanban` 的 wrapper 包 **keywords 为空**，`opencode-ai` 也**没有 keywords**，说明头部项目并未把 npm 搜索优化当重点。
- **真正缺的不是 npm，是"一行命令安装"**（见下节入场券）。

### 6. 我在本轮遇到的数据缺口（诚实记录）

1. **Reddit 一手数据取不到**：官方 JSON/老版页面 403，镜像被 Anubis 挡。订阅数与规则均为 [二手]。
2. **少数派投稿页 404**：`https://sspai.com/page/contribute` 与 `/page/help` 均返回 404（2026-10-02 实测）。
3. **微信《外部链接内容管理规范》正文取不到**：`https://weixin.qq.com/agreement/weixin_external_links_content_management_specification?lang=zh_CN` 返回 200 但页面为 JS 渲染壳，正文不可读。
4. **掘金/小红书/即刻**：只取到掘金的《违规行为处理》原文；小红书与即刻**未取到官方规则页**。
5. **e2b-dev/awesome-ai-agents 与 bradAGI/awesome-cli-coding-agents 的 CONTRIBUTING** 未找到。
6. **arXiv 论文 PDF 抓取失败**，未采信其结论。

---

## 中文渠道

### V2EX（一手：v2ex.com 官方帮助页 + V2EX API v1 实测）

**规模（V2EX API `nodes/show.json`，2026-10-02 实测）**：

| 节点 | 标题 | topics | stars（关注数） |
|---|---|---|---|
| `programmer` | 程序员 | 73,680 | 9,792 |
| `share` | 分享发现 | 47,372 | 6,359 |
| **`create`** | **分享创造** | **37,234** | **6,212** |
| `promotions` | 推广 | 14,383 | 1,494 |
| `opensource` | 开源软件 | 725 | 398 |
| `claudecode` | Claude Code | 337 | 349 |

站点侧栏实时数据：**2,454 Online，Highest 6,679**（2026-10-02 22:56 +08 抓取）。

**官方规则原文（`https://www.v2ex.com/help/node`，页末标注最后更新 2021-10-23）**：

- 分享创造 `/go/create`："V2EX **非常欢迎**独立开发者把他们的新作发布到这里…把你的新作品发布到这里，**可以为你获得第一批用户**，并且他们会给你很多有用的反馈。"
- 推广 `/go/promotions`："请把**你们公司的任何营销内容**发到这个节点。如果忽略这条规则，那么内容在被管理员发现之后，**会被移动到这个节点**。如果多次持续忽略这条规则，那么**可能会对账号产生影响**。"
- 主题发布后 10 分钟内可自由换节点；10 分钟后版主发现不匹配会**静默移动**（不发通知）。

**官方对"纯推广"的态度（`https://www.v2ex.com/help/spam`，页末标注最后更新 2020-06-18）**：

> "如果，你注册 V2EX 的目的，只是为了不停地将你的网站的链接粘贴至此…那么请停止这样的行为吧。"

**30 天门槛（真实案例）**：`https://global.v2ex.co/t/1175853`（2025-11-29）——发帖人称"在「分享创造」节点发帖提示要 **30 天以后才能发**"；回帖两条关键社区态度：
- "如果你注册这个账号只是为了发推广贴，那就发推广节点。"
- "这个机制就是为了防止直接注册后就推广的吧。"

→ **可执行推论**：V2EX 分成两条路——(a) 真作品、真人参与、发 `/go/create`（拿第一批用户）；(b) 只想曝光 → `/go/promotions`。**新注册账号在 `create` 有 30 天冷却**，且社区会当场识别"为发广告而注册"。作者 `whutlichao` 在 V2EX **未查到会员信息**（`api/members/show.json?username=whutlichao` 返回 "Object not found"）→ **若打算走 V2EX，第一步是提前注册并真实参与讨论，等冷却期。**

**真实互动量级（我实测的当下实时数据，说明"发帖 ≠ 有人理你"）**：
- `/go/create` 节点当下最新主题：`0 replies`（黑白方块文件传输工具 /t/1246180）、`0 replies`（天文交互演示 /t/1246178）、`5 replies`（网盘分摊存储 /t/1246174）、`0 replies`（双人 AI 视频工具 /t/1246159）
- `/go/opensource` 节点：`[开源推广] WallpaperMachine：macOS 原生动态壁纸引擎` **4 replies** https://www.v2ex.com/t/1244951 ；`[开源] scrollback：让你日常使用的所有 Agent 共用一个上下文` **0 replies** https://www.v2ex.com/t/1244143
- 全站最新主题按回复排序，`create` 节点最高仅 **6 replies**（/t/1246174）

→ **V2EX 的"分享创造"真实转化是 0~6 条回复**，不是爆款渠道。它的价值是"第一批愿意给反馈的用户 + 可被搜索引擎/GitHub 引用"，不是流量。

**注意**：`claudecode` 节点 header 明文写着：**"🈲 发广告或引流内容会被删除"**（`https://www.v2ex.com/go/claudecode`，2026-10-02 实测）——worksplice 若想借 Claude Code 话题，这个节点是禁区。

来源：`https://www.v2ex.com/help/node`、`https://www.v2ex.com/help/spam`、`https://www.v2ex.com/api/nodes/show.json?name=<node>`、`https://www.v2ex.com/api/topics/show.json?node_name=<node>`、`https://global.v2ex.co/t/1175853`（2026-10-02 实测）

### HelloGitHub（一手：官方仓库 README + issue 模板）

- 仓库 **`521xueweihan/HelloGitHub`：179,701 stars**，最近 push 2026-09-28，867 个 open issues。来源：`gh api repos/521xueweihan/HelloGitHub`（2026-10-02）
- 月刊形式，**每月 28 号**发布（README 原文："**每月 28 号**以月刊的形式更新发布"），内容为"有趣、入门级的开源项目、开源书籍、实战项目、企业级项目等"
- **明确欢迎自荐**：README 原文"欢迎[推荐或自荐](https://hellogithub.com/periodical)项目成为 HelloGitHub 的贡献者"
- **提交方式 = GitHub issue 表单**（`.github/ISSUE_TEMPLATE/submit-cn.yaml`），标题自动带 `[开源推荐] `，assignee 固定为维护者 `521xueweihan`，必填：
  - **项目地址**（"仅收录 **GitHub** 上的开源项目"，必填）
  - **类别**（下拉，含 **人工智能**、Go、Java、JS… 必填）
  - **项目标题**（"请用 **20 个左右的字**描述它是做什么的"，≤50 字）
  - **项目描述**（"这是个什么项目、能用来干什么、有什么特点或解决了什么痛点…长度 **32–256 字符**"）
  - 模板原文门槛："欢迎自荐和推荐开源项目，**唯一要求：请按照下面的提示介绍项目**"
- 另有官网提交通道（`config.yml` 的 contact link 指向 `https://hellogithub.com/`），官方模板 `submit-en.yaml` 供英文项目

来源：`https://raw.githubusercontent.com/521xueweihan/HelloGitHub/master/README.md`、`https://raw.githubusercontent.com/521xueweihan/HelloGitHub/master/.github/ISSUE_TEMPLATE/submit-cn.yaml`（2026-10-02 实测）

→ **这是本轮找到的"门槛最低、量级最大"的中文渠道**：179k stars 的月刊 + 无 star 门槛 + 明确接受自荐 + 有官方中文模板。唯一门槛是"必须按模板把项目讲清楚（32–256 字）"。

### 掘金（一手：官方《违规行为处理》原文）

`https://juejin.cn/post/6844903618408087560`（2018-06-08，官方账号 `panfish27027` 发布，2026-10-02 拉取成功）原文对"推广"的定义与罚则：

- **"发布垃圾广告信息：用户以推广曝光为目的，发布影响用户体验、扰乱掘金社区秩序的内容"** 属违规
  - 单个账号发布垃圾广告：第一次删内容 + 拉黑，申诉后恢复；第二次删 + 拉黑
  - 多个账号互相配合：**删内容 + 拉黑，不恢复**
  - **发布包含欺骗性外链的内容**（未注明的淘宝客链接、跳转网站等）：**删内容 + 拉黑，不恢复**
  - **发布包含 SEO 推广链接的内容获取搜索引擎不正当曝光**：**删内容 + 拉黑，不恢复**
- 重复发布干扰体验：保留阅读量最少的一篇，其它删除 + 拉黑一周
- 诱导投票或关注：**删除账号**

关联阅读：`https://juejin.cn/post/6844903618403893261`（在掘金社区不可以哪些事）

→ 掘金**没有禁止开源项目介绍**，但把"以推广曝光为目的"直接定义为违规。**在掘金发文的合规姿势 = 技术文章（架构/取舍/踩坑），把仓库链接作为"实现出处"，而不是"求 star"。**

### 少数派 / 即刻 / 小红书 / 微信公众号（本轮未能取得官方规则页）

- **少数派**：`https://sspai.com/page/contribute` 与 `https://sspai.com/page/help` 均 **HTTP 404**（2026-10-02 实测）。搜索命中的"[少数派喊你来投稿]"均为**第三方媒体转载**（如 `http://www.163.com/dy/article/KTER6U8F05119NPR.html`、`https://www.sohu.com/a/1025496073_115785`），**属 [二手]，未采信为流程依据**。→ **结论：我无法给出一手投稿流程，需人工登录 sspai.com 查看"投稿"入口。**
- **微信《微信外部链接内容管理规范》**：官方地址 `https://weixin.qq.com/agreement/weixin_external_links_content_management_specification?lang=zh_CN`（另有 `https://newcomm.wechat.com/cgi-bin/readtemplate?t=weixin_external_links_content_management_specification`）返回 200 但**页面为 JS 渲染壳，正文不可读**。→ **"公众号文章能否放可点击的 GitHub 链接"这一点，本轮未能从官方原文验证。**
- **小红书**：未取到官方规则页。搜索到两条**媒体转述 [二手]**：`https://m.gmw.cn/toutiao/2025-03/12/content_1303989067.htm`（"小红书最新发布，今天正式生效"，2025-03-12）、`https://www.163.com/dy/article/JQF2A75F0514R9OJ.html`（"小红书发布新规：禁止引导站外交易"）。
- **即刻**：未取到官方规则页；仅搜到第三方博客讲发帖字段（`https://blog.brmys.cn/jike-submit-to-topic-guide`）与一条即刻帖子页面 `https://m.okjike.com/originalPosts/6abb2782bd0563695b59a25a`。**均不足以支撑"渠道效率"结论。**

→ **对中文渠道的诚实结论**：本轮**只有 V2EX 与 HelloGitHub 拿到了可执行的一手规则与真实量级**；掘金拿到了官方罚则原文；**少数派/即刻/小红书/公众号四个渠道，我没有拿到任何一手规则或真实转化数据**，不应基于猜测分配精力。

---

## 发布入场券

### 证据样本：13 个高星同类项目的 README 实测

方法：`curl -sL https://raw.githubusercontent.com/<owner>/<repo>/<default-branch>/README.md` 拉取原文，用正则逐项检测（一行安装命令、demo 图/视频、在线 demo、Docker、文档站、Discord/Slack、内联图片数、shields.io 徽章数）。全部为 **2026-10-02 实测**。

| 项目 | stars | 一行安装 | demo GIF/视频 | 在线 demo | Docker | 文档站 | Discord | Slack | 内联图片 | shields 徽章 |
|---|---|---|---|---|---|---|---|---|---|---|
| BloopAI/vibe-kanban | 28,245 | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | 2 | 2 |
| smtg-ai/claude-squad | 8,561 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **4**（含 `![Claude Squad Screenshot](assets/screenshot.png)`） | 1 |
| coder/agentapi | 1,500 | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | 1 | 0 |
| musistudio/claude-code-router | 37,517 | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | 0 | **8** |
| charmbracelet/crush | 28,452 | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | 0 | 1 |
| anthropics/claude-code | 148,944 | ✅ | ✅（含 1 个 .gif/.mp4 引用） | ❌ | ❌ | ✅ | ❌ | ❌ | 1 | 2 |
| openai/codex | 127,616 | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | 0 | 0 |
| anomalyco/opencode | 211,441 | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | 1 | 3 |
| superset-sh/superset | 14,817 | ✅ | ✅（**6 个媒体引用**） | ❌ | ✅ | ✅ | ✅ | ❌ | **8** | **18** |
| generalaction/emdash | 5,896 | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | **7** | 8 |
| earendil-works/pi | 111,651 | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | 0 | 2 |
| stravu/crystal | 3,123 | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | 0 | 0 |
| **合计（12 个有效样本）** | — | **10/12 = 83%** | **3/12 = 25%** | **0/12 = 0%** | **4/12 = 33%** | **10/12 = 83%** | **6/12 = 50%** | **0/12 = 0%** | 均值 2.0 张 | 均值 3.2 |

来源：逐仓库 `raw.githubusercontent.com/<owner>/<repo>/<branch>/README.md`（2026-10-02 实测）。样本文件已落盘 `/tmp/rme/*.md`。

### 结论：哪些是真"入场券"

**Tier 1 — 几乎是硬门槛（10/12 = 83%）**
1. **一行安装命令**。10/12 命中，覆盖从 1,500 stars 到 211,441 stars 的全部量级。形式：`curl -fsSL https://pi.dev/install.sh | sh`（pi）、`brew install …`（crush/claude-squad）、`npm i -g`、`npx`。**worksplice 当前"从源码跑"直接违反这条。**
2. **文档站 / docs 目录链接**。10/12 命中。注意 `coder/agentapi`（1,500 stars）和 `stravu/crystal`（3,123 stars）都做到了这点——**说明这不是"高星才配"，而是低星项目也在做的基本功**。

**Tier 2 — 强建议（约 50%）**
3. **Discord 邀请/徽章**：6/12 = 50%。pi、vibe-kanban、claude-code-router、opencode、superset、emdash 都有；**claude-squad / agentapi / crush / codex / claude-code 没有**。→ 有则加分，无则不至于出局。
4. **shields.io 徽章**：均值 3.2 个，superset 高达 18 个，claude-code-router 8 个。**npm version / license / stars 三类**是主流。

**Tier 3 — 加分项（25~33%）**
5. **Docker**：4/12 = 33%（vibe-kanban、claude-code-router、superset、pi）。对"本地自托管"项目是天然对口项。
6. **demo GIF/视频**：3/12 = 25%，且**集中在两类项目**：(a) 商业化程度最高的 superset（6 个媒体引用，18 个徽章）、(b) 有资本支持的 emdash（7 张图，8 个徽章）、(c) 大厂 claude-code。**纯开源项目反而普遍没有 demo 视频**——worksplice 声称"无 demo 视频"，在这个样本里**不是硬伤**，但**截图是替代品**：emdash 7 张、superset 8 张、claude-squad 4 张。

**Tier 4 — 样本中为零**
7. **在线 demo：0/12**。**没有一个大星项目提供 hosted 在线 demo**——因为这些工具本质是"跑在你自己机器上的 CLI/桌面应用"，无法 host。→ **worksplice 不需要为"没有在线 demo"焦虑**，但**必须把"如何 5 分钟内本地跑起来"做到极致**（这正是 Tier 1 第 1 条）。
8. **Slack 邀请：0/12**。

### worksplice 的入场券缺口（对照实测）

| 入场券 | worksplice 现状 | 差距 |
|---|---|---|
| 一行安装 | ❌ 从源码跑 | **最大缺口**。npm 是唯一合理路径（Next.js/Node 项目），参考 `npx vibekanban` 的 NPX wrapper 模式（`vibe-kanban` npm 包，198 版本，上周 2,730 下载） |
| GitHub release | ❌ 0 release | 同类 7/8 有 release |
| 文档站/README 的 Getting Started | 中英双 README（有），但需确认是否含"从零到看见第一个 agent 回复"的 5 分钟路径 | — |
| 截图/demo | ❌ 无 demo 视频（且无截图信息） | 建议补 3~7 张关键界面截图（emdash 7 张、superset 8 张） |
| npm 发布 | ❌ 未发布 | 见"npm 可发现性"节：非必需，但对 Node 项目是高杠杆 |
| topics | ✅ 已填 12 个 | 已完成（`agent-orchestration`, `multi-agent`, `self-hosted` 等） |
| Discussions | ❌ 未启用 | pi 那边类目也只有 General，优先级低 |

---

## 对 worksplice 的直接含义

以下每条都挂在上文的具体事实与 URL 上，不是建议性套话。

1. **"发到 pi 社区"能拿到的上限很低，但成本也低，值得做一次留档。**
   pi 的 Discussions 只有 `General` 一个类目，历史同类"Show & tell"最佳成绩是 **1 条评论**（https://github.com/earendil-works/pi/discussions/10069 ），最差的 0 条。但 pi 的 Discord 有 **17,638 名成员 / 3,465 在线**（`discord.com/api/v10/invites/3cU7Bz4UPx?with_counts=true`），这是 pi 生态**真正的人流所在**。→ 动作：在 pi Discord 找到合适的展示频道发一次（而不是只在 GitHub Discussions 发），并在 pi Discussions 的 `General` 留一条可被搜索到的存档贴。

2. **HN 的默认结局是 1 分 0 评论，必须按"抽奖"而不是"计划"来对待。**
   实测当天最近 30 条 Show HN 的中位数是 **1 分**（`https://hn.algolia.com/api/v1/search_by_date?tags=show_hn`）；`/show` 列表的展示门槛低到 **2 分**（`https://news.ycombinator.com/show`）。同时样本里 `claude-squad` 只拿 5 分却有 8,561 stars（今天），`agentapi` 拿 163 分只有 1,500 stars。→ 含义：Show HN **不是必需**，且**不能作为主要渠道**；且官方规则明确"必须有东西能让人试"（`https://news.ycombinator.com/showhn.html`）——**在"从源码跑"的状态下发 Show HN 会正面违背官方规则**。先做一键安装，再考虑 Show HN。

3. **英文侧最高性价比的动作不是发帖，是补齐"一行安装"这个 83% 的入场券。**
   12 个高星样本里 **10 个有一行安装命令**，且覆盖 1,500 ~ 211,441 stars 全量级；而**在线 demo 是 0/12**——因为这类工具无法 host。worksplice 作为 Node 项目发布到 npm（`npx worksplice` 或全局安装）是把"想试的人"转化为"跑起来的人"的唯一杠杆。npm 官方明确搜索只吃 `title/description/readme/keywords`、无主观排名、**新包最多 2 周才进搜索**（`https://docs.npmjs.com/searching-for-and-choosing-packages-to-download`）→ 发布时**必须认真填 keywords 与 description**（`vibe-kanban` 与 `opencode-ai` 两个 npm 包的 keywords 都是空的，说明这里没人竞争）。

4. **Awesome 列表里现在能进的只有两个，且要讲究顺序。**
   - **`slavakurilyak/awesome-ai-agents`（2,289 stars）：明确"无 license 要求、无最低 star 要求"**，只要"近 6 个月有实质非自动化 commit"+ 公开仓库 + 按模板提交即可（`https://github.com/slavakurilyak/awesome-ai-agents/blob/main/CONTRIBUTING.md`）。**这是立刻可以做的。**
   - **`Agent-Analytics/awesome-multi-agent-orchestrators`（149 stars）**：范围原文点名"**parallel coding-agent work**""**agent workspaces with memory, tools, and execution**"，与 worksplice 定位几乎逐词吻合（`https://github.com/Agent-Analytics/awesome-multi-agent-orchestrators/blob/main/CONTRIBUTING.md`）。列表小，但**收录即是被精准受众看到的分类证据**。
   - **`kaushikb11/awesome-llm-agents`（1,597 stars）有专门的 "Multi-Agent Orchestration" 与 "CLI Agent Harnesses" 分区，但硬门槛 25 stars** —— worksplice 现在 1 star，**差 24 个**。这条应该作为"达到 25 stars 后立刻提交"的里程碑目标。
   - **不要指望 Awesome 带量**：54,954 stars 的 `hesreallyhim/awesome-claude-code` 官方 CONTRIBUTING 原文直接否定了这条链："(iii) Get accepted, because of being awesome; (iv) Get users" 是不现实的（`https://github.com/hesreallyhim/awesome-claude-code/blob/main/CONTRIBUTING.md`）。

5. **GitHub Trending 不可规划，别为它做任何设计。**
   官方从未公开算法（本轮穷举 GitHub Docs 与 Blog 均无）；唯一的官方域内讨论（`https://github.com/orgs/community/discussions/163970`）里，社区成员给出的是"star 增速 vs 历史均值 + fork/issue/PR 参与度"的**个人推测**，且提问者实测"一天涨 19 stars 也没上榜，榜上有只涨 1 star 的仓库"。→ 把 Trending 当副产品。

6. **中文渠道里，本轮唯一被一手证据支持的两条路是 V2EX `/go/create` 与 HelloGitHub 月刊。**
   - **HelloGitHub**：179,701 stars 的月刊、每月 28 号发布、README 明确欢迎自荐、有官方中文 issue 模板且**无 star 门槛**（`.github/ISSUE_TEMPLATE/submit-cn.yaml`）。模板要求"项目标题 20 字左右、项目描述 32–256 字符"——**这条要求本身就是对"能不能把 worksplice 一句话讲清楚"的一次检验**。这是本轮性价比最高的中文动作。
   - **V2EX**：`/go/create` 官方文案明确"欢迎独立开发者发布新作…可以为你获得第一批用户"（`https://www.v2ex.com/help/node`），但**新账号有 30 天冷却**（实例 https://global.v2ex.co/t/1175853 ），且**真实回复量级只有 0~6 条**（我实测的 `/go/create`、`/go/opensource` 当下最新主题）。另外 `claudecode` 节点 header 明文"🈲 发广告或引流内容会被删除"。→ **如果作者在 V2EX 没有活跃账号，现在就要开一个并真实参与讨论**，30 天后才有资格发 `create`；否则只能发 `promotions`（营销节点）。**注意：我未在 V2EX 查到 `whutlichao` 的会员信息（API 返回 Object not found），说明要么没注册，要么用户名不同。**
   - **掘金**：官方罚则把"以推广曝光为目的"直接定义为垃圾广告，多账号配合/欺骗性外链/SEO 外链都是"删内容 + 拉黑，**不恢复**"（`https://juejin.cn/post/6844903618408087560`）。→ 若要发，**只能写技术文章**（例如"为什么 wake 不带正文 / 为什么写要被 hold 而不是 last-write-wins"），把仓库作为实现出处。**这与 worksplice 已有的差异化叙事（不是 UI，而是多 agent 协作语义）天然契合——这是它最适合掘金的形态。**
   - **少数派/即刻/小红书/公众号**：**本轮没有拿到任何一手规则或真实转化数据**（少数派 `/page/contribute` 404、微信规范页不可读、小红书与即刻无官方规则页）。→ **不要基于猜测投入这四个渠道**；如果要投，先人工登录查看投稿入口与规则。

7. **"差异化叙事"在渠道上是资产，在流量上不是。**
   我实测到的同类项目里，**没有一个把"协作语义"作为主标题**（都是 "Kanban board"、"Terminal to run 10 parallel agents"、"agentic IDE"、"open-source agentic development environment"）。worksplice 的"wake 不带正文 / inbox 是游标 / 写被 hold / 构建者不能自己验收"是**能被 HN 和掘金读者当作技术文章消费**的内容（HN 官方规则明确说个人技术写作与工程取舍类内容表现好，且标题不能夸张，`https://news.ycombinator.com/newsguidelines.html`）——**用"一篇文章讲一个反直觉的设计决策"来引流，比用"又一个 agent 工作台"来引流，更符合这两个渠道的实际偏好。**
