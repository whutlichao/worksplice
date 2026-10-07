# 01-fix-edge-instrumentation-warnings

Type: implement
Status: resolved
Assignee: worksplice-dev (worker term_3dac0866-88e6-4924-9bb8-2bf634a414d7)
Blocked by: （无）
Closes: GitHub #101

## Problem Statement

`npm run dev` 每个请求周期刷一组 Next Edge Runtime 警告（`not supported in the Edge Runtime`），
共 5 条 × 2 轮 = **10 条**：`instrumentation.ts:53` 的 `process.exit`，加上
`lib/access-gate.ts` 的 `node:net`/`node:os`/`node:timers/promises` 与连带的
`lib/web-auth.ts` 的 `node:crypto`。功能无碍（请求全 200），纯噪音。

根因：Next 把 `instrumentation.ts` 与 middleware 归进同一个 edge layer **无条件双编译**
（`next/dist/build/entries.js` 的 edgeServer 分支），那一遍扫的是
**静态 import 图 + 文件体本身**，不认 `register()` 里的 `NEXT_RUNTIME` 运行时守卫。

## Solution

F1 最小面（维护者裁定）：准入闸的启动期逻辑整体搬进新模块
`lib/access-gate-startup.ts`，`instrumentation.ts` 在 `NEXT_RUNTIME` 守卫**之后**
动态 `await import("@/lib/access-gate-startup")`。

`lib/access-gate.ts` 判定层本体一字未动（`git diff d26cdf1 -- lib/access-gate.ts proxy.ts` 为空）。

## Implementation Decisions

1. **为什么必须连 `process.exit` 一起搬**：只把 import 改成动态是不够的——
   `process.exit` 写在 `instrumentation.ts` 的**文件体**里（模块顶层函数
   `enforceAccessGateAtStartup`），edge 那遍编译不看运行时可达性，照样报。
   红证据里 `⚠ ./instrumentation.ts:53:5 — A Node.js API is used (process.exit …)`
   与 import 链无关，它就是文件体本身。
2. **新文件路径选 `lib/access-gate-startup.ts` 而非 dispatch 建议的
   `lib/access-gate/startup.ts`**（dispatch 原文「路径由你定」）：
   同一个模块的名摊在一个文件和一个同名目录上会让 locality 变差、两个 import
   路径指同一个概念；而 `lib/` 下既有单职责模块一律扁平 kebab-case
   （`lib/agent-status.ts`、`lib/agent-lifecycle.ts`、`lib/bash-containment.ts`）。
3. **两处写「合并回去警告就回来」的告警注释**：拆分的理由不在代码形状里，
   在构建器的行为里；不写下来下一个「顺手清理」的人会把 `process.exit` 挪回来。
4. **迁移保真**：两个被搬走的函数**逐字未改**（只给 `enforceAccessGateAtStartup` 加了 `export`），
   这是「行为不变」最硬的证据形式。核对命令见第 6 节。

## Testing Decisions

见 spec.md「Testing Decisions」。票内分两层，各自说清：

- **一次性端到端证据**（`evidence/repro.sh`，红 10 / 绿 0）：起真 dev server 数警告条数。
- **常驻防线**（`lib/access-gate-startup.test.mjs`，6 条源码级断言）：锁构建期形状，
  毫秒级、不占端口、不起 server，被 `scripts.test` 的 `lib/**/*.test.mjs` glob 自动纳入。

## Out of Scope

见 spec.md「Out of Scope」。本票**未**触碰：`lib/access-gate.ts`、`proxy.ts`、
ADR-0013 的 fail-closed 语义。

## Comments

- 2026-09-30 开工。coordinator 在 main 上已取证机制与传递链，本 worker
  按 dispatch 要求**自己先跑了一遍必红命令**（10 条）才动手。
