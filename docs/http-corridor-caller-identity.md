# HTTP 走廊的调用者身份（决策文档）

**状态**：形态已定（成员面整体移出 HTTP、人类面非 loopback fail-closed），待实施票。
**口径说明**：Q1（调用者身份 vs 认证）与 Q5（`dev:lan` 姿态）经 `orchestration ask` **回收裁定**——取「成员面整体移出 HTTP」与「非 loopback fail-closed」；Q4（秘书 `[锁定]` 条目）同一通道**裁定**「锁的是能力面不是通道」，并附两条追问（本文决策一里逐条答）；Q3（env 面与请求面的先后）与其余推论按预授权落地。来源逐条标在各决策。
**票**：`agent-tool-path-guard` 票 04（设计票 / grilling）。
**关联**：ADR-0013（本票新增）、ADR-0012（决策六定的排序链，本票是第一环；**且本票解除了它「本形态不使用网络过滤」那条保留的理由**）、ADR-0011（票 02 已合入 `a2d4634`，本票前置事实）、ADR-0001（家目录与共享项目目录）、ADR-0007（SDK 委托边界）、ADR-0008（分层与深模块）、`.github/SECURITY.md`（既有暴露面口径）、`docs/spec-bootstrap-agent.md`（秘书的 `[锁定]` 能力面）。

---

## Problem Statement

**洞**：worksplice 的 app 自己的 HTTP 面**没有调用者身份**。进门一律按 Owner 处理（`lib/domain/collab/channels.ts:7`，`CURRENT_MEMBER_ID = OWNER_MEMBER_ID`）。而 `POST /api/agent/[id]` 接受任意命令（`app/api/agent/[id]/route.ts:17`、`:26`），`{"type":"bash"}` 经 `lib/rpc/session.ts:746` 进入 `AgentSession.executeBash` 的**裸本地实现**（`dist/core/agent-session.js:3037` 的 `options?.operations ?? createLocalBashOperations({ shellPath })`——worksplice 不传 `operations`）。于是：**任何能摸到端口的东西，都能让 app 代它跑一条未沙箱的 shell。**

### 收窄：成员侧要的不是「一道门」，是「整面不可达」

成员侧的正当用途**是零**（决策一的取证）。因此本票要解决的不是「怎么给成员侧的调用认证」，而是「**怎么让成员侧根本不构成一次调用**」。这个收窄决定了整个形态：**加门要加在凭证上，而凭证对成员无效**（决策一的承重论证），所以任何「加一道身份门」的方案都会造出一个**看起来有门、实际没有门**的形态——比没门更坏，因为后来者会以为它被守住了。

同一面里最直接的一条入口是 `{"type":"bash"}`：它把「以 Owner 权限执行任意命令」这条路直接交出去。同一 Owner 权限面上还有几条**同级或更强**的入口（`/api/plugins` 的包安装 = 在 server 进程里跑代码；`/api/models-config` 写 `models.json`；`/api/auth/api-key/*` 存删 provider 凭证；`/api/skills/install`；`/api/worktrees`；`/api/files/[...path]`），它们与 `{"type":"bash"}` 同属「成员一旦可达即升级」的这一面——本票按**整面**处置，不逐条加门。

### 为什么这是级联而不是并列残留

ADR-0012 决策六把它判成排序链第一环，本票把理由收紧：ADR-0012 决策三把沙箱的归属定成「**会话归属的成员**」，**无归属**的会话（人类自己的会话）不沙箱；而这条路由让调用者**自己挑会话**。所以调用者只要挑一个无归属的会话，就从「受沙箱约束的成员 shell」升级成「未沙箱的裸 shell」。**沙箱层关不掉它——因为沙箱层决定不了「谁在问」。** 同理它也让票 02 的六工具守卫失效：那条路径根本不走工具。

**威胁模型沿用票 01 / 02 / 03**（不改）：提示注入 + 模型自发探索，**不是**「防一个有界面访问权的对手」。`.github/SECURITY.md` 把这条界线写死（「任何能摸到端口的东西都能直接调接口」；「agent 执行有界面访问权的人给的指令」不算漏洞）。本票的产出因此是**爆炸半径的收口**：让被注入的成员不能把 app 当成一台「以人类权限运行的控制台」。

### 事实底稿（本票不重查，来自既有文档 + 本机取证）

| # | 事实 | 出处 |
| --- | --- | --- |
| F1 | 默认 bind `127.0.0.1`；`npm run dev:lan` / `start:lan` / `--hostname 0.0.0.0` / `WORKSPLICE_HOSTNAME` 放宽到 `0.0.0.0`。**四条 npm 脚本直接起 `next`，绕过 `bin/worksplice.js`** | `.github/SECURITY.md`「Default bind」；`package.json:34`/`:39`/`:41`/`:42` |
| F2 | 认证存在但**默认关闭**：`WORKSPLICE_PASSWORD` → HTTP Basic Auth，用户名固定 `pi`；未设或为空则完全关闭。**共享密码，给不出身份** | `lib/web-auth.ts`；`.github/SECURITY.md`「Authentication」 |
| F3 | Host 白名单放行 loopback 名与 **IP 字面量**（注释写明理由：保住局域网访问、同时防 DNS rebinding）；不发 `Origin` / `Sec-Fetch-Site` 的客户端**不做来源校验** | `lib/request-security.ts:76-88`、`:90-99`；`.github/SECURITY.md`「Cross-site requests」 |
| F4 | `getShellEnv()` 是 `{...process.env}`（只额外追加 PATH 里一处 bin 目录）→ app 的**完整**环境变量进每个成员的每个 bash 子进程 | `dist/utils/shell.js:115-126` |
| F5 | **pi 自己已有这条纪律**：`resolveSpawnContext` 显式 `delete` 掉 `PI_SESSION_ID` / `PI_SESSION_FILE` / `PI_PROVIDER` / `PI_MODEL` / `PI_REASONING_LEVEL`。`WORKSPLICE_*` 没有对偶 | `dist/core/tools/bash.js:137-143` |
| F6 | 秘书的 curl 能力面是 `[锁定]` 条目；§9.2 验收点是「创建类操作（建频道 / 建 agent / 发消息 / 设提醒）经 curl 全链路可用（7 条速查实测）」 | `docs/spec-bootstrap-agent.md:87-89`、`:289` |
| F7 | **agent-loop 不走 HTTP**：`docs/spec.md` §5.7 明写「服务层全部在 `lib/` 内实现，API route 仅做薄封装——**agent-loop 直接调服务层，不走 HTTP**」；loop 的回复 prompt 里不出现 base URL、`127.0.0.1`、`curl` 任何一项 | `docs/spec.md:363`；`lib/agent-loop/loop.ts` 全文 grep |
| F8 | `docs/spec.md` §5.4 的 act 动作清单**本来就包含** `schedule reminder` / `react` / `pin`（走协作服务层的进程内调用）——秘书手册越过这道未实现的缺口去用了 curl | `docs/spec.md:333` |
| F9 | 环境面里还有一条与凭证无关的路径泄漏：用户显式设了 `PI_CODING_AGENT_DIR` / `PI_CODING_AGENT_SESSION_DIR` 时，指向 `~/.pi/agent` 的路径进成员 shell（F5 的 delete 清单不含这两项） | `README.md:177`；`docs/spec.md:309` |

