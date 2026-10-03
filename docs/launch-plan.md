# worksplice 推广计划（v1）

2026-10-03 定稿初版 · **D-day = 2026-10-16（周五）** · 备料窗口 10-09 → 10-15

这份计划把所有已经定下的决策收成一处：执行者照着走，不需要再做判断。**待办项用 `⏳` 标出**，完成即改状态。私有部分（触达名单与逐人判断）不在本文，见 `.scratch/promote-worksplice/plan-private.md`。

---

## 1. 目标与验收

| 线 | 判据 | 用途 |
| --- | --- | --- |
| **反馈数**（验收线） | 装上并给出任意一句真实反馈——**含「装不上」「看不懂」** | 达标线 **≥3–5** |
| **有效用户数**（讲故事线） | 跑过一轮真实的 agent 协作（频道里真的产生了 agent 的消息或任务状态变化） | 对外引用 |

**不算数**：star、转发、点进来看看。（同类项目里 HN 分数与长期 star 几乎不相关，这条指标只用来判断「有没有人真的用起来」。）

## 2. 定位与消息面

**一句话定位**（中英）：

> pi gives you one session at a time. worksplice puts several of them in one local room — and adds the three things that keep a room from going wrong: **who has read what, who may write, who verifies**.
>
> pi 一次只给你一个会话。worksplice 把几个会话放进同一个本地房间，并补上让房间不出错的三件事：**谁读到哪、谁能写、谁来验收**。

**四条语义**是全部论证的地基：唤醒不带正文、inbox 是游标不是队列、写被 hold 而不是 last-write-wins、构建者不能验证自己。

**与其他工具的关系**：分层声明（点名的只有 `agent-chat`——它自己写明「有意不做编排器」；以及泛类「并行终端管理器」），具体维度用匿名对照表，**不评优劣**。

**一句诚实说明**（放长帖的诚实说明段，不放开场）：pi 的路线图里有 **pi server**，会覆盖一部分；worksplice 是今天就能用、本地、一个 SQLite 文件、从头到尾可读的那个版本。

## 3. 首发出手与日历

| 日期 | 动作 | 谁能做 |
| --- | --- | --- |
| 10-03 → 10-08 | pi Discord：**已确认在群**；频道已定 **`# share-your-pi`**（论坛位，社区展示面且活跃）。剩：读 `# rules` 与置顶规范、答 2–3 个问题 | 只有作者 ⏳ |
| 10-06（一） | **feature freeze 开始**（只修 bug + 做推广资产） | — |
| 10-09（D-7 五） | `--demo`、README 中英改写、反馈模板 | ✅ 已完成（见 §4） |
| 10-03（提前 7 天完成） | `v0.1.0` tag + Release + `npm publish` | ✅ 已完成（见 §4 A2/A3） |
| 10-11（D-5 日） | 在 **Release 构建**里重跑证据 B ×2–3 | 可代做 ⏳ |
| 10-12（D-4 一） | 90 秒录屏（预留 3 次重跑）+ 补静态截图 | 只有作者 ⏳ |
| 10-13（D-3 二） | 静默提 `awesome-ai-agents` 清单；`awesome-multi-agent-orchestrators` 改开 issue | 作者 ⏳ |
| 10-14（D-2 三） | pi Discussions 发**克制版技术留档**（零请求、不 @ 人） | 作者 ⏳ |
| 10-15（D-1 四） | 首发长帖定稿（含 pi server 那句） | 草稿 ✅ 待定稿 |
| **10-16（D-day 五）22:00 CST** | **`# share-your-pi` 主帖**（论坛帖：标题 + 首帖；= 10:00 美东 / 16:00 中欧；启发式时刻，无一手数据） | 只有作者 ⏳ |
| 10-18（D+2 日） | HelloGitHub 提交（赶 10-28 期） | 作者 ⏳ |
| 10-19（一） | **freeze 结束**；10-19 → 10-24 发 V2EX `/go/create` 一次 | 作者 ⏳ |

## 4. 备料检查单

**A · 产品与分发**

