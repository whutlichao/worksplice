# pi SDK 升级评估：0.99.2 → 1.5.2

> 这是一份**评估**，不是升级本身。本文件不含任何源码改动。全部结论以
> `npm pack` 取到的 tarball 内 `.d.ts` / `.js` / `CHANGELOG.md` / `package.json`、
> `npm view` 的 registry metadata，以及本仓自身代码与 `bun.lock` 为一手证据。
> 二手来源（博客、第三方升级指南、他人 changelog 摘要）一律不采信。
>
> **只读声明**：本研究**未执行** `npm install`、`bun install`、`bun add`，
> **未修改** `package.json`、`bun.lock`、`node_modules`、任何源码、任何已有文档。
> 版本对比全部在 `/tmp/pi152/` 下用 tarball 解包完成。自证读数见 §2.5。
>
> 取证方式修正（见 §2.3）：本任务 worktree **没有 `node_modules/`**，
> 所以基线 0.99.2 也是用 `npm pack @earendil-works/*@0.99.2` 取的 tarball，
> 而不是读仓内已装包。

---

## 1. TL;DR

**建议升，但不要直接跳。代价集中在 3 处「响亮失败」+ 3 处「静默变行为」，其中 2 处是安全/口径面，必须在同一步修掉。**

代价量级：**类型面几乎全绿**（44 个主入口符号全部仍在、签名只有 3 处变），
**行为面有 2 处必须改代码、1 处必须删代码、1 处必须实跑验证**，
**依赖面零改动**（`serverExternalPackages` 一个都不用加），**undici 不需要为它让路**（今天已经两份并存）。

按「**会不会静默变行为**」排序（不按改动行数排）：

| 排序 | 面 | 症状 | 静默？ | 层级 |
|---|---|---|---|---|
| **R1** | `GrepOperations.readFile` 在 1.5.1 变成 **deprecated + 被忽略** | 成员 bash 的 grep 上下文行不再经过路径守卫的读拦截（守卫的搜索根判定仍在） | **完全静默**：`tsc` 绿、运行无错、只有安全面缩水 | 运行时 |
| **R2** | `Usage.cost.total` 语义从「catalog 估算」变成「有 provider 报价时用实付」 | 成本看板数字口径改变，**字段名不变** | **完全静默** | 运行时 |
| **R3** | `enabledModels` 跨 provider 歧义改为「全加入 + `ambiguous` 警告」 | 模型选择器可能多出同 id 条目 | 半静默（有 warning 文案） | 运行时 |
| **R4** | 会话导出的三个 HTML 补丁锚点在 1.5.2 **全部消失**（上游自己改成了迭代实现） | `/api/sessions/[id]/export` 抛错 500 | **响亮**（`replaceRequired` 显式 throw） | 运行时 |
| **R5** | `AgentSettledEvent.aborted`、`BeforeAgentStartEvent` 变 union、`ToolInfo` 加字段、`GrepOperations.readFile` 变可选 | 类型层报错/需对齐 | 响亮（`tsc`） | 类型 |
| **R6** | `azure-openai-responses` → `azure` provider 改名（1.0.3） | 用了 Azure 的 `auth.json` / `models.json` / `settings.json` 需迁移 | 响亮（登录/模型失效） | 配置 |

**不需要担心的面比想象的大**：

- worksplice 从 `pi-coding-agent` 主入口 import 的 **44 个符号全部仍在** 1.5.2 的
  `dist/index.d.ts` 中，且 `dist/index.d.ts` 两个版本之间**只有 4 处纯加法差异**。
- `lib/pi-types.ts` 手写的 `AgentSessionLike` 镜像 **43 个成员一个都没少**，
  其中 **26 个方法签名逐字相同**（`setModel` / `setThinkingLevel` / `navigateTree` /
  `executeBash` / `getSessionStats` / `steer` / `followUp` / `clearQueue` / `prompt` / `subscribe` …）。
- `AgentState`（含 `readonly systemPrompt`）在 `pi-agent-core` 里 **字节级未变**；
  `setModel` / `setThinkingLevel` 的 `ModelMutationOptions` 与 JSDoc **逐字相同**。
- `AgentSessionEvent` **没有新增成员**（10 个核心事件 + 8 个会话事件，两版集合完全相同）。
- `SessionEntry` 联合**没有新增成员**（`usage` / `context_edit` 在 0.99.2 就已存在）。
- 六个 `create*ToolDefinition` 签名、`BashOperations.exec`、`ToolDefinition.execute`（5 参）、
  `ProjectTrustStore`、`hasTrustRequiringProjectResources`、`getShellConfig`、`parseFrontmatter`、
  `detectSupportedImageMimeTypeFromFile`、`agent-session-services`、`SlashCommandInfo` **零差异**。
- `next.config.ts` 的 6 项 `serverExternalPackages` **仍然够**，一个新依赖都不用加。

### English summary

> **Recommendation: upgrade to `1.5.2`, but as one slice that also deletes the export-HTML
> patching block and re-checks grep containment.** The type surface is almost entirely green:
> all 44 root-import symbols survive, all 43 members and 26 method signatures of the hand-written
> `AgentSessionLike` mirror are unchanged, `AgentState` and `ModelMutationOptions` are byte-identical,
> and neither `AgentSessionEvent` nor `SessionEntry` gained a member.
> The real cost is behavioral, and it is ordered by silence rather than by diff size:
> `GrepOperations.readFile` became deprecated *and ignored* in 1.5.1 (our path-guard's grep
> context-line hook silently stops firing), `Usage.cost.total` changed meaning from catalog estimate
> to provider-billed-when-available, and the three exact-string anchors our session-export route
> patches disappeared because upstream made those tree walks iterative itself — that one fails loudly.
> `pi-coding-agent` 1.5.2 also ships **no** `./client` and `./experimental/plugin` subpaths (unused here),
> drops `@earendil-works/chord`, and moves the theme schema out of `dist/`. The stated "13 versions"
> is really **12** (`1.0.0` … `1.5.2`); `1.0.0` has *no* Breaking Changes section at all.

---

## 2. 事实基线

### 2.1 四个包的 pin 与 lockfile

`package.json:57-60` 四个包全部**精确 pin**（无 caret / range）：

```json
"@earendil-works/pi-agent-core": "0.99.2",
"@earendil-works/pi-ai": "0.99.2",
"@earendil-works/pi-coding-agent": "0.99.2",
"@earendil-works/pi-tui": "0.99.2",
```

`bun.lock` 被 git 跟踪（2339 行），第 8-11 行同一组 pin，第 165/167/171 行带 SHA-512。
`package.json:67` 另有 `"undici": "8.5.0"`（见 Q4）。

**1.5.2 的内部依赖声明从 caret 变成精确版本**：

| 包 | 0.99.2 内部声明 | 1.5.2 内部声明 |
|---|---|---|
| `pi-coding-agent` → `pi-{agent-core,ai,tui,codemode,mcp}` | `^0.99.2` | **`1.5.2`（无 caret）** |

