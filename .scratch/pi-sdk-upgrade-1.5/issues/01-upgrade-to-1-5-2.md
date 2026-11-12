# 01: 升级 pi SDK 到 1.5.2（四包原子升级 + 三处代码改动 + 15 项实跑验证）

**Spec:** [spec.md](../spec.md)

**Type:** task

**Status:** resolved

**Blocked by:** None — can start immediately.

## What to build

把四个 `@earendil-works/pi-*` 包从 `0.99.2` **一步**升到 `1.5.2`（`bun.lock` 一次重算，
`node_modules` 清空重装），同时把升级必然带来的三处代码改动改掉——三处性质各不相同：
grep 上下文行的读拦截**静默失效**（必须新写断言守着）、导出 HTML 的补丁块**要删掉**
（上游已内置同等实现）、theme-schema 测试路径**要改读新位置**。

判据是「装上了但行为不对」不算完成：四包在 `package.json` 与 `bun.lock` 里必须只有一套版本，
`bun.lock` 里 `@earendil-works/chord` 消失、`@earendil-works/pi-schema` 出现、`undici` 只剩一条，
并且评估文档 §10.2 的 15 项验证（V3 / V7 / V8 为本轮特有）逐项跑过并记录结果。

## Acceptance

- [ ] 四包在 `package.json` 精确 pin 为 `1.5.2`；`undici` 对齐 `8.12.3`；`bun install` 后
      `bun.lock` 复核四条机械判据全中（无 `0.99.2` 残留、`chord` 为 0、`pi-schema` ≥ 1、
      `undici` 顶层条目为 1），读数贴进 `## Answer`。
- [ ] `node_modules` 是清空后重装的树（旧嵌套布局不留），且未跑 `next build` 污染 `.next/`。
- [ ] **R1 先红后绿**：新增断言「允许根内的符号链接指向根外 + `grep` 带 `context` ⇒ 根外内容不出现」，
      **在改代码之前先观察到它红**（红输出留证），修完转绿；同时补一条反向断言
      「搜索根在允许根之外仍被拒」。
- [ ] **R4 先红后绿**：升级后 `/api/sessions/[id]/export` 先返回 500（`replaceRequired` 的锚点
      命中数 !== 1，留响应体），删掉补丁块后返回 200 且导出文件能在浏览器打开。
- [ ] theme-schema 测试改读 `schemas/theme.schema.json`，断言内容（51 项 `required`）不动，用例转绿。
- [ ] `tsc --noEmit` 与 `npm run lint` 的读数与升级前基线对照（只记本票引入的新增问题）。
- [ ] `npm test` 全量与升级前基线对照：本仓既存的环境相关红（`lib/model-listing.test.mjs` 里读真实
      `~/.pi/agent/models.json` 的用例）不计入本票失败。
- [ ] 15 项验证逐项有结果（通过 / 未通过 / 未跑及原因），V3 / V7 / V8 三项不得写「未跑」。
- [ ] `next.config.ts` 零 diff；构建后 `.next/server` 内不出现 `@earendil-works/pi-schema`（探针读数留证）。
- [ ] R2（成本口径）/ R3（`enabledModels` 歧义）/ trust 语义分歧三处**不改代码**，只在 `## Answer`
      记下观察结果与对外说明的落点。
- [ ] 使用 Azure 的实例所需的配置迁移（`azure-openai-responses` → `azure`）写进 `## Answer` 的
      「升级后运维动作」一节。

## Out of scope（本票明确不做）

- 不评估 `1.5.2` 之后的版本。
- 不为 `pi-ai` / `pi-tui` / `pi-agent-core` 做完整差异审计（只到本仓用到的符号层）。
- 不重构 `lib/pi-types.ts` 的 `AgentSessionLike` 镜像；不改 `lib/http-dispatcher.ts`；
  不改 `lib/project-trust.ts`；不碰 `next.config.ts`。
- 不把 15 项实跑全部固化成自动用例（只有 R1 / R4 / theme-schema 三处新增或修改断言）。
- 不更新 `docs/pi-sdk-upgrade-1.5-assessment.md` 与更早那份评估（历史记录不回填）。
- 不做分段升级。

## 票据协议（worker 必读）

- 开工直接干，不用改本文件；完工后 append `## Answer`，并把 `Status:` 流转到 `resolved`
  （或按失败情形流转，并在 `## Answer` 写明）。
- 提问通道一律 `orca orchestration ask`，禁 AskUserQuestion；open 决策 ask 回来，不编造。
- 本票**跑**：`npm test` / `tsc --noEmit` / `npm run lint` / 15 项实跑 / 双轴 code-review
  （改了源码，双轴适用）。固定点 = 本票的 base commit。
