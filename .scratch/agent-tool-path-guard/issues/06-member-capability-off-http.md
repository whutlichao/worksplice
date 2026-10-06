# 06-成员能力面与协作面移出 HTTP（+ 人类面非 loopback fail-closed）

Type: task
Status: resolved
Blocked by: 04

Spec: `.scratch/agent-tool-path-guard/spec.md`
设计: `docs/http-corridor-caller-identity.md`
ADR: `docs/adr/0013-http-corridor-caller-identity.md`（决策一、二、四、五）
前置票: 04（设计票 resolved，PR #96）；02（路径守卫，ADR-0011 已合入）

## What to build

实施 ADR-0013 的四条决策：

- **决策一（本票主体）**：app 的协作面整体不再经 HTTP 暴露给成员侧。① 在 loop 的结构化回复协议
  （`parseAgentAction`，今天已承载 `claim` / `complete` / `unclaim`）上新增三条 op：
  `schedule reminder` / `react` / `pin`——`docs/spec.md` §5.4 的 act 清单本来就写了这三条，
  实现没跟上；② 身份取**结构身份**（`runAgentRound` 握有 agent，调用点天然知道它代表谁），
  不经请求头自述；③ **不注册新工具**——`lib/tool-presets.ts` 全程不动。
  **授权范围**：op 对全部成员同等开放（不做秘书豁免），能否执行由协作服务层按调用者身份裁决，
  判据是「默认拒绝、逐条开口，开口的是不提升调用者权限、只扩大协作面的动作」；人类专属操作
  （归档 / 删除身份 / 三种 reset / 改 runtime / 改 workspace）不开。
- **决策二**：人类面准入——loopback 零配置照旧；**非 loopback bind + 无凭证 ⇒ 服务不可用**
  （fail-closed）。判定必须落在**服务进程内**（`proxy.ts` / `instrumentation.ts` 一类位置），
  因为四条 npm 脚本直接起 `next`，绕过 `bin/worksplice.js`；CLI 包装另加第一道明确报错。
  **取证项**：`instrumentation.ts` 抛错能否真的阻止 Next 启动——测不出就如实记为未达成，
  以请求门为准，不要假装它生效。
- **决策四**：`{"type":"bash"}` 那条入口**不加第二道身份门**（本机没有区分「人类 curl」与
  「成员 curl」的手段，加一道无效的门比没门更坏）——本票不改它，也不声称收口了它。
- **决策五**：ADR-0012 的 Further Notes 里「按端口过滤可用但本形态不使用」那条保留的理由
  （「秘书的 curl 能力面是锁定条目」）因票 04 的 Q4 裁定消失，端口过滤成为可用形态——
  本票负责启用它，与票 05 的内核沙箱衔接（沙箱落地前靠 ADR-0012 决策五，落地后靠内核按端口过滤；
  两阶段各有一条支撑、中间无空窗）。**本票只交「保留解除 + 前提 + 交接契约」（Q3 裁定）**：
  秘书不再依赖 curl 的证据 + 内核规则形态与端口来源的可独立阅读交接（见 Answer），内核规则由票 05 落进它的 profile。

秘书原有的 7 条能力与旧 curl 速查保持不变（read 类每轮语境里本来就有；创建类由新增 op 承接）。

## Acceptance criteria

- [x] 协议纯函数层：三条 op 的解析（形状 / 缺字段 / 未知 op 名）；授权裁决的默认拒绝与逐条开口。
- [x] 集成层（真 `runAgentRound` + 真 DB + fake session/runtime）：成员经 op 成功调用的 3 条能力
      （react / pin / 设提醒），副作用可观察（reaction 行 / pinned 行 / reminder 行）；另加 7 条能力 1:1 的其余 op。
- [x] 越权调用被拒：成员身份调用人类专属操作（归档 / reset / 改 runtime）被拒（反向断言）。
- [x] 身份取结构身份：成员 X 的 op 以 X 的名义落库（不是 Owner）。
- [x] `lib/tool-presets.ts` 零 diff（`git diff --stat` 不出现该文件）。
- [x] 非 loopback + 无凭证 ⇒ 服务不可用；非 loopback + 有凭证 ⇒ 可用；loopback + 无凭证 ⇒ 零配置可用。
- [x] `instrumentation.ts` 能否阻止启动的取证结果如实写进 Answer（实测：`process.exit(1)` 能阻止）。
- [x] 红绿证据落 `.scratch/agent-tool-path-guard/evidence/`。
- [x] 全量 `npm test` 输出落 Answer（1013/1013）；`tsc --noEmit` 零错误；lint 只报告不修；未跑 `next build`。
- [x] 双轴 code-review（Standards + Spec）报告落 Answer（两轮：初评 + 处置后复核）。
- [x] 机械判据：`git status --porcelain` 空、`git diff --numstat` 无四位数源码单文件、分支有 OPEN 的 PR。

