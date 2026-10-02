# 可执行 spike：`systemPrompt` 强制清零的崩溃与唯一修法

> 这是一份**可执行实验**的记录。上游的两份文档都在这一题上留了坑：
> `docs/pi-sdk-upgrade-spike.md` §4.2 断言「正确通道是 `before_agent_start` 的
> `systemPromptOptions`」并自标「未经实跑验证」；`docs/pi-sdk-upgrade-assessment.md`
> §4.1-B-1 建议的修法是「在 `sessionManager` 上追加一条空 system message」。
>
> 本文件把两个版本（`0.83.0` / `0.99.2`）都装出来，对 A/B/C/D 四个候选逐个**在
> 发往模型之前截获真实请求体**实测，并额外用 worksplice 自己的
> `RpcCaller.start()` + `wrapper.send()` 跑通了完整生产路径。
>
> **本 PR 不含任何升级。** `package.json` / `bun.lock` 在实验中被临时改动，
> 交付前已逐字还原（§7.3）。唯一交付物是本文件。
>
> 取证纪律：一手来源只有**实跑输出**、**装出来的包源码**、**本仓代码**。
> **每条结论都带命令 + 该命令的真实输出**，索引见 §7。
> **全程未使用任何 provider 凭证**（§2.3 说明如何在没有凭证的情况下观察到请求）。

---

## 1. 结论（TL;DR）

### 1.1 一句话

**推荐候选 C：把「强制清零」从「构造后变异 `agent.state.systemPrompt`」搬到
extension 的 `before_agent_start`，返回 `{ systemPrompt: "" }`。
崩溃已确认，且它比「行为回归」严重得多——0.99.2 上 PRESET_NONE 会话根本起不来。**

### 1.2 三条硬结论

1. **崩溃确认（且比预期严重）**。0.99.2 下 `lib/rpc/session.ts:292` 抛
   `TypeError: Cannot set property systemPrompt of #<Object> which has only a getter`，
   栈顶是 `caller.ts:154`，即 `startRpcSession()` 的主路径 →
   **`POST /api/agent/new` 对 `tools: []` 直接 500，会话一个都起不来**（§3）。
2. **★ 当前 main 上的那个 hack 已经是死的**。0.83.0 对照组用 worksplice 自己的
   代码路径实测：那次写入之后 `session.systemPrompt` 确实变成 0，但**下一次
   `prompt()` 会被 pi 自己覆写回 `_baseSystemPrompt`**，真正发到线上的是
   **1814 字符**（隔离 agentDir）/ **5758 字符**（真实用户 agentDir）。
   ⇒ 「升 pin + 修 3 个类型错误」不是在修一个回归，是在**第一次让这个意图生效**（§5.1）。
3. **候选 D 不可用**。它有两个独立的致命点：`createAgentSessionFromServices` 的
   选项里根本没有 `initialState`（worksplice 够不到），而且即便够到，
   `AgentSession` 每个请求都会从 `_baseSystemPromptOptions` 现算并 unshift 一条
   system message 覆盖掉它（§4.4）。

### 1.3 候选裁决总表（两版同口径）

| 候选 | 0.99.2 线上字符数 | 0.83.0 线上字符数 | 裁决 |
| --- | --- | --- | --- |
| 基线（什么都不做） | **1843** | **1809** | — |
| **A** 追加一条空 system message | 1843 | 1809 | **no-op**，两版都无效 |
| **A′**（对照）改写首条 system message 的 content | 1843 | 1809 | 无可改写对象，两版都无效 |
| **B** 不再覆盖 | 1843 | 1809 | 无效（且它是现状的行为） |
| **C** extension `before_agent_start` → `{ systemPrompt: "" }` | **0** | **0** | **唯一有效** |
| **C′**（对照）extension 返回 `{ systemPromptOptions }` | 1843 | 1809 | **无效**，字段名必须是 `systemPrompt` |
| **D** 构造期 `initialState.systemPrompt: ""` | **够不到** | **够不到** | **不可实施** |

（0.99.2 基线 1843 与 0.83.0 基线 1809 的 34 字符差是上游 prompt 文本变长，
不是语义变化。完整输出见 §7.1。）

### ★ English summary

> **Executable spike. Installed both 0.83.0 and 0.99.2 for real and intercepted the
> actual provider request body (before auth, before the network) for four candidate
> fixes.** The crash is confirmed and worse than a behaviour regression: on 0.99.2,
> `lib/rpc/session.ts:292` throws `TypeError: Cannot set property systemPrompt of
> #<Object> which has only a getter`, thrown from `caller.ts:154` inside
> `startRpcSession()` — so `POST /api/agent/new` returns 500 for `tools: []` and no
> tool-less session can be created at all. Running worksplice's *own* `RpcCaller.start()`
> against 0.83.0 produced a second, larger finding: the existing forced-empty write
> **never reaches the wire**. It sets the getter to 0, but the next `prompt()` makes pi
> reassign `agent.state.systemPrompt = this._baseSystemPrompt`, so 1814 chars (isolated
> agentDir) / 5758 chars (real user agentDir) go out per request. The override was
> never load-bearing; the previous spike's "1780 → 0" reading came from the getter, not
> from the request. Candidate A (append an empty system message) is a measured no-op on
> both versions. Candidate D is not implementable: `CreateAgentSessionFromServicesOptions`
> carries no `initialState`, `sdk.js` hardcodes `new Agent({ initialState: { systemPrompt:
> "" } })`, and per-request the session recomputes the prompt from
> `_baseSystemPromptOptions` anyway. The only candidate that reaches 0 characters on the
> wire on **both** versions is **C**: an extension whose `before_agent_start` handler
> returns `{ systemPrompt: "" }`. It survives multi-turn, `setActiveToolsByName([])` and
> `session.reload()` on both versions, restores the prompt when the handler stops
> returning, and is registrable through the public
> `createAgentSessionServices({ resourceLoaderOptions: { extensionFactories } })` seam.
> Note the spike report's advice to return `systemPromptOptions` is wrong even though
> that field exists on the *event*: `BeforeAgentStartEventResult` exposes only `message`
> and `systemPrompt`, and the runner ignores `result.systemPromptOptions` entirely.**

---

## 2. 实验设置

### 2.1 环境与 base

```
$ node --version
v25.0.0
$ /Users/apple/.bun/bin/bun --version
1.3.14
$ git rev-parse --abbrev-ref HEAD
whutlichao/b1-systemprompt-spike
$ git merge-base HEAD origin/main
d84e13771e89e7de915bdb38e21456ccbfb3fa11
$ git log --oneline -1
d84e137 Merge pull request #50 from whutlichao/whutlichao/test-gate-land
```

base commit = `d84e137`，与 spec 给的一致，已用 `git merge-base HEAD origin/main` 复核。

### 2.2 顺序即控制组