来源：`pi-coding-agent@1.5.2` `package/package.json` 的 `dependencies`；
`CHANGELOG.md:329`（`## [1.3.0]`）原话：
> Pinned internal Pi dependencies to exact release versions to prevent fresh installs from mixing
> incompatible packages ([#10865](https://github.com/earendil-works/pi/issues/10865))

⇒ **四包仍然必须同一步一起改**，理由从「caret 不可解」变成了「精确版本只有同版本才可解」，
但结论一样：不可分批。

### 2.2 版本谱系 —— 「13 个已发布版本」需要更正

`npm view @earendil-works/pi-coding-agent time --json` 的完整 `time` map 显示，
`0.99.2`（2026-09-30T19:30Z）之后到 `1.5.2`（2026-11-10T12:24Z）之间的已发布版本是 **12 个**：

```text
1.0.0  1.0.1  1.0.2  1.0.3  1.0.4  1.1.0  1.2.0  1.3.0  1.4.0  1.5.0  1.5.1  1.5.2
```

- 跨 **6 条 minor 线**：`1.0` / `1.1` / `1.2` / `1.3` / `1.4` / `1.5`。
- 「13」只有把起点 `0.99.2` 也算进去才对。**升级要跨越的新版本数是 12。**
- 与上一轮 `0.83 → 0.99` 不同，这次**没有跳号**：`0.99.2 → 1.0.0` 是主版本进位，
  时间上只隔 **19 小时**，属正常发布。
- `dist-tags.latest` = **`1.5.2`**；`legacy-node20` = `0.74.2`（无关）。

`pi-coding-agent@1.5.2` 的 `CHANGELOG.md` 覆盖 1.5.2 段到 0.80.x，与 `time` map 完全一致。

### 2.3 本 worktree 没有 `node_modules/`（取证方式更正）

协调者的前置事实里写「仓内 `node_modules/@earendil-works/pi-coding-agent@0.99.2` 是当前 pin 的现货，
可直接读」。**本任务 worktree 里没有 `node_modules/`**（`ls -d node_modules` → No such file）。
因此本评估把基线也做成了 tarball：

```bash
cd /tmp/pi152/base && for p in pi-coding-agent pi-agent-core pi-ai pi-tui; do
  mkdir -p $p && (cd $p && npm pack @earendil-works/$p@0.99.2 >/dev/null && tar xzf *.tgz); done
cd /tmp/pi152 && for p in pi-coding-agent pi-agent-core pi-ai pi-tui; do
  mkdir -p $p && (cd $p && npm pack @earendil-works/$p@1.5.2 >/dev/null && tar xzf *.tgz); done
```

下文所有 `dist/...:行号` 引用都相对 **tarball 根 `package/`**，并统一省略 `package/` 前缀
（例：`pi-coding-agent@1.5.2` `dist/core/agent-session.d.ts:49`）。

**副作用（值得记）**：`pi-agent-core` 的 tarball 从 **4.8 MB 掉到 332 KB**。
原因是 1.5.2 删掉了整片 `./harness/*` / `./search/*` / telemetry 再导出
（`pi-agent-core@1.5.2` `dist/index.d.ts` 对比 0.99.2 少了约 25 行 `export`）。
worksplice 只从它 import 5 个符号，全部来自 `./types.ts` 与 `./agent.ts`，**不受影响**。

### 2.4 上游 changelog 的形状

`pi-coding-agent@1.5.2` 的 `CHANGELOG.md` 共 6613 行（0.99.2 是 5998 行）。
1.0.0–1.5.2 区间带 `### Breaking Changes` 小节的版本是 **4 个**：

| 版本 | Breaking Changes 小节行号 | 条数 |
|---|---|---|
| `1.0.3` | `:498` | 1（Azure provider 改名） |
| `1.2.0` | `:363` | 4（schema 发布、`before_agent_start` union、run 启动期即 busy、`pi mcp list --json`） |
| `1.5.0` | `:143` | 1（工具参数校验换 `@earendil-works/pi-schema`） |
| `1.5.1` | `:29` | 2（`GrepOperations.readFile` 失效、OpenAI 兼容端点不再发 `"tools": []`） |

**`1.0.0` 没有 `### Breaking Changes` 小节** —— 它的「fullscreen 默认」写在 `### New Features`
（`CHANGELOG.md:576`）与 `### Changed`（`:593`）。所以「1.0.0 的 breaking 主体是 TUI fullscreen 默认」
这个说法在**语义上对、在形式上不准**：它不是被标为 breaking 的那一条，而是被标为 default 变更的那一条。

### 2.5 只读自证读数

本文档定稿（提交前）在任务 worktree 内的实际读数：

```text
$ git status --porcelain
?? docs/pi-sdk-upgrade-1.5-assessment.md

$ git diff --stat
(空输出)

$ wc -l docs/pi-sdk-upgrade-1.5-assessment.md
    1078 docs/pi-sdk-upgrade-1.5-assessment.md
```

⇒ **工作区只有一个新增文件，没有任何被跟踪文件的改动。**
`git diff --stat` 为空是正确结果：本票唯一交付物是**新增**文件，不是修改。
提交后工作区转为干净（`git status --porcelain` 无输出），diff 只含该文件。

**票据文件说明**：验收口径写的是「这一个 Markdown 文件 + 票据文件」，但本任务 worktree 内
**不存在** `.scratch/pi-sdk-152-assessment/` 目录（`ls .scratch | grep -i sdk` 只有 `pi-sdk-rebuild`），
也没有任何文件提到本票产物。故「Status 流转 / Answer 追加到票据」无对象可做，
`Answer` 内容落在 `worker_done` 摘要里；本报告**不新增** `.scratch/` 条目（超出本票文件所有权，见 §13 第 7 条）。

---

## 3. Q1 类型面：44 个 import 符号逐个核对

### 3.1 方法与可复现命令

```bash
# 1) 抽出 worksplice 从 pi-coding-agent 主入口的具名 import（44 个）
grep -rn "@earendil-works/pi-coding-agent" --include="*.ts" --include="*.tsx" --include="*.mjs" . \
  | grep -v node_modules
# 2) 对每个符号在 1.5.2 的 dist/index.d.ts 里做 \b<sym>\b 命中
# 3) 解析 index.d.ts 的 re-export 目标，逐个比对该符号的声明块
```

**总数复核**：44 个，与协调者给的数字一致。分布在 37 个文件（全仓共 39 个文件 import 任一 pi 包），
不含 `pi-agent-core`（5 个）/ `pi-ai`（6 个 + `/compat` 4 个）/ `pi-tui`（2 个）。

**`dist/index.d.ts` 的整体差异**（0.99.2 43 行 → 1.5.2 44 行），`diff -u` 只有 4 个 hunk，
**全部是加法**：

| hunk | 变化 |
|---|---|
| `:8` | `core/extensions` 的 type re-export 表新增 `BeforeAgentStartCustomEvent`、`BeforeAgentStartUserEvent`、`KeybindingHints`、`MarkdownMessageType`、`MarkdownTransformerOptions`、`MarkdownTransformerRegistration`、`ToolRendererResolver`、`ToolRenderers` |
| `:16` | `core/package-manager` 新增 `PackageInstallFailure` |
| `:22` | `core/settings-manager` 新增 `QuietStartup` |
| `:26a27` | 新增一行 `export { formatReadLineRange } from "./core/tools/render-utils.ts"` |

**零删除**。这是本次评估最有利的一条结构性事实。

### 3.2 44 个符号逐条结论

判定口径：**导出仍在**（在 `dist/index.d.ts` 里被 re-export）、**签名兼容**（该符号的声明块
在 0.99.2 与 1.5.2 之间或无差异，或只有可选成员新增）。所有行号相对 tarball 根 `package/`。

| # | 符号 | 导出 | 签名 | 依据 / 差异 |
|---|---|---|---|---|
| 1 | `AgentSession` | 在 | **兼容** | `dist/core/agent-session.d.ts:222`（0.99.2 `:208`）；公开成员名集合**完全相同**，新增的 25 个成员全部是 `private` |
| 2 | `AgentSessionEvent` | 在 | **乐观兼容** | 见 Q3：成员集合不变，`agent_settled` 新增必填 `aborted: boolean` |
| 3 | `BashOperations` | 在 | **相同** | `dist/core/tools/bash.d.ts` 全文差异只有 import 行与 `createBashTool` 返回类型（本仓不调它）；`exec` 未动 |
| 4 | `DefaultPackageManager` | 在 | **兼容** | `dist/core/package-manager.d.ts:95`（0.99.2 `:78`）；新增项全是 `private` + `PathMetadata.changelogPath?` |
| 5 | `DefaultResourceLoader` | 在 | **兼容** | `dist/core/resource-loader.d.ts:127`；`ResourceLoaderOptions` 新增可选 `disabledBuiltinExtensions?` |
| 6 | `EditOperations` | 在 | **相同** | `dist/core/tools/edit.d.ts` 只改了 `editToolSystemPromptContribution.guidelines` 的文案 |
| 7 | `ExtensionAPI` | 在 | **兼容** | `dist/core/extensions/types.d.ts:1228`；新增 `registerToolRenderer`、`registerMarkdownTransformer` 增可选第 2 参、`custom()` 新增可选 `blocked` |
| 8 | `ExtensionFactory` | 在 | **相同** | 同上文件，`ExtensionFactory` 声明未在 diff 中出现 |
| 9 | `GrepOperations` | 在 | **破坏（对守卫有行为后果）** | `dist/core/tools/grep.d.ts:40`：`readFile` 由**必需**变**可选 + `@deprecated` + Ignored** |
| 10 | `LsOperations` | 在 | **相同** | `dist/core/tools/ls.d.ts` 只改 import 行与 `createLsTool` 返回类型 |
| 11 | `ModelRuntime` | 在 | **兼容** | `dist/core/model-runtime.d.ts:36`；仅新增 `settleCredentialWrites()` |
| 12 | `PackageSource` | 在 | **等价** | 定义从 `core/settings-manager.d.ts:84` 挪到 `core/settings-schema.d.ts:223`，改写成 `Static<typeof PackageSourceSchema>`；schema（`:67-74`）与 0.99.2 手写类型逐字段相同 |
| 13 | `ProjectTrustStore` | 在 | **相同** | `dist/core/trust-manager.d.ts` **零差异** |
| 14 | `ReadOperations` | 在 | **兼容** | `dist/core/tools/read.d.ts:36`；新增可选 `createReadStream?` |
| 15 | `ResolvedPaths` | 在 | **兼容** | `dist/core/package-manager.d.ts:17`；新增可选 `installFailures?: PackageInstallFailure[]` |
| 16 | `ResolvedResource` | 在 | **相同** | 同上文件，声明未在 diff 中出现 |
| 17 | `ResourceDiagnostic` | 在 | **相同** | `dist/core/diagnostics.d.ts` **零差异** |
| 18 | `ScopedModel` | 在 | **相同** | `dist/core/model-resolver.d.ts:9` 未在 diff 中出现 |
| 19 | `SessionEntry` | 在 | **相同** | `dist/core/session-manager.d.ts:128`；联合成员集合不变（见 Q3） |
| 20 | `SessionInfo` | 在 | **相同** | `dist/core/session-manager.d.ts:163`，接口逐字节相同 |
| 21 | `SessionManager` | 在 | **兼容** | `dist/core/session-manager.d.ts:229`；本仓用到的 `open/create/getEntries/getCwd/getSessionName/getBranch/createBranchedSession/listAll/buildSessionContext` 均未变，新增 `projectContextEntry()` 一个自由函数 |
| 22 | `SettingsManager` | 在 | **兼容** | `dist/core/settings-manager.d.ts:47`；本仓用到的 14 个方法签名未变（`flush` / `setDefaultThinkingLevel` / `setDefaultModelAndProvider` / `getShellPath` / `getProjectSettings` / `getGlobalSettings` / `setProjectTrusted` / `setPackages` / `setProjectPackages` / `getShellCommandPrefix` / `getEnabledModels` / `getDefaultProvider` / `getDefaultModel` / `create`）。唯二签名变化是 `get/setQuietStartup`（`boolean` → `QuietStartup`），本仓零调用 |
| 23 | `SlashCommandInfo` | 在 | **相同** | `dist/core/slash-commands.d.ts` **零差异** |
| 24 | `Theme` | 在 | **等价（构造类型改写，语义相同）** | 见 §3.4 |
| 25 | `WriteOperations` | 在 | **相同** | `dist/core/tools/write.d.ts` 只改 import 行与 `createWriteTool` 返回类型 |
| 26 | `buildContextEntries` | 在 | **相同** | `dist/core/session-manager.d.ts:198` 未在 diff 中出现 |
| 27 | `buildSessionContext` | 在 | **相同** | `dist/core/session-manager.d.ts:202` 未在 diff 中出现 |
| 28 | `createAgentSessionFromServices` | 在 | **相同** | `dist/core/agent-session-services.d.ts` **零差异** |
| 29 | `createAgentSessionServices` | 在 | **相同** | 同上文件 |
| 30 | `createBashToolDefinition` | 在 | **相同** | `dist/core/tools/bash.d.ts:97` 未在 diff 中出现 |
| 31 | `createEditToolDefinition` | 在 | **相同** | `dist/core/tools/edit.d.ts:41` |
| 32 | `createFindToolDefinition` | 在 | **相同** | `dist/core/tools/find.d.ts:39` |
| 33 | `createGrepToolDefinition` | 在 | **相同** | `dist/core/tools/grep.d.ts:38` |
| 34 | `createLsToolDefinition` | 在 | **相同** | `dist/core/tools/ls.d.ts:38` |
| 35 | `createReadToolDefinition` | 在 | **相同** | `dist/core/tools/read.d.ts:60` |
| 36 | `createWriteToolDefinition` | 在 | **相同** | `dist/core/tools/write.d.ts:27` |
| 37 | `detectSupportedImageMimeTypeFromFile` | 在 | **相同** | `dist/utils/mime.d.ts` **零差异** |
| 38 | `getAgentDir` | 在 | **相同** | `dist/config.d.ts:116`（0.99.2 `:89`）；`config.d.ts` 差异全是新增函数（`getConfiguredSelfUpdateArgv` 等） |
| 39 | `getShellConfig` | 在 | **相同** | `dist/utils/shell.d.ts` **零差异** |
| 40 | `hasTrustRequiringProjectResources` | 在 | **相同** | `dist/core/trust-manager.d.ts` **零差异** |
| 41 | `initTheme` | 在 | **相同** | `dist/modes/interactive/theme/theme.d.ts:116`，签名逐字相同 |
| 42 | `parseFrontmatter` | 在 | **相同** | `dist/utils/frontmatter.d.ts` **零差异** |
| 43 | `parseSessionEntries` | 在 | **相同** | `dist/core/session-manager.d.ts:183` 未在 diff 中出现 |
| 44 | `resolveModelScopeWithDiagnostics` | 在 | **签名相同、行为变** | `dist/core/model-resolver.d.ts:79`（0.99.2 `:64`）：`(patterns, modelRuntime, options?)` 未变；`ModelScopeDiagnostic.code` 联合新增 `"ambiguous"`（Q2-R3） |

**汇总：44/44 导出仍在；41 个签名相同或纯加法兼容；3 个需要处理**
（`GrepOperations` 的可选化是行为后果、`AgentSessionEvent` 需要重编译才知道、
`Theme` 是类型改写的等价物）。

### 3.3 `AgentSessionLike` 镜像：43 个成员、26 个方法签名

`lib/pi-types.ts:128-189` 是手写的 `AgentSession` 结构镜像，是**本仓唯一与真实 SDK 类型对撞的地方**
（`lib/rpc/caller.ts` 构造点做单向结构兼容检查）。逐个核对结论：

- **43 个成员在 1.5.2 的 `AgentSession` 上全部存在**（0.99.2 同样全部存在）。
- `AgentSession` 的**公开成员名集合两版完全相同**：新增 25 个成员全部是 `private`，
  **没有任何公开成员被删除**。
- 抽取 26 个关键方法的完整声明做逐字比对，**0 处差异**：

```text
setModel  navigateTree  executeBash  getSessionStats  clearQueue  steer  followUp
prompt  subscribe  getContextUsage  compact  setActiveToolsByName  getAllTools
getActiveToolNames  abortCompaction  setThinkingLevel  setSessionName  reload  dispose
abort  setAutoCompactionEnabled  setAutoRetryEnabled  getSteeringMessages
getFollowUpMessages  getLastAssistantText  abortBash
```

⇒ **上一次升级（0.83→0.99）收获的 `QueuedInputDisposition`、`steer`/`followUp` 返回类型、
`SystemPrompt` 只读三笔债，这次一分钱都不用再付。**

**`setModel` / `setThinkingLevel` 的语义再确认**（协调者点名要求）：两版的
`dist/core/agent-session.d.ts` 中这两个方法的 JSDoc **逐字相同**：

```text
687:    setModel(model: Model<any>, options?: ModelMutationOptions): Promise<void>;
704:    setThinkingLevel(level: ThinkingLevel, options?: ModelMutationOptions): void;
```

JSDoc 仍写 `Persists to global defaults only when options.persist is true.`，
`ModelMutationOptions`（`:192`）仍是单字段 `persist?: boolean`。
⇒ **1.x 没有再动这条语义**；`lib/rpc/session.ts` 里「显式写 `SettingsManager` 而不用 `{ persist: true }」的
既有决定（`docs/pi-sdk-upgrade-assessment.md` §6 第 3 步）**继续成立**。

**`AgentState`**（`pi-agent-core@1.5.2` `dist/types.d.ts`）与 0.99.2 **字节级相同**，
包括 `readonly systemPrompt: string`、`set/get tools`、`set/get messages`。

**`pi-agent-core` 的 `AgentTool` 泛型默认值改了，但本仓不破**：

| | 0.99.2 | 1.5.2 |
|---|---|---|
| 泛型约束 | `TParameters extends TSchema = TSchema` | `TParameters extends object = object` |
| 参数类型 | `Static<TParameters>` | `AgentToolParams<TParameters>`（`= IsAny<T> extends true ? any : Static<T>`，`dist/types.d.ts:412`） |

`lib/session-title.ts:32` 的 `createShadowTools(tools: AgentTool[]): AgentTool[]` 只做透传，
`AgentState.tools` 的类型是 `AgentTool<any>[]`（`AgentToolParams<any>` 解析为 `any`）⇒ 两边都收敛到 `any`，
**不产生赋值错误**。`AgentOptions` 只新增可选 `identity?: ClientIdentity`。

**`pi-ai` 6 个符号**：`Api`（`dist/types.d.ts:21`）、`Credential`（`dist/auth/types.d.ts:32`）、
`getSupportedThinkingLevels`（`dist/models.d.ts:278`）、`completeSimple`（`dist/compat.d.ts:66`）
**声明逐字相同**；`AuthEvent`（`dist/auth/types.d.ts:132`）新增两个**可选**字段
`openBrowserOnConfirm?` / `copyCodeOnConfirm?`；`AuthPrompt`（`:105`）逐字相同。
`./compat` 子路径两版都在。

**`pi-tui` 2 个符号**：`KeybindingsManager`（`dist/keybindings.d.ts:256`）与
`TUI_KEYBINDINGS`（`:62`）**行号都未变**；`index.d.ts:22` 的 re-export 行两版逐字相同
（只在 `keybindings.ts` 里新增了一个 `getSelectPageIndex`）。`TerminalColorMode`
（`dist/colors.d.ts:20`）值域仍是 `"256color" | "truecolor"`。

### 3.4 `Theme` 构造类型改写：等价，不是破坏

`dist/modes/interactive/theme/theme.d.ts:46` 的构造函数第 1/2 参：

| | 0.99.2 | 1.5.2 |
|---|---|---|
| fg | `Record<Exclude<ThemeColor, OptionalThemeColor>, string \| number> & Partial<Record<OptionalThemeColor, string \| number>>` | `Pick<ThemeColorValues<string \| number>, ThemeColor>` |
| bg | `Record<Exclude<ThemeBg, OptionalThemeBg>, ...> & Partial<Record<OptionalThemeBg, ...>>` | `Pick<ThemeColorValues<string \| number>, ThemeBg>` |

`theme-tokens.d.ts:250-254` 定义：

```ts
export type ThemeColorValues<Value> = { [K in RequiredToken]: Value } & { [K in OptionalToken]?: Value };
```

⇒ `Pick<…, ThemeColor>` 展开后 = 「必需的前景 token 必填 + 可选的前景 token 可选」，
**与 0.99.2 的 `Record<Exclude> & Partial<Record>` 语义完全相同**。
4 个可选前景 token（`scrollbarTrack` / `scrollbarThumb` / `thinkingMax` / `searchMatchText`）与
1 个可选背景 token（`searchMatchBg`）**仍然可选**。

`schemas/theme.schema.json`（1.5.2，从 0.99.2 的
`dist/modes/interactive/theme/theme-schema.json` 搬过来）的 `required` 仍是 **51** 项，
可选集合仍是那 5 个 —— 与 0.99.2 一致。

⇒ `lib/rpc/session.ts:152-207` 那两份 `EMPTY_*_COLOR_TOKENS`（41 foreground + 6 background，
刻意省掉 5 个可选）**在 1.5.2 上仍然类型正确，一行都不用改**。

**另有一处改善值得记**：0.99.2 的 `Theme` 构造函数会把缺失的可选 token 从 `muted` / `text` /
`selectedBg` 合成，合成源缺失时抛 `Invalid color value: undefined`（`docs/spike-theme-crash.md`）。
1.5.2 改成 `withThemeTokenFallbacks()`，缺 fallback 目标时抛
`Theme token <name> has unresolved fallback <fallback>`（`dist/modes/interactive/theme/theme.js:47-57`）
—— 同一类错误从**不可读的 `undefined`** 变成**点名 token 的可读错误**。
我们的 41 个必需 token 都给了 `""`，fallback 目标有值，**不会触发**。

---

## 4. Q2 行为面：逐版本筛出影响 worksplice 的变化

口径：清单来自 `pi-coding-agent@1.5.2` `package/CHANGELOG.md` 的 1.0.0–1.5.2 段。
纯终端渲染 / TUI 交互的条目**合并成一句「不影响」**（worksplice 不跑 TUI，进程内驱动 `AgentSession`）。
每条给「版本 + changelog 行号 + 对 worksplice 的判定」。

### 4.1 `1.0.0`（`CHANGELOG.md:572-617`）—— 全部不影响

| 条目 | 行 | 判定 |
|---|---|---|
| TUI 默认改 fullscreen（`tuiMode`） | `:576`、`:593` | **不影响**。worksplice 从不读 `tuiMode`、不启动 interactive mode；它走 `createAgentSessionServices` + `createAgentSessionFromServices` 的 SDK 路径（`lib/rpc/caller.ts:9-15`）。协调者的判断成立，本条被**证实** |
| codemode prompt token 瘦身 / 错误可恢复提示 | `:594`、`:596` | **不影响**。worksplice 的会话 allowlist 只含 7 个 builtin coding tool 与 4 个 default 工具（`lib/tool-presets.ts:24-32`），从不含 `codemode` |
| MCP OAuth 加固、Radius 登录、provider 文案 | `:578`-`:591` | **不影响**（本仓无 MCP / Radius 代码路径） |
| 其余 `### Fixed` 全部是 TUI / MCP / provider 适配 | `:598-617` | **不影响** |

### 4.2 `1.0.1` / `1.0.2` / `1.0.4` —— 全部不影响

`1.0.1`（`:528-571`）与 `1.0.4`（`:468-490`）的条目全是 fullscreen / Kitty 图片 / MCP 渲染 / codemode
交互修复。`1.0.2`（`:518-527`）只有 2 条新增（`New Features` / `Added`）。

### 4.3 `1.0.3`（`:491-517`）—— **影响：Azure provider 改名**

`### Breaking Changes`（`:498`）唯一条原话：

> Renamed the Azure provider from `azure-openai-responses` to `azure`. Rename the provider key in
> `auth.json` (or run `/login` again), in `models.json`, and in `settings.json`
> (`defaultProvider`, `enabledModels` patterns, and `modelThinkingLevels` keys). Sessions that used
> the old provider fall back to another model when resumed, and their prompt cache is not reused.

**对 worksplice**：这三份文件全在 `getAgentDir()` 下，worksplice 的 ModelsConfig
（`app/api/models-config/route.ts`）与模型列表（`app/api/models/route.ts`）直接读写它们。
⇒ **升级后任何用过 Azure 的实例必须做一次配置迁移**（改 `models.json` 的 provider key、
`settings.json` 的 `defaultProvider` / `enabledModels` / `modelThinkingLevels`，或重新 `/login`）。
失败模式**响亮**（模型消失、会话回落别的模型），不是静默。

### 4.4 `1.1.0`（`:416-467`）—— 影响两处，均兼容

| 条目 | 行 | 判定 |
|---|---|---|
| `agent_settled` 事件新增 `aborted` | `:434` | **加法**。`lib/agent-runtime.ts:41-48` 的 `STATUS_BY_EVENT` 只按 `type` 匹配，`lib/cwd-mutex.ts:136-137` 的 `SETTLE_EVENTS` 只做 `Set.has`，`hooks/useAgentSession.ts:1088` 的 `case "agent_settled"` 不读字段 ⇒ **三处消费点都不受影响**。副作用是**更好了**：能区分取消与正常结束 |
| `--tools` 支持 `+name`/`-name` 修饰符 | `:419` | **需注意但不破**。`CreateAgentSessionOptions.tools` 的语义扩张（`dist/core/sdk.d.ts:44-58` 明写「A list of only `+name` and `-name` entries is not an allowlist… Mixing them with plain entries throws」）。worksplice 只在 `toolNames === []` 时传 `tools: []`（`lib/rpc/caller.ts:81-89`），其余情况传 `undefined` 再 `setActiveToolsByName` ⇒ **纯 plain names，不会抛** |
| 程序状态上报（OSC 7501）、Claude Haiku 5.5、classifier | `:418`、`:420`、`:421` | 不影响 |
| `tool_execution_end` 新增 `durationMs` | `:429` | 加法；`hooks/useAgentSession.ts` 不读它 |

### 4.5 `1.2.0`（`:353-415`）—— 影响三处，一条是 breaking

| 条目 | 行 | 判定 |
|---|---|---|
| **配置 schema 搬到 `pi.dev`，主题在启动期就校验**（Breaking，`:365`） | `:365` | **影响本仓测试，且响亮**：`lib/rpc/session.test.mjs:323` 用相对路径 `../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme-schema.json` 读**已装包内**的 schema，再断言 `properties.colors.required`（`:329` / `:344-345`）。1.5.2 **删掉了 `dist/modes/interactive/theme/theme-schema.json`**，改成 `schemas/theme.schema.json`（`find` 实测：1.5.2 无该文件，0.99.2 有）。⇒ 该测试会因**文件不存在**而红。**这是好事**：一处必须改的显式失败，不是静默 |
| **`BeforeAgentStartEvent` 变 union**（Breaking，`:366`） | `:366` | **对本仓无害**：`lib/rpc/forced-empty-system-prompt.ts` 的处理器是 `pi.on("before_agent_start", () => …)`，**不接收参数**，所以 `messageType` 的加入完全不影响它。运行时侧 `{ systemPrompt: "" }` 通道仍在：`dist/core/extensions/runner.js:1138-1153` 仍是 `result.systemPrompt !== undefined && (currentOptions.forceSystemPrompt = result.systemPrompt)`，`dist/core/agent-session.js:1552` 仍是唯一调用点，`trigger` 里带 `messageType`（`:1777` / `:1972`） |
| **run 启动期即算 busy**（Breaking，`:367`） | `:367` | **需要实跑验证**：`dist/core/agent-session.d.ts:542-549` 的 `_startRun` JSDoc（方法在 `:549`） 明写「The session counts as busy from here on… an abort requested meanwhile aborts the run as soon as it exists」。worksplice 的 `lib/cwd-mutex.ts` 用 `SETTLE_EVENTS` 判 settle、`lib/rpc/session.ts:73-88` 的 `RUNNING_STATE_EVENT_TYPES` 驱动 idle 计时器。**busy 更早开始**只会让「以为空闲其实在跑」变少，理论上更安全；但**这是推理，不是证据**，列进 §10 的必跑清单 |
| `serializeConversation()` 起不再含 thinking 块 | `:383` | 影响 compaction / branch summary 的**内容**（更小、更省），不影响协议。本仓只消费 `compaction` 条目，不解析 summary 内容 ⇒ 兼容 |
| 删掉 `./client` / `./experimental/plugin` 子路径（Breaking，`:413`） | `:413` | **对本仓无害**：全仓 `grep "pi-coding-agent/client\|experimental/plugin"` 零命中 |
| OpenRouter 按 key 列模型、`PI_CLIPBOARD_OSC52`、codemode 改进 | `:355`-`:359` | 不影响（模型列表跟随 SDK，本仓不缓存 provider 能力） |

### 4.6 `1.3.0`（`:307-352`）—— 影响两处

| 条目 | 行 | 判定 |
|---|---|---|
| **内部 pi 依赖改精确版本** | `:329` | 见 §2.1：四包必须同改 |
| **`--model` 遇到多 provider 同名时不再按 catalog 顺序选** | `:333` | **影响 `enabledModels` 的解析结果**：原话「`--models` and `enabledModels` add a model for each provider that offers it and warn about the ambiguity」。`lib/model-scope.ts:71-72` 把 `diagnostics` 的 `message` 直接展示 ⇒ 会多出 `ambiguous` 警告 + 重复模型条目。**半沉默**（有文案），列 R3 |
| 恢复会话时保留 active tools（`--tools +name/-name` 叠加） | `:315` | 兼容。`_restoreToolsFromTranscript` 在两版都存在（0.99.2 也有），只是多了 `modifiers` 参数 |
| `/share` 目标、Kimi Code、GPT-6 缓存、drop previous-model thinking | `:311`-`:317` | 不影响 / 兼容 |

### 4.7 `1.4.0`（`:251-306`）—— 全部不影响或方向性改进

| 条目 | 行 | 判定 |
|---|---|---|
| compaction / branch summary 改用模型 output limit（不再固定上限） | `:257`、`:281` | **兼容**：只让摘要更容易成功 |
| codemode 并行排队（`PI_CODEMODE_MAX_WORKERS`）、classifier 图片、Models 配置参考、Rex 终端 | `:255`-`:263` | 不影响 |

### 4.8 `1.5.0`（`:134-250`）—— 影响三处

| 条目 | 行 | 判定 |
|---|---|---|
| **工具参数校验换 `@earendil-works/pi-schema`**（Breaking，`:143`） | `:145` | **对本仓无害**：本仓**从不自带 TypeBox schema**（全仓 `grep typebox` 零命中），注册的六个工具全部来自 SDK 自己的 `create*ToolDefinition`（`lib/tool-path-guard-extension.ts:58-91`，`lib/bash-containment-extension.ts:357-366`），schema 是上游作者给的、上游已迁移。风险只在**扩展注册自定义 schema 的工具**时存在，本仓没有 |
| `Type` / `Static` / `TSchema` 仍可从 `@earendil-works/pi-ai` 导入（映射到 compat + 自带 TypeBox） | `:162` | 本仓零使用（`lib/model-scope.ts:7` 只要 `Api` / `Model`） |
| **`Usage.cost.totalFromProvider` 新增；`total` 语义改为「有报价用实付，否则估算」** | `:156` | **影响 `lib/session-stats.ts` 的口径**，见 Q3-R2 |
| **保存的 "Do not trust" 现在优先于自动信任** | `:173` | **影响 `lib/project-trust.ts` 的语义一致性**，见 §9 |
| 扩展更新 changelog、流式渲染加速、`PI_SELF_UPDATE_COMMAND` | `:136`-`:140` | 不影响 |
| **`undici` → 8.12.3（安全公告）** | `:222` | 见 Q4 |
| `grok-mermaid` → `lovely-mermaid`、`@earendil-works/chord` 移除、`brace-expansion` 提升为直接依赖 | `package/package.json` | 见 Q5 |

### 4.9 `1.5.1`（`:18-133`）—— 影响两处，一条是 breaking 且**静默**

| 条目 | 行 | 判定 |
|---|---|---|
| **`GrepOperations.readFile` 不再被调用**（Breaking，`:31`） | `:31` | **本报告最重要的一条**：`readFile` 变成 `@deprecated` + **Ignored**。实测 `pi-coding-agent@1.5.2` `dist/core/tools/grep.js` **全文件 `readFile` 零出现**（0.99.2 `:27` 的默认实现 + `:83` 的调用点都没了）；上下文行改由 ripgrep 的 `context` 事件给出（`grep.js:98-100`：`// rg emits the surrounding lines as context events, so no matched file is ever read here (#9276)`）。⇒ `lib/tool-path-guard-extension.ts:193` 的 `readFile: guarded(...)` **变成死代码**。详见 §8.2 |
| OpenAI 兼容端点全禁工具时不再发 `"tools": []`（Breaking，`:32`） | `:32` | **影响 PRESET_NONE 路径的协议层**：worksplice 的「全禁工具」= `tools: []`（`lib/rpc/caller.ts:89`）。升级后该请求**不再带 `tools` 字段**。这本就是修复 vLLM 400 的方向；但如果用户的代理**要求** `tools` 存在，需在 `models.json` 加 `compat.requiresToolsWithToolHistory: true`。列进 §10 必跑清单 |
| Anthropic 改用 message threads（默认开） | `:37`、`:24` | **兼容但要注意**：请求只发增量消息，服务端续接。对 worksplice 只影响 token/成本口径（首轮之后 input 变小）。若走网关需 `compat.supportsMessageThreads`。列进 §10 |
| `ReadOperations` 支持 `createReadStream` | `:74` | 纯加法 |
| RPC 模式 shutdown / token 刷新清理修复 | `:67`、`:69` | 不影响（worksplice 走 SDK 而非 RPC 模式） |

### 4.10 `1.5.2`（`:3-17`）—— 全部不影响

`Fork` 目录丢失时的交互选择（`:7`、`:11`）、`/import` 副本修复（`:15`）、Anthropic OAuth 版本号
（`:17`）。全部是 interactive mode 行为。**worksplice 的 fork 走 `AgentSession.fork()`
（`lib/rpc/session.ts`），不经这条 UI 路径。**

### 4.11 行为面小结

| 判定 | 条数 | 条目 |
|---|---|---|
| 必须改代码 | 3 | grep `readFile` 守卫（R1）、导出 HTML 三锚点（R4）、`theme-schema.json` 测试路径（§4.5） |
| 必须实跑验证 | 3 | run 启动期即 busy（§4.5）、`tools` 字段省略（§4.9）、Anthropic message threads（§4.9） |
| 必须评估配置迁移 | 1 | Azure provider 改名（§4.3） |
| 兼容但口径变化 | 2 | `Usage.cost.total`（R2）、`enabledModels` 歧义（R3） |
| 不影响 | 其余全部 | —— |

---

## 5. Q3 事件与 session 文件

### 5.1 `AgentSessionEvent`：**没有新增成员**

`AgentSessionEvent = WithParentToolCallId<Exclude<AgentEvent, {type:"agent_end"}>> | {…会话事件…}`
（`dist/core/agent-session.d.ts:49`）。

- **`AgentEvent`（`pi-agent-core`）**：两版都是 10 个成员
  （`agent_start` / `agent_end` / `message_start` / `message_update` / `message_end` /
  `turn_start` / `turn_end` / `tool_execution_start` / `tool_execution_update` / `tool_execution_end`），
  **集合完全相同，无增无删**。
- **会话侧事件字面量集合**：两版都是 18 个字面量，**集合完全相同**
  （`agent_end` / `agent_settled` / `queue_update` / `compaction_start` / `compaction_end` /
  `entry_appended` / `session_info_changed` / `thinking_level_changed` / `auto_retry_start` /
  `auto_retry_end` / `summarization_retry_scheduled` / `summarization_retry_attempt_start` /
  `summarization_retry_finished` / `bash_execution_update` + 3 个 reason/source 值）。

**唯一的变化是现有成员内部加字段**（3 处，全部加法）：

| 成员 | 0.99.2 | 1.5.2 |
|---|---|---|
| `agent_settled` | `{ type }` | `{ type; aborted: boolean }`（**必填**，`agent-session.d.ts:55-57`；extension 侧同名字段 `extensions/types.d.ts` 的 `AgentSettledEvent`） |
| `tool_execution_start/update/end` | — | `parentToolCallId?: string`（`agent-session.d.ts:42-48` 的 `WithParentToolCallId`） |
| `bash_execution_update` | `{ type; id?: string; delta }` | 未变（在 diff 之外） |

**`hooks/useAgentSession.ts` 会漏掉新条目吗？不会** —— 因为**没有新条目**。
它的分派是 `switch (event.type)`，`case "agent_settled"` 在 `:1088`、`auto_retry_end` 在 `:1208`、
`compaction_end` 在 `:1218`，并有兜底分支。**新增的 3 个字段它一个都不读，也不需要用**。
⇒ 这一层「宽松匹配」在 1.5.2 上是**安全**的，而不是勉强安全。

### 5.2 `SessionEntry`：**没有新增成员**

`SessionEntry` 联合的接口集合两版都是 7 个 entry 接口 + 4 个无 `type` 字面量的条目
（`session` header / `compaction` / `branch_summary` / `custom`），实测：

```text
SessionMessageEntry(message) ThinkingLevelChangeEntry(thinking_level_change)
ModelChangeEntry(model_change) UsageEntry(usage) LabelEntry(label)
SessionInfoEntry(session_info) ContextEditEntry(context_edit)
```

`usage` 与 `context_edit` **在 0.99.2 就已存在**（上一轮升级已经处理过），1.x **没有再加新条目类型**。

**`lib/session-reader.ts` 会漏吗？不会**：`:386` `case "message"`、`:400` `case "compaction"`、
`:412` `case "branch_summary"`、`:419` `case "custom_message"`、`:430` `case "context_edit"`、
`:433` `case "usage"` + `default:` 兜底 —— 覆盖集合与联合一致。
`buildSessionContext` / `buildContextEntries` / `parseSessionEntries` 的签名也都在 Q1 表里核实为相同。

### 5.3 `lib/session-stats.ts` 的成本口径 —— **要补的不是字段，是语义**

1.5.0（`CHANGELOG.md:156`）新增 `Usage.cost.totalFromProvider?: boolean`，
并把 `cost.total` 的注释改成（`pi-ai@1.5.2` `dist/types.d.ts`）：

| | 0.99.2 | 1.5.2 |
|---|---|---|
| `cost.total` | `total: number`（无注释） | `/** Best available total: provider-reported billed cost when supported, otherwise the catalog estimate. */ total: number;` |
| `cost.totalFromProvider` | 不存在 | `/** True when `total` is the billed cost reported by the provider. False when it is a catalog estimate; absent also means false. */ totalFromProvider?: boolean;` |

**结论：类型兼容（`cost.total` 仍是 `number`，`lib/session-stats.ts:59` 的
`typeof cost.total !== "number"` 校验照旧通过），但同一个字段会开始返回「实付」而不是「目录价」。**

- **要不要改代码**：**不需要**。用户看到的成本看板数字仍然有意义，且更准。
- **要不要标口径**：**要**。成本看板（`app/api/members/[id]/observability/route.ts` 一侧）
  若在 UI 文案或文档里承诺「按模型目录价估算」，升级后这句话就不再成立。
  建议在升级票里顺手记一句「成本 = provider 报价优先，缺失时回落目录估算」。
- **要不要做去重**：不需要。`usage` 条目仍然只在 `dist/core/cache-warmer.js` 一处 `appendUsage`
  产生（上一轮的实测结论照旧），与 `message.usage` 构造上不相交。

---

## 6. Q4 undici

### 6.1 「会不会形成两份并存」—— **今天就已经两份并存**

这是本问最重要的一条更正：**不是升级后才两份，现在就是两份**。

`bun.lock:2029`（根依赖）：
```json
"undici": ["undici@8.5.0", "", {}, "sha512-xamtWoB1EshgjpmlXd7GGm2VfdDtw1+rD8uhry8pSNW3If6S8E0m2T2+orSKeZXEn/aPJMviCpDBA65WJt8zhg=="],
```
`bun.lock:2141`（嵌套，挂在 pi 包下）：
```json
"@earendil-works/pi-coding-agent/undici": ["undici@8.10.2", "", {}, "sha512-/y4/…"],
```

`pi-coding-agent@0.99.2` 要求 `undici: 8.10.2`（精确），根 pin 是 `8.5.0`（精确）
⇒ bun **无法 dedupe**，只能嵌套。升级到 1.5.2 后嵌套那份变成 `8.12.3`
（`pi-coding-agent@1.5.2` `dependencies` 实测；`CHANGELOG.md:222` 说是为安全公告）。

**所以变化的是「漂移宽度」（8.5.0 vs 8.10.2 → 8.5.0 vs 8.12.3），不是「是否并存」。**

### 6.2 `lib/http-dispatcher.ts` 的行为/类型受影响吗——**不受影响**

- 它只 import 6 个 undici 符号：`Client`、`Dispatcher`、`Pool`、`EnvHttpProxyAgent`、`install`、
  `setGlobalDispatcher`（`lib/http-dispatcher.ts:2` 与后续使用点）。
  这 6 个在 `undici@8.5.0` 与 `undici@8.12.3` 的 `index.d.ts` 中**都存在**（逐符号命中实测）。
- 它解析到的是**根** `node_modules/undici`（worksplice 自己的 `import`），也就是 `8.5.0`。
  `undici` 在 `next.config.ts:31-38` 的 `serverExternalPackages` 里 ⇒ Next 不打进 bundle，
  运行时用 Node 解析 ⇒ **根副本，不随 pi 包升级而变化**。
- 「全局 `setGlobalDispatcher` 会不会影响 pi 内部的请求」这件事**今天已经是现状**
  （pi 用的是嵌套 8.10.2 那一份），升级不改变这个结构。

### 6.3 处置建议

| 选项 | 判定 | 理由 |
|---|---|---|
| **对齐版本（推荐）** | ✅ | 把 `package.json:67` 的 `undici` 从 `8.5.0` 提到 `8.12.3`，让两份合一。好处：拿 1.5.0 那条安全公告的修复；消除 7 个 minor 的漂移；`lib/http-dispatcher.ts` 的 6 个符号类型兼容 |
| 放宽成一个 range | ❌ | 本仓纪律是精确 pin（`package.json:57-60`、`:67`、`:68`）。放宽会让 lint/typecheck 基线不可比 |
| 直接用 SDK 的传递版本（不 pin） | ❌ | 本仓**直接 import** undici（`lib/http-dispatcher.ts:2`），必须有直接声明；靠传递依赖拿类型是隐式依赖 |

**处置进升级票，但不进本票**：本票不碰 `package.json`。§10 把它列为独立一步，
并要求 `bun install` 后 `bun.lock` 里 `undici` 只剩一条记录（`grep -c '^    "undici"' bun.lock` → 1）。

---

## 7. Q5 依赖与打包

### 7.1 `serverExternalPackages` 6 项还够不够——**够，一项都不用加**

`next.config.ts:31-38` 现有 6 项：`undici`、`better-sqlite3` + 四个 pi 包。

1.5.2 的依赖图变化（`package/package.json` 逐字段实测）：

| 包 | 0.99.2 → 1.5.2 | 是否需要 external |
|---|---|---|
| `@earendil-works/pi-codemode` | `^0.99.2` → **`1.5.2`**（仍是传递依赖） | **不需要**：它挂在已 external 的 `pi-coding-agent` 下 |
| `@earendil-works/pi-mcp` | `^0.99.2` → **`1.5.2`**（仍是传递依赖） | **不需要**：同上 |
| `@earendil-works/chord` | `^0.99.2` → **移除** | —— |
| `@earendil-works/pi-schema` | **新增**（通过 `pi-ai` 与 `pi-agent-core`） | **不需要**：挂在已 external 的 `pi-ai` / `pi-agent-core` 下 |
| `grok-mermaid` → `lovely-mermaid` | `0.2.3` → `0.3.3` | **不需要**：`pi-coding-agent` 的直接依赖 |
| `brace-expansion` | 由 `minimatch` 传递，**提升为 `pi-coding-agent` 直接依赖 `5.0.12`** | **不需要**：同上 |
| `undici` | `8.10.2` → `8.12.3` | 已在清单里 |
| `typebox` | `1.3.27` → **`1.3.27`（保留）** | 不需要 |

**判定依据不是推理，而是本仓已经实跑过的同一条结论**：
`docs/pi-sdk-upgrade-spike.md:26`（表格 Q1 行）与 `:478-535`（§4.1.2）记录了上一轮的实测 ——
「6 个新依赖全部在已 external 的 `@earendil-works/pi-coding-agent` 之下，webpack 根本不遍历它们」。
这次新增的 `pi-schema` / `lovely-mermaid` / `brace-expansion` 的**挂载位置完全相同**
（都在已 external 的 pi 包之下），所以同一条结论直接继承。

**唯一需要复核的点（进 §10 清单）**：`pi-schema` 是**新的一等包**，
上一轮不在这张图的验证范围里。`npm run build` 后应确认
`.next/server` 里**不出现** `pi-schema`（同 `docs/pi-sdk-upgrade-spike.md:493-495` 那条探针的写法）。

### 7.2 `pi-codemode` / `pi-mcp` 需不需要显式列出——**不需要**

- 两版都作为 `pi-coding-agent` 的**传递依赖**存在（`bun.lock:169` / `:173` 是 0.99.2 的证据；
  1.5.2 的 `dependencies` 里同样有）。
- worksplice **从不直接 import 它们**（`grep -rn "pi-codemode\|pi-mcp"` 在源码零命中）。
- 它们不在 `serverExternalPackages` 里，**今天就不在**，而今天的构建是通过的
  ⇒ 结构上不需要新增条目。

### 7.3 一个需要记的次生事实：`pi-agent-core` 瘦身 93%

`pi-agent-core` 的 tarball 4.8 MB → 332 KB，因为 1.5.2 删掉了整片
`./harness/*`、`./search/*`、`./node`、`./experimental/pico3` 子路径与 telemetry 再导出
（`pi-agent-core@1.5.2` `dist/index.d.ts` vs 0.99.2）。
**本仓只用 5 个符号，全部来自保留的 `./types.ts` / `./agent.ts`** ⇒ 不受影响，
但这也意味着**任何依赖 pi-agent-core 深层子路径的代码都会破**。本仓没有（`grep` 零命中）。

---

## 8. Q6 扩展 API

本仓三个 extension：

| 扩展 | 文件 | 用到的 SDK 面 |
|---|---|---|
| 路径守卫 | `lib/tool-path-guard-extension.ts` | `ExtensionAPI` / `ExtensionFactory` / 六个 `create*ToolDefinition` / 六个 `*Operations` |
| bash 沙箱 | `lib/bash-containment-extension.ts` | `ExtensionAPI` / `ExtensionFactory` / `createBashToolDefinition` / `BashOperations` / `getShellConfig` |
| 强制空 prompt | `lib/rpc/forced-empty-system-prompt.ts` | `ExtensionFactory` / `pi.on("before_agent_start")` |

### 8.1 六个 `create*ToolDefinition` —— **签名逐字相同**

对比 `dist/core/tools/{read,write,edit,grep,find,ls}.d.ts` 两个版本，**每一个文件**的差异只有两类：

1. `-import type { AgentTool } from "@earendil-works/pi-agent-core"` →
   `+import { type TypeBoxAgentTool } from "./tool-definition-wrapper.ts"`（import 行）；
2. 同文件**末尾** `create<X>Tool(...)` 的返回类型 `AgentTool<typeof schema>` → `TypeBoxAgentTool<typeof schema>`。

`createReadToolDefinition` / `createWriteToolDefinition` / `createEditToolDefinition` /
`createGrepToolDefinition` / `createFindToolDefinition` / `createLsToolDefinition` 这 6 个
worksplice 实际调用的函数，**声明行完全没出现在 diff 里 ⇒ 逐字相同**。
（改的是 `create<X>Tool` 这一族——本仓**不调用**它们，Q1 表已核实 import 只有 `…Definition`。）

顺带：`edit.d.ts:12-13` 的 `editToolSystemPromptContribution.guidelines` **文案变了**
（6 条变 2 条）。这会影响模型看到的工具说明（prompt 内容变化，不是协议变化）。**不需要改代码**，
但如果做 tool-description 快照测试会红。

### 8.2 `GrepOperations.readFile` —— **本条要改代码，且是静默的**

| | 0.99.2 | 1.5.2 |
|---|---|---|
| 声明（`grep.d.ts`） | `readFile: (absolutePath: string) => Promise<string> \| string;`（**必需**） | `/** @deprecated Ignored. Context lines come directly from ripgrep. Override the tool's execute() for remote search. */ readFile?: …`（**可选**） |
| 运行时（`grep.js`） | `:27` 默认实现 `readFile: (p) => fsReadFile(p, "utf-8")`；`:83` `const content = await ops.readFile(filePath)` | **全文件零出现**；`:98-100` 改由 rg 的 `--context` + `context` 事件提供 |

**对 worksplice 的后果**：`lib/tool-path-guard-extension.ts:193` 的
`readFile: guarded((absolutePath) => fsp.readFile(absolutePath, "utf-8"))` 变成**死代码**。

这正是路径守卫（ADR-0011）的读拦截之一。**精确边界**（不要夸大）：

- **仍然生效**：`grep` 的 `operations.isDirectory` 仍是 `guarded(...)`（`:189-192`），
  所以**搜索根本身在允许根之外仍会被拒**；`find` 的搜索根判定走
  `guardSearchRootCall`（定义级 `execute` 包装，`:71-82`），与 `operations` 无关，**不受影响**。
- **失效**：上下文行的**逐文件读取**不再经过守卫。也就是说：ripgrep 在自己进程里读文件，
  守卫看不见。在允许根内部通过**符号链接**指向根外的文件，上下文行会露出来。
  匹配行本身在 0.99.2 就由 ripgrep 提供（同一份 `grep.js` 的 `rg --json` 事件），
  **从未**经过 `readFile` —— 所以这次缩水的范围是「上下文行」，不是「全部」。

**修法（升级票里做）**：`readFile` 是 `@deprecated` + 可选，**删掉它是安全的**（不会类型报错），
但要补回等效边界，两条路：

- **A（推荐，与上游建议一致）**：把判定上移到**定义级 `execute`**，与 grep 的
  `find` 兄弟实现同形（`lib/tool-path-guard-extension.ts:71-82` 已是这个模式）——
  `guardSearchRootCall(input, ctx?.cwd || cwd, scope)` 已在 `execute` 里跑过，
  所以还需要的是「结果里的路径逐个校验」或在 `execute` 后用 `containsPath` 过滤。
- **B**：接受缩水，并在 ADR-0011 里显式记下「grep 的上下文行由 ripgrep 读，不经 `readFile`」。
  （成员 bash 的整套进程沙箱仍在——ADR-0012 的 allow-only profile 会拦住根外读取，
  所以对**成员会话**而言缩水被沙箱覆盖；**人类会话不受沙箱保护**，只有路径守卫。）

**注意一个陷阱**：`readFile` 从必需变可选，`tsc` **不会**报
（提供可选字段是合法的），运行时也**不会**报错 —— 这是全报告里唯一一处
「改了上游行为、类型层恰好允许、运行时恰好不炸、只是安全面缩水」的变更。

### 8.3 `BashOperations` / `getShellConfig` —— **零差异**

- `dist/core/tools/bash.d.ts` 的全文差异只有 §8.1 那两类；`BashOperations` 与
  `BashOperations.exec` 的声明**没有出现在 diff 里**。
  `lib/bash-containment-extension.ts:119-160` 的实现（自建 spawn、显式 env、
  `getShellConfig(shellPath)`）**一行都不用改**。
- `dist/utils/shell.d.ts` **零差异**，`getShellConfig` 签名不变。

### 8.4 `ExtensionAPI` / `ExtensionFactory` / `ToolDefinition.execute`

- `ToolDefinition`（`dist/core/extensions/types.d.ts`）两版**唯一差异**是新可选字段
  `reachesTools?: (input: Record<string, unknown>) => "all" | readonly string[]`。
  `execute(toolCallId, params, signal, onUpdate, ctx)` 的 **5 参签名逐字相同** ——
  这是 `lib/tool-path-guard-extension.ts:64-68` / `:78-90` 与
  `lib/bash-containment-extension.ts:357-366` 全部 `{...definition, execute: async (…5 参) => …}`
  的承重签名，**未变**。
- worksplice 的注册模式是 `{...definition, <覆盖字段>}`（spread），对「新增可选字段」天然免疫。
- `ExtensionAPI` 新增 `registerToolRenderer`、`registerMarkdownTransformer` 加可选第 2 参、
  `ctx.ui.custom` 加可选 `blocked` —— **全是加法**，且本仓一个都不用。
- `ExtensionFactory` 声明未在 diff 中出现 ⇒ 相同。

### 8.5 `before_agent_start` union —— 对本仓无害，但必须记下理由

`BeforeAgentStartEvent` 从单接口变成
`BeforeAgentStartUserEvent | BeforeAgentStartCustomEvent`，两者共有
`{ type; readonly systemPrompt; systemPromptOptions }`，并新增**必填** `messageType`。

本仓的处理器是 `pi.on("before_agent_start", () => (switchState.enabled ? { systemPrompt: "" } : undefined))`
（`lib/rpc/forced-empty-system-prompt.ts`）—— **零参数**，所以 union 化不影响它。

**但 `lib/rpc/forced-empty-system-prompt.ts` 的注释引用了一处上游实现行号**
（`pi-coding-agent's extensions/runner.js:1137-1143`）。1.5.2 里那段仍在
（`dist/core/extensions/runner.js:1138` 的 for 循环、`:1143` 的 `type: "before_agent_start"`、
`:1151-1153` 的 `result.systemPrompt !== undefined` 写入 `currentOptions.forceSystemPrompt`），
**行号基本没漂**。⇒ 机制成立，注释只需微调（升级票顺手做）。

---

## 9. Q7 trust 与资源配置

| 符号 | 类型面 | 行为面 |
|---|---|---|
| `ProjectTrustStore` | **零差异**（`dist/core/trust-manager.d.ts` 全文相同） | 见下 |
| `hasTrustRequiringProjectResources` | **零差异**（同文件） | 见下 |
| `DefaultResourceLoader` | 兼容：`ResourceLoaderOptions` 新增可选 `disabledBuiltinExtensions?: string[]`（`resource-loader.d.ts:84`）、类新增 `private getExtensionPathKey` | 无影响 |
| `DefaultPackageManager` | 兼容：`PathMetadata` 新增可选 `changelogPath?`、`ResolvedPaths` 新增可选 `installFailures?`、`ProgressEvent.type` 联合新增 `"result"`（`package-manager.d.ts:32-43`） | `app/api/plugins/route.ts` **不消费** `ProgressEvent` 的 `type`（`grep "ProgressEvent\|\.type ==="` 零命中）⇒ 无需改 |
| `SettingsManager` | 兼容（见 Q1 表第 22 行） | 见下 |
| `ModelRuntime` | 兼容：仅新增 `settleCredentialWrites()`（`model-runtime.d.ts:95-99`） | 无影响 |
| `resolveModelScopeWithDiagnostics` | **签名相同**（`model-resolver.d.ts:79`）；`ModelScopeDiagnostic.code` 联合新增 `"ambiguous"` | **行为变**：见下 |
| `buildSessionContext` / `buildContextEntries` / `parseSessionEntries` | **全部相同**（`session-manager.d.ts:202` / `:198` / `:183` 均未在 diff 中出现） | 无影响（`SessionEntry` 联合也未变，见 Q3） |

### 9.1 `resolveModelScopeWithDiagnostics` 的行为变化（R3）

`lib/model-scope.ts:71-72`：

```ts
const { scopedModels, diagnostics } = await resolveModelScopeWithDiagnostics(cleaned, modelRuntime);
const warnings = diagnostics.map((diagnostic) => diagnostic.message);
```

1.5.2 的 `resolveModelScopeFromModels` JSDoc（`model-resolver.d.ts:71-77`）明写：

> Every model in `models` is usable, so credentials cannot choose between providers offering the
> same id. All of them are added, with a warning so the user can pick one with `provider/id`.

`CHANGELOG.md:333`（1.3.0）是同一件事的用户可见版本。

**后果**：`enabledModels`（`lib/model-scope.ts` 的输入）若含跨 provider 同名的模式，
升级后返回**多份模型**而不是按 catalog 顺序选一份，且多出 `ambiguous` 警告。
`lib/model-scope.ts:72` 只取 `message`，所以新 `code` **不会导致类型报错**（`code` 未被使用）。
⇒ **UI 上会看到重复条目 + 一句警告。** 半沉默，列 R3。

### 9.2 trust 语义（值得记，不是破坏）

`CHANGELOG.md:173`（1.5.0）：保存的 "Do not trust" 现在优先；auto-trust 只在没有保存决定时生效。

`lib/project-trust.ts:4-13` 的逻辑是：

```ts
const requiresTrust = Boolean(cwd) && hasTrustRequiringProjectResources(cwd);
if (!requiresTrust) return { requiresTrust: false, trusted: true };   // ← 提前返回
const trustStore = new ProjectTrustStore(agentDir);
return { requiresTrust: true, trusted: trustStore.get(cwd) === true };
```

⇒ 当一个项目**没有 trust-requiring 资源**（例如只有 `AGENTS.md`）但 `trust.json` 里存了 `false` 时，
worksplice 报 `trusted: true`，而 1.5.2 的 SDK 会按保存的决定报 untrusted。
**这是一处既有的语义分歧**，1.5.2 只是把 SDK 侧修成了「保存的决定优先」。
⇒ **不是升级引入的破坏**；但升级后若观察到「worksplice 说信任、SDK 说不信任」，
应把 `lib/project-trust.ts` 的提前返回改成先查 `trustStore`。列进 §10 观察项。

### 9.3 `SettingsManager` 的行为面

本仓用到的 14 个方法签名全部未变（Q1 表第 22 行）。新增的都是没人调的方法
（`get/setExtensionChangelogVersion`、`get/setSessionShareDestination`）。
唯一签名变化 `get/setQuietStartup`（`boolean` → `QuietStartup` 联合）本仓零调用。

`Settings` / `PackageSource` 等类型从 `settings-manager.d.ts` 搬进 `settings-schema.d.ts` 再由前者
`export type {...}` 转出 ⇒ **import 路径不变**。`PackageSource` 的结构与 0.99.2 手写类型逐字段相同
（`settings-schema.d.ts:67-74`）。

**一个未验证的风险（列 §12）**：1.2.0 起 settings 有了生成式 schema，
但 `dist/core/settings-manager.js` 里 `grep "SettingsSchema\|validateSettings"` **零命中**
⇒ 读写路径**没有**在 `SettingsManager` 内做 schema 校验。所以 worksplice 写入的 settings
不会被新 schema 拒。这条是「读了实现没找到校验」，不是「上游保证不校验」。

---

## 10. Q8 升级步骤与验证清单

### 10.1 可执行升级清单（给升级票，本票不做）

**第 1 步 — 四包同改的 pin（原子）**

- `package.json:57-60` 四行 `"0.99.2"` → `"1.5.2"`；
- 追加 `undici` 对齐：`package.json:67` `"8.5.0"` → `"8.12.3"`（Q4 推荐选项，可与本步同批）。
- 用 **`bun install`**（`package.json` 的 `preinstall` 会拒 `npm install`，
  判定矩阵见 `bin/install-guard.js:13-21`；纪律见 `AGENTS.md` Quick Start）。

**第 2 步 — lockfile 复核（`bun install` 之后立刻做）**

```bash
# 四个包在 lockfile 里都必须是 1.5.2
grep -n '"@earendil-works/pi-' bun.lock | grep -c '1\.5\.2'      # 期望 >= 4
# 五个 pi 包只剩一套版本：不应再出现 0.99.2
grep -c '0\.99\.2' bun.lock                                       # 期望 0
# undici 只剩一条（Q4 对齐成功；不对齐则期望 2）
grep -c '^    "undici"' bun.lock                                  # 对齐后期望 1
# chord 必须消失
grep -c '@earendil-works/chord' bun.lock                          # 期望 0
# pi-schema 必须出现
grep -c '@earendil-works/pi-schema' bun.lock                      # 期望 >= 1
# typebox 仍在（pi-coding-agent 的直接依赖）
grep -c '"typebox"' bun.lock                                      # 期望 >= 1
```

**第 3 步 — `node_modules` 清不清**

**清。** `rm -rf node_modules` 后重装，理由：`pi-agent-core` 删掉了整片子路径
（§7.3），bun 在 `node_modules` 里的**嵌套布局会变**（`chord` 消失、
`undici` 若对齐则嵌套副本消失）。留着旧树会让 `.next` 的 stale 解析掩盖真问题。
**不要动 `.next/`** —— 但 dev 期间也**不要跑 `next build`**（`AGENTS.md` 的既有禁忌）；
构建验证放在独立的 CI 步骤里做。

**第 4 步 — `tsc` 先跑，再改代码**

```bash
node_modules/.bin/tsc --noEmit
```

预期报错（**本报告预判，实测未做**）：

- `lib/tool-path-guard-extension.ts` 的 `*Operations` 字面量：`GrepOperations.readFile`
  现在可选 ⇒ **不报**（提供可选字段合法）。
- `BeforeAgentStartEvent` union：本仓处理器零参数 ⇒ **不报**。
- `AgentSettledEvent.aborted` 必填 ⇒ 本仓不构造这个对象 ⇒ **不报**。
- `ToolInfo` 多 `reachesTools` ⇒ 本仓的镜像更窄，单向兼容 ⇒ **不报**。
- `Theme` 构造 ⇒ 等价 ⇒ **不报**。

⇒ **预计 0 错误**。这本身就是一条重要信息：**这次升级 `tsc` 可能一句都不说，全靠实跑。**

**第 5 步 — 改代码（三处，全部已知）**

1. **删掉导出 HTML 的补丁块**（`app/api/sessions/[id]/export/route.ts:140-214` 三个
   `replaceRequired(...)` 调用）。理由见 §4.11/R4：上游已把递归改迭代，锚点字符串不存在了，
   补丁**不再需要**且会抛错。**注意**：不要只「更新锚点」，要**删除语义**——
   上游的实现已经是 worksplice 想要的形态（`template.js:157-162` 的显式栈、`:188-201` 的后序栈）。
2. **`lib/rpc/session.test.mjs` 的 schema 路径**：`dist/modes/interactive/theme/theme-schema.json`
   不存在了，改读 `schemas/theme.schema.json`（`required` 仍是 51 项，断言内容不用改）。
3. **grep 守卫**（§8.2）：删掉 `lib/tool-path-guard-extension.ts:193` 的死 `readFile`，
   按选项 A 把边界补到 `execute` 层，或按选项 B 在 ADR-0011 记下缩水。

**第 6 步 — `serverExternalPackages` 不动**

`next.config.ts:31-38` **零 diff**（§7.1）。唯一复核动作：构建后确认 `.next/server` 内不出现
`pi-schema`（写法照 `docs/pi-sdk-upgrade-spike.md:493-495` 的探针）。

### 10.2 升级后必须实跑的最小验证清单

本报告**没有跑过其中任何一项**（本票只读）。以下按「能抓到哪条风险」组织，不是随便列的冒烟清单：

| # | 验证动作 | 抓的是哪条 |
|---|---|---|
| **V1** | `npm run dev` 起得来，首页与会话列表正常 | 通用（`PlainTextTheme` import 期崩溃那一类，上一轮就栽在这里） |
| **V2** | 建一个 agent（`POST /api/members`）+ 建会话，跑完一轮真实会话 | 通用；顺带覆盖 `run 启动期即 busy`（§4.5） |
| **V3** | **`toolNames: []` 建会话**（PRESET_NONE），确认 `before_agent_start` 通道仍把 prompt 清成空 | R5 的 `BeforeAgentStartEvent` union；这是上一轮炸过的那条路径 |
| **V4** | **任务板 claim → complete**（含一次 claim 被 hold 让路的场景） | `agent_settled`/settle 语义；`lib/agent-loop` 全链路 |
| **V5** | **成员会话里让 bash 撞墙**（读允许根外文件）→ 确认沙箱归因文案与拒绝行为不变 | §8.3 的 `BashOperations`；ADR-0012 |
| **V6** | **成员会话里用 grep 搜一个带 `context` 的路径，且搜索路径放在允许根外** → 确认**搜索根仍被拒** | R1 / §8.2 的「仍生效」那一半 |
| **V7** | **人类会话里 grep 一个符号链接指向根外的目录，带 `context`** → 确认上下文行是否露出 | R1 / §8.2 的「失效」那一半（**新风险，必须实测**） |
| **V8** | **导出一次会话 HTML**（`/api/sessions/[id]/export`）→ 应**先红**（证明 R4 真实），改完代码后**转绿** | R4 |
| **V9** | ModelsConfig 打开 → 能读模型列表 → 测一次模型连通性 | `ModelRuntime` / `resolveModelScopeWithDiagnostics` / R3 |
| **V10** | **PRESET_NONE 会话发一条消息**，抓请求体确认 `tools` 字段**是否存在** | §4.9 的 `"tools": []` 改动 |
| **V11** | 用 Anthropic provider 跑两轮，第 2 轮确认增量消息路径正常（或按需在 `models.json` 关 `supportsMessageThreads`） | §4.9 的 message threads |
| **V12** | 成本看板读数与 SDK `getSessionStats()` 对齐 | R2 的 `cost.total` 口径 |
| **V13** | 同一 cwd 启动第二个成员会话 → 应报 `BusyCwdError` | `_startRun` 让 busy 提前后，cwd 互斥是否出现时序漂移 |
| **V14** | `npm test` 全绿（当前基线见 `docs/pi-sdk-upgrade-assessment.md` §6 的「868 pass」；本次未重跑） | 回归网 |
| **V15** | `npm run build` exit 0，且 `.next/server` 无 `pi-schema` | §7.1 |

**V3 / V7 / V8 是三条「只有本次升级才需要」的验证**，其余是常规回归。
V8 必须**先观察到红**再修——否则你不知道 R4 是真的还是自己想多了。

---

## 11. Q9 结论

### 结论：**升**，以「一个原子切片 + 一次实跑」的形态升，目标 `1.5.2`

不做「分段升」（先 1.0 再 1.5）。理由不是图省事，而是**分段没有任何中间收益**：

- **类型面几乎不变**（44/44 导出在、43/43 镜像成员在、26/26 方法签名相同）
  ⇒ 中间版本拿不到「先把类型磨平」的渐进收益。
- **breaking 分散在 1.0.3 / 1.2.0 / 1.5.0 / 1.5.1 四个版本**，
  中途停在任何一个都要付一次实跑成本，而不是分期付款。
- **内部依赖从 caret 改精确**（1.3.0，`CHANGELOG.md:329`）意味着停在 1.2.x 会得到
  一套 caret 树 + 一套精确树混着的 lock，与最终形态不一致，复核口径要写两遍。

### 代价量级

| 面 | 量级 |
|---|---|
| 类型面改动 | **0 处预判**（`tsc` 预计全绿）——这既是好消息也是最危险的地方 |
| 代码改动 | **3 处**：删导出补丁块（~60 行删除）、改一处测试路径（1 行）、补 grep 守卫（~10 行）|
| 依赖改动 | **2 行 pin**（四个 pi 包）+ 1 行 `undici`；`serverExternalPackages` 零改动 |
| 实跑成本 | **15 项**，其中 3 项为本次特有（V3 / V7 / V8） |
| 风险敞口 | 2 处安全/口径面（R1 / R2），都**不会**被 `tsc` 或 `npm test` 抓到 |

### 风险排序（按「会不会静默变行为」）

1. **R1 · grep 上下文行绕过路径守卫** —— 完全静默。`tsc` 绿（可选字段）、运行时无错、
   `npm test` 大概率绿（没有针对「符号链接 + context」的用例）。**唯一防线是 V7 实测。**
2. **R2 · `Usage.cost.total` 从估算变实付** —— 完全静默。字段名、类型、代码全不变，
   只有数字口径变。**防线是 V12 + 一句文案。**
3. **R3 · `enabledModels` 跨 provider 歧义** —— 半沉默（有 warning 文案，`lib/model-scope.ts:72`
   会显示）。防线是 V9。
4. **R5 · 类型面三处变化** —— 响亮（`tsc`）。但**预判 0 错误**，所以实际防线是 V3。
5. **§4.5 · run 启动期即 busy** —— 推理上是改善，但没有证据。防线 V2 / V13。
6. **R4 · 导出 HTML 三锚点消失** —— 响亮（`replaceRequired` throw）。防线 V8（先红后绿）。
7. **R6 · Azure provider 改名** —— 响亮（模型消失 / 会话回落）。对使用 Azure 的实例是硬迁移。
8. **§7.1 · `pi-schema` 是否需 external** —— 预判不需要，响亮（构建失败）。防线 V15。

### 一句话判断

> **升。这次升级的钱几乎全花在「上游把我们的自研补丁变成了内置能力」和
> 「上游把我们的安全钩子悄悄停掉了」这两件事上；前者要删代码，后者要补边界。
> 类型层这次不会救我们。**

---

## 12. 未答问题与局限

| 条目 | 为什么没有答案 |
|---|---|
| **1.5.2 的运行时是否有回归** | 本票**未装包、未实跑**。所有 `dist/*.js` 结论都是**读源码**得到的（例如 `grep.js` 里 `readFile` 零出现），不是运行观测 |
| **`_startRun` 提前置 busy 对 `lib/cwd-mutex.ts` 的实际影响** | 需要实跑观测事件时序（V2 / V13）。本报告只给了调度路径的静态对照 |
| **`SettingsManager` 是否会在别处做 schema 校验** | 只在 `dist/core/settings-manager.js` 里 grep 过 `SettingsSchema` / `validateSettings`（零命中）。**没有审计整条写入链**（`writePrivateFileAtomicSync` 一侧是 worksplice 自己的代码，不受影响；pi 侧的其它写入口未穷举） |
| **`toolNames: []` 在 OpenAI 兼容端点上的实际请求体** | 1.5.1 说「不再发 `"tools": []`」，但**本文没有抓包验证**。V10 就是这条 |
| **Anthropic message threads 对本仓成本口径的量化影响** | 只知道「请求只发增量」，不知道 token 记账在 SDK 侧怎么折算到 `Usage`。需要 V12 加上一轮两轮实测 |
| **`brace-expansion@5.0.12` 是否引入行为变化** | 只核了它有 GHSA 历史与版本号（`CHANGELOG.md:1367` 记 8.9.0 时代已带 5.0.9）。它是 `minimatch@11` 的依赖，位于已 external 的 pi 包之下，对本仓代码无直接影响 ⇒ **未深挖** |
| **`pi-ai` / `pi-tui` / `pi-agent-core` 的细节差异** | 只核到「本仓用到的符号」这一层（`pi-ai` 10 个、`pi-tui` 2 个、`pi-agent-core` 5 个）。这三个包的完整 changelog 未逐条读（它们的 tarball 里没有独立 CHANGELOG；变化从 `pi-coding-agent` 的 changelog 与 `.d.ts` 反推） |
| **`1.5.2` 之后的版本** | 明确不在范围。评估时 `dist-tags.latest` = `1.5.2`，之后若再有发布需重新评估增量 |
| **1.0.0 之前 0.99.2 那一段** | 上一轮评估（`docs/pi-sdk-upgrade-assessment.md`）已覆盖，本报告不重复 |
| **票据文件** | 本任务 worktree **不存在** `.scratch/pi-sdk-152-assessment/`。故「Status 流转 / Answer 追加到票据」无对象可做；`Answer` 内容落在 `worker_done` 摘要与本文件里。**这不影响交付**（唯一交付物是本文档 + PR） |

**两个「读实现得出的、不是契约」的结论**，用的时候要知道分量：

1. 「`serverExternalPackages` 不用加」继承自上一轮**实跑**结论
   （`docs/pi-sdk-upgrade-spike.md` §4.1），但本轮新增的 `pi-schema` **没被那次实跑覆盖**。
2. 「`SettingsManager` 不做 schema 校验」是 grep 实现得出的负证据，**不是上游承诺**。

---

## 13. 本研究不做什么

1. **不做升级实施。** 不改 `package.json` / `bun.lock` / `node_modules` / 任何源码 / 任何已有文档。
   升级是后续票（§10 已给出可执行清单与门禁）。
2. **不跑门禁。** 本票 diff 只有一个 Markdown 文件，没有被测对象：
   `npm test` / `tsc --noEmit` / `npm run lint` / 双轴 code-review **全部不适用**
   （理由同 `docs/pi-sdk-upgrade-assessment.md` §6 末尾「本票不跑的门禁」）。
3. **不实跑升级后的验证。** §10.2 的 15 项全部是**给升级票的清单**，本研究一项未做。
   本报告所有「运行时行为」结论来自**读 tarball 内的 `.js`**，不是观测。
4. **不评估 `1.5.2` 之后的版本。**
5. **不对 `pi-ai` / `pi-tui` / `pi-agent-core` 做完整差异审计**（只核到本仓用到的符号层）。
6. **不修 `docs/pi-sdk-upgrade-assessment.md`。** 上一轮那份评估是历史记录，
   本报告发现的需要更正之处（例如主题 schema 路径、导出锚点）**只在本文档里写**，
   不回填旧文档。
7. **不创建票据。** 见 §12 最后一行：worktree 内无票据文件，本报告不新增 `.scratch/` 条目
   （超出本票文件所有权）。
8. **不上游提问 / 不查 upstream issue。** 全部结论来自 tarball 与 registry metadata；
   上游未在 changelog 说明的，本文档写「未说明」而不编理由
   （本次没有遇到这种情况——1.0.0–1.5.2 的 changelog 相当完整）。

---

## 14. 证据索引

### 14.1 上游一手来源（tarball 内路径，均相对 `package/`）

| 结论 | 出处 |
|---|---|
| 12 个新版本、6 条 minor 线、`latest` = 1.5.2 | `npm view @earendil-works/pi-coding-agent time --json`、`npm view … dist-tags --json` |
| 四包内部依赖改精确版本 | `pi-coding-agent@1.5.2` `package.json` `dependencies`；`CHANGELOG.md:329` |
| 依赖增减（chord 移除、pi-schema 新增、lovely-mermaid 替换 grok-mermaid、brace-expansion 提升、typebox 保留、undici 8.12.3） | `pi-coding-agent@1.5.2` 与 `@0.99.2` 的 `package.json` 逐字段对比；`pi-ai@1.5.2` / `pi-agent-core@1.5.2` 的 `package.json` |
| `engines.node >= 22.19.0` 四包不变 | 同上 |
| `exports` 删 `./client`、`./experimental/plugin` | `pi-coding-agent@1.5.2` `package.json` `exports`（仅剩 `.` 与 `./rpc-entry`）；`CHANGELOG.md:413` |
| `pi-agent-core` 删 `./harness/*` `./search/*` `./node` `./experimental/pico3` | `pi-agent-core@{0.99.2,1.5.2}` `dist/index.d.ts` 与 `package.json` `exports`；tarball 体积 4.8 MB → 332 KB |
| `dist/index.d.ts` 两版仅 4 处纯加法差异 | `pi-coding-agent@{0.99.2,1.5.2}` `dist/index.d.ts`（43 → 44 行） |
| 44 个符号全部仍在 | 逐符号 `\b<sym>\b` 命中 1.5.2 `dist/index.d.ts`（44/44，0 miss） |
| `AgentSession` 公开成员名集合相同、25 个新增成员全为 private | `dist/core/agent-session.d.ts:222`（1.5.2）vs `:208`（0.99.2） |
| `setModel` / `setThinkingLevel` + `ModelMutationOptions` 逐字相同 | `dist/core/agent-session.d.ts:687` / `:704` / `:192`（1.5.2）vs `:607` / `:624` / `:178`（0.99.2） |
| `AgentState` 字节级相同（含 `readonly systemPrompt`） | `pi-agent-core@{0.99.2,1.5.2}` `dist/types.d.ts` 的 `interface AgentState` |
| `AgentTool` 泛型默认值 `TSchema` → `object`；`AgentToolParams` 定义 | `pi-agent-core@1.5.2` `dist/types.d.ts:412`、`:418-435` |
| `AgentOptions` 仅新增可选 `identity?` | `pi-agent-core@1.5.2` `dist/agent.d.ts` vs 0.99.2 同名文件 |
| `AgentEvent` 10 个成员两版相同 | `pi-agent-core@1.5.2` `dist/types.d.ts:461` vs 0.99.2 `:450` |
| `AgentSessionEvent` 18 个字面量两版相同；`agent_settled` 加 `aborted`；`tool_execution_*` 加 `parentToolCallId?` | `dist/core/agent-session.d.ts:42-56`（`WithParentToolCallId`、`agent_settled`） |
| `SessionEntry` 7 个 entry 接口两版相同 | `dist/core/session-manager.d.ts`（`UsageEntry` / `ContextEditEntry` 两版都在）；该文件全 diff 仅 7 行（新增 `projectContextEntry`） |
| `SessionInfo` / `SessionHeader` 逐字节相同 | 同上文件 |
| `GrepOperations.readFile` 变可选 + `@deprecated` + Ignored | `dist/core/tools/grep.d.ts:40`（1.5.2）vs `:28`（0.99.2）；`CHANGELOG.md:31` |
| grep 的运行时不再读文件 | `dist/core/tools/grep.js` 全文件 `readFile` **零出现**（1.5.2）；0.99.2 有 `:27` 默认实现与 `:83` 调用点；1.5.2 用 `--context`（`:99-100`） |
| `ReadOperations` 新增可选 `createReadStream` | `dist/core/tools/read.d.ts:40-53`；`CHANGELOG.md:74` |
| 六个 `create*ToolDefinition` 签名相同；`create<X>Tool` 返回类型改 `TypeBoxAgentTool` | `dist/core/tools/{read,write,edit,grep,find,ls}.d.ts` 全文 diff |
| `edit` 工具 guidelines 文案 6 条 → 2 条 | `dist/core/tools/edit.d.ts:12-13` |
| `ToolDefinition` 仅新增可选 `reachesTools`；`execute` 5 参逐字相同 | `dist/core/extensions/types.d.ts` 的 `interface ToolDefinition` |
| `BeforeAgentStartEvent` 变 union（`messageType`） | `dist/core/extensions/types.d.ts` 的 `BeforeAgentStartEventBase` / `…UserEvent` / `…CustomEvent`；`CHANGELOG.md:366` |
| `{ systemPrompt: "" }` 通道在 1.5.2 仍有效 | `dist/core/extensions/runner.js:1138-1153`；`dist/core/agent-session.js:1552`；`trigger` 带 `messageType`（`:1777` / `:1972`） |
| run 启动期即 busy | `CHANGELOG.md:367`；`dist/core/agent-session.d.ts:542-549`（`_startRun` JSDoc） |
| `Theme` 构造类型改写但语义等价 | `dist/modes/interactive/theme/theme.d.ts:46`；`theme-tokens.d.ts:240-255`；`schemas/theme.schema.json` 的 `required` = 51 项 |
| 1.5.2 无 `theme-schema.json`（搬到 `schemas/theme.schema.json`） | `find` 实测两版 `*theme*` 文件清单；`CHANGELOG.md:365` |
| Theme fallback 报错从 `undefined` 变点名 token | `dist/modes/interactive/theme/theme.js:47-57` |
| 导出 HTML 的三个锚点在 1.5.2 全部消失 | `dist/core/export-html/template.js`：`sortChildren` / `mapNodes` / `markActive` / `node.children.forEach` **各 0 次命中**（0.99.2 各 3/3/3/2 次）；1.5.2 已改成显式栈（`:157-162`、`:188-201`） |
| 导出深路径与 `exportFromFile` 仍在 | `dist/core/export-html/index.js` 两版都在；`dist/core/export-html/index.d.ts:31/36` 相同 |
| `trust-manager` / `shell` / `mime` / `frontmatter` / `diagnostics` / `agent-session-services` 零差异 | 各 `.d.ts` 全文 diff = 0 |
| `slash-commands.d.ts` 零差异 | 同上 |
| `resolveModelScopeWithDiagnostics` 签名相同、新增 `ambiguous` code、跨 provider 全加入 | `dist/core/model-resolver.d.ts:71-79`、`:60-64`；`CHANGELOG.md:333` |
| `ModelRuntime` 仅新增 `settleCredentialWrites` | `dist/core/model-runtime.d.ts:95-99` |
| `SettingsManager` 14 个在用方法签名不变；`get/setQuietStartup` 类型变 | `dist/core/settings-manager.d.ts` 全文 diff（200 行，主体是类型搬家到 `settings-schema.d.ts`） |
| `PackageSource` 结构逐字段相同 | `dist/core/settings-schema.d.ts:67-74` |
| `SettingsManager` 内无 schema 校验 | `dist/core/settings-manager.js` 内 `SettingsSchema` / `validateSettings` **零命中** |
| `Usage.cost.total` 语义变化 + `totalFromProvider` | `pi-ai@1.5.2` `dist/types.d.ts` 的 `interface Usage`；`CHANGELOG.md:156` |
| `pi-ai` 4 个符号逐字相同、`AuthEvent` 加 2 个可选字段 | `pi-ai@{0.99.2,1.5.2}` `dist/{types,models,compat,auth/types}.d.ts` |
| `pi-ai` 不再 re-export TypeBox，扩展仍可从它 import `Type`/`Static`/`TSchema` | `CHANGELOG.md:162`；`pi-ai@1.5.2` `package.json`（`typebox` 移除、新增 `@earendil-works/pi-schema`） |
| `pi-schema` 是零依赖纯 JS 校验包 | `npm pack @earendil-works/pi-schema@1.5.2` 的 `package.json`（`dependencies: null`，description `JSON Schema validation without eval`） |
| `pi-tui` 两个符号行号未变 | `pi-tui@{0.99.2,1.5.2}` `dist/keybindings.d.ts:62` / `:256`、`dist/index.d.ts:22` |
| `undici` 6 个符号两版都在 | `undici@8.5.0` 与 `8.12.3` `index.d.ts` / `types/index.d.ts` 逐符号命中 |
| Azure provider 改名（breaking） | `CHANGELOG.md:498-500` |
| 1.5.1 的 `"tools": []` 省略（breaking） | `CHANGELOG.md:32` |
| Anthropic message threads（默认开） | `CHANGELOG.md:24`、`:37` |
| 1.2.0 删 `./client` / `./experimental/plugin`（breaking） | `CHANGELOG.md:413` |
| 1.5.0 trust 保存决定优先 | `CHANGELOG.md:173` |
| 1.5.0 undici 8.12.3（安全公告） | `CHANGELOG.md:222` |
| `1.0.0` 无 `### Breaking Changes` 小节 | `CHANGELOG.md:572-617`（小节清单逐版本核对） |

### 14.2 本仓一手来源（消费侧）

| 结论 | 出处 |
|---|---|
| 四包精确 pin 在 0.99.2 | `package.json:57-60` |
| `undici` pin 8.5.0 | `package.json:67` |
| lockfile 被跟踪且四包 pin 与 package.json 一致 | `bun.lock:8-11`（workspaces 段）、`:165` / `:167` / `:171` / `:173`（包条目，带 SHA-512） |
| **undici 今天已经两份** | `bun.lock:2029`（根 `8.5.0`）+ `bun.lock:2141`（`@earendil-works/pi-coding-agent/undici` → `8.10.2`） |
| `chord` / `pi-telemetry` / `pi-codemode` / `pi-mcp` 在 0.99.2 都是传递依赖 | `bun.lock:163` / `:175` / `:169` / `:173` |
| worksplice 直接 import undici 的 6 个符号 | `lib/http-dispatcher.ts:2`（`import * as undici`）与 `:31`（`Dispatcher`）/ `:40`（`Client`）/ `:51`（`Pool`）/ `:69`（`EnvHttpProxyAgent`）/ `:77`（`setGlobalDispatcher`）/ `:82`（`install`） |
| `serverExternalPackages` 6 项 | `next.config.ts:31-38` |
| 构建期读 pi 包根 `package.json` 取 version（不受 dist 重组影响） | `next.config.ts:10-16` |
| `AgentSessionLike` 镜像 43 个成员 | `lib/pi-types.ts:128-189` |
| 镜像的唯一对撞点在 caller | `lib/rpc/caller.ts`（`new AgentSessionWrapper(inner)`） |
| `PlainTextTheme` 与两份 token 常量（41 fg + 6 bg，刻意省 5 个可选） | `lib/rpc/session.ts:135-247`（注释 `:135-151`，两份常量 `:152-207`，class `:212`，模块顶层实例 `:247`） |
| `tools: []` 是「全禁」的唯一传法 | `lib/rpc/caller.ts:81-89` |
| 强制空 prompt 走 `before_agent_start`，处理器零参数 | `lib/rpc/forced-empty-system-prompt.ts`（`pi.on("before_agent_start", () => …)`） |
| 路径守卫的 grep `readFile` 守卫（升级后变死代码） | `lib/tool-path-guard-extension.ts:188-194`（`isDirectory` 在 `:189-192`，`readFile` 在 `:193`） |
| 路径守卫的 `find` 搜索根判定在 `execute` 层（本次不受影响） | `lib/tool-path-guard-extension.ts:71-82` |
| 六个工具全部来自 SDK 工厂 + `pi.registerTool({...definition})` spread | `lib/tool-path-guard-extension.ts:56-92` |
| bash 沙箱的 `exec` 覆盖与 `getShellConfig` | `lib/bash-containment-extension.ts:119-160`、`:357-366` |
| 全仓不 import typebox | `grep -rn typebox --include=*.ts --include=*.mjs .`（排除 node_modules）**零命中** |
| 导出补丁的三个锚点与 `matches !== 1 → throw` | `app/api/sessions/[id]/export/route.ts:130-138`（`replaceRequired`）、`:140` / `:163` / `:181`（三处调用） |
| `theme-schema.json` 测试会红 | `lib/rpc/session.test.mjs:323`（相对路径读 `…/dist/modes/interactive/theme/theme-schema.json`）、`:329` / `:344-345`（断言 required）|
| 事件分派是宽松 `switch`，三处消费点只按 `type` 匹配 | `hooks/useAgentSession.ts:1088` / `:1208` / `:1218` + 兜底；`lib/agent-runtime.ts:41-48`；`lib/cwd-mutex.ts:136-137` |
| `session-reader` 的 case 覆盖与联合一致 | `lib/session-reader.ts:386` / `:400` / `:412` / `:419` / `:430` / `:433` |
| 成本聚合读 `usage.cost.total` 并校验 `number` | `lib/session-stats.ts:59` / `:68` / `:90` |
| `model-scope` 只消费 diagnostic 的 `message` | `lib/model-scope.ts:71-72` |
| `project-trust` 在无 trust 资源时提前返回 trusted | `lib/project-trust.ts:4-13` |
| 工具档位只有 7 个 builtin 名（无 `*`、无 `mcp__`） | `lib/tool-presets.ts:24-32` |
| `preinstall` 拦 `npm install` | `bin/install-guard.js:13-21`、`package.json:31` |
| 上一轮的实跑结论（传递依赖不需要 external） | `docs/pi-sdk-upgrade-spike.md:26`、`:478-535`、`:493-495` |
| 上一轮评估的门禁口径与基线（868 pass） | `docs/pi-sdk-upgrade-assessment.md` §6 末尾 |