---

## Solution

一句话：**把 app 自己的端口定成「人类面」；成员面整体移出 HTTP。**

| # | 通道 | 处置 |
| --- | --- | --- |
| 1 | **env 面**（app 的完整环境变量 → 每个成员的每个 bash 子进程） | `WORKSPLICE_*` 一律不进成员 shell；**剥法是命名空间一刀切、不带成员判定分支**（决策三）；用户自己的环境变量照旧 |
| 2 | **请求面 · 成员侧** | **app 的协作面整体不再经 HTTP 暴露给成员侧**：默认不向成员发放任何凭证；成员需要的系统能力全部走**进程内接缝**（身份由调用点结构给出，不由请求头自述）；成员的进程在内核层够不到本端口 |
| 3 | **请求面 · 人类侧** | loopback 上维持零配置姿态（Host 白名单 + 浏览器来源校验）；**非 loopback bind 一律 fail-closed**：无凭证拒绝服务（决策二） |

**承重的那一句**：成员 bash 与人类**同 uid、同 loopback**，本机没有任何 OS 级手段能区分两者；一个必须由调用者持有的凭证，**必然可被那个调用者读到**。于是「关掉成员侧」只有一条路——**让成员手里没有到本端口的 HTTP 客户端**；而让成员没有 HTTP 客户端正是 ADR-0012 已经在做的两件事（沙箱落地前 fail-closed、落地后按端口过滤）。**成员侧走廊没有需要经 HTTP 提供的东西，所以它不需要一道门——它需要不可达。**

---

## User Stories

1. 作为人类 Owner，我想让被注入的成员**不能把 app 当成一台以我的权限运行的控制台**，这样一次注入的爆炸半径止于该成员自己的允许根与沙箱。
2. 作为人类 Owner，我想让「成员挑了哪个会话」不再是一条权限通道——`POST /api/agent/[id] {"type":"bash"}` 不该能把无归属会话（我自己的会话）当跳板，这样沙箱的「跟随会话归属成员」不会有例外口。
3. 作为人类 Owner，我想让成员**根本不持有** app 的任何秘密，这样我不必担心一份凭证泄漏到某一个被注入的成员手里。
4. 作为人类 Owner，我想让 `WORKSPLICE_PASSWORD` 不再出现在任何成员的 `env` 输出里，这样「设了密码」这件事不会因为一条 `env` 就归零。
5. 作为人类 Owner，我想让 `npm run dev:lan` / `start:lan` 在没凭证时**拒绝服务**而不是默默监听 `0.0.0.0`，这样我不会以为「只是本机」而实际把文件与裸 shell 借给整段局域网。
6. 作为人类 Owner，我想在本机使用时不被迫配置任何凭证，这样 `npx worksplice` 的开箱即用不被安全收口牺牲。
7. 作为人类 Owner，我想让秘书的创建类能力**一条不少地**保留下来，这样收口不把产品能力一起收走。
8. 作为人类 Owner，我想让秘书与普通成员的权限面**完全一致**，这样收口不开在被注入概率最高的那个成员身上。
9. 作为成员，我想在建频道 / 建 agent / 设提醒时**不必知道任何秘密、不必记 base URL**，这样我的手册里没有东西可泄漏。
10. 作为成员，我想让 app 知道**我是谁**（而不是把我当 Owner），这样我的动作以我自己的名义落库、受我自己的边界约束。
11. 作为成员，我想让「我当前的边界」在动作被拒时可见——沿用路径守卫的 D7 意图：报边界、不静默改写、不静默截断。
12. 作为开发者，我想让「这个子进程能拿到什么」只有**一处**答案（env 剥法与沙箱落在同一接缝上），这样两层约束不会各自漂移。
13. 作为开发者，我想让「谁是调用者」由**调用点**决定而不是由请求头自述，这样测试里可以真的构造「以成员 X 的身份」，而不是伪造一个 header。
14. 作为开发者，我想让 `{"type":"bash"}` 这条入口的守卫归属**在文档里写死**，这样实施票不会以为还差一道门、也不会以为它已经没人管。
15. 作为开发者，我想让人类面的 HTTP 契约有**真的端到端**测试（而不是读源码正则断言），这样「秘书不再走 curl」不会把创建类端点的覆盖一起带走。
16. 作为开发者，我想知道 fail-closed 这条原则被哪几处引用，这样若人类推翻它，我不会只改一处。

---

## Implementation Decisions

### 决策一（成员面整体移出 HTTP——身份取结构，不取凭证）

**来源**：Q1 + Q4 经 `orchestration ask` 回收裁定（Q1 取「不做凭证、成员面移出 HTTP」；Q4 取「锁的是能力面不是通道」）；Q1 的前置问题由取证得出。

#### 1.1 前置问题：普通成员经 HTTP 调 app 的 API，有哪些正当用途？

**答案是「没有，且是结构性的没有」**，三条取证：

1. **F7**：`docs/spec.md` §5.7 明写「agent-loop 直接调服务层，不走 HTTP」。成员的整条协作循环——drain、reply、claim、complete、ack——都在**进程内**完成，一条 HTTP 请求都不需要。
2. 成员的回复 prompt（`buildReplyPrompt`）里不出现 base URL、`127.0.0.1`、`curl` 任何一项：**成员从来没有被教过**有这条路。唯一被教过的是秘书，而那本手册是**内容资产**（`lib/domain/collab/secretary-init.ts` 写入 `MEMORY.md` / `SYSTEM-GUIDE.md`），不是机制。
3. 秘书手册 7 条 curl 覆盖的能力分两类：只读（频道 / 成员 / 消息 / 任务板 / 提醒 / 搜索）与创建类（发消息 / 建频道 / 建 agent / 设提醒）。只读那一类**每轮语境里已经有了**——`buildReplyPrompt` 已经注入 channel 语境、`#seq @author` 消息与相关任务状态。无处可去的只有创建类；而 **F8** 表明 `docs/spec.md` §5.4 的 act 清单**本来就写了** `schedule reminder` / `react` / `pin`——**spec 早就把它们判给了进程内调用**，实现只是没跟上，于是有人把 curl 当成了替代的动作通道。

