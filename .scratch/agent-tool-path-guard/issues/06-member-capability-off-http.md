# 06-成员能力面与协作面移出 HTTP（+ 人类面非 loopback fail-closed）

Type: task
Status: claimed
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
  两阶段各有一条支撑、中间无空窗）。

秘书原有的 7 条能力与旧 curl 速查保持不变（read 类每轮语境里本来就有；创建类由新增 op 承接）。

## Acceptance criteria

- [ ] 协议纯函数层：三条 op 的解析（形状 / 缺字段 / 未知 op 名）；授权裁决的默认拒绝与逐条开口。
- [ ] 集成层（真 `runAgentRound` + 真 DB + fake session/runtime）：成员经 op 成功调用的 3 条能力
      （react / pin / 设提醒），副作用可观察（reaction 行 / pinned 行 / reminder 行）。
- [ ] 越权调用被拒：成员身份调用人类专属操作（归档 / reset / 改 runtime）被拒（反向断言）。
- [ ] 身份取结构身份：成员 X 的 op 以 X 的名义落库（不是 Owner）。
- [ ] `lib/tool-presets.ts` 零 diff（`git diff --stat` 不出现该文件）。
- [ ] 非 loopback + 无凭证 ⇒ 服务不可用；非 loopback + 有凭证 ⇒ 可用；loopback + 无凭证 ⇒ 零配置可用。
- [ ] `instrumentation.ts` 能否阻止启动的取证结果如实写进 Answer。
- [ ] 红绿证据落 `.scratch/agent-tool-path-guard/evidence/`。
- [ ] 全量 `npm test` 输出落 Answer；`tsc --noEmit` 零错误；lint 只报告不修；绝不 `next build`。
- [ ] 双轴 code-review（Standards + Spec）报告落 Answer。
- [ ] 机械判据：`git status --porcelain` 空、`git diff --numstat` 无四位数单文件、分支有 OPEN 的 PR。

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
| 1 | 频道列表 | **每轮语境** | `buildReplyPrompt` 的 `Workspace channels: #name (type, seq N, not joined?, archived?)` 行（`replyPromptContext()` 组装）；`loop.test.mjs` 新断言 |
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

### 测试数字（宽档 = 全量）

- 基线：`npm test` **970/970 通过**（9.8s）。交付时：**1005/1005 通过**（本次 +35：能力表 6、op 解析 6、op 集成 10、准入闸 10、prompt 语境 2、搜索作用域 1）。
- `tsc --noEmit`：**0 错误**。`npm run lint`：**0 error**（仅 1 条既有 warning：`hooks/useI18n.tsx:61`，与本 diff 无关；**未跑任何 `--fix`**）。
- 全量输出：`evidence/full-suite-ops.txt`（本次交付前最后一次）；红绿证据：`evidence/red-member-capabilities.txt`、`red-member-ops.txt`、`red-loop-ops.txt` → `evidence/green-member-ops.txt`；准入闸取证：`evidence/access-gate.txt`。

### 残留与依赖（本票不声称 bash 收口完成）

1. **票 05 落地前，`{"type":"bash"}` 与整个 Owner 权限面对成员仍敞开**（ADR-0013 残留 #1）：成员仍有 bash ⇒ 仍有 HTTP 客户端；本票只把「成员**需要** HTTP」这件事消灭掉（决策五的前提），端口过滤与「无沙箱不激活 bash」都在票 05。两票合起来才收口。
2. **本票不声称收口了 `{"type":"bash"}` 入口**，也不给它加门（决策四）。
3. **具备网络能力的扩展 / 包工具**（ADR-0013 残留 #2）只记账，不做工具审计。
4. **`search` 的结果条数上限**沿用既有 `MAX_SEARCH_LIMIT`（50）、`limit` 默认 20；`ops` 每轮封顶 8 条（防一条回复无限扇出）。
5. **人类面 HTTP 契约的真端到端测试**（设计文档票 5，本票未含）仍敞着——本票把秘书的 curl 回放退场，那层覆盖的正确归处是那张票。

### Review

（双轴 code-review 的 Standards + Spec 两份报告，评审后补入。）
