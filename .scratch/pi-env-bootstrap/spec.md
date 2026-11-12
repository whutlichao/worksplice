# pi 运行环境自举（pi-env-bootstrap）

Status: ready-for-agent

> 本文件的实测事实有三类来源，逐条标注：`实测（coordinator）`= 派活时给的已验收事实；
> `实测（本票复核）`= 本 worker 在隔离探针（`/tmp` 临时目录 + `@earendil-works/pi-coding-agent@0.99.2`）
> 上重测得到的读数；其余标仓内 `文件:行号` 或 SDK 声明位置。
> 与给定事实的差异、以及一次**已作废**的错误读数，都写在 Further Notes 的「复核读数」里。
> 本 effort 是**规划**：只产出本 spec 与一张实施票，不含任何实施。

## Problem Statement

一个新装 worksplice 的人，第一次打开会遇到一种「什么都没坏，但什么都没法用」的状态：
模型列表空、建 agent 建会话失败、登录入口后面没有凭证。而界面上没有任何一处告诉他缺的是什么。

根因不是「没装 SDK」。`@earendil-works/pi-coding-agent` 是**依赖**，它的 `bin`（`pi` →
`dist/bundle/cli.js`）也在包内（`实测（本票复核）`：tarball 的 `package.json` 里 `bin` 字段逐字如此），
所以 `npx worksplice` 之后 SDK 与 CLI 二进制**都不缺**。缺的是**配置根**：worksplice 把
`~/.pi/agent` 当成自己的配置根在用，而且**读也写**——

- 读：`models.json` 与 `auth.json`（`lib/model-listing.ts:60-61`）、`settings.json`
  （`lib/domain/collab/secretary-auto-create.ts:33`）、`sessions/*.jsonl`
  （`lib/session-reader.ts:50` 经 SDK `SessionManager.listAll`，SDK 侧按
  `join(agentDir, "sessions", …)` 解析）、`skills/`（`app/api/skills/route.ts:42`）、
  `npm` / `git` 等包资源（`app/api/plugins/route.ts:205`）、project trust
  （`app/api/project-trust/route.ts:38`）。
- 写：`models.json`（`app/api/models-config/route.ts:11`：`PUT` 直接拼到
  `join(getAgentDir(), "models.json")`）、`auth.json`（`lib/provider-credential-store.ts:79` / `:96`）。

这个目录不可用时，表现是**退化而不是报错**。`实测（本票复核）`在空 agent dir 上得到三段读数：

1. **读 settings 不写盘、不抛错**：`SettingsManager.create(cwd, agentDir)`（正确签名见
   `dist/core/settings-manager.d.ts:192`：`create(cwd, agentDir?, options?)`）成功返回一个管理器，
   目录里**一个文件都没多**；但 `getEnabledModels()` / `getDefaultProvider()` / `getDefaultModel()`
   **全是 `undefined`**。
2. **模型面退化成「无凭证可用」**：`ModelRuntime.create({ authPath, modelsPath })` 会补建
   `auth.json` 与 `models-store.json` 两个空壳（各 2 字节 `{}`）；在此之上
   `getAvailable()` 只给出内置模型（本机因环境里有 `DEEPSEEK_API_KEY` 而返回 2 个；
   清空环境变量后返回 **0** 个），`listCredentials()` 为 0。
3. **外层把这些吞成空清单**：`GET /api/models` 的 `catch { return EMPTY_MODELS }`
   （`app/api/models/route.ts`）把失败变成「没有模型」，用户看不到任何原因。

两条现成的「解法」都不成立：

1. **让用户去装/跑 CLI 没用。** bundled CLI 在空 agent dir 下跑 `--version` 不创建任何配置
   （`实测`：跑完目录仍 0 个文件；`实测（coordinator）` 同一结论）⇒ 装/跑 CLI 不解决环境缺失。
2. **让用户 `npm i -g` 装一个 CLI 更有害。** 本机 PATH 上的 `pi` 是**独立安装的 1.5.2**，
   而 bundled 的是 **0.99.2**（`实测（本票复核）`：`pi --version` → `1.5.2`；
   `PI_CODING_AGENT_DIR=<空目录> node_modules/.bin/pi --version` → `0.99.2`），
   两个不同代码版本**共享同一个 `~/.pi/agent`**。多装一个只会加深「谁在写这个目录」的歧义。