**结论**：**成员侧走廊没有需要保护的东西**——不是「A 更好」，是「B/C/D 要解决的那个问题本身不存在」。唯一要收的是**整面可达性**，其中 `{"type":"bash"}` 是最直接的一条入口（见 Problem Statement 的收窄）。

#### 1.2 承重论证（排除凭证类方案的主因，非次要理由）

| 区分手段 | 成员能不能破 | 结论 |
| --- | --- | --- |
| OS 级（不同 uid / socket peer credentials） | 同 uid，`SO_PEERCRED` / `getpeereid` 给出同一个值 | **不成立**（除非给每个成员换 uid——比本票大得多的架构改动） |
| 浏览器头（`Origin` / `Sec-Fetch-Site`） | `curl -H 'Origin: http://127.0.0.1:30142'` 一条 flag | **不成立**：这是 CSRF 防御，其前提就是「攻击者是设不了头的浏览器」；成员是真客户端，不是浏览器 |
| 一个调用者必须持有的秘密 | **必然可读**——它得用那个秘密才能调用；读得到，注入就照用 | 只能给「**可区分**」，给不了「**挡得住**」 |

**第三条是主因**：凡是「调用者要自己出示」的凭证，对「调用者已被注入」这个威胁模型都不构成围栏。共享密码与 per-agent token 都落在这条上——它们都是**成员读得到的东西**，而成员有 bash。**唯一关得掉的形态是「成员够不到的通道」**，也就是进程内接缝：身份由调用点结构决定，不由凭证自述。

**被否决的三条 + 一条组合**（各附具体理由）：

- **强制 `WORKSPLICE_PASSWORD`** —— 否决。① 它消灭零配置（README 与 Quick Start 的第一条承诺），买到的只是「非成员不能调」；成员侧本来就是本票要关的那一面，它关不掉（第三条：共享密码必须被成员读到才能用，或干脆用不了——两种都不是围栏）。② 它给不出身份：`CURRENT_MEMBER_ID` 仍是常量 `owner`，一次通过准入闸的调用照样以 Owner 身份落库。③ 它与「不做秘书豁免」直接冲突：秘书要 curl 就得持有它——而把密码写进秘书家目录正是**今天的锁定条目这么教的**（`docs/spec-bootstrap-agent.md:88`：「设了 `WORKSPLICE_PASSWORD` 时 curl 加 `-u pi:<密码>`」）。
- **per-agent token** —— 否决。落 1.2 第三条：必须由调用者持有的秘密对「调用者已被注入」不构成围栏；它能给的可分辨性，结构身份给得更强（不可伪造、不可转发）且不需要任何凭证存在；另外它还引入发放、存储、轮换、撤销四条长期维护面，全部落在**成员可读**的地方。
- **分离端口** —— 否决。同 uid、同文件系统、同一个 app 进程；「分离」只是把同一把锁换到另一扇门，不改变「谁能连上」。真正要分离的是**能力面**——那正是「成员面整体移出 HTTP」在做的事。它的代价是真的：多一条要长期维护、要单独做暴露面审计的监听面，而收益为零。
- **组合（强制密码 + per-agent token）** —— 否决。上两条的代价相乘、收益相加，没有新的性质。

#### 1.3 形态：一个决策，不是两条并列措施

**app 的协作面整体不再经 HTTP 暴露给成员侧**——这一条同时是「成员侧的关闭」和「秘书能力面的迁移」，它们是**同一条缝**，不是两条并列措施。分成两条写会让后来者以为 HTTP 面还给成员留着用途。三部分：

| 部分 | 取值 |
| --- | --- |
| **成员获得系统能力的通道** | loop 的**结构化回复协议**（`lib/agent-loop/loop.ts` 的 `parseAgentAction`）——今天已承载 `{"action":"reply"\|"ignore","content":…,"onConflict":…,"task":{"number":N,"op":"claim"\|"complete"\|"unclaim"}}`。创建类操作作为**新 op** 加进来，与 `claim`/`complete` 同一条缝、同一套 freshness 纪律 |
| **身份** | **结构身份**：`runAgentRound` 握有 `agent`（起这一轮的那个成员），调用点天然知道它代表谁——不经请求头、不经凭证 |
| **HTTP 面** | 从此是**人类面**：浏览器与人类自己的脚本/进程（后者的权限与人类 shell 同权，见残留 #3）。成员侧不再有对象 |

**权限面**：op 对全部成员同等开放（**不做秘书豁免**）；能不能做由协作服务层按调用者身份裁决。今天是服务层函数**没有调用者参数**（它们按 Owner 语义写），补参数与授权表是本决策点名的实现面。判据（规则由本票给，表由实施票落）：**默认拒绝，逐条开口；开口的判据是「该动作不提升调用者的权限，只扩大协作面」**——发消息 / 建频道 / 设提醒 / 搜索 / 读：开口；建 agent：开口（新身份受**同一套**约束——路径守卫 + 沙箱 + 不持有凭证——因此它不提升调用者的权限；它的成本面是资源问题，归 `docs/cost-monitoring-baseline.md`，与本层无关）；**人类专属操作不开**（`spec-bootstrap-agent.md` §3.2 的归档 / 删除身份 / Restart / Session reset / Full reset / 改 runtime / 改 workspace）。

**7 条能力映射（1:1 对位，一条不少）**：频道列表 → `listChannels`；成员列表 → `listMembers`（建 agent 前取 provider/modelId 走 `listModels`）；发消息 → 已经是 `reply` 本身（跨 target 指针消息为 `post{targetId}`）；建频道 → `createChannel`；建 agent → `createAgent`；搜索 → `search{q}`；设提醒 → `scheduleReminder`。

**为什么不注册新工具**：注册工具会动「秘书工具集 = `PRESET_DEFAULT`」这条锁定条目的字面。虽然 `getPresetFromTools`（`lib/tool-presets.ts:65-68`）在比对前先按 `BUILTIN_TOOL_NAMES` 过滤，所以**扩展提供的工具本来就不会让档位标签漂移**（`lib/tool-presets.ts:24-27` 的注释把这条写死了；本机取证确认）——但那是**兜底的免责理由，不是推荐形态**：注册工具毕竟改了模型看到的工具表，而回复协议 op 什么都不改。**结论：op 形态不构成档位漂移（它根本没碰档位）；工具形态本也可以不漂移，但既然 op 已经够用，就不去动那条锁定的字面。** `lib/tool-presets.ts` 全程不动。