## Notes

- 本票**不声称 bash 收口完成**：在票 05 落地前 `{"type":"bash"}` 与 Owner 权限面对成员仍敞开
  （ADR-0013 残留 #1）；Answer 里要写清这个依赖。
- 不改 `lib/tool-presets.ts` 的档位定义；不做 HITL / 审批流；消息不可变（新建类 op 若落消息，
  走既有 `sendMessage` 不变量）。
- 提问通道 `orchestration ask`；预授权代答项见 dispatch spec（取证方法 / 模块划分 / op 命名与字段形状 /
  从 ADR 推出的结论 / 端口过滤实现方式）。

## Answer

### 交付物

| 文件 | 说明 |
| --- | --- |
| `lib/domain/collab/member-capabilities.ts`（+`.test.mjs`） | 成员能力表：默认拒绝、逐条开口，人类专属操作不开（纯函数） |
| `lib/agent-loop/member-ops.ts`（+`.test.mjs`） | op 协议：解析 / 校验 / 裁决（纯函数）+ 执行（以结构身份落库） |
| `lib/agent-loop/loop.ts`（+`loop.test.mjs`、新 `loop-ops.test.mjs`） | `parseAgentAction` 承载 `ops`；每轮语境注入（频道/成员/默认模型）；观察相；op 结果并入本轮 reason |
| `lib/access-gate.ts`（+`.test.mjs`）、`proxy.ts`、`instrumentation.ts`、`bin/worksplice.js` | 人类面准入闸：非 loopback + 无凭证 ⇒ 服务不可用（进程内 + 请求门 + CLI 第一道） |
| `lib/domain/collab/search.ts`（+`search.test.mjs`） | `search` 的调用者作用域（只返回成员所在频道的命中） |
| `assets/secretary/MEMORY.md`、`SYSTEM-GUIDE.md` | 两本手册改写为回复动作（删 base URL / 密码 / curl） |
| `.github/SECURITY.md`、`docs/spec-bootstrap-agent.md`、`CONTEXT.md` | 暴露面口径 / 秘书 spec / 新术语（回复动作、观察相）同步 |
| `.scratch/agent-tool-path-guard/issues/06-…md` + `evidence/` | 本票据正本与红绿/取证记录 |
| 本文件 | Status 走 claimed → resolved |

### outcome

ADR-0013 决策一/二/四/五落地：成员的系统能力从 HTTP 移到 loop 的结构化回复协议（七条能力 1:1，见下表），身份取**结构身份**、权限由**成员能力表**裁决（默认拒绝、逐条开口；人类专属不开），`lib/tool-presets.ts` 零 diff；人类面非 loopback + 无凭证时**服务不可用**（启动即拒 + 请求门 503，实测取证见 `evidence/access-gate.txt`）。

### 能力对照表（ADR §1.5 的 7 条 1:1 核对；coordinator 追加裁定 Q1：指不出注入点的就是 op）

