# 测试门禁如实体检：118 个测试文件的真实覆盖与失败归因

> 状态：**审计票交付物**（2026-10-02）— 只诊断，不修任何东西。
> 范围：全仓 118 个 `*.test.mjs`，对照组 = 当前 `scripts.test` 门禁的 47 个文件。
> 运行环境：macOS（darwin）、Node **v25.0.0**、bun 1.3.14、commit `3bd7a03`、本票 worktree 独立 `bun install`。
> **本票不含任何门禁改动，未修复任何失败测试，未改动任何既有文件。**

## 1. TL;DR

| 数字 | 值 |
| --- | --- |
| 全仓 `.test.mjs` 文件总数 | **118**（lib 100 / components 13 / hooks 4 / app 1） |
| 当前 `scripts.test` 门禁覆盖的文件 | **47**（39.8%） |
| **从未被执行过的文件** | **71** |
| A 组（门禁 47 文件） | 471 tests / 471 pass / **0 fail** / 0 cancelled |
| B 组（全量 118 文件） | 852 tests / 849 pass / **3 fail** / 0 cancelled |
| **B − A = 此前完全不可见的测试数量** | **381 条**（占全量 44.7%） |
| 失败所在文件 | **2 个**（`lib/data/data-layer.test.mjs`、`lib/project-trust.test.mjs`），均**不在门禁内** |
| **真实缺陷（产品代码 bug）** | **0 条** |
| 测试过期 / 测试自身坏 | **3 条**（全部为断言与当前代码不符，行为本身正确） |
| 环境依赖失败 | **0 条**（0 skipped / 0 todo / 0 cancelled） |
| 超时被取消 | **0 条** |
| 全量耗时 | 10.2 s（对照组 5.9 s）— 代价可忽略 |
| 连跑 5 次结果 | 完全一致（852/849/3/0，失败集相同）— **零 flake** |

English summary:

