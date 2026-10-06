# 01: 新 worktree 里 agent 用 `npm install` 装依赖、绕过 `bun.lock`，制造假回归信号

**What to build:** 让「装依赖」这条路在新 worktree 里也走仓库的权威锁（`bun install`），并决定如何处置由此
暴露的 7 条 `react-hooks/preserve-manual-memoization`。**目标不是消灭那 7 条本身，而是让任何 worktree 里的
「改前基线 / 改后结果」可比、可信**——现在同一提交、两套依赖，门禁结论取决于谁装过什么。

## 事实（2026-10-06 实测，PR #90 一轮）

#### ① 同一提交、两套版本

| 环境 | eslint-plugin-react-hooks | react | eslint | 全仓 `npm run lint` |
| --- | --- | --- | --- | --- |
| `main`（bun 装的 node_modules，与 `bun.lock` 一致） | **7.0.1** | 19.2.4 | 9.39.4 | **1 problem**（0 err / 1 warn） |
| 新 worktree（装依赖之后） | **7.1.1** | 19.3.0 | 9.39.5 | **8 problems**（7 err / 1 warn） |

**② 7 条 errors 全在与任何在办票无关的文件上**：`components/ChatInput.tsx`（6 条）+
`hooks/useAgentSession.ts`（1 条），规则 `react-hooks/preserve-manual-memoization`
（"Compilation Skipped: Existing memoization could not be preserved"）；另 1 条 warning 是既有的
`hooks/useI18n.tsx:61`。

**③ 依赖边是 caret 范围**：`eslint-config-next@16.2.12` → `eslint-plugin-react-hooks: ^7.0.0`，
所以 `7.0.1 → 7.1.1` 是范围内的正常解析，不是谁写错了版本号。

#### ④ 归因（已取证，非推测）

- Orca 的「工作树钩子 → 设置脚本」内容是 **`codegraph init`**（用户 2026-10-06 截图确认）——**与依赖无关**；
- 真正执行安装的是 **worker 自己**：会话日志
  `~/.pi/agent/sessions/--Users-apple-orca-workspaces-worksplice-msg-actionbar-convert-task--/*.jsonl`
  里，bash 工具三次调用的原文均为 `cd <worktree> && npm install --no-audit --no-fund`，
  自述「npm install succeeded (716 packages, tsc available)」；
- 副产物吻合：该 worktree 里出现了被 `.gitignore` 忽略的 `package-lock.json`（`main` 里没有）。

**⑤ 为什么 agent 会选 npm**：仓库面向 agent 的文档通篇是 npm（`AGENTS.md:38` `npm run dev`、
typecheck/lint/test 也全是 `npm run …`），而 `README.md:68` 说可复现路径是 `bun install`、并明写
npm「ignores `bun.lock` and does not guarantee a reproducible dependency tree」。两条指引都真实存在，
agent 在空 worktree 里自然伸手去拿更"顺手"的那条。

**⑥ 为什么不怪 agent**：这不是某个 worker 的失误——**同一份文档喂给任何 agent 都会走到同一个选择**，
而且失败是静默的（装完照样能跑测试，只是版本变了）。

## 已验证的修法（本票实测）

干净 worktree 里跑 `bun install --frozen-lockfile`：

```text
1044 packages installed [7.93s]                                    # exit 0
eslint-plugin-react-hooks 7.0.1 / react 19.2.4 / eslint 9.39.4     # 与 main 逐字一致
（未生成 package-lock.json）
```

对照 `npm install`：7.1.1 / 19.3.0 / 9.39.5 + 生成 `package-lock.json`。⇒ 走 bun 即可消除漂移
（本机 `bun --version` = 1.3.14，满足 `README.md:68` 的 ≥1.3.14 要求）。

## 建议处置（triage 决定）

- **(a) 文档层（推荐；最小、已验证）**：在 `AGENTS.md` 的 Quick Start 里补一条安装纪律——
  「装依赖用 `bun install`（可 `--frozen-lockfile`）；不要 `npm install`，它忽略 `bun.lock`」。
  `npm run <script>` 本身无害（不改依赖树），可保留不动。
