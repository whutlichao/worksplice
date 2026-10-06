# 04-HTTP 走廊的调用者身份

Type: grilling
Status: resolved
Blocked by: （无）

Spec: `.scratch/agent-tool-path-guard/spec.md`
设计: `docs/agent-bash-containment-form.md`（Implementation Decisions · 决策六「排序约束」）
ADR: `docs/adr/0012-agent-bash-containment-form.md`（决策六）
前置事实: `docs/adr/0011-agent-file-tool-path-guard.md`（票 02 已合入 `a2d4634`）

## Question

**怎么让 worksplice 的 app 不再给任何能摸到端口的东西一条未沙箱的裸 shell。**

ADR-0012 决策六把这个洞判成排序链的第一环：在它落地之前，票 02 的六工具守卫与本形态都只能
自述为「纵深防御的一层」。要定的是这条走廊的**形态**——门后是谁、凭证从哪来、秘书的 curl
能力面怎么办、`dev:lan` 时是什么姿态。

已取证的既有事实（本票不重开）：

- `POST /api/agent/[id]` 接受任意命令，`{"type":"bash"}` 经 `lib/rpc/session.ts:746` 进入
  `AgentSession.executeBash` 的裸本地实现（`dist/core/agent-session.js:3037` 的
  `options?.operations ?? createLocalBashOperations({ shellPath })`）。
- 这条路由没有调用者身份：进门一律按 Owner 处理（`lib/domain/collab/channels.ts:7`）。
- 非浏览器客户端不做来源校验（`.github/SECURITY.md`「Exposure and hardening」）；
  Host 白名单放行 loopback 名与 IP 字面量。
- 认证已存在但默认关闭：`WORKSPLICE_PASSWORD` → HTTP Basic Auth，用户名固定 `pi`。
- `getShellEnv()` 是 `{...process.env}` → app 的完整环境变量进入每个成员的每个 bash 子进程。
- 默认 bind `127.0.0.1`；`dev:lan` / `start:lan` / `--hostname 0.0.0.0` / `WORKSPLICE_HOSTNAME`
  放宽到 `0.0.0.0`。
- 秘书的 curl 能力面是 `docs/spec-bootstrap-agent.md` §3.1 / §3.3 的 **[锁定]** 条目。

## Acceptance criteria

- [x] 决策文档落 `docs/` 下，七节结构齐全、正文中文、每节有实质内容。
- [x] Q1（调用者身份 vs 认证）有明确结论：先回答「普通成员通过 bash 调 app 自己的 API 有哪些正当用途」，再据此定「默认是否向成员发放凭证」。
- [x] Q2（认证形态）在强制 `WORKSPLICE_PASSWORD` / per-agent token / 分离端口 / 组合之间明确选定，被否决项附具体理由。
- [x] Q3（env 收口与请求认证的先后）独立验证，不照抄协调器判断；认同并说明限定条件（三条重述）。
- [x] Q4（秘书 `[锁定]` 条目改不改）给出独立判断与论证（含追加的第四层），并答 coordinator 的两条追问。
- [x] Q5（`dev:lan` 姿态）明确 fail-closed，并给出「检查放在哪」的决定性理由。
- [x] 结论里明确写出 `dev:lan` 姿态，以及 env 面与请求面两条通道各自的处置。
- [x] 残留绕过面被写明（7 条，首要那条随附「本票不声称窗口已关」）。
- [x] 后续实施票的输入：阻塞关系 + 不做会怎样（5 张票的表）。
- [x] 术语决议 inline 进 `CONTEXT.md`（准入闸 / 调用者身份 / 结构身份 / 人类面·成员面）。
- [x] ADR 三条件全满足，创建并续到 0013。
- [x] **不改代码**——源码改动面为空（机械判据全过）。

## Notes

- 不做秘书豁免（秘书在每个频道、最易被注入）。
- 不引入 HITL / 审批流。
- 排序：本票在 sandbox 实施票**之前**。
- 提问通道 `orchestration ask`。

## Answer

### 交付物（PR #96）

| 文件 | 说明 |
| --- | --- |
| `docs/http-corridor-caller-identity.md` | 七节决策文档（Problem Statement / Solution / User Stories / Implementation Decisions / Testing Decisions / Out of Scope / Further Notes），正文中文 |
| `docs/adr/0013-http-corridor-caller-identity.md` | 新 ADR（决策一至五，三条件全满足） |
| `CONTEXT.md` | 新增四条术语：准入闸 (Access Gate) / 调用者身份 (Caller Identity) / 结构身份 (Structural Identity) / 人类面·成员面 (Human Face / Member Face) |
| 本文件 | 票据正本，Status 走 claimed → resolved |

### 结论一句话

