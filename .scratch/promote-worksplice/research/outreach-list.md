# worksplice 定向触达候选名单（具体到人）

- 调研日期：**2026-10-03（UTC）**
- 数据口径：**只采信一手来源** —— GitHub REST API（`gh api`，认证账号 `whutlichao`）、`earendil-works/pi` 的 Discussions / Issues 原文、仓库 README 原文、npm registry API、pi.dev 官方包目录页
- 覆盖范围：`earendil-works/pi` 全部 **321 条 Discussions**（其中 134 条有评论，**430 条评论全部拉取**）、`state=all` issues 抽样 + 定向搜索、`topic:pi-package` / `topic:pi-extension` 各 Top 100 仓库（去重 144 个）
- 规则：每条候选至少一个可点开的 permalink；拿不到的一律写「未核实」，不编造
- ⚠️ 与同目录 `landscape.md` 的关系：那份是 2026-10-02 的生态规模调研，本文件是**人的名单**。两份文件的讨论评论数会不一致（过了一天，评论继续增长），以各自标注的实测日为准

---

## 名单规模与优先级（先说清楚怎么用这份名单）

本篇共收录 **23 人**：A 档 9 人 + B 档 7 人 + C 档 7 人（另附 2 位 pi 官方维护者，见文末附注）。

但任务目标是「**5–12 个值得一对一致意的人**」，所以下面标出**优先 12 人**（⭐）。**其余 11 人是有证据的备选池**，用于第一批触达无人回应时替换，不必都发。

**优先 12 人（⭐）**：

| 档位 | 优先人选 | 共几人 |
|---|---|---|
| A 档 | **全部 9 人**：nicobailon、tristone13th、Hysilens-Helektra、boadij、tmustier、tintinweb、prassanna-ravishankar、shmuelamit、liushihao456 | 9 |
| B 档 | alennartz、heresyrj（两人都是「一进程多会话」的架构级踩坑者，与 worksplice 同构） | 2 |
| C 档 | eterps（社区枢纽 + 明确只用 GitHub） | 1 |

**备选池（非优先）**：B 档 kamilakis、plus1998、AllanZyne、gotgenes、Q1y1ng；C 档 overtongeist、mindplay-dk、knocte、mroark1m、NonlinearFruit、aliou。

---

## 先说结论：最值得先接触的 3 个人

| 排序 | handle | 一句话理由 |
|---|---|---|
| 1 | **nicobailon** | pi 生态**下载量第一**的扩展作者（pi-mcp-adapter 51.4 万次/周），且**已经亲手做过 worksplice 的每一块拼图**：pi-messenger（715★，多 agent 共享 chat room + 认领任务 + 预留文件）、pi-intercom（525★，会话间 1:1 通信）、pi-subagents（3823★，"session sharing"）。他的反馈同时具备**技术深度**与**分发杠杆** |
| 2 | **tristone13th** | 唯一一个在公开 issue 里描述**已经跑起来的**「Main Chat + 多个 Side Chat 并发 AgentSession」的人，并且精确列出了缺什么（每会话独立 transcript/滚动位置、attach/detach、后台会话未读态）—— 这份需求清单和 worksplice 的能力几乎逐条对齐 |
| 3 | **Hysilens-Helektra** | `agent-chat` 作者，明确站「**不要 orchestrator，只要通信原语**」。worksplice 恰好也是「编排留在频道里、由 agent 自己认领」而非编排器，理念最接近，最容易产生真实对话（但账号很新，见下方风险标注） |

---

## A 档 · 明确在做多会话 / 多 agent 协作 / 会话共享的人

> 选人标准：**有可验证的公开产出**（仓库 / 已实现的扩展 / 具体的 issue 实现描述），而不是只表达兴趣。只看热闹的一律不进 A 档。