| # | 能力（7 条速查行） | 落点 | 可指认的注入点 / 实证 |
| --- | --- | --- | --- |
| 1 | 频道列表 | **每轮语境** | `buildReplyPrompt` 的 `Workspace channels: #name (type, seq N, not joined?, archived?)` 行（`replyPromptContext()` 组装；**只含公开频道 + 已加入的频道**，未加入的私有频道连名字都不注入）；`loop.test.mjs` 新断言 |
| 2 | 成员列表 | **每轮语境** | `Workspace members: @Name (human/agent)` 行（同上） |
| 3 | 发消息 | op `reply`（既有）+ op `post`（跨 target 指针，ADR §1.3 点名） | `loop-ops.test.mjs` 的 post 用例（含 held 不落库） |
| 4 | 建频道 | op `createChannel` | `loop-ops.test.mjs`（创建者自动入成员） |
| 5 | 建 agent | op `createAgent`（省略 provider/modelId 用默认模型） | 默认模型 = 语境里的 `Default model for new agents:` 行；用例含默认模型 seam |
| 6 | 搜索 | op `search`（**作用域 = 调用者所在频道**） | `loop-ops.test.mjs`（观察相命中 + 非成员频道不可见）、`search.test.mjs` 作用域用例 |
| 7 | 设提醒 | op `remind`（`inMinutes` 相对时间或 ISO `fireAt`；recurrence DSL） | `loop-ops.test.mjs`（author = 成员，target 名 → id） |
| + | `react` / `pin`（spec §5.4 act 清单） | ops | `loop-ops.test.mjs`（以成员自己身份落库，非 Owner） |
| + | 频道消息 / 任务板（spec §3.1 的其余只读项） | 每轮语境 | 唤醒它的 `#seq @author:` 消息行 + `Related open tasks:` 行 |

### 协议与裁决（决策一）

- **协议**：`{"action":…,"content":…,"onConflict":…,"task":{…},"ops":[{"op":…}]}`——`ops` 与既有 `task` 同一条缝；`react` / `pin` / `remind` / `post` / `createChannel` / `createAgent` / `search` 七种 op；空 `ops` 不落字段（老协议形状一字不变，既有 deepEqual 断言不破）。
- **默认拒绝**：能力表（`member-capabilities.ts`）对未知名字拒绝；人类专属操作（`archiveChannel`/`unarchiveChannel`/`deleteIdentity`/`restart`/`sessionReset`/`fullReset`/`setRuntime`/`setWorkspace`）对成员拒绝——反向断言：`{"op":"deleteIdentity"}` 等三个 op 跑过一轮后身份还在、频道未归档（`loop-ops.test.mjs`）。
- **身份取结构身份**：执行点握有 `agent`，reaction 的 `member_id`、pinned 的 `member_id`、reminder 的 `author_id`、post 的 `author_id` 都是该成员（用例逐条断言，含「不得以 Owner 身份落库」）。
- **不注册新工具**：`lib/tool-presets.ts` 零 diff（`git diff --numstat` 不含该文件）。
- **`search` 的作用域是判决性的**：成员经搜索看不到它没加入的频道（`searchMessages(query, {memberId})`）；这不是既有行为——它正是「不提升调用者权限」这条判据的落地（秘书因自动加入全部频道而保有全量覆盖）。
- **观察相**（新术语，入 `CONTEXT.md`）：`search` 的命中在**同一轮**用一条后续 prompt 交回模型，同轮声明的其它 op 留到那之后执行（避免 react 这类 toggle 被落两次、避免模型在没看到结果时就写死回复）；一轮最多一次。
- **失败与拒绝可见**：op 结果（applied / denied / held / error / deferred）并入本轮 `outcome.reason`（进 round_logs 与可观测页），不静默吞掉。

### 决策二的取证（人类面准入闸）

- 判定点两处：**服务进程内**（`instrumentation.ts` 启动即拒 + `proxy.ts` 503）与 CLI 包装第一道（`bin/worksplice.js` 拒绝启动）——决定性理由是四条 npm 脚本直接起 `next`、绕过包装。
- **实测（`evidence/access-gate.txt`）**：`instrumentation.ts` 里 `process.exit(1)` **能阻止服务**（进程退出、端口不可达 → 启动即拒 **达成**）；启动门被绕过时请求门仍 fail-closed（`/api/sessions` 与 `/` 均 503，**伪造 `Host: localhost` 同样 503**——判定基于实际 bind 的自连接探针，不是调用者可伪造的头）；loopback + 无凭证 → 200（零配置承诺保住）；非 loopback + 有凭证 → 401/200（Basic Auth 语义不变）；`node bin/worksplice.js -H 0.0.0.0` → exit 1。
- 判定细节：`unknown`（端口未知 / 探针不可判定）**不**关服务（保住零配置），只有确认 `non-loopback` 且无凭证才 `closed`；这条边界写在代码注释与 SECURITY.md 里。

### 决策四（`{"type":"bash"}` 不加第二道身份门）

本票**没改** `app/api/agent/[id]/route.ts` 一行——按 ADR-0013 决策四，那里加门只能加在凭证上，而凭证对成员无效；「加一道无效的门比没门更坏」。它靠的是「门口没有成员」，那一层由票 05（沙箱两阶段）负责。

