# 可执行 spike：`PlainTextTheme` 的 import 期崩溃与唯一修法

> 这是一份**可执行实验**的记录。本票要回答的问题只有一个：
> `lib/rpc/session.ts` 在 **模块 import 期**就崩（比 `systemPrompt` 更靠前的第一个拦路虎），
> **唯一有证据的修法是什么**。
>
> 上一张 spike（`docs/spike-systemprompt-fix.md` §6.1）只在**越界发现**里记了一句栈，
> 没有给出修法。本文件把两个版本（`0.83.0` / `0.99.2`）都装出来，
> 对 A / A′ / A+ / A\* / B / C / D 逐个**在同一支探针下**实测，
> 并回答「`initTheme()` 到底相不相关」这个待核实项。
>
> **本 PR 不含任何升级。** `package.json` / `bun.lock` 在实验中被临时改动，
> 交付前已逐字还原（§9.5 贴 `shasum` 对照）。唯一交付物是本文件。
>
> 取证纪律：一手来源只有**实跑输出**、**装出来的包源码**、**本仓代码**。
> **每条结论都带命令 + 该命令的真实输出**，索引见 §9。
> **全程未使用任何 provider 凭证**，也未伪造凭证（§2.2 说明本题为何根本不需要）。

---

## 1. 结论（TL;DR）

### 1.1 一句话

**推荐候选 A\*：保留 `extends Theme`，但把 `super()` 的第一个参数换成「按包自带
`theme-schema.json` 的 51 个 required token 全填 `""`」的完整记录，并顺手把
0.99.2 新增的 `style()` / `colors` 也覆盖成恒等。
崩溃已确认，且它是 0.99.2 上「`lib/rpc` 整个模块 import 不了」级别的功能缺失。**

### 1.2 五条硬结论

1. **★ `style()` 是一颗同样埋在 0.99.2 里的哑弹**（本票实测出的新东西）。
   `style` / `colors` / `appearance` 是 0.99.2 **新增**的成员，现在的 `PlainTextTheme`
   一个都没覆盖。所以**光把 `super()` 的配置补完整是不够的**：候选 A 构造成功、
   `instanceof Theme` 为 true、13 个老方法全是恒等，但
   `style("X", {fg:"accent"})` 返回 `"\x1b[38;2;167;152;215mX\x1b[39m"`——
   **真 ANSI 漏进 extension 拿到的那个对象**，而类的注释明写着「web UI applies
   its own styling」。修法必须连 `style` / `colors` 一起覆盖（§4.1、§7.1）。
2. **崩溃确认（比 `systemPrompt` 更早、更硬）**。0.99.2 下只要 `import`
   `lib/rpc/session.ts` 就抛 `Error: Invalid color value: undefined`，
   栈顶是 `pi-tui/dist/colors.js:77`，经 `theme.js:141 addToken` /
   `theme.js:147 new Theme` 回到**我们自己的** `lib/rpc/session.ts:101`。
   因为 `PLAIN_TEXT_THEME` 在模块顶层（`:123`），这意味着
   **`lib/rpc/index.ts` 与 `lib/rpc/caller.ts` 都加载不了**——
   `npm test` 里 5 条失败中的 3 条就是它（§2.5）。
3. **★ coordinator 的核心假设成立，而且可以量化**。`PlainTextTheme` 把全部渲染方法
   override 成恒等，所以基类那份颜色状态**从未参与渲染**：
   `fg` / `bg` / `bold` / … / 两个 border color 全部返回入参本身。
   「基类最少需要什么」我用**贪心剪枝**实测出来了：
   - 0.83.0：51 个 token 里**只要 1 个**（`thinkingXhigh`）——**现在的代码恰好就是
     0.83.0 的最小合法输入**；
   - 0.99.2：最少要 **4 个**（`muted` / `text` / `selectedBg` / `thinkingXhigh`），
     因为构造函数会**从缺失的键合成新键**，而合成的来源自己也缺失（§3.2）。
   ⇒ 结论：颜色**值**无所谓（`""` 就够，`""` 是包文档明确承认的合法值），
   但**键的完整性**是硬要求。
4. **候选 C 不存在官方路径**。两版都**没有**官方 no-op / plain / headless theme：
   `getAvailableThemes()` 在 0.83.0 是 `["dark","light"]`、0.99.2 是
   `["system","dark","light"]`；对 `PlainTheme|NoopTheme|HeadlessTheme|createPlainTheme`
   全仓 grep 零命中。**唯一有官方背书的「完整形状」是包自带的
   `dist/modes/interactive/theme/theme-schema.json` 的 `required` 列表（两版都是同一份
   51 个 token）**——A\* 就是照它填的（§3.4、§4.4、§4.7）。
5. **候选 D（惰性 + try/catch）能跑通，但是错的**。它把崩溃从「import 期」推到
   「第一个读 theme 的扩展」，实测 import 确实过了、`fg`/`bold` 也确实恒等，
   **但代价是丢掉 `instanceof Theme`**、把一个编译期可查的问题变成第三方扩展里的
   运行时 `undefined`，而且真正的完整配置一个都没补。**不推荐**（§4.6）。

### 1.3 候选裁决总表（两版同口径、同探针）

`identity` = `fg`/`bg`/`bold`/`italic`/`underline`/`inverse`/`strikethrough`/
`getFgAnsi`/`getBgAnsi`/`getThinkingBorderColor`/`getBashModeBorderColor`/`style`
全部返回入参本身，且输出里**一个 ANSI 转义都没有**。

| 候选 | 0.99.2 能否 import | 0.83.0 能否 import | identity（两版） | `instanceof Theme` | 裁决 |
| --- | --- | --- | --- | --- | --- |
| 现状（`:98-123` 逐字） | **崩** | 过 | true | true | 0.99.2 上不可用 |
| **A** 完整合法配置（去掉两个 `as` 谎话） | 过 | 过 | **false** | true | 不够——`style()` 漏 ANSI（§4.1） |
| **A′** 完整形状、每个值 `""` | 过 | 过 | **false** | true | 不够——`style()` 仍漏 ANSI（§4.2） |
| **A+** A + 覆盖 `style`/`colors` | 过 | 过 | true | true | 可用（§4.3） |
| **A\*** 51 token 全 `""` + `appearance` + 覆盖 `style`/`colors` | 过 | 过 | **true** | **true** | ★ **唯一推荐**（§4.4、§5、§7） |
| **B** 不再继承，鸭子类型 | 过 | 过 | true | **false** | 可用但要在两处各加一次 cast（§4.5） |
| BASELINE SDK 自带 `dark` 主题 | 过 | 过 | false | true | 对照组（证明探针能看见 ANSI，§4.8） |
| **C** 官方 plain theme | **不存在** | **不存在** | — | — | 无此路径（§4.7） |
| **D** 惰性 + try/catch | 过 | 过 | true | **false** | 能跑通但**不推荐**（§4.6） |

### 1.4 ★ English summary

> **Executable spike. Both 0.83.0 and 0.99.2 were installed for real, and six
> candidate fixes for the import-time `PlainTextTheme` crash were measured with a
> single shared probe on each version. The crash is confirmed and it is the
> earliest blocker in the upgrade: on 0.99.2 a bare `import` of
> `lib/rpc/session.ts` throws `Error: Invalid color value: undefined`, thrown from
> `pi-tui/dist/colors.js:77` via `theme.js:141 addToken` and `theme.js:147 new
> Theme`, straight into our own `lib/rpc/session.ts:101` — because
> `PLAIN_TEXT_THEME` is a module top-level constant, `lib/rpc/index.ts` and
> `lib/rpc/caller.ts` cannot load at all (3 of the 5 `npm test` failures on 0.99.2
> are exactly this; 0.83.0 is 852/852 green).**
>
> **The root cause is a type-level lie, and the coordinator's key hypothesis is
> confirmed and quantified.** `PlainTextTheme` overrides every rendering method to
> the identity function, so the base class's colour state never contributes to any
> output — the only reasons it exists are `instanceof Theme` and handing extensions
> a shape-complete `theme`. A greedy prune of the 51 required tokens shows the base
> class needs **1 token on 0.83.0** (`thinkingXhigh` — i.e. today's code is exactly
> 0.83.0's minimal legal input) and **4 tokens on 0.99.2** (`muted`, `text`,
> `selectedBg`, `thinkingXhigh`), because 0.99.2's constructor synthesizes new keys
> from missing ones whose fallback sources are themselves missing. So the *values*
> are irrelevant (`""` is a documented legal value) but *key completeness* is a hard
> requirement.**
>
> **Recommended: A\*.** Keep `extends Theme`; pass a complete record built from the
> package's own `theme-schema.json` `required` list (51 tokens, identical in both
> versions) with every value `""`; pass `options.appearance`; and additionally
> override the two members 0.99.2 introduced, `style()` and `colors`, to the
> identity. That last part is not optional: candidate A (complete config but no
> `style` override) constructs fine yet leaks real ANSI —
> `style("X", {fg:"accent"})` returns `"\x1b[38;2;167;152;215mX\x1b[39m"` —
> because `style` is new in 0.99.2 and the current class does not override it.
> A\* is ANSI-free and `instanceof Theme` on **both** versions, so the
> `session.ts:998` `get theme()` contract and the `session.ts:813` factory argument
> are preserved with no cast at either site.**
>
> **Rejected: B** (duck typing) also works and is ANSI-free, but it loses
> `instanceof Theme` while the SDK's extension surface declares the parameter as the
> concrete class (`core/extensions/types.d.ts` `custom<T>(factory: (tui, theme:
> Theme, …))` and `readonly theme: Theme`), so it re-introduces a cast at both use
> sites — the same class of type-level lie this ticket exists to remove, and the only
> `instanceof Theme` in the whole SDK is in the TUI-only `ui.setTheme()` path that
> worksplice never reaches. **Rejected: C** — no official plain/no-op theme exists in
> either version (`getAvailableThemes()` is `["dark","light"]` and
> `["system","dark","light"]`; zero grep hits for `PlainTheme|NoopTheme|
> HeadlessTheme|createPlainTheme`). **Rejected: D** (lazy + try/catch) does make the
> import succeed and the methods stay identity, but it only moves the throw to the
> first extension that reads the theme, silently drops `instanceof Theme`, and fixes
> none of the missing keys.

### 1.5 `initTheme()` 相关性判定