| 步 | 动作 | 落点 |
| --- | --- | --- |
| 1 | 基线 `bun install`（pin 0.83.0）→ `tsc --noEmit` → `npm test` | §5.4 |
| 2 | 0.83.0 上跑全套实验（崩溃对照 / 候选矩阵 / 生存实验 / 真实 worksplice 路径） | §3、§4、§5 |
| 3 | 四包同改到 `0.99.2`（`bun update`）→ 重跑**同一批脚本，零改动** | §3、§4、§5 |
| 4 | 0.99.2 上 `tsc --noEmit` → `npm test` | §5.4 |
| 5 | 降回 0.83.0，逐字还原 `package.json` / `bun.lock` | §7.3 |

升级用 `bun update <pkg>@0.99.2`（**不是**裸 `bun install`）——原因沿用
`docs/pi-sdk-upgrade-spike.md` §2.3 的实测：只改 `bun.lock` 的 workspace 段，
bun 仍按 `packages` 段的已解析版本装 0.83.0。`bun update` 只重解析被点名的子树，
非 pi 的直接依赖一个都没漂（`react` 19.2.4 / `next` 16.2.12 / `typescript` 5.9.3 /
`eslint` 9.39.4 前后逐字相同）。

### 2.3 ★ 没有凭证怎么观察到「发出去的 prompt」

`AgentSession.prompt()` 在进入 agent loop **之前**有一道 auth 前置闸
（0.83.0 `dist/core/agent-session.js:847`）：

```js
const hasConfiguredAuth = this._modelRuntime.hasConfiguredAuth(this.model.provider) ||
    (await this._modelRuntime.checkAuth(this.model.provider)) !== undefined;
if (!hasConfiguredAuth) { … throw new Error(formatNoApiKeyFoundMessage(...)); }
```

所以只替换 `agent.streamFunction` 是**观察不到**的——请求根本走不到那里：

```
$ node .scratch/spike/run-crash.mjs        # 0.83.0，第一次尝试
  [baseline] streamFunction calls   = 0
  prompt() threw=true (No API key found for the selected model.
```

本 spike 的做法是**在 `ModelRuntime.streamSimple` 上装一个 test double**，由两部分组成：

1. `streamSimple` 被**替换**成捕获器：记录 `context`（其中就含真正要发的 system
   prompt）后**直接 throw**。这是观察点：它在 pi 组装完 prompt 之后、在 pi-ai 的
   认证解析与网络之前。
2. `hasConfiguredAuth` / `checkAuth` 被 stub 成「有认证」，只为跨过上面那道闸。

**这不是伪造凭证**：没有任何 key 被写入、读取或解析过，`auth.json` 不存在，
pi-ai 的认证层从未运行（捕获器先抛）。**全程零网络请求**——`streamSimple` 就是
pi-ai 通往 provider 的最后一道自有入口，在它之后才是各 provider 的 SDK。
凭证边界见 §6。

### 2.4 怎么测「线上 prompt」

`0.83.0` 把 prompt 放在 `context.systemPrompt`，`0.99.2` **删掉了这个字段**
（`context.systemPrompt` 恒为 `ABSENT`），改放在请求消息列表里那条 system message
的 `content` / `sections`。所以本 spike 的口径是**两者相加**：

```
TOTAL SYSTEM PROMPT ON WIRE = (context.systemPrompt?.length ?? 0)
                           + Σ renderSystemText(messages.filter(role === "system"))
```

`renderSystemText` 与 pi-ai 自己的 `getSystemMessageText`
（`dist/utils/text.js:11-18`）同口径：`content` 非空则取，再把所有非空
`sections` 值拼进来。

> ⚠️ **这条口径本身纠正了上游的一处测量错误**：上一份 spike 报的「0.83.0 上
> `session.systemPrompt` → 0 ⇒ 覆盖是承重的」读的是 **getter**，而 0.83.0 的
> prompt 根本不在 system message 里、只在 `context.systemPrompt` 里。
> 只数 system message 会把 0.83.0 的 1814 字符报成 0。

---

## 3. 崩溃确认

### 3.1 属性描述符：两版的根本差异（一手源码，不是文档）

```
$ node .scratch/spike/run-D.mjs | sed -n '/D-b2/,/D-c/p'
=== D-b2 what the property actually is on AgentState (getter vs writable) ===
  descriptor = {"get":"undefined","set":"undefined","writable":true,"value":"x"}    # 0.83.0
  'systemPrompt' in probe.state = true

  descriptor = {"get":"function","set":"undefined"}                                  # 0.99.2
  'systemPrompt' in probe.state = true
```

0.99.2 的 `AgentState.systemPrompt` **只有 getter、没有 setter**，而且它是
`messages` 的只读投影（`dist/agent.js:31-45`）：

```js
// pi-agent-core@0.99.2 dist/agent.js:31-45
const initialMessage = createInitialSystemMessage(initialState?.systemPrompt, tools.map(toToolDeclaration));
if (messages[0]?.role !== "system" && initialMessage)
    messages.unshift(initialMessage);
return {
    get systemPrompt() {
        return getCurrentSystemPrompt(messages);      // ← 从 transcript 回放
    },
    …
```

### 3.2 ★ 0.99.2：`TypeError` 真实输出

裸 SDK 层（隔离 `agentDir`、无凭证）：

```
$ node .scratch/spike/run-crash.mjs        # 0.99.2
### SDK versions under test: {"pi-agent-core":"0.99.2","pi-ai":"0.99.2","pi-coding-agent":"0.99.2","pi-tui":"0.99.2"}
  cwd      = /var/folders/…/T/ws-q2-cwd-QqD6EN
  agentDir = /var/folders/…/T/ws-q2-agent-xPc4yG  (no user config, no credentials)
  sessionId = 01a0fa77-8ee6-707f-8551-5c1822957395

=== Q2.1  the exact worksplice write (lib/rpc/session.ts:292), verbatim ===
  [before write] agent.state.systemPrompt.length = 0
  [before write] session.systemPrompt.length     = 1843
  [before write] agent.state.messages roles     = []
  THREW TypeError: Cannot set property systemPrompt of #<Object> which has only a getter
  [after write] agent.state.systemPrompt.length = 0
  [after write] session.systemPrompt.length     = 1843
```

### 3.3 ★ 0.99.2：在 worksplice 自己的生产路径上（完整栈）

`RpcCaller.start("spike-session-1", "", cwd, { toolNames: [] })` —— 一行源码都没改：

```
$ node .scratch/spike/run-real-flow.mjs isolated      # 0.99.2
### switches: SWALLOW_FORCE=0 C_EXT=0

=== worksplice's own startRpcSession() with toolNames: [] (PRESET_NONE), agentDir mode = isolated ===
/Users/apple/orca/workspaces/worksplice/b1-systemprompt-spike/lib/rpc/session.ts:292
      this.inner.agent.state.systemPrompt = "";
                                          ^

TypeError: Cannot set property systemPrompt of #<Object> which has only a getter
    at AgentSessionWrapper.applyForcedEmptySystemPrompt (/…/lib/rpc/session.ts:292:43)
    at AgentSessionWrapper.setForceEmptySystemPrompt (/…/lib/rpc/session.ts:199:10)
    at /…/lib/rpc/caller.ts:154:17
    at async file:///…/.scratch/spike/run-real-flow.mjs:59:30
```

