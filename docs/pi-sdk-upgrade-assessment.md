# pi SDK 升级评估：0.83.0 → 0.99.x

> 这是一份**评估**，不是升级本身。本文件不含任何源码改动，全部结论以 npm registry metadata、
> 包内 tarball 的类型声明与产物、以及本仓自身代码为一手证据；二手来源（技术博客、
> "XX 升级指南"、第三方 changelog 摘要）一律不采信。
>
> 取证方式：`npm pack` 取 0.83.0 / 0.99.1 / 0.99.2 三套 tarball 解包对比 `.d.ts` 与 `dist/*.js`，
> 加上 `npm view` 的 registry metadata。**未执行 `npm install`，未修改本仓 `node_modules`，
> 未实际升级**——原因见第 6 节。

---

## 1. 结论（TL;DR）

**建议升，但必须先补两个洞；目标定 `0.99.2` 而非 `0.99.1`。**

代价量级：**类型层几乎全绿，运行时层有 1 处必炸 + 3 处静默行为变化。**
升级本身不贵（改动集中在少数几个 call site），贵的是「表面全绿、实际静默变行为」——
本仓最硬的一条防线 `lib/pi-types.ts` 的结构化镜像恰好会**把其中最致命的一处类型断裂
伪装成通过**。

会真的咬人的地方，按严重度排：

1. **`AgentState.systemPrompt` 变成只读**（0.99.x）。`lib/rpc/session.ts:292` 正在写它。
   本仓自己的 `AgentSessionLike`（`lib/pi-types.ts:131`）把它声明成可变可选属性，
   所以 **`tsc` 不会报错**，运行时在严格模式下抛 `TypeError`。
   触发条件是 `PRESET_NONE`（`tools=[]`）启动会话 —— 即"全禁工具"这条路径。
2. **`setModel()` / `setThinkingLevel()` 不再默认写全局设置**（0.99.x）。
   `lib/rpc/session.ts:430`、`:483` 会静默丢掉用户在 UI 里换模型/换思考级别的持久化副作用。
3. **session jsonl 新增 `context_edit` / `usage` 两类条目**（0.87.0 起）。
   `lib/session-reader.ts:304` 的 `switch` 带 `default: return null`，
   新条目被**静默丢弃**；`lib/session-stats.ts:92` 的成本口径会**漏算**。
4. **6 个新传递依赖**（含 `quickjs-wasi` 这个 WASM 运行时），
   而 `next.config.ts:31` 的 `serverExternalPackages` 仍只列四个包。

而**不需要担心的**面比想象的大：`lib/pi-types.ts` 手写的 `AgentSessionLike`（39 个成员）
在 0.99.1 里**一个都没少**；`SessionStats`、`navigateTree`、`SessionManager` /
`SettingsManager` / `DefaultResourceLoader` / `DefaultPackageManager` /
`createAgentSessionServices` / `createAgentSessionFromServices` /
`resolveModelScopeWithDiagnostics` 的签名全部不变；`ThinkingLevel` 联合类型不变；
`engines.node >= 22.19.0` 不变；`repository.url` 三版完全相同。

### English summary

> **Recommendation: upgrade, but not before closing two holes. Target `0.99.2`, not `0.99.1`.**
> The type surface is almost entirely green — all 39 members of worksplice's hand-written
> `AgentSessionLike` mirror survive, and every SDK signature it calls is unchanged or only
> gained optional parameters. The real cost is behavioral and silent: `AgentState.systemPrompt`
> became read-only (worksplice writes it at `lib/rpc/session.ts:292`, and its own structural
> mirror hides the type error), `setModel()`/`setThinkingLevel()` no longer persist to global
> settings by default, and the session jsonl gained `context_edit`/`usage` entries that our
> reader drops via a `default:` branch.
> The stated "six upgrades" is wrong: 13 published versions span 5 minor lines, with a
> deliberate, unexplained 0.88–0.98 numbering gap. `0.99.2` is a strict superset of `0.99.1`,
> so it is free.

---

## 2. 事实基线

### 2.1 当前 pin

`package.json:42-54` 四个包全部**精确 pin**（无 caret/range）：

| 包 | pin | 内部依赖声明 |
|---|---|---|
| `@earendil-works/pi-agent-core` | `0.83.0` | `@earendil-works/pi-ai ^0.83.0`、`@earendil-works/pi-tui ^0.83.0` |
| `@earendil-works/pi-ai` | `0.83.0` | — |
| `@earendil-works/pi-coding-agent` | `0.83.0` | `@earendil-works/pi-{agent-core,ai,tui} ^0.83.0` |
| `@earendil-works/pi-tui` | `0.83.0` | — |

**⇒ 四个包必须同一步一起改。** 0.99.x 内部声明的是 `^0.99.1` / `^0.99.2`；
在 0.x 版本上 caret 的语义是 `>=0.99.1 <0.100.0`，所以 0.83.0 的 pin 无法被 0.99.x 满足。
这不是可以分批的改动（见第 6 节）。

> **对 coordinator 已取证事实的更正**：第 5 条「本仓无 lockfile」不成立。
> 仓库**有** `bun.lock`（2455 行，已被 git 跟踪），第 8-11 行精确 pin 四个包到 `0.83.0`，
> 第 179-185 行带 sha512 完整性哈希。被 gitignore 的只是 `package-lock.json` 与
> `pnpm-lock.yaml`（见 `.gitignore:44-45`）。
> 真实情况是：**`bun install` 可复现，`npm install` 不可复现**。
> 因此"装到的是什么版本"取决于包管理器，而不是取决于安装时刻。

### 2.2 版本谱系 —— 「六次升级」核实结论

**上一轮口头说的「六次升级」不成立。**

真实结构（来自 `npm view @earendil-works/pi-coding-agent time --json` 的完整发布表，
并与 `0.99.2` tarball 内 `CHANGELOG.md` 的版本小节交叉核对，两者完全一致）：

- `0.83.0` 之后、含 `0.99.1` 的已发布版本共 **13 个**：
  `0.84.0 0.84.1 0.84.2 0.84.3 0.84.4 0.85.0 0.85.1 0.86.0 0.86.1 0.87.0 0.87.1 0.99.0 0.99.1`
- 跨 **5 条 minor 线**：`0.84` / `0.85` / `0.86` / `0.87` / `0.99`（`0.83` 之后无 `0.88`–`0.98`）。
- 若把目标算到 `0.99.2`，则是 **14 个版本**。
- **断层不是"发布中断"**：`0.87.1`（2026-09-22）到 `0.99.0`（2026-09-29）只隔 **7 天**，
  `CHANGELOG.md` 也从 `## [0.87.1]`（第 140 行）直接跳到 `## [0.99.0]`（第 61 行），
  中间没有任何小节。这是一次**有意的版本号跳跃**。
- **断层原因：未知，上游未说明断层原因。** `time` map 与 `CHANGELOG.md` 都没有任何
  一句解释为什么跳过 0.88–0.98。本报告不编一个理由。
  （旁证：该项目的 numbering 历史上也跳过过 patch 号——`0.80.0` 与 `0.80.4` 从未发布，
  `0.74.2` 的发布时间甚至晚于 `0.75.4`。但这只能说明"跳号是它的习惯"，
  不能证明 `0.88`–`0.98` 的具体动机。）

为什么"六次"凑不出来：把 5 条 minor 线 + 起始版本算成 6 是唯一能凑出 6 的算法，
但那与"升级次数"不是一回事；按发布版本数算是 13 或 14。**两个数都不是 6。**

### 2.3 上游仓库身份

从 package metadata 取（`npm view @earendil-works/pi-coding-agent@<ver> --json` 的
`repository` / `homepage` / `bugs` 字段，并解开 tarball 读 `package/package.json` 复核）：

| 字段 | 0.83.0 | 0.99.1 | 0.99.2 |
|---|---|---|---|
| `repository.url` | `git+https://github.com/earendil-works/pi.git` | **同左，逐字相同** | **同左，逐字相同** |
| `homepage` | `https://github.com/earendil-works/pi#readme` | 同左 | 同左 |
| `description` | `Terminal coding agent` | 同左 | 同左 |
| `engines.node` | `>=22.19.0` | 同左 | 同左 |
| `license` | `MIT` | 同左 | 同左 |
| `pi-ai` 的 `repository.directory` | `packages/ai` | 同左 | 同左 |

**结论：这次升级与仓库改名无关。** `earendil-works/pi` 这个地址在 0.83.0 就已经是
当前 metadata 的值，本仓 `README.md:5` 与 `README.md:166` 写的
`https://github.com/earendil-works/pi` 与之**一致**，无需更正。
（`CHANGELOG.md` 里那些 `github.com/badlogic/pi-mono/...` 的链接出现在第 2796、2834、
3468、3848、5190 行，全部属于 0.83.0 之前的历史条目 —— 那是旧址留下的历史链接，
不是当前身份。）

### 2.4 目标该定 0.99.1 还是 0.99.2

`npm view ... dist-tags` 的 `latest` 是 **`0.99.2`**，不是 `0.99.1`。

**推荐 `0.99.2`。** 依据（逐条一手核实）：

- **时间**：`0.99.1` 2026-09-29T18:23Z 发布，`0.99.2` 2026-09-30T19:30Z 发布，**相隔 1 天**。
  多等一天的边际成本可以忽略。
- **`.d.ts` 文件集合完全相同**，只有 7 个文件内容有差异，且全部落在
  MCP / codemode / tool-search 域：
  `dist/core/mcp-servers.d.ts`、`dist/core/virtual-models.d.ts`、`dist/config.d.ts`、
  `dist/core/extensions/types.d.ts`、`dist/extensions/mcp/*.d.ts`（6 个）、
  `dist/extensions/codemode/{tool,worker}.d.ts`、`dist/extensions/tool-search/tool.d.ts`、
  `dist/modes/interactive/components/visual-truncate.d.ts`。
- **7 个文件的差异全是加法**，没有一处删除 worksplice 用得到的符号：
  - `dist/config.d.ts`：`getCodemodeWorkerUrl()` → `getCodemodeWorkerSpecifier()`
    （codemode worker 入口改名，worksplice 不用）
  - `dist/core/agent-session.d.ts:133`：新增可选配置
    `usesDefaultTools?: boolean`（"reload 会激活 `defaultTools` 里新增的工具"）
  - `dist/core/model-runtime.d.ts:114`：新增 **private** `markProvisionallyConfigured`
  - `dist/core/extensions/types.d.ts`、`dist/extensions/mcp/config.d.ts`：
    `McpExposure` 去掉 `"codemode-deferred"` 字面量
- **`pi-agent-core` 与 `pi-tui` 在 0.99.1 / 0.99.2 之间零差异**（非 bundle 产物字节相同）。

**代价对比**：

| | 选 0.99.1 | 选 0.99.2 |
|---|---|---|
| 上游修复 | 少拿一批（0.99.2 修了 extension-registered native provider 的默认模型识别、新会话忽略保存模型等） | 全拿 |
| 与 `latest` 的一致性 | 落后一版，下次升级还要再做一次 | 同步 |
| 对 worksplice 的风险 | 无额外风险（0.99.2 的差异全在 MCP/codemode 域，worksplice 不碰） | 无额外风险 |
| 内部依赖范围 | `^0.99.1` | `^0.99.2` |

**唯一会让人选 0.99.1 的理由**是"0.99.2 刚发布一天、未经实战"。但它的 `.d.ts` 差异
全部在 worksplice 的触碰面之外（第 3 节已核对），所以这条理由不成立。