- 2026-09-30 双轴 code-review 的 Standards 轴报了一条 hard finding
  （`docs/engineering-standards.md` §2.1「改动带回归测试是硬性要求」与本票两文件上限冲突），
  经 `ask` 请 coordinator 裁定：**选 A**——第三个文件 `.test.mjs` 获授权，
  AGENTS.md 登记由 coordinator 在 main 上直补（全局治理文档不归 worker）。
  裁定与澄清已落地在 `## Answer` 第 7 节。

## Answer

### 1. 红绿证据（一次性，端到端）

同一份脚本、同一端口、同一命令：`evidence/repro.sh`（`npm run dev -- -p 30199`）。
**为什么要带 `-p`**：`npm run dev` 固定 `-p 30142`，而 main 上有一个 dev server 占着 30142
（coordinator 只读，不许抢）。`npm run dev -- -p <port>` 是同一条 npm 脚本、命令行只多了端口覆盖，
红绿两遍逐字相同，可比。脚本会先 `rm -rf .next/dev` 保证警告是本次启动产生的，
等 `Ready in` → `GET /` + `GET /api/sessions` → 关停 → 计数。退出码语义：`>0 → 1`，`=0 且 200 → 0`。

**红**（改动前，`git checkout d26cdf1 -- instrumentation.ts` 后跑）：

```text
$ .scratch/edge-instrumentation-warnings/evidence/repro.sh \
    .scratch/edge-instrumentation-warnings/evidence/red-dev.log 30199
port=30199  ready=1  http(GET /)=200
edge-warning-count=10
```

前 3 段原文（完整日志见 `evidence/red-dev.log`，191 行）：

```text
○ Compiling / ...
⚠ ./instrumentation.ts:53:5
A Node.js API is used (process.exit at line: 53) which is not supported in the Edge Runtime.
    Learn more: https://nextjs.org/docs/api-reference/edge-runtime
  51 |   if (posture === "closed") {
  52 |     console.error(`[worksplice] ${accessGateClosedMessage()}`);
> 53 |     process.exit(1);
     |     ^^^^^^^^^^^^
Ecmascript file had an error

⚠ ./lib/web-auth.ts:1:1
A Node.js module is loaded ('node:crypto' at line 1) which is not supported in the Edge Runtime.
    Learn More: https://nextjs.org/docs/messages/node-module-in-edge-runtime
>  1 | import { createHash, timingSafeEqual } from "node:crypto";
Ecmascript file had an error

Import trace:
  Edge Instrumentation:
    ./lib/web-auth.ts
    ./lib/access-gate.ts
    ./instrumentation.ts

⚠ ./lib/access-gate.ts:16:1
A Node.js module is loaded ('node:net' at line 16) which is not supported in the Edge Runtime.
    Learn More: https://nextjs.org/docs/messages/node-module-in-edge-runtime
  14 |  */
  15 |
> 16 | import { createConnection } from "node:net";
     | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  17 | import { networkInterfaces } from "node:os";
  18 | import { setTimeout as delay } from "node:timers/promises";
  19 | import { isWebPasswordEnabled } from "./web-auth.ts";
Ecmascript file had an error

Import trace:
  Edge Instrumentation:
    ./lib/access-gate.ts
    ./instrumentation.ts
```

10 条 = 5 个不同来源（`instrumentation.ts:53` / `web-auth.ts:1` / `access-gate.ts:16,17,18`）× 2 轮。

**绿**（改动后，同一条命令）：

```text
$ .scratch/edge-instrumentation-warnings/evidence/repro.sh \
    .scratch/edge-instrumentation-warnings/evidence/green-dev.log 30199
port=30199  ready=1  http(GET /)=200
edge-warning-count=0

▲ Next.js 16.2.12 (Turbopack)
- Local:         http://127.0.0.1:30199
✓ Ready in 352ms

 GET / 200 in 468ms (next.js: 41ms, proxy.ts: 80ms, application-code: 347ms)
 GET /api/sessions 200 in 2.1s (next.js: 38ms, proxy.ts: 1969µs, application-code: 2.0s)
```