**这段栈比「prompt 不对」严重**：抛出点在 `caller.ts:154`，位于
`startRpcSession()` 的 `starting` 异步 IIFE 内部且**不在任何 try/catch 里**，
所以这个 Promise 直接 reject ⇒ `POST /api/agent/new` 对 `toolNames: []` 返回 500
⇒ **0.99.2 上「全禁工具」的会话一个都创建不出来**。这不是行为回归，是功能缺失。

### 3.4 0.83.0 对照组：同一次赋值，不抛

```
$ node .scratch/spike/run-crash.mjs        # 0.83.0
### SDK versions under test: {"pi-agent-core":"0.83.0","pi-ai":"0.83.0","pi-coding-agent":"0.83.0","pi-tui":"0.83.0"}

=== Q2.1  the exact worksplice write (lib/rpc/session.ts:292), verbatim ===
  [before write] agent.state.systemPrompt.length = 1809
  [before write] session.systemPrompt.length     = 1809
  [before write] agent.state.messages roles     = []
  worksplice's write: NO THROW
  [after write] agent.state.systemPrompt.length = 0
  [after write] session.systemPrompt.length     = 0
```

### 3.5 `tsc` 与 `npm test` 的门禁表现

```
$ node_modules/.bin/tsc --noEmit            # 0.99.2
app/api/auth/api-key/[provider]/route.ts(34,47): error TS2345: …
lib/rpc/caller.ts(146,55): error TS2345: …
lib/rpc/caller.ts(149,47): error TS2345: …
$ grep -c "session.ts" <上面输出>
0

$ node_modules/.bin/tsc --noEmit            # 0.83.0
(空 —— 0 个错误)

$ npm test      # 0.83.0
ℹ tests 852
ℹ pass 852
ℹ fail 0

$ npm test      # 0.99.2
ℹ tests 837
ℹ pass 832
ℹ fail 5
✖ lib/rpc/caller.test.mjs
✖ lib/rpc/index.test.mjs
✖ lib/rpc/session.test.mjs
✖ waits for the source reply before sending the title prompt
✖ removes incomplete tool calls before invoking the title provider
```

**`tsc` 对 `:292` 完全失明**（3 个错误里 0 个在 `session.ts`；`readonly` 不影响
可赋值性，所以类型层根本不报）。

**但要更正上一份 spike 的一句结论**：它说「`npm test` 在两版都是 471 pass /
0 fail，对这 3 个断裂完全失明」。以今天的 852 条套件在 0.99.2 上跑，**是 5 条失败**，
其中 3 条正是下面 §6.1 那个未被记录的 0.99.2 阻塞（`PlainTextTheme` 在 import 期
就炸），2 条是 0.99.2 把 system message 放进 transcript 导致的旧断言过期。
⇒ **`npm test` 不是失明的，它抓住了一个比 systemPrompt 更靠前的硬阻塞。**

---

## 4. 候选逐个实测

全部在**同一批脚本**上跑，脚本对两个版本零改动。每个候选都新建一个
`tools: []` 的真 `AgentSession`，施加候选，发一次 prompt，截获请求体。

### 4.1 基线：不做任何事

```
=== 0. BASELINE — tools:[] and NO candidate applied ===          # 0.99.2
  agent.state.systemPrompt.length = 0
  session.systemPrompt.length     = 1843
  agent.state.messages roles     = []
  TOTAL SYSTEM PROMPT ON WIRE = 1843 chars  (context 0 + system-msg 1843)

=== 0. BASELINE — tools:[] and NO candidate applied ===          # 0.83.0
  agent.state.systemPrompt.length = 1809
  session.systemPrompt.length     = 1809
  agent.state.messages roles     = []
  TOTAL SYSTEM PROMPT ON WIRE = 1809 chars  (context 1809 + system-msg 0)
```

**两个版本的载体完全不同**，这是后面所有判读的基准：

- `0.83.0`：prompt 在 `context.systemPrompt`，transcript 里**一条 system message 都没有**。
- `0.99.2`：`context.systemPrompt` 这个字段**不存在**了，prompt 被重建成一条
  system message（`content` 为空串，文本装在 `sections` 里）在每次请求现算。

### 4.2 候选 A：追加一条空 system message —— **实测 no-op**

```
=== A. APPEND an empty system message to the transcript ===              # 0.99.2
  agent.state.messages roles     = ["system"]
  TOTAL SYSTEM PROMPT ON WIRE = 1843 chars  (context 0 + system-msg 1843)
                                                                  # ← 没变

=== A. APPEND an empty system message to the transcript ===              # 0.83.0
  agent.state.messages roles     = ["system"]
  TOTAL SYSTEM PROMPT ON WIRE = 1809 chars  (context 1809 + system-msg 0)
                                                                  # ← 没变
```

**两版都无效**，且无效的原因还不同：

- `0.99.2`：回放规则把所有 system message 的**非空**文本用 `"\n\n"` 拼起来，
  空文本直接跳过（`if (text.length > 0)`）。追加 `content: ""` 对拼出来的文本零影响。
- `0.83.0`：transcript 里的消息根本不参与 prompt 组装，prompt 只从
  `context.systemPrompt` 走。追加任何 message 都不影响它。

### 4.3 候选 A′（对照）：改写首条 system message 的 content

```
=== A'. REPLACE the leading system message's content with "" ===         # 两版同
  no system message in transcript to replace (roles=[])
  TOTAL SYSTEM PROMPT ON WIRE = 1843 chars / 1809 chars                   # ← 没变
```

`tools: []` 的新会话 transcript 里**压根没有 system message 可改**。
（上一份 spike 在 `Agent` 层手工塞了一个 79 字符的 system message 才做出
「改写 content 才有效」那个对照；那说明的是 `Agent` 层机制，不是
`AgentSession` 层可达的修法。）

### 4.4 候选 B：不再覆盖 —— **无效，且它就是现状**

```
=== B. DO NOT override at all (delete the forced write) ===              # 0.99.2
  TOTAL SYSTEM PROMPT ON WIRE = 1843 chars  (context 0 + system-msg 1843)
=== B. DO NOT override at all (delete the forced write) ===              # 0.83.0
  TOTAL SYSTEM PROMPT ON WIRE = 1809 chars  (context 1809 + system-msg 0)
```

B 在两版上都和基线同值。它不是「另一个方案」，**它就是删掉那段代码之后的行为**。

### 4.5 ★ 候选 C：extension `before_agent_start` 返回 `{ systemPrompt: "" }` —— **唯一有效**

先纠正上一份 spike 的一个措辞错误。它写「正确通道是 `before_agent_start` 的
`systemPromptOptions`」。**返回值里没有这个字段**：