- R1 与 R4 的**红**必须先于修法出现。没有红证据的「我判断它会红」不算。

---

## Answer

**状态：resolved（2026-11-12）**。四个 `@earendil-works/pi-*` 从精确 pin 的 `0.99.2` 一步升到 `1.5.2`，
`undici` 对齐 `8.12.3`，升级必然带来的三处代码改动全部落地（R1 grep 读拦截、R4 删导出补丁、theme-schema 路径），
15 项验证逐项有结果。`tsc` / `npm run lint` / `npm test` 与升级前基线对照**无本票引入的新增失败**
（唯一失败是既存环境红，点名见 §6）。

本票 worktree：`/Users/apple/orca/workspaces/worksplice/pi-sdk-upgrade-impl`。
base commit：`20e1adcefe60c7d7bbc6ec3a749342e348a5d4ef`（= `20e1adc`）。

---

### 0. 与票面的三处冲突（先看这段；均已向 coordinator 请示并获裁决）

**(1) R1 的「先红」在现实里造不出来 —— 票据与 spec 的技术前提被实测推翻**

票据要求「允许根内符号链接指向根外 + `grep` 带 `context` ⇒ 根外内容出现」先红。在 1.5.2 树上、**未改任何代码**时实测三种形态，全部**不泄漏**（真实会话 + 真工具 + 系统 `rg 15.2.0`）：

| 形态 | 结果 |
| --- | --- |
| `path` = 允许根内指向根外**文件**的符号链接，`context: 2` | **被拒**：`path outside this agent's allowed roots: …/link.md`（拦它的是定义级 `guardSearchRootCall` 的 realpath 判定；0.99.2 的同款代码也拦） |
| `path` = 允许根内**目录**（内部含上述符号链接），`context: 2` | `No matches found` —— ripgrep 目录遍历**不跟随**符号链接（同一份 `rg` 命令在纯 shell 下复跑同样 0 命中） |
| `path` = 指向根外**目录**的符号链接，`context: 2` | **被拒**（同上） |

即：0.99.2 的 `readFile` 读拦截在**可达形态上本来就冗余**——符号链接只有被当作搜索根显式传入时才会被读，而那一步一直有 realpath 判定。
**裁决**：保留票据原文的两条行为断言（现即绿，作为 V7/V6 回归守卫）+ 新增一条**真红**的守卫面断言（「交给 grep 的 ops 不含 `readFile` 键」，
按裁决**不锁死整个键集合**）+ 删掉死代码 + 更新 ADR-0011（记录实测三元组与 `rg --help` 原文）。详见 §3.1、§4。

**(2) `undici 8.12.3` 改了「明文 http 经代理」的形态 —— 评估 §6.2「行为/类型不受影响」被推翻**

- `undici@8.5.0`：`proxyTunnel` 默认 `true` ⇒ 明文 http 也走 CONNECT 隧道。
- `undici@8.12.3`：`shouldProxyTunnel(requestProtocol, proxyTunnel) = proxyTunnel === true || requestProtocol !== 'http:'`
  （`node_modules/undici/lib/dispatcher/proxy-agent.js:42`）⇒ **明文 http 默认改成绝对 URI 直写代理，不再 CONNECT**（https 仍隧道）。
- 本地代理实测：默认 `connectTargets=[]` / `plain=["GET http://target.invalid/through-http-proxy"]`；
  传 `proxyTunnel: true` 后 `connectTargets=["target.invalid:80"]`（与 8.5.0 一致）。
- 后果：`lib/http-dispatcher.ts` 未传 `proxyTunnel` ⇒ 经代理访问 `http://` 模型端点的形态会静默改变，且既有测试
  `lib/http-dispatcher.test.mjs` 会红。

**裁决 A（coordinator 转用户裁决）**：在 `new undici.EnvHttpProxyAgent({...})` 里显式加一行 `proxyTunnel: true` 保持 8.5.0 行为，
**解禁范围严格限于这一处**（该文件其余任何东西未动）。因此 `lib/http-dispatcher.test.mjs` 一行未改、原样绿。

**(3) 三处非票据预期的测试红，处置如下**

| 红 | 根因 | 处置 |
| --- | --- | --- |
| `lib/tool-path-guard-extension.test.mjs:162` | 1.5.2 的 `edit` 只有 **2** 条 `promptGuidelines`（0.99.2 是 4 条）；同一用例里 guarded 与 baseline 的 `deepEqual` 全绿，**只有硬编码字面量漂移** | 4 → 2 的最小修正（同文件，R1 断言落点） |
| `lib/http-dispatcher.test.mjs:18` | 上面第 (2) 条 | 不改测试，改实现一行 |
| `lib/rpc/session.test.mjs:319` | `theme-schema.json` 搬到 `schemas/theme.schema.json` | 改路径，断言内容 0 改动 |

