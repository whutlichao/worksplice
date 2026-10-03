# 可执行 spike：`setModel()` / `setThinkingLevel()` 的全局设置副作用（B-2）

> 这是一份**可执行实验**的记录。本票是升级实施票四个卡点里的最后一个——
> B-2，也是唯一一个至今「未经实跑验证」的。
>
> 前三个卡点已由 PR #48 / #52 / #55 取证完毕。本文件把 `0.83.0` / `0.84.2` /
> `0.84.3` / `0.99.2` 四个版本都装出来，用**同一支探针**实测
> 「创建 session → 调 `setModel` / `setThinkingLevel` → 读 `SettingsManager` 默认值」
> 的前后差异，并回答评估报告留下的那个真问题：
> **丢掉这个副作用，到底让哪些用户可观察的行为发生变化？**
>
> **本 PR 不含任何升级。** `package.json` / `bun.lock` 在实验中被临时改动到
> `0.99.2`（中途还经过 `0.84.2` / `0.84.3` 以定位落地版本），交付前已
> **逐字还原**（§8.5 贴 `shasum` 对照）。唯一交付物是本文件。
>
> 取证纪律：一手来源只有**实跑输出**、**装出来的包源码**、**本仓代码**。
> **每条结论都带命令 + 该命令的真实输出**，索引见 §8。
> **全程零凭证**：provider 是写在**隔离 `agentDir`** 里的自定义 `models.json`
> 条目，`apiKey` 是字面占位串，`baseUrl` 指向一个没有服务在听的端口
> （`http://127.0.0.1:9/v1`）。**从未读写用户真实的 `~/.pi` 目录**（§4.1）。

---

## 1. 结论（TL;DR）

### 1.1 一句话

**★ 评估报告 §4.2 的判断「成立，但归因版本错、且严重度描述偏高」。**
`0.84.3` 起两个 setter 确实不再默认写全局设置，opt-in 形状就是 `{ persist: true }`；
但它**只影响一个用户可观察行为**——遗留 pi-web 聊天面（`ChatWindow`）
在**已运行会话**上换模型/换思考级别后，下一个**新建会话**的默认值不再跟着变。
per-agent 模型（`members` 表）、新建会话的显式选择（`persistExplicitStartupPreferences`）、
以及 session jsonl **三条路径都不受影响**。

### 1.2 结论速览

| 问题 | 结论 |
| --- | --- |
| **Q1 上游语义** | **成立**。`0.83.0` 无条件写；`0.84.3`+ 改为 `options.persist` opt-in（默认 false）。**归因修正**：落地版本是 **`0.84.3`**（2026-08-24），不是「0.99.x」。 |
| **Q2 类型层** | **不报错**。`tsc --noEmit` 在 `0.99.2` 上的报错只有 3 处，**没有一处**在 `lib/rpc/session.ts:430/:483`。但**照现状确实传不进 opt-in**：镜像 `lib/pi-types.ts:149` 一旦写 `setModel(model, {persist:true})` 就报 `error TS2554: Expected 1 arguments, but got 2`（§3.2 Case B）。 |
| **Q3 实测** | **跑通了，零凭证**。`0.83.0` 换模型后全局默认从 `spike-alpha` 变 `spike-beta`；`0.99.2` 不传 opt-in 时**纹丝不动**（§4.2）。 |
| **Q4 影响面** | **低于报告描述**。只有一条路径可观察（§5.2 逐条裁决、§5.3 结论）。 |
| **Q5 修法** | **不要用 `{persist:true}`**（实测它带两个副作用）。改用**显式写 `SettingsManager`**，与 `lib/startup-preferences.ts` 同一个接缝。已实跑验证（§6.3）。 |
| **Q6 旧版等价** | **等价**。`0.83.0` 上 SDK 已经写了全局默认，显式再写一次是幂等的，落盘字节相同（§6.3 / §6.4）。 |

### 1.3 四条硬结论

1. **`{persist:true}` 这个 opt-in 带两个没人要的副作用**，这是评估报告没提、也是
   我不推荐它的原因：
   - **它写的是「请求值」而不是「生效值」**。实测：在一个只支持 `off` 的模型上调
     `setThinkingLevel("high", {persist:true})`，session 里 `thinkingLevel` 被夹成
     `"off"`，而落盘的 `defaultThinkingLevel` 写的是 **`"high"`**——全局默认变成一个
     当前模型根本用不了的档位（§4.4 STEP 3c）。`0.83.0` 在同一情形下**根本不写**。
   - **`setModel(..., {persist:true})` 还会顺手改 `settings.json` 的 `enabledModels`**。
     实测：session 带非空 `scopedModels`（worksplice 的 `lib/rpc/caller.ts:110/:122`
     就会传）时，opt-in 分支额外调用 `_addPersistedDefaultToNonEmptyScope(model)`，
     把模型**追加进 `enabledModels`**（§4.4 STEP 6）。`enabledModels` 喂给
     `lib/model-scope.ts` 做可见模型 glob 过滤——等于用一次「换模型」顺手扩大了
     模型下拉框的范围。**这个副作用在 `0.84.3` 上还没有**（§2.3），是后来加的。
2. **`0.83.0` 的全局写副作用里有一条是纯粹的历史包袱**，升级把它顺手删掉了：
   `setModel()` 内部会 `setThinkingLevel()` 重夹一次思考级别，
   **`0.83.0` 会因此把全局 `defaultThinkingLevel` 也一起改掉**。实测：`0.83.0` 上
   只换模型（不碰思考级别），全局 `defaultThinkingLevel` 从 `"off"` 被改成
   `"minimal"`（§4.2）。`0.99.2` 的源码注释直说这是有意为之：
   *"Model persistence does not implicitly rewrite the global thinking default."*
   **这一条是行为改善，不是回归。**
3. **镜像签名确实挡住了 opt-in，但它不是这次升级的新伤**。`lib/pi-types.ts:149/:151`
   在 `0.83.0` 上也一样传不进第二参数——`TS2554` 在两个版本上都复现（§3.2）。
   而且把镜像放宽（`options?: { persist?: boolean }`）在**两个版本上都干净**
   （Case C 两版都只剩 `steer` 那条既有报错 / `0.83.0` 上完全干净）。
4. **凭证边界全程守住**：隔离 `agentDir` 里 `auth.json` 实验前后都是 `{}`；
   `checkAuth("spike-local")` 由 `provider-composer.js` 的 `apiKey.check` 从
   `models.json` 字面量本地作答 `{"type":"api_key","source":"configured API key"}`，
   **没有任何网络请求，也没有伪造任何真实凭证**（§4.1）。

### 1.4 English summary