### 决策五交接契约（可独立阅读——给票 05 的内核端口过滤）

**本票交付的前提（票 05 不必再证）**：秘书与普通成员**不再需要 HTTP**——七条能力已全部落在回复动作上（本 Answer 的能力对照表），两本手册里 `http://` / `-u pi:` / `curl` 命中数为 **0**（`grep -cE "http://|https://|-u pi:|curl" assets/secretary/*` → 0/0）。ADR-0012 Further Notes 里「按端口过滤可用但本形态不使用」的唯一理由（秘书的 curl 是锁定条目）因此消失。

**票 05 需要落进 profile 的东西**：

1. **规则形态**（macOS Seatbelt，ADR-0012 Further Notes 已实测量到的形式）：`(deny network* (remote ip "*:<port>"))`——只封指定端口，其余网络面不动。
2. **要封的端口**：app 自己的监听端口。取值来源与 app 同源：`process.env.PORT`（Next 在 listening 事件里写，`start-server.js:296`）→ 回退 `bin/worksplice-options.js` 的默认 `30142`（`-p` / `PORT` 覆盖）。**profile 生成时若拿不到 PORT，按 fail-closed 处理**（拿不到安全前提就不激活 bash，与 ADR-0012 决策五同构）。
3. **落点**：包 `operations` 的那一处（ADR-0012 决策三与 ADR-0013 决策三的同一接缝）——两个 shell 面（bash 工具面的 `spawnHook`、RPC 面的 `operations` 包装）都从那里出；端口过滤与 env 剥法、路径沙箱**同一处答案**。
4. **两阶段**：阶段 A（无沙箱 ⇒ 不激活 bash）本身就让「成员手里没有 HTTP 客户端」成立；阶段 B（本规则）让 bash 激活后仍够不到本端口。**本票不写 profile**（避免与并行 worktree 撞同一文件），只交出规则形态与端口来源。
5. **非 macOS 等价形态（本机只测 macOS，如实标注未验）**：Linux 的等价物是 **network namespace**（`unshare -n` + 按需回环）或 nftables/iptables 按 uid/cgroup 过滤目标端口；Windows 无等价形态前维持「无沙箱不激活 bash」。ADR-0012 决策五已把非 macOS 平台定成 fail-closed，所以这三条是「将来做 Linux 沙箱时的形态」，不是本票承诺。

#### 第二轮（处置后复核，`0cfb323`）

##### Standards

```text
## Review（Standards 第二轮，只读）

第一轮 findings 逐条处置：① fixed（resolveTargetRef 落服务层，本地实现已删）② fixed（assertActorMayPerform 接入 channels.ts，human 分支进生产）③ fixed（searchPerformed 已删）④ fixed（default 理由区分「不是 ops 条目」）⑤ fixed（CONTEXT.md 按 deferred + 重申改写）⑥ fixed（remind 默认本轮 target + fireReminder 真投递用例）⑦ fixed（pin 按消息自身 channel + 跨频道用例）⑧ partially（先取 MAX_SEARCH_LIMIT 再切；>50 条不可见命中仍可少返——残留 #4 已记，可接受）⑨ fixed（部分）（archive/unarchive 接表；其余六项结构性不可达，残留 #6 写明）⑩ partially（启动门护栏已加；票据 Status 未翻→末轮收口）

本轮新发现：
- P2（判断）Speculative Generality：member-ops 的 channel 字段修复 ⑦ 后成死字段 → 已删
- P2（硬，文档计数）member-capabilities 头注释说「开口的八条」而表有 9 项，且名字含非 op → 已改为从 OPS_ARRAY_NAMES + PROTOCOL_FIELD_NAMES 派生，注释按实数重写
- P2（判断）Repeated Switches + Shotgun Surgery：新增 op 要四处同改，表/switch 分歧仅靠测试兜 → 已用类型并集 + switch default 的 never 兜底（漏写 case 编译失败）

Correct：tool-presets.ts 零 diff；未静态 import lib/rpc；中文注释/英文内容层分层无新违规；route 仍薄封装。

Merge verdict：OK with notes（无硬阻塞）。
```

##### Spec