真正缺的东西只有两样：**目录骨架**，和**凭证**。而凭证这一步 worksplice 已经有面
（`ModelsConfig` 与 provider 登录/配 key），只是用户走不到那里——因为它是「配置」而不是
「修复」，没有人在他卡住的地方告诉他该去哪里。

## Solution

把「环境没起来」拆成**两个独立、互斥呈现的信号**，各自配一个修复动作，并都在用户已经会去配配置的
地方说出来。

```text
判定层（纯函数 + 注入的文件系统/模型面探测 adapter，不做写盘副作用）

  P1「环境未初始化」            P2「无可用凭证」
   settings 读不出东西           模型面读不出任何带凭证可用的模型
        │                              │
        ▼                              ▼
  初始化 ~/.pi/agent 骨架        引导进 provider 登录 / 配 key
  （已存在文件一律不覆盖）        （不动目录）

  优先级：P1 成立 ⇒ 只报 P1；P1 不成立 ∧ P2 成立 ⇒ 只报 P2；
         两者都不成立 ⇒ 提示面渲染 null（存量用户零感知）

  两档都呈现在：侧栏配置区常驻状态条 + ModelsConfig 顶部入口
```

四件事的分工固定：**判定层不做写盘副作用**（只读探测，文件系统与模型面都可注入）、
**初始化动作只补缺**（不覆盖、可重复执行、不装 CLI）、**提示面不拦路**（常驻状态条，不是模态阻塞）、
**引导复用既有 provider 面**（不新造登录流程）。每一件的取舍与可推翻性见 Implementation Decisions。

## User Stories

1. 作为第一次跑 `npx worksplice` 的用户，我希望界面直接告诉我「这台机器的 pi 配置根还没有初始化」，
   以便我不会把「没有模型可选」误判成 worksplice 坏了。
2. 作为第一次跑 worksplice 的用户，我希望有一个明确的按钮把缺的东西建起来，
   而不是被丢进一份文档让我手工 `mkdir`。
3. 作为第一次跑 worksplice 的用户，我希望初始化之后被直接送进「登录 / 填 key」，
   以便我不用自己猜下一步是什么。
4. 作为目录已经初始化、但一个凭证都没配的用户，我希望提示只说「去配凭证」，
   而不是让我再跑一次「初始化」——因为目录本身没问题。
5. 作为用环境变量提供 API key 的用户，我希望**不要**被提示「缺凭证」，
   以便我不被与自己无关的提示打扰（环境变量在本仓算合法凭证来源）。
6. 作为已经配好环境的用户，我希望升级到带这个功能的版本后**看不到任何新东西**，
   以便我不被与自己无关的提示打扰。
7. 作为已经配好环境的用户，我希望这个功能**绝不会覆盖**我已有的 `models.json` / `auth.json` /
   `settings.json`，以便它永远不会成为一次配置事故的来源。
8. 作为已经配好环境的用户，我希望重复点「初始化」是幂等的，
   以便我误点两次也不会看到任何变化。
9. 作为用户，我希望提示出现在我平时配配置的地方（侧栏的 Models / Skills 那一层，以及 ModelsConfig 顶部），
   以便我不需要记住一个新的设置入口。
10. 作为用户，我希望提示不要做成一个挡住界面、必须点掉才能继续的模态框，
    以便我能先看看别的东西再决定。
11. 作为用户，我希望 worksplice **不要替我 `npm i -g` 装 CLI**，
    以便它不会在我的机器上悄悄多出一个与内置版本不同的 `pi`。
12. 作为用户，我希望被告知「这个目录还有另一个 `pi` 命令也会写」这件事，
    以便我在两处改配置时知道自己在改什么。
13. 作为用户，我希望初始化失败时看到具体原因（路径不可写、权限不足等），
    以便我能自己处理，而不是再看到一次「没有模型可选」。
14. 作为用户，我希望「检测」本身不往我的配置目录里写任何东西，
    以便我拒绝初始化时环境保持原样。
15. 作为维护者，我希望「两档判定」是一层可以脱离 HTTP 与 React 单测的纯逻辑，
    以便每个分支（缺失 / 不可读 / 读抛错 / 读出为空 / 无凭证）不靠手工点验。
16. 作为维护者，我希望判定层通过注入的文件系统与模型面接口读状态，
    以便测试可以用临时目录构造每一种坏环境，而不是动本机真实的 `~/.pi/agent`。
17. 作为维护者，我希望初始化动作的输入是「目标目录」而不是隐式读环境变量，
    以便测试与将来的「自定义数据目录」共用同一条实现。