**未知**：本报告**没有**验证 0.99.2 的运行时是否引入回归——那需要实际装包并跑
（本票范围外，见第 6 节的"需要一个 spike 票"）。

### 2.5 上游随包发布的迁移文档

`CHANGELOG.md` 在 0.83.0 / 0.99.1 / 0.99.2 三个 tarball 里**都有**
（分别 5209 / 5958 / 5998 行）。这是本次评估最硬的一手来源：第 4 节多条结论直接引它。
其中带 `### Breaking Changes` 小节的是 **`## [0.87.0] - 2026-09-21`**（`CHANGELOG.md:172-178`）。
其余版本段只有 `Added` / `Changed` / `Fixed`。

---

## 3. 影响面盘点

### 3.1 规模

- 直接 `import` `@earendil-works/*` 的文件：**39 个**（不含 `node_modules`）。
  这 39 个文件合计约 **5765 行**。
  > 对 coordinator 已取证事实的更正：第 3 条说 37 个。用
  > `grep -rl "@earendil-works" --include="*.ts" --include="*.tsx" --include="*.mjs" . | grep -v node_modules`
  > 数得 39 个（含 4 个 `*.test.mjs` 与 `next.config.ts`）。差异来自是否把测试与配置文件计入。
- 但**真正承载 SDK 语义的文件远少于 39 个**。多数只是薄路由或薄 adapter。
- **`lib/rpc/` 合计 1508 行**（`session.ts` 1038 / `caller.ts` 199 / `registry.ts` 114 /
  `subscriber.ts` 61 / `broadcaster.ts` 58 / `index.ts` 38）—— 这是唯一的重镇。

### 3.2 按模块分组

#### A. 会话生命周期（`lib/rpc/` + `lib/agent-runtime.ts`）

| 文件 | 行数 | 直接 import 的 SDK 符号 |
|---|---|---|
| `lib/rpc/session.ts` | 1038 | `SessionManager`、`Theme`、`getAgentDir`（:12）；`SlashCommandInfo`（:13）；`KeybindingsManager`、`TUI_KEYBINDINGS` from `pi-tui`（:14）；`ThinkingLevel` from `pi-agent-core`（:11） |
| `lib/rpc/caller.ts` | 199 | `createAgentSessionFromServices`、`createAgentSessionServices`、`getAgentDir`、`initTheme`、`SessionManager`（:9-15） |
| `lib/rpc/registry.ts` | 114 | 无（走 `lib/rpc/index.ts` 窄面） |
| `lib/rpc/subscriber.ts` / `broadcaster.ts` | 61 / 58 | 无 |
| `lib/rpc/index.ts` | 38 | 无（纯 re-export） |
| `lib/agent-runtime.ts` | 348 | `ThinkingLevel`（:3）；`SessionManager` 走**动态** `await import()`（:153、:184） |

`lib/rpc/session.ts` 实际触碰的 `AgentSession` 实例成员共 **29 个 call site 行**
（`:165-1036`），其中会话状态机相关的重灾区：

- 事件名集合：`RUNNING_STATE_EVENT_TYPES`（`:73-81`，7 个字面量）、
  `IDLE_RESET_EVENT_TYPES`（`:83-88`，4 个）、`lib/cwd-mutex.ts:136-137`
  （`PROMPT_DONE_EVENTS` / `SETTLE_EVENTS`）、`lib/agent-runtime.ts:41-48`（`STATUS_BY_EVENT`）、
  `hooks/useAgentSession.ts:1042-1204`（8 个 `case`）
- 工具：`getAllTools()`（`:547`）、`getActiveToolNames()`（`:548`）、
  `setActiveToolsByName()`（`:588`）、`CODING_TOOL_NAMES` 硬编码表（`:96`）
- 模型/思考：`setModel()`（`:430`）、`setThinkingLevel()`（`:483`）、
  `agent.state.thinkingLevel` 写入（`:488`）
- system prompt：`agent.state.systemPrompt = ""`（`:292`）← **第 4 节 B-1**
- 分支/导航：`navigateTree()`（`:477`、`:1016`）、`createBranchedSession()`（`:461`）

#### B. 模型与工具配置

| 文件 | 行数 | 直接 import 的 SDK 符号 |
|---|---|---|
| `lib/model-scope.ts` | 142 | `resolveModelScopeWithDiagnostics`、`ModelRuntime`、`ScopedModel`（:2-6）；`Api`、`Model` from `pi-ai`（:7）；`ThinkingLevel`（:1） |
| `lib/model-listing.ts` | 73 | `createAgentSessionServices`、`getAgentDir`、`ModelRuntime`、`SettingsManager`（:2-7） |
| `lib/model-discovery-auth.ts` | 58 | `ModelRuntime`（:4） |
| `lib/models-cache.ts` | 84 | 无（`invalidateModelsCache` 是**本仓自有**，不是 SDK 导出——见 3.4） |
| `lib/model-catalog.ts` | 404 | 无 |
| `lib/tool-presets.ts` | — | 无（纯数据 + 纯函数） |
| `lib/startup-preferences.ts` | 55 | `ThinkingLevel`（:1）；`SettingsManager`（:2） |
| `lib/provider-listing.ts` | 118 | 无（纯函数） |
| `lib/provider-listing-runtime.ts` | 37 | `ModelRuntime`（:1） |
| `lib/provider-credential-store.ts` | 114 | `Credential` from `pi-ai`（:3）；`getAgentDir`（:4） |

#### C. 资源与包管理

| 文件 | 行数 | 直接 import 的 SDK 符号 |
|---|---|---|
| `app/api/plugins/route.ts` | 364 | `DefaultPackageManager`、`getAgentDir`、`SettingsManager`、`PackageSource`、`ResolvedPaths`、`ResolvedResource`（:4-11） |
| `app/api/skills/route.ts` | 77 | `getAgentDir`、`parseFrontmatter`（:5） |
| `app/api/skills/install/route.ts` | 62 | `getAgentDir`（:2） |
| `lib/skills-service.ts` | 16 | `DefaultResourceLoader`、`getAgentDir`（:1） |
| `lib/skill-updates.ts` | 263 | 无（走 `lib/api-types`） |
| `lib/project-trust.ts` | 48 | `hasTrustRequiringProjectResources`、`ProjectTrustStore`（:1） |
| `app/api/project-trust/route.ts` | 66 | `getAgentDir`（:4） |
| `lib/skill-lock.ts` | 146 | 无 |

#### D. 认证与凭据

| 文件 | 行数 | 直接 import 的 SDK 符号 |
|---|---|---|
| `app/api/auth/all-providers/route.ts` | 13 | `ModelRuntime`（:1） |
| `app/api/auth/providers/route.ts` | 13 | `ModelRuntime`（:1） |
| `app/api/auth/api-key/[provider]/route.ts` | 76 | `ModelRuntime`（:1） |
| `app/api/auth/login/[provider]/route.ts` | 192 | `AuthEvent`、`AuthPrompt` from `pi-ai`（:1）；`ModelRuntime`（:2） |
| `app/api/auth/logout/[provider]/route.ts` | 22 | `ModelRuntime`（:1） |
| `app/api/models-config/test/route.ts` | 121 | `completeSimple`、`AssistantMessage` from **`pi-ai/compat`**（:5）；`ModelRuntime`（:6） |

#### E. 事件与订阅

| 文件 | 行数 | 说明 |
|---|---|---|
| `hooks/useAgentSession.ts` | 1863 | **不 import SDK**，自带本地 `interface AgentEvent`（:55），按 `event.type` 字符串分派 8 个 case（:1042-1204） |
| `lib/cwd-mutex.ts` | 190 | 不 import SDK；`SETTLE_EVENTS` 收敛点（:136-137、:163） |
| `lib/rpc/broadcaster.ts` / `subscriber.ts` | 58 / 61 | 不 import SDK |

**这一组是本报告最重要的结构性发现**：事件管线**全程零编译期耦合**——
`lib/rpc/session.ts:28-31` 把事件类型声明成全开放结构
`{ type: string; [key: string]: unknown }`，`hooks/useAgentSession.ts:55` 另有一份本地定义。
⇒ **上游改事件名，`tsc` 一个字都不会说。**

#### F. 会话文件读取（只读侧）

| 文件 | 行数 | 直接 import 的 SDK 符号 |
|---|---|---|
| `lib/session-reader.ts` | 350 | `SessionManager`、`buildContextEntries`、`buildSessionContext`、`getAgentDir`（:1-6）；`SessionEntry as PiSessionEntry`、`SessionInfo as PiSessionInfo`（:10） |
| `lib/session-stats.ts` | 198 | `SessionManager` 走**动态** `await import()`（:159） |
| `lib/session-title.ts` | 253 | `Agent`、`AgentMessage`、`AgentOptions`、`AgentTool` from `pi-agent-core`（:1-6）；`AgentSession` from coding-agent（:7） |
| `lib/session-file-references-core.ts` | 82 | 无 |
| `app/api/sessions/[id]/route.ts` | 248 | `SessionManager`（:4） |
| `app/api/sessions/[id]/context/route.ts` | 31 | `SessionManager`（:2） |
| `app/api/sessions/[id]/export/route.ts` | 282 | `getPackageDir` 走**动态** `import()`（:25）+ `resolver("@earendil-works/pi-coding-agent")`（:57）；并**硬编码深路径** `dist/core/export-html/index.js`（:236） |
| `app/api/sessions/[id]/auto-name/route.ts` | 45 | `AgentSession`（type-only，:2） |

#### G. 其它

| 文件 | 行数 | 说明 |
|---|---|---|
| `lib/pi-types.ts` | 169 | **本仓的核心防线**。手写 `AgentSessionLike`（39 个成员）镜像 SDK 的 `AgentSession`，只用 5 个 `import type`（:1-7）。全仓只有 2 个文件消费它：`lib/rpc/session.ts:21` 与 `hooks/useAgentSession.ts:15` |
| `lib/api-types.ts` | 105 | `ResourceDiagnostic`（type-only，:1） |
| `lib/domain/raft/secretary-auto-create.ts` | 79 | `getAgentDir`（:3） |
| `app/api/agent/new/route.ts` | 88 | `ThinkingLevel`（:2）；`THINKING_LEVELS` 硬编码 7 个值（:9） |
| `app/api/models/route.ts` | 114 | `getAgentDir`、`SettingsManager`（:3）；`getSupportedThinkingLevels` from `pi-ai`（:4） |
| `app/api/models-config/route.ts` | 67 | `getAgentDir`（:4） |
| `next.config.ts` | 72 | `serverExternalPackages` 列 4 个包（:31-38）；构建期读 `node_modules/.../package.json` 取 `version`（:10-16） |

### 3.3 被误列为「触碰面」但其实不碰 SDK 的文件

coordinator 给的清单里有 4 个文件**根本不 import SDK**，核实后剔除：

| 文件 | 实际情况 |
|---|---|
| `lib/agent-loop/loop.ts`（1760 行） | `grep -n "earendil" lib/agent-loop/loop.ts` **零命中**。它通过自研 `LoopRuntime` 结构子集 + `AgentRuntime` 接缝驱动，不认识 SDK 类型 |
| `lib/normalize.ts` | 只 import 本地 `./types`（:1） |
| `lib/agent-status.ts` | 不 import SDK |
| `lib/tool-presets.ts` | 不 import SDK。**且它仍然硬编码工具名**（`:10-12`），见 5.2 |

⇒ **`lib/agent-loop` 这个最大的自研模块完全在升级爆炸半径之外**。这是本仓最有利的结构。

### 3.4 三条「名义上有、实际没有」的 SDK 依赖