```text
## Review（Spec 轴，第二轮）

(a) 第一轮处置：①–⑤ fixed；⑥ fixed（缺省本轮 targetId，断言 fireReminder 真投递）⑦ fixed（按消息自身 channel + 用例）⑧ 部分（先取 MAX_SEARCH_LIMIT 再过滤，>50 时仍会挤压——残留 #4 已记）⑨ 部分（只接 archive/unarchive；其余四项结构性不可达）⑩ not fixed（HEAD 仍 Status: claimed、AC 未勾、无 PR 号）——末轮收口 ⑪ fixed（waitForServerListening + detectBindScope 回环复核）

(b) 要求但缺失/半做（P2）：
1. 设计文档 Testing Decisions 的「成员会话不得激活网络能力工具——需断言或显式豁免清单」未交付 → 已交：断言（tool-presets.test.mjs 钉住内置面 + bash 为唯一网络能力内置工具）+ 显式豁免清单（残留 #8）
2. 「建 agent 前 GET /api/models 现选现报」被换为只读默认模型，能力收窄未标 → 已在 spec-bootstrap-agent.md §3.1 标注「能力收窄（如实标注）」
3. 决策五票据正文仍写「本票负责启用它」→ 票据 What to build 已注明 Q3 裁定（只交保留解除 + 前提 + 交接）
4. docs/spec.md §5.4 act 清单未补四条 op → 已在 §5.4 加注（ADR-0013 决策一 + 7 条 1:1 裁定）

(c) Scope creep：resolveTargetRef 让 sendMessage 也接受频道名 → 已在残留 #9 如实记录（授权语义未变，为避两处规则故意共用）

(d) 可疑实现：replyPromptContext 把全部频道（含未加入私有频道名/类型）注入每个成员，与「读类不提升可见面」矛盾 → 已修（只列公开 + 已加入）+ 新增断言；instrumentation.ts 读到三种中间态（并发取证实验）→ 已复核为实验残留，终态干净（残留 #10）

Merge verdict：OK with notes（唯一 P1：机械判据末轮收口）。
```

#### 第二轮 findings 处置

| # | 轴 / 级别 | finding | 处置 |
| --- | --- | --- | --- |
| 12 | Standards P2 | `member-ops` 的 `channel` 成死字段（pin 修复的遗留） | **fixed**：字段与 import 均已删 |
| 13 | Standards P2（硬，文档计数） | 头注释「开口的八条」与实际 9 项不符；名字含非 op | **fixed**：表改为从 `OPS_ARRAY_NAMES` + `PROTOCOL_FIELD_NAMES` 派生（不再手抄），注释按实数重写；新增补充类型约束 |
| 14 | Standards P2 | 新增 op 四处同改、表/switch 分歧靠测试兜 | **fixed**：switch 以类型并集为判别对象，default 用 `never` 兜底——漏写 case 编译失败 |
| 15 | **Spec P2（真漏洞）** | `replyPromptContext` 注入全部频道（含未加入私有频道的名/类型），与「读类不提升可见面」矛盾 | **fixed**：只列公开频道 + 已加入的频道；新增断言（私有未加入频道不进语境） |
| 16 | Spec P2 | 「网络能力工具」的断言/豁免清单未交付 | **fixed**：断言落 `tool-presets.test.mjs`（内置面钉子 + bash 唯一网络能力内置工具）；豁免清单落残留 #8 |
| 17 | Spec P2 | 建 agent 的能力收窄未标注 | **fixed**：spec-bootstrap-agent §3.1 加「能力收窄（如实标注）」 |
| 18 | Spec P2 | 决策五票据正文与 Q3 裁定不一致 | **fixed**：票据 What to build 注明交付边界 |
| 19 | Spec P2 | `docs/spec.md §5.4` act 清单未同步 | **fixed**：§5.4 加注（ADR-0013 + 7 条 1:1 裁定） |
| 20 | Spec note | `sendMessage` 顺带接受频道名（input 面放宽） | **记录**：残留 #9（授权语义未变；为免两处「不可嵌套」规则择共用） |
| 21 | Spec P1（机械判据） | Status / AC / PR 号未收口 | **fixed**：Status `resolved`、AC 全勾、PR 号回填于本次收口提交 |

### 测试数字（宽档 = 全量）

