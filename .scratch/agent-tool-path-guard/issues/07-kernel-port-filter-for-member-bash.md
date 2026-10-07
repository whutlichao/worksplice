# 07-内核按端口过滤：成员连不上 worksplice 自己的端口

Type: task
Status: resolved
Blocked by: 05, 06

PR: #99

Spec: `.scratch/agent-tool-path-guard/spec.md`
设计: `docs/http-corridor-caller-identity.md`（决策五第 ③ 环）、`docs/agent-bash-containment-form.md`
ADR: `docs/adr/0013-http-corridor-caller-identity.md`（决策四、决策五）、`docs/adr/0012-agent-bash-containment-form.md`（决策五）
前置票: 05（沙箱，PR #97）、06（成员能力面移出 HTTP，PR #98）

## Problem Statement

票 05 落地后成员 bash 已进内核沙箱，但 profile 写着 `(allow network*)`——它**不封网络**。
于是成员仍能 `curl http://127.0.0.1:<app 端口>/api/*`，而 `POST /api/agent/[id]` 的
`{"type":"bash"}` 走**未沙箱**的裸本地实现、且这条路由没有调用者身份（进门一律按 Owner）。
人类已实测：`curl -s -m 3 http://127.0.0.1:30142/api/channels` 返回 200 与完整频道 JSON
（含 private 的 `secretary-office`）。

这是 ADR-0012 决策六那条排序链的**最后一环**：HTTP 走廊票（06）→ 沙箱票（05）→ 本环。

## Solution

沙箱 profile 保留 `allow network*`（**不能封死出网**：成员要能 `npm install`、拉依赖、访问外部服务），
追加一条按端口的 deny——`(deny network* (remote ip "*:<port>"))`（ADR-0012 Further Notes 已实测的形态，
`docs/agent-bash-containment-form.md:238`）：**只封指定端口，同机其它 loopback 与出网都不受影响**。

**端口必须推导，不能硬编码**（实测教训：某 agent 的 MEMORY.md 速查里记的 base URL 是 `30141`，
实际监听 `30142`，`30141`/`30143` 都没监听；端口会变，`-p` 与自定义端口都支持）。
来源 = **本服务进程实际监听的端口**：Next 在 `listening` 事件里把**真实绑定**的端口写进
`process.env.PORT`（`next/dist/server/lib/start-server.js:296`；dev 端口被占时自动改端口也写进去），
仓库既有事实（`instrumentation.ts` 的启动门、`lib/access-gate.ts`）读的就是这一个变量。

**推导不出来 ⇒ fail-closed**：不封等于洞开着，绝不静默退回「不封」。落地成 ADR-0012 决策五
同款姿态——**不激活 bash**（而不是降级成不封端口的沙箱），并让档位展示能解释这件事。

**机制前提**：bwrap 只有 `--share-net` / `--unshare-net` 两档，**无法表达「只封一个端口」**
（`--unshare-net` 会连出网一起封，违反约束）⇒ Linux 侧同样 fail-closed，不静默放开。

## What to build

- `lib/bash-containment.ts`：
  ① 端口推导（纯函数吃 env，薄适配读 `process.env`，与 `detectBashSandbox` 同款纪律）；
  ② profile 追加按端口 deny（空列表 ⇒ **整体** `deny network*`，不是放开）；
  ③ 机制矩阵补「能否按端口过滤」这一维；④ 两个前提的合取（拿得到沙箱 ∧ 机制能按端口过滤 ∧ 推导得出端口）
     产出**有效 resolution**，下游三处（fail-closed 拒绝文本 / 工具描述 / 档位展示）沿用既有通路；
  ⑤ 边界文本加一句端口规则（决策四「边界先于撞墙」）。
- `lib/bash-containment-extension.ts`：装配处把两个前提合成一个有效 resolution（一个调用、一处答案）。

## Acceptance criteria