| 名义依赖 | 核实结果 |
|---|---|
| `invalidateModelsCache` | **不是 SDK 导出**。0.83.0 与 0.99.1 的 `dist/` 里都没有这个名字。它是本仓 `lib/models-cache.ts:38` 的自有函数（8 个调用点全在本仓内） |
| `SettingsManager.withLock` | SDK **两版都有**（`dist/core/settings-manager.d.ts`），但**本仓一处都没用**。`app/api/models-config/route.ts:24-29` 用的是自研 `writePrivateFileAtomicSync` |
| `SDK SessionManager.listAll` | 本仓有 3 个消费点：`lib/session-reader.ts:18`、`lib/agent-runtime.ts:184`、`lib/session-stats.ts:160`（后两个走动态 `import()`） |

---

## 4. 逐条变更

本节 6 条，每条按「症状 → 供给侧证据 → 消费侧证据 → 层级判定 → 修法」五项写全。
**层级判定**严格区分「类型层破了」与「运行时真的变了」——`.d.ts` 变了不等于运行时变了，
反之亦然。末尾 4.7 是**已核实为不成立**的候选 breaking change，列出来是为了防止下一轮重踩。

### 4.1 B-1 `AgentState.systemPrompt` 变为只读 —— 类型层破，但本仓的镜像会把它伪装成通过

**症状**：启动 `PRESET_NONE`（`tools=[]`，全部工具关闭）的会话时抛
`TypeError: Cannot set property systemPrompt of #<Object> which has only a getter`。

**供给侧证据**：

- `pi-agent-core@0.83.0` `package/dist/types.d.ts:285` —— `systemPrompt: string`（可写）
- `pi-agent-core@0.99.1` `package/dist/types.d.ts:336` —— **`readonly systemPrompt: string`**，
  注释明写：
  > `Read-only: to change the prompt, append a system message with `content` or `sections`.`
  > `In `initialState`, this seeds the leading system message.`
- 运行时实现同步改变：`pi-agent-core@0.83.0` `package/dist/agent.js:30` 是
  `systemPrompt: initialState?.systemPrompt ?? ""`（普通数据属性）；
  `pi-agent-core@0.99.1` `package/dist/agent.js:36-39` 变成
  `return { get systemPrompt() { return getCurrentSystemPrompt(messages); }, ... }`
  —— **只有 getter**。ESM 严格模式下对只有 getter 的属性赋值会抛 `TypeError`。
- `pi-agent-core@0.99.1` `package/dist/agent.js:33-35` 说明了新语义：
  `createInitialSystemMessage(initialState?.systemPrompt, ...)` 生成一条 system message，
  仅当 `messages[0]?.role !== "system"` 时才 `unshift` 进去。

**消费侧证据**：

- `lib/rpc/session.ts:290-293`
  ```ts
  private applyForcedEmptySystemPrompt(): void {
    if (this.forceEmptySystemPrompt && this.inner.agent.state) {
      this.inner.agent.state.systemPrompt = "";   // ← :292 写只读属性
    }
  }
  ```
- 触发链：`lib/rpc/caller.ts:153-155`（`toolNames?.length === 0` → `setForceEmptySystemPrompt(true)`）
  → `caller.ts:164`（`beginExtensionBinding`）→ `session.ts:291-292`。
  也就是说 **`POST /api/agent/new` 带 `toolNames: []`，或 UI 选 "none" 档，就走这条路**。

**为什么 `tsc` 不会报**（这是本条最危险的地方）：

- `lib/pi-types.ts:131` 把 `agent` 声明为
  `{ state?: { systemPrompt?: string; thinkingLevel?: string } }` —— **可变、可选、非 readonly**。
- `lib/rpc/session.ts:162` 的构造函数签名是 `(public readonly inner: AgentSessionLike)`，
  所以 `this.inner` 的类型就是这份本仓镜像，永远看不到 SDK 的 `readonly`。
- 唯一一处真实 SDK 类型与镜像对撞的地方是 `lib/rpc/caller.ts:149`
  `new AgentSessionWrapper(inner)` —— 但那里只校验 `inner` **可赋给** `AgentSessionLike`，
  是单向的结构兼容检查，**不会把 `AgentSessionLike` 的宽松性反向传播到 SDK 类型**。

**层级判定**：**类型层破了（SDK 侧 readonly）+ 运行时真的变了（抛异常）**。
这是本报告里唯一一处「类型层与运行时同时破、且被本仓抽象掩盖」的变更。

**修法**（本票不实施）：删掉 `applyForcedEmptySystemPrompt` 的赋值，改为在
`session.sessionManager` 上追加一条空 system message（上游给的新通道），
或直接不再覆盖 system prompt —— 上游现在把 `systemPrompt` 从 transcript 的 system
messages 回放，空 tools 的场景本就没有 system prompt 可清。
**这一步必须实跑验证**（见第 6 节 spike）。

---

### 4.2 B-2 `setModel()` / `setThinkingLevel()` 不再默认写全局设置 —— 纯运行时变化，类型层是加法

**症状**：用户在 UI 里换模型或换思考级别，worksplice 不再把它持久化到全局
`settings.json`；重启后回到旧值。**不报错、不告警。**

**供给侧证据**（两版 `.d.ts` 的 JSDoc 逐字对比，`dist/core/agent-session.d.ts`）：

| | 0.83.0 | 0.99.1 |
|---|---|---|
| `setModel` | `:444-448` `Validates that auth is configured, saves to session **and settings**.` | `:597-601` `Validates that auth is configured and saves to the session transcript.`<br>`Persists to global defaults **only when options.persist is true**.` |
| `setThinkingLevel` | `:459-463` `Saves to session **and settings** only if the level actually changes.` | `:614-618` `Saves the clamped level to the session transcript only if the level actually changes.`<br>`Persists the requested level to global defaults **only when options.persist is true**.` |

新增类型 `ModelMutationOptions`（0.99.1 `dist/core/agent-session.d.ts:173-176`）：

```ts
export interface ModelMutationOptions {
    /** Persist the new value to global defaults. Defaults to session-only. */
    persist?: boolean;
}
```

**消费侧证据**：

- `lib/rpc/session.ts:430` `await this.inner.setModel(model);`
  —— `set_model` 命令处理分支（`:422-434`）。**未传 `persist`。**
- `lib/rpc/session.ts:483` `this.inner.setThinkingLevel(level);`
  —— `set_thinking_level` 命令处理分支（`:481-492`）。**未传 `persist`。**
- 对照：**启动路径不受影响**。`lib/startup-preferences.ts:50`
  `settingsManager.setDefaultThinkingLevel(effective.thinkingLevel)` + `:53` `await settingsManager.flush()`
  是显式持久化，语义与 SDK 无关。所以 §3.10 的 per-agent runtime 覆盖（走
  `lib/agent-runtime.ts:279` `{ thinkingLevel: member.thinking_level as ThinkingLevel }`
  传给 `caller.ts:115`/`:121`）**依然正确**。
- 受影响的只有**交互式换模型/换思考级别**这两条 RPC 命令的持久化副作用。
- `SettingsManager.setDefaultThinkingLevel(level: ThinkingLevel): void` 签名两版不变（`.d.ts` 逐字相同）。

**层级判定**：**纯运行时语义变化**。类型层是加法（新增可选第 2 参数），
`tsc` 不会报，旧调用合法。

**修法**：`session.ts:430` 改 `setModel(model, { persist: true })`；
`session.ts:483` 改 `setThinkingLevel(level, { persist: true })`。
**但先要决定这个副作用是否还要**——worksplice 已经有 `lib/startup-preferences.ts`
在做显式持久化，两条路都在写全局默认，可能本来就有重复写的问题。属产品决策，不是纯技术改动。

---

### 4.3 B-3 session jsonl 新增 `context_edit` / `usage` 两类条目 —— 类型层破了，但被 cast 掩盖成静默丢数据

**症状**：会话浏览器的 transcript 里**看不到**新的上下文编辑记录；
`lib/session-stats.ts` 的 token / 成本聚合**漏算**新条目携带的 usage。**不报错。**

**供给侧证据**：

- `pi-coding-agent@0.99.1` `package/dist/core/session-manager.d.ts:119-126` 新增
  ```ts
  export interface ContextEditEntry extends SessionEntryBase {
      type: "context_edit";
      targetId: string;
      /** Null omits the target from model context. A value replaces only its content. */
      replacement: { content: ContextEditableContent; } | null;
  }
  ```
- 同文件 `:36-44` 新增
  ```ts
  export interface UsageEntry extends SessionEntryBase {
      type: "usage";
      /** Arbitrary usage category, such as "cache_warm". */
      kind: string; provider: string; model: string; usage: Usage; note?: string;
  }
  ```
- 同文件 `:128` 联合类型已含两者：
  `SessionEntry = SessionMessageEntry | ThinkingLevelChangeEntry | ModelChangeEntry | **UsageEntry** |
  CompactionEntry | BranchSummaryEntry | CustomEntry | CustomMessageEntry | **ContextEditEntry** |
  LabelEntry | SessionInfoEntry`
- 同文件 `:14` 新增导出 `buildSessionProjection`、`:16` `ContextEditableContent`、
  `:21` `ProjectedSessionEntry`、`:28` `SessionProjection`、`:31` `UsageEntry`
  （0.83.0 均无）。
- **0.83.0 对照**：`SessionEntry` 联合的类型字面量集合是
  `session / message / model_change / thinking_level_change / compaction / branch_summary /
  custom / custom_message / label / session_info`（10 个），
  **没有 `usage` 也没有 `context_edit`**。
- 上游 CHANGELOG **显式点名这是 breaking**（`package/CHANGELOG.md:175`，`## [0.87.0]` 段内
  `### Breaking Changes` 小节，第 172 行起）：
  > Added `ContextEditEntry` to the exported `SessionEntry` union. TypeScript consumers with
  > exhaustive entry switches must handle `context_edit`; use `replacement: null` for omission
  > and a content replacement otherwise.

**消费侧证据**：

- `lib/types.ts:265-274` 本地 `SessionEntry` 联合**不含** `ContextEditEntry` / `UsageEntry`：
  ```ts
  export type SessionEntry =
    | SessionMessageEntry | ThinkingLevelChangeEntry | ModelChangeEntry
    | CompactionEntry | BranchSummaryEntry | CustomEntry | CustomMessageEntry
    | LabelEntry | SessionInfoEntry;
  ```
- `lib/session-reader.ts:304-349` 是穷举 `switch`，末尾
  `:347-348` **`default: return null`** ⇒ 两条新条目类型**被静默丢弃**。
- `lib/session-reader.ts:212-218` 用双向 cast 把本地条目转成 SDK 条目传给
  `buildSessionContext`，**这层 cast 正是类型断裂被掩盖的地方**。
- `lib/session-stats.ts:92-103` 的成本聚合只认
  `entry.type === "message"` 与 `"compaction" | "branch_summary"`，**`"usage"` 条目完全不计入**。
- `lib/agent-loop/loop.ts:1529` `if (entry?.type !== "message" || !entry.message) continue;`
  —— backfill 只认 message 条目，新条目不影响补拉正确性（这点是好的）。
- `lib/agent-loop/loop.ts:1401` `entry?.type === "session"` —— 读 header 取 cwd，不受影响。

**层级判定**：**类型层破了（联合新增两个成员）+ 运行时真的会写出这两类条目**
⇒ worksplice 侧表现为**静默数据丢失与统计漏算**，不是编译失败。