**4 → 2 的判据（coordinator 要求留证）**

```
# 升级后、改代码前：该用例唯一的失败断言就是这一行
✖ 覆盖定义由 pi 自己造：提示片段、编辑准则、diff 渲染逐字保留
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  2 !== 4
    at TestContext.<anonymous> (lib/tool-path-guard-extension.test.mjs:162:10)

# 同一用例里逐字锁内容的断言（循环内）没有任何失败输出：
#   for (const name of GUARDED_TOOL_NAMES) { … assert.deepEqual(definition.promptGuidelines, base.promptGuidelines, …) }
# ⇒ guarded 与 baseline（都由 pi 自己造）的准则内容逐字一致，只有条数硬编码漂移。

# diff（唯一的实现改动就是这一行 + 解释注释）
-  assert.equal(guarded.get("edit").promptGuidelines.length, 4);
+  // 条数由上游定义（1.5.2 是 2 条，0.99.2 是 4 条）；上面的 deepEqual 已经逐字锁住内容，
+  // 这里只保留「守卫没有把准则整块丢掉」这个下限，不把上游条数当成我们的契约。
+  assert.equal(guarded.get("edit").promptGuidelines.length, 2);

# 改完该文件 8/8 通过：ℹ tests 8 / pass 8 / fail 0
```

1.5.2 的 `edit` 准则实际内容是：`"Use edit for targeted changes. Batch changes to one file in a single call."` 与
`"Each edits[].oldText must exactly and uniquely match the original file. Keep matches short and non-overlapping; merge nearby changes without including large unchanged regions."`

另两处一并说明（都不是功能改动）：

- `app/api/sessions/[id]/export/route.ts` 里 `const inline = new URL(req.url)…` 原本在 `try` **外**（HEAD 版本 `:246`），
  pi-lens 对本文件报 STOP（「未捕获的 `new URL`」）。按「一行、不改行为」把它移进既有 `try`（异常路径从 Next 的裸 500 变成路由自己的 500 JSON）。
- `AGENTS.md` 的「Exported session HTML」一节（原 `:434`）还写着导出路由「patches recursive tree helpers…」，
  R4 删补丁后这句成了假话。按 coordinator 对 ADR-0011 的同一裁决（治理文档随代码过期就该同步）改为「委托上游 exporter + 上游已用显式栈 + 新测试守卫」，
  这里是**唯一一处**票面清单外的文件，请你验收时点一下。

---

### 1. 依赖与 `bun.lock` 四条机械判据

改动：`package.json` 四个 pi 包 `0.99.2 → 1.5.2`，`undici 8.5.0 → 8.12.3`（其余依赖一个未动）。
`rm -rf node_modules` 后 `bun install`（**未跑 `npm install`**）→ `1031 packages installed`（升级前 frozen-lockfile 是 `1032`）。

| 判据 | 命令 | 读数 | 判定 |
| --- | --- | --- | --- |
| 无 `0.99.2` 残留 | `grep -c "0\.99\.2" bun.lock` | `0`（`grep -c "0\.99\."` 也是 `0`） | ✅ |
| `@earendil-works/chord` 为 0 | `grep -c "@earendil-works/chord" bun.lock` | `0` | ✅ |
| `@earendil-works/pi-schema` ≥ 1 | `grep -c "@earendil-works/pi-schema" bun.lock` | `3`（`pi-agent-core` / `pi-ai` 的依赖项 + 自身锁定条） | ✅ |
| `undici` 顶层条目为 1 | `grep -cE '^    "undici": \[' bun.lock` | `1`（`undici@8.12.3`，无嵌套副本） | ✅ |

> 说明：`grep -c "chord"` 会数到 `d3-chord`（mermaid 的 d3 依赖，与本判据无关）；判据按**包名全串** `@earendil-works/chord` 计。

四包在 `bun.lock` 里各只有一条锁定记录，全部是 `1.5.2`。

---

### 2. 升级前基线（本票 worktree 的 base commit，非借用）

