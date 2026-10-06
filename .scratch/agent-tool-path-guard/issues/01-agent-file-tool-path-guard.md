# 01-agent 文件工具的路径边界

Type: grilling
Status: resolved
Blocked by: （无）

## Question

worksplice 的身份隔离只到消息与游标这一层（频道/任务/唤醒/backfill 归属都有门禁），但 agent 调起 pi 原生文件工具时，落点是本机文件系统上的**任意绝对路径**，与它属于哪个成员无关。`~/.worksplice/worksplice.db` 一可读，注入即可拖走全部私有频道 + 成员表 + 任务表。

**决策：怎么在 pi 之上给文件工具加上按成员身份的路径约束。**

- 允许根的范围怎么定（家目录？工作区？共享项目目录？）
- worksplice 数据目录 `~/.worksplice/`（agents / attachments / worksplice.db）怎么处理
- 越界时怎么处置（静默拒绝？报错？改写路径？重定向？）
- 注入点选在哪一层（pi 扩展注册同名工具覆盖？worksplice 侧构造工具定义传入？`tool_call` 执行前钩子？）
- 覆盖哪些工具（`read`/`write`/`edit`？还是含 `grep`/`find`/`ls`？）
- bash 怎么办（完全无约束？受限 shell？）

## Notes

- 涉及文件：`lib/rpc/session.ts`（`setActiveToolsByName` 注入点）、`lib/rpc/caller.ts`（`extensionFactories` 接缝）、`lib/tool-presets.ts`（工具名单唯一来源）、`lib/data/dirs.ts`（家目录派生）、可能的新模块 `lib/tool-path-guard.ts`
- 票型：设计票（G-docs 门禁）。源码改动面必须为空；跑测试/双轴 review/浏览器几何证据均不适用
- 结论记录在 `## Answer`

## Answer

### 交付物

- `docs/agent-file-tool-path-guard.md` —— 设计文档，七节结构（Problem Statement / Solution / User Stories / Implementation Decisions / Testing Decisions / Out of Scope / Further Notes），正文中文
- `docs/adr/0011-agent-file-tool-path-guard.md` —— 新 ADR（三条件全满足，编号续到 0011）
- `CONTEXT.md` `## Language` —— 新增术语「允许根」「路径守卫」，无草案代码块

### 决策（1 轮 grilling + 人类拍定两条边界）

**核心分叉：三条注入路线，取路线 ①。**

| 路线 | 结论 | 关键理由 |
| --- | --- | --- |
| ① pi 扩展 `registerTool` 注册同名工具覆盖 | **取** | `agent-session.js:2827-2832` 定义注册、`:2856-2859` wrap 注册，同名即覆盖；走 worksplice **已有住户**的接缝 `resourceLoaderOptions.extensionFactories`（`lib/rpc/caller.ts:103`，`forcedEmptySystemPromptExtension` 已是住户）；`lib/rpc/session.ts` 主流程零改动 |
| ② worksplice 侧构造工具定义传入 | **不取** | ②a `baseToolsOverride` 虽在 `AgentSessionConfig`（`agent-session.d.ts:146`），但 worksplice 走的 `createAgentSessionFromServices`（`caller.ts:126`）**未暴露它**，要用得退回更低层 `createAgentSession` 自组 `agent`/`settingsManager`/`modelRuntime` = 重做 ADR-0007 判给 pi 的地盘；②b `customTools` 可达但机制与 ① 同源，归属更窄（构造期入参，无既有住户） |
| ③ `tool_call` 钩子前置校验 | **不取** | 拿到的 `input.path` 是**模型原始字符串**不是绝对路径，而 `resolveToCwd`/`resolveReadPathAsync` **不在包公开导出面**上（`package.json` 只导出 `.`/`./rpc-entry`/`./client`/`./experimental/plugin`），自写一份必然与上游 macOS AM/PM·NFD·花引号变体回退漂移；且 `grep.js:83` 的 `ops.readFile` 发生在遍历途中，钩子只看得到搜索根、看不到实际读了哪些文件 |

**`operations` 接缝是唯一 fs 出口**，六工具逐个取证同构：`read.js:73` / `write.js:31` / `edit.js:94` / `grep.js:57` / `find.js:65` / `ls.js:40` 都是先解析成绝对路径再碰 `ops.*`。守卫包在这里，不复刻 pi 的路径解析。

**覆盖范围 = 六工具**（人类改判，覆盖票面原写的三个）：`grep` 的 `ops.readFile` 读任意文件内容、`find` 的 `ops.glob` / `ls` 的 `ops.readdir` 泄露目录结构，与 read/write/edit 同接缝。只挡三个等于交付一个 FULL 档下执行默认「搜索一下」即可绕过的 guard。