18. 作为维护者，我希望这套东西**不**引入第二份配置源，
    以便「配置在哪里」这个问题仍然只有一个答案。
19. 作为维护者，我希望这个功能不依赖任何 pi SDK 的新版本符号，
    以便它可以与 SDK 升级各自独立推进、互不阻塞。
20. 作为维护者，我希望测试明确断言「已存在文件逐字节未被改动」，
    以便「不覆盖」这条最重要的约束有机械证据而不只是注释。

## Implementation Decisions

四条设计决策均为 **coordinator 代定、用户未否决**，逐条标注来源、取舍与「可推翻」条件。
其中决策 1 在本次规划中经一次裁决改成「两档独立判据」（**C 改良**，裁决原文要点见 Further Notes）；
实施票如再发现与代码现实冲突，必须先 ask 回来，不许默默改判。

### 决策 1：检测判据 = 两档独立信号（P1 环境未初始化 / P2 无可用凭证）

**来源：coordinator 代定（本次经 C 改良裁决），可推翻。**

判定拆成两个信号，各自独立成立、互斥呈现：

#### P1「环境未初始化」——修复动作 = 初始化骨架

任一成立即 P1：

| 分支 | 判据 | 如何观测（实施票照着写） |
| --- | --- | --- |
| a | `agentDir` 路径**缺失** | 对 `getAgentDir()` 的返回值做 `existsSync`（或 `stat` 抛 `ENOENT`） |
| b | 路径存在但**不可读**（权限或 IO 错误） | 对该目录做一次读目录 / `stat`，捕获非 `ENOENT` 的错误 |
| c | **settings 读取抛错** | `SettingsManager.create(cwd, agentDir)` 抛错（**注意签名**：`create(cwd, agentDir?, options?)`，`dist/core/settings-manager.d.ts:192`；不带 `cwd` 调会得到与配置根无关的假阳性） |
| d | **settings 读出为空** | 同一个管理器实例上 `getDefaultProvider()` 与 `getDefaultModel()` 均为 `undefined`/空，**且** `getEnabledModels()` 为 `undefined`/空 |

**P1(d) 是最该被测试锁住的一条**：`实测（本票复核）`在空 agent dir 上，`a` 不成立（`mkdir` 过的空目录
存在且可读）、`b` 不成立、`c` 不成立（不抛错），**只有 `d` 成立**——三条 settings 读数全 `undefined`，
且目录里一个文件都没多。也就是说：空目录这个最主要的坏环境，**全靠 `d` 兜住**。

观测纪律：**P1 的观测不得写盘**。`SettingsManager.create` 本身不写（实测目录零文件），
所以 P1 只能用 settings 面；**不要**用 `ModelRuntime.create` 去判 P1——它会补建
`auth.json` / `models-store.json` 两个空壳（实测），把「目录是空的」这个事实改掉，
于是「检测」本身变成了修改。

#### P2「无可用凭证」——修复动作 = 引导配凭证（不动目录）

判据：**模型面读不出任何带凭证可用的模型**（列表为空，或列表里的 provider 全部未配置凭证）。

| 观测点 | 用法 |
| --- | --- |
| `ModelRuntime.create({ authPath, modelsPath, allowModelNetwork: false })` 后 `await getAvailable()` | 长度 `0` ⇒ P2 成立。同步版可用 `getAvailableSnapshot()`（同一份快照） |
| 交叉验证 | 对列表里每个模型的 provider 调 `getProviderAuthStatus(provider).configured`（或 `hasConfiguredAuth(provider)`）；全部 `false` ⇒ P2 |
| 反例（必须覆盖） | **环境变量也算凭证**：本机 `DEEPSEEK_API_KEY` 在环境中时，空 agent dir 下 `getAvailable()` 返回 2 个模型、`authStatus.source === "environment"`。所以「`auth.json` 不存在」**不等于**「无凭证」——P2 只能从模型面读，不能从文件面推 |

P2 观测的写盘副作用（`auth.json` / `models-store.json` 空壳）是 **SDK 自身行为**，不是我们的初始化动作；
测试要断言「P2 观测不改用户已有文件内容」（预置内容前后逐字节相同）。

#### 优先级与互斥

- P1 成立 ⇒ **只报 P1**（先初始化，再谈凭证）；
- P1 不成立 ∧ P2 成立 ⇒ **只报 P2**；
- 两者都不成立 ⇒ 提示面渲染 `null`（这就是「存量用户零感知」的验收形态）。