**条数 = 0，无残留**（`evidence/green-dev.log` 12 行全文可查）。两条命令退出码分别是 1 / 0。

### 2. 行为未变（不是只靠代码阅读，是实测）

loopback 正常路径里启动闸本来就静默（`posture === "open"` 不打日志），所以「它还在跑」
不能靠绿日志自证。补两次针对性实测（`evidence/gate-nonloopback-*.log`）：

**(a) fail-closed 仍然拒服**（`npm run dev:lan -- -p 30198`，无 `WORKSPLICE_PASSWORD`）：

```text
▲ Next.js 16.2.12 (Turbopack)
- Network:       http://0.0.0.0:30198
✓ Ready in 286ms
[worksplice] worksplice is listening on a non-loopback address without WORKSPLICE_PASSWORD and refuses to serve (fail-closed). Set WORKSPLICE_PASSWORD to allow remote access, or bind to 127.0.0.1 (the default) and restart.
```

进程随即退出（ADR-0013 决策二的 fail-closed 语义一字未动——动态 import 没把它短路掉）。

**(b) 配了密码照常放行**（`-p 30197`，`WORKSPLICE_PASSWORD` 已设）：

```text
 GET / 200 in 464ms (next.js: 44ms, proxy.ts: 76ms, application-code: 344ms)
带凭证   GET / → http=200
不带凭证 GET / → http=401
```

两次实测后端口均无残留监听（`lsof` 确认）。

### 3. 回归测试（常驻防线）

`lib/access-gate-startup.test.mjs`，6 条**源码级断言**（`docs/engineering-standards.md` §2.1
「路由源码级断言」同款形状：readFile 断言源码形状，不为断言起 HTTP server）：

| 断言 | 锁的是什么 |
| --- | --- |
| 顶层无任何静态 import（`import type` 除外，编译期擦除） | 本票 bug 的直接形态 |
| 不静态引用任何 `node:` 内置模块 | 同上 |
| 文件体不含 `process.exit` | edge 看得见的是**文件体**，与 import 链无关 |
| 准入闸动态 import 排在 `NEXT_RUNTIME` 守卫**之后** | 守卫在前 = 只有 node 才可能走到它 |
| 启动闸仍是 fail-closed 三分支 | 搬代码时没把放行分支或 `process.exit` 弄丢 |
| 启动闸走判定层结论，判定层不反向依赖它 | 职责分层 + 不成环 |

红绿（`evidence/red-startup-test.txt` / `green-startup-test.txt`）：

```text
改动前：ℹ tests 6  ℹ pass 3  ℹ fail 3     退出码 1
  ✖ instrumentation 顶层不出现任何静态 import…
  ✖ instrumentation 文件体不含 process.exit…
  ✖ 准入闸的动态 import 排在 NEXT_RUNTIME 守卫之后…
改动后：ℹ tests 6  ℹ pass 6  ℹ fail 0     退出码 0
```

红是用 `git checkout d26cdf1 -- instrumentation.ts` 造出来的（只回退那一个文件，
跑一次，再拷回改动版）——正好是本票唯一会回归的 3 条，其余 3 条断言的是新模块，在两个状态下都该绿。

### 4. 测试档 = 窄，理由

**要分清两件不同的事**：

- **全量单测对本票零信息量**（验收第 4 条的裁剪，成立）：`npm test` 跑的是
  `lib|app|components|hooks` 四个目录，它**不加载 `instrumentation.ts`，更不触发 Next 的编译**。
  本票改的是「启动期 import 图」，全量套件从头到尾没碰过这个东西。
- **但「窄」不等于不跑**。本票的信息量落在两处，都真实执行了：
  第 1 节的必红/必绿端到端计数（一次性取证），第 3 节的常驻源码级防线（毫秒级、
  零端口零 server）。加测的原因是 Standards 轴报的 hard finding
  （§2.1「改动带回归测试是硬性要求」）——已 `ask` coordinator 裁定放行第三个文件。
