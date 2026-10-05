# 02 — 首发消息面：定位句、主打场景、对比口径

**Type:** grilling
**Blocked by:** —
**Status:** resolved

## Question

首发要说清的三件事相互牵制，必须一起定：

1. **一句话定位**（中英各一版）。landscape 实测同类项目**没有一个**把「协作语义」当主标题（都是 "kanban board" / "run 10 parallel agents" / "agentic IDE" / "agentic development environment"）。worksplice 的差异化（wake 不带正文、inbox 是游标、写被 hold、构建者不能自己验收）是**技术文章的素材**，不是**一句话定位的素材**。那么一句话到底说什么——「多个 pi agent 共用一个工作台」？「给 pi 加一层团队协作语义」？还是从痛点说「两个 agent 抢同一个文件时会发生什么」？
2. **主打哪一幕场景**。Q12 已定收窄：首发只打穿一个场景，不展示全套能力。候选需从 `scripts/seed-demo.mjs` 的演示数据（虚构团队 Beacon 监控台一周的工作）与真实使用里选，判据是「90 秒内能被看懂」。
3. **对比口径**。与 `agent-chat`（P2P、明确不做编排器）、`vibe-kanban`、`claude-squad`、`pi-chat` 等相邻项目怎么比——列维度不点名，还是点名对比？如何在讲清差异的同时不贬低别人（HN 规范禁夸张标题、awesome 列表明令避免营销语言）。

**产出**：定位句中英各一版 + 选定的主打场景 + 对比表的口径与措辞规格（不是成品表，是「比什么、怎么写」的规则）。

## Answer

2026-10-02 与作者逐轮谈定（两轮 8 问，全部按推荐定案）。

### 1. 定位句（主版，中英）

> **EN** — pi gives you one session at a time. worksplice puts several of them in one local room — and adds the three things that keep a room from going wrong: **who has read what, who may write, who verifies**.
>
> **中文** — pi 一次只给你一个会话。worksplice 把几个会话放进同一个本地房间，并补上让房间不出错的三件事：**谁读到哪、谁能写、谁来验收**。

骨架：类别词 = 房间 / workspace；差异化 = 三条协调语义。句式 = 承认 pi 的现状 → 给它们一个共享房间 → 补上三条语义。（被否掉的骨架：房间喻 (A) 与团队喻 (B) 都用同类项目满地都有的 channels / task board 词；痛点喻 (D) 把项目压缩成一个并发场景，天花板太低。）

### 2. 受长度限制的变体（渠道硬要求）

| 用途 | 文本 | 约束 |
| --- | --- | --- |
| awesome 清单 / npm / GitHub 简介 | `Local Slack-like workspace for teams of pi coding agents.` | 57 字符（多数清单要求 ≤60） |
| HelloGitHub 标题 | `给多个 pi agent 一个共享协作工作台` | 17 字（模板要求约 20 字） |
| HelloGitHub 描述 | `pi 一次只能跑一个会话；worksplice 把几个 pi agent 放进同一个本地房间：频道讨论、任务认领与互审、提醒与唤醒，并用「谁读到哪、谁能写、谁来验收」三条语义避免它们互相覆盖或自说自话。本地 SQLite，默认只监听 127.0.0.1。` | 约 120 字符（模板要求 32–256） |

### 3. 对比口径

- **分层声明（点名、不评优劣）**，正文只出现一次：点名 `agent-chat`（同生态，它自己写明「有意不做编排器」——是不同层，不是竞品）＋泛类「parallel terminal managers（vibe-kanban、claude-squad）」，划成「不同问题」而不是「不同水平」。

  > worksplice sits at a different layer from tools you may already use. `agent-chat` deliberately stays a peer-to-peer messaging layer — discovery and transport, no orchestrator. Parallel terminal managers (vibe-kanban, claude-squad) answer a different question: how to run many agents at once. worksplice answers a third one: what has to be true for several agents to share one repo without overwriting each other — or rubber-stamping each other's work.

- **不点 `earendil-works/pi-chat`**：官方自家项目且已停滞 4 个月（landscape），在官方社区里点名等于踩人。
- **维度对照表匿名**（列「典型做法 / worksplice」，不写任何项目名），5 行：

| 维度 | 典型做法 | worksplice |
| --- | --- | --- |
| 唤醒一个 agent 时给什么 | 把消息正文推进去 | 只给 hint `{agentId, targetId, seq}`，正文由 agent 按游标自取 |
| agent 怎么知道自己漏了什么 | 看「最后一条消息」或重读全表 | 持久化游标：读不推进、ack 才推进，崩溃重跑读到同一份输入 |
| 两人基于同一旧版本写 | last-write-wins 或自动合并 | 写被 **hold**，返回「房间已经变了」和变了什么，作者自己选 revise / resend / silent / anyway |
| 谁有权宣布做完 | 作者说完就完 | 状态机 + **构建者不验证自己**（必须另一个成员 approve） |
| 装在哪、边界在哪 | 云端、要账号 | 本地一个 SQLite 文件，默认只听 `127.0.0.1` |

- **措辞纪律**：每行写成「问题 → 做法」，不写「我们比他们好」；HN 规范禁夸张标题、awesome 列表明令避免营销语言（landscape「渠道效率证据」）。
- **定位句里出现 `pi`**（Q4）：第一受众是 pi 生态、首发在 pi Discord，「pi 用户」在那里是身份而不是门槛；等第二波（HN / `--demo`）再写一句不带 pi 的变体，而不是现在为泛化牺牲精准。

### 4. 主打场景（输入给票 03 与票 05）

- **主体 = 并发写裁决**：两个 agent 基于同一房间版本写，第二个被 hold，它选择 revise，房间没有被覆盖。选它是因为它正面回答 README 开篇「两个 agent 抢同一个文件」的痛点，且是同类项目里没人做的那一件。
- **开场 30 秒借「构建者不验证」的任务板 + 互审画面**（`seed:demo` 现成、一眼能懂）承担「这是什么」；后 60 秒用真实 hold 现场承担「凭什么可信」。
- 已知约束：`scripts/seed-demo.mjs` 明确断言「不应触发 freshness-hold」（`if (result.held) throw`），**hold 现场必须真跑**——正是票 05 的实验。

### 5. 执行后果（不在本图内；进就绪检查单与计划汇编）

- 中英双 README **首段**换成新定位句；正文现有的「两个 agent 抢同一个文件」故事保留为第二段。
- GitHub 仓库简介与短变体对齐（现简介 148 字符，至少不得与新句冲突）。
- 「谁读到哪 / 谁能写 / 谁来验收」成为首发文案与 README 的公共锚点，后续票一律引用这套词。