| handle | 生态位置 | 公开言行（附 permalink） | 为什么值得接触 | 切入点（first line） |
|---|---|---|---|---|
| **nicobailon**<br>(Nico Bailon) | npm 维护者名 `nicopreme`；pi 生态下载量第一梯队。pi-mcp-adapter 1575★ / 51.4 万次每周；pi-subagents 3823★ / 20.5 万次每周；pi-web-access 1569★；pi-messenger 715★；pi-intercom 525★。已进 pi 社区讨论 | ① pi-messenger README 原文：「**What if multiple agents in different terminals sharing a folder could talk to each other like they're in a chat room?** Join, see who's online and what they're doing. **Claim tasks, reserve files, send messages.** No daemon, no server, just files.」<https://github.com/nicobailon/pi-messenger> ② pi-intercom README：「Direct 1:1 messaging between pi sessions on the same machine… **Unlike pi-messenger (a shared chat room for multi-agent swarms)**, pi-intercom is for targeted 1:1 communication」<https://github.com/nicobailon/pi-intercom> ③ pi-subagents 描述含「artifacts, and **session sharing**」<https://github.com/nicobailon/pi-subagents> ④ 社区发言：<https://github.com/earendil-works/pi/discussions/297#discussioncomment-15352995> | 他**同时**踩过 worksplice 的三个核心问题：共享 chat room、会话间通信、任务认领/文件预留。而且他选的是「文件即总线、无 daemon」路线 —— 与 worksplice「本地服务端 + SQLite + wake 游标」正好是两种解法。他能一眼看出 worksplice 的差异化是否成立，他的认可在生态里权重最高 | 「你的 pi-messenger 把共享 chat room 做成了『文件即总线』，worksplice 走的是另一条路：**持久 agent 身份 + 服务端 freshness-hold（并发写被 hold 而不是 last-write-wins）+ inbox 游标唤醒**。想请你看一眼这个取舍值不值。」 |
| **tristone13th**<br>(Leinux) | pi 扩展作者（57 repos / 65 followers）；在 issue #5700 里描述**已实现**的多会话并发扩展（pi 0.82.0 实测） | 「We have long-lived `Main Chat` + multiple `Side Chat` `AgentSession`s running concurrently… What we ultimately need is: each live session keeps its own transcript and scroll position; the TUI can attach/detach and switch foreground session without stopping others; … **background sessions retain unread/activity state**」<https://github.com/earendil-works/pi/issues/5700#issuecomment-5087917695><br>（该评论含 AI 披露声明，明确标注「drafted with AI assistance from our implementation notes… reviewed before posting」） | **需求清单逐条对齐 worksplice**：独立 transcript ≈ 每 agent 自己的会话文件；后台未读态 ≈ worksplice 的 BAI-6 未读角标 + inbox 游标；attach/detach ≈ 频道切换。他已经踩过「一个 TUI 拥有所有会话」的坑，最懂 worksplice 为什么要把会话从 UI 里解耦 | 「你在 #5700 列的那五条需求，worksplice 几乎逐条撞上了 —— 它干脆放弃单 TUI，改成**频道 + 持久 agent 身份**，会话不属于任何 UI。你当时那些 workaround，哪些是你最想扔掉的？」 |
| **Hysilens-Helektra** | `agent-chat` 作者（pi 扩展，2 源文件 + 1 skill）；2026-09-26 在 pi Discussions 发 Show & tell | ① 「**agent-chat is intentionally *not* an orchestrator.** No primary agent, no subagents, no task graph, no file reservations… Just a lightweight peer-to-peer communication layer so independently running Pi instances can discover each other and exchange messages. **Agents decide for themselves when to talk, what to say, and how to resolve conflicts.**」<https://github.com/earendil-works/pi/discussions/10069> ② 仓库：<https://github.com/Hysilens-Helektra/agent-chat>（1★，topics 含 `multi-agent` / `pi-extension`）③ 触发场景：「running several independent Pi sessions (often in different worktrees) that share Docker containers, ports, databases… One agent starts `docker compose up`, another stops/rebuilds the same stack, and everything collapses into manual intervention」 | **理念最接近**：他也反对编排器，也要 agent 自主决定如何解决冲突。但 agent-chat 只解决了「能通信」，没解决「冲突了怎么办」—— 这正是 worksplice freshness-hold 的卖点。是**最容易产生高质量技术对话**的对象 | 「你写『agent-chat is intentionally not an orchestrator』，worksplice 也刻意不做编排器 —— 编排留在频道里，由 agent 自己认领、互审。你举的『两个 agent 抢同一个 docker compose』正是它 freshness-hold 要解决的：后来的写被 hold 而不是覆盖。」 |
| **boadij**<br>(Jeffrey Boadi) | `pi-herdsman` 作者（109★ / 8 forks），构建在 **Herdr**（`herdrdev/herdr`，41981★，「the runtime your coding agents live on」）之上；已进 pi 社区讨论 | ① 「Pi Herdsman is built on top of **Herdr**」<https://github.com/earendil-works/pi/discussions/3373#discussioncomment-18572229> ② 仓库描述：「Asynchronous Pi subagents and **agent fleet orchestration** for parallel coding agents with nested delegation, background work, and supervision」<https://github.com/boadij/pi-herdsman>（topics 含 `agent-fleet` / `multi-agent-coding` / `parallel-coding-agents`） | 他在**并行 agent 的监督与调度**层，且挂在 42k★ 的 Herdr 生态上 —— 意味着他的用户群天然是「同时跑多个 agent」的人，正是 worksplice 的目标人群。他的 pi-herdsman 解决「跑起来」，worksplice 解决「跑起来之后怎么协作」 | 「pi-herdsman 让一堆 agent 并行跑起来并受监督，接下来的问题就变成：它们之间怎么认领任务、怎么互审、谁在等谁。worksplice 就是那一层（频道 + claim/review + inbox 游标），想听听你在 Herdr 上看到的协作缺口。」 |
| **tmustier**<br>(Thomas Mustier) | pi 扩展作者（60 repos / 129 followers，博客 mustier.ai）：`pi-extensions` 488★、`pi-agent-teams` 109★、`pi-subagents`（含 session sharing）、`pi-session-hud`、`pi-for-excel` 434★ | ① `pi-agent-teams` 描述：「Experimental **agent swarm** extension for Pi. **Inspired by Claude agent teams.**」<https://github.com/tmustier/pi-agent-teams> ② `pi-extensions`：「A set of delightful extensions for Pi」<https://github.com/tmustier/pi-extensions> ③ `pi-subagents` 描述含「**session sharing**」<https://github.com/tmustier/pi-subagents> ④ `pi-session-hud`：「Persistent session HUD widget for Pi」 | 他做过 **agent swarm（团队）** 与 **session sharing** 两个方向，而且 `pi-extensions` 有 488★ 说明他有真实受众。swarm 路线的痛点很明确：一次性团队 vs worksplice 的持久身份 —— 这是一条天然的产品对比线 | 「你的 pi-agent-teams 借鉴 Claude agent teams，那种『一次性团队』散会就没了。worksplice 反过来做**持久身份**：agent 是长期成员，有 inbox 游标和提醒，跨任务不丢上下文。想请你评估这个方向是不是伪需求。」 |
| **tintinweb** | pi 生态最高星多 agent 扩展作者：`pi-subagents` 1244★ / 297 forks、`pi-tasks` 222★、`pi-gitnexus` 208★、`pi-schedule-prompt` 116★、`pi-messenger-bridge` 75★（Telegram/WhatsApp/**Slack**/Discord 桥）；另有 1593★ 的 smart-contract-sanctuary | ① `pi-subagents` 描述：「Claude Code like Sub-Agents & **Workflow Orchestration** for Pi — parallel execution, live widget, **fleet view**, custom agent types, mid-run steering」<https://github.com/tintinweb/pi-subagents> ② `pi-tasks`：「brings Claude Code-style **task tracking and coordination** to pi… dependency management, and a persistent visual widget」<https://github.com/tintinweb/pi-tasks> ③ `pi-messenger-bridge`：「Bridge common messengers (Telegram, WhatsApp, **Slack**, Discord) into pi」<https://github.com/tintinweb/pi-messenger-bridge> | **一个人占了两条关键线**：多 agent 编排（1244★，生态里最主流的方案）+ **Slack 桥**（worksplice 的产品隐喻就是 Slack）。聊「Slack 式的多 agent 工作台」他是最懂的人。注意他**未在 pi Discussions/Issues 发过言**（我用全部 321 discussions 作者+评论者、issues 作者交叉核验过），触达要走仓库 issue | 「你既做了 pi-subagents 的 fleet view，又做了 Slack/Telegram 桥 —— worksplice 正好是这两条线的交点：**一个本地自托管的 Slack 式工作台，agent 是常驻成员**。想请你从 Slack 桥作者的角度看，频道模型比 fleet view 多了什么、又笨在哪。」 |
| **prassanna-ravishankar** | `repowire` 作者（265★）：「**May the agents talk.** Connect Claude Code, Opencode, Codex, **Pi** across projects, across machines and with your telegram」；在 issue #5700 留言 | 「i hit the same design question building repowire (a **cross-runtime agent mesh**) and the thing that made it work was **decoupling session liveness from the foreground view entirely**: every session is a peer that stays running and addressable, and the TUI/dashboard is just a window onto whichever one you want. switching focus never touches the others.」<https://github.com/earendil-works/pi/issues/5700#issuecomment-4760569396><br>仓库：<https://github.com/prassanna-ravishankar/repowire> | 他独立得出了**和 worksplice 完全相同的架构结论**（会话是 peer，UI 只是窗口）。他是「跨 runtime agent mesh」的人，视野比单 pi 扩展宽，能给出生态位判断 | 「你在 #5700 说的『session liveness 与前台视图解耦、每个 session 是 peer』，就是 worksplice 的全部架构前提。差别在它把 peer 放进了**频道**里而不是 mesh 里 —— 你觉得 mesh 和 channel 哪个更像人真实协作的方式？」 |
| **shmuelamit**<br>(Shemi) | issue **#5700「Support multiple live agent sessions with TUI switching」** 的作者 —— 这是 pi 官方 tracker 里多会话方向**最集中的一条**讨论串（pi 维护者 mitsuhiko 亲自回复保留、badlogic 回复「this is what pi server will be for」） | ① issue 原文：「Make it so pi will be able to juggle between **multiple concurrent agent sessions** at once… Today `switchSession` tears down the current session so we can't have one background agent running while tending to another.」并提出 `pi.sessions` API 设想 <https://github.com/earendil-works/pi/issues/5700> ② 他对 liushihao456 扩展的点评（指出 ExtensionAPI 根本不够用）<https://github.com/earendil-works/pi/issues/5700#issuecomment-4746710511> | 他是**多会话方向的点火者**，且已经在 Discord 上直接和 mitsuhiko 讨论过用例（pi-tmux、claude-code style subagents、可点击的 subagent 列表）。他清楚 pi 核心的边界在哪，能判断 worksplice 是「补 pi 的缺口」还是「迟早被 pi server 吃掉」 | 「你在 #5700 里提的三个用例（pi-tmux、subagent 列表、能 steer 的运行中会话），worksplice 用**频道**这个形态全接住了 —— 而且不碰 TUI。想知道以你对 pi 核心边界的判断，这条外挂路线能活多久。」 |
| **liushihao456** | `pi-sessions` 作者：「**Run multiple live sessions in parallel in pi agent**」，直接在 issue #5700 里贴出来求 PR/建议 | ① 「I created an extension that does this: <https://github.com/liushihao456/pi-sessions> Any suggestions/PRs would be welcome」<https://github.com/earendil-works/pi/issues/5700#issuecomment-4725634110> ② 仓库：<https://github.com/liushihao456/pi-sessions>（3★，2026-06-17 建，最后 push 2026-06-20） | 他**真的动手实现了多会话并行**，而且被 shmuelamit 指出「不得不 import 一大堆内部函数」—— 他亲身撞过 pi 不支持多会话的那堵墙。这种「撞墙的人」对 worksplice 的绕行方案最有共鸣。⚠️ 项目 6 月后未更新，活跃度需先确认 | 「你的 pi-sessions 为了跑并发会话，不得不直接 import `InteractiveMode` / `SessionManager` 这些内部件。worksplice 索性不走 TUI 了，改成频道 + 常驻 agent。想请教你当时最痛的是哪一处。」 |