#### 为什么不是「四档并集」（关键取舍）

派活时的初版判据是「缺失 / 不可读 / `settings.json` 读取抛错」并建议把「骨架文件缺失」并进去。
本次裁决否掉了这个方向：**两档都从「读出来的状态」判，不枚举文件是否存在**。
理由是四档并集会**误报**：`auth.json` 在、`models.json` 不在、而模型**可用**（例如凭证全走环境变量）的环境，
按「骨架文件缺失」会被判成 P1 并要求初始化——用户什么都没坏，却被要求「修复」。
相反，P1(d) 读的是 settings 的实际产出、P2 读的是模型面的实际产出：**读不出东西**才是证据，
「少了某个文件」不是。

**可推翻**：如果实施时发现 `d` 会误伤一类真实用户（settings 为空但环境凭证完整、且用户从不想要
`settings.json`），可以把 P1(d) 降级成「提示但不预选初始化动作」，或把它并入 P2 的引导。
「不枚举文件存在」与「P1 观测不写盘」两条不可推翻。

### 决策 2：提示位置 = 侧栏配置区常驻状态条 + ModelsConfig 顶部入口

**来源：coordinator 代定，可推翻。**

两处入口，同一份判定结论（P1/P2 两种文案）：

- **侧栏配置区常驻状态条**：与既有 `Models` / `Skills` 按钮同层
  （`components/WorkspaceSidebar.tsx:403-417`）。选这一层的理由是「用户已经在这里配配置」，
  而且它是常驻的、不抢焦点。
- **`ModelsConfig` 顶部入口**：用户点开 Models 想找模型时，第一眼就看到「为什么这里是空的」，
  以及该点哪个按钮（P1 → 初始化；P2 → 去登录）。

取舍：不做全屏引导/首启向导（会误伤已配好的存量用户，且与 `docs/spec-bootstrap-agent.md`
的「启动助手」入口语义冲突）；不做模态阻塞（用户可能只是想先看看频道）。状态条**仅在 P1/P2
成立时出现**，正常环境下渲染 `null`。

**可推翻**：如果实施时发现侧栏底部空间已经被占满（提醒按钮 + Models + Skills + 语言选择器），
可以只保留 ModelsConfig 顶部入口 + 一个更轻的指示（例如 Models 按钮上的警示角标），
但**不能**变成模态阻塞。

### 决策 3：修复动作 —— P1 初始化骨架（不覆盖 / 幂等 / 不装 CLI），P2 不动目录

**来源：coordinator 代定，可推翻。**

- **P1 的动作 = 初始化骨架**：只做「补缺」——目录 + 目录下缺的骨架文件（`settings.json` /
  `models.json` / `auth.json` 一类空壳，以及 `sessions/` 目录）。三条硬约束：
  1. **已存在的文件逐字节不动**（不读改写、不合并、不备份覆盖）；
  2. **幂等**（第二次执行不产生任何改动，动作输出里「改动清单」为空）；
  3. **不执行 `npm i -g` / 不改 PATH / 不下载任何东西**。
- **P2 的动作 = 不动目录**：只把用户送到 credential 面。凭证不是我们能替他配的东西。

第 3 条的依据是事实：bundled CLI 已随包存在（`bin: { pi: dist/bundle/cli.js }`），且它在空目录里跑
也不写配置 ⇒ 装 CLI 既无用，又会把「本机 1.5.2 与内置 0.99.2 共享同一目录」这件事变得更乱
（`实测（本票复核）`）。

取舍：不迁移/修复「已存在但内容坏掉」的配置（自动改写用户配置风险高，且那是另一件事）。
只判定、只补缺。

**可推翻**：如果实施时发现 pi 侧另有必需的骨架文件（SDK 首次写入的清单与本 spec 不一致），
以 SDK 实际读写的文件清单为准调整骨架内容——但「不覆盖」与「幂等」两条不可推翻。

### 决策 4：P1 修复后引导 = 直接进 provider 登录 / 配 key

**来源：coordinator 代定，可推翻。**

初始化成功之后，真正的门槛仍然是凭证（P2 往往会立刻成立）。所以 P1 的动作收尾直接落到既有的
provider 面上：打开 `ModelsConfig`（`components/ModelsConfig.tsx`，已有 provider 列表、API key 存取、
OAuth/device-code 登录入口），并把「下一步：登录或填 key」作为状态条的下一句文案，
而不是让状态条消失得无声无息。