> The current `npm test` gate is a hand-maintained explicit list covering only **47 of 118**
> test files (471 of 852 tests). Running the full suite exposes **381 tests that had never
> executed** — and they reveal **3 failures in 2 files, all outside the gate**.
>
> All 3 failures are **stale/broken test assertions, not product defects**. Two of them are
> source-text regex assertions in `lib/project-trust.test.mjs` that broke when two refactors
> (`eb7c423` cwd-mutex consolidation, `8e46848` model-listing lite path) *relocated* the code
> they grep for — the trust enforcement itself is verifiably intact. The third is an off-by-one
> literal (`3` vs the fixture's actual `2` channels) in a schema-migration test.
>
> Wiring the full suite costs ~4 extra seconds and is deterministic across 3 runs, so the
> coverage gap is not a cost problem — it is purely a maintenance-drift problem.

## 2. 现状：门禁怎么配的、覆盖多少、漏了多少

### 2.1 门禁是一条手工维护的显式清单

`package.json:39` 的 `scripts.test` 不是 glob，而是一条**逐个文件名列出的显式清单**：

```
node --test lib/agent-loop/*.test.mjs lib/domain/raft/*.test.mjs lib/i18n/*.test.mjs \
  lib/agent-reconcile.test.mjs lib/channel-list.test.mjs lib/file-types.test.mjs \
  components/ChannelView.test.mjs components/WorkspaceSidebar.test.mjs hooks/useChannelData.test.mjs
```

只有前三条是目录 glob，其余 6 条是单文件。任何**新建的测试文件都不会自动进门禁** —— 加测试的人必须记得手动编辑这条命令，漏了就等于测试不存在。

### 2.2 这个清单把「npm test 全绿」定为每票验收标准

`AGENTS.md:492`：

> 验收三件套（main 上只读执行）：测试用例执行（**`npm test` 全绿**，以任务 worktree 内跑的为准 …）

于是形成了一个闭环陷阱：**验收标准本身只覆盖 39.8% 的测试文件**。一张票可以在 `npm test` 全绿的前提下，留下一整个文件从未跑过。

### 2.3 覆盖缺口（实测枚举）

枚举命令与输出：

```console
$ find . -name '*.test.mjs' -not -path './node_modules/*' -not -path './.next/*' | wc -l
118

$ find . -name '*.test.mjs' -not -path './node_modules/*' -not -path './.next/*' \
    | sed 's|^\./||' | cut -d/ -f1 | sort | uniq -c | sort -rn
    100 lib
     13 components
      4 hooks
      1 app

$ ls lib/agent-loop/*.test.mjs lib/domain/raft/*.test.mjs lib/i18n/*.test.mjs \
    lib/agent-reconcile.test.mjs lib/channel-list.test.mjs lib/file-types.test.mjs \
    components/ChannelView.test.mjs components/WorkspaceSidebar.test.mjs hooks/useChannelData.test.mjs \
    | wc -l
47

# 门禁清单与全量清单求差（gate ⊆ all 已单独校验，comm -23 输出为空）
$ comm -13 gate-47.txt all-118.txt | wc -l
71
$ comm -13 gate-47.txt all-118.txt | cut -d/ -f1 | sort | uniq -c | sort -rn
     56 lib
     11 components
      3 hooks
      1 app
```

关于 `.scratch/`：本 worktree 中**不存在** `.scratch/` 目录，`git ls-files '*.test.mjs' | grep '^\.scratch/'` 输出为空，磁盘上 `find` 也未命中。因此 **118 就是全量口径，不含任何需要排除的 agent 自用内部测试**（本仓 `.scratch/` 未纳入版本控制，故本票无排除项）。同时 `git ls-files '*.test.ts' '*.test.tsx' '*.test.js'` 计数为 `0` —— 全仓只有 `.mjs` 一种测试文件形态，无遗漏的第二种测试类型。

| 口径 | 文件数 | 测试数 | 占全量测试 |
| --- | --- | --- | --- |
| 门禁内（A 组） | 47 | 471 | 55.3% |
| **门禁外（A 组从未执行）** | **71** | **381** | **44.7%** |
| 全量（B 组） | 118 | 852 | 100% |

### 2.4 加重因素：没有 CI，且标准文档把这个清单称作「全量基线」

两点实测发现，让缺口更难被察觉：

1. **仓库没有 CI**：`ls .github/workflows/` → `No such file or directory`（`.github/` 下只有 `pull_request_template.md` 与两个 issue 模板）。`docs/engineering-standards.md:54` 自己写明「当前 CI 状态：**本地 gate 即 CI**」。也就是说 `npm test` 只在有人手动敲时才会跑 —— 没有任何机器会替我们发现新增的测试文件没进门禁。
2. **标准文档把这个局部清单称作「全量基线」**：`docs/engineering-standards.md:25` 写 `npm test # 全量基线（agent-loop + raft + 组件，343 用例 @ BAI-6）`，`:28` 写「全量基线明细」，`:48` 把 `npm test`（全量基线）列为提交前硬门禁。而 `:30` 给出的「明细」命令本身也只有 3 条路径。用例数也已漂移（文档写 343、`docs/adr/0009` 写 347、实测 471），但**始终没有人核对过它是否真的「全量」**。

> 相关既有记录：`docs/pi-sdk-upgrade-spike.md:402` 已就另一类失明写过结论 ——「`npm test` 对 3 个断裂完全失明」，但那次的失明对象是 `tsc --noEmit` 能抓而测试抓不到的**类型**断裂，不是测试文件**根本没被执行**。根因同源（门禁是手工清单），现象不同，本票补上这一半。

## 3. 对照组 vs 全量

### 3.1 两组的真实数字

| 组 | 命令 | 文件 | tests | pass | fail | cancelled | skipped | todo | 墙钟 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A（对照组 = 现有门禁）** | `npm test` | 47 | **471** | **471** | **0** | 0 | 0 | 0 | 5.9 s |
| **B（全量）** | `node --test --test-timeout=60000 'lib/**/*.test.mjs' 'app/**/*.test.mjs' 'components/**/*.test.mjs' 'hooks/**/*.test.mjs'` | **118** | **852** | **849** | **3** | **0** | 0 | 0 | 10.2 s |
| **B − A** | — | **+71** | **+381** | +378 | **+3** | 0 | 0 | 0 | +4.3 s |

**⇒ 此前完全不可见的测试数量 = 852 − 471 = 381 条**（占全量 44.7%），分布在 71 个从未被执行的文件里。

A 组真实输出（`npm test` 尾部）：

```console
ℹ tests 471
ℹ suites 0
ℹ pass 471
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5537.229125

real	0m5.934s
```

B 组真实输出（尾部）：

```console
ℹ tests 852
ℹ suites 0
ℹ pass 849
ℹ fail 3
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 10211.212584

real	0m10.270s
```

### 3.2 「全跑了」的交叉验证：逐文件跑一遍，和聚合跑对账

聚合跑的数字不足以证明 118 个文件都真的加载并执行了（某个文件加载失败可能只表现为一条 fail，而不是被静默跳过）。因此**逐个文件单独跑一遍**，把每文件的 tests/pass/fail/cancelled 落成 TSV 再求和：

```console
$ while read -r f; do node --test --test-timeout=60000 "$f" > "$f.log" 2>&1; ... done < all-118.txt
$ wc -l < perfile.tsv
118
$ awk -F'\t' '{t+=$2;p+=$3;f+=$4;c+=$5} END {printf "files=%d tests=%d pass=%d fail=%d cancelled=%d\n", NR,t,p,f,c}' perfile.tsv
files=118 tests=852 pass=849 fail=3 cancelled=0
```

逐文件求和 **118 files / 852 / 849 / 3 / 0**，与 §3.1 聚合跑的 **852 / 849 / 3 / 0** 逐项相同。三点由此确立：

- **118 个文件全部被加载并执行**，无一被静默跳过；
- **没有任何文件「加载不了」**（加载失败会额外产生 fail，与 fail=3 且这 3 条都是断言不符对不上）；
- 把 perfile 按「门禁内 / 门禁外」分组求和，**门禁内 47 文件 = 471 tests**，与 `npm test` 实测完全吻合 —— 两条独立路径互相印证。

```console
$ join -t$'\t' gate-47.txt perfile.tsv | awk '{t+=$2;p+=$3;f+=$4;c+=$5} END {printf "A: files=%d tests=%d pass=%d fail=%d cancelled=%d\n", NR,t,p,f,c}'
A: files=47 tests=471 pass=471 fail=0 cancelled=0
$ join -t$'\t' not-in-gate-71.txt perfile.tsv | awk '{t+=$2;p+=$3;f+=$4;c+=$5} END {printf "unseen: files=%d tests=%d pass=%d fail=%d cancelled=%d\n", NR,t,p,f,c}'
unseen: files=71 tests=381 pass=378 fail=3 cancelled=0
```

### 3.3 超时与 flake：都是 0

- **超时取消 = 0**。全程使用 `--test-timeout=60000`；三组运行（首次 + 2 次复跑）的 `cancelled` 均为 `0`，`skipped`/`todo` 亦为 `0`。**没有任何用例因超时被取消，因此本票不存在「因超时取消」的统计口径**。
- **零 flake**。同一命令连跑 3 次，tests/pass/fail 完全一致，且**失败的是同样的 3 条**：

```console
$ for n in 1 2 3; do node --test --test-timeout=60000 'lib/**/*.test.mjs' 'app/**/*.test.mjs' \
      'components/**/*.test.mjs' 'hooks/**/*.test.mjs' > rerun$n.log 2>&1; \
    grep -E '^. (tests|pass|fail|cancelled) ' rerun$n.log | tr -d '\n'; echo; done
ℹ tests 852ℹ pass 849ℹ fail 3ℹ cancelled 0
ℹ tests 852ℹ pass 849ℹ fail 3ℹ cancelled 0
ℹ tests 852ℹ pass 849ℹ fail 3ℹ cancelled 0
```

文档定稿后又追加 2 次确认运行（同一条命令），结果同样是 `852/849/3/0` 且失败集不变 —— 合计**连跑 5 次零 flake**。

这对 §6 的落地建议是决定性的：**全量进门禁的代价是 +1~4 s 墙钟，换 381 条测试的回归覆盖，且实测不 flaky。**

### 3.4 环境依赖：实测 0 条，但存在跨平台隐患（不是当前失败）

实测没有任何用例因缺凭证 / 网络 / TTY 而失败或被跳过，但 71 个门禁外文件里有 8 处**平台敏感分支**，它们在本机（darwin）全部真跑通过了：

```console
$ grep -nE '\bt\.skip|process\.platform|HTTP_PROXY|WORKSPLICE_DATA_DIR' <71 个门禁外文件>
lib/atomic-file.test.mjs:24:  if (process.platform !== "win32") {
lib/bash-output.test.mjs:54:        t.skip("Creating symbolic links requires additional privileges on this platform");
lib/file-access.test.mjs:21:  fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
lib/file-dirent.test.mjs:41:      t.skip("Creating symbolic links requires additional privileges on this platform");
lib/file-upload.test.mjs:48:      t.skip("Creating symbolic links requires additional privileges on this platform");
lib/http-dispatcher.test.mjs:56:  process.env.HTTP_PROXY = proxyUrl;
lib/model-discovery.test.mjs:38:  process.env.WORKSPLICE_DISCOVERY_TEST_TOKEN = "resolved-token";
```

逐条性质（已核实，不是推测）：

- `t.skip` 三处（symlink 权限）、`process.platform` 两处：均为**自守卫**，无权限时优雅跳过，不会让门禁变红。
- `lib/http-dispatcher.test.mjs` **不需要真实网络**：它 `createServer` 起本地代理绑 `127.0.0.1`（`:24,:40`），再对 `target.invalid` / `bypass.invalid:9` 发请求（`:71,:78,:84`）—— `.invalid` 是 RFC 2606 保留域，恒不可解析，测试正是断言这些请求被拒绝。
- `WORKSPLICE_DATA_DIR` / `WORKSPLICE_DISCOVERY_TEST_TOKEN` 是测试自己设置再删除的进程内变量，不读真实凭证。

**⇒ 归类「环境依赖」的失败：0 条。** 但 `t.skip` 意味着**在无 symlink 权限的环境（如某些 CI 容器）这些用例会静默跳过**，覆盖面会小于 852。这是落地时要知道的性质，不是当前的失败。

## 4. 失败清单（按根因分类）

### 4.1 归类口径

按本票约定的五类，**每一类都给出本次实测的计数**；未出现的类别明确写 0，不留空：

| 类别 | 本次计数 | 说明 |
| --- | --- | --- |
| **真实缺陷**（测试抓到产品代码 bug） | **0** | 无。3 条失败全部经代码与 git 历史双向核实为「产品行为正确、断言过期」 |
| **测试过期**（断言与当前预期行为不符） | **3** | 2 条源文本断言 + 1 条 schema 迁移断言；均在门禁外 |
| **环境依赖**（需真实凭证/网络/TTY/平台） | **0** | 见 §3.4 |
| **测试自身坏**（导入失败 / fixture 缺失 / 语法错） | **0** | 无文件加载失败（§3.2） |
| **超时/挂住** | **0** | `cancelled=0` × 5 次运行 |
| 合计失败 | **3**（分布在 2 个文件） | |

### 4.2 两条 project-trust 失败（测试过期 —— 代码被重构搬走，行为正确）

`lib/project-trust.test.mjs` 是**源文本断言**测试（`readFile` 源码 + 正则匹配）。两次重构把被 grep 的字面量搬走了，测试没跟着更新。

**失败 A** — `not ok 724`，断言位置 `lib/project-trust.test.mjs:93:10`：

```console
# Subtest: all project resource loaders and reloads enforce project trust
not ok 724 - all project resource loaders and reloads enforce project trust
  location: '.../lib/project-trust.test.mjs:77:1'
  failureType: 'testCodeFailure'
  error: |-
    The input did not match the regular expression /projectTrustReloadOptions\(cwd, agentDir\)/. Input:

    'import { stat } from "fs/promises";\n' +
      'import { resolve } from "path";\n' +
      ...
      'async function loadModels(cwd: string): Promise<ModelsData> {\n' + ...
```

**失败 B** — `not ok 725`，断言位置 `lib/project-trust.test.mjs:117:10`：

```console
# Subtest: the trust API invalidates cached models and restricted runtimes
not ok 725 - the trust API invalidates cached models and restricted runtimes
  location: '.../lib/project-trust.test.mjs:108:1'
  failureType: 'testCodeFailure'
  error: |-
    The input did not match the regular expression /registry\.trackStarting\(sessionCwd\)/. Input:

    '// RpcCaller — RPC 会话的获取与命令调用入口。\n' + ...
```

**根因（已核实，非推测）**：两次重构各自搬走了一处字面量，且**都比该测试文件的最后一次改动晚**。

| 断言 | 测试要找的字面量 | 现状（实测） | 搬家提交 | 测试最后改动 |
| --- | --- | --- | --- | --- |
| `L93` `modelsSource` | `projectTrustReloadOptions(cwd, agentDir)` | `app/api/models/route.ts:35` 改为 `loadModelListingServices(cwd, agentDir)`；该字面量现在在 `lib/model-listing.ts:66` | `8e46848` **2026-09-04**「perf(models): 可信 cwd 走轻量路径，模型列表加载 ~10s → ~20ms」 | `df985ca` **2026-08-14** |
| `L117` `callerSource` | `registry.trackStarting(sessionCwd)` | `lib/rpc/caller.ts:68` 改为 `trackStarting(sessionCwd)`，直接 import 自 `../cwd-mutex.ts`（`:24`），注释写明「11-收敛：starting 窗口计数器唯一来源 lib/cwd-mutex（原 registry.trackStarting 委托同源）」 | `eb7c423` **2026-08-20**「refactor(cwd-mutex): 收敛 cwd 互斥至单一深模块 lib/cwd-mutex」 | `df985ca` **2026-08-14** |

**★ 这不是安全护栏被移除。** 我把这两个测试里**全部 17 条断言逐条独立求值**（绕开首次 abort 的遮蔽），结果：13 条 PASS、**4 条 FAIL**，且 4 条失败全部是「字面量搬走了」，行为断言一条没坏：

```console
$ node --input-type=module -e '<逐条 assert.match 求值，见 §4.2 附表>'
PASS L86 caller /projectTrustReloadOptions(sessionCwd, agentDir)/
PASS L85 caller /const sessionCwd = sessionManager.getCwd()/
PASS L87 caller /resourceLoaderReloadOptions: trustReloadOptions/
PASS L88-91 session syncProjectTrust+reload count === 2   [count=2]
FAIL L93 models /projectTrustReloadOptions\(cwd, agentDir\)/   [literal absent from route]
FAIL L94 models /resourceLoaderReloadOptions: trustReloadOptions/   [literal absent from route]
PASS L95 skills /loader.reload(projectTrustReloadOptions(cwd, agentDir))/
PASS L96 plugins /projectTrusted: projectTrust.trusted/
PASS L97-100 skillsInstall /getProjectTrustStatus(projectCwd, getAgentDir()).trusted/
PASS L101-104 plugins projectTrusted count === 2   [count=2]
PASS L105 plugins /scope === "project" && !projectTrust.trusted/
--- second test ---
PASS L115 ptroute /trustProject(result.cwd, agentDir)/
PASS L116 ptroute /invalidateModelsCache()/
PASS L116b ptroute /destroyRpcSessionsForCwd(result.cwd)/
PASS L116c ptroute /hasBusyRpcSessionForCwd(result.cwd)/
FAIL L117 caller /registry.trackStarting(sessionCwd)/   [literal absent; now trackStarting(sessionCwd)]
FAIL L118 registry /realpathSync(resolvedCwd)/   [literal absent; now in cwd-mutex.ts]
--- relocation targets ---
PASS model-listing.ts HAS projectTrustReloadOptions(cwd, agentDir)
```

护栏仍在的三个独立证据：

1. `lib/model-listing.ts:66-70` 依然 `const trustReloadOptions = projectTrustReloadOptions(cwd, agentDir);` 并以 `resourceLoaderReloadOptions: trustReloadOptions` 传下去 —— 即搬家后 `L93`+`L94` 两条断言的**意图仍然成立**，只是断言对象换了文件。
2. `lib/rpc/registry.ts:66-67` 仍保留 `trackStarting(cwd)` 方法，只是改为 `return trackStartingCwds(cwd)` 委托给 `cwd-mutex.ts` —— 间接层还在，caller 只是不再穿过它。
3. `lib/cwd-mutex.ts:36` 承接了 `realpathSync(resolved)`，即 `L118` 的字面量搬到了这里。

**⚠ 附带发现：该测试低估了自己的腐化程度。** Node 遇到首个 `assert.match` 失败即中止该 test，所以它只报了 2 条失败；实际有 **4 条**断言已过期（`L94`、`L118` 被前面的失败遮住了）。任何「按报错逐条修」的做法都会修两轮才发现还有两条。

### 4.3 一条 data-layer 失败（测试过期 —— 产品行为有意变更，且变更后另有测试覆盖）

`not ok 333`，断言位置 `lib/data/data-layer.test.mjs:260:10`：

```console
# Subtest: v11 database upgrades to v12: channels CHECK gains 'dm' via expand-contract rebuild
not ok 333 - v11 database upgrades to v12: channels CHECK gains 'dm' via expand-contract rebuild
  location: '.../lib/data/data-layer.test.mjs:178:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:

    2 !== 3

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 3
  actual: 2
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (file:///.../lib/data/data-layer.test.mjs:260:10)
```

出错断言与其上方注释（`lib/data/data-layer.test.mjs:258-260`）：

```js
  // 幂等重跑：数据不变、不再报错
  runMigrations(db);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM channels").get().c, 3);
```

**根因：`cleanupEmptyDms` 在第二次 `runMigrations` 时删掉了测试自己插入的那个空 DM 频道。** 完整行数推演（每一格都有出处，已逐条核实）：

| 时点 | channels 行数 | 依据 |
| --- | --- | --- |
| fixture 建库后 | 1（`ch1`） | `lib/data/data-layer.test.mjs:219-220` |
| 第 1 次 `runMigrations`（`:225`） | **2**（`+ #all`） | `lib/data/schema.ts:212` 无条件调 `seed(db)`；`seed` 在 `:307-312` `INSERT OR IGNORE INTO channels … BUILTIN_CHANNEL_ID` |
| 测试自插 DM（`:244`） | **3** | 测试自己 `INSERT … 'dm:owner↔x'` |
| 第 2 次 `runMigrations`（`:259`） | **2**（DM 被删） | `lib/data/schema.ts:213` 无条件调 `cleanupEmptyDms(db)` |

关键机制在 `lib/data/schema.ts:364-366`：

```sql
DELETE FROM channels WHERE type = 'dm' AND id NOT IN (SELECT DISTINCT target_id FROM messages)
```

该测试的 fixture（`lib/data/data-layer.test.mjs:182-223`）**只建了 `channels` / `members` / `channel_members` / `pinned_messages` 四张表，从未插入任何 `messages` 行** —— 空集 `NOT IN` 恒为真，于是 `dm:owner↔x` 每次重跑都被回收。而 `runMigrations`（`schema.ts:199-216`）里 `seed` 与 `cleanupEmptyDms` **都在事务内无条件执行**（`SCHEMA_VERSION = 12`，本次迁移未 bump），所以第二次重跑必然掉回 2。

**⇒ `3` 在写这个测试时是对的**（`ch1` + seed 的 `#all` + dm，共 3），**不是笔误**。让它过期的是一次**有意的产品变更**：

| 事件 | 提交 | 日期 |
| --- | --- | --- |
| 该测试文件最后一次改动 | `49ad42f`「feat(dm): DM 通道地基与成员规则（票据 01）」 | **2026-09-05** |
| 引入 `cleanupEmptyDms`、改为 DM 懒创建 | `718c37e`「feat(dm): lazy-create DM (remove eager creation + migrate empty DMs)」 | **2026-09-06**（晚一天） |

变更意图写在代码注释里（`lib/data/schema.ts:327-328`）：

```
// 懒创建（dm-lazy-create）：不再 seed 补齐 DM——DM 只在 owner 打开「发送消息」入口时
// 由 createDirectChannel 幂等创建；存量空 DM 由 cleanupEmptyDms 每开库回收。
```

**且这个新行为有自己的正式测试、并且通过了** —— `lib/domain/raft/dm.test.mjs:121`：

```js
test("migration deletes empty DMs (with their channel_members) and keeps non-empty DMs idempotently", () => {
```

它断言的正是「空 DM 被删、有消息的 DM 幂等保留」。所以产品行为**有意且被覆盖**；真正过期的是 `data-layer.test.mjs:258` 那句注释所表达的旧意图（「幂等重跑：数据不变」）与它下面的字面量 `3`。

> 该 fixture 的 `messages` 表根本不存在（`SCHEMA_STATEMENTS` 会建空表），所以「无顶层消息」这一空判定条件在此必然成立 —— 这也解释了为什么失败是**稳定复现**而非偶发（§3.3 三次一致）。

## 5. 真实缺陷排序

### 5.1 真实缺陷：0 条

**本票没有找到任何产品代码缺陷。** 3 条失败逐条经代码 + git 历史双向核实（§4.2、§4.3），全部指向「产品行为正确且有意，测试断言过期」。这一结论的强度来自三处否证，而非「没看出来」：

1. **project-trust 的护栏逐条独立求值**：17 条断言中 13 条 PASS，包括全部行为类断言（`trustProject` → `invalidateModelsCache` → `destroyRpcSessionsForCwd` → `hasBusyRpcSessionForCwd` 这条失效链、`plugins` 的 `projectTrusted` 双点、`skills` 的 trust reload、`session.ts` 的 `syncProjectTrust()+reload` 计数恰为 2）。且 `lib/model-listing.ts:66` 实测仍持有被搬走的 `projectTrustReloadOptions(cwd, agentDir)` 字面量 —— 护栏是**搬家**不是**消失**。
2. **data-layer 的新行为有独立测试且通过**：`lib/domain/raft/dm.test.mjs:121` 明确断言「空 DM 被删、非空 DM 幂等保留」。
3. **git 时序自洽**：`cleanupEmptyDms` 的引入（`718c37e`, 2026-09-06）晚于该测试的最后改动（`49ad42f`, 2026-09-05）一天，两次 project-trust 相关重构（`eb7c423` 2026-08-20、`8e46848` 2026-09-04）也都晚于该测试的最后改动（`df985ca` 2026-08-14）。三次都是「代码先动、测试没动」，不是「测试揭示了回归」。

### 5.2 若按「修起来的工作量 × 风险」排序（供下一票决定先后）

虽然产品代码不必动，但 3 条失败**必须修**才能把全量接进门禁。排序如下，全部为**只改测试**：

| # | 失败 | 修哪一侧 | 建议修法 | 工作量 | 风险 |
| --- | --- | --- | --- | --- | --- |
| 1 | `data-layer.test.mjs:260` 期望 `3` | **只改测试** | 把断言改成 `2`，并把 `:258` 的注释「幂等重跑：数据不变」改为反映新语义（重跑会回收空 DM）。**注意别顺手改成「不重跑」** —— 该测试的价值正是验证 v11→v12 迁移幂等。 | 1 行 + 1 行注释 | 低。但需人确认「`#all` + `ch1` = 2」是想要的期望，而非把 DM 删掉这件事本身有问题（后者已有 `dm.test.mjs` 覆盖，可视为已确认） |
| 2 | `project-trust.test.mjs:117` `registry.trackStarting` | **只改测试** | 断言改为 `/trackStarting\(sessionCwd\)/`（去掉 `registry.` 前缀），与 `caller.ts:68` 现形一致 | 1 行正则 | 低 |
| 3 | `project-trust.test.mjs:93` + `:94` `modelsSource` | **只改测试** | 断言对象从 `app/api/models/route.ts` 改为 `lib/model-listing.ts`（该文件现持 `projectTrustReloadOptions(cwd, agentDir)` 与 `resourceLoaderReloadOptions: trustReloadOptions`） | 2 行（含改 `readFile` 路径） | 低 |
| 4 | `project-trust.test.mjs:118` `registrySource` `realpathSync` | **只改测试** | 断言对象改为 `lib/cwd-mutex.ts`（其 `:36` 为 `realpathSync(resolved)`） | 1 行 | 低 |

**⇒ 合计 4 处断言改动、0 处产品代码改动**，即可让全量 852/852 变绿（其中 #4 当前被 #2 遮蔽、#3 的第二处被 #3 的第一处遮蔽，**必须一次性改完**，否则会以为修好了却仍红）。

### 5.3 一条需要人判断、但不属于本票修复范围的观察

`docs/engineering-standards.md:38` 写明本仓测试原则是「**只测外部行为，不测实现细节**」，而 `:35` 又把「路由源码级断言（`readFile` 断言源码含正确调用）」列为四类测试之一。`lib/project-trust.test.mjs` 属于后者，它 grep 的 4 处字面量**恰好全部是纯实现细节**（参数名 `cwd` vs `sessionCwd`、`registry.` 前缀有没有、`realpathSync` 在哪个文件），因此**这 4 条断言无论怎么打补丁，下次重构仍会再红一次**。

这不是「测试写错了」，而是这类测试的固有代价 —— 仓库已明确选择了这个模式（薄路由不值得起 HTTP server）。是否要把这 4 条从「grep 字面量」改成「行为断言」，属于**需要人判断的取舍**（改写成本 vs 继续接受漂移），本票只把事实摆出来，不代做决定。

## 6. 落地建议（**本票不执行**，供下一票决策）

三个可算的选项，代价全部实测过：

| 选项 | 做法 | 测试数 | 文件数 | 覆盖 | 墙钟代价 | 遗留 |
| --- | --- | --- | --- | --- | --- | --- |
| **A 维持现状** | 不动 | 471 | 47 | 55.3% 测试 / 39.8% 文件 | 基准 | 381 条测试继续不可见；**下次重构再无人发现** |
| **B 只接全绿的** | 门禁加 69 个全绿文件，跳过 2 个失败文件 | **827** | 116 | 97.1% 测试 / 98.3% 文件 | ≈ +3.7 s | 留下 2 个文件的 25 条测试在门外；`data-layer`（20 条，含 schema 迁移回归）恰好是最该进门禁的那类 |
| **C 修 4 处断言后接全量** | 按 §5.2 改 4 处测试断言，再接全量 | **852** | 118 | **100%** | ≈ +1.0~4.3 s | 无 |

墙钟实测依据（`duration_ms`）：

```console
$ grep -E '^. duration_ms ' B-full.log B-rerun2.log B-rerun3.log
10211.212584      # 首次全量
7361.317959       # 复跑 2
6772.786542       # 复跑 3
$ ( time npm test )   # 对照组
real	0m5.934s
```

**全量 6.8–10.2 s vs 门禁 5.9 s** —— 增量约 1–4 秒。这是本次体检最重要的结论之一：**381 条测试的回归覆盖，代价不到 5 秒。覆盖缺口不是成本问题，纯粹是维护漂移问题。**

### 6.1 建议命令（已实测可用；关键在引号）

```bash
node --test --test-timeout=60000 'lib/**/*.test.mjs' 'app/**/*.test.mjs' 'components/**/*.test.mjs' 'hooks/**/*.test.mjs'
```

三种写法的实测差异 —— **这是最容易踩的坑，值得单列**：

```console
# [1] 加引号的 '**'（递归，正确）—— 推荐
$ node --test 'lib/**/file-dirent.test.mjs' 2>&1 | grep -E '^. (tests|pass|fail) '
ℹ tests 3
ℹ pass 3
ℹ fail 0

# [2] 加引号的 brace（也正确，但本仓目录固定，用 '**' 更省事）
$ node --test 'lib/{ansi,node-version,file-dirent}.test.mjs' 2>&1 | grep -E '^. (tests|pass|fail) '
ℹ tests 12
ℹ pass 12
ℹ fail 0

# [3] 不加引号的 ** —— 危险：不报错，而是静默只跑一层！
$ node --test lib/**/*.test.mjs 2>&1 | grep -E '^. (tests|pass|fail) '
ℹ tests 171        # ← 不是 852！bash 先把 ** 当成一层展开
ℹ pass 170
ℹ fail 1

# [4] 目录形式 —— 直接坏掉
$ node --test lib/i18n 2>&1 | grep -E '^. (tests|pass|fail) |Cannot find' | head -1
Error: Cannot find module '/Users/apple/orca/workspaces/worksplice/test-gate-audit/lib/i18n'
```

**[3] 是最危险的一种**：`lib/**/*.test.mjs` 不加引号时不报错、不警告，只是被 `bash` 先展开成单层（`lib/*/*.test.mjs`），静默只跑到 **171 条**。如果落地时有人漏了引号，门禁会「绿」但只覆盖 20% —— 比现在的显式清单还危险。所以引号是硬要求，不是风格偏好。

### 6.2 `--test-timeout` 建议保留

本次实测 `cancelled = 0`（§3.3），所以 `--test-timeout` **当前不改变任何结果**。仍然建议保留，理由是它是唯一能把「将来某个测试挂住」从「门禁永久卡死」变成「一条可归因的 cancelled」的机制 —— 而 §3.4 已确认有 8 处平台敏感分支（symlink 权限、平台判断）会在别的环境里表现不同，正是挂住风险较高的形状。代价为 0。

### 6.3 顺带值得考虑的两件事（均超出本票授权，仅记录）

1. **`docs/engineering-standards.md:25/28/48` 把这条清单称作「全量基线」**，与实测（55.3%）不符。落地时若改了门禁，这三处措辞应同步 —— 否则下一个读者仍会以为「全量」已经有人核对过。
2. **仓库无 CI**（§2.4），`docs/engineering-standards.md:54` 写明「本地 gate 即 CI」。门禁扩大后，仍没有任何机器会替我们执行它。若将来上 CI，§3.4 提到的 `t.skip` 静默跳过问题会第一次显形（届时应统计 skipped 而非只看 pass/fail）。

## 7. 证据索引

每条结论 → 产生它的命令 + 真实输出落点。所有输出均在 commit `3bd7a03`、本票 worktree 独立 `bun install`、Node v25.0.0 / bun 1.3.14 / macOS 上取得。

| # | 结论 | 命令 | 真实输出落点 |
| --- | --- | --- | --- |
| 1 | 全仓 118 个 `.test.mjs`；lib 100 / components 13 / hooks 4 / app 1 | `find . -name '*.test.mjs' -not -path './node_modules/*' -not -path './.next/*' \| wc -l`（及按顶层目录 `cut -d/ -f1 \| sort \| uniq -c`） | §2.3 |
| 2 | 无 `.ts/.tsx/.js` 形态的第二种测试文件 | `git ls-files '*.test.ts' '*.test.tsx' '*.test.js' \| wc -l` → `0` | §2.3 |
| 3 | 本 worktree 无 `.scratch/`，故 118 即全量口径、无排除项 | `git ls-files '*.test.mjs' \| grep '^\.scratch/'` → 空；`ls .scratch` → `No such file or directory` | §2.3 |
| 4 | 门禁是显式清单，列于 `package.json:39` | `grep -n '"test"' package.json` | §2.1 |
| 5 | 门禁覆盖 47 文件；`gate ⊆ all`；差集 71 文件（lib 56 / components 11 / hooks 3 / app 1） | `ls <9 条 glob> \| wc -l` → 47；`comm -23 gate-47 all-118` → 空；`comm -13 gate-47 all-118 \| wc -l` → 71 | §2.3 |
| 6 | `AGENTS.md:492` 把「`npm test` 全绿」定为每票验收标准 | `grep -n 'npm test' AGENTS.md` → `492:` | §2.2 |
| 7 | 仓库无 CI（`.github/workflows/` 不存在） | `ls -la .github/workflows/` → `No such file or directory` | §2.4 |
| 8 | 标准文档称门禁为「全量基线」，且用例数已漂移（343 / 347 / 471） | `grep -n 'npm test' docs/*.md docs/adr/*.md`；读 `docs/engineering-standards.md:25,28,48` | §2.4 |
| 9 | **A 组 = 471 tests / 471 pass / 0 fail / 0 cancelled，5.9 s** | `npm test` | §3.1 |
| 10 | **B 组 = 852 tests / 849 pass / 3 fail / 0 cancelled** | `node --test --test-timeout=60000 'lib/**/*.test.mjs' 'app/**/*.test.mjs' 'components/**/*.test.mjs' 'hooks/**/*.test.mjs'` | §3.1 |
| 11 | **此前不可见测试 = 381 条**（852−471），在 71 个文件里 | B 组汇总减 A 组汇总；并由逐文件 TSV 分组求和独立复核（`unseen: files=71 tests=381`） | §3.1、§3.2 |
| 12 | 118 个文件全部执行、无加载失败；逐文件求和与聚合跑逐项吻合 | 118 次单文件 `node --test` → TSV → `awk` 求和 → `files=118 tests=852 pass=849 fail=3 cancelled=0` | §3.2 |
| 13 | 门禁内 47 文件逐文件求和 = 471 tests，与 `npm test` 吻合（双路印证） | `join gate-47 perfile.tsv \| awk 求和` → `A: files=47 tests=471 pass=471 fail=0` | §3.2 |
| 14 | 超时取消 = 0（三次运行 `cancelled` 均为 0；`skipped`/`todo` 亦为 0） | 3 次全量运行的 `ℹ` 汇总行 | §3.3 |
| 15 | 零 flake：3 次运行数字与失败集完全一致 | 同上 3 次运行 + `grep '^✖'` 比对 | §3.3 |
| 16 | 8 处平台敏感分支，均自守卫、无真实网络/凭证依赖 | `grep -nE '\bt\.skip\|process\.platform\|HTTP_PROXY\|WORKSPLICE_DATA_DIR' <71 文件>`；读 `lib/http-dispatcher.test.mjs:24,40,71,78,84`（`.invalid` 为 RFC 2606 保留域） | §3.4 |
| 17 | 失败共 3 条 / 2 文件，**均不在门禁内** | `grep -E 'data-layer\|project-trust' gate-47.txt` → 空 | §4.1 |
| 18 | 失败 A 报错原文（`project-trust.test.mjs:93:10`） | 单文件 `node --test lib/project-trust.test.mjs`；TAP 段 `not ok 724` | §4.2 |
| 19 | 失败 B 报错原文（`project-trust.test.mjs:117:10`） | 同上；TAP 段 `not ok 725` | §4.2 |
| 20 | **实际有 4 条断言过期**（`L93`/`L94`/`L117`/`L118`），其余 13 条 PASS | `node --input-type=module -e '<逐条 assert.match 求值>'`（只读，不落文件） | §4.2 |
| 21 | 护栏是搬家不是消失：`model-listing.ts:66` 仍持 `projectTrustReloadOptions(cwd, agentDir)` | 读 `lib/model-listing.ts:53-70`；探针末行 `PASS model-listing.ts HAS …` | §4.2、§5.1 |
| 22 | `caller.ts` 于 `eb7c423`(2026-08-20) 改为直连 `cwd-mutex`；`registry.ts:66` 保留委托 | `git log -S 'cleanupEmptyDms' …`；`git log -- lib/cwd-mutex.ts`；`grep -n 'trackStarting' lib/ app/`；读 `lib/cwd-mutex.ts:87` | §4.2 |
| 23 | 失败 C 报错原文（`data-layer.test.mjs:260:10`，`2 !== 3`） | 单文件 `node --test lib/data/data-layer.test.mjs`；TAP 段 `not ok 333` | §4.3 |
| 24 | `seed()` 每次无条件插 `#all`；`cleanupEmptyDms` 每次无条件删空 DM | 读 `lib/data/schema.ts:199-216`（`runMigrations`）、`:307-312`（`seed`）、`:338-367`（`cleanupEmptyDms`）、`:364-366`（删除 SQL） | §4.3 |
| 25 | fixture 从不插 `messages` 行 → 空 DM 必被回收（失败稳定复现） | 读 `lib/data/data-layer.test.mjs:182-223`（仅 4 张 `CREATE TABLE`，无 `messages`） | §4.3 |
| 26 | `3` 曾是正确的；`cleanupEmptyDms` 引入晚于该测试最后改动一天 | `git log --date=short -- lib/data/data-layer.test.mjs` → `49ad42f 2026-09-05`；`git log -S 'cleanupEmptyDms' -- lib/data/schema.ts` → `718c37e 2026-09-06` | §4.3 |
| 27 | 新行为另有正式测试且通过 | 读 `lib/domain/raft/dm.test.mjs:121` | §4.3、§5.1 |
| 28 | 真实缺陷 = 0（三重否证） | 由 #20、#21、#26、#27 合成 | §5.1 |
| 29 | 修复面 = 4 处测试断言、0 处产品代码 | 由 #18–#27 逐条归位；改动清单见 §5.2 | §5.2 |
| 30 | 该测试 grep 的全是实现细节，与本仓「只测外部行为」原则相悖 | 读 `docs/engineering-standards.md:35,38` | §5.3 |
| 31 | 选项 A/B/C 的可算覆盖（471 / 827 / 852） | `awk` 按 perfile.tsv 分组求和 → `A: 55.3%`、`B: 471+356=827 (97.1%)`、`C: 852 (100%)` | §6 |
| 32 | 全量墙钟 6.8–10.2 s vs 门禁 5.9 s | 3 次全量 `ℹ duration_ms` + `( time npm test )` | §6 |
| 33 | 引号是硬要求：不加引号静默只跑 171 条；目录形式直接报错 | 4 组 `node --test` 变体实测（`[1]`–`[4]`） | §6.1 |
| 34 | `--test-timeout` 当前不改变结果（`cancelled=0`），建议保留作挂住护栏 | 3 次运行汇总行 + #16 | §6.2 |

**统计：本文档共 34 条编号结论，其中 34 条带「命令 + 真实输出」支撑，0 条无输出支撑。** 无「预计 / 应该 / 可能」类断言；凡未能确定根因者一律标注「根因未定」并列出已排除项 —— 本次**没有出现**「根因未定」的条目（3 条失败全部定到提交级根因）。