**不相关**（coordinator 的怀疑成立），三条互相独立的依据（§6.3）：
① 崩溃栈里**没有任何一帧**是 `initTheme`；② `initTheme` 自己被
`try/catch` 包着并回落到 `dark`（0.99.2 回落到 `system`），**不可能**把错误抛给调用方；
③ 它操作的是 SDK 的**全局 `theme` 代理**，而崩的是我们 `extends Theme` 出来的
**另一个对象**——实测在 `initTheme()` 之前读全局 `theme.fg(...)` 得到的是
`Theme not initialized. Call initTheme() first.`，两者根本不是一条路径。
**`caller.ts:13` / `:71` 一行都不用改。**

---

## 2. 崩溃确认

### 2.1 环境与 base

```
$ node --version
v25.0.0
$ /Users/apple/.bun/bin/bun --version
1.3.14
$ git rev-parse --abbrev-ref HEAD
whutlichao/theme-crash-spike
$ git merge-base HEAD origin/main
843dbc1768fce732f2463bd975b6197836eb3500
$ git log --oneline -1
843dbc1 Merge pull request #54 from whutlichao/whutlichao/project-trust-names
```

base commit = `843dbc1`，与 spec 给的一致，已用 `git merge-base HEAD origin/main` 复核。

### 2.2 方法（顺序即控制组）

| 步 | 动作 | 落点 |
| --- | --- | --- |
| 1 | 基线 `bun install`（pin 0.83.0）→ 跑三支脚本 + `npm test` | §2.3、§2.4、§2.5、§5 |
| 2 | 四包同改到 `0.99.2`（`bun update <pkg>@0.99.2`）→ 重跑**同一批脚本，零改动** | §2.3、§2.5、§4 |
| 3 | 为了把推荐形态也测到，追加一轮 0.99.2 → 0.83.0 往返 | §4.4、§5 |
| 4 | 降回 0.83.0，逐字还原 `package.json` / `bun.lock` | §9.5 |

**为什么不需要凭证**：本题的失败发生在**模块 import 期 + 对象构造期**，
既不发请求也不碰认证层。上一张 spike 需要 test double 是因为它要观测
「发往 provider 的请求体」；本题观测的是「构造一个对象会不会抛」，
所以**不需要任何 stub、不需要任何 key**。实验全程用临时 `agentDir`
（`PI_CODING_AGENT_DIR` 指向 `mkdtemp` 目录）隔离，不碰用户真实 `~/.pi/agent`。

### 2.3 ★ 0.99.2：import `lib/rpc/session.ts` 就抛（真实栈）

```
$ node .scratch/theme-spike/run-import.mjs        # 0.99.2
### isolated agentDir = /var/folders/bf/27rt5fsx01q0bq602vmhprsw0000gn/T/ws-theme-agent-ERjNyA
### SDK versions under test: {"pi-agent-core":"0.99.2","pi-ai":"0.99.2","pi-coding-agent":"0.99.2","pi-tui":"0.99.2"}

=== T1.1  bare `import('./lib/rpc/session.ts')` — no stub, no credentials ===
  IMPORT THREW
  Error: Invalid color value: undefined
      at parseColor (file:///…/node_modules/@earendil-works/pi-tui/dist/colors.js:77:11)
      at addToken (file:///…/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js:141:27)
      at new Theme (file:///…/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js:147:36)
      at new PlainTextTheme (file:///…/lib/rpc/session.ts:101:5)
      at file:///…/lib/rpc/session.ts:123:26
      at async Function.import (file:///…/node_modules/jiti/dist/jiti.cjs:1:187718)
      at async file:///…/.scratch/theme-spike/run-import.mjs:36:15
exit=1
```

（`file:///…` 是本文件为了排版折叠的仓库根前缀；真实输出里是完整绝对路径，
`node_modules/...` 段与行号逐字一致。）

`session.ts:123` 就是模块顶层那行 `const PLAIN_TEXT_THEME = new PlainTextTheme();`。
**抛点在 import 期，不在任何 try/catch 里** ⇒ 任何 import `lib/rpc/session.ts`
（或间接 import 它的 `lib/rpc/index.ts` / `lib/rpc/caller.ts`）的代码路径直接死。

### 2.4 0.83.0 对照组：同一次 import，不抛

```
$ node .scratch/theme-spike/run-import.mjs        # 0.83.0
### isolated agentDir = /var/folders/bf/27rt5fsx01q0bq602vmhprsw0000gn/T/ws-theme-agent-X82GHV
### SDK versions under test: {"pi-agent-core":"0.83.0","pi-ai":"0.83.0","pi-coding-agent":"0.83.0","pi-tui":"0.83.0"}

=== T1.1  bare `import('./lib/rpc/session.ts')` — no stub, no credentials ===
  IMPORT OK. exports: AgentSessionWrapper, withExtensionTools
```

### 2.5 门禁表现：`tsc` 对此完全失明，`npm test` 抓到 3 条

```
$ npm test      # 0.83.0
ℹ tests 852
ℹ pass 852
ℹ fail 0
npm test exit=0

$ npm test      # 0.99.2
ℹ tests 837
ℹ pass 832
ℹ fail 5
✖ lib/rpc/caller.test.mjs (3196.720917ms)
✖ lib/rpc/index.test.mjs (3203.494333ms)
✖ lib/rpc/session.test.mjs (1681.306209ms)
✖ removes incomplete tool calls before invoking the title provider (0.710625ms)
✖ waits for the source reply before sending the title prompt (4.267042ms)
npm test exit=1
```

**「5 条失败里的 3 条」这个说法成立，且已逐条定位**（`grep -c` 计数 = 9 处
`Invalid color value` 字样，全部来自那 3 个 `lib/rpc/*` 进程）：

```
$ grep -B2 -A12 "Error: Invalid color value: undefined" <0.99.2 的 npm test 输出>
Error: Invalid color value: undefined
    at parseColor (…/@earendil-works/pi-tui/dist/colors.js:77:11)
    at addToken (…/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js:141:27)
    at new Theme (…/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js:147:36)
    at new PlainTextTheme (…/lib/rpc/session.ts:101:5)
    at …/lib/rpc/session.ts:123:26
    at async import (…/node_modules/jiti/dist/jiti.cjs:1:187718)
    at async …/lib/rpc/caller.ts:21:16
    at async …/lib/rpc/caller.test.mjs:10:23
✖ lib/rpc/caller.test.mjs (3196.720917ms)
…
    at async …/lib/rpc/index.ts:12:16
    at async …/lib/rpc/index.test.mjs:10:13
✖ lib/rpc/index.test.mjs (3203.494333ms)
```

另外 2 条（`lib/session-title.test.mjs`）与 theme 无关，是 0.99.2 给 transcript
多插了一条 `system` 消息导致的断言漂移，属另一票的事，本文件不处理。

> ⚠️ **`tsc --noEmit` 对这条断裂是失明的**：`as ConstructorParameters<typeof Theme>[0]`
> 让类型层完全满意，`readonly` 也不影响可赋值性，所以 `session.ts:98-123` 不会产生
> 任何类型错误。**这正是本票要把「运行时崩溃」换成「编译期报错」的理由**（§7.1）。

---

## 3. 根因与版本差异

### 3.1 0.83.0 的 `Theme` 构造函数：逐字贴出

`node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js`，
`class Theme` 在 **232** 行，构造函数 **239-253** 行：

```js
232	export class Theme {
233	    name;
234	    sourcePath;
235	    sourceInfo;
236	    fgColors;
237	    bgColors;
238	    mode;
239	    constructor(fgColors, bgColors, mode, options = {}) {
240	        this.name = options.name;
241	        this.sourcePath = options.sourcePath;
242	        this.sourceInfo = options.sourceInfo;
243	        this.mode = mode;
244	        this.fgColors = new Map();
245	        const colors = { ...fgColors, thinkingMax: fgColors.thinkingMax ?? fgColors.thinkingXhigh };
246	        for (const [key, value] of Object.entries(colors)) {
247	            this.fgColors.set(key, fgAnsi(value, mode));
248	        }
249	        this.bgColors = new Map();
250	        for (const [key, value] of Object.entries(bgColors)) {
251	            this.bgColors.set(key, bgAnsi(value, mode));
252	        }
253	    }
```

**关键：两个 `for` 都是 `Object.entries(输入)`——只遍历「你真的给了的键」。**
缺键 = 不处理 = 静默降级。它只额外合成一个键 `thinkingMax`（245 行），
而 `thinkingMax` 的来源是 `thinkingXhigh`，恰好是我们给了的。

配套的 `fgAnsi`（同文件 **172-174** 行）把 `""` 当成合法值：

```
$ sed -n '172,174p' node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js
function fgAnsi(color, mode) {
    if (color === "")
        return "\x1b[39m";
```

⇒ `{ thinkingXhigh: "" }` 走一遍：`colors = {thinkingXhigh:"", thinkingMax:""}`，
两次 `fgAnsi("")` 各自返回 `"\x1b[39m"`，`{}` 的 bg 一次都不循环。**不抛。**


### 3.2 ★ 0.99.2 的 `Theme` 构造函数：「从缺失的键合成新键」的确切代码与行号

同路径 `dist/modes/interactive/theme/theme.js`，`class Theme` 移到 **103** 行，
构造函数 **119-153** 行：

```js
119	    constructor(fgColors, bgColors, mode, options = {}) {
120	        this.name = options.name;
121	        this.sourcePath = options.sourcePath;
122	        this.sourceInfo = options.sourceInfo;
123	        this.mode = mode;
124	        this.dimTokens = new Set(options.dim);
125	        const foregrounds = {
126	            ...fgColors,
127	            scrollbarTrack: fgColors.scrollbarTrack ?? fgColors.muted,
128	            scrollbarThumb: fgColors.scrollbarThumb ?? fgColors.text,
129	            thinkingMax: fgColors.thinkingMax ?? fgColors.thinkingXhigh,
130	            searchMatchText: fgColors.searchMatchText ?? fgColors.text,
131	        };
132	        const backgrounds = { ...bgColors, searchMatchBg: bgColors.searchMatchBg ?? bgColors.selectedBg };
133	        const concreteForegrounds = [];
134	        const concreteBackgrounds = [];
135	        // Returns the escape sequence for the token's own slot.
136	        const addToken = (token, value, isBackground) => {
137	            if (value === "") {
138	                (isBackground ? this.defaultBackgroundTokens : this.defaultForegroundTokens).push(token);
139	                return isBackground ? "\x1b[49m" : "\x1b[39m";
140	            }
141	            const color = parseColor(value);
142	            this.concreteColors[token] = color;
143	            (isBackground ? concreteBackgrounds : concreteForegrounds).push(color);
144	            return isBackground ? backgroundAnsi(color, mode) : foregroundAnsi(color, mode);
145	        };
146	        for (const [token, value] of Object.entries(foregrounds)) {
147	            this.fgAnsi.set(token, addToken(token, value, false));
148	        }
149	        for (const [token, value] of Object.entries(backgrounds)) {
150	            this.bgAnsi.set(token, addToken(token, value, true));
151	        }
152	        this.ownAppearance = options.appearance ?? detectAppearance(concreteForegrounds, concreteBackgrounds);
153	    }
```