**修法**：`session-reader.ts:304` 的 `switch` 增加 `case "context_edit"` 与
`case "usage"`，两个 case 都**显式不渲染**（各自 `return null`）——`context_edit` 记的是
pi 如何裁剪/替换模型上下文，不是任何一方说的话；`usage` 是纯计费记账。渲染进 transcript
只会让会话记录混进非对话事件（人类裁定；PR #58 已按「显式不呈现」落地）。
`session-stats.ts:92` 的分支改用 `addCostOnly` 把 `"usage"` 条目的 `usage` **只加费用**、
**不碰 uncached / cacheRead / total 三个 token 桶**（复用 `addUsage` 会把 `cacheWrite`
折进 uncached 与 total，虚报上下文 token 用量）。
**不需要任何去重逻辑**：PR #48 实测全 SDK 只有 `dist/core/cache-warmer.js:249` 一处调
`appendUsage`，记的是 cache warmer 自己那次独立的 `streamSimple` 请求，而那条 message
从不作为 `message` 条目落进 transcript ⇒ 两个来源在构造上不相交，额外去重只会引入缺陷。
`UsageEntry` 的 `kind` 语义（例：`"cache_warm"`）也已定：只加费用，不计入 token 桶
（PR #57 已落地 `addCostOnly`）。
`lib/types.ts:265` 的本地联合补两个成员。

---

### 4.4 B-4 `agent_settled` 处理器不再重入 —— 纯运行时变化，直接影响 cwd 互斥与状态点

**症状**：不可预测。settle 判定时机后移，同 cwd 的第二个会话要么启动窗口变长、
要么 `busy` 状态提前解除，出现「以为空闲了其实还在跑」或相反。

**供给侧证据**：

- `package/CHANGELOG.md:178`（`## [0.87.0]` → `### Breaking Changes`）：
  > Deferred runs requested from `agent_settled` handlers until all settled handlers finish.
  > Handlers still observe `ctx.isIdle() === true`, but no longer see a reentrant `agent_start`
  > during the same notification dispatch.
- 实现层佐证：`pi-coding-agent@0.99.1` `package/dist/core/agent-session.d.ts` 新增 4 个私有字段
  —— `_isEmittingAgentSettled`、`_deferredSettledActions`、`_isBeforeSettle`、
  `_abortDuringBeforeSettle`；0.83.0 全部没有。
- **0.83.0 对照**：`dist/core/agent-session.d.ts` 只有 `_emitAgentSettled` 一个相关私有方法。

**消费侧证据**（worksplice 有三处独立依赖 settle 语义）：

- `lib/cwd-mutex.ts:136-137`
  ```ts
  export const PROMPT_DONE_EVENTS = new Set(["prompt_done", "agent_end", "agent_settled"]);
  export const SETTLE_EVENTS = new Set([...PROMPT_DONE_EVENTS, "compaction_end", "auto_compaction_end"]);
  ```
- `lib/cwd-mutex.ts:163` `if (SETTLE_EVENTS.has(event.type)) done();`
  —— `waitForSettle` 的**唯一**解除条件。事件语义一变，解除时机就变。
  `agent-settled` 的 settle 判定直接决定同 cwd 第二个会话何时可以启动
  （ADR-0005 的 cwd 互斥）。
- `lib/agent-runtime.ts:41-48` `STATUS_BY_EVENT` 把 `agent_settled` 映射为 `"online"`；
  `lib/agent-runtime.ts:299` 依赖它做「error 保留」判定。
- `lib/rpc/session.ts:73-88` 的 `RUNNING_STATE_EVENT_TYPES` / `IDLE_RESET_EVENT_TYPES`
  两个集合都含 `agent_settled`（`:76`、`:85`），驱动 `resetIdleTimer()` 与 `notifyRunningChange()`。
- `hooks/useAgentSession.ts:1074` `case "agent_settled":` 驱动 UI 的 30 秒宽限窗口。

**层级判定**：**纯运行时行为变化**。事件**名字没变**（`agent_settled` 仍在
`AgentSessionEvent` 联合内 —— 0.99.1 `dist/core/agent-session.d.ts:114` 附近可见，
且 `dist/core/agent-session.js` 仍有 emit 点），**签名没变**，`tsc` 完全不会报。
再加上 3.5 节说的「事件类型是全开放结构」，**双重失明**。

**修法**：本条**没有代码可改**——它需要的是**行为验证**。
必须实跑：连续两轮 prompt、带 auto-retry 的 prompt、带 compaction 的 prompt，
观察 `waitForSettle` 的解除时机与状态点是否漂移。这是第 6 节 spike 的核心用例。
**本报告不给这一条编一个补丁。**

---

### 4.5 B-5 6 个新传递依赖（含一个 WASM 运行时），而 `serverExternalPackages` 没跟上

**症状**：`next dev` / `next build` 阶段可能报模块解析错误，或运行期因 WASM 资源路径
找不到而崩。**不确定**——本票没装包，无法确定（见第 6 节）。

**供给侧证据**（`package/package.json` 的 `dependencies` 逐项对比）：

| 依赖 | 0.83.0 | 0.99.1 / 0.99.2 |
|---|---|---|
| `@earendil-works/pi-agent-core` | `^0.83.0` | `^0.99.1` / `^0.99.2` |
| `@earendil-works/pi-ai` | `^0.83.0` | `^0.99.1` / `^0.99.2` |
| `@earendil-works/pi-tui` | `^0.83.0` | `^0.99.1` / `^0.99.2` |
| `@earendil-works/pi-agent-core` → `@earendil-works/chord` | — | **`^0.99.1`**（新增） |
| `@earendil-works/pi-agent-core` → `@earendil-works/pi-telemetry` | — | **`^0.99.1`**（新增） |
| `@earendil-works/pi-ai` → `@earendil-works/pi-telemetry` | — | **`^0.99.1`**（新增） |
| `@earendil-works/pi-coding-agent` → `@earendil-works/pi-mcp` | — | **`^0.99.1`**（新增） |
| `@earendil-works/pi-coding-agent` → `@earendil-works/pi-codemode` | — | **`^0.99.1`**（新增） |
| `quickjs-wasi` | — | **`3.6.2`**（新增，**WASM 运行时**，codemode 沙箱用） |
| `grok-mermaid` | — | **`0.2.3`**（新增） |
| `glob` | `13.0.6` | **已移除** |
| `chalk` | `5.6.2` | `6.0.0` |
| `undici` | `8.5.0` | `8.10.2` |
| `typebox` | `1.3.7` | `1.3.27` |

`exports` 映射也变了（0.83.0 → 0.99.1）：

- 0.83.0：`{".": {...}, "./rpc-entry": {"import": "./dist/rpc-entry.js"}}`
- 0.99.1：`{".": {...}, "./client": {...}, "./rpc-entry": {"import": "./dist/bundle/rpc-entry.js"},
  "./experimental/plugin": {...}}`
- `bin.pi` 在 **0.84.3**（pin 之后）从 `dist/cli.js` 改为 `dist/bundle/cli.js`。

**关于 `@earendil-works/pi-telemetry` 的核实**（避免误报）：它**不是**上报器。
`npm view` 显示 description 是
`Vendor-neutral telemetry contracts and typed schema utilities for pi`，
MIT，`unpackedSize` 122964 字节 / 26 文件，无任何依赖。
`npm pack` 解包后 `grep -rlE "fetch\(|node:https?|XMLHttpRequest|axios|webhook" package/dist`
**零命中**；其 `README.md` 明写
`no exporter, global current-span state, or dependency on a telemetry backend`，
产物是 `noop.d.ts` + `memory.d.ts` + `testing/`。
⇒ **默认是 no-op，不构成隐私风险**。它首次出现在 **0.87.1**，不是 0.99 独有。

**消费侧证据**：

- `next.config.ts:31-38` `serverExternalPackages` **只列 4 个包**：
  ```ts
  serverExternalPackages: [
    "undici", "better-sqlite3",
    "@earendil-works/pi-coding-agent", "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai", "@earendil-works/pi-tui",
  ],
  ```
  新增的 6 个传递依赖一个都不在里面。
- `next.config.ts:10-16` 构建期直接读
  `node_modules/@earendil-works/pi-coding-agent/package.json` 取 `version` 字段——
  该路径（包根 `package.json`）不受 `dist/` → `dist/bundle/` 重组影响，**这条安全**。
- `package.json:42-54` 无 `overrides` / `resolutions`，无法在新依赖出问题时本地钉版本。
- `bun.lock:8-11` 精确 pin 四个包；升到 0.99.2 时这四行必须同改（2.1 节）。

**层级判定**：**打包 / 供应链面**。既不是纯类型层破，也不是纯运行时破——
它取决于「新依赖是否被 SDK 顶层入口静态 import」。`quickjs-wasi` 是 WASM，
`config.d.ts` 里 0.99.x 新增了 `getQuickJSWasmPath()` / `setEmbeddedQuickJSWasmPath()` /
`resolveCodemodeWorkerSpecifier()` 一组 codemode worker 入口解析函数，
**但这些是否在模块加载期就求值，本票无法从静态检查确定。**

**修法**：先装包跑一次 `npm run build`（不是 `next build` 在 dev 期间，而是 CI 场景），
看 6 个新依赖哪些需要进 `serverExternalPackages`。**这是一个纯 spike 问题**，
本报告不猜答案。

---

### 4.6 B-6 `default` 主题改为 `system`（从终端调色板派生），而 worksplice 在无 TTY 的进程内调 `initTheme()`

**症状**：`initTheme()` 之后 SDK 可能去读终端背景色，在 Next.js server 进程里
等待终端查询超时，或解析出错误的 `ColorMode`。**不确定是否真发生**——本票无法实跑验证。

**供给侧证据**：

- `package/CHANGELOG.md:78`（`## [0.99.0]` → `### Added`）：
  > Added the `system` theme, now the default, which derives pi's colors from the terminal's
  > reported foreground, background, and ANSI palette and rebuilds them when the terminal
  > switches between light and dark.
- `package/CHANGELOG.md:66`（`## [0.99.0]` → `### New Features`）：
  > **System theme** — Pi's colors now come from your terminal's own palette by default.
- `package/CHANGELOG.md:97`（`### Changed`）：
  > Removed the `[Themes]` section from the startup banner.
- `package/CHANGELOG.md:99`：`Changed the built-in dark and light themes to the revised pi colors, written in OKHSL.`
- 实现层佐证：`pi-coding-agent@0.99.1` `package/dist/core/resource-loader.js:3` 新增 import
  `detectCapabilities, getTerminalColorMode` from `@earendil-works/pi-tui`；
  同文件 `:675` `const colorMode = getTerminalColorMode({...})`。
- **`Theme` 类型也变了**（`dist/modes/interactive/theme/theme.d.ts`）：
  | | 0.83.0 | 0.99.1 |
  |---|---|---|
  | 构造第 1 参数 | `Record<ThemeColor, string \| number>` | `Record<Exclude<ThemeColor, OptionalThemeColor>, ...> & Partial<Record<OptionalThemeColor, ...>>` |
  | 构造第 3 参数 | `mode: ColorMode` | `mode: **TerminalColorMode**` |
  | 新增成员 | — | `:64` `get appearance(): ThemeAppearance`、`:70` `get colors()`、`:71` `style(text, options: ThemeStyle)` |
  | 文件行数 | 119 | 157 |
  - `ColorMode` 在 0.99.1 已不存在；其值域被 `pi-tui@0.99.1`
    `dist/*.d.ts` 的 `export type TerminalColorMode = "256color" | "truecolor"` 接替
    （**值域不变**）。

**消费侧证据**：