```
$ grep -n "interface BeforeAgentStartEventResult" -A 14 \
    node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts   # 0.99.2
export interface BeforeAgentStartEventResult {
    message?: Pick<CustomMessage, "customType" | "content" | "display" | "details">;
    /** Replace the complete system prompt for this turn. Later handlers observe this exact override. */
    systemPrompt?: string;
}
```

`systemPromptOptions` 在 **event** 上（供 extension 观察/改写），不在 **result** 上。
0.99.2 的 runner 只认 `result.systemPrompt` 和 `result.message`：

```js
// pi-coding-agent@0.99.2 dist/core/extensions/runner.js:1137-1143
const handlerResult = await handler(event, ctx);
if (handlerResult) {
    const result = handlerResult;
    if (result.message) messages.push(result.message);
    if (result.systemPrompt !== undefined) {
        currentOptions.forceSystemPrompt = result.systemPrompt;   // ← 唯一的入口
    }
}
```

我先按 spike 报告的写法返回 `{ systemPromptOptions: {...} }` 试过一次，**线上 1843 字符，
完全没生效**（`result.systemPromptOptions` 被 runner 直接丢弃）；改成
`{ systemPrompt: "" }` 之后立刻归零。两种写法在两版上的实测差（同一个脚本，
用 `SPIKE_C_RESULT` 开关切换返回字段）：

```
$ SPIKE_C_RESULT=options node .scratch/spike/run-candidates.mjs      # 0.99.2
### candidate C result field under test = options
=== C. extension `before_agent_start` returns a forced-empty system prompt ===
  handler invocations = 1
  handler saw         = {"hasSystemPrompt":true,"systemPromptLen":1843,"hasOptions":true,
                         "optionKeys":["customPrompt","forceSystemPrompt","selectedTools",
                         "toolSnippets","toolGuidelines","promptGuidelines",
                         "appendSystemPrompt","sections","cwd","contextFiles","skills"]}
  [C] TOTAL SYSTEM PROMPT ON WIRE = 1843 chars  (context 0 + system-msg 1843)   ← 无效
```

```
$ SPIKE_C_RESULT=options node .scratch/spike/run-candidates.mjs      # 0.83.0
### candidate C result field under test = options
  handler invocations = 1
  [C] TOTAL SYSTEM PROMPT ON WIRE = 1809 chars  (context 1809 + system-msg 0)     ← 同样无效
```

```
$ node .scratch/spike/run-candidates.mjs                            # 0.99.2（默认返回 { systemPrompt: "" }）
=== C. extension `before_agent_start` returns a forced-empty system prompt ===
  handler invocations = 1
  TOTAL SYSTEM PROMPT ON WIRE = 0 chars  (context 0 + system-msg 0)
=== C. extension `before_agent_start` returns a forced-empty system prompt ===   # 0.83.0
  agent.state.systemPrompt.length = 0      (after prompt)
  session.systemPrompt.length     = 0
  TOTAL SYSTEM PROMPT ON WIRE = 0 chars  (context 0 + system-msg 0)
```

⇒ **候选 C 的关键细节是「返回值字段名必须是 `systemPrompt`」，不是 `systemPromptOptions`。**
两版都一样。

### 4.6 候选 D：构造期 `initialState.systemPrompt: ""` —— **不可实施**

D 有两个**互相独立**的致命点，任一成立就出局。

#### D-a 可达性：`createAgentSessionFromServices` 没有这个选项

```
$ node .scratch/spike/run-D.mjs | sed -n '/D-a/,/D-b /p'
=== D-a  REACHABILITY: the construction seam worksplice actually uses ===
  createAgentSessionFromServices.length (arity) = 1
  -> read from the shipped .d.ts (the only declared input surface):
    export interface CreateAgentSessionFromServicesOptions {
        services: AgentSessionServices;
        sessionManager: SessionManager;
        sessionStartEvent?: SessionStartEvent;
        model?: Model<any>;
        thinkingLevel?: ThinkingLevel;
        scopedModels?: Array<{…}>
        tools?: string[];
        excludeTools?: …;
        noTools?: …;
        customTools?: ToolDefinition[];
    }
```

没有 `initialState`、没有 `systemPrompt`、没有 `systemPromptOptions`、没有
`forceSystemPrompt`、没有 `agentOptions`。而 `Agent` 是 SDK 内部 `new` 出来的：

```
$ node .scratch/spike/run-D.mjs | sed -n '/D-c/,$p'
=== D-c  can an AgentSession even be constructed with a custom Agent? (grep the seam) ===
  sdk.js new Agent() call site:
        const agent = new Agent({
            initialState: {
                systemPrompt: "",
                model,
                thinkingLevel,
                tools: [],
                messages: existingSession.messages,
            },
```

注意 `sdk.js` **已经**硬编码了 `systemPrompt: ""`——所以「构造期传空串」这件事
**在 0.83.0 和 0.99.2 上都已经发生过了**，而且毫无效果（基线就是 1809 / 1843）。
D 的假设「若构造期就给空串，可能根本不 seed system message」在 `Agent` 层是对的，
但在 `AgentSession` 层是**无关的**，因为 worksplice 根本走不到那个构造点。

#### D-b 机制：即便够到，`AgentSession` 每个请求都会覆盖它

```
$ node .scratch/spike/run-D.mjs | sed -n '/D-b  /,/D-b2/p'
=== D-b  MECHANISM at the bare pi-agent-core Agent layer ===
  Agent(initialState.systemPrompt: "")
    state.systemPrompt.length = 0
    state.messages roles      = []
  Agent(initialState.systemPrompt: "", tools: [read])
    state.systemPrompt.length = 0
    state.messages roles      = ["system"]        ← 0.99.2：给了工具就会 seed
```

`""` 在无工具时不 seed system message（这部分 coordinator 的推测成立），
但 `AgentSession` 的 prompt 路径每次都重算：

```js
// pi-coding-agent@0.99.2 dist/core/agent-session.js:1247-1252
_preparePromptAndToolLoadout(options, messages = this.agent.state.messages) {
    options.selectedTools = this._applyToolLoadout(options.selectedTools).map((tool) => tool.name);
    options.toolSnippets = Object.fromEntries(…);
    const sections = diffSystemPromptSections(
        getCurrentSystemMessage(messages)?.sections ?? {},
        buildSystemPromptSections(options));
    return sections ? { role: "system", content: "", sections, timestamp: Date.now() } : undefined;
}
```

文本来自 `buildSystemPromptSections(options)`，`options` 来自
`_baseSystemPromptOptions`——**与 `initialState.systemPrompt` 无关**。实测基线里
`agent.state.messages roles = []`（transcript 里确实一条 system message 都没有），
但线上仍然是 1843 字符，就是这条现算路径干的。

#### D 的裁决

**D 不可实施**。不是「效果差一点」，是 worksplice 在公开 API 上够不到那个构造点，
而且那个构造点本来就已经在传空串了。

---

## 5. 0.83.0 对照组

### 5.1 ★★ 头号发现：main 上那个 hack **从来没有生效过**