**这就是「从缺失的键合成新键」的确切代码：`theme.js:125-131`。**
把它和 0.83.0 的 245-248 行并排看，差异有三条，每一条都独立致命：

| # | 0.83.0 | 0.99.2 | 后果 |
| --- | --- | --- | --- |
| **1** | `for (Object.entries(colors))`——**只遍历给定键** | `foregrounds` 先被 **127-130 行补上 4 个键**，`scrollbarTrack`/`scrollbarThumb`/`searchMatchText` 的 fallback 分别是 `fgColors.muted` / `fgColors.text` / `fgColors.text` | 我们没给 `muted`/`text` ⇒ 这 3 个新键的值是 **`undefined`** |
| **2** | 无 | `backgrounds` 被 **132 行**补上 `searchMatchBg`，fallback 是 `bgColors.selectedBg` | 我们没给 `selectedBg` ⇒ **`undefined`** |
| **3** | `fgAnsi` 只对 `""` 特判，其余走 `hexToRgb`（对非字符串会先炸在别处） | **141 行**统一调 pi-tui 的 `parseColor(value)`，只有 `""` 被 137 行提前短路 | `undefined` 落到 `parseColor` ⇒ **`Invalid color value: undefined`** |

抛点在 **pi-tui 0.99.2**（不是 coding-agent），
`node_modules/@earendil-works/pi-tui/dist/colors.js:58-78`：

```js
58  export function parseColor(value) {
59      if (typeof value === "number")
60          return indexedColor(value);
61      const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value);
62      if (hex) {
63          const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join("") : hex[1];
64          return rgbColor(Number.parseInt(digits.slice(0, 2), 16), Number.parseInt(digits.slice(2, 4), 16), Number.parseInt(digits.slice(4, 6), 16));
65      }
66      const oklch = OKLCH_PATTERN.exec(value);
67      if (oklch) {
68          const lightness = Number.parseFloat(oklch[1]) / (oklch[2] ? 100 : 1);
69          return oklchColor(lightness, Number.parseFloat(oklch[3]), Number.parseFloat(oklch[4]));
70      }
71      const okhsl = OKHSL_PATTERN.exec(value);
72      if (okhsl) {
73          const saturation = Number.parseFloat(okhsl[2]) / (okhsl[3] ? 100 : 1);
74          const lightness = Number.parseFloat(okhsl[4]) / (okhsl[5] ? 100 : 1);
75          return okhslColor(Number.parseFloat(okhsl[1]), saturation, lightness);
76      }
77      throw new Error(`Invalid color value: ${value}`);
78  }
```

> 副产物（对实施票有用）：0.83.0 的 `parseColor` 逻辑在 coding-agent **本地**
> （`fgAnsi`/`bgAnsi`），0.99.2 搬到了 **pi-tui**。所以这条崩溃**同时依赖
> `pi-tui` 的版本**——只升 `pi-coding-agent` 而不升 `pi-tui` 会得到另一种（更早的）失败。


### 3.3 类型签名也一起收紧了（这决定了修法长什么样）

```
$ sed -n '14p' node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.d.ts
    constructor(fgColors: Record<ThemeColor, string | number>, bgColors: Record<ThemeBg, string | number>, mode: ColorMode, options?: {

$ grep -n "OptionalThemeColor =\|OptionalThemeBg =" <0.99.2 tarball>/dist/modes/interactive/theme/theme.d.ts
26:type OptionalThemeColor = "scrollbarTrack" | "scrollbarThumb" | "thinkingMax" | "searchMatchText";
27:type OptionalThemeBg = "searchMatchBg";

$ sed -n '52,59p' <0.99.2 tarball>/dist/modes/interactive/theme/theme.d.ts
    constructor(
        fgColors: Record<Exclude<ThemeColor, OptionalThemeColor>, string | number> & Partial<Record<OptionalThemeColor, string | number>>,
        bgColors: Record<Exclude<ThemeBg, OptionalThemeBg>, string | number> & Partial<Record<OptionalThemeBg, string | number>>,
        mode: TerminalColorMode,
        options?: { name?: string; sourcePath?: string; sourceInfo?: SourceInfo; appearance?: ThemeAppearance; dim?: readonly ThemeColor[] }
    );
```

**0.99.2 的类型已经把 5 个 token 标成 optional（4 fg + 1 bg）**，
剩下的 45 fg + 6 bg = **51 个是 required**。而 §3.2 的 127-132 行
从 `muted` / `text` / `selectedBg` / `thinkingXhigh` 这 4 个 **required** 键
给那 4 个 optional 键兜底——**兜底源缺失 ⇒ optional 键变成 `undefined`**。
这就是「类型说 optional、运行时却炸」的那道缝。

### 3.4 「完整」到底是什么？——有官方答案，两版同一份

包自带 `dist/modes/interactive/theme/theme-schema.json`，它的
`properties.colors.required` 就是「一份完整配置」的权威清单，
`parseThemeJson` 会拿它做校验（缺一个就抛 `Missing required color tokens`）：

```
$ node -e "const s=require('<pkg>/dist/modes/interactive/theme/theme-schema.json'); \
           console.log('required =', s.properties.colors.required.length); \
           console.log(JSON.stringify(s.properties.colors.required))"
0.83.0  schema required color tokens = 51
0.99.2  schema required color tokens = 51
0.99.2  required: ["accent","border","borderAccent","borderMuted","success","error","warning","muted","dim","text",
        "thinkingText","selectedBg","userMessageBg","userMessageText","customMessageBg","customMessageText",
        "customMessageLabel","toolPendingBg","toolSuccessBg","toolErrorBg","toolTitle","toolOutput","mdHeading",
        "mdLink","mdLinkUrl","mdCode","mdCodeBlock","mdCodeBlockBorder","mdQuote","mdQuoteBorder","mdHr",
        "mdListBullet","toolDiffAdded","toolDiffRemoved","toolDiffContext","syntaxComment","syntaxKeyword",
        "syntaxFunction","syntaxVariable","syntaxString","syntaxNumber","syntaxType","syntaxOperator",
        "syntaxPunctuation","thinkingOff","thinkingMinimal","thinkingLow","thinkingMedium","thinkingHigh",
        "thinkingXhigh","bashMode"]
$ node -e "…两版对比…"
0.83.0 vs 0.99.2: schema.properties.colors.required 逐字相同
```

**两版逐字相同，都是 51 个。** 按 §3.3 的 `Record<Exclude<…>>` 拆开正好是
45 fg + 6 bg（bg 的 6 个由 0.83.0 `theme.js:464-471` 的 `bgColorKeys` 划出来：
`selectedBg` / `userMessageBg` / `customMessageBg` / `toolPendingBg` /
`toolSuccessBg` / `toolErrorBg`）。**所以 A 系列的「完整」不是我们发明的，
是包自己写在自己的 schema 里的。**

### 3.5 ★ 贪心剪枝：基类那份颜色状态**到底需要什么 minimally**

这是本票最关键的那个观察的量化版本。做法：从官方 51 token 的完整记录出发，
逐个尝试删掉一个 token，**只要主题还能构造、且每个渲染方法仍是恒等无 ANSI，
就永久删掉它**。幸存者就是构造函数真正需要的东西。

```
$ node .scratch/theme-spike/candidates.mjs        # 0.83.0
=== T2.1b  greedy prune of the constructor's real requirements ===
  start: 51 tokens, constructs = true
  dropped tokens (base class never needed them):
    - accent
    - border
    - borderAccent
    - borderMuted
    - success
    - error
    - warning
    - muted
    - dim
    - text
    - thinkingText
    - selectedBg
    - userMessageBg
    - userMessageText
    - customMessageBg
    - customMessageText
    - customMessageLabel
    - toolPendingBg
    - toolSuccessBg
    - toolErrorBg
    - toolTitle
    - toolOutput
    - mdHeading
    - mdLink
    - mdLinkUrl
    - mdCode
    - mdCodeBlock
    - mdCodeBlockBorder
    - mdQuote
    - mdQuoteBorder
    - mdHr
    - mdListBullet
    - toolDiffAdded
    - toolDiffRemoved
    - toolDiffContext
    - syntaxComment
    - syntaxKeyword
    - syntaxFunction
    - syntaxVariable
    - syntaxString
    - syntaxNumber
    - syntaxType
    - syntaxOperator
    - syntaxPunctuation
    - thinkingOff
    - thinkingMinimal
    - thinkingLow
    - thinkingMedium
    - thinkingHigh
    - bashMode
  minimal surviving set: 1 tokens -> thinkingXhigh
  still constructs = true
```

0.99.2 同一支脚本，幸存集变成 **4 个**（被删掉的 token 少 3 个——
`muted` / `text` / `selectedBg` 这三个在 0.99.2 上删不掉了）：

```
$ node .scratch/theme-spike/candidates.mjs        # 0.99.2
  minimal surviving set: 4 tokens -> muted,selectedBg,text,thinkingXhigh
  still constructs = true
```

两版 `T2.1b` 段的完整 diff（证明差异**只有**这 4 行）：

```
$ diff <(0.83.0 的 T2.1b 段) <(0.99.2 的 T2.1b 段)
11d10
<     - muted
13d11
<     - text
15d12
<     - selectedBg
54c51
<   minimal surviving set: 1 tokens -> thinkingXhigh
---
>   minimal surviving set: 4 tokens -> muted,selectedBg,text,thinkingXhigh
```

| | 0.83.0 | 0.99.2 |
| --- | --- | --- |
| 构造函数最小需求 | **1 个**：`thinkingXhigh` | **4 个**：`muted`、`text`、`selectedBg`、`thinkingXhigh` |
| 现在的代码给的是什么 | `{thinkingXhigh: ""}` ——**恰好就是 0.83.0 的最小集** | `{thinkingXhigh: ""}` —— 缺另外 3 个兜底源 |
| 为什么 | 245-248 行只遍历给定键 | 127-132 行的 4 个合成键要读 `muted`/`text`/`selectedBg`/`thinkingXhigh` |

**这张表同时确认了两件事：**

1. coordinator 的假设**成立**——基类那份颜色状态**只被用来满足构造函数**，
   它的值从未参与任何渲染（否则「删掉 47 个 token」不会仍然 identity）。
2. **颜色值真的无所谓**：幸存集里 `thinkingXhigh` 传的是 `#d183e8`（0.83.0）/
   `okhsl(337 81% 61%)`（0.99.2，0.99.2 的 `dark.json` 已经从 hex 换成了 okhsl），
   全删之后换成 `""` 也照样过。**要的是键，不是值。**

