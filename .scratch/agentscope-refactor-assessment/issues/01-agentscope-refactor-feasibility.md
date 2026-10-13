# 01-agentScope 重构可行性研究

Type: research
Status: resolved
Blocked by:

## Question

回答「用 AgentScope 重构 worksplice 是否成立、代价是什么、该走哪条路」，产出**一手证据**的评估文档。

- **研究范围**：两侧事实基线（worksplice 规模/堆栈 vs AgentScope 三个发行物与各自版本）；
  层错位与可替换 seam（`AgentRuntime` / `LoopRuntime` 在哪、缝以下要自建什么）；
  替换面清单（pi 能力 → 现仓 `文件:行号` 落点 → 换 AgentScope 后必须重建/可委托）；
  三条路径 A（TS 底座替换）/ B（后端迁 Python 2.x）/ C（不换底座、收紧 seam + 有界 spike）的代价与风险；判据与建议。
- **必须回答的开问题**：AgentScope TS 的 `permission` 能否表达 ADR-0011 路径守卫 / ADR-0012 OS 沙箱、有无 workspace 抽象；
  TS `model` 实际覆盖哪些 provider 与凭证/OAuth 面；TS `state`/`storage` 持久化什么、有无会话记录/恢复/分叉导航/成本统计；
  TS 有无多 agent 编排；TS 工具表 vs `lib/tool-presets.ts` 的差异；Python 2.x 的 workspace/sandbox 后端清单与 service 层能力
  和 worksplice 房间语义的重叠与差异；两侧对会话文件所有权（ADR-0003/0004）有无对应物。
- **一手证据规则**：外部事实只认 registry 元数据、包内产物（`npm pack` 解包后的 `package.json`/`src`/`dist`）、
  GitHub 一手 API/raw、PyPI JSON API；博客/聚合站/搜索摘要/二手 changelog 一律不采信。本仓事实一律 `文件:行号`。
  原始输出落 `issues/evidence/`。
- **交付物**：`docs/agentscope-refactor-assessment.md`（九节结构）。
- **交付终点**：本轮**只产出评估文档，不动代码**（用户已定：动机是可行性评估）。
- **本票不跑**：`npm test` / `typecheck` / `lint` 作为验收项、双轴 code-review——零源码改动。

## Answer

详见评估文档：[docs/agentscope-refactor-assessment.md](../../../docs/agentscope-refactor-assessment.md)

要点（每条的证据与命令原文见文档对应小节；证据产物在 `issues/evidence/`）：

- **判断：条件成立（conditional），但证据不支持现在换底座。** AgentScope 与 worksplice **不在同一层**：
  worksplice 的承重部分是「房间层」（频道 + `UNIQUE(target_id, seq)` 消息序 + 每成员消费游标 + freshness-hold
  + 任务状态机与互审门 + 未读角标 + 会话文件所有权），两份 AgentScope 发行物都没有对应物；
  AgentScope 承重的是「agent 框架层」，而那正是 pi 现在占的位置。换底座只换下半，房间层一行不少。
- **路径 A（换 TS 底座）不可行的判据是成熟度倒挂**：`@agentscope-ai/agentscope@0.0.15` 是 47 文件 / 8106 行、
  15 个版本（`0.0.1` 2026-03-13 → `0.0.15` 2026-07-24）、88 stars、仓库里只有一个包 + 一个 Electron app，
  且 `permission` 子路径**只有类型词汇没有引擎实现**（全 `src` 搜 `PermissionEngine` 只有 doc 注释），
  `sandbox|workspace|chroot|seccomp|bwrap` **零命中**——ADR-0011/0012 在 TS 侧**没有可落的缝**。
- **路径 B（后端迁 Python 2.x）证据不支持**：迁移面是整个服务端（`lib` 22892 + `app` 5259 行、79 个 `route.ts`），
  代价是双语言双运行时 + ADR-0007 作废 + `lib` 下 125 个 `*.test.mjs` 测试保证归零；
  Py 侧 `channels` 是**外部平台机器人绑定**（Feishu/DingTalk/Discord），不是应用内频道，
  `consumed_seq|read_seq|freshness|base_seq|max_seq` **零命中**；且部署发行物 `agentscope-runtime@1.1.6.post2`
  钉的是 `agentscope>=1.0.14`（1.x 线），与 2.x 核心不是同一条线。
- **路径 C（推荐）**：worksplice 结构恰好支持——`lib/agent-loop/loop.ts` 全文件不 import SDK，协作域与数据层也不 import，
  pi 接触面只有 **39 文件 / 6476 行**，承重的一半（9523 行）根本不碰它；两条现存窄缝
  （`lib/agent-runtime.ts:21-30` 的 `AgentRuntime` 4 成员、`lib/agent-loop/loop.ts:106-118` 的 `LoopRuntime` 结构子集）
  已经是子座适配器，缺的只是缝以下。C 买**信息**不买能力，所以产出必须是一个可证伪的 spike 结论，
  而不是接口文档；建议 spike 以「AgentScope TS 能否承载 ADR-0011 + ADR-0012 判据」为唯一变量，三用例（越界 read 被拒 /
  `find "*" <dataDir>` 不枚举数据目录 / 沙箱封得住 worksplice 自己的端口）任一无法表达即证伪路径 A 的安全边界前提。
- **起点假设复核（我的数字 vs 票面）**：pi 源码面引用 **67 hits / 47 files**（票面 ≈71/44；71 复现为「只排 `node_modules`/`.next`」
  即把 `.scratch/` 两文件算进来，44 复现不出，以本文分层读数为准）；impl 面 **58 hits / 39 files / 6476 行**；
  适配器 5/7 个文件比票面**小 1**（计数口径差异，`git show` 三版一致，以 `wc -l` 为准）；
  规模 **53774 行 / 248 文件**与票面一致；测试 **37834 行 / 170 文件**一致；`app/api` `route.ts` **79**（票面 80）、
  引 pi 的 `route.ts` **17**（票面约 18）；`lib/domain/collab` 20/37（票面 19/37）、`lib/data` 6/2 一致、
  `lib/agent-loop` 5/12 一致、`components` 测试 30 一致。
- **票据 `E26`/`E34` 的 0 字节**：不是采集失败，**零命中即结论**——TS 无 sandbox/workspace、
  Py 无 worksplice 游标词汇；已用带退出码的写法复核（`R60`）。
- **上轮 105GB 事故**已复核：事故文件不在库，worktree 约 40MB；本轮全部采集走「`/tmp` 落地 → 拷贝入库」，
  最大单文件 148KB。

### 交付信息

- 分支：`agentscope-refactor-assessment`
- commit：`docs(agentscope-refactor-assessment): AgentScope 重构可行性评估（一手证据）`
- PR：**#184** <https://github.com/whutlichao/worksplice/pull/184>（OPEN）
- PR body：`.scratch/agentscope-refactor-assessment/pr-body.md`（按 `pr` skill 模板写：Summary / Evidence / Merge Danger；本 PR 为 two-way door、Blast Radius: none）
- 提醒：#184 是**本轮评估的交付**；它不申请开始 A/B 重构（评估结论是不换底座），也为路径 C 的后续 spike 留了入口。