取舍：不新造登录/凭证流程（既有的 provider 面已经完整，且与 CLI 共享同一份 `auth.json`）；
不在服务端代替用户登录（凭证是人的事）。

**可推翻**：如果实施时发现「初始化后立刻打开 ModelsConfig」会让用户丢掉上下文
（例如频道里的滚动位置、正在编辑的草稿），可以改成「状态条文案变为『已初始化，去登录 →』」的
二次点击形态——引导目标不变。

### 决策 5：本 effort 只出一张实施票

判定层（两档）+ 提示面 + 初始化动作 + 引导，四件事共享同一条用户路径（检测 → 按档修复 → 配凭证）。
拆成「后端判定」与「前端呈现」两张票会得到这样的中间态：判定层做完了但界面上看不出来，
或者状态条做完了但按钮点不动——两张票单独都**不可验收**（用户看不到任何行为变化）。
所以一张票，四件事一次交付。若实施中发现判定层复杂度失控（例如需要区分多种损坏形态），
再按「判定 + 修复动作」与「提示面 + 引导」拆两张，那时拆分的依据是**每张能独立演示**，而不是分层。

### 接缝与依赖方向（谁依赖谁）

```text
lib/ 判定层（纯函数 + 注入的文件系统探测 adapter + 注入的模型面探测 adapter）
  ├─ P1 读 settings 产出（不写盘）
  └─ P2 读模型面产出（SDK 会补建两个空壳，但那不是我们的动作）
  ▲                                   ▲
  │ 查询：当前两档结论                  │ 动作：初始化骨架（输入 = 目标目录）
  │                                   │
app/api 一个查询入口 + 一个执行入口（薄封装，不含判定与写盘逻辑）
  ▲
  │ fetch
渲染层 侧栏状态条 + ModelsConfig 顶部入口 ──▶ 既有 provider 面（登录 / 配 key）
```

- 判定层**不 import** React、不 import Next、不在 P1 路径上写盘；输入是「目标目录 + 两个探测 adapter」，
  输出是纯数据结论（哪一档成立），因此可以脱离 HTTP 与浏览器单测。
- 初始化动作是**同一目录**的第二个纯动作，输入是目标目录，输出是「做了哪些改动」的清单，
  写盘经注入的文件系统接口完成。
- 两个 `app/api` 入口只做参数校验、错误映射与 JSON 编码；判定与写盘逻辑不落在路由里
  （本仓既有纪律：路由是薄封装）。
- 提示面只消费查询入口的结论，**不自己判定**（否则「判定」会分裂成两份）。
- 引导复用 `components/ModelsConfig.tsx` 的既有 provider 面，不新增凭证路径。

## Testing Decisions

### 什么算一条好测试

只断言外部行为：判定层对每种环境的结论、初始化动作在磁盘上留下的**副作用**
（哪些文件被建、哪些文件内容逐字节未变）、入口返回的 payload、界面在每种环境下的可见性。
不断言「内部调用了几次 `stat`」这类实现细节。既有先例：`lib/tool-path-guard-extension.test.mjs`
用 `fs.mkdtempSync` 造临时根再断言真实行为；`app/api/models-config/route.test.mjs:15` 说明
`getAgentDir()` 每次调用都读 `PI_CODING_AGENT_DIR`，所以把 agent 目录指向临时目录是既有做法。

### 测什么、在哪一层

**1. P1 判定（纯函数 + 注入文件系统）** —— 五条，与决策 1 的 a–d 一一对应：

- a：目录不存在 ⇒ P1；
- b：目录存在但不可读（权限位或注入 `EACCES`）⇒ P1；
- c：注入「settings 读取抛错」⇒ P1；
- **d：真正的空目录 ⇒ P1（最承重的一条）**。造法：`mkdtempSync` 后不写任何文件，
  跑判定，断言 P1 成立。这条同时锁住两件事：空目录靠 `d` 兜住、且**判定没有往目录里写东西**
  （跑完 `readdirSync` 仍为空）；
- e：正常环境（有 `settings.json` 且读得出 `defaultProvider`/`defaultModel`）⇒ P1 不成立。

**2. P2 判定（注入模型面 adapter）** —— 三条：

- 模型面返回空列表 ⇒ P2 成立；
- 模型面返回模型但每个 provider `configured === false` ⇒ P2 成立；
- **反例：模型面返回模型且 provider 有环境变量凭证 ⇒ P2 不成立**（对应决策 1 的反例行；
  真的用 `DEEPSEEK_API_KEY` 一类环境变量验证一次也行，用注入 adapter 制造即可，
  但语义必须是「environment 来源算凭证」）。