- [x] 端口推导有断言：来自 Next 写入的实际监听端口、`-p` 自定义端口同样覆盖；**不是硬编码常量**。
- [x] 推导不出来 ⇒ fail-closed（不激活 bash，不是「不封端口的沙箱」），该分支有测试覆盖。
- [x] profile：`(allow network*)` 之后紧跟按端口 deny；**出网不被封**（正例）；其它 loopback 端口不被封。
- [x] 真会话实测（绿证据）：负例 = 成员会话内 curl app 端口被**内核拒绝**（`Operation not permitted` /
      连不上，**不是 HTTP 4xx/5xx**）；正例一 = 仍能出网；正例二 = 人类会话不受影响；正例三 = 成员经 loop
      的结构化回复协议调协作能力照常（票 06 的 op 在进程内，不经网络）。
- [x] `lib/tool-presets.ts` 零 diff（`git diff --stat` 不出现该文件）。
- [x] 全量 `npm test` 输出落 Answer；`tsc --noEmit` 零错误；lint 只报告不修；未跑 `next build`。
- [x] 双轴 code-review（Standards + Spec）报告落 Answer。
- [x] 机械判据：`git status --porcelain` 空、`git diff --numstat` 无四位数源码单文件、分支有 OPEN 的 PR。
- [x] Answer 写明：ADR-0012 决策六那条链的三环是否真的闭合；残留逐条列清（不笼统说「已收口」）。

## Notes

- 人类会话不沙箱（决策三：无人归属的会话不沙箱）⇒ 人类自己开浏览器/curl 不受影响，验收里要有反向断言。
- Linux `bwrap` 的等价形态照票 05 的先例：argv 形态照给，**本机未验证就不要声称覆盖**，测试只断言形态。
- 提问通道 `orchestration ask`。预授权代答：profile 规则写法 / 端口推导实现 / 模块划分 / 命名 /
  测试策略形状 / 从 ADR-0011·0012·0013 推出的结论 / 必要的配置读取入口。
  必须 ask：封端口后必要操作被连带阻断；`(deny network* (remote ip ...))` 在当前 macOS 对 loopback 不生效。

---

## Answer

**一句话**：沙箱 profile 从「不封网络」收窄成「出网照常、但内核按端口拒绝 worksplice 自己的端口」，
端口从服务进程**推导**（Next 在 `listening` 里写真实绑定端口），推导不出就 fail-closed 不激活成员 bash；
真会话实测在自定义端口 30242 上跑通了负例（内核拒绝，非 HTTP 报错）与三条正例。

### 落了什么

- `lib/bash-containment.ts`
  - `resolveWorksplicePorts(env)`：**推导**本进程实际监听的端口。源 = `process.env.PORT`，由 Next 在
    `listening` 事件里写成真实绑定的端口（`next/dist/server/lib/start-server.js:296`，dev 端口被占自动
    改端口也写进去）。严格解析（非整数 / 非 1..65535 ⇒ 推导不出）。**刻意比别处更严**且不回退任何默认值：
    `bin/worksplice-options.js` 的 `30142` 默认值回退不得（那等于把端口硬编码回来）。
  - `networkRules(blockedPorts)`：`(allow network*)` + `(deny network* (remote ip "*:<port>")…)`（升序去重，
    一条 deny 多 filter）。**空列表 ⇒ `(deny network*)` 整体封死**，不退回放开。
  - `BashSandbox.canFilterPort`：矩阵多一维。SBPL `true`；bwrap `false`（只有 `--share-net` / `--unshare-net`
    两档，封不了单个端口，而 `--unshare-net` 连出网一起封死）。
  - `gateBashSandbox(resolution, ports)`：**两个前提的合取**（拿得到沙箱 ∧ 能按端口过滤 ∧ 推导得出端口），
    产出一个有效 resolution。下游三处（fail-closed 拒绝文本 / 工具描述 / 档位展示）沿用票 05 的既有通路，零改动。
  - `bashBoundaryText(scope, resolution, ports)`：端口那一句进注册期描述（决策四「边界先于撞墙」），
    `ports` **必填**（可选参数会静默漏掉那句，漏传不报错、只让模型白撞墙）。
- `lib/bash-containment-extension.ts`：`createContainedBash` 里算一次端口、过一次 gate，把**有效 resolution**
  交给下游；注入面多一个 `worksplicePorts`（只为测试穷举分支，生产永远走推导）。

### 端口推导（AC「不是硬编码常量」）

- 沙箱路径上**没有任何端口常量**：`grep -n "3014\|3024" lib/bash-containment.ts lib/bash-containment-extension.ts`
  只命中注释里那条实测教训。