- **(b) 仓库级守卫（更硬，推荐与 (a) 一起做）**：`package.json` 加 `"packageManager": "bun@1.3.14"`，
  并加 `preinstall` 守卫脚本：检测到 `npm_*` 环境变量且 `bun.lock` 存在 → 直接失败并给出指引。
  理由：(a) 靠自觉，(b) 才挡得住下一个不知道这条纪律的 agent/人。
- **(c) 接受这次升级**：在 `main` 上显式升级 `eslint-config-next` / `eslint-plugin-react-hooks`，
  重生成 `bun.lock`，并**一次性处置**那 7 条（改掉两处手写 memo，或在 `eslint.config.mjs` 里就事论事地豁免）。
  代价：牵动两个与本次发现无关的文件。
- **兜底（无论选哪条都该保留）**：门禁基线必须**同依赖环境**取——`git worktree add` 一个 BASE 临时 worktree，
  把它的 `node_modules` 软链到**被测 worktree** 的那一份，再各跑一次 lint/tsc。

## 影响

1. **门禁基线不可比**：改前基线若取自 `main` 的旧 `node_modules`、改后取自 worktree，会得到
   「1 → 8 problems」这种假增量。本轮真的发生过——一度被读成「本票引入 7 条 lint 错误」，
   靠「同一 worktree 依赖环境下取改前/改后」才证伪。
2. **假回归信号会把人和 agent 引向错误方向**：reviewer 或后续 worker 可能去"修"这三处与在办票无关的既有代码。
3. **反向不可复现**：如果谁真在这套新插件下「修」了那 7 条，在 `main`（旧插件）上又看不到问题。

## 非目标

- 不在本票顺手改 `ChatInput.tsx` / `useAgentSession.ts` 的 memo 写法：改不改取决于 (c) 是否被选中。
- 不改 `README.md:68`：它描述的是事实，不是缺陷。
- 不把 Orca 的设置脚本当缺陷：它是 `codegraph init`，与依赖无关（见 ④）。

**Blocked by:** None — 需要的是 triage 裁决，不是前置工作。
**Type:** implementation
**Status:** resolved

## Comments

- 2026-10-06 由 coordinator 在收口 PR #90 时提交（该轮验收报告
  `~/.pi/agent/projects-memory/worksplice/orchestra/2026-10-06-msg-actionbar-convert-task.md` §4.2 记录同一发现）。
- 2026-10-06 **更正归因**：初版把责任判给「Orca 的 worktree setup 跑 npm install」——**错**。
  用户给出设置脚本截图（内容为 `codegraph init`）后，改按会话日志取证，判为「agent 自己跑了
  `npm install`」。保留这条更正记录：这类漂移最容易被误判成基础设施问题，而正确的第一步是查**谁真的执行了安装**。
- 2026-10-06 补测：`bun install --frozen-lockfile` 在干净 worktree 里产出与 `main` 完全一致的版本
  （7.0.1 / 19.2.4 / 9.39.4），据此把 (a) 从"推测"升为"已验证"。
- 2026-10-06 **范围裁决（coordinator 人定，非代答）**：(1) `README.zh-CN.md:68` 作为 `README.md:68` 的逐字镜像一并纳入本票 Target，双语逐句对应；(2) 验收 4a 里「不得落下 `package-lock.json`」半条按实测删除（npm 11 无 pre-reify 钩子，逐字不可达），现为「非零退出 + 输出含 `bun install` + 不再静默」三条。本票正文「非目标：不改 `README.md:68`」由此被取代——原文保留不改，本记录即范围变更凭据。

## Answer

**PR:** #PR_NUMBER_PLACEHOLDER　**分支:** `whutlichao/bun-install-guard`　**提交:** `7fabb02`（守卫 + 文档 + 首版用例）、`9c14814`（review 后补入口缝隙用例）

### 1. 结论