- 基线：`npm test` **970/970 通过**（9.8s）。交付时：**1013/1013 通过**（本次 +43：能力表 7、op 解析 6、op 集成 12、准入闸 11、prompt 语境 3、搜索作用域 2、工具面钉子 1、其余随轮次并计）。
- `tsc --noEmit`：**0 错误**。`npm run lint`：**0 error**（仅 1 条既有 warning：`hooks/useI18n.tsx:61`，与本 diff 无关；**未跑任何 `--fix`**）。
- 全量输出：`evidence/full-suite-ops.txt`；红绿证据：`evidence/red-member-capabilities.txt`、`red-member-ops.txt`、`red-loop-ops.txt` → `evidence/green-member-ops.txt`；准入闸取证：`evidence/access-gate.txt`。

### 残留与依赖（本票不声称 bash 收口完成）

1. **票 05 落地前，`{"type":"bash"}` 与整个 Owner 权限面对成员仍敞开**（ADR-0013 残留 #1）：成员仍有 bash ⇒ 仍有 HTTP 客户端；本票只把「成员**需要** HTTP」这件事消灭掉（决策五的前提），端口过滤与「无沙箱不激活 bash」都在票 05。两票合起来才收口。
2. **本票不声称收口了 `{"type":"bash"}` 入口**，也不给它加门（决策四）。
3. **具备网络能力的扩展 / 包工具**（ADR-0013 残留 #2）只记账，不做工具审计。
4. **`search` 的结果条数上限**沿用既有 `MAX_SEARCH_LIMIT`（50）、`limit` 默认 20；`ops` 每轮封顶 8 条（防一条回复无限扇出）。有作用域时先取 50 条再过滤切片——非成员命中 >50 条时成员仍可能少拿几条（**宁少不泄**，见 `search.ts` 注释）。
5. **准入闸的诚实降级**：`unknown`（端口未知，或本机防火墙连自连都拦）⇒ 不关服务（保住零配置）；`non-loopback` 且无凭证才是 `closed`。另：启动门需要「服务真的在 listening」才判定（`waitForServerListening` + `detectBindScope` 的 loopback 复核），因此本机防火墙拦掉回环自连时启动门也只记 warn、交给请求门。
6. **人类专属操作的授权面：结构性不可达 + 表接一半**（review finding #9 的处置）：`archiveChannel` / `unarchiveChannel` 已走能力表（`setChannelArchived` → `assertActorMayPerform`）；删除身份 / Restart / Session reset / Full reset / 改 runtime / 改 workspace 的服务函数**没有调用者参数面**（它们是人类面生命周期函数，参数只有 agentId），而成员面 op 词表里根本没有这些名字 ⇒ 成员到不了那里（默认拒绝在协议层）。不为凑覆盖面给生命周期函数加演员参数（那会把「人类面恒 Owner」的门面弄浑）。
7. **人类面 HTTP 契约的真端到端测试**（设计文档票 5，本票未含）仍敞着——本票把秘书的 curl 回放退场，那层覆盖的正确归处是那张票。
8. **残留 #2 的显式豁免清单（设计文档要的落地形态：一条断言 + 一份清单）**：
   - 断言落 `lib/tool-presets.test.mjs`：内置工具面被钉住（`read/bash/edit/write/grep/find/ls`），**唯一具备网络能力的内置工具是 bash**；新增内置工具会让该测试失败，逼一次显式判断。
   - 豁免清单：① **bash** —— 网络能力归票 05 的沙箱两阶段（阶段 A 无沙箱不激活 bash；阶段 B 内核按端口过滤），本票不动；② **扩展 / 包提供的工具** —— 本仓没有「扩展工具声明网络能力」这一层（`lib/rpc/session.ts` 的 `withExtensionTools` 只看名字），因此**显式豁免、不做工具审计**（ADR-0013 残留 #2）；审计需要上游能力声明，属另一张票。
9. **一次有意放宽（审阅已点名，如实记录）**：共用 `resolveTargetRef` 后，`sendMessage` 的 `targetId` 也接受**频道名**（`#name`）——这是成员面句柄的直接后果（同一处不可嵌套规则优先于输入面收窄）；授权语义未变（仍要求成员资格与未归档），路由面传 id 的路径行为不变。
10. **交付取证期间工作区有过临时改动**（启动门旁路实验的 `[evidence2]/[evidence3]` 标记）：三处实验均当场从备份恢复并 `grep` 复核（终态 0 命中）；评审者读到的中间态不是交付态（最终提交里无这些标记）。

### Review