**覆盖定义必须由 pi 造**：`createReadToolDefinition(cwd, {operations})` 一类（全部从包根导出，`index.d.ts:26`）。同名覆盖是**整条定义替换**，`_toolPromptSnippets`/`_toolPromptGuidelines`（`agent-session.js:2833-2848`）从替换后的定义重新派生——手写定义会静默丢掉 read 的 "Use read to examine files instead of cat or sed."、edit 的四条精确编辑准则、edit 的 diff 渲染。

**允许根 = `[自己的家目录, 显式绑定的项目目录]`**，根的构成复用 `lib/data/dirs.ts` 的 `agentHomeDir` + `isDerivedAgentHomePath`（ADR-0001 的「读取侧按当前 dataDir 重推」），**不新造第二套目录解析**。会话创建时算一次随会话持有（换工作区即销毁旧会话，无 stale 窗口）。

**显式不变式**（人类拍定措辞）：永不纳入允许根 = `~/.worksplice` 根本身 / `worksplice.db` / `attachments/` / 其他成员的家目录。**worksplice.db 永不可达**写成文档里最显眼的不变式。措辞上区分两件相反的事：排除的是「这个根本身可整棵可达」，不是「这个根下不许有任何路径」——成员自己的家目录 `<dataDir>/agents/<slug>-<id8>` 恰在被排除的父目录下，作为更窄的单独条目显式开口。

**排除 attachments 几乎不亏**（人类补的依据，已取证）：附件落盘 `randomUUID()` 无扩展名（`lib/domain/collab/attachments.ts:42`），真实名与消息的映射在 SQLite（`lib/data/schema.ts:96-104`），agent 本来就定位不到任何具体附件；排除真正防住的是 ls/find 枚举。写进设计理由，免得后来者为「让 agent 能看附件」重新开口子。

**共享项目目录不是漏洞**（人类要求写清）：ADR-0001 明确允许多成员绑定同一项目目录，互读写是有意设计，本票不收这个口子。

**越界处置 = 报错 + 列清单**（人类拍定）：错误文本含被拒绝对路径 + 该成员当前允许根清单。理由：只报错会让模型反复换路径烧轮次，`MUST_RESPOND_FAILURE_CAP = 2`（ADR-0005）连续失败即 cap-ack 推进游标，一次注入就能作废正常成员这一轮。**不清静改写、不静默截断**（前者让模型以为读到了目标文件，比拒绝更坏）。

**路径判定三条硬要求**：realpath（pi 的 `resolveReadPathAsync` 只归一化、**不 realpath**，根内 symlink 指向根外会通过纯前缀判定）取最深存在祖先 + basename 回退；用 `path.relative` 不用 `startsWith`（否则 `/a/bc` 命中 `/a/b`）；判定自身出错一律**拒绝**（fail-closed）。残留 TOCTOU 不处理，威胁模型是提示注入 + 模型自发越界。

**ADR：三条件全满足，故建 0011。** 已覆盖不新立：家目录两分 = ADR-0001；切分线与「同一事实不写两处」= ADR-0007；分层方向 = ADR-0008。

**术语入 CONTEXT.md**：允许根 (Allowed Roots)、路径守卫 (Path Guard)。

### Out of Scope 落点

- **bash**：明确写出「本设计对 bash 下的读取不起作用」，DEFAULT 档下 bash 是唯一剩余绕过面，本票是纵深防御一层而非隔离完成态；后续票要解决什么 + 四种可能形态（受限 shell / 路径重写 / filesystem sandbox / 收掉 bash）已列。本票不改档位。
- **HITL/审批流**：不设计。权责取「隔离优先、可观测性另议」，Further Notes 一句带过。
- **leader/委派/指派**：不引入。仓库明文反对（`docs/design-notes/discord-launch-post.md:90`、`docs/spec.md:336`、`CONTEXT.md` 把「跨频道指派」列为 _Avoid_），任务认领保持 `owner_id IS NULL` 抢占语义。
- 另含：不区分读写权限、不做 TOCTOU 加固、不做附件 agent 侧读取通路、不改消息/频道/唤醒/任务语义。

### 门禁执行情况

本票不跑测试（源码改动面为空）。机械判据自检全过：

```bash
git diff --name-only b70f78d HEAD | grep -v '^docs/\|^CONTEXT.md\|^\.scratch/'   # 空
git status --porcelain                                                          # 空（.pi-lens.json 已入 .git/info/exclude）
git diff --numstat                                                               # 无四位数以上单文件
```

PR：**#92** https://github.com/whutlichao/worksplice/pull/92