安装纪律落地为软硬两层：文档把「用 bun 还是 npm」写成可执行的一条纪律，`preinstall` 守卫把违规从「静默装错」变成「响亮失败」。**守卫是止损不是预防**——npm 11 的 root preinstall 在 `arborist.reify` 之后才跑，所以 `npm install` 仍会先写出 `package-lock.json`（干净树里还会先装入 npm 解析的漂移版本），随后才被守卫拒绝；残留副作用会被下一次 `bun install --frozen-lockfile` 自愈（§6）。这条时序事实是本轮最重要的新发现，见 §6，供后续票决策。

### 2. 改了什么（`git diff --name-only c88ad87..HEAD`）

```text
AGENTS.md
README.md
README.zh-CN.md
bin/install-guard.js        (新增, 51 行)
lib/install-guard.test.mjs  (新增, 104 行)
package.json
```

`git diff --numstat c88ad87..HEAD`：`2/0`、`1/1`、`1/1`、`51/0`、`104/0`、`2/0`——没有整份重写。

- **A 文档纪律**：`AGENTS.md` Quick Start 首行加一条安装纪律（`bun install`（可 `--frozen-lockfile`）/ **不要 `npm install`**（忽略 `bun.lock` → 版本漂移、门禁基线不可比，指向 `.scratch/worktree-dep-drift/`）/ `npm run <script>` 不受影响）。`README.md:68` 与 `README.zh-CN.md:68` 的「`npm install` also works / 也能跑」改为「源码 checkout 里 `npm install` 会被安装守卫（`preinstall`）拒绝并指引改用 `bun install`；脚本仍可 `npm run <script>` 运行」，Bun ≥ 1.3.14 那半句原样保留，中英逐句对应。
- **B 守卫**：`package.json` 加 `"packageManager": "bun@1.3.14"` 与 `"preinstall": "node bin/install-guard.js"`；`bin/install-guard.js` 自包含 CJS（只 `require` node 内建 `fs`/`path`，不碰 `lib/`、`scripts/`——两者都不在 `files` 白名单里），导出纯判定 `isInstallBlocked({ userAgent, initCwd, hasBunLock, packageRoot })` 与 `getBlockedInstallMessage()`，作为入口执行时打印指引并以 1 退出。四条规则全按 dispatch：只看 `npm_config_user_agent` 的 `npm/` **前缀**（bun 也设一堆 `npm_*` 变量）、无 `bun.lock` 放行（消费端 tarball）、`INIT_CWD` 存在且 ≠ 包根放行、其余拦。
- **用例**：`lib/install-guard.test.mjs` 落在 `npm test` 的 `lib/**/*.test.mjs` glob 内，12 条 = 9 条判定矩阵 + 1 条消息关键字 + 2 条入口缝隙（真实 env 名 + 退出码 + stderr）。

### 3. TDD 红 → 绿

红（实现前，`node --test lib/install-guard.test.mjs`，exit 1）：

```text
code: 'MODULE_NOT_FOUND', requireStack: [.../lib/install-guard.test.mjs]
✖ failing tests:
test at lib/install-guard.test.mjs:1:1
✖ lib/install-guard.test.mjs (51.349333ms)
RED exit=1
```

绿（实现后同命令，exit 0）：`ℹ tests 10 / pass 10 / fail 0`（补齐入口缝隙后为 `tests 12 / pass 12 / fail 0`）。

### 4. 端到端四条（本 worktree，真命令）

| 步 | 命令 | 结果 |
| --- | --- | --- |
| a | `npm install --no-audit --no-fund` | **退出 1**；输出含四行指引（可 grep `bun install` / `bun.lock` / `npm install`）；`npm error command sh -c node bin/install-guard.js`。按裁决 4a 不计 `package-lock.json`（§6 说明为何逐字不可达） |
| b | `bun install --frozen-lockfile` | **退出 0**；版本与 main 逐字对齐 **7.0.1 / 19.2.4 / 9.39.4**；实测 bun 会调用根 preinstall（输出含 `$ node bin/install-guard.js`）且守卫放行 → 规则 1 在真实路径上成立 |
| c | `npm run typecheck` / `npm run lint` | `tsc --noEmit` 退出 0；`eslint .` 退出 0，仅 1 条既有 warning（`hooks/useI18n.tsx:61`）——preinstall 不参与 `run`，日常流程未破 |