**把 app 自己的端口定成「人类面」，成员面整体移出 HTTP**——成员经 HTTP 调 API 没有正当用途（`docs/spec.md` §5.7 明写 agent-loop 直接调服务层、不走 HTTP），所以不是「哪个方案更好」，是凭证类方案要解决的那个问题**本身不存在**；成员需要的系统能力改走 loop 的结构化回复协议（与 `claim`/`complete` 同一条缝），身份取**结构身份**（调用点天然持有）而非凭证自述；`dev:lan` 等非 loopback bind 一律 fail-closed。

### 承重论证（本票最要紧的一条，已按 coordinator 要求写在文档最显眼处）

**成员 bash 与人类同 uid、同 loopback，本机没有任何 OS 级手段能区分两者。**三条逐条塌：socket peer credentials 给出同一个值；`Origin` / `Sec-Fetch-Site` 是 CSRF 防御、其前提就是「攻击者是设不了头的浏览器」，成员一条 `curl -H 'Origin: …'` 即破；而**一个调用者必须持有的秘密必然可被那个调用者读到**（它得用那个秘密才能调用）。⇒ 共享密码与 per-agent token 都只能给「可区分」，给不了「挡得住」⇒ **唯一关得掉的形态是「成员够不到的通道」**。

### 五问的结论

| 问 | 结论 | 来源 |
| --- | --- | --- |
| Q1 调用者身份 vs 认证 | 前置问题（普通成员的正当 API 用途）取证结论 = **零**；默认**不向成员发放任何凭证**；身份取结构身份。**Q1 与 Q4 是同一条缝，合并为决策一**（不写成两条并列措施） | **ask 回收裁定**（取「成员面整体移出 HTTP」）+ 取证 |
| Q2 认证形态 | 不强制 `WORKSPLICE_PASSWORD`（loopback 零配置保留）；`WORKSPLICE_PASSWORD` 职责收窄为「非 loopback 的准入闸」，**不承担身份**；per-agent token / 分离端口 / 组合**逐条否决并附具体理由** | 预授权代答（Q2 的形态取值由 Q1 的裁定蕴含；ask 的取向一致） |
| Q3 env 面与请求面的先后 | 协调器判断**成立但前提要说准**：env 收口是「**凭证渠道**的前置」而不是「请求认证的前置」；且它**不是请求面的替代品**（请求面默认无认证，做了 env 收口不等于请求面收紧了）；更前置的是「成员手里不能有到本端口的 HTTP 客户端」 | 预授权代答（**独立验证**，不照抄） |
| Q4 秘书 `[锁定]` 条目 | 锁的是**能力面**不是通道（ask 回收裁定，三层理由照录）。**追加第四层**：条目里「设了密码时 curl 加 `-u pi:<密码>`」若照字面实现等于把准入秘密写进成员家目录——**不是「改不改」的取舍，是「不能这么实现」**。两条追问逐条答 | **ask 回收裁定** |
| Q5 `dev:lan` 姿态 | **fail-closed**：非 loopback + 无凭证 ⇒ 服务不可用。决定性理由：四条 npm 脚本**绕过 `bin/worksplice.js`**，今天连警告都不打 ⇒ 判定必须落在服务进程内 | **ask 回收裁定**（取 fail-closed，并确认「检查必须在服务进程内」是本条关键） |

### ask 回收记录

- **Q2 线程**（`/tmp` 落盘 `q2.txt`，2980→3752 字节，约 5 分钟内回收）：Q1 裁定取 A，并明确「你的取证把我 spec 里的倾向变成了证明」；要求①承重论证放最显眼处、②Q1 与 Q4 写成同一个决策、③Problem Statement 按「成员侧走廊没有要保护的东西、要收的是整面可达性」收窄；同一条消息里**Q5 一并裁定取 fail-closed**，并确认「检查落在服务进程内」是关键。**两条向人类报备项照录进文档**（`dev:lan` 的用户可观察后果；fail-closed 原则三处引用的耦合）。
- **Q4 线程**（`q4.txt`，2980 字节）：裁定「锁的是能力面、换通道不违反」，附三层理由 + 两条追问（MEMORY.md 的 7 条 curl 实测怎么处理；是否触碰 `PRESET_DEFAULT` 档位锁定），并授权「答完这两个就继续，不必再问」。两条追问在决策一 §1.3 / §1.5 逐条答。
- **Q5 专用线程**（`q5.txt`）未回收——但其裁定已随 Q2 线程到达，无需重复。
- **追加的一条 coordinator 追问**（随 Q2 线程末尾）：「Q1 与 Q4 合并后，`{"type":"bash"}` 那条执行入口由谁把守」——**已落成独立决策四**（三种调用者 × 守卫归属的映射表 + 「不加第二道身份门」的结论与代价）。

**无「未回收人类答复、按推荐取向落地」的情形**：四条必须问的决策（Q1 前置问题、Q2、Q4、Q5）全部经 ask 回收或由取证定论。