**为什么这是补缺口不是扩权**：F8 表明 spec §5.4 的 act 清单本来就含 `schedule reminder` / `react` / `pin`。本决策是**把实现补齐到 spec 已经写下的形状**，并把被 curl 绕开的那部分收回同一处。

#### 1.4 秘书 `[锁定]` 条目（Q4 裁定 + 本票追加的第四层）

**裁定**：锁的是**能力面**（bash 可用、curl 可用、7 条命令可用、零配置、base URL 稳定），不是**通道**（凭证从哪来、经哪个接缝）。

**理由**（前三条来自 ask 回收的 coordinator 裁定，第四条是本票追加的）：
1. 锁定的目的是**保住能力清单**——进程内接缝把这份清单一条不少地保住了（§1.3 的 7 条 1:1 对位）。
2. 换通道后「零配置」这条锁定不是被削弱、是**被加强**——进程内接缝不需要用户去设 `WORKSPLICE_PASSWORD` 才让秘书能干活。
3. 仓库既有惯例支持这个读法：行为一致优先于字面锁定，术语与措辞服从「与既有仓库语言保持一致」这条更强的约束。
4. **本票追加（比前三条更硬，因为它是「不能」而不是「不必」）**：锁定条目 `docs/spec-bootstrap-agent.md:88` 的末句「设了 `WORKSPLICE_PASSWORD` 时 curl 加 `-u pi:<密码>`」——若照字面实现，等于把 app 的准入秘密**写进成员家目录**（速查 §3 就在 `MEMORY.md` 里）。这条不是「改不改」的取舍：任何「秘密不落进成员可读处」的形态与它**不相容**。所以这一句必须退休，**无论是否换通道**。

#### 1.5 追问 1 的答案：MEMORY.md 的「7 条 curl 实测可用」怎么办

- **速查 §3 写什么**：这一节从「bash + curl，7 条实测可用」改为「**回复动作，7 条实测可用**」，表格逐行换成 7 条 op；**删掉 base URL 行与密码行**（换通道后写 curl 是错的，且那两行本身就是泄漏面的教法）。`≤150 行` 的预算**不受影响**——它约束的是文件长度；删两行、换一张表，净行数**下降**。
- **验收怎么算**：`spec-bootstrap-agent.md:289` 的「创建类操作经 curl 全链路可用（7 条速查实测）」改为「**创建类操作经回复动作全链路可用（7 条速查实测）**」。
- **「同等强度」的论证（按强度三要素逐条对，不降级替代）**：一次回放的强度由三件事组成——① **真执行**（不是读源码断言）；② **库里有可观察副作用**（频道行 / 成员行 / reminder 行 / 消息的 target 与 seq）；③ **错误语义真被触发过**（400 / 409 held）。进程内回放三项全给，并额外给第四项：**身份被结构性固定**（断言「成员 X 的 op 以 X 的名义落库」）——这是 curl 回放**给不了的**（今天所有 curl 回放都是 Owner 身份，`CURRENT_MEMBER_ID` 恒为常量）。所以不是降级。
- **一处真损失，点出来而不是抹平**：curl 回放顺带覆盖了**人类面的 HTTP 契约**（端点名 / 参数 / 状态码）。那部分不能跟着消失。诚实地说，今天这层覆盖本来就弱——`lib/domain/collab/messages-route.test.mjs` 一类是**读源码正则断言**（`readFile` + `assert.match`），不是真跑 HTTP。所以「curl 回放迁走」不是从强到弱的降级，而是**暴露了一处本就存在的缺口**；正确归处是**人类面的真 HTTP 端到端测试**（Testing Decisions 列了这条）。

**代价（写明，不藏）**：收口的强度依赖「成员手里没有 HTTP 客户端」这条不变量，它在沙箱落地前由 ADR-0012 决策五单独成立、落地后由内核端口过滤成立——**两个阶段各有一条支撑，中间没有空窗**（决策五给出完整链条）。协议要扩、服务层要补调用者参数，那是真工作量。

### 决策二（人类面的准入：loopback 零配置，非 loopback fail-closed）

**来源**：Q2（不作强制凭证，loopback 零配置）+ Q5（`dev:lan` 取 fail-closed）——两者同属「人类面的门」，合并成一条。

1. **默认不向成员发放任何凭证**（决策一已定），**也不强制 `WORKSPLICE_PASSWORD`**。loopback 上维持今天的零配置姿态：`npx worksplice` → 浏览器打开 → 可用。人类是自己机器的 Owner，这条姿态由 `.github/SECURITY.md` 的威胁模型背书（「agent 执行有界面访问权的人给的指令不算漏洞」）。
2. **`WORKSPLICE_PASSWORD` 的职责收窄为「非 loopback 的准入闸」**，明确**不承担身份**。设了它的人得到的是「局域网 / 代理场景的准入」，不是「调用者可识别」。
3. **非 loopback bind + 无凭证 ⇒ 服务不可用**（fail-closed，与 ADR-0012 决策五同构：拿不到安全前提就不提供服务，不静默降级）。

**为什么必须 fail-closed（本机取证，F1 + F3）**：`npm run dev:lan` / `start:lan` 是 `next dev -H 0.0.0.0 -p 30142`，**绕过 `bin/worksplice.js`**——而那条「没有认证就以 `0.0.0.0` 监听」的警告（`bin/worksplice.js:70-80`）正住在那个包装里。于是今天走 npm 脚本放宽 bind 时，**连警告都不会打**：现状不是「有警告但可忽略」，是**连警告都没有**。而 Host 白名单放行 **IP 字面量**、非浏览器客户端不做来源校验 ⇒ 局域网里任何一台机器一条 `curl http://<ip>:30142/api/agent/<会话> -d '{"type":"bash",…}'` 即拿到 Owner 权限（文件 + 裸 shell + 全库 + 插件安装）。

**「检查放在哪」的决定性理由**：**只改 `bin/worksplice.js` 会漏掉四条 npm 脚本**（`dev` / `dev:lan` / `start` / `start:lan`），以及任何人手敲的 `next dev -H 0.0.0.0`。所以判定**必须落在服务进程内**（`proxy.ts` / `instrumentation.ts` 一类位置），CLI 包装里另加一道明确报错作为第一道。**实施票要取证「`instrumentation.ts` 里抛错能否真的阻止 Next 启动」**——若不能，就以请求门为准，把「启动即拒」如实记为未达成，不要写成已达成。