- 顺带跑了仓库 §2.2 的全量门禁确认没连带伤害：**1073 → 1079 用例（+6 = 新测试文件被
  `lib/**/*.test.mjs` glob 自动纳入，未改 `package.json`），0 失败**。

### 5. 门禁结果

| 门禁 | 结果 | 证据 |
| --- | --- | --- |
| `npm run typecheck` | **退出码 0** | `evidence/green-tsc.txt` |
| `npm run lint` | **退出码 0**，1 条 warning，与 base **逐行一致 = 零新增** | `evidence/green-lint.txt` vs `evidence/baseline-lint.txt` |
| `npm test` 全量 | **1079 / 1079 通过** | `evidence/full-suite.txt`（两次摘要） |
| 必红命令 | `edge-warning-count=10`（> 0 ✓） | `evidence/red-verdict.txt` + `red-dev.log` |
| 必绿命令 | `edge-warning-count=0`（= 0 ✓） | `evidence/green-verdict.txt` + `green-dev.log` |
| 请求 200 | `GET / 200` + `GET /api/sessions 200` | 两份 dev 日志 |

那条唯一的 lint warning 在 `hooks/useI18n.tsx:61`（`react-hooks/exhaustive-deps`），
改动前就存在，与本票无关。

### 6. 改动面核对

```text
$ git diff d26cdf1 --numstat -- instrumentation.ts lib/
7    45    instrumentation.ts
61    0    lib/access-gate-startup.ts
$ git diff d26cdf1 -- lib/access-gate.ts proxy.ts     # 空 = 未动
$ git status --porcelain                                 # 空
```

**迁移保真核对**（两个函数体逐字比对，只忽略 `export` 修饰的差异）：

```text
$ diff <(git show d26cdf1:instrumentation.ts | sed -n '/^async function waitForServerPort/,/^}$/p;/^async function enforceAccessGateAtStartup/,/^}$/p') \
       <(sed -n '/^async function waitForServerPort/,/^}$/p;/^export async function enforceAccessGateAtStartup/,/^}$/p' lib/access-gate-startup.ts \
         | sed 's/^export async function enforceAccessGateAtStartup/async function enforceAccessGateAtStartup/')
（无输出 = 逐字相同）
```

### 7. 双轴 code-review（不合并、不重排）

**Standards** — 6 条 finding，逐条处置：

| # | 严重度 | finding | 处置 |
| --- | --- | --- | --- |
| 1 | **hard** | 新模块无单测，违反 `docs/engineering-standards.md` §2.1「改动带回归测试是硬性要求」 | **已修**：`ask` coordinator 后获授权第三个文件，新增 `lib/access-gate-startup.test.mjs`（6 条断言，红 3 绿 6，见第 3 节） |
| 2 | judgement | `access-gate-startup.ts` 里 `3000` 出现两次、`25` 硬编码，与判定层 `DEFAULT_PROBE_TIMEOUT_MS` 命名常量风格不一致（Primitive Obsession） | **豁免**：这是**逐字搬过来**的既有代码（见第 6 节的保真核对）。改名会掩盖「行为一字未变」这个本票最强的证据；且 `waitForServerPort(3000)` 与 `waitForServerListening({timeoutMs: 3000})` 语义不同（等端口 vs 等监听），共用一个值只是巧合，提名反而会误导 |
| 3 | judgement | 与 `access-gate.ts:148-163` 的「deadline + 轮询 + sleep」循环形状重复，且本模块手写 `new Promise(setTimeout)` 而判定层用 `node:timers/promises` 的 `delay`（Duplicated Code） | **豁免（规则冲突，非偷懒）**：reviewer 建议的修法是「放回 `access-gate.ts` 去掉重复」——但 Constraint 1 明令**判定层本体不许改**，那是维护者裁的 F1 最小面。这条记为后续票的债，不在本票动 |
| 4 | judgement | 两条 `console.warn` 长句只有前半段不同，可抽前缀常量 | **豁免**：同样是逐字搬运的既有代码；启动日志措辞是对外可读文本，抽常量收益小于「搬运保真」的收益 |
| 5 | judgement | AGENTS.md 的 File Map 未登记 `lib/access-gate-startup.ts`；且 `instrumentation.ts` 被 edge 层无条件双编译这条构建器陷阱没进「Key Design Decisions & Traps」 | **已裁定不做**：`ask` 时 coordinator 明确——AGENTS.md 是全局治理文档，按 main/worktree 铁律不由 worker 改，由 coordinator 在 main 上直补。已写进 worker_done 的移交清单。注：父模块 `lib/access-gate.ts` 本就未登记，属既有缺口，一并归这条 |
| 6 | — | 无其他发现 | 注释中文/标识符英文、相对导入 `./access-gate.ts` 与该文件既有 `./web-auth.ts` 一致；diff 未改写任何仓库既有词汇，无 term 漂移 |