### 本机取证（事实部分是 worker 自己查的）

- `getShellEnv()` 是 `{...process.env}` + PATH 追加一处 bin 目录（`dist/utils/shell.js:115-126`）⇒ `WORKSPLICE_PASSWORD` 今天就在成员的 `env` 里。
- **pi 自己已有这条纪律**：`resolveSpawnContext` 显式删五项 `PI_*`（`dist/core/tools/bash.js:137-143`）——`WORKSPLICE_*` 没有对偶。
- **env 剥法的接缝**：bash 工具面有 `BashToolOptions.spawnHook`；RPC 面**没有** spawnHook（`executeBashWithOperations` 不传 `env`，落 `env ?? getShellEnv()` 的兜底，`dist/core/bash-executor.js:65` + `dist/core/tools/bash.js:68`），唯一杠杆是 `operations` 包装（`dist/core/agent-session.d.ts:773-777`）。⇒ **一个包装过的 `operations` 同时盖住两个面**，而 ADR-0012 的沙箱也落在同一处 ⇒「这个子进程能拿到什么」只有一处答案（locality）。
- `docs/spec.md` §5.4 的 act 清单**本来就含** `schedule reminder` / `react` / `pin`（`:333`）⇒ 秘书的 curl 是绕过未实现缺口，不是 spec 的意图。
- loop 的回复 prompt 全文不含 `30142` / `127.0.0.1` / `localhost` / `curl` / `api/` ⇒ 成员从来没被教过有 HTTP 这条路。
- `package.json:34`/`:39`/`:41`/`:42` 四条脚本直接起 `next`，只 `bin/worksplice.js:70-80` 有那条警告 ⇒ `dev:lan` 今天**连警告都不打**。
- `getPresetFromTools` 比对前先按 `BUILTIN_TOOL_NAMES` 过滤（`lib/tool-presets.ts:65-68`）⇒ 扩展工具不会让档位标签漂移（决策一 §1.3「工具形态本也可以不漂移」的证据）。
- `lib/domain/collab/*-route.test.mjs` 是 `readFile` + `assert.match`（**读源码正则**），不是真跑 HTTP ⇒ 决策一 §1.5 点出的真缺口。
- **ADR-0012 那条保留解锁的理由**：它的 Further Notes 记了按端口过滤可用但「本形态不使用」，唯一理由是「因为秘书的 curl 能力面是锁定条目」——Q4 裁定后该理由消失。

### 门禁执行情况（G-docs：不跑测试、不做双轴 review）

本票不跑测试（决策票，源码改动面为空，决策文档没有被测对象）；不做双轴 code-review（审的是文档 diff，已由 coordinator 的 G-docs 门禁覆盖）。机械判据自检全过：

```bash
git diff f1f6425 HEAD --name-only | grep -v '^docs/\|^CONTEXT.md\|^\.scratch/'   # 空（exit 1 = grep 无匹配）
git status --porcelain                                                          # 空（.pi-lens.json 已入 main 仓 .git/info/exclude）
git diff --numstat f1f6425 HEAD                                                 # 无四位数以上单文件
```

numstat：`.scratch/…/04-…md` +54 / `CONTEXT.md` +16 / `docs/adr/0013-…md` +24 / `docs/http-corridor-caller-identity.md` +330。

### 挂账（已向人类报备，**2026-10-06 全部销案**）

1. **Q5 fail-closed 的用户可观察后果**：`npm run dev:lan` / `start:lan` 在未配置凭证时将**拒绝服务**，想要局域网访问必须先设凭证。**人类已明确接受该后果**，不再阻塞 sandbox 实施票开工。
2. **fail-closed 原则三处引用**：ADR-0011 决策六第三条（判定自身出错一律拒绝，已合入）/ ADR-0012 决策五（无沙箱不激活 bash，原标「coordinator 代答、待人类追认」）/ 本票决策二（非 loopback 无凭证拒绝服务）。**人类已于 2026-10-06 确认该原则（ADR-0012 那条代答同时追认转正），三处现均为人类拍板，「推翻则三处都要改」不再是开放风险**。仍需保留的提醒：若将来推翻该原则，ADR-0012 决策五一旦失效，「成员没有 HTTP 客户端」这条不变量的前半段会同时失效，收口被推迟到沙箱落地之后。

### 残留绕过面

7 条，见决策文档「决策的后果」。首要那条随附明确声明：**在「成员 → 端口关闭」（票 3）完成之前，`{"type":"bash"}` 与整个 Owner 权限面对成员是敞开的——本票不声称收口了它，沙箱票也不能（ADR-0012 决策六原话：只能自述为「纵深防御的一层」），两票合起来才收口。**

PR：**#96** https://github.com/whutlichao/worksplice/pull/96