**用户可观察后果（向人类报备项）**：`npm run dev:lan` / `start:lan` 在未配置凭证时将**拒绝服务**；想要局域网访问必须先设凭证。这是安全默认，但确实改变现有用法。

**不做的事**：不靠「只允许 loopback 名、拒绝 IP 字面量」替代——那是把 `dev:lan` 这个产品能力直接砍掉，属产品决策，与「给非 loopback 加门」是两件事。本决策也不引入新的凭证形态。

### 决策三（env 面与请求面的先后：协调器判断成立但有前提，且它不是请求面的替代品）

**来源**：Q3 的独立验证（不照抄协调器判断；结论：成立，但要重述）。

协调器的判断是「**env 收口是前置，否则认证自欺**」。**独立验证结论：成立，但前提要说准，而且不能把它当请求面的替代品。**

**成立在哪**：只要请求面的门是**凭证**，而凭证经由 `getShellEnv()`（F4）进入每个成员的每个 bash 子进程，成员一条 `env` 就把凭证读到了——**这道门对威胁模型里的那个主体（被注入的成员）完全不成立**。「认证自欺」准确地描述了那种状态；今天 `WORKSPLICE_PASSWORD` 就在这条通道上。

**要重述在哪**（三处）：

1. **env 收口不是「请求认证的前置」，是「凭证渠道的前置」。** 它约束「秘密怎么发放」，不约束「请求面收不收」。本票既然否决了靠凭证的门（决策一），这句话的对象就变了：它的前置地位在**将来任何一种靠秘密的机制**上仍然成立（例如人类面的密码、ADR-0012 决策二将来的每成员凭证），不因本票的形态选择而消失。
2. **做了 env 收口不等于请求面收紧了。** 请求面的默认姿态是「**无认证**」（F2），env 收口对它毫无作用。**把 env 收口当成请求面的替代品是一种新的自欺。** 两者是两条独立通道，必须都处置——协调器的取证事实 7 说的正是这句话，本票把它落成硬结论。
3. **更前置的那一条在别处。** 比 env 收口更前置的是「**成员手里不能有到本端口的 HTTP 客户端**」（决策五的链条）——env 收口只堵一条泄漏通道，那一条堵的是整面走廊。

**env 面的落地取值（实施票输入）**：

- **剥法：命名空间一刀切**（`WORKSPLICE_*`），**不带成员判定分支**。理由不是省事，是 **fail-closed 形态**：若写成 `if (是成员会话) 剥`，那么**任何一条归属信息缺失的路径就是泄漏路径**——而「归属信息缺失」正是本票在处理的失效形态本身。无分支的形式没有这个失效模式。
- **代价（可接受）**：人类自己的 `!bash` 也看不到 `WORKSPLICE_*` 了。人类在自己的终端里有它，代价为零。
- **范围**：本条约束的是「app 自己的秘密」。今天这一类里**只有 `WORKSPLICE_PASSWORD` 一项**。其余 `WORKSPLICE_*`（`WORKSPLICE_HOSTNAME` / `WORKSPLICE_ALLOWED_HOSTS` / `WORKSPLICE_DATA_DIR` / `WORKSPLICE_DEMO`）不是秘密，一并剥掉按命名空间更省心，但**别在文档里把它们说成秘密**。
- **顺带一笔（F9，卫生项不是承重点）**：`PI_CODING_AGENT_DIR` / `PI_CODING_AGENT_SESSION_DIR` 是 pi 的 `delete` 清单**没**覆盖的两项，用户显式设了它们时，指向 `~/.pi/agent` 的**路径**进成员 shell。**路径本身不构成可达**（票 02 的允许根与 ADR-0012 的沙箱都把 `~/.pi/agent` 挡在门外），所以是卫生问题不是围栏缺口。**不要剥 pi 故意暴露的那五项**（`PI_SESSION_ID` / `PI_SESSION_FILE` / `PI_PROVIDER` / `PI_MODEL` / `PI_REASONING_LEVEL`）——pi 的 bash 工具 guideline 明确告诉模型可以读它们。
- **接缝（本机取证，实施票直接用）**：
  - **两个 shell 面**——bash 工具面（`createBashToolDefinition(cwd, options)`）与 RPC 面（`lib/rpc/session.ts:746` 的 `executeBash`）。
  - bash 工具面有**一等接缝** `BashToolOptions.spawnHook`：「Hook to adjust command, cwd, or env before execution」，入参 `BashSpawnContext { command, cwd, env }`（`dist/core/tools/bash.d.ts`）。
  - RPC 面**没有** `spawnHook`：`executeBashWithOperations` 调 `operations.exec(command, cwd, { onData, signal })`，**不传 `env`**（`dist/core/bash-executor.js:65`），于是落到 `createLocalShellOperations` 的兜底 `env ?? getShellEnv()`（`dist/core/tools/bash.js:68`）。**RPC 面唯一的杠杆是 `operations` 包装**（`executeBash(command, onChunk, { operations })` 接受它，`dist/core/agent-session.d.ts:773-777`）。
  - **结论（locality）**：一个**包装过的 `operations`** 同时盖住两个面——它在 `exec` 里剥 env 并转交下层；而 ADR-0012 的沙箱**也落在同一处**（沙箱就是「这个子进程能碰到什么」）。「这个子进程能拿到什么」因此只有一处答案。实施票的纪律：包装必须**总是显式构造 env**，不能写成「上游给了就转交、没给才兜底」——那样 RPC 面会原样转发一个未剥的 env。
  - 另一条 pi 提供的接缝 `user_bash` 扩展事件（返回值可携带 `operations`）在本仓**未被使用**：worksplice 的 `session.ts:746` 直接调 `executeBash`，绕过 `emitUserBash`。实施票仍取「直接传 `operations`」——在那个调用点上 worksplice 是宿主，不是扩展。

### 决策四（`{"type":"bash"}` 那条执行入口由谁把守）

**来源**：ask 回收的 coordinator 追问（「Q1 与 Q4 合并后，这条入口现在同时是成员侧走廊与秘书能力面之外的第三类调用者，必须写清守卫归属」）。

先把「第三类调用者」拆开——`POST /api/agent/[id] {"type":"bash"}` 的调用者在时间轴上有三种：

