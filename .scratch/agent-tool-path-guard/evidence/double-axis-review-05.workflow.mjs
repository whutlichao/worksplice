// 双轴 code-review 的编排（ticket 05）：两个**只读** reviewer 并行跑，互不污染上下文。
// 用法：subagent({ workflow: "./.scratch/agent-tool-path-guard/evidence/double-axis-review-05.workflow.mjs" })
// 与票 02 的 evidence/double-axis-review.workflow.mjs 同款形状（code-review skill 的第 4 步）。

const repo = "/Users/apple/orca/workspaces/worksplice/sandbox-for-member-bash";
const diffPath = "/var/folders/bf/27rt5fsx01q0bq602vmhprsw0000gn/T/worksplice-review-05.diff";
const fixedPoint = "8a05a6d";

const preamble = `你在做**只读**双轴 code review（不改任何文件、不提交）。仓库：${repo}（分支 worktree）。
固定点：${fixedPoint}（main）。diff 已导出为文件（约 2000 行，含源码 + 测试 + AGENTS.md）：${diffPath}
提交序列：a50915a docs(ticket) / 2f1d84e chore(ticket) / 0cd597d feat(sandbox) / 375dc18 chore(evidence)
评审对象：ticket 05「成员 bash 落进 OS 级沙箱 + WORKSPLICE_* env 收口」（实施 ADR-0012 六条决策）。
需要看改动之外的上下文时直接读仓库文件（只读）。`;

const smellBaseline = `基线 smell（Fowler《重构》第 3 章；仓库已写明的标准优先于基线，且一律是判断题而非硬违规）：
Mysterious Name / Duplicated Code / Feature Envy / Data Clumps / Primitive Obsession / Repeated Switches /
Shotgun Surgery / Divergent Change / Speculative Generality / Message Chains / Middle Man / Refused Bequest。
工具已经能查的（格式、lint）一律跳过。`;

const standardsTask = `${preamble}
轴：**Standards** —— 这份 diff 是否遵守本仓已写下的编码标准？
标准来源（自己读，只读）：docs/engineering-standards.md、docs/i18n.md（注释/证据中文，进模型上下文的产品内容英文硬编码）、
AGENTS.md（File Map 登记约定、Key Design Decisions & Traps）、docs/agents/domain.md、.github/SECURITY.md。
${smellBaseline}
输出：逐文件/逐 hunk 报告 (a) 违反**已写明**标准之处（cite 标准文件 + 那条规则）；(b) 发现的基线 smell（点名 + 引用 hunk，一律判断题）；
(c) 有证据的既有优点（Correct）。不写泛论。结尾一行 merge verdict。**400 词以内，中文，紧凑。**`;

const specTask = `${preamble}
轴：**Spec** —— 这份 diff 是否忠实实现了票据要求的东西？
规格来源（自己读，只读）：.scratch/agent-tool-path-guard/issues/05-sandbox-for-member-bash.md（含 Acceptance criteria）、
docs/adr/0012-agent-bash-containment-form.md（六条决策 = 验收面）、docs/agent-bash-containment-form.md、
docs/adr/0011-agent-file-tool-path-guard.md、docs/adr/0013-http-corridor-caller-identity.md（决策三 env 收口）。
输出：(a) 规格要求了但缺失/半成品之处（引规格原文 + 代码位置）；(b) 超出规格的行为（scope creep，逐条判断是否越权）；
(c) 看起来实现了但方式可疑之处（引规格行）。特别核对：allow-only 与数据目录不变式、凭证面不进清单、
覆盖范围 = 会话归属的成员（工具面 + RPC 面同一判定、人类会话不沙箱）、EPERM/134 可读化、平台 fail-closed、
WORKSPLICE_* 一刀切与五个 PI_* 保留、档位名义构成不变、Linux bwrap 未验证是否照实标注。
结尾一行 merge verdict + supervisor 需要跑的命令。**400 词以内，中文，紧凑。**`;

const [standards, spec] = await runs.all([
  { key: "standards", agent: "reviewer", task: standardsTask },
  { key: "spec", agent: "reviewer", task: specTask },
]);

const standardsOutput = await standards.output;
const specOutput = await spec.output;
return `## Standards\n\n${standardsOutput}\n\n## Spec\n\n${specOutput}`;
