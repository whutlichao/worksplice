# 05-成员 bash 的沙箱与 env 收口

Type: task
Status: resolved
Blocked by: （无；03 已 resolved，04 是文档票，本票实施 ADR-0012 的六条决策）

Spec: `.scratch/agent-tool-path-guard/spec.md`
设计: `docs/agent-bash-containment-form.md`
ADR: `docs/adr/0012-agent-bash-containment-form.md`（决策一至六）· `docs/adr/0013-http-corridor-caller-identity.md`（决策三 env 收口）
前置事实: `docs/adr/0011-agent-file-tool-path-guard.md`（票 02 已合入）

## What to build

让成员的 `bash` 落在**操作系统级沙箱**内（判据落到进程，不落在命令文本上），并把 `WORKSPLICE_*`
从子进程环境里收掉。逐条对应 ADR-0012 的六条决策：

1. **形态**：允许面由**与路径守卫同一份**允许根判定生成（复用 `lib/tool-path-guard.ts` 的
   `pathGuardScopeFor`，不新造第二套目录解析）。
2. **allow-only profile**：清单内可达、其余一律不可达。清单 = 成员允许根 + 系统只读面 +
   进程自己的 `TMPDIR` + 只读工具链缓存。**用户级凭证不进清单**（`~/.ssh` / `~/.config/gh` /
   keychain 类）——已拍板的代价是成员 shell 不能 `git push` / `gh pr create`。
3. **覆盖范围 = 沙箱跟随会话归属的成员**：工具面与 `lib/rpc/session.ts` 的 RPC 面（人类 `!bash`
   走同一条路）走同一判定；**无人归属的会话（人类自己的会话）不沙箱**。规则是会话属性而非工具属性。
4. **越界处置**：机制换成内核的 `Operation not permitted` / exit 134，并把它归因成**可读错误**；
   该成员的允许根写进**注册期的工具描述**（边界先于撞墙）。仍**不静默改写、不静默截断**。
5. **平台 fail-closed**：macOS 用 `sandbox-exec`；Linux 用 `bwrap`（**本机没有、未验证——测不出来
   就不声称覆盖**）；Windows 无对应物。**拿不到沙箱就不激活 bash**。
6. **env 收口**：命名空间一刀切剥 `WORKSPLICE_*`，不带成员判定分支；保留 pi 故意暴露的
   `PI_SESSION_ID` / `PI_SESSION_FILE` / `PI_PROVIDER` / `PI_MODEL` / `PI_REASONING_LEVEL`。
   只有 `WORKSPLICE_PASSWORD` 是真秘密，其余 `WORKSPLICE_*` 并非机密，按命名空间一刀切更省心。

沙箱与 env 收口落在**同一个 operations 包装**上：bash 工具面有 `BashToolOptions.spawnHook`，
但 RPC 面没有 spawnHook、落 `env ?? getShellEnv()` 兜底，唯一杠杆是 operations 包装；且包装必须
**总是显式构造 env**，不能写成「上游给了就转交」。

## Acceptance criteria

- [x] profile 由**同一份**允许根判定派生（改允许根 → profile 跟着变），不新造第二套目录解析。
- [x] profile 是 allow-only：清单外读被拒、清单外写被拒；成员允许根内读写照常。
- [x] 用户级凭证面（`~/.ssh`、`~/.config/gh`、keychain 类）不在清单内，并有负例断言。
- [x] 工具面与 RPC 面走同一判定（断言两处都进沙箱）；人类无归属会话**不**沙箱。
- [x] 越界失败可读化：EPERM 与 exit 134 有断言（不是裸码），且指明边界与允许根。
- [x] 允许根写进**注册期**的工具描述（边界先于撞墙），且 pi 原生描述/准则不退化。
- [x] 拿不到沙箱的平台 fail-closed：bash 不激活（拒绝执行而不是裸跑），档位展示能解释这件事。
- [x] `WORKSPLICE_*` 全部剥除、五个 `PI_*` 全部保留，各有断言。
- [x] 冒烟清单：node / npm / git / bun 各跑一条只读命令（清单够用），**gh 是实测修正**——它在沙箱里整条不可用
      （启动就要读 `hosts.yml` = token 落点，而决策二明令凭证不进清单），断言按「可归因的拒绝」写，不是成功；
      详见下方「实测修正」与 `lib/bash-containment-extension.test.mjs`。