**3. 两档的优先级与互斥（同一层，纯逻辑）** —— 三条：P1∧P2 ⇒ 只出 P1；¬P1∧P2 ⇒ 只出 P2；
¬P1∧¬P2 ⇒ 结论为空（渲染层因此渲染 `null`）。

**4. 初始化动作** —— 三条：空目录跑一次骨架齐；**预置内容的文件跑完逐字节相同**（「不覆盖」的硬证据）；
连跑两次第二次改动清单为空（幂等）。另加一条：动作只碰目标目录（不碰 `cwd`、不碰别处）。

**5. 两个入口** —— 参数校验（缺参 / 非法目录）与错误映射（不可写 ⇒ 可读错误，不是 500 空体）；
成功路径返回改动清单。用临时目录，不接真库。

**6. 提示面（浏览器实测）** —— 三态：P1 环境下状态条出现且是「初始化」动作；P2 环境下状态条出现且是
「去登录」动作；正常环境下**不出现**（渲染 `null`）。用 `ego-browser` 实跑并留三张截图；
同时留一条渲染层断言锁住 `null`（本仓既有形态：`components/ChannelView.test.mjs` 这类）。

**7. 回归面** —— `npm test` 全量：本 effort 有源码改动，与纯文档票不同，全量回归是门槛。

### 不得做的事

- 不得把测试指向真实的 `~/.pi/agent`（会造成跑测试即改本机配置）。既有纪律同款：
  `lib/data/default-datadir-guard.test.mjs` 就是防「测试误用默认数据目录」的。
- 不得用「mock 掉初始化动作」来测提示面——提示面的价值就在真实点击后行为改变。
- 不得到用 `ModelRuntime.create` 去测 P1——它会写空壳文件，让「空目录」这个夹具在测中途失真。

## Out of Scope

- **本 effort 不含实施。** 只产出本 spec 与一张实施票；不改任何源码、路由与渲染层文件。
- 不 `npm i -g` 任何 CLI，不改 PATH，不改 `package.json` 的 `bin`。
- 不迁移或修复**已存在但内容损坏**的配置文件（本 effort 只判定「不可用」并补缺）。
- 不解决「本机 `pi` 1.5.2 与内置 0.99.2 共享 `~/.pi/agent`」这个版本共存问题（只在文案里告知）。
- 不新造登录 / 凭证流程，不复刻 OAuth 交互；只把用户送到既有 provider 面。
- 不引入第二份配置源、不改配置根位置（仍是 `getAgentDir()`，仍尊重 `PI_CODING_AGENT_DIR`）。
- 不做首启向导全流程（那是 `docs/spec-bootstrap-agent.md` §6.3「启动助手入口」的语义，不是本 effort）。
- 不做遥测/上报，不做自动更新 SDK。
- 不覆盖、不合并、不备份用户已有配置文件（这条再写一次，因为它是本 effort 最容易在实施时被顺手破坏的约束）。
- 不把判定结论持久化进数据库（每次都现算；环境会在外部被改变——装个 CLI、改个环境变量）。
- 不做「骨架文件是否存在」的枚举式判定（决策 1 的取舍；见 Further Notes 的裁决记录）。

## Further Notes

### 复核读数（含一次已作废的错误读数）

复核方式：在 `/tmp/piv/probe` 装 `@earendil-works/pi-coding-agent@0.99.2`（147 个包），
用 `PI_CODING_AGENT_DIR` 指向 `/tmp` 下的空目录 / 不存在目录做探针，不碰本机 `~/.pi/agent`。