- 实例跑在 **30242**（30142 被人类自己的实例占着）、封的正是 **30242** ⇒ 若硬编码 30142 结果会正好相反。
- 覆盖 `-p` / `PORT=` / 四条 npm 脚本 / dev 自动改端口（都落在 Next 写的同一个变量上）。
- 集成层另有一条**生产默认分支**用例：`createContainedBash(scope)` 不传 deps，改 `process.env.PORT`
  断言 profile 里的 deny 端口跟着变；删掉则 fail-closed 且 profile 整体封死网络面。

### 负例证据（内核拒绝，不是 HTTP 层报错）

三条互相印证的证据，缺一不可：

1. **命中计数**（集成层，主判据）：真 loopback 服务器的 `hits` **不涨** ⇒ 请求从未到达。
   若网络没封住，`hits` 涨 1（红证据里就是这样红的）。
2. **文本**：`curl: (7) Failed to connect to 127.0.0.1 port 30242 after 0 ms: Couldn't connect to server`、
   `http_code=000` —— 没有任何 HTTP 状态码。`localhost` 写法同样被拒（deny 不是绑 IP 字面量）。
3. **同一时刻的人类对照**：人类会话（未沙箱）`curl 127.0.0.1:30242/api/channels = 200` ⇒ 服务在听、人类侧通。
4. **取红**：把 `networkRules` 临时回退成票 05 的 `(allow network*)`（一行、带 `[RED-PROBE]` 标记，跑完恢复），
   同一套夹具立刻红在主判据上 ⇒ 拒绝来自这条内核规则，不是「端口上没人听」。

两个 shell 面都验了：RPC 面（`{"type":"bash"}`）与**工具面**（成员自己发起的 bash 工具，原话贴回
`code=000` 并自己解释「连接没建立成功」）。注意票据点出的坑：判据用 hits 计数 + 文本，不拿 curl 退出码当主证据。

### 正例（真会话实测，证据文件 `live-port-filter-07.txt`）

- **出网照常**：DNS 解析 `example.com` 通；`curl -I https://example.com` ⇒ `200`；`npm config get registry` 读得出
  `https://registry.npmjs.org/`。集成层另有一条真出网用例（`example.com` HEAD，**先在测试进程自己探可达性、
  不通就 skip**，离线/CI 不变成假红门禁；本机实测未 skip，真跑了）。
- **只封这一个端口**：同机另一个 loopback 服务照常可达（集成层断言 hits +1）。
- **人类会话不受影响**：同一个端口，人类 curl 命中 +1（反向断言在集成层里，不只靠推理）。
- **成员经 loop 的结构化回复协议照常**（AC 正例三）：沙箱成员 `port-probe` 走 op 成功 `react`，
  `reactions: [{"emoji":"👍","count":1,"memberIds":["2886f177…"]}]`、`rounds: replied | ops: react=applied`
  ⇒ 进程内执行、以**结构身份**落库（不是 Owner 的 `owner`）。同一进程里秘书 `Susan` 也经这条路成功回复。
  自动化层面的承担者是票 06 的 `lib/agent-loop/member-ops.test.mjs`（本票未触及，随全量一起跑）。
  结构性理由也成立：op 是进程内函数调用，沙箱的端口规则只作用在 spawn 出的子进程上，两者不可能互相影响。
- `lib/tool-presets.ts` **零 diff**（`git diff --numstat` 全程未出现该文件）。

### 门禁

| 项 | 结果 |
| --- | --- |
| 全量 `npm test` | **1054/1054 通过**，0 fail / 0 skip，11.4s（首轮 1052，改动后 +2） |
| `tsc --noEmit` | 零错误、零输出 |
| lint（只报告不修） | 0 errors / 1 warning（`hooks/useI18n.tsx` 既有、与本票无关） |
| `next build` | **未跑** |
| 红绿证据 | `evidence/{red,green}-*-port-07.txt`、`live-port-filter-07.txt` |
| `git status --porcelain` | 空 |
| `git diff --numstat` | 无四位数单文件（最大 `lib/bash-containment-extension.test.mjs` 79/15） |
| PR | #99 |

Linux `bwrap`：argv 形态照给、**本机未验证不声称覆盖**；测试只断言矩阵维 `canFilterPort: false`，
真沙箱用例的 skip 谓词从 `!sandbox.available` 改成 `!contained`（矩阵可用 ≠ 有效结论可用）。