---

## 4. 候选逐个实测

**同一支探针跑两版。** 探针做的事固定为：构造 → 逐个调 13 个渲染方法 →
记录返回值 + 是否含 `\x1b` → 读 `instanceof Theme`。
`BASELINE` 那行是 SDK 自带的 `dark` 主题，用途是**证明探针真的看得见 ANSI**
（它 `fg`/`style` 全是 `ansi=true`），否则「identity = true」就是自说自话。

### 4.0 探针源码（`.scratch/theme-spike/candidates.mjs`，未进 PR）

```js
const cells = [];
const call = (name, fn) => {
  try { const v = fn(); cells.push([name, show(v), hasAnsi(String(v))]); }
  catch (e) { cells.push([name, "THREW " + (e && e.message), false]); }
};
call("fg('accent','X')", () => t.fg("accent", "X"));
call("fg('thinkingMax','X')", () => t.fg("thinkingMax", "X"));
call("bg('selectedBg','X')", () => t.bg("selectedBg", "X"));
call("bold('X')", () => t.bold("X"));
// …italic / underline / inverse / strikethrough / getFgAnsi / getBgAnsi /
// getThinkingBorderColor('high') / getThinkingBorderColor('max') /
// getBashModeBorderColor / getColorMode…
// 0.99.2-only members. Guarded so the same script runs on 0.83.0.
if (typeof t.style === "function") call("style('X',{fg:'accent'})", () => t.style("X", { fg: "accent" }));
if ("appearance" in t) call("appearance", () => t.appearance);
if ("colors" in t) call("Object.keys(colors).length", () => Object.keys(t.colors).length);
```

「完整配置」也**不是我们手写的**：脚本从包自带的
`theme-schema.json → properties.colors.required` 读出 51 个 token，
再照 `resolveThemeColors` 的口径把 `dark.json` 的 `vars` 解析成具体值。
**换句话说候选 A 用的就是 SDK 自己认的那份形状。**

### 4.1 候选 A：给 `super()` 一份完整且合法的配置

**做法**：`extends Theme` 保留，`super(FULL_FG, FULL_BG, "truecolor")`，
两个 `as ConstructorParameters<typeof Theme>[n]` 谎话删掉。

**0.99.2 实测**：

```
$ node .scratch/theme-spike/candidates.mjs        # 0.99.2
--- A        (complete legal config, no `as` lies) ---
  construct            = OK
  fg('accent','X')                         = "X"            ansi=false
  fg('thinkingMax','X')                    = "X"            ansi=false
  bg('selectedBg','X')                     = "X"            ansi=false
  bold('X')                                = "X"            ansi=false
  italic('X')                              = "X"            ansi=false
  underline('X')                           = "X"            ansi=false
  inverse('X')                             = "X"            ansi=false
  strikethrough('X')                       = "X"            ansi=false
  getFgAnsi('accent')                      = ""             ansi=false
  getBgAnsi('selectedBg')                  = ""             ansi=false
  getThinkingBorderColor('high')('X')      = "X"            ansi=false
  getThinkingBorderColor('max')('X')       = "X"            ansi=false
  getBashModeBorderColor()('X')            = "X"            ansi=false
  getColorMode()                           = "truecolor"    ansi=false
  style('X',{fg:'accent'})                 = "\u001b[38;2;167;152;215mX\u001b[39m" ansi=true
  appearance                               = "dark"         ansi=false
  Object.keys(colors).length               = 56             ansi=false
  >>> instanceof Theme = true
  >>> every rendering method identity & ANSI-free = false
```

**结论：import 成功、`instanceof Theme` 为 true、老 13 个方法全恒等——
但 `style()` 漏真 ANSI（`ESC[38;2;167;152;215m`）。**

> ⚠️ `JSON.stringify` 把 ESC 打成 `\u001b`，上面那行里
> `\u001b[38;2;167;152;215mX\u001b[39m` 就是字面的
> `ESC[38;2;167;152;215m` + `X` + `ESC[39m`。**这是真 ANSI，不是转义显示。**
> `ansi=true` 是探针自己判的（`String(v).includes("\x1b")`），与显示无关。

**所以 A 单独用是不够的。** 原因在 §1.2 第 1 条：`style` / `colors` / `appearance`
是 0.99.2 新增的成员，现在的类一个都没覆盖。
0.99.2 的 `style` 实现（`theme.js:187-200`）会拿 `this.fgAnsi` 里的**预计算真转义**：

```
$ sed -n '187,200p' <0.99.2>/dist/modes/interactive/theme/theme.js
    style(text, options) {
        const { fg, bg } = options;
        if (typeof fg === "string" && this.dimTokens.has(fg))
            options = { ...options, dim: true };
        return styleTextWithAnsi(text, fg === undefined
            ? undefined
            : typeof fg === "string"
                ? this.tokenAnsi(this.fgAnsi, fg)
                : foregroundAnsi(fg, this.mode), bg === undefined
            ? undefined
            : typeof bg === "string"
                ? this.tokenAnsi(this.bgAnsi, bg)
                : backgroundAnsi(bg, this.mode), options);
    }
```

⇒ 只要 `super()` 收到了**真颜色**（而不是 `""`），`style()` 就一定会吐 ANSI。
**这直接推出 A\* 的取值策略：全填 `""`（§4.4）。**

### 4.2 候选 A′：完整形状，但每个值都填 `""`

**做法**：51 个 required token 一个不少，值全用 `""`
（`docs/themes.md:90` 明确记载这是合法值：`Terminal default | ""`）。

**0.99.2 实测**：

```
--- A'       (complete shape, every color = "") ---
  construct            = OK
  fg('accent','X')                         = "X"            ansi=false
  fg('thinkingMax','X')                    = "X"            ansi=false
  bg('selectedBg','X')                     = "X"            ansi=false
  bold('X')                                = "X"            ansi=false
  italic('X')                              = "X"            ansi=false
  underline('X')                           = "X"            ansi=false
  inverse('X')                             = "X"            ansi=false
  strikethrough('X')                       = "X"            ansi=false
  getFgAnsi('accent')                      = ""             ansi=false
  getBgAnsi('selectedBg')                  = ""             ansi=false
  getThinkingBorderColor('high')('X')      = "X"            ansi=false
  getThinkingBorderColor('max')('X')       = "X"            ansi=false
  getBashModeBorderColor()('X')            = "X"            ansi=false
  getColorMode()                           = "truecolor"    ansi=false
  style('X',{fg:'accent'})                 = "\u001b[39mX\u001b[39m" ansi=true
  appearance                               = "dark"         ansi=false
  Object.keys(colors).length               = 56             ansi=false
  >>> instanceof Theme = true
  >>> every rendering method identity & ANSI-free = false
```

**结论：仍然漏 ANSI**，只是漏的是 SGR 39（`reset fg`）而不是 SGR 38（真颜色）——
`theme.js:137-139` 的 `addToken` 对 `""` 会 `return "\x1b[39m"` 把它存进 `fgAnsi`，
`style()` 再把它原样拼出来。**A′ 比 A 少漏一点色，但没有不漏。**

### 4.3 候选 A+：A 再加上覆盖 `style` / `colors` / `appearance`

**做法**：A（或 A′）+ 三个新成员覆盖成恒等 / 空。

**0.99.2 实测**：

```
--- A+       (A, plus style/colors/appearance neutralised) ---
  construct            = OK
  fg('accent','X')                         = "X"            ansi=false
  fg('thinkingMax','X')                    = "X"            ansi=false
  bg('selectedBg','X')                     = "X"            ansi=false
  bold('X')                                = "X"            ansi=false
  italic('X')                              = "X"            ansi=false
  underline('X')                           = "X"            ansi=false
  inverse('X')                             = "X"            ansi=false
  strikethrough('X')                       = "X"            ansi=false
  getFgAnsi('accent')                      = ""             ansi=false
  getBgAnsi('selectedBg')                  = ""             ansi=false
  getThinkingBorderColor('high')('X')      = "X"            ansi=false
  getThinkingBorderColor('max')('X')       = "X"            ansi=false
  getBashModeBorderColor()('X')            = "X"            ansi=false
  getColorMode()                           = "truecolor"    ansi=false
  style('X',{fg:'accent'})                 = "X"            ansi=false
  appearance                               = "dark"         ansi=false
  Object.keys(colors).length               = 0              ansi=false
  >>> instanceof Theme = true
  >>> every rendering method identity & ANSI-free = true
```

**结论：可用。** 0.83.0 上同样 `identity=true`（§5）。

### 4.4 ★ 候选 A\*（推荐）：51 token 全 `""` + `appearance` + 覆盖 `style` / `colors`

**做法**（A′ 的取值 + A+ 的覆盖，外加把 `appearance` 显式传给 `super()`）：

- 51 个 required token 全 `""` → `addToken` 走 137-139 的 `""` 短路，
  **不调 `parseColor`**，不产生任何真颜色 ANSI；
- `options.appearance = "dark"` → `theme.js:152` 的
  `options.appearance ?? detectAppearance(...)` 短路，**不去猜外观**
  （全 `""` 时 `concreteForegrounds` 是空数组，交给 `detectAppearance` 只会得到
  一个无意义的推断）；
- 覆盖 `style` / `colors` → 0.99.2 新增的两个出口也变成恒等。

**0.99.2 实测**：

```
--- A*       (RECOMMENDED: 51 tokens all "" + appearance + style/colors neutralised) ---
  construct            = OK
  fg('accent','X')                         = "X"            ansi=false
  fg('thinkingMax','X')                    = "X"            ansi=false
  bg('selectedBg','X')                     = "X"            ansi=false
  bold('X')                                = "X"            ansi=false
  italic('X')                              = "X"            ansi=false
  underline('X')                           = "X"            ansi=false
  inverse('X')                             = "X"            ansi=false
  strikethrough('X')                       = "X"            ansi=false
  getFgAnsi('accent')                      = ""             ansi=false
  getBgAnsi('selectedBg')                  = ""             ansi=false
  getThinkingBorderColor('high')('X')      = "X"            ansi=false
  getThinkingBorderColor('max')('X')       = "X"            ansi=false
  getBashModeBorderColor()('X')            = "X"            ansi=false
  getColorMode()                           = "truecolor"    ansi=false
  style('X',{fg:'accent'})                 = "X"            ansi=false
  appearance                               = "dark"         ansi=false
  Object.keys(colors).length               = 0              ansi=false
  >>> instanceof Theme = true
  >>> every rendering method identity & ANSI-free = true
```