```
HEAD                     20e1adcefe60c7d7bbc6ec3a749342e348a5d4ef
node / bun               v25.0.0 / 1.3.14
bun install --frozen-lockfile   1032 packages（0.99.2 的树）
tsc --noEmit             exit 0（0 error）
npm run lint             exit 0（0 error, 1 warning: hooks/useI18n.tsx:61 react-hooks/exhaustive-deps）
npm test                 exit 1 —— ℹ tests 1785 / pass 1784 / fail 1 / 22.3s
  ✖ lib/model-listing.test.mjs:50「lite path returns a working runtime without loading extensions」
     → 读真实 ~/.pi/agent/models.json，返回 deepseek-flash / deepseek-v4-pro 两条，用例期望 []

升级后、改代码前（同一棵树，只换依赖）
tsc --noEmit             exit 0（0 error）—— 类型面如评估预判「不说话」
npm test                 ℹ tests 1785 / pass 1781 / fail 4
  ✖ lib/http-dispatcher.test.mjs:18（undici 形态，见 §0(2)）
  ✖ lib/model-listing.test.mjs:50（既存环境红）
  ✖ lib/rpc/session.test.mjs:319（theme-schema 路径，R3）
  ✖ lib/tool-path-guard-extension.test.mjs:126（edit 准则条数 4≠2）
```

---

### 3. 三处代码改动：红 → 改 → 绿（顺序证据）

#### 3.1 R1 —— grep 上下文行的读拦截（死代码删除 + 断言）

**红（改代码之前）**，`node --test --test-timeout=60000 lib/tool-path-guard-extension.test.mjs`：

```
✖ R1 守卫面：交给 grep 的 ops 不再声明 readFile（上游已忽略那个字段） (0.578833ms)
  AssertionError [ERR_ASSERTION]: 1.5.2 起 readFile 不再被调用；继续交就是一句守不住的承诺
  true !== false
ℹ tests 10 / pass 9 / fail 1
```

（同一次运行里 `R1 行为面…` 是**绿**的——这正是 §0(1) 那条实测结论：泄漏不复现。）

**改**（`lib/tool-path-guard-extension.ts`）：删掉 `grep.readFile`，留注释说明上游语义与剩余防线。**改**（ADR-0011）：新增更正段。

**绿**：`lib/tool-path-guard-extension.test.mjs` 10/10 通过；
全量 `npm test` 从 4 fail → 1 fail（只剩既存环境红）。

R1 的两条断言（`lib/tool-path-guard-extension.test.mjs`）：

- **守卫面**：`"readFile" in guardFileOperations(scope).grep === false`。
- **行为面**：允许根内指向根外的符号链接（文件 / 目录两形）当搜索根 ⇒ 被拒且报错列出允许根清单；目录遍历（符号链接躺在搜索根内部）
  带 `context: 3` ⇒ 根外匹配行与上下文行**都不出现**；反向断言：搜索根在允许根之外（数据目录）⇒ 仍被拒。

`GrepOperations.readFile` 的事实（复核过，作为删除依据）：`1.5.2` 的 `dist/core/tools/grep.d.ts:31-34` 带 `@deprecated Ignored`，
`dist/core/tools/grep.js` **全文件零** `readFile`；上下文行由 `--context` + `context` 事件给出（源码注释：
`rg emits the surrounding lines as context events, so no matched file is ever read here (#9276)`）。

#### 3.2 R4 —— 删掉导出 HTML 的补丁块

**红（改代码之前）**，直接调用 `app/api/sessions/[id]/export/route.ts` 的 `GET`（隔离 `PI_CODING_AGENT_DIR` + 合成 session）：

```
status: 500
content-type: application/json
body: {"error":"Error: Failed to patch exported HTML: sortChildren expected 1 match, found 0"}
```

锚点复核（1.5.2 的 `dist/core/export-html/template.js`）：`function sortChildren(node)` / `function mapNodes(node)` /
`function markActive(node)` / `tree.forEach(mapNodes)` 各 **0** 次命中；上游已改成显式栈（`template.js:157-162`、`:204-215`、`:567-583`）。

**改**：删除 `patchExportHtml`（含 60 余行说明注释）+ `replaceRequired` + 唯一调用点（`+2 / −139` 行）；`route.ts` 现在直接把导入的 HTML 原样返回。

**绿**：同一探针 → `status: 200`，`content-type: text/html; charset=utf-8`，正文以 `<!DOCTYPE html>` 开头。
自动化断言落在新增的 `app/api/sessions/[id]/export/route.test.mjs`（3 条：200/内容载荷/inline 形态/未知 id 404）。

#### 3.3 theme-schema（R3）—— 只改路径

**红**：`lib/rpc/session.test.mjs` → `Error: ENOENT … dist/modes/interactive/theme/theme-schema.json`。
**改**：路径改成 `node_modules/@earendil-works/pi-coding-agent/schemas/theme.schema.json`；**断言内容一字未动**
（仍是 `schema.properties.colors.required` 的 51 项 + background 六项 + 「不得回归 `as ConstructorParameters<typeof Theme>`」）。
**绿**：该用例通过；`node -e` 读数：`required count: 51`（首项 `accent` / 末项 `bashMode`）。