- `lib/rpc/caller.ts:71` **`initTheme();`** —— 无参数，在 `startRpcSession()` 里同步调用。
- `lib/rpc/session.ts:98-121` `class PlainTextTheme extends Theme`，`:104` 传位置参数
  `"truecolor"`，`:102-103` 用 `ConstructorParameters<typeof Theme>[0] / [1]` 做 cast。
  → **类型层安全**：`TerminalColorMode` 值域含 `"truecolor"`，且那两个 `ConstructorParameters`
  cast 会自动跟随新签名。**`tsc` 不会报。**
- `lib/rpc/session.ts:813` `factory(tui, PLAIN_TEXT_THEME, CUSTOM_UI_KEYBINDINGS, done)`
  —— extensions 拿到的始终是 worksplice 自己的 `PlainTextTheme`，**不受默认主题变更影响**。
- `lib/rpc/session.ts:124` `new TuiKeybindingsManager(TUI_KEYBINDINGS)` ——
  两个符号在 0.99.1 的 `dist/index.d.ts:22` 与 `dist/keybindings.d.ts:62/256` **仍在**
  （keybindings.d.ts 从 176 行涨到 256 行，导出名未变）。

**层级判定**：**运行时行为变化（可能）+ 类型层安全**。
`initTheme()` 的默认主题从内置 `dark`/`light` 变成需要终端能力的 `system`。
在无 TTY 的 Next.js server 进程里这**大概率是无害降级**（拿不到终端色 → 走 fallback），
但**本票无法证明无害**，因为 fallback 的具体取值需要实跑。

**修法**：**不改代码**。在 spike 里比对 `initTheme()` 前后的 `PLAIN_TEXT_THEME` 行为
与 extensions 渲染结果即可。若 `initTheme()` 在无 TTY 环境变慢或抛错，
再考虑改传显式主题名（`initTheme(themeName?: string, enableWatcher?: boolean): void`
签名两版不变，`lib/rpc/caller.ts:71` 只需加一个参数）。

---

### 4.7 已核实为**不成立**的候选 breaking change（列出以防下轮重踩）

以下 9 条在初筛时都像 breaking change，逐条核实后**确认不构成对 worksplice 的破坏**。
按 spec 要求，它们**不留在第 4 节**，只在此处记录核实结论与降级理由。

| # | 候选 | 降级理由（核实结论） |
|---|---|---|
| X-1 | `auto_retry_end` 事件被移除 | **证伪。** 初看 `diff -u` 出现 `- type: "auto_retry_end"` 像是删除，实为**在联合内换了位置**。0.99.1 `dist/core/agent-session.d.ts:85` 仍在联合内；`dist/core/agent-session.js:756 / 1370 / 2939` 仍有 emit 点。消费侧 `hooks/useAgentSession.ts:1194` `case "auto_retry_end":` **继续有效** |
| X-2 | `shouldStopAfterTurn` agent option 被移除（`CHANGELOG.md:174`） | **无消费侧 call site**。`grep -rn "shouldStopAfterTurn\|finishTurn"` 在全仓（除 node_modules）**零命中** |
| X-3 | `SessionManager` 成为 provider context 唯一来源、不再能赋值 `session.agent.state.messages`（`CHANGELOG.md:176`） | **无消费侧 call site**。全仓唯一触碰 `AgentState.messages` 的是 `lib/session-title.ts:139 / 215 / 222 / 225`，但它们操作的是 `options.initialState!.messages`（构造参数）并在 `:228` `new Agent(options)` 起一个**全新的影子 `Agent`**，从不写活跃 session 的 `agent.state.messages`。命中该禁令的只有测试文件 `lib/session-title.test.mjs:80` |
| X-4 | `TurnEndEvent` 扩张 + `ExtensionRunner.emit()` 不再接受 `turn_end`（`CHANGELOG.md:177`） | **不适用。** 被禁的是 `turn_end`。worksplice 只 emit `session_shutdown`：消费侧 `lib/pi-types.ts:73` `emit?(event: { type: "session_shutdown"; reason: "quit" })` + `lib/rpc/session.ts:693`。`type: "session_shutdown"` 在 0.83.0 与 0.99.1 的 `dist/` 里**都存在** |
| X-5 | 内置工具名改为 `builtin:<name>`（`CHANGELOG.md:103`） | **不适用。** 该条原文限定为 `in errors, diagnostics, RPC source info, and bug reports`。实测 `pi-coding-agent@0.99.1` `dist/core/agent-session.js:1054-1056` 的 `getAllTools()` 返回 `name: definition.name`，**未加前缀**；`getActiveToolNames()`（`:1044-1046`）同理。消费侧 `lib/tool-presets.ts:10-12`、`lib/rpc/session.ts:96` 的硬编码工具名表**不受影响** |
| X-6 | `AgentOptions.initialState` 类型从内联改为 `AgentInitialState` | **同结构别名。** `pi-agent-core@0.99.1` `dist/agent.d.ts:5`<br>`export type AgentInitialState = Partial<Omit<AgentState, "pendingToolCalls" \| "isStreaming" \| "streamingMessage" \| "errorMessage">>;`<br>与 0.83.0 `dist/agent.d.ts:6` 的内联类型**逐字相同**。消费侧 `lib/session-title.ts:49-55` 不破 |
| X-7 | 上游构建切到 TypeScript 7.0 / ES2024（`CHANGELOG.md:56`），可能产出 TS5 读不懂的 `.d.ts` | **未发现不兼容语法。** 对 0.99.1 `dist/core/*.d.ts` 扫 `<const ` / `satisfies` / `NoInfer` / `accessor ` 全部 **0 命中**；`using ` 的 3 处命中全在 JSDoc 注释里（`bash-executor.d.ts:28`、`resolve-config-value.d.ts:19/24`、`sdk.d.ts:15`）。消费侧 `package.json:79` `"typescript": "^5"` 安全 |
| X-8 | `pi-ai` 新增子路径 `./models`、改名 `ModelsStreamTransforms` → `ModelsRequestTransforms`、删除 `ProviderModelsStore`、`RefreshModelsContext.store` → `publish()` | **无消费侧 call site**。逐个 grep 全仓（除 node_modules）全部零命中。worksplice 从 `pi-ai` 只用 7 个符号：`Api`、`Model`（`lib/model-scope.ts:7`）、`Credential`（`lib/provider-credential-store.ts:3`）、`AuthEvent`/`AuthPrompt`（`app/api/auth/login/[provider]/route.ts:1`）、`getSupportedThinkingLevels`（`app/api/models/route.ts:4`）、`completeSimple`/`AssistantMessage`（`app/api/models-config/test/route.ts:5`）。另：`pi-ai` 的 `./compat` 子路径**三版都在**（0.99.2 还多了 `./models`），消费侧 `app/api/models-config/test/route.ts:5` 的 `@earendil-works/pi-ai/compat` 安全 |
| X-9 | `pi-coding-agent` 的 `bin` / `./rpc-entry` 迁到 `dist/bundle/`，以及 HTML 导出模板新增 show/hide 开关（`CHANGELOG.md:48`） | **实测锚点全部命中。** ① `package/dist/core/export-html/index.js` 在 0.83.0 / 0.99.1 / 0.99.2 **都存在**，消费侧 `app/api/sessions/[id]/export/route.ts:236` 的硬编码深路径安全。② 消费侧 `route.ts:130-138` 的 `replaceRequired` 在匹配数 ≠ 1 时**抛错**（失败模式响亮，不会静默）。把它的三个锚点（`sortChildren` / `mapNodes` / `markActive`，`route.ts:143 / 166 / 184`）对着三个版本的 `dist/core/export-html/template.js` 实测：**9/9 全部恰好 1 次命中**。③ `template.html` 与 `index.js` 在 0.83.0→0.99.1 之间**字节级零差异**；只有 `template.js` 变了（76742 → 80260 字节，87 行差异），且都不在三个锚点附近 |

**已核实为「全绿」的 SDK 面**（供 spike 省时间，不必重复核对）：

- worksplice 从 `pi-coding-agent` 用到的 **26 个具名导入，全部仍在 0.99.1 的 `dist/index.d.ts` 中**
- `AgentSessionLike`（`lib/pi-types.ts:117-169`）的 **39 个成员，在 0.99.1
  `dist/core/agent-session.d.ts` 里一个都没少**（逐个 grep 核对）
- `SessionStats` 接口逐字未变；`getSessionStats()` / `navigateTree()` / `executeBash()` /
  `setActiveToolsByName()` / `getContextUsage()` / `abortCompaction()` / `clearQueue()` 签名未变
- `ThinkingLevel` 联合类型三版逐字相同（`"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"`）
  ⇒ `app/api/agent/new/route.ts:9` 的硬编码 `THINKING_LEVELS` 安全
- `SessionManager.open/create/getEntries/getCwd/getSessionName/getBranch/createBranchedSession`
  签名未变；`listAll` 仅新增可选第 2/3 参数 `signal?: AbortSignal`
- `SettingsManager.create/getEnabledModels/getDefaultProvider/getDefaultModel/setDefaultThinkingLevel/setProjectTrusted`
  签名未变
- `ModelRuntime.create/getModels/getProviders/getProviderAuthStatus/getModel` 签名未变；
  `login` / `logout` / `listCredentials` 仅新增可选 `options` 参数
- `DefaultResourceLoader` / `DefaultPackageManager` / `ProjectTrustStore` /
  `hasTrustRequiringProjectResources` / `getAgentDir()` / `initTheme()` / `parseFrontmatter` /
  `getPackageDir()` / `exportFromFile()` / `buildSessionContext()` / `buildContextEntries()` 全部未变
- `engines.node >= 22.19.0` 三版不变（消费侧 `package.json:14-16` 要求 `>=22.19.0`，仍满足）
- `pi-coding-agent` 的 `dist/*.d.ts` 文件集：**删除 2 个**（`bun/register-bedrock.d.ts`、
  `utils/clipboard-native.d.ts`，两者在 0.99.1 的 `dist/index.d.ts` 里**均无引用**，不可达）、
  **新增 66 个**

---

## 5. 与既有决策的冲突

### 5.1 ADR-0007 逐条核对（`docs/adr/0007-sdk-delegation-boundary.md`，Status: accepted）

该 ADR 正文写死了 `@earendil-works/pi-coding-agent@0.83.0`，并基于该版本的具体 API 能力
做了 5 条决策。逐条核对如下。

#### 决策 1：`AgentSessionWrapper` 四模块保留、职责收窄 —— **仍成立，但有一处表述与现状不符**

ADR 原文要点：`caller` 保留 `createAgentSessionServices → resolveVisibleModels →
createAgentSessionFromServices` 二段式（含 `trustReloadOptions`/`withExtensionTools`）；
`SDK SessionManager.listAll` 不替代 registry 记账（SDK 无 `BusyCwdError`）。

- **升到 0.99.2 后仍成立。** `createAgentSessionServices` 只**新增**可选
  `modelRuntimeSignal?: AbortSignal`（0.99.1 `dist/core/agent-session-services.d.ts:32`），
  `createAgentSessionFromServices` 与 `resolveVisibleModels` 未动。
- 「SDK 无 `BusyCwdError`」这一前提**仍然成立**——本仓的 `BusyCwdError` 是自研的，
  在 `lib/rpc/registry.ts` / `lib/cwd-mutex.ts` 里，0.99.x 没有引入同名概念。