**0.83.0 对照**（同一个类，零改动）：

```
$ node .scratch/theme-spike/candidates.mjs        # 0.83.0
--- A*       (RECOMMENDED: 51 tokens all "" + appearance + style/colors neutralised) ---
  construct            = OK
  fg('accent','X')                         = "X"            ansi=false
  fg('thinkingMax','X')                    = "X"            ansi=false
  bg('selectedBg','X')                     = "X"            ansi=false
  bold('X')                                = "X"            ansi=false
  italic('X')                              = "X"            ansi=false
  underline('X')                           = "X"            ansi=false
  inverse('X')                             = "X"            ansi=false
  strikethrough('X')                       = "X"            ansi=false
  getFgAnsi('accent')                      = ""             ansi=false
  getBgAnsi('selectedBg')                  = ""             ansi=false
  getThinkingBorderColor('high')('X')      = "X"            ansi=false
  getThinkingBorderColor('max')('X')       = "X"            ansi=false
  getBashModeBorderColor()('X')            = "X"            ansi=false
  getColorMode()                           = "truecolor"    ansi=false
  style('X',{fg:'accent'})                 = "X"            ansi=false
  appearance                               = "dark"         ansi=false
  Object.keys(colors).length               = 0              ansi=false
  >>> instanceof Theme = true
  >>> every rendering method identity & ANSI-free = true
```

**A\* 在两版上都：构造成功 + 全恒等 + 无 ANSI + `instanceof Theme`。**
`style` / `colors` / `appearance` 这三个覆盖在 0.83.0 上是**纯新增的 override**——
0.83.0 的基类没有这三个成员，JS 允许多覆盖不存在的成员，构造与行为都不受影响
（上表 `construct = OK` 与 `identity = true` 就是证据）。

### 4.5 候选 B：不再继承 `Theme`，鸭子类型

**做法**：一个普通对象字面量，同样的方法、同样的恒等值。

**0.99.2 实测**：

```
--- B        (duck-typed, no extends Theme) ---
  construct            = OK
  fg('accent','X')                         = "X"            ansi=false
  fg('thinkingMax','X')                    = "X"            ansi=false
  bg('selectedBg','X')                     = "X"            ansi=false
  bold('X')                                = "X"            ansi=false
  italic('X')                              = "X"            ansi=false
  underline('X')                           = "X"            ansi=false
  inverse('X')                             = "X"            ansi=false
  strikethrough('X')                       = "X"            ansi=false
  getFgAnsi('accent')                      = ""             ansi=false
  getBgAnsi('selectedBg')                  = ""             ansi=false
  getThinkingBorderColor('high')('X')      = "X"            ansi=false
  getThinkingBorderColor('max')('X')       = "X"            ansi=false
  getBashModeBorderColor()('X')            = "X"            ansi=false
  getColorMode()                           = "truecolor"    ansi=false
  style('X',{fg:'accent'})                 = "X"            ansi=false
  appearance                               = "dark"         ansi=false
  Object.keys(colors).length               = 0              ansi=false
  >>> instanceof Theme = false
  >>> every rendering method identity & ANSI-free = true
```

**结论：行为上完全达标（恒等、无 ANSI），但 `instanceof Theme = false`。**
代价（§4.5 的类型面证据）：SDK 的 extension 类型面把 theme 声明成**具体类**，
`core/extensions/types.d.ts`（0.99.2 tarball）：

```
$ grep -n "theme: Theme\|readonly theme" <0.99.2>/dist/core/extensions/types.d.ts
102:    setWidget(key: string, content: ((tui: TUI, theme: Theme) => Component & {
111:    setFooter(factory: ((tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider) => Component & {
115:    setHeader(factory: ((tui: TUI, theme: Theme) => Component & {
121:    custom<T>(factory: (tui: TUI, theme: Theme, keybindings: KeybindingsManager, done: (result: T) => void) => (Component & {
179:    readonly theme: Theme;
494:    renderCall?: (args: Static<TParams>, theme: Theme, context: ToolRenderContext<TState, Static<TParams>>) => Component;
496:    renderResult?: (result: AgentToolResult<TDetails>, options: ToolRenderResultOptions, theme: Theme, context: ToolRenderContext<TState, Static<TParams>>) => Component;
1126:export type MessageRenderer<T = unknown> = (message: CustomMessage<T>, options: MessageRenderOptions, theme: Theme) => Component | undefined;
1127:export type EntryRenderer<T = unknown> = (entry: CustomEntry<T>, options: EntryRenderOptions, theme: Theme) => Component | undefined;
```

`:121 custom(...)` 正是 `session.ts:813` 传参的那个工厂，`:179 readonly theme: Theme`
正是 `session.ts:998` 那个 getter。**B 要在这两处各补一次 cast 才编得过**——
等于把本票要消灭的「类型层谎话」换个位置再撒一次。**所以 B 不选。**

**「B 会不会被 SDK 的 `instanceof Theme` 拒掉？」——不会，这一点查清楚了。**
全 SDK 只有**一处** `instanceof Theme`（0.99.2 多一处，是同一段代码的打包副本）：

```
$ grep -rn "instanceof Theme" node_modules/@earendil-works/pi-coding-agent/dist/ \
       node_modules/@earendil-works/pi-tui/dist/ --exclude="*.map"
# 0.83.0
node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js:1712:                if (themeOrName instanceof Theme) {
# 0.99.2
node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js:2016:                if (themeOrName instanceof Theme) {
node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks/chunk-3YAHQSW6.js:…
```

它只出现在 `ui.setTheme(themeOrName)` 里——**交互式 TUI 自己的 UI context**。
worksplice 走的是 RPC 路径，`:998` 的 `setTheme()` 是个
`{ success: false, error: "Theme switching is not supported in worksplice extension UI yet" }`
的桩（§6.1 实测），根本到不了那个 `instanceof`。
**⇒ B 在运行时不会被拒；它输在类型契约和「下一个新成员会静默变 undefined」。**

### 4.6 候选 D：惰性构造 / try-catch 包起来

**做法**：把 `new PlainTextTheme()` 挪进 getter，用 `try/catch` 兜住，
失败就回落到鸭子对象。

**0.99.2 实测**：

```
$ node .scratch/theme-spike/candidates.mjs        # 0.99.2
=== T2.1c  candidate D: lazy + try/catch (deferred, masked) ===
  first access to LAZY.theme took 0 ms
  LAZY.firstError = Invalid color value: undefined
  returned value instanceof Theme = false
  -> the throw moved from module-import time to the first reader of the theme:
     at parseColor (…/@earendil-works/pi-tui/dist/colors.js:77:11)
     at addToken (…/pi-coding-agent/dist/modes/interactive/theme/theme.js:141:27)
     at new Theme (…/pi-coding-agent/dist/modes/interactive/theme/theme.js:147:36)
     at new PlainTextThemeCurrent (…/.scratch/theme-spike/candidates.mjs:55:5)
     fg -> "X"
     bold -> "X"
     getThinkingBorderColor -> "X"
```

**0.83.0 对照**（同一段代码，构造不抛所以 `firstError` 是 null）：

```
$ node .scratch/theme-spike/candidates.mjs        # 0.83.0
=== T2.1c  candidate D: lazy + try/catch (deferred, masked) ===
  first access to LAZY.theme took 0 ms
  LAZY.firstError = null
  returned value instanceof Theme = true
  fg -> "X"
  bold -> "X"
  getThinkingBorderColor -> "X"
```

**结论：能跑通，但明确不推荐**，四条理由，每条都有上面的输出支撑：

1. **它没修任何东西。** `firstError = Invalid color value: undefined` 说明
   构造照样炸，只是被 `catch` 吞了。**51 个 token 一个都没补**。
2. **它把故障从「import 期、进程启动就死、栈指到 `session.ts:101`」换成
   「运行到第一个读 theme 的扩展才炸」**——从编译期可查变成第三方扩展里的运行时错误。
   `fg`/`bold` 现在恒等只是因为回落到了鸭子对象；一旦哪天 `catch` 没兜住某个出口，
   就是 extension 侧的 `undefined is not a function`。
3. **它静默丢掉 `instanceof Theme`**（0.99.2 上 `false`），
   而 §4.5 已经证明 extension 类型面要的是具体类。
4. **0.83.0 上 `firstError` 是 `null`**——意味着这层 `try/catch` 在**当前 pin 上
   是纯开销**：它保护的是一个当前不存在的失败。真正的失败要到 0.99.2 才出现，
   而那时它仍然只是把崩溃藏起来。

### 4.7 候选 C：官方是否提供 no-op / plain theme 或更安全的构造路径

**结论：两版都没有。** 逐条查：

```
$ node .scratch/theme-spike/candidates.mjs   # 两版都跑
=== T2.1  does the SDK ship an official plain/no-op theme? ===
# 0.83.0
  getAvailableThemes() = ["dark","light"]
  getDefaultTheme = undefined
  theme-related exports of the package ROOT:
    Theme, ThemeSelectorComponent, getMarkdownTheme, getSelectListTheme, getSettingsListTheme, initTheme
# 0.99.2
  getAvailableThemes() = ["system","dark","light"]
  getDefaultTheme = (not exported by this build)
  theme-related exports of the package ROOT:
    Theme, ThemeSelectorComponent, getMarkdownTheme, getSelectListTheme, getSettingsListTheme, initTheme

$ grep -rln "PlainTheme\|plainTheme\|NoopTheme\|noopTheme\|HeadlessTheme\|headlessTheme\|createPlainTheme\|noColorTheme" node_modules/@earendil-works/
（0.83.0：零命中）
$ grep -rln "PlainTheme\|plainTheme\|NoopTheme\|HeadlessTheme\|createPlainTheme" <0.99.2 tarball>/dist --exclude="*.map"
（0.99.2：零命中）
```

包根导出的 theme 相关入口两版**完全相同**（6 个），
其中只有 `Theme`（类）和 `initTheme` 与本票有关，
`getMarkdownTheme` / `getSelectListTheme` / `getSettingsListTheme` 返回的是
**pi-tui 的结构接口**（`MarkdownTheme` 等）而不是 `Theme`，
`ThemeSelectorComponent` 是 TUI 的选择器 UI。**没有 plain/no-op/headless 主题。**
0.99.2 新增的 `system` 主题方向相反——它从终端上报的颜色自动生成，
需要真实终端的 `setTerminalColors()`。

**⇒ C 无官方路径可走。** 于是「更安全的构造路径」退化成
**唯一有官方背书的那份形状：包自带的 `theme-schema.json` 的 51 个 `required` token**
（§3.4）。A\* 就是照它填的——**这不是我们发明的形状，是 SDK 自己认的形状。**

