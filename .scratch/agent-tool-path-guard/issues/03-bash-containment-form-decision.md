# 03-bash 收口的形态决策

Type: grilling
Status: resolved
Blocked by: （无，与 02 正交）

Spec: `.scratch/agent-tool-path-guard/spec.md`
设计: `docs/agent-file-tool-path-guard.md`（Out of Scope · bash 一节）

## Question

**怎么让成员调起 `bash` 时也无法越界。**

票 02 把六个文件工具收进允许根之后，`bash` 成为唯一剩余的绕过面：`cat ~/.worksplice/worksplice.db`
对它毫无阻力。`PRESET_DEFAULT`（read/bash/edit/write）档下它是**唯一**的绕过面，所以现在整个隔离
承诺的强度取决于这一块尚未处理的地基。

**要定的是一个形态取舍**，不是实现细节。至少有四条候选路径，代价与残留绕过面各不相同：

1. **受限 shell / 命令白名单解析**：把命令解析成 argv，只放行白名单内的子命令与参数形状。难在解析完备性——引号、重定向、子 shell 的逃逸面很难穷尽。
2. **路径重写（wrapper）**：把命令中的绝对/相对路径参数按允许根重写或拒绝。难在覆盖不全（`find -exec`、管道、重定向到文件、heredoc）。
3. **文件系统层隔离**：把每个成员的工作区挂进 sandbox（Linux mount namespace / bubblewrap，或 macOS `sandbox-exec`）。最强，但形态与平台相关，成本显著高于前两者。
4. **收口到「没有 bash」**：档位层面把 bash 从成员的默认工具集里去掉。最省事，但**这是产品决策不是技术题**——需要有人判断砍掉 bash 对编码工作流的代价是否可接受。

**要产出的是什么**：一个形态取舍的结论 + 对应的 ADR（若满足三条件）+ 每种候选的残留绕过面评估。
若结论是第 4 条，必须同时给出档位语义变更对既有 UI（档位展示、预设切换）的影响面清单。

## Acceptance criteria

- [x] 明确选定形态（或明确判定「四条都不做」并说明理由），不许写「都可以」「看情况」。
- [x] 每条被否决的候选附具体否决理由，不是一句话带过。
- [x] 选定形态的**残留绕过面**被写明（收口之后还有什么能越界）。
- [x] 若形态涉及档位语义变更（候选 4），列出受影响的既有面（档位展示、预设切换、既有会话的工具集推断）。
- [x] ADR 仅在三条件全满足时创建，编号续到 0012；若不建，文档里写明为什么现有 ADR 已覆盖或不满足三条件。
- [x] 结论落进 `docs/` 下的设计文档，术语决议 inline 进 `CONTEXT.md`。
- [x] **不改代码**——本票是决策票，源码改动面必须为空。若发现必须改代码，说明票型判错了。

## Notes

- 本票与 02 **无依赖**：两者正交，票 02 落地不影响本票对 bash 形态的判断（设计文档已确定
  `PRESET_DEFAULT` 档下 bash 是唯一剩余绕过面，这个事实不依赖 02 是否落地）。
- 候选 4 是产品决策。若 grilling 的结论指向它，需要人类定夺——那条不是技术问题。
- 若结论选定某形态，实施票从本票 resolved 之后另开（编号 04），不要在本票里实施。

## Answer

### 交付物

- `docs/agent-bash-containment-form.md` —— bash 收口形态决策文档（Problem Statement / Solution / 各候选的否决理由 / 排序约束 / 残留绕过面 / 实施票面 / Testing / Out of Scope / Further Notes），正文中文
- `docs/adr/0012-agent-bash-containment-form.md` —— 新 ADR（三条件全满足，编号续到 0012；决策一至六）
- `CONTEXT.md` `## Language` —— 新增术语「沙箱 (Sandbox)」；修正「允许根」词条里把沙箱列为同义禁词的旧 _Avoid_（两者现在是两层，互相指引）

### 结论一句话

**选定候选 3（文件系统层沙箱）**：判据落到**进程**而不是命令文本，沙箱由与路径守卫同一份允许根判定生成，接缝用 bash 工具既有的 `createBashToolDefinition(cwd, { operations })`；候选 1/2 否决（**不可完备**，不是解析难），候选 4 否决（推翻锁定的能力面，属产品决策，人类第 1 轮定不走）。

### grilling 轮次记录与每轮应答去向

#### 第 1 轮（Q1 形态本体）→ 人类拍定，已全部落文

| 问 | 应答 | 去向 |
| --- | --- | --- |
| 不变式钉哪一层、取哪条形态 | 钉**文件系统路径**层，取**候选 3** | 决策文档 Solution + ADR-0012 决策一/二 |
| HTTP 走廊怎么处置 | **人类改判**：不是并列残留，是**排序约束**（HTTP 票 → sandbox 实施票 → 才算收口）；且它同样使票 02 的六工具守卫失效 → 是票 02 收口的前置条件 | 决策文档 `Implementation Decisions` · 决策六 + ADR-0012 决策六；票 02 与本形态都自述为「纵深防御的一层」 |
| 秘书 curl 锁定能力面 | **不动**；HTTP 票不能简单封端口，要给它受控凭证或专用通道 | 决策文档决策六的「给 HTTP 走廊票的输入」 |
| 候选 1/2 的否决理由 | 人类认同「**不可完备**而非解析难」这个区分，并认为是本轮最有价值的东西 | 决策文档 `Implementation Decisions` · 决策一 + ADR-0012 决策一 |