**Spec** — verdict **OK with notes**，2 条 P2：

| # | finding | 处置 |
| --- | --- | --- |
| 1 | P2 `lib/bash-containment.ts:145` 注释仍写「`instrumentation.ts` 的启动门（要轮询等待 Next 写入）」，启动门已搬到 `lib/access-gate-startup.ts` | **未修（授权外）**：Spec「至多新增一个文件」+ coordinator 的放开只覆盖了 `.test.mjs`，没覆盖这个指针。下一个读端口推导注释的人会找错文件——记为明确的技术债，已写进 worker_done 的移交清单 |
| 2 | P2 「C3 行为不变」缺正向实测证据：loopback 正常路径下启动闸静默，`green-dev.log` 里没有它的痕迹 | **已修**（review 发出后我正好在跑）：补了第 2 节的 (a)(b) 两次定向实测——非 loopback 无密码**实测拒服**（消息原文见 evidence）、配密码**实测 200/401** |

Spec 轴其余核验均通过：C1 只碰授权文件（C0 用日志里的源码原文逐行对照证明判定层未动）；
C2 红绿计数与提交的 evidence 一致、`repro.sh` 计数与退出码语义自洽、红绿同端口同命令可比；
C3 调用点与顺序（gate → dispatcher → demo → agent-loop）保持；C4 无 `npm install`、无 `next build`；
无 scope creep（两处告警注释是本票 Implementation Decision 3 明文要求的）；
fail-closed 三分支与 ADR-0013 决策二一致；**「looks implemented but wrong」一类零发现**。

### 8. 遗留 / 技术债（未在本票修，均因授权范围）

1. ~~`lib/bash-containment.ts:145` 的注释指针已陈旧（Spec 轴 P2 #1）~~ **已于第 12 节补正**（打回 G-impl #3）。
2. AGENTS.md 的 File Map 与构建器陷阱段待补（Standards #5，coordinator 在 main 上补）。
3. Standards #2/#3/#4 三条 judgement（magic number / 与判定层的轮询形状重复 / 日志前缀）
   —— 均因「逐字搬运」或「判定层不许改」而豁免，建议下一票连同 #1 一起处理。
4. pi-lens 侧的 knip 诊断报 `Unused file lib/access-gate-startup.ts`——**已核实不属门禁且不是死代码**：
   knip 未装进仓库（`package.json` 的门禁只有 typecheck / lint / test，三项全绿）；
   同款形状的 `lib/http-dispatcher.ts`（同样只被 `await import("@/lib/…")` 引用）不被它报，
   说明是别名 + 动态 import 的解析盲区。该文件在运行期确实被执行——第 2 节 (a) 的 fail-closed
   实测就是它跑出来的。
5. `lib/bash-containment.ts:144-146` 与 `:170-172` 是两份对「还有哪些地方读/解析 `PORT`」的枚举，
   事实重复，再搬一次站点要两处同步（Standards 轴 P2 #1）。本轮只授权 `:145` 一行。
