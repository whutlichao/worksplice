# pi SDK 升级 spike：0.83.0 → 0.99.2 实跑报告

> 这是一份**可执行实验**的记录，不是评估。上一份 `docs/pi-sdk-upgrade-assessment.md`
> 解包 tarball 比对类型声明、**没有装包**；本文件在本仓的一个一次性 worktree 里
> **真的把四个包升到 0.99.2、真的跑构建与测试、真的起 `AgentSession`**，
> 回答那份报告 §6 第 0 步声明「只能靠实际装包 + 实跑来回答」的三个问题，
> 并**尝试证伪那份报告的核心论断**。
>
> **本 PR 不含任何升级。** `package.json` / `bun.lock` / `next.config.ts`
> 在实验中被临时改动，交付前已逐字还原（见 §2.4 的真实输出）。
> 唯一交付物是本文件。
>
> 取证纪律：一手来源只有**实跑输出**、**装出来的包源码**、**本仓代码**。
> 二手来源（博客、升级指南、第三方 changelog 摘要）一律不采信；
> 只能靠二手来源支撑的内容标注「未经一手核实」。
> **每条结论都带命令 + 该命令的真实输出**，落点见 §6。

---

## 1. 结论（TL;DR）

### 三个问题

| # | 问题（评估报告 §6 第 0 步原文） | 结论 | 验证强度 |
|---|---|---|---|
| **Q1** | 6 个新传递依赖（尤其 `quickjs-wasi` 这个 WASM）是否需要进 `next.config.ts:31-38` 的 `serverExternalPackages`？ | **不需要，一个都不要加。** 6 个新依赖全部在已 external 的 `@earendil-works/pi-coding-agent` 之下，webpack 根本不遍历它们；实测 import 顶层入口成功（156 个具名导出、1302 个模块），`quickjs-wasi` **在 import 期完全未被求值**，`.wasm` 资源加载数 = **0**。构建新增警告数 = **0**。 | **已实跑验证** |
| **Q2** | 空 systemPrompt 应该改成「追加一条空 system message」还是「不再覆盖」？ | **两个都不对。** 「追加空 system message」被实测证明是 **no-op**（prompt 长度 79 → 79）；「不再覆盖」也不对，因为 0.99.2 下真正发给模型的 prompt 已经和 `agent.state.systemPrompt` **解耦**（前者 1819 字符、后者 0），workesplice 想清的那 1819 字符**在 0.99.2 里根本不在 `agent.state` 上**。**0.83.0 的对照组**显示这个覆盖**曾经是承重的**（1780 → 0），所以这是一次真回归。正确通道是 `before_agent_start` 的 `systemPromptOptions`，不是 system message。 | **已实跑验证**（含 0.83.0 对照组） |
| **Q3** | `UsageEntry.usage` 与 `message.usage` 是否会双算？`kind: "cache_warm"` 该不该进面向用户的成本看板？ | **不会双算，而且 `cache_warm` 必须进。** 全 SDK 只有一处调 `appendUsage`（`dist/core/cache-warmer.js:249`），它记的是 cache warmer 自己发的一次独立 `streamSimple` 请求，那条 message **从不作为 `message` 条目落进 transcript** ⇒ 两个来源天然不相交，**不需要任何去重逻辑**。而 cache warming **默认就是开的**（`getCacheWarmingMode()` 未设置时返回 `"streaming"`），所以这是用户已经在付、worksplice 现在**完全看不见**的钱：同一份 fixture 上 worksplice 报 0.05、SDK 报 0.11。 | **已实跑验证**（含 0.83.0 对照组） |

### ★ 第四件：核心论断被证伪

**`docs/pi-sdk-upgrade-assessment.md` §1 的核心论断「类型层几乎全绿，`tsc` 不会报错」不成立。**
`tsc --noEmit` 在 0.99.2 下报 **3 个错误**，基线 0.83.0 下报 **0 个**：

```
app/api/auth/api-key/[provider]/route.ts(34,47): error TS2345: Argument of type
  '{ notify: () => void; prompt: (prompt: AuthPrompt) => Promise<string>; }' is not
  assignable to parameter of type 'ProviderAuthInteraction'.
  Property 'signal' is missing in type '...' but required in type '{ signal: AbortSignal; }'.
lib/rpc/caller.ts(146,55): error TS2345: Argument of type 'AgentSession' is not assignable
  to parameter of type 'AgentSessionLike'.
  The types returned by 'steer(...)' are incompatible between these types.
    Type 'Promise<QueuedInputDisposition>' is not assignable to type 'Promise<void>'.
lib/rpc/caller.ts(149,47): error TS2345: ...（同上，同一处构造点）
```

**报告此判断不成立。** 详见 §3。

同时，**更值得写进结论的是这 3 个错误的形状**：

- **`npm test` 在两版都是 471 pass / 0 fail，一字不差。** 也就是说
  **测试套件对这 3 个断裂完全失明**——唯一抓住它们的是 `tsc`。
  而报告 §6 第 2 步写的是「装包后第一件事是 `tsc --noEmit`」，
  方向对；但报告没意识到**这一步是唯一的一道闸**：
  少了它，升级会带着 3 个类型断裂静默进 main，而 CI 的测试门禁一声不响。
- 3 个错误里有 **2 个正是报告预言的那个对撞点**（`lib/rpc/caller.ts:146/149`
  把真实 `AgentSession` 赋给本仓镜像 `AgentSessionLike`）。
  报告说「这一层的报错预计很少」——**实测 3 个里有 2 个在这里，命中率 2/3，不是「很少」**。
- 第 3 个错误（`ProviderAuthInteraction.signal`）**根本不在镜像的覆盖范围内**：
  `lib/pi-types.ts` 只镜像 `AgentSession`，认证交互对象是 SDK 直接类型。
  报告 §3.2-D 把 `app/api/auth/api-key/[provider]/route.ts` 列进盘点，
  但 §4 逐条变更里**一条都没写它**——这是一条被漏掉的 breaking change。

### English summary