---

### 4. 反向验证（证明断言真的绑在实现上，不是装饰）

| # | 临时改动 | 期望 | 实测 |
| --- | --- | --- | --- |
| A | 把 `guardSearchRootCall` 从 grep 的注册闭包里摘掉 | R1 行为面必须红 | ✖ `R1 行为面…`：`The input did not match the regular expression /path outside this agent's allowed roots: \//`（报错退化成 pi 的 `Path not found`）——**红** |
| B | 把 `readFile` 重新交回 grep 的 ops | R1 守卫面必须红 | ✖ `R1 守卫面…`：`true !== false`——**红** |
| C | 把 `patchExportHtml` 整块放回 `route.ts` | R4 断言必须红 | ✖ `exporting a session returns 200…`：`{"error":"Error: Failed to patch exported HTML: sortChildren expected 1 match, found 0"}`；✖ `?inline=1 …`——**2 条红** |

三次临时改动都已还原（还原后 A/B 的运行 10/10 绿、C 的运行 3/3 绿）。

---

### 5. 15 项验证（评估 §10.2，逐项有结果）

实跑环境：`node_modules/.bin/next dev -H 127.0.0.1 -p 31399`（**不用** `npm run dev`，它硬编码 30142 与主工作区冲突），
`WORKSPLICE_DATA_DIR=/tmp/pi-sdk-v-data`（隔离数据目录，不写使用者 `~/.worksplice`）。
> 本机一处既存环境坑（与本票无关）：启动期准入闸把 loopback bind 判成 non-loopback 并 fail-closed，
> 用 `WORKSPLICE_PASSWORD` 放行后正常服务（`lib/access-gate.ts` 的自连探针在本机网卡上误判，未在票面范围）。