| 给定事实 | 本票复核读数 | 判定 |
| --- | --- | --- |
| 事实 1：`0.99.2` 是依赖，`bin: { pi: "dist/bundle/cli.js" }` 也在包内 | 一致（tarball `package.json` 的 `bin` 字段逐字相同） | 成立 |
| **事实 2（初版）**：空 agent dir 下 `SettingsManager` 读取抛 `Cannot read properties of undefined (reading 'startsWith')` ⇒ `GET /api/models` 链坏 | **本条已作废**。coordinator 后续确认：那次探针用错了签名（写成无参 `create()`，`cwd` 为 `undefined` 才触发 `cwd.startsWith`）。真实签名是 `SettingsManager.create(cwd, agentDir?, options?)`（`dist/core/settings-manager.d.ts:192`），worksplice 在 `lib/model-listing.ts:63` 正是 `create(cwd, agentDir)`。用真实签名在空目录复测：**不抛错**，`getEnabledModels()` / `getDefaultProvider()` / `getDefaultModel()` 全 `undefined`，**目录里一个文件都没多** | **作废**；以本票复核为准（与决策 1 的 P1(d) 对齐） |
| 事实 3：bundled CLI 在空 agent dir 下 `--version` 不创建配置 | 一致（`--version` 输出 `0.99.2`，目录跑完仍 0 个文件） | 成立 |
| 事实 5：PATH 上的 `pi` 是独立安装的 1.5.2，与 bundled 0.99.2 共享目录 | 一致（`which pi` → `/Users/apple/Library/pnpm/bin/pi`，`pi --version` → `1.5.2`） | 成立 |
| 事实 6：侧栏已有 ModelsConfig / PluginsConfig / SkillsConfig 三个配置入口 | **部分不一致**：侧栏底部只有 `Models` 与 `Skills` 两个按钮（`components/WorkspaceSidebar.tsx:403-417`）；`PluginsConfig` 是导出的模块（`components/PluginsConfig.tsx:614`）但**当前没有任何挂载点**（全仓只有它自己的定义行） | 提示位置按**实际存在的两个入口**规划（决策 2 已按此写） |

补充读数（本票复核，支撑决策 1 的观测纪律）：

- `SettingsManager.create(cwd, <空目录>)` 不写盘（`after settings: []`），三条 settings 读数全 `undefined`
  ⇒ **P1(d) 在空目录上成立**，且观测本身不改环境。
- `ModelRuntime.create({ authPath, modelsPath })` 会补建 `auth.json` 与 `models-store.json`（各 2 字节 `{}`）
  ⇒ **P1 不得用它**，否则「检测」变成「修改」；P2 用它，但要知道这两个空壳是 SDK 行为。
- 空目录 + 环境里有 `DEEPSEEK_API_KEY`：`getAvailable()` 返回 2 个模型、`authStatus.source = "environment"`；
  清空环境后 `getAvailable()` 返回 **0**、`listCredentials()` 为 0 ⇒ **P2 的判据与「环境变量算凭证」**。
- `resolveModelScopeWithDiagnostics(undefined, runtime)` 会抛 `TypeError: patterns is not iterable`
  （本仓 `lib/model-scope.ts:64` 用 `(patterns ?? [])` 兜住了）⇒ 这是「settings 为空」的下游表现，
  不是 SDK 的配置根校验。

### 已裁决：决策 1 改为「C 改良」（两档独立判据）

裁决原文要点（`msg_2c9c0665dfb3`）：初版「事实 2」是错误探针（无参 `create()`，`cwd = undefined`
才触发 `cwd.startsWith`）造成的假阳性，**coordinator 自认作废**；本票复核成立。决策 1 改为两档：

- **P1 环境未初始化**（a 缺失 / b 不可读 / c settings 读取抛错 / **d settings 读出为空**）
  → 动作 = 初始化骨架（已存在文件一律不覆盖）。
- **P2 无可用凭证**（模型面读不出任何带凭证可用的模型）
  → 动作 = 引导进 provider 登录 / 配 key，**不动目录**。
- **优先级**：P1 成立只报 P1；否则 P2 成立只报 P2；都不成立则无提示。
- **关键取舍**：两档都从「读出来的状态」判，**不枚举文件是否存在**——四档并集会把
  「`auth.json` 在、`models.json` 不在、模型可用」误报成环境缺失。
- **附加要求**：P1(d) 与 P2 必须写明「如何观测」（已在决策 1 的两张表里落到具体 SDK 调用与断言形态）。

### 为什么「不覆盖」值得单独写三遍

用户已有的 `models.json` / `auth.json` 是**凭证所在地**。一次「热心的初始化」把它们覆盖成空壳，
后果是：登录态丢失、模型配置丢失、而用户完全不知道是谁动的手。所以这条约束在三处出现：
Solution 的分工、决策 3 的硬约束 1、Out of Scope 的重复声明，以及在 Testing Decisions 里以
「逐字节未改动」的断言形式落到测试上。

### 规划自审（三问）