- **ADR 需要跟着改的一处**：ADR 第 6 行写
  「`subscriber/broadcaster` 合为 `lib/rpc/events.ts` 窄面」，
  但 `lib/rpc/events.ts` **至今不存在**（`ls lib/rpc/events.ts` → No such file），
  `lib/rpc/` 下仍是 `subscriber.ts`(61 行) 与 `broadcaster.ts`(58 行) 两个文件，
  且都在 `lib/rpc/index.ts:30-37` 的公共 API 面里各自导出。
  **这不是升级造成的偏差，是 ADR 描述的收敛从未落地。**
  升级不改变这个事实，但既然要改 ADR 的版本号，顺手把它对齐是合理的。

#### 决策 2：`model-scope` 委托 SDK、thin adapter 保留 —— **完全成立，且更强了**

ADR 原文要点：`lib/model-scope.ts:71` 委托 `resolveModelScopeWithDiagnostics(patterns, runtime)`，
`thinkingLevelPins` 随 `ScopedModel.thinkingLevel` 回传不自算。

- **成立。** 锚点行号仍然准：`lib/model-scope.ts:71`
  `const { scopedModels, diagnostics } = await resolveModelScopeWithDiagnostics(cleaned, modelRuntime);`
- 上游签名只**新增**可选第 3 参数
  `options?: AuthOperationOptions`（0.99.1 `dist/core/model-resolver.d.ts:64`），
  `ScopedModel`（`:9-13`）逐字未变。
- **ADR 无需改动。**

#### 决策 3：`models.json`/skills/plugins 存储委托 SDK —— **部分与现状不符（升级无关）**

ADR 原文要点：`models.json` 经 `SettingsManager` `withLock` 读写 + `invalidateModelsCache`；
`skills` 经 `DefaultResourceLoader.reload`；`plugins` 经 `DefaultPackageManager`。

- **`skills` 与 `plugins` 两半完全成立。** `lib/skills-service.ts:8-10` 的
  `new DefaultResourceLoader({cwd, agentDir})` → `loader.reload(...)` → `loader.getSkills()`
  路径在 0.99.2 下签名未变；`app/api/plugins/route.ts:210` / `:332` 的
  `new DefaultPackageManager({...})` 亦然。
- **`models.json` 那一半与现状不符**（**升级无关，是既有的文档漂移**）：
  消费侧 `app/api/models-config/route.ts:24-29` 的 `writeModelsJson()` 用的是
  本仓自研的 `writePrivateFileAtomicSync`，**没有用 `SettingsManager.withLock`**。
  `SettingsManager.withLock` 在两版 SDK 里都存在，但本仓全仓零调用点。
  同理 `invalidateModelsCache` 是 `lib/models-cache.ts:38` 的自有函数，**不是 SDK 导出**。
- **sunset 条件未被触发**：ADR 写「`PATCH /api/skills disable-model-invocation` 的
  `SKILL.md` frontmatter 手术短期保留，`sunset 条件：待 SDK 提供 updateSkill() 后移除`」。
  0.99.2 **仍未提供 `updateSkill()`**（`dist/` 全量搜索无此符号），
  所以 `app/api/skills/route.ts:56-58` 用 `parseFrontmatter` 做的**字符串级手术必须保留**。
  `parseFrontmatter` 签名两版不变，此处安全。
- **ADR 需要跟着改的一处**：把 `models.json` 的描述从「经 `SettingsManager` `withLock` 读写」
  改成实际实现的「本仓自研原子写 + 显式 `invalidateModelsCache`」。

#### 决策 4：per-agent runtime 保留、工厂透传 —— **成立，但依赖一条已被 B-2 改掉的语义**

ADR 原文要点：`startSession` 二段式透传 `model/thinkingLevel/scopedModels` 至
`createAgentSessionFromServices`（**不二次 `setModel`**）。

- **成立。** 消费侧 `lib/rpc/caller.ts:117-124` 确实只在工厂里传，不调 `setModel`。
  上游 `createAgentSessionFromServices` 签名未变。
- **但它踩在 B-2 上**：ADR「不二次 `setModel`」这个选择的**前提**是
  「模型/thinking 的持久化由 `startup-preferences` 显式负责」（`lib/startup-preferences.ts:50`），
  这条仍然成立。可一旦有人为了修 B-2 而在 `session.ts:430` 加 `{ persist: true }`，
  就会出现「启动路径写一次、交互路径再写一次」的双写。**ADR 第 4 条需要补一句
  「持久化职责唯一归属 `startup-preferences`」**，否则 B-2 的修法会引入新的歧义。
- `SettingsManager.setDefaultThinkingLevel(level: ThinkingLevel): void` 签名两版不变。

#### 决策 5：`tool-presets.ts` 三档保留为 UX 快捷、去硬编码 —— **决策本身仍成立，但从未落地**

ADR 原文要点：`PRESET_NONE/DEFAULT/FULL` **不再持有工具名硬编码**，
`getToolNamesForPreset()` 改为 `getAllTools()` 子集过滤。

- **上游侧仍成立**：`getAllTools()` / `getActiveToolNames()` 在 0.99.2 签名未变，
  且 `getAllTools()` 返回值**变丰富了**（0.99.1 `dist/core/agent-session.js:1054-1064`
  现在还返回 `parameters` / `promptGuidelines` / `exposure` / `namespace` / `annotations` /
  `sourceInfo`），做子集过滤比 0.83.0 时更可行。
- **但本仓从未实现这条决策**（**升级无关的既有偏差**）：
  `lib/tool-presets.ts:10-12` 至今是硬编码
  ```ts
  export const PRESET_DEFAULT: string[] = ["read", "bash", "edit", "write"];
  export const PRESET_FULL: string[] = ["bash", "read", "edit", "write", "grep", "find", "ls"];
  ```
  `lib/rpc/session.ts:96` 另有一份重复的 `CODING_TOOL_NAMES`（同样的 7 个名字）。
  `getToolNamesForPreset()`（`:31-35`）返回的是硬编码常量，不是 `getAllTools()` 的子集过滤。
- **对升级的影响**：目前**没有**影响，因为 X-5 已核实 `getAllTools()` 的名字未加 `builtin:` 前缀。
  但这是一枚埋着的雷——若上游将来把前缀推广到 `getAllTools()`，这两处硬编码会**静默失效**
  （工具全部关闭，没有任何报错）。
- **ADR 需要跟着改的一处**：要么标注这条决策「已 decided、未 implemented」，
  要么把它并进升级票一起做（成本很低，见第 6 节第 3 步）。

#### 小结

**ADR-0007 的 5 条决策，升到 0.99.2 后全部仍然成立**（决策 2 完全成立，
决策 1/3/4/5 成立但各有表述需对齐）。**但有 3 处 ADR 描述与仓库现状不符**，
且这 3 处**都与升级无关**，是既存的文档漂移：

| ADR 表述 | 仓库现状 |
|---|---|
| 第 6 行：`subscriber/broadcaster` 合为 `lib/rpc/events.ts` | `lib/rpc/events.ts` 不存在，两文件仍在 |
| 第 8 行：`models.json` 经 `SettingsManager` `withLock` 读写 | 用的是本仓 `writePrivateFileAtomicSync`，`withLock` 零调用 |
| 第 10 行：`tool-presets.ts` 不再持有工具名硬编码 | 仍是硬编码，且在两处重复 |

另需一处**因 B-2 而新增**的澄清：模型/thinking 持久化的唯一归属。

### 5.2 `docs/spec.md` 的锁定条目

| spec 位置 | 条目 | 与升级的关系 |
|---|---|---|
| **§7.3「保留不动的 pi SDK 接口面」[锁定] 06** | 「`@earendil-works/pi-*` 依赖（agent-core / ai / coding-agent / tui）」 | **不冲突**。四个包名不变，`engines.node >= 22.19.0` 不变，`repository.url` 不变，`pi-ai` 的 `./compat` 子路径不变。**升级本身不动这一条。** |
| **§5.3「pi 升级改变 session 格式不影响 raft 数据」[锁定] 05** | 「raft 消息表是房间事实唯一来源；pi session 只承载认知过程」 | **这条被 B-3 直接命中，且结论是「前半句成立、后半句有裂缝」。** raft 侧确实不受影响（`lib/domain/raft/` 全域不 import SDK）。但「pi session 只承载认知过程」这个分工，在 `context_edit` / `usage` 出现后需要重述：session 文件现在**也承载上下文编辑语义**（`ContextEditEntry.targetId` + `replacement`），而 worksplice 的 `lib/session-reader.ts:347` 会把它丢掉。⇒ **需要在升级票里补一条 `lib/session-reader.ts` 的 `case`，否则 spec §5.3 的锁定意图在实现层被违反**（数据没丢进 raft，但也没被读出来） |
| **§5.2「pi 多实例与 AgentSession 生命周期」[锁定] 01** | 「恢复：`SessionManager.open(file)` 按需重建」；「同一 cwd 同时仅一个活跃会话（沿用 `hasBusyRpcSessionForCwd` 显式拒绝）」；「`PI_CODING_AGENT_DIR` 整体隔离为后续增强（进程级单例限制，同进程混用多份 agent 目录需 SDK 参数覆盖，首版不做）」 | **前两条不冲突**（`SessionManager.open/create` 签名未变）。第三条的「进程级单例限制」前提**未变但也未验证**——`getAgentDir()` 无参签名两版不变，但 `SettingsManager.create(cwd, agentDir, options)` 的 `SettingsManagerCreateOptions` 在 0.99.2 变大了（`dist/core/settings-manager.d.ts` 296 → 376 行），里面是否新增了与 agentDir 隔离相关的项，本票未逐字段核对。**标为「未经一手核实」**，留给 spike |
| **§7.3「`PI_*` 环境变量」[锁定] 06** | 「`PI_CODING_AGENT_DIR`、`PI_CODING_AGENT_SESSION_DIR` 等」 | **未冲突但未核实。** 本票没有核对 0.99.x 是否增删了 `PI_*` 变量。**标为「未经一手核实」** |
| **§5.8「pi-web 改造策略」[锁定] 04** | 「整体保留复用（lib/API）：lib/rpc、session-reader、…、skills-service、project-trust」 | **不冲突**。这批文件都在第 3 节的盘点里，结论是「类型层全绿 + 3 条运行时洞」 |
| **§7.2 品牌脱钩清单 [锁定] 06** + ADR-0010 | 「`README.md` 的致谢小节」 | **不冲突，且被 2.3 加强。** metadata 的 `repository.url` 三版不变 = `https://github.com/earendil-works/pi`，与 `README.md:5` / `README.md:166` 现值一致，**无需因升级而改 README** |

### 5.3 `AGENTS.md` / `CONTEXT.md` 的术语一致性

本报告按仓库既有语言写。核对结果：

- **术语沿用一致**：`ADR-0007` 用的「SDK 委托边界」「二段式」「窄面」「thin adapter」
  在本报告第 3、5 节沿用；`CONTEXT.md:111-117` 定义的 `SDK 委托边界` 词条
  （含 `_Avoid_: SDK 边界（泛指）、中层收敛（未指明归属）`）本报告未违反。
- **两处既有行号锚点已漂移**（**与升级无关**，但既然要改文档可顺手修）：
  - `CONTEXT.md:116` 引 `lib/rpc/session.ts:55-65` 说「`AgentSessionWrapper` 的封装厚度约束」，
    但该行号区间现在是 `ExtensionUiRequest` / `ExtensionCommandContextActionsLike` 的类型定义
    （`:55-66`），wrapper 的构造在 `:162`。
  - `AGENTS.md` 的文件地图把 `lib/rpc/` 描述为
    「`subscriber.ts` + `broadcaster.ts`」并提到 `lib/rpc/events.ts`「运行状态订阅/广播」——
    与 ADR-0007 一样，`events.ts` 不存在（实际是 `subscriber.ts` + `broadcaster.ts`）。