用 worksplice 自己的 `RpcCaller.start()` + `wrapper.send({type:"prompt"})`，
**一行源码都没改**，在**当前 main 的 0.83.0** 上跑：

```
$ node .scratch/spike/run-real-flow.mjs isolated      # 0.83.0
### switches: SWALLOW_FORCE=0 C_EXT=0

=== worksplice's own startRpcSession() with toolNames: [] (PRESET_NONE), agentDir mode = isolated ===
[worksplice] session_start dispatched to extensions for session 01a0fa76-8860-79c3-a4c2-6ccc48cf0845
  wrapper class = AgentSessionWrapper / inner class = AgentSession
  active tools  = []
  --- after waitUntilReady() (extension binding settled) ---
  agent.state.systemPrompt.length = 0          ← hack 生效了（getter 是 0）
  session.systemPrompt.length     = 0
  wrapper.forceEmptySystemPrompt  = true

=== what goes on the wire (intercepted at ModelRuntime.streamSimple) ===
  terminal event = agent_end
  agent.state.systemPrompt.length AFTER the prompt = 1814   ← pi 把它踩回去了
  --- request #1 ---
    context.systemPrompt          = 1814 chars
    TOTAL SYSTEM PROMPT ON WIRE   = 1814 chars
  ==> VERDICT: worksplice PRESET_NONE sends 1814 chars of system prompt
```

用**真实用户 agentDir**（装了 13 个真扩展）再跑一遍：

```
$ node .scratch/spike/run-real-flow.mjs real          # 0.83.0
  wrapper.forceEmptySystemPrompt  = true
  agent.state.systemPrompt.length AFTER the prompt = 5758
    context.systemPrompt          = 5758 chars
    TOTAL SYSTEM PROMPT ON WIRE   = 5758 chars
  ==> VERDICT: worksplice PRESET_NONE sends 5758 chars of system prompt
```

**机制**（0.83.0 `dist/core/agent-session.js:897-906`，`prompt()` 路径内）：

```js
// Apply extension-modified system prompt, or reset to base
if (result?.systemPrompt !== undefined) {
    this._systemPromptOverride = result.systemPrompt;
    this.agent.state.systemPrompt = result.systemPrompt;
} else {
    // Ensure we're using the base prompt (in case previous turn had modifications)
    this._systemPromptOverride = undefined;
    this.agent.state.systemPrompt = this._baseSystemPrompt;   // ← 每轮踩回去
}
```

`emitBeforeAgentStart` 在没有 extension 返回 `systemPrompt` 时返回 `undefined`
⇒ 走 else 分支 ⇒ 每轮 `prompt()` 都把 `agent.state.systemPrompt` 重新赋值成
`_baseSystemPrompt`。worksplice 的写入在**下一次 prompt 时被无条件撤销**。

裸 SDK 层也复现了同一件事（连续两轮）：

```
$ node .scratch/spike/run-survival.mjs      # 0.83.0
  worksplice write: NO THROW
  [t0 right after write] agent.state.systemPrompt.length = 0
  -- prompt #1: threw=false
     state.systemPrompt.length AFTER prompt = 1809
  [wire #1] context.systemPrompt   = 1809 chars
  -- prompt #2: threw=false
  [wire #2] context.systemPrompt   = 1809 chars
```

**这条纠正了 `docs/pi-sdk-upgrade-spike.md` §4.2.4 的「覆盖曾经是承重的
（1780 → 0）」。**那个 1780 → 0 读的是 getter；请求体从来没被观测过。
同时纠正本票 spec 里「0.83.0 对照组已证明那个 hack 曾经是承重的」这一前提。

**推论**：升级票不是「修一个回归」，而是**第一次让 `PRESET_NONE` 的意图真的生效**。
所以落地时应当按「新行为」而不是「回归修复」来写验收。

### 5.2 候选 C 在 0.83.0 上等效

同一份 worksplice 生产路径，只多注册一个 `before_agent_start` handler：

```
$ SPIKE_C_EXT=1 node .scratch/spike/run-real-flow.mjs isolated    # 0.83.0
  agent.state.systemPrompt.length = 0
  session.systemPrompt.length     = 0
  [spike] candidate-C before_agent_start handler registered (runner now has 1 extensions)
  --- request #1 ---
    context.systemPrompt          = ABSENT/empty
    TOTAL SYSTEM PROMPT ON WIRE   = 0 chars
  ==> VERDICT: worksplice PRESET_NONE sends 0 chars of system prompt

$ SPIKE_C_EXT=1 node .scratch/spike/run-real-flow.mjs real        # 0.83.0
    TOTAL SYSTEM PROMPT ON WIRE   = 0 chars
  ==> VERDICT: worksplice PRESET_NONE sends 0 chars of system prompt
```

0.99.2 上同一脚本同样归零：

```
$ SPIKE_SWALLOW_FORCE=1 SPIKE_C_EXT=1 node .scratch/spike/run-real-flow.mjs isolated   # 0.99.2
  [spike] swallowed in applyForcedEmptySystemPrompt: TypeError: …
  --- request #1 ---
    context.systemPrompt          = ABSENT/empty
    system-message text           = 0 chars
    TOTAL SYSTEM PROMPT ON WIRE   = 0 chars
  ==> VERDICT: worksplice PRESET_NONE sends 0 chars of system prompt

$ SPIKE_SWALLOW_FORCE=1 SPIKE_C_EXT=1 node .scratch/spike/run-real-flow.mjs real       # 0.99.2
  [spike] candidate-C before_agent_start handler registered (runner now has 13 extensions)
    TOTAL SYSTEM PROMPT ON WIRE   = 0 chars
  ==> VERDICT: worksplice PRESET_NONE sends 0 chars of system prompt
```

⇒ **候选 C 在两版上行为一致（都把线上 prompt 压到 0），且不引入新行为差异。**

### 5.3 热重载场景（关键验收项）

`applyForcedEmptySystemPrompt()` 在 worksplice 里有 6 个调用点，注释写的是
「keep this forced after extension resource discovery and reloads as well」
（`lib/rpc/caller.ts:150-152`）。候选 C 能不能扛住同样的场景，用**真实文件型
extension**（写进 `<agentDir>/extensions/`，`session.reload()` 会重新发现它）测：

```
$ node .scratch/spike/run-survival3.mjs      # 0.99.2
  extension file = /var/folders/…/ws-q2-agent-g8j2Yg/extensions/spike-force-empty.js
  after reload: runner extension count = 1
  extension paths = ["…/extensions/spike-force-empty.js"]
  runner diagnostics = []

  turn 1 (flag=0)                          wire=1843 chars (ctx=0 + sysmsg=1843, sys msgs=1)
  turn 2 (flag=1)                          wire=0 chars    (ctx=0 + sysmsg=0,    sys msgs=1)
  turn 3 (flag=1)                          wire=0 chars    (ctx=0 + sysmsg=0,    sys msgs=1)
  --- across session.reload() (resource hot reload) with forcing still on ---
  turn 4 (flag=1, post-reload)             wire=0 chars    (ctx=0 + sysmsg=0,    sys msgs=1)
  turn 5 (flag=1, post-reload)             wire=0 chars    (ctx=0 + sysmsg=0,    sys msgs=1)
  --- across setActiveToolsByName (worksplice set_tools) ---
  turn 6 (after setActiveToolsByName([]))  wire=0 chars    (ctx=0 + sysmsg=0,    sys msgs=1)
  --- turning forcing off must restore the prompt (no sticky override) ---
  turn 7 (flag=0, post-reload)             wire=1843 chars (ctx=0 + sysmsg=1843, sys msgs=1)
```