**评审方式**：`/code-review` 双轴（Standards + Spec），两个独立 reviewer 子代理并行，固定点 = 分支点 `8a05a6d`（`git diff main...HEAD`）。
**两轮**：第一轮审 `4d381b4`；findings 处置后第二轮（`0cfb323`）重跑并逐条复核处置。

#### 第一轮 · Standards

```text
## Review

**Correct**：agent-loop 未静态 import `lib/rpc`（`member-ops.ts:18-34` 只经 `../domain/collab/index.ts` + data 层，与 `loop.ts:3` 既有形态一致）；新测试全为 `node:test` + `.test.mjs`；中文注释、英文内容层分层（`access-gate.ts` 的 503 正文、prompt 文本英文；注释中文）符合 `docs/i18n.md`；`CONTEXT.md` 新增「回复动作/观察相」用词与 `_Avoid_` 清单无违例；`getDb` 直引沿用仓库既有语言，不算新违例。

**Finding（硬违规，P2）** Duplicated Code + 违反 AGENTS.md「服务层 = 唯一事实来源…thread 不可嵌套都在服务层强制」。`lib/agent-loop/member-ops.ts:345-360` 的 `resolveTargetId` 自建 target 解析，并第二次实现「不可嵌套」规则（`Cannot post into a nested thread`）；该规则的文档归属是写侧 `messages.ts:63-71`（`Threads cannot be nested`），`channels.ts:251-254` 亦明写「写侧（messages.resolveTarget）在此之上加严格校验」。同一规则两处措辞、两处实现（Divergent Change）。最小修：把 target 解析开成服务层导出（`resolveChannelForTarget` 已在索引面），`sendMessage` 的拒绝理由直传。

**Finding（判断题，P2）Speculative Generality + 注释失实**：`member-capabilities.ts:121` 的 `assertMemberMayPerform` / `MemberOperationDeniedError` / `actorType="human"` 分支无任何生产调用者（grep：仅本文件 + 测试）；行 120 注释称「协议执行器与人类专属服务层共用同一个裁决」——执行器实际直调 `canMemberPerform`（`member-ops.ts:280`），HTTP 人类专属路由也不查本表。修：让人类专属路由走 `assertMemberMayPerform`，或删该分支/断言并改正注释。

**Finding（判断题，P2）Speculative Generality**：`MemberOpsOutcome.searchPerformed`（`member-ops.ts:303,454`）只被赋值、无消费方（`applyMemberOps` 只用 `observation`）。删字段或让调用方据此决策。

**Finding（判断题，P2）边界报告与表自相矛盾**：`MEMBER_OPEN_OPS` 列 `reply`/`task` 为成员开口（`member-capabilities.ts:52-62`，测试断言 `open.has("reply")`），但 `planForOp`（`member-ops.ts:279-286`）无对应 case，落到 default 报 `"reply" is not a member op — default deny`——对刚判为开口的名字给出相反理由，违背 ADR-0011 D7「报边界」的准确性。最小修：default 文本区分为「协议字段非 op」。

**Finding（判断题，P2）术语与实现错位**：`CONTEXT.md`/ADR-0013 观察相称「同轮声明的其它 op 留到这一步之后执行」，实现是标 `deferred` 并要求模型重申，否则永不执行（`member-ops.ts:414-421`、`loop.ts` 观察相 prompt）。若为有意，改术语文本；否则观察相后自动执行一次。

**Merge verdict：OK with notes**（无硬阻塞；建议 P2 项随手修）。
```

#### 第一轮 · Spec

```text
## Review

**逐条核对结论**：ADR 决策一/二/四/五与票据 AC 大体落地。**Correct**：能力表默认拒绝+逐条开口（`member-capabilities.ts`）、结构身份（`loop-ops.test.mjs` 断言 `reaction.member_id`/`pinned.member_id`/`reminder.author_id`/`post.author_id` = agent.id，并含「不得以 Owner 落库」反向断言）、Q1 的 7 条 1:1（前两条走 `replyPromptContext` 注入点，其余五条 op，`loop.test.mjs` 逐条断言 prompt 教学行）、`tool-presets.ts` 零 diff、决策四未改 bash 入口、准入闸三姿态+启动/请求/CLI 三段取证（`evidence/access-gate.txt`）、红绿证据齐全、Q2 达成（两本手册 `http://`/`-u pi:`/`curl` 命中 0/0）。**Scope creep：无**。

