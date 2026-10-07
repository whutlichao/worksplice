// 双轴 code-review 的编排（ticket 07）：两个**只读** reviewer 并行跑，互不污染上下文。
// 用法：subagent({ workflow: "./.scratch/agent-tool-path-guard/evidence/double-axis-review-07.workflow.mjs" })
// 与票 02/05 的同名脚本同款形状（code-review skill 的第 4 步）。

const repo = "/Users/apple/orca/workspaces/worksplice/kernel-port-filter";
const diffPath = "/tmp/worksplice-review-07.diff";
const fixedPoint = "b6f7f35";

const preamble = `你在做**只读**双轴 code review（不改任何文件、不提交、不跑 next build）。仓库：${repo}（分支 worktree）。
固定点：${fixedPoint}（main 上一个提交）。diff 已导出为文件：${diffPath}（只含 lib/ 下四个文件：两个源码 + 两个测试）。
提交：51ae6c4 feat(sandbox): 内核按端口封 worksplice 自己的端口（成员连不上自己的 app）。
评审对象：ticket 07「内核按端口过滤：成员连不上 worksplice 自己的端口」（实施 ADR-0013 决策五第 ③ 环的后半段）。
需要看改动之外的上下文时直接读仓库文件（只读）。`;

const smellBaseline = `基线 smell（Fowler《重构》第 3 章；仓库已写明的标准优先于基线，且一律是判断题而非硬违规）：
Mysterious Name / Duplicated Code / Feature Envy / Data Clumps / Primitive Obsession / Repeated Switches /
Shotgun Surgery / Divergent Change / Speculative Generality / Message Chains / Middle Man / Refused Bequest。
工具已经能查的（格式、lint、tsc）一律跳过——那三条门禁已过。`;

const standardsTask = `${preamble}
轴：**Standards** —— 这份 diff 是否遵守本仓已写下的编码标准？
标准来源（自己读，只读）：docs/engineering-standards.md、docs/i18n.md（注释/证据中文）、AGENTS.md
（File Map 登记约定、Key Design Decisions & Traps、沙箱小节的纪律）、docs/agents/domain.md、CONTEXT.md、.github/SECURITY.md。
${smellBaseline}
重点核对：注释与文档是否与实现一致（有无过期表述）、中文注释的密度与既有风格是否一致、
术语是否用 codebase-design 词汇（module/interface/depth/seam/adapter/leverage/locality）、
新导出是否都登记/有消费方、"同一事实不写两处"（端口推导 vs lib/access-gate.ts 与 instrumentation.ts 里的 process.env.PORT）。
输出：逐文件/逐 hunk 报告 (a) 违反**已写明**标准之处（cite 标准文件 + 那条规则）；(b) 基线 smell（点名 + 引用 hunk，判断题）；
(c) 有证据的既有优点（Correct）。不写泛论。结尾一行 merge verdict。**400 词以内，中文，紧凑。**`;

const specTask = `${preamble}
轴：**Spec** —— 这份 diff 是否忠实实现了票据要求的东西？
规格来源（自己读，只读）：.scratch/agent-tool-path-guard/issues/07-kernel-port-filter-for-member-bash.md（含 Acceptance criteria）、
docs/adr/0013-http-corridor-caller-identity.md（决策四、决策五）、docs/adr/0012-agent-bash-containment-form.md（决策五）、
docs/agent-bash-containment-form.md（第 238 行那张规则形态表）、docs/http-corridor-caller-identity.md（残留绕过面一节）。
输出：(a) 规格要求了但缺失/半成品之处（引规格原文 + 代码位置）；(b) 超出规格的行为（scope creep，逐条判断是否越权）；
(c) 看起来实现了但方式可疑之处（引规格行）。
特别核对六点：① 端口推导而非硬编码 + 推导不出来 fail-closed；② 出网不被封、同机其它 loopback 不被封；
③ 人类会话不受影响（无人归属会话不沙箱）；④ 成员经 loop 结构化回复协议（进程内）不受影响；
⑤ lib/tool-presets.ts 零 diff；⑥ Linux bwrap「本机未验证就不要声称覆盖」、测试只断言形态。
另请独立判断：Linux 上因 bwrap 封不了单个端口而 fail-closed（成员 bash 在 Linux 上不再激活），
这是否是规格授权范围内的取值，还是需要人类拍板的产品级取舍。
结尾一行 merge verdict + supervisor 需要跑的命令。**400 词以内，中文，紧凑。**`;

const [standards, spec] = await runs.all([
  { key: "standards", agent: "reviewer", task: standardsTask },
  { key: "spec", agent: "reviewer", task: specTask },
]);

const standardsOutput = await standards.output;
const specOutput = await spec.output;
return `## Standards\n\n${standardsOutput}\n\n## Spec\n\n${specOutput}`;