```
$ node .scratch/spike/run-survival3.mjs      # 0.83.0
  turn 1 (flag=0)                          wire=1809 chars (ctx=1809 + sysmsg=0, sys msgs=0)
  turn 2 (flag=1)                          wire=0 chars    (ctx=0 + sysmsg=0,    sys msgs=0)
  turn 3 (flag=1)                          wire=0 chars    (ctx=0 + sysmsg=0,    sys msgs=0)
  turn 4 (flag=1, post-reload)             wire=0 chars    (ctx=0 + sysmsg=0,    sys msgs=0)
  turn 5 (flag=1, post-reload)             wire=0 chars    (ctx=0 + sysmsg=0,    sys msgs=0)
  turn 6 (after setActiveToolsByName([]))  wire=0 chars    (ctx=0 + sysmsg=0,    sys msgs=0)
  turn 7 (flag=0, post-reload)             wire=1809 chars (ctx=1809 + sysmsg=0, sys msgs=0)
```

⇒ **候选 C 扛得住全部热重载场景，两版一致，且没有粘滞覆盖。**
这在机制上也是必然的：0.99.2 把强制值投影挂在 `agent.transformContext` 上，
而 `transformContext` 是**每次请求现读** `this._runSystemPromptOptions`
（`dist/core/agent-session.js:1288-1303`）：

```js
_installAgentForcedPromptProjection() {
    const previousTransformContext = this.agent.transformContext;
    this.agent.transformContext = async (messages, signal) => {
        const transformed = previousTransformContext ? await previousTransformContext(messages, signal) : messages;
        const forced = this._runSystemPromptOptions?.forceSystemPrompt;
        if (forced === undefined) return transformed;
        …
```

它既不依赖「上一次写入的值」，也不依赖 extension runner 实例——所以
`session.reload()` 换掉整个 `ExtensionRunner` 也不影响已安装的投影；
真正决定行为的是每轮 `before_agent_start` 的返回值。

> 一条**方法论**记录：先用「把 handler 直接 push 进 `runner.extensions`」测 reload，
> reload 之后 handler 就不见了（第 4 次调用日志缺失），差点得出「候选 C 扛不住
> 热重载」的假结论。那是注入方式的产物——`reload()` 会用资源加载器重建 runner。
> 换成真实文件型 extension 后结论相反。**任何 reload 类结论都必须用可被重新发现
> 的方式注册。**

### 5.4 注册 seam（公开 API，两版都验证）

候选 C 要落地就必须能注册 handler。可选的三条路，实测结果：

```
$ node .scratch/spike/run-seam.mjs      # 0.83.0
=== seam (1): resourceLoaderOptions.extensionFactories ===
  factory invoked = true
  runner extension paths = ["<inline:undefined>"]
  turn 1 wire = 0 chars
  after reload, runner extension paths = ["<inline:undefined>"]
  turn 2 wire = 0 chars
  turn 3 wire = 0 chars

$ node .scratch/spike/run-seam.mjs      # 0.99.2   ← 输出逐字相同
  factory invoked = true
  runner extension paths = ["<inline:undefined>"]
  turn 1 wire = 0 chars
  after reload, runner extension paths = ["<inline:undefined>"]
  turn 2 wire = 0 chars
  turn 3 wire = 0 chars
```

`createAgentSessionServices({ resourceLoaderOptions: { extensionFactories: [...] } })`
是**两版都公开、都在 reload 后存活**的 seam。worksplice 现在就是这么建 services 的
（`lib/rpc/caller.ts:93-96`），改动面只在多传一个字段。

### 5.5 两版门禁数字对照

| | 0.83.0 | 0.99.2 |
| --- | --- | --- |
| `tsc --noEmit` | 0 错误 | 3 错误（`route.ts` ×1、`caller.ts` ×2；`session.ts` ×0） |
| `npm test` | 852 / 852 pass | 837 tests、832 pass、**5 fail** |
| `PRESET_NONE` 会话能否创建 | 能 | **不能**（`caller.ts:154` 抛 `TypeError`） |
| `PRESET_NONE` 实际发出的 system prompt | **1814 / 5758 字符** | （崩溃前测得）1848 字符 |
| 施加候选 C 后 | **0 字符** | **0 字符** |

---

## 6. 凭证边界与两条越界发现

### 6.1 凭证边界

**全程未使用任何 provider 凭证，未伪造任何 key，未使用任何假 provider。**
所有 `AgentSession` 都跑在临时 `agentDir` 上（`auth.json` 不存在）。
唯一的鉴权相关替换是 §2.3 说明的 `hasConfiguredAuth` / `checkAuth` stub，
它是**观察点的前置条件**，不是凭证：没有 key 被写入、读取或解析，
pi-ai 的认证层从未运行（`streamSimple` 捕获器先抛）。**零网络请求。**

### 6.2 越界发现（不在本票问范围内，但会挡住升级）

跑 worksplice 真实路径时撞上一个**前三份文档都没记录**的 0.99.2 硬阻塞：

```
$ node .scratch/spike/run-diff.mjs        # 0.99.2
Error: Invalid color value: undefined
    at parseColor (…/@earendil-works/pi-tui/dist/colors.js:77:11)
    at addToken (…/pi-coding-agent/dist/modes/interactive/theme/theme.js:141:27)
    at new Theme (…/dist/modes/interactive/theme/theme.js:147:36)
    at new PlainTextTheme (…/lib/rpc/session.ts:101:5)
    at /…/lib/rpc/session.ts:123:26
    at async import (…/lib/rpc/caller.ts:21:16)
```

**`lib/rpc/session.ts:99-104` 的 `PlainTextTheme` 在 0.99.2 上于模块 import 期就抛**，
比 systemPrompt 那一行早得多。机制：0.99.2 的 `Theme` 构造函数会**从缺省的键合成新键**：

```js
// pi-coding-agent@0.99.2 dist/modes/interactive/theme/theme.js:126-133
const foregrounds = {
    ...fgColors,
    scrollbarTrack: fgColors.scrollbarTrack ?? fgColors.muted,     // → undefined
    scrollbarThumb: fgColors.scrollbarThumb ?? fgColors.text,     // → undefined
    thinkingMax: fgColors.thinkingMax ?? fgColors.thinkingXhigh,
    searchMatchText: fgColors.searchMatchText ?? fgColors.text,   // → undefined
};
const backgrounds = { ...bgColors, searchMatchBg: bgColors.searchMatchBg ?? bgColors.selectedBg };
```