### ADR-0012 决策六那条链：三环闭合到什么程度

三环：**① HTTP 走廊票（06）→ ② sandbox 实施票（05）→ ③ 成员 → 本端口关闭（07）**。

- ① ✅ 成员能力面与协作面整体移出 HTTP（结构化回复协议 + 结构身份）。
- ② ✅ 成员 bash 落进 OS 级沙箱（路径判据、env 收口、平台 fail-closed）。
- ③ ✅ **两个阶段各有一条支撑，中间没有空窗**：沙箱落地前靠 ADR-0012 决策五（无沙箱不激活 bash ⇒ 成员手里
  没有 HTTP 客户端），落地后靠内核按端口过滤（本票）。两者在真会话里实测都成立。

**不笼统说「已收口」，逐条列残留**：

1. **同机第二个 worksplice 实例不在封端口内**。推导只认**本进程**的端口：开发时 main 与 worktree 各起一个
   实例，成员在 A 实例里仍能连到 B 实例的端口（B 有自己的数据目录，危害小于同实例，但确实是条走廊）。
   要堵需要跨进程发现机制（没有既有配置来源），属新机制 = 超出本票范围。
2. **具备网络能力的扩展 / 包工具**仍是新的 HTTP 客户端（ADR-0013 残留 #2，本票未动工具审计）。
3. **同 uid 的进程间手段**（`kill` / `ptrace`）由沙箱 profile 的 `process*` / `signal (target self)` 决定，
   与端口无关，未变（ADR-0013 残留 #5）。
4. **出网本身没被收窄**——这是刻意的（成员要能装依赖）。也就是说成员仍能把数据发到公网；
   本票收窄的是「回到 worksplice 自己」这条走廊。
5. **Linux 上成员 bash 现在一律不激活**（bwrap 封不了单个端口）。这是**用户可观察的能力移除**，
   按 ADR-0013「用户可观察后果」先例在此报备，等人类确认（见下）。

### 预授权代答

本票的实现取舍全部落在 dispatch 列出的预授权范围内（profile 规则写法、端口推导的实现方式、模块划分、
命名、测试策略形状、从 ADR-0011/0012/0013 推出的结论、新增一个小的配置读取入口），**没有编造人类答复**。

### ⚠️ 需要人类/协调者确认的一件事（不阻塞合流）

**Linux 上成员 bash 改为不激活**。bwrap 只有 `--share-net` / `--unshare-net` 两档，没有「只封一个端口」的
中间形态；`--unshare-net` 会把出网一起封死，直接违反「不能封死出网」这条硬约束。于是只剩两个选项：
封不了端口（成员 bash 不激活，fail-closed）或不封（走廊对 Linux 用户敞开）。按 ADR-0012 决策五 +
ADR-0013 决策五的 fail-closed 原则（三处均已于 2026-10-06 获人类追认）选了前者，**并在档位展示里说清原因**。

这是**产品级取舍**而非实现细节：README 宣传「macOS 或 Linux」，此前 Linux 成员有（未验证的）bwrap 沙箱。
若人类要「Linux 保留 bash、接受走廊敞开」或「先投一个 Linux 端口过滤实现」，改 `BashSandbox.canFilterPort`
这一维即可，形态已在代码里留好。此项已按 ADR-0013 决策五的先例向人类报备，未默默生效。

### Review（双轴，coordinator 未豁免）

两个**只读** reviewer 并行（`evidence/double-axis-review-07.workflow.mjs`，与票 02/05 同款形状）。
两份报告见下节「findings 处置」。

#### 第一轮 · Standards（verdict: OK with notes）

Correct：`networkRules` 把网络面两行收成一个函数、空列表整体封死与 ADR-0012 决策五一致；术语纪律到位
（判定层/装配处/机制/前提，未引入 component/service/API 同义词）；注释密度与既有风格一致、面向模型的文本
保持英文硬编码（符合 `docs/i18n.md` 分层）；测试用真 loopback server 做外部行为判据是「只测外部行为」的正例。

#### 第一轮 · Spec（verdict: OK with notes）

