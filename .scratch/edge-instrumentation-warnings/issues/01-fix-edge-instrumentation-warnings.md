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

1. `lib/bash-containment.ts:145` 的注释指针已陈旧（Spec 轴 P2 #1）。
2. AGENTS.md 的 File Map 与构建器陷阱段待补（Standards #5，coordinator 在 main 上补）。
3. Standards #2/#3/#4 三条 judgement（magic number / 与判定层的轮询形状重复 / 日志前缀）
   —— 均因「逐字搬运」或「判定层不许改」而豁免，建议下一票连同 #1 一起处理。
4. pi-lens 侧的 knip 诊断报 `Unused file lib/access-gate-startup.ts`——**已核实不属门禁且不是死代码**：
   knip 未装进仓库（`package.json` 的门禁只有 typecheck / lint / test，三项全绿）；
   同款形状的 `lib/http-dispatcher.ts`（同样只被 `await import("@/lib/…")` 引用）不被它报，
   说明是别名 + 动态 import 的解析盲区。该文件在运行期确实被执行——第 2 节 (a) 的 fail-closed
   实测就是它跑出来的。

### 9. PR

<!-- PR -->