### 4.8 BASELINE：探针的有效性自证

```
--- BASELINE (the SDK's own loaded `dark` theme, for reference) ---   # 0.99.2
  construct            = OK
  fg('accent','X')                         = "\u001b[38;2;167;152;215mX\u001b[39m" ansi=true
  getThinkingBorderColor('max')('X')       = "\u001b[38;2;254;84;98mX\u001b[39m" ansi=true
  style('X',{fg:'accent'})                 = "\u001b[38;2;167;152;215mX\u001b[39m" ansi=true
  >>> every rendering method identity & ANSI-free = false
```

**这一行是必需的**：它证明探针在同样的代码路径下**确实能把 ANSI 测出来**，
所以 A\* 的 `ansi=false` 是真阴性，不是探针瞎了。
（注意 0.83.0 BASELINE 的 `bold/italic/...` 也是 `ansi=false`——
那些走 `chalk`，在非 TTY 环境自动降级为无转义。这不影响结论，
因为 worksplice 的 `PlainTextTheme` 本来就自己 override 掉了这批方法。）

### 4.9 候选裁决汇总（完整输出）

```
$ node .scratch/theme-spike/candidates.mjs        # 0.99.2
=== T2.2  verdict table ===
  FAIL  CURRENT  (lib/rpc/session.ts:98-123 verbatim)
  OK    A        (complete legal config, no `as` lies)  identity=false  instanceofTheme=true
  OK    A+       (A, plus style/colors/appearance neutralised)  identity=true  instanceofTheme=true
  OK    A'       (complete shape, every color = "")  identity=false  instanceofTheme=true
  OK    A*       (RECOMMENDED: 51 tokens all "" + appearance + style/colors neutralised)  identity=true  instanceofTheme=true
  OK    B        (duck-typed, no extends Theme)  identity=true  instanceofTheme=false
  OK    BASELINE (the SDK's own loaded `dark` theme, for reference)  identity=false  instanceofTheme=true

$ node .scratch/theme-spike/candidates.mjs        # 0.83.0
=== T2.2  verdict table ===
  OK    CURRENT  (lib/rpc/session.ts:98-123 verbatim)  identity=true  instanceofTheme=true
  OK    A        (complete legal config, no `as` lies)  identity=true  instanceofTheme=true
  OK    A+       (A, plus style/colors/appearance neutralised)  identity=true  instanceofTheme=true
  OK    A'       (complete shape, every color = "")  identity=true  instanceofTheme=true
  OK    A*       (RECOMMENDED: 51 tokens all "" + appearance + style/colors neutralised)  identity=true  instanceofTheme=true
  OK    B        (duck-typed, no extends Theme)  identity=true  instanceofTheme=false
  OK    BASELINE (the SDK's own loaded `dark` theme, for reference)  identity=false  instanceofTheme=true
```

---

## 5. 0.83.0 对照组：推荐修法在旧版本上是否也成立

**A\* 在 0.83.0 上：构造成功、全恒等、无 ANSI、`instanceof Theme = true`**（§4.4 已贴）。

**⇒ 不引入新回归。** 逐项说明 A\* 在 0.83.0 上为什么安全：

| A\* 的每个动作 | 0.83.0 上的表现 | 依据 |
| --- | --- | --- |
| 51 个 token 全 `""` | 0.83.0 的 `fgAnsi` 对 `""` 直接返回 `"\x1b[39m"`（`theme.js:173-174`），不炸 | §3.1 源码 + `construct = OK` |
| 多传 4 个 0.99.2 才认的键 | 0.83.0 的 245 行只做 `{...fgColors, thinkingMax: …}`，多出来的键进 `fgColors` map 但没人读 | §3.1 源码 |
| `options.appearance = "dark"` | 0.83.0 的 240-242 行只读 `options.name` / `sourcePath` / `sourceInfo`，多余键被忽略 | §3.1 源码 |
| override `style` / `colors` | 0.83.0 基类**没有**这两个成员；JS 允许 override 不存在的成员，不影响构造与其它方法 | `construct = OK` + `identity = true` 实测 |

**⇒ 0.83.0 上 A\* 的可观察行为与现状完全一致**：
`fg`/`bg`/`bold`/… 全恒等、`instanceof Theme` 为 true、
`getAllThemes()` / `getTheme()` / `setTheme()` 三个桩不变（§6.1）。
唯一的新增可观察面是 0.99.2 才存在的 `style` / `colors` / `appearance`
——在 0.83.0 上它们返回恒等 / 空对象 / `"dark"`，
而 0.83.0 的 extension 类型面里**这三个成员不存在**（`theme.d.ts` 只有 12 个方法），
所以**没有任何 extension 代码能在 0.83.0 上调到它们**。

---

## 6. extension 侧契约

### 6.1 `session.ts:998` 的 `get theme()` 实际交出什么

**做法**：用 `jiti`（与本仓 `*.test.mjs` 同一个 loader）import 真实的
`lib/rpc/session.ts`，然后从 `AgentSessionWrapper.prototype` 上取
`createExtensionUiContext()`（该方法只在闭包里碰 `this`，
所以一个 prototype 派生的裸 receiver 就够读 getter）。
**生产代码一行未改。**

```
$ node .scratch/theme-spike/contract.mjs        # 0.83.0
### SDK versions under test: {"pi-agent-core":"0.83.0","pi-ai":"0.83.0","pi-coding-agent":"0.83.0","pi-tui":"0.83.0"}
### isolated agentDir = /var/folders/bf/27rt5fsx01q0bq602vmhprsw0000gn/T/ws-theme-agent-8eKEKU

=== T3.1  import lib/rpc/session.ts (no stub, no credentials) ===
  IMPORT OK

=== T3.2  what session.ts:998 `get theme()` hands an extension ===
  ui.theme = [object Object] PlainTextTheme
  ui.theme instanceof Theme = true
  fg('accent','X')                       = "X"            ansi=false
  fg('thinkingMax','X')                  = "X"            ansi=false
  bg('selectedBg','X')                   = "X"            ansi=false
  bold('X')                              = "X"            ansi=false
  italic('X')                            = "X"            ansi=false
  underline('X')                         = "X"            ansi=false
  inverse('X')                           = "X"            ansi=false
  strikethrough('X')                     = "X"            ansi=false
  getFgAnsi('accent')                    = ""             ansi=false
  getBgAnsi('selectedBg')                = ""             ansi=false
  getThinkingBorderColor('high')('X')    = "X"            ansi=false
  getBashModeBorderColor()('X')          = "X"            ansi=false
  getColorMode()                         = "truecolor"    ansi=false
  >>> any ANSI escape in ANY output = false
  >>> getter is stable across reads (same object) = true
  >>> getAllThemes() = []  getTheme() = undefined
  >>> setTheme() = {"success":false,"error":"Theme switching is not supported in worksplice extension UI yet"}
```

**0.99.2 上同一支脚本在 T3.1 就死了**（脚本自己打的头，即 §2.3 那条栈）：

```
$ node .scratch/theme-spike/contract.mjs        # 0.99.2
### SDK versions under test: {"pi-agent-core":"0.99.2","pi-ai":"0.99.2","pi-coding-agent":"0.99.2","pi-tui":"0.99.2"}
### isolated agentDir = /var/folders/bf/27rt5fsx01q0bq602vmhprsw0000gn/T/ws-theme-agent-nIaS7J

=== T3.1  import lib/rpc/session.ts (no stub, no credentials) ===
  IMPORT THREW
  Error: Invalid color value: undefined
      at parseColor (…/pi-tui/dist/colors.js:77:11)
      at addToken (…/pi-coding-agent/dist/…/theme/theme.js:141:27)
      at new Theme (…/pi-coding-agent/dist/…/theme/theme.js:147:36)
      at new PlainTextTheme (…/lib/rpc/session.ts:101:5)
      at …/lib/rpc/session.ts:123:26
```

**⇒ 修法对 `:998` 的影响：零。** getter 本身
（`get theme() { return PLAIN_TEXT_THEME; }`）**一个字都不用改**——
它只是返回那个模块级单例。要改的只有 `PLAIN_TEXT_THEME` 的**构造方式**。
契约的三个可观察面全部保持：

1. **恒等 + 无 ANSI**：`>>> any ANSI escape in ANY output = false`（0.83.0 实测；
   0.99.2 上 A\* 的同口径输出见 §4.4，同样全 `ansi=false`）。
2. **稳定单例**：`ui.theme === ui.theme` 为 true ⇒ `:813` 传的和 `:998` 返的是同一个对象。
3. **主题切换仍是桩**：`getAllThemes() = []`、`getTheme() = undefined`、
   `setTheme()` 返 `{success:false}`——修法不碰这三个。

### 6.2 `:813` 的 factory 拿到的是同一个对象

```
$ node .scratch/theme-spike/contract.mjs        # 0.83.0
=== T3.3  the `:813` call shape: factory(tui, theme, keybindings, done) ===
  factory received theme === ui.theme : true
  component.render(80) = ["rendered@80"] ansi= false
```

**⇒ 两个使用点（`:813` 传参、`:998` getter）共用同一个单例**，
实测为 `===` 相等。所以修法只要保证这个单例是「完整的、恒等的、
`instanceof Theme` 的」，两处契约同时成立，**两处代码都不用改**。

### 6.3 ★ `initTheme()`（`caller.ts:13` import、`:71` 调用）——判定：**不相关**

**待核实项已完成，三条互相独立的依据。**

**依据 ①：崩溃栈里没有 `initTheme` 的任何一帧。** §2.3 的完整栈从
`parseColor` 一路到 `lib/rpc/session.ts:123:26`，**全部帧**是
`colors.js` → `theme.js:141` → `theme.js:147` → `session.ts:101` → `session.ts:123`。
`initTheme` 不在其中。而且这两者的**触发时机**也不同：
`session.ts:123` 是**模块顶层**，在 `import lib/rpc/session.ts` 时就执行；
`caller.ts:71` 的 `initTheme()` 在 `startRpcSession()` 的 `starting` 异步 IIFE 内部，
**要等到有人调 `POST /api/agent/new` 才执行**。崩溃发生在更早的地方。

**依据 ②：`initTheme` 自己吞掉了所有错误，物理上不可能传播。** 0.83.0 逐字
（`theme.js:638-653`，由 `contract.mjs` 自己打印）：