`npm run lint` 的输出里没有 `$ node bin/install-guard.js`，即 **`npm run <script>` 确实不触发守卫**（文档承诺的可执行证据）。

### 5. 消费者安全（关键反例）

a. `npm pack` 产物含守卫：`tar -tzf worksplice-0.1.0.tgz | grep install-guard` → `package/bin/install-guard.js`；同一产物的 `bun.lock` 出现次数 = **0**（规则 2 的前提被实测证实：消费端包根不存在 `bun.lock`）。

b. `/tmp/consumer-bun-install-guard` 里 `npm install <tgz 绝对路径>` → **退出 0**、`added 272 packages`、`node_modules/worksplice/bin/install-guard.js` 存在、版本 0.1.0。

c. 额外取证（因为 npm 11 新引入 install-scripts allowlist，tarball 的 preinstall 默认**不执行**，只 warn——所以 b 步本身没真正跑到守卫）：直接按 npm 的调用方式跑打包后的守卫，`cwd=node_modules/worksplice`、`INIT_CWD=消费者根`、`npm_config_user_agent=npm/11.19.1 …` → **退出 0**（放行）；同一命令在源码 checkout（`INIT_CWD`=包根）→ **退出 1** + 指引。两种上下文行为分离，消费端不被误伤。

### 6. npm 时序事实（本票核心发现，供后续票决策）

```text
npm 11.19.1 / node 25.0.0 源码 npm/lib/commands/install.js:
  await arb.reify(opts)                     ← 先把依赖树落地并写出 lockfile
  if (!args.length && !isGlobalInstall && !ignoreScripts) {
    const scripts = ['preinstall', 'install', 'postinstall', ...]   ← 根 preinstall 在这里才跑
```

干净目录探针 `/tmp/guard-probe/`（只有 `bin/install-guard.js` + `bun.lock` + 一个 caret 依赖 `eslint-plugin-react-hooks: ^7.0.0`）跑 `npm install`：**退出码 1**、指引照常打印，但 `node_modules` 已被 reify 装成 npm 解析的 **7.1.1**（正是本票 §① 里制造 7 条假 error 的那个版本）、`package-lock.json` 也已写出。⇒ **守卫=止损不是预防**：它保证「不再静默」（原文 ⑥ 的核心病），但挡不住 reify 已经落下的字节。

本 worktree 同一现象（bun 树版本已满足 caret 范围，故 `node_modules` 版本未变）：`NPM_INSTALL_EXIT=1`，`package-lock present: YES`（399 KB，`.gitignore` 排除），`before/after` 版本均 7.0.1 / 19.2.4 / 9.39.4。

自愈路径（实测）：事后 `bun install --frozen-lockfile` → 首次 `2 packages installed [273.00ms]`、复跑 `Checked 1081 installs across 1144 packages (no changes)`，两次均退出 0，版本回到 7.0.1 / 19.2.4 / 9.39.4。交付前已删除本轮探针留下的 `package-lock.json` 与 `demo/`（`npm pack` 的 prepack 产物）。

### 7. 宽档全量与格式门禁（同依赖环境）

- **全量**：`npm test` → `ℹ tests 941 / pass 941 / fail 0`。基线实测：BASE worktree（`/tmp/big-base` = `c88ad87`，`node_modules` 软链到本 worktree 同一份）→ `ℹ tests 929 / pass 929 / fail 0`。**929 + 12（本票新增用例）= 941**，与预测逐条吻合。
- **tsc**：`npm run typecheck` 退出 0。
- **lint 增量（同依赖环境）**：BASE（`/tmp/big-base`，同 `node_modules`）1 problem（0 err / 1 warn，`hooks/useI18n.tsx:61`）；本 worktree 1 problem（0 err / 1 warn，同一条）。**新增 0 个 problem**（两个新文件各 0）。跨环境对照（main 的旧 `node_modules`）未使用。