worksplice 传的是 `{ thinkingXhigh: "" }` / `{}`，四个合成键全是 `undefined`，
`parseColor(undefined)` 抛。0.83.0 的 `Theme` 构造函数没有这段合成，所以不炸。

这解释了那 5 条测试失败里的 3 条（`lib/rpc/{caller,index,session}.test.mjs`
在 import 期就挂）。**本票不改它**（不在授权范围内），但升级票必须先处理它——
它比 systemPrompt 更靠前，且会让 `lib/rpc/*` 的整个测试文件组无法加载。

（spike 为了能跑通真实路径，在**只存在于 spike 脚本里**的 jiti alias 上垫了一层
`Theme` 子类补齐这些键；没有改动任何仓库文件或 `node_modules`。）

### 6.3 本票没有验证的（如实记录）

- **「零工具下没有 system prompt 对模型是否无害」**：需要真实 provider 请求，未测。
  但注意 §5.1 的结论改变了这个问题的性质——main 上这个 prompt **今天就在发**，
  所以这不是「新风险」，是「既有事实」。
- **候选 C 的 handler 与用户自有 `before_agent_start` extension 的共存**：
  handler 链是顺序执行的，后一个 handler 看到前一个的结果
  （`runner.js:1137-1143`），所以用户 extension 可以在 worksplice 之后再覆盖回去。
  **未测**：用户 extension 是否真的会这么做。
- **`ExtensionHandler` 抛异常时的降级**：`runner.js:1144-1155` 会 `emitError` 并
  继续下一个 handler（此时 worksplice 的强制值会失效）。**未测**这条路径。
- **多进程 / 会话并发**：未测。

---

## 7. 给实施票的落地方案（不写代码，只指路）

### 7.1 唯一推荐

**候选 C —— 通过 `before_agent_start` 返回 `{ systemPrompt: "" }` 清零，
并删掉 `applyForcedEmptySystemPrompt` 整个方法。**

理由（三条都有实测支撑）：

1. **它是四个候选里唯一让线上 prompt 归零的**，且在 0.83.0 与 0.99.2 上**同值**（§4.5、§5.2）。
2. **它是唯一有官方语义的通道**：`BeforeAgentStartEventResult.systemPrompt`
   在两版的 `.d.ts` 里都在，0.99.2 的 runner 明确把它映射成
   `forceSystemPrompt`（§4.5）。A/B/D 都是在打一个 SDK 没承诺的内部面。
3. **它是唯一自带「每轮重算」语义的**：强制值由每轮的 handler 返回值决定，
   天然免疫 pi 在 `prompt()` / `setActiveToolsByName()` / 资源 reload 处的覆写
   （§5.3）。现在这套 hack 恰恰是被这三处的覆写打败的（§5.1）。

### 7.2 具体改哪个文件哪一行

| # | 文件:行 | 动作 | 依据 |
| --- | --- | --- | --- |
| 1 | `lib/rpc/session.ts:290-294` | **删除** `applyForcedEmptySystemPrompt()` 整个方法 | §3.2 该行在 0.99.2 抛 `TypeError`；§5.1 它在 0.83.0 上也不生效 |
| 2 | `lib/rpc/session.ts:292` 的 6 个调用点：`199`、`215`、`254`、`589`、`602`、`1029` | **全部删除**这些调用；其中 `215`/`254` 只剩「确保强制值」的作用，一并去掉 | §3.3（`caller.ts:154` 的崩溃链）、§5.1 |
| 3 | `lib/rpc/session.ts:70`（`RpcSessionStartOptions.forceEmptySystemPrompt`）、`:155`（字段）、`:197-200`（`setForceEmptySystemPrompt`）、`:213`、`:587`（`set_tools` 里的调用） | 保留但改为「注册 extension handler」而非「事后写状态」 | §5.4 seam 验证 |
| 4 | `lib/rpc/caller.ts:150-155` | 把 `setForceEmptySystemPrompt(true)` 换成「把这个 session 的 `forceEmptySystemPrompt` 开关交给 handler」；`:164` 的 `beginExtensionBinding({forceEmptySystemPrompt})` 同理 | §5.1（这行现在是崩溃点） |
| 5 | `lib/rpc/caller.ts:93-96`（`createAgentSessionServices`） | 多传 `resourceLoaderOptions.extensionFactories`，注入一个 `before_agent_start` handler：仅当该 session 的强制开关为真时返回 `{ systemPrompt: "" }`，否则返回 `undefined` | §5.4 实测这是两版都公开且 reload 后存活的 seam |
| 6 | `lib/pi-types.ts:131` | 把 `systemPrompt` 标成 `readonly`（可选但建议） | 让下一次同类写入在 `tsc` 期就暴露，而不是运行时静默失效 |
| 7 | `lib/rpc/session.ts:99-105`（`PlainTextTheme` 的 `super(...)`）+ `:123`（模块级 `new PlainTextTheme()`） | **不在本票范围**，但升级票必须先修：0.99.2 的 `Theme` 会合成 `scrollbarTrack` / `scrollbarThumb` / `searchMatchText` / `searchMatchBg` 四个键 | §6.2，含完整栈 |

**顺序建议**：先做 7（否则 `lib/rpc/*` 整个模块在 0.99.2 上 import 就炸），
再做 1–5。1–5 在 0.83.0 上单独也可以先落地——它是纯收益（把今天发不出去的
意图真正发出去），不依赖升级。

### 7.3 落地时必须一起写的测试

现在 852 条测试里**没有一条**覆盖 `PRESET_NONE` / `tools: []` 这条路径
（§3.5 的 852/852 通过就是证据）。落地票至少要加：

- `PRESET_NONE` 会话在**发请求之前**的 system prompt 长度为 0；
- 同一 session 连续三轮仍是 0；
- 经 `session.reload()` 之后仍是 0；
- 经 `set_tools` 切到 `[]` 之后仍是 0；
- 非 `PRESET_NONE` 会话**不受影响**（handler 返回 `undefined` 时线上 prompt 非 0）。

拦截点可以直接用本 spike 的做法（`ModelRuntime.streamSimple` test double），
这样测试不需要任何 provider 凭证。

---

## 8. 证据索引

全部原始输出在 spike 的一次性 worktree 的 `.scratch/spike/out/` 里
（`.scratch/` 已在 `.gitignore:50`，不进 PR）。逐条对应：

### 8.1 崩溃与类型面