#### 第 2 轮（Q2–Q5 形态内部政策）→ 答复已回收：三条人类拍板、一条 coordinator 代答

- 问的四个：allow-only vs deny-list / 凭证长尾进不进清单 / 人类 `!bash`（RPC 面）是否同收 / 非 macOS 平台姿态。ask `msg_7197e1eb023f` 挂等约 140 分钟（三次 resume 各 15/30/30 分钟），另发 escalation `msg_c5cdd5ba94a7` 与心跳 `msg_285934bc9674`；**答复在 G-docs 整改轮回收**。
- **人类的选择与 worker 推荐值逐条一致**：Q2 allow-only、Q3 用户级凭证不进清单（正解「每成员凭证」另票）、Q4 沙箱跟随会话归属的成员 —— 三条 **人类已拍板（2026-10-06）**。
- **Q5（非 macOS 姿态 fail-closed）不是人类拍的，是 coordinator 代答**：三个候选里 fail-open 与 ADR-0011 的不变式矛盾、只承诺 macOS 与 README 的三平台启动路径矛盾，只有一个选项自洽。它触及产品能力面（非 macOS 平台的成员将没有 bash），因此**保留「待人类追认」标注，并在文档里注明代答来源**。
- 三处同步：决策文档「形态内部政策」表（改为「落地值 + 状态」四列 + 表下注）、ADR-0012 的 Status 行、本小节。

### 补丁（G-docs 门禁整改，第二轮 dispatch，源码改动面仍为空）

- **章节结构收敛为 repo effort 模板七节**：`docs/agent-bash-containment-form.md` 的二级标题严格为 Problem Statement / Solution / User Stories / Implementation Decisions / Testing Decisions / Out of Scope / Further Notes。四个原自由章节**整段搬入**模板章节，无内容删除：各候选的否决理由 → `Implementation Decisions` · 决策一（候选 1/2/4 逐条 + 档位影响面清单）；排序约束 → 决策六；残留绕过面 → 「决策的后果」；后续实施票要解决什么 → `Out of Scope` 子节。
- **新增 User Stories（13 条）**：视角是「人类 Owner 想让成员的 shell 只能碰到哪些路径」，逐条对应六条决策（含成员与开发者视角各一条）。
- **不改 ADR-0012 的决策内容**——只改 Status 行；六条决策与论证保持原文。
- 整改提交：`ed2b2cb`（`docs(design): bash 收口文档对齐 G-docs 七节模板，第 2 轮政策状态更新`），仍在 PR #95 上追加，未新开 PR。

### 取证（事实部分是 worker 自己查的，不问人）

- **接缝**：`dist/core/tools/bash.js:261` 是 `ops.exec(command, cwd, {…})` 的唯一调用点，拿到的是**整条命令字符串**；本地实现 `shell -c <command>`（`:65`），执行是真的子进程树——与文件工具的 `ops.*`（已解析绝对路径）形成本票的核心对照。
- **文本判据的三条实测逃逸**：`sh <工作区内脚本>`、`node -e 'readFileSync("越界路径")'`、`P=<越界目录> bash -c 'cat "$P/secret.txt"'` 全部读出内容。
- **sandbox-exec 在 macOS 26.5.1 上仍可用**：allow-only profile 实测同时拦住根外读与根外写（`Operation not permitted`）、清单内读写放行；漏关键规则时子进程 **SIGABRT（exit 134，无 stderr）**——「脆」是它的真实成本。
- **清单长尾实测**：`git --version` 需读 `~/.gitconfig`（否则 fatal）、`node` 需可写 `TMPDIR`（否则 EPERM）。
- **网络过滤**：`(deny network* (remote ip "*:<port>"))` 只封指定端口、其它 loopback 与出网不受影响；`localhost:*` 写法会连出网一起封（本形态不使用，记坑）。
- **排序链的事实依据**：`app/api/agent/[id]/route.ts:17`/`:26` 接受任意命令 → `lib/rpc/session.ts:746` → `dist/core/agent-session.js:3037` 的 `options?.operations ?? createLocalBashOperations({ shellPath })`（裸本地实现）；`.github/SECURITY.md:28` 明说非浏览器客户端不做来源校验；`lib/domain/collab/channels.ts:7` 的 `CURRENT_MEMBER_ID` 说明进门一律按 Owner 处理。
- **env 走廊**：`getShellEnv()` 是 `{...process.env}`（`dist/utils/shell.js:117-124`）→ `WORKSPLICE_PASSWORD` 今天就在成员 shell 的环境里（实施票收掉 `WORKSPLICE_*`）。

### 门禁执行情况

本票不跑测试（决策票，源码改动面为空）。机械判据自检全过：

```bash
git diff f57bfd8 HEAD --name-only | grep -v '^docs/\|^CONTEXT.md\|^\.scratch/'   # 空
git status --porcelain                                                          # 空（.pi-lens.json 已入 .git/info/exclude）
git diff --numstat                                                               # 无四位数以上单文件
```

PR：**#95** https://github.com/whutlichao/worksplice/pull/95

