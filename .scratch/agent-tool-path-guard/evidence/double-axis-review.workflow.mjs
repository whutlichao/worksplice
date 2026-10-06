// 双轴 code-review 的编排脚本（code-review skill 步骤 4）：Standards + Spec 两个并行子代理。
// 一次性工具，跑完即删（不入库）。运行方式见 .scratch/agent-tool-path-guard/evidence/ 里的报告。

const repo = "/Users/apple/orca/workspaces/worksplice/member-file-tool-path-guard";
const diffPath = "/tmp/guard-review.diff";

const smellBaseline = `Fowler 基线 smell（判断题，仓库文档化标准优先）：
- Mysterious Name：名字不说明它做什么/持有什么 → 重命名。
- Duplicated Code：同一逻辑形状出现在多处 → 抽出共享形状。
- Feature Envy：方法更多触碰别的对象的数据 → 把方法移到数据那边。
- Data Clumps：同几个字段总是结伴出现 → 打成一个类型。
- Primitive Obsession：用基本类型代替本该有的领域概念 → 给它一个小类型。
- Repeated Switches：同一类型上的 switch/if 级联反复出现 → 多态或共享映射表。
- Shotgun Surgery：一个逻辑改动迫使跨多文件散改 → 把一起变的东西聚到一起。
- Divergent Change：一个文件因多个无关原因被改 → 拆开。
- Speculative Generality：为 spec 没有的需求预留的抽象/参数/hook → 删掉。
- Message Chains：a.b().c().d() 长链 → 在第一个对象上藏一步。
- Middle Man：只做转发 → 砍掉直接调真实目标。
- Refused Bequest：子类忽略/覆盖大部分继承 → 改组合。`;

const standardsTask = `你是 Standards 轴的独立评审者。**严格只读：不要修改、创建、删除任何文件**（你没有写权限的意图也没有授权）。

Diff 固定点：\`git diff f57bfd8..654633d\`。完整 diff 已落盘：${diffPath}（请先读它）。
提交列表（1 个提交）：
  654633d feat(guard): 成员文件工具的路径守卫（允许根 + 六工具同名覆盖）
仓库根：${repo}
改动面：新增 lib/tool-path-guard.ts、lib/tool-path-guard-extension.ts、lib/tool-path-guard.test.mjs、lib/tool-path-guard-extension.test.mjs；改动 lib/rpc/caller.ts(+8/-2)、lib/rpc/session.ts(+6)、lib/agent-runtime.ts(+4)；证据 .scratch/agent-tool-path-guard/evidence/。

先读这些仓库标准的来源，再评审：
- ${repo}/AGENTS.md（项目约定：Architecture / Key Design Decisions & Traps 里的 seam 纪律与「同一事实不写两处」；模块分层；测试约定 node:test + .test.mjs；禁止 npm install；绝不 next build）
- ${repo}/CONTEXT.md（领域语言：允许根 / 路径守卫，以及 _Avoid_ 词）
- ${repo}/docs/adr/0001-*.md、0007-*.md、0008-*.md、0011-*.md
- ${repo}/docs/i18n.md（语言分层：注释与文档用中文，内容层英文硬编码）
派活约束也算标准：术语用 codebase-design 词汇（module/interface/depth/seam/adapter/leverage/locality），但**不得**为了守词而改写仓库既有术语、或破坏与 pi 逐字对称的断言/镜像/注释；不得跑整份重写文件的命令（prettier --write / eslint --fix 等）。

${smellBaseline}

简报：按文件/hunk 报告 (a) 每处违反文档化标准的地方（引用标准文件名 + 那条规则）；(b) 你发现的每个基线 smell（命名它并引用 hunk）。区分硬违规与判断题：文档化标准违规可算硬违规，基线 smell 一律是判断题，且文档化标准优先于基线。跳过工具已经强制的东西（tsc 与 eslint 本次已绿：0 error；eslint 仅 1 条既有 warning 在 hooks/useI18n.tsx，与本 diff 无关）。**400 词以内**，直接给 findings，不要复述 diff。`;

const specTask = `你是 Spec 轴的独立评审者。**严格只读：不要修改、创建、删除任何文件**。

Diff 固定点：\`git diff f57bfd8..654633d\`。完整 diff 已落盘：${diffPath}（请先读它）。
提交列表（1 个提交）：654633d feat(guard): 成员文件工具的路径守卫（允许根 + 六工具同名覆盖）
仓库根：${repo}

先读全这四份 spec 来源（它们互相引用，都要读）：
- ${repo}/.scratch/agent-tool-path-guard/issues/02-member-file-tool-path-guard.md（票据正本：Acceptance criteria + 门禁 + Notes）
- ${repo}/.scratch/agent-tool-path-guard/spec.md（17 条用户故事 + Implementation Decisions + Testing Decisions）
- ${repo}/docs/agent-file-tool-path-guard.md（设计文档 D1–D8 + Testing Decisions）
- ${repo}/docs/adr/0011-agent-file-tool-path-guard.md（决策一至五）
证据目录（测试数字与红绿证据、find 洞的取证）：${repo}/.scratch/agent-tool-path-guard/evidence/

简报：报告 (a) spec 要求但缺失或只做了一半的；(b) diff 里 spec 没要求的行为（scope creep）；(c) 看起来满足了但实现可疑的。每条引用 spec/票据原句。逐条核对票据的 Acceptance criteria（含：六工具同一约束、拒绝文案含被拒绝对路径 + 允许根清单、fail-closed、数据库反向断言、共享项目目录互读写、自己家目录不被误伤、符号链接、前缀陷阱、不存在深层目标、合法路径零行为变化、描述未退化、reload 存活、工具集合唯一事实来源、不静默改写/截断）与门禁（全量 npm test、tsc、lint、双轴 review）。
特别注意并给出判断：实现里 find / grep 的**定义级搜索根判定**（lib/tool-path-guard-extension.ts 的 guardSearchRootCall + lib/tool-path-guard.ts 的 assertSearchRootWithinAllowedRoots/resolvePathForGuard）是 spec 未预见的（pi 的 find 默认走 fd 遍历、ops 到不了；grep 会吞掉 ops 错误），请判断它是否越出 spec 授权、是否是必要修正、实现是否足够（含 @ / ~ / file:// / 相对路径的解析复刻风险）。
**400 词以内**，直接给 findings，不要复述 diff。`;

const [standards, spec] = await runs.all([
  { key: "standards", agent: "reviewer", task: standardsTask },
  { key: "spec", agent: "reviewer", task: specTask },
]);

return {
  standards: { status: standards?.status, output: standards?.output },
  spec: { status: spec?.status, output: spec?.output },
};