```
$ node .scratch/theme-spike/contract.mjs        # 0.83.0
  --- theme.js:638 ---
  638  export function initTheme(themeName, enableWatcher = false) {
  639      const name = themeName ?? getDefaultTheme();
  640      currentThemeName = name;
  641      try {
  642          setGlobalTheme(loadTheme(name));
  643          if (enableWatcher) {
  644              startThemeWatcher();
  645          }
  646      }
  647      catch (_error) {
  648          // Theme is invalid - fall back to dark theme silently
  649          currentThemeName = "dark";
  650          setGlobalTheme(loadTheme("dark"));
  651          // Don't start watcher for fallback theme
  652      }
  653  }
```

0.99.2 逐字（`theme.js:541-556`，从 npm tarball 只读取出）：

```
$ grep -n "^export function initTheme(" <0.99.2>/dist/modes/interactive/theme/theme.js
541:export function initTheme(themeName, enableWatcher = false) {
     …（正文 541-556 与 0.83.0 同构，只有回落主题从 "dark" 变成 SYSTEM_THEME_NAME）…
  541  export function initTheme(themeName, enableWatcher = false) {
  542      const name = themeName ?? SYSTEM_THEME_NAME;
  543      currentThemeName = name;
  544      try {
  545          setGlobalTheme(loadTheme(name));
  546          if (enableWatcher) {
  547              startThemeWatcher();
  548          }
  549      }
  550      catch (_error) {
  551          // Theme is invalid - fall back to the system theme silently
  552          currentThemeName = SYSTEM_THEME_NAME;
  553          setGlobalTheme(loadTheme(SYSTEM_THEME_NAME));
  554          // Don't start watcher for fallback theme
  555      }
  556  }
```

**两版都被 `try/catch` 全包住并回落到内置主题**，`catch` 分支是静默的。
即使 `loadTheme` 抛 `Invalid color value`，`initTheme()` 也会吞掉并装上 `dark`
（0.99.2 是 `system`）。**它不可能是「抛到调用方」的那个。**

**依据 ③：它操作的是另一个对象。** `initTheme` 写的是 SDK 的**全局代理**，
崩的是我们 `extends Theme` 出来的**独立实例**。0.83.0 的代理实现：

```js
export const theme = new Proxy({}, {
    get(_target, prop) {
        const t = globalThis[THEME_KEY];
        if (!t)
            throw new Error("Theme not initialized. Call initTheme() first.");
        return t[prop];
    },
});
```

**实测这个代理在我们的 import 期崩溃发生时仍处于「未初始化」态**：

```
  global `theme` proxy before initTheme(): fg('accent','X') = THREW Theme not initialized. Call initTheme() first.
```

也就是说：**在 `initTheme()` 被调用之前，全局代理自己先抛一个完全不同的错**；
而 `PlainTextTheme` 的崩溃与它毫无关系（`session.ts:123` 根本没碰全局代理）。
`caller.ts:70` 那句注释「Some extensions access the SDK's global theme even
outside the terminal UI」说的确实是另一件事——那条路径要**留着**。

**⇒ 结论：`caller.ts:13` 的 import 与 `:71` 的调用，一行都不用改。**
本票的修改面严格限于 `lib/rpc/session.ts:98-123`。

### 6.4 extension 侧还有哪些成员会漏（实施票必须一起覆盖）

0.99.2 相对 0.83.0，`Theme` 的**公开成员**多了三个（0.99.2 `theme.d.ts:64,70,71`）：

```
$ sed -n '64p;70p;71p' <0.99.2>/dist/modes/interactive/theme/theme.d.ts
    get appearance(): ThemeAppearance;
    get colors(): Readonly<Record<ThemeToken, Color>>;
    style(text: string, options: ThemeStyle): string;
```

而 0.83.0 的 `theme.d.ts` 里**这三个都不存在**（只有 12 个方法，
从 `fg` 到 `getBashModeBorderColor`）。
现在的 `PlainTextTheme` **一个都没覆盖**，所以 §4.1 的候选 A 会漏
`style()` 的真 ANSI。**A\* 把这三个都覆盖掉，这是 A\* 相对 A 的唯一增量，
也是它成为唯一推荐的原因之一。**

好消息：实测 extension 侧自己**不主动调**这三个方法——

```
$ grep -rn "\.style(\|theme\.colors\|\.colors\[" node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/ --exclude="*.map"
（零命中）
```

**⇒ 漏出来的 ANSI 目前不会真的流到 extension**（worksplice 走 RPC 路径，
不用 pi-tui 的渲染器）。但这是**依赖巧合**：`theme.style()` 是公开 API，
第三方 extension 随时可以调，而它吐出来的 ANSI 落到 web UI 上就是
`ESC[38;2;…m` 这种裸转义符直接显示在浏览器里。**覆盖它不是为了修现在的 bug，
是为了让这个对象继续满足类注释里写的那句契约。**

---

## 7. 给实施票的落地方案（**不写代码，只说改哪几行**）

**唯一推荐：候选 A\***（§4.4）。修改面**严格限于 `lib/rpc/session.ts:98-123`**，
`lib/rpc/caller.ts` 一行都不动（§6.3）。

### 7.1 改动清单

现状（`lib/rpc/session.ts:98-123`，逐字）：

```
 98  // Extensions require a complete Theme, while the web UI applies its own styling.
 99  class PlainTextTheme extends Theme {
100    constructor() {
101      super(
102        { thinkingXhigh: "" } as ConstructorParameters<typeof Theme>[0],
103        {} as ConstructorParameters<typeof Theme>[1],
104        "truecolor",
105      );
106    }
107
108    override fg(...[, text]: Parameters<Theme["fg"]>): string { return text; }
109    override bg(...[, text]: Parameters<Theme["bg"]>): string { return text; }
110    override bold(text: string): string { return text; }
111    override italic(text: string): string { return text; }
112    override underline(text: string): string { return text; }
113    override inverse(text: string): string { return text; }
114    override strikethrough(text: string): string { return text; }
115    override getFgAnsi(): string { return ""; }
116    override getBgAnsi(): string { return ""; }
117    override getThinkingBorderColor(): (text: string) => string {
118      return (text) => text;
119    }
120    override getBashModeBorderColor(): (text: string) => string { return (text) => text; }
121  }
122
123  const PLAIN_TEXT_THEME = new PlainTextTheme();
```

| # | 位置 | 动作 | 依据 |
| --- | --- | --- | --- |
| **1** | `:98` 之上 | **新增一个模块级常量**（或两个），内容是「51 个 required token 全 `""`」的记录，并按 6 个 bg token（`selectedBg` / `userMessageBg` / `customMessageBg` / `toolPendingBg` / `toolSuccessBg` / `toolErrorBg`）拆成 foreground / background 两份。键名与顺序照抄包自带 `dist/modes/interactive/theme/theme-schema.json` 的 `properties.colors.required` | §3.4（两版同一份 51 个）+ §3.3（45 fg + 6 bg） |
| **2** | `:102`（`super(...)` 第一个参数） | 把 `{ thinkingXhigh: "" } as ConstructorParameters<typeof Theme>[0]` 换成第 1 项那份 foreground 记录。**删掉 `as` 谎话**，让类型系统自己要求 45 个键 | §3.3（`Record<Exclude<ThemeColor, OptionalThemeColor>, …>`） |
| **3** | `:103`（`super(...)` 第二个参数） | 把 `{} as ConstructorParameters<typeof Theme>[1]` 换成第 1 项那份 background 记录（6 个键）。**同样删掉 `as`** | 同上（`Record<Exclude<ThemeBg, OptionalThemeBg>, …>`） |
| **4** | `:104` 之后 | **新增 `super()` 的第四个实参**（`options`），含 `appearance: "dark"`。**注意**：0.83.0 的 `options` 类型里**没有** `appearance` 字段（§3.3 的 0.83.0 签名只有 `name` / `sourcePath` / `sourceInfo`）——所以这一步**会让 0.83.0 上的 `tsc` 报「对象字面量有未知属性」**。处置见 §7.2 | §3.2（`theme.js:152` 短路）+ §5 |
| **5** | `:120` 之后 | **新增三个成员**：`style(text, …)` → 返回 `text`；`get colors()` → 返回 `{}`；`get appearance()` → 返回 `"dark"`。0.83.0 上这三个成员基类没有，`override` 关键字会报错，所以**不能加 `override`**——见 §7.2 | §4.1/§4.4（A 漏 `style` 的 ANSI）+ §6.4 |
| **6** | `:98` 的类注释 | 补一句「配置必须是完整且合法的：0.99.2 的 `Theme` 构造会从缺失的键合成新键（`theme.js:127-132`），残缺输入会在 import 期抛 `Invalid color value: undefined`」——把这条陷阱钉在代码旁边 | §3.2 |

**`:123` 的 `const PLAIN_TEXT_THEME = new PlainTextTheme();` 不改。
`:813` 与 `:998` 都不改。**（§6.1、§6.2）

### 7.2 ★ 实施票必须处理的一个类型层张力（本票无权决定，交给实施票 / coordinator）

第 4 项和第 5 项在 **0.83.0 的类型面上过不了**：

- `options.appearance` —— 0.83.0 的 `Theme` 构造函数 options 只有
  `name` / `sourcePath` / `sourceInfo`（§3.3 贴了签名）。
- `style` / `colors` / `appearance` 三个成员 —— 0.83.0 的 `Theme` 上**根本不存在**，
  所以加 `override` 关键字会得到「基类没有这个成员」的错误。

**三条可选处置，本票不替实施票选**（这是 open 决策）：

| 处置 | 做法 | 代价 |
| --- | --- | --- |
| **A. 拆版本分支** | 保留 0.83.0 兼容路径（现状代码），只在 pin 升到 0.99.2 时才换新写法 | 两份代码，pin 一升就可以删旧的 |
| **B. 用一处窄化的类型过渡** | 例如把 `super(...)` 的 options 走一个本仓自定义的 `ConstructorParameters<typeof Theme>[3]` 扩展类型；三个新成员不加 `override` | 引入一处新的（但**窄且诚实**的）类型断言——与本票要消灭的「谎话」不同，因为它对应的是**真实存在的版本差异**，不是残缺输入 |
| **C. 全部照 0.99.2 写，0.83.0 的类型错误本地消化** | 用最小 `@ts-expect-error`（带注释说明「0.83.0 无此成员，pin 升到 0.99.2 后删」） | 留下 3 处 `@ts-expect-error`，是临时的、会自我提醒的迁移标记 |

**共同底线（三条都满足）**：改完之后**那两个 `as
ConstructorParameters<typeof Theme>[n]` 必须消失**——
它们是本票的根因，留着就等于没修。

**这一项需要 coordinator 拍板**（超出「可执行 spike」的授权范围：
它决定的是实施票的代码组织形态，不是本票要回答的技术问题）。
本票的实验结论不受影响：**A\* 的运行时行为在两版上都已实测通过**（§4.4、§5），
三种处置都不改变运行时行为，只改变类型层怎么写。