> **Upstream semantics confirmed from shipped source, not the changelog.**
> `setModel()` / `setThinkingLevel()` stopped writing global defaults in
> **`0.84.3`** (not "0.99.x"); the opt-in is `{ persist: true }` on both.
> On `0.83.0` a model switch alone rewrote `defaultThinkingLevel`; on `0.99.2` it does not.
>
> **The opt-in is not a free fix**: it persists the *requested* thinking level rather
> than the clamped one, and `setModel(..., {persist:true})` also appends to
> `settings.json`'s `enabledModels` when the session has a non-empty scope.
> Recommended fix instead: keep the SDK setter session-scoped and write
> `SettingsManager` explicitly — the same seam `lib/startup-preferences.ts` already owns.
>
> **Blast radius is smaller than the assessment report implies**: exactly one
> user-observable behaviour changes (mid-session model/thinking change in the legacy
> pi-web chat surface no longer seeds the *next* new session's default).
> Per-agent config, new-session explicit picks and session jsonl are unaffected.
> Verified with a zero-credential custom `models.json` provider inside an isolated
> `agentDir`; the real `~/.pi` was never read or written.

---

## 2. 上游语义定论

> 取证方法：把四个版本分别 `bun install` 进 `node_modules`，直接读**装出来的
> `dist/core/agent-session.js` 与 `dist/core/agent-session.d.ts`**。
> **不看 CHANGELOG 定论**——CHANGELOG 只在最后用来交叉验证落地版本。

### 2.1 `0.83.0`：无条件写全局设置

`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js`

`setModel`（`:1189-1206`，逐行）：

```js
    /**
     * Set model directly.
     * Validates that auth is configured, saves to session and settings.
     * @throws Error if no auth is configured for the model
     */
    async setModel(model) {                                              // :1194
        if (!(await this._modelRuntime.checkAuth(model.provider))) {
            throw new Error(`No API key for ${model.provider}/${model.id}`);
        }
        const previousModel = this.model;
        const thinkingLevel = this._getThinkingLevelForModelSwitch();
        this.agent.state.model = model;
        this.sessionManager.appendModelChange(model.provider, model.id);
        this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);   // :1202  ← 无条件
        // Re-clamp thinking level for new model's capabilities
        this.setThinkingLevel(thinkingLevel);                            // :1204  ← 不传 options（那时也没有）
        await this._emitModelSelect(model, previousModel, "set");
    }
```

`setThinkingLevel`（`:1270-1294`，逐行）：

```js
    setThinkingLevel(level) {                                             // :1275
        const availableLevels = this.getAvailableThinkingLevels();
        const effectiveLevel = availableLevels.includes(level) ? level : this._clampThinkingLevel(level, availableLevels);
        // Only persist if actually changing
        const previousLevel = this.agent.state.thinkingLevel;
        const isChanging = effectiveLevel !== previousLevel;
        this.agent.state.thinkingLevel = effectiveLevel;
        if (isChanging) {
            this.sessionManager.appendThinkingLevelChange(effectiveLevel);
            if (this.supportsThinking() || effectiveLevel !== "off") {
                this.settingsManager.setDefaultThinkingLevel(effectiveLevel);        // :1285  ← 写「生效值」
            }
            this._emit({ type: "thinking_level_changed", level: effectiveLevel });
            void this._extensionRunner.emit({
                type: "thinking_level_select",
                level: effectiveLevel,
                previousLevel,
            });
        }
    }
```

声明侧（`dist/core/agent-session.d.ts`）逐字：

```
$ grep -n "setModel(model: Model<any>)\|setThinkingLevel(level: ThinkingLevel)" \
    .scratch/spike/agent-session-0.83.0.d.ts
448:    setModel(model: Model<any>): Promise<void>;
463:    setThinkingLevel(level: ThinkingLevel): void;

$ grep -c "ModelMutationOptions" .scratch/spike/agent-session-0.83.0.d.ts
0
```

**`0.83.0` 的三个隐藏细节（后面都要用到）：**

1. 写的是**夹紧后的生效值** `effectiveLevel`，不是用户请求的 `level`。
2. 写盘**被两个条件门住**：`isChanging`（值没变就不写）**且**
   `supportsThinking() || effectiveLevel !== "off"`。
3. `setModel` 内部会调 `setThinkingLevel(thinkingLevel)` 重夹一次思考级别，
   所以**换模型会顺带改全局 `defaultThinkingLevel`**。

### 2.2 `0.99.2`：`options.persist` opt-in

`dist/core/agent-session.js`：

```js
    async setModel(model, options = {}) {                                // :1884
        if (!(await this._modelRuntime.checkAuth(model.provider))) {
            throw new Error(`No API key for ${model.provider}/${model.id}`);
        }
        const previousModel = this.model;
        const thinkingLevel = this._getThinkingLevelForModelSwitch(model);
        this.agent.state.model = model;
        this.sessionManager.appendModelChange(model.provider, model.id);
        if (options.persist) {                                           // :1892
            this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);
            this._addPersistedDefaultToNonEmptyScope(model);             // :1894  ← 0.83.0 没有的第二副作用
        }
        // Apply thinking level for the new model.
        // Per-model thinking level overrides take priority over the global default.
        // Model persistence does not implicitly rewrite the global thinking default.
        this.setThinkingLevel(thinkingLevel);                            // 不传 options → 不再隐式改全局思考默认
        await this._emitModelSelect(model, previousModel, "set");
    }
```

```js
    setThinkingLevel(level, options = {}) {                              // :1990
        const availableLevels = this.getAvailableThinkingLevels();
        const effectiveLevel = availableLevels.includes(level) ? level : this._clampThinkingLevel(level, availableLevels);
        // Only persist if actually changing
        const previousLevel = this.agent.state.thinkingLevel;
        const isChanging = effectiveLevel !== previousLevel;
        this.agent.state.thinkingLevel = effectiveLevel;
        if (options.persist) {                                           // :1997
            this.settingsManager.setDefaultThinkingLevel(level);         // ← 写「请求值」，与 0.83.0 相反
        }
        if (isChanging) {
            this.sessionManager.appendThinkingLevelChange(effectiveLevel);
            ...
        }
    }
```

声明侧逐字：

```
$ sed -n '177,181p' .scratch/spike/agent-session-0.99.2.d.ts
/** Options for model/thinking mutations. */
export interface ModelMutationOptions {
    /** Persist the new value to global defaults. Defaults to session-only. */
    persist?: boolean;
}

$ grep -n "setModel(model: Model<any>, options\|setThinkingLevel(level: ThinkingLevel, options" \
    .scratch/spike/agent-session-0.99.2.d.ts
607:    setModel(model: Model<any>, options?: ModelMutationOptions): Promise<void>;
624:    setThinkingLevel(level: ThinkingLevel, options?: ModelMutationOptions): void;
```

**`0.99.2` 与 `0.83.0` 的四处语义差异（全部实测确认，见 §4）：**

| | `0.83.0` | `0.99.2` |
| --- | --- | --- |
| 默认是否写全局设置 | **是** | **否** |
| opt-in 形状 | 无 | `{ persist: true }`（两个 setter 同一个 `ModelMutationOptions`） |
| 写思考默认时写哪个值 | 夹紧后的 `effectiveLevel` | 用户请求的 `level` |
| 写思考默认的附加条件 | `isChanging` 且（`supportsThinking()` 或 `≠ "off"`） | 无条件（只要 `options.persist`） |
| `setModel` 是否顺带改全局思考默认 | **会** | **不会**（源码注释显式声明） |
| `setModel` opt-in 是否顺带改 `enabledModels` | 不会 | **会**（`_addPersistedDefaultToNonEmptyScope`） |

### 2.3 ★ 归因修正：落地版本是 `0.84.3`，不是「0.99.x」

评估报告写的是「0.99.x」。这不影响修法，但影响升级票的判断——**这条行为变化从
`0.84.3` 就存在了，不是 0.99 断层带来的新东西**。逐版本实测：

```
# 0.84.2
$ grep -n "async setModel\|setThinkingLevel(level" \
    node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js
1197:    async setModel(model) {
1275:    setThinkingLevel(level) {

$ grep -c "options.persist\|persist?: boolean" .../dist/core/agent-session.js \
    .../dist/core/agent-session.d.ts
.../dist/core/agent-session.js:0
.../dist/core/agent-session.d.ts:0

# 0.84.2 的 setModel 里那一行仍然是无条件的：
$ sed -n '1197,1208p' .../dist/core/agent-session.js
    async setModel(model) {
        ...
        this.sessionManager.appendModelChange(model.provider, model.id);
        this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);   // ← 无 if
        // Re-clamp thinking level for new model's capabilities
        this.setThinkingLevel(thinkingLevel);
        ...

# 0.84.3
$ grep -n "async setModel(model, options\|setThinkingLevel(level, options\|if (options.persist)" \
    node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js
1201:    async setModel(model, options = {}) {
1209:        if (options.persist) {
1246:        if (options.persist) {
1272:        if (options.persist) {
1290:    setThinkingLevel(level, options = {}) {
1297:        if (options.persist) {
```

与 CHANGELOG 交叉验证（**只作交叉验证，定论仍以 dist 为准**）：

```
$ awk 'NR<=470 && /^## \[/ {v=$0; n=NR} NR==431 {print "line431 under: " v} NR==467 {print "line467 under: " v}' \
    node_modules/@earendil-works/pi-coding-agent/CHANGELOG.md
line431 under: ## [0.84.3] - 2026-08-24
line467 under: ## [0.84.3] - 2026-08-24

$ sed -n '431p;467p' node_modules/@earendil-works/pi-coding-agent/CHANGELOG.md
- **Model and thinking controls** — Select thinking levels with `/thinking`, search defaults, keep selections session-scoped, and persist them explicitly with Ctrl+S. …
- Fixed `/model` and `/thinking` selections being persisted globally unless explicitly saved with Ctrl+S ([#5263](https://github.com/earendil-works/pi/issues/5263)).
```

顺带查到一条评估报告没提的**新持久化面**：`0.99.2` 的
`SettingsManager.getModelThinkingLevel(provider, modelId)` /
`setModelThinkingLevel(...)`（`dist/core/settings-manager.d.ts:244/:246`，落盘键
`Settings.modelThinkingLevels?: Record<string, ThinkingLevel>`，`.d.ts:97`），
被 `_getThinkingLevelForModelSwitch(targetModel, explicitLevel)` 用来做
「per-model 思考默认」。`0.83.0` 的 `dist` 里 `getModelThinkingLevel` **零命中**。
它同样只在 `settings.json` 里，本票未展开（§7）。

### 2.4 对评估报告 §4.2 的判定

> **成立**——`setModel()` / `setThinkingLevel()` 从 `0.84.3` 起不再默认写全局设置，
> opt-in 形状就是 `{ persist: true }`，这一点由**装出来的 `dist` 源码**逐行证实，
> 不是来自 changelog。
>
> **需要修正为**：
> 1. **落地版本 `0.84.3`**，不是「0.99.x」。
> 2. 「类型层是加法，`tsc` 不会报」——**成立**，但要补一句：它同时意味着
>    **opt-in 传不进去**（镜像挡住了），所以「加法」在这里是**坏消息而不是好消息**（§3）。
> 3. 「纯运行时语义变化」——**成立且低估了范围**：除了不再写全局默认，
>    `setThinkingLevel` 写的值从「生效值」变成「请求值」、`setModel` 的 opt-in
>    还会改 `enabledModels`（§2.2 表）。
> 4. **严重度**：报告没有量化实际影响面。实测后是**一条路径**（§5.2），
>    低于「用户在 UI 里换模型不再持久化，重启后回到旧值」这种读法隐含的分量——
>    因为 worksplice 的模型事实来源本来就不是全局设置（§5.1）。

---

## 3. 类型层：镜像挡住了 opt-in，但**这次升级不会因此报任何错**

### 3.1 全仓 `tsc --noEmit` 在 `0.99.2` 上的真实输出

```
$ node_modules/.bin/tsc --noEmit            # 0.99.2
app/api/auth/api-key/[provider]/route.ts(34,47): error TS2345: Argument of type '{ notify: () => void; prompt: (prompt: AuthPrompt) => Promise<string>; }' is not assignable to parameter of type 'ProviderAuthInteraction'.
  Property 'signal' is missing in type '{ notify: () => void; prompt: (prompt: AuthPrompt) => Promise<string>; }' but required in type '{ signal: AbortSignal; }'.
lib/rpc/caller.ts(146,55): error TS2345: Argument of type 'AgentSession' is not assignable to parameter of type 'AgentSessionLike'.
  The types returned by 'steer(...)' are incompatible between these types.
    Type 'Promise<QueuedInputDisposition>' is not assignable to type 'Promise<void>'.
      Type 'string' is not assignable to type 'void'.
        Type 'string' is not assignable to type 'void'.
lib/rpc/caller.ts(149,47): error TS2345: Argument of type 'AgentSession' is not assignable to parameter of type 'AgentSessionLike'.
  The types returned by 'steer(...)' are incompatible between these types.
    Type 'Promise<QueuedInputDisposition>' is not assignable to type 'Promise<void>'.
      Type 'string' is not assignable to type 'void'.
        Type 'string' is not assignable to type 'void'.

$ node_modules/.bin/tsc --noEmit            # 0.83.0（同一条命令，退出码 0）
（无输出，退出码 0）
```

**答案：`0.99.2` 下本仓这两行不报错。** `lib/rpc/session.ts:430` / `:483` 一条错都没有。
唯一的 `AgentSessionLike` 相关报错在 **`lib/rpc/caller.ts:146` 与 `:149`**
——那是 `steer` 返回值从 `Promise<void>` 变成 `Promise<QueuedInputDisposition>`
引起的，**正是 PR #48 已证实的那个机制**，与 B-2 无关。

**为什么 `setModel` 加了可选第二参数反而没人管：** `lib/pi-types.ts` 是**手写结构镜像**，
`AgentSessionWrapper.inner` 的类型就是它（`lib/rpc/session.ts:162`
`constructor(public readonly inner: AgentSessionLike)`）。可选尾参在结构化赋值里
是**合法的源类型**（源比目标多出来的可选参数不构成不兼容），所以镜像少写一个
可选参数**不会**被 `tsc` 发现——它只会让 opt-in 传不进去（§3.2）。

### 3.2 三支类型探针（镜像逐字复制，不改仓库文件）

`.scratch/spike/gen-type-probes.mjs` 把 `lib/pi-types.ts` **整份逐字复制**一份
（生成时断言 `169` 行、末行为 `}`，防止漂移），只在副本上做三种改动：

```js
// .scratch/spike/gen-type-probes.mjs:5-13
const src = readFileSync(`${repo}/lib/pi-types.ts`, "utf8");
const lines = src.split("\n");
if (lines.length !== 170 || lines[168] !== "}" || lines[169] !== "")
  throw new Error(`lib/pi-types.ts drifted: ${lines.length} lines`);
const whole = src;                       // 整份副本，带齐 ModelLike / ContextUsage / ...
```

Case A = 今天的镜像 + 今天的调用形状（`lib/rpc/session.ts:430/:483` 逐字）。
Case B = 今天的镜像 + `{persist:true}` 调用形状。
Case C = 把镜像两行放宽成 `options?: { persist?: boolean }` 再重跑 A + B。

`0.99.2` 上：

```
$ node_modules/.bin/tsc --noEmit --strict --skipLibCheck \
    --target es2022 --module esnext --moduleResolution bundler <file>

########## a-current-mirror.ts ##########
.scratch/spike/tc/a-current-mirror.ts(177,14): error TS2322: Type 'AgentSession' is not assignable to type 'AgentSessionLike'.
  The types returned by 'steer(...)' are incompatible between these types.
    Type 'Promise<QueuedInputDisposition>' is not assignable to type 'Promise<void>'.
      Type 'string' is not assignable to type 'void'.
        Type 'string' is not assignable to type 'void'.
exit=2

########## b-optin-on-todays-mirror.ts ##########
.scratch/spike/tc/b-optin-on-todays-mirror.ts(178,33): error TS2554: Expected 1 arguments, but got 2.
exit=2

########## c-mirror-with-optin.ts ##########
.scratch/spike/tc/c-mirror-with-optin.ts(176,14): error TS2322: Type 'AgentSession' is not assignable to type 'AgentSessionLike'.
  The types returned by 'steer(...)' are incompatible between these types.
    Type 'Promise<QueuedInputDisposition>' is not assignable to type 'Promise<void>'.
      Type 'string' is not assignable to type 'void'.
        Type 'string' is not assignable to type 'void'.
exit=2
```

`0.83.0` 上（同一支探针、同一套命令）：

```
########## a-current-mirror.ts ##########
exit=0

########## b-optin-on-todays-mirror.ts ##########
.scratch/spike/tc/b-optin-on-todays-mirror.ts(178,33): error TS2554: Expected 1 arguments, but got 2.
exit=2

########## c-mirror-with-optin.ts ##########
exit=0
```

### 3.3 逐条回答

| 问题 | 回答 |
| --- | --- |
| `0.99.2` 下这两行会不会报错？ | **不会**（§3.1：报错只在 `caller.ts:146/:149` 与 auth 路由，与 B-2 无关）。 |
| 照现状能传 opt-in 吗？ | **不能**。Case B：`error TS2554: Expected 1 arguments, but got 2`。 |
| 报在哪个文件哪一行？ | 报在**改过的那一行本身**。以 `lib/rpc/session.ts:430` 为例，改成 `await this.inner.setModel(model, { persist: true });` 后，`tsc` 报 `lib/rpc/session.ts(430,45): error TS2554: Expected 1 arguments, but got 2.`（列号随那一行的实际排版而定；Case B 里对应副本第 `178` 行 = 该调用的第 3 列）。`lib/rpc/session.ts:483` 同理报在 `:483`。 |
| 镜像 `lib/pi-types.ts:149/:151` 必须改吗？ | **传 opt-in 就必须改**。两处签名改为 `setModel(model: ModelLike, options?: { persist?: boolean }): Promise<void>;` / `setThinkingLevel(level: string, options?: { persist?: boolean }): void;`。Case C 证明放宽后 `0.83.0` 与 `0.99.2` 上都不引入新问题（`0.83.0` 完全干净，`0.99.2` 只剩 `steer` 那条既有报错）。 |
| 放宽镜像安全吗？ | 安全，但**不必要**——见 §6，唯一推荐写法根本不需要镜像带 options。 |

**注意 Case B 的重要含义：这不是本次升级引入的新伤。** `TS2554` 在 `0.83.0` 上
一模一样地复现（`exit=2`，同一行）。也就是说「镜像挡住第二参数」这件事
**在升级前后一模一样**，升级没有让它变坏。

---

## 4. 实测行为：两版跑同一支探针

探针 `.scratch/spike/b2-probe.mjs` 的形状刻意贴着本仓的两处调用点：

```js
// STEP 1 —— lib/rpc/session.ts:421-434 的逐字形状
let model = session.modelRuntime.getModel("spike-local", "spike-beta");
if (!model) { await session.modelRuntime.refresh({ allowNetwork: false }); model = session.modelRuntime.getModel(...); }
if (!model) throw new Error(...);
await session.setModel(model);                    // ← 单参，无 options

// STEP 2 —— lib/rpc/session.ts:481-492 的逐字形状
session.setThinkingLevel("high");                 // ← 单参，无 options
```

### 4.1 ★ 凭证边界：零凭证跑通（先证明这件事，再谈结论）

隔离 `agentDir` 由 `mkdtempSync` 产生，同时设 `PI_CODING_AGENT_DIR`
（`dist/config.js:412-418` 的 `getAgentDir()` 只认这个环境变量）与显式
`createAgentSession({ agentDir: root })`。里面放一份自定义 provider：

```jsonc
// <isolatedAgentDir>/models.json
{
  "providers": {
    "spike-local": {
      "baseUrl": "http://127.0.0.1:9/v1",                       // 没有服务在听的端口
      "api": "openai-completions",
      "apiKey": "spike-placeholder-not-a-real-key",             // 字面占位串，不是任何真实凭证
      "models": [
        { "id": "spike-alpha", "reasoning": false, ... },
        { "id": "spike-beta",  "reasoning": true,  "thinkingLevelMap": {...}, ... }
      ]
    }
  }
}
```

实测输出（两版逐字相同）：

```
$ node .scratch/spike/b2-probe.mjs
### SDK versions under test: {"pi-agent-core":"0.83.0","pi-ai":"0.83.0","pi-coding-agent":"0.83.0","pi-tui":"0.83.0"}
  isolated agentDir = /var/folders/bf/27rt5fsx01q0bq602vmhprsw0000gn/T/ws-b2-agent-qROJmv
  isolated cwd      = /var/folders/bf/27rt5fsx01q0bq602vmhprsw0000gn/T/ws-b2-cwd-XXXXXX
  real ~/.pi touched: NO (PI_CODING_AGENT_DIR + explicit agentDir)
  getAgentDir()     = /var/folders/bf/27rt5fsx01q0bq602vmhprsw0000gn/T/ws-b2-agent-qROJmv (isolated OK)
  ...
  getModel('spike-local','spike-beta') = spike-local/spike-beta api=openai-completions reasoning=true
  checkAuth('spike-local') = {"type":"api_key","source":"configured API key"} (answered locally from models.json apiKey literal)
```

`auth.json` 实验前后逐字为空对象：

```
$ cat <isolatedAgentDir>/auth.json
{}
```

`checkAuth` 之所以不需要网络，是因为 `provider-composer.js` 的
`composeApiKeyAuth().check` 在 `rawKey !== undefined`（`models.json` 写了字面量）时
直接本地作答：

```js
// node_modules/@earendil-works/pi-coding-agent/dist/core/provider-composer.js:203-212（节选）
        check: async (input) => {
            if (input.credential) { /* … 走存储的 credential … */ }
            if (rawKey !== undefined) {          // rawKey = models.json 的 apiKey 字面量
                if (isCommandConfigValue(rawKey))
                    return { type: "api_key", source: "configured API key" };
                const envNames = getConfigValueEnvVarNames(rawKey);
                for (const name of envNames) {
                    if ((await input.ctx.env(name)) === undefined)
                        return undefined;
                }
                return { type: "api_key", source: "configured API key" };   // ← 本地作答，不发请求
            }
```

**结论：全程没有伪造凭证，也没有触碰用户真实 `~/.pi`。**
`baseUrl` 指向的 `127.0.0.1:9` 从头到尾没有请求发出去——因为
`setModel` / `setThinkingLevel` 只做 auth **检查**、不发请求。

### 4.2 主对照：换模型 / 换思考级别的前后差异

**两版完全相同的起点**（`defaultProvider=spike-local`、`defaultModel=spike-alpha`、
`defaultThinkingLevel=off`）：

```
### 0.83.0

=== BASELINE (right after construction, before any setter) ===
  [before] settingsManager.getDefaultProvider()="spike-local" getDefaultModel()="spike-alpha" getDefaultThinkingLevel()="off"
  [before] settings.json on disk: {"defaultProvider":"spike-local","defaultModel":"spike-alpha","defaultThinkingLevel":"off"}

=== STEP 1: the exact worksplice write — lib/rpc/session.ts:421-434 verbatim shape ===
  [pre-setModel] settingsManager default model="spike-alpha"
  --- after setModel(spike-beta) ---
  [after-setModel] settingsManager.getDefaultProvider()="spike-local" getDefaultModel()="spike-beta" getDefaultThinkingLevel()="minimal"     ← ★ 全局模型改了，全局思考级别也被顺带改了
  [after-setModel] settings.json on disk: {"defaultProvider":"spike-local","defaultModel":"spike-beta","defaultThinkingLevel":"minimal"}
  session.model = spike-local/spike-beta  session.thinkingLevel="minimal"

=== STEP 2: the exact worksplice write — lib/rpc/session.ts:481-492 verbatim shape ===
  [pre-setThinkingLevel] session.thinkingLevel="minimal" defaultThinkingLevel="minimal"
  --- after setThinkingLevel('high') ---
  [after-setThinkingLevel] settingsManager.getDefaultProvider()="spike-local" getDefaultModel()="spike-beta" getDefaultThinkingLevel()="high"
  session.thinkingLevel = "high"
```

```
### 0.99.2

=== BASELINE (right after construction, before any setter) ===
  [before] settingsManager.getDefaultProvider()="spike-local" getDefaultModel()="spike-alpha" getDefaultThinkingLevel()="off"
  [before] settings.json on disk: {"defaultProvider":"spike-local","defaultModel":"spike-alpha","defaultThinkingLevel":"off"}

=== STEP 1: the exact worksplice write — lib/rpc/session.ts:421-434 verbatim shape ===
  [pre-setModel] settingsManager default model="spike-alpha"
  --- after setModel(spike-beta) ---
  [after-setModel] settingsManager.getDefaultProvider()="spike-local" getDefaultModel()="spike-alpha" getDefaultThinkingLevel()="off"     ← ★ 纹丝不动
  [after-setModel] settings.json on disk: {"defaultProvider":"spike-local","defaultModel":"spike-alpha","defaultThinkingLevel":"off"}
  session.model = spike-local/spike-beta  session.thinkingLevel="minimal"          ← session 内生效照常

=== STEP 2: the exact worksplice write — lib/rpc/session.ts:481-492 verbatim shape ===
  [pre-setThinkingLevel] session.thinkingLevel="minimal" defaultThinkingLevel="off"
  --- after setThinkingLevel('high') ---
  [after-setThinkingLevel] settingsManager.getDefaultProvider()="spike-local" getDefaultModel()="spike-alpha" getDefaultThinkingLevel="off"   ← ★ 纹丝不动
  session.thinkingLevel = "high"                                                                                                                 ← session 内生效照常
```

**前后差异汇总（三行，值取自上面两段真实输出）：**

| | `0.83.0` | `0.99.2` |
| --- | --- | --- |
| 换模型后 `defaultModel` | `spike-alpha` → **`spike-beta`** | `spike-alpha` → `spike-alpha`（不变） |
| 换模型后 `defaultThinkingLevel` | `off` → **`minimal`**（顺带被改） | `off` → `off`（不变） |
| 换思考级别后 `defaultThinkingLevel` | `minimal` → **`high`** | `off` → `off`（不变） |
| session 内是否生效 | 是 | **是**（`session.model=spike-local/spike-beta`、`thinkingLevel="high"` 两版逐字相同） |

### 4.3 transcript 侧：两版逐字相同，没变

```
# 0.83.0
  branch entry types: ["model_change(spike-local/spike-alpha)","thinking_level_change","model_change(spike-local/spike-beta)","thinking_level_change","thinking_level_change", …]
# 0.99.2
  branch entry types: ["model_change(spike-local/spike-alpha)","thinking_level_change","model_change(spike-local/spike-beta)","thinking_level_change","thinking_level_change","thinking_level_change","model_change(spike-local/spike-beta)","thinking_level_change", …]
```

`appendModelChange` / `appendThinkingLevelChange` 在两版都照常跑。
**session jsonl 不是受影响面。**

（补一句口径说明：`.jsonl` 文件本身在磁盘上是空的，`sessionFile on disk after
dispose: absent`。这不是 bug，是 `dist/core/session-manager.js:724-739` 的
`_persist()` 设计——「没有 assistant 消息前先把条目攒在内存里，等 assistant 到了
一次性写盘」。本票不发 LLM 请求（零凭证），所以读的是
`sessionManager.getBranch()` 内存分支，条目与落盘的一致。）

### 4.4 opt-in 侧的三个实测发现

**STEP 3b —— `{persist:true}` 确实能开回来，但写的是「请求值」：**

```
### 0.99.2
=== STEP 3b: what the OPT-IN call shape does on THIS version ===
  [after-setModel(spike-beta, {persist:true})] getDefaultModel()="spike-beta"                        ← 开了回来
  spike-beta available thinking levels = ["minimal","low","medium","high","xhigh","max"]
  [after-setThinkingLevel("xhigh", {persist:true})] getDefaultThinkingLevel()="xhigh"
```

**STEP 3c —— ★ 写「请求值」而不是「生效值」，这是 `{persist:true}` 的第一个坑：**

```
### 0.99.2
=== STEP 3c: requested-vs-clamped divergence (spike-alpha supports ONLY 'off') ===
  after switching to spike-alpha: availableLevels=["off"] supportsThinking=false
  [on-spike-alpha-before] getDefaultThinkingLevel()="xhigh"
  [after-setThinkingLevel("high", {persist:true}) on a non-thinking model] getDefaultThinkingLevel()="high"    ← 写的是 "high"
  session.thinkingLevel (clamped) = "off"  <-- vs defaultThinkingLevel above                            ← 生效的是 "off"

### 0.83.0（同一段探针）
  [after-setThinkingLevel("high", {persist:true}) on a non-thinking model] getDefaultThinkingLevel()="xhigh"   ← 压根不写（supportsThinking()=false 且 effective==="off"）
  session.thinkingLevel (clamped) = "off"
```

也就是说：照搬 `{persist:true}` 会让全局默认落成一个**当前模型用不了的档位**。
`0.83.0` 在同一情形下是不写的。这是**语义回归**，不是等价修法。

**STEP 6 —— ★ `setModel(..., {persist:true})` 还会改 `enabledModels`：**

```
### 0.99.2
=== STEP 6: opt-in side effect on `enabledModels` when scopedModels is non-empty ===
  seeded settings.json: {"defaultProvider":"spike-local","defaultModel":"spike-alpha","defaultThinkingLevel":"off","enabledModels":["spike-local/spike-alpha"]}
  s6.model=spike-local/spike-alpha enabledModels(before)=["spike-local/spike-alpha"]
  after setModel(spike-beta)            → enabledModels = ["spike-local/spike-alpha"] defaultModel = "spike-alpha"
  after setModel(spike-beta,{persist})   → enabledModels = ["spike-local/spike-alpha"] defaultModel = "spike-alpha"
  raw settings.json now: {"defaultProvider":"spike-local","defaultModel":"spike-beta","defaultThinkingLevel":"off","enabledModels":["spike-local/spike-alpha","spike-local/spike-beta"]}
                                                                          ↑ opt-in 把模型追加进了 enabledModels

### 0.83.0（同一段探针）
  raw settings.json now: {"defaultProvider":"spike-local","defaultModel":"spike-beta","defaultThinkingLevel":"minimal","enabledModels":["spike-local/spike-alpha"]}
                                                                          ↑ 没有追加
```

（`enabledModels` 那行 `getEnabledModels()` 打印的是**探针自己另建的
`SettingsManager` 实例**的缓存，与 session 内部那个不是同一个对象，所以它显示旧值；
**以 `raw settings.json` 为准**——追加确实发生了。）

对应源码是 `0.99.2` `dist/core/agent-session.js:1902-1920` 的
`_addPersistedDefaultToNonEmptyScope(model)`，只在
「`_scopedModels.length > 0`」**且**「`getEnabledModels()` 非空」时才追加。
worksplice 的 `lib/rpc/caller.ts:110-122` 会把 `scopedModels` 传进去，
`lib/model-scope.ts` 又拿 `enabledModels` 做可见模型 glob 过滤——
所以这**不是角落里的边角**，是一次「换模型」顺手扩大了模型下拉框的范围。
`0.84.3` 的 `setModel` 里没有这个调用（§2.3 的 `0.84.3` 输出只有一行
`setDefaultModelAndProvider`），它是后来才加的。

**STEP 7 —— 唯一推荐的修法，实跑验证（见 §6.2）：**

```
### 0.99.2
=== STEP 7: recommended fix — explicit SettingsManager write after the SDK setter ===
  [reset-to-known-bad]           getDefaultModel()="spike-alpha" getDefaultThinkingLevel()="off"
  [SDK setters only]             getDefaultModel()="spike-alpha" getDefaultThinkingLevel()="off"     ← 0.99.2 的 setter 不写
  [after the explicit write]     getDefaultModel()="spike-beta"  getDefaultThinkingLevel()="high"    ← 修法补回来了

### 0.83.0
  [reset-to-known-bad]           getDefaultModel()="spike-alpha" getDefaultThinkingLevel()="off"
  [SDK setters only]             getDefaultModel()="spike-beta"  getDefaultThinkingLevel()="high"    ← 0.83.0 的 setter 已经写了
  [after the explicit write]     getDefaultModel()="spike-beta"  getDefaultThinkingLevel()="high"    ← 幂等，落盘完全相同
```

---

## 5. ★ 实际影响面：丢掉这个副作用，谁的行为会变？

### 5.1 先把「全局默认」在本仓里到底服务谁摆清楚

本仓有 **四层**模型相关存储，各管各的：

| 层 | 位置 | 谁读它 |
| --- | --- | --- |
| **① 全局默认** `settings.json` 的 `defaultProvider` / `defaultModel` / `defaultThinkingLevel` | `getAgentDir()/settings.json` | `lib/rpc/caller.ts:102-103` 建会话时的起点；`app/api/models/route.ts:58-65` 给 UI 预选；`0.99.2` 的 `_getThinkingLevelForModelSwitch` 兜底 |
| **② per-agent 覆盖** `members.model_provider / model_id / thinking_level`（spec §3.10） | `lib/domain/collab/members.ts` `setAgentRuntimeConfig` → `getDb().setMemberModel` | `lib/agent-runtime.ts:275-280` 建会话时作为 `initialModel` / `thinkingLevel` 传入 |
| **③ 显式启动偏好** | `lib/startup-preferences.ts` `persistExplicitStartupPreferences` | `lib/rpc/caller.ts:126-140`，只在**建会话时**、且只在调用方**显式传了** `initialModel` / `thinkingLevel` 时写 ① |
| **④ session jsonl** | `~/.pi/agent/sessions/**/*.jsonl` 的 `model_change` / `thinking_level_change` 条目 | 恢复会话时 `lib/session-reader.ts` 回放 |

关键事实（逐条给证据）：

```
$ sed -n '102,116p' lib/rpc/caller.ts
      const defaultProvider = services.settingsManager.getDefaultProvider();
      const defaultModelId = services.settingsManager.getDefaultModel();
      const hasExistingMessages = sessionManager.getBranch().some((entry) => entry.type === "message");
      const initial = hasExistingMessages && !initialModel
        ? { scopedModels: [...scope.scopedModels] }
        : selectInitialModelScope(scope, {
          ...(initialModel ? { requestedModel: initialModel } : {}),
          ...(defaultProvider && defaultModelId
            ? { defaultModel: { provider: defaultProvider, modelId: defaultModelId } }
            : {}),
          ...(thinkingLevel ? { thinkingLevel } : {}),
        });
```

```
$ sed -n '273,281p' lib/agent-runtime.ts
            ...(member.model_provider && member.model_id
              ? { initialModel: { provider: member.model_provider, modelId: member.model_id } }
              : {}),
            ...(member.thinking_level
              ? { thinkingLevel: member.thinking_level as ThinkingLevel }
              : {}),
```

```
$ sed -n '15,21p' lib/startup-preferences.ts
 * Persist explicit browser selections without re-running AgentSession setters.
 *
 * The session constructor already records the effective model and thinking
 * level. Calling setModel()/setThinkingLevel() again would append duplicate
 * session entries and emit duplicate extension events.
```

```
$ sed -n '1476,1487p' hooks/useAgentSession.ts
    if (isNew && !sessionIdRef.current) {
      const match = d.defaultModel
        ? nextModelList.find((m) => m.id === d.defaultModel?.modelId && m.provider === d.defaultModel?.provider)
        : undefined;
      const displayModel = match ?? nextModelList[0];
      setNewSessionDefaultModel(displayModel ? { provider: displayModel.provider, modelId: displayModel.id } : null);
      // An `enabledModels` pattern may pin a thinking level (`anthropic/*:high`).
      // Like pi, apply it to the model a new session starts with.
      const pinned = displayModel && d.thinkingLevelPins?.[`${displayModel.provider}/${displayModel.id}`];
      if (thinkingLevelOverrideRef.current === null) {
        setThinkingLevel((pinned as ThinkingLevelOption | undefined) ?? "auto");
      }
    }
```

注意最后这段：`setNewSessionDefaultModel(...)` **只写显示态**。
真正会随建会话请求发出去的 override 只有 `newSessionModelOverrideRef`
（`:1423` `newSessionModelOverrideRef.current = selectedModel;`，
**只在用户显式操作时**才赋值），`thinkingLevelOverrideRef` 同理（`:1657`）。

### 5.2 逐条消费面裁决

| 消费面 | 升级后行为变不变 | 依据 |
| --- | --- | --- |
| **per-agent agent 的模型/思考级别**（`PATCH /api/members/[id]/runtime`，spec §3.10） | **不变**。`route.ts:89/:92` 先 `set_model` / `set_thinking_level` 应用到存活会话，**紧接着** `route.ts:96` `setAgentRuntimeConfig(...)` 显式写 `members`。权威存储是 `members`，下次建会话由 `agent-runtime.ts:275-280` 作为 `initialModel` 注入，**根本不看全局默认**。SDK 那个全局写在 per-agent 这条路上本来就是**冗余写**（甚至有害：会把全局默认一起改掉）。 | §5.1 三段输出 + `members.ts:279-285` |
| **新建会话 + 用户显式选了模型/思考级别** | **不变**。`app/api/agent/new/route.ts:47-48` 把 `provider`/`modelId`/`thinkingLevel` 作为 `initialModel` / `thinkingLevel` 传下去，`caller.ts:126-140` 的 `persistExplicitStartupPreferences` 显式写全局默认。 | §5.1 输出 |
| **新建会话 + 用户没显式选** | **这就是唯一受影响的入口**：它**只**读全局默认（`caller.ts:112-114`），全局默认变不变直接决定它起在哪个模型上。 | §5.1 输出 |
| **已运行会话上换模型/换思考级别**（`useAgentSession.handleModelChange` `:1420-1444`、`handleThinkingLevelChange` `:1656-1670`、以及 `runtime/route.ts:89/:92` 的存活会话应用） | **副作用消失**：session 内照常生效（实测两版 `session.model` / `session.thinkingLevel` 完全相同，§4.2），但全局默认不再被更新。 | §4.2 实测 |
| **session jsonl（④）** | **不变**，两版条目逐字同构（§4.3）。 | §4.3 实测 |

### 5.3 ★ 结论：只有一条用户可观察的行为会变

把上面两张表串起来，唯一闭环成立的地方是：

> **用户在遗留 pi-web 聊天面（`ChatWindow`）里，对一个「已经在跑、而且不是 new」的会话
> 换模型或换思考级别 —— 然后关掉它、新建一个会话、且这次不显式选模型 ——
> 新会话起到的模型/思考级别会回到旧值。**

其余全部不受影响：

- **agent 面板里的模型选择**（每个 agent 有自己的 `members` 行，spec §3.10）**完全不受影响**。
  这是 worksplice 的主场景，也是 `persistExplicitStartupPreferences` 明确覆盖的场景。
- **新建会话时的模型预选**照旧从全局默认来；只是这个全局默认的**更新者**少了一个。
- 换模型/换思考级别**当场**的 session 行为、jsonl 记录、扩展事件，
  两版实测逐字相同。

**所以：严重度低于评估报告的描述。** 报告 §4.2 的症状写法是
「用户在 UI 里换模型或换思考级别，worksplice 不再把它持久化到全局 `settings.json`；
重启后回到旧值」。前半句对，后半句「重启后回到旧值」只在
**「遗留 pi-web 聊天面 + 已运行会话 + 无 per-agent 覆盖」**这一条窄路径上才成立。
把 B-2 当成「升级的主要拦路虎」来排优先级，是**读重了**。

同时要说清楚：**B-2 也不是零成本**。上面这条窄路径虽然窄，但它在 `0.83.0` 上是
能用的，升级后**会**变，而且**不报错、不告警**——这是最难在测试里发现的一类回归。

---

## 6. 唯一推荐

### 6.1 修法

**不要用 `{persist:true}`。改用显式写 `SettingsManager`，落在 `lib/rpc/session.ts`
已有的两个分支里——和 `lib/startup-preferences.ts` 用的是同一个接缝。**

```ts
// lib/rpc/session.ts:422-434  case "set_model"  —— 在 await 这行之后加：
        await this.inner.setModel(model);
+       this.inner.settingsManager.setDefaultModelAndProvider(model.provider, model.id);
+       await this.inner.settingsManager.flush();
        invalidateModelsCache();
        invalidateSessionListCache();
        return { id: model.id, provider: model.provider };

// lib/rpc/session.ts:481-492  case "set_thinking_level"  —— 同理：
        this.inner.setThinkingLevel(level);
+       this.inner.settingsManager.setDefaultThinkingLevel(this.inner.thinkingLevel as ThinkingLevel);
+       await this.inner.settingsManager.flush();
```

要点：

- **写 `effective` 值而不是请求值**。模型分支直接写 `model.provider/model.id`（就是生效值）；
  思考级别分支写 `this.inner.thinkingLevel`（**夹紧后的**）而不是入参 `level`——
  这正是 `0.83.0` 的语义（§2.1 `:1285` 写 `effectiveLevel`），也避开了 §4.4 STEP 3c
  那个「全局默认落成当前模型用不了的档位」的坑。
- **镜像不用改**。`lib/pi-types.ts:130` 已经有 `readonly settingsManager: SettingsManager;`，
  而 `SettingsManager` 这几个方法的签名两版逐字不变：

  ```
  $ grep -n "getDefaultModel()\|setDefaultModelAndProvider\|getDefaultThinkingLevel\|setDefaultThinkingLevel" \
      node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.d.ts
  182:    getDefaultModel(): string | undefined;
  185:    setDefaultModelAndProvider(provider: string, modelId: string): void;
  193:    getDefaultThinkingLevel(): ThinkingLevel | undefined;
  194:    setDefaultThinkingLevel(level: ThinkingLevel): void;
  ```

  所以 §3 那个 `TS2554` 根本不会出现，**也不需要把镜像焊到上游的 `ModelMutationOptions` 上**。
- 需要补一个 `import type { ThinkingLevel } from "@earendil-works/pi-agent-core"`，
  与 `lib/startup-preferences.ts:1` 同一句。

### 6.2 理由（四条，都带证据）

1. **它不引入 `{persist:true}` 的两个副作用。** §4.4 STEP 3c 实测：opt-in 会把
   「请求值 `high`」写进全局默认，而生效值是 `off`。显式写 `this.inner.thinkingLevel`
   写的是 `"off"`，与 `0.83.0` 逐字一致。
2. **它不碰 `enabledModels`。** §4.4 STEP 6 实测：`{persist:true}` 会把模型追加进
   `settings.json` 的 `enabledModels`，进而影响 `lib/model-scope.ts` 的可见模型过滤。
   显式写只碰 `defaultProvider` / `defaultModel` / `defaultThinkingLevel` 三个键。
3. **它让镜像不依赖上游的 opt-in 类型。** 放宽 `lib/pi-types.ts:149/:151`（§3.3 Case C）
   在两版上都安全，但那是把本仓的结构镜像**焊死在上游某个可选参数上**；
   显式写不需要这个耦合，也不需要 §6.1 之外的多一个改动面。
4. **它复用了本仓已有的接缝与既有理由。** `lib/startup-preferences.ts:15-21` 的注释
   已经写明本仓对「持久化全局默认」有明确设计：**绕开 SDK setter，直接写
   `SettingsManager`**（理由是避免重复的 session 条目与重复的扩展事件）。
   这次只是把同一个手法用到第二条 RPC 命令上，**不是引入新概念**。

### 6.3 实跑验证（§4.4 STEP 7 的两版输出）

```
### 0.99.2 —— 修法把丢掉的东西补回来了
  [SDK setters only]          getDefaultModel()="spike-alpha" getDefaultThinkingLevel()="off"
  [after the explicit write]  getDefaultModel()="spike-beta"  getDefaultThinkingLevel()="high"

### 0.83.0 —— 修法是幂等的，落盘完全相同
  [SDK setters only]          getDefaultModel()="spike-beta"  getDefaultThinkingLevel()="high"
  [after the explicit write]  getDefaultModel()="spike-beta"  getDefaultThinkingLevel()="high"
```

**一个实现细节要提醒**：修法里 `await ...flush()` 是必要的。
`SettingsManager` 是缓冲写，实测里如果不 flush，落盘的 `settings.json` 不更新。
`SettingsManager.flush(): Promise<void>`（`dist/core/settings-manager.d.ts:176`）
两版都在，`lib/startup-preferences.ts:53` 已有 `await settingsManager.flush();`
这一行可抄。

### 6.4 Q6：`0.83.0` 上是否等价？

**等价，而且更安全。**

- §6.3 的 `0.83.0` 输出逐字显示：显式写之后落盘状态与 SDK 自己写出来的**完全一致**，
  是幂等叠加，不会写坏什么。
- 语义上 `0.83.0` 的 `setThinkingLevel` 写的是夹紧后的 `effectiveLevel`（§2.1 `:1285`），
  显式写 `this.inner.thinkingLevel` 拿到的**就是**同一个 `effectiveLevel`
  （`get thinkingLevel()` 读 `this.agent.state.thinkingLevel`），**逐字相同**。
- 唯一比 `0.83.0` 多的一处：`0.83.0` 在 `supportsThinking()===false &&
  effectiveLevel==="off"` 时**不写**；显式写会写。实测这一档是
  `effectiveLevel="off"`，写下去的值与原值语义相同（`0.83.0` 的原值此时必然也是
  `off`，否则 `isChanging` 为真且 `supportsThinking()` 为真），**不产生可观察差异**。

### 6.5 「不必修」也是一条合法路线——但本票不推荐

如果产品上决定「全局默认只跟随显式的启动偏好，不再被会话内操作改写」，
那么**原样升级、不动代码**是自洽的：这条语义与上游 `0.84.3` 的
*"keep selections session-scoped, and persist them explicitly with Ctrl+S"*
（`CHANGELOG.md:431`）完全同向。代价是 §5.3 那一条窄路径的行为变化。
**本票推荐 §6.1，理由是「改动只有 4 行、落在既有接缝上、两版都实测过」，
而不是因为不修会出大事**——严重度确实低（§5.3）。

---

## 7. 未验证项（如实列出）

1. **未跑真 LLM 往返**。全程零凭证、零网络，`session` 从未收到 assistant 消息，
   所以 `.jsonl` 落盘路径没被走到（§4.3 已说明原因与替代口径）。
   **不影响本票结论**：`setModel` / `setThinkingLevel` 不发请求。
2. **`_addPersistedDefaultToNonEmptyScope` 的精确落地版本未定位**。
   只实测了 `0.84.3` **没有**、`0.99.2` **有**；中间 `0.84.4 → 0.99.1` 未逐版本扫。
   这不影响修法（推荐写法根本不用 opt-in）。
3. **`SettingsManager.getModelThinkingLevel` / `modelThinkingLevels` 这条新持久化面
   没有展开**。它是 `0.99.2` 新增、`0.83.0` 没有，会影响
   `_getThinkingLevelForModelSwitch(targetModel, explicitLevel)` 的返回值
   （§2.3）。它属于另一条线，**建议单独立票**，本票不下结论。
4. **前端可观察性未做浏览器验证**。§5.3 的「下一个新建会话回到旧值」是由代码路径
   （`caller.ts:112-114` 只读全局默认 + `useAgentSession.ts:1423` 只在显式操作时写 override）
   推出的，**没有在真浏览器里点一遍**。这是本票最该补的一块，但需要起 dev server
   且会动真 `~/.pi`，超出本票授权（可执行 spike、不改生产代码）。
5. **`enabledModels` 追加对 UI 可见范围的真实影响未量化**。§4.4 STEP 6 只证明了
   数组被追加，`lib/model-scope.ts` 会因此多显示哪些模型没有实测。
6. **`worksplice` 自己的生产路径（`RpcCaller.start` → `AgentSessionWrapper.send({type:"set_model"})`）
   在 `0.99.2` 上跑不起来**——PR #55 已实测 `lib/rpc/session.ts` 在模块 import 期就崩
   （`PlainTextTheme` → `Error: Invalid color value: undefined`），`lib/rpc/index.ts`
   与 `lib/rpc/caller.ts` 都加载不了。所以本票的运行时实验在**裸 SDK 层**做，
   调用形状逐字照抄 `session.ts:422-434` / `:481-492`。**B-1 不修，B-2 就无法在
   生产路径上端到端实跑**——这一点必须写进升级票的前置依赖。

---

## 8. 证据索引

> 每条都是「命令 + 该命令的真实输出」。完整原始输出见
> `.scratch/spike/`（本地 gitignored，不进 PR）：
> `out-0.83.0.txt` / `out-0.99.2.txt` / `tsc-0.83.0.txt` / `tsc-0.99.2.txt` /
> `tc-results-0.83.0.txt` / `tc-results-0.99.2.txt` /
> `agent-session-{0.83.0,0.84.2,0.84.3,0.99.2}.{js,d.ts}`。

### 8.1 上游语义

| 结论 | 命令 | 位置 |
| --- | --- | --- |
| `0.83.0` 无条件写 | `sed -n '1189,1206p' node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js` | `agent-session-0.83.0.js:1194/:1202` |
| `0.83.0` 写 `effectiveLevel` 且带两个门 | `sed -n '1270,1294p' .../agent-session.js` | `agent-session-0.83.0.js:1285` |
| `0.83.0` 无 `ModelMutationOptions` | `grep -c ModelMutationOptions .scratch/spike/agent-session-0.83.0.d.ts` → `0` | §2.1 |
| `0.99.2` opt-in 门 | `sed -n '1884,1899p;1990,2001p' .../agent-session.js` | `agent-session-0.99.2.js:1892/:1997` |
| `0.99.2` opt-in 类型 | `sed -n '177,181p' .scratch/spike/agent-session-0.99.2.d.ts` | `agent-session-0.99.2.d.ts:178-181` |
| 落地版本 = `0.84.3` | `grep -n "async setModel(model, options\|if (options.persist)" ...` on `0.84.2` / `0.84.3` | §2.3 全部输出 |
| CHANGELOG 交叉验证 | `awk 'NR<=470 && /^## \[/ {...}' .../CHANGELOG.md` | §2.3 末 |

### 8.2 类型层

| 结论 | 命令 | 输出位置 |
| --- | --- | --- |
| `0.99.2` 全仓 tsc 只有 3 处错，无一在 `session.ts:430/:483` | `node_modules/.bin/tsc --noEmit` | §3.1 完整输出 |
| `0.83.0` 全仓 tsc 干净 | 同上 | §3.1（无输出，`exit=0`） |
| opt-in 传不进今天的镜像 | `tsc --noEmit --strict ... .scratch/spike/tc/b-optin-on-todays-mirror.ts` | §3.2（`TS2554`，两版各一份） |
| 放宽镜像后两版都不新增问题 | 同上，跑 `c-mirror-with-optin.ts` | §3.2 Case C |
| 探针用的是逐字副本 | `node .scratch/spike/gen-type-probes.mjs` | `.scratch/spike/gen-type-probes.mjs:5-13` |

### 8.3 实测行为

| 结论 | 命令 | 输出位置 |
| --- | --- | --- |
| 全程零凭证、隔离 agentDir | `node .scratch/spike/b2-probe.mjs` | §4.1 头部 + `auth.json` = `{}` |
| `checkAuth` 本地作答 | 同上，`checkAuth('spike-local')` 一行 | §4.1 |
| `0.83.0` 换模型改全局 + 顺带改思考默认 | 同上，`0.83.0` STEP 1 | §4.2 上半 |
| `0.99.2` 不传 opt-in 纹丝不动 | 同上，`0.99.2` STEP 1 / STEP 2 | §4.2 下半 |
| 两版 transcript 同构 | 同上，STEP 4 | §4.3 |
| opt-in 写「请求值」 | 同上，STEP 3c | §4.4 |
| opt-in 改 `enabledModels` | 同上，STEP 6 | §4.4 |
| 推荐修法两版都成立 | 同上，STEP 7 | §4.4 末 / §6.3 |

### 8.4 影响面（本仓代码，逐字）

| 结论 | 命令 |
| --- | --- |
| 建会话只从全局默认取起点（有消息的会话不取） | `sed -n '102,116p' lib/rpc/caller.ts` |
| per-agent 覆盖作为 `initialModel` 注入 | `sed -n '273,281p' lib/agent-runtime.ts` |
| per-agent 变更显式写 `members` | `sed -n '260,287p' lib/domain/collab/members.ts` |
| 存活会话应用走 `set_model` / `set_thinking_level` | `sed -n '84,99p' app/api/members/[id]/runtime/route.ts` |
| 新建会话显式选择 → `initialModel` / `thinkingLevel` | `sed -n '35,49p' app/api/agent/new/route.ts` |
| 本仓已有显式持久化接缝 | `sed -n '15,21p;22,55p' lib/startup-preferences.ts` |
| UI 预选只写显示态 | `sed -n '1476,1487p' hooks/useAgentSession.ts` |
| override ref 只在显式操作时写 | `grep -n newSessionModelOverrideRef hooks/useAgentSession.ts` → `:406 :568 :593 :1423` |
| UI 换模型 / 换思考级别两条 RPC | `grep -rn "set_model\|set_thinking_level" --include=*.ts --include=*.tsx .` |
| `SettingsManager` 写盘方法两版不变 | `grep -n "getDefaultModel()\|setDefaultModelAndProvider\|getDefaultThinkingLevel\|setDefaultThinkingLevel" node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.d.ts` → `:182 :185 :193 :194` |
| `SettingsManager.flush` 两版都在 | `grep -n "    flush(" .../settings-manager.d.ts` → `176:    flush(): Promise<void>;` |
| `get thinkingLevel()` 就是 `effectiveLevel` | `grep -n -A2 "get thinkingLevel()" .../agent-session.js` |

### 8.5 交付纯净性

```
$ git diff --name-status 49607e7..HEAD
A       docs/spike-b2-persist.md

$ git status --porcelain
（空）

$ shasum package.json bun.lock .scratch/spike/package.json.pristine .scratch/spike/bun.lock.pristine
737a34e2f8f0bf88e9acf80f4a2bf0a969d32c04  package.json
6d5b30faf2a32734e376e8ba3bd6f0c998e01603  bun.lock
737a34e2f8f0bf88e9acf80f4a2bf0a969d32c04  .scratch/spike/package.json.pristine
6d5b30faf2a32734e376e8ba3bd6f0c998e01603  .scratch/spike/bun.lock.pristine

$ for p in pi-agent-core pi-ai pi-coding-agent pi-tui; do grep '"version"' node_modules/@earendil-works/$p/package.json | head -1; done
	"version": "0.83.0",
	"version": "0.83.0",
	"version": "0.83.0",
	"version": "0.83.0"

$ ls package-lock.json
ls: package-lock.json: No such file or directory
```

### 8.6 方法学备注

- 全程只用 `bun install`，**从未 `npm install`**，`package-lock.json` 不存在（§8.5）。
- `package.json` / `bun.lock` 是仅有的临时改动，实验序列为
  `0.83.0 → 0.99.2 → 0.84.2 → 0.84.3 → 0.83.0 → 0.99.2 → 0.83.0`，
  最终 `git checkout --` 还原并以 `shasum` 复核（§8.5）。
- 实验全部在 `mkdtemp` 出来的 `agentDir` + `cwd` 里跑，`PI_CODING_AGENT_DIR` 指过去，
  **用户真实的 `~/.pi` 全程零读写**。
- 仓库代码**一行未改**。类型探针是 `lib/pi-types.ts` 的逐字副本，
  生成器带漂移断言（§8.2 最后一行）。