6. `lib/bash-containment.ts:144` 的「共三处」字面上漏了本函数自己的 `env.PORT`（`:155`）——
   贴上下文读作「另三处」是对的，**不是事实错误**（Standards 轴 P2 #2）。
7. `.github/SECURITY.md:22,25` 的指针「粗但不错」（拒服仍由 `instrumentation.ts` 的 `register()` 触发，
   读者一跳就到实现），**经 ask 裁定不动**；判断判据见第 12.4 节（死路 vs 粗）。

其中第 5-7 条是第 12 节（打回补正轮）新增的债，均因授权外或非错误而未改；判据在第 12.6 节的两轴表里。

### 9. PR

**https://github.com/whutlichao/worksplice/pull/103**（`whutlichao/fix-edge-instrumentation-warnings`
→ `main`，提交 `a0fa4d6` + `5344833`，正文引用 `Closes #101`）。

### 10. 票据 Status 流转说明

仓库的 issue 追踪约定（`docs/agents/issue-tracker.md`）是「Status 记录在每个 issue 文件顶部」
——本文件的 `Status:` 已由 `in-progress` 置为 `resolved`，这是本票的溯源正本。
GitHub #101 侧：仓库既有的 label 词表里**没有** `in-progress`（只有 `bug` / `ready-for-agent`），
所以没有发明新 label；按 GitHub 惯例由 PR #103 的 `Closes #101` 在合入时关闭 issue。

### 11. 证据文件清单

`.scratch/edge-instrumentation-warnings/evidence/`：

| 文件 | 是什么 |
| --- | --- |
| `repro.sh` | 红绿两遍的同一份反馈回路（`npm run dev -- -p <port>`） |
| `red-dev.log`（190 行）/ `red-verdict.txt` | 必红：`edge-warning-count=10` |
| `green-dev.log` / `green-verdict.txt` | 必绿：`edge-warning-count=0` |
| `red-startup-test.txt` / `green-startup-test.txt` | 源码级断言的红（3/6 失败）与绿（6/6） |
| `gate-nonloopback-refuses.log` | 行为未变 (a)：非 loopback 无密码实测拒服 |
| `gate-nonloopback-with-password.log` | 行为未变 (b)：配密码 200 / 401 |
| `baseline-lint.txt` / `green-lint.txt` | 增量对照（逐行一致） |
| `baseline-tsc.txt` / `green-tsc.txt` | `tsc --noEmit` 退出码 0 |
| `full-suite.txt` | 全量套件两次摘要（1073 → 1079，0 失败） |

---

### 12. 本轮补正（打回门禁 = G-impl 第 3 条「搬家必须逐个清点指向它的位置」）

前一轮把准入闸启动门从 `instrumentation.ts` 搬到 `lib/access-gate-startup.ts`，但**一处指向旧位置的
注释指针没跟着更新**——本轮补上。

#### 12.1 改了哪一行

`lib/bash-containment.ts:145`（`resolveWorksplicePorts` 的端口推导注释块内）：

```diff
- * 正是本函数要避免的）、`instrumentation.ts` 的启动门（要轮询等待 Next 写入）、
+ * 正是本函数要避免的）、`lib/access-gate-startup.ts` 的启动门（要轮询等待 Next 写入）、
```

`git diff --numstat` = `1 1 lib/bash-containment.ts`（1 增 1 删）。**纯注释，零代码语义变化**；
句式与宽行风格照旧（未按 80 列重排）；同段里仍然正确的 `bin/worksplice-options.js:25`
与 `lib/access-gate.ts` 两处**一字未动**（`git diff` 可证）。

#### 12.2 为什么它属于本票引入的不一致

这段注释的职责是「教读者端口推导该读哪里」。它列举仓库里另外三个读 `process.env.PORT` 的地方，
声称其中一个「要轮询等待 Next 写入」——那份轮询代码（`waitForServerPort`）**正是本票搬走的东西**。
搬完之后 `instrumentation.ts` 里**一点端口轮询都不剩**：照这条指针去找会**扑空**。
所以这不是历史遗留的陈旧注释，是**本次拆分制造**的指错。