**Finding（P1）**：`remind` op 允许缺 `targetId`，而 `fireReminder` 只在 `reminder.target_id` 存在时投递/唤醒——照文档示例做的提醒**永不投递、永不唤醒作者**，与 spec §3.9 及 SYSTEM-GUIDE §1.3 直接矛盾。最小修：缺 `targetId` 时默认本轮 target（或拒绍）。

**Finding（P2）**：`pin` 用本轮 `channel.id`，跨频道 pin 必被 `pinned.ts:45` 拒为 error；`react` 由 `toggleReaction` 自解析归属，两者不一致。

**Finding（P2）**：`search` 作用域在 DB `LIMIT` 之后过滤 → 成员可能拿不满 limit 内的应得命中（少返，不泄漏）。

**Finding（P2）**：`assertMemberMayPerform` 生产零调用；ADR §1.3 点名的「服务层补调用者参数+授权表」只对 `search` 落地。

**Finding（P2，机械判据）**：AC #11 未闭环（Answer/Status 未进 commit、evidence 有四位数文件）——末轮收口。

**Note**：启动门依赖 PORT 已由 Next 在 listening 事件里写入；「端口已知而尚未 listening ⇒ 探针全 refused ⇒ memo 成 open」的退化路径无护栏（建议写进残留）。
```

#### findings 处置（第一轮 → `0cfb323`）

| # | 轴 / 级别 | finding | 处置 |
| --- | --- | --- | --- |
| 1 | Standards P2（硬） | `member-ops.ts` 自建 target 解析 + 第二份「不可嵌套」规则 | **fixed**：`messages.ts` 导出 `resolveTargetRef`（含不可嵌套），`resolveTarget` 与成员面 op 共用一处；删掉本地 `resolveTargetId` |
| 2 | Standards P2 | `assertMemberMayPerform` 零生产调用 + 注释失实 | **fixed**：新增 `assertActorMayPerform(op, actorId)`（Owner = human，其余 = agent），`setChannelArchived` 接表；注释改为实际调用面 |
| 3 | Standards P2 | `MemberOpsOutcome.searchPerformed` 无消费方 | **fixed**：删字段 |
| 4 | Standards P2 | `ops` 里的 `reply`/`task` 被表判开口却被报 default deny | **fixed**：default 理由改为「不是 ops 条目，是本轮自己的字段」 |
| 5 | Standards P2 | 观察相术语说「留到这一步之后执行」与实现（deferred + 重申）不符 | **fixed**：`CONTEXT.md` 按实现改写（先不执行、标 deferred、由模型重申） |
| 6 | **Spec P1** | `remind` 缺 `targetId` ⇒ 永不投递/不唤醒 | **fixed**：缺省默认本轮 target；新增「默认 target 且 `fireReminder` 真投递」用例 |
| 7 | Spec P2 | `pin` 用本轮 channel ⇒ 跨频道误拒 | **fixed**：按消息自己的 channel（thread 经锚点归一化）落库；新增跨频道 pin 用例 |
| 8 | Spec P2 | `search` 作用域在 LIMIT 后过滤 ⇒ 配额被挤 | **fixed**：有作用域时先取到既有上限（MAX_SEARCH_LIMIT）再过滤切片；新增「不可见命中不得挤掉配额」用例 |
| 9 | Spec P2 | 授权表未接生产（只 `search` 落地） | **fixed（部分）**：#2 把人类专属的 `archiveChannel/unarchiveChannel` 接表；其余四项（删除身份 / 三种 reset / runtime / workspace）的不可达是**结构性的**（op 词表里没有这些名字，默认拒绍；服务函数无调用者参数面），在 Answer「残留与依赖」里写明——不为凑覆盖面给它们加演员参数 |
| 10 | Spec P2（机械判据） | Answer / Status / 四位数 evidence 文件未收口 | **fixed**：evidence 只存汇总（10 行）；Answer 与 Status 随末次提交收口；PR 号回填 |
| 11 | Spec note | 启动门「端口已知未 listening」退化路径无护栏 | **fixed**：`detectBindScope` 用 loopback 自连复核「全 refused」；`waitForServerListening` 让启动门先等到真 listening 再判（新增两条用例）；残留里仍记「防火墙连自连都拦 ⇒ unknown ⇒ open」这条诚实降级 |