### 8. 双轴 code-review（原文，不合并不重排）

两轴由两个 fresh-context 只读 `reviewer` 子代理并行跑在 `c88ad87...HEAD` 上，证据日志路径已随报告给出。

#### Standards

> ## Review
>
> **Correct**：测试落位 `lib/` 与 `lib/node-version.test.mjs` 同构并被门禁 `**` glob 自动纳入（09/07 证据：929→939，0 fail）；`node:test`+`assert/strict` 零依赖、注释简体中文、对外消息英文，符合 docs/engineering-standards.md §1/§2.1。
>
> **Finding: P1 流程纪律 — 票据未收敛（docs/engineering-standards.md §5「每个 ticket 结束留可验证产物…结论写进 map.md」；AGENTS.md 派活策略「worker 全权负责本票文件（Status → resolved + append Answer）」）**
> 证据：`.scratch/worktree-dep-drift/issues/01-npm-install-bypasses-bun-lock.md` 仍是 `**Status:** needs-triage`，无 Answer/证据链小节；`.scratch/worktree-dep-drift/` 下无 `map.md`；本 diff 的 6 个文件不含该票据。限制：无法运行 git，不能排除后续 commit 收敛。最小修：本票 commit 改 Status 并附 Answer（红绿 01/02、e2e 03/04、bun 05、pack/consumer 10/11、门禁 06/07、929→939）。
>
> **Finding: P2 引号与文档冲突 — §1「字符串统一单引号（eslint 默认）」**，而 `bin/install-guard.js:4,6,10,11,25-28`、`lib/install-guard.test.mjs:8,15-50` 全用双引号。`eslint.config.mjs` 未配 quotes 规则，故门禁放行；基线（`bin/demo-data.js:16-21`、`bin/worksplice-options.js:4`、`lib/node-version.test.mjs:1-9`）同样双引号 —— 需择一：改代码或回填该条文档（本 diff 不是唯一违反者）。
>
> **Finding: P2 票据非目标越界**：票据「非目标」明写「不改 `README.md:68`」，但 `README.md:68` 与 `README.zh-CN.md:68` 均被改写提及守卫。内容无害，但需 coordinator 追认或回填票据。
>
> **Finding: P2 只测注入缝，未测入口（§2.1「只测外部行为」）**：`main()` 的 env 名（`npm_config_user_agent`/`INIT_CWD`）、`PACKAGE_ROOT`、退出码 1 无任何 committed 断言 —— 改坏 env 名时 10 条测试仍全绿。最小修：加一条 spawn `node bin/install-guard.js` 断言 exit 1 + stderr。
>
> **Baseline smells（judgement calls）**
> - Duplicated Code：同一纪律四份副本 —— `bin/install-guard.js:25-28` 消息与 `AGENTS.md:37`、`README.md:68`、`README.zh-CN.md:68` 逐点重复；改规则要散改 4 处。最小修：守卫消息收敛为「指引 + 指向 AGENTS.md」。
> - Data Clumps / 常量重复：`isInstallBlocked` 四字段（`bin/install-guard.js:14`）在 `lib/install-guard.test.mjs:62` 靠 `{...input, packageRoot: PACKAGE_ROOT}` 补位，matrix 每行都省同一字段，且 `:8` 另写一份字面量而生产侧由 `__dirname` 推导（`bin/install-guard.js:8`）。最小修：签名默认 `packageRoot = PACKAGE_ROOT`。
> - Mysterious Name：`MATRIX`（`lib/install-guard.test.mjs:12`）不自述，`INSTALL_CASES` 更诚实。
>
> **Merge verdict: OK with notes**（无 P0；P1 仅为票据收敛，若后续 commit 补齐即降为 OK）。

#### Spec