| 调用者 | 这条请求在做什么 | 守卫归属 |
| --- | --- | --- |
| **人类（浏览器，`!bash`）** | 用自己的权限在自己或某成员的会话里跑命令 | **ADR-0012 实施票**（决策三：沙箱跟随**会话归属的成员**；无归属会话不沙箱）。**不是本票要收的口子** |
| **成员（被注入后的 curl）** | 借 app 的手拿一条裸 shell——**这是级联本身** | **本票的票 3（成员 → 端口的关闭）**，两阶段：沙箱落地前靠 ADR-0012 决策五（无沙箱不激活 bash）⇒ 成员手里没有 HTTP 客户端；落地后靠内核按端口过滤 |
| **成员会话被他人指名**（成员 A 的 curl 打成员 B 的会话） | 同上，只是挑的会话不同 | 同上——B 的会话有归属 ⇒ 沙箱跟着 B；A 的会话有归属 ⇒ 沙箱跟着 A；**人类会话无归属** ⇒ 不沙箱，因此这条请求的守卫**不在它身上**，在「A 能不能到门口」上 |

**结论（写死，实施票按此分工）**：**`{"type":"bash"}` 上不加第二道身份门。**

理由：本机没有能区分「人类 curl」与「成员 curl」的手段（决策一 1.2 三条全塌），因此任何加在这里的门只能加在**凭证**上——而凭证对成员无效。加一道无效的门**比没门更坏**：后来者会以为这条入口已经被守住，于是放松「成员 → 端口」这一层的持续维护。**它靠的是门口没有成员，不是门上有一把锁。**

这条结论的代价要同时写明：在票 3 完成之前，这条入口对成员**是敞开的**——本票**不声称**自己收口了它（残留 #1）。沙箱票也不能声称自己收口了它（ADR-0012 决策六原话：只能自述为「纵深防御的一层」）；**两票合起来才收口**。

### 决策五（排序链的精确表述 + fail-closed 原则的耦合）

**来源**：ADR-0012 决策六的推论（预授权范围内的推论）+ ask 回收的耦合报备项。

ADR-0012 决策六定的链条是「**HTTP 走廊票 → sandbox 实施票 → 至此 bash 收口才成立**」，本票是那条链的第一环。精确化为四条并行处置的**时间轴**：

```text
① env 收口（独立，任何凭证形态的前置；今天唯一秘密是 WORKSPLICE_PASSWORD）
② 成员能力面与协作面整体移出 HTTP（进程内接缝；解锁 ③ 的后半，因为秘书不再需要 curl）
③ 成员 → 本端口 的关闭，两个阶段各有一条支撑、没有空窗：
     沙箱落地前：ADR-0012 决策五（无沙箱不激活 bash）⇒ 成员手里没有 HTTP 客户端
     沙箱落地后：内核按端口过滤（ADR-0012 Further Notes 已实测 (deny network* (remote ip "*:<port>")) 只封指定端口）
④ 人类面：loopback 零配置；非 loopback fail-closed（决策二）
```

**②解锁③的理由**：ADR-0012 的 Further Notes 记了那条端口过滤**可用**但**本形态不使用**，理由只有一条——「app 自己的接口面由 HTTP 票处理，本形态不封端口，**因为秘书的 curl 能力面是锁定条目**」。决策一的 Q4 裁定之后这个理由消失，**端口过滤成为可用形态**。这是本票对 ADR-0012 的唯一后果性影响：不是重开它的六条决策，而是它自己留下的那条保留**因本决策而解除**。ADR-0013 会把这件事记下来（ADR 是追加式的：新 ADR 记录「旧 ADR 的某项保留已解除」，不改旧 ADR 正文）。

**沙箱给不了什么（这一半不能省）**：沙箱层决定不了「谁在问」。它能关掉「成员进程 → 端口」，关不掉「一个已经在飞的本机请求是谁发的」。所以在 ③ 完成之前，决策四那条「调用者自挑会话」的通道仍然存在——这正是沙箱票不能自封收口完成的原因，也是本票排在它前面的原因。

**fail-closed 原则的耦合（必须写下来，免得只改一处）**：「**拿不到安全前提就不提供服务**」这条原则现在被**三处**引用——

| 处 | 形态 | 状态 |
| --- | --- | --- |
| ADR-0011 决策六第三条 | 判定自身出错（根列表为空 / realpath 异常）一律拒绝 | 已合入（票 02） |
| ADR-0012 决策五 | 非 macOS 拿不到沙箱 ⇒ 不激活 bash | **coordinator 代答，仍标「待人类追认」** |
| 本票决策二 | 非 loopback 且无凭证 ⇒ 服务不可用 | 本票定，等待实施 |

**若人类推翻这条原则，三处都要改。** 尤其 ADR-0012 决策五那条仍挂着「待人类追认」——它一旦被推翻，「成员没有 HTTP 客户端」这条不变量的**前半段**同时失效（③ 的沙箱落地前那半），本票的收口会被推迟到沙箱落地之后。本票不替那张票追认，只把耦合关系写明。

### 决策的后果：残留绕过面

**本票的处置落地之后，仍能越界的有**（按严重度排；与 ADR-0011 / 0012 的残留清单重复的只标关系）：

| # | 残留面 | 说明 |
| --- | --- | --- |
| 1 | **③ 完成前的窗口** | 成员侧的走廊依赖「成员手里没有 HTTP 客户端」。它的前半段（沙箱落地前）依赖 ADR-0012 决策五**真的实施**——而那条本身**仍待人类追认**（决策五的耦合表）。在那之前，成员仍有 bash ⇒ 仍有 HTTP 客户端 ⇒ `{"type":"bash"}` 与整个 Owner 权限面（插件安装 / `models.json` / API key 存储）对成员敞开。**本票不声称窗口已关。** |
| 2 | **具备网络能力的扩展 / 包工具** | 「成员没有 HTTP 客户端」假设**成员会话不激活任何能做网络请求的扩展工具**（`withExtensionTools`，`lib/rpc/session.ts:220` 的定义、`:713` 的激活点）。一个第三方工具就是一条新的 HTTP 客户端。ADR-0012 残留 #5 只记账；本票把「成员会话不得激活网络能力工具」**升成一条约束**（Testing Decisions 列了断言），但**不做工具审计**——那是另一张票。 |
| 3 | **同一台机器上用户自己的其它进程** | 决策二的取值：它们与用户的 shell 同权，**不在威胁模型内**（`.github/SECURITY.md` 的界线）。列出来是为了不让后来者把它读成漏网。 |
| 4 | **人类面在 loopback 上没有准入闸** | 决策二的取值：「能连上 loopback 端口 = 人类的权限」这条姿态**有意保留**；`WORKSPLICE_PASSWORD` 是可选的强化，不是默认。 |
| 5 | **同 uid 的进程间手段** | 成员进程与 server 同 uid：`kill`、`ptrace` / 读他人进程内存在内核允许时可达。沙箱的 allow-only profile 是否默认拒绝 `signal` / `mach` 类操作，**ADR-0012 实施票要在 profile 里一并定**；本票只记账（它属「进程能碰到什么资源」，正是沙箱的判据面）。 |
| 6 | **env 之外的秘密通道** | 决策三只处置 env 这一条。人类自己写进项目里的密钥、`.env` 文件、shell 启动脚本里的导出，位置决定其可达性——**不在本票范围**（属 ADR-0012 决策二的「用户级凭证不进清单」，而成员自己项目里的 `.env` 在允许根内、可见）。 |
| 7 | **TOCTOU / 允许根之内的破坏 / 人类自己那一路** | 沿用 ADR-0011 D6 与 ADR-0012 的残留清单，本票不新增也不收窄。 |