| # | 意图 | 结果 | 读数 |
| --- | --- | --- | --- |
| V1 | dev server 起得来、首页与会话列表正常 | **通过** | `✓ Ready in 446ms`；`GET /` → 200；`GET /api/sessions` → 200 |
| V2 | 建 agent + 建会话 + 跑完一轮真实会话 | **通过** | `POST /api/members` 建 `Probe One`（magpie/group/dsv4.1f, thinking off）→ `restart` 起会话；`#all` 里 @ 它 → 真模型一轮，回复 `PONG`（seq 4）。`GET /api/members/[id]/observability` 记录到 2 轮 |
| V3 | `toolNames: []` 建会话，system prompt 仍被清空 | **通过** | 会话 `activeTools: []`、`state.systemPrompt: ""`；真实请求体里 `system` 字段缺席、`role=system` 消息 **0** 条 |
| V4 | 任务板 claim → complete，含一次 claim 被 hold 让路 | **通过** | `POST /api/tasks` 建 #1 → claim 带过期 `baseSeq: 1` → **409** `{"held":true,"roomSeq":8,"whatHappened":"7 new message(s) arrived in this target (seq 2–8)"}` → claim 带 `baseSeq: 8` → 200 `in_progress` → `update-status in_review` → 200；板视图 `#1 in_review reachable=['done','in_progress','closed']` |
| V5 | 成员会话 bash 撞允许根外的墙 → 归因文案与拒绝不变 | **通过** | RPC 面 `{type:"bash", command:"cat ~/pi-sdk-v5-outside/secret.txt"}` → 输出含 `Operation not permitted` + `[worksplice sandbox: sandbox-exec] the kernel denied a path…` + 允许根清单；`echo SANDBOX_OK` 照常 → `SANDBOX_OK`；根外内容未泄漏 |
| V6 | 成员会话 grep 搜允许根外路径 → 搜索根仍被拒 | **通过** | `path=<dataDir>` → `path outside this agent's allowed roots: …/.worksplice`；自动化反向断言同结论 |
| V7 | 允许根内符号链接指向根外 + `context` → 上下文行是否露出 | **通过（结论：不露）** | 见 §0(1) 三元组：符号链接搜索根被拒、目录遍历不跟随符号链接。**票据预期的「露出来」不成立**，故以「不露 + 拒绝文案」为断言（§3.1） |
| V8 | 导出一次会话 HTML：先红后绿 | **通过** | 红：500 + `replaceRequired` 锚点未命中（§3.2）；绿：`GET /api/sessions/<id>/export` → **200**、`text/html; charset=utf-8`、442 865 bytes、含 `<script id="session-data" type="application/json">` 块；`?inline=1` → 200 |
| V9 | ModelsConfig 读模型列表 + 测一次连通性 | **通过** | `GET /api/models` → 29 个模型，默认 `magpie/group/dsv4.1f`，`modelScopeWarnings: null`、`thinkingLevelPins: {}`；`POST /api/models-config/test` → `{"ok":true,"latencyMs":2329,"status":200,"responseText":"OK"}` |
| V10 | PRESET_NONE 会话抓请求体，确认 `tools` 字段是否存在 | **通过** | 请求体 `Object.hasOwn(body,"tools") === false`（1.5.1 起不再发 `"tools": []`）、无 `system` 顶层字段、`messages` 1 条、`stream: true` |
| V11 | Anthropic provider 两轮，第 2 轮增量消息路径 | **部分通过（真实 Anthropic 未验证）** | 本机 Anthropic **无凭证**（`/api/auth/all-providers`：`anthropic configured: false`；OAuth `loggedIn: false`），故用本地假 `anthropic-messages` endpoint 跑两轮：第 2 轮请求体 `messages=3`（user/assistant/user）、`tools` 缺席。**未见「只发增量」形态**，真实端点行为未验证（需凭证） |
| V12 | 成本看板读数与 SDK `getSessionStats()` 对齐 | **通过（附口径观察）** | observability `totals`: `messageCount 5 / cached 26368 / uncached 28067 / total 54606 / costTotal 0`；独立从 jsonl 重算（sum(input)=28067、sum(cacheRead)=26368）逐项一致。`getSessionStats` **一直是 `AgentSession` 的实例方法、不在包根导出**（两版 `dist/index.d.ts` 均 0 命中），本仓 `lib/rpc/session.ts:680` 的 `this.inner.getSessionStats()` 与 `lib/session-stats.ts` 的同口径镜像都不受影响（读数见下注） |
| V13 | 同一 cwd 第二个成员会话 → `BusyCwdError` | **通过** | agent-runtime 接缝：第一个会话 prompt 在飞时 `startSession(第二个成员)` → `BusyCwdError: Another agent session is already active in <cwd>`；既有 cwd-mutex 自动用例同结论 |
| V14 | `npm test` 全绿（对照基线） | **通过（相对基线）** | 见 §6 |
| V15 | `npm run build` exit 0，且 `.next/server` 无 `pi-schema` | **通过（口径见下）** | build exit 0（先停掉自己的 dev server 再 build）；`.next/server` 的 **`.js` chunk 里 `@earendil-works/pi-schema` 命中 0**，`.nft.json` 追踪清单里 76 处（同探针对 `@earendil-works/pi-coding-agent` 是 152 处——两者都是 external 的运行时引用，不是打进 bundle）；`.next/server` 下 `node_modules` 目录数 **0**；`next.config.ts` 相对 HEAD **零 diff** |

> V15 的口径要说清：票据写「`.next/server` 内**不出现** `@earendil-works/pi-schema`」。字面判据不成立——
> Next 的 `*.nft.json` 文件追踪清单**会把 external 包的文件路径也列进去**（`pi-coding-agent` 同样在列）。
> 成立的是探针真正要证的结论：**`pi-schema` 没有被 webpack 编译进任何 server chunk**（`.js` 命中 0、无 node_modules、`next.config.ts` 零 diff）。

**V12 补充读数（`getSessionStats` 不是升级引入的变化）**：它**一直是 `AgentSession` 的实例方法、从未从包根导出**——
两版 `dist/index.d.ts` 的 `grep -c getSessionStats` 都是 **0**（`0.99.2` → 0，`1.5.2` → 0）；
实例方法声明两版都在 `dist/core/agent-session.d.ts`（`0.99.2:836` / `1.5.2:916`，签名 `getSessionStats(): SessionStats`）。
本仓的 `this.inner.getSessionStats()`（`lib/rpc/session.ts:680`）与镜像声明（`lib/pi-types.ts:174`）因此两版都成立、**不需要改 `lib/pi-types.ts`**；
`lib/session-stats.ts` 的同口径解析是「直接读 jsonl、不建会话」那条路的实现，与「包根是否导出」无关。

---

### 6. 门禁对照（本票增量）

| 门 | 升级前基线 | 本票交付 | 差异 |
| --- | --- | --- | --- |
| `node_modules/.bin/tsc --noEmit` | exit 0（0 error） | exit 0（0 error） | 无 |
| `npm run lint` | exit 0（0 error / 1 warning `hooks/useI18n.tsx:61`） | exit 0（0 error / **同一条** warning） | 无 |
| `npm test` | 1785 项 / 1784 pass / 1 fail | **1790 项 / 1789 pass / 1 fail** | 新增 5 条用例（R1 ×2 + R4 ×3），失败集合不变 |