> ## Review（SPEC 轴）
>
> **改动面核对**（逐文件对照主 worktree 的对应文件；`watchdog_diff` 只覆盖工作区，工作区干净、无未提交改动）：六个允许文件外未见多余改动。`package.json` 仅新增 `"packageManager": "bun@1.3.14"` 与 `"preinstall": "node bin/install-guard.js"`；`README.md:68` / `README.zh-CN.md:68` 仅该行改写（主 worktree 该行为旧文案 "npm install also works"）；`AGENTS.md:37` 仅新增安装纪律一行（`AGENTS.md:27/33` 的 `LANGUAGE_START` 标记异常在主 worktree 已存在，非本提交引入）。
>
> **(a) 缺失/部分——无阻塞项。** 四项决策规则、`"use strict"` + 纯 CJS（仅 require fs/path，未引 `lib/`、`scripts/`）、导出纯谓词、入口执行打印指引并非零退出、错误信息英文 + 注释中文、样式与 `bin/node-version.js`/`bin/*.js` 的 `eslint-disable ... no-require-imports` 惯例一致，均符合 dispatch。测试在 `lib/**/*.test.mjs` glob 内，覆盖 9 条矩阵 + 1 条消息断言；证据 `07-full-test-new.txt` 939 pass / `09-base-test.txt` 929 pass = 恰好 +10。验收修订后三步由 `03-npm-install-raw.txt`（exit 1 + 四行指引）、`03-e2e-npm.txt`（NPM_INSTALL_EXIT=1）满足；消费者路径 `11/12` 证明 tarball 安装与 bun 路径（`05-bun-ok.txt`，preinstall 被 bun 调用且 exit 0）未被误伤。
>
> **(b) 越界——无。** 票据 `非目标`「不改 `README.md:68`」确与本次交付冲突（README.md:68 已改），但 dispatch 已取代它，且票据 Status/Answer 收敛是本任务后续步骤 → 仅备注，不作缺陷。
>
> **(c) 实现可疑处（均为 P2，非阻塞）**
> 1. 文档真话度：README.md:68「`npm install` … is refused by the repository's install guard (`preinstall`)」与守卫消息「`npm install` is blocked here」读起来像"未生效"，但守卫是止损——npm 在 `arborist.reify` 之后才跑根 preinstall，证据 `03-e2e-npm.txt` 显示 `package-lock present: YES`、node_modules 725 包，同时 exit=1。对应 dispatch 修订：「a preinstall-only guard cannot prevent the lock file or a partial reify」。最小修法：两版 README 与守卫消息各加一句「npm 已写出 package-lock.json、可能已改动 node_modules——本守卫是止损而非预防」。措辞由 dispatch 逐字指定，是否改写属 coordinator 决策。
> 2. 规则 3 的固有缺口（按 spec 原样实现）：子目录 `npm install`（`INIT_CWD` ≠ 包根）与 `--ignore-scripts` 均可绕过，属残差风险而非本 diff 缺陷。
>
> **Merge verdict: OK with notes.**

### 9. Review findings 处置

**已修（`9c14814`）**

- Standards P2「只测注入缝，未测入口」→ 补 2 条 spawn `node bin/install-guard.js` 用例（npm 形 agent ⇒ 退出 1 且 stderr 含 `bun install`；bun 形 agent ⇒ 退出 0 且不打印），锁定 env 名、包根推导与退出码。说明：入口行为实现先于该用例，这两条不是红绿产物而是 review 驱动的回归用例（诚实标注）。
- Standards「Mysterious Name：`MATRIX`」→ 改名 `INSTALL_CASES`；顺带把夹具根拆成 `FIXTURE_ROOT`（合成）/ `PACKAGE_ROOT`（真实，由 `__dirname` 推导）。

**有据豁免**