---

## 6. 建议的升级路径

**分 4 步。核心判断：绝大部分改动集中在少数几个 call site，且真正的风险集中在
「装包后第一次跑起来」那个瞬间，而不是 diff 的行数。**

### 第 0 步（前置，非改动）：立一个 spike 票

**本报告明确回答不了三个问题，因为它们只能靠实际装包 + 实跑来回答：**

1. **B-4 的打包面**：6 个新传递依赖（尤其 `quickjs-wasi` 这个 WASM）是否需要进
   `next.config.ts:31-38` 的 `serverExternalPackages`？
2. **B-1 的正确修法**：空 systemPrompt 应该改成「追加一条空 system message」
   （上游给的新通道）还是「不再覆盖」？两者行为不同，只能实跑比对。
3. **B-3 的去重口径**：`UsageEntry.usage` 与 `message.usage` 是否会双算？
   `kind: "cache_warm"` 这类条目该不该进面向用户的成本看板？

**这三个问题使得「不实际装一次就答不出来」这句话在本票成立。**
但按 spec 要求，本票**不扩成 spike**——第 4 节已把能答的都答完了。
**后续票**：spike 票只需做「装 0.99.2 + 跑 `npm test` + 跑三个场景」，
不产出生产代码。

### 第 1 步：四包同改的 pin（**原子，不可拆**）

`package.json:43-46` 四行同时改 `0.83.0` → `0.99.2`，`bun.lock:8-11` 同步更新。

**为什么不能拆**：0.99.x 的内部依赖声明是 `^0.99.2`，在 0.x 上 caret 语义是
`>=0.99.2 <0.100.0`。只改一个包，另外三个还 pin 在 0.83.0 的话，
`^0.99.2` 根本满足不了，依赖树直接不可解。

**验收**：`bun install` 无 conflict；`node -e "console.log(require('@earendil-works/pi-coding-agent/package.json').version)"` 打印 `0.99.2`；
`next.config.ts:10-16` 的 `piVersion` 显示 `0.99.2`。

### 第 2 步：跑类型检查，把 39 个镜像成员对齐（**与第 1 步同一步**）

装包后**第一件事**是 `node_modules/.bin/tsc --noEmit`，而不是改代码。
理由：`lib/pi-types.ts` 的结构化镜像会在构造点（`lib/rpc/caller.ts:149`）
与真实 SDK 类型对撞，`tsc` 会**在这里**报出镜像与 SDK 的每一处不一致。
一次跑完，把差异批量修掉，比一条条 grep 高效。

**预期 `tsc` 会报的**（本报告已预判）：主要是 `lib/pi-types.ts` 里那些
**过窄**的镜像成员（例如 `lib/pi-types.ts:31-49` 的 `SessionStatsInfo` 与真实
`SessionStats` 的偏差、`ToolInfo` 现在少返回了 5 个字段但结构兼容所以不会报）。
`AgentSessionLike` 的 39 个成员已核实全部存在，所以**这一层的报错预计很少**。

**验收**：`tsc --noEmit` 零错误。

### 第 3 步：修 B-1 与 B-2（**必须在同一步**）

这两条改的是同一个文件（`lib/rpc/session.ts`）的两处相邻逻辑，且共享同一个待决策问题：
**模型/thinking 与 systemPrompt 的状态该由谁写**。拆开做会得到两个都不自洽的中间态。

- **B-1**：`lib/rpc/session.ts:290-293` `applyForcedEmptySystemPrompt()` 去掉
  `agent.state.systemPrompt = ""` 赋值，按 spike 结论改成追加空 system message，或删除该覆盖。
  同时**把 `lib/pi-types.ts:131` 的 `systemPrompt` 标成 `readonly`** ——
  这一步是防止同类问题再次被镜像掩盖的**结构性修复**，比修 B-1 本身更重要。
- **B-2**：`lib/rpc/session.ts:430` 与 `:483` 决定是否补 `{ persist: true }`。
  补之前必须先按 5.1 决策 4 的建议，在 ADR 里把「持久化职责唯一归属
  `startup-preferences`」写清楚，否则会双写。

**顺带做**（成本极低、降低未来风险，且是 ADR-0007 决策 5 一直欠的账）：
`lib/tool-presets.ts` 与 `lib/rpc/session.ts:96` 的两处硬编码工具名收敛成一处，
并改成从 `getAllTools()` 派生（0.99.x 的 `getAllTools()` 返回值更丰富，做这件事更容易）。

**验收**：`PRESET_NONE` 启动的会话不再抛 `TypeError`；
`POST /api/agent/new` 的 `toolNames: []` 路径可跑通；
UI 换模型/换思考级别后重启仍保持。

### 第 4 步：修 B-3 与补文档（可与第 3 步并行，但要在第 2 步之后）

- `lib/types.ts:265-274` 补 `ContextEditEntry` / `UsageEntry` 两个成员；
- `lib/session-reader.ts:304-349` 的 `switch` 补两个 `case`（现在是 `default: return null` 静默丢弃）；
- `lib/session-stats.ts:92-103` 补 `"usage"` 分支，并处理与 `message.usage` 的去重；
- 改 `docs/adr/0007-sdk-delegation-boundary.md`：版本号 `0.83.0` → `0.99.2`，
  并按 5.1 的表对齐 3 处表述漂移 + 补 1 处持久化归属澄清（**只指出，本票不改**）；
- 视 B-4 的 spike 结论调整 `next.config.ts:31-38`。

**验收**：`npm test` 全绿（`lib/session-reader.test.mjs` 有 11 处 `buildSessionContext` 断言，
是 B-3 的天然回归网）；会话浏览器能显示新条目类型；成本看板数字与 SDK 口径一致。

### 步骤间不可拆的原子单元

| 原子单元 | 成员 |
|---|---|
| **四包 pin** | `package.json:43-46` 四行 + `bun.lock:8-11` 四行 —— 缺一不可解 |
| **B-1 的代码 + 镜像收紧** | `lib/rpc/session.ts:290-293` **必须**与 `lib/pi-types.ts:131` 同改；只改前者，下次同类写入会再次静默失败 |
| **B-2 的两个 call site** | `lib/rpc/session.ts:430` 与 `:483` —— 两处语义对称，漏一处就是「换模型不持久、换思考级别持久」的不一致 |

### 本票**不**跑的门禁（刻意）

本票源码改动面为空（唯一交付物是这份文档），按 §6 门禁路由**不过 G-impl**：
`npm test` / `tsc --noEmit` / `npm run lint` / 双轴 code-review 全部不适用
——前三个没有被测对象，后一个审的是 diff 而本票的 diff 是一份文档。
若某条结论**需要** code-review 才敢下，那说明范围判断错了；
本报告里唯一接近这条线的地方是第 5 节对 ADR-0007 三处表述漂移的指认，
但那是「指出」而非「改 ADR」，不构成需要双轴审的代码改动。

---

## 7. 证据索引

### 7.1 上游一手来源

**registry metadata**（`npm view @earendil-works/pi-coding-agent@<ver> --json`，
并解开 tarball 读 `package/package.json` 交叉复核）：

| 结论 | 出处 |
|---|---|
| 发布版本表与日期（13/14 个版本、5 条 minor 线、0.88–0.98 断层、7 天间隔） | `npm view @earendil-works/pi-coding-agent time --json` 完整 `time` map |
| `repository.url` / `homepage` / `description` / `engines` / `license` 三版逐字相同 | 同上 `repository`、`homepage`、`engines`、`license` 字段 + tarball 内 `package/package.json` |
| `dist-tags.latest` = `0.99.2` | `npm view ... dist-tags` |
| `dependencies` 增删（含 6 个新传递依赖、`glob` 移除） | `pi-coding-agent@0.99.1` tarball 内 `package/package.json`；0.83.0 同路径对比 |
| `exports` 新增 `./client` / `./experimental/plugin`；`./rpc-entry` 移到 `dist/bundle/`；`bin.pi` 移到 `dist/bundle/cli.js`（0.84.3 起） | 同上 |
| `pi-ai` 的 `./compat` 三版都在；0.99.2 新增 `./models` | `pi-ai@{0.83.0,0.99.1,0.99.2}` tarball 内 `package/package.json` 的 `exports` |
| `pi-telemetry` 是 no-op 契约包（无网络代码） | `npm view @earendil-works/pi-telemetry --json`（description / unpackedSize=122964 / fileCount=26）+ `npm pack` 解包后 `dist/` 内 `fetch(`/`node:http`/`axios`/`webhook` **零命中** + 其 `README.md` 的 `no exporter...` |

**tarball 内文件路径**（`package/` 为 tarball 根，下同）：