- [x] 负例：根外读、根外写、`sh <工作区内脚本>` 藏载荷、`node -e` 路径作数据、`$VAR` 间接。
- [x] Linux `bwrap` 的 profile 生成有实现与测试，但**未在本机验证**这一事实照实写进文档与测试。
- [x] 不改任何工具档位的名义构成（`PRESET_FULL` / `PRESET_DEFAULT` 仍含 bash），不改
      `lib/tool-presets.ts` 的档位定义本身。
- [x] 不做 TOCTOU 加固（沿用 ADR-0011 决策六）；不声称 bash 收口完成（HTTP 走廊票在前）。

### 门禁（G-impl）

- 测试档位：**宽**（全量）。本票改的是每个会话的 shell 执行路径，影响面圈定不了；全量 `npm test`
  实测 8-10 秒 / 970+ 用例，付全量成本接近零。
- 两层 seam 都要测：纯函数层（profile 生成、允许面判定、env 过滤，可穷举）+ 集成层（真会话里
  越界被拒、合法路径零行为变化、人类无归属会话不被沙箱）。
- `tsc --noEmit` 零错误；lint 只报告不修；**绝不 `next build`**。
- 红绿证据落 `.scratch/agent-tool-path-guard/evidence/`。
- **双轴 code-review（Standards + Spec）不可省**：本票跨 bash 接缝 / env / 平台适配 / 档位展示，
  不满足「无跨模块 seam」这条可数判据。Answer 里有独立 Review 小节（两份报告不合并、不重排）。
- 机械判据：`git status --porcelain` 空；`git diff --numstat` 无四位数以上单文件；
  `gh pr list --head <分支>` 有一条 OPEN。

## Notes

- 涉及模块：`lib/bash-containment.ts`（纯层：平台适配 / profile 生成 / env 收口 / 失败归因）、
  `lib/bash-containment-extension.ts`（pi 侧装配：operations 包装 + bash 同名覆盖注册）、
  `lib/rpc/caller.ts` 与 `lib/rpc/session.ts`（两处接线）、`lib/tool-path-guard.ts`（复用，不改语义）。
- 术语用 `CONTEXT.md` 的领域词：允许根、路径守卫、沙箱。
- 提问通道 `orchestration ask`；预授权代答的项见派活 spec。
- Linux 侧实现但未验证；Windows 无对应物 → fail-closed。

## Answer

### 交付物

| 文件 | 说明 |
| --- | --- |
| `lib/bash-containment.ts` | 沙箱的判定层（**纯**，零 SDK）：平台适配（`resolveBashSandbox` / `detectBashSandbox`）、allow-only profile 生成（`sandboxExecProfile`）、bwrap bind 清单（`sandboxLaunch`）、`WORKSPLICE_*` env 收口（`stripWorkspliceEnv`）、EPERM/exit 134 可读归因（`explainBashFailure`）、工具描述边界文本（`bashBoundaryText`）、状态派生（`containmentStatus`） |
| `lib/bash-containment-extension.ts` | pi 侧装配：bash 同名覆盖定义（描述带允许根）+ 工具面与 RPC 面共用的 sandboxed operations（自建 spawn，镜像 pi 的 `killProcessTree` 与 `waitForChildProcess`，含 pi#5303 的 stdio 空闲宽限） |
| `lib/bash-containment.test.mjs` | 纯函数层 13 例（平台矩阵 / allow-only 在册与不在册 / 数据目录不变式 / 两形路径 / bwrap 形态 / env / 归因 / 边界文本） |
| `lib/bash-containment-extension.test.mjs` | 集成层 15 例（真沙箱：冒烟、负例、三条文本逃逸、RPC 面同判定、人类会话不沙箱、env、fail-closed、timeout/abort/134 契约、凭证面、get_state） |
| `lib/rpc/caller.ts`（+25/-5）· `lib/rpc/session.ts`（+23/-1）· `lib/pi-types.ts`（+6/-1） | 接线：`pathGuard` 在场 ⇒ 装配沙箱（caller）；RPC 面 `executeBash` 传同一份 operations（session）；`get_state` 带沙箱状态 |
| `hooks/useAgentSession.ts` · `components/ChatInput.tsx` · `lib/i18n/messages/{en,zh-CN}.ts` · `components/ChatInput.test.mjs` | 档位展示的解释（决策五）：fail-closed 平台上 `default`/`full` 的说明与 title 写出「本平台无沙箱 ⇒ bash 不激活」 |
| `AGENTS.md` | File Map 登记两个新模块 + Key Design Decisions 新增「成员 bash 的沙箱」小节（含实测代价与自建 spawn 的理由） |
| `lib/tool-path-guard.ts` | **未改**（复用 `pathGuardScopeFor`，ADR-0012 决策一「同一份允许根」） |
| `.scratch/agent-tool-path-guard/evidence/` | 红绿证据、全量测试汇总、既有 lens 发现归属取证、双轴 review 编排脚本 |