**A 档落选但相关的（未进表的原因）**：`AllanZyne`（pi-agent-views 做并发 sub-agent，但方向是 TUI 内视图切换，偏单机 UI）、`alennartz` / `heresyrj`（都在做多会话 server，见 B 档）、`plus1998`（eco-coding 有 orchestration，见 B 档）、`aliou`（cross-session tools 只停在 2025-12 的讨论）、`kamilakis`（web-agent 是单会话多入口，不是多 agent）、`monotykamary`（pi-messenger-swarm 40★，体量小但方向对）、`mrexodia`（toilet-pi 跨机器控会话，偏远程 UI）。

---

## B 档 · pi 扩展或工具的作者（已在生态里造东西，懂 pi 的边界）

| handle | 生态位置 | 公开言行（附 permalink） | 为什么值得接触 | 切入点 |
|---|---|---|---|---|
| **alennartz** | 在 Genetec 工作；pi Discussions #2830 作者 —— **多会话服务器的架构级反馈** | 「I run a server that manages **multiple concurrent `AgentSession` instances, each in a different project folder. One process, many sessions, many cwds.** `AgentSessionRuntime` calls `process.chdir()` after every session replacement… stomping the process cwd and breaking all other sessions.」<https://github.com/earendil-works/pi/discussions/2830> | worksplice 就是「一个进程托管多个 AgentSession」的同构架构，**必然撞同一个 `process.chdir()` 问题**。他是踩过这个坑的先行者，能直接给出架构层面的经验或警告 | 「你在 #2830 说的『一进程多 session 多 cwd，process.chdir() 把别人踩了』，worksplice 是同构架构 —— 想问你现在怎么绕的，以及你最后有没有放弃单进程方案。」 |
| **heresyrj**<br>(Thomas Ruan) | pi Discussions #1546 作者；44 repos / 34 followers；Sciese | 「We run a **daemon process (headless pi + WebSocket thin client) that hosts two sessions**: a conversation session for human interaction and a background session for automated task execution. When the second session's `registerTools()` runs, it **clobbers the first session's callbacks**… on `globalThis`」<https://github.com/earendil-works/pi/discussions/1546> | 他把「一进程多会话」的**具体 bug 面**列得非常细（callback clobber、singleton 覆盖、`/reload` 身份丢失），并且试过 5 种启发式都失败。这些是 worksplice 也会遇到的真实地雷 | 「你在 #1546 列的三个坑（globalThis callback clobber / singleton 覆盖 / reload 丢身份），worksplice 用**按成员 id 记账**而不是按 cwd 猜归属来绕。想知道你后来找到干净解法了没。」 |
| **kamilakis**<br>(Manos) | `web-agent` 作者：「Phone-friendly web dashboard + Siri/Matrix bridge for a **persistent pi coding-agent session** — one agent, three surfaces, one memory」 | ① 自我介绍贴：「The reason it exists at all is `pi --mode rpc`… **Building a concurrency-correct control plane on top of a protocol you can trust that much** is a completely different experience.」<https://github.com/earendil-works/pi/discussions/9525> ② 仓库：<https://github.com/kamilakis/web-agent>（MIT） | 他是**把 pi 当常驻服务托管**的那类人（一个持久会话 + 三个入口），和 worksplice「agent 常驻、多入口」同构。而且他对 RPC 协议的细节（`agent_start`/`agent_settled` 顺序、`streamingBehavior` 原子解析）有实测经验，是高质量技术对话对象 | 「你把一个持久 pi 会话接上了 Siri / Matrix / web 三个面。worksplice 把这个思路推到 N 个 agent 对 N 个频道 —— 想请教你在 RPC 上做并发控制面的具体踩坑。」 |
| **plus1998** | `eco-coding` 作者（4★）：「提供更开放、更自由、更人性化的开发体验」，自称 built on Pi，含 **Agent orchestration**（lead agent 规划、worker 并行 explore/code/test） | 「**Agent orchestration** — lead agent plans / accepts; workers handle explore / code / test in parallel, with cheaper models where it makes sense… **Still Pi at the core** — Skills, MCP, Plan/Ask/Agent, session resume; we didn't replace the harness」<https://github.com/earendil-works/pi/discussions/9327><br>仓库：<https://github.com/plus1998/eco-coding>（MIT，TypeScript，2026-10-02 仍有 push） | 他在做**「pi 之上的完整工作台」**，和 worksplice 是同一层级的产品（不是扩展）。他是**潜在竞品作者，但也是最能给出产品级批评的人**。中文母语，沟通成本低 | 「eco-coding 和 worksplice 都在 pi 之上搭工作台，但路线相反：你是 lead agent 派活，worksplice 是**没有 lead**、agent 自己在频道里认领和互审。想听你觉得哪种在真实团队里更能跑起来。」 |
| **AllanZyne**<br>(Yang Zhao) | Intel 编译器工程师；`pi-agent-views` 作者（并发 sub-agent，由 pi 自身渲染） | ① 「The goal is roughly what Claude Code's agent view feature does: **run several agents at once, each with its own model, and switch between them without losing anything**… Switching away never interrupts anything; a background agent just keeps going.」<https://github.com/earendil-works/pi/discussions/9373> ② 他自己标注风险：「**Early days, use with caution**: it mirrors agent transcripts into your session's `.jsonl` and patches pi's rendering, so a bug can mess up your session history」 | 他做的是**同进程内多 agent 视图**，并诚实承认「mirror transcripts 进 session jsonl」是危险做法 —— 这恰好是 worksplice「每个 agent 独立会话文件、不互相镜像」的反面教材。他大概率乐意讨论两种取舍 | 「你把 sub-agent 的 transcript 镜像进主会话的 `.jsonl`，自己标了『use with caution』。worksplice 反过来：**每个 agent 独立会话文件，靠频道消息而不是共享上下文协作**。想请你评估这是不是解决了你那个 caution。」 |
| **gotgenes** | `pi-anthropic-auth` 作者（**323★**，生态里高星扩展）；67 repos / 65 followers；issue #4207 作者 | ① 仓库：<https://github.com/gotgenes/pi-anthropic-auth> ② issue #4207「**Extension API: typed cross-extension service calls (beyond the event bus)**」<https://github.com/earendil-works/pi/issues/4207> | 他 323★ 的扩展说明有真实用户；而且他关心的正是 **扩展之间怎么互相调用** —— 多 agent 协作在 pi 里的底层难题之一。他是「懂 ExtensionAPI 边界」的典型 B 档 | 「你在 #4207 想要 extension 之间 typed service call，而不是靠 event bus。worksplice 干脆把 agent 间的协作搬到**服务端频道**上，绕开 extension 互调。想听你觉得这条绕行值不值。」 |
| **Q1y1ng** | pi Discussions #9552 作者：**Pi Heao GUI**（Windows 桌面客户端）；另有两个 GUI 项目 | ① 「Show & tell: Pi Heao GUI — a Windows desktop client for pi (built on the pi-agent-studio chat UI)」<https://github.com/earendil-works/pi/discussions/9552> ② 仓库：<https://github.com/Q1y1ng/pi-heao-gui>（3★）③ 另一个项目 `percho` 描述含「**Multi-session chat**, visual tool approvals, and custom themes」<https://github.com/Q1y1ng/percho> | 他连做两个 pi GUI，**并且已经在做 multi-session chat**。是「客户端视角看多会话」的人。中文母语，沟通成本低 | 「你的 percho 已经在做 multi-session chat 了。worksplice 把多会话做成了**频道 + 常驻 agent**，会话不再属于 UI。想知道从 GUI 作者角度，这个模型对界面是负担还是解放。」 |