#### 12.3 是否还有同类遗漏

清点范围：`grep -rn "instrumentation"` 覆盖 `*.ts|*.tsx|*.mjs|*.js|*.md`，排除
`node_modules/` / `.next/` / `.scratch/`。结论：**死路指针 1 处（上面那处，已修），其余 0 处**。

| 位置 | 原文要点 | 判断 |
| --- | --- | --- |
| `lib/bash-containment.ts:145` | 「`instrumentation.ts` 的启动门（要轮询等待 Next 写入）」 | **死路指针，已修** |
| `.github/SECURITY.md:22, 25` | 「verified in … `instrumentation.ts` …」/「`instrumentation.ts` refuses to start」 | **粗但不错，不动**（详见 12.4） |
| `lib/domain/collab/secretary-auto-create.ts:10,58` | 「启动路径（instrumentation…）」「调用方（instrumentation）」 | **仍为真**——`register()` 仍在 `instrumentation.ts:45` 调 `autoCreateSecretary()` |
| `lib/domain/collab/index.ts:6`、`AGENTS.md:452` | 「…instrumentation 全部收敛到这里」「`createAgentLoop().start()`，instrumentation 调用」 | **仍为真**——这两条说的是「谁驱动 agent-loop」，起点确实还在 `instrumentation.ts:38` |
| `README.md:274`、`README.zh-CN.md:274` | `instrumentation.ts  # initializes the server HTTP dispatcher` | **仍为真**——`configureHttpDispatcher()` 仍在 `register()`（`instrumentation.ts:24-25`） |
| `docs/spec-bootstrap-agent.md:199` | 「服务启动路径内（instrumentation，agent-loop 启动之后）」 | **仍为真**——同上 |
| `bin/worksplice.js:44` | 「第二道在服务进程内（`lib/access-gate.ts` + `proxy.ts`）」 | **仍为真**——它指判定层与请求门，两处都没动；它从未指向 `instrumentation.ts` |
| `docs/adr/0013-*.md:7`、`docs/http-corridor-caller-identity.md:157,265` | 决策正文与取证项的**原始记录** | **历史记录，不该改**——ADR 追加式不改正文；且措辞是「`proxy.ts` / `instrumentation.ts` **一类位置**」（类别，不是精确指针），实施票取证项记的是当时的待办。改它等于篡改记录 |
| `.scratch/agent-tool-path-guard/issues/06,07` | 旧票据里「`instrumentation.ts` 启动门」 | **历史票据，存档**——当时为真，现为陈迹；票据是记录不是活文档 |

#### 12.4 `SECURITY.md` 为什么判「不同类」——这是本轮唯一的判断分歧，已 ask 裁定

**分歧**：Spec 轴报 `.github/SECURITY.md:25`（活文档）「严格说不再指真，建议同批修」。

**我的判断（并 §Constraint 3 走 ask，coordinator 裁定同意）**：**不动**。判据是「死路 vs 粗」：

- `bash-containment.ts:145` 是一个**具体技术 claim** 的指针——「要轮询等待 Next 写入」。这份轮询已从
  `instrumentation.ts` 全部搬走，照它去找**扑空**。**死路指针必须修。**
- `SECURITY.md:25` 的**句子职责**不是「轮询代码在这个文件里」，而是「拒服发生在**服务进程内**、
  不是 `bin/worksplice.js` 包装里，所以绕过包装的 `next dev -H 0.0.0.0` 也盖得住」。这个职责**仍然成立**：
  `instrumentation.ts` 的 `register()` 依旧是那个**触发点**
  （`await import("@/lib/access-gate-startup")` → `enforceAccessGateAtStartup()` → `process.exit(1)`），
  读者从 `instrumentation.ts` **一跳就到**实现。它只是**粗**，不是**错**。