> **Executable spike: upgraded the four `@earendil-works/pi-*` packages 0.83.0 → 0.99.2 for
> real, ran the build and the test suite, and started a real `AgentSession`. The assessment
> report's load-bearing claim — "the type surface is almost entirely green, `tsc` will not
> complain" — is falsified: `tsc --noEmit` reports 3 errors at 0.99.2 versus 0 at 0.83.0,
> while `npm test` reports an identical 471 pass / 0 fail on both, so the test suite is blind
> to all three breaks and `tsc` is the only gate that catches them. Two of the three land on
> exactly the mirror-collision point the report predicted; the third (`ProviderAuthInteraction`
> now requiring `signal`) is outside the mirror entirely and the report never mentions it.
> The six new transitive dependencies need no `serverExternalPackages` change: all six sit
> behind the already-external `pi-coding-agent`, the import succeeds, and `quickjs-wasi` is
> never evaluated at import time (zero `.wasm` loads). The report's proposed fix for the
> read-only `systemPrompt` is wrong in both directions — appending an empty system message is
> measurably a no-op — and `kind: "cache_warm"` usage entries do not double-count (the cache
> warmer's request never lands in the transcript as a message) but must be counted, because
> cache warming is on by default and worksplice currently under-reports cost by 2.2× on the
> same fixture.

---

## 2. 实验设置

### 2.1 环境

```
$ node --version
v25.0.0
$ /Users/apple/.bun/bin/bun --version
1.3.14
$ git rev-parse --abbrev-ref HEAD
whutlichao/pi-sdk-spike
$ git merge-base HEAD origin/main
e890362a5471dd98bf67f17ec6c44576846c7b36
```

- worktree：`/Users/apple/orca/workspaces/worksplice/pi-sdk-spike`（一次性，用完即弃）
- base commit：`e890362`（与 spec 给的 base 一致，已用 `git merge-base HEAD origin/main` 复核）
- 包管理器全程 **`bun`**，理由见 §2.3

### 2.2 方法（顺序即控制组）

| 步 | 动作 | 记录 |
|---|---|---|
| 1 | **基线**：`bun install`（pin 0.83.0）→ `tsc --noEmit` → `npm test` → `bun run build` | §3.1、§3.2 |
| 2 | **升级**：四包同改到 `0.99.2`，`bun update` | §2.3 |
| 3 | **复测**：`tsc --noEmit` → `npm test` → `bun run build` | §3.1、§3.2 |
| 4 | **三场景**：Q1 打包面 / Q2 systemPrompt / Q3 usage 去重 | §4 |
| 5 | **对照**：降回 0.83.0，重跑 Q2 / Q3 的行为对照组 + 0.83.0 的 build | §4.2、§4.3、§3.2 |
| 6 | **还原**：`package.json` / `bun.lock` / `next.config.ts` 逐字还原 | §2.4 |

`next.config.ts` **全程未改**——Q1 的结论是「不用改」，所以没有可改之处，
§2.4 用 `git diff` 证明它与 base 逐字相同。

### 2.3 ★ 一个必须写进实施票的发现：只改 `bun.lock` 的 workspace 段**装不上 0.99.2**

评估报告 §6 第 1 步写「`package.json:43-46` 四行同时改，`bun.lock:8-11` 同步更新」。
**这不够。** 只改这 8 行之后跑 `bun install`，bun 会**静默地继续装 0.83.0**：

```
$ sed -i '' '43,46s/"0\.83\.0"/"0.99.2"/' package.json
$ sed -i '' '8,11s/"0\.83\.0"/"0.99.2"/' bun.lock
$ sed -n '8,11p' bun.lock
        "@earendil-works/pi-agent-core": "0.99.2",
        "@earendil-works/pi-ai": "0.99.2",
        "@earendil-works/pi-coding-agent": "0.99.2",
        "@earendil-works/pi-tui": "0.99.2",

$ bun install
Checked 1116 installs across 1139 packages (no changes) [220.00ms]

$ node -e "…read pi-coding-agent/package.json…"
0.83.0          # ← 精确 pin 写着 0.99.2，装出来的却是 0.83.0
$ bun pm ls | grep -i earendil
├── @earendil-works/pi-agent-core@0.83.0
├── @earendil-works/pi-ai@0.83.0
├── @earendil-works/pi-coding-agent@0.83.0
├── @earendil-works/pi-tui@0.83.0
```

`bun install --force` 也是同样结果（`1056 packages installed`，版本仍 0.83.0）。
原因在 `bun.lock` 的结构：workspace 段（`:8-11`，声明**需求**）之外还有一张
`packages` 段（`:179-185`，记录**已解析的版本 + sha512**），后者仍然是
`["@earendil-works/pi-agent-core@0.83.0", …, "sha512-RorGp9OH5…"]`。
bun 把 `packages` 段当权威，**不会因为 workspace 段的精确 pin 变了就去重解析**。

**可行的做法**是 `bun update`（它只重解析被点名的包及其子树）：

```
$ bun update @earendil-works/pi-agent-core@0.99.2 \
             @earendil-works/pi-ai@0.99.2 \
             @earendil-works/pi-coding-agent@0.99.2 \
             @earendil-works/pi-tui@0.99.2
bun update v1.3.14 (0d9b296a)
Resolving dependencies
Resolved, downloaded and extracted [198]
Saved lockfile
…
installed @earendil-works/pi-agent-core@0.99.2
installed @earendil-works/pi-ai@0.99.2 with binaries: - pi-ai
installed @earendil-works/pi-coding-agent@0.99.2 with binaries: - pi
installed @earendil-works/pi-tui@0.99.2

288 packages installed [9.30s]
```

**对照组纯净性**（`bun update` 只动被点名的子树，非 pi 的直接依赖一个都没漂）：

```
$ for p in react react-dom lucide-react next better-sqlite3 undici proper-lockfile \
           typescript eslint mermaid; do …read $p/package.json…; done
react            19.2.4
react-dom        19.2.4
lucide-react     1.39.0
next             16.2.12
better-sqlite3   13.0.2
undici           8.5.0
proper-lockfile  4.1.2
typescript       5.9.3
eslint           9.39.4
mermaid          11.14.0
```

（`undici` 顶层仍停在 8.5.0 是因为 `package.json` 精确 pin 8.5.0，
bun 把它去重到了顶层；`pi-coding-agent@0.99.2` 内部声明的 `8.10.2` 因此未被使用。
这与基线一致，**不是升级引入的漂移**。）

> 反面记录：第一次尝试时我删掉 `bun.lock` 的 4 条 `packages` 条目再 `bun install`，
> 确实装上了 0.99.2，但 bun 顺手把所有 `^` 范围的包一起重解析了
> （`react` 19.2.4 → 19.3.0、`lucide-react` 1.39.0 → 1.49.0、`mermaid` 11.14.0 → 11.17.2 …），
> 对照组被污染。**这正是「用 `bun update` 而不是裸 `bun install`」的理由**，
> 也是评估报告 §2.1「`bun install` 可复现」这句话在升级场景下不够用的地方。

### 2.4 还原的证明

```
$ git checkout -- package.json bun.lock next.config.ts
$ rm -rf .spike .next

$ git status --porcelain
(empty)

$ ls package-lock.json
ls: package-lock.json: No such file or directory

$ git diff --name-status e890362 -- package.json bun.lock next.config.ts
(empty — 三个文件与 base 逐字相同)
```

`package-lock.json` 全程未生成（`.gitignore:44-45` 只忽略 `package-lock.json` /
`pnpm-lock.yaml`，若生成会出现在 `git status` 里——它是空的）。

---

## 3. 证伪结果

### 3.1 ★ 数字对照表（本报告最硬的一张表）

| 指标 | 基线 `0.83.0` | `0.99.2` | 差 |
|---|---|---|---|
| **`tsc --noEmit` 错误数** | **0** | **3** | **+3** |
| **`npm test` pass** | **471** | **471** | 0 |
| **`npm test` fail** | **0** | **0** | 0 |
| `npm test` 退出码 | 0 | 0 | — |
| `bun run build` 退出码 | **0** | **1** | **+1** |
| `bun run build` webpack 编译 | ✓ Compiled successfully in 13.6s | ✓ Compiled successfully in 15.4s | 成功 |
| `bun run build` 编译警告数 | 1 | 1 | **0（无新增）** |
| `bun run build` 失败阶段 | — | `Running TypeScript … Failed to type check` | 类型门禁 |

**两边都是本 worktree 自己跑出来的。** 上表不含任何来自其他 worktree 的历史数字。

原始输出（截取关键行）：

```
# ── 基线 0.83.0 ──
$ node_modules/.bin/tsc --noEmit ; echo "EXIT=$?"
EXIT=0
$ node_modules/.bin/tsc --noEmit 2>&1 | wc -l
0                                    # 零行输出

$ npm test | tail -8
ℹ tests 471
ℹ suites 0
ℹ pass 471
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4323.76525

# ── 0.99.2 ──
$ node_modules/.bin/tsc --noEmit ; echo "EXIT=$?"
EXIT=2
$ node_modules/.bin/tsc --noEmit 2>&1 | grep -cE "error TS"
3

$ npm test | tail -8
ℹ tests 471
ℹ suites 0
ℹ pass 471
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3648.557375
```

### 3.2 结论：**报告此判断不成立**

`docs/pi-sdk-upgrade-assessment.md` §1 的原话是：

> **类型层几乎全绿，`tsc` 不会报错**

以及 §6 第 2 步的验收标准：

> **预期 `tsc` 会报的**（本报告已预判）：… `AgentSessionLike` 的 39 个成员已核实全部存在，
> 所以**这一层的报错预计很少**。
> **验收**：`tsc --noEmit` 零错误。

**实测：`tsc --noEmit` 报 3 个错误。这条判断不成立。**

#### 三个错误逐条拆解

##### 错误 1 —— `ProviderAuthInteraction` 新增**必填** `signal`

```
app/api/auth/api-key/[provider]/route.ts(34,47): error TS2345: Argument of type
'{ notify: () => void; prompt: (prompt: AuthPrompt) => Promise<string>; }' is not
assignable to parameter of type 'ProviderAuthInteraction'.
  Property 'signal' is missing in type '{ notify: () => void; prompt: (prompt: AuthPrompt) => Promise<string>; }'
  but required in type '{ signal: AbortSignal; }'.
```

供给侧证据（`pi-ai`）：

```
$ grep -n "AuthInteraction" -A 5 node_modules/@earendil-works/pi-ai/dist/auth/types.d.ts   # 0.99.2
157:export interface AuthInteraction {
158-    signal?: AbortSignal;          # ← 可选
159-    prompt(prompt: AuthPrompt): Promise<string>;
160-    notify(event: AuthEvent): void;
161-}
162-/** Normalized interaction passed to provider login implementations. */
163:export type ProviderAuthInteraction = AuthInteraction & {
164-    signal: AbortSignal;           # ← 新类型，把 signal 收成必填
165-};
166:export interface ApiKeyAuth {
      （grep 输出在此跳过了 167-173 行）
174-    login?(interaction: ProviderAuthInteraction): Promise<ApiKeyCredential>;
```

```
$ grep -n "AuthInteraction" -A 5 …/earendil-works-pi-ai-0.83.0/dist/auth/types.d.ts            # 0.83.0
153:export interface AuthInteraction {
154-    signal?: AbortSignal;
155-    prompt(prompt: AuthPrompt): Promise<string>;
156-    notify(event: AuthEvent): void;
157-}
166-    login?(interaction: AuthInteraction): Promise<ApiKeyCredential>;
```

⇒ 0.99.2 引入了**新类型** `ProviderAuthInteraction`（`AuthInteraction` 上把 `signal`
从可选收成必填），并把 `ApiKeyAuth.login` / `OAuthProvider.login` 的入参从
`AuthInteraction` 换成它。`ProviderAuthInteraction` 这个名字在 0.83.0 里
**零命中**（`grep` 只见 `AuthInteraction`）。

**为什么报告漏了它**：`lib/pi-types.ts` 的 `AgentSessionLike` 镜像只覆盖 `AgentSession`，
认证交互对象是 SDK 直接类型、不经镜像。所以这条断裂**没有经过任何抽象**，
`tsc` 看得见、报告的盘点却没写。评估报告 §3.2-D 把这个文件列进了影响面表，
但 §4 的六条逐条变更里**没有任何一条提到它**。

**修法（一行）**：`app/api/auth/api-key/[provider]/route.ts:34` 的对象字面量加
`signal: new AbortController().signal`。同一形状的 `auth/login/[provider]/route.ts`
没报错，说明它已经传了 `signal` 或走了别的通道——实施票要顺带核一遍。

##### 错误 2、3 —— `steer()` / `followUp()` 返回值从 `void` 变成 `QueuedInputDisposition`

```
lib/rpc/caller.ts(146,55): error TS2345: Argument of type 'AgentSession' is not assignable
to parameter of type 'AgentSessionLike'.
  The types returned by 'steer(...)' are incompatible between these types.
    Type 'Promise<QueuedInputDisposition>' is not assignable to type 'Promise<void>'.
      Type 'string' is not assignable to type 'void'.
lib/rpc/caller.ts(149,47): error TS2345: ...（同一条，同一处构造点）
```

供给侧证据（`pi-coding-agent`）：

```
$ grep -nE "^\s+(async )?(steer|followUp)\(" …/pi-coding-agent-0.83.0/dist/core/agent-session.d.ts
380:    steer(text: string, images?: ImageContent[]): Promise<void>;
388:    followUp(text: string, images?: ImageContent[]): Promise<void>;

$ grep -c "QueuedInputDisposition" …/pi-coding-agent-0.83.0/dist/core/agent-session.d.ts
0                                                    # 0.83.0 里这个符号不存在

$ sed -n '162,163p;518,531p' node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.d.ts
162:export type QueuedInputDisposition = "handled" | "queued";
163:export type PromptDisposition = QueuedInputDisposition | "started";
518:    steer(text: string, images?: ImageContent[], options?: {
519-        source?: InputSource;
520-    }): Promise<QueuedInputDisposition>;
529:    followUp(text: string, images?: ImageContent[], options?: {
530:        source?: InputSource;
531:    }): Promise<QueuedInputDisposition>;
```

上游 `CHANGELOG.md:83`（`## [0.99.0]` 段）把这条列为 **Added** 而非 Breaking：

> Added per-input disposition to successful RPC `prompt`, `steer`, and `follow_up` responses,
> `AgentSession.steer()`/`followUp()`, and `RpcClient.prompt()`/`steer()`/`followUp()`;
> `RpcClient.prompt()` also accepts `streamingBehavior`.

**它对 worksplice 的杀伤点正是本仓的镜像**：`lib/pi-types.ts:158-159`

```ts
steer(text: string, images?: Array<{ type: "image"; data: string; mimeType: string }>): Promise<void>;
followUp(text: string, images?: Array<{ type: "image"; data: string; mimeType: string }>): Promise<void>;
```

`Promise<void>` 是 `Promise<QueuedInputDisposition>` 的**严格子类型方向的反面**
（`string` 不可赋给 `void`），所以整个 `AgentSession` 都无法赋给 `AgentSessionLike`。
`lib/rpc/caller.ts:146`（`withExtensionTools(inner, toolNames)` 的实参）
与 `:149`（`new AgentSessionWrapper(inner)`）是全仓**仅有的两处**真实 SDK 类型与镜像对撞，
两条错误各落在其中一处。

**修法**：`lib/pi-types.ts:158-159` 的返回类型改成
`Promise<QueuedInputDisposition>`（或更保守地 `Promise<unknown>`）。
这两个 call site 都在丢弃返回值，改返回类型**不产生行为变化**。
`followUp` 与 `steer` 同时改——它们是对称的，漏一个就是下一次升级再撞一次。

> 顺带纠正报告 §4.7 的 X-5 一条：报告核实了 `getAllTools()` 的工具名**未加** `builtin:`
> 前缀，这一点本票没有重测（不在三问范围内），**沿用报告结论**。
> 但报告 §3.2-A 表格说 `AgentSession` 实例成员共 29 个 call site 行、
> §4.7 说 39 个镜像成员「一个都没少」——**「成员没少」与「类型全对」是两回事**，
> `steer`/`followUp` 正是成员在、类型变了的例子。报告用「成员计数」代替了
> 「逐成员类型比对」，这是它漏掉这两个错误的直接原因。

##### 一个报告没说、但更该写进结论的发现：**`npm test` 对这 3 个断裂完全失明**

`npm test` 在 0.83.0 与 0.99.2 上都是 **471 pass / 0 fail**，逐字相同（§3.1 表）。
本仓 471 个测试**没有一个**经过 `lib/rpc/caller.ts` 的构造路径或
`app/api/auth/api-key/[provider]/route.ts`，所以这 3 条断裂对它们不可见。

评估报告 §6 第 2 步写「装包后**第一件事**是 `tsc --noEmit`」——方向是对的，
但它把这步当成「顺手把类型对齐一下」，**没意识到这是唯一的一道闸**。
升级实施票必须把 `tsc --noEmit` 写成**硬门禁**而不是建议步骤：
测试门禁在这条升级上给的是**假绿**。

#### 承重墙判定

| 报告的论断 | 实测 | 判定 |
|---|---|---|
| 「类型层几乎全绿，`tsc` 不会报错」（§1） | `tsc` 3 errors | **不成立** |
| 「`AgentSessionLike` 39 个成员在 0.99.1 里一个都没少」（§4.7） | 成员确实都在，但 `steer`/`followUp` 的**类型**变了 | **成员计数成立，蕴含的「不会报错」不成立** |
| 「39 个成员已核实全部存在，所以这一层的报错预计很少」（§6 第 2 步） | 3 个错误里 2 个在这个对撞点 | **位置预判成立，量级预判偏低** |
| 「镜像会吃掉所有类型断裂」（spec 转述） | 3 个里镜像只挡住 0 个、反而**制造**了 2 个 | **不成立** |
| 「`lib/pi-types.ts` 手写镜像会**把最致命的一处类型断裂伪装成通过**」（§1） | B-1 的 `systemPrompt` 写入确实仍被伪装（见 §4.2 步骤 1 的实测 `TypeError`），但它**不是**最致命的——最致命的是测试门禁的假绿 | **方向成立，排序需更正** |
| 「B-4 的打包面需要实跑」（§6 第 0 步） | 实跑结论：`serverExternalPackages` **不用改** | **成立（本票给出答案）** |

---

## 4. 三个场景

### 4.1 Q1 —— 6 个新传递依赖要不要进 `serverExternalPackages`？

**结论：不用改，一个都不要加。** 已实跑验证。

#### 4.1.1 构建面：0.99.2 的编译警告与 0.83.0 **逐字相同**

```
# 0.99.2
$ bun run build ; echo "BUILD EXIT=$?"
$ next build --webpack
▲ Next.js 16.2.12 (webpack)
  Creating an optimized production build ...
⚠ Compiled with warnings in 9.3s
./app/api/sessions/[id]/export/route.ts
Critical dependency: the request of a dependency is an expression
Import trace for requested module:
./app/api/sessions/[id]/export/route.ts
✓ Compiled successfully in 15.4s
  Running TypeScript ...
Failed to type check.
app/api/auth/api-key/[provider]/route.ts:34:47
Type error: Argument of type '{ notify: () => void; … }' is not assignable to parameter of
type 'ProviderAuthInteraction'.  Property 'signal' is missing … but required in type
'{ signal: AbortSignal; }'.
BUILD EXIT=1

# 0.83.0（对照，同一台机器、同一份源码）
$ bun run build ; echo "BUILD EXIT=$?"
⚠ Compiled with warnings in 8.0s
./app/api/sessions/[id]/export/route.ts
Critical dependency: the request of a dependency is an expression
✓ Compiled successfully in 13.6s
BUILD EXIT=0
```

⇒ **webpack 编译阶段新增警告数 = 0。** 那条 `Critical dependency` 来自
`app/api/sessions/[id]/export/route.ts:25/57` 的动态 `resolver("@earendil-works/pi-coding-agent")`，
是**升级前就存在**的（本票用 0.83.0 的完整 build 做了对照，不是推断）。

⇒ **6 个新依赖没有触发任何 `Module not found` / `Can't resolve`。**

⇒ 顺带回答一个实施票必须知道的顺序问题：
`next build` **自带类型门禁**，所以 0.99.2 下 `bun run build` 会在打包成功之后、
类型检查阶段失败。**「跑一次 build 看打包面」这件事在 0.99.2 上必须先修掉那 3 个
类型错误才跑得完整**——本票的打包面结论取自 webpack 编译成功那一段，
类型门禁的失败单独归到 §3。

#### 4.1.2 为什么不用加：6 个依赖全在已 external 的包之下

```
$ grep -rhoE '"@earendil-works/pi-[a-z-]+"' .next/server | sort -u
"@earendil-works/pi-agent-core"
"@earendil-works/pi-ai"
"@earendil-works/pi-coding-agent"
"@earendil-works/pi-tui"
```

`next.config.ts:31-38` 的 `serverExternalPackages` 已经把四个包标为 external，
所以 webpack **只留一条运行时的 `import()`，从不遍历它们的依赖图**。
直接验证——6 个新依赖在编译产物里一个都搜不到：

```
$ for p in quickjs-wasi grok-mermaid pi-telemetry pi-codemode pi-mcp chord; do
    grep -rl "$p" .next/server | head -1 || true; done
quickjs-wasi     <not found in .next/server>
grok-mermaid     <not found in .next/server>
pi-telemetry     <not found in .next/server>
pi-codemode      <not found in .next/server>
pi-mcp           <not found in .next/server>
chord            <not found in .next/server>
```

**⇒ 打包面的问题本身是伪问题**：webpack 根本不会碰它们，
所以「要不要 external」对构建产物**没有任何影响**。

#### 4.1.3 那运行期呢？6 个里有几个会在 import 期被求值？

这是报告说「静态检查答不了」的那一半。用 `module.register()` 装一个 loader hook，
把 Node 真正求值的每个 specifier 落盘——不用计时启发式：

```
$ SPIKE_LOAD_LOG=.spike/load.log node .spike/runtime-import2.mjs
import("@earendil-works/pi-coding-agent") OK — 156 named exports
modules evaluated: 1302; distinct node_modules packages: 718

--- verdict on the 6 new transitive deps ---
  quickjs-wasi                     NOT evaluated at import time
  grok-mermaid                     EAGERLY EVALUATED at import time
  @earendil-works/pi-telemetry     EAGERLY EVALUATED at import time
  @earendil-works/pi-codemode      EAGERLY EVALUATED at import time
  @earendil-works/pi-mcp           EAGERLY EVALUATED at import time
  @earendil-works/chord            EAGERLY EVALUATED at import time

.wasm / quickjs URLs evaluated: 0
```

**⇒ 关键结论：报告最担心的那个 WASM 恰恰是唯一安全的那个。**

- import **成功**，156 个具名导出，无 `ERR_MODULE_NOT_FOUND`。
- 6 个里有 **5 个**在 import 期被急切求值（`pi-mcp` / `grok-mermaid` /
  `pi-telemetry` / `pi-codemode` / `chord`），它们都是纯 JS 包，
  从 `node_modules` 正常解析，**没有额外配置需求**。
- **`quickjs-wasi` 在 import 期完全不被求值**，`.wasm` 资源加载数 = **0**。
  它只在 codemode 沙箱真正被启用时才按需加载，而 worksplice 不启用 codemode。
  ⇒ 报告 §4.5 的「`quickjs-wasi` 是 WASM 运行时」这个事实没错，
  但它推出的风险（打包期找不到资源）**不成立**。

作为交叉验证，另做了一次**只跟静态 `import` / `export … from`** 的可达性分析
（动态 `import()` 记录但不遍历），从 `exports["."].import` = `./dist/index.js` 出发：

```
entry exports["."].import = "./dist/index.js"
static graph: 251 nodes (files + bare packages)

--- the 6 new transitive deps ---
  quickjs-wasi                     not statically reachable; no dynamic edge
  grok-mermaid                     STATIC-REACHABLE (via dist/modes/interactive/components/mermaid.js)
  @earendil-works/pi-telemetry     not statically reachable; no dynamic edge
  @earendil-works/pi-codemode      STATIC-REACHABLE (via dist/extensions/codemode/tool.js)
  @earendil-works/pi-mcp           STATIC-REACHABLE (via dist/extensions/mcp/tools.js)
  @earendil-works/chord            not statically reachable; no dynamic edge
```

（该分析的正则会把 bundle 里的字符串字面量误当 specifier，
静态图里因此有 `<pattern>:<thinking>` / `In Progress` 这类噪声包名。
**以 §4.1.3 的 loader hook 结果为准**，静态分析只作方向性佐证。
两者的分歧也有解释：`pi-telemetry` / `chord` 是经**动态** `import()` 链在
import 期被求值的，静态图自然看不到。）

#### 4.1.4 实施票怎么用这条结论

`next.config.ts:31-38` **保持原样，一行都不动。**
评估报告 §6 第 4 步的「视 B-4 的 spike 结论调整 `next.config.ts:31-38`」——
**结论是「不调」，该步可以删掉**。

**残留风险（如实记录）**：本票验证的是「import 顶层入口不炸」。
`quickjs-wasi` 的按需加载路径、`pi-mcp` 的子进程启动、`grok-mermaid` 的
渲染行为**都没有被触发过**（worksplice 也不走这些路径）。
⇒ **未经实跑验证的部分**：这 5 个包在**被真正调用**时的行为。
若实施票要更强的保证，可以在升级票的验收里加一条
「起一个 `PRESET_FULL` 会话并跑一次真实 prompt」——但那需要凭证，超出本票范围。

---

### 4.2 Q2 —— 空 systemPrompt 的正确修法

**结论：报告给的两个候选都不对。正确通道是 `before_agent_start` 的
`systemPromptOptions`，不是 system message。** 已实跑验证（含 0.83.0 对照组）。

#### 4.2.1 先确认 B-1 是真的：TypeError 精确复现

对着一个**真实的 `AgentSession`**（`tools: []`，隔离的临时 `agentDir`，
不发任何 provider 请求）跑 worksplice 的那一行：

```
isolated cwd      = /var/folders/…/T/ws-spike-cwd-SYPiSi
isolated agentDir = /var/folders/…/T/ws-spike-agent-6lNlVX  (no user config, no credentials)
services created; diagnostics = 0
AgentSession created: sessionId=01a0fa29-a8bb-753b-9cad-9a56fee6f7f5

=== the exact worksplice line, against a real AgentSession ===
THREW TypeError: Cannot set property systemPrompt of #<Object> which has only a getter
```

**不需要任何凭证**——`AgentSession` 的创建不碰认证，只有真正发 prompt 才需要。
所以 Q2 是**三个问题里唯一做到完全实跑验证的**。

#### 4.2.2 候选 A「追加一条空 system message」被实测证明是 no-op

上游把 system prompt 改成了**从 transcript 的 system message 回放**：

```ts
// pi-agent-core@0.99.2 dist/agent.js:36-39
get systemPrompt() { return getCurrentSystemPrompt(messages); }
```

而 `getCurrentSystemMessage` 的回放规则是
**把所有 system message 的非空文本用 `"\n\n"` 拼起来，空文本直接跳过**
（`if (text.length > 0) content.push(text)`）。
⇒ 追加一条 `content: ""` 的 system message **对拼出来的文本没有任何影响**。

实测（`Agent` 层，用一个 79 字符的 prompt）：

```
=== 2. fix candidate A: APPEND an empty system message (the report's proposal) ===
  messages now: 2, roles=[system,system]
  after appending {role:system, content:""}            systemPrompt.length=79
  ==> prompt length 79 -> 79: NOT cleared (append is a no-op for the text)
```

**⇒ 评估报告 §4.1 的修法「改为在 `session.sessionManager` 上追加一条空 system message」
是错的。它既不抛错，也不生效——比抛错更坏，因为它看起来修好了。**

对照实验（把首条 system message 的 `content` 换成 `""` 才是有效的）：

```
=== 3. fix candidate A': REPLACE the leading system message's content with "" ===
  after replacing content of messages[0]               systemPrompt.length=0     ""
  messages: 1, roles=[system]
  ==> prompt length = 0 (CLEARED)

=== 4. fix candidate A'': replace the whole transcript with no system message ===
  after dropping every system message                  systemPrompt.length=0     ""
  getCurrentSystemMessage(...) -> undefined

=== 5. fix candidate B: do not override at all ===
  leave agent.state.systemPrompt alone (tools=[])      systemPrompt.length=79
  ==> prompt length = 79, i.e. the full pi prompt survives
```

#### 4.2.3 候选 B「不再覆盖」也不对 —— 因为目标已经换了地方

这是本票在 Q2 上最重要的发现。对着真实 `AgentSession`（`tools: []`）：

```
state.messages roles = []
agent.state.systemPrompt length = 0            ← 已经是空的
session.systemPrompt     length = 1819         ← 真正的 prompt 在这里
getAllTools().length = 0; getActiveToolNames() = []
```

**0.99.2 里 `agent.state.systemPrompt` 与 `AgentSession.systemPrompt` 已经解耦。**
两个 getter 的实现对比：

```js
// pi-coding-agent@0.99.2 dist/core/agent-session.js:1036-1038
get systemPrompt() {
    return buildSystemPrompt(this._runSystemPromptOptions ?? this._baseSystemPromptOptions);
}

// pi-coding-agent@0.83.0 dist/core/agent-session.js:596-597
get systemPrompt() {
    return this.agent.state.systemPrompt;      // ← 同一个字符串
}
```

而且真正发给 provider 的 system message 是**每次请求现算**的，
在 `prompt()` 里被 unshift 进消息列表：

```js
// pi-coding-agent@0.99.2 dist/core/agent-session.js:1563-1567（prompt 路径）
const updateMessage = this._preparePromptAndToolLoadout(result.systemPromptOptions);
this._runSystemPromptOptions = result.systemPromptOptions;
if (updateMessage) messages.unshift(updateMessage);
await this._runAgentPrompt(messages);

// dist/core/agent-session.js:1247-1252
_preparePromptAndToolLoadout(options, messages = this.agent.state.messages) {
    …
    const sections = diffSystemPromptSections(
        getCurrentSystemMessage(messages)?.sections ?? {},
        buildSystemPromptSections(options));
    return sections ? { role: "system", content: "", sections, timestamp: Date.now() } : undefined;
}
```

注意这条 system message 的 `content` 是**空串**，prompt 文本装在 `sections` 里，
由 `getSystemMessageText` 在读取时渲染：

```js
// pi-ai@0.99.2 dist/utils/text.js:11-18
export function getSystemMessageText(message) {
    const parts = [contentText(message.content)];
    for (const text of Object.values(message.sections ?? {})) {
        if (text !== null) parts.push(text);
    }
    return parts.filter((part) => part.length > 0).join("\n\n");
}
```

**⇒ worksplice 想清的那 1819 字符，在 0.99.2 里根本不在 `agent.state` 上。**
`agent.state.systemPrompt = ""` 即使不抛错也是**语义空操作**——
它改的是一个 transcript 的只读投影，而 prompt 每次请求都从
`AgentSession` 自己的 options 重算。

#### 4.2.4 0.83.0 对照组：这个覆盖曾经是承重的

```
### control run against pi-coding-agent@0.83.0

=== Q2 control: PRESET_NONE (tools: []) on 0.83.0 ===
  agent.state.messages roles = []
  agent.state.systemPrompt length = 1780
  session.systemPrompt    length = 1780
  getActiveToolNames() = []
  worksplice's write: NO THROW
  after write: agent.state.systemPrompt length = 0
  after write: session.systemPrompt    length = 0  <-- did the override reach the prompt?
```

| | 0.83.0 | 0.99.2 |
|---|---|---|
| `agent.state.systemPrompt`（`tools: []`） | 1780 | **0** |
| `session.systemPrompt`（`tools: []`） | 1780 | **1819** |
| `agent.state.systemPrompt = ""` | 不抛错，且 `session.systemPrompt` → **0** | **抛 `TypeError`** |
| 覆盖是否承重 | **是**（0.83.0 下 `PRESET_NONE` 真的没有 system prompt） | **否**（覆盖打空的地方本来就是空的） |

（1780 → 1819 只是上游 prompt 文本在这 13 个版本间变长了，不是语义变化。）

**⇒ B-1 是一次真行为回归，不是误报**：`PRESET_NONE` 会话在 0.83.0 下
system prompt 为空，在 0.99.2 下会是 1819 字符的完整 pi prompt。
**但回归不在 `agent.state` 上，所以报告的修法全都打不中。**

#### 4.2.5 正确的通道

可写的面在 0.99.2 里是 **`systemPromptOptions`**（一个
`NormalizedBuildSystemPromptOptions`），由 `before_agent_start` 扩展处理器携带，
并有一个每次请求的投影钩子：

```
$ grep -n "forceSystemPrompt" dist/core/agent-session.js
1294:            const forced = this._runSystemPromptOptions?.forceSystemPrompt;

$ grep -n "systemPromptOptions\|readonly systemPrompt" -B2 dist/core/extensions/types.d.ts
699:    /** The current system prompt, rendered from systemPromptOptions and earlier handler changes. */
700:    readonly systemPrompt: string;
702:    systemPromptOptions: NormalizedBuildSystemPromptOptions;
```

同时 `agent.state.messages` 本身**有 setter**（`messages = nextMessages.slice()`），
所以「改 transcript」这条路在类型与运行期都走得通（§4.2.2 步骤 3 已实测有效，
且能扛过 `Agent.reset()`：`reset()` 用 `getCurrentSystemMessage` 保留 system 消息基线）。

```
=== 6. does an empty system message survive Agent.reset()? ===
  after Agent.reset()                                  systemPrompt.length=0     ""
```

**给实施票的建议（按推荐序）**：

1. **先做一个产品决策**：`PRESET_NONE` 到底要不要 system prompt？
   如果 0.99.2 的 `buildSystemPrompt` 在零工具下本就无害（1819 字符里有多少是
   工具指引？本票没测），那**最省的修法是直接删掉 `applyForcedEmptySystemPrompt` 整个方法
   + `caller.ts` 的 `setForceEmptySystemPrompt` 调用**，同时把
   `lib/pi-types.ts:131` 的 `systemPrompt` 标成 `readonly`（这一步报告说得对，必须做）。
2. 如果产品决策是「必须为空」：走 `before_agent_start` 返回 `systemPromptOptions`
   这条通道，**不要**走 system message（已证明是 no-op）。
   注意这条路需要注册一个 extension，改动面比 1 大。
3. **无论选哪条**，`lib/pi-types.ts:131` 标 `readonly` 是必须的——
   否则下一次同类写入会再次静默失败。报告 §6 第 3 步这条判断成立。

#### 4.2.6 未经实跑验证的部分

- `before_agent_start` 返回 `systemPromptOptions` 能否把 prompt 压到 0：
  **未实跑**。本票只验证了 `agent.state.systemPrompt` / `agent.state.messages` 两条路，
  没有注册 extension 去驱动 `before_agent_start`。
- 「零工具下 1819 字符的 prompt 对模型是否无害」：**未测**（需要真实 provider 请求）。
- 0.99.2 的 `AgentSession` 在**已有消息**的会话上重新打开时的 system message 状态：
  **未测**。本票的 `AgentSession` 都是新建的空会话。

---

### 4.3 Q3 —— `usage` / `context_edit` 的去重口径

**结论：不会双算（无需去重逻辑）；`cache_warm` 必须进成本看板，
因为 cache warming 默认就是开的。** 已实跑验证（含 0.83.0 对照组）。

#### 4.3.1 fixture 与两侧数字

合成一份 session jsonl（4 类条目齐全），**同一份文件**分别喂给
worksplice 的 `parseSessionFileStats()` 与 SDK 自己的 `getSessionStats()`：

```
fixture: …/2026-10-02T00-00-00_synthetic.jsonl
  assistant message e2 usage    : input=1000 output=200 cacheRead=5000 cacheWrite=100 cost=0.05
  usage e3 (cache_warm)         : cacheWrite=4096 cost=0.01
  usage e4 (request, DUP of e2) : identical numbers to e2
  context_edit e5 targets e2, replacement=null
```

```
=== 1. worksplice lib/session-stats.ts parseSessionFileStats() ===        # 0.99.2
{
  "messageCount": 3,
  "cachedTokens": 5000,
  "uncachedTokens": 1100,
  "totalTokens": 6300,
  "costTotal": 0.05,
  "compactionCount": 0,
  "compactionTokens": 0
}

=== 2. what the SDK's own getSessionStats() returns for the SAME file ===  # 0.99.2
{ "tokens": { "input": 2000, "output": 400, "cacheRead": 10000, "cacheWrite": 4296, "total": 16696 },
  "cost": 0.11000000000000001, "userMessages": 2, "assistantMessages": 1, … }

  ==> worksplice totalTokens=6300 vs SDK totalTokens=16696
  ==> worksplice costTotal=0.05 vs SDK cost=0.11000000000000001
  ==> the two DISAGREE: true
```

**0.83.0 对照组（同一份 fixture）**：

```
### control run against pi-coding-agent@0.83.0
  SessionManager.open() read 6 entries: types=[message,message,usage,usage,context_edit,message]
  SDK getSessionStats(): tokens={"input":1000,"output":200,"cacheRead":5000,"cacheWrite":100,"total":6300} cost=0.05
  worksplice parseSessionFileStats(): totalTokens=6300 cachedTokens=5000 uncachedTokens=1100 costTotal=0.05
  ==> worksplice totalTokens=6300 vs SDK totalTokens=6300; agree=true
```

⇒ **0.83.0 上两侧逐字一致；0.99.2 上成本差 2.2 倍。**
⇒ 报告 §4.3「`lib/session-stats.ts:92` 的成本口径会漏算」**成立，且比报告估的更严重**
（漏的是全部 `usage` 条目，不是「部分漏算」）。

#### 4.3.2 「会不会双算」的答案：不会，而且是构造上就不会

先看 SDK 自己的聚合算法（**没有**任何去重）：

```js
// pi-coding-agent@0.99.2 dist/core/agent-session.js（getSessionStats 内）
for (const entry of this.sessionManager.getEntries()) {
    if (entry.type === "usage") {
        addUsageToTotals(usageTotals, entry.usage);          // ← 无条件加
    } else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
        addUsageToTotals(usageTotals, entry.usage);
    }
    if (entry.type !== "message") continue;
    …
    else if (message.role === "assistant") {
        assistantMessages++;
        addUsageToTotals(usageTotals, assistantMsg.usage);   // ← 也无条件加
    }
}
```

所以我的 fixture 里那条**故意与 `e2` 数字完全相同**的 `usage` 条目（`kind: "request"`）
确实造成了双算（SDK 给出 `input: 2000` = 1000 × 2）。
**但这不能推广成「usage 条目会双算」**，因为要看 SDK 到底写什么。答案是：

```
$ grep -rn "appendUsage" dist/ --include="*.js" | grep -v "\.map"
dist/core/session-manager.js:864:    appendUsage(kind, provider, model, usage, note) {
dist/core/cache-warmer.js:249:                const entry = this.sessionManager.appendUsage("cache_warm", message.provider, message.responseModel ?? message.model, message.usage, extensionOverride ? "extension override" : undefined);
```

**全 SDK 只有一处调用 `appendUsage`**，就是 cache warmer。看它记的是哪次请求：

```js
// pi-coding-agent@0.99.2 dist/core/cache-warmer.js:236-250
const message = await this.models
    .streamSimple(run.model, run.context, {
    ...run.options,
    maxTokens: 1,
    maxRetries: 0,
    signal: run.controller.signal,
})
    .result();
if (message.stopReason !== "error" && message.stopReason !== "aborted") {
    const entry = this.sessionManager.appendUsage("cache_warm", …, message.usage, …);
```

这条 message 走的是 `this.models.streamSimple`（cache warmer 自己的模型句柄），
**不经过 `Agent`**、不发 `message_end`、**从不作为 `message` 条目落进 transcript**。

**⇒ 两个来源天然不相交：**
`message.usage` = agent 自己的轮次；`usage` 条目 = 带外（out-of-band）的模型调用。
**去重逻辑不需要写。** worksplice 侧照抄 SDK 的口径即可：
`entry.type === "usage"` 就 `addUsage`，不做任何 key 比对。
（`session-stats.ts:39-57` 的 `addUsage` 已经带完整的字段校验，直接复用。）

#### 4.3.3 `cache_warm` 该不该进面向用户的成本看板：该

因为它**默认就在发生**：

```
$ grep -n "CACHE_WARMING_MODES" -A 1 dist/core/settings-manager.js
15:export const CACHE_WARMING_MODES = ["off", "streaming", "idle"];
…
679:    getCacheWarmingMode() {
680:        const mode = this.globalSettings.cacheWarming;
681:        return mode !== undefined && CACHE_WARMING_MODES.includes(mode) ? mode : "streaming";
```

**未设置时返回 `"streaming"`** ⇒ 0.99.2 默认开着 cache warming，
用户已经在为这些预热请求付钱，而 worksplice 的成本面板**一分钱都看不到**
（§4.3.1 实测：同一份文件 0.05 vs 0.11）。

**但要按 `kind` 分开归属，不要并进「每轮 token」**：
`cache_warm` 的 `cacheWrite` token 不是上下文 token，混进
`lib/session-stats.ts` 的 `uncachedTokens` / `totalTokens` 会污染上下文占用估算。

给实施票的口径建议：

- `usage` 条目按 `kind` 分桶，**`costTotal` 全量累加**（用户付的钱不能少算）；
- token 数按 `kind` 分开呈现，或至少在 `SessionFileStats` 上加一个
  `warmupTokens` 之类的独立字段，**不混进 `totalTokens`**；
- `lib/types.ts:265-275` 的本地 `SessionEntry` 联合补 `UsageEntry` /
  `ContextEditEntry` 两个成员（报告这条判断成立）。

#### 4.3.4 `context_edit`：静默丢弃，但**不崩**

```
=== 4. does the transcript reader keep the new entry types? ===
  getSessionEntries() returned 7 entries: types=[message,message,usage,usage,context_edit,message,thinking_level_change]
  buildSessionContext() produced 3 UI messages:
    role=user       customType=- text="hello"
    role=assistant  customType=- text="[{\"type\":\"text\",\"text\":\"hi\"}]"
    role=user       customType=- text="still there?"
  entryIds=[e1,e2,e6]
```

- `SessionManager.open()` **读得进去**（6 条全在），`SessionEntry` 联合多出的成员
  被 `lib/session-reader.ts:212` 的双向 cast 吸收，**没有编译错误、没有运行时异常**。
- `buildSessionContext()` 只产出 3 条 UI 消息，`e3`（usage）/`e4`（usage）/
  `e5`（context_edit）**全部被 `lib/session-reader.ts:347-348` 的 `default: return null` 丢弃**。
- 0.83.0 对照组**行为完全相同**（`entryIds=[e1,e2,e6]`）——
  因为 0.83.0 的 `SessionManager` 也只是把未知类型原样读出来，
  worksplice 的 `switch` 一样丢。⇒ **这一条不是升级引入的**，是升级**放大**的：
  0.83.0 时那些条目根本不会被写出来，0.99.2 会自动写。

`context_edit` 的两个写入点都是**自动**的，不需要用户 opt-in：

```
$ grep -rn "appendContextEdit" dist/ --include="*.js" | grep -v "\.map"
dist/core/session-manager.js:962:    appendContextEdit(targetId, replacement) {
dist/core/agent-session.js:826:        const editId = this.sessionManager.appendContextEdit(targetId, null);
dist/core/agent-session.js:571:                    entryId = manager.appendContextEdit(draft.targetId, draft.replacement);
```

- `agent-session.js:826` 在 `_omitRecoveryAttempt()` 里 ——
  **auto-retry 恢复**与 **context overflow 恢复**时，把失败的那次尝试从模型上下文里剔除。
  ⇒ 只要会话里出现过可重试错误或上下文溢出，就会有 `context_edit`。
- `agent-session.js:571` 是扩展草稿通道。

⇒ **评估报告 §5.2 对 `docs/spec.md` §5.3 [锁定] 05 的判断成立且应当保留**：
「pi session 只承载认知过程」这条分工在 `context_edit` 出现后确实需要重述，
实施票要补 `lib/session-reader.ts` 的 `case`，否则锁定意图在实现层被违反。

#### 4.3.5 未经实跑验证的部分

- **真实 cache warmer 触发一次并落盘**：本票的 `usage` 条目是**合成**的
  （因为触发真实预热需要一次真实 provider 请求 ⇒ 需要凭证）。
  「SDK 只会写 `kind: "cache_warm"`、且该 message 不落 transcript」这条
  是**源码级证据**（全 SDK 唯一 `appendUsage` 调用点 + `streamSimple` 不经 `Agent`），
  **不是实跑观测**。
- `before_agent_start` 扩展能否写出 `kind` 别的 `usage` 条目：未测。
- `UsageEntry.kind` 是 `string`（`dist/core/session-manager.d.ts:39`
  注释原文 `Arbitrary usage category, such as "cache_warm"`），
  上游**没有**枚举约束 ⇒ worksplice 的分桶逻辑必须容忍未知 `kind`。

---

## 5. 对升级实施票的影响

`docs/pi-sdk-upgrade-assessment.md` §6 的 4 步，逐条改判。

### 第 1 步：四包同改的 pin —— **要改写**

评估报告写「`package.json:43-46` 四行 + `bun.lock:8-11` 四行同改」，
**实测这 8 行改完 `bun install` 装不上**（§2.3）。正确做法：

```sh
# 四包在 package.json 里精确 pin（package.json:43-46）
# bun.lock 的 workspace 段（bun.lock:8-11）可以一起改，但真正起作用的是 bun update
bun update @earendil-works/pi-agent-core@0.99.2 \
           @earendil-works/pi-ai@0.99.2 \
           @earendil-works/pi-coding-agent@0.99.2 \
           @earendil-works/pi-tui@0.99.2
```

**不要**用「删掉 `bun.lock` 的 4 条 `packages` 条目再 `bun install`」：
实测会把所有 `^` 范围的包一起重解析（§2.3 反面记录），对照组被污染。

**验收命令要换**（报告原来写的 `node -e "require('@earendil-works/pi-coding-agent/package.json').version"`
在 0.99.2 上**直接抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`** —— 该包是 ESM-only，
`exports` 里没有 `./package.json`）：

```sh
# ✗ 报告的验收命令在 0.99.2 上跑不通
#   Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './package.json' is not defined
#   by "exports" in node_modules/@earendil-works/pi-coding-agent/package.json
# ✓ 改成读文件
node -e "for (const p of ['pi-agent-core','pi-ai','pi-coding-agent','pi-tui'])
  console.log(p, JSON.parse(require('fs').readFileSync('node_modules/@earendil-works/'+p+'/package.json','utf8')).version)"
# 实测输出：pi-agent-core 0.99.2 / pi-ai 0.99.2 / pi-coding-agent 0.99.2 / pi-tui 0.99.2
```

### 第 2 步：跑 `tsc` —— **从「顺手对齐」升级为硬门禁，且预期要改**

报告写「**预期** `tsc` 会报的… 这一层的报错预计很少」。实测 **3 个错误**（§3.2）：

| # | 位置 | 性质 | 修法 | 与 B-1/B-2/B-3 的原子性 |
|---|---|---|---|---|
| 1 | `app/api/auth/api-key/[provider]/route.ts:34` | `ProviderAuthInteraction` 新增必填 `signal` | 加 `signal: new AbortController().signal` | **独立**，报告 §4 完全没写这条 |
| 2 | `lib/rpc/caller.ts:146` | `steer()` 返回类型变 | 改 `lib/pi-types.ts:158` | 与 3 同一处镜像，**必须同改** |
| 3 | `lib/rpc/caller.ts:149` | 同上（同一构造点的第二条诊断） | 改 `lib/pi-types.ts:159`（`followUp`） | 与 2 **必须同改** |

- 报告 §6「步骤间不可拆的原子单元」表里**要加一行**：
  **`pi-types` 的 `steer` + `followUp` 返回类型**（漏一个就是下次升级再撞一次）。
- 报告漏掉的第 1 条**要单独成为一个原子单元**（它不在镜像覆盖范围内，
  和 B-1/B-2 无关，可以独立修、独立验）。
- 报告漏掉的第 1 条**要补进影响面盘点**。评估报告 §3.2-D 列了
  `app/api/auth/api-key/[provider]/route.ts`，但 §4 六条逐条变更里一条都没有它。

**验收命令要换**：`tsc --noEmit` 从「预期零错误」改成
「**必须零错误，且这 3 条诊断逐条消失**」。报告 §6 第 2 步的验收
「`tsc --noEmit` 零错误」本身是对的，但它的**预期描述是错的**，
照抄会让实施者以为碰不到错误。

**更重要的验收纪律**：`npm test` 在这条升级上给的是**假绿**
（两版都是 471/471，§3.1）。所以：

> **`tsc --noEmit` 必须是升级票的硬门禁，不是建议步骤。**
> 测试门禁对这 3 条断裂零感知，缺了 `tsc` 这一道，升级会带着 3 个类型断裂进 main。

顺带：`bun run build` 也自带类型门禁（§4.1.1），所以升级票里
**`bun run build` 会在 tsc 之后重复报同样的 3 条**——这不是新问题，
别误判成打包面的问题。

### 第 3 步：修 B-1 与 B-2 —— **B-1 的修法要重写，B-2 维持**

- **B-2 维持报告结论**：`session.ts:430` / `:483` 补 `{ persist: true }`，
  以及先在 ADR 里写清「持久化职责唯一归属 `startup-preferences`」。
  本票没有实跑验证 B-2（需要真实换模型 + 重启，超出三问范围），
  **沿用报告结论，标注未经本票实跑**。
- **B-1 修法重写**（§4.2.5）。报告的「追加一条空 system message」
  **被实测证明是 no-op**（79 → 79）。三步：
  1. **先做产品决策**：`PRESET_NONE` 要不要 system prompt。
     若 0.99.2 零工具下的 1819 字符无害 ⇒ **直接删掉
     `applyForcedEmptySystemPrompt` 整个方法 + `caller.ts` 的
     `setForceEmptySystemPrompt` 调用**（最省的修法）。
  2. 若必须为空 ⇒ 走 `before_agent_start` 的 `systemPromptOptions`，
     **不要**走 system message。
  3. **无论选哪条**，`lib/pi-types.ts:131` 的 `systemPrompt` 标 `readonly`
     （报告这条判断成立，且比修 B-1 本身更重要）。
- 报告 §6 第 3 步的「顺带做」（`tool-presets.ts` 与 `session.ts:96` 的
  工具名硬编码收敛）**维持**：本票没有触及它，
  `getAllTools()` 的返回名字未加 `builtin:` 前缀这一点沿用报告的 X-5 核实结论。

### 第 4 步：修 B-3 与补文档 —— **`next.config.ts` 那半可以删，其余要加一条**

- **删掉**「视 B-4 的 spike 结论调整 `next.config.ts:31-38`」——
  实跑结论是**不调**（§4.1.4）。
- **B-3 的成本修法要加口径约束**（§4.3.3）：
  - `usage` 条目**按 `kind` 分桶**，`costTotal` 全量累加；
  - token 数**不混进 `totalTokens`**（`cache_warm` 的 `cacheWrite` 不是上下文 token）；
  - **不需要任何去重逻辑**——报告 §4.3 修法里的「注意与 message 内嵌 usage **去重**，
    否则双算」是**多余的**，实测证明两个来源构造上不相交（§4.3.2）。
    照报告写去重逻辑反而会引入 bug。
  - `lib/types.ts:265-275` 补两个联合成员（报告判断成立）。
- **B-3 的 `context_edit` 修法维持**：`lib/session-reader.ts:304-349` 补两个 `case`。
  补一条报告没提的**事实**：`context_edit` 与 `usage` 在 **0.83.0 上就已经被静默丢弃**
  （§4.3.4 对照组），这不是升级引入的回归，是升级**放大了暴露面**。
  措辞上要区分，否则实施者会去找一个不存在的回归。
- ADR / spec 的文档修订维持报告 §6 第 4 步与 §5.1、§5.2 的全部结论
  （本票没有触及那些面）。

### 新增：升级票必须带的一条纪律

| 报告没写、本票实测出来的 | 实施票要做什么 |
|---|---|
| `npm test` 对 3 条类型断裂零感知（两版都 471/471） | `tsc --noEmit` 写成硬门禁；不要把「测试全绿」当升级完成的证据 |
| `bun install` 装不上精确 pin 的新版本（§2.3） | 固定用 `bun update <四包>@0.99.2`；验收命令改成读文件而非 `require(...).version` |
| 报告的 B-1 修法是 no-op（§4.2.2） | B-1 的修法重写；先做产品决策再动代码 |
| 报告建议的 usage 去重逻辑是多余的（§4.3.2） | 不要写去重逻辑；改成分桶 |
| `next.config.ts` 不需要改（§4.1） | 删掉报告第 4 步的 `next.config.ts` 那一条 |

---

## 6. 证据索引

本节把每条结论映射到「命令 + 真实输出的落点」。所有输出都在本 worktree 产生。

### 6.1 数字与证伪

| 结论 | 命令 | 真实输出落点 |
|---|---|---|
| 基线 `tsc` 0 错误 | `node_modules/.bin/tsc --noEmit` | `EXIT=0`；`… 2>&1 \| wc -l` → `0`（§3.1） |
| 0.99.2 `tsc` 3 错误 | `node_modules/.bin/tsc --noEmit` | `EXIT=2`；`grep -cE "error TS"` → `3`；三条全文见 §3.2（§3.1） |
| 基线测试 471/0 | `npm test` | `ℹ tests 471 / ℹ pass 471 / ℹ fail 0 / ℹ duration_ms 4323.76525`（§3.1） |
| 0.99.2 测试 471/0（假绿） | `npm test` | `ℹ tests 471 / ℹ pass 471 / ℹ fail 0 / ℹ duration_ms 3648.557375`（§3.1） |
| 0.83.0 build 成功、1 条警告 | `bun run build` | `✓ Compiled successfully in 13.6s`；`Critical dependency: …` ×1；`BUILD EXIT=0`（§4.1.1） |
| 0.99.2 build 编译成功但类型门禁失败 | `bun run build` | `✓ Compiled successfully in 15.4s` → `Failed to type check` → `BUILD EXIT=1`；警告仍 ×1（§4.1.1） |
| 报告核心论断不成立 | §3.1 表 + §3.2 逐条拆解 | 「**报告此判断不成立**」+ 3 条实际错误（§3.2） |

### 6.2 Q1 打包面

| 结论 | 命令 | 真实输出落点 |
|---|---|---|
| 四个 pi 包是 external | `grep -rhoE '"@earendil-works/pi-[a-z-]+"' .next/server \| sort -u` | 4 行，见 §4.1.2 |
| 6 个新依赖不在编译产物里 | `grep -rl <pkg> .next/server` ×6 | 6 行 `<not found in .next/server>`，见 §4.1.2 |
| import 顶层入口成功 | `SPIKE_LOAD_LOG=… node .spike/runtime-import2.mjs` | `OK — 156 named exports`；`modules evaluated: 1302`；`718` 个包（§4.1.3） |
| `quickjs-wasi` import 期不求值、`.wasm` 加载数 0 | 同上（`module.register()` loader hook 落盘每个求值的 specifier） | `quickjs-wasi  NOT evaluated at import time`；其余 5 个 `EAGERLY EVALUATED`；`.wasm / quickjs URLs evaluated: 0`（§4.1.3） |
| 静态可达性交叉验证 | `node .spike/reach.mjs` | `static graph: 251 nodes`；3 个 `STATIC-REACHABLE`、3 个 `not statically reachable`（§4.1.3） |
| `next.config.ts` 无需改动 | §2.4 | `git diff --name-status e890362 -- … next.config.ts` → 空 |

### 6.3 Q2 systemPrompt

| 结论 | 命令 | 真实输出落点 |
|---|---|---|
| TypeError 精确复现（真实 AgentSession，零凭证） | `node .spike/q2-session.mjs` | `THREW TypeError: Cannot set property systemPrompt of #<Object> which has only a getter`（§4.2.1） |
| 候选 A（追加空 system message）是 no-op | `node .spike/q2-systemprompt.mjs` | `prompt length 79 -> 79: NOT cleared`（§4.2.2） |
| 候选 A'（替换首条 system message 的 content）有效 | 同上 | `prompt length = 0 (CLEARED)`；`Agent.reset()` 后仍为 0（§4.2.2 步骤 3、6） |
| 候选 B（不覆盖）留下完整 prompt | 同上 | `prompt length = 79`（§4.2.2 步骤 5） |
| 真实会话上两个面已解耦 | `node .spike/q2-session.mjs` | `agent.state.systemPrompt length = 0` / `session.systemPrompt length = 1819`（§4.2.3） |
| 两个 getter 的实现对比 | `sed -n '1036,1038p' …/0.99.2/dist/core/agent-session.js` 与 `sed -n '596,597p' …/0.83.0/…` | §4.2.3 两段代码 |
| prompt 每次请求现算、装在 `sections` 里 | `sed -n '1563,1567p;1247,1252p' …/0.99.2/dist/core/agent-session.js` | §4.2.3 两段代码 |
| `getSystemMessageText` 渲染 `content` + `sections` | `sed -n '11,18p' node_modules/@earendil-works/pi-ai/dist/utils/text.js` | §4.2.3 |
| 0.83.0 对照：覆盖承重（1780 → 0） | `node .spike/control-083.mjs` | `after write: session.systemPrompt length = 0`（§4.2.4） |
| 正确通道是 `systemPromptOptions` | `grep -n "forceSystemPrompt" …/dist/core/agent-session.js`；`grep -n "systemPromptOptions" -B2 …/extensions/types.d.ts` | `:1294`；`:702`（§4.2.5） |
| `agent.state.messages` 有 setter、能扛 `reset()` | `node .spike/q2-systemprompt.mjs` 步骤 6、7 | `after Agent.reset()  systemPrompt.length=0`（§4.2.2） |
| 供给侧类型对比 | `grep -nE "^\s+(async )?(steer\|followUp)\(" …0.83.0/…d.ts`；`sed -n '162,163p;518,531p' …0.99.2/…d.ts`；`sed -n '153,166p' …pi-ai/dist/auth/types.d.ts` | §3.2 错误 1、错误 2/3 |

### 6.4 Q3 usage 去重

| 结论 | 命令 | 真实输出落点 |
|---|---|---|
| fixture 上两侧数字不一致 | `node .spike/q3-usage.mjs` | worksplice `totalTokens=6300 / costTotal=0.05` vs SDK `16696 / 0.11`（§4.3.1） |
| 0.83.0 上两侧逐字一致 | `node .spike/control-083.mjs` | `agree=true`（§4.3.1） |
| SDK 聚合无去重 | `sed -n '/getSessionStats(): SessionStats/,/^    }/p' …/dist/core/agent-session.js` | §4.3.2 代码块 |
| 全 SDK 只有一处 `appendUsage` | `grep -rn "appendUsage" dist/ --include="*.js" \| grep -v "\.map"` | `session-manager.js:864`（定义）+ `cache-warmer.js:249`（唯一调用）（§4.3.2） |
| `cache_warm` 记的是带外请求，不落 transcript | `sed -n '236,250p' …/dist/core/cache-warmer.js` | `this.models.streamSimple(run.model, run.context, { maxTokens: 1, maxRetries: 0 … })`（§4.3.2） |
| cache warming **默认开启** | `grep -n "CACHE_WARMING_MODES" -A 1 …/settings-manager.js`；`sed -n '679,682p' …` | `["off","streaming","idle"]`；未设置 → `"streaming"`（§4.3.3） |
| reader 静默丢弃新条目、不崩 | `node .spike/q3-usage.mjs` 步骤 4 | 7 entries → 3 UI messages；`entryIds=[e1,e2,e6]`（§4.3.4） |
| 0.83.0 上同样丢弃（放大而非引入） | `node .spike/control-083.mjs` | `entryIds=[e1,e2,e6]`（§4.3.4） |
| `context_edit` 的两个自动写入点 | `grep -rn "appendContextEdit" dist/ --include="*.js" \| grep -v "\.map"` | `agent-session.js:826`（`_omitRecoveryAttempt`）+ `:571`（扩展草稿）（§4.3.4） |
| `kind` 是 `string`、无枚举约束 | `sed -n '36,45p' …/dist/core/session-manager.d.ts` | `/** Arbitrary usage category, such as "cache_warm". */ kind: string;`（§4.3.5） |

### 6.5 实验纪律

| 结论 | 命令 | 真实输出落点 |
|---|---|---|
| 只改 `bun.lock` workspace 段装不上 0.99.2 | `sed -i '' …` ×2 → `bun install` → `bun pm ls` | `Checked 1116 installs … (no changes)`；版本仍 `0.83.0`（§2.3） |
| `bun install --force` 同样无效 | `bun install --force` | `1056 packages installed`；版本仍 `0.83.0`（§2.3） |
| `bun update` 可行、且不污染对照组 | `bun update @earendil-works/pi-{agent-core,ai,coding-agent,tui}@0.99.2` | `288 packages installed [9.30s]`；10 个非 pi 直接依赖版本不变（§2.3） |
| 报告的版本验收命令在 0.99.2 上不可用 | `node -e "…require('@earendil-works/pi-ai/package.json')…"` | `Error [ERR_PACKAGE_PATH_NOT_EXPORTED]`（§5 第 1 步） |
| 环境版本 | `node --version` / `bun --version` / `git merge-base HEAD origin/main` | `v25.0.0` / `1.3.14` / `e890362a5471dd98bf67f17ec6c44576846c7b36`（§2.1） |
| 三个临时文件已逐字还原 | `git diff --name-status e890362 -- package.json bun.lock next.config.ts` | 空（§2.4） |
| 无 `package-lock.json` | `ls package-lock.json` | `No such file or directory`（§2.4） |
| 交付物纯净 | `git diff --name-status e890362..HEAD` | 恰好一项 `A docs/pi-sdk-upgrade-spike.md`（见 Answer） |

### 6.6 本票**没有**验证的（读者不应据此行动）

| 条目 | 为什么没验 |
|---|---|
| B-2（`setModel`/`setThinkingLevel` 的 `persist` 语义） | 需要真实 provider 凭证才能观察到「换模型后重启是否保持」；本票无凭证。**沿用评估报告 §4.2 的结论，标注未经本票实跑** |
| B-4（`agent_settled` 延迟派发） | 需要连续多轮真实 prompt + auto-retry + compaction；本票无凭证。评估报告 §4.4 也把它列为「没有代码可改、只能行为验证」，本票未做 |
| B-6（`system` 主题在无 TTY 环境的 fallback） | 不在三问范围内；未验。**沿用评估报告 §4.6 的结论** |
| `before_agent_start` 的 `systemPromptOptions` 能否把 prompt 压到 0 | 需要注册 extension 并跑完整 prompt 链路；本票只验了 `agent.state` 两条路（§4.2.6） |
| 零工具下 1819 字符 prompt 对模型是否无害 | 需要真实 provider 请求（§4.2.6） |
| 真实 cache warmer 触发一次并落盘 | 需要真实 provider 请求；`kind: "cache_warm"` 的行为是**源码级证据**而非实跑观测（§4.3.5） |
| `quickjs-wasi` / `pi-mcp` / `grok-mermaid` / `pi-codemode` / `chord` 被**真正调用**时的行为 | 只验证了「import 期不炸」；这 5 个包的按需路径未被触发（§4.1.4） |
| 0.99.2 的 `AgentSession` 在**已有消息**的会话上重开时的 system message 状态 | 本票的 `AgentSession` 都是新建空会话（§4.2.6） |
| 0.88–0.98 版本号断层的原因 | 上游未说明；**沿用评估报告 §7.3 的「不推测」** |
| `PI_*` 环境变量、`SettingsManagerCreateOptions` 字段级变化 | 不在三问范围内；**沿用评估报告 §7.3 的「未经一手核实」标注** |
| `getAllTools()` 的工具名是否仍无 `builtin:` 前缀（报告 X-5） | 不在三问范围内；**沿用评估报告的核实结论** |

### 6.7 方法本身的局限（如实记录）

- **§4.1.3 的静态可达性分析用正则扫 import 语句**，会把 bundle 里的字符串字面量
  误判成 specifier（静态图里出现了 `<pattern>:<thinking>` / `In Progress` 这类噪声包名）。
  **结论以 `module.register()` loader hook 的实跑结果为准**，静态分析只作方向性佐证。
- **§4.1 的 build 只跑到 webpack 编译成功那一段**。`next build` 的类型门禁在
  0.99.2 下会失败（§4.1.1），所以本票**没有**一次完整通过的 0.99.2 production build。
  打包面问题（Module not found / Critical dependency）属于编译阶段，该阶段已完整跑完。
- **所有 Q2 / Q3 的 `AgentSession` 都跑在临时 `agentDir` 上**，
  因此没有加载用户真实的 skills / extensions / `MEMORY.md`。
  `session.systemPrompt` 的 1819 / 1780 字符是**裸 SDK 的基线 prompt**，
  装了 skills 之后会变长——但「两个面是否解耦」这个结论与长度无关。
- **`.next/` 与 `node_modules/` 在实验后被删除 / 保留**：
  `.next` 已 `rm -rf`（§2.4），`node_modules` 保留在 0.83.0 状态。
  两者都在 `.gitignore` 里，不影响 PR。