- Standards P2 引号（§1 写「统一单引号」）→ 仓库事实是双引号：`bin/node-version.js` 4 双/0 单、`bin/demo-data.js` 17/1、`bin/worksplice-options.js` 17/0、`lib/node-version.test.mjs` 17/0；`eslint.config.mjs` 未配 `quotes`，`npm run lint` 不约束引号。新文件按邻近既有文件写，符合「与既有仓库语言保持一致」的更强约束；该文档行陈旧，本票不夹带回填（记为后续候选）。
- Standards「Duplicated Code：纪律四份副本」→ 守卫消息的关键字与三句内容由 dispatch 逐字指定（`bun install` / `bun.lock` / `npm install` / `npm run <script>` 都要可 grep），且四个读者面不同（命令行 / AGENTS.md 面向 agent / 两版 README 面向人）；消息末行已指向 `AGENTS.md` 收敛。
- Standards「Data Clumps：`{...input, packageRoot}` 每行补位」→ 判定矩阵刻意用**合成**夹具根构造「尾部斜杠等价」「`INIT_CWD` 非包根」用例；若默认成真实包根，这些用例不可控。生产侧包根由 `__dirname` 推导，与测试夹具不是同一事实的重复。
- Spec P2 文档真话度 → README 措辞由 dispatch 逐字指定，coordinator 范围裁决另明「守卫脚本自身与文档两处不用改行为」；命令层面「被拒绝」为真（退出码非零）。时序细节（止损而非预防）按裁决写进本 Answer §6，供后续票决策。
- Spec P2 规则 3 缺口 → 按 dispatch 四条规则逐字实现，未扩规则；作为残差风险记入 §11。
- Standards P1 票据未收敛 / P2 非目标越界 → 报告写作时票据尚未提交；本次 Status 收敛 + 本 Answer + `## Comments` 的范围裁决记录即处置。`map.md` 不在本票范围（非目标）。

### 10. 决策记录（Q → A(人定) → 理由）

- Q `README.zh-CN.md:68` 是否纳入？→ **A：纳入**（coordinator 问回用户得到，非代答）→ 理由：它是 `README.md:68` 的逐字镜像，同一句不实陈述在中文正本里同样为假；仓库 Language 纪律以中文正文为准。
- Q 验收 4a「不得落下 `package-lock.json`」是否可达？→ **A：删除该半条**，改述为「非零退出 + 输出含 `bun install` + 不再静默」，不扩形态、不新增 Target 外文件 → 理由：npm 无 pre-reify 钩子（§6 实测），逐字不可达；守卫的真实价值是止损与响亮失败。
- Q 是否顺手回填 `docs/engineering-standards.md` §1 的引号陈述？→ **未做**（越出 Target）→ 理由：本票 Target 六文件已定，规则服从最小改动；记为后续候选。

**调用点清点（本票改动面）**：`package.json` 的 `scripts.preinstall` 是守卫唯一生产调用点（`npm install` / `bun install` 都会跑）；`packageManager` 是声明式元数据，无调用点；`npm run <script>` **不**触发 preinstall（§4 实测）；消费端因 `bun.lock` 不随包分发 + `INIT_CWD` 指向消费者根 + npm 11 install-scripts allowlist 三重原因不会命中守卫。

### 11. 残留风险与非目标

- **规则 3 的缺口（spec 原样）**：`INIT_CWD ≠ 包根` 即放行 ⇒ 从子目录执行 `npm install`、或加 `--ignore-scripts`，都能绕过守卫并造成漂移。未扩规则（dispatch 明定四条）。
- **阶段限制**：preinstall 晚于 reify ⇒ 止损不是预防（§6）。漂移最迟在下一次 `bun install --frozen-lockfile` 时自愈。
- **消费端**：npm 11 的 install-scripts allowlist 让 tarball 的 preinstall 默认不执行（实测 warn `worksplice@0.1.0 (preinstall: node bin/install-guard.js)`），守卫在消费端因此不参与判定——已按「守卫在消费者 cwd/`INIT_CWD` 下退出 0」单独取证（§5c）。
- **非目标（未动）**：`ChatInput.tsx` / `useAgentSession.ts` 的 memo 写法、`eslint-plugin-react-hooks` 版本、`promote-worksplice/`。