---

## Testing Decisions

**本票不跑测试**（决策票，源码改动面为空，决策文档没有被测对象）。以下是**实施票**的测试面，按处置分四组：

- **env 面（决策三）**：
  - 两个 shell 面各一条：工具面（`bash` 工具）与 RPC 面（`session.send({type:"bash"})`）的子进程 env **不含**任何 `WORKSPLICE_*` 形态的键（测试进程里预设一个 `WORKSPLICE_PASSWORD` 与一个 `WORKSPLICE_DATA_DIR`）；
  - **保留断言**：用户自己的环境变量（如 `FOO=bar`）与 pi 故意暴露的 `PI_MODEL` 一类**仍在**；
  - **RPC 面专项**：断言包装在「上游未传 `env`」这条路径上也剥（`executeBashWithOperations` 不传 `env`，所以那是默认路径，不是边角）；
  - **无分支断言**：剥法不依赖「是成员会话」——给一个**无归属**会话也断言已剥（这条同时是 fail-closed 形态的守卫）。
- **请求面 · 人类侧（决策二）**：
  - 非 loopback bind + 无凭证 ⇒ 服务不可用：**两条入口都要测**（`bin/worksplice.js` 的启动路径；以及绕过包装的 `next dev -H 0.0.0.0` 等价路径，判定落在服务进程内）；
  - 非 loopback bind + 有凭证 ⇒ 可用；loopback bind + 无凭证 ⇒ **照常可用**（守住零配置这条既有承诺）；
  - 取证项：`instrumentation.ts` 抛错能否真的阻止 Next 启动——**测不出「启动即拒」就如实记为未达成**，以请求门为准。
- **能力面（决策一 §1.3）**：7 条动作逐条真回放（真 `runAgentRound` + 真 DB），断言 ① 可观察副作用（频道行 / 成员行 / reminder 行 / 消息 target+seq / 搜索结果）；② 错误语义（400 / 409 held 后按 `onConflict` 四选一）；③ **身份**（成员 X 的 op 以 X 的名义落库，且人类专属操作仍被拒）；④ **同等强度**：与旧 curl 回放**逐条对位**（7 条不少），并在测试注释里写明对位关系——这是「不是降级替代」的可验证形式。
- **人类面 HTTP 契约**：把创建类端点的覆盖从**读源码正则断言**补成**真 HTTP 端到端**（`POST /api/channels`、`POST /api/members`、`POST /api/reminders`、`POST /api/messages` 的成功与 409 各一条）。这是决策一点出的真缺口。
- **既有先例**：`node:test` + `node:assert/strict`，测试文件后缀 `.test.mjs`；门禁 `tsc --noEmit` + `npm run lint`（**只报告，不 `--fix`**）+ `node --test`，**绝不 `next build`**。
- **覆盖断言（新约束，来自残留 #2）**：**成员会话不得激活任何具备网络能力的扩展工具**——实施票需要一条断言或一份显式豁免清单；本票不替它决定形态。

---

## Out of Scope

- **不改代码**：本票源码改动面必须为空（若必须改代码才能完成本票，说明票型判错了）。
- **不实施沙箱**（ADR-0012 的实施票）：profile 生成器、平台适配器、两个 shell 面的接线、清单冒烟与负例、边界可见性都在那张票。
- **不做 per-member 凭证**：已否决（决策一），不在实施范围。
- **不做 HITL / 审批流**：沿用票 01 / 02 / 03 的口径——隔离优先、可观测性另议。审批若将来引入，是叠加在自动拒绝之上的一层，不改默认拒绝语义。
- **不改档位构成**：`lib/tool-presets.ts` 不动；不注册成员可见的新工具（决策一 §1.3 的取值）。
- **不做 CSRF / 来源校验的强化**：`lib/request-security.ts` 的浏览器来源校验与 Host 白名单不变（决策一 1.2 已论证浏览器头不是可用的身份手段，改它没有收益）。
- **不做同一台机器上其它进程的隔离**、**不做工具审计**（残留 #2 / #3 只记账与立约束）。
- **不改消息 / 频道 / 唤醒 / 任务语义**。

### 后续实施票要解决什么

本票**不实施**。以下五张票从本票 resolved 之后另开：

| 序 | 票 | 阻塞关系 | 不做会怎样 |
| --- | --- | --- | --- |
| 1 | **env 收口**：包装 `operations`，剥 `WORKSPLICE_*`，盖住 bash 工具面与 `lib/rpc/session.ts:746` 的 RPC 面 | 无阻塞（最小、最独立）；**可与本票并行开工** | `WORKSPLICE_PASSWORD` 今天就在成员的 `env` 里（F4）——只要用户在用它，任何靠秘密的门都是自欺，成员一条 `env` 即归零 |
| 2 | **成员能力面与协作面移出 HTTP**：回复协议加创建类 op + 协作服务层补调用者参数与授权表 + 秘书手册（速查 §3 与系统手册 §2）改写 + 7 条动作回放 | 无阻塞（与票 1 并行）；**阻塞票 3 的「端口过滤」那一半**（秘书不换通道，端口就不能封） | 秘书的 curl 能力面留在这条走廊上 ⇒ 决策一 ② 无法封端口 ⇒ 成员侧的走廊在整个时间轴上都有对象，本票的结论不成立 |
| 3 | **成员 → 端口的关闭**（两阶段）：阶段 A 落 ADR-0012 决策五（无沙箱不激活 bash）；阶段 B 在沙箱 profile 里加按端口过滤 | 阶段 A 归 ADR-0012 的沙箱票；**阶段 A 被人类对「fail-closed 原则」的追认阻塞**（决策五的耦合表）；阶段 B 被票 2 阻塞 | 「成员没有 HTTP 客户端」这条不变量没有支撑 ⇒ 本票的收口是纸面承诺；`{"type":"bash"}` 与整个 Owner 权限面（插件安装 / `models.json` / API key）一直对成员敞开（残留 #1） |
| 4 | **非 loopback fail-closed**：服务进程内的判定 + CLI 包装的启动阻止 + 取证「启动即拒」是否可行 | 无阻塞（小、独立） | `npm run dev:lan` 今天连警告都不打（F1）——一条 `curl` 就把文件、裸 shell 与插件安装借给局域网，而用户看不到任何提示 |
| 5 | **人类面 HTTP 契约的真端到端测试**：创建类端点从「读源码正则断言」补成真 HTTP | 无阻塞；**建议与票 2 同批**（票 2 会让 curl 回放退场，这层覆盖不能跟着一起走） | 决策一点出的真缺口一直敞着：创建类端点的端到端覆盖只存在于秘书手册的回放里，而那张回放要退场 |