1. **这两份 spec 是否各自可独立进入实施？**
   本 effort 的 spec 可以：判定用的 `getAgentDir()` 与 `SettingsManager.create(cwd, agentDir)`
   在 `0.99.2` 上已有（签名两版相同，见 SDK 声明位置），不依赖 `1.5.2` 的任何新符号；
   也不改 `package.json` / `bun.lock`。与 `pi-sdk-upgrade-1.5` 的唯一交集是 `~/.pi/agent`
   这个目录本身，而交集是**只读共享**（升级票不写该目录，环境票不读 SDK 版本）。
   接缝也不重叠：一份动「工具守卫 / 导出路由 / 依赖 pin」，一份动「新的判定层 + 侧栏与 ModelsConfig 的提示面」。
2. **有没有把决策藏在描述里而不是 Implementation Decisions 里？**
   四个代定决策 + 一个（只出一张票）+ 一个（接缝与依赖方向）全在 Implementation Decisions。
   Solution 只画用户路径，不新造技术选择；Further Notes 只回答「为什么这样做」与「复核读数」。
   需要说明的是：**「两档判据」与「不枚举文件存在」是本次裁决对初版判据的替换**，
   它没有被藏起来——它写在决策 1 的四档表、优先级、取舍段，以及 Further Notes 的裁决记录里。
3. **术语有没有混进 component / service / API / boundary？**
   扫过：描述代码结构只用 module / interface / seam / adapter / depth / leverage / locality
   （中文落成「模块 / interface / 接缝 / 适配器 / 深度 / 杠杆 / 局部性」）。
   检索词自检见交付记录：`component` / `service` / `boundary` 作为结构名词**零命中**
   （出现的 `components/…` 是仓内目录路径，不是用「component」指代模块）；`API` 只出现在
   `app/api/…` 这类路由路径里。

### 来源索引

| 断言 | 来源 |
| --- | --- |
| `pi-coding-agent@0.99.2` 是依赖，`bin.pi` 在包内 | `package.json:57-60`；本票复核（tarball `package.json` 的 `bin` 字段） |
| `SettingsManager.create(cwd, agentDir?, options?)` 签名；不传 `cwd` 会得到假阳性 | `dist/core/settings-manager.d.ts:192`；`lib/model-listing.ts:63`；coordinator 裁决 `msg_2c9c0665dfb3` |
| 空目录下 settings 读数全 `undefined` 且不写盘（P1(d)） | 本票复核（`SettingsManager.create(cwd, <空目录>)` 后 `readdirSync` 为空） |
| `ModelRuntime.create` 补建 `auth.json` / `models-store.json` 空壳 | 本票复核（空目录排练前后 `readdirSync` 对比） |
| 「环境变量也算凭证」（P2 反例） | 本票复核（`getAvailable()` = 2 且 `authStatus.source = "environment"`；清空环境后 = 0） |
| bundled CLI `--version` 不写配置 | 本票复核（`PI_CODING_AGENT_DIR=<空目录> node_modules/.bin/pi --version`） |
| 本机 `pi` 是 1.5.2、与内置 0.99.2 共享目录 | 本票复核（`which pi` / `pi --version` / 空目录 `--version`） |
| `~/.pi/agent` 被读的位置 | `lib/model-listing.ts:60-61`、`lib/domain/collab/secretary-auto-create.ts:33`、`lib/session-reader.ts:50`、`app/api/skills/route.ts:42`、`app/api/plugins/route.ts:205`、`app/api/project-trust/route.ts:38` |
| `~/.pi/agent` 被写的位置 | `app/api/models-config/route.ts:11`、`lib/provider-credential-store.ts:79` / `:96` |
| 模型面在失败时被吞成空清单 | `app/api/models/route.ts`（`catch { return EMPTY_MODELS }`） |
| `patterns ?? []` 兜底 | `lib/model-scope.ts:64` |
| 侧栏配置区的实际入口 | `components/WorkspaceSidebar.tsx:403-417`（Models / Skills 两个按钮） |
| `PluginsConfig` 无挂载点 | `components/PluginsConfig.tsx:614` 是唯一出现处 |
| provider 登录 / 配 key 的既有面 | `components/ModelsConfig.tsx`（`app/api/auth/*` 与 `app/api/models-config` 是它的两侧） |
| 临时 agent 目录的既有测试惯例 | `app/api/models-config/route.test.mjs:15`；`lib/tool-path-guard-extension.test.mjs:29-31`（`mkdtempSync` + `PI_CODING_AGENT_DIR`） |
| 默认数据目录的误用护栏先例 | `lib/data/default-datadir-guard.test.mjs` |
| 启动助手入口的语义（不与本 effort 混同） | `docs/spec-bootstrap-agent.md` §6.3 |