### outcome

resolved。ADR-0012 六条决策逐条落地 + ADR-0013 决策三的 env 收口：成员的 `bash` 现在跑在 OS 级沙箱里（macOS `sandbox-exec` + 按成员生成的 allow-only profile），允许面由与路径守卫**同一份**允许根判定派生；工具面（同名覆盖定义）与 RPC 面（`lib/rpc/session.ts` 的 `{type:"bash"}`）走同一判定，人类无归属会话不沙箱；越界是内核的 `Operation not permitted` / exit 134，并被归因成带允许根的文本；`WORKSPLICE_*` 按命名空间一刀切从子进程环境剥掉（五个 `PI_*` 保留）；拿不到沙箱的平台 bash 拒绝执行而不是裸跑。

**本票不声称 bash 收口完成**：按 ADR-0012 决策六的排序链，HTTP 走廊票（票 04 的形态，实施票在前）落地前，本形态与票 02 都只是**纵深防御的一层**——成员仍可经 `POST /api/agent/[id]` 让 app 代跑未沙箱的裸 shell。

### 测试数字（宽档 = 全量）

- `npm test`：**1000 / 1000 pass，0 fail**（10.0s）。基线 970（票 02 记录）→ 新增 **30**（纯函数 13 + 集成 15 + ChatInput 展示层 2）。汇总：`evidence/full-suite-05.txt`
- `node_modules/.bin/tsc --noEmit`：**0 error**（`evidence/tsc-05.txt`）
- `npm run lint`（= `eslint .`，只报告不修）：**0 error**（1 warning 在未改动的 `hooks/useI18n.tsx`，`evidence/lint-05.txt`）
- 红绿节奏（tdd）：纯函数层先红（模块不存在，`evidence/red-pure-sandbox.txt`）→ 绿；集成层先红（把三处接线 `git stash` 回退到改动前 ⇒ 21 条断言变红，`evidence/red-integration-sandbox.txt`）→ 绿
- 绝不 `next build`（未跑）

### 实测修正（本票自己查到的，不推测）

1. **`gh` 整条命令在沙箱里不可用**——比 ADR-0012 决策二预估的「不能 `git push` / `gh pr create`」更强。实测：`gh --version` 启动时就要读 `~/.config/gh/hosts.yml`（token 落点），拒绝读它 gh 直接 `failed to create root command` 退出 1（`config.yml` 单独开口也救不了）。**取向不变**：凭证不进清单（决策二是人类拍板项），代价照实登记在测试与本文；正解（每成员凭证落在成员自己家目录）是决策二已写明的后续票输入。**未走 ask**：这不是「profile 不可用」（node / npm / git / bun / curl / node --test 全部实测可用），而是决策二的直接结果，属「从 ADR 推出的结论」预授权范围；若人类认为该改取向（给成员 `GH_CONFIG_DIR` 一类），另开票即可。
2. **`TMPDIR` 在清单内 ⇒ 同用户的其他临时文件可读**——写集成测试时踩到：fixture 的「根外」对照物住在 TMPDIR 里，于是它可达。这正是 ADR-0012 后果表 #3 的记账项，已作为**显式断言**写进集成层（`readShared` 用例），不再只是文字残留。
3. **`sandbox-exec` 的 allow-only profile 需要 `(literal "/")` 与「清单路径的祖先 read-metadata」**：漏掉前者 bash 启动即 SIGABRT（exit 134、无 stderr），漏掉后者 node/npm 在 `lstat "/Users"` 上 EPERM。两者都写进了 profile 生成器并在纯函数层断言；实测记录另见 `docs/agent-bash-containment-form.md` 的既有表。
4. **`~/.gitconfig` 必须在读面**：`git --version` 启动就要读它（ADR-0012 决策二的实测表已记）；本票以**单文件 literal** 开口（不是整个家目录）。它是用户级非凭证配置，但**可能含 token**（`insteadOf` / `extraHeader`）——这是本票登记的残留风险，正解同样是每成员 gitconfig。
5. **Linux `bwrap` 分支：生成有实现、本机未验证**。测试只断言 argv 形态（`--die-with-parent` / `--unshare-all` / `--ro-bind-try` / `--bind-try` / 数据目录 `--tmpfs` 后回绑家目录），**不声称覆盖**；bwrap 缺席时集成层按 skip 记。