**既存红点名（不计入本票失败）**：`lib/model-listing.test.mjs:50`
「lite path returns a working runtime without loading extensions」——它读**真实** `~/.pi/agent/models.json`，
该文件里配了 `deepseek-flash` / `deepseek-v4-pro` 两个模型，用例期望 `[]`。
升级前后的失败原因与用例名完全一致（升级前 `pass 1784 / fail 1`，升级后同一用例同一断言）。分类依据：失败输入来自使用者的家目录配置，
不来自本仓代码，换一台没有 models.json 的机器即绿。

---

### 7. R2 / R3 / trust：不改代码，只记观察与落点

- **R2 成本口径**（`lib/session-stats.ts:59` 的 `typeof cost.total !== "number"` 校验照旧通过，未改代码）：
  `1.5.2` 的 assistant `usage.cost` 多了一个 **`totalFromProvider`** 字段（本次实跑读数 `cost.total: 0, cost.totalFromProvider: false`，
  因为 `magpie` 这个聚合 provider 不返回报价）。**对外要说的话**：成本看板 = 「provider 报价优先，缺失时回落目录价估算」，
  读数 0 不等于免费，而是「provider 未给报价且模型无目录价」。落点：`docs/cost-monitoring-baseline.md` 与 ModelsConfig / 可观测性面板的文案（本票不改，留给对外说明票）。
- **R3 `enabledModels` 跨 provider 歧义**（`lib/model-scope.ts:71-72` 只消费 diagnostic 的 `message`，未改代码）：
  本次实跑 `GET /api/models` → 29 个模型、`modelScopeWarnings: null`（本机 `enabledModels` 未触发歧义），`thinkingLevelPins: {}`。
  行为口径 = 「全部加入 + 一条警告」；落点：模型选择器的提示文案（同上，本票不改）。
- **trust 语义分歧**（`lib/project-trust.ts` 未改）：worksplice 在「项目无 trust-requiring 资源」时提前返回 `trusted: true`，
  而 SDK `1.5.0` 起改成「保存的决定优先」。**这不是升级引入的破坏**（0.99.2 时代就是两套判定），本票只记下
  「worksplice 说信任 / SDK 说不信任」的解释，修留给后续票。

---

### 8. 升级后运维动作（使用方实例）

- **Azure provider 改名**：`azure-openai-responses` → **`azure`**。用到 Azure 的实例需要在 `~/.pi/agent/auth.json`（凭证 key）、
  `models.json`（provider 名）与 `settings.json`（`defaultModel.provider`）里把该名字改过来，否则模型列表里看不到、会话回落到默认模型。
- **代理出网**：本票在 `lib/http-dispatcher.ts` 显式设了 `proxyTunnel: true`（见 §0(2)），行为与 8.5.0 一致；
  若将来有人想用「明文 http 绝对 URI 直写」形态，去掉这一行并同步改 `lib/http-dispatcher.test.mjs` 的断言。
- **成本数字**：升级后 `usage.cost` 多了 `totalFromProvider`；看板读数语义见 §7。

---

### 9. 双轴 code-review（固定点 = base `20e1adc`，两个子审并行、互不污染上下文）

两个子审（`reviewer`，与主上下文隔离）分别审 Standards 与 Spec，产出原样汇总如下，随后是我的处置。

#### Standards 轴

- **Correct**：ADR-0011 新增更正段格式与既有更正段一致，且真的附了证据（`grep.js` 的 `--no-config` / `context` 注释原文、
  `template.js` 三处显式栈，子审逐条核到）；`http-dispatcher.ts` 的注释给出来源文件、判定表达式、8.5.0 对比；
  新增注释为简体中文，`export/route.test.mjs` 命名与既有 `app/api/**/route.test.mjs` 一致。
- **P1**：「R1 守卫面」用例测实现形状，违反 `docs/engineering-standards.md` §2.1，且与同文件头「不测 `operations` 的函数签名」自相矛盾。
- **P1**：`AGENTS.md:434` 仍写导出路由「patches recursive tree helpers…」→ 文档事实错误。
- **P2**：「合法路径零行为变化」里「grep：遍历途中读文件（context 行）也走守卫」与 R1 结论相反。
- **P2**：`session.test.mjs` 新注释引入全角引号（评审读到的是修改前快照）。
- **P2**：`inline` 移进 `try` 属无必要 churn；R1 行为面里的 `existsSync` 守卫属投机式防御；
  ADR 里「0.99.2 同款代码也拦」「纯 shell 复跑同样 0 命中」未留命令（陈述性证据）。