**其他值得留意但资料较薄的扩展作者**（可作备选，未逐一深挖活跃度）：
`zhexusun10`（pi-trim，<https://github.com/earendil-works/pi/discussions/10304>）、`hakkm`（omp-ntfy，<https://github.com/earendil-works/pi/discussions/10107>）、`alexshpunt`（pi-agent-ide 11★，<https://github.com/earendil-works/pi/discussions/9775>）、`Agonieler`（pi-conversation-timer，<https://github.com/earendil-works/pi/discussions/9732>）、`jesset`（pi-verdict / pi-vetter，<https://github.com/earendil-works/pi/discussions/8803>）、`agustinsacco`（Phosphor 桌面 IDE，<https://github.com/earendil-works/pi/discussions/3373#discussioncomment-18387056>）、`QuintinShaw`（pi-dynamic-workflows 551★，<https://github.com/QuintinShaw/pi-dynamic-workflows>）、`edgehero`（pi-dispatch 178★，自托管服务，<https://github.com/edgehero/pi-dispatch>）、`monotykamary`（pi-messenger-swarm 40★，<https://github.com/monotykamary/pi-messenger-swarm>）、`mrexodia`（toilet-pi 跨机器控会话，<https://github.com/mrexodia/toilet-pi>）。

---

## C 档 · 高活跃的 pi 用户（在讨论里回答问题、提 issue、写插件清单的人）