### 预授权代答的项（派活 spec 授权范围内自主取的值）

模块划分（纯判定层 + pi 装配层，与路径守卫同形）、错误码语义（EPERM/134 的归因文本）、profile 生成方式（SBPL + bwrap 两形态同一份计划）、平台适配器内部结构、冒烟清单的具体命令（node / npm / git / bun 成功 + gh 拒绝）、验证手段与红绿形状、`~/.local` 不收（Linux 密钥环落点）——全部按 ADR-0011/0012/0013 与实测证据取值，逐条有测试或证据文件。

### Review

按 `code-review` skill 的流程做**双轴独立评审**（两个并行只读 reviewer，固定点 `8a05a6d` = main，编排脚本 `evidence/double-axis-review-05.workflow.mjs`）。两份报告**不合并、不重排**，原文如下。

#### Standards（独立 reviewer 报告，原文）

**Correct（有证据的优点）**
- File Map 登记：`AGENTS.md` 新增两文件条目并置于 `types.ts` 前，符合 AGENTS.md「File Map 登记约定」。
- i18n 分层合规（docs/i18n.md 分层表）：UI 文案双语言包加键（`lib/i18n/messages/{en,zh-CN}.ts:166/168`）；进模型上下文的 `bashBoundaryText`/`bashUnavailableMessage`/`explainBashFailure` 英文硬编码；注释中文。三处判断口径正确。
- 接缝与 ADR-0011 路径守卫同形（同名覆盖定义 + `extensionFactories`），`lib/rpc/caller.ts:126-128` 两扩展并列，未新造注入点。
- env 收口无成员分支（`bash-containment.ts` `stripWorkspliceEnv`）+ always-env 落在与沙箱同一个 `operations` 包装，注释写明 RPC 面无 spawnHook 的理由——与 SECURITY.md「凭证不进清单/不入日志」方向一致。
- 平台矩阵与 Linux 分支照实标「本机未验证」，不冒充覆盖。

**Finding: P2 — diff 卫生，`lib/rpc/caller.ts:54`**：`const registry = getRpcRegistry();    const locks = getLocks();` 两语句被并到一行（原为两行）。非 lint 可查项，但属改动引入的可读性缺陷，疑似误改，回退即可。同批 `session.ts` 构造函数下方空行被删（`:281`），同类噪声。

**Finding: P2 — i18n 拼接（docs/i18n.md「Using Translations In A Component」：不要拼接翻译片段，用参数）**：`components/ChatInput.tsx:108` 用硬编码 ` \u00b7 ` 拼 `t(...)`；`:2171` 用 ` — ` 拼 `toolPresetNote` 进 `title`。分隔符与语序由组件固定，语言包无法调整句构。

**Finding: P2 — Speculative Generality / Duplicated Code**：`hooks/useAgentSession.ts:73` 的 `BashContainmentNotice` 复刻 `bash-containment-extension.ts:74` 的 `BashContainmentStatus`（且把 `mechanism` 放宽成 `string|null`）。全仓唯一消费点只用 `.available`（`ChatInput.tsx:107,1110`）——`mechanism`/`reason` 由 `session.ts:548` 计算下发却无人读。

**Finding: P2 — 展示面生产不可达**：全仓无 `<ChatInput` 渲染点（仅 `ChatInput.test.mjs`），`useAgentSession` 亦未被 `app/` 引用，故决策五的档位解释在运行期无触发路径；`bashContainment` prop 永无生产者。

**Finding: P2 — Data Clumps**：`bash-containment-extension.ts` `execInSandbox` 把 `ContainedBash` 已有的 `scope/resolution/plan/shellPath` 逐字段再传一遍；`containmentStatus` 为纯状态派生却住在 SDK 装配模块。