Correct：① 端口推导非硬编码（并**核实**了注释里引的 Next 写入点为真）；② 出网不被封且与
`docs/agent-bash-containment-form.md:238` 的实测形态一致；③ 人类会话反向断言在集成层里；
⑤ `tool-presets.ts` 零 diff；⑥ Linux 只断言矩阵维、未声称覆盖。**Scope creep：无。**
并独立判定：Linux 上因 bwrap 封不了端口而 fail-closed **在规格授权范围内**（票 07 Solution 明写该句），
但属用户可观察的能力移除，应留痕交人类。

#### findings 处置

| # | 轴 / 级别 | finding | 处置 |
| --- | --- | --- | --- |
| 1 | Standards P1 | `AGENTS.md` 未登记新导出与两条后来者必知的坑 | **fixed**：File Map 条目补「机制能否按端口过滤 / 端口推导 / 两个前提合取」；沙箱小节加一条「成员连不上 worksplice 自己的端口」，内含两个坑（推导不出 ⇒ 不激活 bash；Linux 一律不激活，矩阵可用 ≠ 有效结论可用） |
| 2 | Standards P2 | `ContainedBash.ports` 全仓无读取方（Speculative Generality） | **fixed**：删字段（端口只在装配处局部用一次，传给边界文本）；`BashSandboxPlan.blockedPorts` 同样删（reviewer 已在工作区看到我删掉） |
| 3 | Standards P2 | 注释称读 `PORT` 的是「三个消费者」不准，且未说明为何不回退默认值 | **fixed**：点名列全三处（`bin/worksplice-options.js:25` / `instrumentation.ts` 启动门 / `lib/access-gate.ts` 准入闸），逐个写明为何不能当兜底（回退 `30142` 默认值 = 把端口硬编码回来） |
| 4 | Standards P2 | `docs/agent-bash-containment-form.md:242` 过期表述「本形态不封端口」 | **fixed**：改为「保留 + 理由已被 ADR-0013 决策五解除 + 票 07 已落地按端口 deny + 端口必须推导的坑」 |
| 5 | Standards P2 | `PORT` 解析三份实现（Duplicated Code，判断题） | **fixed**（按建议）：`parsePort` 注释写明「刻意比别处更严」以及三份的语义差异为何不能合并（启动参数错时 Next 自己报错、准入闸错时还有请求门兜着、这里错一次就是「没封端口」= 洞开着） |
| 6 | **Spec P1** | 正例一（出网）缺集成层真会话证据 | **fixed**：新增真出网用例（`example.com` HEAD；先在测试进程自己探可达性，不通则 skip 并在注释里说明离线取舍）；本机实测真跑、未 skip。live 证据另有 DNS + npm registry + HEAD 三项 |
| 7 | **Spec P1** | 正例三（loop 协议）无对应测试 | **fixed（不新增测试，指认承担者）**：op 是进程内调用、与 spawn 子进程的端口规则不可能互相影响；自动化承担者是票 06 的 `member-ops.test.mjs`（随全量跑），live 另有沙箱成员 `react` op 成功的落库证据（结构身份，非 Owner）。理由写进 Answer |
| 8 | Spec P2 | skip 谓词 `!sandbox.available` 在 Linux 装了 bwrap 时会误判（矩阵可用但有效结论不可用） | **fixed**：引入 `contained = sandbox.available && sandbox.sandbox?.canFilterPort === true`，15 处 skip 谓词统一改用它 |
| 9 | Spec P2 | 集成层全注入 `worksplicePorts`，生产默认分支（`process.env.PORT`）无断言 | **fixed**：新增「生产默认分支」用例（改 `process.env.PORT` ⇒ profile 里的 deny 端口跟着变；删掉 ⇒ fail-closed 且 profile 整体封死网络面） |
| 10 | Spec P2 | 工作树脏（与 AC 冲突） | **fixed**：末次提交收口，`git status --porcelain` 空 |
| 11 | Spec note | `bashBoundaryText` 第三参可选 ⇒ 漏传静默丢端口句 | **fixed**：改为必填（漏传不报错、只让模型白撞墙，可选参数是不该有的宽容） |
| 12 | Standards P2 | 注释与事实不符：函数 JSDoc 错挂在接口声明上 | **fixed**：长注释移到 `resolveWorksplicePorts`，接口留一行短注释 |