> 口径：按**在 pi Discussions 里的评论条数**排序（我用全部 321 条讨论、**430 条评论**逐一统计）。这些人是真实重度用户，但**没有多 agent 方向的公开产出**，所以放 C 档。评论数排名：badlogic 30 → overtongeist 21 → mindplay-dk 14 → knocte 13 → aliou / garymjr / mroark1m 各 7。

| handle | 生态位置 | 公开言行（附 permalink） | 为什么值得接触 | 切入点 |
|---|---|---|---|---|
| **eterps**<br>(Erik Terpstra) | **pi 社区流量最高讨论的作者** —— #3373「Which plugins, add-ons, or extensions do you most enjoy using with the Pi agent?」共 **35 条评论，是全 321 条讨论里最高的**（第 2 名 #292 只有 18 条）。73 repos / 76 followers / 2008 年注册；Mastodon 活跃 | ① 开场原文：「**Since I prefer not to use Discord, I decided to ask my question here instead.** Which plugins, add-ons, or extensions do you most enjoy using with the Pi agent?」<https://github.com/earendil-works/pi/discussions/3373> ② 主动分享可复用工作流：「For fans of Matt Pocock's `/grill-me` skill, it pairs really well with the rpiv-ask-user-question Pi extension, but you need to tweak the `/grill-me` SKILL.md」<https://github.com/earendil-works/pi/discussions/3373#discussioncomment-16860560> | **两个稀缺属性叠加**：他是**社区枢纽**（一条帖聚集了 35 条评论，几乎生态里所有扩展作者都在下面自我展示过），而且他**明确表态不用 Discord、只用 GitHub**（见 ①）—— 意味着他是**纯 GitHub 触达路径下最容易命中的高价值目标**，不存在「他在 Discord 但我们找不到」的盲区 | 「你那条插件帖聚了 35 条回复，基本是 pi 扩展生态的一份快照。worksplice 想请你看的是另一种东西：不是插件，而是**多个常驻 agent 共享一个频道的工作台**。以你收集插件生态的眼光，这东西在 pi 里缺不缺？」 |
| **overtongeist** | **pi Discussions 评论数第 2**（21 条 / 15 个不同讨论串，仅次于 pi 作者 badlogic），最后发言 2026-06-20 | ① 对 pi 生态直言不讳：「such an aberration, who wants a heartbeat in a coding agent?」<https://github.com/earendil-works/pi/discussions/3373#discussioncomment-16633155> ② 对开源协作的态度：「Dude, this is opensource, so: 1. If you have the skills, work on it… 2. If you don't, delegate the work to an AI. 3. If the above doesn't work, pay a freelance developer (opensource doesn't mean free).」<https://github.com/earendil-works/pi/discussions/2813#discussioncomment-16610515> ③ 发起 #1874「Is sandbox enabled by default?」（13 条评论，生态里最热的讨论之一） | 他是**生态里最活跃的提问者/质疑者**，覆盖面广、见得多。但注意他的风格偏**尖锐、直接否定**（见 ①②）—— 适合要硬反馈，不适合要温和的早期支持 | 「你在 pi 讨论区问的问题跨度很大。想直接问你一个尖锐的：worksplice 把多个 agent 放进共享频道、并发写被 hold —— 你觉得这是真需求还是又一个 heartbeat？」 |
| **mindplay-dk** | **评论数第 3**（14 条 / 5 个讨论串），182 repos / 232 followers，最后发言 2026-08-08 | ① 对沙箱扩展的实测反馈：「I did some early testing to see if the agent could 'break the rules', and it couldn't — blocking network access and file access really works at the kernel level」<https://github.com/earendil-works/pi/discussions/2792#discussioncomment-16861121> ② 明确说自己为什么选 pi：「I came to Pi for an agent that actually takes instructions — CC and OpenCode have bloated, opinionated system prompts, whereas **Pi has a tiny system prompt that I can understand and modify**」<https://github.com/earendil-works/pi/discussions/3176#discussioncomment-16747049> ③ 主动做扩展发现：「I discovered pi-landstrip today, and it is brilliant!」<https://github.com/earendil-works/pi/discussions/3373#discussioncomment-17425854> | **会实测、会写长反馈**的人（见 ① 的测试方法）。而且他明确表态喜欢「小而可理解」的设计 —— worksplice 的定位（本地自托管、可读的服务端）与这个价值观契合。他是**高质量早期反馈**的理想来源 | 「你说你选 pi 是因为它的 system prompt 小到能读懂。worksplice 想守住同样的品味：本地自托管、数据是自己的 SQLite，不藏在 SaaS 后面。想请你用你测沙箱那套方法挑它的毛病。」 |
| **knocte** | **评论数第 4**（13 条 / 6 个讨论串），243 repos / 104 followers；同时是 `skynot` 的作者（pi 的 Unix 权限隔离方案，多次发版） | ① 持续发布 skynot 版本日志（v2.67.68 → v2.75.5），含 npm provenance 等供应链实践 <https://github.com/earendil-works/pi/discussions/2483#discussioncomment-17060475> ② 对权限交互设计的立场：「I find it strange that you're a Pi user and you state this. I thought many of us came to Pi precisely because we found CCode exhausting about asking for confirmation too much」<https://github.com/earendil-works/pi/discussions/3176#discussioncomment-16680786> | 他是 **C 档里唯一同时是扩展作者**的人（skynot），工程规范意识强（provenance、pinned deps）。既懂 pi 边界，又有安全/权限视角 —— 对「多个 agent 共享一个工作区」的信任模型会有独到意见。最后发言 2026-05-26，**活跃度偏低，先确认再投入** | 「你给 pi 做了 Unix 权限级隔离（skynot）。worksplice 里多个常驻 agent 共享同一个频道和目录 —— 从你的威胁模型看，这算不算你当初想防的那类场景？」 |
| **mroark1m** | **评论数并列第 5**（7 条 / 2 个讨论串，分别是 #6926 与 #6253），最后发言 2026-08-01；#6926「Default model using llama.cpp?」的主要参与者 | ① 在本地模型讨论里持续追问细节（7 条评论中有 5 条在此帖）<https://github.com/earendil-works/pi/discussions/6926#discussioncomment-17860650> ② 参与 #6253「We need a working, functional sandbox feature」<https://github.com/earendil-works/pi/discussions/6253> | 他是**本地模型 / llama.cpp 路线**的用户。worksplice 是**本地自托管**产品，本地模型用户是天然受众（不依赖云、在意数据在自己机器上）。这个人群匹配度比云端 API 用户更高 | 「你在 pi 上跑本地 llama.cpp。worksplice 也是本地优先 —— 连 agent 之间的消息总线都在你自己机器上。想知道你会不会把它跑在一台常开的机器上，还是觉得这是多余的层。」 |
| **NonlinearFruit** | 4 条评论 / 4 个不同讨论串（21 repos / 35 followers），最后发言 2026-06-09 | ① 公开分享自己的整套 pi 配置与 dotfiles：「Here are the things I use (with the package config to import them). Most all of my `~/.pi/agent/` can be found in my dotfiles ([NonlinearFruit/dotfiles](https://github.com/NonlinearFruit/dotfiles/tree/master/pi))」<https://github.com/earendil-works/pi/discussions/3373#discussioncomment-16712881> ② 后续讨论 <https://github.com/earendil-works/pi/discussions/5551#discussioncomment-17236763> | 他是**会公开分享配置的人** —— 这类用户是天然的传播节点（dotfiles 会被别人抄）。而且他 4 条评论分布在 4 个不同讨论串，说明是长期活跃而非一次性 | 「你把整套 pi 配置放进了 dotfiles，说明你不介意让别人抄你的工作流。worksplice 是另一个可以整包抄走的东西：本地跑、SQLite、频道即配置。想请你试一周看会不会留在你的 dotfiles 里。」 |
| **aliou**<br>(Aliou Diallo) | **评论数并列第 5**（7 条 / 2 个讨论串，即 #284 与 #292），58 repos / 232 followers；#284「Thoughts on implementing "cross sessions" tools?」作者 | ① 提出跨会话工具的设计讨论：「Reading [badlogic/pi-mono#281]… custom compaction could be a substitute for handoff」<https://github.com/earendil-works/pi/discussions/284#discussioncomment-15328156>（pi 作者 badlogic 亲自回复表示愿意扩展 custom commands）② 自评：「Thinking more about it I may be trying to fit the familiar UX of amp in pi, which might not be the way to go」<https://github.com/earendil-works/pi/discussions/284#discussioncomment-15330619> | **他是 A 档话题的最早提出者**（2025-12 就在想 cross-session tools），且被 pi 作者正面回应过。但他最后发言停在 2025-12，**7 个月未在 pi 讨论区出现**，活跃度存疑 —— 所以放 C 档而非 A 档 | 「你在 2025-12 就提了 cross-session tools，badlogic 当时说愿意扩展 custom commands。后来这事没成 —— worksplice 干脆在 pi 外面用频道把跨会话做掉了。想知道你当年的设想和它差多远。」 |

---

## 不建议接触的人（含理由）

> 原则：**宁可少列，不硬凑**。以下都是有公开记录可查的「不匹配」，不是猜测。

| handle / 对象 | 理由（含证据） |
|---|---|
| **wgnrai**（Wagner dos Santos，wgnr.ai 总裁） | 他在 #3373 的第一条评论就是自我推销自己的 pi 项目 <https://github.com/earendil-works/pi/discussions/3373#discussioncomment-16613846>，但**他贴的仓库链接 `github.com/wgnr-ai/wgnr-pi` 现在 404**；同名项目已迁到 `arvindbattula/wgnr-pi` 且 **0 star**。即：**他承诺的公开产出已经消失**，且账号带有明显商业推广动机（bio 自称 wgnr.ai 总裁）。作为「真实用户」证据不足 |
| **accessvirus** | pi Discussions #4673 标题「swarms」，**正文只有「swarms」一个词**，0 评论 <https://github.com/earendil-works/pi/discussions/4673>。无任何可验证产出，属于噪声而非候选 |
| **A-KumarSharma** | 在 #5700 留言「I would love to help you to get started a new feature as a contributor」<https://github.com/earendil-works/pi/issues/5700#issuecomment-4701944880> —— **只表达意愿，没有任何产出或后续**。典型「只表态」的人，不符合 A 档标准 |
| **Hysilens-Helektra**（⚠️ 不是不建议，是**需注意风险**） | 虽然进了 A 档（理念最接近），但账号数据需要如实标注：**2026-07-17 注册、仅 1 个公开仓库、0 followers、无 name/bio**（`gh api users/Hysilens-Helektra` 实测）。agent-chat 仓库 1★。**接触价值高，但「是否长期留存」不可验证** —— 建议当成一次性高质量技术对话，不要指望他成为长期用户或传播节点 |
| **纯「泛 AI 开发者」/ awesome-list 维护者** | 本次全量扫描中，大量高星仓库（如 `OthmanAdi/planning-with-files` 27263★、`datawhalechina/Agent-Learning-Hub` 8340★）只是**名单/教程类**，与 pi 生态无一手交互记录。第一受众已定为 pi 生态，这些不在范围内 |

---

## 数据缺口与拿不到的东西（诚实记录）

1. **Discord 里的对话拿不到。** pi 官方 README 首屏就是 Discord 邀请（`https://discord.com/invite/3cU7Bz4UPx`），而**多条关键线索明确指向 Discord**：
   - `shmuelamit` 在 #5700 说「I have presented a few use-cases **on discord** to @mitsuhiko」（<https://github.com/earendil-works/pi/issues/5700>）
   - `mindplay-dk` 说「I'm actually one of the users who may have floated this idea **on the Discord or Reddit**」（<https://github.com/earendil-works/pi/discussions/3176#discussioncomment-16621788>）
   - `eterps`（#3373 作者，该帖是全社区评论最多的讨论）开场就写：「**Since I prefer not to use Discord, I decided to ask my question here instead.**」（<https://github.com/earendil-works/pi/discussions/3373>）—— 反过来说，**存在一批明确只用 GitHub、不用 Discord 的用户**，这批人恰好是本次调研覆盖得最好的部分
   → **Discord 里很可能存在一批比 GitHub 更活跃的多 agent 用户，本次完全无法覆盖**（需要人工账号加入）。这是本名单最大的盲区。
2. **⚠️ 生态里有两个不同的 `pi-subagents`，务必别搞混**（本次实测确认，两者都真实存在）：

   | 仓库 | star | npm 包名 | 作者 |
   |---|---|---|---|
   | `tintinweb/pi-subagents` | 1244★ / 297 forks | `@tintinweb/pi-subagents` (v0.19.0) | **tintinweb** |
   | `nicobailon/pi-subagents` | 3823★ / 773 forks | `pi-subagents` (v0.75.0，无 scope) | **nicobailon** |

   `nicobailon` 的才是那个 **20.5 万次/周**下载、pi.dev 目录里默认展示的版本；`tintinweb` 的是更早的、体量小一些的实现。**给两人写开场白时不要张冠李戴**，否则第一句就露怯（两人都在 A 档）。
3. **`nicopreme` 这个 GitHub handle 不存在**（`gh api users/nicopreme` → 404）。它是 npm 上的 maintainer 名，对应的 GitHub 账号是 **`nicobailon`**（npm 包的 `repository` 字段与 `author: Nico Bailon` 双向确认）。我按 `nicobailon` 收录。
4. **`jmearman` 这个 GitHub handle 也不存在**（404）。`agent-comms` 的 npm maintainer 名是 `jmearman`，但仓库 `ExaDev/agent-comms` 的实际提交者是 **`Mearman`**（815 次提交，ExaDev 组织公开成员）。我按 `Mearman` 收录，两者是否同一人**未核实**。
5. **issues 没有全量拉取。** 仓库共 **6674 个 issue + 3329 个 PR**（`search/issues` API 实测），我只全量拉了前 600 条（6 页）+ 做了 9 组定向搜索。**可能存在遗漏**，特别是早期（2025-12 ~ 2026-02）编号较小的多会话相关 issue。
6. **`wgnr-pi` 的现状未能完整核实。** 原链接 404，迁移目标 `arvindbattula/wgnr-pi` 与 `wgnrai` 账号的关系无法确认。
7. **部分候选的「近 30 天活跃度」只有间接证据。** GitHub public events API 只返回最近约 90 天且可能被截断；我主要用 `pushed_at`（仓库最后推送）与「pi Discussions 最后发言日期」两个代理指标。**`tintinweb` 未在 pi Discussions/Issues 出现过**（经全量交叉核验），触达必须走仓库 issue 而非社区帖。
8. **没有核实任何人的邮箱/私信渠道。** 全部联系渠道都只有 GitHub（issue / discussion comment / 仓库 README 里的联系方式），未做进一步探测。
9. **中文圈覆盖可能不足。** 我只在 GitHub 公开数据里找，微信/即刻/小红书/知乎上的 pi 用户完全没有覆盖（`plus1998`、`Q1y1ng` 是从 GitHub 中文描述里识别出来的）。

---

## 触达纪律建议（基于本次看到的一手证据）

> 以下每条都指向具体原文，不是通用建议。

### 1. ⚠️ **绝对不要把 worksplice 当成 issue / PR 发到 `earendil-works/pi`**

`CONTRIBUTING.md` 原文（<https://github.com/earendil-works/pi/blob/main/CONTRIBUTING.md>）：

- 「**All issues and PRs from new contributors are auto-closed by default.**」（README 首屏也重申了这句）
- 「Write in your own voice (**do not use an LLM to generate text**, if you must, follow up with a clearly AI labeled comment).」
- 「If you open an issue, **keep it short, concrete, and worth reading**. Keep it concise. If it does not fit on one screen, it is too long.」
- 「**Do not open a PR unless you have already been approved by a maintainer using `lgtm`**」
- 封锁条款：「If you ignore this document twice, or if you **spam the tracker with agent-generated issues, your GitHub account will be permanently blocked**. … If you send a large volume of issues through automation, your GitHub account will be permanently blocked. **No taksies backsies.**」

→ **风险是账号级的、不可逆的**。用 `whutlichao` 去 pi 仓库发推广性质的 issue/PR，会直接赌上推广者的主账号。**不要做。**

### 2. ⚠️ **Show & tell 不是类目，而且历史成绩极差 —— 别把它当获客渠道**

pi Discussions 只有 **一个** 类目（`general`，GraphQL `discussionCategories` 实测），「Show & tell」只是发帖人自己写在标题里的前缀。全部 6 条 Show & tell 帖的互动数据（2026-10-03 实测）：

| 评论数 | 标题 | 作者 | permalink |
|---|---|---|---|
| 1 | agent-chat: peer-to-peer messaging for independent Pi agents | Hysilens-Helektra | <https://github.com/earendil-works/pi/discussions/10069> |
| 0 | Pi Heao GUI | Q1y1ng | <https://github.com/earendil-works/pi/discussions/9552> |
| 0 | pi-conversation-timer | Agonieler | <https://github.com/earendil-works/pi/discussions/9732> |
| 0 | pi-agent-ide | alexshpunt | <https://github.com/earendil-works/pi/discussions/9775> |
| 0 | omp-ntfy | hakkm | <https://github.com/earendil-works/pi/discussions/10107> |
| 0 | pi-trim | zhexusun10 | <https://github.com/earendil-works/pi/discussions/10304> |

→ **同类「展示贴」历史最佳成绩是 1 条评论，5/6 条是 0。** 这条路只能算「留档 + 被搜索到」，**不能当获客渠道**。如果仍要发，预期管理要到位：它的价值是 SEO 与「有人搜到时能找到」，不是流量。

### 3. ✅ **真正有效的分发渠道是 npm → pi.dev 官方包目录**

`pi.dev/packages`（<https://pi.dev/packages>）是官方包目录，页面原文：「**Extensions, skills, prompt templates, and themes published to npm. Install with `pi install npm:<package>`**」，当前收录 **5382 个包**，且有「Most downloads / Recently published」排序。

→ **把 worksplice 作为 pi package 发到 npm，会被官方目录自动收录**，这是唯一有规模的、合规的、不惹人烦的曝光路径。对照数据：`pi-mcp-adapter` 51.4 万次/周、`pi-subagents` 20.5 万次/周（npm downloads API 实测，2026-10-03）。**这比在 Discussions 发帖的杠杆高几个数量级。**

### 4. ✅ **一对一触达的正确姿势：走对方自己的仓库，不走 pi 官方 tracker**

本次 A 档候选里，**有真实产出的人几乎都有自己的仓库**（`nicobailon/pi-messenger`、`boadij/pi-herdsman`、`Hysilens-Helektra/agent-chat`、`ExaDev/agent-comms`…）。这些仓库是他们自己的地盘，在那里开 issue 讨论技术取舍是**正常且受欢迎**的（`liushihao456` 就明确写「Any suggestions/PRs would be welcome」）。

→ 建议路径：**先读对方的 README，在自己的仓库里写一篇「我们做了不同的取舍」的对照文档，然后去对方仓库开一个不带推销语气的技术讨论 issue**，而不是在 pi 官方区发广告。`Hysilens-Helektra` 在 #10069 结尾写的「**Any observations or edge cases are welcome**」就是这类邀请。

### 5. ⚠️ **注意 pi 核心正在做 "pi server" —— 这是定位风险，也是一对一谈话里绕不开的问题**

`badlogic`（pi 作者）在 issue #5700 明确回复：

> 「**this is what pi server will be for. shoehorning this on the current architecture will not work, due to the way extensions need to be started and stopped.**」
> <https://github.com/earendil-works/pi/issues/5700#issuecomment-4779558575>

`mitsuhiko`（pi 维护者、Flask 作者）在同一条 issue 里保留了它作为讨论位，并说：

> 「**I'm keeping this open for the moment to have a place to discuss what the agent harness / pi itself might need to do to support multi agent usage better.** I don't expect us to work on this, but I think there is some veracity to this feature request.」
> <https://github.com/earendil-works/pi/issues/5700#issuecomment-4699510927>

另外 pi README 原文：「Pi ships with powerful defaults but **skips features like sub-agents and plan mode**. Ask Pi to build what you want, or **install a package that does it your way**.」
<https://github.com/earendil-works/pi>

→ 两条含义：
  - **好消息**：pi 官方明确「多 agent 不属于核心，应该做成 package」—— worksplice 作为 package/外挂路线**在官方立场上是受认可的**。
  - **风险**：官方在规划 "pi server"，功能面与 worksplice 有重叠。**A 档里 `shmuelamit`、`tristone13th`、`prassanna-ravishankar` 三个人都直接问过 pi server 的进展**（`tristone13th` 甚至追问「is there now a public RFC/tracking issue for Pi Server, and is there any rough milestone or release window」，但**截至 2026-10-03 未见公开答复**）。
  - **建议**：一对一开场时**主动提及 pi server 并给出 worksplice 与它的分工假设**，比装作不存在更可信。回避这个问题，A 档里最聪明的几个人会当场问出来。

### 6. 其他可操作细节

- **`overtongeist` 要硬反馈，不要软推广。** 他有公开的尖锐表达史（「such an aberration」）。对他用「请挑毛病」比「请试用」有效。
- **中文候选（`plus1998`、`Q1y1ng`）沟通成本最低**，可以作为**第一批试水对象**先跑通触达流程。
- **`nicobailon` 值得单独花时间**。他是唯一同时具备「做过同题」「有分发量（pi-mcp-adapter 51.4 万次/周）」「在社区里出现过」三个条件的人。建议不要用模板化开场，先认真读 `pi-messenger` / `pi-intercom` 的 README 全文再写第一句。

---

## 附注：pi 官方维护者（不属于 A/B/C 档，但必须知道）

这两位是 **pi 项目方（earendil-works）** 的人，不是「生态用户或扩展作者」，所以没放进 A/B/C。但 worksplice 完全依赖 pi，他们的态度决定天花板，**建议在名单之外单独处理**：

| handle | 身份（一手） | 相关公开表态 |
|---|---|---|
| **badlogic** | pi 作者。**pi Discussions 评论数第 1（30 条 / 13 个讨论串）**；账号在 pi 讨论区极其活跃 | 对多会话问题：「**this is what pi server will be for. shoehorning this on the current architecture will not work**」<https://github.com/earendil-works/pi/issues/5700#issuecomment-4779558575>；对跨会话工具曾表态「I would be open to extending the custom commands… I could imagine that hooks can register their own commands」<https://github.com/earendil-works/pi/discussions/284#discussioncomment-15328756> |
| **mitsuhiko** | **Armin Ronacher**，Flask 作者，earendil-works 创始人（GitHub bio 原文：Creator of the Flask framework. Founder of @earendil-works）。26319 followers | 保留 #5700 作为多 agent 讨论位：「**I'm keeping this open for the moment to have a place to discuss what the agent harness / pi itself might need to do to support multi agent usage better.**」<https://github.com/earendil-works/pi/issues/5700#issuecomment-4699510927> |

→ **注意**：`badlogic` 就是 `CONTRIBUTING.md` 里那条「永久封号」条款的执行方。**不要用推广目的去打扰他们**；如果将来要接触，切入点应该是「pi server 之外还缺什么」这类真实的产品讨论，而不是「请看看我的项目」。

---

## 附：本次调研的可复核命令

```bash
# 讨论全量（321 条）
gh api "repos/earendil-works/pi/discussions?per_page=100&page=1..4"
# 单条讨论评论
gh api "repos/earendil-works/pi/discussions/10069/comments?per_page=100"
# Discussions 类目（实测：只有 1 个 general，isAnswerable=false）
gh api graphql -f query='{ repository(owner:"earendil-works", name:"pi") {
  discussionCategories(first:20){ totalCount nodes { name slug isAnswerable } } } }'
# 生态仓库
gh api "search/repositories?q=topic:pi-package&sort=stars&order=desc&per_page=100"
gh api "search/repositories?q=topic:pi-extension&sort=stars&order=desc&per_page=100"
# npm 下载量
curl -s "https://api.npmjs.org/downloads/point/last-week/pi-mcp-adapter"
# 官方包目录
curl -s "https://pi.dev/packages"
```