基线判断题：`killProcessTree`/`waitForChildProcess`/`resolveTimeoutMs` 逐字镜像 pi dist，属已注明的可接受取舍，代价是随 SDK 升级静默漂移，需回归锚点（现由 `bash-containment-extension.test.mjs` 超时/中止用例覆盖，恰当）。`result_leavesNothing`（`:439`）snake_case 与仓库 camelCase 不一致。

**Merge verdict: OK with notes**（无 P0/P1）。

#### Spec（独立 reviewer 报告，原文）

**核对结果（通过项）**
- 决策一/三：`createContainedBash(pathGuard)` 吃 `pathGuardScopeFor` 产物（`lib/tool-path-guard.ts:79-87`），caller 只在 `pathGuard` 在场时装配，工具面（`bashContainmentExtension`）与 RPC 面（`lib/rpc/session.ts:775-780` 传同一 `operations`）同源；HTTP 路由均未传 `pathGuard` ⇒ 人类会话不沙箱。✓
- 决策二 allow-only：`(deny default)` + 数据目录 allow→deny→reopen home（`lib/bash-containment.ts` `sandboxExecProfile`，顺序即契约）。✓ 凭证负例有断言。✓
- 决策四/五/六：EPERM/134 归因 + 注册期描述带允许根；fail-closed 拒绝执行；`WORKSPLICE_*` 大小写不敏感一刀切、五 `PI_*` 保留（实测 pi 的 `resolveSpawnContext` 会塞回）。`lib/tool-presets.ts` 未动、档位名义构成不变。✓ Linux 未验证在文档与测试均照实标注。✓