| 结论 | 出处 |
|---|---|
| `AgentState.systemPrompt` 变只读 | `pi-agent-core@0.99.1` `dist/types.d.ts:336`（`readonly`）vs `0.83.0` `dist/types.d.ts:285`；运行时 `pi-agent-core@0.99.1` `dist/agent.js:36-39`（getter-only）vs `0.83.0` `dist/agent.js:30`（数据属性）；system message 语义 `0.99.1` `dist/agent.js:33-35` |
| `AgentInitialState` 是同结构别名 | `pi-agent-core@0.99.1` `dist/agent.d.ts:5` vs `0.83.0` `dist/agent.d.ts:6` |
| `AgentOptions` 新增 `finishTurn` / `prepareRequest` / `onProviderStreamEvent` | `pi-agent-core@0.99.1` `dist/agent.d.ts:15-19` vs `0.83.0` `dist/agent.d.ts:13-15` |
| `setModel` / `setThinkingLevel` 持久化语义变化 + `ModelMutationOptions` | `pi-coding-agent@0.99.1` `dist/core/agent-session.d.ts:597-601` 与 `:614-618`（JSDoc）vs `0.83.0` `:444-448` 与 `:459-463`；`ModelMutationOptions` 定义在 `0.99.1` `:173-176` |
| `agent_settled` 延迟派发 + 新增 4 个私有字段 | `pi-coding-agent@0.99.2` `CHANGELOG.md:178`；`pi-coding-agent@0.99.1` `dist/core/agent-session.d.ts` 的 `_isEmittingAgentSettled` / `_deferredSettledActions` / `_isBeforeSettle` / `_abortDuringBeforeSettle` |
| `ContextEditEntry` / `UsageEntry` 新增进 `SessionEntry` 联合 | `pi-coding-agent@0.99.1` `dist/core/session-manager.d.ts:119-126`、`:36-44`、`:128`；另 `:14` `buildSessionProjection`、`:16` `ContextEditableContent`、`:21` `ProjectedSessionEntry`、`:28` `SessionProjection` |
| 上游显式声明该条为 breaking | `pi-coding-agent@0.99.2` `CHANGELOG.md:175`（`## [0.87.0]` → `### Breaking Changes`，小节起于 `:172`） |
| `auto_retry_end` 未被移除（X-1 证伪） | `pi-coding-agent@0.99.1` `dist/core/agent-session.d.ts:85`（仍在联合内）+ `dist/core/agent-session.js:756/1370/2939`（仍有 emit 点） |
| `resolveModelScopeWithDiagnostics` 新增可选第 3 参数；`ScopedModel` 未变 | `pi-coding-agent@0.99.1` `dist/core/model-resolver.d.ts:64`、`:9-13` |
| `createAgentSessionServices` 新增可选 `modelRuntimeSignal` | `pi-coding-agent@0.99.1` `dist/core/agent-session-services.d.ts:32` |
| `SessionManager.listAll` 新增可选 `signal` | `pi-coding-agent@0.99.1` `dist/core/session-manager.d.ts` 的两个 `static listAll` 重载 |
| `ModelRuntime.login/logout/listCredentials` 新增可选 `options` | `pi-coding-agent@0.99.1` `dist/core/model-runtime.d.ts` |
| `getAllTools()` 返回**未加前缀**的 `definition.name`（X-5 证伪） | `pi-coding-agent@0.99.1` `dist/core/agent-session.js:1054-1056`；`getActiveToolNames()` 在 `:1044-1046` |
| `type: "session_shutdown"` 仍在 `ExtensionEvent` 内（X-4 证伪） | `pi-coding-agent@{0.83.0,0.99.1}` `dist/` 内 grep 均有命中 |
| `Theme` 构造签名 + `TerminalColorMode` + 新增 `appearance`/`colors`/`style` | `pi-coding-agent@0.99.1` `dist/modes/interactive/theme/theme.d.ts:52`（构造）、`:64`、`:70`、`:71`、`:83`；0.83.0 同文件仅 119 行、0.99.1 为 157 行；`TerminalColorMode = "256color" \| "truecolor"` 在 `pi-tui@0.99.1` `dist/*.d.ts` |
| 默认主题改为 `system`（终端调色板派生） | `pi-coding-agent@0.99.2` `CHANGELOG.md:66`、`:78`；实现 `pi-coding-agent@0.99.1` `dist/core/resource-loader.js:3`、`:675` |
| `bin`/`rpc-entry` 迁 `dist/bundle/`；`exports` 新增子路径 | `pi-coding-agent@0.99.1` `package/package.json` 的 `bin` / `exports` |
| 导出 HTML 补丁的 9/9 锚点全部命中 | `pi-coding-agent@{0.83.0,0.99.1,0.99.2}` `dist/core/export-html/template.js`（`sortChildren` 在 `:102-107`）与 `index.js`（三版均 9760 字节、0 行差异）、`template.html`（三版均 55 行、0 行差异）；锚点取自 `app/api/sessions/[id]/export/route.ts:143/166/184`，比对脚本 `/tmp/pi-sdk-audit/check-anchors.mjs` |
| `dist/*.d.ts` 删除 2 个、新增 66 个，删除的 2 个不可达 | `pi-coding-agent@{0.83.0,0.99.1}` `dist/` 下 `find -name "*.d.ts"` 集合差；`bun/register-bedrock` 与 `utils/clipboard-native` 在 `0.99.1` `dist/index.d.ts` 内 0 引用 |
| `pi-tui` 的 `KeybindingsManager` / `TUI_KEYBINDINGS` 导出名未变 | `pi-tui@{0.83.0,0.99.1,0.99.2}` `dist/index.d.ts`（`:16` / `:22` / `:22`）+ `dist/keybindings.d.ts`（`:46` → `:62` → `:62`，文件 176 → 256 → 256 行） |
| `ThinkingLevel` 三版逐字相同 | `pi-agent-core@{0.83.0,0.99.1,0.99.2}` `dist/*.d.ts` 的 `type ThinkingLevel` |
| 上游构建切到 TS 7.0 / ES2024 但 `.d.ts` 无 TS5 不兼容语法 | `pi-coding-agent@0.99.2` `CHANGELOG.md:56`；对 `0.99.1` `dist/core/*.d.ts` 扫 `<const ` / `satisfies` / `NoInfer` / `accessor ` 全 0 命中，`using ` 的 3 处命中均在 JSDoc（`bash-executor.d.ts:28`、`resolve-config-value.d.ts:19/24`、`sdk.d.ts:15`） |

### 7.2 本仓一手来源（消费侧）

| 结论 | 出处 |
|---|---|
| 四个包精确 pin 在 0.83.0 | `package.json:43-46` |
| 内部依赖范围使四包必须同改 | `bun.lock:179-185`；`pi-coding-agent@0.99.x` 的 `package/package.json` `dependencies` |
| 存在 lockfile（更正「无 lockfile」） | `bun.lock`（2455 行，已跟踪）；`.gitignore:44-45` 只忽略 `package-lock.json` / `pnpm-lock.yaml` |
| 39 个文件 import SDK、约 5765 行 | `grep -rl "@earendil-works" --include="*.ts" --include="*.tsx" --include="*.mjs" . \| grep -v node_modules` |
| `lib/rpc/` 1508 行、六文件分布 | `wc -l lib/rpc/*.ts` |
| `lib/agent-loop/loop.ts` 不 import SDK | `grep -n "earendil" lib/agent-loop/loop.ts` 零命中 |
| `AgentSessionLike` 39 个成员镜像 | `lib/pi-types.ts:117-169` |
| 事件类型全开放 ⇒ `tsc` 对事件名失明 | `lib/rpc/session.ts:28-31`（`{ type: string; [key: string]: unknown }`）+ `hooks/useAgentSession.ts:55` |
| B-1 写入点与触发链 | `lib/rpc/session.ts:290-293`；触发链 `lib/rpc/caller.ts:153-155` → `:164` → `session.ts:291-292` |
| B-1 被镜像掩盖的原因 | `lib/pi-types.ts:131`（`systemPrompt?: string` 可变可选）+ `lib/rpc/session.ts:162`（`inner: AgentSessionLike`）；唯一对撞点 `lib/rpc/caller.ts:149` |
| B-2 两个未传 `persist` 的 call site | `lib/rpc/session.ts:430`、`:483` |
| B-2 启动路径显式持久化（不受影响） | `lib/startup-preferences.ts:50`、`:53`；per-agent 覆盖 `lib/agent-runtime.ts:279` → `lib/rpc/caller.ts:115`/`:121` |
| B-3 静默丢弃点 | `lib/session-reader.ts:304-349`（`:347-348` `default: return null`）；本地联合缺成员 `lib/types.ts:265-274`；cast 掩盖点 `lib/session-reader.ts:212-218` |
| B-3 成本漏算点 | `lib/session-stats.ts:92-103` |
| B-3 backfill 不受影响 | `lib/agent-loop/loop.ts:1529`（只认 `message`）、`:1401`（只认 `session` header） |
| B-4 `serverExternalPackages` 未含新依赖 | `next.config.ts:31-38` |
| `next.config.ts` 读包根 `package.json`（不受 dist 重组影响） | `next.config.ts:10-16` |
| B-6 `initTheme()` 调用点 | `lib/rpc/caller.ts:71`（无参） |
| B-6 `PlainTextTheme` 类型安全（`ConstructorParameters` cast） | `lib/rpc/session.ts:99-121`（`:102-104`） |
| 导出 HTML 补丁的失败模式是抛错 | `app/api/sessions/[id]/export/route.ts:130-138`（`matches !== 1` → `throw`） |
| 导出深路径在三版均存在 | `app/api/sessions/[id]/export/route.ts:236` |
| ADR-0007 的 5 条决策原文 | `docs/adr/0007-sdk-delegation-boundary.md:6-10`（5 条决策），`:17`（Status: accepted），`:3`（写死 `0.83.0`） |
| ADR-0007 锚点行号仍准 | `lib/model-scope.ts:71`（决策 2 引用的行号仍指向 `resolveModelScopeWithDiagnostics`） |
| `lib/rpc/events.ts` 不存在 | `ls lib/rpc/events.ts` → No such file；实际 `lib/rpc/subscriber.ts`(61) + `lib/rpc/broadcaster.ts`(58)，各自在 `lib/rpc/index.ts:30-37` 导出 |
| `SettingsManager.withLock` 零调用 | 全仓 grep 零命中（0.83.0 与 0.99.1 的 SDK 里都存在） |
| `invalidateModelsCache` 是本仓自有 | `lib/models-cache.ts:38`；SDK `dist/` 内无此符号 |
| `tool-presets.ts` 仍硬编码工具名 | `lib/tool-presets.ts:10-12`；重复副本 `lib/rpc/session.ts:96` |
| `updateSkill()` 仍不存在 ⇒ frontmatter 手术必须保留 | 0.99.2 `dist/` 全量搜索无 `updateSkill`；消费侧 `app/api/skills/route.ts:56-58` |
| spec 锁定条目 | `docs/spec.md:462-466`（§7.3）、`:309-310`（§5.2）、`:320`（§5.3 的「pi 升级改变 session 格式不影响 raft 数据」）、`:363-377`（§5.8） |
| spec §5.3 锁定条目与 B-3 的关系 | `docs/spec.md:320` vs `lib/session-reader.ts:347-348` |
| ADR-0010 与 metadata 一致 | `docs/adr/0010-readme-source-attribution-exception.md`；`README.md:5`、`:160-166`；`README.zh-CN.md:160-166` |
| 上游地址与 README 一致 | `README.md:5` / `README.md:166` 的 `https://github.com/earendil-works/pi` == 2.3 节的三版 metadata |
| ADR-0006 决策未被升级触动 | `docs/adr/0006-backward-compat-and-migration-strategy.md`（单向前兼容 / 单事务幂等 / 会话文件门禁留在 worksplice 侧）——第 5.2 节的 B-3 修法正是「门禁留在 worksplice 侧」这条决策的延续 |
| `CONTEXT.md` 术语词条 | `CONTEXT.md:28`（jsonl 读写权归 SDK，app 只读不解析）、`:111-117`（`SDK 委托边界` 词条与 `_Avoid_`）、`:36`（backfill 门禁） |
| `CONTEXT.md:116` 的行号锚点已漂移 | `CONTEXT.md:116` 引 `lib/rpc/session.ts:55-65`，实际该区间是类型定义，wrapper 构造在 `:162` |

### 7.3 未经一手核实的条目

以下内容本报告**没有**从一手来源确认，读者不应据此行动：

| 条目 | 为什么没核实 |
|---|---|
| 0.88–0.98 断层的原因 | `time` map 与 `CHANGELOG.md` 均无任何说明。**上游未说明断层原因**，本报告不推测 |
| `0.99.2` 的运行时是否有回归 | 未装包、未实跑。其 `.d.ts` 差异已核实全在 MCP/codemode 域，但运行时行为未验证 |
| B-4 的打包面结论 | 取决于新依赖是否被 SDK 顶层静态 import，静态检查答不了 |
| B-6 在无 TTY 环境的实际行为 | `initTheme()` 的 `system` 主题 fallback 取值需实跑 |
| `PI_*` 环境变量在 0.99.x 是否增删 | 本票未核对上游的环境变量清单 |
| `SettingsManagerCreateOptions` 的字段级变化 | `dist/core/settings-manager.d.ts` 从 296 行涨到 376 行，但未逐字段核对是否含 agentDir 隔离相关项 |
| `@earendil-works/pi-tui` 的 `parseOsc11BackgroundColor` 被删 | 初筛时发现该符号消失，但 worksplice 只从 `pi-tui` import `KeybindingsManager` 与 `TUI_KEYBINDINGS`（`lib/rpc/session.ts:14`），两者均已核实仍在 ⇒ **对本仓无影响**，无需进一步核实 |
| `get_tools` 这个 preset 推断入口对应哪个 SDK 符号 | `AGENTS.md` 提到它，但 `get_tools` 在 0.83.0 与 0.99.1 的 `RpcCommand` union 里**都不存在**；worksplice 的 `get_tools` 是自研 RPC 命令名（`lib/rpc/session.ts:546`），由 `lib/tool-presets.ts:16` 的 `getPresetFromTools()` 消费 —— 不依赖任何 SDK 符号 |