- `:22` 的文件清单同理仍成立：`instrumentation.ts` 与 `proxy.ts` 都还是验证点。
- 另外 `SECURITY.md` 是**面向外的英文安全威胁模型文档**，措辞改动归维护者。

coordinator 已在 main 上独立核实并采纳该分类。**没有触发** Constraint 3 的「先 ask 再改」红线——
我没有改任何授权外的文件。

#### 12.5 本轮门禁结果

| 门禁 | 结果 |
| --- | --- |
| `lib/bash-containment.ts` diff 只覆盖那一处指针 | `1 1`（1 增 1 删），纯注释 |
| `npm run typecheck` | **退出码 0** |
| `npx eslint lib/bash-containment.ts` | **退出码 0**（无输出） |
| `node --test lib/access-gate-startup.test.mjs` | **6 / 6 通过**，退出码 0 |
| 端到端必红/必绿双向对照 | **未重跑**（裁定的免跑项：纯注释改动不影响构建产物） |
| 全量套件 | **未重跑**（同上，裁定的免跑项） |

#### 12.6 本轮双轴 code-review（收尾，不合并、不重排）

##### Standards 轴 — verdict: OK with notes，无成文规范违规，2 条 judgement（均 report-only，未改）

| # | 严重度 | finding | 处置 |
| --- | --- | --- | --- |
| 1 | judgement P2 | `lib/bash-containment.ts:144-146` 与 `:170-172` 是**两份**对「还有哪些地方读/解析 PORT」的枚举（一份列三处**读取**、一份列两处**解析**），事实重复，再搬一次站点要两处同步（Shotgun Surgery 微形态） | **未改（授权外）**：本轮只授权 `:145` 一行。记为债 |
| 2 | judgement P2 | `:144` 的「共三处」字面上漏了本函数自己的 `env.PORT`（`:155`）；贴上下文读作「另三处」是对的，**不构成事实错误** | **未改（授权外 + 非错误）**。若日后顺手，改「另三处」更无歧义 |

Standards 轴同时**独立复核了「共三处」这个可证伪断言仍然成立**（我另做了一遍同样的核对，结论一致）：
全仓生产路径读 `process.env.PORT` 的正是注释列的那三处
（`bin/worksplice-options.js:25` 持默认 `30142`；`lib/access-gate-startup.ts:28,31` 的 25ms 轮询；
`lib/access-gate.ts:113` 宽松解析返回 `unknown`），其余命中只在 `*.test.mjs`。
块内其它断言也复核为真：`next/dist/server/lib/start-server.js:296` 确为 `process.env.PORT = port + ''`；
四条 npm 脚本确是 `-p 30142`。

##### Spec 轴 — verdict: OK with notes

| 项 | 结论 |
| --- | --- |
| diff 范围 | ✅ 只 `lib/bash-containment.ts` 1 增 1 删，落在 `/** */` 内，无语义变化，无 label/标识符被动 |
| 新指针准确性 | ✅ 启动门现落点确为 `lib/access-gate-startup.ts:41` 的 `export async function enforceAccessGateAtStartup`，由 `instrumentation.ts:21-22` 在守卫后动态 import |
| scope creep | 无 |
| 同类遗漏 | 报 `.github/SECURITY.md:25` 为「活文档 P2」→ 见 12.4，已 ask 裁定**不动**；报 `.scratch/agent-tool-path-guard/issues/06,07` 为历史票据（存档，非活指针）；明确判定 `docs/adr/0013`、`docs/http-corridor-caller-identity.md:157,265`「仍说得通，**不算**」；明确判定泛泛说「instrumentation 驱动 agent-loop/secretary/dispatcher」的注释**仍为真**「须与『启动门在此文件』区分」——**与我的分类完全一致** |
| 门禁 2/3/4 | 该轴无 shell 权限未跑，已由本 worker 跑通（见 12.5，全绿） |