- [x] **A1 `--demo`**：干净环境下 `npx worksplice --demo` 显示 4 频道 / 14 任务；**不触发任何 agent 轮次**。→ `#68`（合并后实测 `round_logs=0`、`~/.worksplice` 未被触碰）
- [x] **A2 Release**：`v0.1.0` tag + GitHub Release，资产 = `npm pack` 产物（5.6 MB）。→ [releases/tag/v0.1.0](https://github.com/whutlichao/worksplice/releases/tag/v0.1.0)（资产在干净目录实测可装可跑：4 频道 / 40 消息 / 14 任务 / `round_logs=0`）
- [x] **A3 npm 发布**：`npx worksplice` 干净环境实测可用；**不加 `pi-package` 关键词**。→ [npmjs.com/package/worksplice](https://www.npmjs.com/package/worksplice)（`npx --yes worksplice@0.1.0 --demo` 在干净环境实测通过）
- [ ] **A4 revise 硬项**：在 **Release 构建**里重跑证据 B 2–3 次，拿到 `[worksplice:revision]` 且该轮 `round_logs=replied`。⏳ 等 A2
- [x] **A5 README 中英**：定位句首段、Quick Start 一行安装、`--demo` 演示段。→ `#70`（层级与条目数逐项对齐）
- [x] **A6 反馈入口**：`tried-it` issue 模板 + `feedback` 标签。→ `#69`
- [x] **A7 对比表**：README 的「与其他工具的关系」。→ `#70`
- [ ] **A8 90 秒录屏**：纯字幕、10 镜分镜、第 5–8 镜真跑 + 3 张静态图。⏳ 只有作者
- [x] **A9 实测证据文**：失效报告 + 三个复现脚本。→ `#72`

**B · 文案**

- [x] **B1 首发长帖**：主帖 1590 + 续帖 1329 字符（卡在 Discord 2000 上限内）。→ `#71`
- [x] **B2 Discussions 留档帖**：纯技术、零请求。→ `#71`
- [x] **B3 两个清单的提交文案**。→ `#73`

**C · 触达与反馈**：名单与话术已就绪（私有）；**纪律：只走对方自己的仓库与私聊**。

**D · 纪律**：freeze 10-06 → 10-19；**不得出现任何发往 `earendil-works/pi` 的 issue/PR**（该仓库默认自动关闭新贡献者的 issue/PR，并对 tracker 刷屏永久封号）。

## 5. 连载（5 周）

每篇 = **仓库长文 + Discord 短帖引流**（Discord 单条上限 2000 字符，长文放不下）。

| 周次 | 问题场景 | 机制里子 | 语言 | 状态 |
| --- | --- | --- | --- | --- |
| W1（10-16） | 两个 agent、一个 checkout，谁说了算 | 四条语义 | 英文 | ✅ 文案已入库 |
| W2（10-23） | 我们以为做对了，真实链路里它 100% 失败 | 失效报告 | 英 + **中（掘金）** | ✅ 长文已入库 |
| W3（10-30） | 被唤醒的 agent 怎么知道自己错过了什么 | wake + 游标 | 英文 | 🟡 待拆章 |
| W4（11-06） | 两个 agent 抢同一个文件 | freshness-hold 深挖 | 英 + **中（掘金）** | 🟡 待拆章 |
| W5（11-13） | 谁有权宣布做完了；这套东西值不值 | 互审 + 重开封锁 + 成本与劝退 | 英文 | 🟡 待拆章，需真实成本数字 |

## 6. 里程碑与失败判据

| 代号 | 时间 | 触发条件 | 触发后做什么 |
| --- | --- | --- | --- |
| **M1** | D+14（10-30） | star ≥ 25 | 立刻提交 `kaushikb11/awesome-llm-agents`（其硬门槛） |
| **M2** | D+7（10-23） | 反馈数 ≥ 1 | 未达标则立刻启动一对一触达 |
| **F1** | D+2（10-18 末） | Discord 主帖 **48h 零实质回应** | 启动私聊（主帖冷启动时，发帖不如私聊） |
| **F2** | D+21（11-06） | 反馈数 < 3 | **停连载产出**，全力一对一；W5 降级为把成本与劝退并进 W4 的中文版 |
| **F3** | D+42（11-27） | 反馈数仍 < 3 | 判定「这轮没打中」→ 改定位或换受众重开一轮，**不再加大投入** |

## 7. 资源与纪律

- **预算 0 元**，只投入时间。
- **feature freeze**：10-06 → 10-19，只修 bug + 做推广资产。
- **红线**：不去 `earendil-works/pi` 发 issue/PR；不在公开频道 @ 人做推广；不群发同一段文字；不讲同类项目的优劣。
- **诚实纪律**：失效与错误照写（失效报告就是首发内容之一），不把预测说成事实。

## 8. 现在的状态

- **代码侧已合并**：`--demo`、反馈模板、README 定位与一行安装、首发帖草案、失效报告与复现脚本、清单文案，以及 raft 命名切割（`worksplice.db` + `lib/domain/collab/`）。
- **已发布（2026-10-03，比计划早 7 天）**：`worksplice@0.1.0` 在 npm 上，`v0.1.0` tag + GitHub Release 资产齐备；两者都在干净环境实测可装可跑。
- **只剩 3 项待办**：A4 在 Release 构建里重跑证据 B（可代做）；A8 录屏、Discord `# rules` 与答问（作者）。
- **发布前已验证**：`npm pack` 产物 5.6 MB、含 `demo/worksplice.db`；`npx --yes worksplice@0.1.0 --demo` 与 Release 资产两条路径都在干净目录跑出 4 频道 / 5 agent / 40 消息 / 14 任务 / `round_logs=0`。

## 9. 附录：证据与复现

- 三条语义各有可运行证明：`scripts/evidence/part-a-mechanism.sh`（hold，无模型）、`part-c-review.mjs`（互审，无模型）、`part-b-real-run.sh`（真实运行，需模型）。
- 失效与修复的完整记录：`docs/design-notes/when-a-held-write-could-not-be-revised.md`。
- 设计推理：`docs/design-notes/orchestrating-coding-agents.md`。