**Finding**
- P1 `components/ChatInput.tsx:345,1110,2212` + `hooks/useAgentSession.ts:1856`：AC「档位展示能解释这件事」在运行期不可观测——`bashContainment` 只被 `ChatInput.test.mjs` 传过，仓库内无任何组件 import `ChatInput`。最小改法：接线到真实消费者，或在 Answer 明写「展示层为 dormant 组件、仅 get_state 可见」。
- P1 冒烟清单 AC（node/npm/git/**gh**）不成立：`lib/bash-containment-extension.test.mjs` 断言 `gh --version` 被拒（ADR 只拍板「不能 push/PR」，实测量级更强）。需改 AC 并登记凭证后续票。
- P1 `lib/bash-containment.ts` bwrap 清单：`--ro-bind` 未过滤不存在的源（`~/.bun`、`~/.npm-global`、`/lib32`、`/opt/homebrew` 类）——bwrap 对缺失源直接报错（SBPL 容忍），Linux 分支大概率每条命令都失败。改法：`fs.existsSync` 过滤或 `--ro-bind-try/--bind-try`。
- P2 「keychain 类不进清单」不严密：`toolchainCaches` 整目录收了 `~/.local`、`~/.cache`，Linux 的 `~/.local/share/keyrings` 在册（只读仍可读）。
- P2 `readOnlyFiles: ~/.gitconfig` 属用户级配置扩张，可含 token（insteadOf/extraHeader）。
- P2 注释称档位文案与工具描述「两处同源」，实为 i18n 串 vs `bashBoundaryText` 两套文本。
- P2 网络面理由已 stale：仍写「ADR-0012 决策六（秘书 curl 锁定）」；ADR-0013 决策五已裁定该理由消失、成员端口关闭为后续依赖，本票未登记。
- P2 票据正本未收敛：`.scratch/.../05-...md` 仍 `Status: claimed`、AC 全 `- [ ]`、Answer「（待填）」（本轮 diff 未含 `.scratch`，但仓库读得到）；`evidence/double-axis-review-05.workflow.mjs` 未跟踪。
- P2 `lib/rpc/caller.ts:54` 两条语句挤一行、`lib/rpc/session.ts:284` 删空行（风格，非语义）。

**Scope creep**：ChatInput/i18n/useAgentSession/pi-types/get_state 均属决策五明文范围，无越权。

**Merge verdict：BLOCK**（两条 AC 与实现对不上 + Linux 生成物可疑；均需改 AC/一行修复，无 P0）。

### findings 处置

| 轴 | finding | 处置 |
| --- | --- | --- |
| Spec P1 | 档位展示在运行期不可观测（ChatInput dormant、无消费者） | **记事（已论证）**：`ChatInput` 与 `useAgentSession` 在本仓当前无渲染点（`grep -rn "<ChatInput"` 为空，仅测试引用），所以档位解释在运行期没有触发路径。**模型面**的解释是活的（注册期工具描述带允许根与原因，集成层有断言）；展示面把数据接到 `get_state.bashContainment` → hook → 组件（含 title 与菜单两项，有 2 条单测），一旦该 UI 复活即生效。契约面（`get_state`）可观测、有断言 |
| Spec P1 | 冒烟清单里 gh 不成立 | **已改 AC + 登记后续票输入**：AC 改为「node/npm/git/bun 成功 + gh 是可归因的拒绝」，实测修正写进「实测修正」第 1 条与本文件 AC 行；每成员凭证是决策二已写明的后续票输入 |
| Spec P1 | bwrap `--ro-bind` 未过滤缺失源 | **已修**：改用 `--ro-bind-try` / `--bind-try`（缺失源被容忍），纯函数层断言随之更新 |
| Spec P2 | `~/.local` 可能在册 Linux 密钥环 | **已修**：`toolchainCaches` 去掉 `~/.local`，纯函数层新增负例断言 |
| Spec P2 | `~/.gitconfig` 可能含 token | **记事（判断）**：冒烟清单要求 `git` 可跑，实测它启动即要读该文件；以**单文件 literal** 开口（不是家目录）并在本文「实测修正」第 4 条登记为残留风险，正解=每成员 gitconfig（同凭证后续票） |
| Spec P2 | 「两处同源」措辞不准 | **已修**：注释改为「同一事实的两处呈现」 |
| Spec P2 | 网络面理由 stale（决策六 → 决策五） | **已修**：profile 生成器注释改指 ADR-0013 决策五（成员面封端口是后续票的依赖，本票只登记） |
| Spec P2 | 票据正本未收敛 / workflow 脚本未跟踪 | **已修**：本文件（AC 勾选 + Answer + Status: resolved）；`evidence/double-axis-review-05.workflow.mjs` 随后续提交入库 |
| 两轴 P2 | `caller.ts:54` 两语句挤一行 / `session.ts` 删空行 | **已修**：两处恢复原样 |
| Standards P2 | i18n 拼接翻译片段 | **已修**：改为参数化整句 `chat.toolPresetWithBashNote`（`{preset}` 是参数），分隔符与语序由语言包决定；测试断言整句形态 |
| Standards P2 | `BashContainmentNotice` 复刻 `BashContainmentStatus` / `mechanism`·`reason` 无人读 | **部分修 + 记事**：`containmentStatus` 的派生已移进纯函数层（`lib/bash-containment.ts`），装配模块不再持有状态派生；客户端仍是**线上形状**的独立声明（跨 server/client 边界，`mechanism` 放宽为 `string` 是有意为之）。`mechanism`/`reason` 保留在 `get_state` 输出里：它们正是「为什么没有 bash」的原始事实，展示层与排障都要 |
| Standards P2 | `execInSandbox` 逐字段再传 `ContainedBash` | **已修**：改为整对象传参（`contained`） |
| Standards P2 | 镜像 pi 的进程监督会随 SDK 升级漂移 | **记事**：注释逐条注明出处（`dist/utils/shell.js`、`dist/utils/child-process.js`、pi#5303），并有 timeout / abort / 134 的集成断言作回归锚点 |
| Standards P2 | `result_leavesNothing` snake_case | **已修**（改名 `leavesNoCredentialEntries`） |
| 工具报 | `lib/rpc/session.ts` 10 条既有 lens 发现（chained assertion / `as unknown as` 缺注释） | **不改（本票范围外，已取证）**：`evidence/preexisting-lens-findings-05.txt` 证明被标记行 10/10 逐字存在于固定点 `8a05a6d`；本票对该文件的改动 23 增 / 1 删（零断言）；仓库门禁 `tsc --noEmit` 与 `npm run lint` 均 0 error。改这些既有断言会把 diff 扩到与本票无关的会话生命周期代码上（派活规则 #2），同一处置在票 02（PR #94）已有先例 |

### 机械判据自检

```bash
git status --porcelain                              # 空
git diff 8a05a6d...HEAD --numstat                   # 无四位数以上单文件（最大 = 集成测试 443 行；证据文件均为汇总）
gh pr list --head whutlichao/sandbox-for-member-bash --json number,state   # [{number: 97, state: "OPEN"}]
```

PR：**#97** https://github.com/whutlichao/worksplice/pull/97