### 7.3 实施票的验收判据（可直接抄）

1. `import('./lib/rpc/session.ts')` 在 **0.99.2** 上不抛
   （或等价：`npm test` 里 `lib/rpc/*` 那 3 条恢复绿）。
2. 在 **0.99.2** 上 `ui.theme.fg("accent", "X") === "X"`、
   `ui.theme.style("X", { fg: "accent" }) === "X"`、
   `ui.theme instanceof Theme === true`，且**上面三个调用的返回值都不含 `\x1b`**。
3. 在 **0.83.0** 上同样三条全过（§5 已证明 A\* 满足）。
4. `lib/rpc/session.ts:98-123` 内**不再出现** `as ConstructorParameters<typeof Theme>`。
5. `lib/rpc/caller.ts` 零改动（§6.3）。
6. `npm test` 在 0.83.0 上仍是 852/852 全绿。

---

## 8. 未验证项（如实列出）

1. **§7.2 的类型层处置（A / B / C 三选一）本票没有做实验。**
   本票不改任何生产代码，所以「加上 `appearance` / 三个新 override 之后
   `tsc --noEmit` 到底报不报、报几条」**没有实测**。
   0.83.0 与 0.99.2 的类型签名本身是逐字贴出的（§3.3），
   但**「照 A\* 写完在 0.83.0 上 `tsc` 的真实输出」缺一条实测**。
   ⇒ 需要 coordinator 拍板（§7.2），实施票补测。
2. **0.99.2 的 `npm test` 那 5 条失败里，另外 2 条
   （`lib/session-title.test.mjs` 的 2 个用例）没有深查。**
   本票只确认了它们**不是** theme 崩溃（`grep -c "Invalid color value\|PlainTextTheme"`
   的 9 处命中全部来自那 3 个 `lib/rpc/*` 进程），断言内容看起来是 0.99.2
   给 transcript 多插了一条 `system` 消息。**归属哪一票未定。**
3. **`detectAppearance` 在全 `""` 输入下的行为没有单独实验。**
   A\* 传了 `appearance: "dark"` 让 `theme.js:152` 短路，所以那条分支
   **在 A\* 下不会被执行**——但「不传 `appearance`、全 `""` 时
   `detectAppearance([], [])` 返回什么」没有测。A\* 也不需要它。
4. **0.99.2 的 `docs/themes.md` 只查了 `""` 这一行（`:90` / `:92`）**，
   没有通读该文档确认没有别的「程序化构造 `Theme`」的推荐写法。
   §4.7 的「无官方 plain theme」结论靠的是**代码面**证据
   （导出面 + `getAvailableThemes()` + 全仓 grep 零命中），不依赖这份文档。
5. **`instanceof Theme` 的检查只覆盖了 `dist/` 与 `pi-tui/dist/`**，
   没有检查 SDK 的 `dist/bundle/` 之外的其它产物（0.99.2 有一处
   `dist/bundle/chunks/chunk-3YAHQSW6.js` 的命中，是同一段
   `interactive-mode` 的打包副本）。结论「唯一一处、且在 TUI-only 的
   `ui.setTheme`」不受影响。
6. **`style()` 漏 ANSI 的实际影响面没有端到端验证。**
   §6.4 只证明 extension runner 自己不调它（grep 零命中），
   **没有**在浏览器里跑一个真 extension 去调 `theme.style()` 看 web UI 上出现什么。
   结论按「潜在风险、当前不可达」措辞，**没有**按「已发生的 bug」措辞。
7. **两版都只测了 macOS / node v25.0.0 / `truecolor` 模式。**
   `TerminalColorMode` 还有 `256color`；0.99.2 里 `mode` 会传给
   `foregroundAnsi` / `backgroundAnsi`。A\* 全部覆盖掉了这些方法的返回值，
   所以换 mode 不改变可观察行为——**但这是从「方法被恒等覆盖」推出来的，
   没有在 `256color` 下实跑一遍**。
8. **`bun update` 期间 `bun.lock` 里非 pi 的传递依赖也漂了**
   （`openai` 6.26.0→7.19.0、`semver` 7.8.0→7.8.5、`typebox` 1.3.7→1.3.27 等）。
   **直接依赖一个没漂**（`react` 19.2.4 / `next` 16.2.12 / `typescript` 5.9.3 /
   `eslint` 9.39.4 前后逐字相同）。这意味着 0.99.2 那侧的实验环境
   **不是**「只动四个包」的纯净环境。**这对本票的结论无影响**——
   崩溃在 `pi-coding-agent` + `pi-tui` 的 `theme` 代码里，与其它传递依赖无关；
   但如实记在这里。`bun.lock` 已逐字还原（§9.5）。
9. **没有跑 `npm run lint`。** 本票不改业务代码（交付物只有一份 markdown），
   按 spec 的门禁豁免。

---

## 9. 证据索引

**每条结论 = 一条命令 + 它的真实输出。** 输出文件在 `.scratch/theme-spike/`（gitignored，未进 PR）。

### 9.1 环境 / base

| 命令 | 真实输出 | 支撑 |
| --- | --- | --- |
| `node --version` | `v25.0.0` | §2.1 |
| `bun --version` | `1.3.14` | §2.1 |
| `git merge-base HEAD origin/main` | `843dbc1768fce732f2463bd975b6197836eb3500` | base 复核 |

### 9.2 崩溃

| 命令 | 输出文件 | 支撑 |
| --- | --- | --- |
| `node .scratch/theme-spike/run-import.mjs`（0.99.2） | `out-import-0.99.2.txt` | §2.3 真实栈 |
| `node .scratch/theme-spike/run-import.mjs`（0.83.0） | `out-import-0.83.0.txt`（`IMPORT OK`） | §2.4 对照 |
| `npm test`（0.99.2） | `out-test-0.99.2.txt`（`tests 837 / pass 832 / fail 5`） | §2.5 |
| `grep -B2 -A12 "Error: Invalid color value" out-test-0.99.2.txt` | 3 个 `lib/rpc/*` 进程的完整栈 | §2.5 归因 |
| `npm test`（0.83.0） | `out-test-0.83.0.txt`（`tests 852 / pass 852 / fail 0`） | §2.5 基线 |

### 9.3 版本差异

| 命令 | 真实输出 | 支撑 |
| --- | --- | --- |
| `sed -n '232,253p' …/theme/theme.js`（0.83.0） | 全文贴出，**已与装出来的包逐字节校验** | §3.1 |
| `sed -n '172,174p' …/theme/theme.js`（0.83.0） | `fgAnsi` 的 `""` 短路 | §3.1 |
| `sed -n '103,153p' …/theme/theme.js`（0.99.2） | 全文贴出，**已与装出来的包逐字节校验** | §3.2 |
| `sed -n '58,78p' …/pi-tui/dist/colors.js`（0.99.2） | `parseColor` 全文，`:77` 抛 | §3.2 |
| `sed -n '187,200p' …/theme/theme.js`（0.99.2） | `style()` 实现 | §4.1 |
| `sed -n '14p' …/theme.d.ts`（0.83.0） | 旧构造函数签名 | §3.3 |
| `grep -n "OptionalThemeColor =" <0.99.2>/theme.d.ts` | `:26` / `:27` 两条 optional 联合 | §3.3 |
| `sed -n '52,59p' <0.99.2>/theme.d.ts` | 新构造函数签名 | §3.3 |
| `node -e "print schema.properties.colors.required"`（两版） | 均为 **51**，列表逐字相同 | §3.4 |
| `sed -n '64p;70p;71p' <0.99.2>/theme.d.ts` | 三个新增公开成员 | §6.4 |

### 9.4 候选实测

| 命令 | 输出文件 | 支撑 |
| --- | --- | --- |
| `node .scratch/theme-spike/candidates.mjs`（0.99.2） | `out-cand-0.99.2.txt` | §3.5、§4.1-4.4、§4.6、§4.7、§4.8、§4.9 |
| `node .scratch/theme-spike/candidates.mjs`（0.83.0） | `out-cand-0.83.0.txt` | §3.5、§4.4 对照、§4.6 对照、§4.7、§4.9、§5 |
| `diff <(0.83.0 的 T2.1b 段) <(0.99.2 的 T2.1b 段)` | 4 行差异（§3.5 已贴） | §3.5 |
| `node .scratch/theme-spike/contract.mjs`（0.83.0） | `out-contract-0.83.0.txt` | §6.1、§6.2、§6.3 |
| `node .scratch/theme-spike/contract.mjs`（0.99.2） | `out-contract-0.99.2.txt`（T3.1 即崩） | §6.1 对照 |
| `grep -rln "PlainTheme\|…\|createPlainTheme" node_modules/@earendil-works/` | 零命中 | §4.7 |
| `grep -rn "instanceof Theme" …/dist/ …/pi-tui/dist/ --exclude="*.map"` | 各一处，均在 `interactive-mode.js` 的 `ui.setTheme` | §4.5 |
| `grep -n "theme: Theme\|readonly theme" <0.99.2>/core/extensions/types.d.ts` | 10 处，全部声明为具体类 | §4.5 |
| `grep -rn "\.style(\|theme\.colors" …/dist/core/extensions/ --exclude="*.map"` | 零命中 | §6.4 |
| `sed -n '638,653p' …/theme/theme.js`（0.83.0，由 contract.mjs 打印） | `initTheme` 逐字 | §6.3 |
| `sed -n '541,556p' <0.99.2>/theme/theme.js` | `initTheme` 逐字 | §6.3 |

### 9.5 交付物纯净性

```
$ shasum package.json bun.lock .scratch/theme-spike/backup/package.json .scratch/theme-spike/backup/bun.lock
737a34e2f8f0bf88e9acf80f4a2bf0a969d32c04  package.json
6d5b30faf2a32734e376e8ba3bd6f0c998e01603  bun.lock
737a34e2f8f0bf88e9acf80f4a2bf0a969d32c04  .scratch/theme-spike/backup/package.json
6d5b30faf2a32734e376e8ba3bd6f0c998e01603  .scratch/theme-spike/backup/bun.lock

$ node -e "for(const n of ['pi-agent-core','pi-ai','pi-coding-agent','pi-tui']) console.log(n, require('./node_modules/@earendil-works/'+n+'/package.json').version)"
pi-agent-core 0.83.0
pi-ai 0.83.0
pi-coding-agent 0.83.0
pi-tui 0.83.0

$ ls package-lock.json
ls: package-lock.json: No such file or directory
```

**⇒ 四包已还原 `0.83.0`、`package.json` / `bun.lock` 与实验前逐字相同、
未生成 `package-lock.json`。**