明确**不做**：不做 per-member 凭证、不改档位构成、不做工具审计、不做 CSRF 强化、不做 HITL。

---

## Further Notes

### 本机取证记录（2026-10 复核）

| 取证 | 结果 |
| --- | --- |
| `getShellEnv()` 的形态 | `{...process.env}` + PATH 里追加一处 bin 目录（`dist/utils/shell.js:115-126`）——**完整环境变量透传** |
| pi 自己的 env 纪律 | `resolveSpawnContext` 显式删五项 `PI_SESSION_ID` / `PI_SESSION_FILE` / `PI_PROVIDER` / `PI_MODEL` / `PI_REASONING_LEVEL`（`dist/core/tools/bash.js:137-143`）——**这条纪律有既有先例，不是本仓发明的** |
| bash 工具面的 env 接缝 | `BashToolOptions.spawnHook: (context: BashSpawnContext) => BashSpawnContext`，文档串写明「adjust command, cwd, or env」（`dist/core/tools/bash.d.ts`） |
| RPC 面的 env 路径 | `executeBashWithOperations` 调 `operations.exec(command, cwd, { onData, signal })`——**不传 `env`**（`dist/core/bash-executor.js:65`）⇒ 落 `env ?? getShellEnv()`（`dist/core/tools/bash.js:68`）；`executeBash` 第三个参数接受 `operations`（`dist/core/agent-session.d.ts:773-777`） |
| 裸本地实现的落点 | `options?.operations ?? createLocalBashOperations({ shellPath })`（`dist/core/agent-session.js:3037`）；worksplice 的调用点 `lib/rpc/session.ts:746` 不传 `operations` |
| loop 的 prompt 里有没有 HTTP | 没有：`lib/agent-loop/loop.ts` 全文不含 `30142` / `127.0.0.1` / `localhost` / `curl` / `api/` |
| agent-loop 走不走 HTTP | 不走：`docs/spec.md:361`「agent-loop 直接调服务层，不走 HTTP」 |
| spec §5.4 的 act 清单 | 含 `schedule reminder` / `react` / `pin`（`docs/spec.md:334-337`）——**进程内调用，spec 自己写的** |
| `dev:lan` 有没有经过 CLI 包装 | 没有：`package.json:34`/`:39`/`:41`/`:42` 直接起 `next`；`bin/worksplice.js:70-80` 的警告只覆盖 CLI 那条入口 |
| Host 白名单对 IP 字面量 | 放行（`lib/request-security.ts:84`），注释写明理由：「IP literals preserve LAN access but cannot be DNS-rebound」 |
| 档位推断会不会被扩展工具扰动 | 不会：`getPresetFromTools` 先按 `BUILTIN_TOOL_NAMES` 过滤再比对（`lib/tool-presets.ts:65-68`）——决策一 §1.3「工具形态本也可以不漂移」的证据 |
| 人类面路由测试的强度 | `lib/domain/collab/messages-route.test.mjs` 一类是 `readFile` + `assert.match`（**读源码正则**），不是真跑 HTTP——决策一 §1.5 点出的真缺口 |

（URL 走廊本身的取证——`POST /api/agent/[id]` 接受任意命令、进门恒 Owner、非浏览器客户端不做来源校验——已在 ADR-0012 决策六与本文「事实底稿」写明，本票不重查。）

### 与 ADR 的关系

- **建 ADR-0013**：三条件全满足——① **难以逆转**：一旦「成员面整体移出 HTTP、成员不持有任何隐秘、端口是人类面」成为基线，改口径要动协议、手册、服务层授权表与暴露面口径；② **无上下文会惊讶**：后来者会问「为什么有 bash 的成员不配 token」「为什么秘书明明有 API 手册却不许 curl」「为什么 loopback 上不强制密码」「为什么 `{"type":"bash"}` 不加门而是让成员到不了门口」——四条都是刻意的；③ **真实权衡**：强制共享密码 / per-agent token / 分离端口 / 不做凭证四条候选 + 「身份取凭证自述还是结构」这条分岔 + 「env 面与请求面谁前置」这条判断。
- **ADR-0012 的那项保留因本决策解除**（决策五）：旧 ADR 正文不改，新 ADR 记录「它的 Further Notes 说不使用网络过滤、理由是秘书 curl 是锁定条目——该理由因 ADR-0013 决策一而消失」。
- **不重开**：ADR-0012 的六条决策、ADR-0011 的注入点与允许根构成、ADR-0001 的家目录两分、ADR-0007 的「同一事实不写两处」、ADR-0008 的分层方向全部沿用。本票只在 ADR-0012 决策六授权的范围内取值（那张票自己写着「正确形态是给内部调用者受控凭证或专用通道——这是那张票的决策」）。
- **`.github/SECURITY.md`** 是既有暴露面口径，本票与它对齐：新增的 `dev:lan` fail-closed 与「成员不持有凭证」应当在该文「Exposure and hardening」一节补记（本票不改该文——它属治理文档，且本票只交付决策）。

### 术语

新增四条入 `CONTEXT.md` 的 `## Language`：**准入闸 (Access Gate)**、**调用者身份 (Caller Identity)**（内含**结构身份**这一形态）、**人类面 / 成员面 (Human Face / Member Face)**。与既有词条的关系：**沙箱**是判定「进程能碰到什么」的那一层（ADR-0012），本票不动它；**路径守卫**管文件调用，本票不动它；本票新开的是「一次调用以谁的名义执行、以及哪些通道对它开放」这一层。