| 结论 | 命令 | 输出文件 |
| --- | --- | --- |
| 0.99.2 抛 `TypeError`（裸 SDK） | `node .scratch/spike/run-crash.mjs` | `0.99.2-run-crash.txt` |
| 0.83.0 同一次赋值不抛 | `node .scratch/spike/run-crash.mjs` | `0.83.0-run-crash.txt` |
| 0.99.2 在 worksplice 生产路径上抛（含栈） | `node .scratch/spike/run-real-flow.mjs isolated` | `0.99.2-real-raw.txt` |
| 属性描述符 get/writable 差异 | `node .scratch/spike/run-D.mjs` | `0.99.2-run-D.txt` / `0.83.0-run-D.txt` |
| `tsc` 3 错误且不含 `session.ts` | `node_modules/.bin/tsc --noEmit` | `0.99.2-tsc.txt` |
| `tsc` 0 错误 | `node_modules/.bin/tsc --noEmit` | `0.83.0-tsc.txt`（空文件） |
| `npm test` 852/852 | `npm test` | `0.83.0-npmtest.txt` |
| `npm test` 837/832/**5 fail** | `npm test` | `0.99.2-npmtest-raw.txt` |

### 8.2 候选矩阵

| 结论 | 命令 | 输出文件 |
| --- | --- | --- |
| 基线 / A / A′ / B / C / D 两版逐个实测 | `node .scratch/spike/run-candidates.mjs` | `0.99.2-run-candidates.txt` / `0.83.0-run-candidates.txt` |
| C 返回 `systemPromptOptions` 时无效（两版） | `SPIKE_C_RESULT=options node .scratch/spike/run-candidates.mjs` | `0.99.2-run-candidates-Coptions.txt` / `0.83.0-run-candidates-Coptions.txt` |
| D 的可达性与机制 | `node .scratch/spike/run-D.mjs` | `0.99.2-run-D.txt` / `0.83.0-run-D.txt` |

### 8.3 worksplice 真实路径

| 结论 | 命令 | 输出文件 |
| --- | --- | --- |
| 0.83.0 现状线上 1814 字符 | `node .scratch/spike/run-real-flow.mjs isolated` | `0.83.0-real-raw.txt` |
| 0.83.0 现状 + 真实 agentDir 线上 5758 字符 | `node .scratch/spike/run-real-flow.mjs real` | `0.83.0-real-useragentdir.txt` |
| 0.83.0 + 候选 C → 0 字符（两种 agentDir） | `SPIKE_C_EXT=1 node .scratch/spike/run-real-flow.mjs {isolated,real}` | `0.83.0-real-candC.txt` / `0.83.0-real-useragentdir-candC.txt` |
| 0.99.2 崩溃被吞后线上 1848 字符 | `SPIKE_SWALLOW_FORCE=1 node .scratch/spike/run-real-flow.mjs isolated` | `0.99.2-real-swallow.txt` |
| 0.99.2 + 候选 C → 0 字符（两种 agentDir） | `SPIKE_SWALLOW_FORCE=1 SPIKE_C_EXT=1 node .scratch/spike/run-real-flow.mjs {isolated,real}` | `0.99.2-real-candC.txt` / `0.99.2-real-useragentdir-candC.txt` |
| 连续两轮被踩回基线 | `node .scratch/spike/run-survival.mjs` | `0.99.2-run-survival.txt` / `0.83.0-run-survival.txt` |
| 内联注入在 reload 后失效（方法论反例） | `node .scratch/spike/run-survival2.mjs` | `0.99.2-run-survival2.txt` / `0.83.0-run-survival2.txt` |

### 8.4 热重载与注册 seam

| 结论 | 命令 | 输出文件 |
| --- | --- | --- |
| 文件型 extension 扛住 reload / set_tools / 多轮 / 关闭恢复（两版） | `node .scratch/spike/run-survival3.mjs` | `0.99.2-run-survival3.txt` / `0.83.0-run-survival3.txt` |
| `extensionFactories` seam 两版都公开且 reload 后存活 | `node .scratch/spike/run-seam.mjs` | `0.99.2-run-seam.txt` |

### 8.5 越界发现

| 结论 | 命令 | 输出 |
| --- | --- | --- |
| `PlainTextTheme` 在 0.99.2 import 期抛 | `node .scratch/spike/run-diff.mjs` | 见 §6.2 的栈 |
| 该抛错导致 3 个测试文件加载失败 | `npm test`（0.99.2） | `0.99.2-npmtest-raw.txt` |

### 8.6 还原的证明

```
$ git checkout -- package.json bun.lock
$ /Users/apple/.bun/bin/bun install
$ for p in pi-agent-core pi-ai pi-coding-agent pi-tui; do …done
pi-agent-core 0.83.0
pi-ai 0.83.0
pi-coding-agent 0.83.0
pi-tui 0.83.0
$ git status --porcelain
(空)
$ ls package-lock.json
ls: package-lock.json: No such file or directory
```

### 8.7 本 spike 的实验脚本（`docs/pi-sdk-upgrade-spike.md` §6.7 的补充）

| 脚本 | 作用 |
| --- | --- |
| `.scratch/spike/harness.mjs` | 隔离 cwd/agentDir、`ModelRuntime.streamSimple` 捕获器、统一口径的线上 prompt 统计 |
| `.scratch/spike/session.mjs` | 复刻 `lib/rpc/caller.ts` 的构造路径（`createAgentSessionServices` + `createAgentSessionFromServices`） |
| `.scratch/spike/ext.mjs` | 内联 `before_agent_start` handler 注入（仅用于 §4.5，不用于 reload 结论） |
| `.scratch/spike/run-crash.mjs` | §3 崩溃确认 |
| `.scratch/spike/run-candidates.mjs` | §4 候选矩阵 |
| `.scratch/spike/run-D.mjs` | §4.6 / §3.1 候选 D 与属性描述符 |
| `.scratch/spike/run-real-flow.mjs` | §5 worksplice 真实路径（`RpcCaller` + `wrapper.send`） |
| `.scratch/spike/run-survival.mjs` | §5.1 连续两轮被踩回 |
| `.scratch/spike/run-survival2.mjs` | §5.3 方法论反例（内联注入） |
| `.scratch/spike/run-survival3.mjs` | §5.3 文件型 extension 的热重载生存实验 |
| `.scratch/spike/run-seam.mjs` | §5.4 注册 seam |
| `.scratch/spike/run-diff.mjs` | §6.2 越界发现的复现 + 1809 vs 1814 的逐行 diff |

### 8.8 方法本身的局限

- 观察点是 `ModelRuntime.streamSimple`，它拿到的是 pi-ai 的 `Context`，**不是**
  各 provider 最终发出的 HTTP body。两者的 system prompt 部分在两版上都一一对应
  （0.83.0 走 `context.systemPrompt`，0.99.2 走首条 system message），
  但 provider SDK 是否再加自己的前缀，本票**未验证**。
- 真实用户 agentDir 那一档（5758 / 5792 字符）随用户装的 extension 变化，
  不是稳定数字；只用来说明量级，不用于任何结论。
- 0.99.2 的那次「崩溃被吞后线上 1848 字符」测量依赖 `SPIKE_SWALLOW_FORCE` 这个
  spike-only 开关。它证明的是「假设崩溃被吞掉，线上会是什么」，**不是**
  「崩溃被吞掉后的可用状态」——真正的状态是 `POST /api/agent/new` 500。