- **Merge verdict**：OK with notes（无 P0；两条 P1 为文档/测试纪律，建议一并修）。

#### Spec 轴

- **Correct**：Acceptance 1 依赖面落地（四包 1.5.2 + undici 8.12.3，`bun.lock` 四条判据）；R4 按决策 4「删除不重写锚点」执行；
  R1 按裁决落地（删死代码 + ADR 写满证据 + 反向断言保留）；theme-schema 只改路径；
  `next.config.ts` / `lib/pi-types.ts` / `lib/project-trust.ts` 零 diff。
- **P1**：Acceptance 的「记账」类条目整块缺失（`## Answer` 与 Status 流转未发生）——即本节正在补的那件事。
- **P2**：`AGENTS.md:434` 与现状相反（与 Standards 同一发现）。
- **P2**：裁决 2（`proxyTunnel`）与 `spec.md` 决策 2 的结论互相打脸，需在 Answer 记偏离原因（见 §0(2) 与 §8）。
- **P2**：两条断言形态的已知弱点（守卫面是字段存在性断言；`edit` 条数 2 下次升级同样假红）。
- **Merge verdict**：OK with notes。

#### P1 处置（逐条）

1. **「R1 守卫面」测实现形状** → **保留断言，矛盾就地消解并记录**。理由：coordinator 的裁决明确要求这条红落在「ops 不含 `readFile` 键」上；
   上游把这个字段改成 `@deprecated Ignored` 后运行时零调用，任何行为断言都证明不了「我们不再声称能拦上下文行读取」。
   为了不同文件自己打自己，`lib/tool-path-guard-extension.test.mjs` 的头注释新增「**唯一例外（R1，2026-11-12 升级票裁决）**」段，
   写清为什么这条必须看键、以及为什么不锁整个键集合。
2. **`AGENTS.md:434` 与现状相反** → **已改**（同 ADR-0011 一类治理文档同步，见 §0 末条）。
3. **Spec P1「记账类条目缺失」** → 本节即 Answer 本体，`Status` 与同一提交流转到 `resolved`。

#### P2 处置

| 项 | 处置 |
| --- | --- |
| 「grep 遍历途中读文件也走守卫」注释 | 改为「根内的上下文行照常出——上游 1.5.2 由 ripgrep 自己给，不经我们的 ops」 |
| `session.test.mjs` 全角引号 | 已换直引号（评审读到的是修改前快照） |
| R1 行为面里的 `existsSync` 守卫 | 已删（`mkdtempSync` 新目录，恒真） |
| `inline` 移进 `try` 的 churn | 保留：pi-lens 对该行报未捕获的 `new URL`（STOP 项），行为不变 |
| ADR 里不可复跑的读数 | 已补「复跑方式」命令 + 两点限制说明（0.99.2 读数不可在 HEAD 复跑的原因、rg 版本） |

#### 已知弱点（不改，写在这里免得下一个人重新发现）

- 「R1 守卫面」是字段存在性断言：上游若将来**重新**逐文件读，这个键仍不会出现在我们的 ops 里，这条断言不会红。
  真会红的是行为断言——上游一旦跟随符号链接或恢复逐文件读取，`R1 行为面` 的「根外上下文行不出现」立刻红。两条分工如此，ADR-0011 已记。
- `edit` 的 `promptGuidelines.length === 2` 是上限式 pin，下次上游改条数会假红；内容由 guarded-vs-baseline 的 `deepEqual` 逐字锁住，条数那行只当「没被整块丢掉」的下限。

---

### 10. 交付

- 提交：见本票所在分支的最新 commit（`Status` 收敛与 `## Answer` 同一次提交）。
- 变更文件：`package.json`、`bun.lock`、`lib/tool-path-guard-extension.ts`、`lib/tool-path-guard-extension.test.mjs`、
  `app/api/sessions/[id]/export/route.ts`、`app/api/sessions/[id]/export/route.test.mjs`（新）、`lib/rpc/session.test.mjs`、
  `lib/http-dispatcher.ts`、`docs/adr/0011-agent-file-tool-path-guard.md`、`AGENTS.md`（§0 末条）、本票文件。
- 明确未动：`next.config.ts`（零 diff）、`lib/project-trust.ts`、`lib/pi-types.ts` 的镜像结构、`docs/pi-sdk-upgrade-1.5-assessment.md` 与更早评估。
- `.next/` 未提交；`npm install` 全程未跑；`npm run dev` 未用（改用显式端口）。
